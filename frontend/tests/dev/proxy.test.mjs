import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { test } from 'node:test';
import { chromium } from '@playwright/test';
import { createDevProxy, upstreamOrigin, productionApi } from '../../tools/dev-api-proxy.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function fixture(t, options = {}) {
  const seen = [];
  const sockets = new Set();
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    seen.push({ url: req.url, method: req.method, headers: req.headers, body });
    if (req.url.endsWith('/hang')) return;
    if (req.url.endsWith('/broken')) { res.writeHead(200); res.write('partial'); setImmediate(() => res.destroy()); return; }
    if (req.url.endsWith('/auth/session')) {
      res.setHeader('set-cookie', [
        'access_token=fixture-access; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=600',
        'refresh_token=fixture-refresh; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Strict; Max-Age=600',
      ]);
    }
    if (req.url.endsWith('/auth/logout')) res.setHeader('set-cookie', [
      'access_token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
      'refresh_token=; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
    ]);
    res.statusCode = req.url.includes('denied') ? 401 : 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ path: req.url, method: req.method, cookie: req.headers.cookie ?? '', origin: req.headers.origin, body: body.toString('base64') }));
  });
  upstream.on('upgrade', (req, socket) => {
    seen.push({ url: req.url, headers: req.headers });
    if (req.url.includes('hang')) return;
    if (req.url.includes('denied')) { socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 6\r\n\r\ndenied'); return; }
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    const payload = Buffer.from(req.headers.cookie ?? 'no-cookie');
    socket.write(Buffer.concat([Buffer.from(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`), Buffer.from([0x81, payload.length]), payload]));
    socket.on('data', data => {
      // The controlled browser sends small masked text/close frames.
      if ((data[0] & 15) === 8) { socket.end(Buffer.from([0x88, 0])); return; }
      const length = data[1] & 127;
      const decoded = Buffer.from(data.subarray(6, 6 + length));
      for (let i = 0; i < decoded.length; i++) decoded[i] ^= data[2 + i % 4];
      socket.write(Buffer.concat([Buffer.from([0x81, decoded.length]), decoded]));
    });
  });
  const upstreamPort = await listen(upstream);
  const frontend = http.createServer();
  const proxy = createDevProxy({ upstream: `http://127.0.0.1:${upstreamPort}`, port: () => frontend.address().port,
    handleNext: (req, res) => { res.setHeader('content-type', 'text/html'); res.end('<h1>Frontend fixture</h1>'); },
    upgradeNext: (_req, socket) => socket.end('HTTP/1.1 418 Next Upgrade Fixture\r\nConnection: close\r\n\r\n'),
    ...options,
  });
  frontend.on('request', proxy.request);
  frontend.on('upgrade', proxy.upgrade);
  for (const server of [frontend, upstream]) server.on('connection', socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
  });
  const port = await listen(frontend);
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all([frontend, upstream].map(server => new Promise(resolve => server.close(resolve))));
  });
  return { frontend, upstream, seen, port, origin: `http://localhost:${port}` };
}

function request(f, path, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: f.port, path, method,
      headers: { host: `localhost:${f.port}`, ...(body.length ? { "transfer-encoding": "chunked" } : {}), ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end(body);
  });
}

test('upstream validation and generated destination matrix', () => {
  assert.equal(upstreamOrigin(), productionApi);
  for (const value of ['http://127.0.0.1:8080', 'http://localhost:8080', 'http://[::1]:8080', 'https://api.example.test']) assert.equal(upstreamOrigin(value), value);
  for (const value of ['file:///etc/passwd', 'http://remote.test', 'https://user:pass@remote.test', 'https://remote.test/api', 'https://remote.test/?x=1', 'https://remote.test/#x', 'garbage']) assert.throws(() => upstreamOrigin(value));
});

test('request-response-fidelity and explicit-local-override', async t => {
  const f = await fixture(t);
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const result = await request(f, '/api/v1/echo?a=%2F&b=2', { method, headers: { origin: f.origin, 'content-type': 'application/octet-stream', 'x-forwarded-host': 'hostile.test', forwarded: 'host=hostile.test' }, body: method === 'GET' ? '' : Buffer.from([0, 255, 10]) });
    assert.equal(result.status, 200, method + ": " + result.body);
    const echoed = JSON.parse(result.body);
    assert.equal(echoed.path, '/api/v1/echo?a=%2F&b=2');
    assert.equal(echoed.method, method);
    assert.equal(echoed.origin, f.origin);
    assert.equal(echoed.body, method === 'GET' ? '' : 'AP8K');
    assert.equal(f.seen.at(-1).headers.forwarded, undefined);
    assert.equal(f.seen.at(-1).headers['x-forwarded-host'], undefined);
  }
  const denied = await request(f, '/api/v1/denied');
  assert.equal(denied.status, 401);
  const cookies = (await request(f, '/api/v1/auth/session', { method: 'POST', headers: { origin: f.origin } })).headers['set-cookie'];
  assert.ok(Array.isArray(cookies), 'Upstream session cookies must be preserved');
  assert.equal(cookies.length, 2);
  const page = await request(f, '/api/push/status');
  assert.equal(page.body, '<h1>Frontend fixture</h1>');
  assert.equal(f.seen.some(req => req.url === '/api/push/status'), false);
});

