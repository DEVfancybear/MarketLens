from __future__ import annotations

import asyncio
import json
import signal
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
from .mt5_adapter import Mt5Adapter
from .protocol import PROTOCOL_VERSION, envelope, now_ms, validate_envelope
from .risk_guard import RiskGuard
from .symbols import SymbolMeta, public_symbol_info

BRIDGE_VERSION = "0.1.0"


class FtmoMt5Service:
    def __init__(self, config: BridgeConfig) -> None:
        self.config = config
        self.audit = AuditLog(config.audit_path)
        self.adapter = Mt5Adapter(config)
        self.risk = RiskGuard(config)
        self.clients: set[WebSocketServerProtocol] = set()
        self.seen_client_orders: dict[str, dict[str, Any]] = {}
        self.dry_run_positions: dict[str, dict[str, Any]] = {}
        self.logged_symbol_caps: set[str] = set()
        self.ticket_sequence = 910000

    async def start(self) -> None:
        self.audit.open()
        if not self.config.dry_run:
            self.adapter.connect()
        async with websockets.serve(
            self.handle_client, self.config.host, self.config.port
        ):
            snapshot_task = asyncio.create_task(self.snapshot_poller())
            print(
                f"[ftmo-mt5-python] listening on ws://{self.config.host}:{self.config.port}"
            )
            print(
                f"[ftmo-mt5-python] enabled={self.config.enabled} "
                f"dryRun={self.config.dry_run} audit={self.config.audit_path}",
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

    async def handle_client(self, websocket: WebSocketServerProtocol) -> None:
        self.clients.add(websocket)
        await self.send(
            websocket,
            "hello",
            {
                "bridgeId": "ftmo-mt5-python-service",
                "bridgeVersion": BRIDGE_VERSION,
                "serverTime": now_ms(),
                "accountMode": "demo" if self.config.dry_run else "unknown",
                "dryRun": self.config.dry_run,
            },
        )
        heartbeat_task = asyncio.create_task(self.heartbeat(websocket))
        try:
            async for raw in websocket:
                await self.handle_message(websocket, raw)
        finally:
            heartbeat_task.cancel()
            self.clients.discard(websocket)

    async def heartbeat(self, websocket: WebSocketServerProtocol) -> None:
        while True:
            await asyncio.sleep(5)
            await self.send(websocket, "heartbeat", {"ts": now_ms()})
            await self.send(websocket, "ftmo.readiness", self.readiness())
            await self.send(websocket, "risk.snapshot", self.risk_snapshot())

    async def snapshot_poller(self) -> None:
        interval = max(250, self.config.snapshot_interval_ms) / 1000
        while True:
            await asyncio.sleep(interval)
            if not self.clients:
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
            await self.send(
                websocket,
                "error",
                {
                    "code": "UNSUPPORTED_VERSION",
                    "message": reason or "Invalid message",
                    "requestId": message.get("id"),
                },
                message.get("id"),
            )
            return
        message_type = message["type"]
        if message_type == "auth.request":
            await self.handle_auth(websocket, message)
        elif message_type == "heartbeat":
            await self.send(websocket, "heartbeat", {"ts": now_ms()})
        elif message_type == "order.place":
            await self.handle_order_place(websocket, message)
        elif message_type == "order.close":
            await self.handle_order_close(websocket, message)
        elif message_type == "order.closeAll":
            await self.handle_order_close_all(websocket, message)
        elif message_type == "order.modify":
            await self.handle_order_modify(websocket, message)
        elif message_type == "order.cancel":
            await self.handle_order_cancel(websocket, message)
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
        token = (message.get("payload") or {}).get("token") or ""
        if self.config.token and token != self.config.token:
            await self.send(
                websocket, "auth.reject", {"reason": "invalid_token"}, message.get("id")
            )
            self.audit.append("auth_reject", {"requestId": message.get("id")})
            return
        session_id = f"ftmo_py_{uuid.uuid4().hex[:12]}"
        await self.send(
            websocket,
            "auth.ok",
            {"sessionId": session_id, "expiresAt": now_ms() + 3600000},
            message.get("id"),
        )
        self.audit.append(
            "auth_ok", {"requestId": message.get("id"), "sessionId": session_id}
        )
        await self.send_snapshots(websocket)

    async def handle_order_place(
        self, websocket: WebSocketServerProtocol, message: dict[str, Any]
    ) -> None:
        order = message.get("payload") or {}
        client_order_id = order.get("clientOrderId")
        self.audit.append(
            "order_request", {"requestId": message.get("id"), "order": order}
        )
        duplicate = self.seen_client_orders.get(client_order_id)
        if duplicate:
            await self.send(
                websocket,
                duplicate["type"],
                {**duplicate["payload"], "requestId": message.get("id")},
                message.get("id"),
            )
            return

        meta = self.symbol_meta(order.get("chartSymbol", ""))
        equity = self.account_equity()
        open_risk = self.open_risk_at_stops()
        valid, code, detail, snapshot, volume = self.risk.validate_order(
            order, meta, equity, open_risk, self.readiness()["ready"]
        )
        if not valid:
            await self.reject_order(
                websocket, message, code, detail, client_order_id, snapshot
            )
            return

        ack = {
            "requestId": message.get("id"),
            "clientOrderId": client_order_id,
            "acceptedAt": now_ms(),
            "dryRun": self.config.dry_run,
            "normalizedVolume": volume,
        }
        self.seen_client_orders[client_order_id] = {"type": "order.ack", "payload": ack}
        await self.send(websocket, "order.ack", ack, message.get("id"))

        if self.config.dry_run:
            self.risk.mark_order()
            await asyncio.sleep(0.2)
            execution = self.simulate_fill(order, meta, volume, message.get("id"))
            self.seen_client_orders[client_order_id]["execution"] = execution
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

        success, result = self.adapter.place_order(order, volume)
        if not success:
            await self.reject_order(
                websocket,
                message,
                result.get("code", "MT5_REJECT"),
                result.get("message", "MT5 rejected order"),
                client_order_id,
                snapshot,
            )
            return
        self.risk.mark_order()
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
        self.seen_client_orders[client_order_id]["execution"] = execution
        await self.broadcast("execution.report", execution)
        await self.broadcast_snapshots()
        self.audit.append("execution_report", {"execution": execution, "mt5": result})

    async def handle_order_close(
        self, websocket: WebSocketServerProtocol, message: dict[str, Any]
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
            str(req.get("ticket")), req.get("volume"), req.get("deviationPoints")
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
        self, websocket: WebSocketServerProtocol, message: dict[str, Any]
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
                    position["ticket"], None, req.get("deviationPoints")
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
        self, websocket: WebSocketServerProtocol, message: dict[str, Any]
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
            return
        success, result = self.adapter.modify_position(
            str(req.get("ticket")), req.get("sl"), req.get("tp")
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
        await self.broadcast_snapshots()

    async def handle_order_cancel(
        self, websocket: WebSocketServerProtocol, message: dict[str, Any]
    ) -> None:
        req = message.get("payload") or {}
        await self.ack(websocket, message, req.get("clientOrderId"))
        if not self.config.dry_run:
            success, result = self.adapter.cancel_order(str(req.get("ticket")))
            if not success:
                await self.reject_order(
                    websocket,
                    message,
                    result.get("code", "MT5_REJECT"),
                    result.get("message", "MT5 rejected cancel"),
                    req.get("clientOrderId"),
                )
                return
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

    def risk_snapshot(self) -> dict[str, Any]:
        return self.risk.snapshot(
            self.account_equity(),
            self.open_risk_at_stops(),
            0,
            self.readiness()["ready"],
        )

    def account_equity(self) -> float:
        return float(
            self.account_snapshot().get("equity", self.config.account_size)
            or self.config.account_size
        )

    def open_risk_at_stops(self) -> float:
        total = 0.0
        for position in self.positions_snapshot():
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

    async def send_snapshots(self, websocket: WebSocketServerProtocol) -> None:
        await self.send(websocket, "ftmo.readiness", self.readiness())
        await self.send(websocket, "risk.snapshot", self.risk_snapshot())
        await self.send(websocket, "account.snapshot", self.account_snapshot())
        await self.send(
            websocket, "positions.snapshot", {"positions": self.positions_snapshot()}
        )
        await self.send(
            websocket, "orders.snapshot", {"orders": self.orders_snapshot()}
        )
        for chart_symbol in self.config.symbols:
            meta = self.symbol_meta(chart_symbol)
            if meta is not None:
                self.log_symbol_caps_once(meta)
                await self.send(
                    websocket,
                    "symbol.info",
                    public_symbol_info(meta, self.config.max_order_volume),
                )

    async def broadcast_snapshots(self) -> None:
        await self.broadcast("account.snapshot", self.account_snapshot())
        await self.broadcast(
            "positions.snapshot", {"positions": self.positions_snapshot()}
        )
        await self.broadcast("orders.snapshot", {"orders": self.orders_snapshot()})
        await self.broadcast("risk.snapshot", self.risk_snapshot())

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
    ) -> None:
        payload = {
            "requestId": message.get("id"),
            "clientOrderId": client_order_id,
            "code": code,
            "message": detail,
            "snapshot": snapshot or self.risk_snapshot(),
        }
        if client_order_id:
            self.seen_client_orders[client_order_id] = {
                "type": "order.reject",
                "payload": payload,
            }
        self.audit.append("order_reject", payload)
        await self.send(websocket, "order.reject", payload, message.get("id"))

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
        if not self.clients:
            return
        message = json.dumps(envelope(message_type, payload), separators=(",", ":"))
        await asyncio.gather(
            *(client.send(message) for client in list(self.clients)),
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
