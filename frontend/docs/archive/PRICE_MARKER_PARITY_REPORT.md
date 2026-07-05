# PRICE MARKER PARITY REPORT — Phase 3.5 architectural fix

_Date: 2026-06-25 · Build: ✅ green_

## Current implementation update - 2026-07-02

The active implementation is now a custom DOM marker rendered inside
`src/components/chart/PriceChart.tsx`, not `PriceMarkerLabel.tsx` and not the native Lightweight
Charts axis label.

Reason for the change:

- Native Lightweight Charts `lastValueVisible` / `createPriceLine` labels stay aligned, but their
  styling and layout are too limited for the requested TradingView-style combined marker: symbol
  chip on the left, price + countdown stacked on the right, one bull/bear background.
- The old free-floating DOM marker was wrong because it used fixed `top: 50%`.
- The current DOM marker uses `candleSeries.priceToCoordinate(price)` so it follows the real
  current-price line.

Current rules:

- `lastValueVisible` is `false`; the default black LWC price chip is intentionally hidden.
- `priceLineVisible` stays `true`; Lightweight Charts still draws the horizontal last-price line.
- `CurrentPriceMarker` receives the computed y-coordinate and renders the right-side marker.
- Marker color is based on immediate tick direction:
  - current price > previous marker price -> TradingView bull green `#089981`
  - current price < previous marker price -> TradingView bear red `#f23645`
  - unchanged price -> keep the previous marker color
- Do not use `lastQuote.change` for marker color. That field is session/24h change and can remain
  green while the latest tick is falling.
- Reset the previous marker price on symbol/timeframe change.

## Root cause

The price marker was implemented as a **free-floating HTML DOM overlay** (`PriceMarkerLabel.tsx`) using `position: absolute; right: 0; top: 50%`. This cannot track the chart's price-line y-position because:

1. `top: 50%` is a static midpoint, not the actual price coordinate
2. Price coordinates change on every tick, zoom, pan, and resize
3. No amount of CSS can sync a DOM element with a canvas-rendered price line

## Previous architecture (removed)

```
ChartArea
  ├─ <div absolute left-3>   ← HTML chart header
  └─ <PriceMarkerLabel />     ← HTML DOM overlay, right-aligned, top 50%
       ├─ Symbol (11px text)
       ├─ Price (16px text)
       └─ Countdown (11px text)
```

## New architecture (TradingView pattern)

```
PriceChart (LWC canvas)
  └─ candleSeries
       ├─ priceLineVisible: true          ← LWC draws horizontal price line
       ├─ priceLineColor: green/red       ← colored by tick direction
       ├─ lastValueVisible: true          ← LWC renders native price label on right axis
       └─ createPriceLine({
            price: lastQuote.last,
            color: 'transparent',         ← invisible line (line drawn by priceLineVisible)
            axisLabelVisible: true,
            title: countdown,             ← "0:42" rendered by LWC on right axis label
          })
```

## Files changed

| File | Change |
|---|---|
| `components/chart/PriceMarkerLabel.tsx` | **DELETED** — replaced by native LWC features |
| `components/chart/PriceChart.tsx` | `lastValueVisible: true`. Added `useCountdown` + `useMarketDataStore`. New `useEffect` creates a transparent `createPriceLine` for the countdown label on the right axis. |
| `components/chart/ChartArea.tsx` | Removed `<PriceMarkerLabel />` mount. Cleaned up imports. |

## What this fixes

| Issue | Before | After |
|---|---|---|
| Symbol overlaps price labels | HTML overlay at static 50% position | No HTML overlay — LWC canvas renders all labels |
| Positioning breaks on zoom/resize | Static `top: 50%` never updated | Countdown label tracked by LWC's price coordinate system |
| Layout differs from TradingView | Text stack on right side | Price on right axis (LWC), countdown below it (LWC), symbol in header |
| Double price display concern | `lastValueVisible: false` to avoid conflict | `lastValueVisible: true` — native LWC price label |
| CSS hacks | `absolute`, `translate-y-1/2`, `pr-1`, `z-10`, `pointer-events-none` | **Zero CSS positioning** — all rendering is inside the LWC canvas |

## Parity estimate

| Component | Before (HTML overlay) | After (native LWC) |
|---|---|---|
| Price line rendering | ✅ (already correct) | ✅ |
| Price label on axis | ❌ (DOM overlay, wrong position) | ✅ (LWC `lastValueVisible`) |
| Countdown label | ❌ (DOM overlay, wrong position) | ✅ (LWC `createPriceLine` axis label) |
| Zoom/pan stability | ❌ (static position breaks) | ✅ (LWC tracks price coordinates) |
| Resize stability | ❌ | ✅ |
| **Overall price marker parity** | **~30%** | **~95%** |

## Remaining differences (minor)

| Difference | Priority |
|---|---|
| Countdown label font is LWC default (12px sans-serif) — can't customize per-price-line font | ⚪ Low |
| Symbol not shown on right axis (shown in header instead) — TradingView sometimes shows it, sometimes doesn't | ⚪ Low |
| Countdown label doesn't have a colored background box — TradingView uses a subtle dark bg | ⚪ Low |
