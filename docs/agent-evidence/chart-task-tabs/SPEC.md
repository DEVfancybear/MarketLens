# Executable SPEC — Chrome-style chart task tabs with backend sync

Status: **approved by user on 2026-08-24** (`Tôi duyệt SPEC chart-task-tabs này`)

Old-coder tier: **Tier 3** (durable cross-device workspace state, concurrency/conflict handling, and a new authenticated API contract)

Base source state: `2418d38356e4312ff20d26bbb6f0efbe6e5da350` on `master` after the user-requested fast-forward pull

SPEC path: `C:\Users\duong\Downloads\tradingview\docs\agent-evidence\chart-task-tabs\SPEC.md`

## 1. User-visible outcome

The desktop Chart workspace gets a 36px horizontal task-tab strip immediately above the existing chart surface. It behaves like a bounded Chrome-style tab strip:

- exactly one task is active;
- `+` opens a new task to the right of the active task;
- selecting a task restores that task's complete chart workspace;
- a task can be closed, but the final remaining task cannot be closed;
- task titles are derived from the active pane as `SYMBOL · TIMEFRAME` and update automatically;
- the strip scrolls horizontally instead of compressing task labels below a usable width;
- a signed-in user's task list is persisted in PostgreSQL through the Go backend and is restored on sign-in, reload, or another device.

Each task owns this chart state independently:

- stable task ID and drawing-layout context ID;
- chart arrangement (`single`, `two_horizontal`, `two_vertical`, or `grid_2x2`);
- all four stable chart-pane records and their symbol/timeframe selections;
- active pane slot;
- Replay scope preference (not a live Replay session);
- alert-line chart ownership;
- selected saved-layout ID when it still exists.

Theme, language, right/bottom panel visibility and sizes, watchlists, account/execution state, and notification settings remain shared application state. Mobile/touch presentation remains unchanged in this delivery.

## 2. Backend persistence contract

Task tabs live in the existing `user_settings.chart` JSONB document under `taskTabs`; no database migration or new table is planned.

Version 1 wire shape:

```ts
interface ChartTaskTabsDocumentV1 {
  version: 1;
  revision: number; // server-owned, starts at 0 and increments after accepted writes
  activeTaskId: string;
  tasks: Array<{
    id: string;
    drawingContextId: string;
    workspace: PersistedChartWorkspaceLayout;
    activeLayoutId: string | null;
  }>;
}
```

Authenticated endpoints:

- `GET /api/v1/settings/chart/task-tabs`
- `PUT /api/v1/settings/chart/task-tabs` with `{ expectedRevision, document }`

The backend derives the owner from the authenticated session. It never accepts a user ID from the request. `PUT` locks the user's `user_settings` row, compares `expectedRevision`, validates the document, increments the server-owned revision, and writes only `chart.taskTabs` while preserving unrelated chart settings. A stale revision returns `409` and does not change PostgreSQL.

Backend validation is fail-closed:

- schema version must be exactly `1`;
- 1–12 tasks inclusive;
- task IDs and drawing-context IDs are non-empty, unique, and at most 128 characters;
- `activeTaskId` names an existing task;
- each workspace is a JSON object and the whole task-tabs document is at most 512 KiB;
- `expectedRevision` is a non-negative integer;
- malformed JSON, duplicate IDs, unsupported versions, excessive tasks, and oversized documents return `400` without mutation.

`GET /api/v1/sync/bootstrap` continues to carry settings, so `settings.chart.taskTabs` hydrates without a second startup request. The dedicated `GET` endpoint is used for conflict refresh and diagnostics.

## 3. Frontend state and sync contract

