use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{self, Receiver, SyncSender};
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

use crate::process::{
    EaBootstrapBinding, EaBootstrapMaterial, ProcessDriverConfig, ProcessDriverConfigInput,
    ProcessRuntimeDriver,
};
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

    pub(crate) fn expose(&self) -> &str {
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
            .bearer_auth(session.session_token.expose())
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

    fn ea_bootstrap_material(
        &self,
        session: &WorkerSession,
        token: SecretText,
        connection_revision: u64,
    ) -> Result<EaBootstrapMaterial, ManagedError> {
        if connection_revision == 0 {
            return Err(ManagedError("MANAGED_WORKER_PROVISION_PAYLOAD_INVALID"));
        }
        let bind_endpoint = endpoint(&self.gateway_url, "v1/mt5-vm/workers/ea-bootstrap/bind")?;
        let session_token = SecretText::new(session.session_token.expose().to_owned())
            .map_err(|_| ManagedError("MANAGED_WORKER_SESSION_FENCED"))?;
        Ok(EaBootstrapMaterial::new(
            token,
            self.client.clone(),
            bind_endpoint,
            session_token,
            EaBootstrapBinding::new(
                session.protocol_version,
                session.worker_id.clone(),
                session.session_generation,
                connection_revision,
            ),
        ))
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
        ea_bootstrap: Option<EaBootstrapMaterial>,
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

    fn parallelism(&self) -> usize {
        1
    }

    fn execute_batch(
        &mut self,
        tasks: Vec<ManagedRuntimeTask>,
    ) -> Vec<Result<ManagedRuntimeOutput, &'static str>> {
        tasks
            .into_iter()
            .map(|task| self.execute_task(task))
            .collect()
    }

    fn execute_task(
        &mut self,
        task: ManagedRuntimeTask,
    ) -> Result<ManagedRuntimeOutput, &'static str> {
        match task {
            ManagedRuntimeTask::Provision {
                account_id,
                lease_generation,
                credential,
                probe_symbol,
                ea_bootstrap,
            } => {
                self.provision(
                    &account_id,
                    lease_generation,
                    credential,
                    &probe_symbol,
                    ea_bootstrap.map(|material| *material),
                )?;
                Ok(ManagedRuntimeOutput::Provisioned)
            }
            ManagedRuntimeTask::Heartbeat {
                account_id,
                lease_generation,
            } => {
                self.heartbeat(&account_id, lease_generation)?;
                Ok(ManagedRuntimeOutput::Heartbeat)
            }
            ManagedRuntimeTask::Stop {
                account_id,
                lease_generation,
            } => {
                self.stop(&account_id, lease_generation)?;
                Ok(ManagedRuntimeOutput::Stopped)
            }
            ManagedRuntimeTask::Reconcile {
                account_id,
                lease_generation,
                symbols,
                from_ms,
                to_ms,
            } => {
                self.heartbeat(&account_id, lease_generation)?;
                let snapshots = self.snapshot_sync(&account_id, lease_generation, &symbols)?;
                let history = self.history_sync(&account_id, lease_generation, from_ms, to_ms)?;
                Ok(ManagedRuntimeOutput::Reconciled {
                    snapshots,
                    history,
                    from_ms,
                    to_ms,
                })
            }
        }
    }
}

pub enum ManagedRuntimeTask {
    Provision {
        account_id: String,
        lease_generation: u64,
        credential: CredentialMaterial,
        probe_symbol: String,
        ea_bootstrap: Option<Box<EaBootstrapMaterial>>,
    },
    Heartbeat {
        account_id: String,
        lease_generation: u64,
    },
    Stop {
        account_id: String,
        lease_generation: u64,
    },
    Reconcile {
        account_id: String,
        lease_generation: u64,
        symbols: Vec<String>,
        from_ms: i64,
        to_ms: i64,
    },
}

impl ManagedRuntimeTask {
    fn account_id(&self) -> &str {
        match self {
            Self::Provision { account_id, .. }
            | Self::Heartbeat { account_id, .. }
            | Self::Stop { account_id, .. }
            | Self::Reconcile { account_id, .. } => account_id,
        }
    }

    fn lease_generation(&self) -> u64 {
        match self {
            Self::Provision {
                lease_generation, ..
            }
            | Self::Heartbeat {
                lease_generation, ..
            }
            | Self::Stop {
                lease_generation, ..
            }
            | Self::Reconcile {
                lease_generation, ..
            } => *lease_generation,
        }
    }

    fn kind(&self) -> RuntimeTaskKind {
        match self {
            Self::Provision { .. } => RuntimeTaskKind::Provision,
            Self::Heartbeat { .. } => RuntimeTaskKind::Heartbeat,
            Self::Stop { .. } => RuntimeTaskKind::Stop,
            Self::Reconcile { .. } => RuntimeTaskKind::Reconcile,
        }
    }
}

