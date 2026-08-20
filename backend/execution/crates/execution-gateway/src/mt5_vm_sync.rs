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

use std::str::FromStr;

#[cfg(test)]
use std::collections::BTreeSet;

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx_core::row::Row;
use sqlx_postgres::{PgPool, Postgres};
use uuid::Uuid;

use super::{ApiError, GatewayState, now_ms, parse_owner_id, require_admin};

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
    #[cfg(test)]
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
    pub lease_generation: i64,
    pub worker_session_generation: i64,
    pub sync_sequence: i64,
    pub observed_at_ms: i64,
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
#[cfg(test)]
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

const MAX_SNAPSHOT_ROWS: usize = 4_096;
const MAX_ERROR_CODE: usize = 64;
const READ_FRESHNESS_BOUND_MS: i64 = 60_000;
const MAX_FUTURE_SKEW_MS: i64 = 30_000;
const MAX_HISTORY_WINDOW_MS: i64 = 31 * 24 * 60 * 60 * 1000;
const MAX_HISTORY_LIMIT: i64 = 500;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotSubmission {
    pub protocol_version: u16,
    pub worker_id: String,
    pub session_generation: u64,
    pub account_id: String,
    pub lease_generation: u64,
    pub sync_sequence: i64,
    pub observed_at_ms: i64,
    pub family: SnapshotFamily,
    pub result: SnapshotResult,
    #[serde(default)]
    pub error_code: Option<String>,
    pub payload: SnapshotPayload,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    content = "data",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum SnapshotPayload {
    Account {
        account: Option<Box<AccountObservation>>,
    },
    Positions {
        positions: Vec<PositionObservation>,
    },
    PendingOrders {
        pending_orders: Vec<PendingOrderObservation>,
    },
    Instruments {
        instruments: Vec<InstrumentObservation>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountObservation {
    pub currency: String,
    pub leverage: Option<i32>,
    pub balance: String,
    pub equity: String,
    pub margin: String,
    pub free_margin: String,
    pub margin_level: Option<String>,
    pub margin_mode: String,
    pub account_mode: String,
    pub trade_allowed: bool,
    pub observed_server: String,
    pub observed_login_suffix: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PositionObservation {
    pub broker_ticket: String,
    pub symbol: String,
    pub side: String,
    pub volume: String,
    pub open_price: String,
    pub current_price: Option<String>,
    pub stop_loss: Option<String>,
    pub take_profit: Option<String>,
    pub swap: Option<String>,
    pub profit: Option<String>,
    pub magic: Option<i64>,
    pub opened_at_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingOrderObservation {
    pub broker_ticket: String,
    pub symbol: String,
    pub order_type: String,
    pub volume_current: String,
    pub volume_initial: Option<String>,
    pub price_open: String,
    pub price_stop_limit: Option<String>,
    pub stop_loss: Option<String>,
    pub take_profit: Option<String>,
    pub time_in_force: Option<String>,
    pub magic: Option<i64>,
    pub placed_at_ms: Option<i64>,
    pub expires_at_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstrumentObservation {
    pub symbol: String,
    pub digits: i32,
    pub point: String,
    pub tick_size: Option<String>,
    pub tick_value: Option<String>,
    pub contract_size: Option<String>,
    pub volume_min: String,
    pub volume_max: String,
    pub volume_step: String,
    pub stops_level: Option<i32>,
    pub freeze_level: Option<i32>,
    pub filling_modes: Vec<String>,
    pub trade_mode: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HistoryFamily {
    OrdersHistory,
    Deals,
}

impl HistoryFamily {
    fn as_str(self) -> &'static str {
        match self {
            Self::OrdersHistory => "orders_history",
            Self::Deals => "deals",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistorySubmission {
    pub protocol_version: u16,
    pub worker_id: String,
    pub session_generation: u64,
    pub account_id: String,
    pub lease_generation: u64,
    pub sync_sequence: i64,
    pub observed_at_ms: i64,
    pub from_ms: i64,
    pub to_ms: i64,
    pub covered_through_ms: Option<i64>,
    pub family: HistoryFamily,
    pub result: SnapshotResult,
    #[serde(default)]
    pub error_code: Option<String>,
    #[serde(default)]
    pub cursor: Option<String>,
    pub payload: HistoryPayload,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    content = "data",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum HistoryPayload {
    OrdersHistory {
        orders: Vec<HistoryOrderObservation>,
    },
    Deals {
        deals: Vec<DealObservation>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryOrderObservation {
    pub broker_ticket: String,
    pub position_ticket: Option<String>,
    pub symbol: String,
    pub order_type: String,
    pub state: String,
    pub volume_initial: String,
    pub volume_current: String,
    pub price_open: String,
    pub price_current: Option<String>,
    pub stop_loss: Option<String>,
    pub take_profit: Option<String>,
    pub placed_at_ms: Option<i64>,
    pub done_at_ms: Option<i64>,
    pub magic: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DealObservation {
    pub broker_ticket: String,
    pub order_ticket: Option<String>,
    pub position_ticket: Option<String>,
    pub symbol: Option<String>,
    pub deal_type: String,
    pub entry: String,
    pub volume: String,
    pub price: String,
    pub commission: Option<String>,
    pub swap: Option<String>,
    pub profit: Option<String>,
    pub fee: Option<String>,
    pub occurred_at_ms: i64,
    pub magic: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountQuery {
    owner_id: String,
    account_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoryQuery {
    owner_id: String,
    account_id: String,
    from_ms: i64,
    to_ms: i64,
    #[serde(default = "default_history_limit")]
    limit: i64,
    #[serde(default)]
    cursor: Option<String>,
}

fn default_history_limit() -> i64 {
    100
}

pub(super) fn routes() -> Router<GatewayState> {
    Router::new()
        .route("/v1/mt5-vm/workers/snapshots", post(ingest_snapshot_route))
        .route("/v1/mt5-vm/workers/history", post(ingest_history_route))
        .route(
            "/v1/admin/mt5-vm/accounts/read-state",
            get(read_state_route),
        )
        .route("/v1/admin/mt5-vm/accounts/history", get(read_history_route))
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
#[cfg(test)]
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
    left.trim().eq_ignore_ascii_case(right.trim())
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

/// Return the conservative shared portfolio anchor once both portfolio
/// families have an authoritative observation from the current fenced runtime.
///
/// Added as an explicit RED stub before the Phase 4a increment-2 tests. The
/// implementation must use the older family timestamp; one family alone can
/// never make the portfolio fresh.
#[cfg(test)]
pub fn portfolio_freshness_anchor(
    positions_complete_at_ms: Option<i64>,
    pending_orders_complete_at_ms: Option<i64>,
) -> Option<i64> {
    match (positions_complete_at_ms, pending_orders_complete_at_ms) {
        (Some(positions), Some(pending)) => Some(positions.min(pending)),
        _ => None,
    }
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

fn database(state: &GatewayState) -> Result<&PgPool, ApiError> {
    state.inner.database.as_ref().ok_or_else(|| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "MT5_VM_SYNC_DATABASE_REQUIRED",
            "MT5 VM read synchronization persistence is unavailable",
        )
    })
}

fn invalid_snapshot(message: &'static str) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, "MT5_VM_SNAPSHOT_INVALID", message)
}

fn rejection_error(rejection: SyncRejection) -> ApiError {
    ApiError::new(
        StatusCode::CONFLICT,
        rejection.code(),
        "MT5 VM snapshot was fenced",
    )
}

fn valid_error_code(value: Option<&str>) -> bool {
    value.is_none_or(|value| {
        !value.is_empty()
            && value.len() <= MAX_ERROR_CODE
            && value.as_bytes()[0].is_ascii_uppercase()
            && value
                .bytes()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
    })
}

fn parse_required_decimal(value: &str) -> Result<Decimal, ApiError> {
    parse_decimal(value).map_err(rejection_error)
}

fn parse_optional_decimal(value: Option<&str>) -> Result<Option<Decimal>, ApiError> {
    value.map(parse_required_decimal).transpose()
}

fn validate_snapshot_shape(request: &SnapshotSubmission) -> Result<(), ApiError> {
    if request.protocol_version == 0
        || request.session_generation == 0
        || request.lease_generation == 0
        || request.sync_sequence <= 0
        || request.observed_at_ms <= 0
        || request.worker_id.trim().is_empty()
        || request.worker_id.len() > 64
        || request.account_id.trim().is_empty()
        || request.account_id.len() > 96
        || !valid_error_code(request.error_code.as_deref())
    {
        return Err(invalid_snapshot("snapshot envelope is invalid"));
    }
    if request.observed_at_ms > (now_ms() as i64).saturating_add(MAX_FUTURE_SKEW_MS) {
        return Err(invalid_snapshot(
            "snapshot observation time is in the future",
        ));
    }
    let count = match &request.payload {
        SnapshotPayload::Account { account } => usize::from(account.is_some()),
        SnapshotPayload::Positions { positions } => positions.len(),
        SnapshotPayload::PendingOrders { pending_orders } => pending_orders.len(),
        SnapshotPayload::Instruments { instruments } => instruments.len(),
    };
    if count > MAX_SNAPSHOT_ROWS {
        return Err(invalid_snapshot("snapshot row limit exceeded"));
    }
    let payload_family = match request.payload {
        SnapshotPayload::Account { .. } => SnapshotFamily::Account,
        SnapshotPayload::Positions { .. } => SnapshotFamily::Positions,
        SnapshotPayload::PendingOrders { .. } => SnapshotFamily::PendingOrders,
        SnapshotPayload::Instruments { .. } => SnapshotFamily::Instruments,
    };
    if payload_family != request.family {
        return Err(invalid_snapshot("snapshot family does not match payload"));
    }
    if request.result == SnapshotResult::Complete && request.error_code.is_some() {
        return Err(invalid_snapshot("complete snapshot cannot carry an error"));
    }
    Ok(())
}

fn validate_history_shape(request: &HistorySubmission) -> Result<(), ApiError> {
    if request.protocol_version == 0
        || request.session_generation == 0
        || request.lease_generation == 0
        || request.sync_sequence <= 0
        || request.observed_at_ms <= 0
        || request.worker_id.trim().is_empty()
        || request.worker_id.len() > 64
        || request.account_id.trim().is_empty()
        || request.account_id.len() > 96
        || request.from_ms <= 0
        || request.to_ms <= request.from_ms
        || request.to_ms - request.from_ms > MAX_HISTORY_WINDOW_MS
        || request
            .cursor
            .as_ref()
            .is_some_and(|value| value.len() > 256)
        || !valid_error_code(request.error_code.as_deref())
    {
        return Err(invalid_snapshot("history envelope is invalid"));
    }
    let newest_allowed = (now_ms() as i64).saturating_add(MAX_FUTURE_SKEW_MS);
    if request.observed_at_ms > newest_allowed || request.to_ms > newest_allowed {
        return Err(invalid_snapshot("history time is in the future"));
    }
    let (payload_family, count) = match &request.payload {
        HistoryPayload::OrdersHistory { orders } => (HistoryFamily::OrdersHistory, orders.len()),
        HistoryPayload::Deals { deals } => (HistoryFamily::Deals, deals.len()),
    };
    if payload_family != request.family || count > MAX_SNAPSHOT_ROWS {
        return Err(invalid_snapshot("history payload is invalid"));
    }
    if request.result.is_authoritative() {
        if request.error_code.is_some()
            || !request
                .covered_through_ms
                .is_some_and(|value| value >= request.from_ms && value <= request.to_ms)
        {
            return Err(invalid_snapshot("complete history coverage is invalid"));
        }
    } else if request.covered_through_ms.is_some() {
        return Err(invalid_snapshot(
            "non-authoritative history cannot advance coverage",
        ));
    }
    Ok(())
}

async fn ingest_history_route(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<HistorySubmission>,
) -> Result<Json<Value>, ApiError> {
    validate_history_shape(&request)?;
    ingest_history(&state, &headers, request).await?;
    Ok(Json(json!({"accepted": true, "serverTimeMs": now_ms()})))
}

async fn ingest_history(
    state: &GatewayState,
    headers: &HeaderMap,
    request: HistorySubmission,
) -> Result<(), ApiError> {
    let database = database(state)?;
    let mut transaction = database
        .begin()
        .await
        .map_err(|error| ApiError::database("begin MT5 VM history", error))?;
    super::mt5_vm_control::validate_session_envelope(
        &request.worker_id,
        request.session_generation,
        request.protocol_version,
    )?;
    super::mt5_vm_control::authenticate_worker(
        &mut transaction,
        headers,
        &request.worker_id,
        request.session_generation,
        request.protocol_version,
    )
    .await?;
    let lease = sqlx_core::query::query(
        r#"SELECT user_id, worker_id, worker_session_generation, generation,
                  expires_at > now() AS lease_valid
           FROM execution_mt5_vm_account_leases
           WHERE account_id = $1 AND status = 'active' FOR UPDATE"#,
    )
    .bind(&request.account_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("load MT5 VM history lease", error))?
    .ok_or_else(|| rejection_error(SyncRejection::StaleLease))?;
    let user_id: Uuid = lease
        .try_get("user_id")
        .map_err(|error| ApiError::database("decode history owner", error))?;
    let lease_worker: String = lease
        .try_get("worker_id")
        .map_err(|error| ApiError::database("decode history worker", error))?;
    let lease_session: i64 = lease
        .try_get("worker_session_generation")
        .map_err(|error| ApiError::database("decode history session", error))?;
    let lease_generation: i64 = lease
        .try_get("generation")
        .map_err(|error| ApiError::database("decode history lease", error))?;
    let lease_valid: bool = lease
        .try_get("lease_valid")
        .map_err(|error| ApiError::database("decode history expiry", error))?;
    if !lease_valid
        || lease_worker != request.worker_id
        || lease_session != request.session_generation as i64
        || lease_generation != request.lease_generation as i64
    {
        return Err(rejection_error(SyncRejection::StaleLease));
    }
    let previous = sqlx_core::query::query(
        "SELECT sync_sequence FROM execution_mt5_vm_history_coverage WHERE account_id=$1 AND family=$2 FOR UPDATE",
    )
    .bind(&request.account_id)
    .bind(request.family.as_str())
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("lock MT5 history coverage", error))?;
    if previous
        .as_ref()
        .map(|row| row.try_get::<i64, _>("sync_sequence"))
        .transpose()
        .map_err(|error| ApiError::database("decode MT5 history sequence", error))?
        .is_some_and(|stored| request.sync_sequence <= stored)
    {
        return Err(rejection_error(SyncRejection::ReplayedSequence));
    }
    upsert_history_rows(&mut transaction, user_id, &request).await?;
    record_history_coverage(&mut transaction, user_id, &request).await?;
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit MT5 VM history", error))?;
    Ok(())
}

async fn upsert_history_rows(
    transaction: &mut sqlx_core::transaction::Transaction<'_, Postgres>,
    user_id: Uuid,
    request: &HistorySubmission,
) -> Result<(), ApiError> {
    match &request.payload {
        HistoryPayload::OrdersHistory { orders } => {
            for order in orders {
                let volume_initial = parse_required_decimal(&order.volume_initial)?;
                let volume_current = parse_required_decimal(&order.volume_current)?;
                let price_open = parse_required_decimal(&order.price_open)?;
                let price_current = parse_optional_decimal(order.price_current.as_deref())?;
                let stop_loss = parse_optional_decimal(order.stop_loss.as_deref())?;
                let take_profit = parse_optional_decimal(order.take_profit.as_deref())?;
                sqlx_core::query::query(
                    r#"INSERT INTO execution_mt5_vm_history_orders (
                         user_id, account_id, broker_ticket, position_ticket, symbol, order_type,
                         state, volume_initial, volume_current, price_open, price_current,
                         stop_loss, take_profit, placed_at, done_at, magic, worker_id,
                         lease_generation, worker_session_generation, sync_sequence, observed_at
                       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                         CASE WHEN $14 IS NULL THEN NULL ELSE to_timestamp($14::double precision/1000.0) END,
                         CASE WHEN $15 IS NULL THEN NULL ELSE to_timestamp($15::double precision/1000.0) END,
                         $16,$17,$18,$19,$20,to_timestamp($21::double precision/1000.0))
                       ON CONFLICT (account_id, broker_ticket) DO UPDATE SET
                         user_id=EXCLUDED.user_id, position_ticket=EXCLUDED.position_ticket,
                         symbol=EXCLUDED.symbol, order_type=EXCLUDED.order_type, state=EXCLUDED.state,
                         volume_initial=EXCLUDED.volume_initial, volume_current=EXCLUDED.volume_current,
                         price_open=EXCLUDED.price_open, price_current=EXCLUDED.price_current,
                         stop_loss=EXCLUDED.stop_loss, take_profit=EXCLUDED.take_profit,
                         placed_at=EXCLUDED.placed_at, done_at=EXCLUDED.done_at, magic=EXCLUDED.magic,
                         worker_id=EXCLUDED.worker_id, lease_generation=EXCLUDED.lease_generation,
                         worker_session_generation=EXCLUDED.worker_session_generation,
                         sync_sequence=EXCLUDED.sync_sequence, observed_at=EXCLUDED.observed_at,
                         recorded_at=now()"#,
                )
                .bind(user_id).bind(&request.account_id).bind(&order.broker_ticket)
                .bind(order.position_ticket.as_deref()).bind(order.symbol.trim())
                .bind(&order.order_type).bind(&order.state).bind(volume_initial)
                .bind(volume_current).bind(price_open).bind(price_current).bind(stop_loss)
                .bind(take_profit).bind(order.placed_at_ms).bind(order.done_at_ms)
                .bind(order.magic).bind(&request.worker_id).bind(request.lease_generation as i64)
                .bind(request.session_generation as i64).bind(request.sync_sequence)
                .bind(request.observed_at_ms).execute(&mut **transaction).await
                .map_err(|error| ApiError::database("upsert MT5 history order", error))?;
            }
        }
        HistoryPayload::Deals { deals } => {
            for deal in deals {
                if deal.occurred_at_ms <= 0 {
                    return Err(invalid_snapshot("deal event time is invalid"));
                }
                let volume = parse_required_decimal(&deal.volume)?;
                let price = parse_required_decimal(&deal.price)?;
                let commission = parse_optional_decimal(deal.commission.as_deref())?;
                let swap = parse_optional_decimal(deal.swap.as_deref())?;
                let profit = parse_optional_decimal(deal.profit.as_deref())?;
                let fee = parse_optional_decimal(deal.fee.as_deref())?;
                sqlx_core::query::query(
                    r#"INSERT INTO execution_mt5_vm_deals (
                         user_id, account_id, broker_ticket, order_ticket, position_ticket, symbol,
                         deal_type, entry, volume, price, commission, swap, profit, fee, occurred_at,
                         magic, worker_id, lease_generation, worker_session_generation,
                         sync_sequence, observed_at
                       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                         to_timestamp($15::double precision/1000.0),$16,$17,$18,$19,$20,
                         to_timestamp($21::double precision/1000.0))
                       ON CONFLICT (account_id, broker_ticket) DO UPDATE SET
                         user_id=EXCLUDED.user_id, order_ticket=EXCLUDED.order_ticket,
                         position_ticket=EXCLUDED.position_ticket, symbol=EXCLUDED.symbol,
                         deal_type=EXCLUDED.deal_type, entry=EXCLUDED.entry, volume=EXCLUDED.volume,
                         price=EXCLUDED.price, commission=EXCLUDED.commission, swap=EXCLUDED.swap,
                         profit=EXCLUDED.profit, fee=EXCLUDED.fee, occurred_at=EXCLUDED.occurred_at,
                         magic=EXCLUDED.magic, worker_id=EXCLUDED.worker_id,
                         lease_generation=EXCLUDED.lease_generation,
                         worker_session_generation=EXCLUDED.worker_session_generation,
                         sync_sequence=EXCLUDED.sync_sequence, observed_at=EXCLUDED.observed_at,
                         recorded_at=now()"#,
                )
                .bind(user_id).bind(&request.account_id).bind(&deal.broker_ticket)
                .bind(deal.order_ticket.as_deref()).bind(deal.position_ticket.as_deref())
                .bind(deal.symbol.as_deref().map(str::trim)).bind(&deal.deal_type).bind(&deal.entry).bind(volume)
                .bind(price).bind(commission).bind(swap).bind(profit).bind(fee)
                .bind(deal.occurred_at_ms).bind(deal.magic).bind(&request.worker_id)
                .bind(request.lease_generation as i64).bind(request.session_generation as i64)
                .bind(request.sync_sequence).bind(request.observed_at_ms)
                .execute(&mut **transaction).await
                .map_err(|error| ApiError::database("upsert MT5 deal", error))?;
            }
        }
    }
    Ok(())
}

async fn record_history_coverage(
    transaction: &mut sqlx_core::transaction::Transaction<'_, Postgres>,
    user_id: Uuid,
    request: &HistorySubmission,
) -> Result<(), ApiError> {
    sqlx_core::query::query(
        r#"INSERT INTO execution_mt5_vm_history_coverage (
             user_id, account_id, family, requested_from, requested_to, covered_through,
             last_result, last_error_code, cursor, worker_id, lease_generation,
             worker_session_generation, sync_sequence, observed_at
           ) VALUES ($1,$2,$3,to_timestamp($4::double precision/1000.0),
             to_timestamp($5::double precision/1000.0),
             CASE WHEN $6 IS NULL THEN NULL ELSE to_timestamp($6::double precision/1000.0) END,
             $7,$8,$9,$10,$11,$12,$13,to_timestamp($14::double precision/1000.0))
           ON CONFLICT (account_id, family) DO UPDATE SET
             user_id=EXCLUDED.user_id,
             requested_from=LEAST(execution_mt5_vm_history_coverage.requested_from, EXCLUDED.requested_from),
             requested_to=GREATEST(execution_mt5_vm_history_coverage.requested_to, EXCLUDED.requested_to),
             covered_through=CASE
               WHEN EXCLUDED.last_result <> 'complete' THEN execution_mt5_vm_history_coverage.covered_through
               WHEN execution_mt5_vm_history_coverage.covered_through IS NULL THEN EXCLUDED.covered_through
               WHEN EXCLUDED.requested_from <= execution_mt5_vm_history_coverage.covered_through
                 THEN GREATEST(execution_mt5_vm_history_coverage.covered_through, EXCLUDED.covered_through)
               ELSE execution_mt5_vm_history_coverage.covered_through END,
             last_result=EXCLUDED.last_result, last_error_code=EXCLUDED.last_error_code,
             cursor=EXCLUDED.cursor, worker_id=EXCLUDED.worker_id,
             lease_generation=EXCLUDED.lease_generation,
             worker_session_generation=EXCLUDED.worker_session_generation,
             sync_sequence=EXCLUDED.sync_sequence, observed_at=EXCLUDED.observed_at,
             recorded_at=now()"#,
    )
    .bind(user_id).bind(&request.account_id).bind(request.family.as_str())
    .bind(request.from_ms).bind(request.to_ms).bind(request.covered_through_ms)
    .bind(request.result.as_str()).bind(request.error_code.as_deref())
    .bind(request.cursor.as_deref()).bind(&request.worker_id)
    .bind(request.lease_generation as i64).bind(request.session_generation as i64)
    .bind(request.sync_sequence).bind(request.observed_at_ms)
    .execute(&mut **transaction).await
    .map_err(|error| ApiError::database("record MT5 history coverage", error))?;
    Ok(())
}

async fn ingest_snapshot_route(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<SnapshotSubmission>,
) -> Result<Json<Value>, ApiError> {
    validate_snapshot_shape(&request)?;
    let accepted = ingest_snapshot(&state, &headers, request).await?;
    Ok(Json(json!({
        "accepted": accepted,
        "serverTimeMs": now_ms()
    })))
}

async fn ingest_snapshot(
    state: &GatewayState,
    headers: &HeaderMap,
    request: SnapshotSubmission,
) -> Result<bool, ApiError> {
    let database = database(state)?;
    let mut transaction = database
        .begin()
        .await
        .map_err(|error| ApiError::database("begin MT5 VM snapshot", error))?;
    super::mt5_vm_control::validate_session_envelope(
        &request.worker_id,
        request.session_generation,
        request.protocol_version,
    )?;
    super::mt5_vm_control::authenticate_worker(
        &mut transaction,
        headers,
        &request.worker_id,
        request.session_generation,
        request.protocol_version,
    )
    .await?;

    let lease = sqlx_core::query::query(
        r#"
        SELECT lease.user_id, lease.worker_id, lease.worker_session_generation,
               lease.generation, lease.expires_at > now() AS lease_valid,
               vm.normalized_server, vm.masked_login_suffix
        FROM execution_mt5_vm_account_leases lease
        JOIN execution_mt5_vm_accounts vm
          ON vm.user_id = lease.user_id AND vm.account_id = lease.account_id
        WHERE lease.account_id = $1 AND lease.status = 'active'
        FOR UPDATE OF lease, vm
        "#,
    )
    .bind(&request.account_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("load MT5 VM snapshot lease", error))?
    .ok_or_else(|| rejection_error(SyncRejection::StaleLease))?;
    let user_id: Uuid = lease
        .try_get("user_id")
        .map_err(|error| ApiError::database("decode snapshot owner", error))?;
    let lease_worker: String = lease
        .try_get("worker_id")
        .map_err(|error| ApiError::database("decode snapshot worker", error))?;
    let lease_session: i64 = lease
        .try_get("worker_session_generation")
        .map_err(|error| ApiError::database("decode snapshot session", error))?;
    let lease_generation: i64 = lease
        .try_get("generation")
        .map_err(|error| ApiError::database("decode snapshot generation", error))?;
    let lease_valid: bool = lease
        .try_get("lease_valid")
        .map_err(|error| ApiError::database("decode snapshot expiry", error))?;
    if !lease_valid
        || lease_worker != request.worker_id
        || lease_session != request.session_generation as i64
        || lease_generation != request.lease_generation as i64
    {
        return Err(rejection_error(SyncRejection::StaleLease));
    }

    sqlx_core::query::query(
        r#"
        INSERT INTO execution_mt5_vm_sync_state (
          user_id, account_id, family
        ) VALUES ($1, $2, $3)
        ON CONFLICT (account_id, family) DO NOTHING
        "#,
    )
    .bind(user_id)
    .bind(&request.account_id)
    .bind(request.family.as_str())
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("seed MT5 VM sync state", error))?;
    let state_row = sqlx_core::query::query(
        "SELECT sync_sequence FROM execution_mt5_vm_sync_state WHERE account_id = $1 AND family = $2 FOR UPDATE",
    )
    .bind(&request.account_id)
    .bind(request.family.as_str())
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("lock MT5 VM sync state", error))?;
    let stored_sequence: i64 = state_row
        .try_get("sync_sequence")
        .map_err(|error| ApiError::database("decode MT5 VM sync sequence", error))?;
    let envelope = SyncEnvelope {
        account_id: request.account_id.clone(),
        worker_id: request.worker_id.clone(),
        lease_generation: request.lease_generation as i64,
        worker_session_generation: request.session_generation as i64,
        sync_sequence: request.sync_sequence,
        observed_at_ms: request.observed_at_ms,
    };
    fence_snapshot(
        &envelope,
        &FenceState {
            current_lease_generation: lease_generation,
            current_worker_session_generation: lease_session,
            stored_sync_sequence: stored_sequence,
        },
    )
    .map_err(rejection_error)?;

    if let SnapshotPayload::Account {
        account: Some(account),
    } = &request.payload
    {
        let registered_server: String = lease
            .try_get("normalized_server")
            .map_err(|error| ApiError::database("decode registered MT5 server", error))?;
        let registered_suffix: Option<String> = lease
            .try_get("masked_login_suffix")
            .map_err(|error| ApiError::database("decode registered MT5 suffix", error))?;
        if !identity_matches(
            &registered_server,
            registered_suffix.as_deref(),
            &account.observed_server,
            account.observed_login_suffix.as_deref(),
        ) {
            record_sync_result(
                &mut transaction,
                &request,
                user_id,
                Some("SYNC_IDENTITY_MISMATCH"),
            )
            .await?;
            transaction
                .commit()
                .await
                .map_err(|error| ApiError::database("commit identity mismatch", error))?;
            return Err(rejection_error(SyncRejection::IdentityMismatch));
        }
    }

    upsert_snapshot_rows(&mut transaction, &request, user_id).await?;
    if request.result.is_authoritative() {
        delete_absent_rows(&mut transaction, &request).await?;
    }
    record_sync_result(
        &mut transaction,
        &request,
        user_id,
        request.error_code.as_deref(),
    )
    .await?;
    update_freshness_anchor(&mut transaction, &request).await?;
    update_readiness(&mut transaction, &request).await?;
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit MT5 VM snapshot", error))?;
    Ok(true)
}

async fn record_sync_result(
    transaction: &mut sqlx_core::transaction::Transaction<'_, Postgres>,
    request: &SnapshotSubmission,
    user_id: Uuid,
    error_code: Option<&str>,
) -> Result<(), ApiError> {
    sqlx_core::query::query(
        r#"
        UPDATE execution_mt5_vm_sync_state
        SET user_id = $3, sync_sequence = $4, last_result = $5,
            last_error_code = $6, observed_at = to_timestamp($7::double precision / 1000.0),
            last_complete_sync_at = CASE WHEN $5 = 'complete'
              THEN to_timestamp($7::double precision / 1000.0)
              ELSE last_complete_sync_at END,
            worker_id = $8, lease_generation = $9, worker_session_generation = $10,
            recorded_at = now()
        WHERE account_id = $1 AND family = $2
        "#,
    )
    .bind(&request.account_id)
    .bind(request.family.as_str())
    .bind(user_id)
    .bind(request.sync_sequence)
    .bind(request.result.as_str())
    .bind(error_code)
    .bind(request.observed_at_ms)
    .bind(&request.worker_id)
    .bind(request.lease_generation as i64)
    .bind(request.session_generation as i64)
    .execute(&mut **transaction)
    .await
    .map_err(|error| ApiError::database("record MT5 VM sync result", error))?;
    Ok(())
}

async fn upsert_snapshot_rows(
    transaction: &mut sqlx_core::transaction::Transaction<'_, Postgres>,
    request: &SnapshotSubmission,
    user_id: Uuid,
) -> Result<(), ApiError> {
    match &request.payload {
        SnapshotPayload::Account {
            account: Some(account),
        } => {
            let balance = parse_required_decimal(&account.balance)?;
            let equity = parse_required_decimal(&account.equity)?;
            let margin = parse_required_decimal(&account.margin)?;
            let free_margin = parse_required_decimal(&account.free_margin)?;
            let margin_level = parse_optional_decimal(account.margin_level.as_deref())?;
            sqlx_core::query::query(
                r#"
                INSERT INTO execution_mt5_vm_account_state (
                  user_id, account_id, currency, leverage, balance, equity, margin, free_margin,
                  margin_level, margin_mode, account_mode, trade_allowed, observed_server,
                  observed_login_suffix, worker_id, lease_generation, worker_session_generation,
                  sync_sequence, observed_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                          to_timestamp($19::double precision / 1000.0))
                ON CONFLICT (account_id) DO UPDATE SET
                  user_id=EXCLUDED.user_id, currency=EXCLUDED.currency, leverage=EXCLUDED.leverage,
                  balance=EXCLUDED.balance, equity=EXCLUDED.equity, margin=EXCLUDED.margin,
                  free_margin=EXCLUDED.free_margin, margin_level=EXCLUDED.margin_level,
                  margin_mode=EXCLUDED.margin_mode, account_mode=EXCLUDED.account_mode,
                  trade_allowed=EXCLUDED.trade_allowed, observed_server=EXCLUDED.observed_server,
                  observed_login_suffix=EXCLUDED.observed_login_suffix, worker_id=EXCLUDED.worker_id,
                  lease_generation=EXCLUDED.lease_generation,
                  worker_session_generation=EXCLUDED.worker_session_generation,
                  sync_sequence=EXCLUDED.sync_sequence, observed_at=EXCLUDED.observed_at,
                  recorded_at=now()
                "#,
            )
            .bind(user_id)
            .bind(&request.account_id)
            .bind(account.currency.trim().to_ascii_uppercase())
            .bind(account.leverage)
            .bind(balance)
            .bind(equity)
            .bind(margin)
            .bind(free_margin)
            .bind(margin_level)
            .bind(&account.margin_mode)
            .bind(&account.account_mode)
            .bind(account.trade_allowed)
            .bind(account.observed_server.trim())
            .bind(account.observed_login_suffix.as_deref())
            .bind(&request.worker_id)
            .bind(request.lease_generation as i64)
            .bind(request.session_generation as i64)
            .bind(request.sync_sequence)
            .bind(request.observed_at_ms)
            .execute(&mut **transaction)
            .await
            .map_err(|error| ApiError::database("upsert MT5 account snapshot", error))?;
        }
        SnapshotPayload::Account { account: None } => {}
        SnapshotPayload::Positions { positions } => {
            for position in positions {
                let volume = parse_required_decimal(&position.volume)?;
                let open_price = parse_required_decimal(&position.open_price)?;
                let current_price = parse_optional_decimal(position.current_price.as_deref())?;
                let stop_loss = parse_optional_decimal(position.stop_loss.as_deref())?;
                let take_profit = parse_optional_decimal(position.take_profit.as_deref())?;
                let swap = parse_optional_decimal(position.swap.as_deref())?;
                let profit = parse_optional_decimal(position.profit.as_deref())?;
                sqlx_core::query::query(
                    r#"
                    INSERT INTO execution_mt5_vm_positions (
                      user_id, account_id, broker_ticket, symbol, side, volume, open_price,
                      current_price, stop_loss, take_profit, swap, profit, magic, opened_at,
                      worker_id, lease_generation, worker_session_generation, sync_sequence, observed_at
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                              CASE WHEN $14 IS NULL THEN NULL ELSE to_timestamp($14::double precision / 1000.0) END,
                              $15,$16,$17,$18,to_timestamp($19::double precision / 1000.0))
                    ON CONFLICT (account_id, broker_ticket) DO UPDATE SET
                      user_id=EXCLUDED.user_id, symbol=EXCLUDED.symbol, side=EXCLUDED.side,
                      volume=EXCLUDED.volume, open_price=EXCLUDED.open_price,
                      current_price=EXCLUDED.current_price, stop_loss=EXCLUDED.stop_loss,
                      take_profit=EXCLUDED.take_profit, swap=EXCLUDED.swap, profit=EXCLUDED.profit,
                      magic=EXCLUDED.magic, opened_at=EXCLUDED.opened_at, worker_id=EXCLUDED.worker_id,
                      lease_generation=EXCLUDED.lease_generation,
                      worker_session_generation=EXCLUDED.worker_session_generation,
                      sync_sequence=EXCLUDED.sync_sequence, observed_at=EXCLUDED.observed_at,
                      recorded_at=now()
                    "#,
                )
                .bind(user_id).bind(&request.account_id).bind(&position.broker_ticket)
                .bind(position.symbol.trim()).bind(&position.side).bind(volume).bind(open_price)
                .bind(current_price).bind(stop_loss).bind(take_profit).bind(swap).bind(profit)
                .bind(position.magic).bind(position.opened_at_ms).bind(&request.worker_id)
                .bind(request.lease_generation as i64).bind(request.session_generation as i64)
                .bind(request.sync_sequence).bind(request.observed_at_ms)
                .execute(&mut **transaction).await
                .map_err(|error| ApiError::database("upsert MT5 position snapshot", error))?;
            }
        }
        SnapshotPayload::PendingOrders { pending_orders } => {
            for order in pending_orders {
                let volume_current = parse_required_decimal(&order.volume_current)?;
                let volume_initial = parse_optional_decimal(order.volume_initial.as_deref())?;
                let price_open = parse_required_decimal(&order.price_open)?;
                let price_stop_limit = parse_optional_decimal(order.price_stop_limit.as_deref())?;
                let stop_loss = parse_optional_decimal(order.stop_loss.as_deref())?;
                let take_profit = parse_optional_decimal(order.take_profit.as_deref())?;
                sqlx_core::query::query(
                    r#"
                    INSERT INTO execution_mt5_vm_pending_orders (
                      user_id, account_id, broker_ticket, symbol, order_type, volume_current,
                      volume_initial, price_open, price_stop_limit, stop_loss, take_profit,
                      time_in_force, magic, placed_at, expires_at, worker_id, lease_generation,
                      worker_session_generation, sync_sequence, observed_at
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                              CASE WHEN $14 IS NULL THEN NULL ELSE to_timestamp($14::double precision / 1000.0) END,
                              CASE WHEN $15 IS NULL THEN NULL ELSE to_timestamp($15::double precision / 1000.0) END,
                              $16,$17,$18,$19,to_timestamp($20::double precision / 1000.0))
                    ON CONFLICT (account_id, broker_ticket) DO UPDATE SET
                      user_id=EXCLUDED.user_id, symbol=EXCLUDED.symbol, order_type=EXCLUDED.order_type,
                      volume_current=EXCLUDED.volume_current, volume_initial=EXCLUDED.volume_initial,
                      price_open=EXCLUDED.price_open, price_stop_limit=EXCLUDED.price_stop_limit,
                      stop_loss=EXCLUDED.stop_loss, take_profit=EXCLUDED.take_profit,
                      time_in_force=EXCLUDED.time_in_force, magic=EXCLUDED.magic,
                      placed_at=EXCLUDED.placed_at, expires_at=EXCLUDED.expires_at,
                      worker_id=EXCLUDED.worker_id, lease_generation=EXCLUDED.lease_generation,
                      worker_session_generation=EXCLUDED.worker_session_generation,
                      sync_sequence=EXCLUDED.sync_sequence, observed_at=EXCLUDED.observed_at,
                      recorded_at=now()
                    "#,
                )
                .bind(user_id).bind(&request.account_id).bind(&order.broker_ticket)
                .bind(order.symbol.trim()).bind(&order.order_type).bind(volume_current)
                .bind(volume_initial).bind(price_open).bind(price_stop_limit).bind(stop_loss)
                .bind(take_profit).bind(order.time_in_force.as_deref()).bind(order.magic)
                .bind(order.placed_at_ms).bind(order.expires_at_ms).bind(&request.worker_id)
                .bind(request.lease_generation as i64).bind(request.session_generation as i64)
                .bind(request.sync_sequence).bind(request.observed_at_ms)
                .execute(&mut **transaction).await
                .map_err(|error| ApiError::database("upsert MT5 pending order snapshot", error))?;
            }
        }
        SnapshotPayload::Instruments { instruments } => {
            for instrument in instruments {
                let point = parse_required_decimal(&instrument.point)?;
                let tick_size = parse_optional_decimal(instrument.tick_size.as_deref())?;
                let tick_value = parse_optional_decimal(instrument.tick_value.as_deref())?;
                let contract_size = parse_optional_decimal(instrument.contract_size.as_deref())?;
                let volume_min = parse_required_decimal(&instrument.volume_min)?;
                let volume_max = parse_required_decimal(&instrument.volume_max)?;
                let volume_step = parse_required_decimal(&instrument.volume_step)?;
                sqlx_core::query::query(
                    r#"
                    INSERT INTO execution_mt5_vm_instruments (
                      user_id, account_id, symbol, digits, point, tick_size, tick_value,
                      contract_size, volume_min, volume_max, volume_step, stops_level,
                      freeze_level, filling_modes, trade_mode, worker_id, lease_generation,
                      worker_session_generation, sync_sequence, observed_at
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                              to_timestamp($20::double precision / 1000.0))
                    ON CONFLICT (account_id, symbol) DO UPDATE SET
                      user_id=EXCLUDED.user_id, digits=EXCLUDED.digits, point=EXCLUDED.point,
                      tick_size=EXCLUDED.tick_size, tick_value=EXCLUDED.tick_value,
                      contract_size=EXCLUDED.contract_size, volume_min=EXCLUDED.volume_min,
                      volume_max=EXCLUDED.volume_max, volume_step=EXCLUDED.volume_step,
                      stops_level=EXCLUDED.stops_level, freeze_level=EXCLUDED.freeze_level,
                      filling_modes=EXCLUDED.filling_modes, trade_mode=EXCLUDED.trade_mode,
                      worker_id=EXCLUDED.worker_id, lease_generation=EXCLUDED.lease_generation,
                      worker_session_generation=EXCLUDED.worker_session_generation,
                      sync_sequence=EXCLUDED.sync_sequence, observed_at=EXCLUDED.observed_at,
                      recorded_at=now()
                    "#,
                )
                .bind(user_id)
                .bind(&request.account_id)
                .bind(instrument.symbol.trim())
                .bind(instrument.digits)
                .bind(point)
                .bind(tick_size)
                .bind(tick_value)
                .bind(contract_size)
                .bind(volume_min)
                .bind(volume_max)
                .bind(volume_step)
                .bind(instrument.stops_level)
                .bind(instrument.freeze_level)
                .bind(&instrument.filling_modes)
                .bind(&instrument.trade_mode)
                .bind(&request.worker_id)
                .bind(request.lease_generation as i64)
                .bind(request.session_generation as i64)
                .bind(request.sync_sequence)
                .bind(request.observed_at_ms)
                .execute(&mut **transaction)
                .await
                .map_err(|error| ApiError::database("upsert MT5 instrument snapshot", error))?;
            }
        }
    }
    Ok(())
}

async fn delete_absent_rows(
    transaction: &mut sqlx_core::transaction::Transaction<'_, Postgres>,
    request: &SnapshotSubmission,
) -> Result<(), ApiError> {
    let table = match request.family {
        SnapshotFamily::Account => return Ok(()),
        SnapshotFamily::Positions => "execution_mt5_vm_positions",
        SnapshotFamily::PendingOrders => "execution_mt5_vm_pending_orders",
        SnapshotFamily::Instruments => "execution_mt5_vm_instruments",
    };
    let sql = format!("DELETE FROM {table} WHERE account_id = $1 AND sync_sequence <> $2");
    sqlx_core::query::query(&sql)
        .bind(&request.account_id)
        .bind(request.sync_sequence)
        .execute(&mut **transaction)
        .await
        .map_err(|error| ApiError::database("reconcile MT5 snapshot rows", error))?;
    Ok(())
}

async fn update_freshness_anchor(
    transaction: &mut sqlx_core::transaction::Transaction<'_, Postgres>,
    request: &SnapshotSubmission,
) -> Result<(), ApiError> {
    let column = match request.family {
        SnapshotFamily::Account => "last_account_sync_at",
        SnapshotFamily::Instruments => "last_instrument_sync_at",
        SnapshotFamily::Positions | SnapshotFamily::PendingOrders => "last_portfolio_sync_at",
    };
    if matches!(
        request.family,
        SnapshotFamily::Positions | SnapshotFamily::PendingOrders
    ) {
        sqlx_core::query::query(
            r#"
            UPDATE execution_mt5_vm_accounts account
            SET last_portfolio_sync_at = (
              SELECT CASE WHEN COUNT(*) = 2 THEN MIN(last_complete_sync_at) END
              FROM execution_mt5_vm_sync_state
              WHERE account_id = $1 AND family IN ('positions','pending_orders')
                AND last_result = 'complete'
                AND worker_id = $2 AND lease_generation = $3
                AND worker_session_generation = $4
            )
            WHERE account.account_id = $1 AND account.worker_id = $2
              AND account.lease_generation = $3
            "#,
        )
        .bind(&request.account_id)
        .bind(&request.worker_id)
        .bind(request.lease_generation as i64)
        .bind(request.session_generation as i64)
        .execute(&mut **transaction)
        .await
        .map_err(|error| ApiError::database("advance MT5 portfolio freshness", error))?;
    } else if request.result.is_authoritative() {
        let sql = format!(
            "UPDATE execution_mt5_vm_accounts SET {column} = to_timestamp($1::double precision / 1000.0) WHERE account_id = $2 AND worker_id = $3 AND lease_generation = $4"
        );
        sqlx_core::query::query(&sql)
            .bind(request.observed_at_ms)
            .bind(&request.account_id)
            .bind(&request.worker_id)
            .bind(request.lease_generation as i64)
            .execute(&mut **transaction)
            .await
            .map_err(|error| ApiError::database("advance MT5 freshness", error))?;
    }
    Ok(())
}

async fn update_readiness(
    transaction: &mut sqlx_core::transaction::Transaction<'_, Postgres>,
    request: &SnapshotSubmission,
) -> Result<(), ApiError> {
    if !request.result.is_authoritative() {
        return Ok(());
    }
    sqlx_core::query::query(
        r#"
        UPDATE execution_mt5_vm_accounts account
        SET connection_status = 'ready', connection_revision = connection_revision + 1,
            last_error_code = NULL
        WHERE account.account_id = $1 AND account.worker_id = $2
          AND account.lease_generation = $3
          AND EXISTS (
            SELECT 1 FROM execution_mt5_vm_account_state state
            WHERE state.account_id = account.account_id
              AND state.lease_generation = account.lease_generation
              AND state.worker_session_generation = $4
          )
          AND 4 = (
            SELECT COUNT(*) FROM execution_mt5_vm_sync_state sync
            WHERE sync.account_id = account.account_id
              AND sync.last_result = 'complete'
              AND sync.worker_id = $2
              AND sync.lease_generation = $3
              AND sync.worker_session_generation = $4
              AND sync.family IN ('account','positions','pending_orders','instruments')
          )
        "#,
    )
    .bind(&request.account_id)
    .bind(&request.worker_id)
    .bind(request.lease_generation as i64)
    .bind(request.session_generation as i64)
    .execute(&mut **transaction)
    .await
    .map_err(|error| ApiError::database("advance MT5 account readiness", error))?;
    Ok(())
}

async fn read_state_route(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Query(query): Query<AccountQuery>,
) -> Result<Json<Value>, ApiError> {
    require_admin(&state, &headers)?;
    let owner_id = parse_owner_id(&query.owner_id)?;
    if query.account_id.trim().is_empty() || query.account_id.len() > 96 {
        return Err(invalid_snapshot("account id is invalid"));
    }
    let database = database(&state)?;
    let account = sqlx_core::query::query(
        r#"
        SELECT vm.connection_status, vm.connection_revision, vm.normalized_server,
               vm.masked_login_suffix,
               (extract(epoch FROM vm.updated_at) * 1000)::bigint AS updated_at_ms
        FROM execution_mt5_vm_accounts vm
        JOIN execution_accounts registry
          ON registry.user_id = vm.user_id AND registry.id = vm.account_id
        WHERE vm.user_id = $1 AND vm.account_id = $2
          AND registry.connector_kind = 'windows_vm'
        "#,
    )
    .bind(owner_id)
    .bind(&query.account_id)
    .fetch_optional(database)
    .await
    .map_err(|error| ApiError::database("load MT5 read state account", error))?
    .ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "MT5_VM_ACCOUNT_NOT_FOUND",
            "MT5 VM account was not found",
        )
    })?;
    let account_json = json!({
        "accountId": query.account_id,
        "connectionStatus": account.try_get::<String, _>("connection_status").map_err(|error| ApiError::database("decode MT5 state status", error))?,
        "connectionRevision": account.try_get::<i64, _>("connection_revision").map_err(|error| ApiError::database("decode MT5 state revision", error))?,
        "server": account.try_get::<String, _>("normalized_server").map_err(|error| ApiError::database("decode MT5 state server", error))?,
        "maskedLoginSuffix": account.try_get::<Option<String>, _>("masked_login_suffix").map_err(|error| ApiError::database("decode MT5 state suffix", error))?,
        "updatedAtMs": account.try_get::<i64, _>("updated_at_ms").map_err(|error| ApiError::database("decode MT5 state update", error))?,
    });

    let state_row = sqlx_core::query::query(
        r#"
        SELECT currency, leverage, balance::text AS balance, equity::text AS equity,
               margin::text AS margin, free_margin::text AS free_margin,
               margin_level::text AS margin_level, margin_mode, account_mode,
               trade_allowed, observed_server, observed_login_suffix
        FROM execution_mt5_vm_account_state
        WHERE user_id = $1 AND account_id = $2
        "#,
    )
    .bind(owner_id)
    .bind(&query.account_id)
    .fetch_optional(database)
    .await
    .map_err(|error| ApiError::database("load MT5 normalized account", error))?;
    let normalized_account = state_row
        .as_ref()
        .map(|row| {
            Ok(json!({
                "currency": row.try_get::<String, _>("currency").map_err(|error| ApiError::database("decode MT5 currency", error))?,
                "leverage": row.try_get::<Option<i32>, _>("leverage").map_err(|error| ApiError::database("decode MT5 leverage", error))?,
                "balance": row.try_get::<String, _>("balance").map_err(|error| ApiError::database("decode MT5 balance", error))?,
                "equity": row.try_get::<String, _>("equity").map_err(|error| ApiError::database("decode MT5 equity", error))?,
                "margin": row.try_get::<String, _>("margin").map_err(|error| ApiError::database("decode MT5 margin", error))?,
                "freeMargin": row.try_get::<String, _>("free_margin").map_err(|error| ApiError::database("decode MT5 free margin", error))?,
                "marginLevel": row.try_get::<Option<String>, _>("margin_level").map_err(|error| ApiError::database("decode MT5 margin level", error))?,
                "marginMode": row.try_get::<String, _>("margin_mode").map_err(|error| ApiError::database("decode MT5 margin mode", error))?,
                "accountMode": row.try_get::<String, _>("account_mode").map_err(|error| ApiError::database("decode MT5 account mode", error))?,
                "tradeAllowed": row.try_get::<bool, _>("trade_allowed").map_err(|error| ApiError::database("decode MT5 trade permission", error))?,
                "observedServer": row.try_get::<String, _>("observed_server").map_err(|error| ApiError::database("decode MT5 observed server", error))?,
                "observedLoginSuffix": row.try_get::<Option<String>, _>("observed_login_suffix").map_err(|error| ApiError::database("decode MT5 observed suffix", error))?,
            }))
        })
        .transpose()?;

    let positions = read_positions(database, owner_id, &query.account_id).await?;
    let pending_orders = read_pending_orders(database, owner_id, &query.account_id).await?;
    let instruments = read_instruments(database, owner_id, &query.account_id).await?;
    let freshness = read_freshness(database, &query.account_id).await?;
    Ok(Json(json!({
        "account": account_json,
        "normalizedAccount": normalized_account,
        "positions": positions,
        "pendingOrders": pending_orders,
        "instruments": instruments,
        "freshness": freshness,
    })))
}

async fn read_positions(
    database: &PgPool,
    owner_id: Uuid,
    account_id: &str,
) -> Result<Vec<Value>, ApiError> {
    let rows = sqlx_core::query::query(
        r#"SELECT broker_ticket, symbol, side, volume::text AS volume, open_price::text AS open_price,
                  current_price::text AS current_price, stop_loss::text AS stop_loss,
                  take_profit::text AS take_profit, swap::text AS swap, profit::text AS profit,
                  magic, (extract(epoch FROM opened_at) * 1000)::bigint AS opened_at_ms
           FROM execution_mt5_vm_positions WHERE user_id = $1 AND account_id = $2
           ORDER BY broker_ticket"#,
    ).bind(owner_id).bind(account_id).fetch_all(database).await
        .map_err(|error| ApiError::database("read MT5 positions", error))?;
    rows.into_iter().map(|row| Ok(json!({
        "brokerTicket": row.try_get::<String,_>("broker_ticket").map_err(|error| ApiError::database("decode MT5 position ticket", error))?,
        "symbol": row.try_get::<String,_>("symbol").map_err(|error| ApiError::database("decode MT5 position symbol", error))?,
        "side": row.try_get::<String,_>("side").map_err(|error| ApiError::database("decode MT5 position side", error))?,
        "volume": row.try_get::<String,_>("volume").map_err(|error| ApiError::database("decode MT5 position volume", error))?,
        "openPrice": row.try_get::<String,_>("open_price").map_err(|error| ApiError::database("decode MT5 open price", error))?,
        "currentPrice": row.try_get::<Option<String>,_>("current_price").map_err(|error| ApiError::database("decode MT5 current price", error))?,
        "stopLoss": row.try_get::<Option<String>,_>("stop_loss").map_err(|error| ApiError::database("decode MT5 stop loss", error))?,
        "takeProfit": row.try_get::<Option<String>,_>("take_profit").map_err(|error| ApiError::database("decode MT5 take profit", error))?,
        "swap": row.try_get::<Option<String>,_>("swap").map_err(|error| ApiError::database("decode MT5 swap", error))?,
        "profit": row.try_get::<Option<String>,_>("profit").map_err(|error| ApiError::database("decode MT5 profit", error))?,
        "magic": row.try_get::<Option<i64>,_>("magic").map_err(|error| ApiError::database("decode MT5 magic", error))?,
        "openedAtMs": row.try_get::<Option<i64>,_>("opened_at_ms").map_err(|error| ApiError::database("decode MT5 opened time", error))?,
    }))).collect()
}

async fn read_pending_orders(
    database: &PgPool,
    owner_id: Uuid,
    account_id: &str,
) -> Result<Vec<Value>, ApiError> {
    let rows = sqlx_core::query::query(
        r#"SELECT broker_ticket, symbol, order_type, volume_current::text AS volume_current,
                  volume_initial::text AS volume_initial, price_open::text AS price_open,
                  price_stop_limit::text AS price_stop_limit, stop_loss::text AS stop_loss,
                  take_profit::text AS take_profit, time_in_force, magic,
                  (extract(epoch FROM placed_at) * 1000)::bigint AS placed_at_ms,
                  (extract(epoch FROM expires_at) * 1000)::bigint AS expires_at_ms
           FROM execution_mt5_vm_pending_orders WHERE user_id = $1 AND account_id = $2
           ORDER BY broker_ticket"#,
    )
    .bind(owner_id)
    .bind(account_id)
    .fetch_all(database)
    .await
    .map_err(|error| ApiError::database("read MT5 pending orders", error))?;
    rows.into_iter().map(|row| Ok(json!({
        "brokerTicket": row.try_get::<String,_>("broker_ticket").map_err(|error| ApiError::database("decode MT5 order ticket", error))?,
        "symbol": row.try_get::<String,_>("symbol").map_err(|error| ApiError::database("decode MT5 order symbol", error))?,
        "orderType": row.try_get::<String,_>("order_type").map_err(|error| ApiError::database("decode MT5 order type", error))?,
        "volumeCurrent": row.try_get::<String,_>("volume_current").map_err(|error| ApiError::database("decode MT5 current volume", error))?,
        "volumeInitial": row.try_get::<Option<String>,_>("volume_initial").map_err(|error| ApiError::database("decode MT5 initial volume", error))?,
        "priceOpen": row.try_get::<String,_>("price_open").map_err(|error| ApiError::database("decode MT5 order price", error))?,
        "priceStopLimit": row.try_get::<Option<String>,_>("price_stop_limit").map_err(|error| ApiError::database("decode MT5 stop limit", error))?,
        "stopLoss": row.try_get::<Option<String>,_>("stop_loss").map_err(|error| ApiError::database("decode MT5 order stop loss", error))?,
        "takeProfit": row.try_get::<Option<String>,_>("take_profit").map_err(|error| ApiError::database("decode MT5 order take profit", error))?,
        "timeInForce": row.try_get::<Option<String>,_>("time_in_force").map_err(|error| ApiError::database("decode MT5 time in force", error))?,
        "magic": row.try_get::<Option<i64>,_>("magic").map_err(|error| ApiError::database("decode MT5 order magic", error))?,
        "placedAtMs": row.try_get::<Option<i64>,_>("placed_at_ms").map_err(|error| ApiError::database("decode MT5 placed time", error))?,
        "expiresAtMs": row.try_get::<Option<i64>,_>("expires_at_ms").map_err(|error| ApiError::database("decode MT5 expiry", error))?,
    }))).collect()
}

async fn read_instruments(
    database: &PgPool,
    owner_id: Uuid,
    account_id: &str,
) -> Result<Vec<Value>, ApiError> {
    let rows = sqlx_core::query::query(
        r#"SELECT symbol, digits, point::text AS point, tick_size::text AS tick_size,
                  tick_value::text AS tick_value, contract_size::text AS contract_size,
                  volume_min::text AS volume_min, volume_max::text AS volume_max,
                  volume_step::text AS volume_step, stops_level, freeze_level, filling_modes,
                  trade_mode FROM execution_mt5_vm_instruments
           WHERE user_id = $1 AND account_id = $2 ORDER BY symbol"#,
    )
    .bind(owner_id)
    .bind(account_id)
    .fetch_all(database)
    .await
    .map_err(|error| ApiError::database("read MT5 instruments", error))?;
    rows.into_iter().map(|row| Ok(json!({
        "symbol": row.try_get::<String,_>("symbol").map_err(|error| ApiError::database("decode MT5 instrument symbol", error))?,
        "digits": row.try_get::<i32,_>("digits").map_err(|error| ApiError::database("decode MT5 digits", error))?,
        "point": row.try_get::<String,_>("point").map_err(|error| ApiError::database("decode MT5 point", error))?,
        "tickSize": row.try_get::<Option<String>,_>("tick_size").map_err(|error| ApiError::database("decode MT5 tick size", error))?,
        "tickValue": row.try_get::<Option<String>,_>("tick_value").map_err(|error| ApiError::database("decode MT5 tick value", error))?,
        "contractSize": row.try_get::<Option<String>,_>("contract_size").map_err(|error| ApiError::database("decode MT5 contract size", error))?,
        "volumeMin": row.try_get::<String,_>("volume_min").map_err(|error| ApiError::database("decode MT5 min volume", error))?,
        "volumeMax": row.try_get::<String,_>("volume_max").map_err(|error| ApiError::database("decode MT5 max volume", error))?,
        "volumeStep": row.try_get::<String,_>("volume_step").map_err(|error| ApiError::database("decode MT5 volume step", error))?,
        "stopsLevel": row.try_get::<Option<i32>,_>("stops_level").map_err(|error| ApiError::database("decode MT5 stops level", error))?,
        "freezeLevel": row.try_get::<Option<i32>,_>("freeze_level").map_err(|error| ApiError::database("decode MT5 freeze level", error))?,
        "fillingModes": row.try_get::<Vec<String>,_>("filling_modes").map_err(|error| ApiError::database("decode MT5 filling modes", error))?,
        "tradeMode": row.try_get::<String,_>("trade_mode").map_err(|error| ApiError::database("decode MT5 trade mode", error))?,
    }))).collect()
}

async fn read_freshness(database: &PgPool, account_id: &str) -> Result<Value, ApiError> {
    let rows = sqlx_core::query::query(
        r#"SELECT family, last_result,
                  (extract(epoch FROM observed_at) * 1000)::bigint AS observed_at_ms,
                  (extract(epoch FROM last_complete_sync_at) * 1000)::bigint AS complete_at_ms,
                  last_error_code FROM execution_mt5_vm_sync_state
           WHERE account_id = $1 ORDER BY family"#,
    )
    .bind(account_id)
    .fetch_all(database)
    .await
    .map_err(|error| ApiError::database("read MT5 freshness", error))?;
    let now = now_ms() as i64;
    let mut output = serde_json::Map::new();
    for row in rows {
        let family: String = row
            .try_get("family")
            .map_err(|error| ApiError::database("decode MT5 freshness family", error))?;
        let result: String = row
            .try_get("last_result")
            .map_err(|error| ApiError::database("decode MT5 freshness result", error))?;
        let observed_at_ms: Option<i64> = row
            .try_get("complete_at_ms")
            .map_err(|error| ApiError::database("decode MT5 freshness time", error))?;
        let verdict = freshness_verdict(
            observed_at_ms,
            match result.as_str() {
                "complete" => Some(SnapshotResult::Complete),
                "partial" => Some(SnapshotResult::Partial),
                "failed" => Some(SnapshotResult::Failed),
                _ => None,
            },
            now,
            READ_FRESHNESS_BOUND_MS,
        );
        output.insert(family, json!({
            "result": result,
            "verdict": verdict,
            "observedAtMs": row.try_get::<Option<i64>,_>("observed_at_ms").map_err(|error| ApiError::database("decode MT5 observation time", error))?,
            "completeAtMs": observed_at_ms,
            "errorCode": row.try_get::<Option<String>,_>("last_error_code").map_err(|error| ApiError::database("decode MT5 freshness error", error))?,
        }));
    }
    Ok(Value::Object(output))
}

fn history_cursor_signature(
    account_id: &str,
    from_ms: i64,
    to_ms: i64,
    family: &str,
    event_ms: i64,
    ticket: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(account_id.as_bytes());
    hasher.update(b"|");
    hasher.update(from_ms.to_string().as_bytes());
    hasher.update(b"|");
    hasher.update(to_ms.to_string().as_bytes());
    hasher.update(b"|");
    hasher.update(family.as_bytes());
    hasher.update(b"|");
    hasher.update(event_ms.to_string().as_bytes());
    hasher.update(b"|");
    hasher.update(ticket.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn decode_history_cursor(
    cursor: Option<&str>,
    account_id: &str,
    from_ms: i64,
    to_ms: i64,
) -> Result<Option<(String, i64, String)>, ApiError> {
    let Some(cursor) = cursor else {
        return Ok(None);
    };
    if cursor.len() > 256 {
        return Err(invalid_snapshot("history cursor is too long"));
    }
    let mut parts = cursor.splitn(4, ':');
    let family = parts.next().unwrap_or_default();
    let event_ms = parts.next().unwrap_or_default();
    let ticket = parts.next().unwrap_or_default();
    let signature = parts.next().unwrap_or_default();
    if !matches!(family, "orders_history" | "deals")
        || ticket.is_empty()
        || signature.len() != 64
        || !signature.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(invalid_snapshot("history cursor is invalid"));
    }
    let event_ms = event_ms
        .parse::<i64>()
        .map_err(|_| invalid_snapshot("history cursor is invalid"))?;
    if history_cursor_signature(account_id, from_ms, to_ms, family, event_ms, ticket) != signature {
        return Err(invalid_snapshot("history cursor is invalid"));
    }
    Ok(Some((family.to_owned(), event_ms, ticket.to_owned())))
}

async fn read_history_route(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<Value>, ApiError> {
    require_admin(&state, &headers)?;
    let owner_id = parse_owner_id(&query.owner_id)?;
    if query.account_id.trim().is_empty()
        || query.account_id.len() > 96
        || query.from_ms <= 0
        || query.to_ms <= query.from_ms
        || query.to_ms - query.from_ms > MAX_HISTORY_WINDOW_MS
        || query.to_ms > (now_ms() as i64).saturating_add(MAX_FUTURE_SKEW_MS)
        || !(1..=MAX_HISTORY_LIMIT).contains(&query.limit)
    {
        return Err(invalid_snapshot("history window is invalid"));
    }
    let cursor = decode_history_cursor(
        query.cursor.as_deref(),
        &query.account_id,
        query.from_ms,
        query.to_ms,
    )?;
    let database = database(&state)?;
    // The account owner is injected by Go and rechecked here; no account_id-only
    // lookup is allowed to cross tenants.
    let exists = sqlx_core::query::query(
        "SELECT 1 FROM execution_mt5_vm_accounts WHERE user_id = $1 AND account_id = $2",
    )
    .bind(owner_id)
    .bind(&query.account_id)
    .fetch_optional(database)
    .await
    .map_err(|error| ApiError::database("check MT5 history owner", error))?;
    if exists.is_none() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "MT5_VM_ACCOUNT_NOT_FOUND",
            "MT5 VM account was not found",
        ));
    }

    let (orders, deals, next_cursor) = read_history_page(
        database,
        owner_id,
        &query.account_id,
        query.from_ms,
        query.to_ms,
        query.limit,
        cursor.as_ref(),
    )
    .await?;
    let coverage = sqlx_core::query::query(
        r#"SELECT family, last_result, last_error_code,
                  (extract(epoch FROM requested_from) * 1000)::bigint AS requested_from_ms,
                  (extract(epoch FROM requested_to) * 1000)::bigint AS requested_to_ms,
                  (extract(epoch FROM covered_through) * 1000)::bigint AS covered_through_ms
           FROM execution_mt5_vm_history_coverage
           WHERE user_id = $1 AND account_id = $2 ORDER BY family"#,
    )
    .bind(owner_id)
    .bind(&query.account_id)
    .fetch_all(database)
    .await
    .map_err(|error| ApiError::database("read MT5 history coverage", error))?;
    let coverage = coverage
        .into_iter()
        .map(|row| {
            Ok((
                row.try_get::<String, _>("family")?,
                json!({
                    "result": row.try_get::<String, _>("last_result")?,
                    "errorCode": row.try_get::<Option<String>, _>("last_error_code")?,
                    "requestedFromMs": row.try_get::<i64, _>("requested_from_ms")?,
                    "requestedToMs": row.try_get::<i64, _>("requested_to_ms")?,
                    "coveredThroughMs": row.try_get::<Option<i64>, _>("covered_through_ms")?,
                }),
            ))
        })
        .collect::<Result<Vec<(String, Value)>, sqlx_core::error::Error>>()
        .map_err(|error| ApiError::database("decode MT5 history coverage", error))?;
    let coverage = coverage
        .into_iter()
        .fold(serde_json::Map::new(), |mut map, (family, value)| {
            map.insert(family, value);
            map
        });
    Ok(Json(json!({
        "accountId": query.account_id,
        "ordersHistory": orders,
        "deals": deals,
        "coverage": coverage,
        "nextCursor": next_cursor,
    })))
}

async fn read_history_page(
    database: &PgPool,
    owner_id: Uuid,
    account_id: &str,
    from_ms: i64,
    to_ms: i64,
    limit: i64,
    cursor: Option<&(String, i64, String)>,
) -> Result<(Vec<Value>, Vec<Value>, Option<String>), ApiError> {
    let (cursor_family, cursor_ms, cursor_ticket) = cursor
        .map(|(family, event_ms, ticket)| {
            (
                Some(family.as_str()),
                Some(*event_ms),
                Some(ticket.as_str()),
            )
        })
        .unwrap_or((None, None, None));
    let rows = sqlx_core::query::query(
        r#"WITH history AS (
             SELECT 'orders_history'::text AS family,
                    (extract(epoch FROM COALESCE(done_at, placed_at)) * 1000)::bigint AS event_ms,
                    broker_ticket,
                    jsonb_build_object(
                      'brokerTicket', broker_ticket, 'positionTicket', position_ticket,
                      'symbol', symbol, 'orderType', order_type, 'state', state,
                      'volumeInitial', volume_initial::text, 'volumeCurrent', volume_current::text,
                      'priceOpen', price_open::text, 'priceCurrent', price_current::text,
                      'stopLoss', stop_loss::text, 'takeProfit', take_profit::text, 'magic', magic,
                      'placedAtMs', (extract(epoch FROM placed_at) * 1000)::bigint,
                      'doneAtMs', (extract(epoch FROM done_at) * 1000)::bigint
                    ) AS payload
             FROM execution_mt5_vm_history_orders
             WHERE user_id = $1 AND account_id = $2
               AND COALESCE(done_at, placed_at) >= to_timestamp($3::double precision / 1000.0)
               AND COALESCE(done_at, placed_at) < to_timestamp($4::double precision / 1000.0)
             UNION ALL
             SELECT 'deals'::text AS family,
                    (extract(epoch FROM occurred_at) * 1000)::bigint AS event_ms,
                    broker_ticket,
                    jsonb_build_object(
                      'brokerTicket', broker_ticket, 'orderTicket', order_ticket,
                      'positionTicket', position_ticket, 'symbol', symbol, 'dealType', deal_type,
                      'entry', entry, 'volume', volume::text, 'price', price::text,
                      'commission', commission::text, 'swap', swap::text, 'profit', profit::text,
                      'fee', fee::text, 'magic', magic,
                      'occurredAtMs', (extract(epoch FROM occurred_at) * 1000)::bigint
                    ) AS payload
             FROM execution_mt5_vm_deals
             WHERE user_id = $1 AND account_id = $2
               AND occurred_at >= to_timestamp($3::double precision / 1000.0)
               AND occurred_at < to_timestamp($4::double precision / 1000.0)
           )
           SELECT family, event_ms, broker_ticket, payload
           FROM history
           WHERE $5::bigint IS NULL OR (event_ms, family, broker_ticket) > ($5, $6, $7)
           ORDER BY event_ms, family, broker_ticket
           LIMIT $8"#,
    )
    .bind(owner_id)
    .bind(account_id)
    .bind(from_ms)
    .bind(to_ms)
    .bind(cursor_ms)
    .bind(cursor_family)
    .bind(cursor_ticket)
    .bind(limit + 1)
    .fetch_all(database)
    .await
    .map_err(|error| ApiError::database("read MT5 history page", error))?;
    let has_more = rows.len() as i64 > limit;
    let mut orders = Vec::new();
    let mut deals = Vec::new();
    let mut next = None;
    for (index, row) in rows.into_iter().enumerate() {
        if index as i64 >= limit {
            break;
        }
        let family: String = row
            .try_get("family")
            .map_err(|error| ApiError::database("decode MT5 history family", error))?;
        let event_ms: i64 = row
            .try_get("event_ms")
            .map_err(|error| ApiError::database("decode MT5 history time", error))?;
        let ticket: String = row
            .try_get("broker_ticket")
            .map_err(|error| ApiError::database("decode MT5 history ticket", error))?;
        let payload: Value = row
            .try_get("payload")
            .map_err(|error| ApiError::database("decode MT5 history payload", error))?;
        if family == "orders_history" {
            orders.push(payload);
        } else {
            deals.push(payload);
        }
        if has_more && index as i64 == limit - 1 {
            next = Some(format!(
                "{}:{}:{}:{}",
                family,
                event_ms,
                ticket,
                history_cursor_signature(account_id, from_ms, to_ms, &family, event_ms, &ticket)
            ));
        }
    }
    Ok((orders, deals, next))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn envelope(lease: i64, session: i64, sequence: i64) -> SyncEnvelope {
        SyncEnvelope {
            account_id: "acct-1".into(),
            worker_id: "worker-01".into(),
            lease_generation: lease,
            worker_session_generation: session,
            sync_sequence: sequence,
            observed_at_ms: 1_760_000_000_000,
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

    #[test]
    fn portfolio_requires_both_families_and_uses_the_older_anchor() {
        assert_eq!(portfolio_freshness_anchor(Some(20_000), None), None);
        assert_eq!(portfolio_freshness_anchor(None, Some(21_000)), None);
        assert_eq!(
            portfolio_freshness_anchor(Some(20_000), Some(21_000)),
            Some(20_000)
        );
        assert_eq!(
            portfolio_freshness_anchor(Some(22_000), Some(21_000)),
            Some(21_000)
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

    #[test]
    fn history_cursor_is_account_bound_and_tamper_evident() {
        let from_ms = 1_759_000_000_000;
        let to_ms = 1_761_000_000_000;
        let signature = history_cursor_signature(
            "acct-a",
            from_ms,
            to_ms,
            "deals",
            1_760_000_000_000,
            "ticket-1",
        );
        let cursor = format!("deals:1760000000000:ticket-1:{signature}");
        assert_eq!(
            decode_history_cursor(Some(&cursor), "acct-a", from_ms, to_ms).expect("valid cursor"),
            Some(("deals".to_owned(), 1_760_000_000_000, "ticket-1".to_owned()))
        );
        assert!(decode_history_cursor(Some(&cursor), "acct-b", from_ms, to_ms).is_err());
        assert!(decode_history_cursor(Some(&cursor), "acct-a", from_ms + 1, to_ms).is_err());
        let tampered = cursor.replace("ticket-1", "ticket-2");
        assert!(decode_history_cursor(Some(&tampered), "acct-a", from_ms, to_ms).is_err());
        assert!(decode_history_cursor(Some(&"x".repeat(257)), "acct-a", from_ms, to_ms).is_err());
    }

    #[test]
    fn history_empty_complete_is_authoritative_but_partial_cannot_claim_coverage() {
        let complete: HistorySubmission = serde_json::from_value(json!({
            "protocolVersion": 1,
            "workerId": "worker-1",
            "sessionGeneration": 2,
            "accountId": "acct-a",
            "leaseGeneration": 3,
            "syncSequence": 4,
            "observedAtMs": 1_760_000_000_000i64,
            "fromMs": 1_759_000_000_000i64,
            "toMs": 1_760_000_000_000i64,
            "coveredThroughMs": 1_760_000_000_000i64,
            "family": "deals",
            "result": "complete",
            "payload": {"kind": "deals", "data": {"deals": []}}
        }))
        .expect("strict complete empty history");
        assert!(validate_history_shape(&complete).is_ok());

        let mut partial_value = serde_json::to_value(json!({
            "protocolVersion": 1,
            "workerId": "worker-1",
            "sessionGeneration": 2,
            "accountId": "acct-a",
            "leaseGeneration": 3,
            "syncSequence": 5,
            "observedAtMs": 1_760_000_000_000i64,
            "fromMs": 1_759_000_000_000i64,
            "toMs": 1_760_000_000_000i64,
            "coveredThroughMs": 1_760_000_000_000i64,
            "family": "deals",
            "result": "partial",
            "errorCode": "MT5_HISTORY_PARTIAL",
            "payload": {"kind": "deals", "data": {"deals": []}}
        }))
        .expect("json value");
        let partial: HistorySubmission =
            serde_json::from_value(partial_value.take()).expect("strict partial history");
        assert!(validate_history_shape(&partial).is_err());
    }
}
