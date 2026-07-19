import assert from "node:assert/strict";
import test from "node:test";

import {
  mt5AccountMismatchReason,
  sameMt5ExpectedAccount,
  type Mt5ExpectedAccount,
} from "../../src/services/mt5/accountAccess";
import type { Mt5AccountSnapshot } from "../../src/types/mt5";

const expected: Mt5ExpectedAccount = {
  login: "12345678",
  server: "FTMO-Server4",
  verifiedAt: "2026-07-19T12:00:00Z",
};

const account: Mt5AccountSnapshot = {
  accountId: "12345678",
  broker: "FTMO MT5",
  server: "ftmo-server4",
  mode: "demo",
  currency: "USD",
  balance: 100000,
  equity: 100000,
  margin: 0,
  freeMargin: 100000,
  marginLevel: 0,
  leverage: 100,
  tradeAllowed: true,
  updatedAt: Date.now(),
};

test("verified account identity ignores server casing but not login", () => {
  assert.equal(
    sameMt5ExpectedAccount(expected, {
      ...expected,
      server: "ftmo-server4",
      verifiedAt: "later",
    }),
    true,
  );
  assert.equal(
    sameMt5ExpectedAccount(expected, { ...expected, login: "12345679" }),
    false,
  );
});

test("bridge access requires an account snapshot matching this user", () => {
  assert.match(mt5AccountMismatchReason(expected, null) ?? "", /Waiting/);
  assert.equal(mt5AccountMismatchReason(expected, account), null);
  assert.match(
    mt5AccountMismatchReason(expected, { ...account, accountId: "999" }) ?? "",
    /connected to login 999/,
  );
  assert.match(
    mt5AccountMismatchReason(expected, { ...account, server: "Other-Server" }) ?? "",
    /connected to server Other-Server/,
  );
});
