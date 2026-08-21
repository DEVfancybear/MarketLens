import { expect, request, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";

type OperationalConfig = {
  accountId: string;
  baseURL: string;
  bootstrapTokenFile: string;
  stateFile: string;
  workerId: string;
};

type PrimeState = {
  accountId: string;
  oldCommandId: string;
  oldLeaseGeneration: number;
  oldSessionGeneration: number;
  oldSessionToken: string;
  protocolVersion: number;
  workerId: string;
};

type ProvisionCommand = Record<string, unknown> & {
  accountId: string;
  commandId: string;
  credentialGrant?: string;
  kind: "provision_account";
  leaseGeneration: number;
};

const exactKeys = (value: object, expected: string[]) => {
  expect(Object.keys(value).sort()).toEqual([...expected].sort());
};

const expectProvisionCommand: (
  value: Record<string, unknown>,
) => asserts value is ProvisionCommand = (value) => {
  expect(value.kind).toBe("provision_account");
  expect(typeof value.accountId).toBe("string");
  expect(typeof value.commandId).toBe("string");
  expect(typeof value.leaseGeneration).toBe("number");
  expect(typeof value.credentialGrant).toBe("string");
  expect(value.commandId).toMatch(/^[0-9a-f-]{36}$/);
  expect(Number.isSafeInteger(value.leaseGeneration)).toBe(true);
  expect(value.leaseGeneration).toBeGreaterThan(0);
  expect(value.credentialGrant).toMatch(/^[0-9a-f]{64}$/);
};

const readOperationalConfig = (): OperationalConfig => {
  const configPath = process.env.MT5_PHASE2_TEST_CONFIG_FILE;
  expect(configPath, "MT5_PHASE2_TEST_CONFIG_FILE is required").toBeTruthy();
  expect(isAbsolute(configPath!)).toBe(true);
  const value = JSON.parse(readFileSync(realpathSync(configPath!), "utf8")) as OperationalConfig;
  exactKeys(value, ["accountId", "baseURL", "bootstrapTokenFile", "stateFile", "workerId"]);
  expect(value.baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(isAbsolute(value.bootstrapTokenFile)).toBe(true);
  expect(isAbsolute(value.stateFile)).toBe(true);
  expect(value.workerId).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
  expect(value.accountId).toMatch(/^[a-z0-9][a-z0-9_-]{7,95}$/);
  return value;
};

const readBootstrapToken = (path: string) => {
  const token = readFileSync(realpathSync(path), "utf8").trim();
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  return token;
};

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const expectStatus = async (response: APIResponse, status: number) => {
  expect(response.status()).toBe(status);
  await response.dispose();
};

const hello = async (
  api: APIRequestContext,
  config: OperationalConfig,
  bootstrapToken: string,
) => {
  const response = await api.post("/v1/mt5-vm/workers/hello", {
    headers: { "x-mt5-vm-bootstrap-token": bootstrapToken },
    data: {
      workerId: config.workerId,
      protocolMin: 1,
      protocolMax: 1,
      agentVersion: "phase2-operational-harness",
      imageVersion: "disposable-loopback",
      runtimeVersion: "mt5-python-v1",
      capacity: 1,
      region: "loopback",
      capabilities: ["read_sync"],
    },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  await response.dispose();
  expect(body.protocolVersion).toBe(1);
  expect(body.workerId).toBe(config.workerId);
  expect(body.sessionGeneration).toBeGreaterThan(0);
  expect(body.sessionToken).toMatch(/^[0-9a-f]{64}$/);
  return body as {
    protocolVersion: number;
    sessionGeneration: number;
    sessionToken: string;
  };
};

const pollForSingleProvision = async (
  api: APIRequestContext,
  state: Pick<PrimeState, "protocolVersion" | "workerId"> & {
    sessionGeneration: number;
    sessionToken: string;
  },
) => {
  let captured: Record<string, unknown> | undefined;
  await expect
    .poll(
      async () => {
        const response = await api.post("/v1/mt5-vm/workers/poll", {
          headers: bearer(state.sessionToken),
          data: {
            protocolVersion: state.protocolVersion,
            workerId: state.workerId,
            sessionGeneration: state.sessionGeneration,
            maxCommands: 1,
          },
        });
        expect(response.status()).toBe(200);
        const body = await response.json();
        await response.dispose();
        expect(body.protocolVersion).toBe(1);
        const commands = body.commands as Record<string, unknown>[];
        expect(Array.isArray(commands)).toBe(true);
        if (commands.length === 1) captured = commands[0];
        return commands.length;
      },
      { timeout: 10_000, intervals: [100, 200, 500, 1_000] },
    )
    .toBe(1);
  expect(captured).toBeDefined();
  const command = captured!;
  expectProvisionCommand(command);
  return command;
};

const runPrime = async (api: APIRequestContext, config: OperationalConfig) => {
  const session = await hello(api, config, readBootstrapToken(config.bootstrapTokenFile));
  const heartbeat = await api.post("/v1/mt5-vm/workers/heartbeat", {
    headers: bearer(session.sessionToken),
    data: {
      protocolVersion: 1,
      workerId: config.workerId,
      sessionGeneration: session.sessionGeneration,
      leases: [],
    },
  });
  await expectStatus(heartbeat, 200);

  const command = await pollForSingleProvision(api, {
    protocolVersion: 1,
    workerId: config.workerId,
    sessionGeneration: session.sessionGeneration,
    sessionToken: session.sessionToken,
  });
  expect(command.accountId).toBe(config.accountId);
  expect(command.leaseGeneration).toBeGreaterThan(0);
  expect(command.commandId).toMatch(/^[0-9a-f-]{36}$/);
  delete command.credentialGrant;
  writeFileSync(
    config.stateFile,
    JSON.stringify({
      accountId: config.accountId,
      oldCommandId: command.commandId,
      oldLeaseGeneration: command.leaseGeneration,
      oldSessionGeneration: session.sessionGeneration,
      oldSessionToken: session.sessionToken,
      protocolVersion: 1,
      workerId: config.workerId,
    } satisfies PrimeState),
    { encoding: "utf8" },
  );
};

const runRotate = async (api: APIRequestContext, config: OperationalConfig) => {
  const state = JSON.parse(readFileSync(realpathSync(config.stateFile), "utf8")) as PrimeState;
  exactKeys(state, [
    "accountId",
    "oldCommandId",
    "oldLeaseGeneration",
    "oldSessionGeneration",
    "oldSessionToken",
    "protocolVersion",
    "workerId",
  ]);
  expect(state.accountId).toBe(config.accountId);
  expect(state.workerId).toBe(config.workerId);
  expect(state.oldSessionToken).toMatch(/^[0-9a-f]{64}$/);

  const persistedHeartbeat = await api.post("/v1/mt5-vm/workers/heartbeat", {
    headers: bearer(state.oldSessionToken),
    data: {
      protocolVersion: 1,
      workerId: state.workerId,
      sessionGeneration: state.oldSessionGeneration,
      leases: [],
    },
  });
  await expectStatus(persistedHeartbeat, 200);

  const rotated = await hello(api, config, readBootstrapToken(config.bootstrapTokenFile));
  expect(rotated.sessionGeneration).toBe(state.oldSessionGeneration + 1);

  const staleHeartbeat = await api.post("/v1/mt5-vm/workers/heartbeat", {
    headers: bearer(state.oldSessionToken),
    data: {
      protocolVersion: 1,
      workerId: state.workerId,
      sessionGeneration: state.oldSessionGeneration,
      leases: [],
    },
  });
  await expectStatus(staleHeartbeat, 401);

  const stalePoll = await api.post("/v1/mt5-vm/workers/poll", {
    headers: bearer(state.oldSessionToken),
    data: {
      protocolVersion: 1,
      workerId: state.workerId,
      sessionGeneration: state.oldSessionGeneration,
      maxCommands: 1,
    },
  });
  await expectStatus(stalePoll, 401);

  const staleAck = await api.post("/v1/mt5-vm/workers/ack", {
    headers: bearer(state.oldSessionToken),
    data: {
      protocolVersion: 1,
      workerId: state.workerId,
      sessionGeneration: state.oldSessionGeneration,
      accountId: state.accountId,
      leaseGeneration: state.oldLeaseGeneration,
      commandId: state.oldCommandId,
      ack: "received",
    },
  });
  await expectStatus(staleAck, 401);

  const now = Date.now();
  const staleSnapshot = await api.post("/v1/mt5-vm/workers/snapshots", {
    headers: bearer(state.oldSessionToken),
    data: {
      protocolVersion: 1,
      workerId: state.workerId,
      sessionGeneration: state.oldSessionGeneration,
      accountId: state.accountId,
      leaseGeneration: state.oldLeaseGeneration,
      syncSequence: 1,
      observedAtMs: now,
      family: "positions",
      result: "complete",
      payload: { kind: "positions", data: { positions: [] } },
    },
  });
  await expectStatus(staleSnapshot, 401);

  const staleHistory = await api.post("/v1/mt5-vm/workers/history", {
    headers: bearer(state.oldSessionToken),
    data: {
      protocolVersion: 1,
      workerId: state.workerId,
      sessionGeneration: state.oldSessionGeneration,
      accountId: state.accountId,
      leaseGeneration: state.oldLeaseGeneration,
      syncSequence: 1,
      observedAtMs: now,
      fromMs: now - 1_000,
      toMs: now,
      coveredThroughMs: now,
      family: "orders_history",
      result: "complete",
      payload: { kind: "orders_history", data: { orders: [] } },
    },
  });
  await expectStatus(staleHistory, 401);

  const currentCommand = await pollForSingleProvision(api, {
    protocolVersion: 1,
    workerId: state.workerId,
    sessionGeneration: rotated.sessionGeneration,
    sessionToken: rotated.sessionToken,
  });
  expect(currentCommand.accountId).toBe(state.accountId);
  expect(currentCommand.commandId).not.toBe(state.oldCommandId);
  expect(currentCommand.leaseGeneration).toBeGreaterThan(state.oldLeaseGeneration);
  delete currentCommand.credentialGrant;

  const currentHeartbeat = await api.post("/v1/mt5-vm/workers/heartbeat", {
    headers: bearer(rotated.sessionToken),
    data: {
      protocolVersion: 1,
      workerId: state.workerId,
      sessionGeneration: rotated.sessionGeneration,
      leases: [{ accountId: state.accountId, leaseGeneration: currentCommand.leaseGeneration }],
    },
  });
  await expectStatus(currentHeartbeat, 200);

  const duplicatePoll = await api.post("/v1/mt5-vm/workers/poll", {
    headers: bearer(rotated.sessionToken),
    data: {
      protocolVersion: 1,
      workerId: state.workerId,
      sessionGeneration: rotated.sessionGeneration,
      maxCommands: 1,
    },
  });
  expect(duplicatePoll.status()).toBe(200);
  expect((await duplicatePoll.json()).commands).toHaveLength(0);
  await duplicatePoll.dispose();
};

test("TC-MT5-P2-OP-01: restart persistence, session fencing, and single reassignment", async () => {
  const config = readOperationalConfig();
  const stage = process.env.MT5_PHASE2_OPERATIONAL_STAGE;
  expect(["prime", "rotate"]).toContain(stage);
  const api = await request.newContext({ baseURL: config.baseURL });
  try {
    if (stage === "prime") await runPrime(api, config);
    else await runRotate(api, config);
  } finally {
    await api.dispose();
  }
});
