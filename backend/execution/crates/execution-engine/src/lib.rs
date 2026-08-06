use execution_domain::{
    AccountStatus, CommandId, CopyAllocation, IdempotencyKey, OrderIntent, OrderSizing,
    QuantityUnit, RouteRejectCode, RouteTargetContext, RouteWarning, RoutedOrder, Side,
    TargetRouteResult,
};
use rust_decimal::Decimal;

const BASIS_POINTS_DENOMINATOR: u32 = 10_000;

/// Route one intent to every target independently. This is intentionally not a
/// distributed transaction: one venue can fill while another rejects, and both
/// outcomes must remain visible and auditable.
pub fn route_order(
    intent: &OrderIntent,
    source_equity: Option<Decimal>,
    targets: &[RouteTargetContext],
) -> Vec<TargetRouteResult> {
    targets
        .iter()
        .map(|target| route_target(intent, source_equity, target))
        .collect()
}

fn route_target(
    intent: &OrderIntent,
    source_equity: Option<Decimal>,
    target: &RouteTargetContext,
) -> TargetRouteResult {
    let account_id = target.account.id.clone();
    let reject = |code, message: &str| TargetRouteResult::Rejected {
        account_id: account_id.clone(),
        code,
        message: message.to_owned(),
    };

    if !target.copy_target.enabled {
        return reject(RouteRejectCode::TargetDisabled, "copy target is disabled");
    }
    if target.account.status != AccountStatus::Ready {
        return reject(
            RouteRejectCode::AccountNotReady,
            "target account is not ready",
        );
    }
    if !target.account.trade_allowed {
        return reject(
            RouteRejectCode::AccountCannotTrade,
            "target account does not allow trading",
        );
    }
    if !target.instrument.trade_allowed {
        return reject(
            RouteRejectCode::SymbolNotTradable,
            "instrument is not tradable at the target venue",
        );
    }
    if !target.policy.allowed_symbols.is_empty()
        && !contains_symbol(&target.policy.allowed_symbols, &intent.canonical_symbol)
    {
        return reject(
            RouteRejectCode::SymbolNotAllowed,
            "instrument is not in the account allow-list",
        );
    }
    if contains_symbol(&target.policy.blocked_symbols, &intent.canonical_symbol) {
        return reject(
            RouteRejectCode::SymbolBlocked,
            "instrument is blocked by the account risk policy",
        );
    }
    if target.policy.require_stop_loss && intent.stop_loss.is_none() {
        return reject(
            RouteRejectCode::StopLossRequired,
            "target account requires a stop loss",
        );
    }
    if let Err((code, message)) = validate_protective_prices(intent, target) {
        return reject(code, message);
    }

    let quantity = match resolve_quantity(intent, source_equity, target) {
        Ok(value) => value,
        Err((code, message)) => return reject(code, message),
    };
    let mut warnings = Vec::new();
    let mut normalized = quantity;

    if let Some(max) = target.copy_target.max_quantity
        && normalized > max
    {
        normalized = max;
        warnings.push(RouteWarning::QuantityCappedByTarget);
    }
    if let Some(max) = target.policy.max_order_quantity
        && normalized > max
    {
        normalized = max;
        warnings.push(RouteWarning::QuantityCappedByPolicy);
    }
    if normalized > target.instrument.max_quantity {
        normalized = target.instrument.max_quantity;
        warnings.push(RouteWarning::QuantityCappedByPolicy);
    }

    let stepped = floor_to_step(normalized, target.instrument.quantity_step);
    if stepped != normalized {
        warnings.push(RouteWarning::QuantityFlooredToStep);
    }
    if stepped <= Decimal::ZERO {
        return reject(
            RouteRejectCode::QuantityInvalid,
            "normalized quantity is not positive",
        );
    }
    if stepped < target.instrument.min_quantity {
        return reject(
            RouteRejectCode::QuantityBelowMinimum,
            "normalized quantity is below the venue minimum",
        );
    }

    let prices = [
        intent.limit_price,
        intent.stop_price,
        intent.stop_loss,
        intent.take_profit,
    ]
    .map(|value| value.map(|price| round_to_tick(price, target.instrument.price_tick)));

    TargetRouteResult::Ready {
        account_id: account_id.clone(),
        order: Box::new(RoutedOrder {
            parent_command_id: intent.command_id.clone(),
            command_id: CommandId::new(format!("{}:{}", intent.command_id, account_id)),
            idempotency_key: IdempotencyKey::new(format!(
                "{}:{}",
                intent.idempotency_key, account_id
            )),
            target_account_id: account_id,
            broker_code: target.account.broker_code.clone(),
            venue_kind: target.account.venue_kind,
            canonical_symbol: intent.canonical_symbol.clone(),
            venue_symbol: target.instrument.venue_symbol.clone(),
            side: intent.side,
            kind: intent.kind,
            quantity: stepped,
            quantity_unit: target.instrument.quantity_unit,
            limit_price: prices[0],
            stop_price: prices[1],
            stop_loss: prices[2],
            take_profit: prices[3],
            broker_margin_cap: None,
            warnings,
        }),
    }
}

