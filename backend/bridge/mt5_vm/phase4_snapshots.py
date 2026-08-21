"""Phase 4a normalized read snapshots for the MT5 VM worker.

This module is deliberately separate from ``phase1_adapter`` so the Phase 1
bootstrap and authenticated-stdio surface stays untouched.

Two contracts are enforced here, both from the connector plan:

* MT5-native enums and object shapes stop inside this adapter. Callers receive
  stable lowercase names and plain dictionaries, never an MT5 named tuple.
* Decimal trading values leave as **strings** and broker tickets leave as
  **opaque strings**. Emitting a float for money would push binary floating
  point into the database and the API.

The collector is read-only. It never places, modifies or cancels anything, and
it never reads a credential.

The envelope's ``result`` is the mechanism behind invariant 8, "empty is not
unknown". ``complete`` is an assertion that the whole family was enumerated;
any failure downgrades the family to ``partial``/``failed`` so the backend keeps
what it already had instead of erasing a portfolio.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable

__all__ = [
    "COMPLETE",
    "FAILED",
    "PARTIAL",
    "collect_snapshots",
    "normalize_account",
    "normalize_instrument",
    "normalize_history_order",
    "normalize_deal",
    "normalize_pending_order",
    "normalize_position",
    "collect_history_page",
]

COMPLETE = "complete"
PARTIAL = "partial"
FAILED = "failed"
MAX_FAMILY_ROWS = 4_096

# MT5 exposes these as integer enums; the backend only ever sees these names.
_ACCOUNT_MODES = {0: "demo", 1: "contest", 2: "real"}
_MARGIN_MODES = {0: "netting", 1: "exchange", 2: "hedging"}
_POSITION_SIDES = {0: "buy", 1: "sell"}
_PENDING_ORDER_TYPES = {
    2: "buy_limit",
    3: "sell_limit",
    4: "buy_stop",
    5: "sell_stop",
    6: "buy_stop_limit",
    7: "sell_stop_limit",
}
_HISTORY_ORDER_TYPES = {
    0: "buy",
    1: "sell",
    2: "buy_limit",
    3: "sell_limit",
    4: "buy_stop",
    5: "sell_stop",
    6: "buy_stop_limit",
    7: "sell_stop_limit",
}
_HISTORY_ORDER_STATES = {
    0: "started",
    1: "placed",
    2: "canceled",
    3: "partial",
    4: "filled",
    5: "rejected",
    6: "expired",
    7: "request_added",
    8: "request_modified",
    9: "request_canceled",
}
_DEAL_TYPES = {
    0: "buy",
    1: "sell",
    2: "balance",
    3: "credit",
    4: "charge",
    5: "correction",
    6: "bonus",
    7: "commission",
    8: "commission_daily",
    9: "commission_monthly",
    10: "commission_agent_daily",
    11: "commission_agent_monthly",
    12: "interest",
    13: "buy_canceled",
    14: "sell_canceled",
    15: "dividend",
    16: "dividend_franked",
    17: "tax",
}
_DEAL_ENTRIES = {0: "in", 1: "out", 2: "inout", 3: "out_by"}
_SYMBOL_TRADE_MODES = {
    0: "disabled",
    1: "long_only",
    2: "short_only",
    3: "close_only",
    4: "full",
}
_TIME_IN_FORCE = {0: "gtc", 1: "day", 2: "specified", 3: "specified_day"}
# MT5 reports filling modes as a bit mask.
_FILLING_FLAGS = ((1, "fok"), (2, "ioc"), (4, "return"), (8, "boc"))


class SnapshotError(RuntimeError):
    """A family could not be enumerated. Carries a stable uppercase code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _decimal(value: Any) -> str | None:
    """Render a numeric MT5 field as a plain decimal string.

    Returns ``None`` for absent values. Rejects NaN and infinity rather than
    letting them reach a numeric column.
    """
    if value is None:
        return None
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise SnapshotError("MT5_DECIMAL_UNPARSABLE") from None
    if not parsed.is_finite():
        raise SnapshotError("MT5_DECIMAL_NOT_FINITE")
    # `f` never uses scientific notation, which the backend refuses.
    return format(parsed, "f")


def _required_decimal(value: Any, code: str) -> str:
    rendered = _decimal(value)
    if rendered is None:
        raise SnapshotError(code)
    return rendered


def _ticket(value: Any) -> str:
    """Broker tickets stay opaque strings; they are identifiers, not numbers."""
    if value is None:
        raise SnapshotError("MT5_TICKET_MISSING")
    ticket = str(value).strip()
    if not ticket or not all(character.isalnum() or character in "-_" for character in ticket):
        raise SnapshotError("MT5_TICKET_INVALID")
    return ticket


def _epoch_ms(value: Any) -> int | None:
    if value is None:
        return None
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        return None
    return seconds * 1000 if seconds > 0 else None


