use std::collections::{BTreeMap, BTreeSet};

use execution_domain::{EaPendingOrderSnapshot, EaPositionSnapshot};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "changeType", rename_all = "camelCase")]
pub enum PortfolioChange {
    PositionOpened {
        current: EaPositionSnapshot,
    },
    PositionIncreased {
        previous: EaPositionSnapshot,
        current: EaPositionSnapshot,
        #[serde(with = "rust_decimal::serde::str")]
        delta: Decimal,
    },
    PositionReduced {
        previous: EaPositionSnapshot,
        current: EaPositionSnapshot,
        #[serde(with = "rust_decimal::serde::str")]
        delta: Decimal,
    },
    PositionClosed {
        previous: EaPositionSnapshot,
    },
    PositionProtectionChanged {
        previous: EaPositionSnapshot,
        current: EaPositionSnapshot,
    },
    PendingCreated {
        current: EaPendingOrderSnapshot,
    },
    PendingModified {
        previous: EaPendingOrderSnapshot,
        current: EaPendingOrderSnapshot,
    },
    PendingReplaced {
        previous: EaPendingOrderSnapshot,
        current: EaPendingOrderSnapshot,
    },
    PendingCancelled {
        previous: EaPendingOrderSnapshot,
    },
    PendingFilled {
        previous: EaPendingOrderSnapshot,
        position: EaPositionSnapshot,
    },
}

pub fn diff_portfolio(
    previous_positions: &[EaPositionSnapshot],
    previous_pending: &[EaPendingOrderSnapshot],
    current_positions: &[EaPositionSnapshot],
    current_pending: &[EaPendingOrderSnapshot],
    pending_fill_positions: &BTreeMap<String, String>,
) -> Vec<PortfolioChange> {
    let previous_positions = position_map(previous_positions);
    let current_positions = position_map(current_positions);
    let previous_pending = pending_map(previous_pending);
    let current_pending = pending_map(current_pending);

    let mut changes = Vec::new();
    let new_position_ids = current_positions
        .keys()
        .filter(|id| !previous_positions.contains_key(*id))
        .cloned()
        .collect::<BTreeSet<_>>();
    // A pending fill on an MT5 netting account increases an existing position
    // instead of creating a new ticket. Track all newly available exposure so
    // the vanished pending order is correlated before emitting a duplicate
    // PositionIncreased/Open event.
    let mut unmatched_position_increase = current_positions
        .iter()
        .filter_map(|(position_id, current)| {
            let previous_quantity = previous_positions
                .get(position_id)
                .map(|position| position.quantity)
                .unwrap_or(Decimal::ZERO);
            let increase = current.quantity - previous_quantity;
            (increase > Decimal::ZERO).then(|| (position_id.clone(), increase))
        })
        .collect::<BTreeMap<_, _>>();

    for (order_id, previous) in &previous_pending {
        if current_pending.contains_key(order_id) {
            continue;
        }
        // Snapshot proximity alone is not fill evidence: a cancellation can
        // coincide with an unrelated same-symbol position increase. Only the
        // MT5 trade transaction's order->position identity may suppress the
        // independent cancel and open/increase transitions.
        if let Some(position_id) = pending_fill_positions.get(order_id) {
            if let Some(position) = current_positions.get(position_id) {
                let available = unmatched_position_increase
                    .get(position_id)
                    .copied()
                    .unwrap_or(Decimal::ZERO);
                let filled_quantity = if available > Decimal::ZERO {
                    previous.quantity.min(available)
                } else {
                    previous.quantity
                };
                let mut filled_order = (*previous).clone();
                filled_order.quantity = filled_quantity;
                if let Some(remaining) = unmatched_position_increase.get_mut(position_id) {
                    *remaining -= filled_quantity;
                }
                changes.push(PortfolioChange::PendingFilled {
                    previous: filled_order,
                    position: (*position).clone(),
                });
                continue;
            }
        }
        changes.push(PortfolioChange::PendingCancelled {
            previous: (*previous).clone(),
        });
    }

    for position_id in new_position_ids {
        if let Some(current) = current_positions.get(&position_id) {
            let remaining = unmatched_position_increase
                .get(&position_id)
                .copied()
                .unwrap_or(Decimal::ZERO);
            if remaining <= Decimal::ZERO {
                continue;
            }
            let mut current = (*current).clone();
            current.quantity = remaining;
            changes.push(PortfolioChange::PositionOpened { current });
        }
    }

    for (position_id, previous) in &previous_positions {
        let Some(current) = current_positions.get(position_id) else {
            changes.push(PortfolioChange::PositionClosed {
                previous: (*previous).clone(),
            });
            continue;
        };
        let unmatched_increase = unmatched_position_increase
            .get(position_id)
            .copied()
            .unwrap_or(Decimal::ZERO);
        if current.quantity > previous.quantity && unmatched_increase > Decimal::ZERO {
            changes.push(PortfolioChange::PositionIncreased {
                previous: (*previous).clone(),
                current: (*current).clone(),
                delta: unmatched_increase,
            });
        } else if current.quantity < previous.quantity {
            changes.push(PortfolioChange::PositionReduced {
                previous: (*previous).clone(),
                current: (*current).clone(),
                delta: previous.quantity - current.quantity,
            });
        }
        if current.stop_loss != previous.stop_loss || current.take_profit != previous.take_profit {
            changes.push(PortfolioChange::PositionProtectionChanged {
                previous: (*previous).clone(),
                current: (*current).clone(),
            });
        }
    }

    for (order_id, current) in &current_pending {
        let Some(previous) = previous_pending.get(order_id) else {
            changes.push(PortfolioChange::PendingCreated {
                current: (*current).clone(),
            });
            continue;
        };
        if current.quantity != previous.quantity || current.kind != previous.kind {
            changes.push(PortfolioChange::PendingReplaced {
                previous: (*previous).clone(),
                current: (*current).clone(),
            });
        } else if current.price != previous.price
            || current.stop_loss != previous.stop_loss
            || current.take_profit != previous.take_profit
        {
            changes.push(PortfolioChange::PendingModified {
                previous: (*previous).clone(),
                current: (*current).clone(),
            });
        }
    }

    changes
}