fn validate_protective_prices(
    intent: &OrderIntent,
    target: &RouteTargetContext,
) -> Result<(), (RouteRejectCode, &'static str)> {
    let Some(stop_loss) = intent.stop_loss else {
        return Ok(());
    };
    let entry = match intent.kind {
        execution_domain::OrderKind::Market => target.reference_price,
        execution_domain::OrderKind::Limit => intent.limit_price,
        execution_domain::OrderKind::Stop => intent.stop_price,
    }
    .ok_or((
        RouteRejectCode::EntryPriceRequired,
        "entry or fresh reference price is required to validate stop loss",
    ))?;
    if (intent.side == Side::Buy && stop_loss >= entry)
        || (intent.side == Side::Sell && stop_loss <= entry)
    {
        return Err((
            RouteRejectCode::StopLossWrongSide,
            "stop loss is on the wrong side of the entry",
        ));
    }
    if let Some(minimum) = target.instrument.min_stop_distance
        && (entry - stop_loss).abs() < minimum
    {
        return Err((
            RouteRejectCode::StopDistanceTooSmall,
            "stop loss is closer than the venue minimum distance",
        ));
    }
    Ok(())
}

fn resolve_quantity(
    intent: &OrderIntent,
    source_equity: Option<Decimal>,
    target: &RouteTargetContext,
) -> Result<Decimal, (RouteRejectCode, &'static str)> {
    match &target.copy_target.allocation {
        CopyAllocation::SameQuantity => fixed_quantity(intent, target.instrument.quantity_unit),
        CopyAllocation::FixedQuantity { quantity, unit } => {
            fixed_target_quantity(*quantity, *unit, target.instrument.quantity_unit)
        }
        CopyAllocation::Multiplier { multiplier } => {
            fixed_quantity(intent, target.instrument.quantity_unit).map(|value| value * *multiplier)
        }
        CopyAllocation::EquityProportional { multiplier } => {
            let source = source_equity.ok_or((
                RouteRejectCode::SourceEquityRequired,
                "source equity is required for proportional copying",
            ))?;
            let target_equity = target.account.equity.ok_or((
                RouteRejectCode::TargetEquityRequired,
                "target equity is required for proportional copying",
            ))?;
            if source <= Decimal::ZERO || target_equity <= Decimal::ZERO {
                return Err((
                    RouteRejectCode::TargetEquityRequired,
                    "source and target equity must be positive",
                ));
            }
            fixed_quantity(intent, target.instrument.quantity_unit)
                .map(|value| value * (target_equity / source) * *multiplier)
        }
        CopyAllocation::RiskPercent { basis_points } => {
            if *basis_points > target.policy.max_risk_per_trade_basis_points {
                return Err((
                    RouteRejectCode::RiskLimitExceeded,
                    "requested risk exceeds the target policy",
                ));
            }
            risk_sized_quantity(intent, *basis_points, target)
        }
    }
}

fn fixed_target_quantity(
    quantity: Decimal,
    unit: QuantityUnit,
    target_unit: QuantityUnit,
) -> Result<Decimal, (RouteRejectCode, &'static str)> {
    if unit != target_unit {
        return Err((
            RouteRejectCode::QuantityUnitMismatch,
            "fixed target quantity unit differs from the target venue",
        ));
    }
    if quantity <= Decimal::ZERO {
        return Err((
            RouteRejectCode::QuantityInvalid,
            "fixed target quantity must be positive",
        ));
    }
    Ok(quantity)
}

