#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const PROTOCOL_VERSION = 1;
const BRIDGE_VERSION = "0.1.0";

const env = process.env;

const boolEnv = (name, fallback) => {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

const numEnv = (name, fallback) => {
  const value = Number(env[name]);
  return Number.isFinite(value) ? value : fallback;
};

const CONFIG = {
  enabled: boolEnv("FTMO_MT5_ENABLED", false),
  dryRun: boolEnv("FTMO_BRIDGE_DRY_RUN", true),
  allowLive: boolEnv("FTMO_BRIDGE_ALLOW_LIVE", false),
  host: env.FTMO_BRIDGE_BIND_HOST || "127.0.0.1",
  port: numEnv("FTMO_BRIDGE_BIND_PORT", 8787),
  token: env.FTMO_BRIDGE_TOKEN || "",
  login: env.FTMO_MT5_LOGIN || "",
  passwordConfigured: Boolean(env.FTMO_MT5_PASSWORD),
  server: env.FTMO_MT5_SERVER || "",
  terminalPath: env.FTMO_MT5_TERMINAL_PATH || "",
  accountLabel: env.FTMO_MT5_ACCOUNT_LABEL || "FTMO",
  accountSize: numEnv("FTMO_ACCOUNT_SIZE", 100000),
  maxDailyLossPct: numEnv("FTMO_MAX_DAILY_LOSS_PCT", 5),
  maxTotalLossPct: numEnv("FTMO_MAX_TOTAL_LOSS_PCT", 10),
  dailyLossSafetyBufferPct: numEnv("FTMO_DAILY_LOSS_SAFETY_BUFFER_PCT", 0.2),
  maxRiskPerTradePct: numEnv("FTMO_MAX_RISK_PER_TRADE_PCT", 0.5),
  maxOrderVolume: numEnv("FTMO_BRIDGE_MAX_ORDER_VOLUME", 1),
  maxDailyOrders: numEnv("FTMO_BRIDGE_MAX_DAILY_ORDERS", 100),
  maxMessagesPerMinute: numEnv("FTMO_BRIDGE_MAX_MESSAGES_PER_MINUTE", 60),
  closeAllEnabled: boolEnv("FTMO_BRIDGE_CLOSE_ALL_ENABLED", true),
  requireStopLoss: boolEnv("FTMO_REQUIRE_STOP_LOSS", true),
  auditPath: env.FTMO_BRIDGE_AUDIT_PATH || path.join(process.cwd(), ".data", "ftmo-mt5-audit.jsonl"),
};

const SYMBOLS = {
  EURUSD: {
    chartSymbol: "EURUSD",
    brokerSymbol: env.FTMO_SYMBOL_EURUSD || "EURUSD",
    digits: 5,
    point: 0.00001,
    lotStep: 0.01,
    minLot: 0.01,
    maxLot: 100,
    tickSize: 0.00001,
    tickValue: 1,
    price: 1.1,
  },
  GBPUSD: {
    chartSymbol: "GBPUSD",
    brokerSymbol: env.FTMO_SYMBOL_GBPUSD || "GBPUSD",
    digits: 5,
    point: 0.00001,
    lotStep: 0.01,
    minLot: 0.01,
    maxLot: 100,
    tickSize: 0.00001,
    tickValue: 1,
    price: 1.27,
  },
  USDJPY: {
    chartSymbol: "USDJPY",
    brokerSymbol: env.FTMO_SYMBOL_USDJPY || "USDJPY",
    digits: 3,
    point: 0.001,
    lotStep: 0.01,
    minLot: 0.01,
    maxLot: 100,
    tickSize: 0.001,
    tickValue: 1,
    price: 160,
  },
  XAUUSD: {
    chartSymbol: "XAUUSD",
    brokerSymbol: env.FTMO_SYMBOL_XAUUSD || "XAUUSD",
    digits: 2,
    point: 0.01,
    lotStep: 0.01,
    minLot: 0.01,
    maxLot: 50,
    tickSize: 0.01,
    tickValue: 1,
    price: 2300,
  },
  BTCUSDT: {
    chartSymbol: "BTCUSDT",
    brokerSymbol: env.FTMO_SYMBOL_BTCUSDT || "BTCUSD",
    digits: 2,
    point: 0.01,
    lotStep: 0.01,
    minLot: 0.01,
    maxLot: 10,
    tickSize: 0.01,
    tickValue: 0.01,
    price: 60000,
  },
  ETHUSDT: {
    chartSymbol: "ETHUSDT",
    brokerSymbol: env.FTMO_SYMBOL_ETHUSDT || "ETHUSD",
    digits: 2,
    point: 0.01,
    lotStep: 0.01,
    minLot: 0.01,
    maxLot: 20,
    tickSize: 0.01,
    tickValue: 0.01,
    price: 3000,
  },
};

const connections = new Map();
const positions = new Map();
const pendingOrders = new Map();
const seenClientOrders = new Map();
let ticketSeq = 700000;
let dailyOrderCount = 0;
let dailyKey = utcDateKey();
let auditWritable = false;

function utcDateKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function resetDailyCountersIfNeeded() {
  const nextKey = utcDateKey();
  if (nextKey !== dailyKey) {
    dailyKey = nextKey;
    dailyOrderCount = 0;
  }
}

function ensureAuditPath() {
  try {
    fs.mkdirSync(path.dirname(CONFIG.auditPath), { recursive: true });
    fs.appendFileSync(CONFIG.auditPath, "");
    auditWritable = true;
  } catch (error) {
    auditWritable = false;
    console.error(`[ftmo-mt5] audit log is not writable: ${error.message}`);
  }
}

function audit(event, data = {}) {
  if (!auditWritable) return;
  const clean = redactSecrets(data);
  const record = {
    ts: new Date().toISOString(),
    event,
    dryRun: CONFIG.dryRun,
    accountLabel: CONFIG.accountLabel,
    ...clean,
  };
  fs.appendFile(CONFIG.auditPath, `${JSON.stringify(record)}\n`, (error) => {
    if (error) {
      auditWritable = false;
      console.error(`[ftmo-mt5] audit append failed: ${error.message}`);
    }
  });
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (/password|token|secret/i.test(key)) return [key, "[redacted]"];
      return [key, redactSecrets(entry)];
    }),
  );
}

