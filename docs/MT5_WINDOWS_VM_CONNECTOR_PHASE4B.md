# MT5 Windows VM Connector Phase 4b

- Date: 2026-08-20
- Repository status: **implemented and code-native tested**
- Production status: **inert until Phase 1–3 activation and Phase 4 live evidence pass**

Phase 4b adds historical orders, deals, bounded windows and cursor semantics without adding a
broker mutation call. It is additive to Phase 4a and does not make `ready` or execution available
on its own.

## Durable contract

Migration `0041_mt5_vm_history_sync` creates:

- `execution_mt5_vm_history_orders`, keyed by `(account_id, broker_ticket)`;
- `execution_mt5_vm_deals`, keyed by `(account_id, broker_ticket)`;
- `execution_mt5_vm_history_coverage`, one explicit requested/covered window per family.

All rows carry the worker/session/lease/sequence envelope. Decimal values are PostgreSQL numeric
but cross every Python/Rust/Go boundary as plain strings. No password, raw login, credential reference,
worker token, terminal path or MT5-native object is persisted.

## Ingestion and reads

The private worker route is `POST /v1/mt5-vm/workers/history`. It authenticates the existing
worker session, locks the current lease and coverage row, rejects replayed sequences, upserts rows
idempotently, and advances coverage only for a declared `complete` page. Partial/failed pages may
retain observed rows but never extend `coveredThroughMs`; ingestion never deletes records outside
the exact declared window.

The admin route is `GET /v1/admin/mt5-vm/accounts/history`. The Go public route is
`GET /api/v1/execution/connectors/accounts/:accountId/history?fromMs=&toMs=&limit=&cursor=`.
Owner identity is injected by Go and rechecked in Rust. Windows are at most 31 days, pages at most
500 rows, and cursors are account-bound SHA-256 signatures over the deterministic
`(event_time, family, broker_ticket)` order. Modified, overlong or cross-account cursors fail
closed. The response includes both row families and explicit coverage/result/error state.

## Verification

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-mt5-phase4.ps1
```

The current host passes Rust gateway 93/93 and managed-agent tests (one credentialed live test
ignored), Python Phase 0/1/4, Go execution, and mutation controls. A fresh
`tools/run-mt5-phase4-disposable.ps1` run passes the `0040/0041` migration round-trip on
loopback-only EDB PostgreSQL 17.11. Do not substitute a production URL.

## Exit boundary

This repository work does not close the live Phase 4 exit gate. An operator must still compare
FTMO and one retail demo from an independent terminal and broker web view through disconnect,
reconnect and cold-cache history, with no raw credentials or account/ticket identifiers committed.
