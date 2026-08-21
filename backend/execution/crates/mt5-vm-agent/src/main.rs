use std::env;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

use mt5_vm_agent::process::{ProcessDriverConfig, ProcessDriverConfigInput, ProcessRuntimeDriver};
use mt5_vm_agent::protocol::{
    FrameSigner, FrameVerifier, IpcKey, MAX_FRAME_BYTES, MessageKind, frame_from_line,
    frame_to_line, unix_time_ms,
};
use mt5_vm_agent::queue::{DEFAULT_COMMAND_QUEUE_CAPACITY, QueueError};
use mt5_vm_agent::throttle::{StartupThrottleConfig, StartupThrottleError};
use mt5_vm_agent::worker::{
    CredentialMaterial, ProvisionRequest, RuntimeCommand, RuntimeCommandKind, Worker, WorkerError,
};
use mt5_vm_agent::{
    AGENT_PROTOCOL_VERSION, AgentConfig, AgentConfigInput, AgentError, RuntimeRegistry,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use zeroize::Zeroize;

#[derive(Serialize)]
struct PreflightOutput {
    ok: bool,
    service: &'static str,
    config: Option<AgentConfig>,
    error_class: Option<&'static str>,
}

#[derive(Deserialize)]
struct WorkerBootstrap {
    protocol_version: u32,
    control_key_hex: String,
    process: ProcessDriverConfigInput,
    max_terminals: Option<usize>,
    command_queue_capacity: Option<usize>,
    startup_throttle: Option<StartupThrottleInput>,
}

#[derive(Clone, Copy, Deserialize)]
struct StartupThrottleInput {
    window_ms: u64,
    max_starts_per_window: usize,
    min_spacing_ms: u64,
    max_jitter_ms: u64,
}

impl From<StartupThrottleInput> for StartupThrottleConfig {
    fn from(input: StartupThrottleInput) -> Self {
        Self {
            window_ms: input.window_ms,
            max_starts_per_window: input.max_starts_per_window,
            min_spacing_ms: input.min_spacing_ms,
            max_jitter_ms: input.max_jitter_ms,
        }
    }
}

#[derive(Deserialize)]
struct ProvisionPayload {
    login: String,
    password: String,
    server: String,
    symbol: String,
}

impl Drop for ProvisionPayload {
    fn drop(&mut self) {
        self.login.zeroize();
        self.password.zeroize();
        self.server.zeroize();
    }
}

fn invalid_config_exit() -> ! {
    println!(
        "{}",
        serde_json::to_string(&PreflightOutput {
            ok: false,
            service: "mt5-vm-agent",
            config: None,
            error_class: Some("INVALID_AGENT_CONFIG"),
        })
        .expect("preflight output must serialize")
    );
    std::process::exit(2);
}

fn run_preflight() {
    let max_terminals = match env::var("MT5_VM_MAX_TERMINALS") {
        Ok(value) => match value.parse::<usize>() {
            Ok(value) => Some(value),
            Err(_) => invalid_config_exit(),
        },
        Err(env::VarError::NotPresent) => None,
        Err(env::VarError::NotUnicode(_)) => invalid_config_exit(),
    };

    let input = AgentConfigInput {
        worker_id: env::var("MT5_VM_AGENT_ID").unwrap_or_else(|_| "worker-phase0".to_owned()),
        data_root: PathBuf::from(
            env::var("MT5_VM_DATA_ROOT")
                .unwrap_or_else(|_| r"C:\ProgramData\MarketLens\MT5".to_owned()),
        ),
        terminal_base: PathBuf::from(
            env::var("MT5_VM_TERMINAL_BASE")
                .unwrap_or_else(|_| r"C:\Program Files\MetaTrader 5\terminal64.exe".to_owned()),
        ),
        python_path: PathBuf::from(
            env::var("MT5_VM_PYTHON_PATH")
                .unwrap_or_else(|_| r"C:\MarketLens\runtime\python.exe".to_owned()),
        ),
        max_terminals,
    };

    match AgentConfig::try_from(input) {
        Ok(config) => {
            println!(
                "{}",
                serde_json::to_string(&PreflightOutput {
                    ok: true,
                    service: "mt5-vm-agent",
                    config: Some(config),
                    error_class: None,
                })
                .expect("preflight output must serialize")
            );
        }
        Err(_) => invalid_config_exit(),
    }
}

fn run_phase1_stdio() -> Result<(), &'static str> {
    let stdin = io::stdin();
    let mut locked_stdin = stdin.lock();
    let mut bootstrap_line = String::new();
    locked_stdin
        .read_line(&mut bootstrap_line)
        .map_err(|_| "CONTROL_BOOTSTRAP_READ_FAILED")?;
    if bootstrap_line.is_empty() || bootstrap_line.len() > MAX_FRAME_BYTES {
        return Err("CONTROL_BOOTSTRAP_INVALID");
    }
    let mut bootstrap: WorkerBootstrap =
        serde_json::from_str(&bootstrap_line).map_err(|_| "CONTROL_BOOTSTRAP_INVALID")?;
    bootstrap_line.zeroize();
    if bootstrap.protocol_version != AGENT_PROTOCOL_VERSION {
        bootstrap.control_key_hex.zeroize();
        return Err("CONTROL_PROTOCOL_MISMATCH");
    }

    let process_config =
        ProcessDriverConfig::try_from(bootstrap.process).map_err(|_| "PROCESS_CONFIG_INVALID")?;
    let worker_id = process_config.worker_id.clone();
    let data_root = process_config.data_root.clone();
    let control_signing_key =
        IpcKey::from_hex(&bootstrap.control_key_hex).map_err(|_| "CONTROL_KEY_INVALID")?;
    let control_verify_key =
        IpcKey::from_hex(&bootstrap.control_key_hex).map_err(|_| "CONTROL_KEY_INVALID")?;
    bootstrap.control_key_hex.zeroize();

    let mut signer =
        FrameSigner::new(control_signing_key, worker_id.clone()).map_err(|_| "SIGNER_FAILED")?;
    let mut verifier =
        FrameVerifier::new(control_verify_key, worker_id.clone()).map_err(|_| "VERIFIER_FAILED")?;
    let driver = ProcessRuntimeDriver::new(process_config).map_err(|_| "DRIVER_INIT_FAILED")?;
    let registry = RuntimeRegistry::new(
        data_root,
        bootstrap
            .max_terminals
            .unwrap_or(mt5_vm_agent::DEFAULT_MAX_TERMINALS),
    )
    .map_err(|_| "REGISTRY_INIT_FAILED")?;
    let startup_config = bootstrap
        .startup_throttle
        .map(Into::into)
        .unwrap_or_default();
    let mut worker = Worker::new(
        registry,
        driver,
        Some(
            bootstrap
                .command_queue_capacity
                .unwrap_or(DEFAULT_COMMAND_QUEUE_CAPACITY),
        ),
        startup_config,
    )
    .map_err(|_| "WORKER_INIT_FAILED")?;

    write_signed(
        &mut signer,
        "agent",
        1,
        MessageKind::AgentHello,
        &json!({
            "service": "mt5-vm-agent",
            "protocol_version": AGENT_PROTOCOL_VERSION,
            "max_terminals": bootstrap.max_terminals.unwrap_or(mt5_vm_agent::DEFAULT_MAX_TERMINALS),
            "command_queue_capacity": bootstrap.command_queue_capacity.unwrap_or(DEFAULT_COMMAND_QUEUE_CAPACITY),
            "private_stdio": true
        }),
    )?;

    let mut line = String::new();
    loop {
        line.clear();
        let bytes = locked_stdin
            .read_line(&mut line)
            .map_err(|_| "CONTROL_FRAME_READ_FAILED")?;
        if bytes == 0 {
            return Ok(());
        }
        if line.len() > MAX_FRAME_BYTES {
            line.zeroize();
            return Err("CONTROL_FRAME_TOO_LARGE");
        }
        let mut frame = frame_from_line(line.trim_end_matches(['\r', '\n']))
            .map_err(|_| "CONTROL_FRAME_INVALID")?;
        line.zeroize();
        let account_id = frame.account_id.clone();
        let lease_generation = frame.lease_generation;
        let expires_at_ms = frame.expires_at_ms;
        let kind = frame.kind;
        let result = match kind {
            MessageKind::ProvisionAccount => {
                let verified =
                    verifier.verify(&frame, &account_id, lease_generation, unix_time_ms());
                frame.payload_json.zeroize();
                frame.mac_hex.zeroize();
                let payload: ProvisionPayload = verified.map_err(|_| "CONTROL_AUTH_FAILED")?;
                let credential = CredentialMaterial::new(
                    payload.login.clone(),
                    payload.password.clone(),
                    payload.server.clone(),
                );
                match credential {
                    Ok(credential) => worker
                        .provision_blocking(ProvisionRequest {
                            account_id: account_id.clone(),
                            lease_generation,
                            credential,
                            symbol: payload.symbol.clone(),
                        })
                        .map(Some),
                    Err(error) => Err(error),
                }
            }
            MessageKind::AgentHeartbeat
            | MessageKind::RestartAccount
            | MessageKind::ForceTerminalCrash
            | MessageKind::StopAccount => {
                let verified =
                    verifier.verify(&frame, &account_id, lease_generation, unix_time_ms());
                frame.payload_json.zeroize();
                frame.mac_hex.zeroize();
                let _: Value = verified.map_err(|_| "CONTROL_AUTH_FAILED")?;
                let command_kind = match kind {
                    MessageKind::AgentHeartbeat => RuntimeCommandKind::Heartbeat,
                    MessageKind::RestartAccount => RuntimeCommandKind::CleanRestart,
                    MessageKind::ForceTerminalCrash => RuntimeCommandKind::ForceCrashRecover,
                    MessageKind::StopAccount => RuntimeCommandKind::Stop,
                    _ => unreachable!(),
                };
                match worker.enqueue(
                    &account_id,
                    RuntimeCommand {
                        lease_generation,
                        expires_at_ms,
                        kind: command_kind,
                    },
                    unix_time_ms(),
                ) {
                    Ok(()) => worker.process_next(&account_id, unix_time_ms()),
                    Err(error) => Err(error),
                }
            }
            _ => {
                frame.payload_json.zeroize();
                frame.mac_hex.zeroize();
                return Err("CONTROL_MESSAGE_KIND_UNSUPPORTED");
            }
        };

        match result {
            Ok(Some(snapshot)) => write_signed(
                &mut signer,
                &account_id,
                lease_generation,
                MessageKind::AccountSnapshot,
                &snapshot,
            )?,
            Ok(None) => write_signed(
                &mut signer,
                &account_id,
                lease_generation,
                if kind == MessageKind::AgentHeartbeat {
                    MessageKind::AgentHeartbeat
                } else {
                    MessageKind::AccountRuntimeStatus
                },
                &json!({
                    "state": worker.state(&account_id),
                    "active_runtime_count": worker.active_count()
                }),
            )?,
            Err(error) => write_signed(
                &mut signer,
                &account_id,
                lease_generation.max(1),
                MessageKind::AccountRuntimeStatus,
                &json!({
                    "state": "degraded",
                    "error_class": worker_error_class(&error)
                }),
            )?,
        }
    }
}

