import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import next from 'next';
import nextEnv from '@next/env';
import { createDevProxy, upstreamOrigin } from './dev-api-proxy.mjs';

if (process.env.NODE_ENV === 'production') throw new Error('Use npm start for production');
process.env.NODE_ENV = 'development';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(dir, true);
// Load the documented root env fallback before resolving the development target.
await import('../next.config.mjs');
const upstream = upstreamOrigin(process.env.DEV_API_UPSTREAM || undefined);
process.env.NEXT_PUBLIC_API_BASE_URL = upstream;
process.env.NEXT_PUBLIC_DEV_API_PROXY = 'true';

const args = process.argv.slice(2);
let port = Number(process.env.PORT || 3000);
for (let i = 0; i < args.length; i++) {
  if (['--port', '-p'].includes(args[i])) port = Number(args[++i]);
  else if (['--hostname', '-H'].includes(args[i])) {
    if (!['127.0.0.1', 'localhost'].includes(args[++i])) throw new Error('Development server must bind to loopback');
  } else throw new Error(`Unsupported development option: ${args[i]}`);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid development port');

// Next registers its HMR handler on this server. The public server dispatches
// only non-backend upgrades to it, so Next cannot consume backend WebSockets.
const nextServer = http.createServer();
const app = next({ dev: true, dir, hostname: 'localhost', port, httpServer: nextServer });
await app.prepare();
const nextHandler = app.getRequestHandler();
const proxy = createDevProxy({ upstream, port,
  handleNext: (req, res) => { void nextHandler(req, res).catch(() => { res.statusCode = 500; res.end('Frontend request failed'); }); },
  upgradeNext: (req, socket, head) => {
    if (!nextServer.emit('upgrade', req, socket, head)) socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');
  },
});
const server = http.createServer(proxy.request);
server.on('upgrade', proxy.upgrade);
server.on('error', () => { console.error('Cannot listen on development port'); process.exit(1); });
server.listen(port, '127.0.0.1', () => {
  console.log(`Frontend: http://localhost:${port} | API upstream: ${upstream}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close();
  void app.close().finally(() => process.exit(0));
});