impl PortfolioChange {
    pub fn source_resource_id(&self) -> &str {
        match self {
            Self::PositionOpened { current }
            | Self::PositionIncreased { current, .. }
            | Self::PositionReduced { current, .. }
            | Self::PositionProtectionChanged { current, .. } => &current.broker_position_id,
            Self::PositionClosed { previous } => &previous.broker_position_id,
            Self::PendingCreated { current }
            | Self::PendingModified { current, .. }
            | Self::PendingReplaced { current, .. } => &current.broker_order_id,
            Self::PendingCancelled { previous } | Self::PendingFilled { previous, .. } => {
                &previous.broker_order_id
            }
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Self::PositionOpened { .. } => "position.opened",
            Self::PositionIncreased { .. } => "position.increased",
            Self::PositionReduced { .. } => "position.reduced",
            Self::PositionClosed { .. } => "position.closed",
            Self::PositionProtectionChanged { .. } => "position.protection_changed",
            Self::PendingCreated { .. } => "pending.created",
            Self::PendingModified { .. } => "pending.modified",
            Self::PendingReplaced { .. } => "pending.replaced",
            Self::PendingCancelled { .. } => "pending.cancelled",
            Self::PendingFilled { .. } => "pending.filled",
        }
    }

    pub fn observed_at_ms(&self) -> u64 {
        match self {
            Self::PositionOpened { current }
            | Self::PositionIncreased { current, .. }
            | Self::PositionReduced { current, .. }
            | Self::PositionProtectionChanged { current, .. } => current.observed_at_ms,
            Self::PositionClosed { previous } => previous.observed_at_ms,
            Self::PendingCreated { current }
            | Self::PendingModified { current, .. }
            | Self::PendingReplaced { current, .. } => current.observed_at_ms,
            Self::PendingCancelled { previous } => previous.observed_at_ms,
            Self::PendingFilled { position, .. } => position.observed_at_ms,
        }
    }
}

fn position_map(positions: &[EaPositionSnapshot]) -> BTreeMap<String, &EaPositionSnapshot> {
    positions
        .iter()
        .map(|position| (position.broker_position_id.clone(), position))
        .collect()
}