fn fixed_quantity(
    intent: &OrderIntent,
    target_unit: QuantityUnit,
) -> Result<Decimal, (RouteRejectCode, &'static str)> {
    match intent.sizing {
        OrderSizing::Fixed { quantity, unit } if unit == target_unit => Ok(quantity),
        OrderSizing::Fixed { .. } => Err((
            RouteRejectCode::QuantityUnitMismatch,
            "source and target quantity units differ",
        )),
        OrderSizing::RiskPercent { .. } => Err((
            RouteRejectCode::QuantityInvalid,
            "fixed copy allocation requires a fixed source quantity",
        )),
    }
}

fn risk_sized_quantity(
    intent: &OrderIntent,
    basis_points: u32,
    target: &RouteTargetContext,
) -> Result<Decimal, (RouteRejectCode, &'static str)> {
    let equity = target.account.equity.ok_or((
        RouteRejectCode::TargetEquityRequired,
        "target equity is required for risk sizing",
    ))?;
    let entry = match intent.kind {
        execution_domain::OrderKind::Market => target.reference_price,
        execution_domain::OrderKind::Limit => intent.limit_price,
        execution_domain::OrderKind::Stop => intent.stop_price,
    }
    .ok_or((
        RouteRejectCode::EntryPriceRequired,
        "entry or reference price is required for risk sizing",
    ))?;
    let stop = intent.stop_loss.ok_or((
        RouteRejectCode::StopLossRequired,
        "stop loss is required for risk sizing",
    ))?;
    if (intent.side == Side::Buy && stop >= entry) || (intent.side == Side::Sell && stop <= entry) {
        return Err((
            RouteRejectCode::StopLossWrongSide,
            "stop loss is on the wrong side of the entry",
        ));
    }
    let tick_value = target.instrument.tick_value_per_quantity.ok_or((
        RouteRejectCode::TickValueRequired,
        "venue tick value is required for risk sizing",
    ))?;
    if target.instrument.price_tick <= Decimal::ZERO || tick_value <= Decimal::ZERO {
        return Err((
            RouteRejectCode::TickValueRequired,
            "venue tick size and tick value must be positive",
        ));
    }
    let risk_money = equity * Decimal::from(basis_points) / Decimal::from(BASIS_POINTS_DENOMINATOR);
    let ticks_to_stop = (entry - stop).abs() / target.instrument.price_tick;
    if ticks_to_stop <= Decimal::ZERO {
        return Err((
            RouteRejectCode::QuantityInvalid,
            "stop distance must be positive",
        ));
    }
    Ok(risk_money / (ticks_to_stop * tick_value))
}

fn contains_symbol(symbols: &[String], symbol: &str) -> bool {
    symbols
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(symbol))
}

fn floor_to_step(value: Decimal, step: Decimal) -> Decimal {
    if step <= Decimal::ZERO {
        return value;
    }
    (value / step).floor() * step
}

fn round_to_tick(value: Decimal, tick: Decimal) -> Decimal {
    if tick <= Decimal::ZERO {
        return value;
    }
    (value / tick).round() * tick
}

#[cfg(test)]
mod tests {
    use super::*;
    use execution_domain::{
        AccountId, AccountMode, CopyTarget, ExecutionAccount, InstrumentSpec, OrderKind,
        RiskPolicy, VenueKind,
    };
    use rust_decimal::Decimal;
    use std::collections::BTreeMap;

    fn decimal(value: i64, scale: u32) -> Decimal {
        Decimal::new(value, scale)
    }

    fn intent() -> OrderIntent {
        OrderIntent {
            command_id: CommandId::new("parent"),
            idempotency_key: IdempotencyKey::new("once"),
            source_account_id: Some(AccountId::new("source")),
            canonical_symbol: "EURUSD".into(),
            side: Side::Buy,
            kind: OrderKind::Market,
            sizing: OrderSizing::Fixed {
                quantity: decimal(100, 2),
                unit: QuantityUnit::Lots,
            },
            limit_price: None,
            stop_price: None,
            stop_loss: Some(decimal(108_000, 5)),
            take_profit: Some(decimal(112_000, 5)),
            metadata: BTreeMap::new(),
        }
    }

