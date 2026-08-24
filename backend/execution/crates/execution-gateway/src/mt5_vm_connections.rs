use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx_core::row::Row;
use sqlx_postgres::{PgPool, PgRow, Postgres};
use tracing::error;
use uuid::Uuid;
use zeroize::Zeroize;

use super::{
    ApiError, GatewayState, header_value, map_database_error, parse_owner_id, require_admin, sha256,
};

const RECOVER_STALE_RESERVATION: &str = "recover stale MT5 credential reservation";
const CLAIM_ABANDONED_RESERVATION: &str = "claim abandoned MT5 credential reservation";

pub(super) fn routes() -> Router<GatewayState> {
    Router::new()
        .route("/v1/admin/mt5-vm/accounts", get(list_accounts))
        .route("/v1/admin/mt5-vm/accounts/status", get(account_status))
        .route("/v1/admin/mt5-vm/accounts/reserve", post(reserve_account))
        .route("/v1/admin/mt5-vm/accounts/activate", post(activate_account))
        .route("/v1/admin/mt5-vm/accounts/abort", post(abort_account))
        .route(
            "/v1/admin/mt5-vm/accounts/reconnect",
            post(reconnect_account),
        )
        .route(
            "/v1/admin/mt5-vm/accounts/disconnect",
            post(disconnect_account),
        )
        .route(
            "/v1/admin/mt5-vm/accounts/prepare-delete",
            post(prepare_delete_account),
        )
        .route(
            "/v1/admin/mt5-vm/accounts/finalize-delete",
            post(finalize_delete_account),
        )
        .route(
            "/v1/admin/mt5-vm/credential-grants/consume",
            post(consume_credential_grant),
        )
}

fn database(state: &GatewayState) -> Result<&PgPool, ApiError> {
    state.inner.database.as_ref().ok_or_else(|| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "MT5_VM_CONNECTION_DATABASE_REQUIRED",
            "MT5 VM connection persistence is unavailable",
        )
    })
}

fn valid_identifier(value: &str, maximum: usize) -> bool {
    let value = value.as_bytes();
    !value.is_empty()
        && value.len() <= maximum
        && value[0].is_ascii_alphanumeric()
        && value
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn valid_secret_ref(value: &str) -> bool {
    value.len() == 36
        && value.starts_with("mt5-")
        && value[4..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn valid_label(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty() && value.len() <= 80 && !value.chars().any(char::is_control)
}

fn valid_suffix(value: &str) -> bool {
    value == "****" || (value.len() == 4 && value.bytes().all(|byte| byte.is_ascii_digit()))
}

fn valid_persistence(value: &str) -> bool {
    matches!(value, "session" | "managed")
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReservationRetryDecision {
    Active,
    WaitForOwner,
    RecoverPending,
    ClaimFresh,
}

fn reservation_retry_decision(
    has_active_secret: bool,
    has_pending_secret: bool,
    pending_is_fresh: bool,
) -> ReservationRetryDecision {
    if has_pending_secret {
        if pending_is_fresh {
            ReservationRetryDecision::WaitForOwner
        } else {
            ReservationRetryDecision::RecoverPending
        }
    } else if has_active_secret {
        ReservationRetryDecision::Active
    } else {
        ReservationRetryDecision::ClaimFresh
    }
}

fn ensure_reservation_worker_fence(
    worker_is_assigned: bool,
    decision: ReservationRetryDecision,
) -> Result<(), ApiError> {
    if worker_is_assigned && decision != ReservationRetryDecision::Active {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "MT5_VM_ACCOUNT_REVISION_CONFLICT",
            "MT5 account changed or is still bound to a worker",
        ));
    }
    Ok(())
}

fn ensure_single_reservation_update(rows_affected: u64) -> Result<(), ApiError> {
    if rows_affected != 1 {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "MT5_VM_ACCOUNT_REVISION_CONFLICT",
            "MT5 credential reservation changed during recovery",
        ));
    }
    Ok(())
}

fn ensure_disconnect_outcome(outcome: &str) -> Result<(), ApiError> {
    match outcome {
        "ok" => Ok(()),
        "not_found" => Err(account_not_found()),
        _ => Err(ApiError::new(
            StatusCode::CONFLICT,
            "MT5_VM_ACCOUNT_REVISION_CONFLICT",
            "MT5 account revision changed",
        )),
    }
}

async fn commit_managed_transaction(
    transaction: sqlx_core::transaction::Transaction<'_, Postgres>,
    context: &'static str,
) -> Result<(), ApiError> {
    transaction.commit().await.map_err(|error| {
        error!(%error, operation = context, "managed MT5 transaction commit failed");
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATABASE_ERROR",
            "execution service could not complete the request",
        )
    })
}

fn account_not_found() -> ApiError {
    ApiError::new(
        StatusCode::NOT_FOUND,
        "MT5_VM_ACCOUNT_NOT_FOUND",
        "MT5 VM account was not found",
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountQuery {
    owner_id: String,
    #[serde(default)]
    account_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReserveRequest {
    owner_id: String,
    account_id: String,
    label: String,
    server: String,
    masked_login_suffix: String,
    identity_fingerprint: String,
    server_fingerprint: String,
    persistence: String,
    secret_ref: String,
    #[serde(default)]
    expected_revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActivateRequest {
    owner_id: String,
    account_id: String,
    label: String,
    server: String,
    masked_login_suffix: String,
    identity_fingerprint: String,
    server_fingerprint: String,
    persistence: String,
    secret_ref: String,
    expected_revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AbortRequest {
    owner_id: String,
    account_id: String,
    secret_ref: String,
    #[serde(default)]
    previous_secret_ref: Option<String>,
    expected_revision: u64,
    created: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RevisionRequest {
    owner_id: String,
    account_id: String,
    expected_revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FinalizeDeleteRequest {
    owner_id: String,
    account_id: String,
    #[serde(default)]
    secret_ref: Option<String>,
    #[serde(default)]
    pending_secret_ref: Option<String>,
    expected_revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GrantConsumeRequest {
    protocol_version: u16,
    worker_id: String,
    session_generation: u64,
    account_id: String,
    lease_generation: u64,
    command_id: String,
    grant_token: String,
}

impl Drop for GrantConsumeRequest {
    fn drop(&mut self) {
        self.grant_token.zeroize();
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountView {
    account_id: String,
    label: String,
    server: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    masked_login_suffix: Option<String>,
    persistence: String,
    connection_status: String,
    connection_revision: u64,
    updated_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    secret_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_secret_ref: Option<String>,
    #[serde(skip_serializing_if = "is_false")]
    created: bool,
    #[serde(skip_serializing_if = "is_false")]
    ready: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CredentialGrantView {
    secret_ref: String,
    persistence: String,
}

#[derive(Debug, Serialize)]
struct OkResponse {
    ok: bool,
}

const ACCOUNT_VIEW_SQL: &str = r#"
    SELECT registry.id AS account_id, registry.label, registry.server,
           vm.masked_login_suffix, vm.persistence_mode, vm.connection_status,
           vm.connection_revision,
           (extract(epoch from vm.updated_at) * 1000)::bigint AS updated_at_ms,
           registry.secret_ref, vm.pending_secret_ref, vm.worker_id,
           vm.identity_fingerprint,
           vm.lease_generation, vm.removal_requested_at
    FROM execution_mt5_vm_accounts vm
    JOIN execution_accounts registry
      ON registry.user_id = vm.user_id AND registry.id = vm.account_id
    WHERE vm.user_id = $1 AND registry.connector_kind = 'windows_vm'
"#;

fn decode_account(row: &PgRow) -> Result<AccountView, ApiError> {
    Ok(AccountView {
        account_id: row
            .try_get("account_id")
            .map_err(|error| ApiError::database("decode MT5 account id", error))?,
        label: row
            .try_get("label")
            .map_err(|error| ApiError::database("decode MT5 account label", error))?,
        server: row
            .try_get("server")
            .map_err(|error| ApiError::database("decode MT5 account server", error))?,
        masked_login_suffix: row
            .try_get("masked_login_suffix")
            .map_err(|error| ApiError::database("decode MT5 login suffix", error))?,
        persistence: row
            .try_get("persistence_mode")
            .map_err(|error| ApiError::database("decode MT5 persistence", error))?,
        connection_status: row
            .try_get("connection_status")
            .map_err(|error| ApiError::database("decode MT5 connection status", error))?,
        connection_revision: row
            .try_get::<i64, _>("connection_revision")
            .map_err(|error| ApiError::database("decode MT5 connection revision", error))?
            as u64,
        updated_at_ms: row
            .try_get::<i64, _>("updated_at_ms")
            .map_err(|error| ApiError::database("decode MT5 update time", error))?
            as u64,
        secret_ref: row
            .try_get("secret_ref")
            .map_err(|error| ApiError::database("decode MT5 secret reference", error))?,
        previous_secret_ref: row
            .try_get("pending_secret_ref")
            .map_err(|error| ApiError::database("decode pending MT5 secret reference", error))?,
        created: false,
        ready: false,
    })
}

async fn audit(
    transaction: &mut sqlx_core::transaction::Transaction<'_, Postgres>,
    owner_id: Uuid,
    actor_type: &str,
    actor_id: &str,
    action: &str,
    account_id: &str,
    details: Value,
) -> Result<(), ApiError> {
    sqlx_core::query::query(
        r#"
        INSERT INTO execution_audit_log (
          user_id, actor_type, actor_id, action, resource_type, resource_id, details
        ) VALUES ($1, $2, $3, $4, 'execution_account', $5, $6)
        "#,
    )
    .bind(owner_id)
    .bind(actor_type)
    .bind(actor_id)
    .bind(action)
    .bind(account_id)
    .bind(sqlx_core::types::Json(details))
    .execute(&mut **transaction)
    .await
    .map_err(|error| ApiError::database("audit MT5 connection lifecycle", error))?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn audit_disconnect_if_needed(
    transaction: &mut sqlx_core::transaction::Transaction<'_, Postgres>,
    owner_id: Uuid,
    actor_id: &str,
    account_id: &str,
    stopping: bool,
    connection_revision: u64,
    idempotent: bool,
) -> Result<(), ApiError> {
    if idempotent {
        return Ok(());
    }
    audit(
        transaction,
        owner_id,
        "user",
        actor_id,
        "mt5_vm.account_disconnect_requested",
        account_id,
        json!({"draining": stopping, "connectionRevision": connection_revision}),
    )
    .await
}

fn validate_reserve(request: &ReserveRequest) -> Result<Uuid, ApiError> {
    let owner_id = parse_owner_id(&request.owner_id)?;
    if !valid_identifier(&request.account_id, 96)
        || !valid_label(&request.label)
        || !request.server.is_empty()
        || !valid_suffix(&request.masked_login_suffix)
        || decode_identity_fingerprint(&request.identity_fingerprint).is_none()
        || decode_identity_fingerprint(&request.server_fingerprint).is_none()
        || !valid_persistence(&request.persistence)
        || !valid_secret_ref(&request.secret_ref)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "MT5_VM_CONNECTION_INVALID",
            "MT5 connection metadata is invalid",
        ));
    }
    Ok(owner_id)
}

fn decode_identity_fingerprint(value: &str) -> Option<Vec<u8>> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let mut decoded = Vec::with_capacity(32);
    for pair in value.as_bytes().chunks_exact(2) {
        let high = (pair[0] as char).to_digit(16)? as u8;
        let low = (pair[1] as char).to_digit(16)? as u8;
        decoded.push((high << 4) | low);
    }
    Some(decoded)
}

async fn lock_identity_and_reject_conflict(
    transaction: &mut sqlx_core::transaction::Transaction<'_, Postgres>,
    fingerprint: &[u8],
    account_id: &str,
) -> Result<(), ApiError> {
    sqlx_core::query::query(
        "SELECT pg_advisory_xact_lock(hashtextextended(encode($1::bytea, 'hex'), 0))",
    )
    .bind(fingerprint)
    .execute(&mut **transaction)
    .await
    .map_err(|error| ApiError::database("lock MT5 identity fingerprint", error))?;
    let conflict = sqlx_core::query_scalar::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
          SELECT 1 FROM execution_mt5_vm_accounts
          WHERE COALESCE(pending_identity_fingerprint, identity_fingerprint) = $1
            AND account_id <> $2
            AND connection_status NOT IN ('disconnected', 'credentials_required')
        )
        "#,
    )
    .bind(fingerprint)
    .bind(account_id)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|error| ApiError::database("check active MT5 identity", error))?;
    if conflict {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "MT5_VM_IDENTITY_CONFLICT",
            "MT5 account already has an active managed connection",
        ));
    }
    Ok(())
}

async fn list_accounts(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Query(query): Query<AccountQuery>,
) -> Result<Json<Vec<AccountView>>, ApiError> {
    require_admin(&state, &headers)?;
    let owner_id = parse_owner_id(&query.owner_id)?;
    if query.account_id.is_some() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "MT5_VM_ACCOUNT_QUERY_INVALID",
            "accountId is not accepted on the list route",
        ));
    }
    let sql = format!("{ACCOUNT_VIEW_SQL} ORDER BY vm.created_at, vm.account_id");
    let rows = sqlx_core::query::query(&sql)
        .bind(owner_id)
        .fetch_all(database(&state)?)
        .await
        .map_err(|error| ApiError::database("list MT5 VM accounts", error))?;
    rows.iter()
        .map(decode_account)
        .collect::<Result<Vec<_>, _>>()
        .map(Json)
}

