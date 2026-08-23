# Known issues and operational constraints

Verified on 2026-08-24.

| Area | Current state | Required handling |
| --- | --- | --- |
| GitHub remote rename | The canonical repository is `DEVfancybear/MarketLens`; older local clones may still use the redirected `DEVfancybear/tradingview.git` URL. | Update `origin` to the canonical URL. Do not rely on redirects for Actions/reusable workflow references. |
| Managed MT5 production evidence | Implementation and local synthetic/disposable gates are complete, but production activation evidence is environment-specific. | Complete the worker/Vault/proxy/hash/R15-9 Demo gates before Live/funded onboarding. |
| Native Binance | Domain values are present but no production transport is registered. | Keep fail-closed `NATIVE_ADAPTER_NOT_ENABLED` behavior until the full security/reconciliation plan passes. |
| Platform-specific Rust paths | Portable workspace tests run on Linux; Windows-only managed-agent library tests run in the Windows artifact job. | Keep platform gates explicit and require both jobs before publishing artifacts. |
| Scripted HTTP peer disconnects | Clients that intentionally reject oversized/malformed test responses may close before the mock server finishes writing. | The test helper may accept only `BrokenPipe`, `ConnectionReset`, and `ConnectionAborted`; all other I/O errors must fail. |
| codebase-memory coverage | SQL and a small set of source ranges may be partially parsed; ignored/generated trees are excluded by design. | Treat graph results as discovery evidence and read current source for flagged/missing ranges. |
| External services | PostgreSQL, Vault, Cloudflare/public health, Firebase, brokers, terminals, and EAs cannot be fully validated by repository-only tests. | Record environment and exact commit for every production smoke/reconciliation result. |

## Retired guidance

The following are not current issues or recovery paths:

- the deleted browser-facing FTMO verification/connector flow;
- `backend/bridge/ftmo_mt5`, frontend MT5 bridge plans, or port 8787;
- restoring Playwright as a mandatory repository agent policy;
- retrying a flaky CI job without fixing and stress-testing its race.

Historical documents may mention these paths because they preserve an earlier result. Use
[Current state](CURRENT_STATE.md), [Operations](OPERATIONS.md), and
[Trade execution architecture](TRADE_EXECUTION_ARCHITECTURE.md) for current behavior.
