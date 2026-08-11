# MT5 cloud connector Phase 0 validation

- Status: **blocked; production gate has not passed**
- Review date: 11 August 2026
- Scope: provider contract, security, broker permission, and disposable demo validation
- Primary candidate: TickerAll
- Fallback candidate: MetaApi
- Production code changed in this phase: none

This document is the execution record for Plan 0 in
`UNIVERSAL_MT5_CLOUD_CONNECTOR_PLAN.md`. It deliberately separates statements
found in provider documentation from behavior observed against a real MT5 demo
account. A documented claim is not a passed live test.

## 1. Outcome so far

Phase 0 cannot pass in the current workspace because no TickerAll API key,
MetaApi token, or disposable MT5 demo credentials are available. No credential
has been requested for source control and no secret may be committed.

The contract review also found blockers that make TickerAll a **conditional
no-go** for the full MarketLens execution contract until TickerAll answers them
in writing or publishes the missing API surface:

1. the public API documents pending-order creation, but does not document an
   endpoint to list, modify, or cancel pending orders;
2. the symbol endpoint documents broker-native names only, not contract size,
   tick size/value, volume limits/step, stops level, freeze level, trading
   sessions, filling modes, or allowed order types;
3. the WebSocket documents ticks, position lifecycle, and account snapshots,
   but no pending-order lifecycle, replay cursor, sequence number, or resume
   token;
4. the public site has a privacy policy but no discoverable Terms of Service,
   DPA, subprocessor list, security assurance, published SLA, or exact trading-
   data retention period;
5. the provider API key is described as carrying access to the whole provider
   account, and revocation may take a few minutes.

TickerAll remains worth a bounded demo spike because it offers provider-side
idempotency for documented writes and claims a terminal-free connection. It
must not become the production provider while any blocker above remains.

MetaApi has the documented account, order, pending-order, instrument-
specification, history, and streaming surfaces needed for the fallback. Its
trade API does not document a durable idempotency guarantee equivalent to
TickerAll's 24-hour `Idempotency-Key`; MarketLens therefore must resolve
ambiguous outcomes through its own durable command ledger plus MetaApi
`clientId` correlation before MetaApi can pass execution validation.

## 2. Evidence rules

The evidence levels used below are:

| Level | Meaning |
| --- | --- |
| `DOC` | Confirmed only in current official provider documentation |
| `LIVE` | Observed against a disposable MT5 demo account and saved as a redacted fixture |
| `WRITTEN` | Confirmed by provider/broker support in a retained written response |
| `MISSING` | Required by MarketLens but not found in the public contract |
| `N/A` | Not required for that provider path |

Official sources reviewed on 11 August 2026:

