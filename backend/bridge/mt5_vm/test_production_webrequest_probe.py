from __future__ import annotations

import os
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
PROBE = REPO_ROOT / "tools" / "mt5-baremetal" / "MarketLensWebRequestProbe.mq5"
DRIVER = REPO_ROOT / "tools" / "mt5-baremetal" / "Invoke-MT5WebRequestProbe.ps1"
VERIFIER = REPO_ROOT / "tools" / "verify-production-worker-host-provision.ps1"
ALLOWLIST = REPO_ROOT / "tools" / "mt5-baremetal" / "Set-MT5WebRequestAllowlist.ps1"


class ProductionWebRequestProbeTests(unittest.TestCase):
    def run_source_contract(self, source: str, newline: str) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory(prefix="mt5-probe-contract-") as directory:
            driver = Path(directory) / "tools" / "mt5-baremetal" / DRIVER.name
            driver.parent.mkdir(parents=True)
            driver.write_bytes(source.replace("\n", newline).encode("utf-8"))
            return subprocess.run(
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy",
                 "Bypass", "-File", str(driver), "-ContractTestsOnly"],
                capture_output=True, text=True, check=False, timeout=30,
            )

    def test_probe_contract_accepts_lf_and_crlf(self) -> None:
        source = DRIVER.read_text(encoding="utf-8")
        for newline in ("\n", "\r\n"):
            with self.subTest(newline=repr(newline)):
                result = self.run_source_contract(source, newline)
                self.assertEqual(0, result.returncode, result.stderr)
                self.assertIn("PRODUCTION_WEBREQUEST_PROBE_CONTRACTS=PASS", result.stdout)
                self.assertIn("PRODUCTION_CUSTOM_CONFIG_STARTUP_CONTRACTS=PASS", result.stdout)

    def test_probe_contract_rejects_invalid_launch_in_each_line_ending(self) -> None:
        source = DRIVER.read_text(encoding="utf-8")
        launch = (
            "$terminalState.Value = Start-Process -FilePath $terminalPath `\n"
            "      -ArgumentList $probeConfigArgument `\n"
            "      -WindowStyle Hidden -PassThru"
        )
        self.assertEqual(1, source.count(launch))
        mutants = {
            "missing_config": launch.replace("$probeConfigArgument", "'/invalid'"),
            "portable": launch.replace("$probeConfigArgument", "'/portable'"),
            "profile": launch.replace("$probeConfigArgument", "'/profile:other'"),
            "duplicate": launch + "\n    " + launch,
        }
        for newline in ("\n", "\r\n"):
            for name, mutation in mutants.items():
                with self.subTest(newline=repr(newline), mutation=name):
                    result = self.run_source_contract(source.replace(launch, mutation), newline)
                    self.assertNotEqual(0, result.returncode, result.stdout)
                    self.assertIn("PROVISIONING_PROBE_CUSTOM_CONFIG_LAUNCH_INVALID", result.stderr)

    def run_driver(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(DRIVER),
                *arguments,
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )

    def test_probe_is_a_nonce_bound_no_trade_live_script(self) -> None:
        source = PROBE.read_text(encoding="utf-8")
        folded = source.casefold()

        self.assertIn("void OnStart()", source)
        self.assertIn('WebRequest("GET", PROBE_URL', source)
        self.assertIn('http://127.0.0.1/health', source)
        self.assertNotIn('http://127.0.0.1:8790/health', source)
        self.assertIn("FILE_COMMON", source)
        self.assertIn("TERMINAL_BUILD", source)
        self.assertIn("requestedAtUnix", source)
        self.assertIn("probeSucceeded", source)
        for forbidden in (
            "ordersend(",
            "ordercheck(",
            "ctrade",
            "accountinfo",
            "positionselect",
            "historydeal",
            "symbolinfotick",
        ):
            self.assertNotIn(forbidden, folded)

    def test_driver_declares_fail_closed_terminal_and_gateway_boundaries(self) -> None:
        source = DRIVER.read_text(encoding="utf-8")

        for required in (
            r"C:\Program Files\MetaTrader 5\terminal64.exe",
            r"backend\bin\execution-gateway.exe",
            "Get-NetTCPConnection",
            "Get-AuthenticodeSignature",
            "PROVISIONING_WEBREQUEST_ALLOWLIST_REQUIRED",
            "PROVISIONING_GATEWAY_LISTENER_MISMATCH",
            "PROVISIONING_PROBE_RECEIPT_INVALID",
            "$gatewayOrigin = 'http://127.0.0.1'",
            "$gatewayHealthUrl = 'http://127.0.0.1/health'",
            "WindowStyle Hidden",
            "Invoke-ProbeCustomConfigTransaction",
            "Remove-ProbeOwnedCustomConfig",
            ".marketlens-v39-probe.ini",
            "[IO.FileMode]::CreateNew",
            "PRODUCTION_CUSTOM_CONFIG_STARTUP_CONTRACTS=PASS",
        ):
            self.assertIn(required, source)
        self.assertNotIn("SendKeys", source)
        self.assertNotIn("Clipboard", source)
        self.assertNotIn("/profile:", source)
        self.assertNotIn("/portable", source)
        self.assertIn(
            "$terminalState.Value = Start-Process -FilePath $terminalPath `\n"
            "      -ArgumentList $probeConfigArgument `\n"
            "      -WindowStyle Hidden -PassThru",
            source,
        )

    def test_driver_crypto_is_compatible_with_windows_powershell_51(self) -> None:
        source = DRIVER.read_text(encoding="utf-8")

        for required in (
            "[Security.Cryptography.RandomNumberGenerator]::Create()",
            ".GetBytes(",
            "[Security.Cryptography.SHA256]::Create()",
            ".ComputeHash(",
            "[BitConverter]::ToString(",
            ".Dispose()",
            "PROVISIONING_PROBE_NONCE_INVALID",
        ):
            self.assertIn(required, source)
        for unavailable in (
            "[Security.Cryptography.RandomNumberGenerator]::Fill(",
            "[Convert]::ToHexString(",
            "[Security.Cryptography.SHA256]::HashData(",
        ):
            self.assertNotIn(unavailable, source)

    def test_driver_parser_and_contract_controls(self) -> None:
        parsed = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "$errors=$null;"
                "[void][Management.Automation.Language.Parser]::ParseFile("
                "$env:PROBE_DRIVER,[ref]$null,[ref]$errors);"
                "if($errors.Count){$errors|ForEach-Object{$_.Message};exit 1}",
            ],
            cwd=REPO_ROOT,
            env={**os.environ, "PROBE_DRIVER": str(DRIVER)},
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
        accepted = self.run_driver("-ContractTestsOnly")
        rejected = self.run_driver("-ContractTestsOnly", "-KnownBadControl")

        self.assertEqual(0, parsed.returncode, parsed.stderr)
        self.assertEqual(0, accepted.returncode, accepted.stderr)
        self.assertIn("PRODUCTION_WEBREQUEST_PROBE_CONTRACTS=PASS", accepted.stdout)
        self.assertIn("PRODUCTION_METAEDITOR_COMPILE_CONTRACTS=PASS", accepted.stdout)
        self.assertIn("PRODUCTION_POWERSHELL51_CRYPTO_CONTRACTS=PASS", accepted.stdout)
        self.assertNotEqual(0, rejected.returncode)
        self.assertIn("PROVISIONING_PROBE_RECEIPT_INVALID", rejected.stderr)