pub enum ManagedRuntimeOutput {
    Provisioned,
    Heartbeat,
    Stopped,
    Reconciled {
        snapshots: Value,
        history: Value,
        from_ms: i64,
        to_ms: i64,
    },
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RuntimeTaskKind {
    Provision,
    Heartbeat,
    Stop,
    Reconcile,
}

#[derive(Clone, PartialEq, Eq)]
struct ActorAssignment {
    account_id: String,
    lease_generation: u64,
    poisoned: bool,
}

enum ActorMessage {
    Execute {
        task: ManagedRuntimeTask,
        reply: SyncSender<Result<ManagedRuntimeOutput, &'static str>>,
    },
    Shutdown,
}

struct RuntimeActor {
    sender: SyncSender<ActorMessage>,
    handle: Option<thread::JoinHandle<()>>,
}

pub struct SlotActorRuntimeDriver<Driver> {
    actors: Vec<RuntimeActor>,
    assignments: Vec<Option<ActorAssignment>>,
    _driver: std::marker::PhantomData<Driver>,
}

impl<Driver: ManagedRuntimeDriver + Send + 'static> SlotActorRuntimeDriver<Driver> {
    pub fn new(drivers: Vec<Driver>) -> Result<Self, ManagedError> {
        if drivers.is_empty() || drivers.len() > 4 {
            return Err(ManagedError("MANAGED_WORKER_RUNTIME_CONFIG_INVALID"));
        }
        let mut actors = Vec::with_capacity(drivers.len());
        for (index, mut driver) in drivers.into_iter().enumerate() {
            let (sender, receiver) = mpsc::sync_channel::<ActorMessage>(1);
            let handle = thread::Builder::new()
                .name(format!("mt5-slot-actor-{index}"))
                .spawn(move || {
                    while let Ok(message) = receiver.recv() {
                        match message {
                            ActorMessage::Execute { task, reply } => {
                                let _ = reply.send(driver.execute_task(task));
                            }
                            ActorMessage::Shutdown => break,
                        }
                    }
                })
                .map_err(|_| ManagedError("MANAGED_WORKER_ACTOR_START_FAILED"))?;
            actors.push(RuntimeActor {
                sender,
                handle: Some(handle),
            });
        }
        Ok(Self {
            assignments: vec![None; actors.len()],
            actors,
            _driver: std::marker::PhantomData,
        })
    }

    fn actor_for_task(&mut self, task: &ManagedRuntimeTask) -> Result<usize, &'static str> {
        let account_id = task.account_id();
        let lease_generation = task.lease_generation();
        if let Some(index) = self.assignments.iter().position(|assignment| {
            assignment.as_ref().is_some_and(|assignment| {
                assignment.account_id == account_id
                    && assignment.lease_generation == lease_generation
            })
        }) {
            if self.assignments[index]
                .as_ref()
                .is_some_and(|assignment| assignment.poisoned)
                && task.kind() != RuntimeTaskKind::Stop
            {
                return Err("MANAGED_WORKER_SLOT_POISONED");
            }
            return Ok(index);
        }
        if task.kind() != RuntimeTaskKind::Provision {
            return Err("MANAGED_WORKER_LEASE_FENCED");
        }
        if self
            .assignments
            .iter()
            .flatten()
            .any(|assignment| assignment.account_id == account_id)
        {
            return Err("MANAGED_WORKER_LEASE_CONFLICT");
        }
        let index = self
            .assignments
            .iter()
            .position(Option::is_none)
            .ok_or("TERMINAL_SLOT_CAPACITY_EXHAUSTED")?;
        self.assignments[index] = Some(ActorAssignment {
            account_id: account_id.to_owned(),
            lease_generation,
            poisoned: false,
        });
        Ok(index)
    }

    fn execute_actor_batch(
        &mut self,
        tasks: Vec<ManagedRuntimeTask>,
    ) -> Vec<Result<ManagedRuntimeOutput, &'static str>> {
        struct Pending {
            index: usize,
            account_id: String,
            lease_generation: u64,
            kind: RuntimeTaskKind,
            receiver: Receiver<Result<ManagedRuntimeOutput, &'static str>>,
        }

        let mut results = (0..tasks.len()).map(|_| None).collect::<Vec<_>>();
        let mut pending = Vec::with_capacity(tasks.len());
        for (result_index, task) in tasks.into_iter().enumerate() {
            let account_id = task.account_id().to_owned();
            let lease_generation = task.lease_generation();
            let kind = task.kind();
            let actor_index = match self.actor_for_task(&task) {
                Ok(index) => index,
                Err(error) => {
                    results[result_index] = Some(Err(error));
                    continue;
                }
            };
            let (reply, receiver) = mpsc::sync_channel(1);
            if self.actors[actor_index]
                .sender
                .send(ActorMessage::Execute { task, reply })
                .is_err()
            {
                if let Some(assignment) = self.assignments[actor_index].as_mut() {
                    assignment.poisoned = true;
                }
                results[result_index] = Some(Err("MANAGED_WORKER_ACTOR_UNAVAILABLE"));
                continue;
            }
            pending.push((
                result_index,
                Pending {
                    index: actor_index,
                    account_id,
                    lease_generation,
                    kind,
                    receiver,
                },
            ));
        }

        for (result_index, pending) in pending {
            let result = pending
                .receiver
                .recv()
                .unwrap_or(Err("MANAGED_WORKER_ACTOR_UNAVAILABLE"));
            match (&result, pending.kind) {
                (Ok(ManagedRuntimeOutput::Stopped), RuntimeTaskKind::Stop) => {
                    self.assignments[pending.index] = None;
                }
                (Err(_), RuntimeTaskKind::Provision) => {
                    let cleanup = self.execute_on_actor(
                        pending.index,
                        ManagedRuntimeTask::Stop {
                            account_id: pending.account_id.clone(),
                            lease_generation: pending.lease_generation,
                        },
                    );
                    if cleanup.is_ok() || matches!(cleanup, Err("RUNTIME_NOT_FOUND")) {
                        self.assignments[pending.index] = None;
                    } else if let Some(assignment) = self.assignments[pending.index].as_mut() {
                        assignment.poisoned = true;
                    }
                }
                (Err(_), RuntimeTaskKind::Stop) => {
                    if let Some(assignment) = self.assignments[pending.index].as_mut() {
                        assignment.poisoned = true;
                    }
                }
                _ => {}
            }
            results[result_index] = Some(result);
        }
        results
            .into_iter()
            .map(|result| result.unwrap_or(Err("MANAGED_WORKER_ACTOR_UNAVAILABLE")))
            .collect()
    }

    fn execute_on_actor(
        &self,
        actor_index: usize,
        task: ManagedRuntimeTask,
    ) -> Result<ManagedRuntimeOutput, &'static str> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.actors[actor_index]
            .sender
            .send(ActorMessage::Execute { task, reply })
            .map_err(|_| "MANAGED_WORKER_ACTOR_UNAVAILABLE")?;
        receiver
            .recv()
            .unwrap_or(Err("MANAGED_WORKER_ACTOR_UNAVAILABLE"))
    }
}

