use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

/// Strict JSON codec for optional monetary values.
///
/// Values are encoded as decimal strings to avoid binary floating-point loss,
/// while both a missing field (`#[serde(default)]`) and an explicit JSON `null`
/// decode to `None`. The upstream rust_decimal `str_option` helper does not
/// accept explicit `null`, even though it serializes `None` as `null`.
pub mod nullable_decimal_string {
    use rust_decimal::Decimal;
    use serde::de::Error;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(value: &Option<Decimal>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match value {
            Some(decimal) => serializer.serialize_some(&decimal.to_string()),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Option<Decimal>, D::Error>
    where
        D: Deserializer<'de>,
    {
        Option::<String>::deserialize(deserializer)?
            .map(|value| value.parse::<Decimal>().map_err(D::Error::custom))
            .transpose()
    }
}

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
    #[serde(default, with = "nullable_decimal_string")]
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
    #[serde(default, with = "nullable_decimal_string")]
    pub limit_price: Option<Decimal>,
    #[serde(default, with = "nullable_decimal_string")]
    pub stop_price: Option<Decimal>,
    #[serde(default, with = "nullable_decimal_string")]
    pub stop_loss: Option<Decimal>,
    #[serde(default, with = "nullable_decimal_string")]
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
    #[serde(default, with = "nullable_decimal_string")]
    pub balance: Option<Decimal>,
    #[serde(default, with = "nullable_decimal_string")]
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
    #[serde(default, with = "nullable_decimal_string")]
    pub tick_value_per_quantity: Option<Decimal>,
    #[serde(default, with = "nullable_decimal_string")]
    pub min_stop_distance: Option<Decimal>,
    pub trade_allowed: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskPolicy {
    pub max_risk_per_trade_basis_points: u32,
    #[serde(default, with = "nullable_decimal_string")]
    pub max_order_quantity: Option<Decimal>,
    pub require_stop_loss: bool,
    #[serde(default)]
    pub allowed_symbols: Vec<String>,
    #[serde(default)]
    pub blocked_symbols: Vec<String>,
}

pub const PROP_RISK_BASIS_POINTS_DENOMINATOR: u32 = 10_000;

/// Broker-neutral prop-firm rules. Profiles such as FTMO are versioned
/// presets of this structure; the evaluator never branches on a firm name.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PropRiskRules {
    pub daily_loss_limit_basis_points: u32,
    pub max_loss_limit_basis_points: u32,
    pub max_risk_per_trade_basis_points: u32,
    pub max_total_open_risk_basis_points: u32,
    pub require_stop_loss: bool,
    pub warning_buffer_basis_points: u32,
    pub emergency_buffer_basis_points: u32,
    #[serde(default)]
    pub daily_profit_target_basis_points: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PropRiskActions {
    pub block_new_orders: bool,
    pub cancel_pending_orders: bool,
    pub close_open_positions: bool,
    pub lock_after_profit_target: bool,
    pub fail_closed_on_stale_data: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PropRiskStatus {
    Protected,
    Warning,
    Locked,
    Breached,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PropRiskReason {
    DailyLossWarning,
    MaxLossWarning,
    DailyLossSafetyBuffer,
    MaxLossSafetyBuffer,
    DailyLossLimitBreached,
    MaxLossLimitBreached,
    DailyProfitTargetReached,
    UnprotectedExposure,
    TelemetryStale,
    StateUnavailable,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PropRiskEvaluationInput {
    pub initial_balance: Decimal,
    pub day_start_balance: Decimal,
    pub balance: Decimal,
    pub equity: Decimal,
    pub previously_locked_reason: Option<PropRiskReason>,
    pub telemetry_stale: bool,
    pub unprotected_exposure: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropRiskEvaluation {
    pub status: PropRiskStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<PropRiskReason>,
    pub can_open_new_orders: bool,
    pub should_cancel_pending_orders: bool,
    pub should_close_open_positions: bool,
    #[serde(with = "rust_decimal::serde::str")]
    pub daily_loss_limit: Decimal,
    #[serde(with = "rust_decimal::serde::str")]
    pub daily_loss_used: Decimal,
    #[serde(with = "rust_decimal::serde::str")]
    pub daily_loss_remaining: Decimal,
    #[serde(with = "rust_decimal::serde::str")]
    pub max_loss_limit: Decimal,
    #[serde(with = "rust_decimal::serde::str")]
    pub max_loss_used: Decimal,
    #[serde(with = "rust_decimal::serde::str")]
    pub max_loss_remaining: Decimal,
    #[serde(default, with = "nullable_decimal_string")]
    pub daily_profit_target: Option<Decimal>,
    #[serde(default, with = "nullable_decimal_string")]
    pub daily_profit_remaining: Option<Decimal>,
    #[serde(with = "rust_decimal::serde::str")]
    pub balance: Decimal,
    #[serde(with = "rust_decimal::serde::str")]
    pub equity: Decimal,
}

impl PropRiskRules {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.daily_loss_limit_basis_points == 0
            || self.daily_loss_limit_basis_points > PROP_RISK_BASIS_POINTS_DENOMINATOR
        {
            return Err("daily loss limit must be between 1 and 10000 basis points");
        }
        if self.max_loss_limit_basis_points == 0
            || self.max_loss_limit_basis_points > PROP_RISK_BASIS_POINTS_DENOMINATOR
        {
            return Err("maximum loss limit must be between 1 and 10000 basis points");
        }
        if self.max_risk_per_trade_basis_points == 0
            || self.max_risk_per_trade_basis_points > self.daily_loss_limit_basis_points
        {
            return Err("per-trade risk must be positive and no greater than the daily limit");
        }
        if self.max_total_open_risk_basis_points == 0
            || self.max_total_open_risk_basis_points > self.daily_loss_limit_basis_points
            || self.max_total_open_risk_basis_points < self.max_risk_per_trade_basis_points
        {
            return Err("total open risk must fit between the per-trade and daily limits");
        }
        if self.emergency_buffer_basis_points > self.warning_buffer_basis_points
            || self.warning_buffer_basis_points >= self.daily_loss_limit_basis_points
            || self.warning_buffer_basis_points >= self.max_loss_limit_basis_points
        {
            return Err("risk buffers must fit inside both loss limits");
        }
        if self
            .daily_profit_target_basis_points
            .is_some_and(|value| value == 0 || value > PROP_RISK_BASIS_POINTS_DENOMINATOR)
        {
            return Err("daily profit target must be between 1 and 10000 basis points");
        }
        Ok(())
    }
}

pub fn prop_risk_money(balance: Decimal, basis_points: u32) -> Decimal {
    balance * Decimal::from(basis_points) / Decimal::from(PROP_RISK_BASIS_POINTS_DENOMINATOR)
}

/// Evaluates fixed initial-capital limits and trading-day limits from live
/// equity. Floating P/L, commission and swap are therefore included whenever
/// the venue includes them in equity.
pub fn evaluate_prop_risk(
    rules: &PropRiskRules,
    actions: &PropRiskActions,
    input: &PropRiskEvaluationInput,
) -> PropRiskEvaluation {
    let daily_loss_limit =
        prop_risk_money(input.initial_balance, rules.daily_loss_limit_basis_points);
    let max_loss_limit = prop_risk_money(input.initial_balance, rules.max_loss_limit_basis_points);
    let daily_floor = input.initial_balance - daily_loss_limit;
    let max_floor = input.initial_balance - max_loss_limit;
    let daily_loss_used = positive(input.day_start_balance - input.equity);
    let max_loss_used = positive(input.initial_balance - input.equity);
    let daily_loss_remaining = input.equity - daily_floor;
    let max_loss_remaining = input.equity - max_floor;
    let daily_profit_target = rules
        .daily_profit_target_basis_points
        .map(|basis_points| prop_risk_money(input.initial_balance, basis_points));
    let daily_profit_remaining = daily_profit_target
        .map(|target| positive(target - (input.equity - input.day_start_balance)));
    let warning_buffer = prop_risk_money(input.initial_balance, rules.warning_buffer_basis_points);
    let emergency_buffer =
        prop_risk_money(input.initial_balance, rules.emergency_buffer_basis_points);

    let locked = |status: PropRiskStatus, reason: PropRiskReason| PropRiskEvaluation {
        status,
        reason: Some(reason),
        can_open_new_orders: !actions.block_new_orders,
        should_cancel_pending_orders: actions.cancel_pending_orders,
        should_close_open_positions: actions.close_open_positions,
        daily_loss_limit,
        daily_loss_used,
        daily_loss_remaining,
        max_loss_limit,
        max_loss_used,
        max_loss_remaining,
        daily_profit_target,
        daily_profit_remaining,
        balance: input.balance,
        equity: input.equity,
    };

    if let Some(reason) = input.previously_locked_reason {
        return locked(PropRiskStatus::Locked, reason);
    }
    if input.telemetry_stale && actions.fail_closed_on_stale_data {
        return locked(PropRiskStatus::Locked, PropRiskReason::TelemetryStale);
    }
    if rules.require_stop_loss && input.unprotected_exposure {
        return locked(PropRiskStatus::Locked, PropRiskReason::UnprotectedExposure);
    }
    if max_loss_remaining <= Decimal::ZERO {
        return locked(
            PropRiskStatus::Breached,
            PropRiskReason::MaxLossLimitBreached,
        );
    }
    if daily_loss_remaining <= Decimal::ZERO {
        return locked(
            PropRiskStatus::Breached,
            PropRiskReason::DailyLossLimitBreached,
        );
    }
    if max_loss_remaining <= emergency_buffer {
        return locked(PropRiskStatus::Locked, PropRiskReason::MaxLossSafetyBuffer);
    }
    if daily_loss_remaining <= emergency_buffer {
        return locked(
            PropRiskStatus::Locked,
            PropRiskReason::DailyLossSafetyBuffer,
        );
    }
    if actions.lock_after_profit_target
        && daily_profit_target
            .is_some_and(|target| input.equity - input.day_start_balance >= target)
    {
        return locked(
            PropRiskStatus::Locked,
            PropRiskReason::DailyProfitTargetReached,
        );
    }

    let warning_reason = if max_loss_remaining <= warning_buffer {
        Some(PropRiskReason::MaxLossWarning)
    } else if daily_loss_remaining <= warning_buffer {
        Some(PropRiskReason::DailyLossWarning)
    } else {
        None
    };
    PropRiskEvaluation {
        status: if warning_reason.is_some() {
            PropRiskStatus::Warning
        } else {
            PropRiskStatus::Protected
        },
        reason: warning_reason,
        can_open_new_orders: true,
        should_cancel_pending_orders: false,
        should_close_open_positions: false,
        daily_loss_limit,
        daily_loss_used,
        daily_loss_remaining,
        max_loss_limit,
        max_loss_used,
        max_loss_remaining,
        daily_profit_target,
        daily_profit_remaining,
        balance: input.balance,
        equity: input.equity,
    }
}

fn positive(value: Decimal) -> Decimal {
    if value > Decimal::ZERO {
        value
    } else {
        Decimal::ZERO
    }
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
    #[serde(default, with = "nullable_decimal_string")]
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
    #[serde(default, with = "nullable_decimal_string")]
    pub limit_price: Option<Decimal>,
    #[serde(default, with = "nullable_decimal_string")]
    pub stop_price: Option<Decimal>,
    #[serde(default, with = "nullable_decimal_string")]
    pub stop_loss: Option<Decimal>,
    #[serde(default, with = "nullable_decimal_string")]
    pub take_profit: Option<Decimal>,
    #[serde(default)]
    pub warnings: Vec<RouteWarning>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RouteWarning {
    QuantityCappedByTarget,
    QuantityCappedByPolicy,
    QuantityCappedByPropRisk,
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
    PropRiskLocked,
    PropRiskLimitExceeded,
    PropRiskStateUnavailable,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ea_version: Option<String>,
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
    ModifyPendingOrder { command: ModifyPendingOrderCommand },
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
    #[serde(default, with = "nullable_decimal_string")]
    pub bid: Option<Decimal>,
    #[serde(default, with = "nullable_decimal_string")]
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
    #[serde(default, with = "nullable_decimal_string")]
    pub stop_loss: Option<Decimal>,
    #[serde(default, with = "nullable_decimal_string")]
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
    #[serde(default, with = "nullable_decimal_string")]
    pub stop_loss: Option<Decimal>,
    #[serde(default, with = "nullable_decimal_string")]
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
    #[serde(default, with = "nullable_decimal_string")]
    pub stop_loss: Option<Decimal>,
    #[serde(default, with = "nullable_decimal_string")]
    pub take_profit: Option<Decimal>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModifyPendingOrderCommand {
    pub command_id: CommandId,
    pub idempotency_key: IdempotencyKey,
    pub target_account_id: AccountId,
    pub broker_order_id: String,
    #[serde(with = "rust_decimal::serde::str")]
    pub price: Decimal,
    #[serde(default, with = "nullable_decimal_string")]
    pub stop_loss: Option<Decimal>,
    #[serde(default, with = "nullable_decimal_string")]
    pub take_profit: Option<Decimal>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosePositionCommand {
    pub command_id: CommandId,
    pub idempotency_key: IdempotencyKey,
    pub target_account_id: AccountId,
    pub broker_position_id: String,
    #[serde(default, with = "nullable_decimal_string")]
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

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct NullableDecimalFixture {
        #[serde(default, with = "nullable_decimal_string")]
        value: Option<Decimal>,
    }

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
            ea_version: Some("1.22".into()),
        }
    }

    #[test]
    fn ea_snapshot_serializes_decimal_as_string() {
        let value = serde_json::to_value(account()).expect("serialize account");
        assert_eq!(value["mode"], "live");
        assert_eq!(value["balance"], "10000.00");
        assert_eq!(value["freeMargin"], "9850.25");
        assert_eq!(value["tradeAllowed"], true);
        assert_eq!(value["eaVersion"], "1.22");
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
    fn pending_order_modification_wire_shape_keeps_prices_as_decimal_strings() {
        let value = serde_json::to_value(EaCommand::ModifyPendingOrder {
            command: ModifyPendingOrderCommand {
                command_id: CommandId::new("modify-pending-1"),
                idempotency_key: IdempotencyKey::new("modify-pending-1"),
                target_account_id: AccountId::new("mt5_account"),
                broker_order_id: "654321".into(),
                price: Decimal::new(110_250, 5),
                stop_loss: Some(Decimal::ZERO),
                take_profit: Some(Decimal::new(112_000, 5)),
            },
        })
        .expect("serialize pending order modification");
        assert_eq!(value["type"], "modifyPendingOrder");
        assert_eq!(value["command"]["brokerOrderId"], "654321");
        assert_eq!(value["command"]["price"], "1.10250");
        assert_eq!(value["command"]["stopLoss"], "0");
        assert_eq!(value["command"]["takeProfit"], "1.12000");
    }

    #[test]
    fn nullable_decimal_string_round_trips_null_missing_and_strings_strictly() {
        let explicit_null = serde_json::from_str::<NullableDecimalFixture>(r#"{"value":null}"#)
            .expect("explicit null must decode");
        let missing = serde_json::from_str::<NullableDecimalFixture>(r#"{}"#)
            .expect("missing optional decimal must decode");
        let decimal = serde_json::from_str::<NullableDecimalFixture>(r#"{"value":"0.26"}"#)
            .expect("decimal string must decode");

        assert_eq!(explicit_null.value, None);
        assert_eq!(missing.value, None);
        assert_eq!(decimal.value, Some(Decimal::new(26, 2)));
        assert_eq!(
            serde_json::to_value(explicit_null).expect("serialize null"),
            serde_json::json!({ "value": null })
        );
        assert_eq!(
            serde_json::to_value(decimal).expect("serialize decimal"),
            serde_json::json!({ "value": "0.26" })
        );
        assert!(serde_json::from_str::<NullableDecimalFixture>(r#"{"value":0.26}"#).is_err());
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

    fn prop_rules() -> PropRiskRules {
        PropRiskRules {
            daily_loss_limit_basis_points: 500,
            max_loss_limit_basis_points: 1_000,
            max_risk_per_trade_basis_points: 100,
            max_total_open_risk_basis_points: 300,
            require_stop_loss: true,
            warning_buffer_basis_points: 100,
            emergency_buffer_basis_points: 25,
            daily_profit_target_basis_points: None,
        }
    }

    fn prop_actions() -> PropRiskActions {
        PropRiskActions {
            block_new_orders: true,
            cancel_pending_orders: true,
            close_open_positions: true,
            lock_after_profit_target: true,
            fail_closed_on_stale_data: true,
        }
    }

    #[test]
    fn prop_risk_uses_fixed_initial_balance_for_daily_allowance() {
        let result = evaluate_prop_risk(
            &prop_rules(),
            &prop_actions(),
            &PropRiskEvaluationInput {
                initial_balance: Decimal::new(100_000, 0),
                day_start_balance: Decimal::new(104_000, 0),
                balance: Decimal::new(104_000, 0),
                equity: Decimal::new(100_000, 0),
                previously_locked_reason: None,
                telemetry_stale: false,
                unprotected_exposure: false,
            },
        );
        assert_eq!(result.daily_loss_limit, Decimal::new(5_000, 0));
        assert_eq!(result.daily_loss_used, Decimal::new(4_000, 0));
        assert_eq!(result.daily_loss_remaining, Decimal::new(5_000, 0));
        assert_eq!(result.status, PropRiskStatus::Protected);
    }

    #[test]
    fn static_drawdown_uses_equity_headroom_to_the_configured_floor() {
        let result = evaluate_prop_risk(
            &prop_rules(),
            &prop_actions(),
            &PropRiskEvaluationInput {
                initial_balance: Decimal::new(50_000, 0),
                day_start_balance: Decimal::new(4_569_807, 2),
                balance: Decimal::new(4_569_807, 2),
                equity: Decimal::new(4_569_807, 2),
                previously_locked_reason: None,
                telemetry_stale: false,
                unprotected_exposure: false,
            },
        );
        assert_eq!(result.daily_loss_limit, Decimal::new(2_500, 0));
        assert_eq!(result.daily_loss_remaining, Decimal::new(-1_801, -93));
        assert_eq!(result.max_loss_limit, Decimal::new(5_000, 0));
        assert_eq!(result.max_loss_remaining, Decimal::new(698, 07));
        assert_eq!(result.status, PropRiskStatus::Breached);
        assert_eq!(result.reason, Some(PropRiskReason::DailyLossLimitBreached));
    }

    #[test]
    fn prop_risk_locks_before_the_official_limit_and_requests_actions() {
        let result = evaluate_prop_risk(
            &prop_rules(),
            &prop_actions(),
            &PropRiskEvaluationInput {
                initial_balance: Decimal::new(100_000, 0),
                day_start_balance: Decimal::new(100_000, 0),
                balance: Decimal::new(100_000, 0),
                equity: Decimal::new(95_200, 0),
                previously_locked_reason: None,
                telemetry_stale: false,
                unprotected_exposure: false,
            },
        );
        assert_eq!(result.status, PropRiskStatus::Locked);
        assert_eq!(result.reason, Some(PropRiskReason::DailyLossSafetyBuffer));
        assert!(!result.can_open_new_orders);
        assert!(result.should_cancel_pending_orders);
        assert!(result.should_close_open_positions);
    }

    #[test]
    fn prop_risk_daily_lock_is_sticky_after_equity_recovers() {
        let result = evaluate_prop_risk(
            &prop_rules(),
            &prop_actions(),
            &PropRiskEvaluationInput {
                initial_balance: Decimal::new(100_000, 0),
                day_start_balance: Decimal::new(100_000, 0),
                balance: Decimal::new(100_000, 0),
                equity: Decimal::new(99_000, 0),
                previously_locked_reason: Some(PropRiskReason::DailyLossSafetyBuffer),
                telemetry_stale: false,
                unprotected_exposure: false,
            },
        );
        assert_eq!(result.status, PropRiskStatus::Locked);
        assert_eq!(result.reason, Some(PropRiskReason::DailyLossSafetyBuffer));
    }

    #[test]
    fn prop_risk_locks_unprotected_exposure_from_outside_the_web() {
        let result = evaluate_prop_risk(
            &prop_rules(),
            &prop_actions(),
            &PropRiskEvaluationInput {
                initial_balance: Decimal::new(100_000, 0),
                day_start_balance: Decimal::new(100_000, 0),
                balance: Decimal::new(100_000, 0),
                equity: Decimal::new(100_000, 0),
                previously_locked_reason: None,
                telemetry_stale: false,
                unprotected_exposure: true,
            },
        );
        assert_eq!(result.status, PropRiskStatus::Locked);
        assert_eq!(result.reason, Some(PropRiskReason::UnprotectedExposure));
        assert!(result.should_close_open_positions);
        assert!(result.should_cancel_pending_orders);
    }
}
