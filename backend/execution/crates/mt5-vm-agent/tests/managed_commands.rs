use std::collections::BTreeSet;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Condvar, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use execution_domain::mt5_vm_control::{
    WorkerCommandKind, WorkerControlCommand, WorkerHelloRequest,
};
use mt5_vm_agent::managed::{
    ManagedControlClient, ManagedRuntimeDriver, ManagedRuntimeOutput, ManagedRuntimeTask,
    ManagedWorker, SecretText, SlotActorRuntimeDriver,
};
use mt5_vm_agent::process::EaBootstrapMaterial;
use mt5_vm_agent::worker::CredentialMaterial;
use reqwest::Url;
use serde_json::{Value, json};

#[derive(Default)]
struct FakeDriver {
    events: Vec<String>,
    ea_bootstrap_received: Vec<bool>,
}

impl ManagedRuntimeDriver for FakeDriver {
    fn provision(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        credential: CredentialMaterial,
        probe_symbol: &str,
        ea_bootstrap: Option<EaBootstrapMaterial>,
    ) -> Result<(), &'static str> {
        assert_eq!("12345678", credential.login());
        assert_eq!("Broker-Demo", credential.server());
        self.ea_bootstrap_received.push(ea_bootstrap.is_some());
        self.events.push(format!(
            "provision:{account_id}:{lease_generation}:{probe_symbol}"
        ));
        Ok(())
    }

    fn heartbeat(&mut self, _account_id: &str, _lease_generation: u64) -> Result<(), &'static str> {
        self.events.push("heartbeat".into());
        Ok(())
    }

    fn stop(&mut self, account_id: &str, lease_generation: u64) -> Result<(), &'static str> {
        self.events
            .push(format!("stop:{account_id}:{lease_generation}"));
        Ok(())
    }

    fn snapshot_sync(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _symbols: &[String],
    ) -> Result<Value, &'static str> {
        self.events.push("snapshot".into());
        Ok(json!({
            "account": {
                "result": "complete",
                "error_code": null,
                "account": {
                    "currency": "USD",
                    "leverage": 100,
                    "balance": "10000",
                    "equity": "10000",
                    "margin": "0",
                    "free_margin": "10000",
                    "margin_level": null,
                    "margin_mode": "hedging",
                    "account_mode": "demo",
                    "trade_allowed": true,
                    "observed_server": "Broker-Demo",
                    "observed_login_suffix": "5678"
                }
            },
            "positions": {"result": "complete", "error_code": null, "positions": []},
            "pending_orders": {"result": "complete", "error_code": null, "pending_orders": []},
            "instruments": {"result": "complete", "error_code": null, "instruments": []}
        }))
    }

    fn history_sync(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _from_ms: i64,
        to_ms: i64,
    ) -> Result<Value, &'static str> {
        self.events.push("history".into());
        Ok(json!({
            "orders_history": {
                "result": "complete",
                "error_code": null,
                "covered_through_ms": to_ms,
                "orders": []
            },
            "deals": {
                "result": "complete",
                "error_code": null,
                "covered_through_ms": to_ms,
                "deals": []
            }
        }))
    }
}

#[derive(Clone, Copy)]
enum VariantBehavior {
    Success,
    ProvisionFailsStopSucceeds,
    ProvisionAndStopFail,
    StopFails,
    Panic,
}

struct VariantDriver(VariantBehavior);

impl ManagedRuntimeDriver for VariantDriver {
    fn provision(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _credential: CredentialMaterial,
        _probe_symbol: &str,
        _ea_bootstrap: Option<EaBootstrapMaterial>,
    ) -> Result<(), &'static str> {
        match self.0 {
            VariantBehavior::ProvisionFailsStopSucceeds | VariantBehavior::ProvisionAndStopFail => {
                Err("PROVISION_FAILED")
            }
            VariantBehavior::Panic => panic!("terminate actor for fail-closed test"),
            _ => Ok(()),
        }
    }

    fn heartbeat(&mut self, _account_id: &str, _lease_generation: u64) -> Result<(), &'static str> {
        Ok(())
    }

    fn stop(&mut self, _account_id: &str, _lease_generation: u64) -> Result<(), &'static str> {
        match self.0 {
            VariantBehavior::ProvisionAndStopFail | VariantBehavior::StopFails => {
                Err("STOP_FAILED")
            }
            _ => Ok(()),
        }
    }

    fn snapshot_sync(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _symbols: &[String],
    ) -> Result<Value, &'static str> {
        Ok(json!({"snapshots": true}))
    }

    fn history_sync(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        from_ms: i64,
        to_ms: i64,
    ) -> Result<Value, &'static str> {
        Ok(json!({"from": from_ms, "to": to_ms}))
    }
}

struct WrongOutputDriver;

impl ManagedRuntimeDriver for WrongOutputDriver {
    fn provision(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _credential: CredentialMaterial,
        _probe_symbol: &str,
        _ea_bootstrap: Option<EaBootstrapMaterial>,
    ) -> Result<(), &'static str> {
        Ok(())
    }

    fn heartbeat(&mut self, _account_id: &str, _lease_generation: u64) -> Result<(), &'static str> {
        Ok(())
    }

    fn stop(&mut self, _account_id: &str, _lease_generation: u64) -> Result<(), &'static str> {
        Ok(())
    }

    fn snapshot_sync(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _symbols: &[String],
    ) -> Result<Value, &'static str> {
        Ok(json!({}))
    }

    fn history_sync(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _from_ms: i64,
        _to_ms: i64,
    ) -> Result<Value, &'static str> {
        Ok(json!({}))
    }

    fn execute_task(
        &mut self,
        _task: ManagedRuntimeTask,
    ) -> Result<ManagedRuntimeOutput, &'static str> {
        Ok(ManagedRuntimeOutput::Heartbeat)
    }
}

struct CrossedOutputDriver;

impl ManagedRuntimeDriver for CrossedOutputDriver {
    fn provision(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _credential: CredentialMaterial,
        _probe_symbol: &str,
        _ea_bootstrap: Option<EaBootstrapMaterial>,
    ) -> Result<(), &'static str> {
        Ok(())
    }

    fn heartbeat(&mut self, _account_id: &str, _lease_generation: u64) -> Result<(), &'static str> {
        Ok(())
    }

    fn stop(&mut self, _account_id: &str, _lease_generation: u64) -> Result<(), &'static str> {
        Ok(())
    }

    fn snapshot_sync(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _symbols: &[String],
    ) -> Result<Value, &'static str> {
        Ok(json!({}))
    }

    fn history_sync(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _from_ms: i64,
        _to_ms: i64,
    ) -> Result<Value, &'static str> {
        Ok(json!({}))
    }

    fn execute_task(
        &mut self,
        task: ManagedRuntimeTask,
    ) -> Result<ManagedRuntimeOutput, &'static str> {
        match task {
            ManagedRuntimeTask::Provision { .. } => Ok(ManagedRuntimeOutput::Provisioned),
            ManagedRuntimeTask::Heartbeat { .. } => Ok(ManagedRuntimeOutput::Stopped),
            ManagedRuntimeTask::Stop { .. } => Ok(ManagedRuntimeOutput::Heartbeat),
            ManagedRuntimeTask::Reconcile { .. } => Ok(ManagedRuntimeOutput::Heartbeat),
        }
    }
}

fn synthetic_credential() -> CredentialMaterial {
    CredentialMaterial::new(
        "12345678".into(),
        "synthetic-password".into(),
        "Broker-Demo".into(),
    )
    .expect("synthetic credential")
}

