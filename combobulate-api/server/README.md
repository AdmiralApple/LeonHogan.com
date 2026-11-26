# Combobulate's own AI server (Oracle Cloud, free)

An Oracle Cloud **Always Free** Arm VM running Llama 3.2 3B with [llama.cpp](https://github.com/ggml-org/llama.cpp). The Worker asks it first, which means **no daily limit**. If it's slow (over 12 s), down, or gone, the Worker falls back to Cloudflare Workers AI automatically.

```
Browser → Worker (Cloudflare) → https://<ip>.sslip.io  →  Caddy → llama-server (127.0.0.1:8080)
                              ↘ fallback: Workers AI
```

- **Always Free** gives you 2 Arm cores and 12 GB of RAM for the life of the account.
- **HTTPS** comes from Caddy with a free automatic certificate. `sslip.io` turns your IP into a hostname, so you don't need a domain.
- **Locked down:** only `/v1/chat/completions` (which needs the API key) and `/health` are reachable.

## 1. Create the account

Sign up at <https://www.oracle.com/cloud/free/>. Oracle usually asks for a card to verify your identity. Always Free resources aren't charged, but **don't click "Upgrade to Pay As You Go"** if you want to guarantee $0.

**Your home region can't be changed later**, and free Arm VMs are only available in your home region. Busy regions are often "out of capacity". If you have a choice, pick a less popular one near you.

## 2. Create the VM with the retry script (recommended)

Free Arm VMs are often "out of capacity". `create_vm.py` keeps trying every availability domain every ~5 minutes until one works. It also sets up the network for you: a public subnet with ports 22/80/443 open, and the public IP assigned at launch. With the script, you can **skip steps 2b and 3 below**.

**Step 1: create an API key** so the script can act as you:

1. In the Oracle console, click your **profile icon** (top right) → **My profile** (or **User settings**).
2. Under **Resources**, open **API keys** (it may be under **Tokens and keys**) → **Add API key** → **Generate API key pair** → **Download private key** → **Add**.
3. Oracle shows a **Configuration file preview**. Copy it.
4. Create the folder `C:\Users\<you>\.oci`, move the downloaded `.pem` file into it, and save the preview there as a file named `config` (no extension). Change its `key_file=` line to the `.pem`'s new path, for example `key_file=C:\Users\<you>\.oci\oci_api_key.pem`.

The `.pem` file is the actual secret: keep it private and never commit it.

**Step 2: install the Oracle SDK** (one time), from `combobulate-api/server` in PowerShell:

```powershell
python -m venv .venv; .venv\Scripts\python -m pip install -r requirements.txt
```

**Step 3: check, then run:**

```powershell
.venv\Scripts\python create_vm.py --dry-run
```

```powershell
.venv\Scripts\python create_vm.py
```

`--dry-run` signs in, finds the Ubuntu image and shows what it would create, without changing anything. The real run creates the network (free), makes an SSH key at `~/.ssh/combobulate_oracle`, then retries until the VM exists. It beeps and prints the IP and SSH commands when it's done. Leave it running (it can take hours or days) and keep the PC awake. `Ctrl+C` stops it; running it again picks up where it left off.

It refuses to create a second Arm VM, so it can't go past the free allowance.

Unit tests (no account needed): `.venv\Scripts\python -m unittest test_create_vm.py`

## 2b. Or create the VM in the console

Go to **Compute → Instances → Create instance**:

| Setting | Value |
| --- | --- |
| Image | **Canonical Ubuntu 24.04** |
| Shape | **Ampere → VM.Standard.A1.Flex**, **2 OCPUs**, **12 GB** memory (labelled "Always Free-eligible") |
| Networking | Create a new VCN with a **public subnet**; **assign a public IPv4 address** |
| SSH keys | "Generate a key pair" and **download the private key** (or paste your own public key) |
| Boot volume | Default is fine |

If you get "Out of capacity for shape VM.Standard.A1.Flex", try a different availability domain, or try again later. Capacity frees up over the day.

Note the instance's **public IP address**.

## 3. Open ports 80 and 443 in Oracle's firewall (console method only)

Go to **Networking → Virtual cloud networks →** your VCN **→ Security** (or Subnets → your subnet) **→ Default Security List → Add Ingress Rules**:

| Source CIDR | IP protocol | Destination port |
| --- | --- | --- |
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

Port 80 is only used to get the HTTPS certificate. The setup script opens both ports in the VM's own firewall too.

## 4. Run the setup script

From `combobulate-api/` on your PC (PowerShell). Replace the key path and IP with yours. The retry script prints these commands with its key, `~/.ssh/combobulate_oracle`, already filled in:

```powershell
scp -i "$HOME\Downloads\ssh-key.key" server/setup.sh ubuntu@203.0.113.10:
```

```powershell
ssh -i "$HOME\Downloads\ssh-key.key" ubuntu@203.0.113.10
```

Then, on the VM:

```bash
sudo bash setup.sh 203.0.113.10
```

It takes 15–25 minutes, mostly compiling llama.cpp and downloading the 2 GB model. At the end it runs a test (Water + Fire) and prints your `LLM_URL`.

> If SSH says the key's permissions are too open, run this once on Windows:
> `icacls "$HOME\Downloads\ssh-key.key" /inheritance:r /grant:r "$($env:USERNAME):R"`

## 5. Point the Worker at it

On your PC, in `combobulate-api/`:

1. In `wrangler.toml`, set `LLM_URL = "https://203-0-113-10.sslip.io"` (the script prints the exact value).
2. Save the API key as a Worker secret. Get it on the VM with `sudo cat /etc/llm/api-key`, then:

   ```powershell
   npx wrangler secret put LLM_TOKEN
   ```

3. Deploy:

   ```powershell
   npm run deploy
   ```

## Looking after it

| Task | Command (on the VM) |
| --- | --- |
| Live logs | `journalctl -u llama-server -f` |
| Restart | `sudo systemctl restart llama-server` |
| Is it up? | `curl -s https://<your-host>/health` |
| OS updates | Ubuntu installs security updates automatically; run `sudo apt update && sudo apt upgrade` now and then |
| New key | `sudo rm /etc/llm/api-key && sudo bash setup.sh <ip>`, then `wrangler secret put LLM_TOKEN` again |

**Idle reclaim:** Oracle may reclaim an Always Free VM that stays under 20% CPU, network *and* memory use for 7 days. The loaded model keeps memory use at about 25% of 12 GB, which should help, but there's no guarantee. If the VM is ever reclaimed, the game keeps working on Workers AI, and every saved recipe stays in D1. Just create a new VM and run the script again.

**Bigger model:** 12 GB of RAM fits Llama 3.1 8B (Q4_K_M, about 4.9 GB). Answers are better, but it's roughly 2–3× slower. To switch, change `MODEL_URL` and `MODEL_SHA256` at the top of `setup.sh`, delete `/opt/llm/models/model.gguf`, and run it again.
