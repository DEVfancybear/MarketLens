use std::collections::{HashMap, HashSet};
use std::time::Duration;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use execution_domain::mt5_vm_control::{
    MT5_VM_CONTROL_PROTOCOL_VERSION, MT5_VM_MAX_COMMANDS_PER_POLL, MT5_VM_MAX_SCHEDULED_TERMINALS,
    WorkerCommandAckKind, WorkerCommandAckRequest, WorkerCommandAckResponse, WorkerCommandKind,
    WorkerControlCommand, WorkerEaBootstrapBindRequest, WorkerEaBootstrapBindResponse,
    WorkerHeartbeatRequest, WorkerHeartbeatResponse, WorkerHelloRequest, WorkerHelloResponse,
    WorkerPollRequest, WorkerPollResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx_core::row::Row;
use sqlx_postgres::{PgPool, Postgres};
use tracing::error;
use uuid::Uuid;

use super::{
    ApiError, GatewayState, bearer_token, header_value, now_ms, parse_owner_id, random_token,
    require_admin, secret_matches, sha256,
};

const HEARTBEAT_INTERVAL_MS: u64 = 15_000;
const LEASE_TTL_SECONDS: i64 = 45;
const LEASE_TTL_MS: u64 = LEASE_TTL_SECONDS as u64 * 1_000;
const DEFAULT_COMMAND_TTL_SECONDS: u64 = 5 * 60;
const MAX_COMMAND_TTL_SECONDS: u64 = 15 * 60;
const MAX_SCHEDULE_PER_TICK: usize = 16;
const SCHEDULER_INTERVAL: Duration = Duration::from_secs(1);

pub(super) fn routes() -> Router<GatewayState> {
    Router::new()
        .route("/v1/mt5-vm/workers/hello", post(worker_hello))
        .route("/v1/mt5-vm/workers/heartbeat", post(worker_heartbeat))
        .route("/v1/mt5-vm/workers/poll", post(worker_poll))
        .route("/v1/mt5-vm/workers/ack", post(worker_ack))
        .route(
            "/v1/mt5-vm/workers/ea-bootstrap/bind",
            post(worker_bind_ea_bootstrap),
        )
        .route("/v1/admin/mt5-vm/workers", get(list_workers))
        .route("/v1/admin/mt5-vm/commands", post(queue_admin_command))
}

pub(super) fn spawn_scheduler(state: GatewayState) {
    if state.inner.database.is_none() {
        return;
    }
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(SCHEDULER_INTERVAL);
        loop {
            interval.tick().await;
            if let Err(error) = scheduler_tick(&state).await {
                error!(?error, "MT5 VM control-plane scheduler tick failed");
            }
        }
    });
}

fn database(state: &GatewayState) -> Result<&PgPool, ApiError> {
    state.inner.database.as_ref().ok_or_else(|| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "MT5_VM_CONTROL_DATABASE_REQUIRED",
            "MT5 VM control-plane persistence is unavailable",
        )
    })
}

fn require_bootstrap(state: &GatewayState, headers: &HeaderMap) -> Result<(), ApiError> {
    let Some(expected) = state.inner.mt5_vm_bootstrap_token_hash.as_ref() else {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "MT5_VM_CONTROL_DISABLED",
            "MT5 VM worker enrollment is disabled",
        ));
    };
    let candidate =
        header_value(headers, "x-mt5-vm-bootstrap-token").map(|token| sha256(token.as_bytes()));
    if candidate
        .as_ref()
        .is_some_and(|candidate| secret_matches(candidate, expected))
    {
        Ok(())
    } else {
        Err(ApiError::unauthorized(
            "MT5 VM worker bootstrap token is invalid",
        ))
    }
}

fn negotiate_protocol(protocol_min: u16, protocol_max: u16) -> Result<u16, ApiError> {
    if protocol_min == 0
        || protocol_min > protocol_max
        || !(protocol_min..=protocol_max).contains(&MT5_VM_CONTROL_PROTOCOL_VERSION)
    {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "MT5_VM_PROTOCOL_UNSUPPORTED",
            "worker and control plane have no common protocol version",
        ));
    }
    Ok(MT5_VM_CONTROL_PROTOCOL_VERSION)
}

fn valid_identifier(value: &str) -> bool {
    let value = value.as_bytes();
    !value.is_empty()
        && value.len() <= 64
        && value[0].is_ascii_alphanumeric()
        && value
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

pub(super) fn valid_ea_gateway_origin(value: &str) -> bool {
    if !(8..=2_048).contains(&value.len())
        || value
            .chars()
            .any(|character| matches!(character, '@' | '?' | '#' | '\\'))
    {
        return false;
    }
    let Ok(uri) = value.parse::<axum::http::Uri>() else {
        return false;
    };
    valid_ea_gateway_uri(value, &uri)
}

fn valid_ea_gateway_uri(value: &str, uri: &axum::http::Uri) -> bool {
    let Some((scheme, authority)) = uri.scheme_str().zip(uri.authority()) else {
        return false;
    };
    if format!("{scheme}://{authority}") != value {
        return false;
    }
    match scheme {
        "https" => true,
        "http" => uri.host().is_some_and(|host| {
            host.eq_ignore_ascii_case("localhost")
                || host == "127.0.0.1"
                || matches!(host, "::1" | "[::1]")
        }),
        _ => false,
    }
}

fn decode_lower_hex_32(value: &str) -> Option<[u8; 32]> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return None;
    }
    let mut decoded = [0_u8; 32];
    for (index, byte) in decoded.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).ok()?;
    }
    Some(decoded)
}

fn valid_version(value: &str) -> bool {
    let value = value.trim().as_bytes();
    !value.is_empty()
        && value.len() <= 64
        && value[0].is_ascii_alphanumeric()
        && value
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'+'))
}

fn validate_hello(request: &WorkerHelloRequest) -> Result<u16, ApiError> {
    let protocol = negotiate_protocol(request.protocol_min, request.protocol_max)?;
    if !valid_identifier(&request.worker_id)
        || !valid_identifier(&request.region)
        || !valid_version(&request.agent_version)
        || !valid_version(&request.image_version)
        || !valid_version(&request.runtime_version)
        || !(1..=MT5_VM_MAX_SCHEDULED_TERMINALS).contains(&request.capacity)
        || request.capabilities.len() > 32
        || request
            .capabilities
            .iter()
            .any(|capability| !valid_identifier(capability))
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "MT5_VM_WORKER_HELLO_INVALID",
            "worker hello metadata or capacity is invalid",
        ));
    }
    Ok(protocol)
}

fn worker_substrate(request: &WorkerHelloRequest) -> &'static str {
    if request.capabilities.contains("bare_metal") {
        "bare_metal"
    } else {
        "windows_vm"
    }
}

async fn worker_hello(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<WorkerHelloRequest>,
) -> Result<Json<WorkerHelloResponse>, ApiError> {
    require_bootstrap(&state, &headers)?;
    let protocol = validate_hello(&request)?;
    let database = database(&state)?;
    let raw_token = random_token();
    let token_hash = sha256(raw_token.as_bytes());
    let worker_substrate = worker_substrate(&request);
    let mut transaction = database
        .begin()
        .await
        .map_err(|error| ApiError::database("begin MT5 VM worker hello", error))?;

    let session_generation = sqlx_core::query::query(
        r#"
        INSERT INTO execution_mt5_vm_workers (
          worker_id, protocol_version, session_generation, session_token_hash,
          agent_version, image_version, runtime_version, capacity, region,
          capabilities, worker_substrate, status, drain,
          last_heartbeat_at, heartbeat_expires_at
        )
        VALUES (
          $1, $2, 1, $3, $4, $5, $6, $7, $8, $9,
          $10, 'healthy', false, now(), now() + interval '45 seconds'
        )
        ON CONFLICT (worker_id) DO UPDATE SET
          protocol_version = EXCLUDED.protocol_version,
          session_generation = execution_mt5_vm_workers.session_generation + 1,
          session_token_hash = EXCLUDED.session_token_hash,
          agent_version = EXCLUDED.agent_version,
          image_version = EXCLUDED.image_version,
          runtime_version = EXCLUDED.runtime_version,
          capacity = EXCLUDED.capacity,
          region = EXCLUDED.region,
          capabilities = EXCLUDED.capabilities,
          worker_substrate = EXCLUDED.worker_substrate,
          status = CASE WHEN execution_mt5_vm_workers.drain THEN 'draining' ELSE 'healthy' END,
          last_heartbeat_at = now(),
          heartbeat_expires_at = now() + interval '45 seconds'
        RETURNING session_generation
        "#,
    )
    .bind(&request.worker_id)
    .bind(i32::from(protocol))
    .bind(token_hash.to_vec())
    .bind(request.agent_version.trim())
    .bind(request.image_version.trim())
    .bind(request.runtime_version.trim())
    .bind(i32::from(request.capacity))
    .bind(request.region.trim())
    .bind(sqlx_core::types::Json(json!({
        "features": request.capabilities
    })))
    .bind(worker_substrate)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("register MT5 VM worker", error))?
    .try_get::<i64, _>("session_generation")
    .map_err(|error| ApiError::database("decode MT5 VM worker generation", error))?;

    sqlx_core::query::query(
        r#"
        UPDATE execution_mt5_vm_control_commands
        SET status = 'fenced', completed_at = now(), dispatch_lease_until = NULL,
            error_code = 'WORKER_SESSION_REPLACED'
        WHERE worker_id = $1
          AND worker_session_generation < $2
          AND status IN ('queued', 'dispatched', 'received')
        "#,
    )
    .bind(&request.worker_id)
    .bind(session_generation)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("fence replaced worker commands", error))?;

    sqlx_core::query::query(
        r#"
        UPDATE execution_mt5_vm_account_leases
        SET status = 'expired', released_at = now(), release_reason = 'WORKER_SESSION_REPLACED'
        WHERE worker_id = $1 AND status = 'active'
        "#,
    )
    .bind(&request.worker_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("expire replaced worker leases", error))?;

    sqlx_core::query::query(
        r#"
        UPDATE execution_mt5_vm_accounts
        SET connection_status = CASE
              WHEN persistence_mode = 'managed' THEN 'reconnecting'
              ELSE 'credentials_required'
            END,
            worker_id = NULL,
            connection_revision = connection_revision + 1,
            last_error_code = 'WORKER_SESSION_REPLACED'
        WHERE worker_id = $1
          AND disconnect_requested_revision IS NULL
        "#,
    )
    .bind(&request.worker_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("requeue replaced worker accounts", error))?;

    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit MT5 VM worker hello", error))?;

    Ok(Json(WorkerHelloResponse {
        protocol_version: protocol,
        worker_id: request.worker_id,
        session_generation: session_generation as u64,
        session_token: raw_token,
        heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
        lease_ttl_ms: LEASE_TTL_MS,
        server_time_ms: now_ms(),
    }))
}

#[derive(Clone, Copy, Debug)]
pub(super) struct WorkerAuth {
    pub(super) protocol_version: u16,
    pub(super) session_generation: u64,
    pub(super) capacity: u16,
}

pub(super) async fn authenticate_worker(
    transaction: &mut sqlx_core::transaction::Transaction<'_, Postgres>,
    headers: &HeaderMap,
    worker_id: &str,
    session_generation: u64,
    protocol_version: u16,
) -> Result<WorkerAuth, ApiError> {
    let token = bearer_token(headers)
        .filter(|token| valid_worker_session_token(token))
        .ok_or_else(|| ApiError::unauthorized("MT5 VM worker bearer token is required"))?;
    authenticate_worker_token(
        transaction,
        token,
        worker_id,
        session_generation,
        protocol_version,
    )
    .await
}

