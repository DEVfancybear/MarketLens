# Pine Runtime Go Migration

_Date: 2026-07-09. Scope: move the Pine-like parser/compiler runtime out of the
frontend `pineScript.ts` service and into the Go backend._

## Goal

The current custom-indicator runtime is mostly implemented in
`frontend/src/services/pineScript.ts`. That file parses source metadata, extracts
settings schemas, evaluates a supported Pine subset, and emits chart-ready
series/objects. It has grown too large for frontend maintenance and runs on the
browser main thread during chart rendering.

The migration goal is to make the backend the owner of Pine parsing and
compilation, while the frontend stays responsible for:

- Pine Editor UI and saved-script actions.
- Indicator settings UI generated from backend schemas.
- Chart rendering from backend-normalized `PineCompilation` payloads.
- Lightweight anonymous fallback only while backend runtime parity is being
  completed.

## Non-Goals

- Do not execute arbitrary Pine, JavaScript, or Go plugins.
- Do not call TradingView private APIs for compilation.
- Do not make the frontend compile user code in the steady state.
- Do not special-case indicator names such as ADR, VSA, RSI, or future scripts.
- Do not persist market candles in the Pine runtime. Candles remain market-data
  runtime input.

## Implemented State

Implemented on 2026-07-09:

| Concern | Current owner |
| --- | --- |
| Script metadata extraction | Go `backend/internal/pineruntime` API; frontend still has local fallback helpers |
| Input schema extraction | Go `backend/internal/pineruntime` API; settings dialog still uses local helper until async schema cache migration |
| Style schema extraction | Go `backend/internal/pineruntime` API; settings dialog still uses local helper until async schema cache migration |
| Pine subset compilation | Go `backend/internal/pineruntime` through `/api/v1/pine-runtime/compile` |
| Built-in indicator calculations | `frontend/src/services/indicators.ts` |
| Active indicator dispatch | `frontend/src/services/indicators.ts` |
| Overlay rendering | `frontend/src/components/chart/PriceChart.tsx` |
| Separate pane rendering | `frontend/src/components/chart/IndicatorPane.tsx` |
| Script persistence | Backend Phase 9 `/api/v1/pine-scripts` |

Frontend chart rendering now uses `frontend/src/services/pineRuntimeCache.ts`.
CUSTOM indicators no longer call the compiler synchronously from
`computeIndicator()`. The chart/pane effects request backend compilation, render
the latest cached `IndicatorResult`, and rerender when the cache resolves.

Temporary migration bridge: Go runtime supports plot/hline/fill and core
series expressions used by VSA Volume and Better RSI. Object-heavy scripts
(`line.new`, `box.new`, `label.new`, `table.new`) are reported through
`unsupportedFeatures`; the frontend cache falls back to the old TypeScript
runtime for those scripts so existing ADR object rendering does not regress.

## Target Ownership

Backend responsibilities after migration:

| Concern | Target owner |
| --- | --- |
| Parse source metadata | Go `internal/pineruntime` |
| Extract input definitions | Go `internal/pineruntime` |
| Extract style definitions | Go `internal/pineruntime` |
| Compile supported Pine subset | Go `internal/pineruntime` |
| Runtime diagnostics/errors | Go `internal/pineruntime` |
| Concurrent compile work | Go goroutines with request-scoped context |

Frontend responsibilities after migration:

| Concern | Target owner |
| --- | --- |
| Pine Editor text editing | Frontend |
| Save/load/delete/favorite source scripts | Frontend calling Phase 9 APIs |
| Settings dialog rendering | Frontend using backend schemas |
| Compile-result caching | Frontend runtime cache |
| Lightweight Charts series/object rendering | Frontend |

## Backend Package

Implemented package:

```text
backend/internal/pineruntime/
  handler.go       # Fiber HTTP handlers
  compiler.go      # request orchestration, context, concurrency
  scanner.go       # balanced call scanning, args, source lines
  schema.go        # indicator()/study(), input.*(), plot/hline/fill style extraction
  expression.go    # expression tokenizer/parser/evaluator
  value.go         # Pine value model and series helpers
  models.go        # request/response structs
  compiler_test.go # VSA, Better RSI, unsupported objects, HTTP contract tests
```

Keep this package isolated from persistence packages. It should not import
`internal/pinescripts` except through higher-level handlers if a future
compile-by-id endpoint is added.

## Runtime API

Implemented endpoints under `/api/v1/pine-runtime`.

### `POST /api/v1/pine-runtime/meta`

Extract script title and overlay/timeframe metadata without candles.

Request:

