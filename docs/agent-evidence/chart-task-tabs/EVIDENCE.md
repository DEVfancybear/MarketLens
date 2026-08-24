# EVIDENCE — Chrome-style chart task tabs with backend sync and drag-and-drop

Date: 2026-08-24

Old-coder tier: Tier 3

SPEC: `C:\Users\duong\Downloads\tradingview\docs\agent-evidence\chart-task-tabs\SPEC.md`

Approved product scope: original SPEC plus Amendment 1, with the exact user approval `Tôi duyệt SPEC chart-task-tabs bao gồm Amendment 1 drag-and-drop.`

Delivery amendment: Amendment 2 was approved with the exact user approval `Tôi duyệt Amendment 2 commit push và kiểm tra GitHub CI cho chart-task-tabs.` Commit, push, remote-SHA verification and terminal GitHub Actions verification are authorized; deployment is not.

## Source and discovery state

- Repository root: `C:\Users\duong\Downloads\tradingview`
- Branch: `master`
- Base/source SHA: `2418d38356e4312ff20d26bbb6f0efbe6e5da350`
- The user-requested `git pull --ff-only origin master` completed before implementation.
- `codebase-memory-mcp` project/status/query tools were unavailable in this session. The mandatory documented fallback was followed: `docs/CODEBASE_MEMORY.md`, `docs/PROJECT_STRUCTURE.md`, backend/frontend architecture documentation, and every source boundary changed by this task were read directly. Empty MCP discovery was not treated as evidence that a symbol was absent.
- Toolchain: Go 1.26.5, Node 24.18.0, npm 11.16.0, TypeScript, ESLint, Next.js and the existing Playwright/Edge setup.
- Runtime/development dependency changes: none.
- Database migrations: none; persistence uses the existing `user_settings.chart` JSONB document.

## Delivered behavior

- Desktop-only Chrome-style task strip with one active task, add/activate/close semantics, a 12-task cap, horizontal overflow, roving tab focus, Home/End/Arrow navigation, separate labelled close controls, focus rings and sync status.
- Each task owns its chart layout/panes, active pane, markets/timeframes, Replay scope preference, alert owners, drawing context and active saved-layout ID. Switching captures the outgoing task and clears transient drawing/indicator selection, editing, active tool and crosshair state before restoring the target.
- Adding a task creates a fresh single-chart context using the current market/timeframe without copying drawing/indicator/alert scope.
- Pointer reorder follows the approved primary-pointer, 5px Euclidean threshold, midpoint before/after, pointer-up-only commit, invalid/cancel/blur/unmount no-op, click suppression, insertion marker and bounded edge auto-scroll contract. Reorder preserves the active task identity and payloads.
- `Shift+ArrowLeft` and `Shift+ArrowRight` reorder one position, preserve focus, no-op at boundaries and announce movement through a polite live region.
- Authenticated persistence uses `GET`/`PUT /api/v1/settings/chart/task-tabs`, session-derived ownership, row locking, compare-and-swap revision checks, server-owned revision increments, 409 conflicts, 512 KiB fail-closed validation and preservation of unrelated chart settings.
- Frontend writes are complete-document, serialized, 250ms-debounced and newest-state coalesced. Delayed acknowledgements cannot overwrite newer local state. Conflict and transient recovery are UID-scoped in `sessionStorage`; logout resets the queue and task state.
- Bootstrap consumes `settings.chart.taskTabs` from the existing settings payload, falls back to the legacy active workspace, and keeps `workspaceLayout` as the backward-compatible active-task mirror.
- Mobile presentation is unchanged.

## RED → GREEN → REFACTOR trace

The behavioral tests were added and observed failing before their implementations. Material RED observations retained from the implementation loop:

- Initial backend chart-task-tabs tests: 5 new failures before validation/store/handler implementation.
- Initial frontend model/queue tests: 16 new failures against importable stubs before the domain model and serialized queue implementation.
- `empty activeLayoutId` negative control initially returned `nil` instead of `ErrBadPatch`; validation was then fixed.
- Resetting to a new authenticated UID while an older request was in flight initially produced one request instead of two; the queue generation handoff was fixed.
- Transient failures initially triggered an automatic retry loop (three requests observed where one was required); rescheduling was constrained to generation changes.
- The first browser pointer-reorder run exposed the translated source tab intercepting `elementFromPoint`; the drag ghost was made pointer-transparent and the focused browser scenario then passed.
- Assertions were retained through GREEN/refactor. The final mutation gauntlet independently showed that cap, revision, drag-threshold and midpoint assertions detect plausible implementation faults.

