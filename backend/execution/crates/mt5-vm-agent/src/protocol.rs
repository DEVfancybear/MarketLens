use std::collections::HashMap;
use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use thiserror::Error;
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

use crate::{AGENT_PROTOCOL_VERSION, is_safe_identifier};

pub const IPC_KEY_BYTES: usize = 32;
pub const MAX_FRAME_BYTES: usize = 64 * 1024;
pub const MAX_FRAME_TTL_MS: u64 = 60_000;
pub const MAX_FUTURE_SKEW_MS: u64 = 30_000;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageKind {
    AgentHello,
    AgentHeartbeat,
    ProvisionAccount,
    StopAccount,
    RestartAccount,
    ForceTerminalCrash,
    AccountRuntimeStatus,
    AccountSnapshot,
    ValidationReport,
}

impl MessageKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AgentHello => "agent_hello",
            Self::AgentHeartbeat => "agent_heartbeat",
            Self::ProvisionAccount => "provision_account",
            Self::StopAccount => "stop_account",
            Self::RestartAccount => "restart_account",
            Self::ForceTerminalCrash => "force_terminal_crash",
            Self::AccountRuntimeStatus => "account_runtime_status",
            Self::AccountSnapshot => "account_snapshot",
            Self::ValidationReport => "validation_report",
        }
    }
}

#[derive(Clone, Deserialize, PartialEq, Eq, Serialize)]
pub struct AuthenticatedFrame {
    pub protocol_version: u32,
    pub worker_id: String,
    pub account_id: String,
    pub lease_generation: u64,
    pub message_id: String,
    pub sent_at_ms: u64,
    pub expires_at_ms: u64,
    pub sequence: u64,
    pub kind: MessageKind,
    pub payload_json: String,
    pub mac_hex: String,
}

impl fmt::Debug for AuthenticatedFrame {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AuthenticatedFrame")
            .field("protocol_version", &self.protocol_version)
            .field("worker_id", &self.worker_id)
            .field("account_id", &self.account_id)
            .field("lease_generation", &self.lease_generation)
            .field("message_id", &self.message_id)
            .field("sent_at_ms", &self.sent_at_ms)
            .field("expires_at_ms", &self.expires_at_ms)
            .field("sequence", &self.sequence)
            .field("kind", &self.kind)
            .field("payload_json", &"[REDACTED]")
            .field("mac_hex", &"[REDACTED]")
            .finish()
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ProtocolError {
    #[error("authenticated frame exceeds the size limit")]
    FrameTooLarge,
    #[error("authenticated frame is malformed")]
    MalformedFrame,
    #[error("authenticated frame uses an unsupported protocol")]
    ProtocolMismatch,
    #[error("authenticated frame identity does not match this channel")]
    IdentityMismatch,
    #[error("authenticated frame lease generation is invalid")]
    LeaseMismatch,
    #[error("authenticated frame timestamp is invalid or expired")]
    InvalidTimestamp,
    #[error("authenticated frame sequence is stale or replayed")]
    ReplayDetected,
    #[error("authenticated frame MAC is invalid")]
    AuthenticationFailed,
    #[error("IPC key must contain exactly 32 bytes")]
    InvalidKey,
    #[error("authenticated payload is malformed")]
    MalformedPayload,
}

pub struct IpcKey(Zeroizing<Vec<u8>>);

impl IpcKey {
    pub fn generate() -> Self {
        let mut bytes = Vec::with_capacity(IPC_KEY_BYTES);
        bytes.extend_from_slice(Uuid::new_v4().as_bytes());
        bytes.extend_from_slice(Uuid::new_v4().as_bytes());
        Self(Zeroizing::new(bytes))
    }

    pub fn from_bytes(bytes: Vec<u8>) -> Result<Self, ProtocolError> {
        if bytes.len() != IPC_KEY_BYTES {
            let mut bytes = bytes;
            bytes.zeroize();
            return Err(ProtocolError::InvalidKey);
        }
        Ok(Self(Zeroizing::new(bytes)))
    }

    pub fn from_hex(value: &str) -> Result<Self, ProtocolError> {
        if value.len() != IPC_KEY_BYTES * 2 {
            return Err(ProtocolError::InvalidKey);
        }
        let mut bytes = Vec::with_capacity(IPC_KEY_BYTES);
        for index in (0..value.len()).step_by(2) {
            let byte = u8::from_str_radix(&value[index..index + 2], 16)
                .map_err(|_| ProtocolError::InvalidKey)?;
            bytes.push(byte);
        }
        Self::from_bytes(bytes)
    }

    pub fn to_hex(&self) -> Zeroizing<String> {
        Zeroizing::new(encode_hex(self.0.as_slice()))
    }

    fn bytes(&self) -> &[u8] {
        self.0.as_slice()
    }
}

impl fmt::Debug for IpcKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("IpcKey([REDACTED])")
    }
}

