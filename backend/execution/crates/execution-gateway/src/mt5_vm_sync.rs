//! Phase 4a: normalized read synchronization for the managed MT5 VM connector.
//!
//! This module owns the decisions that protect the read path. It is deliberately
//! split into pure functions plus thin SQL wiring so the dangerous rules can be
//! tested without a database or a live terminal.
//!
//! The rule that matters most is plan invariant 8, "empty is not unknown": a
//! stale, partial or failed snapshot must never erase positions or pending
//! orders. A snapshot therefore declares its own completeness, and only a
//! `complete` snapshot is allowed to delete rows it does not mention.

// Increment 1 of Phase 4a delivers the migration, this decision core and the
// Python normalizer. The SQL ingestion transaction and the owner-scoped read
// handlers that consume these functions land in increment 2, so several items
// here are intentionally not called yet. They are covered by their own tests and
// are the contract increment 2 must satisfy.
#![allow(dead_code)]

use std::collections::BTreeSet;
use std::str::FromStr;

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

/// The four data families Phase 4a synchronizes. These are exactly the families
/// plan section 5.1 requires before an account may report `ready`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SnapshotFamily {
    Account,
    Positions,
    PendingOrders,
    Instruments,
}

impl SnapshotFamily {
    pub fn as_str(self) -> &'static str {
        match self {
            SnapshotFamily::Account => "account",
            SnapshotFamily::Positions => "positions",
            SnapshotFamily::PendingOrders => "pending_orders",
            SnapshotFamily::Instruments => "instruments",
        }
    }

    /// The `execution_mt5_vm_accounts` freshness anchor this family advances.
    pub fn freshness_column(self) -> &'static str {
        match self {
            SnapshotFamily::Account => "last_account_sync_at",
            // Positions and pending orders together constitute the portfolio.
            SnapshotFamily::Positions | SnapshotFamily::PendingOrders => "last_portfolio_sync_at",
            SnapshotFamily::Instruments => "last_instrument_sync_at",
        }
    }
}

/// How complete the worker believes this observation to be.
///
/// `Complete` is an assertion by the worker that it successfully enumerated the
/// whole family. Anything else means the reader must keep what it already has.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SnapshotResult {
    Complete,
    Partial,
    Failed,
}

impl SnapshotResult {
    pub fn as_str(self) -> &'static str {
        match self {
            SnapshotResult::Complete => "complete",
            SnapshotResult::Partial => "partial",
            SnapshotResult::Failed => "failed",
        }
    }

    /// Only a complete observation may remove rows, and only a complete
    /// observation may advance freshness.
    pub fn is_authoritative(self) -> bool {
        matches!(self, SnapshotResult::Complete)
    }
}

/// Envelope every snapshot carries, per plan section 6.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncEnvelope {
    pub account_id: String,
    pub worker_id: String,
    pub family: SnapshotFamily,
    pub result: SnapshotResult,
    pub lease_generation: i64,
    pub worker_session_generation: i64,
    pub sync_sequence: i64,
    pub observed_at_ms: i64,
    #[serde(default)]
    pub error_code: Option<String>,
}

/// The state a snapshot is fenced against.
#[derive(Debug, Clone, Copy)]
pub struct FenceState {
    pub current_lease_generation: i64,
    pub current_worker_session_generation: i64,
    pub stored_sync_sequence: i64,
}

/// Why a snapshot was refused. Every variant is a typed, non-leaking reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncRejection {
    /// The worker no longer holds the lease it claims.
    StaleLease,
    /// The worker session was replaced; this frame belongs to the old session.
    StaleWorkerSession,
    /// Already applied, or arrived out of order.
    ReplayedSequence,
    /// Envelope failed structural validation.
    MalformedEnvelope,
    /// Observed broker identity does not match the registered account.
    IdentityMismatch,
}

