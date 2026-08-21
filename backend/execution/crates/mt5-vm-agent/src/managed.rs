use std::collections::{BTreeSet, HashMap};
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use execution_domain::mt5_vm_control::{
    MT5_VM_MAX_COMMANDS_PER_POLL, WorkerCommandAckKind, WorkerCommandAckRequest,
    WorkerCommandAckResponse, WorkerCommandKind, WorkerControlCommand, WorkerHeartbeatRequest,
    WorkerHeartbeatResponse, WorkerHelloRequest, WorkerHelloResponse, WorkerLeaseClaim,
    WorkerPollRequest, WorkerPollResponse,
};
use reqwest::{StatusCode, Url};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use zeroize::{Zeroize, Zeroizing};

use crate::process::{ProcessDriverConfig, ProcessDriverConfigInput, ProcessRuntimeDriver};
use crate::protocol::{MAX_FRAME_BYTES, unix_time_ms};
use crate::worker::{CredentialMaterial, RuntimeDriver};

#[derive(Debug, PartialEq, Eq)]
pub struct ManagedError(&'static str);

impl ManagedError {
    pub const fn code(&self) -> &'static str {
        self.0
    }
}

pub struct SecretText(Zeroizing<String>);

impl SecretText {
    pub fn new(value: String) -> Result<Self, ManagedError> {
        let value = Zeroizing::new(value);
        if value.len() < 32
            || value.len() > 512
            || value.chars().any(|character| character.is_control())
        {
            return Err(ManagedError("MANAGED_WORKER_SECRET_INVALID"));
        }
        Ok(Self(value))
    }

    fn expose(&self) -> &str {
        self.0.as_str()
    }
}

impl std::fmt::Debug for SecretText {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SecretText([REDACTED])")
    }
}

#[derive(Debug)]
pub struct WorkerSession {
    pub worker_id: String,
    pub protocol_version: u16,
    pub session_generation: u64,
    session_token: SecretText,
    pub heartbeat_interval_ms: u64,
    pub lease_ttl_ms: u64,
}

pub struct ManagedControlClient {
    client: reqwest::blocking::Client,
    gateway_url: Url,
    credential_api_url: Url,
    bootstrap_token: SecretText,
}

impl ManagedControlClient {
    pub fn new(
        gateway_url: Url,
        credential_api_url: Url,
        bootstrap_token: SecretText,
    ) -> Result<Self, ManagedError> {
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("tradingview-mt5-vm-agent/1")
            .tls_backend_rustls()
            .build()
            .map_err(|_| ManagedError("MANAGED_WORKER_HTTP_CLIENT_FAILED"))?;
        Ok(Self {
            client,
            gateway_url,
            credential_api_url,
            bootstrap_token,
        })
    }

    pub fn hello(&self, request: &WorkerHelloRequest) -> Result<WorkerSession, ManagedError> {
        let endpoint = endpoint(&self.gateway_url, "v1/mt5-vm/workers/hello")?;
        let response = self
            .client
            .post(endpoint)
            .header("x-mt5-vm-bootstrap-token", self.bootstrap_token.expose())
            .json(request)
            .send()
            .map_err(|_| ManagedError("MANAGED_WORKER_HELLO_FAILED"))?;
        if response.status() != StatusCode::OK {
            return Err(ManagedError("MANAGED_WORKER_HELLO_REJECTED"));
        }
        let response: WorkerHelloResponse = decode_json(response, "MANAGED_WORKER_HELLO_INVALID")?;
        validate_hello_response(request, &response)?;
        let session_token = SecretText::new(response.session_token)
            .map_err(|_| ManagedError("MANAGED_WORKER_HELLO_INVALID"))?;
        Ok(WorkerSession {
            worker_id: response.worker_id,
            protocol_version: response.protocol_version,
            session_generation: response.session_generation,
            session_token,
            heartbeat_interval_ms: response.heartbeat_interval_ms,
            lease_ttl_ms: response.lease_ttl_ms,
        })
    }

    pub fn heartbeat(
        &self,
        session: &WorkerSession,
        request: &WorkerHeartbeatRequest,
    ) -> Result<WorkerHeartbeatResponse, ManagedError> {
        validate_session_identity(
            session,
            request.protocol_version,
            &request.worker_id,
            request.session_generation,
        )?;
        let response: WorkerHeartbeatResponse = self.session_post(
            session,
            "v1/mt5-vm/workers/heartbeat",
            request,
            "MANAGED_WORKER_HEARTBEAT_INVALID",
        )?;
        if !response.ok
            || !(1_000..=300_000).contains(&response.next_heartbeat_in_ms)
            || response.lease_ttl_ms <= response.next_heartbeat_in_ms
            || response.lease_ttl_ms > 900_000
        {
            return Err(ManagedError("MANAGED_WORKER_HEARTBEAT_INVALID"));
        }
        Ok(response)
    }

    pub fn poll(
        &self,
        session: &WorkerSession,
        request: &WorkerPollRequest,
    ) -> Result<WorkerPollResponse, ManagedError> {
        validate_session_identity(
            session,
            request.protocol_version,
            &request.worker_id,
            request.session_generation,
        )?;
        let requested_max = request.max_commands.unwrap_or(MT5_VM_MAX_COMMANDS_PER_POLL);
        if requested_max == 0 || requested_max > MT5_VM_MAX_COMMANDS_PER_POLL {
            return Err(ManagedError("MANAGED_WORKER_POLL_REQUEST_INVALID"));
        }
        let response: WorkerPollResponse = self.session_post(
            session,
            "v1/mt5-vm/workers/poll",
            request,
            "MANAGED_WORKER_POLL_INVALID",
        )?;
        if response.protocol_version != session.protocol_version
            || response.commands.len() > requested_max as usize
            || response.commands.iter().any(|command| {
                command.protocol_version != session.protocol_version
                    || command.worker_id != session.worker_id
                    || command.account_id.is_empty()
                    || command.lease_generation == 0
                    || command.command_id.is_empty()
                    || command.message_id.is_empty()
                    || command.expires_at_ms <= command.sent_at_ms
            })
        {
            return Err(ManagedError("MANAGED_WORKER_POLL_INVALID"));
        }
        Ok(response)
    }

