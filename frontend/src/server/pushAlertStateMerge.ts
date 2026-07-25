import { alertArmingRevision } from "../services/alertConditions";
import { technicalTargetSignature } from "../services/dynamicAlertTargets";
import type {
  PendingPushAlertDelivery,
  PushDeviceRecord,
  ServerPushAlert,
} from "../types/pushAlerts";

export interface RemovedEvaluatorState {
  signature: string;
  /** Canonical event that was fully delivered before the state was removed. */
  eventId?: string;
  cursor: number;
}

export type EvaluatorStatePatch = Pick<
  PushDeviceRecord,
  "lastPrices" | "alertState"
> & {
  /**
   * Signatures for every alert the evaluator considered in its snapshot,
   * including retained pending-delivery alerts. This lets a concurrent write
   * distinguish an intentional state deletion from an alert that was added or
   * edited after the snapshot was read.
   */
  alertSignatures?: Record<string, string>;
  /**
   * Signatures loaded from PostgreSQL for this owner. Unlike the browser-owned
   * alert list, these may safely establish cursor state for an alert that the
   * last pagehide sync did not include.
   */
  authoritativeAlertSignatures?: Record<string, string>;
  removedAlertState?: Record<string, RemovedEvaluatorState>;
};

export function pushAlertStateCursor(
  state: PushDeviceRecord["alertState"][string] | undefined,
): number {
  if (!state) return 0;
  return Math.max(
    0,
    ...[
      state.lastMarketTimestamp,
      state.lastEvaluatedAt,
      state.lastTriggeredAt,
      state.pendingTrigger?.triggeredAt,
      state.pendingDelivery?.candidate.triggeredAt,
    ].filter((value): value is number => Number.isFinite(value)),
  );
}

function alertStateSignature(alert: ServerPushAlert): string {
  return `${alertArmingRevision(
    alert.condition,
    alert.symbol,
    alert.price,
    alert.recurring,
    alert.armingRevision,
  )}:${technicalTargetSignature(alert.technicalTarget)}`;
}

function mergeMatchingDeliveryProgress(
  current: PendingPushAlertDelivery,
  incoming: PendingPushAlertDelivery,
): PendingPushAlertDelivery {
  return {
    ...incoming,
    // A completed destination can never be reactivated by an older worker
    // snapshot for the same canonical event.
    push: current.push && incoming.push,
    telegram: current.telegram && incoming.telegram,
    discord: current.discord && incoming.discord,
  };
}

/**
 * Merge evaluator cursors instead of blindly replacing the whole device row.
 * PostgreSQL compare-and-swap writes can retry after a concurrent browser
 * sync; a retry must not re-install an older evaluator snapshot over the newer
 * alert definition/state.
 */
export function mergeEvaluatorState(
  existing: PushDeviceRecord,
  patch: EvaluatorStatePatch,
): Pick<PushDeviceRecord, "lastPrices" | "alertState"> {
  const expectedSignatures = new Map<string, string>(
    existing.alerts.map((alert) => [alert.id, alertStateSignature(alert)]),
  );
  // A one-time alert can be absent from `alerts` while its failed delivery is
  // retained in state. Include that frozen definition when checking a worker
  // snapshot so a successful retry can remove exactly that state.
  for (const [id, state] of Object.entries(existing.alertState)) {
    if (!expectedSignatures.has(id) && state.pendingDelivery?.alert) {
      expectedSignatures.set(
        id,
        alertStateSignature(state.pendingDelivery.alert),
      );
    }
  }
  const alertState = { ...existing.alertState };

  for (const [id, incoming] of Object.entries(patch.alertState)) {
    const current = alertState[id];
    const expected = expectedSignatures.get(id);
    const incomingSignature = patch.alertSignatures?.[id];
    const authoritative =
      incomingSignature !== undefined &&
      patch.authoritativeAlertSignatures?.[id] === incomingSignature;
    if (incomingSignature && incoming.signature !== incomingSignature) {
      // Never persist a state under a different definition than the snapshot
      // that produced it.
      continue;
    }
    if (
      incomingSignature &&
      !expected &&
      !current &&
      !incoming.pendingDelivery &&
      !authoritative
    ) {
      // The browser removed this alert after the evaluator snapshot was read.
      // Only a canonically committed delivery retry may outlive the definition.
      continue;
    }
    if (expected && incoming.signature !== expected) {
      // Cursor-only state from an older revision must not survive an edit, but
      // a canonically committed notification owns a frozen payload and still
      // has to drain after that edit.
      const incomingDelivery = incoming.pendingDelivery;
      if (!incomingDelivery) continue;
      const currentDelivery = current?.pendingDelivery;
      if (currentDelivery?.eventId === incomingDelivery.eventId) {
        alertState[id] = {
          ...incoming,
          pendingDelivery: mergeMatchingDeliveryProgress(
            currentDelivery,
            incomingDelivery,
          ),
        };
        continue;
      }
      if (
        currentDelivery &&
        currentDelivery.candidate.triggeredAt >=
          incomingDelivery.candidate.triggeredAt
      ) {
        continue;
      }
      alertState[id] = incoming;
      continue;
    }
    if (!current) {
      alertState[id] = incoming;
      continue;
    }
    const currentMatches = !expected || current.signature === expected;
    if (expected && !currentMatches) {
      alertState[id] = incoming;
      continue;
    }
    const incomingWins =
      pushAlertStateCursor(incoming) >= pushAlertStateCursor(current);
    const winner = incomingWins ? incoming : current;
    const matchingDelivery =
      current.pendingDelivery &&
      incoming.pendingDelivery &&
      current.pendingDelivery.eventId === incoming.pendingDelivery.eventId
        ? mergeMatchingDeliveryProgress(
            current.pendingDelivery,
            incoming.pendingDelivery,
          )
        : undefined;
    alertState[id] = {
      ...winner,
      // A newer evaluator snapshot intentionally clearing a pending delivery
      // must be allowed to clear it; retaining it unconditionally would resend
      // an already delivered notification forever.
      pendingDelivery: incomingWins
        ? matchingDelivery ?? incoming.pendingDelivery
        : matchingDelivery ?? current.pendingDelivery,
    };
  }

  // Evaluator snapshots are otherwise full state snapshots. A missing entry
  // is an intentional deletion only when the evaluator explicitly records the
  // canonical event it finished delivering. Matching the event id prevents a
  // stale worker from deleting a newer retry candidate written concurrently.
  for (const [id, removed] of Object.entries(patch.removedAlertState ?? {})) {
    const current = alertState[id];
    if (!current || current.signature !== removed.signature) continue;
    if (current.pendingDelivery) {
      if (
        removed.eventId &&
        current.pendingDelivery.eventId === removed.eventId
      ) {
        delete alertState[id];
      }
      continue;
    }
    if (pushAlertStateCursor(current) <= removed.cursor) {
      delete alertState[id];
    }
  }

  const lastPrices: Record<string, number> = { ...existing.lastPrices };
  for (const [rawSymbol, value] of Object.entries(patch.lastPrices)) {
    if (!Number.isFinite(value) || value <= 0) continue;
    const symbol = rawSymbol.trim().toUpperCase();
    if (symbol) lastPrices[symbol] = value;
  }
  return { lastPrices, alertState };
}
