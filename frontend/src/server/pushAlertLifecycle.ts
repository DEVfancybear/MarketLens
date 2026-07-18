export interface CanonicalTriggerCommit {
  alreadyTriggered: boolean;
  eventId: string;
}

export class CanonicalTriggerPersistenceError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CanonicalTriggerPersistenceError";
  }
}

export type PersistBeforeNotificationResult<T> =
  | {
      committed: true;
      canonical: CanonicalTriggerCommit;
      notification?: T;
      notificationError?: string;
    }
  | {
      committed: false;
      persistenceError: string;
      retryable: boolean;
    };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Enforces the alert lifecycle boundary: PostgreSQL commits the trigger before
 * any best-effort notification channel is allowed to run.
 */
export async function persistBeforeNotification<T>(
  persist: () => Promise<CanonicalTriggerCommit>,
  notify: (canonical: CanonicalTriggerCommit) => Promise<T>,
): Promise<PersistBeforeNotificationResult<T>> {
  let canonical: CanonicalTriggerCommit;
  try {
    canonical = await persist();
  } catch (error) {
    return {
      committed: false,
      persistenceError: errorMessage(error, "Canonical trigger persistence failed."),
      retryable:
        error instanceof CanonicalTriggerPersistenceError
          ? error.retryable
          : true,
    };
  }

  try {
    return { committed: true, canonical, notification: await notify(canonical) };
  } catch (error) {
    return {
      committed: true,
      canonical,
      notificationError: errorMessage(error, "Notification delivery failed."),
    };
  }
}