pub(super) fn valid_worker_session_token(token: &str) -> bool {
    token.len() == 64
        && token
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

pub(super) async fn authenticate_worker_token(
    transaction: &mut sqlx_core::transaction::Transaction<'_, Postgres>,
    token: &str,
    worker_id: &str,
    session_generation: u64,
    protocol_version: u16,
) -> Result<WorkerAuth, ApiError> {
    if !valid_worker_session_token(token) {
        return Err(ApiError::unauthorized(
            "MT5 VM worker bearer token is required",
        ));
    }
    let row = sqlx_core::query::query(
        r#"
        SELECT protocol_version, session_generation, session_token_hash, capacity,
               heartbeat_expires_at > now() AS heartbeat_valid
        FROM execution_mt5_vm_workers
        WHERE worker_id = $1
        FOR UPDATE
        "#,
    )
    .bind(worker_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|error| ApiError::database("authenticate MT5 VM worker", error))?
    .ok_or_else(|| ApiError::unauthorized("MT5 VM worker session is invalid"))?;
    let stored_protocol = row
        .try_get::<i32, _>("protocol_version")
        .map_err(|error| ApiError::database("decode worker protocol", error))?;
    let stored_generation = row
        .try_get::<i64, _>("session_generation")
        .map_err(|error| ApiError::database("decode worker session generation", error))?;
    let token_hash = row
        .try_get::<Vec<u8>, _>("session_token_hash")
        .map_err(|error| ApiError::database("decode worker token hash", error))?;
    let heartbeat_valid = row
        .try_get::<bool, _>("heartbeat_valid")
        .map_err(|error| ApiError::database("decode worker heartbeat", error))?;
    let candidate = sha256(token.as_bytes());
    let token_valid = token_hash
        .as_slice()
        .try_into()
        .ok()
        .is_some_and(|expected: &[u8; 32]| secret_matches(&candidate, expected));
    if stored_protocol != i32::from(protocol_version)
        || stored_generation != session_generation as i64
        || protocol_version != MT5_VM_CONTROL_PROTOCOL_VERSION
        || !token_valid
    {
        return Err(ApiError::unauthorized(
            "MT5 VM worker session is fenced or invalid",
        ));
    }
    if !heartbeat_valid {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "MT5_VM_WORKER_SESSION_EXPIRED",
            "worker heartbeat lease expired; enroll a new session",
        ));
    }
    Ok(WorkerAuth {
        protocol_version,
        session_generation,
        capacity: row
            .try_get::<i32, _>("capacity")
            .map_err(|error| ApiError::database("decode worker capacity", error))?
            as u16,
    })
}

async fn worker_bind_ea_bootstrap(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<WorkerEaBootstrapBindRequest>,
) -> Result<Json<WorkerEaBootstrapBindResponse>, ApiError> {
    validate_session_envelope(
        &request.worker_id,
        request.session_generation,
        request.protocol_version,
    )?;
    let token_hash = decode_lower_hex_32(&request.pairing_token_sha256).ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "MANAGED_EA_RUNTIME_BINDING_INVALID",
            "managed EA runtime binding is invalid",
        )
    })?;
    if !valid_identifier(&request.account_id)
        || !valid_identifier(&request.slot_id)
        || request.lease_generation == 0
        || request.connection_revision == 0
        || request.terminal_pid == 0
        || !valid_ea_gateway_origin(&request.gateway_origin)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "MANAGED_EA_RUNTIME_BINDING_INVALID",
            "managed EA runtime binding is invalid",
        ));
    }

    let database = database(&state)?;
    let mut transaction = database
        .begin()
        .await
        .map_err(|error| ApiError::database("begin managed EA runtime binding", error))?;
    authenticate_worker(
        &mut transaction,
        &headers,
        &request.worker_id,
        request.session_generation,
        request.protocol_version,
    )
    .await?;
    let row = sqlx_core::query::query(
        r#"
        SELECT outcome, idempotent
        FROM execution_bind_mt5_managed_ea_bootstrap(
          $1, $2, $3, $4, $5, $6, $7, $8, $9
        )
        "#,
    )
    .bind(token_hash.to_vec())
    .bind(&request.worker_id)
    .bind(request.session_generation as i64)
    .bind(&request.account_id)
    .bind(request.lease_generation as i64)
    .bind(request.connection_revision as i64)
    .bind(&request.slot_id)
    .bind(i64::from(request.terminal_pid))
    .bind(&request.gateway_origin)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("bind managed EA runtime", error))?;
    let outcome: String = row
        .try_get("outcome")
        .map_err(|error| ApiError::database("decode managed EA runtime binding", error))?;
    let idempotent: bool = row
        .try_get("idempotent")
        .map_err(|error| ApiError::database("decode managed EA runtime idempotency", error))?;
    if outcome != "bound" {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "MANAGED_EA_RUNTIME_BINDING_FENCED",
            "managed EA runtime binding is no longer active",
        ));
    }
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit managed EA runtime binding", error))?;
    Ok(Json(WorkerEaBootstrapBindResponse {
        bound: true,
        idempotent,
        server_time_ms: now_ms(),
    }))
}

pub(super) fn validate_session_envelope(
    worker_id: &str,
    session_generation: u64,
    protocol_version: u16,
) -> Result<(), ApiError> {
    if !valid_identifier(worker_id)
        || session_generation == 0
        || protocol_version != MT5_VM_CONTROL_PROTOCOL_VERSION
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "MT5_VM_WORKER_REQUEST_INVALID",
            "worker identity, session generation, or protocol is invalid",
        ));
    }
    Ok(())
}

async fn worker_heartbeat(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<WorkerHeartbeatRequest>,
) -> Result<Json<WorkerHeartbeatResponse>, ApiError> {
    validate_session_envelope(
        &request.worker_id,
        request.session_generation,
        request.protocol_version,
    )?;
    let database = database(&state)?;
    let mut transaction = database
        .begin()
        .await
        .map_err(|error| ApiError::database("begin worker heartbeat", error))?;
    let auth = authenticate_worker(
        &mut transaction,
        &headers,
        &request.worker_id,
        request.session_generation,
        request.protocol_version,
    )
    .await?;
    if request.leases.len() > usize::from(auth.capacity) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "MT5_VM_HEARTBEAT_CAPACITY_EXCEEDED",
            "heartbeat reports more leases than worker capacity",
        ));
    }
    let mut unique = HashSet::with_capacity(request.leases.len());
    for lease in &request.leases {
        if !valid_identifier(&lease.account_id)
            || lease.lease_generation == 0
            || !unique.insert(lease.account_id.as_str())
        {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "MT5_VM_HEARTBEAT_LEASE_INVALID",
                "heartbeat lease claims must be unique and valid",
            ));
        }
        let renewed = sqlx_core::query::query(
            r#"
            UPDATE execution_mt5_vm_account_leases
            SET expires_at = now() + interval '45 seconds', renewed_at = now()
            WHERE account_id = $1
              AND worker_id = $2
              AND worker_session_generation = $3
              AND generation = $4
              AND status = 'active'
              AND expires_at > now()
            "#,
        )
        .bind(&lease.account_id)
        .bind(&request.worker_id)
        .bind(auth.session_generation as i64)
        .bind(lease.lease_generation as i64)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("renew account lease", error))?;
        if renewed.rows_affected() != 1 {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "MT5_VM_LEASE_FENCED",
                "heartbeat contains a stale or expired account lease",
            ));
        }
        sqlx_core::query::query(
            r#"
            UPDATE execution_mt5_vm_accounts
            SET last_heartbeat_at = now()
            WHERE account_id = $1 AND worker_id = $2 AND lease_generation = $3
            "#,
        )
        .bind(&lease.account_id)
        .bind(&request.worker_id)
        .bind(lease.lease_generation as i64)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("update account heartbeat", error))?;
    }
    sqlx_core::query::query(
        r#"
        UPDATE execution_mt5_vm_workers
        SET status = CASE WHEN drain THEN 'draining' ELSE 'healthy' END,
            last_heartbeat_at = now(),
            heartbeat_expires_at = now() + interval '45 seconds'
        WHERE worker_id = $1 AND session_generation = $2
        "#,
    )
    .bind(&request.worker_id)
    .bind(auth.session_generation as i64)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("update worker heartbeat", error))?;
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit worker heartbeat", error))?;
    Ok(Json(WorkerHeartbeatResponse {
        ok: true,
        server_time_ms: now_ms(),
        next_heartbeat_in_ms: HEARTBEAT_INTERVAL_MS,
        lease_ttl_ms: LEASE_TTL_MS,
    }))
}

async fn worker_poll(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<WorkerPollRequest>,
) -> Result<Json<WorkerPollResponse>, ApiError> {
    validate_session_envelope(
        &request.worker_id,
        request.session_generation,
        request.protocol_version,
    )?;
    let max_commands = request
        .max_commands
        .unwrap_or(MT5_VM_MAX_COMMANDS_PER_POLL)
        .clamp(1, MT5_VM_MAX_COMMANDS_PER_POLL);
    let database = database(&state)?;
    let mut transaction = database
        .begin()
        .await
        .map_err(|error| ApiError::database("begin worker poll", error))?;
    let auth = authenticate_worker(
        &mut transaction,
        &headers,
        &request.worker_id,
        request.session_generation,
        request.protocol_version,
    )
    .await?;
    sqlx_core::query::query(
        r#"
        UPDATE execution_mt5_vm_control_commands
        SET status = 'expired', completed_at = now(), dispatch_lease_until = NULL,
            error_code = 'COMMAND_EXPIRED'
        WHERE worker_id = $1
          AND status IN ('queued', 'dispatched', 'received')
          AND expires_at <= now()
        "#,
    )
    .bind(&request.worker_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("expire worker commands", error))?;
    let rows = sqlx_core::query::query(
        r#"
        WITH candidates AS (
          SELECT command.id
          FROM execution_mt5_vm_control_commands command
          JOIN execution_mt5_vm_account_leases lease
            ON lease.account_id = command.account_id
          WHERE command.worker_id = $1
            AND command.worker_session_generation = $2
            AND command.protocol_version = $3
            AND command.status IN ('queued', 'dispatched')
            AND command.available_at <= now()
            AND command.expires_at > now()
            AND (
              command.status = 'queued' OR command.dispatch_lease_until <= now()
            )
            AND lease.worker_id = command.worker_id
            AND lease.worker_session_generation = command.worker_session_generation
            AND lease.generation = command.lease_generation
            AND lease.status = 'active'
            AND lease.expires_at > now()
          ORDER BY command.created_at, command.id
          FOR UPDATE OF command SKIP LOCKED
          LIMIT $4
        )
        UPDATE execution_mt5_vm_control_commands command
        SET status = 'dispatched',
            attempt_count = command.attempt_count + 1,
            dispatch_lease_until = now() + interval '15 seconds',
            dispatched_at = COALESCE(command.dispatched_at, now())
        FROM candidates
        WHERE command.id = candidates.id
        RETURNING command.id, command.message_id, command.user_id, command.account_id,
                  command.lease_generation, command.command_kind, command.payload,
                  (extract(epoch from command.expires_at) * 1000)::bigint AS expires_at_ms
        "#,
    )
    .bind(&request.worker_id)
    .bind(auth.session_generation as i64)
    .bind(i32::from(auth.protocol_version))
    .bind(i64::from(max_commands))
    .fetch_all(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("lease worker commands", error))?;
    let mut credential_grants = HashMap::new();
    let mut ea_bootstrap_tokens = HashMap::new();
    for row in &rows {
        let command_kind: String = row
            .try_get("command_kind")
            .map_err(|error| ApiError::database("decode command grant kind", error))?;
        if command_kind != WorkerCommandKind::ProvisionAccount.as_str() {
            continue;
        }
        let command_id: Uuid = row
            .try_get("id")
            .map_err(|error| ApiError::database("decode command grant id", error))?;
        let owner_id: Uuid = row
            .try_get("user_id")
            .map_err(|error| ApiError::database("decode command grant owner", error))?;
        let account_id: String = row
            .try_get("account_id")
            .map_err(|error| ApiError::database("decode command grant account", error))?;
        let lease_generation: i64 = row
            .try_get("lease_generation")
            .map_err(|error| ApiError::database("decode command grant lease", error))?;
        let raw_token = random_token();
        let token_hash = sha256(raw_token.as_bytes());
        let issued = sqlx_core::query::query(
            r#"
            INSERT INTO execution_mt5_vm_credential_grants (
              user_id, account_id, command_id, worker_id,
              worker_session_generation, lease_generation,
              grant_token_hash, status, expires_at, issued_at, consumed_at
            )
            SELECT $1, $2, $3, $4, $5, $6, $7, 'issued',
                   LEAST(command.expires_at, now() + interval '30 seconds'),
                   now(), NULL
            FROM execution_mt5_vm_control_commands command
            JOIN execution_accounts registry
              ON registry.user_id = command.user_id AND registry.id = command.account_id
            WHERE command.id = $3 AND registry.connector_kind = 'windows_vm'
              AND registry.secret_ref IS NOT NULL
            ON CONFLICT (command_id) DO UPDATE SET
              worker_id = EXCLUDED.worker_id,
              worker_session_generation = EXCLUDED.worker_session_generation,
              lease_generation = EXCLUDED.lease_generation,
              grant_token_hash = EXCLUDED.grant_token_hash,
              status = 'issued', expires_at = EXCLUDED.expires_at,
              issued_at = now(), consumed_at = NULL
            RETURNING command_id
            "#,
        )
        .bind(owner_id)
        .bind(&account_id)
        .bind(command_id)
        .bind(&request.worker_id)
        .bind(auth.session_generation as i64)
        .bind(lease_generation)
        .bind(token_hash.to_vec())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("issue MT5 credential grant", error))?;
        if issued.is_some() {
            credential_grants.insert(command_id, raw_token);

            let raw_ea_token = random_token();
            sqlx_core::query::query(
                r#"
                UPDATE execution_pairing_tokens token
                SET consumed_at = now()
                FROM execution_mt5_vm_control_commands command
                WHERE command.id = $1
                  AND token.managed_account_id = command.account_id
                  AND token.managed_worker_id = command.worker_id
                  AND token.worker_session_generation = command.worker_session_generation
                  AND token.lease_generation = command.lease_generation
                  AND token.consumed_at IS NULL
                "#,
            )
            .bind(command_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("revoke prior managed EA bootstrap", error))?;
            let ea_token_issued = sqlx_core::query::query(
                r#"
                INSERT INTO execution_pairing_tokens (
                  user_id, token_hash, expires_at, managed_account_id,
                  managed_worker_id, worker_session_generation, lease_generation,
                  connection_revision, masked_login_suffix,
                  identity_fingerprint
                )
                SELECT command.user_id, $2,
                       LEAST(command.expires_at, now() + interval '2 minutes'),
                       command.account_id, command.worker_id,
                       command.worker_session_generation, command.lease_generation,
                       account.connection_revision, account.masked_login_suffix,
                       account.identity_fingerprint
                FROM execution_mt5_vm_control_commands command
                JOIN execution_mt5_vm_accounts account
                  ON account.user_id = command.user_id AND account.account_id = command.account_id
                JOIN execution_mt5_vm_workers worker
                  ON worker.worker_id = command.worker_id
                JOIN execution_mt5_vm_account_leases lease
                  ON lease.account_id = command.account_id
                WHERE command.id = $1
                  AND worker.worker_substrate = 'bare_metal'
                  AND worker.session_generation = command.worker_session_generation
                  AND account.connection_revision > 0
                  AND account.identity_fingerprint IS NOT NULL
                  AND account.disconnect_requested_revision IS NULL
                  AND account.worker_id = command.worker_id
                  AND account.lease_generation = command.lease_generation
                  AND lease.worker_id = command.worker_id
                  AND lease.worker_session_generation = command.worker_session_generation
                  AND lease.generation = command.lease_generation
                  AND lease.status = 'active' AND lease.expires_at > now()
                RETURNING id
                "#,
            )
            .bind(command_id)
            .bind(sha256(raw_ea_token.as_bytes()).to_vec())
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|error| ApiError::database("issue managed EA bootstrap", error))?;
            if ea_token_issued.is_some() {
                ea_bootstrap_tokens.insert(command_id, raw_ea_token);
            }
        }
    }
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit worker poll", error))?;
    let sent_at_ms = now_ms();
    let mut commands = Vec::with_capacity(rows.len());
    for row in rows {
        let kind = parse_command_kind(
            &row.try_get::<String, _>("command_kind")
                .map_err(|error| ApiError::database("decode command kind", error))?,
        )?;
        let payload = row
            .try_get::<sqlx_core::types::Json<Value>, _>("payload")
            .map_err(|error| ApiError::database("decode command payload", error))?
            .0;
        if !payload_is_safe(&payload) {
            return Err(ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "MT5_VM_COMMAND_PAYLOAD_UNSAFE",
                "durable worker command payload failed the secret boundary",
            ));
        }
        let command_id = row
            .try_get::<Uuid, _>("id")
            .map_err(|error| ApiError::database("decode command id", error))?;
        commands.push(WorkerControlCommand {
            protocol_version: auth.protocol_version,
            worker_id: request.worker_id.clone(),
            account_id: row
                .try_get("account_id")
                .map_err(|error| ApiError::database("decode command account", error))?,
            lease_generation: row
                .try_get::<i64, _>("lease_generation")
                .map_err(|error| ApiError::database("decode command lease", error))?
                as u64,
            command_id: command_id.to_string(),
            message_id: row
                .try_get::<Uuid, _>("message_id")
                .map_err(|error| ApiError::database("decode command message id", error))?
                .to_string(),
            sent_at_ms,
            expires_at_ms: row
                .try_get::<i64, _>("expires_at_ms")
                .map_err(|error| ApiError::database("decode command expiry", error))?
                as u64,
            kind,
            payload_json: serde_json::to_string(&payload)
                .map_err(|error| ApiError::internal("encode worker command payload", error))?,
            credential_grant: credential_grants.remove(&command_id),
            ea_bootstrap_token: ea_bootstrap_tokens.remove(&command_id),
        });
    }
    Ok(Json(WorkerPollResponse {
        protocol_version: auth.protocol_version,
        server_time_ms: sent_at_ms,
        commands,
    }))
}