    pub fn ack(
        &self,
        session: &WorkerSession,
        request: &WorkerCommandAckRequest,
    ) -> Result<WorkerCommandAckResponse, ManagedError> {
        validate_session_identity(
            session,
            request.protocol_version,
            &request.worker_id,
            request.session_generation,
        )?;
        if request.account_id.is_empty()
            || request.lease_generation == 0
            || request.command_id.is_empty()
        {
            return Err(ManagedError("MANAGED_WORKER_ACK_REQUEST_INVALID"));
        }
        let response: WorkerCommandAckResponse = self.session_post(
            session,
            "v1/mt5-vm/workers/ack",
            request,
            "MANAGED_WORKER_ACK_INVALID",
        )?;
        if response.command_id != request.command_id || response.status.is_empty() {
            return Err(ManagedError("MANAGED_WORKER_ACK_INVALID"));
        }
        Ok(response)
    }

    pub fn consume_credential_grant(
        &self,
        session: &WorkerSession,
        account_id: &str,
        lease_generation: u64,
        command_id: &str,
        grant_token: SecretText,
    ) -> Result<CredentialMaterial, ManagedError> {
        if account_id.is_empty()
            || account_id.len() > 96
            || account_id.chars().any(char::is_control)
            || lease_generation == 0
            || command_id.is_empty()
            || command_id.len() > 64
            || command_id.chars().any(char::is_control)
            || grant_token.expose().len() != 64
            || !grant_token
                .expose()
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(ManagedError("MANAGED_WORKER_CREDENTIAL_GRANT_INVALID"));
        }
        let request = CredentialGrantConsumeRequest {
            protocol_version: session.protocol_version,
            worker_id: &session.worker_id,
            session_generation: session.session_generation,
            account_id,
            lease_generation,
            command_id,
            grant_token: grant_token.expose(),
        };
        let endpoint = endpoint(
            &self.credential_api_url,
            "api/v1/execution-workers/mt5/credential-grants/consume",
        )?;
        let response = self
            .client
            .post(endpoint)
            .json(&request)
            .send()
            .map_err(|_| ManagedError("MANAGED_WORKER_CREDENTIAL_REQUEST_FAILED"))?;
        match response.status() {
            StatusCode::OK => decode_credential(response),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::CONFLICT => {
                Err(ManagedError("MANAGED_WORKER_SESSION_FENCED"))
            }
            _ => Err(ManagedError("MANAGED_WORKER_CREDENTIAL_GRANT_REJECTED")),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn post_snapshot(
        &self,
        session: &WorkerSession,
        account_id: &str,
        lease_generation: u64,
        sync_sequence: i64,
        observed_at_ms: i64,
        family: &str,
        fragment: &Value,
    ) -> Result<(), ManagedError> {
        validate_write_envelope(account_id, lease_generation, sync_sequence, observed_at_ms)?;
        let content_key = match family {
            "account" => "account",
            "positions" => "positions",
            "pending_orders" => "pending_orders",
            "instruments" => "instruments",
            _ => return Err(ManagedError("MANAGED_WORKER_SNAPSHOT_FRAGMENT_INVALID")),
        };
        let (result, error_code, content) = validated_fragment(fragment, content_key, false)?;
        let request = json!({
            "protocolVersion": session.protocol_version,
            "workerId": session.worker_id,
            "sessionGeneration": session.session_generation,
            "accountId": account_id,
            "leaseGeneration": lease_generation,
            "syncSequence": sync_sequence,
            "observedAtMs": observed_at_ms,
            "family": family,
            "result": result,
            "errorCode": error_code,
            "payload": {
                "kind": family,
                "data": { content_key: camelize_value(content)? }
            }
        });
        self.submit_phase4(
            session,
            "v1/mt5-vm/workers/snapshots",
            &request,
            "MANAGED_WORKER_SNAPSHOT_WRITE_INVALID",
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn post_history(
        &self,
        session: &WorkerSession,
        account_id: &str,
        lease_generation: u64,
        sync_sequence: i64,
        observed_at_ms: i64,
        from_ms: i64,
        to_ms: i64,
        family: &str,
        fragment: &Value,
    ) -> Result<(), ManagedError> {
        validate_write_envelope(account_id, lease_generation, sync_sequence, observed_at_ms)?;
        if from_ms <= 0 || to_ms <= from_ms || to_ms - from_ms > 31 * 24 * 60 * 60 * 1_000 {
            return Err(ManagedError("MANAGED_WORKER_HISTORY_FRAGMENT_INVALID"));
        }
        let content_key = match family {
            "orders_history" => "orders",
            "deals" => "deals",
            _ => return Err(ManagedError("MANAGED_WORKER_HISTORY_FRAGMENT_INVALID")),
        };
        let (result, error_code, content) = validated_fragment(fragment, content_key, true)?;
        let covered_through_ms = fragment.get("covered_through_ms").and_then(Value::as_i64);
        if (result == "complete"
            && !covered_through_ms.is_some_and(|value| value >= from_ms && value <= to_ms))
            || (result != "complete" && covered_through_ms.is_some())
        {
            return Err(ManagedError("MANAGED_WORKER_HISTORY_FRAGMENT_INVALID"));
        }
        let request = json!({
            "protocolVersion": session.protocol_version,
            "workerId": session.worker_id,
            "sessionGeneration": session.session_generation,
            "accountId": account_id,
            "leaseGeneration": lease_generation,
            "syncSequence": sync_sequence,
            "observedAtMs": observed_at_ms,
            "fromMs": from_ms,
            "toMs": to_ms,
            "coveredThroughMs": covered_through_ms,
            "family": family,
            "result": result,
            "errorCode": error_code,
            "cursor": Value::Null,
            "payload": {
                "kind": family,
                "data": { content_key: camelize_value(content)? }
            }
        });
        self.submit_phase4(
            session,
            "v1/mt5-vm/workers/history",
            &request,
            "MANAGED_WORKER_HISTORY_WRITE_INVALID",
        )
    }

    fn submit_phase4(
        &self,
        session: &WorkerSession,
        suffix: &str,
        request: &Value,
        invalid_code: &'static str,
    ) -> Result<(), ManagedError> {
        let response: Phase4WriteResponse =
            self.session_post(session, suffix, request, invalid_code)?;
        if !response.accepted || response.server_time_ms == 0 {
            return Err(ManagedError(invalid_code));
        }
        Ok(())
    }

    fn session_post<Request, Response>(
        &self,
        session: &WorkerSession,
        suffix: &str,
        request: &Request,
        invalid_code: &'static str,
    ) -> Result<Response, ManagedError>
    where
        Request: serde::Serialize + ?Sized,
        Response: serde::de::DeserializeOwned,
    {
        let endpoint = endpoint(&self.gateway_url, suffix)?;
        let response = self
            .client
            .post(endpoint)
            .bearer_auth(session.session_token.expose())
            .json(request)
            .send()
            .map_err(|_| ManagedError("MANAGED_WORKER_SESSION_REQUEST_FAILED"))?;
        match response.status() {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::CONFLICT => {
                Err(ManagedError("MANAGED_WORKER_SESSION_FENCED"))
            }
            StatusCode::OK => decode_json(response, invalid_code),
            _ => Err(ManagedError("MANAGED_WORKER_SESSION_REQUEST_REJECTED")),
        }
    }
}

pub trait ManagedRuntimeDriver {
    fn provision(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        credential: CredentialMaterial,
        probe_symbol: &str,
    ) -> Result<(), &'static str>;
    fn heartbeat(&mut self, account_id: &str, lease_generation: u64) -> Result<(), &'static str>;
    fn stop(&mut self, account_id: &str, lease_generation: u64) -> Result<(), &'static str>;
    fn snapshot_sync(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        symbols: &[String],
    ) -> Result<Value, &'static str>;
    fn history_sync(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        from_ms: i64,
        to_ms: i64,
    ) -> Result<Value, &'static str>;
}

impl ManagedRuntimeDriver for ProcessRuntimeDriver {
    fn provision(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        credential: CredentialMaterial,
        probe_symbol: &str,
    ) -> Result<(), &'static str> {
        let started =
            RuntimeDriver::start(self, account_id, lease_generation, credential, probe_symbol)
                .map_err(|error| error.error_class)?;
        if !started.snapshot.passes_phase1_demo_gate() {
            let _ = RuntimeDriver::stop(self, account_id, lease_generation);
            return Err("MANAGED_WORKER_INITIAL_SNAPSHOT_FAILED");
        }
        Ok(())
    }

    fn heartbeat(&mut self, account_id: &str, lease_generation: u64) -> Result<(), &'static str> {
        let heartbeat = RuntimeDriver::heartbeat(self, account_id, lease_generation)
            .map_err(|error| error.error_class)?;
        if !heartbeat.healthy || !heartbeat.login_matches || !heartbeat.server_matches {
            return Err("MANAGED_WORKER_RUNTIME_DEGRADED");
        }
        Ok(())
    }

    fn stop(&mut self, account_id: &str, lease_generation: u64) -> Result<(), &'static str> {
        RuntimeDriver::stop(self, account_id, lease_generation).map_err(|error| error.error_class)
    }