impl SyncRejection {
    pub fn code(self) -> &'static str {
        match self {
            SyncRejection::StaleLease => "SYNC_STALE_LEASE",
            SyncRejection::StaleWorkerSession => "SYNC_STALE_WORKER_SESSION",
            SyncRejection::ReplayedSequence => "SYNC_REPLAYED_SEQUENCE",
            SyncRejection::MalformedEnvelope => "SYNC_MALFORMED_ENVELOPE",
            SyncRejection::IdentityMismatch => "SYNC_IDENTITY_MISMATCH",
        }
    }
}

/// What the ingestion transaction should do with the rows it already holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReconcilePlan {
    /// Keys present in the snapshot; these are upserted.
    pub upserts: Vec<String>,
    /// Keys to remove. Always empty unless the snapshot is authoritative.
    pub deletes: Vec<String>,
    /// Whether the matching freshness anchor may advance.
    pub advance_freshness: bool,
}

/// Freshness verdict returned to readers alongside the rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Freshness {
    /// Observed recently enough to be trusted for `ready`.
    Fresh,
    /// Observed, but older than the bound.
    Stale,
    /// Never observed, or the last observation was not authoritative.
    Unknown,
}

/// Reject an envelope that cannot be trusted before any row is touched.
///
/// Order matters. Structural validation runs first so a zero generation is
/// reported as malformed rather than being compared numerically, and the
/// sequence check runs last so a legitimately fenced worker is told about the
/// lease rather than the sequence.
pub fn fence_snapshot(envelope: &SyncEnvelope, state: &FenceState) -> Result<(), SyncRejection> {
    if envelope.account_id.trim().is_empty()
        || envelope.worker_id.trim().is_empty()
        || envelope.lease_generation <= 0
        || envelope.worker_session_generation <= 0
        || envelope.sync_sequence <= 0
        || envelope.observed_at_ms <= 0
    {
        return Err(SyncRejection::MalformedEnvelope);
    }
    // An exact match only. A worker claiming a generation the control plane has
    // not issued is no more trustworthy than one claiming an expired generation.
    if envelope.lease_generation != state.current_lease_generation {
        return Err(SyncRejection::StaleLease);
    }
    if envelope.worker_session_generation != state.current_worker_session_generation {
        return Err(SyncRejection::StaleWorkerSession);
    }
    if envelope.sync_sequence <= state.stored_sync_sequence {
        return Err(SyncRejection::ReplayedSequence);
    }
    Ok(())
}

/// Decide which keys to upsert and which, if any, may be deleted.
///
/// This is the enforcement point for invariant 8. Deletions are permitted only
/// when the worker asserts it enumerated the whole family; anything else leaves
/// the stored set alone. The upsert list is still honoured for a partial
/// observation, because rows the worker did see are better refreshed than stale.
pub fn reconcile_plan(
    stored_keys: &[String],
    snapshot_keys: &[String],
    result: SnapshotResult,
) -> ReconcilePlan {
    let snapshot: BTreeSet<&String> = snapshot_keys.iter().collect();
    let upserts: Vec<String> = snapshot.iter().map(|key| (*key).clone()).collect();

    let deletes = if result.is_authoritative() {
        stored_keys
            .iter()
            .collect::<BTreeSet<&String>>()
            .into_iter()
            .filter(|key| !snapshot.contains(*key))
            .cloned()
            .collect()
    } else {
        Vec::new()
    };

    ReconcilePlan {
        upserts,
        deletes,
        advance_freshness: result.is_authoritative(),
    }
}

/// Invariant 7: requested and observed identity must match after normalization.
///
/// A registered login suffix that the terminal did not report is a mismatch, not
/// a pass: absence must never be read as agreement.
pub fn identity_matches(
    registered_server: &str,
    registered_login_suffix: Option<&str>,
    observed_server: &str,
    observed_login_suffix: Option<&str>,
) -> bool {
    if !normalized_server_eq(registered_server, observed_server) {
        return false;
    }
    match registered_login_suffix {
        None => true,
        Some(expected) => observed_login_suffix
            .map(|observed| observed.trim() == expected.trim())
            .unwrap_or(false),
    }
}