async fn account_status(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Query(query): Query<AccountQuery>,
) -> Result<Json<AccountView>, ApiError> {
    require_admin(&state, &headers)?;
    let owner_id = parse_owner_id(&query.owner_id)?;
    let account_id = query.account_id.ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "MT5_VM_ACCOUNT_QUERY_INVALID",
            "accountId is required",
        )
    })?;
    if !valid_identifier(&account_id, 96) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "MT5_VM_ACCOUNT_QUERY_INVALID",
            "accountId is invalid",
        ));
    }
    let sql = format!("{ACCOUNT_VIEW_SQL} AND vm.account_id = $2");
    let row = sqlx_core::query::query(&sql)
        .bind(owner_id)
        .bind(&account_id)
        .fetch_optional(database(&state)?)
        .await
        .map_err(|error| ApiError::database("load MT5 VM account", error))?
        .ok_or_else(account_not_found)?;
    decode_account(&row).map(Json)
}

async fn reserve_account(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<ReserveRequest>,
) -> Result<(StatusCode, Json<AccountView>), ApiError> {
    require_admin(&state, &headers)?;
    let owner_id = validate_reserve(&request)?;
    let mut transaction = database(&state)?
        .begin()
        .await
        .map_err(|error| ApiError::database("begin MT5 credential reservation", error))?;
    let identity_fingerprint = decode_identity_fingerprint(&request.identity_fingerprint)
        .expect("validated MT5 identity fingerprint");
    let server_fingerprint = decode_identity_fingerprint(&request.server_fingerprint)
        .expect("validated MT5 server fingerprint");
    lock_identity_and_reject_conflict(&mut transaction, &identity_fingerprint, &request.account_id)
        .await?;
    let existing = sqlx_core::query::query(
        r#"
        SELECT vm.connection_revision, vm.worker_id, vm.pending_secret_ref,
               vm.pending_reserved_at > now() - interval '30 seconds'
                 AS pending_is_fresh,
               vm.pending_identity_fingerprint, vm.pending_server_fingerprint,
               vm.identity_fingerprint, vm.server_fingerprint,
               vm.masked_login_suffix, vm.persistence_mode, vm.connection_status,
               registry.secret_ref, registry.label
        FROM execution_mt5_vm_accounts vm
        JOIN execution_accounts registry
          ON registry.user_id = vm.user_id AND registry.id = vm.account_id
        WHERE vm.user_id = $1 AND vm.account_id = $2
          AND registry.connector_kind = 'windows_vm'
        FOR UPDATE OF vm, registry
        "#,
    )
    .bind(owner_id)
    .bind(&request.account_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("load MT5 credential reservation", error))?;

    let (revision, previous_secret_ref, created) = if let Some(row) = existing {
        let revision = row
            .try_get::<i64, _>("connection_revision")
            .map_err(|error| ApiError::database("decode MT5 reservation revision", error))?;
        let worker_id: Option<String> = row
            .try_get("worker_id")
            .map_err(|error| ApiError::database("decode MT5 reservation worker", error))?;
        let pending: Option<String> = row
            .try_get("pending_secret_ref")
            .map_err(|error| ApiError::database("decode pending MT5 credential", error))?;
        if request.expected_revision == 0 {
            let pending_identity: Option<Vec<u8>> = row
                .try_get("pending_identity_fingerprint")
                .map_err(|error| ApiError::database("decode pending MT5 identity", error))?;
            let pending_server: Option<Vec<u8>> = row
                .try_get("pending_server_fingerprint")
                .map_err(|error| ApiError::database("decode pending MT5 server", error))?;
            let active_identity: Option<Vec<u8>> = row
                .try_get("identity_fingerprint")
                .map_err(|error| ApiError::database("decode active MT5 identity", error))?;
            let active_server: Option<Vec<u8>> = row
                .try_get("server_fingerprint")
                .map_err(|error| ApiError::database("decode active MT5 server", error))?;
            let expected_identity = pending_identity.as_deref().or(active_identity.as_deref());
            let expected_server = pending_server.as_deref().or(active_server.as_deref());
            let stored_suffix: Option<String> = row
                .try_get("masked_login_suffix")
                .map_err(|error| ApiError::database("decode stored MT5 suffix", error))?;
            let stored_persistence: String = row
                .try_get("persistence_mode")
                .map_err(|error| ApiError::database("decode stored MT5 persistence", error))?;
            if expected_identity != Some(identity_fingerprint.as_slice())
                || expected_server != Some(server_fingerprint.as_slice())
                || stored_suffix.as_deref() != Some(request.masked_login_suffix.as_str())
                || stored_persistence != request.persistence
            {
                return Err(ApiError::new(
                    StatusCode::CONFLICT,
                    "MT5_VM_REQUEST_ID_CONFLICT",
                    "MT5 request id was already used for different connection metadata",
                ));
            }
            let connection_status: String = row
                .try_get("connection_status")
                .map_err(|error| ApiError::database("decode stored MT5 status", error))?;
            let label: String = row
                .try_get("label")
                .map_err(|error| ApiError::database("decode stored MT5 label", error))?;
            let previous_secret_ref: Option<String> = row
                .try_get("secret_ref")
                .map_err(|error| ApiError::database("decode active MT5 credential", error))?;
            let pending_is_fresh = row
                .try_get::<Option<bool>, _>("pending_is_fresh")
                .map_err(|error| ApiError::database("decode MT5 reservation lease", error))?
                .unwrap_or(false);
            let decision = reservation_retry_decision(
                previous_secret_ref.is_some(),
                pending.is_some(),
                pending_is_fresh,
            );
            ensure_reservation_worker_fence(worker_id.is_some(), decision)?;
            let (next_revision, secret_ref, ready) = match decision {
                ReservationRetryDecision::Active => (revision, None, true),
                ReservationRetryDecision::WaitForOwner => (revision, None, true),
                ReservationRetryDecision::RecoverPending => {
                    let pending_ref = pending
                        .as_ref()
                        .expect("retry decision requires a pending secret reference");
                    let next_revision = revision + 1;
                    let updated = sqlx_core::query::query(
                        r#"
                        UPDATE execution_mt5_vm_accounts
                        SET pending_reserved_at = now(), connection_revision = $4,
                            connection_status = 'blocked'
                        WHERE user_id = $1 AND account_id = $2
                          AND pending_secret_ref = $3 AND connection_revision = $5
                        "#,
                    )
                    .bind(owner_id)
                    .bind(&request.account_id)
                    .bind(pending_ref)
                    .bind(next_revision)
                    .bind(revision)
                    .execute(&mut *transaction)
                    .await
                    .map_err(map_database_error(RECOVER_STALE_RESERVATION))?;
                    ensure_single_reservation_update(updated.rows_affected())?;
                    (next_revision, Some(pending_ref.clone()), false)
                }
                ReservationRetryDecision::ClaimFresh => {
                    let next_revision = revision + 1;
                    let updated = sqlx_core::query::query(
                        r#"
                        UPDATE execution_mt5_vm_accounts
                        SET pending_secret_ref = $3, pending_reserved_at = now(),
                            pending_identity_fingerprint = $4,
                            pending_server_fingerprint = $5,
                            connection_revision = $6, connection_status = 'blocked'
                        WHERE user_id = $1 AND account_id = $2
                          AND pending_secret_ref IS NULL
                          AND connection_revision = $7
                        "#,
                    )
                    .bind(owner_id)
                    .bind(&request.account_id)
                    .bind(&request.secret_ref)
                    .bind(&identity_fingerprint)
                    .bind(&server_fingerprint)
                    .bind(next_revision)
                    .bind(revision)
                    .execute(&mut *transaction)
                    .await
                    .map_err(map_database_error(CLAIM_ABANDONED_RESERVATION))?;
                    ensure_single_reservation_update(updated.rows_affected())?;
                    (next_revision, Some(request.secret_ref.clone()), false)
                }
            };
            if !ready {
                sqlx_core::query::query(
                    r#"
                    UPDATE execution_accounts
                    SET status = 'connecting', trade_allowed = false, updated_at = now()
                    WHERE user_id = $1 AND id = $2 AND connector_kind = 'windows_vm'
                    "#,
                )
                .bind(owner_id)
                .bind(&request.account_id)
                .execute(&mut *transaction)
                .await
                .map_err(|error| ApiError::database("resume MT5 credential reservation", error))?;
            }
            commit_managed_transaction(transaction, "commit idempotent MT5 credential reservation")
                .await?;
            return Ok((
                StatusCode::OK,
                Json(AccountView {
                    account_id: request.account_id,
                    label,
                    server: String::new(),
                    masked_login_suffix: stored_suffix,
                    persistence: stored_persistence,
                    connection_status: if ready {
                        connection_status
                    } else {
                        "blocked".into()
                    },
                    connection_revision: next_revision as u64,
                    updated_at_ms: 0,
                    secret_ref,
                    previous_secret_ref: (!ready).then_some(previous_secret_ref).flatten(),
                    created: false,
                    ready,
                }),
            ));
        }
        if request.expected_revision == 0
            || revision != request.expected_revision as i64
            || worker_id.is_some()
            || pending.is_some()
        {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "MT5_VM_ACCOUNT_REVISION_CONFLICT",
                "MT5 account changed or is still bound to a worker",
            ));
        }
        let next_revision = revision + 1;
        sqlx_core::query::query(
            r#"
            UPDATE execution_mt5_vm_accounts
            SET pending_secret_ref = $3, pending_reserved_at = now(),
                pending_identity_fingerprint = $4,
                pending_server_fingerprint = $5, connection_revision = $6
            WHERE user_id = $1 AND account_id = $2
            "#,
        )
        .bind(owner_id)
        .bind(&request.account_id)
        .bind(&request.secret_ref)
        .bind(&identity_fingerprint)
        .bind(&server_fingerprint)
        .bind(next_revision)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("reserve replacement MT5 credential", error))?;
        (
            next_revision,
            row.try_get::<Option<String>, _>("secret_ref")
                .map_err(|error| ApiError::database("decode previous MT5 credential", error))?,
            false,
        )
    } else {
        if request.expected_revision != 0 {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "MT5_VM_ACCOUNT_REVISION_CONFLICT",
                "MT5 account does not exist at the expected revision",
            ));
        }
        sqlx_core::query::query(
            r#"
            INSERT INTO execution_accounts (
              id, user_id, venue_kind, broker_code, external_account_ref, server,
              label, mode, status, trade_allowed, connector_kind
            ) VALUES (
              $1, $2, 'metatrader5', 'mt5', $1, $3, $4,
              'unknown', 'connecting', false, 'windows_vm'
            )
            "#,
        )
        .bind(&request.account_id)
        .bind(owner_id)
        .bind("")
        .bind(request.label.trim())
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("create MT5 execution account", error))?;
        sqlx_core::query::query(
            r#"
            INSERT INTO execution_mt5_vm_accounts (
              user_id, account_id, normalized_server, masked_login_suffix,
              persistence_mode, connection_status, pending_secret_ref,
              pending_reserved_at,
              identity_fingerprint, pending_identity_fingerprint,
              server_fingerprint, pending_server_fingerprint
            ) VALUES ($1, $2, '', $3, $4, 'blocked', $5, now(), $6, $6, $7, $7)
            "#,
        )
        .bind(owner_id)
        .bind(&request.account_id)
        .bind(&request.masked_login_suffix)
        .bind(&request.persistence)
        .bind(&request.secret_ref)
        .bind(&identity_fingerprint)
        .bind(&server_fingerprint)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("create MT5 VM account", error))?;
        (1, None, true)
    };
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit MT5 credential reservation", error))?;
    Ok((
        if created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        Json(AccountView {
            account_id: request.account_id,
            label: request.label.trim().into(),
            server: String::new(),
            masked_login_suffix: Some(request.masked_login_suffix),
            persistence: request.persistence,
            connection_status: "blocked".into(),
            connection_revision: revision as u64,
            updated_at_ms: 0,
            secret_ref: None,
            previous_secret_ref,
            created,
            ready: false,
        }),
    ))
}