class ProductionRepairContractsTests(unittest.TestCase):
    def test_receipt_clock_is_utc_and_rejects_local_timezone_offsets(self) -> None:
        self.assertIn("long observed_at_unix=(long)TimeGMT();", PROBE.read_text(encoding="utf-8"))
        result = self.run_native_contract(r'''
$gatewayHealthUrl = 'http://127.0.0.1/health'
foreach ($offset in @(0, 25200, -18000)) {
  $receipt = [pscustomobject]@{
    schemaVersion = 1; nonce = '0123456789abcdef0123456789abcdef'; url = $gatewayHealthUrl
    httpStatus = 200; mt5Error = 0; terminalBuild = 6140
    requestedAtUnix = 1800000000; observedAtUnix = (1800000001 + $offset)
    responseOk = $true; responseService = $true; responseProtocol = $true; probeSucceeded = $true
  }
  $caught = ''
  try {
    Assert-ProbeReceipt -Receipt $receipt -ExpectedNonce '0123456789abcdef0123456789abcdef' `
      -ExpectedRequestedAtUnix 1800000000 -MaximumObservedAtUnix 1800000005
  } catch { $caught = $_.Exception.Message }
  if ($offset -eq 0) { Require ($caught -ceq '') }
  else { Require ($caught -ceq 'PROVISIONING_PROBE_RECEIPT_INVALID') }
}
'UTC_RECEIPT=PASS'
''')
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("UTC_RECEIPT=PASS", result.stdout)

    def test_native_commit_rollback_trace_requires_probe_and_restores(self) -> None:
        result = self.run_native_contract(r'''
$bytes = Fixture '0' ''
[IO.File]::WriteAllBytes($path, $bytes)
$state = [pscustomobject]@{ probes = 0 }
$result = Invoke-ProductionNativeAllowlistTransaction -CommonIniPath $path `
  -PreconditionAction {} -QuiesceAction {} -RollbackOnSuccess `
  -ApplyAction { [IO.File]::WriteAllBytes($path, (Fixture '1' 'AABBCC')) } `
  -ProbeAction { $state.probes++; return $true }
Require ($state.probes -eq 1 -and $result.probe_verified -eq $true -and $result.restored_prior -eq $true)
Require (Test-ProductionByteArrayEqual $bytes ([IO.File]::ReadAllBytes($path)))
Require (-not (Test-Path -LiteralPath $backup))
'NATIVE_TRACE=PASS'
''')
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("NATIVE_TRACE=PASS", result.stdout)

    def test_probe_custom_config_preserves_native_profile_and_acl(self) -> None:
        result = self.run_native_contract(r'''
$bytes = Fixture '1' ('A1' * 70)
[IO.File]::WriteAllBytes($path, $bytes)
$sddl = Get-ProductionAclSddl $path
$custom = Join-Path $env:REPAIR_TEMP '.marketlens-v39-probe.ini'
$result = Invoke-ProbeCustomConfigTransaction -DefaultPath $path -CustomPath $custom `
  -RunAction {
    param($snapshot)
    Require (Test-ProductionByteArrayEqual $bytes ([IO.File]::ReadAllBytes($path)))
    Require ((Get-ProbeAclSddl $custom) -ceq $sddl)
    return 'PROBE_EXECUTED'
  } -QuiesceAction {}
Require ($result -ceq 'PROBE_EXECUTED')
Require (Test-ProductionByteArrayEqual $bytes ([IO.File]::ReadAllBytes($path)))
Require ((Get-ProbeAclSddl $path) -ceq $sddl)
Require (-not (Test-Path -LiteralPath $custom))
Set-Acl -LiteralPath $path -AclObject (Get-Acl -LiteralPath $path)
$sddl = Get-ProductionAclSddl $path
$result = Invoke-ProbeCustomConfigTransaction -DefaultPath $path -CustomPath $custom `
  -RunAction { Require ((Get-ProbeAclSddl $custom) -ceq $sddl); return 'PROBE_EXECUTED' } `
  -QuiesceAction {}
Require ($result -ceq 'PROBE_EXECUTED')
Require ((Get-ProbeAclSddl $path) -ceq $sddl)
Require (-not (Test-Path -LiteralPath $custom))
'NATIVE_CUSTOM_CONFIG=PASS'
''')
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("NATIVE_CUSTOM_CONFIG=PASS", result.stdout)

    def test_native_allowlist_rejects_hostile_inputs_before_actions(self) -> None:
        result = self.run_native_contract(r'''
foreach ($kind in @('duplicate', 'encoding', 'oversized', 'invalid_switch', 'nul', 'recovery')) {
  $bytes = Fixture '1' 'AABB'
  switch ($kind) {
    'duplicate' { $bytes = Fixture '1' "AABB`r`nWebRequestUrl=CCDD" }
    'encoding' { $bytes = [Text.Encoding]::UTF8.GetBytes('[Experts]') }
    'oversized' { $bytes = Fixture '1' ('A' * 16385) }
    'invalid_switch' { $bytes = Fixture '2' 'AABB' }
    'nul' { $bytes = Fixture '1' ([string][char]0) }
    'recovery' { [IO.File]::WriteAllBytes($backup, [byte[]]@(1,2,3)) }
  }
  [IO.File]::WriteAllBytes($path, $bytes)
  $caught = ''
  try {
    $null = Invoke-ProductionNativeAllowlistTransaction -CommonIniPath $path `
      -PreconditionAction {} -ProbeAction {throw 'UNEXPECTED_ACTION'} `
      -ApplyAction {throw 'UNEXPECTED_ACTION'} -QuiesceAction {throw 'UNEXPECTED_ACTION'}
  } catch { $caught = $_.Exception.Message }
  $expected = if ($kind -ceq 'recovery') { 'PROVISIONING_WEBREQUEST_ALLOWLIST_RECOVERY_STATE_INVALID' } else { 'PROVISIONING_WEBREQUEST_ALLOWLIST_SCHEMA_INVALID' }
  Require ($caught -ceq $expected)
  Require (Test-ProductionByteArrayEqual $bytes ([IO.File]::ReadAllBytes($path)))
  if ($kind -ceq 'recovery') { Require (([IO.File]::ReadAllBytes($backup) -join ',') -ceq '1,2,3') }
  else { Require (-not (Test-Path -LiteralPath $backup)) }
}
'NATIVE_HOSTILE_INPUTS=PASS'
''')
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("NATIVE_HOSTILE_INPUTS=PASS", result.stdout)

    def test_mutation_runner_accepts_mixed_source_line_endings(self) -> None:
        for source_newline, verifier_newline in (("\n", "\r\n"), ("\r\n", "\n")):
            with self.subTest(source=repr(source_newline), verifier=repr(verifier_newline)):
                with tempfile.TemporaryDirectory(prefix="mt5-mutant-eol-") as directory:
                    root = Path(directory)
                    driver = root / "tools" / "mt5-baremetal" / DRIVER.name
                    verifier = root / "tools" / VERIFIER.name
                    driver.parent.mkdir(parents=True)
                    original = DRIVER.read_text(encoding="utf-8").replace("\n", source_newline).encode()
                    driver.write_bytes(original)
                    verifier.write_bytes(VERIFIER.read_text(encoding="utf-8").replace("\n", verifier_newline).encode())
                    result = subprocess.run(
                        ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                         "-File", str(verifier), "-ProbeMutationTestsOnly"],
                        capture_output=True, text=True, check=False, timeout=60,
                    )
                    self.assertEqual(0, result.returncode, result.stderr)
                    self.assertIn("PRODUCTION_WEBREQUEST_PROBE_MUTATION=3/3", result.stdout)
                    self.assertEqual(original, driver.read_bytes())

    def test_production_entrypoint_uses_native_settings_and_real_probe(self) -> None:
        source = ALLOWLIST.read_text(encoding="utf-8")
        production = source[source.rindex("$commonIniPath = Join-Path $selectedProfile"):]
        self.assertIn("Invoke-ProductionNativeAllowlistTransaction", production)
        self.assertIn("Invoke-ProductionNativeSettings", production)
        self.assertIn("Invoke-ProductionAllowlistProbe", production)
        self.assertNotIn("Invoke-ProductionWebRequestCommonIniTransaction", production)
        self.assertNotIn("Convert-ProductionWebRequestCommonIni", production)

    def test_permission_failure_requires_fresh_receipt_identity(self) -> None:
        result = self.run_native_contract(r'''
$gatewayHealthUrl = 'http://127.0.0.1/health'
foreach ($stale in @($false, $true)) {
  $receipt = [pscustomobject]@{
    schemaVersion = 1; nonce = '0123456789abcdef0123456789abcdef'; url = $gatewayHealthUrl
    httpStatus = -1; mt5Error = 4014; terminalBuild = 6140
    requestedAtUnix = 100; observedAtUnix = 101
    responseOk = $false; responseService = $false; responseProtocol = $false; probeSucceeded = $false
  }
  if ($stale) { $receipt.nonce = '00000000000000000000000000000000' }
  $caught = ''
  try {
    Assert-ProbeReceipt -Receipt $receipt -ExpectedNonce '0123456789abcdef0123456789abcdef' `
      -ExpectedRequestedAtUnix 100 -MaximumObservedAtUnix 105 -AllowPermissionFailure
  } catch { $caught = $_.Exception.Message }
  $expected = if ($stale) { 'PROVISIONING_PROBE_RECEIPT_INVALID' } else { 'PROVISIONING_WEBREQUEST_ALLOWLIST_REQUIRED' }
  Require ($caught -ceq $expected)
}
'PERMISSION_RECEIPT=PASS'
''')
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("PERMISSION_RECEIPT=PASS", result.stdout)

    def run_native_contract(self, body: str) -> subprocess.CompletedProcess[str]:
        script = r'''
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$maximumCommonIniBytes = 1048576
foreach ($source in @($env:REPAIR_ALLOWLIST, $env:REPAIR_DRIVER)) {
  $ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$null, [ref]$null)
  foreach ($node in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]}, $false)) {
    . ([scriptblock]::Create($node.Extent.Text))
  }
}
$path = Join-Path $env:REPAIR_TEMP 'common.ini'
$backup = $path + '.marketlens-native.bak'
function Require([bool]$condition) { if (-not $condition) { throw 'NATIVE_CONTRACT_ASSERTION_FAILED' } }
function Fixture([string]$enabled, [string]$value) {
  return ,(New-ProductionUtf16LeBomBytes -Text (
    "[General]`r`nUntouched=fixture`r`n[Experts]`r`nWebRequest=$enabled`r`nWebRequestUrl=$value`r`n[Other]`r`nValue=preserve`r`n"))
}
''' + body
        with tempfile.TemporaryDirectory(prefix="mt5-native-contract-") as directory:
            return subprocess.run(
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                env={**os.environ, "REPAIR_TEMP": directory, "REPAIR_ALLOWLIST": str(ALLOWLIST),
                     "REPAIR_DRIVER": str(DRIVER)},
                capture_output=True, text=True, check=False, timeout=60,
            )

    def test_allowlist_preserves_opaque_profile_values(self) -> None:
        result = self.run_native_contract(r'''
foreach ($length in @(2, 16, 70, 128)) {
  $opaque = 'A1' * $length
  $bytes = Fixture '1' $opaque
  [IO.File]::WriteAllBytes($path, $bytes)
  $sddl = Get-ProductionAclSddl $path
  $events = [Collections.Generic.List[string]]::new()
  $result = Invoke-ProductionNativeAllowlistTransaction -CommonIniPath $path `
    -PreconditionAction { $events.Add('precondition') } `
    -ProbeAction { $events.Add('probe'); return $true } `
    -ApplyAction { throw 'MUST_NOT_APPLY_WORKING_PROFILE' } `
    -QuiesceAction { $events.Add('quiesce') }
  Require ($result.status -ceq 'UNCHANGED' -and $result.probe_verified -eq $true)
  Require (($events -join ',') -ceq 'precondition,probe,quiesce')
  Require (Test-ProductionByteArrayEqual $bytes ([IO.File]::ReadAllBytes($path)))
  Require ((Get-ProductionAclSddl $path) -ceq $sddl)
  Require (-not (Test-Path -LiteralPath $backup))
  $startup = Convert-ProbeDefaultConfigStartup -Bytes $bytes
  Require ($startup.DesiredBytes.Length -gt $bytes.Length)
  for ($i = 0; $i -lt $bytes.Length; $i++) { Require ($startup.DesiredBytes[$i] -eq $bytes[$i]) }
}
'OPAQUE_PROFILE=PASS'
''')
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("OPAQUE_PROFILE=PASS", result.stdout)

    def test_native_allowlist_applies_only_after_permission_failure_or_disabled(self) -> None:
        result = self.run_native_contract(r'''
foreach ($enabled in @('0', '1')) {
  $bytes = Fixture $enabled 'AABBCC'
  [IO.File]::WriteAllBytes($path, $bytes)
  $events = [Collections.Generic.List[string]]::new()
  $state = [pscustomobject]@{ applied = $false }
  $result = Invoke-ProductionNativeAllowlistTransaction -CommonIniPath $path `
    -PreconditionAction {} -QuiesceAction {} `
    -ProbeAction {
      $events.Add('probe')
      if (-not $state.applied) { throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_REQUIRED' }
      return $true
    } -ApplyAction {
      $events.Add('apply'); $state.applied = $true
      [IO.File]::WriteAllBytes($path, (Fixture '1' 'DDEEFF'))
    }
  $expected = if ($enabled -ceq '1') { 'probe,apply,probe' } else { 'apply,probe' }
  Require (($events -join ',') -ceq $expected)
  Require ($result.status -ceq 'APPLIED' -and $result.probe_verified -eq $true)
  Require (Test-ProductionByteArrayEqual (Fixture '1' 'DDEEFF') ([IO.File]::ReadAllBytes($path)))
  Require (-not (Test-Path -LiteralPath $backup))
}
'NATIVE_APPLY=PASS'
''')
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("NATIVE_APPLY=PASS", result.stdout)

    def test_probe_and_settings_failure_restore_owned_state(self) -> None:
        result = self.run_native_contract(r'''
foreach ($failure in @('launch', 'receipt', 'false', 'shutdown', 'settings', 'drift')) {
  $bytes = Fixture '0' ''
  [IO.File]::WriteAllBytes($path, $bytes)
  $sddl = Get-ProductionAclSddl $path
  $state = [pscustomobject]@{ closes = 0 }
  $caught = ''
  try {
    $null = Invoke-ProductionNativeAllowlistTransaction -CommonIniPath $path `
      -PreconditionAction {} -ApplyAction {
        [IO.File]::WriteAllBytes($path, (Fixture '1' 'AABBCC'))
        if ($failure -ceq 'settings') { throw 'INJECTED_SETTINGS_FAILURE' }
      } -ProbeAction {
        if ($failure -ceq 'false') { return $false }
        if ($failure -ceq 'drift') {
          [IO.File]::WriteAllBytes($path, (Fixture '1' 'DDEEFF'))
          return $true
        }
        if ($failure -ceq 'shutdown') { return $true }
        throw 'INJECTED_PROBE_FAILURE'
      } -QuiesceAction {
        $state.closes++
        if ($failure -ceq 'shutdown' -and $state.closes -eq 2) { throw 'INJECTED_SHUTDOWN_FAILURE' }
      }
  } catch { $caught = $_.Exception.Message }
  $expected = switch ($failure) {
    'settings' { 'INJECTED_SETTINGS_FAILURE' }
    'false' { 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED' }
    'shutdown' { 'INJECTED_SHUTDOWN_FAILURE' }
    'drift' { 'PROVISIONING_WEBREQUEST_ALLOWLIST_PERSIST_FAILED' }
    default { 'INJECTED_PROBE_FAILURE' }
  }
  Require ($caught -ceq $expected)
  Require (Test-ProductionByteArrayEqual $bytes ([IO.File]::ReadAllBytes($path)))
  Require ((Get-ProductionAclSddl $path) -ceq $sddl)
  Require (-not (Test-Path -LiteralPath $backup))
}
'NATIVE_RESTORE=PASS'
''')
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("NATIVE_RESTORE=PASS", result.stdout)

    def test_native_allowlist_rollback_failure_retains_backup(self) -> None:
        result = self.run_native_contract(r'''
$bytes = Fixture '0' ''
[IO.File]::WriteAllBytes($path, $bytes)
$caught = ''
try {
  $null = Invoke-ProductionNativeAllowlistTransaction -CommonIniPath $path `
    -PreconditionAction {} -ApplyAction { throw 'INJECTED_SETTINGS_FAILURE' } `
    -ProbeAction { throw 'UNEXPECTED_PROBE' } `
    -QuiesceAction { throw 'INJECTED_UNSAFE_TO_RESTORE' }
} catch { $caught = $_.Exception.Message }
Require ($caught -ceq 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED')
Require (Test-Path -LiteralPath $backup)
Require (Test-ProductionByteArrayEqual $bytes ([IO.File]::ReadAllBytes($backup)))
'NATIVE_RECOVERY=PASS'
''')
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("NATIVE_RECOVERY=PASS", result.stdout)

    def run_guard(self, *, changed: list[str], dirty: list[str] | None = None,
                  git_failure: str = "") -> subprocess.CompletedProcess[str]:
        # Load the actual guard; only the external Git boundary is a fixture.
        script = r'''
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = $env:REPAIR_REPO
$ast = [Management.Automation.Language.Parser]::ParseFile($env:REPAIR_VERIFIER, [ref]$null, [ref]$null)
foreach ($name in @('Assert-Gate', 'Assert-NativeSuccess', 'Assert-ApprovedSourceState')) {
  $node = $ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name}, $true)
  if ($null -eq $node) { throw 'FIXTURE_FUNCTION_MISSING' }
  . ([scriptblock]::Create($node.Extent.Text))
}
$assignment = $ast.Find({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$baselineCommit'}, $true)
if ($null -eq $assignment) { throw 'FIXTURE_BASELINE_MISSING' }
. ([scriptblock]::Create($assignment.Extent.Text))
function git {
  $global:LASTEXITCODE = 0
  if ($args -contains 'merge-base') {
    if ($env:REPAIR_GIT_FAILURE -eq 'ancestry') { $global:LASTEXITCODE = 1 }
    return
  }
  if ($args -contains '--name-only') {
    if ($env:REPAIR_GIT_FAILURE -eq 'diff') { $global:LASTEXITCODE = 128; return }
    if ($args -notcontains '7bcfeb891c6b76048c471af8c8dd0738177b2b56..HEAD') {
      'frontend/tests/shims/ky.ts'
    }
    foreach ($path in ($env:REPAIR_CHANGED | ConvertFrom-Json)) { $path }
    return
  }
  if ($args -contains 'status') {
    if ($env:REPAIR_GIT_FAILURE -eq 'status') { $global:LASTEXITCODE = 128; return }
    foreach ($path in ($env:REPAIR_DIRTY | ConvertFrom-Json)) { $path }
    return
  }
  if ($args -contains '--check') {
    if ($env:REPAIR_GIT_FAILURE -eq 'check') { $global:LASTEXITCODE = 2 }
    return
  }
  throw 'FIXTURE_UNEXPECTED_GIT_COMMAND'
}
Assert-ApprovedSourceState
'SOURCE_GUARD=PASS'
'''
        return subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
            env={**os.environ, "REPAIR_REPO": str(REPO_ROOT), "REPAIR_VERIFIER": str(VERIFIER),
                 "REPAIR_CHANGED": json.dumps(changed), "REPAIR_DIRTY": json.dumps(dirty or []),
                 "REPAIR_GIT_FAILURE": git_failure},
            capture_output=True, text=True, check=False, timeout=30,
        )

    def test_source_guard_accepts_integrated_baseline_and_task_delta(self) -> None:
        result = self.run_guard(changed=[
            "tools/mt5-baremetal/Invoke-MT5WebRequestProbe.ps1",
            "tools/verify-mt5-production-repair.ps1",
            "docs/agent-evidence/mt5-production-repair/SPEC.md",
            "docs/agent-evidence/mt5-production-repair/EVIDENCE.md",
        ])
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("SOURCE_GUARD=PASS", result.stdout)

    def test_source_guard_rejects_unrelated_change(self) -> None:
        for changed in (["backend/internal/httpserver/server.go"], ["unreviewed.ps1"]):
            with self.subTest(changed=changed):
                result = self.run_guard(changed=changed)
                self.assertNotEqual(0, result.returncode)
                self.assertIn("PROVISIONING_UNAPPROVED_TRACKED_PATH", result.stderr)

    def test_source_guard_rejects_dirty_runtime_checkout(self) -> None:
        result = self.run_guard(changed=[], dirty=[" M tools/mt5-baremetal/Invoke-MT5WebRequestProbe.ps1"])
        self.assertNotEqual(0, result.returncode)
        self.assertIn("PROVISIONING_WORKTREE_NOT_CLEAN", result.stderr)

    def test_source_guard_rejects_git_errors(self) -> None:
        for operation, code in (("ancestry", "PROVISIONING_BASELINE_NOT_ANCESTOR"),
                                ("diff", "PROVISIONING_GIT_DIFF_FAILED"),
                                ("status", "PROVISIONING_GIT_STATUS_FAILED"),
                                ("check", "PROVISIONING_DIFF_CHECK_FAILED")):
            with self.subTest(operation=operation):
                result = self.run_guard(changed=[], git_failure=operation)
                self.assertNotEqual(0, result.returncode)
                self.assertIn(code, result.stderr)


if __name__ == "__main__":
    unittest.main()
