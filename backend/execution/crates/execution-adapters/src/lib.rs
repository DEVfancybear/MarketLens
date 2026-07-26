use async_trait::async_trait;
use execution_domain::{AccountId, EaCommand, RoutedOrder, VenueCapabilities, VenueKind};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterReceipt {
    pub target_account_id: AccountId,
    pub command_id: execution_domain::CommandId,
    pub state: AdapterReceiptState,
    pub venue_request_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AdapterReceiptState {
    Queued,
    Submitted,
}

#[derive(Debug, Error)]
pub enum AdapterError {
    #[error("target account has no active adapter session")]
    AccountOffline,
    #[error("adapter queue is full")]
    Backpressure,
    #[error("idempotency key was already used for a different command")]
    IdempotencyConflict,
    #[error("venue adapter rejected the request: {0}")]
    Rejected(String),
    #[error("venue transport failed: {0}")]
    Transport(String),
}

/// The only execution-engine dependency on a broker or exchange transport.
/// Adding a venue must implement this contract; it must not fork routing, risk,
/// audit, or React components.
#[async_trait]
pub trait VenueAdapter: Send + Sync {
    fn venue_kind(&self) -> VenueKind;
    fn capabilities(&self) -> VenueCapabilities;
    async fn submit(&self, order: RoutedOrder) -> Result<AdapterReceipt, AdapterError>;
}

#[async_trait]
pub trait EaCommandQueue: Send + Sync {
    async fn enqueue(&self, account_id: &AccountId, command: EaCommand)
    -> Result<(), AdapterError>;
}

pub struct Mt5EaAdapter<Q> {
    queue: Q,
}

impl<Q> Mt5EaAdapter<Q> {
    pub fn new(queue: Q) -> Self {
        Self { queue }
    }
}

#[async_trait]
impl<Q> VenueAdapter for Mt5EaAdapter<Q>
where
    Q: EaCommandQueue,
{
    fn venue_kind(&self) -> VenueKind {
        VenueKind::MetaTrader5
    }

    fn capabilities(&self) -> VenueCapabilities {
        VenueCapabilities {
            market_orders: true,
            pending_orders: true,
            modify_orders: true,
            partial_close: true,
            hedging: true,
            netting: true,
        }
    }

    async fn submit(&self, order: RoutedOrder) -> Result<AdapterReceipt, AdapterError> {
        let account_id = order.target_account_id.clone();
        let command_id = order.command_id.clone();
        self.queue
            .enqueue(&account_id, EaCommand::Place { order })
            .await?;
        Ok(AdapterReceipt {
            target_account_id: account_id,
            command_id,
            state: AdapterReceiptState::Queued,
            venue_request_id: None,
        })
    }
}

/// Minimal native API boundary. Concrete Binance Spot and USD-M clients can
/// share signing/clock/rate-limit code while reporting different capabilities.
#[async_trait]
pub trait BinanceTradingClient: Send + Sync {
    fn venue_kind(&self) -> VenueKind;
    async fn place_order(&self, order: &RoutedOrder) -> Result<String, AdapterError>;
}

pub struct BinanceAdapter<C> {
    client: C,
}

impl<C> BinanceAdapter<C> {
    pub fn new(client: C) -> Self {
        Self { client }
    }
}

#[async_trait]
impl<C> VenueAdapter for BinanceAdapter<C>
where
    C: BinanceTradingClient,
{
    fn venue_kind(&self) -> VenueKind {
        self.client.venue_kind()
    }

    fn capabilities(&self) -> VenueCapabilities {
        VenueCapabilities {
            market_orders: true,
            pending_orders: true,
            modify_orders: false,
            partial_close: true,
            hedging: false,
            netting: true,
        }
    }

    async fn submit(&self, order: RoutedOrder) -> Result<AdapterReceipt, AdapterError> {
        let venue_request_id = self.client.place_order(&order).await?;
        Ok(AdapterReceipt {
            target_account_id: order.target_account_id,
            command_id: order.command_id,
            state: AdapterReceiptState::Submitted,
            venue_request_id: Some(venue_request_id),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use execution_domain::{
        CommandId, IdempotencyKey, OrderKind, QuantityUnit, RouteWarning, Side, VenueKind,
    };
    use rust_decimal::Decimal;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    struct RecordingQueue {
        commands: Arc<Mutex<Vec<(AccountId, EaCommand)>>>,
    }

    #[async_trait]
    impl EaCommandQueue for RecordingQueue {
        async fn enqueue(
            &self,
            account_id: &AccountId,
            command: EaCommand,
        ) -> Result<(), AdapterError> {
            self.commands
                .lock()
                .expect("queue lock")
                .push((account_id.clone(), command));
            Ok(())
        }
    }

    struct RejectingQueue;

    #[async_trait]
    impl EaCommandQueue for RejectingQueue {
        async fn enqueue(
            &self,
            _account_id: &AccountId,
            _command: EaCommand,
        ) -> Result<(), AdapterError> {
            Err(AdapterError::Backpressure)
        }
    }

    fn routed_order() -> RoutedOrder {
        RoutedOrder {
            parent_command_id: CommandId::new("parent"),
            command_id: CommandId::new("child"),
            idempotency_key: IdempotencyKey::new("once:account"),
            target_account_id: AccountId::new("account"),
            broker_code: "exness".into(),
            venue_kind: VenueKind::MetaTrader5,
            canonical_symbol: "EURUSD".into(),
            venue_symbol: "EURUSDm".into(),
            side: Side::Buy,
            kind: OrderKind::Market,
            quantity: Decimal::new(10, 2),
            quantity_unit: QuantityUnit::Lots,
            limit_price: None,
            stop_price: None,
            stop_loss: Some(Decimal::new(108_000, 5)),
            take_profit: None,
            warnings: Vec::<RouteWarning>::new(),
        }
    }

    #[tokio::test]
    async fn mt5_adapter_preserves_target_and_command_identity() {
        let queue = RecordingQueue::default();
        let recorded = queue.commands.clone();
        let receipt = Mt5EaAdapter::new(queue)
            .submit(routed_order())
            .await
            .expect("submit");

        assert_eq!(receipt.target_account_id.as_str(), "account");
        assert_eq!(receipt.command_id.as_str(), "child");
        assert_eq!(receipt.state, AdapterReceiptState::Queued);
        let commands = recorded.lock().expect("queue lock");
        assert!(matches!(
            &commands[0],
            (account_id, EaCommand::Place { order })
                if account_id.as_str() == "account"
                && order.idempotency_key.as_str() == "once:account"
        ));
    }

    #[tokio::test]
    async fn adapter_propagates_backpressure_without_retrying_blindly() {
        let error = Mt5EaAdapter::new(RejectingQueue)
            .submit(routed_order())
            .await
            .expect_err("queue must reject");
        assert!(matches!(error, AdapterError::Backpressure));
    }
}
