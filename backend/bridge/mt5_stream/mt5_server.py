#!/usr/bin/env python3
"""Local MT5 tick streaming bridge.

The MetaTrader5 Python package can only run on a host where the MT5 terminal is
installed and logged in. This sidecar process keeps MT5 integration outside the
Go API process and exposes a small localhost WebSocket stream that Go can
consume with a normal WebSocket client.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Set

import MetaTrader5 as mt5
import websockets
from websockets.server import WebSocketServerProtocol


LOG = logging.getLogger("mt5-stream")


@dataclass(frozen=True)
class Config:
    symbols: tuple[str, ...]
    stream_all_visible: bool
    host: str
    port: int
    poll_interval_ms: int
    history_bars: int
    history_timeframes: tuple[str, ...]
    preload_history: bool
    terminal_path: str | None
    login: int | None
    password: str | None
    server: str | None

    @classmethod
    def from_env(cls) -> "Config":
        login_raw = os.getenv("MT5_LOGIN", "").strip()
        symbols_raw = os.getenv("MT5_SYMBOLS", "")
        return cls(
            symbols=parse_symbols(symbols_raw),
            stream_all_visible=env_bool("MT5_STREAM_ALL_VISIBLE", True),
            host=os.getenv("MT5_STREAM_HOST", "localhost").strip(),
            port=int(os.getenv("MT5_STREAM_PORT", "8765")),
            poll_interval_ms=int(os.getenv("MT5_POLL_INTERVAL_MS", "100")),
            history_bars=int(os.getenv("MT5_HISTORY_BARS", "1500")),
            history_timeframes=parse_timeframes(
                os.getenv(
                    "MT5_HISTORY_TIMEFRAMES",
                    "1m,3m,5m,15m,30m,1H,2H,4H,1D,1W,1M",
                )
            ),
            preload_history=env_bool("MT5_PRELOAD_HISTORY", False),
            terminal_path=os.getenv("MT5_TERMINAL_PATH") or None,
            login=int(login_raw) if login_raw else None,
            password=os.getenv("MT5_PASSWORD") or None,
            server=os.getenv("MT5_SERVER") or None,
        )


CLIENTS: Set[WebSocketServerProtocol] = set()
SYMBOL_CATALOG: list[dict[str, Any]] = []
STREAM_SYMBOLS: tuple[str, ...] = ()
HISTORY_MESSAGES: list[str] = []
HISTORY_TASKS: dict[tuple[int, str], asyncio.Task[None]] = {}
MT5_TICK_TIME_OFFSET_SECONDS = 0
# The MetaTrader5 Python module is blocking and should be treated as
# single-thread-affine. Keep every MT5 call that runs after startup on this one
# worker thread so asyncio can still accept WebSocket handshakes, send symbol
# catalogs, and process Go requests while MT5 is polling ticks or warming
# history.
MT5_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mt5-worker")

TIMEFRAME_MAP = {
    "1m": mt5.TIMEFRAME_M1,
    "3m": mt5.TIMEFRAME_M3,
    "5m": mt5.TIMEFRAME_M5,
    "15m": mt5.TIMEFRAME_M15,
    "30m": mt5.TIMEFRAME_M30,
    "1H": mt5.TIMEFRAME_H1,
    "2H": mt5.TIMEFRAME_H2,
    "4H": mt5.TIMEFRAME_H4,
    "1D": mt5.TIMEFRAME_D1,
    "1W": mt5.TIMEFRAME_W1,
    "1M": mt5.TIMEFRAME_MN1,
}

# Bar length in seconds, used to decide whether cached rates are up to date.
# Note: "1m" is one minute; "1M" is one month. A month is variable length
# (28-31 days), so the 31-day upper bound keeps the freshness check lenient — a
# valid current-month bar always passes while a months-behind cache is refetched.
TIMEFRAME_SECONDS = {
    "1m": 60,
    "3m": 180,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1H": 3600,
    "2H": 7200,
    "4H": 14400,
    "1D": 86400,
    "1W": 604800,
    "1M": 2678400,
}

# MT5 returns cached (often stale) bars from copy_rates_from_pos and only
# downloads recent history in the background. These bound how hard we retry to
# get bars up to the current one before giving up.
HISTORY_SYNC_RETRIES = int(os.getenv("MT5_HISTORY_SYNC_RETRIES", "2"))
HISTORY_SYNC_DELAY = max(int(os.getenv("MT5_HISTORY_SYNC_DELAY_MS", "300")), 50) / 1000


def _rates_are_fresh(
    rates: Any,
    symbol: str,
    timeframe: str,
    tf_seconds: int,
) -> bool:
    """True when the last cached bar is within one bar of the current one."""
    if rates is None or len(rates) == 0:
        return False
    if tf_seconds <= 0:
        return True  # non-intraday timeframe: accept whatever MT5 returns
    tick = mt5.symbol_info_tick(symbol)
    if tick is None or not tick.time:
        return True  # no live reference; don't loop forever
    tick_time = normalize_mt5_tick_time(int(tick.time))
    last_rate_time = int(rates[-1]["time"])
    if timeframe == "1W":
        # Weekly bars are broker/calendar aligned, not aligned to the Unix epoch.
        return last_rate_time >= tick_time - (2 * 7 * 86400)
    if timeframe == "1M":
        # Calendar months vary from 28-31 days. Accept the current or previous
        # monthly bar without repeatedly warming an already valid MT5 cache.
        return last_rate_time >= tick_time - (2 * 31 * 86400)
    current_bar = tick_time - (tick_time % tf_seconds)
    # MetaQuotes documents copy_rates_* output as UTC bar-open seconds. Keep rate
    # times untouched here; applying the tick offset to rates shifts candles by
    # the workstation/broker offset and creates a false gap before live price.
    return last_rate_time >= current_bar - tf_seconds


def copy_rates_synced_blocking(
    symbol: str,
    mt5_timeframe: int,
    timeframe: str,
    limit: int,
    before: int = 0,
) -> Any:
    """Blocking history loader for the dedicated history worker.

    Some MT5 `copy_rates_*` calls can block for many seconds while the terminal
    downloads a cold symbol/timeframe. Running that call directly in the asyncio
    WebSocket handler freezes every other message, so Go sees unrelated history
    requests time out in a cascade. The executor has one worker, keeping history
    calls serialized while the event loop remains free for ticks, pings, and
    responses.
    """
    if before > 0:
        return mt5.copy_rates_from(
            symbol,
            mt5_timeframe,
            datetime.fromtimestamp(max(0, before - 1), timezone.utc),
            limit,
        )

    tf_seconds = TIMEFRAME_SECONDS.get(timeframe, 0)
    rates = mt5.copy_rates_from_pos(symbol, mt5_timeframe, 0, limit)
    if rates is not None and len(rates) > 0:
        if not _rates_are_fresh(rates, symbol, timeframe, tf_seconds):
            LOG.debug(
                "returning available MT5 history while terminal warms "
                "symbol=%s timeframe=%s bars=%d",
                symbol,
                timeframe,
                len(rates),
            )
        return rates

    # Retry only an empty response. A non-empty but slightly stale window is
    # immediately useful for first paint, and subsequent active-chart refreshes
    # will pick up the terminal's asynchronously warmed bars. Waiting for strict
    # freshness here can multiply slow MT5 calls into a 60-second queue stall.
    for _ in range(HISTORY_SYNC_RETRIES):
        mt5.copy_rates_from(
            symbol,
            mt5_timeframe,
            datetime.now(timezone.utc) + timedelta(days=1),
            2,
        )
        time.sleep(HISTORY_SYNC_DELAY)
        rates = mt5.copy_rates_from_pos(symbol, mt5_timeframe, 0, limit)
        if rates is not None and len(rates) > 0:
            return rates
    return rates


async def copy_rates_synced_worker(
    symbol: str,
    mt5_timeframe: int,
    timeframe: str,
    limit: int,
    before: int = 0,
) -> Any:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        MT5_EXECUTOR,
        copy_rates_synced_blocking,
        symbol,
        mt5_timeframe,
        timeframe,
        limit,
        before,
    )


def copy_selected_rates_synced_blocking(
    symbol: str,
    mt5_timeframe: int,
    timeframe: str,
    limit: int,
    before: int = 0,
) -> tuple[Any, str]:
    """Select and load one history window on the MT5-affine worker."""
    if not mt5.symbol_select(symbol, True):
        return None, f"symbol_select({symbol}) failed ({last_mt5_error()})"
    rates = copy_rates_synced_blocking(
        symbol,
        mt5_timeframe,
        timeframe,
        limit,
        before,
    )
    if rates is None:
        return None, (
            f"copy_rates_from_pos({symbol}, {timeframe}) failed "
            f"({last_mt5_error()})"
        )
    return rates, ""


async def copy_selected_rates_synced_worker(
    symbol: str,
    mt5_timeframe: int,
    timeframe: str,
    limit: int,
    before: int = 0,
) -> tuple[Any, str]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        MT5_EXECUTOR,
        copy_selected_rates_synced_blocking,
        symbol,
        mt5_timeframe,
        timeframe,
        limit,
        before,
    )


async def run_mt5_worker(func: Any, *args: Any) -> Any:
    """Run a blocking MT5 function on the single MT5 worker thread."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(MT5_EXECUTOR, func, *args)