function envelope(type, payload, id) {
  return {
    ...(id ? { id } : {}),
    type,
    version: PROTOCOL_VERSION,
    ts: Date.now(),
    payload,
  };
}

function send(socket, msg) {
  if (socket.destroyed) return;
  const payload = Buffer.from(JSON.stringify(msg));
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function broadcast(type, payload, id) {
  for (const socket of connections.keys()) send(socket, envelope(type, payload, id));
}

function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break;
      length = Number(buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }
    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (offset + frameLength > buffer.length) break;
    const mask = masked
      ? buffer.subarray(offset + headerLength, offset + headerLength + 4)
      : null;
    const payload = Buffer.from(
      buffer.subarray(offset + headerLength + maskLength, offset + frameLength),
    );
    if (mask) {
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    }
    frames.push({ opcode, text: payload.toString("utf8") });
    offset += frameLength;
  }
  return { frames, rest: buffer.subarray(offset) };
}

function readiness() {
  const liveMode = !CONFIG.dryRun;
  const checks = [
    {
      name: "bridge_enabled",
      ok: CONFIG.enabled,
      detail: CONFIG.enabled ? "FTMO_MT5_ENABLED=true" : "Set FTMO_MT5_ENABLED=true to accept commands",
    },
    {
      name: "audit_log",
      ok: auditWritable,
      detail: auditWritable ? CONFIG.auditPath : "Audit log is not writable",
    },
    {
      name: "dry_run_default",
      ok: CONFIG.dryRun || CONFIG.allowLive,
      detail: CONFIG.dryRun ? "Dry-run mode is active" : "Live mode explicitly requested",
    },
    {
      name: "mt5_login",
      ok: CONFIG.dryRun || Boolean(CONFIG.login),
      detail: CONFIG.dryRun ? "Not required for dry-run" : "FTMO_MT5_LOGIN must match FTMO credentials",
    },
    {
      name: "mt5_master_password",
      ok: CONFIG.dryRun || CONFIG.passwordConfigured,
      detail: CONFIG.dryRun ? "Not required for dry-run" : "Master password is required for trading",
    },
    {
      name: "mt5_server",
      ok: CONFIG.dryRun || Boolean(CONFIG.server),
      detail: CONFIG.dryRun ? "Not required for dry-run" : "FTMO_MT5_SERVER must match Client Area",
    },
    {
      name: "mt5_terminal",
      ok: CONFIG.dryRun || Boolean(CONFIG.terminalPath),
      detail: CONFIG.dryRun ? "Not required for dry-run" : "FTMO_MT5_TERMINAL_PATH is required",
    },
    {
      name: "live_adapter",
      ok: CONFIG.dryRun,
      detail: liveMode ? "Live MT5 adapter is not implemented in this bridge build" : "Dry-run adapter active",
    },
  ];
  return {
    ready: checks.every((check) => check.ok),
    dryRun: CONFIG.dryRun,
    login: CONFIG.login || undefined,
    server: CONFIG.server || undefined,
    accountMode: CONFIG.dryRun ? "demo" : "unknown",
    checks,
    updatedAt: Date.now(),
  };
}