impl<Driver> Drop for SlotActorRuntimeDriver<Driver> {
    fn drop(&mut self) {
        for actor in &self.actors {
            let _ = actor.sender.send(ActorMessage::Shutdown);
        }
        for actor in &mut self.actors {
            if let Some(handle) = actor.handle.take() {
                let _ = handle.join();
            }
        }
    }
}

impl<Driver: ManagedRuntimeDriver + Send + 'static> ManagedRuntimeDriver
    for SlotActorRuntimeDriver<Driver>
{
    fn provision(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        credential: CredentialMaterial,
        probe_symbol: &str,
        ea_bootstrap: Option<EaBootstrapMaterial>,
    ) -> Result<(), &'static str> {
        match self
            .execute_actor_batch(vec![ManagedRuntimeTask::Provision {
                account_id: account_id.to_owned(),
                lease_generation,
                credential,
                probe_symbol: probe_symbol.to_owned(),
                ea_bootstrap: ea_bootstrap.map(Box::new),
            }])
            .pop()
            .expect("one actor result")?
        {
            ManagedRuntimeOutput::Provisioned => Ok(()),
            _ => Err("MANAGED_WORKER_ACTOR_RESULT_INVALID"),
        }
    }

    fn heartbeat(&mut self, account_id: &str, lease_generation: u64) -> Result<(), &'static str> {
        match self
            .execute_actor_batch(vec![ManagedRuntimeTask::Heartbeat {
                account_id: account_id.to_owned(),
                lease_generation,
            }])
            .pop()
            .expect("one actor result")?
        {
            ManagedRuntimeOutput::Heartbeat => Ok(()),
            _ => Err("MANAGED_WORKER_ACTOR_RESULT_INVALID"),
        }
    }

    fn stop(&mut self, account_id: &str, lease_generation: u64) -> Result<(), &'static str> {
        match self
            .execute_actor_batch(vec![ManagedRuntimeTask::Stop {
                account_id: account_id.to_owned(),
                lease_generation,
            }])
            .pop()
            .expect("one actor result")?
        {
            ManagedRuntimeOutput::Stopped => Ok(()),
            _ => Err("MANAGED_WORKER_ACTOR_RESULT_INVALID"),
        }
    }

    fn snapshot_sync(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _symbols: &[String],
    ) -> Result<Value, &'static str> {
        Err("MANAGED_WORKER_ACTOR_BATCH_REQUIRED")
    }

    fn history_sync(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _from_ms: i64,
        _to_ms: i64,
    ) -> Result<Value, &'static str> {
        Err("MANAGED_WORKER_ACTOR_BATCH_REQUIRED")
    }

    fn parallelism(&self) -> usize {
        self.actors.len()
    }

    fn execute_batch(
        &mut self,
        tasks: Vec<ManagedRuntimeTask>,
    ) -> Vec<Result<ManagedRuntimeOutput, &'static str>> {
        self.execute_actor_batch(tasks)
    }
}