def parse_symbols(raw: str) -> tuple[str, ...]:
    symbols: list[str] = []
    seen: set[str] = set()
    for item in raw.split(","):
        symbol = item.strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        symbols.append(symbol)
    return tuple(symbols)


def parse_timeframes(raw: str) -> tuple[str, ...]:
    timeframes: list[str] = []
    seen: set[str] = set()
    aliases = {
        "1MIN": "1m",
        "3MIN": "3m",
        "5MIN": "5m",
        "15MIN": "15m",
        "30MIN": "30m",
        "1H": "1H",
        "2H": "2H",
        "4H": "4H",
        "1D": "1D",
        "1W": "1W",
        "1M": "1M",
    }
    for item in raw.split(","):
        key = item.strip()
        if not key:
            continue
        normalized = aliases.get(key.upper(), key)
        if normalized in TIMEFRAME_MAP and normalized not in seen:
            seen.add(normalized)
            timeframes.append(normalized)
    return tuple(timeframes)


def env_bool(key: str, fallback: bool) -> bool:
    raw = os.getenv(key)
    if raw is None:
        return fallback
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def estimate_mt5_tick_time_offset(symbols: tuple[str, ...]) -> int:
    """Estimate tick timestamp offset against MT5's own M1 history domain.

    Do not compare ticks to the workstation clock: if the OS timezone, broker
    server timezone, or demo clock differs, that heuristic can invent a 7-hour
    shift and make chart history look stale. MT5 chart candles come from
    `copy_rates_*`; use the newest M1 bar as the reference and only offset ticks
    when subtracting an hour-rounded delta makes the tick land inside that M1
    bar. If MT5 has not warmed M1 history yet, keep offset 0.
    """
    offsets: dict[int, int] = {}
    for symbol in symbols:
        tick = mt5.symbol_info_tick(symbol)
        if tick is None or not tick.time:
            continue

        rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, 1)
        if rates is None or len(rates) == 0:
            continue

        tick_time = int(tick.time)
        rate_time = int(rates[-1]["time"])
        delta = tick_time - rate_time
        if 0 <= delta < 180:
            offsets[0] = offsets.get(0, 0) + 1
            continue

        rounded = int(round(delta / 3600) * 3600)
        normalized_tick = tick_time - rounded
        if 0 <= normalized_tick - rate_time < 180:
            offsets[rounded] = offsets.get(rounded, 0) + 1

    if not offsets:
        return 0
    offset = max(offsets.items(), key=lambda item: item[1])[0]
    LOG.info("MT5 tick time offset seconds=%d hours=%.1f", offset, offset / 3600)
    return offset


