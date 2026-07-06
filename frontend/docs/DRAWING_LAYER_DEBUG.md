# DRAWING LAYER DEBUG — Runtime Diagnostics Added

_Date: 2026-06-25._

## Diagnostic logs added

| # | Location | Log | What it proves |
|---|---|---|---|
| 1 | `chartStore.setActiveTool` | `[chartStore] setActiveTool trendline` | Toolbar click → store correctly |
| 2 | `DrawingLayer` useEffect | `[DrawingLayer] activeTool changed to: trendline` | DrawingLayer receives state updates |
| 3 | `DrawingLayer` ctx useEffect | `[DrawingLayer] chart context available, candles: 1500` | Chart API is ready |
| 4 | `DrawingLayer` mount effect | `[DrawingLayer] canvas mounted { w: 1200, h: 800 }` | Canvas has non-zero dimensions |
| 5 | `DrawingLayer.onPointerDown` | `[DrawingLayer] pointerDown tool: trendline ctx: true target: CANVAS` | Clicks reach the canvas |

## Flow verification

Expected console output when user clicks Trend Line then clicks chart:

```
[chartStore] setActiveTool trendline
[DrawingLayer] activeTool changed to: trendline
[DrawingLayer] pointerDown tool: trendline ctx: true target: CANVAS
```

## What each log means

| If this is missing | Problem |
|---|---|
| `#1` missing | Toolbar not calling store → DrawingToolbar broken |
| `#2` missing | DrawingLayer not subscribing to the active-tool atom, or component not mounted |
| `#3` missing | Chart not loaded → data fetch failed, no candles |
| `#4` shows `w:0 h:0` | Canvas collapsed → parent container has no size → pointer events can't fire |
| `#5` missing (but #1-4 present) | Canvas not receiving events → another element blocking (unlikely) or browser issue |

## Exact files changed

| File | Change |
|---|---|
| `store/chartStore.ts` | `console.debug` in `setActiveTool` |
| `components/chart/DrawingLayer.tsx` | `console.debug` on activeTool change, canvas mount dimensions |
