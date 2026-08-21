from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
TOOLS = ROOT / "tools" / "mt5-vm-image"
INSTALL = TOOLS / "Install-MT5VmTerminalSlots.ps1"
MANIFEST = TOOLS / "Test-MT5VmImageManifest.ps1"
IMAGE = TOOLS / "New-MT5VmGoldenImage.ps1"
SCALE = TOOLS / "New-MT5VmHyperVWorker.ps1"
BOOTSTRAP = TOOLS / "Enable-MT5VmHyperV.ps1"


@unittest.skipUnless(sys.platform == "win32", "local image automation is Windows-only")
class LocalImageAutomationTests(unittest.TestCase):
    def _run(self, script: Path, command: str) -> subprocess.CompletedProcess[str]:
        self.assertTrue(script.exists(), f"missing approved automation script: {script}")
        return subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;"
                ". $env:MT5_IMAGE_SCRIPT;"
                + command,
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
            env={**os.environ, "MT5_IMAGE_SCRIPT": str(script)},
        )

    def test_slot_install_is_dry_run_by_default_and_uses_vendor_unattended_flags(self) -> None:
        completed = self._run(
            INSTALL,
            "$script:installed=@{};$script:calls=@();"
            "function Get-MT5VmInstallerAttestationBoundary {"
            "[pscustomobject]@{sha256=('a'*64);signature_status='Valid';"
            "signer_subject='CN=MetaQuotes Ltd.'}};"
            "function Get-MT5VmInstalledSlotAttestationBoundary {param($TerminalPath);"
            "if($script:installed.ContainsKey($TerminalPath)){"
            "[pscustomobject]@{exists=$true;valid=$true;terminal_sha256=('b'*64);"
            "servers_sha256=('c'*64);terminal_license_sha256=('d'*64);"
            "data_profile_hash=('e'*32)}}else{[pscustomobject]@{exists=$false;valid=$false}}};"
            "function Invoke-MT5VmSlotInstallerBoundary {param($InstallerPath,$Arguments,$TerminalPath);"
            "$script:calls+=,[pscustomobject]@{arguments=$Arguments;terminal_path=$TerminalPath};"
            "$script:installed[$TerminalPath]=$true;0};"
            "$dry=Invoke-MT5VmTerminalSlotInstallCore -InstallerPath 'C:\\Staging\\mt5setup.exe' "
            "-ExpectedInstallerSha256 ('a'*64) -ExpectedSignerPattern 'MetaQuotes' "
            "-SlotRoot 'C:\\Slots' -SlotCount 2 -AcceptMetaQuotesEula;"
            "$live=Invoke-MT5VmTerminalSlotInstallCore -InstallerPath 'C:\\Staging\\mt5setup.exe' "
            "-ExpectedInstallerSha256 ('a'*64) -ExpectedSignerPattern 'MetaQuotes' "
            "-SlotRoot 'C:\\Slots' -SlotCount 2 -AcceptMetaQuotesEula -Execute;"
            "[pscustomobject]@{dry=$dry;live=$live;calls=$script:calls}|"
            "ConvertTo-Json -Compress -Depth 8",
        )

        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertTrue(observed["dry"]["dry_run"])
        self.assertEqual(0, observed["dry"]["installed_count"])
        self.assertEqual(2, observed["live"]["installed_count"])
        self.assertEqual(2, len(observed["calls"]))
        for index, call in enumerate(observed["calls"], start=1):
            self.assertEqual("/auto", call["arguments"][0])
            self.assertEqual(
                f'/path:"C:\\Slots\\slot-{index:02d}"', call["arguments"][1]
            )
            self.assertNotIn("login", json.dumps(call).casefold())
            self.assertNotIn("password", json.dumps(call).casefold())

    def test_slot_install_rejects_hash_or_signer_before_invocation(self) -> None:
        completed = self._run(
            INSTALL,
            "$script:calls=0;"
            "function Get-MT5VmInstallerAttestationBoundary {"
            "[pscustomobject]@{sha256=('a'*64);signature_status='Valid';signer_subject='Other'}};"
            "function Invoke-MT5VmSlotInstallerBoundary {$script:calls++;0};"
            "$errors=@();foreach($case in @('hash','signer')){try{"
            "$hash=if($case -eq 'hash'){('b'*64)}else{('a'*64)};"
            "$signer=if($case -eq 'signer'){'MetaQuotes'}else{'Other'};"
            "Invoke-MT5VmTerminalSlotInstallCore -InstallerPath 'C:\\Staging\\mt5setup.exe' "
            "-ExpectedInstallerSha256 $hash -ExpectedSignerPattern $signer "
            "-SlotRoot 'C:\\Slots' -SlotCount 1 -AcceptMetaQuotesEula -Execute|Out-Null"
            "}catch{$errors+=,$_.Exception.Message}};"
            "[pscustomobject]@{errors=$errors;calls=$script:calls}|ConvertTo-Json -Compress",
        )

        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual(
            ["INSTALLER_HASH_MISMATCH", "INSTALLER_SIGNER_MISMATCH"], observed["errors"]
        )
        self.assertEqual(0, observed["calls"])

    def test_full_post_install_attestation_is_authoritative_over_exit_code(self) -> None:
        completed = self._run(
            INSTALL,
            "$script:installed=$false;"
            "function Get-MT5VmInstallerAttestationBoundary {"
            "[pscustomobject]@{sha256=('a'*64);signature_status='Valid';"
            "signer_subject='CN=MetaQuotes Ltd.'}};"
            "function Get-MT5VmInstalledSlotAttestationBoundary {param($TerminalPath);"
            "if($script:installed){[pscustomobject]@{exists=$true;valid=$true;"
            "terminal_sha256=('b'*64);servers_sha256=('c'*64);"
            "terminal_license_sha256=('d'*64);data_profile_hash=('e'*32)}}"
            "else{[pscustomobject]@{exists=$false;valid=$false}}};"
            "function Invoke-MT5VmSlotInstallerBoundary {$script:installed=$true;1};"
            "$result=Invoke-MT5VmTerminalSlotInstallCore "
            "-InstallerPath 'C:\\Staging\\mt5setup.exe' "
            "-ExpectedInstallerSha256 ('a'*64) -ExpectedSignerPattern 'MetaQuotes' "
            "-SlotRoot 'C:\\Slots' -SlotCount 1 -AcceptMetaQuotesEula -Execute;"
            "$result|ConvertTo-Json -Compress -Depth 6",
        )

        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual("PASS", observed["status"])
        self.assertEqual(1, observed["installed_count"])

    def test_slot_profile_resolver_returns_directory_containing_origin_file(self) -> None:
        completed = self._run(
            INSTALL,
            "$root=Join-Path ([IO.Path]::GetTempPath()) ('slot-profile-'+[guid]::NewGuid().ToString('N'));"
            "$profile=Join-Path $root 'profile-a';New-Item -ItemType Directory $profile|Out-Null;"
            "$installRoot='C:\\Slots\\slot-01';"
            "$utf8=New-Object Text.UTF8Encoding($false);"
            "[IO.File]::WriteAllText((Join-Path $profile 'origin.txt'),$installRoot,$utf8);"
            "try{$resolved=Resolve-MT5VmDataProfileBoundary "
            "-TerminalStateRoot $root -InstallRoot $installRoot;"
            "[pscustomobject]@{name=$resolved.Name;path=$resolved.FullName}|"
            "ConvertTo-Json -Compress}finally{"
            "$tempPrefix=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\\')+'\\';"
            "$full=[IO.Path]::GetFullPath($root);if($full.StartsWith($tempPrefix)){"
            "Remove-Item -LiteralPath $full -Recurse -Force}}",
        )

        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual("profile-a", observed["name"])
        self.assertTrue(observed["path"].endswith("profile-a"))

    def test_manifest_accepts_attested_distinct_slots_and_rejects_duplicates(self) -> None:
        completed = self._run(
            MANIFEST,
            "$slot=[pscustomobject]@{slot_id='slot-01';terminal_path='C:\\Slots\\slot-01\\terminal64.exe';"
            "terminal_sha256=('a'*64);servers_sha256=('b'*64);"
            "terminal_license_sha256=('c'*64);data_profile_hash=('d'*32)};"
            "$valid=[pscustomobject]@{schema_version=1;image_version='image-20260821';"
            "generated_at='2026-08-21T00:00:00Z';slots=@($slot)};"
            "$duplicate=[pscustomobject]@{schema_version=1;image_version='image-20260821';"
            "generated_at='2026-08-21T00:00:00Z';slots=@($slot,$slot)};"
            "$ok=Test-MT5VmImageManifestObject -Manifest $valid;"
            "$caughtError=$null;try{Test-MT5VmImageManifestObject -Manifest $duplicate|Out-Null}"
            "catch{$caughtError=$_.Exception.Message};"
            "[pscustomobject]@{ok=$ok;error=$caughtError}|ConvertTo-Json -Compress",
        )

        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertTrue(observed["ok"])
        self.assertEqual("DUPLICATE_TERMINAL_SLOT", observed["error"])

    def test_image_publication_occurs_after_attestation_and_rolls_back_exact_stage(self) -> None:
        completed = self._run(
            IMAGE,
            "$script:events=@();$script:attest=$true;"
            "function New-MT5VmImageStageBoundary {param($BuildId,$StagePath,$BaseVhdxPath);"
            "$script:events+=,'stage';[pscustomobject]@{build_id=$BuildId;stage_path=$StagePath}};"
            "function Invoke-MT5VmImageProvisionBoundary {$script:events+=,'provision'};"
            "function Test-MT5VmImageAttestationBoundary {$script:events+=,'attest';$script:attest};"
            "function Test-MT5VmImageSelfTestBoundary {$script:events+=,'selftest';$true};"
            "function Publish-MT5VmImageBoundary {$script:events+=,'publish'};"
            "function Remove-MT5VmImageStageBoundary {param($BuildId,$StagePath);"
            "$script:events+=,('cleanup:'+$BuildId+':'+$StagePath)};"
            "$success=Invoke-MT5VmGoldenImageBuildCore -BuildId 'build-a' "
            "-BaseVhdxPath 'C:\\Base\\base.vhdx' -StagingRoot 'C:\\Stage' "
            "-PublishedRoot 'C:\\Published' -ImageVersion 'image-a' -Execute;"
            "$successEvents=@($script:events);$script:events=@();$script:attest=$false;$caughtError=$null;"
            "try{Invoke-MT5VmGoldenImageBuildCore -BuildId 'build-b' "
            "-BaseVhdxPath 'C:\\Base\\base.vhdx' -StagingRoot 'C:\\Stage' "
            "-PublishedRoot 'C:\\Published' -ImageVersion 'image-b' -Execute|Out-Null}"
            "catch{$caughtError=$_.Exception.Message};"
            "[pscustomobject]@{success=$success;success_events=$successEvents;"
            "failure_events=$script:events;error=$caughtError}|ConvertTo-Json -Compress -Depth 6",
        )

        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual(
            ["stage", "provision", "attest", "selftest", "publish"],
            observed["success_events"],
        )
        self.assertEqual("PASS", observed["success"]["status"])
        self.assertEqual("IMAGE_ATTESTATION_FAILED", observed["error"])
        self.assertNotIn("publish", observed["failure_events"])
        self.assertEqual(
            "cleanup:build-b:C:\\Stage\\build-b", observed["failure_events"][-1]
        )

    def test_scale_requests_coalesce_and_unhealthy_clone_never_registers(self) -> None:
        completed = self._run(
            SCALE,
            "$script:generation=$null;$script:healthy=$true;$script:events=@();"
            "function Enter-MT5VmScaleLockBoundary {$script:events+=,'lock';$true};"
            "function Exit-MT5VmScaleLockBoundary {$script:events+=,'unlock'};"
            "function Get-MT5VmScaleStateBoundary {param($CapacityGeneration);"
            "[pscustomobject]@{generation_exists=($script:generation -eq $CapacityGeneration);"
            "worker_count=1;free_disk_gb=500}};"
            "function New-MT5VmWorkerCloneBoundary {param($CapacityGeneration);"
            "$script:events+=,'clone';$script:generation=$CapacityGeneration;"
            "[pscustomobject]@{worker_id='worker-new';capacity_generation=$CapacityGeneration}};"
            "function Test-MT5VmWorkerHealthBoundary {$script:events+=,'health';$script:healthy};"
            "function Register-MT5VmWorkerBoundary {$script:events+=,'register'};"
            "$policy=[pscustomobject]@{max_workers=3;minimum_free_disk_gb=100};"
            "$first=Invoke-MT5VmHyperVScaleCore -CapacityGeneration 7 -Policy $policy -Execute;"
            "$second=Invoke-MT5VmHyperVScaleCore -CapacityGeneration 7 -Policy $policy -Execute;"
            "$script:generation=$null;$script:healthy=$false;$caughtError=$null;"
            "try{Invoke-MT5VmHyperVScaleCore -CapacityGeneration 8 -Policy $policy -Execute|Out-Null}"
            "catch{$caughtError=$_.Exception.Message};"
            "[pscustomobject]@{first=$first;second=$second;events=$script:events;error=$caughtError}|"
            "ConvertTo-Json -Compress -Depth 6",
        )

        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual("CREATED", observed["first"]["status"])
        self.assertEqual("COALESCED", observed["second"]["status"])
        self.assertEqual(2, observed["events"].count("clone"))
        self.assertEqual(1, observed["events"].count("register"))
        self.assertEqual("WORKER_HEALTH_FAILED", observed["error"])

    def test_hyperv_enablement_requires_both_switches_and_no_running_worker(self) -> None:
        completed = self._run(
            BOOTSTRAP,
            "$blocked=Get-MT5VmHyperVBootstrapPlan -HyperVPresent:$false "
            "-EnableHyperV:$true -AllowReboot:$false -TradingWorkerCount 0;"
            "$ready=Get-MT5VmHyperVBootstrapPlan -HyperVPresent:$false "
            "-EnableHyperV:$true -AllowReboot:$true -TradingWorkerCount 0;"
            "$caughtError=$null;try{Get-MT5VmHyperVBootstrapPlan -HyperVPresent:$false "
            "-EnableHyperV:$true -AllowReboot:$true -TradingWorkerCount 1|Out-Null}"
            "catch{$caughtError=$_.Exception.Message};"
            "[pscustomobject]@{blocked=$blocked;ready=$ready;error=$caughtError}|"
            "ConvertTo-Json -Compress -Depth 5",
        )

        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertFalse(observed["blocked"]["change_allowed"])
        self.assertTrue(observed["ready"]["change_allowed"])
        self.assertTrue(observed["ready"]["reboot_allowed"])
        self.assertEqual("TRADING_WORKER_RUNNING", observed["error"])

    def test_account_runtime_has_no_installer_or_hyperv_capability(self) -> None:
        runtime_files = [
            ROOT / "backend" / "execution" / "crates" / "mt5-vm-agent" / "src" / "managed.rs",
            ROOT / "backend" / "execution" / "crates" / "mt5-vm-agent" / "src" / "process.rs",
            ROOT / "backend" / "execution" / "crates" / "execution-gateway" / "src" / "mt5_vm_control.rs",
            ROOT / "backend" / "bridge" / "mt5_vm" / "phase1_adapter.py",
        ]
        forbidden = ("mt5setup", "/auto", "new-vm", "enable-windowsoptionalfeature")
        for path in runtime_files:
            source = path.read_text(encoding="utf-8").casefold()
            for token in forbidden:
                self.assertNotIn(token, source, f"{token} leaked into {path}")


if __name__ == "__main__":
    unittest.main()