def _name(mapping: dict[int, str], value: Any, code: str) -> str:
    try:
        key = int(value)
    except (TypeError, ValueError):
        raise SnapshotError(code) from None
    if key not in mapping:
        raise SnapshotError(code)
    return mapping[key]


def _filling_modes(mask: Any) -> list[str]:
    try:
        bits = int(mask)
    except (TypeError, ValueError):
        return []
    return [name for flag, name in _FILLING_FLAGS if bits & flag]


def _login_suffix(login: Any) -> str | None:
    """Only the last four digits are ever carried; the full login stays local."""
    if login is None:
        return None
    digits = "".join(character for character in str(login) if character.isdigit())
    return digits[-4:] if digits else None


def normalize_account(info: Any) -> dict[str, Any]:
    """Normalize ``account_info()`` into the backend account-state contract."""
    if info is None:
        raise SnapshotError("MT5_ACCOUNT_UNAVAILABLE")
    currency = str(getattr(info, "currency", "") or "").strip().upper()
    if len(currency) != 3 or not currency.isalpha():
        raise SnapshotError("MT5_ACCOUNT_CURRENCY_INVALID")

    leverage = getattr(info, "leverage", None)
    try:
        leverage = int(leverage) if leverage is not None else None
    except (TypeError, ValueError):
        leverage = None

    return {
        "currency": currency,
        "leverage": leverage if leverage and leverage > 0 else None,
        "balance": _required_decimal(getattr(info, "balance", None), "MT5_ACCOUNT_BALANCE_MISSING"),
        "equity": _required_decimal(getattr(info, "equity", None), "MT5_ACCOUNT_EQUITY_MISSING"),
        "margin": _required_decimal(getattr(info, "margin", None), "MT5_ACCOUNT_MARGIN_MISSING"),
        "free_margin": _required_decimal(
            getattr(info, "margin_free", None), "MT5_ACCOUNT_FREE_MARGIN_MISSING"
        ),
        "margin_level": _decimal(getattr(info, "margin_level", None)),
        "margin_mode": _name(
            _MARGIN_MODES, getattr(info, "margin_mode", None), "MT5_ACCOUNT_MARGIN_MODE_UNKNOWN"
        ),
        "account_mode": _name(
            _ACCOUNT_MODES, getattr(info, "trade_mode", None), "MT5_ACCOUNT_MODE_UNKNOWN"
        ),
        "trade_allowed": bool(getattr(info, "trade_allowed", False)),
        "observed_server": str(getattr(info, "server", "") or "").strip(),
        "observed_login_suffix": _login_suffix(getattr(info, "login", None)),
    }


def normalize_position(position: Any) -> dict[str, Any]:
    """Normalize one open position."""
    return {
        "broker_ticket": _ticket(getattr(position, "ticket", None)),
        "symbol": str(getattr(position, "symbol", "") or "").strip(),
        "side": _name(_POSITION_SIDES, getattr(position, "type", None), "MT5_POSITION_SIDE_UNKNOWN"),
        "volume": _required_decimal(getattr(position, "volume", None), "MT5_POSITION_VOLUME_MISSING"),
        "open_price": _required_decimal(
            getattr(position, "price_open", None), "MT5_POSITION_OPEN_PRICE_MISSING"
        ),
        "current_price": _decimal(getattr(position, "price_current", None)),
        "stop_loss": _decimal(getattr(position, "sl", None)),
        "take_profit": _decimal(getattr(position, "tp", None)),
        "swap": _decimal(getattr(position, "swap", None)),
        "profit": _decimal(getattr(position, "profit", None)),
        "magic": int(getattr(position, "magic", 0) or 0),
        "opened_at_ms": _epoch_ms(getattr(position, "time", None)),
    }


def normalize_pending_order(order: Any) -> dict[str, Any]:
    """Normalize one working order. Filled/cancelled orders are Phase 4b."""
    return {
        "broker_ticket": _ticket(getattr(order, "ticket", None)),
        "symbol": str(getattr(order, "symbol", "") or "").strip(),
        "order_type": _name(
            _PENDING_ORDER_TYPES, getattr(order, "type", None), "MT5_ORDER_TYPE_UNSUPPORTED"
        ),
        "volume_current": _required_decimal(
            getattr(order, "volume_current", None), "MT5_ORDER_VOLUME_MISSING"
        ),
        "volume_initial": _decimal(getattr(order, "volume_initial", None)),
        "price_open": _required_decimal(
            getattr(order, "price_open", None), "MT5_ORDER_PRICE_MISSING"
        ),
        "price_stop_limit": _decimal(getattr(order, "price_stoplimit", None)),
        "stop_loss": _decimal(getattr(order, "sl", None)),
        "take_profit": _decimal(getattr(order, "tp", None)),
        "time_in_force": _TIME_IN_FORCE.get(_as_int(getattr(order, "type_time", None))),
        "magic": int(getattr(order, "magic", 0) or 0),
        "placed_at_ms": _epoch_ms(getattr(order, "time_setup", None)),
        "expires_at_ms": _epoch_ms(getattr(order, "time_expiration", None)),
    }


