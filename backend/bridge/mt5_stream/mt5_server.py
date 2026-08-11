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
import queue
import signal
import threading
import time
from concurrent.futures import Future
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from itertools import count
from pathlib import Path
from typing import Any, Callable, Set

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
    market_status_file: str | None
    market_status_poll_ms: int
    market_status_max_age_seconds: int

    @classmethod
    def from_env(cls) -> "Config":
        login_raw = os.getenv("MT5_LOGIN", "").strip()
        symbols_raw = os.getenv("MT5_SYMBOLS", "")
        config = cls(
            symbols=parse_symbols(symbols_raw),
            stream_all_visible=env_bool("MT5_STREAM_ALL_VISIBLE", False),
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
            market_status_file=os.getenv("MT5_MARKET_STATUS_FILE") or None,
            market_status_poll_ms=max(
                int(os.getenv("MT5_MARKET_STATUS_POLL_MS", "1000")),
                250,
            ),
            market_status_max_age_seconds=max(
                int(os.getenv("MT5_MARKET_STATUS_MAX_AGE_SECONDS", "20")),
                5,
            ),
        )
        if config.host.lower() not in {"127.0.0.1", "::1", "localhost"}:
            raise ValueError(
                "MT5_STREAM_HOST must be loopback; the stream protocol has no remote authentication"
            )
        return config


@dataclass(frozen=True)
class HistoryFreshness:
    """Freshness evidence for one latest MT5 rate window.

    ``known`` is false when MT5 has no live tick reference. In that case the
    bridge must not label usable history stale merely because it cannot prove
    which bar is current.
    """

    known: bool
    stale: bool
    last_bar_time: int = 0
    minimum_fresh_bar_time: int = 0


CLIENTS: Set[WebSocketServerProtocol] = set()
SYMBOL_CATALOG: list[dict[str, Any]] = []
STREAM_SYMBOLS: tuple[str, ...] = ()
BASE_STREAM_SYMBOLS: tuple[str, ...] = ()
DYNAMIC_STREAM_SYMBOLS: tuple[str, ...] = ()
HISTORY_MESSAGES: list[str] = []
HISTORY_TASKS: dict[tuple[int, str], asyncio.Task[None]] = {}
MARKET_STATUSES: dict[str, dict[str, Any]] = {}
MARKET_STATUS_PATH: Path | None = None
MT5_TICK_TIME_OFFSET_SECONDS = 0
MT5_TICK_TIME_OFFSET_READY = False
# Broker/terminal UTC offsets cannot exceed the civil-time range. A larger
# tick-to-M1 delta is stale/cold history, not a timezone offset. Without this
# guard a cold terminal can shift every live tick by days until the bridge is
# restarted, making latest-history freshness evidence meaningless.
MAX_TICK_TIME_OFFSET_SECONDS = 14 * 3600
TICK_OFFSET_CURRENTNESS_TOLERANCE_SECONDS = 180
MT5_PRIORITY_TICK = 0
MT5_PRIORITY_CONTROL = 5
MT5_PRIORITY_HISTORY = 10


class MT5PriorityExecutor:
    """One MT5-affine worker with tick-first ordering for queued calls."""

    def __init__(self) -> None:
        self._queue: queue.PriorityQueue[
            tuple[int, int, Future[Any] | None, Callable[..., Any] | None, tuple[Any, ...]]
        ] = queue.PriorityQueue()
        self._sequence = count()
        self._lock = threading.Lock()
        self._shutdown = False
        self._thread = threading.Thread(
            target=self._run,
            name="mt5-worker",
            daemon=True,
        )
        self._thread.start()

    def submit(
        self,
        priority: int,
        func: Callable[..., Any],
        *args: Any,
    ) -> Future[Any]:
        with self._lock:
            if self._shutdown:
                raise RuntimeError("MT5 worker is shut down")
            future: Future[Any] = Future()
            self._queue.put((priority, next(self._sequence), future, func, args))
            return future

    def _run(self) -> None:
        while True:
            _, _, future, func, args = self._queue.get()
            try:
                if future is None or func is None:
                    return
                if not future.set_running_or_notify_cancel():
                    continue
                try:
                    future.set_result(func(*args))
                except BaseException as exc:  # propagate worker failures to asyncio.
                    future.set_exception(exc)
            finally:
                self._queue.task_done()

    def shutdown(self, wait: bool = True, cancel_futures: bool = False) -> None:
        with self._lock:
            if self._shutdown:
                return
            self._shutdown = True
            if cancel_futures:
                while True:
                    try:
                        _, _, future, _, _ = self._queue.get_nowait()
                    except queue.Empty:
                        break
                    if future is not None:
                        future.cancel()
                    self._queue.task_done()
            self._queue.put(
                (2**31 - 1, next(self._sequence), None, None, ()),
            )
        if wait:
            self._thread.join()