#[test]
fn slot_actor_wrappers_and_failure_cleanup_are_fenced() {
    assert_eq!(
        SlotActorRuntimeDriver::<VariantDriver>::new(Vec::new())
            .err()
            .expect("empty actors fail")
            .code(),
        "MANAGED_WORKER_RUNTIME_CONFIG_INVALID"
    );

    let mut success = SlotActorRuntimeDriver::new(vec![VariantDriver(VariantBehavior::Success)])
        .expect("one actor");
    success
        .provision("account-a", 1, synthetic_credential(), "EURUSD", None)
        .unwrap();
    success.heartbeat("account-a", 1).unwrap();
    assert_eq!(
        success.snapshot_sync("account-a", 1, &[]),
        Err("MANAGED_WORKER_ACTOR_BATCH_REQUIRED")
    );
    assert_eq!(
        success.history_sync("account-a", 1, 1, 2),
        Err("MANAGED_WORKER_ACTOR_BATCH_REQUIRED")
    );
    assert_eq!(
        success.provision("account-a", 2, synthetic_credential(), "EURUSD", None),
        Err("MANAGED_WORKER_LEASE_CONFLICT")
    );
    success.stop("account-a", 1).unwrap();

    let mut recoverable = SlotActorRuntimeDriver::new(vec![VariantDriver(
        VariantBehavior::ProvisionFailsStopSucceeds,
    )])
    .unwrap();
    assert_eq!(
        recoverable.provision("account-b", 1, synthetic_credential(), "EURUSD", None),
        Err("PROVISION_FAILED")
    );
    assert_eq!(
        recoverable.provision("account-c", 1, synthetic_credential(), "EURUSD", None),
        Err("PROVISION_FAILED")
    );

    let mut poisoned =
        SlotActorRuntimeDriver::new(vec![VariantDriver(VariantBehavior::ProvisionAndStopFail)])
            .unwrap();
    assert_eq!(
        poisoned.provision("account-d", 1, synthetic_credential(), "EURUSD", None),
        Err("PROVISION_FAILED")
    );
    assert_eq!(
        poisoned.heartbeat("account-d", 1),
        Err("MANAGED_WORKER_SLOT_POISONED")
    );

    let mut stop_failure =
        SlotActorRuntimeDriver::new(vec![VariantDriver(VariantBehavior::StopFails)]).unwrap();
    stop_failure
        .provision("account-e", 1, synthetic_credential(), "EURUSD", None)
        .unwrap();
    assert_eq!(stop_failure.stop("account-e", 1), Err("STOP_FAILED"));
    assert_eq!(
        stop_failure.heartbeat("account-e", 1),
        Err("MANAGED_WORKER_SLOT_POISONED")
    );

    let mut wrong = SlotActorRuntimeDriver::new(vec![WrongOutputDriver]).unwrap();
    assert_eq!(
        wrong.provision("account-f", 1, synthetic_credential(), "EURUSD", None),
        Err("MANAGED_WORKER_ACTOR_RESULT_INVALID")
    );

    let mut crossed = SlotActorRuntimeDriver::new(vec![CrossedOutputDriver]).unwrap();
    crossed
        .provision("account-crossed", 1, synthetic_credential(), "EURUSD", None)
        .unwrap();
    assert_eq!(
        crossed.heartbeat("account-crossed", 1),
        Err("MANAGED_WORKER_ACTOR_RESULT_INVALID")
    );
    assert_eq!(
        crossed.stop("account-crossed", 1),
        Err("MANAGED_WORKER_ACTOR_RESULT_INVALID")
    );

    let mut unavailable =
        SlotActorRuntimeDriver::new(vec![VariantDriver(VariantBehavior::Panic)]).unwrap();
    assert_eq!(
        unavailable.provision("account-g", 1, synthetic_credential(), "EURUSD", None),
        Err("MANAGED_WORKER_ACTOR_UNAVAILABLE")
    );
    assert_eq!(
        unavailable.stop("account-g", 1),
        Err("MANAGED_WORKER_ACTOR_UNAVAILABLE")
    );

    let mut direct = VariantDriver(VariantBehavior::Success);
    let outputs = direct.execute_batch(vec![
        ManagedRuntimeTask::Provision {
            account_id: "account-h".into(),
            lease_generation: 1,
            credential: synthetic_credential(),
            probe_symbol: "EURUSD".into(),
            ea_bootstrap: None,
        },
        ManagedRuntimeTask::Reconcile {
            account_id: "account-h".into(),
            lease_generation: 1,
            symbols: vec!["EURUSD".into()],
            from_ms: 10,
            to_ms: 20,
        },
    ]);
    assert!(matches!(outputs[0], Ok(ManagedRuntimeOutput::Provisioned)));
    assert!(matches!(
        outputs[1],
        Ok(ManagedRuntimeOutput::Reconciled {
            from_ms: 10,
            to_ms: 20,
            ..
        })
    ));
}

fn command_with_bootstrap(
    kind: WorkerCommandKind,
    command_id: &str,
    payload_json: &str,
    credential_grant: Option<&str>,
    ea_bootstrap_token: Option<&str>,
) -> WorkerControlCommand {
    let mut command = command(kind, command_id, payload_json, credential_grant);
    command.ea_bootstrap_token = ea_bootstrap_token.map(str::to_owned);
    command
}

fn command(
    kind: WorkerCommandKind,
    command_id: &str,
    payload_json: &str,
    credential_grant: Option<&str>,
) -> WorkerControlCommand {
    WorkerControlCommand {
        protocol_version: 1,
        worker_id: "worker-01".into(),
        account_id: "account-01".into(),
        lease_generation: 3,
        command_id: command_id.into(),
        message_id: "22222222-2222-4222-8222-222222222222".into(),
        sent_at_ms: 1,
        expires_at_ms: u64::MAX,
        kind,
        payload_json: payload_json.into(),
        credential_grant: credential_grant.map(str::to_owned),
        ea_bootstrap_token: None,
    }
}

fn serve_scripted(
    responses: Vec<(&'static str, &'static str)>,
) -> (Url, mpsc::Receiver<String>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("loopback listener binds");
    let address = listener.local_addr().unwrap();
    listener.set_nonblocking(true).unwrap();
    let (sender, receiver) = mpsc::channel();
    let handle = thread::spawn(move || {
        for (status, body) in responses {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => {
                        stream
                            .set_nonblocking(false)
                            .expect("accepted stream is blocking");
                        break stream;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(Instant::now() < deadline, "scripted connection timed out");
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("scripted connection failed: {error}"),
                }
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                request.extend_from_slice(&buffer[..count]);
                let text = String::from_utf8_lossy(&request);
                let Some(header_end) = text.find("\r\n\r\n") else {
                    continue;
                };
                let content_length = text[..header_end]
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .unwrap_or(0);
                if request.len() >= header_end + 4 + content_length {
                    break;
                }
            }
            sender.send(String::from_utf8(request).unwrap()).unwrap();
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            stream.flush().unwrap();
        }
    });
    (
        Url::parse(&format!("http://{address}/")).unwrap(),
        receiver,
        handle,
    )
}

fn hello_request() -> WorkerHelloRequest {
    WorkerHelloRequest {
        worker_id: "worker-01".into(),
        protocol_min: 1,
        protocol_max: 1,
        agent_version: "0.1.0".into(),
        image_version: "test-image".into(),
        runtime_version: "mt5-python-v1".into(),
        capacity: 2,
        region: "local-test".into(),
        capabilities: BTreeSet::from(["phase4_read_sync".into()]),
    }
}

fn hello_response() -> &'static str {
    r#"{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":7,"sessionToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","heartbeatIntervalMs":15000,"leaseTtlMs":45000,"serverTimeMs":1700000000000}"#
}

fn poll_response(commands: Vec<WorkerControlCommand>) -> &'static str {
    leaked_json_response(json!({
        "protocolVersion": 1,
        "serverTimeMs": 1_700_000_000_000_i64,
        "commands": commands
    }))
}

fn ack_response(command_id: &str, status: &str) -> &'static str {
    leaked_json_response(json!({
        "commandId": command_id,
        "status": status,
        "serverTimeMs": 1_700_000_000_000_i64
    }))
}

fn managed_client(base_url: &Url) -> ManagedControlClient {
    ManagedControlClient::new(
        base_url.clone(),
        base_url.clone(),
        SecretText::new("bootstrap-secret-0123456789abcdef0123456789".into()).unwrap(),
    )
    .unwrap()
}

#[test]
fn managed_poll_dispatches_distinct_accounts_as_one_bounded_parallel_wave() {
    let source = include_str!("../src/managed.rs");
    assert!(
        source.contains("process_parallel_commands(response.commands)"),
        "managed poll still dispatches account commands serially"
    );
    assert!(source.contains("driver.execute_batch(tasks)"));
}

struct ParallelProbeState {
    entered: usize,
    active: usize,
    max_active: usize,
    release: bool,
}

#[derive(Clone)]
struct BlockingDriver {
    state: Arc<(Mutex<ParallelProbeState>, Condvar)>,
}

impl ManagedRuntimeDriver for BlockingDriver {
    fn provision(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _credential: CredentialMaterial,
        _probe_symbol: &str,
        _ea_bootstrap: Option<EaBootstrapMaterial>,
    ) -> Result<(), &'static str> {
        let (lock, changed) = &*self.state;
        let mut state = lock.lock().expect("parallel probe lock");
        state.entered += 1;
        state.active += 1;
        state.max_active = state.max_active.max(state.active);
        changed.notify_all();
        while !state.release {
            state = changed.wait(state).expect("parallel probe wait");
        }
        state.active -= 1;
        Ok(())
    }

    fn heartbeat(&mut self, _account_id: &str, _lease_generation: u64) -> Result<(), &'static str> {
        Ok(())
    }

    fn stop(&mut self, _account_id: &str, _lease_generation: u64) -> Result<(), &'static str> {
        Ok(())
    }

    fn snapshot_sync(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _symbols: &[String],
    ) -> Result<Value, &'static str> {
        Ok(json!({}))
    }

    fn history_sync(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _from_ms: i64,
        _to_ms: i64,
    ) -> Result<Value, &'static str> {
        Ok(json!({}))
    }
}

fn parallel_provision_task(index: usize) -> ManagedRuntimeTask {
    ManagedRuntimeTask::Provision {
        account_id: format!("account-{index:02}"),
        lease_generation: index as u64 + 1,
        credential: CredentialMaterial::new(
            format!("12345{index:03}"),
            "synthetic-password".into(),
            "Synthetic-Demo".into(),
        )
        .expect("synthetic credential"),
        probe_symbol: "EURUSD".into(),
        ea_bootstrap: None,
    }
}

#[test]
fn different_accounts_execute_concurrently_up_to_attested_slot_count() {
    let state = Arc::new((
        Mutex::new(ParallelProbeState {
            entered: 0,
            active: 0,
            max_active: 0,
            release: false,
        }),
        Condvar::new(),
    ));
    let drivers = (0..4)
        .map(|_| BlockingDriver {
            state: Arc::clone(&state),
        })
        .collect();
    let mut pool = SlotActorRuntimeDriver::new(drivers).expect("four attested slot actors");
    let run =
        thread::spawn(move || pool.execute_batch((0..5).map(parallel_provision_task).collect()));

    let (lock, changed) = &*state;
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut probe = lock.lock().expect("parallel probe lock");
    while probe.entered < 4 && Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let (next, _) = changed
            .wait_timeout(probe, remaining)
            .expect("parallel probe timed wait");
        probe = next;
    }
    let entered = probe.entered;
    let max_active = probe.max_active;
    probe.release = true;
    changed.notify_all();
    drop(probe);

    let results = run.join().expect("parallel actor batch joins");
    assert_eq!(4, entered, "four slot actors did not enter together");
    assert_eq!(4, max_active, "runtime work remained serial");
    assert!(
        results[..4]
            .iter()
            .all(|result| matches!(result, Ok(ManagedRuntimeOutput::Provisioned)))
    );
    assert!(matches!(
        &results[4],
        Err("TERMINAL_SLOT_CAPACITY_EXHAUSTED")
    ));
}

