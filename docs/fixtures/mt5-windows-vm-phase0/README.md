# MT5 Windows VM Phase 0 fixtures

This directory contains sanitized, non-credential evidence for
`docs/MT5_WINDOWS_VM_CONNECTOR_PHASE0_VALIDATION.md`.

- `result-schema.json` defines the committed fixture shape.
- `results.host.json` contains host/runtime preflight only.
- `results.account.sanitized.json` contains the manually reviewed read-only
  account gate. It retains only match booleans, demo mode, counts, runtime
  versions, and a non-identifying symbol specification.

Credentialed account results are written outside the repository. They may be
copied here only after manual sanitization and schema validation. Never commit
an MT5 login, password, DPAPI ciphertext, customer identity, raw ticket, user
profile path, authorization material, or native response payload.
