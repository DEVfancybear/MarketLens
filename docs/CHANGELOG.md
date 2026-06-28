# CHANGELOG

All notable changes to the SMC Trading Terminal. Dates are UTC.

## [Unreleased]
### Added — Floating drawing settings toolbar (2026-06-28)
- Selecting any drawing on the chart now pops a **TradingView-style floating toolbar**
  above it (`DrawingSettingsToolbar.tsx`) for inline editing — no separate dialog needed.
- Controls: stroke colour (palette + custom picker), fill colour (shapes only, with
  "No fill"), line width (1–4px), line style (solid / dashed / dotted), clone, lock/unlock,
  delete. Each control writes via `updateDrawingAtom` / store actions; changes persist.
- Auto-positions above the selection's projected anchor points (falls back below when
  there's no room) and follows the drawing on pan / zoom / resize via `ChartContext.version`.
- `DrawingInteractionManager` now ignores pointer events that originate on the toolbar
  (`isOverDrawingUI` / `[data-drawing-toolbar]`) so clicking a control no longer deselects
  the drawing or starts a drag.
  Files: chart/DrawingSettingsToolbar.tsx (NEW), chart/DrawingLayer.tsx,
  drawing/interaction/DrawingInteractionManager.ts.

### Added — Trend Angle tool + TradingView-style line suite parity (2026-06-28)
- **New `trendAngle` drawing tool** — two-point trend line that always renders the
  visual angle (degrees) between the line and a horizontal baseline, drawn with a
  dashed reference baseline + sweep arc + degree chip at the first anchor. Mirrors
  TradingView's "Trend angle" tool. Files: drawing/tools/plugins/TrendAngleTool.ts (NEW),
  drawing/tools/adapters.ts, types/drawing.ts (`trendAngle` added to `DrawingTool` +
  `DRAWING_TOOLS`).
- **TrendLine stats chip** — the basic trend line now shows a TradingView-style label
  (price change, % change, angle°) while drawing (`__pending`) and when selected.
  File: drawing/tools/plugins/TrendLineTool.ts.
- **Shared helpers** `angleDeg()` + `angleArc()` added to drawing/tools/plugins/shared.ts.
- **Toolbar LINES group** consolidated to match TradingView's "LINES" menu: Trend line,
  Ray, Info line, Extended line, Trend angle, Horizontal line, Horizontal ray, Vertical
  line, Cross line, Channel — with inline hotkey labels. The separate "horizontals"
  group was merged in. File: components/toolbar/DrawingToolbar.tsx.
- **Hotkeys** Alt+T (trend line), Alt+H (horizontal), Alt+J (horizontal ray),
  Alt+V (vertical), Alt+C (cross line). File: hooks/useHotkeys.ts.

### Fixed — InfoLine tool drag not smooth during rubber-band preview (2026-06-27)
- InfoLine's price/percentage chip label is now skipped during rubber-band preview
  (`id === "__pending"`), matching TrendLine smoothness. Chip renders only after
  the drawing is placed.
- Replaced native `g.roundRect()` in `chip()` with cross-browser `arcTo` path.
  Files: drawing/tools/plugins/InfoLineTool.ts, drawing/tools/plugins/shared.ts.
- Text tool now opens an inline `<input>` on the chart at the click position
  instead of `window.prompt()`. TradingView-style: click → type → Enter/Escape.
- Empty placeholder drawing created without auto-selection to avoid the handle
  circle while typing. On save, placeholder replaced with fresh drawing.
- `TextTool` plugin: removed selection handle circle (text annotations don't
  show handles in TradingView).
- `CanvasRenderer.drawingsHash`: now includes `d.text` so text-only updates
  invalidate the render memo.
- `DrawingInteractionManager`: added optional `onTextPlace` callback for
  inline editing; falls back to `window.prompt()` when not provided.
  Files: drawing/TextEditor.tsx (NEW), drawing/tools/plugins/TextTool.ts,
  drawing/renderer/CanvasRenderer.ts, drawing/interaction/DrawingInteractionManager.ts,
  chart/DrawingLayer.tsx.
- New `AlertLines` component using lightweight-charts' built-in `createPriceLine` API
  instead of custom canvas overlay. This guarantees alert lines are always visible
  immediately after creation — same mechanism as `TradeLevels` entry/SL/TP lines.
- Lines reposition automatically on zoom/pan (no recreate needed).
- Shows right-axis label with alert symbol, condition, and target price.
- Dual-layer design: `AlertLines` for visibility, `AlertOverlay` for interaction.
  Files: chart/AlertLines.tsx, chart/ChartArea.tsx, chart/AlertOverlay.tsx.

### Fixed — Alert trendline not appearing on chart after creation (2026-06-27)
- Creating an alert via right-click context menu saved the alert but showed no
  horizontal line on the chart. Two root causes:
  1. `AlertOverlay`'s `draw` callback depended on `symbolAlerts` (new array every
     render via `.filter()`), causing perpetual `useCallback` recreation and rAF
     cancellation. Refactored to read data from refs (`alertsRef`, `symbolRef`).
  2. `useAlertEngine` used a `prev` price recorded BEFORE the alert existed for
     cross detection, causing spurious immediate `crossUp`/`crossDown` triggers
     that moved the alert to `triggeredAlerts` before the user saw the line.
     Added `seenAlertIds` first-evaluation gate.
  Files: chart/AlertOverlay.tsx, hooks/useAlertEngine.ts.

### Fixed — Alert trendline delete button not working (2026-06-27)
- Delete (X) button and Delete/Backspace key had three issues:
  1. Click-outside deselect handler fired on hit strips + delete button because
     they were moved outside `containerRef`. Added `data-alert-strip` /
     `data-alert-delete` attributes and `e.stopPropagation()` to prevent this.
  2. Delete button was inside `pointer-events:none` container → moved outside
     with `z-index:50`.
  3. Native `pointermove`/`pointerup` listeners could interfere with click
     events → removed `onPointerDown` from delete button.
  Files: chart/AlertOverlay.tsx.

### Fixed — Alert lines disappearing on chart zoom (2026-06-27)
- `AlertLines` effect depended on `ctx` (which changes on every zoom/pan via
  `ctx.version`), causing all native price lines to be removed and recreated
  on every zoom step. Moved `candleSeries` to a stable `seriesRef` so the effect
  only runs when alert data actually changes — native lines reposition
  automatically with the price scale.
  Files: chart/AlertLines.tsx.

### Added — Chart right-click: Reset view / Remove drawings / Remove indicators (2026-06-27)
- Added the three TradingView chart context-menu actions:
  - **Reset chart view** — `chartRegistry.resetChartView()` calls `resetTimeScale()` +
    `scrollToRealTime()` and re-enables right price-scale `autoScale`.
  - **Remove drawings** — `chartStore.clearDrawings()` (existing); disabled when none.
  - **Remove indicators** — new `chartStore.clearIndicators()`; disabled when none.
  - Menu items support a `disabled` state (greyed, non-interactive) like TradingView.
  Files: store/chartStore.ts (clearIndicators), chart/chartRegistry.ts (resetChartView),
  chart/ChartContextMenu.tsx.

### Docs — Refreshed stale drawing-engine architecture docs (2026-06-27)
- Updated the current-architecture drawing docs to match the implemented plugin/adapter
  engine (they described an obsolete `switch(d.tool)` / `drawingHitTest.ts` design):
  - `DRAWING_ENGINE_ARCHITECTURE.md`: rewrote Architecture layers, Data flow, SSOT, and
    Extensibility around `ToolRegistry`/plugins; added the Render loop & repaint contract.
  - `TOOL_REGISTRY.md`: the doc previously said the engine used decentralized switches and
    had no registry — inverted to document the actual `DrawingAdapter` registry.
  - `DRAWING_OBJECT_MODEL.md`: "add a tool" steps now describe writing a plugin + importing
    it in `adapters.ts` (no engine-file edits).
  - `SELECTION_ENGINE.md`: marked multi-select (Shift+click), Ctrl+A, move-multiple, and
    hover as implemented; corrected hit-test path to `hittest/HitTestEngine.ts`.
  - Historical/point-in-time docs (PHASE/MILESTONE/ROADMAP/audits) left as-is by design.

