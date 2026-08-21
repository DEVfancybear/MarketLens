use std::collections::BTreeSet;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use execution_domain::mt5_vm_control::{
    WorkerCommandKind, WorkerControlCommand, WorkerHelloRequest,
};
use mt5_vm_agent::managed::{
    ManagedControlClient, ManagedRuntimeDriver, ManagedWorker, SecretText,
};
use mt5_vm_agent::worker::CredentialMaterial;
use reqwest::Url;
use serde_json::{Value, json};

#[derive(Default)]
struct FakeDriver {
    events: Vec<String>,
}

impl ManagedRuntimeDriver for FakeDriver {
    fn provision(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        credential: CredentialMaterial,
        probe_symbol: &str,
    ) -> Result<(), &'static str> {
        assert_eq!("12345678", credential.login());
        assert_eq!("Broker-Demo", credential.server());
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