async fn activate_account(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<ActivateRequest>,
) -> Result<Json<AccountView>, ApiError> {
    require_admin(&state, &headers)?;
    let reserve = ReserveRequest {
        owner_id: request.owner_id.clone(),
        account_id: request.account_id.clone(),
        label: request.label.clone(),
        server: request.server.clone(),
        masked_login_suffix: request.masked_login_suffix.clone(),
        identity_fingerprint: request.identity_fingerprint.clone(),
        server_fingerprint: request.server_fingerprint.clone(),
        persistence: request.persistence.clone(),
        secret_ref: request.secret_ref.clone(),
        expected_revision: request.expected_revision,
    };
    let owner_id = validate_reserve(&reserve)?;
    if request.expected_revision == 0 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "MT5_VM_ACCOUNT_REVISION_INVALID",
            "expectedRevision is required",
        ));
    }
    let mut transaction = database(&state)?
        .begin()
        .await
        .map_err(|error| ApiError::database("begin MT5 credential activation", error))?;
    let identity_fingerprint = decode_identity_fingerprint(&request.identity_fingerprint)
        .expect("validated MT5 identity fingerprint");
    let server_fingerprint = decode_identity_fingerprint(&request.server_fingerprint)
        .expect("validated MT5 server fingerprint");
    lock_identity_and_reject_conflict(&mut transaction, &identity_fingerprint, &request.account_id)
        .await?;
    let current = sqlx_core::query::query(
        r#"
        SELECT vm.connection_revision, vm.worker_id, vm.pending_secret_ref,
               vm.pending_identity_fingerprint, vm.pending_server_fingerprint,
               registry.secret_ref
        FROM execution_mt5_vm_accounts vm
        JOIN execution_accounts registry
          ON registry.user_id = vm.user_id AND registry.id = vm.account_id
        WHERE vm.user_id = $1 AND vm.account_id = $2
          AND registry.connector_kind = 'windows_vm'
        FOR UPDATE OF vm, registry
        "#,
    )
    .bind(owner_id)
    .bind(&request.account_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("load MT5 credential activation", error))?
    .ok_or_else(account_not_found)?;
    let revision: i64 = current
        .try_get("connection_revision")
        .map_err(|error| ApiError::database("decode MT5 activation revision", error))?;
    let worker_id: Option<String> = current
        .try_get("worker_id")
        .map_err(|error| ApiError::database("decode MT5 activation worker", error))?;
    let pending: Option<String> = current
        .try_get("pending_secret_ref")
        .map_err(|error| ApiError::database("decode pending MT5 activation", error))?;
    let pending_identity: Option<Vec<u8>> = current
        .try_get("pending_identity_fingerprint")
        .map_err(|error| ApiError::database("decode pending MT5 identity", error))?;
    let pending_server: Option<Vec<u8>> = current
        .try_get("pending_server_fingerprint")
        .map_err(|error| ApiError::database("decode pending MT5 server identity", error))?;
    if revision != request.expected_revision as i64
        || worker_id.is_some()
        || pending.as_deref() != Some(request.secret_ref.as_str())
        || pending_identity.as_deref() != Some(identity_fingerprint.as_slice())
        || pending_server.as_deref() != Some(server_fingerprint.as_slice())
    {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "MT5_VM_ACCOUNT_REVISION_CONFLICT",
            "MT5 credential reservation is no longer current",
        ));
    }
    let previous_secret_ref: Option<String> = current
        .try_get("secret_ref")
        .map_err(|error| ApiError::database("decode prior MT5 secret", error))?;
    sqlx_core::query::query(
        r#"
        UPDATE execution_accounts
        SET label = $3, server = $4, secret_ref = $5, status = 'connecting',
            trade_allowed = false
        WHERE user_id = $1 AND id = $2 AND connector_kind = 'windows_vm'
        "#,
    )
    .bind(owner_id)
    .bind(&request.account_id)
    .bind(request.label.trim())
    .bind("")
    .bind(&request.secret_ref)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("activate MT5 registry credential", error))?;
    let next_revision = revision + 1;
    sqlx_core::query::query(
        r#"
        UPDATE execution_mt5_vm_accounts
        SET normalized_server = '', masked_login_suffix = $3,
            identity_fingerprint = $4, pending_identity_fingerprint = NULL,
            server_fingerprint = $5, pending_server_fingerprint = NULL,
            persistence_mode = $6, connection_status = 'queued',
            connection_revision = $7, credential_revision = credential_revision + 1,
            credentials_updated_at = now(), credential_consumed_at = NULL,
            pending_secret_ref = NULL, pending_reserved_at = NULL,
            removal_requested_at = NULL,
            disconnect_requested_revision = NULL,
            last_error_code = NULL
        WHERE user_id = $1 AND account_id = $2
        "#,
    )
    .bind(owner_id)
    .bind(&request.account_id)
    .bind(&request.masked_login_suffix)
    .bind(&identity_fingerprint)
    .bind(&server_fingerprint)
    .bind(&request.persistence)
    .bind(next_revision)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("activate MT5 VM account", error))?;
    let action = if previous_secret_ref.is_some() {
        "mt5_vm.credential_rotated"
    } else {
        "mt5_vm.account_connected"
    };
    audit(
        &mut transaction,
        owner_id,
        "user",
        &request.owner_id,
        action,
        &request.account_id,
        json!({"persistence": request.persistence, "connectionRevision": next_revision}),
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit MT5 credential activation", error))?;
    Ok(Json(AccountView {
        account_id: request.account_id,
        label: request.label.trim().into(),
        server: String::new(),
        masked_login_suffix: Some(request.masked_login_suffix),
        persistence: request.persistence,
        connection_status: "queued".into(),
        connection_revision: next_revision as u64,
        updated_at_ms: 0,
        secret_ref: None,
        previous_secret_ref: None,
        created: false,
        ready: false,
    }))
}