def normalize_mt5_tick_time(raw_time: int) -> int:
    return int(raw_time) - MT5_TICK_TIME_OFFSET_SECONDS


def setup_logging() -> None:
    logging.basicConfig(
        level=os.getenv("MT5_STREAM_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def last_mt5_error() -> str:
    code, message = mt5.last_error()
    return f"{code}: {message}"


def initialize_mt5(cfg: Config) -> tuple[list[dict[str, Any]], tuple[str, ...]]:
    init_args = {}
    if cfg.terminal_path:
        init_args["path"] = cfg.terminal_path

    if not mt5.initialize(**init_args):
        raise RuntimeError(f"MT5 initialize failed ({last_mt5_error()})")

    # Credentials are optional because many demo/dev terminals are already
    # logged in. When one credential is provided, require the full set so a
    # partial configuration cannot silently attach to the wrong account.
    provided_login = cfg.login is not None
    provided_password = bool(cfg.password)
    provided_server = bool(cfg.server)
    if provided_login or provided_password or provided_server:
        if not (provided_login and provided_password and provided_server):
            raise RuntimeError(
                "MT5_LOGIN, MT5_PASSWORD, and MT5_SERVER must be set together"
            )
        if not mt5.login(cfg.login, password=cfg.password, server=cfg.server):
            raise RuntimeError(f"MT5 login failed ({last_mt5_error()})")

    account = mt5.account_info()
    if account is None:
        raise RuntimeError(f"MT5 account is unavailable ({last_mt5_error()})")

    catalog = load_symbol_catalog()
    stream_symbols = resolve_stream_symbols(cfg, catalog)
    select_symbols(stream_symbols)

    global MT5_TICK_TIME_OFFSET_SECONDS
    MT5_TICK_TIME_OFFSET_SECONDS = estimate_mt5_tick_time_offset(stream_symbols)

    LOG.info(
        "MT5 initialized account=%s server=%s symbols=%d stream_symbols=%s",
        account.login,
        account.server,
        len(catalog),
        ",".join(stream_symbols) if stream_symbols else "(none)",
    )
    return catalog, stream_symbols


def load_symbol_catalog() -> list[dict[str, Any]]:
    symbols = mt5.symbols_get()
    if symbols is None:
        raise RuntimeError(f"MT5 symbols_get failed ({last_mt5_error()})")

    catalog: list[dict[str, Any]] = []
    for info in symbols:
        catalog.append(
            {
                "name": info.name,
                "path": info.path,
                "description": info.description,
                "visible": bool(info.visible),
                "digits": int(info.digits),
                "point": float(info.point),
                "spread": int(info.spread),
                "trade_mode": int(info.trade_mode),
                "currency_base": info.currency_base,
                "currency_profit": info.currency_profit,
                "currency_margin": info.currency_margin,
            }
        )
    catalog.sort(key=lambda item: item["name"])
    return catalog


def resolve_stream_symbols(
    cfg: Config,
    catalog: list[dict[str, Any]],
) -> tuple[str, ...]:
    available = {item["name"].upper(): item["name"] for item in catalog}
    stream_symbols: list[str] = []
    seen: set[str] = set()

    def add_symbol(symbol: str) -> None:
        key = symbol.upper()
        resolved = available.get(key)
        if resolved and resolved.upper() not in seen:
            seen.add(resolved.upper())
            stream_symbols.append(resolved)

    if cfg.stream_all_visible:
        for item in catalog:
            if item["visible"]:
                add_symbol(item["name"])

    if cfg.symbols:
        missing = [symbol for symbol in cfg.symbols if symbol.upper() not in available]
        if missing:
            raise RuntimeError(f"MT5 symbols not found: {', '.join(missing)}")
        for symbol in cfg.symbols:
            add_symbol(symbol)
        return tuple(stream_symbols)

    if stream_symbols:
        return tuple(stream_symbols)

    LOG.warning(
        "No MT5 symbols selected and MT5_STREAM_ALL_VISIBLE=false; "
        "bridge will publish the symbol catalog only"
    )
    return ()


def select_symbols(symbols: tuple[str, ...]) -> None:
    for symbol in symbols:
        if not mt5.symbol_select(symbol, True):
            raise RuntimeError(
                f"MT5 symbol_select({symbol}) failed ({last_mt5_error()})"
            )


async def register_client(websocket: WebSocketServerProtocol) -> None:
    CLIENTS.add(websocket)
    peer = websocket.remote_address
    LOG.info("client connected peer=%s clients=%d", peer, len(CLIENTS))
    try:
        await websocket.send(symbol_catalog_message())
        for message in await current_tick_messages_worker(STREAM_SYMBOLS):
            await websocket.send(message)
        for message in HISTORY_MESSAGES:
            await websocket.send(message)
        async for raw in websocket:
            await handle_client_message(websocket, raw)
    finally:
        client_id = id(websocket)
        for key, task in tuple(HISTORY_TASKS.items()):
            if key[0] == client_id:
                HISTORY_TASKS.pop(key, None)
                task.cancel()
        CLIENTS.discard(websocket)
        LOG.info("client disconnected peer=%s clients=%d", peer, len(CLIENTS))


async def handle_client_message(websocket: WebSocketServerProtocol, raw: str) -> None:
    try:
        message = json.loads(raw)
    except json.JSONDecodeError:
        LOG.warning("ignoring invalid client JSON")
        return

    message_type = message.get("type")
    if message_type == "stream.subscribe":
        added = await add_stream_symbols_worker(message.get("symbols"))
        if added:
            await broadcast(symbol_catalog_message())
            for tick_message in await current_tick_messages_worker(added):
                await broadcast(tick_message)
        return

    if message_type == "history.cancel":
        request_id = str(message.get("id") or "")
        task = HISTORY_TASKS.pop((id(websocket), request_id), None)
        if task is not None:
            task.cancel()
        return

    if message_type != "history.request":
        LOG.debug("ignoring client message type=%s", message_type)
        return

    request_id = str(message.get("id") or "")
    symbol = str(message.get("symbol") or "").strip()
    timeframe = str(message.get("timeframe") or "15m").strip()
    try:
        limit = int(message.get("limit") or 1500)
    except (TypeError, ValueError):
        limit = 1500
    try:
        before = int(message.get("before") or 0)
    except (TypeError, ValueError):
        before = 0
    task_key = (id(websocket), request_id)
    previous = HISTORY_TASKS.pop(task_key, None)
    if previous is not None:
        previous.cancel()
    task = asyncio.create_task(
        send_history_response(websocket, symbol, timeframe, limit, request_id, before)
    )
    HISTORY_TASKS[task_key] = task
    task.add_done_callback(lambda _task, key=task_key: HISTORY_TASKS.pop(key, None))


async def send_history_response(
    websocket: WebSocketServerProtocol,
    symbol: str,
    timeframe: str,
    limit: int,
    request_id: str,
    before: int = 0,
) -> None:
    try:
        await websocket.send(
            await load_history_message(symbol, timeframe, limit, request_id, before)
        )
    except asyncio.CancelledError:
        # The browser changed symbol/timeframe. If this work was still queued in
        # the single MT5 executor, cancellation removes it before it can delay
        # the newly active chart request.
        return
    except Exception as exc:  # noqa: BLE001 - client may disconnect mid-load.
        LOG.warning(
            "failed to send MT5 history response symbol=%s timeframe=%s: %s",
            symbol,
            timeframe,
            exc,
        )


def add_stream_symbols(raw_symbols: Any) -> tuple[str, ...]:
    """Add symbols to the live tick stream after the bridge has started.

    The Go API calls this when the browser asks for ticks for a catalog symbol
    that is not in the initial Market Watch visible set. This keeps startup
    light while still allowing watchlist/search rows to obtain live prices on
    demand.
    """
    global STREAM_SYMBOLS

    if not isinstance(raw_symbols, list):
        return ()

    available = {item["name"].upper(): item["name"] for item in SYMBOL_CATALOG}
    existing = {symbol.upper() for symbol in STREAM_SYMBOLS}
    added: list[str] = []
    for value in raw_symbols:
        if not isinstance(value, str):
            continue
        requested = value.strip().upper()
        symbol = available.get(requested)
        if not symbol or symbol.upper() in existing:
            continue
        if not mt5.symbol_select(symbol, True):
            LOG.warning("symbol_select(%s) failed (%s)", symbol, last_mt5_error())
            continue
        existing.add(symbol.upper())
        added.append(symbol)

    if not added:
        return ()

    STREAM_SYMBOLS = tuple([*STREAM_SYMBOLS, *added])
    LOG.info(
        "added MT5 stream symbols count=%d symbols=%s",
        len(STREAM_SYMBOLS),
        ",".join(added),
    )
    return tuple(added)


async def add_stream_symbols_worker(raw_symbols: Any) -> tuple[str, ...]:
    return await run_mt5_worker(add_stream_symbols, raw_symbols)


def symbol_catalog_message() -> str:
    return json.dumps(
        {
            "type": "symbols",
            "source": "mt5",
            "count": len(SYMBOL_CATALOG),
            "stream_symbols": list(STREAM_SYMBOLS),
            "symbols": SYMBOL_CATALOG,
        },
        separators=(",", ":"),
    )


def tick_payload(symbol: str) -> tuple[dict[str, Any], int] | None:
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        LOG.warning("symbol_info_tick(%s) returned none (%s)", symbol, last_mt5_error())
        return None

    time_msc = int(getattr(tick, "time_msc", 0) or tick.time * 1000)
    payload: dict[str, Any] = {
        "type": "tick",
        "source": "mt5",
        "symbol": symbol,
        "bid": float(tick.bid),
        "ask": float(tick.ask),
        "timestamp": normalize_mt5_tick_time(int(tick.time)),
        "time_msc": time_msc - (MT5_TICK_TIME_OFFSET_SECONDS * 1000),
    }
    return payload, time_msc


def tick_message(symbol: str) -> str | None:
    result = tick_payload(symbol)
    if result is None:
        return None
    payload, _ = result
    return json.dumps(payload, separators=(",", ":"))


def current_tick_messages(symbols: tuple[str, ...]) -> list[str]:
    """Return latest tick snapshots without waiting for a new market tick.

    Many MT5 symbols, especially stocks outside their most active session, can
    keep the same `time_msc` for minutes or hours. A newly connected Go backend
    must still receive that latest quote immediately; otherwise watchlist rows
    stay blank until the broker publishes a fresh tick.
    """
    messages: list[str] = []
    for symbol in symbols:
        message = tick_message(symbol)
        if message is not None:
            messages.append(message)
    return messages


async def current_tick_messages_worker(symbols: tuple[str, ...]) -> list[str]:
    return await run_mt5_worker(current_tick_messages, symbols)


def changed_tick_messages(
    symbols: tuple[str, ...],
    last_time_msc_by_symbol: dict[str, int],
) -> tuple[list[str], dict[str, int]]:
    messages: list[str] = []
    next_seen = dict(last_time_msc_by_symbol)
    for symbol in symbols:
        result = tick_payload(symbol)
        if result is None:
            continue

        payload, time_msc = result
        if time_msc == next_seen.get(symbol):
            continue

        messages.append(json.dumps(payload, separators=(",", ":")))
        next_seen[symbol] = time_msc
    return messages, next_seen


async def changed_tick_messages_worker(
    symbols: tuple[str, ...],
    last_time_msc_by_symbol: dict[str, int],
) -> tuple[list[str], dict[str, int]]:
    return await run_mt5_worker(changed_tick_messages, symbols, last_time_msc_by_symbol)


async def load_history_messages(
    symbols: tuple[str, ...],
    timeframes: tuple[str, ...],
    bars: int,
) -> list[str]:
    messages: list[str] = []
    limit = max(1, min(bars, 5000))
    for symbol in symbols:
        for timeframe in timeframes:
            mt5_timeframe = TIMEFRAME_MAP.get(timeframe)
            if mt5_timeframe is None:
                continue
            rates = await copy_rates_synced_worker(symbol, mt5_timeframe, timeframe, limit)
            if rates is None:
                LOG.warning(
                    "copy_rates_from_pos(%s, %s) failed (%s)",
                    symbol,
                    timeframe,
                    last_mt5_error(),
                )
                continue
            candles = [
                {
                    "time": int(row["time"]),
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "volume": float(row["tick_volume"]),
                }
                for row in rates
            ]
            messages.append(
                json.dumps(
                    {
                        "type": "history",
                        "source": "mt5",
                        "symbol": symbol,
                        "timeframe": timeframe,
                        "candles": candles,
                    },
                    separators=(",", ":"),
                )
            )
    LOG.info("loaded MT5 history messages=%d bars=%d", len(messages), limit)
    return messages


async def load_history_message(
    symbol: str,
    timeframe: str,
    bars: int,
    request_id: str = "",
    before: int = 0,
) -> str:
    limit = max(1, min(int(bars or 1500), 5000))
    mt5_timeframe = TIMEFRAME_MAP.get(timeframe)
    payload: dict[str, Any] = {
        "type": "history",
        "source": "mt5",
        "request_id": request_id,
        "symbol": symbol,
        "timeframe": timeframe,
        "candles": [],
    }
    if not symbol:
        payload["error"] = "symbol is required"
        return json.dumps(payload, separators=(",", ":"))
    if mt5_timeframe is None:
        payload["error"] = f"unsupported timeframe: {timeframe}"
        return json.dumps(payload, separators=(",", ":"))
    rates, error = await copy_selected_rates_synced_worker(
        symbol,
        mt5_timeframe,
        timeframe,
        limit,
        before,
    )
    if error:
        payload["error"] = error
        return json.dumps(payload, separators=(",", ":"))

    payload["candles"] = [
        {
            "time": int(row["time"]),
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": float(row["tick_volume"]),
        }
        for row in rates
    ]
    return json.dumps(payload, separators=(",", ":"))


async def broadcast(message: str) -> None:
    if not CLIENTS:
        return

    stale: list[WebSocketServerProtocol] = []
    for client in tuple(CLIENTS):
        try:
            await client.send(message)
        except Exception as exc:  # noqa: BLE001 - keep sidecar resilient.
            LOG.warning("dropping failed websocket client: %s", exc)
            stale.append(client)

    for client in stale:
        CLIENTS.discard(client)
        try:
            await client.close()
        except Exception:
            pass


async def stream_ticks(cfg: Config, stop_event: asyncio.Event) -> None:
    last_time_msc_by_symbol: dict[str, int] = {}
    sleep_seconds = max(cfg.poll_interval_ms, 10) / 1000

    while not stop_event.is_set():
        try:
            messages, last_time_msc_by_symbol = await changed_tick_messages_worker(
                STREAM_SYMBOLS,
                last_time_msc_by_symbol,
            )
            for message in messages:
                await broadcast(message)
        except Exception:
            LOG.exception("tick streaming loop failed")

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=sleep_seconds)
        except asyncio.TimeoutError:
            pass


async def main() -> None:
    setup_logging()
    cfg = Config.from_env()
    stop_event = asyncio.Event()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:
            # Windows event loops do not support add_signal_handler; Ctrl+C is
            # still handled by KeyboardInterrupt around asyncio.run().
            pass

    global SYMBOL_CATALOG, STREAM_SYMBOLS, HISTORY_MESSAGES
    SYMBOL_CATALOG, STREAM_SYMBOLS = initialize_mt5(cfg)
    HISTORY_MESSAGES = (
        await load_history_messages(STREAM_SYMBOLS, cfg.history_timeframes, cfg.history_bars)
        if cfg.preload_history
        else []
    )
    tick_task: asyncio.Task[None] | None = None
    try:
        async with websockets.serve(
            register_client,
            cfg.host,
            cfg.port,
            ping_interval=20,
            ping_timeout=10,
            max_queue=32,
        ):
            LOG.info("MT5 tick WebSocket listening on ws://%s:%d", cfg.host, cfg.port)
            tick_task = asyncio.create_task(stream_ticks(cfg, stop_event))
            await stop_event.wait()
    finally:
        if tick_task:
            tick_task.cancel()
            try:
                await tick_task
            except asyncio.CancelledError:
                pass
        mt5.shutdown()
        MT5_EXECUTOR.shutdown(wait=False, cancel_futures=True)
        LOG.info("MT5 bridge stopped")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        LOG.info("MT5 bridge interrupted")