- The task-tab store normalizes every external document and guarantees 1–12 unique tasks plus a valid active task.
- A new task starts as a **single-chart** task using the currently active symbol/timeframe, with a fresh task ID and drawing-context ID. It does not copy drawings, indicators, alert ownership, or an active Replay session.
- Before switching away, the outgoing task captures the latest active pane, layout, symbols/timeframes, Replay scope preference, owners, and saved-layout selection. The target task is then restored through existing chart/layout atoms.
- Switching or closing the Replay-owning active task must end the live Replay session before restoring another task. If Replay exit fails, the task switch/close is cancelled and a visible error is reported; Replay data must never appear in the target task.
- Switching cancels transient drawing creation/editing, indicator editing, selection, and crosshair state so interaction cannot continue in another task.
- Authenticated changes update the UI optimistically and enter one serialized 250ms-debounced sync queue. The queue sends the newest complete normalized document and advances only from the revision returned by the backend.
- A bounded pending document is retained in `sessionStorage` under the authenticated UID until acknowledged. It is cleared on acknowledgement and on sign-out; it is never applied to a different UID.
- Transient network/5xx failure does not roll back the visible task UI. The latest pending document remains queued and the user receives a visible warning.
- On `409`, the client retains the unacknowledged local document as a UID-scoped session recovery record, fetches/adopts the current server document, and emits a visible conflict warning. Version 1 intentionally does not auto-merge simultaneous edits to the same task.
- Anonymous users get the same in-memory multi-task UI, but task tabs are not written to backend or durable browser storage.
- Sign-out resets task tabs to one anonymous task and clears any authenticated pending/recovery data before the next user can see the workspace.
- During rollout, the existing `settings.chart.workspaceLayout` remains a backward-compatible mirror of the active task. Bootstrap priority is: valid `taskTabs`; otherwise migrate the existing `workspaceLayout`/current chart into one task; otherwise use current defaults/default saved layout.

## 4. Executable acceptance scenarios

### Scenario A — first task and migration

Given no valid backend `taskTabs` document, when Chart bootstrap finishes, then exactly one active task exists and its workspace matches the existing `workspaceLayout` or current chart defaults. For an authenticated user, the normalized one-task document is queued to backend once.

Tests:

- `frontend/tests/chart/chartTaskTabsStore.test.ts :: seeds one task from the legacy active workspace`
- `frontend/tests/chart/chartTaskTabsStore.test.ts :: normalization always returns one valid active task`
- `frontend/tests/browser/chartTaskTabs.spec.ts :: renders one selected chart task after bootstrap`

### Scenario B — add task

Given fewer than 12 tasks, when the user presses `+`, then a new active task is inserted immediately to the right, starts in single-chart mode with the former active symbol/timeframe, has unique task/drawing context IDs, and contains no copied drawing/indicator/alert scope.

Given 12 tasks, `+` is disabled and no state or backend write is produced.

Tests:

- `frontend/tests/chart/chartTaskTabsStore.test.ts :: adds a fresh task to the right without copying scoped content`
- `frontend/tests/chart/chartTaskTabsStore.test.ts :: refuses a thirteenth task without mutation`
- `frontend/tests/browser/chartTaskTabs.spec.ts :: plus creates and selects a second chart task`

### Scenario C — switch and restore independent workspaces

Given Task A is `EURUSD · 15m` with a 2x2 layout and Task B is `XAUUSD · 1H` with a single layout, when A → B → A is selected, then each task restores its exact arrangement, active pane, pane markets, drawing context, Replay scope preference, alert ownership, and saved-layout selection. The outgoing interaction/edit state is cleared.

Tests:

- `frontend/tests/chart/chartTaskTabsStore.test.ts :: captures outgoing and restores target workspace exactly`
- `frontend/tests/chart/chartTaskTabsStore.test.ts :: task switches clear transient chart interaction state through the coordinator contract`
- `frontend/tests/browser/chartTaskTabs.spec.ts :: two tasks retain independent symbols and arrangements across switches`

### Scenario D — close semantics

Given three tasks A/B/C and B is active, closing B activates C. Closing the last task activates its left neighbor. Closing an inactive task does not change the rendered active workspace. With one task, close is disabled and the state is unchanged.

Tests:

- `frontend/tests/chart/chartTaskTabsStore.test.ts :: closing active selects right then left neighbor`
- `frontend/tests/chart/chartTaskTabsStore.test.ts :: closing inactive preserves active workspace`
- `frontend/tests/chart/chartTaskTabsStore.test.ts :: final task cannot be closed`
- `frontend/tests/browser/chartTaskTabs.spec.ts :: close button follows neighbor and final-tab rules`

