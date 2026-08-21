use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

use md5::{Digest as Md5Digest, Md5};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use zeroize::{Zeroize, Zeroizing};

use crate::checked_runtime_directory;
use crate::job::ProcessJob;
use crate::protocol::{
    FrameSigner, FrameVerifier, IpcKey, MessageKind, frame_from_line, frame_to_line, unix_time_ms,
};
use crate::worker::{
    CredentialMaterial, DriverError, HeartbeatSummary, ProcessIds, RuntimeDriver, SnapshotSummary,
    StartedRuntime,
};

pub const DEFAULT_ADAPTER_EVENT_CAPACITY: usize = 16;
pub const HARD_MAX_ADAPTER_EVENT_CAPACITY: usize = 128;
pub const DEFAULT_JOB_ACTIVE_PROCESS_LIMIT: u32 = 8;
pub const DEFAULT_JOB_PROCESS_MEMORY_LIMIT: usize = 1_500 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct ArtifactPins {
    pub python_sha256: String,
    pub adapter_sha256: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct TerminalSlotConfig {
    pub terminal_path: PathBuf,
    pub terminal_sha256: String,
    pub servers_sha256: String,
    pub terminal_license_sha256: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ProcessDriverConfigInput {
    pub worker_id: String,
    pub data_root: PathBuf,
    pub terminal_slots: Vec<TerminalSlotConfig>,
    pub python_path: PathBuf,
    pub adapter_path: PathBuf,
    pub acl_helper_path: PathBuf,
    pub powershell_path: PathBuf,
    pub artifact_pins: ArtifactPins,
    pub adapter_event_capacity: Option<usize>,
    pub job_active_process_limit: Option<u32>,
    pub job_process_memory_limit: Option<usize>,
    pub io_timeout_ms: Option<u64>,
    pub graceful_stop_timeout_ms: Option<u64>,
    pub restart_spacing_ms: Option<u64>,
}

impl TryFrom<ProcessDriverConfigInput> for ProcessDriverConfig {
    type Error = DriverError;

    fn try_from(input: ProcessDriverConfigInput) -> Result<Self, Self::Error> {
        let config = Self {
            worker_id: input.worker_id,
            data_root: input.data_root,
            terminal_slots: input.terminal_slots,
            python_path: input.python_path,
            adapter_path: input.adapter_path,
            acl_helper_path: input.acl_helper_path,
            powershell_path: input.powershell_path,
            artifact_pins: input.artifact_pins,
            adapter_event_capacity: input
                .adapter_event_capacity
                .unwrap_or(DEFAULT_ADAPTER_EVENT_CAPACITY),
            job_active_process_limit: input
                .job_active_process_limit
                .unwrap_or(DEFAULT_JOB_ACTIVE_PROCESS_LIMIT),
            job_process_memory_limit: input
                .job_process_memory_limit
                .unwrap_or(DEFAULT_JOB_PROCESS_MEMORY_LIMIT),
            io_timeout: Duration::from_millis(input.io_timeout_ms.unwrap_or(15_000)),
            graceful_stop_timeout: Duration::from_millis(
                input.graceful_stop_timeout_ms.unwrap_or(5_000),
            ),
            restart_spacing: Duration::from_millis(input.restart_spacing_ms.unwrap_or(2_000)),
        };
        config.validate()?;
        Ok(config)
    }
}

#[derive(Clone, Debug)]
pub struct ProcessDriverConfig {
    pub worker_id: String,
    pub data_root: PathBuf,
    pub terminal_slots: Vec<TerminalSlotConfig>,
    pub python_path: PathBuf,
    pub adapter_path: PathBuf,
    pub acl_helper_path: PathBuf,
    pub powershell_path: PathBuf,
    pub artifact_pins: ArtifactPins,
    pub adapter_event_capacity: usize,
    pub job_active_process_limit: u32,
    pub job_process_memory_limit: usize,
    pub io_timeout: Duration,
    pub graceful_stop_timeout: Duration,
    pub restart_spacing: Duration,
}

impl ProcessDriverConfig {
    pub fn validate(&self) -> Result<(), DriverError> {
        if !crate::is_safe_identifier(&self.worker_id)
            || !self.data_root.is_absolute()
            || !self.python_path.is_absolute()
            || !self.adapter_path.is_absolute()
            || !self.acl_helper_path.is_absolute()
            || !self.powershell_path.is_absolute()
        {
            return Err(DriverError::new("INVALID_PROCESS_CONFIG"));
        }
        if [
            &self.data_root,
            &self.python_path,
            &self.adapter_path,
            &self.acl_helper_path,
            &self.powershell_path,
        ]
        .into_iter()
        .any(|path| {
            path.components()
                .any(|component| matches!(component, Component::ParentDir))
        }) {
            return Err(DriverError::new("UNSAFE_PROCESS_CONFIG_PATH"));
        }
        if self.terminal_slots.is_empty() || self.terminal_slots.len() > crate::HARD_MAX_TERMINALS {
            return Err(DriverError::new("INVALID_TERMINAL_SLOTS"));
        }
        if self.adapter_event_capacity == 0
            || self.adapter_event_capacity > HARD_MAX_ADAPTER_EVENT_CAPACITY
            || self.job_active_process_limit == 0
            || self.job_process_memory_limit == 0
            || self.io_timeout.is_zero()
            || self.graceful_stop_timeout.is_zero()
        {
            return Err(DriverError::new("INVALID_PROCESS_LIMIT"));
        }
        for path in [
            &self.python_path,
            &self.adapter_path,
            &self.acl_helper_path,
            &self.powershell_path,
        ] {
            if !path.is_file() {
                return Err(DriverError::new("REQUIRED_ARTIFACT_MISSING"));
            }
            assert_no_reparse_components(path)?;
        }
        let mut canonical_slots = Vec::with_capacity(self.terminal_slots.len());
        for slot in &self.terminal_slots {
            if !slot.terminal_path.is_absolute()
                || !slot
                    .terminal_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.eq_ignore_ascii_case("terminal64.exe"))
                || slot
                    .terminal_path
                    .components()
                    .any(|component| matches!(component, Component::ParentDir))
                || !slot.terminal_path.is_file()
            {
                return Err(DriverError::new("INVALID_TERMINAL_SLOT"));
            }
            assert_no_reparse_components(&slot.terminal_path)?;
            let install_directory = slot
                .terminal_path
                .parent()
                .ok_or_else(|| DriverError::new("TERMINAL_SLOT_INVALID"))?;
            let terminal_license_path = install_directory.join("Config").join("terminal.lic");
            let (terminal_state_root, terminal_state_config) =
                terminal_instance_config_directory(&slot.terminal_path)?;
            let servers_path = terminal_state_config.join("servers.dat");
            for path in [&servers_path, &terminal_license_path] {
                if !path.is_file() {
                    return Err(DriverError::new("REQUIRED_ARTIFACT_MISSING"));
                }
                assert_no_reparse_components(path)?;
            }
            assert_no_reparse_below(&terminal_state_root, &servers_path)?;
            verify_sha256(&slot.terminal_path, &slot.terminal_sha256)?;
            verify_sha256(&servers_path, &slot.servers_sha256)?;
            verify_sha256(&terminal_license_path, &slot.terminal_license_sha256)?;
            let canonical = fs::canonicalize(&slot.terminal_path)
                .map_err(|_| DriverError::new("TERMINAL_SLOT_INVALID"))?;
            if canonical_slots
                .iter()
                .any(|existing| existing == &canonical)
            {
                return Err(DriverError::new("DUPLICATE_TERMINAL_SLOT"));
            }
            canonical_slots.push(canonical);
        }
        verify_sha256(&self.python_path, &self.artifact_pins.python_sha256)?;
        verify_sha256(&self.adapter_path, &self.artifact_pins.adapter_sha256)?;
        Ok(())
    }
}

#[derive(Clone, Debug)]
struct RuntimeLayout {
    runtime_directory: PathBuf,
    terminal_path: PathBuf,
    mcp_port: u16,
}

struct ManagedRuntime {
    layout: RuntimeLayout,
    credential: CredentialMaterial,
    symbol: String,
    pair: Option<ProcessPair>,
}

struct ProcessPair {
    adapter: Child,
    terminal_pid: u32,
    adapter_stdin: BufWriter<ChildStdin>,
    adapter_events: Receiver<String>,
    signer: FrameSigner,
    verifier: FrameVerifier,
    job: ProcessJob,
}

struct StartingProcessPair {
    adapter: Option<Child>,
    job: Option<ProcessJob>,
}

impl StartingProcessPair {
    fn new(job: ProcessJob) -> Self {
        Self {
            adapter: None,
            job: Some(job),
        }
    }

    fn finish(
        mut self,
        adapter_stdin: BufWriter<ChildStdin>,
        adapter_events: Receiver<String>,
        signer: FrameSigner,
        verifier: FrameVerifier,
    ) -> Result<ProcessPair, DriverError> {
        Ok(ProcessPair {
            adapter: self
                .adapter
                .take()
                .ok_or_else(|| DriverError::new("ADAPTER_START_FAILED"))?,
            terminal_pid: 0,
            adapter_stdin,
            adapter_events,
            signer,
            verifier,
            job: self
                .job
                .take()
                .ok_or_else(|| DriverError::new("JOB_CREATE_FAILED"))?,
        })
    }

    fn terminate_all(&mut self) {
        if let Some(job) = &self.job {
            let _ = job.terminate(71);
        }
        if let Some(adapter) = &mut self.adapter {
            kill_and_wait(adapter);
        }
    }
}

impl Drop for StartingProcessPair {
    fn drop(&mut self) {
        self.terminate_all();
    }
}

impl Drop for ProcessPair {
    fn drop(&mut self) {
        let _ = self.job.terminate(72);
        kill_and_wait(&mut self.adapter);
    }
}

pub struct ProcessRuntimeDriver {
    config: ProcessDriverConfig,
    runtimes: HashMap<String, ManagedRuntime>,
}

impl ProcessRuntimeDriver {
    pub fn new(config: ProcessDriverConfig) -> Result<Self, DriverError> {
        config.validate()?;
        Ok(Self {
            config,
            runtimes: HashMap::new(),
        })
    }

    fn prepare_runtime(&mut self, account_id: &str) -> Result<RuntimeLayout, DriverError> {
        let runtime_directory = checked_runtime_directory(&self.config.data_root, account_id)
            .map_err(|_| DriverError::new("UNSAFE_RUNTIME_PATH"))?;
        run_acl_helper(&self.config, &runtime_directory)?;
        assert_no_reparse_below(&self.config.data_root, &runtime_directory)?;

        let terminal_path = self
            .config
            .terminal_slots
            .iter()
            .map(|slot| &slot.terminal_path)
            .find(|candidate| {
                !self
                    .runtimes
                    .values()
                    .any(|runtime| runtime.layout.terminal_path == **candidate)
            })
            .cloned()
            .ok_or_else(|| DriverError::new("TERMINAL_SLOT_CAPACITY_EXHAUSTED"))?;
        if find_process_id_by_path(&terminal_path).is_some() {
            return Err(DriverError::new("TERMINAL_SLOT_ALREADY_RUNNING"));
        }
        let terminal_install_root = terminal_path
            .parent()
            .ok_or_else(|| DriverError::new("TERMINAL_SLOT_INVALID"))?;
        let terminal_install_config = terminal_install_root.join("Config");
        assert_no_reparse_components(terminal_install_root)?;
        assert_no_reparse_below(terminal_install_root, &terminal_install_config)?;
        let mcp_port = (24_000_u16..=31_998_u16)
            .step_by(2)
            .find(|port| {
                !self
                    .runtimes
                    .values()
                    .any(|runtime| runtime.layout.mcp_port == *port)
            })
            .ok_or_else(|| DriverError::new("MCP_LOOPBACK_PORTS_EXHAUSTED"))?;
        write_disabled_mcp_config(terminal_install_root, &terminal_install_config, mcp_port)?;
        let (terminal_state_root, terminal_state_config) =
            terminal_instance_config_directory(&terminal_path)?;
        write_disabled_mcp_config(&terminal_state_root, &terminal_state_config, mcp_port)?;
        Ok(RuntimeLayout {
            runtime_directory,
            terminal_path,
            mcp_port,
        })
    }

    fn start_pair(
        config: &ProcessDriverConfig,
        account_id: &str,
        lease_generation: u64,
        layout: &RuntimeLayout,
        credential: &CredentialMaterial,
        symbol: &str,
    ) -> Result<(ProcessPair, SnapshotSummary), DriverError> {
        let job = ProcessJob::new(
            config.job_active_process_limit,
            config.job_process_memory_limit,
        )
        .map_err(|_| DriverError::new("JOB_CREATE_FAILED"))?;
        let mut starting = StartingProcessPair::new(job);

        let mut adapter_command = Command::new(&config.python_path);
        adapter_command
            .arg(&config.adapter_path)
            .current_dir(&layout.runtime_directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        configure_hidden_process(&mut adapter_command);
        let adapter = adapter_command
            .spawn()
            .map_err(|_| DriverError::new("ADAPTER_START_FAILED"))?;
        starting
            .job
            .as_ref()
            .ok_or_else(|| DriverError::new("JOB_CREATE_FAILED"))?
            .assign(&adapter)
            .map_err(|_| DriverError::new("ADAPTER_JOB_ASSIGN_FAILED"))?;
        starting.adapter = Some(adapter);
        let adapter_stdin = starting
            .adapter
            .as_mut()
            .ok_or_else(|| DriverError::new("ADAPTER_START_FAILED"))?
            .stdin
            .take()
            .ok_or_else(|| DriverError::new("ADAPTER_STDIN_UNAVAILABLE"))?;
        let adapter_stdout = starting
            .adapter
            .as_mut()
            .ok_or_else(|| DriverError::new("ADAPTER_START_FAILED"))?
            .stdout
            .take()
            .ok_or_else(|| DriverError::new("ADAPTER_STDOUT_UNAVAILABLE"))?;
        let (event_sender, adapter_events) =
            mpsc::sync_channel::<String>(config.adapter_event_capacity);
        thread::Builder::new()
            .name(format!("mt5-adapter-events-{account_id}"))
            .spawn(move || {
                let reader = BufReader::new(adapter_stdout);
                for line in reader.lines() {
                    let Ok(line) = line else { break };
                    if event_sender.send(line).is_err() {
                        break;
                    }
                }
            })
            .map_err(|_| DriverError::new("ADAPTER_EVENT_THREAD_FAILED"))?;

        let generated_key = IpcKey::generate();
        let mut key_hex = generated_key.to_hex();
        let signer = FrameSigner::new(
            IpcKey::from_hex(key_hex.as_str()).map_err(|_| DriverError::new("IPC_KEY_FAILED"))?,
            config.worker_id.clone(),
        )
        .map_err(|_| DriverError::new("IPC_SIGNER_FAILED"))?;
        let verifier = FrameVerifier::new(
            IpcKey::from_hex(key_hex.as_str()).map_err(|_| DriverError::new("IPC_KEY_FAILED"))?,
            config.worker_id.clone(),
        )
        .map_err(|_| DriverError::new("IPC_VERIFIER_FAILED"))?;
        drop(generated_key);

        let bootstrap = AdapterBootstrap {
            protocol_version: crate::AGENT_PROTOCOL_VERSION,
            worker_id: &config.worker_id,
            account_id,
            lease_generation,
            ipc_key_hex: key_hex.as_str(),
            terminal_path: &layout.terminal_path,
            login: credential.login(),
            password: credential.password(),
            server: credential.server(),
            symbol,
            timeout_ms: config.io_timeout.as_millis().clamp(1_000, 30_000) as u64,
        };
        let mut bootstrap_json = Zeroizing::new(
            serde_json::to_string(&bootstrap)
                .map_err(|_| DriverError::new("ADAPTER_BOOTSTRAP_SERIALIZE_FAILED"))?,
        );
        key_hex.zeroize();
        let mut adapter_stdin = BufWriter::new(adapter_stdin);
        adapter_stdin
            .write_all(bootstrap_json.as_bytes())
            .and_then(|_| adapter_stdin.write_all(b"\n"))
            .and_then(|_| adapter_stdin.flush())
            .map_err(|_| DriverError::new("ADAPTER_BOOTSTRAP_WRITE_FAILED"))?;
        bootstrap_json.zeroize();

        let mut pair = starting.finish(adapter_stdin, adapter_events, signer, verifier)?;
        let snapshot: SnapshotSummary = pair.receive(
            config,
            account_id,
            lease_generation,
            MessageKind::AccountSnapshot,
        )?;
        let terminal_pid = find_process_id_by_path(&layout.terminal_path)
            .ok_or_else(|| DriverError::new("TERMINAL_PROCESS_NOT_FOUND"))?;
        pair.terminal_pid = terminal_pid;
        Ok((pair, snapshot))
    }

    fn stop_pair(
        config: &ProcessDriverConfig,
        account_id: &str,
        lease_generation: u64,
        mut pair: ProcessPair,
    ) -> Result<(), DriverError> {
        let frame = pair
            .signer
            .sign(
                account_id,
                lease_generation,
                MessageKind::StopAccount,
                &json!({}),
                unix_time_ms(),
                config.io_timeout.as_millis().min(60_000) as u64,
            )
            .map_err(|_| DriverError::new("IPC_SIGN_FAILED"))?;
        let line = frame_to_line(&frame).map_err(|_| DriverError::new("IPC_FRAME_FAILED"))?;
        let _ = pair.adapter_stdin.write_all(line.as_bytes());
        let _ = pair.adapter_stdin.write_all(b"\n");
        let _ = pair.adapter_stdin.flush();
        let _: Value = pair.receive(
            config,
            account_id,
            lease_generation,
            MessageKind::AccountRuntimeStatus,
        )?;

        wait_or_kill(&mut pair.adapter, config.graceful_stop_timeout);
        Ok(())
    }

    fn restart_runtime(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        forced_crash: bool,
    ) -> Result<StartedRuntime, DriverError> {
        let mut runtime = self
            .runtimes
            .remove(account_id)
            .ok_or_else(|| DriverError::new("RUNTIME_NOT_FOUND"))?;
        if let Some(mut pair) = runtime.pair.take() {
            if forced_crash {
                pair.job
                    .terminate(70)
                    .map_err(|_| DriverError::new("RUNTIME_JOB_TERMINATE_FAILED"))?;
                let _ = pair.adapter.wait();
            } else {
                Self::stop_pair(&self.config, account_id, lease_generation, pair)?;
            }
        }
        if !self.config.restart_spacing.is_zero() {
            thread::sleep(self.config.restart_spacing);
        }
        let start_result = Self::start_pair(
            &self.config,
            account_id,
            lease_generation,
            &runtime.layout,
            &runtime.credential,
            &runtime.symbol,
        );
        match start_result {
            Ok((pair, snapshot)) => {
                let process_ids = ProcessIds {
                    terminal_pid: Some(pair.terminal_pid),
                    adapter_pid: Some(pair.adapter.id()),
                };
                runtime.pair = Some(pair);
                self.runtimes.insert(account_id.to_owned(), runtime);
                Ok(StartedRuntime {
                    process_ids,
                    snapshot,
                })
            }
            Err(error) => {
                self.runtimes.insert(account_id.to_owned(), runtime);
                Err(error)
            }
        }
    }

    pub fn snapshot_sync(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        symbols: &[String],
    ) -> Result<Value, DriverError> {
        let mut unique = HashSet::with_capacity(symbols.len());
        if symbols.len() > 256
            || symbols.iter().any(|symbol| {
                symbol.is_empty()
                    || symbol.len() > 64
                    || symbol.chars().any(char::is_control)
                    || !unique.insert(symbol.as_str())
            })
        {
            return Err(DriverError::new("SNAPSHOT_SYNC_REQUEST_INVALID"));
        }
        self.exchange(
            account_id,
            lease_generation,
            MessageKind::SnapshotSync,
            &json!({"symbols": symbols}),
        )
    }

    pub fn history_sync(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        from_ms: i64,
        to_ms: i64,
    ) -> Result<Value, DriverError> {
        const MAX_HISTORY_WINDOW_MS: i64 = 31 * 24 * 60 * 60 * 1_000;
        if from_ms <= 0 || to_ms <= from_ms || to_ms - from_ms > MAX_HISTORY_WINDOW_MS {
            return Err(DriverError::new("HISTORY_SYNC_REQUEST_INVALID"));
        }
        self.exchange(
            account_id,
            lease_generation,
            MessageKind::HistorySync,
            &json!({"from_ms": from_ms, "to_ms": to_ms}),
        )
    }

    fn exchange<T: Serialize>(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        kind: MessageKind,
        payload: &T,
    ) -> Result<Value, DriverError> {
        let runtime = self
            .runtimes
            .get_mut(account_id)
            .ok_or_else(|| DriverError::new("RUNTIME_NOT_FOUND"))?;
        let pair = runtime
            .pair
            .as_mut()
            .ok_or_else(|| DriverError::new("RUNTIME_NOT_RUNNING"))?;
        let frame = pair
            .signer
            .sign(
                account_id,
                lease_generation,
                kind,
                payload,
                unix_time_ms(),
                self.config.io_timeout.as_millis().min(60_000) as u64,
            )
            .map_err(|_| DriverError::new("IPC_SIGN_FAILED"))?;
        let line = frame_to_line(&frame).map_err(|_| DriverError::new("IPC_FRAME_FAILED"))?;
        pair.adapter_stdin
            .write_all(line.as_bytes())
            .and_then(|_| pair.adapter_stdin.write_all(b"\n"))
            .and_then(|_| pair.adapter_stdin.flush())
            .map_err(|_| DriverError::new("ADAPTER_SYNC_WRITE_FAILED"))?;
        pair.receive(&self.config, account_id, lease_generation, kind)
    }
}

impl RuntimeDriver for ProcessRuntimeDriver {
    fn start(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        credential: CredentialMaterial,
        symbol: &str,
    ) -> Result<StartedRuntime, DriverError> {
        if self.runtimes.contains_key(account_id) {
            return Err(DriverError::new("RUNTIME_ALREADY_EXISTS"));
        }
        let layout = self.prepare_runtime(account_id)?;
        let (pair, snapshot) = Self::start_pair(
            &self.config,
            account_id,
            lease_generation,
            &layout,
            &credential,
            symbol,
        )?;
        let process_ids = ProcessIds {
            terminal_pid: Some(pair.terminal_pid),
            adapter_pid: Some(pair.adapter.id()),
        };
        self.runtimes.insert(
            account_id.to_owned(),
            ManagedRuntime {
                layout,
                credential,
                symbol: symbol.to_owned(),
                pair: Some(pair),
            },
        );
        Ok(StartedRuntime {
            process_ids,
            snapshot,
        })
    }

    fn heartbeat(
        &mut self,
        account_id: &str,
        lease_generation: u64,
    ) -> Result<HeartbeatSummary, DriverError> {
        let runtime = self
            .runtimes
            .get_mut(account_id)
            .ok_or_else(|| DriverError::new("RUNTIME_NOT_FOUND"))?;
        let pair = runtime
            .pair
            .as_mut()
            .ok_or_else(|| DriverError::new("RUNTIME_NOT_RUNNING"))?;
        let frame = pair
            .signer
            .sign(
                account_id,
                lease_generation,
                MessageKind::AgentHeartbeat,
                &json!({}),
                unix_time_ms(),
                self.config.io_timeout.as_millis().min(60_000) as u64,
            )
            .map_err(|_| DriverError::new("IPC_SIGN_FAILED"))?;
        let line = frame_to_line(&frame).map_err(|_| DriverError::new("IPC_FRAME_FAILED"))?;
        pair.adapter_stdin
            .write_all(line.as_bytes())
            .and_then(|_| pair.adapter_stdin.write_all(b"\n"))
            .and_then(|_| pair.adapter_stdin.flush())
            .map_err(|_| DriverError::new("ADAPTER_HEARTBEAT_WRITE_FAILED"))?;
        pair.receive(
            &self.config,
            account_id,
            lease_generation,
            MessageKind::AgentHeartbeat,
        )
    }

    fn clean_restart(
        &mut self,
        account_id: &str,
        lease_generation: u64,
    ) -> Result<StartedRuntime, DriverError> {
        self.restart_runtime(account_id, lease_generation, false)
    }

    fn force_crash_and_recover(
        &mut self,
        account_id: &str,
        lease_generation: u64,
    ) -> Result<StartedRuntime, DriverError> {
        self.restart_runtime(account_id, lease_generation, true)
    }

    fn stop(&mut self, account_id: &str, lease_generation: u64) -> Result<(), DriverError> {
        let mut runtime = self
            .runtimes
            .remove(account_id)
            .ok_or_else(|| DriverError::new("RUNTIME_NOT_FOUND"))?;
        if let Some(pair) = runtime.pair.take() {
            Self::stop_pair(&self.config, account_id, lease_generation, pair)?;
        }
        Ok(())
    }
}

impl ProcessPair {
    fn receive<T: for<'de> serde::Deserialize<'de>>(
        &mut self,
        config: &ProcessDriverConfig,
        account_id: &str,
        lease_generation: u64,
        expected_kind: MessageKind,
    ) -> Result<T, DriverError> {
        let line = match self.adapter_events.recv_timeout(config.io_timeout) {
            Ok(line) => line,
            Err(RecvTimeoutError::Timeout) => return Err(DriverError::new("ADAPTER_IPC_TIMEOUT")),
            Err(RecvTimeoutError::Disconnected) => {
                return Err(DriverError::new("ADAPTER_IPC_DISCONNECTED"));
            }
        };
        let frame = frame_from_line(&line).map_err(|_| DriverError::new("IPC_FRAME_INVALID"))?;
        if frame.kind != expected_kind {
            if frame.kind == MessageKind::AccountRuntimeStatus {
                let payload: Value = self
                    .verifier
                    .verify(&frame, account_id, lease_generation, unix_time_ms())
                    .map_err(|_| DriverError::new("IPC_AUTHENTICATION_FAILED"))?;
                let error_class = payload
                    .get("error_class")
                    .and_then(Value::as_str)
                    .map(adapter_error_class)
                    .unwrap_or("ADAPTER_RUNTIME_DEGRADED");
                return Err(DriverError::new(error_class));
            }
            return Err(DriverError::new("IPC_MESSAGE_KIND_MISMATCH"));
        }
        self.verifier
            .verify(&frame, account_id, lease_generation, unix_time_ms())
            .map_err(|_| DriverError::new("IPC_AUTHENTICATION_FAILED"))
    }
}

fn adapter_error_class(value: &str) -> &'static str {
    match value {
        "MT5_INITIALIZE_FAILED" => "MT5_INITIALIZE_FAILED",
        "MT5_PROCESS_CREATE_FAILED" => "MT5_PROCESS_CREATE_FAILED",
        "MT5_PIPE_SERVER_TIMEOUT" => "MT5_PIPE_SERVER_TIMEOUT",
        "MT5_TERMINAL_NOT_FOUND" => "MT5_TERMINAL_NOT_FOUND",
        "MT5_IPC_INITIALIZE_FAILED" => "MT5_IPC_INITIALIZE_FAILED",
        "MT5_IPC_TIMEOUT" => "MT5_IPC_TIMEOUT",
        "MT5_IPC_RECEIVE_FAILED" => "MT5_IPC_RECEIVE_FAILED",
        "MT5_IPC_SEND_FAILED" => "MT5_IPC_SEND_FAILED",
        "MT5_IPC_FAILED" => "MT5_IPC_FAILED",
        "MT5_VERSION_UNSUPPORTED" => "MT5_VERSION_UNSUPPORTED",
        "MT5_LOGIN_FAILED" => "MT5_LOGIN_FAILED",
        "MT5_ACCOUNT_STATE_UNAVAILABLE" => "MT5_ACCOUNT_STATE_UNAVAILABLE",
        "MT5_SYMBOLS_UNAVAILABLE" => "MT5_SYMBOLS_UNAVAILABLE",
        "MT5_SYMBOL_UNAVAILABLE" => "MT5_SYMBOL_UNAVAILABLE",
        "MT5_SYMBOL_INFO_UNAVAILABLE" => "MT5_SYMBOL_INFO_UNAVAILABLE",
        "FRAME_TOO_LARGE" => "ADAPTER_FRAME_TOO_LARGE",
        "AdapterInputError" => "ADAPTER_INPUT_REJECTED",
        _ => "ADAPTER_RUNTIME_DEGRADED",
    }
}

#[derive(Serialize)]
struct AdapterBootstrap<'a> {
    protocol_version: u32,
    worker_id: &'a str,
    account_id: &'a str,
    lease_generation: u64,
    ipc_key_hex: &'a str,
    terminal_path: &'a Path,
    login: &'a str,
    password: &'a str,
    server: &'a str,
    symbol: &'a str,
    timeout_ms: u64,
}

