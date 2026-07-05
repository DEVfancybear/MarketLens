# DRAWING INTERACTION ROOT CAUSE — Final Analysis

_Date: 2026-06-25._

## Verdict: No architectural bug found. All chains are correctly wired.

## Trace #1: Tool selection flow

```
DrawingToolbar.onClick
  → chartStore.setActiveTool('trendline')        ← line 117, DrawingToolbar.tsx
    → set({ activeTool: 'trendline' })            ← line 120, chartStore.ts
      → Zustand notifies all subscribers
        → DrawingToolbar re-renders                ← activeTool selector, line 98
          → IconButton `active={true}`             ← line 116
        → DrawingLayer re-renders                  ← activeTool selector, line 45
          → cursorStyle = "crosshair"              ← line 302
          → pointerEvents = "auto"                 ← line 308
          → canvas re-renders with new style
```

## Trace #2: Mouse events

```
User clicks chart (with crosshair cursor)
  → canvas.onPointerDown fires                     ← line 297, DrawingLayer.tsx
    → fromEvent(e)                                 ← line 150
      → canvasRef.current.getBoundingClientRect()  ← line 73
      → ctx.chart.timeScale().coordinateToTime(x)  ← line 76
      → ctx.candleSeries.coordinateToPrice(y)      ← line 77
      → returns Point | null
    → if (!p || !ctx) return;                      ← line 152
    → activeTool === 'trendline' (not 'cursor')   ← line 156
    → minPoints('trendline') = 2                   ← line 26
    → setPending([p])                              ← line 204
      → pending !== null                           ← triggers re-render
      → draw() includes '__pending' virtual drawing ← line 110
        → renderDrawing(g, pending, ...)            ← calls drawingRenderer.ts
```

## Trace #3: Drawing mode

`activeTool` is `'trendline'` directly from `useChartStore`. There are no intermediate observers, no transformation layers. The value is read atomically from Zustand.

## Trace #4: Preview rendering

When `pending` is set and user moves mouse:
```
onPointerMove                                  ← line 213
  → fromEvent(e) → p                          ← line 216
  → if (pending) setPending([pending[0], p])   ← line 219
    → pending array changes                     ← triggers re-render
    → draw() renders virtual '__pending' drawing
      → renderer shows line from point 1 to cursor position
```

## Component tree verification (all mounted)

```
PriceChart (line 454-463)
  ├─ <div> containerRef (LWC chart)          ← rendered 1st, normal flow
  └─ ChartContextObj.Provider (ctx)          ← rendered 2nd, absolute overlay
       ├─ SmcLayer (pointer-events:none)     ← rendered 3rd
       ├─ TradeLevels (no DOM)               ← no blocking
       ├─ AlertOverlay (pointer-events:none) ← wrapper doesn't block
       │   └─ hit strips (pointer-events:auto, thin bands) ← only block at alert price levels
       ├─ DrawingLayer (pointer-events:auto)  ← rendered 6th, LAST interactive overlay
       └─ ReplaySelectionLayer (pointer-events:none, zIndex:30) ← rendered last, doesn't block
```

## No blocking layers found

| Layer | pointer-events | Blocks DrawingLayer? |
|---|---|---|
| ChartArea header | `none` | No |
| Loading overlay | Only when loading | No (transient) |
| SmcLayer | `none` | No |
| TradeLevels | No DOM | No |
| AlertOverlay wrapper | `none` | No |
| AlertOverlay strips | `auto` (thin bands) | Only at alert price levels |
| ReplaySelectionLayer | `none` (unless selecting) | No |

## Exact failing component: NONE FOUND

The event chain from toolbar click to drawing creation is fully operational in code. If clicks on the chart produce no drawings, the issue is at runtime — not in the code architecture.

### Most likely runtime causes:

1. **Chart context not ready** — `ctx` is null because candles haven't loaded. DrawingLayer renders but `fromEvent` returns null (no chart API yet). Once candles load: click works.

2. **Canvas dimensions zero** — If the parent container collapses to 0 height, `getBoundingClientRect()` returns `{width: 0, height: 0}`. The canvas renders but pointer events don't fire because there's no visible area. Check: `containerRef.current.offsetHeight > 0`.

3. **Browser extension interference** — Some ad blockers or privacy extensions block canvas events or WebSocket connections, preventing chart data from loading.

4. **LWC chart not fully initialized** — Lightweight Charts takes ~200ms to initialize after mounting. If user clicks too quickly, `ctx` might still be null.

## Diagnostic logging added

```js
// DrawingLayer.tsx line 47-49: logs when chart context becomes available
useEffect(() => {
  if (ctx) console.debug('[DrawingLayer] chart context available, candles:', ctx.candles.length);
}, [ctx]);

// DrawingLayer.tsx line 150-152: logs every pointer down event
if (process.env.NODE_ENV === 'development') {
  console.debug('[DrawingLayer] pointerDown', 'tool:', activeTool, 'ctx:', !!ctx, 'target:', (e.target as HTMLElement)?.tagName);
}
```

Open browser console (F12 → Console) and verify:
1. `[DrawingLayer] chart context available, candles: <N>` — confirms chart is ready
2. `[DrawingLayer] pointerDown tool: trendline ctx: true target: CANVAS` — confirms clicks are received
3. If both appear but no drawing is created: issue is in the rendering (canvas draw function or drawingRenderer)
4. If #1 appears but #2 doesn't: the canvas is not receiving pointer events
5. If neither appears: chart data failed to load
