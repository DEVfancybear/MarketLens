"""Backend-issued pairing ticket validation for the local MT5 connector."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import time
from typing import Any, Callable, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


DEFAULT_API_BASE_URL = "https://api.tradingterminal.io.vn"
VALIDATE_PATH = "/api/v1/settings/integrations/mt5/connector/validate"
MAX_RESPONSE_BYTES = 64 * 1024


class TicketValidationError(RuntimeError):
    """A pairing ticket was rejected or could not be validated safely."""


@dataclass(frozen=True)
class ValidatedTicket:
    login: str
    server: str
    expires_at_ms: int


class TicketValidator(Protocol):
    def validate(self, ticket: str) -> ValidatedTicket: ...


class BackendTicketValidator:
    def __init__(
        self,
        api_base_url: str = DEFAULT_API_BASE_URL,
        *,
        timeout_seconds: float = 8,
        opener: Callable[..., Any] = urlopen,
    ) -> None:
        self.api_base_url = _validate_api_base_url(api_base_url)
        self.timeout_seconds = max(1.0, min(float(timeout_seconds), 15.0))
        self._opener = opener

    def validate(self, ticket: str) -> ValidatedTicket:
        ticket = str(ticket or "").strip()
        if not ticket or len(ticket) > 256:
            raise TicketValidationError("invalid_ticket")
        request = Request(
            f"{self.api_base_url}{VALIDATE_PATH}",
            data=json.dumps({"ticket": ticket}, separators=(",", ":")).encode("utf-8"),
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "TradingTerminal-MT5-Connector/1.0",
            },
            method="POST",
        )
        try:
            with self._opener(request, timeout=self.timeout_seconds) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except HTTPError as exc:
            if 400 <= exc.code < 500:
                raise TicketValidationError("invalid_ticket") from None
            raise TicketValidationError("validation_unavailable") from None
        except (URLError, OSError, TimeoutError):
            raise TicketValidationError("validation_unavailable") from None
        if len(raw) > MAX_RESPONSE_BYTES:
            raise TicketValidationError("invalid_response")
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            raise TicketValidationError("invalid_response") from None
        if not isinstance(payload, dict) or payload.get("ok") is not True:
            raise TicketValidationError("invalid_ticket")
        account = payload.get("account")
        if not isinstance(account, dict):
            raise TicketValidationError("invalid_response")
        login = _safe_identity(account.get("login"), 32)
        server = _safe_identity(account.get("server"), 128)
        expires_at_ms = _parse_expiry_ms(payload.get("expiresAt"))
        if not login or not login.isdigit() or int(login) <= 0 or not server:
            raise TicketValidationError("invalid_response")
        if expires_at_ms <= int(time.time() * 1000):
            raise TicketValidationError("expired_ticket")
        return ValidatedTicket(login, server, expires_at_ms)


def _validate_api_base_url(value: str) -> str:
    value = str(value or "").strip().rstrip("/")
    parsed = urlparse(value)
    loopback = (parsed.hostname or "").casefold() in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and loopback):
        raise ValueError("connector API URL must use HTTPS (HTTP is allowed only for loopback development)")
    if (
        not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.params
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("connector API URL is invalid")
    return value


def _safe_identity(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    if not text or len(text) > limit or any(not char.isprintable() for char in text):
        return ""
    return text


def _parse_expiry_ms(value: Any) -> int:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = int(value)
        return number * 1000 if number < 10_000_000_000 else number
    if isinstance(value, str):
        text = value.strip()
        if text.isdigit():
            return _parse_expiry_ms(int(text))
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return 0
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return int(parsed.timestamp() * 1000)
    return 0