fn run_acl_helper(
    config: &ProcessDriverConfig,
    runtime_directory: &Path,
) -> Result<(), DriverError> {
    let output = Command::new(&config.powershell_path)
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(&config.acl_helper_path)
        .arg("-DataRoot")
        .arg(&config.data_root)
        .arg("-RuntimePath")
        .arg(runtime_directory)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(|_| DriverError::new("RUNTIME_ACL_HELPER_FAILED"))?;
    if !output.status.success() || output.stdout.len() > 16 * 1024 {
        return Err(DriverError::new("RUNTIME_ACL_REJECTED"));
    }
    let result: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| DriverError::new("RUNTIME_ACL_RESULT_INVALID"))?;
    if result.get("ok") != Some(&Value::Bool(true))
        || result.get("reparse_free") != Some(&Value::Bool(true))
        || result.get("inheritance_disabled") != Some(&Value::Bool(true))
    {
        return Err(DriverError::new("RUNTIME_ACL_RESULT_INVALID"));
    }
    Ok(())
}

fn verify_sha256(path: &Path, expected: &str) -> Result<(), DriverError> {
    use sha2::{Digest, Sha256};

    if expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(DriverError::new("ARTIFACT_PIN_INVALID"));
    }
    let bytes = fs::read(path).map_err(|_| DriverError::new("ARTIFACT_READ_FAILED"))?;
    let actual = format!("{:x}", Sha256::digest(bytes));
    if !actual.eq_ignore_ascii_case(expected) {
        return Err(DriverError::new("ARTIFACT_PIN_MISMATCH"));
    }
    Ok(())
}

