import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

test("managed MT5 dialog reuses an explicit request key and clears browser credential state", () => {
  const dialog = source("src/components/trade/Mt5ManagedConnectionDialog.tsx");
  const api = source("src/services/api/resources/executionApi.ts");

  assert.match(api, /interface ManagedMT5ConnectInput[\s\S]*requestId: string;/);
  assert.match(dialog, /const connectRequestId = useRef\(""\)/);
  assert.match(dialog, /connectRequestId\.current = crypto\.randomUUID\(\)/);
  assert.match(dialog, /requestId: connectRequestId\.current \|\| crypto\.randomUUID\(\)/);
  assert.match(dialog, /catch \(cause\) \{\s*setPassword\(""\)/);
  assert.doesNotMatch(dialog, /localStorage|sessionStorage|indexedDB|URLSearchParams/);
});

test("managed MT5 entry stays visible while backend capability gates credential submission", () => {
  const desktop = source("src/components/trade/TradeWorkspace.tsx");
  const mobile = source("src/components/mobile/MobileTradeScreen.tsx");
  const localization = source("src/i18n/localization.ts");

  assert.equal(
    (desktop.match(/data-managed-mt5-entry="desktop"/g) ?? []).length,
    1,
    "desktop must render exactly one discoverable managed MT5 entry",
  );
  assert.equal(
    (mobile.match(/data-managed-mt5-entry="mobile"/g) ?? []).length,
    1,
    "mobile must render exactly one discoverable managed MT5 entry",
  );
  assert.match(desktop, /disabled=\{!connectorCapabilities\.mt5Managed\}/);
  assert.match(mobile, /disabled=\{!connectorCapabilities\.mt5Managed\}/);
  assert.match(localization, /"execution\.add\.backend\.unavailable"/);
  assert.doesNotMatch(
    desktop,
    /\{connectorCapabilities\.mt5Managed && \([\s\S]{0,500}data-managed-mt5-entry="desktop"/,
  );
  assert.doesNotMatch(
    mobile,
    /\{connectorCapabilities\.mt5Managed && \([\s\S]{0,300}data-managed-mt5-entry="mobile"/,
  );
});

test("managed MT5 copy describes the bare-metal worker without VM setup instructions", () => {
  const localization = source("src/i18n/localization.ts");

  assert.match(localization, /bare-metal worker/);
  assert.match(localization, /worker bare-metal/);
  assert.doesNotMatch(localization, /VM migration|chuyển VM/);
});