    fn snapshot_sync(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        symbols: &[String],
    ) -> Result<Value, &'static str> {
        ProcessRuntimeDriver::snapshot_sync(self, account_id, lease_generation, symbols)
            .map_err(|error| error.error_class)
    }

    fn history_sync(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        from_ms: i64,
        to_ms: i64,
    ) -> Result<Value, &'static str> {
        ProcessRuntimeDriver::history_sync(self, account_id, lease_generation, from_ms, to_ms)
            .map_err(|error| error.error_class)
    }
}

pub struct ManagedWorker<Driver> {
    client: ManagedControlClient,
    session: WorkerSession,
    driver: Driver,
    probe_symbol: String,
    sync_symbols: Vec<String>,
    history_lookback_ms: i64,
    leases: HashMap<String, u64>,
    sync_sequences: HashMap<String, i64>,
}

impl<Driver: ManagedRuntimeDriver> ManagedWorker<Driver> {
    pub fn new(
        client: ManagedControlClient,
        session: WorkerSession,
        driver: Driver,
        probe_symbol: String,
        mut sync_symbols: Vec<String>,
        history_lookback_ms: i64,
    ) -> Result<Self, ManagedError> {
        if !valid_symbol(&probe_symbol)
            || sync_symbols.len() > 256
            || sync_symbols.iter().any(|symbol| !valid_symbol(symbol))
            || history_lookback_ms < 60_000
            || history_lookback_ms > 31 * 24 * 60 * 60 * 1_000
        {
            return Err(ManagedError("MANAGED_WORKER_RUNTIME_CONFIG_INVALID"));
        }
        sync_symbols.sort();
        if sync_symbols.windows(2).any(|pair| pair[0] == pair[1]) {
            return Err(ManagedError("MANAGED_WORKER_RUNTIME_CONFIG_INVALID"));
        }
        if sync_symbols.is_empty() {
            sync_symbols.push(probe_symbol.clone());
        }
        Ok(Self {
            client,
            session,
            driver,
            probe_symbol,
            sync_symbols,
            history_lookback_ms,
            leases: HashMap::new(),
            sync_sequences: HashMap::new(),
        })
    }