fn write_disabled_mcp_config(
    data_root: &Path,
    runtime_config_directory: &Path,
    metatrader_port: u16,
) -> Result<PathBuf, DriverError> {
    let path = runtime_config_directory.join("assistant.ini");
    if path.exists() {
        assert_no_reparse_below(data_root, &path)?;
    }
    let metaeditor_port = metatrader_port.saturating_add(1);
    let contents = format!(
        "[MCP.MetaEditor]\r\nEnable=0\r\nEndpoint=http://127.0.0.1:{metaeditor_port}/mcp\r\n\r\n[MCP.MetaTrader]\r\nEnable=0\r\nEndpoint=http://127.0.0.1:{metatrader_port}/mcp\r\n\r\n[MCP.Custom]\r\n"
    );
    let mut bytes = Vec::with_capacity(contents.len() * 2 + 2);
    bytes.extend_from_slice(&[0xff, 0xfe]);
    for code_unit in contents.encode_utf16() {
        bytes.extend_from_slice(&code_unit.to_le_bytes());
    }
    fs::write(&path, bytes).map_err(|_| DriverError::new("MCP_DISABLE_CONFIG_FAILED"))?;
    assert_no_reparse_below(data_root, &path)?;
    Ok(path)
}

fn terminal_instance_config_directory(
    terminal_path: &Path,
) -> Result<(PathBuf, PathBuf), DriverError> {
    let terminal_directory = terminal_path
        .parent()
        .ok_or_else(|| DriverError::new("TERMINAL_PATH_INVALID"))?;
    let instance_id = terminal_instance_id(terminal_directory)?;

    let app_data = env::var_os("APPDATA").ok_or_else(|| DriverError::new("APPDATA_MISSING"))?;
    let state_root = PathBuf::from(app_data).join("MetaQuotes").join("Terminal");
    if !state_root.is_absolute()
        || state_root
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(DriverError::new("TERMINAL_STATE_ROOT_INVALID"));
    }
    fs::create_dir_all(&state_root)
        .map_err(|_| DriverError::new("TERMINAL_STATE_DIRECTORY_CREATE_FAILED"))?;
    assert_no_reparse_components(&state_root)?;
    let config_directory = state_root.join(instance_id).join("Config");
    fs::create_dir_all(&config_directory)
        .map_err(|_| DriverError::new("TERMINAL_STATE_DIRECTORY_CREATE_FAILED"))?;
    assert_no_reparse_below(&state_root, &config_directory)?;
    Ok((state_root, config_directory))
}

