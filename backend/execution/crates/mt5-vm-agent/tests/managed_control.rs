use std::collections::BTreeSet;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use execution_domain::mt5_vm_control::{
    WorkerCommandAckKind, WorkerCommandAckRequest, WorkerHeartbeatRequest, WorkerHelloRequest,
    WorkerLeaseClaim, WorkerPollRequest,
};
use mt5_vm_agent::managed::{ManagedControlClient, SecretText};
use reqwest::Url;
use serde_json::json;

fn serve_hello() -> (Url, mpsc::Receiver<String>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("loopback listener binds");
    let address = listener.local_addr().expect("listener address");
    listener
        .set_nonblocking(true)
        .expect("listener is nonblocking");
    let (sender, receiver) = mpsc::channel();
    let handle = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(Instant::now() < deadline, "hello connection timed out");
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("hello connection failed: {error}"),
            }
        };
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("read timeout set");
        let mut request = Vec::new();
        let mut buffer = [0_u8; 4096];
        loop {
            let count = stream.read(&mut buffer).expect("request bytes read");
            if count == 0 {
                break;
            }
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
        let captured = String::from_utf8(request).expect("request is UTF-8");
        sender.send(captured).expect("captured request sent");
        let body = r#"{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":7,"sessionToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","heartbeatIntervalMs":15000,"leaseTtlMs":45000,"serverTimeMs":1700000000000}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .expect("hello response written");
        stream.flush().expect("hello response flushed");
    });
    (
        Url::parse(&format!("http://{address}/")).expect("loopback URL parses"),
        receiver,
        handle,
    )
}