fn write_signed<T: Serialize>(
    signer: &mut FrameSigner,
    account_id: &str,
    lease_generation: u64,
    kind: MessageKind,
    payload: &T,
) -> Result<(), &'static str> {
    let frame = signer
        .sign(
            account_id,
            lease_generation,
            kind,
            payload,
            unix_time_ms(),
            30_000,
        )
        .map_err(|_| "OUTPUT_SIGN_FAILED")?;
    let line = frame_to_line(&frame).map_err(|_| "OUTPUT_FRAME_FAILED")?;
    let stdout = io::stdout();
    let mut locked_stdout = stdout.lock();
    locked_stdout
        .write_all(line.as_bytes())
        .and_then(|_| locked_stdout.write_all(b"\n"))
        .and_then(|_| locked_stdout.flush())
        .map_err(|_| "OUTPUT_WRITE_FAILED")
}

fn worker_error_class(error: &WorkerError) -> &'static str {
    match error {
        WorkerError::Registry(AgentError::StaleLeaseGeneration) => "STALE_LEASE",
        WorkerError::Registry(AgentError::CapacityExhausted) => "CAPACITY_EXHAUSTED",
        WorkerError::Registry(_) => "RUNTIME_REGISTRY_REJECTED",
        WorkerError::Queue(QueueError::QueueFull) => "COMMAND_QUEUE_FULL",
        WorkerError::Queue(_) => "COMMAND_QUEUE_REJECTED",
        WorkerError::Throttle(StartupThrottleError::InvalidConfig) => "STARTUP_THROTTLE_INVALID",
        WorkerError::Driver(error) => error.error_class,
        WorkerError::InvalidCredential => "CREDENTIAL_INVALID",
        WorkerError::InvalidSymbol => "SYMBOL_INVALID",
        WorkerError::CommandExpired => "COMMAND_EXPIRED",
        WorkerError::SnapshotGateFailed => "SNAPSHOT_GATE_FAILED",
    }
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.as_slice() {
        [flag] if flag == "--preflight" => run_preflight(),
        [flag] if flag == "--phase1-stdio" => {
            if let Err(error_class) = run_phase1_stdio() {
                eprintln!("mt5-vm-agent blocked: {error_class}");
                std::process::exit(2);
            }
        }
        [flag] if flag == "--managed-worker" => {
            if let Err(error_class) = mt5_vm_agent::managed::run_from_reader(&mut io::stdin()) {
                eprintln!("mt5-vm-agent blocked: {error_class}");
                std::process::exit(2);
            }
        }
        _ => {
            eprintln!("mt5-vm-agent supports --preflight, --phase1-stdio, or --managed-worker");
            std::process::exit(2);
        }
    }
}