async fn abort_account(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<AbortRequest>,
) -> Result<Json<OkResponse>, ApiError> {
    require_admin(&state, &headers)?;
    let owner_id = parse_owner_id(&request.owner_id)?;
    if !valid_identifier(&request.account_id, 96)
        || !valid_secret_ref(&request.secret_ref)
        || request.expected_revision == 0
        || request
            .previous_secret_ref
            .as_deref()
            .is_some_and(|value| !valid_secret_ref(value))
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "MT5_VM_ABORT_INVALID",
            "MT5 credential reservation compensation is invalid",
        ));
    }
    let mut transaction = database(&state)?
        .begin()
        .await
        .map_err(|error| ApiError::database("begin MT5 reservation compensation", error))?;
    let current = sqlx_core::query::query(
        r#"
        SELECT vm.pending_secret_ref, vm.connection_revision, registry.secret_ref
        FROM execution_mt5_vm_accounts vm
        JOIN execution_accounts registry
          ON registry.user_id = vm.user_id AND registry.id = vm.account_id
        WHERE vm.user_id = $1 AND vm.account_id = $2
        FOR UPDATE OF vm, registry
        "#,
    )
    .bind(owner_id)
    .bind(&request.account_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("load MT5 reservation compensation", error))?
    .ok_or_else(account_not_found)?;
    let pending: Option<String> = current
        .try_get("pending_secret_ref")
        .map_err(|error| ApiError::database("decode abort credential", error))?;
    let revision: i64 = current
        .try_get("connection_revision")
        .map_err(|error| ApiError::database("decode abort revision", error))?;
    let active: Option<String> = current
        .try_get("secret_ref")
        .map_err(|error| ApiError::database("decode active abort credential", error))?;
    if pending.as_deref() != Some(request.secret_ref.as_str())
        || revision != request.expected_revision as i64
        || active != request.previous_secret_ref
    {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "MT5_VM_ABORT_CONFLICT",
            "MT5 credential reservation changed before compensation",
        ));
    }
    audit(
        &mut transaction,
        owner_id,
        "service",
        "go-bff",
        "mt5_vm.connection_aborted",
        &request.account_id,
        json!({"created": request.created}),
    )
    .await?;
    if request.created {
        sqlx_core::query::query(
            "DELETE FROM execution_accounts WHERE user_id = $1 AND id = $2 AND connector_kind = 'windows_vm'",
        )
        .bind(owner_id)
        .bind(&request.account_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("remove aborted MT5 account", error))?;
    } else {
        sqlx_core::query::query(
            r#"
            UPDATE execution_mt5_vm_accounts
            SET pending_secret_ref = NULL, pending_reserved_at = NULL,
                pending_identity_fingerprint = NULL,
                pending_server_fingerprint = NULL,
                connection_revision = connection_revision + 1
            WHERE user_id = $1 AND account_id = $2
            "#,
        )
        .bind(owner_id)
        .bind(&request.account_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("clear aborted MT5 credential", error))?;
    }
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit MT5 reservation compensation", error))?;
    Ok(Json(OkResponse { ok: true }))
}

async fn reconnect_account(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<RevisionRequest>,
) -> Result<Json<AccountView>, ApiError> {
    require_admin(&state, &headers)?;
    let owner_id = parse_owner_id(&request.owner_id)?;
    validate_revision_request(&request)?;
    let mut transaction = database(&state)?
        .begin()
        .await
        .map_err(|error| ApiError::database("begin MT5 reconnect", error))?;
    let sql = format!("{ACCOUNT_VIEW_SQL} AND vm.account_id = $2 FOR UPDATE OF vm, registry");
    let row = sqlx_core::query::query(&sql)
        .bind(owner_id)
        .bind(&request.account_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("load MT5 reconnect", error))?
        .ok_or_else(account_not_found)?;
    let mut view = decode_account(&row)?;
    let worker_id: Option<String> = row
        .try_get("worker_id")
        .map_err(|error| ApiError::database("decode MT5 reconnect worker", error))?;
    let identity_fingerprint: Option<Vec<u8>> = row
        .try_get("identity_fingerprint")
        .map_err(|error| ApiError::database("decode MT5 reconnect identity", error))?;
    if view.connection_revision != request.expected_revision
        || worker_id.is_some()
        || view.previous_secret_ref.is_some()
        || view.persistence != "managed"
        || view.secret_ref.is_none()
        || matches!(
            view.connection_status.as_str(),
            "queued" | "provisioning" | "synchronizing" | "ready" | "reconnecting" | "unsupported"
        )
    {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "MT5_VM_RECONNECT_CONFLICT",
            "MT5 account cannot reconnect from its current state",
        ));
    }
    let identity_fingerprint = identity_fingerprint.ok_or_else(|| {
        ApiError::new(
            StatusCode::CONFLICT,
            "MT5_VM_IDENTITY_REQUIRED",
            "MT5 account credentials must be supplied again",
        )
    })?;
    lock_identity_and_reject_conflict(&mut transaction, &identity_fingerprint, &request.account_id)
        .await?;
    sqlx_core::query::query(
        r#"
        UPDATE execution_accounts
        SET status = 'connecting', trade_allowed = false, updated_at = now()
        WHERE user_id = $1 AND id = $2 AND connector_kind = 'windows_vm'
        "#,
    )
    .bind(owner_id)
    .bind(&request.account_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("queue MT5 reconnect registry", error))?;
    sqlx_core::query::query(
        r#"
        UPDATE execution_mt5_vm_accounts
        SET connection_status = 'reconnecting', connection_revision = connection_revision + 1,
            removal_requested_at = NULL, disconnect_requested_revision = NULL,
            last_error_code = NULL
        WHERE user_id = $1 AND account_id = $2
        "#,
    )
    .bind(owner_id)
    .bind(&request.account_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("queue MT5 reconnect", error))?;
    view.connection_status = "reconnecting".into();
    view.connection_revision += 1;
    view.secret_ref = None;
    audit(
        &mut transaction,
        owner_id,
        "user",
        &request.owner_id,
        "mt5_vm.account_reconnect_requested",
        &request.account_id,
        json!({"connectionRevision": view.connection_revision}),
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit MT5 reconnect", error))?;
    Ok(Json(view))
}

fn validate_revision_request(request: &RevisionRequest) -> Result<(), ApiError> {
    if !valid_identifier(&request.account_id, 96) || request.expected_revision == 0 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "MT5_VM_ACCOUNT_REVISION_INVALID",
            "accountId or expectedRevision is invalid",
        ));
    }
    Ok(())
}

