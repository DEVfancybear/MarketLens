#!/usr/bin/env node
import crypto from "node:crypto";
import http from "node:http";

const PORT = Number(process.env.MOCK_MT5_PORT || 8787);
const HOST = process.env.MOCK_MT5_HOST || "127.0.0.1";
const AUTH_TOKEN = process.env.MOCK_MT5_TOKEN || "";
const REJECT_AUTH = process.env.MOCK_MT5_REJECT_AUTH === "true";
const REJECT_ORDERS = process.env.MOCK_MT5_REJECT_ORDERS === "true";
const CLOSE_AFTER_AUTH = process.env.MOCK_MT5_CLOSE_AFTER_AUTH === "true";

const PROTOCOL_VERSION = 1;
const connections = new Set();
const positions = new Map();
let ticketSeq = 100000;

const account = () => ({
  accountId: "MOCK-10001",
  broker: "Mock MT5 Broker",
  server: "Mock-Demo",
  mode: "demo",
  currency: "USD",
  balance: 10000,
  equity: 10000 + [...positions.values()].reduce((s, p) => s + p.profit, 0),
  margin: 0,
  freeMargin: 10000,
  marginLevel: 0,
  leverage: 100,
  tradeAllowed: true,
  updatedAt: Date.now(),
});

const symbolInfo = (chartSymbol) => ({
  chartSymbol,
  brokerSymbol: brokerSymbolFor(chartSymbol),
  digits: chartSymbol.includes("JPY") ? 3 : chartSymbol.includes("USD") ? 5 : 2,
  point: chartSymbol.includes("JPY") ? 0.001 : chartSymbol.includes("USD") ? 0.00001 : 0.01,
  lotStep: 0.01,
  minLot: 0.01,
  maxLot: 10,
  tradeMode: "full",
  updatedAt: Date.now(),
});

