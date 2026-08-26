from __future__ import annotations

import json
import hashlib
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
INSTALLER = ROOT / "tools" / "mt5-baremetal" / "Install-MT5BareMetalWorker.ps1"
LAUNCHER = ROOT / "tools" / "mt5-baremetal" / "Start-MT5BareMetalWorker.ps1"
STATUS = ROOT / "tools" / "mt5-baremetal" / "Get-MT5BareMetalWorkerStatus.ps1"
PINNED_METAQUOTES_SUBJECT = "CN=MetaQuotes Ltd., O=MetaQuotes Ltd., S=Lemesos, C=CY"


@unittest.skipUnless(sys.platform == "win32", "bare-metal worker install is Windows-only")
class BareMetalWorkerInstallTests(unittest.TestCase):
    def run_powershell(
        self,
        command: str,
        *,
        extra_env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
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
                "MT5_BAREMETAL_INSTALLER": str(INSTALLER),
                "MT5_BAREMETAL_LAUNCHER": str(LAUNCHER),
                "MT5_BAREMETAL_STATUS": str(STATUS),
                **(extra_env or {}),
            },
        )

    def write_release_fixture(
        self,
        root: Path,
        *,
        overrides: dict[str, object] | None = None,
        checksum: str | None = None,
    ) -> tuple[Path, Path, str]:
        ea = root / "MarketLensExecutionEA.ex5"
        ea.write_bytes(b"compiled-ea-fixture")
        binary_sha256 = hashlib.sha256(ea.read_bytes()).hexdigest().upper()
        manifest = {
            "schemaVersion": 2,
            "fileName": ea.name,
            "eaVersion": "1.26",
            "compilerVersion": "5.0.0.6122",
            "compilerSha256": "A" * 64,
            "compilerSignerSubject": PINNED_METAQUOTES_SUBJECT,
            "sourceSha256": "B" * 64,
            "binarySha256": binary_sha256,
        }
        manifest.update(overrides or {})
        manifest_path = root / "MarketLensExecutionEA.release.json"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        checksum_path = root / "MarketLensExecutionEA.sha256.txt"
        checksum_path.write_text(
            checksum
            if checksum is not None
            else f"{binary_sha256}  MarketLensExecutionEA.ex5",
            encoding="ascii",
        )
        return manifest_path, checksum_path, binary_sha256

    def write_topology_fixture(
        self,
        root: Path,
        *,
        gateway_origin: str = "http://127.0.0.1",
        extra_expert: bool = False,
        allowed_origins: list[str] | None = None,
    ) -> dict[str, str]:
        install_root = root / "slot-01"
        install_root.mkdir()
        terminal_path = install_root / "terminal64.exe"
        terminal_path.write_bytes(b"terminal-fixture")

        terminal_state_root = root / "terminal-state" / ("A" * 32)
        terminal_state_root.mkdir(parents=True)
        (terminal_state_root / "origin.txt").write_text(
            str(install_root), encoding="utf-8"
        )

        source_root = root / "topology-source"
        source_root.mkdir()
        ea_source_path = source_root / "MarketLensExecutionEA.ex5"
        ea_source_path.write_bytes(b"compiled-ea-topology-fixture")
        ea_sha256 = hashlib.sha256(ea_source_path.read_bytes()).hexdigest()

        expert_blocks = [
            "\n".join(
                (
                    "<expert>",
                    r"path=Experts\MarketLensExecutionEA.ex5",
                    "<inputs>",
                    f"GatewayUrl={gateway_origin}",
                    "PairingToken=",
                    "BootstrapPipe=marketlens-slot-01",
                    "</inputs>",
                    "</expert>",
                )
            )
        ]
        if extra_expert:
            expert_blocks.append(
                "\n".join(
                    (
                        "<expert>",
                        r"path=Experts\Unexpected.ex5",
                        "</expert>",
                    )
                )
            )
        chart_source_path = source_root / "chart01.chr"
        chart_source_path.write_text(
            "<chart>\n" + "\n".join(expert_blocks) + "\n</chart>\n",
            encoding="utf-8",
        )
        chart_sha256 = hashlib.sha256(chart_source_path.read_bytes()).hexdigest()

        webrequest_settings_source_path = source_root / "experts.ini"
        webrequest_settings_source_path.write_bytes(b"opaque-webrequest-settings-fixture")
        webrequest_settings_sha256 = hashlib.sha256(
            webrequest_settings_source_path.read_bytes()
        ).hexdigest()
        topology_attestation_source_path = source_root / "webrequest-attestation.json"
        topology_attestation_source_path.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "settingsFileName": "experts.ini",
                    "settingsSha256": webrequest_settings_sha256,
                    "allowedOrigins": allowed_origins
                    if allowed_origins is not None
                    else [gateway_origin],
                    "probeSucceeded": True,
                },
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )
        topology_attestation_sha256 = hashlib.sha256(
            topology_attestation_source_path.read_bytes()
        ).hexdigest()
        return {
            "terminal_path": str(terminal_path),
            "terminal_state_root": str(terminal_state_root),
            "ea_source_path": str(ea_source_path),
            "ea_sha256": ea_sha256,
            "ea_destination_path": str(
                terminal_state_root
                / "MQL5"
                / "Experts"
                / "MarketLensExecutionEA.ex5"
            ),
            "chart_source_path": str(chart_source_path),
            "chart_sha256": chart_sha256,
            "webrequest_settings_source_path": str(webrequest_settings_source_path),
            "webrequest_settings_sha256": webrequest_settings_sha256,
            "topology_attestation_source_path": str(
                topology_attestation_source_path
            ),
            "topology_attestation_sha256": topology_attestation_sha256,
            "gateway_origin": gateway_origin,
        }

    def topology_env(self, fixture: dict[str, str]) -> dict[str, str]:
        return {f"MT5_TOPOLOGY_{key.upper()}": value for key, value in fixture.items()}

    def test_install_is_dry_run_first_and_writes_only_non_secret_config(self) -> None:
        self.assertTrue(INSTALLER.exists(), f"missing approved installer: {INSTALLER}")
        command = (
            "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;"
            ". $env:MT5_BAREMETAL_INSTALLER;"
            "$script:writes=0;$script:tasks=0;"
            "function Get-MT5BareMetalArtifactBoundary {param($Path,$ExpectedSha256);"
            "[pscustomobject]@{path=[IO.Path]::GetFullPath($Path);sha256=$ExpectedSha256}};"
            "function Get-MT5BareMetalTerminalBoundary {param($Path,$ExpectedSha256);"
            "[pscustomobject]@{path=[IO.Path]::GetFullPath($Path);sha256=$ExpectedSha256}};"
            "function Get-MT5BareMetalEaReleaseBoundary {param($ManifestPath,$ChecksumPath,$MinimumEaVersion);"
            "[pscustomobject]@{ea_version='1.26';binary_sha256=('d'*64);"
            "compiler_version='5.0.0.6122';binary_path='C:\\Release\\MarketLensExecutionEA.ex5'}};"
            "$script:topologyCalls=0;"
            "function Install-MT5BareMetalEaTopologyBoundary {param($TerminalPath,$TerminalStateRoot,"
            "$EaSourcePath,$ExpectedEaSha256,$EaDestinationPath,$ChartTemplatePath,"
            "$ExpectedChartSha256,$ProfileName,$BootstrapPipe,$GatewayOrigin,"
            "$WebRequestSettingsPath,$ExpectedWebRequestSettingsSha256,"
            "$TopologyAttestationPath,$ExpectedTopologyAttestationSha256,[switch]$Execute);"
            "$script:topologyCalls++;[pscustomobject]@{terminal_state_root=$TerminalStateRoot;"
            "ea_path=$EaDestinationPath;ea_sha256=$ExpectedEaSha256;"
            "ea_profile_chart_path='C:\\State\\MQL5\\Profiles\\Charts\\MarketLens-slot-01\\chart01.chr';"
            "ea_profile_chart_sha256=$ExpectedChartSha256;"
            "ea_webrequest_settings_path='C:\\State\\Config\\experts.ini';"
            "ea_webrequest_settings_sha256=$ExpectedWebRequestSettingsSha256;"
            "ea_topology_attestation_path='C:\\State\\Config\\marketlens-webrequest-attestation.json';"
            "ea_topology_attestation_sha256=$ExpectedTopologyAttestationSha256}};"
            "function Get-MT5BareMetalIdentitySidBoundary {'S-1-5-21-1-2-3-1001'};"
            "function Assert-MT5BareMetalTokenAclBoundary {};"
            "function Protect-MT5BareMetalRootBoundary {};"
            "function Write-MT5BareMetalConfigBoundary {param($WorkerRoot,$Config,"
            "$AgentSourcePath,$ExpectedAgentSha256);"
            "if (-not $AgentSourcePath -or $ExpectedAgentSha256 -ne ('e'*64)) {"
            "throw 'TEST_AGENT_NOT_INSTALLED'};"
            "$null=[IO.Directory]::CreateDirectory($WorkerRoot);"
            "$script:writes++;$script:config=$Config;[pscustomobject]@{"
            "config_path='C:\\MarketLens\\Worker\\managed-worker.json';"
            "launcher_path='C:\\MarketLens\\Worker\\Start-MT5BareMetalWorker.ps1';"
            "agent_path='C:\\MarketLens\\Worker\\mt5-vm-agent.exe';"
            "agent_sha256=('e'*64);"
            "config_sha256=('2'*64)}};"
            "function Register-MT5BareMetalTaskBoundary {param($TaskName,$WorkerIdentity,"
            "$PowerShellPath,$LauncherPath,$AgentPath,$ConfigPath,$ExpectedAgentSha256,"
            "$ExpectedConfigSha256);$script:tasks++;$script:taskArgs=[ordered]@{"
            "agent_path=$AgentPath;agent_sha256=$ExpectedAgentSha256;"
            "config_sha256=$ExpectedConfigSha256}};"
            "$slot=[pscustomobject]@{slot_id='slot-01';"
            "terminal_path='C:\\Slots\\slot-01\\terminal64.exe';terminal_sha256=('a'*64);"
            "servers_sha256=('b'*64);terminal_license_sha256=('c'*64);"
            "ea_path='C:\\Slots\\slot-01\\MQL5\\Experts\\MarketLensExecutionEA.ex5';"
            "ea_sha256=('d'*64);ea_bootstrap_pipe='marketlens-slot-01';"
            "ea_profile='MarketLens-slot-01';ea_gateway_origin='http://127.0.0.1';"
            "terminal_state_root='C:\\State';"
            "ea_chart_template_path='C:\\Release\\chart01.chr';"
            "ea_chart_template_sha256=('3'*64);"
            "ea_webrequest_settings_source_path='C:\\Release\\experts.ini';"
            "ea_webrequest_settings_sha256=('4'*64);"
            "ea_topology_attestation_source_path='C:\\Release\\webrequest-attestation.json';"
            "ea_topology_attestation_sha256=('5'*64)};"
            "$args=@{WorkerRoot=$env:MT5_TEST_WORKER_ROOT;DataRoot=$env:MT5_TEST_DATA_ROOT;"
            "WorkerIdentity='HOST\\MarketLensWorker';TaskName='MarketLens MT5 Worker';"
            "AgentPath='C:\\MarketLens\\bin\\mt5-vm-agent.exe';AgentSha256=('e'*64);"
            "PythonPath='C:\\MarketLens\\Python\\python.exe';PythonSha256=('f'*64);"
            "AdapterPath='C:\\MarketLens\\phase1_adapter.py';AdapterSha256=('1'*64);"
            "AclHelperPath='C:\\MarketLens\\Set-MT5VmPhase1RuntimeAcl.ps1';"
            "PowerShellPath='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';"
            "BootstrapTokenFile='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';"
            "EaReleaseManifestPath='C:\\Release\\MarketLensExecutionEA.release.json';"
            "EaReleaseChecksumPath='C:\\Release\\MarketLensExecutionEA.sha256.txt';"
            "GatewayUrl='http://127.0.0.1:8791';CredentialApiUrl='http://127.0.0.1:8080';"
            "TerminalSlots=@($slot)};"
            "$dry=Install-MT5BareMetalWorkerCore @args;"
            "$live=Install-MT5BareMetalWorkerCore @args -Execute;"
            "[pscustomobject]@{dry=$dry;live=$live;writes=$script:writes;tasks=$script:tasks;"
            "topologyCalls=$script:topologyCalls;"
            "config=$script:config;taskArgs=$script:taskArgs}|ConvertTo-Json -Compress -Depth 12"
        )
        with tempfile.TemporaryDirectory() as raw_root:
            test_root = Path(raw_root)
            completed = self.run_powershell(
                command,
                extra_env={
                    "MT5_TEST_WORKER_ROOT": str(test_root / "worker"),
                    "MT5_TEST_DATA_ROOT": str(test_root / "runtime"),
                },
            )

        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual("DRY_RUN", observed["dry"]["status"])
        self.assertEqual("PASS", observed["live"]["status"])
        self.assertEqual(
            r"C:\MarketLens\Worker\mt5-vm-agent.exe",
            observed["live"]["agent_path"],
        )
        self.assertEqual("e" * 64, observed["live"]["agent_sha256"])
        self.assertEqual("2" * 64, observed["live"]["config_sha256"])
        self.assertEqual(1, observed["writes"])
        self.assertEqual(1, observed["tasks"])
        self.assertEqual(2, observed["topologyCalls"])
        self.assertEqual("bare_metal", observed["config"]["worker_substrate"])
        self.assertTrue(observed["config"]["allow_loopback_http"])
        self.assertEqual(100, observed["config"]["process"]["cpu_budget_percent"])
        self.assertGreaterEqual(
            observed["config"]["process"]["minimum_free_disk_bytes"],
            1_073_741_824,
        )
        self.assertEqual(
            "e" * 64,
            observed["config"]["process"]["artifact_pins"]["agent_sha256"],
        )
        self.assertEqual("e" * 64, observed["taskArgs"]["agent_sha256"])
        self.assertEqual(
            r"C:\MarketLens\Worker\mt5-vm-agent.exe",
            observed["taskArgs"]["agent_path"],
        )
        self.assertEqual("2" * 64, observed["taskArgs"]["config_sha256"])
        slot = observed["config"]["process"]["terminal_slots"][0]
        self.assertEqual("slot-01", slot["slot_id"])
        self.assertEqual("http://127.0.0.1", slot["ea_gateway_origin"])
        self.assertEqual("3" * 64, slot["ea_profile_chart_sha256"])
        self.assertEqual("4" * 64, slot["ea_webrequest_settings_sha256"])
        self.assertEqual("5" * 64, slot["ea_topology_attestation_sha256"])
        serialized = json.dumps(observed["config"]).casefold()
        self.assertNotIn("password", serialized)
        self.assertNotIn("token\"", serialized)
        self.assertIn("bootstrap_token_file", serialized)

    def test_worker_writer_installs_a_hash_pinned_agent_under_worker_root(self) -> None:
        with tempfile.TemporaryDirectory() as raw_root:
            root = Path(raw_root)
            source = root / "release" / "mt5-vm-agent.exe"
            worker = root / "worker"
            source.parent.mkdir()
            source.write_bytes(b"pinned-agent-release")
            expected_sha = hashlib.sha256(source.read_bytes()).hexdigest()
            command = (
                "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;"
                ". $env:MT5_BAREMETAL_INSTALLER;"
                "$result=Write-MT5BareMetalConfigBoundary "
                "-WorkerRoot $env:MT5_WRITER_ROOT -Config ([ordered]@{schema=1}) "
                "-AgentSourcePath $env:MT5_WRITER_AGENT "
                "-ExpectedAgentSha256 $env:MT5_WRITER_AGENT_SHA;"
                "$result | ConvertTo-Json -Compress"
            )
            completed = self.run_powershell(
                command,
                extra_env={
                    "MT5_WRITER_ROOT": str(worker),
                    "MT5_WRITER_AGENT": str(source),
                    "MT5_WRITER_AGENT_SHA": expected_sha,
                },
            )

            self.assertEqual(0, completed.returncode, completed.stderr)
            result = json.loads(completed.stdout)
            installed = Path(result["agent_path"])
            self.assertEqual(worker / "mt5-vm-agent.exe", installed)
            self.assertEqual(source.read_bytes(), installed.read_bytes())
            self.assertEqual(expected_sha, result["agent_sha256"])

    def test_private_service_urls_allow_https_or_exact_loopback_http_only(self) -> None:
        command = (
            "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;"
            ". $env:MT5_BAREMETAL_INSTALLER;"
            "$accepted=Get-MT5BareMetalPrivateServiceUrlBoundary -Url $env:MT5_URL;"
            "$accepted | ConvertTo-Json -Compress"
        )
        accepted_cases = (
            ("http://127.0.0.1:8791", True),
            ("http://[::1]:8080", True),
            ("https://private.internal:8791", False),
        )
        for url, loopback_http in accepted_cases:
            with self.subTest(url=url):
                completed = self.run_powershell(command, extra_env={"MT5_URL": url})
                self.assertEqual(0, completed.returncode, completed.stderr)
                self.assertEqual(
                    loopback_http, json.loads(completed.stdout)["loopback_http"]
                )

        credential_url = "https://" + "user" + ":" + "secret" + "@private.internal:8791"
        for url in (
            "http://10.0.0.8:8791",
            "http://localhost:8791",
            credential_url,
            "https://private.internal:8791/path?token=value",
            "https://private.internal:8791/path#fragment",
        ):
            with self.subTest(url=url):
                completed = self.run_powershell(command, extra_env={"MT5_URL": url})
                self.assertNotEqual(0, completed.returncode)
                self.assertIn("BAREMETAL_CONFIG_INVALID", completed.stderr)

    def test_topology_provisioner_establishes_one_attested_chart_ea_and_origin(self) -> None:
        with tempfile.TemporaryDirectory() as raw_root:
            fixture = self.write_topology_fixture(Path(raw_root))
            command = (
                "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;"
                ". $env:MT5_BAREMETAL_INSTALLER;"
                "function Get-MT5BareMetalExactTerminalProcessBoundary {param($TerminalPath);@()};"
                "$args=@{TerminalPath=$env:MT5_TOPOLOGY_TERMINAL_PATH;"
                "TerminalStateRoot=$env:MT5_TOPOLOGY_TERMINAL_STATE_ROOT;"
                "EaSourcePath=$env:MT5_TOPOLOGY_EA_SOURCE_PATH;"
                "ExpectedEaSha256=$env:MT5_TOPOLOGY_EA_SHA256;"
                "EaDestinationPath=$env:MT5_TOPOLOGY_EA_DESTINATION_PATH;"
                "ChartTemplatePath=$env:MT5_TOPOLOGY_CHART_SOURCE_PATH;"
                "ExpectedChartSha256=$env:MT5_TOPOLOGY_CHART_SHA256;"
                "ProfileName='MarketLens-slot-01';BootstrapPipe='marketlens-slot-01';"
                "GatewayOrigin=$env:MT5_TOPOLOGY_GATEWAY_ORIGIN;"
                "WebRequestSettingsPath=$env:MT5_TOPOLOGY_WEBREQUEST_SETTINGS_SOURCE_PATH;"
                "ExpectedWebRequestSettingsSha256=$env:MT5_TOPOLOGY_WEBREQUEST_SETTINGS_SHA256;"
                "TopologyAttestationPath=$env:MT5_TOPOLOGY_TOPOLOGY_ATTESTATION_SOURCE_PATH;"
                "ExpectedTopologyAttestationSha256=$env:MT5_TOPOLOGY_TOPOLOGY_ATTESTATION_SHA256};"
                "$dry=Install-MT5BareMetalEaTopologyBoundary @args;"
                "$dryWrote=(Test-Path -LiteralPath $dry.ea_profile_chart_path);"
                "$live=Install-MT5BareMetalEaTopologyBoundary @args -Execute;"
                "[pscustomobject]@{dry=$dry;live=$live;dryWrote=$dryWrote;"
                "chartCount=@(Get-ChildItem -LiteralPath (Split-Path -Parent $live.ea_profile_chart_path) "
                "-Filter '*.chr' -File).Count;eaExists=(Test-Path -LiteralPath $live.ea_path);"
                "settingsExists=(Test-Path -LiteralPath $live.ea_webrequest_settings_path);"
                "attestationExists=(Test-Path -LiteralPath $live.ea_topology_attestation_path)}|"
                "ConvertTo-Json -Compress -Depth 10"
            )
            completed = self.run_powershell(command, extra_env=self.topology_env(fixture))

            self.assertEqual(0, completed.returncode, completed.stderr)
            observed = json.loads(completed.stdout)
            self.assertFalse(observed["dryWrote"])
            self.assertEqual("DRY_RUN", observed["dry"]["status"])
            self.assertEqual("PASS", observed["live"]["status"])
            self.assertEqual(1, observed["chartCount"])
            self.assertTrue(observed["eaExists"])
            self.assertTrue(observed["settingsExists"])
            self.assertTrue(observed["attestationExists"])
            self.assertEqual(fixture["ea_sha256"], observed["live"]["ea_sha256"])
            self.assertEqual(
                fixture["gateway_origin"], observed["live"]["ea_gateway_origin"]
            )

    def test_topology_provisioner_rejects_extra_ea_or_webrequest_origin(self) -> None:
        cases = (
            ({"extra_expert": True}, "BAREMETAL_EA_CHART_TEMPLATE_INVALID"),
            (
                {"allowed_origins": ["http://127.0.0.1", "https://public.example"]},
                "BAREMETAL_WEBREQUEST_ATTESTATION_INVALID",
            ),
            (
                {"gateway_origin": "https://public.example"},
                "BAREMETAL_EA_GATEWAY_ORIGIN_INVALID",
            ),
        )
        command = (
            "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;"
            ". $env:MT5_BAREMETAL_INSTALLER;"
            "Install-MT5BareMetalEaTopologyBoundary "
            "-TerminalPath $env:MT5_TOPOLOGY_TERMINAL_PATH "
            "-TerminalStateRoot $env:MT5_TOPOLOGY_TERMINAL_STATE_ROOT "
            "-EaSourcePath $env:MT5_TOPOLOGY_EA_SOURCE_PATH "
            "-ExpectedEaSha256 $env:MT5_TOPOLOGY_EA_SHA256 "
            "-EaDestinationPath $env:MT5_TOPOLOGY_EA_DESTINATION_PATH "
            "-ChartTemplatePath $env:MT5_TOPOLOGY_CHART_SOURCE_PATH "
            "-ExpectedChartSha256 $env:MT5_TOPOLOGY_CHART_SHA256 "
            "-ProfileName 'MarketLens-slot-01' -BootstrapPipe 'marketlens-slot-01' "
            "-GatewayOrigin $env:MT5_TOPOLOGY_GATEWAY_ORIGIN "
            "-WebRequestSettingsPath $env:MT5_TOPOLOGY_WEBREQUEST_SETTINGS_SOURCE_PATH "
            "-ExpectedWebRequestSettingsSha256 $env:MT5_TOPOLOGY_WEBREQUEST_SETTINGS_SHA256 "
            "-TopologyAttestationPath $env:MT5_TOPOLOGY_TOPOLOGY_ATTESTATION_SOURCE_PATH "
            "-ExpectedTopologyAttestationSha256 $env:MT5_TOPOLOGY_TOPOLOGY_ATTESTATION_SHA256 "
            "| Out-Null"
        )
        for overrides, expected_error in cases:
            with self.subTest(expected_error=expected_error):
                with tempfile.TemporaryDirectory() as raw_root:
                    fixture = self.write_topology_fixture(Path(raw_root), **overrides)
                    completed = self.run_powershell(
                        command, extra_env=self.topology_env(fixture)
                    )
                self.assertNotEqual(0, completed.returncode, completed.stdout)
                self.assertIn(expected_error, completed.stderr)

    def test_release_manifest_requires_schema_2_compiler_identity_and_exact_checksum(self) -> None:
        with tempfile.TemporaryDirectory() as raw_root:
            root = Path(raw_root)
            manifest_path, checksum_path, binary_sha256 = self.write_release_fixture(root)
            command = (
                "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;"
                ". $env:MT5_BAREMETAL_INSTALLER;"
                "$release=Get-MT5BareMetalEaReleaseBoundary "
                "-ManifestPath $env:MT5_EA_MANIFEST -ChecksumPath $env:MT5_EA_CHECKSUM "
                "-MinimumEaVersion '1.26';$release|ConvertTo-Json -Compress"
            )
            completed = self.run_powershell(
                command,
                extra_env={
                    "MT5_EA_MANIFEST": str(manifest_path),
                    "MT5_EA_CHECKSUM": str(checksum_path),
                },
            )

        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual("1.26", observed["ea_version"])
        self.assertEqual(binary_sha256.casefold(), observed["binary_sha256"].casefold())
        self.assertEqual("5.0.0.6122", observed["compiler_version"])

    def test_release_manifest_rejects_hostile_or_stale_metadata(self) -> None:
        cases = (
            ({"schemaVersion": 1}, None, "BAREMETAL_EA_RELEASE_SCHEMA_INVALID"),
            ({"fileName": "Other.ex5"}, None, "BAREMETAL_EA_RELEASE_SCHEMA_INVALID"),
            ({"eaVersion": "1.25.9"}, None, "BAREMETAL_EA_RELEASE_VERSION_UNSUPPORTED"),
            ({"compilerVersion": ""}, None, "BAREMETAL_EA_RELEASE_COMPILER_INVALID"),
            ({"compilerSha256": "A" * 63}, None, "BAREMETAL_EA_RELEASE_COMPILER_INVALID"),
            (
                {"compilerSignerSubject": PINNED_METAQUOTES_SUBJECT + " Evil"},
                None,
                "BAREMETAL_EA_RELEASE_COMPILER_INVALID",
            ),
            ({"sourceSha256": "B" * 63}, None, "BAREMETAL_EA_RELEASE_SCHEMA_INVALID"),
            ({"binarySha256": "C" * 64}, None, "BAREMETAL_EA_RELEASE_CHECKSUM_MISMATCH"),
            ({}, "D" * 64 + "  MarketLensExecutionEA.ex5", "BAREMETAL_EA_RELEASE_CHECKSUM_MISMATCH"),
        )
        command = (
            "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;"
            ". $env:MT5_BAREMETAL_INSTALLER;"
            "Get-MT5BareMetalEaReleaseBoundary -ManifestPath $env:MT5_EA_MANIFEST "
            "-ChecksumPath $env:MT5_EA_CHECKSUM -MinimumEaVersion '1.26' | Out-Null"
        )
        for overrides, checksum, expected_error in cases:
            with self.subTest(expected_error=expected_error, overrides=overrides):
                with tempfile.TemporaryDirectory() as raw_root:
                    manifest_path, checksum_path, _ = self.write_release_fixture(
                        Path(raw_root), overrides=overrides, checksum=checksum
                    )
                    completed = self.run_powershell(
                        command,
                        extra_env={
                            "MT5_EA_MANIFEST": str(manifest_path),
                            "MT5_EA_CHECKSUM": str(checksum_path),
                        },
                    )
                self.assertNotEqual(0, completed.returncode, completed.stdout)
                self.assertIn(expected_error, completed.stderr)

    def test_terminal_signer_requires_the_exact_pinned_metaquotes_subject(self) -> None:
        command = (
            "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;"
            ". $env:MT5_BAREMETAL_INSTALLER;"
            "function Get-MT5BareMetalArtifactBoundary {param($Path,$ExpectedSha256);"
            "[pscustomobject]@{path='C:\\Slot\\terminal64.exe';sha256=('a'*64)}};"
            "function Get-AuthenticodeSignature {[pscustomobject]@{Status='Valid';"
            "SignerCertificate=[pscustomobject]@{Subject=$env:MT5_TEST_SIGNER}}};"
            "Get-MT5BareMetalTerminalBoundary -Path 'C:\\Slot\\terminal64.exe' "
            "-ExpectedSha256 ('a'*64) | Out-Null"
        )
        accepted = self.run_powershell(
            command, extra_env={"MT5_TEST_SIGNER": PINNED_METAQUOTES_SUBJECT}
        )
        rejected = self.run_powershell(
            command, extra_env={"MT5_TEST_SIGNER": PINNED_METAQUOTES_SUBJECT + " Evil"}
        )

        self.assertEqual(0, accepted.returncode, accepted.stderr)
        self.assertNotEqual(0, rejected.returncode, rejected.stdout)
        self.assertIn("BAREMETAL_TERMINAL_SIGNER_MISMATCH", rejected.stderr)

    def test_acl_contract_rejects_any_broad_explicit_ace(self) -> None:
        command = (
            "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;"
            ". $env:MT5_BAREMETAL_INSTALLER;"
            "$workerSid='S-1-5-21-1-2-3-1001';"
            "$acl=New-MT5BareMetalAclBoundary -WorkerSid $workerSid -Container;"
            "Assert-MT5BareMetalAclBoundary -Acl $acl -WorkerSid $workerSid -Container;"
            "$users=New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545');"
            "$broad=New-Object Security.AccessControl.FileSystemAccessRule($users,"
            "[Security.AccessControl.FileSystemRights]::ReadAndExecute,"
            "[Security.AccessControl.InheritanceFlags]::None,"
            "[Security.AccessControl.PropagationFlags]::None,"
            "[Security.AccessControl.AccessControlType]::Allow);"
            "$acl.AddAccessRule($broad) | Out-Null;"
            "$caught='NONE';try {Assert-MT5BareMetalAclBoundary -Acl $acl "
            "-WorkerSid $workerSid -Container} catch {$caught=$_.Exception.Message};"
            "[pscustomobject]@{caught=$caught}|ConvertTo-Json -Compress"
        )
        completed = self.run_powershell(command)

        self.assertEqual(0, completed.returncode, completed.stderr)
        self.assertEqual(
            "BAREMETAL_ROOT_ACL_TOO_BROAD",
            json.loads(completed.stdout)["caught"],
        )

    def test_root_protection_replaces_acl_and_verifies_the_applied_descriptor(self) -> None:
        with tempfile.TemporaryDirectory() as raw_root:
            command = (
                "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;"
                ". $env:MT5_BAREMETAL_INSTALLER;"
                "$script:applied=$null;$script:setCount=0;"
                "function Set-Acl {param($LiteralPath,$AclObject);"
                "$script:applied=$AclObject;$script:setCount++};"
                "function Get-Acl {param($LiteralPath);$script:applied};"
                "function icacls.exe {$global:LASTEXITCODE=0};"
                "Protect-MT5BareMetalRootBoundary -Path $env:MT5_TEST_ROOT "
                "-WorkerSid 'S-1-5-21-1-2-3-1001';"
                "[pscustomobject]@{setCount=$script:setCount;"
                "protected=$script:applied.AreAccessRulesProtected}|ConvertTo-Json -Compress"
            )
            completed = self.run_powershell(
                command, extra_env={"MT5_TEST_ROOT": raw_root}
            )

        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertGreaterEqual(observed["setCount"], 1)
        self.assertTrue(observed["protected"])

    def test_scheduled_task_contract_rejects_action_identity_or_trigger_drift(self) -> None:
        command = (
            "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;"
            ". $env:MT5_BAREMETAL_INSTALLER;"
            "$identity='HOST\\MarketLensWorker';$agentSha=('a'*64);$configSha=('b'*64);"
            "$expectedArgs=Get-MT5BareMetalTaskArgumentsBoundary "
            "-LauncherPath 'C:\\Worker\\Start-MT5BareMetalWorker.ps1' "
            "-AgentPath 'C:\\Worker\\mt5-vm-agent.exe' "
            "-ConfigPath 'C:\\Worker\\managed-worker.json' "
            "-ExpectedAgentSha256 $agentSha -ExpectedConfigSha256 $configSha;"
            "$task=[pscustomobject]@{"
            "Actions=@([pscustomobject]@{Execute='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';Arguments=$expectedArgs});"
            "Principal=[pscustomobject]@{UserId=$identity;LogonType='Interactive';RunLevel='Limited'};"
            "Triggers=@([pscustomobject]@{Enabled=$true;UserId=$identity;"
            "CimClass=[pscustomobject]@{CimClassName='MSFT_TaskLogonTrigger'}})};"
            "switch ($env:MT5_TASK_VARIANT) {"
            "'action' {$task.Actions[0].Execute='C:\\Windows\\System32\\cmd.exe'};"
            "'arguments' {$task.Actions[0].Arguments='-NoProfile'};"
            "'identity' {$task.Principal.UserId='HOST\\Other'};"
            "'logon' {$task.Principal.LogonType='Password'};"
            "'runlevel' {$task.Principal.RunLevel='Highest'};"
            "'trigger' {$task.Triggers[0].CimClass.CimClassName='MSFT_TaskDailyTrigger'}};"
            "Assert-MT5BareMetalTaskContractBoundary -Task $task -WorkerIdentity $identity "
            "-PowerShellPath 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' "
            "-ExpectedArguments $expectedArgs;Write-Output 'VALID'"
        )
        valid = self.run_powershell(command, extra_env={"MT5_TASK_VARIANT": "valid"})
        self.assertEqual(0, valid.returncode, valid.stderr)
        self.assertIn("VALID", valid.stdout)
        for variant in ("action", "arguments", "identity", "logon", "runlevel", "trigger"):
            with self.subTest(variant=variant):
                rejected = self.run_powershell(
                    command, extra_env={"MT5_TASK_VARIANT": variant}
                )
                self.assertNotEqual(0, rejected.returncode, rejected.stdout)
                self.assertIn("BAREMETAL_TASK_CONTRACT_INVALID", rejected.stderr)

    def test_launcher_rehashes_agent_and_config_before_execution(self) -> None:
        with tempfile.TemporaryDirectory() as raw_root:
            root = Path(raw_root)
            agent = root / "agent.ps1"
            agent.write_text(
                "param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)\n"
                "$input | Out-Null\n"
                "if ($Arguments.Count -ne 1 -or $Arguments[0] -cne '--managed-worker') {\n"
                "  Write-Error 'MANAGED_WORKER_CLI_FLAG_INVALID'\n"
                "  exit 9\n"
                "}\n"
                "exit 0\n",
                encoding="utf-8",
            )
            agent_sha = hashlib.sha256(agent.read_bytes()).hexdigest()
            config = root / "managed-worker.json"
            config.write_text(
                json.dumps(
                    {
                        "worker_substrate": "bare_metal",
                        "bootstrap_token_file": r"C:\protected\bootstrap.token",
                        "process": {
                            "terminal_slots": [{"slot_id": "slot-01"}],
                            "artifact_pins": {"agent_sha256": agent_sha},
                        },
                    }
                ),
                encoding="utf-8",
            )
            config_sha = hashlib.sha256(config.read_bytes()).hexdigest()
            base = [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(LAUNCHER),
                "-AgentPath",
                str(agent),
                "-ConfigPath",
                str(config),
                "-ExpectedAgentSha256",
            ]

            wrong_agent = subprocess.run(
                [*base, "0" * 64, "-ExpectedConfigSha256", config_sha],
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )
            wrong_config = subprocess.run(
                [*base, agent_sha, "-ExpectedConfigSha256", "0" * 64],
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )
            accepted = subprocess.run(
                [*base, agent_sha, "-ExpectedConfigSha256", config_sha],
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )

        self.assertNotEqual(0, wrong_agent.returncode)
        self.assertIn("BAREMETAL_LAUNCH_AGENT_HASH_MISMATCH", wrong_agent.stderr)
        self.assertNotEqual(0, wrong_config.returncode)
        self.assertIn("BAREMETAL_LAUNCH_CONFIG_HASH_MISMATCH", wrong_config.stderr)
        self.assertEqual(0, accepted.returncode, accepted.stderr)

    def test_status_command_is_read_only_and_reports_task_health(self) -> None:
        with tempfile.TemporaryDirectory() as raw_root:
            root = Path(raw_root)
            agent = root / "mt5-vm-agent.exe"
            launcher = root / "Start-MT5BareMetalWorker.ps1"
            config = root / "managed-worker.json"
            powershell = root / "powershell.exe"
            for path in (agent, launcher, powershell):
                path.write_bytes(path.name.encode("ascii"))
            agent_sha = hashlib.sha256(agent.read_bytes()).hexdigest()
            config.write_text(
                json.dumps(
                    {
                        "worker_substrate": "bare_metal",
                        "bootstrap_token_file": r"C:\protected\bootstrap.token",
                        "process": {
                            "worker_id": "marketlens-baremetal-01",
                            "terminal_slots": [{"slot_id": "slot-01"}],
                            "artifact_pins": {"agent_sha256": agent_sha},
                        },
                    }
                ),
                encoding="utf-8",
            )
            config_sha = hashlib.sha256(config.read_bytes()).hexdigest()
            command = (
                "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;"
                ". $env:MT5_BAREMETAL_STATUS;"
                "$identity='HOST\\MarketLensWorker';"
                "$expectedArgs=Get-MT5BareMetalTaskArgumentsBoundary "
                "-LauncherPath $env:MT5_STATUS_LAUNCHER -AgentPath $env:MT5_STATUS_AGENT "
                "-ConfigPath $env:MT5_STATUS_CONFIG -ExpectedAgentSha256 $env:MT5_STATUS_AGENT_SHA "
                "-ExpectedConfigSha256 $env:MT5_STATUS_CONFIG_SHA;"
                "function Get-ScheduledTask {[pscustomobject]@{State=$env:MT5_STATUS_STATE;"
                "Actions=@([pscustomobject]@{Execute=$env:MT5_STATUS_POWERSHELL;Arguments=$expectedArgs});"
                "Principal=[pscustomobject]@{UserId=$identity;LogonType='Interactive';RunLevel='Limited'};"
                "Triggers=@([pscustomobject]@{Enabled=$true;UserId=$identity;"
                "CimClass=[pscustomobject]@{CimClassName='MSFT_TaskLogonTrigger'}})}};"
                "function Get-ScheduledTaskInfo {[pscustomobject]@{LastTaskResult="
                "[int]$env:MT5_STATUS_LAST_RESULT}};"
                "Get-MT5BareMetalWorkerStatusCore -TaskName 'MarketLens MT5 Worker' "
                "-WorkerIdentity $identity -PowerShellPath $env:MT5_STATUS_POWERSHELL "
                "-LauncherPath $env:MT5_STATUS_LAUNCHER -AgentPath $env:MT5_STATUS_AGENT "
                "-AgentSha256 $env:MT5_STATUS_AGENT_SHA -ConfigPath $env:MT5_STATUS_CONFIG "
                "-ConfigSha256 $env:MT5_STATUS_CONFIG_SHA | ConvertTo-Json -Compress"
            )
            env = {
                "MT5_STATUS_LAUNCHER": str(launcher),
                "MT5_STATUS_AGENT": str(agent),
                "MT5_STATUS_CONFIG": str(config),
                "MT5_STATUS_POWERSHELL": str(powershell),
                "MT5_STATUS_AGENT_SHA": agent_sha,
                "MT5_STATUS_CONFIG_SHA": config_sha,
                "MT5_STATUS_STATE": "Running",
                "MT5_STATUS_LAST_RESULT": "0",
            }
            healthy = self.run_powershell(command, extra_env=env)
            healthy_while_running = self.run_powershell(
                command, extra_env={**env, "MT5_STATUS_LAST_RESULT": "267009"}
            )
            degraded = self.run_powershell(
                command, extra_env={**env, "MT5_STATUS_STATE": "Ready"}
            )
            failed = self.run_powershell(
                command, extra_env={**env, "MT5_STATUS_LAST_RESULT": "1"}
            )

        self.assertEqual(0, healthy.returncode, healthy.stderr)
        self.assertEqual("HEALTHY", json.loads(healthy.stdout)["status"])
        self.assertEqual(0, healthy_while_running.returncode, healthy_while_running.stderr)
        self.assertEqual(
            "HEALTHY", json.loads(healthy_while_running.stdout)["status"]
        )
        self.assertEqual(0, degraded.returncode, degraded.stderr)
        self.assertEqual("DEGRADED", json.loads(degraded.stdout)["status"])
        self.assertEqual(0, failed.returncode, failed.stderr)
        self.assertEqual("DEGRADED", json.loads(failed.stdout)["status"])
        self.assertNotIn("bootstrap.token", healthy.stdout)

    def test_powershell_51_parser_accepts_all_operator_scripts(self) -> None:
        command = (
            "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;"
            "foreach ($path in @($env:MT5_BAREMETAL_INSTALLER,$env:MT5_BAREMETAL_LAUNCHER,"
            "$env:MT5_BAREMETAL_STATUS)) {"
            "$null=[scriptblock]::Create((Get-Content -LiteralPath $path -Raw))};"
            "Write-Output 'PARSE_OK'"
        )
        completed = self.run_powershell(command)

        self.assertEqual(0, completed.returncode, completed.stderr)
        self.assertIn("PARSE_OK", completed.stdout)

    def test_installer_declares_signer_acl_and_bounded_task_contracts(self) -> None:
        source = INSTALLER.read_text(encoding="utf-8")

        for required in (
            "Get-AuthenticodeSignature",
            PINNED_METAQUOTES_SUBJECT,
            "Get-MT5BareMetalEaReleaseBoundary",
            "Protect-MT5BareMetalRootBoundary",
            "Assert-MT5BareMetalTaskContractBoundary",
            "cpu_budget_percent",
            "minimum_free_disk_bytes",
            "-LogonType Interactive",
            "-RunLevel Limited",
        ):
            self.assertIn(required, source)

        self.assertNotIn("icacls.exe", source)


if __name__ == "__main__":
    unittest.main()