function accountSnapshot() {
  const profit = [...positions.values()].reduce((sum, position) => sum + position.profit, 0);
  return {
    accountId: CONFIG.login || "FTMO-DRY-RUN",
    broker: "FTMO MT5",
    server: CONFIG.server || "FTMO-DryRun",
    mode: CONFIG.dryRun ? "demo" : "unknown",
    currency: "USD",
    balance: CONFIG.accountSize,
    equity: CONFIG.accountSize + profit,
    margin: 0,
    freeMargin: CONFIG.accountSize + profit,
    marginLevel: 0,
    leverage: 100,
    tradeAllowed: readiness().ready,
    updatedAt: Date.now(),
  };
}

function symbolInfo(chartSymbol) {
  const meta = SYMBOLS[chartSymbol];
  if (!meta) return null;
  return {
    chartSymbol: meta.chartSymbol,
    brokerSymbol: meta.brokerSymbol,
    digits: meta.digits,
    point: meta.point,
    lotStep: meta.lotStep,
    minLot: meta.minLot,
    maxLot: Math.min(meta.maxLot, CONFIG.maxOrderVolume),
    tradeMode: "full",
    updatedAt: Date.now(),
  };
}

function riskSnapshot(extraRisk = 0) {
  const account = accountSnapshot();
  const dailyLossLimit = CONFIG.accountSize * (CONFIG.maxDailyLossPct / 100);
  const maxLossLimit = CONFIG.accountSize * (CONFIG.maxTotalLossPct / 100);
  const safetyBuffer = CONFIG.accountSize * (CONFIG.dailyLossSafetyBufferPct / 100);
  const dailyLossUsed = Math.max(0, CONFIG.accountSize - account.equity);
  const maxLossUsed = Math.max(0, CONFIG.accountSize - account.equity);
  const openRiskAtStops = [...positions.values()].reduce(
    (sum, position) => sum + estimatePositionRisk(position),
    0,
  );
  const dailyLossRemaining = Math.max(0, dailyLossLimit - safetyBuffer - dailyLossUsed - openRiskAtStops);
  const maxLossRemaining = Math.max(0, maxLossLimit - maxLossUsed - openRiskAtStops);
  const canTrade =
    readiness().ready &&
    dailyLossRemaining > 0 &&
    maxLossRemaining > 0 &&
    dailyOrderCount < CONFIG.maxDailyOrders &&
    extraRisk <= dailyLossRemaining &&
    extraRisk <= maxLossRemaining;
  return {
    accountSize: CONFIG.accountSize,
    dailyLossLimit,
    maxLossLimit,
    dailyLossUsed,
    dailyLossRemaining,
    maxLossRemaining,
    openRiskAtStops,
    dailyOrderCount,
    maxDailyOrders: CONFIG.maxDailyOrders,
    canTrade,
    reason: canTrade ? undefined : riskBlockReason(dailyLossRemaining, maxLossRemaining, extraRisk),
    updatedAt: Date.now(),
  };
}

