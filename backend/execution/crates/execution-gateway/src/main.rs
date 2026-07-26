use std::collections::{HashMap, HashSet, VecDeque};
use std::env;
use std::net::SocketAddr;
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
    CopyAllocation, CopyTarget, EXECUTION_PROTOCOL_VERSION, EaAccountSnapshot, EaCommand, EaEvent,
    EaEventBatch, EaInstrumentSnapshot, EaPendingOrderSnapshot, EaPositionSnapshot,
    EaSessionRequest, EaSessionResponse, ExecutionAccount, InstrumentSpec, ModifyPositionCommand,
    OrderIntent, RiskPolicy, RouteRejectCode, RouteTargetContext, RouteWarning, RoutedOrder,
    SessionId, Side, TargetRouteResult, VenueKind,
};
use execution_engine::route_order;
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
const EA_POLL_FRESHNESS: Duration = Duration::from_secs(15);
const MIN_SUPPORTED_EA_VERSION: (u32, u32, u32) = (1, 22, 0);
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
    database: Option<PgPool>,
    pairing_tokens: Mutex<HashMap<[u8; 32], PairingGrant>>,
    sessions: Mutex<HashMap<[u8; 32], EaSession>>,
    accounts: Mutex<HashMap<AccountId, EaAccountView>>,
    commands: Mutex<HashMap<AccountId, VecDeque<QueuedCommand>>>,
}

#[derive(Clone, Debug)]
struct EaSession {
    session_id: SessionId,
    account_id: AccountId,
    owner_id: String,
    expires_at_ms: u64,
}

