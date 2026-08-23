#!/usr/bin/env python3
"""Fail closed unless every coverable added source line was executed.

The checker intentionally has no third-party dependencies. It consumes a zero-context
unified diff plus either a Go coverprofile or LLVM LCOV export and emits a compact JSON
summary only after every invariant passes.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path


HUNK_RE = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")
GO_LINE_RE = re.compile(r"^(.*):(\d+)\.(\d+),(\d+)\.(\d+)\s+(\d+)\s+(-?\d+)$")
LCOV_LINE_RE = re.compile(r"^DA:(\d+),(-?\d+)(?:,.*)?$")


class CoverageError(RuntimeError):
    """The report, diff, or coverage constraint is invalid."""


@dataclass(frozen=True)
class CoverageReport:
    source_files: frozenset[str]
    line_counts: dict[str, dict[int, int]]


def normalize_path(raw: str, repo_root: Path) -> str:
    value = raw.strip().strip('"').replace("\\", "/")
    if value.startswith("a/") or value.startswith("b/"):
        value = value[2:]

    root = repo_root.resolve().as_posix().rstrip("/")
    if value.casefold().startswith((root + "/").casefold()):
        value = value[len(root) + 1 :]

    while value.startswith("./"):
        value = value[2:]
    return value.rstrip("/")


def require_text(path: Path, label: str) -> str:
    if not path.is_file():
        raise CoverageError(f"{label} is missing: {path}")
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise CoverageError(f"{label} is unreadable UTF-8: {path}: {error}") from error
    if not text.strip():
        raise CoverageError(f"{label} is empty: {path}")
    return text


def parse_changed_lines(text: str, repo_root: Path) -> dict[str, set[int]]:
    changed: dict[str, set[int]] = {}
    current_file: str | None = None
    next_new_line: int | None = None
    saw_hunk = False

    for raw_line in text.splitlines():
        if raw_line.startswith("diff --git "):
            current_file = None
            next_new_line = None
            continue
        if raw_line.startswith("+++ "):
            candidate = raw_line[4:].split("\t", 1)[0]
            current_file = (
                None
                if candidate == "/dev/null"
                else normalize_path(candidate, repo_root)
            )
            next_new_line = None
            continue
        if raw_line.startswith("@@ "):
            match = HUNK_RE.match(raw_line)
            if match is None or current_file is None:
                raise CoverageError(f"malformed unified diff hunk: {raw_line}")
            next_new_line = int(match.group(1))
            saw_hunk = True
            continue
        if next_new_line is None or current_file is None:
            continue
        if raw_line.startswith("+"):
            changed.setdefault(current_file, set()).add(next_new_line)
            next_new_line += 1
        elif raw_line.startswith("-") or raw_line.startswith("\\ No newline"):
            continue
        else:
            next_new_line += 1

    if not saw_hunk:
        raise CoverageError("unified diff contains no parseable hunks")
    if not changed:
        raise CoverageError("unified diff contains zero added source lines")
    return changed


def parse_go_coverprofile(text: str, repo_root: Path) -> CoverageReport:
    lines = text.splitlines()
    if not lines or lines[0] not in {"mode: set", "mode: count", "mode: atomic"}:
        raise CoverageError("malformed Go coverage report: missing valid mode header")

    sources: set[str] = set()
    counts: dict[str, dict[int, int]] = {}
    records = 0
    for raw_line in lines[1:]:
        if not raw_line.strip():
            continue
        match = GO_LINE_RE.match(raw_line)
        if match is None:
            raise CoverageError(f"malformed Go coverage report line: {raw_line}")
        source = normalize_path(match.group(1), repo_root)
        start_line = int(match.group(2))
        end_line = int(match.group(4))
        execution_count = int(match.group(7))
        if start_line < 1 or end_line < start_line or execution_count < 0:
            raise CoverageError(f"malformed Go coverage report range/count: {raw_line}")
        sources.add(source)
        per_line = counts.setdefault(source, {})
        for line_number in range(start_line, end_line + 1):
            per_line[line_number] = max(per_line.get(line_number, 0), execution_count)
        records += 1

    if records == 0:
        raise CoverageError("malformed Go coverage report: zero coverage records")
    return CoverageReport(frozenset(sources), counts)


def parse_lcov(text: str, repo_root: Path) -> CoverageReport:
    sources: set[str] = set()
    counts: dict[str, dict[int, int]] = {}
    current_source: str | None = None
    records = 0
    completed_records = 0

    for raw_line in text.splitlines():
        if raw_line.startswith("SF:"):
            if current_source is not None:
                raise CoverageError("malformed LLVM LCOV report: nested SF record")
            current_source = normalize_path(raw_line[3:], repo_root)
            if not current_source:
                raise CoverageError("malformed LLVM LCOV report: empty SF path")
            sources.add(current_source)
            counts.setdefault(current_source, {})
        elif raw_line.startswith("DA:"):
            if current_source is None:
                raise CoverageError("malformed LLVM LCOV report: DA before SF")
            match = LCOV_LINE_RE.match(raw_line)
            if match is None:
                raise CoverageError(f"malformed LLVM LCOV report line: {raw_line}")
            line_number = int(match.group(1))
            execution_count = int(match.group(2))
            if line_number < 1 or execution_count < 0:
                raise CoverageError(f"malformed LLVM LCOV report range/count: {raw_line}")
            per_line = counts[current_source]
            per_line[line_number] = max(per_line.get(line_number, 0), execution_count)
            records += 1
        elif raw_line == "end_of_record":
            if current_source is None:
                raise CoverageError("malformed LLVM LCOV report: end without SF")
            current_source = None
            completed_records += 1

    if current_source is not None:
        raise CoverageError("malformed LLVM LCOV report: unterminated SF record")
    if completed_records == 0 or records == 0:
        raise CoverageError("malformed LLVM LCOV report: zero complete coverage records")
    return CoverageReport(frozenset(sources), counts)


def resolve_report_source(
    report_source: str,
    changed_sources: set[str],
    source_root: str,
) -> str | None:
    report = report_source.casefold()
    normalized_root = source_root.strip("/\\").replace("\\", "/")
    candidates: list[str] = []
    for changed_source in changed_sources:
        changed = changed_source.replace("\\", "/")
        relative = changed
        root_prefix = normalized_root + "/" if normalized_root else ""
        if root_prefix and changed.casefold().startswith(root_prefix.casefold()):
            relative = changed[len(root_prefix) :]
        suffixes = {changed.casefold(), relative.casefold()}
        if any(report == suffix or report.endswith("/" + suffix) for suffix in suffixes):
            candidates.append(changed_source)

    unique = sorted(set(candidates))
    if len(unique) > 1:
        raise CoverageError(
            f"coverage source path maps ambiguously: {report_source}: {', '.join(unique)}"
        )
    return unique[0] if unique else None


def enforce_changed_line_coverage(
    changed: dict[str, set[int]],
    report: CoverageReport,
    source_root: str,
    label: str,
    coverage_format: str,
) -> dict[str, object]:
    changed_sources = set(changed)
    mapped_sources: set[str] = set()
    mapped_counts: dict[str, dict[int, int]] = {}

    for report_source in report.source_files:
        changed_source = resolve_report_source(report_source, changed_sources, source_root)
        if changed_source is None:
            continue
        mapped_sources.add(changed_source)
        destination = mapped_counts.setdefault(changed_source, {})
        for line_number, execution_count in report.line_counts.get(report_source, {}).items():
            destination[line_number] = max(
                destination.get(line_number, 0), execution_count
            )

    missing = sorted(changed_sources - mapped_sources)
    if missing:
        raise CoverageError(
            "changed source files absent from coverage: " + ", ".join(missing)
        )

    coverable: list[tuple[str, int, int]] = []
    for source in sorted(changed):
        line_counts = mapped_counts.get(source, {})
        for line_number in sorted(changed[source]):
            if line_number in line_counts:
                coverable.append((source, line_number, line_counts[line_number]))

    if not coverable:
        raise CoverageError("zero coverable changed lines")

    uncovered = [f"{source}:{line}" for source, line, count in coverable if count == 0]
    if uncovered:
        raise CoverageError(
            "uncovered changed executable lines: " + ", ".join(uncovered)
        )

    total = len(coverable)
    return {
        "status": "PASS",
        "label": label,
        "format": coverage_format,
        "changed_files": len(changed_sources),
        "coverable_changed_lines": total,
        "covered_changed_lines": total,
        "uncovered": [],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--format", choices=("go", "lcov"), required=True)
    parser.add_argument("--coverage", type=Path, required=True)
    parser.add_argument("--diff", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--json-output", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.json_output.exists():
            args.json_output.unlink()
        diff_text = require_text(args.diff, "unified diff")
        coverage_text = require_text(args.coverage, "coverage report")
        changed = parse_changed_lines(diff_text, args.repo_root)
        report = (
            parse_go_coverprofile(coverage_text, args.repo_root)
            if args.format == "go"
            else parse_lcov(coverage_text, args.repo_root)
        )
        summary = enforce_changed_line_coverage(
            changed, report, args.source_root, args.label, args.format
        )
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(
            json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
    except (CoverageError, OSError) as error:
        print(f"CHANGED_LINE_COVERAGE_BLOCKED={error}", file=sys.stderr)
        return 1

    print(
        f"CHANGED_LINE_COVERAGE={args.label} "
        f"COVERED={summary['covered_changed_lines']}/{summary['coverable_changed_lines']} "
        f"FILES={summary['changed_files']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