    fn target(id: &str, equity: i64, status: AccountStatus) -> RouteTargetContext {
        RouteTargetContext {
            account: ExecutionAccount {
                id: AccountId::new(id),
                owner_id: "owner".into(),
                label: id.into(),
                venue_kind: VenueKind::MetaTrader5,
                broker_code: "exness".into(),
                external_account_ref: id.into(),
                server: Some("Exness-MT5".into()),
                mode: AccountMode::Demo,
                status,
                currency: "USD".into(),
                balance: Some(Decimal::from(equity)),
                equity: Some(Decimal::from(equity)),
                trade_allowed: true,
                updated_at_ms: 1,
            },
            instrument: InstrumentSpec {
                canonical_symbol: "EURUSD".into(),
                venue_symbol: "EURUSDm".into(),
                quantity_unit: QuantityUnit::Lots,
                quantity_step: decimal(1, 2),
                min_quantity: decimal(1, 2),
                max_quantity: Decimal::from(100),
                price_tick: decimal(1, 5),
                tick_value_per_quantity: Some(Decimal::from(1)),
                min_stop_distance: Some(decimal(10, 5)),
                trade_allowed: true,
            },
            policy: RiskPolicy::default(),
            copy_target: CopyTarget {
                account_id: AccountId::new(id),
                enabled: true,
                allocation: CopyAllocation::EquityProportional {
                    multiplier: Decimal::ONE,
                },
                max_quantity: None,
            },
            reference_price: Some(decimal(110_000, 5)),
        }
    }

    #[test]
    fn routes_targets_independently() {
        let results = route_order(
            &intent(),
            Some(Decimal::from(10_000)),
            &[
                target("ready", 5_000, AccountStatus::Ready),
                target("offline", 20_000, AccountStatus::Offline),
            ],
        );
        assert!(matches!(
            &results[0],
            TargetRouteResult::Ready { order, .. } if order.quantity == decimal(50, 2)
        ));
        assert!(matches!(
            &results[1],
            TargetRouteResult::Rejected {
                code: RouteRejectCode::AccountNotReady,
                ..
            }
        ));
    }

    #[test]
    fn generates_target_scoped_idempotency_keys() {
        let results = route_order(
            &intent(),
            Some(Decimal::from(10_000)),
            &[target("account-a", 10_000, AccountStatus::Ready)],
        );
        assert!(matches!(
            &results[0],
            TargetRouteResult::Ready { order, .. }
                if order.idempotency_key.as_str() == "once:account-a"
        ));
    }

    #[test]
    fn fixed_target_quantity_is_independent_of_source_sizing() {
        let mut intent = intent();
        intent.sizing = OrderSizing::RiskPercent { basis_points: 50 };
        let mut target = target("fixed", 10_000, AccountStatus::Ready);
        target.copy_target.allocation = CopyAllocation::FixedQuantity {
            quantity: decimal(37, 2),
            unit: QuantityUnit::Lots,
        };

        let results = route_order(&intent, None, &[target]);
        assert!(matches!(
            &results[0],
            TargetRouteResult::Ready { order, .. } if order.quantity == decimal(37, 2)
        ));
    }

    #[test]
    fn fixed_target_quantity_must_be_positive() {
        let mut target = target("fixed", 10_000, AccountStatus::Ready);
        target.copy_target.allocation = CopyAllocation::FixedQuantity {
            quantity: Decimal::ZERO,
            unit: QuantityUnit::Lots,
        };

        let results = route_order(&intent(), None, &[target]);
        assert!(matches!(
            &results[0],
            TargetRouteResult::Rejected {
                code: RouteRejectCode::QuantityInvalid,
                ..
            }
        ));
    }

    #[test]
    fn fixed_target_quantity_unit_must_match_target_instrument() {
        let mut target = target("fixed", 10_000, AccountStatus::Ready);
        target.copy_target.allocation = CopyAllocation::FixedQuantity {
            quantity: decimal(37, 2),
            unit: QuantityUnit::BaseUnits,
        };

        let results = route_order(&intent(), None, &[target]);
        assert!(matches!(
            &results[0],
            TargetRouteResult::Rejected {
                code: RouteRejectCode::QuantityUnitMismatch,
                ..
            }
        ));
    }