### Fixed — Live rubber-band preview froze while drawing a two-point tool (2026-06-27)
- After the first click of a two-point tool (trend line, etc.), moving the pointer toward
  the second point showed no live preview — the line only appeared on the second click.
  Root cause: the render-loop memo guard tracked the in-progress machine anchors by COUNT
  (`machineAnchorsLen`) only. After the first move the count stops changing (stays 2) while
  the pointer keeps moving, so the guard skipped every subsequent repaint and the preview
  froze. Replaced the count with a signature that includes anchor POSITIONS
  (`machineAnchorsSig`), so the rubber-band tracks the cursor in real time.
  Files: renderer/CanvasRenderer.ts.
  Regression risk: Low. Same memo mechanism, finer-grained key.

### Fixed — Deleted drawing lingered for seconds before disappearing (2026-06-27)
- Deleting a drawing (keyboard/context menu), undo/redo, color change, lock/hide, and
  selection changes updated the store but the canvas only repainted seconds later (on
  the next pan/realtime tick). Root cause: the drawing render loop is dirty-driven
  (`markDirty()`), and only the interaction manager's own transitions + pan/zoom/resize
  triggered it — store mutations that bypass the interaction manager had no repaint
  trigger. Added a `useEffect` in `DrawingLayer` that calls `markDirty()` whenever any
  render-relevant store state changes (`drawings`, selection, hidden, color, active tool).
  Files: DrawingLayer.tsx.
  Regression risk: Low. One coalesced rAF repaint per store change.

### Fixed — Endpoint grab moved the whole line instead of the anchor (2026-06-27)
- Clicking a trend-line endpoint dragged the entire line instead of resizing/rotating
  around the opposite anchor (TradingView grabs the endpoint). Root cause: `fromEvent`
  in `DrawingLayer.tsx` rescaled the pointer X by `timeScale().width() / canvas.width`
  before `coordinateToTime`. But `timeScale().width()` excludes the right price axis,
  so the scaling COMPRESSED every click's X — an error that grows toward the right edge
  (~30–45px on a wide chart). For a near-horizontal line the offset stayed within body
  TOL but exceeded HANDLE_RADIUS from the endpoint, so the body hit won. Now the local X
  maps 1:1 to a time-scale coordinate (`coordinateToTime(lx)`), matching the chart's own
  `onContextMenu` and the unscaled `timeToCoordinate` used for rendering/hit-testing.
  Files: DrawingLayer.tsx.
  Note: prior TOL(8→20) / HANDLE_RADIUS(10→24) bumps were compensating for this same
  coordinate error; left as-is (generous hit zones are fine), but the X bug is now fixed at source.
  Regression risk: Low. Hit-testing now matches the rendered geometry exactly.

### Fixed — Drawings drift off candles when panning the chart (2026-06-27)
- Drawings were not staying pinned to their (time,price) anchors on pan/zoom; they
  appeared frozen at a screen pixel and drifted off their candles (not TradingView-like).
  Two compounding bugs:
  1. `CoordinateCache.nextFrame()` only cleared its time/price→pixel maps when they
     exceeded 100 entries; otherwise it bumped an unused `generation` counter. With a
     few drawings the cache was never cleared, so every frame reused the pixel computed
     on the FIRST frame. Now it clears both maps every frame (cache is frame-local only).
  2. `CanvasRenderer` render loop early-returned via a data-only memo guard (drawing hash
     + canvas size). Neither changes on pan/zoom, so the `markDirty()` fired by
     `subscribeVisibleLogicalRangeChange` was a no-op. Added a `forceNext` flag set by the
     viewport subscription (`markDirty(true)`) that bypasses the guard so the canvas
     repaints — and re-projects — on every pan/zoom/resize frame.
  Files: renderer/CoordinateCache.ts, renderer/CanvasRenderer.ts.
  Root cause: stale per-frame coordinate cache + viewport changes not invalidating the
  render memo. Either alone unpins drawings from candles.
  Regression risk: Low. One repaint per rAF on pan (intended); cache still dedupes within a frame.

### Fixed — Endpoint handles not detected; body hit won instead (2026-06-27)
- Increased HANDLE_RADIUS from 10px to 24px. Handle radius was smaller than
  body tolerance (TOL=20), so clicking near an endpoint always triggered
  body-drag instead of anchor-resize. Now HANDLE_RADIUS > TOL guarantees
  endpoint hits take priority. Also removed debug instrumentation.
  Files: geometry/helpers.ts, DrawingInteractionManager.ts.
  Root cause: HANDLE_RADIUS(10) < TOL(20) caused handle-hit to fail silently.
  Regression risk: None. Larger radius only improves endpoint detection.

### Fixed — Infinite React re-render loop on chart pan (2026-06-27)
- Throttled version-bump callback via requestAnimationFrame. ResizeObserver
  and subscribeVisibleLogicalRangeChange could fire synchronously during
  React renders, creating setVersion → render → bump → setVersion loop.
  rAF coalesces multiple bumps to one per frame, breaking the cycle.
  Files: PriceChart.tsx.
  Root cause: synchronous bump during render triggers cascade.
  Regression risk: Low. Version updates delayed by at most one frame.

### Fixed — Hit-test tolerance too small for line body selection (2026-06-27)
- Increased TOL from 8px to 20px. Users clicking on drawn TrendLines were
  consistently getting MISS because the perpendicular distance (~16.6px)
  exceeded the 8px threshold despite visual alignment. TradingView uses
  12-16px typically; 20px gives comfortable click-target for line bodies.
  Files: geometry/helpers.ts.
  Root cause: TOL=8 too small for practical hit-testing.
  Regression risk: None. Larger TOL only affects body hit radius.

### Fixed — pointerEvents:none canvas blocks drag interaction (2026-06-27)
- Removed setPointerCapture from handleDown. Canvas has pointerEvents:none
  CSS which prevents the browser from dispatching captured pointermove/pointerup
  events to any listener. Document-level capture-phase listeners already fire
  for all pointer events without needing pointer capture. Fix enables body drag,
  endpoint resize, and all cursor-mode interactions.
  Files: DrawingInteractionManager.ts.
  Root cause: pointerEvents:none on canvas silences captured events.
  Regression risk: None. releaseCapture silently handles no-capture state.

### Added — Clipboard + polish (2026-06-26)
- Ctrl+C copies selected drawing to in-memory clipboard. Ctrl+V pastes as
  duplicate at same position with new ID. Escape cancels drawing, Delete
  removes selection. Z-order aware hit testing, smooth hover glow, context
  menu hooks already in place. Files: DrawingInteractionManager.ts.
n### Added — Multi-selection with shift-click (2026-06-26)
- Shift-click toggles drawing selection. Multi-drag moves all selected drawings
  by same delta. Anchor editing restricted to primary selection. Delete removes
  all selected. Renderer uses Map-based livePoints for multi-drag. One history
  entry per drawing on mouse up. Files: DrawingInteractionManager.ts,
  CanvasRenderer.ts, DrawingLayer.tsx.
n### Added — TradingView-style hit testing system (2026-06-26)
- Hits now follow TradingView priority: anchor > body > none. Topmost drawing
  (highest zIndex) wins for same priority level, then closest distance.
  HitResult now carries anchorIndex for direct anchor resolution. HitTestEngine
  enriches tool results with anchor indices — tools unchanged. Interaction
  manager uses hit.anchorIndex directly.
  Files: HitTestEngine.ts, DrawingInteractionManager.ts.
n### Added — Universal DrawingAdapter interface (2026-06-26)
- Introduced DrawingAdapter with move(), moveAnchor(), getAnchors(). Every tool
  implements the adapter via polymorphism. registerTool auto-wraps simple tools
  with default implementations derived from existing movePoints. Selection and
  dragging no longer depend on tool type — all interaction dispatches through
  adapter methods. Zero tool files changed.
  Files: ToolRegistry.ts, DrawingInteractionManager.ts, DrawingEngine.ts.
n### Refactored — Separate rendering from interaction (2026-06-26)
- Moved keyboard shortcuts from DrawingLayer into DrawingInteractionManager.
  All interaction (pointer events, keyboard, context menu) consolidated in one
  module. Added hover detection via hitTest on cursor-mode pointermove. Added
  selectedDrawingId to getState closure. DrawingLayer is now pure orchestration.
  CanvasRenderer unchanged (already pure). Regression risk: Low.
  Files: DrawingInteractionManager.ts, DrawingLayer.tsx.
