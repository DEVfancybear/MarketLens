import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";

type ApiClientModule = typeof import("../../src/services/api/client");

interface MockBackendResponse {
  status: number;
  body?: unknown;
}

interface RecordedCall {
  method: string;
  path: string;
  credentials: RequestCredentials;
  body: unknown;
}

process.env.NEXT_PUBLIC_API_BASE_URL = "http://backend.test";

let clientPromise: Promise<ApiClientModule> | null = null;

function loadClient(): Promise<ApiClientModule> {
  clientPromise ??= import("../../src/services/api/client");
  return clientPromise;
}

function installFetchMock(
  t: TestContext,
  responses: MockBackendResponse[],
): { calls: RecordedCall[]; assertComplete: () => void } {
  const originalFetch = globalThis.fetch;
  const calls: RecordedCall[] = [];
  let index = 0;

  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const text = await request.clone().text();
    const response = responses[index++];
    if (!response) {
      throw new Error(`Unexpected fetch: ${request.method} ${request.url}`);
    }

    calls.push({
      method: request.method,
      path: new URL(request.url).pathname,
      credentials: request.credentials,
      body: text ? JSON.parse(text) : null,
    });

    return new Response(JSON.stringify(response.body ?? {}), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (clientPromise) {
      (await clientPromise).__setCurrentIdTokenProviderForTests(null);
    }
  });

  return {
    calls,
    assertComplete: () => {
      assert.equal(index, responses.length);
    },
  };
}

function unauthorized(): MockBackendResponse {
  return {
    status: 401,
    body: { error: { code: "unauthorized", message: "unauthorized" } },
  };
}

function notFound(): MockBackendResponse {
  return {
    status: 404,
    body: { error: { code: "not_found", message: "Not found." } },
  };
}

test("GET requests refresh the backend session and retry once", async (t) => {
  const { getJson } = await loadClient();
  const mock = installFetchMock(t, [
    unauthorized(),
    { status: 200, body: { ok: true } },
    { status: 200, body: { theme: "dark" } },
  ]);

  const result = await getJson<{ theme: string }>("settings");

  assert.deepEqual(result, { theme: "dark" });
  assert.deepEqual(
    mock.calls.map((call) => [call.method, call.path]),
    [
      ["GET", "/api/v1/settings"],
      ["POST", "/api/v1/auth/refresh"],
      ["GET", "/api/v1/settings"],
    ],
  );
  assert.equal(mock.calls[0].credentials, "include");
  mock.assertComplete();
});

test("write helpers preserve method and JSON body after session refresh", async (t) => {
  const { postJson, putJson, patchJson, deleteJson } = await loadClient();
  const operations = [
    {
      run: () => postJson<{ ok: string }>("pine-scripts", { name: "VSA" }),
      method: "POST",
      path: "/api/v1/pine-scripts",
      body: { name: "VSA" },
    },
    {
      run: () => putJson<{ ok: string }>("pine-scripts/pine-1", { favorite: true }),
      method: "PUT",
      path: "/api/v1/pine-scripts/pine-1",
      body: { favorite: true },
    },
    {
      run: () => patchJson<{ ok: string }>("settings", { ui: { theme: "dark" } }),
      method: "PATCH",
      path: "/api/v1/settings",
      body: { ui: { theme: "dark" } },
    },
    {
      run: () => deleteJson<{ ok: string }>("pine-scripts/pine-1"),
      method: "DELETE",
      path: "/api/v1/pine-scripts/pine-1",
      body: null,
    },
  ];

  const mock = installFetchMock(
    t,
    operations.flatMap((operation) => [
      unauthorized(),
      { status: 200, body: { ok: true } },
      { status: 200, body: { ok: operation.method } },
    ]),
  );

  for (const operation of operations) {
    assert.deepEqual(await operation.run(), { ok: operation.method });
  }

  for (let i = 0; i < operations.length; i += 1) {
    const operation = operations[i];
    const offset = i * 3;
    assert.deepEqual(
      mock.calls.slice(offset, offset + 3).map((call) => [
        call.method,
        call.path,
      ]),
      [
        [operation.method, operation.path],
        ["POST", "/api/v1/auth/refresh"],
        [operation.method, operation.path],
      ],
    );
    assert.deepEqual(mock.calls[offset].body, operation.body);
    assert.deepEqual(mock.calls[offset + 2].body, operation.body);
  }
  mock.assertComplete();
});