#[derive(Clone)]
struct PairingGrant {
    owner_id: String,
    expires_at_ms: u64,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdminCommandRequest {
    owner_id: String,
    command: EaCommand,
}

#[derive(Debug, Deserialize)]
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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminOrderResponse {
    command_id: execution_domain::CommandId,
    targets: Vec<AdminTargetSubmission>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum AdminTargetSubmission {
    Queued {
        account_id: AccountId,
        command_id: execution_domain::CommandId,
        warnings: Vec<RouteWarning>,
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
    let state = GatewayState::new_production(&config.admin_token, database);
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
        .route("/v1/admin/account-state", get(account_state))
        .route("/v1/admin/instruments", get(account_instruments))
        .route("/v1/admin/symbol-mappings", post(upsert_symbol_mapping))
        .route("/v1/admin/pairing-tokens", post(issue_pairing_token))
        .route("/v1/admin/accounts/disconnect", post(disconnect_account))
        .route("/v1/admin/accounts/remove", post(remove_account))
        .route("/v1/admin/orders", post(route_admin_order))
        .route("/v1/admin/commands", post(queue_command))
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

struct Config {
    bind: SocketAddr,
    admin_bind: SocketAddr,
    admin_token: String,
    database_url: String,
    database_max_connections: u32,
}

impl Config {
    fn from_env() -> Result<Self, String> {
        let admin_token = required_secret("EXECUTION_ADMIN_TOKEN")?;
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

fn validate_secret(name: &str, value: &str) -> Result<(), String> {
    if value.trim().len() < 32 {
        return Err(format!("{name} must contain at least 32 characters"));
    }
    Ok(())
}

impl GatewayState {
    fn new_production(admin_token: &str, database: PgPool) -> Self {
        Self::new(admin_token, Some(database))
    }

    fn new(admin_token: &str, database: Option<PgPool>) -> Self {
        Self {
            inner: Arc::new(GatewayInner {
                admin_token_hash: sha256(admin_token.as_bytes()),
                database,
                pairing_tokens: Mutex::new(HashMap::new()),
                sessions: Mutex::new(HashMap::new()),
                accounts: Mutex::new(HashMap::new()),
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
                      AND status IN ('ready', 'queued', 'unknown')
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
                    "DELETE FROM execution_copy_groups WHERE user_id = $1 AND source_account_id = $2",
                )
                .bind(owner_uuid)
                .bind(account_id.as_str())
                .execute(&mut *transaction)
                .await
                .map_err(|error| ApiError::database("remove source copy routes", error))?;
                sqlx::query(
                    "DELETE FROM execution_copy_targets WHERE user_id = $1 AND account_id = $2",
                )
                .bind(owner_uuid)
                .bind(account_id.as_str())
                .execute(&mut *transaction)
                .await
                .map_err(|error| ApiError::database("remove target copy routes", error))?;
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

        let account_id = stable_mt5_account_id(&grant.owner_id, &request.account);
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
        let owner_uuid = sqlx::query_scalar::<_, Uuid>(
            r#"
            UPDATE execution_pairing_tokens
            SET consumed_at = now()
            WHERE token_hash = $1
              AND consumed_at IS NULL
              AND expires_at > now()
            RETURNING user_id
            "#,
        )
        .bind(sha256(request.pairing_token.as_bytes()).to_vec())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("consume pairing token", error))?
        .ok_or_else(|| ApiError::unauthorized("EA pairing token is invalid or expired"))?;

        let owner_id = owner_uuid.to_string();
        let account_id = stable_mt5_account_id(&owner_id, &request.account);
        let broker_code = normalize_broker_code(&request.account.broker);
        let label = format!(
            "{} {}",
            request.account.broker.trim(),
            request.account.login.trim()
        );
        let status = if request.account.trade_allowed {
            "ready"
        } else {
            "blocked"
        };
        let snapshot_json = serde_json::to_value(&request.account)
            .map_err(|error| ApiError::internal("serialize EA account", error))?;
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
                external_account_ref = EXCLUDED.external_account_ref,
                server = EXCLUDED.server,
                label = EXCLUDED.label,
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
        .bind(request.account.login.trim())
        .bind(request.account.server.trim())
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
                expires_at, absolute_expires_at
            )
            VALUES (
                $1, $2, $3, $4, $5,
                to_timestamp($6::double precision / 1000.0),
                to_timestamp($7::double precision / 1000.0)
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
                jsonb_build_object('agentId', $4, 'mode', $5, 'server', $6)
            )
            "#,
        )
        .bind(owner_uuid)
        .bind(session_id.as_str())
        .bind(account_id.as_str())
        .bind(request.agent_id.trim())
        .bind(account_mode_name(request.account.mode))
        .bind(request.account.server.trim())
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
                RETURNING
                    id,
                    user_id::text AS owner_id,
                    account_id,
                    floor(extract(epoch FROM expires_at) * 1000)::bigint
                        AS expires_at_ms
                "#,
            )
            .bind(token_hash.to_vec())
            .fetch_optional(database)
            .await
            .map_err(|error| ApiError::database("authenticate EA session", error))?
            .ok_or_else(|| ApiError::unauthorized("EA session is invalid or expired"))?;
            return Ok(EaSession {
                session_id: SessionId::new(
                    row.try_get::<Uuid, _>("id")
                        .map_err(|error| ApiError::database("decode EA session id", error))?
                        .to_string(),
                ),
                account_id: AccountId::new(
                    row.try_get::<String, _>("account_id")
                        .map_err(|error| ApiError::database("decode EA account id", error))?,
                ),
                owner_id: row
                    .try_get("owner_id")
                    .map_err(|error| ApiError::database("decode EA owner", error))?,
                expires_at_ms: row
                    .try_get::<i64, _>("expires_at_ms")
                    .map_err(|error| ApiError::database("decode EA session expiry", error))?
                    as u64,
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
                    external_account_ref = $4,
                    server = $5,
                    mode = $6,
                    status = $7,
                    currency = $8,
                    balance = $9,
                    equity = $10,
                    trade_allowed = $11,
                    metadata = $12,
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
                            status = $4
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
            .map_err(|error| ApiError::database("commit EA events", error))
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
                )
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
                    "SMCExecutionEA {}.{} or newer is required",
                    MIN_SUPPORTED_EA_VERSION.0, MIN_SUPPORTED_EA_VERSION.1
                )));
            }

            let pending_count = sqlx::query_scalar::<_, i64>(
                r#"
                SELECT count(*)
                FROM execution_target_commands
                WHERE user_id = $1
                  AND target_account_id = $2
                  AND terminal_ack_at IS NULL
                  AND status IN ('ready', 'queued', 'submitted', 'unknown')
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
                SET status = 'failed',
                    reject_code = CASE
                        WHEN first_delivered_at IS NULL
                            THEN 'DELIVERY_UNAVAILABLE'
                        ELSE 'DELIVERY_EXPIRED'
                    END,
                    reject_message = CASE
                        WHEN first_delivered_at IS NULL
                            THEN 'EA did not poll before the command delivery deadline'
                        ELSE 'EA did not acknowledge the command before its delivery deadline'
                    END,
                    terminal_ack_at = now(),
                    lease_owner = NULL,
                    lease_expires_at = NULL,
                    updated_at = now()
                WHERE user_id = $1
                  AND target_account_id = $2
                  AND terminal_ack_at IS NULL
                  AND status IN ('ready', 'queued', 'unknown')
                  AND COALESCE(first_delivered_at, created_at) <=
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
                  AND COALESCE(first_delivered_at, created_at) >
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
    if stable_mt5_account_id(&session.owner_id, &batch.account) != session.account_id {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "ACCOUNT_SESSION_MISMATCH",
            "EA account identity changed; create a new session",
        ));
    }
    let normalized_timestamps = normalize_legacy_ea_clock_skew(&mut batch, now_ms());
    if normalized_timestamps > 0 {
        warn!(
            account_id = %session.account_id,
            session_id = %session.session_id,
            normalized_timestamps,
            "normalized legacy MT5 broker clock skew"
        );
    }
    validate_event_batch(&batch)?;
    let events = normalize_events(batch.events)?;
    let instruments = batch.instruments;
    let positions = batch.positions;
    let pending_orders = batch.pending_orders;
    state
        .touch_account(&session.owner_id, &session.account_id, batch.account)
        .await?;
    state
        .persist_database_payload(
            &session,
            &instruments,
            &positions,
            &pending_orders,
            batch.portfolio_snapshot_complete,
            &events,
        )
        .await?;
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

async fn route_admin_order(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<AdminOrderRequest>,
) -> Result<(StatusCode, Json<AdminOrderResponse>), ApiError> {
    require_admin(&state, &headers)?;
    let owner_uuid = parse_owner_id(&request.owner_id)?;
    validate_admin_order_request(&request)?;

    let source_equity = state
        .source_equity(owner_uuid, request.intent.source_account_id.as_ref())
        .await?;
    let mut contexts = Vec::with_capacity(request.targets.len());
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
                contexts.push(context);
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

    for result in route_order(&request.intent, source_equity, &contexts) {
        match result {
            TargetRouteResult::Ready { account_id, order } => {
                let order = *order;
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
            if command
                .stop_loss
                .is_some_and(|value| value <= Decimal::ZERO)
                || command
                    .take_profit
                    .is_some_and(|value| value <= Decimal::ZERO)
            {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "MODIFICATION_PRICE_INVALID",
                    "position protection prices must be positive",
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
    let wrong_stop_side = stop_loss.is_some_and(|stop| match position.side {
        Side::Buy => stop >= price,
        Side::Sell => stop <= price,
    });
    let wrong_target_side = take_profit.is_some_and(|target| match position.side {
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
        let stop_too_close = stop_loss.is_some_and(|stop| (price - stop).abs() < minimum);
        let target_too_close = take_profit.is_some_and(|target| (price - target).abs() < minimum);
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

fn require_admin(state: &GatewayState, headers: &HeaderMap) -> Result<(), ApiError> {
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

fn validate_event_batch(batch: &EaEventBatch) -> Result<(), ApiError> {
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

fn parse_owner_id(owner_id: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(owner_id.trim()).map_err(|_| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "OWNER_ID_INVALID",
            "ownerId must be a valid UUID",
        )
    })
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
        EaCommand::ClosePosition { command } => Some(command.command_id.as_str()),
        EaCommand::CancelOrder { command } => Some(command.command_id.as_str()),
        EaCommand::Sync => None,
    }
}

fn command_target_account(command: &EaCommand) -> Option<&AccountId> {
    match command {
        EaCommand::Place { order } => Some(&order.target_account_id),
        EaCommand::ModifyPosition { command } => Some(&command.target_account_id),
        EaCommand::ClosePosition { command } => Some(&command.target_account_id),
        EaCommand::CancelOrder { command } => Some(&command.target_account_id),
        EaCommand::Sync => None,
    }
}

fn command_idempotency_key(command: &EaCommand) -> Option<&str> {
    match command {
        EaCommand::Place { order } => Some(order.idempotency_key.as_str()),
        EaCommand::ModifyPosition { command } => Some(command.idempotency_key.as_str()),
        EaCommand::ClosePosition { command } => Some(command.idempotency_key.as_str()),
        EaCommand::CancelOrder { command } => Some(command.idempotency_key.as_str()),
        EaCommand::Sync => None,
    }
}

fn command_parent_id(command: &EaCommand) -> Option<&str> {
    match command {
        EaCommand::Place { order } => Some(order.parent_command_id.as_str()),
        EaCommand::ModifyPosition { command } => Some(command.command_id.as_str()),
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

fn sha256(value: &[u8]) -> [u8; 32] {
    Sha256::digest(value).into()
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

fn now_ms() -> u64 {
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
        OrderSizing, QuantityUnit, RoutedOrder, Side, VenueKind,
    };
    use rust_decimal::Decimal;
    use std::collections::BTreeMap;

    const ADMIN_TOKEN: &str = "admin-token-with-at-least-32-characters";
    const OWNER_A: &str = "11111111-1111-4111-8111-111111111111";
    const OWNER_B: &str = "22222222-2222-4222-8222-222222222222";
    const PAIR_TOKEN: &str = "pairing-token-with-at-least-32-characters";
    const EXPIRED_PAIR_TOKEN: &str = "expired-pairing-token-at-least-32-chars";

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
            ea_version: Some("1.22".into()),
        }
    }

    fn session_request(token: &str, account: EaAccountSnapshot) -> EaSessionRequest {
        EaSessionRequest {
            protocol_version: EXECUTION_PROTOCOL_VERSION,
            pairing_token: token.into(),
            agent_id: "test-agent".into(),
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
    fn deployment_fails_closed_for_unwired_native_venue_transports() {
        assert!(execution_transport_enabled(VenueKind::MetaTrader5));
        assert!(!execution_transport_enabled(VenueKind::BinanceSpot));
        assert!(!execution_transport_enabled(VenueKind::BinanceUsdM));
    }

    #[test]
    fn account_liveness_uses_the_freshest_authenticated_ea_activity() {
        assert_eq!(effective_last_seen_at_ms(1_000, Some(2_000)), 2_000);
        assert_eq!(effective_last_seen_at_ms(3_000, Some(2_000)), 3_000);
        assert_eq!(effective_last_seen_at_ms(4_000, None), 4_000);
    }

    #[test]
    fn ea_version_gate_accepts_current_and_future_releases_only() {
        assert!(!ea_version_supported(None));
        assert!(!ea_version_supported(Some("1.21")));
        assert!(!ea_version_supported(Some("invalid")));
        assert!(ea_version_supported(Some("1.22")));
        assert!(ea_version_supported(Some("1.22.1")));
        assert!(ea_version_supported(Some("2.0.0")));
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