#[test]
fn stale_lease_generation_cannot_reuse_an_assigned_slot() {
    let mut runtime =
        SlotActorRuntimeDriver::new(vec![FakeDriver::default()]).expect("one attested slot");
    let provisioned = runtime.execute_batch(vec![ManagedRuntimeTask::Provision {
        account_id: "account-01".into(),
        lease_generation: 3,
        credential: CredentialMaterial::new(
            "12345678".into(),
            "synthetic-password".into(),
            "Broker-Demo".into(),
        )
        .expect("synthetic credential"),
        probe_symbol: "EURUSD".into(),
        ea_bootstrap: None,
    }]);
    assert!(matches!(
        provisioned.as_slice(),
        [Ok(ManagedRuntimeOutput::Provisioned)]
    ));

    let stale = runtime.execute_batch(vec![ManagedRuntimeTask::Heartbeat {
        account_id: "account-01".into(),
        lease_generation: 4,
    }]);
    assert!(matches!(
        stale.as_slice(),
        [Err("MANAGED_WORKER_LEASE_FENCED")]
    ));
}

#[test]
fn provision_is_received_before_one_time_grant_and_terminal_ack() {
    let responses = vec![
        (
            "200 OK",
            r#"{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":7,"sessionToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","heartbeatIntervalMs":15000,"leaseTtlMs":45000,"serverTimeMs":1700000000000}"#,
        ),
        (
            "200 OK",
            r#"{"commandId":"11111111-1111-4111-8111-111111111111","status":"received","serverTimeMs":1700000000001}"#,
        ),
        (
            "200 OK",
            r#"{"login":"12345678","password":"one-use-password","server":"Broker-Demo"}"#,
        ),
        (
            "200 OK",
            r#"{"commandId":"11111111-1111-4111-8111-111111111111","status":"succeeded","serverTimeMs":1700000000002}"#,
        ),
    ];
    let (base_url, captured, server) = serve_scripted(responses);
    let client = ManagedControlClient::new(
        base_url.clone(),
        base_url,
        SecretText::new("bootstrap-secret-0123456789abcdef0123456789".into()).unwrap(),
    )
    .unwrap();
    let session = client.hello(&hello_request()).unwrap();
    let mut worker = ManagedWorker::new(
        client,
        session,
        FakeDriver::default(),
        "EURUSD".into(),
        vec!["EURUSD".into()],
        7 * 24 * 60 * 60 * 1_000,
    )
    .unwrap();
    let succeeded = worker
        .process_command(command(
            WorkerCommandKind::ProvisionAccount,
            "11111111-1111-4111-8111-111111111111",
            r#"{"connectionRevision":1}"#,
            Some("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"),
        ))
        .expect("provision command transport succeeds");
    assert!(succeeded);
    assert_eq!(
        ["provision:account-01:3:EURUSD"],
        worker.driver().events.as_slice()
    );

    let requests: Vec<String> = (0..4)
        .map(|_| captured.recv_timeout(Duration::from_secs(5)).unwrap())
        .collect();
    server.join().unwrap();
    assert!(requests[1].contains(r#""ack":"received""#));
    assert!(
        requests[2].starts_with(
            "POST /api/v1/execution-workers/mt5/credential-grants/consume HTTP/1.1\r\n"
        )
    );
    assert!(requests[3].contains(r#""ack":"succeeded""#));
    let terminal_body = requests[3].split_once("\r\n\r\n").unwrap().1;
    assert!(!terminal_body.contains("12345678"));
    assert!(!terminal_body.contains("Broker-Demo"));
}

#[test]
fn bare_metal_provision_requires_and_delivers_the_one_time_ea_token() {
    let responses = vec![
        (
            "200 OK",
            r#"{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":7,"sessionToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","heartbeatIntervalMs":15000,"leaseTtlMs":45000,"serverTimeMs":1700000000000}"#,
        ),
        (
            "200 OK",
            r#"{"commandId":"11111111-1111-4111-8111-111111111111","status":"received","serverTimeMs":1700000000001}"#,
        ),
        (
            "200 OK",
            r#"{"login":"12345678","password":"one-use-password","server":"Broker-Demo"}"#,
        ),
        (
            "200 OK",
            r#"{"commandId":"11111111-1111-4111-8111-111111111111","status":"succeeded","serverTimeMs":1700000000002}"#,
        ),
    ];
    let (base_url, captured, server) = serve_scripted(responses);
    let client = ManagedControlClient::new(
        base_url.clone(),
        base_url,
        SecretText::new("bootstrap-secret-0123456789abcdef0123456789".into()).unwrap(),
    )
    .unwrap();
    let session = client.hello(&hello_request()).unwrap();
    let mut worker = ManagedWorker::new_with_substrate(
        client,
        session,
        FakeDriver::default(),
        "EURUSD".into(),
        vec!["EURUSD".into()],
        7 * 24 * 60 * 60 * 1_000,
        "bare_metal",
    )
    .unwrap();
    let succeeded = worker
        .process_command(command_with_bootstrap(
            WorkerCommandKind::ProvisionAccount,
            "11111111-1111-4111-8111-111111111111",
            r#"{"connectionRevision":1}"#,
            Some("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"),
            Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        ))
        .expect("bare-metal provision transport succeeds");
    assert!(succeeded);
    assert_eq!([true], worker.driver().ea_bootstrap_received.as_slice());

    let requests: Vec<String> = (0..4)
        .map(|_| captured.recv_timeout(Duration::from_secs(5)).unwrap())
        .collect();
    server.join().unwrap();
    assert!(requests.iter().all(|request| {
        !request.contains("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    }));
}

#[test]
fn bare_metal_provision_rejects_a_missing_ea_token_before_consuming_credentials() {
    let responses = vec![
        (
            "200 OK",
            r#"{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":7,"sessionToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","heartbeatIntervalMs":15000,"leaseTtlMs":45000,"serverTimeMs":1700000000000}"#,
        ),
        (
            "200 OK",
            r#"{"commandId":"11111111-1111-4111-8111-111111111111","status":"received","serverTimeMs":1700000000001}"#,
        ),
        (
            "200 OK",
            r#"{"commandId":"11111111-1111-4111-8111-111111111111","status":"failed","serverTimeMs":1700000000002}"#,
        ),
    ];
    let (base_url, captured, server) = serve_scripted(responses);
    let client = ManagedControlClient::new(
        base_url.clone(),
        base_url,
        SecretText::new("bootstrap-secret-0123456789abcdef0123456789".into()).unwrap(),
    )
    .unwrap();
    let session = client.hello(&hello_request()).unwrap();
    let mut worker = ManagedWorker::new_with_substrate(
        client,
        session,
        FakeDriver::default(),
        "EURUSD".into(),
        vec!["EURUSD".into()],
        7 * 24 * 60 * 60 * 1_000,
        "bare_metal",
    )
    .unwrap();
    assert!(
        !worker
            .process_command(command(
                WorkerCommandKind::ProvisionAccount,
                "11111111-1111-4111-8111-111111111111",
                r#"{"connectionRevision":1}"#,
                Some("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"),
            ))
            .expect("missing token is reported through terminal ack")
    );

    let requests: Vec<String> = (0..3)
        .map(|_| captured.recv_timeout(Duration::from_secs(5)).unwrap())
        .collect();
    server.join().unwrap();
    assert!(requests[2].contains("MANAGED_WORKER_EA_BOOTSTRAP_TOKEN_MISSING"));
    assert!(requests.iter().all(|request| {
        !request.starts_with("POST /api/v1/execution-workers/mt5/credential-grants/consume ")
    }));
}

#[test]
fn reconcile_posts_all_six_families_before_stop_releases_runtime() {
    let responses = vec![
        (
            "200 OK",
            r#"{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":7,"sessionToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","heartbeatIntervalMs":15000,"leaseTtlMs":45000,"serverTimeMs":1700000000000}"#,
        ),
        (
            "200 OK",
            r#"{"commandId":"11111111-1111-4111-8111-111111111111","status":"received","serverTimeMs":1}"#,
        ),
        (
            "200 OK",
            r#"{"login":"12345678","password":"one-use-password","server":"Broker-Demo"}"#,
        ),
        (
            "200 OK",
            r#"{"commandId":"11111111-1111-4111-8111-111111111111","status":"succeeded","serverTimeMs":2}"#,
        ),
        (
            "200 OK",
            r#"{"commandId":"33333333-3333-4333-8333-333333333333","status":"received","serverTimeMs":3}"#,
        ),
        ("200 OK", r#"{"accepted":true,"serverTimeMs":4}"#),
        ("200 OK", r#"{"accepted":true,"serverTimeMs":5}"#),
        ("200 OK", r#"{"accepted":true,"serverTimeMs":6}"#),
        ("200 OK", r#"{"accepted":true,"serverTimeMs":7}"#),
        ("200 OK", r#"{"accepted":true,"serverTimeMs":8}"#),
        ("200 OK", r#"{"accepted":true,"serverTimeMs":9}"#),
        (
            "200 OK",
            r#"{"commandId":"33333333-3333-4333-8333-333333333333","status":"succeeded","serverTimeMs":10}"#,
        ),
        (
            "200 OK",
            r#"{"commandId":"44444444-4444-4444-8444-444444444444","status":"received","serverTimeMs":11}"#,
        ),
        (
            "200 OK",
            r#"{"commandId":"44444444-4444-4444-8444-444444444444","status":"succeeded","serverTimeMs":12}"#,
        ),
    ];
    let (base_url, captured, server) = serve_scripted(responses);
    let client = ManagedControlClient::new(
        base_url.clone(),
        base_url,
        SecretText::new("bootstrap-secret-0123456789abcdef0123456789".into()).unwrap(),
    )
    .unwrap();
    let session = client.hello(&hello_request()).unwrap();
    let mut worker = ManagedWorker::new(
        client,
        session,
        FakeDriver::default(),
        "EURUSD".into(),
        vec!["EURUSD".into()],
        7 * 24 * 60 * 60 * 1_000,
    )
    .unwrap();
    assert!(
        worker
            .process_command(command(
                WorkerCommandKind::ProvisionAccount,
                "11111111-1111-4111-8111-111111111111",
                r#"{"connectionRevision":1}"#,
                Some("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"),
            ))
            .unwrap()
    );
    assert!(
        worker
            .process_command(command(
                WorkerCommandKind::ReconcileAccount,
                "33333333-3333-4333-8333-333333333333",
                "{}",
                None,
            ))
            .unwrap()
    );
    assert!(
        worker
            .process_command(command(
                WorkerCommandKind::StopAccount,
                "44444444-4444-4444-8444-444444444444",
                "{}",
                None,
            ))
            .unwrap()
    );
    assert_eq!(
        [
            "provision:account-01:3:EURUSD",
            "heartbeat",
            "snapshot",
            "history",
            "stop:account-01:3"
        ],
        worker.driver().events.as_slice()
    );

    let requests: Vec<String> = (0..14)
        .map(|_| captured.recv_timeout(Duration::from_secs(5)).unwrap())
        .collect();
    server.join().unwrap();
    assert_eq!(
        4,
        requests
            .iter()
            .filter(|request| request.starts_with("POST /v1/mt5-vm/workers/snapshots "))
            .count()
    );
    assert_eq!(
        2,
        requests
            .iter()
            .filter(|request| request.starts_with("POST /v1/mt5-vm/workers/history "))
            .count()
    );
    let snapshot_bodies = requests
        .iter()
        .filter(|request| request.starts_with("POST /v1/mt5-vm/workers/snapshots "))
        .map(|request| request.split_once("\r\n\r\n").unwrap().1)
        .collect::<Vec<_>>();
    assert!(
        snapshot_bodies
            .iter()
            .any(|body| body.contains(r#""family":"account""#))
    );
    assert!(
        snapshot_bodies
            .iter()
            .any(|body| body.contains(r#""observedServer":"Broker-Demo""#))
    );
    assert!(requests[11].contains(r#""ack":"succeeded""#));
    assert!(requests[13].contains(r#""ack":"succeeded""#));
}

fn leaked_json_response(value: Value) -> &'static str {
    Box::leak(
        serde_json::to_string(&value)
            .expect("scripted response serializes")
            .into_boxed_str(),
    )
}

struct ScriptedParallelFailureDriver;

impl ManagedRuntimeDriver for ScriptedParallelFailureDriver {
    fn provision(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _credential: CredentialMaterial,
        _probe_symbol: &str,
        _ea_bootstrap: Option<EaBootstrapMaterial>,
    ) -> Result<(), &'static str> {
        Ok(())
    }

    fn heartbeat(&mut self, _account_id: &str, _lease_generation: u64) -> Result<(), &'static str> {
        Ok(())
    }

    fn stop(&mut self, _account_id: &str, _lease_generation: u64) -> Result<(), &'static str> {
        Ok(())
    }

    fn snapshot_sync(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _symbols: &[String],
    ) -> Result<Value, &'static str> {
        Ok(json!({}))
    }

    fn history_sync(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _from_ms: i64,
        _to_ms: i64,
    ) -> Result<Value, &'static str> {
        Ok(json!({}))
    }

    fn parallelism(&self) -> usize {
        2
    }

    fn execute_batch(
        &mut self,
        tasks: Vec<ManagedRuntimeTask>,
    ) -> Vec<Result<ManagedRuntimeOutput, &'static str>> {
        tasks
            .into_iter()
            .map(|task| match task {
                ManagedRuntimeTask::Provision { account_id, .. }
                    if account_id == "account-wrong-output" =>
                {
                    Ok(ManagedRuntimeOutput::Heartbeat)
                }
                ManagedRuntimeTask::Provision { .. } => Err("bad error"),
                _ => Err("unexpected task"),
            })
            .collect()
    }
}

struct LeaseFailureDriver;

impl ManagedRuntimeDriver for LeaseFailureDriver {
    fn provision(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _credential: CredentialMaterial,
        _probe_symbol: &str,
        _ea_bootstrap: Option<EaBootstrapMaterial>,
    ) -> Result<(), &'static str> {
        Ok(())
    }

    fn heartbeat(&mut self, _account_id: &str, _lease_generation: u64) -> Result<(), &'static str> {
        Ok(())
    }

    fn stop(&mut self, _account_id: &str, _lease_generation: u64) -> Result<(), &'static str> {
        Ok(())
    }

    fn snapshot_sync(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _symbols: &[String],
    ) -> Result<Value, &'static str> {
        Ok(json!({}))
    }

    fn history_sync(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _from_ms: i64,
        _to_ms: i64,
    ) -> Result<Value, &'static str> {
        Ok(json!({}))
    }

    fn parallelism(&self) -> usize {
        2
    }

    fn execute_batch(
        &mut self,
        tasks: Vec<ManagedRuntimeTask>,
    ) -> Vec<Result<ManagedRuntimeOutput, &'static str>> {
        if tasks
            .first()
            .is_some_and(|task| matches!(task, ManagedRuntimeTask::Heartbeat { .. }))
        {
            Vec::new()
        } else {
            tasks.into_iter().map(|_| Err("stop failed")).collect()
        }
    }
}

struct CountMismatchDriver;

impl ManagedRuntimeDriver for CountMismatchDriver {
    fn provision(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _credential: CredentialMaterial,
        _probe_symbol: &str,
        _ea_bootstrap: Option<EaBootstrapMaterial>,
    ) -> Result<(), &'static str> {
        Ok(())
    }

    fn heartbeat(&mut self, _account_id: &str, _lease_generation: u64) -> Result<(), &'static str> {
        Ok(())
    }

    fn stop(&mut self, _account_id: &str, _lease_generation: u64) -> Result<(), &'static str> {
        Ok(())
    }

    fn snapshot_sync(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _symbols: &[String],
    ) -> Result<Value, &'static str> {
        Ok(json!({}))
    }

    fn history_sync(
        &mut self,
        _account_id: &str,
        _lease_generation: u64,
        _from_ms: i64,
        _to_ms: i64,
    ) -> Result<Value, &'static str> {
        Ok(json!({}))
    }

    fn parallelism(&self) -> usize {
        2
    }

    fn execute_batch(
        &mut self,
        _tasks: Vec<ManagedRuntimeTask>,
    ) -> Vec<Result<ManagedRuntimeOutput, &'static str>> {
        Vec::new()
    }
}

#[test]
fn parallel_poll_fail_closed_branches_are_terminally_acked() {
    let poll = |commands: Vec<WorkerControlCommand>| {
        leaked_json_response(json!({
            "protocolVersion": 1,
            "serverTimeMs": 1_700_000_000_000_i64,
            "commands": commands
        }))
    };
    let ack = |command_id: &str, status: &str| {
        leaked_json_response(json!({
            "commandId": command_id,
            "status": status,
            "serverTimeMs": 1_700_000_000_000_i64
        }))
    };
    let stop_a = "10000000-0000-4000-8000-000000000001";
    let stop_b = "10000000-0000-4000-8000-000000000002";
    let invalid_provision = "10000000-0000-4000-8000-000000000003";
    let invalid_stop = "10000000-0000-4000-8000-000000000004";
    let missing_lease = "10000000-0000-4000-8000-000000000005";
    let terminal = "10000000-0000-4000-8000-000000000006";
    let invalid_ack = "10000000-0000-4000-8000-000000000007";
    let responses = vec![
        (
            "200 OK",
            r#"{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":7,"sessionToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","heartbeatIntervalMs":15000,"leaseTtlMs":45000,"serverTimeMs":1700000000000}"#,
        ),
        (
            "200 OK",
            poll(vec![
                command(WorkerCommandKind::StopAccount, stop_a, "{}", None),
                command(WorkerCommandKind::StopAccount, stop_b, "{}", None),
            ]),
        ),
        ("200 OK", ack(stop_a, "received")),
        ("200 OK", ack(stop_a, "succeeded")),
        ("200 OK", ack(stop_b, "received")),
        ("200 OK", ack(stop_b, "succeeded")),
        (
            "200 OK",
            poll(vec![command(
                WorkerCommandKind::ProvisionAccount,
                invalid_provision,
                r#"{"connectionRevision":0}"#,
                None,
            )]),
        ),
        ("200 OK", ack(invalid_provision, "received")),
        ("200 OK", ack(invalid_provision, "failed")),
        (
            "200 OK",
            poll(vec![command(
                WorkerCommandKind::StopAccount,
                invalid_stop,
                r#"{"unexpected":true}"#,
                None,
            )]),
        ),
        ("200 OK", ack(invalid_stop, "received")),
        ("200 OK", ack(invalid_stop, "failed")),
        (
            "200 OK",
            poll(vec![command(
                WorkerCommandKind::ReconcileAccount,
                missing_lease,
                "{}",
                None,
            )]),
        ),
        ("200 OK", ack(missing_lease, "received")),
        ("200 OK", ack(missing_lease, "failed")),
        (
            "200 OK",
            poll(vec![command(
                WorkerCommandKind::StopAccount,
                terminal,
                "{}",
                None,
            )]),
        ),
        ("200 OK", ack(terminal, "succeeded")),
        (
            "200 OK",
            poll(vec![command(
                WorkerCommandKind::StopAccount,
                invalid_ack,
                "{}",
                None,
            )]),
        ),
        ("200 OK", ack(invalid_ack, "unexpected")),
    ];
    let (base_url, captured, server) = serve_scripted(responses);
    let client = ManagedControlClient::new(
        base_url.clone(),
        base_url,
        SecretText::new("bootstrap-secret-0123456789abcdef0123456789".into()).unwrap(),
    )
    .unwrap();
    let session = client.hello(&hello_request()).unwrap();
    let runtime = SlotActorRuntimeDriver::new(vec![FakeDriver::default(), FakeDriver::default()])
        .expect("two actors");
    let mut worker = ManagedWorker::new(
        client,
        session,
        runtime,
        "EURUSD".into(),
        vec!["EURUSD".into()],
        7 * 24 * 60 * 60 * 1_000,
    )
    .unwrap();

    for _ in 0..5 {
        worker.poll_and_process().expect("scripted branch is acked");
    }
    assert_eq!(
        "MANAGED_WORKER_ACK_INVALID",
        worker.poll_and_process().unwrap_err().code()
    );

    for _ in 0..19 {
        captured.recv_timeout(Duration::from_secs(5)).unwrap();
    }
    server.join().expect("branch server joins");
}

#[test]
fn parallel_driver_output_and_error_codes_are_fenced() {
    let first = "20000000-0000-4000-8000-000000000001";
    let second = "20000000-0000-4000-8000-000000000002";
    let grant = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    let mut wrong = command(
        WorkerCommandKind::ProvisionAccount,
        first,
        r#"{"connectionRevision":1}"#,
        Some(grant),
    );
    wrong.account_id = "account-wrong-output".into();
    let mut invalid_error = command(
        WorkerCommandKind::ProvisionAccount,
        second,
        r#"{"connectionRevision":1}"#,
        Some(grant),
    );
    invalid_error.account_id = "account-invalid-error".into();
    let responses = vec![
        (
            "200 OK",
            r#"{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":7,"sessionToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","heartbeatIntervalMs":15000,"leaseTtlMs":45000,"serverTimeMs":1700000000000}"#,
        ),
        (
            "200 OK",
            leaked_json_response(json!({
                "protocolVersion": 1,
                "serverTimeMs": 1_700_000_000_000_i64,
                "commands": [wrong, invalid_error]
            })),
        ),
        (
            "200 OK",
            leaked_json_response(
                json!({"commandId": first, "status": "received", "serverTimeMs": 1}),
            ),
        ),
        (
            "200 OK",
            r#"{"login":"12345678","password":"one-use-password","server":"Broker-Demo"}"#,
        ),
        (
            "200 OK",
            leaked_json_response(
                json!({"commandId": second, "status": "received", "serverTimeMs": 1}),
            ),
        ),
        (
            "200 OK",
            r#"{"login":"12345678","password":"one-use-password","server":"Broker-Demo"}"#,
        ),
        (
            "200 OK",
            leaked_json_response(
                json!({"commandId": first, "status": "failed", "serverTimeMs": 1}),
            ),
        ),
        (
            "200 OK",
            leaked_json_response(
                json!({"commandId": second, "status": "failed", "serverTimeMs": 1}),
            ),
        ),
    ];
    let (base_url, captured, server) = serve_scripted(responses);
    let client = ManagedControlClient::new(
        base_url.clone(),
        base_url,
        SecretText::new("bootstrap-secret-0123456789abcdef0123456789".into()).unwrap(),
    )
    .unwrap();
    let session = client.hello(&hello_request()).unwrap();
    let mut worker = ManagedWorker::new(
        client,
        session,
        ScriptedParallelFailureDriver,
        "EURUSD".into(),
        vec!["EURUSD".into()],
        7 * 24 * 60 * 60 * 1_000,
    )
    .unwrap();
    worker
        .poll_and_process()
        .expect("both failures are terminally acked");

    let requests = (0..8)
        .map(|_| captured.recv_timeout(Duration::from_secs(5)).unwrap())
        .collect::<Vec<_>>();
    server.join().expect("failure server joins");
    assert!(requests[6].contains("MANAGED_WORKER_ACTOR_RESULT_INVALID"));
    assert!(requests[7].contains("MANAGED_WORKER_COMMAND_FAILED"));
}

#[test]
fn heartbeat_and_reenroll_fail_closed_on_invalid_parallel_results() {
    let provision_id = "30000000-0000-4000-8000-000000000001";
    let responses = vec![
        (
            "200 OK",
            r#"{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":7,"sessionToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","heartbeatIntervalMs":15000,"leaseTtlMs":45000,"serverTimeMs":1700000000000}"#,
        ),
        (
            "200 OK",
            leaked_json_response(
                json!({"commandId": provision_id, "status": "received", "serverTimeMs": 1}),
            ),
        ),
        (
            "200 OK",
            r#"{"login":"12345678","password":"one-use-password","server":"Broker-Demo"}"#,
        ),
        (
            "200 OK",
            leaked_json_response(
                json!({"commandId": provision_id, "status": "succeeded", "serverTimeMs": 1}),
            ),
        ),
    ];
    let (base_url, captured, server) = serve_scripted(responses);
    let client = ManagedControlClient::new(
        base_url.clone(),
        base_url,
        SecretText::new("bootstrap-secret-0123456789abcdef0123456789".into()).unwrap(),
    )
    .unwrap();
    let session = client.hello(&hello_request()).unwrap();
    let mut worker = ManagedWorker::new(
        client,
        session,
        LeaseFailureDriver,
        "EURUSD".into(),
        vec!["EURUSD".into()],
        7 * 24 * 60 * 60 * 1_000,
    )
    .unwrap();
    worker
        .process_command(command(
            WorkerCommandKind::ProvisionAccount,
            provision_id,
            r#"{"connectionRevision":1}"#,
            Some("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"),
        ))
        .expect("serial provision succeeds");
    assert_eq!(
        "MANAGED_WORKER_ACTOR_RESULT_INVALID",
        worker.control_heartbeat().unwrap_err().code()
    );
    assert_eq!(
        "stop failed",
        worker.reenroll(&hello_request()).unwrap_err().code()
    );

    for _ in 0..4 {
        captured.recv_timeout(Duration::from_secs(5)).unwrap();
    }
    server.join().expect("lease failure server joins");
}

#[test]
fn serial_poll_and_control_heartbeat_execute_the_active_lease() {
    let provision_id = "40000000-0000-4000-8000-000000000001";
    let stop_id = "40000000-0000-4000-8000-000000000002";
    let responses = vec![
        (
            "200 OK",
            r#"{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":7,"sessionToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","heartbeatIntervalMs":15000,"leaseTtlMs":45000,"serverTimeMs":1700000000000}"#,
        ),
        (
            "200 OK",
            leaked_json_response(
                json!({"commandId": provision_id, "status": "received", "serverTimeMs": 1}),
            ),
        ),
        (
            "200 OK",
            r#"{"login":"12345678","password":"one-use-password","server":"Broker-Demo"}"#,
        ),
        (
            "200 OK",
            leaked_json_response(
                json!({"commandId": provision_id, "status": "succeeded", "serverTimeMs": 1}),
            ),
        ),
        (
            "200 OK",
            r#"{"ok":true,"serverTimeMs":1,"nextHeartbeatInMs":15000,"leaseTtlMs":45000}"#,
        ),
        (
            "200 OK",
            leaked_json_response(json!({
                "protocolVersion": 1,
                "serverTimeMs": 1,
                "commands": [command(WorkerCommandKind::StopAccount, stop_id, "{}", None)]
            })),
        ),
        (
            "200 OK",
            leaked_json_response(
                json!({"commandId": stop_id, "status": "received", "serverTimeMs": 1}),
            ),
        ),
        (
            "200 OK",
            leaked_json_response(
                json!({"commandId": stop_id, "status": "succeeded", "serverTimeMs": 1}),
            ),
        ),
    ];
    let (base_url, captured, server) = serve_scripted(responses);
    let client = ManagedControlClient::new(
        base_url.clone(),
        base_url,
        SecretText::new("bootstrap-secret-0123456789abcdef0123456789".into()).unwrap(),
    )
    .unwrap();
    let session = client.hello(&hello_request()).unwrap();
    let mut worker = ManagedWorker::new(
        client,
        session,
        FakeDriver::default(),
        "EURUSD".into(),
        vec!["EURUSD".into()],
        7 * 24 * 60 * 60 * 1_000,
    )
    .unwrap();
    assert!(
        worker
            .process_command(command(
                WorkerCommandKind::ProvisionAccount,
                provision_id,
                r#"{"connectionRevision":1}"#,
                Some("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"),
            ))
            .expect("serial provision succeeds")
    );
    worker
        .control_heartbeat()
        .expect("serial heartbeat reports active lease");
    worker
        .poll_and_process()
        .expect("serial poll stops the active lease");
    assert_eq!(
        [
            "provision:account-01:3:EURUSD",
            "heartbeat",
            "stop:account-01:3"
        ],
        worker.driver().events.as_slice()
    );

    for _ in 0..8 {
        captured.recv_timeout(Duration::from_secs(5)).unwrap();
    }
    server.join().expect("serial server joins");
}

#[test]
fn malformed_commands_fail_before_runtime_or_secret_consumption() {
    let responses = vec![(
        "200 OK",
        r#"{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":7,"sessionToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","heartbeatIntervalMs":15000,"leaseTtlMs":45000,"serverTimeMs":1700000000000}"#,
    )];
    let (base_url, captured, server) = serve_scripted(responses);
    let client = ManagedControlClient::new(
        base_url.clone(),
        base_url,
        SecretText::new("bootstrap-secret-0123456789abcdef0123456789".into()).unwrap(),
    )
    .unwrap();
    let session = client.hello(&hello_request()).unwrap();
    let mut worker = ManagedWorker::new(
        client,
        session,
        FakeDriver::default(),
        "EURUSD".into(),
        vec!["EURUSD".into()],
        7 * 24 * 60 * 60 * 1_000,
    )
    .unwrap();

    let mut invalid_envelope = command(
        WorkerCommandKind::StopAccount,
        "50000000-0000-4000-8000-000000000001",
        "{}",
        None,
    );
    invalid_envelope.protocol_version = 2;
    assert_eq!(
        "MANAGED_WORKER_COMMAND_INVALID",
        worker.process_command(invalid_envelope).unwrap_err().code()
    );
    let invalid_json = command(
        WorkerCommandKind::StopAccount,
        "50000000-0000-4000-8000-000000000002",
        "not-json",
        None,
    );
    assert_eq!(
        "MANAGED_WORKER_COMMAND_INVALID",
        worker.process_command(invalid_json).unwrap_err().code()
    );
    let forbidden_secret = command(
        WorkerCommandKind::StopAccount,
        "50000000-0000-4000-8000-000000000003",
        r#"{"nested":{"password":"forbidden"}}"#,
        None,
    );
    assert_eq!(
        "MANAGED_WORKER_COMMAND_INVALID",
        worker.process_command(forbidden_secret).unwrap_err().code()
    );
    let oversized = command(
        WorkerCommandKind::StopAccount,
        "50000000-0000-4000-8000-000000000004",
        &format!(r#"{{"padding":"{}"}}"#, "x".repeat(2 * 1024 * 1024)),
        None,
    );
    assert_eq!(
        "MANAGED_WORKER_COMMAND_INVALID",
        worker.process_command(oversized).unwrap_err().code()
    );

    captured.recv_timeout(Duration::from_secs(5)).unwrap();
    server.join().expect("malformed server joins");
    assert!(worker.driver().events.is_empty());
}

#[test]
fn poll_parallel_runtime_provisions_reconciles_heartbeats_stops_and_reenrolls() {
    let provision_id = "11111111-1111-4111-8111-111111111111";
    let reconcile_id = "33333333-3333-4333-8333-333333333333";
    let stop_id = "44444444-4444-4444-8444-444444444444";
    let grant = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    let poll = |command: WorkerControlCommand| {
        leaked_json_response(json!({
            "protocolVersion": 1,
            "serverTimeMs": 1_700_000_000_000_i64,
            "commands": [command]
        }))
    };
    let terminal_ack = |command_id: &str, status: &str| {
        leaked_json_response(json!({
            "commandId": command_id,
            "status": status,
            "serverTimeMs": 1_700_000_000_000_i64
        }))
    };
    let responses = vec![
        (
            "200 OK",
            r#"{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":7,"sessionToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","heartbeatIntervalMs":15000,"leaseTtlMs":45000,"serverTimeMs":1700000000000}"#,
        ),
        (
            "200 OK",
            poll(command(
                WorkerCommandKind::ProvisionAccount,
                provision_id,
                r#"{"connectionRevision":1}"#,
                Some(grant),
            )),
        ),
        ("200 OK", terminal_ack(provision_id, "received")),
        (
            "200 OK",
            r#"{"login":"12345678","password":"one-use-password","server":"Broker-Demo"}"#,
        ),
        ("200 OK", terminal_ack(provision_id, "succeeded")),
        (
            "200 OK",
            r#"{"ok":true,"serverTimeMs":1700000000001,"nextHeartbeatInMs":15000,"leaseTtlMs":45000}"#,
        ),
        (
            "200 OK",
            poll(command(
                WorkerCommandKind::ReconcileAccount,
                reconcile_id,
                "{}",
                None,
            )),
        ),
        ("200 OK", terminal_ack(reconcile_id, "received")),
        ("200 OK", r#"{"accepted":true,"serverTimeMs":4}"#),
        ("200 OK", r#"{"accepted":true,"serverTimeMs":5}"#),
        ("200 OK", r#"{"accepted":true,"serverTimeMs":6}"#),
        ("200 OK", r#"{"accepted":true,"serverTimeMs":7}"#),
        ("200 OK", r#"{"accepted":true,"serverTimeMs":8}"#),
        ("200 OK", r#"{"accepted":true,"serverTimeMs":9}"#),
        ("200 OK", terminal_ack(reconcile_id, "succeeded")),
        (
            "200 OK",
            poll(command(WorkerCommandKind::StopAccount, stop_id, "{}", None)),
        ),
        ("200 OK", terminal_ack(stop_id, "received")),
        ("200 OK", terminal_ack(stop_id, "succeeded")),
        (
            "200 OK",
            r#"{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":8,"sessionToken":"fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210","heartbeatIntervalMs":15000,"leaseTtlMs":45000,"serverTimeMs":1700000000001}"#,
        ),
    ];
    let (base_url, captured, server) = serve_scripted(responses);
    let client = ManagedControlClient::new(
        base_url.clone(),
        base_url,
        SecretText::new("bootstrap-secret-0123456789abcdef0123456789".into()).unwrap(),
    )
    .unwrap();
    let session = client.hello(&hello_request()).unwrap();
    let runtime = SlotActorRuntimeDriver::new(vec![FakeDriver::default(), FakeDriver::default()])
        .expect("two attested slot actors");
    let mut worker = ManagedWorker::new(
        client,
        session,
        runtime,
        "EURUSD".into(),
        vec!["EURUSD".into()],
        7 * 24 * 60 * 60 * 1_000,
    )
    .expect("parallel managed worker builds");

    worker
        .poll_and_process()
        .expect("parallel poll provisions the account");
    worker
        .control_heartbeat()
        .expect("parallel heartbeat reports the active lease");
    worker
        .poll_and_process()
        .expect("parallel poll publishes all reconciliation families");
    worker
        .poll_and_process()
        .expect("parallel poll stops and releases the account");
    worker
        .reenroll(&hello_request())
        .expect("parallel runtime reenrolls after every lease was released");

    let requests: Vec<String> = (0..19)
        .map(|_| captured.recv_timeout(Duration::from_secs(5)).unwrap())
        .collect();
    server.join().expect("parallel scripted server exits");
    assert_eq!(
        3,
        requests
            .iter()
            .filter(|request| request.starts_with("POST /v1/mt5-vm/workers/poll "))
            .count()
    );
    assert_eq!(
        4,
        requests
            .iter()
            .filter(|request| request.starts_with("POST /v1/mt5-vm/workers/snapshots "))
            .count()
    );
    assert_eq!(
        2,
        requests
            .iter()
            .filter(|request| request.starts_with("POST /v1/mt5-vm/workers/history "))
            .count()
    );
    assert_eq!(
        2,
        requests
            .iter()
            .filter(|request| request.starts_with("POST /v1/mt5-vm/workers/hello "))
            .count()
    );
    let grant_requests = requests
        .iter()
        .filter(|request| request.contains(grant))
        .collect::<Vec<_>>();
    assert_eq!(1, grant_requests.len());
    assert!(
        grant_requests[0]
            .starts_with("POST /api/v1/execution-workers/mt5/credential-grants/consume ")
    );
    assert!(requests.iter().any(|request| {
        request.contains(r#""accountId":"account-01""#) && request.contains(r#""ack":"succeeded""#)
    }));
}

#[test]
fn parallel_command_validation_and_received_ack_fail_closed_before_runtime() {
    let mut invalid_envelope = command(
        WorkerCommandKind::StopAccount,
        "61000000-0000-4000-8000-000000000001",
        "{}",
        None,
    );
    invalid_envelope.protocol_version = 2;
    let oversized = command(
        WorkerCommandKind::StopAccount,
        "61000000-0000-4000-8000-000000000002",
        &format!(r#"{{"padding":"{}"}}"#, "x".repeat(2 * 1024 * 1024)),
        None,
    );
    let not_an_object = command(
        WorkerCommandKind::StopAccount,
        "61000000-0000-4000-8000-000000000003",
        "[]",
        None,
    );
    let forbidden_secret = command(
        WorkerCommandKind::StopAccount,
        "61000000-0000-4000-8000-000000000004",
        r#"{"nested":{"password":"forbidden"}}"#,
        None,
    );

    for (malformed, expected_code) in [
        (invalid_envelope, "MANAGED_WORKER_POLL_INVALID"),
        (oversized, "MANAGED_WORKER_POLL_INVALID"),
        (not_an_object, "MANAGED_WORKER_COMMAND_INVALID"),
        (forbidden_secret, "MANAGED_WORKER_COMMAND_INVALID"),
    ] {
        let responses = vec![
            ("200 OK", hello_response()),
            ("200 OK", poll_response(vec![malformed])),
        ];
        let (base_url, captured, server) = serve_scripted(responses);
        let client = managed_client(&base_url);
        let session = client.hello(&hello_request()).unwrap();
        let runtime =
            SlotActorRuntimeDriver::new(vec![FakeDriver::default(), FakeDriver::default()])
                .unwrap();
        let mut worker = ManagedWorker::new(
            client,
            session,
            runtime,
            "EURUSD".into(),
            vec!["EURUSD".into()],
            60_000,
        )
        .unwrap();
        assert_eq!(expected_code, worker.poll_and_process().unwrap_err().code());
        for _ in 0..2 {
            captured.recv_timeout(Duration::from_secs(5)).unwrap();
        }
        server.join().unwrap();
    }

    let command_id = "61000000-0000-4000-8000-000000000005";
    let responses = vec![
        ("200 OK", hello_response()),
        (
            "200 OK",
            poll_response(vec![command(
                WorkerCommandKind::StopAccount,
                command_id,
                "{}",
                None,
            )]),
        ),
        ("500 Internal Server Error", r#"{"code":"synthetic"}"#),
    ];
    let (base_url, captured, server) = serve_scripted(responses);
    let client = managed_client(&base_url);
    let session = client.hello(&hello_request()).unwrap();
    let runtime =
        SlotActorRuntimeDriver::new(vec![FakeDriver::default(), FakeDriver::default()]).unwrap();
    let mut worker = ManagedWorker::new(
        client,
        session,
        runtime,
        "EURUSD".into(),
        vec!["EURUSD".into()],
        60_000,
    )
    .unwrap();
    assert_eq!(
        "MANAGED_WORKER_SESSION_REQUEST_REJECTED",
        worker.poll_and_process().unwrap_err().code()
    );
    for _ in 0..3 {
        captured.recv_timeout(Duration::from_secs(5)).unwrap();
    }
    server.join().unwrap();
}

#[test]
fn parallel_batch_and_reenroll_reject_result_count_mismatches() {
    let command_id = "62000000-0000-4000-8000-000000000001";
    let grant = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    let responses = vec![
        ("200 OK", hello_response()),
        (
            "200 OK",
            poll_response(vec![command(
                WorkerCommandKind::ProvisionAccount,
                command_id,
                r#"{"connectionRevision":1}"#,
                Some(grant),
            )]),
        ),
        ("200 OK", ack_response(command_id, "received")),
        (
            "200 OK",
            r#"{"login":"12345678","password":"one-use-password","server":"Broker-Demo"}"#,
        ),
    ];
    let (base_url, captured, server) = serve_scripted(responses);
    let client = managed_client(&base_url);
    let session = client.hello(&hello_request()).unwrap();
    let mut worker = ManagedWorker::new(
        client,
        session,
        CountMismatchDriver,
        "EURUSD".into(),
        vec!["EURUSD".into()],
        60_000,
    )
    .unwrap();
    assert_eq!(
        "MANAGED_WORKER_ACTOR_RESULT_INVALID",
        worker.poll_and_process().unwrap_err().code()
    );
    for _ in 0..4 {
        captured.recv_timeout(Duration::from_secs(5)).unwrap();
    }
    server.join().unwrap();

    let responses = vec![
        ("200 OK", hello_response()),
        ("200 OK", ack_response(command_id, "received")),
        (
            "200 OK",
            r#"{"login":"12345678","password":"one-use-password","server":"Broker-Demo"}"#,
        ),
        ("200 OK", ack_response(command_id, "succeeded")),
    ];
    let (base_url, captured, server) = serve_scripted(responses);
    let client = managed_client(&base_url);
    let session = client.hello(&hello_request()).unwrap();
    let mut worker = ManagedWorker::new(
        client,
        session,
        CountMismatchDriver,
        "EURUSD".into(),
        vec!["EURUSD".into()],
        60_000,
    )
    .unwrap();
    worker
        .process_command(command(
            WorkerCommandKind::ProvisionAccount,
            command_id,
            r#"{"connectionRevision":1}"#,
            Some(grant),
        ))
        .expect("serial setup provision succeeds");
    assert_eq!(
        "MANAGED_WORKER_ACTOR_RESULT_INVALID",
        worker.reenroll(&hello_request()).unwrap_err().code()
    );
    for _ in 0..4 {
        captured.recv_timeout(Duration::from_secs(5)).unwrap();
    }
    server.join().unwrap();
}

#[test]
fn parallel_bare_metal_provision_and_lease_branches_are_fenced() {
    let grant = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    let ea_token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    let provision_id = "63000000-0000-4000-8000-000000000001";
    let duplicate_id = "63000000-0000-4000-8000-000000000002";
    let conflicting_id = "63000000-0000-4000-8000-000000000003";
    let stale_stop_id = "63000000-0000-4000-8000-000000000004";
    let invalid_reconcile_id = "63000000-0000-4000-8000-000000000005";
    let mut conflicting = command_with_bootstrap(
        WorkerCommandKind::ProvisionAccount,
        conflicting_id,
        r#"{"connectionRevision":1}"#,
        Some(grant),
        Some(ea_token),
    );
    conflicting.lease_generation = 4;
    let mut stale_stop = command(WorkerCommandKind::StopAccount, stale_stop_id, "{}", None);
    stale_stop.lease_generation = 4;
    let responses = vec![
        ("200 OK", hello_response()),
        (
            "200 OK",
            poll_response(vec![command_with_bootstrap(
                WorkerCommandKind::ProvisionAccount,
                provision_id,
                r#"{"connectionRevision":1}"#,
                Some(grant),
                Some(ea_token),
            )]),
        ),
        ("200 OK", ack_response(provision_id, "received")),
        (
            "200 OK",
            r#"{"login":"12345678","password":"one-use-password","server":"Broker-Demo"}"#,
        ),
        ("200 OK", ack_response(provision_id, "succeeded")),
        (
            "200 OK",
            poll_response(vec![command_with_bootstrap(
                WorkerCommandKind::ProvisionAccount,
                duplicate_id,
                r#"{"connectionRevision":1}"#,
                Some(grant),
                Some(ea_token),
            )]),
        ),
        ("200 OK", ack_response(duplicate_id, "received")),
        ("200 OK", ack_response(duplicate_id, "succeeded")),
        ("200 OK", poll_response(vec![conflicting])),
        ("200 OK", ack_response(conflicting_id, "received")),
        ("200 OK", ack_response(conflicting_id, "failed")),
        ("200 OK", poll_response(vec![stale_stop])),
        ("200 OK", ack_response(stale_stop_id, "received")),
        ("200 OK", ack_response(stale_stop_id, "failed")),
        (
            "200 OK",
            poll_response(vec![command(
                WorkerCommandKind::ReconcileAccount,
                invalid_reconcile_id,
                r#"{"unexpected":true}"#,
                None,
            )]),
        ),
        ("200 OK", ack_response(invalid_reconcile_id, "received")),
        ("200 OK", ack_response(invalid_reconcile_id, "failed")),
    ];
    let (base_url, captured, server) = serve_scripted(responses);
    let client = managed_client(&base_url);
    let session = client.hello(&hello_request()).unwrap();
    let runtime =
        SlotActorRuntimeDriver::new(vec![FakeDriver::default(), FakeDriver::default()]).unwrap();
    let mut worker = ManagedWorker::new_with_substrate(
        client,
        session,
        runtime,
        "EURUSD".into(),
        vec!["EURUSD".into()],
        60_000,
        "bare_metal",
    )
    .unwrap();
    for _ in 0..5 {
        worker
            .poll_and_process()
            .expect("each branch is terminally acknowledged");
    }
    let requests = (0..17)
        .map(|_| captured.recv_timeout(Duration::from_secs(5)).unwrap())
        .collect::<Vec<_>>();
    server.join().unwrap();
    assert!(requests[4].contains(r#""ack":"succeeded""#));
    assert!(requests[7].contains("already_running"));
    assert!(requests[10].contains("MANAGED_WORKER_LEASE_CONFLICT"));
    assert!(requests[13].contains("MANAGED_WORKER_LEASE_FENCED"));
    assert!(requests[16].contains("MANAGED_WORKER_RECONCILE_PAYLOAD_INVALID"));
}

#[test]
fn parallel_provision_fail_closed_inputs_are_terminally_acked() {
    let valid_grant = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    let valid_ea = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    let invalid_ea = "g".repeat(64);
    let cases = [
        (
            "windows_vm",
            Some(valid_ea),
            Some(valid_grant),
            false,
            "MANAGED_WORKER_EA_BOOTSTRAP_TOKEN_UNEXPECTED",
        ),
        (
            "windows_vm",
            Some("short"),
            Some(valid_grant),
            false,
            "MANAGED_WORKER_SECRET_INVALID",
        ),
        (
            "bare_metal",
            None,
            Some(valid_grant),
            false,
            "MANAGED_WORKER_EA_BOOTSTRAP_TOKEN_MISSING",
        ),
        (
            "bare_metal",
            Some(invalid_ea.as_str()),
            Some(valid_grant),
            false,
            "MANAGED_WORKER_EA_BOOTSTRAP_TOKEN_INVALID",
        ),
        (
            "windows_vm",
            None,
            None,
            false,
            "MANAGED_WORKER_CREDENTIAL_GRANT_MISSING",
        ),
        (
            "windows_vm",
            None,
            Some(valid_grant),
            true,
            "MANAGED_WORKER_CREDENTIAL_GRANT_REJECTED",
        ),
    ];

    for (index, (substrate, ea_token, grant, reject_credential, expected_code)) in
        cases.into_iter().enumerate()
    {
        let command_id = format!("64000000-0000-4000-8000-{index:012}");
        let mut responses = vec![
            ("200 OK", hello_response()),
            (
                "200 OK",
                poll_response(vec![command_with_bootstrap(
                    WorkerCommandKind::ProvisionAccount,
                    &command_id,
                    r#"{"connectionRevision":1}"#,
                    grant,
                    ea_token,
                )]),
            ),
            ("200 OK", ack_response(&command_id, "received")),
        ];
        if reject_credential {
            responses.push(("500 Internal Server Error", r#"{"code":"synthetic"}"#));
        }
        responses.push(("200 OK", ack_response(&command_id, "failed")));
        let request_count = responses.len();
        let (base_url, captured, server) = serve_scripted(responses);
        let client = managed_client(&base_url);
        let session = client.hello(&hello_request()).unwrap();
        let runtime =
            SlotActorRuntimeDriver::new(vec![FakeDriver::default(), FakeDriver::default()])
                .unwrap();
        let mut worker = ManagedWorker::new_with_substrate(
            client,
            session,
            runtime,
            "EURUSD".into(),
            vec!["EURUSD".into()],
            60_000,
            substrate,
        )
        .unwrap();
        worker
            .poll_and_process()
            .expect("fail-closed preparation error is terminally acknowledged");
        let requests = (0..request_count)
            .map(|_| captured.recv_timeout(Duration::from_secs(5)).unwrap())
            .collect::<Vec<_>>();
        server.join().unwrap();
        assert!(requests.last().unwrap().contains(expected_code));
    }
}

#[test]
fn serial_bare_metal_bootstrap_and_unexpected_token_paths_are_fenced() {
    let grant = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    let ea_token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    let command_id = "65000000-0000-4000-8000-000000000001";
    let responses = vec![
        ("200 OK", hello_response()),
        ("200 OK", ack_response(command_id, "received")),
        (
            "200 OK",
            r#"{"login":"12345678","password":"one-use-password","server":"Broker-Demo"}"#,
        ),
        ("200 OK", ack_response(command_id, "succeeded")),
    ];
    let (base_url, captured, server) = serve_scripted(responses);
    let client = managed_client(&base_url);
    let session = client.hello(&hello_request()).unwrap();
    let mut worker = ManagedWorker::new_with_substrate(
        client,
        session,
        FakeDriver::default(),
        "EURUSD".into(),
        vec!["EURUSD".into()],
        60_000,
        "bare_metal",
    )
    .unwrap();
    assert!(
        worker
            .process_command(command_with_bootstrap(
                WorkerCommandKind::ProvisionAccount,
                command_id,
                r#"{"connectionRevision":1}"#,
                Some(grant),
                Some(ea_token),
            ))
            .expect("serial bare-metal provision succeeds")
    );
    assert_eq!(worker.driver().ea_bootstrap_received, vec![true]);
    for _ in 0..4 {
        captured.recv_timeout(Duration::from_secs(5)).unwrap();
    }
    server.join().unwrap();

    for (index, ea_token, substrate, expected_code) in [
        (
            2,
            Some(ea_token),
            "windows_vm",
            "MANAGED_WORKER_EA_BOOTSTRAP_TOKEN_UNEXPECTED",
        ),
        (
            3,
            Some("short"),
            "windows_vm",
            "MANAGED_WORKER_SECRET_INVALID",
        ),
        (
            4,
            None,
            "bare_metal",
            "MANAGED_WORKER_EA_BOOTSTRAP_TOKEN_MISSING",
        ),
    ] {
        let command_id = format!("65000000-0000-4000-8000-{index:012}");
        let responses = vec![
            ("200 OK", hello_response()),
            ("200 OK", ack_response(&command_id, "received")),
            ("200 OK", ack_response(&command_id, "failed")),
        ];
        let (base_url, captured, server) = serve_scripted(responses);
        let client = managed_client(&base_url);
        let session = client.hello(&hello_request()).unwrap();
        let mut worker = ManagedWorker::new_with_substrate(
            client,
            session,
            FakeDriver::default(),
            "EURUSD".into(),
            vec!["EURUSD".into()],
            60_000,
            substrate,
        )
        .unwrap();
        assert!(
            !worker
                .process_command(command_with_bootstrap(
                    WorkerCommandKind::ProvisionAccount,
                    &command_id,
                    r#"{"connectionRevision":1}"#,
                    Some(grant),
                    ea_token,
                ))
                .expect("serial fail-closed outcome is terminally acknowledged")
        );
        let requests = (0..3)
            .map(|_| captured.recv_timeout(Duration::from_secs(5)).unwrap())
            .collect::<Vec<_>>();
        server.join().unwrap();
        assert!(requests[2].contains(expected_code));
    }
}

#[test]
fn parallel_terminal_ack_status_and_transport_failures_are_fenced() {
    for (index, failure_outcome, response_status, terminal_status) in [
        (1, false, "200 OK", "failed"),
        (2, false, "500 Internal Server Error", "ignored"),
        (3, true, "200 OK", "succeeded"),
        (4, true, "500 Internal Server Error", "ignored"),
    ] {
        let command_id = format!("66000000-0000-4000-8000-{index:012}");
        let command = if failure_outcome {
            command_with_bootstrap(
                WorkerCommandKind::ProvisionAccount,
                &command_id,
                r#"{"connectionRevision":1}"#,
                Some("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"),
                Some("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
            )
        } else {
            command(WorkerCommandKind::StopAccount, &command_id, "{}", None)
        };
        let terminal_body = if response_status == "200 OK" {
            ack_response(&command_id, terminal_status)
        } else {
            r#"{"code":"synthetic"}"#
        };
        let responses = vec![
            ("200 OK", hello_response()),
            ("200 OK", poll_response(vec![command])),
            ("200 OK", ack_response(&command_id, "received")),
            (response_status, terminal_body),
        ];
        let (base_url, captured, server) = serve_scripted(responses);
        let client = managed_client(&base_url);
        let session = client.hello(&hello_request()).unwrap();
        let runtime =
            SlotActorRuntimeDriver::new(vec![FakeDriver::default(), FakeDriver::default()])
                .unwrap();
        let mut worker = ManagedWorker::new(
            client,
            session,
            runtime,
            "EURUSD".into(),
            vec!["EURUSD".into()],
            60_000,
        )
        .unwrap();
        let expected_code = if response_status == "200 OK" {
            "MANAGED_WORKER_ACK_INVALID"
        } else {
            "MANAGED_WORKER_SESSION_REQUEST_REJECTED"
        };
        assert_eq!(expected_code, worker.poll_and_process().unwrap_err().code());
        for _ in 0..4 {
            captured.recv_timeout(Duration::from_secs(5)).unwrap();
        }
        server.join().unwrap();
    }
}

#[test]
fn parallel_snapshot_and_history_transport_failures_become_failed_acks() {
    let grant = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    for (index, fail_history) in [(1, false), (2, true)] {
        let provision_id = format!("67000000-0000-4000-8000-{index:012}");
        let reconcile_id = format!("67100000-0000-4000-8000-{index:012}");
        let mut responses = vec![
            ("200 OK", hello_response()),
            ("200 OK", ack_response(&provision_id, "received")),
            (
                "200 OK",
                r#"{"login":"12345678","password":"one-use-password","server":"Broker-Demo"}"#,
            ),
            ("200 OK", ack_response(&provision_id, "succeeded")),
            (
                "200 OK",
                poll_response(vec![command(
                    WorkerCommandKind::ReconcileAccount,
                    &reconcile_id,
                    "{}",
                    None,
                )]),
            ),
            ("200 OK", ack_response(&reconcile_id, "received")),
        ];
        if fail_history {
            for _ in 0..4 {
                responses.push(("200 OK", r#"{"accepted":true,"serverTimeMs":1}"#));
            }
        }
        responses.push(("500 Internal Server Error", r#"{"code":"synthetic"}"#));
        responses.push(("200 OK", ack_response(&reconcile_id, "failed")));
        let request_count = responses.len();
        let (base_url, captured, server) = serve_scripted(responses);
        let client = managed_client(&base_url);
        let session = client.hello(&hello_request()).unwrap();
        let runtime =
            SlotActorRuntimeDriver::new(vec![FakeDriver::default(), FakeDriver::default()])
                .unwrap();
        let mut worker = ManagedWorker::new(
            client,
            session,
            runtime,
            "EURUSD".into(),
            vec!["EURUSD".into()],
            60_000,
        )
        .unwrap();
        worker
            .process_command(command(
                WorkerCommandKind::ProvisionAccount,
                &provision_id,
                r#"{"connectionRevision":1}"#,
                Some(grant),
            ))
            .expect("serial setup provision succeeds");
        worker
            .poll_and_process()
            .expect("sync transport failure is terminally acknowledged");
        let requests = (0..request_count)
            .map(|_| captured.recv_timeout(Duration::from_secs(5)).unwrap())
            .collect::<Vec<_>>();
        server.join().unwrap();
        assert!(requests.last().unwrap().contains(r#""ack":"failed""#));
    }
}

#[test]
fn session_rotation_stops_old_runtime_before_accepting_new_generation() {
    let responses = vec![
        (
            "200 OK",
            r#"{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":7,"sessionToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","heartbeatIntervalMs":15000,"leaseTtlMs":45000,"serverTimeMs":1700000000000}"#,
        ),
        (
            "200 OK",
            r#"{"commandId":"11111111-1111-4111-8111-111111111111","status":"received","serverTimeMs":1}"#,
        ),
        (
            "200 OK",
            r#"{"login":"12345678","password":"one-use-password","server":"Broker-Demo"}"#,
        ),
        (
            "200 OK",
            r#"{"commandId":"11111111-1111-4111-8111-111111111111","status":"succeeded","serverTimeMs":2}"#,
        ),
        (
            "200 OK",
            r#"{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":8,"sessionToken":"fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210","heartbeatIntervalMs":15000,"leaseTtlMs":45000,"serverTimeMs":1700000000001}"#,
        ),
    ];
    let (base_url, captured, server) = serve_scripted(responses);
    let client = ManagedControlClient::new(
        base_url.clone(),
        base_url,
        SecretText::new("bootstrap-secret-0123456789abcdef0123456789".into()).unwrap(),
    )
    .unwrap();
    let session = client.hello(&hello_request()).unwrap();
    let mut worker = ManagedWorker::new(
        client,
        session,
        FakeDriver::default(),
        "EURUSD".into(),
        vec!["EURUSD".into()],
        7 * 24 * 60 * 60 * 1_000,
    )
    .unwrap();
    assert!(
        worker
            .process_command(command(
                WorkerCommandKind::ProvisionAccount,
                "11111111-1111-4111-8111-111111111111",
                r#"{"connectionRevision":1}"#,
                Some("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"),
            ))
            .unwrap()
    );
    worker
        .reenroll(&hello_request())
        .expect("new session generation enrolls");
    assert_eq!(
        ["provision:account-01:3:EURUSD", "stop:account-01:3"],
        worker.driver().events.as_slice()
    );

    for _ in 0..5 {
        captured.recv_timeout(Duration::from_secs(5)).unwrap();
    }
    server.join().unwrap();
}
