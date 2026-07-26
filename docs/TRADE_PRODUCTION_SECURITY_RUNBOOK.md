# Trade production security runbook

This runbook applies to real-money Demo and Live execution. A release is not
production-ready merely because it compiles or can place a test order.

## Non-negotiable deployment topology

- Terminate TLS at the public reverse proxy.
- Proxy only the existing Go service on port `8080`. Its exact
  `/execution-ea/*` allow-list relays to Rust.
- Keep `127.0.0.1:8790`, `127.0.0.1:8791`, `127.0.0.1:8765`, PostgreSQL, and operator health
  endpoints private.
- Configure the public EA path with request-rate, concurrent-connection, body
  size, header size, and upstream timeout limits.
- Do not trust client-supplied forwarding headers unless the direct peer is the
  controlled reverse proxy.
- Use independent 32-byte-or-longer random values for `AUTH_JWT_SECRET`,
  `EXECUTION_ADMIN_TOKEN`, and push-worker secrets.
- Never put `EXECUTION_ADMIN_TOKEN`, database credentials, or broker secrets in
  `NEXT_PUBLIC_*`, an EA input, a log line, or a support screenshot.

The Rust process additionally enforces a 256 KiB body limit and five-second
database statement timeout. Both Go-to-Rust clients reject redirects, accept
only loopback HTTP, cap responses, and have bounded timeouts. The EA relay
forwards only method, JSON body, and Authorization; it does not forward browser
cookies or arbitrary headers.

## Reverse-proxy contract

The EA-facing public origin should map:

```text
https://api.example.com/execution-ea/health
https://api.example.com/execution-ea/v1/ea/sessions
https://api.example.com/execution-ea/v1/ea/poll
https://api.example.com/execution-ea/v1/ea/events
```

It must not map `/v1/admin/*`. Suggested initial limits per source IP are:

- session creation: 10 requests/minute with a small burst;
- poll/events: 240 requests/minute per active terminal with bounded burst;
- body: 256 KiB;
- upstream request timeout: 10 seconds;
- connection and total request limits sized to the supported account count.

These are starting values, not universal constants. Tune them from measured EA
poll rates and alert on sustained limiting.

## Authentication and authorization checks

Before release, verify:

- every browser execution route requires an authenticated session;
- owner identity is taken from the server session, never a request body or
  query supplied by the browser;
- cross-owner account IDs return a uniform not-found/rejected response;
- raw Place commands are rejected by the generic command endpoint and can only
  enter through the risk-aware order route;
- position/order lifecycle requests verify the target resource under the same
  owner and account;
- admin token comparison is constant-time and the token never leaves loopback;
- pairing tokens are one-use, owner-bound, hashed, short-lived, and capped per
  owner;
- EA sessions are hashed at rest and bound to the exact MT5 identity;
- only one current EA session controls an account after re-pairing.
- account readiness requires `last_poll_at` from a completely successful
  command poll within 15 seconds; generic session/event activity is
  insufficient;
- the reported EA version is `1.22` or newer before any Place or lifecycle
  command can be created.

## Risk and loss-prevention checks

For each account:

- configure `max_risk_per_trade_basis_points`;
- configure `max_order_quantity`;
- keep `require_stop_loss=true` unless a separately approved strategy requires
  otherwise;
- use symbol allow/block lists for constrained accounts;
- validate every canonical-to-venue symbol mapping;
- confirm quantity unit, step, minimum, maximum, price tick, tick value, and
  minimum stop distance from the broker;
- reject stale reference quotes;
- reject missing equity/tick data instead of estimating;
- cap the first Live canary order to the broker minimum.

The UI confirmation and volume cap are safety affordances only. Rust is the
authoritative enforcement point.

## Idempotency and uncertain outcomes

Network timeout does not mean broker rejection. Never retry a Place command only
because the HTTP caller did not receive a response.

- The parent intent and every target use stable idempotency keys.
- PostgreSQL stores a target command before delivery.
- Polling leases a command; it does not destructively dequeue it.
- The EA journal records `submitting` before calling the broker.
- An unknown result remains unknown until active orders, positions, deals, or
  order history prove its outcome.
- Operators must not manually replay an unknown command. Reconcile first.

## Audit and monitoring

Alert on:

- repeated invalid pairing/session tokens;
- pairing-token issue spikes;
- cross-owner resource probes;
- command queue saturation;
- stale account/instrument snapshots;
- sustained EA disconnects;
- stale/missing `last_poll_at` while event heartbeats remain fresh;
- missing, malformed, or unsupported EA versions;
- repeated broker rejects;
- unknown submissions older than the reconciliation SLO;
- audit insert failures;
- database statement/lock timeouts;
- reverse-proxy rate limiting or unexpected public admin-path probes.

The append-only `execution_audit_log` records pairing, symbol mapping, queued
commands, route rejects/unavailability, and EA outcomes. Restrict database roles
so the runtime role cannot bypass the audit mutation trigger through ownership
or superuser privileges.

