use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

pub const MT5_VM_CONTROL_PROTOCOL_VERSION: u16 = 1;
pub const MT5_VM_MAX_SCHEDULED_TERMINALS: u16 = 4;
pub const MT5_VM_MAX_COMMANDS_PER_POLL: u16 = 16;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerHelloRequest {
    pub worker_id: String,
    pub protocol_min: u16,
    pub protocol_max: u16,
    pub agent_version: String,
    pub image_version: String,
    pub runtime_version: String,
    pub capacity: u16,
    pub region: String,
    #[serde(default)]
    pub capabilities: BTreeSet<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerHelloResponse {
    pub protocol_version: u16,
    pub worker_id: String,
    pub session_generation: u64,
    pub session_token: String,
    pub heartbeat_interval_ms: u64,
    pub lease_ttl_ms: u64,
    pub server_time_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerLeaseClaim {
    pub account_id: String,
    pub lease_generation: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerHeartbeatRequest {
    pub protocol_version: u16,
    pub worker_id: String,
    pub session_generation: u64,
    #[serde(default)]
    pub leases: Vec<WorkerLeaseClaim>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerHeartbeatResponse {
    pub ok: bool,
    pub server_time_ms: u64,
    pub next_heartbeat_in_ms: u64,
    pub lease_ttl_ms: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerPollRequest {
    pub protocol_version: u16,
    pub worker_id: String,
    pub session_generation: u64,
    #[serde(default)]
    pub max_commands: Option<u16>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerCommandKind {
    ProvisionAccount,
    StopAccount,
    ReconcileAccount,
}

impl WorkerCommandKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ProvisionAccount => "provision_account",
            Self::StopAccount => "stop_account",
            Self::ReconcileAccount => "reconcile_account",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerControlCommand {
    pub protocol_version: u16,
    pub worker_id: String,
    pub account_id: String,
    pub lease_generation: u64,
    pub command_id: String,
    pub message_id: String,
    pub sent_at_ms: u64,
    pub expires_at_ms: u64,
    pub kind: WorkerCommandKind,
    pub payload_json: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerPollResponse {
    pub protocol_version: u16,
    pub server_time_ms: u64,
    pub commands: Vec<WorkerControlCommand>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerCommandAckKind {
    Received,
    Succeeded,
    Failed,
}

impl WorkerCommandAckKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Received => "received",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerCommandAckRequest {
    pub protocol_version: u16,
    pub worker_id: String,
    pub session_generation: u64,
    pub account_id: String,
    pub lease_generation: u64,
    pub command_id: String,
    pub ack: WorkerCommandAckKind,
    #[serde(default)]
    pub result_json: Option<String>,
    #[serde(default)]
    pub error_code: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerCommandAckResponse {
    pub command_id: String,
    pub status: String,
    pub server_time_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_contract_uses_stable_camel_case_envelopes_and_snake_case_kinds() {
        let value = serde_json::to_value(WorkerControlCommand {
            protocol_version: MT5_VM_CONTROL_PROTOCOL_VERSION,
            worker_id: "worker-01".into(),
            account_id: "account-01".into(),
            lease_generation: 7,
            command_id: "11111111-1111-4111-8111-111111111111".into(),
            message_id: "22222222-2222-4222-8222-222222222222".into(),
            sent_at_ms: 10,
            expires_at_ms: 20,
            kind: WorkerCommandKind::ProvisionAccount,
            payload_json: "{}".into(),
        })
        .expect("control command serializes");

        assert_eq!(value["protocolVersion"], 1);
        assert_eq!(value["leaseGeneration"], 7);
        assert_eq!(value["kind"], "provision_account");
        assert!(value.get("lease_generation").is_none());
    }

    #[test]
    fn request_contract_rejects_unknown_fields() {
        let result = serde_json::from_value::<WorkerPollRequest>(serde_json::json!({
            "protocolVersion": 1,
            "workerId": "worker-01",
            "sessionGeneration": 3,
            "unexpected": true
        }));
        assert!(result.is_err());
    }
}
