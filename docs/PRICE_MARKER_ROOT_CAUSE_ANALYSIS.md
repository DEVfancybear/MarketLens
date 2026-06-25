# PRICE MARKER — ROOT CAUSE ANALYSIS

_Date: 2026-06-25._

## 1. How is the current price marker rendered?

The current price marker is implemented as a **free-floating HTML DOM overlay** in `PriceMarkerLabel.tsx`. It uses:

```html
<div className="pointer-events-none absolute right-0 top-1/2 z-10 -translate-y-1/2 pr-1">
```

This means:
- It's a React-rendered `<div>` with `position: absolute; right: 0; top: 50%; transform: translateY(-50%)`
- It is placed inside `ChartArea.tsx`, which is a sibling of the `<div ref={containerRef}>` that hosts the Lightweight Charts canvas
- It has `pointer-events: none` so it doesn't block chart interaction

**This is an HTML overlay — not a native chart feature.**

## 2. Does the chart library have a native alternative?

**Yes.** Lightweight Charts provides `series.createPriceLine()` which:

- Creates a horizontal price line attached to a specific price level on a series
- Renders a label on the **right price scale axis** showing the title text
- **Moves automatically with the price scale** when the user zooms/pans/resizes
- Never overlaps the chart axis — it's rendered inside the chart canvas
- Is a single atomic LWC primitive, not a DOM layer

The TradeLevels component already uses this API correctly:
```ts
series.createPriceLine({
  price: p.entry,
  color: '#2962ff',
  lineWidth: 1,
  lineStyle: 0,
  axisLabelVisible: true,
  title: 'L entry',
});
```

## 3. What is the root cause of the current issues?

| Issue | Root Cause |
|---|---|
| Symbol overlaps price labels | The HTML overlay uses `top: 50%` which is a static midpoint — not the actual price level y-coordinate |
| Symbol is rendered above the price | The HTML overlay is a flex-col with symbol first — can't be reordered per-instrument |
| Marker layout differs from TradingView | TradingView: symbol badge LEFT of price line + price/timer RIGHT of price line. Our overlay: all text stacked vertically on the right |
| Positioning breaks on zoom/resize | `top: 50%` is fixed; the price line's actual pixel position changes with scale. No sync mechanism |
| LWC `lastValueVisible` is `false` | Disabled because the DOM overlay was intended to replace it, but the overlay can't track the price line y-position |

**The fundamental architectural mistake is using an HTML DOM overlay to render something that LWC natively supports via `createPriceLine`.**

## 4. Why can't the DOM overlay be fixed with CSS?

A DOM overlay at `right: 0; top: 50%` will ALWAYS be at the chart's vertical midpoint. But the forming-bar price line moves up and down as new ticks arrive. The overlay would need to:

1. Read the last candle's close price
2. Convert that price to a pixel y-coordinate via `candleSeries.priceToCoordinate(price)`
3. Apply that y-coordinate as the `top` value
4. Recalculate on every tick, zoom, pan, and resize

This is possible but fragile, and duplicates what LWC already does internally for `createPriceLine`.

## 5. The correct architecture

**Remove `PriceMarkerLabel.tsx` entirely.** Use the LWC-native `priceLine` + `lastValueVisible` features, and add a countdown timer as a custom `createPriceLine` label.

```
LWC PriceChart
  └─ candleSeries
       ├─ priceLineVisible: true      ← horizontal line at last price
       ├─ priceLineColor: green/red   ← colored by direction
       ├─ lastValueVisible: true      ← native price label on right axis ← ENABLE THIS
       └─ createPriceLine({
            price: lastQuote.last,
            color: 'transparent',     ← invisible line (we use priceLineVisible for the line)
            axisLabelVisible: true,
            title: countdownString,   ← "0:42" countdown timer
          })
```

**How it works:**
- `priceLineVisible: true` draws the horizontal line at the last bar's close
- `lastValueVisible: true` shows the numeric price on the right axis — **this is the TradingView price display**
- `createPriceLine` with `color: 'transparent'` and `axisLabelVisible: true` renders JUST the countdown label on the axis, positioned at the same price level as the price line
- All labels are rendered by LWC's canvas — they move with the price scale, never overlap, and are perfectly aligned

**The chart header remains pure informational:**
- Left side: `BTCUSDT · BINANCE · 1W` + OHLC row
- Right side (via LWC): `67,234.50` (price) + `0:42` (countdown)

This matches TradingView's architecture exactly.

## 6. Files to modify

| File | Action |
|---|---|
| `components/chart/PriceChart.tsx` | Set `lastValueVisible: true`. Add `useCountdown` + `useMarketDataStore` to create a countdown `IPriceLine` that updates every second. Update priceLineColor on tick direction. |
| `components/chart/PriceMarkerLabel.tsx` | **DELETE** — replaced by native LWC features |
| `components/chart/ChartArea.tsx` | Remove `<PriceMarkerLabel />` mount. Keep the compact header. |
| `hooks/useCountdown.ts` | Minor: export raw seconds as well as formatted string so PriceChart can compute countdown label independently. |

## 7. Verification

After the fix:
- Zoom in/out: countdown label stays on the right price axis at the correct price level
- Resize chart: label moves with the price scale border
- Symbol switch: new candle series gets new price line + countdown
- Timeframe switch: same
- No DOM overlays near the price axis
- No CSS transforms, absolute positioning, or z-index hacks
- `lastValueVisible: true` provides the native price label
- Countdown is a transparent `createPriceLine` with only the axis label visible
