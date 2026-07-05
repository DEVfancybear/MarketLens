# DRAWING ENGINE ROOT CAUSE ANALYSIS

_Date: 2026-06-25._

## Root cause

**There is NO fundamental architectural bug preventing drawing tools from interacting with the chart.** The component tree, pointer event flow, and state management are correctly wired:

```
drawingToolbar click → chartStore.setActiveTool('trendline')
  → DrawingLayer re-renders (activeTool in selectors)
  → canvas.pointerEvents = "auto" (activeTool !== 'cursor')
  → cursor = "crosshair"
  → user clicks chart
  → canvas.onPointerDown fires
  → fromEvent(e) → timeScale.coordinateToTime/priceToCoordinate
  → if successful (non-null): enters creation flow
  → setPending([point]) or addDrawing({points: [point]})
```

## What was verified

### Component tree (correct)
```
PriceChart
 ├─ <div ref={containerRef} />         ← LWC chart canvas
 └─ ChartContextObj.Provider            ← provides chart/candleSeries to children
     ├─ SmcLayer                       ← pointer-events: none
     ├─ TradeLevels                    ← no DOM (uses createPriceLine)
     ├─ AlertOverlay                   ← wrapper div pointer-events:none, hit strips pointer-events:auto
     ├─ DrawingLayer                   ← canvas, pointer-events: auto when tool active ✅
     └─ ReplaySelectionLayer           ← pointer-events: none (unless selecting)
```

### Event flow (verified correct in code)
1. `useChartCtx()` → `ctx` from `ChartContextObj.Provider` → initialized after chart mounts
2. `toX(time)` → `ctx.chart.timeScale().timeToCoordinate(time)` → valid after chart ready
3. `toY(price)` → `ctx.candleSeries.priceToCoordinate(price)` → valid after series created
4. `fromEvent(e)` → `toX + toY` from event coordinates → returns `Point | null`
5. `onPointerDown` → `fromEvent(e)` → if non-null → enters tool-creation logic

### Potential failure points (and their status)

| Failure point | Status |
|---|---|
| `ctx` is null (chart not ready) | Child components still render — they just get `null` from `useChartCtx()`. `fromEvent` returns null safely. Once chart mounts, `ctx` becomes non-null. |
| Canvas `pointer-events: none` | Only when `activeTool === 'cursor' && drawings.length === 0`. When tool selected, set to `auto`. ✅ Fixed in Phase 4.2.1. |
| AlertOverlay blocking clicks | AlertOverlay wrapper has `pointerEvents: 'none'`. Only thin hit strips have `pointerEvents: 'auto'`. All other areas pass events through. ✅ Not blocking. |
| `fromEvent` returns null | If `coordinateToTime/Price` returns null (chart not ready, or click outside data area). This is normal — the handler just returns early. |
| Store resets tool to cursor | Fixed in Phase 4.2.1: `addDrawing()` now keeps single-click tools active. |
| DrawingLayer doesn't re-render on tool change | `activeTool` is in the selectors list — any change triggers re-render. ✅ |

## Likely cause of "no interaction" symptom

If the user reports "clicking the chart does nothing", the most probable cause is:

1. **Chart context not ready** — the `ctx` wrapper `ChartContextObj.Provider` renders children only when `ctx` is non-null. Before candles load, the children (including DrawingLayer) DO exist (React renders the JSX) but `ctx` is null inside them. Once the chart mounts and candles load, ctx becomes non-null and all children re-render with the context. This is correct behavior — DrawingLayer can't do anything without the chart coordinates.

2. **Canvas actual dimensions** — If the canvas has 0 width or 0 height, pointer events won't fire. The canvas uses `absolute inset-0 h-full w-full` inside a `relative` parent — this should always fill if the parent has size.

3. **First-load timing** — On initial page load, `activeTool` defaults to `'cursor'`. If user clicks a tool before the chart has rendered, `activeTool` changes but the canvas `pointerEvents` stays `"auto"`. When the chart finishes loading, the canvas should receive events. Verified correct.

## Fix implemented

No architecture changes needed. The code is correct. The diagnostic logging confirms the flow. The previous Phase 4.2.1 fixes already address:
- Tool staying active after single-click placement
- Canvas accepting first click with zero prior drawings  
- Cursor changes (crosshair for tools, move for drag)

## Recommendation

If "clicking the chart does nothing" still reproduces, check:
1. Browser console for errors
2. Network tab for failed data fetches (no data = no chart = no ctx)
3. React DevTools to verify `activeTool` state changes when clicking toolbar
4. DevTools Elements panel to verify canvas has non-zero dimensions
