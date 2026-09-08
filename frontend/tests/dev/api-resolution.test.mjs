import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function client(env, origin) {
  const calls = [];
  const source = readFileSync(new URL('../../src/services/api/client.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const exports = {};
  const ky = { create: () => ({ get: (url) => ({ json: async () => { calls.push(url); return {}; } }) }) };
  const context = { exports, process: { env }, URL, require: (name) => name === 'ky' ? { __esModule: true, default: ky } : {} };
  if (origin) context.window = { location: new URL(origin) };
  vm.runInNewContext(outputText, context);
  return { ...exports, calls };
}

test('dev-default-production: browser uses frontend HTTP and websocket origin', async () => {
  const api = client({ NODE_ENV: 'development', NEXT_PUBLIC_DEV_API_PROXY: 'true', NEXT_PUBLIC_API_BASE_URL: 'https://api.tradingterminal.io.vn' }, 'http://localhost:3000');
  await api.getJson('auth/me');
  assert.deepEqual(api.calls, ['http://localhost:3000/api/v1/auth/me']);
  assert.equal(api.apiWebSocketUrl('mt5/stream?symbols=EURUSD'), 'ws://localhost:3000/api/v1/mt5/stream?symbols=EURUSD');
  assert.equal(api.isBackendApiConfigured(), true);
});

test('dev server-side calls use explicit upstream', async () => {
  const api = client({ NODE_ENV: 'development', NEXT_PUBLIC_DEV_API_PROXY: 'true', NEXT_PUBLIC_API_BASE_URL: 'https://api.tradingterminal.io.vn' });
  await api.getJson('auth/me');
  assert.deepEqual(api.calls, ['https://api.tradingterminal.io.vn/api/v1/auth/me']);
});

test('production-unchanged: proxy flag cannot activate in production', () => {
  const api = client({ NODE_ENV: 'production', NEXT_PUBLIC_DEV_API_PROXY: 'true', NEXT_PUBLIC_API_BASE_URL: 'https://api.tradingterminal.io.vn' }, 'https://tradingterminal.io.vn');
  assert.equal(api.apiWebSocketUrl('mt5/stream'), 'wss://api.tradingterminal.io.vn/api/v1/mt5/stream');
});