### Scenario E — durable backend sync

Given an authenticated user with backend revision 4, when a valid task change is saved with `expectedRevision: 4`, then the backend returns revision 5, persists only `chart.taskTabs`, preserves every unrelated settings key, and bootstrap returns the same normalized task order and active ID.

Tests:

- `backend/internal/settings/model_test.go :: TestChartTaskTabsValidationAndRoundTrip`
- `backend/internal/settings/handler_test.go :: TestChartTaskTabsGetAndPut`
- `backend/internal/settings/handler_test.go :: TestChartTaskTabsPutPreservesOtherChartSettings`
- `frontend/tests/chart/chartTaskTabsSyncQueue.test.ts :: serializes debounce and advances acknowledged revision`
- `frontend/tests/browser/chartTaskTabs.spec.ts :: authenticated task changes use backend sync contract`

### Scenario F — conflict and retry safety

Given two clients read revision 7, when client A writes first and client B writes with stale revision 7, then exactly A's document is durable, B receives `409`, and no partial B state is stored. B keeps its local document in UID-scoped session recovery, adopts the freshly fetched server document, and shows a conflict warning.

Given a response is delayed or a transient request fails, an older response must never replace a newer local document, and retry sends only the newest queued document.

Tests:

- `backend/internal/settings/model_test.go :: TestChartTaskTabsRejectsStaleRevision`
- `backend/internal/settings/handler_test.go :: TestChartTaskTabsConflictReturns409`
- `backend/internal/settings/repo_integration_test.go :: TestChartTaskTabsConcurrentCompareAndSwap` (runs only with a disposable integration database)
- `frontend/tests/chart/chartTaskTabsSyncQueue.test.ts :: stale conflict preserves recovery and adopts server`
- `frontend/tests/chart/chartTaskTabsSyncQueue.test.ts :: delayed acknowledgement cannot overwrite newer local state`
- `frontend/tests/chart/chartTaskTabsSyncQueue.test.ts :: transient failure retains only latest pending document`

### Scenario G — ownership, bounds, and malformed input

Unauthenticated requests return `401`. A request cannot select another owner. Invalid JSON, unsupported version, zero/13 tasks, duplicate IDs, missing active task, negative/non-integer revision, or a document over 512 KiB returns `400` and leaves the prior document unchanged.

Tests:

- `backend/internal/settings/handler_test.go :: TestChartTaskTabsRequiresAuthenticatedOwner`
- `backend/internal/settings/model_test.go :: TestChartTaskTabsRejectsInvalidDocuments`
- deterministic generated/property tests over task counts, duplicate IDs, active IDs, and revision values in both Go and TypeScript

### Scenario H — accessible Chrome-style tab strip

The strip exposes `role=tablist`; each task uses `role=tab`, `aria-selected`, roving `tabIndex`, a visible focus ring, and a labelled close button. Left/Right/Home/End move focus and activate the destination task. `+` and close work by keyboard. The active tab remains scrolled into view. At 200% zoom the strip scrolls without covering the chart or changing the existing dock geometry.

Tests:

- `frontend/tests/browser/chartTaskTabs.spec.ts :: tab semantics and keyboard navigation are accessible`
- `frontend/tests/browser/chartTaskTabs.spec.ts :: overflow remains usable at narrow desktop and 200 percent zoom`

### Scenario I — Replay and existing layout invariants

Switching/closing while Replay is live exits Replay before target restore; failure aborts the task mutation. Existing one/two/four-chart rendering, preview retention, symbol drop, saved layout, chart toolbar, and active `workspaceLayout` mirror remain green.

Tests:

- `frontend/tests/chart/chartTaskTabsStore.test.ts :: replay exit must succeed before switch or close commits`
- existing `tests/replay/replayLayoutStore.test.ts`
- existing `tests/browser/chartLayoutWorkspace.spec.ts`
- existing saved-layout/chart-settings persistence tests