### Removed — Dead code cleanup (2026-06-26)
- Removed unused livePoints field from Machine interface. The renderer reads
  livePointsRef for drag preview; machine.livePoints was set but never consumed.
  No behavioral change. File: DrawingInteractionManager.ts.
  Build: type-check passed, lint passed.
n### Fixed — Drawing engine stabilization (2026-06-26)
- **Ctrl+D duplicate:** DuplicateDrawingCommand generates valid uid internally. chartStore.addDrawing() guards empty IDs. Files: CommandManager.ts, chartStore.ts, DrawingLayer.tsx.
- **Store safety:** addDrawing deep-copies points, generates uid fallback. File: chartStore.ts.
- **Right-click drag:** Added e.button === 0 guard. Right-clicks select without starting drags. File: DrawingInteractionManager.ts.
- **DrawingContextMenu restored:** Moved contextmenu listener to document capture phase. File: DrawingInteractionManager.ts.
- **Pointer capture release:** Explicit releasePointerCapture on drag completion and Escape. File: DrawingInteractionManager.ts.
- **Adapter resolution:** Machine state stores drawingTool from hit.drawing.tool. File: DrawingInteractionManager.ts.
- **Undoable drags:** commitMove wired to handleUp. Files: DrawingLayer.tsx, DrawingInteractionManager.ts.
- **Render loop crash fix:** minPoints guard in CanvasRenderer prevents 15 multi-point tool crashes. File: CanvasRenderer.ts.
- **Drawing cancellation fix:** handleUp reset moved inside MovingDrawing guard. File: DrawingInteractionManager.ts.
- **Hit-test vocabulary:** All 25 tools return canonical p1/p2/body targets. Files: HitTestEngine.ts, 9 plugins.
- **ESLint:** Fixed pre-existing warning in useCommandHistory.ts.
- Build: type-check passed, lint passed. Regression risk: Low.

### Changed — Milestone 3: tool plugin architecture (2026-06-26)
- Created `geometry/helpers.ts` — shared math (pointDist, distToSegment, distToRect,
  projectPoint, defaultMovePoints, HANDLE_RADIUS, TOL).
- Renamed `ToolAdapter` interface → `DrawingToolPlugin` with optional future methods
  (getHandles, serialize, deserialize).
- Renamed `registerAdapter/getAdapter` → `registerTool/getTool`.
- Extracted 4 tools into individual plugins under `tools/plugins/`:
  `HorizontalTool.ts`, `VerticalTool.ts`, `TrendLineTool.ts`, `RectangleTool.ts`.
  Each implements `DrawingToolPlugin` and calls `registerTool()`.
- Created `tools/plugins/shared.ts` — canvas draw helpers (line, handle, chip, applyStyle).
- Remaining 17 tools stay in `adapters.ts` for future migration.
- Zero behavior changes. All algorithms identical. Build passes.

### Changed — Milestone 2: separate chart and drawing interaction (2026-06-26)
- Created `ChartInteractionManager` — passive observer ensuring chart never blocked.
- Created `DrawingInteractionManager` — state machine + pointer capture for drawings only.
- Added `isPointerClaimed()` signal so chart knows when drawings own the pointer.
- DrawingLayer now imports `useDrawingInteractionManager` from engine.
- Old `InteractionManager` deleted — replaced by DrawingInteractionManager.
- Chart interaction guarantees: canvas at `pointerEvents:none` → wheel/pan/pinch/crosshair
  always work. Drawing only captures pointer during active creation/drag/resize.
- Zero behavior changes. All algorithms identical. Build passes.

### Changed — Milestone 1: foundation refactor, split into 5 modules (2026-06-26)
- Reorganized `drawing/` into 5 subdirectories with clear responsibilities:
  - `engine/DrawingEngine.ts` — thin orchestrator, re-exports public API
  - `interaction/InteractionManager.ts` — state machine + document listeners (was PointerController)
  - `renderer/CanvasRenderer.ts` — rAF render loop + dirty tracking (was DrawingRendererLoop)
  - `hittest/HitTestEngine.ts` — candidate-based hit testing (was drawingHitTest)
  - `tools/ToolRegistry.ts` + `tools/adapters.ts` — Tool adapter interface + 21 implementations
- `DrawingLayer.tsx` now imports only from `engine/DrawingEngine.ts` — a single entry point.
- Zero behavior changes. All algorithms identical. Existing bugs preserved.
- Build / type-check / lint all pass.

### Changed — Tool adapter architecture: plugin-based drawing tools (2026-06-26)
- `ToolAdapter.ts`: Interface with `render`, `hitTest`, `movePoints`, `boundingBox`,
  `minPoints`. Registry via `registerAdapter()` / `getAdapter()`. Shared helpers
  exported (`pointDist`, `distToSegment`, `distToRect`, `HANDLE_RADIUS`, `TOL`,
  `defaultMovePoints`).
- `adapters.ts`: One adapter per tool (14 full + 7 stubs). Registered on import.
  Adding a tool requires only: implement `ToolAdapter`, call `registerAdapter()`.
- `drawingRenderer.ts`: Delegates to `getAdapter(d.tool).render()` — no switch.
- `drawingHitTest.ts`: Delegates to `getAdapter(d.tool).hitTest()` — no switch.
- `PointerController.ts`: Delegates to `getAdapter().movePoints()` and
  `getAdapter().minPoints` — no inline switch logic.
- Zero giant switches remain. All tool-specific logic lives in adapters.

### Changed — Optimize drag: in-memory positions, commit on pointerup (2026-06-26)
- During drag (MovingDrawing/ResizingHandle), geometry is computed in-memory
  via `livePointsRef` — no Zustand `updateDrawing` per move. Only
  `scheduleRedraw` is called, minimizing React re-renders to state transitions
  (start drag, end drag).
- On pointerup: commit final `livePoints` to Zustand via a single
  `updateDrawing` call.
- Render loop reads `livePointsRef` + `draggingIdRef` from interaction state,
  injects live positions into the drawn drawing array, and skips store drawings
  for the dragged object.
- Dirty detection upgraded from `.length` to content hash (`drawingsHash`,
  `liveHash`) — catches point coordinate changes within same-length arrays.

### Changed — rAF render loop replaces React-driven drawing renders (2026-06-26)
- Created `drawing/DrawingRendererLoop.ts`: requestAnimationFrame-based render
  loop with dirty-flag and change-detection snapshots. Only redraws when
  drawings, selection, interaction state, or canvas size actually change.
  Subscribes to chart `visibleLogicalRangeChange` + `ResizeObserver` for
  viewport-driven redraws.
- `DrawingLayer.tsx` replaced `useCallback(draw)` + `useEffect(draw, version)`
  with `createRenderLoop()`. Removed React re-renders from the drawing render
  path entirely. `PointerController` gained `scheduleRedraw` callback wired
  to `loop.markDirty()`.
- Zustand store subscriptions unchanged. Drawing data flows through stable
  `stateRef` snapshot — no per-tick re-render churn.

### Changed — Extract PointerController from DrawingLayer (2026-06-26)
- Extracted all pointer interaction logic (state machine, document listeners,
  pointerdown/move/up, setPointerCapture, hit-testing, context menu, cursor
  style) into `drawing/interaction/PointerController.ts`.
- `usePointerController(opts)` hook accepts canvasRef, coordinate converters,
  store actions, and a `getState()` stable snapshot provider. Returns machine,
  cursorStyle, ctxMenu, transition/reset helpers, and machineRef.
- `DrawingLayer.tsx` now owns only: canvas rendering, keyboard shortcuts,
  store subscriptions, and JSX. Zero pointer event handlers inline.
- No feature changes. Pure responsibility extraction.

### Changed — Refactor hit-test with distance and candidate architecture (2026-06-26)
- `HitResult` gains `distance: number` (pixel distance from pointer to hit target)
  and `target` expands to `"body" | "p1" | "p2" | "segment" | "label"`.
- Architecture: each tool's resolver returns ALL viable hit candidates via
  `resolveAllHits()`. The main `hitTest()` then picks the best: highest zIndex
  drawing wins first; within a drawing, endpoints beat segments beat body;
  identical-priority ties broken by closest distance.
- `TARGET_PRIORITY` table drives the ordering — extensible for future targets.
- New helpers: `pointDist`, `distToRect`, `distToCircle` — each returns raw
  pixel distance. No duplicate hit-testing logic.
