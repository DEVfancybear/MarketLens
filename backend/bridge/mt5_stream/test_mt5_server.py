import asyncio
import json
import sys
import threading
import time
import types
import unittest
from types import SimpleNamespace


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

    def test_calendar_timeframe_freshness_uses_variable_windows(self) -> None:
        tick_time = 1_800_000_000
        mt5_server.mt5.symbol_info_tick = lambda _symbol: SimpleNamespace(
            time=tick_time
        )

        self.assertTrue(
            mt5_server._rates_are_fresh(
                [{"time": tick_time - (40 * 86400)}],
                "NZDJPY",
                "1M",
                mt5_server.TIMEFRAME_SECONDS["1M"],
            )
        )
        self.assertFalse(
            mt5_server._rates_are_fresh(
                [{"time": tick_time - (70 * 86400)}],
                "NZDJPY",
                "1M",
                mt5_server.TIMEFRAME_SECONDS["1M"],
            )
        )
        self.assertTrue(
            mt5_server._rates_are_fresh(
                [{"time": tick_time - (10 * 86400)}],
                "NZDJPY",
                "1W",
                mt5_server.TIMEFRAME_SECONDS["1W"],
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

    def test_older_history_retries_a_transient_empty_window(self) -> None:
        requested = [
            {"time": 1_700_000_000},
            {"time": 1_700_000_060},
        ]
        calls = 0

        def copy_rates(
            _symbol: str,
            _timeframe: int,
            _cursor: object,
            _limit: int,
        ) -> list[dict[str, int]]:
            nonlocal calls
            calls += 1
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
