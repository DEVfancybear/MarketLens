"""Emit non-sensitive managed Python runtime metadata for Phase 0."""

from __future__ import annotations

import json
import platform
import struct


def main() -> int:
    try:
        import MetaTrader5 as mt5
        import websockets

        result = {
            "ok": True,
            "python": platform.python_version(),
            "bits": struct.calcsize("P") * 8,
            "metatrader5": getattr(mt5, "__version__", "unknown"),
            "websockets": getattr(websockets, "__version__", "unknown"),
            "error_class": None,
        }
    except Exception as exc:  # pragma: no cover - exercised by host preflight
        result = {
            "ok": False,
            "python": platform.python_version(),
            "bits": struct.calcsize("P") * 8,
            "metatrader5": None,
            "websockets": None,
            "error_class": type(exc).__name__,
        }
    print(json.dumps(result, separators=(",", ":"), allow_nan=False))
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
