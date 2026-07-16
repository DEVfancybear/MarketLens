# Drawing Tools Maintenance and Refactor Plan

_Date: 2026-07-11; post-Phase 8 audit updated 2026-07-13; parity/Gann follow-up updated 2026-07-17_
_Status: implemented; current maintenance record: `DRAWING_TOOLS_POST_PHASE8_MAINTENANCE_2026-07-13.md`_
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

## 3. Repository baseline and current state

The original 2026-07-11 baseline motivated this plan; its historical counts are
kept in `DRAWING_PHASE0_CHARACTERIZATION.md`. The section below now summarizes
the implemented state after Phases 0-8 and the 2026-07-16/17 parity follow-up. The maintenance record
is in `DRAWING_TOOLS_POST_PHASE8_MAINTENANCE_2026-07-13.md`; the official-source evidence and honest
parity boundary are in `DRAWING_TOOLS_TRADINGVIEW_PARITY_AUDIT_2026-07-15.md`.

### 3.1 Current architecture

- The typed manifest contains 88 stable entries: four non-persistent interaction modes and 84
  persistent tools.
- Every persistent id resolves to exactly one adapter. Family files may register related ids; a
  one-file-per-tool layout is not required.
- `DrawingAdapter` owns render, hit-test, bounds, movement, anchor movement, and anchor discovery.
  Adapters receive runtime read-only data through explicit projector/interaction context and do not
  read chart/Jotai stores.
- Creation, settings, defaults, shortcuts, magnets, overlays, lifecycle, alert projection, Position
  side, and viewport-culling behavior are capability-driven from the manifest.
- Dirty-driven `requestAnimationFrame` rendering, coordinate caching, spatial culling, hit priority,
  immutable previews, history, versioned persistence, sync scopes, object groups, and bulk actions
  are separated into dedicated modules.
- The executable all-adapter Node contract validates all 84 persistent ids with capability-aware
  fixtures, finite bounds, render/hit/move/resize behavior, and exact anchor identity.

### 3.2 Implemented catalog

| TradingView group | Current coverage | Intentional boundary |
| --- | --- | --- |
| Trend tools | Trendline/ray/Info Line/extended/angle/axis lines, Parallel/Flat/Disjoint channels, exact Regression inputs/source/Pearson R, Pitchfork variants, dynamic line/channel alerts | Vertical/time alerts, touch tolerance, and alerts linked to later drawing edits use separate future contracts |
| Fibonacci/Gann | Legacy Fib, retracement/extension/channel/time/fan/arc/circle/wedge families, Pitchfan, Fib Channel alerts, Gann Fan/Square/Box with verified canonical ratios/eighths, independently styled levels, and logical-bar scale lock that captures the current ratio when enabled | Unverified TradingView template names are not fabricated; only observed built-ins plus bounded custom rows are claimed |
| Patterns | ABCD/XABCD/Triangle/Three Drives/Head and Shoulders, Elliott variants, Time Cycles | Automatic detection and full configurable ratio validation |
| Forecast/measure/data | Long/Short, ranges, Forecast, Sector, Bars Pattern, Ghost Feed, VWAP, profiles with complete-tick/lower-timeframe reconstruction and deterministic chart fallback | Bounded snapshots never guess missing tick/session history; remaining family settings require tool-specific official-source review |
| Shapes/freehand | Rectangle/Rotated Rectangle, circle/ellipse/triangle, arc/curves/path/polyline, pressure-aware Brush/Highlighter, arrows/marks | Mouse/touch retain constant configured width; only pen events supply normalized pressure |
| Annotations/rich content | Text/Emoji/Note/Callout/Comment/Price Label/Signpost/Flag, Table/Image/Social card | Executable third-party embeds are intentionally unsupported |
| Global controls | Modes, favorites/templates, keep drawing, Weak/Strong OHLC magnets plus optional visible-indicator snapping, interval visibility, object tree/groups/names, sync scopes, undoable bulk actions | Broader layout product UX remains outside the drawing-engine parity contract |

`fib` must remain loadable for backward compatibility but should not appear as a preferred new
creation type after migration to `fibRetracement` is proven.

