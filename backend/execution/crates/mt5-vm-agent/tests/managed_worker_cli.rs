use std::io::Write;
use std::process::{Command, Stdio};

fn run_managed_worker(input: &str) -> (i32, String, String) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_mt5-vm-agent"))
        .arg("--managed-worker")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("managed worker process starts");
    child
        .stdin
        .as_mut()
        .expect("managed worker stdin is available")
        .write_all(input.as_bytes())
        .expect("managed worker bootstrap is written");
    drop(child.stdin.take());
    let output = child.wait_with_output().expect("managed worker exits");
    (
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    )
}

fn bootstrap(gateway_url: &str, token_path: &str, allow_loopback_http: bool) -> String {
    serde_json::json!({
        "gateway_url": gateway_url,
        "credential_api_url": gateway_url,
        "bootstrap_token_file": token_path,
        "process": {
            "worker_id": "worker-01",
            "data_root": r"C:\MarketLens\data",
            "terminal_slots": [{
                "terminal_path": r"C:\MetaTrader-A\terminal64.exe",
                "terminal_sha256": "a".repeat(64),
                "servers_sha256": "b".repeat(64),
                "terminal_license_sha256": "c".repeat(64)
            }],
            "python_path": r"C:\MarketLens\python.exe",
            "adapter_path": r"C:\MarketLens\phase1_adapter.py",
            "acl_helper_path": r"C:\MarketLens\runtime-acl.ps1",
            "powershell_path": r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
            "artifact_pins": {
                "python_sha256": "d".repeat(64),
                "adapter_sha256": "e".repeat(64)
            }
        },
        "agent_version": "0.1.0",
        "image_version": "test-image",
        "runtime_version": "mt5-python-v1",
        "region": "local-test",
        "probe_symbol": "EURUSD",
        "sync_symbols": ["EURUSD"],
        "history_lookback_ms": 604800000,
        "allow_loopback_http": allow_loopback_http
    })
    .to_string()
}

#[test]
fn managed_worker_mode_rejects_invalid_bootstrap_without_echoing_secret() {
    let secret = "never-echo-this-bootstrap-token";
    let (status, stdout, stderr) =
        run_managed_worker(&format!(r#"{{"bootstrapToken":"{secret}"}}"#));
    assert_eq!(2, status);
    assert!(stderr.contains("MANAGED_WORKER_CONFIG_INVALID"), "{stderr}");
    assert!(!stdout.contains(secret));
    assert!(!stderr.contains(secret));
}

#[test]
fn managed_worker_rejects_non_tls_non_loopback_transport() {
    let (status, _stdout, stderr) = run_managed_worker(&bootstrap(
        "http://192.0.2.10:8788",
        r"C:\MarketLens\bootstrap.token",
        true,
    ));
    assert_eq!(2, status);
    assert!(
        stderr.contains("MANAGED_WORKER_TRANSPORT_POLICY_INVALID"),
        "{stderr}"
    );
}

#[test]
fn managed_worker_requires_an_absolute_token_file() {
    let (status, _stdout, stderr) = run_managed_worker(&bootstrap(
        "https://gateway.internal",
        "relative.token",
        false,
    ));
    assert_eq!(2, status);
    assert!(
        stderr.contains("MANAGED_WORKER_TOKEN_PATH_INVALID"),
        "{stderr}"
    );
}

#[test]
fn managed_worker_loopback_test_mode_still_requires_a_real_token_file() {
    let missing_token_path = std::env::temp_dir().join(format!(
        "marketlens-managed-worker-missing-bootstrap-{}.token",
        std::process::id()
    ));
    assert!(missing_token_path.is_absolute());
    assert!(!missing_token_path.exists());
    let missing_token_path = missing_token_path.to_string_lossy().into_owned();
    let (status, _stdout, stderr) = run_managed_worker(&bootstrap(
        "http://127.0.0.1:18788",
        &missing_token_path,
        true,
    ));
    assert_eq!(2, status);
    assert!(
        stderr.contains("MANAGED_WORKER_TOKEN_FILE_INVALID"),
        "{stderr}"
    );
}