impl ManagedRuntimeDriver for ProcessRuntimeDriver {
    fn provision(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        credential: CredentialMaterial,
        probe_symbol: &str,
        ea_bootstrap: Option<EaBootstrapMaterial>,
    ) -> Result<(), &'static str> {
        let started = self
            .start_with_ea_bootstrap(
                account_id,
                lease_generation,
                credential,
                probe_symbol,
                ea_bootstrap,
            )
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
    worker_substrate: String,
    leases: HashMap<String, u64>,
    sync_sequences: HashMap<String, i64>,
}

fn take_command_payload(
    session: &WorkerSession,
    command: &mut WorkerControlCommand,
) -> Result<Value, ManagedError> {
    if command.protocol_version != session.protocol_version
        || command.worker_id != session.worker_id
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
    Ok(payload)
}

enum ParallelPreparation {
    Immediate(Result<Value, ManagedError>),
    Task(Option<ManagedRuntimeTask>),
}

impl<Driver: ManagedRuntimeDriver> ManagedWorker<Driver> {
    pub fn new(
        client: ManagedControlClient,
        session: WorkerSession,
        driver: Driver,
        probe_symbol: String,
        sync_symbols: Vec<String>,
        history_lookback_ms: i64,
    ) -> Result<Self, ManagedError> {
        Self::new_with_substrate(
            client,
            session,
            driver,
            probe_symbol,
            sync_symbols,
            history_lookback_ms,
            "windows_vm",
        )
    }

