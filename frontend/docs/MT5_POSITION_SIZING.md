# MT5 Position Sizing

The web order ticket has an MT5-specific sizing path based on the main risk calculation used by
[EarnForex Position Sizer](https://github.com/EarnForex/PositionSizer/tree/master/MQL5/Experts/Position%20Sizer).
It is an adapter around a broker-agnostic calculator, not a direct copy of the MQL5 UI or every
Position Sizer tab.

## Ownership

| Layer | Responsibility |
| --- | --- |
| `src/services/positionSizing.ts` | Shared risk, commission, reward, volume-step, and margin-cap arithmetic |
| `src/services/positionLotSizing.ts` | Maps MT5 symbol/account metadata to the shared price-unit model |
| `src/components/trade/OrderTicket.tsx` | Risk/lot controls, side-aware prices, warnings, and order payloads |
| `backend/bridge/ftmo_mt5/` | Publishes MT5 metadata and remains the authoritative execution/risk gate |

Keeping the arithmetic in the common service prevents the simulator and MT5 ticket from drifting
apart when broker rounding or commission rules change.

## Calculation

The calculator first resolves the account basis (`balance`, `equity`, or
`balanceMinusRisk`) and then applies the selected percent or money risk input:

```text
target risk = floor(account basis × risk %, account-currency precision)
loss/lot    = stop distance × loss value per price unit
              + 2 × one-way commission
raw lots    = target risk / loss/lot
lots        = floor(raw lots, broker lot step)
```

Money-risk mode uses the entered account-currency amount directly. The final lot size is bounded
by the broker minimum/maximum/step and, when enabled, available-margin capacity. A result below
the broker minimum is raised to that minimum and reported with `MIN_VOLUME_INCREASED_RISK`; this
is intentional Position Sizer behavior and is not presented as risk-free sizing.

The reward side uses the direction-specific profit value and subtracts the same round-trip
commission. Displayed monetary values are rounded to account-currency precision; MT5 reward output
uses downward rounding.

## MT5 metadata mapping

The bridge sends the fields below in `symbol.info`:

- `tickValueLoss` / `tickValueProfit` (with `tickValue` as a legacy fallback);
- `tickSize`, `contractSize`, and `calcMode`;
- `currencyBase`, `currencyProfit`, and `currencyMargin`;
- `marginInitial`, `marginMaintenance`, `marginHedged`, and `spread`;
- `minLot`, `maxLot`, `lotStep`, `stopLevel`, `freezeLevel`, and `minStopDistance`.

Forex/futures calculation modes use MT5's direction-specific tick values. CFD/stock/metal modes
derive price-unit value from tick size and contract size, applying a supplied conversion rate when
the symbol or account currency requires one. If a broker omits required metadata, the adapter
falls back to the legacy tick value where safe and emits a warning when it cannot calculate a
reliable size.

The ticket validates long/short stop and target sides and the broker minimum stop distance. It
uses `openRiskAtStops` from the optional bridge risk snapshot for `balanceMinusRisk`; the bridge
owns the daily/maximum-loss and per-trade limits and revalidates final volume and stop-loss risk
before execution.

## Running locally

Set the frontend bridge variables in `frontend/.env.local` (the port must match the bridge):

```env
NEXT_PUBLIC_MT5_BRIDGE_URL=ws://localhost:8787
NEXT_PUBLIC_MT5_BRIDGE_TOKEN=
```

MT5 availability is loaded from the authenticated user's verified integration;
there is no browser-wide enable flag.

For a deterministic local websocket, run the mock bridge:

```powershell
cd frontend
npm run mock-mt5
```

For the Python FTMO bridge in dry-run mode:

```powershell
cd backend
$env:FTMO_MT5_ENABLED="true"
$env:FTMO_BRIDGE_DRY_RUN="true"
python -m bridge.ftmo_mt5.service
```

See [`backend/bridge/ftmo_mt5/README.md`](../../backend/bridge/ftmo_mt5/README.md) for live-mode
credentials, caps, and operational safety rules. Never put broker credentials in frontend
environment variables or committed files.

## Verification

Run the focused calculator and ticket tests from `frontend/`:

```powershell
npm run test:position
npm run test:trade
npm run typecheck
npm run lint
npm run build
```

The Python metadata/risk tests run from `backend/`:

```powershell
python -m unittest discover -s bridge -p 'test_*.py'
```

## Current scope and limitations

The web ticket covers the core Position Sizer risk/lot workflow: one stop, one target, broker
volume rules, commission, direction-aware tick values, account basis, and margin limits. The full
MQL5 application has additional tabs and workflows (for example multi-target planning, swap and
carry modelling, its Trading tab, and the complete interactive UI); those are not yet
represented in the web ticket. The bridge's server-side risk guard remains authoritative even when
the browser shows a locally calculated lot size.