function riskBlockReason(dailyLossRemaining, maxLossRemaining, extraRisk) {
  if (!readiness().ready) return "FTMO bridge readiness failed";
  if (dailyOrderCount >= CONFIG.maxDailyOrders) return "Daily order limit reached";
  if (dailyLossRemaining <= 0) return "Daily loss guard has no remaining buffer";
  if (maxLossRemaining <= 0) return "Maximum loss guard has no remaining buffer";
  if (extraRisk > dailyLossRemaining) return "Projected stop loss exceeds daily loss buffer";
  if (extraRisk > maxLossRemaining) return "Projected stop loss exceeds maximum loss buffer";
  return "Risk guard blocked trading";
}

function estimatePositionRisk(position) {
  const meta = SYMBOLS[position.symbol];
  if (!meta || !Number.isFinite(position.sl)) return 0;
  return Math.abs(position.openPrice - position.sl) / meta.tickSize * meta.tickValue * position.volume;
}

function estimateOrderRisk(order, normalizedVolume) {
  const meta = SYMBOLS[order.chartSymbol];
  if (!meta || !Number.isFinite(order.sl)) return 0;
  const entryPrice = Number.isFinite(order.price) ? order.price : meta.price;
  const stopDistance = Math.abs(entryPrice - order.sl);
  if (stopDistance <= 0) return Number.POSITIVE_INFINITY;
  return stopDistance / meta.tickSize * meta.tickValue * normalizedVolume;
}

function normalizeVolume(meta, volume) {
  const step = meta.lotStep;
  const decimals = String(step).includes(".") ? String(step).split(".")[1].length : 0;
  const stepped = Math.floor((volume + Number.EPSILON) / step) * step;
  return Number(stepped.toFixed(decimals));
}

function validateRateLimit(socket, msg) {
  const state = connections.get(socket);
  if (!state) return true;
  const now = Date.now();
  state.messageTimes = state.messageTimes.filter((ts) => now - ts < 60000);
  state.messageTimes.push(now);
  if (state.messageTimes.length <= CONFIG.maxMessagesPerMinute) return true;
  send(
    socket,
    envelope(
      "error",
      {
        code: "RATE_LIMITED",
        message: "FTMO bridge message rate limit exceeded",
        requestId: msg.id,
      },
      msg.id,
    ),
  );
  audit("rate_limited", { requestId: msg.id, type: msg.type });
  return false;
}

function sendSnapshots(socket) {
  send(socket, envelope("ftmo.readiness", readiness()));
  send(socket, envelope("risk.snapshot", riskSnapshot()));
  send(socket, envelope("account.snapshot", accountSnapshot()));
  send(socket, envelope("positions.snapshot", { positions: [...positions.values()] }));
  send(socket, envelope("orders.snapshot", { orders: [...pendingOrders.values()] }));
  for (const symbol of Object.keys(SYMBOLS)) send(socket, envelope("symbol.info", symbolInfo(symbol)));
}

