"""Unit tests for the pure parts of create_vm.py (no Oracle account needed).

    python -m unittest test_create_vm.py
"""

import unittest
from types import SimpleNamespace as NS

from create_vm import arm_ocpus_in_use, classify_error, missing_ports, pick_image


def tcp_rule(lo, hi, source="0.0.0.0/0"):
    return NS(protocol="6", source=source, tcp_options=NS(destination_port_range=NS(min=lo, max=hi)))


class ClassifyError(unittest.TestCase):
    def test_capacity(self):
        self.assertEqual(classify_error(500, "InternalError", "Out of host capacity."), "capacity")
        self.assertEqual(classify_error(400, "", "Out of capacity for shape VM.Standard.A1.Flex"), "capacity")

    def test_throttled(self):
        self.assertEqual(classify_error(429, "TooManyRequests", "Too many requests"), "throttled")

    def test_transient_server_error_retries(self):
        self.assertEqual(classify_error(503, "ServiceUnavailable", "try later"), "capacity")

    def test_fatal(self):
        self.assertEqual(classify_error(400, "LimitExceeded", "service limit"), "fatal")
        self.assertEqual(classify_error(401, "NotAuthenticated", "bad key"), "fatal")
        self.assertEqual(classify_error(404, "NotAuthorizedOrNotFound", "nope"), "fatal")


class MissingPorts(unittest.TestCase):
    def test_default_security_list_only_has_ssh(self):
        self.assertEqual(missing_ports([tcp_rule(22, 22), NS(protocol="1", source="0.0.0.0/0", tcp_options=None)]),
                         [80, 443])

    def test_all_open(self):
        self.assertEqual(missing_ports([tcp_rule(22, 22), tcp_rule(80, 80), tcp_rule(443, 443)]), [])

    def test_range_counts(self):
        self.assertEqual(missing_ports([tcp_rule(1, 100)]), [443])

    def test_rule_from_other_source_does_not_count(self):
        self.assertEqual(missing_ports([tcp_rule(80, 443, source="10.0.0.0/16")]), [22, 80, 443])

    def test_allow_all_protocols(self):
        self.assertEqual(missing_ports([NS(protocol="all", source="0.0.0.0/0", tcp_options=None)]), [])


class PickImage(unittest.TestCase):
    def test_skips_minimal(self):
        imgs = [NS(display_name="Canonical-Ubuntu-24.04-Minimal-aarch64-2026.11.05-0"),
                NS(display_name="Canonical-Ubuntu-24.04-aarch64-2026.11.05-0")]
        self.assertEqual(pick_image(imgs).display_name, "Canonical-Ubuntu-24.04-aarch64-2026.11.05-0")

    def test_none(self):
        self.assertIsNone(pick_image([]))


class ArmOcpus(unittest.TestCase):
    def test_counts_live_arm_only(self):
        insts = [
            NS(shape="VM.Standard.A1.Flex", lifecycle_state="RUNNING", shape_config=NS(ocpus=1)),
            NS(shape="VM.Standard.A1.Flex", lifecycle_state="TERMINATED", shape_config=NS(ocpus=2)),
            NS(shape="VM.Standard.E2.1.Micro", lifecycle_state="RUNNING", shape_config=NS(ocpus=1)),
        ]
        self.assertEqual(arm_ocpus_in_use(insts), 1)


if __name__ == "__main__":
    unittest.main()
