from __future__ import annotations

import json
import time
import unittest

from bridge.ftmo_mt5.connector_auth import (
    BackendTicketValidator,
    TicketValidationError,
    VALIDATE_PATH,
)


class _Response:
    def __init__(self, payload: object) -> None:
        self.raw = json.dumps(payload).encode("utf-8")

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self, _limit: int) -> bytes:
        return self.raw


class BackendTicketValidatorTests(unittest.TestCase):
    def test_posts_ticket_and_accepts_sanitized_account(self) -> None:
        captured: dict[str, object] = {}

        def opener(request: object, *, timeout: float) -> _Response:
            captured["url"] = request.full_url  # type: ignore[attr-defined]
            captured["body"] = json.loads(request.data)  # type: ignore[attr-defined]
            captured["timeout"] = timeout
            return _Response(
                {
                    "ok": True,
                    "account": {"login": "12345678", "server": "FTMO-Server4"},
                    "expiresAt": int(time.time() * 1000) + 60_000,
                }
            )

        result = BackendTicketValidator(opener=opener).validate("one-time-ticket")

        self.assertEqual(result.login, "12345678")
        self.assertEqual(result.server, "FTMO-Server4")
        self.assertEqual(
            captured["url"], f"https://api.tradingterminal.io.vn{VALIDATE_PATH}"
        )
        self.assertEqual(captured["body"], {"ticket": "one-time-ticket"})

    def test_rejects_expired_or_malformed_backend_result(self) -> None:
        expired = BackendTicketValidator(
            opener=lambda *_args, **_kwargs: _Response(
                {
                    "ok": True,
                    "account": {"login": "123", "server": "FTMO-Server4"},
                    "expiresAt": int(time.time() * 1000) - 1,
                }
            )
        )
        with self.assertRaisesRegex(TicketValidationError, "expired_ticket"):
            expired.validate("ticket")

        malformed = BackendTicketValidator(
            opener=lambda *_args, **_kwargs: _Response(
                {"ok": True, "account": {"login": "not-numeric", "server": "FTMO"}}
            )
        )
        with self.assertRaisesRegex(TicketValidationError, "invalid_response"):
            malformed.validate("ticket")

    def test_allows_plain_http_only_for_loopback_development(self) -> None:
        BackendTicketValidator(
            "http://localhost:8080",
            opener=lambda *_args, **_kwargs: _Response({}),
        )
        with self.assertRaises(ValueError):
            BackendTicketValidator("http://api.example.com")


if __name__ == "__main__":
    unittest.main()
