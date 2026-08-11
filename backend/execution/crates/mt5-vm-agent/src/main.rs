use std::env;
use std::path::PathBuf;

use mt5_vm_agent::{AgentConfig, AgentConfigInput};
use serde::Serialize;

#[derive(Serialize)]
struct PreflightOutput {
    ok: bool,
    service: &'static str,
    config: Option<AgentConfig>,
    error_class: Option<&'static str>,
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

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.as_slice() != ["--preflight"] {
        eprintln!("mt5-vm-agent Phase 0 supports only --preflight");
        std::process::exit(2);
    }

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