def normalize_history_order(order: Any) -> dict[str, Any]:
    """Normalize one historical order without exposing MT5 enums."""
    return {
        "broker_ticket": _ticket(getattr(order, "ticket", None)),
        "position_ticket": _ticket(getattr(order, "position_id", None))
        if getattr(order, "position_id", None)
        else None,
        "symbol": str(getattr(order, "symbol", "") or "").strip(),
        "order_type": _name(
            _HISTORY_ORDER_TYPES, getattr(order, "type", None), "MT5_HISTORY_ORDER_TYPE_UNKNOWN"
        ),
        "state": _name(
            _HISTORY_ORDER_STATES, getattr(order, "state", None), "MT5_HISTORY_ORDER_STATE_UNKNOWN"
        ),
        "volume_initial": _required_decimal(
            getattr(order, "volume_initial", None), "MT5_HISTORY_ORDER_VOLUME_MISSING"
        ),
        "volume_current": _required_decimal(
            getattr(order, "volume_current", None), "MT5_HISTORY_ORDER_VOLUME_MISSING"
        ),
        "price_open": _required_decimal(
            getattr(order, "price_open", None), "MT5_HISTORY_ORDER_PRICE_MISSING"
        ),
        "price_current": _decimal(getattr(order, "price_current", None)),
        "stop_loss": _decimal(getattr(order, "sl", None)),
        "take_profit": _decimal(getattr(order, "tp", None)),
        "placed_at_ms": _epoch_ms(getattr(order, "time_setup", None)),
        "done_at_ms": _epoch_ms(getattr(order, "time_done", None)),
        "magic": int(getattr(order, "magic", 0) or 0),
    }


def normalize_deal(deal: Any) -> dict[str, Any]:
    """Normalize one historical deal."""
    return {
        "broker_ticket": _ticket(getattr(deal, "ticket", None)),
        "order_ticket": _ticket(getattr(deal, "order", None)) if getattr(deal, "order", None) else None,
        "position_ticket": _ticket(getattr(deal, "position_id", None))
        if getattr(deal, "position_id", None)
        else None,
        "symbol": str(getattr(deal, "symbol", "") or "").strip() or None,
        "deal_type": _name(_DEAL_TYPES, getattr(deal, "type", None), "MT5_DEAL_TYPE_UNKNOWN"),
        "entry": _name(_DEAL_ENTRIES, getattr(deal, "entry", None), "MT5_DEAL_ENTRY_UNKNOWN"),
        "volume": _required_decimal(getattr(deal, "volume", None), "MT5_DEAL_VOLUME_MISSING"),
        "price": _required_decimal(getattr(deal, "price", None), "MT5_DEAL_PRICE_MISSING"),
        "commission": _decimal(getattr(deal, "commission", None)),
        "swap": _decimal(getattr(deal, "swap", None)),
        "profit": _decimal(getattr(deal, "profit", None)),
        "fee": _decimal(getattr(deal, "fee", None)),
        "occurred_at_ms": _epoch_ms(getattr(deal, "time", None)),
        "magic": int(getattr(deal, "magic", 0) or 0),
    }


def _as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return -1


def normalize_instrument(info: Any) -> dict[str, Any]:
    """Normalize one symbol specification as observed on this terminal."""
    symbol = str(getattr(info, "name", "") or "").strip()
    if not symbol:
        raise SnapshotError("MT5_SYMBOL_NAME_MISSING")
    digits = _as_int(getattr(info, "digits", None))
    if digits < 0 or digits > 12:
        raise SnapshotError("MT5_SYMBOL_DIGITS_INVALID")

    volume_min = _required_decimal(getattr(info, "volume_min", None), "MT5_SYMBOL_VOLUME_MISSING")
    volume_max = _required_decimal(getattr(info, "volume_max", None), "MT5_SYMBOL_VOLUME_MISSING")
    volume_step = _required_decimal(getattr(info, "volume_step", None), "MT5_SYMBOL_VOLUME_MISSING")

    return {
        "symbol": symbol,
        "digits": digits,
        "point": _required_decimal(getattr(info, "point", None), "MT5_SYMBOL_POINT_MISSING"),
        "tick_size": _decimal(getattr(info, "trade_tick_size", None)),
        "tick_value": _decimal(getattr(info, "trade_tick_value", None)),
        "contract_size": _decimal(getattr(info, "trade_contract_size", None)),
        "volume_min": volume_min,
        "volume_max": volume_max,
        "volume_step": volume_step,
        "stops_level": max(_as_int(getattr(info, "trade_stops_level", 0)), 0),
        "freeze_level": max(_as_int(getattr(info, "trade_freeze_level", 0)), 0),
        "filling_modes": _filling_modes(getattr(info, "filling_mode", None)),
        "trade_mode": _name(
            _SYMBOL_TRADE_MODES, getattr(info, "trade_mode", None), "MT5_SYMBOL_TRADE_MODE_UNKNOWN"
        ),
    }


