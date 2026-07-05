from __future__ import annotations

from typing import Any

from .config import BridgeConfig
from .protocol import now_ms
from .symbols import SymbolMeta, fallback_symbol_meta, meta_from_mt5_info


class Mt5ImportError(RuntimeError):
    pass


class Mt5Adapter:
    def __init__(self, config: BridgeConfig) -> None:
        self.config = config
        self.mt5: Any | None = None
        self.initialized = False

    def connect(self) -> None:
        if self.config.dry_run:
            return
        if not self.config.allow_live:
            raise RuntimeError(
                "FTMO_BRIDGE_ALLOW_LIVE must be true before live MT5 adapter connects"
            )
        try:
            import MetaTrader5 as mt5  # type: ignore[import-not-found]
        except ImportError as exc:
            raise Mt5ImportError(
                "Install bridge/ftmo_mt5/requirements.txt from the backend directory on Windows with MT5 installed"
            ) from exc

        kwargs: dict[str, Any] = {}
        if self.config.terminal_path:
            kwargs["path"] = self.config.terminal_path
        if not mt5.initialize(**kwargs):
            raise RuntimeError(f"mt5.initialize failed: {mt5.last_error()}")

        self.mt5 = mt5
        self.initialized = True

        if self.config.login:
            login = int(self.config.login)
            if not mt5.login(
                login, password=self.config.password, server=self.config.server
            ):
                last_error = mt5.last_error()
                mt5.shutdown()
                self.initialized = False
                raise RuntimeError(f"mt5.login failed: {last_error}")

    def shutdown(self) -> None:
        if self.mt5 is not None and self.initialized:
            self.mt5.shutdown()
        self.initialized = False

    def readiness_checks(self, audit_writable: bool) -> list[dict[str, Any]]:
        checks = [
            {
                "name": "bridge_enabled",
                "ok": self.config.enabled,
                "detail": "FTMO_MT5_ENABLED=true"
                if self.config.enabled
                else "Set FTMO_MT5_ENABLED=true",
            },
            {
                "name": "audit_log",
                "ok": audit_writable,
                "detail": "Audit log writable"
                if audit_writable
                else "Audit log is not writable",
            },
            {
                "name": "dry_run_default",
                "ok": self.config.dry_run or self.config.allow_live,
                "detail": "Dry-run mode is active"
                if self.config.dry_run
                else "Live mode explicitly enabled",
            },
        ]
        if self.config.dry_run:
            checks.extend(
                [
                    {
                        "name": "mt5_import",
                        "ok": True,
                        "detail": "Not required for dry-run",
                    },
                    {
                        "name": "mt5_terminal",
                        "ok": True,
                        "detail": "Not required for dry-run",
                    },
                    {
                        "name": "mt5_login",
                        "ok": True,
                        "detail": "Not required for dry-run",
                    },
                ],
            )
            return checks

        checks.extend(
            [
                {
                    "name": "live_allowed",
                    "ok": self.config.allow_live,
                    "detail": "FTMO_BRIDGE_ALLOW_LIVE=true required",
                },
                {
                    "name": "mt5_login",
                    "ok": bool(self.config.login),
                    "detail": "FTMO_MT5_LOGIN must match FTMO credentials",
                },
                {
                    "name": "mt5_master_password",
                    "ok": bool(self.config.password),
                    "detail": "Master password is required for trading",
                },
                {
                    "name": "mt5_server",
                    "ok": bool(self.config.server),
                    "detail": "FTMO_MT5_SERVER must match Client Area",
                },
                {
                    "name": "mt5_initialized",
                    "ok": self.initialized,
                    "detail": "MetaTrader5 session initialized"
                    if self.initialized
                    else "MetaTrader5 session not initialized",
                },
            ],
        )

        account = self.account_info_raw()
        if account is not None:
            checks.append(
                {
                    "name": "account_login_match",
                    "ok": not self.config.login
                    or str(getattr(account, "login", "")) == self.config.login,
                    "detail": f"Connected login {getattr(account, 'login', '')}",
                },
            )
            checks.append(
                {
                    "name": "account_trade_allowed",
                    "ok": bool(getattr(account, "trade_allowed", False)),
                    "detail": "Account trade_allowed flag from MT5",
                },
            )
        else:
            checks.append(
                {
                    "name": "account_info",
                    "ok": False,
                    "detail": "MT5 account_info unavailable",
                }
            )
        return checks

    def account_info_raw(self) -> Any | None:
        if self.config.dry_run or self.mt5 is None or not self.initialized:
            return None
        return self.mt5.account_info()

    def account_snapshot(self) -> dict[str, Any]:
        if self.config.dry_run:
            return {
                "accountId": self.config.login or "FTMO-PY-DRY-RUN",
                "broker": "FTMO MT5",
                "server": self.config.server or "FTMO-DryRun",
                "mode": "demo",
                "currency": "USD",
                "balance": self.config.account_size,
                "equity": self.config.account_size,
                "margin": 0,
                "freeMargin": self.config.account_size,
                "marginLevel": 0,
                "leverage": 100,
                "tradeAllowed": True,
                "updatedAt": now_ms(),
            }
        account = self.account_info_raw()
        if account is None:
            return {
                "accountId": self.config.login or "UNKNOWN",
                "broker": "FTMO MT5",
                "server": self.config.server or "UNKNOWN",
                "mode": "unknown",
                "currency": "USD",
                "balance": 0,
                "equity": 0,
                "margin": 0,
                "freeMargin": 0,
                "marginLevel": 0,
                "leverage": 0,
                "tradeAllowed": False,
                "updatedAt": now_ms(),
            }
        return {
            "accountId": str(getattr(account, "login", self.config.login)),
            "broker": "FTMO MT5",
            "server": getattr(account, "server", self.config.server),
            "mode": "demo"
            if not bool(getattr(account, "trade_mode", 0))
            else "unknown",
            "currency": getattr(account, "currency", "USD"),
            "balance": float(getattr(account, "balance", 0) or 0),
            "equity": float(getattr(account, "equity", 0) or 0),
            "margin": float(getattr(account, "margin", 0) or 0),
            "freeMargin": float(getattr(account, "margin_free", 0) or 0),
            "marginLevel": float(getattr(account, "margin_level", 0) or 0),
            "leverage": int(getattr(account, "leverage", 0) or 0),
            "tradeAllowed": bool(getattr(account, "trade_allowed", False)),
            "updatedAt": now_ms(),
        }

    def symbol_meta(self, chart_symbol: str) -> SymbolMeta | None:
        broker_symbol = self.config.symbols.get(chart_symbol)
        if not broker_symbol:
            return None
        if self.config.dry_run or self.mt5 is None or not self.initialized:
            return fallback_symbol_meta(chart_symbol, broker_symbol)
        if not self.mt5.symbol_select(broker_symbol, True):
            return None
        info = self.mt5.symbol_info(broker_symbol)
        if info is None:
            return None
        return meta_from_mt5_info(chart_symbol, broker_symbol, info)

    def positions(self) -> list[dict[str, Any]]:
        if self.config.dry_run or self.mt5 is None or not self.initialized:
            return []
        rows = self.mt5.positions_get() or []
        result: list[dict[str, Any]] = []
        for row in rows:
            chart_symbol = self.chart_symbol_for(getattr(row, "symbol", ""))
            result.append(
                {
                    "ticket": str(getattr(row, "ticket", "")),
                    "symbol": chart_symbol,
                    "brokerSymbol": getattr(row, "symbol", ""),
                    "side": "long"
                    if int(getattr(row, "type", 0) or 0) == self.mt5.POSITION_TYPE_BUY
                    else "short",
                    "volume": float(getattr(row, "volume", 0) or 0),
                    "openPrice": float(getattr(row, "price_open", 0) or 0),
                    "currentPrice": float(getattr(row, "price_current", 0) or 0),
                    "sl": _optional_float(getattr(row, "sl", None)),
                    "tp": _optional_float(getattr(row, "tp", None)),
                    "profit": float(getattr(row, "profit", 0) or 0),
                    "swap": float(getattr(row, "swap", 0) or 0),
                    "commission": float(getattr(row, "commission", 0) or 0),
                    "magic": int(getattr(row, "magic", 0) or 0),
                    "comment": getattr(row, "comment", ""),
                    "openedAt": int(getattr(row, "time", 0) or 0) * 1000,
                    "updatedAt": now_ms(),
                },
            )
        return result

    def orders(self) -> list[dict[str, Any]]:
        if self.config.dry_run or self.mt5 is None or not self.initialized:
            return []
        rows = self.mt5.orders_get() or []
        result: list[dict[str, Any]] = []
        for row in rows:
            chart_symbol = self.chart_symbol_for(getattr(row, "symbol", ""))
            result.append(
                {
                    "ticket": str(getattr(row, "ticket", "")),
                    "symbol": chart_symbol,
                    "brokerSymbol": getattr(row, "symbol", ""),
                    "side": "buy"
                    if int(getattr(row, "type", 0) or 0)
                    in {self.mt5.ORDER_TYPE_BUY_LIMIT, self.mt5.ORDER_TYPE_BUY_STOP}
                    else "sell",
                    "type": "limit"
                    if int(getattr(row, "type", 0) or 0)
                    in {self.mt5.ORDER_TYPE_BUY_LIMIT, self.mt5.ORDER_TYPE_SELL_LIMIT}
                    else "stop",
                    "volume": float(getattr(row, "volume_current", 0) or 0),
                    "price": float(getattr(row, "price_open", 0) or 0),
                    "sl": _optional_float(getattr(row, "sl", None)),
                    "tp": _optional_float(getattr(row, "tp", None)),
                    "createdAt": int(getattr(row, "time_setup", 0) or 0) * 1000,
                    "updatedAt": now_ms(),
                },
            )
        return result

    def place_order(
        self, order: dict[str, Any], volume: float
    ) -> tuple[bool, dict[str, Any]]:
        if self.mt5 is None or not self.initialized:
            return False, {
                "code": "MT5_NOT_INITIALIZED",
                "message": "MT5 session is not initialized",
            }
        meta = self.symbol_meta(order["chartSymbol"])
        if meta is None:
            return False, {
                "code": "UNKNOWN_SYMBOL",
                "message": f"No MT5 symbol for {order['chartSymbol']}",
            }
        try:
            request = self._build_order_request(order, meta, volume)
        except RuntimeError as exc:
            return False, {"code": "ORDER_REQUEST_BUILD_FAILED", "message": str(exc)}
        check = self.mt5.order_check(request)
        if check is None:
            return False, {
                "code": "ORDER_CHECK_FAILED",
                "message": str(self.mt5.last_error()),
                "request": request,
            }
        if not self._success_retcode(
            int(getattr(check, "retcode", 0) or 0), allow_zero=True
        ):
            return False, {
                "code": "ORDER_CHECK_REJECTED",
                "message": getattr(check, "comment", "MT5 order_check rejected"),
                "retcode": int(getattr(check, "retcode", 0) or 0),
                "request": request,
                "check": _as_dict(check),
            }
        result = self.mt5.order_send(request)
        if result is None:
            return False, {
                "code": "ORDER_SEND_FAILED",
                "message": str(self.mt5.last_error()),
                "request": request,
            }
        retcode = int(getattr(result, "retcode", 0) or 0)
        if not self._success_retcode(retcode):
            return False, {
                "code": "ORDER_SEND_REJECTED",
                "message": getattr(result, "comment", "MT5 order_send rejected"),
                "retcode": retcode,
                "request": request,
                "result": _as_dict(result),
            }
        return True, {
            "ticket": str(getattr(result, "order", "") or getattr(result, "deal", "")),
            "dealId": str(getattr(result, "deal", "")),
            "price": float(getattr(result, "price", 0) or request.get("price", 0)),
            "volume": float(getattr(result, "volume", 0) or volume),
            "request": request,
            "result": _as_dict(result),
        }

    def close_position(
        self,
        ticket: str,
        volume: float | None = None,
        deviation_points: int | None = None,
    ) -> tuple[bool, dict[str, Any]]:
        if self.mt5 is None or not self.initialized:
            return False, {
                "code": "MT5_NOT_INITIALIZED",
                "message": "MT5 session is not initialized",
            }
        rows = self.mt5.positions_get(ticket=int(ticket)) or []
        if not rows:
            return False, {
                "code": "POSITION_NOT_FOUND",
                "message": f"Position {ticket} not found",
            }
        position = rows[0]
        symbol = getattr(position, "symbol", "")
        tick = self.mt5.symbol_info_tick(symbol)
        side = int(getattr(position, "type", 0) or 0)
        close_type = (
            self.mt5.ORDER_TYPE_SELL
            if side == self.mt5.POSITION_TYPE_BUY
            else self.mt5.ORDER_TYPE_BUY
        )
        price = float(
            getattr(tick, "bid" if close_type == self.mt5.ORDER_TYPE_SELL else "ask", 0)
            or 0
        )
        request = {
            "action": self.mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": float(volume or getattr(position, "volume", 0) or 0),
            "type": close_type,
            "position": int(ticket),
            "price": price,
            "deviation": int(deviation_points or self.config.deviation_points),
            "magic": self.config.magic,
            "comment": f"{self.config.comment_prefix}:close",
            "type_time": self.mt5.ORDER_TIME_GTC,
            "type_filling": self.mt5.ORDER_FILLING_IOC,
        }
        result = self.mt5.order_send(request)
        if result is None:
            return False, {
                "code": "ORDER_SEND_FAILED",
                "message": str(self.mt5.last_error()),
                "request": request,
            }
        retcode = int(getattr(result, "retcode", 0) or 0)
        if not self._success_retcode(retcode):
            return False, {
                "code": "ORDER_SEND_REJECTED",
                "message": getattr(result, "comment", ""),
                "retcode": retcode,
                "request": request,
                "result": _as_dict(result),
            }
        return True, {
            "ticket": ticket,
            "price": float(getattr(result, "price", price) or price),
            "result": _as_dict(result),
        }

    def modify_position(
        self, ticket: str, sl: float | None, tp: float | None
    ) -> tuple[bool, dict[str, Any]]:
        if self.mt5 is None or not self.initialized:
            return False, {
                "code": "MT5_NOT_INITIALIZED",
                "message": "MT5 session is not initialized",
            }
        rows = self.mt5.positions_get(ticket=int(ticket)) or []
        if not rows:
            return False, {
                "code": "POSITION_NOT_FOUND",
                "message": f"Position {ticket} not found",
            }
        position = rows[0]
        request = {
            "action": self.mt5.TRADE_ACTION_SLTP,
            "position": int(ticket),
            "symbol": getattr(position, "symbol", ""),
            "sl": float(sl or 0),
            "tp": float(tp or 0),
            "magic": self.config.magic,
            "comment": f"{self.config.comment_prefix}:modify",
        }
        result = self.mt5.order_send(request)
        if result is None:
            return False, {
                "code": "ORDER_SEND_FAILED",
                "message": str(self.mt5.last_error()),
                "request": request,
            }
        retcode = int(getattr(result, "retcode", 0) or 0)
        if not self._success_retcode(retcode):
            return False, {
                "code": "ORDER_SEND_REJECTED",
                "message": getattr(result, "comment", ""),
                "retcode": retcode,
                "request": request,
                "result": _as_dict(result),
            }
        return True, {"ticket": ticket, "result": _as_dict(result)}

    def cancel_order(self, ticket: str) -> tuple[bool, dict[str, Any]]:
        if self.mt5 is None or not self.initialized:
            return False, {
                "code": "MT5_NOT_INITIALIZED",
                "message": "MT5 session is not initialized",
            }
        request = {
            "action": self.mt5.TRADE_ACTION_REMOVE,
            "order": int(ticket),
            "magic": self.config.magic,
        }
        result = self.mt5.order_send(request)
        if result is None:
            return False, {
                "code": "ORDER_SEND_FAILED",
                "message": str(self.mt5.last_error()),
                "request": request,
            }
        retcode = int(getattr(result, "retcode", 0) or 0)
        if not self._success_retcode(retcode):
            return False, {
                "code": "ORDER_SEND_REJECTED",
                "message": getattr(result, "comment", ""),
                "retcode": retcode,
                "request": request,
                "result": _as_dict(result),
            }
        return True, {"ticket": ticket, "result": _as_dict(result)}

    def chart_symbol_for(self, broker_symbol: str) -> str:
        for chart_symbol, configured_broker_symbol in self.config.symbols.items():
            if configured_broker_symbol == broker_symbol:
                return chart_symbol
        return broker_symbol

    def _success_retcode(self, retcode: int, allow_zero: bool = False) -> bool:
        assert self.mt5 is not None
        if allow_zero and retcode == 0:
            return True
        success_codes = {
            getattr(self.mt5, "TRADE_RETCODE_DONE", 10009),
            getattr(self.mt5, "TRADE_RETCODE_PLACED", 10008),
            getattr(self.mt5, "TRADE_RETCODE_DONE_PARTIAL", 10010),
        }
        return retcode in success_codes

    def _build_order_request(
        self, order: dict[str, Any], meta: SymbolMeta, volume: float
    ) -> dict[str, Any]:
        assert self.mt5 is not None
        order_type = order.get("type")
        side = order.get("side")
        tick = self.mt5.symbol_info_tick(meta.broker_symbol)
        if tick is None:
            raise RuntimeError(f"No tick for {meta.broker_symbol}")
        is_buy = side == "buy"
        price = float(
            order.get("price")
            or (getattr(tick, "ask", 0) if is_buy else getattr(tick, "bid", 0))
        )
        if order_type == "market":
            mt5_type = self.mt5.ORDER_TYPE_BUY if is_buy else self.mt5.ORDER_TYPE_SELL
            action = self.mt5.TRADE_ACTION_DEAL
        elif order_type == "limit":
            mt5_type = (
                self.mt5.ORDER_TYPE_BUY_LIMIT
                if is_buy
                else self.mt5.ORDER_TYPE_SELL_LIMIT
            )
            action = self.mt5.TRADE_ACTION_PENDING
        else:
            mt5_type = (
                self.mt5.ORDER_TYPE_BUY_STOP
                if is_buy
                else self.mt5.ORDER_TYPE_SELL_STOP
            )
            action = self.mt5.TRADE_ACTION_PENDING
        request = {
            "action": action,
            "symbol": meta.broker_symbol,
            "volume": volume,
            "type": mt5_type,
            "price": price,
            "sl": float(order.get("sl") or 0),
            "tp": float(order.get("tp") or 0),
            "deviation": int(
                order.get("deviationPoints") or self.config.deviation_points
            ),
            "magic": self.config.magic,
            "comment": f"{self.config.comment_prefix}:{order.get('clientOrderId', '')}"[
                :31
            ],
            "type_time": self.mt5.ORDER_TIME_GTC,
            "type_filling": self.mt5.ORDER_FILLING_IOC,
        }
        self._validate_request_stops(request, meta, is_buy)
        return request

    def _validate_request_stops(
        self, request: dict[str, Any], meta: SymbolMeta, is_buy: bool
    ) -> None:
        price = float(request.get("price") or 0)
        sl = float(request.get("sl") or 0)
        tp = float(request.get("tp") or 0)
        min_distance = max(0.0, meta.stop_level * meta.point)
        side = "BUY" if is_buy else "SELL"
        if price <= 0:
            raise RuntimeError(f"Invalid entry price for {side} {meta.broker_symbol}")

        def too_close(distance: float) -> bool:
            return min_distance > 0 and distance < min_distance

        if is_buy:
            sl_invalid = sl > 0 and (price - sl <= 0 or too_close(price - sl))
            tp_invalid = tp > 0 and (tp - price <= 0 or too_close(tp - price))
            rule = "SL must be below entry and TP above entry"
        else:
            sl_invalid = sl > 0 and (sl - price <= 0 or too_close(sl - price))
            tp_invalid = tp > 0 and (price - tp <= 0 or too_close(price - tp))
            rule = "SL must be above entry and TP below entry"
        if sl_invalid or tp_invalid:
            raise RuntimeError(
                f"Invalid stops for {side} {meta.broker_symbol}: entry={price}, sl={sl or None}, "
                f"tp={tp or None}, minDistance={min_distance}. {rule}.",
            )


def _optional_float(value: Any) -> float | None:
    try:
        number = float(value)
        return number if number else None
    except (TypeError, ValueError):
        return None


def _as_dict(value: Any) -> dict[str, Any]:
    if hasattr(value, "_asdict"):
        return dict(value._asdict())
    if hasattr(value, "__dict__"):
        return dict(value.__dict__)
    return {"value": str(value)}