function brokerSymbolFor(chartSymbol) {
  if (chartSymbol === "BTCUSDT") return "BTCUSD";
  if (chartSymbol === "ETHUSDT") return "ETHUSD";
  return chartSymbol;
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
  for (const socket of connections) send(socket, envelope(type, payload, id));
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

function sendSnapshots(socket) {
  send(socket, envelope("account.snapshot", account()));
  send(socket, envelope("positions.snapshot", { positions: [...positions.values()] }));
  send(socket, envelope("orders.snapshot", { orders: [] }));
  for (const symbol of ["BTCUSDT", "ETHUSDT", "EURUSD", "GBPUSD", "XAUUSD"]) {
    send(socket, envelope("symbol.info", symbolInfo(symbol)));
  }
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
      envelope("error", {
        code: "UNSUPPORTED_VERSION",
        message: "Only protocol version 1 is supported",
        requestId: msg.id,
      }),
    );
    return;
  }

  if (msg.type === "auth.request") {
    const token = msg.payload?.token || "";
    if (REJECT_AUTH || (AUTH_TOKEN && token !== AUTH_TOKEN)) {
      send(socket, envelope("auth.reject", { reason: "invalid_token" }, msg.id));
      return;
    }
    send(
      socket,
      envelope(
        "auth.ok",
        { sessionId: `mock_${Date.now().toString(36)}`, expiresAt: Date.now() + 3600000 },
        msg.id,
      ),
    );
    sendSnapshots(socket);
    if (CLOSE_AFTER_AUTH) setTimeout(() => socket.destroy(), 1000);
    return;
  }

  if (msg.type === "heartbeat") {
    send(socket, envelope("heartbeat", { ts: Date.now() }));
    return;
  }

  if (msg.type === "order.place") {
    const order = msg.payload || {};
    if (REJECT_ORDERS) {
      send(
        socket,
        envelope(
          "order.reject",
          {
            requestId: msg.id,
            clientOrderId: order.clientOrderId,
            code: "MOCK_REJECT",
            message: "Mock bridge rejected order",
          },
          msg.id,
        ),
      );
      return;
    }
    send(
      socket,
      envelope(
        "order.ack",
        {
          requestId: msg.id,
          clientOrderId: order.clientOrderId,
          acceptedAt: Date.now(),
        },
        msg.id,
      ),
    );
    setTimeout(() => {
      const ticket = String(ticketSeq++);
      const price = order.price || mockPrice(order.chartSymbol);
      const position = {
        ticket,
        symbol: order.chartSymbol,
        brokerSymbol: order.brokerSymbol,
        side: order.side === "buy" ? "long" : "short",
        volume: order.volume,
        openPrice: price,
        currentPrice: price,
        sl: order.sl,
        tp: order.tp,
        profit: 0,
        comment: order.comment || "mock bridge",
        openedAt: Date.now(),
        updatedAt: Date.now(),
      };
      positions.set(ticket, position);
      broadcast("execution.report", {
        requestId: msg.id,
        clientOrderId: order.clientOrderId,
        ticket,
        symbol: order.chartSymbol,
        brokerSymbol: order.brokerSymbol,
        status: "filled",
        side: order.side,
        volume: order.volume,
        price,
        executedAt: Date.now(),
      });
      broadcast("positions.update", { action: "upsert", position });
      broadcast("account.snapshot", account());
    }, 600);
    return;
  }

  if (msg.type === "order.close") {
    const req = msg.payload || {};
    const position = positions.get(req.ticket);
    send(
      socket,
      envelope(
        "order.ack",
        { requestId: msg.id, clientOrderId: req.clientOrderId, acceptedAt: Date.now() },
        msg.id,
      ),
    );
    if (position) {
      positions.delete(req.ticket);
      broadcast("execution.report", {
        requestId: msg.id,
        clientOrderId: req.clientOrderId,
        ticket: req.ticket,
        symbol: position.symbol,
        brokerSymbol: position.brokerSymbol,
        status: "closed",
        volume: req.volume || position.volume,
        price: position.currentPrice,
        executedAt: Date.now(),
      });
      broadcast("positions.update", { action: "remove", position });
      broadcast("account.snapshot", account());
    }
    return;
  }

  if (msg.type === "order.closeAll") {
    const req = msg.payload || {};
    send(
      socket,
      envelope(
        "order.ack",
        { requestId: msg.id, clientOrderId: req.clientOrderId, acceptedAt: Date.now() },
        msg.id,
      ),
    );
    let closed = 0;
    for (const position of [...positions.values()]) {
      if (req.chartSymbol && position.symbol !== req.chartSymbol) continue;
      positions.delete(position.ticket);
      closed += 1;
      broadcast("positions.update", { action: "remove", position });
    }
    broadcast("execution.report", {
      requestId: msg.id,
      clientOrderId: req.clientOrderId,
      symbol: req.chartSymbol || "ALL",
      brokerSymbol: req.brokerSymbol || "ALL",
      status: "closed",
      volume: closed,
      executedAt: Date.now(),
    });
    broadcast("positions.snapshot", { positions: [...positions.values()] });
    broadcast("account.snapshot", account());
    return;
  }

  if (msg.type === "order.modify") {
    const req = msg.payload || {};
    const position = positions.get(req.ticket);
    send(
      socket,
      envelope(
        "order.ack",
        { requestId: msg.id, clientOrderId: req.clientOrderId, acceptedAt: Date.now() },
        msg.id,
      ),
    );
    if (position) {
      position.sl = req.sl;
      position.tp = req.tp;
      position.updatedAt = Date.now();
      broadcast("execution.report", {
        requestId: msg.id,
        clientOrderId: req.clientOrderId,
        ticket: req.ticket,
        symbol: position.symbol,
        brokerSymbol: position.brokerSymbol,
        status: "modified",
        executedAt: Date.now(),
      });
      broadcast("positions.update", { action: "upsert", position });
    }
    return;
  }

  send(socket, envelope("error", { code: "UNKNOWN_TYPE", message: msg.type, requestId: msg.id }));
}

function mockPrice(symbol) {
  if (symbol === "BTCUSDT") return 60000;
  if (symbol === "ETHUSDT") return 3000;
  if (symbol === "XAUUSD") return 2300;
  return 1.1;
}

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
  connections.add(socket);
  send(socket, envelope("hello", {
    bridgeId: "mock-mt5-bridge",
    bridgeVersion: "0.1.0",
    serverTime: Date.now(),
    accountMode: "demo",
  }));

  let pending = Buffer.alloc(0);
  const heartbeat = setInterval(() => {
    send(socket, envelope("heartbeat", { ts: Date.now() }));
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

server.listen(PORT, HOST, () => {
  console.log(`[mock-mt5] listening on ws://${HOST}:${PORT}`);
  console.log("[mock-mt5] env: MOCK_MT5_REJECT_AUTH=true | MOCK_MT5_REJECT_ORDERS=true | MOCK_MT5_CLOSE_AFTER_AUTH=true");
});
