import assert from "node:assert/strict";
import { test } from "node:test";

import { buildContentSecurityPolicy } from "../../src/services/security/contentSecurityPolicy";

test("production CSP uses a nonce and strict-dynamic without unsafe-eval", () => {
  const policy = buildContentSecurityPolicy("test-nonce", true);
  assert.match(policy, /script-src [^;]*'nonce-test-nonce'/);
  assert.match(policy, /script-src [^;]*'strict-dynamic'/);
  assert.match(policy, /script-src-attr 'none'/);
  assert.match(policy, /style-src [^;]*'nonce-test-nonce'/);
  assert.match(policy, /style-src-attr 'unsafe-inline'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /upgrade-insecure-requests/);
  assert.doesNotMatch(policy, /'unsafe-eval'/);
});

test("development CSP permits only the eval exception needed by the dev runtime", () => {
  const policy = buildContentSecurityPolicy("dev-nonce", false);
  assert.match(policy, /script-src [^;]*'unsafe-eval'/);
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
});

test("configured connect origins are parsed without permitting CSP injection", () => {
  const previous = process.env.CSP_CONNECT_SOURCES;
  process.env.CSP_CONNECT_SOURCES =
    "https://uploads.example.com/path,wss://feed.example.com/socket,invalid; script-src *";
  try {
    const policy = buildContentSecurityPolicy("config-nonce", true);
    assert.match(policy, /connect-src [^;]*https:\/\/uploads\.example\.com/);
    assert.match(policy, /connect-src [^;]*wss:\/\/feed\.example\.com/);
    assert.doesNotMatch(policy, /script-src \*/);
  } finally {
    if (previous == null) delete process.env.CSP_CONNECT_SOURCES;
    else process.env.CSP_CONNECT_SOURCES = previous;
  }
});