The table above supersedes deferred-status statements inside the dated Phase 6/7 milestone
sections below. Those sections remain as historical delivery records and must not be read as the
current 2026-07-17 feature state.

### 3.3 Historical structural hotspots and resolution

| Area | Original risk | Current boundary |
| --- | --- | --- |
| Settings dialogs/toolbars | Concrete tool checks and duplicated controls | Manifest settings profiles/features plus shared schema/action registry |
| Interaction manager | Gesture logic mixed with DOM/chart arbitration | Creation/selection/transform/erase/text sessions with explicit outcomes |
| `DrawingLayer.tsx` | React wiring plus tool-specific runtime reads | Composition root that supplies projector, market, and adapter interaction context |
| Toolbar/hotkeys | Catalog metadata duplicated across JSX/hooks | Manifest groups/icons/shortcuts/defaults and duplicate validation |
| Position implementation | Geometry, market reads, formulas, and lifecycle coupled | Pure metrics/geometry/layout/creation/prefill plus explicit runtime context |
| Persistence queue | Last-write batches without version/conflict semantics | Versioned codec, retrying outbox, revision rebase, metrics, and tested conflicts |

### 3.4 Current compatibility net

- `allToolAdapterContract.test.ts` executes production adapters for all 84 persistent ids and checks
  registration, capability-aware fixtures, render, finite bounds, move, resize, selection, and exact
  `anchorIndex` identity.
- Family suites lock shared line/shape/Fib/channel geometry and Phase 8 range, radial, pattern,
  time-projection, snapshot, projection, and rich-content behavior.
- Creation modes, transform/selection/erase/text sessions, pointer-frame coalescing, viewport events,
  culling/memo keys, settings/defaults, coordinates, visibility, alerts, lifecycle, history, object
  tree, sync, codec, outbox, and conflict policy have executable contracts.
- Browser gestures remain the integration gate for pointer capture and chart pan/zoom arbitration;
  the spatial benchmark remains the repeatable performance characterization.
- Source-text regexes are not accepted as correctness evidence. Static checks that remain as utility
  diagnostics must not replace executable behavior tests.

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

Status: implemented on 2026-07-12.

Purpose: finish shared behavior before catalog expansion.

Suggested order:

1. Keep-drawing mode and tool-default persistence.
2. Weak/strong OHLC magnet with a pure snap service; optional indicator snapping was delivered in
   the 2026-07-16 follow-up.
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
  sampled freehand geometry is not collapsed onto candle values. Historical note: indicator
  snapping was deferred here and was delivered as the independent `Snap to indicators` preference
  on 2026-07-16.
- Creation previews/commits and Text anchors use the same resolver. Anchor resize snaps the active
  handle, while body and multi-object moves translate from a snapped primary reference anchor, so
  transaction boundaries and undo/redo remain unchanged.
- Unit tests cover Strong/Weak selection, weak distance rejection, duplicate-price determinism,
  modifier inversion, capability completeness, and transform reference geometry. Browser coverage
  verifies Strong creation snapping, Ctrl override, toolbar state, and reload persistence.

Delivered (item 3):

- Drawings now carry an optional explicit interval-visibility model. Historical payloads without the
  field remain visible on every interval, while boundary decoding orders and deduplicates supported
  intervals and safely drops unknown values.
- The shared Visibility tab exposes All intervals, Current interval, Current and above, and Current
  and below presets plus individual toggles for every supported chart timeframe. Object and Position
  dialogs consume the same field component and retain the existing preview/Cancel/OK transaction
  behavior.
- The shared drawing action registry contributes the same four quick presets to both the right-click
  menu and floating toolbar More menu. Applying a quick preset writes the same model displayed by the
  Visibility tab.
- `isDrawingVisibleAtTimeframe` filters the render and interaction inputs before spatial indexing,
  hit-testing, hover, selection, and overlay projection. Drawings remain in chart state and
  persistence while hidden by the active interval, and an invalid selection is released when an
  interval switch hides its drawing.
- Interval visibility is excluded from style templates and tool defaults, so neither operation can
  unexpectedly hide future drawings. Unit tests cover defaults, presets, disjoint manual choices,
  normalization, settings schema, and codec round trips. Browser coverage verifies settings and
  quick-action writes, interval filtering, selection release, and restoration when returning to an
  eligible interval.

