from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[3]
GATE = ROOT / "tools" / "verify-mt5-baremetal-managed-ea.ps1"
MIGRATION_GATE = ROOT / "tools" / "verify-migration-0042-disposable.ps1"
GITIGNORE = ROOT / ".gitignore"


class ManagedGauntletContractTests(unittest.TestCase):
    def test_llvm_profiles_cannot_leak_into_the_source_tree(self) -> None:
        patterns = GITIGNORE.read_text(encoding="utf-8").splitlines()
        self.assertIn("*.profraw", patterns)

    def test_gate_persists_every_required_layer_and_allowed_live_blocker(self) -> None:
        self.assertTrue(GATE.is_file(), f"missing managed EA gauntlet: {GATE}")
        source = GATE.read_text(encoding="utf-8")

        for required in (
            ".artifacts\\mt5-baremetal-managed-ea",
            "go-vet",
            "go-race",
            "changed-source-diffs",
            "go-changed-coverage-gate",
            "go-changed-coverage-negative-control",
            "GO_COVERAGE_BINARIES",
            "-test.coverprofile",
            "rust-fmt",
            "rust-clippy",
            "rust-tests",
            "rust-coverage-toolchain",
            "rust-coverage-build",
            "rust-coverage-agent-warmup",
            "rust-coverage-tests",
            "rust-database-integration",
            "rust-coverage-merge",
            "rust-coverage-export",
            "rust-changed-coverage-gate",
            "rust-changed-coverage-negative-control",
            "changed_line_coverage.py",
            "llvm-tools-x86_64-pc-windows-msvc",
            "22.1.6-rust-1.97.1-stable",
            "test_changed_line_coverage",
            "python-managed",
            "powershell-parse",
            "deploy-backend-self-test",
            "run-backend-production.ps1",
            "build-production.ps1",
            "deploy-backend.ps1",
            "verify-backend-deploy.ps1",
            "postgres-0042-positive",
            "postgres-0042-negative-control",
            "mutation-self-test",
            "mutation-score",
            "Publish-MarketLensExecutionEA.ps1",
            "frontend-typecheck",
            "frontend-lint",
            "frontend-trade-tests",
            "npm-production-audit",
            "secret-diff-scan",
            "SECRET_SCAN_PLACEHOLDER_CONTROL_OK",
            "SECRET_SCAN_NEGATIVE_CONTROL_OK",
            "RUNNER_SECURITY_EXPORT_OK",
            "RUNNER_CAPABILITY_NEGATIVE_CONTROL_OK",
            "R15-9-live-demo",
            "UNVERIFIED_ALLOWED",
            "summary.json",
            "source-state.json",
            "task_tree_sha256",
            "Remove-ReportRootWithTransientWindowsRetry",
        ):
            self.assertIn(required, source)

        for forbidden in ("SkipRust", "SkipTests", "SkipMigration"):
            self.assertNotIn(forbidden, source)
        self.assertNotIn("throw 'run-backend-production.ps1 was modified'", source)

        self.assertIn("'-o', $binary", source)
        self.assertNotIn('"-o=$binary"', source)
        self.assertIn("'.example', '.yml'", source)

        # Smart App Control can quarantine a newly linked Rust test or Cargo
        # build-script briefly. The gate may retry only that exact OS 4551
        # outcome; every other non-zero exit must remain fail-closed.
        self.assertIn("Invoke-CapturedProcessWithApplicationControlRetry", source)
        self.assertIn("ApplicationControlRetries", source)
        self.assertIn("An Application Control policy has blocked this file", source)
        self.assertIn("os error 4551", source)
        self.assertIn("RUST_COVERAGE_BUILD_SELECTIONS=combined", source)
        self.assertNotIn("Name = 'gateway-only'", source)
        self.assertIn("CARGO_BUILD_TARGET = $rustCoverageTriple", source)
        self.assertIn(
            "CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS", source
        )
        self.assertIn("CARGO_ENCODED_RUSTFLAGS = $null", source)
        self.assertIn("EnvironmentVariables.Remove($key)", source)
        self.assertIn("$rustCoverageObjectRoot", source)
        self.assertIn("$rustAgentTargetRoot", source)
        self.assertIn("CARGO_TARGET_DIR = $rustAgentTargetRoot", source)
        self.assertNotIn("\n    RUSTFLAGS = '-C instrument-coverage'", source)
        rust_agent_block = source.split(
            "Invoke-NativeLayer 'rust-agent-tests'", 1
        )[1].split("Invoke-NativeLayer 'rust-stress-properties'", 1)[0]
        rust_agent_block = " ".join(rust_agent_block.split())
        self.assertIn(
            "'-p', 'mt5-vm-agent', '--lib', '--test', 'managed_commands',",
            rust_agent_block,
        )
        self.assertIn(
            "'--test', 'managed_control', '--test', 'managed_worker_cli'",
            rust_agent_block,
        )
        self.assertIn("-EnvironmentVariables $rustAgentEnvironment", rust_agent_block)
        self.assertNotIn(
            "'-p', 'mt5-vm-agent', '--all-targets', '--', '--test-threads=1'",
            rust_agent_block,
        )

        migration_source = MIGRATION_GATE.read_text(encoding="utf-8")
        self.assertIn(
            "'-p', 'execution-gateway', '-p', 'mt5-vm-agent'",
            migration_source,
        )
        self.assertIn("'--bin', 'execution-gateway'", migration_source)
        self.assertIn(
            "Invoke-NativeCaptureWithApplicationControlRetry",
            migration_source,
        )
        self.assertIn("ApplicationControlRetries", migration_source)
        self.assertIn(
            "An Application Control policy has blocked this file",
            migration_source,
        )
        self.assertIn(
            "Invoke-NativeCaptureWithApplicationControlRetry 'go'",
            migration_source,
        )
        self.assertIn(
            "Invoke-NativeCaptureWithApplicationControlRetry 'cargo.exe'",
            migration_source,
        )


if __name__ == "__main__":
    unittest.main()