    pub fn driver(&self) -> &Driver {
        &self.driver
    }

    pub fn heartbeat_interval(&self) -> Duration {
        Duration::from_millis(self.session.heartbeat_interval_ms)
    }

    pub fn control_heartbeat(&mut self) -> Result<(), ManagedError> {
        let leases = self
            .leases
            .iter()
            .map(|(account_id, lease_generation)| WorkerLeaseClaim {
                account_id: account_id.clone(),
                lease_generation: *lease_generation,
            })
            .collect::<Vec<_>>();
        for lease in &leases {
            self.driver
                .heartbeat(&lease.account_id, lease.lease_generation)
                .map_err(ManagedError)?;
        }
        self.client.heartbeat(
            &self.session,
            &WorkerHeartbeatRequest {
                protocol_version: self.session.protocol_version,
                worker_id: self.session.worker_id.clone(),
                session_generation: self.session.session_generation,
                leases,
            },
        )?;
        Ok(())
    }

    pub fn poll_and_process(&mut self) -> Result<(), ManagedError> {
        let response = self.client.poll(
            &self.session,
            &WorkerPollRequest {
                protocol_version: self.session.protocol_version,
                worker_id: self.session.worker_id.clone(),
                session_generation: self.session.session_generation,
                max_commands: Some(4),
            },
        )?;
        for command in response.commands {
            self.process_command(command)?;
        }
        Ok(())
    }

    pub fn reenroll(&mut self, request: &WorkerHelloRequest) -> Result<(), ManagedError> {
        let leases = self.leases.clone();
        for (account_id, lease_generation) in leases {
            self.driver
                .stop(&account_id, lease_generation)
                .map_err(ManagedError)?;
        }
        self.leases.clear();
        self.sync_sequences.clear();
        self.session = self.client.hello(request)?;
        Ok(())
    }

    pub fn process_command(
        &mut self,
        mut command: WorkerControlCommand,
    ) -> Result<bool, ManagedError> {
        if command.protocol_version != self.session.protocol_version
            || command.worker_id != self.session.worker_id
            || command.account_id.is_empty()
            || command.account_id.len() > 96
            || command.lease_generation == 0
            || command.command_id.is_empty()
            || command.message_id.is_empty()
            || command.expires_at_ms < unix_time_ms()
        {
            return Err(ManagedError("MANAGED_WORKER_COMMAND_INVALID"));
        }
        let payload_raw = Zeroizing::new(std::mem::take(&mut command.payload_json));
        if payload_raw.len() > MAX_FRAME_BYTES {
            return Err(ManagedError("MANAGED_WORKER_COMMAND_INVALID"));
        }
        let payload: Value = serde_json::from_str(&payload_raw)
            .map_err(|_| ManagedError("MANAGED_WORKER_COMMAND_INVALID"))?;
        if !payload.is_object() || contains_forbidden_secret_key(&payload) {
            return Err(ManagedError("MANAGED_WORKER_COMMAND_INVALID"));
        }
        let received = self.client.ack(
            &self.session,
            &command_ack(
                &self.session,
                &command,
                WorkerCommandAckKind::Received,
                None,
                None,
            ),
        )?;
        match received.status.as_str() {
            "succeeded" => return Ok(true),
            "failed" => return Ok(false),
            "received" => {}
            _ => return Err(ManagedError("MANAGED_WORKER_ACK_INVALID")),
        }

        let outcome = self.execute_command(&mut command, &payload);
        match outcome {
            Ok(result) => {
                let result_json = serde_json::to_string(&result)
                    .map_err(|_| ManagedError("MANAGED_WORKER_ACK_RESULT_INVALID"))?;
                let terminal = self.client.ack(
                    &self.session,
                    &command_ack(
                        &self.session,
                        &command,
                        WorkerCommandAckKind::Succeeded,
                        Some(result_json),
                        None,
                    ),
                )?;
                if terminal.status != "succeeded" {
                    return Err(ManagedError("MANAGED_WORKER_ACK_INVALID"));
                }
                Ok(true)
            }
            Err(error) => {
                let error_code = if valid_error_code(error.code()) {
                    error.code()
                } else {
                    "MANAGED_WORKER_COMMAND_FAILED"
                };
                let terminal = self.client.ack(
                    &self.session,
                    &command_ack(
                        &self.session,
                        &command,
                        WorkerCommandAckKind::Failed,
                        None,
                        Some(error_code.to_owned()),
                    ),
                )?;
                if terminal.status != "failed" {
                    return Err(ManagedError("MANAGED_WORKER_ACK_INVALID"));
                }
                Ok(false)
            }
        }
    }