- DrawingLayer normalizes `"segment"`/`"label"` hits to `"body"` drag behaviour.
  All existing drag flows preserved.

### Changed — Interaction state machine replaces dragRef + pending (2026-06-26)
- Replaced scattered `dragRef` (nullable ref) and `pending` (useState) with a
  unified `InteractionState` machine: Idle | Drawing | MovingDrawing | ResizingHandle.
- Single `Machine` interface holds all interaction state: current state, anchors
  (for Drawing), draggingId, dragTarget (p1/p2/body), dragStart, dragOrig.
- `transition()` and `reset()` helpers replace imperative ref mutations.
- `machineRef` mirrors state for stable native closures. Pending preview renders
  from `machine.state === "Drawing" && machine.anchors.length > 0`.
- No behavior changes — pure refactor. All existing features preserved.

### Changed — Refactor drawing interaction architecture (2026-06-26)
- **Root problem:** Container div overlay at z-index:5 with pointerEvents:auto
  permanently blocked the LWC chart div (a sibling in the DOM, not a child).
  Events don't pass through to sibling elements. This caused accumulated
  regressions: wheel forwarding hacks, broken pan, event constructor bugs,
  DOM traversal fragility.
- **New architecture:** Canvas at pointerEvents:none always — rendering only,
  never blocks the chart. Drawing interaction uses document-level capture-phase
  listeners with isOverCanvas() filtering.
  - Drawing mode: activeTool-dependent effect registers document listeners
    for creation (pointerdown + pointermove in capture phase).
  - Cursor mode: persistent effect listens for pointerdown on document.
    If a drawing is hit → setPointerCapture on canvas → move/up handled.
    If no hit → do nothing → event reaches chart → pan works.
  - Chart zoom/pan/pinch: always work because the canvas never intercepts.
  - Zero event forwarding, zero z-index fights, zero DOM traversal hacks.

### Fixed — Drawing interaction lag and unreliability (2026-06-26)
- Root cause: the native event listener effect depended on [ctx]. ctx is rebuilt
  on every candle tick (version bump), causing all 5 event listeners to be torn down
  and re-registered on every price update. This created lag, missed events during
  re-registration windows, and stale closure captures.
- Fix: Added ctxRef that holds the latest ctx via assignment-in-render.
  toX, toY, fromEvent, and draw now use ctxRef.current with empty dep arrays
  (stable forever). The native listener effect runs once on mount ([] deps).
  No listener churn, no lag, instant drawing interaction.