Delivered (item 4):

- Every persistent point-based tool now exposes the shared Coordinates capability, including Text,
  Emoji, and Position profiles that previously lacked a complete coordinate tab. The manifest can
  contribute semantic stored-anchor labels; Long/Short Position use Entry, Target, and Stop without
  concrete tool-id checks in the shared editor.
- `DrawingCoordinatesFields` replaces the separate Fib and generic coordinate implementations. Each
  stored anchor exposes precise price, local date/time, Unix timestamp, and candle bar-index inputs,
  with the same layout and behavior across line, shape, level, annotation, freeform, and position
  families.
- Pure coordinate helpers clone immutable point arrays, reject non-finite edits, find the nearest bar
  by binary search, and clamp bar-index edits to available candle history. Date/time conversions are
  explicit and minute-stable.
- Coordinate previews continue through the settings transaction path: Cancel restores the immutable
  open snapshot, OK creates one history entry, and undo/redo round-trips all edited anchors together.
  Geometry remains in the existing persisted `points` contract, so no payload migration is needed.
- Contract tests assert Coordinates coverage for every persistent manifest entry, Text/Position tab
  coverage, semantic Position labels, immutable point updates, bar lookup/clamping, and date/time
  conversion. Browser coverage verifies precise price/time edits and a single undoable transaction.

Delivered (item 5):

- Drawings now carry optional normalized object names and flat, codec-safe group metadata. Group
  identity and name are repeated on members so the existing per-drawing local/backend persistence
  contract can round-trip groups without a new endpoint or a separate failure-prone workspace row.
- The right dock now hosts Watchlist and Object Tree tabs, with a top-toolbar shortcut to open the
  tree. The tree presents ungrouped drawings and contiguous group nodes in visual z-order, with
  manifest display names as the fallback for unnamed objects.
- Object rows support single/Ctrl multi-selection, inline rename, visibility, lock, and layer-order
  controls. Selected drawings can be grouped or ungrouped; group rows select and operate on all
  members, collapse independently as UI state, and move as a contiguous z-order block.
- A shared batch-property command makes group/ungroup, group rename, group visibility/locking, and
  layer moves one undo/redo transaction. Individual renames use the existing property command, so
  Object Tree changes share chart/settings history instead of maintaining a second undo stack.
- Boundary decoding trims names and group ids, caps user labels, supplies a safe fallback group name,
  and drops malformed optional metadata without quarantining otherwise valid historical drawings.
  Unit tests cover tree construction/order, labels, contiguous group moves, batch history, and codec
  round trips. Browser coverage exercises grouping, undo/redo, rename, hide, and lock on the real UI.

Delivered (item 6):

- Every drawing can now carry an explicit `chart-only`, `layout-symbol`, or `global` sync binding.
  The binding stores the symbol plus only the layout/chart identity required by its mode. Historical
  payloads without sync metadata retain the previous globally synchronized same-symbol behavior.
- A pure synchronization policy owns binding construction, context membership, layout projection,
  registry merging, and save-as rebinding. The per-symbol local/backend registry preserves objects
  owned by inactive layouts/charts while `drawingsAtom` exposes only the current context slice, so a
  scoped save or deletion cannot erase another layout's objects.
- Saved layouts persist a stable drawing-context identity. Loading a layout projects its scoped
  objects and the latest same-symbol global objects; saving as a new layout rebinds chart/layout
  objects to the new identity while global objects keep their shared identity.
- The left drawing toolbar exposes the persisted default mode for newly created objects. Individual
  objects can change mode from the shared context menu or Object Tree, and group mode changes apply
  to every member as one batch history transaction. Group creation is disabled for mixed sync modes,
  matching TradingView's group synchronization contract.
- Mode changes reuse the revision-aware drawing queue and last-write-wins conflict policy; they do
  not introduce a parallel sync channel. Codec normalization drops malformed optional bindings while
  retaining otherwise valid drawings. Tests cover all scope membership combinations, registry
  replacement, save-as rebinding, group compatibility, codec round trips, persisted creation defaults,
  group propagation, undo, and reload behavior.

