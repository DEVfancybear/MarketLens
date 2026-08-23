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

test("managed MT5 copy describes the bare-metal worker without VM setup instructions", () => {
  const localization = source("src/i18n/localization.ts");

  assert.match(localization, /bare-metal worker/);
  assert.match(localization, /worker bare-metal/);
  assert.doesNotMatch(localization, /VM migration|chuyển VM/);
});
