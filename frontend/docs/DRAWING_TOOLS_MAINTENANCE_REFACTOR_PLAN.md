# Drawing Tools Maintenance and Refactor Plan

_Date: 2026-07-11_  
_Status: proposed_  
_Scope: frontend drawing engine, drawing UX, persistence contracts, and drawing-specific backend APIs_

## 1. Objective

Maintain the current TradingView-style drawing behavior while making the engine safer to extend to
the rest of TradingView's drawing catalog.

The refactor must:

1. Preserve existing drawings and their persisted payloads.
2. Preserve chart pan, zoom, crosshair, replay, and drawing pointer behavior.
3. Remove tool-specific branching from shared interaction and settings components.
4. Make render, hit-test, move, resize, settings, serialization, and tests explicit capabilities of
   every tool.
5. Add missing cross-tool behavior before adding large batches of new tools.
6. Allow future tools to be added through one manifest/adapter path rather than edits across the
   toolbar, type union, dialogs, renderer, interaction manager, persistence, and tests.

This plan does not propose a one-shot rewrite. Every phase is intended to ship independently with
green compatibility gates.

## 2. Official TradingView research baseline

Primary sources reviewed:

- [Drawing tools available on TradingView](https://www.tradingview.com/support/solutions/43000703396-drawing-tools-available-on-tradingview/)
- [How to use various drawing tools](https://www.tradingview.com/support/folders/43000547459-how-to-use-various-drawing-tools/)
- [Trendline drawing tool](https://www.tradingview.com/support/solutions/43000518095-trendline-drawing-tool/)
- [Parallel channel drawing tool](https://www.tradingview.com/support/solutions/43000518117-parallel-channel-drawing-tool/)
- [Fibonacci retracement drawing tool](https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/)
- [Long and short position tools](https://www.tradingview.com/support/solutions/43000475660-how-to-use-long-and-short-position-drawing-tools/)
- [Text drawing tool](https://www.tradingview.com/support/solutions/43000516983-text-drawing-tool/)
- [Interval visibility](https://www.tradingview.com/support/solutions/43000686263-how-to-quickly-adjust-visibility-of-a-drawing-or-indicator/)
- [Drawing synchronization](https://www.tradingview.com/support/solutions/43000629998-my-drawings-do-not-get-synchronized-across-charts-or-layouts/)
- [Advanced Charts drawing architecture](https://www.tradingview.com/charting-library-docs/latest/ui_elements/drawings/)

The reference behavior has two dimensions.

### 2.1 Tool families

1. Trend lines, rays, axis lines, channels, regression tools, and pitchforks.
2. Fibonacci, Gann, time, fan, arc, wedge, and pitchfan tools.
3. Harmonic, chart, Elliott-wave, and cycle patterns.
4. Forecasting, positions, measurements, volume-based drawings, and projected price paths.
5. Geometric shapes, curves, freehand brushes, arrows, and markers.
6. Text, notes, labels, tables, callouts, comments, images, and social embeds.
7. Icons, emojis, and stickers.

### 2.2 Cross-tool behavior

- Data-space anchoring and precise coordinate editing.
- Direct text editing and tool-specific style controls.
- Per-timeframe visibility.
- Weak/strong magnet snapping, optionally including indicator values.
- Keep-drawing mode.
- Per-object and global lock/hide/remove.
- Undo/redo, clone/copy/paste, z-order, grouping, naming, and object-tree management.
- Tool favorites and drawing templates.
- Layout/global synchronization and autosave conflict behavior.
- Alerts on eligible lines, channels, Fib levels, and other supported drawings.

These cross-tool behaviors are architecture requirements, not toolbar decorations. New catalog
coverage should not be added until the corresponding shared contract is stable.

## 3. Current repository baseline

### 3.1 What is already strong

- Canvas overlay stores geometry in `(time, price)` data space.
- `DrawingAdapter` delegates render, hit-test, bounds, move, anchor move, and anchor discovery.
- Dirty-driven `requestAnimationFrame` rendering avoids React/store writes per pointer move.
- Coordinate and geometry caches, spatial culling, and hit priority are separated.
- Creation, move, resize, multi-selection, history, clipboard, templates, favorites, backend batch
  persistence, per-object lock/hide, z-order, and global lock/hide already exist.
- Settings expose Style, Text, Coordinates, and Visibility tabs.
- Existing backend drawing payload is opaque, which permits frontend model evolution when migrations
  are handled explicitly.

Baseline verification on 2026-07-11:

- `npm run test:drawing`: 20/20 passing.
- `npm run typecheck`: passing.
- `go test ./internal/drawings`: passing.

### 3.2 Current implemented catalog

| TradingView group | Current coverage | Main gaps |
| --- | --- | --- |
| Trend tools | Trendline, ray, info line, extended line, trend angle, horizontal line/ray, vertical line, crossline, parallel channel | Regression trend, flat top/bottom, disjoint channel, all pitchfork variants |
| Fibonacci/Gann | Fib retracement, trend-based Fib extension, legacy Fib | Fib channel/time/fan/circle/spiral/arc/wedge tools, pitchfan, all Gann tools |
| Patterns | None | XABCD, ABCD, triangle, three drives, head and shoulders, Elliott waves, cycles, sine line |
| Forecast/measure | Long and short position; non-persistent measure mode | Forecast, bars pattern, ghost feed, sector, persistent price/date ranges, volume profiles, anchored VWAP |
| Shapes/freehand | Rectangle, rotated rectangle, path, circle, ellipse, polyline, triangle, arc, curve, double curve, brush, highlighter, arrows/marks | Core catalog substantially covered; parity depth varies by tool |
| Annotations | Text and emoji | Note, price note, pin, table, callout, comment, price label, signpost, flag, image/social content |
| Global controls | Cursor, crosshair, eraser, measure, lock all, hide all, clear, favorites, templates | Zoom mode, magnets, keep drawing, interval visibility, object tree/groups/names, layout/global sync |

`fib` must remain loadable for backward compatibility but should not appear as a preferred new
creation type after migration to `fibRetracement` is proven.

### 3.3 Structural hotspots

| Area | Current size/risk | Refactor direction |
| --- | --- | --- |
| `ObjectSettingsDialog.tsx` | ~1,500 lines; tool checks and several dialog variants | Schema-driven sections contributed by tool definitions |
| `DrawingInteractionManager.ts` | ~900 lines; creation, selection, drag, resize, freeform, eraser, text special cases | Gesture/session controllers behind one state machine |
| `DrawingLayer.tsx` | ~760 lines; React wiring plus tool-specific position/trendline behavior | Thin composition root with overlay extensions registered by capability |
| `DrawingToolbar.tsx` | ~670 lines; catalog metadata embedded in JSX | Shared typed tool manifest used by toolbar, favorites, hotkeys, and analytics |
| `DrawingSettingsToolbar.tsx` | ~640 lines; duplicates settings/action knowledge | Reuse the same settings schema and action registry as the dialog |
| `PositionTool.ts` | ~900 lines; geometry, rendering, metrics, lifecycle | Split calculation, geometry, label layout, render, and hit-test modules |
| `BaseDrawing` | Large optional property bag shared by unrelated tools | Versioned base envelope plus tool-specific discriminated properties |
| Persistence queue | Debounced last-write batch without revision/conflict semantics | Version-aware writes, flush lifecycle, conflict policy, and tests |

### 3.4 Test gaps

The 20 drawing unit tests currently emphasize shared line/shape geometry, culling, memo invalidation,
hit priority, the interaction-machine factory, and pointer-frame coalescing. They do not provide a
complete compatibility net for all persistent tool IDs.

Missing or thin coverage includes:

- Adapter registration and capability completeness for every `DrawingTool`.
- Render/hit/move/resize invariants for each adapter.
- Creation gesture contracts for one-point, two-point, fixed multi-point, freeform, and continuous
  tools.
- Settings schema, templates, and serialization round trips.
- Undo/redo for creation, deletion, movement, property updates, lock/hide, and z-order.
- Anonymous-to-authenticated migration and multi-symbol isolation.
- Batch retry, unload/flush, stale response, and multi-tab conflict behavior.
- Browser-level chart pan/zoom versus drawing capture behavior.
- Touch/pointer capture, double-click completion, Escape cancellation, and context menu interactions.
- Performance budgets with hundreds/thousands of mixed drawings.

The static `check:drawing-viewport` script currently reports a failure even though `PriceChart`
uses `subscribeChartViewportEvents`. Its source regex expects an older single-line call shape and
does not recognize the current multiline callback. This is evidence that source-text parity scripts
must be replaced with executable contract tests before they are used as refactor gates.

## 4. Target architecture

### 4.1 One typed tool manifest

Introduce a `DrawingToolDefinition<TProps>` that is the single registration point for:

- Stable tool id, schema version, display name, group, icon key, hotkey, favorite eligibility.
- Creation mode: one-point, two-point, fixed multi-point, click-freeform, or pointer-continuous.
- Minimum/maximum point rules and completion/cancellation policy.
- Geometry/render/hit-test adapter.
- Capability flags: text, fill, levels, stats, coordinates, interval visibility, alert eligibility,
  magnet eligibility, templates, and overlay extensions.
- Default properties and property validator/migrator.
- Settings section descriptors.
- Serializer/deserializer and test fixture factory.

The toolbar, adapter registry, settings UI, templates, clipboard validation, persistence validation,
and catalog tests must consume this manifest. A new tool should normally require one definition,
its family modules, fixtures, and tests—not changes to six shared components.

### 4.2 Versioned drawing model

Move gradually from the flat optional property bag toward:

```ts
interface DrawingEnvelope<TTool extends DrawingTool, TProps> {
  id: string;
  schemaVersion: number;
  tool: TTool;
  points: Point[];
  common: CommonDrawingProps;
  props: TProps;
  metadata?: DrawingMetadata;
}
```

Rules:

- Keep a compatibility decoder for existing flat payloads.
- Migrate on read and persist the current version only after a successful decode.
- Unknown future properties must not crash workspace loading.
- Unknown tool ids must be quarantined and logged, not silently discarded.
- Transient render fields such as `_dragging` must never enter persisted payloads.
- Templates store validated style subsets defined by the target tool capability, not one global key
  list.

### 4.3 Family services

Extract reusable families instead of copying complete adapters:

- Linear: finite line, ray, extended line, axis-constrained line, labels, arrow ends, stats.
- Channel: baseline plus offsets/ratios, parallel constraints, extensions, fills, level labels.
- Shape: polygon/ellipse/arc/curve construction, fill, text layout, closed-body hit tests.
- Level: Fib/Gann level calculation, log scale, label collision, extensions, active-level alerts.
- Pattern: labeled anchors, ratio calculations, segment styles, validation overlays.
- Projection: bar/time conversion, future whitespace coordinates, price/log scale conversion.
- Annotation: anchored versus screen-pinned layout, editable text, rich cells/content.
- Position/measurement: metrics independent from render and trade-prefill integration.

### 4.4 Interaction sessions

Keep one top-level state machine, but move behavior into explicit sessions:

- `CreationSession`
- `SelectionSession`
- `MoveSession`
- `ResizeSession`
- `FreeformSession`
- `ContinuousStrokeSession`
- `TextEditSession`
- `EraseSession`

Each session owns start/update/finish/cancel and produces commands at transaction boundaries. Shared
pointer code must not branch on concrete tool ids; it branches only on registered creation and
interaction capabilities.

### 4.5 Persistence and synchronization contract

Add explicit metadata for:

- Symbol and pane binding.
- Layout/chart identity.
- Sync mode: chart-only, layout-symbol, or global.
- Client revision/server revision.
- Created/updated timestamps and device/session origin.

Use optimistic local updates, idempotent client ids, and revision-aware server writes. Define a
conflict rule before enabling multi-tab/global sync. A safe first policy is last-write-wins per
object with delete tombstones and server revisions; grouping and multi-object transactions may later
require atomic operation batches.

## 5. Delivery plan

### Phase 0 — Freeze behavior and repair quality gates

Status: implemented on 2026-07-11. See
`DRAWING_PHASE0_CHARACTERIZATION.md` for the executable gates and recorded
baseline.

Purpose: establish evidence before structural changes.

Tasks:

1. Generate a catalog test that asserts every persistent tool id has exactly one registered
   definition and adapter.
2. Add parameterized adapter contract tests: valid fixture, render without throw, finite bounds,
   anchor identity, move translation, anchor movement, and body hit.
3. Convert source-regex parity scripts to imported unit/contract tests. Begin with viewport repaint,
   brush, path, vertical line, and shape text.
4. Add Playwright gesture smoke tests for chart pan, zoom, crosshair, create, select, move, resize,
   context menu, delete, undo/redo, and symbol switch.
5. Add persistence fixtures for every current tool, including old `fib` payloads.
6. Record performance baselines at 100, 500, 1,000, and 5,000 mixed drawings.

Exit gate:

- No known false-negative test scripts.
- Every current tool has a fixture and adapter contract test.
- Browser smoke suite is stable across three consecutive runs.
- Baseline frame/hit-test/persistence timings are checked into test artifacts or docs.

### Phase 1 — Consolidate registry and catalog metadata

Status: implemented on 2026-07-11.

Purpose: remove duplicated tool knowledge without changing visuals.

Tasks:

1. Add `DrawingToolDefinition` and migrate current adapter registrations.
2. Move toolbar groups, labels, hotkeys, defaults, and creation modes into the manifest.
3. Derive `DRAWING_TOOLS`, `MODE_TOOLS`, style families, favorites validation, and tool lookup from
   the manifest.
4. Add runtime duplicate-id detection and development-time completeness assertions.
5. Keep compatibility exports while callers migrate.

Exit gate:

- Pixel/gesture snapshots unchanged.
- No standalone hard-coded list of persistent tools outside the manifest and migration fixtures.
- Adding a fixture-only test tool demonstrates registration without shared UI edits.

Delivered:

- `types/drawingToolManifest.ts` is the single catalog for stable ids, display metadata, toolbar
  groups, icon keys, hotkeys, creation contracts, style families, defaults, favorite eligibility,
  and legacy/preferred creation state.
- `DRAWING_TOOLS`, `MODE_TOOLS`, `SHAPE_TOOLS`, `styleFamily`, favorite validation, and toolbar
  lookup/groups are derived from the manifest; compatibility exports remain in `types/drawing.ts`.
- Runtime registrations produce a typed `DrawingToolDefinition` combining manifest metadata with
  the adapter. Duplicate ids fail loudly, creation-contract drift is rejected, and the development
  adapter bootstrap asserts completeness.
- Shared creation interaction reads manifest creation modes rather than adapter-specific flags.
- Executable manifest and registry tests cover completeness, groups/defaults, creation modes,
  style families, favorite validation, definition registration, and duplicate rejection.

Verification on 2026-07-11:

- `npm run typecheck`: passing.
- `npm run test:drawing`: 33/33 passing.
- `npm run check:drawing-viewport`: 7/7 passing.
- `npm run test:chart-browser -- drawingInteractions.spec.ts`: 2/2 passing in 15.4 seconds,
  including three consecutive adapter-audit and gesture-transaction iterations.

### Phase 2 — Split interaction and DrawingLayer orchestration

Status: implemented on 2026-07-11.

Purpose: lower regression risk in pointer behavior.

Tasks:

1. Extract the interaction sessions listed in section 4.4.
2. Replace the `text`, position, and trendline special cases with capabilities/overlay extensions.
3. Centralize gesture transactions so every completed mutation emits exactly one undoable command
   and one persistence mutation.
4. Define pointer-capture ownership and chart-interaction arbitration in executable tests.
5. Make cancel behavior consistent for Escape, right-click, tool change, symbol change, unmount, and
   pointer cancellation.

Exit gate:

- `DrawingInteractionManager` is an orchestrator, not a tool dispatcher.
- No concrete persistent tool id checks in shared pointer code.
- Browser gesture suite and performance baselines do not regress beyond the agreed budget.

Delivered:

- `CreationSession` owns one-point, two-point, fixed multi-point, click-freeform, and continuous
  creation state and completion rules. `DrawingInteractionManager` now translates pointer events
  into session outcomes instead of dispatching those gesture families itself.
- `TransformSession` owns immutable pointer-down snapshots and live move, resize, and multi-move
  geometry. Pointer-frame coalescing stays in the manager and pointer-up commits each affected
  drawing once against its original snapshot.
- Text placement, shape/trendline text editors, position settings, and position candle lifecycle
  are selected through manifest capabilities instead of concrete persistent tool-id checks in the
  shared manager/Layer orchestration.
- Escape, pointer cancellation, tool change, and unmount cancel creation; right-click explicitly
  finishes eligible freeform sessions. Transform pointer cancellation discards transient geometry.
- `EraseSession` resolves eraser targets through the shared hit-test service and dispatches one
  undoable delete. Manifest mode capabilities keep cursor selection, eraser capture, and
  crosshair/measure chart pass-through separate from persistent creation.
- `SelectionSession` owns shift-toggle, select/deselect, double-click settings, and transform-start
  decisions. Shared pointer wiring consumes outcomes and contains no concrete persistent tool ids.
- `TextEditSession` unifies standalone and attached text creation/update/cancel behavior. Attached
  edits use one reversible `PropertyChangeCommand`; no-op selection clicks no longer create move
  history entries.
- `drawingLifecycle` reconciles capability-eligible candle-driven state outside `DrawingLayer`, and
  `drawingOverlayTargets` projects capability-contributed shape/line text overlays outside the
  component composition root.
- Tool changes, symbol changes, Escape, pointer cancellation, and unmount release session state,
  pointer ownership, transient geometry, and chart pan/zoom arbitration consistently.
- Browser coverage verifies Escape cancellation, tool-change cancellation, right-click freeform
  completion, single undo/redo transaction behavior, movement, and restored chart interaction.

Verification on 2026-07-11:

- `npm run typecheck`: passing.
- `npm run test:drawing`: 49/49 passing.
- `npm run test:position`: 22/22 passing.
- `npm run check:drawing-viewport`: 7/7 passing.
- `npm run test:chart-browser -- drawingInteractions.spec.ts`: 6/6 passing in 33.1 seconds.
- `npm run benchmark:drawing`: no median regression; at 5,000 drawings rebuild median is 1.285 ms
  and visible-query median is 0.121 ms versus the Phase 0 values of 1.592 ms and 0.134 ms.

### Phase 3 — Schema-driven settings and templates

Status: implemented on 2026-07-11.

Purpose: remove the largest UI hotspot and make tool properties maintainable.

Tasks:

1. Define reusable field/section descriptors for line, fill, text, levels, stats, coordinates, and
   visibility.
2. Split dialog shell, field widgets, family sections, and tool-contributed sections.
3. Make the floating settings toolbar consume the same schema/action definitions.
4. Replace global `TEMPLATE_STYLE_KEYS` with per-capability template pick/apply validators.
5. Add preview/cancel/OK transaction semantics so cancel restores one immutable snapshot and OK
   creates one history entry.
6. Add accessibility tests for keyboard navigation, focus return, labels, and Escape.

Exit gate:

- No tool-specific settings branches in the dialog shell.
- Settings round-trip tests cover every current tool family.
- Templates cannot apply invalid fields or geometry across incompatible tools.

Delivered:

- The tool manifest now declares a settings profile and capability sections for line, fill, text,
  Fib levels, position stats, coordinates, visibility, and templates. `drawingSettingsSchema`
  derives tabs, field descriptors, template keys, and family metadata from that contract.
- Reusable field widgets moved out of `ObjectSettingsDialog`; the object dialog, position dialog,
  and floating toolbar select controls from the same schema instead of maintaining tool-id lists.
  The shared dialog shells contain no concrete persistent-tool equality branches.
- The global `TEMPLATE_STYLE_KEYS` allowlist was removed. Template save/apply now picks only fields
  supported by the source/target capability schema, rejects incompatible style families, and never
  applies geometry, ids, text content, visibility, or position account/risk inputs.
- Object and position dialogs capture one immutable open snapshot. Live edits remain previews,
  Cancel restores every original field (including clearing fields introduced during preview), and
  OK records one preview-aware command in the same history used by drawing gestures. Undo/redo
  round-trips the complete settings transaction without an extra mutation on OK.
- Both dialog variants expose labelled modal/dialog and tab semantics, focus the dialog on open,
  restore focus to the opener on close, label icon-only controls, and route Escape through Cancel.
  The browser smoke suite now checks dialog focus, tab roles/selection, Escape, and focus return.
- Contract tests cover all five current settings profiles (`line`, `shape`, `text`, `fib`, and
  `position`), transaction snapshot/commit behavior, single-entry undo/redo, and capability-scoped
  template validation.

Verification on 2026-07-11:

- `npm run typecheck`: passing.
- `npm run lint`: passing with 0 errors and the same 2 pre-existing Watchlist hook warnings.
- `npm run test:drawing`: 53/53 passing.
- `npm run test:position`: 22/22 passing.
- `npm run check:drawing-viewport`: 7/7 passing.
- `npm run check:template-save-dialog`: 6/6 passing.
- `npm run benchmark:drawing`: no material regression; at 5,000 drawings rebuild median is 1.360 ms
  and visible-query median is 0.120 ms versus the Phase 2 values of 1.285 ms and 0.121 ms.
- `npm run test:chart-browser -- drawingInteractions.spec.ts`: 7/7 passing in 31.6 seconds,
  including dialog focus, tab roles/selection, Escape, focus return, and the existing gesture suite.

### Phase 4 — Normalize geometry families

Status: implemented on 2026-07-12.

Purpose: reduce duplication and fix parity depth for the current catalog.

Tasks:

1. Consolidate line/ray/extended/axis geometry and endpoint decoration.
2. Rebuild channel on a three-anchor or baseline-plus-offset model; migrate existing two-point
   channel payloads.
3. Consolidate Fib calculation/rendering across legacy Fib, retracement, and extension.
4. Split `PositionTool` into calculations, geometry, labels, renderer, hit-test, and trade-prefill
   adapters.
5. Normalize curve sampling, tolerance scaling, device-pixel-ratio behavior, and bounding boxes.
6. Define label collision and offscreen/culling behavior for all labeled tools.

Exit gate:

- Current tools preserve stored coordinates and visuals within snapshot tolerance.
- No family duplicates calculation formulas across plugins.
- Hit-test geometry matches rendered geometry for every adapter.

Delivered:

- Linear tools use the shared `lineGeometry` projection, finite/ray/extended/axis hit-test,
  anchor, move, and bounds contracts; arrow endpoints continue through the shared decoration
  primitive. Parallel channel now has an explicit three-anchor creation contract. Its third anchor
  defines a signed normal offset, both rendered sides participate in hit-test and exact bounds, and
  historical two-point payloads retain their prior projected secondary-line formula.
- Legacy `fib` and preferred `fibRetracement` are thin registrations over one retracement family.
  Retracement and trend-based extension share level resolution, linear/log price calculation,
  formatting, projection, right-price-scale guard, and deterministic offscreen/collision label
  layout. Render, hit-test, and bounds consume the same projected level geometry.
- Position is split into tick/projection calculations, data-space move/resize geometry, projected
  geometry and hit-test, label layout, renderer/adapter assembly, TP/SL resolution, and
  trade-prefill modules. The stable `plugins/PositionTool` path remains a registration shim.
- Quadratic, cubic, smooth, arc, and double-curve hit geometry now uses adaptive sampling in CSS
  pixels. Device-pixel ratio remains a canvas transform concern, stroke tolerance scales for wide
  lines, and sampled bounds include the visible stroke radius.
- The stale source-regex Fib and Position gates were replaced by imported executable contracts for
  calculations, historical compatibility, six-handle geometry, body hit-test, drag width, TP/SL
  chronology, label collision, and persisted-hit fallback.

Verification on 2026-07-12:

- `npm run typecheck`: passing.
- `npm run lint`: passing with 0 errors and the same 2 pre-existing Watchlist hook warnings.
- `npm run test:drawing`: 59/59 passing.
- `npm run test:position`: 26/26 passing.
- `npm run check:drawing-viewport`: 7/7 passing.
- `npm run check:fibonacci-tools`: 3/3 passing.
- `npm run check:position-hit`: 2/2 passing.
- `npm run check:position-drag`: 6/6 passing.
- `npm run test:chart-browser -- drawingInteractions.spec.ts`: 7/7 passing in 35.5 seconds.
- `npm run benchmark:drawing`: at 5,000 drawings rebuild median is 1.585 ms and visible-query
  median is 0.130 ms, comparable to the Phase 0 values of 1.592 ms and 0.134 ms.

### Phase 5 — Versioned model and persistence hardening

Status: implemented on 2026-07-12.

Purpose: make refactors and synchronization safe for user data.

Tasks:

1. Introduce schema-versioned decode/encode with flat-payload compatibility.
2. Validate clipboard, local storage, API payloads, and templates at boundaries.
3. Test anonymous cache to authenticated backend migration.
4. Flush or explicitly preserve pending writes during symbol change, logout, tab close, and workspace
   reset.
5. Add server revision/conditional update support and delete tombstones.
6. Define and test stale-load cancellation and multi-tab conflict behavior.
7. Add metrics/logging for decode failures, retries, conflict resolution, and dropped unknown tools.

Exit gate:

- All historical fixtures load and round-trip.
- Interrupted/retried writes are idempotent.
- A stale symbol response cannot replace the active symbol's drawings.
- No user drawing is silently discarded on decode failure.

Delivered:

- `drawingCodec` is the sole drawing boundary codec. Historical unversioned flat payloads migrate
  to schema version 1; current payloads round-trip for every registered persistent tool; malformed,
  unknown-tool, and future-version payloads are quarantined with metadata-only diagnostics.
  Transient render state is stripped during encoding.
- Local drawing cache, saved chart layouts, backend rows, clipboard data, and local/remote drawing
  templates are validated before entering chart state. Migrated local data is rewritten only after
  successful decode, while rejected source values remain available under a per-symbol quarantine
  key.
- Drawing mutations carry monotonic client revisions. A persisted outbox coalesces writes by
  client id, survives anonymous sessions, symbol changes, logout, reload, page hide, and workspace
  reset, retries failures with capped exponential backoff, and merges acknowledgements without
  allowing stale responses to replace local geometry.
- Remote loads use a generation guard in addition to symbol matching, so an older same-symbol or
  previous-symbol response cannot replace newer chart state. Anonymous drawings merge into the
  authenticated resource set and enter the same idempotent outbox.
- Backend migration `0018_drawing_revisions` adds server revision, client revision, and delete
  tombstones. Conditional writes return HTTP 409 on stale revisions. The client resolves conflicts
  using an explicit last-write-wins rebase against the latest visible server revisions; delete and
  retry operations remain idempotent by client id.
- Executable persistence tests cover codec fixtures, every current tool, clipboard rejection,
  outbox coalescing/retry/hydration, stale load guards, conflict rebasing, persisted-hit-safe local
  mutation, backend batch idempotency, and HTTP conflict mapping.

Verification on 2026-07-12:

- `npm run typecheck`: passing.
- `npm run lint`: passing with 0 errors and the same 2 pre-existing Watchlist hook warnings.
- `npm run test:drawing`: 72/72 passing.
- `npm run test:drawing-persistence`: 13/13 passing.
- `npm run test:position`: 26/26 passing.
- `go test ./...`: passing, including drawing idempotency and revision-conflict HTTP contracts.
- `npm run test:chart-browser -- drawingInteractions.spec.ts`: 7/7 passing in 36.0 seconds.

### Phase 6 — Complete cross-tool TradingView behavior

Status: in progress; items 1-2 implemented on 2026-07-12.

Purpose: finish shared behavior before catalog expansion.

Suggested order:

1. Keep-drawing mode and tool-default persistence.
2. Weak/strong OHLC magnet with a pure snap service; indicator snapping as a later subphase.
3. Interval visibility model and quick presets.
4. Precise coordinate controls shared across all point-based tools.
5. Object names, grouping, and object-tree management.
6. Per-object sync mode plus layout/global synchronization.
7. Unified remove/hide/lock scopes and undoable bulk operations.
8. Drawing-alert capability contract, implemented only after drawing geometry and alert snapshot
   semantics are agreed.

Delivered (item 1):

- Keep Drawing is a persisted global preference exposed in the drawing toolbar. Completed
  creations retain the active persistent tool when enabled, while cancellation, symbol changes,
  and explicit Escape behavior still return interaction ownership safely to Cursor.
- Tool defaults are stored per stable manifest id and applied through one creation-default resolver
  for regular, continuous/freeform, position, and Text creation paths. Manifest defaults remain the
  base layer; confirmed user defaults override them without introducing tool-id branches.
- Confirming either drawing settings dialog saves future defaults for that tool. Only fields
  contributed by the tool's settings schema are eligible; object identity, points, text content,
  visibility/lock/z-order, revisions, projected TP/SL prices, lifecycle state, and transient render
  fields are excluded.
- The versioned local preference decoder ignores unknown versions, unknown tool ids, and fields
  outside each tool's capability schema. Keep Drawing and per-tool defaults survive reload without
  changing drawing payloads or backend persistence contracts.
- Contract tests cover default field scoping, precedence, preference decoding, and position-input
  persistence. Browser tests cover consecutive creation, active-tool retention, reload persistence,
  and Settings-to-next-creation default propagation.

Delivered (item 2):

- The drawing toolbar exposes persisted Off, Weak, and Strong magnet states. Weak/Strong selection
  survives reload, and Ctrl/Cmd temporarily inverts magnet enablement during both creation and edit
  gestures, matching the documented TradingView interaction.
- `snapPointToOhlc` is a pure CSS-pixel service. It selects the closest projected candle on the time
  axis and then the nearest distinct open, high, low, or close price. Strong mode always accepts the
  candidate; Weak mode applies a 12 CSS-pixel two-dimensional threshold so zoom and price magnitude
  do not alter sensitivity.
- Magnet eligibility is a manifest capability consumed by shared interaction code. All point-based
  persistent tools participate; pointer-continuous Brush/Highlighter strokes remain unsnapped so
  sampled freehand geometry is not collapsed onto candle values. Indicator snapping is intentionally
  deferred to its later subphase.
- Creation previews/commits and Text anchors use the same resolver. Anchor resize snaps the active
  handle, while body and multi-object moves translate from a snapped primary reference anchor, so
  transaction boundaries and undo/redo remain unchanged.
- Unit tests cover Strong/Weak selection, weak distance rejection, duplicate-price determinism,
  modifier inversion, capability completeness, and transform reference geometry. Browser coverage
  verifies Strong creation snapping, Ctrl override, toolbar state, and reload persistence.

Verification on 2026-07-12:

- `npm run typecheck`: passing.
- `npm run lint`: passing with 0 errors and the same 2 pre-existing Watchlist hook warnings.
- `npm run test:drawing`: 81/81 passing.
- `npm run test:chart-browser -- drawingInteractions.spec.ts`: 10/10 passing in 49.5 seconds.

Remaining: items 3-8 (interval visibility, shared coordinate controls, object
tree/grouping/names, sync modes, unified bulk scopes, and drawing alerts).

Exit gate:

- Cross-tool behavior is capability-driven and tested against all eligible current tools.
- Global behavior does not introduce tool-id branches.
- Sync modes have explicit persistence/conflict tests.

### Phase 7 — Close parity gaps in existing tools

Purpose: improve depth before breadth.

Priority examples:

- Trendline: arrow ends, midpoint, price labels, stats selection/placement, 45-degree Shift constraint,
  direct text editing, interval visibility.
- Channel: third anchor/price offset, custom levels, left/right extension, background, text, alerts.
- Fib: 24 editable levels, per-level text, one-color mode, left/right extension, log calculation,
  active-level alert geometry.
- Text: direct editing, background, border, wrap, exact anchor semantics, interval visibility.
- Position: formula fixtures for long/short, point value/lot size, compact labels, historical TP/SL
  resolution, future placement, trade-prefill isolation.
- Freeform/curves: simplification policy, smoothing, pressure-ready model, predictable completion and
  editing.

Exit gate:

- Each supported tool has an explicit parity checklist, fixtures, behavior tests, and documented
  intentional differences.

### Phase 8 — Expand the catalog in bounded waves

Do not add every missing tool in one phase. Use dependency-driven waves.

#### Wave A: low-cost reuse of stable families

- Price range, date range, date-and-price range.
- Flat top/bottom and disjoint channels.
- Notes, callouts, comments, price labels, signposts, and flags.
- Cyclic lines and Fib time zone.

#### Wave B: shared level/fan geometry

- Fib channel, speed resistance fan/arcs, circles, wedge, trend-based Fib time, pitchfan.
- Gann fan, square, and box.
- Pitchfork, inside pitchfork, Schiff, and modified Schiff.

#### Wave C: pattern framework

- ABCD, XABCD, triangle, three drives, head and shoulders.
- Elliott-wave variants and time cycles.

#### Wave D: data-dependent and rich-content tools

- Anchored VWAP.
- Fixed/anchored volume profile.
- Regression trend.
- Bars pattern, ghost feed, forecast, sector.
- Table, image, and external/social embeds.

Every wave requires:

- Official behavior notes and intentional-difference decisions.
- Model/schema migration plan.
- Render/hit/move/resize/settings/persistence tests.
- Browser gesture tests.
- Performance review and feature flag rollout.

## 6. Pull-request slicing

Keep PRs small and behavior-preserving:

1. Tests/fixtures only.
2. New abstraction alongside old path.
3. One family migrated at a time.
4. Compatibility adapter and payload migration.
5. Delete old path only after both paths pass the same fixtures.

Avoid PRs that simultaneously change model shape, geometry formulas, pointer behavior, settings UI,
and persistence. Such changes cannot be bisected safely.

## 7. Required CI gates

Each drawing PR should run:

- Typecheck and lint for touched code.
- Drawing unit/contract suite.
- Drawing persistence/API suite.
- Browser gesture smoke suite.
- Existing chart/replay interaction suites.
- Relevant family visual snapshots.
- Performance budget for renderer or hit-test changes.
- Historical payload migration fixtures for model changes.

Suggested budgets should be derived from Phase 0 measurements. Until measured, do not invent fixed
millisecond thresholds.

## 8. Rollout and observability

- Guard model/interaction refactors behind development or percentage feature flags when both paths
  can coexist.
- Log tool id, schema version, operation, and failure category without user drawing content.
- Track decode failures, persistence retry depth, conflict counts, render frame p95, hit-test p95,
  and pointer-session cancellations.
- Preserve old payload decoders for at least one release after all active data is migrated.
- Provide a rollback that disables the new behavior without rewriting persisted drawings backward.

## 9. Definition of done

The refactor is complete when:

1. Current user drawings load without visual or coordinate drift.
2. Tool metadata has one source of truth.
3. Shared interaction/settings code contains no concrete persistent-tool branching.
4. Every supported tool has adapter, settings, serialization, and gesture coverage.
5. Static source-regex checks no longer act as correctness gates.
6. Persistence is versioned, validated, observable, and conflict-aware.
7. Cross-tool TradingView behavior is implemented through capabilities.
8. New tool families can be delivered in small, independently testable PRs.

## 10. Recommended immediate milestone

Start with Phase 0 and Phase 1 only. Do not begin missing Gann, pattern, volume-profile, or rich
annotation tools until the catalog manifest and characterization suite are complete.

The first milestone should produce:

1. Tool manifest RFC and implementation.
2. One fixture per current persistent tool id.
3. Parameterized adapter completeness tests.
4. Replacement of the stale viewport source-regex check.
5. A small Playwright drawing/chart interaction smoke suite.
6. A checked baseline matrix for the 35 current persistent tool ids.

This milestone has the highest maintenance value and the lowest product-behavior risk.
