import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertGoogleAuthBrowser,
  EMBEDDED_BROWSER_AUTH_CODE,
  isEmbeddedAppBrowser,
} from "../../src/services/auth/browserAuthPolicy";

test("detects common embedded app browsers", () => {
  assert.equal(
    isEmbeddedAppBrowser(
      "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Zalo/24.1",
    ),
    true,
  );
  assert.equal(
    isEmbeddedAppBrowser(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UP1A; wv) AppleWebKit/537.36 Version/4.0 Chrome/121 Mobile Safari/537.36",
    ),
    true,
  );
});

test("allows Safari and Chrome on iOS", () => {
  assert.equal(
    isEmbeddedAppBrowser(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 Version/17.3 Mobile/15E148 Safari/604.1",
    ),
    false,
  );
  assert.equal(
    isEmbeddedAppBrowser(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 CriOS/121.0 Mobile/15E148 Safari/604.1",
    ),
    false,
  );
});

test("fails before opening Google OAuth in an embedded browser", () => {
  assert.throws(
    () =>
      assertGoogleAuthBrowser(
        "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Instagram 320.0",
      ),
    (error: unknown) =>
      (error as { code?: string }).code === EMBEDDED_BROWSER_AUTH_CODE,
  );
});
