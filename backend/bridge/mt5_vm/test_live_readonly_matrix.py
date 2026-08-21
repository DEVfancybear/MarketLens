from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path


BRIDGE = Path(__file__).resolve().parent
MATRIX = BRIDGE / "Invoke-MT5VmLiveReadonlyMatrix.ps1"
GAUNTLET = BRIDGE.parents[2] / "tools" / "run-mt5-vm-powershell-regression-gauntlet.ps1"


@unittest.skipUnless(sys.platform == "win32", "MT5 live matrix contracts are Windows-only")
class LiveReadonlyMatrixTests(unittest.TestCase):
    def _run_core(self, *, fail_second_single: bool = False) -> subprocess.CompletedProcess[str]:
        self.assertTrue(MATRIX.exists(), "broker-neutral live matrix is not implemented")
        fail = "$true" if fail_second_single else "$false"
        command = (
            "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;"
            ". $env:MT5_MATRIX;"
            "$script:presence=@($true,$true);$script:events=@();"
            "$script:failSecond=" + fail + ";"
            "function Get-MT5VmLiveReadonlyMatrixStateBoundary {"
            "param([string[]]$TerminalPaths);"
            "return @(for($i=0;$i -lt 2;$i++){[pscustomobject]@{"
            "TerminalPath=$TerminalPaths[$i];Present=[bool]$script:presence[$i];"
            "ProcessId=if($script:presence[$i]){700+$i}else{$null}}})};"
            "function Set-MT5VmLiveReadonlyMatrixPresenceBoundary {"
            "param([string]$TerminalPath,[bool]$Present);"
            "$index=if($TerminalPath -eq 'C:\\Slots\\Alpha\\terminal64.exe'){0}else{1};"
            "$script:presence[$index]=$Present;"
            "$script:events+=,('set:'+($index)+':'+$Present)};"
            "function Invoke-MT5VmLiveReadonlySingleProbeBoundary {"
            "param([string]$TerminalPath,[string]$AccountAlias,[int]$TimeoutMs);"
            "$index=if($AccountAlias -eq 'alpha-demo'){0}else{1};"
            "$script:events+=,('single:'+($index)+':'+$TimeoutMs);"
            "if($index -eq 1 -and $script:failSecond){throw 'synthetic probe failure'};"
            "return [pscustomobject]@{status='PASS';last_error_code=$null}};"
            "function Invoke-MT5VmLiveReadonlyConcurrentProbeBoundary {"
            "param([string[]]$TerminalPaths,[string[]]$AccountAliases,[int]$TimeoutMs);"
            "$script:events+=,('concurrent:'+$TimeoutMs);"
            "return @([pscustomobject]@{status='PASS'},[pscustomobject]@{status='PASS'})};"
            "$caught=$null;$result=$null;try{"
            "$result=Invoke-MT5VmLiveReadonlyMatrixCore "
            "-TerminalPaths @('C:\\Slots\\Alpha\\terminal64.exe',"
            "'D:\\Slots\\Beta Ω\\terminal64.exe') "
            "-AccountAliases @('alpha-demo','beta-demo') -TimeoutMs 60000"
            "}catch{$caught=$_.Exception.Message};"
            "[pscustomobject]@{presence=$script:presence;events=$script:events;"
            "caught=$caught;result=$result}|ConvertTo-Json -Compress -Depth 8"
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
            env={**os.environ, "MT5_MATRIX": str(MATRIX)},
        )

    def test_success_runs_single_then_concurrent_and_restores_initial_topology(self) -> None:
        completed = self._run_core()

        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertIsNone(observed["caught"])
        self.assertEqual([True, True], observed["presence"])
        self.assertEqual(
            [
                "set:0:False",
                "set:1:False",
                "single:0:60000",
                "set:0:False",
                "single:1:60000",
                "set:1:False",
                "set:0:True",
                "set:1:True",
                "concurrent:60000",
                "set:0:True",
                "set:1:True",
            ],
            observed["events"],
        )

    def test_probe_failure_restores_initial_topology_and_skips_concurrent_run(self) -> None:
        completed = self._run_core(fail_second_single=True)

        self.assertEqual(0, completed.returncode, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual("synthetic probe failure", observed["caught"])
        self.assertEqual([True, True], observed["presence"])
        self.assertNotIn("concurrent:60000", observed["events"])

    def test_source_has_no_broker_literal_or_force_termination_capability(self) -> None:
        self.assertTrue(MATRIX.exists(), "broker-neutral live matrix is not implemented")
        source = MATRIX.read_text(encoding="utf-8").casefold()
        for forbidden in (
            "exness",
            "ftmo",
            "stop-process",
            "taskkill",
            ".kill(",
            "terminateprocess",
            "win32_process.delete",
        ):
            self.assertNotIn(forbidden, source)

    def test_gauntlet_invokes_array_typed_matrix_parameters_in_process(self) -> None:
        source = GAUNTLET.read_text(encoding="utf-8")
        matrix_block = source.split("if ($IncludeRealReadonlyMatrix) {", 1)[1].split(
            "Write-Host 'MT5_VM_POWERSHELL_GAUNTLET=PASS'", 1
        )[0]

        self.assertIn("$matrixOutput = & $matrixPath", matrix_block)
        self.assertNotIn("powershell.exe", matrix_block.casefold())


if __name__ == "__main__":
    unittest.main()
