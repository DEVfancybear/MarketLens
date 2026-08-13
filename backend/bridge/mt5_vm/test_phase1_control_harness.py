from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from . import phase1_control_harness as harness


class Phase1ControlHarnessTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == "win32", "PowerShell entrypoint is Windows-only")
    def test_entrypoint_requires_slots_and_separates_signed_agent_from_live_host(self) -> None:
        script = Path(__file__).with_name("Invoke-MT5VmPhase1.ps1").resolve()
        metadata = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                (
                    "$command=Get-Command -Name $env:PHASE1_ENTRYPOINT;"
                    "$parameter=$command.Parameters['TerminalPath'];"
                    "$mandatory=$parameter.Attributes|Where-Object{"
                    "$_.TypeId.Name -eq 'ParameterAttribute' -and $_.Mandatory};"
                    "if($parameter.ParameterType -ne [string[]] -or $null -eq $mandatory){exit 2}"
                ),
            ],
            capture_output=True,
            text=True,
            check=False,
            env={**os.environ, "PHASE1_ENTRYPOINT": str(script)},
        )
        self.assertEqual(0, metadata.returncode, metadata.stderr)

        normal = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-File",
                str(script),
                "-AccountAlias",
                "boundary-test",
                "-TerminalPath",
                r"C:\missing-slot\terminal64.exe",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(0, normal.returncode)
        self.assertIn("AgentPath is required", normal.stderr)

        live_host = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-File",
                str(script),
                "-AccountAlias",
                "boundary-test",
                "-TerminalPath",
                r"C:\missing-slot\terminal64.exe",
                "-AgentPath",
                r"C:\unsigned\mt5-vm-agent.exe",
                "-ApplicationControlTestHost",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(0, live_host.returncode)
        self.assertIn("AgentPath cannot be combined", live_host.stderr)

    def test_control_channel_detects_tamper_replay_and_cross_account(self) -> None:
        channel = harness.ControlChannel(bytearray([9] * 32), "worker-01")
        frame = channel.sign("account-a", 4, "agent_heartbeat", {})
        kind, payload = channel.verify(json.dumps(frame), "account-a", 4)
        self.assertEqual("agent_heartbeat", kind)
        self.assertEqual({}, payload)
        with self.assertRaises(harness.HarnessError):
            channel.verify(json.dumps(frame), "account-a", 4)

        tampered = dict(frame)
        tampered["sequence"] = 2
        tampered["payload_json"] = '{"unsafe":true}'
        with self.assertRaises(harness.HarnessError):
            channel.verify(json.dumps(tampered), "account-a", 4)

        other = harness.ControlChannel(bytearray([9] * 32), "worker-01")
        with self.assertRaises(harness.HarnessError):
            other.verify(json.dumps(frame), "account-b", 4)
        channel.zeroize()

    def test_snapshot_gate_requires_complete_demo_identity_and_reads(self) -> None:
        snapshot = {
            "mode": "demo",
            "login_matches": True,
            "server_matches": True,
            "connected": True,
            "positions_count": 0,
            "pending_orders_count": 0,
            "history_orders_count_7d": 0,
            "history_deals_count_7d": 0,
            "symbol_specification": {"symbol": "EURUSD"},
        }
        self.assertTrue(harness._snapshot_gate(snapshot))
        snapshot["server_matches"] = False
        self.assertFalse(harness._snapshot_gate(snapshot))

    def test_request_rejects_relative_paths_without_echoing_credentials(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw = {
                "schema_version": 1,
                "agent_path": "relative-agent.exe",
                "worker_id": "worker-01",
                "account_id": "account-a",
                "lease_generation": 1,
                "data_root": str(root / "data"),
                "terminal_slots": [
                    {
                        "terminal_path": str(root / "terminal64.exe"),
                        "terminal_sha256": "a" * 64,
                        "servers_sha256": "a" * 64,
                        "terminal_license_sha256": "a" * 64,
                    }
                ],
                "python_path": str(root / "python.exe"),
                "adapter_path": str(root / "adapter.py"),
                "acl_helper_path": str(root / "acl.ps1"),
                "powershell_path": str(root / "powershell.exe"),
                "python_sha256": "b" * 64,
                "adapter_sha256": "c" * 64,
                "login": "12345678",
                "password": "do-not-print",
                "server": "FTMO-Demo",
                "symbol": "EURUSD",
                "independent_web_match_confirmed": False,
            }
            with self.assertRaises(harness.HarnessError) as error:
                harness.validate_request(raw)
            self.assertNotIn(raw["password"], str(error.exception))
            self.assertNotIn(raw["login"], str(error.exception))
            self.assertNotIn(raw["server"], str(error.exception))


if __name__ == "__main__":
    unittest.main()
