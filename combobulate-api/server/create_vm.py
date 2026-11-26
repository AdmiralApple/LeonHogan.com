"""Keep trying to create Combobulate's Always Free Arm VM until Oracle has capacity.

    python create_vm.py --dry-run     # check your setup, change nothing
    python create_vm.py               # set up the network, then retry until the VM exists

What it does:
  * Uses your Oracle API key from ~/.oci/config (see server/README.md, "Retry script").
  * Creates (or reuses) a network called "combobulate-vcn" with a public subnet, an internet
    gateway, and ports 22, 80 and 443 open. All of that is free.
  * Tries VM.Standard.A1.Flex, 2 OCPUs, 12 GB (exactly the Always Free allowance) with Ubuntu
    24.04 in every availability domain, then waits and tries again, until one works.
  * Refuses to run if you already have an Arm VM, so it can't go past the free allowance.
  * Prints the VM's public IP and the SSH command when it's done.
"""

from __future__ import annotations

import argparse
import datetime as dt
import pathlib
import random
import subprocess
import sys
import time

SHAPE = "VM.Standard.A1.Flex"
OCPUS = 2
MEMORY_GB = 12
VM_NAME = "combobulate-llm"
VCN_NAME = "combobulate-vcn"
VCN_CIDR = "10.0.0.0/16"
SUBNET_NAME = "combobulate-public"
SUBNET_CIDR = "10.0.0.0/24"
OPEN_PORTS = (22, 80, 443)
DEFAULT_KEY = pathlib.Path.home() / ".ssh" / "combobulate_oracle"


