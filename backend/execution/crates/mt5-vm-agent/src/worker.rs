use std::collections::HashMap;
use std::fmt;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use zeroize::Zeroizing;

use crate::protocol::unix_time_ms;
use crate::queue::{BoundedLane, DEFAULT_COMMAND_QUEUE_CAPACITY, QueueError};
use crate::throttle::{StartupThrottle, StartupThrottleConfig, StartupThrottleError};
use crate::{AgentError, RuntimeRegistry, RuntimeState};

pub struct CredentialMaterial {
    login: Zeroizing<String>,
    password: Zeroizing<String>,
    server: Zeroizing<String>,
}

impl CredentialMaterial {
    pub fn new(login: String, password: String, server: String) -> Result<Self, WorkerError> {
        if !login.bytes().all(|byte| byte.is_ascii_digit())
            || login
                .parse::<u64>()
                .ok()
                .filter(|value| *value > 0)
                .is_none()
            || password.is_empty()
            || server.is_empty()
            || server.len() > 128
            || server.chars().any(|character| character.is_control())
        {
            return Err(WorkerError::InvalidCredential);
        }
        Ok(Self {
            login: Zeroizing::new(login),
            password: Zeroizing::new(password),
            server: Zeroizing::new(server),
        })
    }

    pub fn login(&self) -> &str {
        self.login.as_str()
    }

    pub fn password(&self) -> &str {
        self.password.as_str()
    }

    pub fn server(&self) -> &str {
        self.server.as_str()
    }
}