function rejectOrder(socket, msg, code, message, clientOrderId, snapshot = riskSnapshot()) {
  const payload = {
    requestId: msg.id,
    clientOrderId,
    code,
    message,
    snapshot,
  };
  send(socket, envelope("order.reject", payload, msg.id));
  audit("order_reject", payload);
  if (clientOrderId) seenClientOrders.set(clientOrderId, { type: "reject", payload });
}

function ackOrder(socket, msg, clientOrderId, extra = {}) {
  const payload = {
    requestId: msg.id,
    clientOrderId,
    acceptedAt: Date.now(),
    ...extra,
  };
  send(socket, envelope("order.ack", payload, msg.id));
  audit("order_ack", payload);
  return payload;
}

function validateOrder(order) {
  resetDailyCountersIfNeeded();
  if (!CONFIG.enabled) {
    return { ok: false, code: "FTMO_BRIDGE_DISABLED", message: "FTMO_MT5_ENABLED is false" };
  }
  if (!CONFIG.dryRun) {
    return {
      ok: false,
      code: "LIVE_ADAPTER_NOT_CONFIGURED",
      message: "Live FTMO MT5 execution is blocked until a real MT5 adapter is configured",
    };
  }
  const currentReadiness = readiness();
  if (!currentReadiness.ready) {
    return {
      ok: false,
      code: "FTMO_READINESS_FAILED",
      message: "FTMO bridge readiness checks failed",
    };
  }
  if (!order || typeof order !== "object") {
    return { ok: false, code: "INVALID_ORDER", message: "Order payload is required" };
  }
  if (!order.clientOrderId) {
    return { ok: false, code: "CLIENT_ORDER_ID_REQUIRED", message: "clientOrderId is required" };
  }
  if (!["buy", "sell"].includes(order.side)) {
    return { ok: false, code: "INVALID_SIDE", message: "Order side must be buy or sell" };
  }
  if (!["market", "limit", "stop"].includes(order.type)) {
    return { ok: false, code: "INVALID_ORDER_TYPE", message: "Order type must be market, limit, or stop" };
  }
  const meta = SYMBOLS[order.chartSymbol];
  if (!meta) {
    return { ok: false, code: "UNKNOWN_SYMBOL", message: `No FTMO symbol mapping for ${order.chartSymbol}` };
  }
  const requestedVolume = Number(order.volume);
  if (!Number.isFinite(requestedVolume) || requestedVolume <= 0) {
    return { ok: false, code: "INVALID_VOLUME", message: "Order volume must be a positive number" };
  }
  const maxAllowed = Math.min(meta.maxLot, CONFIG.maxOrderVolume);
  if (requestedVolume > maxAllowed) {
    return {
      ok: false,
      code: "MAX_VOLUME_EXCEEDED",
      message: `Requested volume ${requestedVolume} exceeds max allowed ${maxAllowed}`,
    };
  }
  const normalizedVolume = normalizeVolume(meta, requestedVolume);
  if (normalizedVolume < meta.minLot) {
    return {
      ok: false,
      code: "MIN_VOLUME_NOT_MET",
      message: `Normalized volume ${normalizedVolume} is below minimum ${meta.minLot}`,
    };
  }
  if (CONFIG.requireStopLoss && !Number.isFinite(order.sl)) {
    return { ok: false, code: "STOP_LOSS_REQUIRED", message: "FTMO bridge requires stop loss" };
  }
  const projectedRisk = estimateOrderRisk(order, normalizedVolume);
  if (!Number.isFinite(projectedRisk)) {
    return { ok: false, code: "INVALID_STOP_DISTANCE", message: "Stop loss must differ from entry price" };
  }
  const maxRiskPerTrade = CONFIG.accountSize * (CONFIG.maxRiskPerTradePct / 100);
  if (projectedRisk > maxRiskPerTrade) {
    return {
      ok: false,
      code: "MAX_RISK_PER_TRADE_EXCEEDED",
      message: `Projected stop risk ${projectedRisk.toFixed(2)} exceeds ${maxRiskPerTrade.toFixed(2)}`,
    };
  }
  const snapshot = riskSnapshot(projectedRisk);
  if (!snapshot.canTrade) {
    return {
      ok: false,
      code: "FTMO_RISK_GUARD",
      message: snapshot.reason || "FTMO risk guard blocked the order",
      snapshot,
    };
  }
  return {
    ok: true,
    meta,
    normalizedVolume,
    projectedRisk,
    snapshot,
  };
}