fn normalized_server_eq(left: &str, right: &str) -> bool {
    left.trim().to_ascii_lowercase() == right.trim().to_ascii_lowercase()
}

/// Classify how much a reader may rely on the last observation.
///
/// Only an authoritative observation can be fresh. An observation timestamped in
/// the future is treated as stale so clock skew cannot manufacture freshness.
pub fn freshness_verdict(
    observed_at_ms: Option<i64>,
    last_result: Option<SnapshotResult>,
    now_ms: i64,
    bound_ms: i64,
) -> Freshness {
    let (Some(observed_at_ms), Some(last_result)) = (observed_at_ms, last_result) else {
        return Freshness::Unknown;
    };
    if !last_result.is_authoritative() {
        return Freshness::Unknown;
    }
    let age_ms = now_ms.saturating_sub(observed_at_ms);
    if age_ms < 0 || age_ms > bound_ms {
        return Freshness::Stale;
    }
    Freshness::Fresh
}

/// Validate that a decimal transport value is a plain decimal string.
///
/// Plan section 6 requires decimals on the wire as strings. Accepting a JSON
/// number here would silently reintroduce binary floating point into money, and
/// accepting scientific notation would let a broker payload smuggle in a value
/// no operator would recognise in a log. Only `-?digits(.digits)?` is allowed.
pub fn parse_decimal(value: &str) -> Result<Decimal, SyncRejection> {
    let bytes = value.as_bytes();
    let mut index = 0usize;

    if bytes.first() == Some(&b'-') {
        index = 1;
    }
    let integer_start = index;
    while index < bytes.len() && bytes[index].is_ascii_digit() {
        index += 1;
    }
    if index == integer_start {
        return Err(SyncRejection::MalformedEnvelope);
    }
    if index < bytes.len() {
        if bytes[index] != b'.' {
            return Err(SyncRejection::MalformedEnvelope);
        }
        index += 1;
        let fraction_start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        if index == fraction_start || index != bytes.len() {
            return Err(SyncRejection::MalformedEnvelope);
        }
    }

    Decimal::from_str(value).map_err(|_| SyncRejection::MalformedEnvelope)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn envelope(lease: i64, session: i64, sequence: i64) -> SyncEnvelope {
        SyncEnvelope {
            account_id: "acct-1".into(),
            worker_id: "worker-01".into(),
            family: SnapshotFamily::Positions,
            result: SnapshotResult::Complete,
            lease_generation: lease,
            worker_session_generation: session,
            sync_sequence: sequence,
            observed_at_ms: 1_760_000_000_000,
            error_code: None,
        }
    }

    fn state(lease: i64, session: i64, stored: i64) -> FenceState {
        FenceState {
            current_lease_generation: lease,
            current_worker_session_generation: session,
            stored_sync_sequence: stored,
        }
    }

    fn keys(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    // --- Scenario 1: a complete snapshot replaces the set -------------------

    #[test]
    fn complete_snapshot_deletes_rows_it_does_not_mention() {
        let plan = reconcile_plan(
            &keys(&["100", "200"]),
            &keys(&["200"]),
            SnapshotResult::Complete,
        );
        assert_eq!(plan.upserts, keys(&["200"]));
        assert_eq!(plan.deletes, keys(&["100"]));
        assert!(plan.advance_freshness);
    }

    // --- Scenario 2 and 3: partial and failed must never delete -------------

    #[test]
    fn partial_snapshot_never_deletes_and_never_advances_freshness() {
        let plan = reconcile_plan(&keys(&["100", "200"]), &[], SnapshotResult::Partial);
        assert!(
            plan.deletes.is_empty(),
            "invariant 8: a partial snapshot must not erase a portfolio"
        );
        assert!(!plan.advance_freshness);
    }

    #[test]
    fn failed_snapshot_never_deletes_and_never_advances_freshness() {
        let plan = reconcile_plan(&keys(&["100", "200"]), &[], SnapshotResult::Failed);
        assert!(plan.deletes.is_empty());
        assert!(!plan.advance_freshness);
    }

    #[test]
    fn partial_snapshot_still_upserts_what_it_did_observe() {
        // A partial observation is not worthless: it may refresh the rows it saw.
        let plan = reconcile_plan(
            &keys(&["100", "200"]),
            &keys(&["200"]),
            SnapshotResult::Partial,
        );
        assert_eq!(plan.upserts, keys(&["200"]));
        assert!(plan.deletes.is_empty());
    }

    // --- Scenario 4: an empty portfolio must remain representable -----------

    #[test]
    fn complete_empty_snapshot_clears_the_portfolio() {
        // This is the other half of invariant 8. Without it, "never delete on
        // empty" would degrade into "never delete", and a closed position would
        // linger forever.
        let plan = reconcile_plan(&keys(&["100", "200"]), &[], SnapshotResult::Complete);
        assert_eq!(plan.deletes, keys(&["100", "200"]));
        assert!(plan.upserts.is_empty());
        assert!(plan.advance_freshness);
    }

    // --- Scenarios 5 and 6: fencing ----------------------------------------

    #[test]
    fn current_generation_and_new_sequence_are_accepted() {
        fence_snapshot(&envelope(7, 3, 42), &state(7, 3, 41)).expect("fresh frame is accepted");
    }

    #[test]
    fn stale_lease_generation_is_refused() {
        assert_eq!(
            fence_snapshot(&envelope(6, 3, 42), &state(7, 3, 41)),
            Err(SyncRejection::StaleLease)
        );
    }

    #[test]
    fn future_lease_generation_is_refused_as_stale_too() {
        // A worker claiming a generation the control plane has not issued is not
        // trustworthy either; only an exact match may write.
        assert_eq!(
            fence_snapshot(&envelope(8, 3, 42), &state(7, 3, 41)),
            Err(SyncRejection::StaleLease)
        );
    }

    #[test]
    fn replaced_worker_session_is_refused() {
        assert_eq!(
            fence_snapshot(&envelope(7, 2, 42), &state(7, 3, 41)),
            Err(SyncRejection::StaleWorkerSession)
        );
    }

    #[test]
    fn replayed_or_equal_sequence_is_refused() {
        assert_eq!(
            fence_snapshot(&envelope(7, 3, 41), &state(7, 3, 41)),
            Err(SyncRejection::ReplayedSequence)
        );
        assert_eq!(
            fence_snapshot(&envelope(7, 3, 40), &state(7, 3, 41)),
            Err(SyncRejection::ReplayedSequence)
        );
    }

    #[test]
    fn non_positive_identifiers_are_malformed() {
        assert_eq!(
            fence_snapshot(&envelope(0, 3, 42), &state(0, 3, 41)),
            Err(SyncRejection::MalformedEnvelope)
        );
        assert_eq!(
            fence_snapshot(&envelope(7, 0, 42), &state(7, 0, 41)),
            Err(SyncRejection::MalformedEnvelope)
        );
        assert_eq!(
            fence_snapshot(&envelope(7, 3, 0), &state(7, 3, 0)),
            Err(SyncRejection::MalformedEnvelope)
        );
    }

    // --- Scenario 7: identity match before ready ---------------------------

    #[test]
    fn identity_matches_ignoring_case_and_padding() {
        assert!(identity_matches(
            "FTMO-Demo",
            Some("4321"),
            "  ftmo-demo ",
            Some("4321")
        ));
    }

    #[test]
    fn different_server_or_login_suffix_is_rejected() {
        assert!(!identity_matches(
            "FTMO-Demo",
            Some("4321"),
            "FTMO-Live",
            Some("4321")
        ));
        assert!(!identity_matches(
            "FTMO-Demo",
            Some("4321"),
            "FTMO-Demo",
            Some("9999")
        ));
    }

    #[test]
    fn a_missing_observed_login_suffix_cannot_satisfy_a_registered_one() {
        // Absence must never be read as agreement.
        assert!(!identity_matches(
            "FTMO-Demo",
            Some("4321"),
            "FTMO-Demo",
            None
        ));
    }

    #[test]
    fn an_unregistered_login_suffix_matches_on_server_alone() {
        assert!(identity_matches(
            "FTMO-Demo",
            None,
            "ftmo-demo",
            Some("4321")
        ));
    }

    // --- Freshness ---------------------------------------------------------

    #[test]
    fn freshness_requires_a_recent_authoritative_observation() {
        let now = 1_760_000_000_000;
        assert_eq!(
            freshness_verdict(
                Some(now - 5_000),
                Some(SnapshotResult::Complete),
                now,
                30_000
            ),
            Freshness::Fresh
        );
        assert_eq!(
            freshness_verdict(
                Some(now - 60_000),
                Some(SnapshotResult::Complete),
                now,
                30_000
            ),
            Freshness::Stale
        );
        assert_eq!(
            freshness_verdict(None, None, now, 30_000),
            Freshness::Unknown
        );
    }

    #[test]
    fn a_recent_but_non_authoritative_observation_is_not_fresh() {
        let now = 1_760_000_000_000;
        assert_eq!(
            freshness_verdict(
                Some(now - 1_000),
                Some(SnapshotResult::Partial),
                now,
                30_000
            ),
            Freshness::Unknown
        );
        assert_eq!(
            freshness_verdict(Some(now - 1_000), Some(SnapshotResult::Failed), now, 30_000),
            Freshness::Unknown
        );
    }

    #[test]
    fn an_observation_from_the_future_is_not_treated_as_fresh() {
        // Clock skew must not manufacture freshness.
        let now = 1_760_000_000_000;
        assert_eq!(
            freshness_verdict(
                Some(now + 120_000),
                Some(SnapshotResult::Complete),
                now,
                30_000
            ),
            Freshness::Stale
        );
    }

    // --- Scenario 10: decimals stay strings --------------------------------

    #[test]
    fn decimal_strings_parse_without_binary_floating_point() {
        assert_eq!(
            parse_decimal("0.10").expect("plain decimal"),
            Decimal::from_str("0.10").expect("reference decimal")
        );
        assert_eq!(
            parse_decimal("-1234567.12345678").expect("negative decimal"),
            Decimal::from_str("-1234567.12345678").expect("reference decimal")
        );
    }

    #[test]
    fn non_decimal_transport_values_are_refused() {
        for value in ["", " ", "1e5", "NaN", "inf", "1,5", "0x10", "1.2.3"] {
            assert_eq!(
                parse_decimal(value),
                Err(SyncRejection::MalformedEnvelope),
                "{value:?} must not be accepted as a decimal"
            );
        }
    }

    #[test]
    fn a_decimal_field_rejects_a_json_number() {
        // The DTO type is String, so serde refuses a bare number before any of
        // this module's logic runs. This pins that contract.
        #[derive(Deserialize)]
        struct Probe {
            #[allow(dead_code)]
            volume: String,
        }
        assert!(serde_json::from_str::<Probe>(r#"{"volume":"0.10"}"#).is_ok());
        assert!(serde_json::from_str::<Probe>(r#"{"volume":0.10}"#).is_err());
    }

    // --- Family wiring -----------------------------------------------------

    #[test]
    fn each_family_advances_its_documented_freshness_anchor() {
        assert_eq!(
            SnapshotFamily::Account.freshness_column(),
            "last_account_sync_at"
        );
        assert_eq!(
            SnapshotFamily::Positions.freshness_column(),
            "last_portfolio_sync_at"
        );
        assert_eq!(
            SnapshotFamily::PendingOrders.freshness_column(),
            "last_portfolio_sync_at"
        );
        assert_eq!(
            SnapshotFamily::Instruments.freshness_column(),
            "last_instrument_sync_at"
        );
    }

    #[test]
    fn duplicate_keys_in_one_snapshot_are_collapsed() {
        let plan = reconcile_plan(&[], &keys(&["200", "200", "100"]), SnapshotResult::Complete);
        assert_eq!(plan.upserts, keys(&["100", "200"]));
    }
}
