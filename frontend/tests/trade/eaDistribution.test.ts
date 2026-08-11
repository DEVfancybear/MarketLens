import assert from "node:assert/strict";
import test from "node:test";
import {
  EXECUTION_EA_RELEASE_VERSION,
  resolveExecutionEaChecksumUrl,
  resolveExecutionEaDownloadUrl,
  resolveExecutionEaGatewayUrl,
  resolveExecutionEaWebRequestOrigin,
} from "../../src/services/execution/eaDistribution";

test("EA distribution advertises the compiled portfolio-sync release", () => {
  assert.equal(EXECUTION_EA_RELEASE_VERSION, "1.24");
});

test("EA release uses same-origin public assets by default", () => {
  assert.equal(
    resolveExecutionEaDownloadUrl(),
    "/downloads/MarketLensExecutionEA.ex5",
  );
  assert.equal(
    resolveExecutionEaChecksumUrl(),
    "/downloads/MarketLensExecutionEA.sha256.txt",
  );
});

test("EA download rejects unsafe configured protocols", () => {
  assert.equal(
    resolveExecutionEaDownloadUrl("javascript:alert(1)"),
    "/downloads/MarketLensExecutionEA.ex5",
  );
  assert.equal(
    resolveExecutionEaDownloadUrl("//attacker.example/ea.ex5"),
    "/downloads/MarketLensExecutionEA.ex5",
  );
});

test("EA download accepts an HTTPS release CDN", () => {
  assert.equal(
    resolveExecutionEaDownloadUrl("https://cdn.example.com/MarketLensExecutionEA.ex5"),
    "https://cdn.example.com/MarketLensExecutionEA.ex5",
  );
});

test("EA gateway prefers the explicit public URL", () => {
  assert.equal(
    resolveExecutionEaGatewayUrl({
      configuredUrl: "https://api.example.com/execution-ea/",
      apiBaseUrl: "https://ignored.example.com",
    }),
    "https://api.example.com/execution-ea",
  );
});

test("EA gateway derives the relay from the API origin", () => {
  assert.equal(
    resolveExecutionEaGatewayUrl({
      apiBaseUrl: "https://api.example.com/",
    }),
    "https://api.example.com/execution-ea",
  );
});

test("EA gateway rejects unsafe URLs and falls back to the browser origin", () => {
  assert.equal(
    resolveExecutionEaGatewayUrl({
      configuredUrl: "file:///tmp/socket",
      apiBaseUrl: "javascript:alert(1)",
      browserOrigin: "https://trade.example.com",
    }),
    "https://trade.example.com/execution-ea",
  );
});

test("EA gateway rejects credentials, queries and fragments", () => {
  for (const configuredUrl of [
    "https://user:secret@api.example.com/execution-ea",
    "https://api.example.com/execution-ea?token=secret",
    "https://api.example.com/execution-ea#fragment",
  ]) {
    assert.equal(
      resolveExecutionEaGatewayUrl({
        configuredUrl,
        apiBaseUrl: "https://api.example.com",
      }),
      "https://api.example.com/execution-ea",
    );
  }
});

test("EA gateway rejects plain HTTP outside a loopback host", () => {
  assert.equal(
    resolveExecutionEaGatewayUrl({
      configuredUrl: "http://api.example.com/execution-ea",
      apiBaseUrl: "https://api.example.com",
    }),
    "https://api.example.com/execution-ea",
  );
  assert.equal(
    resolveExecutionEaGatewayUrl({
      configuredUrl: "http://127.0.0.1:8790",
    }),
    "http://127.0.0.1:8790",
  );
});

test("EA WebRequest allow-list uses only the trusted gateway origin", () => {
  assert.equal(
    resolveExecutionEaWebRequestOrigin(
      "https://api.example.com/execution-ea",
    ),
    "https://api.example.com",
  );
  assert.equal(
    resolveExecutionEaWebRequestOrigin("javascript:alert(1)"),
    "",
  );
});