## Release gate

Run from the repository:

```powershell
cd backend
go test ./...
..\.tools\govulncheck.exe -scan=symbol ./...
```

```powershell
cd backend\execution
cargo fmt --all -- --check
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo audit
```

```powershell
cd frontend
npm run typecheck
npm run test:trade
npm run test:ui
npm run build
npm audit --omit=dev
```

Compile and publish the downloadable EA on the trusted Windows build host:

```powershell
.\backend\bridge\mt5_ea\Publish-SMCExecutionEA.ps1
```

The publisher requires MetaEditor to report `0 errors, 0 warnings`. It creates
the public `.ex5`, SHA-256 checksum, and a manifest binding the binary to the
current source. `build-production.ps1` verifies all three before building the
frontend and fails closed on a missing, stale, or modified release.

Apply migrations in a controlled environment and verify `version=28,
dirty=false` before serving execution traffic. The canonical production runner
owns build, migration, restart, and health gates:

```powershell
.\run-backend-production.ps1
```

Do not use recovery switches during a normal release.

Migration `0028_execution_ea_poll_liveness` intentionally leaves existing
sessions with `last_poll_at=NULL`. After restart, each healthy EA establishes
readiness on its first successful poll. Existing EA releases below 1.22 remain
blocked until their `.ex5` is replaced; do not bypass this gate by editing
account status in PostgreSQL.

## Command delivery triage

Use the target command row, not the browser's `202 Accepted`, to identify the
execution boundary:

| Evidence | Meaning | Action |
| --- | --- | --- |
| `attempt_count=0`, `first_delivered_at IS NULL` | Gateway never delivered the command to EA | Check `last_poll_at`, EA version, poll HTTP status, relay and deployment uptime |
| `attempt_count>0`, no `terminal_ack_at` | EA received one or more leases but no outcome was persisted | Check EA Experts log, local idempotency journal and events HTTP response |
| `status=failed`, `reject_code=DELIVERY_UNAVAILABLE` | Delivery deadline passed before any EA lease | Do not claim MT5/broker rejection; restore poll health and create a new user-authorized order |
| `status=unknown`, `reject_code=DELIVERY_OUTCOME_UNKNOWN` | Delivered but not acknowledged before the deadline; MT5 may already have executed it | Do not resend. Reconcile MT5 active orders, positions, and history while allowing a late EA acknowledgement to finalize the command |
| `status=accepted/filled/cancelled` with broker IDs | EA outcome is persisted | Reconcile browser portfolio against broker state |

If poll returns HTTP 500 only when a command is queued and the row remains at
`attempt_count=0`, inspect command-payload decoding before investigating MT5.
Optional price fields may be missing or explicit JSON `null`, but every
non-null monetary value must remain a decimal string. Never rewrite the stored
payload or mark it delivered by hand.

Never resend a failed command by changing its database status. A replacement
order requires a new command ID and explicit user action after the prior
outcome has been reconciled.

Migration `0029_execution_delivery_outcome_unknown` changes legacy
`status=failed, reject_code=DELIVERY_EXPIRED` rows to the reconcilable unknown
state. The Trade UI must show a sticky “check MT5” warning for both shapes
during a rolling deployment and must reserve “Broker rejected” for a confirmed
EA rejection.

## Live canary

1. Pair one dedicated Live account with minimum balance/exposure.
2. Verify account identity, server, currency, mode, equity, trade permission,
   EA version `1.22+`, and a fresh successful poll (`READY`) in the UI.
3. Map exactly one low-risk symbol.
4. Place the broker-minimum order with a protective stop.
5. Verify command IDs in browser activity, PostgreSQL, EA journal, MT5 order,
   deal, and position state.
6. Modify protection, partially close if supported, close the remainder, and
   cancel a pending order.
7. Disconnect during a submission test only in the designated canary account;
   verify unknown-outcome reconciliation without duplicate orders.
8. Add a second canary terminal and verify one source order produces
   independently reported target outcomes.
9. Expand risk caps and account count only after the observation window passes.

## Incident response

If unauthorized or duplicate execution is suspected:

1. Disable public EA proxy traffic and account Algo Trading.
2. Do not delete PostgreSQL rows, audit records, or EA journal files.
3. Revoke the affected EA session and rotate the execution admin token if
   service credential exposure is possible.
4. Export the command, target command, event, audit, reverse-proxy, Go, Rust,
   EA, and broker histories using command IDs as the join key.
5. Reconcile open positions and pending orders directly with the broker.
6. Classify the incident as authorization, idempotency, transport ambiguity,
   risk-policy, symbol-mapping, or broker-side behavior.
7. Patch and reproduce in Demo/testnet before re-enabling Live.

## Current enablement rule

MT5 execution is enabled after its full gate passes. Native venue enum values or
adapter traits alone do not enable trading. Binance remains fail-closed until
the completion plan in `TRADE_EXECUTION_ARCHITECTURE.md` is implemented and
certified.
