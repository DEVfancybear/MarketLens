# MT5 Windows VM connector Phase 0–4 operator checklist

This is the secret-safe handoff for the remaining external gates. Never paste credentials, tokens,
raw login/account/ticket identifiers, terminal paths, Vault responses or unsanitized logs into chat
or Git. Report only `PASS`/`BLOCKED`, sanitized timestamps, counts and stable error codes.

## 1. Repository and disposable migration gate

On a host with a disposable PostgreSQL database (not production), set the process-local variable
without echoing it:

```powershell
$env:MT5_PHASE4_DATABASE_URL = '<disposable-postgres-url>'
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-mt5-phase4.ps1
Remove-Item Env:MT5_PHASE4_DATABASE_URL
```

Expected: Rust/Python/Go layers PASS and `postgres-0040-0041-roundtrip` PASS after 0040/0041
up → down one step → up. Stop if the URL is a production database, migration is dirty, or any
secret appears in output. The verifier never prints the URL.

## 2. Phase 1 signed-agent gate

On the licensed Windows VM, provide a signed/reputable `mt5-vm-agent.exe` accepted by the host
Application Control policy and run the normal authenticated stdio harness from
`MT5_WINDOWS_VM_CONNECTOR_PHASE1_VALIDATION.md` (omit `-ApplicationControlTestHost`). Compare
server, masked identity, demo mode, positions, pending orders, seven-day history counts and a
selected symbol specification against an independent FTMO web view. Provision a second disposable
demo and a second installed terminal slot; run both concurrently, crash/recover one, and prove the
other heartbeat/snapshot remains healthy. Stop on `MT5_IPC_TIMEOUT`, identity mismatch, orphaned
terminal, cross-account observation, or any credential/log leakage.

## 3. Phase 2 control-plane gate

Apply migration `0038` to a disposable database, restart two gateway processes, and record that
workers, leases, queued commands and session generations survive. Configure a unique worker
bootstrap secret in the secret system (never the admin token). Rotate a signed worker session,
then reassign a disposable account. Record only sanitized generation numbers and stable outcomes:
the old session cannot heartbeat/poll/ack, the stale command is fenced, the generation increases,
and the new worker receives exactly one durable provision command. Stop on any stale write accepted
or duplicate command.

## 4. Phase 3 Vault/API gate

Apply migration `0039` through the canonical backend runner. Configure the narrow Vault policy,
ACL-restricted absolute token file, Vault address and token-file settings; keep worker grant routes
on private ingress. Exercise one disposable demo through connect → ready → reconnect → rotate →
disconnect → remove. Inspect only sanitized Vault metadata and PostgreSQL column names after removal:
no password, credential version, raw grant token or secret reference may remain. Stop on Vault
unavailability, stale owner/revision acceptance, replayed grant, or secret in a response/log.

## 5. Phase 4 live read exit gate

Using FTMO and one retail demo only after gates 1–4, capture independent terminal and broker-web
snapshots for account, positions, pending orders, instruments, order history and deals. Repeat after
disconnect, reconnect and a cold cache. Compare sanitized row counts, freshness verdicts and stable
error codes; do not record account numbers or tickets. Stop if a partial/failed page is treated as
empty, one-sided portfolio freshness appears, a cursor skips/duplicates rows, or either account can
read the other owner's data.

Phase 5 order execution remains prohibited until every section above is reported `PASS` with its
sanitized evidence.
