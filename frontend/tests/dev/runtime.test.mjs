import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { chromium } from '@playwright/test';

test('launcher refuses production mode and invalid configuration', () => {
  for (const [env, args] of [
    [{ NODE_ENV: 'production' }, []],
    [{ DEV_API_UPSTREAM: 'https://user:secret@invalid.test' }, []],
    [{}, ['--port', '0']],
    [{}, ['--hostname', '0.0.0.0']],
    [{}, ['--unsupported']],
  ]) {
    const result = spawnSync(process.execPath, ['tools/dev-server.mjs', ...args], {
      env: { ...process.env, NODE_ENV: 'development', ...env }, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /user:secret/);
  }
});

test('real Next page, frontend route, API forwarding and HMR websocket', { timeout: 180000 }, async t => {
  const upstream = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/v1/probe') res.end('{"source":"controlled-upstream"}');
    else { res.statusCode = 401; res.end('{"error":"unauthenticated"}'); }
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const reservation = http.createServer();
  reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['tools/dev-server.mjs', '--hostname', '127.0.0.1', '--port', String(port)], {
    env: { ...process.env, NODE_ENV: 'development', DEV_API_UPSTREAM: `http://127.0.0.1:${upstream.address().port}`, DISABLE_PUSH_WORKER: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null) child.kill(); await exited; });
  let output = '';
  const ready = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => reject(new Error(`Dev server exited ${code}: ${output}`)));
    const collect = chunk => { output += chunk; if (output.includes(`Frontend: http://localhost:${port}`)) resolve(); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
  });
  await ready;
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const hmr = page.waitForEvent('websocket', { predicate: ws => ws.url().includes('/_next/'), timeout: 90000 })
    .then(async socket => { await socket.waitForEvent('framereceived'); return socket; });
  const response = await page.goto(`http://localhost:${port}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  assert.equal(response.status(), 200);
  const socket = await hmr;
  assert.match(socket.url(), /^ws:\/\/localhost:/);
  const api = await page.evaluate(async () => (await fetch('/api/v1/probe')).json());
  assert.deepEqual(api, { source: 'controlled-upstream' });
  const icon = await page.request.get(`http://localhost:${port}/favicon.ico`);
  assert.equal(icon.status(), 200);
  assert.match(icon.headers()['content-type'], /image/);
  await page.close();
});