## SPEC behavior mapping

| SPEC behavior/invariant | Executable evidence |
|---|---|
| A — migrate/normalize one valid task | `chartTaskTabsStore.test.ts`: legacy seed and normalization cases; browser bootstrap starts with one task |
| B — add isolated task and cap at 12 | model add/cap tests; browser isolation and 12-task overflow scenarios |
| C — capture/switch/restore task workspace and clear transient state | model capture/restore test; browser Grid 2x2 ↔ single restoration and Trendline → crosshair reset |
| D — close right/left/final/inactive rules | model close tests; UI close buttons are disabled structurally for the final task through non-rendering |
| E — durable authenticated contract and preservation | Go round-trip and handler GET/PUT tests; handler verifies the authenticated owner and unrelated `chart.style` preservation |
| F — stale/delayed/transient safety | Go stale-revision and 409 tests; all seven sync-queue tests, including old-ack, UID reset and no retry spin |
| G — authentication, malformed and bounded input | handler 401/malformed tests; table-driven invalid Go documents and generated counts 1–12 |
| H — accessible bounded tab strip | role/name-driven Playwright interactions, keyboard reorder/navigation implementation, focus semantics, 12-tab overflow and auto-scroll scenario |
| I — Replay/layout invariants | task actions await the existing fail-safe `exitReplaySession`; existing chart-layout Playwright regression is 10/10; Replay client/unit tests are included in the 876-test frontend suite |
| J — pointer/keyboard reorder | model identity/no-op/permutation/threshold/midpoint tests; browser verifies Shift+Arrow reorder, no pre-release mutation, pointer order, active identity, invalid drop and edge auto-scroll |

`exitReplaySession` clears the local Replay projection before its best-effort server close and absorbs close transport errors by existing contract, so there is no rejecting exit branch to inject at the tab component boundary. Task mutation runs only after that promise resolves.

## Negative constraints and capability review

- No mobile/touch tab UI: browser mobile scenario proves the tablist is absent.
- No execution/account/MT5/risk changes: task-owned diff contains no execution package or trade-state source.
- No background task chart mounting: `DesktopTerminal` renders one existing chart surface and the task strip only changes atoms for that surface.
- Closing a task does not issue drawing/indicator deletion; it only removes the task record.
- No browser-provided owner: handlers use authenticated context only; unauthenticated access returns 401 before store access.
- No stale-write acceptance: compare-and-swap returns 409 and mutation tests kill a revision-comparator fault.
- No unrelated chart settings replacement: Go round-trip and handler tests retain existing chart keys.
- Saved-layout CRUD contract is unchanged; only the selected active-layout ID is captured/restored.
- No rename, reopen-closed-tab, WebSocket task sync or automatic same-task merge.
- No package manifest, lockfile, Go module or database migration change.
- Mutation restore is byte-for-byte and does not use destructive Git commands.

## Fresh final gauntlet

