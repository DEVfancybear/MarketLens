"""Windows MT5 terminal discovery for the packaged local connector."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
from typing import Iterable


def running_terminal_paths() -> list[str]:
    """Return unique executable paths for running ``terminal64.exe`` processes.

    PowerShell is part of supported Windows installations and lets the
    connector discover per-broker MT5 installations without adding a process
    inspection dependency.  Discovery failure is non-fatal because the MT5
    Python package also supports automatic terminal selection.
    """

    if os.name != "nt":
        return []
    command = [
        "powershell.exe",
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='terminal64.exe'\" | "
        "Select-Object -ExpandProperty ExecutablePath",
    ]
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
            creationflags=creation_flags,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if result.returncode != 0:
        return []
    return _unique_existing_paths(result.stdout.splitlines())


def installed_terminal_paths() -> list[str]:
    """Find likely FTMO/MetaTrader terminal installs in standard locations."""

    if os.name != "nt":
        return []
    roots = []
    for variable in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
        value = os.getenv(variable)
        if value:
            roots.append(Path(value))
    candidates: list[Path] = []
    directory_patterns = ("*FTMO*", "*MetaTrader*", "*MT5*")
    for root in roots:
        for pattern in directory_patterns:
            try:
                for directory in root.glob(pattern):
                    candidates.append(directory / "terminal64.exe")
            except OSError:
                continue
    return _unique_existing_paths(str(path) for path in candidates)


def terminal_candidates() -> list[str]:
    """Prefer running terminals, then installed broker terminals."""

    return _unique_existing_paths(
        [*running_terminal_paths(), *installed_terminal_paths()]
    )


def _unique_existing_paths(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for raw in values:
        value = str(raw or "").strip().strip('"')
        if not value:
            continue
        path = Path(value)
        try:
            if not path.is_file():
                continue
            resolved = str(path.resolve())
        except OSError:
            continue
        key = resolved.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(resolved)
    return result