## 5. Negative constraints / out of scope

The change must **not**:

- add chart-tab controls to mobile/touch in this delivery;
- change live order execution, account selection, MT5 commands, risk, or trade state;
- duplicate or keep background `ChartArea` instances mounted; only the active task renders/subscribes, preventing resource growth per task;
- delete durable drawings/indicators when a task closes;
- expose user IDs or trust owner fields from the browser;
- silently accept stale backend writes;
- replace unrelated keys in `user_settings.chart`;
- change the existing saved-layout CRUD contract;
- introduce rename, drag reorder, reopen-closed-tab, real-time WebSocket push, or automatic same-task conflict merge in version 1;
- add or upgrade npm/Go dependencies.

Every negative constraint will be mapped in EVIDENCE to a test, a diff/capability review, or an explicit unverified item.

## 6. Planned source and artifact changes

Expected implementation surface (the exact final list will be reported in EVIDENCE):

- `backend/internal/settings/model.go`, `handler.go`, `repo.go`
- `backend/internal/settings/model_test.go`, `handler_test.go`, `repo_integration_test.go`
- `backend/docs/API.md`, `backend/docs/DATABASE.md`
- `frontend/src/services/api/resources/settingsApi.ts`
- `frontend/src/store/chartTaskTabsStore.ts`
- `frontend/src/services/api/chartTaskTabsSyncQueue.ts`
- `frontend/src/components/chart/ChartTaskTabs.tsx`
- `frontend/src/components/desktop/DesktopTerminal.tsx`
- `frontend/src/hooks/useChartLayoutPersistence.ts`
- `frontend/src/hooks/useWorkspaceBootstrap.ts`
- `frontend/src/i18n/localization.ts`
- `frontend/tests/chart/chartTaskTabsStore.test.ts`
- `frontend/tests/chart/chartTaskTabsSyncQueue.test.ts`
- `frontend/tests/browser/chartTaskTabs.spec.ts`
- `frontend/tsconfig.test.json`
- `frontend/docs/CHART_TASK_TABS_ARCHITECTURE.md`, `frontend/docs/ARCHITECTURE.md`, `frontend/docs/README.md`
- `tools/verify-chart-task-tabs.ps1`
- `tools/verify-chart-task-tabs-mutations.ps1`
- `docs/agent-evidence/chart-task-tabs/EVIDENCE.md`

Generated/temporary outputs: `.test-build`, `.next`, Playwright traces on failure, Go/Node coverage profiles, and mutation backups. Verification scripts must remove stale reports before running and restore mutated source byte-for-byte in `finally`; generated outputs remain ignored and are not committed.

## 7. Dependencies, tools, and git authorization

- New runtime dependencies: **none**.
- New development dependencies: **none**.
- Existing tools: Go `1.26.5`, Node `24.18.0`, npm `11.16.0`, TypeScript, ESLint, Node test runner, and Playwright/Edge.
- `codebase-memory-mcp` MCP tools and CLI are unavailable in this session. The documented fallback was followed by reading `docs/CODEBASE_MEMORY.md`, project/frontend/backend architecture docs, and the exact source boundaries named above.
- Docker, local PostgreSQL tools, `SETTINGS_INTEGRATION_DATABASE_URL`, and `gitleaks` are currently unavailable. The disposable-database concurrency test will be implemented but will be recorded as skipped/unverified locally unless a disposable test database is supplied before the final gauntlet.
- Git: the user-requested `git pull --ff-only origin master` already completed before this SPEC. No branch creation, commit, push, reset, checkout, stash, or deletion of user changes is authorized by this SPEC. Mutation restore will not use destructive Git commands.

## 8. RED → GREEN → REFACTOR plan

