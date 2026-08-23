use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, TryRecvError};
use std::thread;
use std::time::{Duration, Instant};

use execution_domain::mt5_vm_control::{
    WorkerEaBootstrapBindRequest, WorkerEaBootstrapBindResponse,
};
use md5::{Digest as Md5Digest, Md5};
use reqwest::{StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::Sha256;
use zeroize::{Zeroize, Zeroizing};

use crate::checked_runtime_directory;
use crate::job::ProcessJob;
use crate::managed::SecretText;
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
pub const DEFAULT_CPU_BUDGET_PERCENT: u32 = 100;
pub const DEFAULT_MINIMUM_FREE_DISK_BYTES: u64 = 5 * 1024 * 1024 * 1024;

fn valid_ea_gateway_origin(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    if url.cannot_be_a_base()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
        || url.origin().ascii_serialization() != value
    {
        return false;
    }
    match url.scheme() {
        "https" => true,
        "http" => url.host_str().is_some_and(|host| {
            host.eq_ignore_ascii_case("localhost")
                || host
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|address| address.is_loopback())
        }),
        _ => false,
    }
}

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
    #[serde(default)]
    pub ea_path: Option<PathBuf>,
    #[serde(default)]
    pub ea_sha256: Option<String>,
    #[serde(default)]
    pub ea_bootstrap_pipe: Option<String>,
    #[serde(default)]
    pub ea_profile: Option<String>,
    #[serde(default)]
    pub slot_id: Option<String>,
    #[serde(default)]
    pub ea_gateway_origin: Option<String>,
    #[serde(default)]
    pub ea_profile_chart_path: Option<PathBuf>,
    #[serde(default)]
    pub ea_profile_chart_sha256: Option<String>,
    #[serde(default)]
    pub ea_webrequest_settings_path: Option<PathBuf>,
    #[serde(default)]
    pub ea_webrequest_settings_sha256: Option<String>,
    #[serde(default)]
    pub ea_topology_attestation_path: Option<PathBuf>,
    #[serde(default)]
    pub ea_topology_attestation_sha256: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EaTopologyAttestation {
    schema_version: u32,
    settings_file_name: String,
    settings_sha256: String,
    allowed_origins: Vec<String>,
    probe_succeeded: bool,
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
    pub cpu_budget_percent: Option<u32>,
    pub minimum_free_disk_bytes: Option<u64>,
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
            cpu_budget_percent: input
                .cpu_budget_percent
                .unwrap_or(DEFAULT_CPU_BUDGET_PERCENT),
            minimum_free_disk_bytes: input
                .minimum_free_disk_bytes
                .unwrap_or(DEFAULT_MINIMUM_FREE_DISK_BYTES),
            io_timeout: Duration::from_millis(input.io_timeout_ms.unwrap_or(15_000)),
            graceful_stop_timeout: Duration::from_millis(
                input.graceful_stop_timeout_ms.unwrap_or(5_000),
            ),
            restart_spacing: Duration::from_millis(input.restart_spacing_ms.unwrap_or(2_000)),
            slot_index: 0,
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
    pub cpu_budget_percent: u32,
    pub minimum_free_disk_bytes: u64,
    pub io_timeout: Duration,
    pub graceful_stop_timeout: Duration,
    pub restart_spacing: Duration,
    pub(crate) slot_index: usize,
}

pub struct EaBootstrapMaterial {
    token: SecretText,
    client: reqwest::blocking::Client,
    bind_endpoint: Url,
    session_token: SecretText,
    binding: EaBootstrapBinding,
}

pub(crate) struct EaBootstrapBinding {
    protocol_version: u16,
    worker_id: String,
    session_generation: u64,
    connection_revision: u64,
}

impl EaBootstrapBinding {
    pub(crate) fn new(
        protocol_version: u16,
        worker_id: String,
        session_generation: u64,
        connection_revision: u64,
    ) -> Self {
        Self {
            protocol_version,
            worker_id,
            session_generation,
            connection_revision,
        }
    }
}

impl EaBootstrapMaterial {
    pub(crate) fn new(
        token: SecretText,
        client: reqwest::blocking::Client,
        bind_endpoint: Url,
        session_token: SecretText,
        binding: EaBootstrapBinding,
    ) -> Self {
        Self {
            token,
            client,
            bind_endpoint,
            session_token,
            binding,
        }
    }
}

struct EaBootstrapBindContext {
    client: reqwest::blocking::Client,
    bind_endpoint: Url,
    session_token: SecretText,
    protocol_version: u16,
    worker_id: String,
    session_generation: u64,
    connection_revision: u64,
    pairing_token_sha256: String,
}

impl ProcessDriverConfig {
    pub(crate) fn into_slot_configs(self) -> Vec<Self> {
        let slots = self.terminal_slots.clone();
        slots
            .into_iter()
            .enumerate()
            .map(|(slot_index, slot)| {
                let mut config = self.clone();
                config.terminal_slots = vec![slot];
                config.slot_index = slot_index;
                config
            })
            .collect()
    }

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
            || !(1..=100).contains(&self.cpu_budget_percent)
            || self.minimum_free_disk_bytes == 0
            || self.slot_index >= crate::HARD_MAX_TERMINALS
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
        let mut bootstrap_pipes = HashSet::with_capacity(self.terminal_slots.len());
        let mut ea_profiles = HashSet::with_capacity(self.terminal_slots.len());
        let mut slot_ids = HashSet::with_capacity(self.terminal_slots.len());
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
            let managed_field_presence = [
                slot.ea_path.is_some(),
                slot.ea_sha256.is_some(),
                slot.ea_bootstrap_pipe.is_some(),
                slot.ea_profile.is_some(),
                slot.slot_id.is_some(),
                slot.ea_gateway_origin.is_some(),
                slot.ea_profile_chart_path.is_some(),
                slot.ea_profile_chart_sha256.is_some(),
                slot.ea_webrequest_settings_path.is_some(),
                slot.ea_webrequest_settings_sha256.is_some(),
                slot.ea_topology_attestation_path.is_some(),
                slot.ea_topology_attestation_sha256.is_some(),
            ];
            if managed_field_presence.iter().any(|present| *present) {
                if managed_field_presence.iter().any(|present| !*present) {
                    return Err(DriverError::new("INCOMPLETE_MANAGED_EA_SLOT"));
                }
                let ea_path = slot.ea_path.as_ref().expect("presence checked");
                let pipe_name = slot.ea_bootstrap_pipe.as_ref().expect("presence checked");
                let profile = slot.ea_profile.as_ref().expect("presence checked");
                let slot_id = slot.slot_id.as_ref().expect("presence checked");
                let gateway_origin = slot.ea_gateway_origin.as_ref().expect("presence checked");
                if !ea_path.is_absolute()
                    || ea_path
                        .components()
                        .any(|component| matches!(component, Component::ParentDir))
                    || !ea_path.is_file()
                    || !crate::is_safe_identifier(pipe_name)
                    || !crate::is_safe_identifier(profile)
                    || !crate::is_safe_identifier(slot_id)
                    || !valid_ea_gateway_origin(gateway_origin)
                    || !bootstrap_pipes.insert(pipe_name)
                    || !ea_profiles.insert(profile)
                    || !slot_ids.insert(slot_id)
                {
                    return Err(DriverError::new("INVALID_MANAGED_EA_SLOT"));
                }
                validate_managed_ea_topology(slot, &terminal_state_root)?;
            }
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
    ea_bootstrap_pipe: Option<String>,
    ea_profile: Option<String>,
    slot_id: Option<String>,
    ea_gateway_origin: Option<String>,
}

struct ManagedRuntime {
    layout: RuntimeLayout,
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
        ensure_minimum_free_disk(&runtime_directory, self.config.minimum_free_disk_bytes)?;

