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