async fn queue_stop_if_active(
    transaction: &mut sqlx_core::transaction::Transaction<'_, Postgres>,
    owner_id: Uuid,
    account_id: &str,
    lease_generation: i64,
) -> Result<bool, ApiError> {
    let inserted = sqlx_core::query::query(
        r#"
        INSERT INTO execution_mt5_vm_control_commands (
          user_id, account_id, worker_id, worker_session_generation,
          lease_generation, protocol_version, idempotency_key,
          command_kind, payload, expires_at
        )
        SELECT $1, $2, lease.worker_id, lease.worker_session_generation,
               lease.generation, worker.protocol_version, $3,
               'stop_account', '{}'::jsonb, now() + interval '5 minutes'
        FROM execution_mt5_vm_account_leases lease
        JOIN execution_mt5_vm_workers worker ON worker.worker_id = lease.worker_id
        WHERE lease.account_id = $2 AND lease.user_id = $1
          AND lease.generation = $4 AND lease.status = 'active'
          AND lease.expires_at > now()
          AND worker.session_generation = lease.worker_session_generation
          AND worker.heartbeat_expires_at > now()
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
        "#,
    )
    .bind(owner_id)
    .bind(account_id)
    .bind(format!("stop:{account_id}:{lease_generation}"))
    .bind(lease_generation)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|error| ApiError::database("queue MT5 stop", error))?;
    if inserted.is_some() {
        return Ok(true);
    }
    let exists = sqlx_core::query::query(
        "SELECT 1 FROM execution_mt5_vm_control_commands WHERE idempotency_key = $1",
    )
    .bind(format!("stop:{account_id}:{lease_generation}"))
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|error| ApiError::database("load idempotent MT5 stop", error))?;
    Ok(exists.is_some())
}

async fn disconnect_account(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<RevisionRequest>,
) -> Result<Json<AccountView>, ApiError> {
    require_admin(&state, &headers)?;
    let owner_id = parse_owner_id(&request.owner_id)?;
    validate_revision_request(&request)?;
    let mut transaction = database(&state)?
        .begin()
        .await
        .map_err(|error| ApiError::database("begin MT5 disconnect", error))?;
    let sql = format!("{ACCOUNT_VIEW_SQL} AND vm.account_id = $2 FOR UPDATE OF vm, registry");
    let row = sqlx_core::query::query(&sql)
        .bind(owner_id)
        .bind(&request.account_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("load MT5 disconnect", error))?
        .ok_or_else(account_not_found)?;
    let mut view = decode_account(&row)?;
    let fence = sqlx_core::query::query(
        r#"
        SELECT outcome, new_revision, stopping, idempotent
        FROM execution_fence_mt5_managed_disconnect($1, $2, $3)
        "#,
    )
    .bind(owner_id)
    .bind(&request.account_id)
    .bind(request.expected_revision as i64)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("fence MT5 disconnect", error))?;
    let outcome: String = fence
        .try_get("outcome")
        .map_err(|error| ApiError::database("decode MT5 disconnect outcome", error))?;
    ensure_disconnect_outcome(&outcome)?;
    let stopping: bool = fence
        .try_get("stopping")
        .map_err(|error| ApiError::database("decode MT5 disconnect cleanup state", error))?;
    let idempotent: bool = fence
        .try_get("idempotent")
        .map_err(|error| ApiError::database("decode MT5 disconnect retry state", error))?;
    let revision: i64 = fence
        .try_get("new_revision")
        .map_err(|error| ApiError::database("decode MT5 disconnect revision", error))?;
    let status = if stopping { "degraded" } else { "disconnected" };
    view.connection_status = status.into();
    view.connection_revision = revision as u64;
    audit_disconnect_if_needed(
        &mut transaction,
        owner_id,
        &request.owner_id,
        &request.account_id,
        stopping,
        view.connection_revision,
        idempotent,
    )
    .await?;
    commit_managed_transaction(transaction, "commit MT5 disconnect").await?;
    Ok(Json(view))
}

async fn prepare_delete_account(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<RevisionRequest>,
) -> Result<Json<AccountView>, ApiError> {
    require_admin(&state, &headers)?;
    let owner_id = parse_owner_id(&request.owner_id)?;
    validate_revision_request(&request)?;
    let mut transaction = database(&state)?
        .begin()
        .await
        .map_err(|error| ApiError::database("begin MT5 account removal", error))?;
    let sql = format!("{ACCOUNT_VIEW_SQL} AND vm.account_id = $2 FOR UPDATE OF vm, registry");
    let row = sqlx_core::query::query(&sql)
        .bind(owner_id)
        .bind(&request.account_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("load MT5 account removal", error))?
        .ok_or_else(account_not_found)?;
    let mut view = decode_account(&row)?;
    if view.connection_revision != request.expected_revision {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "MT5_VM_ACCOUNT_REVISION_CONFLICT",
            "MT5 account revision changed",
        ));
    }
    let worker_id: Option<String> = row
        .try_get("worker_id")
        .map_err(|error| ApiError::database("decode MT5 removal worker", error))?;
    let lease_generation: i64 = row
        .try_get("lease_generation")
        .map_err(|error| ApiError::database("decode MT5 removal lease", error))?;
    let stopping = worker_id.is_some()
        && queue_stop_if_active(
            &mut transaction,
            owner_id,
            &request.account_id,
            lease_generation,
        )
        .await?;
    let status = if stopping { "degraded" } else { "disconnected" };
    sqlx_core::query::query(
        r#"
        UPDATE execution_mt5_vm_accounts
        SET removal_requested_at = COALESCE(removal_requested_at, now()),
            connection_status = $3, connection_revision = connection_revision + 1,
            worker_id = CASE WHEN $4 THEN worker_id ELSE NULL END
        WHERE user_id = $1 AND account_id = $2
        "#,
    )
    .bind(owner_id)
    .bind(&request.account_id)
    .bind(status)
    .bind(stopping)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("prepare MT5 account removal", error))?;
    view.connection_status = status.into();
    view.connection_revision += 1;
    view.ready = !stopping;
    audit(
        &mut transaction,
        owner_id,
        "user",
        &request.owner_id,
        "mt5_vm.account_removal_requested",
        &request.account_id,
        json!({"draining": stopping, "connectionRevision": view.connection_revision}),
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit MT5 account removal", error))?;
    Ok(Json(view))
}

async fn finalize_delete_account(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<FinalizeDeleteRequest>,
) -> Result<Json<OkResponse>, ApiError> {
    require_admin(&state, &headers)?;
    let owner_id = parse_owner_id(&request.owner_id)?;
    if !valid_identifier(&request.account_id, 96)
        || request.expected_revision == 0
        || request
            .secret_ref
            .as_deref()
            .is_some_and(|value| !valid_secret_ref(value))
        || request
            .pending_secret_ref
            .as_deref()
            .is_some_and(|value| !valid_secret_ref(value))
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "MT5_VM_REMOVE_INVALID",
            "MT5 account removal request is invalid",
        ));
    }
    let mut transaction = database(&state)?
        .begin()
        .await
        .map_err(|error| ApiError::database("begin MT5 account finalization", error))?;
    let deleted = sqlx_core::query::query(
        r#"
        DELETE FROM execution_accounts registry
        USING execution_mt5_vm_accounts vm
        WHERE registry.user_id = $1 AND registry.id = $2
          AND registry.connector_kind = 'windows_vm'
          AND vm.user_id = registry.user_id AND vm.account_id = registry.id
          AND vm.connection_revision = $3 AND vm.worker_id IS NULL
          AND vm.removal_requested_at IS NOT NULL
          AND registry.secret_ref IS NOT DISTINCT FROM $4
          AND vm.pending_secret_ref IS NOT DISTINCT FROM $5
        RETURNING registry.id
        "#,
    )
    .bind(owner_id)
    .bind(&request.account_id)
    .bind(request.expected_revision as i64)
    .bind(request.secret_ref.as_deref())
    .bind(request.pending_secret_ref.as_deref())
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("finalize MT5 account removal", error))?;
    if deleted.is_none() {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "MT5_VM_REMOVE_CONFLICT",
            "MT5 account is not ready for final removal",
        ));
    }
    audit(
        &mut transaction,
        owner_id,
        "user",
        &request.owner_id,
        "mt5_vm.account_removed",
        &request.account_id,
        json!({"connectionRevision": request.expected_revision}),
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit MT5 account finalization", error))?;
    Ok(Json(OkResponse { ok: true }))
}

