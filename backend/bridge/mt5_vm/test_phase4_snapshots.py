from __future__ import annotations

import unittest
from types import SimpleNamespace

from . import phase4_snapshots as snapshots


def account(**overrides):
    base = dict(
        currency="usd",
        leverage=100,
        balance=10000.0,
        equity=10012.5,
        margin=250.0,
        margin_free=9762.5,
        margin_level=4005.0,
        margin_mode=2,
        trade_mode=0,
        trade_allowed=True,
        server="  FTMO-Demo ",
        login=12344321,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def position(**overrides):
    base = dict(
        ticket=123456789,
        symbol="EURUSD",
        type=0,
        volume=0.10,
        price_open=1.08512,
        price_current=1.08600,
        sl=1.08000,
        tp=1.09000,
        swap=-0.12,
        profit=8.80,
        magic=0,
        time=1760000000,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def pending(**overrides):
    base = dict(
        ticket=987654321,
        symbol="XAUUSD",
        type=2,
        volume_current=0.05,
        volume_initial=0.05,
        price_open=2400.0,
        price_stoplimit=0.0,
        sl=0.0,
        tp=0.0,
        type_time=0,
        magic=7,
        time_setup=1760000000,
        time_expiration=0,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def instrument(**overrides):
    base = dict(
        name="EURUSD",
        digits=5,
        point=0.00001,
        trade_tick_size=0.00001,
        trade_tick_value=1.0,
        trade_contract_size=100000.0,
        volume_min=0.01,
        volume_max=500.0,
        volume_step=0.01,
        trade_stops_level=10,
        trade_freeze_level=0,
        filling_mode=3,
        trade_mode=4,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def history_order(**overrides):
    base = dict(
        ticket=13579,
        position_id=24680,
        symbol="EURUSD",
        type=0,
        state=4,
        volume_initial=0.10,
        volume_current=0.0,
        price_open=1.08512,
        price_current=1.08600,
        sl=1.08000,
        tp=1.09000,
        time_setup=1760000000,
        time_done=1760000060,
        magic=7,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def deal(**overrides):
    base = dict(
        ticket=97531,
        order=13579,
        position_id=24680,
        symbol="EURUSD",
        type=0,
        entry=0,
        volume=0.10,
        price=1.08600,
        commission=-0.25,
        swap=0.0,
        profit=8.80,
        fee=0.0,
        time=1760000060,
        magic=7,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


_UNSET = object()


class MT5Stub:
    def __init__(
        self,
        *,
        positions=(),
        orders=(),
        symbols=(),
        history_orders=(),
        deals=(),
        info=_UNSET,
    ):
        self._positions = positions
        self._orders = orders
        self._symbols = symbols
        self._history_orders = history_orders
        self._deals = deals
        # A sentinel, so a test can pass info=None to mean "account_info failed".
        self._info = account() if info is _UNSET else info

    def account_info(self):
        return self._info

    def positions_get(self):
        return self._positions

    def orders_get(self):
        return self._orders

    def symbols_get(self):
        return self._symbols

    def history_orders_get(self, _from, _to):
        return self._history_orders

    def history_deals_get(self, _from, _to):
        return self._deals


class NormalizationTests(unittest.TestCase):
    def test_account_is_normalized_to_stable_names_and_strings(self):
        result = snapshots.normalize_account(account())
        self.assertEqual(result["currency"], "USD")
        self.assertEqual(result["margin_mode"], "hedging")
        self.assertEqual(result["account_mode"], "demo")
        self.assertEqual(result["observed_server"], "FTMO-Demo")
        # Only the masked suffix travels, never the full login.
        self.assertEqual(result["observed_login_suffix"], "4321")
        self.assertNotIn("login", result)

    def test_every_decimal_field_leaves_as_a_string(self):
        result = snapshots.normalize_account(account())
        for field in ("balance", "equity", "margin", "free_margin", "margin_level"):
            self.assertIsInstance(result[field], str, field)
            self.assertNotIn("e", result[field].lower(), field)

    def test_position_side_and_ticket_contract(self):
        result = snapshots.normalize_position(position())
        self.assertEqual(result["side"], "buy")
        self.assertEqual(result["broker_ticket"], "123456789")
        self.assertIsInstance(result["broker_ticket"], str)
        self.assertIsInstance(result["volume"], str)
        self.assertEqual(snapshots.normalize_position(position(type=1))["side"], "sell")

    def test_pending_order_types_are_named(self):
        for code, name in ((2, "buy_limit"), (5, "sell_stop"), (7, "sell_stop_limit")):
            self.assertEqual(
                snapshots.normalize_pending_order(pending(type=code))["order_type"], name
            )

    def test_a_filled_order_type_is_not_a_pending_order(self):
        # Types 0/1 are market orders; Phase 4a only carries working orders.
        with self.assertRaises(snapshots.SnapshotError):
            snapshots.normalize_pending_order(pending(type=0))

    def test_instrument_filling_modes_decode_from_the_bit_mask(self):
        self.assertEqual(
            snapshots.normalize_instrument(instrument(filling_mode=3))["filling_modes"],
            ["fok", "ioc"],
        )
        self.assertEqual(
            snapshots.normalize_instrument(instrument(filling_mode=4))["filling_modes"], ["return"]
        )
        self.assertEqual(
            snapshots.normalize_instrument(instrument(filling_mode=0))["filling_modes"], []
        )

    def test_instrument_trade_mode_is_named(self):
        self.assertEqual(
            snapshots.normalize_instrument(instrument(trade_mode=0))["trade_mode"], "disabled"
        )
        self.assertEqual(
            snapshots.normalize_instrument(instrument(trade_mode=4))["trade_mode"], "full"
        )

    def test_unknown_enum_values_are_refused_rather_than_guessed(self):
        with self.assertRaises(snapshots.SnapshotError):
            snapshots.normalize_account(account(margin_mode=99))
        with self.assertRaises(snapshots.SnapshotError):
            snapshots.normalize_position(position(type=42))
        with self.assertRaises(snapshots.SnapshotError):
            snapshots.normalize_instrument(instrument(trade_mode=42))

    def test_non_finite_numbers_are_refused(self):
        with self.assertRaises(snapshots.SnapshotError):
            snapshots.normalize_account(account(equity=float("nan")))
        with self.assertRaises(snapshots.SnapshotError):
            snapshots.normalize_account(account(balance=float("inf")))

    def test_invalid_ticket_is_refused(self):
        with self.assertRaises(snapshots.SnapshotError):
            snapshots.normalize_position(position(ticket="12 34"))
        with self.assertRaises(snapshots.SnapshotError):
            snapshots.normalize_position(position(ticket=None))

    def test_history_orders_and_deals_normalize_to_stable_string_contracts(self):
        self.assertTrue(callable(getattr(snapshots, "normalize_history_order", None)))
        self.assertTrue(callable(getattr(snapshots, "normalize_deal", None)))
        order = snapshots.normalize_history_order(history_order())
        normalized_deal = snapshots.normalize_deal(deal())
        self.assertEqual(order["broker_ticket"], "13579")
        self.assertEqual(order["state"], "filled")
        self.assertIsInstance(order["volume_initial"], str)
        self.assertEqual(normalized_deal["broker_ticket"], "97531")
        self.assertEqual(normalized_deal["entry"], "in")
        self.assertIsInstance(normalized_deal["profit"], str)


class CollectorTests(unittest.TestCase):
    def test_empty_tuple_is_a_complete_empty_family(self):
        # An account with nothing open must be distinguishable from a failure.
        result = snapshots.collect_snapshots(MT5Stub(positions=(), orders=(), symbols=()))
        self.assertEqual(result["positions"]["result"], snapshots.COMPLETE)
        self.assertEqual(result["positions"]["positions"], [])
        self.assertIsNone(result["positions"]["error_code"])

    def test_none_from_mt5_is_failed_not_empty(self):
        # This is the whole point of invariant 8: a failed call must never look
        # like an empty portfolio.
        stub = MT5Stub()
        stub.positions_get = lambda: None
        result = snapshots.collect_snapshots(stub)
        self.assertEqual(result["positions"]["result"], snapshots.FAILED)
        self.assertEqual(result["positions"]["error_code"], "MT5_POSITIONS_UNAVAILABLE")

    def test_an_exception_is_treated_as_a_failed_family(self):
        stub = MT5Stub()

        def explode():
            raise RuntimeError("terminal died")

        stub.orders_get = explode
        result = snapshots.collect_snapshots(stub)
        self.assertEqual(result["pending_orders"]["result"], snapshots.FAILED)

    def test_one_unusable_row_downgrades_to_partial_and_keeps_the_rest(self):
        stub = MT5Stub(positions=(position(), position(ticket=None)))
        result = snapshots.collect_snapshots(stub)
        self.assertEqual(result["positions"]["result"], snapshots.PARTIAL)
        self.assertEqual(len(result["positions"]["positions"]), 1)
        self.assertEqual(result["positions"]["error_code"], "MT5_TICKET_MISSING")

    def test_a_failed_account_does_not_fail_the_other_families(self):
        stub = MT5Stub(positions=(position(),), info=None)
        result = snapshots.collect_snapshots(stub)
        self.assertEqual(result["account"]["result"], snapshots.FAILED)
        self.assertEqual(result["positions"]["result"], snapshots.COMPLETE)

    def test_instrument_filter_selects_only_requested_symbols(self):
        stub = MT5Stub(symbols=(instrument(), instrument(name="XAUUSD")))
        result = snapshots.collect_snapshots(stub, symbols=["XAUUSD"])
        self.assertEqual(result["instruments"]["result"], snapshots.COMPLETE)
        self.assertEqual(
            [row["symbol"] for row in result["instruments"]["instruments"]], ["XAUUSD"]
        )

    def test_no_credential_material_appears_in_any_envelope(self):
        rendered = repr(
            snapshots.collect_snapshots(
                MT5Stub(positions=(position(),), orders=(pending(),), symbols=(instrument(),))
            )
        )
        for forbidden in ("password", "12344321", "secret", "token"):
            self.assertNotIn(forbidden, rendered.lower())

    def test_history_empty_is_complete_but_failure_is_not_authoritative(self):
        self.assertTrue(callable(getattr(snapshots, "collect_history_page", None)))
        complete = snapshots.collect_history_page(
            MT5Stub(history_orders=(), deals=()), from_ms=1760000000000, to_ms=1760003600000
        )
        self.assertEqual(complete["orders_history"]["result"], snapshots.COMPLETE)
        self.assertEqual(complete["deals"]["result"], snapshots.COMPLETE)
        self.assertEqual(complete["orders_history"]["orders"], [])

        failed_stub = MT5Stub()
        failed_stub.history_deals_get = lambda _from, _to: None
        failed = snapshots.collect_history_page(
            failed_stub, from_ms=1760000000000, to_ms=1760003600000
        )
        self.assertEqual(failed["deals"]["result"], snapshots.FAILED)
        self.assertEqual(failed["deals"]["covered_through_ms"], None)


if __name__ == "__main__":
    unittest.main()