function handleOrderPlace(socket, msg) {
  const order = msg.payload || {};
  audit("order_request", { requestId: msg.id, order });
  const duplicate = seenClientOrders.get(order.clientOrderId);
  if (duplicate) {
    audit("order_duplicate", { requestId: msg.id, clientOrderId: order.clientOrderId });
    if (duplicate.type === "reject") {
      send(socket, envelope("order.reject", { ...duplicate.payload, requestId: msg.id }, msg.id));
    } else {
      send(socket, envelope("order.ack", { ...duplicate.ack, requestId: msg.id }, msg.id));
      if (duplicate.execution) {
        send(socket, envelope("execution.report", { ...duplicate.execution, requestId: msg.id }));
      }
    }
    return;
  }

  const validation = validateOrder(order);
  if (!validation.ok) {
    rejectOrder(socket, msg, validation.code, validation.message, order.clientOrderId, validation.snapshot);
    return;
  }

  const normalizedOrder = {
    ...order,
    brokerSymbol: validation.meta.brokerSymbol,
    volume: validation.normalizedVolume,
    price: Number.isFinite(order.price) ? order.price : validation.meta.price,
  };
  const ack = ackOrder(socket, msg, order.clientOrderId, {
    dryRun: true,
    normalizedVolume: validation.normalizedVolume,
    projectedRisk: Number(validation.projectedRisk.toFixed(2)),
  });
  seenClientOrders.set(order.clientOrderId, { type: "accepted", ack });
  dailyOrderCount += 1;

  setTimeout(() => {
    const ticket = String(ticketSeq++);
    const position = {
      ticket,
      symbol: normalizedOrder.chartSymbol,
      brokerSymbol: normalizedOrder.brokerSymbol,
      side: normalizedOrder.side === "buy" ? "long" : "short",
      volume: normalizedOrder.volume,
      openPrice: normalizedOrder.price,
      currentPrice: normalizedOrder.price,
      sl: normalizedOrder.sl,
      tp: normalizedOrder.tp,
      profit: 0,
      comment: normalizedOrder.comment || "ftmo dry-run bridge",
      openedAt: Date.now(),
      updatedAt: Date.now(),
    };
    positions.set(ticket, position);
    const execution = {
      requestId: msg.id,
      clientOrderId: normalizedOrder.clientOrderId,
      ticket,
      symbol: normalizedOrder.chartSymbol,
      brokerSymbol: normalizedOrder.brokerSymbol,
      status: "filled",
      side: normalizedOrder.side,
      volume: normalizedOrder.volume,
      price: normalizedOrder.price,
      dryRun: true,
      projectedRisk: Number(validation.projectedRisk.toFixed(2)),
      executedAt: Date.now(),
    };
    seenClientOrders.set(order.clientOrderId, { type: "accepted", ack, execution });
    audit("execution_report", { execution, position });
    broadcast("execution.report", execution);
    broadcast("positions.update", { action: "upsert", position });
    broadcast("account.snapshot", accountSnapshot());
    broadcast("risk.snapshot", riskSnapshot());
  }, 250);
}