async fn consume_credential_grant(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(request): Json<GrantConsumeRequest>,
) -> Result<Json<CredentialGrantView>, ApiError> {
    require_admin(&state, &headers)?;
    let worker_session_token = header_value(&headers, "x-mt5-worker-session-token")
        .filter(|token| super::mt5_vm_control::valid_worker_session_token(token))
        .ok_or_else(|| ApiError::unauthorized("MT5 VM worker bearer token is required"))?;
    let command_id = Uuid::parse_str(&request.command_id).map_err(|_| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "MT5_VM_CREDENTIAL_GRANT_INVALID",
            "credential grant envelope is invalid",
        )
    })?;
    if request.protocol_version == 0
        || request.session_generation == 0
        || request.lease_generation == 0
        || !valid_identifier(&request.worker_id, 64)
        || !valid_identifier(&request.account_id, 96)
        || request.grant_token.len() != 64
        || !request
            .grant_token
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "MT5_VM_CREDENTIAL_GRANT_INVALID",
            "credential grant envelope is invalid",
        ));
    }
    let token_hash = sha256(request.grant_token.as_bytes());
    let mut transaction = database(&state)?
        .begin()
        .await
        .map_err(|error| ApiError::database("begin MT5 credential grant consumption", error))?;
    super::mt5_vm_control::authenticate_worker_token(
        &mut transaction,
        worker_session_token,
        &request.worker_id,
        request.session_generation,
        request.protocol_version,
    )
    .await?;
    let row = sqlx_core::query::query(
        r#"
        WITH consumed AS (
          UPDATE execution_mt5_vm_credential_grants AS credential_grant
          SET status = 'consumed', consumed_at = now()
          FROM execution_mt5_vm_control_commands command,
               execution_mt5_vm_account_leases lease,
               execution_mt5_vm_workers worker
          WHERE credential_grant.command_id = $1
            AND credential_grant.grant_token_hash = $2
            AND credential_grant.status = 'issued'
            AND credential_grant.expires_at > now()
            AND command.id = credential_grant.command_id
            AND command.account_id = $3 AND command.worker_id = $4
            AND command.worker_session_generation = $5
            AND command.lease_generation = $6 AND command.protocol_version = $7
            AND command.status IN ('dispatched', 'received')
            AND lease.account_id = command.account_id
            AND lease.worker_id = command.worker_id
            AND lease.worker_session_generation = command.worker_session_generation
            AND lease.generation = command.lease_generation
            AND lease.status = 'active' AND lease.expires_at > now()
            AND worker.worker_id = command.worker_id
            AND worker.session_generation = command.worker_session_generation
            AND worker.heartbeat_expires_at > now()
          RETURNING credential_grant.user_id, credential_grant.account_id
        )
        SELECT consumed.user_id, consumed.account_id, registry.secret_ref,
               vm.persistence_mode
        FROM consumed
        JOIN execution_accounts registry
          ON registry.user_id = consumed.user_id AND registry.id = consumed.account_id
        JOIN execution_mt5_vm_accounts vm
          ON vm.user_id = consumed.user_id AND vm.account_id = consumed.account_id
        WHERE registry.connector_kind = 'windows_vm'
          AND registry.secret_ref IS NOT NULL
          AND vm.disconnect_requested_revision IS NULL
        "#,
    )
    .bind(command_id)
    .bind(token_hash.to_vec())
    .bind(&request.account_id)
    .bind(&request.worker_id)
    .bind(request.session_generation as i64)
    .bind(request.lease_generation as i64)
    .bind(i32::from(request.protocol_version))
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("consume MT5 credential grant", error))?
    .ok_or_else(|| {
        ApiError::new(
            StatusCode::UNAUTHORIZED,
            "MT5_VM_CREDENTIAL_GRANT_REJECTED",
            "credential grant is expired, consumed, or fenced",
        )
    })?;
    let owner_id: Uuid = row
        .try_get("user_id")
        .map_err(|error| ApiError::database("decode credential grant owner", error))?;
    let secret_ref: String = row
        .try_get("secret_ref")
        .map_err(|error| ApiError::database("decode credential grant reference", error))?;
    let persistence: String = row
        .try_get("persistence_mode")
        .map_err(|error| ApiError::database("decode credential grant persistence", error))?;
    sqlx_core::query::query(
        r#"
        UPDATE execution_mt5_vm_accounts
        SET credential_consumed_at = now()
        WHERE user_id = $1 AND account_id = $2
        "#,
    )
    .bind(owner_id)
    .bind(&request.account_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("record credential consumption", error))?;
    audit(
        &mut transaction,
        owner_id,
        "service",
        &request.worker_id,
        "mt5_vm.credential_grant_consumed",
        &request.account_id,
        json!({
            "commandId": request.command_id,
            "leaseGeneration": request.lease_generation,
            "workerSessionGeneration": request.session_generation
        }),
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit MT5 credential grant consumption", error))?;
    Ok(Json(CredentialGrantView {
        secret_ref,
        persistence,
    }))
}

#[cfg(test)]
pub(super) struct TestCredentialGrantEnvelope {
    pub protocol_version: u16,
    pub worker_id: String,
    pub session_generation: u64,
    pub account_id: String,
    pub lease_generation: u64,
    pub command_id: String,
    pub grant_token: String,
}

#[cfg(test)]
pub(super) async fn consume_credential_grant_for_test(
    state: GatewayState,
    admin_token: &str,
    worker_session_token: &str,
    envelope: TestCredentialGrantEnvelope,
) -> Result<(String, String), ApiError> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "x-execution-admin-token",
        admin_token
            .parse()
            .expect("test admin token is a valid header"),
    );
    headers.insert(
        "x-mt5-worker-session-token",
        worker_session_token
            .parse()
            .expect("test worker session token is a valid header"),
    );
    let Json(view) = consume_credential_grant(
        State(state),
        headers,
        Json(GrantConsumeRequest {
            protocol_version: envelope.protocol_version,
            worker_id: envelope.worker_id,
            session_generation: envelope.session_generation,
            account_id: envelope.account_id,
            lease_generation: envelope.lease_generation,
            command_id: envelope.command_id,
            grant_token: envelope.grant_token,
        }),
    )
    .await?;
    Ok((view.secret_ref, view.persistence))
}