    pub fn new_with_substrate(
        client: ManagedControlClient,
        session: WorkerSession,
        driver: Driver,
        probe_symbol: String,
        mut sync_symbols: Vec<String>,
        history_lookback_ms: i64,
        worker_substrate: &str,
    ) -> Result<Self, ManagedError> {
        if !valid_symbol(&probe_symbol)
            || sync_symbols.len() > 256
            || sync_symbols.iter().any(|symbol| !valid_symbol(symbol))
            || !(60_000..=31 * 24 * 60 * 60 * 1_000).contains(&history_lookback_ms)
            || !matches!(worker_substrate, "windows_vm" | "bare_metal")
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
            worker_substrate: worker_substrate.to_owned(),
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
        let mut leases = self
            .leases
            .iter()
            .map(|(account_id, lease_generation)| WorkerLeaseClaim {
                account_id: account_id.clone(),
                lease_generation: *lease_generation,
            })
            .collect::<Vec<_>>();
        if self.driver.parallelism() > 1 {
            let tasks = leases
                .iter()
                .map(|lease| ManagedRuntimeTask::Heartbeat {
                    account_id: lease.account_id.clone(),
                    lease_generation: lease.lease_generation,
                })
                .collect::<Vec<_>>();
            let results = self.driver.execute_batch(tasks);
            if results.len() != leases.len() {
                return Err(ManagedError("MANAGED_WORKER_ACTOR_RESULT_INVALID"));
            }
            leases = leases
                .into_iter()
                .zip(results)
                .filter_map(|(lease, result)| {
                    matches!(result, Ok(ManagedRuntimeOutput::Heartbeat)).then_some(lease)
                })
                .collect();
        } else {
            for lease in &leases {
                self.driver
                    .heartbeat(&lease.account_id, lease.lease_generation)
                    .map_err(ManagedError)?;
            }
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
        if self.driver.parallelism() > 1 {
            return self.process_parallel_commands(response.commands);
        }
        for command in response.commands {
            self.process_command(command)?;
        }
        Ok(())
    }

    fn process_parallel_commands(
        &mut self,
        commands: Vec<WorkerControlCommand>,
    ) -> Result<(), ManagedError> {
        let mut pending = VecDeque::from(commands);
        let width = self.driver.parallelism().clamp(1, 4);
        while !pending.is_empty() {
            let mut accounts = HashSet::with_capacity(width);
            let mut wave = Vec::with_capacity(width);
            let mut deferred = VecDeque::new();
            while let Some(command) = pending.pop_front() {
                if wave.len() < width && accounts.insert(command.account_id.clone()) {
                    wave.push(command);
                } else {
                    deferred.push_back(command);
                }
            }
            pending = deferred;
            self.process_parallel_wave(wave)?;
        }
        Ok(())
    }

    fn process_parallel_wave(
        &mut self,
        wave: Vec<WorkerControlCommand>,
    ) -> Result<(), ManagedError> {
        let mut prepared = Vec::with_capacity(wave.len());
        for mut command in wave {
            let Some(payload) = self.receive_and_validate_command(&mut command)? else {
                continue;
            };
            match self.prepare_parallel_task(&mut command, &payload) {
                Ok(ParallelPreparation::Immediate(outcome)) => {
                    self.ack_parallel_outcome(&command, outcome)?;
                }
                Ok(ParallelPreparation::Task(task)) => prepared.push((command, task)),
                Err(error) => {
                    self.ack_parallel_outcome(&command, Err(error))?;
                }
            }
        }

        let tasks = prepared
            .iter_mut()
            .map(|(_, task)| task.take().expect("prepared task consumed once"))
            .collect::<Vec<_>>();
        let results = self.driver.execute_batch(tasks);
        if results.len() != prepared.len() {
            return Err(ManagedError("MANAGED_WORKER_ACTOR_RESULT_INVALID"));
        }
        for ((command, _), result) in prepared.into_iter().zip(results) {
            let outcome = match result {
                Ok(ManagedRuntimeOutput::Provisioned) => {
                    self.leases
                        .insert(command.account_id.clone(), command.lease_generation);
                    Ok(json!({"status": "synchronizing"}))
                }
                Ok(ManagedRuntimeOutput::Stopped) => {
                    self.leases.remove(&command.account_id);
                    self.sync_sequences.remove(&command.account_id);
                    Ok(json!({"status": "stopped"}))
                }
                Ok(ManagedRuntimeOutput::Reconciled {
                    snapshots,
                    history,
                    from_ms,
                    to_ms,
                }) => self
                    .post_reconcile_output(
                        &command.account_id,
                        command.lease_generation,
                        snapshots,
                        history,
                        from_ms,
                        to_ms,
                    )
                    .map(
                        |_| json!({"status": "ready", "snapshotFamilies": 4, "historyFamilies": 2}),
                    ),
                Ok(ManagedRuntimeOutput::Heartbeat) => {
                    Err(ManagedError("MANAGED_WORKER_ACTOR_RESULT_INVALID"))
                }
                Err(error) => Err(ManagedError(error)),
            };
            self.ack_parallel_outcome(&command, outcome)?;
        }
        Ok(())
    }

    fn receive_and_validate_command(
        &self,
        command: &mut WorkerControlCommand,
    ) -> Result<Option<Value>, ManagedError> {
        let payload = take_command_payload(&self.session, command)?;
        let received = self.client.ack(
            &self.session,
            &command_ack(
                &self.session,
                command,
                WorkerCommandAckKind::Received,
                None,
                None,
            ),
        )?;
        match received.status.as_str() {
            "succeeded" | "failed" => Ok(None),
            "received" => Ok(Some(payload)),
            _ => Err(ManagedError("MANAGED_WORKER_ACK_INVALID")),
        }
    }

    fn ea_bootstrap_for_command(
        &self,
        ea_bootstrap_token: Option<SecretText>,
        connection_revision: u64,
    ) -> Result<Option<EaBootstrapMaterial>, ManagedError> {
        if self.worker_substrate == "bare_metal" {
            let token = ea_bootstrap_token
                .ok_or(ManagedError("MANAGED_WORKER_EA_BOOTSTRAP_TOKEN_MISSING"))?;
            return self
                .client
                .ea_bootstrap_material(
                    &self.session,
                    validate_ea_bootstrap_token(token)?,
                    connection_revision,
                )
                .map(Some);
        }
        if ea_bootstrap_token.is_some() {
            return Err(ManagedError("MANAGED_WORKER_EA_BOOTSTRAP_TOKEN_UNEXPECTED"));
        }
        Ok(None)
    }

    fn prepare_parallel_task(
        &mut self,
        command: &mut WorkerControlCommand,
        payload: &Value,
    ) -> Result<ParallelPreparation, ManagedError> {
        let credential_grant = command
            .credential_grant
            .take()
            .map(SecretText::new)
            .transpose()?;
        let ea_bootstrap_token = command
            .ea_bootstrap_token
            .take()
            .map(SecretText::new)
            .transpose()?;
        match command.kind {
            WorkerCommandKind::ProvisionAccount => {
                let object = payload.as_object().expect("validated command payload");
                let connection_revision = object
                    .get("connectionRevision")
                    .and_then(Value::as_u64)
                    .filter(|revision| *revision > 0);
                if object.len() != 1 || connection_revision.is_none() {
                    return Err(ManagedError("MANAGED_WORKER_PROVISION_PAYLOAD_INVALID"));
                }
                let connection_revision = connection_revision.expect("validated revision");
                let ea_bootstrap =
                    self.ea_bootstrap_for_command(ea_bootstrap_token, connection_revision)?;
                if let Some(current) = self.leases.get(&command.account_id) {
                    return if *current == command.lease_generation {
                        Ok(ParallelPreparation::Immediate(Ok(
                            json!({"status": "already_running"}),
                        )))
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
                Ok(ParallelPreparation::Task(Some(
                    ManagedRuntimeTask::Provision {
                        account_id: command.account_id.clone(),
                        lease_generation: command.lease_generation,
                        credential,
                        probe_symbol: self.probe_symbol.clone(),
                        ea_bootstrap: ea_bootstrap.map(Box::new),
                    },
                )))
            }
            WorkerCommandKind::StopAccount => {
                if credential_grant.is_some()
                    || ea_bootstrap_token.is_some()
                    || payload.as_object().is_some_and(|value| !value.is_empty())
                {
                    return Err(ManagedError("MANAGED_WORKER_STOP_PAYLOAD_INVALID"));
                }
                match self.leases.get(&command.account_id) {
                    Some(current) if *current == command.lease_generation => {
                        Ok(ParallelPreparation::Task(Some(ManagedRuntimeTask::Stop {
                            account_id: command.account_id.clone(),
                            lease_generation: command.lease_generation,
                        })))
                    }
                    Some(_) => Err(ManagedError("MANAGED_WORKER_LEASE_FENCED")),
                    None => Ok(ParallelPreparation::Immediate(Ok(
                        json!({"status": "stopped"}),
                    ))),
                }
            }
            WorkerCommandKind::ReconcileAccount => {
                if credential_grant.is_some()
                    || ea_bootstrap_token.is_some()
                    || payload.as_object().is_some_and(|value| !value.is_empty())
                {
                    return Err(ManagedError("MANAGED_WORKER_RECONCILE_PAYLOAD_INVALID"));
                }
                self.require_lease(command)?;
                let to_ms = unix_time_ms() as i64;
                let from_ms = to_ms.saturating_sub(self.history_lookback_ms);
                Ok(ParallelPreparation::Task(Some(
                    ManagedRuntimeTask::Reconcile {
                        account_id: command.account_id.clone(),
                        lease_generation: command.lease_generation,
                        symbols: self.sync_symbols.clone(),
                        from_ms,
                        to_ms,
                    },
                )))
            }
        }
    }

    fn post_reconcile_output(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        snapshots: Value,
        history: Value,
        from_ms: i64,
        to_ms: i64,
    ) -> Result<(), ManagedError> {
        let snapshot_object = snapshots
            .as_object()
            .filter(|object| object.len() == 4)
            .ok_or(ManagedError("MANAGED_WORKER_SNAPSHOT_FRAGMENT_INVALID"))?;
        let observed_at_ms = unix_time_ms() as i64;
        for family in ["account", "positions", "pending_orders", "instruments"] {
            let sequence = self.next_sync_sequence(account_id)?;
            let fragment = snapshot_object
                .get(family)
                .ok_or(ManagedError("MANAGED_WORKER_SNAPSHOT_FRAGMENT_INVALID"))?;
            self.client.post_snapshot(
                &self.session,
                account_id,
                lease_generation,
                sequence,
                observed_at_ms,
                family,
                fragment,
            )?;
        }
        let history_object = history
            .as_object()
            .filter(|object| object.len() == 2)
            .ok_or(ManagedError("MANAGED_WORKER_HISTORY_FRAGMENT_INVALID"))?;
        for family in ["orders_history", "deals"] {
            let sequence = self.next_sync_sequence(account_id)?;
            let fragment = history_object
                .get(family)
                .ok_or(ManagedError("MANAGED_WORKER_HISTORY_FRAGMENT_INVALID"))?;
            self.client.post_history(
                &self.session,
                account_id,
                lease_generation,
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

    fn ack_parallel_outcome(
        &self,
        command: &WorkerControlCommand,
        outcome: Result<Value, ManagedError>,
    ) -> Result<bool, ManagedError> {
        match outcome {
            Ok(result) => {
                let result_json = serde_json::to_string(&result)
                    .map_err(|_| ManagedError("MANAGED_WORKER_ACK_RESULT_INVALID"))?;
                let terminal = self.client.ack(
                    &self.session,
                    &command_ack(
                        &self.session,
                        command,
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
                        command,
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

    pub fn reenroll(&mut self, request: &WorkerHelloRequest) -> Result<(), ManagedError> {
        let leases = self.leases.clone();
        if self.driver.parallelism() > 1 {
            let tasks = leases
                .iter()
                .map(|(account_id, lease_generation)| ManagedRuntimeTask::Stop {
                    account_id: account_id.clone(),
                    lease_generation: *lease_generation,
                })
                .collect::<Vec<_>>();
            let results = self.driver.execute_batch(tasks);
            if results.len() != leases.len() {
                return Err(ManagedError("MANAGED_WORKER_ACTOR_RESULT_INVALID"));
            }
            let mut first_error = None;
            for result in results {
                if let Err(error) = result {
                    first_error.get_or_insert(error);
                }
            }
            if let Some(error) = first_error {
                return Err(ManagedError(error));
            }
        } else {
            for (account_id, lease_generation) in leases {
                self.driver
                    .stop(&account_id, lease_generation)
                    .map_err(ManagedError)?;
            }
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
        let payload = take_command_payload(&self.session, &mut command)?;
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
        let ea_bootstrap_token = command
            .ea_bootstrap_token
            .take()
            .map(SecretText::new)
            .transpose()?;
        match command.kind {
            WorkerCommandKind::ProvisionAccount => {
                let object = payload.as_object().expect("validated command payload");
                let connection_revision = object
                    .get("connectionRevision")
                    .and_then(Value::as_u64)
                    .filter(|revision| *revision > 0);
                if object.len() != 1 || connection_revision.is_none() {
                    return Err(ManagedError("MANAGED_WORKER_PROVISION_PAYLOAD_INVALID"));
                }
                let connection_revision = connection_revision.expect("validated revision");
                let ea_bootstrap =
                    self.ea_bootstrap_for_command(ea_bootstrap_token, connection_revision)?;
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
                        ea_bootstrap,
                    )
                    .map_err(ManagedError)?;
                self.leases
                    .insert(command.account_id.clone(), command.lease_generation);
                Ok(json!({"status": "synchronizing"}))
            }
            WorkerCommandKind::StopAccount => {
                if credential_grant.is_some()
                    || ea_bootstrap_token.is_some()
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
                    || ea_bootstrap_token.is_some()
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

fn validate_ea_bootstrap_token(token: SecretText) -> Result<SecretText, ManagedError> {
    if token.expose().len() != 64 || !token.expose().bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ManagedError("MANAGED_WORKER_EA_BOOTSTRAP_TOKEN_INVALID"));
    }
    Ok(token)
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
    #[serde(default = "default_worker_substrate")]
    pub worker_substrate: String,
    #[serde(default)]
    pub allow_loopback_http: bool,
}

fn default_worker_substrate() -> String {
    "windows_vm".to_owned()
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
            || !matches!(self.worker_substrate.as_str(), "windows_vm" | "bare_metal")
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
    let worker_substrate = bootstrap.worker_substrate.clone();
    let mut capabilities = BTreeSet::from([
        "managed_credentials".to_owned(),
        "phase4_read_sync".to_owned(),
        "process_job_fencing".to_owned(),
    ]);
    capabilities.insert(worker_substrate.clone());
    let hello_request = WorkerHelloRequest {
        worker_id,
        protocol_min: 1,
        protocol_max: 1,
        agent_version: bootstrap.agent_version,
        image_version: bootstrap.image_version,
        runtime_version: bootstrap.runtime_version,
        capacity,
        region: bootstrap.region,
        capabilities,
    };
    let process_config = ProcessDriverConfig::try_from(bootstrap.process)
        .map_err(|_| ManagedError("MANAGED_WORKER_PROCESS_CONFIG_INVALID"))?;
    let drivers = process_config
        .into_slot_configs()
        .into_iter()
        .map(ProcessRuntimeDriver::new)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| ManagedError("MANAGED_WORKER_PROCESS_CONFIG_INVALID"))?;
    let driver = SlotActorRuntimeDriver::new(drivers)?;
    let client = ManagedControlClient::new(gateway_url, credential_api_url, bootstrap_token)?;
    let session = client.hello(&hello_request)?;
    let worker = ManagedWorker::new_with_substrate(
        client,
        session,
        driver,
        bootstrap.probe_symbol,
        bootstrap.sync_symbols,
        bootstrap.history_lookback_ms,
        &worker_substrate,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::{ArtifactPins, TerminalSlotConfig};

    fn read_test_http_request(stream: &mut std::net::TcpStream) -> String {
        use std::io::{BufRead as _, BufReader, Read as _};

        let mut reader = BufReader::new(stream.try_clone().expect("clone test HTTP stream"));
        let mut headers = String::new();
        loop {
            let mut line = String::new();
            let count = reader.read_line(&mut line).expect("read test HTTP header");
            assert!(count > 0, "test HTTP request ended before its headers");
            headers.push_str(&line);
            if line == "\r\n" {
                break;
            }
        }
        let content_length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .unwrap_or(0);
        let mut body = vec![0_u8; content_length];
        reader
            .read_exact(&mut body)
            .expect("read test HTTP request body");
        headers + &String::from_utf8(body).expect("test HTTP body is UTF-8")
    }

    #[test]
    fn private_bootstrap_validators_fail_closed() {
        let client = ManagedControlClient::new(
            Url::parse("http://127.0.0.1:8791/").unwrap(),
            Url::parse("http://127.0.0.1:8787/").unwrap(),
            SecretText::new("bootstrap-secret-0123456789abcdef0123456789".into()).unwrap(),
        )
        .unwrap();
        let session = WorkerSession {
            worker_id: "worker-01".into(),
            protocol_version: 1,
            session_generation: 7,
            session_token: SecretText::new("a".repeat(64)).unwrap(),
            heartbeat_interval_ms: 15_000,
            lease_ttl_ms: 45_000,
        };
        assert_eq!(
            client
                .ea_bootstrap_material(&session, SecretText::new("b".repeat(64)).unwrap(), 0,)
                .err()
                .expect("zero revision fails")
                .code(),
            "MANAGED_WORKER_PROVISION_PAYLOAD_INVALID"
        );
        assert_eq!(
            validate_ea_bootstrap_token(SecretText::new("g".repeat(32)).unwrap())
                .unwrap_err()
                .code(),
            "MANAGED_WORKER_EA_BOOTSTRAP_TOKEN_INVALID"
        );
        assert_eq!(default_worker_substrate(), "windows_vm");

        let token_path = std::env::temp_dir().join(format!(
            "marketlens-managed-bootstrap-validator-{}.token",
            std::process::id()
        ));
        std::fs::write(&token_path, "a".repeat(64)).unwrap();
        let current = std::env::current_exe().unwrap();
        let bootstrap = ManagedWorkerBootstrap {
            gateway_url: "http://127.0.0.1:8791/".into(),
            credential_api_url: "http://127.0.0.1:8787/".into(),
            bootstrap_token_file: token_path.clone(),
            process: ProcessDriverConfigInput {
                worker_id: "worker-01".into(),
                data_root: std::env::temp_dir().join("marketlens-invalid-substrate"),
                terminal_slots: vec![TerminalSlotConfig {
                    terminal_path: current.clone(),
                    terminal_sha256: "a".repeat(64),
                    servers_sha256: "b".repeat(64),
                    terminal_license_sha256: "c".repeat(64),
                    ea_path: None,
                    ea_sha256: None,
                    ea_bootstrap_pipe: None,
                    ea_profile: None,
                    slot_id: None,
                    ea_gateway_origin: None,
                    ea_profile_chart_path: None,
                    ea_profile_chart_sha256: None,
                    ea_webrequest_settings_path: None,
                    ea_webrequest_settings_sha256: None,
                    ea_topology_attestation_path: None,
                    ea_topology_attestation_sha256: None,
                }],
                python_path: current.clone(),
                adapter_path: current.clone(),
                acl_helper_path: current.clone(),
                powershell_path: current,
                artifact_pins: ArtifactPins {
                    python_sha256: "d".repeat(64),
                    adapter_sha256: "e".repeat(64),
                },
                adapter_event_capacity: None,
                job_active_process_limit: None,
                job_process_memory_limit: None,
                cpu_budget_percent: None,
                minimum_free_disk_bytes: None,
                io_timeout_ms: None,
                graceful_stop_timeout_ms: None,
                restart_spacing_ms: None,
            },
            agent_version: "1.0.0".into(),
            image_version: "image-1".into(),
            runtime_version: "runtime-1".into(),
            region: "local".into(),
            probe_symbol: "EURUSD".into(),
            sync_symbols: vec!["EURUSD".into()],
            history_lookback_ms: 60_000,
            worker_substrate: "invalid".into(),
            allow_loopback_http: true,
        };
        assert_eq!(
            bootstrap.validate(),
            Err("MANAGED_WORKER_RUNTIME_CONFIG_INVALID")
        );

        let (process, app_data_guard, process_root) =
            crate::process::tests::valid_process_config_input_fixture();
        let listener =
            std::net::TcpListener::bind("127.0.0.1:0").expect("bind managed bootstrap test server");
        let base_url = format!(
            "http://{}/",
            listener.local_addr().expect("managed test server address")
        );
        let server = thread::spawn(move || {
            use std::io::Write as _;

            for request_index in 0..2 {
                let (mut stream, _) = listener.accept().expect("accept managed worker request");
                let request = read_test_http_request(&mut stream);
                if request_index == 0 {
                    assert!(request.contains("/v1/mt5-vm/workers/hello"));
                    let body = format!(
                        "{{\"protocolVersion\":1,\"workerId\":\"worker-01\",\"sessionGeneration\":7,\"sessionToken\":\"{}\",\"heartbeatIntervalMs\":1000,\"leaseTtlMs\":45000,\"serverTimeMs\":1}}",
                        "a".repeat(64)
                    );
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .expect("write worker hello response");
                } else {
                    assert!(request.contains("/v1/mt5-vm/workers/heartbeat"));
                    let body = r#"{"code":"SYNTHETIC_STOP"}"#;
                    write!(
                        stream,
                        "HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .expect("write terminal heartbeat rejection");
                }
            }
        });
        let full_bootstrap = ManagedWorkerBootstrap {
            gateway_url: base_url.clone(),
            credential_api_url: base_url,
            bootstrap_token_file: token_path.clone(),
            process,
            agent_version: "1.0.0".into(),
            image_version: "image-1".into(),
            runtime_version: "runtime-1".into(),
            region: "local".into(),
            probe_symbol: "EURUSD".into(),
            sync_symbols: vec!["EURUSD".into()],
            history_lookback_ms: 60_000,
            worker_substrate: "windows_vm".into(),
            allow_loopback_http: true,
        };
        assert_eq!(
            run_bootstrap(full_bootstrap).unwrap_err().code(),
            "MANAGED_WORKER_SESSION_REQUEST_REJECTED"
        );
        server.join().expect("managed bootstrap test server joins");
        drop(app_data_guard);
        std::fs::remove_dir_all(process_root).expect("remove managed process fixture");
        std::fs::remove_file(token_path).unwrap();
    }
}