pub struct FrameSigner {
    key: IpcKey,
    worker_id: String,
    next_sequence: HashMap<String, u64>,
}

impl FrameSigner {
    pub fn new(key: IpcKey, worker_id: String) -> Result<Self, ProtocolError> {
        if !is_safe_identifier(&worker_id) {
            return Err(ProtocolError::IdentityMismatch);
        }
        Ok(Self {
            key,
            worker_id,
            next_sequence: HashMap::new(),
        })
    }

    pub fn sign<T: Serialize>(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        kind: MessageKind,
        payload: &T,
        now_ms: u64,
        ttl_ms: u64,
    ) -> Result<AuthenticatedFrame, ProtocolError> {
        if !is_safe_identifier(account_id) || lease_generation == 0 {
            return Err(ProtocolError::IdentityMismatch);
        }
        if ttl_ms == 0 || ttl_ms > MAX_FRAME_TTL_MS {
            return Err(ProtocolError::InvalidTimestamp);
        }
        let payload_json =
            serde_json::to_string(payload).map_err(|_| ProtocolError::MalformedPayload)?;
        if payload_json.len() > MAX_FRAME_BYTES / 2 {
            return Err(ProtocolError::FrameTooLarge);
        }
        let sequence = self
            .next_sequence
            .entry(account_id.to_owned())
            .and_modify(|value| *value = value.saturating_add(1))
            .or_insert(1);
        let mut frame = AuthenticatedFrame {
            protocol_version: AGENT_PROTOCOL_VERSION,
            worker_id: self.worker_id.clone(),
            account_id: account_id.to_owned(),
            lease_generation,
            message_id: Uuid::new_v4().to_string(),
            sent_at_ms: now_ms,
            expires_at_ms: now_ms.saturating_add(ttl_ms),
            sequence: *sequence,
            kind,
            payload_json,
            mac_hex: String::new(),
        };
        frame.mac_hex = compute_mac_hex(&self.key, &frame)?;
        Ok(frame)
    }
}

pub struct FrameVerifier {
    key: IpcKey,
    worker_id: String,
    last_sequence: HashMap<String, u64>,
}

impl FrameVerifier {
    pub fn new(key: IpcKey, worker_id: String) -> Result<Self, ProtocolError> {
        if !is_safe_identifier(&worker_id) {
            return Err(ProtocolError::IdentityMismatch);
        }
        Ok(Self {
            key,
            worker_id,
            last_sequence: HashMap::new(),
        })
    }

    pub fn verify<T: for<'de> Deserialize<'de>>(
        &mut self,
        frame: &AuthenticatedFrame,
        expected_account_id: &str,
        expected_lease_generation: u64,
        now_ms: u64,
    ) -> Result<T, ProtocolError> {
        if frame.protocol_version != AGENT_PROTOCOL_VERSION {
            return Err(ProtocolError::ProtocolMismatch);
        }
        if frame.worker_id != self.worker_id
            || frame.account_id != expected_account_id
            || !is_safe_identifier(&frame.account_id)
        {
            return Err(ProtocolError::IdentityMismatch);
        }
        if expected_lease_generation == 0 || frame.lease_generation != expected_lease_generation {
            return Err(ProtocolError::LeaseMismatch);
        }
        if frame.expires_at_ms < now_ms
            || frame.sent_at_ms > now_ms.saturating_add(MAX_FUTURE_SKEW_MS)
            || frame.expires_at_ms < frame.sent_at_ms
            || frame.expires_at_ms.saturating_sub(frame.sent_at_ms) > MAX_FRAME_TTL_MS
        {
            return Err(ProtocolError::InvalidTimestamp);
        }
        let last_sequence = self
            .last_sequence
            .get(expected_account_id)
            .copied()
            .unwrap_or(0);
        if frame.sequence <= last_sequence {
            return Err(ProtocolError::ReplayDetected);
        }
        let mac = decode_hex(&frame.mac_hex).ok_or(ProtocolError::AuthenticationFailed)?;
        let mut verifier =
            HmacSha256::new_from_slice(self.key.bytes()).map_err(|_| ProtocolError::InvalidKey)?;
        verifier.update(&frame_signing_bytes(frame)?);
        verifier
            .verify_slice(&mac)
            .map_err(|_| ProtocolError::AuthenticationFailed)?;
        let payload = serde_json::from_str(&frame.payload_json)
            .map_err(|_| ProtocolError::MalformedPayload)?;
        self.last_sequence
            .insert(expected_account_id.to_owned(), frame.sequence);
        Ok(payload)
    }
}

pub fn frame_to_line(frame: &AuthenticatedFrame) -> Result<String, ProtocolError> {
    let line = serde_json::to_string(frame).map_err(|_| ProtocolError::MalformedFrame)?;
    if line.len() > MAX_FRAME_BYTES {
        return Err(ProtocolError::FrameTooLarge);
    }
    Ok(line)
}

