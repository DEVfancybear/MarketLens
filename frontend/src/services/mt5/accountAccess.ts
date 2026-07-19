import type { Mt5AccountSnapshot } from "@/types/mt5";

export interface Mt5ExpectedAccount {
  login: string;
  server: string;
  verifiedAt: string | null;
}

function normalizeLogin(value: string): string {
  return value.trim();
}

function normalizeServer(value: string): string {
  return value.trim().toLowerCase();
}

export function sameMt5ExpectedAccount(
  left: Mt5ExpectedAccount | null,
  right: Mt5ExpectedAccount,
): boolean {
  return Boolean(
    left &&
      normalizeLogin(left.login) === normalizeLogin(right.login) &&
      normalizeServer(left.server) === normalizeServer(right.server),
  );
}

/**
 * A verified backend credential is necessary but not sufficient for live
 * execution: the local bridge must report that exact login and broker server.
 */
export function mt5AccountMismatchReason(
  expected: Mt5ExpectedAccount,
  account: Mt5AccountSnapshot | null,
): string | null {
  if (!account) {
    return `Waiting for the MT5 bridge to report verified account ${expected.login} on ${expected.server}. Start or reconnect the local execution bridge.`;
  }

  if (normalizeLogin(account.accountId) !== normalizeLogin(expected.login)) {
    return `The MT5 bridge is connected to login ${account.accountId}, but this user verified login ${expected.login}. Reconnect the bridge with the verified account.`;
  }

  if (normalizeServer(account.server) !== normalizeServer(expected.server)) {
    return `The MT5 bridge is connected to server ${account.server}, but this user verified ${expected.server}. Reconnect the bridge with the verified server.`;
  }

  return null;
}