def log(msg: str) -> None:
    print(f"[{dt.datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


# ---------- Pure helpers (unit tested in test_create_vm.py) ----------

def classify_error(status: int, code: str, message: str) -> str:
    """'capacity' -> try again later, 'throttled' -> back off, 'fatal' -> stop."""
    text = f"{code} {message}".lower()
    if "out of host capacity" in text or "out of capacity" in text:
        return "capacity"
    if status == 429 or code == "TooManyRequests":
        return "throttled"
    if status >= 500:
        return "capacity"  # transient server-side error: worth retrying
    return "fatal"


def missing_ports(ingress_rules, ports=OPEN_PORTS) -> list[int]:
    """Which of `ports` aren't already open to the internet (TCP from 0.0.0.0/0)."""
    open_ports = set()
    for r in ingress_rules:
        if r.protocol not in ("6", "all") or r.source != "0.0.0.0/0":
            continue
        if r.protocol == "all" or r.tcp_options is None or r.tcp_options.destination_port_range is None:
            return []  # everything is already open
        rng = r.tcp_options.destination_port_range
        open_ports.update(p for p in ports if rng.min <= p <= rng.max)
    return [p for p in ports if p not in open_ports]


def pick_image(images):
    """Newest standard (non-Minimal) Ubuntu 24.04 image from a newest-first list."""
    for img in images:
        if "minimal" not in (img.display_name or "").lower():
            return img
    return None


def arm_ocpus_in_use(instances) -> float:
    return sum(
        (i.shape_config.ocpus or 0)
        for i in instances
        if i.shape == SHAPE and i.lifecycle_state not in ("TERMINATED", "TERMINATING")
    )


# ---------- Oracle calls ----------

def ensure_ssh_key(path: pathlib.Path) -> str:
    pub = path.with_suffix(".pub")
    if not pub.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        log(f"Creating an SSH key for the VM: {path}")
        subprocess.run(["ssh-keygen", "-t", "ed25519", "-N", "", "-C", "combobulate-oracle", "-f", str(path)], check=True)
    return pub.read_text().strip()


def find_one(items, name):
    for it in items:
        if it.display_name == name and it.lifecycle_state not in ("TERMINATED", "TERMINATING"):
            return it
    return None


def ensure_network(oci, vn, compartment: str, dry_run: bool):
    m = oci.core.models
    vcns = oci.pagination.list_call_get_all_results(vn.list_vcns, compartment).data
    vcn = find_one(vcns, VCN_NAME)
    if dry_run:
        others = [v.display_name for v in vcns if v.display_name != VCN_NAME and v.lifecycle_state == "AVAILABLE"]
        log(f"Network: {'reusing' if vcn else 'would create'} {VCN_NAME}" + (f" (other networks: {', '.join(others)})" if others else ""))
        return None

    if not vcn:
        log(f"Creating network {VCN_NAME}")
        vcn = vn.create_vcn(m.CreateVcnDetails(compartment_id=compartment, display_name=VCN_NAME,
                                                cidr_blocks=[VCN_CIDR], dns_label="combobulate")).data
        vcn = oci.wait_until(vn, vn.get_vcn(vcn.id), "lifecycle_state", "AVAILABLE").data

    igws = vn.list_internet_gateways(compartment, vcn_id=vcn.id).data
    igw = next((g for g in igws if g.lifecycle_state == "AVAILABLE"), None)
    if not igw:
        log("Creating internet gateway")
        igw = vn.create_internet_gateway(m.CreateInternetGatewayDetails(
            compartment_id=compartment, vcn_id=vcn.id, is_enabled=True, display_name="combobulate-igw")).data
        igw = oci.wait_until(vn, vn.get_internet_gateway(igw.id), "lifecycle_state", "AVAILABLE").data

    rt = vn.get_route_table(vcn.default_route_table_id).data
    if not any(r.destination == "0.0.0.0/0" for r in rt.route_rules):
        log("Adding internet route")
        rules = list(rt.route_rules) + [m.RouteRule(destination="0.0.0.0/0", destination_type="CIDR_BLOCK",
                                                    network_entity_id=igw.id)]
        vn.update_route_table(rt.id, m.UpdateRouteTableDetails(route_rules=rules))

    sl = vn.get_security_list(vcn.default_security_list_id).data
    need = missing_ports(sl.ingress_security_rules)
    if need:
        log(f"Opening ports {', '.join(map(str, need))}")
        rules = list(sl.ingress_security_rules) + [
            m.IngressSecurityRule(protocol="6", source="0.0.0.0/0", description=f"Combobulate port {p}",
                                  tcp_options=m.TcpOptions(destination_port_range=m.PortRange(min=p, max=p)))
            for p in need
        ]
        vn.update_security_list(sl.id, m.UpdateSecurityListDetails(ingress_security_rules=rules))

    subnets = vn.list_subnets(compartment, vcn_id=vcn.id).data
    subnet = find_one(subnets, SUBNET_NAME)
    if not subnet:
        log(f"Creating public subnet {SUBNET_NAME}")
        subnet = vn.create_subnet(m.CreateSubnetDetails(
            compartment_id=compartment, vcn_id=vcn.id, display_name=SUBNET_NAME, cidr_block=SUBNET_CIDR,
            dns_label="public", prohibit_public_ip_on_vnic=False,
            route_table_id=vcn.default_route_table_id, security_list_ids=[vcn.default_security_list_id])).data
        subnet = oci.wait_until(vn, vn.get_subnet(subnet.id), "lifecycle_state", "AVAILABLE").data
    return subnet


def public_ip_of(oci, compute, vn, compartment: str, instance_id: str) -> str | None:
    for att in compute.list_vnic_attachments(compartment, instance_id=instance_id).data:
        if att.lifecycle_state == "ATTACHED":
            ip = vn.get_vnic(att.vnic_id).data.public_ip
            if ip:
                return ip
    return None


def finish(oci, compute, vn, compartment, instance, key_path) -> None:
    log(f"VM created: {instance.display_name} ({instance.availability_domain}). Waiting for it to start...")
    oci.wait_until(compute, compute.get_instance(instance.id), "lifecycle_state", "RUNNING", max_wait_seconds=900)
    ip = None
    for _ in range(30):
        ip = public_ip_of(oci, compute, vn, compartment, instance.id)
        if ip:
            break
        time.sleep(10)
    print("\a")
    log("Done! Your VM is running.")
    print(f"""
  Public IP:  {ip or '(not assigned yet, check the console)'}

  Next steps (PowerShell, from combobulate-api):
    scp -i "{key_path}" server/setup.sh ubuntu@{ip}:
    ssh -i "{key_path}" ubuntu@{ip}
  then on the VM:
    sudo bash setup.sh {ip}

  (Give it a minute or two after starting before SSH answers.)
""")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="check config, image and network; create nothing")
    ap.add_argument("--interval", type=int, default=300, help="seconds between rounds of attempts (default 300)")
    ap.add_argument("--profile", default="DEFAULT", help="profile in ~/.oci/config (default DEFAULT)")
    ap.add_argument("--compartment", help="compartment OCID (default: your tenancy's root compartment)")
    ap.add_argument("--ssh-key", type=pathlib.Path, default=DEFAULT_KEY,
                    help=f"private key path; created if missing (default {DEFAULT_KEY})")
    args = ap.parse_args()

    try:
        import oci
    except ImportError:
        print("The Oracle SDK isn't installed. See server/README.md, 'Retry script'.")
        return 1

    try:
        config = oci.config.from_file(profile_name=args.profile)
        oci.config.validate_config(config)
    except Exception as e:  # noqa: BLE001 - show any config problem plainly
        print(f"Couldn't read your Oracle API key config (~/.oci/config): {e}")
        print("See server/README.md, 'Retry script', step 1.")
        return 1

    compartment = args.compartment or config["tenancy"]
    identity = oci.identity.IdentityClient(config)
    compute = oci.core.ComputeClient(config)
    vn = oci.core.VirtualNetworkClient(config)
    log(f"Signed in. Region: {config['region']}")

    ads = [a.name for a in identity.list_availability_domains(compartment).data]
    log(f"Availability domains: {', '.join(ads)}")

    instances = oci.pagination.list_call_get_all_results(compute.list_instances, compartment).data
    existing = find_one(instances, VM_NAME)
    if existing:
        log(f"{VM_NAME} already exists ({existing.lifecycle_state}).")
        if not args.dry_run:
            finish(oci, compute, vn, compartment, existing, args.ssh_key)
        return 0
    used = arm_ocpus_in_use(instances)
    if used + OCPUS > OCPUS:
        log(f"You already have Arm VMs using {used:g} OCPUs. Another one would go past the free allowance, so stopping.")
        return 1

    images = compute.list_images(compartment, operating_system="Canonical Ubuntu", operating_system_version="24.04",
                                 shape=SHAPE, sort_by="TIMECREATED", sort_order="DESC").data
    image = pick_image(images)
    if not image:
        log("Couldn't find an Ubuntu 24.04 image for this shape.")
        return 1
    log(f"Image: {image.display_name}")

    try:
        subnet = ensure_network(oci, vn, compartment, args.dry_run)
    except oci.exceptions.ServiceError as e:
        log(f"Couldn't set up the network: {e.status} {e.code}: {e.message}")
        if e.code == "LimitExceeded":
            log("You've hit the network limit. In the console, delete the unused vcn-2026... networks "
                "left by the earlier attempts (Networking > Virtual cloud networks), then run this again.")
        return 1
    if args.dry_run:
        log(f"Would keep trying {SHAPE} ({OCPUS} OCPU, {MEMORY_GB} GB) in {len(ads)} availability domains "
            f"every {args.interval}s. Everything looks ready; run again without --dry-run.")
        return 0

    pubkey = ensure_ssh_key(args.ssh_key)
    m = oci.core.models
    attempt = 0
    while True:
        for ad in ads:
            attempt += 1
            # A timed-out request may still have created it, so check before every try.
            instances = oci.pagination.list_call_get_all_results(compute.list_instances, compartment).data
            existing = find_one(instances, VM_NAME)
            if existing:
                finish(oci, compute, vn, compartment, existing, args.ssh_key)
                return 0
            try:
                inst = compute.launch_instance(m.LaunchInstanceDetails(
                    compartment_id=compartment, availability_domain=ad, display_name=VM_NAME, shape=SHAPE,
                    shape_config=m.LaunchInstanceShapeConfigDetails(ocpus=OCPUS, memory_in_gbs=MEMORY_GB),
                    source_details=m.InstanceSourceViaImageDetails(image_id=image.id),
                    create_vnic_details=m.CreateVnicDetails(subnet_id=subnet.id, assign_public_ip=True),
                    metadata={"ssh_authorized_keys": pubkey},
                )).data
                finish(oci, compute, vn, compartment, inst, args.ssh_key)
                return 0
            except oci.exceptions.ServiceError as e:
                kind = classify_error(e.status, e.code or "", e.message or "")
                if kind == "fatal":
                    log(f"Oracle refused with an error retrying won't fix: {e.status} {e.code}: {e.message}")
                    return 1
                log(f"Attempt {attempt} ({ad.split(':')[-1]}): {'out of capacity' if kind == 'capacity' else 'rate limited'}")
                time.sleep(120 if kind == "throttled" else 15)
            except Exception as e:  # noqa: BLE001 - network blips etc.: keep going
                log(f"Attempt {attempt} ({ad.split(':')[-1]}): {type(e).__name__}: {e}")
                time.sleep(30)
        wait = args.interval + random.randint(0, 60)
        log(f"No capacity anywhere this round. Next try in {wait // 60} min {wait % 60} s (Ctrl+C to stop).")
        time.sleep(wait)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nStopped.")
        sys.exit(130)