    #[test]
    fn rejects_risk_above_account_policy() {
        let mut target = target("risk", 10_000, AccountStatus::Ready);
        target.copy_target.allocation = CopyAllocation::RiskPercent { basis_points: 101 };
        target.policy.max_risk_per_trade_basis_points = 100;

        let results = route_order(&intent(), None, &[target]);
        assert!(matches!(
            &results[0],
            TargetRouteResult::Rejected {
                code: RouteRejectCode::RiskLimitExceeded,
                ..
            }
        ));
    }

    #[test]
    fn rejects_stop_loss_on_wrong_side_before_submission() {
        let mut intent = intent();
        intent.stop_loss = Some(decimal(111_000, 5));
        let mut target = target("risk", 10_000, AccountStatus::Ready);
        target.copy_target.allocation = CopyAllocation::RiskPercent { basis_points: 50 };

        let results = route_order(&intent, None, &[target]);
        assert!(matches!(
            &results[0],
            TargetRouteResult::Rejected {
                code: RouteRejectCode::StopLossWrongSide,
                ..
            }
        ));
    }

    #[test]
    fn floors_quantity_and_caps_it_to_target_limit() {
        let mut target = target("capped", 10_000, AccountStatus::Ready);
        target.copy_target.allocation = CopyAllocation::Multiplier {
            multiplier: decimal(137, 2),
        };
        target.copy_target.max_quantity = Some(decimal(123, 2));
        target.instrument.quantity_step = decimal(10, 2);

        let results = route_order(&intent(), None, &[target]);
        assert!(matches!(
            &results[0],
            TargetRouteResult::Ready { order, .. }
                if order.quantity == decimal(120, 2)
                && order.warnings.contains(&RouteWarning::QuantityCappedByTarget)
                && order.warnings.contains(&RouteWarning::QuantityFlooredToStep)
        ));
    }

    #[test]
    fn symbol_policy_is_case_insensitive_and_default_deny_when_allow_listed() {
        let mut allowed = target("allowed", 10_000, AccountStatus::Ready);
        allowed.policy.allowed_symbols = vec!["eurusd".into()];
        let mut denied = target("denied", 10_000, AccountStatus::Ready);
        denied.policy.allowed_symbols = vec!["XAUUSD".into()];

        let results = route_order(&intent(), Some(Decimal::from(10_000)), &[allowed, denied]);
        assert!(matches!(&results[0], TargetRouteResult::Ready { .. }));
        assert!(matches!(
            &results[1],
            TargetRouteResult::Rejected {
                code: RouteRejectCode::SymbolNotAllowed,
                ..
            }
        ));
    }

    #[test]
    fn rejects_cross_venue_quantity_unit_without_silent_conversion() {
        let mut target = target("binance", 10_000, AccountStatus::Ready);
        target.instrument.quantity_unit = QuantityUnit::BaseUnits;
        target.copy_target.allocation = CopyAllocation::SameQuantity;

        let results = route_order(&intent(), None, &[target]);
        assert!(matches!(
            &results[0],
            TargetRouteResult::Rejected {
                code: RouteRejectCode::QuantityUnitMismatch,
                ..
            }
        ));
    }

    #[test]
    fn rejects_market_stop_without_a_fresh_reference_quote() {
        let mut target = target("stale-quote", 10_000, AccountStatus::Ready);
        target.reference_price = None;

        let results = route_order(&intent(), Some(Decimal::from(10_000)), &[target]);
        assert!(matches!(
            &results[0],
            TargetRouteResult::Rejected {
                code: RouteRejectCode::EntryPriceRequired,
                ..
            }
        ));
    }

    #[test]
    fn rejects_stop_inside_the_broker_minimum_distance() {
        let mut target = target("close-stop", 10_000, AccountStatus::Ready);
        target.instrument.min_stop_distance = Some(decimal(3_000, 5));

        let results = route_order(&intent(), Some(Decimal::from(10_000)), &[target]);
        assert!(matches!(
            &results[0],
            TargetRouteResult::Rejected {
                code: RouteRejectCode::StopDistanceTooSmall,
                ..
            }
        ));
    }
}
