use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};

use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
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
string_id!(CopyGroupId);
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
    FixedQuantity {
        #[serde(with = "rust_decimal::serde::str")]
        quantity: Decimal,
        unit: QuantityUnit,
    },
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

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BrokerMarginBasis {
    Equity,
    Balance,
}

/// A final broker-side margin gate for place commands.
///
/// The EA must estimate the order margin using the broker's live contract
/// specification, divide it by the selected live account value and reject the
/// order when the result exceeds `basis_points`. Server-side sizing and risk
/// checks still run first; this cap protects against broker-specific leverage
/// and symbol-margin rules that only the terminal can evaluate accurately.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrokerMarginCap {
    pub basis: BrokerMarginBasis,
    pub basis_points: u32,
    #[serde(default)]
    pub alert: bool,
}

impl BrokerMarginCap {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !(1..=10_000).contains(&self.basis_points) {
            return Err("broker margin cap must be between 1 and 10000 basis points");
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CopyGroupRuntimeStatus {
    Inactive,
    Starting,
    Active,
    Paused,
    Degraded,
    Error,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CopyTargetRuntimeStatus {
    Inactive,
    Connecting,
    Active,
    Waiting,
    Degraded,
    Error,
}

const fn default_true() -> bool {
    true
}

const fn default_max_slippage_points() -> u32 {
    30
}

const fn default_stale_after_ms() -> u64 {
    30_000
}

const fn default_reconciliation_interval_ms() -> u64 {
    5_000
}

/// Versioned continuous-copy behavior owned by a copy group.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContinuousCopyConfig {
    #[serde(default = "default_true")]
    pub copy_market_orders: bool,
    #[serde(default = "default_true")]
    pub copy_pending_orders: bool,
    #[serde(default = "default_true")]
    pub copy_stop_loss_take_profit: bool,
    #[serde(default = "default_true")]
    pub copy_modifications: bool,
    #[serde(default = "default_true")]
    pub copy_partial_closes: bool,
    #[serde(default)]
    pub source_magic_filter: Option<i64>,
    #[serde(default)]
    pub source_comment_prefix: Option<String>,
    #[serde(default = "default_max_slippage_points")]
    pub max_slippage_points: u32,
    #[serde(default = "default_stale_after_ms")]
    pub stale_after_ms: u64,
    #[serde(default = "default_reconciliation_interval_ms")]
    pub reconciliation_interval_ms: u64,
}

impl Default for ContinuousCopyConfig {
    fn default() -> Self {
        Self {
            copy_market_orders: true,
            copy_pending_orders: true,
            copy_stop_loss_take_profit: true,
            copy_modifications: true,
            copy_partial_closes: true,
            source_magic_filter: None,
            source_comment_prefix: None,
            max_slippage_points: default_max_slippage_points(),
            stale_after_ms: default_stale_after_ms(),
            reconciliation_interval_ms: default_reconciliation_interval_ms(),
        }
    }
}

impl ContinuousCopyConfig {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.stale_after_ms == 0 {
            return Err("copier stale event window must be positive");
        }
        if self.reconciliation_interval_ms == 0 {
            return Err("copier reconciliation interval must be positive");
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CopyProtectionConfig {
    #[serde(default)]
    pub broker_margin_cap: Option<BrokerMarginCap>,
    #[serde(default)]
    pub max_drawdown_basis_points: Option<u32>,
    #[serde(default)]
    pub trailing_stop_points: u32,
    #[serde(default)]
    pub trailing_step_points: u32,
    #[serde(default)]
    pub trailing_start_points: u32,
    #[serde(default)]
    pub breakeven_trigger_points: u32,
    #[serde(default)]
    pub breakeven_offset_points: u32,
}

impl Default for CopyProtectionConfig {
    fn default() -> Self {
        Self {
            // Match the copier's broker-side safety baseline: a target may use
            // at most 35% of balance as estimated margin unless the user
            // explicitly changes the reviewed configuration.
            broker_margin_cap: Some(BrokerMarginCap {
                basis: BrokerMarginBasis::Balance,
                basis_points: 3_500,
                alert: false,
            }),
            max_drawdown_basis_points: None,
            trailing_stop_points: 0,
            trailing_step_points: 5,
            trailing_start_points: 0,
            breakeven_trigger_points: 0,
            breakeven_offset_points: 1,
        }
    }
}

impl CopyProtectionConfig {
    pub fn validate(&self) -> Result<(), &'static str> {
        if let Some(cap) = &self.broker_margin_cap {
            cap.validate()?;
        }
        if self
            .max_drawdown_basis_points
            .is_some_and(|basis_points| !(1..=10_000).contains(&basis_points))
        {
            return Err("copy target maximum drawdown must be between 1 and 10000 basis points");
        }
        if self.trailing_stop_points > 0 && self.trailing_step_points == 0 {
            return Err("copy target trailing step must be positive when trailing is enabled");
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContinuousCopyTargetConfig {
    pub allocation: CopyAllocation,
    #[serde(default, with = "nullable_decimal_string")]
    pub max_quantity: Option<Decimal>,
    #[serde(default)]
    pub reverse_trade: bool,
    #[serde(default)]
    pub symbol_mapping: BTreeMap<String, String>,
    #[serde(default)]
    pub protection: CopyProtectionConfig,
}

impl ContinuousCopyTargetConfig {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self
            .max_quantity
            .is_some_and(|quantity| quantity <= Decimal::ZERO)
        {
            return Err("copy target maximum quantity must be positive");
        }
        match &self.allocation {
            CopyAllocation::SameQuantity => {}
            CopyAllocation::FixedQuantity { quantity, .. } if *quantity > Decimal::ZERO => {}
            CopyAllocation::Multiplier { multiplier }
            | CopyAllocation::EquityProportional { multiplier }
                if *multiplier > Decimal::ZERO => {}
            CopyAllocation::RiskPercent { basis_points } if (1..=10_000).contains(basis_points) => {
            }
            CopyAllocation::FixedQuantity { .. } => {
                return Err("fixed copy quantity must be positive");
            }
            CopyAllocation::Multiplier { .. } | CopyAllocation::EquityProportional { .. } => {
                return Err("copy allocation multiplier must be positive");
            }
            CopyAllocation::RiskPercent { .. } => {
                return Err("copy risk allocation must be between 1 and 10000 basis points");
            }
        }
        self.protection.validate()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CopyGroupWriteRequest {
    #[serde(default)]
    pub expected_revision: Option<u64>,
    pub name: String,
    pub source_account_id: AccountId,
    pub enabled: bool,
    #[serde(default)]
    pub config: ContinuousCopyConfig,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CopyTargetWriteRequest {
    #[serde(default)]
    pub expected_revision: Option<u64>,
    pub account_id: AccountId,
    pub enabled: bool,
    pub config: ContinuousCopyTargetConfig,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyGroupDefinition {
    pub id: CopyGroupId,
    pub owner_id: String,
    pub name: String,
    pub source_account_id: AccountId,
    pub enabled: bool,
    pub revision: u64,
    pub applied_revision: u64,
    pub runtime_status: CopyGroupRuntimeStatus,
    #[serde(default)]
    pub config: ContinuousCopyConfig,
    #[serde(default)]
    pub status_message: Option<String>,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyTargetDefinition {
    pub group_id: CopyGroupId,
    pub account_id: AccountId,
    pub enabled: bool,
    pub revision: u64,
    pub applied_revision: u64,
    pub runtime_status: CopyTargetRuntimeStatus,
    pub config: ContinuousCopyTargetConfig,
    #[serde(default)]
    pub status_message: Option<String>,
    pub updated_at_ms: u64,
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

/// Selects the balance anchor used by a daily-loss objective. The evaluator
/// branches on this data strategy, never on a prop-firm/provider name.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PropRiskDailyLossReference {
    #[default]
    StartOfDayBalance,
    InitialBalance,
}

/// Selects how the maximum-loss floor moves between trading days.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PropRiskMaxLossMode {
    #[default]
    Static,
    EndOfDayTrailing,
}

/// Describes how much historical evidence backs aggregate objectives. The
/// current MT5 transport can only prove samples observed after the guard was
/// enabled; callers must not present those aggregates as authoritative firm
/// history.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PropRiskHistoryQuality {
    #[default]
    TrackedSinceGuardEnabled,
    Authoritative,
}

/// Broker-neutral prop-firm rules. Provider profiles are versioned presets of
/// this structure; the evaluator never branches on a firm name.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PropRiskRules {
    pub daily_loss_limit_basis_points: u32,
    pub max_loss_limit_basis_points: u32,
    #[serde(default)]
    pub daily_loss_reference: PropRiskDailyLossReference,
    #[serde(default)]
    pub max_loss_mode: PropRiskMaxLossMode,
    pub max_risk_per_trade_basis_points: u32,
    pub max_total_open_risk_basis_points: u32,
    pub require_stop_loss: bool,
    pub warning_buffer_basis_points: u32,
    pub emergency_buffer_basis_points: u32,
    #[serde(default)]
    pub daily_profit_target_basis_points: Option<u32>,
    /// Overall evaluation target measured from initial capital. This is
    /// deliberately separate from the optional per-day safety lock above.
    #[serde(default)]
    pub profit_target_basis_points: Option<u32>,
    /// Maximum share of positive-days profit that the best day may represent.
    #[serde(default)]
    pub best_day_limit_basis_points: Option<u32>,
    #[serde(default)]
    pub minimum_trading_days: Option<u32>,
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
    /// Highest eligible loss reference for the current day. Static profiles
    /// ignore this value; EOD-trailing profiles clamp it to initial capital.
    pub max_loss_reference_balance: Decimal,
    /// Lowest equity already observed for the current trading day.
    pub current_day_min_equity: Decimal,
    /// Worst maximum-loss result observed before the current live sample.
    pub historical_max_loss_result: Decimal,
    /// Closed positive-day totals from completed prior trading days.
    pub prior_positive_days_profit: Decimal,
    pub prior_best_day_profit: Decimal,
    pub history_quality: PropRiskHistoryQuality,
    /// `None` means the transport cannot prove the firm's trading-day count.
    pub trading_days: Option<u32>,
    pub has_open_positions: bool,
    pub balance: Decimal,
    pub equity: Decimal,
    pub previously_locked_reason: Option<PropRiskReason>,
    pub telemetry_stale: bool,
    pub unprotected_exposure: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropRiskEvaluation {
    /// Allows persisted JSON produced by an older evaluator to be rejected
    /// without guessing whether newly added objective fields are trustworthy.
    #[serde(default)]
    pub model_version: u32,
    #[serde(default)]
    pub history_quality: PropRiskHistoryQuality,
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
    #[serde(default, with = "rust_decimal::serde::str")]
    pub max_loss_reference_balance: Decimal,
    #[serde(default, with = "rust_decimal::serde::str")]
    pub daily_loss_result: Decimal,
    #[serde(default, with = "rust_decimal::serde::str")]
    pub max_loss_result: Decimal,
    #[serde(default, with = "nullable_decimal_string")]
    pub daily_profit_target: Option<Decimal>,
    #[serde(default, with = "nullable_decimal_string")]
    pub daily_profit_remaining: Option<Decimal>,
    #[serde(default, with = "nullable_decimal_string")]
    pub profit_target: Option<Decimal>,
    #[serde(default, with = "nullable_decimal_string")]
    pub profit_target_result: Option<Decimal>,
    #[serde(default, with = "nullable_decimal_string")]
    pub profit_target_remaining: Option<Decimal>,
    #[serde(default)]
    pub profit_target_met: Option<bool>,
    #[serde(default, with = "nullable_decimal_string")]
    pub positive_days_profit: Option<Decimal>,
    #[serde(default, with = "nullable_decimal_string")]
    pub best_day_profit: Option<Decimal>,
    #[serde(default)]
    pub best_day_ratio_basis_points: Option<u32>,
    #[serde(default)]
    pub best_day_met: Option<bool>,
    #[serde(default)]
    pub minimum_trading_days: Option<u32>,
    #[serde(default)]
    pub trading_days: Option<u32>,
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
        if self
            .profit_target_basis_points
            .is_some_and(|value| value == 0 || value > PROP_RISK_BASIS_POINTS_DENOMINATOR)
        {
            return Err("profit target must be between 1 and 10000 basis points");
        }
        if self
            .best_day_limit_basis_points
            .is_some_and(|value| value == 0 || value > PROP_RISK_BASIS_POINTS_DENOMINATOR)
        {
            return Err("best-day limit must be between 1 and 10000 basis points");
        }
        if self
            .minimum_trading_days
            .is_some_and(|value| value == 0 || value > 365)
        {
            return Err("minimum trading days must be between 1 and 365");
        }
        Ok(())
    }
}

pub fn prop_risk_money(balance: Decimal, basis_points: u32) -> Decimal {
    balance * Decimal::from(basis_points) / Decimal::from(PROP_RISK_BASIS_POINTS_DENOMINATOR)
}

/// Returns whether a sticky daily lock created by the legacy initial-balance
/// daily-floor formula can be cleared without weakening the configured guard.
/// The recorded minimum equity must have remained strictly above both
/// corrected emergency floors for the entire observed trading day.
pub fn should_repair_legacy_prop_risk_daily_lock(
    rules: &PropRiskRules,
    actions: &PropRiskActions,
    initial_balance: Decimal,
    day_start_balance: Decimal,
    min_equity: Decimal,
    reason: PropRiskReason,
) -> bool {
    if actions.lock_after_profit_target
        || !matches!(
            reason,
            PropRiskReason::DailyLossLimitBreached | PropRiskReason::DailyLossSafetyBuffer
        )
    {
        return false;
    }

    let daily_loss_limit = prop_risk_money(initial_balance, rules.daily_loss_limit_basis_points);
    let max_loss_limit = prop_risk_money(initial_balance, rules.max_loss_limit_basis_points);
    let emergency_buffer = prop_risk_money(initial_balance, rules.emergency_buffer_basis_points);
    let corrected_daily_emergency_floor = day_start_balance - daily_loss_limit + emergency_buffer;
    let max_emergency_floor = initial_balance - max_loss_limit + emergency_buffer;

    min_equity > corrected_daily_emergency_floor && min_equity > max_emergency_floor
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
    let daily_loss_reference = match rules.daily_loss_reference {
        PropRiskDailyLossReference::StartOfDayBalance => input.day_start_balance,
        PropRiskDailyLossReference::InitialBalance => input.initial_balance,
    };
    let max_loss_reference_balance = match rules.max_loss_mode {
        PropRiskMaxLossMode::Static => input.initial_balance,
        PropRiskMaxLossMode::EndOfDayTrailing => {
            if input.max_loss_reference_balance > input.initial_balance {
                input.max_loss_reference_balance
            } else {
                input.initial_balance
            }
        }
    };
    let daily_floor = daily_loss_reference - daily_loss_limit;
    let max_floor = max_loss_reference_balance - max_loss_limit;
    let daily_loss_used = positive(daily_loss_reference - input.equity);
    let max_loss_used = positive(max_loss_reference_balance - input.equity);
    let daily_loss_remaining = input.equity - daily_floor;
    let max_loss_remaining = input.equity - max_floor;
    let observed_min_equity = if input.current_day_min_equity < input.equity {
        input.current_day_min_equity
    } else {
        input.equity
    };
    let daily_loss_result = non_positive(observed_min_equity - daily_loss_reference);
    let live_max_loss_result = non_positive(observed_min_equity - max_loss_reference_balance);
    let max_loss_result = if input.historical_max_loss_result < live_max_loss_result {
        input.historical_max_loss_result
    } else {
        live_max_loss_result
    };
    let daily_profit_target = rules
        .daily_profit_target_basis_points
        .map(|basis_points| prop_risk_money(input.initial_balance, basis_points));
    let daily_profit_remaining = daily_profit_target
        .map(|target| positive(target - (input.equity - input.day_start_balance)));
    let profit_target = rules
        .profit_target_basis_points
        .map(|basis_points| prop_risk_money(input.initial_balance, basis_points));
    let profit_result = input.balance - input.initial_balance;
    let profit_target_result = profit_target.map(|_| profit_result);
    let profit_target_remaining = profit_target.map(|target| positive(target - profit_result));
    let profit_target_met =
        profit_target.map(|target| profit_result >= target && !input.has_open_positions);
    let current_positive_day_profit = positive(input.balance - input.day_start_balance);
    let positive_days_profit = rules
        .best_day_limit_basis_points
        .map(|_| input.prior_positive_days_profit + current_positive_day_profit);
    let best_day_profit = rules.best_day_limit_basis_points.map(|_| {
        if input.prior_best_day_profit > current_positive_day_profit {
            input.prior_best_day_profit
        } else {
            current_positive_day_profit
        }
    });
    let best_day_ratio_basis_points =
        best_day_profit
            .zip(positive_days_profit)
            .map(|(best_day, positive_days)| {
                if positive_days <= Decimal::ZERO {
                    0
                } else {
                    (best_day * Decimal::from(PROP_RISK_BASIS_POINTS_DENOMINATOR) / positive_days)
                        .round_dp(0)
                        .to_u32()
                        .unwrap_or(PROP_RISK_BASIS_POINTS_DENOMINATOR)
                        .min(PROP_RISK_BASIS_POINTS_DENOMINATOR)
                }
            });
    let best_day_met = rules.best_day_limit_basis_points.map(|limit| {
        positive_days_profit.is_some_and(|profit| profit > Decimal::ZERO)
            && best_day_ratio_basis_points.is_some_and(|ratio| ratio <= limit)
    });
    let warning_buffer = prop_risk_money(input.initial_balance, rules.warning_buffer_basis_points);
    let emergency_buffer =
        prop_risk_money(input.initial_balance, rules.emergency_buffer_basis_points);

    let locked = |status: PropRiskStatus, reason: PropRiskReason| PropRiskEvaluation {
        model_version: 2,
        history_quality: input.history_quality,
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
        max_loss_reference_balance,
        daily_loss_result,
        max_loss_result,
        daily_profit_target,
        daily_profit_remaining,
        profit_target,
        profit_target_result,
        profit_target_remaining,
        profit_target_met,
        positive_days_profit,
        best_day_profit,
        best_day_ratio_basis_points,
        best_day_met,
        minimum_trading_days: rules.minimum_trading_days,
        trading_days: input.trading_days,
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
        model_version: 2,
        history_quality: input.history_quality,
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
        max_loss_reference_balance,
        daily_loss_result,
        max_loss_result,
        daily_profit_target,
        daily_profit_remaining,
        profit_target,
        profit_target_result,
        profit_target_remaining,
        profit_target_met,
        positive_days_profit,
        best_day_profit,
        best_day_ratio_basis_points,
        best_day_met,
        minimum_trading_days: rules.minimum_trading_days,
        trading_days: input.trading_days,
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

fn non_positive(value: Decimal) -> Decimal {
    if value < Decimal::ZERO {
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub broker_margin_cap: Option<BrokerMarginCap>,
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
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        external_event_id: Option<String>,
        #[serde(
            default,
            alias = "transactionSequence",
            skip_serializing_if = "Option::is_none"
        )]
        event_sequence: Option<u64>,
        broker_order_id: Option<String>,
        broker_deal_id: Option<String>,
        broker_position_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        broker_position_by_id: Option<String>,
        transaction_type: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        transaction_time_ms: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        order_state: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        order_type: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        deal_entry: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        deal_type: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        canonical_symbol: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        venue_symbol: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        side: Option<Side>,
        #[serde(
            default,
            alias = "volume",
            with = "nullable_decimal_string",
            skip_serializing_if = "Option::is_none"
        )]
        quantity: Option<Decimal>,
        #[serde(
            default,
            with = "nullable_decimal_string",
            skip_serializing_if = "Option::is_none"
        )]
        remaining_quantity: Option<Decimal>,
        #[serde(
            default,
            with = "nullable_decimal_string",
            skip_serializing_if = "Option::is_none"
        )]
        price: Option<Decimal>,
        #[serde(
            default,
            with = "nullable_decimal_string",
            skip_serializing_if = "Option::is_none"
        )]
        stop_loss: Option<Decimal>,
        #[serde(
            default,
            with = "nullable_decimal_string",
            skip_serializing_if = "Option::is_none"
        )]
        take_profit: Option<Decimal>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        magic: Option<i64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        comment: Option<String>,
        #[serde(
            default,
            alias = "orderReason",
            skip_serializing_if = "Option::is_none"
        )]
        reason: Option<String>,
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
    fn fixed_quantity_copy_allocation_uses_strict_camel_case_wire_shape() {
        let allocation = CopyAllocation::FixedQuantity {
            quantity: Decimal::new(25, 2),
            unit: QuantityUnit::Lots,
        };
        let value = serde_json::to_value(&allocation).expect("serialize fixed allocation");
        assert_eq!(
            value,
            serde_json::json!({
                "mode": "fixedQuantity",
                "quantity": "0.25",
                "unit": "lots"
            })
        );
        assert_eq!(
            serde_json::from_value::<CopyAllocation>(value).expect("deserialize fixed allocation"),
            allocation
        );
        assert!(
            serde_json::from_value::<CopyAllocation>(serde_json::json!({
                "mode": "fixedQuantity",
                "quantity": 0.25,
                "unit": "lots"
            }))
            .is_err()
        );
    }

    #[test]
    fn broker_margin_cap_has_explicit_basis_and_validates_basis_points() {
        let cap = BrokerMarginCap {
            basis: BrokerMarginBasis::Equity,
            basis_points: 3_500,
            alert: true,
        };
        assert_eq!(cap.validate(), Ok(()));
        assert_eq!(
            serde_json::to_value(&cap).expect("serialize broker margin cap"),
            serde_json::json!({
                "basis": "equity",
                "basisPoints": 3500,
                "alert": true
            })
        );

        let invalid = BrokerMarginCap {
            basis: BrokerMarginBasis::Balance,
            basis_points: 10_001,
            alert: false,
        };
        assert_eq!(
            invalid.validate(),
            Err("broker margin cap must be between 1 and 10000 basis points")
        );
    }

    #[test]
    fn continuous_copy_config_uses_safe_lifecycle_defaults() {
        let config = serde_json::from_value::<ContinuousCopyConfig>(serde_json::json!({}))
            .expect("deserialize default continuous copier config");
        assert_eq!(config, ContinuousCopyConfig::default());
        assert!(config.copy_market_orders);
        assert!(config.copy_pending_orders);
        assert!(config.copy_modifications);
        assert!(config.copy_partial_closes);
        assert_eq!(config.max_slippage_points, 30);
        assert_eq!(config.reconciliation_interval_ms, 5_000);
    }

    #[test]
    fn legacy_trade_transaction_remains_wire_compatible() {
        let legacy = serde_json::json!({
            "type": "tradeTransaction",
            "brokerOrderId": "order-1",
            "brokerDealId": null,
            "brokerPositionId": "position-1",
            "transactionType": "dealAdd",
            "occurredAtMs": 123
        });
        let event = serde_json::from_value::<EaEvent>(legacy).expect("deserialize legacy event");
        let value = serde_json::to_value(event).expect("serialize legacy event");
        assert_eq!(value["transactionType"], "dealAdd");
        assert_eq!(value["occurredAtMs"], 123);
        assert!(value.get("externalEventId").is_none());
        assert!(value.get("quantity").is_none());
    }

    #[test]
    fn enriched_trade_transaction_uses_strict_decimal_strings() {
        let enriched = serde_json::json!({
            "type": "tradeTransaction",
            "externalEventId": "123:456:dealAdd",
            "brokerOrderId": "123",
            "brokerDealId": "456",
            "brokerPositionId": "789",
            "transactionType": "dealAdd",
            "dealEntry": "in",
            "canonicalSymbol": "XAUUSD",
            "venueSymbol": "XAUUSD.a",
            "side": "buy",
            "quantity": "0.25",
            "remainingQuantity": "0",
            "price": "2375.50",
            "stopLoss": "2360",
            "takeProfit": "2400",
            "magic": 42,
            "comment": "master",
            "occurredAtMs": 456
        });
        let event = serde_json::from_value::<EaEvent>(enriched.clone())
            .expect("deserialize enriched event");
        assert_eq!(
            serde_json::to_value(event).expect("serialize enriched event"),
            enriched
        );

        let mut numeric_quantity = enriched;
        numeric_quantity["quantity"] = serde_json::json!(0.25);
        assert!(serde_json::from_value::<EaEvent>(numeric_quantity).is_err());
    }

    #[test]
    fn compiled_ea_trade_transaction_aliases_decode_without_duplicate_fields() {
        let payload = serde_json::json!({
            "type": "tradeTransaction",
            "brokerOrderId": "123",
            "brokerDealId": "456",
            "brokerPositionId": "789",
            "brokerPositionById": "790",
            "transactionType": "TRADE_TRANSACTION_DEAL_ADD",
            "transactionSequence": 7,
            "transactionTimeMs": 450,
            "venueSymbol": "EURUSD.a",
            "side": "buy",
            "orderType": "ORDER_TYPE_BUY",
            "orderState": null,
            "orderReason": "ORDER_REASON_EXPERT",
            "dealType": "DEAL_TYPE_BUY",
            "volume": "0.25",
            "price": "1.10500",
            "stopLoss": null,
            "takeProfit": "1.12000",
            "occurredAtMs": 456
        });
        let event = serde_json::from_value::<EaEvent>(payload)
            .expect("compiled EA payload must deserialize");
        match event {
            EaEvent::TradeTransaction {
                event_sequence,
                broker_position_id,
                broker_position_by_id,
                transaction_time_ms,
                quantity,
                reason,
                occurred_at_ms,
                ..
            } => {
                assert_eq!(event_sequence, Some(7));
                assert_eq!(broker_position_id.as_deref(), Some("789"));
                assert_eq!(broker_position_by_id.as_deref(), Some("790"));
                assert_eq!(transaction_time_ms, Some(450));
                assert_eq!(quantity, Some(Decimal::new(25, 2)));
                assert_eq!(reason.as_deref(), Some("ORDER_REASON_EXPERT"));
                assert_eq!(occurred_at_ms, 456);
            }
            _ => panic!("expected trade transaction"),
        }
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
            daily_loss_reference: PropRiskDailyLossReference::StartOfDayBalance,
            max_loss_mode: PropRiskMaxLossMode::Static,
            max_risk_per_trade_basis_points: 100,
            max_total_open_risk_basis_points: 300,
            require_stop_loss: true,
            warning_buffer_basis_points: 100,
            emergency_buffer_basis_points: 25,
            daily_profit_target_basis_points: None,
            profit_target_basis_points: None,
            best_day_limit_basis_points: None,
            minimum_trading_days: None,
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
                max_loss_reference_balance: Decimal::new(100_000, 0),
                current_day_min_equity: Decimal::new(100_000, 0),
                historical_max_loss_result: Decimal::ZERO,
                prior_positive_days_profit: Decimal::ZERO,
                prior_best_day_profit: Decimal::ZERO,
                history_quality: PropRiskHistoryQuality::TrackedSinceGuardEnabled,
                trading_days: None,
                has_open_positions: false,
                balance: Decimal::new(104_000, 0),
                equity: Decimal::new(100_000, 0),
                previously_locked_reason: None,
                telemetry_stale: false,
                unprotected_exposure: false,
            },
        );
        assert_eq!(result.daily_loss_limit, Decimal::new(5_000, 0));
        assert_eq!(result.daily_loss_used, Decimal::new(4_000, 0));
        assert_eq!(result.daily_loss_remaining, Decimal::new(1_000, 0));
        assert_eq!(result.status, PropRiskStatus::Warning);
        assert_eq!(result.reason, Some(PropRiskReason::DailyLossWarning));
    }

    #[test]
    fn static_drawdown_uses_equity_headroom_to_the_configured_floor() {
        let result = evaluate_prop_risk(
            &prop_rules(),
            &prop_actions(),
            &PropRiskEvaluationInput {
                initial_balance: Decimal::new(50_000, 0),
                day_start_balance: Decimal::new(4_569_807, 2),
                max_loss_reference_balance: Decimal::new(50_000, 0),
                current_day_min_equity: Decimal::new(4_569_807, 2),
                historical_max_loss_result: Decimal::ZERO,
                prior_positive_days_profit: Decimal::ZERO,
                prior_best_day_profit: Decimal::ZERO,
                history_quality: PropRiskHistoryQuality::TrackedSinceGuardEnabled,
                trading_days: None,
                has_open_positions: false,
                balance: Decimal::new(4_569_807, 2),
                equity: Decimal::new(4_569_807, 2),
                previously_locked_reason: None,
                telemetry_stale: false,
                unprotected_exposure: false,
            },
        );
        assert_eq!(result.daily_loss_limit, Decimal::new(2_500, 0));
        assert_eq!(result.daily_loss_remaining, Decimal::new(2_500, 0));
        assert_eq!(result.max_loss_limit, Decimal::new(5_000, 0));
        assert_eq!(result.max_loss_remaining, Decimal::new(69_807, 2));
        assert_eq!(result.status, PropRiskStatus::Protected);
        assert_eq!(result.reason, None);
    }

    #[test]
    fn prop_risk_matches_reported_drawdown_vector() {
        let result = evaluate_prop_risk(
            &prop_rules(),
            &prop_actions(),
            &PropRiskEvaluationInput {
                initial_balance: Decimal::new(50_000, 0),
                day_start_balance: Decimal::new(4_667_594, 2),
                max_loss_reference_balance: Decimal::new(50_000, 0),
                current_day_min_equity: Decimal::new(4_594_647, 2),
                historical_max_loss_result: Decimal::ZERO,
                prior_positive_days_profit: Decimal::ZERO,
                prior_best_day_profit: Decimal::ZERO,
                history_quality: PropRiskHistoryQuality::TrackedSinceGuardEnabled,
                trading_days: None,
                has_open_positions: false,
                balance: Decimal::new(4_569_807, 2),
                equity: Decimal::new(4_594_647, 2),
                previously_locked_reason: None,
                telemetry_stale: false,
                unprotected_exposure: false,
            },
        );
        assert_eq!(result.daily_loss_limit, Decimal::new(2_500, 0));
        assert_eq!(result.daily_loss_used, Decimal::new(72_947, 2));
        assert_eq!(result.daily_loss_remaining, Decimal::new(177_053, 2));
        assert_eq!(result.max_loss_remaining, Decimal::new(94_647, 2));
        assert_eq!(result.status, PropRiskStatus::Protected);
        assert_eq!(result.reason, None);
    }

    #[test]
    fn generic_eod_trailing_objectives_match_the_reported_one_step_vector() {
        let mut rules = prop_rules();
        rules.daily_loss_limit_basis_points = 300;
        rules.max_loss_mode = PropRiskMaxLossMode::EndOfDayTrailing;
        rules.profit_target_basis_points = Some(1_000);
        rules.best_day_limit_basis_points = Some(5_000);
        rules.minimum_trading_days = None;
        let mut actions = prop_actions();
        actions.lock_after_profit_target = false;

        let result = evaluate_prop_risk(
            &rules,
            &actions,
            &PropRiskEvaluationInput {
                initial_balance: Decimal::new(50_000, 0),
                day_start_balance: Decimal::new(4_683_885, 2),
                max_loss_reference_balance: Decimal::new(5_018_567, 2),
                current_day_min_equity: Decimal::new(4_586_098, 2),
                historical_max_loss_result: Decimal::new(-432_469, 2),
                prior_positive_days_profit: Decimal::new(244_954, 2),
                prior_best_day_profit: Decimal::new(67_246, 2),
                history_quality: PropRiskHistoryQuality::Authoritative,
                trading_days: None,
                has_open_positions: false,
                balance: Decimal::new(4_586_098, 2),
                equity: Decimal::new(4_586_098, 2),
                previously_locked_reason: None,
                telemetry_stale: false,
                unprotected_exposure: false,
            },
        );

        assert_eq!(result.daily_loss_limit, Decimal::new(1_500, 0));
        assert_eq!(result.daily_loss_result, Decimal::new(-97_787, 2));
        assert_eq!(result.daily_loss_remaining, Decimal::new(52_213, 2));
        assert_eq!(
            result.max_loss_reference_balance,
            Decimal::new(5_018_567, 2)
        );
        assert_eq!(result.max_loss_result, Decimal::new(-432_469, 2));
        assert_eq!(result.max_loss_remaining, Decimal::new(67_531, 2));
        assert_eq!(result.profit_target, Some(Decimal::new(5_000, 0)));
        assert_eq!(result.profit_target_result, Some(Decimal::new(-413_902, 2)));
        assert_eq!(
            result.profit_target_remaining,
            Some(Decimal::new(913_902, 2))
        );
        assert_eq!(result.best_day_ratio_basis_points, Some(2_745));
        assert_eq!(result.best_day_met, Some(true));
        assert_eq!(
            result.history_quality,
            PropRiskHistoryQuality::Authoritative
        );
    }

    #[test]
    fn overall_profit_target_requires_closed_positions() {
        let mut rules = prop_rules();
        rules.profit_target_basis_points = Some(1_000);
        let input = PropRiskEvaluationInput {
            initial_balance: Decimal::new(50_000, 0),
            day_start_balance: Decimal::new(55_000, 0),
            max_loss_reference_balance: Decimal::new(50_000, 0),
            current_day_min_equity: Decimal::new(55_000, 0),
            historical_max_loss_result: Decimal::ZERO,
            prior_positive_days_profit: Decimal::ZERO,
            prior_best_day_profit: Decimal::ZERO,
            history_quality: PropRiskHistoryQuality::TrackedSinceGuardEnabled,
            trading_days: None,
            has_open_positions: true,
            balance: Decimal::new(55_000, 0),
            equity: Decimal::new(55_000, 0),
            previously_locked_reason: None,
            telemetry_stale: false,
            unprotected_exposure: false,
        };

        let open_result = evaluate_prop_risk(&rules, &prop_actions(), &input);
        assert_eq!(open_result.profit_target_met, Some(false));

        let closed_result = evaluate_prop_risk(
            &rules,
            &prop_actions(),
            &PropRiskEvaluationInput {
                has_open_positions: false,
                ..input
            },
        );
        assert_eq!(closed_result.profit_target_met, Some(true));
    }

    #[test]
    fn legacy_daily_lock_repair_requires_a_daily_reason_and_no_profit_target_lock() {
        let rules = prop_rules();
        let mut actions = prop_actions();
        actions.lock_after_profit_target = false;
        let initial_balance = Decimal::new(100_000, 0);
        let day_start_balance = Decimal::new(104_000, 0);
        let safe_min_equity = Decimal::new(9_925_001, 2);

        assert!(should_repair_legacy_prop_risk_daily_lock(
            &rules,
            &actions,
            initial_balance,
            day_start_balance,
            safe_min_equity,
            PropRiskReason::DailyLossLimitBreached,
        ));
        assert!(should_repair_legacy_prop_risk_daily_lock(
            &rules,
            &actions,
            initial_balance,
            day_start_balance,
            safe_min_equity,
            PropRiskReason::DailyLossSafetyBuffer,
        ));
        assert!(!should_repair_legacy_prop_risk_daily_lock(
            &rules,
            &actions,
            initial_balance,
            day_start_balance,
            safe_min_equity,
            PropRiskReason::MaxLossSafetyBuffer,
        ));

        actions.lock_after_profit_target = true;
        assert!(!should_repair_legacy_prop_risk_daily_lock(
            &rules,
            &actions,
            initial_balance,
            day_start_balance,
            safe_min_equity,
            PropRiskReason::DailyLossLimitBreached,
        ));
    }

    #[test]
    fn legacy_daily_lock_repair_requires_equity_strictly_above_both_emergency_floors() {
        let rules = prop_rules();
        let mut actions = prop_actions();
        actions.lock_after_profit_target = false;
        let initial_balance = Decimal::new(100_000, 0);

        // A profitable day makes the corrected daily emergency floor binding.
        let profitable_day_start = Decimal::new(104_000, 0);
        let daily_emergency_floor = Decimal::new(99_250, 0);
        assert!(!should_repair_legacy_prop_risk_daily_lock(
            &rules,
            &actions,
            initial_balance,
            profitable_day_start,
            daily_emergency_floor,
            PropRiskReason::DailyLossSafetyBuffer,
        ));
        assert!(should_repair_legacy_prop_risk_daily_lock(
            &rules,
            &actions,
            initial_balance,
            profitable_day_start,
            daily_emergency_floor + Decimal::new(1, 2),
            PropRiskReason::DailyLossSafetyBuffer,
        ));

        // A prior-loss day makes the static maximum-loss emergency floor binding.
        let prior_loss_day_start = Decimal::new(94_000, 0);
        let max_emergency_floor = Decimal::new(90_250, 0);
        assert!(!should_repair_legacy_prop_risk_daily_lock(
            &rules,
            &actions,
            initial_balance,
            prior_loss_day_start,
            max_emergency_floor,
            PropRiskReason::DailyLossLimitBreached,
        ));
        assert!(should_repair_legacy_prop_risk_daily_lock(
            &rules,
            &actions,
            initial_balance,
            prior_loss_day_start,
            max_emergency_floor + Decimal::new(1, 2),
            PropRiskReason::DailyLossLimitBreached,
        ));
    }

    #[test]
    fn prop_risk_locks_before_the_official_limit_and_requests_actions() {
        let result = evaluate_prop_risk(
            &prop_rules(),
            &prop_actions(),
            &PropRiskEvaluationInput {
                initial_balance: Decimal::new(100_000, 0),
                day_start_balance: Decimal::new(100_000, 0),
                max_loss_reference_balance: Decimal::new(100_000, 0),
                current_day_min_equity: Decimal::new(95_200, 0),
                historical_max_loss_result: Decimal::ZERO,
                prior_positive_days_profit: Decimal::ZERO,
                prior_best_day_profit: Decimal::ZERO,
                history_quality: PropRiskHistoryQuality::TrackedSinceGuardEnabled,
                trading_days: None,
                has_open_positions: false,
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
                max_loss_reference_balance: Decimal::new(100_000, 0),
                current_day_min_equity: Decimal::new(95_200, 0),
                historical_max_loss_result: Decimal::ZERO,
                prior_positive_days_profit: Decimal::ZERO,
                prior_best_day_profit: Decimal::ZERO,
                history_quality: PropRiskHistoryQuality::TrackedSinceGuardEnabled,
                trading_days: None,
                has_open_positions: false,
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
                max_loss_reference_balance: Decimal::new(100_000, 0),
                current_day_min_equity: Decimal::new(100_000, 0),
                historical_max_loss_result: Decimal::ZERO,
                prior_positive_days_profit: Decimal::ZERO,
                prior_best_day_profit: Decimal::ZERO,
                history_quality: PropRiskHistoryQuality::TrackedSinceGuardEnabled,
                trading_days: None,
                has_open_positions: false,
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
