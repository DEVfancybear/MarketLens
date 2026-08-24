# Next tasks

Verified on 2026-08-24. Priorities are ordered by production risk and dependency, not feature appeal.

## P0 — delivery health

1. Keep `master` green across frontend, Go backend, Rust execution, and Windows artifact jobs.
2. Deploy only an artifact whose manifest commit matches checked-out `HEAD` and whose
   `SHA256SUMS` passes verification.
3. Record local and public health results for the exact deployed commit.

## P0 — managed MT5 activation

1. Verify backend, execution gateway, stable Windows API identity, credential-store probe, worker
   heartbeat/lease, terminal-slot capacity, terminal/EA hashes, and reverse-proxy allow-list.
2. Run the R15-9 gate with two test owners and three disposable Demo accounts.
3. Prove restart/reconciliation, generation fencing, secret redaction, independent account
   isolation, and no duplicate controller before any Live/funded onboarding.
4. Stop and preserve evidence on any identity mismatch, unknown cleanup state, stale generation,
   failed reconciliation, or gauntlet failure.

Use [Bare-metal managed MT5 runbook](MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md) and
[MT5 operator checklist](MT5_WINDOWS_VM_CONNECTOR_PHASE0_4_OPERATOR_CHECKLIST.md).

## P1 — production validation

1. Run the maintained frontend/API/managed-MT5 smoke checks after deployment.
2. Verify audit/event persistence and copy-target outcomes through restart and transient transport
   failures.
3. Capture capacity/resource measurements from the actual Windows production host rather than
   extrapolating local synthetic results.

## P2 — future execution venues

Native Binance remains disabled. Treat it as a separate approved security vertical covering secret
storage, signing/time sync, exchange filters, rate limits, idempotency, reconciliation, testnet, and
minimal mainnet canary evidence. Do not enable the enum/trait stub as production support.

## Documentation upkeep

- Update current-state pages from source/manifests and successful runs, not old phase plans.
- Keep prior SPEC/EVIDENCE, audits, and phase records immutable.
- Move durable conclusions into maintained architecture/runbooks and link the historical evidence.
- Run the documentation link/stale-reference verifier whenever files are renamed or deleted.