```json
{
  "sourceCode": "indicator(\"My script\", overlay=true)\nplot(close)"
}
```

Response:

```json
{
  "name": "My script",
  "overlay": true,
  "timeframe": "",
  "errors": []
}
```

### `POST /api/v1/pine-runtime/inputs`

Return settings rows for the Inputs tab.

Request:

```json
{
  "sourceCode": "...",
  "inputOverrides": {
    "length": 20
  }
}
```

Response:

```json
{
  "inputs": [
    {
      "key": "length",
      "label": "Length",
      "type": "integer",
      "value": 20,
      "defaultValue": 14,
      "options": null,
      "group": "Calculation"
    }
  ],
  "errors": []
}
```

### `POST /api/v1/pine-runtime/styles`

Return style rows for plots, hlines, fills, and supported drawing objects.

Request:

```json
{
  "sourceCode": "...",
  "styleOverrides": {
    "plot:RSI.visible": true
  }
}
```

Response:

```json
{
  "styles": [
    {
      "key": "plot:RSI",
      "label": "RSI",
      "target": "plot",
      "visible": true,
      "color": "#ffffff",
      "lineWidth": 2,
      "lineStyle": "solid"
    }
  ],
  "errors": []
}
```

### `POST /api/v1/pine-runtime/compile`

Compile a script against the exact replay-aware candle slice supplied by the
frontend.

Request:

```json
{
  "scriptId": "optional-client-or-backend-id",
  "sourceCode": "...",
  "timeframe": "15m",
  "candles": [
    {
      "time": 1783420800,
      "open": 1.142,
      "high": 1.143,
      "low": 1.141,
      "close": 1.1425,
      "volume": 120
    }
  ],
  "inputOverrides": {},
  "styleOverrides": {}
}
```

Response shape must remain compatible with the current frontend
`PineCompilation` contract:

```json
{
  "meta": {
    "name": "My script",
    "overlay": false,
    "timeframe": ""
  },
  "result": {
    "id": "custom-id",
    "series": [],
    "hlines": [],
    "fills": [],
    "labels": [],
    "boxes": [],
    "tables": []
  },
  "errors": [],
  "warnings": [],
  "unsupportedFeatures": []
}
```

The frontend renderer should not need to understand backend internals. It should
only receive normalized chart primitives.

## Concurrency Model

Fiber already handles simultaneous HTTP requests concurrently. The compile
handler also dispatches each compile request to a goroutine with a request-scoped
timeout:

- `/compile` creates a 5s context.
- compile work runs in a goroutine and returns through a buffered channel.
- timeout returns `408` with a structured compile response.
- each request owns its evaluator state, variable map, series buffers, and
  output primitives.

Do not share mutable evaluator state across requests. Each compile request owns
its parser state, variable store, series buffers, and emitted primitives.

Recommended limits:

- Request timeout: 5s initial target, configurable.
- Max source size: configurable, default 256 KB.
- Max candles per compile: configurable, default 5,000.
- Max emitted objects per script: respect Pine-style limits from source where
  present, otherwise backend defaults.

## Frontend Integration

Add a typed ky resource:

```text
frontend/src/services/api/resources/pineRuntimeApi.ts
```

The resource should expose:

```ts
getPineMeta(sourceCode)
getPineInputs(sourceCode, inputOverrides)
getPineStyles(sourceCode, styleOverrides)
compilePine(sourceCode, candles, inputOverrides, styleOverrides)
```

Then migrate call sites:

| Frontend caller | Migration |
| --- | --- |
| `PineEditor.tsx` preview/add validation | Call backend compile endpoint |
| `chartStore.ts` save-name derivation | Call backend meta endpoint where async is acceptable; keep a tiny local fallback only for offline anonymous mode |
| `IndicatorSettingsDialog.tsx` | Hydrate input/style schemas from backend and cache by `scriptId/sourceHash` |
| `IndicatorLegend.tsx` status inputs | Use cached backend input schema |
| `services/indicators.ts` CUSTOM dispatch | Read cached backend `IndicatorResult`; do not synchronously compile |
| `PriceChart.tsx` / `IndicatorPane.tsx` | Trigger async compile cache refresh when visible candles/source/overrides change |

The chart render path must not block on an HTTP request. It should:

1. Render the most recent cached compile result if present.
2. Show nothing or a lightweight loading state for that custom indicator while
   the first backend compile is pending.
3. Ignore stale compile responses if source, candles, replay boundary, or
   overrides changed before the response returned.

## Cache Keys

Use a stable cache key:

```text
scriptId/sourceHash + candleRangeHash + inputHash + styleHash + timeframe
```