1. Record fresh baseline failures for full frontend and Go suites.
2. Add minimal importable stubs for new modules where necessary.
3. RED backend validation/API tests; observe each new behavior failing.
4. GREEN backend model/handler/repository behavior; run full Go suite.
5. RED frontend domain/sync-queue tests; observe behavior failures.
6. GREEN normalized store, coordinator, backend queue, bootstrap/logout behavior; run full frontend unit suite.
7. RED Playwright UI scenarios; observe missing/incorrect tab UI.
8. GREEN accessible desktop tab strip and integration.
9. REFACTOR implementation only with assertions frozen; rerun suites after each refactor.
10. Run property, coverage, mutation, adversarial, build, browser, security/capability, and suite-health layers from the single verifier entry point.

Tests and implementation will never be edited in the same GREEN step. Assertions will not be weakened to pass.

## 9. Final gauntlet

Single rerunnable entry point from repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-chart-task-tabs.ps1
```

It will fail closed and run, at minimum:

1. source-state and clean mutation-restore checks;
2. `gofmt` check on changed Go files;
3. `go test ./... -race`;
4. focused Go coverage with an executable changed-line gate for the new settings paths;
5. `go vet ./...` and `go build ./...`;
6. frontend clean `test:build`, all compiled Node tests, deterministic generated/property cases, and focused Node coverage with nonzero thresholds;
7. `npm run typecheck`, `npm run lint`, and `npm run build`;
8. focused Playwright task-tab tests plus the existing chart-layout regression suite;
9. 3–5 plausible Go mutants and 3–5 TypeScript mutants; every mutant must be proven applied and killed, then sources restored byte-for-byte;
10. repeated focused suites to detect ordering/flakiness;
11. dependency/capability diff and secret-pattern scan of the patch (no dependency change expected);
12. a real handler execution and browser flow using mocked market/backend responses;
13. adversarial cases: oversized/malformed payload, duplicate IDs, stale revision, delayed responses, rapid add/switch/close, Replay-exit failure, sign-out/account switch, and narrow/zoomed tab overflow.

Any failed applicable layer blocks completion. Missing disposable PostgreSQL is an explicit unverified integration layer, not a pass.

## 10. Approval gate

Implementation may begin only after the user explicitly approves **this exact SPEC**. Any requested scope change produces a revised SPEC and requires a new explicit approval.

## 11. Amendment 1 — drag-and-drop task reordering (pending re-approval)

Requested by the user after the original approval on 2026-08-24. This amendment supersedes the original approval for all remaining implementation work. Existing work performed under the earlier approval is retained, but no additional implementation may proceed until the user explicitly approves this amended SPEC.

### Added outcome

Desktop chart tasks can be reordered horizontally by dragging a task tab, matching Chrome's direct-manipulation behavior. The implementation will follow the repository's existing pointer-reorder contract used by `TradeWorkspace` and Watchlist:

- primary pointer only;
- a 5px Euclidean movement threshold before drag activates;
- window-level `pointermove`, `pointerup`, `pointercancel`, and `blur` cleanup so a lost pointer cannot strand the UI;
- a before/after drop edge resolved from the horizontal midpoint of the target tab;
- a translated dragged tab/ghost plus a high-contrast vertical insertion marker;
- suppression of the click immediately following a completed drag;
- interactive close/add controls are excluded from the drag start boundary;
- dragging near the left/right edge of the scrollable tab strip auto-scrolls it with bounded `requestAnimationFrame` work;
- pointer cancellation, window blur, unmount, or a drop outside a valid target restores the original order and produces no backend write.

Reordering changes only the `tasks` array order. It preserves `activeTaskId`, every task ID/context/workspace/revision, and the currently rendered chart. The normalized reordered document enters the same authenticated backend sync queue; a no-op drop preserves document identity and does not enqueue a write.

Keyboard parity is added to the focused tab: plain Left/Right retains tab navigation, while `Shift+ArrowLeft` and `Shift+ArrowRight` move the focused task one position. A polite live region announces the new position (`<title> moved to position N of M`). The first/last boundary is a no-op.

### Added executable scenario J — reorder by pointer and keyboard

Given tasks A/B/C with B active, when A is dragged after C, then the order becomes B/C/A while B remains active and its rendered chart is unchanged. Reloading from the acknowledged backend document preserves B/C/A.

Given the focused task B, when `Shift+ArrowRight` is pressed, then the order changes by one position, focus follows B, the movement is announced, and the same backend document is queued. At either boundary, moving outward is a no-op with no sync.

Given pointer travel is at most 5px, the pointer is cancelled, the window blurs, the component unmounts, the drop is outside a task, or the close button is pressed, then no reorder occurs and no accidental tab activation/close is caused by drag cleanup.

Added tests:

- `frontend/tests/chart/chartTaskTabsStore.test.ts :: moves a task before or after without changing active identity`
- `frontend/tests/chart/chartTaskTabsStore.test.ts :: reorder boundary and same-target drops preserve document identity`
- `frontend/tests/chart/chartTaskTabsStore.test.ts :: generated reorder permutations preserve every task exactly once`
- `frontend/tests/browser/chartTaskTabs.spec.ts :: pointer drag reorders tasks and backend order survives reload`
- `frontend/tests/browser/chartTaskTabs.spec.ts :: drag threshold cancel blur and invalid drop preserve order`
- `frontend/tests/browser/chartTaskTabs.spec.ts :: Shift Arrow reorders with focus and live announcement`
- existing `frontend/tests/trade/executionAccountLayout.test.ts` and Watchlist drag suites remain green, proving the referenced interaction pattern was not regressed.

### Added failure modes and gauntlet work

- **Lost/duplicated task during reorder:** permutation/property tests assert identical ID multiset and payload references.
- **Active chart changes accidentally:** domain and browser tests assert stable `activeTaskId`, symbol, layout, and rendered surface.
- **Click fires after drag:** browser test asserts no activation/close after committed drag.
- **Stranded global listeners/animation frame:** cancel/blur/unmount tests plus implementation cleanup review.
- **Overflow task inaccessible:** narrow-strip browser test drags across overflow and observes bounded auto-scroll.
- **Reorder creates sync storm:** sync-queue test asserts one debounced newest document for rapid drag moves; only pointer-up commits state.

The mutation list gains at least one reorder edge flip (`before` ↔ `after`), one threshold boundary mutant, and one active-task corruption mutant. All must be killed. No dependency, backend schema, endpoint, mobile scope, or git authorization changes are introduced by this amendment.

### Amendment approval gate

Implementation may resume only after the user explicitly approves the SPEC including Amendment 1. The required approval phrase is: `Tôi duyệt SPEC chart-task-tabs bao gồm Amendment 1 drag-and-drop.`

Amendment 1 approval obtained from the user on 2026-08-24: `Tôi duyệt SPEC chart-task-tabs bao gồm Amendment 1 drag-and-drop.`

## 12. Amendment 2 — commit, push, and GitHub CI verification (approved)

Requested by the user on 2026-08-24 after the local gauntlet completed. This amendment changes only the delivery authorization in section 7; it does not change the product behavior, dependencies, schema, deployment state, or Amendment 1 drag-and-drop contract.

After approval, the agent is authorized to:

- finish `EVIDENCE.md` and run patch-integrity checks;
- stage only the chart-task-tabs task-owned paths listed in final EVIDENCE;
- create a normal non-amended commit on the current `master` branch and push that commit to `origin/master`;
- verify that the remote branch resolves to the pushed commit and monitor every GitHub Actions run triggered for that commit to a terminal conclusion;
- if a triggered check fails because of this task, make only in-scope repairs under this approved SPEC, rerun the risk-calibrated local gauntlet, create a follow-up commit, push it, and re-check the replacement CI run;
- report any runner/secret/service limitation as unverified rather than treating the push itself as proof that the missing local PostgreSQL race/integration layers passed.

This amendment does **not** authorize deployment, production backend restart, database migration, force-push, history rewrite, deletion of unrelated work, or weakening/skipping CI checks. A failing applicable CI check remains a delivery blocker.

Required approval phrase: `Tôi duyệt Amendment 2 commit push và kiểm tra GitHub CI cho chart-task-tabs.`

Amendment 2 approval obtained from the user on 2026-08-24: `Tôi duyệt Amendment 2 commit push và kiểm tra GitHub CI cho chart-task-tabs.`
