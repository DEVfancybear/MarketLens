use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const AGENT_PROTOCOL_VERSION: u32 = 1;
pub const DEFAULT_MAX_TERMINALS: usize = 4;
pub const HARD_MAX_TERMINALS: usize = 32;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeState {
    Provisioning,
    TerminalStarting,
    Authenticating,
    Synchronizing,
    Ready,
    Degraded,
    Reconnecting,
    Stopped,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RuntimeSlot {
    pub account_id: String,
    pub lease_generation: u64,
    pub state: RuntimeState,
    pub runtime_directory: PathBuf,
    pub terminal_pid: Option<u32>,
    pub adapter_pid: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AgentConfig {
    pub protocol_version: u32,
    pub worker_id: String,
    pub data_root: PathBuf,
    pub terminal_base: PathBuf,
    pub python_path: PathBuf,
    pub max_terminals: usize,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AgentConfigInput {
    pub worker_id: String,
    pub data_root: PathBuf,
    pub terminal_base: PathBuf,
    pub python_path: PathBuf,
    pub max_terminals: Option<usize>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AgentError {
    #[error("worker_id must contain only ASCII letters, digits, dash, or underscore")]
    InvalidWorkerId,
    #[error("account_id must contain only ASCII letters, digits, dash, or underscore")]
    InvalidAccountId,
    #[error("data_root, terminal_base, and python_path must be absolute")]
    PathMustBeAbsolute,
    #[error("configured paths cannot contain parent-directory components")]
    UnsafeConfigPath,
    #[error("configured terminal capacity must be between 1 and {HARD_MAX_TERMINALS}")]
    InvalidCapacity,
    #[error("worker terminal capacity is exhausted")]
    CapacityExhausted,
    #[error("account runtime already exists")]
    RuntimeExists,
    #[error("account runtime was not found")]
    RuntimeNotFound,
    #[error("lease generation is stale")]
    StaleLeaseGeneration,
    #[error("lease generation must be greater than zero")]
    InvalidLeaseGeneration,
    #[error("runtime path escaped the configured data root")]
    UnsafeRuntimePath,
}

impl TryFrom<AgentConfigInput> for AgentConfig {
    type Error = AgentError;

    fn try_from(value: AgentConfigInput) -> Result<Self, Self::Error> {
        if !is_safe_identifier(&value.worker_id) {
            return Err(AgentError::InvalidWorkerId);
        }
        if !value.data_root.is_absolute()
            || !value.terminal_base.is_absolute()
            || !value.python_path.is_absolute()
        {
            return Err(AgentError::PathMustBeAbsolute);
        }
        if [&value.data_root, &value.terminal_base, &value.python_path]
            .into_iter()
            .any(|path| {
                path.components()
                    .any(|component| matches!(component, Component::ParentDir))
            })
        {
            return Err(AgentError::UnsafeConfigPath);
        }
        let max_terminals = value.max_terminals.unwrap_or(DEFAULT_MAX_TERMINALS);
        if !(1..=HARD_MAX_TERMINALS).contains(&max_terminals) {
            return Err(AgentError::InvalidCapacity);
        }
        Ok(Self {
            protocol_version: AGENT_PROTOCOL_VERSION,
            worker_id: value.worker_id,
            data_root: value.data_root,
            terminal_base: value.terminal_base,
            python_path: value.python_path,
            max_terminals,
        })
    }
}

#[derive(Debug)]
pub struct RuntimeRegistry {
    data_root: PathBuf,
    max_terminals: usize,
    runtimes: HashMap<String, RuntimeSlot>,
}

impl RuntimeRegistry {
    pub fn new(data_root: PathBuf, max_terminals: usize) -> Result<Self, AgentError> {
        if !data_root.is_absolute() {
            return Err(AgentError::PathMustBeAbsolute);
        }
        if !(1..=HARD_MAX_TERMINALS).contains(&max_terminals) {
            return Err(AgentError::InvalidCapacity);
        }
        Ok(Self {
            data_root,
            max_terminals,
            runtimes: HashMap::with_capacity(max_terminals),
        })
    }

    pub fn provision(
        &mut self,
        account_id: &str,
        lease_generation: u64,
    ) -> Result<&RuntimeSlot, AgentError> {
        if !is_safe_identifier(account_id) {
            return Err(AgentError::InvalidAccountId);
        }
        if lease_generation == 0 {
            return Err(AgentError::InvalidLeaseGeneration);
        }
        if self.runtimes.contains_key(account_id) {
            return Err(AgentError::RuntimeExists);
        }
        if self.runtimes.len() >= self.max_terminals {
            return Err(AgentError::CapacityExhausted);
        }
        let runtime_directory = checked_runtime_directory(&self.data_root, account_id)?;
        self.runtimes.insert(
            account_id.to_owned(),
            RuntimeSlot {
                account_id: account_id.to_owned(),
                lease_generation,
                state: RuntimeState::Provisioning,
                runtime_directory,
                terminal_pid: None,
                adapter_pid: None,
            },
        );
        Ok(self
            .runtimes
            .get(account_id)
            .expect("inserted runtime must exist"))
    }

    pub fn transition(
        &mut self,
        account_id: &str,
        lease_generation: u64,
        state: RuntimeState,
    ) -> Result<&RuntimeSlot, AgentError> {
        let slot = self
            .runtimes
            .get_mut(account_id)
            .ok_or(AgentError::RuntimeNotFound)?;
        if slot.lease_generation != lease_generation {
            return Err(AgentError::StaleLeaseGeneration);
        }
        slot.state = state;
        Ok(slot)
    }

    pub fn remove(
        &mut self,
        account_id: &str,
        lease_generation: u64,
    ) -> Result<RuntimeSlot, AgentError> {
        let slot = self
            .runtimes
            .get(account_id)
            .ok_or(AgentError::RuntimeNotFound)?;
        if slot.lease_generation != lease_generation {
            return Err(AgentError::StaleLeaseGeneration);
        }
        self.runtimes
            .remove(account_id)
            .ok_or(AgentError::RuntimeNotFound)
    }

    pub fn active_count(&self) -> usize {
        self.runtimes.len()
    }

    pub fn available_capacity(&self) -> usize {
        self.max_terminals.saturating_sub(self.runtimes.len())
    }
}

pub fn is_safe_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

pub fn checked_runtime_directory(
    data_root: &Path,
    account_id: &str,
) -> Result<PathBuf, AgentError> {
    if !data_root.is_absolute() {
        return Err(AgentError::PathMustBeAbsolute);
    }
    if !is_safe_identifier(account_id) {
        return Err(AgentError::InvalidAccountId);
    }
    if data_root
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(AgentError::UnsafeRuntimePath);
    }
    let candidate = data_root.join("accounts").join(account_id);
    if !candidate.starts_with(data_root) {
        return Err(AgentError::UnsafeRuntimePath);
    }
    Ok(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn absolute_test_path(name: &str) -> PathBuf {
        std::env::temp_dir()
            .join("marketlens-mt5-agent-tests")
            .join(name)
    }

    #[test]
    fn config_defaults_to_multi_terminal_capacity() {
        let config = AgentConfig::try_from(AgentConfigInput {
            worker_id: "worker-01".to_owned(),
            data_root: absolute_test_path("data"),
            terminal_base: absolute_test_path("terminal64.exe"),
            python_path: absolute_test_path("python.exe"),
            max_terminals: None,
        })
        .expect("valid config");

        assert_eq!(DEFAULT_MAX_TERMINALS, config.max_terminals);
        assert_eq!(AGENT_PROTOCOL_VERSION, config.protocol_version);
    }

    #[test]
    fn registry_runs_multiple_isolated_slots_and_enforces_capacity() {
        let root = absolute_test_path("registry");
        let mut registry = RuntimeRegistry::new(root.clone(), 2).expect("registry");

        let first = registry.provision("account-a", 1).expect("first runtime");
        assert_eq!(
            root.join("accounts").join("account-a"),
            first.runtime_directory
        );
        registry.provision("account-b", 4).expect("second runtime");

        assert_eq!(2, registry.active_count());
        assert_eq!(0, registry.available_capacity());
        assert_eq!(
            AgentError::CapacityExhausted,
            registry.provision("account-c", 1).unwrap_err()
        );
    }

    #[test]
    fn stale_lease_cannot_transition_or_remove_runtime() {
        let mut registry = RuntimeRegistry::new(absolute_test_path("lease"), 4).expect("registry");
        registry.provision("account-a", 7).expect("runtime");

        assert_eq!(
            AgentError::StaleLeaseGeneration,
            registry
                .transition("account-a", 6, RuntimeState::Ready)
                .unwrap_err()
        );
        assert_eq!(
            AgentError::StaleLeaseGeneration,
            registry.remove("account-a", 6).unwrap_err()
        );
        assert_eq!(1, registry.active_count());
    }

    #[test]
    fn unsafe_account_identifiers_are_rejected() {
        let root = absolute_test_path("paths");
        for account_id in ["../escape", "a/b", "a\\b", "", "."] {
            assert!(checked_runtime_directory(&root, account_id).is_err());
        }
    }

    #[test]
    fn zero_lease_generation_fails_closed() {
        let mut registry =
            RuntimeRegistry::new(absolute_test_path("zero-lease"), 4).expect("registry");

        assert_eq!(
            AgentError::InvalidLeaseGeneration,
            registry.provision("account-a", 0).unwrap_err()
        );
        assert_eq!(0, registry.active_count());
    }

    #[test]
    fn config_rejects_parent_directory_components() {
        let result = AgentConfig::try_from(AgentConfigInput {
            worker_id: "worker-01".to_owned(),
            data_root: absolute_test_path("root").join("..").join("escape"),
            terminal_base: absolute_test_path("terminal64.exe"),
            python_path: absolute_test_path("python.exe"),
            max_terminals: Some(4),
        });

        assert_eq!(AgentError::UnsafeConfigPath, result.unwrap_err());
    }
}
