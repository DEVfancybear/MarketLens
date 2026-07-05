# SMC Overlay Maintenance

Updated: 2026-07-02

This document is the handoff reference for the Smart Money Concepts overlay.

## Reference

The implementation follows the common TradingView SMC display model described on TradingView's
public Smart Money Concepts script page: structure lines, clustered equal-high/equal-low liquidity,
sweeps, order blocks from structure breaks, optional fair value gaps, mitigated/faded states, and
visual caps to keep the chart readable.

Reference URL: https://www.tradingview.com/scripts/smartmoneyconcepts/

Key rules from that reference that matter for this repo:

- Liquidity should be clustered into pools/bands, not drawn as an unlimited stack of raw lines.
- Swept liquidity should dim or use compact marks.
- Structure breaks are confirmed from protected swings and should not repaint.
- Order blocks originate from the move that broke structure.
- FVG/OB objects should fade or be capped after mitigation.
- SMC is a visual analysis overlay, not a trade signal executor.

## Feature List

The SMC menu currently owns these feature toggles:

- `structure`: BOS / CHOCH / MSS structure lines and chips.
- `swings`: HH / HL / LH / LL swing labels.
- `fvg`: fair value gap zones.
- `orderBlocks`: structure-origin order block zones.
- `liquidity`: EQH / EQL liquidity pools and sweep marks.
- `displacement`: impulsive displacement candle markers.
- `sessions`: Asian / London / New York session tint and session high/low/mid.
- `killzones`: London Open and New York Open time windows.

Keep this list in sync across:

- `src/store/smcStore.ts`
- `src/components/toolbar/SmcMenu.tsx`
- `src/components/smc/SmcLayer.tsx`
- `scripts/check-smc-overlay-parity.mjs`

## Live Rendering Contract

`SmcLayer.tsx` renders on a custom canvas sibling over the Lightweight Charts canvas.

Important invariants:

- The canvas must stay above the chart canvas in the live UI: `z-[2]`.
- It must remain below drawings (`DrawingLayer` uses z-index 5) and replay selection.
- The screenshot compositor in `chartRegistry.ts` can still composite hidden canvases, so a missing
  z-index can produce the misleading bug where screenshots show SMC overlays but the live chart does
  not.
- Canvas fonts must use concrete font strings. `ctx.font = "10px var(--font-mono)"` does not resolve
  reliably and causes bad text measurement.

## Render Limits

Do not render every historical SMC object when all menu toggles are enabled. Use the `LIMITS` object
inside `SmcLayer.tsx`:

- structures: 24
- swings: 40
- active FVGs: 12
- mitigated FVGs: 3
- fresh order blocks: 8
- mitigated order blocks: 3
- liquidity pools: 10
- swept liquidity: 3
- displacements: 24
- sessions: 6
- kill zones: 8

These caps are intentionally UI-level caps. The SMC engines can still compute a larger historical
snapshot for analytics/replay, but the chart must stay readable.

## Logic Notes

Structure:
Confirmed swings use a right-bars delay, then BOS/CHOCH/MSS is emitted only after close breaks the
protected level.

FVG:
Three-candle imbalance. Active gaps are prioritized. Only a few recent mitigated gaps are shown.

Order Blocks:
Boxes come from the last opposite candle before a confirmed structure break. Fresh blocks are
prioritized; invalidated blocks are not rendered.

Liquidity:
EQH/EQL pools are clustered from swing highs/lows. Active untaken pools near current price are
prioritized. Swept pools get compact labels and no right-axis price tags.

Sessions/Kill Zones:
These are background aids. Keep opacity low so they never obscure candles.

## Regression Guard

Run:

```bash
npm run check:smc-overlay
```

This guard checks:

- SMC canvas z-index is present.
- Every noisy overlay family is capped before rendering.
- Swept liquidity does not spam price tags.
- SMC canvas font strings are concrete.
- The menu/store feature list remains complete.
- Mojibake checkmarks and unsupported canvas marker glyphs do not return.
