use std::collections::VecDeque;

use thiserror::Error;

pub const DEFAULT_START_WINDOW_MS: u64 = 60_000;
pub const DEFAULT_MAX_STARTS_PER_WINDOW: usize = 2;
pub const DEFAULT_MIN_START_SPACING_MS: u64 = 2_000;
pub const DEFAULT_MAX_JITTER_MS: u64 = 750;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StartupThrottleConfig {
    pub window_ms: u64,
    pub max_starts_per_window: usize,
    pub min_spacing_ms: u64,
    pub max_jitter_ms: u64,
}

impl Default for StartupThrottleConfig {
    fn default() -> Self {
        Self {
            window_ms: DEFAULT_START_WINDOW_MS,
            max_starts_per_window: DEFAULT_MAX_STARTS_PER_WINDOW,
            min_spacing_ms: DEFAULT_MIN_START_SPACING_MS,
            max_jitter_ms: DEFAULT_MAX_JITTER_MS,
        }
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum StartupThrottleError {
    #[error("startup throttle configuration is invalid")]
    InvalidConfig,
}

#[derive(Debug)]
pub struct StartupThrottle {
    config: StartupThrottleConfig,
    starts: VecDeque<u64>,
}

impl StartupThrottle {
    pub fn new(config: StartupThrottleConfig) -> Result<Self, StartupThrottleError> {
        if config.window_ms == 0
            || config.max_starts_per_window == 0
            || config.min_spacing_ms > config.window_ms
            || config.max_jitter_ms > config.window_ms
        {
            return Err(StartupThrottleError::InvalidConfig);
        }
        Ok(Self {
            config,
            starts: VecDeque::with_capacity(config.max_starts_per_window),
        })
    }

    pub fn required_delay_ms(&mut self, now_ms: u64, account_id: &str) -> u64 {
        while self
            .starts
            .front()
            .is_some_and(|started_at| now_ms.saturating_sub(*started_at) >= self.config.window_ms)
        {
            self.starts.pop_front();
        }

        let spacing_delay = self
            .starts
            .back()
            .map(|last| {
                self.config
                    .min_spacing_ms
                    .saturating_sub(now_ms.saturating_sub(*last))
            })
            .unwrap_or(0);
        let window_delay = if self.starts.len() >= self.config.max_starts_per_window {
            self.starts
                .front()
                .map(|first| {
                    self.config
                        .window_ms
                        .saturating_sub(now_ms.saturating_sub(*first))
                })
                .unwrap_or(0)
        } else {
            0
        };
        let base = spacing_delay.max(window_delay);
        if base == 0 {
            return 0;
        }
        base.saturating_add(deterministic_jitter(account_id, self.config.max_jitter_ms))
    }

    pub fn record_start(&mut self, started_at_ms: u64) {
        self.starts.push_back(started_at_ms);
        while self.starts.len() > self.config.max_starts_per_window {
            self.starts.pop_front();
        }
    }

    pub fn recent_start_count(&self) -> usize {
        self.starts.len()
    }
}

fn deterministic_jitter(account_id: &str, max_jitter_ms: u64) -> u64 {
    if max_jitter_ms == 0 {
        return 0;
    }
    let hash = account_id
        .bytes()
        .fold(1_469_598_103_934_665_603_u64, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(1_099_511_628_211)
        });
    hash % (max_jitter_ms + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throttle_enforces_spacing_window_and_bounded_jitter() {
        let config = StartupThrottleConfig {
            window_ms: 10_000,
            max_starts_per_window: 2,
            min_spacing_ms: 1_000,
            max_jitter_ms: 100,
        };
        let mut throttle = StartupThrottle::new(config).expect("throttle");
        assert_eq!(0, throttle.required_delay_ms(1_000, "account-a"));
        throttle.record_start(1_000);
        let spacing = throttle.required_delay_ms(1_100, "account-b");
        assert!((900..=1_000).contains(&spacing));
        throttle.record_start(2_100);
        let window = throttle.required_delay_ms(3_000, "account-c");
        assert!((8_000..=8_100).contains(&window));
        assert_eq!(0, throttle.required_delay_ms(11_000, "account-c"));
    }
}