# MetaTrader5 calls remain strictly single-threaded. Priority changes only the
# order of work that has not started; a blocking call already inside MT5 cannot
# be preempted safely.
MT5_EXECUTOR = MT5PriorityExecutor()

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

# Nominal bar lengths used by freshness and Go-to look-ahead policy. "1m" is
# one minute while "1M" is one month; monthly freshness itself is calendar
# based in _minimum_fresh_bar_time rather than derived from this 31-day value.
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


def _minimum_fresh_bar_time(
    tick_time: int,
    timeframe: str,
    tf_seconds: int,
) -> int:
    """Return the oldest bar-open timestamp that can still be the current bar.

    Fixed-duration bars are broker aligned, so comparing age is safer than
    snapping the UTC epoch. A current bar must have opened less than one full
    interval before the newest MT5 tick. Monthly bars need calendar handling;
    the two-day allowance covers broker UTC offsets around the first day without
    accepting the previous month's bar.
    """
    if tick_time <= 0 or tf_seconds <= 0:
        return 0
    if timeframe == "1M":
        tick_dt = datetime.fromtimestamp(tick_time, timezone.utc)
        month_start = datetime(tick_dt.year, tick_dt.month, 1, tzinfo=timezone.utc)
        return max(1, int(month_start.timestamp()) - (2 * 86400))
    return max(1, tick_time - tf_seconds + 1)


def _history_freshness(
    rates: Any,
    symbol: str,
    timeframe: str,
    tf_seconds: int,
) -> HistoryFreshness:
    """Assess the latest rates against MT5's newest tick for every timeframe."""
    last_bar_time = 0
    if rates is not None and len(rates) > 0:
        last_bar_time = max(int(row["time"]) for row in rates)

    if tf_seconds <= 0:
        return HistoryFreshness(False, False, last_bar_time, 0)
    tick = mt5.symbol_info_tick(symbol)
    if tick is None or not getattr(tick, "time", 0):
        return HistoryFreshness(False, False, last_bar_time, 0)

    tick_time = normalize_mt5_tick_time(int(tick.time))
    minimum = _minimum_fresh_bar_time(tick_time, timeframe, tf_seconds)
    return HistoryFreshness(
        True,
        last_bar_time < minimum,
        last_bar_time,
        minimum,
    )


def _rates_are_fresh(
    rates: Any,
    symbol: str,
    timeframe: str,
    tf_seconds: int,
) -> bool:
    """Compatibility helper; unknown freshness is usable but not asserted."""
    freshness = _history_freshness(rates, symbol, timeframe, tf_seconds)
    return not freshness.known or not freshness.stale