    fn execute_command(
        &mut self,
        command: &mut WorkerControlCommand,
        payload: &Value,
    ) -> Result<Value, ManagedError> {
        let credential_grant = command
            .credential_grant
            .take()
            .map(SecretText::new)
            .transpose()?;
        match command.kind {
            WorkerCommandKind::ProvisionAccount => {
                let object = payload.as_object().expect("validated command payload");
                if object.len() != 1
                    || !object
                        .get("connectionRevision")
                        .and_then(Value::as_u64)
                        .is_some_and(|revision| revision > 0)
                {
                    return Err(ManagedError("MANAGED_WORKER_PROVISION_PAYLOAD_INVALID"));
                }
                if let Some(current) = self.leases.get(&command.account_id) {
                    return if *current == command.lease_generation {
                        Ok(json!({"status": "already_running"}))
                    } else {
                        Err(ManagedError("MANAGED_WORKER_LEASE_CONFLICT"))
                    };
                }
                let credential = self.client.consume_credential_grant(
                    &self.session,
                    &command.account_id,
                    command.lease_generation,
                    &command.command_id,
                    credential_grant
                        .ok_or(ManagedError("MANAGED_WORKER_CREDENTIAL_GRANT_MISSING"))?,
                )?;
                self.driver
                    .provision(
                        &command.account_id,
                        command.lease_generation,
                        credential,
                        &self.probe_symbol,
                    )
                    .map_err(ManagedError)?;
                self.leases
                    .insert(command.account_id.clone(), command.lease_generation);
                Ok(json!({"status": "synchronizing"}))
            }
            WorkerCommandKind::StopAccount => {
                if credential_grant.is_some()
                    || payload.as_object().is_some_and(|value| !value.is_empty())
                {
                    return Err(ManagedError("MANAGED_WORKER_STOP_PAYLOAD_INVALID"));
                }
                self.require_lease(command)?;
                self.driver
                    .stop(&command.account_id, command.lease_generation)
                    .map_err(ManagedError)?;
                self.leases.remove(&command.account_id);
                self.sync_sequences.remove(&command.account_id);
                Ok(json!({"status": "stopped"}))
            }
            WorkerCommandKind::ReconcileAccount => {
                if credential_grant.is_some()
                    || payload.as_object().is_some_and(|value| !value.is_empty())
                {
                    return Err(ManagedError("MANAGED_WORKER_RECONCILE_PAYLOAD_INVALID"));
                }
                self.require_lease(command)?;
                self.reconcile(command)?;
                Ok(json!({"status": "ready", "snapshotFamilies": 4, "historyFamilies": 2}))
            }
        }
    }

    fn require_lease(&self, command: &WorkerControlCommand) -> Result<(), ManagedError> {
        if self.leases.get(&command.account_id) != Some(&command.lease_generation) {
            return Err(ManagedError("MANAGED_WORKER_LEASE_FENCED"));
        }
        Ok(())
    }

    fn reconcile(&mut self, command: &WorkerControlCommand) -> Result<(), ManagedError> {
        self.driver
            .heartbeat(&command.account_id, command.lease_generation)
            .map_err(ManagedError)?;
        let snapshots = self
            .driver
            .snapshot_sync(
                &command.account_id,
                command.lease_generation,
                &self.sync_symbols,
            )
            .map_err(ManagedError)?;
        let snapshot_object = snapshots
            .as_object()
            .filter(|object| object.len() == 4)
            .ok_or(ManagedError("MANAGED_WORKER_SNAPSHOT_FRAGMENT_INVALID"))?;
        let observed_at_ms = unix_time_ms() as i64;
        for family in ["account", "positions", "pending_orders", "instruments"] {
            let sequence = self.next_sync_sequence(&command.account_id)?;
            let fragment = snapshot_object
                .get(family)
                .ok_or(ManagedError("MANAGED_WORKER_SNAPSHOT_FRAGMENT_INVALID"))?;
            self.client.post_snapshot(
                &self.session,
                &command.account_id,
                command.lease_generation,
                sequence,
                observed_at_ms,
                family,
                fragment,
            )?;
        }
        let to_ms = unix_time_ms() as i64;
        let from_ms = to_ms.saturating_sub(self.history_lookback_ms);
        let history = self
            .driver
            .history_sync(
                &command.account_id,
                command.lease_generation,
                from_ms,
                to_ms,
            )
            .map_err(ManagedError)?;
        let history_object = history
            .as_object()
            .filter(|object| object.len() == 2)
            .ok_or(ManagedError("MANAGED_WORKER_HISTORY_FRAGMENT_INVALID"))?;
        for family in ["orders_history", "deals"] {
            let sequence = self.next_sync_sequence(&command.account_id)?;
            let fragment = history_object
                .get(family)
                .ok_or(ManagedError("MANAGED_WORKER_HISTORY_FRAGMENT_INVALID"))?;
            self.client.post_history(
                &self.session,
                &command.account_id,
                command.lease_generation,
                sequence,
                observed_at_ms,
                from_ms,
                to_ms,
                family,
                fragment,
            )?;
        }
        Ok(())
    }

    fn next_sync_sequence(&mut self, account_id: &str) -> Result<i64, ManagedError> {
        let sequence = self
            .sync_sequences
            .entry(account_id.to_owned())
            .or_insert(0);
        *sequence = sequence
            .checked_add(1)
            .ok_or(ManagedError("MANAGED_WORKER_SYNC_SEQUENCE_EXHAUSTED"))?;
        Ok(*sequence)
    }
}

fn valid_symbol(value: &str) -> bool {
    !value.is_empty() && value.len() <= 64 && !value.chars().any(char::is_control)
}