def _collect_family(rows: Iterable[Any] | None, normalizer, missing_code: str) -> tuple[list, str, str | None]:
    """Normalize one family, downgrading to partial/failed rather than lying.

    ``None`` from MT5 means "call failed", which is not the same as an empty
    tuple meaning "nothing open". Only the latter may report ``complete``.
    """
    if rows is None:
        return [], FAILED, missing_code
    normalized = []
    for index, row in enumerate(rows):
        if index >= MAX_FAMILY_ROWS:
            return normalized, PARTIAL, "MT5_SNAPSHOT_ROW_LIMIT_EXCEEDED"
        try:
            normalized.append(normalizer(row))
        except SnapshotError as error:
            # One unusable row must not discard the rest, but the family can no
            # longer claim to be complete.
            return normalized, PARTIAL, error.code
    return normalized, COMPLETE, None


def collect_snapshots(mt5: Any, *, symbols: Iterable[str] | None = None) -> dict[str, Any]:
    """Read every Phase 4a family from one MT5 terminal on the calling thread.

    Invariant 3 requires a single caller thread per terminal; this function does
    no threading of its own and must be called from the terminal's owner.

    Returns one envelope per family. A family that could not be enumerated is
    reported as ``partial`` or ``failed`` with a stable error code, never as an
    empty ``complete`` set.
    """
    families: dict[str, Any] = {}

    try:
        account = normalize_account(mt5.account_info())
        families["account"] = {"result": COMPLETE, "error_code": None, "account": account}
    except SnapshotError as error:
        families["account"] = {"result": FAILED, "error_code": error.code, "account": None}
    except Exception:
        families["account"] = {
            "result": FAILED,
            "error_code": "MT5_ACCOUNT_UNAVAILABLE",
            "account": None,
        }

    positions, result, code = _collect_family(
        _safe_call(mt5.positions_get), normalize_position, "MT5_POSITIONS_UNAVAILABLE"
    )
    families["positions"] = {"result": result, "error_code": code, "positions": positions}

    orders, result, code = _collect_family(
        _safe_call(mt5.orders_get), normalize_pending_order, "MT5_ORDERS_UNAVAILABLE"
    )
    families["pending_orders"] = {"result": result, "error_code": code, "pending_orders": orders}

    instrument_rows = _safe_call(mt5.symbols_get)
    if instrument_rows is not None and symbols is not None:
        wanted = {name.strip() for name in symbols if name and name.strip()}
        instrument_rows = [
            row for row in instrument_rows if str(getattr(row, "name", "")).strip() in wanted
        ]
    instruments, result, code = _collect_family(
        instrument_rows, normalize_instrument, "MT5_SYMBOLS_UNAVAILABLE"
    )
    families["instruments"] = {"result": result, "error_code": code, "instruments": instruments}

    return families


def _safe_call(callable_obj) -> Any:
    """Treat an MT5 exception the same as an explicit ``None`` return."""
    try:
        return callable_obj()
    except Exception:
        return None


def collect_history_page(mt5: Any, *, from_ms: int, to_ms: int) -> dict[str, Any]:
    """Collect one bounded historical window; never call a failed page empty."""
    if from_ms <= 0 or to_ms <= from_ms or to_ms - from_ms > 31 * 24 * 60 * 60 * 1000:
        raise SnapshotError("MT5_HISTORY_WINDOW_INVALID")
    start = datetime.fromtimestamp(from_ms / 1000, tz=timezone.utc)
    end = datetime.fromtimestamp(to_ms / 1000, tz=timezone.utc)
    orders, order_result, order_code = _collect_family(
        _safe_call(lambda: mt5.history_orders_get(start, end)),
        normalize_history_order,
        "MT5_HISTORY_ORDERS_UNAVAILABLE",
    )
    deals, deal_result, deal_code = _collect_family(
        _safe_call(lambda: mt5.history_deals_get(start, end)),
        normalize_deal,
        "MT5_HISTORY_DEALS_UNAVAILABLE",
    )
    return {
        "orders_history": {
            "result": order_result,
            "error_code": order_code,
            "orders": orders,
            "covered_through_ms": to_ms if order_result == COMPLETE else None,
        },
        "deals": {
            "result": deal_result,
            "error_code": deal_code,
            "deals": deals,
            "covered_through_ms": to_ms if deal_result == COMPLETE else None,
        },
    }