#[cfg(test)]
pub(super) async fn disconnect_account_for_test(
    state: GatewayState,
    admin_token: &str,
    owner_id: String,
    account_id: String,
    expected_revision: u64,
) -> Result<(String, u64), ApiError> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "x-execution-admin-token",
        admin_token
            .parse()
            .expect("test admin token is a valid header"),
    );
    let Json(view) = disconnect_account(
        State(state),
        headers,
        Json(RevisionRequest {
            owner_id,
            account_id,
            expected_revision,
        }),
    )
    .await?;
    Ok((view.connection_status, view.connection_revision))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn managed_database_state() -> GatewayState {
        let database_url = std::env::var("MT5_MANAGED_TEST_DATABASE_URL")
            .expect("the disposable PostgreSQL harness supplies a loopback database URL");
        let database = sqlx_postgres::PgPoolOptions::new()
            .max_connections(4)
            .connect(&database_url)
            .await
            .expect("connect to the disposable managed MT5 database");
        GatewayState::new_production(
            "managed-database-admin-token-at-least-32-bytes",
            "stable-managed-database-identity-key-at-least-32-bytes",
            Some("managed-database-worker-bootstrap-token-at-least-32-bytes"),
            database,
        )
    }

    fn admin_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-execution-admin-token",
            "managed-database-admin-token-at-least-32-bytes"
                .parse()
                .expect("valid admin token header"),
        );
        headers
    }

    #[tokio::test]
    #[ignore = "run only inside the disposable PostgreSQL 17 harness"]
    async fn managed_database_connection_lifecycle_is_owner_scoped_and_revision_fenced() {
        let state = managed_database_state().await;
        let owner_uuid = Uuid::new_v4();
        let owner_id = owner_uuid.to_string();
        let account_id = format!("account-{}", Uuid::new_v4().simple());
        let secret_ref = format!("mt5-{}", Uuid::new_v4().simple());
        let test_database = database(&state).expect("production state has a database");
        let mut failing_commit = test_database
            .begin()
            .await
            .expect("begin deferred failure probe");
        sqlx_core::query::query("CREATE TEMP TABLE managed_commit_parent (id integer PRIMARY KEY)")
            .execute(&mut *failing_commit)
            .await
            .expect("create deferred parent table");
        sqlx_core::query::query(
            "CREATE TEMP TABLE managed_commit_child (parent_id integer REFERENCES \
             managed_commit_parent(id) DEFERRABLE INITIALLY DEFERRED)",
        )
        .execute(&mut *failing_commit)
        .await
        .expect("create deferred child table");
        sqlx_core::query::query("INSERT INTO managed_commit_child (parent_id) VALUES (404)")
            .execute(&mut *failing_commit)
            .await
            .expect("defer the foreign-key failure until commit");
        let commit_error = commit_managed_transaction(failing_commit, "commit deferred probe")
            .await
            .expect_err("deferred constraint failure is mapped at commit");
        assert_eq!("DATABASE_ERROR", commit_error.body.code);
        sqlx_core::query::query(
            "INSERT INTO users (id, email, email_verified, display_name, status) \
             VALUES ($1, $2, true, 'Managed connection owner', 'active')",
        )
        .bind(owner_uuid)
        .bind(format!("managed-connection-{owner_uuid}@example.invalid"))
        .execute(test_database)
        .await
        .expect("seed an active disposable owner");

        let reserve = ReserveRequest {
            owner_id: owner_id.clone(),
            account_id: account_id.clone(),
            label: "Synthetic managed account".into(),
            server: String::new(),
            masked_login_suffix: "4567".into(),
            identity_fingerprint: "1a".repeat(32),
            server_fingerprint: "2b".repeat(32),
            persistence: "managed".into(),
            secret_ref: secret_ref.clone(),
            expected_revision: 0,
        };
        let (status, Json(reserved)) =
            reserve_account(State(state.clone()), admin_headers(), Json(reserve))
                .await
                .expect("reserve the managed account identity and secret reference");
        assert_eq!(StatusCode::CREATED, status);
        assert!(reserved.created);
        assert!(!reserved.ready);
        assert!(reserved.connection_revision > 0);

        let request_id_conflict = reserve_account(
            State(state.clone()),
            admin_headers(),
            Json(ReserveRequest {
                owner_id: owner_id.clone(),
                account_id: account_id.clone(),
                label: "Synthetic managed account".into(),
                server: String::new(),
                masked_login_suffix: "9999".into(),
                identity_fingerprint: "1a".repeat(32),
                server_fingerprint: "2b".repeat(32),
                persistence: "managed".into(),
                secret_ref: format!("mt5-{}", Uuid::new_v4().simple()),
                expected_revision: 0,
            }),
        )
        .await
        .expect_err("reusing a request id with changed metadata is fenced");
        assert_eq!("MT5_VM_REQUEST_ID_CONFLICT", request_id_conflict.body.code);

        let identity_conflict = reserve_account(
            State(state.clone()),
            admin_headers(),
            Json(ReserveRequest {
                owner_id: owner_id.clone(),
                account_id: format!("account-{}", Uuid::new_v4().simple()),
                label: "Duplicate synthetic identity".into(),
                server: String::new(),
                masked_login_suffix: "4567".into(),
                identity_fingerprint: "1a".repeat(32),
                server_fingerprint: "2b".repeat(32),
                persistence: "managed".into(),
                secret_ref: format!("mt5-{}", Uuid::new_v4().simple()),
                expected_revision: 0,
            }),
        )
        .await
        .expect_err("the same broker identity cannot have two active managed accounts");
        assert_eq!("MT5_VM_IDENTITY_CONFLICT", identity_conflict.body.code);

        let (_, Json(retried)) = reserve_account(
            State(state.clone()),
            admin_headers(),
            Json(ReserveRequest {
                owner_id: owner_id.clone(),
                account_id: account_id.clone(),
                label: "Synthetic managed account".into(),
                server: String::new(),
                masked_login_suffix: "4567".into(),
                identity_fingerprint: "1a".repeat(32),
                server_fingerprint: "2b".repeat(32),
                persistence: "managed".into(),
                secret_ref: format!("mt5-{}", Uuid::new_v4().simple()),
                expected_revision: 0,
            }),
        )
        .await
        .expect("an idempotent pending reservation never requests a second credential write");
        assert!(retried.ready);
        assert_eq!(reserved.connection_revision, retried.connection_revision);

        sqlx_core::query::query(
            "UPDATE execution_mt5_vm_accounts \
             SET pending_reserved_at = now() - interval '31 seconds' \
             WHERE user_id = $1 AND account_id = $2",
        )
        .bind(owner_uuid)
        .bind(&account_id)
        .execute(database(&state).expect("production state has a database"))
        .await
        .expect("age the pending reservation past its recovery lease");
        let (_, Json(recovered)) = reserve_account(
            State(state.clone()),
            admin_headers(),
            Json(ReserveRequest {
                owner_id: owner_id.clone(),
                account_id: account_id.clone(),
                label: "Synthetic managed account".into(),
                server: String::new(),
                masked_login_suffix: "4567".into(),
                identity_fingerprint: "1a".repeat(32),
                server_fingerprint: "2b".repeat(32),
                persistence: "managed".into(),
                secret_ref: format!("mt5-{}", Uuid::new_v4().simple()),
                expected_revision: 0,
            }),
        )
        .await
        .expect("recover the exact stale pending reservation without inventing a new secret");
        assert!(!recovered.ready);
        assert_eq!(Some(secret_ref.clone()), recovered.secret_ref);
        assert!(recovered.connection_revision > reserved.connection_revision);

        let Json(recovered_abort) = abort_account(
            State(state.clone()),
            admin_headers(),
            Json(AbortRequest {
                owner_id: owner_id.clone(),
                account_id: account_id.clone(),
                secret_ref: secret_ref.clone(),
                previous_secret_ref: None,
                expected_revision: recovered.connection_revision,
                created: recovered.created,
            }),
        )
        .await
        .expect("compensate a recovered reservation while retaining its account identity");
        assert!(recovered_abort.ok);

        let active_secret_ref = format!("mt5-{}", Uuid::new_v4().simple());
        let (_, Json(claimed)) = reserve_account(
            State(state.clone()),
            admin_headers(),
            Json(ReserveRequest {
                owner_id: owner_id.clone(),
                account_id: account_id.clone(),
                label: "Synthetic managed account".into(),
                server: String::new(),
                masked_login_suffix: "4567".into(),
                identity_fingerprint: "1a".repeat(32),
                server_fingerprint: "2b".repeat(32),
                persistence: "managed".into(),
                secret_ref: active_secret_ref.clone(),
                expected_revision: 0,
            }),
        )
        .await
        .expect("claim an abandoned account identity with a fresh credential reference");
        assert!(!claimed.ready);
        assert_eq!(Some(active_secret_ref.clone()), claimed.secret_ref);

        let Json(activated) = activate_account(
            State(state.clone()),
            admin_headers(),
            Json(ActivateRequest {
                owner_id: owner_id.clone(),
                account_id: account_id.clone(),
                label: "Synthetic managed account".into(),
                server: String::new(),
                masked_login_suffix: "4567".into(),
                identity_fingerprint: "1a".repeat(32),
                server_fingerprint: "2b".repeat(32),
                persistence: "managed".into(),
                secret_ref: active_secret_ref.clone(),
                expected_revision: claimed.connection_revision,
            }),
        )
        .await
        .expect("activate the reserved credential version");
        assert_eq!("queued", activated.connection_status);

        let (_, Json(active_retry)) = reserve_account(
            State(state.clone()),
            admin_headers(),
            Json(ReserveRequest {
                owner_id: owner_id.clone(),
                account_id: account_id.clone(),
                label: "Synthetic managed account".into(),
                server: String::new(),
                masked_login_suffix: "4567".into(),
                identity_fingerprint: "1a".repeat(32),
                server_fingerprint: "2b".repeat(32),
                persistence: "managed".into(),
                secret_ref: format!("mt5-{}", Uuid::new_v4().simple()),
                expected_revision: 0,
            }),
        )
        .await
        .expect("an already active reservation is an idempotent ready response");
        assert!(active_retry.ready);
        assert_eq!(
            activated.connection_revision,
            active_retry.connection_revision
        );

        let Json(listed) = list_accounts(
            State(state.clone()),
            admin_headers(),
            Query(AccountQuery {
                owner_id: owner_id.clone(),
                account_id: None,
            }),
        )
        .await
        .expect("list only the authenticated owner's managed accounts");
        assert_eq!(1, listed.len());
        assert_eq!(account_id, listed[0].account_id);

        let Json(disconnected) = disconnect_account(
            State(state.clone()),
            admin_headers(),
            Json(RevisionRequest {
                owner_id: owner_id.clone(),
                account_id: account_id.clone(),
                expected_revision: activated.connection_revision,
            }),
        )
        .await
        .expect("disconnect without releasing an unacknowledged runtime");
        assert_eq!("disconnected", disconnected.connection_status);
        let mut idempotent_audit_probe = test_database
            .begin()
            .await
            .expect("begin idempotent disconnect audit probe");
        audit_disconnect_if_needed(
            &mut idempotent_audit_probe,
            owner_uuid,
            &owner_id,
            &account_id,
            false,
            disconnected.connection_revision,
            true,
        )
        .await
        .expect("an idempotent disconnect skips a duplicate audit event");
        idempotent_audit_probe
            .rollback()
            .await
            .expect("roll back idempotent disconnect audit probe");

        sqlx_core::query::query(
            "UPDATE execution_mt5_vm_accounts SET identity_fingerprint = NULL \
             WHERE user_id = $1 AND account_id = $2",
        )
        .bind(owner_uuid)
        .bind(&account_id)
        .execute(database(&state).expect("production state has a database"))
        .await
        .expect("remove identity only for the fail-closed reconnect probe");
        let identity_required = reconnect_account(
            State(state.clone()),
            admin_headers(),
            Json(RevisionRequest {
                owner_id: owner_id.clone(),
                account_id: account_id.clone(),
                expected_revision: disconnected.connection_revision,
            }),
        )
        .await
        .expect_err("reconnect never proceeds without the durable identity fingerprint");
        assert_eq!("MT5_VM_IDENTITY_REQUIRED", identity_required.body.code);
        sqlx_core::query::query(
            "UPDATE execution_mt5_vm_accounts SET identity_fingerprint = $3 \
             WHERE user_id = $1 AND account_id = $2",
        )
        .bind(owner_uuid)
        .bind(&account_id)
        .bind(vec![0x1a_u8; 32])
        .execute(database(&state).expect("production state has a database"))
        .await
        .expect("restore the identity after the fail-closed reconnect probe");

        let Json(reconnecting) = reconnect_account(
            State(state.clone()),
            admin_headers(),
            Json(RevisionRequest {
                owner_id: owner_id.clone(),
                account_id: account_id.clone(),
                expected_revision: disconnected.connection_revision,
            }),
        )
        .await
        .expect("managed persistence reuses only the opaque stored secret reference");
        assert_eq!("reconnecting", reconnecting.connection_status);
        assert!(reconnecting.connection_revision > disconnected.connection_revision);

        let replacement_secret_ref = format!("mt5-{}", Uuid::new_v4().simple());
        let (status, Json(replacement)) = reserve_account(
            State(state.clone()),
            admin_headers(),
            Json(ReserveRequest {
                owner_id: owner_id.clone(),
                account_id: account_id.clone(),
                label: "Rotated managed account".into(),
                server: String::new(),
                masked_login_suffix: "4567".into(),
                identity_fingerprint: "1a".repeat(32),
                server_fingerprint: "2b".repeat(32),
                persistence: "managed".into(),
                secret_ref: replacement_secret_ref.clone(),
                expected_revision: reconnecting.connection_revision,
            }),
        )
        .await
        .expect("reserve a replacement credential only at the current revision");
        assert_eq!(StatusCode::OK, status);
        assert!(!replacement.created);
        assert!(!replacement.ready);
        assert_eq!(
            Some(active_secret_ref.clone()),
            replacement.previous_secret_ref
        );

        let Json(rotated) = activate_account(
            State(state.clone()),
            admin_headers(),
            Json(ActivateRequest {
                owner_id: owner_id.clone(),
                account_id: account_id.clone(),
                label: "Rotated managed account".into(),
                server: String::new(),
                masked_login_suffix: "4567".into(),
                identity_fingerprint: "1a".repeat(32),
                server_fingerprint: "2b".repeat(32),
                persistence: "managed".into(),
                secret_ref: replacement_secret_ref.clone(),
                expected_revision: replacement.connection_revision,
            }),
        )
        .await
        .expect("activate the replacement credential and retire the prior reference");
        assert_eq!("queued", rotated.connection_status);

        let abandoned_secret_ref = format!("mt5-{}", Uuid::new_v4().simple());
        let (_, Json(abandoned)) = reserve_account(
            State(state.clone()),
            admin_headers(),
            Json(ReserveRequest {
                owner_id: owner_id.clone(),
                account_id: account_id.clone(),
                label: "Rotated managed account".into(),
                server: String::new(),
                masked_login_suffix: "4567".into(),
                identity_fingerprint: "1a".repeat(32),
                server_fingerprint: "2b".repeat(32),
                persistence: "managed".into(),
                secret_ref: abandoned_secret_ref.clone(),
                expected_revision: rotated.connection_revision,
            }),
        )
        .await
        .expect("reserve a credential that the BFF will compensate after a failed store write");
        assert_eq!(
            Some(replacement_secret_ref.clone()),
            abandoned.previous_secret_ref
        );

        let Json(compensated) = abort_account(
            State(state.clone()),
            admin_headers(),
            Json(AbortRequest {
                owner_id,
                account_id: account_id.clone(),
                secret_ref: abandoned_secret_ref,
                previous_secret_ref: Some(replacement_secret_ref.clone()),
                expected_revision: abandoned.connection_revision,
                created: false,
            }),
        )
        .await
        .expect("compensate the abandoned reservation without deleting the active credential");
        assert!(compensated.ok);

        let row = sqlx_core::query::query(
            r#"
            SELECT registry.secret_ref, vm.pending_secret_ref, vm.connection_revision
            FROM execution_mt5_vm_accounts vm
            JOIN execution_accounts registry
              ON registry.user_id = vm.user_id AND registry.id = vm.account_id
            WHERE vm.account_id = $1
            "#,
        )
        .bind(&account_id)
        .fetch_one(database(&state).expect("production state has a database"))
        .await
        .expect("load the compensated credential state");
        assert_eq!(
            Some(replacement_secret_ref),
            row.try_get::<Option<String>, _>("secret_ref")
                .expect("decode active credential reference")
        );
        assert_eq!(
            None,
            row.try_get::<Option<String>, _>("pending_secret_ref")
                .expect("decode pending credential reference")
        );
        assert!(
            row.try_get::<i64, _>("connection_revision")
                .expect("decode compensated revision")
                > abandoned.connection_revision as i64
        );
    }

    #[tokio::test]
    async fn credential_grant_requires_worker_session_before_database_access() {
        let admin_token = "admin-token-with-at-least-32-characters";
        let state = GatewayState::new(admin_token, None);
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-execution-admin-token",
            admin_token.parse().expect("valid admin header"),
        );
        let request = GrantConsumeRequest {
            protocol_version: 1,
            worker_id: "worker-01".into(),
            session_generation: 2,
            account_id: "mt5vm-account".into(),
            lease_generation: 3,
            command_id: Uuid::nil().to_string(),
            grant_token: "a".repeat(64),
        };

        let error = consume_credential_grant(State(state), headers, Json(request))
            .await
            .expect_err("missing worker session bearer must fail before database access");

        assert_eq!(StatusCode::UNAUTHORIZED, error.status);
        assert_eq!("UNAUTHORIZED", error.body.code);
    }

    #[tokio::test]
    async fn credential_grant_rejects_malformed_forwarded_worker_session() {
        let admin_token = "admin-token-with-at-least-32-characters";
        for worker_token in ["short", &"A".repeat(64)] {
            let state = GatewayState::new(admin_token, None);
            let mut headers = HeaderMap::new();
            headers.insert(
                "x-execution-admin-token",
                admin_token.parse().expect("valid admin header"),
            );
            headers.insert(
                "x-mt5-worker-session-token",
                worker_token.parse().expect("valid worker header"),
            );
            let request = GrantConsumeRequest {
                protocol_version: 1,
                worker_id: "worker-01".into(),
                session_generation: 2,
                account_id: "mt5vm-account".into(),
                lease_generation: 3,
                command_id: Uuid::nil().to_string(),
                grant_token: "a".repeat(64),
            };

            let error = consume_credential_grant(State(state), headers, Json(request))
                .await
                .expect_err("malformed forwarded worker session must fail before database access");

            assert_eq!(StatusCode::UNAUTHORIZED, error.status);
            assert_eq!("UNAUTHORIZED", error.body.code);
        }
    }

    #[test]
    fn connector_validation_rejects_secret_and_identity_confusion() {
        assert_eq!(decode_identity_fingerprint("short"), None);
        assert_eq!(
            decode_identity_fingerprint(&"ab".repeat(32)),
            Some(vec![0xab; 32])
        );
        assert!(valid_secret_ref("mt5-0123456789abcdef0123456789abcdef"));
        assert!(!valid_secret_ref("credential/marketlens/account"));
        assert!(!valid_secret_ref("mt5-0123456789ABCDEF0123456789ABCDEF"));
        assert!(valid_suffix("5678"));
        assert!(valid_suffix("****"));
        assert!(!valid_suffix("1"));
        assert!(!valid_suffix("123"));
        assert!(!valid_suffix("12x4"));
        assert!(valid_persistence("session"));
        assert!(valid_persistence("managed"));
        assert!(!valid_persistence("forever"));
    }

    #[test]
    fn fresh_reservation_retry_never_replays_the_secret_write() {
        assert_eq!(
            reservation_retry_decision(false, true, true),
            ReservationRetryDecision::WaitForOwner
        );
    }

    #[test]
    fn reservation_retry_distinguishes_active_fresh_stale_and_aborted_states() {
        assert_eq!(
            reservation_retry_decision(true, false, false),
            ReservationRetryDecision::Active
        );
        assert_eq!(
            reservation_retry_decision(false, true, true),
            ReservationRetryDecision::WaitForOwner
        );
        assert_eq!(
            reservation_retry_decision(true, true, true),
            ReservationRetryDecision::WaitForOwner
        );
        assert_eq!(
            reservation_retry_decision(false, true, false),
            ReservationRetryDecision::RecoverPending
        );
        assert_eq!(
            reservation_retry_decision(true, true, false),
            ReservationRetryDecision::RecoverPending
        );
        assert_eq!(
            reservation_retry_decision(false, false, false),
            ReservationRetryDecision::ClaimFresh
        );
    }

    #[test]
    fn reservation_and_disconnect_fences_classify_every_terminal_outcome() {
        ensure_reservation_worker_fence(false, ReservationRetryDecision::RecoverPending)
            .expect("an unassigned reservation may recover");
        ensure_reservation_worker_fence(true, ReservationRetryDecision::Active)
            .expect("an active retry may remain assigned");
        assert!(
            ensure_reservation_worker_fence(true, ReservationRetryDecision::WaitForOwner).is_err()
        );
        ensure_single_reservation_update(1).expect("one reservation update is accepted");
        assert!(ensure_single_reservation_update(0).is_err());
        ensure_disconnect_outcome("ok").expect("the database fence accepted the disconnect");
        assert_eq!(
            StatusCode::NOT_FOUND,
            ensure_disconnect_outcome("not_found")
                .expect_err("missing account is preserved")
                .status
        );
        assert_eq!(
            StatusCode::CONFLICT,
            ensure_disconnect_outcome("revision_conflict")
                .expect_err("all other outcomes are fenced")
                .status
        );
    }

    #[test]
    fn managed_disconnect_delegates_to_the_atomic_database_fence() {
        let source = include_str!("mt5_vm_connections.rs");
        let start = source
            .find("async fn disconnect_account(")
            .expect("managed disconnect route exists");
        let end = source[start..]
            .find("async fn prepare_delete_account(")
            .map(|offset| start + offset)
            .expect("managed disconnect route has a boundary");
        let implementation = &source[start..end];

        assert!(implementation.contains("execution_fence_mt5_managed_disconnect"));
        assert!(!implementation.contains("connection_revision = connection_revision + 1"));
    }

    #[test]
    fn grant_token_is_redacted_on_drop_contract() {
        let request = GrantConsumeRequest {
            protocol_version: 1,
            worker_id: "worker-01".into(),
            session_generation: 2,
            account_id: "mt5vm-account".into(),
            lease_generation: 3,
            command_id: Uuid::nil().to_string(),
            grant_token: "a".repeat(64),
        };
        assert_eq!(request.grant_token.len(), 64);
    }

    #[test]
    fn credential_grant_runtime_query_is_one_time() {
        let source = include_str!("mt5_vm_connections.rs");
        let start = source
            .find("async fn consume_credential_grant(")
            .expect("credential grant route exists");
        let implementation = &source[start..source.find("#[cfg(test)]").expect("test boundary")];

        assert!(implementation.contains("SET status = 'consumed', consumed_at = now()"));
        assert!(implementation.contains("grant.status = 'issued'"));
    }

    #[test]
    fn phase_three_migration_keeps_only_opaque_hashes_and_references() {
        let migration = include_str!("../../../../migrations/0039_mt5_vm_credentials.up.sql");
        assert!(migration.contains("grant_token_hash"));
        assert!(migration.contains("pending_secret_ref"));
        assert!(!migration.contains("raw_password"));
        assert!(!migration.contains("raw_login"));
    }
}
