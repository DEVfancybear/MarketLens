# Pine Script v6 Runtime Support Matrix

_Updated: 2026-07-28_

## Scope and sources

The community
[`LLM_MANIFEST.md`](https://github.com/codenamedevan/pinescriptv6/blob/main/LLM_MANIFEST.md)
is used as a routing inventory, not as a conformance specification. Several
files it routes to (`drawing.md`, `collections.md`, `general.md`, and
`strategy.md`) are currently empty. Runtime semantics are therefore verified
against TradingView's official Pine v6 documentation, especially the
[execution model](https://www.tradingview.com/pine-script-docs/language/execution-model/),
[loops](https://www.tradingview.com/pine-script-docs/language/loops/),
[arrays](https://www.tradingview.com/pine-script-docs/language/arrays/),
[maps](https://www.tradingview.com/pine-script-docs/language/maps/),
[matrices](https://www.tradingview.com/pine-script-docs/language/matrices/),
and [v6 migration guide](https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/).

“Supported” below means covered by executable Go conformance tests. It does not
mean byte-for-byte compatibility with TradingView's proprietary compiler or
chart renderer.

## Runtime contract

`GET /api/v1/pine-runtime/capabilities` exposes the machine-readable contract.
The current execution mode is `closed-bar`: the runtime evaluates the supplied
dataset sequentially and commits series state after every bar. Realtime tick
rollback and `varip` require a tick event engine and are not simulated.

| Area | Status | Current contract |
| --- | --- | --- |
| Pine version | Supported | `//@version=6`; newer versions fail closed |
| Series execution | Supported | Closed-bar, bar-by-bar history and call-site-isolated state |
| v6 booleans | Supported | Boolean conditions and lazy `and` / `or` |
| Control flow | Supported | `if`, ternary, `for`, `for…in`, `for…by`, `while`, `break`, `continue` |
| Functions and objects | Supported | User functions, methods, UDT constructors/defaults, tuples |
| Arrays | Supported core | Generic/legacy constructors, `array.from`, access/mutation/copy/search/aggregate operations |
| Maps | Supported core | Ordered put/get/remove/contains/clear/copy/keys/values |
| Matrices | Supported core | Create/get/set/fill/copy/transpose/rows/columns |
| TA | Supported core | SMA/EMA/RMA/WMA/VWMA, change/momentum/extrema/crosses/barssince, deviation/variance/range/ROC, RSI/ATR/HMA, BB and MACD tuples, pivots/valuewhen |
| Math/string | Supported core | Common arithmetic, trig/log/power/average, casts, case/search/replace/substring/format operations |
| Visuals | Supported core | Plot/hline/fill, line/box/label/table, plotshape/plotchar/plotarrow normalization |
| `request.security` | Partial | Current symbol and supplied higher-timeframe candles; closed-bar causality |
| Alerts | Partial | Declarations compile; event delivery is external to this runtime |
| Type qualifiers | Partial | Runtime values are typed; full compile-time const/input/simple/series inference is not complete |
| Stateful `switch` | Partial | Vector sources support switch normalization; stateful AST parity remains planned |
| Realtime/`varip` | Engine required | Requires ticks, rollback snapshots, and intrabar persistence |
| Strategies | Engine required | Requires order lifecycle, fills, commissions, slippage, positions, and tester output |
| Libraries/imports | Engine required | Requires module resolution, version pinning, export visibility, and trust policy |
| External/multi-symbol requests | Engine required | Requires a bounded market/fundamental data provider and context cache |
| Lower-timeframe requests | Engine required | Requires intrabar datasets rather than synthesized chart candles |
| Remaining visuals | Engine required | Polyline transport, custom OHLC bars/candles, candle/background color channels |

## Delivery plan toward broad v6 compatibility

1. **Language conformance:** finish lexical scopes, stateful `switch`, loop return
   expressions, enums, qualifier/type checking, overload diagnostics, and
   remaining collection methods.
2. **Indicator surface:** expand the official TA/math/string/time/color and
   drawing APIs using table-driven signatures and golden series fixtures.
3. **Data contexts:** introduce an injected, quota-aware provider for
   multi-symbol, lower-timeframe, financial, currency, and corporate-action
   requests. Never fetch arbitrary data directly from a Pine script.
4. **Visual transport:** add renderer contracts for candle/bar/background
   colors, polylines, line fills, chart points, and remaining drawing setters.
5. **Realtime engine:** add tick executions, rollback, `varip`, alert frequency,
   and deterministic replay snapshots.
6. **Strategy engine:** implement broker emulation only after realtime/data
   semantics are stable, with separate order/fill/tester contracts.
7. **Libraries:** add pinned module resolution and sandboxed import/export
   validation after the language type checker is authoritative.

Each phase must add source-level conformance fixtures, negative diagnostics,
Replay-causality checks, and full backend regression tests before the capability
endpoint can promote a feature from `partial` or `engineRequired`.