fn parse_command_kind(value: &str) -> Result<WorkerCommandKind, ApiError> {
    match value {
        "provision_account" => Ok(WorkerCommandKind::ProvisionAccount),
        "stop_account" => Ok(WorkerCommandKind::StopAccount),
        "reconcile_account" => Ok(WorkerCommandKind::ReconcileAccount),
        _ => Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "MT5_VM_COMMAND_KIND_INVALID",
            "durable worker command kind is invalid",
        )),
    }
}

fn valid_error_code(value: &str) -> bool {
    let value = value.as_bytes();
    !value.is_empty()
        && value.len() <= 64
        && value[0].is_ascii_uppercase()
        && value
            .iter()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || *byte == b'_')
}

fn payload_is_safe(value: &Value) -> bool {
    match value {
        Value::Object(fields) => fields.iter().all(|(key, value)| {
            let normalized_key = key
                .chars()
                .filter(char::is_ascii_alphanumeric)
                .flat_map(char::to_lowercase)
                .collect::<String>();
            ![
                "login",
                "password",
                "secret",
                "credential",
                "token",
                "authorization",
            ]
            .iter()
            .any(|sensitive| normalized_key.contains(sensitive))
                && payload_is_safe(value)
        }),
        Value::Array(values) => values.iter().all(payload_is_safe),
        _ => true,
    }
}

fn ack_target_status(current: &str, ack: WorkerCommandAckKind) -> Result<&'static str, ApiError> {
    match (current, ack) {
        ("dispatched", WorkerCommandAckKind::Received)
        | ("received", WorkerCommandAckKind::Received) => Ok("received"),
        ("dispatched" | "received", WorkerCommandAckKind::Succeeded)
        | ("succeeded", WorkerCommandAckKind::Succeeded) => Ok("succeeded"),
        ("dispatched" | "received", WorkerCommandAckKind::Failed)
        | ("failed", WorkerCommandAckKind::Failed) => Ok("failed"),
        ("succeeded", WorkerCommandAckKind::Received) => Ok("succeeded"),
        ("failed", WorkerCommandAckKind::Received) => Ok("failed"),
        _ => Err(ApiError::new(
            StatusCode::CONFLICT,
            "MT5_VM_COMMAND_ACK_CONFLICT",
            "worker acknowledgement conflicts with durable command state",
        )),
    }
}

#[cfg(test)]
fn reconciliation_complete(result: Option<&Value>) -> bool {
    result.is_some_and(|result| {
        result.get("ready").and_then(Value::as_bool) == Some(true)
            && result.get("accountSync").and_then(Value::as_bool) == Some(true)
            && result.get("portfolioSync").and_then(Value::as_bool) == Some(true)
            && result.get("instrumentSync").and_then(Value::as_bool) == Some(true)
    })
}

async fn worker_ack(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<WorkerCommandAckRequest>,
) -> Result<Json<WorkerCommandAckResponse>, ApiError> {
    validate_session_envelope(
        &request.worker_id,
        request.session_generation,
        request.protocol_version,
    )?;
    let parsed_result = request
        .result_json
        .as_deref()
        .map(serde_json::from_str::<Value>)
        .transpose()
        .map_err(|_| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "MT5_VM_COMMAND_ACK_INVALID",
                "worker acknowledgement result must be valid JSON",
            )
        })?;
    if !valid_identifier(&request.account_id)
        || request.lease_generation == 0
        || parsed_result
            .as_ref()
            .is_some_and(|value| !value.is_object())
        || parsed_result
            .as_ref()
            .is_some_and(|value| !payload_is_safe(value))
        || request
            .error_code
            .as_deref()
            .is_some_and(|value| !valid_error_code(value))
        || (request.ack == WorkerCommandAckKind::Received && parsed_result.is_some())
        || (request.ack == WorkerCommandAckKind::Failed && request.error_code.is_none())
        || (request.ack != WorkerCommandAckKind::Failed && request.error_code.is_some())
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "MT5_VM_COMMAND_ACK_INVALID",
            "worker acknowledgement payload is invalid",
        ));
    }
    let command_id = Uuid::parse_str(&request.command_id).map_err(|_| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "MT5_VM_COMMAND_ID_INVALID",
            "worker command id must be a UUID",
        )
    })?;
    let database = database(&state)?;
    let mut transaction = database
        .begin()
        .await
        .map_err(|error| ApiError::database("begin worker acknowledgement", error))?;
    let auth = authenticate_worker(
        &mut transaction,
        &headers,
        &request.worker_id,
        request.session_generation,
        request.protocol_version,
    )
    .await?;
    let row = sqlx_core::query::query(
        r#"
        SELECT command.user_id, command.account_id, command.worker_id,
               command.worker_session_generation, command.lease_generation,
               command.protocol_version, command.command_kind, command.status,
               command.result, command.error_code,
               lease.status AS lease_status, lease.expires_at > now() AS lease_valid
        FROM execution_mt5_vm_control_commands command
        JOIN execution_mt5_vm_account_leases lease
          ON lease.account_id = command.account_id
        WHERE command.id = $1
        FOR UPDATE OF command, lease
        "#,
    )
    .bind(command_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("load worker command acknowledgement", error))?
    .ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "MT5_VM_COMMAND_NOT_FOUND",
            "worker command was not found",
        )
    })?;
    let durable_account: String = row
        .try_get("account_id")
        .map_err(|error| ApiError::database("decode acknowledged account", error))?;
    let durable_worker: String = row
        .try_get("worker_id")
        .map_err(|error| ApiError::database("decode acknowledged worker", error))?;
    let durable_session: i64 = row
        .try_get("worker_session_generation")
        .map_err(|error| ApiError::database("decode acknowledged session", error))?;
    let durable_lease: i64 = row
        .try_get("lease_generation")
        .map_err(|error| ApiError::database("decode acknowledged lease", error))?;
    let lease_status: String = row
        .try_get("lease_status")
        .map_err(|error| ApiError::database("decode current lease status", error))?;
    let lease_valid: bool = row
        .try_get("lease_valid")
        .map_err(|error| ApiError::database("decode current lease expiry", error))?;
    if durable_account != request.account_id
        || durable_worker != request.worker_id
        || durable_session != auth.session_generation as i64
        || durable_lease != request.lease_generation as i64
        || lease_status != "active"
        || !lease_valid
    {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "MT5_VM_LEASE_FENCED",
            "worker acknowledgement belongs to a stale account lease",
        ));
    }
    let current_status: String = row
        .try_get("status")
        .map_err(|error| ApiError::database("decode command status", error))?;
    let target_status = ack_target_status(&current_status, request.ack)?;
    let current_result = row
        .try_get::<Option<sqlx_core::types::Json<Value>>, _>("result")
        .map_err(|error| ApiError::database("decode command result", error))?
        .map(|value| value.0);
    let current_error: Option<String> = row
        .try_get("error_code")
        .map_err(|error| ApiError::database("decode command error", error))?;
    if matches!(current_status.as_str(), "succeeded" | "failed")
        && request.ack == WorkerCommandAckKind::Received
    {
        transaction
            .commit()
            .await
            .map_err(|error| ApiError::database("commit late received acknowledgement", error))?;
        return Ok(Json(WorkerCommandAckResponse {
            command_id: request.command_id,
            status: current_status,
            server_time_ms: now_ms(),
        }));
    }
    if current_status == "succeeded" && current_result != parsed_result {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "MT5_VM_COMMAND_ACK_CONFLICT",
            "duplicate success acknowledgement changed its result",
        ));
    }
    if current_status == "failed" && current_error != request.error_code {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "MT5_VM_COMMAND_ACK_CONFLICT",
            "duplicate failure acknowledgement changed its error code",
        ));
    }
    let newly_terminal = !matches!(current_status.as_str(), "succeeded" | "failed")
        && matches!(target_status, "succeeded" | "failed");
    sqlx_core::query::query(
        r#"
        UPDATE execution_mt5_vm_control_commands
        SET status = $2,
            received_at = CASE
              WHEN $2 IN ('received', 'succeeded', 'failed') THEN COALESCE(received_at, now())
              ELSE received_at
            END,
            completed_at = CASE WHEN $2 IN ('succeeded', 'failed') THEN now() ELSE NULL END,
            dispatch_lease_until = CASE
              WHEN $2 IN ('succeeded', 'failed') THEN NULL ELSE dispatch_lease_until
            END,
            result = CASE WHEN $2 = 'succeeded' THEN $3 ELSE result END,
            error_code = CASE WHEN $2 = 'failed' THEN $4 ELSE error_code END
        WHERE id = $1
        "#,
    )
    .bind(command_id)
    .bind(target_status)
    .bind(parsed_result.clone().map(sqlx_core::types::Json))
    .bind(request.error_code.as_deref())
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("persist worker acknowledgement", error))?;

    if newly_terminal {
        let user_id: Uuid = row
            .try_get("user_id")
            .map_err(|error| ApiError::database("decode command owner", error))?;
        let command_kind: String = row
            .try_get("command_kind")
            .map_err(|error| ApiError::database("decode acknowledged command kind", error))?;
        apply_terminal_ack(
            &mut transaction,
            user_id,
            &request,
            &command_kind,
            target_status,
            parsed_result.as_ref(),
        )
        .await?;
    }
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit worker acknowledgement", error))?;
    Ok(Json(WorkerCommandAckResponse {
        command_id: request.command_id,
        status: target_status.into(),
        server_time_ms: now_ms(),
    }))
}

