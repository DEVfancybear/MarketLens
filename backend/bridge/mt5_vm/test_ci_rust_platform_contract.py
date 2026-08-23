import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
PROCESS_RS = (
    ROOT
    / "backend"
    / "execution"
    / "crates"
    / "mt5-vm-agent"
    / "src"
    / "process.rs"
)
CI_WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"


class RustCiPlatformContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.process_source = PROCESS_RS.read_text(encoding="utf-8")
        cls.workflow_source = CI_WORKFLOW.read_text(encoding="utf-8")

    def assert_windows_only_function(self, name: str) -> None:
        pattern = re.compile(
            rf"(?m)^    #\[cfg\(windows\)\]\n"
            rf"(?:    #\[test\]\n)?"
            rf"    fn {re.escape(name)}\b"
        )
        self.assertRegex(
            self.process_source,
            pattern,
            f"{name} must be compiled only on Windows",
        )

    def test_windows_process_fixtures_are_narrowly_gated(self) -> None:
        for name in (
            "executable_on_path",
            "live_local_process_config_fixture",
            "local_process_driver_runs_signed_start_heartbeat_sync_and_stop_lifecycle",
            "process_start_failure_cleans_the_reserved_runtime_assignment",
        ):
            with self.subTest(name=name):
                self.assert_windows_only_function(name)

        for name in (
            "local_process_driver_runs_signed_start_heartbeat_sync_and_stop_lifecycle",
            "process_start_failure_cleans_the_reserved_runtime_assignment",
        ):
            position = self.process_source.index(f"fn {name}")
            attributes = self.process_source[max(0, position - 100) : position]
            self.assertNotIn("#[ignore", attributes)

    def test_portable_config_test_keeps_only_windows_assertions_conditional(self) -> None:
        start = self.process_source.index(
            "fn process_config_accepts_pinned_fixture_defaults_and_splits_slots"
        )
        end = self.process_source.index(
            "fn managed_text_decoder_accepts_utf8_and_utf16_and_rejects_invalid_encodings",
            start,
        )
        block = self.process_source[start:end]
        attributes = self.process_source[max(0, start - 60) : start]

        self.assertIn("#[test]", attributes)
        self.assertNotIn("#[cfg(windows)]", attributes)
        self.assertIn("#[cfg(windows)]\n        {", block)
        self.assertIn("ensure_minimum_free_disk(&root, u64::MAX).unwrap_err()", block)
        self.assertIn("#[cfg(not(windows))]", block)
        self.assertIn(
            'ensure_minimum_free_disk(&root, u64::MAX)\n'
            '            .expect("non-Windows disk guard is a documented no-op")',
            block,
        )

    def test_windows_agent_tests_block_artifact_build(self) -> None:
        test_step = "- name: Run Windows managed-agent tests"
        build_step = "- name: Build Rust production binaries"
        self.assertIn(test_step, self.workflow_source)
        self.assertIn(
            "run: cargo test --locked -p mt5-vm-agent --lib -- --test-threads=1",
            self.workflow_source,
        )
        self.assertLess(
            self.workflow_source.index(test_step),
            self.workflow_source.index(build_step),
        )


if __name__ == "__main__":
    unittest.main()
