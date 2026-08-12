use std::collections::VecDeque;

use thiserror::Error;

pub const DEFAULT_COMMAND_QUEUE_CAPACITY: usize = 32;
pub const HARD_MAX_COMMAND_QUEUE_CAPACITY: usize = 256;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum QueueError {
    #[error("queue capacity must be within the configured hard limit")]
    InvalidCapacity,
    #[error("account command queue is full")]
    QueueFull,
}

#[derive(Debug)]
pub struct BoundedLane<T> {
    capacity: usize,
    items: VecDeque<T>,
}

impl<T> BoundedLane<T> {
    pub fn new(capacity: usize) -> Result<Self, QueueError> {
        if capacity == 0 || capacity > HARD_MAX_COMMAND_QUEUE_CAPACITY {
            return Err(QueueError::InvalidCapacity);
        }
        Ok(Self {
            capacity,
            items: VecDeque::with_capacity(capacity),
        })
    }

    pub fn try_push(&mut self, value: T) -> Result<(), QueueError> {
        if self.items.len() >= self.capacity {
            return Err(QueueError::QueueFull);
        }
        self.items.push_back(value);
        Ok(())
    }

    pub fn pop(&mut self) -> Option<T> {
        self.items.pop_front()
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lane_is_fifo_and_fails_closed_at_capacity() {
        let mut lane = BoundedLane::new(2).expect("lane");
        lane.try_push(1).expect("first");
        lane.try_push(2).expect("second");
        assert_eq!(QueueError::QueueFull, lane.try_push(3).unwrap_err());
        assert_eq!(Some(1), lane.pop());
        assert_eq!(Some(2), lane.pop());
        assert!(lane.is_empty());
    }
}