impl fmt::Debug for CredentialMaterial {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CredentialMaterial([REDACTED])")
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct ProcessIds {
    pub terminal_pid: Option<u32>,
    pub adapter_pid: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct SnapshotSummary {
    pub mode: String,
    pub login_matches: bool,
    pub server_matches: bool,
    pub connected: bool,
    pub trade_allowed: bool,
    pub trade_expert: bool,
    pub margin_mode: Option<i64>,
    pub currency: Option<String>,
    pub leverage: Option<i64>,
    pub positions_count: Option<usize>,
    pub pending_orders_count: Option<usize>,
    pub history_orders_count_7d: Option<usize>,
    pub history_deals_count_7d: Option<usize>,
    pub symbol_specification: Value,
    pub last_error_code: Option<i64>,
}

impl SnapshotSummary {
    pub fn passes_phase1_demo_gate(&self) -> bool {
        self.mode == "demo"
            && self.login_matches
            && self.server_matches
            && self.connected
            && self.positions_count.is_some()
            && self.pending_orders_count.is_some()
            && self.history_orders_count_7d.is_some()
            && self.history_deals_count_7d.is_some()
            && self.symbol_specification.is_object()
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeCommandKind {
    Heartbeat,
    CleanRestart,
    ForceCrashRecover,
    Stop,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct RuntimeCommand {
    pub lease_generation: u64,
    pub expires_at_ms: u64,
    pub kind: RuntimeCommandKind,
}

pub struct ProvisionRequest {
    pub account_id: String,
    pub lease_generation: u64,
    pub credential: CredentialMaterial,
    pub symbol: String,
}

impl fmt::Debug for ProvisionRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ProvisionRequest")
            .field("account_id", &self.account_id)
            .field("lease_generation", &self.lease_generation)
            .field("credential", &"[REDACTED]")
            .field("symbol", &self.symbol)
            .finish()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StartedRuntime {
    pub process_ids: ProcessIds,
    pub snapshot: SnapshotSummary,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct HeartbeatSummary {
    pub healthy: bool,
    pub login_matches: bool,
    pub server_matches: bool,
    pub last_error_code: Option<i64>,
}

#[derive(Debug, Error, PartialEq, Eq)]
#[error("runtime driver failed: {error_class}")]
pub struct DriverError {
    pub error_class: &'static str,
}

impl DriverError {
    pub const fn new(error_class: &'static str) -> Self {
        Self { error_class }
    }
}

pub trait RuntimeDriver {
    fn start(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        credential: CredentialMaterial,
        symbol: &str,
    ) -> Result<StartedRuntime, DriverError>;

    fn heartbeat(
        &mut self,
        account_id: &str,
        lease_generation: u64,
    ) -> Result<HeartbeatSummary, DriverError>;

    fn clean_restart(
        &mut self,
        account_id: &str,
        lease_generation: u64,
    ) -> Result<StartedRuntime, DriverError>;

    fn force_crash_and_recover(
        &mut self,
        account_id: &str,
        lease_generation: u64,
    ) -> Result<StartedRuntime, DriverError>;

    fn stop(&mut self, account_id: &str, lease_generation: u64) -> Result<(), DriverError>;
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum WorkerError {
    #[error(transparent)]
    Registry(#[from] AgentError),
    #[error(transparent)]
    Queue(#[from] QueueError),
    #[error(transparent)]
    Throttle(#[from] StartupThrottleError),
    #[error(transparent)]
    Driver(#[from] DriverError),
    #[error("credential is invalid")]
    InvalidCredential,
    #[error("symbol is invalid")]
    InvalidSymbol,
    #[error("runtime command expired before dispatch")]
    CommandExpired,
    #[error("runtime did not satisfy the Phase 1 identity/snapshot gate")]
    SnapshotGateFailed,
}

#[derive(Debug)]
pub struct Worker<D> {
    registry: RuntimeRegistry,
    lanes: HashMap<String, BoundedLane<RuntimeCommand>>,
    queue_capacity: usize,
    startup_throttle: StartupThrottle,
    driver: D,
}

impl<D: RuntimeDriver> Worker<D> {
    pub fn new(
        registry: RuntimeRegistry,
        driver: D,
        queue_capacity: Option<usize>,
        startup_config: StartupThrottleConfig,
    ) -> Result<Self, WorkerError> {
        let queue_capacity = queue_capacity.unwrap_or(DEFAULT_COMMAND_QUEUE_CAPACITY);
        let _ = BoundedLane::<RuntimeCommand>::new(queue_capacity)?;
        Ok(Self {
            registry,
            lanes: HashMap::new(),
            queue_capacity,
            startup_throttle: StartupThrottle::new(startup_config)?,
            driver,
        })
    }

    pub fn provision_blocking(
        &mut self,
        request: ProvisionRequest,
    ) -> Result<SnapshotSummary, WorkerError> {
        let now_ms = unix_time_ms();
        let delay_ms = self
            .startup_throttle
            .required_delay_ms(now_ms, &request.account_id);
        if delay_ms > 0 {
            thread::sleep(Duration::from_millis(delay_ms));
        }
        self.provision_at(request, unix_time_ms())
    }

    pub fn provision_at(
        &mut self,
        request: ProvisionRequest,
        started_at_ms: u64,
    ) -> Result<SnapshotSummary, WorkerError> {
        if request.symbol.len() > 64 {
            return Err(WorkerError::InvalidSymbol);
        }
        let delay = self
            .startup_throttle
            .required_delay_ms(started_at_ms, &request.account_id);
        if delay > 0 {
            return Err(WorkerError::Driver(DriverError::new("STARTUP_THROTTLED")));
        }
        let account_id = request.account_id.clone();
        let lease_generation = request.lease_generation;
        self.registry.provision(&account_id, lease_generation)?;
        self.lanes
            .insert(account_id.clone(), BoundedLane::new(self.queue_capacity)?);
        self.startup_throttle.record_start(started_at_ms);
        self.registry.transition(
            &account_id,
            lease_generation,
            RuntimeState::TerminalStarting,
        )?;
        let started = match self.driver.start(
            &account_id,
            lease_generation,
            request.credential,
            &request.symbol,
        ) {
            Ok(started) => started,
            Err(error) => {
                let _ = self.registry.remove(&account_id, lease_generation);
                self.lanes.remove(&account_id);
                return Err(error.into());
            }
        };
        self.registry
            .transition(&account_id, lease_generation, RuntimeState::Authenticating)?;
        self.registry
            .transition(&account_id, lease_generation, RuntimeState::Synchronizing)?;
        if !started.snapshot.passes_phase1_demo_gate() {
            let _ = self.driver.stop(&account_id, lease_generation);
            let _ = self.registry.remove(&account_id, lease_generation);
            self.lanes.remove(&account_id);
            return Err(WorkerError::SnapshotGateFailed);
        }
        self.registry.set_process_ids(
            &account_id,
            lease_generation,
            started.process_ids.terminal_pid,
            started.process_ids.adapter_pid,
        )?;
        self.registry
            .transition(&account_id, lease_generation, RuntimeState::Ready)?;
        Ok(started.snapshot)
    }

    pub fn enqueue(
        &mut self,
        account_id: &str,
        command: RuntimeCommand,
        now_ms: u64,
    ) -> Result<(), WorkerError> {
        if command.expires_at_ms < now_ms {
            return Err(WorkerError::CommandExpired);
        }
        self.registry
            .require_lease(account_id, command.lease_generation)?;
        self.lanes
            .get_mut(account_id)
            .ok_or(AgentError::RuntimeNotFound)?
            .try_push(command)?;
        Ok(())
    }

    pub fn process_next(
        &mut self,
        account_id: &str,
        now_ms: u64,
    ) -> Result<Option<SnapshotSummary>, WorkerError> {
        let command = self
            .lanes
            .get_mut(account_id)
            .ok_or(AgentError::RuntimeNotFound)?
            .pop()
            .ok_or(AgentError::RuntimeNotFound)?;
        if command.expires_at_ms < now_ms {
            return Err(WorkerError::CommandExpired);
        }
        self.registry
            .require_lease(account_id, command.lease_generation)?;
        match command.kind {
            RuntimeCommandKind::Heartbeat => {
                let heartbeat = self
                    .driver
                    .heartbeat(account_id, command.lease_generation)?;
                if heartbeat.healthy && heartbeat.login_matches && heartbeat.server_matches {
                    self.registry.transition(
                        account_id,
                        command.lease_generation,
                        RuntimeState::Ready,
                    )?;
                } else {
                    self.registry.transition(
                        account_id,
                        command.lease_generation,
                        RuntimeState::Degraded,
                    )?;
                }
                Ok(None)
            }
            RuntimeCommandKind::CleanRestart => {
                self.registry.transition(
                    account_id,
                    command.lease_generation,
                    RuntimeState::Reconnecting,
                )?;
                let started = self
                    .driver
                    .clean_restart(account_id, command.lease_generation)?;
                self.finish_recovery(account_id, command.lease_generation, started)
                    .map(Some)
            }
            RuntimeCommandKind::ForceCrashRecover => {
                self.registry.transition(
                    account_id,
                    command.lease_generation,
                    RuntimeState::Degraded,
                )?;
                self.registry.transition(
                    account_id,
                    command.lease_generation,
                    RuntimeState::Reconnecting,
                )?;
                let started = self
                    .driver
                    .force_crash_and_recover(account_id, command.lease_generation)?;
                self.finish_recovery(account_id, command.lease_generation, started)
                    .map(Some)
            }
            RuntimeCommandKind::Stop => {
                self.driver.stop(account_id, command.lease_generation)?;
                self.registry.transition(
                    account_id,
                    command.lease_generation,
                    RuntimeState::Stopped,
                )?;
                self.registry.remove(account_id, command.lease_generation)?;
                self.lanes.remove(account_id);
                Ok(None)
            }
        }
    }

    fn finish_recovery(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        started: StartedRuntime,
    ) -> Result<SnapshotSummary, WorkerError> {
        self.registry
            .transition(account_id, lease_generation, RuntimeState::Authenticating)?;
        self.registry
            .transition(account_id, lease_generation, RuntimeState::Synchronizing)?;
        if !started.snapshot.passes_phase1_demo_gate() {
            self.registry
                .transition(account_id, lease_generation, RuntimeState::Degraded)?;
            return Err(WorkerError::SnapshotGateFailed);
        }
        self.registry.set_process_ids(
            account_id,
            lease_generation,
            started.process_ids.terminal_pid,
            started.process_ids.adapter_pid,
        )?;
        self.registry
            .transition(account_id, lease_generation, RuntimeState::Ready)?;
        Ok(started.snapshot)
    }

    pub fn active_count(&self) -> usize {
        self.registry.active_count()
    }

    pub fn state(&self, account_id: &str) -> Option<RuntimeState> {
        self.registry
            .slot(account_id)
            .map(|slot| slot.state.clone())
    }

    pub fn lane_len(&self, account_id: &str) -> Option<usize> {
        self.lanes.get(account_id).map(BoundedLane::len)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::json;

    use super::*;

    #[derive(Default)]
    struct FakeDriver {
        starts: HashMap<String, usize>,
        stops: HashMap<String, usize>,
        crashes: HashMap<String, usize>,
        heartbeat_calls: usize,
        fail_account: Option<String>,
    }

    impl FakeDriver {
        fn snapshot() -> SnapshotSummary {
            SnapshotSummary {
                mode: "demo".to_owned(),
                login_matches: true,
                server_matches: true,
                connected: true,
                trade_allowed: true,
                trade_expert: true,
                margin_mode: Some(2),
                currency: Some("USD".to_owned()),
                leverage: Some(100),
                positions_count: Some(0),
                pending_orders_count: Some(0),
                history_orders_count_7d: Some(0),
                history_deals_count_7d: Some(0),
                symbol_specification: json!({"symbol": "EURUSD", "tick_available": true}),
                last_error_code: Some(1),
            }
        }

        fn started(_account_id: &str, count: usize) -> StartedRuntime {
            StartedRuntime {
                process_ids: ProcessIds {
                    terminal_pid: Some(1_000 + count as u32),
                    adapter_pid: Some(2_000 + count as u32),
                },
                snapshot: Self::snapshot(),
            }
        }
    }

    impl RuntimeDriver for FakeDriver {
        fn start(
            &mut self,
            account_id: &str,
            _lease_generation: u64,
            _credential: CredentialMaterial,
            _symbol: &str,
        ) -> Result<StartedRuntime, DriverError> {
            if self.fail_account.as_deref() == Some(account_id) {
                return Err(DriverError::new("FAKE_START_FAILED"));
            }
            let count = self.starts.entry(account_id.to_owned()).or_insert(0);
            *count += 1;
            Ok(Self::started(account_id, *count))
        }

        fn heartbeat(
            &mut self,
            _account_id: &str,
            _lease_generation: u64,
        ) -> Result<HeartbeatSummary, DriverError> {
            self.heartbeat_calls += 1;
            Ok(HeartbeatSummary {
                healthy: true,
                login_matches: true,
                server_matches: true,
                last_error_code: Some(1),
            })
        }

        fn clean_restart(
            &mut self,
            account_id: &str,
            _lease_generation: u64,
        ) -> Result<StartedRuntime, DriverError> {
            let count = self.starts.entry(account_id.to_owned()).or_insert(0);
            *count += 1;
            Ok(Self::started(account_id, *count))
        }

        fn force_crash_and_recover(
            &mut self,
            account_id: &str,
            _lease_generation: u64,
        ) -> Result<StartedRuntime, DriverError> {
            *self.crashes.entry(account_id.to_owned()).or_insert(0) += 1;
            self.clean_restart(account_id, 1)
        }

        fn stop(&mut self, account_id: &str, _lease_generation: u64) -> Result<(), DriverError> {
            *self.stops.entry(account_id.to_owned()).or_insert(0) += 1;
            Ok(())
        }
    }

    fn credential(seed: &str) -> CredentialMaterial {
        CredentialMaterial::new(
            "12345678".to_owned(),
            format!("password-{seed}"),
            "FTMO-Demo".to_owned(),
        )
        .expect("credential")
    }

    fn worker(driver: FakeDriver, queue_capacity: usize) -> Worker<FakeDriver> {
        let registry = RuntimeRegistry::new(PathBuf::from(r"C:\MarketLens\phase1-worker-tests"), 4)
            .expect("registry");
        Worker::new(
            registry,
            driver,
            Some(queue_capacity),
            StartupThrottleConfig {
                window_ms: 60_000,
                max_starts_per_window: 4,
                min_spacing_ms: 0,
                max_jitter_ms: 0,
            },
        )
        .expect("worker")
    }

    fn provision(worker: &mut Worker<FakeDriver>, account_id: &str, now_ms: u64) {
        worker
            .provision_at(
                ProvisionRequest {
                    account_id: account_id.to_owned(),
                    lease_generation: 1,
                    credential: credential(account_id),
                    symbol: "EURUSD".to_owned(),
                },
                now_ms,
            )
            .expect("provision");
    }

    #[test]
    fn full_lifecycle_survives_two_restarts_and_forced_crash() {
        let mut worker = worker(FakeDriver::default(), 8);
        provision(&mut worker, "account-a", 1_000);
        for kind in [
            RuntimeCommandKind::CleanRestart,
            RuntimeCommandKind::CleanRestart,
            RuntimeCommandKind::ForceCrashRecover,
        ] {
            worker
                .enqueue(
                    "account-a",
                    RuntimeCommand {
                        lease_generation: 1,
                        expires_at_ms: 20_000,
                        kind,
                    },
                    2_000,
                )
                .expect("enqueue");
            let snapshot = worker
                .process_next("account-a", 2_000)
                .expect("process")
                .expect("snapshot");
            assert!(snapshot.passes_phase1_demo_gate());
            assert_eq!(Some(RuntimeState::Ready), worker.state("account-a"));
        }
    }

    #[test]
    fn one_account_failure_does_not_change_another_runtime() {
        let mut worker = worker(FakeDriver::default(), 8);
        provision(&mut worker, "account-a", 1_000);
        provision(&mut worker, "account-b", 1_000);
        worker
            .enqueue(
                "account-a",
                RuntimeCommand {
                    lease_generation: 1,
                    expires_at_ms: 20_000,
                    kind: RuntimeCommandKind::ForceCrashRecover,
                },
                2_000,
            )
            .expect("enqueue");
        worker.process_next("account-a", 2_000).expect("recover");
        assert_eq!(Some(RuntimeState::Ready), worker.state("account-a"));
        assert_eq!(Some(RuntimeState::Ready), worker.state("account-b"));
        assert_eq!(2, worker.active_count());
    }

    #[test]
    fn stale_expired_and_overflowed_commands_fail_closed() {
        let mut worker = worker(FakeDriver::default(), 2);
        provision(&mut worker, "account-a", 1_000);
        assert_eq!(
            WorkerError::Registry(AgentError::StaleLeaseGeneration),
            worker
                .enqueue(
                    "account-a",
                    RuntimeCommand {
                        lease_generation: 2,
                        expires_at_ms: 10_000,
                        kind: RuntimeCommandKind::Heartbeat,
                    },
                    2_000,
                )
                .unwrap_err()
        );
        assert_eq!(
            WorkerError::CommandExpired,
            worker
                .enqueue(
                    "account-a",
                    RuntimeCommand {
                        lease_generation: 1,
                        expires_at_ms: 1_999,
                        kind: RuntimeCommandKind::Heartbeat,
                    },
                    2_000,
                )
                .unwrap_err()
        );
        for _ in 0..2 {
            worker
                .enqueue(
                    "account-a",
                    RuntimeCommand {
                        lease_generation: 1,
                        expires_at_ms: 10_000,
                        kind: RuntimeCommandKind::Heartbeat,
                    },
                    2_000,
                )
                .expect("bounded enqueue");
        }
        assert_eq!(
            WorkerError::Queue(QueueError::QueueFull),
            worker
                .enqueue(
                    "account-a",
                    RuntimeCommand {
                        lease_generation: 1,
                        expires_at_ms: 10_000,
                        kind: RuntimeCommandKind::Heartbeat,
                    },
                    2_000,
                )
                .unwrap_err()
        );
    }

    #[test]
    fn idle_worker_does_not_poll_driver() {
        let mut worker = worker(FakeDriver::default(), 4);
        provision(&mut worker, "account-a", 1_000);
        thread::sleep(Duration::from_millis(25));
        assert_eq!(Some(0), worker.lane_len("account-a"));
        assert_eq!(0, worker.driver.heartbeat_calls);
    }

    #[test]
    fn credential_debug_and_errors_never_expose_secrets() {
        let secret = "do-not-print-this-password";
        let credential = CredentialMaterial::new(
            "12345678".to_owned(),
            secret.to_owned(),
            "FTMO-Demo".to_owned(),
        )
        .expect("credential");
        let request = ProvisionRequest {
            account_id: "account-a".to_owned(),
            lease_generation: 1,
            credential,
            symbol: "EURUSD".to_owned(),
        };
        let output = format!("{request:?} {:?}", DriverError::new("START_FAILED"));
        assert!(!output.contains(secret));
        assert!(!output.contains("12345678"));
        assert!(!output.contains("FTMO-Demo"));
    }
}
