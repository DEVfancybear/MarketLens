# Frontend Error Reporting

Updated: 2026-07-09

Use this guide when adding frontend calls to backend APIs, Firebase Auth, or other user-triggered
network work.

## Shared Formatter

`src/services/api/errors.ts` owns user-facing error text:

- `ApiError` wraps backend HTTP errors from the shared `ky` client.
- `describeUserFacingError(error, title)` maps backend, Firebase, timeout, and network failures into
  clear UI copy.
- `errorMessage(error, fallback)` is the lightweight log-only formatter.

Do not show raw strings like `Auth error`, `Failed to fetch`, or `internal server error` directly in
visible UI. Pass the original error through the shared formatter.

## Shared Reporter

`src/services/feedback/errorReporter.ts` owns UI reporting:

```ts
reportFrontendError(error, {
  title: "Workspace sync failed",
  logPrefix: "Workspace bootstrap failed",
});
```

This writes one terminal log entry and shows one toast by default. Use `toast: false` only for
polling/high-frequency flows where repeated popups would spam the user.

## Current Usage

The common reporter is wired into:

- Google sign-in and backend session exchange,
- sign-out,
- workspace bootstrap,
- watchlist remote sync,
- MT5 symbol catalog loading.

Chart, drawing, indicator, and Pine sync logs use the same formatter for consistent message text.

## Rules

1. User actions should show a toast and write a log.
2. Background polling should usually write a log only.
3. Auth errors must explain whether the problem is Firebase config, popup/domain setup, backend
   connectivity, expired session, or backend 5xx.
4. Keep backend error messages concise; detailed stack traces belong in backend logs, not toast UI.