test('no-open-proxy: generated hostile paths, hosts, origins and connection tokens', async t => {
  const f = await fixture(t);
  for (const path of ['http://hostile.test/api/v1/x', '//hostile.test/api/v1/x', '/api/v1/../private', '/api/v1/%2e%2e/private', '/api/v1/%252e%252e/private', '/api/v1/%5cprivate', '/api/v1/%GG', '/api/v1//private']) {
    assert.equal((await request(f, path)).status, 403, path);
  }
  for (const headers of [{ host: 'hostile.test' }, { origin: 'https://hostile.test' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }, { connection: 'Origin', origin: f.origin }]) {
    assert.equal((await request(f, '/api/v1/auth/me', { headers })).status, 403);
  }
  assert.equal((await request(f, '/api/v1/auth/session', { method: 'POST' })).status, 403);
  assert.equal(f.seen.length, 0);
});

test('upstream-failure is bounded and never falls back', async t => {
  const f = await fixture(t, { timeoutMs: 80 });
  const hung = await request(f, '/api/v1/hang');
  assert.equal(hung.status, 502);
  assert.match(hung.body, /upstream unavailable/);
  await assert.rejects(request(f, '/api/v1/broken'));
  await new Promise(resolve => f.upstream.close(resolve));
  assert.equal((await request(f, '/api/v1/auth/me')).status, 502);
});

async function rawUpgrade(f, path, origin = f.origin) {
  const socket = net.connect(f.port, '127.0.0.1');
  await once(socket, 'connect');
  socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost:${f.port}\r\nOrigin: ${origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  const chunks = [];
  for await (const chunk of socket) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

test('websocket errors and Next HMR dispatch', async t => {
  const f = await fixture(t, { timeoutMs: 80 });
  assert.match(await rawUpgrade(f, '/_next/webpack-hmr'), /^HTTP\/1.1 418/);
  assert.match(await rawUpgrade(f, '/api/v1/denied'), /^HTTP\/1.1 401[\s\S]*denied$/);
  assert.match(await rawUpgrade(f, '/api/v1/hang'), /^HTTP\/1.1 502/);
  assert.match(await rawUpgrade(f, '/api/v1/stream', 'https://hostile.test'), /^HTTP\/1.1 403/);
});

test('session-cookie-roundtrip: real browser refresh, websocket frames, path scoping and logout', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(f.origin);
  const results = await page.evaluate(async () => {
    await fetch('/api/v1/auth/session', { method: 'POST' });
    const me = await (await fetch('/api/v1/auth/me')).json();
    const refresh = await (await fetch('/api/v1/auth/refresh', { method: 'POST' })).json();
    const elsewhere = await (await fetch('/api/v1/settings')).json();
    const messages = await new Promise((resolve, reject) => {
      const values = [];
      const ws = new WebSocket(location.origin.replace('http:', 'ws:') + '/api/v1/stream?symbol=EURUSD');
      ws.onerror = () => reject(new Error('WebSocket failed'));
      ws.onopen = () => ws.send('roundtrip');
      ws.onmessage = event => { values.push(event.data); if (values.length === 2) ws.close(); };
      ws.onclose = () => resolve(values);
    });
    const visibleCookie = document.cookie;
    await fetch('/api/v1/auth/logout', { method: 'POST' });
    const after = await (await fetch('/api/v1/auth/me')).json();
    return { me, refresh, elsewhere, messages, visibleCookie, after };
  });
  assert.match(results.me.cookie, /access_token=fixture-access/);
  assert.match(results.refresh.cookie, /refresh_token=fixture-refresh/);
  assert.equal(results.elsewhere.cookie, 'access_token=fixture-access');
  assert.deepEqual(results.messages, ['access_token=fixture-access', 'roundtrip']);
  assert.equal(results.visibleCookie, '');
  assert.equal(results.after.cookie, '');
  assert.equal(f.seen.find(req => req.url.includes('/stream?')).headers.origin, f.origin);
  assert.equal((await context.cookies()).length, 0);
});
