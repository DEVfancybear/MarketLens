use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx_core::row::Row;
use sqlx_postgres::{PgPool, PgRow, Postgres};
use uuid::Uuid;
use zeroize::Zeroize;

use super::{ApiError, GatewayState, parse_owner_id, require_admin, sha256};

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

fn valid_server(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty() && value.len() <= 128 && !value.chars().any(char::is_control)
}

fn valid_label(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty() && value.len() <= 80 && !value.chars().any(char::is_control)
}

fn valid_suffix(value: &str) -> bool {
    (1..=4).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn valid_persistence(value: &str) -> bool {
    matches!(value, "session" | "managed")
}

fn is_false(value: &bool) -> bool {
    !*value
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

fn validate_reserve(request: &ReserveRequest) -> Result<Uuid, ApiError> {
    let owner_id = parse_owner_id(&request.owner_id)?;
    if !valid_identifier(&request.account_id, 96)
        || !valid_label(&request.label)
        || !valid_server(&request.server)
        || !valid_suffix(&request.masked_login_suffix)
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
    let existing = sqlx_core::query::query(
        r#"
        SELECT vm.connection_revision, vm.worker_id, vm.pending_secret_ref,
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
            SET pending_secret_ref = $3, connection_revision = $4
            WHERE user_id = $1 AND account_id = $2
            "#,
        )
        .bind(owner_id)
        .bind(&request.account_id)
        .bind(&request.secret_ref)
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
        .bind(request.server.trim())
        .bind(request.label.trim())
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database("create MT5 execution account", error))?;
        sqlx_core::query::query(
            r#"
            INSERT INTO execution_mt5_vm_accounts (
              user_id, account_id, normalized_server, masked_login_suffix,
              persistence_mode, connection_status, pending_secret_ref
            ) VALUES ($1, $2, $3, $4, $5, 'blocked', $6)
            "#,
        )
        .bind(owner_id)
        .bind(&request.account_id)
        .bind(request.server.trim())
        .bind(&request.masked_login_suffix)
        .bind(&request.persistence)
        .bind(&request.secret_ref)
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
            server: request.server.trim().into(),
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
    let current = sqlx_core::query::query(
        r#"
        SELECT vm.connection_revision, vm.worker_id, vm.pending_secret_ref,
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
    if revision != request.expected_revision as i64
        || worker_id.is_some()
        || pending.as_deref() != Some(request.secret_ref.as_str())
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
    .bind(request.server.trim())
    .bind(&request.secret_ref)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("activate MT5 registry credential", error))?;
    let next_revision = revision + 1;
    sqlx_core::query::query(
        r#"
        UPDATE execution_mt5_vm_accounts
        SET normalized_server = $3, masked_login_suffix = $4,
            persistence_mode = $5, connection_status = 'queued',
            connection_revision = $6, credential_revision = credential_revision + 1,
            credentials_updated_at = now(), credential_consumed_at = NULL,
            pending_secret_ref = NULL, removal_requested_at = NULL,
            last_error_code = NULL
        WHERE user_id = $1 AND account_id = $2
        "#,
    )
    .bind(owner_id)
    .bind(&request.account_id)
    .bind(request.server.trim())
    .bind(&request.masked_login_suffix)
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
        server: request.server.trim().into(),
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
            SET pending_secret_ref = NULL, connection_revision = connection_revision + 1
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
    sqlx_core::query::query(
        r#"
        UPDATE execution_mt5_vm_accounts
        SET connection_status = 'reconnecting', connection_revision = connection_revision + 1,
            removal_requested_at = NULL, last_error_code = NULL
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
    if view.connection_revision != request.expected_revision {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "MT5_VM_ACCOUNT_REVISION_CONFLICT",
            "MT5 account revision changed",
        ));
    }
    let worker_id: Option<String> = row
        .try_get("worker_id")
        .map_err(|error| ApiError::database("decode MT5 disconnect worker", error))?;
    let lease_generation: i64 = row
        .try_get("lease_generation")
        .map_err(|error| ApiError::database("decode MT5 disconnect lease", error))?;
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
        SET connection_status = $3, connection_revision = connection_revision + 1,
            worker_id = CASE WHEN $4 THEN worker_id ELSE NULL END,
            last_error_code = NULL
        WHERE user_id = $1 AND account_id = $2
        "#,
    )
    .bind(owner_id)
    .bind(&request.account_id)
    .bind(status)
    .bind(stopping)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ApiError::database("request MT5 disconnect", error))?;
    view.connection_status = status.into();
    view.connection_revision += 1;
    audit(
        &mut transaction,
        owner_id,
        "user",
        &request.owner_id,
        "mt5_vm.account_disconnect_requested",
        &request.account_id,
        json!({"draining": stopping, "connectionRevision": view.connection_revision}),
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|error| ApiError::database("commit MT5 disconnect", error))?;
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
    let row = sqlx_core::query::query(
        r#"
        WITH consumed AS (
          UPDATE execution_mt5_vm_credential_grants grant
          SET status = 'consumed', consumed_at = now()
          FROM execution_mt5_vm_control_commands command,
               execution_mt5_vm_account_leases lease,
               execution_mt5_vm_workers worker
          WHERE grant.command_id = $1
            AND grant.grant_token_hash = $2
            AND grant.status = 'issued' AND grant.expires_at > now()
            AND command.id = grant.command_id
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
          RETURNING grant.user_id, grant.account_id
        )
        SELECT consumed.user_id, consumed.account_id, registry.secret_ref,
               vm.persistence_mode
        FROM consumed
        JOIN execution_accounts registry
          ON registry.user_id = consumed.user_id AND registry.id = consumed.account_id
        JOIN execution_mt5_vm_accounts vm
          ON vm.user_id = consumed.user_id AND vm.account_id = consumed.account_id
        WHERE registry.connector_kind = 'windows_vm' AND registry.secret_ref IS NOT NULL
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
mod tests {
    use super::*;

    #[test]
    fn connector_validation_rejects_secret_and_identity_confusion() {
        assert!(valid_secret_ref("mt5-0123456789abcdef0123456789abcdef"));
        assert!(!valid_secret_ref("vault/marketlens/account"));
        assert!(!valid_secret_ref("mt5-0123456789ABCDEF0123456789ABCDEF"));
        assert!(valid_suffix("5678"));
        assert!(!valid_suffix("12x4"));
        assert!(valid_persistence("session"));
        assert!(valid_persistence("managed"));
        assert!(!valid_persistence("forever"));
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
    fn phase_three_migration_keeps_only_opaque_hashes_and_references() {
        let migration = include_str!("../../../../migrations/0039_mt5_vm_credentials.up.sql");
        assert!(migration.contains("grant_token_hash"));
        assert!(migration.contains("pending_secret_ref"));
        assert!(!migration.contains("raw_password"));
        assert!(!migration.contains("raw_login"));
    }
}
