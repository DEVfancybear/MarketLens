from __future__ import annotations

import pathlib
import unittest


SOURCE = pathlib.Path(__file__).with_name("MarketLensExecutionEA.mq5")
PUBLISHER = pathlib.Path(__file__).with_name("Publish-MarketLensExecutionEA.ps1")


class ManagedEaBootstrapContractTests(unittest.TestCase):
    def test_release_version_distinguishes_named_pipe_capable_ea(self) -> None:
        source = SOURCE.read_text(encoding="utf-8")

        self.assertIn('#property version   "1.26"', source)
        self.assertIn('const string EA_VERSION = "1.26";', source)

    def test_ea_reads_a_one_time_pairing_token_from_a_named_pipe(self) -> None:
        source = SOURCE.read_text(encoding="utf-8")

        self.assertIn('input string BootstrapPipe', source)
        self.assertIn('LoadManagedBootstrapToken', source)
        self.assertIn('string pipe_path = "\\\\\\\\.\\\\pipe\\\\" + BootstrapPipe;', source)
        self.assertIn('FILE_READ|FILE_TXT|FILE_ANSI', source)
        self.assertIn('g_pairing_token', source)
        self.assertNotIn('PairingToken + "\\t"', source)

    def test_managed_bootstrap_is_bound_to_slot_pid_and_gateway_origin(self) -> None:
        source = SOURCE.read_text(encoding="utf-8")

        self.assertIn('g_managed_slot_id', source)
        self.assertIn('g_managed_terminal_pid', source)
        self.assertIn('g_managed_gateway_origin', source)
        self.assertIn('JsonString(envelope, "slotId"', source)
        self.assertIn('JsonNumber(envelope, "terminalPid"', source)
        self.assertIn('JsonString(envelope, "gatewayOrigin"', source)
        self.assertIn('g_managed_gateway_origin != NormalizedGatewayOrigin()', source)
        self.assertIn('\\"runtimeBinding\\":{', source)
        self.assertIn(
            '\\"slotId\\":\\"%s\\",\\"terminalPid\\":%I64d,'
            '\\"gatewayOrigin\\":\\"%s\\"',
            source,
        )

    def test_managed_bootstrap_does_not_add_a_secret_file_or_shell_boundary(self) -> None:
        source = SOURCE.read_text(encoding="utf-8")

        forbidden = [
            "ShellExecute",
            "WinExec",
            "cmd.exe",
            "powershell",
            "TerminalInfoString(TERMINAL_COMMONDATA_PATH)",
            "FILE_COMMON",
            "bootstrap.ini",
            "bootstrap.set",
        ]
        for value in forbidden:
            self.assertNotIn(value, source)

    def test_publisher_cannot_accept_a_stale_binary_and_records_toolchain(self) -> None:
        publisher = PUBLISHER.read_text(encoding="utf-8")

        remove_binary = publisher.index(
            "Remove-Item -LiteralPath $compiledPath -Force -ErrorAction SilentlyContinue"
        )
        compile_process = publisher.index("Start-Process -FilePath $metaEditor")
        self.assertLess(remove_binary, compile_process)
        self.assertIn("eaVersion = $eaVersion", publisher)
        self.assertIn("compilerVersion = $compilerVersion", publisher)
        self.assertIn("$manifest.eaVersion -cne $sourceVersion", publisher)
        self.assertIn("[string]::IsNullOrWhiteSpace($manifest.compilerVersion)", publisher)
        self.assertIn("Get-AuthenticodeSignature -LiteralPath $metaEditor", publisher)
        self.assertIn('$compilerSignature.Status -ne "Valid"', publisher)
        self.assertIn("CN=MetaQuotes Ltd.", publisher)


if __name__ == "__main__":
    unittest.main()