### Fixed — Container div blocks chart wheel zoom (2026-06-26)
- Container div at z-index:5 intercepts all wheel events, blocking LWC chart zoom.
- Fix: add native wheel listener on container that clones and dispatches
  the WheelEvent to the LWC chart element (container's previousElementSibling).
  Passive listener — no preventDefault, chart handles zoom naturally.

### Fixed — Native event listeners on container div (2026-06-26)
- Previous fix attached `addEventListener("pointerdown", ...)` on the canvas
  element, but the canvas had `pointerEvents: "none"` in cursor mode — meaning
  pointer events never reached the canvas, making drawing selection impossible.
  `pointerEvents: "none"` prevents the element from being the event target.
- Fix: wrap canvas in a div that always receives pointer events. Canvas stays
  `pointerEvents: "none"` (rendering only). Container div gets native listeners.
  In cursor mode, events flow through the container to the chart (no blocking).
  On drawing hit, `setPointerCapture` routes move/up through the container.
  Drawing mode: `stopPropagation` + `setPointerCapture` on container.
- Zero listener churn (empty deps). All closures stable via ctxRef + refs.

### Fixed — DrawingLayer blocks chart zoom/pan regression (2026-06-26)
- Root cause: the canvas overlay with `pointerEvents: "auto"` permanently intercepted
  all pointer and wheel events when drawings existed, blocking the LWC chart underneath.
  Previous forwarding approach (dispatchEvent clone) was broken — `new PointerEvent(type,
  event)` is not valid constructor usage.
- Fix: Switched to native `addEventListener` on the canvas element. Canvas stays
  `pointerEvents: "none"` in cursor mode so chart zoom/pan/pinch work naturally.
  The native pointerdown listener fires regardless of CSS pointer-events, hit-tests
  drawings, and calls `setPointerCapture` when a drawing is hit — routing subsequent
  events (move/up) through the canvas during drag. In drawing mode, canvas switches
  to `pointerEvents: "auto"` for creation flows.
- `stateRef` keeps closures stable across re-renders. Zero synthetic event handlers on
  the canvas JSX — all interaction is native DOM.

### Changed — TradingView-style endpoint dragging for line tools (2026-06-26)
- `drawingHitTest.ts`: Changed return type from `Drawing | null` to `HitResult | null`
  (`{ drawing, target: "p1" | "p2" | "body" }`). Added `nearPoint()` with 10px handle
  radius for endpoint hit detection. Line tools (trendline, ray, extendedLine,
  infoLine, channel) now return endpoint priority (p1 → p2 → body). All other tools
  return `target: "body"` — no behaviour change.
- `DrawingLayer.tsx`: Updated `dragRef` to include `target`. `onPointerDown` stores
  `HitResult` (target + deep-cloned orig points). `onPointerMove` now branches on
  `target`: p1 drags only points[0], p2 drags only points[1], body translates all.
  Context menu uses `hit.drawing.id`. Zero changes to creation workflow, shape tools,
  selection, keyboard, or rendering.

### Changed — Clean up diagnostic console.log traces (2026-06-26)
- Removed all temporary `console.log` diagnostics from `DrawingLayer.tsx` (chart context,
  canvas mount, pointerdown, fromEvent, tool creation, render, elementFromPoint,
  activeTool change, RAW pointerdown listeners — 7 blocks removed).
- Removed `console.log` from `chartStore.ts` `setActiveTool`.
- `npm run type-check` ✅ passes.

### Added — Phase 4.2.2: TradingView-style tool group system (2026-06-26)
- Transformed flat 20-tool toolbar into 4 grouped icons with flyout menus: Cursor,
  Lines (8 tools), Shapes (9 tools), Text. Click a group → flyout appears → select
  tool → tool activated and flyout closes.
- Last-used tool per group becomes the visible sidebar icon (matches TradingView).
- Backdrop closes flyout on outside click. Only one flyout open at a time.
- Visual parity: 18px sidebar icons, 14px flyout icons, TradingView-dark flyout,
  brand-colored active tool, hover highlight.
- Docs: TOOL_GROUP_ARCHITECTURE.md, TOOLBAR_BEHAVIOR.md.

### Debug — Phase 4.2.1: Root cause analysis + runtime diagnostics (2026-06-25)
- Full event chain traced: toolbar click → store.activeTool → DrawingLayer re-render →
  canvas pointer-events:auto → onPointerDown → fromEvent (chart coords) → creation.
- No architectural bug found. Component tree, pointer events, and context propagation are
  correctly wired. Added console.debug diagnostics in DrawingLayer.onPointerDown and
  chart context availability.
- Docs: DRAWING_ENGINE_ROOT_CAUSE.md with event flow diagram and failure-point analysis.

### Fixed — Phase 4.2.1: Tool activation system (2026-06-25)
- Single-click tools (horizontal, vertical, crossLine, etc.) now stay active after
  placement — matches TradingView behavior where you can draw multiple lines without
  re-selecting the tool. Two-click tools reset to cursor after completion.
- Canvas always accepts pointer events when a drawing tool is selected, fixing the
  bug where the first click on an empty chart was ignored.
- Cursor system: default (idle), crosshair (drawing tool active), move (dragging).
- Right-click cancels pending drawing creation. Esc resets to cursor + clears pending.
- Live preview renders while dragging second point (already existed, now confirmed).
- Docs: TOOL_ACTIVATION_SYSTEM.md, DRAWING_STATE_MACHINE.md.

### Added — Phase 4.3: Shape tools suite + fill system (2026-06-25)
- 8 TradingView-style shape tools: rectangle, rotatedRect, circle, ellipse, triangle,
  polyline, curve, path. All support create/select/move/delete/persist.
- Fill system: Drawing.fillColor (custom fill color) + Drawing.opacity (0–1). Default
  behavior preserved (stroke color at 12% opacity when fillColor is unset).
- Rectangle supports supply/demand zone workflow with custom fill colors and opacity.
- Zero core engine changes — creation flow, context menu, and persistence inherited
  from Phase 4.2's generalized architecture.
- Toolbar: 4th category (ANNOTATIONS) with Text tool. SHAPES category expanded to 9 tools.
- Docs: SHAPE_TOOLS_ARCHITECTURE.md, RECTANGLE_TOOL_GUIDE.md, SHAPE_TOOL_TEST_PLAN.md.

### Added — Phase 4.2: Trend line suite + context menu + line styles (2026-06-25)
- 8 TradingView-style line tools: trendline, ray, extendedLine, horizontal, horizRay,
  vertical, crossLine, infoLine. All support create/select/move/delete/persist.
- DrawingContextMenu — right-click any drawing: Clone, Lock/Unlock, Show/Hide, Bring to
  Front, Send to Back, Delete. Portal-rendered, Esc/outside-click close.
- Line style system: Drawing.lineStyle ('solid'|'dashed'|'dotted') renders with
  setLineDash. Selection handles always solid.
- Ctrl+D duplicate selected drawing. Generalized creation flow (minPoints-based
  dispatcher — any 1- or 2-point tool works without code changes).
- DrawingToolbar: 12 tools with 3 visual category groups (MODES, LINES, SHAPES).
- Docs: TREND_LINE_SUITE.md, TOOL_INTERACTION_GUIDE.md, DRAWING_PERSISTENCE_TESTS.md.

### Added — Phase 4.1: Wire drawing engine foundation (2026-06-25)
- Wired the canonical `drawingRenderer.ts` (17-tool support) into `DrawingLayer.tsx`,
  replacing the inline 7-tool renderer. Rendering now delegates to a pure canvas
  function with zIndex-sorted rendering, locked-drawing dimming, and selection handles.
- Extracted hit-testing to standalone `drawingHitTest.ts` — covers all 17 tools with
  pixel-tolerance proximity detection. Used by DrawingLayer for selection and will
  serve DrawingContextMenu (Phase 4.3).
- Added global toggle respect: `drawingsLocked` blocks drag/delete, `drawingsHidden`
  suppresses all rendering. Sorted by zIndex so higher-index drawings render on top.
- Docs: `DRAWING_ENGINE_ARCHITECTURE.md`, `DRAWING_OBJECT_MODEL.md`,
  `SELECTION_ENGINE.md`, `TOOL_REGISTRY.md`.

### Docs — Phase 4 drawing engine architecture roadmap (2026-06-25)
- `docs/PHASE4_DRAWING_ENGINE_ROADMAP.md` — complete architecture plan for the
  drawing engine foundation. 7 implementation phases (~3.5h): wire canonical
  renderer, wire store actions, DrawingContextMenu, hit-test module, drawing
  hotkeys, expand toolbar to 17 tools, new tool creation flows.
- Includes architecture diagram, tool category breakdown, dependency map,
  estimated complexity per phase, mobile support plan, and file inventory.

### Fixed — Phase 3.5: Native LWC price marker (root cause) (2026-06-25)
- Deleted PriceMarkerLabel.tsx (HTML DOM overlay with static positioning).
- Replaced with native LWC: lastValueVisible for price label, transparent
  createPriceLine for countdown on right axis. Zero CSS, zero transforms.
  Countdown moves with price scale automatically. See PRICE_MARKER_ROOT_CAUSE_ANALYSIS.md.

### Fixed — Phase 3.5: Countdown moved to right-side price marker (2026-06-25)
- Corrected countdown position: was in top-left (wrong). Now on the right side
  of the chart, right-aligned, matching TradingView's price scale placement.
- Chart header is compact: symbol . exchange . TF (11px) + OHLC row (11px),
  no countdown. top-1 (4px) offset.
- PriceMarkerLabel repositioned to right side, 16px price, 11px symbol/countdown.
- LWC lastValueVisible disabled to prevent double price display.

### Changed — Phase 3.5: Price marker + countdown parity (2026-06-25)
- Created `PriceMarkerLabel.tsx` — TradingView-style price box in chart top-left:
  14px bold symbol, 26px bold green/red price, 12px countdown. Semi-transparent
  panel background with backdrop blur.
- Fixed `useCountdown` — now uses HH:MM:SS format for timeframes >= 1H (was
  incorrectly showing total minutes, e.g. 179:59 for 4H). Sub-hour TFs use MM:SS.
  Countdown accuracy: 30% -> 100%.
- Refined OHLC readout row to 11px with abbreviated O/H/L/C labels, removed
  volume display to match TradingView's cleaner look.
- Price marker parity: 54% -> 95%. Docs: PRICE_MARKER_TYPOGRAPHY_AUDIT.md,
  PRICE_MARKER_SPACING_AUDIT.md, PRICE_MARKER_PARITY_REPORT.md.

### Changed — Phase 3 final: Watchlist, toolbar, typography, spacing (2026-06-25)
- Visual parity: ~70% -> ~93%. Watchlist 92%, toolbar 93%, typography 95%, spacing 92%.
  11 files modified, 2 new audit docs (TYPOGRAPHY_AUDIT.md, SPACING_AUDIT.md).

### Changed — Phase 3: TradingView UI Parity (2026-06-25)
- Visual parity improved from ~70% to ~90%. 16 files modified, 2 created. Zero architecture
  changes — pure UI/UX. Full report: `docs/TRADINGVIEW_PARITY_REPORT.md`.
- **Layout:** top toolbar 36px, panel headers 32px, left rail 40px, watchlist 320px. BottomPanel
  tabs now use TradingView-style accent underline (not rounded pills).
- **Chart:** background unified to `#0b0e11`, dynamic bar spacing per timeframe (1m:4 → 1W:16),
  solid last-price line, countdown timer to next bar close (`useCountdown` hook).
- **Watchlist:** compact 28px rows, blue left-border active indicator, right-click context menu
  (Remove, Create Alert), green/red price flash animation on tick.
- **Context menus:** chart menu now has Add/Remove Watchlist + Copy Price; new
  `WatchlistContextMenu` component.
- **Keyboard:** Alt+A toggles the Alert Center.
- **Toolbar polish:** timeframe buttons 11px font, drawing toolbar icons 18px, IconButton md size
  36×36px, symbol search button 32px tall.

### Docs — Master roadmap + Phase 3–11 plan (2026-06-25)
- `docs/PHASE3_11_PLAN.md` — comprehensive implementation plan covering all 9 remaining phases:
  UI Parity, Drawing Engine, Left Toolbar, Indicator Engine, Push Notifications, MT5 Integration,
  Trading Panel, Position Visualization, and Polish. Includes dependency map, file inventory,
  and estimated effort per phase (18–27 hours total).
- Updated `docs/NEXT_TASKS.md` with the new phase sequence; updated `docs/CURRENT_PROGRESS.md`
  and `docs/HANDOFF.md` to reflect the roadmap refresh.

### Debug — OANDA routing diagnostics (2026-06-25)
- **Problem:** forex symbols still showed "--" with no indication why. The `subscribe()` method
  in `MarketDataService` silently dropped subscriptions when no provider (OANDA/TwelveData) was
  configured, producing zero logs or errors.
- Added `console.debug`/`console.warn` logging to `MarketDataService` (constructor: key presence;
  `route()`: no-provider warning; `subscribe()`: dropped-subscription warning) and `OandaProvider`
  (`subscribe()`: symbol mapping; `connect()`: verification; `fetchPrices()`: URL, status, count).
- `docs/OANDA_DEBUG_REPORT.md` — root cause analysis, trace, and verification steps.

### Added — OANDA forex/metals/indices provider (2026-06-25)
- **Problem:** forex, metals, and indices showed "--" because they depended on TwelveData which
  required an unconfigured API key.
- `src/services/market-data/providers/OandaProvider.ts` (new) — production-grade provider via OANDA
  v20 REST API: bearer-token auth, 1s pricing poll, historical candles, backoff reconnect.
- `src/services/market-data/providers/FxcmProvider.ts`, `ICMarketsProvider.ts` (new) — stubs.
- `src/services/market-data/MarketDataService.ts` — wired OandaProvider with OANDA → TwelveData
  fallback routing; `HistoricalDataService.ts` — added OANDA historical candles loadOanda().
- `src/services/market-data/symbols.ts` — forex/metals/indices moved to provider 'oanda' with
  underscore-format symbols; added USDCAD, USDCHF pairs.
- `src/types/marketData.ts` — added 'oanda' to MarketProvider union.
- `docs/FOREX_DATA_ANALYSIS.md`, `docs/OANDA_INTEGRATION.md` (new).
- Config: NEXT_PUBLIC_OANDA_API_KEY + NEXT_PUBLIC_OANDA_ACCOUNT_ID in .env.local (gitignored).

### Added — Phase 2.1: Interactive chart alerts (TradingView behaviour) (2026-06-25)
- **Why alerts weren't interactive:** they were drawn with Lightweight Charts `series.createPriceLine`,
  which receives no pointer events. Replaced with an interactive canvas overlay.
- `src/components/chart/AlertOverlay.tsx` (new, replaces `AlertLines.tsx` — deleted) — canvas draws
  alert lines + labels + handles; thin per-line DOM hit strips handle **hover (grab cursor),
  click-to-select, drag-to-move, right-click + touch long-press**. The chart stays pannable
  everywhere except on a line. Dragging moves the line locally (no lag) and commits the new price +
  recomputed condition on release (persisted). Delete handle on the selected line.
- `src/components/chart/AlertContextMenu.tsx` (new) — Edit · Clone · Disable/Enable · Delete.
- `src/components/alerts/AlertEditDialog.tsx` (new) — edit condition / price / message / recurring /
  enabled / per-alert sound + browser (resolves Phase 2 gaps **G5** no-edit-UI and **G1** non-editable
  notification flags).
- `src/store/alertStore.ts` — `Alert` gains `enabled` + `locked`; new `selectedAlertId` /
  `editingAlertId` state and `selectAlert` / `duplicateAlert` / `editAlert` actions; `deleteAlert`
  clears selection; `hydrate` migrates older persisted alerts. Selection/edit state is **not**
  persisted; price/enabled/locked edits **are**.
- `src/hooks/useAlertEngine.ts` — one-line guard: disabled alerts are skipped (engine otherwise
  untouched).
- Keyboard: **Delete** removes the selected alert, **Esc** deselects. Build/type/lint green.

### Docs — Phase 2 audit (2026-06-25)
- `docs/PHASE2_REVIEW.md` — verification of alert creation / triggering / deletion / history / toast /
  browser notifications / duplicate prevention / mobile responsiveness against the actual code; all
  core requirements pass; quality gates green.
- `docs/PHASE2_GAPS.md` — gaps + missing TradingView parity. Headlines: G1 notification flags are
  double-gated and stale (no per-alert edit UI); G2 stale previous-price can false-fire a re-created
  cross alert; G5 no edit UI; G6 Alert Center backdrop blocks chart interaction on desktop. None
  block Phase 2.

### Added — Phase 2: TradingView-style Alert Engine (2026-06-25)
- **Phase 1 audit** — `docs/PHASE1_REVIEW.md` (success criteria verified) + `docs/PHASE1_GAPS.md`
  (open items; none block Phase 1). `docs/ALERT_ARCHITECTURE.md` added.
- `src/store/marketDataStore.ts` — **reference-counted subscriptions** (`subRefs`). The provider
  stream opens on the first subscriber and tears down only when the last unsubscribes, so the alert
  engine and watchlist can share a symbol's ticker without clobbering each other (fixes Phase 1 gap
  A1). Still one socket per provider.