- [TickerAll API documentation](https://tickerall.com/docs)
- [TickerAll privacy policy](https://tickerall.com/privacy)
- [TickerAll pricing](https://tickerall.com/pricing)
- [MetaApi client API overview](https://metaapi.cloud/docs/client/)
- [MetaApi account creation](https://metaapi.cloud/docs/provisioning/api/account/createAccount/)
- [MetaApi trade API](https://metaapi.cloud/docs/client/restApi/api/trade/)
- [MetaApi symbol specification](https://metaapi.cloud/docs/client/models/metatraderSymbolSpecification/)
- [FTMO strategy/EA FAQ](https://ftmo.com/faq/which-instruments-can-i-trade-and-what-strategies-am-i-allowed-to-use/)
- [FTMO credential warning](https://ftmo.com/en/faq/i-paid-for-my-ftmo-challenge-when-will-i-get-the-account/)
- [FTMO forbidden trading practices](https://ftmo.com/au/forbidden-trading-practices/)

Provider pages are mutable. Re-run this review and record the retrieval date
before the production decision.

## 3. Provider capability matrix

| Required capability | TickerAll | MetaApi | Phase 0 disposition |
| --- | --- | --- | --- |
| MT5 login + password + exact server | `DOC` | `DOC` | Live test required |
| Automatic broker/server settings discovery | Not described beyond connection input | `DOC`, with suggested server names and provisioning-profile fallback | Live test required |
| Investor-password read-only connection | `DOC` claim accepts investor/master | `DOC` | Prove read succeeds and every write fails safely |
| Demo/live classification | `DOC` (`isDemo`) | Available in account model; live proof pending | Live test required |
| Account/balance/equity/margin | `DOC` | `DOC` | Live test required |
| Open positions | `DOC` REST + WebSocket | `DOC` REST/RPC + stream | Live test required |
| Open pending orders | `MISSING` read contract | `DOC` | TickerAll blocker |
| Broker-native symbols | `DOC` | `DOC` | Live test required |
| Complete instrument specifications | `MISSING` | `DOC` | TickerAll blocker |
| Tick stream | `DOC` | `DOC` | Reconnect/gap test required |
| Account/position stream | `DOC` | `DOC` | Reconnect/gap test required |
| Pending-order stream | `MISSING` | `DOC` synchronization surface | TickerAll blocker |
| Market buy/sell | `DOC` | `DOC` | Live test required |
| Limit/stop pending create | `DOC` | `DOC` | Live test required |
| Stop-limit order | Not documented | `DOC` | Capability-gated feature |
| Modify pending order | `MISSING` | `DOC` | TickerAll blocker |
| Cancel pending order | `MISSING` | `DOC` | TickerAll blocker |
| Modify position SL/TP | `DOC` | `DOC` | Live test required |
| Full close | `DOC` | `DOC` | Live test required |
| Partial close | `DOC` | `DOC` | Hedging/netting live test required |
| Closed-trade history | `DOC` recent-window semantics | `DOC` | Coverage and pagination test required |
| Provider-enforced mutation idempotency | `DOC`, key replay retained 24 hours | `MISSING` for trades | TickerAll live replay test; MetaApi ledger/correlation proof |
| Trade correlation identifier | 31-character comment only | `DOC` `clientId` with length/format limits | Collision and round-trip test required |
| Ordered/replayable stream cursor | `MISSING` | `DOC` sequence metadata in sync events | Gap recovery test required |
| Password retention | `DOC`: memory while connection is live | Provider-managed cloud account; exact retention/security review pending | Written security review required |
| Per-user/per-account provider credential | `MISSING`; account-wide API key | Token/account permissions require validation | Never expose provider token to browser |
| Published SLA/support escalation | Enterprise custom SLA only | Paid support/plan dependent | Contract required before production |

## 4. TickerAll contract findings

### 4.1 Documented positive surface

TickerAll documents:

- REST at `https://api.tickerall.com` and WebSocket at
  `wss://api.tickerall.com/v1/stream`;
- bearer-token authentication;
- `POST /v1/sessions` with `broker`, `server`, `account`, `password`, and
  optional `terminalType`/WebTerminal fields;
- account, positions, symbols, candles, trade history, market/pending creation,
  position modification, full close, and partial close;
- WebSocket tick, position, and account channels;
- `Idempotency-Key` on documented writes, with the original response replayed
  for 24 hours;
- a cooling state represented by `409 BROKER_ACCOUNT_NOT_HOT` and reconnection
  through `POST /v1/sessions`;
- up to five demo accounts on the free plan.

### 4.2 MarketLens-specific security interpretation

- `terminalType`, `webTerminalUrl`, and `webEndpoint` are server-owned settings.
  They must never be accepted from the browser because arbitrary URLs or
  WebSocket endpoints would create an SSRF boundary.
- The TickerAll API key must remain in the backend secret manager. The docs
  permit a WebSocket query token for clients that cannot set headers, but
  MarketLens must use a backend header and never place this token in a URL,
  frontend bundle, browser storage, log, trace, or metric.
- TickerAll says the broker password is held in memory only. A cooled session
  requires the password again, so a persistent MarketLens connection still
  requires an encrypted MarketLens vault secret or an explicit user reconnect.
  TickerAll's non-persistence claim does not remove MarketLens's credential-
  custody obligation.
- A provider account-wide key creates a large blast radius. Production needs
  separate environment keys, rotation, egress allowlisting, log redaction, and
  a provider-side account reconciliation job.
- The privacy policy states that trading/market data is retained for history
  and analytics, but gives no duration. Account deletion is requested by email.
  A written retention/deletion/DPA answer is required before live accounts.

### 4.3 Questions that must receive a written answer

Send these exact questions to `hello@tickerall.com` before continuing to a live
account:

1. Which endpoints list, modify, and cancel MT4/MT5 pending orders? If none,
   what is the delivery date and versioning policy?
2. How are pending create/modify/fill/cancel events streamed and replayed after
   a WebSocket disconnect?
3. How can a client retrieve complete per-account instrument specifications,
   including tick/point, contract size, tick value, volume bounds/step, stops
   and freeze levels, sessions, filling modes, and allowed order types?
4. Are REST/stream events assigned a monotonic sequence or resume cursor? What
   is the authoritative gap-recovery procedure?
5. Does a repeated `Idempotency-Key` with a different body fail, or replay the
   first response? Is the key scope API key, account, route, or operation?
6. What are the p95/p99 order latency, uptime target, maintenance policy,
   support escalation, incident notification, and recovery objectives?
7. Provide Terms of Service, DPA, subprocessors/hosting regions, retention
   schedule, deletion SLA, encryption-at-rest design, audit assurance, and
   breach-notification terms.
8. Can API keys be scoped per environment or broker account, and what is the
   guaranteed revocation propagation time?
9. Do you explicitly permit a SaaS such as MarketLens to connect accounts for
   its end users, including prop-firm accounts, and what proof of account
   ownership do you require?

Do not infer a positive answer from silence.

## 5. MetaApi fallback findings

MetaApi is the fallback candidate because its official contract documents:

- cloud MT4/MT5 account creation with login/password/server and automatic
  server detection, plus a provisioning-profile fallback;
- a secure end-user configuration link option that avoids disclosing the
  configured password back to MarketLens;
- account information, positions, open orders, history, prices, candles, and
  detailed symbol specifications;
- market, limit, stop, stop-limit, pending modify/cancel, position modify,
  partial close, full close, and close-by trade actions;
- synchronization events and client-assigned `clientId` correlation.

The fallback is not automatically approved. The following remain Phase 0 live
or written-contract gates:

- no documented provider-enforced idempotency for trade calls;
- provider storage/retention, subprocessor, region, deletion, and credential-
  custody terms;
- long-lived SDK/stream resource and rate-limit behavior at the expected
  account count;
- server autodetection across the three selected families;
- exact behavior after a timeout where the broker accepted a trade but the API
  response was lost;
- whether the secure configuration link UX satisfies the MarketLens product
  requirement in every target browser.

For MetaApi, a timeout must remain `UNKNOWN` until reconciliation finds a
position/order/deal with the expected short `clientId` or proves absence across
an adequate broker-history window. Never blindly retry a trade only because
the transport failed.

## 6. Broker and prop-firm permission gate

FTMO's current public FAQ permits legitimate algorithmic trading/EAs, subject
to its rules and server limits. Another FTMO FAQ tells customers not to
authorize anyone else to access credentials and disclaims responsibility for
third-party access. Neither statement explicitly authorizes a third-party cloud
connector that receives the user's MT5 password.

Therefore FTMO is **permission pending**, not certified. Before any FTMO
Challenge or FTMO Account is connected to TickerAll/MetaApi, retain a written
answer from FTMO covering:

- whether the named cloud provider may authenticate as the account holder;
- whether sharing credentials with that processor violates account-access or
  account-sharing rules;
- whether orders placed by MarketLens are treated as algorithmic trading and
  which request/order/message limits apply;
- whether investor-password read-only monitoring is allowed;
- whether rules differ between Free Trial, Challenge, Verification, and FTMO
  Account stages.

The same check is required for each retail broker candidate. A broker is not
certified merely because the provider can technically log in.

Suggested support message:

> I own the MT5 account and want to use MarketLens, a web trading application,
> through the cloud connector [TickerAll/MetaApi]. The service receives my MT5
> login, password, and exact server and connects to MT5 without an EA or local
> terminal. It may read account state and, with my master password, submit and
> manage my orders. Is this use expressly permitted under my account agreement?
> Please identify any credential-sharing, automation, message-rate, copying,
> or third-party-access restrictions and confirm whether investor-password
> read-only access is permitted.

## 7. Live validation inventory

### 7.1 Required disposable accounts

Use exactly three independently owned demo accounts:

| Case | Family | Required permission | Lifecycle |
| --- | --- | --- | --- |
| `PF1` | One prop-firm MT5 demo/free-trial server | Written third-party cloud-connection answer | Read sync; lifecycle only if explicitly allowed |
| `RB1` | Retail broker family A | Broker terms/support checked | Complete lifecycle |
| `RB2` | Retail broker family B, different server family | Broker terms/support checked | Complete lifecycle |

Record the exact server string from the account portal. Do not guess or
normalize it. A server name is retained in the certification record; login,
password, account holder, email, IP, and raw provider account ID are redacted.

### 7.2 Test cases

| ID | Test | Pass condition |
| --- | --- | --- |
| `CON-01` | Valid login | Provider reaches connected/synchronized state within recorded time |
| `CON-02` | Wrong password | Stable classified auth error; no secret echoed |
| `CON-03` | Wrong server | Stable server-not-found/settings error with no fallback to another account |
| `CON-04` | Demo/live | Provider classification matches broker portal |
| `CON-05` | Investor password | Reads succeed; every mutation fails without creating exposure |
| `READ-01` | Account snapshot | Balance/equity/margin/currency/leverage have honest null semantics |
| `READ-02` | Portfolio | Positions and pending orders match an independent broker view |
| `READ-03` | Symbols | Broker suffixes and case are preserved |
| `READ-04` | Specifications | Required risk/rounding/session fields are available and correct |
| `READ-05` | History | Orders/deals/round trips have defined time coverage and pagination |
| `STR-01` | Tick stream | Bid/ask timestamps advance; heartbeat behavior is recorded |
| `STR-02` | Portfolio stream | Create/modify/fill/cancel/close events converge to REST truth |
| `STR-03` | Forced reconnect | No duplicate event is applied; a full snapshot repairs every gap |
| `EXE-01` | Market buy/sell | One minimal-volume order each, broker-confirmed |
| `EXE-02` | Pending create | Limit and stop use valid distances from live specification |
| `EXE-03` | Pending modify/cancel | Broker and normalized state converge after each action |
| `EXE-04` | Position SL/TP | Modification is broker-confirmed and streamed/read back |
| `EXE-05` | Partial close | Remaining volume equals specification-rounded expectation |
| `EXE-06` | Full close | No residual position; close deal appears in history |
| `IDM-01` | Same mutation identity | Exactly one broker-side effect after response replay/retry |
| `AMB-01` | Lost response | State remains unknown until broker reconciliation resolves it |
| `SES-01` | Cooling/expiry | Rewarm behavior, credential need, and state convergence are recorded |
| `SEC-01` | Redaction | Tokens/passwords/logins absent from saved fixtures and logs |
| `SEC-02` | Disconnect/delete | Provider session/account deletion behavior and retained metadata recorded |

Use minimum broker-permitted volume and place pending orders far enough from
market to avoid accidental fills. Close/cancel all Phase 0 exposure immediately
after each test. Run only when the target market is open and the account is
explicitly disposable.

### 7.3 Exit calculation

Phase 0 passes only when all of these are true:

- `PF1`, `RB1`, and `RB2` pass `CON-*`, `READ-*`, and applicable `STR-*` tests;
- `RB1` and `RB2` pass the full `EXE-*` lifecycle;
- provider idempotency or the MarketLens ambiguity protocol passes `IDM-01`
  and `AMB-01` without duplicate exposure;
- every required capability is `LIVE` or deliberately marked unsupported and
  blocked by capability flags;
- all provider and broker permission questions have a written disposition;
- there is no unclassified error or stale-versus-empty ambiguity;
- every saved fixture passes the sanitization checklist.

A provider can fail Phase 0 early when its contract lacks a non-negotiable
capability. In that case record `STOP` and validate the fallback instead; do not
weaken the exit gate to fit the provider.

## 8. Secret-safe execution runbook

### 8.1 Inputs

The operator supplies secrets outside Git:

```text
TICKERALL_API_KEY       provider development key, if validating TickerAll
METAAPI_TOKEN           provider development token, if validating MetaApi
PHASE0_MT5_CASES_PATH   absolute path to a local, gitignored JSON file
```

The case file contains `case_id`, `provider`, `platform`, exact `server`,
`login`, `password`, `credential_kind`, and whether execution is authorized.
It must live outside the repository or in an already ignored secret location.
Never paste it into an issue, test output, screenshot, fixture, or commit.

Before a live run:

1. verify all three accounts are demo/free-trial and independently owned;
2. verify written permission for every account where provider access is not
   plainly covered by terms;
3. set a strict maximum volume and a provider/broker request budget;
4. disable shell tracing, HTTP body logging, and verbose SDK logging;
5. create a dedicated short-lived provider key;
6. inspect the exact server strings and execution-authorization booleans;
7. confirm a cleanup operator can independently view and close the accounts.

### 8.2 Disposable harness boundary

The harness is created under the operating-system temporary directory, not in
the repository. It may call the provider directly but may not call a MarketLens
production route or production database. It must:

- default to read-only and require a per-case `execution_authorized=true` plus
  an explicit `--execute-demo-lifecycle` switch for writes;
- refuse any account the provider classifies as live;
- cap volume at the symbol minimum and reject a missing specification;
- generate one mutation identity per logical action and deliberately replay it
  only in `IDM-01`;
- use bounded deadlines and save response metadata without authorization
  headers or request credential bodies;
- perform cleanup in a `finally` path, then independently re-read account
  state;
- emit fixtures conforming to
  `docs/fixtures/mt5-cloud-connector-phase0/result-schema.json`.

Do not commit the harness. Commit only this record and sanitized fixtures.

### 8.3 Sanitization checklist

Before copying output into `docs/fixtures/mt5-cloud-connector-phase0/`:

- replace login/account numbers with a stable local alias such as `acct_pf1`;
- replace provider account/session IDs with `provider_account_pf1`;
- remove passwords, investor passwords, API tokens, cookies, auth headers,
  configuration links, email, phone, name, address, IP, and provider user ID;
- replace broker order/position/deal tickets with stable aliases;
- retain exact server name and broker-native symbol only when permission allows;
- round balances/equity/P&L to non-identifying synthetic values or remove them;
- retain timestamps only as relative offsets unless wall-clock time is required
  for a protocol defect;
- scan case-insensitively for every real secret and identifier before commit;
- validate the JSON schema and manually review the diff.

## 9. Decision record

| Decision | Current value |
| --- | --- |
| TickerAll production decision | `CONDITIONAL_STOP` |
| Reason | Missing pending-order management/state, specifications, replay ordering, and production legal/security evidence |
| TickerAll demo spike | Allowed only after a short-lived API key and disposable demos are supplied |
| MetaApi fallback decision | `PROCEED_TO_LIVE_VALIDATION` |
| MetaApi caveat | No documented native trade idempotency; ambiguity must be reconciled with durable command identity + `clientId` |
| Broker certification | None; FTMO and retail candidates remain permission/live-test pending |
| Production credential/API work | Prohibited until Phase 0 exit gate passes |

## 10. Resume checklist

When the missing inputs are available:

1. fill the local case file for `PF1`, `RB1`, and `RB2`;
2. retain written broker/prop-firm and provider answers;
3. build the disposable harness in the OS temp directory;
4. run read-only tests on all three accounts;
5. run full demo lifecycle on `RB1` and `RB2` only;
6. force idempotency, timeout, reconnect, and cooling scenarios;
7. sanitize and schema-validate fixtures;
8. update every matrix cell from `DOC` to `LIVE`, `WRITTEN`, or `STOP`;
9. choose TickerAll, MetaApi, or stop the initiative;
10. only after a true pass, start Plan 1.