function handleOrderClose(socket, msg) {
  const req = msg.payload || {};
  if (!CONFIG.enabled) {
    rejectOrder(socket, msg, "FTMO_BRIDGE_DISABLED", "FTMO_MT5_ENABLED is false", req.clientOrderId);
    return;
  }
  ackOrder(socket, msg, req.clientOrderId, { dryRun: CONFIG.dryRun });
  const position = positions.get(req.ticket);
  if (!position) {
    audit("close_missing_position", { requestId: msg.id, ticket: req.ticket });
    return;
  }
  positions.delete(req.ticket);
  const execution = {
    requestId: msg.id,
    clientOrderId: req.clientOrderId,
    ticket: req.ticket,
    symbol: position.symbol,
    brokerSymbol: position.brokerSymbol,
    status: "closed",
    volume: req.volume || position.volume,
    price: position.currentPrice,
    dryRun: CONFIG.dryRun,
    executedAt: Date.now(),
  };
  audit("execution_report", { execution });
  broadcast("execution.report", execution);
  broadcast("positions.update", { action: "remove", position });
  broadcast("account.snapshot", accountSnapshot());
  broadcast("risk.snapshot", riskSnapshot());
}

function handleOrderCloseAll(socket, msg) {
  const req = msg.payload || {};
  if (!CONFIG.closeAllEnabled) {
    rejectOrder(socket, msg, "CLOSE_ALL_DISABLED", "FTMO close-all is disabled", req.clientOrderId);
    return;
  }
  if (!CONFIG.enabled) {
    rejectOrder(socket, msg, "FTMO_BRIDGE_DISABLED", "FTMO_MT5_ENABLED is false", req.clientOrderId);
    return;
  }
  ackOrder(socket, msg, req.clientOrderId, { dryRun: CONFIG.dryRun });
  let closed = 0;
  for (const position of [...positions.values()]) {
    if (req.chartSymbol && position.symbol !== req.chartSymbol) continue;
    if (req.side && position.side !== req.side) continue;
    positions.delete(position.ticket);
    closed += 1;
    broadcast("positions.update", { action: "remove", position });
  }
  const execution = {
    requestId: msg.id,
    clientOrderId: req.clientOrderId,
    symbol: req.chartSymbol || "ALL",
    brokerSymbol: req.brokerSymbol || "ALL",
    status: "closed",
    volume: closed,
    dryRun: CONFIG.dryRun,
    executedAt: Date.now(),
  };
  audit("execution_report", { execution });
  broadcast("execution.report", execution);
  broadcast("positions.snapshot", { positions: [...positions.values()] });
  broadcast("account.snapshot", accountSnapshot());
  broadcast("risk.snapshot", riskSnapshot());
}

function handleOrderModify(socket, msg) {
  const req = msg.payload || {};
  ackOrder(socket, msg, req.clientOrderId, { dryRun: CONFIG.dryRun });
  const position = positions.get(req.ticket);
  if (!position) {
    audit("modify_missing_position", { requestId: msg.id, ticket: req.ticket });
    return;
  }
  position.sl = req.sl;
  position.tp = req.tp;
  position.updatedAt = Date.now();
  const execution = {
    requestId: msg.id,
    clientOrderId: req.clientOrderId,
    ticket: req.ticket,
    symbol: position.symbol,
    brokerSymbol: position.brokerSymbol,
    status: "modified",
    dryRun: CONFIG.dryRun,
    executedAt: Date.now(),
  };
  audit("execution_report", { execution, position });
  broadcast("execution.report", execution);
  broadcast("positions.update", { action: "upsert", position });
  broadcast("risk.snapshot", riskSnapshot());
}

function handleOrderCancel(socket, msg) {
  const req = msg.payload || {};
  ackOrder(socket, msg, req.clientOrderId, { dryRun: CONFIG.dryRun });
  const order = pendingOrders.get(req.ticket);
  if (order) pendingOrders.delete(req.ticket);
  const execution = {
    requestId: msg.id,
    clientOrderId: req.clientOrderId,
    ticket: req.ticket,
    symbol: order?.symbol || "UNKNOWN",
    brokerSymbol: order?.brokerSymbol || "UNKNOWN",
    status: "cancelled",
    dryRun: CONFIG.dryRun,
    executedAt: Date.now(),
  };
  audit("execution_report", { execution });
  broadcast("execution.report", execution);
  broadcast("orders.snapshot", { orders: [...pendingOrders.values()] });
}