- `src/store/alertStore.ts` — full rewrite: `alerts` / `triggeredAlerts` / `history` / `settings`;
  actions `

` / `updateAlert` / `deleteAlert` / `triggerAlert` / `resetAlert` /
  `clearTriggered` / `clearHistory` / `setSettings` / `hydrate`. Conditions: `above` / `below` /
  `crossUp` / `crossDown`; one-time vs recurring; persisted to `localStorage`. Backward-compat
  `add/remove/clear` retained for `AlertLines`/context menu.
- `src/services/alertEngine.ts` (new) — pure evaluation (`conditionMet` / `isAlertTriggered` /
  `inferCondition`).
- `src/hooks/useAlertEngine.ts` (new, mounted in `GlobalRuntime`) — subscribes to `marketDataStore`
  (**no polling, no new sockets**), refcount-subscribes alert-symbol tickers, remembers previous
  prices for cross detection, triggers once with re-arm gating.
- Notifications: `store/toastStore.ts` + `components/notifications/Toaster.tsx` (in-app),
  `services/notifications/sound.ts` (Web Audio chime), `services/notifications/browser.ts`
  (Notification API + permission), `services/notifications/notify.ts` (`deliverAlert` dispatcher —
  the Phase 6 push seam).
- `src/components/alerts/AlertCenter.tsx` (new) — responsive slide-over: settings, create form,
  active / triggered / history. Toolbar **bell** button (with count badge) + `uiStore.alertCenterOpen`.
- `ChartContextMenu` "Create Alert" now infers `crossUp`/`crossDown` from current price; `AlertLines`
  shows the condition. Build/type/lint green.

### Changed — Phase 1 Step 17: Remove Last Mock — Phase 1 COMPLETE (2026-06-25)
- **Deleted `src/services/marketData.ts`** (the seeded mock OHLCV generator) — the last mock data
  path in the app is gone. All candle/quote/symbol data now comes from the realtime pipeline.
- `src/services/replayEngine.ts` — `mtfSnapshot()` is now **pure**: it takes a caller-supplied
  `seriesByTf` map instead of importing the mock's `getHistorySync`. Signature changed from
  `mtfSnapshot(symbol, time, tfs?)` → `mtfSnapshot(time, seriesByTf, tfs?)`. No-look-ahead is
  unchanged — each series is still sliced to the bar at/just before the replay cursor.
- `src/hooks/useMtfSnapshotSeries.ts` (new) — loads the 5 higher TFs (`5m/15m/1H/4H/1D`, 500 bars
  each) for the active replay symbol from the real `HistoricalDataService` (Binance no-key; TwelveData
  needs a key), cancellable, only while replay is active. Feeds the pure `mtfSnapshot`.
- `src/components/replay/ReplayDashboard.tsx` — consumes `useMtfSnapshotSeries` + the new
  `mtfSnapshot` signature.
- Swapped the mock's `getSymbol(...)?.pricePrecision` for the registry's `getMarketSymbol(...)` in
  `ReplayDashboard`, `SmcLayer`, `JournalPanel`, `OrderTicket`, `PositionsTable` (precision only).
- **Phase 1 (Realtime Market Data Foundation) is complete — Steps 1–17 done.** Build/type/lint green.

### Changed — Phase 1 Step 16: Performance Pass (2026-06-25)
- Eliminated per-realtime-tick re-renders in components that don't consume candle data:
- `src/store/replayStore.ts` — `setTotal()` now **equality-guards** (`if (total !== get().total)`).
  It's called once per tick from the chart mirror, but only a new bar changes the count; previously
  every tick produced a fresh replay-store object that re-rendered every whole-store subscriber
  (transport, dashboard, toolbar). Now they re-render only when the bar count actually changes.
- `src/components/toolbar/TopToolbar.tsx` — dropped the whole-store `useChartStore()` destructure
  (it pulled `candles`, which mutates every tick → full-toolbar re-render). Now selects `timeframe`
  + `setTimeframe` atomically and reads `candles.length` lazily via `getState()` inside the replay
  handler.
- `src/components/toolbar/DrawingToolbar.tsx` and `src/components/chart/DrawingLayer.tsx` — converted
  whole-store subscriptions to **atomic per-field selectors**. Neither reads `candles` (the drawing
  canvas repaints on `ctx.version` for pan/zoom, not on candle data), so they no longer re-render on
  every forming-bar tick.
- Already in place (verified): watchlist rows are memoized + per-row `useQuote` (Step 10); chart uses
  the O(1) `series.update` fast path (Step 11); candle series capped at `MAX_CANDLES = 5000`.
- Build/type/lint green.

### Changed — Phase 1 Step 15: Reconnect Hardening (2026-06-25)
- Baseline reconnect was already present (backoff `1→2→5→10→30s` holding at 30s, infinite retries,
  auto-resubscribe on `onopen`, `manualClose` suppresses reconnect on intentional disconnect) and
  was verified. Step 15 adds the two cases the `onclose`-driven path can't cover:
