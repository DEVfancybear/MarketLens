from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SECRET_WORDS = ("password", "token", "secret")


class AuditLog:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.writable = False

    def open(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.touch(exist_ok=True)
        self.writable = True

    def append(self, event: str, payload: dict[str, Any] | None = None) -> None:
        if not self.writable:
            return
        record = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "event": event,
            **self._redact(payload or {}),
        }
        with self.path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(record, separators=(",", ":"), ensure_ascii=True))
            file.write("\n")

    def _redact(self, value: Any) -> Any:
        if isinstance(value, list):
            return [self._redact(item) for item in value]
        if isinstance(value, dict):
            cleaned: dict[str, Any] = {}
            for key, item in value.items():
                if any(word in key.lower() for word in SECRET_WORDS):
                    cleaned[key] = "[redacted]"
                else:
                    cleaned[key] = self._redact(item)
            return cleaned
        return value