test("401 recovery falls back to Firebase token exchange when refresh fails", async (t) => {
  const {
    __setCurrentIdTokenProviderForTests,
    getJson,
  } = await loadClient();
  __setCurrentIdTokenProviderForTests(async () => "firebase-id-token");
  const mock = installFetchMock(t, [
    unauthorized(),
    unauthorized(),
    { status: 200, body: { user: { id: "user-1" }, isNewUser: false } },
    { status: 200, body: [{ id: "list-1", name: "Watchlist" }] },
  ]);

  const result = await getJson<Array<{ id: string; name: string }>>("watchlists");

  assert.deepEqual(result, [{ id: "list-1", name: "Watchlist" }]);
  assert.deepEqual(
    mock.calls.map((call) => [call.method, call.path]),
    [
      ["GET", "/api/v1/watchlists"],
      ["POST", "/api/v1/auth/refresh"],
      ["POST", "/api/v1/auth/session"],
      ["GET", "/api/v1/watchlists"],
    ],
  );
  assert.deepEqual(mock.calls[2].body, { idToken: "firebase-id-token" });
  mock.assertComplete();
});

test("401 recovery supports a backend that does not have auth/session yet", async (t) => {
  const {
    __setCurrentIdTokenProviderForTests,
    getJson,
  } = await loadClient();
  __setCurrentIdTokenProviderForTests(async () => "firebase-id-token");
  const mock = installFetchMock(t, [
    unauthorized(),
    unauthorized(),
    notFound(),
    { status: 200, body: { user: { id: "user-1" }, isNewUser: false } },
    { status: 200, body: [{ id: "list-1", name: "Watchlist" }] },
  ]);

  const result = await getJson<Array<{ id: string; name: string }>>("watchlists");

  assert.deepEqual(result, [{ id: "list-1", name: "Watchlist" }]);
  assert.deepEqual(
    mock.calls.map((call) => [call.method, call.path]),
    [
      ["GET", "/api/v1/watchlists"],
      ["POST", "/api/v1/auth/refresh"],
      ["POST", "/api/v1/auth/session"],
      ["POST", "/api/v1/auth/google"],
      ["GET", "/api/v1/watchlists"],
    ],
  );
  mock.assertComplete();
});

test("auth bootstrap establishes the backend session in one request", async (t) => {
  const { ensureBackendGoogleSession } = await import(
    "../../src/services/api/resources/authApi"
  );
  const user = {
    id: "user-1",
    email: "trader@example.com",
    displayName: "Trader",
    photoUrl: null,
    createdAt: "2026-07-26T00:00:00Z",
  };
  const mock = installFetchMock(t, [
    { status: 200, body: { user, isNewUser: false } },
  ]);

  assert.deepEqual(await ensureBackendGoogleSession("firebase-id-token"), {
    user,
    isNewUser: false,
  });
  assert.deepEqual(
    mock.calls.map((call) => [call.method, call.path, call.body]),
    [
      [
        "POST",
        "/api/v1/auth/session",
        { idToken: "firebase-id-token" },
      ],
    ],
  );
  assert.equal(mock.calls[0].credentials, "include");
  mock.assertComplete();
});

test("auth bootstrap uses legacy exchange only when session endpoint is absent", async (t) => {
  const { ensureBackendGoogleSession } = await import(
    "../../src/services/api/resources/authApi"
  );
  const user = {
    id: "user-1",
    email: "trader@example.com",
    displayName: "Trader",
    photoUrl: null,
    createdAt: "2026-07-26T00:00:00Z",
  };
  const mock = installFetchMock(t, [
    notFound(),
    { status: 200, body: { user, isNewUser: false } },
  ]);

  assert.deepEqual(await ensureBackendGoogleSession("firebase-id-token"), {
    user,
    isNewUser: false,
  });
  assert.deepEqual(
    mock.calls.map((call) => [call.method, call.path]),
    [
      ["POST", "/api/v1/auth/session"],
      ["POST", "/api/v1/auth/google"],
    ],
  );
  mock.assertComplete();
});

test("auth bootstrap never bypasses a session credential rejection", async (t) => {
  const { ensureBackendGoogleSession } = await import(
    "../../src/services/api/resources/authApi"
  );
  const mock = installFetchMock(t, [unauthorized()]);

  await assert.rejects(
    () => ensureBackendGoogleSession("rejected-token"),
    { name: "ApiError", status: 401 },
  );
  assert.deepEqual(
    mock.calls.map((call) => [call.method, call.path]),
    [["POST", "/api/v1/auth/session"]],
  );
  mock.assertComplete();
});

test("auth endpoints do not recurse into session recovery", async (t) => {
  const { postJson } = await loadClient();
  const mock = installFetchMock(t, [unauthorized(), unauthorized()]);

  await assert.rejects(
    () => postJson("auth/google", { idToken: "bad-token" }),
    { name: "ApiError", status: 401 },
  );
  await assert.rejects(
    () => postJson("auth/session", { idToken: "bad-token" }),
    { name: "ApiError", status: 401 },
  );

  assert.deepEqual(
    mock.calls.map((call) => [call.method, call.path]),
    [
      ["POST", "/api/v1/auth/google"],
      ["POST", "/api/v1/auth/session"],
    ],
  );
  mock.assertComplete();
});
