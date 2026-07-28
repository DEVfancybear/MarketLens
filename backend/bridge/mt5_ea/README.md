# SMC Execution EA

This is the single MT5-side adapter for every MT5 broker. It contains no FTMO,
Exness, symbol-alias, copy-allocation, or risk-policy branches. Those decisions
belong to the Rust execution service; the EA validates the terminal boundary,
runs `OrderCheck`, submits the already-routed command, and reports broker
transactions.

## Install

1. In the Trade workspace, select **Add → Download MT5 EA**.
2. Copy `SMCExecutionEA.ex5` into `MQL5/Experts/SMC/`, refresh the Navigator,
   and attach it to one chart in each terminal.
3. In MT5, add the gateway origin under **Tools → Options → Expert Advisors →
   Allow WebRequest for listed URL**.
4. Enter the public HTTPS gateway URL and a short-lived pairing token.
5. Enable **Algo Trading**. The same EA supports Demo and Live accounts; the
   Rust account policy remains the authoritative permission and risk boundary.

MT5 supports one active account per terminal. To use multiple accounts, run one
terminal instance per account and attach the same EA to each instance. The Rust
gateway derives a stable account ID from `server + login`.

## Upgrade without closing broker positions

Open positions and pending orders belong to the MT5 account, not to the EA
process. Replacing or restarting `SMCExecutionEA` does not close or cancel them.
Upgrade one terminal at a time so the other execution accounts remain
available:

1. Deploy the backend first with `.\run-backend-production.ps1`.
2. Stop submitting web commands to the account being upgraded. Do not close,
   cancel, or recreate its broker orders merely because the web portfolio is
   temporarily empty.
3. Download the current EA and its `.sha256` file from the Trade workspace,
   verify the checksum, and replace
   `MQL5\Experts\SMC\SMCExecutionEA.ex5` in that terminal's data folder.
4. In Navigator, select **Refresh**, then remove and reattach the EA or restart
   that terminal so MT5 loads the new binary.
5. Keep `GatewayUrl` unchanged. The paired session is normally restored because
   it is bound to `login + server + GatewayUrl`; enter a new one-time token only
   if the Experts log explicitly requests one.
6. Confirm the Experts log reports a restored or paired session and the web
   account returns to `READY`. The web polls every two seconds and EA portfolio
   snapshots run at most ten seconds apart, so positions and pending orders
   should appear within about ten seconds after a healthy reconnect.

Version 1.22 remains supported during a rolling deployment because the current
Rust gateway commits portfolio state independently before processing metadata
or command events. Version 1.23 is recommended: it also separates these lanes
inside the EA, providing independent retries and lane-specific diagnostics.

## Safety and current boundary

- The default EA gateway binds to `127.0.0.1:8790`. Production uses the public
  HTTPS Go relay at `/execution-ea`; both Rust listeners remain loopback-only.
- Demo and Live accounts use the same protocol and code path.
- Pairing tokens are single-use. The resulting revocable session is cached in
  the MT5 terminal sandbox, is bound to `login + server + GatewayUrl`, and is
  restored after a terminal restart.
- EA 1.23 sends portfolio, command outcomes, and instrument discovery through
  independent retry lanes. A rejected symbol metadata record or command event
  cannot roll back valid open positions and pending orders.
- HTTP is never called from `OnTradeTransaction`; that callback only appends to
  a bounded in-memory buffer.
- Event timestamps use the Rust gateway UTC clock returned by session and poll
  responses. Broker-local MT5 time is normalized before portfolio data is sent.
- During rollout, the gateway normalizes bounded future timestamps from older
  EA builds while rejecting extreme clock skew.
- Exact duplicate terminal events are idempotent. Failed portfolio, command
  event, and instrument uploads each use bounded exponential backoff and include
  the failing lane plus gateway error code/message in the MT5 Experts log
  without logging session credentials.
- Commands, per-target outcomes, account snapshots, and audit events are stored
  durably in PostgreSQL. Ambiguous broker outcomes are reconciled from terminal
  state and are never blindly submitted a second time.
- MetaTrader `WebRequest` is synchronous and requires an allow-listed URL. The
  EA therefore cannot be truly zero-click; the one-time allow-list step is a
  platform constraint.

## Publish a release

Maintainers compile and publish the downloadable artifact on a trusted Windows
host:

```powershell
.\backend\bridge\mt5_ea\Publish-SMCExecutionEA.ps1
```

The publisher requires MetaEditor to report `0 errors, 0 warnings`, then writes
the `.ex5`, SHA-256 checksum, and source/binary release manifest to
`frontend/public/downloads`. The frontend production build runs the publisher
in verification-only mode and fails if the source, binary, manifest, or
checksum do not match.