Rerunnable command from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-chart-task-tabs.ps1
```

Final result: `CHART_TASK_TABS_GAUNTLET_OK` (exit code 0).

- Patch integrity and Go formatting: passed before and after mutation.
- Full backend: `go test -p 1 ./... -count=1` passed. Sequential `-p 1` is intentional: an earlier cold parallel run caused three unrelated `internal/execution` one-second test timeouts; the same package immediately passed alone, and the fresh full sequential run passed without filtering.
- Backend task-tab integration test discovery: test compiled and was discovered; skipped because `CHART_TASK_TABS_INTEGRATION_DATABASE_URL` is not set.
- Go race: unverified because this host has `CGO_ENABLED=0` and no `gcc`; the verifier emitted an explicit warning and did not report it as passed.
- `go vet ./...`: passed.
- `go build ./...`: passed.
- Focused backend settings coverage: 65.0% statements. New non-repository functions met the executable 70% function gate (`ValidateChartTaskTabsDocument` 90.9%, extraction 75.0%, write application 76.2%, ID validation 100%, JSON-object validation 75.0%, cloning 77.8%). Repository methods remain locally uncovered because the disposable DB layer was unavailable.
- Frontend test compilation: passed.
- Full compiled frontend suite: 876 passed, 0 failed, 0 skipped.
- Focused model/queue suite: 18 passed; source line coverage was 90.70% for `chartTaskTabsStore` and 96.55% for `chartTaskTabsSyncQueue`.
- Typecheck: passed.
- ESLint: passed.
- Next.js production build: passed.
- New chart-task-tabs Playwright suite: 4 passed.
- Existing chart-layout Playwright regression: 10 passed.
- Mutation gauntlet: `MUTATION_GAUNTLET_OK (5/5 killed and sources restored)` for backend cap, stale revision comparator, frontend cap, drag threshold boundary and drop midpoint boundary.
- Focused repeat 1: 18/18 passed.
- Focused repeat 2: 18/18 passed.
- Dependency/capability and patch secret-pattern checks: passed; no manifest/lock/module changes and no credential material was added.

Generated focused Go coverage is retained at `docs/agent-evidence/chart-task-tabs/chart-task-tabs-go-cover.out` and is ignored by Git. `.test-build`, `.next` and Playwright transient output remain generated/ignored artifacts.

## Explicit limitations

1. The PostgreSQL row-lock/concurrent compare-and-swap integration case is implemented but locally skipped because no disposable database URL is available. It must not be represented as a pass until a CI or disposable environment actually executes it.
2. `go test -race` is locally unavailable because this Windows host lacks CGO/gcc. A CI runner with the required toolchain is needed to close that layer.
3. The Jotai runtime coordinator cannot be loaded by the repository's CommonJS-only compiled Node harness because its `@/` application aliases are not resolved there. Runtime coordination is therefore exercised in its real Next/Playwright environment; pure domain and sync queue logic have direct Node tests.
4. No backend/frontend deployment or production restart has occurred. Local build and browser verification do not imply production activation.

## Task-owned delivery paths

Only these paths belong to this task and may be staged under approved Amendment 2:

- `backend/docs/API.md`
- `backend/docs/DATABASE.md`
- `backend/internal/settings/chart_task_tabs.go`
- `backend/internal/settings/chart_task_tabs_repo_integration_test.go`
- `backend/internal/settings/handler.go`
- `backend/internal/settings/handler_test.go`
- `backend/internal/settings/model_test.go`
- `docs/agent-evidence/chart-task-tabs/SPEC.md`
- `docs/agent-evidence/chart-task-tabs/EVIDENCE.md`
- `frontend/docs/ARCHITECTURE.md`
- `frontend/docs/CHART_LAYOUT_ARCHITECTURE.md`
- `frontend/docs/CHART_TASK_TABS_ARCHITECTURE.md`
- `frontend/docs/README.md`
- `frontend/src/components/chart/ChartTaskTabs.tsx`
- `frontend/src/components/desktop/DesktopTerminal.tsx`
- `frontend/src/hooks/useChartLayoutPersistence.ts`
- `frontend/src/hooks/useWorkspaceBootstrap.ts`
- `frontend/src/i18n/localization.ts`
- `frontend/src/services/api/chartTaskTabsSyncQueue.ts`
- `frontend/src/services/api/chartTaskTabsSyncRuntime.ts`
- `frontend/src/services/api/resources/settingsApi.ts`
- `frontend/src/services/auth/terminalAccount.ts`
- `frontend/src/store/chartTaskTabsRuntimeStore.ts`
- `frontend/src/store/chartTaskTabsStore.ts`
- `frontend/tests/browser/chartTaskTabs.spec.ts`
- `frontend/tests/chart/chartTaskTabsStore.test.ts`
- `frontend/tests/chart/chartTaskTabsSyncQueue.test.ts`
- `frontend/tsconfig.test.json`
- `tools/verify-chart-task-tabs-mutations.ps1`
- `tools/verify-chart-task-tabs.ps1`

At initial evidence creation time, these changes were uncommitted and unpushed. The delivery section will be updated with the commit, remote SHA and terminal CI results after approved remote delivery completes.
