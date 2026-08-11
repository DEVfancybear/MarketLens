# Phase 0 sanitized fixtures

This directory contains only redacted validation evidence for
`docs/MT5_CLOUD_CONNECTOR_PHASE0_VALIDATION.md`.

- `result-schema.json` defines the committed fixture shape.
- `results.pending.json` records that live validation has not run because the
  provider key and disposable demo accounts are not available.

Never commit a raw provider request or response. In particular, remove MT5
passwords/logins, provider tokens, authorization headers, user details, IPs,
provider configuration links, raw provider account/session IDs, and raw broker
tickets. Exact server names may be retained only for a tested certification
candidate and are not present in the pending fixture.

Each future observed fixture must set `evidence_level` to `LIVE`, state whether
execution was authorized, and include only stable aliases for accounts and
tickets. A documentation example must never be labeled `LIVE`.