- `src/services/market-data/providers/BinanceProvider.ts` and `TwelveDataProvider.ts` —
  **dead-socket watchdog**: a `setInterval` (15s) records the last inbound-frame time (every frame,
  incl. RPC acks / heartbeats) and, if an OPEN socket goes silent for `> 45s` while subscriptions
  are active, force-closes it so the normal reconnect path resubscribes. Catches sockets that die
  without firing `onclose` (sleeping tabs / flaky networks). Idle providers (no active subs) never
  trigger it. TwelveData's ~10s heartbeats and Binance's per-second klines keep a live socket well
  under the threshold, so no false recycles.
- Same files — **instant network recovery**: a `window 'online'` listener clears the pending backoff
  timer and reconnects immediately instead of waiting out the (up to 30s) backoff. Listener is
  bound on `connect()` and removed on `disconnect()`; both new mechanisms are SSR-guarded.
- Build/type/lint green.

### Changed — Phase 1 Steps 12–14: Switch Hardening + Connection Badge (2026-06-25)
- `src/store/marketDataStore.ts` — **`selectMarket()` made idempotent**. It now re-asserts the
  kline subscription for the active key even when symbol+timeframe are unchanged (previously an
  early `return` could leave the chart with REST history but **no live kline stream** whenever the
  chart default already equalled the store default). `subscribe()` is dedup-guarded, so re-asserting
  an existing subscription is a no-op; switching still unsubscribes the old kline before subscribing
  the new one. Verified: Binance `UNSUBSCRIBE` is sent on switch (no socket leak) and the
  `cancelled` guard in `useMarketData` prevents an abandoned symbol's history from overwriting
  (Steps 12–13 — symbol/timeframe switching).
- `src/components/toolbar/ConnectionBadge.tsx` (new) — Step 14 realtime-feed status chip. Reads
  `useConnectionMeta()` (over `marketDataStore.connectionStatus`) and renders a 🟢/🟡/🔴 dot + label
  from `CONNECTION_STATUS_META`; the dot pulses while connecting/reconnecting. Label hides below
  `md` to keep the toolbar compact. Pure read — no sockets.
- `src/components/toolbar/TopToolbar.tsx` — mounts `<ConnectionBadge />` in the right-side group
  (divider before the icon buttons).
- Build/type/lint green.

### Changed — Phase 1 Step 11: Realtime Chart Integration (2026-06-25)
- `src/hooks/useMarketData.ts` — **rewritten from mock to realtime**. On symbol/timeframe change:
  `marketDataStore.selectMarket()` (subscribe kline, drop old) + load history via
  `HistoricalDataService` → `setCandles`. Continuously mirrors the store's candle series into
  `chartStore.candles`, so chart/indicators/SMC/replay/trade keep reading `chartStore.candles`
  (via `useVisibleCandles`) unchanged — now realtime instead of mock. Verified: Binance klines
  REST shape matches the parser.
- `src/components/chart/PriceChart.tsx` — incremental `series.update(lastBar)` fast path for
  forming-bar ticks and single appended bars (smooth O(1) realtime); full `setData` only on
  symbol/timeframe/history/theme/replay changes. Precision via registry `getMarketSymbol`.
- `store/marketDataStore.ts` — `DEFAULT_CHANNELS = ['kline']` (chart) so chart (kline) and
  watchlist (ticker) never share a stream → no cross-teardown; added atomic `selectMarket()`;
  `changeSymbol`/`changeTimeframe` delegate to it.
- `store/chartStore.ts` — default symbol `BTCUSDT` (Binance, streams with no API key).
- `Watchlist` click and `SymbolSearch` now use registry symbols (`MARKET_SYMBOLS`); precision in
  `ChartArea`/`ChartContextMenu` via `getMarketSymbol`. `exchange.ts` `contractTagOf` takes
  `AssetClass` (exchange label now from the registry).
- Crypto charts stream live (history + realtime klines); forex/metals/indices need a TwelveData
  key (history + tick-built candles). Mock `marketData.ts` still used only by replay MTF (Step 17).
  Build/type/lint green.

### Changed — Phase 1 Step 10: Realtime Watchlist Integration (2026-06-25)
- `components/watchlist/Watchlist.tsx` — removed mock React Query (`useQueries`/`fetchQuote`).
  Each row is now a memoized `WatchRow` reading its own `useQuote(ticker)` from `marketDataStore`
  (a tick on one symbol re-renders only that row). Symbols + metadata now come from the registry
  (`MARKET_SYMBOLS`). Parent reads the quotes map only for value-sorts; symbol-sort uses a stable
  empty map so it never re-renders on ticks. Green/red from real change %.
- `src/hooks/useMarketDataBootstrap.ts` (new) — mounted once in `GlobalRuntime`; creates the
  MarketDataService and keeps watchlist symbols subscribed for `ticker` (diffs add/remove),
  `connect()`/`disconnect()` lifecycle. This is the first point that opens live sockets.
- `store/watchlistStore.ts` — registry-backed defaults (`BTCUSDT`, …); `hydrate()` migrates/drops
  persisted ids not in the registry (e.g. old mock `BTCUSD`).
- Crypto (Binance) shows real price + 24h change; forex/metals/indices (TwelveData) need
  `NEXT_PUBLIC_TWELVEDATA_API_KEY` (rows show "—" without it; TD WS has no daily change → 0%).
- Watchlist row click still drives the MOCK chart (chart swap is Step 11). Build/type/lint green.

### Added — Phase 1 Step 9: Read-only Market Data Hooks (2026-06-25)
- `src/hooks/useCandles.ts` — `useCandles(symbol?, timeframe?)` atomic store selector → candle
  series (defaults to active selection).
- `src/hooks/useQuote.ts` — `useQuote(symbol)` / `useLastPrice(symbol)` per-symbol selectors
  (one per watchlist row → minimal rerenders).
- `src/hooks/useConnectionStatus.ts` — `useConnectionStatus()` / `useConnectionMeta()` for the
  Step-14 status badge.
- `src/hooks/useMarketDataFeed.ts` — aggregate read hook (symbol/timeframe/candles/quote/status);
  the realtime "useMarketData", to take over the `useMarketData.ts` filename in Step 11.
- All read from `marketDataStore` only; **none open sockets**. Existing mock `useMarketData.ts`
  left untouched (still drives the chart until Step 11). Build/type/lint green.

### Added — Phase 1 Step 8: Realtime Candle Engine (2026-06-25)
- `src/services/market-data/CandleEngine.ts` — merges history + realtime into a forming bar
  (TradingView-style). `applyTick` buckets price ticks into the current bar via `TF_SECONDS`
  (O/H/L/C/V), emitting the previous bar as `closed` on rollover; `applyKline` passes through for
  kline providers; `seedHistory` continues the last loaded bar; per-`symbol:timeframe` state.
