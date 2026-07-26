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

## Safety and current boundary

- The default EA gateway binds to `127.0.0.1:8790`. Production uses the public
  HTTPS Go relay at `/execution-ea`; both Rust listeners remain loopback-only.
- Demo and Live accounts use the same protocol and code path.
- Pairing tokens are single-use. The resulting revocable session is cached in
  the MT5 terminal sandbox, is bound to `login + server + GatewayUrl`, and is
  restored after a terminal restart.
- HTTP is never called from `OnTradeTransaction`; that callback only appends to
  a bounded in-memory buffer.
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