function handleMessage(socket, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    send(socket, envelope("error", { code: "INVALID_MESSAGE", message: "Invalid JSON" }));
    return;
  }

  if (msg.version !== PROTOCOL_VERSION || typeof msg.type !== "string") {
    send(
      socket,
      envelope(
        "error",
        {
          code: "UNSUPPORTED_VERSION",
          message: "Only protocol version 1 is supported",
          requestId: msg.id,
        },
        msg.id,
      ),
    );
    return;
  }

  if (!validateRateLimit(socket, msg)) return;

  if (msg.type === "auth.request") {
    const token = msg.payload?.token || "";
    if (CONFIG.token && token !== CONFIG.token) {
      send(socket, envelope("auth.reject", { reason: "invalid_token" }, msg.id));
      audit("auth_reject", { requestId: msg.id });
      return;
    }
    const sessionId = `ftmo_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
    send(socket, envelope("auth.ok", { sessionId, expiresAt: Date.now() + 3600000 }, msg.id));
    audit("auth_ok", { requestId: msg.id, sessionId });
    sendSnapshots(socket);
    return;
  }

  if (msg.type === "heartbeat") {
    send(socket, envelope("heartbeat", { ts: Date.now() }));
    return;
  }

  switch (msg.type) {
    case "order.place":
      handleOrderPlace(socket, msg);
      return;
    case "order.close":
      handleOrderClose(socket, msg);
      return;
    case "order.closeAll":
      handleOrderCloseAll(socket, msg);
      return;
    case "order.modify":
      handleOrderModify(socket, msg);
      return;
    case "order.cancel":
      handleOrderCancel(socket, msg);
      return;
    default:
      send(socket, envelope("error", { code: "UNKNOWN_TYPE", message: msg.type, requestId: msg.id }, msg.id));
  }
}

ensureAuditPath();

const server = http.createServer((_req, res) => {
  res.writeHead(426, { "content-type": "text/plain" });
  res.end("WebSocket upgrade required\n");
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );
  connections.set(socket, { messageTimes: [] });
  send(
    socket,
    envelope("hello", {
      bridgeId: "ftmo-mt5-bridge",
      bridgeVersion: BRIDGE_VERSION,
      serverTime: Date.now(),
      accountMode: CONFIG.dryRun ? "demo" : "unknown",
      dryRun: CONFIG.dryRun,
    }),
  );

  let pending = Buffer.alloc(0);
  const heartbeat = setInterval(() => {
    send(socket, envelope("heartbeat", { ts: Date.now() }));
    send(socket, envelope("ftmo.readiness", readiness()));
    send(socket, envelope("risk.snapshot", riskSnapshot()));
  }, 5000);

  socket.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    const decoded = decodeFrames(pending);
    pending = decoded.rest;
    for (const frame of decoded.frames) {
      if (frame.opcode === 0x8) {
        socket.end();
        return;
      }
      if (frame.opcode === 0x1) handleMessage(socket, frame.text);
    }
  });
  socket.on("close", () => {
    clearInterval(heartbeat);
    connections.delete(socket);
  });
  socket.on("error", () => {
    clearInterval(heartbeat);
    connections.delete(socket);
  });
});

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`[ftmo-mt5] listening on ws://${CONFIG.host}:${CONFIG.port}`);
  console.log(`[ftmo-mt5] enabled=${CONFIG.enabled} dryRun=${CONFIG.dryRun} audit=${CONFIG.auditPath}`);
  if (!CONFIG.dryRun) {
    console.warn("[ftmo-mt5] live execution is blocked in this build until a real MT5 adapter is added");
  }
});

function shutdown() {
  audit("bridge_shutdown");
  for (const socket of connections.keys()) socket.destroy();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
