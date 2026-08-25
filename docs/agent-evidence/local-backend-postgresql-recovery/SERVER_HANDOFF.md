# Local backend PostgreSQL recovery — server handoff

Status: **BLOCKED**

This is a source-and-documentation handoff for server-side inspection. It is not final recovery
EVIDENCE and does not assert production readiness.

## Verified on the originating Windows host

- PostgreSQL authentication/HBA gauntlet: `21/21`.
- Connectable database inventory: `postgres`, `smc`, `template1`; each is owned by `postgres`.
- Fresh `smc` schema state: `42,false`, with all nine representative required tables present.
- `backend/.env` changed only from the obsolete local port to `5432/smc`; its approved final hash
  and inverse baseline hash pass.
- Secret-file ACL inheritance is disabled and exactly the owner, SYSTEM, and Administrators retain
  explicit FullControl.
- Targeted Go test and vet, negative controls, retained-secret scan, and unrelated dirty-worktree
  hash checks pass.
- Latest post-v3 recovery entry point: `21/24`; the pre-v3 result was `19/22`. The three current
  failures are the blocked real API layer and two checks that correctly require final EVIDENCE.

## Exact blocker

Windows Application Control policy `{0283ac0f-fff1-49ae-ada1-8a933130cad6}` rejects unsigned
Cargo-generated build-script executables. Code Integrity recorded events `3033/3077`; Cargo reports
`An Application Control policy has blocked this file` with `os error 4551`.

The gateway therefore never opened its admin listener and the 12 API probes did not run. No
`EVIDENCE.md` exists for this recovery task because the approved v2 specification permits final
EVIDENCE only after those probes pass. Do not interpret the committed verifier or this handoff as a
passing production result.

## What Git does and does not ship

The local backend/.env is not shipped. The password, URL userinfo, ACL, PostgreSQL database and
rows, Cargo/Go build cache, and `.runtime-logs` are also not shipped. They remain host-local state.

`tools/verify-local-backend-postgresql-recovery.ps1` binds exact originating-host hashes, ACLs,
database inventory, and unrelated dirty-file baselines. It is host-specific and is not a portable production-server gauntlet.

The portable local wiring check is:

```powershell
.\tools\verify-backend-local.ps1 -RunFromSource -ReadyTimeoutSeconds 600
```

Source mode uses locked/offline Cargo and disables Go module network access. It may still be
blocked by the server's own Application Control policy. It starts only verifier-owned local
processes and is not a production deployment command.

## Server inspection

From a clean server checkout, first inspect the commit containing this file and the corresponding
CI run:

```powershell
git rev-parse HEAD
git show --stat --oneline HEAD
gh run list --commit (git rev-parse HEAD) --workflow CI
```

Compare `HEAD` with the pushed SHA reported in the delivery message. Inspect the four CI jobs:
`replay-client-boundary`, `backend`, `execution-rust`, and `backend-artifact`.

The canonical production commands remain separate and are not invoked by this handoff:

- For an explicit build-from-source/run request: `.\run-backend-production.ps1`.
- For an explicit deployment of the CI-built artifact: `.\tools\deploy-backend.ps1`.

Choose one only under the repository production runbook. Do not substitute this local source-mode
verifier for either production command.

## Sanitized feedback

Do not send credentials, database URLs, tokens, private keys, SCRAM values, or `.env` contents back
in chat. Report only:

- checked commit SHA;
- CI run URL and terminal job conclusions;
- command exit code and sanitized failure marker;
- whether Code Integrity recorded event `3033` or `3077`;
- whether expected health endpoints passed, without response secrets.
