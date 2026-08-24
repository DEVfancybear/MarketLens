# Chart task tabs architecture

Verified against the desktop runtime and Go settings API on 2026-08-24.

Desktop Chart exposes a bounded Chrome-style task strip above the single active
`ChartLayoutWorkspace`. A task is a durable workspace descriptor, not another mounted chart tree.
Only the active task renders charts and owns market subscriptions; inactive tasks are plain state.
Mobile does not render this strip.

## State ownership

`chartTaskTabsStore.ts` owns the pure version-1 document model and its add, activate, close, move,
normalization, drag-threshold, and drop-edge rules. `chartTaskTabsRuntimeStore.ts` coordinates that
model with existing chart atoms. Each task owns:

- a stable task ID and drawing-context ID;
- chart preset, Replay scope preference, four pane records, active slot, and alert ownership;
- the selected saved-layout ID, if any.

Language, theme, docks, watchlists, execution accounts, and notifications remain shared. Adding a
task creates a fresh single-chart workspace to the right of the active task, using only the current
symbol and timeframe. It does not clone task drawing, indicator, or alert scopes.

Before a context change, the coordinator captures the outgoing task. Restore clears the transient
drawing tool, drawing/indicator editors, selection, and crosshair, then restores layout, drawing
context, market, timeframe, and saved-layout reference. A live Replay session is exited before an
add, active close, or switch, so replay projection cannot cross task boundaries.

## Ordering interaction

`ChartTaskTabs.tsx` follows the pointer reorder contract already used by execution accounts:

- primary pointer and a 5px Euclidean activation threshold;
- horizontal before/after edges resolved from the target midpoint;
- window-level move/up/cancel/blur listeners with unconditional cleanup;
- no reorder write until a valid `pointerup`;
- invalid/cancelled drops are no-ops and the post-drag click is suppressed;
- an animation-frame loop scrolls an overflowed strip near either horizontal edge.

The strip is a labelled `tablist` with roving focus. Left/Right/Home/End activate tasks;
Shift+Left/Right reorders the focused task and announces the result through a polite live region.
The close button is separate from the tab button so both controls retain correct semantics.

## Persistence and conflicts

The durable document lives at `user_settings.chart.taskTabs`. Existing
`settings.chart.workspaceLayout` remains the active-task compatibility mirror. Bootstrap prefers a
valid task document; otherwise it migrates the already restored workspace into one task and queues
that document for authenticated users. Anonymous/offline task state remains in memory.

`useChartLayoutPersistence` captures active-task changes and sends authenticated dirty documents
through one serialized 250ms-debounced queue. The backend owns `revision`. Pending data is kept in
UID-scoped `sessionStorage` until acknowledgement. A transient error leaves the latest pending
document visible and retryable. A `409` preserves the local document as a conflict recovery record,
fetches the latest server document, adopts it, and shows a warning; version 1 does not auto-merge.

Sign-out flushes both chart settings and task tabs before destroying the backend session. Queue
reset and recovery keys are UID-scoped so state cannot cross authenticated identities.

## Backend contract and limits

- `GET /api/v1/settings/chart/task-tabs` reads the current document.
- `PUT /api/v1/settings/chart/task-tabs` accepts `{ expectedRevision, document }`.
- Writes lock the owner's `user_settings` row, compare revisions, increment on success, and replace
  only `chart.taskTabs`.
- Documents are version 1, contain 1–12 unique task/context IDs, name an existing active task, and
  are capped at 512 KiB. Non-null saved-layout IDs must be valid non-empty IDs.
- Owner identity comes only from authentication. Stale writes return `409`; invalid writes return
  `400` without mutation.

Focused coverage lives in `tests/chart/chartTaskTabsStore.test.ts`,
`tests/chart/chartTaskTabsSyncQueue.test.ts`, and `tests/browser/chartTaskTabs.spec.ts`.