async fn apply_terminal_ack(
    transaction: &mut sqlx_core::transaction::Transaction<'_, Postgres>,
    user_id: Uuid,
    request: &WorkerCommandAckRequest,
    command_kind: &str,
    target_status: &str,
    _result: Option<&Value>,
) -> Result<(), ApiError> {
    if target_status == "failed" {
        sqlx_core::query::query(
            r#"
            UPDATE execution_mt5_vm_accounts
            SET connection_status = 'degraded', connection_revision = connection_revision + 1,
                last_error_code = $4
            WHERE user_id = $1 AND account_id = $2
              AND worker_id = $3 AND lease_generation = $5
              AND disconnect_requested_revision IS NULL
            "#,
        )
        .bind(user_id)
        .bind(&request.account_id)
        .bind(&request.worker_id)
        .bind(request.error_code.as_deref())
        .bind(request.lease_generation as i64)
        .execute(&mut **transaction)
        .await
        .map_err(|error| ApiError::database("degrade failed MT5 VM account", error))?;
        return Ok(());
    }
    match command_kind {
        "provision_account" => {
            let advanced = sqlx_core::query::query(
                r#"
                UPDATE execution_mt5_vm_accounts
                SET connection_status = 'synchronizing',
                    connection_revision = connection_revision + 1,
                    last_error_code = NULL
                WHERE user_id = $1 AND account_id = $2
                  AND worker_id = $3 AND lease_generation = $4
                  AND disconnect_requested_revision IS NULL
                "#,
            )
            .bind(user_id)
            .bind(&request.account_id)
            .bind(&request.worker_id)
            .bind(request.lease_generation as i64)
            .execute(&mut **transaction)
            .await
            .map_err(|error| ApiError::database("advance provisioned account", error))?;
            if advanced.rows_affected() != 1 {
                return Ok(());
            }
            sqlx_core::query::query(
                r#"
                INSERT INTO execution_mt5_vm_control_commands (
                  user_id, account_id, worker_id, worker_session_generation,
                  lease_generation, protocol_version, idempotency_key,
                  command_kind, payload, expires_at
                )
                VALUES (
                  $1, $2, $3, $4, $5, $6, $7,
                  'reconcile_account', '{}'::jsonb, now() + interval '5 minutes'
                )
                ON CONFLICT (idempotency_key) DO NOTHING
                "#,
            )
            .bind(user_id)
            .bind(&request.account_id)
            .bind(&request.worker_id)
            .bind(request.session_generation as i64)
            .bind(request.lease_generation as i64)
            .bind(i32::from(request.protocol_version))
            .bind(format!(
                "reconcile:{}:{}",
                request.account_id, request.lease_generation
            ))
            .execute(&mut **transaction)
            .await
            .map_err(|error| ApiError::database("queue initial reconciliation", error))?;
        }
        "reconcile_account" => {
            // Phase 4 owns readiness. A lifecycle acknowledgement may prove
            // that the adapter ran, but it cannot claim synchronized account,
            // portfolio, and instrument evidence without the fenced snapshot
            // transactions in mt5_vm_sync.
            sqlx_core::query::query(
                r#"
                UPDATE execution_mt5_vm_accounts account
                SET connection_status = 'synchronizing',
                    connection_revision = CASE
                      WHEN worker.worker_substrate = 'bare_metal'
                        THEN account.connection_revision
                      ELSE account.connection_revision + 1
                    END,
                    last_error_code = NULL
                FROM execution_mt5_vm_workers worker
                WHERE account.user_id = $1 AND account.account_id = $2
                  AND account.worker_id = $3 AND account.lease_generation = $4
                  AND worker.worker_id = account.worker_id
                  AND account.disconnect_requested_revision IS NULL
                "#,
            )
            .bind(user_id)
            .bind(&request.account_id)
            .bind(&request.worker_id)
            .bind(request.lease_generation as i64)
            .execute(&mut **transaction)
            .await
            .map_err(|error| ApiError::database("apply account reconciliation", error))?;
        }
        "stop_account" => {
            sqlx_core::query::query(
                r#"
                UPDATE execution_mt5_vm_account_leases
                SET status = 'released', released_at = now(), release_reason = 'ACCOUNT_STOPPED'
                WHERE account_id = $1 AND worker_id = $2 AND generation = $3
                  AND status = 'active'
                "#,
            )
            .bind(&request.account_id)
            .bind(&request.worker_id)
            .bind(request.lease_generation as i64)
            .execute(&mut **transaction)
            .await
            .map_err(|error| ApiError::database("release stopped account lease", error))?;
            sqlx_core::query::query(
                r#"
                UPDATE execution_mt5_vm_accounts
                SET connection_status = 'disconnected', worker_id = NULL,
                    last_error_code = NULL
                WHERE user_id = $1 AND account_id = $2 AND lease_generation = $3
                  AND (
                    disconnect_requested_revision IS NOT NULL OR
                    removal_requested_at IS NOT NULL
                  )
                "#,
            )
            .bind(user_id)
            .bind(&request.account_id)
            .bind(request.lease_generation as i64)
            .execute(&mut **transaction)
            .await
            .map_err(|error| ApiError::database("disconnect stopped account", error))?;
            sqlx_core::query::query(
                r#"
                UPDATE execution_accounts
                SET status = 'offline', trade_allowed = false, updated_at = now()
                WHERE user_id = $1 AND id = $2 AND connector_kind = 'windows_vm'
                "#,
            )
            .bind(user_id)
            .bind(&request.account_id)
            .execute(&mut **transaction)
            .await
            .map_err(|error| ApiError::database("publish stopped account offline", error))?;
            sqlx_core::query::query(
                r#"
                UPDATE execution_mt5_vm_control_commands
                SET status = 'fenced', completed_at = now(), dispatch_lease_until = NULL,
                    error_code = 'ACCOUNT_STOPPED'
                WHERE account_id = $1 AND lease_generation = $2
                  AND command_kind <> 'stop_account'
                  AND status IN ('queued', 'dispatched', 'received')
                "#,
            )
            .bind(&request.account_id)
            .bind(request.lease_generation as i64)
            .execute(&mut **transaction)
            .await
            .map_err(|error| ApiError::database("fence stopped account commands", error))?;
        }
        _ => {
            return Err(ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "MT5_VM_COMMAND_KIND_INVALID",
                "acknowledged command kind is invalid",
            ));
        }
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdminControlCommandRequest {
    owner_id: String,
    account_id: String,
    lease_generation: u64,
    idempotency_key: String,
    kind: WorkerCommandKind,
    #[serde(default)]
    payload: Value,
    #[serde(default)]
    expires_in_seconds: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminControlCommandResponse {
    command_id: String,
    status: String,
}

async fn queue_admin_command(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<AdminControlCommandRequest>,
) -> Result<(StatusCode, Json<AdminControlCommandResponse>), ApiError> {
    require_admin(&state, &headers)?;
    let owner_id = parse_owner_id(&request.owner_id)?;
    let ttl = request
        .expires_in_seconds
        .unwrap_or(DEFAULT_COMMAND_TTL_SECONDS);
    if !valid_identifier(&request.account_id)
        || request.lease_generation == 0
        || !(1..=192).contains(&request.idempotency_key.len())
        || request.idempotency_key.chars().any(char::is_control)
        || !matches!(
            request.kind,
            WorkerCommandKind::StopAccount | WorkerCommandKind::ReconcileAccount
        )
        || !request.payload.is_object()
        || !payload_is_safe(&request.payload)
        || !(5..=MAX_COMMAND_TTL_SECONDS).contains(&ttl)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "MT5_VM_ADMIN_COMMAND_INVALID",
            "admin lifecycle command is invalid or contains sensitive data",
        ));
    }
    let database = database(&state)?;
    let mut transaction = database
        .begin()
        .await
        .map_err(|error| ApiError::database("begin admin lifecycle command", error))?;
    let lease = sqlx_core::query::query(
        r#"
        SELECT lease.worker_id, lease.worker_session_generation,
               worker.protocol_version
        FROM execution_mt5_vm_accounts account
        JOIN execution_accounts registry
          ON registry.user_id = account.user_id
         AND registry.id = account.account_id
        JOIN execution_mt5_vm_account_leases lease
          ON lease.account_id = account.account_id
        JOIN execution_mt5_vm_workers worker
          ON worker.worker_id = lease.worker_id
        WHERE account.user_id = $1
          AND account.account_id = $2
          AND registry.connector_kind = 'windows_vm'
          AND registry.venue_kind = 'metatrader5'
          AND lease.generation = $3
          AND lease.status = 'active'
          AND lease.expires_at > now()
          AND worker.session_generation = lease.worker_session_generation
          AND worker.heartbeat_expires_at > now()
        FOR UPDATE OF lease
        "#,
    )
    .bind(owner_id)
    .bind(&request.account_id)
    .bind(request.lease_generation as i64)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("load lifecycle command lease", error))?
    .ok_or_else(|| {
        ApiError::new(
            StatusCode::CONFLICT,
            "MT5_VM_LEASE_UNAVAILABLE",
            "account has no active matching worker lease",
        )
    })?;
    let worker_id: String = lease
        .try_get("worker_id")
        .map_err(|error| ApiError::database("decode lifecycle command worker", error))?;
    let worker_session_generation: i64 = lease
        .try_get("worker_session_generation")
        .map_err(|error| ApiError::database("decode lifecycle worker session", error))?;
    let protocol_version: i32 = lease
        .try_get("protocol_version")
        .map_err(|error| ApiError::database("decode lifecycle protocol", error))?;
    let inserted = sqlx_core::query::query(
        r#"
        INSERT INTO execution_mt5_vm_control_commands (
          user_id, account_id, worker_id, worker_session_generation,
          lease_generation, protocol_version, idempotency_key,
          command_kind, payload, expires_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          now() + ($10 * interval '1 second')
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id, status
        "#,
    )
    .bind(owner_id)
    .bind(&request.account_id)
    .bind(&worker_id)
    .bind(worker_session_generation)
    .bind(request.lease_generation as i64)
    .bind(protocol_version)
    .bind(&request.idempotency_key)
    .bind(request.kind.as_str())
    .bind(sqlx_core::types::Json(request.payload.clone()))
    .bind(ttl as i64)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("insert lifecycle command", error))?;
    let (command_id, status, created) = if let Some(row) = inserted {
        (
            row.try_get::<Uuid, _>("id")
                .map_err(|error| ApiError::database("decode lifecycle command id", error))?,
            row.try_get::<String, _>("status")
                .map_err(|error| ApiError::database("decode lifecycle command status", error))?,
            true,
        )
    } else {
        let row = sqlx_core::query::query(
            r#"
            SELECT id, account_id, lease_generation, command_kind, payload, status
            FROM execution_mt5_vm_control_commands
            WHERE idempotency_key = $1
            "#,
        )
        .bind(&request.idempotency_key)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("load idempotent lifecycle command", error))?;
        let existing_payload = row
            .try_get::<sqlx_core::types::Json<Value>, _>("payload")
            .map_err(|error| ApiError::database("decode idempotent payload", error))?
            .0;
        if row.try_get::<String, _>("account_id").ok().as_deref()
            != Some(request.account_id.as_str())
            || row.try_get::<i64, _>("lease_generation").ok()
                != Some(request.lease_generation as i64)
            || row.try_get::<String, _>("command_kind").ok().as_deref()
                != Some(request.kind.as_str())
            || existing_payload != request.payload
        {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "MT5_VM_IDEMPOTENCY_CONFLICT",
                "idempotency key belongs to a different lifecycle command",
            ));
        }
        (
            row.try_get::<Uuid, _>("id")
                .map_err(|error| ApiError::database("decode idempotent command id", error))?,
            row.try_get::<String, _>("status")
                .map_err(|error| ApiError::database("decode idempotent command status", error))?,
            false,
        )
    };
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit lifecycle command", error))?;
    Ok((
        if created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        Json(AdminControlCommandResponse {
            command_id: command_id.to_string(),
            status,
        }),
    ))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerRegistryView {
    worker_id: String,
    protocol_version: u16,
    session_generation: u64,
    agent_version: String,
    image_version: String,
    runtime_version: String,
    capacity: u16,
    active_leases: u16,
    region: String,
    status: String,
    drain: bool,
    last_heartbeat_at_ms: u64,
    heartbeat_expires_at_ms: u64,
}

