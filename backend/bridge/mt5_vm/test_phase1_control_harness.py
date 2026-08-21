from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from . import phase1_control_harness as harness


class Phase1ControlHarnessTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == "win32", "PowerShell entrypoint is Windows-only")
    def test_two_account_entrypoint_requires_two_aliases_slots_and_signed_agent(self) -> None:
        script = Path(__file__).with_name("Invoke-MT5VmPhase1TwoAccount.ps1").resolve()
        completed = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                (
                    "$command=Get-Command -Name $env:PHASE1_TWO_ENTRYPOINT;"
                    "$aliases=$command.Parameters['AccountAlias'];"
                    "$slots=$command.Parameters['TerminalPath'];"
                    "$agent=$command.Parameters['AgentPath'];"
                    "if($aliases.ParameterType -ne [string[]] -or "
                    "$slots.ParameterType -ne [string[]] -or "
                    "$agent.ParameterType -ne [string]){exit 2}"
                ),
            ],
            capture_output=True,
            text=True,
            check=False,
            env={**os.environ, "PHASE1_TWO_ENTRYPOINT": str(script)},
        )
        self.assertEqual(0, completed.returncode, completed.stderr)

    @unittest.skipUnless(sys.platform == "win32", "PowerShell entrypoint is Windows-only")
    def test_entrypoint_requires_slots_and_separates_signed_agent_from_live_host(self) -> None:
        script = Path(__file__).with_name("Invoke-MT5VmPhase1.ps1").resolve()
        metadata = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
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
                "-ExecutionPolicy",
                "Bypass",
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
                "-ExecutionPolicy",
                "Bypass",
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

    def test_two_account_validation_keeps_unaffected_runtime_ready_across_peer_crash(self) -> None:
        events: list[tuple[str, str]] = []

        class FakeAgent:
            def __init__(self, cfg, _channel, key_hex):
                self._peer = harness.ControlChannel(bytearray.fromhex(key_hex), cfg["worker_id"])
                self._next = ""
                self._active = 0

            def send(self, frame):
                account_id = frame["account_id"]
                lease_generation = frame["lease_generation"]
                kind, _payload = self._peer.verify(
                    json.dumps(frame), account_id, lease_generation
                )
                events.append((account_id, kind))
                if kind in {"provision_account", "force_terminal_crash"}:
                    if kind == "provision_account":
                        self._active += 1
                    response_kind = "account_snapshot"
                    response = {
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
                elif kind == "agent_heartbeat":
                    response_kind = "agent_heartbeat"
                    response = {"state": "ready", "active_runtime_count": self._active}
                else:
                    self._active -= 1
                    response_kind = "account_runtime_status"
                    response = {"state": "stopped", "active_runtime_count": self._active}
                response_frame = self._peer.sign(
                    account_id, lease_generation, response_kind, response
                )
                self._next = json.dumps(response_frame)

            def receive(self, _timeout_seconds=45.0):
                return self._next

            def close(self):
                return None

        cfg = {
            "worker_id": "worker-01",
            "terminal_slots": [{"terminal_path": "slot-a"}, {"terminal_path": "slot-b"}],
            "accounts": [
                {
                    "account_id": "account-a",
                    "lease_generation": 1,
                    "login": "11111111",
                    "password": "secret-a",
                    "server": "Broker-A-Demo",
                    "symbol": "EURUSD",
                    "independent_web_match_confirmed": True,
                },
                {
                    "account_id": "account-b",
                    "lease_generation": 1,
                    "login": "22222222",
                    "password": "secret-b",
                    "server": "Broker-B-Demo",
                    "symbol": "EURUSD",
                    "independent_web_match_confirmed": True,
                },
            ],
        }
        result = harness.run_two_account_validation(
            cfg,
            agent_factory=FakeAgent,
            resource_sampler=lambda _agent: {
                "settlement_ms": 15_000,
                "observation_ms": 10_000,
                "aggregate_working_set_bytes": 300_000_000,
                "aggregate_cpu_core_percent": 8.0,
            },
        )

        self.assertEqual("PASS", result["status"])
        self.assertTrue(result["isolation"]["faulted_runtime_recovered"])
        self.assertTrue(result["isolation"]["unaffected_ready_before_fault"])
        self.assertTrue(result["isolation"]["unaffected_ready_after_fault"])
        self.assertEqual(2, result["isolation"]["initial_snapshots_passed"])
        self.assertEqual(300_000_000, result["idle_resources"]["aggregate_working_set_bytes"])
        self.assertEqual(
            [
                ("account-a", "provision_account"),
                ("account-b", "provision_account"),
                ("account-b", "agent_heartbeat"),
                ("account-a", "force_terminal_crash"),
                ("account-b", "agent_heartbeat"),
                ("account-a", "stop_account"),
                ("account-b", "stop_account"),
            ],
            events,
        )
        serialized = json.dumps(result)
        for forbidden in ("11111111", "22222222", "secret-a", "secret-b", "Broker-A-Demo", "Broker-B-Demo"):
            self.assertNotIn(forbidden, serialized)

    def test_two_account_cleanup_failure_is_never_silently_ignored(self) -> None:
        class CleanupFailingAgent:
            def __init__(self, cfg, _channel, key_hex):
                self._peer = harness.ControlChannel(bytearray.fromhex(key_hex), cfg["worker_id"])
                self._next = ""
                self._provisions = 0

            def send(self, frame):
                account_id = frame["account_id"]
                lease_generation = frame["lease_generation"]
                kind, _payload = self._peer.verify(
                    json.dumps(frame), account_id, lease_generation
                )
                if kind == "stop_account":
                    raise RuntimeError("simulated cleanup failure")
                self._provisions += 1
                response = {
                    "mode": "demo" if self._provisions == 1 else "real",
                    "login_matches": True,
                    "server_matches": True,
                    "connected": True,
                    "positions_count": 0,
                    "pending_orders_count": 0,
                    "history_orders_count_7d": 0,
                    "history_deals_count_7d": 0,
                    "symbol_specification": {"symbol": "EURUSD"},
                }
                self._next = json.dumps(
                    self._peer.sign(
                        account_id, lease_generation, "account_snapshot", response
                    )
                )

            def receive(self, _timeout_seconds=45.0):
                return self._next

            def close(self):
                return None

        cfg = {
            "worker_id": "worker-01",
            "terminal_slots": [{"terminal_path": "slot-a"}, {"terminal_path": "slot-b"}],
            "accounts": [
                {
                    "account_id": "account-a",
                    "lease_generation": 1,
                    "login": "11111111",
                    "password": "secret-a",
                    "server": "Broker-A-Demo",
                },
                {
                    "account_id": "account-b",
                    "lease_generation": 1,
                    "login": "22222222",
                    "password": "secret-b",
                    "server": "Broker-B-Demo",
                },
            ],
        }
        with self.assertRaisesRegex(
            harness.HarnessError, "^TWO_ACCOUNT_CLEANUP_FAILED$"
        ):
            harness.run_two_account_validation(
                cfg,
                agent_factory=CleanupFailingAgent,
                resource_sampler=lambda _agent: {},
            )

    def test_two_account_resource_sampler_reports_aggregate_delta_without_identifiers(self) -> None:
        agent = type("Agent", (), {"pid": 1234})()
        samples = iter(
            [
                {"working_set_bytes": 280_000_000, "cpu_seconds": 10.0, "process_count": 5},
                {"working_set_bytes": 300_000_000, "cpu_seconds": 10.8, "process_count": 5},
            ]
        )
        with mock.patch.object(harness.time, "sleep"):
            result = harness.sample_two_account_resources(
                agent,
                settlement_seconds=15,
                observation_seconds=10,
                sample_fn=lambda _pid: next(samples),
            )
        self.assertEqual(15_000, result["settlement_ms"])
        self.assertEqual(10_000, result["observation_ms"])
        self.assertEqual(300_000_000, result["aggregate_working_set_bytes"])
        self.assertAlmostEqual(8.0, result["aggregate_cpu_core_percent"])
        self.assertEqual(5, result["process_count"])
        self.assertNotIn("pid", result)


if __name__ == "__main__":
    unittest.main()
