from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass
import json
import signal
import time
import uuid
from typing import Any

try:
    import websockets
except ImportError as exc:  # pragma: no cover - runtime setup guard
    raise SystemExit(
        "Missing dependency: install from backend/ with `python -m pip install -r bridge/ftmo_mt5/requirements.txt`",
    ) from exc

WebSocketServerProtocol = Any

from .audit_log import AuditLog
from .config import BridgeConfig, load_config
from .connector_auth import (
    TicketValidationError,
    TicketValidator,
    ValidatedTicket,
)
from .mt5_adapter import Mt5Adapter, Mt5AttachmentError
from .protocol import PROTOCOL_VERSION, envelope, now_ms, validate_envelope
from .risk_guard import RiskGuard
from .symbols import SymbolMeta, public_symbol_info

BRIDGE_VERSION = "1.0.0"


@dataclass(frozen=True)
class AuthenticatedSession:
    session_id: str
    expected_login: str
    expected_server: str
    expires_at_ms: int


@dataclass(frozen=True)
class RiskContext:
    account_key: str
    balance: float
    equity: float
    initial_balance: float | None


class FtmoMt5Service:
    def __init__(
        self,
        config: BridgeConfig,
        *,
        ticket_validator: TicketValidator | None = None,
        allowed_origins: tuple[str, ...] | None = None,
    ) -> None:
        self.config = config
        self.audit = AuditLog(config.audit_path)
        self.adapter = Mt5Adapter(config)
        self.risk = RiskGuard(
            config,
            state_path=config.audit_path.parent / "risk-baselines.json",
        )
        self.account_state_lock = asyncio.Lock()
        self.clients: set[WebSocketServerProtocol] = set()
        self.sessions: dict[WebSocketServerProtocol, AuthenticatedSession] = {}
        self.client_message_times: dict[WebSocketServerProtocol, deque[float]] = {}
        self.ticket_validator = ticket_validator
        if allowed_origins is None:
            allowed_origins = (
                (
                    "https://tradingterminal.io.vn",
                    "http://localhost:3000",
                    "http://127.0.0.1:3000",
                )
                if config.dry_run
                else ("https://tradingterminal.io.vn",)
            )
        self.allowed_origins = allowed_origins
        if ticket_validator is not None and not allowed_origins:
            raise ValueError("backend-ticket authentication requires an Origin allowlist")
        self.seen_client_orders: dict[tuple[str, str, str], dict[str, Any]] = {}
        self.dry_run_positions: dict[str, dict[str, Any]] = {}
        self.logged_symbol_caps: set[str] = set()
        self.ticket_sequence = 910000

    async def start(self) -> None:
        self.audit.open()
        if not self.config.dry_run and not self.config.attached_account:
            self.adapter.connect()
        async with websockets.serve(
            self.handle_client,
            self.config.host,
            self.config.port,
            origins=self.allowed_origins,
            compression=None,
            max_size=64 * 1024,
            max_queue=16,
        ):
            snapshot_task = asyncio.create_task(self.snapshot_poller())
            print(
                "TradingTerminal MT5 Connector is running. Keep this window open."
            )
            print(
                "Open FTMO MetaTrader 5, sign in to the account verified on "
                "tradingterminal.io.vn, then return to the browser.",
                flush=True,
            )
            snapshot = self.risk_snapshot()
            print(
                f"[ftmo-mt5-python] riskBase={snapshot['accountSize']:.2f} "
                f"source={snapshot.get('accountSizeSource', 'unknown')} "
                f"maxRiskPerTrade={snapshot.get('maxRiskPerTrade', 0):.2f} "
                f"maxOrderVolume={self.config.max_order_volume:.4f}",
            )
            try:
                await asyncio.Future()
            finally:
                snapshot_task.cancel()
                await asyncio.gather(snapshot_task, return_exceptions=True)

    async def handle_client(self, websocket: WebSocketServerProtocol) -> None:
        self.clients.add(websocket)
        self.client_message_times[websocket] = deque()
        await self.send(
            websocket,
            "hello",
            {
                "bridgeId": "ftmo-mt5-python-service",
                "bridgeVersion": BRIDGE_VERSION,
                "serverTime": now_ms(),
                "accountMode": "demo" if self.config.dry_run else "unknown",
                "dryRun": self.config.dry_run,
                "capabilities": ["backend-ticket-auth", "account-bound-execution"],
            },
        )
        heartbeat_task = asyncio.create_task(self.heartbeat(websocket))
        try:
            async for raw in websocket:
                if not self.client_message_allowed(websocket):
                    await self.send(
                        websocket,
                        "error",
                        {
                            "code": "RATE_LIMITED",
                            "message": "Too many Connector messages. Reconnect shortly.",
                        },
                    )
                    await websocket.close(code=1008, reason="connector message rate exceeded")
                    break
                await self.handle_message(websocket, raw)
        finally:
            heartbeat_task.cancel()
            self.clients.discard(websocket)
            self.sessions.pop(websocket, None)
            self.client_message_times.pop(websocket, None)

    def client_message_allowed(self, websocket: WebSocketServerProtocol) -> bool:
        now = time.monotonic()
        cutoff = now - 60
        bucket = self.client_message_times.setdefault(websocket, deque())
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        limit = max(1, int(self.config.max_messages_per_minute))
        if len(bucket) >= limit:
            return False
        bucket.append(now)
        return True

    async def heartbeat(self, websocket: WebSocketServerProtocol) -> None:
        while True:
            await asyncio.sleep(5)
            if self.session_expired(websocket):
                await self.close_authenticated_session(websocket, "session_expired")
                return
            account_error: tuple[str, str] | None = None
            readiness: dict[str, Any] | None = None
            risk: dict[str, Any] | None = None
            async with self.account_state_lock:
                session = self.session_for(websocket)
                if session is None:
                    continue
                account_error = self.adapter.expected_account_error(
                    session.expected_login, session.expected_server
                )
                if account_error is None:
                    account = self.account_snapshot()
                    positions = self.positions_snapshot()
                    readiness = self.readiness()
                    risk = self.risk_snapshot(account=account, positions=positions)
            if account_error is not None:
                await self.close_authenticated_session(
                    websocket, self.account_auth_reason(account_error[0])
                )
                return
            assert readiness is not None and risk is not None
            await self.send(websocket, "heartbeat", {"ts": now_ms()})
            await self.send(websocket, "ftmo.readiness", readiness)
            await self.send(websocket, "risk.snapshot", risk)

    async def snapshot_poller(self) -> None:
        interval = max(250, self.config.snapshot_interval_ms) / 1000
        while True:
            await asyncio.sleep(interval)
            if not any(self.session_for(client) for client in self.clients):
                continue
            await self.broadcast_snapshots()

    async def handle_message(
        self, websocket: WebSocketServerProtocol, raw: str
    ) -> None:
        try:
            message = json.loads(raw)
        except json.JSONDecodeError:
            await self.send(
                websocket,
                "error",
                {"code": "INVALID_MESSAGE", "message": "Invalid JSON"},
            )
            return
        ok, reason = validate_envelope(message)
        if not ok:
            request_id = message.get("id") if isinstance(message, dict) else None
            error_code = (
                "UNSUPPORTED_VERSION"
                if isinstance(message, dict)
                and message.get("version") != PROTOCOL_VERSION
                else "INVALID_MESSAGE"
            )
            await self.send(
                websocket,
                "error",
                {
                    "code": error_code,
                    "message": reason or "Invalid message",
                    "requestId": request_id,
                },
                request_id,
            )
            return
        message_type = message["type"]
        if message_type == "auth.request":
            await self.handle_auth(websocket, message)
            return

        if self.session_expired(websocket):
            await self.close_authenticated_session(websocket, "session_expired")
            return
        session = self.session_for(websocket)
        if session is None:
            await self.send(
                websocket,
                "error",
                {
                    "code": "AUTH_REQUIRED",
                    "message": "Authenticate this connector session before sending messages.",
                    "requestId": message.get("id"),
                },
                message.get("id"),
            )
            return

        if message_type.startswith("order."):
            account_error = self.adapter.expected_account_error(
                session.expected_login, session.expected_server
            )
            if account_error is not None:
                code, detail = account_error
                payload = message.get("payload") or {}
                client_order_id = (
                    payload.get("clientOrderId") if isinstance(payload, dict) else None
                )
                await self.reject_order(
                    websocket, message, code, detail, client_order_id
                )
                return

        if message_type == "heartbeat":
            await self.send(websocket, "heartbeat", {"ts": now_ms()})
        elif message_type == "order.place":
            await self.handle_order_place(websocket, message, session)
        elif message_type == "order.close":
            await self.handle_order_close(websocket, message, session)
        elif message_type == "order.closeAll":
            await self.handle_order_close_all(websocket, message, session)
        elif message_type == "order.modify":
            await self.handle_order_modify(websocket, message, session)
        elif message_type == "order.cancel":
            await self.handle_order_cancel(websocket, message, session)
        else:
            await self.send(
                websocket,
                "error",
                {
                    "code": "UNKNOWN_TYPE",
                    "message": message_type,
                    "requestId": message.get("id"),
                },
                message.get("id"),
            )

    async def handle_auth(
        self, websocket: WebSocketServerProtocol, message: dict[str, Any]
    ) -> None:
        # A WebSocket is permanently bound to the account from its first
        # successful authentication.  Re-authentication on the same socket
        # could otherwise race a snapshot already captured for the old
        # account with attachment to a newly validated account.  Require a
        # fresh WebSocket instead, and do not validate or attach anything.
        existing_session = self.sessions.get(websocket)
        if existing_session is not None:
            reason = (
                "session_expired"
                if existing_session.expires_at_ms <= now_ms()
                else "already_authenticated"
            )
            await self.reject_auth(websocket, message, reason)
            return
        payload = message.get("payload") or {}
        token = payload.get("token") if isinstance(payload, dict) else ""
        token = str(token or "").strip()
        validated: ValidatedTicket
        if self.ticket_validator is not None:
            try:
                validated = await asyncio.to_thread(
                    self.ticket_validator.validate, token
                )
            except TicketValidationError as exc:
                reason = str(exc) or "invalid_ticket"
                if reason == "invalid_response":
                    reason = "validation_unavailable"
                await self.reject_auth(websocket, message, reason)
                return
            except Exception:
                await self.reject_auth(websocket, message, "validation_unavailable")
                return
        else:
            if self.config.token and token != self.config.token:
                await self.reject_auth(websocket, message, "invalid_token")
                return
            validated = ValidatedTicket(
                login=self.config.login
                or ("FTMO-PY-DRY-RUN" if self.config.dry_run else ""),
                server=self.config.server
                or ("FTMO-DryRun" if self.config.dry_run else ""),
                expires_at_ms=now_ms() + 3_600_000,
            )
        attached_now = False
        reject_reason = ""
        session: AuthenticatedSession | None = None
        async with self.account_state_lock:
            # MetaTrader5 exposes one process-global terminal session. Keep the
            # first active account stable: a second account must wait until all
            # sessions for the first account disconnect. This prevents account
            # thrashing and cross-account snapshots between browser tabs.
            if self.active_account_conflicts(validated.login, validated.server):
                reject_reason = "account_mismatch"
            else:
                account_error = self.adapter.expected_account_error(
                    validated.login, validated.server
                )
                if self.config.attached_account and account_error is not None:
                    try:
                        # Synchronous on purpose: no snapshot or order task can
                        # observe a half-replaced native MT5 session.
                        self.adapter.connect(validated.login, validated.server)
                        attached_now = True
                    except Mt5AttachmentError as exc:
                        reject_reason = self.account_auth_reason(exc.code)
                    except Exception:
                        reject_reason = "account_unavailable"
                    if not reject_reason:
                        account_error = self.adapter.expected_account_error(
                            validated.login, validated.server
                        )
                if not reject_reason and account_error is not None:
                    code, _ = account_error
                    reject_reason = self.account_auth_reason(code)
                if not reject_reason:
                    session_id = f"ftmo_py_{uuid.uuid4().hex[:12]}"
                    session = AuthenticatedSession(
                        session_id=session_id,
                        expected_login=validated.login,
                        expected_server=validated.server,
                        expires_at_ms=validated.expires_at_ms,
                    )
                    self.sessions[websocket] = session
        if reject_reason:
            await self.reject_auth(websocket, message, reject_reason)
            return
        assert session is not None
        if attached_now:
            account = self.adapter.account_snapshot()
            print(
                "FTMO terminal connected: "
                f"login {account.get('accountId', 'unknown')} on "
                f"{account.get('server', 'unknown')}.",
                flush=True,
            )
            self.audit.append("terminal_attached")
        await self.send(
            websocket,
            "auth.ok",
            {"sessionId": session.session_id, "expiresAt": validated.expires_at_ms},
            message.get("id"),
        )
        self.audit.append(
            "auth_ok", {"requestId": message.get("id"), "sessionId": session.session_id}
        )
        await self.send_snapshots(websocket)

    async def reject_auth(
        self,
        websocket: WebSocketServerProtocol,
        message: dict[str, Any],
        reason: str,
    ) -> None:
        safe_reason = (
            reason
            if reason
            in {
                "invalid_ticket",
                "expired_ticket",
                "validation_unavailable",
                "account_unavailable",
                "account_mismatch",
                "trading_not_allowed",
                "session_expired",
                "already_authenticated",
            }
            else "invalid_token"
        )
        await self.send(
            websocket,
            "auth.reject",
            {"reason": safe_reason},
            message.get("id"),
        )
        self.audit.append(
            "auth_reject", {"requestId": message.get("id"), "reason": safe_reason}
        )
        try:
            await websocket.close(code=1008, reason="connector authentication rejected")
        except TypeError:  # Minimal test doubles may expose close() without arguments.
            await websocket.close()
        finally:
            # Keep an existing authenticated binding in place until the socket
            # has been closed.  Concurrent snapshot senders therefore cannot
            # observe an unauthenticated/re-authenticating gap on this object.
            self.sessions.pop(websocket, None)

    async def close_authenticated_session(
        self, websocket: WebSocketServerProtocol, reason: str
    ) -> None:
        await self.reject_auth(websocket, {"id": None}, reason)

    def session_expired(self, websocket: WebSocketServerProtocol) -> bool:
        session = self.sessions.get(websocket)
        return session is not None and session.expires_at_ms <= now_ms()

    def session_for(
        self, websocket: WebSocketServerProtocol
    ) -> AuthenticatedSession | None:
        session = self.sessions.get(websocket)
        if session is not None and session.expires_at_ms <= now_ms():
            return None
        return session

    def active_account_conflicts(self, login: str, server: str) -> bool:
        expected_login = str(login or "").strip()
        expected_server = str(server or "").strip().casefold()
        for client, session in list(self.sessions.items()):
            if session.expires_at_ms <= now_ms():
                self.sessions.pop(client, None)
                continue
            if (
                session.expected_login != expected_login
                or session.expected_server.strip().casefold() != expected_server
            ):
                return True
        return False

    @staticmethod
    def account_auth_reason(code: str) -> str:
        return {
            "MT5_ACCOUNT_UNAVAILABLE": "account_unavailable",
            "MT5_ACCOUNT_MISMATCH": "account_mismatch",
            "MT5_TRADING_NOT_ALLOWED": "trading_not_allowed",
            "AUTH_ACCOUNT_REQUIRED": "account_mismatch",
        }.get(code, "account_unavailable")

    async def handle_order_place(
        self,
        websocket: WebSocketServerProtocol,
        message: dict[str, Any],
        session: AuthenticatedSession,
    ) -> None:
        order = message.get("payload") or {}
        client_order_id = order.get("clientOrderId")
        order_key = (
            session.expected_login,
            session.expected_server.casefold(),
            str(client_order_id or ""),
        )
        self.audit.append(
            "order_request", {"requestId": message.get("id"), "order": order}
        )
        duplicate = self.seen_client_orders.get(order_key)
        if duplicate:
            await self.send(
                websocket,
                duplicate["type"],
                {**duplicate["payload"], "requestId": message.get("id")},
                message.get("id"),
            )
            execution = duplicate.get("execution")
            if isinstance(execution, dict):
                await self.send(
                    websocket,
                    "execution.report",
                    {**execution, "requestId": message.get("id")},
                    message.get("id"),
                )
            return

        meta = self.symbol_meta(order.get("chartSymbol", ""))
        account = self.account_snapshot()
        risk_context = self.risk_context(account)
        open_risk = self.open_risk_at_stops()
        valid, code, detail, snapshot, volume = self.risk.validate_order(
            order,
            meta,
            risk_context.equity,
            open_risk,
            self.readiness()["ready"],
            account_key=risk_context.account_key,
            balance=risk_context.balance,
            initial_balance=risk_context.initial_balance,
        )
        if not valid:
            await self.reject_order(
                websocket,
                message,
                code,
                detail,
                client_order_id,
                snapshot,
                dedupe_key=order_key,
            )
            return

        ack = {
            "requestId": message.get("id"),
            "clientOrderId": client_order_id,
            "acceptedAt": now_ms(),
            "dryRun": self.config.dry_run,
            "normalizedVolume": volume,
        }
        self.remember_client_order(
            order_key, {"type": "order.ack", "payload": ack}
        )
        await self.send(websocket, "order.ack", ack, message.get("id"))

        if self.config.dry_run:
            self.risk.mark_order(
                risk_context.account_key,
                balance=risk_context.balance,
                equity=risk_context.equity,
                initial_balance=risk_context.initial_balance,
            )
            await asyncio.sleep(0.2)
            execution = self.simulate_fill(order, meta, volume, message.get("id"))
            self.seen_client_orders[order_key]["execution"] = execution
            await self.broadcast("execution.report", execution)
            await self.broadcast(
                "positions.update",
                {
                    "action": "upsert",
                    "position": self.dry_run_positions[execution["ticket"]],
                },
            )
            await self.broadcast("account.snapshot", self.account_snapshot())
            await self.broadcast("risk.snapshot", self.risk_snapshot())
            self.audit.append("execution_report", {"execution": execution})
            return

        success, result = self.adapter.place_order(
            order,
            volume,
            expected_login=session.expected_login,
            expected_server=session.expected_server,
        )
        if not success:
            await self.reject_order(
                websocket,
                message,
                result.get("code", "MT5_REJECT"),
                result.get("message", "MT5 rejected order"),
                client_order_id,
                snapshot,
                dedupe_key=order_key,
            )
            return
        self.risk.mark_order(
            risk_context.account_key,
            balance=risk_context.balance,
            equity=risk_context.equity,
            initial_balance=risk_context.initial_balance,
        )
        execution = {
            "requestId": message.get("id"),
            "clientOrderId": client_order_id,
            "ticket": result.get("ticket"),
            "dealId": result.get("dealId"),
            "symbol": order.get("chartSymbol"),
            "brokerSymbol": meta.broker_symbol if meta else order.get("brokerSymbol"),
            "status": "filled",
            "side": order.get("side"),
            "volume": result.get("volume", volume),
            "price": result.get("price"),
            "executedAt": now_ms(),
        }
        self.seen_client_orders[order_key]["execution"] = execution
        await self.broadcast("execution.report", execution)
        await self.broadcast_snapshots()
        self.audit.append("execution_report", {"execution": execution, "mt5": result})

    async def handle_order_close(
        self,
        websocket: WebSocketServerProtocol,
        message: dict[str, Any],
        session: AuthenticatedSession,
    ) -> None:
        req = message.get("payload") or {}
        await self.ack(websocket, message, req.get("clientOrderId"))
        if self.config.dry_run:
            position = self.dry_run_positions.pop(str(req.get("ticket")), None)
            if position:
                await self.broadcast(
                    "execution.report",
                    {
                        "requestId": message.get("id"),
                        "clientOrderId": req.get("clientOrderId"),
                        "ticket": req.get("ticket"),
                        "symbol": position["symbol"],
                        "brokerSymbol": position["brokerSymbol"],
                        "status": "closed",
                        "volume": req.get("volume") or position["volume"],
                        "price": position["currentPrice"],
                        "dryRun": True,
                        "executedAt": now_ms(),
                    },
                )
                await self.broadcast(
                    "positions.update", {"action": "remove", "position": position}
                )
                await self.broadcast("account.snapshot", self.account_snapshot())
            return
        success, result = self.adapter.close_position(
            str(req.get("ticket")),
            req.get("volume"),
            req.get("deviationPoints"),
            expected_login=session.expected_login,
            expected_server=session.expected_server,
        )
        if not success:
            await self.reject_order(
                websocket,
                message,
                result.get("code", "MT5_REJECT"),
                result.get("message", "MT5 rejected close"),
                req.get("clientOrderId"),
            )
            return
        await self.broadcast(
            "execution.report",
            {
                "requestId": message.get("id"),
                "clientOrderId": req.get("clientOrderId"),
                "ticket": req.get("ticket"),
                "symbol": "UNKNOWN",
                "brokerSymbol": "UNKNOWN",
                "status": "closed",
                "price": result.get("price"),
                "executedAt": now_ms(),
            },
        )
        await self.broadcast_snapshots()

    async def handle_order_close_all(
        self,
        websocket: WebSocketServerProtocol,
        message: dict[str, Any],
        session: AuthenticatedSession,
    ) -> None:
        req = message.get("payload") or {}
        if not self.config.close_all_enabled:
            await self.reject_order(
                websocket,
                message,
                "CLOSE_ALL_DISABLED",
                "FTMO close-all is disabled",
                req.get("clientOrderId"),
            )
            return
        await self.ack(websocket, message, req.get("clientOrderId"))
        positions = (
            list(self.dry_run_positions.values())
            if self.config.dry_run
            else self.adapter.positions()
        )
        closed = 0
        for position in positions:
            if req.get("chartSymbol") and position["symbol"] != req.get("chartSymbol"):
                continue
            if self.config.dry_run:
                self.dry_run_positions.pop(position["ticket"], None)
                await self.broadcast(
                    "positions.update", {"action": "remove", "position": position}
                )
                closed += 1
            else:
                success, _ = self.adapter.close_position(
                    position["ticket"],
                    None,
                    req.get("deviationPoints"),
                    expected_login=session.expected_login,
                    expected_server=session.expected_server,
                )
                closed += 1 if success else 0
        await self.broadcast(
            "execution.report",
            {
                "requestId": message.get("id"),
                "clientOrderId": req.get("clientOrderId"),
                "symbol": req.get("chartSymbol") or "ALL",
                "brokerSymbol": req.get("brokerSymbol") or "ALL",
                "status": "closed",
                "volume": closed,
                "dryRun": self.config.dry_run,
                "executedAt": now_ms(),
            },
        )
        await self.broadcast_snapshots()

    async def handle_order_modify(
        self,
        websocket: WebSocketServerProtocol,
        message: dict[str, Any],
        session: AuthenticatedSession,
    ) -> None:
        req = message.get("payload") or {}
        await self.ack(websocket, message, req.get("clientOrderId"))
        if self.config.dry_run:
            position = self.dry_run_positions.get(str(req.get("ticket")))
            if position:
                position["sl"] = req.get("sl")
                position["tp"] = req.get("tp")
                position["updatedAt"] = now_ms()
                await self.broadcast(
                    "positions.update", {"action": "upsert", "position": position}
                )
            await self.broadcast(
                "execution.report",
                {
                    "requestId": message.get("id"),
                    "clientOrderId": req.get("clientOrderId"),
                    "ticket": req.get("ticket"),
                    "symbol": position.get("symbol", "UNKNOWN") if position else "UNKNOWN",
                    "brokerSymbol": position.get("brokerSymbol", "UNKNOWN") if position else "UNKNOWN",
                    "status": "modified",
                    "dryRun": True,
                    "executedAt": now_ms(),
                },
            )
            return
        success, result = self.adapter.modify_position(
            str(req.get("ticket")),
            req.get("sl"),
            req.get("tp"),
            expected_login=session.expected_login,
            expected_server=session.expected_server,
        )
        if not success:
            await self.reject_order(
                websocket,
                message,
                result.get("code", "MT5_REJECT"),
                result.get("message", "MT5 rejected modify"),
                req.get("clientOrderId"),
            )
            return
        await self.broadcast(
            "execution.report",
            {
                "requestId": message.get("id"),
                "clientOrderId": req.get("clientOrderId"),
                "ticket": req.get("ticket"),
                "symbol": "UNKNOWN",
                "brokerSymbol": "UNKNOWN",
                "status": "modified",
                "executedAt": now_ms(),
            },
        )
        await self.broadcast_snapshots()

    async def handle_order_cancel(
        self,
        websocket: WebSocketServerProtocol,
        message: dict[str, Any],
        session: AuthenticatedSession,
    ) -> None:
        req = message.get("payload") or {}
        await self.ack(websocket, message, req.get("clientOrderId"))
        if not self.config.dry_run:
            success, result = self.adapter.cancel_order(
                str(req.get("ticket")),
                expected_login=session.expected_login,
                expected_server=session.expected_server,
            )
            if not success:
                await self.reject_order(
                    websocket,
                    message,
                    result.get("code", "MT5_REJECT"),
                    result.get("message", "MT5 rejected cancel"),
                    req.get("clientOrderId"),
                )
                return
        await self.broadcast(
            "execution.report",
            {
                "requestId": message.get("id"),
                "clientOrderId": req.get("clientOrderId"),
                "ticket": req.get("ticket"),
                "symbol": "UNKNOWN",
                "brokerSymbol": "UNKNOWN",
                "status": "cancelled",
                "dryRun": self.config.dry_run,
                "executedAt": now_ms(),
            },
        )
        await self.broadcast_snapshots()

    def readiness(self) -> dict[str, Any]:
        checks = self.adapter.readiness_checks(self.audit.writable)
        return {
            "ready": all(check["ok"] for check in checks),
            "dryRun": self.config.dry_run,
            "login": self.config.login or None,
            "server": self.config.server or None,
            "accountMode": "demo" if self.config.dry_run else "unknown",
            "checks": checks,
            "updatedAt": now_ms(),
        }

    def account_snapshot(self) -> dict[str, Any]:
        account = self.adapter.account_snapshot()
        if self.config.dry_run:
            floating = sum(
                float(position.get("profit", 0) or 0)
                for position in self.dry_run_positions.values()
            )
            account["equity"] = float(account["balance"]) + floating
            account["freeMargin"] = account["equity"]
        account["tradeAllowed"] = self.readiness()["ready"]
        return account

    def risk_context(
        self, account: dict[str, Any] | None = None
    ) -> RiskContext:
        if account is None:
            account = self.account_snapshot()
        login = str(account.get("accountId") or self.config.login or "UNKNOWN").strip()
        server = str(account.get("server") or self.config.server or "UNKNOWN").strip()
        balance = float(account.get("balance", 0) or 0)
        equity = float(account.get("equity", balance) or balance)
        initial_balance_method = getattr(
            self.adapter, "initial_balance_from_history", None
        )
        initial_balance = (
            initial_balance_method() if callable(initial_balance_method) else None
        )
        return RiskContext(
            account_key=f"{login}|{server.casefold()}",
            balance=balance,
            equity=equity,
            initial_balance=initial_balance,
        )

    def risk_snapshot(
        self,
        *,
        account: dict[str, Any] | None = None,
        positions: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        if account is None:
            account = self.account_snapshot()
        context = self.risk_context(account)
        return self.risk.snapshot(
            context.equity,
            self.open_risk_at_stops(positions),
            0,
            self.readiness()["ready"],
            account_key=context.account_key,
            balance=context.balance,
            initial_balance=context.initial_balance,
        )

    def account_equity(self) -> float:
        return float(
            self.account_snapshot().get("equity", self.config.account_size)
            or self.config.account_size
        )

    def open_risk_at_stops(
        self, positions: list[dict[str, Any]] | None = None
    ) -> float:
        total = 0.0
        for position in positions if positions is not None else self.positions_snapshot():
            total += self.risk.estimate_position_risk(
                position, self.symbol_meta(position["symbol"])
            )
        return total

    def symbol_meta(self, chart_symbol: str) -> SymbolMeta | None:
        if not chart_symbol:
            return None
        return self.adapter.symbol_meta(chart_symbol)

    def log_symbol_caps_once(self, meta: SymbolMeta) -> None:
        key = f"{meta.chart_symbol}:{meta.broker_symbol}"
        if key in self.logged_symbol_caps:
            return
        self.logged_symbol_caps.add(key)
        public_max_lot = min(meta.max_lot, self.config.max_order_volume)
        cap = "broker" if meta.max_lot <= self.config.max_order_volume else "bridge"
        print(
            "[ftmo-mt5-python] "
            f"symbol {meta.chart_symbol}->{meta.broker_symbol} "
            f"minLot={meta.min_lot:.4f} brokerMaxLot={meta.max_lot:.4f} "
            f"bridgeMaxLot={self.config.max_order_volume:.4f} publicMaxLot={public_max_lot:.4f} "
            f"lotStep={meta.lot_step:.4f} tickSize={meta.tick_size:g} tickValue={meta.tick_value:g} "
            f"stopLevel={meta.stop_level} minStopDistance={meta.stop_level * meta.point:g} "
            f"cap={cap}",
        )

    def positions_snapshot(self) -> list[dict[str, Any]]:
        if self.config.dry_run:
            return list(self.dry_run_positions.values())
        return self.adapter.positions()

    def orders_snapshot(self) -> list[dict[str, Any]]:
        if self.config.dry_run:
            return []
        return self.adapter.orders()

    def simulate_fill(
        self,
        order: dict[str, Any],
        meta: SymbolMeta | None,
        volume: float,
        request_id: str | None,
    ) -> dict[str, Any]:
        self.ticket_sequence += 1
        ticket = str(self.ticket_sequence)
        price = float(order.get("price") or 0)
        if price <= 0:
            price = 1.1
        position = {
            "ticket": ticket,
            "symbol": order.get("chartSymbol"),
            "brokerSymbol": meta.broker_symbol if meta else order.get("brokerSymbol"),
            "side": "long" if order.get("side") == "buy" else "short",
            "volume": volume,
            "openPrice": price,
            "currentPrice": price,
            "sl": order.get("sl"),
            "tp": order.get("tp"),
            "profit": 0,
            "comment": order.get("comment") or "ftmo python dry-run",
            "openedAt": now_ms(),
            "updatedAt": now_ms(),
        }
        self.dry_run_positions[ticket] = position
        return {
            "requestId": request_id,
            "clientOrderId": order.get("clientOrderId"),
            "ticket": ticket,
            "symbol": order.get("chartSymbol"),
            "brokerSymbol": position["brokerSymbol"],
            "status": "filled",
            "side": order.get("side"),
            "volume": volume,
            "price": price,
            "dryRun": True,
            "executedAt": now_ms(),
        }

    def snapshot_bundle(
        self, *, include_symbols: bool
    ) -> tuple[tuple[str, str], list[tuple[str, dict[str, Any]]]]:
        account = self.account_snapshot()
        positions = self.positions_snapshot()
        orders = self.orders_snapshot()
        identity = (
            str(account.get("accountId") or "").strip(),
            str(account.get("server") or "").strip().casefold(),
        )
        bundle: list[tuple[str, dict[str, Any]]] = [
            ("ftmo.readiness", self.readiness()),
            ("risk.snapshot", self.risk_snapshot(account=account, positions=positions)),
            ("account.snapshot", account),
            ("positions.snapshot", {"positions": positions}),
            ("orders.snapshot", {"orders": orders}),
        ]
        if include_symbols:
            for chart_symbol in self.config.symbols:
                meta = self.symbol_meta(chart_symbol)
                if meta is not None:
                    self.log_symbol_caps_once(meta)
                    bundle.append(
                        (
                            "symbol.info",
                            public_symbol_info(meta, self.config.max_order_volume),
                        )
                    )
        return identity, bundle

    async def send_snapshots(self, websocket: WebSocketServerProtocol) -> None:
        account_error: tuple[str, str] | None = None
        bundle: list[tuple[str, dict[str, Any]]] = []
        async with self.account_state_lock:
            session = self.session_for(websocket)
            if session is None:
                return
            account_error = self.adapter.expected_account_error(
                session.expected_login, session.expected_server
            )
            if account_error is None:
                _, bundle = self.snapshot_bundle(include_symbols=True)
        if account_error is not None:
            await self.close_authenticated_session(
                websocket, self.account_auth_reason(account_error[0])
            )
            return
        for message_type, payload in bundle:
            await self.send(websocket, message_type, payload)

    async def broadcast_snapshots(self) -> None:
        async with self.account_state_lock:
            identity, bundle = self.snapshot_bundle(include_symbols=False)
            recipients = [
                client
                for client in list(self.clients)
                if (
                    (session := self.session_for(client)) is not None
                    and session.expected_login == identity[0]
                    and session.expected_server.strip().casefold() == identity[1]
                )
            ]
        if not recipients:
            return
        for message_type, payload in bundle:
            message = json.dumps(envelope(message_type, payload), separators=(",", ":"))
            await asyncio.gather(
                *(client.send(message) for client in recipients),
                return_exceptions=True,
            )

    async def ack(
        self,
        websocket: WebSocketServerProtocol,
        message: dict[str, Any],
        client_order_id: str | None,
    ) -> None:
        await self.send(
            websocket,
            "order.ack",
            {
                "requestId": message.get("id"),
                "clientOrderId": client_order_id,
                "acceptedAt": now_ms(),
                "dryRun": self.config.dry_run,
            },
            message.get("id"),
        )

    async def reject_order(
        self,
        websocket: WebSocketServerProtocol,
        message: dict[str, Any],
        code: str,
        detail: str,
        client_order_id: str | None,
        snapshot: dict[str, Any] | None = None,
        dedupe_key: tuple[str, str, str] | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "requestId": message.get("id"),
            "clientOrderId": client_order_id,
            "code": code,
            "message": detail,
        }
        account_boundary_codes = {
            "AUTH_ACCOUNT_REQUIRED",
            "MT5_ACCOUNT_UNAVAILABLE",
            "MT5_ACCOUNT_MISMATCH",
            "MT5_TRADING_NOT_ALLOWED",
        }
        if snapshot is not None:
            payload["snapshot"] = snapshot
        elif code not in account_boundary_codes:
            payload["snapshot"] = self.risk_snapshot()
        if client_order_id and dedupe_key is not None:
            self.remember_client_order(
                dedupe_key,
                {"type": "order.reject", "payload": payload},
            )
        self.audit.append("order_reject", payload)
        await self.send(websocket, "order.reject", payload, message.get("id"))

    def remember_client_order(
        self, key: tuple[str, str, str], value: dict[str, Any]
    ) -> None:
        self.seen_client_orders[key] = value
        while len(self.seen_client_orders) > 5_000:
            del self.seen_client_orders[next(iter(self.seen_client_orders))]

    async def send(
        self,
        websocket: WebSocketServerProtocol,
        message_type: str,
        payload: dict[str, Any],
        request_id: str | None = None,
    ) -> None:
        await websocket.send(
            json.dumps(
                envelope(message_type, payload, request_id), separators=(",", ":")
            )
        )

    async def broadcast(self, message_type: str, payload: dict[str, Any]) -> None:
        authenticated_clients: list[WebSocketServerProtocol] = []
        for client in list(self.clients):
            session = self.session_for(client)
            if session is None:
                continue
            account_error = self.adapter.expected_account_error(
                session.expected_login, session.expected_server
            )
            if account_error is None:
                authenticated_clients.append(client)
        if not authenticated_clients:
            return
        message = json.dumps(envelope(message_type, payload), separators=(",", ":"))
        await asyncio.gather(
            *(client.send(message) for client in authenticated_clients),
            return_exceptions=True,
        )


async def main() -> None:
    config = load_config()
    service = FtmoMt5Service(config)
    loop = asyncio.get_running_loop()
    stop = loop.create_future()
    for signame in ("SIGINT", "SIGTERM"):
        try:
            loop.add_signal_handler(getattr(signal, signame), stop.set_result, None)
        except NotImplementedError:
            pass
    task = asyncio.create_task(service.start())
    await stop
    task.cancel()
    service.adapter.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
