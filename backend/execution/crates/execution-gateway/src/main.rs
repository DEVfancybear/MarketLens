use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::env;
use std::fs;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use axum::extract::{DefaultBodyLimit, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use execution_adapters::{AdapterError, EaCommandQueue};
use execution_domain::{
    AccountId, AccountMode, AccountStatus, CancelOrderCommand, ClosePositionCommand,
    ContinuousCopyConfig, ContinuousCopyTargetConfig, CopyAllocation, CopyGroupDefinition,
    CopyGroupId, CopyGroupRuntimeStatus, CopyGroupWriteRequest, CopyProtectionConfig, CopyTarget,
    CopyTargetDefinition, CopyTargetRuntimeStatus, CopyTargetWriteRequest,
    EXECUTION_PROTOCOL_VERSION, EaAccountSnapshot, EaCommand, EaEvent, EaEventBatch,
    EaInstrumentSnapshot, EaManagedRuntimeBinding, EaPendingOrderSnapshot, EaPositionSnapshot,
    EaSessionRequest, EaSessionResponse, ExecutionAccount, IdempotencyKey, InstrumentSpec,
    ModifyPendingOrderCommand, ModifyPositionCommand, OrderIntent, OrderKind, OrderSizing,
    PropRiskActions, PropRiskEvaluation, PropRiskEvaluationInput, PropRiskHistoryQuality,
    PropRiskMaxLossMode, PropRiskReason, PropRiskRules, PropRiskStatus, QuantityUnit, RiskPolicy,
    RouteRejectCode, RouteTargetContext, RouteWarning, RoutedOrder, SessionId, Side,
    TargetRouteResult, VenueKind, evaluate_prop_risk, prop_risk_money,
    should_repair_legacy_prop_risk_daily_lock,
};
use execution_engine::route_order;
use hmac::{Hmac, Mac};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx_core::row::Row;
use sqlx_postgres::{PgPool, PgPoolOptions};
use tokio::sync::{Mutex, Notify};
use tracing::{error, info, warn};
use uuid::Uuid;

mod sqlx {
    pub use sqlx_core::Error;
    pub use sqlx_core::query::query;
    pub use sqlx_core::query_scalar::query_scalar;

    pub mod types {
        pub use sqlx_core::types::Json;
    }
}

mod copier;
mod mt5_vm_connections;
mod mt5_vm_control;
mod mt5_vm_sync;

use copier::{PortfolioChange, diff_portfolio};

const DEFAULT_BIND: &str = "127.0.0.1:8790";
const DEFAULT_ADMIN_BIND: &str = "127.0.0.1:8791";
const SESSION_TTL: Duration = Duration::from_secs(15 * 60);
const SESSION_ABSOLUTE_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const MAX_COMMANDS_PER_ACCOUNT: usize = 128;
const MAX_COMMANDS_PER_POLL: usize = 16;
const MAX_EA_EVENTS_PER_BATCH: usize = 128;
const MAX_LEGACY_EA_CLOCK_SKEW_MS: u64 = 24 * 60 * 60 * 1_000;
const COMMAND_LEASE: Duration = Duration::from_secs(15);
const COMMAND_DELIVERY_TTL: Duration = Duration::from_secs(2 * 60);
const DEFERRED_ORDER_TTL: Duration = Duration::from_secs(5 * 60);
const DEFERRED_EXPIRY_SWEEP_INTERVAL: Duration = Duration::from_secs(5);
const MAX_DEFERRED_ACTIVATIONS_PER_EVENT: usize = 16;
const EA_POLL_FRESHNESS: Duration = Duration::from_secs(15);
const MIN_SUPPORTED_EA_VERSION: (u32, u32, u32) = (1, 26, 0);
const DEFAULT_PAIRING_TTL: Duration = Duration::from_secs(5 * 60);
const MAX_PAIRING_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_ACTIVE_PAIRING_TOKENS_PER_OWNER: usize = 5;
const MAX_QUOTE_AGE: Duration = Duration::from_secs(15);

#[derive(Clone)]
struct GatewayState {
    inner: Arc<GatewayInner>,
}

struct GatewayInner {
    admin_token_hash: [u8; 32],
    mt5_identity_key: [u8; 32],
    mt5_vm_bootstrap_token_hash: Option<[u8; 32]>,
    database: Option<PgPool>,
    pairing_tokens: Mutex<HashMap<[u8; 32], PairingGrant>>,
    sessions: Mutex<HashMap<[u8; 32], EaSession>>,
    accounts: Mutex<HashMap<AccountId, EaAccountView>>,
    account_layouts: Mutex<HashMap<String, AccountLayoutView>>,
    commands: Mutex<HashMap<AccountId, VecDeque<QueuedCommand>>>,
}

#[derive(Clone, Debug)]
struct EaSession {
    session_id: SessionId,
    account_id: AccountId,
    owner_id: String,
    expires_at_ms: u64,
    managed_identity: Option<ManagedEaSessionIdentity>,
}

#[derive(Clone, Debug)]
struct ManagedEaSessionIdentity {
    identity_fingerprint: Vec<u8>,
    runtime_binding: EaManagedRuntimeBinding,
}

#[derive(Clone)]
struct PairingGrant {
    owner_id: String,
    expires_at_ms: u64,
    managed_binding: Option<ManagedEaPairingBinding>,
}

#[derive(Clone, Debug)]
struct ManagedEaPairingBinding {
    account_id: AccountId,
    worker_id: String,
    worker_session_generation: u64,
    lease_generation: u64,
    connection_revision: u64,
    slot_id: String,
    terminal_pid: u32,
    gateway_origin: String,
    #[cfg(test)]
    masked_login_suffix: Option<String>,
    identity_fingerprint: Vec<u8>,
}

#[derive(Clone)]
struct QueuedCommand {
    command: EaCommand,
    queued_at_ms: u64,
    leased_until_ms: u64,
    delivery_count: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EaAccountView {
    account_id: AccountId,
    owner_id: String,
    connected: bool,
    last_seen_at_ms: u64,
    minimum_ea_version: String,
    account: EaAccountSnapshot,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthView {
    ok: bool,
    service: &'static str,
    protocol_version: u16,
    connected_accounts: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AcceptedView {
    ok: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountLayoutView {
    item_ids: Vec<String>,
    revision: u64,
    updated_at_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountLayoutRequest {
    owner_id: String,
    item_ids: Vec<String>,
    expected_revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PairingTokenRequest {
    owner_id: String,
    #[serde(default)]
    expires_in_seconds: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairingTokenResponse {
    token: String,
    expires_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
enum PropRiskCapitalMode {
    ReferenceBalances,
    Manual,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PropRiskProfileTemplate {
    id: String,
    version: u32,
    provider_code: String,
    program_code: String,
    display_name: String,
    timezone: String,
    rules_locked: bool,
    capital_mode: PropRiskCapitalMode,
    reference_balances: Vec<u64>,
    rules: PropRiskRules,
    actions: PropRiskActions,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    official_source_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    verified_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PropRiskAssignmentView {
    account_id: AccountId,
    enabled: bool,
    profile_id: String,
    profile_version: u32,
    provider_code: String,
    program_code: String,
    display_name: String,
    timezone: String,
    #[serde(with = "rust_decimal::serde::str")]
    initial_balance: Decimal,
    rules: PropRiskRules,
    actions: PropRiskActions,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    trading_day: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    evaluation: Option<PropRiskEvaluation>,
    updated_at_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PropRiskGuardView {
    profiles: Vec<PropRiskProfileTemplate>,
    assignment: Option<PropRiskAssignmentView>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PropRiskQuery {
    owner_id: String,
    account_id: AccountId,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PropRiskUpdateRequest {
    owner_id: String,
    account_id: AccountId,
    enabled: bool,
    profile_id: String,
    #[serde(with = "rust_decimal::serde::str")]
    initial_balance: Decimal,
    timezone: String,
    rules: PropRiskRules,
    actions: PropRiskActions,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    provider_code: Option<String>,
    #[serde(default)]
    program_code: Option<String>,
}

#[derive(Clone, Debug)]
struct PropRiskRuntimeConfig {
    initial_balance: Decimal,
    rules: PropRiskRules,
    actions: PropRiskActions,
    trading_day: String,
    day_start_balance: Decimal,
    max_loss_reference_balance: Decimal,
    current_day_min_equity: Option<Decimal>,
    historical_max_loss_result: Decimal,
    prior_positive_days_profit: Decimal,
    prior_best_day_profit: Decimal,
    previously_locked_reason: Option<PropRiskReason>,
    state_exists: bool,
}

async fn prop_risk_profiles(database: &PgPool) -> Result<Vec<PropRiskProfileTemplate>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT
            profile_id, profile_version, provider_code, program_code,
            display_name, timezone, rules_locked, capital_mode,
            reference_balances, rules, actions, official_source_url,
            verified_at::text AS verified_at, sort_order
        FROM (
            SELECT DISTINCT ON (profile_id) *
            FROM execution_prop_risk_profiles
            WHERE active = true
            ORDER BY profile_id, profile_version DESC
        ) active_profiles
        ORDER BY sort_order, provider_code, program_code, display_name
        "#,
    )
    .fetch_all(database)
    .await
    .map_err(|error| ApiError::database("load prop risk profile catalog", error))?;
    let profiles = rows
        .into_iter()
        .map(decode_prop_risk_profile)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(profiles)
}

async fn prop_risk_profile(
    database: &PgPool,
    profile_id: &str,
    profile_version: Option<u32>,
) -> Result<Option<PropRiskProfileTemplate>, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT
            profile_id, profile_version, provider_code, program_code,
            display_name, timezone, rules_locked, capital_mode,
            reference_balances, rules, actions, official_source_url,
            verified_at::text AS verified_at, sort_order
        FROM execution_prop_risk_profiles
        WHERE profile_id = $1
          AND ($2::integer IS NULL OR profile_version = $2)
          AND ($2::integer IS NOT NULL OR active = true)
        ORDER BY profile_version DESC
        LIMIT 1
        "#,
    )
    .bind(profile_id)
    .bind(profile_version.map(|version| version as i32))
    .fetch_optional(database)
    .await
    .map_err(|error| ApiError::database("load prop risk profile", error))?;
    row.map(decode_prop_risk_profile).transpose()
}

fn decode_prop_risk_profile(
    row: sqlx_postgres::PgRow,
) -> Result<PropRiskProfileTemplate, ApiError> {
    let capital_mode = match row
        .try_get::<String, _>("capital_mode")
        .map_err(|error| ApiError::database("decode prop risk capital mode", error))?
        .as_str()
    {
        "reference_balances" => PropRiskCapitalMode::ReferenceBalances,
        "manual" => PropRiskCapitalMode::Manual,
        _ => {
            return Err(ApiError::internal(
                "decode prop risk capital mode",
                "catalog contains an unsupported capital mode",
            ));
        }
    };
    Ok(PropRiskProfileTemplate {
        id: row
            .try_get("profile_id")
            .map_err(|error| ApiError::database("decode prop risk profile id", error))?,
        version: row
            .try_get::<i32, _>("profile_version")
            .map_err(|error| ApiError::database("decode prop risk profile version", error))?
            .max(0) as u32,
        provider_code: row
            .try_get("provider_code")
            .map_err(|error| ApiError::database("decode prop risk provider", error))?,
        program_code: row
            .try_get("program_code")
            .map_err(|error| ApiError::database("decode prop risk program", error))?,
        display_name: row
            .try_get("display_name")
            .map_err(|error| ApiError::database("decode prop risk display name", error))?,
        timezone: row
            .try_get("timezone")
            .map_err(|error| ApiError::database("decode prop risk timezone", error))?,
        rules_locked: row
            .try_get("rules_locked")
            .map_err(|error| ApiError::database("decode prop risk edit policy", error))?,
        capital_mode,
        reference_balances: row
            .try_get::<sqlx::types::Json<Vec<u64>>, _>("reference_balances")
            .map_err(|error| ApiError::database("decode prop risk reference balances", error))?
            .0,
        rules: row
            .try_get::<sqlx::types::Json<PropRiskRules>, _>("rules")
            .map_err(|error| ApiError::database("decode prop risk catalog rules", error))?
            .0,
        actions: row
            .try_get::<sqlx::types::Json<PropRiskActions>, _>("actions")
            .map_err(|error| ApiError::database("decode prop risk catalog actions", error))?
            .0,
        official_source_url: row
            .try_get("official_source_url")
            .map_err(|error| ApiError::database("decode prop risk source", error))?,
        verified_at: row
            .try_get("verified_at")
            .map_err(|error| ApiError::database("decode prop risk verification date", error))?,
    })
}

fn resolve_profile_initial_balance(
    profile: &PropRiskProfileTemplate,
    requested_balance: Decimal,
) -> Result<Decimal, &'static str> {
    if matches!(profile.capital_mode, PropRiskCapitalMode::Manual) {
        return Ok(requested_balance);
    }
    profile
        .reference_balances
        .iter()
        .copied()
        .filter(|balance| *balance > 0)
        .min_by(|left, right| {
            let left_reference = Decimal::from(*left);
            let right_reference = Decimal::from(*right);
            let left_distance = (requested_balance - left_reference).abs() / left_reference;
            let right_distance = (requested_balance - right_reference).abs() / right_reference;
            left_distance
                .cmp(&right_distance)
                .then_with(|| right.cmp(left))
        })
        .map(Decimal::from)
        .ok_or("reference-balance profiles must declare at least one positive balance")
}

/// Captures the first observed balance for a trading day and keeps it stable.
/// Starting capital is deliberately not an input: it sizes the allowance but
/// must never replace an observed daily baseline.
fn resolve_prop_risk_day_start_balance(
    stored_day_start_balance: Option<Decimal>,
    current_balance: Decimal,
) -> Decimal {
    stored_day_start_balance.unwrap_or(current_balance)
}

fn matches_legacy_prop_risk_daily_floor(
    rules: &PropRiskRules,
    initial_balance: Decimal,
    last_equity: Decimal,
    evaluation: &PropRiskEvaluation,
) -> bool {
    let daily_loss_limit = prop_risk_money(initial_balance, rules.daily_loss_limit_basis_points);
    evaluation.daily_loss_limit == daily_loss_limit
        && evaluation.equity == last_equity
        && evaluation.daily_loss_remaining == last_equity - (initial_balance - daily_loss_limit)
}

fn matches_legacy_prop_risk_lock_event(
    rules: &PropRiskRules,
    initial_balance: Decimal,
    reason: PropRiskReason,
    locked_equity: Decimal,
) -> bool {
    let daily_loss_limit = prop_risk_money(initial_balance, rules.daily_loss_limit_basis_points);
    let legacy_daily_floor = initial_balance - daily_loss_limit;
    let emergency_buffer = prop_risk_money(initial_balance, rules.emergency_buffer_basis_points);
    match reason {
        PropRiskReason::DailyLossLimitBreached => locked_equity <= legacy_daily_floor,
        PropRiskReason::DailyLossSafetyBuffer => {
            locked_equity > legacy_daily_floor
                && locked_equity <= legacy_daily_floor + emergency_buffer
        }
        _ => false,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OwnerQuery {
    owner_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountStateQuery {
    owner_id: String,
    account_id: AccountId,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountInstrumentsQuery {
    owner_id: String,
    account_id: AccountId,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountActionRequest {
    owner_id: String,
    account_id: AccountId,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountStateView {
    account_id: AccountId,
    positions: Vec<EaPositionSnapshot>,
    pending_orders: Vec<EaPendingOrderSnapshot>,
    command_outcomes: Vec<CommandOutcomeView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandOutcomeView {
    command_id: String,
    parent_command_id: String,
    status: String,
    reject_code: Option<String>,
    message: Option<String>,
    broker_order_id: Option<String>,
    broker_deal_id: Option<String>,
    expires_at_ms: Option<u64>,
    updated_at_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EaPollResponseView {
    protocol_version: u16,
    commands: Vec<EaPollCommandView>,
    server_time_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum EaPollCommandView {
    Place {
        #[serde(flatten)]
        order: RoutedOrder,
    },
    ModifyPosition {
        #[serde(flatten)]
        command: ModifyPositionCommand,
    },
    ModifyPendingOrder {
        #[serde(flatten)]
        command: ModifyPendingOrderCommand,
    },
    ClosePosition {
        #[serde(flatten)]
        command: ClosePositionCommand,
    },
    CancelOrder {
        #[serde(flatten)]
        command: CancelOrderCommand,
    },
    Sync,
}

impl From<EaCommand> for EaPollCommandView {
    fn from(value: EaCommand) -> Self {
        match value {
            EaCommand::Place { order } => Self::Place { order },
            EaCommand::ModifyPosition { command } => Self::ModifyPosition { command },
            EaCommand::ModifyPendingOrder { command } => Self::ModifyPendingOrder { command },
            EaCommand::ClosePosition { command } => Self::ClosePosition { command },
            EaCommand::CancelOrder { command } => Self::CancelOrder { command },
            EaCommand::Sync => Self::Sync,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountInstrumentsView {
    account_id: AccountId,
    instruments: Vec<InstrumentSpec>,
    mappings: Vec<SymbolMappingView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SymbolMappingView {
    canonical_symbol: String,
    venue_symbol: String,
    mapping_source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SymbolMappingRequest {
    owner_id: String,
    account_id: AccountId,
    canonical_symbol: String,
    venue_symbol: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdminCommandRequest {
    owner_id: String,
    command: EaCommand,
    authorization_token: String,
    authorization_session_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdminOrderTarget {
    account_id: AccountId,
    allocation: CopyAllocation,
    #[serde(default, with = "execution_domain::nullable_decimal_string")]
    max_quantity: Option<Decimal>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdminOrderRequest {
    owner_id: String,
    intent: OrderIntent,
    targets: Vec<AdminOrderTarget>,
    authorization_token: String,
    authorization_session_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeferredOrderEnvelope {
    intent: OrderIntent,
    target: AdminOrderTarget,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminOrderResponse {
    command_id: execution_domain::CommandId,
    targets: Vec<AdminTargetSubmission>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CopierWorkPayload {
    change: PortfolioChange,
    #[serde(default)]
    source_account_id: Option<AccountId>,
    group_config: ContinuousCopyConfig,
    target_config: ContinuousCopyTargetConfig,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    target_leg: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    phase: Option<String>,
}

#[derive(Debug)]
struct CopierWorkError {
    code: String,
    message: String,
    retryable: bool,
}

impl CopierWorkError {
    fn retryable(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable: true,
        }
    }

    fn permanent(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable: false,
        }
    }

    fn api(error: ApiError) -> Self {
        let retryable = error.status.is_server_error()
            || error.status == StatusCode::TOO_MANY_REQUESTS
            || error.status == StatusCode::SERVICE_UNAVAILABLE;
        Self {
            code: error.body.code.into(),
            message: error.body.message,
            retryable,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CopyGroupQuery {
    owner_id: String,
    #[serde(default)]
    group_id: Option<CopyGroupId>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CopyGroupUpsertRequest {
    owner_id: String,
    #[serde(default)]
    group_id: Option<CopyGroupId>,
    group: CopyGroupWriteRequest,
    targets: Vec<CopyTargetWriteRequest>,
    #[serde(default, skip_serializing)]
    authorization_token: Option<String>,
    #[serde(default, skip_serializing)]
    authorization_session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CopyGroupActionRequest {
    owner_id: String,
    group_id: CopyGroupId,
    expected_revision: u64,
    action: CopyGroupAction,
    #[serde(default, skip_serializing)]
    authorization_token: Option<String>,
    #[serde(default, skip_serializing)]
    authorization_session_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum CopyGroupAction {
    Pause,
    Resume,
    Reconcile,
    Archive,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CopyGroupView {
    group: CopyGroupDefinition,
    targets: Vec<CopyTargetDefinition>,
    pending_work: u64,
    unresolved_errors: u64,
    active_links: u64,
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum AdminTargetSubmission {
    Queued {
        account_id: AccountId,
        command_id: execution_domain::CommandId,
        warnings: Vec<RouteWarning>,
    },
    Waiting {
        account_id: AccountId,
        command_id: execution_domain::CommandId,
        expires_at_ms: u64,
    },
    Rejected {
        account_id: AccountId,
        code: RouteRejectCode,
        message: String,
    },
    Unavailable {
        account_id: AccountId,
        code: &'static str,
        message: String,
    },
}

#[tokio::main]
#[cfg_attr(test, allow(unreachable_code, unused_variables))]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "execution_gateway=info".into()),
        )
        .init();

    let config = match Config::from_env() {
        Ok(config) => config,
        Err(message) => {
            eprintln!("execution gateway configuration error: {message}");
            std::process::exit(2);
        }
    };
    #[cfg(not(test))]
    let database = PgPoolOptions::new()
        .max_connections(config.database_max_connections)
        .acquire_timeout(Duration::from_secs(10))
        .after_connect(|connection, _metadata| {
            Box::pin(async move {
                sqlx::query("SET statement_timeout = '5s'")
                    .execute(&mut *connection)
                    .await?;
                sqlx::query("SET lock_timeout = '2s'")
                    .execute(&mut *connection)
                    .await?;
                sqlx::query("SET idle_in_transaction_session_timeout = '10s'")
                    .execute(&mut *connection)
                    .await?;
                Ok(())
            })
        })
        .connect(&config.database_url)
        .await
        .unwrap_or_else(|error| panic!("failed to connect execution database: {error}"));
    #[cfg(test)]
    let database = PgPoolOptions::new()
        .max_connections(config.database_max_connections)
        .connect_lazy(&config.database_url)
        .expect("test configuration must contain a valid PostgreSQL URL");
    let state = production_state(&config, database);
    #[cfg(test)]
    return;
    let deferred_expiry_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(DEFERRED_EXPIRY_SWEEP_INTERVAL);
        loop {
            interval.tick().await;
            if let Err(error) = deferred_expiry_state.expire_deferred_orders().await {
                error!(?error, "failed to sweep expired deferred copy orders");
            }
        }
    });
    mt5_vm_control::spawn_scheduler(state.clone());
    let ea_app = Router::new()
        .route("/health", get(health))
        .route("/v1/ea/sessions", post(create_ea_session))
        .route("/v1/ea/poll", post(poll_commands))
        .route("/v1/ea/events", post(accept_events))
        .layer(DefaultBodyLimit::max(256 * 1024))
        .with_state(state.clone());
    let admin_app = Router::new()
        .route("/health", get(health))
        .route("/v1/admin/accounts", get(list_accounts))
        .route(
            "/v1/admin/account-layout",
            get(account_layout).post(update_account_layout),
        )
        .route("/v1/admin/account-state", get(account_state))
        .route(
            "/v1/admin/prop-risk",
            get(prop_risk_guard).post(update_prop_risk_guard),
        )
        .route("/v1/admin/instruments", get(account_instruments))
        .route("/v1/admin/symbol-mappings", post(upsert_symbol_mapping))
        .route(
            "/v1/admin/copy-groups",
            get(list_copy_groups).post(upsert_copy_group),
        )
        .route("/v1/admin/copy-groups/actions", post(copy_group_action))
        .route("/v1/admin/pairing-tokens", post(issue_pairing_token))
        .route("/v1/admin/accounts/disconnect", post(disconnect_account))
        .route("/v1/admin/accounts/remove", post(remove_account))
        .route("/v1/admin/orders", post(route_admin_order))
        .route("/v1/admin/commands", post(queue_command))
        .merge(mt5_vm_control::routes())
        .merge(mt5_vm_connections::routes())
        .merge(mt5_vm_sync::routes())
        .layer(DefaultBodyLimit::max(256 * 1024))
        .with_state(state);
    let ea_listener = tokio::net::TcpListener::bind(config.bind)
        .await
        .unwrap_or_else(|error| panic!("failed to bind EA gateway: {error}"));
    let admin_listener = tokio::net::TcpListener::bind(config.admin_bind)
        .await
        .unwrap_or_else(|error| panic!("failed to bind admin gateway: {error}"));
    info!(bind = %config.bind, "Rust execution EA gateway listening");
    info!(bind = %config.admin_bind, "Rust execution admin gateway listening");

    let shutdown = Arc::new(Notify::new());
    let signal_shutdown = shutdown.clone();
    tokio::spawn(async move {
        shutdown_signal().await;
        signal_shutdown.notify_waiters();
    });
    let ea_server = axum::serve(ea_listener, ea_app)
        .with_graceful_shutdown(wait_for_shutdown(shutdown.clone()));
    let admin_server =
        axum::serve(admin_listener, admin_app).with_graceful_shutdown(wait_for_shutdown(shutdown));
    if let Err(error) = tokio::try_join!(ea_server, admin_server) {
        panic!("execution gateway failed: {error}");
    }
}

fn production_state(config: &Config, database: PgPool) -> GatewayState {
    GatewayState::new_production(
        &config.admin_token,
        &config.mt5_identity_hmac_key,
        config.mt5_vm_bootstrap_token.as_deref(),
        database,
    )
}

struct Config {
    bind: SocketAddr,
    admin_bind: SocketAddr,
    admin_token: String,
    mt5_identity_hmac_key: String,
    mt5_vm_bootstrap_token: Option<String>,
    database_url: String,
    database_max_connections: u32,
}

impl Config {
    fn from_env() -> Result<Self, String> {
        let admin_token = required_secret("EXECUTION_ADMIN_TOKEN")?;
        let mt5_identity_hmac_key = required_secret_file("EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE")?;
        let mt5_vm_bootstrap_token = optional_secret("EXECUTION_MT5_VM_BOOTSTRAP_TOKEN")?;
        if mt5_vm_bootstrap_token.as_deref() == Some(admin_token.as_str()) {
            return Err(
                "EXECUTION_MT5_VM_BOOTSTRAP_TOKEN must be distinct from EXECUTION_ADMIN_TOKEN"
                    .into(),
            );
        }
        if mt5_identity_hmac_key == admin_token
            || mt5_vm_bootstrap_token.as_deref() == Some(mt5_identity_hmac_key.as_str())
        {
            return Err(
                "EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE must contain a secret distinct from execution authentication tokens"
                    .into(),
            );
        }
        let database_url = env::var("DATABASE_URL")
            .map_err(|_| "DATABASE_URL is required; in-memory production state is forbidden")?;
        let database_max_connections = env::var("EXECUTION_DATABASE_MAX_CONNECTIONS")
            .ok()
            .map(|value| {
                value
                    .parse::<u32>()
                    .map_err(|_| "EXECUTION_DATABASE_MAX_CONNECTIONS must be an integer")
            })
            .transpose()?
            .unwrap_or(10)
            .clamp(2, 50);
        let bind = loopback_bind("EXECUTION_GATEWAY_BIND", DEFAULT_BIND)?;
        let admin_bind = loopback_bind("EXECUTION_ADMIN_BIND", DEFAULT_ADMIN_BIND)?;
        if bind == admin_bind {
            return Err("EXECUTION_GATEWAY_BIND and EXECUTION_ADMIN_BIND must differ".into());
        }
        Ok(Self {
            bind,
            admin_bind,
            admin_token,
            mt5_identity_hmac_key,
            mt5_vm_bootstrap_token,
            database_url,
            database_max_connections,
        })
    }
}

fn loopback_bind(name: &str, default_value: &str) -> Result<SocketAddr, String> {
    let raw = env::var(name).unwrap_or_else(|_| default_value.into());
    let address = raw
        .parse::<SocketAddr>()
        .map_err(|_| format!("{name} must be an IP socket address"))?;
    if !address.ip().is_loopback() {
        return Err(format!(
            "{name} must be loopback; publish the EA API through an HTTPS reverse proxy"
        ));
    }
    Ok(address)
}

fn required_secret(name: &str) -> Result<String, String> {
    let value = env::var(name)
        .map_err(|_| format!("{name} is required; the gateway refuses an insecure default"))?;
    validate_secret(name, &value)?;
    Ok(value)
}

fn required_secret_file(name: &str) -> Result<String, String> {
    let raw_path = env::var(name)
        .map_err(|_| format!("{name} is required; durable MT5 identities need a stable key"))?;
    let path = PathBuf::from(raw_path.trim());
    if !path.is_absolute() {
        return Err(format!("{name} must be an absolute path"));
    }
    let metadata = fs::symlink_metadata(&path)
        .map_err(|_| format!("{name} must name a readable regular file"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 4096 {
        return Err(format!("{name} must name a small regular file, not a link"));
    }
    let canonical =
        fs::canonicalize(&path).map_err(|_| format!("{name} path could not be canonicalized"))?;
    if !canonical_paths_match(&path, &canonical) {
        return Err(format!("{name} path must not traverse a link"));
    }
    let raw = fs::read_to_string(&path)
        .map_err(|_| format!("{name} must contain valid UTF-8 secret text"))?;
    let secret = raw.trim().to_owned();
    validate_secret(name, &secret)?;
    if secret.len() > 4096 || secret.contains(['\r', '\n', '\0']) {
        return Err(format!("{name} contains invalid characters"));
    }
    Ok(secret)
}

fn canonical_paths_match(requested: &Path, canonical: &Path) -> bool {
    #[cfg(windows)]
    {
        fn normalize(path: &Path) -> String {
            path.to_string_lossy()
                .trim_start_matches(r"\\?\")
                .replace('/', "\\")
                .to_ascii_lowercase()
        }
        normalize(requested) == normalize(canonical)
    }
    #[cfg(not(windows))]
    {
        requested == canonical
    }
}

fn optional_secret(name: &str) -> Result<Option<String>, String> {
    match env::var(name) {
        Ok(value) => {
            validate_secret(name, &value)?;
            Ok(Some(value))
        }
        Err(env::VarError::NotPresent) => Ok(None),
        Err(env::VarError::NotUnicode(_)) => Err(format!("{name} must be valid Unicode")),
    }
}

fn validate_secret(name: &str, value: &str) -> Result<(), String> {
    if value.trim().len() < 32 {
        return Err(format!("{name} must contain at least 32 characters"));
    }
    Ok(())
}

impl GatewayState {
    fn new_production(
        admin_token: &str,
        mt5_identity_hmac_key: &str,
        mt5_vm_bootstrap_token: Option<&str>,
        database: PgPool,
    ) -> Self {
        Self::new_with_mt5_vm(
            admin_token,
            mt5_identity_hmac_key,
            mt5_vm_bootstrap_token,
            Some(database),
        )
    }

    #[cfg(test)]
    fn new(admin_token: &str, database: Option<PgPool>) -> Self {
        Self::new_with_mt5_vm(
            admin_token,
            "stable-test-mt5-identity-key-at-least-32-bytes",
            None,
            database,
        )
    }

    fn new_with_mt5_vm(
        admin_token: &str,
        mt5_identity_hmac_key: &str,
        mt5_vm_bootstrap_token: Option<&str>,
        database: Option<PgPool>,
    ) -> Self {
        Self {
            inner: Arc::new(GatewayInner {
                admin_token_hash: sha256(admin_token.as_bytes()),
                mt5_identity_key: derive_mt5_identity_key(mt5_identity_hmac_key),
                mt5_vm_bootstrap_token_hash: mt5_vm_bootstrap_token
                    .map(|token| sha256(token.as_bytes())),
                database,
                pairing_tokens: Mutex::new(HashMap::new()),
                sessions: Mutex::new(HashMap::new()),
                accounts: Mutex::new(HashMap::new()),
                account_layouts: Mutex::new(HashMap::new()),
                commands: Mutex::new(HashMap::new()),
            }),
        }
    }

    fn admin_token_matches(&self, headers: &HeaderMap) -> bool {
        header_value(headers, "x-execution-admin-token").is_some_and(|token| {
            secret_matches(&sha256(token.as_bytes()), &self.inner.admin_token_hash)
        })
    }

    async fn insert_pairing_token(
        &self,
        token: &str,
        owner_id: &str,
        ttl: Duration,
    ) -> Result<u64, ApiError> {
        let expires_at_ms = now_ms() + ttl.as_millis() as u64;
        if let Some(database) = &self.inner.database {
            let owner_uuid = parse_owner_id(owner_id)?;
            let mut transaction = database
                .begin()
                .await
                .map_err(|error| ApiError::database("begin pairing token transaction", error))?;
            let owner_exists = sqlx::query_scalar::<_, Uuid>(
                "SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE",
            )
            .bind(owner_uuid)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("lock pairing token owner", error))?
            .is_some();
            if !owner_exists {
                return Err(ApiError::new(
                    StatusCode::NOT_FOUND,
                    "OWNER_NOT_FOUND",
                    "active owner was not found",
                ));
            }
            sqlx::query(
                r#"
                DELETE FROM execution_pairing_tokens
                WHERE user_id = $1
                  AND consumed_at IS NULL
                  AND expires_at <= now()
                "#,
            )
            .bind(owner_uuid)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("prune pairing tokens", error))?;
            let active = sqlx::query_scalar::<_, i64>(
                r#"
                SELECT count(*)
                FROM execution_pairing_tokens
                WHERE user_id = $1
                  AND consumed_at IS NULL
                  AND expires_at > now()
                "#,
            )
            .bind(owner_uuid)
            .fetch_one(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("count pairing tokens", error))?;
            if active >= MAX_ACTIVE_PAIRING_TOKENS_PER_OWNER as i64 {
                return Err(ApiError::new(
                    StatusCode::TOO_MANY_REQUESTS,
                    "PAIRING_TOKEN_LIMIT",
                    "too many active pairing tokens",
                ));
            }
            sqlx::query(
                r#"
                INSERT INTO execution_pairing_tokens (
                    user_id, token_hash, expires_at
                )
                VALUES ($1, $2, to_timestamp($3::double precision / 1000.0))
                "#,
            )
            .bind(owner_uuid)
            .bind(sha256(token.as_bytes()).to_vec())
            .bind(expires_at_ms as i64)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("issue pairing token", error))?;
            transaction
                .commit()
                .await
                .map_err(|error| ApiError::database("commit pairing token", error))?;
            return Ok(expires_at_ms);
        }
        let now = now_ms();
        let mut tokens = self.inner.pairing_tokens.lock().await;
        tokens.retain(|_, grant| grant.expires_at_ms > now);
        let active = tokens
            .values()
            .filter(|grant| grant.owner_id == owner_id)
            .count();
        if active >= MAX_ACTIVE_PAIRING_TOKENS_PER_OWNER {
            return Err(ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "PAIRING_TOKEN_LIMIT",
                "too many active pairing tokens",
            ));
        }
        tokens.insert(
            sha256(token.as_bytes()),
            PairingGrant {
                owner_id: owner_id.to_owned(),
                expires_at_ms,
                managed_binding: None,
            },
        );
        Ok(expires_at_ms)
    }

    #[cfg(test)]
    async fn insert_managed_pairing_token(
        &self,
        token: &str,
        owner_id: &str,
        ttl: Duration,
        binding: ManagedEaPairingBinding,
    ) -> Result<u64, ApiError> {
        validate_identifier("workerId", &binding.worker_id, 64)?;
        validate_identifier("accountId", binding.account_id.as_str(), 96)?;
        if token.len() != 64
            || !token.bytes().all(|value| value.is_ascii_hexdigit())
            || binding.worker_session_generation == 0
            || binding.lease_generation == 0
            || binding.connection_revision == 0
            || validate_identifier("slotId", &binding.slot_id, 64).is_err()
            || binding.terminal_pid == 0
            || !mt5_vm_control::valid_ea_gateway_origin(&binding.gateway_origin)
            || binding.identity_fingerprint.len() != 32
            || binding.masked_login_suffix.as_ref().is_none_or(|suffix| {
                suffix.is_empty()
                    || suffix.len() > 4
                    || !suffix.bytes().all(|value| value.is_ascii_digit())
            })
            || ttl.is_zero()
            || ttl > MAX_PAIRING_TTL
        {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "MANAGED_EA_BOOTSTRAP_INVALID",
                "managed EA bootstrap binding is invalid",
            ));
        }
        let expires_at_ms = now_ms() + ttl.as_millis() as u64;
        if let Some(database) = &self.inner.database {
            let owner_uuid = parse_owner_id(owner_id)?;
            let mut transaction = database
                .begin()
                .await
                .map_err(map_database_error("begin managed EA bootstrap transaction"))?;
            let assignment_exists = sqlx::query_scalar::<_, bool>(
                r#"
                SELECT EXISTS (
                  SELECT 1
                  FROM execution_mt5_vm_accounts account
                  JOIN execution_mt5_vm_workers worker
                    ON worker.worker_id = account.worker_id
                  JOIN execution_mt5_vm_account_leases lease
                    ON lease.account_id = account.account_id
                  WHERE account.user_id = $1 AND account.account_id = $2
                    AND account.worker_id = $3
                    AND account.connection_revision = $4
                    AND account.lease_generation = $5
                    AND account.disconnect_requested_revision IS NULL
                    AND worker.session_generation = $6
                    AND worker.worker_substrate = 'bare_metal'
                    AND lease.worker_id = $3
                    AND lease.worker_session_generation = $6
                    AND lease.generation = $5
                    AND lease.status = 'active' AND lease.expires_at > now()
                    AND account.masked_login_suffix = $7
                    AND account.identity_fingerprint = $8
                )
                "#,
            )
            .bind(owner_uuid)
            .bind(binding.account_id.as_str())
            .bind(&binding.worker_id)
            .bind(binding.connection_revision as i64)
            .bind(binding.lease_generation as i64)
            .bind(binding.worker_session_generation as i64)
            .bind(binding.masked_login_suffix.as_deref())
            .bind(&binding.identity_fingerprint)
            .fetch_one(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("validate managed EA assignment", error))?;
            require_active_managed_assignment(assignment_exists)?;
            sqlx::query(
                r#"
                UPDATE execution_pairing_tokens
                SET consumed_at = now()
                WHERE managed_account_id = $1 AND managed_worker_id = $2
                  AND worker_session_generation = $3 AND lease_generation = $4
                  AND consumed_at IS NULL
                "#,
            )
            .bind(binding.account_id.as_str())
            .bind(&binding.worker_id)
            .bind(binding.worker_session_generation as i64)
            .bind(binding.lease_generation as i64)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("revoke prior managed EA bootstrap", error))?;
            sqlx::query(
                r#"
                INSERT INTO execution_pairing_tokens (
                  user_id, token_hash, expires_at, managed_account_id,
                  managed_worker_id, worker_session_generation, lease_generation,
                  connection_revision, masked_login_suffix,
                  identity_fingerprint, managed_slot_id,
                  managed_terminal_pid, managed_gateway_origin
                ) VALUES (
                  $1, $2, to_timestamp($3::double precision / 1000.0), $4,
                  $5, $6, $7, $8, $9, $10, $11, $12, $13
                )
                "#,
            )
            .bind(owner_uuid)
            .bind(sha256(token.as_bytes()).to_vec())
            .bind(expires_at_ms as i64)
            .bind(binding.account_id.as_str())
            .bind(&binding.worker_id)
            .bind(binding.worker_session_generation as i64)
            .bind(binding.lease_generation as i64)
            .bind(binding.connection_revision as i64)
            .bind(binding.masked_login_suffix.as_deref())
            .bind(&binding.identity_fingerprint)
            .bind(&binding.slot_id)
            .bind(i64::from(binding.terminal_pid))
            .bind(&binding.gateway_origin)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("issue managed EA bootstrap", error))?;
            commit_managed_pairing_transaction(transaction).await?;
            return Ok(expires_at_ms);
        }

        let now = now_ms();
        let mut tokens = self.inner.pairing_tokens.lock().await;
        tokens.retain(|_, grant| grant.expires_at_ms > now);
        tokens.retain(|_, grant| {
            grant.managed_binding.as_ref().is_none_or(|current| {
                current.account_id != binding.account_id
                    || current.worker_id != binding.worker_id
                    || current.worker_session_generation != binding.worker_session_generation
                    || current.lease_generation != binding.lease_generation
            })
        });
        tokens.insert(
            sha256(token.as_bytes()),
            PairingGrant {
                owner_id: owner_id.to_owned(),
                expires_at_ms,
                managed_binding: Some(binding),
            },
        );
        Ok(expires_at_ms)
    }

    async fn consume_pairing_token(&self, token: &str) -> Option<PairingGrant> {
        let grant = self
            .inner
            .pairing_tokens
            .lock()
            .await
            .remove(&sha256(token.as_bytes()))?;
        (grant.expires_at_ms > now_ms()).then_some(grant)
    }

    async fn manage_account(
        &self,
        owner_id: &str,
        account_id: &AccountId,
        remove: bool,
    ) -> Result<(), ApiError> {
        validate_identifier("accountId", account_id.as_str(), 96)?;
        if let Some(database) = &self.inner.database {
            let owner_uuid = parse_owner_id(owner_id)?;
            let mut transaction = database
                .begin()
                .await
                .map_err(|error| ApiError::database("begin account management", error))?;
            let account_exists = sqlx::query_scalar::<_, String>(
                r#"
                SELECT id
                FROM execution_accounts
                WHERE user_id = $1 AND id = $2 AND status <> 'disabled'
                FOR UPDATE
                "#,
            )
            .bind(owner_uuid)
            .bind(account_id.as_str())
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("authorize account management", error))?
            .is_some();
            if !account_exists {
                return Err(ApiError::new(
                    StatusCode::NOT_FOUND,
                    "TARGET_ACCOUNT_NOT_FOUND",
                    "target account was not found for this owner",
                ));
            }

            let mut affected_copy_group_ids = Vec::new();
            if remove {
                sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
                    .bind(format!("continuous-copier-owner:{owner_uuid}"))
                    .execute(&mut *transaction)
                    .await
                    .map_err(|error| ApiError::database("lock copier account removal", error))?;
                affected_copy_group_ids = sqlx::query_scalar::<_, Uuid>(
                    r#"
                    SELECT groups.id
                    FROM execution_copy_groups groups
                    WHERE groups.user_id = $1
                      AND (
                          groups.source_account_id = $2 OR
                          EXISTS (
                              SELECT 1
                              FROM execution_copy_targets targets
                              WHERE targets.user_id = groups.user_id
                                AND targets.group_id = groups.id
                                AND targets.account_id = $2
                          )
                      )
                    ORDER BY groups.id
                    FOR UPDATE
                    "#,
                )
                .bind(owner_uuid)
                .bind(account_id.as_str())
                .fetch_all(&mut *transaction)
                .await
                .map_err(|error| ApiError::database("lock account copier groups", error))?;
                if !affected_copy_group_ids.is_empty() {
                    let live_link_count = sqlx::query_scalar::<_, i64>(
                        r#"
                        SELECT count(*)
                        FROM execution_copy_links
                        WHERE user_id = $1 AND group_id = ANY($2)
                          AND lifecycle_status NOT IN ('closed', 'cancelled')
                        "#,
                    )
                    .bind(owner_uuid)
                    .bind(&affected_copy_group_ids)
                    .fetch_one(&mut *transaction)
                    .await
                    .map_err(|error| ApiError::database("check account copier links", error))?;
                    if live_link_count > 0 {
                        return Err(ApiError::new(
                            StatusCode::CONFLICT,
                            "COPY_GROUP_DRAIN_REQUIRED",
                            "the MT5 account cannot be removed while a copier group still has open, pending, closing, orphaned, or error links",
                        ));
                    }
                }
            }

            sqlx::query(
                r#"
                UPDATE execution_ea_sessions
                SET revoked_at = COALESCE(revoked_at, now())
                WHERE user_id = $1 AND account_id = $2
                "#,
            )
            .bind(owner_uuid)
            .bind(account_id.as_str())
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("revoke account sessions", error))?;

            // A reconnect must never replay work that was still waiting in the
            // durable queue when the user explicitly disconnected the account.
            sqlx::query(
                r#"
                WITH stopped AS (
                    UPDATE execution_target_commands
                    SET status = 'failed',
                        reject_code = $3,
                        reject_message = $4,
                        terminal_ack_at = COALESCE(terminal_ack_at, now()),
                        lease_owner = NULL,
                        lease_expires_at = NULL,
                        updated_at = now()
                    WHERE user_id = $1
                      AND target_account_id = $2
                      AND terminal_ack_at IS NULL
                      AND status IN ('waiting', 'ready', 'queued', 'unknown')
                    RETURNING parent_command_id
                ),
                affected_parents AS (
                    SELECT DISTINCT parent_command_id FROM stopped
                )
                UPDATE execution_commands parent
                SET status = CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM execution_target_commands target
                            WHERE target.user_id = parent.user_id
                              AND target.parent_command_id = parent.id
                              AND target.terminal_ack_at IS NULL
                        ) THEN 'submitted'
                        ELSE 'partially_rejected'
                    END,
                    updated_at = now()
                FROM affected_parents
                WHERE parent.user_id = $1
                  AND parent.id = affected_parents.parent_command_id
                "#,
            )
            .bind(owner_uuid)
            .bind(account_id.as_str())
            .bind(if remove {
                "ACCOUNT_REMOVED"
            } else {
                "ACCOUNT_DISCONNECTED"
            })
            .bind(if remove {
                "account was removed before execution"
            } else {
                "account was disconnected before execution"
            })
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("stop queued account commands", error))?;

            if remove {
                sqlx::query(
                    r#"
                    UPDATE execution_copy_groups
                    SET enabled = false,
                        runtime_status = 'inactive',
                        status_message = 'Source account removed',
                        revision = revision + 1,
                        applied_revision = revision + 1,
                        updated_at = now()
                    WHERE user_id = $1 AND source_account_id = $2
                    "#,
                )
                .bind(owner_uuid)
                .bind(account_id.as_str())
                .execute(&mut *transaction)
                .await
                .map_err(|error| ApiError::database("disable source copier groups", error))?;
                sqlx::query(
                    r#"
                    UPDATE execution_copy_targets targets
                    SET enabled = CASE WHEN targets.account_id = $2 THEN false ELSE targets.enabled END,
                        runtime_status = 'inactive',
                        status_message = CASE
                            WHEN targets.account_id = $2 THEN 'Target account removed'
                            ELSE 'Source account removed'
                        END,
                        revision = targets.revision + 1,
                        applied_revision = targets.revision + 1,
                        updated_at = now()
                    FROM execution_copy_groups groups
                    WHERE targets.user_id = $1
                      AND groups.user_id = targets.user_id
                      AND groups.id = targets.group_id
                      AND (
                          targets.account_id = $2 OR
                          groups.source_account_id = $2
                      )
                    "#,
                )
                .bind(owner_uuid)
                .bind(account_id.as_str())
                .execute(&mut *transaction)
                .await
                .map_err(|error| ApiError::database("disable account copier targets", error))?;
                sqlx::query(
                    r#"
                    UPDATE execution_copy_groups groups
                    SET enabled = false,
                        runtime_status = 'inactive',
                        status_message = 'No enabled copier targets remain',
                        revision = groups.revision + 1,
                        applied_revision = groups.revision + 1,
                        updated_at = now()
                    WHERE groups.user_id = $1 AND groups.id = ANY($2)
                      AND NOT EXISTS (
                          SELECT 1
                          FROM execution_copy_targets targets
                          WHERE targets.user_id = groups.user_id
                            AND targets.group_id = groups.id
                            AND targets.enabled = true
                      )
                    "#,
                )
                .bind(owner_uuid)
                .bind(&affected_copy_group_ids)
                .execute(&mut *transaction)
                .await
                .map_err(|error| ApiError::database("disable empty copier groups", error))?;
                sqlx::query(
                    r#"
                    WITH superseded_work AS (
                        UPDATE execution_copy_work_items work
                        SET status = 'superseded',
                            completed_at = COALESCE(completed_at, now()),
                            last_error = 'superseded because an MT5 account was removed',
                            lease_owner = NULL,
                            lease_expires_at = NULL,
                            updated_at = now()
                        FROM execution_copy_groups groups
                        WHERE work.user_id = $1
                          AND groups.user_id = work.user_id
                          AND groups.id = work.group_id
                          AND work.status IN ('pending', 'leased', 'retry')
                          AND (
                              groups.source_account_id = $2 OR
                              work.target_account_id = $2
                          )
                        RETURNING work.id
                    )
                    UPDATE execution_copy_command_outbox outbox
                    SET status = 'dead_letter',
                        last_error = 'superseded because an MT5 account was removed',
                        lease_owner = NULL,
                        lease_expires_at = NULL,
                        updated_at = now()
                    FROM superseded_work
                    WHERE outbox.user_id = $1
                      AND outbox.work_item_id = superseded_work.id
                      AND outbox.status NOT IN ('published', 'acknowledged')
                    "#,
                )
                .bind(owner_uuid)
                .bind(account_id.as_str())
                .execute(&mut *transaction)
                .await
                .map_err(|error| {
                    ApiError::database("supersede removed-account copier work", error)
                })?;
                for statement in [
                    "DELETE FROM execution_positions WHERE user_id = $1 AND account_id = $2",
                    "DELETE FROM execution_pending_orders WHERE user_id = $1 AND account_id = $2",
                    "DELETE FROM execution_risk_policies WHERE user_id = $1 AND account_id = $2",
                    "DELETE FROM execution_instruments WHERE user_id = $1 AND account_id = $2",
                    "DELETE FROM execution_ea_sessions WHERE user_id = $1 AND account_id = $2",
                ] {
                    sqlx::query(statement)
                        .bind(owner_uuid)
                        .bind(account_id.as_str())
                        .execute(&mut *transaction)
                        .await
                        .map_err(|error| {
                            ApiError::database("remove account runtime data", error)
                        })?;
                }
            }

            sqlx::query(
                r#"
                UPDATE execution_accounts
                SET status = $3,
                    trade_allowed = CASE WHEN $4 THEN false ELSE trade_allowed END,
                    last_seen_at = CASE WHEN $4 THEN NULL ELSE last_seen_at END,
                    updated_at = now()
                WHERE user_id = $1 AND id = $2
                "#,
            )
            .bind(owner_uuid)
            .bind(account_id.as_str())
            .bind(if remove { "disabled" } else { "offline" })
            .bind(remove)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("update managed account", error))?;

            sqlx::query(
                r#"
                INSERT INTO execution_audit_log (
                    user_id, actor_type, actor_id, action,
                    resource_type, resource_id, details
                )
                VALUES (
                    $1, 'user', $1::text, $3,
                    'execution_account', $2,
                    jsonb_build_object('queuedCommandsStopped', true)
                )
                "#,
            )
            .bind(owner_uuid)
            .bind(account_id.as_str())
            .bind(if remove {
                "account.removed"
            } else {
                "account.disconnected"
            })
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("audit account management", error))?;

            transaction
                .commit()
                .await
                .map_err(|error| ApiError::database("commit account management", error))?;
            return Ok(());
        }

        let owns_account = self
            .inner
            .accounts
            .lock()
            .await
            .get(account_id)
            .is_some_and(|account| account.owner_id == owner_id);
        if !owns_account {
            return Err(ApiError::new(
                StatusCode::NOT_FOUND,
                "TARGET_ACCOUNT_NOT_FOUND",
                "target account was not found for this owner",
            ));
        }
        self.inner
            .sessions
            .lock()
            .await
            .retain(|_, session| session.owner_id != owner_id || &session.account_id != account_id);
        self.inner.commands.lock().await.remove(account_id);
        if remove {
            self.inner.accounts.lock().await.remove(account_id);
        } else if let Some(account) = self.inner.accounts.lock().await.get_mut(account_id) {
            account.connected = false;
        }
        Ok(())
    }

    async fn create_session(
        &self,
        request: EaSessionRequest,
    ) -> Result<EaSessionResponse, ApiError> {
        validate_session_request(&request)?;
        if let Some(database) = &self.inner.database {
            return self.create_database_session(database, request).await;
        }
        let grant = self
            .consume_pairing_token(&request.pairing_token)
            .await
            .ok_or_else(|| ApiError::unauthorized("EA pairing token is invalid or expired"))?;

        if let Some(binding) = &grant.managed_binding {
            validate_managed_ea_identity(&self.inner.mt5_identity_key, binding, &request.account)?;
            validate_managed_runtime_binding(binding, request.runtime_binding.as_ref())?;
        } else {
            validate_unmanaged_runtime_binding(request.runtime_binding.as_ref())?;
        }

        let account_id = grant
            .managed_binding
            .as_ref()
            .map(|binding| binding.account_id.clone())
            .unwrap_or_else(|| stable_mt5_account_id(&grant.owner_id, &request.account));
        let session_id = SessionId::new(Uuid::new_v4().to_string());
        let raw_token = format!("{}.{}", Uuid::new_v4(), Uuid::new_v4());
        let token_hash = sha256(raw_token.as_bytes());
        let now = now_ms();
        let expires_at_ms = now + SESSION_TTL.as_millis() as u64;
        self.prune_sessions(now).await;
        let mut sessions = self.inner.sessions.lock().await;
        sessions.retain(|_, session| {
            session.owner_id != grant.owner_id || session.account_id != account_id
        });
        sessions.insert(
            token_hash,
            EaSession {
                session_id: session_id.clone(),
                account_id: account_id.clone(),
                owner_id: grant.owner_id.clone(),
                expires_at_ms,
                managed_identity: grant.managed_binding.as_ref().map(|binding| {
                    ManagedEaSessionIdentity {
                        identity_fingerprint: binding.identity_fingerprint.clone(),
                        runtime_binding: EaManagedRuntimeBinding {
                            slot_id: binding.slot_id.clone(),
                            terminal_pid: binding.terminal_pid,
                            gateway_origin: binding.gateway_origin.clone(),
                        },
                    }
                }),
            },
        );
        drop(sessions);
        self.inner.accounts.lock().await.insert(
            account_id.clone(),
            EaAccountView {
                account_id: account_id.clone(),
                owner_id: grant.owner_id,
                connected: true,
                last_seen_at_ms: now,
                minimum_ea_version: minimum_supported_ea_version(),
                account: request.account,
            },
        );
        info!(
            account_id = %account_id,
            agent_id = %request.agent_id,
            "MT5 EA session paired"
        );
        Ok(EaSessionResponse {
            protocol_version: EXECUTION_PROTOCOL_VERSION,
            session_id,
            session_token: raw_token,
            account_id,
            expires_at_ms,
            server_time_ms: now,
        })
    }

    async fn create_database_session(
        &self,
        database: &PgPool,
        request: EaSessionRequest,
    ) -> Result<EaSessionResponse, ApiError> {
        let mut transaction = database
            .begin()
            .await
            .map_err(|error| ApiError::database("begin EA session transaction", error))?;
        let pairing_row = sqlx::query(
            r#"
            UPDATE execution_pairing_tokens
            SET consumed_at = now()
            WHERE token_hash = $1
              AND consumed_at IS NULL
              AND expires_at > now()
              AND (
                (
                  managed_account_id IS NULL AND $2::text IS NULL AND
                  $3::bigint IS NULL AND $4::text IS NULL
                ) OR (
                  managed_account_id IS NOT NULL AND
                  managed_slot_id = $2 AND managed_terminal_pid = $3 AND
                  managed_gateway_origin = $4
                )
              )
            RETURNING user_id, managed_account_id, managed_worker_id,
                      worker_session_generation, lease_generation,
                      connection_revision, masked_login_suffix,
                      identity_fingerprint, managed_slot_id,
                      managed_terminal_pid, managed_gateway_origin
            "#,
        )
        .bind(sha256(request.pairing_token.as_bytes()).to_vec())
        .bind(
            request
                .runtime_binding
                .as_ref()
                .map(|binding| binding.slot_id.as_str()),
        )
        .bind(
            request
                .runtime_binding
                .as_ref()
                .map(|binding| i64::from(binding.terminal_pid)),
        )
        .bind(
            request
                .runtime_binding
                .as_ref()
                .map(|binding| binding.gateway_origin.as_str()),
        )
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("consume pairing token", error))?
        .ok_or_else(|| ApiError::unauthorized("EA pairing token is invalid or expired"))?;

        let owner_uuid = pairing_row
            .try_get::<Uuid, _>("user_id")
            .map_err(|error| ApiError::database("decode pairing token owner", error))?;
        let managed_binding = if let Some(account_id) = pairing_row
            .try_get::<Option<String>, _>("managed_account_id")
            .map_err(|error| ApiError::database("decode managed pairing account", error))?
        {
            let worker_session_generation = pairing_row
                .try_get::<i64, _>("worker_session_generation")
                .map_err(map_database_error(DECODE_PAIRING_WORKER_GENERATION))?
                as u64;
            let lease_generation = pairing_row
                .try_get::<i64, _>("lease_generation")
                .map_err(map_database_error(DECODE_PAIRING_LEASE_GENERATION))?
                as u64;
            let connection_revision = pairing_row
                .try_get::<i64, _>("connection_revision")
                .map_err(map_database_error(DECODE_PAIRING_CONNECTION_REVISION))?
                as u64;
            let identity_fingerprint = pairing_row
                .try_get("identity_fingerprint")
                .map_err(map_database_error(DECODE_PAIRING_IDENTITY))?;
            Some(ManagedEaPairingBinding {
                account_id: AccountId::new(account_id),
                worker_id: pairing_row
                    .try_get("managed_worker_id")
                    .map_err(map_database_error(DECODE_PAIRING_WORKER))?,
                worker_session_generation,
                lease_generation,
                connection_revision,
                slot_id: pairing_row
                    .try_get("managed_slot_id")
                    .map_err(map_database_error(DECODE_PAIRING_SLOT))?,
                terminal_pid: pairing_row
                    .try_get::<i64, _>("managed_terminal_pid")
                    .map_err(map_database_error("decode managed pairing terminal PID"))?
                    .try_into()
                    .map_err(invalid_managed_terminal_pid)?,
                gateway_origin: pairing_row
                    .try_get("managed_gateway_origin")
                    .map_err(map_database_error("decode managed pairing gateway origin"))?,
                #[cfg(test)]
                masked_login_suffix: pairing_row
                    .try_get("masked_login_suffix")
                    .map_err(map_database_error("decode managed pairing login suffix"))?,
                identity_fingerprint,
            })
        } else {
            None
        };
        let owner_id = owner_uuid.to_string();
        if let Some(binding) = &managed_binding {
            validate_managed_ea_identity(&self.inner.mt5_identity_key, binding, &request.account)?;
            validate_managed_runtime_binding(binding, request.runtime_binding.as_ref())?;
            let active = sqlx::query_scalar::<_, i32>(
                r#"
                SELECT 1
                FROM execution_mt5_vm_accounts account
                JOIN execution_mt5_vm_workers worker
                  ON worker.worker_id = account.worker_id
                JOIN execution_mt5_vm_account_leases lease
                  ON lease.account_id = account.account_id
                WHERE account.user_id = $1 AND account.account_id = $2
                  AND account.worker_id = $3 AND account.connection_revision = $4
                  AND account.lease_generation = $5
                  AND account.disconnect_requested_revision IS NULL
                  AND worker.session_generation = $6
                  AND worker.worker_substrate = 'bare_metal'
                  AND lease.worker_id = $3
                  AND lease.worker_session_generation = $6
                  AND lease.generation = $5
                  AND lease.status = 'active' AND lease.expires_at > now()
                  AND account.identity_fingerprint = $7
                FOR UPDATE OF account, worker, lease
                "#,
            )
            .bind(owner_uuid)
            .bind(binding.account_id.as_str())
            .bind(&binding.worker_id)
            .bind(binding.connection_revision as i64)
            .bind(binding.lease_generation as i64)
            .bind(binding.worker_session_generation as i64)
            .bind(&binding.identity_fingerprint)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("lock managed EA assignment", error))?;
            require_active_managed_assignment(active.is_some())?;
        } else {
            validate_unmanaged_runtime_binding(request.runtime_binding.as_ref())?;
        }
        let account_id = managed_binding
            .as_ref()
            .map(|binding| binding.account_id.clone())
            .unwrap_or_else(|| stable_mt5_account_id(&owner_id, &request.account));
        let broker_code = normalize_broker_code(&request.account.broker);
        let label = format!(
            "{} {}",
            request.account.broker.trim(),
            request.account.login.trim()
        );
        let status = if managed_binding.is_some() {
            "connecting"
        } else if request.account.trade_allowed {
            "ready"
        } else {
            "blocked"
        };
        let snapshot_json = if managed_binding.is_some() {
            serde_json::json!({
                "managedEa": true,
                "eaVersion": request.account.ea_version,
                "terminalBuild": request.account.terminal_build
            })
        } else {
            serde_json::to_value(&request.account)
                .map_err(|error| ApiError::internal("serialize EA account", error))?
        };
        let external_account_ref = managed_binding
            .as_ref()
            .map(|_| account_id.as_str())
            .unwrap_or_else(|| request.account.login.trim());
        let account_result = sqlx::query(
            r#"
            INSERT INTO execution_accounts (
                id, user_id, venue_kind, broker_code, external_account_ref,
                server, label, mode, status, currency, balance, equity,
                trade_allowed, capabilities, metadata, last_seen_at
            )
            VALUES (
                $1, $2, 'metatrader5', $3, $4, $5, $6, $7, $8, $9,
                $10, $11, $12,
                '{"marketOrders":true,"pendingOrders":true,"modifyOrders":true,
                  "partialClose":true,"hedging":true,"netting":true}'::jsonb,
                $13, now()
            )
            ON CONFLICT (id) DO UPDATE SET
                broker_code = EXCLUDED.broker_code,
                external_account_ref = CASE
                  WHEN execution_accounts.connector_kind = 'windows_vm'
                    THEN execution_accounts.external_account_ref
                  ELSE EXCLUDED.external_account_ref
                END,
                server = EXCLUDED.server,
                label = CASE
                  WHEN execution_accounts.connector_kind = 'windows_vm'
                    THEN execution_accounts.label
                  ELSE EXCLUDED.label
                END,
                mode = EXCLUDED.mode,
                status = EXCLUDED.status,
                currency = EXCLUDED.currency,
                balance = EXCLUDED.balance,
                equity = EXCLUDED.equity,
                trade_allowed = EXCLUDED.trade_allowed,
                capabilities = EXCLUDED.capabilities,
                metadata = EXCLUDED.metadata,
                last_seen_at = now(),
                updated_at = now()
            WHERE execution_accounts.user_id = EXCLUDED.user_id
            "#,
        )
        .bind(account_id.as_str())
        .bind(owner_uuid)
        .bind(broker_code)
        .bind(external_account_ref)
        .bind(if managed_binding.is_some() {
            ""
        } else {
            request.account.server.trim()
        })
        .bind(label.trim())
        .bind(account_mode_name(request.account.mode))
        .bind(status)
        .bind(request.account.currency.trim())
        .bind(request.account.balance)
        .bind(request.account.equity)
        .bind(request.account.trade_allowed)
        .bind(sqlx::types::Json(snapshot_json))
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("upsert EA account", error))?;
        if account_result.rows_affected() != 1 {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "ACCOUNT_IDENTITY_COLLISION",
                "account identity conflicts with an existing owner",
            ));
        }
        if let Some(binding) = &managed_binding {
            let updated = sqlx::query(
                r#"
                UPDATE execution_mt5_vm_accounts
                SET connection_status = 'synchronizing', agent_version = $3,
                    terminal_version = $4, last_heartbeat_at = now()
                WHERE user_id = $1 AND account_id = $2
                  AND worker_id = $5 AND connection_revision = $6
                  AND lease_generation = $7
                  AND disconnect_requested_revision IS NULL
                "#,
            )
            .bind(owner_uuid)
            .bind(account_id.as_str())
            .bind(request.account.ea_version.as_deref())
            .bind(request.account.terminal_build.to_string())
            .bind(&binding.worker_id)
            .bind(binding.connection_revision as i64)
            .bind(binding.lease_generation as i64)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("mark managed EA synchronizing", error))?;
            require_single_managed_session_update(updated.rows_affected())?;
        }

        // Exactly one active EA session owns command leases for an account.
        sqlx::query(
            r#"
            UPDATE execution_ea_sessions
            SET revoked_at = now()
            WHERE user_id = $1 AND account_id = $2 AND revoked_at IS NULL
            "#,
        )
        .bind(owner_uuid)
        .bind(account_id.as_str())
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("revoke prior EA session", error))?;

        let session_uuid = Uuid::new_v4();
        let session_id = SessionId::new(session_uuid.to_string());
        let raw_token = random_token();
        let now = now_ms();
        let expires_at_ms = now + SESSION_TTL.as_millis() as u64;
        let absolute_expires_at_ms = now + SESSION_ABSOLUTE_TTL.as_millis() as u64;
        sqlx::query(
            r#"
            INSERT INTO execution_ea_sessions (
                id, user_id, account_id, agent_id, token_hash,
                expires_at, absolute_expires_at, managed_worker_id,
                worker_session_generation, lease_generation, connection_revision,
                managed_slot_id, managed_terminal_pid, managed_gateway_origin
            )
            VALUES (
                $1, $2, $3, $4, $5,
                to_timestamp($6::double precision / 1000.0),
                to_timestamp($7::double precision / 1000.0),
                $8, $9, $10, $11, $12, $13, $14
            )
            "#,
        )
        .bind(session_uuid)
        .bind(owner_uuid)
        .bind(account_id.as_str())
        .bind(request.agent_id.trim())
        .bind(sha256(raw_token.as_bytes()).to_vec())
        .bind(expires_at_ms as i64)
        .bind(absolute_expires_at_ms as i64)
        .bind(
            managed_binding
                .as_ref()
                .map(|binding| binding.worker_id.as_str()),
        )
        .bind(
            managed_binding
                .as_ref()
                .map(|binding| binding.worker_session_generation as i64),
        )
        .bind(
            managed_binding
                .as_ref()
                .map(|binding| binding.lease_generation as i64),
        )
        .bind(
            managed_binding
                .as_ref()
                .map(|binding| binding.connection_revision as i64),
        )
        .bind(
            managed_binding
                .as_ref()
                .map(|binding| binding.slot_id.as_str()),
        )
        .bind(
            managed_binding
                .as_ref()
                .map(|binding| i64::from(binding.terminal_pid)),
        )
        .bind(
            managed_binding
                .as_ref()
                .map(|binding| binding.gateway_origin.as_str()),
        )
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("insert EA session", error))?;

        sqlx::query(
            r#"
            INSERT INTO execution_audit_log (
                user_id, actor_type, actor_id, action,
                resource_type, resource_id, details
            )
            VALUES (
                $1, 'ea', $2, 'session.paired', 'execution_account', $3,
                jsonb_build_object(
                  'agentId', $4, 'mode', $5, 'server', $6,
                  'managedSlotId', $7, 'managedTerminalPid', $8,
                  'managedGatewayOrigin', $9
                )
            )
            "#,
        )
        .bind(owner_uuid)
        .bind(session_id.as_str())
        .bind(account_id.as_str())
        .bind(request.agent_id.trim())
        .bind(account_mode_name(request.account.mode))
        .bind(
            managed_binding
                .is_none()
                .then(|| request.account.server.trim()),
        )
        .bind(
            managed_binding
                .as_ref()
                .map(|binding| binding.slot_id.as_str()),
        )
        .bind(
            managed_binding
                .as_ref()
                .map(|binding| i64::from(binding.terminal_pid)),
        )
        .bind(
            managed_binding
                .as_ref()
                .map(|binding| binding.gateway_origin.as_str()),
        )
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("audit EA pairing", error))?;

        transaction
            .commit()
            .await
            .map_err(|error| ApiError::database("commit EA session", error))?;
        info!(
            account_id = %account_id,
            agent_id = %request.agent_id,
            "MT5 EA session paired"
        );
        Ok(EaSessionResponse {
            protocol_version: EXECUTION_PROTOCOL_VERSION,
            session_id,
            session_token: raw_token,
            account_id,
            expires_at_ms,
            server_time_ms: now,
        })
    }

    async fn authenticate(&self, headers: &HeaderMap) -> Result<EaSession, ApiError> {
        let token = bearer_token(headers)
            .ok_or_else(|| ApiError::unauthorized("EA bearer token is required"))?;
        let token_hash = sha256(token.as_bytes());
        if let Some(database) = &self.inner.database {
            let row = sqlx::query(
                r#"
                UPDATE execution_ea_sessions
                SET last_seen_at = now(),
                    expires_at = LEAST(
                        absolute_expires_at,
                        now() + interval '15 minutes'
                    )
                WHERE token_hash = $1
                  AND revoked_at IS NULL
                  AND expires_at > now()
                  AND absolute_expires_at > now()
                  AND EXISTS (
                    SELECT 1
                    FROM execution_accounts accounts
                    WHERE accounts.user_id = execution_ea_sessions.user_id
                      AND accounts.id = execution_ea_sessions.account_id
                      AND accounts.status <> 'disabled'
                  )
                  AND (
                    execution_ea_sessions.managed_worker_id IS NULL OR EXISTS (
                      SELECT 1
                      FROM execution_mt5_vm_accounts managed
                      JOIN execution_mt5_vm_workers worker
                        ON worker.worker_id = managed.worker_id
                      JOIN execution_mt5_vm_account_leases lease
                        ON lease.account_id = managed.account_id
                      WHERE managed.user_id = execution_ea_sessions.user_id
                        AND managed.account_id = execution_ea_sessions.account_id
                        AND managed.worker_id = execution_ea_sessions.managed_worker_id
                        AND managed.lease_generation = execution_ea_sessions.lease_generation
                        AND managed.connection_revision =
                            execution_ea_sessions.connection_revision
                        AND managed.disconnect_requested_revision IS NULL
                        AND worker.session_generation =
                            execution_ea_sessions.worker_session_generation
                        AND worker.status = 'healthy' AND NOT worker.drain
                        AND worker.heartbeat_expires_at > now()
                        AND lease.worker_id = managed.worker_id
                        AND lease.worker_session_generation = worker.session_generation
                        AND lease.generation = managed.lease_generation
                        AND lease.status = 'active' AND lease.expires_at > now()
                    )
                  )
                RETURNING
                    id,
                    user_id::text AS owner_id,
                    account_id,
                    managed_worker_id, worker_session_generation,
                    lease_generation, connection_revision, managed_slot_id,
                    managed_terminal_pid, managed_gateway_origin,
                    floor(extract(epoch FROM expires_at) * 1000)::bigint
                        AS expires_at_ms
                "#,
            )
            .bind(token_hash.to_vec())
            .fetch_optional(database)
            .await
            .map_err(|error| ApiError::database("authenticate EA session", error))?
            .ok_or_else(|| ApiError::unauthorized("EA session is invalid or expired"))?;
            let owner_uuid = row
                .try_get::<String, _>("owner_id")
                .map_err(|error| ApiError::database("decode EA owner", error))?;
            let account_id = row
                .try_get::<String, _>("account_id")
                .map_err(|error| ApiError::database("decode EA account id", error))?;
            let managed_identity = if row
                .try_get::<Option<String>, _>("managed_worker_id")
                .map_err(|error| ApiError::database("decode managed EA session worker", error))?
                .is_some()
            {
                let identity = sqlx::query(
                    r#"
                    SELECT identity_fingerprint
                    FROM execution_mt5_vm_accounts
                    WHERE user_id = $1 AND account_id = $2
                      AND disconnect_requested_revision IS NULL
                    "#,
                )
                .bind(parse_owner_id(&owner_uuid)?)
                .bind(&account_id)
                .fetch_optional(database)
                .await
                .map_err(|error| ApiError::database("load managed EA session identity", error))?
                .ok_or_else(|| ApiError::unauthorized("managed EA session is fenced"))?;
                let terminal_pid = row
                    .try_get::<Option<i64>, _>("managed_terminal_pid")
                    .map_err(map_database_error("decode managed EA session terminal PID"))?
                    .and_then(|pid| pid.try_into().ok())
                    .ok_or_else(|| ApiError::unauthorized("managed EA session is fenced"))?;
                let identity_fingerprint = identity
                    .try_get("identity_fingerprint")
                    .map_err(map_database_error(DECODE_SESSION_IDENTITY))?;
                let slot_id = row
                    .try_get::<Option<String>, _>("managed_slot_id")
                    .map_err(map_database_error(DECODE_SESSION_SLOT))?;
                let slot_id = required_managed_session_value(slot_id)?;
                let gateway_origin = row
                    .try_get::<Option<String>, _>("managed_gateway_origin")
                    .map_err(map_database_error(DECODE_SESSION_GATEWAY))?;
                let gateway_origin = required_managed_session_value(gateway_origin)?;
                Some(ManagedEaSessionIdentity {
                    identity_fingerprint,
                    runtime_binding: EaManagedRuntimeBinding {
                        slot_id,
                        terminal_pid,
                        gateway_origin,
                    },
                })
            } else {
                None
            };
            return Ok(EaSession {
                session_id: SessionId::new(
                    row.try_get::<Uuid, _>("id")
                        .map_err(|error| ApiError::database("decode EA session id", error))?
                        .to_string(),
                ),
                account_id: AccountId::new(account_id),
                owner_id: owner_uuid,
                expires_at_ms: row
                    .try_get::<i64, _>("expires_at_ms")
                    .map_err(|error| ApiError::database("decode EA session expiry", error))?
                    as u64,
                managed_identity,
            });
        }
        let now = now_ms();
        let mut sessions = self.inner.sessions.lock().await;
        let Some(session) = sessions.get_mut(&token_hash) else {
            return Err(ApiError::unauthorized("EA session is invalid"));
        };
        if session.expires_at_ms <= now {
            sessions.remove(&token_hash);
            return Err(ApiError::unauthorized("EA session has expired"));
        }
        session.expires_at_ms = now + SESSION_TTL.as_millis() as u64;
        Ok(session.clone())
    }

    async fn touch_account(
        &self,
        owner_id: &str,
        account_id: &AccountId,
        account: EaAccountSnapshot,
    ) -> Result<(), ApiError> {
        if let Some(database) = &self.inner.database {
            let owner_uuid = parse_owner_id(owner_id)?;
            let snapshot_json = serde_json::to_value(&account)
                .map_err(|error| ApiError::internal("serialize EA heartbeat", error))?;
            let result = sqlx::query(
                r#"
                UPDATE execution_accounts
                SET broker_code = $3,
                    external_account_ref = CASE
                      WHEN connector_kind = 'windows_vm' THEN external_account_ref
                      ELSE $4
                    END,
                    server = CASE
                      WHEN connector_kind = 'windows_vm' THEN ''
                      ELSE $5
                    END,
                    mode = $6,
                    status = CASE
                      WHEN connector_kind = 'windows_vm' THEN status
                      ELSE $7
                    END,
                    currency = $8,
                    balance = $9,
                    equity = $10,
                    trade_allowed = $11,
                    metadata = CASE
                      WHEN connector_kind = 'windows_vm' THEN jsonb_strip_nulls(
                        jsonb_build_object(
                          'managedEa', true,
                          'eaVersion', $12::jsonb -> 'eaVersion',
                          'terminalBuild', $12::jsonb -> 'terminalBuild'
                        )
                      )
                      ELSE $12
                    END,
                    last_seen_at = now(),
                    updated_at = now()
                WHERE user_id = $1 AND id = $2 AND status <> 'disabled'
                "#,
            )
            .bind(owner_uuid)
            .bind(account_id.as_str())
            .bind(normalize_broker_code(&account.broker))
            .bind(account.login.trim())
            .bind(account.server.trim())
            .bind(account_mode_name(account.mode))
            .bind(if account.trade_allowed {
                "ready"
            } else {
                "blocked"
            })
            .bind(account.currency.trim())
            .bind(account.balance)
            .bind(account.equity)
            .bind(account.trade_allowed)
            .bind(sqlx::types::Json(snapshot_json))
            .execute(database)
            .await
            .map_err(|error| ApiError::database("update EA heartbeat", error))?;
            if result.rows_affected() != 1 {
                return Err(ApiError::new(
                    StatusCode::FORBIDDEN,
                    "ACCOUNT_SESSION_MISMATCH",
                    "EA account is not owned by this session",
                ));
            }
            return Ok(());
        }
        let mut accounts = self.inner.accounts.lock().await;
        let Some(existing) = accounts.get_mut(account_id) else {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "ACCOUNT_SESSION_MISMATCH",
                "EA account is not owned by this session",
            ));
        };
        if existing.owner_id != owner_id {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "ACCOUNT_SESSION_MISMATCH",
                "EA account is not owned by this session",
            ));
        }
        existing.connected = true;
        existing.last_seen_at_ms = now_ms();
        existing.account = account;
        Ok(())
    }

    async fn advance_managed_ea_readiness_after_event(
        &self,
        owner_id: &str,
        account_id: &AccountId,
    ) -> Result<(), ApiError> {
        let Some(database) = &self.inner.database else {
            return Ok(());
        };
        let owner_uuid = parse_owner_id(owner_id)?;
        sqlx::query("SELECT execution_advance_mt5_managed_readiness($1, $2, $3)")
            .bind(owner_uuid)
            .bind(account_id.as_str())
            .bind(EA_POLL_FRESHNESS.as_millis() as i64)
            .execute(database)
            .await
            .map_err(|error| ApiError::database("advance managed EA readiness", error))?;
        Ok(())
    }

    #[allow(clippy::needless_borrow)]
    async fn prop_risk_guard_view(
        &self,
        owner_uuid: Uuid,
        account_id: &AccountId,
    ) -> Result<PropRiskGuardView, ApiError> {
        let Some(database) = &self.inner.database else {
            return Ok(PropRiskGuardView {
                profiles: Vec::new(),
                assignment: None,
            });
        };
        let profiles = prop_risk_profiles(database).await?;
        let row = sqlx::query(
            r#"
            SELECT
                assignment.enabled,
                assignment.profile_id,
                assignment.profile_version,
                assignment.provider_code,
                assignment.program_code,
                assignment.display_name,
                assignment.timezone,
                assignment.initial_balance,
                assignment.rules,
                assignment.actions,
                to_char(state.trading_day, 'YYYY-MM-DD') AS trading_day,
                CASE
                    WHEN state.evaluated_at > assignment.updated_at
                    THEN state.evaluation
                END AS evaluation,
                floor(extract(epoch FROM assignment.updated_at) * 1000)::bigint
                    AS updated_at_ms
            FROM execution_prop_risk_assignments assignment
            LEFT JOIN execution_prop_risk_daily_state state
              ON state.user_id = assignment.user_id
             AND state.account_id = assignment.account_id
             AND state.trading_day =
                 (now() AT TIME ZONE assignment.timezone)::date
            WHERE assignment.user_id = $1
              AND assignment.account_id = $2
            "#,
        )
        .bind(owner_uuid)
        .bind(account_id.as_str())
        .fetch_optional(database)
        .await
        .map_err(|error| ApiError::database("load prop risk settings", error))?;
        let assignment_profile = if let Some(stored) = row.as_ref() {
            let profile_id = stored
                .try_get::<String, _>("profile_id")
                .map_err(|error| ApiError::database("decode prop risk profile", error))?;
            let profile_version = stored
                .try_get::<i32, _>("profile_version")
                .map_err(|error| ApiError::database("decode prop risk profile version", error))?
                .max(0) as u32;
            prop_risk_profile(database, &profile_id, Some(profile_version)).await?
        } else {
            None
        };
        let assignment = row
            .map(|row| -> Result<PropRiskAssignmentView, ApiError> {
                let profile_id = row
                    .try_get::<String, _>("profile_id")
                    .map_err(|error| ApiError::database("decode prop risk profile", error))?;
                let profile_version = row
                    .try_get::<i32, _>("profile_version")
                    .map_err(|error| ApiError::database("decode prop risk profile version", error))?
                    .max(0) as u32;
                let stored_initial_balance =
                    row.try_get::<Decimal, _>("initial_balance")
                        .map_err(|error| {
                            ApiError::database("decode prop risk initial balance", error)
                        })?;
                let initial_balance = if let Some(profile) =
                    assignment_profile.as_ref().filter(|profile| {
                        profile.id == profile_id && profile.version == profile_version
                    }) {
                    resolve_profile_initial_balance(&profile, stored_initial_balance).map_err(
                        |error| ApiError::internal("resolve prop risk initial balance", error),
                    )?
                } else {
                    stored_initial_balance
                };
                let rules = row
                    .try_get::<sqlx::types::Json<PropRiskRules>, _>("rules")
                    .map_err(|error| ApiError::database("decode prop risk rules", error))?
                    .0;
                let actions = row
                    .try_get::<sqlx::types::Json<PropRiskActions>, _>("actions")
                    .map_err(|error| ApiError::database("decode prop risk actions", error))?
                    .0;
                let evaluation = row
                    .try_get::<Option<sqlx::types::Json<PropRiskEvaluation>>, _>("evaluation")
                    .map_err(|error| ApiError::database("decode prop risk evaluation", error))?
                    .map(|value| value.0)
                    .filter(|value| {
                        value.model_version == 2
                            && value.daily_loss_limit
                                == prop_risk_money(
                                    initial_balance,
                                    rules.daily_loss_limit_basis_points,
                                )
                            && value.max_loss_limit
                                == prop_risk_money(
                                    initial_balance,
                                    rules.max_loss_limit_basis_points,
                                )
                    });
                Ok(PropRiskAssignmentView {
                    account_id: account_id.clone(),
                    enabled: row.try_get("enabled").map_err(|error| {
                        ApiError::database("decode prop risk enabled state", error)
                    })?,
                    profile_id,
                    profile_version,
                    provider_code: row
                        .try_get("provider_code")
                        .map_err(|error| ApiError::database("decode prop risk provider", error))?,
                    program_code: row
                        .try_get("program_code")
                        .map_err(|error| ApiError::database("decode prop risk program", error))?,
                    display_name: row.try_get("display_name").map_err(|error| {
                        ApiError::database("decode prop risk display name", error)
                    })?,
                    timezone: row
                        .try_get("timezone")
                        .map_err(|error| ApiError::database("decode prop risk timezone", error))?,
                    initial_balance,
                    rules,
                    actions,
                    trading_day: row.try_get("trading_day").map_err(|error| {
                        ApiError::database("decode prop risk trading day", error)
                    })?,
                    evaluation,
                    updated_at_ms: row
                        .try_get::<i64, _>("updated_at_ms")
                        .map_err(|error| ApiError::database("decode prop risk update time", error))?
                        .max(0) as u64,
                })
            })
            .transpose()?;
        Ok(PropRiskGuardView {
            profiles,
            assignment,
        })
    }

    #[allow(clippy::needless_borrow)]
    async fn load_prop_risk_runtime(
        &self,
        owner_uuid: Uuid,
        account_id: &AccountId,
        current_balance: Decimal,
    ) -> Result<Option<PropRiskRuntimeConfig>, ApiError> {
        let Some(database) = &self.inner.database else {
            return Ok(None);
        };
        let row = sqlx::query(
            r#"
            SELECT
                assignment.profile_id,
                assignment.profile_version,
                assignment.initial_balance,
                assignment.rules,
                assignment.actions,
                assignment.updated_at::text AS assignment_revision,
                to_char(
                    (now() AT TIME ZONE assignment.timezone)::date,
                    'YYYY-MM-DD'
                ) AS trading_day,
                state.day_start_balance,
                state.last_equity,
                state.min_equity,
                state.reason AS state_reason,
                state.locked,
                state.evaluation,
                state.evaluated_at > assignment.updated_at AS state_fresh,
                history.highest_prior_eod_balance,
                history.prior_positive_days_profit,
                history.prior_best_day_profit,
                history.historical_static_max_loss_result,
                history.historical_eod_max_loss_result,
                lock_audit.locked_equity,
                lock_audit.occurred_at >= assignment.updated_at
                    AS lock_policy_matches
            FROM execution_prop_risk_assignments assignment
            LEFT JOIN execution_prop_risk_daily_state state
              ON state.user_id = assignment.user_id
             AND state.account_id = assignment.account_id
             AND state.trading_day =
                 (now() AT TIME ZONE assignment.timezone)::date
            LEFT JOIN LATERAL (
                SELECT
                    MAX(day.last_balance) FILTER (
                        WHERE day.trading_day <
                            (now() AT TIME ZONE assignment.timezone)::date
                    ) AS highest_prior_eod_balance,
                    COALESCE(SUM(GREATEST(
                        day.last_balance - day.day_start_balance,
                        0
                    )) FILTER (
                        WHERE day.trading_day <
                            (now() AT TIME ZONE assignment.timezone)::date
                    ), 0) AS prior_positive_days_profit,
                    COALESCE(MAX(GREATEST(
                        day.last_balance - day.day_start_balance,
                        0
                    )) FILTER (
                        WHERE day.trading_day <
                            (now() AT TIME ZONE assignment.timezone)::date
                    ), 0) AS prior_best_day_profit,
                    COALESCE(MIN(
                        day.min_equity - assignment.initial_balance
                    ), 0) AS historical_static_max_loss_result,
                    COALESCE(MIN(
                        day.min_equity - GREATEST(
                            assignment.initial_balance,
                            COALESCE(day.prior_eod_high, assignment.initial_balance)
                        )
                    ), 0) AS historical_eod_max_loss_result
                FROM (
                    SELECT
                        historical.*,
                        MAX(historical.last_balance) OVER (
                            ORDER BY historical.trading_day
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                        ) AS prior_eod_high
                    FROM execution_prop_risk_daily_state historical
                    WHERE historical.user_id = assignment.user_id
                      AND historical.account_id = assignment.account_id
                ) day
            ) history ON true
            LEFT JOIN LATERAL (
                SELECT
                    audit.details->>'equity' AS locked_equity,
                    audit.occurred_at
                FROM execution_audit_log audit
                WHERE state.locked = true
                  AND state.reason IN (
                      'DAILY_LOSS_LIMIT_BREACHED',
                      'DAILY_LOSS_SAFETY_BUFFER'
                  )
                  AND audit.user_id = assignment.user_id
                  AND audit.action = 'prop_risk.locked'
                  AND audit.resource_type = 'execution_account'
                  AND audit.resource_id = assignment.account_id
                  AND audit.details->>'tradingDay' =
                      to_char(state.trading_day, 'YYYY-MM-DD')
                  AND audit.details->>'reason' = state.reason
                ORDER BY audit.occurred_at, audit.sequence
                LIMIT 1
            ) lock_audit ON true
            WHERE assignment.user_id = $1
              AND assignment.account_id = $2
              AND assignment.enabled = true
            "#,
        )
        .bind(owner_uuid)
        .bind(account_id.as_str())
        .fetch_optional(database)
        .await
        .map_err(|error| ApiError::database("load prop risk guard", error))?;
        let Some(row) = row else {
            return Ok(None);
        };
        let prior = row
            .try_get::<Option<sqlx::types::Json<PropRiskEvaluation>>, _>("evaluation")
            .map_err(|error| ApiError::database("decode prop risk evaluation", error))?
            .map(|value| value.0);
        let stored_day_start_balance = row
            .try_get::<Option<Decimal>, _>("day_start_balance")
            .map_err(|error| ApiError::database("decode prop risk day baseline", error))?;
        let last_equity = row
            .try_get::<Option<Decimal>, _>("last_equity")
            .map_err(|error| ApiError::database("decode prop risk last equity", error))?;
        let min_equity = row
            .try_get::<Option<Decimal>, _>("min_equity")
            .map_err(|error| ApiError::database("decode prop risk minimum equity", error))?;
        let state_reason = row
            .try_get::<Option<String>, _>("state_reason")
            .map_err(|error| ApiError::database("decode prop risk state reason", error))?;
        let state_fresh = row
            .try_get::<Option<bool>, _>("state_fresh")
            .map_err(|error| ApiError::database("decode prop risk state freshness", error))?
            .unwrap_or(false);
        let locked_equity = row
            .try_get::<Option<String>, _>("locked_equity")
            .map_err(|error| ApiError::database("decode prop risk lock equity", error))?
            .and_then(|value| value.parse::<Decimal>().ok());
        let lock_policy_matches = row
            .try_get::<Option<bool>, _>("lock_policy_matches")
            .map_err(|error| ApiError::database("decode prop risk lock policy", error))?
            .unwrap_or(false);
        let locked = row
            .try_get::<Option<bool>, _>("locked")
            .map_err(|error| ApiError::database("decode prop risk lock", error))?
            .unwrap_or(false);
        let profile_id = row
            .try_get::<String, _>("profile_id")
            .map_err(|error| ApiError::database("decode prop risk profile", error))?;
        let profile_version = row
            .try_get::<i32, _>("profile_version")
            .map_err(|error| ApiError::database("decode prop risk profile version", error))?
            .max(0) as u32;
        let assignment_revision = row
            .try_get::<String, _>("assignment_revision")
            .map_err(|error| ApiError::database("decode prop risk assignment revision", error))?;
        let stored_initial_balance = row
            .try_get::<Decimal, _>("initial_balance")
            .map_err(|error| ApiError::database("decode prop risk initial balance", error))?;
        let rules = row
            .try_get::<sqlx::types::Json<PropRiskRules>, _>("rules")
            .map_err(|error| ApiError::database("decode prop risk rules", error))?
            .0;
        let actions = row
            .try_get::<sqlx::types::Json<PropRiskActions>, _>("actions")
            .map_err(|error| ApiError::database("decode prop risk actions", error))?
            .0;
        let catalog_profile =
            prop_risk_profile(database, &profile_id, Some(profile_version)).await?;
        let initial_balance = if let Some(profile) = catalog_profile
            .as_ref()
            .filter(|profile| profile.version == profile_version)
        {
            resolve_profile_initial_balance(&profile, stored_initial_balance)
                .map_err(|error| ApiError::internal("resolve prop risk initial balance", error))?
        } else {
            stored_initial_balance
        };
        let highest_prior_eod_balance = row
            .try_get::<Option<Decimal>, _>("highest_prior_eod_balance")
            .map_err(|error| ApiError::database("decode prop risk EOD high-water", error))?;
        let max_loss_reference_balance = match rules.max_loss_mode {
            PropRiskMaxLossMode::Static => initial_balance,
            PropRiskMaxLossMode::EndOfDayTrailing => highest_prior_eod_balance
                .filter(|balance| *balance > initial_balance)
                .unwrap_or(initial_balance),
        };
        let historical_max_loss_result = match rules.max_loss_mode {
            PropRiskMaxLossMode::Static => {
                row.try_get::<Decimal, _>("historical_static_max_loss_result")
            }
            PropRiskMaxLossMode::EndOfDayTrailing => {
                row.try_get::<Decimal, _>("historical_eod_max_loss_result")
            }
        }
        .map_err(|error| ApiError::database("decode prop risk maximum-loss result", error))?;
        let prior_positive_days_profit = row
            .try_get::<Decimal, _>("prior_positive_days_profit")
            .map_err(|error| ApiError::database("decode prop risk positive-days profit", error))?;
        let prior_best_day_profit = row
            .try_get::<Decimal, _>("prior_best_day_profit")
            .map_err(|error| ApiError::database("decode prop risk best-day profit", error))?;
        let trading_day = row
            .try_get::<String, _>("trading_day")
            .map_err(|error| ApiError::database("decode prop risk trading day", error))?;
        let initial_balance_reconciled = initial_balance != stored_initial_balance;
        let day_start_balance =
            resolve_prop_risk_day_start_balance(stored_day_start_balance, current_balance);
        if initial_balance_reconciled {
            let mut transaction = database.begin().await.map_err(|error| {
                ApiError::database("begin prop risk capital reconciliation", error)
            })?;
            let assignment_update = sqlx::query(
                r#"
                UPDATE execution_prop_risk_assignments
                SET initial_balance = $3
                WHERE user_id = $1 AND account_id = $2
                  AND initial_balance = $4 AND profile_id = $5 AND profile_version = $6
                  AND enabled = true AND updated_at = $7::timestamptz
                "#,
            )
            .bind(owner_uuid)
            .bind(account_id.as_str())
            .bind(initial_balance)
            .bind(stored_initial_balance)
            .bind(&profile_id)
            .bind(profile_version as i32)
            .bind(&assignment_revision)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("reconcile prop risk initial balance", error))?;
            if assignment_update.rows_affected() == 0 {
                transaction.rollback().await.map_err(|error| {
                    ApiError::database("rollback stale prop risk reconciliation", error)
                })?;
                return Err(ApiError::new(
                    StatusCode::CONFLICT,
                    "PROP_RISK_ASSIGNMENT_CHANGED",
                    "prop risk settings changed during capital reconciliation; retry",
                ));
            }
            transaction.commit().await.map_err(|error| {
                ApiError::database("commit prop risk capital reconciliation", error)
            })?;
        }
        let mut previously_locked_reason = if locked && state_fresh {
            Some(
                prior
                    .as_ref()
                    .and_then(|evaluation| evaluation.reason)
                    .unwrap_or(PropRiskReason::StateUnavailable),
            )
        } else {
            None
        };
        let repair_candidate = match (
            previously_locked_reason,
            prior.as_ref(),
            stored_day_start_balance,
            last_equity,
            min_equity,
            locked_equity,
        ) {
            (
                Some(reason),
                Some(evaluation),
                Some(day_start),
                Some(last),
                Some(minimum),
                Some(lock_equity),
            ) => {
                !initial_balance_reconciled
                    && state_fresh
                    && lock_policy_matches
                    && state_reason.as_deref() == Some(prop_risk_reason_name(reason))
                    && matches_legacy_prop_risk_daily_floor(
                        &rules,
                        initial_balance,
                        last,
                        evaluation,
                    )
                    && matches_legacy_prop_risk_lock_event(
                        &rules,
                        initial_balance,
                        reason,
                        lock_equity,
                    )
                    && should_repair_legacy_prop_risk_daily_lock(
                        &rules,
                        &actions,
                        initial_balance,
                        day_start,
                        minimum,
                        reason,
                    )
            }
            _ => false,
        };
        if repair_candidate {
            let reason = previously_locked_reason.expect("repair candidate has a lock reason");
            let evaluation = prior.as_ref().expect("repair candidate has an evaluation");
            let minimum = min_equity.expect("repair candidate has minimum equity");
            let day_start = stored_day_start_balance.expect("repair candidate has a baseline");
            let mut transaction = database
                .begin()
                .await
                .map_err(|error| ApiError::database("begin legacy prop risk lock repair", error))?;
            let repaired = sqlx::query(
                r#"
                UPDATE execution_prop_risk_daily_state AS state
                SET locked = false,
                    status = 'protected',
                    reason = NULL,
                    evaluated_at = assignment.updated_at
                FROM execution_prop_risk_assignments AS assignment
                WHERE state.user_id = assignment.user_id
                  AND state.account_id = assignment.account_id
                  AND state.user_id = $1
                  AND state.account_id = $2
                  AND state.trading_day = $3::date
                  AND state.locked = true
                  AND state.min_equity = $4
                  AND state.reason = $5
                  AND state.evaluation = $6
                  AND assignment.enabled = true
                  AND assignment.updated_at = $7::timestamptz
                "#,
            )
            .bind(owner_uuid)
            .bind(account_id.as_str())
            .bind(&trading_day)
            .bind(minimum)
            .bind(prop_risk_reason_name(reason))
            .bind(sqlx::types::Json(evaluation))
            .bind(&assignment_revision)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("repair legacy prop risk lock", error))?;
            if repaired.rows_affected() != 1 {
                transaction.rollback().await.map_err(|error| {
                    ApiError::database("rollback stale prop risk lock repair", error)
                })?;
                return Err(ApiError::new(
                    StatusCode::CONFLICT,
                    "PROP_RISK_STATE_CHANGED",
                    "prop risk state changed during legacy lock repair; retry",
                ));
            }
            sqlx::query(
                r#"
                INSERT INTO execution_audit_log (
                    user_id, actor_type, actor_id, action,
                    resource_type, resource_id, details
                )
                VALUES (
                    $1, 'service', 'prop-risk-guard',
                    'prop_risk.legacy_false_lock_repaired',
                    'execution_account', $2,
                    jsonb_build_object(
                        'tradingDay', $3,
                        'previousReason', $4,
                        'dayStartBalance', $5::text,
                        'minimumEquity', $6::text
                    )
                )
                "#,
            )
            .bind(owner_uuid)
            .bind(account_id.as_str())
            .bind(&trading_day)
            .bind(prop_risk_reason_name(reason))
            .bind(day_start)
            .bind(minimum)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("audit legacy prop risk lock repair", error))?;
            previously_locked_reason = None;
            transaction.commit().await.map_err(|error| {
                ApiError::database("commit legacy prop risk lock repair", error)
            })?;
        }
        Ok(Some(PropRiskRuntimeConfig {
            initial_balance,
            rules,
            actions,
            trading_day,
            day_start_balance,
            max_loss_reference_balance,
            current_day_min_equity: min_equity,
            historical_max_loss_result,
            prior_positive_days_profit,
            prior_best_day_profit,
            previously_locked_reason,
            state_exists: stored_day_start_balance.is_some() && !initial_balance_reconciled,
        }))
    }

    async fn load_prop_risk_policy(
        &self,
        owner_uuid: Uuid,
        account_id: &AccountId,
    ) -> Result<Option<(PropRiskRules, PropRiskActions)>, ApiError> {
        let Some(database) = &self.inner.database else {
            return Ok(None);
        };
        let row = sqlx::query(
            r#"
            SELECT rules, actions
            FROM execution_prop_risk_assignments
            WHERE user_id = $1 AND account_id = $2 AND enabled = true
            "#,
        )
        .bind(owner_uuid)
        .bind(account_id.as_str())
        .fetch_optional(database)
        .await
        .map_err(|error| ApiError::database("load prop risk lifecycle policy", error))?;
        row.map(|row| {
            let rules = row
                .try_get::<sqlx::types::Json<PropRiskRules>, _>("rules")
                .map_err(|error| ApiError::database("decode prop risk lifecycle rules", error))?
                .0;
            let actions = row
                .try_get::<sqlx::types::Json<PropRiskActions>, _>("actions")
                .map_err(|error| ApiError::database("decode prop risk lifecycle actions", error))?
                .0;
            Ok((rules, actions))
        })
        .transpose()
    }

    async fn apply_prop_risk_pretrade(
        &self,
        owner_uuid: Uuid,
        context: &RouteTargetContext,
        order: &mut RoutedOrder,
    ) -> Result<Option<(RouteRejectCode, String)>, ApiError> {
        let balance = context.account.balance.unwrap_or_default();
        let equity = context.account.equity.unwrap_or_default();
        let Some(runtime) = self
            .load_prop_risk_runtime(owner_uuid, &context.account.id, balance)
            .await?
        else {
            return Ok(None);
        };
        if !runtime.state_exists && runtime.actions.fail_closed_on_stale_data {
            return Ok(Some((
                RouteRejectCode::PropRiskStateUnavailable,
                "prop risk guard is waiting for the first fresh account heartbeat".into(),
            )));
        }
        let telemetry_stale = now_ms().saturating_sub(context.account.updated_at_ms)
            > EA_POLL_FRESHNESS.as_millis() as u64;
        let evaluation = evaluate_prop_risk(
            &runtime.rules,
            &runtime.actions,
            &PropRiskEvaluationInput {
                initial_balance: runtime.initial_balance,
                day_start_balance: runtime.day_start_balance,
                max_loss_reference_balance: runtime.max_loss_reference_balance,
                current_day_min_equity: runtime.current_day_min_equity.unwrap_or(equity),
                historical_max_loss_result: runtime.historical_max_loss_result,
                prior_positive_days_profit: runtime.prior_positive_days_profit,
                prior_best_day_profit: runtime.prior_best_day_profit,
                history_quality: PropRiskHistoryQuality::TrackedSinceGuardEnabled,
                trading_days: None,
                has_open_positions: false,
                balance,
                equity,
                previously_locked_reason: runtime.previously_locked_reason,
                telemetry_stale,
                unprotected_exposure: false,
            },
        );
        if !evaluation.can_open_new_orders {
            let reason = evaluation
                .reason
                .map(prop_risk_reason_name)
                .unwrap_or("PROP_RISK_LOCKED");
            return Ok(Some((
                RouteRejectCode::PropRiskLocked,
                format!("prop risk guard blocked the order: {reason}"),
            )));
        }
        if runtime.rules.require_stop_loss && order.stop_loss.is_none() {
            return Ok(Some((
                RouteRejectCode::StopLossRequired,
                "prop risk guard requires a stop loss on every order".into(),
            )));
        }
        let entry = match order.kind {
            execution_domain::OrderKind::Market => context.reference_price,
            execution_domain::OrderKind::Limit => order.limit_price,
            execution_domain::OrderKind::Stop => order.stop_price,
        };
        let risk_per_quantity = match (
            entry,
            order.stop_loss,
            context.instrument.tick_value_per_quantity,
        ) {
            (Some(entry), Some(stop), Some(tick_value))
                if context.instrument.price_tick > Decimal::ZERO && tick_value > Decimal::ZERO =>
            {
                (entry - stop).abs() / context.instrument.price_tick * tick_value
            }
            _ if runtime.actions.fail_closed_on_stale_data => {
                return Ok(Some((
                    RouteRejectCode::PropRiskStateUnavailable,
                    "prop risk guard cannot verify the order risk from fresh broker metadata"
                        .into(),
                )));
            }
            _ => Decimal::ZERO,
        };
        let max_per_trade = prop_risk_money(
            runtime.initial_balance,
            runtime.rules.max_risk_per_trade_basis_points,
        );
        let open_risk = self
            .committed_risk_at_stops(owner_uuid, &context.account.id)
            .await?;
        let Some(open_risk) = open_risk else {
            if runtime.rules.require_stop_loss || runtime.actions.fail_closed_on_stale_data {
                return Ok(Some((
                    RouteRejectCode::PropRiskStateUnavailable,
                    "prop risk guard cannot verify every existing position and pending order at its stop"
                        .into(),
                )));
            }
            return Ok(None);
        };
        let max_open_risk = prop_risk_money(
            runtime.initial_balance,
            runtime.rules.max_total_open_risk_basis_points,
        );
        let emergency_buffer = prop_risk_money(
            runtime.initial_balance,
            runtime.rules.emergency_buffer_basis_points,
        );
        let safe_risk = [
            max_per_trade,
            max_open_risk - open_risk,
            evaluation.daily_loss_remaining - emergency_buffer - open_risk,
            evaluation.max_loss_remaining - emergency_buffer - open_risk,
        ]
        .into_iter()
        .min()
        .unwrap_or(Decimal::ZERO);
        if safe_risk <= Decimal::ZERO || risk_per_quantity <= Decimal::ZERO {
            return Ok(Some((
                RouteRejectCode::PropRiskLimitExceeded,
                "no protected drawdown budget remains for another order".into(),
            )));
        }
        let planned_risk = risk_per_quantity * order.quantity;
        if planned_risk > safe_risk {
            let capped_quantity = floor_to_step(
                safe_risk / risk_per_quantity,
                context.instrument.quantity_step,
            );
            if capped_quantity < context.instrument.min_quantity {
                return Ok(Some((
                    RouteRejectCode::PropRiskLimitExceeded,
                    "the remaining protected risk budget is below the broker minimum quantity"
                        .into(),
                )));
            }
            order.quantity = capped_quantity;
            if !order
                .warnings
                .contains(&RouteWarning::QuantityCappedByPropRisk)
            {
                order.warnings.push(RouteWarning::QuantityCappedByPropRisk);
            }
        }
        Ok(None)
    }

    async fn committed_risk_at_stops(
        &self,
        owner_uuid: Uuid,
        account_id: &AccountId,
    ) -> Result<Option<Decimal>, ApiError> {
        let Some(database) = &self.inner.database else {
            return Ok(None);
        };
        let rows = sqlx::query(
            r#"
            SELECT positions.snapshot AS position, instruments.snapshot AS instrument
            FROM execution_positions positions
            LEFT JOIN execution_instruments instruments
              ON instruments.user_id = positions.user_id
             AND instruments.account_id = positions.account_id
             AND instruments.venue_symbol = positions.snapshot->>'venueSymbol'
            WHERE positions.user_id = $1 AND positions.account_id = $2
            "#,
        )
        .bind(owner_uuid)
        .bind(account_id.as_str())
        .fetch_all(database)
        .await
        .map_err(|error| ApiError::database("load open risk positions", error))?;
        let mut total = Decimal::ZERO;
        for row in rows {
            let position = row
                .try_get::<sqlx::types::Json<EaPositionSnapshot>, _>("position")
                .map_err(|error| ApiError::database("decode open risk position", error))?
                .0;
            let Some(instrument) = row
                .try_get::<Option<sqlx::types::Json<InstrumentSpec>>, _>("instrument")
                .map_err(|error| ApiError::database("decode open risk instrument", error))?
                .map(|value| value.0)
            else {
                return Ok(None);
            };
            let (Some(stop), Some(tick_value)) =
                (position.stop_loss, instrument.tick_value_per_quantity)
            else {
                return Ok(None);
            };
            if instrument.price_tick <= Decimal::ZERO || tick_value <= Decimal::ZERO {
                return Ok(None);
            }
            let distance = match position.side {
                Side::Buy => positive_decimal(position.current_price - stop),
                Side::Sell => positive_decimal(stop - position.current_price),
            };
            total += distance / instrument.price_tick * tick_value * position.quantity;
        }

        let rows = sqlx::query(
            r#"
            SELECT pending.snapshot AS pending_order, instruments.snapshot AS instrument
            FROM execution_pending_orders pending
            LEFT JOIN execution_instruments instruments
              ON instruments.user_id = pending.user_id
             AND instruments.account_id = pending.account_id
             AND instruments.venue_symbol = pending.snapshot->>'venueSymbol'
            WHERE pending.user_id = $1 AND pending.account_id = $2
            "#,
        )
        .bind(owner_uuid)
        .bind(account_id.as_str())
        .fetch_all(database)
        .await
        .map_err(|error| ApiError::database("load pending-order risk", error))?;
        for row in rows {
            let order = row
                .try_get::<sqlx::types::Json<EaPendingOrderSnapshot>, _>("pending_order")
                .map_err(|error| ApiError::database("decode pending-order risk", error))?
                .0;
            let Some(instrument) = row
                .try_get::<Option<sqlx::types::Json<InstrumentSpec>>, _>("instrument")
                .map_err(|error| ApiError::database("decode pending-order risk instrument", error))?
                .map(|value| value.0)
            else {
                return Ok(None);
            };
            let (Some(stop), Some(tick_value)) =
                (order.stop_loss, instrument.tick_value_per_quantity)
            else {
                return Ok(None);
            };
            if instrument.price_tick <= Decimal::ZERO || tick_value <= Decimal::ZERO {
                return Ok(None);
            }
            total +=
                (order.price - stop).abs() / instrument.price_tick * tick_value * order.quantity;
        }
        Ok(Some(total))
    }

    async fn evaluate_and_apply_prop_risk_guard(
        &self,
        session: &EaSession,
        account: &EaAccountSnapshot,
        positions: &[EaPositionSnapshot],
        pending_orders: &[EaPendingOrderSnapshot],
    ) -> Result<(), ApiError> {
        let Some(database) = &self.inner.database else {
            return Ok(());
        };
        let owner_uuid = parse_owner_id(&session.owner_id)?;
        let Some(mut runtime) = self
            .load_prop_risk_runtime(owner_uuid, &session.account_id, account.balance)
            .await?
        else {
            return Ok(());
        };
        let unprotected_exposure = positions
            .iter()
            .any(|position| position.stop_loss.is_none_or(|stop| stop <= Decimal::ZERO))
            || pending_orders
                .iter()
                .any(|order| order.stop_loss.is_none_or(|stop| stop <= Decimal::ZERO));
        let mut persisted = None;
        for attempt in 0..2 {
            let evaluation = evaluate_prop_risk(
                &runtime.rules,
                &runtime.actions,
                &PropRiskEvaluationInput {
                    initial_balance: runtime.initial_balance,
                    day_start_balance: runtime.day_start_balance,
                    max_loss_reference_balance: runtime.max_loss_reference_balance,
                    current_day_min_equity: runtime
                        .current_day_min_equity
                        .unwrap_or(account.equity),
                    historical_max_loss_result: runtime.historical_max_loss_result,
                    prior_positive_days_profit: runtime.prior_positive_days_profit,
                    prior_best_day_profit: runtime.prior_best_day_profit,
                    history_quality: PropRiskHistoryQuality::TrackedSinceGuardEnabled,
                    trading_days: None,
                    has_open_positions: !positions.is_empty(),
                    balance: account.balance,
                    equity: account.equity,
                    previously_locked_reason: runtime.previously_locked_reason,
                    telemetry_stale: false,
                    unprotected_exposure,
                },
            );
            let status = prop_risk_status_name(evaluation.status);
            let reason = evaluation.reason.map(prop_risk_reason_name);
            let locked = matches!(
                evaluation.status,
                PropRiskStatus::Locked | PropRiskStatus::Breached
            );
            let row = sqlx::query(
                r#"
                INSERT INTO execution_prop_risk_daily_state (
                    user_id, account_id, trading_day, day_start_balance,
                    last_balance, last_equity, min_equity, status, reason,
                    locked, evaluation, evaluated_at
                )
                VALUES ($1, $2, $3::date, $4, $5, $6, $6, $7, $8, $9, $10, now())
                ON CONFLICT (user_id, account_id, trading_day) DO UPDATE
                SET last_balance = CASE
                        WHEN execution_prop_risk_daily_state.day_start_balance =
                             EXCLUDED.day_start_balance
                         AND (
                             NOT execution_prop_risk_daily_state.locked
                             OR EXCLUDED.locked
                         )
                        THEN EXCLUDED.last_balance
                        ELSE execution_prop_risk_daily_state.last_balance
                    END,
                    last_equity = CASE
                        WHEN execution_prop_risk_daily_state.day_start_balance =
                             EXCLUDED.day_start_balance
                         AND (
                             NOT execution_prop_risk_daily_state.locked
                             OR EXCLUDED.locked
                         )
                        THEN EXCLUDED.last_equity
                        ELSE execution_prop_risk_daily_state.last_equity
                    END,
                    min_equity = CASE
                        WHEN execution_prop_risk_daily_state.day_start_balance =
                             EXCLUDED.day_start_balance
                         AND (
                             NOT execution_prop_risk_daily_state.locked
                             OR EXCLUDED.locked
                         )
                        THEN LEAST(
                            execution_prop_risk_daily_state.min_equity,
                            EXCLUDED.min_equity
                        )
                        ELSE execution_prop_risk_daily_state.min_equity
                    END,
                    status = CASE
                        WHEN execution_prop_risk_daily_state.day_start_balance =
                             EXCLUDED.day_start_balance
                         AND (
                             NOT execution_prop_risk_daily_state.locked
                             OR EXCLUDED.locked
                         )
                        THEN EXCLUDED.status
                        ELSE execution_prop_risk_daily_state.status
                    END,
                    reason = CASE
                        WHEN execution_prop_risk_daily_state.day_start_balance =
                             EXCLUDED.day_start_balance
                         AND (
                             NOT execution_prop_risk_daily_state.locked
                             OR EXCLUDED.locked
                         )
                        THEN EXCLUDED.reason
                        ELSE execution_prop_risk_daily_state.reason
                    END,
                    locked = execution_prop_risk_daily_state.locked OR (
                        execution_prop_risk_daily_state.day_start_balance =
                            EXCLUDED.day_start_balance
                        AND EXCLUDED.locked
                    ),
                    evaluation = CASE
                        WHEN execution_prop_risk_daily_state.day_start_balance =
                             EXCLUDED.day_start_balance
                         AND (
                             NOT execution_prop_risk_daily_state.locked
                             OR EXCLUDED.locked
                         )
                        THEN EXCLUDED.evaluation
                        ELSE execution_prop_risk_daily_state.evaluation
                    END,
                    evaluated_at = CASE
                        WHEN execution_prop_risk_daily_state.day_start_balance =
                             EXCLUDED.day_start_balance
                         AND (
                             NOT execution_prop_risk_daily_state.locked
                             OR EXCLUDED.locked
                         )
                        THEN now()
                        ELSE execution_prop_risk_daily_state.evaluated_at
                    END
                RETURNING day_start_balance, locked, evaluation
                "#,
            )
            .bind(owner_uuid)
            .bind(session.account_id.as_str())
            .bind(&runtime.trading_day)
            .bind(runtime.day_start_balance)
            .bind(account.balance)
            .bind(account.equity)
            .bind(status)
            .bind(reason)
            .bind(locked)
            .bind(sqlx::types::Json(&evaluation))
            .fetch_one(database)
            .await
            .map_err(|error| ApiError::database("persist prop risk evaluation", error))?;
            let persisted_day_start =
                row.try_get::<Decimal, _>("day_start_balance")
                    .map_err(|error| {
                        ApiError::database("decode persisted prop risk baseline", error)
                    })?;
            if persisted_day_start == runtime.day_start_balance {
                let persisted_locked = row.try_get::<bool, _>("locked").map_err(|error| {
                    ApiError::database("decode persisted prop risk lock", error)
                })?;
                let persisted_evaluation = row
                    .try_get::<sqlx::types::Json<PropRiskEvaluation>, _>("evaluation")
                    .map_err(|error| {
                        ApiError::database("decode persisted prop risk evaluation", error)
                    })?
                    .0;
                let persisted_status = prop_risk_status_name(persisted_evaluation.status);
                let persisted_reason = persisted_evaluation.reason.map(prop_risk_reason_name);
                persisted = Some((
                    persisted_evaluation,
                    persisted_status,
                    persisted_reason,
                    persisted_locked,
                ));
                break;
            }
            if attempt == 1 {
                return Err(ApiError::new(
                    StatusCode::CONFLICT,
                    "PROP_RISK_BASELINE_CHANGED",
                    "prop risk daily baseline changed during evaluation; retry",
                ));
            }
            runtime = self
                .load_prop_risk_runtime(owner_uuid, &session.account_id, account.balance)
                .await?
                .ok_or_else(|| {
                    ApiError::new(
                        StatusCode::CONFLICT,
                        "PROP_RISK_ASSIGNMENT_CHANGED",
                        "prop risk settings changed during evaluation; retry",
                    )
                })?;
        }
        let (evaluation, status, reason, locked) =
            persisted.expect("evaluation loop persists once");

        if locked && runtime.previously_locked_reason.is_none() {
            sqlx::query(
                r#"
                INSERT INTO execution_audit_log (
                    user_id, actor_type, actor_id, action,
                    resource_type, resource_id, details
                )
                VALUES (
                    $1, 'service', 'prop-risk-guard', 'prop_risk.locked',
                    'execution_account', $2,
                    jsonb_build_object(
                        'tradingDay', $3,
                        'status', $4,
                        'reason', $5,
                        'equity', $6::text
                    )
                )
                "#,
            )
            .bind(owner_uuid)
            .bind(session.account_id.as_str())
            .bind(&runtime.trading_day)
            .bind(status)
            .bind(reason)
            .bind(evaluation.equity)
            .execute(database)
            .await
            .map_err(|error| ApiError::database("audit prop risk lock", error))?;
        }

        if !locked {
            return Ok(());
        }
        let retry_bucket = now_ms() / 30_000;
        if evaluation.should_cancel_pending_orders {
            for order in pending_orders {
                let command_key = format!(
                    "{}:cancel:{}:{}",
                    runtime.trading_day, retry_bucket, order.broker_order_id
                );
                let command_id = format!("prop:{}", short_hash(command_key.as_bytes()));
                let command = EaCommand::CancelOrder {
                    command: CancelOrderCommand {
                        command_id: execution_domain::CommandId::new(command_id.clone()),
                        idempotency_key: IdempotencyKey::new(format!("guard:{command_id}")),
                        target_account_id: session.account_id.clone(),
                        broker_order_id: order.broker_order_id.clone(),
                    },
                };
                if let Err(error) = self.enqueue(&session.account_id, command).await {
                    warn!(
                        account_id = %session.account_id,
                        broker_order_id = %order.broker_order_id,
                        ?error,
                        "prop risk guard could not queue pending-order cancellation"
                    );
                }
            }
        }
        if evaluation.should_close_open_positions {
            for position in positions {
                let command_key = format!(
                    "{}:close:{}:{}",
                    runtime.trading_day, retry_bucket, position.broker_position_id
                );
                let command_id = format!("prop:{}", short_hash(command_key.as_bytes()));
                let command = EaCommand::ClosePosition {
                    command: ClosePositionCommand {
                        command_id: execution_domain::CommandId::new(command_id.clone()),
                        idempotency_key: IdempotencyKey::new(format!("guard:{command_id}")),
                        target_account_id: session.account_id.clone(),
                        broker_position_id: position.broker_position_id.clone(),
                        quantity: None,
                        deviation_points: 50,
                    },
                };
                if let Err(error) = self.enqueue(&session.account_id, command).await {
                    warn!(
                        account_id = %session.account_id,
                        broker_position_id = %position.broker_position_id,
                        ?error,
                        "prop risk guard could not queue emergency close"
                    );
                }
            }
        }
        Ok(())
    }

    async fn persist_database_payload(
        &self,
        session: &EaSession,
        instruments: &[EaInstrumentSnapshot],
        positions: &[EaPositionSnapshot],
        pending_orders: &[EaPendingOrderSnapshot],
        portfolio_snapshot_complete: bool,
        events: &[EaEvent],
    ) -> Result<(), ApiError> {
        let Some(database) = &self.inner.database else {
            return Ok(());
        };
        if instruments.is_empty()
            && positions.is_empty()
            && pending_orders.is_empty()
            && !portfolio_snapshot_complete
            && events.is_empty()
        {
            return Ok(());
        }
        if positions.len() > 500 || pending_orders.len() > 500 {
            return Err(ApiError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "PORTFOLIO_SNAPSHOT_TOO_LARGE",
                "portfolio snapshot exceeds the per-account safety limit",
            ));
        }
        let owner_uuid = parse_owner_id(&session.owner_id)?;
        let mut transaction = database
            .begin()
            .await
            .map_err(|error| ApiError::database("begin EA event transaction", error))?;

        if portfolio_snapshot_complete {
            self.stage_continuous_copy_changes(
                &mut transaction,
                session,
                positions,
                pending_orders,
                events,
            )
            .await?;
            self.stage_continuous_copy_protection(
                &mut transaction,
                session,
                instruments,
                positions,
                pending_orders,
            )
            .await?;
            self.stage_due_copier_reconciliations(
                &mut transaction,
                owner_uuid,
                session.account_id.as_str(),
            )
            .await?;
        }

        for instrument in instruments {
            validate_instrument_snapshot(instrument)?;
            let snapshot = serde_json::to_value(&instrument.spec)
                .map_err(|error| ApiError::internal("serialize instrument snapshot", error))?;
            sqlx::query(
                r#"
                INSERT INTO execution_instruments (
                    user_id, account_id, venue_symbol, snapshot,
                    bid, ask, observed_at
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6,
                    to_timestamp($7::double precision / 1000.0)
                )
                ON CONFLICT (user_id, account_id, venue_symbol) DO UPDATE SET
                    snapshot = EXCLUDED.snapshot,
                    bid = EXCLUDED.bid,
                    ask = EXCLUDED.ask,
                    observed_at = EXCLUDED.observed_at,
                    updated_at = now()
                WHERE execution_instruments.observed_at <= EXCLUDED.observed_at
                "#,
            )
            .bind(owner_uuid)
            .bind(session.account_id.as_str())
            .bind(instrument.spec.venue_symbol.trim())
            .bind(sqlx::types::Json(snapshot))
            .bind(instrument.bid)
            .bind(instrument.ask)
            .bind(instrument.observed_at_ms as i64)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("persist instrument snapshot", error))?;
            sqlx::query(
                r#"
                INSERT INTO execution_symbol_mappings (
                    user_id, account_id, canonical_symbol, venue_symbol,
                    mapping_source
                )
                VALUES ($1, $2, upper($3), $3, 'exact')
                ON CONFLICT DO NOTHING
                "#,
            )
            .bind(owner_uuid)
            .bind(session.account_id.as_str())
            .bind(instrument.spec.venue_symbol.trim())
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("persist exact symbol mapping", error))?;
        }

        let mut position_ids = Vec::with_capacity(positions.len());
        for position in positions {
            validate_position_snapshot(position)?;
            position_ids.push(position.broker_position_id.clone());
            let snapshot = serde_json::to_value(position)
                .map_err(|error| ApiError::internal("serialize position snapshot", error))?;
            sqlx::query(
                r#"
                INSERT INTO execution_positions (
                    user_id, account_id, broker_position_id, snapshot, observed_at
                )
                VALUES (
                    $1, $2, $3, $4,
                    to_timestamp($5::double precision / 1000.0)
                )
                ON CONFLICT (user_id, account_id, broker_position_id) DO UPDATE SET
                    snapshot = EXCLUDED.snapshot,
                    observed_at = EXCLUDED.observed_at,
                    updated_at = now()
                WHERE execution_positions.observed_at <= EXCLUDED.observed_at
                "#,
            )
            .bind(owner_uuid)
            .bind(session.account_id.as_str())
            .bind(&position.broker_position_id)
            .bind(sqlx::types::Json(snapshot))
            .bind(position.observed_at_ms as i64)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("persist position snapshot", error))?;
        }

        let mut pending_order_ids = Vec::with_capacity(pending_orders.len());
        for order in pending_orders {
            validate_pending_order_snapshot(order)?;
            pending_order_ids.push(order.broker_order_id.clone());
            let snapshot = serde_json::to_value(order)
                .map_err(|error| ApiError::internal("serialize pending order snapshot", error))?;
            sqlx::query(
                r#"
                INSERT INTO execution_pending_orders (
                    user_id, account_id, broker_order_id, snapshot, observed_at
                )
                VALUES (
                    $1, $2, $3, $4,
                    to_timestamp($5::double precision / 1000.0)
                )
                ON CONFLICT (user_id, account_id, broker_order_id) DO UPDATE SET
                    snapshot = EXCLUDED.snapshot,
                    observed_at = EXCLUDED.observed_at,
                    updated_at = now()
                WHERE execution_pending_orders.observed_at <= EXCLUDED.observed_at
                "#,
            )
            .bind(owner_uuid)
            .bind(session.account_id.as_str())
            .bind(&order.broker_order_id)
            .bind(sqlx::types::Json(snapshot))
            .bind(order.observed_at_ms as i64)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("persist pending order snapshot", error))?;
        }

        if portfolio_snapshot_complete {
            sqlx::query(
                r#"
                DELETE FROM execution_positions
                WHERE user_id = $1
                  AND account_id = $2
                  AND NOT (broker_position_id = ANY($3))
                "#,
            )
            .bind(owner_uuid)
            .bind(session.account_id.as_str())
            .bind(&position_ids)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("reconcile closed positions", error))?;
            sqlx::query(
                r#"
                DELETE FROM execution_pending_orders
                WHERE user_id = $1
                  AND account_id = $2
                  AND NOT (broker_order_id = ANY($3))
                "#,
            )
            .bind(owner_uuid)
            .bind(session.account_id.as_str())
            .bind(&pending_order_ids)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("reconcile completed orders", error))?;
        }

        // MT5 reports the broker order ticket in CommandAccepted even for a
        // market order. Position lifecycle commands require the distinct
        // broker position ticket carried by tradeTransaction telemetry.
        // Build the batch correlation up front so event ordering cannot make
        // a market link bind to the wrong identifier.
        let batch_position_by_order = events
            .iter()
            .filter_map(|event| match event {
                EaEvent::TradeTransaction {
                    broker_order_id: Some(order_id),
                    broker_position_id: Some(position_id),
                    ..
                } => Some((order_id.as_str(), position_id.as_str())),
                _ => None,
            })
            .collect::<HashMap<_, _>>();

        for event in events {
            let (
                command_id,
                terminal_status,
                broker_order_id,
                broker_deal_id,
                event_type,
                occurred_at_ms,
            ) = match event {
                EaEvent::CommandAccepted {
                    command_id,
                    broker_order_id,
                    broker_deal_id,
                    occurred_at_ms,
                    ..
                } => (
                    Some(command_id.as_str()),
                    Some("accepted"),
                    broker_order_id.as_deref(),
                    broker_deal_id.as_deref(),
                    "command.accepted",
                    *occurred_at_ms,
                ),
                EaEvent::CommandRejected {
                    command_id,
                    occurred_at_ms,
                    ..
                } => (
                    Some(command_id.as_str()),
                    Some("failed"),
                    None,
                    None,
                    "command.rejected",
                    *occurred_at_ms,
                ),
                EaEvent::CommandUnknown {
                    command_id,
                    occurred_at_ms,
                    ..
                } => (
                    Some(command_id.as_str()),
                    Some("unknown"),
                    None,
                    None,
                    "command.unknown",
                    *occurred_at_ms,
                ),
                EaEvent::TradeTransaction { occurred_at_ms, .. } => {
                    (None, None, None, None, "trade.transaction", *occurred_at_ms)
                }
            };

            if let (Some(command_id), Some(terminal_status)) = (command_id, terminal_status) {
                let update = if terminal_status == "unknown" {
                    sqlx::query(
                        r#"
                        UPDATE execution_target_commands
                        SET status = 'unknown',
                            next_attempt_at = now() + interval '30 seconds',
                            lease_owner = NULL,
                            lease_expires_at = NULL,
                            updated_at = now()
                        WHERE user_id = $1
                          AND target_account_id = $2
                          AND id = $3
                          AND terminal_ack_at IS NULL
                        "#,
                    )
                    .bind(owner_uuid)
                    .bind(session.account_id.as_str())
                    .bind(command_id)
                    .execute(&mut *transaction)
                    .await
                } else {
                    sqlx::query(
                        r#"
                        UPDATE execution_target_commands
                        SET status = $4,
                            reject_code = NULL,
                            reject_message = NULL,
                            broker_order_id = COALESCE($5, broker_order_id),
                            broker_deal_id = COALESCE($6, broker_deal_id),
                            terminal_ack_at = COALESCE(terminal_ack_at, now()),
                            lease_owner = NULL,
                            lease_expires_at = NULL,
                            updated_at = now()
                        WHERE user_id = $1
                          AND target_account_id = $2
                          AND id = $3
                          AND (
                            terminal_ack_at IS NULL OR
                            status = $4 OR
                            (status = 'failed' AND reject_code = 'DELIVERY_EXPIRED')
                          )
                        "#,
                    )
                    .bind(owner_uuid)
                    .bind(session.account_id.as_str())
                    .bind(command_id)
                    .bind(terminal_status)
                    .bind(broker_order_id)
                    .bind(broker_deal_id)
                    .execute(&mut *transaction)
                    .await
                }
                .map_err(|error| ApiError::database("acknowledge EA command", error))?;
                if update.rows_affected() != 1 {
                    return Err(ApiError::new(
                        StatusCode::CONFLICT,
                        "COMMAND_EVENT_INVALID",
                        "command event is unknown, cross-account, or conflicts with prior outcome",
                    ));
                }

                if terminal_status != "unknown" {
                    sqlx::query(
                        r#"
                    UPDATE execution_commands parent
                    SET status = CASE
                        WHEN EXISTS (
                            SELECT 1 FROM execution_target_commands target
                            WHERE target.user_id = parent.user_id
                              AND target.parent_command_id = parent.id
                              AND target.terminal_ack_at IS NULL
                        ) THEN 'submitted'
                        WHEN EXISTS (
                            SELECT 1 FROM execution_target_commands target
                            WHERE target.user_id = parent.user_id
                              AND target.parent_command_id = parent.id
                              AND target.status = 'failed'
                        ) THEN 'partially_rejected'
                        ELSE 'completed'
                    END,
                    updated_at = now()
                    WHERE user_id = $1
                      AND id = (
                        SELECT parent_command_id
                        FROM execution_target_commands
                        WHERE user_id = $1 AND id = $2
                      )
                        "#,
                    )
                    .bind(owner_uuid)
                    .bind(command_id)
                    .execute(&mut *transaction)
                    .await
                    .map_err(|error| ApiError::database("update parent command outcome", error))?;
                }

                let broker_position_id = if terminal_status == "accepted" {
                    if let Some(position_id) = broker_order_id
                        .and_then(|order_id| batch_position_by_order.get(order_id).copied())
                    {
                        Some(position_id.to_owned())
                    } else if let Some(order_id) = broker_order_id {
                        // The transaction can arrive in an earlier heartbeat
                        // than the command acknowledgement. Reuse its durable
                        // event record instead of ever treating an order
                        // ticket as a position ticket.
                        sqlx::query_scalar::<_, String>(
                            r#"
                            SELECT payload->>'brokerPositionId'
                            FROM execution_events
                            WHERE user_id = $1 AND account_id = $2
                              AND event_type = 'trade.transaction'
                              AND payload->>'brokerOrderId' = $3
                              AND NULLIF(payload->>'brokerPositionId', '') IS NOT NULL
                            ORDER BY occurred_at DESC, id DESC
                            LIMIT 1
                            "#,
                        )
                        .bind(owner_uuid)
                        .bind(session.account_id.as_str())
                        .bind(order_id)
                        .fetch_optional(&mut *transaction)
                        .await
                        .map_err(|error| {
                            ApiError::database("resolve copier broker position", error)
                        })?
                    } else {
                        None
                    }
                } else {
                    None
                };

                // Continuous-copy outbox/link acknowledgement is coupled to
                // the same EA event transaction. This makes a broker ack
                // replay-safe and binds the broker ticket to the durable leg
                // before a later partial-close or protection event arrives.
                sqlx::query(
                    r#"
                    UPDATE execution_copy_command_outbox outbox
                    SET status = CASE
                            WHEN $3 = 'accepted' THEN 'acknowledged'
                            WHEN $3 = 'unknown' THEN 'retry'
                            ELSE 'dead_letter'
                        END,
                        target_command_id = COALESCE(outbox.target_command_id, $2),
                        acknowledged_at = CASE WHEN $3 = 'accepted' THEN COALESCE(outbox.acknowledged_at, now()) ELSE outbox.acknowledged_at END,
                        available_at = CASE WHEN $3 = 'unknown' THEN now() + interval '30 seconds' ELSE outbox.available_at END,
                        last_error = CASE WHEN $3 = 'accepted' THEN NULL ELSE 'EA command outcome: ' || $3 END,
                        updated_at = now()
                    WHERE outbox.user_id = $1
                      AND outbox.target_command_id = $2
                    "#,
                )
                .bind(owner_uuid)
                .bind(command_id)
                .bind(terminal_status)
                .execute(&mut *transaction)
                .await
                .map_err(|error| ApiError::database("update copier outbox outcome", error))?;
                sqlx::query(
                    r#"
                    UPDATE execution_copy_links links
                    SET target_entity_kind = CASE
                            WHEN $4 = 'accepted'
                             AND outbox.command_type IN ('place', 'open_market')
                             AND COALESCE(
                                 links.target_entity_id,
                                 CASE
                                     WHEN COALESCE(
                                         links.target_entity_kind,
                                         links.metadata->>'expectedTargetKind'
                                     ) = 'position' THEN $5
                                     ELSE $3
                                 END
                             ) IS NOT NULL
                            THEN COALESCE(
                                links.target_entity_kind,
                                links.metadata->>'expectedTargetKind'
                            )
                            ELSE links.target_entity_kind
                        END,
                        target_entity_id = COALESCE(
                            links.target_entity_id,
                            CASE
                                WHEN COALESCE(
                                    links.target_entity_kind,
                                    links.metadata->>'expectedTargetKind'
                                ) = 'position' THEN $5
                                ELSE $3
                            END
                        ),
                        lifecycle_status = CASE
                            WHEN $4 <> 'accepted' THEN 'error'
                            WHEN outbox.command_type IN ('place', 'open_market')
                             AND COALESCE(
                                 links.target_entity_id,
                                 CASE
                                     WHEN COALESCE(
                                         links.target_entity_kind,
                                         links.metadata->>'expectedTargetKind'
                                     ) = 'position' THEN $5
                                     ELSE $3
                                 END
                             ) IS NOT NULL THEN 'active'
                            WHEN outbox.command_type = 'close_position' THEN 'closed'
                            WHEN outbox.command_type = 'cancel_pending' THEN 'cancelled'
                            ELSE links.lifecycle_status
                        END,
                        source_quantity = CASE
                            WHEN $4 = 'accepted' AND outbox.command_type = 'partial_close'
                            THEN COALESCE(
                                NULLIF(outbox.command_payload->>'copierSourceRemaining', '')::numeric,
                                links.source_quantity
                            )
                            ELSE links.source_quantity
                        END,
                        target_quantity = CASE
                            WHEN $4 = 'accepted' AND outbox.command_type = 'partial_close'
                            THEN COALESCE(
                                NULLIF(outbox.command_payload->>'copierTargetRemaining', '')::numeric,
                                links.target_quantity
                            )
                            ELSE links.target_quantity
                        END,
                        closed_at = CASE
                            WHEN $4 = 'accepted' AND outbox.command_type IN ('close_position', 'cancel_pending')
                            THEN COALESCE(links.closed_at, now())
                            ELSE links.closed_at
                        END,
                        last_target_event_id = COALESCE(links.last_target_event_id, $2),
                        revision = links.revision + 1,
                        updated_at = now()
                    FROM execution_copy_command_outbox outbox
                    WHERE outbox.user_id = $1
                      AND outbox.target_command_id = $2
                      AND links.user_id = outbox.user_id
                      AND links.group_id = outbox.group_id
                      AND links.target_account_id = outbox.target_account_id
                      AND (
                          links.metadata->>'commandId' = $2 OR
                          links.metadata->>'lastCommandId' = $2
                      )
                    "#,
                )
                .bind(owner_uuid)
                .bind(command_id)
                .bind(broker_order_id)
                .bind(terminal_status)
                .bind(broker_position_id.as_deref())
                .execute(&mut *transaction)
                .await
                .map_err(|error| ApiError::database("update copier link outcome", error))?;
            }

            if let EaEvent::TradeTransaction {
                broker_order_id: Some(order_id),
                broker_position_id: Some(position_id),
                ..
            } = event
            {
                // A trade transaction can arrive after its acknowledgement.
                // Correlate it through the durable target command so market
                // links converge even when the two signals cross heartbeats.
                sqlx::query(
                    r#"
                    UPDATE execution_copy_links links
                    SET target_entity_kind = 'position',
                        target_entity_id = $4,
                        lifecycle_status = 'active',
                        last_target_event_id = COALESCE($5, links.last_target_event_id),
                        opened_at = COALESCE(links.opened_at, now()),
                        revision = links.revision + 1,
                        updated_at = now()
                    FROM execution_copy_command_outbox outbox
                    JOIN execution_target_commands commands
                      ON commands.user_id = outbox.user_id
                     AND commands.id = outbox.target_command_id
                    WHERE links.user_id = $1
                      AND links.target_account_id = $2
                      AND commands.target_account_id = $2
                      AND commands.broker_order_id = $3
                      AND outbox.command_type IN ('place', 'open_market')
                      AND links.user_id = outbox.user_id
                      AND links.group_id = outbox.group_id
                      AND links.target_account_id = outbox.target_account_id
                      AND links.metadata->>'expectedTargetKind' = 'position'
                      AND (
                          links.metadata->>'commandId' = commands.id OR
                          links.metadata->>'lastCommandId' = commands.id
                      )
                      AND links.lifecycle_status NOT IN ('closed', 'cancelled', 'orphaned')
                      AND links.last_target_event_id IS DISTINCT FROM $5
                    "#,
                )
                .bind(owner_uuid)
                .bind(session.account_id.as_str())
                .bind(order_id)
                .bind(position_id)
                .bind(event_identity(event))
                .execute(&mut *transaction)
                .await
                .map_err(|error| ApiError::database("correlate copier trade transaction", error))?;
            }

            let payload = serde_json::to_value(event)
                .map_err(|error| ApiError::internal("serialize EA event", error))?;
            let external_event_id = event_identity(event);
            sqlx::query(
                r#"
                INSERT INTO execution_events (
                    user_id, account_id, target_command_id, external_event_id,
                    event_type, payload, occurred_at
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6,
                    to_timestamp($7::double precision / 1000.0)
                )
                ON CONFLICT (account_id, external_event_id)
                    WHERE external_event_id IS NOT NULL
                DO NOTHING
                "#,
            )
            .bind(owner_uuid)
            .bind(session.account_id.as_str())
            .bind(command_id)
            .bind(external_event_id)
            .bind(event_type)
            .bind(sqlx::types::Json(payload))
            .bind(occurred_at_ms as i64)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("persist EA event", error))?;
        }

        transaction
            .commit()
            .await
            .map_err(|error| ApiError::database("commit EA events", error))?;

        // Drain only after the source snapshot/event transaction is durable. A
        // failed drain is deliberately retained in the work ledger and retried
        // by the next heartbeat/reconciliation pass.
        if portfolio_snapshot_complete || !events.is_empty() {
            // Apply the lifecycle event first so reconciliation observes links
            // in their expected `closing`/`pending` state instead of staging a
            // duplicate repair for the same source transition.
            if let Err(error) = self.process_continuous_copier_work(owner_uuid).await {
                warn!(%error.body.message, code = error.body.code, "continuous copier drain deferred");
            }
            if let Err(error) = self
                .process_continuous_copier_reconciliations(owner_uuid)
                .await
            {
                warn!(%error.body.message, code = error.body.code, "continuous copier reconciliation deferred");
            }
            // Reconciliation can stage targeted repairs; drain those without
            // waiting for another EA heartbeat.
            if let Err(error) = self.process_continuous_copier_work(owner_uuid).await {
                warn!(%error.body.message, code = error.body.code, "continuous copier repair drain deferred");
            }
        }
        Ok(())
    }

    async fn stage_continuous_copy_changes(
        &self,
        transaction: &mut sqlx_postgres::PgConnection,
        session: &EaSession,
        positions: &[EaPositionSnapshot],
        pending_orders: &[EaPendingOrderSnapshot],
        events: &[EaEvent],
    ) -> Result<(), ApiError> {
        let owner_uuid = parse_owner_id(&session.owner_id)?;
        let group_rows = sqlx::query(
            r#"
            SELECT id, configuration, runtime_status
            FROM execution_copy_groups
            WHERE user_id = $1 AND source_account_id = $2 AND enabled = true
              AND runtime_status <> 'error'
            ORDER BY id
            FOR SHARE
            "#,
        )
        .bind(owner_uuid)
        .bind(session.account_id.as_str())
        .fetch_all(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("load active copier groups", error))?;
        if group_rows.is_empty() {
            return Ok(());
        }
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!("{}:{}", owner_uuid, session.account_id))
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("lock copier source snapshot", error))?;
        let previous_position_rows = sqlx::query(
            r#"
            SELECT snapshot FROM execution_positions
            WHERE user_id = $1 AND account_id = $2
            ORDER BY broker_position_id
            "#,
        )
        .bind(owner_uuid)
        .bind(session.account_id.as_str())
        .fetch_all(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("load prior source positions", error))?;
        let previous_pending_rows = sqlx::query(
            r#"
            SELECT snapshot FROM execution_pending_orders
            WHERE user_id = $1 AND account_id = $2
            ORDER BY broker_order_id
            "#,
        )
        .bind(owner_uuid)
        .bind(session.account_id.as_str())
        .fetch_all(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("load prior source pending orders", error))?;
        let previous_positions = previous_position_rows
            .into_iter()
            .map(|row| {
                row.try_get::<sqlx::types::Json<EaPositionSnapshot>, _>("snapshot")
                    .map(|value| value.0)
                    .map_err(|error| ApiError::database("decode prior source position", error))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let previous_pending = previous_pending_rows
            .into_iter()
            .map(|row| {
                row.try_get::<sqlx::types::Json<EaPendingOrderSnapshot>, _>("snapshot")
                    .map(|value| value.0)
                    .map_err(|error| ApiError::database("decode prior source pending order", error))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let pending_fill_positions = events
            .iter()
            .filter_map(|event| match event {
                EaEvent::TradeTransaction {
                    broker_order_id: Some(order_id),
                    broker_position_id: Some(position_id),
                    ..
                } => Some((order_id.clone(), position_id.clone())),
                _ => None,
            })
            .collect::<BTreeMap<_, _>>();
        let changes = diff_portfolio(
            &previous_positions,
            &previous_pending,
            positions,
            pending_orders,
            &pending_fill_positions,
        );
        if changes.is_empty() {
            return Ok(());
        }

        for group_row in group_rows {
            let group_id: Uuid = group_row
                .try_get("id")
                .map_err(|error| ApiError::database("decode active copier group id", error))?;
            let group_config = group_row
                .try_get::<sqlx::types::Json<ContinuousCopyConfig>, _>("configuration")
                .map(|value| value.0)
                .unwrap_or_default();
            let group_runtime_status: String = group_row
                .try_get("runtime_status")
                .map_err(|error| ApiError::database("decode copier group runtime status", error))?;
            let target_rows = sqlx::query(
                r#"
                SELECT account_id, configuration
                FROM execution_copy_targets
                WHERE user_id = $1 AND group_id = $2 AND enabled = true
                ORDER BY account_id
                "#,
            )
            .bind(owner_uuid)
            .bind(group_id)
            .fetch_all(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("load active copier targets", error))?;
            for change in &changes {
                if !copy_change_allowed(change, &group_config) {
                    continue;
                }
                if group_runtime_status == "paused" && !copy_change_allowed_while_paused(change) {
                    continue;
                }
                let change_json = serde_json::to_value(change)
                    .map_err(|error| ApiError::internal("serialize copier source change", error))?;
                let source_payload = serde_json::to_vec(change)
                    .map_err(|error| ApiError::internal("hash copier source change", error))?;
                let source_identity = format!(
                    "{}:{}:{}:{}:{}",
                    group_id,
                    session.account_id,
                    change.kind(),
                    change.source_resource_id(),
                    short_hash(&source_payload)
                );
                let source_event_id =
                    format!("snapshot:{}", short_hash(source_identity.as_bytes()));
                let inbox_id = sqlx::query_scalar::<_, Uuid>(
                    r#"
                    INSERT INTO execution_copy_lifecycle_inbox (
                        user_id, group_id, source_account_id, source_event_id,
                        event_type, source_entity_kind, source_entity_id,
                        payload, occurred_at
                    )
                    VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8,
                        to_timestamp($9::double precision / 1000.0)
                    )
                    ON CONFLICT (user_id, group_id, source_account_id, source_event_id)
                    DO NOTHING
                    RETURNING id
                    "#,
                )
                .bind(owner_uuid)
                .bind(group_id)
                .bind(session.account_id.as_str())
                .bind(&source_event_id)
                .bind(change.kind())
                .bind(copy_source_entity_kind(change))
                .bind(change.source_resource_id())
                .bind(sqlx::types::Json(change_json))
                .bind(change.observed_at_ms().max(1) as i64)
                .fetch_optional(&mut *transaction)
                .await
                .map_err(|error| ApiError::database("stage copier lifecycle inbox", error))?;
                let Some(inbox_id) = inbox_id else {
                    continue;
                };
                let operations =
                    copy_work_operations_for_runtime(change, &group_config, &group_runtime_status);
                let mut staged_count = 0usize;
                for target_row in &target_rows {
                    let target_account_id: String =
                        target_row.try_get("account_id").map_err(|error| {
                            ApiError::database("decode active copier target account", error)
                        })?;
                    let config_value = target_row
                        .try_get::<sqlx::types::Json<serde_json::Value>, _>("configuration")
                        .map_err(|error| {
                            ApiError::database("decode active copier target config", error)
                        })?
                        .0;
                    let target_config =
                        serde_json::from_value::<ContinuousCopyTargetConfig>(config_value)
                            .unwrap_or_else(|_| legacy_copy_target_config(target_row));
                    self.supersede_unissued_copier_predecessors(
                        transaction,
                        owner_uuid,
                        group_id,
                        &target_account_id,
                        change,
                    )
                    .await?;
                    for (operation_index, operation) in operations.iter().enumerate() {
                        let target_legs = self
                            .copier_work_target_legs(
                                transaction,
                                owner_uuid,
                                group_id,
                                &target_account_id,
                                change,
                                operation,
                            )
                            .await?;
                        for target_leg in target_legs {
                            let work_payload = CopierWorkPayload {
                                change: change.clone(),
                                source_account_id: Some(session.account_id.clone()),
                                group_config: group_config.clone(),
                                target_config: target_config.clone(),
                                target_leg,
                                phase: None,
                            };
                            let payload = serde_json::to_value(work_payload).map_err(|error| {
                                ApiError::internal("serialize copier work payload", error)
                            })?;
                            let work_identity = format!(
                                "{}:{}:{}:{}:{}:{:?}",
                                group_id,
                                target_account_id,
                                source_event_id,
                                operation,
                                operation_index,
                                target_leg
                            );
                            let idempotency_key =
                                format!("cpw:{}", short_hash(work_identity.as_bytes()));
                            let inserted = sqlx::query(
                                r#"
                            INSERT INTO execution_copy_work_items (
                                user_id, group_id, target_account_id, inbox_event_id,
                                operation, idempotency_key, payload
                            )
                            VALUES ($1, $2, $3, $4, $5, $6, $7)
                            ON CONFLICT (user_id, group_id, target_account_id, idempotency_key)
                            DO NOTHING
                            "#,
                            )
                            .bind(owner_uuid)
                            .bind(group_id)
                            .bind(&target_account_id)
                            .bind(inbox_id)
                            .bind(*operation)
                            .bind(&idempotency_key)
                            .bind(sqlx::types::Json(payload))
                            .execute(&mut *transaction)
                            .await
                            .map_err(|error| ApiError::database("stage copier work item", error))?;
                            staged_count += inserted.rows_affected() as usize;
                        }
                    }
                }
                sqlx::query(
                    r#"
                    UPDATE execution_copy_lifecycle_inbox
                    SET status = $3,
                        processed_at = now(),
                        lease_owner = NULL,
                        lease_expires_at = NULL
                    WHERE user_id = $1 AND id = $2
                    "#,
                )
                .bind(owner_uuid)
                .bind(inbox_id)
                .bind(if staged_count > 0 {
                    "processed"
                } else {
                    "ignored"
                })
                .execute(&mut *transaction)
                .await
                .map_err(|error| ApiError::database("finalize copier lifecycle inbox", error))?;
            }
            sqlx::query(
                r#"
                UPDATE execution_copy_groups
                SET runtime_status = CASE
                        WHEN runtime_status = 'paused' THEN 'paused'
                        ELSE 'active'
                    END,
                    status_message = CASE
                        WHEN runtime_status = 'paused' THEN status_message
                        ELSE NULL
                    END,
                    last_event_at = now(),
                    updated_at = now()
                WHERE user_id = $1 AND id = $2 AND enabled = true
                "#,
            )
            .bind(owner_uuid)
            .bind(group_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("activate copier group runtime", error))?;
        }
        Ok(())
    }

    async fn supersede_unissued_copier_predecessors(
        &self,
        transaction: &mut sqlx_postgres::PgConnection,
        owner_uuid: Uuid,
        group_id: Uuid,
        target_account_id: &str,
        change: &PortfolioChange,
    ) -> Result<(), ApiError> {
        let predecessor_operation = match change {
            PortfolioChange::PositionClosed { .. } => "open_market",
            PortfolioChange::PendingReplaced { .. }
            | PortfolioChange::PendingCancelled { .. }
            | PortfolioChange::PendingFilled { .. } => "place_pending",
            _ => return Ok(()),
        };
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!(
                "continuous-copier-target:{owner_uuid}:{group_id}:{target_account_id}"
            ))
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("lock obsolete copier predecessor", error))?;
        let reason = format!(
            "superseded because source lifecycle advanced to {} before durable enqueue",
            change.kind()
        );
        sqlx::query(
            r#"
            WITH superseded_work AS (
                UPDATE execution_copy_work_items work
                SET status = 'superseded',
                    completed_at = COALESCE(completed_at, now()),
                    last_error = $8,
                    lease_owner = NULL,
                    lease_expires_at = NULL,
                    updated_at = now()
                FROM execution_copy_lifecycle_inbox prior_inbox
                WHERE work.user_id = $1
                  AND work.group_id = $2
                  AND work.target_account_id = $3
                  AND work.inbox_event_id = prior_inbox.id
                  AND prior_inbox.user_id = work.user_id
                  AND prior_inbox.group_id = work.group_id
                  AND prior_inbox.source_entity_kind = $4
                  AND prior_inbox.source_entity_id = $5
                  AND work.operation = $6
                  AND work.status IN ('pending', 'leased', 'retry')
                  AND NOT EXISTS (
                      SELECT 1
                      FROM execution_copy_command_outbox issued_outbox
                      JOIN execution_target_commands issued_command
                        ON issued_command.user_id = issued_outbox.user_id
                       AND issued_command.id = COALESCE(
                           issued_outbox.target_command_id,
                           issued_outbox.command_payload #>> '{order,commandId}',
                           issued_outbox.command_payload #>> '{command,commandId}'
                       )
                      WHERE issued_outbox.user_id = work.user_id
                        AND issued_outbox.work_item_id = work.id
                  )
                RETURNING work.id
            ), dead_lettered_outbox AS (
                UPDATE execution_copy_command_outbox outbox
                SET status = 'dead_letter',
                    last_error = $8,
                    lease_owner = NULL,
                    lease_expires_at = NULL,
                    updated_at = now()
                FROM superseded_work
                WHERE outbox.user_id = $1
                  AND outbox.work_item_id = superseded_work.id
                  AND outbox.status <> 'acknowledged'
                RETURNING outbox.work_item_id
            )
            UPDATE execution_copy_links links
            SET lifecycle_status = 'cancelled',
                closed_at = COALESCE(closed_at, now()),
                last_source_event_id = $7,
                metadata = metadata || jsonb_build_object('supersededReason', $8),
                revision = revision + 1,
                updated_at = now()
            FROM superseded_work
            WHERE links.user_id = $1
              AND links.group_id = $2
              AND links.target_account_id = $3
              AND links.metadata->>'workItemId' = superseded_work.id::text
              AND links.lifecycle_status = 'pending'
              AND links.target_entity_id IS NULL
            "#,
        )
        .bind(owner_uuid)
        .bind(group_id)
        .bind(target_account_id)
        .bind(copy_source_entity_kind(change))
        .bind(change.source_resource_id())
        .bind(predecessor_operation)
        .bind(change.kind())
        .bind(&reason)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("supersede obsolete copier predecessor", error))?;
        Ok(())
    }

    async fn copier_work_target_legs(
        &self,
        transaction: &mut sqlx_postgres::PgConnection,
        owner_uuid: Uuid,
        group_id: Uuid,
        target_account_id: &str,
        change: &PortfolioChange,
        operation: &str,
    ) -> Result<Vec<Option<i32>>, ApiError> {
        if !matches!(
            operation,
            "modify_position"
                | "modify_pending"
                | "partial_close"
                | "close_position"
                | "cancel_pending"
                | "reconcile"
        ) {
            return Ok(vec![None]);
        }
        let legs = sqlx::query_scalar::<_, i32>(if operation == "partial_close" {
            r#"
            SELECT target_leg
            FROM execution_copy_links
            WHERE user_id = $1 AND group_id = $2 AND target_account_id = $3
              AND source_entity_kind = $4 AND source_entity_id = $5
              AND lifecycle_status NOT IN ('closed', 'cancelled', 'orphaned')
            ORDER BY target_leg
            "#
        } else {
            // Netting accounts can have several source contribution legs
            // pointing at one broker ticket. A full close/cancel/modify must
            // be issued once per distinct target entity, while hedging
            // accounts still receive one command for every distinct ticket.
            r#"
            SELECT min(target_leg) AS target_leg
            FROM execution_copy_links
            WHERE user_id = $1 AND group_id = $2 AND target_account_id = $3
              AND source_entity_kind = $4 AND source_entity_id = $5
              AND lifecycle_status NOT IN ('closed', 'cancelled', 'orphaned')
            GROUP BY CASE
                WHEN target_entity_id IS NULL THEN '__leg__:' || target_leg::text
                ELSE COALESCE(target_entity_kind, '') || ':' || target_entity_id
            END
            ORDER BY min(target_leg)
            "#
        })
        .bind(owner_uuid)
        .bind(group_id)
        .bind(target_account_id)
        .bind(copy_source_entity_kind(change))
        .bind(change.source_resource_id())
        .fetch_all(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("load copier target legs", error))?;
        if legs.is_empty() {
            Ok(vec![None])
        } else {
            Ok(legs.into_iter().map(Some).collect())
        }
    }

    async fn stage_continuous_copy_protection(
        &self,
        transaction: &mut sqlx_postgres::PgConnection,
        session: &EaSession,
        instruments: &[EaInstrumentSnapshot],
        positions: &[EaPositionSnapshot],
        pending_orders: &[EaPendingOrderSnapshot],
    ) -> Result<(), ApiError> {
        let owner_uuid = parse_owner_id(&session.owner_id)?;
        let rows = sqlx::query(
            r#"
            SELECT
                links.group_id, links.source_account_id,
                links.source_entity_id,
                links.target_entity_kind, links.target_entity_id,
                links.target_leg,
                groups.configuration AS group_configuration,
                targets.configuration AS target_configuration,
                targets.allocation_mode, targets.multiplier,
                targets.risk_basis_points, targets.max_quantity,
                targets.fixed_quantity, targets.allocation_unit,
                accounts.balance, accounts.equity
            FROM execution_copy_links links
            JOIN execution_copy_groups groups
              ON groups.user_id = links.user_id AND groups.id = links.group_id
            JOIN execution_copy_targets targets
              ON targets.user_id = links.user_id
             AND targets.group_id = links.group_id
             AND targets.account_id = links.target_account_id
            JOIN execution_accounts accounts
              ON accounts.user_id = links.user_id AND accounts.id = links.target_account_id
            WHERE links.user_id = $1 AND links.target_account_id = $2
              AND links.lifecycle_status IN ('pending', 'active')
              AND links.target_entity_id IS NOT NULL
              AND groups.enabled = true
              AND groups.runtime_status <> 'error'
              AND targets.enabled = true
            ORDER BY links.group_id, links.source_entity_kind,
                     links.source_entity_id, links.target_leg
            "#,
        )
        .bind(owner_uuid)
        .bind(session.account_id.as_str())
        .fetch_all(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("load target-local copier protections", error))?;
        if rows.is_empty() {
            return Ok(());
        }

        let mut instrument_specs = HashMap::<String, InstrumentSpec>::new();
        let persisted_instruments = sqlx::query(
            r#"
            SELECT venue_symbol, snapshot
            FROM execution_instruments
            WHERE user_id = $1 AND account_id = $2
            "#,
        )
        .bind(owner_uuid)
        .bind(session.account_id.as_str())
        .fetch_all(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("load target protection instruments", error))?;
        for row in persisted_instruments {
            let venue_symbol: String = row.try_get("venue_symbol").map_err(|error| {
                ApiError::database("decode target protection instrument symbol", error)
            })?;
            let spec = row
                .try_get::<sqlx::types::Json<InstrumentSpec>, _>("snapshot")
                .map_err(|error| ApiError::database("decode target protection instrument", error))?
                .0;
            instrument_specs.insert(venue_symbol.to_uppercase(), spec);
        }
        for instrument in instruments {
            instrument_specs.insert(
                instrument.spec.venue_symbol.to_uppercase(),
                instrument.spec.clone(),
            );
        }
        let position_by_id = positions
            .iter()
            .map(|position| (position.broker_position_id.as_str(), position))
            .collect::<HashMap<_, _>>();
        let pending_by_id = pending_orders
            .iter()
            .map(|order| (order.broker_order_id.as_str(), order))
            .collect::<HashMap<_, _>>();

        for row in rows {
            let group_id: Uuid = row
                .try_get("group_id")
                .map_err(|error| ApiError::database("decode protection group", error))?;
            let source_account_id: String = row
                .try_get("source_account_id")
                .map_err(|error| ApiError::database("decode protection source account", error))?;
            let source_entity_id: String = row
                .try_get("source_entity_id")
                .map_err(|error| ApiError::database("decode protection source id", error))?;
            let target_entity_kind: String = row
                .try_get("target_entity_kind")
                .map_err(|error| ApiError::database("decode protection target kind", error))?;
            let target_entity_id: String = row
                .try_get("target_entity_id")
                .map_err(|error| ApiError::database("decode protection target id", error))?;
            let target_leg: i32 = row
                .try_get("target_leg")
                .map_err(|error| ApiError::database("decode protection target leg", error))?;
            let group_config = row
                .try_get::<sqlx::types::Json<ContinuousCopyConfig>, _>("group_configuration")
                .map(|value| value.0)
                .unwrap_or_default();
            let target_config_value = row
                .try_get::<sqlx::types::Json<serde_json::Value>, _>("target_configuration")
                .map_err(|error| {
                    ApiError::database("decode target protection configuration", error)
                })?
                .0;
            let target_config =
                serde_json::from_value::<ContinuousCopyTargetConfig>(target_config_value)
                    .unwrap_or_else(|_| legacy_copy_target_config(&row));
            let balance = row
                .try_get::<Option<Decimal>, _>("balance")
                .map_err(|error| ApiError::database("decode protection balance", error))?;
            let equity = row
                .try_get::<Option<Decimal>, _>("equity")
                .map_err(|error| ApiError::database("decode protection equity", error))?;
            let drawdown_breached = target_config
                .protection
                .max_drawdown_basis_points
                .is_some_and(|limit| copier_drawdown_breached(balance, equity, limit));

            let generated = match target_entity_kind.as_str() {
                "position" => {
                    let Some(position) = position_by_id.get(target_entity_id.as_str()) else {
                        continue;
                    };
                    let mut source_position = (*position).clone();
                    source_position.broker_position_id = source_entity_id.clone();
                    if drawdown_breached {
                        Some((
                            PortfolioChange::PositionClosed {
                                previous: source_position,
                            },
                            "close_position",
                            "max_drawdown",
                        ))
                    } else {
                        let spec = instrument_specs.get(&position.venue_symbol.to_uppercase());
                        let Some(desired_stop) = spec.and_then(|spec| {
                            copier_target_protection_stop(
                                position,
                                spec.price_tick,
                                &target_config.protection,
                            )
                        }) else {
                            continue;
                        };
                        let previous = source_position.clone();
                        source_position.stop_loss = Some(desired_stop);
                        Some((
                            PortfolioChange::PositionProtectionChanged {
                                previous,
                                current: source_position,
                            },
                            "modify_position",
                            "target_protection",
                        ))
                    }
                }
                "pending_order" if drawdown_breached => {
                    let Some(order) = pending_by_id.get(target_entity_id.as_str()) else {
                        continue;
                    };
                    let mut source_order = (*order).clone();
                    source_order.broker_order_id = source_entity_id.clone();
                    Some((
                        PortfolioChange::PendingCancelled {
                            previous: source_order,
                        },
                        "cancel_pending",
                        "max_drawdown",
                    ))
                }
                _ => None,
            };
            let Some((change, operation, phase)) = generated else {
                continue;
            };
            self.stage_generated_copier_work(
                transaction,
                owner_uuid,
                group_id,
                &source_account_id,
                session.account_id.as_str(),
                target_leg,
                change,
                operation,
                phase,
                group_config,
                target_config,
            )
            .await?;
            if drawdown_breached {
                sqlx::query(
                    r#"
                    UPDATE execution_copy_targets
                    SET runtime_status = 'degraded',
                        status_message = 'Target maximum drawdown protection is reducing exposure',
                        updated_at = now()
                    WHERE user_id = $1 AND group_id = $2 AND account_id = $3
                    "#,
                )
                .bind(owner_uuid)
                .bind(group_id)
                .bind(session.account_id.as_str())
                .execute(&mut *transaction)
                .await
                .map_err(|error| ApiError::database("mark target drawdown protection", error))?;
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments, clippy::collapsible_if)]
    async fn stage_generated_copier_work(
        &self,
        transaction: &mut sqlx_postgres::PgConnection,
        owner_uuid: Uuid,
        group_id: Uuid,
        source_account_id: &str,
        target_account_id: &str,
        target_leg: i32,
        change: PortfolioChange,
        operation: &'static str,
        phase: &'static str,
        group_config: ContinuousCopyConfig,
        target_config: ContinuousCopyTargetConfig,
    ) -> Result<(), ApiError> {
        let serialized_change = serde_json::to_value(&change)
            .map_err(|error| ApiError::internal("serialize generated copier change", error))?;
        let identity = serde_json::to_vec(&serialized_change)
            .map_err(|error| ApiError::internal("hash generated copier change", error))?;
        let source_event_id = format!(
            "{}:{}",
            phase,
            short_hash(
                format!(
                    "{}:{}:{}:{}:{}",
                    group_id,
                    target_account_id,
                    operation,
                    target_leg,
                    short_hash(&identity)
                )
                .as_bytes()
            )
        );
        let inbox_id = sqlx::query_scalar::<_, Uuid>(
            r#"
            INSERT INTO execution_copy_lifecycle_inbox (
                user_id, group_id, source_account_id, source_event_id,
                event_type, source_entity_kind, source_entity_id,
                payload, status, occurred_at, processed_at
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                'processed', to_timestamp($9::double precision / 1000.0), now()
            )
            ON CONFLICT (user_id, group_id, source_account_id, source_event_id)
            DO NOTHING
            RETURNING id
            "#,
        )
        .bind(owner_uuid)
        .bind(group_id)
        .bind(source_account_id)
        .bind(&source_event_id)
        .bind(format!("protection.{phase}"))
        .bind(copy_source_entity_kind(&change))
        .bind(change.source_resource_id())
        .bind(sqlx::types::Json(serialized_change))
        .bind(change.observed_at_ms().max(1) as i64)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("stage generated copier inbox", error))?;
        let Some(inbox_id) = inbox_id else {
            return Ok(());
        };
        let payload = CopierWorkPayload {
            change,
            source_account_id: Some(AccountId::new(source_account_id.to_owned())),
            group_config,
            target_config,
            target_leg: Some(target_leg),
            phase: Some(phase.to_owned()),
        };
        let work_identity = format!(
            "{}:{}:{}:{}",
            source_event_id, target_account_id, operation, target_leg
        );
        sqlx::query(
            r#"
            INSERT INTO execution_copy_work_items (
                user_id, group_id, target_account_id, inbox_event_id,
                operation, idempotency_key, payload
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (user_id, group_id, target_account_id, idempotency_key)
            DO NOTHING
            "#,
        )
        .bind(owner_uuid)
        .bind(group_id)
        .bind(target_account_id)
        .bind(inbox_id)
        .bind(operation)
        .bind(format!("cpw:{}", short_hash(work_identity.as_bytes())))
        .bind(sqlx::types::Json(serde_json::to_value(payload).map_err(
            |error| ApiError::internal("serialize generated copier work", error),
        )?))
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("stage generated copier work", error))?;
        Ok(())
    }

    async fn stage_due_copier_reconciliations(
        &self,
        transaction: &mut sqlx_postgres::PgConnection,
        owner_uuid: Uuid,
        account_id: &str,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            INSERT INTO execution_copy_reconciliation_runs (
                user_id, group_id, trigger_kind, group_revision
            )
            SELECT groups.user_id, groups.id, 'scheduled', groups.revision
            FROM execution_copy_groups groups
            WHERE groups.user_id = $1
              AND groups.enabled = true
              AND (
                  groups.source_account_id = $2 OR EXISTS (
                      SELECT 1
                      FROM execution_copy_targets targets
                      WHERE targets.user_id = groups.user_id
                        AND targets.group_id = groups.id
                        AND targets.account_id = $2
                        AND targets.enabled = true
                  )
              )
              AND (
                  groups.last_reconciled_at IS NULL OR
                  groups.last_reconciled_at <= now() - make_interval(
                      secs => greatest(
                          COALESCE(
                              NULLIF(groups.configuration->>'reconciliationIntervalMs', '')::double precision,
                              5000.0
                          ),
                          1000.0
                      ) / 1000.0
                  )
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM execution_copy_reconciliation_runs runs
                  WHERE runs.user_id = groups.user_id
                    AND runs.group_id = groups.id
                    AND runs.status IN ('queued', 'running')
              )
            "#,
        )
        .bind(owner_uuid)
        .bind(account_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("schedule copier reconciliation", error))?;
        Ok(())
    }

    async fn process_continuous_copier_reconciliations(
        &self,
        owner_uuid: Uuid,
    ) -> Result<u64, ApiError> {
        let Some(database) = &self.inner.database else {
            return Ok(0);
        };
        let worker_id = Uuid::new_v4();
        let runs = sqlx::query(
            r#"
            WITH candidates AS (
                SELECT id
                FROM execution_copy_reconciliation_runs
                WHERE user_id = $1
                  AND status IN ('queued', 'running')
                  AND (lease_expires_at IS NULL OR lease_expires_at <= now())
                ORDER BY created_at, id
                FOR UPDATE SKIP LOCKED
                LIMIT 8
            )
            UPDATE execution_copy_reconciliation_runs runs
            SET status = 'running', lease_owner = $2,
                lease_expires_at = now() + interval '60 seconds',
                started_at = COALESCE(started_at, now()), error_message = NULL
            FROM candidates
            WHERE runs.user_id = $1 AND runs.id = candidates.id
            RETURNING runs.id, runs.group_id
            "#,
        )
        .bind(owner_uuid)
        .bind(worker_id)
        .fetch_all(database)
        .await
        .map_err(|error| ApiError::database("claim copier reconciliation", error))?;

        let mut processed = 0_u64;
        for run in runs {
            let run_id: Uuid = run
                .try_get("id")
                .map_err(|error| ApiError::database("decode reconciliation id", error))?;
            let group_id: Uuid = run
                .try_get("group_id")
                .map_err(|error| ApiError::database("decode reconciliation group", error))?;
            match self
                .reconcile_continuous_copy_group(owner_uuid, run_id, group_id)
                .await
            {
                Ok(()) => processed += 1,
                Err(error) => {
                    sqlx::query(
                        r#"
                        UPDATE execution_copy_reconciliation_runs
                        SET status = 'failed', error_message = $3,
                            lease_owner = NULL, lease_expires_at = NULL,
                            completed_at = now()
                        WHERE user_id = $1 AND id = $2
                        "#,
                    )
                    .bind(owner_uuid)
                    .bind(run_id)
                    .bind(&error.body.message)
                    .execute(database)
                    .await
                    .map_err(|update_error| {
                        ApiError::database("fail copier reconciliation", update_error)
                    })?;
                    warn!(
                        reconciliation_id = %run_id,
                        group_id = %group_id,
                        code = error.body.code,
                        message = %error.body.message,
                        "continuous copier reconciliation failed"
                    );
                }
            }
        }
        Ok(processed)
    }

    async fn reconcile_continuous_copy_group(
        &self,
        owner_uuid: Uuid,
        reconciliation_id: Uuid,
        group_id: Uuid,
    ) -> Result<(), ApiError> {
        let Some(database) = &self.inner.database else {
            return Ok(());
        };
        let mut transaction = database
            .begin()
            .await
            .map_err(|error| ApiError::database("begin copier reconciliation", error))?;
        let rows = sqlx::query(
            r#"
            SELECT
                links.id, links.source_account_id, links.target_account_id,
                links.source_entity_kind, links.source_entity_id,
                links.target_entity_kind, links.target_entity_id,
                links.target_leg, links.lifecycle_status,
                groups.configuration AS group_configuration,
                targets.configuration AS target_configuration,
                targets.allocation_mode, targets.multiplier,
                targets.risk_basis_points, targets.max_quantity,
                targets.fixed_quantity, targets.allocation_unit,
                targets.symbol_mapping,
                EXISTS (
                    SELECT 1
                    FROM execution_copy_work_items work
                    JOIN execution_copy_lifecycle_inbox inbox
                      ON inbox.user_id = work.user_id
                     AND inbox.group_id = work.group_id
                     AND inbox.id = work.inbox_event_id
                    WHERE work.user_id = links.user_id
                      AND work.group_id = links.group_id
                      AND work.target_account_id = links.target_account_id
                      AND work.status IN ('pending', 'leased', 'retry')
                      AND work.operation IN ('close_position', 'cancel_pending')
                      AND inbox.source_entity_kind = links.source_entity_kind
                      AND inbox.source_entity_id = links.source_entity_id
                ) AS lifecycle_work_pending,
                CASE links.source_entity_kind
                    WHEN 'position' THEN (
                        SELECT positions.snapshot
                        FROM execution_positions positions
                        WHERE positions.user_id = links.user_id
                          AND positions.account_id = links.source_account_id
                          AND positions.broker_position_id = links.source_entity_id
                    )
                    ELSE (
                        SELECT pending.snapshot
                        FROM execution_pending_orders pending
                        WHERE pending.user_id = links.user_id
                          AND pending.account_id = links.source_account_id
                          AND pending.broker_order_id = links.source_entity_id
                    )
                END AS source_snapshot,
                CASE links.target_entity_kind
                    WHEN 'position' THEN (
                        SELECT positions.snapshot
                        FROM execution_positions positions
                        WHERE positions.user_id = links.user_id
                          AND positions.account_id = links.target_account_id
                          AND positions.broker_position_id = links.target_entity_id
                    )
                    WHEN 'pending_order' THEN (
                        SELECT pending.snapshot
                        FROM execution_pending_orders pending
                        WHERE pending.user_id = links.user_id
                          AND pending.account_id = links.target_account_id
                          AND pending.broker_order_id = links.target_entity_id
                    )
                END AS target_snapshot
            FROM execution_copy_links links
            JOIN execution_copy_groups groups
              ON groups.user_id = links.user_id AND groups.id = links.group_id
            JOIN execution_copy_targets targets
              ON targets.user_id = links.user_id
             AND targets.group_id = links.group_id
             AND targets.account_id = links.target_account_id
            WHERE links.user_id = $1 AND links.group_id = $2
              AND links.lifecycle_status NOT IN ('closed', 'cancelled')
            ORDER BY links.target_account_id, links.source_entity_kind,
                     links.source_entity_id, links.target_leg
            "#,
        )
        .bind(owner_uuid)
        .bind(group_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("load copier reconciliation links", error))?;

        let mut checked_count = 0_i32;
        let mut mismatch_count = 0_i32;
        let mut repaired_count = 0_i32;
        for row in rows {
            checked_count += 1;
            let link_id: Uuid = row
                .try_get("id")
                .map_err(|error| ApiError::database("decode reconciliation link", error))?;
            let source_account_id: String = row.try_get("source_account_id").map_err(|error| {
                ApiError::database("decode reconciliation source account", error)
            })?;
            let target_account_id: String = row.try_get("target_account_id").map_err(|error| {
                ApiError::database("decode reconciliation target account", error)
            })?;
            let source_entity_kind: String = row
                .try_get("source_entity_kind")
                .map_err(|error| ApiError::database("decode reconciliation source kind", error))?;
            let source_entity_id: String = row
                .try_get("source_entity_id")
                .map_err(|error| ApiError::database("decode reconciliation source id", error))?;
            let target_entity_kind: Option<String> = row
                .try_get("target_entity_kind")
                .map_err(|error| ApiError::database("decode reconciliation target kind", error))?;
            let target_entity_id: Option<String> = row
                .try_get("target_entity_id")
                .map_err(|error| ApiError::database("decode reconciliation target id", error))?;
            let target_leg: i32 = row
                .try_get("target_leg")
                .map_err(|error| ApiError::database("decode reconciliation target leg", error))?;
            let lifecycle_status: String = row
                .try_get("lifecycle_status")
                .map_err(|error| ApiError::database("decode reconciliation lifecycle", error))?;
            let lifecycle_work_pending: bool = row
                .try_get("lifecycle_work_pending")
                .map_err(|error| ApiError::database("decode pending lifecycle work", error))?;
            let source_snapshot = row
                .try_get::<Option<sqlx::types::Json<serde_json::Value>>, _>("source_snapshot")
                .map_err(|error| ApiError::database("decode reconciliation source state", error))?
                .map(|value| value.0);
            let target_snapshot = row
                .try_get::<Option<sqlx::types::Json<serde_json::Value>>, _>("target_snapshot")
                .map_err(|error| ApiError::database("decode reconciliation target state", error))?
                .map(|value| value.0);

            if source_snapshot.is_some() && target_snapshot.is_some() {
                sqlx::query(
                    r#"
                    UPDATE execution_copy_links
                    SET lifecycle_status = CASE
                            WHEN lifecycle_status = 'closing' THEN lifecycle_status
                            ELSE 'active'
                        END,
                        last_reconciled_at = now(), revision = revision + 1,
                        updated_at = now()
                    WHERE user_id = $1 AND id = $2
                    "#,
                )
                .bind(owner_uuid)
                .bind(link_id)
                .execute(&mut *transaction)
                .await
                .map_err(|error| ApiError::database("confirm copier reconciliation link", error))?;
                continue;
            }

            mismatch_count += 1;
            let expected_state = serde_json::json!({
                "sourceAccountId": source_account_id,
                "sourceEntityKind": source_entity_kind,
                "sourceEntityId": source_entity_id,
                "targetEntityKind": target_entity_kind,
                "targetEntityId": target_entity_id,
                "targetLeg": target_leg,
                "lifecycleStatus": lifecycle_status,
            });
            let actual_state = serde_json::json!({
                "sourcePresent": source_snapshot.is_some(),
                "targetPresent": target_snapshot.is_some(),
            });

            let (discrepancy_type, item_status, resolution_action) = if source_snapshot.is_none()
                && target_snapshot.is_some()
            {
                let mut queued_repair = false;
                if lifecycle_status != "closing" && !lifecycle_work_pending {
                    let change = match (target_entity_kind.as_deref(), target_snapshot) {
                        (Some("position"), Some(snapshot)) => {
                            let mut position = serde_json::from_value::<EaPositionSnapshot>(
                                snapshot,
                            )
                            .map_err(|error| {
                                ApiError::internal("decode reconciliation target position", error)
                            })?;
                            position.broker_position_id = source_entity_id.clone();
                            PortfolioChange::PositionClosed { previous: position }
                        }
                        (Some("pending_order"), Some(snapshot)) => {
                            let mut pending =
                                serde_json::from_value::<EaPendingOrderSnapshot>(snapshot)
                                    .map_err(|error| {
                                        ApiError::internal(
                                            "decode reconciliation target pending order",
                                            error,
                                        )
                                    })?;
                            pending.broker_order_id = source_entity_id.clone();
                            PortfolioChange::PendingCancelled { previous: pending }
                        }
                        _ => {
                            return Err(ApiError::new(
                                StatusCode::INTERNAL_SERVER_ERROR,
                                "COPY_RECONCILIATION_STATE_INVALID",
                                "target copier state could not be decoded for repair",
                            ));
                        }
                    };
                    let group_config = row
                        .try_get::<sqlx::types::Json<ContinuousCopyConfig>, _>(
                            "group_configuration",
                        )
                        .map(|value| value.0)
                        .unwrap_or_default();
                    let target_config_value = row
                        .try_get::<sqlx::types::Json<serde_json::Value>, _>("target_configuration")
                        .map_err(|error| {
                            ApiError::database("decode reconciliation target configuration", error)
                        })?
                        .0;
                    let target_config =
                        serde_json::from_value::<ContinuousCopyTargetConfig>(target_config_value)
                            .unwrap_or_else(|_| legacy_copy_target_config(&row));
                    let operation = match &change {
                        PortfolioChange::PositionClosed { .. } => "close_position",
                        _ => "cancel_pending",
                    };
                    self.stage_generated_copier_work(
                        &mut transaction,
                        owner_uuid,
                        group_id,
                        &source_account_id,
                        &target_account_id,
                        target_leg,
                        change,
                        operation,
                        "reconciliation",
                        group_config,
                        target_config,
                    )
                    .await?;
                    sqlx::query(
                        r#"
                            UPDATE execution_copy_links
                            SET lifecycle_status = 'closing', last_reconciled_at = now(),
                                revision = revision + 1, updated_at = now()
                            WHERE user_id = $1 AND id = $2
                            "#,
                    )
                    .bind(owner_uuid)
                    .bind(link_id)
                    .execute(&mut *transaction)
                    .await
                    .map_err(|error| {
                        ApiError::database("stage copier reconciliation repair", error)
                    })?;
                    queued_repair = true;
                    repaired_count += 1;
                }
                (
                    "source_missing",
                    "resolving",
                    if queued_repair {
                        "close_target"
                    } else {
                        "await_target_close"
                    },
                )
            } else if source_snapshot.is_some() {
                let safely_terminal = lifecycle_status == "closing";
                let next_status = if safely_terminal {
                    if source_entity_kind == "position" {
                        "closed"
                    } else {
                        "cancelled"
                    }
                } else if target_entity_id.is_none() {
                    "pending"
                } else {
                    "orphaned"
                };
                sqlx::query(
                    r#"
                        UPDATE execution_copy_links
                        SET lifecycle_status = $3,
                            closed_at = CASE WHEN $3 IN ('closed', 'cancelled')
                                THEN COALESCE(closed_at, now()) ELSE closed_at END,
                            last_reconciled_at = now(), revision = revision + 1,
                            updated_at = now()
                        WHERE user_id = $1 AND id = $2
                        "#,
                )
                .bind(owner_uuid)
                .bind(link_id)
                .bind(next_status)
                .execute(&mut *transaction)
                .await
                .map_err(|error| ApiError::database("resolve missing copier target", error))?;
                if safely_terminal {
                    repaired_count += 1;
                }
                (
                    if target_entity_id.is_some() {
                        "target_missing"
                    } else {
                        "target_link_unresolved"
                    },
                    if safely_terminal { "resolved" } else { "open" },
                    if safely_terminal {
                        "confirm_target_closed"
                    } else if target_entity_id.is_none() {
                        "await_target_ack"
                    } else {
                        "manual_review"
                    },
                )
            } else {
                let next_status = if source_entity_kind == "position" {
                    "closed"
                } else {
                    "cancelled"
                };
                sqlx::query(
                    r#"
                        UPDATE execution_copy_links
                        SET lifecycle_status = $3, closed_at = COALESCE(closed_at, now()),
                            last_reconciled_at = now(), revision = revision + 1,
                            updated_at = now()
                        WHERE user_id = $1 AND id = $2
                        "#,
                )
                .bind(owner_uuid)
                .bind(link_id)
                .bind(next_status)
                .execute(&mut *transaction)
                .await
                .map_err(|error| {
                    ApiError::database("close absent copier reconciliation link", error)
                })?;
                repaired_count += 1;
                ("source_and_target_missing", "resolved", "close_link")
            };

            sqlx::query(
                r#"
                INSERT INTO execution_copy_reconciliation_items (
                    user_id, reconciliation_id, group_id, target_account_id,
                    link_id, discrepancy_type, status,
                    expected_state, actual_state, resolution_action, resolved_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    CASE WHEN $7 = 'resolved' THEN now() ELSE NULL END
                )
                "#,
            )
            .bind(owner_uuid)
            .bind(reconciliation_id)
            .bind(group_id)
            .bind(&target_account_id)
            .bind(link_id)
            .bind(discrepancy_type)
            .bind(item_status)
            .bind(sqlx::types::Json(expected_state))
            .bind(sqlx::types::Json(actual_state))
            .bind(resolution_action)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("record copier discrepancy", error))?;
        }

        let reconciliation_status = if mismatch_count == 0 {
            "succeeded"
        } else {
            "degraded"
        };
        sqlx::query(
            r#"
            UPDATE execution_copy_reconciliation_runs
            SET status = $3, checked_count = $4, mismatch_count = $5,
                repaired_count = $6, lease_owner = NULL, lease_expires_at = NULL,
                completed_at = now(), error_message = NULL
            WHERE user_id = $1 AND id = $2
            "#,
        )
        .bind(owner_uuid)
        .bind(reconciliation_id)
        .bind(reconciliation_status)
        .bind(checked_count)
        .bind(mismatch_count)
        .bind(repaired_count)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("complete copier reconciliation", error))?;
        sqlx::query(
            r#"
            UPDATE execution_copy_groups
            SET last_reconciled_at = now(),
                runtime_status = CASE
                    WHEN enabled = false THEN runtime_status
                    WHEN runtime_status = 'paused' THEN 'paused'
                    WHEN $3 = 0 THEN 'active'
                    ELSE 'degraded'
                END,
                status_message = CASE
                    WHEN enabled = false THEN status_message
                    WHEN runtime_status = 'paused' THEN status_message
                    WHEN $3 = 0 THEN NULL
                    ELSE 'Reconciliation found copier lifecycle discrepancies'
                END,
                updated_at = now()
            WHERE user_id = $1 AND id = $2
            "#,
        )
        .bind(owner_uuid)
        .bind(group_id)
        .bind(mismatch_count)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("update reconciled copier group", error))?;
        sqlx::query(
            r#"
            UPDATE execution_copy_targets
            SET last_reconciled_at = now(),
                runtime_status = CASE
                    WHEN enabled = false THEN 'inactive'
                    WHEN $3 = 0 THEN 'active'
                    ELSE 'degraded'
                END,
                status_message = CASE
                    WHEN enabled = false OR $3 = 0 THEN NULL
                    ELSE 'Reconciliation found copier lifecycle discrepancies'
                END,
                updated_at = now()
            WHERE user_id = $1 AND group_id = $2
            "#,
        )
        .bind(owner_uuid)
        .bind(group_id)
        .bind(mismatch_count)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("update reconciled copier targets", error))?;
        transaction
            .commit()
            .await
            .map_err(|error| ApiError::database("commit copier reconciliation", error))
    }

    async fn process_continuous_copier_work(&self, owner_uuid: Uuid) -> Result<u64, ApiError> {
        let Some(database) = &self.inner.database else {
            return Ok(0);
        };
        let worker_id = Uuid::new_v4();
        let rows = sqlx::query(
            r#"
            WITH candidates AS (
                SELECT work.id
                FROM execution_copy_work_items work
                JOIN execution_copy_groups groups
                  ON groups.user_id = work.user_id AND groups.id = work.group_id
                JOIN execution_copy_targets targets
                  ON targets.user_id = work.user_id
                 AND targets.group_id = work.group_id
                 AND targets.account_id = work.target_account_id
                WHERE work.user_id = $1
                  AND work.status IN ('pending', 'retry', 'leased')
                  AND work.available_at <= now()
                  AND (work.lease_expires_at IS NULL OR work.lease_expires_at <= now())
                  AND groups.enabled = true
                  AND (
                      groups.runtime_status NOT IN ('paused', 'error') OR
                      (
                          groups.runtime_status = 'paused' AND (
                              work.operation IN (
                                  'partial_close', 'close_position',
                                  'cancel_pending', 'reconcile'
                              ) OR (
                                  work.operation = 'modify_position' AND
                                  work.payload->>'phase' = 'target_protection'
                              )
                          )
                      )
                  )
                  AND targets.enabled = true
                  AND NOT EXISTS (
                      SELECT 1
                      FROM execution_copy_work_items prior
                      WHERE prior.user_id = work.user_id
                        AND prior.group_id = work.group_id
                        AND prior.target_account_id = work.target_account_id
                        AND (prior.created_at, prior.id) < (work.created_at, work.id)
                        AND (
                            prior.status IN ('pending', 'leased', 'retry') OR
                            EXISTS (
                                SELECT 1
                                FROM execution_copy_command_outbox prior_outbox
                                WHERE prior_outbox.user_id = prior.user_id
                                  AND prior_outbox.work_item_id = prior.id
                                  AND prior_outbox.status IN (
                                      'pending', 'publishing', 'published', 'retry'
                                  )
                            )
                        )
                  )
                ORDER BY work.created_at, work.id
                FOR UPDATE OF work SKIP LOCKED
                LIMIT 32
            )
            UPDATE execution_copy_work_items work
            SET status = 'leased',
                lease_owner = $2,
                lease_expires_at = now() + interval '30 seconds',
                attempt_count = work.attempt_count + 1,
                updated_at = now()
            FROM candidates
            WHERE work.user_id = $1 AND work.id = candidates.id
            RETURNING work.id, work.group_id, work.target_account_id,
                      work.operation, work.idempotency_key, work.payload,
                      work.attempt_count
            "#,
        )
        .bind(owner_uuid)
        .bind(worker_id)
        .fetch_all(database)
        .await
        .map_err(|error| ApiError::database("claim copier work", error))?;

        let mut processed = 0_u64;
        for row in rows {
            let work_id: Uuid = row
                .try_get("id")
                .map_err(|error| ApiError::database("decode copier work id", error))?;
            let group_id: Uuid = row
                .try_get("group_id")
                .map_err(|error| ApiError::database("decode copier work group", error))?;
            let target_account_id: String = row
                .try_get("target_account_id")
                .map_err(|error| ApiError::database("decode copier work target account", error))?;
            let operation: String = row
                .try_get("operation")
                .map_err(|error| ApiError::database("decode copier work operation", error))?;
            let idempotency_key: String = row
                .try_get("idempotency_key")
                .map_err(|error| ApiError::database("decode copier work idempotency key", error))?;
            let payload = row
                .try_get::<sqlx::types::Json<CopierWorkPayload>, _>("payload")
                .map_err(|error| ApiError::database("decode copier work payload", error))?
                .0;
            let attempt_count: i32 = row
                .try_get("attempt_count")
                .map_err(|error| ApiError::database("decode copier work attempt", error))?;

            let result = self
                .execute_continuous_copier_work(
                    owner_uuid,
                    group_id,
                    work_id,
                    &target_account_id,
                    &operation,
                    &idempotency_key,
                    &payload,
                )
                .await;
            match result {
                Ok(()) => {
                    processed += 1;
                }
                Err(error) => {
                    self.fail_continuous_copier_work(
                        owner_uuid,
                        group_id,
                        work_id,
                        &target_account_id,
                        attempt_count,
                        error,
                    )
                    .await?;
                }
            }
        }
        Ok(processed)
    }

    #[allow(clippy::too_many_arguments, clippy::collapsible_if)]
    async fn execute_continuous_copier_work(
        &self,
        owner_uuid: Uuid,
        group_id: Uuid,
        work_id: Uuid,
        target_account_id: &str,
        operation: &str,
        idempotency_key: &str,
        payload: &CopierWorkPayload,
    ) -> Result<(), CopierWorkError> {
        payload
            .group_config
            .validate()
            .map_err(|message| CopierWorkError::permanent("COPY_CONFIG_INVALID", message))?;
        payload
            .target_config
            .validate()
            .map_err(|message| CopierWorkError::permanent("COPY_TARGET_CONFIG_INVALID", message))?;
        let is_pending_fill_market = operation == "open_market"
            && matches!(&payload.change, PortfolioChange::PendingFilled { .. });
        if !is_pending_fill_market
            && copier_work_is_stale(
                operation,
                payload.change.observed_at_ms(),
                now_ms(),
                payload.group_config.stale_after_ms,
            )
        {
            if !self
                .copier_work_target_command_exists(owner_uuid, work_id)
                .await?
            {
                return self
                    .supersede_continuous_copier_work(
                        owner_uuid,
                        group_id,
                        work_id,
                        target_account_id,
                        &payload.change,
                        "risk-increasing copier work exceeded staleAfterMs",
                    )
                    .await;
            }
        }
        let target_account = AccountId::new(target_account_id.to_owned());
        let command_identity = format!("{}:{}:{}", group_id, work_id, operation);
        let command_id = execution_domain::CommandId::new(format!(
            "cp:{}",
            short_hash(command_identity.as_bytes())
        ));
        let command_idempotency =
            IdempotencyKey::new(format!("cpc:{}", short_hash(idempotency_key.as_bytes())));

        let command = match operation {
            "open_market" | "place_pending" => {
                if operation == "open_market"
                    && let PortfolioChange::PendingFilled { previous, position } = &payload.change
                {
                    if let Some(lifecycle_status) = self
                        .copier_pending_fill_link_status(
                            owner_uuid,
                            group_id,
                            target_account_id,
                            &position.broker_position_id,
                            &previous.broker_order_id,
                            payload.target_leg,
                        )
                        .await?
                    {
                        if matches!(lifecycle_status.as_str(), "error" | "orphaned") {
                            return Err(CopierWorkError::retryable(
                                "COPY_PENDING_FILL_LINK_UNRESOLVED",
                                "the pending-fill link is unresolved and cannot be replaced safely",
                            ));
                        }
                        return self
                            .complete_continuous_copier_work(
                                owner_uuid,
                                group_id,
                                work_id,
                                target_account_id,
                                None,
                                &payload.change,
                            )
                            .await;
                    }
                    if self
                        .copier_target_link_exists(
                            owner_uuid,
                            group_id,
                            target_account_id,
                            &payload.change,
                            "pending_order",
                            payload.target_leg,
                        )
                        .await?
                    {
                        // Existing pending exposure must be adopted/reconciled,
                        // never duplicated by a market copy. If no pending link
                        // was ever issued, the market fallback remains valid.
                        return self
                            .reconcile_continuous_copy_target(
                                owner_uuid,
                                group_id,
                                work_id,
                                target_account_id,
                                &payload.change,
                                payload.target_leg,
                            )
                            .await;
                    }
                    if !copy_source_filters_match(&payload.change, &payload.group_config) {
                        return self
                            .complete_continuous_copier_work(
                                owner_uuid,
                                group_id,
                                work_id,
                                target_account_id,
                                None,
                                &payload.change,
                            )
                            .await;
                    }
                    if copier_work_is_stale(
                        operation,
                        payload.change.observed_at_ms(),
                        now_ms(),
                        payload.group_config.stale_after_ms,
                    ) && !self
                        .copier_work_target_command_exists(owner_uuid, work_id)
                        .await?
                    {
                        return self
                            .supersede_continuous_copier_work(
                                owner_uuid,
                                group_id,
                                work_id,
                                target_account_id,
                                &payload.change,
                                "unlinked pending-fill market fallback exceeded staleAfterMs",
                            )
                            .await;
                    }
                }
                if operation == "place_pending"
                    && matches!(&payload.change, PortfolioChange::PendingReplaced { .. })
                    && self
                        .copier_target_link_exists(
                            owner_uuid,
                            group_id,
                            target_account_id,
                            &payload.change,
                            "pending_order",
                            None,
                        )
                        .await?
                {
                    return Err(CopierWorkError::retryable(
                        "COPY_PENDING_REPLACE_WAIT",
                        "replacement pending order is waiting for the prior target order to cancel",
                    ));
                }
                if operation == "place_pending"
                    && matches!(&payload.change, PortfolioChange::PendingReplaced { .. })
                    && !copy_source_filters_match(&payload.change, &payload.group_config)
                    && !self
                        .copier_source_link_history_exists(
                            owner_uuid,
                            group_id,
                            target_account_id,
                            &payload.change,
                        )
                        .await?
                {
                    return self
                        .complete_continuous_copier_work(
                            owner_uuid,
                            group_id,
                            work_id,
                            target_account_id,
                            None,
                            &payload.change,
                        )
                        .await;
                }
                let intent = copier_order_intent(
                    &payload.change,
                    &payload.target_config,
                    &command_id,
                    &command_idempotency,
                    operation,
                    payload.source_account_id.clone(),
                    payload.group_config.copy_stop_loss_take_profit,
                )?;
                let target = AdminOrderTarget {
                    account_id: target_account.clone(),
                    allocation: payload.target_config.allocation.clone(),
                    max_quantity: payload.target_config.max_quantity,
                };
                let context = self
                    .load_route_target(owner_uuid, &target, &intent.canonical_symbol, intent.side)
                    .await
                    .map_err(CopierWorkError::api)?
                    .ok_or_else(|| {
                        CopierWorkError::retryable(
                            "TARGET_CONTEXT_UNAVAILABLE",
                            "target account or fresh broker instrument metadata is unavailable",
                        )
                    })?;
                if !execution_transport_enabled(context.account.venue_kind) {
                    return Err(CopierWorkError::permanent(
                        "TARGET_TRANSPORT_UNAVAILABLE",
                        "the target venue transport is not enabled",
                    ));
                }
                if matches!(
                    context.account.status,
                    AccountStatus::Offline | AccountStatus::Connecting
                ) {
                    return Err(CopierWorkError::retryable(
                        "TARGET_OFFLINE",
                        "target EA is offline; copier work will retry without issuing a stale command",
                    ));
                }
                let source_equity = self
                    .source_equity(owner_uuid, intent.source_account_id.as_ref())
                    .await
                    .map_err(CopierWorkError::api)?;
                let mut routed =
                    route_order(&intent, source_equity, std::slice::from_ref(&context));
                let Some(result) = routed.pop() else {
                    return Err(CopierWorkError::permanent(
                        "COPY_ROUTE_EMPTY",
                        "the route engine returned no target result",
                    ));
                };
                let mut order = match result {
                    TargetRouteResult::Ready { order, .. } => *order,
                    TargetRouteResult::Rejected { code, message, .. } => {
                        let code = serde_json::to_value(code)
                            .ok()
                            .and_then(|value| value.as_str().map(str::to_owned))
                            .unwrap_or_else(|| "COPY_ROUTE_REJECTED".into());
                        return Err(CopierWorkError::permanent(code, message));
                    }
                };
                if let Some((code, message)) = self
                    .apply_prop_risk_pretrade(owner_uuid, &context, &mut order)
                    .await
                    .map_err(CopierWorkError::api)?
                {
                    let code = serde_json::to_value(code)
                        .ok()
                        .and_then(|value| value.as_str().map(str::to_owned))
                        .unwrap_or_else(|| "PROP_RISK_REJECTED".into());
                    return Err(CopierWorkError::permanent(code, message));
                }
                order.broker_margin_cap =
                    payload.target_config.protection.broker_margin_cap.clone();
                EaCommand::Place { order }
            }
            "modify_position" => {
                let Some(target_entity_id) = self
                    .copier_target_entity_id(
                        owner_uuid,
                        group_id,
                        target_account_id,
                        &payload.change,
                        "position",
                        payload.target_leg,
                    )
                    .await?
                else {
                    if self
                        .copier_target_link_exists(
                            owner_uuid,
                            group_id,
                            target_account_id,
                            &payload.change,
                            "position",
                            payload.target_leg,
                        )
                        .await?
                    {
                        return Err(CopierWorkError::retryable(
                            "COPY_LINK_PENDING",
                            "target position link has not been reconciled yet",
                        ));
                    }
                    return self
                        .complete_continuous_copier_work(
                            owner_uuid,
                            group_id,
                            work_id,
                            target_account_id,
                            None,
                            &payload.change,
                        )
                        .await;
                };
                let reverse_protection = payload.target_config.reverse_trade
                    && payload.phase.as_deref() != Some("target_protection");
                let (stop_loss, take_profit) =
                    copier_position_protection(&payload.change, reverse_protection)?;
                EaCommand::ModifyPosition {
                    command: ModifyPositionCommand {
                        command_id: command_id.clone(),
                        idempotency_key: command_idempotency.clone(),
                        target_account_id: target_account.clone(),
                        broker_position_id: target_entity_id,
                        stop_loss,
                        take_profit,
                    },
                }
            }
            "modify_pending" => {
                let Some(target_entity_id) = self
                    .copier_target_entity_id(
                        owner_uuid,
                        group_id,
                        target_account_id,
                        &payload.change,
                        "pending_order",
                        payload.target_leg,
                    )
                    .await?
                else {
                    if self
                        .copier_target_link_exists(
                            owner_uuid,
                            group_id,
                            target_account_id,
                            &payload.change,
                            "pending_order",
                            payload.target_leg,
                        )
                        .await?
                    {
                        return Err(CopierWorkError::retryable(
                            "COPY_LINK_PENDING",
                            "target pending-order link has not been reconciled yet",
                        ));
                    }
                    return self
                        .complete_continuous_copier_work(
                            owner_uuid,
                            group_id,
                            work_id,
                            target_account_id,
                            None,
                            &payload.change,
                        )
                        .await;
                };
                let (price, stop_loss, take_profit) = copier_pending_modification(
                    &payload.change,
                    payload.target_config.reverse_trade,
                )?;
                EaCommand::ModifyPendingOrder {
                    command: ModifyPendingOrderCommand {
                        command_id: command_id.clone(),
                        idempotency_key: command_idempotency.clone(),
                        target_account_id: target_account.clone(),
                        broker_order_id: target_entity_id,
                        price,
                        stop_loss,
                        take_profit,
                    },
                }
            }
            "partial_close" | "close_position" => {
                let Some(target_entity_id) = self
                    .copier_target_entity_id(
                        owner_uuid,
                        group_id,
                        target_account_id,
                        &payload.change,
                        "position",
                        payload.target_leg,
                    )
                    .await?
                else {
                    if self
                        .copier_target_link_exists(
                            owner_uuid,
                            group_id,
                            target_account_id,
                            &payload.change,
                            "position",
                            payload.target_leg,
                        )
                        .await?
                    {
                        return Err(CopierWorkError::retryable(
                            "COPY_LINK_PENDING",
                            "target position link has not been reconciled yet",
                        ));
                    }
                    return self
                        .complete_continuous_copier_work(
                            owner_uuid,
                            group_id,
                            work_id,
                            target_account_id,
                            None,
                            &payload.change,
                        )
                        .await;
                };
                let quantity = if operation == "partial_close" {
                    let target_quantity = self
                        .copier_target_quantity(
                            owner_uuid,
                            group_id,
                            target_account_id,
                            &payload.change,
                            "position",
                            payload.target_leg,
                        )
                        .await?
                        .ok_or_else(|| {
                            CopierWorkError::retryable(
                                "COPY_LINK_QUANTITY_PENDING",
                                "target position quantity is not reconciled yet",
                            )
                        })?;
                    Some(
                        copier_partial_close_quantity(&payload.change, Some(target_quantity))
                            .ok_or_else(|| {
                                CopierWorkError::permanent(
                                    "COPY_PARTIAL_CLOSE_INVALID",
                                    "partial-close work did not resolve a positive target quantity",
                                )
                            })?,
                    )
                } else {
                    None
                };
                EaCommand::ClosePosition {
                    command: ClosePositionCommand {
                        command_id: command_id.clone(),
                        idempotency_key: command_idempotency.clone(),
                        target_account_id: target_account.clone(),
                        broker_position_id: target_entity_id,
                        quantity,
                        deviation_points: payload.group_config.max_slippage_points,
                    },
                }
            }
            "cancel_pending" => {
                let Some(target_entity_id) = self
                    .copier_target_entity_id(
                        owner_uuid,
                        group_id,
                        target_account_id,
                        &payload.change,
                        "pending_order",
                        payload.target_leg,
                    )
                    .await?
                else {
                    if self
                        .copier_target_link_exists(
                            owner_uuid,
                            group_id,
                            target_account_id,
                            &payload.change,
                            "pending_order",
                            payload.target_leg,
                        )
                        .await?
                    {
                        return Err(CopierWorkError::retryable(
                            "COPY_LINK_PENDING",
                            "target pending-order link is waiting for its broker ticket",
                        ));
                    }
                    return self
                        .complete_continuous_copier_work(
                            owner_uuid,
                            group_id,
                            work_id,
                            target_account_id,
                            None,
                            &payload.change,
                        )
                        .await;
                };
                EaCommand::CancelOrder {
                    command: CancelOrderCommand {
                        command_id: command_id.clone(),
                        idempotency_key: command_idempotency.clone(),
                        target_account_id: target_account.clone(),
                        broker_order_id: target_entity_id,
                    },
                }
            }
            "reconcile" => {
                return self
                    .reconcile_continuous_copy_target(
                        owner_uuid,
                        group_id,
                        work_id,
                        target_account_id,
                        &payload.change,
                        payload.target_leg,
                    )
                    .await;
            }
            _ => {
                return Err(CopierWorkError::permanent(
                    "COPY_OPERATION_INVALID",
                    format!("unsupported copier operation {operation}"),
                ));
            }
        };

        let command_json = serde_json::to_value(&command).map_err(|error| {
            CopierWorkError::permanent("COPY_COMMAND_SERIALIZE_FAILED", error.to_string())
        })?;
        self.persist_copier_outbox(
            owner_uuid,
            group_id,
            work_id,
            target_account_id,
            idempotency_key,
            operation,
            payload.phase.as_deref(),
            payload.target_leg,
            &command,
            command_json,
            &payload.change,
        )
        .await?;
        match self.enqueue(&target_account, command.clone()).await {
            Ok(()) => {
                self.publish_copier_outbox(
                    owner_uuid,
                    work_id,
                    command_id.as_str(),
                    &payload.change,
                )
                .await
            }
            Err(AdapterError::AccountOffline | AdapterError::Backpressure) => {
                Err(CopierWorkError::retryable(
                    "COPY_TARGET_TEMPORARILY_UNAVAILABLE",
                    "target execution queue is temporarily unavailable",
                ))
            }
            Err(AdapterError::IdempotencyConflict) => Err(CopierWorkError::permanent(
                "COPY_COMMAND_IDEMPOTENCY_CONFLICT",
                "the durable target command conflicts with prior payload",
            )),
            Err(error) => {
                let (code, message) = adapter_submission_error(error);
                Err(CopierWorkError::permanent(code, message))
            }
        }
    }

    async fn copier_target_entity_id(
        &self,
        owner_uuid: Uuid,
        group_id: Uuid,
        target_account_id: &str,
        change: &PortfolioChange,
        target_entity_kind: &str,
        target_leg: Option<i32>,
    ) -> Result<Option<String>, CopierWorkError> {
        let Some(database) = &self.inner.database else {
            return Ok(None);
        };
        sqlx::query_scalar::<_, String>(
            r#"
            SELECT target_entity_id
            FROM execution_copy_links
            WHERE user_id = $1 AND group_id = $2 AND target_account_id = $3
              AND source_entity_kind = $4 AND source_entity_id = $5
              AND target_entity_kind = $6 AND target_entity_id IS NOT NULL
              AND ($7::integer IS NULL OR target_leg = $7)
              AND lifecycle_status NOT IN ('closed', 'cancelled', 'orphaned')
            ORDER BY target_leg, updated_at DESC
            LIMIT 1
            "#,
        )
        .bind(owner_uuid)
        .bind(group_id)
        .bind(target_account_id)
        .bind(copy_source_entity_kind(change))
        .bind(change.source_resource_id())
        .bind(target_entity_kind)
        .bind(target_leg)
        .fetch_optional(database)
        .await
        .map_err(|error| CopierWorkError::api(ApiError::database("load copier target link", error)))
    }

    async fn copier_target_quantity(
        &self,
        owner_uuid: Uuid,
        group_id: Uuid,
        target_account_id: &str,
        change: &PortfolioChange,
        target_entity_kind: &str,
        target_leg: Option<i32>,
    ) -> Result<Option<Decimal>, CopierWorkError> {
        let Some(database) = &self.inner.database else {
            return Ok(None);
        };
        sqlx::query_scalar::<_, Decimal>(
            r#"
            SELECT target_quantity
            FROM execution_copy_links
            WHERE user_id = $1 AND group_id = $2 AND target_account_id = $3
              AND source_entity_kind = $4 AND source_entity_id = $5
              AND target_entity_kind = $6 AND target_entity_id IS NOT NULL
              AND ($7::integer IS NULL OR target_leg = $7)
              AND lifecycle_status NOT IN ('closed', 'cancelled', 'orphaned')
              AND target_quantity IS NOT NULL
            ORDER BY target_leg, updated_at DESC
            LIMIT 1
            "#,
        )
        .bind(owner_uuid)
        .bind(group_id)
        .bind(target_account_id)
        .bind(copy_source_entity_kind(change))
        .bind(change.source_resource_id())
        .bind(target_entity_kind)
        .bind(target_leg)
        .fetch_optional(database)
        .await
        .map_err(|error| {
            CopierWorkError::api(ApiError::database("load copier target quantity", error))
        })
    }

    async fn copier_target_link_exists(
        &self,
        owner_uuid: Uuid,
        group_id: Uuid,
        target_account_id: &str,
        change: &PortfolioChange,
        target_entity_kind: &str,
        target_leg: Option<i32>,
    ) -> Result<bool, CopierWorkError> {
        let Some(database) = &self.inner.database else {
            return Ok(false);
        };
        sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM execution_copy_links
                WHERE user_id = $1 AND group_id = $2 AND target_account_id = $3
                  AND source_entity_kind = $4 AND source_entity_id = $5
                  AND (
                      target_entity_kind = $6 OR
                      (target_entity_kind IS NULL AND metadata->>'expectedTargetKind' = $6)
                  )
                  AND ($7::integer IS NULL OR target_leg = $7)
                  AND lifecycle_status NOT IN ('closed', 'cancelled')
            )
            "#,
        )
        .bind(owner_uuid)
        .bind(group_id)
        .bind(target_account_id)
        .bind(copy_source_entity_kind(change))
        .bind(change.source_resource_id())
        .bind(target_entity_kind)
        .bind(target_leg)
        .fetch_one(database)
        .await
        .map_err(|error| {
            CopierWorkError::api(ApiError::database("check copier target link", error))
        })
    }

    async fn copier_pending_fill_link_status(
        &self,
        owner_uuid: Uuid,
        group_id: Uuid,
        target_account_id: &str,
        source_position_id: &str,
        source_pending_order_id: &str,
        target_leg: Option<i32>,
    ) -> Result<Option<String>, CopierWorkError> {
        let Some(database) = &self.inner.database else {
            return Ok(None);
        };
        sqlx::query_scalar::<_, String>(
            r#"
            SELECT lifecycle_status
            FROM execution_copy_links
            WHERE user_id = $1 AND group_id = $2 AND target_account_id = $3
              AND source_entity_kind = 'position' AND source_entity_id = $4
              AND metadata->>'originatingPendingOrderId' = $5
              AND ($6::integer IS NULL OR target_leg = $6)
              AND lifecycle_status NOT IN ('closed', 'cancelled')
            ORDER BY updated_at DESC, target_leg
            LIMIT 1
            "#,
        )
        .bind(owner_uuid)
        .bind(group_id)
        .bind(target_account_id)
        .bind(source_position_id)
        .bind(source_pending_order_id)
        .bind(target_leg)
        .fetch_optional(database)
        .await
        .map_err(|error| {
            CopierWorkError::api(ApiError::database(
                "check handled pending-fill copier link",
                error,
            ))
        })
    }

    async fn copier_source_link_history_exists(
        &self,
        owner_uuid: Uuid,
        group_id: Uuid,
        target_account_id: &str,
        change: &PortfolioChange,
    ) -> Result<bool, CopierWorkError> {
        let Some(database) = &self.inner.database else {
            return Ok(false);
        };
        sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM execution_copy_links
                WHERE user_id = $1 AND group_id = $2 AND target_account_id = $3
                  AND source_entity_kind = $4 AND source_entity_id = $5
                  AND NOT (
                      lifecycle_status = 'cancelled' AND
                      target_entity_id IS NULL AND
                      metadata ? 'supersededReason'
                  )
            )
            "#,
        )
        .bind(owner_uuid)
        .bind(group_id)
        .bind(target_account_id)
        .bind(copy_source_entity_kind(change))
        .bind(change.source_resource_id())
        .fetch_one(database)
        .await
        .map_err(|error| {
            CopierWorkError::api(ApiError::database(
                "check copier source link history",
                error,
            ))
        })
    }

    async fn copier_work_target_command_exists(
        &self,
        owner_uuid: Uuid,
        work_id: Uuid,
    ) -> Result<bool, CopierWorkError> {
        let Some(database) = &self.inner.database else {
            return Ok(false);
        };
        sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM execution_copy_command_outbox outbox
                JOIN execution_target_commands target_command
                  ON target_command.user_id = outbox.user_id
                 AND target_command.id = COALESCE(
                     outbox.target_command_id,
                     outbox.command_payload #>> '{order,commandId}',
                     outbox.command_payload #>> '{command,commandId}'
                 )
                WHERE outbox.user_id = $1 AND outbox.work_item_id = $2
            )
            "#,
        )
        .bind(owner_uuid)
        .bind(work_id)
        .fetch_one(database)
        .await
        .map_err(|error| {
            CopierWorkError::api(ApiError::database(
                "check issued copier target command",
                error,
            ))
        })
    }

    #[allow(clippy::too_many_arguments, clippy::collapsible_if)]
    async fn persist_copier_outbox(
        &self,
        owner_uuid: Uuid,
        group_id: Uuid,
        work_id: Uuid,
        target_account_id: &str,
        work_idempotency_key: &str,
        operation: &str,
        phase: Option<&str>,
        target_leg: Option<i32>,
        command: &EaCommand,
        mut command_json: serde_json::Value,
        change: &PortfolioChange,
    ) -> Result<(), CopierWorkError> {
        let Some(database) = &self.inner.database else {
            return Err(CopierWorkError::permanent(
                "PERSISTENT_STORE_REQUIRED",
                "continuous copier requires PostgreSQL",
            ));
        };
        let mut transaction = database.begin().await.map_err(|error| {
            CopierWorkError::api(ApiError::database("begin copier outbox", error))
        })?;
        let group_runtime_status = sqlx::query_scalar::<_, String>(
            r#"
            SELECT runtime_status
            FROM execution_copy_groups
            WHERE user_id = $1 AND id = $2 AND enabled = true
            FOR SHARE
            "#,
        )
        .bind(owner_uuid)
        .bind(group_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| {
            CopierWorkError::api(ApiError::database("lock active copier group", error))
        })?;
        let Some(group_runtime_status) = group_runtime_status else {
            return Err(CopierWorkError::permanent(
                "COPY_GROUP_NOT_ACTIVE",
                "the copier group was disabled before its command could be persisted",
            ));
        };
        if group_runtime_status == "paused"
            && !copier_operation_allowed_while_paused(operation, phase)
        {
            return Err(CopierWorkError::retryable(
                "COPY_GROUP_PAUSED",
                "risk-increasing copier work was paused before command persistence",
            ));
        }
        let work_is_current = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT true
            FROM execution_copy_work_items work
            JOIN execution_copy_targets targets
              ON targets.user_id = work.user_id
             AND targets.group_id = work.group_id
             AND targets.account_id = work.target_account_id
            WHERE work.user_id = $1 AND work.group_id = $2 AND work.id = $3
              AND work.status = 'leased' AND targets.enabled = true
            FOR SHARE OF work, targets
            "#,
        )
        .bind(owner_uuid)
        .bind(group_id)
        .bind(work_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| {
            CopierWorkError::api(ApiError::database("validate current copier work", error))
        })?
        .unwrap_or(false);
        if !work_is_current {
            return Err(CopierWorkError::permanent(
                "COPY_WORK_SUPERSEDED",
                "the copier work item or target was superseded before command persistence",
            ));
        }
        if operation == "partial_close" {
            if let (
                EaCommand::ClosePosition { command },
                PortfolioChange::PositionReduced {
                    previous,
                    current,
                    delta,
                },
            ) = (command, change)
            {
                if let Some(close_quantity) = command.quantity {
                    let prior_link_state = sqlx::query(
                        r#"
                        SELECT source_quantity, target_quantity
                        FROM execution_copy_links
                        WHERE user_id = $1 AND group_id = $2 AND target_account_id = $3
                          AND source_entity_kind = 'position' AND source_entity_id = $4
                          AND ($5::integer IS NULL OR target_leg = $5)
                          AND lifecycle_status NOT IN ('closed', 'cancelled', 'orphaned')
                          AND target_quantity IS NOT NULL
                        ORDER BY target_leg, updated_at DESC
                        LIMIT 1
                        "#,
                    )
                    .bind(owner_uuid)
                    .bind(group_id)
                    .bind(target_account_id)
                    .bind(change.source_resource_id())
                    .bind(target_leg)
                    .fetch_optional(&mut *transaction)
                    .await
                    .map_err(|error| {
                        CopierWorkError::api(ApiError::database(
                            "load partial-close copier state",
                            error,
                        ))
                    })?;
                    if let (Some(prior_link_state), Some(object)) =
                        (prior_link_state, command_json.as_object_mut())
                    {
                        let prior_source_quantity = prior_link_state
                            .try_get::<Option<Decimal>, _>("source_quantity")
                            .map_err(|error| {
                                CopierWorkError::api(ApiError::database(
                                    "decode partial-close source quantity",
                                    error,
                                ))
                            })?;
                        let prior_target_quantity = prior_link_state
                            .try_get::<Decimal, _>("target_quantity")
                            .map_err(|error| {
                                CopierWorkError::api(ApiError::database(
                                    "decode partial-close target quantity",
                                    error,
                                ))
                            })?;
                        let source_remaining = prior_source_quantity
                            .filter(|_| previous.quantity > Decimal::ZERO)
                            .map(|quantity| {
                                let reduced = *delta * quantity / previous.quantity;
                                (quantity - reduced).max(Decimal::ZERO)
                            })
                            .unwrap_or(current.quantity);
                        object.insert(
                            "copierSourceRemaining".into(),
                            serde_json::Value::String(source_remaining.to_string()),
                        );
                        object.insert(
                            "copierTargetRemaining".into(),
                            serde_json::Value::String(
                                (prior_target_quantity - close_quantity)
                                    .max(Decimal::ZERO)
                                    .to_string(),
                            ),
                        );
                    }
                }
            }
        }
        let outbox_identity = format!("{}:{}", work_id, work_idempotency_key);
        sqlx::query(
            r#"
            INSERT INTO execution_copy_command_outbox (
                user_id, group_id, target_account_id, work_item_id,
                idempotency_key, command_type, command_payload
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (user_id, work_item_id) DO NOTHING
            "#,
        )
        .bind(owner_uuid)
        .bind(group_id)
        .bind(target_account_id)
        .bind(work_id)
        .bind(format!("cpo:{}", short_hash(outbox_identity.as_bytes())))
        .bind(if operation == "partial_close" {
            "partial_close"
        } else {
            copier_command_type(command)
        })
        .bind(sqlx::types::Json(command_json.clone()))
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            CopierWorkError::api(ApiError::database("persist copier command outbox", error))
        })?;
        let stored_command_payload = sqlx::query_scalar::<_, sqlx::types::Json<serde_json::Value>>(
            r#"
            SELECT command_payload
            FROM execution_copy_command_outbox
            WHERE user_id = $1 AND work_item_id = $2
            "#,
        )
        .bind(owner_uuid)
        .bind(work_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| {
            CopierWorkError::api(ApiError::database("reload copier command outbox", error))
        })?;
        if stored_command_payload.0 != command_json {
            return Err(CopierWorkError::permanent(
                "COPY_OUTBOX_IDEMPOTENCY_CONFLICT",
                "the copier work item already has a different immutable command payload",
            ));
        }

        if let EaCommand::Place { order } = command {
            let target_kind = if order.kind == OrderKind::Market {
                "position"
            } else {
                "pending_order"
            };
            let (link_source_kind, link_source_id) = copier_link_source_identity(change, operation);
            let link_target_leg = if matches!(
                change,
                PortfolioChange::PendingReplaced { .. }
                    | PortfolioChange::PendingFilled { .. }
                    | PortfolioChange::PositionIncreased { .. }
            ) {
                sqlx::query_scalar::<_, i32>(
                    r#"
                    SELECT COALESCE(
                        (
                            SELECT target_leg
                            FROM execution_copy_links
                            WHERE user_id = $1 AND group_id = $2 AND target_account_id = $3
                              AND source_entity_kind = $4 AND source_entity_id = $5
                              AND metadata->>'commandId' = $6
                            LIMIT 1
                        ),
                        (
                            SELECT COALESCE(max(target_leg), -1) + 1
                            FROM execution_copy_links
                            WHERE user_id = $1 AND group_id = $2 AND target_account_id = $3
                              AND source_entity_kind = $4 AND source_entity_id = $5
                        )
                    )
                    "#,
                )
                .bind(owner_uuid)
                .bind(group_id)
                .bind(target_account_id)
                .bind(link_source_kind)
                .bind(link_source_id)
                .bind(order.command_id.as_str())
                .fetch_one(&mut *transaction)
                .await
                .map_err(|error| {
                    CopierWorkError::api(ApiError::database(
                        "allocate replacement copier target leg",
                        error,
                    ))
                })?
            } else {
                target_leg.unwrap_or(0)
            };
            let source_quantity = copier_source_quantity(change);
            sqlx::query(
                r#"
                INSERT INTO execution_copy_links (
                    user_id, group_id, source_account_id, target_account_id,
                    source_entity_kind, source_entity_id, target_leg,
                    target_entity_kind, lifecycle_status,
                    source_quantity, target_quantity, last_source_event_id,
                    metadata, opened_at
                )
                SELECT $1, $2, groups.source_account_id, $3,
                       $4, $5, $15, NULL, 'pending', $7, $8, $9,
                       jsonb_build_object(
                           'commandId', $10,
                           'venueSymbol', $11,
                           'canonicalSymbol', $12,
                           'side', $13,
                           'workItemId', $14::text,
                           'expectedTargetKind', $6
                       ), now()
                FROM execution_copy_groups groups
                WHERE groups.user_id = $1 AND groups.id = $2
                ON CONFLICT (
                    user_id, group_id, target_account_id,
                    source_entity_kind, source_entity_id, target_leg
                ) DO UPDATE
                SET target_entity_kind = execution_copy_links.target_entity_kind,
                    lifecycle_status = CASE
                        WHEN execution_copy_links.lifecycle_status IN ('active', 'closing')
                        THEN execution_copy_links.lifecycle_status
                        ELSE 'pending'
                    END,
                    source_quantity = EXCLUDED.source_quantity,
                    target_quantity = EXCLUDED.target_quantity,
                    last_source_event_id = EXCLUDED.last_source_event_id,
                    metadata = execution_copy_links.metadata || EXCLUDED.metadata,
                    revision = execution_copy_links.revision + 1,
                    updated_at = now()
                "#,
            )
            .bind(owner_uuid)
            .bind(group_id)
            .bind(target_account_id)
            .bind(link_source_kind)
            .bind(link_source_id)
            .bind(target_kind)
            .bind(source_quantity)
            .bind(order.quantity)
            .bind(change.kind())
            .bind(order.command_id.as_str())
            .bind(&order.venue_symbol)
            .bind(&order.canonical_symbol)
            .bind(copier_side_name(order.side))
            .bind(work_id)
            .bind(link_target_leg)
            .execute(&mut *transaction)
            .await
            .map_err(|error| {
                CopierWorkError::api(ApiError::database("persist copier link", error))
            })?;
        } else if let Some(command_id) = command_id(command) {
            sqlx::query(
                r#"
                UPDATE execution_copy_links
                SET metadata = metadata || jsonb_build_object(
                        'lastCommandId', $6,
                        'lastWorkItemId', $7::text
                    ),
                    last_source_event_id = $8,
                    revision = revision + 1,
                    updated_at = now()
                WHERE user_id = $1 AND group_id = $2 AND target_account_id = $3
                  AND source_entity_kind = $4 AND source_entity_id = $5
                  AND ($9::integer IS NULL OR target_leg = $9)
                  AND lifecycle_status NOT IN ('closed', 'cancelled', 'orphaned')
                "#,
            )
            .bind(owner_uuid)
            .bind(group_id)
            .bind(target_account_id)
            .bind(copy_source_entity_kind(change))
            .bind(change.source_resource_id())
            .bind(command_id)
            .bind(work_id)
            .bind(change.kind())
            .bind(target_leg)
            .execute(&mut *transaction)
            .await
            .map_err(|error| {
                CopierWorkError::api(ApiError::database(
                    "associate copier lifecycle command",
                    error,
                ))
            })?;
        }
        transaction.commit().await.map_err(|error| {
            CopierWorkError::api(ApiError::database("commit copier outbox", error))
        })
    }

    async fn publish_copier_outbox(
        &self,
        owner_uuid: Uuid,
        work_id: Uuid,
        target_command_id: &str,
        change: &PortfolioChange,
    ) -> Result<(), CopierWorkError> {
        let Some(database) = &self.inner.database else {
            return Ok(());
        };
        let mut transaction = database.begin().await.map_err(|error| {
            CopierWorkError::api(ApiError::database("begin copier publish", error))
        })?;
        sqlx::query(
            r#"
            UPDATE execution_copy_command_outbox
            SET target_command_id = $3,
                status = 'published',
                published_at = COALESCE(published_at, now()),
                lease_owner = NULL,
                lease_expires_at = NULL,
                updated_at = now()
            WHERE user_id = $1 AND work_item_id = $2
              AND status IN ('pending', 'publishing', 'published', 'retry')
            "#,
        )
        .bind(owner_uuid)
        .bind(work_id)
        .bind(target_command_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            CopierWorkError::api(ApiError::database("publish copier outbox", error))
        })?;
        sqlx::query(
            r#"
            UPDATE execution_copy_work_items
            SET status = 'succeeded', completed_at = now(),
                lease_owner = NULL, lease_expires_at = NULL,
                last_error = NULL, updated_at = now()
            WHERE user_id = $1 AND id = $2 AND status IN ('leased', 'succeeded')
            "#,
        )
        .bind(owner_uuid)
        .bind(work_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            CopierWorkError::api(ApiError::database("complete copier publish work", error))
        })?;
        if matches!(
            change,
            PortfolioChange::PositionClosed { .. }
                | PortfolioChange::PendingCancelled { .. }
                | PortfolioChange::PendingReplaced { .. }
        ) {
            sqlx::query(
                r#"
                UPDATE execution_copy_links links
                SET lifecycle_status = 'closing', revision = revision + 1, updated_at = now()
                FROM execution_copy_work_items work
                WHERE work.user_id = $1 AND work.id = $2
                  AND links.user_id = work.user_id AND links.group_id = work.group_id
                  AND links.target_account_id = work.target_account_id
                  AND links.source_entity_kind = $3 AND links.source_entity_id = $4
                  AND (
                      links.metadata->>'lastWorkItemId' = work.id::text OR
                      links.metadata->>'workItemId' = work.id::text
                  )
                  AND links.lifecycle_status NOT IN ('closed', 'cancelled')
                "#,
            )
            .bind(owner_uuid)
            .bind(work_id)
            .bind(copy_source_entity_kind(change))
            .bind(change.source_resource_id())
            .execute(&mut *transaction)
            .await
            .map_err(|error| {
                CopierWorkError::api(ApiError::database("mark copier link closing", error))
            })?;
        }
        transaction.commit().await.map_err(|error| {
            CopierWorkError::api(ApiError::database("commit copier publish", error))
        })
    }

    async fn complete_continuous_copier_work(
        &self,
        owner_uuid: Uuid,
        group_id: Uuid,
        work_id: Uuid,
        target_account_id: &str,
        lifecycle_status: Option<&str>,
        change: &PortfolioChange,
    ) -> Result<(), CopierWorkError> {
        let Some(database) = &self.inner.database else {
            return Ok(());
        };
        let mut transaction = database.begin().await.map_err(|error| {
            CopierWorkError::api(ApiError::database("begin complete copier work", error))
        })?;
        sqlx::query(
            r#"
            UPDATE execution_copy_work_items
            SET status = 'succeeded', completed_at = now(), last_error = NULL,
                lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
            WHERE user_id = $1 AND id = $2
              AND status IN ('pending', 'leased', 'retry')
            "#,
        )
        .bind(owner_uuid)
        .bind(work_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| CopierWorkError::api(ApiError::database("complete copier work", error)))?;
        if let Some(lifecycle_status) = lifecycle_status {
            sqlx::query(
                r#"
                UPDATE execution_copy_links
                SET lifecycle_status = $6,
                    closed_at = CASE WHEN $6 IN ('closed', 'cancelled') THEN now() ELSE closed_at END,
                    revision = revision + 1, updated_at = now()
                WHERE user_id = $1 AND group_id = $2 AND target_account_id = $3
                  AND source_entity_kind = $4 AND source_entity_id = $5
                "#,
            )
            .bind(owner_uuid)
            .bind(group_id)
            .bind(target_account_id)
            .bind(copy_source_entity_kind(change))
            .bind(change.source_resource_id())
            .bind(lifecycle_status)
            .execute(&mut *transaction)
            .await
            .map_err(|error| {
                CopierWorkError::api(ApiError::database("complete copier link", error))
            })?;
        }
        transaction.commit().await.map_err(|error| {
            CopierWorkError::api(ApiError::database("commit completed copier work", error))
        })
    }

    async fn supersede_continuous_copier_work(
        &self,
        owner_uuid: Uuid,
        group_id: Uuid,
        work_id: Uuid,
        target_account_id: &str,
        change: &PortfolioChange,
        reason: &str,
    ) -> Result<(), CopierWorkError> {
        let Some(database) = &self.inner.database else {
            return Ok(());
        };
        let mut transaction = database.begin().await.map_err(|error| {
            CopierWorkError::api(ApiError::database("begin supersede copier work", error))
        })?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!(
                "continuous-copier-target:{owner_uuid}:{group_id}:{target_account_id}"
            ))
            .execute(&mut *transaction)
            .await
            .map_err(|error| {
                CopierWorkError::api(ApiError::database("lock stale copier work", error))
            })?;
        let command_was_issued = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM execution_copy_command_outbox outbox
                JOIN execution_target_commands target_command
                  ON target_command.user_id = outbox.user_id
                 AND target_command.id = COALESCE(
                     outbox.target_command_id,
                     outbox.command_payload #>> '{order,commandId}',
                     outbox.command_payload #>> '{command,commandId}'
                 )
                WHERE outbox.user_id = $1 AND outbox.work_item_id = $2
            )
            "#,
        )
        .bind(owner_uuid)
        .bind(work_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| {
            CopierWorkError::api(ApiError::database("recheck stale copier command", error))
        })?;
        if command_was_issued {
            return Err(CopierWorkError::retryable(
                "COPY_COMMAND_ALREADY_ISSUED",
                "the stale copier work already has a durable target command and must reconcile idempotently",
            ));
        }
        sqlx::query(
            r#"
            UPDATE execution_copy_work_items
            SET status = 'superseded', completed_at = now(), last_error = $3,
                lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
            WHERE user_id = $1 AND id = $2
              AND status IN ('pending', 'leased', 'retry')
            "#,
        )
        .bind(owner_uuid)
        .bind(work_id)
        .bind(reason)
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            CopierWorkError::api(ApiError::database("supersede copier work", error))
        })?;
        sqlx::query(
            r#"
            UPDATE execution_copy_command_outbox
            SET status = 'dead_letter', last_error = $3,
                lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
            WHERE user_id = $1 AND work_item_id = $2
              AND status NOT IN ('published', 'acknowledged')
            "#,
        )
        .bind(owner_uuid)
        .bind(work_id)
        .bind(reason)
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            CopierWorkError::api(ApiError::database("supersede copier outbox", error))
        })?;
        sqlx::query(
            r#"
            UPDATE execution_copy_links
            SET lifecycle_status = 'cancelled', closed_at = COALESCE(closed_at, now()),
                last_source_event_id = $6,
                metadata = metadata || jsonb_build_object('supersededReason', $7),
                revision = revision + 1, updated_at = now()
            WHERE user_id = $1 AND group_id = $2 AND target_account_id = $3
              AND source_entity_kind = $4 AND source_entity_id = $5
              AND metadata->>'workItemId' = $8::text
              AND lifecycle_status = 'pending'
            "#,
        )
        .bind(owner_uuid)
        .bind(group_id)
        .bind(target_account_id)
        .bind(copy_source_entity_kind(change))
        .bind(change.source_resource_id())
        .bind(change.kind())
        .bind(reason)
        .bind(work_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            CopierWorkError::api(ApiError::database("supersede copier link", error))
        })?;
        transaction.commit().await.map_err(|error| {
            CopierWorkError::api(ApiError::database("commit superseded copier work", error))
        })
    }

    async fn reconcile_continuous_copy_target(
        &self,
        owner_uuid: Uuid,
        group_id: Uuid,
        work_id: Uuid,
        target_account_id: &str,
        change: &PortfolioChange,
        target_leg: Option<i32>,
    ) -> Result<(), CopierWorkError> {
        let Some(database) = &self.inner.database else {
            return Ok(());
        };
        if let PortfolioChange::PendingFilled { previous, position } = change {
            let link = sqlx::query(
                r#"
                SELECT id, target_entity_kind, target_entity_id, metadata,
                       lifecycle_status
                FROM execution_copy_links
                WHERE user_id = $1 AND group_id = $2 AND target_account_id = $3
                  AND source_entity_kind = 'pending_order' AND source_entity_id = $4
                  AND ($5::integer IS NULL OR target_leg = $5)
                  AND lifecycle_status NOT IN ('closed', 'cancelled')
                ORDER BY target_leg
                LIMIT 1
                "#,
            )
            .bind(owner_uuid)
            .bind(group_id)
            .bind(target_account_id)
            .bind(&previous.broker_order_id)
            .bind(target_leg)
            .fetch_optional(database)
            .await
            .map_err(|error| {
                CopierWorkError::api(ApiError::database("load pending-fill copier link", error))
            })?;
            let Some(link) = link else {
                return self
                    .complete_continuous_copier_work(
                        owner_uuid,
                        group_id,
                        work_id,
                        target_account_id,
                        None,
                        change,
                    )
                    .await;
            };
            let link_id: Uuid = link.try_get("id").map_err(|error| {
                CopierWorkError::api(ApiError::database("decode pending-fill link", error))
            })?;
            let link_lifecycle_status: String =
                link.try_get("lifecycle_status").map_err(|error| {
                    CopierWorkError::api(ApiError::database(
                        "decode pending-fill link lifecycle",
                        error,
                    ))
                })?;
            if matches!(link_lifecycle_status.as_str(), "error" | "orphaned") {
                return Err(CopierWorkError::retryable(
                    "COPY_PENDING_FILL_LINK_UNRESOLVED",
                    "the target pending link is unresolved and requires reconciliation before fill adoption",
                ));
            }
            let target_entity_id = link
                .try_get::<Option<String>, _>("target_entity_id")
                .map_err(|error| {
                    CopierWorkError::api(ApiError::database("decode pending-fill target", error))
                })?;
            let link_metadata = link
                .try_get::<sqlx::types::Json<serde_json::Value>, _>("metadata")
                .map_err(|error| {
                    CopierWorkError::api(ApiError::database(
                        "decode pending-fill link metadata",
                        error,
                    ))
                })?
                .0;
            let expected_target_side = copier_expected_target_side(&link_metadata, position.side);
            if let Some(target_entity_id) = target_entity_id.as_deref() {
                let still_pending = sqlx::query_scalar::<_, bool>(
                    r#"
                    SELECT EXISTS (
                        SELECT 1 FROM execution_pending_orders
                        WHERE user_id = $1 AND account_id = $2 AND broker_order_id = $3
                    )
                    "#,
                )
                .bind(owner_uuid)
                .bind(target_account_id)
                .bind(target_entity_id)
                .fetch_one(database)
                .await
                .map_err(|error| {
                    CopierWorkError::api(ApiError::database(
                        "check pending-fill target order",
                        error,
                    ))
                })?;
                if still_pending {
                    return Err(CopierWorkError::retryable(
                        "COPY_PENDING_FILL_WAIT",
                        "source pending order filled while the target pending order is still open",
                    ));
                }
            }
            let candidate = sqlx::query_scalar::<_, String>(
                r#"
                SELECT candidates.broker_position_id
                FROM (
                    SELECT events.payload->>'brokerPositionId' AS broker_position_id,
                           0 AS priority, events.occurred_at AS observed_at
                    FROM execution_events events
                    WHERE events.user_id = $1 AND events.account_id = $2
                      AND $3::text IS NOT NULL
                      AND events.event_type = 'trade.transaction'
                      AND events.payload->>'brokerOrderId' = $3
                      AND NULLIF(events.payload->>'brokerPositionId', '') IS NOT NULL

                    UNION ALL

                    SELECT positions.broker_position_id,
                           CASE WHEN positions.snapshot->>'comment' LIKE 'SMC:%'
                                THEN 1 ELSE 2 END AS priority,
                           positions.observed_at
                    FROM execution_positions positions
                    WHERE positions.user_id = $1 AND positions.account_id = $2
                      AND upper(positions.snapshot->>'canonicalSymbol') = upper($4)
                      AND positions.snapshot->>'side' = $5
                      AND NOT EXISTS (
                          SELECT 1
                          FROM execution_copy_links other
                          WHERE other.user_id = $1
                            AND other.target_account_id = $2
                            AND other.target_entity_kind = 'position'
                            AND other.target_entity_id = positions.broker_position_id
                            AND other.id <> $6
                            AND other.lifecycle_status NOT IN ('closed', 'cancelled', 'orphaned')
                      )
                ) candidates
                ORDER BY candidates.priority, candidates.observed_at DESC,
                         candidates.broker_position_id
                LIMIT 1
                "#,
            )
            .bind(owner_uuid)
            .bind(target_account_id)
            .bind(target_entity_id.as_deref())
            .bind(&position.canonical_symbol)
            .bind(expected_target_side)
            .bind(link_id)
            .fetch_optional(database)
            .await
            .map_err(|error| {
                CopierWorkError::api(ApiError::database("reconcile pending-fill position", error))
            })?
            .ok_or_else(|| {
                CopierWorkError::retryable(
                    "COPY_PENDING_FILL_UNRESOLVED",
                    "target pending fill has not appeared in its portfolio snapshot yet",
                )
            })?;
            sqlx::query(
                r#"
                UPDATE execution_copy_links
                SET source_entity_kind = 'position', source_entity_id = $4,
                    target_entity_kind = 'position', target_entity_id = $3,
                    target_leg = CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM execution_copy_links other
                            WHERE other.user_id = execution_copy_links.user_id
                              AND other.group_id = execution_copy_links.group_id
                              AND other.target_account_id = execution_copy_links.target_account_id
                              AND other.source_entity_kind = 'position'
                              AND other.source_entity_id = $4
                              AND other.target_leg = execution_copy_links.target_leg
                              AND other.id <> execution_copy_links.id
                        ) THEN (
                            SELECT COALESCE(max(other.target_leg), -1) + 1
                            FROM execution_copy_links other
                            WHERE other.user_id = execution_copy_links.user_id
                              AND other.group_id = execution_copy_links.group_id
                              AND other.target_account_id = execution_copy_links.target_account_id
                              AND other.source_entity_kind = 'position'
                              AND other.source_entity_id = $4
                        )
                        ELSE target_leg
                    END,
                    source_quantity = $5, last_source_event_id = 'pending.filled',
                    metadata = metadata || jsonb_build_object(
                        'originatingPendingOrderId', $6
                    ),
                    lifecycle_status = 'active', last_reconciled_at = now(),
                    revision = revision + 1, updated_at = now()
                WHERE user_id = $1 AND id = $2
                "#,
            )
            .bind(owner_uuid)
            .bind(link_id)
            .bind(candidate)
            .bind(&position.broker_position_id)
            .bind(previous.quantity)
            .bind(&previous.broker_order_id)
            .execute(database)
            .await
            .map_err(|error| {
                CopierWorkError::api(ApiError::database("bind pending-fill position", error))
            })?;
        }
        self.complete_continuous_copier_work(
            owner_uuid,
            group_id,
            work_id,
            target_account_id,
            None,
            change,
        )
        .await
    }

    async fn fail_continuous_copier_work(
        &self,
        owner_uuid: Uuid,
        group_id: Uuid,
        work_id: Uuid,
        target_account_id: &str,
        attempt_count: i32,
        failure: CopierWorkError,
    ) -> Result<(), ApiError> {
        let Some(database) = &self.inner.database else {
            return Ok(());
        };
        let will_retry = failure.retryable && attempt_count < 12;
        let retry_seconds = 1_i64 << attempt_count.clamp(0, 8);
        let mut transaction = database
            .begin()
            .await
            .map_err(|error| ApiError::database("begin copier failure", error))?;
        let work_update = sqlx::query(
            r#"
            UPDATE execution_copy_work_items
            SET status = $3,
                available_at = CASE WHEN $3 = 'retry'
                    THEN now() + make_interval(secs => $4::double precision)
                    ELSE available_at END,
                last_error = $5,
                lease_owner = NULL, lease_expires_at = NULL,
                completed_at = CASE WHEN $3 = 'dead_letter' THEN now() ELSE NULL END,
                updated_at = now()
            WHERE user_id = $1 AND id = $2
              AND status IN ('pending', 'leased', 'retry')
            "#,
        )
        .bind(owner_uuid)
        .bind(work_id)
        .bind(if will_retry { "retry" } else { "dead_letter" })
        .bind(retry_seconds)
        .bind(&failure.message)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("fail copier work", error))?;
        if work_update.rows_affected() == 0 {
            transaction
                .commit()
                .await
                .map_err(|error| ApiError::database("commit ignored copier failure", error))?;
            return Ok(());
        }
        sqlx::query(
            r#"
            UPDATE execution_copy_command_outbox
            SET status = CASE WHEN $3 THEN 'retry' ELSE 'dead_letter' END,
                available_at = CASE WHEN $3
                    THEN now() + make_interval(secs => $4::double precision)
                    ELSE available_at END,
                last_error = $5,
                lease_owner = NULL, lease_expires_at = NULL,
                updated_at = now()
            WHERE user_id = $1 AND work_item_id = $2
              AND status NOT IN ('published', 'acknowledged')
            "#,
        )
        .bind(owner_uuid)
        .bind(work_id)
        .bind(will_retry)
        .bind(retry_seconds)
        .bind(&failure.message)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("fail copier outbox", error))?;
        sqlx::query(
            r#"
            INSERT INTO execution_copy_errors (
                user_id, group_id, target_account_id, work_item_id,
                error_code, message, context, retryable
            )
            VALUES (
                $1, $2, $3, $4, $5, $6,
                jsonb_build_object('attemptCount', $7, 'willRetry', $8), $8
            )
            "#,
        )
        .bind(owner_uuid)
        .bind(group_id)
        .bind(target_account_id)
        .bind(work_id)
        .bind(&failure.code)
        .bind(&failure.message)
        .bind(attempt_count)
        .bind(will_retry)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("record copier failure", error))?;
        sqlx::query(
            r#"
            UPDATE execution_copy_targets
            SET runtime_status = $4, status_message = $5,
                last_error_at = now(), updated_at = now()
            WHERE user_id = $1 AND group_id = $2 AND account_id = $3
            "#,
        )
        .bind(owner_uuid)
        .bind(group_id)
        .bind(target_account_id)
        .bind(if will_retry { "waiting" } else { "error" })
        .bind(&failure.message)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("update copier target failure", error))?;
        sqlx::query(
            r#"
            UPDATE execution_copy_groups
            SET runtime_status = CASE WHEN $3 THEN 'degraded' ELSE 'error' END,
                status_message = $4, updated_at = now()
            WHERE user_id = $1 AND id = $2 AND runtime_status <> 'paused'
            "#,
        )
        .bind(owner_uuid)
        .bind(group_id)
        .bind(will_retry)
        .bind(&failure.message)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("update copier group failure", error))?;
        transaction
            .commit()
            .await
            .map_err(|error| ApiError::database("commit copier failure", error))
    }

    async fn load_route_target(
        &self,
        owner_uuid: Uuid,
        target: &AdminOrderTarget,
        canonical_symbol: &str,
        side: Side,
    ) -> Result<Option<RouteTargetContext>, ApiError> {
        let Some(database) = &self.inner.database else {
            return Err(ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "PERSISTENT_STORE_REQUIRED",
                "production order routing requires PostgreSQL",
            ));
        };
        let row = sqlx::query(
            r#"
            SELECT
                accounts.id,
                accounts.user_id::text AS owner_id,
                accounts.label,
                accounts.venue_kind,
                accounts.broker_code,
                accounts.external_account_ref,
                accounts.server,
                accounts.mode,
                accounts.status,
                accounts.currency,
                accounts.balance,
                accounts.equity,
                accounts.trade_allowed,
                accounts.metadata->>'eaVersion' AS ea_version,
                floor(extract(epoch FROM accounts.updated_at) * 1000)::bigint
                    AS updated_at_ms,
                instruments.snapshot,
                instruments.bid,
                instruments.ask,
                floor(extract(epoch FROM instruments.observed_at) * 1000)::bigint
                    AS observed_at_ms,
                COALESCE(policy.max_risk_per_trade_basis_points, 100)
                    AS max_risk_basis_points,
                policy.max_order_quantity,
                COALESCE(policy.require_stop_loss, true) AS require_stop_loss,
                COALESCE(policy.allowed_symbols, '{}'::text[]) AS allowed_symbols,
                COALESCE(policy.blocked_symbols, '{}'::text[]) AS blocked_symbols,
                EXISTS (
                    SELECT 1
                    FROM execution_ea_sessions sessions
                    WHERE sessions.user_id = accounts.user_id
                      AND sessions.account_id = accounts.id
                      AND sessions.revoked_at IS NULL
                      AND sessions.expires_at > now()
                      AND sessions.absolute_expires_at > now()
                      AND sessions.last_poll_at >
                          now() - ($4 * interval '1 millisecond')
                ) AS connected
            FROM execution_accounts accounts
            LEFT JOIN execution_symbol_mappings mappings
              ON mappings.user_id = accounts.user_id
             AND mappings.account_id = accounts.id
             AND upper(mappings.canonical_symbol) = upper($3)
             AND mappings.enabled = true
            LEFT JOIN execution_instruments instruments
              ON instruments.user_id = mappings.user_id
             AND instruments.account_id = mappings.account_id
             AND instruments.venue_symbol = mappings.venue_symbol
            LEFT JOIN execution_risk_policies policy
              ON policy.user_id = accounts.user_id
             AND policy.account_id = accounts.id
            WHERE accounts.user_id = $1
              AND accounts.status <> 'disabled'
              AND accounts.id = $2
            "#,
        )
        .bind(owner_uuid)
        .bind(target.account_id.as_str())
        .bind(canonical_symbol.trim())
        .bind(EA_POLL_FRESHNESS.as_millis() as i64)
        .fetch_optional(database)
        .await
        .map_err(|error| ApiError::database("load order route target", error))?;
        let Some(row) = row else {
            return Ok(None);
        };
        let instrument = row
            .try_get::<Option<sqlx::types::Json<InstrumentSpec>>, _>("snapshot")
            .map_err(|error| ApiError::database("decode route instrument", error))?
            .map(|snapshot| snapshot.0);
        let Some(mut instrument) = instrument else {
            return Ok(None);
        };
        instrument.canonical_symbol = canonical_symbol.trim().to_owned();
        let connected: bool = row
            .try_get("connected")
            .map_err(|error| ApiError::database("decode route connection", error))?;
        let supported_ea = ea_version_supported(
            row.try_get::<Option<String>, _>("ea_version")
                .map_err(|error| ApiError::database("decode EA version", error))?
                .as_deref(),
        );
        let stored_status: String = row
            .try_get("status")
            .map_err(|error| ApiError::database("decode route status", error))?;
        let observed_at_ms = row
            .try_get::<Option<i64>, _>("observed_at_ms")
            .map_err(|error| ApiError::database("decode quote time", error))?
            .unwrap_or_default()
            .max(0) as u64;
        let quote_is_fresh =
            now_ms().saturating_sub(observed_at_ms) <= MAX_QUOTE_AGE.as_millis() as u64;
        let reference_price = if quote_is_fresh {
            match side {
                Side::Buy => row
                    .try_get::<Option<Decimal>, _>("ask")
                    .map_err(|error| ApiError::database("decode ask quote", error))?,
                Side::Sell => row
                    .try_get::<Option<Decimal>, _>("bid")
                    .map_err(|error| ApiError::database("decode bid quote", error))?,
            }
        } else {
            None
        };
        let account_status = if !connected {
            AccountStatus::Offline
        } else if !supported_ea {
            AccountStatus::Blocked
        } else {
            parse_account_status(&stored_status)
        };
        Ok(Some(RouteTargetContext {
            account: ExecutionAccount {
                id: target.account_id.clone(),
                owner_id: row
                    .try_get("owner_id")
                    .map_err(|error| ApiError::database("decode route owner", error))?,
                label: row
                    .try_get("label")
                    .map_err(|error| ApiError::database("decode route label", error))?,
                venue_kind: parse_venue_kind(
                    &row.try_get::<String, _>("venue_kind")
                        .map_err(|error| ApiError::database("decode route venue", error))?,
                )?,
                broker_code: row
                    .try_get("broker_code")
                    .map_err(|error| ApiError::database("decode route broker", error))?,
                external_account_ref: row
                    .try_get("external_account_ref")
                    .map_err(|error| ApiError::database("decode external account", error))?,
                server: row
                    .try_get::<String, _>("server")
                    .map_err(|error| ApiError::database("decode route server", error))?
                    .into(),
                mode: parse_account_mode(
                    &row.try_get::<String, _>("mode")
                        .map_err(|error| ApiError::database("decode account mode", error))?,
                ),
                status: account_status,
                currency: row
                    .try_get("currency")
                    .map_err(|error| ApiError::database("decode account currency", error))?,
                balance: row
                    .try_get("balance")
                    .map_err(|error| ApiError::database("decode account balance", error))?,
                equity: row
                    .try_get("equity")
                    .map_err(|error| ApiError::database("decode account equity", error))?,
                trade_allowed: row
                    .try_get("trade_allowed")
                    .map_err(|error| ApiError::database("decode trade permission", error))?,
                updated_at_ms: row
                    .try_get::<i64, _>("updated_at_ms")
                    .map_err(|error| ApiError::database("decode account update time", error))?
                    as u64,
            },
            instrument,
            policy: RiskPolicy {
                max_risk_per_trade_basis_points: row
                    .try_get::<i32, _>("max_risk_basis_points")
                    .map_err(|error| ApiError::database("decode risk limit", error))?
                    as u32,
                max_order_quantity: row
                    .try_get("max_order_quantity")
                    .map_err(|error| ApiError::database("decode quantity limit", error))?,
                require_stop_loss: row
                    .try_get("require_stop_loss")
                    .map_err(|error| ApiError::database("decode stop policy", error))?,
                allowed_symbols: row
                    .try_get("allowed_symbols")
                    .map_err(|error| ApiError::database("decode symbol allow-list", error))?,
                blocked_symbols: row
                    .try_get("blocked_symbols")
                    .map_err(|error| ApiError::database("decode symbol block-list", error))?,
            },
            copy_target: CopyTarget {
                account_id: target.account_id.clone(),
                enabled: true,
                allocation: target.allocation.clone(),
                max_quantity: target.max_quantity,
            },
            reference_price,
        }))
    }

    async fn source_equity(
        &self,
        owner_uuid: Uuid,
        account_id: Option<&AccountId>,
    ) -> Result<Option<Decimal>, ApiError> {
        let Some(account_id) = account_id else {
            return Ok(None);
        };
        let Some(database) = &self.inner.database else {
            return Ok(None);
        };
        sqlx::query_scalar::<_, Option<Decimal>>(
            "SELECT equity FROM execution_accounts WHERE user_id = $1 AND id = $2 AND status <> 'disabled'",
        )
        .bind(owner_uuid)
        .bind(account_id.as_str())
        .fetch_optional(database)
        .await
        .map(|value| value.flatten())
        .map_err(|error| ApiError::database("load source account equity", error))
    }

    async fn audit_order_route_outcome(
        &self,
        owner_uuid: Uuid,
        intent: &OrderIntent,
        account_id: &AccountId,
        action: &'static str,
        code: &str,
        message: &str,
    ) -> Result<(), ApiError> {
        let Some(database) = &self.inner.database else {
            return Ok(());
        };
        let details = serde_json::json!({
            "commandId": intent.command_id.as_str(),
            "sourceAccountId": intent.source_account_id.as_ref().map(AccountId::as_str),
            "canonicalSymbol": intent.canonical_symbol,
            "side": intent.side,
            "kind": intent.kind,
            "code": code,
            "message": message,
        });
        sqlx::query(
            r#"
            INSERT INTO execution_audit_log (
                user_id, actor_type, actor_id, action,
                resource_type, resource_id, details
            )
            VALUES (
                $1, 'user', $1::text, $2,
                'execution_account', $3, $4
            )
            "#,
        )
        .bind(owner_uuid)
        .bind(action)
        .bind(account_id.as_str())
        .bind(sqlx::types::Json(details))
        .execute(database)
        .await
        .map_err(|error| ApiError::database("audit order route outcome", error))?;
        Ok(())
    }

    async fn validate_lifecycle_resource(
        &self,
        owner_uuid: Uuid,
        command: &EaCommand,
    ) -> Result<(), ApiError> {
        let Some(database) = &self.inner.database else {
            return Ok(());
        };
        let prop_policy = if let Some(account_id) = command_target_account(command) {
            self.load_prop_risk_policy(owner_uuid, account_id).await?
        } else {
            None
        };
        match command {
            EaCommand::ModifyPosition { command } => {
                let row = sqlx::query(
                    r#"
                    SELECT
                        positions.snapshot,
                        instruments.snapshot AS instrument
                    FROM execution_positions positions
                    LEFT JOIN execution_instruments instruments
                      ON instruments.user_id = positions.user_id
                     AND instruments.account_id = positions.account_id
                     AND instruments.venue_symbol =
                         positions.snapshot->>'venueSymbol'
                    WHERE positions.user_id = $1
                      AND positions.account_id = $2
                      AND positions.broker_position_id = $3
                    "#,
                )
                .bind(owner_uuid)
                .bind(command.target_account_id.as_str())
                .bind(&command.broker_position_id)
                .fetch_optional(database)
                .await
                .map_err(|error| ApiError::database("load position modification target", error))?
                .ok_or_else(lifecycle_resource_not_found)?;
                let position = row
                    .try_get::<sqlx::types::Json<EaPositionSnapshot>, _>("snapshot")
                    .map_err(|error| ApiError::database("decode position target", error))?
                    .0;
                let instrument = row
                    .try_get::<Option<sqlx::types::Json<InstrumentSpec>>, _>("instrument")
                    .map_err(|error| ApiError::database("decode position instrument", error))?
                    .map(|value| value.0);
                validate_position_modification(
                    &position,
                    instrument
                        .as_ref()
                        .and_then(|value| value.min_stop_distance),
                    command.stop_loss,
                    command.take_profit,
                )?;
                if let Some((rules, actions)) = &prop_policy {
                    validate_prop_risk_modification(
                        rules,
                        actions,
                        position.current_price,
                        position.stop_loss,
                        position.current_price,
                        command.stop_loss,
                        position.quantity,
                        instrument.as_ref(),
                    )?;
                }
                Ok(())
            }
            EaCommand::ModifyPendingOrder { command } => {
                let row = sqlx::query(
                    r#"
                    SELECT
                        pending.snapshot,
                        instruments.snapshot AS instrument
                    FROM execution_pending_orders pending
                    LEFT JOIN execution_instruments instruments
                      ON instruments.user_id = pending.user_id
                     AND instruments.account_id = pending.account_id
                     AND instruments.venue_symbol =
                         pending.snapshot->>'venueSymbol'
                    WHERE pending.user_id = $1
                      AND pending.account_id = $2
                      AND pending.broker_order_id = $3
                    "#,
                )
                .bind(owner_uuid)
                .bind(command.target_account_id.as_str())
                .bind(&command.broker_order_id)
                .fetch_optional(database)
                .await
                .map_err(|error| {
                    ApiError::database("load pending order modification target", error)
                })?
                .ok_or_else(lifecycle_resource_not_found)?;
                let order = row
                    .try_get::<sqlx::types::Json<EaPendingOrderSnapshot>, _>("snapshot")
                    .map_err(|error| ApiError::database("decode pending order target", error))?
                    .0;
                let instrument = row
                    .try_get::<Option<sqlx::types::Json<InstrumentSpec>>, _>("instrument")
                    .map_err(|error| ApiError::database("decode pending order instrument", error))?
                    .map(|value| value.0);
                validate_pending_order_modification(
                    &order,
                    instrument
                        .as_ref()
                        .and_then(|value| value.min_stop_distance),
                    command.price,
                    command.stop_loss,
                    command.take_profit,
                )?;
                if let Some((rules, actions)) = &prop_policy {
                    validate_prop_risk_modification(
                        rules,
                        actions,
                        order.price,
                        order.stop_loss,
                        command.price,
                        command.stop_loss,
                        order.quantity,
                        instrument.as_ref(),
                    )?;
                }
                Ok(())
            }
            EaCommand::ClosePosition { command } => {
                let position = sqlx::query_scalar::<_, sqlx::types::Json<EaPositionSnapshot>>(
                    r#"
                    SELECT snapshot
                    FROM execution_positions
                    WHERE user_id = $1
                      AND account_id = $2
                      AND broker_position_id = $3
                    "#,
                )
                .bind(owner_uuid)
                .bind(command.target_account_id.as_str())
                .bind(&command.broker_position_id)
                .fetch_optional(database)
                .await
                .map_err(|error| ApiError::database("load position close target", error))?
                .ok_or_else(lifecycle_resource_not_found)?
                .0;
                if command
                    .quantity
                    .is_some_and(|quantity| quantity > position.quantity)
                {
                    return Err(ApiError::new(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "CLOSE_QUANTITY_EXCEEDS_POSITION",
                        "close quantity exceeds the current position quantity",
                    ));
                }
                Ok(())
            }
            EaCommand::CancelOrder { command } => {
                let exists = sqlx::query_scalar::<_, bool>(
                    r#"
                    SELECT EXISTS (
                        SELECT 1
                        FROM execution_pending_orders
                        WHERE user_id = $1
                          AND account_id = $2
                          AND broker_order_id = $3
                    )
                    "#,
                )
                .bind(owner_uuid)
                .bind(command.target_account_id.as_str())
                .bind(&command.broker_order_id)
                .fetch_one(database)
                .await
                .map_err(|error| ApiError::database("load cancel order target", error))?;
                if !exists {
                    return Err(lifecycle_resource_not_found());
                }
                Ok(())
            }
            EaCommand::Place { .. } | EaCommand::Sync => Ok(()),
        }
    }

    async fn prune_sessions(&self, now: u64) {
        self.inner
            .sessions
            .lock()
            .await
            .retain(|_, session| session.expires_at_ms > now);
    }

    async fn consume_trade_authorization(
        &self,
        owner_uuid: Uuid,
        session_uuid: Uuid,
        operation: &str,
        payload: serde_json::Value,
        raw_token: &str,
    ) -> Result<(), ApiError> {
        if raw_token.len() != 43 {
            return Err(trade_authorization_rejected());
        }
        let Some(database) = &self.inner.database else {
            #[cfg(test)]
            {
                return Ok(());
            }
            #[cfg(not(test))]
            {
                return Err(ApiError::new(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "TRADE_AUTHORIZATION_STORE_UNAVAILABLE",
                    "trade authorization store is unavailable",
                ));
            }
        };
        let token_hash = sha256(raw_token.as_bytes());
        let consumed = sqlx::query_scalar::<_, Uuid>(
            r#"
            UPDATE trade_authorizations
            SET consumed_at = now()
            WHERE token_hash = $1
              AND user_id = $2
              AND session_id = $3
              AND operation = $4
              AND payload = $5
              AND consumed_at IS NULL
              AND expires_at > now()
              AND EXISTS (
                SELECT 1
                FROM sessions
                WHERE id = $3
                  AND user_id = $2
                  AND revoked_at IS NULL
                  AND expires_at > now()
              )
            RETURNING id
            "#,
        )
        .bind(token_hash.to_vec())
        .bind(owner_uuid)
        .bind(session_uuid)
        .bind(operation)
        .bind(sqlx::types::Json(payload))
        .fetch_optional(database)
        .await
        .map_err(|error| ApiError::database("consume trade authorization", error))?;
        if consumed.is_none() {
            return Err(trade_authorization_rejected());
        }
        Ok(())
    }

    async fn defer_order(
        &self,
        owner_uuid: Uuid,
        intent: &OrderIntent,
        target: &AdminOrderTarget,
    ) -> Result<(execution_domain::CommandId, u64), AdapterError> {
        let Some(database) = &self.inner.database else {
            return Err(AdapterError::Transport(
                "deferred order repository is unavailable".into(),
            ));
        };
        let command_id = execution_domain::CommandId::new(format!(
            "{}:{}",
            intent.command_id, target.account_id
        ));
        let idempotency_key = format!("{}:{}", intent.idempotency_key, target.account_id);
        let envelope = DeferredOrderEnvelope {
            intent: intent.clone(),
            target: target.clone(),
        };
        let envelope_json = serde_json::to_value(&envelope).map_err(|error| {
            error!(%error, "failed to serialize deferred order");
            AdapterError::Transport("deferred order serialization failed".into())
        })?;
        let intent_json = serde_json::to_value(intent).map_err(|error| {
            error!(%error, "failed to serialize deferred order intent");
            AdapterError::Transport("deferred order serialization failed".into())
        })?;
        let expires_at_ms = now_ms() + DEFERRED_ORDER_TTL.as_millis() as u64;
        let mut transaction = database.begin().await.map_err(|error| {
            error!(%error, "failed to begin deferred order transaction");
            AdapterError::Transport("deferred order repository unavailable".into())
        })?;
        let account_exists = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT true
            FROM execution_accounts account
            LEFT JOIN execution_mt5_vm_accounts managed
              ON managed.user_id = account.user_id
             AND managed.account_id = account.id
            WHERE account.user_id = $1
              AND account.id = $2
              AND account.status <> 'disabled'
              AND account.venue_kind = 'metatrader5'
              AND (
                account.connector_kind <> 'windows_vm' OR (
                  managed.account_id IS NOT NULL AND
                  managed.disconnect_requested_revision IS NULL
                )
              )
            FOR UPDATE OF account
            "#,
        )
        .bind(owner_uuid)
        .bind(target.account_id.as_str())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(deferred_repository_error("resolve deferred target account"))?
        .unwrap_or(false);
        if !account_exists {
            return Err(AdapterError::AccountOffline);
        }

        let pending_count = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT count(*)
            FROM execution_target_commands
            WHERE user_id = $1
              AND target_account_id = $2
              AND terminal_ack_at IS NULL
              AND status IN ('waiting', 'ready', 'queued', 'submitted', 'unknown')
            "#,
        )
        .bind(owner_uuid)
        .bind(target.account_id.as_str())
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| {
            error!(%error, "failed to count deferred target commands");
            AdapterError::Transport("deferred order repository unavailable".into())
        })?;
        if pending_count >= MAX_COMMANDS_PER_ACCOUNT as i64 {
            return Err(AdapterError::Backpressure);
        }

        if let Some(row) = sqlx::query(
            r#"
            SELECT
                command_payload,
                status,
                floor(extract(epoch FROM deliver_by) * 1000)::bigint
                    AS deliver_by_ms
            FROM execution_target_commands
            WHERE user_id = $1 AND idempotency_key = $2
            "#,
        )
        .bind(owner_uuid)
        .bind(&idempotency_key)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| {
            error!(%error, "failed to check deferred order idempotency");
            AdapterError::Transport("deferred order repository unavailable".into())
        })? {
            let existing = row
                .try_get::<sqlx::types::Json<serde_json::Value>, _>("command_payload")
                .map_err(|error| {
                    error!(%error, "failed to decode deferred idempotency payload");
                    AdapterError::Transport("deferred order repository unavailable".into())
                })?
                .0;
            let status: String = row.try_get("status").map_err(|error| {
                error!(%error, "failed to decode deferred idempotency status");
                AdapterError::Transport("deferred order repository unavailable".into())
            })?;
            let deliver_by_ms = row
                .try_get::<Option<i64>, _>("deliver_by_ms")
                .map_err(|error| {
                    error!(%error, "failed to decode deferred idempotency expiry");
                    AdapterError::Transport("deferred order repository unavailable".into())
                })?
                .unwrap_or_default()
                .max(0) as u64;
            if existing == envelope_json && status == "waiting" && deliver_by_ms > now_ms() {
                transaction.commit().await.map_err(|error| {
                    error!(%error, "failed to commit idempotent deferred order");
                    AdapterError::Transport("deferred order repository unavailable".into())
                })?;
                return Ok((command_id, deliver_by_ms));
            }
            return Err(AdapterError::IdempotencyConflict);
        }

        sqlx::query(
            r#"
            INSERT INTO execution_commands (
                id, user_id, source_account_id, idempotency_key, intent, status
            )
            VALUES ($1, $2, $3, $4, $5, 'routed')
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(intent.command_id.as_str())
        .bind(owner_uuid)
        .bind(intent.source_account_id.as_ref().map(AccountId::as_str))
        .bind(format!("parent:{}", intent.command_id))
        .bind(sqlx::types::Json(intent_json))
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            error!(%error, "failed to persist deferred parent command");
            AdapterError::Transport("deferred order repository unavailable".into())
        })?;

        sqlx::query(
            r#"
            INSERT INTO execution_target_commands (
                id, user_id, parent_command_id, target_account_id,
                idempotency_key, command_payload, status, deliver_by
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, 'waiting',
                to_timestamp($7::double precision / 1000.0)
            )
            "#,
        )
        .bind(command_id.as_str())
        .bind(owner_uuid)
        .bind(intent.command_id.as_str())
        .bind(target.account_id.as_str())
        .bind(&idempotency_key)
        .bind(sqlx::types::Json(envelope_json))
        .bind(expires_at_ms as i64)
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            error!(%error, "failed to persist deferred target command");
            AdapterError::Transport("deferred order repository unavailable".into())
        })?;

        sqlx::query(
            r#"
            INSERT INTO execution_audit_log (
                user_id, actor_type, actor_id, action,
                resource_type, resource_id, details
            )
            VALUES (
                $1, 'service', 'execution-gateway', 'command.waiting',
                'execution_target_command', $2,
                jsonb_build_object(
                    'accountId', $3,
                    'idempotencyKey', $4,
                    'deliverByMs', $5
                )
            )
            "#,
        )
        .bind(owner_uuid)
        .bind(command_id.as_str())
        .bind(target.account_id.as_str())
        .bind(&idempotency_key)
        .bind(expires_at_ms as i64)
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            error!(%error, "failed to audit deferred target command");
            AdapterError::Transport("deferred order repository unavailable".into())
        })?;
        transaction.commit().await.map_err(|error| {
            error!(%error, "failed to commit deferred order");
            AdapterError::Transport("deferred order repository unavailable".into())
        })?;
        Ok((command_id, expires_at_ms))
    }

    async fn activate_deferred_orders(&self, session: &EaSession) -> Result<(), ApiError> {
        let Some(database) = &self.inner.database else {
            return Ok(());
        };
        let owner_uuid = parse_owner_id(&session.owner_id)?;
        let session_uuid = Uuid::parse_str(session.session_id.as_str()).map_err(|_| {
            ApiError::new(
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "EA session identity is invalid",
            )
        })?;
        let rows = sqlx::query(
            r#"
            WITH candidates AS (
                SELECT id
                FROM execution_target_commands
                WHERE user_id = $1
                  AND target_account_id = $2
                  AND status = 'waiting'
                  AND EXISTS (
                    SELECT 1
                    FROM execution_accounts account
                    LEFT JOIN execution_mt5_vm_accounts managed
                      ON managed.user_id = account.user_id
                     AND managed.account_id = account.id
                    WHERE account.user_id = $1 AND account.id = $2
                      AND (
                        account.connector_kind <> 'windows_vm' OR (
                          account.status = 'ready' AND account.trade_allowed AND
                          managed.disconnect_requested_revision IS NULL
                        )
                      )
                  )
                  AND deliver_by > now()
                  AND next_attempt_at <= now()
                  AND (lease_expires_at IS NULL OR lease_expires_at <= now())
                ORDER BY created_at, id
                FOR UPDATE SKIP LOCKED
                LIMIT $3
            )
            UPDATE execution_target_commands commands
            SET lease_owner = $4,
                lease_expires_at = now() + ($5 * interval '1 millisecond'),
                updated_at = now()
            FROM candidates
            WHERE commands.user_id = $1
              AND commands.id = candidates.id
            RETURNING
                commands.id,
                commands.command_payload,
                floor(extract(epoch FROM commands.created_at) * 1000)::bigint
                    AS waiting_since_ms
            "#,
        )
        .bind(owner_uuid)
        .bind(session.account_id.as_str())
        .bind(MAX_DEFERRED_ACTIVATIONS_PER_EVENT as i64)
        .bind(session_uuid)
        .bind(COMMAND_LEASE.as_millis() as i64)
        .fetch_all(database)
        .await
        .map_err(|error| ApiError::database("lease deferred copy orders", error))?;

        for row in rows {
            let command_id: String = row
                .try_get("id")
                .map_err(|error| ApiError::database("decode deferred command id", error))?;
            let envelope = row
                .try_get::<sqlx::types::Json<DeferredOrderEnvelope>, _>("command_payload")
                .map_err(|error| ApiError::database("decode deferred order", error))?
                .0;
            let waiting_since_ms = row
                .try_get::<i64, _>("waiting_since_ms")
                .map_err(|error| ApiError::database("decode deferred order age", error))?
                .max(0) as u64;
            if !self
                .deferred_instrument_refreshed(
                    owner_uuid,
                    &envelope.target.account_id,
                    &envelope.intent.canonical_symbol,
                    waiting_since_ms,
                )
                .await?
            {
                self.release_deferred_order(owner_uuid, &command_id, session_uuid)
                    .await?;
                continue;
            }
            let context = self
                .load_route_target(
                    owner_uuid,
                    &envelope.target,
                    &envelope.intent.canonical_symbol,
                    envelope.intent.side,
                )
                .await?;
            let Some(context) = context else {
                self.release_deferred_order(owner_uuid, &command_id, session_uuid)
                    .await?;
                continue;
            };
            if context.account.status != AccountStatus::Ready {
                self.release_deferred_order(owner_uuid, &command_id, session_uuid)
                    .await?;
                continue;
            }
            let source_equity = self
                .source_equity(owner_uuid, envelope.intent.source_account_id.as_ref())
                .await?;
            let result = route_order(
                &envelope.intent,
                source_equity,
                std::slice::from_ref(&context),
            )
            .into_iter()
            .next()
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "DEFERRED_ROUTE_EMPTY",
                    "deferred order routing returned no target result",
                )
            })?;
            let result = match result {
                TargetRouteResult::Ready { account_id, order } => {
                    let mut order = *order;
                    if let Some((code, message)) = self
                        .apply_prop_risk_pretrade(owner_uuid, &context, &mut order)
                        .await?
                    {
                        TargetRouteResult::Rejected {
                            account_id,
                            code,
                            message,
                        }
                    } else {
                        TargetRouteResult::Ready {
                            account_id,
                            order: Box::new(order),
                        }
                    }
                }
                rejected => rejected,
            };
            match result {
                TargetRouteResult::Ready { account_id, order } => {
                    let order = *order;
                    let command_json = serde_json::to_value(EaCommand::Place {
                        order: order.clone(),
                    })
                    .map_err(|error| {
                        error!(%error, "failed to serialize activated deferred order");
                        ApiError::new(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "DEFERRED_ORDER_SERIALIZATION_FAILED",
                            "deferred order could not be activated",
                        )
                    })?;
                    let updated = sqlx::query(
                        r#"
                        UPDATE execution_target_commands
                        SET command_payload = $5,
                            status = 'queued',
                            next_attempt_at = now(),
                            lease_owner = NULL,
                            lease_expires_at = NULL,
                            reject_code = NULL,
                            reject_message = NULL,
                            updated_at = now()
                        WHERE user_id = $1
                          AND id = $2
                          AND target_account_id = $3
                          AND status = 'waiting'
                          AND deliver_by > now()
                          AND lease_owner = $4
                        "#,
                    )
                    .bind(owner_uuid)
                    .bind(&command_id)
                    .bind(account_id.as_str())
                    .bind(session_uuid)
                    .bind(sqlx::types::Json(command_json))
                    .execute(database)
                    .await
                    .map_err(|error| ApiError::database("activate deferred copy order", error))?;
                    if updated.rows_affected() == 1 {
                        self.audit_order_route_outcome(
                            owner_uuid,
                            &envelope.intent,
                            &account_id,
                            "order.deferred_queued",
                            "TARGET_RECONNECTED",
                            "target reconnected before the deferred copy deadline",
                        )
                        .await?;
                        info!(
                            account_id = %account_id,
                            command_id,
                            "activated deferred copy order"
                        );
                    }
                }
                TargetRouteResult::Rejected {
                    account_id,
                    code,
                    message,
                } => {
                    let reject_code = serde_json::to_value(code)
                        .ok()
                        .and_then(|value| value.as_str().map(str::to_owned))
                        .unwrap_or_else(|| "UNKNOWN_REJECTION".into());
                    let updated = sqlx::query(
                        r#"
                        UPDATE execution_target_commands
                        SET status = 'rejected',
                            reject_code = $5,
                            reject_message = $6,
                            terminal_ack_at = now(),
                            lease_owner = NULL,
                            lease_expires_at = NULL,
                            updated_at = now()
                        WHERE user_id = $1
                          AND id = $2
                          AND target_account_id = $3
                          AND status = 'waiting'
                          AND lease_owner = $4
                        "#,
                    )
                    .bind(owner_uuid)
                    .bind(&command_id)
                    .bind(account_id.as_str())
                    .bind(session_uuid)
                    .bind(&reject_code)
                    .bind(&message)
                    .execute(database)
                    .await
                    .map_err(|error| ApiError::database("reject deferred copy order", error))?;
                    if updated.rows_affected() == 1 {
                        sqlx::query(
                            r#"
                            UPDATE execution_commands
                            SET status = 'partially_rejected',
                                updated_at = now()
                            WHERE user_id = $1 AND id = $2
                            "#,
                        )
                        .bind(owner_uuid)
                        .bind(envelope.intent.command_id.as_str())
                        .execute(database)
                        .await
                        .map_err(|error| {
                            ApiError::database("finalize rejected deferred copy", error)
                        })?;
                        self.audit_order_route_outcome(
                            owner_uuid,
                            &envelope.intent,
                            &account_id,
                            "order.deferred_rejected",
                            &reject_code,
                            &message,
                        )
                        .await?;
                    }
                }
            }
        }
        Ok(())
    }

    async fn deferred_instrument_refreshed(
        &self,
        owner_uuid: Uuid,
        account_id: &AccountId,
        canonical_symbol: &str,
        waiting_since_ms: u64,
    ) -> Result<bool, ApiError> {
        let Some(database) = &self.inner.database else {
            return Ok(false);
        };
        sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM execution_symbol_mappings mappings
                JOIN execution_instruments instruments
                  ON instruments.user_id = mappings.user_id
                 AND instruments.account_id = mappings.account_id
                 AND instruments.venue_symbol = mappings.venue_symbol
                WHERE mappings.user_id = $1
                  AND mappings.account_id = $2
                  AND upper(mappings.canonical_symbol) = upper($3)
                  AND mappings.enabled = true
                  AND instruments.updated_at >=
                      to_timestamp($4::double precision / 1000.0)
            )
            "#,
        )
        .bind(owner_uuid)
        .bind(account_id.as_str())
        .bind(canonical_symbol.trim())
        .bind(waiting_since_ms as i64)
        .fetch_one(database)
        .await
        .map_err(|error| ApiError::database("check deferred instrument refresh", error))
    }

    async fn release_deferred_order(
        &self,
        owner_uuid: Uuid,
        command_id: &str,
        session_uuid: Uuid,
    ) -> Result<(), ApiError> {
        let Some(database) = &self.inner.database else {
            return Ok(());
        };
        sqlx::query(
            r#"
            UPDATE execution_target_commands
            SET next_attempt_at = now() + interval '1 second',
                lease_owner = NULL,
                lease_expires_at = NULL,
                updated_at = now()
            WHERE user_id = $1
              AND id = $2
              AND status = 'waiting'
              AND lease_owner = $3
            "#,
        )
        .bind(owner_uuid)
        .bind(command_id)
        .bind(session_uuid)
        .execute(database)
        .await
        .map_err(|error| ApiError::database("release deferred copy order", error))?;
        Ok(())
    }

    async fn expire_deferred_orders(&self) -> Result<u64, ApiError> {
        let Some(database) = &self.inner.database else {
            return Ok(0);
        };
        let expired = sqlx::query_scalar::<_, i64>(
            r#"
            WITH expired AS MATERIALIZED (
                UPDATE execution_target_commands
                SET status = 'failed',
                    reject_code = 'DEFERRED_DELIVERY_EXPIRED',
                    reject_message =
                        'Target terminal did not reconnect within the 5 minute copy window',
                    terminal_ack_at = now(),
                    lease_owner = NULL,
                    lease_expires_at = NULL,
                    updated_at = now()
                WHERE status = 'waiting'
                  AND deliver_by <= now()
                RETURNING user_id, id, parent_command_id, target_account_id
            ),
            audited AS (
                INSERT INTO execution_audit_log (
                    user_id, actor_type, actor_id, action,
                    resource_type, resource_id, details
                )
                SELECT
                    user_id,
                    'service',
                    'execution-gateway',
                    'command.deferred_expired',
                    'execution_target_command',
                    id,
                    jsonb_build_object(
                        'accountId', target_account_id,
                        'parentCommandId', parent_command_id,
                        'deferredTtlMs', $1
                    )
                FROM expired
                RETURNING sequence
            ),
            updated_parents AS (
                UPDATE execution_commands parent
                SET status = CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM execution_target_commands target
                            WHERE target.user_id = parent.user_id
                              AND target.parent_command_id = parent.id
                              AND target.status NOT IN (
                                  'rejected', 'cancelled', 'failed'
                              )
                        ) THEN 'partially_rejected'
                        ELSE 'failed'
                    END,
                    updated_at = now()
                WHERE (parent.user_id, parent.id) IN (
                    SELECT DISTINCT user_id, parent_command_id
                    FROM expired
                )
                RETURNING parent.id
            )
            SELECT count(*) FROM expired
            "#,
        )
        .bind(DEFERRED_ORDER_TTL.as_millis() as i64)
        .fetch_one(database)
        .await
        .map_err(|error| ApiError::database("expire deferred copy orders", error))?;
        if expired > 0 {
            warn!(expired, "expired deferred copy orders");
        }
        Ok(expired.max(0) as u64)
    }
}

#[async_trait]
impl EaCommandQueue for GatewayState {
    async fn enqueue(
        &self,
        account_id: &AccountId,
        command: EaCommand,
    ) -> Result<(), AdapterError> {
        if let Some(database) = &self.inner.database {
            let target_account_id = command_target_account(&command).ok_or_else(|| {
                AdapterError::Rejected("sync command requires a durable target envelope".into())
            })?;
            if target_account_id != account_id {
                return Err(AdapterError::Rejected(
                    "command target does not match queue account".into(),
                ));
            }
            let command_id = command_id(&command).ok_or_else(|| {
                AdapterError::Rejected("command id is required for durable execution".into())
            })?;
            let idempotency_key = command_idempotency_key(&command).ok_or_else(|| {
                AdapterError::Rejected("idempotency key is required for durable execution".into())
            })?;
            let parent_command_id = command_parent_id(&command).ok_or_else(|| {
                AdapterError::Rejected("parent command id is required for durable execution".into())
            })?;
            let command_json = serde_json::to_value(&command).map_err(|error| {
                error!(%error, "failed to serialize routed command");
                AdapterError::Transport("command serialization failed".into())
            })?;
            let mut transaction = database.begin().await.map_err(|error| {
                error!(%error, "failed to begin command enqueue transaction");
                AdapterError::Transport("command repository unavailable".into())
            })?;
            let account_row = sqlx::query(
                r#"
                SELECT
                    user_id,
                    metadata->>'eaVersion' AS ea_version,
                    EXISTS (
                        SELECT 1
                        FROM execution_ea_sessions sessions
                        WHERE sessions.user_id = execution_accounts.user_id
                          AND sessions.account_id = execution_accounts.id
                          AND sessions.revoked_at IS NULL
                          AND sessions.expires_at > now()
                          AND sessions.absolute_expires_at > now()
                          AND sessions.last_poll_at >
                              now() - ($2 * interval '1 millisecond')
                    ) AS connected
                FROM execution_accounts
                WHERE id = $1 AND status <> 'disabled'
                FOR UPDATE
                "#,
            )
            .bind(account_id.as_str())
            .bind(EA_POLL_FRESHNESS.as_millis() as i64)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|error| {
                error!(%error, "failed to resolve command target account");
                AdapterError::Transport("command repository unavailable".into())
            })?
            .ok_or(AdapterError::AccountOffline)?;
            let owner_uuid: Uuid = account_row.try_get("user_id").map_err(|error| {
                error!(%error, "failed to decode target owner");
                AdapterError::Transport("command repository unavailable".into())
            })?;
            let connected: bool = account_row.try_get("connected").map_err(|error| {
                error!(%error, "failed to decode target connection state");
                AdapterError::Transport("command repository unavailable".into())
            })?;
            if !connected {
                return Err(AdapterError::AccountOffline);
            }
            let ea_version = account_row
                .try_get::<Option<String>, _>("ea_version")
                .map_err(|error| {
                    error!(%error, "failed to decode target EA version");
                    AdapterError::Transport("command repository unavailable".into())
                })?;
            if !ea_version_supported(ea_version.as_deref()) {
                return Err(AdapterError::Rejected(format!(
                    "MarketLensExecutionEA {}.{} or newer is required",
                    MIN_SUPPORTED_EA_VERSION.0, MIN_SUPPORTED_EA_VERSION.1
                )));
            }

            // Continuous copier commands receive a second, atomic gate at the
            // durable queue boundary. The target advisory lock also serializes
            // enqueue against source close/cancel/fill supersession: whichever
            // transaction wins is visible to the other's fresh SQL statement.
            let copier_group_id = sqlx::query_scalar::<_, Uuid>(
                r#"
                SELECT outbox.group_id
                FROM execution_copy_command_outbox outbox
                WHERE outbox.user_id = $1
                  AND outbox.target_account_id = $2
                  AND COALESCE(
                      outbox.command_payload #>> '{order,commandId}',
                      outbox.command_payload #>> '{command,commandId}'
                  ) = $3
                ORDER BY outbox.created_at DESC
                LIMIT 1
                "#,
            )
            .bind(owner_uuid)
            .bind(account_id.as_str())
            .bind(command_id)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|error| {
                error!(%error, "failed to resolve copier enqueue group");
                AdapterError::Transport("command repository unavailable".into())
            })?;
            if let Some(copier_group_id) = copier_group_id {
                sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
                    .bind(format!(
                        "continuous-copier-target:{owner_uuid}:{copier_group_id}:{}",
                        account_id.as_str()
                    ))
                    .execute(&mut *transaction)
                    .await
                    .map_err(|error| {
                        error!(%error, "failed to lock copier enqueue target");
                        AdapterError::Transport("command repository unavailable".into())
                    })?;
                let copier_gate = sqlx::query(
                    r#"
                SELECT
                    groups.enabled AS group_enabled,
                    groups.runtime_status,
                    targets.enabled AS target_enabled,
                    work.status AS work_status,
                    work.operation,
                    work.payload->>'phase' AS phase
                FROM execution_copy_command_outbox outbox
                JOIN execution_copy_work_items work
                  ON work.user_id = outbox.user_id
                 AND work.group_id = outbox.group_id
                 AND work.id = outbox.work_item_id
                JOIN execution_copy_groups groups
                  ON groups.user_id = outbox.user_id
                 AND groups.id = outbox.group_id
                JOIN execution_copy_targets targets
                  ON targets.user_id = outbox.user_id
                 AND targets.group_id = outbox.group_id
                 AND targets.account_id = outbox.target_account_id
                WHERE outbox.user_id = $1
                  AND outbox.target_account_id = $2
                  AND outbox.group_id = $4
                  AND COALESCE(
                      outbox.command_payload #>> '{order,commandId}',
                      outbox.command_payload #>> '{command,commandId}'
                  ) = $3
                ORDER BY outbox.created_at DESC
                LIMIT 1
                FOR SHARE OF groups, targets, work
                "#,
                )
                .bind(owner_uuid)
                .bind(account_id.as_str())
                .bind(command_id)
                .bind(copier_group_id)
                .fetch_optional(&mut *transaction)
                .await
                .map_err(|error| {
                    error!(%error, "failed to validate copier enqueue gate");
                    AdapterError::Transport("command repository unavailable".into())
                })?
                .ok_or_else(|| {
                    AdapterError::Rejected(
                        "continuous copier work disappeared before durable enqueue".into(),
                    )
                })?;
                let group_enabled =
                    copier_gate
                        .try_get::<bool, _>("group_enabled")
                        .map_err(|error| {
                            error!(%error, "failed to decode copier group enqueue state");
                            AdapterError::Transport("command repository unavailable".into())
                        })?;
                let target_enabled =
                    copier_gate
                        .try_get::<bool, _>("target_enabled")
                        .map_err(|error| {
                            error!(%error, "failed to decode copier target enqueue state");
                            AdapterError::Transport("command repository unavailable".into())
                        })?;
                let runtime_status =
                    copier_gate
                        .try_get::<String, _>("runtime_status")
                        .map_err(|error| {
                            error!(%error, "failed to decode copier runtime enqueue state");
                            AdapterError::Transport("command repository unavailable".into())
                        })?;
                let work_status =
                    copier_gate
                        .try_get::<String, _>("work_status")
                        .map_err(|error| {
                            error!(%error, "failed to decode copier work enqueue state");
                            AdapterError::Transport("command repository unavailable".into())
                        })?;
                let operation = copier_gate
                    .try_get::<String, _>("operation")
                    .map_err(|error| {
                        error!(%error, "failed to decode copier enqueue operation");
                        AdapterError::Transport("command repository unavailable".into())
                    })?;
                let phase = copier_gate
                    .try_get::<Option<String>, _>("phase")
                    .map_err(|error| {
                        error!(%error, "failed to decode copier enqueue phase");
                        AdapterError::Transport("command repository unavailable".into())
                    })?;
                if !group_enabled || !target_enabled || work_status != "leased" {
                    return Err(AdapterError::Rejected(
                        "continuous copier work was superseded before durable enqueue".into(),
                    ));
                }
                if matches!(runtime_status.as_str(), "paused" | "error")
                    && !copier_operation_allowed_while_paused(&operation, phase.as_deref())
                {
                    return Err(AdapterError::Backpressure);
                }
            }

            let pending_count = sqlx::query_scalar::<_, i64>(
                r#"
                SELECT count(*)
                FROM execution_target_commands
                WHERE user_id = $1
                  AND target_account_id = $2
                  AND terminal_ack_at IS NULL
                  AND status IN ('waiting', 'ready', 'queued', 'submitted', 'unknown')
                "#,
            )
            .bind(owner_uuid)
            .bind(account_id.as_str())
            .fetch_one(&mut *transaction)
            .await
            .map_err(|error| {
                error!(%error, "failed to count pending commands");
                AdapterError::Transport("command repository unavailable".into())
            })?;
            if pending_count >= MAX_COMMANDS_PER_ACCOUNT as i64 {
                return Err(AdapterError::Backpressure);
            }

            if let Some(existing) = sqlx::query_scalar::<_, sqlx::types::Json<serde_json::Value>>(
                r#"
                SELECT command_payload
                FROM execution_target_commands
                WHERE user_id = $1 AND idempotency_key = $2
                "#,
            )
            .bind(owner_uuid)
            .bind(idempotency_key)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|error| {
                error!(%error, "failed to check command idempotency");
                AdapterError::Transport("command repository unavailable".into())
            })? {
                if existing.0 == command_json {
                    transaction.commit().await.map_err(|error| {
                        error!(%error, "failed to commit idempotent enqueue");
                        AdapterError::Transport("command repository unavailable".into())
                    })?;
                    return Ok(());
                }
                return Err(AdapterError::IdempotencyConflict);
            }

            sqlx::query(
                r#"
                INSERT INTO execution_commands (
                    id, user_id, source_account_id, idempotency_key, intent, status
                )
                VALUES ($1, $2, NULL, $3, $4, 'routed')
                ON CONFLICT DO NOTHING
                "#,
            )
            .bind(parent_command_id)
            .bind(owner_uuid)
            .bind(format!("parent:{parent_command_id}"))
            .bind(sqlx::types::Json(command_json.clone()))
            .execute(&mut *transaction)
            .await
            .map_err(|error| {
                error!(%error, "failed to persist parent command");
                AdapterError::Transport("command repository unavailable".into())
            })?;

            sqlx::query(
                r#"
                INSERT INTO execution_target_commands (
                    id, user_id, parent_command_id, target_account_id,
                    idempotency_key, command_payload, status
                )
                VALUES ($1, $2, $3, $4, $5, $6, 'queued')
                "#,
            )
            .bind(command_id)
            .bind(owner_uuid)
            .bind(parent_command_id)
            .bind(account_id.as_str())
            .bind(idempotency_key)
            .bind(sqlx::types::Json(command_json))
            .execute(&mut *transaction)
            .await
            .map_err(|error| {
                error!(%error, "failed to persist target command");
                AdapterError::Transport("command repository unavailable".into())
            })?;

            sqlx::query(
                r#"
                INSERT INTO execution_audit_log (
                    user_id, actor_type, actor_id, action,
                    resource_type, resource_id, details
                )
                VALUES (
                    $1, 'service', 'execution-gateway', 'command.queued',
                    'execution_command', $2,
                    jsonb_build_object('accountId', $3, 'idempotencyKey', $4)
                )
                "#,
            )
            .bind(owner_uuid)
            .bind(command_id)
            .bind(account_id.as_str())
            .bind(idempotency_key)
            .execute(&mut *transaction)
            .await
            .map_err(|error| {
                error!(%error, "failed to audit queued command");
                AdapterError::Transport("command repository unavailable".into())
            })?;
            transaction.commit().await.map_err(|error| {
                error!(%error, "failed to commit command enqueue");
                AdapterError::Transport("command repository unavailable".into())
            })?;
            return Ok(());
        }
        let connected = self
            .inner
            .accounts
            .lock()
            .await
            .get(account_id)
            .is_some_and(|account| account.connected);
        if !connected {
            return Err(AdapterError::AccountOffline);
        }
        let mut queues = self.inner.commands.lock().await;
        let queue = queues.entry(account_id.clone()).or_default();
        if queue.len() >= MAX_COMMANDS_PER_ACCOUNT {
            return Err(AdapterError::Backpressure);
        }
        queue.push_back(QueuedCommand {
            command,
            queued_at_ms: now_ms(),
            leased_until_ms: 0,
            delivery_count: 0,
        });
        Ok(())
    }
}

async fn health(State(state): State<GatewayState>) -> Result<Json<HealthView>, ApiError> {
    if let Some(database) = &state.inner.database {
        let connected_accounts = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT count(DISTINCT account_id)
            FROM execution_ea_sessions
            WHERE revoked_at IS NULL
              AND expires_at > now()
              AND absolute_expires_at > now()
              AND last_poll_at > now() - ($1 * interval '1 millisecond')
            "#,
        )
        .bind(EA_POLL_FRESHNESS.as_millis() as i64)
        .fetch_one(database)
        .await
        .map_err(|error| ApiError::database("execution health query", error))?;
        return Ok(Json(HealthView {
            ok: true,
            service: "execution-gateway",
            protocol_version: EXECUTION_PROTOCOL_VERSION,
            connected_accounts: connected_accounts as usize,
        }));
    }
    let now = now_ms();
    let connected_accounts = state
        .inner
        .accounts
        .lock()
        .await
        .values()
        .filter(|account| {
            account.connected
                && now.saturating_sub(account.last_seen_at_ms) < SESSION_TTL.as_millis() as u64
        })
        .count();
    Ok(Json(HealthView {
        ok: true,
        service: "execution-gateway",
        protocol_version: EXECUTION_PROTOCOL_VERSION,
        connected_accounts,
    }))
}

async fn create_ea_session(
    State(state): State<GatewayState>,
    Json(request): Json<EaSessionRequest>,
) -> Result<Json<EaSessionResponse>, ApiError> {
    state.create_session(request).await.map(Json)
}

async fn poll_commands(
    State(state): State<GatewayState>,
    headers: HeaderMap,
) -> Result<Json<EaPollResponseView>, ApiError> {
    let session = state.authenticate(&headers).await?;
    if let Some(database) = &state.inner.database {
        let owner_uuid = parse_owner_id(&session.owner_id)?;
        let session_uuid = Uuid::parse_str(session.session_id.as_str()).map_err(|_| {
            ApiError::new(
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "EA session identity is invalid",
            )
        })?;
        let mut transaction = database
            .begin()
            .await
            .map_err(|error| ApiError::database("begin EA command poll", error))?;
        let expired_parent_ids = sqlx::query_scalar::<_, String>(
            r#"
            WITH expired AS (
                UPDATE execution_target_commands
                SET status = CASE
                        WHEN first_delivered_at IS NULL
                            THEN 'failed'
                        ELSE 'unknown'
                    END,
                    reject_code = CASE
                        WHEN first_delivered_at IS NULL
                            THEN 'DELIVERY_UNAVAILABLE'
                        ELSE 'DELIVERY_OUTCOME_UNKNOWN'
                    END,
                    reject_message = CASE
                        WHEN first_delivered_at IS NULL
                            THEN 'EA did not poll before the command delivery deadline'
                        ELSE 'EA acknowledgement timed out; reconcile MT5 because the command may have executed'
                    END,
                    terminal_ack_at = CASE
                        WHEN first_delivered_at IS NULL
                            THEN now()
                        ELSE NULL
                    END,
                    lease_owner = NULL,
                    lease_expires_at = NULL,
                    updated_at = now()
                WHERE user_id = $1
                  AND target_account_id = $2
                  AND terminal_ack_at IS NULL
                  AND status IN ('ready', 'queued', 'unknown')
                  AND (
                    status <> 'unknown' OR
                    reject_code IS DISTINCT FROM 'DELIVERY_OUTCOME_UNKNOWN'
                  )
                  AND (
                      first_delivered_at IS NULL OR
                      reject_code IS DISTINCT FROM 'DELIVERY_OUTCOME_UNKNOWN'
                  )
                  AND COALESCE(first_delivered_at, next_attempt_at, created_at) <=
                      now() - ($3 * interval '1 millisecond')
                RETURNING id, parent_command_id
            ),
            audited AS (
                INSERT INTO execution_audit_log (
                    user_id, actor_type, actor_id, action,
                    resource_type, resource_id, details
                )
                SELECT
                    $1, 'service', 'execution-gateway', 'command.delivery_expired',
                    'execution_target_command', expired.id,
                    jsonb_build_object(
                        'accountId', $2,
                        'parentCommandId', expired.parent_command_id,
                        'deliveryTtlMs', $3
                    )
                FROM expired
                RETURNING sequence
            )
            SELECT DISTINCT parent_command_id
            FROM expired
            "#,
        )
        .bind(owner_uuid)
        .bind(session.account_id.as_str())
        .bind(COMMAND_DELIVERY_TTL.as_millis() as i64)
        .fetch_all(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("expire stale EA commands", error))?;
        if !expired_parent_ids.is_empty() {
            sqlx::query(
                r#"
                UPDATE execution_commands parent
                SET status = CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM execution_target_commands target
                            WHERE target.user_id = parent.user_id
                              AND target.parent_command_id = parent.id
                              AND target.terminal_ack_at IS NULL
                        ) THEN 'submitted'
                        ELSE 'partially_rejected'
                    END,
                    updated_at = now()
                WHERE parent.user_id = $1
                  AND parent.id = ANY($2)
                "#,
            )
            .bind(owner_uuid)
            .bind(&expired_parent_ids)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("finalize expired EA commands", error))?;
            warn!(
                account_id = %session.account_id,
                expired_commands = expired_parent_ids.len(),
                "expired stale EA commands before polling"
            );
        }
        let rows = sqlx::query(
            r#"
            WITH candidates AS (
                SELECT id
                FROM execution_target_commands
                WHERE user_id = $1
                  AND target_account_id = $2
                  AND terminal_ack_at IS NULL
                  AND status IN ('ready', 'queued', 'unknown')
                  AND (
                    status <> 'unknown' OR
                    reject_code IS DISTINCT FROM 'DELIVERY_OUTCOME_UNKNOWN'
                  )
                  AND COALESCE(first_delivered_at, next_attempt_at, created_at) >
                      now() - ($6 * interval '1 millisecond')
                  AND next_attempt_at <= now()
                  AND (lease_expires_at IS NULL OR lease_expires_at <= now())
                ORDER BY created_at, id
                FOR UPDATE SKIP LOCKED
                LIMIT $3
            )
            UPDATE execution_target_commands commands
            SET lease_owner = $4,
                lease_expires_at = now() + ($5 * interval '1 millisecond'),
                first_delivered_at = COALESCE(first_delivered_at, now()),
                attempt_count = attempt_count + 1,
                updated_at = now()
            FROM candidates
            WHERE commands.id = candidates.id
            RETURNING commands.command_payload
            "#,
        )
        .bind(owner_uuid)
        .bind(session.account_id.as_str())
        .bind(MAX_COMMANDS_PER_POLL as i64)
        .bind(session_uuid)
        .bind(COMMAND_LEASE.as_millis() as i64)
        .bind(COMMAND_DELIVERY_TTL.as_millis() as i64)
        .fetch_all(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("lease EA commands", error))?;
        let mut commands = Vec::with_capacity(rows.len());
        for row in rows {
            let command = row
                .try_get::<sqlx::types::Json<EaCommand>, _>("command_payload")
                .map_err(|error| ApiError::database("decode leased EA command", error))?
                .0;
            if command_target_account(&command) != Some(&session.account_id) {
                error!(
                    expected_account_id = %session.account_id,
                    "database returned command for wrong account"
                );
                return Err(ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "COMMAND_SCOPE_VIOLATION",
                    "command scope validation failed",
                ));
            }
            commands.push(command.into());
        }
        let poll_update = sqlx::query(
            r#"
            UPDATE execution_ea_sessions
            SET last_poll_at = now()
            WHERE id = $1
              AND user_id = $2
              AND account_id = $3
              AND revoked_at IS NULL
            "#,
        )
        .bind(session_uuid)
        .bind(owner_uuid)
        .bind(session.account_id.as_str())
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("record EA poll liveness", error))?;
        if poll_update.rows_affected() != 1 {
            return Err(ApiError::unauthorized(
                "EA session was revoked during command polling",
            ));
        }
        transaction
            .commit()
            .await
            .map_err(|error| ApiError::database("commit EA command poll", error))?;
        return Ok(Json(EaPollResponseView {
            protocol_version: EXECUTION_PROTOCOL_VERSION,
            commands,
            server_time_ms: now_ms(),
        }));
    }
    let mut commands = state.inner.commands.lock().await;
    let queue = commands.entry(session.account_id).or_default();
    let now = now_ms();
    queue.retain(|queued| !command_delivery_expired(queued.queued_at_ms, now));
    let lease_until_ms = now + COMMAND_LEASE.as_millis() as u64;
    let mut leased = Vec::with_capacity(MAX_COMMANDS_PER_POLL);
    for queued in queue.iter_mut() {
        if queued.leased_until_ms > now {
            continue;
        }
        queued.leased_until_ms = lease_until_ms;
        queued.delivery_count = queued.delivery_count.saturating_add(1);
        leased.push(queued.command.clone().into());
        if leased.len() == MAX_COMMANDS_PER_POLL {
            break;
        }
    }
    Ok(Json(EaPollResponseView {
        protocol_version: EXECUTION_PROTOCOL_VERSION,
        commands: leased,
        server_time_ms: now,
    }))
}

async fn accept_events(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(mut batch): Json<EaEventBatch>,
) -> Result<Json<AcceptedView>, ApiError> {
    let session = state.authenticate(&headers).await?;
    if batch.protocol_version != EXECUTION_PROTOCOL_VERSION {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "PROTOCOL_VERSION_UNSUPPORTED",
            "EA and gateway protocol versions do not match",
        ));
    }
    validate_session_account_identity(&state.inner.mt5_identity_key, &session, &batch.account)?;
    let normalized_timestamps = normalize_legacy_ea_clock_skew(&mut batch, now_ms());
    if normalized_timestamps > 0 {
        warn!(
            account_id = %session.account_id,
            session_id = %session.session_id,
            normalized_timestamps,
            "normalized legacy MT5 broker clock skew"
        );
    }
    validate_event_batch_envelope(&batch)?;
    let instruments = batch.instruments;
    let positions = batch.positions;
    let pending_orders = batch.pending_orders;
    let portfolio_snapshot_complete = batch.portfolio_snapshot_complete;
    let raw_events = batch.events;
    let account = batch.account;
    for position in &positions {
        validate_position_snapshot(position)?;
    }
    for order in &pending_orders {
        validate_pending_order_snapshot(order)?;
    }
    state
        .touch_account(&session.owner_id, &session.account_id, account.clone())
        .await?;
    // Portfolio is the user-visible, money-sensitive state. Commit it before
    // auxiliary instrument metadata or command telemetry so one bad symbol or
    // event cannot roll back otherwise valid positions and pending orders.
    state
        .persist_database_payload(
            &session,
            &[],
            &positions,
            &pending_orders,
            portfolio_snapshot_complete,
            &[],
        )
        .await?;
    if let Err(error) = state
        .evaluate_and_apply_prop_risk_guard(&session, &account, &positions, &pending_orders)
        .await
    {
        // Never discard fresh money state because a protective action failed.
        // Pre-trade checks fail closed while the risk state is unavailable, and
        // the next heartbeat retries the evaluation and any emergency actions.
        error!(
            account_id = %session.account_id,
            code = error.body.code,
            message = %error.body.message,
            "prop risk guard evaluation failed"
        );
    }
    for instrument in &instruments {
        validate_instrument_snapshot(instrument)?;
    }
    state
        .persist_database_payload(&session, &instruments, &[], &[], false, &[])
        .await?;
    for event in &raw_events {
        validate_ea_event(event)?;
    }
    let events = normalize_events(raw_events)?;
    state
        .persist_database_payload(&session, &[], &[], &[], false, &events)
        .await?;
    state
        .advance_managed_ea_readiness_after_event(&session.owner_id, &session.account_id)
        .await?;
    // A deferred copy is activated only after this authenticated terminal has
    // refreshed its account and instrument snapshots. The next EA poll will
    // lease the newly queued command.
    state.activate_deferred_orders(&session).await?;
    let completed_command_ids: Vec<String> = events
        .iter()
        .filter_map(event_command_id)
        .map(ToOwned::to_owned)
        .collect();
    for event in events {
        info!(
            account_id = %session.account_id,
            session_id = %session.session_id,
            ?event,
            "MT5 EA execution event"
        );
    }
    if state.inner.database.is_some() {
        return Ok(Json(AcceptedView { ok: true }));
    }
    if !completed_command_ids.is_empty() {
        let mut commands = state.inner.commands.lock().await;
        if let Some(queue) = commands.get_mut(&session.account_id) {
            queue.retain(|queued| {
                command_id(&queued.command).is_none_or(|id| {
                    !completed_command_ids
                        .iter()
                        .any(|completed| completed == id)
                })
            });
        }
    }
    Ok(Json(AcceptedView { ok: true }))
}

async fn prop_risk_guard(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Query(query): Query<PropRiskQuery>,
) -> Result<Json<PropRiskGuardView>, ApiError> {
    require_admin(&state, &headers)?;
    validate_identifier("accountId", query.account_id.as_str(), 96)?;
    let owner_uuid = parse_owner_id(&query.owner_id)?;
    let owns_account = if let Some(database) = &state.inner.database {
        sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM execution_accounts
                WHERE user_id = $1 AND id = $2 AND status <> 'disabled'
            )
            "#,
        )
        .bind(owner_uuid)
        .bind(query.account_id.as_str())
        .fetch_one(database)
        .await
        .map_err(|error| ApiError::database("authorize prop risk account", error))?
    } else {
        state
            .inner
            .accounts
            .lock()
            .await
            .get(&query.account_id)
            .is_some_and(|account| account.owner_id == query.owner_id)
    };
    if !owns_account {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "TARGET_ACCOUNT_NOT_FOUND",
            "target account was not found for this owner",
        ));
    }
    Ok(Json(
        state
            .prop_risk_guard_view(owner_uuid, &query.account_id)
            .await?,
    ))
}

async fn update_prop_risk_guard(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<PropRiskUpdateRequest>,
) -> Result<Json<PropRiskGuardView>, ApiError> {
    require_admin(&state, &headers)?;
    validate_identifier("accountId", request.account_id.as_str(), 96)?;
    if request.initial_balance <= Decimal::ZERO {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "PROP_RISK_INITIAL_BALANCE_INVALID",
            "initial balance must be positive",
        ));
    }
    let owner_uuid = parse_owner_id(&request.owner_id)?;
    let Some(database) = &state.inner.database else {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "PERSISTENT_STORE_REQUIRED",
            "prop risk settings require PostgreSQL",
        ));
    };
    let catalog_profile = prop_risk_profile(database, request.profile_id.trim(), None).await?;
    let Some(profile) = catalog_profile else {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "PROP_RISK_PROFILE_UNKNOWN",
            "profile must reference an active catalog entry",
        ));
    };
    let initial_balance = resolve_profile_initial_balance(&profile, request.initial_balance)
        .map_err(|error| ApiError::internal("resolve prop risk initial balance", error))?;
    let profile_id = profile.id;
    let profile_version = profile.version;
    let (provider_code, program_code, display_name, timezone, rules, actions) =
        if profile.rules_locked {
            // Firm objectives are immutable catalog data. Risk sizing, safety
            // buffers and automated responses are local guard policy and stay
            // configurable per account without weakening the firm objective.
            let mut rules = profile.rules;
            rules.max_risk_per_trade_basis_points = request.rules.max_risk_per_trade_basis_points;
            rules.max_total_open_risk_basis_points = request.rules.max_total_open_risk_basis_points;
            rules.require_stop_loss = request.rules.require_stop_loss;
            rules.warning_buffer_basis_points = request.rules.warning_buffer_basis_points;
            rules.emergency_buffer_basis_points = request.rules.emergency_buffer_basis_points;
            rules.daily_profit_target_basis_points = request.rules.daily_profit_target_basis_points;
            (
                profile.provider_code,
                profile.program_code,
                profile.display_name,
                profile.timezone,
                rules,
                request.actions.clone(),
            )
        } else {
            let provider_code = request
                .provider_code
                .as_deref()
                .unwrap_or(profile.provider_code.as_str())
                .trim()
                .to_lowercase();
            let program_code = request
                .program_code
                .as_deref()
                .unwrap_or(profile.program_code.as_str())
                .trim()
                .to_lowercase();
            if !valid_prop_identifier(&provider_code, 2, 32)
                || !valid_prop_identifier(&program_code, 2, 64)
            {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "PROP_RISK_PROFILE_INVALID",
                    "profile identifiers contain unsupported characters",
                ));
            }
            let display_name = request
                .display_name
                .as_deref()
                .unwrap_or(profile.display_name.as_str())
                .trim();
            validate_plain_text("displayName", display_name, 1, 120)?;
            (
                provider_code,
                program_code,
                display_name.to_owned(),
                request.timezone.trim().to_owned(),
                request.rules.clone(),
                request.actions.clone(),
            )
        };
    rules.validate().map_err(|message| {
        ApiError::new(StatusCode::BAD_REQUEST, "PROP_RISK_RULES_INVALID", message)
    })?;
    let timezone_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = $1)",
    )
    .bind(&timezone)
    .fetch_one(database)
    .await
    .map_err(|error| ApiError::database("validate prop risk timezone", error))?;
    if !timezone_exists {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "PROP_RISK_TIMEZONE_INVALID",
            "timezone must be a valid IANA timezone",
        ));
    }
    let owns_account = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM execution_accounts
            WHERE user_id = $1 AND id = $2 AND status <> 'disabled'
        )
        "#,
    )
    .bind(owner_uuid)
    .bind(request.account_id.as_str())
    .fetch_one(database)
    .await
    .map_err(|error| ApiError::database("authorize prop risk update", error))?;
    if !owns_account {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "TARGET_ACCOUNT_NOT_FOUND",
            "target account was not found for this owner",
        ));
    }
    let mut transaction = database
        .begin()
        .await
        .map_err(|error| ApiError::database("begin prop risk settings update", error))?;
    sqlx::query(
        r#"
        INSERT INTO execution_prop_risk_assignments (
            user_id, account_id, enabled, profile_id, profile_version,
            provider_code, program_code, display_name, timezone,
            initial_balance, rules, actions, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
        ON CONFLICT (user_id, account_id) DO UPDATE
        SET enabled = EXCLUDED.enabled,
            profile_id = EXCLUDED.profile_id,
            profile_version = EXCLUDED.profile_version,
            provider_code = EXCLUDED.provider_code,
            program_code = EXCLUDED.program_code,
            display_name = EXCLUDED.display_name,
            timezone = EXCLUDED.timezone,
            initial_balance = EXCLUDED.initial_balance,
            rules = EXCLUDED.rules,
            actions = EXCLUDED.actions,
            updated_at = now()
        "#,
    )
    .bind(owner_uuid)
    .bind(request.account_id.as_str())
    .bind(request.enabled)
    .bind(&profile_id)
    .bind(profile_version as i32)
    .bind(&provider_code)
    .bind(&program_code)
    .bind(&display_name)
    .bind(&timezone)
    .bind(initial_balance)
    .bind(sqlx::types::Json(&rules))
    .bind(sqlx::types::Json(&actions))
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("save prop risk settings", error))?;
    sqlx::query(
        r#"
        INSERT INTO execution_audit_log (
            user_id, actor_type, actor_id, action,
            resource_type, resource_id, details
        )
        VALUES (
            $1, 'user', $1::text, 'prop_risk.settings_updated',
            'execution_account', $2,
            jsonb_build_object(
                'enabled', $3,
                'profileId', $4,
                'profileVersion', $5,
                'timezone', $6
            )
        )
        "#,
    )
    .bind(owner_uuid)
    .bind(request.account_id.as_str())
    .bind(request.enabled)
    .bind(&profile_id)
    .bind(profile_version as i32)
    .bind(&timezone)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("audit prop risk settings", error))?;
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit prop risk settings update", error))?;
    Ok(Json(
        state
            .prop_risk_guard_view(owner_uuid, &request.account_id)
            .await?,
    ))
}

async fn list_accounts(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Query(query): Query<OwnerQuery>,
) -> Result<Json<Vec<EaAccountView>>, ApiError> {
    require_admin(&state, &headers)?;
    let owner_uuid = parse_owner_id(&query.owner_id)?;
    if let Some(database) = &state.inner.database {
        let rows = sqlx::query(
            r#"
            SELECT
                accounts.id,
                accounts.metadata,
                COALESCE(
                    floor(extract(epoch FROM accounts.last_seen_at) * 1000)::bigint,
                    0
                ) AS account_last_seen_at_ms,
                floor(
                    extract(epoch FROM active_session.last_poll_at) * 1000
                )::bigint AS session_last_seen_at_ms,
                active_session.last_poll_at IS NOT NULL AS connected
            FROM execution_accounts accounts
            LEFT JOIN LATERAL (
                SELECT sessions.last_poll_at
                FROM execution_ea_sessions sessions
                WHERE sessions.user_id = accounts.user_id
                  AND sessions.account_id = accounts.id
                  AND sessions.revoked_at IS NULL
                  AND sessions.expires_at > now()
                  AND sessions.absolute_expires_at > now()
                  AND sessions.last_poll_at >
                      now() - ($2 * interval '1 millisecond')
                ORDER BY sessions.last_poll_at DESC
                LIMIT 1
            ) active_session ON true
            WHERE accounts.user_id = $1
              AND accounts.status <> 'disabled'
            ORDER BY accounts.updated_at DESC, accounts.id
            "#,
        )
        .bind(owner_uuid)
        .bind(EA_POLL_FRESHNESS.as_millis() as i64)
        .fetch_all(database)
        .await
        .map_err(|error| ApiError::database("list execution accounts", error))?;
        let mut accounts = Vec::with_capacity(rows.len());
        for row in rows {
            accounts.push(EaAccountView {
                account_id: AccountId::new(
                    row.try_get::<String, _>("id")
                        .map_err(|error| ApiError::database("decode account id", error))?,
                ),
                owner_id: query.owner_id.clone(),
                connected: row
                    .try_get("connected")
                    .map_err(|error| ApiError::database("decode account connection", error))?,
                last_seen_at_ms: effective_last_seen_at_ms(
                    row.try_get::<i64, _>("account_last_seen_at_ms")
                        .map_err(|error| ApiError::database("decode account heartbeat", error))?
                        as u64,
                    row.try_get::<Option<i64>, _>("session_last_seen_at_ms")
                        .map_err(|error| ApiError::database("decode EA session heartbeat", error))?
                        .map(|value| value as u64),
                ),
                minimum_ea_version: minimum_supported_ea_version(),
                account: row
                    .try_get::<sqlx::types::Json<EaAccountSnapshot>, _>("metadata")
                    .map_err(|error| ApiError::database("decode account snapshot", error))?
                    .0,
            });
        }
        return Ok(Json(accounts));
    }
    let accounts = state
        .inner
        .accounts
        .lock()
        .await
        .values()
        .filter(|account| account.owner_id == query.owner_id)
        .cloned()
        .collect();
    Ok(Json(accounts))
}

async fn account_layout(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Query(query): Query<OwnerQuery>,
) -> Result<Json<AccountLayoutView>, ApiError> {
    require_admin(&state, &headers)?;
    let owner_uuid = parse_owner_id(&query.owner_id)?;
    if let Some(database) = &state.inner.database {
        let row = sqlx::query(
            r#"
            SELECT
                item_ids,
                revision,
                floor(extract(epoch FROM updated_at) * 1000)::bigint AS updated_at_ms
            FROM execution_account_layouts
            WHERE user_id = $1
            "#,
        )
        .bind(owner_uuid)
        .fetch_optional(database)
        .await
        .map_err(|error| ApiError::database("load execution account layout", error))?;
        return Ok(Json(match row {
            Some(row) => {
                AccountLayoutView {
                    item_ids: row.try_get("item_ids").map_err(|error| {
                        ApiError::database("decode account layout items", error)
                    })?,
                    revision: row.try_get::<i64, _>("revision").map_err(|error| {
                        ApiError::database("decode account layout revision", error)
                    })? as u64,
                    updated_at_ms: row.try_get::<i64, _>("updated_at_ms").map_err(|error| {
                        ApiError::database("decode account layout timestamp", error)
                    })? as u64,
                }
            }
            None => AccountLayoutView {
                item_ids: Vec::new(),
                revision: 0,
                updated_at_ms: 0,
            },
        }));
    }
    Ok(Json(
        state
            .inner
            .account_layouts
            .lock()
            .await
            .get(&query.owner_id)
            .cloned()
            .unwrap_or(AccountLayoutView {
                item_ids: Vec::new(),
                revision: 0,
                updated_at_ms: 0,
            }),
    ))
}

async fn update_account_layout(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<AccountLayoutRequest>,
) -> Result<Json<AccountLayoutView>, ApiError> {
    require_admin(&state, &headers)?;
    let owner_uuid = parse_owner_id(&request.owner_id)?;
    validate_account_layout_items(&request.item_ids)?;
    let now = now_ms();
    if let Some(database) = &state.inner.database {
        let broker_ids = request
            .item_ids
            .iter()
            .filter(|item| !item.starts_with("simulator:"))
            .cloned()
            .collect::<Vec<_>>();
        let owned_count = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT count(*)
            FROM execution_accounts
            WHERE user_id = $1
              AND status <> 'disabled'
              AND id = ANY($2)
            "#,
        )
        .bind(owner_uuid)
        .bind(&broker_ids)
        .fetch_one(database)
        .await
        .map_err(|error| ApiError::database("authorize account layout items", error))?;
        if owned_count as usize != broker_ids.len() {
            return Err(ApiError::new(
                StatusCode::NOT_FOUND,
                "ACCOUNT_LAYOUT_ITEM_NOT_FOUND",
                "one or more account layout items do not belong to this owner",
            ));
        }

        let mut transaction = database
            .begin()
            .await
            .map_err(|error| ApiError::database("begin account layout update", error))?;
        let owner_exists = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE",
        )
        .bind(owner_uuid)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("lock account layout owner", error))?
        .is_some();
        if !owner_exists {
            return Err(ApiError::new(
                StatusCode::NOT_FOUND,
                "OWNER_NOT_FOUND",
                "active owner was not found",
            ));
        }
        let current_revision = sqlx::query_scalar::<_, i64>(
            "SELECT revision FROM execution_account_layouts WHERE user_id = $1 FOR UPDATE",
        )
        .bind(owner_uuid)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("lock account layout", error))?
        .unwrap_or(0);
        if current_revision as u64 != request.expected_revision {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "ACCOUNT_LAYOUT_REVISION_CONFLICT",
                "account layout changed on another client; refresh and retry",
            ));
        }
        let next_revision = current_revision + 1;
        let row = sqlx::query(
            r#"
            INSERT INTO execution_account_layouts (
                user_id, item_ids, revision, updated_at
            )
            VALUES ($1, $2, $3, now())
            ON CONFLICT (user_id) DO UPDATE
            SET item_ids = EXCLUDED.item_ids,
                revision = EXCLUDED.revision,
                updated_at = now()
            RETURNING
                item_ids,
                revision,
                floor(extract(epoch FROM updated_at) * 1000)::bigint AS updated_at_ms
            "#,
        )
        .bind(owner_uuid)
        .bind(&request.item_ids)
        .bind(next_revision)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("save account layout", error))?;
        sqlx::query(
            r#"
            INSERT INTO execution_audit_log (
                user_id, actor_type, actor_id, action,
                resource_type, resource_id, details
            )
            VALUES (
                $1, 'user', $1::text,
                'account.layout_updated',
                'execution_account_layout',
                $1::text,
                jsonb_build_object(
                    'revision', $2::bigint,
                    'itemCount', $3::integer
                )
            )
            "#,
        )
        .bind(owner_uuid)
        .bind(next_revision)
        .bind(request.item_ids.len() as i32)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("audit account layout update", error))?;
        transaction
            .commit()
            .await
            .map_err(|error| ApiError::database("commit account layout update", error))?;
        return Ok(Json(AccountLayoutView {
            item_ids: row
                .try_get("item_ids")
                .map_err(|error| ApiError::database("decode saved account layout items", error))?,
            revision: row.try_get::<i64, _>("revision").map_err(|error| {
                ApiError::database("decode saved account layout revision", error)
            })? as u64,
            updated_at_ms: row.try_get::<i64, _>("updated_at_ms").map_err(|error| {
                ApiError::database("decode saved account layout timestamp", error)
            })? as u64,
        }));
    }

    let accounts = state.inner.accounts.lock().await;
    let broker_ids = request
        .item_ids
        .iter()
        .filter(|item| !item.starts_with("simulator:"));
    if broker_ids.clone().any(|item| {
        !accounts.values().any(|account| {
            account.owner_id == request.owner_id && account.account_id.as_str() == item
        })
    }) {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "ACCOUNT_LAYOUT_ITEM_NOT_FOUND",
            "one or more account layout items do not belong to this owner",
        ));
    }
    drop(accounts);
    let mut layouts = state.inner.account_layouts.lock().await;
    let current_revision = layouts
        .get(&request.owner_id)
        .map_or(0, |layout| layout.revision);
    if current_revision != request.expected_revision {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "ACCOUNT_LAYOUT_REVISION_CONFLICT",
            "account layout changed on another client; refresh and retry",
        ));
    }
    let layout = AccountLayoutView {
        item_ids: request.item_ids,
        revision: current_revision + 1,
        updated_at_ms: now,
    };
    layouts.insert(request.owner_id, layout.clone());
    Ok(Json(layout))
}

async fn disconnect_account(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<AccountActionRequest>,
) -> Result<Json<AcceptedView>, ApiError> {
    require_admin(&state, &headers)?;
    parse_owner_id(&request.owner_id)?;
    state
        .manage_account(&request.owner_id, &request.account_id, false)
        .await?;
    Ok(Json(AcceptedView { ok: true }))
}

async fn remove_account(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<AccountActionRequest>,
) -> Result<Json<AcceptedView>, ApiError> {
    require_admin(&state, &headers)?;
    parse_owner_id(&request.owner_id)?;
    state
        .manage_account(&request.owner_id, &request.account_id, true)
        .await?;
    Ok(Json(AcceptedView { ok: true }))
}

async fn account_state(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Query(query): Query<AccountStateQuery>,
) -> Result<Json<AccountStateView>, ApiError> {
    require_admin(&state, &headers)?;
    let owner_uuid = parse_owner_id(&query.owner_id)?;
    validate_identifier("accountId", query.account_id.as_str(), 96)?;
    if let Some(database) = &state.inner.database {
        let owns_account = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM execution_accounts
                WHERE user_id = $1 AND id = $2 AND status <> 'disabled'
            )
            "#,
        )
        .bind(owner_uuid)
        .bind(query.account_id.as_str())
        .fetch_one(database)
        .await
        .map_err(|error| ApiError::database("authorize account state", error))?;
        if !owns_account {
            return Err(ApiError::new(
                StatusCode::NOT_FOUND,
                "TARGET_ACCOUNT_NOT_FOUND",
                "target account was not found for this owner",
            ));
        }
        let position_rows = sqlx::query(
            r#"
            SELECT snapshot
            FROM execution_positions
            WHERE user_id = $1 AND account_id = $2
            ORDER BY updated_at DESC, broker_position_id
            "#,
        )
        .bind(owner_uuid)
        .bind(query.account_id.as_str())
        .fetch_all(database)
        .await
        .map_err(|error| ApiError::database("load account positions", error))?;
        let mut positions = Vec::with_capacity(position_rows.len());
        for row in position_rows {
            positions.push(
                row.try_get::<sqlx::types::Json<EaPositionSnapshot>, _>("snapshot")
                    .map_err(|error| ApiError::database("decode account position", error))?
                    .0,
            );
        }
        let order_rows = sqlx::query(
            r#"
            SELECT snapshot
            FROM execution_pending_orders
            WHERE user_id = $1 AND account_id = $2
            ORDER BY updated_at DESC, broker_order_id
            "#,
        )
        .bind(owner_uuid)
        .bind(query.account_id.as_str())
        .fetch_all(database)
        .await
        .map_err(|error| ApiError::database("load pending orders", error))?;
        let mut pending_orders = Vec::with_capacity(order_rows.len());
        for row in order_rows {
            pending_orders.push(
                row.try_get::<sqlx::types::Json<EaPendingOrderSnapshot>, _>("snapshot")
                    .map_err(|error| ApiError::database("decode pending order", error))?
                    .0,
            );
        }
        let outcome_rows = sqlx::query(
            r#"
            SELECT
                commands.id,
                commands.parent_command_id,
                commands.status,
                commands.reject_code,
                COALESCE(
                    commands.reject_message,
                    latest_event.payload->>'message'
                ) AS message,
                commands.broker_order_id,
                commands.broker_deal_id,
                floor(extract(epoch FROM commands.deliver_by) * 1000)::bigint
                    AS expires_at_ms,
                floor(extract(epoch FROM commands.updated_at) * 1000)::bigint
                    AS updated_at_ms
            FROM execution_target_commands commands
            LEFT JOIN LATERAL (
                SELECT events.payload
                FROM execution_events events
                WHERE events.user_id = commands.user_id
                  AND events.target_command_id = commands.id
                ORDER BY events.received_at DESC, events.id DESC
                LIMIT 1
            ) latest_event ON true
            WHERE commands.user_id = $1
              AND commands.target_account_id = $2
            ORDER BY commands.updated_at DESC, commands.id
            LIMIT 50
            "#,
        )
        .bind(owner_uuid)
        .bind(query.account_id.as_str())
        .fetch_all(database)
        .await
        .map_err(|error| ApiError::database("load command outcomes", error))?;
        let mut command_outcomes = Vec::with_capacity(outcome_rows.len());
        for row in outcome_rows {
            command_outcomes.push(CommandOutcomeView {
                command_id: row
                    .try_get("id")
                    .map_err(|error| ApiError::database("decode command id", error))?,
                parent_command_id: row
                    .try_get("parent_command_id")
                    .map_err(|error| ApiError::database("decode parent command id", error))?,
                status: row
                    .try_get("status")
                    .map_err(|error| ApiError::database("decode command status", error))?,
                reject_code: row
                    .try_get("reject_code")
                    .map_err(|error| ApiError::database("decode reject code", error))?,
                message: row
                    .try_get("message")
                    .map_err(|error| ApiError::database("decode command message", error))?,
                broker_order_id: row
                    .try_get("broker_order_id")
                    .map_err(|error| ApiError::database("decode broker order id", error))?,
                broker_deal_id: row
                    .try_get("broker_deal_id")
                    .map_err(|error| ApiError::database("decode broker deal id", error))?,
                expires_at_ms: row
                    .try_get::<Option<i64>, _>("expires_at_ms")
                    .map_err(|error| ApiError::database("decode command expiry", error))?
                    .map(|value| value.max(0) as u64),
                updated_at_ms: row
                    .try_get::<i64, _>("updated_at_ms")
                    .map_err(|error| ApiError::database("decode command update time", error))?
                    as u64,
            });
        }
        return Ok(Json(AccountStateView {
            account_id: query.account_id,
            positions,
            pending_orders,
            command_outcomes,
        }));
    }
    let owns_account = state
        .inner
        .accounts
        .lock()
        .await
        .get(&query.account_id)
        .is_some_and(|account| account.owner_id == query.owner_id);
    if !owns_account {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "TARGET_ACCOUNT_NOT_FOUND",
            "target account was not found for this owner",
        ));
    }
    Ok(Json(AccountStateView {
        account_id: query.account_id,
        positions: Vec::new(),
        pending_orders: Vec::new(),
        command_outcomes: Vec::new(),
    }))
}

async fn account_instruments(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Query(query): Query<AccountInstrumentsQuery>,
) -> Result<Json<AccountInstrumentsView>, ApiError> {
    require_admin(&state, &headers)?;
    let owner_uuid = parse_owner_id(&query.owner_id)?;
    validate_identifier("accountId", query.account_id.as_str(), 96)?;
    let database = state.inner.database.as_ref().ok_or_else(|| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "PERSISTENT_STORE_REQUIRED",
            "instrument discovery requires PostgreSQL",
        )
    })?;
    let owns_account = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM execution_accounts
            WHERE user_id = $1 AND id = $2 AND status <> 'disabled'
        )
        "#,
    )
    .bind(owner_uuid)
    .bind(query.account_id.as_str())
    .fetch_one(database)
    .await
    .map_err(|error| ApiError::database("authorize account instruments", error))?;
    if !owns_account {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "TARGET_ACCOUNT_NOT_FOUND",
            "target account was not found for this owner",
        ));
    }
    let instrument_rows = sqlx::query(
        r#"
        SELECT snapshot
        FROM execution_instruments
        WHERE user_id = $1 AND account_id = $2
        ORDER BY venue_symbol
        "#,
    )
    .bind(owner_uuid)
    .bind(query.account_id.as_str())
    .fetch_all(database)
    .await
    .map_err(|error| ApiError::database("load account instruments", error))?;
    let mut instruments = Vec::with_capacity(instrument_rows.len());
    for row in instrument_rows {
        instruments.push(
            row.try_get::<sqlx::types::Json<InstrumentSpec>, _>("snapshot")
                .map_err(|error| ApiError::database("decode account instrument", error))?
                .0,
        );
    }
    let mapping_rows = sqlx::query(
        r#"
        SELECT canonical_symbol, venue_symbol, mapping_source
        FROM execution_symbol_mappings
        WHERE user_id = $1 AND account_id = $2 AND enabled = true
        ORDER BY canonical_symbol, venue_symbol
        "#,
    )
    .bind(owner_uuid)
    .bind(query.account_id.as_str())
    .fetch_all(database)
    .await
    .map_err(|error| ApiError::database("load symbol mappings", error))?;
    let mut mappings = Vec::with_capacity(mapping_rows.len());
    for row in mapping_rows {
        mappings.push(SymbolMappingView {
            canonical_symbol: row
                .try_get("canonical_symbol")
                .map_err(|error| ApiError::database("decode canonical symbol", error))?,
            venue_symbol: row
                .try_get("venue_symbol")
                .map_err(|error| ApiError::database("decode venue symbol", error))?,
            mapping_source: row
                .try_get("mapping_source")
                .map_err(|error| ApiError::database("decode mapping source", error))?,
        });
    }
    Ok(Json(AccountInstrumentsView {
        account_id: query.account_id,
        instruments,
        mappings,
    }))
}

async fn upsert_symbol_mapping(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<SymbolMappingRequest>,
) -> Result<Json<SymbolMappingView>, ApiError> {
    require_admin(&state, &headers)?;
    let owner_uuid = parse_owner_id(&request.owner_id)?;
    validate_identifier("accountId", request.account_id.as_str(), 96)?;
    validate_plain_text("canonicalSymbol", &request.canonical_symbol, 1, 64)?;
    validate_plain_text("venueSymbol", &request.venue_symbol, 1, 64)?;
    let database = state.inner.database.as_ref().ok_or_else(|| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "PERSISTENT_STORE_REQUIRED",
            "symbol mappings require PostgreSQL",
        )
    })?;
    let canonical_symbol = request.canonical_symbol.trim().to_uppercase();
    let venue_symbol = request.venue_symbol.trim();
    let mut transaction = database
        .begin()
        .await
        .map_err(|error| ApiError::database("begin symbol mapping transaction", error))?;
    let row = sqlx::query(
        r#"
        INSERT INTO execution_symbol_mappings (
            user_id, account_id, canonical_symbol, venue_symbol,
            mapping_source, enabled
        )
        SELECT $1, $2, $3, instruments.venue_symbol, 'user', true
        FROM execution_instruments instruments
        WHERE instruments.user_id = $1
          AND instruments.account_id = $2
          AND instruments.venue_symbol = $4
        ON CONFLICT (user_id, account_id, canonical_symbol) DO UPDATE SET
            venue_symbol = EXCLUDED.venue_symbol,
            mapping_source = 'user',
            enabled = true,
            updated_at = now()
        RETURNING canonical_symbol, venue_symbol, mapping_source
        "#,
    )
    .bind(owner_uuid)
    .bind(request.account_id.as_str())
    .bind(&canonical_symbol)
    .bind(venue_symbol)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("save symbol mapping", error))?;
    let Some(row) = row else {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VENUE_SYMBOL_NOT_FOUND",
            "venue symbol was not reported by the target execution account",
        ));
    };
    sqlx::query(
        r#"
        INSERT INTO execution_audit_log (
            user_id, actor_type, actor_id, action,
            resource_type, resource_id, details
        )
        VALUES (
            $1, 'user', $1::text, 'symbol_mapping.updated',
            'execution_account', $2,
            jsonb_build_object(
                'canonicalSymbol', $3,
                'venueSymbol', $4
            )
        )
        "#,
    )
    .bind(owner_uuid)
    .bind(request.account_id.as_str())
    .bind(&canonical_symbol)
    .bind(venue_symbol)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("audit symbol mapping", error))?;
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit symbol mapping", error))?;
    Ok(Json(SymbolMappingView {
        canonical_symbol: row
            .try_get("canonical_symbol")
            .map_err(|error| ApiError::database("decode canonical symbol", error))?,
        venue_symbol: row
            .try_get("venue_symbol")
            .map_err(|error| ApiError::database("decode venue symbol", error))?,
        mapping_source: row
            .try_get("mapping_source")
            .map_err(|error| ApiError::database("decode mapping source", error))?,
    }))
}

async fn list_copy_groups(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Query(query): Query<CopyGroupQuery>,
) -> Result<Json<Vec<CopyGroupView>>, ApiError> {
    require_admin(&state, &headers)?;
    let owner_uuid = parse_owner_id(&query.owner_id)?;
    let group_id = parse_optional_copy_group_id(query.group_id.as_ref())?;
    let database = state.inner.database.as_ref().ok_or_else(|| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "PERSISTENT_STORE_REQUIRED",
            "continuous copier settings require PostgreSQL",
        )
    })?;
    Ok(Json(
        load_copy_group_views(database, owner_uuid, &query.owner_id, group_id).await?,
    ))
}

async fn upsert_copy_group(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<CopyGroupUpsertRequest>,
) -> Result<(StatusCode, Json<CopyGroupView>), ApiError> {
    require_admin(&state, &headers)?;
    let owner_uuid = parse_owner_id(&request.owner_id)?;
    validate_copy_group_write(&request)?;
    if request.group.enabled {
        require_copy_group_authorization(
            &state,
            owner_uuid,
            request.authorization_token.as_deref(),
            request.authorization_session_id.as_deref(),
            "copyGroup",
            copy_group_upsert_authorization_payload(&request),
        )
        .await?;
    }
    let database = state.inner.database.as_ref().ok_or_else(|| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "PERSISTENT_STORE_REQUIRED",
            "continuous copier settings require PostgreSQL",
        )
    })?;
    let group_uuid = request
        .group_id
        .as_ref()
        .map(parse_copy_group_id)
        .transpose()?
        .unwrap_or_else(Uuid::new_v4);
    let is_new = request.group_id.is_none();
    let account_ids = std::iter::once(request.group.source_account_id.as_str().to_owned())
        .chain(
            request
                .targets
                .iter()
                .map(|target| target.account_id.as_str().to_owned()),
        )
        .collect::<Vec<_>>();
    let group_configuration = serde_json::to_value(&request.group.config)
        .map_err(|error| ApiError::internal("serialize copier group config", error))?;
    let mut transaction = database
        .begin()
        .await
        .map_err(|error| ApiError::database("begin copier group update", error))?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("continuous-copier-owner:{owner_uuid}"))
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("lock owner copier configuration", error))?;
    let owned_accounts = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*)
        FROM execution_accounts
        WHERE user_id = $1 AND id = ANY($2)
          AND venue_kind = 'metatrader5' AND status <> 'disabled'
        "#,
    )
    .bind(owner_uuid)
    .bind(&account_ids)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("authorize copier accounts", error))?;
    if owned_accounts != account_ids.len() as i64 {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "COPIER_ACCOUNT_NOT_FOUND",
            "source and target accounts must be enabled MT5 accounts owned by this user",
        ));
    }
    if request.group.enabled {
        let enabled_target_ids = request
            .targets
            .iter()
            .filter(|target| target.enabled)
            .map(|target| target.account_id.as_str().to_owned())
            .collect::<Vec<_>>();
        let would_chain = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM execution_copy_groups groups
                JOIN execution_copy_targets targets
                  ON targets.user_id = groups.user_id
                 AND targets.group_id = groups.id
                 AND targets.enabled = true
                WHERE groups.user_id = $1 AND groups.enabled = true
                  AND groups.id <> $2
                  AND (
                      targets.account_id = $3 OR
                      groups.source_account_id = ANY($4)
                  )
            )
            "#,
        )
        .bind(owner_uuid)
        .bind(group_uuid)
        .bind(request.group.source_account_id.as_str())
        .bind(&enabled_target_ids)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("validate copier group graph", error))?;
        if would_chain {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "COPY_GROUP_CHAIN_UNSUPPORTED",
                "an account cannot be both an enabled copier target and an enabled copier source",
            ));
        }
    }

    let mut source_account_changed = false;
    if !is_new {
        let current_group = sqlx::query(
            r#"
            SELECT source_account_id, enabled
            FROM execution_copy_groups
            WHERE user_id = $1 AND id = $2
            FOR UPDATE
            "#,
        )
        .bind(owner_uuid)
        .bind(group_uuid)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("lock copier group for update", error))?;
        if let Some(current_group) = current_group {
            let current_source_account_id = current_group
                .try_get::<String, _>("source_account_id")
                .map_err(|error| ApiError::database("decode current copier source", error))?;
            let current_enabled = current_group
                .try_get::<bool, _>("enabled")
                .map_err(|error| {
                    ApiError::database("decode current copier enabled state", error)
                })?;
            source_account_changed =
                current_source_account_id != request.group.source_account_id.as_str();
            let active_link_targets = sqlx::query_scalar::<_, String>(
                r#"
                SELECT DISTINCT target_account_id
                FROM execution_copy_links
                WHERE user_id = $1 AND group_id = $2
                  AND lifecycle_status NOT IN ('closed', 'cancelled')
                ORDER BY target_account_id
                "#,
            )
            .bind(owner_uuid)
            .bind(group_uuid)
            .fetch_all(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("load live copier links", error))?;
            let requested_enabled_targets = request
                .targets
                .iter()
                .filter(|target| target.enabled)
                .map(|target| target.account_id.as_str())
                .collect::<HashSet<_>>();
            let current_enabled_targets = sqlx::query_scalar::<_, String>(
                r#"
                SELECT account_id
                FROM execution_copy_targets
                WHERE user_id = $1 AND group_id = $2 AND enabled = true
                ORDER BY account_id
                "#,
            )
            .bind(owner_uuid)
            .bind(group_uuid)
            .fetch_all(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("load current copier targets", error))?
            .into_iter()
            .collect::<HashSet<_>>();
            let active_link_target_set = active_link_targets
                .iter()
                .map(String::as_str)
                .collect::<HashSet<_>>();
            if let Some(message) = copy_group_transition_drain_reason(
                &current_source_account_id,
                current_enabled,
                request.group.source_account_id.as_str(),
                request.group.enabled,
                &requested_enabled_targets,
                &active_link_targets,
            ) {
                return Err(ApiError::new(
                    StatusCode::CONFLICT,
                    "COPY_GROUP_DRAIN_REQUIRED",
                    message,
                ));
            }
            if !active_link_targets.is_empty()
                && requested_enabled_targets.iter().any(|account_id| {
                    !current_enabled_targets.contains(*account_id)
                        && !active_link_target_set.contains(*account_id)
                })
            {
                return Err(ApiError::new(
                    StatusCode::CONFLICT,
                    "COPY_GROUP_BASELINE_REQUIRED",
                    "a new enabled target cannot join while the group has live links; wait until flat or use a future baseline-sync workflow",
                ));
            }
        }
    }

    let group_revision = if is_new {
        sqlx::query_scalar::<_, i64>(
            r#"
            INSERT INTO execution_copy_groups (
                id, user_id, name, source_account_id, enabled,
                revision, applied_revision, runtime_status, configuration
            )
            VALUES (
                $1, $2, $3, $4, $5, 1, 1,
                CASE WHEN $5 THEN 'starting' ELSE 'paused' END,
                $6
            )
            RETURNING revision
            "#,
        )
        .bind(group_uuid)
        .bind(owner_uuid)
        .bind(request.group.name.trim())
        .bind(request.group.source_account_id.as_str())
        .bind(request.group.enabled)
        .bind(sqlx::types::Json(group_configuration))
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("create copier group", error))?
    } else {
        let expected_revision = request.group.expected_revision.ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "EXPECTED_REVISION_REQUIRED",
                "updating a copier group requires expectedRevision",
            )
        })?;
        sqlx::query_scalar::<_, i64>(
            r#"
            UPDATE execution_copy_groups
            SET name = $4,
                source_account_id = $5,
                enabled = $6,
                configuration = $7,
                revision = revision + 1,
                applied_revision = revision + 1,
                runtime_status = CASE WHEN $6 THEN 'starting' ELSE 'paused' END,
                status_message = NULL,
                updated_at = now()
            WHERE user_id = $1 AND id = $2 AND revision = $3
            RETURNING revision
            "#,
        )
        .bind(owner_uuid)
        .bind(group_uuid)
        .bind(expected_revision as i64)
        .bind(request.group.name.trim())
        .bind(request.group.source_account_id.as_str())
        .bind(request.group.enabled)
        .bind(sqlx::types::Json(group_configuration))
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("update copier group", error))?
        .ok_or_else(copy_group_revision_conflict)?
    };

    let target_ids = request
        .targets
        .iter()
        .map(|target| target.account_id.as_str().to_owned())
        .collect::<Vec<_>>();
    for target in &request.targets {
        let (allocation_mode, multiplier, risk_basis_points, fixed_quantity, allocation_unit) =
            copy_allocation_columns(&target.config.allocation);
        let target_configuration = serde_json::to_value(&target.config)
            .map_err(|error| ApiError::internal("serialize copier target config", error))?;
        let symbol_mapping = serde_json::to_value(&target.config.symbol_mapping)
            .map_err(|error| ApiError::internal("serialize copier symbol mapping", error))?;
        let updated = sqlx::query_scalar::<_, i64>(
            r#"
            INSERT INTO execution_copy_targets (
                user_id, group_id, account_id, enabled,
                allocation_mode, multiplier, risk_basis_points, max_quantity,
                fixed_quantity, allocation_unit,
                revision, applied_revision, runtime_status,
                configuration, symbol_mapping
            )
            VALUES (
                $1, $2, $3, $4,
                $5, $6, $7, $8, $9, $10,
                1, 1, CASE WHEN $4 THEN 'connecting' ELSE 'inactive' END,
                $11, $12
            )
            ON CONFLICT (group_id, account_id) DO UPDATE SET
                enabled = EXCLUDED.enabled,
                allocation_mode = EXCLUDED.allocation_mode,
                multiplier = EXCLUDED.multiplier,
                risk_basis_points = EXCLUDED.risk_basis_points,
                max_quantity = EXCLUDED.max_quantity,
                fixed_quantity = EXCLUDED.fixed_quantity,
                allocation_unit = EXCLUDED.allocation_unit,
                configuration = EXCLUDED.configuration,
                symbol_mapping = EXCLUDED.symbol_mapping,
                revision = execution_copy_targets.revision + 1,
                applied_revision = execution_copy_targets.revision + 1,
                runtime_status = CASE WHEN EXCLUDED.enabled THEN 'connecting' ELSE 'inactive' END,
                status_message = NULL,
                updated_at = now()
            WHERE execution_copy_targets.user_id = EXCLUDED.user_id
              AND ($13::bigint IS NULL OR execution_copy_targets.revision = $13)
            RETURNING revision
            "#,
        )
        .bind(owner_uuid)
        .bind(group_uuid)
        .bind(target.account_id.as_str())
        .bind(target.enabled)
        .bind(allocation_mode)
        .bind(multiplier)
        .bind(risk_basis_points)
        .bind(target.config.max_quantity)
        .bind(fixed_quantity)
        .bind(allocation_unit)
        .bind(sqlx::types::Json(target_configuration))
        .bind(sqlx::types::Json(symbol_mapping))
        .bind(target.expected_revision.map(|value| value as i64))
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("save copier target", error))?;
        if updated.is_none() {
            return Err(copy_group_revision_conflict());
        }
        for (canonical_symbol, venue_symbol) in &target.config.symbol_mapping {
            let mapped = sqlx::query(
                r#"
                INSERT INTO execution_symbol_mappings (
                    user_id, account_id, canonical_symbol, venue_symbol,
                    mapping_source, enabled
                )
                SELECT $1, $2, upper($3), instruments.venue_symbol, 'user', true
                FROM execution_instruments instruments
                WHERE instruments.user_id = $1
                  AND instruments.account_id = $2
                  AND instruments.venue_symbol = $4
                ON CONFLICT (user_id, account_id, canonical_symbol) DO UPDATE SET
                    venue_symbol = EXCLUDED.venue_symbol,
                    mapping_source = 'user',
                    enabled = true,
                    updated_at = now()
                "#,
            )
            .bind(owner_uuid)
            .bind(target.account_id.as_str())
            .bind(canonical_symbol.trim())
            .bind(venue_symbol.trim())
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("save copier symbol mapping", error))?;
            if mapped.rows_affected() == 0 {
                return Err(ApiError::new(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "COPY_SYMBOL_MAPPING_UNAVAILABLE",
                    format!(
                        "target {} has not reported venue symbol {}",
                        target.account_id, venue_symbol
                    ),
                ));
            }
        }
    }
    sqlx::query(
        r#"
        UPDATE execution_copy_targets
        SET enabled = false,
            runtime_status = 'inactive',
            revision = revision + 1,
            applied_revision = revision + 1,
            status_message = 'Removed from the current group configuration',
            updated_at = now()
        WHERE user_id = $1 AND group_id = $2
          AND NOT (account_id = ANY($3))
          AND enabled = true
        "#,
    )
    .bind(owner_uuid)
    .bind(group_uuid)
    .bind(&target_ids)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("disable removed copier targets", error))?;
    let supersede_all_work = source_account_changed || !request.group.enabled;
    sqlx::query(
        r#"
        WITH superseded_work AS (
            UPDATE execution_copy_work_items work
            SET status = 'superseded',
                completed_at = COALESCE(completed_at, now()),
                last_error = 'superseded by copier configuration revision',
                lease_owner = NULL,
                lease_expires_at = NULL,
                updated_at = now()
            FROM execution_copy_targets targets
            WHERE work.user_id = $1 AND work.group_id = $2
              AND targets.user_id = work.user_id
              AND targets.group_id = work.group_id
              AND targets.account_id = work.target_account_id
              AND work.status IN ('pending', 'leased', 'retry')
              AND ($3::boolean OR targets.enabled = false)
            RETURNING work.id
        )
        UPDATE execution_copy_command_outbox outbox
        SET status = 'dead_letter',
            last_error = 'superseded by copier configuration revision',
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = now()
        FROM superseded_work
        WHERE outbox.user_id = $1
          AND outbox.work_item_id = superseded_work.id
          AND outbox.status NOT IN ('published', 'acknowledged')
        "#,
    )
    .bind(owner_uuid)
    .bind(group_uuid)
    .bind(supersede_all_work)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("supersede obsolete copier work", error))?;
    if !request.group.enabled {
        sqlx::query(
            r#"
            UPDATE execution_copy_targets
            SET runtime_status = 'inactive',
                status_message = 'Copier group disabled',
                updated_at = now()
            WHERE user_id = $1 AND group_id = $2
            "#,
        )
        .bind(owner_uuid)
        .bind(group_uuid)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("deactivate disabled copier targets", error))?;
    }
    sqlx::query(
        r#"
        INSERT INTO execution_audit_log (
            user_id, actor_type, actor_id, action,
            resource_type, resource_id, details
        )
        VALUES (
            $1, 'user', $1::text, $2, 'execution_copy_group', $3,
            jsonb_build_object(
                'revision', $4,
                'sourceAccountId', $5,
                'targetCount', $6,
                'enabled', $7
            )
        )
        "#,
    )
    .bind(owner_uuid)
    .bind(if is_new {
        "copy_group.created"
    } else {
        "copy_group.updated"
    })
    .bind(group_uuid.to_string())
    .bind(group_revision)
    .bind(request.group.source_account_id.as_str())
    .bind(request.targets.len() as i64)
    .bind(request.group.enabled)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("audit copier group", error))?;
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit copier group update", error))?;
    let mut views =
        load_copy_group_views(database, owner_uuid, &request.owner_id, Some(group_uuid)).await?;
    let view = views.pop().ok_or_else(|| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "COPY_GROUP_NOT_FOUND_AFTER_WRITE",
            "copier group could not be reloaded after saving",
        )
    })?;
    Ok((
        if is_new {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        Json(view),
    ))
}

async fn copy_group_action(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<CopyGroupActionRequest>,
) -> Result<Json<CopyGroupView>, ApiError> {
    require_admin(&state, &headers)?;
    let owner_uuid = parse_owner_id(&request.owner_id)?;
    let group_uuid = parse_copy_group_id(&request.group_id)?;
    let database = state.inner.database.as_ref().ok_or_else(|| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "PERSISTENT_STORE_REQUIRED",
            "continuous copier actions require PostgreSQL",
        )
    })?;
    if matches!(request.action, CopyGroupAction::Resume) {
        require_copy_group_authorization(
            &state,
            owner_uuid,
            request.authorization_token.as_deref(),
            request.authorization_session_id.as_deref(),
            "copyGroup",
            copy_group_action_authorization_payload(&request),
        )
        .await?;
    }
    let mut transaction = database
        .begin()
        .await
        .map_err(|error| ApiError::database("begin copier action", error))?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("continuous-copier-owner:{owner_uuid}"))
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("lock owner copier action", error))?;
    let group_row = sqlx::query(
        r#"
        SELECT source_account_id
        FROM execution_copy_groups
        WHERE user_id = $1 AND id = $2 AND revision = $3
        FOR UPDATE
        "#,
    )
    .bind(owner_uuid)
    .bind(group_uuid)
    .bind(request.expected_revision as i64)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("lock copier group for action", error))?
    .ok_or_else(copy_group_revision_conflict)?;
    let source_account_id = group_row
        .try_get::<String, _>("source_account_id")
        .map_err(|error| ApiError::database("decode copier action source", error))?;
    if matches!(request.action, CopyGroupAction::Resume) {
        let enabled_target_ids = sqlx::query_scalar::<_, String>(
            r#"
            SELECT account_id
            FROM execution_copy_targets
            WHERE user_id = $1 AND group_id = $2 AND enabled = true
            ORDER BY account_id
            "#,
        )
        .bind(owner_uuid)
        .bind(group_uuid)
        .fetch_all(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("load copier resume targets", error))?;
        if enabled_target_ids.is_empty() {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "COPY_TARGET_ENABLED_REQUIRED",
                "resuming a copier group requires at least one enabled target",
            ));
        }
        let account_ids = std::iter::once(source_account_id.clone())
            .chain(enabled_target_ids.iter().cloned())
            .collect::<Vec<_>>();
        let enabled_account_count = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT count(*)
            FROM execution_accounts
            WHERE user_id = $1 AND id = ANY($2)
              AND venue_kind = 'metatrader5' AND status <> 'disabled'
            "#,
        )
        .bind(owner_uuid)
        .bind(&account_ids)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("validate copier resume accounts", error))?;
        if enabled_account_count != account_ids.len() as i64 {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "COPIER_ACCOUNT_NOT_READY",
                "source and enabled targets must remain enabled MT5 accounts before resume",
            ));
        }
        let would_chain = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM execution_copy_groups groups
                JOIN execution_copy_targets targets
                  ON targets.user_id = groups.user_id
                 AND targets.group_id = groups.id
                 AND targets.enabled = true
                WHERE groups.user_id = $1 AND groups.enabled = true
                  AND groups.id <> $2
                  AND (
                      targets.account_id = $3 OR
                      groups.source_account_id = ANY($4)
                  )
            )
            "#,
        )
        .bind(owner_uuid)
        .bind(group_uuid)
        .bind(&source_account_id)
        .bind(&enabled_target_ids)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("validate copier resume graph", error))?;
        if would_chain {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "COPY_GROUP_CHAIN_UNSUPPORTED",
                "an account cannot be both an enabled copier target and an enabled copier source",
            ));
        }
    }
    if matches!(request.action, CopyGroupAction::Archive) {
        let live_link_count = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT count(*)
            FROM execution_copy_links
            WHERE user_id = $1 AND group_id = $2
              AND lifecycle_status NOT IN ('closed', 'cancelled')
            "#,
        )
        .bind(owner_uuid)
        .bind(group_uuid)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("check copier archive links", error))?;
        if live_link_count > 0 {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "COPY_GROUP_DRAIN_REQUIRED",
                "archive is blocked while copier links remain open, pending, closing, orphaned, or in error",
            ));
        }
    }
    let (enabled, runtime_status, audit_action) = match request.action {
        CopyGroupAction::Pause => (None, Some("paused"), "copy_group.paused"),
        CopyGroupAction::Resume => (Some(true), Some("starting"), "copy_group.resumed"),
        CopyGroupAction::Archive => (Some(false), Some("inactive"), "copy_group.archived"),
        CopyGroupAction::Reconcile => (None, None, "copy_group.reconcile_requested"),
    };
    let revision = sqlx::query_scalar::<_, i64>(
        r#"
        UPDATE execution_copy_groups
        SET enabled = COALESCE($4, enabled),
            runtime_status = COALESCE($5, runtime_status),
            status_message = NULL,
            revision = revision + 1,
            applied_revision = revision + 1,
            updated_at = now()
        WHERE user_id = $1 AND id = $2 AND revision = $3
        RETURNING revision
        "#,
    )
    .bind(owner_uuid)
    .bind(group_uuid)
    .bind(request.expected_revision as i64)
    .bind(enabled)
    .bind(runtime_status)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("apply copier action", error))?
    .ok_or_else(copy_group_revision_conflict)?;
    if matches!(request.action, CopyGroupAction::Archive) {
        sqlx::query(
            r#"
            WITH superseded_work AS (
                UPDATE execution_copy_work_items
                SET status = 'superseded',
                    completed_at = COALESCE(completed_at, now()),
                    last_error = 'superseded because the copier group was archived',
                    lease_owner = NULL,
                    lease_expires_at = NULL,
                    updated_at = now()
                WHERE user_id = $1 AND group_id = $2
                  AND status IN ('pending', 'leased', 'retry')
                RETURNING id
            )
            UPDATE execution_copy_command_outbox outbox
            SET status = 'dead_letter',
                last_error = 'superseded because the copier group was archived',
                lease_owner = NULL,
                lease_expires_at = NULL,
                updated_at = now()
            FROM superseded_work
            WHERE outbox.user_id = $1
              AND outbox.work_item_id = superseded_work.id
              AND outbox.status NOT IN ('published', 'acknowledged')
            "#,
        )
        .bind(owner_uuid)
        .bind(group_uuid)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("supersede archived copier work", error))?;
        sqlx::query(
            r#"
            UPDATE execution_copy_targets
            SET runtime_status = 'inactive',
                status_message = 'Copier group archived',
                updated_at = now()
            WHERE user_id = $1 AND group_id = $2
            "#,
        )
        .bind(owner_uuid)
        .bind(group_uuid)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("deactivate archived copier targets", error))?;
    } else if matches!(request.action, CopyGroupAction::Resume) {
        sqlx::query(
            r#"
            UPDATE execution_copy_targets
            SET runtime_status = CASE WHEN enabled THEN 'connecting' ELSE 'inactive' END,
                status_message = NULL,
                updated_at = now()
            WHERE user_id = $1 AND group_id = $2
            "#,
        )
        .bind(owner_uuid)
        .bind(group_uuid)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("restart resumed copier targets", error))?;
    }
    if matches!(request.action, CopyGroupAction::Reconcile) {
        sqlx::query(
            r#"
            INSERT INTO execution_copy_reconciliation_runs (
                user_id, group_id, trigger_kind, group_revision
            ) VALUES ($1, $2, 'manual', $3)
            "#,
        )
        .bind(owner_uuid)
        .bind(group_uuid)
        .bind(revision)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("queue copier reconciliation", error))?;
    }
    sqlx::query(
        r#"
        INSERT INTO execution_audit_log (
            user_id, actor_type, actor_id, action,
            resource_type, resource_id, details
        ) VALUES (
            $1, 'user', $1::text, $2,
            'execution_copy_group', $3,
            jsonb_build_object('revision', $4)
        )
        "#,
    )
    .bind(owner_uuid)
    .bind(audit_action)
    .bind(group_uuid.to_string())
    .bind(revision)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("audit copier action", error))?;
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit copier action", error))?;
    if matches!(request.action, CopyGroupAction::Reconcile) {
        if let Err(error) = state
            .process_continuous_copier_reconciliations(owner_uuid)
            .await
        {
            warn!(%error.body.message, code = error.body.code, "manual copier reconciliation deferred");
        }
        if let Err(error) = state.process_continuous_copier_work(owner_uuid).await {
            warn!(%error.body.message, code = error.body.code, "manual copier repair drain deferred");
        }
    }
    let mut views =
        load_copy_group_views(database, owner_uuid, &request.owner_id, Some(group_uuid)).await?;
    views.pop().map(Json).ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "COPY_GROUP_NOT_FOUND",
            "copier group was not found for this owner",
        )
    })
}

async fn load_copy_group_views(
    database: &PgPool,
    owner_uuid: Uuid,
    owner_id: &str,
    group_id: Option<Uuid>,
) -> Result<Vec<CopyGroupView>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT
            groups.id, groups.name, groups.source_account_id, groups.enabled,
            groups.revision, groups.applied_revision, groups.runtime_status,
            groups.configuration, groups.status_message,
            floor(extract(epoch FROM groups.updated_at) * 1000)::bigint AS updated_at_ms,
            (
                SELECT count(*) FROM execution_copy_work_items work
                WHERE work.user_id = groups.user_id AND work.group_id = groups.id
                  AND work.status IN ('pending', 'leased', 'retry')
            ) AS pending_work,
            (
                SELECT count(*) FROM execution_copy_errors errors
                WHERE errors.user_id = groups.user_id AND errors.group_id = groups.id
                  AND errors.resolved_at IS NULL
            ) AS unresolved_errors,
            (
                SELECT count(*) FROM execution_copy_links links
                WHERE links.user_id = groups.user_id AND links.group_id = groups.id
                  AND links.lifecycle_status NOT IN ('closed', 'cancelled')
            ) AS active_links
        FROM execution_copy_groups groups
        WHERE groups.user_id = $1 AND ($2::uuid IS NULL OR groups.id = $2)
        ORDER BY groups.updated_at DESC, groups.id
        "#,
    )
    .bind(owner_uuid)
    .bind(group_id)
    .fetch_all(database)
    .await
    .map_err(|error| ApiError::database("load copier groups", error))?;
    let mut views = Vec::with_capacity(rows.len());
    for row in rows {
        let group_uuid: Uuid = row
            .try_get("id")
            .map_err(|error| ApiError::database("decode copier group id", error))?;
        let target_rows = sqlx::query(
            r#"
            SELECT
                group_id, account_id, enabled, revision, applied_revision,
                runtime_status, configuration, symbol_mapping, status_message,
                allocation_mode, multiplier, risk_basis_points, max_quantity,
                fixed_quantity, allocation_unit,
                floor(extract(epoch FROM updated_at) * 1000)::bigint AS updated_at_ms
            FROM execution_copy_targets
            WHERE user_id = $1 AND group_id = $2
            ORDER BY created_at, account_id
            "#,
        )
        .bind(owner_uuid)
        .bind(group_uuid)
        .fetch_all(database)
        .await
        .map_err(|error| ApiError::database("load copier targets", error))?;
        let mut targets = Vec::with_capacity(target_rows.len());
        for target_row in target_rows {
            let config_value = target_row
                .try_get::<sqlx::types::Json<serde_json::Value>, _>("configuration")
                .map_err(|error| ApiError::database("decode copier target config", error))?
                .0;
            let config = serde_json::from_value::<ContinuousCopyTargetConfig>(config_value)
                .unwrap_or_else(|_| legacy_copy_target_config(&target_row));
            targets.push(CopyTargetDefinition {
                group_id: CopyGroupId::new(group_uuid.to_string()),
                account_id: AccountId::new(
                    target_row
                        .try_get::<String, _>("account_id")
                        .map_err(|error| {
                            ApiError::database("decode copier target account", error)
                        })?,
                ),
                enabled: target_row
                    .try_get("enabled")
                    .map_err(|error| ApiError::database("decode copier target enabled", error))?,
                revision: target_row
                    .try_get::<i64, _>("revision")
                    .map_err(|error| ApiError::database("decode copier target revision", error))?
                    as u64,
                applied_revision: target_row.try_get::<i64, _>("applied_revision").map_err(
                    |error| ApiError::database("decode copier target applied revision", error),
                )? as u64,
                runtime_status: parse_copy_target_runtime_status(
                    &target_row
                        .try_get::<String, _>("runtime_status")
                        .map_err(|error| {
                            ApiError::database("decode copier target status", error)
                        })?,
                ),
                config,
                status_message: target_row.try_get("status_message").map_err(|error| {
                    ApiError::database("decode copier target status message", error)
                })?,
                updated_at_ms: target_row
                    .try_get::<i64, _>("updated_at_ms")
                    .map_err(|error| ApiError::database("decode copier target timestamp", error))?
                    .max(0) as u64,
            });
        }
        let configuration = row
            .try_get::<sqlx::types::Json<ContinuousCopyConfig>, _>("configuration")
            .map_err(|error| ApiError::database("decode copier group config", error))?
            .0;
        views.push(CopyGroupView {
            group: CopyGroupDefinition {
                id: CopyGroupId::new(group_uuid.to_string()),
                owner_id: owner_id.to_owned(),
                name: row
                    .try_get("name")
                    .map_err(|error| ApiError::database("decode copier group name", error))?,
                source_account_id: AccountId::new(
                    row.try_get::<String, _>("source_account_id")
                        .map_err(|error| {
                            ApiError::database("decode copier source account", error)
                        })?,
                ),
                enabled: row
                    .try_get("enabled")
                    .map_err(|error| ApiError::database("decode copier group enabled", error))?,
                revision: row
                    .try_get::<i64, _>("revision")
                    .map_err(|error| ApiError::database("decode copier group revision", error))?
                    as u64,
                applied_revision: row.try_get::<i64, _>("applied_revision").map_err(|error| {
                    ApiError::database("decode copier group applied revision", error)
                })? as u64,
                runtime_status: parse_copy_group_runtime_status(
                    &row.try_get::<String, _>("runtime_status")
                        .map_err(|error| ApiError::database("decode copier group status", error))?,
                ),
                config: configuration,
                status_message: row.try_get("status_message").map_err(|error| {
                    ApiError::database("decode copier group status message", error)
                })?,
                updated_at_ms: row
                    .try_get::<i64, _>("updated_at_ms")
                    .map_err(|error| ApiError::database("decode copier group timestamp", error))?
                    .max(0) as u64,
            },
            targets,
            pending_work: row
                .try_get::<i64, _>("pending_work")
                .map_err(|error| ApiError::database("decode copier pending work", error))?
                .max(0) as u64,
            unresolved_errors: row
                .try_get::<i64, _>("unresolved_errors")
                .map_err(|error| ApiError::database("decode copier error count", error))?
                .max(0) as u64,
            active_links: row
                .try_get::<i64, _>("active_links")
                .map_err(|error| ApiError::database("decode copier link count", error))?
                .max(0) as u64,
        });
    }
    Ok(views)
}

fn validate_copy_group_write(request: &CopyGroupUpsertRequest) -> Result<(), ApiError> {
    validate_plain_text("name", request.group.name.trim(), 1, 80)?;
    validate_identifier(
        "sourceAccountId",
        request.group.source_account_id.as_str(),
        96,
    )?;
    request.group.config.validate().map_err(|message| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "COPY_GROUP_CONFIG_INVALID",
            message,
        )
    })?;
    if request.targets.is_empty() || request.targets.len() > 20 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "COPY_TARGET_COUNT_INVALID",
            "a copier group must contain between 1 and 20 targets",
        ));
    }
    if request.group.enabled && !request.targets.iter().any(|target| target.enabled) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "COPY_TARGET_ENABLED_REQUIRED",
            "an enabled copier group requires at least one enabled target",
        ));
    }
    let mut account_ids = HashSet::with_capacity(request.targets.len());
    for target in &request.targets {
        validate_identifier("targetAccountId", target.account_id.as_str(), 96)?;
        if target.account_id == request.group.source_account_id {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "COPY_TARGET_IS_SOURCE",
                "the source account cannot also be a copier target",
            ));
        }
        if !account_ids.insert(target.account_id.as_str()) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "COPY_TARGET_DUPLICATE",
                "each target account may appear only once",
            ));
        }
        target.config.validate().map_err(|message| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "COPY_TARGET_CONFIG_INVALID",
                message,
            )
        })?;
        if !request.group.config.copy_stop_loss_take_profit
            && matches!(
                &target.config.allocation,
                CopyAllocation::RiskPercent { .. }
            )
        {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "COPY_TARGET_RISK_STOP_REQUIRED",
                "risk-percent allocation requires copied stop-loss protection on the initial order",
            ));
        }
        for (canonical_symbol, venue_symbol) in &target.config.symbol_mapping {
            validate_plain_text("canonicalSymbol", canonical_symbol.trim(), 1, 64)?;
            validate_plain_text("venueSymbol", venue_symbol.trim(), 1, 64)?;
        }
    }
    Ok(())
}

fn copy_group_transition_drain_reason(
    current_source_account_id: &str,
    current_enabled: bool,
    requested_source_account_id: &str,
    requested_enabled: bool,
    requested_enabled_targets: &HashSet<&str>,
    active_link_targets: &[String],
) -> Option<&'static str> {
    if active_link_targets.is_empty() {
        return None;
    }
    if current_source_account_id != requested_source_account_id {
        return Some("the source account cannot change while copier links remain open");
    }
    if current_enabled && !requested_enabled {
        return Some(
            "an active copier group cannot be disabled while links remain open; pause it or close/cancel linked exposure first",
        );
    }
    if active_link_targets
        .iter()
        .any(|account_id| !requested_enabled_targets.contains(account_id.as_str()))
    {
        return Some("targets with open copier links must remain present and enabled");
    }
    None
}

fn parse_copy_group_id(value: &CopyGroupId) -> Result<Uuid, ApiError> {
    Uuid::parse_str(value.as_str()).map_err(|_| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "COPY_GROUP_ID_INVALID",
            "copy group id must be a UUID",
        )
    })
}

fn parse_optional_copy_group_id(value: Option<&CopyGroupId>) -> Result<Option<Uuid>, ApiError> {
    value.map(parse_copy_group_id).transpose()
}

fn copy_group_revision_conflict() -> ApiError {
    ApiError::new(
        StatusCode::CONFLICT,
        "COPY_GROUP_REVISION_CONFLICT",
        "copier settings changed elsewhere; reload before saving",
    )
}

fn copy_allocation_columns(
    allocation: &CopyAllocation,
) -> (
    &'static str,
    Decimal,
    Option<i32>,
    Option<Decimal>,
    &'static str,
) {
    match allocation {
        CopyAllocation::SameQuantity => ("same_quantity", Decimal::ONE, None, None, "lots"),
        CopyAllocation::FixedQuantity { quantity, unit } => (
            "fixed_quantity",
            Decimal::ONE,
            None,
            Some(*quantity),
            quantity_unit_storage(*unit),
        ),
        CopyAllocation::Multiplier { multiplier } => {
            ("multiplier", *multiplier, None, None, "lots")
        }
        CopyAllocation::EquityProportional { multiplier } => {
            ("equity_proportional", *multiplier, None, None, "lots")
        }
        CopyAllocation::RiskPercent { basis_points } => (
            "risk_percent",
            Decimal::ONE,
            Some(*basis_points as i32),
            None,
            "lots",
        ),
    }
}

fn quantity_unit_storage(unit: QuantityUnit) -> &'static str {
    match unit {
        QuantityUnit::Lots => "lots",
        QuantityUnit::BaseUnits => "base_units",
        QuantityUnit::Contracts => "contracts",
        QuantityUnit::QuoteNotional => "quote_notional",
    }
}

fn legacy_copy_target_config(row: &sqlx_postgres::PgRow) -> ContinuousCopyTargetConfig {
    let allocation_mode = row
        .try_get::<String, _>("allocation_mode")
        .unwrap_or_default();
    let multiplier = row
        .try_get::<Decimal, _>("multiplier")
        .unwrap_or(Decimal::ONE);
    let allocation = match allocation_mode.as_str() {
        "fixed_quantity" => CopyAllocation::FixedQuantity {
            quantity: row
                .try_get::<Option<Decimal>, _>("fixed_quantity")
                .ok()
                .flatten()
                .unwrap_or(Decimal::ONE),
            unit: match row
                .try_get::<String, _>("allocation_unit")
                .unwrap_or_else(|_| "lots".into())
                .as_str()
            {
                "base_units" => QuantityUnit::BaseUnits,
                "contracts" => QuantityUnit::Contracts,
                "quote_notional" => QuantityUnit::QuoteNotional,
                _ => QuantityUnit::Lots,
            },
        },
        "multiplier" => CopyAllocation::Multiplier { multiplier },
        "equity_proportional" => CopyAllocation::EquityProportional { multiplier },
        "risk_percent" => CopyAllocation::RiskPercent {
            basis_points: row
                .try_get::<Option<i32>, _>("risk_basis_points")
                .ok()
                .flatten()
                .unwrap_or(50)
                .max(1) as u32,
        },
        _ => CopyAllocation::SameQuantity,
    };
    let symbol_mapping = row
        .try_get::<sqlx::types::Json<std::collections::BTreeMap<String, String>>, _>(
            "symbol_mapping",
        )
        .ok()
        .map(|value| value.0)
        .unwrap_or_default();
    ContinuousCopyTargetConfig {
        allocation,
        max_quantity: row.try_get("max_quantity").ok().flatten(),
        reverse_trade: false,
        symbol_mapping,
        protection: Default::default(),
    }
}

fn parse_copy_group_runtime_status(value: &str) -> CopyGroupRuntimeStatus {
    match value {
        "starting" => CopyGroupRuntimeStatus::Starting,
        "active" => CopyGroupRuntimeStatus::Active,
        "paused" => CopyGroupRuntimeStatus::Paused,
        "degraded" => CopyGroupRuntimeStatus::Degraded,
        "error" => CopyGroupRuntimeStatus::Error,
        _ => CopyGroupRuntimeStatus::Inactive,
    }
}

fn parse_copy_target_runtime_status(value: &str) -> CopyTargetRuntimeStatus {
    match value {
        "connecting" => CopyTargetRuntimeStatus::Connecting,
        "active" => CopyTargetRuntimeStatus::Active,
        "waiting" => CopyTargetRuntimeStatus::Waiting,
        "degraded" => CopyTargetRuntimeStatus::Degraded,
        "error" => CopyTargetRuntimeStatus::Error,
        _ => CopyTargetRuntimeStatus::Inactive,
    }
}

async fn issue_pairing_token(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<PairingTokenRequest>,
) -> Result<(StatusCode, Json<PairingTokenResponse>), ApiError> {
    require_admin(&state, &headers)?;
    parse_owner_id(&request.owner_id)?;
    let ttl_seconds = request
        .expires_in_seconds
        .unwrap_or(DEFAULT_PAIRING_TTL.as_secs());
    if !(30..=MAX_PAIRING_TTL.as_secs()).contains(&ttl_seconds) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "PAIRING_TTL_INVALID",
            "pairing token lifetime must be between 30 and 600 seconds",
        ));
    }
    let token = random_token();
    let expires_at_ms = state
        .insert_pairing_token(
            &token,
            request.owner_id.trim(),
            Duration::from_secs(ttl_seconds),
        )
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(PairingTokenResponse {
            token,
            expires_at_ms,
        }),
    ))
}

#[allow(clippy::collapsible_if)]
async fn route_admin_order(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<AdminOrderRequest>,
) -> Result<(StatusCode, Json<AdminOrderResponse>), ApiError> {
    require_admin(&state, &headers)?;
    let owner_uuid = parse_owner_id(&request.owner_id)?;
    let session_uuid = Uuid::parse_str(&request.authorization_session_id)
        .map_err(|_| trade_authorization_rejected())?;
    validate_admin_order_request(&request)?;

    let source_equity = state
        .source_equity(owner_uuid, request.intent.source_account_id.as_ref())
        .await?;
    let mut contexts = Vec::with_capacity(request.targets.len());
    let mut deferred_targets = Vec::new();
    let mut submissions = Vec::with_capacity(request.targets.len());
    for target in &request.targets {
        match state
            .load_route_target(
                owner_uuid,
                target,
                &request.intent.canonical_symbol,
                request.intent.side,
            )
            .await?
        {
            Some(context) if execution_transport_enabled(context.account.venue_kind) => {
                if matches!(
                    context.account.status,
                    AccountStatus::Offline | AccountStatus::Connecting
                ) {
                    deferred_targets.push(target.clone());
                } else {
                    contexts.push(context);
                }
            }
            Some(_) => {
                let code = "NATIVE_ADAPTER_NOT_ENABLED";
                let message = "the target venue transport is not enabled in this deployment";
                state
                    .audit_order_route_outcome(
                        owner_uuid,
                        &request.intent,
                        &target.account_id,
                        "order.route_unavailable",
                        code,
                        message,
                    )
                    .await?;
                submissions.push(AdminTargetSubmission::Unavailable {
                    account_id: target.account_id.clone(),
                    code,
                    message: message.into(),
                });
            }
            None => {
                let code = "TARGET_CONTEXT_UNAVAILABLE";
                let message = "account or fresh broker instrument metadata is unavailable";
                state
                    .audit_order_route_outcome(
                        owner_uuid,
                        &request.intent,
                        &target.account_id,
                        "order.route_unavailable",
                        code,
                        message,
                    )
                    .await?;
                submissions.push(AdminTargetSubmission::Unavailable {
                    account_id: target.account_id.clone(),
                    code,
                    message: message.into(),
                });
            }
        }
    }

    let routed = route_order(&request.intent, source_equity, &contexts);
    state
        .consume_trade_authorization(
            owner_uuid,
            session_uuid,
            "order",
            strip_json_nulls(serde_json::json!({
                "intent": &request.intent,
                "targets": &request.targets,
            })),
            &request.authorization_token,
        )
        .await?;
    for target in deferred_targets {
        match state
            .defer_order(owner_uuid, &request.intent, &target)
            .await
        {
            Ok((command_id, expires_at_ms)) => {
                submissions.push(AdminTargetSubmission::Waiting {
                    account_id: target.account_id,
                    command_id,
                    expires_at_ms,
                });
            }
            Err(error) => {
                let (code, message) = adapter_submission_error(error);
                state
                    .audit_order_route_outcome(
                        owner_uuid,
                        &request.intent,
                        &target.account_id,
                        "order.defer_unavailable",
                        code,
                        &message,
                    )
                    .await?;
                submissions.push(AdminTargetSubmission::Unavailable {
                    account_id: target.account_id,
                    code,
                    message,
                });
            }
        }
    }
    for result in routed {
        match result {
            TargetRouteResult::Ready { account_id, order } => {
                let mut order = *order;
                if let Some(context) = contexts
                    .iter()
                    .find(|context| context.account.id == account_id)
                {
                    if let Some((code, message)) = state
                        .apply_prop_risk_pretrade(owner_uuid, context, &mut order)
                        .await?
                    {
                        let audit_code = serde_json::to_value(code)
                            .ok()
                            .and_then(|value| value.as_str().map(str::to_owned))
                            .unwrap_or_else(|| "PROP_RISK_REJECTED".into());
                        state
                            .audit_order_route_outcome(
                                owner_uuid,
                                &request.intent,
                                &account_id,
                                "order.prop_risk_rejected",
                                &audit_code,
                                &message,
                            )
                            .await?;
                        submissions.push(AdminTargetSubmission::Rejected {
                            account_id,
                            code,
                            message,
                        });
                        continue;
                    }
                }
                match state
                    .enqueue(
                        &account_id,
                        EaCommand::Place {
                            order: order.clone(),
                        },
                    )
                    .await
                {
                    Ok(()) => submissions.push(AdminTargetSubmission::Queued {
                        account_id,
                        command_id: order.command_id,
                        warnings: order.warnings,
                    }),
                    Err(error) => {
                        let (code, message) = adapter_submission_error(error);
                        state
                            .audit_order_route_outcome(
                                owner_uuid,
                                &request.intent,
                                &account_id,
                                "order.route_unavailable",
                                code,
                                &message,
                            )
                            .await?;
                        submissions.push(AdminTargetSubmission::Unavailable {
                            account_id,
                            code,
                            message,
                        });
                    }
                }
            }
            TargetRouteResult::Rejected {
                account_id,
                code,
                message,
            } => {
                let audit_code = serde_json::to_value(code)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .unwrap_or_else(|| "UNKNOWN_REJECTION".into());
                state
                    .audit_order_route_outcome(
                        owner_uuid,
                        &request.intent,
                        &account_id,
                        "order.route_rejected",
                        &audit_code,
                        &message,
                    )
                    .await?;
                submissions.push(AdminTargetSubmission::Rejected {
                    account_id,
                    code,
                    message,
                });
            }
        }
    }

    Ok((
        StatusCode::ACCEPTED,
        Json(AdminOrderResponse {
            command_id: request.intent.command_id,
            targets: submissions,
        }),
    ))
}

fn execution_transport_enabled(venue_kind: VenueKind) -> bool {
    matches!(venue_kind, VenueKind::MetaTrader5)
}

async fn queue_command(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<AdminCommandRequest>,
) -> Result<(StatusCode, Json<AcceptedView>), ApiError> {
    require_admin(&state, &headers)?;
    let owner_uuid = parse_owner_id(&request.owner_id)?;
    let session_uuid = Uuid::parse_str(&request.authorization_session_id)
        .map_err(|_| trade_authorization_rejected())?;
    validate_admin_command(&request.command)?;
    let account_id = command_target_account(&request.command)
        .cloned()
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "TARGET_ACCOUNT_REQUIRED",
                "admin sync commands require a target-specific envelope",
            )
        })?;
    let owns_account = if let Some(database) = &state.inner.database {
        sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM execution_accounts
                WHERE user_id = $1 AND id = $2 AND status <> 'disabled'
            )
            "#,
        )
        .bind(owner_uuid)
        .bind(account_id.as_str())
        .fetch_one(database)
        .await
        .map_err(|error| ApiError::database("authorize command target", error))?
    } else {
        state
            .inner
            .accounts
            .lock()
            .await
            .get(&account_id)
            .is_some_and(|account| account.owner_id == request.owner_id)
    };
    if !owns_account {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "TARGET_ACCOUNT_NOT_FOUND",
            "target account was not found for this owner",
        ));
    }
    state
        .validate_lifecycle_resource(owner_uuid, &request.command)
        .await?;
    state
        .consume_trade_authorization(
            owner_uuid,
            session_uuid,
            "command",
            strip_json_nulls(serde_json::json!({ "command": &request.command })),
            &request.authorization_token,
        )
        .await?;
    state
        .enqueue(&account_id, request.command)
        .await
        .map_err(ApiError::from_adapter)?;
    Ok((StatusCode::ACCEPTED, Json(AcceptedView { ok: true })))
}

fn validate_admin_order_request(request: &AdminOrderRequest) -> Result<(), ApiError> {
    if request.targets.is_empty() || request.targets.len() > 20 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "TARGET_COUNT_INVALID",
            "an order must have between 1 and 20 targets",
        ));
    }
    validate_identifier("commandId", request.intent.command_id.as_str(), 128)?;
    validate_identifier(
        "idempotencyKey",
        request.intent.idempotency_key.as_str(),
        200,
    )?;
    validate_plain_text("canonicalSymbol", &request.intent.canonical_symbol, 1, 64)?;
    let mut account_ids = HashSet::with_capacity(request.targets.len());
    for target in &request.targets {
        validate_identifier("accountId", target.account_id.as_str(), 96)?;
        if request.intent.command_id.as_str().len() + target.account_id.as_str().len() + 1 > 128 {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "COMMAND_ID_TOO_LONG",
                "commandId and accountId exceed the routed command limit",
            ));
        }
        if !account_ids.insert(target.account_id.as_str()) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "DUPLICATE_TARGET",
                "each target account may appear only once",
            ));
        }
    }
    Ok(())
}

fn trade_authorization_rejected() -> ApiError {
    ApiError::new(
        StatusCode::FORBIDDEN,
        "TRADE_AUTHORIZATION_INVALID",
        "trade authorization is missing, expired, already used, or does not match the payload",
    )
}

async fn require_copy_group_authorization(
    state: &GatewayState,
    owner_uuid: Uuid,
    raw_token: Option<&str>,
    raw_session_id: Option<&str>,
    operation: &str,
    payload: serde_json::Value,
) -> Result<(), ApiError> {
    let token = raw_token.ok_or_else(trade_authorization_rejected)?;
    let session_id = raw_session_id
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(trade_authorization_rejected)?;
    state
        .consume_trade_authorization(owner_uuid, session_id, operation, payload, token)
        .await
}

fn copy_group_upsert_authorization_payload(request: &CopyGroupUpsertRequest) -> serde_json::Value {
    let mut payload = serde_json::json!({
        "group": &request.group,
        "targets": &request.targets,
    });
    if let Some(group_id) = &request.group_id {
        payload["groupId"] = serde_json::Value::String(group_id.as_str().to_owned());
    }
    strip_json_nulls(payload)
}

fn copy_group_action_authorization_payload(request: &CopyGroupActionRequest) -> serde_json::Value {
    strip_json_nulls(serde_json::json!({
        "groupId": &request.group_id,
        "expectedRevision": request.expected_revision,
        "action": request.action,
    }))
}

fn strip_json_nulls(mut value: serde_json::Value) -> serde_json::Value {
    match &mut value {
        serde_json::Value::Object(object) => {
            object.retain(|_, child| !child.is_null());
            for child in object.values_mut() {
                *child = strip_json_nulls(std::mem::take(child));
            }
        }
        serde_json::Value::Array(items) => {
            for child in items {
                *child = strip_json_nulls(std::mem::take(child));
            }
        }
        _ => {}
    }
    value
}

fn validate_admin_command(command: &EaCommand) -> Result<(), ApiError> {
    match command {
        EaCommand::Place { .. } => {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "ORDER_ROUTE_REQUIRED",
                "place commands must pass through the risk-aware order route",
            ));
        }
        EaCommand::ModifyPosition { command } => {
            validate_identifier("commandId", command.command_id.as_str(), 128)?;
            validate_identifier("idempotencyKey", command.idempotency_key.as_str(), 200)?;
            validate_identifier("accountId", command.target_account_id.as_str(), 96)?;
            validate_broker_ticket("brokerPositionId", &command.broker_position_id)?;
            if command.stop_loss.is_none() && command.take_profit.is_none() {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "MODIFICATION_EMPTY",
                    "a position modification must include stop loss or take profit",
                ));
            }
            if command.stop_loss.is_some_and(|value| value < Decimal::ZERO)
                || command
                    .take_profit
                    .is_some_and(|value| value < Decimal::ZERO)
            {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "MODIFICATION_PRICE_INVALID",
                    "position protection prices cannot be negative",
                ));
            }
        }
        EaCommand::ModifyPendingOrder { command } => {
            validate_identifier("commandId", command.command_id.as_str(), 128)?;
            validate_identifier("idempotencyKey", command.idempotency_key.as_str(), 200)?;
            validate_identifier("accountId", command.target_account_id.as_str(), 96)?;
            validate_broker_ticket("brokerOrderId", &command.broker_order_id)?;
            if command.price <= Decimal::ZERO
                || command.stop_loss.is_some_and(|value| value < Decimal::ZERO)
                || command
                    .take_profit
                    .is_some_and(|value| value < Decimal::ZERO)
            {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "MODIFICATION_PRICE_INVALID",
                    "pending entry must be positive and protection prices cannot be negative",
                ));
            }
        }
        EaCommand::ClosePosition { command } => {
            validate_identifier("commandId", command.command_id.as_str(), 128)?;
            validate_identifier("idempotencyKey", command.idempotency_key.as_str(), 200)?;
            validate_identifier("accountId", command.target_account_id.as_str(), 96)?;
            validate_broker_ticket("brokerPositionId", &command.broker_position_id)?;
            if command.quantity.is_some_and(|value| value <= Decimal::ZERO)
                || command.deviation_points > 10_000
            {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "CLOSE_PARAMETERS_INVALID",
                    "close quantity or deviation is invalid",
                ));
            }
        }
        EaCommand::CancelOrder { command } => {
            validate_identifier("commandId", command.command_id.as_str(), 128)?;
            validate_identifier("idempotencyKey", command.idempotency_key.as_str(), 200)?;
            validate_identifier("accountId", command.target_account_id.as_str(), 96)?;
            validate_broker_ticket("brokerOrderId", &command.broker_order_id)?;
        }
        EaCommand::Sync => {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "TARGET_ACCOUNT_REQUIRED",
                "admin sync commands require a target-specific envelope",
            ));
        }
    }
    Ok(())
}

fn lifecycle_resource_not_found() -> ApiError {
    ApiError::new(
        StatusCode::UNPROCESSABLE_ENTITY,
        "BROKER_RESOURCE_NOT_FOUND",
        "position or pending order was not found in the target account snapshot",
    )
}

fn validate_position_modification(
    position: &EaPositionSnapshot,
    minimum_stop_distance: Option<Decimal>,
    stop_loss: Option<Decimal>,
    take_profit: Option<Decimal>,
) -> Result<(), ApiError> {
    let price = position.current_price;
    if price <= Decimal::ZERO {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "POSITION_PRICE_UNAVAILABLE",
            "current position price is unavailable for protection validation",
        ));
    }
    let wrong_stop_side = stop_loss
        .filter(|value| *value > Decimal::ZERO)
        .is_some_and(|stop| match position.side {
            Side::Buy => stop >= price,
            Side::Sell => stop <= price,
        });
    let wrong_target_side = take_profit
        .filter(|value| *value > Decimal::ZERO)
        .is_some_and(|target| match position.side {
            Side::Buy => target <= price,
            Side::Sell => target >= price,
        });
    if wrong_stop_side || wrong_target_side {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "PROTECTION_PRICE_WRONG_SIDE",
            "stop loss or take profit is on the wrong side of the current price",
        ));
    }
    if let Some(minimum) = minimum_stop_distance {
        let stop_too_close = stop_loss
            .filter(|value| *value > Decimal::ZERO)
            .is_some_and(|stop| (price - stop).abs() < minimum);
        let target_too_close = take_profit
            .filter(|value| *value > Decimal::ZERO)
            .is_some_and(|target| (price - target).abs() < minimum);
        if stop_too_close || target_too_close {
            return Err(ApiError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "PROTECTION_DISTANCE_TOO_SMALL",
                "stop loss or take profit is inside the broker minimum distance",
            ));
        }
    }
    Ok(())
}

fn validate_pending_order_modification(
    order: &EaPendingOrderSnapshot,
    minimum_stop_distance: Option<Decimal>,
    price: Decimal,
    stop_loss: Option<Decimal>,
    take_profit: Option<Decimal>,
) -> Result<(), ApiError> {
    let wrong_stop_side = stop_loss
        .filter(|value| *value > Decimal::ZERO)
        .is_some_and(|stop| match order.side {
            Side::Buy => stop >= price,
            Side::Sell => stop <= price,
        });
    let wrong_target_side = take_profit
        .filter(|value| *value > Decimal::ZERO)
        .is_some_and(|target| match order.side {
            Side::Buy => target <= price,
            Side::Sell => target >= price,
        });
    if wrong_stop_side || wrong_target_side {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "PROTECTION_PRICE_WRONG_SIDE",
            "stop loss or take profit is on the wrong side of the pending entry",
        ));
    }
    if let Some(minimum) = minimum_stop_distance {
        let stop_too_close = stop_loss
            .filter(|value| *value > Decimal::ZERO)
            .is_some_and(|stop| (price - stop).abs() < minimum);
        let target_too_close = take_profit
            .filter(|value| *value > Decimal::ZERO)
            .is_some_and(|target| (price - target).abs() < minimum);
        if stop_too_close || target_too_close {
            return Err(ApiError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "PROTECTION_DISTANCE_TOO_SMALL",
                "stop loss or take profit is inside the broker minimum distance",
            ));
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_prop_risk_modification(
    rules: &PropRiskRules,
    actions: &PropRiskActions,
    current_reference: Decimal,
    current_stop: Option<Decimal>,
    next_reference: Decimal,
    requested_stop: Option<Decimal>,
    quantity: Decimal,
    instrument: Option<&InstrumentSpec>,
) -> Result<(), ApiError> {
    let current_stop = current_stop.filter(|value| *value > Decimal::ZERO);
    let next_stop = match requested_stop {
        Some(value) if value > Decimal::ZERO => Some(value),
        Some(_) => None,
        None => current_stop,
    };
    if rules.require_stop_loss && next_stop.is_none() {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "PROP_RISK_STOP_LOSS_REQUIRED",
            "prop risk guard does not allow removing or retaining an unprotected order",
        ));
    }
    let Some(current_stop) = current_stop else {
        // Adding the first valid stop converts previously unbounded risk into a
        // measurable loss, so it is always a risk-reducing modification.
        return Ok(());
    };
    let Some(next_stop) = next_stop else {
        return Ok(());
    };
    let Some(instrument) = instrument else {
        if actions.fail_closed_on_stale_data {
            return Err(ApiError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "PROP_RISK_STATE_UNAVAILABLE",
                "prop risk guard cannot verify the lifecycle modification without instrument metadata",
            ));
        }
        return Ok(());
    };
    let Some(tick_value) = instrument.tick_value_per_quantity else {
        if actions.fail_closed_on_stale_data {
            return Err(ApiError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "PROP_RISK_STATE_UNAVAILABLE",
                "prop risk guard cannot verify the lifecycle modification without tick value",
            ));
        }
        return Ok(());
    };
    if instrument.price_tick <= Decimal::ZERO || tick_value <= Decimal::ZERO {
        if actions.fail_closed_on_stale_data {
            return Err(ApiError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "PROP_RISK_STATE_UNAVAILABLE",
                "prop risk guard cannot verify the lifecycle modification from invalid tick metadata",
            ));
        }
        return Ok(());
    }
    let current_risk =
        (current_reference - current_stop).abs() / instrument.price_tick * tick_value * quantity;
    let next_risk =
        (next_reference - next_stop).abs() / instrument.price_tick * tick_value * quantity;
    if next_risk > current_risk {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "PROP_RISK_MODIFICATION_INCREASES_RISK",
            "prop risk guard allows stop and pending-entry edits only when they keep or reduce the committed risk",
        ));
    }
    Ok(())
}

fn validate_identifier(field: &'static str, value: &str, maximum: usize) -> Result<(), ApiError> {
    if value.is_empty()
        || value.len() > maximum
        || !value.bytes().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, b'.' | b'_' | b':' | b'-')
        })
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "IDENTIFIER_INVALID",
            format!("{field} contains unsupported characters"),
        ));
    }
    Ok(())
}

fn validate_account_layout_items(item_ids: &[String]) -> Result<(), ApiError> {
    if item_ids.len() > 129 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "ACCOUNT_LAYOUT_TOO_LARGE",
            "account layout contains too many items",
        ));
    }
    let mut unique = HashSet::with_capacity(item_ids.len());
    let mut simulator_count = 0;
    for item_id in item_ids {
        validate_identifier("itemId", item_id, 128)?;
        if !unique.insert(item_id.as_str()) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "ACCOUNT_LAYOUT_DUPLICATE",
                "account layout item ids must be unique",
            ));
        }
        if item_id.starts_with("simulator:") {
            simulator_count += 1;
        }
    }
    if simulator_count > 1 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "ACCOUNT_LAYOUT_SIMULATOR_DUPLICATE",
            "account layout may contain only one simulator",
        ));
    }
    Ok(())
}

fn adapter_submission_error(error: AdapterError) -> (&'static str, String) {
    match error {
        AdapterError::AccountOffline => ("ACCOUNT_OFFLINE", "target account is offline".into()),
        AdapterError::Backpressure => (
            "COMMAND_QUEUE_FULL",
            "target command queue is temporarily full".into(),
        ),
        AdapterError::IdempotencyConflict => (
            "IDEMPOTENCY_CONFLICT",
            "idempotency key conflicts with another command".into(),
        ),
        AdapterError::Rejected(_) => (
            "ADAPTER_REJECTED",
            "target adapter rejected the command".into(),
        ),
        AdapterError::Transport(_) => (
            "ADAPTER_UNAVAILABLE",
            "target adapter is temporarily unavailable".into(),
        ),
    }
}

pub(crate) fn require_admin(state: &GatewayState, headers: &HeaderMap) -> Result<(), ApiError> {
    if state.admin_token_matches(headers) {
        Ok(())
    } else {
        Err(ApiError::unauthorized("admin token is invalid"))
    }
}

fn validate_session_request(request: &EaSessionRequest) -> Result<(), ApiError> {
    if request.protocol_version != EXECUTION_PROTOCOL_VERSION {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "PROTOCOL_VERSION_UNSUPPORTED",
            "EA and gateway protocol versions do not match",
        ));
    }
    if !(32..=256).contains(&request.pairing_token.len()) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "PAIRING_TOKEN_INVALID",
            "pairing token has an invalid length",
        ));
    }
    validate_plain_text("agentId", &request.agent_id, 1, 200)?;
    if let Some(binding) = &request.runtime_binding {
        validate_identifier("slotId", &binding.slot_id, 64)?;
        if binding.terminal_pid == 0
            || !mt5_vm_control::valid_ea_gateway_origin(&binding.gateway_origin)
        {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "MANAGED_EA_RUNTIME_BINDING_INVALID",
                "managed EA runtime binding is invalid",
            ));
        }
    }
    validate_account_snapshot(&request.account)
}

fn validate_account_snapshot(account: &EaAccountSnapshot) -> Result<(), ApiError> {
    validate_plain_text("broker", &account.broker, 1, 128)?;
    validate_plain_text("server", &account.server, 1, 128)?;
    if account.login.is_empty()
        || account.login.len() > 20
        || !account
            .login
            .bytes()
            .all(|character| character.is_ascii_digit())
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "ACCOUNT_LOGIN_INVALID",
            "MT5 login must contain 1 to 20 digits",
        ));
    }
    if account.currency.is_empty()
        || account.currency.len() > 12
        || !account
            .currency
            .bytes()
            .all(|character| character.is_ascii_alphanumeric())
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "ACCOUNT_CURRENCY_INVALID",
            "account currency must be 1 to 12 letters or digits",
        ));
    }
    if matches!(
        account.mode,
        execution_domain::AccountMode::Simulated | execution_domain::AccountMode::Unknown
    ) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "ACCOUNT_MODE_INVALID",
            "MT5 EA account must be Demo or Live",
        ));
    }
    if account.leverage == 0 || account.terminal_build == 0 || account.margin < Decimal::ZERO {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "ACCOUNT_SNAPSHOT_INVALID",
            "MT5 leverage/build must be positive and margin cannot be negative",
        ));
    }
    Ok(())
}

fn validate_event_batch_envelope(batch: &EaEventBatch) -> Result<(), ApiError> {
    validate_account_snapshot(&batch.account)?;
    if batch.instruments.len() > 64
        || batch.positions.len() > 500
        || batch.pending_orders.len() > 500
        || batch.events.len() > MAX_EA_EVENTS_PER_BATCH
    {
        return Err(ApiError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "EA_BATCH_TOO_LARGE",
            "EA heartbeat exceeds the per-batch item limit",
        ));
    }
    Ok(())
}

#[cfg(test)]
fn validate_event_batch(batch: &EaEventBatch) -> Result<(), ApiError> {
    validate_event_batch_envelope(batch)?;
    for instrument in &batch.instruments {
        validate_instrument_snapshot(instrument)?;
    }
    for position in &batch.positions {
        validate_position_snapshot(position)?;
    }
    for order in &batch.pending_orders {
        validate_pending_order_snapshot(order)?;
    }
    for event in &batch.events {
        validate_ea_event(event)?;
    }
    Ok(())
}

fn normalize_legacy_ea_clock_skew(batch: &mut EaEventBatch, received_at_ms: u64) -> usize {
    fn normalize(timestamp: &mut u64, received_at_ms: u64) -> bool {
        let maximum = received_at_ms.saturating_add(MAX_LEGACY_EA_CLOCK_SKEW_MS);
        if *timestamp > received_at_ms.saturating_add(60_000) && *timestamp <= maximum {
            *timestamp = received_at_ms;
            return true;
        }
        false
    }

    let mut normalized = 0;
    for instrument in &mut batch.instruments {
        normalized += normalize(&mut instrument.observed_at_ms, received_at_ms) as usize;
    }
    for position in &mut batch.positions {
        normalized += normalize(&mut position.observed_at_ms, received_at_ms) as usize;
    }
    for order in &mut batch.pending_orders {
        normalized += normalize(&mut order.observed_at_ms, received_at_ms) as usize;
    }
    for event in &mut batch.events {
        match event {
            EaEvent::CommandAccepted { occurred_at_ms, .. }
            | EaEvent::CommandRejected { occurred_at_ms, .. }
            | EaEvent::CommandUnknown { occurred_at_ms, .. }
            | EaEvent::TradeTransaction { occurred_at_ms, .. } => {
                normalized += normalize(occurred_at_ms, received_at_ms) as usize;
            }
        }
    }
    normalized
}

fn normalize_events(events: Vec<EaEvent>) -> Result<Vec<EaEvent>, ApiError> {
    let mut unique = Vec::with_capacity(events.len());
    for event in events {
        if !unique.contains(&event) {
            unique.push(event);
        }
    }
    let mut identities = HashSet::with_capacity(unique.len());
    for event in &unique {
        if !identities.insert(event_identity(event)) {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "EA_EVENT_CONFLICT",
                "EA event batch contains conflicting outcomes for one broker event",
            ));
        }
    }
    Ok(unique)
}

fn validate_ea_event(event: &EaEvent) -> Result<(), ApiError> {
    let occurred_at_ms = match event {
        EaEvent::CommandAccepted {
            command_id,
            broker_order_id,
            broker_deal_id,
            message,
            occurred_at_ms,
            ..
        } => {
            validate_identifier("commandId", command_id.as_str(), 128)?;
            if let Some(value) = broker_order_id {
                validate_broker_ticket("brokerOrderId", value)?;
            }
            if let Some(value) = broker_deal_id {
                validate_broker_ticket("brokerDealId", value)?;
            }
            validate_plain_text("message", message, 0, 512)?;
            *occurred_at_ms
        }
        EaEvent::CommandRejected {
            command_id,
            message,
            occurred_at_ms,
            ..
        }
        | EaEvent::CommandUnknown {
            command_id,
            message,
            occurred_at_ms,
        } => {
            validate_identifier("commandId", command_id.as_str(), 128)?;
            validate_plain_text("message", message, 1, 512)?;
            *occurred_at_ms
        }
        EaEvent::TradeTransaction {
            broker_order_id,
            broker_deal_id,
            broker_position_id,
            transaction_type,
            occurred_at_ms,
            ..
        } => {
            if let Some(value) = broker_order_id {
                validate_broker_ticket("brokerOrderId", value)?;
            }
            if let Some(value) = broker_deal_id {
                validate_broker_ticket("brokerDealId", value)?;
            }
            if let Some(value) = broker_position_id {
                validate_broker_ticket("brokerPositionId", value)?;
            }
            validate_plain_text("transactionType", transaction_type, 1, 64)?;
            *occurred_at_ms
        }
    };
    if occurred_at_ms == 0 || occurred_at_ms > now_ms().saturating_add(60_000) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "EA_EVENT_TIME_INVALID",
            "EA event time is invalid",
        ));
    }
    Ok(())
}

fn validate_plain_text(
    field: &'static str,
    value: &str,
    minimum: usize,
    maximum: usize,
) -> Result<(), ApiError> {
    let value = value.trim();
    if !(minimum..=maximum).contains(&value.len()) || value.chars().any(char::is_control) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "TEXT_FIELD_INVALID",
            format!("{field} has an invalid length or contains control characters"),
        ));
    }
    Ok(())
}

fn validate_instrument_snapshot(instrument: &EaInstrumentSnapshot) -> Result<(), ApiError> {
    validate_plain_text("canonicalSymbol", &instrument.spec.canonical_symbol, 1, 64)?;
    validate_plain_text("venueSymbol", &instrument.spec.venue_symbol, 1, 64)?;
    if instrument.spec.quantity_step <= rust_decimal::Decimal::ZERO
        || instrument.spec.min_quantity <= rust_decimal::Decimal::ZERO
        || instrument.spec.max_quantity < instrument.spec.min_quantity
        || instrument.spec.price_tick <= rust_decimal::Decimal::ZERO
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "INSTRUMENT_SPEC_INVALID",
            "instrument quantity and price increments are invalid",
        ));
    }
    if let (Some(bid), Some(ask)) = (instrument.bid, instrument.ask)
        && (bid < rust_decimal::Decimal::ZERO || ask < bid)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "INSTRUMENT_QUOTE_INVALID",
            "instrument quote is invalid",
        ));
    }
    if instrument.observed_at_ms == 0 || instrument.observed_at_ms > now_ms().saturating_add(60_000)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "INSTRUMENT_TIME_INVALID",
            "instrument observation time is invalid",
        ));
    }
    Ok(())
}

fn validate_broker_ticket(field: &'static str, value: &str) -> Result<(), ApiError> {
    if value.is_empty()
        || value.len() > 32
        || !value.bytes().all(|character| character.is_ascii_digit())
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "BROKER_TICKET_INVALID",
            format!("{field} must contain 1 to 32 digits"),
        ));
    }
    Ok(())
}

fn validate_snapshot_time(observed_at_ms: u64) -> Result<(), ApiError> {
    if observed_at_ms == 0 || observed_at_ms > now_ms().saturating_add(60_000) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "PORTFOLIO_TIME_INVALID",
            "portfolio observation time is invalid",
        ));
    }
    Ok(())
}

fn validate_position_snapshot(position: &EaPositionSnapshot) -> Result<(), ApiError> {
    validate_broker_ticket("brokerPositionId", &position.broker_position_id)?;
    validate_plain_text("canonicalSymbol", &position.canonical_symbol, 1, 64)?;
    validate_plain_text("venueSymbol", &position.venue_symbol, 1, 64)?;
    validate_plain_text("comment", &position.comment, 0, 128)?;
    if position.quantity <= Decimal::ZERO
        || position.open_price <= Decimal::ZERO
        || position.current_price < Decimal::ZERO
        || position
            .stop_loss
            .is_some_and(|value| value < Decimal::ZERO)
        || position
            .take_profit
            .is_some_and(|value| value < Decimal::ZERO)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "POSITION_SNAPSHOT_INVALID",
            "position quantity or prices are invalid",
        ));
    }
    validate_snapshot_time(position.observed_at_ms)
}

fn validate_pending_order_snapshot(order: &EaPendingOrderSnapshot) -> Result<(), ApiError> {
    validate_broker_ticket("brokerOrderId", &order.broker_order_id)?;
    validate_plain_text("canonicalSymbol", &order.canonical_symbol, 1, 64)?;
    validate_plain_text("venueSymbol", &order.venue_symbol, 1, 64)?;
    validate_plain_text("comment", &order.comment, 0, 128)?;
    if matches!(order.kind, execution_domain::OrderKind::Market)
        || order.quantity <= Decimal::ZERO
        || order.price <= Decimal::ZERO
        || order.stop_loss.is_some_and(|value| value < Decimal::ZERO)
        || order.take_profit.is_some_and(|value| value < Decimal::ZERO)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "PENDING_ORDER_SNAPSHOT_INVALID",
            "pending order type, quantity, or prices are invalid",
        ));
    }
    validate_snapshot_time(order.observed_at_ms)
}

pub(crate) fn parse_owner_id(owner_id: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(owner_id.trim()).map_err(|_| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "OWNER_ID_INVALID",
            "ownerId must be a valid UUID",
        )
    })
}

fn prop_risk_status_name(status: PropRiskStatus) -> &'static str {
    match status {
        PropRiskStatus::Protected => "protected",
        PropRiskStatus::Warning => "warning",
        PropRiskStatus::Locked => "locked",
        PropRiskStatus::Breached => "breached",
    }
}

fn prop_risk_reason_name(reason: PropRiskReason) -> &'static str {
    match reason {
        PropRiskReason::DailyLossWarning => "DAILY_LOSS_WARNING",
        PropRiskReason::MaxLossWarning => "MAX_LOSS_WARNING",
        PropRiskReason::DailyLossSafetyBuffer => "DAILY_LOSS_SAFETY_BUFFER",
        PropRiskReason::MaxLossSafetyBuffer => "MAX_LOSS_SAFETY_BUFFER",
        PropRiskReason::DailyLossLimitBreached => "DAILY_LOSS_LIMIT_BREACHED",
        PropRiskReason::MaxLossLimitBreached => "MAX_LOSS_LIMIT_BREACHED",
        PropRiskReason::DailyProfitTargetReached => "DAILY_PROFIT_TARGET_REACHED",
        PropRiskReason::UnprotectedExposure => "UNPROTECTED_EXPOSURE",
        PropRiskReason::TelemetryStale => "TELEMETRY_STALE",
        PropRiskReason::StateUnavailable => "STATE_UNAVAILABLE",
    }
}

fn valid_prop_identifier(value: &str, min_len: usize, max_len: usize) -> bool {
    let value = value.trim();
    (min_len..=max_len).contains(&value.len())
        && value.bytes().enumerate().all(|(index, character)| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || (index > 0 && matches!(character, b'_' | b'-'))
        })
}

fn positive_decimal(value: Decimal) -> Decimal {
    if value > Decimal::ZERO {
        value
    } else {
        Decimal::ZERO
    }
}

fn floor_to_step(value: Decimal, step: Decimal) -> Decimal {
    if step <= Decimal::ZERO {
        return value;
    }
    (value / step).floor() * step
}

fn validate_managed_ea_identity(
    identity_key: &[u8; 32],
    binding: &ManagedEaPairingBinding,
    account: &EaAccountSnapshot,
) -> Result<(), ApiError> {
    validate_managed_identity_fingerprint(identity_key, &binding.identity_fingerprint, account)
}

fn validate_managed_runtime_binding(
    expected: &ManagedEaPairingBinding,
    observed: Option<&EaManagedRuntimeBinding>,
) -> Result<(), ApiError> {
    let matches = observed.is_some_and(|observed| {
        observed.slot_id == expected.slot_id
            && observed.terminal_pid == expected.terminal_pid
            && observed.gateway_origin == expected.gateway_origin
    });
    if matches {
        Ok(())
    } else {
        Err(ApiError::new(
            StatusCode::CONFLICT,
            "MANAGED_EA_RUNTIME_BINDING_MISMATCH",
            "managed EA runtime does not match the attested worker slot",
        ))
    }
}

fn validate_managed_identity_fingerprint(
    identity_key: &[u8; 32],
    expected_fingerprint: &[u8],
    account: &EaAccountSnapshot,
) -> Result<(), ApiError> {
    let observed = mt5_identity_fingerprint(identity_key, &account.login, &account.server);
    if expected_fingerprint.len() != observed.len()
        || !secret_matches(
            &observed,
            expected_fingerprint.try_into().expect("length checked"),
        )
    {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "MANAGED_EA_IDENTITY_MISMATCH",
            "managed EA terminal identity does not match the reserved account",
        ));
    }
    Ok(())
}

fn validate_session_account_identity(
    identity_key: &[u8; 32],
    session: &EaSession,
    account: &EaAccountSnapshot,
) -> Result<(), ApiError> {
    if let Some(identity) = &session.managed_identity {
        if validate_identifier("slotId", &identity.runtime_binding.slot_id, 64).is_err()
            || identity.runtime_binding.terminal_pid == 0
            || !mt5_vm_control::valid_ea_gateway_origin(&identity.runtime_binding.gateway_origin)
        {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "MANAGED_EA_RUNTIME_BINDING_INVALID",
                "managed EA session runtime binding is invalid",
            ));
        }
        return validate_managed_identity_fingerprint(
            identity_key,
            &identity.identity_fingerprint,
            account,
        );
    }
    if stable_mt5_account_id(&session.owner_id, account) != session.account_id {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "ACCOUNT_SESSION_MISMATCH",
            "EA account identity changed; create a new session",
        ));
    }
    Ok(())
}

fn stable_mt5_account_id(owner_id: &str, account: &EaAccountSnapshot) -> AccountId {
    let identity = format!(
        "mt5:{}:{}:{}",
        owner_id.trim(),
        account.server.trim().to_lowercase(),
        account.login.trim()
    );
    AccountId::new(format!("mt5_{}", short_hash(identity.as_bytes())))
}

fn command_id(command: &EaCommand) -> Option<&str> {
    match command {
        EaCommand::Place { order } => Some(order.command_id.as_str()),
        EaCommand::ModifyPosition { command } => Some(command.command_id.as_str()),
        EaCommand::ModifyPendingOrder { command } => Some(command.command_id.as_str()),
        EaCommand::ClosePosition { command } => Some(command.command_id.as_str()),
        EaCommand::CancelOrder { command } => Some(command.command_id.as_str()),
        EaCommand::Sync => None,
    }
}

fn command_target_account(command: &EaCommand) -> Option<&AccountId> {
    match command {
        EaCommand::Place { order } => Some(&order.target_account_id),
        EaCommand::ModifyPosition { command } => Some(&command.target_account_id),
        EaCommand::ModifyPendingOrder { command } => Some(&command.target_account_id),
        EaCommand::ClosePosition { command } => Some(&command.target_account_id),
        EaCommand::CancelOrder { command } => Some(&command.target_account_id),
        EaCommand::Sync => None,
    }
}

fn command_idempotency_key(command: &EaCommand) -> Option<&str> {
    match command {
        EaCommand::Place { order } => Some(order.idempotency_key.as_str()),
        EaCommand::ModifyPosition { command } => Some(command.idempotency_key.as_str()),
        EaCommand::ModifyPendingOrder { command } => Some(command.idempotency_key.as_str()),
        EaCommand::ClosePosition { command } => Some(command.idempotency_key.as_str()),
        EaCommand::CancelOrder { command } => Some(command.idempotency_key.as_str()),
        EaCommand::Sync => None,
    }
}

fn command_parent_id(command: &EaCommand) -> Option<&str> {
    match command {
        EaCommand::Place { order } => Some(order.parent_command_id.as_str()),
        EaCommand::ModifyPosition { command } => Some(command.command_id.as_str()),
        EaCommand::ModifyPendingOrder { command } => Some(command.command_id.as_str()),
        EaCommand::ClosePosition { command } => Some(command.command_id.as_str()),
        EaCommand::CancelOrder { command } => Some(command.command_id.as_str()),
        EaCommand::Sync => None,
    }
}

fn event_command_id(event: &execution_domain::EaEvent) -> Option<&str> {
    match event {
        execution_domain::EaEvent::CommandAccepted { command_id, .. }
        | execution_domain::EaEvent::CommandRejected { command_id, .. } => {
            Some(command_id.as_str())
        }
        execution_domain::EaEvent::CommandUnknown { .. }
        | execution_domain::EaEvent::TradeTransaction { .. } => None,
    }
}

fn event_identity(event: &EaEvent) -> String {
    match event {
        EaEvent::CommandAccepted { command_id, .. } => {
            format!("command:{}:accepted", command_id.as_str())
        }
        EaEvent::CommandRejected { command_id, .. } => {
            format!("command:{}:rejected", command_id.as_str())
        }
        EaEvent::CommandUnknown {
            command_id,
            occurred_at_ms,
            ..
        } => format!("command:{}:unknown:{occurred_at_ms}", command_id.as_str()),
        EaEvent::TradeTransaction {
            broker_order_id,
            broker_deal_id,
            broker_position_id,
            transaction_type,
            occurred_at_ms,
            ..
        } => {
            let identity = format!(
                "{}:{}:{}:{}:{}",
                broker_order_id.as_deref().unwrap_or_default(),
                broker_deal_id.as_deref().unwrap_or_default(),
                broker_position_id.as_deref().unwrap_or_default(),
                transaction_type,
                occurred_at_ms
            );
            format!("transaction:{}", short_hash(identity.as_bytes()))
        }
    }
}

fn account_mode_name(mode: execution_domain::AccountMode) -> &'static str {
    match mode {
        execution_domain::AccountMode::Demo => "demo",
        execution_domain::AccountMode::Live => "live",
        execution_domain::AccountMode::Simulated | execution_domain::AccountMode::Unknown => {
            "unknown"
        }
    }
}

fn parse_account_mode(value: &str) -> AccountMode {
    match value {
        "demo" => AccountMode::Demo,
        "live" => AccountMode::Live,
        "simulated" => AccountMode::Simulated,
        _ => AccountMode::Unknown,
    }
}

fn parse_account_status(value: &str) -> AccountStatus {
    match value {
        "disabled" => AccountStatus::Disabled,
        "connecting" => AccountStatus::Connecting,
        "ready" => AccountStatus::Ready,
        "degraded" => AccountStatus::Degraded,
        "blocked" => AccountStatus::Blocked,
        _ => AccountStatus::Offline,
    }
}

fn parse_venue_kind(value: &str) -> Result<VenueKind, ApiError> {
    match value {
        "metatrader5" => Ok(VenueKind::MetaTrader5),
        "binance_spot" => Ok(VenueKind::BinanceSpot),
        "binance_usdm" => Ok(VenueKind::BinanceUsdM),
        _ => Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "VENUE_CONFIGURATION_INVALID",
            "execution venue configuration is invalid",
        )),
    }
}

fn normalize_broker_code(broker: &str) -> String {
    let normalized = broker
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    let normalized = normalized
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if normalized.is_empty() {
        "mt5-broker".into()
    } else {
        normalized
    }
}

fn random_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn short_hash(value: &[u8]) -> String {
    sha256(value)[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn copy_change_source_attributes(change: &PortfolioChange) -> (i64, &str) {
    match change {
        PortfolioChange::PositionOpened { current }
        | PortfolioChange::PositionIncreased { current, .. }
        | PortfolioChange::PositionReduced { current, .. }
        | PortfolioChange::PositionProtectionChanged { current, .. } => {
            (current.magic, current.comment.as_str())
        }
        PortfolioChange::PositionClosed { previous } => (previous.magic, previous.comment.as_str()),
        PortfolioChange::PendingCreated { current }
        | PortfolioChange::PendingModified { current, .. }
        | PortfolioChange::PendingReplaced { current, .. } => {
            (current.magic, current.comment.as_str())
        }
        PortfolioChange::PendingCancelled { previous } => {
            (previous.magic, previous.comment.as_str())
        }
        PortfolioChange::PendingFilled { previous, .. } => {
            (previous.magic, previous.comment.as_str())
        }
    }
}

fn copy_change_allowed(change: &PortfolioChange, config: &ContinuousCopyConfig) -> bool {
    let source_filter_matches = copy_source_filters_match(change, config);
    match change {
        PortfolioChange::PositionOpened { .. } => {
            source_filter_matches && config.copy_market_orders
        }
        PortfolioChange::PositionIncreased { .. } => {
            source_filter_matches && config.copy_market_orders && config.copy_modifications
        }
        PortfolioChange::PositionReduced { .. } => config.copy_partial_closes,
        // Once exposure is linked, source filters and entry toggles never
        // suppress the risk-reducing terminal lifecycle.
        PortfolioChange::PositionClosed { .. } => true,
        PortfolioChange::PositionProtectionChanged { .. } => {
            config.copy_stop_loss_take_profit && config.copy_modifications
        }
        PortfolioChange::PendingCreated { .. } => {
            source_filter_matches && config.copy_pending_orders
        }
        PortfolioChange::PendingModified { .. } | PortfolioChange::PendingReplaced { .. } => {
            config.copy_pending_orders && config.copy_modifications
        }
        PortfolioChange::PendingCancelled { .. } => true,
        PortfolioChange::PendingFilled { .. } => true,
    }
}

fn copy_source_filters_match(change: &PortfolioChange, config: &ContinuousCopyConfig) -> bool {
    let (magic, comment) = copy_change_source_attributes(change);
    !config
        .source_magic_filter
        .is_some_and(|expected| expected != magic)
        && !config
            .source_comment_prefix
            .as_deref()
            .is_some_and(|prefix| !comment.starts_with(prefix))
}

fn copy_change_allowed_while_paused(change: &PortfolioChange) -> bool {
    matches!(
        change,
        PortfolioChange::PositionReduced { .. }
            | PortfolioChange::PositionClosed { .. }
            | PortfolioChange::PendingCancelled { .. }
            | PortfolioChange::PendingFilled { .. }
    )
}

fn copy_source_entity_kind(change: &PortfolioChange) -> &'static str {
    match change {
        PortfolioChange::PositionOpened { .. }
        | PortfolioChange::PositionIncreased { .. }
        | PortfolioChange::PositionReduced { .. }
        | PortfolioChange::PositionClosed { .. }
        | PortfolioChange::PositionProtectionChanged { .. } => "position",
        PortfolioChange::PendingCreated { .. }
        | PortfolioChange::PendingModified { .. }
        | PortfolioChange::PendingReplaced { .. }
        | PortfolioChange::PendingCancelled { .. }
        | PortfolioChange::PendingFilled { .. } => "pending_order",
    }
}

fn copier_link_source_identity<'a>(
    change: &'a PortfolioChange,
    operation: &str,
) -> (&'static str, &'a str) {
    if operation == "open_market"
        && let PortfolioChange::PendingFilled { position, .. } = change
    {
        ("position", position.broker_position_id.as_str())
    } else {
        (copy_source_entity_kind(change), change.source_resource_id())
    }
}

fn copy_work_operations(
    change: &PortfolioChange,
    config: &ContinuousCopyConfig,
) -> Vec<&'static str> {
    match change {
        PortfolioChange::PositionOpened { .. } if config.copy_market_orders => {
            vec!["open_market"]
        }
        PortfolioChange::PositionIncreased { .. }
            if config.copy_market_orders && config.copy_modifications =>
        {
            vec!["open_market"]
        }
        PortfolioChange::PositionReduced { .. } if config.copy_partial_closes => {
            vec!["partial_close"]
        }
        PortfolioChange::PositionClosed { .. } => vec!["close_position"],
        PortfolioChange::PositionProtectionChanged { .. }
            if config.copy_stop_loss_take_profit && config.copy_modifications =>
        {
            vec!["modify_position"]
        }
        PortfolioChange::PendingCreated { .. } if config.copy_pending_orders => {
            vec!["place_pending"]
        }
        PortfolioChange::PendingModified { .. }
            if config.copy_pending_orders && config.copy_modifications =>
        {
            vec!["modify_pending"]
        }
        PortfolioChange::PendingReplaced { .. }
            if config.copy_pending_orders && config.copy_modifications =>
        {
            vec!["cancel_pending", "place_pending"]
        }
        PortfolioChange::PendingCancelled { .. } => vec!["cancel_pending"],
        PortfolioChange::PendingFilled { .. } if config.copy_market_orders => vec!["open_market"],
        PortfolioChange::PendingFilled { .. } => vec!["reconcile"],
        _ => Vec::new(),
    }
}

fn copy_work_operations_for_runtime(
    change: &PortfolioChange,
    config: &ContinuousCopyConfig,
    runtime_status: &str,
) -> Vec<&'static str> {
    if runtime_status == "paused" && matches!(change, PortfolioChange::PendingFilled { .. }) {
        // A pending link that already exists may still be adopted while the
        // group is paused, but an unlinked fill must not become new exposure.
        vec!["reconcile"]
    } else {
        copy_work_operations(change, config)
    }
}

fn copier_work_is_stale(
    operation: &str,
    observed_at_ms: u64,
    current_time_ms: u64,
    stale_after_ms: u64,
) -> bool {
    matches!(operation, "open_market" | "place_pending")
        && current_time_ms.saturating_sub(observed_at_ms) > stale_after_ms
}

fn copier_operation_allowed_while_paused(operation: &str, phase: Option<&str>) -> bool {
    matches!(
        operation,
        "partial_close" | "close_position" | "cancel_pending" | "reconcile"
    ) || (operation == "modify_position" && phase == Some("target_protection"))
}

fn copier_side_name(side: Side) -> &'static str {
    match side {
        Side::Buy => "buy",
        Side::Sell => "sell",
    }
}

fn copier_expected_target_side(metadata: &serde_json::Value, source_side: Side) -> &str {
    metadata
        .get("side")
        .and_then(serde_json::Value::as_str)
        .filter(|side| matches!(*side, "buy" | "sell"))
        .unwrap_or_else(|| copier_side_name(source_side))
}

fn copier_reverse_side(side: Side) -> Side {
    match side {
        Side::Buy => Side::Sell,
        Side::Sell => Side::Buy,
    }
}

fn copier_reverse_kind(kind: OrderKind) -> OrderKind {
    match kind {
        OrderKind::Market => OrderKind::Market,
        OrderKind::Limit => OrderKind::Stop,
        OrderKind::Stop => OrderKind::Limit,
    }
}

fn copier_drawdown_breached(
    balance: Option<Decimal>,
    equity: Option<Decimal>,
    limit_basis_points: u32,
) -> bool {
    let (Some(balance), Some(equity)) = (balance, equity) else {
        return false;
    };
    if balance <= Decimal::ZERO || equity >= balance || limit_basis_points == 0 {
        return false;
    }
    (balance - equity) * Decimal::from(10_000_u32) >= balance * Decimal::from(limit_basis_points)
}

fn copier_target_protection_stop(
    position: &EaPositionSnapshot,
    price_tick: Decimal,
    protection: &CopyProtectionConfig,
) -> Option<Decimal> {
    if price_tick <= Decimal::ZERO {
        return None;
    }
    let favorable_move = match position.side {
        Side::Buy => position.current_price - position.open_price,
        Side::Sell => position.open_price - position.current_price,
    };
    if favorable_move <= Decimal::ZERO {
        return None;
    }
    let favorable_points = favorable_move / price_tick;
    let mut candidates = Vec::<Decimal>::with_capacity(2);

    if protection.trailing_stop_points > 0
        && favorable_points >= Decimal::from(protection.trailing_start_points)
    {
        let distance = price_tick * Decimal::from(protection.trailing_stop_points);
        let candidate = match position.side {
            Side::Buy => position.current_price - distance,
            Side::Sell => position.current_price + distance,
        };
        let step = price_tick * Decimal::from(protection.trailing_step_points.max(1));
        let advances = position
            .stop_loss
            .is_none_or(|current| match position.side {
                Side::Buy => candidate - current >= step,
                Side::Sell => current - candidate >= step,
            });
        if advances {
            candidates.push(candidate);
        }
    }

    if protection.breakeven_trigger_points > 0
        && favorable_points >= Decimal::from(protection.breakeven_trigger_points)
    {
        let offset = price_tick * Decimal::from(protection.breakeven_offset_points);
        let candidate = match position.side {
            Side::Buy => position.open_price + offset,
            Side::Sell => position.open_price - offset,
        };
        let advances = position
            .stop_loss
            .is_none_or(|current| match position.side {
                Side::Buy => candidate > current,
                Side::Sell => candidate < current,
            });
        if advances {
            candidates.push(candidate);
        }
    }

    candidates
        .into_iter()
        .filter(|candidate| {
            *candidate > Decimal::ZERO
                && match position.side {
                    Side::Buy => *candidate < position.current_price,
                    Side::Sell => *candidate > position.current_price,
                }
        })
        .reduce(|best, candidate| match position.side {
            Side::Buy => best.max(candidate),
            Side::Sell => best.min(candidate),
        })
}

fn copier_source_quantity(change: &PortfolioChange) -> Option<Decimal> {
    match change {
        PortfolioChange::PositionOpened { current } => Some(current.quantity),
        PortfolioChange::PositionIncreased { delta, .. } => Some(*delta),
        PortfolioChange::PendingFilled { previous, .. } => Some(previous.quantity),
        PortfolioChange::PendingCreated { current }
        | PortfolioChange::PendingModified { current, .. }
        | PortfolioChange::PendingReplaced { current, .. } => Some(current.quantity),
        _ => None,
    }
}

fn copier_position_protection(
    change: &PortfolioChange,
    reverse_trade: bool,
) -> Result<(Option<Decimal>, Option<Decimal>), CopierWorkError> {
    match change {
        PortfolioChange::PositionProtectionChanged { current, .. } if reverse_trade => {
            Ok((current.take_profit, current.stop_loss))
        }
        PortfolioChange::PositionProtectionChanged { current, .. } => {
            Ok((current.stop_loss, current.take_profit))
        }
        _ => Err(CopierWorkError::permanent(
            "COPY_PROTECTION_PAYLOAD_INVALID",
            "position protection operation requires a position protection change",
        )),
    }
}

fn copier_pending_modification(
    change: &PortfolioChange,
    reverse_trade: bool,
) -> Result<(Decimal, Option<Decimal>, Option<Decimal>), CopierWorkError> {
    let current = copier_current_pending(change)?;
    if reverse_trade {
        Ok((current.price, current.take_profit, current.stop_loss))
    } else {
        Ok((current.price, current.stop_loss, current.take_profit))
    }
}

fn copier_current_pending(
    change: &PortfolioChange,
) -> Result<&EaPendingOrderSnapshot, CopierWorkError> {
    match change {
        PortfolioChange::PendingModified { current, .. }
        | PortfolioChange::PendingReplaced { current, .. }
        | PortfolioChange::PendingCreated { current } => Ok(current),
        _ => Err(CopierWorkError::permanent(
            "COPY_PENDING_PAYLOAD_INVALID",
            "pending-order operation requires a current pending snapshot",
        )),
    }
}

fn copier_partial_close_quantity(
    change: &PortfolioChange,
    target_quantity: Option<Decimal>,
) -> Option<Decimal> {
    match change {
        PortfolioChange::PositionReduced {
            previous, delta, ..
        } if previous.quantity > Decimal::ZERO => {
            let target = target_quantity?;
            let scaled = (*delta * target / previous.quantity).min(target);
            (scaled > Decimal::ZERO).then_some(scaled)
        }
        _ => None,
    }
}

fn copier_order_intent(
    change: &PortfolioChange,
    target_config: &ContinuousCopyTargetConfig,
    command_id: &execution_domain::CommandId,
    idempotency_key: &IdempotencyKey,
    operation: &str,
    source_account_id: Option<AccountId>,
    copy_stop_loss_take_profit: bool,
) -> Result<OrderIntent, CopierWorkError> {
    let (
        canonical_symbol,
        mut side,
        mut kind,
        quantity,
        entry_price,
        mut stop_loss,
        mut take_profit,
    ) = match (operation, change) {
        ("open_market", PortfolioChange::PositionOpened { current }) => (
            current.canonical_symbol.clone(),
            current.side,
            OrderKind::Market,
            current.quantity,
            None,
            current.stop_loss,
            current.take_profit,
        ),
        ("open_market", PortfolioChange::PositionIncreased { delta, current, .. }) => (
            current.canonical_symbol.clone(),
            current.side,
            OrderKind::Market,
            *delta,
            None,
            current.stop_loss,
            current.take_profit,
        ),
        ("open_market", PortfolioChange::PendingFilled { previous, position }) => (
            position.canonical_symbol.clone(),
            position.side,
            OrderKind::Market,
            previous.quantity,
            None,
            position.stop_loss,
            position.take_profit,
        ),
        ("place_pending", change) => {
            let current = copier_current_pending(change)?;
            (
                current.canonical_symbol.clone(),
                current.side,
                current.kind,
                current.quantity,
                Some(current.price),
                current.stop_loss,
                current.take_profit,
            )
        }
        _ => {
            return Err(CopierWorkError::permanent(
                "COPY_ORDER_PAYLOAD_INVALID",
                "copy order operation does not contain an orderable source snapshot",
            ));
        }
    };
    if quantity <= Decimal::ZERO {
        return Err(CopierWorkError::permanent(
            "COPY_QUANTITY_INVALID",
            "source quantity must be positive",
        ));
    }
    if !copy_stop_loss_take_profit {
        stop_loss = None;
        take_profit = None;
    }
    if target_config.reverse_trade {
        side = copier_reverse_side(side);
        if kind != OrderKind::Market {
            kind = copier_reverse_kind(kind);
        }
        std::mem::swap(&mut stop_loss, &mut take_profit);
    }
    // The EA requires the pending entry in the field matching the final
    // (possibly reversed) order kind. Keeping a stop entry in `limitPrice`
    // makes MT5 reject the command as an unsupported order type.
    let (limit_price, stop_price) = match kind {
        OrderKind::Market => (None, None),
        OrderKind::Limit => (entry_price, None),
        OrderKind::Stop => (None, entry_price),
    };
    // The source intent always carries the unallocated MT5 quantity. The
    // route engine owns the target allocation policy; pre-applying it here
    // would square multiplier/equity-proportional factors and bypass the
    // target's fixed/risk sizing semantics.
    let sizing = OrderSizing::Fixed {
        quantity,
        unit: QuantityUnit::Lots,
    };
    Ok(OrderIntent {
        command_id: command_id.clone(),
        idempotency_key: idempotency_key.clone(),
        source_account_id,
        canonical_symbol,
        side,
        kind,
        sizing,
        limit_price,
        stop_price,
        stop_loss,
        take_profit,
        metadata: BTreeMap::from([
            ("copyTrade".into(), "continuous".into()),
            ("operation".into(), operation.into()),
        ]),
    })
}

fn copier_command_type(command: &EaCommand) -> &'static str {
    match command {
        EaCommand::Place { .. } => "place",
        EaCommand::ModifyPosition { .. } => "modify_position",
        EaCommand::ModifyPendingOrder { .. } => "modify_pending",
        EaCommand::ClosePosition { .. } => "close_position",
        EaCommand::CancelOrder { .. } => "cancel_pending",
        EaCommand::Sync => "sync",
    }
}

fn sha256(value: &[u8]) -> [u8; 32] {
    Sha256::digest(value).into()
}

fn derive_mt5_identity_key(secret: &str) -> [u8; 32] {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .expect("HMAC accepts an arbitrary secret length");
    mac.update(b"marketlens/mt5-managed-identity/v1");
    mac.finalize().into_bytes().into()
}

fn mt5_identity_fingerprint(key: &[u8; 32], login: &str, server: &str) -> [u8; 32] {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts a SHA-256-sized key");
    mac.update(server.trim().to_ascii_lowercase().as_bytes());
    mac.update(&[0]);
    mac.update(login.trim().as_bytes());
    mac.finalize().into_bytes().into()
}

fn mt5_server_fingerprint(key: &[u8; 32], server: &str) -> [u8; 32] {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts a SHA-256-sized key");
    mac.update(b"server");
    mac.update(&[0]);
    mac.update(server.trim().to_ascii_lowercase().as_bytes());
    mac.finalize().into_bytes().into()
}

fn secret_matches(candidate: &[u8; 32], expected: &[u8; 32]) -> bool {
    candidate
        .iter()
        .zip(expected)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn header_value<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name)?.to_str().ok()
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    header_value(headers, "authorization")?
        .strip_prefix("Bearer ")
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn command_delivery_expired(queued_at_ms: u64, now_ms: u64) -> bool {
    now_ms.saturating_sub(queued_at_ms) >= COMMAND_DELIVERY_TTL.as_millis() as u64
}

fn parse_ea_version(value: &str) -> Option<(u32, u32, u32)> {
    let core = value
        .trim()
        .split_once(['-', '+'])
        .map_or(value.trim(), |(core, _)| core);
    let mut segments = core.split('.');
    let major = segments.next()?.parse().ok()?;
    let minor = segments.next()?.parse().ok()?;
    let patch = segments.next().unwrap_or("0").parse().ok()?;
    if segments.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

fn ea_version_supported(value: Option<&str>) -> bool {
    value
        .and_then(parse_ea_version)
        .is_some_and(|version| version >= MIN_SUPPORTED_EA_VERSION)
}

fn minimum_supported_ea_version() -> String {
    let (major, minor, patch) = MIN_SUPPORTED_EA_VERSION;
    if patch == 0 {
        format!("{major}.{minor}")
    } else {
        format!("{major}.{minor}.{patch}")
    }
}

fn effective_last_seen_at_ms(
    account_last_seen_at_ms: u64,
    session_last_seen_at_ms: Option<u64>,
) -> u64 {
    session_last_seen_at_ms
        .map(|session| session.max(account_last_seen_at_ms))
        .unwrap_or(account_last_seen_at_ms)
}

async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        warn!(%error, "failed to install Ctrl+C handler");
    }
}

async fn wait_for_shutdown(shutdown: Arc<Notify>) {
    shutdown.notified().await;
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiErrorBody {
    code: &'static str,
    message: String,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    body: ApiErrorBody,
}

const DECODE_PAIRING_WORKER_GENERATION: &str = "decode managed pairing worker generation";
const DECODE_PAIRING_LEASE_GENERATION: &str = "decode managed pairing lease generation";
const DECODE_PAIRING_CONNECTION_REVISION: &str = "decode managed pairing connection revision";
const DECODE_PAIRING_IDENTITY: &str = "decode managed pairing identity fingerprint";
const DECODE_PAIRING_WORKER: &str = "decode managed pairing worker";
const DECODE_PAIRING_SLOT: &str = "decode managed pairing slot";
const DECODE_SESSION_IDENTITY: &str = "decode managed EA session identity fingerprint";
const DECODE_SESSION_SLOT: &str = "decode managed EA session slot";
const DECODE_SESSION_GATEWAY: &str = "decode managed EA session gateway origin";

#[cfg(test)]
async fn commit_managed_pairing_transaction(
    transaction: sqlx_core::transaction::Transaction<'_, sqlx_postgres::Postgres>,
) -> Result<(), ApiError> {
    transaction.commit().await.map_err(map_database_error(
        "commit managed EA bootstrap transaction",
    ))
}

fn map_database_error(operation: &'static str) -> impl FnOnce(sqlx::Error) -> ApiError {
    move |error| ApiError::database(operation, error)
}

fn deferred_repository_error(operation: &'static str) -> impl FnOnce(sqlx::Error) -> AdapterError {
    move |error| {
        error!(%error, operation, "deferred order repository operation failed");
        AdapterError::Transport("deferred order repository unavailable".into())
    }
}

fn require_active_managed_assignment(active: bool) -> Result<(), ApiError> {
    if active {
        return Ok(());
    }
    Err(ApiError::new(
        StatusCode::CONFLICT,
        "MANAGED_EA_ASSIGNMENT_FENCED",
        "managed EA assignment is no longer active",
    ))
}

fn validate_unmanaged_runtime_binding(
    runtime_binding: Option<&EaManagedRuntimeBinding>,
) -> Result<(), ApiError> {
    if runtime_binding.is_none() {
        return Ok(());
    }
    Err(ApiError::new(
        StatusCode::BAD_REQUEST,
        "MANAGED_EA_RUNTIME_BINDING_UNEXPECTED",
        "runtime binding is valid only for a managed EA bootstrap",
    ))
}

fn required_managed_session_value<T>(value: Option<T>) -> Result<T, ApiError> {
    value.ok_or_else(|| ApiError::unauthorized("managed EA session is fenced"))
}

fn invalid_managed_terminal_pid<T>(_: T) -> ApiError {
    ApiError::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        "MANAGED_EA_RUNTIME_BINDING_INVALID",
        "managed EA runtime binding is invalid",
    )
}

fn require_single_managed_session_update(rows_affected: u64) -> Result<(), ApiError> {
    if rows_affected == 1 {
        return Ok(());
    }
    Err(ApiError::new(
        StatusCode::CONFLICT,
        "MANAGED_EA_ASSIGNMENT_FENCED",
        "managed EA assignment changed before session creation",
    ))
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            body: ApiErrorBody {
                code,
                message: message.into(),
            },
        }
    }

    fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "UNAUTHORIZED", message)
    }

    fn internal(operation: &'static str, error: impl std::fmt::Display) -> Self {
        error!(%error, operation, "execution gateway internal error");
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "execution service could not complete the request",
        )
    }

    fn database(operation: &'static str, error: sqlx::Error) -> Self {
        Self::internal(operation, error)
    }

    fn from_adapter(error: AdapterError) -> Self {
        match error {
            AdapterError::AccountOffline => Self::new(
                StatusCode::CONFLICT,
                "ACCOUNT_OFFLINE",
                "target EA account is offline",
            ),
            AdapterError::Backpressure => Self::new(
                StatusCode::TOO_MANY_REQUESTS,
                "COMMAND_QUEUE_FULL",
                "target command queue is full",
            ),
            AdapterError::IdempotencyConflict => Self::new(
                StatusCode::CONFLICT,
                "IDEMPOTENCY_CONFLICT",
                "idempotency key was already used for a different command",
            ),
            AdapterError::Rejected(message) => Self::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "ADAPTER_REJECTED",
                message,
            ),
            AdapterError::Transport(_) => Self::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "ADAPTER_UNAVAILABLE",
                "execution adapter is temporarily unavailable",
            ),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use execution_domain::{
        AccountMode, CommandId, CopyAllocation, IdempotencyKey, InstrumentSpec, OrderKind,
        OrderSizing, PropRiskDailyLossReference, QuantityUnit, RoutedOrder, Side, VenueKind,
    };
    use rust_decimal::Decimal;
    use std::collections::BTreeMap;

    const ADMIN_TOKEN: &str = "admin-token-with-at-least-32-characters";
    const OWNER_A: &str = "11111111-1111-4111-8111-111111111111";
    const OWNER_B: &str = "22222222-2222-4222-8222-222222222222";
    const PAIR_TOKEN: &str = "pairing-token-with-at-least-32-characters";
    const MANAGED_PAIR_TOKEN: &str =
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const EXPIRED_PAIR_TOKEN: &str = "expired-pairing-token-at-least-32-chars";

    #[test]
    fn managed_database_error_helpers_are_fail_closed() {
        let database =
            map_database_error("synthetic managed database operation")(sqlx::Error::RowNotFound);
        assert_eq!(database.status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(database.body.code, "INTERNAL_ERROR");

        assert!(require_single_managed_session_update(1).is_ok());
        let fenced = require_single_managed_session_update(0)
            .expect_err("zero updated rows must fence a stale managed assignment");
        assert_eq!(fenced.status, StatusCode::CONFLICT);
        assert_eq!(fenced.body.code, "MANAGED_EA_ASSIGNMENT_FENCED");

        let invalid_pid = invalid_managed_terminal_pid(());
        assert_eq!(invalid_pid.status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(invalid_pid.body.code, "MANAGED_EA_RUNTIME_BINDING_INVALID");

        assert!(require_active_managed_assignment(true).is_ok());
        let inactive = require_active_managed_assignment(false)
            .expect_err("an inactive managed assignment must be fenced");
        assert_eq!(inactive.body.code, "MANAGED_EA_ASSIGNMENT_FENCED");

        assert!(validate_unmanaged_runtime_binding(None).is_ok());
        let runtime_binding = EaManagedRuntimeBinding {
            slot_id: "slot-01".into(),
            terminal_pid: 42,
            gateway_origin: "http://127.0.0.1:8790".into(),
        };
        let unexpected = validate_unmanaged_runtime_binding(Some(&runtime_binding))
            .expect_err("an unmanaged pairing cannot carry a managed runtime binding");
        assert_eq!(
            unexpected.body.code,
            "MANAGED_EA_RUNTIME_BINDING_UNEXPECTED"
        );

        assert_eq!(required_managed_session_value(Some(7_u64)).unwrap(), 7);
        assert_eq!(
            required_managed_session_value::<u64>(None)
                .expect_err("missing managed identity field must fence the session")
                .status,
            StatusCode::UNAUTHORIZED
        );

        let repository = deferred_repository_error("synthetic deferred repository operation")(
            sqlx::Error::RowNotFound,
        );
        assert!(matches!(repository, AdapterError::Transport(_)));
    }

    #[test]
    fn optional_copy_group_ids_are_validated_when_present() {
        assert_eq!(parse_optional_copy_group_id(None).unwrap(), None);
        let valid = CopyGroupId::new("11111111-1111-4111-8111-111111111111");
        assert_eq!(
            parse_optional_copy_group_id(Some(&valid)).unwrap(),
            Some(Uuid::parse_str(valid.as_str()).unwrap())
        );
        let invalid = CopyGroupId::new("not-a-uuid");
        assert_eq!(
            parse_optional_copy_group_id(Some(&invalid))
                .expect_err("invalid optional group id must fail")
                .body
                .code,
            "COPY_GROUP_ID_INVALID"
        );
    }

    #[test]
    fn modified_position_commands_retain_their_command_id() {
        let command = EaCommand::ModifyPosition {
            command: ModifyPositionCommand {
                command_id: CommandId::new("modify-position-01"),
                idempotency_key: IdempotencyKey::new("modify-position-idempotency-01"),
                target_account_id: AccountId::new("account-01"),
                broker_position_id: "position-01".into(),
                stop_loss: Some(Decimal::new(109, 2)),
                take_profit: Some(Decimal::new(112, 2)),
            },
        };
        assert_eq!(command_id(&command), Some("modify-position-01"));
    }

    #[tokio::test]
    async fn copy_group_list_validates_the_optional_group_before_database_access() {
        let error = list_copy_groups(
            State(GatewayState::new(ADMIN_TOKEN, None)),
            admin_headers(),
            Query(CopyGroupQuery {
                owner_id: OWNER_A.into(),
                group_id: None,
            }),
        )
        .await
        .expect_err("an in-memory gateway cannot serve persisted copier settings");
        assert_eq!(error.body.code, "PERSISTENT_STORE_REQUIRED");
    }

    #[tokio::test]
    async fn file_backed_identity_config_is_fail_closed_and_builds_production_state() {
        let root = env::temp_dir().join(format!(
            "marketlens-gateway-config-{}-{}",
            std::process::id(),
            now_ms()
        ));
        fs::create_dir_all(root.join("nested")).expect("create config fixture");
        let key_path = root.join("identity.key");
        let large_path = root.join("large.key");
        let invalid_utf8_path = root.join("invalid-utf8.key");
        let short_path = root.join("short.key");
        let multiline_path = root.join("multiline.key");
        let identity = "identity-hmac-key-material-that-is-distinct";

        unsafe { env::remove_var("TEST_MT5_IDENTITY_FILE") };
        assert!(
            required_secret_file("TEST_MT5_IDENTITY_FILE")
                .unwrap_err()
                .contains("is required")
        );
        unsafe { env::set_var("TEST_MT5_IDENTITY_FILE", "relative.key") };
        assert!(
            required_secret_file("TEST_MT5_IDENTITY_FILE")
                .unwrap_err()
                .contains("absolute path")
        );
        unsafe { env::set_var("TEST_MT5_IDENTITY_FILE", root.join("missing.key")) };
        assert!(
            required_secret_file("TEST_MT5_IDENTITY_FILE")
                .unwrap_err()
                .contains("readable regular file")
        );
        unsafe { env::set_var("TEST_MT5_IDENTITY_FILE", &root) };
        assert!(
            required_secret_file("TEST_MT5_IDENTITY_FILE")
                .unwrap_err()
                .contains("small regular file")
        );

        fs::write(&large_path, vec![b'x'; 4097]).expect("write oversized identity key");
        unsafe { env::set_var("TEST_MT5_IDENTITY_FILE", &large_path) };
        assert!(
            required_secret_file("TEST_MT5_IDENTITY_FILE")
                .unwrap_err()
                .contains("small regular file")
        );
        fs::write(&key_path, identity).expect("write identity key");
        unsafe {
            env::set_var(
                "TEST_MT5_IDENTITY_FILE",
                root.join("nested").join("..").join("identity.key"),
            )
        };
        assert!(
            required_secret_file("TEST_MT5_IDENTITY_FILE")
                .unwrap_err()
                .contains("must not traverse a link")
        );

        fs::write(&invalid_utf8_path, [0xff, 0xfe, 0xfd]).expect("write invalid UTF-8 key");
        unsafe { env::set_var("TEST_MT5_IDENTITY_FILE", &invalid_utf8_path) };
        assert!(
            required_secret_file("TEST_MT5_IDENTITY_FILE")
                .unwrap_err()
                .contains("valid UTF-8")
        );
        fs::write(&short_path, "short").expect("write short key");
        unsafe { env::set_var("TEST_MT5_IDENTITY_FILE", &short_path) };
        assert!(
            required_secret_file("TEST_MT5_IDENTITY_FILE")
                .unwrap_err()
                .contains("at least 32")
        );
        fs::write(&multiline_path, format!("{identity}\nsecond-line"))
            .expect("write multiline key");
        unsafe { env::set_var("TEST_MT5_IDENTITY_FILE", &multiline_path) };
        assert!(
            required_secret_file("TEST_MT5_IDENTITY_FILE")
                .unwrap_err()
                .contains("invalid characters")
        );

        unsafe {
            env::set_var("EXECUTION_ADMIN_TOKEN", ADMIN_TOKEN);
            env::set_var("EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE", &key_path);
            env::set_var(
                "EXECUTION_MT5_VM_BOOTSTRAP_TOKEN",
                "bootstrap-token-that-is-distinct-and-long-enough",
            );
            env::set_var("DATABASE_URL", "postgres://localhost/execution");
            env::set_var("EXECUTION_GATEWAY_BIND", "127.0.0.1:18790");
            env::set_var("EXECUTION_ADMIN_BIND", "127.0.0.1:18791");
        }
        let config = Config::from_env().expect("valid file-backed config");
        assert_eq!(config.mt5_identity_hmac_key, identity);
        let database = PgPoolOptions::new()
            .connect_lazy(&config.database_url)
            .expect("lazy PostgreSQL pool");
        let state = production_state(&config, database);
        assert!(state.inner.database.is_some());

        unsafe { env::set_var("EXECUTION_ADMIN_TOKEN", identity) };
        assert!(
            Config::from_env()
                .err()
                .expect("identity/admin collision must fail")
                .contains("distinct")
        );
        unsafe {
            env::set_var("EXECUTION_ADMIN_TOKEN", ADMIN_TOKEN);
            env::set_var("EXECUTION_MT5_VM_BOOTSTRAP_TOKEN", identity);
        }
        assert!(
            Config::from_env()
                .err()
                .expect("identity/bootstrap collision must fail")
                .contains("distinct")
        );

        for name in [
            "TEST_MT5_IDENTITY_FILE",
            "EXECUTION_ADMIN_TOKEN",
            "EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE",
            "EXECUTION_MT5_VM_BOOTSTRAP_TOKEN",
            "DATABASE_URL",
            "EXECUTION_GATEWAY_BIND",
            "EXECUTION_ADMIN_BIND",
        ] {
            unsafe { env::remove_var(name) };
        }
        fs::remove_dir_all(root).expect("remove config fixture");
    }

    #[test]
    fn gateway_main_builds_production_state_without_connecting_in_tests() {
        let root = env::temp_dir().join(format!(
            "marketlens-gateway-main-{}-{}",
            std::process::id(),
            now_ms()
        ));
        fs::create_dir_all(&root).expect("create main config fixture");
        let key_path = root.join("identity.key");
        fs::write(&key_path, "gateway-main-identity-key-material-01")
            .expect("write main identity key");
        unsafe {
            env::set_var("EXECUTION_ADMIN_TOKEN", ADMIN_TOKEN);
            env::set_var("EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE", &key_path);
            env::set_var(
                "EXECUTION_MT5_VM_BOOTSTRAP_TOKEN",
                "gateway-main-bootstrap-token-material-01",
            );
            env::set_var("DATABASE_URL", "postgres://localhost/execution");
            env::set_var("EXECUTION_GATEWAY_BIND", "127.0.0.1:18790");
            env::set_var("EXECUTION_ADMIN_BIND", "127.0.0.1:18791");
        }

        main();

        for name in [
            "EXECUTION_ADMIN_TOKEN",
            "EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE",
            "EXECUTION_MT5_VM_BOOTSTRAP_TOKEN",
            "DATABASE_URL",
            "EXECUTION_GATEWAY_BIND",
            "EXECUTION_ADMIN_BIND",
        ] {
            unsafe { env::remove_var(name) };
        }
        fs::remove_dir_all(root).expect("remove main config fixture");
    }

    fn test_prop_risk_profile() -> PropRiskProfileTemplate {
        PropRiskProfileTemplate {
            id: "test_profile".into(),
            version: 1,
            provider_code: "test".into(),
            program_code: "test_stage".into(),
            display_name: "Test profile".into(),
            timezone: "UTC".into(),
            rules_locked: true,
            capital_mode: PropRiskCapitalMode::ReferenceBalances,
            reference_balances: vec![10_000, 25_000, 50_000, 100_000],
            rules: PropRiskRules {
                daily_loss_limit_basis_points: 500,
                max_loss_limit_basis_points: 1_000,
                daily_loss_reference: PropRiskDailyLossReference::StartOfDayBalance,
                max_loss_mode: PropRiskMaxLossMode::Static,
                max_risk_per_trade_basis_points: 100,
                max_total_open_risk_basis_points: 300,
                require_stop_loss: true,
                warning_buffer_basis_points: 100,
                emergency_buffer_basis_points: 50,
                daily_profit_target_basis_points: None,
                profit_target_basis_points: None,
                best_day_limit_basis_points: None,
                minimum_trading_days: None,
            },
            actions: PropRiskActions {
                block_new_orders: true,
                cancel_pending_orders: true,
                close_open_positions: true,
                lock_after_profit_target: false,
                fail_closed_on_stale_data: true,
            },
            official_source_url: None,
            verified_at: None,
        }
    }

    #[test]
    fn reference_balance_resolution_is_profile_driven_and_fail_safe() {
        let mut profile = test_prop_risk_profile();
        profile.reference_balances = vec![25_000, 50_000, 100_000];

        assert_eq!(
            resolve_profile_initial_balance(&profile, Decimal::new(4_569_807, 2)),
            Ok(Decimal::new(50_000, 0))
        );
        profile.rules_locked = false;
        assert_eq!(
            resolve_profile_initial_balance(&profile, Decimal::new(37_000, 0)),
            Ok(Decimal::new(50_000, 0))
        );

        profile.capital_mode = PropRiskCapitalMode::Manual;
        profile.reference_balances = vec![10_000, 25_000];
        assert_eq!(
            resolve_profile_initial_balance(&profile, Decimal::new(12_345, 0)),
            Ok(Decimal::new(12_345, 0))
        );

        profile.capital_mode = PropRiskCapitalMode::ReferenceBalances;
        profile.reference_balances.clear();
        assert!(resolve_profile_initial_balance(&profile, Decimal::new(12_345, 0)).is_err());
    }

    #[test]
    fn daily_baseline_uses_first_observed_balance_and_remains_stable() {
        let current_balance = Decimal::new(4_569_807, 2);
        let stored_day_start_balance = Decimal::new(4_667_594, 2);

        assert_eq!(
            resolve_prop_risk_day_start_balance(None, current_balance),
            current_balance
        );
        assert_eq!(
            resolve_prop_risk_day_start_balance(Some(stored_day_start_balance), current_balance),
            stored_day_start_balance
        );
    }

    #[test]
    fn legacy_daily_floor_match_requires_the_buggy_persisted_metrics() {
        let profile = test_prop_risk_profile();
        let initial_balance = Decimal::new(50_000, 0);
        let last_equity = Decimal::new(4_594_647, 2);
        let mut evaluation = evaluate_prop_risk(
            &profile.rules,
            &profile.actions,
            &PropRiskEvaluationInput {
                initial_balance,
                day_start_balance: Decimal::new(4_667_594, 2),
                max_loss_reference_balance: initial_balance,
                current_day_min_equity: last_equity,
                historical_max_loss_result: Decimal::ZERO,
                prior_positive_days_profit: Decimal::ZERO,
                prior_best_day_profit: Decimal::ZERO,
                history_quality: PropRiskHistoryQuality::TrackedSinceGuardEnabled,
                trading_days: None,
                has_open_positions: false,
                balance: Decimal::new(4_569_807, 2),
                equity: last_equity,
                previously_locked_reason: None,
                telemetry_stale: false,
                unprotected_exposure: false,
            },
        );

        assert!(!matches_legacy_prop_risk_daily_floor(
            &profile.rules,
            initial_balance,
            last_equity,
            &evaluation,
        ));

        evaluation.daily_loss_remaining = Decimal::new(-155_353, 2);
        assert!(matches_legacy_prop_risk_daily_floor(
            &profile.rules,
            initial_balance,
            last_equity,
            &evaluation,
        ));
    }

    #[test]
    fn legacy_lock_audit_match_uses_exact_reason_boundaries() {
        let profile = test_prop_risk_profile();
        let initial_balance = Decimal::new(50_000, 0);
        let legacy_floor = Decimal::new(47_500, 0);
        let legacy_emergency_ceiling = Decimal::new(47_750, 0);

        assert!(matches_legacy_prop_risk_lock_event(
            &profile.rules,
            initial_balance,
            PropRiskReason::DailyLossLimitBreached,
            legacy_floor,
        ));
        assert!(!matches_legacy_prop_risk_lock_event(
            &profile.rules,
            initial_balance,
            PropRiskReason::DailyLossSafetyBuffer,
            legacy_floor,
        ));
        assert!(matches_legacy_prop_risk_lock_event(
            &profile.rules,
            initial_balance,
            PropRiskReason::DailyLossSafetyBuffer,
            legacy_emergency_ceiling,
        ));
        assert!(!matches_legacy_prop_risk_lock_event(
            &profile.rules,
            initial_balance,
            PropRiskReason::DailyLossSafetyBuffer,
            legacy_emergency_ceiling + Decimal::new(1, 2),
        ));
        assert!(!matches_legacy_prop_risk_lock_event(
            &profile.rules,
            initial_balance,
            PropRiskReason::MaxLossLimitBreached,
            legacy_floor,
        ));
    }

    fn snapshot(login: &str, server: &str) -> EaAccountSnapshot {
        EaAccountSnapshot {
            login: login.into(),
            broker: "Example Broker".into(),
            server: server.into(),
            mode: AccountMode::Live,
            currency: "USD".into(),
            balance: Decimal::new(10_000, 0),
            equity: Decimal::new(10_000, 0),
            margin: Decimal::ZERO,
            free_margin: Decimal::new(10_000, 0),
            leverage: 100,
            trade_allowed: true,
            terminal_build: 5000,
            ea_version: Some("1.25".into()),
        }
    }

    fn session_request(token: &str, account: EaAccountSnapshot) -> EaSessionRequest {
        EaSessionRequest {
            protocol_version: EXECUTION_PROTOCOL_VERSION,
            pairing_token: token.into(),
            agent_id: "test-agent".into(),
            runtime_binding: None,
            account,
        }
    }

    fn bearer(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            "authorization",
            format!("Bearer {token}").parse().expect("valid header"),
        );
        headers
    }

    fn admin_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-execution-admin-token",
            ADMIN_TOKEN.parse().expect("valid admin token header"),
        );
        headers
    }

    fn place_command(account_id: AccountId, command_id: &str) -> EaCommand {
        EaCommand::Place {
            order: RoutedOrder {
                parent_command_id: CommandId::new("parent"),
                command_id: CommandId::new(command_id),
                idempotency_key: IdempotencyKey::new(format!("idem-{command_id}")),
                target_account_id: account_id,
                broker_code: "example".into(),
                venue_kind: VenueKind::MetaTrader5,
                canonical_symbol: "EURUSD".into(),
                venue_symbol: "EURUSD".into(),
                side: Side::Buy,
                kind: OrderKind::Market,
                quantity: Decimal::ONE,
                quantity_unit: QuantityUnit::Lots,
                limit_price: None,
                stop_price: None,
                stop_loss: Some(Decimal::new(109, 2)),
                take_profit: Some(Decimal::new(112, 2)),
                broker_margin_cap: None,
                warnings: Vec::new(),
            },
        }
    }

    fn close_command(account_id: AccountId, command_id: &str) -> EaCommand {
        EaCommand::ClosePosition {
            command: execution_domain::ClosePositionCommand {
                command_id: CommandId::new(command_id),
                idempotency_key: IdempotencyKey::new(format!("idem-{command_id}")),
                target_account_id: account_id,
                broker_position_id: "123456789".into(),
                quantity: None,
                deviation_points: 20,
            },
        }
    }

    fn admin_order(targets: Vec<AdminOrderTarget>) -> AdminOrderRequest {
        AdminOrderRequest {
            owner_id: OWNER_A.into(),
            intent: OrderIntent {
                command_id: CommandId::new("parent"),
                idempotency_key: IdempotencyKey::new("intent-parent"),
                source_account_id: None,
                canonical_symbol: "EURUSD".into(),
                side: Side::Buy,
                kind: OrderKind::Market,
                sizing: OrderSizing::Fixed {
                    quantity: Decimal::ONE,
                    unit: QuantityUnit::Lots,
                },
                limit_price: None,
                stop_price: None,
                stop_loss: Some(Decimal::new(109, 2)),
                take_profit: Some(Decimal::new(112, 2)),
                metadata: BTreeMap::new(),
            },
            targets,
            authorization_token: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".into(),
            authorization_session_id: Uuid::new_v4().to_string(),
        }
    }

    fn admin_target(account_id: &str) -> AdminOrderTarget {
        AdminOrderTarget {
            account_id: AccountId::new(account_id),
            allocation: CopyAllocation::SameQuantity,
            max_quantity: None,
        }
    }

    #[tokio::test]
    async fn route_rejection_audit_has_a_safe_in_memory_test_path() {
        let state = GatewayState::new(ADMIN_TOKEN, None);
        let request = admin_order(vec![admin_target("account-a")]);

        state
            .audit_order_route_outcome(
                Uuid::parse_str(OWNER_A).expect("owner uuid"),
                &request.intent,
                &request.targets[0].account_id,
                "order.route_rejected",
                "RISK_LIMIT_EXCEEDED",
                "risk exceeds the target policy",
            )
            .await
            .expect("test state without PostgreSQL may safely no-op");
    }

    #[test]
    fn account_layout_validation_rejects_duplicates_and_multiple_simulators() {
        assert!(
            validate_account_layout_items(&["mt5_account".into(), "mt5_account".into(),]).is_err()
        );
        assert!(
            validate_account_layout_items(&["simulator:first".into(), "simulator:second".into(),])
                .is_err()
        );
        assert!(
            validate_account_layout_items(&["mt5_account".into(), "simulator:local".into(),])
                .is_ok()
        );
    }

    #[tokio::test]
    async fn account_layout_is_owner_scoped_and_revision_checked_in_memory() {
        let state = GatewayState::new(ADMIN_TOKEN, None);
        let saved = update_account_layout(
            State(state.clone()),
            admin_headers(),
            Json(AccountLayoutRequest {
                owner_id: OWNER_A.into(),
                item_ids: vec!["simulator:local".into()],
                expected_revision: 0,
            }),
        )
        .await
        .expect("initial layout saves")
        .0;
        assert_eq!(saved.revision, 1);
        assert_eq!(saved.item_ids, vec!["simulator:local"]);

        let other = account_layout(
            State(state.clone()),
            admin_headers(),
            Query(OwnerQuery {
                owner_id: OWNER_B.into(),
            }),
        )
        .await
        .expect("other owner layout loads")
        .0;
        assert_eq!(other.revision, 0);
        assert!(other.item_ids.is_empty());

        let stale = update_account_layout(
            State(state),
            admin_headers(),
            Json(AccountLayoutRequest {
                owner_id: OWNER_A.into(),
                item_ids: vec!["simulator:local".into()],
                expected_revision: 0,
            }),
        )
        .await
        .expect_err("stale revision must fail");
        assert_eq!(stale.status, StatusCode::CONFLICT);
        assert_eq!(stale.body.code, "ACCOUNT_LAYOUT_REVISION_CONFLICT");
    }

    #[test]
    fn deployment_fails_closed_for_unwired_native_venue_transports() {
        assert!(execution_transport_enabled(VenueKind::MetaTrader5));
        assert!(!execution_transport_enabled(VenueKind::BinanceSpot));
        assert!(!execution_transport_enabled(VenueKind::BinanceUsdM));
    }

    #[test]
    fn deferred_submission_uses_camel_case_fields_and_an_absolute_deadline() {
        let value = serde_json::to_value(AdminTargetSubmission::Waiting {
            account_id: AccountId::new("mt5_exness"),
            command_id: CommandId::new("parent:mt5_exness"),
            expires_at_ms: 300_000,
        })
        .expect("serialize waiting target");

        assert_eq!(value["status"], "waiting");
        assert_eq!(value["accountId"], "mt5_exness");
        assert_eq!(value["commandId"], "parent:mt5_exness");
        assert_eq!(value["expiresAtMs"], 300_000);
        assert!(value.get("account_id").is_none());
        assert!(value.get("expires_at_ms").is_none());
    }

    #[test]
    fn explicit_managed_disconnect_blocks_new_defer_activation_and_unknown_replay() {
        let source = include_str!("main.rs");
        let defer_start = source
            .find("async fn defer_order(")
            .expect("defer route exists");
        let defer_end = source[defer_start..]
            .find("async fn activate_deferred_orders(")
            .map(|offset| defer_start + offset)
            .expect("defer route has a boundary");
        let defer = &source[defer_start..defer_end];
        assert!(defer.contains("disconnect_requested_revision IS NULL"));
        assert!(defer.contains("FOR UPDATE OF account"));

        let activate_end = source[defer_end..]
            .find("async fn deferred_instrument_refreshed(")
            .map(|offset| defer_end + offset)
            .expect("deferred activation has a boundary");
        let activate = &source[defer_end..activate_end];
        assert!(activate.contains("disconnect_requested_revision IS NULL"));

        let poll_start = source
            .find("async fn poll_commands(")
            .expect("EA poll implementation exists");
        let poll_end = source[poll_start..]
            .find("async fn accept_events(")
            .map(|offset| poll_start + offset)
            .expect("EA poll implementation has a boundary");
        let poll = &source[poll_start..poll_end];
        let delivery_candidates = poll
            .rfind("WITH candidates AS (")
            .map(|offset| &poll[offset..])
            .expect("EA poll delivery candidate query exists");
        assert!(
            delivery_candidates.contains("reject_code IS DISTINCT FROM 'DELIVERY_OUTCOME_UNKNOWN'")
        );
    }

    #[test]
    fn account_liveness_uses_the_freshest_authenticated_ea_activity() {
        assert_eq!(effective_last_seen_at_ms(1_000, Some(2_000)), 2_000);
        assert_eq!(effective_last_seen_at_ms(3_000, Some(2_000)), 3_000);
        assert_eq!(effective_last_seen_at_ms(4_000, None), 4_000);
    }

    #[test]
    fn ea_version_gate_accepts_current_and_future_releases_only() {
        assert_eq!(minimum_supported_ea_version(), "1.26");
        assert!(!ea_version_supported(None));
        assert!(!ea_version_supported(Some("1.25.9")));
        assert!(!ea_version_supported(Some("invalid")));
        assert!(ea_version_supported(Some("1.26")));
        assert!(ea_version_supported(Some("1.26.1")));
        assert!(ea_version_supported(Some("2.0.0")));
    }

    #[test]
    fn managed_identity_key_survives_admin_token_rotation() {
        let before = GatewayState::new("admin-token-before-rotation-at-least-32-bytes", None);
        let after = GatewayState::new("admin-token-after-rotation-at-least-32-bytes", None);

        assert_eq!(
            before.inner.mt5_identity_key, after.inner.mt5_identity_key,
            "rotating the admin credential must not change durable MT5 identity fingerprints"
        );
    }

    #[test]
    fn managed_identity_fingerprint_matches_go_vector() {
        let key = derive_mt5_identity_key("stable-identity-master-key-32bytes!");
        assert_eq!(
            key,
            [
                0x91, 0x2b, 0xe3, 0xd8, 0xb8, 0x10, 0x05, 0x1f, 0xc8, 0x05, 0xe4, 0x33, 0xbd, 0x38,
                0x71, 0xe4, 0x82, 0xba, 0xc7, 0xae, 0xb3, 0x54, 0xa3, 0x00, 0xd3, 0x46, 0xc1, 0x23,
                0x64, 0xfd, 0x92, 0xb0,
            ]
        );
        assert_eq!(
            mt5_identity_fingerprint(&key, " 123456 ", " Broker-Live "),
            [
                0x20, 0x8c, 0x9a, 0xa2, 0xb1, 0x12, 0x47, 0xc4, 0x45, 0x02, 0x4f, 0xfd, 0x79, 0x62,
                0x4b, 0xbc, 0x89, 0xbd, 0x89, 0xb9, 0x07, 0x55, 0x2f, 0xdf, 0x3b, 0xa2, 0x99, 0x4a,
                0x30, 0x39, 0xc6, 0x9d,
            ]
        );
    }

    fn copier_test_position(
        side: Side,
        quantity: Decimal,
        open_price: Decimal,
        current_price: Decimal,
        stop_loss: Option<Decimal>,
    ) -> EaPositionSnapshot {
        EaPositionSnapshot {
            broker_position_id: "100001".into(),
            canonical_symbol: "EURUSD".into(),
            venue_symbol: "EURUSD".into(),
            side,
            quantity,
            open_price,
            current_price,
            stop_loss,
            take_profit: None,
            profit: Decimal::ZERO,
            swap: Decimal::ZERO,
            commission: Decimal::ZERO,
            magic: 42,
            comment: "copier-test".into(),
            opened_at_ms: 1_000,
            observed_at_ms: 2_000,
        }
    }

    #[test]
    fn copier_drawdown_and_target_protection_are_directional_and_independent() {
        assert!(copier_drawdown_breached(
            Some(Decimal::new(10_000, 0)),
            Some(Decimal::new(9_600, 0)),
            400,
        ));
        assert!(!copier_drawdown_breached(
            Some(Decimal::new(10_000, 0)),
            Some(Decimal::new(9_601, 0)),
            400,
        ));

        let protection = CopyProtectionConfig {
            trailing_stop_points: 50,
            trailing_step_points: 5,
            trailing_start_points: 50,
            breakeven_trigger_points: 50,
            breakeven_offset_points: 5,
            ..Default::default()
        };
        let tick = Decimal::new(1, 4);
        let buy = copier_test_position(
            Side::Buy,
            Decimal::ONE,
            Decimal::new(11_000, 4),
            Decimal::new(11_100, 4),
            None,
        );
        let sell = copier_test_position(
            Side::Sell,
            Decimal::ONE,
            Decimal::new(11_000, 4),
            Decimal::new(10_900, 4),
            None,
        );
        assert_eq!(
            copier_target_protection_stop(&buy, tick, &protection),
            Some(Decimal::new(11_050, 4))
        );
        assert_eq!(
            copier_target_protection_stop(&sell, tick, &protection),
            Some(Decimal::new(10_950, 4))
        );

        let breakeven_only = CopyProtectionConfig {
            trailing_stop_points: 0,
            breakeven_trigger_points: 50,
            breakeven_offset_points: 5,
            ..Default::default()
        };
        assert_eq!(
            copier_target_protection_stop(&buy, tick, &breakeven_only),
            Some(Decimal::new(11_005, 4))
        );
    }

    #[test]
    fn copier_partial_close_scales_to_the_durable_target_leg() {
        let previous = copier_test_position(
            Side::Buy,
            Decimal::new(10, 0),
            Decimal::ONE,
            Decimal::ONE,
            None,
        );
        let current = copier_test_position(
            Side::Buy,
            Decimal::new(6, 0),
            Decimal::ONE,
            Decimal::ONE,
            None,
        );
        let change = PortfolioChange::PositionReduced {
            previous,
            current,
            delta: Decimal::new(4, 0),
        };
        assert_eq!(
            copier_partial_close_quantity(&change, Some(Decimal::new(5, 0))),
            Some(Decimal::new(2, 0))
        );
    }

    #[test]
    fn copier_pending_entry_uses_the_final_order_kind_price_field() {
        let pending = EaPendingOrderSnapshot {
            broker_order_id: "200001".into(),
            canonical_symbol: "EURUSD".into(),
            venue_symbol: "EURUSD".into(),
            side: Side::Buy,
            kind: OrderKind::Stop,
            quantity: Decimal::ONE,
            price: Decimal::new(11_100, 4),
            stop_loss: Some(Decimal::new(10_900, 4)),
            take_profit: Some(Decimal::new(11_300, 4)),
            magic: 42,
            comment: "copier-test".into(),
            created_at_ms: 1_000,
            observed_at_ms: 2_000,
        };
        let change = PortfolioChange::PendingCreated { current: pending };
        let mut target = ContinuousCopyTargetConfig {
            allocation: CopyAllocation::SameQuantity,
            max_quantity: None,
            reverse_trade: false,
            symbol_mapping: BTreeMap::new(),
            protection: CopyProtectionConfig::default(),
        };
        let command_id = CommandId::new("copier-test");
        let idempotency_key = IdempotencyKey::new("copier-test");

        let intent = copier_order_intent(
            &change,
            &target,
            &command_id,
            &idempotency_key,
            "place_pending",
            None,
            true,
        )
        .expect("stop pending intent");
        assert_eq!(intent.kind, OrderKind::Stop);
        assert_eq!(intent.limit_price, None);
        assert_eq!(intent.stop_price, Some(Decimal::new(11_100, 4)));

        target.reverse_trade = true;
        let reversed = copier_order_intent(
            &change,
            &target,
            &command_id,
            &idempotency_key,
            "place_pending",
            None,
            true,
        )
        .expect("reversed pending intent");
        assert_eq!(reversed.side, Side::Sell);
        assert_eq!(reversed.kind, OrderKind::Limit);
        assert_eq!(reversed.limit_price, Some(Decimal::new(11_100, 4)));
        assert_eq!(reversed.stop_price, None);
        assert_eq!(reversed.stop_loss, Some(Decimal::new(11_300, 4)));
        assert_eq!(reversed.take_profit, Some(Decimal::new(10_900, 4)));
        assert_eq!(
            copier_pending_modification(&change, true).expect("reverse pending modification"),
            (
                Decimal::new(11_100, 4),
                Some(Decimal::new(11_300, 4)),
                Some(Decimal::new(10_900, 4)),
            )
        );

        target.allocation = CopyAllocation::Multiplier {
            multiplier: Decimal::new(3, 0),
        };
        let raw_sizing = copier_order_intent(
            &change,
            &target,
            &command_id,
            &idempotency_key,
            "place_pending",
            None,
            true,
        )
        .expect("multiplier pending intent")
        .sizing;
        assert_eq!(
            raw_sizing,
            OrderSizing::Fixed {
                quantity: Decimal::ONE,
                unit: QuantityUnit::Lots,
            }
        );

        let without_source_protection = copier_order_intent(
            &change,
            &target,
            &command_id,
            &idempotency_key,
            "place_pending",
            None,
            false,
        )
        .expect("pending intent without copied source protection");
        assert_eq!(without_source_protection.stop_loss, None);
        assert_eq!(without_source_protection.take_profit, None);
    }

    #[test]
    fn active_copier_links_block_destructive_group_transitions() {
        let active_targets = vec!["target-a".to_owned()];
        let keep_target = HashSet::from(["target-a"]);
        let remove_target = HashSet::new();

        assert_eq!(
            copy_group_transition_drain_reason(
                "source-a",
                true,
                "source-b",
                true,
                &keep_target,
                &active_targets,
            ),
            Some("the source account cannot change while copier links remain open")
        );
        assert!(
            copy_group_transition_drain_reason(
                "source-a",
                true,
                "source-a",
                false,
                &keep_target,
                &active_targets,
            )
            .is_some()
        );
        assert!(
            copy_group_transition_drain_reason(
                "source-a",
                true,
                "source-a",
                true,
                &remove_target,
                &active_targets,
            )
            .is_some()
        );
        assert_eq!(
            copy_group_transition_drain_reason(
                "source-a",
                true,
                "source-a",
                true,
                &keep_target,
                &active_targets,
            ),
            None
        );
    }

    #[test]
    fn copier_staleness_only_supersedes_expired_risk_increases() {
        assert!(copier_work_is_stale("open_market", 1_000, 2_001, 1_000));
        assert!(copier_work_is_stale("place_pending", 1_000, 2_001, 1_000));
        assert!(!copier_work_is_stale("open_market", 1_000, 2_000, 1_000));
        assert!(!copier_work_is_stale(
            "close_position",
            1_000,
            10_000,
            1_000,
        ));
        assert!(!copier_work_is_stale(
            "cancel_pending",
            1_000,
            10_000,
            1_000,
        ));
        assert!(!copier_operation_allowed_while_paused("open_market", None));
        assert!(!copier_operation_allowed_while_paused(
            "modify_position",
            None,
        ));
        assert!(copier_operation_allowed_while_paused(
            "modify_position",
            Some("target_protection"),
        ));
        assert!(copier_operation_allowed_while_paused(
            "close_position",
            None,
        ));
    }

    #[test]
    fn source_filters_never_suppress_terminal_lifecycle_for_existing_links() {
        let position = copier_test_position(
            Side::Buy,
            Decimal::ONE,
            Decimal::new(11_000, 4),
            Decimal::new(11_100, 4),
            Some(Decimal::new(10_900, 4)),
        );
        let pending = EaPendingOrderSnapshot {
            broker_order_id: "200002".into(),
            canonical_symbol: "EURUSD".into(),
            venue_symbol: "EURUSD".into(),
            side: Side::Buy,
            kind: OrderKind::Limit,
            quantity: Decimal::ONE,
            price: Decimal::new(10_900, 4),
            stop_loss: Some(Decimal::new(10_800, 4)),
            take_profit: Some(Decimal::new(11_100, 4)),
            magic: 42,
            comment: "copier-test".into(),
            created_at_ms: 1_000,
            observed_at_ms: 2_000,
        };
        let mut config = ContinuousCopyConfig {
            source_magic_filter: Some(7),
            source_comment_prefix: Some("other".into()),
            ..Default::default()
        };

        assert!(!copy_change_allowed(
            &PortfolioChange::PositionOpened {
                current: position.clone(),
            },
            &config,
        ));
        assert!(copy_change_allowed(
            &PortfolioChange::PositionClosed {
                previous: position.clone(),
            },
            &config,
        ));
        assert!(copy_change_allowed(
            &PortfolioChange::PendingCancelled {
                previous: pending.clone(),
            },
            &config,
        ));

        config.copy_pending_orders = false;
        config.copy_market_orders = false;
        let filled = PortfolioChange::PendingFilled {
            previous: pending,
            position,
        };
        assert!(copy_change_allowed(&filled, &config));
        assert!(!copy_source_filters_match(&filled, &config));
        assert_eq!(copy_work_operations(&filled, &config), vec!["reconcile"]);
        assert_eq!(
            copier_link_source_identity(&filled, "reconcile"),
            ("pending_order", "200002")
        );

        config.copy_market_orders = true;
        assert_eq!(copy_work_operations(&filled, &config), vec!["open_market"]);
        assert_eq!(
            copy_work_operations_for_runtime(&filled, &config, "paused"),
            vec!["reconcile"]
        );
        assert_eq!(
            copier_link_source_identity(&filled, "open_market"),
            ("position", "100001")
        );
    }

    #[test]
    fn reverse_copier_swaps_source_protection_but_not_target_local_protection() {
        let previous = copier_test_position(
            Side::Buy,
            Decimal::ONE,
            Decimal::new(11_000, 4),
            Decimal::new(11_100, 4),
            Some(Decimal::new(10_900, 4)),
        );
        let mut current = previous.clone();
        current.stop_loss = Some(Decimal::new(10_950, 4));
        current.take_profit = Some(Decimal::new(11_300, 4));
        let change = PortfolioChange::PositionProtectionChanged { previous, current };

        assert_eq!(
            copier_position_protection(&change, true).expect("reverse source protection"),
            (Some(Decimal::new(11_300, 4)), Some(Decimal::new(10_950, 4)),)
        );
        assert_eq!(
            copier_position_protection(&change, false).expect("target-local protection"),
            (Some(Decimal::new(10_950, 4)), Some(Decimal::new(11_300, 4)),)
        );
    }

    #[test]
    fn pending_fill_reconciliation_prefers_the_linked_target_side() {
        assert_eq!(
            copier_expected_target_side(&serde_json::json!({ "side": "sell" }), Side::Buy),
            "sell"
        );
        assert_eq!(
            copier_expected_target_side(&serde_json::json!({ "side": "invalid" }), Side::Buy),
            "buy"
        );
    }

    #[test]
    fn ea_poll_wire_flattens_routed_commands_for_mql_consumers() {
        let command = place_command(AccountId::new("mt5_account"), "child-command");
        let json =
            serde_json::to_value(EaPollCommandView::from(command)).expect("serialize poll command");

        assert_eq!(json["type"], "place");
        assert_eq!(json["commandId"], "child-command");
        assert_eq!(json["targetAccountId"], "mt5_account");
        assert_eq!(json["venueSymbol"], "EURUSD");
        assert!(json.get("order").is_none());
    }

    #[test]
    fn durable_place_payload_decodes_before_ea_poll_delivery() {
        let payload = r#"{
          "type":"place",
          "order":{
            "kind":"limit",
            "side":"buy",
            "quantity":"0.26",
            "stopLoss":"64293.70",
            "warnings":[],
            "commandId":"exec_cmd_child:mt5_account",
            "stopPrice":null,
            "venueKind":"metaTrader5",
            "brokerCode":"ftmo-global-markets-ltd",
            "limitPrice":"64466.48",
            "takeProfit":"64819.91",
            "venueSymbol":"BTCUSD",
            "quantityUnit":"lots",
            "idempotencyKey":"exec_cmd_child:mt5_account",
            "canonicalSymbol":"BTCUSD",
            "parentCommandId":"exec_cmd_child",
            "targetAccountId":"mt5_account"
          }
        }"#;
        let command = serde_json::from_str::<EaCommand>(payload)
            .expect("durable routed order must decode for polling");
        let wire = serde_json::to_value(EaPollCommandView::from(command))
            .expect("decoded durable order must flatten for MQL");
        assert_eq!(wire["type"], "place");
        assert_eq!(wire["quantity"], "0.26");
        assert_eq!(wire["limitPrice"], "64466.48");
    }

    #[test]
    fn delivery_outcome_migration_reopens_late_ack_reconciliation() {
        let migration =
            include_str!("../../../../migrations/0029_execution_delivery_outcome_unknown.up.sql");

        assert!(migration.contains("status = 'unknown'"));
        assert!(migration.contains("reject_code = 'DELIVERY_OUTCOME_UNKNOWN'"));
        assert!(migration.contains("terminal_ack_at = NULL"));
        assert!(migration.contains("reject_code = 'DELIVERY_EXPIRED'"));
        assert!(
            !migration.contains("SET status = 'failed'"),
            "delivered commands must not be represented as broker failures"
        );
    }

    #[test]
    fn durable_unknown_outcome_is_excluded_from_command_expiry() {
        let source = include_str!("main.rs");
        assert!(source.contains("reject_code IS DISTINCT FROM 'DELIVERY_OUTCOME_UNKNOWN'"));
    }

    #[test]
    fn managed_ea_heartbeat_cannot_publish_ready_before_the_atomic_gate() {
        let source = include_str!("main.rs");
        let touch_start = source
            .find("    async fn touch_account(")
            .expect("touch_account exists");
        let gate_start = source[touch_start..]
            .find("    async fn advance_managed_ea_readiness_after_event(")
            .map(|offset| touch_start + offset)
            .expect("managed readiness gate exists");
        let touch = &source[touch_start..gate_start];
        let gate_end = source[gate_start..]
            .find("    async fn prop_risk_guard_view(")
            .map(|offset| gate_start + offset)
            .expect("managed readiness gate boundary exists");
        let gate = &source[gate_start..gate_end];

        assert!(
            touch.contains("WHEN connector_kind = 'windows_vm' THEN status"),
            "managed EA heartbeat must preserve registry readiness until the full gate passes"
        );
        assert!(
            gate.contains("execution_advance_mt5_managed_readiness"),
            "managed readiness must use the atomic database gate"
        );
    }

    #[test]
    fn trade_authorization_migration_enforces_exact_one_time_payloads() {
        let original_migration =
            include_str!("../../../../migrations/0031_trade_passkey_authorization.up.sql");
        let password_migration =
            include_str!("../../../../migrations/0032_optional_trade_password.up.sql");
        assert!(original_migration.contains("payload               jsonb NOT NULL"));
        assert!(original_migration.contains("token_hash            bytea NOT NULL UNIQUE"));
        assert!(original_migration.contains("consumed_at"));
        assert!(original_migration.contains("REFERENCES sessions(id) ON DELETE CASCADE"));
        assert!(password_migration.contains("CREATE TABLE trade_security_settings"));
        assert!(password_migration.contains("CREATE TABLE trade_unlock_sessions"));
        assert!(password_migration.contains("DROP COLUMN credential_id"));
        assert!(password_migration.contains("DROP TABLE webauthn_credentials"));
        assert!(password_migration.contains("verification_method"));
    }

    #[test]
    fn authorization_payload_serialization_omits_optional_nulls() {
        let normalized = strip_json_nulls(serde_json::json!({
            "command": {
                "type": "closePosition",
                "optional": null,
                "nested": [{"keep": "value", "drop": null}]
            }
        }));
        assert_eq!(
            normalized,
            serde_json::json!({
                "command": {
                    "type": "closePosition",
                    "nested": [{"keep": "value"}]
                }
            })
        );
    }

    fn instrument_snapshot() -> EaInstrumentSnapshot {
        EaInstrumentSnapshot {
            spec: InstrumentSpec {
                canonical_symbol: "EURUSD".into(),
                venue_symbol: "EURUSD".into(),
                quantity_unit: QuantityUnit::Lots,
                quantity_step: Decimal::new(1, 2),
                min_quantity: Decimal::new(1, 2),
                max_quantity: Decimal::new(100, 0),
                price_tick: Decimal::new(1, 5),
                tick_value_per_quantity: Some(Decimal::ONE),
                min_stop_distance: Some(Decimal::new(10, 5)),
                trade_allowed: true,
            },
            bid: Some(Decimal::new(110_000, 5)),
            ask: Some(Decimal::new(110_020, 5)),
            observed_at_ms: now_ms(),
        }
    }

    #[test]
    fn prop_risk_lifecycle_edits_may_only_keep_or_reduce_committed_risk() {
        let profile = test_prop_risk_profile();
        let instrument = instrument_snapshot().spec;
        let current_price = Decimal::new(110_000, 5);
        let current_stop = Some(Decimal::new(109_000, 5));

        validate_prop_risk_modification(
            &profile.rules,
            &profile.actions,
            current_price,
            current_stop,
            current_price,
            Some(Decimal::new(109_500, 5)),
            Decimal::ONE,
            Some(&instrument),
        )
        .expect("a tighter stop must remain allowed");

        let wider = validate_prop_risk_modification(
            &profile.rules,
            &profile.actions,
            current_price,
            current_stop,
            current_price,
            Some(Decimal::new(108_000, 5)),
            Decimal::ONE,
            Some(&instrument),
        )
        .expect_err("a wider stop must not increase committed risk");
        assert_eq!(wider.body.code, "PROP_RISK_MODIFICATION_INCREASES_RISK");

        let removed = validate_prop_risk_modification(
            &profile.rules,
            &profile.actions,
            current_price,
            current_stop,
            current_price,
            Some(Decimal::ZERO),
            Decimal::ONE,
            Some(&instrument),
        )
        .expect_err("an enforced stop must not be removed");
        assert_eq!(removed.body.code, "PROP_RISK_STOP_LOSS_REQUIRED");
    }

    #[test]
    fn ea_event_batch_rejects_invalid_tickets_and_deduplicates_exact_outcomes() {
        let invalid = EaEventBatch {
            protocol_version: EXECUTION_PROTOCOL_VERSION,
            account: snapshot("123456", "Example-Live"),
            instruments: Vec::new(),
            positions: Vec::new(),
            pending_orders: Vec::new(),
            portfolio_snapshot_complete: true,
            events: vec![EaEvent::CommandAccepted {
                command_id: CommandId::new("command-1"),
                broker_order_id: Some("not-a-ticket".into()),
                broker_deal_id: None,
                retcode: 10009,
                message: "accepted".into(),
                occurred_at_ms: now_ms(),
            }],
        };
        let error = validate_event_batch(&invalid).expect_err("invalid ticket must fail");
        assert_eq!(error.status, StatusCode::BAD_REQUEST);

        let outcome = EaEvent::CommandRejected {
            command_id: CommandId::new("command-2"),
            retcode: 10013,
            message: "invalid request".into(),
            occurred_at_ms: now_ms(),
        };
        let duplicate = EaEventBatch {
            events: vec![outcome.clone(), outcome.clone()],
            ..invalid
        };
        validate_event_batch(&duplicate).expect("exact duplicate is idempotent");
        let events = normalize_events(duplicate.events).expect("deduplicate exact outcome");
        assert_eq!(events.len(), 1);
        assert_eq!(event_identity(&events[0]), event_identity(&outcome));

        let conflict = vec![
            outcome.clone(),
            EaEvent::CommandRejected {
                command_id: CommandId::new("command-2"),
                retcode: 10013,
                message: "different result".into(),
                occurred_at_ms: now_ms() + 1,
            },
        ];
        let error = normalize_events(conflict).expect_err("conflicting outcome must fail");
        assert_eq!(error.body.code, "EA_EVENT_CONFLICT");
    }

    #[test]
    fn position_protection_is_validated_against_side_and_broker_distance() {
        let position = EaPositionSnapshot {
            broker_position_id: "100001".into(),
            canonical_symbol: "EURUSD".into(),
            venue_symbol: "EURUSD".into(),
            side: Side::Buy,
            quantity: Decimal::ONE,
            open_price: Decimal::new(110_000, 5),
            current_price: Decimal::new(110_000, 5),
            stop_loss: None,
            take_profit: None,
            profit: Decimal::ZERO,
            swap: Decimal::ZERO,
            commission: Decimal::ZERO,
            magic: 1,
            comment: String::new(),
            opened_at_ms: now_ms(),
            observed_at_ms: now_ms(),
        };
        let wrong_side = validate_position_modification(
            &position,
            Some(Decimal::new(10, 5)),
            Some(Decimal::new(111_000, 5)),
            None,
        )
        .expect_err("buy stop above market must fail");
        assert_eq!(wrong_side.body.code, "PROTECTION_PRICE_WRONG_SIDE");

        let too_close = validate_position_modification(
            &position,
            Some(Decimal::new(20, 5)),
            Some(Decimal::new(109_990, 5)),
            None,
        )
        .expect_err("stop inside broker distance must fail");
        assert_eq!(too_close.body.code, "PROTECTION_DISTANCE_TOO_SMALL");

        validate_position_modification(
            &position,
            Some(Decimal::new(10, 5)),
            Some(Decimal::new(109_000, 5)),
            Some(Decimal::new(111_000, 5)),
        )
        .expect("valid buy protection");

        validate_position_modification(
            &position,
            Some(Decimal::new(10, 5)),
            Some(Decimal::ZERO),
            Some(Decimal::ZERO),
        )
        .expect("zero clears position protection");
    }

    #[test]
    fn pending_order_modification_validates_entry_protection_and_clear_values() {
        let order = EaPendingOrderSnapshot {
            broker_order_id: "200001".into(),
            canonical_symbol: "EURUSD".into(),
            venue_symbol: "EURUSD".into(),
            side: Side::Buy,
            kind: execution_domain::OrderKind::Limit,
            quantity: Decimal::ONE,
            price: Decimal::new(110_000, 5),
            stop_loss: None,
            take_profit: None,
            magic: 1,
            comment: String::new(),
            created_at_ms: now_ms(),
            observed_at_ms: now_ms(),
        };
        let wrong_side = validate_pending_order_modification(
            &order,
            Some(Decimal::new(10, 5)),
            Decimal::new(110_000, 5),
            Some(Decimal::new(111_000, 5)),
            None,
        )
        .expect_err("buy stop above pending entry must fail");
        assert_eq!(wrong_side.body.code, "PROTECTION_PRICE_WRONG_SIDE");

        validate_pending_order_modification(
            &order,
            Some(Decimal::new(10, 5)),
            Decimal::new(110_500, 5),
            Some(Decimal::ZERO),
            Some(Decimal::new(112_000, 5)),
        )
        .expect("pending entry and protection can be modified in place");
    }

    async fn paired(
        state: &GatewayState,
        owner_id: &str,
        token: &str,
    ) -> (EaAccountSnapshot, EaSessionResponse) {
        let account = snapshot("123456", "Broker-Live");
        state
            .insert_pairing_token(token, owner_id, DEFAULT_PAIRING_TTL)
            .await
            .expect("insert pairing token");
        let session = state
            .create_session(session_request(token, account.clone()))
            .await
            .expect("pair session");
        (account, session)
    }

    async fn managed_database_state() -> GatewayState {
        let database_url = std::env::var("MT5_MANAGED_TEST_DATABASE_URL")
            .expect("the disposable PostgreSQL harness supplies a loopback database URL");
        let database = PgPoolOptions::new()
            .max_connections(4)
            .connect(&database_url)
            .await
            .expect("connect to the disposable managed MT5 database");
        GatewayState::new_production(
            ADMIN_TOKEN,
            "stable-managed-database-identity-key-at-least-32-bytes",
            Some("managed-database-worker-bootstrap-token-at-least-32-bytes"),
            database,
        )
    }

    #[tokio::test]
    #[ignore = "run only inside the disposable PostgreSQL 17 harness"]
    async fn managed_database_pairing_session_and_reconnect_state_are_durable() {
        let state = managed_database_state().await;
        let owner_uuid = Uuid::new_v4();
        let owner_id = owner_uuid.to_string();
        let pairing_token = random_token();
        let account = snapshot("81234567", "Synthetic-Broker-Demo");

        sqlx::query(
            "INSERT INTO users (id, email, email_verified, display_name, status) \
             VALUES ($1, $2, true, 'Managed database owner', 'active')",
        )
        .bind(owner_uuid)
        .bind(format!("managed-database-{owner_uuid}@example.invalid"))
        .execute(
            state
                .inner
                .database
                .as_ref()
                .expect("production state has a database"),
        )
        .await
        .expect("seed an active disposable owner");

        state
            .insert_pairing_token(&pairing_token, &owner_id, DEFAULT_PAIRING_TTL)
            .await
            .expect("persist a one-time pairing token");
        let session = state
            .create_session(session_request(&pairing_token, account.clone()))
            .await
            .expect("persist the EA account and session");
        let authenticated = state
            .authenticate(&bearer(&session.session_token))
            .await
            .expect("authenticate the database-backed EA session");
        assert_eq!(authenticated.owner_id, owner_id);
        assert_eq!(authenticated.account_id, session.account_id);

        state
            .touch_account(&owner_id, &session.account_id, account)
            .await
            .expect("refresh database-backed EA liveness");
        state
            .manage_account(&owner_id, &session.account_id, false)
            .await
            .expect("disconnect the database-backed EA session");
        assert!(
            state
                .authenticate(&bearer(&session.session_token))
                .await
                .is_err()
        );
    }

    #[test]
    fn live_mt5_account_is_valid_for_execution() {
        let request = session_request(PAIR_TOKEN, snapshot("123456", "Broker-Live"));
        assert_eq!(request.account.mode, AccountMode::Live);
        validate_session_request(&request).expect("Live accounts must be supported");
    }

    #[tokio::test]
    async fn session_response_exposes_gateway_utc_clock() {
        let state = GatewayState::new(ADMIN_TOKEN, None);
        let before = now_ms();
        let (_, session) = paired(&state, OWNER_A, PAIR_TOKEN).await;
        let after = now_ms();
        assert!((before..=after).contains(&session.server_time_ms));
    }

    #[test]
    fn heartbeat_rejects_a_clock_more_than_one_minute_in_the_future() {
        let mut instrument = instrument_snapshot();
        instrument.observed_at_ms = now_ms() + 120_000;
        let batch = EaEventBatch {
            protocol_version: EXECUTION_PROTOCOL_VERSION,
            account: snapshot("123456", "Broker-Live"),
            instruments: vec![instrument],
            positions: Vec::new(),
            pending_orders: Vec::new(),
            portfolio_snapshot_complete: true,
            events: Vec::new(),
        };
        let error = validate_event_batch(&batch).expect_err("future clock must fail closed");
        assert_eq!(error.body.code, "INSTRUMENT_TIME_INVALID");
    }

    #[test]
    fn heartbeat_envelope_allows_money_state_to_commit_before_auxiliary_validation() {
        let mut instrument = instrument_snapshot();
        instrument.observed_at_ms = now_ms() + 120_000;
        let batch = EaEventBatch {
            protocol_version: EXECUTION_PROTOCOL_VERSION,
            account: snapshot("123456", "Broker-Live"),
            instruments: vec![instrument],
            positions: Vec::new(),
            pending_orders: Vec::new(),
            portfolio_snapshot_complete: true,
            events: Vec::new(),
        };

        validate_event_batch_envelope(&batch)
            .expect("valid envelope must not couple portfolio to auxiliary metadata");
        assert_eq!(
            validate_event_batch(&batch)
                .expect_err("invalid instrument lane must still fail closed")
                .body
                .code,
            "INSTRUMENT_TIME_INVALID"
        );
    }

    #[test]
    fn heartbeat_normalizes_legacy_broker_clock_skew_but_rejects_extreme_future_time() {
        let received_at_ms = now_ms();
        let mut instrument = instrument_snapshot();
        instrument.observed_at_ms = received_at_ms + 7 * 60 * 60 * 1_000;
        let mut batch = EaEventBatch {
            protocol_version: EXECUTION_PROTOCOL_VERSION,
            account: snapshot("123456", "Broker-Live"),
            instruments: vec![instrument],
            positions: Vec::new(),
            pending_orders: Vec::new(),
            portfolio_snapshot_complete: true,
            events: Vec::new(),
        };
        assert_eq!(
            normalize_legacy_ea_clock_skew(&mut batch, received_at_ms),
            1
        );
        assert_eq!(batch.instruments[0].observed_at_ms, received_at_ms);
        validate_event_batch(&batch).expect("bounded legacy broker skew is normalized");

        batch.instruments[0].observed_at_ms = received_at_ms + MAX_LEGACY_EA_CLOCK_SKEW_MS + 1;
        assert_eq!(
            normalize_legacy_ea_clock_skew(&mut batch, received_at_ms),
            0
        );
        let error = validate_event_batch(&batch).expect_err("extreme future clock must fail");
        assert_eq!(error.body.code, "INSTRUMENT_TIME_INVALID");
    }

    #[test]
    fn malformed_session_identity_is_rejected_before_pairing_lookup() {
        let mut control_character =
            session_request(PAIR_TOKEN, snapshot("123456", "Broker\nInjected"));
        let error =
            validate_session_request(&control_character).expect_err("control characters must fail");
        assert_eq!(error.status, StatusCode::BAD_REQUEST);

        control_character.account.server = "Broker-Live".into();
        control_character.account.mode = AccountMode::Unknown;
        let error =
            validate_session_request(&control_character).expect_err("unknown mode must fail");
        assert_eq!(error.status, StatusCode::BAD_REQUEST);

        let short_token = session_request("short", snapshot("123456", "Broker-Live"));
        let error = validate_session_request(&short_token).expect_err("short token must fail");
        assert_eq!(error.status, StatusCode::BAD_REQUEST);

        let mut invalid_runtime = session_request(PAIR_TOKEN, snapshot("123456", "Broker-Live"));
        invalid_runtime.runtime_binding = Some(EaManagedRuntimeBinding {
            slot_id: "slot-01".into(),
            terminal_pid: 0,
            gateway_origin: "https://execution.example.test".into(),
        });
        let error = validate_session_request(&invalid_runtime)
            .expect_err("zero managed terminal PID must fail");
        assert_eq!(error.body.code, "MANAGED_EA_RUNTIME_BINDING_INVALID");
    }

    #[test]
    fn generated_pairing_tokens_have_256_bits_of_random_material() {
        let first = random_token();
        let second = random_token();
        assert_eq!(first.len(), 64);
        assert!(first.bytes().all(|character| character.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[tokio::test]
    async fn pairing_token_is_one_time_and_bound_to_owner() {
        let state = GatewayState::new(ADMIN_TOKEN, None);
        let account = snapshot("123456", "Broker-Live");
        state
            .insert_pairing_token(PAIR_TOKEN, OWNER_A, DEFAULT_PAIRING_TTL)
            .await
            .expect("insert pairing token");

        let session = state
            .create_session(session_request(PAIR_TOKEN, account.clone()))
            .await
            .expect("first pairing succeeds");
        assert_eq!(session.account_id, stable_mt5_account_id(OWNER_A, &account));

        let replay = state
            .create_session(session_request(PAIR_TOKEN, account))
            .await
            .expect_err("replayed token must fail");
        assert_eq!(replay.status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn managed_ea_pairing_adopts_the_reserved_account_id() {
        let state = GatewayState::new(ADMIN_TOKEN, None);
        let reserved_account_id = AccountId::new("managed-account-1");
        let invalid = state
            .insert_managed_pairing_token(
                "short",
                OWNER_A,
                DEFAULT_PAIRING_TTL,
                ManagedEaPairingBinding {
                    account_id: reserved_account_id.clone(),
                    worker_id: "worker-a".into(),
                    worker_session_generation: 7,
                    lease_generation: 11,
                    connection_revision: 3,
                    slot_id: "slot-01".into(),
                    terminal_pid: 4242,
                    gateway_origin: "https://execution.example.test".into(),
                    masked_login_suffix: Some("3456".into()),
                    identity_fingerprint: vec![1; 32],
                },
            )
            .await
            .expect_err("invalid managed pairing token must fail");
        assert_eq!(invalid.body.code, "MANAGED_EA_BOOTSTRAP_INVALID");
        let binding = ManagedEaPairingBinding {
            account_id: reserved_account_id.clone(),
            worker_id: "worker-a".into(),
            worker_session_generation: 7,
            lease_generation: 11,
            connection_revision: 3,
            slot_id: "slot-01".into(),
            terminal_pid: 4242,
            gateway_origin: "https://execution.example.test".into(),
            masked_login_suffix: Some("3456".into()),
            identity_fingerprint: mt5_identity_fingerprint(
                &state.inner.mt5_identity_key,
                "123456",
                "Broker-Live",
            )
            .to_vec(),
        };
        state
            .insert_managed_pairing_token(
                MANAGED_PAIR_TOKEN,
                OWNER_A,
                DEFAULT_PAIRING_TTL,
                binding.clone(),
            )
            .await
            .expect("managed token is issued");
        let replacement_pairing_token = random_token();
        state
            .insert_managed_pairing_token(
                &replacement_pairing_token,
                OWNER_A,
                DEFAULT_PAIRING_TTL,
                binding,
            )
            .await
            .expect("replacement managed token is issued");
        let revoked = state
            .create_session(session_request(
                MANAGED_PAIR_TOKEN,
                snapshot("123456", "Broker-Live"),
            ))
            .await
            .expect_err("issuing a replacement must revoke the prior managed token");
        assert_eq!(revoked.status, StatusCode::UNAUTHORIZED);

        let mut request = session_request(
            &replacement_pairing_token,
            snapshot("123456", "Broker-Live"),
        );
        request.runtime_binding = Some(EaManagedRuntimeBinding {
            slot_id: "slot-01".into(),
            terminal_pid: 4242,
            gateway_origin: "https://execution.example.test".into(),
        });
        let session = state
            .create_session(request)
            .await
            .expect("managed pairing succeeds");

        assert_eq!(session.account_id, reserved_account_id);
        let stored = state
            .inner
            .sessions
            .lock()
            .await
            .get(&sha256(session.session_token.as_bytes()))
            .cloned()
            .expect("managed EA session is retained");
        validate_session_account_identity(
            &state.inner.mt5_identity_key,
            &stored,
            &snapshot("123456", "Broker-Live"),
        )
        .expect("managed heartbeat keeps the reserved account binding");
        let mut invalid_session = stored.clone();
        invalid_session
            .managed_identity
            .as_mut()
            .expect("managed identity")
            .runtime_binding
            .terminal_pid = 0;
        let error = validate_session_account_identity(
            &state.inner.mt5_identity_key,
            &invalid_session,
            &snapshot("123456", "Broker-Live"),
        )
        .expect_err("invalid stored runtime binding must fail");
        assert_eq!(error.body.code, "MANAGED_EA_RUNTIME_BINDING_INVALID");
    }

    #[tokio::test]
    async fn unmanaged_pairing_rejects_a_managed_runtime_binding() {
        let state = GatewayState::new(ADMIN_TOKEN, None);
        state
            .insert_pairing_token(PAIR_TOKEN, OWNER_A, DEFAULT_PAIRING_TTL)
            .await
            .expect("insert unmanaged pairing token");
        let mut request = session_request(PAIR_TOKEN, snapshot("123456", "Broker-Live"));
        request.runtime_binding = Some(EaManagedRuntimeBinding {
            slot_id: "slot-01".into(),
            terminal_pid: 4242,
            gateway_origin: "https://execution.example.test".into(),
        });
        let error = state
            .create_session(request)
            .await
            .expect_err("unmanaged pairing must reject runtime binding");
        assert_eq!(error.body.code, "MANAGED_EA_RUNTIME_BINDING_UNEXPECTED");
    }

    #[tokio::test]
    async fn managed_ea_pairing_rejects_the_wrong_terminal_identity() {
        let state = GatewayState::new(ADMIN_TOKEN, None);
        state.inner.pairing_tokens.lock().await.insert(
            sha256(PAIR_TOKEN.as_bytes()),
            PairingGrant {
                owner_id: OWNER_A.into(),
                expires_at_ms: now_ms() + DEFAULT_PAIRING_TTL.as_millis() as u64,
                managed_binding: Some(ManagedEaPairingBinding {
                    account_id: AccountId::new("managed-account-1"),
                    worker_id: "worker-a".into(),
                    worker_session_generation: 7,
                    lease_generation: 11,
                    connection_revision: 3,
                    slot_id: "slot-01".into(),
                    terminal_pid: 4242,
                    gateway_origin: "https://execution.example.test".into(),
                    masked_login_suffix: Some("3456".into()),
                    identity_fingerprint: mt5_identity_fingerprint(
                        &state.inner.mt5_identity_key,
                        "123456",
                        "Broker-Live",
                    )
                    .to_vec(),
                }),
            },
        );

        let error = state
            .create_session(session_request(
                PAIR_TOKEN,
                snapshot("999999", "Other-Broker"),
            ))
            .await
            .expect_err("a different terminal identity must fail closed");

        assert_eq!(error.status, StatusCode::CONFLICT);
        assert_eq!(error.body.code, "MANAGED_EA_IDENTITY_MISMATCH");
        assert!(state.inner.accounts.lock().await.is_empty());
    }

    #[tokio::test]
    async fn managed_ea_pairing_rejects_a_different_runtime_binding() {
        let state = GatewayState::new(ADMIN_TOKEN, None);
        state.inner.pairing_tokens.lock().await.insert(
            sha256(PAIR_TOKEN.as_bytes()),
            PairingGrant {
                owner_id: OWNER_A.into(),
                expires_at_ms: now_ms() + DEFAULT_PAIRING_TTL.as_millis() as u64,
                managed_binding: Some(ManagedEaPairingBinding {
                    account_id: AccountId::new("managed-account-1"),
                    worker_id: "worker-a".into(),
                    worker_session_generation: 7,
                    lease_generation: 11,
                    connection_revision: 3,
                    slot_id: "slot-01".into(),
                    terminal_pid: 4242,
                    gateway_origin: "https://execution.example.test".into(),
                    masked_login_suffix: Some("3456".into()),
                    identity_fingerprint: mt5_identity_fingerprint(
                        &state.inner.mt5_identity_key,
                        "123456",
                        "Broker-Live",
                    )
                    .to_vec(),
                }),
            },
        );
        let mut request = session_request(PAIR_TOKEN, snapshot("123456", "Broker-Live"));
        request.runtime_binding = Some(execution_domain::EaManagedRuntimeBinding {
            slot_id: "other-slot".into(),
            terminal_pid: 9001,
            gateway_origin: "https://other.example.test".into(),
        });

        let error = state
            .create_session(request)
            .await
            .expect_err("a different runtime binding must fail closed");

        assert_eq!(error.status, StatusCode::CONFLICT);
        assert_eq!(error.body.code, "MANAGED_EA_RUNTIME_BINDING_MISMATCH");
        assert!(state.inner.accounts.lock().await.is_empty());
    }

    #[tokio::test]
    async fn expired_pairing_token_is_rejected() {
        let state = GatewayState::new(ADMIN_TOKEN, None);
        let token = EXPIRED_PAIR_TOKEN;
        state
            .insert_pairing_token(token, OWNER_A, Duration::ZERO)
            .await
            .expect("insert pairing token");

        let error = state
            .create_session(session_request(token, snapshot("1", "server")))
            .await
            .expect_err("expired pairing token must fail");
        assert_eq!(error.status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn pairing_token_limit_is_enforced_per_owner() {
        let state = GatewayState::new(ADMIN_TOKEN, None);
        for index in 0..MAX_ACTIVE_PAIRING_TOKENS_PER_OWNER {
            state
                .insert_pairing_token(&format!("{index:064x}"), OWNER_A, DEFAULT_PAIRING_TTL)
                .await
                .expect("token within owner limit");
        }

        let error = state
            .insert_pairing_token(
                "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                OWNER_A,
                DEFAULT_PAIRING_TTL,
            )
            .await
            .expect_err("owner token limit must reject");
        assert_eq!(error.status, StatusCode::TOO_MANY_REQUESTS);

        state
            .insert_pairing_token(
                "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                OWNER_B,
                DEFAULT_PAIRING_TTL,
            )
            .await
            .expect("a different owner has an independent limit");
    }

    #[test]
    fn admin_order_accepts_fixed_quantity_target_wire_shape() {
        let target = serde_json::from_value::<AdminOrderTarget>(serde_json::json!({
            "accountId": "account-a",
            "allocation": {
                "mode": "fixedQuantity",
                "quantity": "0.25",
                "unit": "lots"
            }
        }))
        .expect("fixed target allocation must deserialize");
        assert!(matches!(
            &target.allocation,
            CopyAllocation::FixedQuantity {
                quantity,
                unit: QuantityUnit::Lots
            } if *quantity == Decimal::new(25, 2)
        ));
        validate_admin_order_request(&admin_order(vec![target]))
            .expect("fixed target allocation must pass request validation");
    }

    #[test]
    fn admin_order_rejects_duplicate_targets_and_oversized_command_ids() {
        let duplicate = admin_order(vec![admin_target("account-a"), admin_target("account-a")]);
        let error =
            validate_admin_order_request(&duplicate).expect_err("duplicate account must fail");
        assert_eq!(error.status, StatusCode::BAD_REQUEST);
        assert_eq!(error.body.code, "DUPLICATE_TARGET");

        let mut oversized = admin_order(vec![admin_target("account-a")]);
        oversized.intent.command_id = CommandId::new("c".repeat(128));
        let error = validate_admin_order_request(&oversized)
            .expect_err("routed command id must fit protocol limit");
        assert_eq!(error.status, StatusCode::BAD_REQUEST);
        assert_eq!(error.body.code, "COMMAND_ID_TOO_LONG");
    }

    #[test]
    fn instrument_snapshot_rejects_invalid_quote_and_future_timestamp() {
        let mut invalid_quote = instrument_snapshot();
        invalid_quote.ask = Some(Decimal::new(109_990, 5));
        let error =
            validate_instrument_snapshot(&invalid_quote).expect_err("crossed quote must fail");
        assert_eq!(error.status, StatusCode::BAD_REQUEST);
        assert_eq!(error.body.code, "INSTRUMENT_QUOTE_INVALID");

        let mut future = instrument_snapshot();
        future.observed_at_ms = now_ms().saturating_add(60_001);
        let error =
            validate_instrument_snapshot(&future).expect_err("future observation must fail");
        assert_eq!(error.status, StatusCode::BAD_REQUEST);
        assert_eq!(error.body.code, "INSTRUMENT_TIME_INVALID");
    }

    #[test]
    fn identical_broker_login_isolated_between_owners() {
        let account = snapshot("123456", "Broker-Live");
        assert_ne!(
            stable_mt5_account_id(OWNER_A, &account),
            stable_mt5_account_id(OWNER_B, &account)
        );
    }

    #[test]
    fn admin_secret_comparison_rejects_missing_and_wrong_tokens() {
        let state = GatewayState::new(ADMIN_TOKEN, None);
        assert!(!state.admin_token_matches(&HeaderMap::new()));

        let mut wrong = HeaderMap::new();
        wrong.insert(
            "x-execution-admin-token",
            "wrong-token-with-at-least-32-characters"
                .parse()
                .expect("valid header"),
        );
        assert!(!state.admin_token_matches(&wrong));

        let mut valid = HeaderMap::new();
        valid.insert(
            "x-execution-admin-token",
            ADMIN_TOKEN.parse().expect("valid header"),
        );
        assert!(state.admin_token_matches(&valid));
    }

    #[tokio::test]
    async fn poll_leases_until_ack_and_redelivers_after_expiry() {
        let state = GatewayState::new(ADMIN_TOKEN, None);
        let (account, session) = paired(&state, OWNER_A, PAIR_TOKEN).await;
        state
            .enqueue(
                &session.account_id,
                place_command(session.account_id.clone(), "cmd-1"),
            )
            .await
            .expect("enqueue");
        let headers = bearer(&session.session_token);

        let first = poll_commands(State(state.clone()), headers.clone())
            .await
            .expect("first poll")
            .0;
        assert_eq!(first.commands.len(), 1);
        let second = poll_commands(State(state.clone()), headers.clone())
            .await
            .expect("second poll")
            .0;
        assert!(
            second.commands.is_empty(),
            "active lease must suppress replay"
        );

        {
            let mut queues = state.inner.commands.lock().await;
            queues
                .get_mut(&session.account_id)
                .expect("queue")
                .front_mut()
                .expect("command")
                .leased_until_ms = 0;
        }
        let redelivery = poll_commands(State(state.clone()), headers.clone())
            .await
            .expect("redelivery poll")
            .0;
        assert_eq!(redelivery.commands.len(), 1);

        let _ = accept_events(
            State(state.clone()),
            headers,
            Json(EaEventBatch {
                protocol_version: EXECUTION_PROTOCOL_VERSION,
                account,
                instruments: Vec::new(),
                positions: Vec::new(),
                pending_orders: Vec::new(),
                portfolio_snapshot_complete: true,
                events: vec![
                    execution_domain::EaEvent::CommandAccepted {
                        command_id: CommandId::new("cmd-1"),
                        broker_order_id: Some("100001".into()),
                        broker_deal_id: None,
                        retcode: 10009,
                        message: "done".into(),
                        occurred_at_ms: now_ms(),
                    };
                    2
                ],
            }),
        )
        .await
        .expect("ack event");
        assert!(
            state
                .inner
                .commands
                .lock()
                .await
                .get(&session.account_id)
                .is_some_and(VecDeque::is_empty)
        );
    }

    #[tokio::test]
    async fn poll_drops_unacknowledged_commands_after_delivery_deadline() {
        let state = GatewayState::new(ADMIN_TOKEN, None);
        let (_account, session) = paired(&state, OWNER_A, PAIR_TOKEN).await;
        state
            .enqueue(
                &session.account_id,
                place_command(session.account_id.clone(), "cmd-expired"),
            )
            .await
            .expect("enqueue");
        {
            let mut queues = state.inner.commands.lock().await;
            queues
                .get_mut(&session.account_id)
                .expect("queue")
                .front_mut()
                .expect("command")
                .queued_at_ms = now_ms().saturating_sub(COMMAND_DELIVERY_TTL.as_millis() as u64);
        }

        let response = poll_commands(State(state.clone()), bearer(&session.session_token))
            .await
            .expect("poll")
            .0;
        assert!(response.commands.is_empty());
        assert!(
            state
                .inner
                .commands
                .lock()
                .await
                .get(&session.account_id)
                .expect("queue")
                .is_empty(),
            "expired commands must never be delivered later"
        );
    }

    #[tokio::test]
    async fn changed_mt5_identity_cannot_reuse_session() {
        let state = GatewayState::new(ADMIN_TOKEN, None);
        let (_, session) = paired(&state, OWNER_A, PAIR_TOKEN).await;
        let error = accept_events(
            State(state),
            bearer(&session.session_token),
            Json(EaEventBatch {
                protocol_version: EXECUTION_PROTOCOL_VERSION,
                account: snapshot("999999", "Attacker-Live"),
                instruments: Vec::new(),
                positions: Vec::new(),
                pending_orders: Vec::new(),
                portfolio_snapshot_complete: true,
                events: Vec::new(),
            }),
        )
        .await
        .expect_err("changed identity must fail");
        assert_eq!(error.status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn owner_cannot_queue_to_another_owners_account() {
        let state = GatewayState::new(ADMIN_TOKEN, None);
        let (_, session) = paired(&state, OWNER_A, PAIR_TOKEN).await;
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-execution-admin-token",
            ADMIN_TOKEN.parse().expect("valid header"),
        );
        let error = queue_command(
            State(state),
            headers,
            Json(AdminCommandRequest {
                owner_id: OWNER_B.into(),
                command: close_command(session.account_id, "cmd-cross-owner"),
                authorization_token: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".into(),
                authorization_session_id: Uuid::new_v4().to_string(),
            }),
        )
        .await
        .expect_err("cross-owner target must fail");
        assert_eq!(error.status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn account_disconnect_is_owner_scoped_and_revokes_session_and_queue() {
        let state = GatewayState::new(ADMIN_TOKEN, None);
        let (_, session) = paired(&state, OWNER_A, PAIR_TOKEN).await;
        state
            .enqueue(
                &session.account_id,
                place_command(session.account_id.clone(), "cmd-disconnect"),
            )
            .await
            .expect("enqueue");

        let cross_owner = state
            .manage_account(OWNER_B, &session.account_id, false)
            .await
            .expect_err("another owner must not disconnect the account");
        assert_eq!(cross_owner.status, StatusCode::NOT_FOUND);
        state
            .authenticate(&bearer(&session.session_token))
            .await
            .expect("cross-owner attempt must not revoke the session");

        state
            .manage_account(OWNER_A, &session.account_id, false)
            .await
            .expect("owner disconnect");
        let revoked = state
            .authenticate(&bearer(&session.session_token))
            .await
            .expect_err("disconnected bearer must be revoked");
        assert_eq!(revoked.status, StatusCode::UNAUTHORIZED);
        assert!(
            state
                .inner
                .commands
                .lock()
                .await
                .get(&session.account_id)
                .is_none(),
            "disconnect must discard commands that could replay after reconnect"
        );
        assert!(
            !state
                .inner
                .accounts
                .lock()
                .await
                .get(&session.account_id)
                .expect("account remains registered")
                .connected
        );
    }

    #[tokio::test]
    async fn account_remove_hides_runtime_state_and_pairing_restores_it() {
        let state = GatewayState::new(ADMIN_TOKEN, None);
        let (account, session) = paired(&state, OWNER_A, PAIR_TOKEN).await;
        state
            .manage_account(OWNER_A, &session.account_id, true)
            .await
            .expect("owner remove");
        assert!(
            !state
                .inner
                .accounts
                .lock()
                .await
                .contains_key(&session.account_id),
            "removed account must disappear from the registry"
        );
        assert!(
            state
                .authenticate(&bearer(&session.session_token))
                .await
                .is_err(),
            "removed session must not remain usable"
        );
        let stale_heartbeat = state
            .touch_account(OWNER_A, &session.account_id, account.clone())
            .await
            .expect_err("an in-flight stale session must not recreate a removed account");
        assert_eq!(stale_heartbeat.status, StatusCode::FORBIDDEN);

        let replacement_token = "replacement-pairing-token-with-at-least-32-characters";
        state
            .insert_pairing_token(replacement_token, OWNER_A, DEFAULT_PAIRING_TTL)
            .await
            .expect("issue replacement token");
        let replacement = state
            .create_session(session_request(replacement_token, account))
            .await
            .expect("same broker identity can be paired again");
        assert_eq!(replacement.account_id, session.account_id);
        state
            .authenticate(&bearer(&replacement.session_token))
            .await
            .expect("replacement session is active");
    }

    #[tokio::test]
    async fn pairing_rotation_revokes_the_previous_account_session() {
        let state = GatewayState::new(ADMIN_TOKEN, None);
        let (account, first) = paired(&state, OWNER_A, PAIR_TOKEN).await;
        let replacement_token = "rotated-pairing-token-with-at-least-32-characters";
        state
            .insert_pairing_token(replacement_token, OWNER_A, DEFAULT_PAIRING_TTL)
            .await
            .expect("issue replacement token");
        let second = state
            .create_session(session_request(replacement_token, account))
            .await
            .expect("rotate session");

        assert_eq!(first.account_id, second.account_id);
        assert!(
            state
                .authenticate(&bearer(&first.session_token))
                .await
                .is_err(),
            "old session must be revoked after the new EA pairs"
        );
        state
            .authenticate(&bearer(&second.session_token))
            .await
            .expect("new session remains active");
    }

    #[tokio::test]
    async fn command_queue_enforces_backpressure() {
        let state = GatewayState::new(ADMIN_TOKEN, None);
        let (_, session) = paired(&state, OWNER_A, PAIR_TOKEN).await;
        for index in 0..MAX_COMMANDS_PER_ACCOUNT {
            state
                .enqueue(
                    &session.account_id,
                    place_command(session.account_id.clone(), &format!("cmd-{index}")),
                )
                .await
                .expect("within queue capacity");
        }
        let error = state
            .enqueue(
                &session.account_id,
                place_command(session.account_id.clone(), "overflow"),
            )
            .await
            .expect_err("queue must reject overflow");
        assert!(matches!(error, AdapterError::Backpressure));
    }
}