Delivered (item 7):

- A pure bulk-scope resolver now defines object, selected, group, and all-drawings targets in one
  place. Lock and visibility use deterministic mixed-state convergence: mixed sets first become
  uniformly locked/hidden, and a second action toggles the uniform state back.
- `useDrawingBulkActions` is the shared mutation boundary for the left toolbar, chart context menu,
  floating drawing actions, and Object Tree. The Object Tree exposes selected-scope controls and
  group rows use the same resolver; the left rail exposes persisted Lock all, Hide all, and Remove
  all operations for the active chart/sync context.
- The former render-only `drawingsLocked` and `drawingsHidden` global flags were removed. All bulk
  lock/hide actions update actual drawing properties through the revision-aware store, so canvas,
  local/backend persistence, saved layouts, and Phase 6.6 sync projection observe identical state.
- `DeleteDrawingsCommand` removes or restores an ordered drawing set as one history entry. Object
  Tree bulk delete, toolbar remove-all, chart remove-all, floating actions, and keyboard multi-delete
  now share one transaction instead of pushing one command per drawing. Undo restores full drawing
  payloads and selection-aware UI actions keep selected-id state consistent.
- Pure tests cover every target scope, mixed/uniform lock and visibility transitions, labels, and
  multi-delete undo/redo. Browser coverage exercises selected and all-drawing lock/hide/remove with
  one Undo per operation, alongside the complete drawing interaction regression suite.

Delivered (item 8):

- The drawing manifest now owns an optional alert-projection capability. Eligible fixed geometry
  includes horizontal levels/rays/cross lines, rectangle boundaries, enabled Fib retracement and
  extension levels, and Long/Short Position entry, target, and stop levels. Shared actions expose
  Add alert only when a drawing projects at least one finite positive target.
- The drawing-alert dialog selects the projected target and reuses the existing above, below,
  cross-up, cross-down, recurrence, message, notification, and evaluation pipeline. It infers a
  safe initial crossing direction from the current quote without adding a parallel alert engine.
- Creation snapshots the target price plus immutable source provenance (drawing id/tool, target
  id/label, and timestamp). Moving, editing, synchronizing, hiding, or deleting the drawing cannot
  mutate the armed alert. Alert Center identifies drawing-created alerts and the Go API persists the
  optional source metadata through migration `0019_alert_source`.
- Historical 2026-07-12 boundary: sloped and time-varying geometry did not advertise alert
  capability while the evaluator accepted fixed prices only. Superseded on 2026-07-16 by the
  versioned time-indexed line/channel/Fib Channel target, shared open/push evaluator,
  previous/current trigger evidence, server recomputation, `armingRevision`, and `expired`
  lifecycle recorded in `DYNAMIC_DRAWING_ALERTS_PLAN.md`.
- Unit coverage verifies all projector families, unsupported tools, provenance immutability, and
  frontend API round trips. Go tests verify source validation and handler propagation; browser
  coverage creates an alert from a horizontal drawing, deletes the drawing, and proves the alert
  snapshot remains active.

Verification on 2026-07-12:

- `npm run typecheck`: passing.
- `npm run lint`: passing with 0 errors and the same 2 pre-existing Watchlist hook warnings.
- `npm run test:drawing`: 106/106 passing.
- `npm run test:position`: 26/26 passing.
- `npm run test:drawing-persistence`: 16/16 passing.
- `npm run test:alerts`: 22/22 passing.
- `go test ./...`: passing.
- `npm run test:chart-browser -- drawingInteractions.spec.ts`: 16/16 passing in 84.8 seconds.

Superseded on 2026-07-16: Weak/Strong remains the OHLC magnet-strength policy and `Snap to
indicators` is now an independent preference. Visible overlay values compete with OHLC candidates
by projected distance and safely fall back when an indicator source is unavailable.

Exit gate:

- Cross-tool behavior is capability-driven and tested against all eligible current tools.
- Global behavior does not introduce tool-id branches.
- Sync modes have explicit persistence/conflict tests.

### Phase 7 — Close parity gaps in existing tools

Status: implemented on 2026-07-12. See `DRAWING_PHASE7_PARITY.md` for the
per-family checklist and intentional differences.

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