async fn list_workers(
    State(state): State<GatewayState>,
    headers: HeaderMap,
) -> Result<Json<Vec<WorkerRegistryView>>, ApiError> {
    require_admin(&state, &headers)?;
    let rows = sqlx_core::query::query(
        r#"
        SELECT worker.worker_id, worker.protocol_version, worker.session_generation,
               worker.agent_version, worker.image_version, worker.runtime_version,
               worker.capacity, worker.region, worker.status, worker.drain,
               (extract(epoch from worker.last_heartbeat_at) * 1000)::bigint
                 AS last_heartbeat_at_ms,
               (extract(epoch from worker.heartbeat_expires_at) * 1000)::bigint
                 AS heartbeat_expires_at_ms,
               COUNT(lease.account_id) FILTER (
                 WHERE lease.status = 'active' AND lease.expires_at > now()
               )::bigint AS active_leases
        FROM execution_mt5_vm_workers worker
        LEFT JOIN execution_mt5_vm_account_leases lease
          ON lease.worker_id = worker.worker_id
        GROUP BY worker.worker_id
        ORDER BY worker.worker_id
        "#,
    )
    .fetch_all(database(&state)?)
    .await
    .map_err(|error| ApiError::database("list MT5 VM workers", error))?;
    rows.into_iter()
        .map(|row| {
            Ok(WorkerRegistryView {
                worker_id: row
                    .try_get("worker_id")
                    .map_err(|error| ApiError::database("decode worker id", error))?,
                protocol_version: row
                    .try_get::<i32, _>("protocol_version")
                    .map_err(|error| ApiError::database("decode worker protocol", error))?
                    as u16,
                session_generation: row
                    .try_get::<i64, _>("session_generation")
                    .map_err(|error| ApiError::database("decode worker generation", error))?
                    as u64,
                agent_version: row
                    .try_get("agent_version")
                    .map_err(|error| ApiError::database("decode agent version", error))?,
                image_version: row
                    .try_get("image_version")
                    .map_err(|error| ApiError::database("decode image version", error))?,
                runtime_version: row
                    .try_get("runtime_version")
                    .map_err(|error| ApiError::database("decode runtime version", error))?,
                capacity: row
                    .try_get::<i32, _>("capacity")
                    .map_err(|error| ApiError::database("decode worker capacity", error))?
                    as u16,
                active_leases: row
                    .try_get::<i64, _>("active_leases")
                    .map_err(|error| ApiError::database("decode active leases", error))?
                    as u16,
                region: row
                    .try_get("region")
                    .map_err(|error| ApiError::database("decode worker region", error))?,
                status: row
                    .try_get("status")
                    .map_err(|error| ApiError::database("decode worker status", error))?,
                drain: row
                    .try_get("drain")
                    .map_err(|error| ApiError::database("decode worker drain", error))?,
                last_heartbeat_at_ms: row
                    .try_get::<i64, _>("last_heartbeat_at_ms")
                    .map_err(|error| ApiError::database("decode worker heartbeat time", error))?
                    as u64,
                heartbeat_expires_at_ms: row
                    .try_get::<i64, _>("heartbeat_expires_at_ms")
                    .map_err(|error| ApiError::database("decode worker expiry time", error))?
                    as u64,
            })
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Json)
}

async fn scheduler_tick(state: &GatewayState) -> Result<usize, ApiError> {
    let database = database(state)?;
    expire_stale_state(database).await?;
    let mut scheduled = 0;
    while scheduled < MAX_SCHEDULE_PER_TICK && schedule_one(database).await? {
        scheduled += 1;
    }
    Ok(scheduled)
}

async fn expire_stale_state(database: &PgPool) -> Result<(), ApiError> {
    let mut transaction = database
        .begin()
        .await
        .map_err(|error| ApiError::database("begin stale worker sweep", error))?;
    sqlx_core::query::query(
        r#"
        UPDATE execution_mt5_vm_workers
        SET status = 'offline'
        WHERE heartbeat_expires_at <= now() AND status <> 'offline'
        "#,
    )
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("expire stale workers", error))?;
    sqlx_core::query::query(
        r#"
        WITH expired AS (
          UPDATE execution_mt5_vm_account_leases lease
          SET status = 'expired', released_at = now(),
              release_reason = 'WORKER_HEARTBEAT_LOST'
          FROM execution_mt5_vm_workers worker
          WHERE lease.worker_id = worker.worker_id
            AND lease.status = 'active'
            AND (
              lease.expires_at <= now()
              OR worker.status = 'offline'
              OR worker.heartbeat_expires_at <= now()
              OR worker.session_generation <> lease.worker_session_generation
            )
          RETURNING lease.account_id, lease.generation
        )
        UPDATE execution_mt5_vm_accounts account
        SET connection_status = CASE
              WHEN account.persistence_mode = 'managed' THEN 'reconnecting'
              ELSE 'credentials_required'
            END,
            worker_id = NULL,
            connection_revision = account.connection_revision + 1,
            last_error_code = 'WORKER_HEARTBEAT_LOST'
        FROM expired
        WHERE account.account_id = expired.account_id
          AND account.lease_generation = expired.generation
          AND account.disconnect_requested_revision IS NULL
        "#,
    )
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("expire stale account leases", error))?;
    sqlx_core::query::query(
        r#"
        UPDATE execution_mt5_vm_control_commands command
        SET status = CASE WHEN command.expires_at <= now() THEN 'expired' ELSE 'fenced' END,
            completed_at = now(), dispatch_lease_until = NULL,
            error_code = CASE
              WHEN command.expires_at <= now() THEN 'COMMAND_EXPIRED'
              ELSE 'LEASE_FENCED'
            END
        WHERE command.status IN ('queued', 'dispatched', 'received')
          AND (
            command.expires_at <= now()
            OR NOT EXISTS (
              SELECT 1
              FROM execution_mt5_vm_account_leases lease
              WHERE lease.account_id = command.account_id
                AND lease.worker_id = command.worker_id
                AND lease.worker_session_generation = command.worker_session_generation
                AND lease.generation = command.lease_generation
                AND lease.status = 'active'
                AND lease.expires_at > now()
            )
          )
        "#,
    )
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("fence stale lifecycle commands", error))?;
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit stale worker sweep", error))
}