fn command_ack(
    session: &WorkerSession,
    command: &WorkerControlCommand,
    ack: WorkerCommandAckKind,
    result_json: Option<String>,
    error_code: Option<String>,
) -> WorkerCommandAckRequest {
    WorkerCommandAckRequest {
        protocol_version: session.protocol_version,
        worker_id: session.worker_id.clone(),
        session_generation: session.session_generation,
        account_id: command.account_id.clone(),
        lease_generation: command.lease_generation,
        command_id: command.command_id.clone(),
        ack,
        result_json,
        error_code,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Phase4WriteResponse {
    accepted: bool,
    server_time_ms: u64,
}

fn validate_write_envelope(
    account_id: &str,
    lease_generation: u64,
    sync_sequence: i64,
    observed_at_ms: i64,
) -> Result<(), ManagedError> {
    if account_id.is_empty()
        || account_id.len() > 96
        || account_id.chars().any(char::is_control)
        || lease_generation == 0
        || sync_sequence <= 0
        || observed_at_ms <= 0
    {
        return Err(ManagedError("MANAGED_WORKER_SYNC_ENVELOPE_INVALID"));
    }
    Ok(())
}

fn validated_fragment<'a>(
    fragment: &'a Value,
    content_key: &str,
    history: bool,
) -> Result<(&'a str, Option<&'a str>, &'a Value), ManagedError> {
    let object = fragment
        .as_object()
        .ok_or(ManagedError("MANAGED_WORKER_SYNC_FRAGMENT_INVALID"))?;
    let expected_fields = if history { 4 } else { 3 };
    if object.len() != expected_fields
        || !object.contains_key("result")
        || !object.contains_key("error_code")
        || !object.contains_key(content_key)
        || (history && !object.contains_key("covered_through_ms"))
        || contains_forbidden_secret_key(fragment)
    {
        return Err(ManagedError("MANAGED_WORKER_SYNC_FRAGMENT_INVALID"));
    }
    let result = object
        .get("result")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "complete" | "partial" | "failed"))
        .ok_or(ManagedError("MANAGED_WORKER_SYNC_FRAGMENT_INVALID"))?;
    let error_code = match object.get("error_code") {
        Some(Value::Null) => None,
        Some(Value::String(value)) if valid_error_code(value) => Some(value.as_str()),
        _ => return Err(ManagedError("MANAGED_WORKER_SYNC_FRAGMENT_INVALID")),
    };
    if result == "complete" && error_code.is_some() {
        return Err(ManagedError("MANAGED_WORKER_SYNC_FRAGMENT_INVALID"));
    }
    let content = object
        .get(content_key)
        .ok_or(ManagedError("MANAGED_WORKER_SYNC_FRAGMENT_INVALID"))?;
    let count = match content {
        Value::Array(rows) => rows.len(),
        Value::Null => 0,
        Value::Object(_) if content_key == "account" => 1,
        _ => return Err(ManagedError("MANAGED_WORKER_SYNC_FRAGMENT_INVALID")),
    };
    if count > 4_096 {
        return Err(ManagedError("MANAGED_WORKER_SYNC_FRAGMENT_INVALID"));
    }
    Ok((result, error_code, content))
}

fn valid_error_code(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
}

fn contains_forbidden_secret_key(value: &Value) -> bool {
    match value {
        Value::Object(object) => object.iter().any(|(key, value)| {
            let canonical = key
                .bytes()
                .filter(|byte| byte.is_ascii_alphanumeric())
                .map(|byte| byte.to_ascii_lowercase() as char)
                .collect::<String>();
            matches!(
                canonical.as_str(),
                "password"
                    | "credential"
                    | "credentialgrant"
                    | "granttoken"
                    | "ipckey"
                    | "ipckeyhex"
                    | "login"
                    | "server"
            ) || contains_forbidden_secret_key(value)
        }),
        Value::Array(values) => values.iter().any(contains_forbidden_secret_key),
        _ => false,
    }
}

fn camelize_value(value: &Value) -> Result<Value, ManagedError> {
    match value {
        Value::Object(object) => {
            let mut converted = Map::with_capacity(object.len());
            for (key, value) in object {
                if key.is_empty() || key.len() > 128 || key.chars().any(char::is_control) {
                    return Err(ManagedError("MANAGED_WORKER_SYNC_FRAGMENT_INVALID"));
                }
                let mut camel = String::with_capacity(key.len());
                let mut uppercase_next = false;
                for character in key.chars() {
                    if character == '_' {
                        uppercase_next = true;
                    } else if uppercase_next {
                        camel.extend(character.to_uppercase());
                        uppercase_next = false;
                    } else {
                        camel.push(character);
                    }
                }
                if camel.is_empty() || converted.contains_key(&camel) {
                    return Err(ManagedError("MANAGED_WORKER_SYNC_FRAGMENT_INVALID"));
                }
                converted.insert(camel, camelize_value(value)?);
            }
            Ok(Value::Object(converted))
        }
        Value::Array(values) => values
            .iter()
            .map(camelize_value)
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        _ => Ok(value.clone()),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CredentialGrantConsumeRequest<'a> {
    protocol_version: u16,
    worker_id: &'a str,
    session_generation: u64,
    account_id: &'a str,
    lease_generation: u64,
    command_id: &'a str,
    grant_token: &'a str,
}

#[derive(Deserialize, Zeroize)]
#[serde(deny_unknown_fields)]
struct CredentialResponse {
    login: String,
    password: String,
    server: String,
}

fn decode_credential(
    response: reqwest::blocking::Response,
) -> Result<CredentialMaterial, ManagedError> {
    const MAX_CREDENTIAL_RESPONSE_BYTES: usize = 8 * 1024;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_CREDENTIAL_RESPONSE_BYTES as u64)
    {
        return Err(ManagedError("MANAGED_WORKER_CREDENTIAL_RESPONSE_INVALID"));
    }
    let mut body = Zeroizing::new(Vec::with_capacity(512));
    response
        .take((MAX_CREDENTIAL_RESPONSE_BYTES + 1) as u64)
        .read_to_end(&mut body)
        .map_err(|_| ManagedError("MANAGED_WORKER_CREDENTIAL_RESPONSE_INVALID"))?;
    if body.len() > MAX_CREDENTIAL_RESPONSE_BYTES {
        return Err(ManagedError("MANAGED_WORKER_CREDENTIAL_RESPONSE_INVALID"));
    }
    let parsed = serde_json::from_slice::<CredentialResponse>(&body)
        .map_err(|_| ManagedError("MANAGED_WORKER_CREDENTIAL_RESPONSE_INVALID"))?;
    let mut credential = Zeroizing::new(parsed);
    CredentialMaterial::new(
        std::mem::take(&mut credential.login),
        std::mem::take(&mut credential.password),
        std::mem::take(&mut credential.server),
    )
    .map_err(|_| ManagedError("MANAGED_WORKER_CREDENTIAL_RESPONSE_INVALID"))
}