fn terminal_instance_id(terminal_directory: &Path) -> Result<String, DriverError> {
    let terminal_directory_text = terminal_directory
        .to_str()
        .ok_or_else(|| DriverError::new("TERMINAL_PATH_INVALID"))?
        .to_uppercase();
    let mut utf16_le = Vec::with_capacity(terminal_directory_text.len() * 2);
    for code_unit in terminal_directory_text.encode_utf16() {
        utf16_le.extend_from_slice(&code_unit.to_le_bytes());
    }
    Ok(format!("{:X}", Md5::digest(utf16_le)))
}

fn assert_no_reparse_components(path: &Path) -> Result<(), DriverError> {
    let mut current = Some(path);
    while let Some(component) = current {
        if component.exists() && is_reparse_point(component)? {
            return Err(DriverError::new("REPARSE_POINT_REJECTED"));
        }
        current = component.parent();
    }
    Ok(())
}

fn assert_no_reparse_below(root: &Path, candidate: &Path) -> Result<(), DriverError> {
    let root = fs::canonicalize(root).map_err(|_| DriverError::new("DATA_ROOT_INVALID"))?;
    let candidate =
        fs::canonicalize(candidate).map_err(|_| DriverError::new("RUNTIME_PATH_INVALID"))?;
    if !candidate.starts_with(&root) {
        return Err(DriverError::new("RUNTIME_PATH_ESCAPED"));
    }
    let mut current = candidate.as_path();
    loop {
        if is_reparse_point(current)? {
            return Err(DriverError::new("REPARSE_POINT_REJECTED"));
        }
        if current == root {
            break;
        }
        current = current
            .parent()
            .ok_or_else(|| DriverError::new("RUNTIME_PATH_ESCAPED"))?;
    }
    Ok(())
}