Delivered:

- Trendline adds endpoint arrows, a selected midpoint, optional endpoint prices and stats, plus a
  manifest-owned visual 45-degree Shift constraint during creation and endpoint resizing.
- Parallel Channel uses its third anchor for price offset and supports editable ratio levels,
  left/right extension, background bands, direct text, and capability-scoped settings/defaults.
- Fib exposes all 24 rows with per-level text in addition to the existing one-color, extension, log,
  label, background, and fixed-level alert behavior.
- Text and Position parity items retain the direct-edit, interval/coordinate, symbol-aware formula,
  lifecycle, compact-label, and isolated trade-prefill contracts delivered in earlier phases.
- Brush/Highlighter commits use deterministic CSS-pixel simplification while retaining smoothed
  rendering. This milestone only persisted normalized pen pressure; the 2026-07-16 follow-up now
  renders it as bounded variable-width segments and preserves pressure transitions during
  simplification.
- Historical 2026-07-12 boundary: dynamic sloped line/channel alerts were deferred. The 2026-07-16
  follow-up supersedes this item with immutable dynamic line/channel/Fib Channel targets, canonical
  data-space channel geometry, open/push evaluation parity, server-verified evidence, arming
  revisions, and expiration.

Verification on 2026-07-12:

- `npm run typecheck`: passing.
- `npm run lint`: passing with 0 errors and the same 2 pre-existing Watchlist hook warnings.
- `npm run test:drawing`: 111/111 passing.
- `npm run test:drawing-persistence`: 17/17 passing.
- `npm run test:position`: 26/26 passing.
- `npm run test:chart-browser -- drawingInteractions.spec.ts`: 16/16 passing in 107.5 seconds.

Exit gate:

- Each supported tool has an explicit parity checklist, fixtures, behavior tests, and documented
  intentional differences.

### Phase 8 — Expand the catalog in bounded waves

Status: implemented on 2026-07-12. See `DRAWING_PHASE8_WAVE_A.md`,
`DRAWING_PHASE8_WAVE_B.md`, `DRAWING_PHASE8_WAVE_C.md`, and `DRAWING_PHASE8_WAVE_D.md`.

Do not add every missing tool in one phase. Use dependency-driven waves.

#### Wave A: low-cost reuse of stable families

- Price range, date range, date-and-price range.
- Flat top/bottom and disjoint channels.
- Notes, callouts, comments, price labels, signposts, and flags.
- Cyclic lines and Fib time zone.

Delivered:

- Added all 13 Wave A stable ids through the typed manifest and four reusable adapter families:
  measurement ranges, channel variants, annotations, and time projections.
- Reused shared creation sessions, settings schemas, text editing, coordinate/visibility controls,
  defaults, templates, sync scopes, object tree, history, codec, and persistence boundaries without
  adding tool-id dispatch to shared interaction code.
- Added family contract tests, all-tool codec fixtures, browser creation/undo coverage, official
  behavior notes, model/migration decisions, intentional differences, and a performance review.

Verification on 2026-07-12:

- `npm run typecheck`: passing.
- `npm run lint`: passing with 0 errors and 2 pre-existing Watchlist warnings.
- `npm run test:drawing`: 114/114 passing.
- `npm run test:drawing-persistence`: 17/17 passing.
- `npm run test:chart-browser -- drawingInteractions.spec.ts`: 17/17 passing.
- `npm run benchmark:drawing`: 5,000-drawing rebuild median 1.800 ms; query median 0.117 ms.

#### Wave B: shared level/fan geometry

- Fib channel, speed resistance fan/arcs, circles, wedge, trend-based Fib time, pitchfan.
- Gann fan, square, and box.
- Pitchfork, inside pitchfork, Schiff, and modified Schiff.

Delivered:

- Added all 14 Wave B ids through shared parallel-level, fan/time, radial, Gann-grid, and
  median-line adapters. The persistent manifest now covers 62 tools.
- Reused the existing Fib/channel level models and every cross-tool capability without adding
  concrete Wave B ids to interaction, settings, or persistence orchestration.
- Added a creation-only rollout flag, all-family render/hit/move/anchor/bounds contracts, external
  Fib Channel culling coverage, all-id codec fixtures, browser gesture coverage, official behavior
  notes, intentional differences, and performance review.