fn validate_session_identity(
    session: &WorkerSession,
    protocol_version: u16,
    worker_id: &str,
    session_generation: u64,
) -> Result<(), ManagedError> {
    if protocol_version != session.protocol_version
        || worker_id != session.worker_id
        || session_generation != session.session_generation
    {
        return Err(ManagedError("MANAGED_WORKER_SESSION_IDENTITY_INVALID"));
    }
    Ok(())
}

fn endpoint(base: &Url, suffix: &str) -> Result<Url, ManagedError> {
    let mut endpoint = base.clone();
    let prefix = endpoint.path().trim_end_matches('/');
    endpoint.set_path(&format!("{prefix}/{suffix}"));
    endpoint.set_query(None);
    endpoint.set_fragment(None);
    Ok(endpoint)
}

fn decode_json<T: serde::de::DeserializeOwned>(
    response: reqwest::blocking::Response,
    error_code: &'static str,
) -> Result<T, ManagedError> {
    const MAX_RESPONSE_BYTES: usize = 16 * 1024;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(ManagedError(error_code));
    }
    let mut body = Vec::with_capacity(1024);
    response
        .take((MAX_RESPONSE_BYTES + 1) as u64)
        .read_to_end(&mut body)
        .map_err(|_| ManagedError(error_code))?;
    if body.len() > MAX_RESPONSE_BYTES {
        return Err(ManagedError(error_code));
    }
    serde_json::from_slice(&body).map_err(|_| ManagedError(error_code))
}

fn validate_hello_response(
    request: &WorkerHelloRequest,
    response: &WorkerHelloResponse,
) -> Result<(), ManagedError> {
    let token_valid = response.session_token.len() == 64
        && response
            .session_token
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit());
    if response.worker_id != request.worker_id
        || response.protocol_version < request.protocol_min
        || response.protocol_version > request.protocol_max
        || response.session_generation == 0
        || !token_valid
        || !(1_000..=300_000).contains(&response.heartbeat_interval_ms)
        || response.lease_ttl_ms <= response.heartbeat_interval_ms
        || response.lease_ttl_ms > 900_000
    {
        return Err(ManagedError("MANAGED_WORKER_HELLO_INVALID"));
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagedWorkerBootstrap {
    pub gateway_url: String,
    pub credential_api_url: String,
    pub bootstrap_token_file: PathBuf,
    pub process: ProcessDriverConfigInput,
    pub agent_version: String,
    pub image_version: String,
    pub runtime_version: String,
    pub region: String,
    pub probe_symbol: String,
    pub sync_symbols: Vec<String>,
    pub history_lookback_ms: i64,
    #[serde(default)]
    pub allow_loopback_http: bool,
}

impl ManagedWorkerBootstrap {
    fn validate(&self) -> Result<(), &'static str> {
        validate_transport_url(&self.gateway_url, self.allow_loopback_http)?;
        validate_transport_url(&self.credential_api_url, self.allow_loopback_http)?;
        validate_token_path(&self.bootstrap_token_file)?;
        if !valid_symbol(&self.probe_symbol)
            || self.sync_symbols.len() > 256
            || self.sync_symbols.iter().any(|symbol| !valid_symbol(symbol))
            || self.history_lookback_ms < 60_000
            || self.history_lookback_ms > 31 * 24 * 60 * 60 * 1_000
            || self.agent_version.is_empty()
            || self.agent_version.len() > 64
            || self.image_version.is_empty()
            || self.image_version.len() > 128
            || self.runtime_version.is_empty()
            || self.runtime_version.len() > 128
            || self.region.is_empty()
            || self.region.len() > 64
            || [
                &self.agent_version,
                &self.image_version,
                &self.runtime_version,
                &self.region,
            ]
            .into_iter()
            .any(|value| value.chars().any(char::is_control))
            || self.process.terminal_slots.is_empty()
            || self.process.terminal_slots.len() > 4
        {
            return Err("MANAGED_WORKER_RUNTIME_CONFIG_INVALID");
        }
        Ok(())
    }
}

fn validate_transport_url(value: &str, allow_loopback_http: bool) -> Result<Url, &'static str> {
    let url = Url::parse(value).map_err(|_| "MANAGED_WORKER_TRANSPORT_POLICY_INVALID")?;
    if url.cannot_be_a_base()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.host().is_none()
    {
        return Err("MANAGED_WORKER_TRANSPORT_POLICY_INVALID");
    }
    match url.scheme() {
        "https" => Ok(url),
        "http"
            if allow_loopback_http
                && url
                    .host_str()
                    .and_then(|host| host.parse::<std::net::IpAddr>().ok())
                    .is_some_and(|address| address.is_loopback()) =>
        {
            Ok(url)
        }
        _ => Err("MANAGED_WORKER_TRANSPORT_POLICY_INVALID"),
    }
}

