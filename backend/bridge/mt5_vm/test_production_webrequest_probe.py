from __future__ import annotations

import os
import subprocess
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
PROBE = REPO_ROOT / "tools" / "mt5-baremetal" / "MarketLensWebRequestProbe.mq5"
DRIVER = REPO_ROOT / "tools" / "mt5-baremetal" / "Invoke-MT5WebRequestProbe.ps1"


class ProductionWebRequestProbeTests(unittest.TestCase):
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
            "Invoke-ProbeDefaultConfigStartupTransaction",
            ".marketlens-v38-startup.bak",
            "[IO.File]::Replace",
            "PRODUCTION_DEFAULT_CONFIG_STARTUP_CONTRACTS=PASS",
        ):
            self.assertIn(required, source)
        self.assertNotIn("SendKeys", source)
        self.assertNotIn("Clipboard", source)
        self.assertNotIn("/config:", source)
        self.assertIn(
            "$terminal = Start-Process -FilePath $terminalPath `\n"
            "    -WindowStyle Hidden -PassThru",
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


if __name__ == "__main__":
    unittest.main()