async fn schedule_one(database: &PgPool) -> Result<bool, ApiError> {
    let mut transaction = database
        .begin()
        .await
        .map_err(|error| ApiError::database("begin MT5 VM placement", error))?;
    let Some(account) = sqlx_core::query::query(
        r#"
        SELECT account.user_id, account.account_id, account.required_protocol_version,
               account.required_runtime_version, account.connection_revision
        FROM execution_mt5_vm_accounts account
        JOIN execution_accounts registry
          ON registry.user_id = account.user_id
         AND registry.id = account.account_id
        WHERE account.connection_status IN ('queued', 'reconnecting')
          AND account.worker_id IS NULL
          AND account.disconnect_requested_revision IS NULL
          AND registry.connector_kind = 'windows_vm'
          AND registry.venue_kind = 'metatrader5'
          AND EXISTS (
            SELECT 1
            FROM execution_mt5_vm_workers worker
            WHERE worker.status = 'healthy'
              AND worker.drain = false
              AND worker.heartbeat_expires_at > now()
              AND worker.protocol_version = account.required_protocol_version
              AND (
                account.required_runtime_version IS NULL
                OR worker.runtime_version = account.required_runtime_version
              )
              AND (
                SELECT COUNT(*)
                FROM execution_mt5_vm_account_leases lease
                WHERE lease.worker_id = worker.worker_id
                  AND lease.status = 'active'
                  AND lease.expires_at > now()
              ) < LEAST(worker.capacity, 4)
          )
        ORDER BY account.updated_at, account.account_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
        "#,
    )
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("claim queued MT5 VM account", error))?
    else {
        transaction
            .commit()
            .await
            .map_err(|error| ApiError::database("commit empty placement", error))?;
        return Ok(false);
    };
    let user_id: Uuid = account
        .try_get("user_id")
        .map_err(|error| ApiError::database("decode placement owner", error))?;
    let account_id: String = account
        .try_get("account_id")
        .map_err(|error| ApiError::database("decode placement account", error))?;
    let required_protocol: i32 = account
        .try_get("required_protocol_version")
        .map_err(|error| ApiError::database("decode placement protocol", error))?;
    let required_runtime: Option<String> = account
        .try_get("required_runtime_version")
        .map_err(|error| ApiError::database("decode placement runtime", error))?;
    let connection_revision: i64 = account
        .try_get("connection_revision")
        .map_err(|error| ApiError::database("decode connection revision", error))?;
    let worker = sqlx_core::query::query(
        r#"
        SELECT worker.worker_id, worker.session_generation,
               worker.protocol_version, worker.runtime_version
        FROM execution_mt5_vm_workers worker
        WHERE worker.status = 'healthy'
          AND worker.drain = false
          AND worker.heartbeat_expires_at > now()
          AND worker.protocol_version = $1
          AND ($2::text IS NULL OR worker.runtime_version = $2)
          AND (
            SELECT COUNT(*)
            FROM execution_mt5_vm_account_leases lease
            WHERE lease.worker_id = worker.worker_id
              AND lease.status = 'active'
              AND lease.expires_at > now()
          ) < LEAST(worker.capacity, 4)
        ORDER BY (
          SELECT COUNT(*)
          FROM execution_mt5_vm_account_leases lease
          WHERE lease.worker_id = worker.worker_id
            AND lease.status = 'active'
            AND lease.expires_at > now()
        ), worker.last_assigned_at NULLS FIRST, worker.worker_id
        FOR UPDATE OF worker SKIP LOCKED
        LIMIT 1
        "#,
    )
    .bind(required_protocol)
    .bind(required_runtime.as_deref())
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("select compatible MT5 VM worker", error))?;
    let Some(worker) = worker else {
        transaction
            .commit()
            .await
            .map_err(|error| ApiError::database("commit unavailable placement", error))?;
        return Ok(false);
    };
    let worker_id: String = worker
        .try_get("worker_id")
        .map_err(|error| ApiError::database("decode placement worker", error))?;
    let worker_session_generation: i64 = worker
        .try_get("session_generation")
        .map_err(|error| ApiError::database("decode placement worker session", error))?;
    let protocol_version: i32 = worker
        .try_get("protocol_version")
        .map_err(|error| ApiError::database("decode placement worker protocol", error))?;
    let runtime_version: String = worker
        .try_get("runtime_version")
        .map_err(|error| ApiError::database("decode placement runtime version", error))?;
    let lease_generation = sqlx_core::query::query(
        r#"
        INSERT INTO execution_mt5_vm_account_leases (
          user_id, account_id, worker_id, worker_session_generation,
          generation, status, expires_at
        )
        VALUES ($1, $2, $3, $4, 1, 'active', now() + interval '45 seconds')
        ON CONFLICT (account_id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          worker_id = EXCLUDED.worker_id,
          worker_session_generation = EXCLUDED.worker_session_generation,
          generation = execution_mt5_vm_account_leases.generation + 1,
          status = 'active',
          expires_at = EXCLUDED.expires_at,
          acquired_at = now(),
          renewed_at = now(),
          released_at = NULL,
          release_reason = NULL
        RETURNING generation
        "#,
    )
    .bind(user_id)
    .bind(&account_id)
    .bind(&worker_id)
    .bind(worker_session_generation)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("acquire MT5 VM account lease", error))?
    .try_get::<i64, _>("generation")
    .map_err(|error| ApiError::database("decode account lease generation", error))?;
    let next_revision = connection_revision + 1;
    sqlx_core::query::query(
        r#"
        UPDATE execution_mt5_vm_accounts
        SET connection_status = 'provisioning', worker_id = $2,
            lease_generation = $3, connection_revision = $4,
            runtime_version = $5, last_error_code = NULL
        WHERE account_id = $1
        "#,
    )
    .bind(&account_id)
    .bind(&worker_id)
    .bind(lease_generation)
    .bind(next_revision)
    .bind(&runtime_version)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("bind MT5 VM account runtime", error))?;
    sqlx_core::query::query(
        "UPDATE execution_mt5_vm_workers SET last_assigned_at = now() WHERE worker_id = $1",
    )
    .bind(&worker_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("record worker placement", error))?;
    sqlx_core::query::query(
        r#"
        INSERT INTO execution_mt5_vm_control_commands (
          user_id, account_id, worker_id, worker_session_generation,
          lease_generation, protocol_version, idempotency_key,
          command_kind, payload, expires_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, 'provision_account', $8,
          now() + interval '5 minutes'
        )
        "#,
    )
    .bind(user_id)
    .bind(&account_id)
    .bind(&worker_id)
    .bind(worker_session_generation)
    .bind(lease_generation)
    .bind(protocol_version)
    .bind(format!("provision:{account_id}:{lease_generation}"))
    .bind(sqlx_core::types::Json(json!({
        "connectionRevision": next_revision
    })))
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("queue account provision", error))?;
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit MT5 VM placement", error))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AdminOrderTarget, ManagedEaPairingBinding, accept_events, poll_commands};
    use axum::http::HeaderValue;
    use execution_domain::mt5_vm_control::WorkerLeaseClaim;
    use execution_domain::{
        AccountId, AccountMode, CommandId, CopyAllocation, EXECUTION_PROTOCOL_VERSION,
        EaAccountSnapshot, EaEventBatch, EaManagedRuntimeBinding, EaSessionRequest, IdempotencyKey,
        OrderIntent, OrderKind, OrderSizing, QuantityUnit, Side,
    };
    use rust_decimal::Decimal;
    use std::collections::BTreeMap;

    const MANAGED_DATABASE_ADMIN_TOKEN: &str = "managed-database-admin-token-at-least-32-bytes";
    const MANAGED_DATABASE_BOOTSTRAP_TOKEN: &str =
        "managed-database-worker-bootstrap-token-at-least-32-bytes";

    async fn managed_database_state() -> GatewayState {
        let database_url = std::env::var("MT5_MANAGED_TEST_DATABASE_URL")
            .expect("the disposable PostgreSQL harness supplies a loopback database URL");
        let database = sqlx_postgres::PgPoolOptions::new()
            .max_connections(4)
            .connect(&database_url)
            .await
            .expect("connect to the disposable managed MT5 database");
        GatewayState::new_production(
            MANAGED_DATABASE_ADMIN_TOKEN,
            "stable-managed-database-identity-key-at-least-32-bytes",
            Some(MANAGED_DATABASE_BOOTSTRAP_TOKEN),
            database,
        )
    }

    fn worker_headers(session_token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {session_token}"))
                .expect("worker bearer header is valid"),
        );
        headers
    }

    fn lower_hex_32(value: &[u8; 32]) -> String {
        use std::fmt::Write;

        value
            .iter()
            .fold(String::with_capacity(64), |mut hex, byte| {
                write!(&mut hex, "{byte:02x}").expect("writing to a String cannot fail");
                hex
            })
    }

    fn managed_account_snapshot(login: &str, server: &str) -> EaAccountSnapshot {
        EaAccountSnapshot {
            login: login.into(),
            broker: "Synthetic Broker".into(),
            server: server.into(),
            mode: AccountMode::Demo,
            currency: "USD".into(),
            balance: Decimal::new(10_000, 0),
            equity: Decimal::new(10_000, 0),
            margin: Decimal::ZERO,
            free_margin: Decimal::new(10_000, 0),
            leverage: 100,
            trade_allowed: true,
            terminal_build: 5_000,
            ea_version: Some("1.26".into()),
        }
    }

    #[tokio::test]
    #[ignore = "run only inside the disposable PostgreSQL 17 harness"]
    async fn managed_database_worker_provision_bootstrap_and_reconcile_are_fenced_end_to_end() {
        let _ = tracing_subscriber::fmt().with_test_writer().try_init();
        let state = managed_database_state().await;
        let owner_id = Uuid::new_v4();
        let account_id = format!("account-{}", Uuid::new_v4().simple());
        let worker_id = format!("worker-{}", Uuid::new_v4().simple());
        let runtime_version = format!("test-{}", Uuid::new_v4().simple());
        let broker_login = "81234567";
        let broker_server = "Synthetic-Broker-Demo";
        let database = database(&state).expect("production state has a database");
        let mut invalid_auth_transaction = database.begin().await.expect("begin invalid auth");
        let invalid_auth = authenticate_worker_token(
            &mut invalid_auth_transaction,
            "short",
            "worker-invalid",
            1,
            MT5_VM_CONTROL_PROTOCOL_VERSION,
        )
        .await
        .expect_err("malformed session token fails before worker lookup");
        assert_eq!(StatusCode::UNAUTHORIZED, invalid_auth.status);
        invalid_auth_transaction
            .rollback()
            .await
            .expect("rollback invalid auth");
        let identity_fingerprint = crate::mt5_identity_fingerprint(
            &state.inner.mt5_identity_key,
            broker_login,
            broker_server,
        );
        let server_fingerprint =
            crate::mt5_server_fingerprint(&state.inner.mt5_identity_key, broker_server);

        sqlx_core::query::query(
            "INSERT INTO users (id, email, email_verified, display_name, status) \
             VALUES ($1, $2, true, 'Managed control owner', 'active')",
        )
        .bind(owner_id)
        .bind(format!("managed-control-{owner_id}@example.invalid"))
        .execute(database)
        .await
        .expect("seed an active disposable owner");
        sqlx_core::query::query(
            r#"
            INSERT INTO execution_accounts (
              id, user_id, venue_kind, broker_code, external_account_ref, server,
              label, mode, status, trade_allowed, secret_ref, connector_kind
            ) VALUES (
              $1, $2, 'metatrader5', 'mt5', $1, '', 'Synthetic managed account',
              'unknown', 'connecting', false, $3, 'windows_vm'
            )
            "#,
        )
        .bind(&account_id)
        .bind(owner_id)
        .bind(format!("mt5-{}", Uuid::new_v4().simple()))
        .execute(database)
        .await
        .expect("seed the opaque execution-account credential reference");
        sqlx_core::query::query(
            r#"
            INSERT INTO execution_mt5_vm_accounts (
              user_id, account_id, normalized_server, masked_login_suffix,
              persistence_mode, connection_status, connection_revision,
              identity_fingerprint, server_fingerprint, required_runtime_version
            ) VALUES ($1, $2, '', '4567', 'managed', 'queued', 1, $3, $4, $5)
            "#,
        )
        .bind(owner_id)
        .bind(&account_id)
        .bind(identity_fingerprint.to_vec())
        .bind(server_fingerprint.to_vec())
        .bind(&runtime_version)
        .execute(database)
        .await
        .expect("seed a schedulable managed account");

        let mut bootstrap_headers = HeaderMap::new();
        bootstrap_headers.insert(
            "x-mt5-vm-bootstrap-token",
            HeaderValue::from_static(MANAGED_DATABASE_BOOTSTRAP_TOKEN),
        );
        let Json(hello) = worker_hello(
            State(state.clone()),
            bootstrap_headers,
            Json(WorkerHelloRequest {
                worker_id: worker_id.clone(),
                protocol_min: MT5_VM_CONTROL_PROTOCOL_VERSION,
                protocol_max: MT5_VM_CONTROL_PROTOCOL_VERSION,
                agent_version: "1.0.0".into(),
                image_version: "2026.08.22".into(),
                runtime_version,
                capacity: MT5_VM_MAX_SCHEDULED_TERMINALS,
                region: "test-region".into(),
                capabilities: ["installed_slots".to_owned(), "bare_metal".to_owned()]
                    .into_iter()
                    .collect(),
            }),
        )
        .await
        .expect("enroll a bare-metal worker with a one-time bootstrap secret");
        assert_eq!(worker_id, hello.worker_id);
        assert_eq!(MT5_VM_CONTROL_PROTOCOL_VERSION, hello.protocol_version);

        let scheduled = scheduler_tick(&state)
            .await
            .expect("schedule all compatible queued accounts");
        assert!(scheduled >= 1);
        let assignment = sqlx_core::query::query(
            "SELECT worker_id, lease_generation, connection_revision \
             FROM execution_mt5_vm_accounts WHERE user_id = $1 AND account_id = $2",
        )
        .bind(owner_id)
        .bind(&account_id)
        .fetch_one(database)
        .await
        .expect("load the durable worker assignment");
        assert_eq!(
            worker_id,
            assignment
                .try_get::<String, _>("worker_id")
                .expect("decode assigned worker")
        );
        let lease_generation = assignment
            .try_get::<i64, _>("lease_generation")
            .expect("decode lease generation") as u64;
        let connection_revision = assignment
            .try_get::<i64, _>("connection_revision")
            .expect("decode connection revision") as u64;

        let Json(polled) = worker_poll(
            State(state.clone()),
            worker_headers(&hello.session_token),
            Json(WorkerPollRequest {
                protocol_version: hello.protocol_version,
                worker_id: worker_id.clone(),
                session_generation: hello.session_generation,
                max_commands: None,
            }),
        )
        .await
        .expect("lease the provision command to the authenticated worker");
        let provision = polled
            .commands
            .into_iter()
            .find(|command| command.account_id == account_id)
            .expect("the scheduled account has a provision command");
        assert_eq!(WorkerCommandKind::ProvisionAccount, provision.kind);
        let credential_grant = provision
            .credential_grant
            .clone()
            .expect("provisioning issues a one-time credential grant");
        let ea_bootstrap_token = provision
            .ea_bootstrap_token
            .expect("bare-metal provisioning issues a fenced EA bootstrap token");
        let pairing_token_sha256 = lower_hex_32(&sha256(ea_bootstrap_token.as_bytes()));

        let binding = WorkerEaBootstrapBindRequest {
            protocol_version: hello.protocol_version,
            worker_id: worker_id.clone(),
            session_generation: hello.session_generation,
            account_id: account_id.clone(),
            lease_generation,
            connection_revision,
            pairing_token_sha256,
            slot_id: "slot-01".into(),
            terminal_pid: 42_424,
            gateway_origin: "http://127.0.0.1:8790".into(),
        };
        let Json(first_binding) = worker_bind_ea_bootstrap(
            State(state.clone()),
            worker_headers(&hello.session_token),
            Json(binding.clone()),
        )
        .await
        .expect("bind the EA token to the exact worker, lease, revision, slot, and process");
        assert!(first_binding.bound);
        assert!(!first_binding.idempotent);
        let Json(retried_binding) = worker_bind_ea_bootstrap(
            State(state.clone()),
            worker_headers(&hello.session_token),
            Json(binding.clone()),
        )
        .await
        .expect("retry the identical runtime binding idempotently");
        assert!(retried_binding.bound);
        assert!(retried_binding.idempotent);
        let mut fenced_binding = binding;
        fenced_binding.terminal_pid += 1;
        let fenced = worker_bind_ea_bootstrap(
            State(state.clone()),
            worker_headers(&hello.session_token),
            Json(fenced_binding),
        )
        .await
        .expect_err("a changed terminal PID is fenced");
        assert_eq!("MANAGED_EA_RUNTIME_BINDING_FENCED", fenced.body.code);

        let ea_session = state
            .create_session(EaSessionRequest {
                protocol_version: EXECUTION_PROTOCOL_VERSION,
                pairing_token: ea_bootstrap_token,
                agent_id: "managed-ea-agent".into(),
                runtime_binding: Some(EaManagedRuntimeBinding {
                    slot_id: "slot-01".into(),
                    terminal_pid: 42_424,
                    gateway_origin: "http://127.0.0.1:8790".into(),
                }),
                account: managed_account_snapshot(broker_login, broker_server),
            })
            .await
            .expect("pair the bound managed EA session against the active assignment");
        assert_eq!(account_id, ea_session.account_id.as_str());
        let mut ea_headers = HeaderMap::new();
        ea_headers.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", ea_session.session_token))
                .expect("EA bearer header is valid"),
        );
        let authenticated = state
            .authenticate(&ea_headers)
            .await
            .expect("authenticate the managed EA session after pairing");
        assert_eq!(account_id, authenticated.account_id.as_str());

        let deferred_intent = OrderIntent {
            command_id: CommandId::new(format!("parent-{}", Uuid::new_v4().simple())),
            idempotency_key: IdempotencyKey::new(format!("intent-{}", Uuid::new_v4().simple())),
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
        };
        let deferred_target = AdminOrderTarget {
            account_id: AccountId::new(account_id.clone()),
            allocation: CopyAllocation::SameQuantity,
            max_quantity: None,
        };
        let (deferred_command_id, _) = state
            .defer_order(owner_id, &deferred_intent, &deferred_target)
            .await
            .expect("persist a waiting command for the active managed account");
        let Json(before_readiness) = poll_commands(State(state.clone()), ea_headers.clone())
            .await
            .expect("poll before the atomic readiness gate");
        assert!(
            before_readiness.commands.is_empty(),
            "a synchronizing managed account cannot receive the waiting command"
        );

        let replacement_pairing_token = random_token();
        state
            .insert_managed_pairing_token(
                &replacement_pairing_token,
                &owner_id.to_string(),
                Duration::from_secs(60),
                ManagedEaPairingBinding {
                    account_id: AccountId::new(account_id.clone()),
                    worker_id: worker_id.clone(),
                    worker_session_generation: hello.session_generation,
                    lease_generation,
                    connection_revision,
                    slot_id: "slot-01".into(),
                    terminal_pid: 42_424,
                    gateway_origin: "http://127.0.0.1:8790".into(),
                    masked_login_suffix: Some("4567".into()),
                    identity_fingerprint: identity_fingerprint.to_vec(),
                },
            )
            .await
            .expect("replace the durable managed pairing token only for the active assignment");
        let replacement_session = state
            .create_session(EaSessionRequest {
                protocol_version: EXECUTION_PROTOCOL_VERSION,
                pairing_token: replacement_pairing_token,
                agent_id: "managed-ea-agent-reconnected".into(),
                runtime_binding: Some(EaManagedRuntimeBinding {
                    slot_id: "slot-01".into(),
                    terminal_pid: 42_424,
                    gateway_origin: "http://127.0.0.1:8790".into(),
                }),
                account: managed_account_snapshot(broker_login, broker_server),
            })
            .await
            .expect("replace the prior EA session without changing the managed account identity");
        assert_eq!(account_id, replacement_session.account_id.as_str());
        assert_ne!(ea_session.session_token, replacement_session.session_token);

        let received = WorkerCommandAckRequest {
            protocol_version: hello.protocol_version,
            worker_id: worker_id.clone(),
            session_generation: hello.session_generation,
            account_id: account_id.clone(),
            lease_generation,
            command_id: provision.command_id.clone(),
            ack: WorkerCommandAckKind::Received,
            result_json: None,
            error_code: None,
        };
        let Json(received_ack) = worker_ack(
            State(state.clone()),
            worker_headers(&hello.session_token),
            Json(received),
        )
        .await
        .expect("acknowledge durable receipt of the provision command");
        assert_eq!("received", received_ack.status);
        let (consumed_secret_ref, consumed_persistence) =
            crate::mt5_vm_connections::consume_credential_grant_for_test(
                state.clone(),
                MANAGED_DATABASE_ADMIN_TOKEN,
                &hello.session_token,
                crate::mt5_vm_connections::TestCredentialGrantEnvelope {
                    protocol_version: hello.protocol_version,
                    worker_id: worker_id.clone(),
                    session_generation: hello.session_generation,
                    account_id: account_id.clone(),
                    lease_generation,
                    command_id: provision.command_id.clone(),
                    grant_token: credential_grant.clone(),
                },
            )
            .await
            .expect("consume the one-time grant only from the authenticated assigned worker");
        assert!(consumed_secret_ref.starts_with("mt5-"));
        assert_eq!("managed", consumed_persistence);
        let replay = crate::mt5_vm_connections::consume_credential_grant_for_test(
            state.clone(),
            MANAGED_DATABASE_ADMIN_TOKEN,
            &hello.session_token,
            crate::mt5_vm_connections::TestCredentialGrantEnvelope {
                protocol_version: hello.protocol_version,
                worker_id: worker_id.clone(),
                session_generation: hello.session_generation,
                account_id: account_id.clone(),
                lease_generation,
                command_id: provision.command_id.clone(),
                grant_token: credential_grant,
            },
        )
        .await
        .expect_err("a consumed credential grant cannot be replayed");
        assert_eq!(StatusCode::UNAUTHORIZED, replay.status);
        let Json(succeeded_ack) = worker_ack(
            State(state.clone()),
            worker_headers(&hello.session_token),
            Json(WorkerCommandAckRequest {
                protocol_version: hello.protocol_version,
                worker_id: worker_id.clone(),
                session_generation: hello.session_generation,
                account_id: account_id.clone(),
                lease_generation,
                command_id: provision.command_id,
                ack: WorkerCommandAckKind::Succeeded,
                result_json: Some("{}".into()),
                error_code: None,
            }),
        )
        .await
        .expect("complete provisioning and queue initial reconciliation");
        assert_eq!("succeeded", succeeded_ack.status);

        let Json(reconcile_poll) = worker_poll(
            State(state.clone()),
            worker_headers(&hello.session_token),
            Json(WorkerPollRequest {
                protocol_version: hello.protocol_version,
                worker_id: worker_id.clone(),
                session_generation: hello.session_generation,
                max_commands: Some(MT5_VM_MAX_COMMANDS_PER_POLL),
            }),
        )
        .await
        .expect("lease the reconciliation command after provisioning");
        let reconcile = reconcile_poll
            .commands
            .into_iter()
            .find(|command| command.account_id == account_id)
            .expect("the provisioned account has a reconciliation command");
        assert_eq!(WorkerCommandKind::ReconcileAccount, reconcile.kind);
        assert!(reconcile.credential_grant.is_none());
        assert!(reconcile.ea_bootstrap_token.is_none());
        let Json(reconciled) = worker_ack(
            State(state.clone()),
            worker_headers(&hello.session_token),
            Json(WorkerCommandAckRequest {
                protocol_version: hello.protocol_version,
                worker_id: worker_id.clone(),
                session_generation: hello.session_generation,
                account_id: account_id.clone(),
                lease_generation,
                command_id: reconcile.command_id,
                ack: WorkerCommandAckKind::Succeeded,
                result_json: Some(
                    json!({
                        "ready": true,
                        "accountSync": true,
                        "portfolioSync": true,
                        "instrumentSync": true
                    })
                    .to_string(),
                ),
                error_code: None,
            }),
        )
        .await
        .expect("complete the reconciliation command without bypassing snapshot readiness");
        assert_eq!("succeeded", reconciled.status);

        let Json(heartbeat) = worker_heartbeat(
            State(state.clone()),
            worker_headers(&hello.session_token),
            Json(WorkerHeartbeatRequest {
                protocol_version: hello.protocol_version,
                worker_id: worker_id.clone(),
                session_generation: hello.session_generation,
                leases: vec![WorkerLeaseClaim {
                    account_id: account_id.clone(),
                    lease_generation,
                }],
            }),
        )
        .await
        .expect("renew the same fenced account lease");
        assert!(heartbeat.ok);

        let current_assignment = sqlx_core::query::query(
            "SELECT lease_generation, connection_revision \
             FROM execution_mt5_vm_accounts WHERE user_id = $1 AND account_id = $2",
        )
        .bind(owner_id)
        .bind(&account_id)
        .fetch_one(database)
        .await
        .expect("reload the post-reconcile assignment fence");
        let current_lease_generation = current_assignment
            .try_get::<i64, _>("lease_generation")
            .expect("decode post-reconcile lease generation")
            as u64;
        let current_connection_revision = current_assignment
            .try_get::<i64, _>("connection_revision")
            .expect("decode post-reconcile connection revision")
            as u64;
        let post_reconcile_pairing_token = random_token();
        state
            .insert_managed_pairing_token(
                &post_reconcile_pairing_token,
                &owner_id.to_string(),
                Duration::from_secs(60),
                ManagedEaPairingBinding {
                    account_id: AccountId::new(account_id.clone()),
                    worker_id: worker_id.clone(),
                    worker_session_generation: hello.session_generation,
                    lease_generation: current_lease_generation,
                    connection_revision: current_connection_revision,
                    slot_id: "slot-01".into(),
                    terminal_pid: 42_424,
                    gateway_origin: "http://127.0.0.1:8790".into(),
                    masked_login_suffix: Some("4567".into()),
                    identity_fingerprint: identity_fingerprint.to_vec(),
                },
            )
            .await
            .expect("issue a fresh EA bootstrap after provisioning and reconciliation");
        let post_reconcile_session = state
            .create_session(EaSessionRequest {
                protocol_version: EXECUTION_PROTOCOL_VERSION,
                pairing_token: post_reconcile_pairing_token,
                agent_id: "managed-ea-agent-post-reconcile".into(),
                runtime_binding: Some(EaManagedRuntimeBinding {
                    slot_id: "slot-01".into(),
                    terminal_pid: 42_424,
                    gateway_origin: "http://127.0.0.1:8790".into(),
                }),
                account: managed_account_snapshot(broker_login, broker_server),
            })
            .await
            .expect("pair a fresh EA session after provisioning and reconciliation");
        let mut post_reconcile_headers = HeaderMap::new();
        post_reconcile_headers.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", post_reconcile_session.session_token))
                .expect("post-reconcile EA bearer header is valid"),
        );

        let Json(accepted) = accept_events(
            State(state.clone()),
            post_reconcile_headers.clone(),
            Json(EaEventBatch {
                protocol_version: EXECUTION_PROTOCOL_VERSION,
                account: managed_account_snapshot(broker_login, broker_server),
                instruments: Vec::new(),
                positions: Vec::new(),
                pending_orders: Vec::new(),
                portfolio_snapshot_complete: true,
                events: Vec::new(),
            }),
        )
        .await
        .expect("publish the first authenticated snapshot through the atomic readiness gate");
        assert!(accepted.ok);
        let Json(after_readiness) = poll_commands(State(state.clone()), post_reconcile_headers)
            .await
            .expect("poll after the atomic readiness gate");
        assert!(
            after_readiness.commands.is_empty(),
            "worker reconcile metadata alone cannot replace the four authoritative sync families"
        );
        let deferred_status = sqlx_core::query::query(
            "SELECT status FROM execution_target_commands WHERE user_id = $1 AND id = $2",
        )
        .bind(owner_id)
        .bind(deferred_command_id.as_str())
        .fetch_one(database)
        .await
        .expect("load the still-fenced deferred command")
        .try_get::<String, _>("status")
        .expect("decode deferred command status");
        assert_eq!(
            deferred_status, "waiting",
            "the command stays waiting until the four authoritative sync families are complete"
        );

        let failed_ack_request = WorkerCommandAckRequest {
            protocol_version: hello.protocol_version,
            worker_id: worker_id.clone(),
            session_generation: hello.session_generation,
            account_id: account_id.clone(),
            lease_generation,
            command_id: Uuid::new_v4().to_string(),
            ack: WorkerCommandAckKind::Failed,
            result_json: None,
            error_code: Some("SYNTHETIC_RUNTIME_FAILURE".into()),
        };
        let mut failed_ack_transaction = database.begin().await.expect("begin failed ack probe");
        apply_terminal_ack(
            &mut failed_ack_transaction,
            owner_id,
            &failed_ack_request,
            "reconcile_account",
            "failed",
            None,
        )
        .await
        .expect("a failed terminal acknowledgement degrades the active account");
        failed_ack_transaction
            .rollback()
            .await
            .expect("roll back the failed ack probe");

        let mut stale_provision_request = failed_ack_request;
        stale_provision_request.account_id = format!("missing-{}", Uuid::new_v4().simple());
        stale_provision_request.ack = WorkerCommandAckKind::Succeeded;
        stale_provision_request.error_code = None;
        let mut stale_provision_transaction =
            database.begin().await.expect("begin stale provision probe");
        apply_terminal_ack(
            &mut stale_provision_transaction,
            owner_id,
            &stale_provision_request,
            "provision_account",
            "succeeded",
            Some(&json!({})),
        )
        .await
        .expect("a fenced provision acknowledgement is a no-op");
        stale_provision_transaction
            .rollback()
            .await
            .expect("roll back the stale provision probe");

        let account_row = sqlx_core::query::query(
            "SELECT connection_status, connection_revision FROM execution_mt5_vm_accounts \
             WHERE user_id = $1 AND account_id = $2",
        )
        .bind(owner_id)
        .bind(&account_id)
        .fetch_one(database)
        .await
        .expect("load the reconciled managed account");
        let status = account_row
            .try_get::<String, _>("connection_status")
            .expect("decode managed account status");
        assert_eq!("synchronizing", status);
        let current_revision = account_row
            .try_get::<i64, _>("connection_revision")
            .expect("decode managed account revision") as u64;

        let (disconnect_status, disconnect_revision) =
            crate::mt5_vm_connections::disconnect_account_for_test(
                state.clone(),
                MANAGED_DATABASE_ADMIN_TOKEN,
                owner_id.to_string(),
                account_id.clone(),
                current_revision,
            )
            .await
            .expect("fence the active runtime and durably queue its stop command");
        assert_eq!("degraded", disconnect_status);
        assert!(disconnect_revision > current_revision);

        let Json(stop_poll) = worker_poll(
            State(state.clone()),
            worker_headers(&hello.session_token),
            Json(WorkerPollRequest {
                protocol_version: hello.protocol_version,
                worker_id: worker_id.clone(),
                session_generation: hello.session_generation,
                max_commands: Some(MT5_VM_MAX_COMMANDS_PER_POLL),
            }),
        )
        .await
        .expect("poll the fenced runtime stop command");
        let stop = stop_poll
            .commands
            .into_iter()
            .find(|command| command.account_id == account_id)
            .expect("disconnect queues a stop command for the assigned account");
        assert_eq!(WorkerCommandKind::StopAccount, stop.kind);
        let Json(stop_received) = worker_ack(
            State(state.clone()),
            worker_headers(&hello.session_token),
            Json(WorkerCommandAckRequest {
                protocol_version: hello.protocol_version,
                worker_id: worker_id.clone(),
                session_generation: hello.session_generation,
                account_id: account_id.clone(),
                lease_generation,
                command_id: stop.command_id.clone(),
                ack: WorkerCommandAckKind::Received,
                result_json: None,
                error_code: None,
            }),
        )
        .await
        .expect("acknowledge durable receipt of the stop command");
        assert_eq!("received", stop_received.status);
        let Json(stopped) = worker_ack(
            State(state.clone()),
            worker_headers(&hello.session_token),
            Json(WorkerCommandAckRequest {
                protocol_version: hello.protocol_version,
                worker_id,
                session_generation: hello.session_generation,
                account_id: account_id.clone(),
                lease_generation,
                command_id: stop.command_id,
                ack: WorkerCommandAckKind::Succeeded,
                result_json: Some("{}".into()),
                error_code: None,
            }),
        )
        .await
        .expect("release the runtime assignment only after terminal cleanup succeeds");
        assert_eq!("succeeded", stopped.status);
        let released = sqlx_core::query::query(
            "SELECT connection_status, worker_id FROM execution_mt5_vm_accounts \
             WHERE user_id = $1 AND account_id = $2",
        )
        .bind(owner_id)
        .bind(&account_id)
        .fetch_one(database)
        .await
        .expect("load the stopped managed account");
        assert_eq!(
            "disconnected",
            released
                .try_get::<String, _>("connection_status")
                .expect("decode stopped status")
        );
        assert!(
            released
                .try_get::<Option<String>, _>("worker_id")
                .expect("decode released worker")
                .is_none()
        );
    }

    #[test]
    fn protocol_negotiation_requires_an_explicit_overlap() {
        assert_eq!(negotiate_protocol(1, 1).expect("v1 overlaps"), 1);
        assert!(negotiate_protocol(0, 1).is_err());
        assert!(negotiate_protocol(2, 3).is_err());
        assert!(negotiate_protocol(2, 1).is_err());
    }

    #[test]
    fn worker_bootstrap_is_separate_from_admin_auth_and_fails_closed() {
        const BOOTSTRAP: &str = "worker-bootstrap-token-with-32-characters";
        let state = GatewayState::new_with_mt5_vm(
            "admin-token-with-at-least-32-characters",
            "stable-test-mt5-identity-key-at-least-32-bytes",
            Some(BOOTSTRAP),
            None,
        );
        assert!(require_bootstrap(&state, &HeaderMap::new()).is_err());
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-mt5-vm-bootstrap-token",
            HeaderValue::from_static(BOOTSTRAP),
        );
        require_bootstrap(&state, &headers).expect("worker bootstrap token matches");
        assert!(!state.admin_token_matches(&headers));
    }

    #[test]
    fn managed_ea_gateway_origin_is_an_exact_secure_origin() {
        let _ = routes();
        assert!(valid_ea_gateway_origin("https://execution.example.test"));
        assert!(valid_ea_gateway_origin("http://127.0.0.1:8790"));
        assert!(!valid_ea_gateway_origin(
            "https://execution.example.test/v1/ea"
        ));
        assert!(!valid_ea_gateway_origin(
            "https://execution.example.test?token=secret"
        ));
        assert!(!valid_ea_gateway_origin("http://execution.example.test"));
        assert!(!valid_ea_gateway_origin(
            "https://user@execution.example.test"
        ));
        assert!(!valid_ea_gateway_origin("https://[::1"));
        assert!(!valid_ea_gateway_origin("https:relative"));
        let relative_uri: axum::http::Uri = "/relative"
            .parse()
            .expect("relative URI parses without an authority");
        assert!(!valid_ea_gateway_uri("/relative", &relative_uri));
        assert!(!valid_ea_gateway_origin("ftp://localhost"));
        assert_eq!(decode_lower_hex_32(&"ab".repeat(32)), Some([0xab; 32]));
        assert_eq!(decode_lower_hex_32(&"AB".repeat(32)), None);
        assert_eq!(decode_lower_hex_32("short"), None);
    }

    #[test]
    fn hello_validation_keeps_the_phase_two_capacity_ceiling() {
        let mut hello = WorkerHelloRequest {
            worker_id: "worker-01".into(),
            protocol_min: 1,
            protocol_max: 1,
            agent_version: "1.0.0".into(),
            image_version: "2026.08.12".into(),
            runtime_version: "mt5-6111-py313".into(),
            capacity: MT5_VM_MAX_SCHEDULED_TERMINALS,
            region: "us-west".into(),
            capabilities: ["installed_slots".to_owned()].into_iter().collect(),
        };
        assert_eq!(validate_hello(&hello).expect("valid hello"), 1);
        assert_eq!(worker_substrate(&hello), "windows_vm");
        hello.capabilities.insert("bare_metal".into());
        assert_eq!(worker_substrate(&hello), "bare_metal");
        hello.capacity += 1;
        assert!(validate_hello(&hello).is_err());
    }

    #[tokio::test]
    async fn managed_ea_binding_validation_fails_before_database_access() {
        let state = GatewayState::new("admin-token-with-at-least-32-characters", None);
        let request = WorkerEaBootstrapBindRequest {
            protocol_version: 1,
            worker_id: "worker-01".into(),
            session_generation: 1,
            account_id: "account-01".into(),
            lease_generation: 1,
            connection_revision: 1,
            pairing_token_sha256: "short".into(),
            slot_id: "slot-01".into(),
            terminal_pid: 42,
            gateway_origin: "http://127.0.0.1:8790".into(),
        };
        let mut invalid_envelope = request.clone();
        invalid_envelope.worker_id.clear();
        invalid_envelope.pairing_token_sha256 = "ab".repeat(32);
        let error = worker_bind_ea_bootstrap(
            State(state.clone()),
            HeaderMap::new(),
            Json(invalid_envelope),
        )
        .await
        .expect_err("invalid worker envelope fails before auth and database");
        assert_eq!(error.body.code, "MT5_VM_WORKER_REQUEST_INVALID");

        let error = worker_bind_ea_bootstrap(
            State(state.clone()),
            HeaderMap::new(),
            Json(request.clone()),
        )
        .await
        .expect_err("malformed pairing hash fails before auth and database");
        assert_eq!(error.body.code, "MANAGED_EA_RUNTIME_BINDING_INVALID");

        let mut zero_pid = request;
        zero_pid.pairing_token_sha256 = "ab".repeat(32);
        zero_pid.terminal_pid = 0;
        let error = worker_bind_ea_bootstrap(State(state), HeaderMap::new(), Json(zero_pid))
            .await
            .expect_err("zero terminal PID fails before auth and database");
        assert_eq!(error.body.code, "MANAGED_EA_RUNTIME_BINDING_INVALID");
    }

    #[test]
    fn durable_payload_guard_rejects_nested_secret_material() {
        assert!(payload_is_safe(&json!({
            "connectionRevision": 4,
            "snapshot": {"ready": true}
        })));
        assert!(!payload_is_safe(&json!({
            "nested": [{"password": "must-not-persist"}]
        })));
        assert!(!payload_is_safe(&json!({"secretRef": "credential/path"})));
        assert!(!payload_is_safe(
            &json!({"brokerPassword": "must-not-persist"})
        ));
        assert!(!payload_is_safe(
            &json!({"access_token": "must-not-persist"})
        ));
    }

    #[test]
    fn acknowledgement_state_machine_is_idempotent_and_fail_closed() {
        assert_eq!(
            ack_target_status("dispatched", WorkerCommandAckKind::Received).expect("received ack"),
            "received"
        );
        assert_eq!(
            ack_target_status("received", WorkerCommandAckKind::Succeeded).expect("success ack"),
            "succeeded"
        );
        assert_eq!(
            ack_target_status("succeeded", WorkerCommandAckKind::Succeeded)
                .expect("duplicate success"),
            "succeeded"
        );
        assert!(ack_target_status("succeeded", WorkerCommandAckKind::Failed).is_err());
        assert!(ack_target_status("queued", WorkerCommandAckKind::Received).is_err());
    }

    #[test]
    fn stop_ack_finishes_disconnect_without_advancing_the_request_revision_again() {
        let source = include_str!("mt5_vm_control.rs");
        let start = source
            .find("\"stop_account\" => {")
            .expect("stop acknowledgement transition exists");
        let end = source[start..]
            .find("fn ack_target_status(")
            .map(|offset| start + offset)
            .expect("stop acknowledgement transition has a boundary");
        let transition = &source[start..end];

        assert!(transition.contains("disconnect_requested_revision IS NOT NULL"));
        assert!(!transition.contains("connection_revision = connection_revision + 1"));
    }

    #[test]
    fn ready_requires_all_reconciliation_domains() {
        let complete = json!({
            "ready": true,
            "accountSync": true,
            "portfolioSync": true,
            "instrumentSync": true
        });
        assert!(reconciliation_complete(Some(&complete)));
        let incomplete = json!({
            "ready": true,
            "accountSync": true,
            "portfolioSync": true,
            "instrumentSync": false
        });
        assert!(!reconciliation_complete(Some(&incomplete)));
    }

    #[test]
    fn migration_is_durable_fenced_and_contains_no_plaintext_credential_columns() {
        let migration = include_str!("../../../../migrations/0038_mt5_vm_control_plane.up.sql");
        assert!(migration.contains("CREATE TABLE execution_mt5_vm_workers"));
        assert!(migration.contains("session_token_hash"));
        assert!(
            migration.contains("generation = execution_mt5_vm_account_leases.generation + 1")
                || migration.contains("generation                 bigint")
        );
        assert!(migration.contains("CREATE TABLE execution_mt5_vm_control_commands"));
        assert!(migration.contains("connector_kind IN ('ea', 'windows_vm')"));
        assert!(!migration.contains(" raw_login"));
        assert!(!migration.contains(" password "));
    }

    #[test]
    fn managed_ea_bootstrap_migration_binds_tokens_to_one_fenced_assignment() {
        let migration = include_str!("../../../../migrations/0042_mt5_managed_ea_bootstrap.up.sql");
        let rollback =
            include_str!("../../../../migrations/0042_mt5_managed_ea_bootstrap.down.sql");
        assert!(migration.contains("ALTER TABLE execution_pairing_tokens"));
        assert!(migration.contains("managed_account_id"));
        assert!(migration.contains("managed_worker_id"));
        assert!(migration.contains("worker_session_generation"));
        assert!(migration.contains("lease_generation"));
        assert!(migration.contains("connection_revision"));
        assert!(!migration.contains("ADD COLUMN normalized_server"));
        assert!(migration.contains("masked_login_suffix"));
        assert!(migration.contains("identity_fingerprint"));
        assert!(migration.contains("server_fingerprint"));
        assert!(migration.contains("UPDATE execution_accounts"));
        assert!(migration.contains("UPDATE execution_mt5_vm_accounts"));
        assert!(migration.contains("UPDATE execution_mt5_vm_account_state"));
        assert!(migration.contains("execution_mt5_vm_accounts_active_identity_idx"));
        assert!(migration.contains("REFERENCES execution_mt5_vm_accounts"));
        assert!(migration.contains("worker_substrate"));
        assert!(migration.contains("bare_metal"));
        assert!(!migration.contains("raw_password"));
        assert!(!migration.contains("raw_login"));
        assert!(!rollback.contains("DROP COLUMN IF EXISTS normalized_server"));
        for column in [
            "managed_account_id",
            "managed_worker_id",
            "worker_session_generation",
            "lease_generation",
            "connection_revision",
            "masked_login_suffix",
            "identity_fingerprint",
        ] {
            assert!(rollback.contains(&format!("DROP COLUMN IF EXISTS {column}")));
        }
    }

    #[test]
    fn managed_ea_readiness_requires_a_fresh_successful_poll() {
        let gateway = include_str!("main.rs");
        let migration = include_str!("../../../../migrations/0042_mt5_managed_ea_bootstrap.up.sql");
        let start = gateway
            .find("async fn advance_managed_ea_readiness_after_event")
            .expect("managed EA readiness query must exist");
        let end = gateway[start..]
            .find("async fn prop_risk_guard_view")
            .expect("managed EA readiness query must remain bounded");
        let readiness = &gateway[start..start + end];

        assert!(readiness.contains("execution_advance_mt5_managed_readiness"));
        assert!(readiness.contains("EA_POLL_FRESHNESS"));
        assert!(migration.contains("session.last_poll_at >"));
        assert!(migration.contains("p_poll_freshness_ms * interval '1 millisecond'"));
    }

    #[test]
    fn durable_command_wire_shape_keeps_payload_as_bounded_json_text() {
        let command = WorkerControlCommand {
            protocol_version: 1,
            worker_id: "worker-01".into(),
            account_id: "account-01".into(),
            lease_generation: 2,
            command_id: Uuid::nil().to_string(),
            message_id: Uuid::nil().to_string(),
            sent_at_ms: 10,
            expires_at_ms: 20,
            kind: WorkerCommandKind::ReconcileAccount,
            payload_json: "{}".into(),
            credential_grant: None,
            ea_bootstrap_token: None,
        };
        let value = serde_json::to_value(command).expect("command serializes");
        assert_eq!(value["leaseGeneration"], 2);
        assert_eq!(value["kind"], "reconcile_account");
        assert_eq!(value["payloadJson"], "{}");
        assert!(value.get("payload").is_none());
    }
}