def copy_rates_synced_blocking(
    symbol: str,
    mt5_timeframe: int,
    timeframe: str,
    limit: int,
    before: int = 0,
    refresh: bool = False,
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
        # Historical pages can be cold independently of the latest window.
        # Retry the same strict-before query while the terminal downloads that
        # part of the chart history; returning one transient empty page makes
        # the browser incorrectly conclude that pagination has ended.
        cursor = datetime.fromtimestamp(max(0, before - 1), timezone.utc)
        # Probe one extra bar so an exactly-full terminal boundary is not
        # mislabeled has_more=true. The response is trimmed back to limit in
        # load_history_message.
        probe_limit = limit + 1
        rates = mt5.copy_rates_from(symbol, mt5_timeframe, cursor, probe_limit)
        if rates is not None and len(rates) > 0:
            return rates
        for _ in range(HISTORY_SYNC_RETRIES):
            time.sleep(HISTORY_SYNC_DELAY)
            rates = mt5.copy_rates_from(symbol, mt5_timeframe, cursor, probe_limit)
            if rates is not None and len(rates) > 0:
                return rates
        return rates

    tf_seconds = TIMEFRAME_SECONDS.get(timeframe, 0)
    rates = mt5.copy_rates_from_pos(symbol, mt5_timeframe, 0, limit)
    if rates is not None and len(rates) > 0 and not refresh:
        if not _rates_are_fresh(rates, symbol, timeframe, tf_seconds):
            LOG.debug(
                "returning available MT5 history while terminal warms "
                "symbol=%s timeframe=%s bars=%d",
                symbol,
                timeframe,
                len(rates),
            )
        return rates

    if rates is not None and len(rates) > 0 and _rates_are_fresh(
        rates,
        symbol,
        timeframe,
        tf_seconds,
    ):
        return rates

    # Ordinary reads only retry empty responses. Explicit refreshes also retry a
    # non-empty stale window so refresh=true means "read through to the current
    # MT5 bar" for every supported timeframe. Keep the newest non-empty result
    # as a transparent stale fallback if the bounded warm-up budget is exhausted.
    best_rates = rates
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
            best_rates = rates
            if not refresh or _rates_are_fresh(
                rates,
                symbol,
                timeframe,
                tf_seconds,
            ):
                return rates
    return best_rates


def copy_rates_around_blocking(
    symbol: str,
    mt5_timeframe: int,
    timeframe: str,
    limit: int,
    requested_time: int,
) -> list[Any]:
    """Load deterministic context around a Go-to target.

    `copy_rates_from` is backward-looking, so using a guessed future `before`
    cursor can skip the target after a weekend. Load left context separately,
    then expand a forward range until the first tradable bars are available.
    """
    requested_time = max(1, int(requested_time))
    limit = max(1, min(int(limit), 5000))
    left_count = limit // 2
    right_count = max(1, limit - left_count)
    target = datetime.fromtimestamp(requested_time, timezone.utc)

    left_rates = mt5.copy_rates_from(
        symbol,
        mt5_timeframe,
        target,
        min(5000, left_count + 1),
    )
    left_candidates = [
        row
        for row in ([] if left_rates is None else left_rates)
        if int(row["time"]) < requested_time
    ]
    left = left_candidates[-left_count:] if left_count > 0 else []

    tf_seconds = max(1, TIMEFRAME_SECONDS.get(timeframe, 60))
    lookahead = max(tf_seconds * right_count, tf_seconds)
    max_lookahead = max(14 * 86400, lookahead * 4)
    right: list[Any] = []
    while True:
        range_end = datetime.fromtimestamp(
            requested_time + lookahead,
            timezone.utc,
        )
        right_rates = mt5.copy_rates_range(
            symbol,
            mt5_timeframe,
            target,
            range_end,
        )
        right = [
            row
            for row in ([] if right_rates is None else right_rates)
            if int(row["time"]) >= requested_time
        ]
        if len(right) >= right_count or lookahead >= max_lookahead:
            break
        lookahead = min(max_lookahead, lookahead * 2)

    selected = left + right[:right_count]
    by_time = {int(row["time"]): row for row in selected}
    return [by_time[key] for key in sorted(by_time)]


async def copy_rates_synced_worker(
    symbol: str,
    mt5_timeframe: int,
    timeframe: str,
    limit: int,
    before: int = 0,
    refresh: bool = False,
) -> Any:
    return await run_mt5_worker(
        copy_rates_synced_blocking,
        symbol,
        mt5_timeframe,
        timeframe,
        limit,
        before,
        refresh,
        priority=MT5_PRIORITY_HISTORY,
    )


def copy_selected_rates_synced_blocking(
    symbol: str,
    mt5_timeframe: int,
    timeframe: str,
    limit: int,
    before: int = 0,
    around: int = 0,
    refresh: bool = False,
) -> tuple[Any, str]:
    """Select and load one history window on the MT5-affine worker."""
    if not mt5.symbol_select(symbol, True):
        return None, f"symbol_select({symbol}) failed ({last_mt5_error()})"
    rates = (
        copy_rates_around_blocking(
            symbol,
            mt5_timeframe,
            timeframe,
            limit,
            around,
        )
        if around > 0
        else copy_rates_synced_blocking(
            symbol,
            mt5_timeframe,
            timeframe,
            limit,
            before,
            refresh,
        )
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
    around: int = 0,
    refresh: bool = False,
) -> tuple[Any, str]:
    return await run_mt5_worker(
        copy_selected_rates_synced_blocking,
        symbol,
        mt5_timeframe,
        timeframe,
        limit,
        before,
        around,
        refresh,
        priority=MT5_PRIORITY_HISTORY,
    )


async def run_mt5_worker(
    func: Callable[..., Any],
    *args: Any,
    priority: int = MT5_PRIORITY_CONTROL,
) -> Any:
    """Run a blocking call on the single priority-aware MT5 worker thread."""
    return await asyncio.wrap_future(MT5_EXECUTOR.submit(priority, func, *args))


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
    bar. Reject inferred offsets outside the civil UTC range because those are
    stale/cold M1 windows, not broker timezone offsets. If MT5 has not warmed
    usable M1 history yet, keep offset 0. Non-zero evidence must also normalize
    the tick close to the current Unix epoch; this prevents an intraday stale
    M1 row from masquerading as a plausible broker offset.
    """
    offsets: dict[int, int] = {}
    now = int(time.time())
    for symbol in symbols:
        tick = mt5.symbol_info_tick(symbol)
        if tick is None or not tick.time:
            continue

        rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, 1)
        if rates is None or len(rates) == 0:
            continue

        tick_time = int(tick.time)
        # MT5 currently returns this one-row request in chronological order,
        # but use the newest timestamp explicitly so a wrapper/order change
        # cannot infer a false broker offset.
        rate_time = max(int(row["time"]) for row in rates)
        delta = tick_time - rate_time
        if 0 <= delta < 180:
            offsets[0] = offsets.get(0, 0) + 1
            continue

        rounded = int(round(delta / 3600) * 3600)
        if abs(rounded) > MAX_TICK_TIME_OFFSET_SECONDS:
            continue
        normalized_tick = tick_time - rounded
        if (
            0 <= normalized_tick - rate_time < 180
            and abs(normalized_tick - now)
            <= TICK_OFFSET_CURRENTNESS_TOLERANCE_SECONDS
        ):
            offsets[rounded] = offsets.get(rounded, 0) + 1

    if not offsets:
        return 0
    # Any tie is ambiguous. Defaulting to zero is safer than shifting every
    # symbol based on conflicting terminal/cache evidence.
    max_votes = max(offsets.values())
    winners = [offset for offset, votes in offsets.items() if votes == max_votes]
    offset = winners[0] if len(winners) == 1 else 0
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


MARKET_STATUS_TIMESTAMP_FIELDS = (
    "session_open_at",
    "session_close_at",
    "next_open_at",
    "next_transition_at",
    "server_time",
    "observed_at",
    "valid_until",
)


def _status_int(value: Any) -> int:
    try:
        result = int(value or 0)
    except (TypeError, ValueError):
        return 0
    return max(0, result)


def unknown_market_status(
    symbol: str,
    reason: str = "session_helper_unavailable",
) -> dict[str, Any]:
    return {
        "symbol": symbol,
        "state": "unknown",
        "scheduled_open": False,
        "reason": reason,
        "session_open_at": 0,
        "session_close_at": 0,
        "next_open_at": 0,
        "next_transition_at": 0,
        "server_time": 0,
        "observed_at": 0,
        "valid_until": 0,
        "source": "mt5-mql5-session",
    }


def normalize_market_status_document(
    document: Any,
    now_seconds: int | None = None,
    max_age_seconds: int = 20,
) -> dict[str, dict[str, Any]]:
    """Validate the MQL5 helper document and fail closed to `unknown`.

    The native helper is the only component that can call
    SymbolInfoSessionTrade. Its file is intentionally treated as an expiring
    observation: a crashed helper or sleeping terminal must never leave an old
    `open` value alive in Go/the browser.
    """
    if not isinstance(document, dict):
        return {}
    raw_statuses = document.get("statuses")
    if not isinstance(raw_statuses, list):
        return {}

    now = int(time.time()) if now_seconds is None else int(now_seconds)
    source = str(document.get("source") or "mt5-mql5-session")
    normalized: dict[str, dict[str, Any]] = {}
    for raw in raw_statuses:
        if not isinstance(raw, dict):
            continue
        symbol = str(raw.get("symbol") or "").strip()
        if not symbol:
            continue
        state = str(raw.get("state") or "unknown").strip().lower()
        if state not in {"open", "closed", "unknown"}:
            state = "unknown"

        item: dict[str, Any] = {
            "symbol": symbol,
            "state": state,
            "scheduled_open": bool(raw.get("scheduled_open")) and state == "open",
            "reason": str(raw.get("reason") or ""),
            "source": source,
        }
        for field in MARKET_STATUS_TIMESTAMP_FIELDS:
            item[field] = _status_int(raw.get(field, document.get(field)))

        observed_at = item["observed_at"]
        valid_until = item["valid_until"] or observed_at + max_age_seconds
        item["valid_until"] = valid_until
        transition = item["next_transition_at"]
        open_boundary = max(item["session_close_at"], transition)
        inconsistent = (
            state == "open"
            and (
                not item["scheduled_open"]
                or item["server_time"] <= 0
                or open_boundary <= observed_at
            )
        )
        expired = (
            observed_at <= 0
            or observed_at > now + max_age_seconds
            or now - observed_at > max_age_seconds
            or valid_until <= now
            or (state in {"open", "closed"} and transition > 0 and transition <= now)
            or inconsistent
        )
        if expired:
            item.update(
                state="unknown",
                scheduled_open=False,
                reason=(
                    "session_helper_invalid"
                    if inconsistent
                    else "session_helper_stale"
                ),
                valid_until=0,
            )
        elif not item["reason"]:
            item["reason"] = (
                "within_trade_session"
                if item["state"] == "open"
                else "outside_trade_session"
                if item["state"] == "closed"
                else "schedule_unavailable"
            )
        normalized[symbol.upper()] = item
    return normalized


def resolve_market_status_path(cfg: Config) -> Path | None:
    if cfg.market_status_file:
        return Path(os.path.expandvars(cfg.market_status_file)).expanduser()
    terminal = mt5.terminal_info()
    common_path = str(getattr(terminal, "commondata_path", "") or "").strip()
    if not common_path:
        return None
    return Path(common_path) / "Files" / "MarketLens" / "market_sessions.json"


def read_market_status_file(
    path: Path | None,
    max_age_seconds: int,
    now_seconds: int | None = None,
) -> dict[str, dict[str, Any]]:
    if path is None:
        return {}
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {}
    return normalize_market_status_document(document, now_seconds, max_age_seconds)


def market_status_message(symbols: tuple[str, ...]) -> str:
    statuses = [
        dict(
            MARKET_STATUSES.get(symbol.upper())
            or unknown_market_status(symbol)
        )
        for symbol in symbols
    ]
    return json.dumps(
        {
            "type": "market_status",
            "source": "mt5-mql5-session",
            "statuses": statuses,
        },
        separators=(",", ":"),
    )


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
    global MT5_TICK_TIME_OFFSET_READY
    MT5_TICK_TIME_OFFSET_READY = bool(stream_symbols)

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
        await websocket.send(market_status_message(STREAM_SYMBOLS))
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
    if message_type == "stream.set":
        added, removed = await set_stream_symbols_worker(message.get("symbols"))
        if added or removed:
            await broadcast(symbol_catalog_message())
            for tick_message in await current_tick_messages_worker(added):
                await broadcast(tick_message)
            if added:
                await broadcast(market_status_message(added))
        return

    if message_type == "stream.subscribe":
        added = await add_stream_symbols_worker(message.get("symbols"))
        if added:
            await broadcast(symbol_catalog_message())
            for tick_message in await current_tick_messages_worker(added):
                await broadcast(tick_message)
            await broadcast(market_status_message(added))
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
    try:
        around = int(message.get("around") or 0)
    except (TypeError, ValueError):
        around = 0
    refresh = message.get("refresh") is True
    task_key = (id(websocket), request_id)
    previous = HISTORY_TASKS.pop(task_key, None)
    if previous is not None:
        previous.cancel()
    task = asyncio.create_task(
        send_history_response(
            websocket,
            symbol,
            timeframe,
            limit,
            request_id,
            before,
            around,
            refresh,
        )
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
    around: int = 0,
    refresh: bool = False,
) -> None:
    try:
        await websocket.send(
            await load_history_message(
                symbol,
                timeframe,
                limit,
                request_id,
                before,
                around,
                refresh,
            )
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
    return await run_mt5_worker(
        add_stream_symbols,
        raw_symbols,
        priority=MT5_PRIORITY_CONTROL,
    )


def set_stream_symbols(raw_symbols: Any) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Replace Go's dynamic symbol set while preserving configured base symbols."""
    global DYNAMIC_STREAM_SYMBOLS, STREAM_SYMBOLS
    global MT5_TICK_TIME_OFFSET_READY, MT5_TICK_TIME_OFFSET_SECONDS

    if not isinstance(raw_symbols, list):
        return (), ()

    available = {item["name"].upper(): item["name"] for item in SYMBOL_CATALOG}
    base_keys = {symbol.upper() for symbol in BASE_STREAM_SYMBOLS}
    current_dynamic_keys = {
        symbol.upper() for symbol in DYNAMIC_STREAM_SYMBOLS
    }
    desired: list[str] = []
    desired_keys: set[str] = set()
    for value in raw_symbols:
        if not isinstance(value, str):
            continue
        symbol = available.get(value.strip().upper())
        if not symbol:
            continue
        key = symbol.upper()
        if key in base_keys or key in desired_keys:
            continue
        if key not in current_dynamic_keys:
            if not mt5.symbol_select(symbol, True):
                LOG.warning("symbol_select(%s) failed (%s)", symbol, last_mt5_error())
                continue
        desired_keys.add(key)
        desired.append(symbol)

    previous = STREAM_SYMBOLS
    previous_keys = {symbol.upper() for symbol in previous}
    next_symbols = tuple([*BASE_STREAM_SYMBOLS, *desired])
    next_keys = {symbol.upper() for symbol in next_symbols}
    added = tuple(symbol for symbol in next_symbols if symbol.upper() not in previous_keys)
    removed = tuple(symbol for symbol in previous if symbol.upper() not in next_keys)
    if added and not MT5_TICK_TIME_OFFSET_READY:
        MT5_TICK_TIME_OFFSET_SECONDS = estimate_mt5_tick_time_offset(added)
        MT5_TICK_TIME_OFFSET_READY = True
    DYNAMIC_STREAM_SYMBOLS = tuple(desired)
    STREAM_SYMBOLS = next_symbols
    if added or removed:
        LOG.info(
            "set MT5 stream symbols count=%d added=%s removed=%s",
            len(STREAM_SYMBOLS),
            ",".join(added) if added else "(none)",
            ",".join(removed) if removed else "(none)",
        )
    return added, removed


async def set_stream_symbols_worker(
    raw_symbols: Any,
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    return await run_mt5_worker(
        set_stream_symbols,
        raw_symbols,
        priority=MT5_PRIORITY_CONTROL,
    )


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
    return await run_mt5_worker(
        current_tick_messages,
        symbols,
        priority=MT5_PRIORITY_TICK,
    )


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
    return await run_mt5_worker(
        changed_tick_messages,
        symbols,
        last_time_msc_by_symbol,
        priority=MT5_PRIORITY_TICK,
    )


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
    around: int = 0,
    refresh: bool = False,
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
    if around > 0:
        payload["requested_time"] = around
    if not symbol:
        payload["error"] = "symbol is required"
        return json.dumps(payload, separators=(",", ":"))
    if mt5_timeframe is None:
        payload["error"] = f"unsupported timeframe: {timeframe}"
        return json.dumps(payload, separators=(",", ":"))
    if before > 0 and around > 0:
        payload["error"] = "before and around cannot be used together"
        return json.dumps(payload, separators=(",", ":"))
    rates, error = await copy_selected_rates_synced_worker(
        symbol,
        mt5_timeframe,
        timeframe,
        limit,
        before,
        around,
        refresh,
    )
    if error:
        payload["error"] = error
        return json.dumps(payload, separators=(",", ":"))

    # MetaQuotes currently returns rates oldest-first, but normalize the bridge
    # boundary defensively so probe trimming and every downstream consumer use a
    # deterministic ascending series even if a terminal wrapper changes order.
    rates = sorted(rates, key=lambda row: int(row["time"]))
    cursor_has_more: bool | None = None
    if before > 0 and len(rates) > 0:
        # Keep the strict cursor contract even if a terminal wrapper returns a
        # boundary/future row despite the `before - 1s` request. Count and trim
        # only bars that the caller is allowed to receive.
        rates = [row for row in rates if int(row["time"]) < before]
        if rates:
            cursor_has_more = len(rates) > limit
            if cursor_has_more:
                rates = rates[-limit:]

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
    if before == 0 and around == 0:
        freshness = _history_freshness(
            rates,
            symbol,
            timeframe,
            TIMEFRAME_SECONDS.get(timeframe, 0),
        )
        payload["freshness_known"] = freshness.known
        payload["stale"] = freshness.known and freshness.stale
        if freshness.last_bar_time > 0:
            payload["last_bar_time"] = freshness.last_bar_time
        if freshness.minimum_fresh_bar_time > 0:
            payload["minimum_fresh_bar_time"] = freshness.minimum_fresh_bar_time
        if refresh and freshness.known and freshness.stale:
            payload["refresh_exhausted"] = True
    if cursor_has_more is not None:
        # The limit+1 probe distinguishes an exactly-full terminal boundary
        # from a page that truly has another bar to the left. An empty page stays
        # unannotated because cold MT5 history is indistinguishable from the
        # terminal boundary and must remain retryable in the browser.
        payload["has_more"] = cursor_has_more
    if around > 0:
        resolved = next(
            (
                int(row["time"])
                for row in rates
                if int(row["time"]) >= around
            ),
            0,
        )
        if resolved > 0:
            payload["resolved_time"] = resolved
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


def expire_market_status_cache(
    statuses: dict[str, dict[str, Any]],
    now_seconds: int,
    max_age_seconds: int,
) -> dict[str, dict[str, Any]]:
    return normalize_market_status_document(
        {
            "source": "mt5-mql5-session",
            "statuses": list(statuses.values()),
        },
        now_seconds,
        max_age_seconds,
    )


async def stream_market_status(cfg: Config, stop_event: asyncio.Event) -> None:
    """Watch the native MQL5 helper file and push snapshots/heartbeats to Go."""
    global MARKET_STATUSES

    last_message = ""
    sleep_seconds = cfg.market_status_poll_ms / 1000
    while not stop_event.is_set():
        now = int(time.time())
        loaded = read_market_status_file(
            MARKET_STATUS_PATH,
            cfg.market_status_max_age_seconds,
            now,
        )
        if loaded:
            MARKET_STATUSES = loaded
        elif MARKET_STATUSES:
            # A writer can be observed between truncate/write on Windows. Keep
            # the last valid observation through that tiny window, but expire it
            # deterministically if the helper stops refreshing.
            MARKET_STATUSES = expire_market_status_cache(
                MARKET_STATUSES,
                now,
                cfg.market_status_max_age_seconds,
            )

        message = market_status_message(STREAM_SYMBOLS)
        if message != last_message:
            await broadcast(message)
            last_message = message

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

    global SYMBOL_CATALOG, STREAM_SYMBOLS, BASE_STREAM_SYMBOLS
    global DYNAMIC_STREAM_SYMBOLS, HISTORY_MESSAGES
    global MARKET_STATUSES, MARKET_STATUS_PATH
    SYMBOL_CATALOG, STREAM_SYMBOLS = initialize_mt5(cfg)
    BASE_STREAM_SYMBOLS = STREAM_SYMBOLS
    DYNAMIC_STREAM_SYMBOLS = ()
    MARKET_STATUS_PATH = resolve_market_status_path(cfg)
    MARKET_STATUSES = read_market_status_file(
        MARKET_STATUS_PATH,
        cfg.market_status_max_age_seconds,
    )
    if MARKET_STATUS_PATH is None:
        LOG.warning("MT5 market-session helper path is unavailable")
    elif not MARKET_STATUSES:
        LOG.warning(
            "MT5 market-session helper has no fresh status file path=%s",
            MARKET_STATUS_PATH,
        )
    else:
        LOG.info(
            "loaded MT5 market-session statuses count=%d path=%s",
            len(MARKET_STATUSES),
            MARKET_STATUS_PATH,
        )
    HISTORY_MESSAGES = (
        await load_history_messages(STREAM_SYMBOLS, cfg.history_timeframes, cfg.history_bars)
        if cfg.preload_history
        else []
    )
    tick_task: asyncio.Task[None] | None = None
    market_status_task: asyncio.Task[None] | None = None
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
            market_status_task = asyncio.create_task(
                stream_market_status(cfg, stop_event)
            )
            await stop_event.wait()
    finally:
        if market_status_task:
            market_status_task.cancel()
            try:
                await market_status_task
            except asyncio.CancelledError:
                pass
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