Verification on 2026-07-12:

- `npm run typecheck`: passing.
- `npm run build`: passing.
- `npm run lint`: passing with 0 errors and 2 pre-existing Watchlist warnings.
- `npm run test:drawing`: 117/117 passing.
- `npm run test:drawing-persistence`: 17/17 passing.
- `npm run test:chart-browser -- drawingInteractions.spec.ts`: 18/18 passing.
- `npm run benchmark:drawing`: 5,000-drawing rebuild median 1.921 ms; query median 0.152 ms.

#### Wave C: pattern framework

- ABCD, XABCD, triangle, three drives, head and shoulders.
- Elliott-wave variants and time cycles.

Delivered:

- Added five harmonic/chart patterns, five Elliott variants, and Time Cycles through one
  manifest-labeled pattern framework plus a bounded cycle adapter. The persistent catalog now
  covers 73 ids.
- Manifest point labels/counts drive creation, coordinate settings, fixtures, render labels, and
  browser gestures. Pure validators contribute ratio/structure feedback without store writes.
- Added 7-anchor fixtures, all-family render/hit/move/resize/bounds contracts, codec coverage,
  browser creation/undo coverage, rollout flag, official behavior notes, intentional differences,
  and performance review.

Verification on 2026-07-12:

- `npm run typecheck`: passing.
- `npm run build`: passing.
- `npm run lint`: passing with 0 errors and 2 pre-existing Watchlist warnings.
- `npm run test:drawing`: 121/121 passing.
- `npm run test:drawing-persistence`: 17/17 passing.
- `npm run test:chart-browser -- drawingInteractions.spec.ts`: 19/19 passing.
- `npm run benchmark:drawing`: 5,000-drawing rebuild median 1.993 ms; query median 0.146 ms.

#### Wave D: data-dependent and rich-content tools

- Anchored VWAP.
- Fixed/anchored volume profile.
- Regression trend.
- Bars pattern, ghost feed, forecast, sector.
- Table, image, and external/social embeds.

Delivered:

- Added all 11 Wave D ids through candle-snapshot, projection, and safe canvas-card adapter
  families. The persistent catalog now covers 84 ids.
- Added manifest-driven `anchor-to-latest`/`between-anchors` capture at creation commit, capped
  versioned candle snapshots, pure VWAP/regression/profile calculations, and bounded render/hit
  geometry that never reads the live candle store.
- Added discriminated table/image/social content with persistence-boundary limits, HTTPS/data-image
  validation, social-host allowlisting, and no HTML/script/iframe execution.
- Added numeric geometry tests, snapshot/codec security tests, all-family adapter contracts,
  browser creation coverage, rollout flag, official behavior notes, intentional differences, and
  performance review.

Verification on 2026-07-12:

- `npm run typecheck`: passing.
- `npm run build`: passing.
- `npm run lint`: passing with 0 errors and 2 pre-existing Watchlist warnings.
- `npm run test:drawing`: 128/128 passing.
- `npm run test:drawing-persistence`: 18/18 passing.
- `npm run test:chart-browser -- drawingInteractions.spec.ts`: 20/20 passing in 2.7 minutes.
- `npm run benchmark:drawing`: 5,000-drawing rebuild median 2.414 ms; query median 0.181 ms.

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

## 10. Post-Phase 8 maintenance milestone

The original recommended Phase 0/1 milestone is complete. Phase 8 closed with 84 persistent tools,
and the 2026-07-13 maintenance pass strengthened geometry parity and adapter purity across the full
catalog. See `DRAWING_TOOLS_POST_PHASE8_MAINTENANCE_2026-07-13.md` for the audited families, fixes,
contracts, and verification commands.

Future drawing work should be delivered as small capability/family changes and must keep:

1. the 88-entry manifest and 84-adapter registry in exact agreement;
2. one capability-aware fixture for every persistent id;
3. the executable all-adapter geometry contract green;
4. adapter store independence through explicit projector/interaction context;
5. render, hit-test, bounds, and handle geometry derived from the same projection; and
6. intentional TradingView differences and bounded-work limits documented.
