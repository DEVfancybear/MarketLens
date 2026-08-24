from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
RUNNER = ROOT / "tools" / "verify-mt5-baremetal-managed-ea-mutants.ps1"


@unittest.skipUnless(sys.platform == "win32", "mutation runner is Windows-only")
class ManagedMutationRunnerTests(unittest.TestCase):
    def test_self_test_proves_fail_closed_controls_and_byte_exact_restore(self) -> None:
        self.assertTrue(RUNNER.exists(), f"missing mutation runner: {RUNNER}")

        completed = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(RUNNER),
                "-SelfTest",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
            timeout=120,
        )

        self.assertEqual(0, completed.returncode, completed.stderr or completed.stdout)
        for control in (
            "missing-target-anchor",
            "duplicate-target-anchor",
            "missing-checker-anchor",
            "surviving-mutant",
            "compile-error",
            "exclusive-lock",
            "transient-windows-write-retry",
        ):
            self.assertIn(f"CONTROL_OK={control}", completed.stdout)
        self.assertIn("MUTATION_SELF_TEST_OK=2/2", completed.stdout)
        self.assertIn("BYTE_EXACT_RESTORE_OK", completed.stdout)

    def test_runner_declares_every_required_managed_mt5_mutant(self) -> None:
        source = RUNNER.read_text(encoding="utf-8")

        required = (
            "M1_BYPASS_AUTHENTICATED_OWNER",
            "M2_EXPOSE_PASSWORD",
            "M3_REUSE_CREDENTIAL_GRANT",
            "M4_IGNORE_LEASE_GENERATION",
            "M5_ACCEPT_WRONG_PIPE_PID",
            "M6_READY_BEFORE_FRESH_POLL",
            "M7_RELEASE_DIRTY_SLOT",
            "M8_RESEND_UNKNOWN_OUTCOME",
            "M9_CORRUPT_CREDENTIAL_TARGET",
            "M10_WEAKEN_CREDENTIAL_SIZE_BOUND",
            "M11_REJECT_IDEMPOTENT_NOT_FOUND_DELETE",
            "M12_ENABLE_WITH_FAILED_CREDENTIAL_PROBE",
            "M13_SKIP_CREDENTIAL_BUFFER_CLEAR",
        )
        for mutant_id in required:
            self.assertEqual(1, source.count(f"Id = '{mutant_id}'"))

        self.assertIn("MUTATION_EXECUTION_REQUIRES_EXPLICIT_EXECUTE", source)
        self.assertIn("MUTATION_BLOCKED", source)
        self.assertIn("MUTATION_SURVIVED", source)
        self.assertIn("MUTATION_INFRASTRUCTURE_FAILURE", source)
        self.assertIn("Write-BytesWithTransientWindowsRetry", source)
        self.assertIn("ERROR_USER_MAPPED_FILE", source)


if __name__ == "__main__":
    unittest.main()