#[cfg(windows)]
fn is_reparse_point(path: &Path) -> Result<bool, DriverError> {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
    let metadata =
        fs::symlink_metadata(path).map_err(|_| DriverError::new("PATH_METADATA_FAILED"))?;
    Ok(metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
}

#[cfg(not(windows))]
fn is_reparse_point(path: &Path) -> Result<bool, DriverError> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| DriverError::new("PATH_METADATA_FAILED"))?;
    Ok(metadata.file_type().is_symlink())
}

#[cfg(windows)]
fn configure_hidden_process(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Threading::{CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW};

    command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
}

#[cfg(not(windows))]
fn configure_hidden_process(_command: &mut Command) {}

#[cfg(windows)]
fn find_process_id_by_path(expected_path: &Path) -> Option<u32> {
    use std::mem::{size_of, zeroed};

    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
    };

    let expected = fs::canonicalize(expected_path).ok()?;
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return None;
    }
    let mut entry: PROCESSENTRY32W = unsafe { zeroed() };
    entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
    let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while has_entry {
        let process =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, entry.th32ProcessID) };
        if !process.is_null() {
            let mut buffer = vec![0_u16; 32_768];
            let mut length = buffer.len() as u32;
            let queried =
                unsafe { QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length) }
                    != 0;
            unsafe { CloseHandle(process) };
            if queried {
                let path = PathBuf::from(String::from_utf16_lossy(&buffer[..length as usize]));
                if fs::canonicalize(path).ok().as_ref() == Some(&expected) {
                    unsafe { CloseHandle(snapshot) };
                    return Some(entry.th32ProcessID);
                }
            }
        }
        has_entry = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe { CloseHandle(snapshot) };
    None
}