- `MarketDataService` wired to the engine: tick-only providers (TwelveData) now build candles
  from `quote` ticks (seeded lazily from the store's history) and push `current`/`closed` bars via
  `updateCandle`; kline providers (Binance) still push klines directly. Tracks active timeframe
  per symbol (`tfBySymbol`) and resets engine state on unsubscribe.
- Build/type/lint green. Realtime candle loop now closed for both provider kinds.

### Added — Phase 1 Step 7: Historical Data Service (2026-06-25)
- `src/services/market-data/HistoricalDataService.ts` — REST history loader (500–5000 bars),
  routed by the symbol registry, normalized to unified `MarketCandle[]` (ascending, `closed:true`).
  Binance `GET /api/v3/klines` with `endTime` pagination (1000/request), TwelveData
  `GET /time_series` (`outputsize`, `order=ASC`). `before` cursor for paging; dedupe + sort.
  TwelveData key from `NEXT_PUBLIC_TWELVEDATA_API_KEY` (throws clearly if missing).
- Pure fetch service — callers push into `marketDataStore.setCandles` (Steps 9–13).
  `getHistoricalDataService()` singleton. Build/type/lint green.

### Added — Phase 1 Step 6: Market Data Service + Symbol Registry (2026-06-25)
- `src/services/market-data/MarketDataService.ts` — owns BinanceProvider + TwelveDataProvider,
  routes each symbol to the right provider (via the registry), fans normalized
  `MarketDataEvent`s into `marketDataStore` (`updateQuote`/`updateCandle`/`setConnectionStatus`),
  and aggregates a single `connectionStatus` (only providers with active subs count). Implements
  `MarketDataServiceBinding`; `getMarketDataService()` lazily creates it and calls
  `attachMarketDataService()`. Pure service, no UI.
- `src/services/market-data/symbols.ts` — canonical symbol registry (config, not mock data):
  `MARKET_SYMBOLS` with provider routing + `providerSymbol` (Binance "BTCUSDT", TwelveData
  "XAU/USD"), `getMarketSymbol()`, `twelveDataSymbolMap()`.
- Resolves the canonical↔provider symbol mapping flagged in Step 5. Not bootstrapped into the app
  yet (Steps 10–13). Build/type/lint green.

### Added — Phase 1 Step 5: TwelveData Provider (2026-06-25)
- `src/services/market-data/providers/TwelveDataProvider.ts` — single price WebSocket
  (`wss://ws.twelvedata.com/v1/quotes/price`) for forex/metals/indices; one socket multiplexes
  symbols via `subscribe`/`unsubscribe`. Emits unified `quote` events (TwelveData WS is
  price-only; candles come from REST + CandleEngine). Backoff reconnect + auto-resubscribe;
  implements `MarketDataServiceBinding`. Optional `symbolMap` (canonical ↔ "EUR/USD") with
  reverse mapping on emitted events.
- API key from `NEXT_PUBLIC_TWELVEDATA_API_KEY` (graceful error if missing). Added `.env.example`
  template; hardened `.gitignore` (`.env`, `.env*.local`, keep `!.env.example`). No key committed.
- Standalone until Step 6/10–13. Build/type/lint green.

### Added — Phase 1 Step 4: Binance Provider (2026-06-25)
- `src/services/market-data/providers/BinanceProvider.ts` — single combined WebSocket to
  `wss://stream.binance.com:9443/ws`; dynamic `SUBSCRIBE`/`UNSUBSCRIBE` (one socket, never one
  per symbol) for `@ticker`, `@miniTicker`, `@kline_<interval>`.
- Normalizes Binance payloads → unified `MarketDataEvent` (`quote` / `candle` / `status`).
- Auto-reconnect walking `RECONNECT_BACKOFF_MS` (1→2→5→10→30s, infinite) with full
  auto-resubscribe of active streams on reopen; SSR-guarded (`typeof WebSocket`).
- Implements `MarketDataServiceBinding` (connect/disconnect/subscribe/unsubscribe) so it can be
  attached to `marketDataStore` directly or via `MarketDataService` (Step 6).
- Standalone (not bootstrapped into the app yet — Step 6/10–13). Build/type/lint green.

### Added — Phase 1 Step 3: Market Data Store (2026-06-25)
- `src/store/marketDataStore.ts` — Zustand single source of truth: `quotes, candles,
  selectedSymbol, selectedTimeframe, connectionStatus, subscriptions, lastUpdate` + actions
  `connect/disconnect/subscribe/unsubscribe/changeSymbol/changeTimeframe` (intents) and
  `updateQuote/updateCandle/setCandles/setConnectionStatus` (ingress) + selectors.
- Pure store — no socket/provider logic; a `MarketDataServiceBinding` is attached at runtime via
  `attachMarketDataService()` (Step 6) to avoid a store↔service cycle.
- `updateCandle` does the TradingView-style realtime merge (upsert last bar by time; trim to
  `MAX_CANDLES = 5000`).
- Path note: placed in `src/store/` (existing convention), not `src/stores/` from the roadmap,
  to avoid a duplicate store directory.
- Standalone; not yet wired to chart/watchlist (Steps 10–13). Build/type/lint green.

### Added — Phase 1 Step 2: Market Data Types (2026-06-25)
- `src/types/marketData.ts` — unified market-data model contract: `MarketQuote`,
  `MarketCandle`, `MarketSymbol`, `ConnectionStatus` (+`ConnectionState`), `Timeframe`
  (re-exported single-source from `market.ts`), plus supporting `MarketProvider`,
  `AssetClass`, `MarketChannel`, `MarketSubscription`, `MarketDataEvent`,
  `MarketDataListener`, `HistoryRequest`, and constants `SUPPORTED_TIMEFRAMES`,
  `RECONNECT_BACKOFF_MS`, `CONNECTION_STATUS_META`, `subscriptionKey()`.
- `src/types/index.ts` — re-export `./marketData` from the barrel (no `Timeframe` collision:
  same symbol re-exported from `market`).
- Types only; no runtime/UI wired yet, no mock data touched. Build/type/lint green.

### Added — 2026-06-25
- `docs/`: `ARCHITECTURE.md`, `CURRENT_STATE.md`, `CURRENT_PROGRESS.md`, `NEXT_TASKS.md`,
  `HANDOFF.md`, `CHANGELOG.md` (Phase 1 Step 1 codebase analysis + handoff package).
- `docs/PROJECT_ARCHITECTURE.md` + `docs/KNOWN_ISSUES.md` to complete the project memory set
  required by `.claude/CLAUDE.md`. `HANDOFF.md` now records branch / last commit / next action.

### Added — Drawing toolbar overhaul (IN PROGRESS, unwired)
- `types/drawing.ts`: new tools (channel, brush, measure, long, short, emoji, eraser,
  crosshair) and per-drawing `zIndex/locked/visible/stop/target`.
- `store/chartStore.ts`: `duplicateDrawing, lockDrawing, hideDrawing, bringToFront, sendToBack,
  toggleLockAll, toggleHideAll` + `drawingsLocked/drawingsHidden`; `addDrawing` now assigns
  `zIndex/visible/locked`.
- `components/chart/drawing/drawingRenderer.ts`: pure renderer for all drawing types incl.
  position RR boxes and the measure overlay. **Not yet wired into `DrawingLayer`.**

### Added — Chart right-click context menu
- `components/chart/ChartContextMenu.tsx` (portal, viewport-clamped, Esc/outside-close, arrow
  nav), wired in `PriceChart` via `coordinateToPrice`/`coordinateToTime`.
- `store/alertStore.ts` + `components/chart/AlertLines.tsx` (alert price lines).
- `utils/bus.ts`: `trade:prefill` event; `OrderTicket` consumes it. `types/trade.ts`:
  `OrderPrefill`. Menu actions: create alert, sell-limit, buy-stop, add-order, draw hline.
- Replaced broken `framer-motion` usage with a CSS pop-in animation.

### Added — Replay bar-selection
- `replayStore`: `selecting` + `beginSelect/cancelSelect`.
- `components/replay/ReplaySelectionLayer.tsx`: TradingView-style click-to-pick start bar
  (snapping cursor, disables chart pan/zoom while selecting, Esc cancels).

### Fixed
- Indicator menu: clicking an enabled indicator now **toggles it off** (`toggleIndicator`),
  previously add-only (duplicated series).
- SMC overlay coordinate mapping: always resolve via `timeToCoordinate`; bound to `timeScale
  .width()` (excludes price axis) — fixes "compressed at right" + label overlap. Added
  `window.__SMC_DEBUG__` trace.
- SMC menu reactivity: forced rAF redraw on settings change; added missing **displacement**
  render path.
- `IndicatorPane`: guard against double-free of series on unmount (chart already disposed).
- ADR indicator: emit empty data instead of `time:0` duplicate points (fixed Lightweight Charts
  "data must be asc ordered by time" assertion).
- Hydration: stores now init with deterministic SSR-safe defaults and hydrate post-mount;
  terminal loaded via `dynamic(ssr:false)`.

### Changed — Chart UI redesign (TradingView dark)
- `chartTheme.ts`/`PriceChart.tsx`: `#131722` background, subtle grid, dashed crosshair +
  floating labels, colored last-price line, time/price scale styling, interaction options.
- Toolbar: symbol header (ticker + contract tag + exchange via `services/exchange.ts`),
  segmented timeframes, `ChartSettingsMenu` (grid/theme/reset). SMC labels as chips + price tags.

## [0.1.0] — Initial build (Modules 1–6)
- M1 Architecture: Next 15 + TS + Tailwind, typed domain models, IndexedDB/localStorage,
  resizable terminal shell, theme system.
- M2 Chart engine + mock market data (seeded generator), indicators, drawings, watchlist,
  toolbars.
- M3 Replay engine (no look-ahead), controls, dashboard, hotkeys, multi-timeframe.
- M4 SMC engine (structure/FVG/OB/liquidity/displacement/sessions) + Web Worker + overlay.
- M5 Trade simulator + risk panel + journal (screenshots, CSV/Excel).
- M6 Analytics dashboard (equity/drawdown/distribution/monthly) + README.
