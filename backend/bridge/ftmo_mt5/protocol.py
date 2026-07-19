from __future__ import annotations

import time
from typing import Any

PROTOCOL_VERSION = 1
CLIENT_NAME = "smc-trading-terminal"


def now_ms() -> int:
    return int(time.time() * 1000)


def envelope(message_type: str, payload: dict[str, Any], request_id: str | None = None) -> dict[str, Any]:
    message: dict[str, Any] = {
        "type": message_type,
        "version": PROTOCOL_VERSION,
        "ts": now_ms(),
        "payload": payload,
    }
    if request_id:
        message["id"] = request_id
    return message


def validate_envelope(message: Any) -> tuple[bool, str | None]:
    if not isinstance(message, dict):
        return False, "Message must be a JSON object"
    if message.get("version") != PROTOCOL_VERSION:
        return False, "Only protocol version 1 is supported"
    message_type = message.get("type")
    if not isinstance(message_type, str) or not message_type or len(message_type) > 64:
        return False, "Message type is required"
    if not isinstance(message.get("ts"), (int, float)):
        return False, "Message timestamp is required"
    request_id = message.get("id")
    if request_id is not None and (
        not isinstance(request_id, str) or not request_id or len(request_id) > 128
    ):
        return False, "Message id is invalid"
    if not isinstance(message.get("payload"), dict):
        return False, "Message payload must be an object"
    return True, None

