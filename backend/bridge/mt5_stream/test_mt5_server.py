import asyncio
import json
import sys
import threading
import time
import types
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch


class MetaTrader5Stub(types.ModuleType):
    TIMEFRAME_M1 = 1
    TIMEFRAME_M3 = 3
    TIMEFRAME_M5 = 5
    TIMEFRAME_M15 = 15
    TIMEFRAME_M30 = 30
    TIMEFRAME_H1 = 60
    TIMEFRAME_H2 = 120
    TIMEFRAME_H4 = 240
    TIMEFRAME_D1 = 1440
    TIMEFRAME_W1 = 10080
    TIMEFRAME_MN1 = 43200

    def __init__(self) -> None:
        super().__init__("MetaTrader5")
        self.symbol_info_tick = lambda _symbol: None
        self.symbol_select = lambda _symbol, _visible: True
        self.last_error = lambda: (0, "ok")


# The bridge module imports MetaTrader5 at import time. Stub it before import so
# these unit tests run on CI/dev machines without a local MT5 terminal.
sys.modules["MetaTrader5"] = MetaTrader5Stub()

from bridge.mt5_stream import mt5_server  # noqa: E402


class Mt5ServerTickTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_symbol_info_tick = mt5_server.mt5.symbol_info_tick
        self.original_symbol_select = mt5_server.mt5.symbol_select
        self.original_copy_rates_from_pos = getattr(
            mt5_server.mt5, "copy_rates_from_pos", None
        )
        self.original_copy_rates_from = getattr(mt5_server.mt5, "copy_rates_from", None)
        self.original_copy_rates_range = getattr(
            mt5_server.mt5, "copy_rates_range", None
        )
        self.original_catalog = list(mt5_server.SYMBOL_CATALOG)
        self.original_stream_symbols = tuple(mt5_server.STREAM_SYMBOLS)
        self.original_tick_offset = mt5_server.MT5_TICK_TIME_OFFSET_SECONDS
        self.original_history_sync_delay = mt5_server.HISTORY_SYNC_DELAY
        self.original_market_statuses = dict(mt5_server.MARKET_STATUSES)

    def tearDown(self) -> None:
        mt5_server.mt5.symbol_info_tick = self.original_symbol_info_tick
        mt5_server.mt5.symbol_select = self.original_symbol_select
        if (
            self.original_copy_rates_from_pos is None
            and hasattr(mt5_server.mt5, "copy_rates_from_pos")
        ):
            delattr(mt5_server.mt5, "copy_rates_from_pos")
        elif self.original_copy_rates_from_pos is not None:
            mt5_server.mt5.copy_rates_from_pos = self.original_copy_rates_from_pos
        if (
            self.original_copy_rates_from is None
            and hasattr(mt5_server.mt5, "copy_rates_from")
        ):
            delattr(mt5_server.mt5, "copy_rates_from")
        elif self.original_copy_rates_from is not None:
            mt5_server.mt5.copy_rates_from = self.original_copy_rates_from
        if (
            self.original_copy_rates_range is None
            and hasattr(mt5_server.mt5, "copy_rates_range")
        ):
            delattr(mt5_server.mt5, "copy_rates_range")
        elif self.original_copy_rates_range is not None:
            mt5_server.mt5.copy_rates_range = self.original_copy_rates_range
        mt5_server.SYMBOL_CATALOG = self.original_catalog
        mt5_server.STREAM_SYMBOLS = self.original_stream_symbols
        mt5_server.MT5_TICK_TIME_OFFSET_SECONDS = self.original_tick_offset
        mt5_server.HISTORY_SYNC_DELAY = self.original_history_sync_delay
        mt5_server.MARKET_STATUSES = self.original_market_statuses

    def test_changed_tick_messages_dedupes_and_normalizes_tick_time(self) -> None:
        ticks = {
            "EURUSD": SimpleNamespace(
                bid=1.10001,
                ask=1.10013,
                time=7200,
                time_msc=7_200_250,
            ),
            "GBPUSD": SimpleNamespace(
                bid=1.27001,
                ask=1.27014,
                time=7300,
                time_msc=7_300_250,
            ),
        }
        mt5_server.mt5.symbol_info_tick = lambda symbol: ticks.get(symbol)
        mt5_server.MT5_TICK_TIME_OFFSET_SECONDS = 3600

        messages, seen = mt5_server.changed_tick_messages(
            ("EURUSD", "GBPUSD"),
            {"GBPUSD": 7_300_250},
        )

        self.assertEqual(len(messages), 1)
        payload = json.loads(messages[0])
        self.assertEqual(payload["type"], "tick")
        self.assertEqual(payload["source"], "mt5")
        self.assertEqual(payload["symbol"], "EURUSD")
        self.assertEqual(payload["timestamp"], 3600)
        self.assertEqual(payload["time_msc"], 3_600_250)
        self.assertEqual(seen["EURUSD"], 7_200_250)
        self.assertEqual(seen["GBPUSD"], 7_300_250)

    def test_add_stream_symbols_selects_only_catalog_symbols_not_already_streamed(self) -> None:
        mt5_server.SYMBOL_CATALOG = [
            {"name": "EURUSD"},
            {"name": "XAUUSD"},
        ]
        mt5_server.STREAM_SYMBOLS = ("EURUSD",)
        selected: list[tuple[str, bool]] = []
        mt5_server.mt5.symbol_select = (
            lambda symbol, visible: selected.append((symbol, visible)) or True
        )

        added = mt5_server.add_stream_symbols(["xauusd", "missing", "EURUSD"])

        self.assertEqual(added, ("XAUUSD",))
        self.assertEqual(mt5_server.STREAM_SYMBOLS, ("EURUSD", "XAUUSD"))
        self.assertEqual(selected, [("XAUUSD", True)])

    def test_market_status_document_keeps_fresh_broker_session(self) -> None:
        now = 1_800_000_000
        statuses = mt5_server.normalize_market_status_document(
            {
                "source": "mt5-mql5-session",
                "statuses": [{
                    "symbol": "EURUSD",
                    "state": "open",
                    "scheduled_open": True,
                    "reason": "within_trade_session",
                    "session_open_at": now - 3600,
                    "session_close_at": now + 7200,
                    "next_transition_at": now + 7200,
                    "server_time": now - 2,
                    "observed_at": now - 2,
                    "valid_until": now + 10,
                }],
            },
            now_seconds=now,
            max_age_seconds=20,
        )

        self.assertEqual(statuses["EURUSD"]["state"], "open")
        self.assertTrue(statuses["EURUSD"]["scheduled_open"])
        self.assertEqual(statuses["EURUSD"]["next_transition_at"], now + 7200)

    def test_market_status_document_expires_stale_open_and_boundary(self) -> None:
        now = 1_800_000_000
        base = {
            "symbol": "EURUSD",
            "state": "open",
            "scheduled_open": True,
            "server_time": now - 1,
            "observed_at": now - 30,
            "valid_until": now + 30,
            "next_transition_at": now + 3600,
        }
        stale = mt5_server.normalize_market_status_document(
            {"statuses": [base]},
            now_seconds=now,
            max_age_seconds=20,
        )["EURUSD"]
        boundary = mt5_server.normalize_market_status_document(
            {"statuses": [{
                **base,
                "observed_at": now - 1,
                "next_transition_at": now,
            }]},
            now_seconds=now,
            max_age_seconds=20,
        )["EURUSD"]

        self.assertEqual(stale["state"], "unknown")
        self.assertEqual(stale["reason"], "session_helper_stale")
        self.assertEqual(boundary["state"], "unknown")

    def test_market_status_document_rejects_incomplete_open_claim(self) -> None:
        now = 1_800_000_000
        invalid = mt5_server.normalize_market_status_document(
            {
                "statuses": [{
                    "symbol": "EURUSD",
                    "state": "open",
                    "scheduled_open": False,
                    "server_time": now,
                    "observed_at": now,
                    "valid_until": now + 10,
                }],
            },
            now_seconds=now,
            max_age_seconds=20,
        )["EURUSD"]

        self.assertEqual(invalid["state"], "unknown")
        self.assertEqual(invalid["reason"], "session_helper_invalid")

    def test_market_status_message_fills_missing_symbol_with_unknown(self) -> None:
        mt5_server.MARKET_STATUSES = {
            "EURUSD": {
                **mt5_server.unknown_market_status("EURUSD"),
                "state": "closed",
                "reason": "outside_trade_session",
            }
        }

        payload = json.loads(
            mt5_server.market_status_message(("EURUSD", "XAUUSD"))
        )

        self.assertEqual(payload["type"], "market_status")
        self.assertEqual(payload["statuses"][0]["state"], "closed")
        self.assertEqual(payload["statuses"][1]["symbol"], "XAUUSD")
        self.assertEqual(payload["statuses"][1]["state"], "unknown")

    def test_tick_offset_estimator_ignores_cold_multiday_m1_history(self) -> None:
        tick_time = 2_000_000
        stale_delta = (8 * 86400) + 50
        ticks = {
            symbol: SimpleNamespace(time=tick_time)
            for symbol in ("EURUSD", "GBPUSD", "USDCHF")
        }
        rate_times = {
            "EURUSD": tick_time - 50,
            "GBPUSD": tick_time - stale_delta,
            "USDCHF": tick_time - stale_delta,
        }
        mt5_server.mt5.symbol_info_tick = lambda symbol: ticks[symbol]
        mt5_server.mt5.copy_rates_from_pos = (
            lambda symbol, *_args: [{"time": rate_times[symbol]}]
        )

        self.assertEqual(
            mt5_server.estimate_mt5_tick_time_offset(tuple(ticks)),
            0,
        )

    def test_tick_offset_estimator_ignores_plausible_intraday_stale_history(self) -> None:
        tick_time = 2_000_000
        mt5_server.mt5.symbol_info_tick = lambda _symbol: SimpleNamespace(
            time=tick_time
        )
        mt5_server.mt5.copy_rates_from_pos = lambda *_args: [
            {"time": tick_time - (3 * 3600) - 50}
        ]

        with patch.object(mt5_server.time, "time", return_value=tick_time):
            self.assertEqual(
                mt5_server.estimate_mt5_tick_time_offset(("EURUSD", "USDCHF")),
                0,
            )

    def test_tick_offset_estimator_keeps_plausible_broker_offset(self) -> None:
        tick_time = 2_000_000
        for expected_offset in (3 * 3600, -5 * 3600):
            with self.subTest(expected_offset=expected_offset):
                mt5_server.mt5.symbol_info_tick = lambda _symbol: SimpleNamespace(
                    time=tick_time
                )
                mt5_server.mt5.copy_rates_from_pos = lambda *_args: [
                    {"time": tick_time - expected_offset - 50}
                ]

                with patch.object(
                    mt5_server.time,
                    "time",
                    return_value=tick_time - expected_offset,
                ):
                    self.assertEqual(
                        mt5_server.estimate_mt5_tick_time_offset(
                            ("EURUSD", "USDCHF")
                        ),
                        expected_offset,
                    )

    def test_tick_offset_estimator_defaults_to_zero_on_conflicting_tie(self) -> None:
        now = 2_000_000
        ticks = {
            "EURUSD": SimpleNamespace(time=now + (3 * 3600)),
            "USDCHF": SimpleNamespace(time=now - (5 * 3600)),
        }
        mt5_server.mt5.symbol_info_tick = lambda symbol: ticks[symbol]
        mt5_server.mt5.copy_rates_from_pos = lambda *_args: [
            {"time": now - 50}
        ]

        with patch.object(mt5_server.time, "time", return_value=now):
            self.assertEqual(
                mt5_server.estimate_mt5_tick_time_offset(tuple(ticks)),
                0,
            )

    def test_freshness_requires_current_bar_for_every_timeframe(self) -> None:
        tick_time = int(datetime(2026, 7, 22, 12, tzinfo=timezone.utc).timestamp())
        mt5_server.mt5.symbol_info_tick = lambda _symbol: SimpleNamespace(
            time=tick_time
        )

        for timeframe in (
            "1m",
            "3m",
            "5m",
            "15m",
            "30m",
            "1H",
            "2H",
            "4H",
            "1D",
            "1W",
        ):
            step = mt5_server.TIMEFRAME_SECONDS[timeframe]
            with self.subTest(timeframe=timeframe):
                self.assertTrue(
                    mt5_server._rates_are_fresh(
                        [{"time": tick_time - (step // 2)}],
                        "NZDJPY",
                        timeframe,
                        step,
                    )
                )
                self.assertFalse(
                    mt5_server._rates_are_fresh(
                        [{"time": tick_time - step}],
                        "NZDJPY",
                        timeframe,
                        step,
                    )
                )

        month_start = int(datetime(2026, 7, 1, tzinfo=timezone.utc).timestamp())
        self.assertTrue(
            mt5_server._rates_are_fresh(
                [{"time": month_start - (2 * 3600)}],
                "NZDJPY",
                "1M",
                mt5_server.TIMEFRAME_SECONDS["1M"],
            )
        )
        self.assertFalse(
            mt5_server._rates_are_fresh(
                [{"time": int(datetime(2026, 6, 1, tzinfo=timezone.utc).timestamp())}],
                "NZDJPY",
                "1M",
                mt5_server.TIMEFRAME_SECONDS["1M"],
            )
        )

    def test_freshness_uses_normalized_tick_offset_and_newest_unsorted_rate(self) -> None:
        normalized_tick = int(datetime(2026, 7, 22, 12, tzinfo=timezone.utc).timestamp())
        mt5_server.MT5_TICK_TIME_OFFSET_SECONDS = 3600
        mt5_server.mt5.symbol_info_tick = lambda _symbol: SimpleNamespace(
            time=normalized_tick + 3600
        )

        self.assertTrue(
            mt5_server._rates_are_fresh(
                [
                    {"time": normalized_tick - 300},
                    {"time": normalized_tick - 900},
                ],
                "EURUSD",
                "15m",
                mt5_server.TIMEFRAME_SECONDS["15m"],
            )
        )

    def test_monthly_freshness_handles_leap_and_year_boundaries(self) -> None:
        for tick_dt in (
            datetime(2024, 2, 29, 12, tzinfo=timezone.utc),
            datetime(2025, 1, 1, 0, tzinfo=timezone.utc),
            datetime(2026, 12, 31, 23, tzinfo=timezone.utc),
        ):
            tick_time = int(tick_dt.timestamp())
            mt5_server.mt5.symbol_info_tick = lambda _symbol, time=tick_time: SimpleNamespace(
                time=time
            )
            minimum = mt5_server._minimum_fresh_bar_time(
                tick_time,
                "1M",
                mt5_server.TIMEFRAME_SECONDS["1M"],
            )
            self.assertTrue(
                mt5_server._rates_are_fresh(
                    [{"time": minimum}],
                    "EURUSD",
                    "1M",
                    mt5_server.TIMEFRAME_SECONDS["1M"],
                )
            )
            self.assertFalse(
                mt5_server._rates_are_fresh(
                    [{"time": minimum - 1}],
                    "EURUSD",
                    "1M",
                    mt5_server.TIMEFRAME_SECONDS["1M"],
                )
            )

    def test_non_empty_stale_history_returns_without_warmup_retry(self) -> None:
        rates = [{"time": 1_700_000_000}]
        mt5_server.mt5.symbol_info_tick = lambda _symbol: SimpleNamespace(
            time=1_800_000_000
        )
        mt5_server.mt5.copy_rates_from_pos = (
            lambda _symbol, _timeframe, _start, _limit: rates
        )

        def unexpected_warmup(*_args: object) -> None:
            self.fail("non-empty history must not enter the blocking warm-up loop")

        mt5_server.mt5.copy_rates_from = unexpected_warmup

        result = mt5_server.copy_rates_synced_blocking(
            "ETHUSD",
            mt5_server.TIMEFRAME_MAP["15m"],
            "15m",
            900,
        )

        self.assertIs(result, rates)

    def test_explicit_refresh_retries_non_empty_stale_history(self) -> None:
        tick_time = 1_800_000_900
        stale_rates = [{"time": tick_time - 900}]
        fresh_rates = [{"time": tick_time - 300}]
        calls = 0
        warmups = 0
        mt5_server.HISTORY_SYNC_DELAY = 0
        mt5_server.mt5.symbol_info_tick = lambda _symbol: SimpleNamespace(
            time=tick_time
        )

        def copy_from_pos(*_args: object) -> list[dict[str, int]]:
            nonlocal calls
            calls += 1
            return stale_rates if calls == 1 else fresh_rates

        def warmup(*_args: object) -> list[dict[str, int]]:
            nonlocal warmups
            warmups += 1
            return []

        mt5_server.mt5.copy_rates_from_pos = copy_from_pos
        mt5_server.mt5.copy_rates_from = warmup

        result = mt5_server.copy_rates_synced_blocking(
            "EURUSD",
            mt5_server.TIMEFRAME_MAP["15m"],
            "15m",
            100,
            refresh=True,
        )

        self.assertIs(result, fresh_rates)
        self.assertEqual(calls, 2)
        self.assertEqual(warmups, 1)

    def test_explicit_refresh_returns_best_stale_window_after_bounded_retries(self) -> None:
        tick_time = 1_800_000_900
        stale_rates = [{"time": tick_time - 900}]
        calls = 0
        mt5_server.HISTORY_SYNC_DELAY = 0
        mt5_server.mt5.symbol_info_tick = lambda _symbol: SimpleNamespace(
            time=tick_time
        )

        def copy_from_pos(*_args: object) -> list[dict[str, int]]:
            nonlocal calls
            calls += 1
            return stale_rates

        mt5_server.mt5.copy_rates_from_pos = copy_from_pos
        mt5_server.mt5.copy_rates_from = lambda *_args: []

        result = mt5_server.copy_rates_synced_blocking(
            "EURUSD",
            mt5_server.TIMEFRAME_MAP["15m"],
            "15m",
            100,
            refresh=True,
        )

        self.assertIs(result, stale_rates)
        self.assertEqual(calls, 1 + mt5_server.HISTORY_SYNC_RETRIES)

    def test_older_history_retries_a_transient_empty_window(self) -> None:
        requested = [
            {"time": 1_700_000_000},
            {"time": 1_700_000_060},
        ]
        calls = 0
        requested_limits: list[int] = []

        def copy_rates(
            _symbol: str,
            _timeframe: int,
            _cursor: object,
            _limit: int,
        ) -> list[dict[str, int]]:
            nonlocal calls
            calls += 1
            requested_limits.append(_limit)
            return [] if calls == 1 else requested

        mt5_server.HISTORY_SYNC_DELAY = 0
        mt5_server.mt5.copy_rates_from = copy_rates

        result = mt5_server.copy_rates_synced_blocking(
            "EURUSD",
            mt5_server.TIMEFRAME_MAP["15m"],
            "15m",
            100,
            before=1_700_001_000,
        )

        self.assertIs(result, requested)
        self.assertEqual(calls, 2)
        self.assertEqual(requested_limits, [101, 101])

    def test_history_around_expands_forward_and_keeps_target_context(self) -> None:
        requested_time = 1_800_000_000
        mt5_server.mt5.copy_rates_from = (
            lambda _symbol, _timeframe, _target, _limit: [
                {"time": requested_time - 120},
                {"time": requested_time - 60},
            ]
        )
        calls: list[tuple[object, object]] = []

        def copy_range(
            _symbol: str,
            _timeframe: int,
            start: object,
            end: object,
        ) -> list[dict[str, int]]:
            calls.append((start, end))
            if len(calls) == 1:
                return []
            return [
                {"time": requested_time + 60},
                {"time": requested_time + 120},
            ]

        mt5_server.mt5.copy_rates_range = copy_range

        result = mt5_server.copy_rates_around_blocking(
            "EURUSD",
            mt5_server.TIMEFRAME_MAP["1m"],
            "1m",
            4,
            requested_time,
        )

        self.assertEqual(
            [row["time"] for row in result],
            [
                requested_time - 120,
                requested_time - 60,
                requested_time + 60,
                requested_time + 120,
            ],
        )
        self.assertEqual(len(calls), 2)


class Mt5ServerWorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_cursor_history_payload_reports_has_more(self) -> None:
        original_loader = mt5_server.copy_selected_rates_synced_worker
        requested_time = 1_800_000_000

        async def fake_loader(*_args: object) -> tuple[list[dict[str, float]], str]:
            return ([
                {
                    "time": requested_time - 60,
                    "open": 1.0,
                    "high": 1.1,
                    "low": 0.9,
                    "close": 1.05,
                    "tick_volume": 10,
                }
            ], "")

        mt5_server.copy_selected_rates_synced_worker = fake_loader
        try:
            payload = json.loads(
                await mt5_server.load_history_message(
                    "EURUSD",
                    "1m",
                    4,
                    "hist-before",
                    before=requested_time,
                )
            )
        finally:
            mt5_server.copy_selected_rates_synced_worker = original_loader

        self.assertFalse(payload["has_more"])

    async def test_exact_full_cursor_page_is_terminal_but_extra_probe_bar_has_more(self) -> None:
        original_loader = mt5_server.copy_selected_rates_synced_worker
        requested_time = 1_800_000_000

        def candle(index: int) -> dict[str, float]:
            return {
                "time": requested_time - ((5 - index) * 60),
                "open": 1.0,
                "high": 1.1,
                "low": 0.9,
                "close": 1.05,
                "tick_volume": 10,
            }

        for returned_count, expected_more, expected_first in (
            (4, False, requested_time - (5 * 60)),
            (5, True, requested_time - (4 * 60)),
        ):
            with self.subTest(returned_count=returned_count):
                async def fake_loader(
                    *_args: object,
                    count: int = returned_count,
                ) -> tuple[list[dict[str, float]], str]:
                    return ([candle(index) for index in range(count)], "")

                mt5_server.copy_selected_rates_synced_worker = fake_loader
                try:
                    payload = json.loads(
                        await mt5_server.load_history_message(
                            "EURUSD",
                            "1m",
                            4,
                            f"hist-before-{returned_count}",
                            before=requested_time,
                        )
                    )
                finally:
                    mt5_server.copy_selected_rates_synced_worker = original_loader

                self.assertEqual(payload["has_more"], expected_more)
                self.assertEqual(len(payload["candles"]), 4)
                self.assertEqual(payload["candles"][0]["time"], expected_first)

    async def test_empty_cursor_history_keeps_boundary_retryable(self) -> None:
        original_loader = mt5_server.copy_selected_rates_synced_worker

        async def fake_loader(*_args: object) -> tuple[list[dict[str, float]], str]:
            return ([], "")

        mt5_server.copy_selected_rates_synced_worker = fake_loader
        try:
            payload = json.loads(
                await mt5_server.load_history_message(
                    "EURUSD",
                    "1H",
                    100,
                    "hist-empty-before",
                    before=1_800_000_000,
                )
            )
        finally:
            mt5_server.copy_selected_rates_synced_worker = original_loader

        self.assertNotIn("has_more", payload)

    async def test_cursor_payload_filters_boundary_rows_before_counting_more(self) -> None:
        original_loader = mt5_server.copy_selected_rates_synced_worker
        requested_time = 1_800_000_000

        async def fake_loader(*_args: object) -> tuple[list[dict[str, float]], str]:
            return ([
                {
                    "time": requested_time - 120,
                    "open": 1.0,
                    "high": 1.1,
                    "low": 0.9,
                    "close": 1.05,
                    "tick_volume": 10,
                },
                {
                    # A defensive wrapper may accidentally include the cursor;
                    # it must never turn a terminal page into has_more=true.
                    "time": requested_time,
                    "open": 9.0,
                    "high": 9.1,
                    "low": 8.9,
                    "close": 9.05,
                    "tick_volume": 99,
                },
            ], "")

        mt5_server.copy_selected_rates_synced_worker = fake_loader
        try:
            payload = json.loads(
                await mt5_server.load_history_message(
                    "EURUSD",
                    "1m",
                    1,
                    "hist-boundary",
                    before=requested_time,
                )
            )
        finally:
            mt5_server.copy_selected_rates_synced_worker = original_loader

        self.assertFalse(payload["has_more"])
        self.assertEqual(
            [candle["time"] for candle in payload["candles"]],
            [requested_time - 120],
        )

    async def test_cursor_payload_keeps_all_boundary_rows_retryable(self) -> None:
        original_loader = mt5_server.copy_selected_rates_synced_worker
        requested_time = 1_800_000_000

        async def fake_loader(*_args: object) -> tuple[list[dict[str, float]], str]:
            return ([
                {
                    "time": requested_time,
                    "open": 1.0,
                    "high": 1.1,
                    "low": 0.9,
                    "close": 1.05,
                    "tick_volume": 10,
                }
            ], "")

        mt5_server.copy_selected_rates_synced_worker = fake_loader
        try:
            payload = json.loads(
                await mt5_server.load_history_message(
                    "EURUSD",
                    "1m",
                    1,
                    "hist-boundary-only",
                    before=requested_time,
                )
            )
        finally:
            mt5_server.copy_selected_rates_synced_worker = original_loader

        self.assertEqual(payload["candles"], [])
        self.assertNotIn("has_more", payload)

    async def test_explicit_refresh_payload_reports_exhausted_freshness(self) -> None:
        original_loader = mt5_server.copy_selected_rates_synced_worker
        original_tick = mt5_server.mt5.symbol_info_tick
        tick_time = 1_800_000_900

        async def fake_loader(*_args: object) -> tuple[list[dict[str, float]], str]:
            return ([
                {
                    "time": tick_time - 900,
                    "open": 1.0,
                    "high": 1.1,
                    "low": 0.9,
                    "close": 1.05,
                    "tick_volume": 10,
                }
            ], "")

        mt5_server.copy_selected_rates_synced_worker = fake_loader
        mt5_server.mt5.symbol_info_tick = lambda _symbol: SimpleNamespace(
            time=tick_time
        )
        try:
            payload = json.loads(
                await mt5_server.load_history_message(
                    "EURUSD",
                    "15m",
                    100,
                    "hist-refresh",
                    refresh=True,
                )
            )
        finally:
            mt5_server.copy_selected_rates_synced_worker = original_loader
            mt5_server.mt5.symbol_info_tick = original_tick

        self.assertTrue(payload["freshness_known"])
        self.assertTrue(payload["stale"])
        self.assertTrue(payload["refresh_exhausted"])
        self.assertEqual(payload["last_bar_time"], tick_time - 900)
        self.assertEqual(payload["minimum_fresh_bar_time"], tick_time - 899)

    async def test_history_around_payload_reports_requested_and_resolved_time(self) -> None:
        original_loader = mt5_server.copy_selected_rates_synced_worker
        requested_time = 1_800_000_000

        async def fake_loader(*_args: object) -> tuple[list[dict[str, float]], str]:
            return ([
                {
                    "time": requested_time - 60,
                    "open": 1.0,
                    "high": 1.1,
                    "low": 0.9,
                    "close": 1.05,
                    "tick_volume": 10,
                },
                {
                    "time": requested_time + 60,
                    "open": 1.05,
                    "high": 1.2,
                    "low": 1.0,
                    "close": 1.15,
                    "tick_volume": 20,
                },
            ], "")

        mt5_server.copy_selected_rates_synced_worker = fake_loader
        try:
            payload = json.loads(
                await mt5_server.load_history_message(
                    "EURUSD",
                    "1m",
                    4,
                    "hist-around",
                    around=requested_time,
                )
            )
        finally:
            mt5_server.copy_selected_rates_synced_worker = original_loader

        self.assertEqual(payload["requested_time"], requested_time)
        self.assertEqual(payload["resolved_time"], requested_time + 60)
        self.assertEqual(len(payload["candles"]), 2)

    async def test_tick_snapshot_worker_does_not_block_asyncio_loop(self) -> None:
        original_current_tick_messages = mt5_server.current_tick_messages
        worker_threads: list[int] = []

        def blocking_snapshot(_symbols: tuple[str, ...]) -> list[str]:
            worker_threads.append(threading.get_ident())
            time.sleep(0.08)
            return ["snapshot"]

        mt5_server.current_tick_messages = blocking_snapshot
        try:
            started = time.perf_counter()
            task = asyncio.create_task(
                mt5_server.current_tick_messages_worker(("EURUSD",)),
            )
            await asyncio.sleep(0.01)

            self.assertLess(time.perf_counter() - started, 0.05)
            self.assertFalse(task.done())
            self.assertEqual(await task, ["snapshot"])
            self.assertTrue(worker_threads)
            self.assertNotEqual(worker_threads[0], threading.get_ident())
        finally:
            mt5_server.current_tick_messages = original_current_tick_messages

    async def test_history_cancel_removes_queued_request_task(self) -> None:
        websocket = SimpleNamespace()
        task = asyncio.create_task(asyncio.sleep(10))
        key = (id(websocket), "hist-cancel-me")
        mt5_server.HISTORY_TASKS[key] = task

        await mt5_server.handle_client_message(
            websocket,
            json.dumps({"type": "history.cancel", "id": "hist-cancel-me"}),
        )
        await asyncio.sleep(0)

        self.assertNotIn(key, mt5_server.HISTORY_TASKS)
        self.assertTrue(task.cancelled())


if __name__ == "__main__":
    unittest.main()
