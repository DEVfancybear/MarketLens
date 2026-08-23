from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CHECKER = ROOT / "tools" / "mt5-baremetal" / "changed_line_coverage.py"
ARTIFACT_ROOT = ROOT / ".artifacts" / "mt5-baremetal-managed-ea" / "checker-tests"


class ChangedLineCoverageTests(unittest.TestCase):
    def run_checker(
        self,
        *,
        diff: str,
        coverage: str | None,
        coverage_format: str,
        source_root: str,
    ) -> tuple[subprocess.CompletedProcess[str], dict[str, object] | None]:
        ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ARTIFACT_ROOT) as directory:
            work = Path(directory)
            diff_path = work / "changed.diff"
            coverage_path = work / "coverage.out"
            summary_path = work / "summary.json"
            diff_path.write_text(diff, encoding="utf-8")
            if coverage is not None:
                coverage_path.write_text(coverage, encoding="utf-8")

            completed = subprocess.run(
                [
                    sys.executable,
                    str(CHECKER),
                    "--format",
                    coverage_format,
                    "--coverage",
                    str(coverage_path),
                    "--diff",
                    str(diff_path),
                    "--repo-root",
                    str(ROOT),
                    "--source-root",
                    source_root,
                    "--label",
                    f"fixture-{coverage_format}",
                    "--json-output",
                    str(summary_path),
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )
            summary = (
                json.loads(summary_path.read_text(encoding="utf-8"))
                if summary_path.is_file()
                else None
            )
            return completed, summary

    def test_accepts_fully_covered_go_and_llvm_lcov_changed_lines(self) -> None:
        fixtures = (
            (
                "go",
                "backend",
                """diff --git a/backend/internal/example.go b/backend/internal/example.go
--- a/backend/internal/example.go
+++ b/backend/internal/example.go
@@ -9,0 +10,2 @@
+first()
+second()
""",
                """mode: atomic
example.test/internal/example.go:10.1,12.1 2 1
""",
            ),
            (
                "lcov",
                "backend/execution",
                """diff --git a/backend/execution/crates/demo/src/lib.rs b/backend/execution/crates/demo/src/lib.rs
--- a/backend/execution/crates/demo/src/lib.rs
+++ b/backend/execution/crates/demo/src/lib.rs
@@ -19,0 +20,2 @@
+first();
+second();
""",
                """TN:
SF:backend/execution/crates/demo/src/lib.rs
DA:20,1
DA:21,3
end_of_record
""",
            ),
        )
        for coverage_format, source_root, diff, coverage in fixtures:
            with self.subTest(coverage_format=coverage_format):
                completed, summary = self.run_checker(
                    diff=diff,
                    coverage=coverage,
                    coverage_format=coverage_format,
                    source_root=source_root,
                )
                self.assertEqual(0, completed.returncode, completed.stderr or completed.stdout)
                self.assertIn("CHANGED_LINE_COVERAGE=fixture-", completed.stdout)
                self.assertIn("COVERED=2/2", completed.stdout)
                self.assertEqual(2, summary["covered_changed_lines"] if summary else None)
                self.assertEqual([], summary["uncovered"] if summary else None)

    def test_rejects_an_uncovered_changed_executable_line(self) -> None:
        completed, summary = self.run_checker(
            coverage_format="lcov",
            source_root="backend/execution",
            diff="""diff --git a/backend/execution/crates/demo/src/lib.rs b/backend/execution/crates/demo/src/lib.rs
--- a/backend/execution/crates/demo/src/lib.rs
+++ b/backend/execution/crates/demo/src/lib.rs
@@ -19,0 +20,2 @@
+first();
+second();
""",
            coverage="""SF:backend/execution/crates/demo/src/lib.rs
DA:20,1
DA:21,0
end_of_record
""",
        )
        self.assertNotEqual(0, completed.returncode)
        self.assertIn("uncovered changed executable lines", completed.stderr)
        self.assertIsNone(summary)

    def test_rejects_missing_malformed_empty_and_zero_coverable_reports(self) -> None:
        diff = """diff --git a/backend/internal/example.go b/backend/internal/example.go
--- a/backend/internal/example.go
+++ b/backend/internal/example.go
@@ -9,0 +10,1 @@
+first()
"""
        cases = (
            (None, "coverage report is missing"),
            ("", "coverage report is empty"),
            ("not a Go coverage profile\n", "malformed Go coverage report"),
            ("mode: atomic\nexample.test/internal/example.go:30.1,31.1 1 1\n", "zero coverable changed lines"),
        )
        for coverage, expected in cases:
            with self.subTest(expected=expected):
                completed, summary = self.run_checker(
                    coverage_format="go",
                    source_root="backend",
                    diff=diff,
                    coverage=coverage,
                )
                self.assertNotEqual(0, completed.returncode)
                self.assertIn(expected, completed.stderr)
                self.assertIsNone(summary)

    def test_rejects_changed_source_missing_from_the_coverage_report(self) -> None:
        completed, summary = self.run_checker(
            coverage_format="go",
            source_root="backend",
            diff="""diff --git a/backend/internal/example.go b/backend/internal/example.go
--- a/backend/internal/example.go
+++ b/backend/internal/example.go
@@ -9,0 +10,1 @@
+first()
diff --git a/backend/internal/missing.go b/backend/internal/missing.go
--- a/backend/internal/missing.go
+++ b/backend/internal/missing.go
@@ -4,0 +5,1 @@
+missing()
""",
            coverage="""mode: atomic
example.test/internal/example.go:10.1,11.1 1 1
""",
        )
        self.assertNotEqual(0, completed.returncode)
        self.assertIn("changed source files absent from coverage", completed.stderr)
        self.assertIn("backend/internal/missing.go", completed.stderr)
        self.assertIsNone(summary)


if __name__ == "__main__":
    unittest.main()