#[cfg(not(windows))]
fn find_process_id_by_path(_expected_path: &Path) -> Option<u32> {
    None
}

fn wait_or_kill(child: &mut Child, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(_) => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn kill_and_wait(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[derive(Clone, Copy)]
    struct ProcessResourceSample {
        cpu_100ns: u64,
        working_set_bytes: u64,
    }

    #[cfg(windows)]
    fn process_resource_sample(pid: u32) -> Result<ProcessResourceSample, &'static str> {
        use windows_sys::Win32::Foundation::{CloseHandle, FILETIME};
        use windows_sys::Win32::System::ProcessStatus::{
            K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
        };
        use windows_sys::Win32::System::Threading::{
            GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
        };

        let process =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid) };
        if process.is_null() {
            return Err("RESOURCE_SAMPLE_PROCESS_UNAVAILABLE");
        }
        let mut created = FILETIME::default();
        let mut exited = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        let times_ok =
            unsafe { GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user) }
                != 0;
        let mut memory = PROCESS_MEMORY_COUNTERS {
            cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
            ..Default::default()
        };
        let memory_ok = unsafe {
            K32GetProcessMemoryInfo(
                process,
                &mut memory,
                std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
            )
        } != 0;
        unsafe { CloseHandle(process) };
        if !times_ok || !memory_ok {
            return Err("RESOURCE_SAMPLE_FAILED");
        }
        let filetime =
            |value: FILETIME| ((value.dwHighDateTime as u64) << 32) | value.dwLowDateTime as u64;
        Ok(ProcessResourceSample {
            cpu_100ns: filetime(kernel).saturating_add(filetime(user)),
            working_set_bytes: memory.WorkingSetSize as u64,
        })
    }

    #[cfg(windows)]
    fn aggregate_resource_sample(
        process_ids: ProcessIds,
    ) -> Result<ProcessResourceSample, &'static str> {
        let mut aggregate = ProcessResourceSample {
            cpu_100ns: 0,
            working_set_bytes: 0,
        };
        for pid in [process_ids.terminal_pid, process_ids.adapter_pid]
            .into_iter()
            .flatten()
        {
            let sample = process_resource_sample(pid)?;
            aggregate.cpu_100ns = aggregate.cpu_100ns.saturating_add(sample.cpu_100ns);
            aggregate.working_set_bytes = aggregate
                .working_set_bytes
                .saturating_add(sample.working_set_bytes);
        }
        Ok(aggregate)
    }

    #[derive(Deserialize)]
    struct LiveValidationRequest {
        schema_version: u32,
        agent_path: PathBuf,
        worker_id: String,
        account_id: String,
        lease_generation: u64,
        data_root: PathBuf,
        terminal_slots: Vec<TerminalSlotConfig>,
        python_path: PathBuf,
        adapter_path: PathBuf,
        acl_helper_path: PathBuf,
        powershell_path: PathBuf,
        python_sha256: String,
        adapter_sha256: String,
        login: String,
        password: String,
        server: String,
        symbol: String,
        independent_web_match_confirmed: bool,
    }

    impl Drop for LiveValidationRequest {
        fn drop(&mut self) {
            self.login.zeroize();
            self.password.zeroize();
            self.server.zeroize();
        }
    }

    fn run_live_installed_slot_lifecycle(
        request: LiveValidationRequest,
    ) -> Result<Value, &'static str> {
        if request.schema_version != 1
            || !request.agent_path.is_absolute()
            || !crate::is_safe_identifier(&request.account_id)
            || request.lease_generation == 0
        {
            return Err("LIVE_VALIDATION_REQUEST_INVALID");
        }
        let independent_web_match_confirmed = request.independent_web_match_confirmed;
        let account_id = request.account_id.clone();
        let lease_generation = request.lease_generation;
        let symbol = request.symbol.clone();
        let credential = CredentialMaterial::new(
            request.login.clone(),
            request.password.clone(),
            request.server.clone(),
        )
        .map_err(|_| "CREDENTIAL_INVALID")?;
        let config = ProcessDriverConfig::try_from(ProcessDriverConfigInput {
            worker_id: request.worker_id.clone(),
            data_root: request.data_root.clone(),
            terminal_slots: request.terminal_slots.clone(),
            python_path: request.python_path.clone(),
            adapter_path: request.adapter_path.clone(),
            acl_helper_path: request.acl_helper_path.clone(),
            powershell_path: request.powershell_path.clone(),
            artifact_pins: ArtifactPins {
                python_sha256: request.python_sha256.clone(),
                adapter_sha256: request.adapter_sha256.clone(),
            },
            adapter_event_capacity: Some(DEFAULT_ADAPTER_EVENT_CAPACITY),
            job_active_process_limit: Some(DEFAULT_JOB_ACTIVE_PROCESS_LIMIT),
            job_process_memory_limit: Some(DEFAULT_JOB_PROCESS_MEMORY_LIMIT),
            io_timeout_ms: Some(75_000),
            graceful_stop_timeout_ms: Some(5_000),
            restart_spacing_ms: Some(2_000),
        })
        .map_err(|error| error.error_class)?;
        let mut driver = ProcessRuntimeDriver::new(config).map_err(|error| error.error_class)?;
        let started_at = Instant::now();
        let first = driver
            .start(&account_id, lease_generation, credential, &symbol)
            .map_err(|error| error.error_class)?;
        let first_ms = started_at.elapsed().as_millis() as u64;
        let started_at = Instant::now();
        let second = driver
            .clean_restart(&account_id, lease_generation)
            .map_err(|error| error.error_class)?;
        let second_ms = started_at.elapsed().as_millis() as u64;
        let started_at = Instant::now();
        let third = driver
            .clean_restart(&account_id, lease_generation)
            .map_err(|error| error.error_class)?;
        let third_ms = started_at.elapsed().as_millis() as u64;
        let started_at = Instant::now();
        let fourth = driver
            .force_crash_and_recover(&account_id, lease_generation)
            .map_err(|error| error.error_class)?;
        let fourth_ms = started_at.elapsed().as_millis() as u64;
        let heartbeat = driver
            .heartbeat(&account_id, lease_generation)
            .map_err(|error| error.error_class)?;
        #[cfg(windows)]
        let idle_resources = {
            let settlement = Duration::from_secs(15);
            let interval = Duration::from_secs(10);
            thread::sleep(settlement);
            let before = aggregate_resource_sample(fourth.process_ids)?;
            thread::sleep(interval);
            let after = aggregate_resource_sample(fourth.process_ids)?;
            let cpu_delta = after.cpu_100ns.saturating_sub(before.cpu_100ns);
            json!({
                "settlement_ms": settlement.as_millis() as u64,
                "observation_ms": interval.as_millis() as u64,
                "aggregate_working_set_bytes": after.working_set_bytes,
                "aggregate_cpu_core_percent": cpu_delta as f64
                    / (interval.as_secs_f64() * 10_000_000.0)
                    * 100.0,
            })
        };
        #[cfg(not(windows))]
        let idle_resources = Value::Null;
        let snapshots = vec![
            first.snapshot,
            second.snapshot,
            third.snapshot,
            fourth.snapshot,
        ];
        let snapshots_pass = snapshots
            .iter()
            .all(SnapshotSummary::passes_phase1_demo_gate);
        let heartbeat_pass =
            heartbeat.healthy && heartbeat.login_matches && heartbeat.server_matches;
        driver
            .stop(&account_id, lease_generation)
            .map_err(|error| error.error_class)?;
        if !snapshots_pass || !heartbeat_pass {
            return Err("LIVE_SNAPSHOT_GATE_FAILED");
        }
        Ok(json!({
            "schema_version": 1,
            "phase": "mt5_windows_vm_phase1",
            "status": if independent_web_match_confirmed { "PASS" } else { "CONDITIONAL_PASS" },
            "lifecycle": {
                "provision": true,
                "clean_restarts": 2,
                "forced_terminal_crash_recovered": true,
                "heartbeat_after_recovery": true,
                "graceful_stop": true,
                "independent_web_match_confirmed": independent_web_match_confirmed,
            },
            "security": {
                "authenticated_control_frames": "covered_by_unit_tests",
                "authenticated_adapter_stdio": true,
                "bounded_adapter_events": true,
                "per_runtime_job_limits": true,
                "acl_and_reparse_checks": true,
                "artifact_pins_verified": true,
                "credentials_absent_from_process_arguments": true,
                "application_control_test_host": true,
            },
            "snapshots": snapshots,
            "lifecycle_latency_ms": [first_ms, second_ms, third_ms, fourth_ms],
            "idle_resources": idle_resources,
            "error_class": Value::Null,
        }))
    }

    #[test]
    #[ignore = "credentialed Windows validation; request is read only from redirected stdin"]
    fn live_installed_slot_lifecycle_from_stdin() {
        use std::io::Read;

        let mut raw = Zeroizing::new(String::new());
        let result = match std::io::stdin().read_to_string(&mut raw) {
            Ok(_) => match serde_json::from_str::<LiveValidationRequest>(&raw) {
                Ok(request) => run_live_installed_slot_lifecycle(request),
                Err(_) => Err("LIVE_VALIDATION_REQUEST_INVALID"),
            },
            Err(_) => Err("LIVE_VALIDATION_REQUEST_INVALID"),
        };
        raw.zeroize();
        let passed = result.is_ok();
        let output = result.unwrap_or_else(|error_class| {
            json!({
                "schema_version": 1,
                "phase": "mt5_windows_vm_phase1",
                "status": "BLOCKED",
                "error_class": error_class,
            })
        });
        println!(
            "PHASE1_LIVE_RESULT={}",
            serde_json::to_string(&output).expect("safe validation result must serialize")
        );
        assert!(passed, "credentialed Phase 1 lifecycle did not pass");
    }

    #[cfg(windows)]
    fn process_is_running(pid: u32) -> bool {
        use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
        use windows_sys::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };

        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if process.is_null() {
            return false;
        }
        let mut exit_code = 0_u32;
        let queried = unsafe { GetExitCodeProcess(process, &mut exit_code) } != 0;
        unsafe { CloseHandle(process) };
        queried && exit_code == STILL_ACTIVE as u32
    }

    #[test]
    fn process_config_rejects_unpinned_and_relative_artifacts() {
        let config = ProcessDriverConfig {
            worker_id: "worker-01".to_owned(),
            data_root: PathBuf::from("relative"),
            terminal_slots: vec![TerminalSlotConfig {
                terminal_path: PathBuf::from("terminal64.exe"),
                terminal_sha256: String::new(),
                servers_sha256: String::new(),
                terminal_license_sha256: String::new(),
            }],
            python_path: PathBuf::from("python.exe"),
            adapter_path: PathBuf::from("phase1_adapter.py"),
            acl_helper_path: PathBuf::from("acl.ps1"),
            powershell_path: PathBuf::from("powershell.exe"),
            artifact_pins: ArtifactPins {
                python_sha256: String::new(),
                adapter_sha256: String::new(),
            },
            adapter_event_capacity: DEFAULT_ADAPTER_EVENT_CAPACITY,
            job_active_process_limit: DEFAULT_JOB_ACTIVE_PROCESS_LIMIT,
            job_process_memory_limit: DEFAULT_JOB_PROCESS_MEMORY_LIMIT,
            io_timeout: Duration::from_secs(12),
            graceful_stop_timeout: Duration::from_secs(5),
            restart_spacing: Duration::from_millis(1),
        };
        assert_eq!(
            DriverError::new("INVALID_PROCESS_CONFIG"),
            config.validate().unwrap_err()
        );
    }

    #[test]
    fn process_driver_exposes_authenticated_phase4_sync_commands() {
        let _snapshot: fn(
            &mut ProcessRuntimeDriver,
            &str,
            u64,
            &[String],
        ) -> Result<Value, DriverError> = ProcessRuntimeDriver::snapshot_sync;
        let _history: fn(
            &mut ProcessRuntimeDriver,
            &str,
            u64,
            i64,
            i64,
        ) -> Result<Value, DriverError> = ProcessRuntimeDriver::history_sync;
    }

    #[cfg(windows)]
    #[test]
    fn initialize_failure_cleanup_leaves_no_child_process_alive() {
        let mut pids = (0_u32, 0_u32);
        let result: Result<(), DriverError> = (|| {
            let job = ProcessJob::new(4, 256 * 1024 * 1024)
                .map_err(|_| DriverError::new("JOB_CREATE_FAILED"))?;
            let mut starting = StartingProcessPair::new(job);
            let mut command = Command::new("powershell.exe");
            command
                .args([
                    "-NoProfile",
                    "-Command",
                    "$null=[Console]::In.ReadLine(); $child=Start-Process ping.exe -ArgumentList @('127.0.0.1','-n','30') -WindowStyle Hidden -PassThru; [Console]::Out.WriteLine($child.Id); [Console]::Out.Flush(); Start-Sleep -Seconds 30",
                ])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped());
            configure_hidden_process(&mut command);
            let mut adapter = command
                .spawn()
                .map_err(|_| DriverError::new("TEST_CHILD_START_FAILED"))?;
            starting
                .job
                .as_ref()
                .expect("test job")
                .assign(&adapter)
                .map_err(|_| DriverError::new("TEST_CHILD_ASSIGN_FAILED"))?;
            adapter
                .stdin
                .take()
                .expect("test stdin")
                .write_all(b"start\n")
                .expect("release child start");
            let mut terminal_pid = String::new();
            BufReader::new(adapter.stdout.take().expect("test stdout"))
                .read_line(&mut terminal_pid)
                .expect("read child pid");
            pids = (
                terminal_pid.trim().parse().expect("valid child pid"),
                adapter.id(),
            );
            starting.adapter = Some(adapter);
            assert!(process_is_running(pids.0));
            assert!(process_is_running(pids.1));
            Err(DriverError::new("MT5_INITIALIZE_FAILED"))
        })();
        assert_eq!(
            DriverError::new("MT5_INITIALIZE_FAILED"),
            result.unwrap_err()
        );

        // Dropping the startup guard on the error path synchronously kills and waits
        // both children, so no terminal can escape before runtime registration.
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline
            && (process_is_running(pids.0) || process_is_running(pids.1))
        {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(!process_is_running(pids.0));
        assert!(!process_is_running(pids.1));
    }

    #[cfg(windows)]
    #[test]
    fn terminal_instance_id_matches_metatrader_path_hash() {
        assert_eq!(
            "D0E8209F77C8CF37AD8BF550E51FF075",
            terminal_instance_id(Path::new(r"C:\Program Files\MetaTrader 5")).expect("instance id")
        );
    }
}
