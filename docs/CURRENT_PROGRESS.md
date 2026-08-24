# Current progress

Verified on 2026-08-24.

## Recently completed

- Replaced the managed MT5 external credential service with a source-owned Windows Credential
  Manager adapter, fail-closed startup probe, opaque references, and identity-bound recovery.
- Open-sourced MarketLens under MIT and replaced the public README with a product-focused
  Vietnamese/English presentation.
- Upgraded codebase-memory-mcp to v0.10.8, rebuilt the shared graph, added `.cbmignore`, and added a
  recovery ladder for command, transport, stale-project, indexing, and installer failures.
- Completed the managed MT5 lifecycle, common-EA bootstrap, bare-metal worker installation, image
  automation, broker enrollment, and local synthetic/disposable verification layers.
- Restored cross-platform Rust CI gates so Windows-only managed tests run in the Windows artifact
  job while portable workspace tests stay on Linux.
- Audited root/frontend documentation, replaced stale current-state snapshots, removed deleted
  browser-bridge guidance from current indexes, and aligned frontend versions with the manifest.
- Hardened the Rust scripted HTTP test server so intentional client disconnects cannot randomly fail
  the Linux CI suite while unrelated I/O errors remain visible, and serialized the two
  process-environment configuration tests that previously raced in the full workspace suite.

## Active delivery focus

1. Keep all GitHub Actions jobs green for the documentation/CI refresh commit.
2. Activate the managed MT5 production path only after the runbook's worker, Windows
   credential-store probe, stable identities, reverse-proxy, terminal/EA hash, heartbeat,
   capacity, and R15-9 Demo gates pass.
3. Deploy a CI-built checksummed backend artifact and attach production smoke evidence to its exact
   commit.

## Durable completed boundaries

- Backend-authoritative replay and the client-authority deletion gate.
- Authenticated resource persistence and sync boundaries for the shipped backend resources.
- Desktop/mobile product surfaces and Vietnamese/English localization infrastructure.
- Drawing engine/tool registry, visual baseline matrix, alerts, journal, analytics, simulated
  trading, and centralized risk controls.
- Durable Go/Rust execution commands, events, audit, copy routing, MT5 worker/EA lifecycle, and prop
  risk guard.

Historical phase completion detail remains in `CHANGELOG.md`, numbered phase documents, and
`agent-evidence/`. It is intentionally not duplicated here.

## Next checkpoint

Follow [Next tasks](NEXT_TASKS.md). Update this page only when the active delivery focus or a durable
cross-package boundary changes.