fn serve_scripted(
    responses: Vec<(&'static str, &'static str)>,
) -> (Url, mpsc::Receiver<String>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("loopback listener binds");
    let address = listener.local_addr().expect("listener address");
    listener
        .set_nonblocking(true)
        .expect("listener is nonblocking");
    let (sender, receiver) = mpsc::channel();
    let handle = thread::spawn(move || {
        for (status, body) in responses {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(Instant::now() < deadline, "scripted connection timed out");
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("scripted connection failed: {error}"),
                }
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("read timeout set");
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            loop {
                let count = stream.read(&mut buffer).expect("request bytes read");
                if count == 0 {
                    break;
                }
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
            sender
                .send(String::from_utf8(request).expect("request is UTF-8"))
                .expect("captured request sent");
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .expect("scripted response written");
            stream.flush().expect("scripted response flushed");
        }
    });
    (
        Url::parse(&format!("http://{address}/")).expect("loopback URL parses"),
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
fn hello_uses_bootstrap_header_and_redacts_returned_session_token() {
    let bootstrap = "bootstrap-secret-0123456789abcdef0123456789";
    let session = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    let (base_url, captured, server) = serve_hello();
    let client = ManagedControlClient::new(
        base_url.clone(),
        base_url,
        SecretText::new(bootstrap.to_owned()).expect("bootstrap secret is valid"),
    )
    .expect("control client builds");
    let response = client.hello(&hello_request()).expect("hello succeeds");

    assert_eq!("worker-01", response.worker_id);
    assert_eq!(7, response.session_generation);
    let debug = format!("{response:?}");
    assert!(!debug.contains(session));
    assert!(!debug.contains(bootstrap));
    assert!(debug.contains("[REDACTED]"));

    let request = captured
        .recv_timeout(Duration::from_secs(5))
        .expect("hello request captured");
    server.join().expect("hello server exits");
    let request_lower = request.to_ascii_lowercase();
    assert!(request.starts_with("POST /v1/mt5-vm/workers/hello HTTP/1.1\r\n"));
    assert!(request_lower.contains(&format!(
        "x-mt5-vm-bootstrap-token: {}",
        bootstrap.to_ascii_lowercase()
    )));
    assert!(!request_lower.contains("authorization:"));
    assert!(request.contains(r#""workerId":"worker-01""#));
    assert!(!request[request.find("\r\n\r\n").unwrap() + 4..].contains(bootstrap));
}

#[test]
fn session_calls_use_bearer_auth_and_stable_wire_contract() {
    let session_token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    let hello_body = format!(
        r#"{{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":7,"sessionToken":"{session_token}","heartbeatIntervalMs":15000,"leaseTtlMs":45000,"serverTimeMs":1700000000000}}"#
    );
    let responses = vec![
        (
            "200 OK",
            Box::leak(hello_body.into_boxed_str()) as &'static str,
        ),
        (
            "200 OK",
            r#"{"ok":true,"serverTimeMs":1700000000001,"nextHeartbeatInMs":15000,"leaseTtlMs":45000}"#,
        ),
        (
            "200 OK",
            r#"{"protocolVersion":1,"serverTimeMs":1700000000002,"commands":[]}"#,
        ),
        (
            "200 OK",
            r#"{"commandId":"command-01","status":"succeeded","serverTimeMs":1700000000003}"#,
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
    client
        .heartbeat(
            &session,
            &WorkerHeartbeatRequest {
                protocol_version: 1,
                worker_id: "worker-01".into(),
                session_generation: 7,
                leases: vec![WorkerLeaseClaim {
                    account_id: "account-01".into(),
                    lease_generation: 3,
                }],
            },
        )
        .unwrap();
    client
        .poll(
            &session,
            &WorkerPollRequest {
                protocol_version: 1,
                worker_id: "worker-01".into(),
                session_generation: 7,
                max_commands: Some(4),
            },
        )
        .unwrap();
    client
        .ack(
            &session,
            &WorkerCommandAckRequest {
                protocol_version: 1,
                worker_id: "worker-01".into(),
                session_generation: 7,
                account_id: "account-01".into(),
                lease_generation: 3,
                command_id: "command-01".into(),
                ack: WorkerCommandAckKind::Succeeded,
                result_json: Some(r#"{"status":"ready"}"#.into()),
                error_code: None,
            },
        )
        .unwrap();

    let requests: Vec<String> = (0..4)
        .map(|_| captured.recv_timeout(Duration::from_secs(5)).unwrap())
        .collect();
    server.join().expect("scripted server exits");
    for request in &requests[1..] {
        let lower = request.to_ascii_lowercase();
        assert!(lower.contains(&format!("authorization: bearer {session_token}")));
        assert!(!request.contains("bootstrap-secret"));
    }
    assert!(requests[1].starts_with("POST /v1/mt5-vm/workers/heartbeat HTTP/1.1\r\n"));
    assert!(requests[2].starts_with("POST /v1/mt5-vm/workers/poll HTTP/1.1\r\n"));
    assert!(requests[3].starts_with("POST /v1/mt5-vm/workers/ack HTTP/1.1\r\n"));
    assert!(requests[1].contains(r#""leaseGeneration":3"#));
    assert!(requests[2].contains(r#""maxCommands":4"#));
    assert!(requests[3].contains(r#""ack":"succeeded""#));
}

#[test]
fn stale_session_is_fenced_without_returning_gateway_body() {
    let sensitive_body = "stale session abcdef0123456789";
    let responses = vec![
        (
            "200 OK",
            r#"{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":7,"sessionToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","heartbeatIntervalMs":15000,"leaseTtlMs":45000,"serverTimeMs":1700000000000}"#,
        ),
        ("401 Unauthorized", sensitive_body),
    ];
    let (base_url, captured, server) = serve_scripted(responses);
    let client = ManagedControlClient::new(
        base_url.clone(),
        base_url,
        SecretText::new("bootstrap-secret-0123456789abcdef0123456789".into()).unwrap(),
    )
    .unwrap();
    let session = client.hello(&hello_request()).unwrap();
    let error = client
        .heartbeat(
            &session,
            &WorkerHeartbeatRequest {
                protocol_version: 1,
                worker_id: "worker-01".into(),
                session_generation: 7,
                leases: vec![],
            },
        )
        .expect_err("stale session is rejected");
    assert_eq!("MANAGED_WORKER_SESSION_FENCED", error.code());
    assert!(!format!("{error:?}").contains(sensitive_body));
    for _ in 0..2 {
        captured.recv_timeout(Duration::from_secs(5)).unwrap();
    }
    server.join().expect("scripted server exits");
}

#[test]
fn credential_grant_uses_private_go_route_and_returns_redacted_material() {
    let grant_token = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    let responses = vec![
        (
            "200 OK",
            r#"{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":7,"sessionToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","heartbeatIntervalMs":15000,"leaseTtlMs":45000,"serverTimeMs":1700000000000}"#,
        ),
        (
            "200 OK",
            r#"{"login":"12345678","password":"one-use-password","server":"Broker-Demo"}"#,
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
    let credential = client
        .consume_credential_grant(
            &session,
            "account-01",
            3,
            "11111111-1111-4111-8111-111111111111",
            SecretText::new(grant_token.into()).unwrap(),
        )
        .expect("one-time credential grant is consumed");
    assert_eq!("12345678", credential.login());
    assert_eq!("Broker-Demo", credential.server());
    let debug = format!("{credential:?}");
    assert!(debug.contains("[REDACTED]"));
    assert!(!debug.contains("12345678"));
    assert!(!debug.contains("one-use-password"));
    assert!(!debug.contains("Broker-Demo"));

    captured.recv_timeout(Duration::from_secs(5)).unwrap();
    let consume = captured.recv_timeout(Duration::from_secs(5)).unwrap();
    server.join().expect("scripted server exits");
    assert!(
        consume.starts_with(
            "POST /api/v1/execution-workers/mt5/credential-grants/consume HTTP/1.1\r\n"
        )
    );
    assert!(consume.contains(r#""workerId":"worker-01""#));
    assert!(consume.contains(r#""sessionGeneration":7"#));
    assert!(consume.contains(r#""leaseGeneration":3"#));
    assert!(consume.contains(&format!(r#""grantToken":"{grant_token}""#)));
    assert!(!consume.contains("bootstrap-secret"));
}

#[test]
fn phase4_writes_bind_session_fence_and_convert_adapter_fields() {
    let responses = vec![
        (
            "200 OK",
            r#"{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":7,"sessionToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","heartbeatIntervalMs":15000,"leaseTtlMs":45000,"serverTimeMs":1700000000000}"#,
        ),
        (
            "200 OK",
            r#"{"accepted":true,"serverTimeMs":1700000000001}"#,
        ),
        (
            "200 OK",
            r#"{"accepted":true,"serverTimeMs":1700000000002}"#,
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
    client
        .post_snapshot(
            &session,
            "account-01",
            3,
            11,
            1_700_000_000_000,
            "positions",
            &json!({
                "result": "complete",
                "error_code": null,
                "positions": [{
                    "broker_ticket": "position-01",
                    "symbol": "EURUSD",
                    "side": "buy",
                    "volume": "0.10",
                    "open_price": "1.10000",
                    "current_price": "1.10100",
                    "stop_loss": null,
                    "take_profit": null,
                    "swap": "0",
                    "profit": "10",
                    "magic": 0,
                    "opened_at_ms": 1_699_999_000_000_i64
                }]
            }),
        )
        .expect("snapshot write accepted");
    client
        .post_history(
            &session,
            "account-01",
            3,
            12,
            1_700_000_000_100,
            1_699_900_000_000,
            1_700_000_000_000,
            "deals",
            &json!({
                "result": "complete",
                "error_code": null,
                "covered_through_ms": 1_700_000_000_000_i64,
                "deals": [{
                    "broker_ticket": "deal-01",
                    "order_ticket": "order-01",
                    "position_ticket": "position-01",
                    "symbol": "EURUSD",
                    "deal_type": "buy",
                    "entry": "in",
                    "volume": "0.10",
                    "price": "1.10000",
                    "commission": "0",
                    "swap": "0",
                    "profit": "10",
                    "fee": "0",
                    "occurred_at_ms": 1_699_999_500_000_i64,
                    "magic": 0
                }]
            }),
        )
        .expect("history write accepted");

    let requests: Vec<String> = (0..3)
        .map(|_| captured.recv_timeout(Duration::from_secs(5)).unwrap())
        .collect();
    server.join().expect("scripted server exits");
    assert!(requests[1].starts_with("POST /v1/mt5-vm/workers/snapshots HTTP/1.1\r\n"));
    assert!(requests[2].starts_with("POST /v1/mt5-vm/workers/history HTTP/1.1\r\n"));
    for request in &requests[1..] {
        assert!(
            request
                .to_ascii_lowercase()
                .contains("authorization: bearer 0123456789abcdef")
        );
        assert!(request.contains(r#""sessionGeneration":7"#));
        assert!(request.contains(r#""leaseGeneration":3"#));
        assert!(!request.contains("bootstrap-secret"));
        assert!(!request.contains("broker_ticket"));
    }
    assert!(requests[1].contains(r#""kind":"positions""#));
    assert!(requests[1].contains(r#""brokerTicket":"position-01""#));
    assert!(requests[1].contains(r#""openPrice":"1.10000""#));
    assert!(requests[2].contains(r#""kind":"deals""#));
    assert!(requests[2].contains(r#""coveredThroughMs":1700000000000"#));
    assert!(requests[2].contains(r#""occurredAtMs":1699999500000"#));
}
