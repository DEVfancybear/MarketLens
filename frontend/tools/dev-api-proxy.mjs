import http from 'node:http';
import https from 'node:https';

export const productionApi = 'https://api.tradingterminal.io.vn';

export function upstreamOrigin(value = productionApi) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash ||
      (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('DEV_API_UPSTREAM must be an HTTPS origin or an HTTP loopback origin');
  }
  return url.origin;
}

const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade'];

function headersFor(headers, upgrade = false) {
  const excluded = new Set([...hopHeaders, ...(headers.connection ?? '').toLowerCase().split(',').map(v => v.trim())]);
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!excluded.has(name) && name !== 'forwarded' && !name.startsWith('x-forwarded-')) result[name] = value;
  }
  if (upgrade) Object.assign(result, { connection: 'Upgrade', upgrade: 'websocket' });
  return result;
}

export function isApiPath(raw) {
  return typeof raw === 'string' && raw.startsWith('/api/v1/');
}

function validRequest(req, port, upgrade) {
  const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (!hosts.includes(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) return false;
  if (!origin && (upgrade || !['GET', 'HEAD', 'OPTIONS'].includes(req.method))) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const nominated = (req.headers.connection ?? '').toLowerCase().split(',').map(v => v.trim());
  if (nominated.some(v => ['origin', 'cookie', 'authorization', 'host'].includes(v))) return false;
  // Reject ambiguous paths before either server can normalize them outside the API namespace.
  const path = req.url.split('?')[0];
  try {
    const decoded = decodeURIComponent(path);
    if (decoded.includes('\\') || decoded.includes('%') || decoded.includes('//') ||
        decoded.split('/').some(v => v === '.' || v === '..')) return false;
  } catch { return false; }
  return path.startsWith('/') && !path.startsWith('//');
}

function rawHeaders(status, headers) {
  const lines = [`HTTP/1.1 ${status}`];
  for (const [name, values] of Object.entries(headers)) {
    for (const value of Array.isArray(values) ? values : [values]) lines.push(`${name}: ${value}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

export function createDevProxy({ upstream = productionApi, port, handleNext, upgradeNext, timeoutMs = 30000 }) {
  const target = new URL(upstreamOrigin(upstream));
  const transport = target.protocol === 'https:' ? https : http;
  const allowed = (req, upgrade) => validRequest(req, typeof port === 'function' ? port() : port, upgrade);
  const requestOptions = req => ({
    protocol: target.protocol, hostname: target.hostname.replace(/^\[|\]$/g, ''), port: target.port,
    method: req.method, path: req.url,
    headers: { ...headersFor(req.headers), host: target.host,
      ...(req.headers['transfer-encoding'] ? { 'transfer-encoding': 'chunked' } : {}),
    },
  });

  function request(req, res) {
    if (!allowed(req, false)) { res.writeHead(403); res.end('Development origin or path rejected'); return; }
    if (!isApiPath(req.url)) { handleNext(req, res); return; }
    const outgoing = transport.request(requestOptions(req));
    const timer = setTimeout(() => outgoing.destroy(new Error('Upstream timeout')), timeoutMs);
    const fail = () => {
      clearTimeout(timer);
      if (res.headersSent) res.destroy();
      else { res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end('{"error":"Production API upstream unavailable"}'); }
    };
    outgoing.on('error', fail);
    outgoing.on('response', incoming => {
      res.writeHead(incoming.statusCode, headersFor(incoming.headers));
      incoming.on('error', fail);
      incoming.on('end', () => clearTimeout(timer));
      incoming.pipe(res);
    });
    res.on('close', () => { clearTimeout(timer); outgoing.destroy(); });
    req.on('error', () => outgoing.destroy());
    req.pipe(outgoing);
  }

  function upgrade(req, socket, head) {
    if (!allowed(req, true)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    if (!isApiPath(req.url)) { upgradeNext(req, socket, head); return; }
    const options = requestOptions(req);
    options.headers = { ...headersFor(req.headers, true), host: target.host };
    const outgoing = transport.request(options);
    const timer = setTimeout(() => outgoing.destroy(new Error('Upgrade timeout')), timeoutMs);
    outgoing.on('error', () => { clearTimeout(timer); socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); });
    socket.on('error', () => outgoing.destroy());
    socket.on('close', () => { clearTimeout(timer); outgoing.destroy(); });
    outgoing.on('response', incoming => {
      clearTimeout(timer);
      socket.write(rawHeaders(incoming.statusCode, { ...headersFor(incoming.headers), connection: 'close' }));
      incoming.on('error', () => socket.destroy());
      incoming.pipe(socket);
    });
    outgoing.on('upgrade', (incoming, upstreamSocket, upstreamHead) => {
      clearTimeout(timer);
      socket.write(rawHeaders(101, headersFor(incoming.headers, true)));
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      upstreamSocket.on('error', () => socket.destroy());
      socket.on('error', () => upstreamSocket.destroy());
      socket.on('close', () => upstreamSocket.destroy());
      upstreamSocket.on('close', () => socket.destroy());
      socket.pipe(upstreamSocket).pipe(socket);
    });
    outgoing.end();
  }
  return { request, upgrade };
}