pub fn frame_from_line(line: &str) -> Result<AuthenticatedFrame, ProtocolError> {
    if line.len() > MAX_FRAME_BYTES {
        return Err(ProtocolError::FrameTooLarge);
    }
    serde_json::from_str(line).map_err(|_| ProtocolError::MalformedFrame)
}

pub fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn compute_mac_hex(key: &IpcKey, frame: &AuthenticatedFrame) -> Result<String, ProtocolError> {
    let mut signer =
        HmacSha256::new_from_slice(key.bytes()).map_err(|_| ProtocolError::InvalidKey)?;
    signer.update(&frame_signing_bytes(frame)?);
    Ok(encode_hex(&signer.finalize().into_bytes()))
}

fn frame_signing_bytes(frame: &AuthenticatedFrame) -> Result<Vec<u8>, ProtocolError> {
    let fields = [
        frame.protocol_version.to_string(),
        frame.worker_id.clone(),
        frame.account_id.clone(),
        frame.lease_generation.to_string(),
        frame.message_id.clone(),
        frame.sent_at_ms.to_string(),
        frame.expires_at_ms.to_string(),
        frame.sequence.to_string(),
        frame.kind.as_str().to_owned(),
        frame.payload_json.clone(),
    ];
    let mut bytes = Vec::new();
    for field in fields {
        let length: u32 = field
            .len()
            .try_into()
            .map_err(|_| ProtocolError::FrameTooLarge)?;
        bytes.extend_from_slice(&length.to_be_bytes());
        bytes.extend_from_slice(field.as_bytes());
    }
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(ProtocolError::FrameTooLarge);
    }
    Ok(bytes)
}

fn encode_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(output, "{byte:02x}");
    }
    output
}

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if !value.len().is_multiple_of(2) {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use serde_json::json;

    fn test_key() -> IpcKey {
        IpcKey::from_bytes(vec![7; IPC_KEY_BYTES]).expect("key")
    }

    #[test]
    fn signed_frame_round_trip_rejects_replay() {
        let mut signer = FrameSigner::new(test_key(), "worker-01".to_owned()).expect("signer");
        let mut verifier =
            FrameVerifier::new(test_key(), "worker-01".to_owned()).expect("verifier");
        let frame = signer
            .sign(
                "account-a",
                7,
                MessageKind::AgentHeartbeat,
                &json!({"healthy": true}),
                1_000,
                5_000,
            )
            .expect("frame");

        let payload: Value = verifier
            .verify(&frame, "account-a", 7, 1_500)
            .expect("verified");
        assert_eq!(json!({"healthy": true}), payload);
        assert_eq!(
            ProtocolError::ReplayDetected,
            verifier
                .verify::<Value>(&frame, "account-a", 7, 1_500)
                .unwrap_err()
        );
    }

    #[test]
    fn tampered_expired_and_cross_account_frames_fail_closed() {
        let mut signer = FrameSigner::new(test_key(), "worker-01".to_owned()).expect("signer");
        let frame = signer
            .sign(
                "account-a",
                3,
                MessageKind::AccountSnapshot,
                &json!({"connected": true}),
                10_000,
                1_000,
            )
            .expect("frame");

        let mut tampered = frame.clone();
        tampered.payload_json = "{\"connected\":false}".to_owned();
        let mut verifier =
            FrameVerifier::new(test_key(), "worker-01".to_owned()).expect("verifier");
        assert_eq!(
            ProtocolError::AuthenticationFailed,
            verifier
                .verify::<Value>(&tampered, "account-a", 3, 10_500)
                .unwrap_err()
        );
        assert_eq!(
            ProtocolError::IdentityMismatch,
            verifier
                .verify::<Value>(&frame, "account-b", 3, 10_500)
                .unwrap_err()
        );
        assert_eq!(
            ProtocolError::InvalidTimestamp,
            verifier
                .verify::<Value>(&frame, "account-a", 3, 12_000)
                .unwrap_err()
        );
    }

    #[test]
    fn debug_output_redacts_payload_mac_and_key() {
        let key = test_key();
        let mut signer = FrameSigner::new(test_key(), "worker-01".to_owned()).expect("signer");
        let frame = signer
            .sign(
                "account-a",
                1,
                MessageKind::ProvisionAccount,
                &json!({"password": "never-print-this"}),
                1_000,
                1_000,
            )
            .expect("frame");
        let output = format!("{key:?} {frame:?}");
        assert!(!output.contains("never-print-this"));
        assert!(!output.contains(&frame.mac_hex));
        assert!(output.contains("[REDACTED]"));
    }

    #[test]
    fn oversized_frames_and_invalid_keys_are_rejected() {
        assert_eq!(
            ProtocolError::InvalidKey,
            IpcKey::from_bytes(vec![1; 8]).unwrap_err()
        );
        assert_eq!(
            ProtocolError::FrameTooLarge,
            frame_from_line(&"x".repeat(MAX_FRAME_BYTES + 1)).unwrap_err()
        );
    }
}
