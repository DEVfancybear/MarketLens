use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

pub const EXECUTION_PROTOCOL_VERSION: u16 = 1;

macro_rules! string_id {
    ($name:ident) => {
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Self {
                Self(value.into())
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl Display for $name {
            fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
                self.0.fmt(formatter)
            }
        }
    };
}

string_id!(AccountId);
string_id!(CommandId);
string_id!(IdempotencyKey);
string_id!(SessionId);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VenueKind {
    Simulator,
    MetaTrader5,
    BinanceSpot,
    BinanceUsdM,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AccountMode {
    Simulated,
    Demo,
    Live,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AccountStatus {
    Disabled,
    Offline,
    Connecting,
    Ready,
    Degraded,
    Blocked,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Buy,
    Sell,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OrderKind {
    Market,
    Limit,
    Stop,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QuantityUnit {
    Lots,
    BaseUnits,
    Contracts,
    QuoteNotional,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum OrderSizing {
    Fixed {
        #[serde(with = "rust_decimal::serde::str")]
        quantity: Decimal,
        unit: QuantityUnit,
    },
    RiskPercent {
        basis_points: u32,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum CopyAllocation {
    SameQuantity,
    Multiplier {
        #[serde(with = "rust_decimal::serde::str")]
        multiplier: Decimal,
    },
    EquityProportional {
        #[serde(with = "rust_decimal::serde::str")]
        multiplier: Decimal,
    },
    RiskPercent {
        basis_points: u32,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyTarget {
    pub account_id: AccountId,
    pub enabled: bool,
    pub allocation: CopyAllocation,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub max_quantity: Option<Decimal>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderIntent {
    pub command_id: CommandId,
    pub idempotency_key: IdempotencyKey,
    pub source_account_id: Option<AccountId>,
    pub canonical_symbol: String,
    pub side: Side,
    pub kind: OrderKind,
    pub sizing: OrderSizing,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub limit_price: Option<Decimal>,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub stop_price: Option<Decimal>,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub stop_loss: Option<Decimal>,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub take_profit: Option<Decimal>,
    #[serde(default)]
    pub metadata: BTreeMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionAccount {
    pub id: AccountId,
    pub owner_id: String,
    pub label: String,
    pub venue_kind: VenueKind,
    pub broker_code: String,
    pub external_account_ref: String,
    pub server: Option<String>,
    pub mode: AccountMode,
    pub status: AccountStatus,
    pub currency: String,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub balance: Option<Decimal>,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub equity: Option<Decimal>,
    pub trade_allowed: bool,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstrumentSpec {
    pub canonical_symbol: String,
    pub venue_symbol: String,
    pub quantity_unit: QuantityUnit,
    #[serde(with = "rust_decimal::serde::str")]
    pub quantity_step: Decimal,
    #[serde(with = "rust_decimal::serde::str")]
    pub min_quantity: Decimal,
    #[serde(with = "rust_decimal::serde::str")]
    pub max_quantity: Decimal,
    #[serde(with = "rust_decimal::serde::str")]
    pub price_tick: Decimal,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub tick_value_per_quantity: Option<Decimal>,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub min_stop_distance: Option<Decimal>,
    pub trade_allowed: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskPolicy {
    pub max_risk_per_trade_basis_points: u32,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub max_order_quantity: Option<Decimal>,
    pub require_stop_loss: bool,
    #[serde(default)]
    pub allowed_symbols: Vec<String>,
    #[serde(default)]
    pub blocked_symbols: Vec<String>,
}

impl Default for RiskPolicy {
    fn default() -> Self {
        Self {
            max_risk_per_trade_basis_points: 100,
            max_order_quantity: None,
            require_stop_loss: true,
            allowed_symbols: Vec::new(),
            blocked_symbols: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteTargetContext {
    pub account: ExecutionAccount,
    pub instrument: InstrumentSpec,
    pub policy: RiskPolicy,
    pub copy_target: CopyTarget,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub reference_price: Option<Decimal>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutedOrder {
    pub parent_command_id: CommandId,
    pub command_id: CommandId,
    pub idempotency_key: IdempotencyKey,
    pub target_account_id: AccountId,
    pub broker_code: String,
    pub venue_kind: VenueKind,
    pub canonical_symbol: String,
    pub venue_symbol: String,
    pub side: Side,
    pub kind: OrderKind,
    #[serde(with = "rust_decimal::serde::str")]
    pub quantity: Decimal,
    pub quantity_unit: QuantityUnit,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub limit_price: Option<Decimal>,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub stop_price: Option<Decimal>,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub stop_loss: Option<Decimal>,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub take_profit: Option<Decimal>,
    #[serde(default)]
    pub warnings: Vec<RouteWarning>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RouteWarning {
    QuantityCappedByTarget,
    QuantityCappedByPolicy,
    QuantityFlooredToStep,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RouteRejectCode {
    TargetDisabled,
    AccountNotReady,
    AccountCannotTrade,
    SymbolNotAllowed,
    SymbolBlocked,
    SymbolNotTradable,
    QuantityUnitMismatch,
    QuantityInvalid,
    QuantityBelowMinimum,
    SourceEquityRequired,
    TargetEquityRequired,
    StopLossRequired,
    EntryPriceRequired,
    TickValueRequired,
    RiskLimitExceeded,
    StopLossWrongSide,
    StopDistanceTooSmall,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum TargetRouteResult {
    Ready {
        account_id: AccountId,
        order: Box<RoutedOrder>,
    },
    Rejected {
        account_id: AccountId,
        code: RouteRejectCode,
        message: String,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VenueCapabilities {
    pub market_orders: bool,
    pub pending_orders: bool,
    pub modify_orders: bool,
    pub partial_close: bool,
    pub hedging: bool,
    pub netting: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EaAccountSnapshot {
    pub login: String,
    pub broker: String,
    pub server: String,
    pub mode: AccountMode,
    pub currency: String,
    #[serde(with = "rust_decimal::serde::str")]
    pub balance: Decimal,
    #[serde(with = "rust_decimal::serde::str")]
    pub equity: Decimal,
    #[serde(with = "rust_decimal::serde::str")]
    pub margin: Decimal,
    #[serde(with = "rust_decimal::serde::str")]
    pub free_margin: Decimal,
    pub leverage: u32,
    pub trade_allowed: bool,
    pub terminal_build: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EaSessionRequest {
    pub protocol_version: u16,
    pub pairing_token: String,
    pub agent_id: String,
    pub account: EaAccountSnapshot,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EaSessionResponse {
    pub protocol_version: u16,
    pub session_id: SessionId,
    pub session_token: String,
    pub account_id: AccountId,
    pub expires_at_ms: u64,
    pub server_time_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EaCommand {
    Place { order: RoutedOrder },
    ModifyPosition { command: ModifyPositionCommand },
    ClosePosition { command: ClosePositionCommand },
    CancelOrder { command: CancelOrderCommand },
    Sync,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EaPollResponse {
    pub protocol_version: u16,
    pub commands: Vec<EaCommand>,
    pub server_time_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EaEventBatch {
    pub protocol_version: u16,
    pub account: EaAccountSnapshot,
    #[serde(default)]
    pub instruments: Vec<EaInstrumentSnapshot>,
    #[serde(default)]
    pub positions: Vec<EaPositionSnapshot>,
    #[serde(default)]
    pub pending_orders: Vec<EaPendingOrderSnapshot>,
    #[serde(default)]
    pub portfolio_snapshot_complete: bool,
    #[serde(default)]
    pub events: Vec<EaEvent>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EaInstrumentSnapshot {
    pub spec: InstrumentSpec,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub bid: Option<Decimal>,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub ask: Option<Decimal>,
    pub observed_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EaPositionSnapshot {
    pub broker_position_id: String,
    pub canonical_symbol: String,
    pub venue_symbol: String,
    pub side: Side,
    #[serde(with = "rust_decimal::serde::str")]
    pub quantity: Decimal,
    #[serde(with = "rust_decimal::serde::str")]
    pub open_price: Decimal,
    #[serde(with = "rust_decimal::serde::str")]
    pub current_price: Decimal,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub stop_loss: Option<Decimal>,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub take_profit: Option<Decimal>,
    #[serde(with = "rust_decimal::serde::str")]
    pub profit: Decimal,
    #[serde(with = "rust_decimal::serde::str")]
    pub swap: Decimal,
    #[serde(with = "rust_decimal::serde::str")]
    pub commission: Decimal,
    pub magic: i64,
    pub comment: String,
    pub opened_at_ms: u64,
    pub observed_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EaPendingOrderSnapshot {
    pub broker_order_id: String,
    pub canonical_symbol: String,
    pub venue_symbol: String,
    pub side: Side,
    pub kind: OrderKind,
    #[serde(with = "rust_decimal::serde::str")]
    pub quantity: Decimal,
    #[serde(with = "rust_decimal::serde::str")]
    pub price: Decimal,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub stop_loss: Option<Decimal>,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub take_profit: Option<Decimal>,
    pub magic: i64,
    pub comment: String,
    pub created_at_ms: u64,
    pub observed_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModifyPositionCommand {
    pub command_id: CommandId,
    pub idempotency_key: IdempotencyKey,
    pub target_account_id: AccountId,
    pub broker_position_id: String,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub stop_loss: Option<Decimal>,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub take_profit: Option<Decimal>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosePositionCommand {
    pub command_id: CommandId,
    pub idempotency_key: IdempotencyKey,
    pub target_account_id: AccountId,
    pub broker_position_id: String,
    #[serde(default, with = "rust_decimal::serde::str_option")]
    pub quantity: Option<Decimal>,
    pub deviation_points: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelOrderCommand {
    pub command_id: CommandId,
    pub idempotency_key: IdempotencyKey,
    pub target_account_id: AccountId,
    pub broker_order_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EaEvent {
    CommandAccepted {
        command_id: CommandId,
        broker_order_id: Option<String>,
        broker_deal_id: Option<String>,
        retcode: u64,
        message: String,
        occurred_at_ms: u64,
    },
    CommandRejected {
        command_id: CommandId,
        retcode: u64,
        message: String,
        occurred_at_ms: u64,
    },
    CommandUnknown {
        command_id: CommandId,
        message: String,
        occurred_at_ms: u64,
    },
    TradeTransaction {
        broker_order_id: Option<String>,
        broker_deal_id: Option<String>,
        broker_position_id: Option<String>,
        transaction_type: String,
        occurred_at_ms: u64,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;

    fn account() -> EaAccountSnapshot {
        EaAccountSnapshot {
            login: "123456".into(),
            broker: "Example Broker".into(),
            server: "Example-Live".into(),
            mode: AccountMode::Live,
            currency: "USD".into(),
            balance: Decimal::new(1_000_000, 2),
            equity: Decimal::new(995_025, 2),
            margin: Decimal::new(10_000, 2),
            free_margin: Decimal::new(985_025, 2),
            leverage: 100,
            trade_allowed: true,
            terminal_build: 5000,
        }
    }

    #[test]
    fn ea_snapshot_serializes_decimal_as_string() {
        let value = serde_json::to_value(account()).expect("serialize account");
        assert_eq!(value["mode"], "live");
        assert_eq!(value["balance"], "10000.00");
        assert_eq!(value["freeMargin"], "9850.25");
        assert_eq!(value["tradeAllowed"], true);
    }

    #[test]
    fn ea_session_rejects_numeric_decimal_wire_shape() {
        let invalid = r#"{
          "login":"1","broker":"b","server":"s","mode":"live",
          "currency":"USD","balance":100,"equity":"100",
          "margin":"0","freeMargin":"100","leverage":100,
          "tradeAllowed":true,"terminalBuild":1
        }"#;
        assert!(serde_json::from_str::<EaAccountSnapshot>(invalid).is_err());
    }

    #[test]
    fn ea_session_response_exposes_gateway_clock_in_camel_case() {
        let value = serde_json::to_value(EaSessionResponse {
            protocol_version: EXECUTION_PROTOCOL_VERSION,
            session_id: SessionId::new("session-1"),
            session_token: "session-token".into(),
            account_id: AccountId::new("mt5_account"),
            expires_at_ms: 2_000,
            server_time_ms: 1_000,
        })
        .expect("serialize session response");
        assert_eq!(value["serverTimeMs"], 1_000);
        assert!(value.get("server_time_ms").is_none());
    }

    #[test]
    fn command_tag_is_version_stable() {
        let value = serde_json::to_value(EaCommand::Sync).expect("serialize command");
        assert_eq!(value, serde_json::json!({ "type": "sync" }));
    }

    #[test]
    fn close_command_wire_shape_keeps_quantity_decimal_as_string() {
        let value = serde_json::to_value(EaCommand::ClosePosition {
            command: ClosePositionCommand {
                command_id: CommandId::new("close-1"),
                idempotency_key: IdempotencyKey::new("close-1"),
                target_account_id: AccountId::new("mt5_account"),
                broker_position_id: "123456".into(),
                quantity: Some(Decimal::new(5, 1)),
                deviation_points: 20,
            },
        })
        .expect("serialize close command");
        assert_eq!(value["type"], "closePosition");
        assert_eq!(value["command"]["quantity"], "0.5");
        assert_eq!(value["command"]["brokerPositionId"], "123456");
    }

    #[test]
    fn instrument_wire_rejects_floating_point_quantity_metadata() {
        let invalid = r#"{
          "spec": {
            "canonicalSymbol":"EURUSD","venueSymbol":"EURUSD",
            "quantityUnit":"lots","quantityStep":0.01,
            "minQuantity":"0.01","maxQuantity":"100",
            "priceTick":"0.00001","tickValuePerQuantity":"1",
            "minStopDistance":"0.0001","tradeAllowed":true
          },
          "bid":"1.10","ask":"1.11","observedAtMs":1
        }"#;
        assert!(serde_json::from_str::<EaInstrumentSnapshot>(invalid).is_err());
    }
}