fn validate_token_path(path: &Path) -> Result<(), &'static str> {
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("MANAGED_WORKER_TOKEN_PATH_INVALID");
    }
    let metadata = path
        .symlink_metadata()
        .map_err(|_| "MANAGED_WORKER_TOKEN_FILE_INVALID")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 4_096 {
        return Err("MANAGED_WORKER_TOKEN_FILE_INVALID");
    }
    Ok(())
}

pub fn run_from_reader(reader: &mut impl Read) -> Result<(), &'static str> {
    let mut raw = String::new();
    reader
        .take((MAX_FRAME_BYTES + 1) as u64)
        .read_to_string(&mut raw)
        .map_err(|_| "MANAGED_WORKER_CONFIG_READ_FAILED")?;
    if raw.is_empty() || raw.len() > MAX_FRAME_BYTES {
        raw.zeroize();
        return Err("MANAGED_WORKER_CONFIG_INVALID");
    }
    let parsed = serde_json::from_str::<ManagedWorkerBootstrap>(&raw);
    raw.zeroize();
    let bootstrap = parsed.map_err(|_| "MANAGED_WORKER_CONFIG_INVALID")?;
    bootstrap.validate()?;
    run_bootstrap(bootstrap).map_err(|error| error.code())
}

fn run_bootstrap(bootstrap: ManagedWorkerBootstrap) -> Result<(), ManagedError> {
    let gateway_url = validate_transport_url(&bootstrap.gateway_url, bootstrap.allow_loopback_http)
        .map_err(ManagedError)?;
    let credential_api_url =
        validate_transport_url(&bootstrap.credential_api_url, bootstrap.allow_loopback_http)
            .map_err(ManagedError)?;
    let bootstrap_token = read_token_file(&bootstrap.bootstrap_token_file)?;
    let worker_id = bootstrap.process.worker_id.clone();
    let capacity: u16 = bootstrap
        .process
        .terminal_slots
        .len()
        .try_into()
        .map_err(|_| ManagedError("MANAGED_WORKER_RUNTIME_CONFIG_INVALID"))?;
    let hello_request = WorkerHelloRequest {
        worker_id,
        protocol_min: 1,
        protocol_max: 1,
        agent_version: bootstrap.agent_version,
        image_version: bootstrap.image_version,
        runtime_version: bootstrap.runtime_version,
        capacity,
        region: bootstrap.region,
        capabilities: BTreeSet::from([
            "managed_credentials".to_owned(),
            "phase4_read_sync".to_owned(),
            "process_job_fencing".to_owned(),
        ]),
    };
    let process_config = ProcessDriverConfig::try_from(bootstrap.process)
        .map_err(|_| ManagedError("MANAGED_WORKER_PROCESS_CONFIG_INVALID"))?;
    let driver = ProcessRuntimeDriver::new(process_config)
        .map_err(|_| ManagedError("MANAGED_WORKER_PROCESS_CONFIG_INVALID"))?;
    let client = ManagedControlClient::new(gateway_url, credential_api_url, bootstrap_token)?;
    let session = client.hello(&hello_request)?;
    let worker = ManagedWorker::new(
        client,
        session,
        driver,
        bootstrap.probe_symbol,
        bootstrap.sync_symbols,
        bootstrap.history_lookback_ms,
    )?;
    run_worker_loop(worker, &hello_request)
}

fn read_token_file(path: &Path) -> Result<SecretText, ManagedError> {
    validate_token_path(path).map_err(ManagedError)?;
    let file = File::open(path).map_err(|_| ManagedError("MANAGED_WORKER_TOKEN_FILE_INVALID"))?;
    let mut raw = Zeroizing::new(String::with_capacity(256));
    file.take(4_097)
        .read_to_string(&mut raw)
        .map_err(|_| ManagedError("MANAGED_WORKER_TOKEN_FILE_INVALID"))?;
    if raw.len() > 4_096 {
        return Err(ManagedError("MANAGED_WORKER_TOKEN_FILE_INVALID"));
    }
    while raw.ends_with('\n') || raw.ends_with('\r') {
        raw.pop();
    }
    let token = std::mem::take(&mut *raw);
    SecretText::new(token).map_err(|_| ManagedError("MANAGED_WORKER_TOKEN_FILE_INVALID"))
}

fn run_worker_loop<Driver: ManagedRuntimeDriver>(
    mut worker: ManagedWorker<Driver>,
    hello_request: &WorkerHelloRequest,
) -> Result<(), ManagedError> {
    let mut next_heartbeat = Instant::now();
    let mut transient_failures = 0_u32;
    loop {
        let result = (|| {
            if Instant::now() >= next_heartbeat {
                worker.control_heartbeat()?;
                next_heartbeat = Instant::now() + worker.heartbeat_interval();
            }
            worker.poll_and_process()
        })();
        match result {
            Ok(()) => {
                transient_failures = 0;
                thread::sleep(Duration::from_secs(1));
            }
            Err(error) if error.code() == "MANAGED_WORKER_SESSION_FENCED" => {
                worker.reenroll(hello_request)?;
                next_heartbeat = Instant::now();
                transient_failures = 0;
            }
            Err(error) if transient_transport_error(error.code()) => {
                transient_failures = transient_failures.saturating_add(1);
                if transient_failures >= 8 {
                    return Err(error);
                }
                let backoff_seconds = 1_u64 << transient_failures.min(3);
                thread::sleep(Duration::from_secs(backoff_seconds));
            }
            Err(error) => return Err(error),
        }
    }
}

fn transient_transport_error(code: &str) -> bool {
    matches!(
        code,
        "MANAGED_WORKER_SESSION_REQUEST_FAILED"
            | "MANAGED_WORKER_HELLO_FAILED"
            | "MANAGED_WORKER_CREDENTIAL_REQUEST_FAILED"
    )
}
