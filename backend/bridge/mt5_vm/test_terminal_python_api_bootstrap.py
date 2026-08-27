from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


BRIDGE = Path(__file__).resolve().parent
UI_HELPER = BRIDGE / "Mt5VmTerminalUi.ps1"
BOOTSTRAP = BRIDGE / "Invoke-MT5VmTerminalPythonApiBootstrap.ps1"
ENROLL = BRIDGE.parents[2] / "tools" / "mt5-vm-image" / "Enroll-MT5VmServerCatalog.ps1"
ALLOWLIST = (
    BRIDGE.parents[2]
    / "tools"
    / "mt5-baremetal"
    / "Set-MT5WebRequestAllowlist.ps1"
)
HOST_VERIFIER = BRIDGE.parents[2] / "tools" / "verify-production-worker-host-provision.ps1"


@unittest.skipUnless(sys.platform == "win32", "MT5 terminal UI contracts are Windows-only")
class TerminalPythonApiBootstrapTests(unittest.TestCase):
    maxDiff = None

    def _run_module(
        self,
        body: str,
        *,
        extra_env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        if not UI_HELPER.exists():
            self.fail("generic MT5 terminal UI helper is not implemented")
        command = (
            "$ErrorActionPreference='Stop';"
            "Set-StrictMode -Version Latest;"
            ". $env:MT5_UI_HELPER;"
            + body
        )
        return subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                command,
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
            env={
                **os.environ,
                "MT5_UI_HELPER": str(UI_HELPER),
                **(extra_env or {}),
            },
        )

    @staticmethod
    def _process_boundaries(*, started: bool = False) -> str:
        initial_rows = (
            "$script:rows=@();"
            if started
            else "$script:rows=@([pscustomobject]@{ProcessId=701;"
            "ExecutablePath=$env:MT5_TEST_TERMINAL});"
        )
        return (
            initial_rows
            + "$script:startCalls=0;$script:closeCalls=@();"
            "function Assert-MT5VmTrustedTerminalBoundary {"
            "param([string]$TerminalPath);$script:trustedPath=$TerminalPath};"
            "function Get-MT5VmTerminalProcessesBoundary {return @($script:rows)};"
            "function Start-MT5VmTerminalBoundary {"
            "param([string]$TerminalPath);$script:startCalls+=1;"
            "$script:startPath=$TerminalPath;[pscustomobject]@{Id=702}};"
            "function Wait-MT5VmTerminalProcessBoundary {"
            "param([string]$TerminalPath,[int]$ProcessId);"
            "[pscustomobject]@{ProcessId=$ProcessId;ExecutablePath=$TerminalPath}};"
            "function Close-MT5VmOwnedTerminalBoundary {"
            "param([int]$ProcessId);$script:closeCalls+=,$ProcessId};"
        )

    @staticmethod
    def _ui_boundaries(*, drop_commit: bool = False) -> str:
        drop = "$true" if drop_commit else "$false"
        return (
            "$script:persisted=[ordered]@{AllowAlgorithmicTrading=0;"
            "DisableExternalPythonApi=1;AllowDllImports=1;AllowWebRequest=1};"
            "$script:pending=$null;$script:dropCommit="
            + drop
            + ";$script:confirmCalls=0;$script:cancelCalls=0;"
            "$script:openedProcessIds=@();"
            "function Open-MT5VmOptionsDialogBoundary {"
            "param([int]$ProcessId);$script:openedProcessIds+=,$ProcessId;"
            "return [IntPtr]42};"
            "function Read-MT5VmPythonApiStateBoundary {"
            "param([IntPtr]$OptionsHandle);"
            "if($null -ne $script:pending){return [pscustomobject]$script:pending};"
            "return [pscustomobject]$script:persisted};"
            "function Write-MT5VmPythonApiStateBoundary {"
            "param([IntPtr]$OptionsHandle,[object]$State);"
            "$script:pending=[ordered]@{"
            "AllowAlgorithmicTrading=[int]$State.AllowAlgorithmicTrading;"
            "DisableExternalPythonApi=[int]$State.DisableExternalPythonApi;"
            "AllowDllImports=[int]$State.AllowDllImports;"
            "AllowWebRequest=[int]$State.AllowWebRequest}};"
            "function Confirm-MT5VmOptionsDialogBoundary {"
            "param([IntPtr]$OptionsHandle);$script:confirmCalls+=1;"
            "if(-not $script:dropCommit){$script:persisted=$script:pending};"
            "$script:pending=$null};"
            "function Cancel-MT5VmOptionsDialogBoundary {"
            "param([IntPtr]$OptionsHandle);$script:cancelCalls+=1;"
            "$script:pending=$null};"
        )

    @staticmethod
    def _webrequest_ui_boundaries(*, mismatch_apply: bool = False) -> str:
        mismatch = "$true" if mismatch_apply else "$false"
        return (
            "$script:persisted=[ordered]@{Enabled=0;Items=@('')};"
            "$script:pending=$null;$script:mismatchApply="
            + mismatch
            + ";$script:confirmCalls=0;$script:cancelCalls=0;"
            "$script:openCalls=0;$script:writeCalls=0;"
            "function Open-MT5VmOptionsDialogBoundary {"
            "param([int]$ProcessId);$script:openCalls+=1;[IntPtr]42};"
            "function Read-MT5VmWebRequestStateBoundary {"
            "param([IntPtr]$OptionsHandle);"
            "if($null -ne $script:pending){return [pscustomobject]$script:pending};"
            "return [pscustomobject]$script:persisted};"
            "function Write-MT5VmWebRequestStateBoundary {"
            "param([IntPtr]$OptionsHandle,[object]$State);$script:writeCalls+=1;"
            "$script:pending=[ordered]@{Enabled=[int]$State.Enabled;"
            "Items=@($State.Items)};return [IntPtr]99};"
            "function Confirm-MT5VmOptionsDialogWithActiveEditorBoundary {"
            "param([IntPtr]$OptionsHandle,[IntPtr]$EditorHandle,[int]$ProcessId);"
            "$script:confirmCalls+=1;"
            "if($script:mismatchApply -and $script:confirmCalls -eq 1){"
            "$script:persisted=[ordered]@{Enabled=1;"
            "Items=@('http://127.0.0.1:9999')}}else{"
            "$script:persisted=$script:pending};$script:pending=$null};"
            "function Confirm-MT5VmOptionsDialogBoundary {"
            "param([IntPtr]$OptionsHandle);$script:confirmCalls+=1;"
            "if($script:mismatchApply -and $script:confirmCalls -eq 1){"
            "$script:persisted=[ordered]@{Enabled=1;"
            "Items=@('http://127.0.0.1:9999')}}else{"
            "$script:persisted=$script:pending};$script:pending=$null};"
            "function Cancel-MT5VmOptionsDialogBoundary {"
            "param([IntPtr]$OptionsHandle);$script:cancelCalls+=1;"
            "$script:pending=$null};"
        )

    def _terminal_env(self, name: str = "Broker Alpha Unicode") -> dict[str, str]:
        return {
            "MT5_TEST_TERMINAL": rf"C:\Program Files\{name} Ω\terminal64.exe"
        }

    def test_reusable_sources_have_no_broker_profile_or_observed_process_literals(self) -> None:
        self.assertTrue(UI_HELPER.exists(), "generic UI helper must exist")
        self.assertTrue(BOOTSTRAP.exists(), "generic bootstrap entrypoint must exist")
        source = UI_HELPER.read_text(encoding="utf-8") + BOOTSTRAP.read_text(
            encoding="utf-8"
        )
        for forbidden in (
            "Exness",
            "FTMO",
            "53785E099C927DB68A545C249CDBCE06",
            "20016",
            r"C:\Program Files\MetaTrader 5\terminal64.exe",
            "common.ini",
        ):
            self.assertNotIn(forbidden.casefold(), source.casefold(), forbidden)
        self.assertIn("[Parameter(Mandatory = $true)]", source)
        self.assertIn("$TerminalPath", source)
        self.assertIn("$AccountAlias", source)

    def test_options_open_posts_modal_command_instead_of_blocking_send(self) -> None:
        body = (
            "$definition=(Get-Command Open-MT5VmOptionsDialogBoundary).Definition;"
            "[pscustomobject]@{posts=($definition -match '::PostMessage\\(');"
            "blocking=($definition -match '::SendMessage\\(')}|"
            "ConvertTo-Json -Compress"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertTrue(observed["posts"])
        self.assertFalse(observed["blocking"])

    def test_reusable_sources_have_no_force_termination_capability(self) -> None:
        self.assertTrue(UI_HELPER.exists(), "generic UI helper must exist")
        self.assertTrue(BOOTSTRAP.exists(), "generic bootstrap entrypoint must exist")
        source = UI_HELPER.read_text(encoding="utf-8") + BOOTSTRAP.read_text(
            encoding="utf-8"
        )
        for forbidden in (
            "Stop-Process",
            "taskkill",
            ".Kill(",
            "TerminateProcess",
            "Win32_Process).Terminate",
            "Win32_Process -MethodName Terminate",
        ):
            self.assertNotIn(forbidden.casefold(), source.casefold(), forbidden)

    def test_exact_canonical_path_selects_each_fictitious_broker(self) -> None:
        body = (
            "$script:rows=@("
            "[pscustomobject]@{ProcessId=101;ExecutablePath=$env:MT5_OTHER_TERMINAL},"
            "[pscustomobject]@{ProcessId=102;ExecutablePath=$env:MT5_TEST_TERMINAL});"
            "function Assert-MT5VmTrustedTerminalBoundary {param([string]$TerminalPath)};"
            "function Get-MT5VmTerminalProcessesBoundary {return @($script:rows)};"
            "$result=Resolve-MT5VmTerminalProcess -TerminalPath $env:MT5_TEST_TERMINAL;"
            "[pscustomobject]@{pid=$result.ProcessId;started=$result.WasStarted}|"
            "ConvertTo-Json -Compress"
        )
        for broker in ("Broker Alpha Unicode", "Broker Beta Retail"):
            env = self._terminal_env(broker)
            env["MT5_OTHER_TERMINAL"] = (
                rf"C:\Program Files\Other {broker}\terminal64.exe"
            )
            completed = self._run_module(body, extra_env=env)
            self.assertEqual(0, completed.returncode, completed.stderr)
            self.assertEqual({"pid": 102, "started": False}, json.loads(completed.stdout))

    def test_multiple_exact_path_processes_fail_closed(self) -> None:
        body = (
            "$script:rows=@("
            "[pscustomobject]@{ProcessId=201;ExecutablePath=$env:MT5_TEST_TERMINAL},"
            "[pscustomobject]@{ProcessId=202;ExecutablePath=$env:MT5_TEST_TERMINAL});"
            "function Assert-MT5VmTrustedTerminalBoundary {param([string]$TerminalPath)};"
            "function Get-MT5VmTerminalProcessesBoundary {return @($script:rows)};"
            "Resolve-MT5VmTerminalProcess -TerminalPath $env:MT5_TEST_TERMINAL"
        )
        completed = self._run_module(body, extra_env=self._terminal_env())
        self.assertNotEqual(0, completed.returncode)
        self.assertIn("multiple", completed.stderr.casefold())

    def test_invalid_signature_fails_before_process_start(self) -> None:
        body = (
            "$script:startCalls=0;"
            "function Assert-MT5VmTrustedTerminalBoundary {throw 'untrusted terminal'};"
            "function Get-MT5VmTerminalProcessesBoundary {return @()};"
            "function Start-MT5VmTerminalBoundary {$script:startCalls+=1};"
            "try {Resolve-MT5VmTerminalProcess -TerminalPath $env:MT5_TEST_TERMINAL}"
            "catch {[pscustomobject]@{caught=$_.Exception.Message;starts=$script:startCalls}|"
            "ConvertTo-Json -Compress;exit 0};exit 9"
        )
        completed = self._run_module(body, extra_env=self._terminal_env())
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertIn("untrusted", observed["caught"])
        self.assertEqual(0, observed["starts"])

    def test_zero_processes_starts_only_the_exact_supplied_path(self) -> None:
        body = (
            self._process_boundaries(started=True)
            + "$result=Resolve-MT5VmTerminalProcess -TerminalPath $env:MT5_TEST_TERMINAL;"
            "[pscustomobject]@{pid=$result.ProcessId;started=$result.WasStarted;"
            "start_calls=$script:startCalls;exact=([string]::Equals($script:startPath,"
            "$env:MT5_TEST_TERMINAL,[StringComparison]::OrdinalIgnoreCase))}|"
            "ConvertTo-Json -Compress"
        )
        completed = self._run_module(body, extra_env=self._terminal_env())
        self.assertEqual(0, completed.returncode, completed.stderr)
        self.assertEqual(
            {"pid": 702, "started": True, "start_calls": 1, "exact": True},
            json.loads(completed.stdout),
        )

    def test_settings_transaction_applies_and_rereads_exact_persisted_state(self) -> None:
        body = (
            self._ui_boundaries()
            + "$transaction=Set-MT5VmTerminalPythonApiSettings -ProcessId 701;"
            "[pscustomobject]@{prior=$transaction.PriorState;"
            "applied=$transaction.AppliedState;persisted=$script:persisted;"
            "confirms=$script:confirmCalls;cancels=$script:cancelCalls}|"
            "ConvertTo-Json -Compress -Depth 6"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual(
            {
                "AllowAlgorithmicTrading": 0,
                "DisableExternalPythonApi": 1,
                "AllowDllImports": 1,
                "AllowWebRequest": 1,
            },
            observed["prior"],
        )
        desired = {
            "AllowAlgorithmicTrading": 1,
            "DisableExternalPythonApi": 0,
            "AllowDllImports": 0,
            "AllowWebRequest": 0,
        }
        self.assertEqual(desired, observed["applied"])
        self.assertEqual(desired, observed["persisted"])
        self.assertEqual(1, observed["confirms"])
        self.assertGreaterEqual(observed["cancels"], 1)

    def test_webrequest_allowlist_entrypoint_is_exact_and_forbids_unsafe_ui(self) -> None:
        self.assertTrue(ALLOWLIST.exists(), "production allowlist entrypoint is missing")
        source = ALLOWLIST.read_text(encoding="utf-8")
        combined = source + UI_HELPER.read_text(encoding="utf-8")
        self.assertIn(r"C:\Program Files\MetaTrader 5\terminal64.exe", source)
        self.assertIn(
            r"C:\Users\Duong\AppData\Roaming\MetaQuotes\Terminal"
            r"\D0E8209F77C8CF37AD8BF550E51FF075",
            source,
        )
        self.assertIn(
            "CN=MetaQuotes Ltd., O=MetaQuotes Ltd., S=Lemesos, C=CY", source
        )
        self.assertIn("$expectedOrigin = 'http://127.0.0.1'", source)
        self.assertIn("[switch]$CommitRollbackTrace", source)
        self.assertIn("PRODUCTION_WEBREQUEST_ALLOWLIST_COMMIT_ROLLBACK=PASS", source)
        self.assertNotIn("$expectedOrigin = 'http://127.0.0.1:8790'", source)
        self.assertIn("Invoke-MT5WebRequestProbe.ps1", source)
        for required in (
            "$uiHelper",
            "Invoke-ProductionPersistedPreflight",
            "Invoke-ProductionCommitRollbackTrace",
            "Get-ProductionLoopbackPortProxyState",
            "Assert-ProductionLoopbackPortProxyState",
            "Ensure-ProductionLoopbackPortProxy",
            "Remove-ProductionOwnedLoopbackPortProxy",
            "Assert-ProductionForwardedGatewayHealth",
            "Set-MT5VmTerminalWebRequestAllowlist",
            "netsh.exe",
            "listenaddress=127.0.0.1",
            "listenport=80",
            "connectaddress=127.0.0.1",
            "connectport=8790",
        ):
            self.assertIn(required, source, required)
        self.assertNotIn("$TerminalPath", source)
        self.assertNotIn("$Origin", source)
        self.assertNotIn("Read-ProductionWebRequestCommonIni", source)
        self.assertNotIn("Convert-ProductionWebRequestCommonIni", source)
        self.assertNotIn("[IO.File]::Replace", source)
        self.assertLess(
            source.rfind("Invoke-ProductionPersistedPreflight"),
            source.rfind("Ensure-ProductionLoopbackPortProxy"),
        )
        self.assertLess(
            source.rfind("Ensure-ProductionLoopbackPortProxy"),
            source.rfind("Set-MT5VmTerminalWebRequestAllowlist"),
        )
        for forbidden in (
            "SendKeys",
            "Clipboard",
            "Set-Clipboard",
            "mouse_event",
            "WindowTitle",
            "Stop-Process",
            "taskkill",
            "OrderSend(",
            "AccountInfo",
        ):
            self.assertNotIn(forbidden.casefold(), combined.casefold(), forbidden)

        positive = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(ALLOWLIST),
                "-ContractTestsOnly",
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
        negative = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(ALLOWLIST),
                "-ContractTestsOnly",
                "-KnownBadControl",
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
        unreadable = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(ALLOWLIST),
                "-ContractTestsOnly",
                "-UnreadableInputControl",
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
        occupied = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(ALLOWLIST),
                "-ContractTestsOnly",
                "-OccupiedPortControl",
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
        wrong_hit = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(ALLOWLIST),
                "-ContractTestsOnly",
                "-MouseHitControl",
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
        cursor_restore = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(ALLOWLIST),
                "-ContractTestsOnly",
                "-CursorRestoreControl",
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
        self.assertEqual(0, positive.returncode, positive.stderr)
        self.assertIn("PRODUCTION_WEBREQUEST_ALLOWLIST_CONTRACTS=PASS", positive.stdout)
        self.assertIn(
            "PRODUCTION_WEBREQUEST_ALLOWLIST_PORTPROXY_CONTRACTS=PASS",
            positive.stdout,
        )
        self.assertIn(
            "PRODUCTION_WEBREQUEST_ALLOWLIST_ROLLBACK_CONTRACTS=PASS",
            positive.stdout,
        )
        self.assertIn(
            "PRODUCTION_WEBREQUEST_ALLOWLIST_PREFLIGHT_CONTRACTS=PASS",
            positive.stdout,
        )
        self.assertNotEqual(0, negative.returncode)
        self.assertIn(
            "PROVISIONING_WEBREQUEST_PORTPROXY_STATE_INVALID",
            negative.stdout + negative.stderr,
        )
        self.assertNotEqual(0, unreadable.returncode)
        self.assertIn(
            "PROVISIONING_WEBREQUEST_PORTPROXY_OUTPUT_INVALID",
            unreadable.stdout + unreadable.stderr,
        )
        self.assertNotEqual(0, occupied.returncode)
        self.assertIn(
            "PROVISIONING_WEBREQUEST_PORT80_OCCUPIED",
            occupied.stdout + occupied.stderr,
        )
        self.assertNotEqual(0, wrong_hit.returncode)
        self.assertIn(
            "PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID",
            wrong_hit.stdout + wrong_hit.stderr,
        )
        self.assertNotEqual(0, cursor_restore.returncode)
        self.assertIn(
            "PROVISIONING_WEBREQUEST_ALLOWLIST_CURSOR_RESTORE_FAILED",
            cursor_restore.stdout + cursor_restore.stderr,
        )

    def test_webrequest_allowlist_transaction_applies_once_and_is_idempotent(self) -> None:
        body = (
            self._webrequest_ui_boundaries()
            + "$first=Set-MT5VmTerminalWebRequestAllowlist -ProcessId 701 "
            "-Origin 'http://127.0.0.1:8790';"
            "$second=Set-MT5VmTerminalWebRequestAllowlist -ProcessId 701 "
            "-Origin 'http://127.0.0.1:8790';"
            "$nonempty=@($script:persisted.Items|Where-Object{$_ -ne ''});"
            "[pscustomobject]@{first=$first;second=$second;enabled=$script:persisted.Enabled;"
            "nonempty_count=$nonempty.Count;exact=($nonempty[0] -ceq "
            "'http://127.0.0.1:8790');confirms=$script:confirmCalls;"
            "writes=$script:writeCalls;opens=$script:openCalls;cancels=$script:cancelCalls}|"
            "ConvertTo-Json -Compress -Depth 5"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual(1, observed["enabled"])
        self.assertEqual(1, observed["nonempty_count"])
        self.assertTrue(observed["exact"])
        self.assertEqual(1, observed["confirms"])
        self.assertEqual(1, observed["writes"])
        self.assertEqual(3, observed["opens"])
        self.assertGreaterEqual(observed["cancels"], 2)
        self.assertEqual("APPLIED", observed["first"]["status"])
        self.assertEqual("UNCHANGED", observed["second"]["status"])
        for result in (observed["first"], observed["second"]):
            self.assertNotIn("Items", result)
            self.assertNotIn("Origin", result)

    def test_webrequest_confirm_then_reopen_precedes_persisted_proof(self) -> None:
        source = UI_HELPER.read_text(encoding="utf-8")
        apply_start = source.index("function Invoke-MT5VmWebRequestEditorApplyBoundary")
        apply_end = source.index("function Read-MT5VmWebRequestStateBoundary")
        apply_source = source[apply_start:apply_end]
        self.assertIn("Invoke-MT5VmGuardedExactVirtualKeyStageBoundary", apply_source)
        self.assertNotIn("Invoke-MT5VmGuardedExactVirtualKeyInputBoundary", apply_source)
        self.assertNotIn("IsWindowVisible($editor)", apply_source)

        set_start = source.index("function Set-MT5VmTerminalWebRequestAllowlist")
        set_source = source[set_start:]
        write_at = set_source.index("Write-MT5VmWebRequestStateBoundary")
        confirm_at = set_source.index(
            "Confirm-MT5VmOptionsDialogWithActiveEditorBoundary", write_at
        )
        reopen_at = set_source.index("Open-MT5VmOptionsDialogBoundary", confirm_at)
        persisted_at = set_source.index("Read-MT5VmWebRequestStateBoundary", reopen_at)
        self.assertLess(write_at, confirm_at)
        self.assertLess(confirm_at, reopen_at)
        self.assertLess(reopen_at, persisted_at)
        self.assertNotIn("$pending = Read-MT5VmWebRequestStateBoundary", set_source)

    def test_webrequest_physical_ok_confirm_is_guarded_and_ordered(self) -> None:
        source = UI_HELPER.read_text(encoding="utf-8")
        for required in (
            "Assert-MT5VmOptionsOkCandidate",
            "Assert-MT5VmOptionsOkPointIdentity",
            "New-MT5VmExactSingleClickInputPlan",
            "Invoke-MT5VmGuardedOptionsOkClickCore",
            "Confirm-MT5VmOptionsDialogWithActiveEditorBoundary",
        ):
            self.assertIn(required, source, required)
        set_start = source.index("function Set-MT5VmTerminalWebRequestAllowlist {")
        set_end = source.index("function Restore-MT5VmTerminalPythonApiSettings {", set_start)
        set_source = source[set_start:set_end]
        write_at = set_source.index("Write-MT5VmWebRequestStateBoundary")
        confirm_at = set_source.index(
            "Confirm-MT5VmOptionsDialogWithActiveEditorBoundary"
        )
        reopen_at = set_source.index("Open-MT5VmOptionsDialogBoundary", confirm_at)
        persisted_at = set_source.index(
            "$persisted = Read-MT5VmWebRequestStateBoundary", reopen_at
        )
        self.assertLess(write_at, confirm_at)
        self.assertLess(confirm_at, reopen_at)
        self.assertLess(reopen_at, persisted_at)
        self.assertNotIn(
            "Confirm-MT5VmOptionsDialogBoundary -OptionsHandle $activeDialog",
            set_source[:reopen_at],
        )

        body = (
            "$events=[Collections.Generic.List[string]]::new();"
            "$result=Invoke-MT5VmGuardedOptionsOkClickCore "
            "-ResolveAction {$events.Add('resolve');[IntPtr]43} "
            "-GeometryAction {param($button);$events.Add('geometry');"
            "[pscustomobject]@{x=10;y=20}} "
            "-CaptureCursorAction {$events.Add('capture');[pscustomobject]@{x=1;y=2}} "
            "-MoveAction {param($point);$events.Add('move');$true} "
            "-GuardAction {param($button,$point);$events.Add('guard');$true} "
            "-ClickAction {param($plan);$events.Add('click');$plan.Count} "
            "-WaitAction {$events.Add('wait');$true} "
            "-RestoreCursorAction {param($cursor);$events.Add('restore');$true};"
            "[pscustomobject]@{result=[bool]$result;events=$events}|"
            "ConvertTo-Json -Compress"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertTrue(observed["result"])
        self.assertEqual(
            ["resolve", "geometry", "capture", "move", "guard", "click", "wait", "restore"],
            observed["events"],
        )

    def test_webrequest_physical_ok_confirm_fails_closed_and_restores_cursor(self) -> None:
        for mode, expected_code, expected_events in (
            (
                "guard",
                "PROVISIONING_WEBREQUEST_ALLOWLIST_OK_MOUSE_INVALID",
                ["resolve", "geometry", "capture", "move", "guard", "restore"],
            ),
            (
                "partial_click",
                "PROVISIONING_WEBREQUEST_ALLOWLIST_OK_MOUSE_INVALID",
                ["resolve", "geometry", "capture", "move", "guard", "click", "restore"],
            ),
            (
                "wait",
                "PROVISIONING_WEBREQUEST_ALLOWLIST_OK_MOUSE_INVALID",
                ["resolve", "geometry", "capture", "move", "guard", "click", "wait", "restore"],
            ),
            (
                "restore",
                "PROVISIONING_WEBREQUEST_ALLOWLIST_CURSOR_RESTORE_FAILED",
                ["resolve", "geometry", "capture", "move", "guard", "click", "wait", "restore"],
            ),
        ):
            body = (
                f"$mode='{mode}';$events=[Collections.Generic.List[string]]::new();"
                "try{Invoke-MT5VmGuardedOptionsOkClickCore "
                "-ResolveAction {$events.Add('resolve');[IntPtr]43} "
                "-GeometryAction {param($button);$events.Add('geometry');"
                "[pscustomobject]@{x=10;y=20}} "
                "-CaptureCursorAction {$events.Add('capture');[pscustomobject]@{x=1;y=2}} "
                "-MoveAction {param($point);$events.Add('move');$true} "
                "-GuardAction {param($button,$point);$events.Add('guard');$mode -ne 'guard'} "
                "-ClickAction {param($plan);$events.Add('click');"
                "if($mode -eq 'partial_click'){1}else{$plan.Count}} "
                "-WaitAction {$events.Add('wait');$mode -ne 'wait'} "
                "-RestoreCursorAction {param($cursor);$events.Add('restore');"
                "$mode -ne 'restore'}|Out-Null;"
                "$result='FAILED_OPEN'}catch{$result=$_.Exception.Message};"
                "[pscustomobject]@{result=$result;events=$events}|ConvertTo-Json -Compress"
            )
            completed = self._run_module(body)
            self.assertEqual(0, completed.returncode, completed.stderr)
            observed = json.loads(completed.stdout)
            self.assertEqual(expected_code, observed["result"])
            self.assertEqual(expected_events, observed["events"])

    def test_webrequest_physical_ok_identity_point_and_click_plan_are_exact(self) -> None:
        body = (
            "$ok=Assert-MT5VmOptionsOkCandidate -ExpectedControlId 1 "
            "-ObservedControlId 1 -CandidateCount 1 -WindowClass 'Button' "
            "-Visible $true -Enabled $true -ExpectedProcessId 700 "
            "-OptionsProcessId 700 -ButtonProcessId 700 -EditorProcessId 700;"
            "$point=Assert-MT5VmOptionsOkPointIdentity "
            "-ExpectedButtonHandle ([IntPtr]43) -ObservedPointHandle ([IntPtr]43);"
            "$plan=@(New-MT5VmExactSingleClickInputPlan);"
            "$errors=@();foreach($action in @({Assert-MT5VmOptionsOkCandidate "
            "-ExpectedControlId 1 "
            "-ObservedControlId 1 -CandidateCount 1 -WindowClass 'Button' "
            "-Visible $true -Enabled $true -ExpectedProcessId 700 "
            "-OptionsProcessId 700 -ButtonProcessId 701 -EditorProcessId 700},"
            "{Assert-MT5VmOptionsOkPointIdentity "
            "-ExpectedButtonHandle ([IntPtr]43) -ObservedPointHandle ([IntPtr]44)}"
            ")){try{&$action|Out-Null;$errors+=,'FAILED_OPEN'}"
            "catch{$errors+=,$_.Exception.Message}};"
            "[pscustomobject]@{ok=[bool]$ok;point=[bool]$point;"
            "flags=@($plan|ForEach-Object{[long]$_.Flags});errors=$errors}|"
            "ConvertTo-Json -Compress -Depth 5"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertTrue(observed["ok"])
        self.assertTrue(observed["point"])
        self.assertEqual([2, 4], observed["flags"])
        self.assertEqual(
            [
                "PROVISIONING_WEBREQUEST_ALLOWLIST_OK_MOUSE_INVALID",
                "PROVISIONING_WEBREQUEST_ALLOWLIST_OK_MOUSE_INVALID",
            ],
            observed["errors"],
        )

    def test_webrequest_restore_does_not_insert_the_add_row_placeholder(self) -> None:
        source = UI_HELPER.read_text(encoding="utf-8")
        start = source.index("function Write-MT5VmWebRequestStateBoundary {")
        end = source.index("function Restore-MT5VmTerminalWebRequestState {", start)
        write_source = source[start:end]
        self.assertIn("[string[]]@($targetNonEmpty)", write_source)
        self.assertNotIn("[string[]]@($target.Items)", write_source)
        restore_end = source.index(
            "function Set-MT5VmTerminalWebRequestAllowlist {", end
        )
        restore_source = source[end:restore_end]
        self.assertNotIn("$pending = Read-MT5VmWebRequestStateBoundary", restore_source)
        confirm_at = restore_source.index("Confirm-MT5VmOptionsDialogBoundary")
        reopen_at = restore_source.index("Open-MT5VmOptionsDialogBoundary", confirm_at)
        persisted_at = restore_source.index(
            "$persisted = Read-MT5VmWebRequestStateBoundary", reopen_at
        )
        self.assertLess(confirm_at, reopen_at)
        self.assertLess(reopen_at, persisted_at)

    def test_webrequest_restore_removes_backing_url_through_list_delete(self) -> None:
        source = UI_HELPER.read_text(encoding="utf-8")
        self.assertIn("VirtualKeyDelete = 0x2E", source)
        self.assertIn("function Remove-MT5VmWebRequestItemsBoundary {", source)
        self.assertIn("Select-MT5VmWebRequestListItemBoundary", source)
        write_start = source.index("function Write-MT5VmWebRequestStateBoundary {")
        write_end = source.index("function Restore-MT5VmTerminalWebRequestState {", write_start)
        self.assertIn("Remove-MT5VmWebRequestItemsBoundary", source[write_start:write_end])

        body = (
            "$readOriginal=(Get-Command Read-MT5VmWebRequestStateBoundary).ScriptBlock;"
            "$selectOriginal=(Get-Command Select-MT5VmWebRequestListItemBoundary).ScriptBlock;"
            "$messageOriginal=(Get-Command Invoke-MT5VmBoundedUiMessage).ScriptBlock;"
            "$script:events=@();$script:reads=0;"
            "function Read-MT5VmWebRequestStateBoundary {param([IntPtr]$OptionsHandle);"
            "$script:events+=,'read';$script:reads++;if($script:reads -eq 1){"
            "return [pscustomobject]@{Enabled=1;Items=@('','')}};"
            "return [pscustomobject]@{Enabled=1;Items=@('')}};"
            "function Select-MT5VmWebRequestListItemBoundary {"
            "param([IntPtr]$ListHandle,[int]$ItemIndex);"
            "$script:events+=,('select:'+$ItemIndex);return $true};"
            "function Invoke-MT5VmBoundedUiMessage {"
            "param([IntPtr]$Handle,[uint32]$Message,[IntPtr]$WParam,[IntPtr]$LParam);"
            "$script:events+=,('message:'+$Message+':'+$WParam.ToInt64());"
            "return [IntPtr]::Zero};"
            "try{$ok=[bool](Remove-MT5VmWebRequestItemsBoundary "
            "-OptionsHandle ([IntPtr]41) -ListHandle ([IntPtr]42))}finally{"
            "Set-Item Function:Read-MT5VmWebRequestStateBoundary -Value $readOriginal;"
            "Set-Item Function:Select-MT5VmWebRequestListItemBoundary -Value $selectOriginal;"
            "Set-Item Function:Invoke-MT5VmBoundedUiMessage -Value $messageOriginal};"
            "[pscustomobject]@{ok=$ok;events=$script:events}|ConvertTo-Json -Compress"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertTrue(observed["ok"])
        self.assertEqual(
            ["read", "select:0", "message:256:46", "message:257:46", "read"],
            observed["events"],
        )

    def test_webrequest_allowlist_mismatch_restores_snapshot_before_rethrow(self) -> None:
        body = (
            self._webrequest_ui_boundaries(mismatch_apply=True)
            + "try{Set-MT5VmTerminalWebRequestAllowlist -ProcessId 701 "
            "-Origin 'http://127.0.0.1:8790'|Out-Null;exit 9}catch{"
            "[pscustomobject]@{caught=$_.Exception.Message;enabled=$script:persisted.Enabled;"
            "items=@($script:persisted.Items);confirms=$script:confirmCalls;"
            "writes=$script:writeCalls;cancels=$script:cancelCalls}|"
            "ConvertTo-Json -Compress -Depth 4;exit 0}"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertIn("PROVISIONING_WEBREQUEST_ALLOWLIST_PERSIST_FAILED", observed["caught"])
        self.assertEqual(0, observed["enabled"])
        self.assertEqual([""], observed["items"])
        self.assertEqual(2, observed["confirms"])
        self.assertEqual(2, observed["writes"])
        self.assertGreaterEqual(observed["cancels"], 2)

    def test_webrequest_allowlist_rollback_failure_is_authoritative(self) -> None:
        body = (
            self._webrequest_ui_boundaries(mismatch_apply=True)
            + "function Write-MT5VmWebRequestStateBoundary {"
            "param([IntPtr]$OptionsHandle,[object]$State);$script:writeCalls+=1;"
            "$script:pending=[ordered]@{Enabled=1;Items=@('http://127.0.0.1:9999')}};"
            "try{Set-MT5VmTerminalWebRequestAllowlist -ProcessId 701 "
            "-Origin 'http://127.0.0.1:8790'|Out-Null;exit 9}catch{"
            "[pscustomobject]@{caught=$_.Exception.Message;confirms=$script:confirmCalls;"
            "writes=$script:writeCalls}|ConvertTo-Json -Compress;exit 0}"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertIn(
            "PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED", observed["caught"]
        )
        self.assertGreaterEqual(observed["writes"], 2)

    def test_webrequest_state_rejects_hostile_counts_lengths_and_duplicates(self) -> None:
        body = (
            "$errors=@();"
            "$cases=@("
            "[pscustomobject]@{Enabled=1;Items=@(1..65|ForEach-Object{'x'+$_})},"
            "[pscustomobject]@{Enabled=1;Items=@(('x').PadRight(2049,'x'))},"
            "[pscustomobject]@{Enabled=1;Items=@('http://127.0.0.1:8790',"
            "'http://127.0.0.1:8790')});"
            "foreach($state in $cases){try{"
            "Assert-MT5VmDesiredWebRequestState -State $state "
            "-ExpectedOrigin 'http://127.0.0.1:8790';$errors+=,'FAILED_OPEN'"
            "}catch{$errors+=,$_.Exception.Message}};"
            "$errors|ConvertTo-Json -Compress"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual(3, len(observed))
        for error in observed:
            self.assertIn("PROVISIONING_WEBREQUEST_ALLOWLIST_STATE_INVALID", error)

    def test_webrequest_activation_geometry_is_exact_and_fail_closed(self) -> None:
        source = UI_HELPER.read_text(encoding="utf-8")
        for required in (
            "LvmGetItemRect",
            "LvmHitTest",
            "WmLButtonDoubleClick",
            "WebRequestEditor",
            "Get-MT5VmWebRequestEditorBoundary",
            "PROVISIONING_WEBREQUEST_ALLOWLIST_HIT_INVALID",
        ):
            self.assertIn(required, source)
        geometry_start = source.index("function Get-MT5VmListActivationGeometryBoundary")
        geometry_end = source.index("function Assert-MT5VmMouseActivationSequence")
        geometry_source = source[geometry_start:geometry_end]
        self.assertNotIn("sendinput", geometry_source.casefold())
        for required in (
            "GetCursorPos",
            "SetCursorPos",
            "ClientToScreen",
            "WindowFromPoint",
            "GetSystemMetrics",
            "SendMouseInput",
            "Invoke-MT5VmGuardedPhysicalMouseActivationBoundary",
            "Invoke-MT5VmPhysicalMouseActivationTransactionCore",
        ):
            self.assertIn(required, source, required)
        self.assertNotIn("mouse_event", source.casefold())
        apply_start = source.index("function Invoke-MT5VmWebRequestEditorApplyBoundary")
        apply_end = source.index("function Read-MT5VmWebRequestStateBoundary")
        apply_source = source[apply_start:apply_end]
        self.assertIn("Invoke-MT5VmPhysicalMouseActivationTransactionCore", apply_source)
        self.assertIn("Invoke-MT5VmGuardedPhysicalMouseActivationBoundary", apply_source)
        self.assertNotIn("Invoke-MT5VmMouseActivationSequenceBoundary", apply_source)

        body = (
            "$c=Get-MT5VmTerminalUiConstants;"
            "$ok=Assert-MT5VmListActivationGeometry -Left 0 -Top 0 -Right 100 "
            "-Bottom 20 -HitX 50 -HitY 10 -HitIndex 0 -HitFlags $c.LvhtOnItemLabel;"
            "$cases=@("
            "@{Left=0;Top=0;Right=100;Bottom=20;HitX=50;HitY=10;HitIndex=1;"
            "HitFlags=$c.LvhtOnItemLabel},"
            "@{Left=0;Top=0;Right=100;Bottom=20;HitX=101;HitY=10;HitIndex=0;"
            "HitFlags=$c.LvhtOnItemLabel},"
            "@{Left=0;Top=0;Right=100;Bottom=20;HitX=50;HitY=10;HitIndex=0;"
            "HitFlags=0},"
            "@{Left=0;Top=0;Right=0;Bottom=20;HitX=0;HitY=10;HitIndex=0;"
            "HitFlags=$c.LvhtOnItemLabel},"
            "@{Left=-1;Top=0;Right=100;Bottom=20;HitX=49;HitY=10;HitIndex=0;"
            "HitFlags=$c.LvhtOnItemLabel});"
            "$errors=@();foreach($case in $cases){try{"
            "Assert-MT5VmListActivationGeometry @case|Out-Null;$errors+=,'FAILED_OPEN'"
            "}catch{$errors+=,$_.Exception.Message}};"
            "[pscustomobject]@{constants=[pscustomobject]@{rect=$c.LvmGetItemRect;"
            "hit=$c.LvmHitTest;double_click=$c.WmLButtonDoubleClick;"
            "editor=$c.WebRequestEditor};ok=$ok;errors=$errors}|"
            "ConvertTo-Json -Compress -Depth 5"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual(
            {"rect": 0x100E, "hit": 0x1012, "double_click": 0x0203, "editor": 10325},
            observed["constants"],
        )
        self.assertEqual({"x": 50, "y": 10}, observed["ok"])
        self.assertEqual(5, len(observed["errors"]))
        for error in observed["errors"]:
            self.assertIn("PROVISIONING_WEBREQUEST_ALLOWLIST_HIT_INVALID", error)

    def test_webrequest_icon_geometry_requires_icon_rectangle_and_hit(self) -> None:
        source = UI_HELPER.read_text(encoding="utf-8")
        for required in (
            "LvirIcon",
            "LvhtOnItemIcon",
            "GetClientRect",
            "Assert-MT5VmIconActivationGeometry",
            "rectangle.left = rectangleKind",
        ):
            self.assertIn(required, source)

        body = (
            "$c=Get-MT5VmTerminalUiConstants;"
            "$ok=Assert-MT5VmIconActivationGeometry -RectangleKind $c.LvirIcon "
            "-ClientWidth 536 -ClientHeight 120 -Left 4 -Top 0 -Right 22 "
            "-Bottom 20 -HitX 13 -HitY 10 -HitIndex 0 "
            "-HitFlags $c.LvhtOnItemIcon;"
            "$cases=@("
            "@{RectangleKind=0;ClientWidth=536;ClientHeight=120;"
            "Left=4;Top=0;Right=22;Bottom=20;HitX=13;HitY=10;HitIndex=0;"
            "HitFlags=$c.LvhtOnItemIcon},"
            "@{RectangleKind=$c.LvirIcon;ClientWidth=536;ClientHeight=120;"
            "Left=4;Top=0;Right=22;Bottom=20;HitX=13;HitY=10;HitIndex=0;"
            "HitFlags=$c.LvhtOnItemLabel},"
            "@{RectangleKind=$c.LvirIcon;ClientWidth=536;ClientHeight=120;"
            "Left=4;Top=0;Right=22;Bottom=20;HitX=13;HitY=10;HitIndex=1;"
            "HitFlags=$c.LvhtOnItemIcon},"
            "@{RectangleKind=$c.LvirIcon;ClientWidth=536;ClientHeight=120;"
            "Left=4;Top=0;Right=4;Bottom=20;HitX=4;HitY=10;HitIndex=0;"
            "HitFlags=$c.LvhtOnItemIcon},"
            "@{RectangleKind=$c.LvirIcon;ClientWidth=21;ClientHeight=120;"
            "Left=4;Top=0;Right=22;Bottom=20;HitX=13;HitY=10;HitIndex=0;"
            "HitFlags=$c.LvhtOnItemIcon});"
            "$errors=@();foreach($case in $cases){try{"
            "Assert-MT5VmIconActivationGeometry @case|Out-Null;"
            "$errors+=,'FAILED_OPEN'}catch{$errors+=,$_.Exception.Message}};"
            "[pscustomobject]@{constants=[pscustomobject]@{"
            "icon_rect=$c.LvirIcon;icon_hit=$c.LvhtOnItemIcon};"
            "ok=$ok;errors=$errors}|ConvertTo-Json -Compress -Depth 5"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual(
            {"icon_rect": 1, "icon_hit": 0x0002}, observed["constants"]
        )
        self.assertEqual({"x": 13, "y": 10}, observed["ok"])
        self.assertEqual(5, len(observed["errors"]))
        for error in observed["errors"]:
            self.assertIn("PROVISIONING_WEBREQUEST_ALLOWLIST_HIT_INVALID", error)

    def test_webrequest_add_editor_identity_is_exact_and_fail_closed(self) -> None:
        source = UI_HELPER.read_text(encoding="utf-8")
        for required in (
            "WebRequestAddEditor",
            "Assert-MT5VmWebRequestEditorCandidate",
            "$constants.WebRequestAddEditor",
        ):
            self.assertIn(required, source)

        body = (
            "$c=Get-MT5VmTerminalUiConstants;"
            "$ok=Assert-MT5VmWebRequestEditorCandidate "
            "-ExpectedControlId $c.WebRequestAddEditor -ObservedControlId 32954 "
            "-CandidateCount 1 -WindowClass 'Edit' -Visible $true -Enabled $true "
            "-ExpectedProcessId 700 -ObservedProcessId 700;"
            "$cases=@("
            "@{ExpectedControlId=$c.WebRequestAddEditor;ObservedControlId=10325;"
            "CandidateCount=1;WindowClass='Edit';Visible=$true;Enabled=$true;"
            "ExpectedProcessId=700;ObservedProcessId=700},"
            "@{ExpectedControlId=$c.WebRequestAddEditor;ObservedControlId=32954;"
            "CandidateCount=0;WindowClass='';Visible=$false;Enabled=$false;"
            "ExpectedProcessId=700;ObservedProcessId=700},"
            "@{ExpectedControlId=$c.WebRequestAddEditor;ObservedControlId=32954;"
            "CandidateCount=2;WindowClass='Edit';Visible=$true;Enabled=$true;"
            "ExpectedProcessId=700;ObservedProcessId=700},"
            "@{ExpectedControlId=$c.WebRequestAddEditor;ObservedControlId=32954;"
            "CandidateCount=1;WindowClass='Static';Visible=$true;Enabled=$true;"
            "ExpectedProcessId=700;ObservedProcessId=700},"
            "@{ExpectedControlId=$c.WebRequestAddEditor;ObservedControlId=32954;"
            "CandidateCount=1;WindowClass='Edit';Visible=$false;Enabled=$true;"
            "ExpectedProcessId=700;ObservedProcessId=700},"
            "@{ExpectedControlId=$c.WebRequestAddEditor;ObservedControlId=32954;"
            "CandidateCount=1;WindowClass='Edit';Visible=$true;Enabled=$false;"
            "ExpectedProcessId=700;ObservedProcessId=700},"
            "@{ExpectedControlId=$c.WebRequestAddEditor;ObservedControlId=32954;"
            "CandidateCount=1;WindowClass='Edit';Visible=$true;Enabled=$true;"
            "ExpectedProcessId=700;ObservedProcessId=701});"
            "$errors=@();foreach($case in $cases){try{"
            "Assert-MT5VmWebRequestEditorCandidate @case|Out-Null;"
            "$errors+=,'FAILED_OPEN'}catch{$errors+=,$_.Exception.Message}};"
            "[pscustomobject]@{constants=[pscustomobject]@{"
            "legacy=$c.WebRequestEditor;add_editor=$c.WebRequestAddEditor};"
            "ok=$ok;errors=$errors}|ConvertTo-Json -Compress -Depth 5"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual(
            {"legacy": 10325, "add_editor": 32954}, observed["constants"]
        )
        self.assertTrue(observed["ok"])
        self.assertEqual(7, len(observed["errors"]))
        for error in observed["errors"]:
            self.assertIn("PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID", error)

    def test_webrequest_editor_commit_sequence_requires_return_character(self) -> None:
        source = UI_HELPER.read_text(encoding="utf-8")
        for required in (
            "WmChar",
            "VirtualKeyReturn",
            "Assert-MT5VmEditorCommitSequence",
        ):
            self.assertIn(required, source)

        body = (
            "$c=Get-MT5VmTerminalUiConstants;"
            "$messages=[uint32[]]@($c.WmKeyDown,$c.WmChar,$c.WmKeyUp);"
            "$parameters=[long[]]@($c.VirtualKeyReturn,$c.VirtualKeyReturn,"
            "$c.VirtualKeyReturn);"
            "$ok=Assert-MT5VmEditorCommitSequence -Messages $messages "
            "-WParams $parameters;"
            "$cases=@("
            "@{Messages=@($messages[0..1]);WParams=@($parameters[0..1])},"
            "@{Messages=@($messages[1],$messages[0],$messages[2]);"
            "WParams=$parameters},"
            "@{Messages=@($messages+$c.WmKeyUp);"
            "WParams=@($parameters+$c.VirtualKeyReturn)},"
            "@{Messages=@($c.WmKeyDown,0x0103,$c.WmKeyUp);WParams=$parameters},"
            "@{Messages=$messages;WParams=@($c.VirtualKeyReturn,0,"
            "$c.VirtualKeyReturn)});"
            "$errors=@();foreach($case in $cases){try{"
            "Assert-MT5VmEditorCommitSequence @case|Out-Null;"
            "$errors+=,'FAILED_OPEN'}catch{$errors+=,$_.Exception.Message}};"
            "[pscustomobject]@{constants=[pscustomobject]@{char=$c.WmChar;"
            "return_key=$c.VirtualKeyReturn};ok=$ok;errors=$errors}|"
            "ConvertTo-Json -Compress -Depth 5"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual({"char": 0x0102, "return_key": 0x0D}, observed["constants"])
        self.assertTrue(observed["ok"])
        self.assertEqual(5, len(observed["errors"]))
        for error in observed["errors"]:
            self.assertIn("PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID", error)

    def test_webrequest_editor_commit_boundary_sends_exact_sequence(self) -> None:
        body = (
            "$original=(Get-Command Invoke-MT5VmBoundedUiMessage).ScriptBlock;"
            "$script:calls=@();function Invoke-MT5VmBoundedUiMessage {"
            "param([IntPtr]$Handle,[uint32]$Message,[IntPtr]$WParam,[IntPtr]$LParam);"
            "$script:calls+=,[pscustomobject]@{handle=$Handle.ToInt64();"
            "message=[long]$Message;wparam=$WParam.ToInt64();"
            "lparam=$LParam.ToInt64()};[IntPtr]::Zero};"
            "try{$ok=[bool](Invoke-MT5VmEditorCommitSequenceBoundary "
            "-EditorHandle ([IntPtr]42))}finally{"
            "Set-Item -Path Function:Invoke-MT5VmBoundedUiMessage -Value $original};"
            "[pscustomobject]@{ok=$ok;calls=$script:calls}|"
            "ConvertTo-Json -Compress -Depth 5"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertTrue(observed["ok"])
        self.assertEqual(
            [
                {"handle": 42, "message": 0x0100, "wparam": 0x0D, "lparam": 0},
                {"handle": 42, "message": 0x0102, "wparam": 0x0D, "lparam": 0},
                {"handle": 42, "message": 0x0101, "wparam": 0x0D, "lparam": 0},
            ],
            observed["calls"],
        )

    def test_webrequest_origin_character_stream_is_exact(self) -> None:
        source = UI_HELPER.read_text(encoding="utf-8")
        for required in (
            "WmGetText",
            "WmGetTextLength",
            "ReadBoundedText",
            "Assert-MT5VmExactOriginCharacterStream",
        ):
            self.assertIn(required, source)

        body = (
            "$origin='http://127.0.0.1:8790';"
            "$codes=[long[]]@($origin.ToCharArray()|ForEach-Object{[int]$_});"
            "$ok=Assert-MT5VmExactOriginCharacterStream -Origin $origin "
            "-CharacterCodes $codes -ExpectedOrigin $origin;"
            "$missing=[long[]]@($codes[0..($codes.Count-2)]);"
            "$reordered=[long[]]@($codes.Clone());$swap=$reordered[0];"
            "$reordered[0]=$reordered[1];$reordered[1]=$swap;"
            "$extra=[long[]]@($codes+65);"
            "$changed=[long[]]@($codes.Clone());$changed[3]=65;"
            "$nulled=[long[]]@($codes.Clone());$nulled[4]=0;"
            "$cases=@($missing,$reordered,$extra,$changed,[long[]]@(),$nulled);"
            "$errors=@();foreach($candidate in $cases){try{"
            "Assert-MT5VmExactOriginCharacterStream -Origin $origin "
            "-CharacterCodes $candidate -ExpectedOrigin $origin|Out-Null;"
            "$errors+=,'FAILED_OPEN'}catch{$errors+=,$_.Exception.Message}};"
            "$c=Get-MT5VmTerminalUiConstants;"
            "[pscustomobject]@{constants=[pscustomobject]@{"
            "get_text=$c.WmGetText;get_text_length=$c.WmGetTextLength};"
            "ok=$ok;count=$codes.Count;errors=$errors}|"
            "ConvertTo-Json -Compress -Depth 5"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual(
            {"get_text": 0x000D, "get_text_length": 0x000E},
            observed["constants"],
        )
        self.assertTrue(observed["ok"])
        self.assertEqual(len("http://127.0.0.1:8790"), observed["count"])
        self.assertEqual(6, len(observed["errors"]))
        for error in observed["errors"]:
            self.assertIn("PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID", error)

    def test_webrequest_exact_text_boundary_orders_clear_chars_readback_commit(self) -> None:
        body = (
            "$origin='http://127.0.0.1:8790';$script:events=@();"
            "$setOriginal=(Get-Command Set-MT5VmEditorTextBoundary).ScriptBlock;"
            "$readOriginal=(Get-Command Read-MT5VmEditorTextBoundary).ScriptBlock;"
            "$messageOriginal=(Get-Command Invoke-MT5VmBoundedUiMessage).ScriptBlock;"
            "function Set-MT5VmEditorTextBoundary {"
            "param([IntPtr]$EditorHandle,[AllowEmptyString()][string]$Text);"
            "$script:events+=,[pscustomobject]@{kind='clear';"
            "handle=$EditorHandle.ToInt64();text=$Text}};"
            "function Read-MT5VmEditorTextBoundary {param([IntPtr]$EditorHandle);"
            "$script:events+=,[pscustomobject]@{kind='read';"
            "handle=$EditorHandle.ToInt64()};$origin};"
            "function Invoke-MT5VmBoundedUiMessage {"
            "param([IntPtr]$Handle,[uint32]$Message,[IntPtr]$WParam,[IntPtr]$LParam);"
            "$script:events+=,[pscustomobject]@{kind='message';"
            "handle=$Handle.ToInt64();message=[long]$Message;"
            "wparam=$WParam.ToInt64();lparam=$LParam.ToInt64()};[IntPtr]::Zero};"
            "try{$ok=[bool](Invoke-MT5VmExactEditorTextBoundary "
            "-EditorHandle ([IntPtr]42) -ExpectedOrigin $origin)}finally{"
            "Set-Item Function:Set-MT5VmEditorTextBoundary -Value $setOriginal;"
            "Set-Item Function:Read-MT5VmEditorTextBoundary -Value $readOriginal;"
            "Set-Item Function:Invoke-MT5VmBoundedUiMessage -Value $messageOriginal};"
            "[pscustomobject]@{ok=$ok;events=$script:events}|"
            "ConvertTo-Json -Compress -Depth 5"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        events = observed["events"]
        origin = "http://127.0.0.1:8790"
        self.assertTrue(observed["ok"])
        self.assertEqual(
            {"kind": "clear", "handle": 42, "text": ""}, events[0]
        )
        character_events = events[1 : 1 + len(origin)]
        self.assertEqual(len(origin), len(character_events))
        for event, character in zip(character_events, origin):
            self.assertEqual(
                {
                    "kind": "message",
                    "handle": 42,
                    "message": 0x0102,
                    "wparam": ord(character),
                    "lparam": 0,
                },
                event,
            )
        self.assertEqual({"kind": "read", "handle": 42}, events[-2])
        self.assertEqual(
            {
                "kind": "message",
                "handle": 42,
                "message": 0x0102,
                "wparam": 0x0D,
                "lparam": 0,
            },
            events[-1],
        )
        self.assertEqual(len(origin) + 3, len(events))

    def test_webrequest_queued_text_boundary_orders_exact_dispatch(self) -> None:
        body = (
            "$script:testOrigin='http://127.0.0.1:8790';$script:events=@();"
            "$setOriginal=(Get-Command Set-MT5VmEditorTextBoundary).ScriptBlock;"
            "$readOriginal=(Get-Command Read-MT5VmEditorTextBoundary).ScriptBlock;"
            "$queueOriginal=(Get-Command Invoke-MT5VmQueuedUiMessageBoundary).ScriptBlock;"
            "$syncOriginal=(Get-Command Invoke-MT5VmBoundedUiMessage).ScriptBlock;"
            "function Set-MT5VmEditorTextBoundary {"
            "param([IntPtr]$EditorHandle,[AllowEmptyString()][string]$Text);"
            "$script:events+=,[pscustomobject]@{kind='clear';"
            "handle=$EditorHandle.ToInt64();text=$Text}};"
            "function Read-MT5VmEditorTextBoundary {param([IntPtr]$EditorHandle);"
            "$script:events+=,[pscustomobject]@{kind='read';"
            "handle=$EditorHandle.ToInt64()};$script:testOrigin};"
            "function Invoke-MT5VmQueuedUiMessageBoundary {"
            "param([IntPtr]$Handle,[uint32]$Message,[IntPtr]$WParam,[IntPtr]$LParam);"
            "$script:events+=,[pscustomobject]@{kind='queue';"
            "handle=$Handle.ToInt64();message=[long]$Message;"
            "wparam=$WParam.ToInt64();lparam=$LParam.ToInt64()};$true};"
            "function Invoke-MT5VmBoundedUiMessage {throw 'SYNCHRONOUS_CHAR_FORBIDDEN'};"
            "try{$ok=[bool](Invoke-MT5VmQueuedExactEditorTextBoundary "
            "-EditorHandle ([IntPtr]42) -ExpectedOrigin $script:testOrigin)}finally{"
            "Set-Item Function:Set-MT5VmEditorTextBoundary -Value $setOriginal;"
            "Set-Item Function:Read-MT5VmEditorTextBoundary -Value $readOriginal;"
            "Set-Item Function:Invoke-MT5VmQueuedUiMessageBoundary -Value $queueOriginal;"
            "Set-Item Function:Invoke-MT5VmBoundedUiMessage -Value $syncOriginal};"
            "[pscustomobject]@{ok=$ok;events=$script:events}|"
            "ConvertTo-Json -Compress -Depth 5"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        events = observed["events"]
        origin = "http://127.0.0.1:8790"
        self.assertTrue(observed["ok"])
        self.assertEqual(
            {"kind": "clear", "handle": 42, "text": ""}, events[0]
        )
        character_events = events[1 : 1 + len(origin)]
        self.assertEqual(len(origin), len(character_events))
        for event, character in zip(character_events, origin):
            self.assertEqual(
                {
                    "kind": "queue",
                    "handle": 42,
                    "message": 0x0102,
                    "wparam": ord(character),
                    "lparam": 0,
                },
                event,
            )
        self.assertEqual({"kind": "read", "handle": 42}, events[-2])
        self.assertEqual(
            {
                "kind": "queue",
                "handle": 42,
                "message": 0x0102,
                "wparam": 0x0D,
                "lparam": 0,
            },
            events[-1],
        )
        self.assertEqual(len(origin) + 3, len(events))

    def test_webrequest_queued_text_boundary_fails_closed(self) -> None:
        origin = "http://127.0.0.1:8790"
        expected = {
            "character": {"queues": 2, "reads": 0},
            "return": {"queues": len(origin) + 1, "reads": 1},
            "readback": {"queues": len(origin), "reads": 25},
        }
        for mode, counts in expected.items():
            with self.subTest(mode=mode):
                body = (
                    f"$script:mode='{mode}';"
                    "$script:testOrigin='http://127.0.0.1:8790';"
                    "$script:queues=0;$script:reads=0;"
                    "$setOriginal=(Get-Command Set-MT5VmEditorTextBoundary).ScriptBlock;"
                    "$readOriginal=(Get-Command Read-MT5VmEditorTextBoundary).ScriptBlock;"
                    "$queueOriginal=(Get-Command Invoke-MT5VmQueuedUiMessageBoundary).ScriptBlock;"
                    "function Set-MT5VmEditorTextBoundary {"
                    "param([IntPtr]$EditorHandle,[AllowEmptyString()][string]$Text)};"
                    "function Read-MT5VmEditorTextBoundary {param([IntPtr]$EditorHandle);"
                    "$script:reads++;if($script:mode -ceq 'readback'){return ''};"
                    "return $script:testOrigin};"
                    "function Invoke-MT5VmQueuedUiMessageBoundary {"
                    "param([IntPtr]$Handle,[uint32]$Message,[IntPtr]$WParam,[IntPtr]$LParam);"
                    "$script:queues++;"
                    "if($script:mode -ceq 'character' -and $script:queues -eq 2){"
                    "throw 'INJECTED_QUEUE_FAILURE'};"
                    "if($script:mode -ceq 'return' -and $WParam.ToInt64() -eq 13){"
                    "throw 'INJECTED_QUEUE_FAILURE'};$true};"
                    "function Start-Sleep {param([int]$Milliseconds)};"
                    "try{try{Invoke-MT5VmQueuedExactEditorTextBoundary "
                    "-EditorHandle ([IntPtr]42) -ExpectedOrigin $script:testOrigin|Out-Null;"
                    "$errorCode='FAILED_OPEN'}catch{$errorCode=$_.Exception.Message}}finally{"
                    "Set-Item Function:Set-MT5VmEditorTextBoundary -Value $setOriginal;"
                    "Set-Item Function:Read-MT5VmEditorTextBoundary -Value $readOriginal;"
                    "Set-Item Function:Invoke-MT5VmQueuedUiMessageBoundary -Value $queueOriginal;"
                    "Remove-Item Function:Start-Sleep -ErrorAction SilentlyContinue};"
                    "[pscustomobject]@{error=$errorCode;queues=$script:queues;"
                    "reads=$script:reads}|ConvertTo-Json -Compress"
                )
                completed = self._run_module(body)
                self.assertEqual(0, completed.returncode, completed.stderr)
                observed = json.loads(completed.stdout)
                self.assertIn(
                    "PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID",
                    observed["error"],
                )
                self.assertEqual(counts["queues"], observed["queues"])
                self.assertEqual(counts["reads"], observed["reads"])

    def test_webrequest_exact_keyboard_input_plan(self) -> None:
        source = UI_HELPER.read_text(encoding="utf-8")
        for required in (
            "SendInput",
            "GetForegroundWindow",
            "GetGUIThreadInfo",
            "KeyEventUnicode",
            "KeyEventKeyUp",
            "New-MT5VmExactKeyboardInputPlan",
        ):
            self.assertIn(required, source)

        body = (
            "$origin='http://127.0.0.1:8790';"
            "$plan=@(New-MT5VmExactKeyboardInputPlan -Origin $origin "
            "-ExpectedOrigin $origin);$c=Get-MT5VmTerminalUiConstants;"
            "$records=@($plan|ForEach-Object{[pscustomobject]@{"
            "vk=[int]$_.VirtualKey;scan=[int]$_.ScanCode;flags=[long]$_.Flags}});"
            "[pscustomobject]@{constants=[pscustomobject]@{"
            "unicode=[long]$c.KeyEventUnicode;keyup=[long]$c.KeyEventKeyUp};"
            "records=$records}|ConvertTo-Json -Compress -Depth 6"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual({"unicode": 0x0004, "keyup": 0x0002}, observed["constants"])
        expected_records = []
        for character in "http://127.0.0.1:8790":
            expected_records.extend(
                (
                    {"vk": 0, "scan": ord(character), "flags": 0x0004},
                    {"vk": 0, "scan": ord(character), "flags": 0x0006},
                )
            )
        expected_records.extend(
            (
                {"vk": 0x0D, "scan": 0, "flags": 0},
                {"vk": 0x0D, "scan": 0, "flags": 0x0002},
            )
        )
        self.assertEqual(expected_records, observed["records"])

    def test_webrequest_exact_keyboard_input_plan_rejects_mutations(self) -> None:
        body = (
            "$origin='http://127.0.0.1:8790';"
            "$plan=@(New-MT5VmExactKeyboardInputPlan -Origin $origin "
            "-ExpectedOrigin $origin);"
            "$missing=@($plan[0..($plan.Count-2)]);"
            "$reordered=@($plan.Clone());$swap=$reordered[0];"
            "$reordered[0]=$reordered[1];$reordered[1]=$swap;"
            "$extra=@($plan+[pscustomobject]@{VirtualKey=65;ScanCode=0;Flags=0});"
            "$changed=@($plan.Clone());$changed[4]=[pscustomobject]@{"
            "VirtualKey=0;ScanCode=65;Flags=4};"
            "$nulled=@($plan.Clone());$nulled[0]=[pscustomobject]@{"
            "VirtualKey=0;ScanCode=0;Flags=4};"
            "$cases=@($missing,$reordered,$extra,$changed,@(),$nulled);"
            "$errors=@();foreach($candidate in $cases){try{"
            "Assert-MT5VmExactKeyboardInputPlan -Origin $origin "
            "-Plan @($candidate) -ExpectedOrigin $origin|Out-Null;"
            "$errors+=,'FAILED_OPEN'}catch{$errors+=,$_.Exception.Message}};"
            "$ok=Assert-MT5VmExactKeyboardInputPlan -Origin $origin "
            "-Plan $plan -ExpectedOrigin $origin;"
            "[pscustomobject]@{ok=$ok;errors=$errors}|"
            "ConvertTo-Json -Compress -Depth 5"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertTrue(observed["ok"])
        self.assertEqual(6, len(observed["errors"]))
        for error in observed["errors"]:
            self.assertIn("PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID", error)

    def test_webrequest_guarded_keyboard_input_boundary_fails_closed(self) -> None:
        expected = {
            "success": {"ok": True, "guards": 1, "sends": 1},
            "guard": {"ok": False, "guards": 1, "sends": 0},
            "partial": {"ok": False, "guards": 1, "sends": 1},
        }
        for mode, result in expected.items():
            with self.subTest(mode=mode):
                body = (
                    f"$script:mode='{mode}';"
                    "$script:guards=0;$script:sends=0;$script:clears=0;"
                    "$guardOriginal=(Get-Command Test-MT5VmExactEditorInputGuardBoundary).ScriptBlock;"
                    "$sendOriginal=(Get-Command Invoke-MT5VmNativeKeyboardInputBoundary).ScriptBlock;"
                    "$setOriginal=(Get-Command Set-MT5VmEditorTextBoundary).ScriptBlock;"
                    "function Set-MT5VmEditorTextBoundary {"
                    "param([IntPtr]$EditorHandle,[AllowEmptyString()][string]$Text);"
                    "$script:clears++;if($EditorHandle.ToInt64() -ne 42 -or $Text -cne ''){"
                    "throw 'WRONG_CLEAR'}};"
                    "function Test-MT5VmExactEditorInputGuardBoundary {"
                    "param([IntPtr]$OptionsHandle,[IntPtr]$EditorHandle,[int]$ProcessId);"
                    "$script:guards++;if($OptionsHandle.ToInt64() -ne 41 -or "
                    "$EditorHandle.ToInt64() -ne 42 -or $ProcessId -ne 700){"
                    "throw 'WRONG_GUARD'};return ($script:mode -cne 'guard')};"
                    "function Invoke-MT5VmNativeKeyboardInputBoundary {param([object[]]$Plan);"
                    "$script:sends++;if($script:mode -ceq 'partial'){return $Plan.Count-1};"
                    "return $Plan.Count};"
                    "function Invoke-MT5VmBoundedUiMessage {throw 'SYNC_FORBIDDEN'};"
                    "function Invoke-MT5VmQueuedUiMessageBoundary {throw 'QUEUE_FORBIDDEN'};"
                    "try{try{$value=[bool](Invoke-MT5VmGuardedExactKeyboardInputBoundary "
                    "-OptionsHandle ([IntPtr]41) -EditorHandle ([IntPtr]42) "
                    "-ProcessId 700 -ExpectedOrigin 'http://127.0.0.1:8790');"
                    "$errorCode=''}catch{$value=$false;$errorCode=$_.Exception.Message}}finally{"
                    "Set-Item Function:Test-MT5VmExactEditorInputGuardBoundary -Value $guardOriginal;"
                    "Set-Item Function:Invoke-MT5VmNativeKeyboardInputBoundary -Value $sendOriginal;"
                    "Set-Item Function:Set-MT5VmEditorTextBoundary -Value $setOriginal};"
                    "[pscustomobject]@{ok=$value;error=$errorCode;clears=$script:clears;"
                    "guards=$script:guards;sends=$script:sends}|ConvertTo-Json -Compress"
                )
                completed = self._run_module(body)
                self.assertEqual(0, completed.returncode, completed.stderr)
                observed = json.loads(completed.stdout)
                self.assertEqual(result["ok"], observed["ok"])
                self.assertEqual(1, observed["clears"])
                self.assertEqual(result["guards"], observed["guards"])
                self.assertEqual(result["sends"], observed["sends"])
                if result["ok"]:
                    self.assertEqual("", observed["error"])
                else:
                    self.assertIn(
                        "PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID",
                        observed["error"],
                    )

    def test_webrequest_exact_virtual_key_plan_and_return_isolation(self) -> None:
        source = UI_HELPER.read_text(encoding="utf-8")
        for required in (
            "GetKeyState",
            "VirtualKeyShift",
            "VirtualKeyOem1",
            "VirtualKeyOem2",
            "VirtualKeyOemPeriod",
            "New-MT5VmExactVirtualKeyInputPlan",
            "New-MT5VmReturnKeyInputPlan",
        ):
            self.assertIn(required, source)

        body = (
            "$origin='http://127.0.0.1:8790';"
            "$characters=@(New-MT5VmExactVirtualKeyInputPlan -Origin $origin "
            "-ExpectedOrigin $origin);$return=@(New-MT5VmReturnKeyInputPlan);"
            "$convert={param($records)@($records|ForEach-Object{[pscustomobject]@{"
            "vk=[int]$_.VirtualKey;scan=[int]$_.ScanCode;flags=[long]$_.Flags}})};"
            "[pscustomobject]@{characters=(& $convert $characters);"
            "return=(& $convert $return)}|ConvertTo-Json -Compress -Depth 6"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        expected_characters = []
        mapping = {".": 0xBE, "/": 0xBF}
        for character in "http://127.0.0.1:8790":
            if character == ":":
                expected_characters.extend(
                    (
                        {"vk": 0x10, "scan": 0, "flags": 0},
                        {"vk": 0xBA, "scan": 0, "flags": 0},
                        {"vk": 0xBA, "scan": 0, "flags": 0x0002},
                        {"vk": 0x10, "scan": 0, "flags": 0x0002},
                    )
                )
            else:
                virtual_key = mapping.get(character, ord(character.upper()))
                expected_characters.extend(
                    (
                        {"vk": virtual_key, "scan": 0, "flags": 0},
                        {"vk": virtual_key, "scan": 0, "flags": 0x0002},
                    )
                )
        self.assertEqual(expected_characters, observed["characters"])
        self.assertEqual(
            [
                {"vk": 0x0D, "scan": 0, "flags": 0},
                {"vk": 0x0D, "scan": 0, "flags": 0x0002},
            ],
            observed["return"],
        )

    def test_webrequest_exact_virtual_key_plan_rejects_mutations(self) -> None:
        body = (
            "$origin='http://127.0.0.1:8790';"
            "$plan=@(New-MT5VmExactVirtualKeyInputPlan -Origin $origin "
            "-ExpectedOrigin $origin);"
            "$missing=@($plan[1..($plan.Count-1)]);"
            "$reordered=@($plan.Clone());$swap=$reordered[0];"
            "$reordered[0]=$reordered[1];$reordered[1]=$swap;"
            "$extra=@($plan+[pscustomobject]@{VirtualKey=65;ScanCode=0;Flags=0});"
            "$changed=@($plan.Clone());$colon=($changed|Where-Object{"
            "$_.VirtualKey -eq 186}|Select-Object -First 1);"
            "$colonIndex=[array]::IndexOf($changed,$colon);"
            "$changed[$colonIndex-1]=[pscustomobject]@{VirtualKey=16;ScanCode=0;Flags=2};"
            "$cases=@($missing,$reordered,$extra,$changed,@());$errors=@();"
            "foreach($candidate in $cases){try{"
            "Assert-MT5VmExactVirtualKeyInputPlan -Origin $origin "
            "-Plan @($candidate) -ExpectedOrigin $origin|Out-Null;"
            "$errors+=,'FAILED_OPEN'}catch{$errors+=,$_.Exception.Message}};"
            "$ok=Assert-MT5VmExactVirtualKeyInputPlan -Origin $origin "
            "-Plan $plan -ExpectedOrigin $origin;"
            "[pscustomobject]@{ok=$ok;errors=$errors}|ConvertTo-Json -Compress"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertTrue(observed["ok"])
        self.assertEqual(5, len(observed["errors"]))
        for error in observed["errors"]:
            self.assertIn("PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID", error)

    def test_webrequest_virtual_key_stage_commits_once_after_readback(self) -> None:
        body = (
            "$script:origin='http://127.0.0.1:8790';$script:events=@();"
            "$setOriginal=(Get-Command Set-MT5VmEditorTextBoundary).ScriptBlock;"
            "$capsOriginal=(Get-Command Test-MT5VmCapsLockOffBoundary).ScriptBlock;"
            "$guardOriginal=(Get-Command Test-MT5VmExactEditorInputGuardBoundary).ScriptBlock;"
            "$sendOriginal=(Get-Command Invoke-MT5VmNativeKeyboardInputBoundary).ScriptBlock;"
            "$readOriginal=(Get-Command Read-MT5VmEditorTextBoundary).ScriptBlock;"
            "function Set-MT5VmEditorTextBoundary {"
            "param([IntPtr]$EditorHandle,[AllowEmptyString()][string]$Text);"
            "$script:events+=,'clear'};"
            "function Test-MT5VmCapsLockOffBoundary {$script:events+=,'caps';$true};"
            "function Test-MT5VmExactEditorInputGuardBoundary {"
            "param([IntPtr]$OptionsHandle,[IntPtr]$EditorHandle,[int]$ProcessId);"
            "$script:events+=,'guard';$true};"
            "function Invoke-MT5VmNativeKeyboardInputBoundary {param([object[]]$Plan);"
            "$script:events+=,('send:'+[string]$Plan.Count);$Plan.Count};"
            "function Read-MT5VmEditorTextBoundary {param([IntPtr]$EditorHandle);"
            "$script:events+=,'read';$script:origin};"
            "function Start-Sleep {param([int]$Milliseconds)};"
            "try{$ok=[bool](Invoke-MT5VmGuardedExactVirtualKeyStageBoundary "
            "-OptionsHandle ([IntPtr]41) -EditorHandle ([IntPtr]42) "
            "-ProcessId 700 -ExpectedOrigin $script:origin)}finally{"
            "Set-Item Function:Set-MT5VmEditorTextBoundary -Value $setOriginal;"
            "Set-Item Function:Test-MT5VmCapsLockOffBoundary -Value $capsOriginal;"
            "Set-Item Function:Test-MT5VmExactEditorInputGuardBoundary -Value $guardOriginal;"
            "Set-Item Function:Invoke-MT5VmNativeKeyboardInputBoundary -Value $sendOriginal;"
            "Set-Item Function:Read-MT5VmEditorTextBoundary -Value $readOriginal;"
            "Remove-Item Function:Start-Sleep -ErrorAction SilentlyContinue};"
            "[pscustomobject]@{ok=$ok;events=$script:events}|"
            "ConvertTo-Json -Compress -Depth 5"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertTrue(observed["ok"])
        self.assertEqual(
            ["clear", "caps", "guard", "send:46", "read", "guard", "send:2"],
            observed["events"],
        )

    def test_webrequest_virtual_key_stage_fails_before_later_stages(self) -> None:
        expected = {
            "caps": {"guards": 0, "sends": 0, "reads": 0},
            "guard1": {"guards": 1, "sends": 0, "reads": 0},
            "partial_chars": {"guards": 1, "sends": 1, "reads": 0},
            "readback": {"guards": 1, "sends": 1, "reads": 25},
            "guard2": {"guards": 2, "sends": 1, "reads": 1},
            "partial_return": {"guards": 2, "sends": 2, "reads": 1},
        }
        for mode, counts in expected.items():
            with self.subTest(mode=mode):
                body = (
                    f"$script:mode='{mode}';"
                    "$script:origin='http://127.0.0.1:8790';"
                    "$script:guards=0;$script:sends=0;$script:reads=0;"
                    "$setOriginal=(Get-Command Set-MT5VmEditorTextBoundary).ScriptBlock;"
                    "$capsOriginal=(Get-Command Test-MT5VmCapsLockOffBoundary).ScriptBlock;"
                    "$guardOriginal=(Get-Command Test-MT5VmExactEditorInputGuardBoundary).ScriptBlock;"
                    "$sendOriginal=(Get-Command Invoke-MT5VmNativeKeyboardInputBoundary).ScriptBlock;"
                    "$readOriginal=(Get-Command Read-MT5VmEditorTextBoundary).ScriptBlock;"
                    "function Set-MT5VmEditorTextBoundary {"
                    "param([IntPtr]$EditorHandle,[AllowEmptyString()][string]$Text)};"
                    "function Test-MT5VmCapsLockOffBoundary {return ($script:mode -cne 'caps')};"
                    "function Test-MT5VmExactEditorInputGuardBoundary {"
                    "param([IntPtr]$OptionsHandle,[IntPtr]$EditorHandle,[int]$ProcessId);"
                    "$script:guards++;if($script:mode -ceq 'guard1'){return $false};"
                    "if($script:mode -ceq 'guard2' -and $script:guards -eq 2){return $false};"
                    "$true};"
                    "function Invoke-MT5VmNativeKeyboardInputBoundary {param([object[]]$Plan);"
                    "$script:sends++;if($script:mode -ceq 'partial_chars' -and "
                    "$script:sends -eq 1){return $Plan.Count-1};"
                    "if($script:mode -ceq 'partial_return' -and "
                    "$script:sends -eq 2){return $Plan.Count-1};"
                    "$Plan.Count};"
                    "function Read-MT5VmEditorTextBoundary {param([IntPtr]$EditorHandle);"
                    "$script:reads++;if($script:mode -ceq 'readback'){return ''};"
                    "$script:origin};function Start-Sleep {param([int]$Milliseconds)};"
                    "try{try{Invoke-MT5VmGuardedExactVirtualKeyStageBoundary "
                    "-OptionsHandle ([IntPtr]41) -EditorHandle ([IntPtr]42) "
                    "-ProcessId 700 -ExpectedOrigin $script:origin|Out-Null;"
                    "$errorCode='FAILED_OPEN'}catch{$errorCode=$_.Exception.Message}}finally{"
                    "Set-Item Function:Set-MT5VmEditorTextBoundary -Value $setOriginal;"
                    "Set-Item Function:Test-MT5VmCapsLockOffBoundary -Value $capsOriginal;"
                    "Set-Item Function:Test-MT5VmExactEditorInputGuardBoundary -Value $guardOriginal;"
                    "Set-Item Function:Invoke-MT5VmNativeKeyboardInputBoundary -Value $sendOriginal;"
                    "Set-Item Function:Read-MT5VmEditorTextBoundary -Value $readOriginal;"
                    "Remove-Item Function:Start-Sleep -ErrorAction SilentlyContinue};"
                    "[pscustomobject]@{error=$errorCode;guards=$script:guards;"
                    "sends=$script:sends;reads=$script:reads}|ConvertTo-Json -Compress"
                )
                completed = self._run_module(body)
                self.assertEqual(0, completed.returncode, completed.stderr)
                observed = json.loads(completed.stdout)
                self.assertIn(
                    "PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID",
                    observed["error"],
                )
                self.assertEqual(counts["guards"], observed["guards"])
                self.assertEqual(counts["sends"], observed["sends"])
                self.assertEqual(counts["reads"], observed["reads"])

    def test_webrequest_mouse_sequence_requires_exact_messages_flags_and_point(self) -> None:
        source = UI_HELPER.read_text(encoding="utf-8")
        for required in (
            "WmLButtonDown",
            "WmLButtonUp",
            "Assert-MT5VmMouseActivationSequence",
            "PROVISIONING_WEBREQUEST_ALLOWLIST_SEQUENCE_INVALID",
        ):
            self.assertIn(required, source)

        body = (
            "$c=Get-MT5VmTerminalUiConstants;$point=655410;"
            "$messages=@($c.WmLButtonDown,$c.WmLButtonUp,"
            "$c.WmLButtonDoubleClick,$c.WmLButtonUp);"
            "$flags=@(1,0,1,0);$points=@($point,$point,$point,$point);"
            "$ok=Assert-MT5VmMouseActivationSequence -Messages $messages "
            "-WParams $flags -LParams $points -ExpectedPoint $point;"
            "$cases=@("
            "@{Messages=@($messages[0..2]);WParams=@($flags[0..2]);"
            "LParams=@($points[0..2]);ExpectedPoint=$point},"
            "@{Messages=@($messages[2],$messages[1],$messages[0],$messages[3]);"
            "WParams=$flags;LParams=$points;ExpectedPoint=$point},"
            "@{Messages=@($messages+$c.WmLButtonUp);WParams=@($flags+0);"
            "LParams=@($points+$point);ExpectedPoint=$point},"
            "@{Messages=$messages;WParams=$flags;"
            "LParams=@($point,$point,42,$point);ExpectedPoint=$point},"
            "@{Messages=$messages;WParams=@(0,0,1,0);"
            "LParams=$points;ExpectedPoint=$point});"
            "$errors=@();foreach($case in $cases){try{"
            "Assert-MT5VmMouseActivationSequence @case|Out-Null;"
            "$errors+=,'FAILED_OPEN'}catch{$errors+=,$_.Exception.Message}};"
            "[pscustomobject]@{constants=[pscustomobject]@{down=$c.WmLButtonDown;"
            "up=$c.WmLButtonUp};ok=$ok;errors=$errors}|"
            "ConvertTo-Json -Compress -Depth 6"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual({"down": 0x0201, "up": 0x0202}, observed["constants"])
        self.assertTrue(observed["ok"])
        self.assertEqual(5, len(observed["errors"]))
        for error in observed["errors"]:
            self.assertIn("PROVISIONING_WEBREQUEST_ALLOWLIST_SEQUENCE_INVALID", error)

    def test_webrequest_queue_boundary_uses_postmessage_and_fails_closed(self) -> None:
        source = UI_HELPER.read_text(encoding="utf-8")
        for required in (
            "PostMessageW",
            "TryPostMessage",
            "Invoke-MT5VmQueuedUiMessageBoundary",
            "PROVISIONING_WEBREQUEST_ALLOWLIST_SEQUENCE_QUEUE_FAILED",
        ):
            self.assertIn(required, source)

        body = (
            "$caught='';try{Invoke-MT5VmQueuedUiMessageBoundary "
            "-Handle ([IntPtr]::Zero) -Message 0x0201 -WParam ([IntPtr]1) "
            "-LParam ([IntPtr]655410)|Out-Null;$caught='FAILED_OPEN'}"
            "catch{$caught=$_.Exception.Message};"
            "[pscustomobject]@{caught=$caught}|ConvertTo-Json -Compress"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual(
            "PROVISIONING_WEBREQUEST_ALLOWLIST_SEQUENCE_QUEUE_FAILED",
            observed["caught"],
        )

    def test_webrequest_physical_mouse_plans_are_exact_and_fail_closed(self) -> None:
        body = (
            "$c=Get-MT5VmTerminalUiConstants;"
            "$move=@(New-MT5VmAbsoluteMouseMoveInputPlan -ScreenX 100 -ScreenY 50 "
            "-VirtualLeft 0 -VirtualTop 0 -VirtualWidth 1920 -VirtualHeight 1080);"
            "$clicks=@(New-MT5VmExactDoubleClickInputPlan);"
            "$badMoves=@("
            "@{ScreenX=-1;ScreenY=50;VirtualLeft=0;VirtualTop=0;VirtualWidth=1920;VirtualHeight=1080},"
            "@{ScreenX=1920;ScreenY=50;VirtualLeft=0;VirtualTop=0;VirtualWidth=1920;VirtualHeight=1080},"
            "@{ScreenX=100;ScreenY=50;VirtualLeft=0;VirtualTop=0;VirtualWidth=1;VirtualHeight=1080});"
            "$moveErrors=@();foreach($case in $badMoves){try{"
            "New-MT5VmAbsoluteMouseMoveInputPlan @case|Out-Null;"
            "$moveErrors+=,'FAILED_OPEN'}catch{$moveErrors+=,$_.Exception.Message}};"
            "$missing=@($clicks[0..2]);$reordered=@($clicks.Clone());"
            "$swap=$reordered[0];$reordered[0]=$reordered[1];$reordered[1]=$swap;"
            "$extra=@($clicks+[pscustomobject]@{Dx=0;Dy=0;MouseData=0;Flags=4});"
            "$clickErrors=@();foreach($candidate in @($missing,$reordered,$extra,@())){try{"
            "Assert-MT5VmExactDoubleClickInputPlan -Plan @($candidate)|Out-Null;"
            "$clickErrors+=,'FAILED_OPEN'}catch{$clickErrors+=,$_.Exception.Message}};"
            "$records={param($items)@($items|ForEach-Object{[pscustomobject]@{"
            "dx=[int]$_.Dx;dy=[int]$_.Dy;data=[int]$_.MouseData;flags=[long]$_.Flags}})};"
            "[pscustomobject]@{constants=[pscustomobject]@{move=$c.MouseEventMove;"
            "left_down=$c.MouseEventLeftDown;left_up=$c.MouseEventLeftUp;"
            "absolute=$c.MouseEventAbsolute;virtual_desk=$c.MouseEventVirtualDesk};"
            "move=@(& $records $move);clicks=@(& $records $clicks);"
            "move_errors=$moveErrors;click_errors=$clickErrors}|"
            "ConvertTo-Json -Compress -Depth 6"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual(
            {
                "move": 0x0001,
                "left_down": 0x0002,
                "left_up": 0x0004,
                "absolute": 0x8000,
                "virtual_desk": 0x4000,
            },
            observed["constants"],
        )
        self.assertEqual(
            [
                {
                    "dx": round(100 * 65535 / 1919),
                    "dy": round(50 * 65535 / 1079),
                    "data": 0,
                    "flags": 0xC001,
                }
            ],
            observed["move"],
        )
        self.assertEqual(
            [
                {"dx": 0, "dy": 0, "data": 0, "flags": 0x0002},
                {"dx": 0, "dy": 0, "data": 0, "flags": 0x0004},
                {"dx": 0, "dy": 0, "data": 0, "flags": 0x0002},
                {"dx": 0, "dy": 0, "data": 0, "flags": 0x0004},
            ],
            observed["clicks"],
        )
        self.assertEqual(3, len(observed["move_errors"]))
        self.assertEqual(4, len(observed["click_errors"]))
        for error in observed["move_errors"] + observed["click_errors"]:
            self.assertIn("PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID", error)

    def test_webrequest_physical_mouse_activation_rechecks_guard_and_counts(self) -> None:
        expected = {
            "success": {"guards": 3, "sends": 3, "ok": True},
            "guard1": {"guards": 1, "sends": 0, "ok": False},
            "partial_move": {"guards": 1, "sends": 1, "ok": False},
            "guard2": {"guards": 2, "sends": 1, "ok": False},
            "partial_first_click": {"guards": 2, "sends": 2, "ok": False},
            "guard3": {"guards": 3, "sends": 2, "ok": False},
            "partial_second_click": {"guards": 3, "sends": 3, "ok": False},
        }
        for mode, expected_result in expected.items():
            with self.subTest(mode=mode):
                body = (
                    f"$script:mode='{mode}';$script:events=@();"
                    "$pointOriginal=(Get-Command Convert-MT5VmClientPointToScreenBoundary).ScriptBlock;"
                    "$screenOriginal=(Get-Command Get-MT5VmVirtualScreenBoundary).ScriptBlock;"
                    "$guardOriginal=(Get-Command Test-MT5VmPhysicalMouseActivationGuardBoundary).ScriptBlock;"
                    "$sendOriginal=(Get-Command Invoke-MT5VmNativeMouseInputBoundary).ScriptBlock;"
                    "function Convert-MT5VmClientPointToScreenBoundary {"
                    "param([IntPtr]$ListHandle,[int]$ClientX,[int]$ClientY);"
                    "$script:events+=,'point';[pscustomobject]@{x=113;y=210}};"
                    "function Get-MT5VmVirtualScreenBoundary {$script:events+=,'screen';"
                    "[pscustomobject]@{left=0;top=0;width=1920;height=1080}};"
                    "function Test-MT5VmPhysicalMouseActivationGuardBoundary {"
                    "param([IntPtr]$OptionsHandle,[IntPtr]$ListHandle,[IntPtr]$CheckboxHandle,"
                    "[int]$ProcessId,[int]$ScreenX,[int]$ScreenY);"
                    "$script:events+=,'guard';$guards=@($script:events|Where-Object{$_ -ceq 'guard'}).Count;"
                    "if($script:mode -ceq 'guard1' -and $guards -eq 1){return $false};"
                    "if($script:mode -ceq 'guard2' -and $guards -eq 2){return $false};"
                    "if($script:mode -ceq 'guard3' -and $guards -eq 3){return $false};$true};"
                    "function Invoke-MT5VmNativeMouseInputBoundary {param([object[]]$Plan);"
                    "$script:events+=,('send:'+$Plan.Count);"
                    "$sends=@($script:events|Where-Object{$_ -like 'send:*'}).Count;"
                    "if($script:mode -ceq 'partial_move' -and $sends -eq 1){return 0};"
                    "if($script:mode -ceq 'partial_first_click' -and $sends -eq 2){return 1};"
                    "if($script:mode -ceq 'partial_second_click' -and $sends -eq 3){return 1};"
                    "$Plan.Count};"
                    "function Start-Sleep {param([int]$Milliseconds);"
                    "$script:events+=,('sleep:'+$Milliseconds)};"
                    "try{try{$value=[bool](Invoke-MT5VmGuardedPhysicalMouseActivationBoundary "
                    "-OptionsHandle ([IntPtr]41) -ListHandle ([IntPtr]42) "
                    "-CheckboxHandle ([IntPtr]43) -ProcessId 700 -ClientX 13 -ClientY 10);"
                    "$errorCode=''}catch{$value=$false;$errorCode=$_.Exception.Message}}finally{"
                    "Set-Item Function:Convert-MT5VmClientPointToScreenBoundary -Value $pointOriginal;"
                    "Set-Item Function:Get-MT5VmVirtualScreenBoundary -Value $screenOriginal;"
                    "Set-Item Function:Test-MT5VmPhysicalMouseActivationGuardBoundary -Value $guardOriginal;"
                    "Set-Item Function:Invoke-MT5VmNativeMouseInputBoundary -Value $sendOriginal};"
                    "[pscustomobject]@{ok=$value;error=$errorCode;events=$script:events;"
                    "guards=@($script:events|Where-Object{$_ -ceq 'guard'}).Count;"
                    "sends=@($script:events|Where-Object{$_ -like 'send:*'}).Count}|"
                    "ConvertTo-Json -Compress -Depth 5"
                )
                completed = self._run_module(body)
                self.assertEqual(0, completed.returncode, completed.stderr)
                observed = json.loads(completed.stdout)
                self.assertEqual(expected_result["ok"], observed["ok"])
                self.assertEqual(expected_result["guards"], observed["guards"])
                self.assertEqual(expected_result["sends"], observed["sends"])
                if expected_result["ok"]:
                    self.assertEqual(
                        [
                            "point",
                            "screen",
                            "guard",
                            "send:1",
                            "guard",
                            "send:2",
                            "sleep:150",
                            "guard",
                            "send:2",
                        ],
                        observed["events"],
                    )
                    self.assertEqual("", observed["error"])
                else:
                    self.assertIn(
                        "PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID",
                        observed["error"],
                    )

    def test_webrequest_physical_mouse_transaction_always_restores_cursor(self) -> None:
        expected = {
            "success": ("PASS", ["capture", "activate", "continue", "restore"]),
            "activation": (
                "INJECTED_ACTIVATION_FAILURE",
                ["capture", "activate", "restore"],
            ),
            "continuation": (
                "INJECTED_CONTINUATION_FAILURE",
                ["capture", "activate", "continue", "restore"],
            ),
            "restore": (
                "PROVISIONING_WEBREQUEST_ALLOWLIST_CURSOR_RESTORE_FAILED",
                ["capture", "activate", "continue", "restore"],
            ),
        }
        for mode, (expected_result, expected_events) in expected.items():
            with self.subTest(mode=mode):
                body = (
                    f"$script:mode='{mode}';$script:events=@();"
                    "$capture={$script:events+=,'capture';[pscustomobject]@{x=7;y=9}};"
                    "$activate={$script:events+=,'activate';if($script:mode -ceq 'activation'){"
                    "throw 'INJECTED_ACTIVATION_FAILURE'}};"
                    "$continue={$script:events+=,'continue';if($script:mode -ceq 'continuation'){"
                    "throw 'INJECTED_CONTINUATION_FAILURE'};'PASS'};"
                    "$restore={param($cursor)$script:events+=,'restore';"
                    "if($cursor.x -ne 7 -or $cursor.y -ne 9){throw 'WRONG_CURSOR'};"
                    "return ($script:mode -cne 'restore')};"
                    "try{$value=Invoke-MT5VmPhysicalMouseActivationTransactionCore "
                    "-CaptureCursorAction $capture -ActivationAction $activate "
                    "-ContinuationAction $continue -RestoreCursorAction $restore;"
                    "$result=[string]$value}catch{$result=$_.Exception.Message};"
                    "[pscustomobject]@{result=$result;events=$script:events}|"
                    "ConvertTo-Json -Compress -Depth 5"
                )
                completed = self._run_module(body)
                self.assertEqual(0, completed.returncode, completed.stderr)
                observed = json.loads(completed.stdout)
                self.assertEqual(expected_result, observed["result"])
                self.assertEqual(expected_events, observed["events"])

    def test_webrequest_physical_mouse_gauntlet_persists_controls_and_mutants(self) -> None:
        self.assertTrue(HOST_VERIFIER.exists(), "production host verifier is missing")
        source = HOST_VERIFIER.read_text(encoding="utf-8")
        for required in (
            "-MouseHitControl",
            "-CursorRestoreControl",
            "Invoke-MouseMutationTests",
            "drop-post-move-hit-guard",
            "permit-partial-double-click-count",
            "accept-wrong-editor-pid",
            "skip-cursor-restoration",
            "combine-click-batches",
            "remove-paced-click-delay",
            "drop-mid-click-guard",
            "PRODUCTION_WEBREQUEST_MOUSE_MUTATION=15/15",
            "PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID",
            "PROVISIONING_WEBREQUEST_ALLOWLIST_CURSOR_RESTORE_FAILED",
        ):
            self.assertIn(required, source, required)

    def test_webrequest_persisted_preflight_gauntlet_persists_v31_mutants(self) -> None:
        source = HOST_VERIFIER.read_text(encoding="utf-8")
        for required in (
            "omit-editor-return-commit",
            "permit-partial-editor-return-count",
            "send-editor-return-after-physical-ok",
            "accept-editor-readback-as-persisted-proof",
            "create-proxy-before-persisted-preflight",
            "skip-successful-trace-rollback",
            "accept-wrong-options-ok-pid",
            "accept-wrong-options-ok-point",
            "permit-partial-options-ok-click",
            "skip-options-ok-cursor-restoration",
            "PRODUCTION_WEBREQUEST_MOUSE_MUTATION=15/15",
            "PRODUCTION_WEBREQUEST_ALLOWLIST_MUTATION=5/5",
        ):
            self.assertIn(required, source, required)

    def test_webrequest_queue_sequence_aborts_at_each_failed_position(self) -> None:
        body = (
            "$c=Get-MT5VmTerminalUiConstants;$point=655410;"
            "$messages=[uint32[]]@($c.WmLButtonDown,$c.WmLButtonUp,"
            "$c.WmLButtonDoubleClick,$c.WmLButtonUp);"
            "$flags=[long[]]@(1,0,1,0);"
            "$points=[long[]]@($point,$point,$point,$point);"
            "$original=(Get-Command Invoke-MT5VmQueuedUiMessageBoundary).ScriptBlock;"
            "$failures=@();foreach($failureAt in 0..3){"
            "$script:queueIndex=0;$script:failureAt=$failureAt;"
            "function Invoke-MT5VmQueuedUiMessageBoundary {"
            "param([IntPtr]$Handle,[uint32]$Message,[IntPtr]$WParam,[IntPtr]$LParam);"
            "$current=$script:queueIndex;$script:queueIndex+=1;"
            "if($current -eq $script:failureAt){"
            "throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_SEQUENCE_QUEUE_FAILED'}};"
            "$reported=$false;$caught='';try{"
            "$reported=[bool](Invoke-MT5VmMouseActivationSequenceBoundary "
            "-Handle ([IntPtr]42) -Messages $messages -WParams $flags "
            "-LParams $points -ExpectedPoint $point)}catch{$caught=$_.Exception.Message};"
            "$failures+=,[pscustomobject]@{failure_at=$failureAt;"
            "calls=$script:queueIndex;reported=$reported;caught=$caught}};"
            "$script:queueIndex=0;$script:failureAt=-1;"
            "$success=[bool](Invoke-MT5VmMouseActivationSequenceBoundary "
            "-Handle ([IntPtr]42) -Messages $messages -WParams $flags "
            "-LParams $points -ExpectedPoint $point);"
            "$successCalls=$script:queueIndex;"
            "Set-Item -Path Function:Invoke-MT5VmQueuedUiMessageBoundary -Value $original;"
            "[pscustomobject]@{failures=$failures;success=$success;"
            "success_calls=$successCalls}|ConvertTo-Json -Compress -Depth 5"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertTrue(observed["success"])
        self.assertEqual(4, observed["success_calls"])
        self.assertEqual(4, len(observed["failures"]))
        for index, failure in enumerate(observed["failures"]):
            self.assertEqual(index, failure["failure_at"])
            self.assertEqual(index + 1, failure["calls"])
            self.assertFalse(failure["reported"])
            self.assertEqual(
                "PROVISIONING_WEBREQUEST_ALLOWLIST_SEQUENCE_QUEUE_FAILED",
                failure["caught"],
            )

    def test_server_enrollment_uses_in_memory_credential_and_closes_only_owned_process(self) -> None:
        body = (
            self._process_boundaries(started=True)
            + "$script:uiCalls=@();$script:catalogCalls=0;"
            "function Open-MT5VmServerEnrollmentDialogBoundary {param([int]$ProcessId);"
            "$script:dialogPid=$ProcessId;[IntPtr]77};"
            "function Invoke-MT5VmServerEnrollmentUiBoundary {"
            "param([IntPtr]$DialogHandle,[string]$CompanySearchLabel,[string]$Login,"
            "[string]$Server,[string]$Password,[int]$TimeoutMs);"
            "$script:uiCalls+=,[pscustomobject]@{dialog=$DialogHandle;company=$CompanySearchLabel;"
            "login=$Login;server=$Server;password=$Password;timeout=$TimeoutMs};"
            "[pscustomobject]@{server_exact=$true;submitted=$true}};"
            "function Test-MT5VmServerCatalogRefreshBoundary {"
            "param([string]$TerminalPath,[string]$Server,[datetime]$NotBeforeUtc);"
            "$script:catalogCalls+=1;$true};"
            "$loader={[pscustomobject]@{login='900000000000000001';server='Broker-Demo';"
            "password='synthetic-only'}};"
            "$result=Invoke-MT5VmServerCatalogEnrollmentCore "
            "-TerminalPath $env:MT5_TEST_TERMINAL -AccountAlias 'synthetic-demo' "
            "-CompanySearchLabel 'Broker Public Company' -CredentialLoader $loader "
            "-TimeoutMs 60000;"
            "[pscustomobject]@{result=$result;ui_calls=$script:uiCalls.Count;"
            "catalog_calls=$script:catalogCalls;close_calls=$script:closeCalls}|"
            "ConvertTo-Json -Compress -Depth 6"
        )
        completed = self._run_module(body, extra_env=self._terminal_env())

        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual("PASS", observed["result"]["status"])
        self.assertTrue(observed["result"]["server_exact"])
        self.assertTrue(observed["result"]["catalog_refreshed"])
        self.assertEqual(1, observed["ui_calls"])
        self.assertEqual(1, observed["catalog_calls"])
        self.assertEqual([702], observed["close_calls"])
        serialized = json.dumps(observed)
        for secret in ("900000000000000001", "Broker-Demo", "synthetic-only"):
            self.assertNotIn(secret, serialized)

    def test_server_enrollment_never_closes_preexisting_terminal(self) -> None:
        body = (
            self._process_boundaries(started=False)
            + "function Open-MT5VmServerEnrollmentDialogBoundary {[IntPtr]77};"
            "function Invoke-MT5VmServerEnrollmentUiBoundary {"
            "[pscustomobject]@{server_exact=$true;submitted=$true}};"
            "function Test-MT5VmServerCatalogRefreshBoundary {$true};"
            "$loader={[pscustomobject]@{login='1';server='Broker-Demo';password='x'}};"
            "$null=Invoke-MT5VmServerCatalogEnrollmentCore "
            "-TerminalPath $env:MT5_TEST_TERMINAL -AccountAlias 'synthetic-demo' "
            "-CompanySearchLabel 'Broker Public Company' -CredentialLoader $loader;"
            "[pscustomobject]@{close_calls=$script:closeCalls}|ConvertTo-Json -Compress"
        )
        completed = self._run_module(body, extra_env=self._terminal_env())

        self.assertEqual(0, completed.returncode, completed.stderr)
        self.assertEqual([], json.loads(completed.stdout)["close_calls"])

    def test_server_enrollment_dialog_and_postconditions_fail_closed(self) -> None:
        body = (
            self._process_boundaries(started=True)
            + "$script:mode='dialog';$script:catalogCalls=0;"
            "function Open-MT5VmServerEnrollmentDialogBoundary {"
            "if($script:mode -eq 'dialog'){throw 'SERVER_ENROLLMENT_DIALOG_AMBIGUOUS'};"
            "[IntPtr]77};"
            "function Invoke-MT5VmServerEnrollmentUiBoundary {"
            "if($script:mode -eq 'server'){return [pscustomobject]@{"
            "server_exact=$false;submitted=$false}};"
            "[pscustomobject]@{server_exact=$true;submitted=$true}};"
            "function Test-MT5VmServerCatalogRefreshBoundary {"
            "$script:catalogCalls+=1;$false};"
            "$loader={[pscustomobject]@{login='1';server='Broker-Demo';password='x'}};"
            "$caught=@();foreach($mode in @('dialog','server','catalog')){"
            "$script:mode=$mode;try{Invoke-MT5VmServerCatalogEnrollmentCore "
            "-TerminalPath $env:MT5_TEST_TERMINAL -AccountAlias 'synthetic-demo' "
            "-CompanySearchLabel 'Broker Public Company' -CredentialLoader $loader|Out-Null}"
            "catch{$caught+=,$_.Exception.Message}};"
            "[pscustomobject]@{caught=$caught;catalog_calls=$script:catalogCalls;"
            "close_calls=$script:closeCalls}|ConvertTo-Json -Compress"
        )
        completed = self._run_module(body, extra_env=self._terminal_env())

        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual(
            [
                "SERVER_ENROLLMENT_DIALOG_AMBIGUOUS",
                "SERVER_SELECTION_MISMATCH",
                "SERVER_CATALOG_NOT_REFRESHED",
            ],
            observed["caught"],
        )
        self.assertEqual(1, observed["catalog_calls"])
        self.assertEqual([702, 702, 702], observed["close_calls"])

    def test_enrollment_sources_forbid_clipboard_sendkeys_and_secret_arguments(self) -> None:
        self.assertTrue(ENROLL.exists(), "server catalog enrollment entrypoint is missing")
        source = UI_HELPER.read_text(encoding="utf-8") + ENROLL.read_text(encoding="utf-8")
        for forbidden in (
            "SendKeys",
            "Clipboard",
            "Set-Clipboard",
            "startup.ini",
            "-Login",
            "-Server",
            "-Password",
        ):
            self.assertNotIn(forbidden.casefold(), source.casefold(), forbidden)

    def test_server_enrollment_declares_exact_next_and_finish_control_variants(self) -> None:
        completed = self._run_module(
            "$c=Get-MT5VmTerminalUiConstants;"
            "[pscustomobject]@{next=$c.EnrollmentNext;finish=$c.EnrollmentFinish}|"
            "ConvertTo-Json -Compress"
        )
        self.assertEqual(0, completed.returncode, completed.stderr)
        self.assertEqual({"next": 12324, "finish": 12325}, json.loads(completed.stdout))

    def test_server_enrollment_rejects_partial_and_duplicate_server_matches(self) -> None:
        body = (
            "$exact=Get-MT5VmExactServerIndex "
            "-Candidates @('Prefix-Broker-Demo-Suffix','Broker-Demo') "
            "-Expected 'Broker-Demo';"
            "$partial=$null;try{Get-MT5VmExactServerIndex "
            "-Candidates @('Prefix-Broker-Demo-Suffix') -Expected 'Broker-Demo'|Out-Null}"
            "catch{$partial=$_.Exception.Message};"
            "$duplicate=$null;try{Get-MT5VmExactServerIndex "
            "-Candidates @('Broker-Demo','Broker-Demo') -Expected 'Broker-Demo'|Out-Null}"
            "catch{$duplicate=$_.Exception.Message};"
            "[pscustomobject]@{exact=$exact;partial=$partial;duplicate=$duplicate}|"
            "ConvertTo-Json -Compress"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        self.assertEqual(
            {
                "exact": 1,
                "partial": "SERVER_SELECTION_MISMATCH",
                "duplicate": "SERVER_SELECTION_MISMATCH",
            },
            json.loads(completed.stdout),
        )

    def test_server_catalog_refresh_rejects_stale_file_and_accepts_new_write(self) -> None:
        with tempfile.TemporaryDirectory() as appdata:
            body = (
                "$profile=Join-Path $env:APPDATA 'MetaQuotes\\Terminal\\profile-a';"
                "$config=Join-Path $profile 'config';New-Item -ItemType Directory $config -Force|Out-Null;"
                "$installation=Split-Path -Parent $env:MT5_TEST_TERMINAL;"
                "$utf8=New-Object Text.UTF8Encoding($false);"
                "[IO.File]::WriteAllText((Join-Path $profile 'origin.txt'),$installation,$utf8);"
                "$catalog=Join-Path $config 'servers.dat';Set-Content -LiteralPath $catalog -Value 'fixture';"
                "$notBefore=(Get-Date).ToUniversalTime();"
                "(Get-Item $catalog).LastWriteTimeUtc=$notBefore.AddMinutes(-5);"
                "$stale=Test-MT5VmServerCatalogRefreshBoundary "
                "$env:MT5_TEST_TERMINAL 'Broker-Demo' $notBefore;"
                "(Get-Item $catalog).LastWriteTimeUtc=$notBefore.AddSeconds(1);"
                "$fresh=Test-MT5VmServerCatalogRefreshBoundary "
                "$env:MT5_TEST_TERMINAL 'Broker-Demo' $notBefore;"
                "[pscustomobject]@{stale=$stale;fresh=$fresh}|ConvertTo-Json -Compress"
            )
            completed = self._run_module(
                body,
                extra_env={
                    "MT5_TEST_TERMINAL": r"C:\Program Files\Broker Fixture\terminal64.exe",
                    "APPDATA": appdata,
                },
            )
        self.assertEqual(0, completed.returncode, completed.stderr)
        self.assertEqual({"stale": False, "fresh": True}, json.loads(completed.stdout))

    def test_missing_post_ok_persistence_fails_and_restores_prior_state(self) -> None:
        body = (
            self._ui_boundaries(drop_commit=True)
            + "try {Set-MT5VmTerminalPythonApiSettings -ProcessId 701|Out-Null;exit 9}"
            "catch {[pscustomobject]@{caught=$_.Exception.Message;state=$script:persisted}|"
            "ConvertTo-Json -Compress -Depth 4;exit 0}"
        )
        completed = self._run_module(body)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertIn("persist", observed["caught"].casefold())
        self.assertEqual(0, observed["state"]["AllowAlgorithmicTrading"])
        self.assertEqual(1, observed["state"]["DisableExternalPythonApi"])

    def test_ipc_timeout_rolls_back_exact_snapshot(self) -> None:
        body = (
            self._process_boundaries()
            + self._ui_boundaries()
            + "$probe={return [pscustomobject]@{ExitCode=2;Result=[pscustomobject]@{"
            "status='BLOCKED';error_class='MT5_INITIALIZE_FAILED';last_error_code=-10005}}};"
            "$summary=Invoke-MT5VmTerminalPythonApiBootstrapCore "
            "-TerminalPath $env:MT5_TEST_TERMINAL -AccountAlias 'demo-alpha' "
            "-ProbeRunner $probe;"
            "[pscustomobject]@{summary=$summary;state=$script:persisted;"
            "closes=$script:closeCalls}|ConvertTo-Json -Compress -Depth 7"
        )
        completed = self._run_module(body, extra_env=self._terminal_env())
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertTrue(observed["summary"]["RolledBack"])
        self.assertFalse(observed["summary"]["SettingsRetained"])
        self.assertEqual(2, observed["summary"]["ExitCode"])
        self.assertEqual(0, observed["state"]["AllowAlgorithmicTrading"])
        self.assertEqual(1, observed["state"]["DisableExternalPythonApi"])
        self.assertEqual([], observed.get("closes") or [])

    def test_malformed_probe_failure_rolls_back_before_rethrow(self) -> None:
        body = (
            self._process_boundaries()
            + self._ui_boundaries()
            + "$probe={throw 'malformed sanitized probe result'};"
            "try {Invoke-MT5VmTerminalPythonApiBootstrapCore "
            "-TerminalPath $env:MT5_TEST_TERMINAL -AccountAlias 'demo-alpha' "
            "-ProbeRunner $probe|Out-Null;exit 9}"
            "catch {[pscustomobject]@{caught=$_.Exception.Message;state=$script:persisted}|"
            "ConvertTo-Json -Compress -Depth 5;exit 0}"
        )
        completed = self._run_module(body, extra_env=self._terminal_env())
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertIn("malformed", observed["caught"])
        self.assertEqual(0, observed["state"]["AllowAlgorithmicTrading"])
        self.assertEqual(1, observed["state"]["DisableExternalPythonApi"])

    def test_distinct_account_error_keeps_verified_approved_state(self) -> None:
        body = (
            self._process_boundaries()
            + self._ui_boundaries()
            + "$probe={return [pscustomobject]@{ExitCode=2;Result=[pscustomobject]@{"
            "status='BLOCKED';error_class='MT5_LOGIN_FAILED';last_error_code=-6}}};"
            "$summary=Invoke-MT5VmTerminalPythonApiBootstrapCore "
            "-TerminalPath $env:MT5_TEST_TERMINAL -AccountAlias 'demo-beta' "
            "-ProbeRunner $probe;"
            "[pscustomobject]@{summary=$summary;state=$script:persisted}|"
            "ConvertTo-Json -Compress -Depth 7"
        )
        completed = self._run_module(body, extra_env=self._terminal_env("Broker Beta"))
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertFalse(observed["summary"]["RolledBack"])
        self.assertTrue(observed["summary"]["SettingsRetained"])
        self.assertEqual(1, observed["state"]["AllowAlgorithmicTrading"])
        self.assertEqual(0, observed["state"]["DisableExternalPythonApi"])

    def test_cleanup_closes_only_a_process_started_by_bootstrap(self) -> None:
        body = (
            "$script:rows=@();$script:closeCalls=@();$script:startCalls=0;"
            "function Assert-MT5VmTrustedTerminalBoundary {param([string]$TerminalPath)};"
            "function Get-MT5VmTerminalProcessesBoundary {return @($script:rows)};"
            "function Start-MT5VmTerminalBoundary {param([string]$TerminalPath);"
            "$script:startCalls+=1;[pscustomobject]@{Id=811}};"
            "function Wait-MT5VmTerminalProcessBoundary {param([string]$TerminalPath,"
            "[int]$ProcessId);[pscustomobject]@{ProcessId=$ProcessId;"
            "ExecutablePath=$TerminalPath}};"
            "function Close-MT5VmOwnedTerminalBoundary {param([int]$ProcessId);"
            "$script:closeCalls+=,$ProcessId};"
            + self._ui_boundaries()
            + "$probe={return [pscustomobject]@{ExitCode=0;Result=[pscustomobject]@{"
            "status='PASS';error_class=$null;last_error_code=$null}}};"
            "$summary=Invoke-MT5VmTerminalPythonApiBootstrapCore "
            "-TerminalPath $env:MT5_TEST_TERMINAL -AccountAlias 'demo-owned' "
            "-ProbeRunner $probe;"
            "[pscustomobject]@{started=$summary.ProcessWasStarted;"
            "closes=$script:closeCalls}|ConvertTo-Json -Compress"
        )
        completed = self._run_module(body, extra_env=self._terminal_env())
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertTrue(observed["started"])
        self.assertEqual([811], observed["closes"])

    def test_restart_is_opt_in_and_default_never_calls_restart_boundary(self) -> None:
        body = (
            self._process_boundaries()
            + self._ui_boundaries()
            + "$script:restartCalls=0;"
            "function Close-MT5VmTerminalForRestartBoundary {"
            "param([string]$TerminalPath,[int]$ProcessId);"
            "$script:restartCalls+=1};"
            "$probe={return [pscustomobject]@{ExitCode=0;Result=[pscustomobject]@{"
            "status='PASS';error_class=$null;last_error_code=$null}}};"
            "$summary=Invoke-MT5VmTerminalPythonApiBootstrapCore "
            "-TerminalPath $env:MT5_TEST_TERMINAL -AccountAlias 'demo-default' "
            "-ProbeRunner $probe;"
            "[pscustomobject]@{restart_calls=$script:restartCalls;"
            "restarted=$summary.TerminalRestarted}|ConvertTo-Json -Compress"
        )
        completed = self._run_module(body, extra_env=self._terminal_env())
        self.assertEqual(0, completed.returncode, completed.stderr)
        self.assertEqual(
            {"restart_calls": 0, "restarted": False}, json.loads(completed.stdout)
        )

    def test_explicit_restart_closes_selected_pid_and_resolves_new_process(self) -> None:
        body = (
            self._process_boundaries()
            + self._ui_boundaries()
            + "$script:restartClosed=@();$script:restartResolved=@();"
            "function Close-MT5VmTerminalForRestartBoundary {"
            "param([string]$TerminalPath,[int]$ProcessId);"
            "$script:restartClosed+=,$ProcessId;"
            "if(-not [string]::Equals($TerminalPath,$env:MT5_TEST_TERMINAL,"
            "[StringComparison]::OrdinalIgnoreCase)){throw 'restart path mismatch'}};"
            "function Resolve-MT5VmRestartedTerminalProcessBoundary {"
            "param([string]$TerminalPath,[int]$PreviousProcessId);"
            "$script:restartResolved+=,$PreviousProcessId;"
            "[pscustomobject]@{TerminalPath=$TerminalPath;ProcessId=702;"
            "WasStarted=$false}};"
            "$probe={return [pscustomobject]@{ExitCode=0;Result=[pscustomobject]@{"
            "status='PASS';error_class=$null;last_error_code=$null}}};"
            "$summary=Invoke-MT5VmTerminalPythonApiBootstrapCore "
            "-TerminalPath $env:MT5_TEST_TERMINAL -AccountAlias 'demo-restart' "
            "-ProbeRunner $probe -RestartTerminalAfterSettings;"
            "[pscustomobject]@{closed=$script:restartClosed;"
            "resolved_from=$script:restartResolved;"
            "restarted=$summary.TerminalRestarted;retained=$summary.SettingsRetained}|"
            "ConvertTo-Json -Compress"
        )
        completed = self._run_module(body, extra_env=self._terminal_env())
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual([701], observed["closed"])
        self.assertEqual([701], observed["resolved_from"])
        self.assertTrue(observed["restarted"])
        self.assertTrue(observed["retained"])

    def test_ipc_timeout_after_restart_rolls_back_on_new_pid(self) -> None:
        body = (
            self._process_boundaries()
            + self._ui_boundaries()
            + "$script:restartClosed=@();"
            "function Close-MT5VmTerminalForRestartBoundary {"
            "param([string]$TerminalPath,[int]$ProcessId);"
            "$script:restartClosed+=,$ProcessId};"
            "function Resolve-MT5VmRestartedTerminalProcessBoundary {"
            "param([string]$TerminalPath,[int]$PreviousProcessId);"
            "[pscustomobject]@{TerminalPath=$TerminalPath;ProcessId=702;"
            "WasStarted=$false}};"
            "$probe={return [pscustomobject]@{ExitCode=2;Result=[pscustomobject]@{"
            "status='BLOCKED';error_class='MT5_INITIALIZE_FAILED';"
            "last_error_code=-10005}}};"
            "$summary=Invoke-MT5VmTerminalPythonApiBootstrapCore "
            "-TerminalPath $env:MT5_TEST_TERMINAL -AccountAlias 'demo-restart' "
            "-ProbeRunner $probe -RestartTerminalAfterSettings;"
            "[pscustomobject]@{summary=$summary;opened=$script:openedProcessIds;"
            "state=$script:persisted}|ConvertTo-Json -Compress -Depth 7"
        )
        completed = self._run_module(body, extra_env=self._terminal_env())
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertTrue(observed["summary"]["TerminalRestarted"])
        self.assertTrue(observed["summary"]["RolledBack"])
        self.assertEqual([701, 701, 702, 702], observed["opened"])
        self.assertEqual(0, observed["state"]["AllowAlgorithmicTrading"])
        self.assertEqual(1, observed["state"]["DisableExternalPythonApi"])

    def test_graceful_restart_failure_blocks_probe_and_restores_original_pid(self) -> None:
        body = (
            self._process_boundaries()
            + self._ui_boundaries()
            + "$script:probeCalls=0;"
            "function Close-MT5VmTerminalForRestartBoundary {"
            "throw 'simulated graceful restart failure'};"
            "$probe={$script:probeCalls+=1;return [pscustomobject]@{ExitCode=0;"
            "Result=[pscustomobject]@{status='PASS';error_class=$null;"
            "last_error_code=$null}}};"
            "try {Invoke-MT5VmTerminalPythonApiBootstrapCore "
            "-TerminalPath $env:MT5_TEST_TERMINAL -AccountAlias 'demo-restart' "
            "-ProbeRunner $probe -RestartTerminalAfterSettings|Out-Null;exit 9}"
            "catch {[pscustomobject]@{caught=$_.Exception.Message;"
            "probe_calls=$script:probeCalls;opened=$script:openedProcessIds;"
            "state=$script:persisted}|ConvertTo-Json -Compress -Depth 6;exit 0}"
        )
        completed = self._run_module(body, extra_env=self._terminal_env())
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertIn("simulated graceful restart failure", observed["caught"])
        self.assertEqual(0, observed["probe_calls"])
        self.assertEqual([701, 701, 701, 701], observed["opened"])
        self.assertEqual(0, observed["state"]["AllowAlgorithmicTrading"])
        self.assertEqual(1, observed["state"]["DisableExternalPythonApi"])

    def test_restarted_process_path_mismatch_never_reaches_wrong_pid_ui(self) -> None:
        body = (
            self._process_boundaries()
            + self._ui_boundaries()
            + "function Close-MT5VmTerminalForRestartBoundary {"
            "param([string]$TerminalPath,[int]$ProcessId)};"
            "function Resolve-MT5VmRestartedTerminalProcessBoundary {"
            "param([string]$TerminalPath,[int]$PreviousProcessId);"
            "[pscustomobject]@{TerminalPath=$env:MT5_OTHER_TERMINAL;"
            "ProcessId=702;WasStarted=$false}};"
            "$probe={return [pscustomobject]@{ExitCode=0;Result=[pscustomobject]@{"
            "status='PASS';error_class=$null;last_error_code=$null}}};"
            "try {Invoke-MT5VmTerminalPythonApiBootstrapCore "
            "-TerminalPath $env:MT5_TEST_TERMINAL -AccountAlias 'demo-mismatch' "
            "-ProbeRunner $probe -RestartTerminalAfterSettings|Out-Null;exit 9}"
            "catch {[pscustomobject]@{caught=$_.Exception.Message;"
            "opened=$script:openedProcessIds}|ConvertTo-Json -Compress;exit 0}"
        )
        env = self._terminal_env()
        env["MT5_OTHER_TERMINAL"] = (
            r"C:\Program Files\Unrelated Terminal\terminal64.exe"
        )
        completed = self._run_module(body, extra_env=env)
        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertIn("MT5_VM_ROLLBACK_FAILED", observed["caught"])
        self.assertEqual([701, 701], observed["opened"])


if __name__ == "__main__":
    unittest.main()