        let slot = self
            .config
            .terminal_slots
            .iter()
            .find(|slot| {
                !self
                    .runtimes
                    .values()
                    .any(|runtime| runtime.layout.terminal_path == slot.terminal_path)
            })
            .cloned()
            .ok_or_else(|| DriverError::new("TERMINAL_SLOT_CAPACITY_EXHAUSTED"))?;
        let terminal_path = slot.terminal_path;
        if find_process_id_by_path(&terminal_path).is_some() {
            return Err(DriverError::new("TERMINAL_SLOT_ALREADY_RUNNING"));
        }
        let terminal_install_root = terminal_path
            .parent()
            .ok_or_else(|| DriverError::new("TERMINAL_SLOT_INVALID"))?;
        let terminal_install_config = terminal_install_root.join("Config");
        assert_no_reparse_components(terminal_install_root)?;
        assert_no_reparse_below(terminal_install_root, &terminal_install_config)?;
        let first_mcp_port = 24_000_u16.saturating_add((self.config.slot_index as u16) * 2);
        let mcp_port = (first_mcp_port..=31_998_u16)
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
            ea_bootstrap_pipe: slot.ea_bootstrap_pipe,
            ea_profile: slot.ea_profile,
            slot_id: slot.slot_id,
            ea_gateway_origin: slot.ea_gateway_origin,
        })
    }

    fn start_pair(
        config: &ProcessDriverConfig,
        account_id: &str,
        lease_generation: u64,
        layout: &RuntimeLayout,
        credential: &CredentialMaterial,
        symbol: &str,
        ea_bootstrap: Option<EaBootstrapMaterial>,
    ) -> Result<(ProcessPair, SnapshotSummary), DriverError> {
        let (ea_bootstrap_server, ea_bootstrap_binding) =
            prepare_ea_bootstrap(config, layout, ea_bootstrap)?;
        let job = ProcessJob::new(
            config.job_active_process_limit,
            config.job_process_memory_limit,
            config.cpu_budget_percent,
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
            terminal_profile: layout.ea_profile.as_deref(),
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
        let ea_runtime = EaBootstrapRuntime {
            account_id,
            lease_generation,
            layout,
            terminal_pid,
        };
        let ea_binding = ea_bootstrap_binding.as_ref();
        finish_ea(ea_binding, ea_bootstrap_server, &ea_runtime)?;
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
        _lease_generation: u64,
        _forced_crash: bool,
    ) -> Result<StartedRuntime, DriverError> {
        self.runtimes
            .get(account_id)
            .ok_or_else(|| DriverError::new("RUNTIME_NOT_FOUND"))?;
        authorize_restart_without_credential()
    }

    pub(crate) fn start_with_ea_bootstrap(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        credential: CredentialMaterial,
        symbol: &str,
        ea_bootstrap: Option<EaBootstrapMaterial>,
    ) -> Result<StartedRuntime, DriverError> {
        self.start_runtime(
            account_id,
            lease_generation,
            credential,
            symbol,
            ea_bootstrap,
        )
    }

    fn start_runtime(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        credential: CredentialMaterial,
        symbol: &str,
        ea_bootstrap: Option<EaBootstrapMaterial>,
    ) -> Result<StartedRuntime, DriverError> {
        if self.runtimes.contains_key(account_id) {
            return Err(DriverError::new("RUNTIME_ALREADY_EXISTS"));
        }
        let layout = self.prepare_runtime(account_id)?;
        self.runtimes.insert(
            account_id.to_owned(),
            ManagedRuntime {
                layout,
                symbol: symbol.to_owned(),
                pair: None,
            },
        );
        let start_result = {
            let runtime = self
                .runtimes
                .get(account_id)
                .expect("runtime was reserved before process start");
            Self::start_pair(
                &self.config,
                account_id,
                lease_generation,
                &runtime.layout,
                &credential,
                &runtime.symbol,
                ea_bootstrap,
            )
        };
        let (pair, snapshot) = match start_result {
            Ok(started) => started,
            Err(error) => {
                let cleanup = self
                    .runtimes
                    .get(account_id)
                    .ok_or_else(|| DriverError::new("RUNTIME_NOT_FOUND"))
                    .and_then(|runtime| {
                        cleanup_runtime_assignment(&self.config, account_id, &runtime.layout)
                    });
                if cleanup.is_ok() {
                    self.runtimes.remove(account_id);
                }
                return Err(error);
            }
        };
        let process_ids = ProcessIds {
            terminal_pid: Some(pair.terminal_pid),
            adapter_pid: Some(pair.adapter.id()),
        };
        self.runtimes
            .get_mut(account_id)
            .expect("runtime remained reserved during process start")
            .pair = Some(pair);
        Ok(StartedRuntime {
            process_ids,
            snapshot,
        })
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

fn authorize_restart_without_credential<T>() -> Result<T, DriverError> {
    Err(DriverError::new("CREDENTIAL_REISSUE_REQUIRED"))
}

impl RuntimeDriver for ProcessRuntimeDriver {
    fn start(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        credential: CredentialMaterial,
        symbol: &str,
    ) -> Result<StartedRuntime, DriverError> {
        self.start_runtime(account_id, lease_generation, credential, symbol, None)
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
        let pair = self
            .runtimes
            .get_mut(account_id)
            .ok_or_else(|| DriverError::new("RUNTIME_NOT_FOUND"))?
            .pair
            .take();
        if let Some(pair) = pair {
            Self::stop_pair(&self.config, account_id, lease_generation, pair)?;
        }
        let runtime = self
            .runtimes
            .get(account_id)
            .ok_or_else(|| DriverError::new("RUNTIME_NOT_FOUND"))?;
        cleanup_runtime_assignment(&self.config, account_id, &runtime.layout)?;
        self.runtimes.remove(account_id);
        Ok(())
    }
}

fn wait_for_terminal_exit(terminal_path: &Path, timeout: Duration) -> Result<(), DriverError> {
    let deadline = Instant::now() + timeout;
    while find_process_id_by_path(terminal_path).is_some() {
        if Instant::now() >= deadline {
            return Err(DriverError::new("TERMINAL_CLEANUP_POSTCONDITION_FAILED"));
        }
        thread::sleep(Duration::from_millis(25));
    }
    Ok(())
}

fn ensure_runtime_cleanup_complete(
    runtime_exists: bool,
    terminal_process_exists: bool,
) -> Result<(), DriverError> {
    if runtime_exists || terminal_process_exists {
        return Err(DriverError::new("RUNTIME_CLEANUP_POSTCONDITION_FAILED"));
    }
    Ok(())
}

fn cleanup_runtime_assignment(
    config: &ProcessDriverConfig,
    account_id: &str,
    layout: &RuntimeLayout,
) -> Result<(), DriverError> {
    let expected = checked_runtime_directory(&config.data_root, account_id)
        .map_err(|_| DriverError::new("UNSAFE_RUNTIME_PATH"))?;
    if expected != layout.runtime_directory {
        return Err(DriverError::new("RUNTIME_CLEANUP_PATH_MISMATCH"));
    }
    wait_for_terminal_exit(&layout.terminal_path, config.graceful_stop_timeout)?;
    remove_runtime_directory(config, layout)?;
    ensure_runtime_cleanup_complete(
        layout.runtime_directory.exists(),
        find_process_id_by_path(&layout.terminal_path).is_some(),
    )
}

fn remove_runtime_directory(
    config: &ProcessDriverConfig,
    layout: &RuntimeLayout,
) -> Result<(), DriverError> {
    if !layout.runtime_directory.exists() {
        return Ok(());
    }
    assert_no_reparse_below(&config.data_root, &layout.runtime_directory)?;
    fs::remove_dir_all(&layout.runtime_directory)
        .map_err(|_| DriverError::new("RUNTIME_CLEANUP_FAILED"))
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
    #[serde(skip_serializing_if = "Option::is_none")]
    terminal_profile: Option<&'a str>,
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

fn decode_mt5_text(bytes: &[u8]) -> Result<String, DriverError> {
    if bytes.starts_with(&[0xff, 0xfe]) {
        let payload = &bytes[2..];
        if !payload.len().is_multiple_of(2) {
            return Err(DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"));
        }
        let words = payload
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect::<Vec<_>>();
        return String::from_utf16(&words)
            .map_err(|_| DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"));
    }
    let payload = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    String::from_utf8(payload.to_vec()).map_err(|_| DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"))
}

fn validate_managed_ea_chart(
    path: &Path,
    bootstrap_pipe: &str,
    gateway_origin: &str,
) -> Result<(), DriverError> {
    let bytes = fs::read(path).map_err(|_| DriverError::new("ARTIFACT_READ_FAILED"))?;
    let contents = decode_mt5_text(&bytes)?;
    if contents.is_empty() || contents.contains('\0') {
        return Err(DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"));
    }
    let lines = contents.lines().map(str::trim).collect::<Vec<_>>();
    let exact_count = |expected: &str| lines.iter().filter(|line| **line == expected).count();
    let property_count =
        |prefix: &str| lines.iter().filter(|line| line.starts_with(prefix)).count();
    if exact_count("<chart>") != 1
        || exact_count("</chart>") != 1
        || exact_count("<expert>") != 1
        || exact_count("</expert>") != 1
        || exact_count(r"path=Experts\MarketLensExecutionEA.ex5") != 1
        || lines
            .iter()
            .filter(|line| {
                line.starts_with(r"path=Experts\") && line.to_ascii_lowercase().ends_with(".ex5")
            })
            .count()
            != 1
        || property_count("GatewayUrl=") != 1
        || exact_count(&format!("GatewayUrl={gateway_origin}")) != 1
        || property_count("PairingToken=") != 1
        || exact_count("PairingToken=") != 1
        || property_count("BootstrapPipe=") != 1
        || exact_count(&format!("BootstrapPipe={bootstrap_pipe}")) != 1
    {
        return Err(DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"));
    }
    Ok(())
}

fn valid_ea_loopback_origin(value: &str) -> bool {
    if !valid_ea_gateway_origin(value) {
        return false;
    }
    Url::parse(value).is_ok_and(|url| {
        url.scheme() == "http"
            && url.host_str().is_some_and(|host| {
                host.eq_ignore_ascii_case("localhost")
                    || host
                        .parse::<std::net::IpAddr>()
                        .is_ok_and(|address| address.is_loopback())
            })
    })
}

fn ensure_driver_condition(condition: bool, code: &'static str) -> Result<(), DriverError> {
    if condition {
        return Ok(());
    }
    Err(DriverError::new(code))
}

const EA_PIPE_ACL_FAILED: &str = "EA_BOOTSTRAP_PIPE_ACL_FAILED";
const EA_PIPE_CREATE_FAILED: &str = "EA_BOOTSTRAP_PIPE_CREATE_FAILED";
const EA_BOOTSTRAP_CLIENT_REJECTED: &str = "EA_BOOTSTRAP_CLIENT_REJECTED";
const EA_PIPE_WRITE_FAILED: &str = "EA_BOOTSTRAP_PIPE_WRITE_FAILED";
const EA_PIPE_FLUSH_FAILED: &str = "EA_BOOTSTRAP_PIPE_FLUSH_FAILED";

fn validate_managed_ea_topology(
    slot: &TerminalSlotConfig,
    terminal_state_root: &Path,
) -> Result<(), DriverError> {
    let (
        Some(ea_path),
        Some(ea_sha256),
        Some(bootstrap_pipe),
        Some(profile),
        Some(slot_id),
        Some(gateway_origin),
        Some(chart_path),
        Some(chart_sha256),
        Some(settings_path),
        Some(settings_sha256),
        Some(attestation_path),
        Some(attestation_sha256),
    ) = (
        &slot.ea_path,
        &slot.ea_sha256,
        &slot.ea_bootstrap_pipe,
        &slot.ea_profile,
        &slot.slot_id,
        &slot.ea_gateway_origin,
        &slot.ea_profile_chart_path,
        &slot.ea_profile_chart_sha256,
        &slot.ea_webrequest_settings_path,
        &slot.ea_webrequest_settings_sha256,
        &slot.ea_topology_attestation_path,
        &slot.ea_topology_attestation_sha256,
    )
    else {
        return Err(DriverError::new("INCOMPLETE_MANAGED_EA_SLOT"));
    };
    if !crate::is_safe_identifier(bootstrap_pipe)
        || !crate::is_safe_identifier(profile)
        || !crate::is_safe_identifier(slot_id)
        || !valid_ea_loopback_origin(gateway_origin)
    {
        return Err(DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"));
    }
    let expected_ea_path = terminal_state_root
        .join("MQL5")
        .join("Experts")
        .join("MarketLensExecutionEA.ex5");
    let expected_profile_directory = terminal_state_root
        .join("MQL5")
        .join("Profiles")
        .join("Charts")
        .join(profile);
    let expected_chart_path = expected_profile_directory.join("chart01.chr");
    let expected_settings_path = terminal_state_root.join("Config").join("experts.ini");
    let expected_attestation_path = terminal_state_root
        .join("Config")
        .join("marketlens-webrequest-attestation.json");
    for (observed, expected) in [
        (ea_path.as_path(), expected_ea_path.as_path()),
        (chart_path.as_path(), expected_chart_path.as_path()),
        (settings_path.as_path(), expected_settings_path.as_path()),
        (
            attestation_path.as_path(),
            expected_attestation_path.as_path(),
        ),
    ] {
        if !observed.is_absolute()
            || observed
                .components()
                .any(|component| matches!(component, Component::ParentDir))
            || fs::canonicalize(observed).ok() != fs::canonicalize(expected).ok()
        {
            return Err(DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"));
        }
        assert_no_reparse_below(terminal_state_root, observed)?;
    }
    let charts = fs::read_dir(&expected_profile_directory)
        .map_err(|_| DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"))?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.path().extension().is_some_and(|extension| {
                extension
                    .to_str()
                    .is_some_and(|value| value.eq_ignore_ascii_case("chr"))
            })
        })
        .collect::<Vec<_>>();
    if charts.len() != 1
        || fs::canonicalize(charts[0].path()).ok() != fs::canonicalize(chart_path).ok()
    {
        return Err(DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"));
    }
    verify_sha256(ea_path, ea_sha256)?;
    verify_sha256(chart_path, chart_sha256)?;
    verify_sha256(settings_path, settings_sha256)?;
    verify_sha256(attestation_path, attestation_sha256)?;
    validate_managed_ea_chart(chart_path, bootstrap_pipe, gateway_origin)?;
    let attestation: EaTopologyAttestation = serde_json::from_slice(
        &fs::read(attestation_path).map_err(|_| DriverError::new("ARTIFACT_READ_FAILED"))?,
    )
    .map_err(|_| DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"))?;
    if attestation.schema_version != 1
        || attestation.settings_file_name != "experts.ini"
        || !attestation
            .settings_sha256
            .eq_ignore_ascii_case(settings_sha256)
        || attestation.allowed_origins.len() != 1
        || attestation.allowed_origins[0] != *gateway_origin
        || !attestation.probe_succeeded
    {
        return Err(DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"));
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

fn prepare_ea_bootstrap(
    config: &ProcessDriverConfig,
    layout: &RuntimeLayout,
    ea_bootstrap: Option<EaBootstrapMaterial>,
) -> Result<(Option<EaBootstrapServer>, Option<EaBootstrapBindContext>), DriverError> {
    let Some(EaBootstrapMaterial {
        token,
        client,
        bind_endpoint,
        session_token,
        binding:
            EaBootstrapBinding {
                protocol_version,
                worker_id,
                session_generation,
                connection_revision,
            },
    }) = ea_bootstrap
    else {
        return Ok((None, None));
    };
    let pairing_token_sha256 = format!("{:x}", Sha256::digest(token.expose().as_bytes()));
    let server = start_ea_bootstrap_server(layout, token, config.io_timeout)?;
    Ok((
        Some(server),
        Some(EaBootstrapBindContext {
            client,
            bind_endpoint,
            session_token,
            protocol_version,
            worker_id,
            session_generation,
            connection_revision,
            pairing_token_sha256,
        }),
    ))
}

struct EaBootstrapRuntime<'a> {
    account_id: &'a str,
    lease_generation: u64,
    layout: &'a RuntimeLayout,
    terminal_pid: u32,
}

fn finish_ea(
    binding: Option<&EaBootstrapBindContext>,
    mut server: Option<EaBootstrapServer>,
    runtime: &EaBootstrapRuntime<'_>,
) -> Result<(), DriverError> {
    if let Some(binding) = binding {
        bind_ea_bootstrap_runtime(binding, runtime)?;
    }
    if let Some(server) = server.as_mut() {
        server.authorize(runtime.terminal_pid)?;
    }
    if let Some(server) = server {
        let bootstrap_client_pid = server.finish()?;
        if bootstrap_client_pid != runtime.terminal_pid {
            return Err(DriverError::new("EA_BOOTSTRAP_CLIENT_PID_MISMATCH"));
        }
    }
    Ok(())
}

fn bind_ea_bootstrap_runtime(
    context: &EaBootstrapBindContext,
    runtime: &EaBootstrapRuntime<'_>,
) -> Result<(), DriverError> {
    let slot_id = runtime
        .layout
        .slot_id
        .as_deref()
        .ok_or_else(|| DriverError::new("MANAGED_EA_SLOT_NOT_CONFIGURED"))?;
    let gateway_origin = runtime
        .layout
        .ea_gateway_origin
        .as_deref()
        .ok_or_else(|| DriverError::new("MANAGED_EA_SLOT_NOT_CONFIGURED"))?;
    if !crate::is_safe_identifier(runtime.account_id)
        || !crate::is_safe_identifier(&context.worker_id)
        || !crate::is_safe_identifier(slot_id)
        || !valid_ea_gateway_origin(gateway_origin)
        || runtime.lease_generation == 0
        || context.session_generation == 0
        || context.connection_revision == 0
        || runtime.terminal_pid == 0
        || context.pairing_token_sha256.len() != 64
        || !context
            .pairing_token_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(DriverError::new("EA_BOOTSTRAP_BINDING_INVALID"));
    }
    let request = WorkerEaBootstrapBindRequest {
        protocol_version: context.protocol_version,
        worker_id: context.worker_id.clone(),
        session_generation: context.session_generation,
        account_id: runtime.account_id.to_owned(),
        lease_generation: runtime.lease_generation,
        connection_revision: context.connection_revision,
        pairing_token_sha256: context.pairing_token_sha256.clone(),
        slot_id: slot_id.to_owned(),
        terminal_pid: runtime.terminal_pid,
        gateway_origin: gateway_origin.to_owned(),
    };
    let response = context
        .client
        .post(context.bind_endpoint.clone())
        .bearer_auth(context.session_token.expose())
        .json(&request)
        .send()
        .map_err(|_| DriverError::new("EA_BOOTSTRAP_BINDING_REQUEST_FAILED"))?;
    if matches!(
        response.status(),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::CONFLICT
    ) {
        return Err(DriverError::new("EA_BOOTSTRAP_BINDING_FENCED"));
    }
    if response.status() != StatusCode::OK {
        return Err(DriverError::new("EA_BOOTSTRAP_BINDING_REJECTED"));
    }
    let response: WorkerEaBootstrapBindResponse = response
        .json()
        .map_err(|_| DriverError::new("EA_BOOTSTRAP_BINDING_RESPONSE_INVALID"))?;
    if !response.bound || response.server_time_ms == 0 {
        return Err(DriverError::new("EA_BOOTSTRAP_BINDING_RESPONSE_INVALID"));
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EaBootstrapEnvelope<'a> {
    pairing_token: &'a str,
    slot_id: &'a str,
    terminal_pid: u32,
    gateway_origin: &'a str,
}

fn envelope(
    token: &str,
    slot_id: &str,
    terminal_pid: u32,
    gateway_origin: &str,
) -> Result<Zeroizing<Vec<u8>>, DriverError> {
    if token.len() != 64
        || !token.bytes().all(|byte| byte.is_ascii_hexdigit())
        || !crate::is_safe_identifier(slot_id)
        || terminal_pid == 0
        || !valid_ea_gateway_origin(gateway_origin)
    {
        return Err(DriverError::new("EA_BOOTSTRAP_ENVELOPE_INVALID"));
    }
    serde_json::to_vec(&EaBootstrapEnvelope {
        pairing_token: token,
        slot_id,
        terminal_pid,
        gateway_origin,
    })
    .map(Zeroizing::new)
    .map_err(|_| DriverError::new("EA_BOOTSTRAP_ENVELOPE_SERIALIZE_FAILED"))
}

struct EaBootstrapServer {
    expected_terminal_pid: mpsc::SyncSender<u32>,
    handle: Option<thread::JoinHandle<Result<u32, DriverError>>>,
}

impl EaBootstrapServer {
    fn authorize(&mut self, terminal_pid: u32) -> Result<(), DriverError> {
        if terminal_pid == 0 {
            return Err(DriverError::new("EA_BOOTSTRAP_TERMINAL_PID_INVALID"));
        }
        self.expected_terminal_pid
            .send(terminal_pid)
            .map_err(|_| DriverError::new("EA_BOOTSTRAP_SERVER_UNAVAILABLE"))
    }

    fn finish(mut self) -> Result<u32, DriverError> {
        self.handle
            .take()
            .ok_or_else(|| DriverError::new("EA_BOOTSTRAP_SERVER_UNAVAILABLE"))?
            .join()
            .map_err(|_| DriverError::new("EA_BOOTSTRAP_SERVER_PANICKED"))?
    }
}

impl Drop for EaBootstrapServer {
    fn drop(&mut self) {
        if let Some(handle) = self.handle.take() {
            let _ = self.expected_terminal_pid.try_send(0);
            let _ = handle.join();
        }
    }
}

fn start_ea_bootstrap_server(
    layout: &RuntimeLayout,
    token: SecretText,
    timeout: Duration,
) -> Result<EaBootstrapServer, DriverError> {
    let pipe_name = layout
        .ea_bootstrap_pipe
        .as_deref()
        .ok_or_else(|| DriverError::new("MANAGED_EA_SLOT_NOT_CONFIGURED"))?;
    let slot_id = layout
        .slot_id
        .as_deref()
        .ok_or_else(|| DriverError::new("MANAGED_EA_SLOT_NOT_CONFIGURED"))?;
    let gateway_origin = layout
        .ea_gateway_origin
        .as_deref()
        .ok_or_else(|| DriverError::new("MANAGED_EA_SLOT_NOT_CONFIGURED"))?;
    if !crate::is_safe_identifier(pipe_name)
        || !layout.terminal_path.is_absolute()
        || token.expose().len() != 64
        || !token.expose().bytes().all(|byte| byte.is_ascii_hexdigit())
        || !crate::is_safe_identifier(slot_id)
        || !valid_ea_gateway_origin(gateway_origin)
        || timeout.is_zero()
    {
        return Err(DriverError::new("EA_BOOTSTRAP_CONFIG_INVALID"));
    }
    let pipe_name = pipe_name.to_owned();
    let expected_terminal_path = layout.terminal_path.clone();
    let slot_id = slot_id.to_owned();
    let gateway_origin = gateway_origin.to_owned();
    let (expected_terminal_pid, expected_terminal_pid_receiver) = mpsc::sync_channel(1);
    let handle = thread::Builder::new()
        .name(format!("mt5-ea-bootstrap-{pipe_name}"))
        .spawn(move || {
            serve_ea_bootstrap_pipe(
                &pipe_name,
                &expected_terminal_path,
                token,
                &slot_id,
                &gateway_origin,
                timeout,
                expected_terminal_pid_receiver,
            )
        })
        .map_err(|_| DriverError::new("EA_BOOTSTRAP_THREAD_FAILED"))?;
    Ok(EaBootstrapServer {
        expected_terminal_pid,
        handle: Some(handle),
    })
}

#[cfg(windows)]
struct OwnedLocal(*mut std::ffi::c_void);

#[cfg(windows)]
impl Drop for OwnedLocal {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::LocalFree(self.0) };
        self.0 = std::ptr::null_mut();
    }
}

#[cfg(windows)]
struct OwnedKernelHandle(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl Drop for OwnedKernelHandle {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

#[cfg(windows)]
fn protected_pipe_security_attributes() -> Result<
    (
        windows_sys::Win32::Security::SECURITY_ATTRIBUTES,
        OwnedLocal,
    ),
    DriverError,
> {
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
        SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::{
        GetTokenInformation, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER, TokenUser,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut token_handle: HANDLE = std::ptr::null_mut();
    let opened = unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token_handle) };
    ensure_driver_condition(opened != 0, EA_PIPE_ACL_FAILED)?;
    let token = OwnedKernelHandle(token_handle);
    let mut required = 0_u32;
    unsafe { GetTokenInformation(token.0, TokenUser, std::ptr::null_mut(), 0, &mut required) };
    let token_information_sized = required >= std::mem::size_of::<TOKEN_USER>() as u32;
    ensure_driver_condition(token_information_sized, EA_PIPE_ACL_FAILED)?;
    let word_size = std::mem::size_of::<usize>();
    let mut token_buffer = vec![0_usize; (required as usize).div_ceil(word_size)];
    let loaded = unsafe {
        GetTokenInformation(
            token.0,
            TokenUser,
            token_buffer.as_mut_ptr().cast(),
            required,
            &mut required,
        )
    };
    ensure_driver_condition(loaded != 0, EA_PIPE_ACL_FAILED)?;
    let token_user = unsafe { &*(token_buffer.as_ptr().cast::<TOKEN_USER>()) };
    let mut sid_text = std::ptr::null_mut();
    let converted = unsafe { ConvertSidToStringSidW(token_user.User.Sid, &mut sid_text) };
    ensure_driver_condition(converted != 0 && !sid_text.is_null(), EA_PIPE_ACL_FAILED)?;
    let _owned_sid = OwnedLocal(sid_text.cast());
    let mut sid_length = 0_usize;
    while unsafe { *sid_text.add(sid_length) } != 0 {
        sid_length += 1;
        ensure_driver_condition(sid_length <= 184, EA_PIPE_ACL_FAILED)?;
    }
    let sid = String::from_utf16(unsafe { std::slice::from_raw_parts(sid_text, sid_length) });
    let sid = sid.map_err(|_| DriverError::new("EA_BOOTSTRAP_PIPE_ACL_FAILED"))?;
    let sddl = format!("D:P(A;;GA;;;SY)(A;;GA;;;{sid})");
    let wide_sddl: Vec<u16> = sddl.encode_utf16().chain(Some(0)).collect();
    let mut descriptor = std::ptr::null_mut();
    let converted = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            wide_sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            std::ptr::null_mut(),
        )
    };
    ensure_driver_condition(converted != 0 && !descriptor.is_null(), EA_PIPE_ACL_FAILED)?;
    let owned = OwnedLocal(descriptor);
    let attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor,
        bInheritHandle: 0,
    };
    Ok((attributes, owned))
}

fn bootstrap_client_is_authorized(
    client_pid: u32,
    expected_terminal_pid: u32,
    process_path_matches: bool,
) -> bool {
    client_pid != 0 && client_pid == expected_terminal_pid && process_path_matches
}

fn accept_terminal_pid_signal(
    signal: Result<u32, TryRecvError>,
    expected_terminal_pid: &mut Option<u32>,
) -> Result<(), DriverError> {
    match signal {
        Ok(0) => Err(DriverError::new("EA_BOOTSTRAP_SERVER_CANCELLED")),
        Ok(pid) => {
            *expected_terminal_pid = Some(pid);
            Ok(())
        }
        Err(TryRecvError::Empty) => Ok(()),
        Err(TryRecvError::Disconnected) => Err(DriverError::new("EA_BOOTSTRAP_SERVER_CANCELLED")),
    }
}

fn ensure_pipe_wait_status(waitable: bool, timed_out: bool) -> Result<(), DriverError> {
    ensure_driver_condition(waitable, "EA_BOOTSTRAP_PIPE_CONNECT_FAILED")?;
    ensure_driver_condition(!timed_out, "EA_BOOTSTRAP_PIPE_TIMEOUT")
}

fn expected_pid(
    expected_terminal_pid: Option<u32>,
    receiver: &Receiver<u32>,
    timeout: Duration,
) -> Result<u32, DriverError> {
    expected_terminal_pid.map_or_else(
        || {
            receiver
                .recv_timeout(timeout)
                .map_err(|_| DriverError::new("EA_BOOTSTRAP_TERMINAL_PID_TIMEOUT"))
        },
        Ok,
    )
}

#[cfg(windows)]
struct OwnedPipe(OwnedKernelHandle);

#[cfg(windows)]
impl Drop for OwnedPipe {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::System::Pipes::DisconnectNamedPipe(self.0.0) };
    }
}

#[cfg(windows)]
fn serve_ea_bootstrap_pipe(
    pipe_name: &str,
    expected_terminal_path: &Path,
    token: SecretText,
    slot_id: &str,
    gateway_origin: &str,
    timeout: Duration,
    expected_terminal_pid_receiver: Receiver<u32>,
) -> Result<u32, DriverError> {
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null_mut;

    use windows_sys::Win32::Foundation::{
        ERROR_NO_DATA, ERROR_PIPE_CONNECTED, ERROR_PIPE_LISTENING, GetLastError,
        INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        FlushFileBuffers, PIPE_ACCESS_OUTBOUND, WriteFile,
    };
    use windows_sys::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, GetNamedPipeClientProcessId, PIPE_NOWAIT,
        PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE,
    };

    let full_name = format!(r"\\.\pipe\{pipe_name}");
    let wide_name = std::ffi::OsStr::new(&full_name)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let (security_attributes, _security_descriptor) = protected_pipe_security_attributes()?;
    let raw_pipe = unsafe {
        CreateNamedPipeW(
            wide_name.as_ptr(),
            PIPE_ACCESS_OUTBOUND,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            128,
            0,
            timeout.as_millis().clamp(1, u32::MAX as u128) as u32,
            &security_attributes,
        )
    };
    ensure_driver_condition(raw_pipe != INVALID_HANDLE_VALUE, EA_PIPE_CREATE_FAILED)?;
    let pipe = OwnedPipe(OwnedKernelHandle(raw_pipe));

    let deadline = Instant::now() + timeout;
    let mut expected_terminal_pid = None;
    loop {
        let terminal_pid_signal = expected_terminal_pid_receiver.try_recv();
        accept_terminal_pid_signal(terminal_pid_signal, &mut expected_terminal_pid)?;
        let connected = unsafe { ConnectNamedPipe(pipe.0.0, null_mut()) } != 0;
        if connected || unsafe { GetLastError() } == ERROR_PIPE_CONNECTED {
            break;
        }
        let error = unsafe { GetLastError() };
        let waitable = matches!(error, ERROR_PIPE_LISTENING | ERROR_NO_DATA);
        let timed_out = Instant::now() >= deadline;
        ensure_pipe_wait_status(waitable, timed_out)?;
        thread::sleep(Duration::from_millis(25));
    }

    let remaining = deadline.saturating_duration_since(Instant::now());
    let pid_receiver = &expected_terminal_pid_receiver;
    let expected_terminal_pid = expected_pid(expected_terminal_pid, pid_receiver, remaining)?;

    let mut client_pid = 0_u32;
    let client_pid_available =
        unsafe { GetNamedPipeClientProcessId(pipe.0.0, &mut client_pid) } != 0;
    let client_path_matches =
        client_pid_available && process_id_matches_path(client_pid, expected_terminal_path);
    let client_authorized =
        bootstrap_client_is_authorized(client_pid, expected_terminal_pid, client_path_matches);
    ensure_driver_condition(client_authorized, EA_BOOTSTRAP_CLIENT_REJECTED)?;

    let token = token.expose();
    let pid = expected_terminal_pid;
    let mut payload = envelope(token, slot_id, pid, gateway_origin)?;
    payload.push(b'\n');
    let mut written = 0_u32;
    let wrote = unsafe {
        WriteFile(
            pipe.0.0,
            payload.as_ptr(),
            payload.len() as u32,
            &mut written,
            null_mut(),
        )
    } != 0;
    let complete_write = wrote && written as usize == payload.len();
    ensure_driver_condition(complete_write, EA_PIPE_WRITE_FAILED)?;
    let flushed = unsafe { FlushFileBuffers(pipe.0.0) } != 0;
    ensure_driver_condition(flushed, EA_PIPE_FLUSH_FAILED)?;
    Ok(client_pid)
}

#[cfg(not(windows))]
fn serve_ea_bootstrap_pipe(
    _pipe_name: &str,
    _expected_terminal_path: &Path,
    _token: SecretText,
    _slot_id: &str,
    _gateway_origin: &str,
    _timeout: Duration,
    _expected_terminal_pid_receiver: Receiver<u32>,
) -> Result<u32, DriverError> {
    Err(DriverError::new("EA_BOOTSTRAP_REQUIRES_WINDOWS"))
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
fn process_path(process_id: u32) -> Option<PathBuf> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
    };

    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if process.is_null() {
        return None;
    }
    let mut buffer = vec![0_u16; 32_768];
    let mut length = buffer.len() as u32;
    let queried =
        unsafe { QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length) } != 0;
    unsafe { CloseHandle(process) };
    queried.then(|| PathBuf::from(String::from_utf16_lossy(&buffer[..length as usize])))
}

#[cfg(windows)]
fn process_id_matches_path(process_id: u32, expected_path: &Path) -> bool {
    let Some(actual) = process_path(process_id) else {
        return false;
    };
    fs::canonicalize(actual).ok() == fs::canonicalize(expected_path).ok()
}

#[cfg(windows)]
fn find_process_id_by_path(expected_path: &Path) -> Option<u32> {
    use std::mem::{size_of, zeroed};

    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    let snapshot = valid_system_handle(snapshot, INVALID_HANDLE_VALUE)?;
    let mut entry: PROCESSENTRY32W = unsafe { zeroed() };
    entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
    let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while has_entry {
        if process_id_matches_path(entry.th32ProcessID, expected_path) {
            unsafe { CloseHandle(snapshot) };
            return Some(entry.th32ProcessID);
        }
        has_entry = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe { CloseHandle(snapshot) };
    None
}

fn valid_system_handle<T: Copy + PartialEq>(handle: T, invalid: T) -> Option<T> {
    (handle != invalid).then_some(handle)
}

#[cfg(not(windows))]
fn find_process_id_by_path(_expected_path: &Path) -> Option<u32> {
    None
}

#[cfg(not(windows))]
fn process_id_matches_path(_process_id: u32, _expected_path: &Path) -> bool {
    false
}

fn wait_or_kill(child: &mut Child, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if child.try_wait().ok().flatten().is_some() {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn kill_and_wait(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(windows)]
fn ensure_minimum_free_disk(path: &Path, minimum_bytes: u64) -> Result<(), DriverError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut available = 0_u64;
    let queried = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if queried == 0 {
        return Err(DriverError::new("RUNTIME_DISK_QUERY_FAILED"));
    }
    if available < minimum_bytes {
        return Err(DriverError::new("INSUFFICIENT_RUNTIME_DISK"));
    }
    Ok(())
}

#[cfg(not(windows))]
fn ensure_minimum_free_disk(_path: &Path, minimum_bytes: u64) -> Result<(), DriverError> {
    if minimum_bytes == 0 {
        return Err(DriverError::new("INSUFFICIENT_RUNTIME_DISK"));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn read_test_http_request(stream: &mut std::net::TcpStream) -> String {
        use std::io::Read as _;

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
        headers + &String::from_utf8(body).expect("test HTTP request body is UTF-8")
    }

    fn test_bind_response(authorized: bool) -> (&'static str, &'static str) {
        if authorized {
            (
                "200 OK",
                r#"{"bound":true,"idempotent":false,"serverTimeMs":1}"#,
            )
        } else {
            ("401 Unauthorized", r#"{"code":"WORKER_SESSION_REQUIRED"}"#)
        }
    }

    fn test_ea_runtime<'a>(
        layout: &'a RuntimeLayout,
        account_id: &'a str,
        lease_generation: u64,
        terminal_pid: u32,
    ) -> EaBootstrapRuntime<'a> {
        EaBootstrapRuntime {
            account_id,
            lease_generation,
            layout,
            terminal_pid,
        }
    }

    #[test]
    fn restart_requires_a_fresh_one_time_credential_before_runtime_mutation() {
        assert_eq!(
            authorize_restart_without_credential::<()>(),
            Err(DriverError::new("CREDENTIAL_REISSUE_REQUIRED"))
        );
    }

    #[test]
    fn managed_runtime_never_retains_broker_credentials_after_handoff() {
        let source = include_str!("process.rs");
        let start = source
            .find("struct ManagedRuntime {")
            .expect("managed runtime definition exists");
        let end = source[start..]
            .find("struct ProcessPair {")
            .map(|offset| start + offset)
            .expect("managed runtime definition has a boundary");
        let runtime_definition = &source[start..end];

        assert!(!runtime_definition.contains("credential"));
    }

    #[test]
    fn ea_bootstrap_authorizes_the_exact_terminal_pid_before_writing() {
        let source = include_str!("process.rs");
        let test_module = source.find("mod tests {").expect("test module exists");
        let implementation = &source[..test_module];
        let pid_check = implementation
            .find("bootstrap_client_is_authorized(client_pid, expected_terminal_pid, client_path_matches)")
            .expect("bootstrap pipe must authorize the exact terminal PID and path");
        let pid_enforcement = implementation
            .find("ensure_driver_condition(client_authorized, EA_BOOTSTRAP_CLIENT_REJECTED)")
            .expect("bootstrap pipe must enforce terminal PID authorization");
        let token_write = implementation
            .find("WriteFile(")
            .expect("bootstrap pipe must write the one-time token");
        assert!(
            pid_check < pid_enforcement && pid_enforcement < token_write,
            "PID authorization must precede token delivery"
        );
    }

    #[test]
    fn ea_bootstrap_client_requires_the_exact_nonzero_pid_and_path() {
        assert!(bootstrap_client_is_authorized(42, 42, true));
        assert!(!bootstrap_client_is_authorized(41, 42, true));
        assert!(!bootstrap_client_is_authorized(42, 42, false));
        assert!(!bootstrap_client_is_authorized(0, 0, true));
    }

    #[test]
    fn bootstrap_and_cleanup_decision_helpers_fail_closed() {
        assert!(ensure_driver_condition(true, "SYNTHETIC").is_ok());
        assert_eq!(
            ensure_driver_condition(false, "SYNTHETIC").unwrap_err(),
            DriverError::new("SYNTHETIC")
        );
        assert!(ensure_runtime_cleanup_complete(false, false).is_ok());
        assert_eq!(
            ensure_runtime_cleanup_complete(true, false).unwrap_err(),
            DriverError::new("RUNTIME_CLEANUP_POSTCONDITION_FAILED")
        );
        assert_eq!(valid_system_handle(7_u32, 0), Some(7));
        assert_eq!(valid_system_handle(0_u32, 0), None);

        let mut expected = None;
        accept_terminal_pid_signal(Ok(42), &mut expected).unwrap();
        assert_eq!(expected, Some(42));
        assert!(accept_terminal_pid_signal(Err(TryRecvError::Empty), &mut expected).is_ok());
        assert_eq!(
            accept_terminal_pid_signal(Ok(0), &mut expected).unwrap_err(),
            DriverError::new("EA_BOOTSTRAP_SERVER_CANCELLED")
        );
        assert_eq!(
            accept_terminal_pid_signal(Err(TryRecvError::Disconnected), &mut expected).unwrap_err(),
            DriverError::new("EA_BOOTSTRAP_SERVER_CANCELLED")
        );
        assert!(ensure_pipe_wait_status(true, false).is_ok());
        assert_eq!(
            ensure_pipe_wait_status(false, false).unwrap_err(),
            DriverError::new("EA_BOOTSTRAP_PIPE_CONNECT_FAILED")
        );
        assert_eq!(
            ensure_pipe_wait_status(true, true).unwrap_err(),
            DriverError::new("EA_BOOTSTRAP_PIPE_TIMEOUT")
        );

        let (sender, receiver) = mpsc::sync_channel(1);
        sender.send(77).unwrap();
        assert_eq!(
            expected_pid(None, &receiver, Duration::from_secs(1)).unwrap(),
            77
        );
        assert_eq!(
            expected_pid(Some(88), &receiver, Duration::ZERO).unwrap(),
            88
        );
        drop(sender);
        assert_eq!(
            expected_pid(None, &receiver, Duration::ZERO).unwrap_err(),
            DriverError::new("EA_BOOTSTRAP_TERMINAL_PID_TIMEOUT")
        );
        assert_eq!(test_bind_response(false).0, "401 Unauthorized");
    }

    #[cfg(windows)]
    #[test]
    fn cleanup_wait_kill_and_bootstrap_pid_mismatch_are_enforced() {
        let current = std::env::current_exe().expect("current test executable");
        assert_eq!(
            wait_for_terminal_exit(&current, Duration::from_millis(500)).unwrap_err(),
            DriverError::new("TERMINAL_CLEANUP_POSTCONDITION_FAILED")
        );

        let mut child = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 5",
            ])
            .spawn()
            .expect("spawn a disposable long-lived child");
        wait_or_kill(&mut child, Duration::ZERO);
        assert!(child.try_wait().expect("query disposable child").is_some());

        let (sender, receiver) = mpsc::sync_channel(1);
        let server = EaBootstrapServer {
            expected_terminal_pid: sender,
            handle: Some(thread::spawn(move || {
                assert_eq!(42, receiver.recv().expect("receive authorized PID"));
                Ok(41)
            })),
        };
        let layout = RuntimeLayout {
            runtime_directory: PathBuf::new(),
            terminal_path: current,
            mcp_port: 0,
            ea_bootstrap_pipe: None,
            ea_profile: None,
            slot_id: None,
            ea_gateway_origin: None,
        };
        let runtime = EaBootstrapRuntime {
            account_id: "account-01",
            lease_generation: 1,
            layout: &layout,
            terminal_pid: 42,
        };
        assert_eq!(
            finish_ea(None, Some(server), &runtime).unwrap_err(),
            DriverError::new("EA_BOOTSTRAP_CLIENT_PID_MISMATCH")
        );
    }

    #[test]
    fn ea_bootstrap_pipe_serializes_the_bound_slot_pid_and_gateway_origin() {
        let payload = envelope(
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "slot-01",
            4242,
            "https://execution.example.test",
        )
        .expect("valid bootstrap envelope");
        let decoded: Value = serde_json::from_slice(&payload).expect("bootstrap JSON");

        assert_eq!(decoded["pairingToken"], "a".repeat(64));
        assert_eq!(decoded["slotId"], "slot-01");
        assert_eq!(decoded["terminalPid"], 4242);
        assert_eq!(decoded["gatewayOrigin"], "https://execution.example.test");
    }

    #[test]
    fn worker_binds_the_runtime_with_its_session_before_pipe_authorization() {
        use std::net::TcpListener;
        use std::sync::mpsc;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
        let endpoint = Url::parse(&format!(
            "http://{}/v1/mt5-vm/workers/ea-bootstrap/bind",
            listener.local_addr().expect("listener address")
        ))
        .expect("test bind endpoint");
        let (captured_sender, captured_receiver) = mpsc::channel();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept binding request");
            let request = read_test_http_request(&mut stream);
            let authorized = request.contains(&format!("Authorization: Bearer {}", "b".repeat(64)))
                || request.contains(&format!("authorization: Bearer {}", "b".repeat(64)));
            captured_sender
                .send(request)
                .expect("capture binding request");
            let (status, body) = test_bind_response(authorized);
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .expect("write binding response");
        });
        let context = EaBootstrapBindContext {
            client: reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(5))
                .build()
                .expect("test HTTP client"),
            bind_endpoint: endpoint,
            session_token: SecretText::new("b".repeat(64)).expect("session token"),
            protocol_version: 1,
            worker_id: "worker-01".into(),
            session_generation: 7,
            connection_revision: 11,
            pairing_token_sha256:
                "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb".into(),
        };
        let layout = RuntimeLayout {
            runtime_directory: PathBuf::from(r"C:\MarketLens\runtime"),
            terminal_path: PathBuf::from(r"C:\MetaTrader\terminal64.exe"),
            mcp_port: 24_000,
            ea_bootstrap_pipe: Some("marketlens-slot-01".into()),
            ea_profile: Some("marketlens-profile-01".into()),
            slot_id: Some("slot-01".into()),
            ea_gateway_origin: Some("http://127.0.0.1:8790".into()),
        };

        let runtime = test_ea_runtime(&layout, "account-01", 3, 4242);
        bind_ea_bootstrap_runtime(&context, &runtime).expect("authenticated runtime bind succeeds");
        let request = captured_receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("binding request captured");
        server.join().expect("binding server joins");
        assert!(request.contains("\"slotId\":\"slot-01\""));
        assert!(request.contains("\"terminalPid\":4242"));
        assert!(request.contains("\"gatewayOrigin\":\"http://127.0.0.1:8790\""));
        assert!(request.contains("\"connectionRevision\":11"));
        assert!(!request.contains(&"a".repeat(64)));

        let source = include_str!("process.rs");
        let start = source
            .find("fn finish_ea(")
            .expect("EA bootstrap finalizer exists");
        let end = source[start..]
            .find("fn bind_ea_bootstrap_runtime(")
            .map(|offset| start + offset)
            .expect("EA bootstrap finalizer boundary exists");
        let finalizer = &source[start..end];
        assert!(
            finalizer.find("bind_ea_bootstrap_runtime(")
                < finalizer.find("server.authorize(runtime.terminal_pid)")
        );
    }

    #[test]
    fn ea_bootstrap_binding_and_server_error_paths_fail_closed() {
        use std::net::TcpListener;

        let layout = RuntimeLayout {
            runtime_directory: std::env::temp_dir(),
            terminal_path: std::env::current_exe().expect("current test executable"),
            mcp_port: 24_000,
            ea_bootstrap_pipe: Some("marketlens-slot-01".into()),
            ea_profile: Some("MarketLens-slot-01".into()),
            slot_id: Some("slot-01".into()),
            ea_gateway_origin: Some("http://127.0.0.1:8790".into()),
        };
        let context = |endpoint: Url| EaBootstrapBindContext {
            client: reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(2))
                .build()
                .expect("test HTTP client"),
            bind_endpoint: endpoint,
            session_token: SecretText::new("b".repeat(64)).expect("session token"),
            protocol_version: 1,
            worker_id: "worker-01".into(),
            session_generation: 7,
            connection_revision: 9,
            pairing_token_sha256: "a".repeat(64),
        };

        let invalid = context(Url::parse("http://127.0.0.1:9/").unwrap());
        assert_eq!(
            DriverError::new("EA_BOOTSTRAP_BINDING_INVALID"),
            bind_ea_bootstrap_runtime(&invalid, &test_ea_runtime(&layout, "bad/account", 3, 42))
                .unwrap_err()
        );

        for (status, body, expected) in [
            (
                "401 Unauthorized",
                r#"{"code":"WORKER_SESSION_REQUIRED"}"#,
                "EA_BOOTSTRAP_BINDING_FENCED",
            ),
            (
                "500 Internal Server Error",
                r#"{"code":"INTERNAL"}"#,
                "EA_BOOTSTRAP_BINDING_REJECTED",
            ),
            (
                "200 OK",
                "not-json",
                "EA_BOOTSTRAP_BINDING_RESPONSE_INVALID",
            ),
            (
                "200 OK",
                r#"{"bound":false,"idempotent":false,"serverTimeMs":1}"#,
                "EA_BOOTSTRAP_BINDING_RESPONSE_INVALID",
            ),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind response listener");
            let endpoint = Url::parse(&format!(
                "http://{}/v1/mt5-vm/workers/ea-bootstrap/bind",
                listener.local_addr().expect("response listener address")
            ))
            .expect("response endpoint");
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().expect("accept binding request");
                let _request = read_test_http_request(&mut stream);
                write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .expect("write binding response");
            });
            assert_eq!(
                DriverError::new(expected),
                bind_ea_bootstrap_runtime(
                    &context(endpoint),
                    &test_ea_runtime(&layout, "account-01", 3, 42),
                )
                .unwrap_err()
            );
            server.join().expect("response server joins");
        }

        let listener = TcpListener::bind("127.0.0.1:0").expect("reserve refused port");
        let refused_endpoint = Url::parse(&format!(
            "http://{}/v1/mt5-vm/workers/ea-bootstrap/bind",
            listener.local_addr().expect("refused port address")
        ))
        .unwrap();
        drop(listener);
        assert_eq!(
            DriverError::new("EA_BOOTSTRAP_BINDING_REQUEST_FAILED"),
            bind_ea_bootstrap_runtime(
                &context(refused_endpoint),
                &test_ea_runtime(&layout, "account-01", 3, 42),
            )
            .unwrap_err()
        );

        assert_eq!(
            DriverError::new("EA_BOOTSTRAP_ENVELOPE_INVALID"),
            envelope("short", "slot-01", 42, "http://127.0.0.1:8790").unwrap_err()
        );
        let mut invalid_server_layout = layout.clone();
        invalid_server_layout.ea_bootstrap_pipe = Some("bad/pipe".into());
        assert_eq!(
            DriverError::new("EA_BOOTSTRAP_CONFIG_INVALID"),
            start_ea_bootstrap_server(
                &invalid_server_layout,
                SecretText::new("a".repeat(64)).unwrap(),
                Duration::from_secs(1),
            )
            .err()
            .expect("invalid bootstrap server config")
        );

        let (sender, receiver) = mpsc::sync_channel(1);
        let mut cancellable = EaBootstrapServer {
            expected_terminal_pid: sender,
            handle: Some(thread::spawn(move || {
                assert_eq!(0, receiver.recv().expect("drop cancellation"));
                Ok(0)
            })),
        };
        assert_eq!(
            DriverError::new("EA_BOOTSTRAP_TERMINAL_PID_INVALID"),
            cancellable.authorize(0).unwrap_err()
        );
        drop(cancellable);

        let (sender, _receiver) = mpsc::sync_channel(1);
        let unavailable = EaBootstrapServer {
            expected_terminal_pid: sender,
            handle: None,
        };
        assert_eq!(
            DriverError::new("EA_BOOTSTRAP_SERVER_UNAVAILABLE"),
            unavailable.finish().unwrap_err()
        );
        let (sender, _receiver) = mpsc::sync_channel(1);
        let panicked = EaBootstrapServer {
            expected_terminal_pid: sender,
            handle: Some(thread::spawn(|| panic!("synthetic bootstrap panic"))),
        };
        assert_eq!(
            DriverError::new("EA_BOOTSTRAP_SERVER_PANICKED"),
            panicked.finish().unwrap_err()
        );
    }

    #[test]
    fn live_validation_applies_default_limits_before_rejecting_invalid_process_config() {
        let current = std::env::current_exe().expect("current test executable");
        let request = LiveValidationRequest {
            schema_version: 1,
            agent_path: current.clone(),
            worker_id: "worker-01".into(),
            account_id: "account-01".into(),
            lease_generation: 1,
            data_root: std::env::temp_dir().join("marketlens-live-validation-unstarted"),
            terminal_slots: Vec::new(),
            python_path: current.clone(),
            adapter_path: current.clone(),
            acl_helper_path: current.clone(),
            powershell_path: current,
            python_sha256: "a".repeat(64),
            adapter_sha256: "b".repeat(64),
            login: "12345678".into(),
            password: "synthetic-password".into(),
            server: "Synthetic-Demo".into(),
            symbol: "EURUSD".into(),
            independent_web_match_confirmed: false,
        };
        assert_eq!(
            Err("INVALID_TERMINAL_SLOTS"),
            run_live_installed_slot_lifecycle(request)
        );
    }

    #[test]
    fn ea_bootstrap_pipe_uses_an_explicit_protected_dacl() {
        let source = include_str!("process.rs");
        let test_module = source.find("#[cfg(test)]").expect("test module exists");
        let implementation = &source[..test_module];
        let descriptor = implementation
            .find("ConvertStringSecurityDescriptorToSecurityDescriptorW")
            .expect("bootstrap pipe must construct an explicit security descriptor");
        let pipe_create = implementation
            .find("CreateNamedPipeW(")
            .expect("bootstrap pipe must be created");

        assert!(descriptor < pipe_create);
        assert!(implementation.contains("SECURITY_ATTRIBUTES"));
        assert!(implementation.contains("D:P(A;;GA;;;SY)(A;;GA;;;"));
    }

    #[test]
    fn bare_metal_runtime_declares_cpu_and_minimum_disk_limits() {
        let source = include_str!("process.rs");
        let test_module = source.find("#[cfg(test)]").expect("test module exists");
        let implementation = &source[..test_module];

        assert!(implementation.contains("cpu_budget_percent"));
        assert!(implementation.contains("minimum_free_disk_bytes"));
        assert!(implementation.contains("INSUFFICIENT_RUNTIME_DISK"));
    }

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
            cpu_budget_percent: Some(DEFAULT_CPU_BUDGET_PERCENT),
            minimum_free_disk_bytes: Some(DEFAULT_MINIMUM_FREE_DISK_BYTES),
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
            cpu_budget_percent: DEFAULT_CPU_BUDGET_PERCENT,
            minimum_free_disk_bytes: DEFAULT_MINIMUM_FREE_DISK_BYTES,
            io_timeout: Duration::from_secs(12),
            graceful_stop_timeout: Duration::from_secs(5),
            restart_spacing: Duration::from_millis(1),
            slot_index: 0,
        };
        assert_eq!(
            DriverError::new("INVALID_PROCESS_CONFIG"),
            config.validate().unwrap_err()
        );
    }

    pub(crate) struct AppDataGuard(Option<std::ffi::OsString>);

    impl Drop for AppDataGuard {
        fn drop(&mut self) {
            if let Some(value) = self.0.take() {
                unsafe { env::set_var("APPDATA", value) };
            } else {
                unsafe { env::remove_var("APPDATA") };
            }
        }
    }

    #[test]
    fn appdata_guard_restores_an_absent_environment_variable() {
        let prior = env::var_os("APPDATA");
        unsafe { env::remove_var("APPDATA") };
        drop(AppDataGuard(None));
        assert!(env::var_os("APPDATA").is_none());
        if let Some(value) = prior {
            unsafe { env::set_var("APPDATA", value) };
        }
    }

    fn fixture_sha256(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn valid_process_config_fixture() -> (ProcessDriverConfig, AppDataGuard, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "marketlens-valid-process-config-{}-{}",
            std::process::id(),
            unix_time_ms()
        ));
        let app_data = root.join("appdata");
        let install = root.join("terminal-slot-01");
        let terminal_path = install.join("terminal64.exe");
        let license_path = install.join("Config").join("terminal.lic");
        let python_path = root.join("python.exe");
        let adapter_path = root.join("phase1_adapter.py");
        let acl_helper_path = root.join("acl.ps1");
        let powershell_path = root.join("powershell.exe");
        fs::create_dir_all(license_path.parent().expect("license parent"))
            .expect("create terminal fixture");
        fs::create_dir_all(&app_data).expect("create fixture APPDATA");
        let terminal_bytes = b"signed-terminal-fixture";
        let license_bytes = b"terminal-license-fixture";
        let servers_bytes = b"server-catalog-fixture";
        let python_bytes = b"python-fixture";
        let adapter_bytes = b"adapter-fixture";
        fs::write(&terminal_path, terminal_bytes).expect("write terminal fixture");
        fs::write(&license_path, license_bytes).expect("write license fixture");
        fs::write(&python_path, python_bytes).expect("write Python fixture");
        fs::write(&adapter_path, adapter_bytes).expect("write adapter fixture");
        fs::write(&acl_helper_path, b"acl-helper-fixture").expect("write ACL fixture");
        fs::write(&powershell_path, b"powershell-fixture").expect("write PowerShell fixture");

        let guard = AppDataGuard(env::var_os("APPDATA"));
        unsafe { env::set_var("APPDATA", &app_data) };
        let instance = terminal_instance_id(&install).expect("derive terminal instance id");
        let state_config = app_data
            .join("MetaQuotes")
            .join("Terminal")
            .join(instance)
            .join("Config");
        fs::create_dir_all(&state_config).expect("create terminal state fixture");
        fs::write(state_config.join("servers.dat"), servers_bytes)
            .expect("write server catalog fixture");

        let config = ProcessDriverConfig {
            worker_id: "worker-01".to_owned(),
            data_root: root.join("runtime"),
            terminal_slots: vec![TerminalSlotConfig {
                terminal_path,
                terminal_sha256: fixture_sha256(terminal_bytes),
                servers_sha256: fixture_sha256(servers_bytes),
                terminal_license_sha256: fixture_sha256(license_bytes),
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
            python_path,
            adapter_path,
            acl_helper_path,
            powershell_path,
            artifact_pins: ArtifactPins {
                python_sha256: fixture_sha256(python_bytes),
                adapter_sha256: fixture_sha256(adapter_bytes),
            },
            adapter_event_capacity: DEFAULT_ADAPTER_EVENT_CAPACITY,
            job_active_process_limit: DEFAULT_JOB_ACTIVE_PROCESS_LIMIT,
            job_process_memory_limit: DEFAULT_JOB_PROCESS_MEMORY_LIMIT,
            cpu_budget_percent: DEFAULT_CPU_BUDGET_PERCENT,
            minimum_free_disk_bytes: 1,
            io_timeout: Duration::from_secs(1),
            graceful_stop_timeout: Duration::from_secs(1),
            restart_spacing: Duration::ZERO,
            slot_index: 0,
        };
        (config, guard, root)
    }

    pub(crate) fn valid_process_config_input_fixture()
    -> (ProcessDriverConfigInput, AppDataGuard, PathBuf) {
        let (config, guard, root) = valid_process_config_fixture();
        let input = ProcessDriverConfigInput {
            worker_id: config.worker_id,
            data_root: config.data_root,
            terminal_slots: config.terminal_slots,
            python_path: config.python_path,
            adapter_path: config.adapter_path,
            acl_helper_path: config.acl_helper_path,
            powershell_path: config.powershell_path,
            artifact_pins: config.artifact_pins,
            adapter_event_capacity: Some(config.adapter_event_capacity),
            job_active_process_limit: Some(config.job_active_process_limit),
            job_process_memory_limit: Some(config.job_process_memory_limit),
            cpu_budget_percent: Some(config.cpu_budget_percent),
            minimum_free_disk_bytes: Some(config.minimum_free_disk_bytes),
            io_timeout_ms: Some(config.io_timeout.as_millis() as u64),
            graceful_stop_timeout_ms: Some(config.graceful_stop_timeout.as_millis() as u64),
            restart_spacing_ms: Some(config.restart_spacing.as_millis() as u64),
        };
        (input, guard, root)
    }

    fn configure_complete_managed_ea_slot(config: &mut ProcessDriverConfig) {
        let (state_root, _state_config) =
            terminal_instance_config_directory(&config.terminal_slots[0].terminal_path)
                .expect("resolve managed terminal state root");
        let ea_path = state_root
            .join("MQL5")
            .join("Experts")
            .join("MarketLensExecutionEA.ex5");
        let chart_path = state_root
            .join("MQL5")
            .join("Profiles")
            .join("Charts")
            .join("MarketLens-slot-01")
            .join("chart01.chr");
        let settings_path = state_root.join("Config").join("experts.ini");
        let attestation_path = state_root
            .join("Config")
            .join("marketlens-webrequest-attestation.json");
        fs::create_dir_all(ea_path.parent().expect("managed EA parent"))
            .expect("create managed EA parent");
        fs::create_dir_all(chart_path.parent().expect("managed chart parent"))
            .expect("create managed chart parent");
        fs::create_dir_all(settings_path.parent().expect("managed settings parent"))
            .expect("create managed settings parent");
        let ea_bytes = b"compiled-managed-ea-fixture";
        let chart_bytes = br#"<chart>
<expert>
path=Experts\MarketLensExecutionEA.ex5
<inputs>
GatewayUrl=http://127.0.0.1:8790
PairingToken=
BootstrapPipe=marketlens-slot-01
</inputs>
</expert>
</chart>
"#;
        let settings_bytes = b"managed-experts-settings-fixture";
        fs::write(&ea_path, ea_bytes).expect("write managed EA fixture");
        fs::write(&chart_path, chart_bytes).expect("write managed chart fixture");
        fs::write(&settings_path, settings_bytes).expect("write managed settings fixture");
        let settings_sha256 = fixture_sha256(settings_bytes);
        let attestation_bytes = serde_json::to_vec(&json!({
            "schemaVersion": 1,
            "settingsFileName": "experts.ini",
            "settingsSha256": settings_sha256,
            "allowedOrigins": ["http://127.0.0.1:8790"],
            "probeSucceeded": true,
        }))
        .expect("serialize managed topology attestation");
        fs::write(&attestation_path, &attestation_bytes)
            .expect("write managed topology attestation");
        let slot = &mut config.terminal_slots[0];
        slot.ea_path = Some(ea_path);
        slot.ea_sha256 = Some(fixture_sha256(ea_bytes));
        slot.ea_bootstrap_pipe = Some("marketlens-slot-01".into());
        slot.ea_profile = Some("MarketLens-slot-01".into());
        slot.slot_id = Some("slot-01".into());
        slot.ea_gateway_origin = Some("http://127.0.0.1:8790".into());
        slot.ea_profile_chart_path = Some(chart_path);
        slot.ea_profile_chart_sha256 = Some(fixture_sha256(chart_bytes));
        slot.ea_webrequest_settings_path = Some(settings_path);
        slot.ea_webrequest_settings_sha256 = Some(settings_sha256);
        slot.ea_topology_attestation_path = Some(attestation_path);
        slot.ea_topology_attestation_sha256 = Some(fixture_sha256(&attestation_bytes));
        validate_managed_ea_topology(slot, &state_root)
            .expect("the complete managed fixture topology is valid");
    }

    fn executable_on_path(name: &str) -> PathBuf {
        let output = Command::new("where.exe")
            .arg(name)
            .output()
            .expect("resolve executable from PATH");
        assert!(output.status.success(), "{name} must be available");
        String::from_utf8(output.stdout)
            .expect("where output is UTF-8")
            .lines()
            .map(PathBuf::from)
            .find(|path| path.is_file())
            .expect("PATH contains executable file")
    }

    fn live_local_process_config_fixture() -> (ProcessDriverConfig, AppDataGuard, PathBuf) {
        let (mut config, guard, root) = valid_process_config_fixture();
        let python_path = executable_on_path("python.exe");
        let powershell_path = executable_on_path("powershell.exe");
        let cmd_path = executable_on_path("cmd.exe");
        let terminal_path = config.terminal_slots[0].terminal_path.clone();
        fs::copy(&cmd_path, &terminal_path).expect("copy signed local terminal fixture");
        let acl_helper_path = root.join("allow-runtime.ps1");
        fs::write(
            &acl_helper_path,
            r#"param([string]$DataRoot, [string]$RuntimePath)
$null = New-Item -ItemType Directory -Path $RuntimePath -Force
[Console]::Out.Write('{"ok":true,"reparse_free":true,"inheritance_disabled":true}')
"#,
        )
        .expect("write local ACL helper");
        let adapter_path = root.join("fake-process-adapter.py");
        fs::write(
            &adapter_path,
            r#"import hashlib, hmac, json, struct, subprocess, sys, time, uuid

cfg = json.loads(sys.stdin.readline())
terminal = subprocess.Popen([cfg["terminal_path"], "/d", "/s", "/c", "ping -t 127.0.0.1 >nul"])
sequence = 0

def signing_bytes(frame):
    output = bytearray()
    for field in ["protocol_version", "worker_id", "account_id", "lease_generation", "message_id", "sent_at_ms", "expires_at_ms", "sequence", "kind", "payload_json"]:
        encoded = str(frame[field]).encode("utf-8")
        output.extend(struct.pack(">I", len(encoded)))
        output.extend(encoded)
    return bytes(output)

def emit(kind, payload):
    global sequence
    sequence += 1
    now = int(time.time() * 1000)
    frame = {"protocol_version": 1, "worker_id": cfg["worker_id"], "account_id": cfg["account_id"], "lease_generation": cfg["lease_generation"], "message_id": str(uuid.uuid4()), "sent_at_ms": now, "expires_at_ms": now + 30000, "sequence": sequence, "kind": kind, "payload_json": json.dumps(payload, separators=(",", ":"), sort_keys=True), "mac_hex": ""}
    frame["mac_hex"] = hmac.new(bytes.fromhex(cfg["ipc_key_hex"]), signing_bytes(frame), hashlib.sha256).hexdigest()
    print(json.dumps(frame, separators=(",", ":")), flush=True)

emit("account_snapshot", {"mode": "demo", "login_matches": True, "server_matches": True, "connected": True, "trade_allowed": True, "trade_expert": True, "margin_mode": 0, "currency": "USD", "leverage": 100, "positions_count": 0, "pending_orders_count": 0, "history_orders_count_7d": 0, "history_deals_count_7d": 0, "symbol_specification": {"symbol": cfg["symbol"]}, "last_error_code": None})
for line in sys.stdin:
    command = json.loads(line)
    if command["kind"] == "agent_heartbeat":
        emit("agent_heartbeat", {"healthy": True, "login_matches": True, "server_matches": True, "last_error_code": None})
    elif command["kind"] == "snapshot_sync":
        emit("snapshot_sync", {"families": 4})
    elif command["kind"] == "history_sync":
        emit("history_sync", {"complete": True})
    elif command["kind"] == "stop_account":
        terminal.terminate()
        terminal.wait(timeout=5)
        emit("account_runtime_status", {"status": "stopped"})
        break
"#,
        )
        .expect("write fake local adapter");

        config.python_path = python_path.clone();
        config.powershell_path = powershell_path;
        config.acl_helper_path = acl_helper_path;
        config.adapter_path = adapter_path.clone();
        config.terminal_slots[0].terminal_sha256 =
            fixture_sha256(&fs::read(&terminal_path).expect("read terminal fixture"));
        config.artifact_pins.python_sha256 =
            fixture_sha256(&fs::read(&python_path).expect("read Python executable"));
        config.artifact_pins.adapter_sha256 =
            fixture_sha256(&fs::read(&adapter_path).expect("read fake adapter"));
        config.io_timeout = Duration::from_secs(10);
        config.graceful_stop_timeout = Duration::from_secs(5);
        (config, guard, root)
    }

    #[test]
    fn local_process_driver_runs_signed_start_heartbeat_sync_and_stop_lifecycle() {
        let (config, guard, root) = live_local_process_config_fixture();
        let mut driver = ProcessRuntimeDriver::new(config).expect("valid local process config");
        let credential = CredentialMaterial::new(
            "123456".into(),
            "synthetic-password".into(),
            "Synthetic-Demo".into(),
        )
        .expect("synthetic credential");
        crate::managed::ManagedRuntimeDriver::provision(
            &mut driver,
            "account-local",
            7,
            credential,
            "EURUSD",
            None,
        )
        .expect("start local signed lifecycle");
        assert_eq!(
            driver
                .start(
                    "account-local",
                    7,
                    CredentialMaterial::new("1".into(), "p".into(), "s".into()).unwrap(),
                    "EURUSD",
                )
                .unwrap_err(),
            DriverError::new("RUNTIME_ALREADY_EXISTS")
        );
        crate::managed::ManagedRuntimeDriver::heartbeat(&mut driver, "account-local", 7)
            .expect("healthy local runtime");
        assert_eq!(
            driver
                .snapshot_sync("account-local", 7, &["EURUSD".into()])
                .unwrap()["families"],
            4
        );
        assert_eq!(
            driver
                .history_sync("account-local", 7, 1_000, 2_000)
                .unwrap()["complete"],
            true
        );
        assert_eq!(
            driver.clean_restart("account-local", 7).unwrap_err(),
            DriverError::new("CREDENTIAL_REISSUE_REQUIRED")
        );
        crate::managed::ManagedRuntimeDriver::stop(&mut driver, "account-local", 7)
            .expect("stop local lifecycle");
        assert_eq!(
            driver.heartbeat("account-local", 7).unwrap_err(),
            DriverError::new("RUNTIME_NOT_FOUND")
        );
        drop(driver);
        drop(guard);
        fs::remove_dir_all(root).expect("remove local process fixture");
    }
    #[test]
    fn process_start_failure_cleans_the_reserved_runtime_assignment() {
        let (config, guard, root) = live_local_process_config_fixture();
        let adapter_path = config.adapter_path.clone();
        let data_root = config.data_root.clone();
        let mut driver = ProcessRuntimeDriver::new(config).expect("valid local process config");
        fs::remove_file(adapter_path).expect("remove fake adapter after config attestation");

        let error = driver
            .start(
                "account-start-failure",
                9,
                CredentialMaterial::new(
                    "123456".into(),
                    "synthetic-password".into(),
                    "Synthetic-Demo".into(),
                )
                .expect("synthetic credential"),
                "EURUSD",
            )
            .expect_err("missing adapter must fail process initialization");

        assert_ne!(error, DriverError::new("RUNTIME_ALREADY_EXISTS"));
        assert!(!driver.runtimes.contains_key("account-start-failure"));
        assert!(
            !data_root
                .join("accounts")
                .join("account-start-failure")
                .exists()
        );
        drop(driver);
        drop(guard);
        fs::remove_dir_all(root).expect("remove failed-start fixture");
    }

    #[test]
    fn process_config_accepts_pinned_fixture_defaults_and_splits_slots() {
        let (config, guard, root) = valid_process_config_fixture();
        config.validate().expect("valid pinned process config");

        let mut incomplete_managed = config.clone();
        incomplete_managed.terminal_slots[0].ea_path =
            Some(incomplete_managed.terminal_slots[0].terminal_path.clone());
        assert_eq!(
            DriverError::new("INCOMPLETE_MANAGED_EA_SLOT"),
            incomplete_managed.validate().unwrap_err()
        );

        let mut managed = config.clone();
        configure_complete_managed_ea_slot(&mut managed);
        managed
            .validate()
            .expect("a complete pinned managed EA slot is accepted");
        let mut invalid_managed = managed.clone();
        invalid_managed.terminal_slots[0].ea_bootstrap_pipe = Some("bad/pipe".into());
        assert_eq!(
            invalid_managed.validate().unwrap_err(),
            DriverError::new("INVALID_MANAGED_EA_SLOT")
        );

        let input = ProcessDriverConfigInput {
            worker_id: config.worker_id.clone(),
            data_root: config.data_root.clone(),
            terminal_slots: config.terminal_slots.clone(),
            python_path: config.python_path.clone(),
            adapter_path: config.adapter_path.clone(),
            acl_helper_path: config.acl_helper_path.clone(),
            powershell_path: config.powershell_path.clone(),
            artifact_pins: config.artifact_pins.clone(),
            adapter_event_capacity: None,
            job_active_process_limit: None,
            job_process_memory_limit: None,
            cpu_budget_percent: None,
            minimum_free_disk_bytes: Some(1),
            io_timeout_ms: Some(1_000),
            graceful_stop_timeout_ms: Some(1_000),
            restart_spacing_ms: None,
        };
        let converted = ProcessDriverConfig::try_from(input).expect("defaulted process config");
        assert_eq!(
            DEFAULT_ADAPTER_EVENT_CAPACITY,
            converted.adapter_event_capacity
        );
        assert_eq!(
            DEFAULT_JOB_ACTIVE_PROCESS_LIMIT,
            converted.job_active_process_limit
        );

        let mut two_slots = config.clone();
        two_slots
            .terminal_slots
            .push(two_slots.terminal_slots[0].clone());
        let split = two_slots.into_slot_configs();
        assert_eq!(2, split.len());
        assert_eq!(0, split[0].slot_index);
        assert_eq!(1, split[1].slot_index);
        assert!(split.iter().all(|slot| slot.terminal_slots.len() == 1));

        ensure_minimum_free_disk(&root, 1).expect("fixture volume has at least one free byte");
        assert_eq!(
            DriverError::new("INSUFFICIENT_RUNTIME_DISK"),
            ensure_minimum_free_disk(&root, u64::MAX).unwrap_err()
        );
        assert_eq!(
            DriverError::new("RUNTIME_DISK_QUERY_FAILED"),
            ensure_minimum_free_disk(&root.join("missing-volume-root"), 1).unwrap_err()
        );
        assert_eq!(
            DriverError::new("TERMINAL_CLEANUP_POSTCONDITION_FAILED"),
            wait_for_terminal_exit(
                &std::env::current_exe().expect("current test executable"),
                Duration::ZERO,
            )
            .unwrap_err()
        );

        let runtime_directory =
            checked_runtime_directory(&config.data_root, "cleanup-probe").unwrap();
        fs::create_dir_all(&runtime_directory).expect("create cleanup probe runtime");
        let cleanup_layout = RuntimeLayout {
            runtime_directory: runtime_directory.clone(),
            terminal_path: root.join("not-running-terminal.exe"),
            mcp_port: 0,
            ea_bootstrap_pipe: None,
            ea_profile: None,
            slot_id: None,
            ea_gateway_origin: None,
        };
        cleanup_runtime_assignment(&config, "cleanup-probe", &cleanup_layout)
            .expect("remove the exact stopped runtime assignment");
        assert!(!runtime_directory.exists());
        remove_runtime_directory(&config, &cleanup_layout)
            .expect("removing an already absent runtime directory is idempotent");

        drop(split);
        drop(converted);
        drop(config);
        drop(guard);
        fs::remove_dir_all(root).expect("remove valid process fixture");
    }

    #[test]
    fn managed_text_decoder_accepts_utf8_and_utf16_and_rejects_invalid_encodings() {
        assert_eq!("hello", decode_mt5_text(b"\xef\xbb\xbfhello").unwrap());
        let utf16 = [0xff, 0xfe, b'h', 0, b'i', 0];
        assert_eq!("hi", decode_mt5_text(&utf16).unwrap());
        assert_eq!(
            DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"),
            decode_mt5_text(&[0xff, 0xfe, b'h']).unwrap_err()
        );
        assert_eq!(
            DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"),
            decode_mt5_text(&[0xff]).unwrap_err()
        );
    }

    #[test]
    fn managed_ea_gateway_origin_rejects_credentials_paths_queries_and_remote_http() {
        assert!(valid_ea_gateway_origin("https://execution.example.test"));
        assert!(valid_ea_gateway_origin("http://127.0.0.1:8790"));
        for value in [
            "not-a-url",
            "https://user@example.test",
            "https://execution.example.test/path",
            "https://execution.example.test?query=1",
            "http://execution.example.test",
            "ftp://127.0.0.1",
        ] {
            assert!(!valid_ea_gateway_origin(value), "accepted {value}");
        }
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

    #[test]
    fn stop_releases_slot_only_after_exact_runtime_cleanup() {
        let account_id = "account-cleanup-test";
        let data_root = std::env::temp_dir().join(format!(
            "marketlens-runtime-cleanup-{}-{}",
            std::process::id(),
            unix_time_ms()
        ));
        let runtime_directory = data_root.join("accounts").join(account_id);
        fs::create_dir_all(&runtime_directory).expect("create exact runtime fixture");
        fs::write(runtime_directory.join("dirty.marker"), b"fixture")
            .expect("write dirty runtime marker");
        let terminal_path = data_root.join("terminal64.exe");
        let config = ProcessDriverConfig {
            worker_id: "worker-01".to_owned(),
            data_root: data_root.clone(),
            terminal_slots: Vec::new(),
            python_path: data_root.join("python.exe"),
            adapter_path: data_root.join("adapter.py"),
            acl_helper_path: data_root.join("acl.ps1"),
            powershell_path: data_root.join("powershell.exe"),
            artifact_pins: ArtifactPins {
                python_sha256: String::new(),
                adapter_sha256: String::new(),
            },
            adapter_event_capacity: DEFAULT_ADAPTER_EVENT_CAPACITY,
            job_active_process_limit: DEFAULT_JOB_ACTIVE_PROCESS_LIMIT,
            job_process_memory_limit: DEFAULT_JOB_PROCESS_MEMORY_LIMIT,
            cpu_budget_percent: DEFAULT_CPU_BUDGET_PERCENT,
            minimum_free_disk_bytes: DEFAULT_MINIMUM_FREE_DISK_BYTES,
            io_timeout: Duration::from_millis(50),
            graceful_stop_timeout: Duration::from_millis(50),
            restart_spacing: Duration::ZERO,
            slot_index: 0,
        };
        let mut driver = ProcessRuntimeDriver {
            config,
            runtimes: HashMap::from([(
                account_id.to_owned(),
                ManagedRuntime {
                    layout: RuntimeLayout {
                        runtime_directory: runtime_directory.clone(),
                        terminal_path,
                        mcp_port: 24_000,
                        ea_bootstrap_pipe: None,
                        ea_profile: None,
                        slot_id: None,
                        ea_gateway_origin: None,
                    },
                    symbol: "EURUSD".into(),
                    pair: None,
                },
            )]),
        };

        RuntimeDriver::stop(&mut driver, account_id, 7).expect("clean exact runtime");

        assert!(!runtime_directory.exists(), "dirty runtime survived stop");
        assert!(
            !driver.runtimes.contains_key(account_id),
            "slot was not released after cleanup"
        );
        assert!(data_root.exists(), "cleanup escaped the assignment root");
        fs::remove_dir(data_root.join("accounts")).expect("remove empty accounts root");
        fs::remove_dir(&data_root).expect("remove empty test data root");
    }

    #[test]
    fn cleanup_failure_keeps_dirty_slot_reserved() {
        let account_id = "account-dirty-test";
        let data_root = std::env::temp_dir().join(format!(
            "marketlens-runtime-dirty-{}-{}",
            std::process::id(),
            unix_time_ms()
        ));
        let wrong_runtime = data_root.join("wrong-assignment");
        fs::create_dir_all(&wrong_runtime).expect("create mismatched runtime fixture");
        let config = ProcessDriverConfig {
            worker_id: "worker-01".to_owned(),
            data_root: data_root.clone(),
            terminal_slots: Vec::new(),
            python_path: data_root.join("python.exe"),
            adapter_path: data_root.join("adapter.py"),
            acl_helper_path: data_root.join("acl.ps1"),
            powershell_path: data_root.join("powershell.exe"),
            artifact_pins: ArtifactPins {
                python_sha256: String::new(),
                adapter_sha256: String::new(),
            },
            adapter_event_capacity: DEFAULT_ADAPTER_EVENT_CAPACITY,
            job_active_process_limit: DEFAULT_JOB_ACTIVE_PROCESS_LIMIT,
            job_process_memory_limit: DEFAULT_JOB_PROCESS_MEMORY_LIMIT,
            cpu_budget_percent: DEFAULT_CPU_BUDGET_PERCENT,
            minimum_free_disk_bytes: DEFAULT_MINIMUM_FREE_DISK_BYTES,
            io_timeout: Duration::from_millis(50),
            graceful_stop_timeout: Duration::from_millis(50),
            restart_spacing: Duration::ZERO,
            slot_index: 0,
        };
        let mut driver = ProcessRuntimeDriver {
            config,
            runtimes: HashMap::from([(
                account_id.to_owned(),
                ManagedRuntime {
                    layout: RuntimeLayout {
                        runtime_directory: wrong_runtime.clone(),
                        terminal_path: data_root.join("terminal64.exe"),
                        mcp_port: 24_000,
                        ea_bootstrap_pipe: None,
                        ea_profile: None,
                        slot_id: None,
                        ea_gateway_origin: None,
                    },
                    symbol: "EURUSD".into(),
                    pair: None,
                },
            )]),
        };

        assert_eq!(
            RuntimeDriver::stop(&mut driver, account_id, 11),
            Err(DriverError::new("RUNTIME_CLEANUP_PATH_MISMATCH"))
        );
        assert!(wrong_runtime.exists(), "unsafe cleanup changed the fixture");
        assert!(
            driver.runtimes.contains_key(account_id),
            "dirty slot was released after cleanup failure"
        );
        fs::remove_dir(&wrong_runtime).expect("remove mismatched runtime fixture");
        fs::remove_dir(&data_root).expect("remove test data root");
    }

    #[cfg(windows)]
    #[test]
    fn initialize_failure_cleanup_leaves_no_child_process_alive() {
        let mut pids = (0_u32, 0_u32);
        let result: Result<(), DriverError> = (|| {
            let job = ProcessJob::new(4, 256 * 1024 * 1024, DEFAULT_CPU_BUDGET_PERCENT)
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

    #[cfg(windows)]
    #[test]
    fn ea_bootstrap_pipe_is_one_shot_and_bound_to_the_connecting_process() {
        use std::net::TcpListener;
        use std::os::windows::ffi::OsStrExt;
        use std::ptr::{null, null_mut};

        use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_READ, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::Storage::FileSystem::{CreateFileW, OPEN_EXISTING, ReadFile};

        let (config, guard, root) = valid_process_config_fixture();
        let pipe_name = format!("marketlens-bootstrap-test-{}", std::process::id());
        let token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let layout = RuntimeLayout {
            runtime_directory: root.join("runtime-bootstrap"),
            terminal_path: std::env::current_exe().expect("current executable path"),
            mcp_port: 24_000,
            ea_bootstrap_pipe: Some(pipe_name.clone()),
            ea_profile: Some("MarketLens-slot-01".into()),
            slot_id: Some("slot-01".into()),
            ea_gateway_origin: Some("http://127.0.0.1:8790".into()),
        };
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind bootstrap test endpoint");
        let endpoint = Url::parse(&format!(
            "http://{}/v1/mt5-vm/workers/ea-bootstrap/bind",
            listener.local_addr().expect("bootstrap endpoint address")
        ))
        .expect("bootstrap bind endpoint URL");
        let bind_server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept bootstrap binding");
            let request = read_test_http_request(&mut stream);
            let body = r#"{"bound":true,"idempotent":false,"serverTimeMs":1}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .expect("write bootstrap binding response");
            request
        });
        let material = EaBootstrapMaterial::new(
            SecretText::new(token.to_owned()).expect("bootstrap token"),
            reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(5))
                .build()
                .expect("bootstrap bind client"),
            endpoint,
            SecretText::new("b".repeat(64)).expect("worker session token"),
            EaBootstrapBinding::new(1, "worker-01".into(), 3, 5),
        );
        let (server, binding) =
            prepare_ea_bootstrap(&config, &layout, Some(material)).expect("prepare bootstrap");

        let full_name = format!(r"\\.\pipe\{pipe_name}");
        let wide_name = std::ffi::OsStr::new(&full_name)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let pipe_client = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let pipe = loop {
                let handle = unsafe {
                    CreateFileW(
                        wide_name.as_ptr(),
                        GENERIC_READ,
                        0,
                        null(),
                        OPEN_EXISTING,
                        0,
                        null_mut(),
                    )
                };
                if handle != INVALID_HANDLE_VALUE {
                    break handle;
                }
                assert!(Instant::now() < deadline, "bootstrap pipe did not appear");
                thread::sleep(Duration::from_millis(10));
            };
            let mut payload = [0_u8; 512];
            let mut read = 0_u32;
            assert_ne!(0, unsafe {
                ReadFile(
                    pipe,
                    payload.as_mut_ptr(),
                    payload.len() as u32,
                    &mut read,
                    null_mut(),
                )
            });
            unsafe { CloseHandle(pipe) };
            payload[..read as usize].to_vec()
        });
        let runtime = EaBootstrapRuntime {
            account_id: "account-01",
            lease_generation: 7,
            layout: &layout,
            terminal_pid: std::process::id(),
        };
        finish_ea(binding.as_ref(), server, &runtime)
            .expect("bind, authorize, and deliver bootstrap");

        let bind_request = bind_server.join().expect("bootstrap bind server joins");
        assert!(bind_request.contains("\"accountId\":\"account-01\""));
        assert!(bind_request.contains("\"slotId\":\"slot-01\""));
        let payload = pipe_client.join().expect("bootstrap pipe client joins");
        let envelope: Value =
            serde_json::from_slice(&payload).expect("pipe returns the bound JSON envelope");
        assert_eq!(envelope["pairingToken"], token);
        assert_eq!(envelope["slotId"], "slot-01");
        assert_eq!(envelope["terminalPid"], std::process::id());
        assert_eq!(envelope["gatewayOrigin"], "http://127.0.0.1:8790");
        drop(guard);
        fs::remove_dir_all(root).expect("remove bootstrap fixture");
    }

    #[test]
    fn managed_ea_topology_pins_are_rechecked_at_agent_startup() {
        let state_root = std::env::temp_dir().join(format!(
            "marketlens-ea-topology-{}-{}",
            std::process::id(),
            unix_time_ms()
        ));
        let ea_path = state_root
            .join("MQL5")
            .join("Experts")
            .join("MarketLensExecutionEA.ex5");
        let chart_path = state_root
            .join("MQL5")
            .join("Profiles")
            .join("Charts")
            .join("MarketLens-slot-01")
            .join("chart01.chr");
        let settings_path = state_root.join("Config").join("experts.ini");
        let attestation_path = state_root
            .join("Config")
            .join("marketlens-webrequest-attestation.json");
        fs::create_dir_all(ea_path.parent().expect("EA parent")).expect("create EA parent");
        fs::create_dir_all(chart_path.parent().expect("chart parent"))
            .expect("create chart parent");
        fs::create_dir_all(settings_path.parent().expect("settings parent"))
            .expect("create settings parent");
        let ea_bytes = b"compiled-ea-fixture";
        let chart_bytes = br#"<chart>
<expert>
path=Experts\MarketLensExecutionEA.ex5
<inputs>
GatewayUrl=http://127.0.0.1:8790
PairingToken=
BootstrapPipe=marketlens-slot-01
</inputs>
</expert>
</chart>
"#;
        let settings_bytes = b"opaque-experts-settings-fixture";
        fs::write(&ea_path, ea_bytes).expect("write EA");
        fs::write(&chart_path, chart_bytes).expect("write chart");
        fs::write(&settings_path, settings_bytes).expect("write settings");
        let ea_sha256 = format!("{:x}", Sha256::digest(ea_bytes));
        let chart_sha256 = format!("{:x}", Sha256::digest(chart_bytes));
        let settings_sha256 = format!("{:x}", Sha256::digest(settings_bytes));
        let attestation_bytes = serde_json::to_vec(&json!({
            "schemaVersion": 1,
            "settingsFileName": "experts.ini",
            "settingsSha256": settings_sha256,
            "allowedOrigins": ["http://127.0.0.1:8790"],
            "probeSucceeded": true,
        }))
        .expect("serialize topology attestation");
        fs::write(&attestation_path, &attestation_bytes).expect("write attestation");
        let attestation_sha256 = format!("{:x}", Sha256::digest(&attestation_bytes));
        let slot = TerminalSlotConfig {
            terminal_path: state_root.join("terminal64.exe"),
            terminal_sha256: "a".repeat(64),
            servers_sha256: "b".repeat(64),
            terminal_license_sha256: "c".repeat(64),
            ea_path: Some(ea_path.clone()),
            ea_sha256: Some(ea_sha256),
            ea_bootstrap_pipe: Some("marketlens-slot-01".into()),
            ea_profile: Some("MarketLens-slot-01".into()),
            slot_id: Some("slot-01".into()),
            ea_gateway_origin: Some("http://127.0.0.1:8790".into()),
            ea_profile_chart_path: Some(chart_path.clone()),
            ea_profile_chart_sha256: Some(chart_sha256.clone()),
            ea_webrequest_settings_path: Some(settings_path.clone()),
            ea_webrequest_settings_sha256: Some(settings_sha256.clone()),
            ea_topology_attestation_path: Some(attestation_path.clone()),
            ea_topology_attestation_sha256: Some(attestation_sha256),
        };

        validate_managed_ea_topology(&slot, &state_root).expect("attested topology is accepted");
        assert!(!valid_ea_loopback_origin("https://execution.example.test"));
        assert!(!valid_ea_loopback_origin("not-a-url"));

        let mut incomplete = slot.clone();
        incomplete.ea_sha256 = None;
        assert_eq!(
            DriverError::new("INCOMPLETE_MANAGED_EA_SLOT"),
            validate_managed_ea_topology(&incomplete, &state_root).unwrap_err()
        );
        let mut invalid_identity = slot.clone();
        invalid_identity.ea_bootstrap_pipe = Some("bad/pipe".into());
        assert_eq!(
            DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"),
            validate_managed_ea_topology(&invalid_identity, &state_root).unwrap_err()
        );
        let mut remote_gateway = slot.clone();
        remote_gateway.ea_gateway_origin = Some("https://execution.example.test".into());
        assert_eq!(
            DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"),
            validate_managed_ea_topology(&remote_gateway, &state_root).unwrap_err()
        );
        let mut wrong_path = slot.clone();
        wrong_path.ea_path = Some(chart_path.clone());
        assert_eq!(
            DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"),
            validate_managed_ea_topology(&wrong_path, &state_root).unwrap_err()
        );

        let extra_chart = chart_path
            .parent()
            .expect("chart parent")
            .join("chart02.chr");
        fs::write(&extra_chart, chart_bytes).expect("write unexpected chart");
        assert_eq!(
            DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"),
            validate_managed_ea_topology(&slot, &state_root).unwrap_err()
        );
        fs::remove_file(extra_chart).expect("remove unexpected chart");

        let invalid_chart = b"<chart>\0</chart>";
        fs::write(&chart_path, invalid_chart).expect("write invalid chart");
        let mut invalid_chart_slot = slot.clone();
        invalid_chart_slot.ea_profile_chart_sha256 = Some(fixture_sha256(invalid_chart));
        assert_eq!(
            DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"),
            validate_managed_ea_topology(&invalid_chart_slot, &state_root).unwrap_err()
        );
        fs::write(&chart_path, chart_bytes).expect("restore chart after topology rejection");

        let incomplete_chart = b"<chart>\n</chart>\n";
        fs::write(&chart_path, incomplete_chart).expect("write structurally incomplete chart");
        let mut incomplete_chart_slot = slot.clone();
        incomplete_chart_slot.ea_profile_chart_sha256 = Some(fixture_sha256(incomplete_chart));
        assert_eq!(
            DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"),
            validate_managed_ea_topology(&incomplete_chart_slot, &state_root).unwrap_err()
        );
        fs::write(&chart_path, chart_bytes).expect("restore structurally valid chart");

        let malformed_attestation = b"not-json";
        fs::write(&attestation_path, malformed_attestation).expect("write malformed attestation");
        let mut malformed_attestation_slot = slot.clone();
        malformed_attestation_slot.ea_topology_attestation_sha256 =
            Some(fixture_sha256(malformed_attestation));
        assert_eq!(
            DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"),
            validate_managed_ea_topology(&malformed_attestation_slot, &state_root).unwrap_err()
        );
        fs::write(&attestation_path, &attestation_bytes).expect("restore attestation");
        let invalid_attestation = serde_json::to_vec(&json!({
            "schemaVersion": 1,
            "settingsFileName": "experts.ini",
            "settingsSha256": settings_sha256,
            "allowedOrigins": ["http://127.0.0.1:8790"],
            "probeSucceeded": false,
        }))
        .expect("serialize invalid attestation");
        fs::write(&attestation_path, &invalid_attestation).expect("write invalid attestation");
        let mut invalid_attestation_slot = slot.clone();
        invalid_attestation_slot.ea_topology_attestation_sha256 =
            Some(fixture_sha256(&invalid_attestation));
        assert_eq!(
            DriverError::new("INVALID_MANAGED_EA_TOPOLOGY"),
            validate_managed_ea_topology(&invalid_attestation_slot, &state_root).unwrap_err()
        );
        fs::write(&attestation_path, &attestation_bytes).expect("restore valid attestation");

        fs::write(&chart_path, b"mutated-chart").expect("mutate chart");
        assert_eq!(
            DriverError::new("ARTIFACT_PIN_MISMATCH"),
            validate_managed_ea_topology(&slot, &state_root).unwrap_err()
        );
        fs::write(&chart_path, chart_bytes).expect("restore chart");
        fs::write(&settings_path, b"mutated-settings").expect("mutate settings");
        assert_eq!(
            DriverError::new("ARTIFACT_PIN_MISMATCH"),
            validate_managed_ea_topology(&slot, &state_root).unwrap_err()
        );
        fs::write(&settings_path, settings_bytes).expect("restore settings");
        fs::write(&attestation_path, b"mutated-attestation").expect("mutate attestation");
        assert_eq!(
            DriverError::new("ARTIFACT_PIN_MISMATCH"),
            validate_managed_ea_topology(&slot, &state_root).unwrap_err()
        );
        fs::remove_dir_all(&state_root).expect("remove topology fixture");
    }
}