The candle range hash should include first candle time, last candle time, candle
count, and replay cursor when active. Do not stringify every candle for normal
render invalidation; full candles are only sent in the compile request.

## Migration Plan

### Phase A - Backend runtime shell

Status: implemented for the plot/hline/fill Pine subset.

1. Added `internal/pineruntime` models and handlers.
2. Added `/api/v1/pine-runtime/meta`, `/inputs`, `/styles`, `/compile`.
3. Return structured `unsupportedFeatures` instead of panics or generic 500s.
4. Added tests for VSA, Better RSI, unsupported object runtime, and HTTP compile route.

### Phase B - Frontend async adapter

Status: implemented for compile result cache.

1. Added `src/services/api/resources/pineRuntimeApi.ts`.
2. Added `src/services/pineRuntimeCache.ts`.
3. Wired Pine Editor preview/add-to-chart validation to backend compile with TS fallback.
4. `PriceChart` and `IndicatorPane` request backend compile asynchronously and render cached results.
5. Existing `pineScript.ts` remains a temporary fallback for unsupported object scripts and backend outages.

### Phase C - Chart runtime migration

Status: implemented for CUSTOM indicator render path.

1. `computeIndicator()` no longer calls `compilePineScript()` synchronously for CUSTOM indicators.
2. Chart/pane components request backend compile through effects.
3. The cached backend `IndicatorResult` drives Lightweight Charts rendering.
4. Replay-visible candle slices are the same `candles` input passed into chart/pane rendering.

### Phase D - Remove frontend compiler ownership

Status: pending.

1. Replace `pineScript.ts` with thin compatibility helpers, or split it into:
   - `pineRuntimeClient.ts` for API calls.
   - `pineRuntimeFallback.ts` for anonymous/offline fallback only.
2. Stop adding new Pine language support in TypeScript.
3. Update docs and tests to name Go as the source of truth.
4. Port object runtime support (`line`, `box`, `label`, `table`) to Go and remove the ADR fallback.

## Error Handling

Backend errors should be user-actionable:

| Error | Frontend behavior |
| --- | --- |
| Parse error | Show Pine Editor status and line/column when available |
| Unsupported feature | Show warning; render supported output if safe |
| Timeout | Keep previous cached output and show non-blocking warning |
| Too many candles/source too large | Ask frontend to reduce request size or paginate visible range |
| Network/backend unavailable | Use temporary fallback only if explicitly enabled |

Never return a blank chart because a custom indicator failed. Indicator failure
must be isolated to that indicator.

## Testing

Backend tests:

- Metadata extraction for v3/v4/v5 `study()` and `indicator()`.
- Input extraction for `input()`, `input.int`, `input.float`, `input.bool`,
  `input.color`, `input.source`, and grouped inputs.
- Style extraction for `plot`, `hline`, `fill`, labels, lines, boxes, and tables.
- Compile fixtures for VSA Volume, Better RSI, and ADR 50 SR Pro.
- Replay safety: compile only receives and emits values for supplied candles.
- Concurrency: compile multiple scripts in parallel without data races.

Frontend tests:

- Pine Editor calls backend compile before add-to-chart.
- Settings dialog uses backend schema cache.
- Chart ignores stale compile responses after timeframe/symbol/replay changes.
- CUSTOM indicator render does not block main chart initialization.
- Logout clears user-specific script/schema/compile cache.

Manual checks:

- Add VSA, Better RSI, and ADR from Pine Editor.
- Change inputs and style values.
- Switch symbol/timeframe while custom indicators are visible.
- Start replay, select a past bar, then switch timeframe.
- Sign out and confirm user script data is cleared from view.

## Acceptance Criteria

- New Pine language support is implemented in Go, not in frontend TypeScript.
- Frontend chart render path no longer synchronously compiles Pine scripts.
- Existing supported scripts keep visual parity: VSA colored volume, Better RSI
  hlines/fills/cycler, ADR lines/labels/table.
- Backend compile responses are deterministic for the same source, candles,
  inputs, and styles.
- Backend handles multiple compile requests concurrently without shared-state
  corruption.
- Frontend remains responsive while custom indicators compile.

## Open Decisions

- Whether anonymous/offline mode should keep a limited TypeScript fallback or
  require backend availability for Pine scripts.
- Whether compile-by-script-id should be added:
  `POST /api/v1/pine-runtime/compile/:scriptId`.
- Whether backend should cache compile responses by source hash and candle range,
  or leave cache ownership entirely in the frontend.
- Whether built-in indicators should stay in TypeScript or later move to the
  same Go runtime for consistency.