fn pending_map(orders: &[EaPendingOrderSnapshot]) -> BTreeMap<String, &EaPendingOrderSnapshot> {
    orders
        .iter()
        .map(|order| (order.broker_order_id.clone(), order))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use execution_domain::{OrderKind, Side};

    fn position(id: &str, quantity: i64, stop_loss: Option<i64>) -> EaPositionSnapshot {
        EaPositionSnapshot {
            broker_position_id: id.into(),
            canonical_symbol: "EURUSD".into(),
            venue_symbol: "EURUSD".into(),
            side: Side::Buy,
            quantity: Decimal::new(quantity, 2),
            open_price: Decimal::new(110, 2),
            current_price: Decimal::new(111, 2),
            stop_loss: stop_loss.map(|value| Decimal::new(value, 2)),
            take_profit: None,
            profit: Decimal::ZERO,
            swap: Decimal::ZERO,
            commission: Decimal::ZERO,
            magic: 42,
            comment: "manual".into(),
            opened_at_ms: 2_000,
            observed_at_ms: 3_000,
        }
    }

    fn pending(id: &str, quantity: i64) -> EaPendingOrderSnapshot {
        EaPendingOrderSnapshot {
            broker_order_id: id.into(),
            canonical_symbol: "EURUSD".into(),
            venue_symbol: "EURUSD".into(),
            side: Side::Buy,
            kind: OrderKind::Limit,
            quantity: Decimal::new(quantity, 2),
            price: Decimal::new(109, 2),
            stop_loss: None,
            take_profit: None,
            magic: 42,
            comment: "manual".into(),
            created_at_ms: 1_000,
            observed_at_ms: 2_000,
        }
    }

    #[test]
    fn detects_partial_close_and_independent_protection_change() {
        let previous = position("p-1", 100, Some(100));
        let current = position("p-1", 60, Some(105));
        let changes = diff_portfolio(&[previous], &[], &[current], &[], &BTreeMap::new());

        assert!(matches!(
            &changes[0],
            PortfolioChange::PositionReduced { delta, .. } if *delta == Decimal::new(40, 2)
        ));
        assert!(matches!(
            &changes[1],
            PortfolioChange::PositionProtectionChanged { .. }
        ));
    }

    #[test]
    fn correlates_pending_fill_without_duplicate_position_open() {
        let order = pending("o-1", 25);
        let filled = position("p-1", 25, None);
        let evidence = BTreeMap::from([("o-1".to_owned(), "p-1".to_owned())]);
        let changes = diff_portfolio(&[], &[order], &[filled], &[], &evidence);

        assert_eq!(changes.len(), 1);
        assert!(matches!(
            &changes[0],
            PortfolioChange::PendingFilled { previous, position }
                if previous.broker_order_id == "o-1" && position.broker_position_id == "p-1"
        ));
    }

    #[test]
    fn correlates_pending_fill_into_existing_netting_position() {
        let order = pending("o-1", 25);
        let before = position("p-1", 50, None);
        let after = position("p-1", 75, None);
        let evidence = BTreeMap::from([("o-1".to_owned(), "p-1".to_owned())]);
        let changes = diff_portfolio(&[before], &[order], &[after], &[], &evidence);

        assert_eq!(changes.len(), 1);
        assert!(matches!(
            &changes[0],
            PortfolioChange::PendingFilled { previous, position }
                if previous.broker_order_id == "o-1"
                    && previous.quantity == Decimal::new(25, 2)
                    && position.broker_position_id == "p-1"
        ));
    }

    #[test]
    fn cancellation_and_same_symbol_increase_remain_independent_without_fill_evidence() {
        let order = pending("o-1", 25);
        let before = position("p-1", 50, None);
        let after = position("p-1", 75, None);
        let changes = diff_portfolio(&[before], &[order], &[after], &[], &BTreeMap::new());

        assert_eq!(changes.len(), 2);
        assert!(matches!(
            &changes[0],
            PortfolioChange::PendingCancelled { .. }
        ));
        assert!(matches!(
            &changes[1],
            PortfolioChange::PositionIncreased { delta, .. }
                if *delta == Decimal::new(25, 2)
        ));
    }

    #[test]
    fn quantity_change_replaces_pending_order() {
        let previous = pending("o-1", 25);
        let current = pending("o-1", 30);
        let changes = diff_portfolio(&[], &[previous], &[], &[current], &BTreeMap::new());
        assert!(matches!(
            &changes[0],
            PortfolioChange::PendingReplaced { .. }
        ));
    }
}
