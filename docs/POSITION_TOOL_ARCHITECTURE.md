# Long / Short Position Tool Architecture

Last updated: 2026-07-04

This document defines the shared contract for the TradingView-style Long and
Short Position drawing tools.

## Research Sources

Researched on 2026-07-04.  These sources define the behavior this tool should
track.  When a source describes product behavior but not an implementation
detail, the implementation rule below is marked as an inference.

| Source | What it confirms | Implementation decision |
| --- | --- | --- |
| TradingView Advanced Charts Symbology: https://www.tradingview.com/charting-library-docs/latest/connecting_data/Symbology/ | Price display is driven by symbol metadata. In decimal format, tick size is calculated from `minmov / pricescale`; examples include `0.01`, `0.0125`, and `0.20` ticks. It also documents variable tick sizes by price band. | Position `Ticks`, `Price`, and label formatting must read the active symbol's `tickSize`. Do not infer ticks from price magnitude. Future variable tick support should belong in market-symbol metadata, not in `PositionTool.ts`. |
| EBC Financial Group walkthrough: https://www.ebc.com/forex/mastering-tradingview-tools-to-predict-market-moves.html | Places Long/Short under TradingView projection tools. Long Position is selected for bullish planning, one click sets the prospective entry, and the chart shows take-profit and stop-loss. Short Position works in the opposite direction. Settings are opened from the generated red/green zone. | A new Long/Short drawing is a projection object, not an order. One click creates entry + default TP/SL. Long clamps target above entry and stop below entry; Short clamps target below entry and stop above entry. |
| H2S Media risk-settings walkthrough: https://www.how2shout.com/how-to/change-risk-settings-long-position-tradingview.html | Long/Short is opened from Forecasting & Measurement / Projection tools. After selecting it, the cursor becomes a crosshair; a click sets the entry and creates default stop-loss/take-profit. Double-click opens settings. Account size and risk are inputs. Stop-loss/take-profit can be adjusted by typing exact prices or dragging chart lines. TradingView automatically recalculates position size and risk/reward ratio. | The dialog keeps account size, risk, entry, stop, target, ticks, quantity precision, and stats. Position inputs must be editable by typed price and chart dragging. Movement updates labels immediately and preserves the three-point persisted model. |
| User-provided TradingView screenshots in this task thread | Selected Long/Short tools show six square handles: target/entry/stop at both left and right edges. The settings dialog exposes `Inputs`, `Style`, `Visibility`; `Profit level` and `Stop level` each have `Ticks` and `Price`; BTCUSDT example maps `61915.1 -> 62061.8` to `1467` ticks, implying `0.1` tick size. | Render and hit-test six virtual handles. Keep only three persisted points. Use `tickSize: 0.1` for BTCUSDT in this app's perpetual-contract presentation. `Ticks` and `Price` must round-trip through shared helpers. |

### Research Inferences

- The public sources document how users place, edit, and calculate Long/Short
  positions. They do not describe TradingView's internal object model. The
  three-persisted-points plus six-virtual-handles model is our implementation
  choice because it keeps storage compact while matching the visible handles.
- The sources and screenshots show that stop/target can be adjusted by dragging
  lines and by typing prices. Therefore the movement contract treats every
  target/entry/stop handle as an editable level, while left/right handles also
  resize the time span.
- The app labels crypto as TradingView-style perpetual contracts. BTCUSDT
  therefore uses the screenshot-compatible `0.1` tick. If the app later adds
  separate spot/futures symbols, tick size must move into per-symbol metadata.

## Persisted Model

Position drawings persist three points only:

```ts
points[0] = { time: leftEdge,  price: entry  }
points[1] = { time: rightEdge, price: target }
points[2] = { time: rightEdge, price: stop   }
```

Do not add extra persisted points for handles. TradingView shows six selected
handles, but they are virtual handles derived from this three-point model.

## Shared Helpers

- `positionMetrics.ts`: tick/price math and formatting.
- `positionInput.ts`: numeric draft parsing for settings inputs.
- `positionGeometry.ts`: six virtual handles, body move, handle resize, side
  inference, tick snapping, and long/short level clamping.
- `positionTradePrefill.ts`: converts a completed Long/Short drawing into a
  Trade ticket prefill payload.

`PositionTool.ts` should call these helpers. Avoid reimplementing position math
inside render, hit-test, or settings code.

## Virtual Handles

The selected tool renders and hit-tests six handles:

- `TARGET_LEFT`: left edge + target price
- `ENTRY_LEFT`: left edge + entry price
- `STOP_LEFT`: left edge + stop price
- `TARGET_RIGHT`: right edge + target price
- `ENTRY_RIGHT`: right edge + entry price
- `STOP_RIGHT`: right edge + stop price

Left handles resize the left time edge; right handles resize the right time edge.
Target/entry/stop handles also update their corresponding level price.

Body drag moves all three persisted points and preserves width.

## Trade Ticket Prefill

Placing a new Long/Short Position is still a visual planning action, not an
immediate order. After the one-click drawing is expanded into entry, target, and
stop points, `addDrawingAtom` also builds an `OrderPrefill` through
`positionTradePrefill.ts` and writes it to `setOrderPrefillAtom`.

The Trade tab reads `orderPrefillAtom`, so the ticket is filled even when the
Trade panel was not mounted at placement time. Do not depend on a transient
event bus message for this path; switching the bottom panel to `Trade` happens
after the atom is written, and the newly mounted ticket consumes the latest
versioned prefill.

Prefill mapping:

- `points[0].price` -> order entry price.
- `points[1].price` -> take profit.
- `points[2].price` -> stop loss.
- `riskValue` -> risk percent when `riskUnit` is `%`.
- Long/Short side sets the planned Buy/Sell side in the ticket.
- Order type is inferred from entry versus current market price:
  Long above market and Short below market become stop orders; the opposite
  cases become limit orders.

Keep this conversion in the shared helper. Future position templates, hotkeys,
or copy-trading actions should reuse the same payload builder instead of
duplicating side, target, stop, and order-type logic in UI components.

## Direction Rules

Long:

- Target must stay above entry.
- Stop must stay below entry.

Short:

- Target must stay below entry.
- Stop must stay above entry.

The side is inferred from the original points before the drag starts. This
prevents a temporary pointer cross through entry from flipping a Short into a
Long or vice versa.

## Labels

Default labels follow the TradingView risk/reward visual model:

- Target/Stop labels display distance, percentage, tick count, and projected
  account amount when stats are enabled.
- Entry label displays open P&L, quantity, and Risk/Reward Ratio when account
  and risk settings are available.
- Target/Stop labels sit inside the box near the left edge.
- Entry label is centered on the entry line.

The Style tab still controls visibility, text color/size, compact mode, stats,
and always-show behavior.

## Tests

Run:

```bash
npm run test:position
```

The TypeScript suite under `tests/position/` verifies:

- tick/price parity,
- numeric draft parsing,
- long/short side inference,
- six-handle movement,
- body drag width preservation,
- target/stop clamping to the correct side,
- Trade ticket prefill payloads for Long and Short positions.
