'use strict';

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PUBLIC_HOST = '0.0.0.0';
const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INTERNAL_PORT = 3100;
const INTERNAL_REMOTE_PORT = 3101;
const CLOUD_TOKEN = String(process.env.MINERADIO_CLOUD_TOKEN || '').trim();
const APP_ROOT = process.env.MINERADIO_APP_ROOT
  ? path.resolve(process.env.MINERADIO_APP_ROOT)
  : path.resolve(__dirname, '..');

if (!CLOUD_TOKEN || CLOUD_TOKEN.length < 24) {
  console.error('[Mineradio Cloud] MINERADIO_CLOUD_TOKEN must contain at least 24 characters.');
  process.exit(1);
}

const routePrefix = '/t/' + encodeURIComponent(CLOUD_TOKEN);
const child = spawn(process.execPath, ['server.js'], {
  cwd: APP_ROOT,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(INTERNAL_PORT),
    MINERADIO_REMOTE_PORT: String(INTERNAL_REMOTE_PORT),
    MINERADIO_BEAT_CACHE_DIR: process.env.MINERADIO_BEAT_CACHE_DIR || '/data/beatmaps',
    MINERADIO_WALLPAPER_CACHE_DIR: process.env.MINERADIO_WALLPAPER_CACHE_DIR || '/data/wallpapers',
    MINERADIO_UPDATE_DIR: process.env.MINERADIO_UPDATE_DIR || '/data/updates'
  },
  stdio: ['ignore', 'inherit', 'inherit']
});

child.on('exit', (code, signal) => {
  console.error('[Mineradio Cloud] backend exited', { code, signal });
  process.exit(code || 1);
});

function corsHeaders(origin) {
  const allowed = origin === 'https://localhost' || origin === 'capacitor://localhost';
  if (!allowed) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range, X-Requested-With',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, Content-Type',
    'Vary': 'Origin'
  };
}

function checkBackend(callback) {
  const request = http.get({ host: '127.0.0.1', port: INTERNAL_PORT, path: '/', timeout: 2500 }, response => {
    response.resume();
    callback(response.statusCode >= 200 && response.statusCode < 500);
  });
  request.on('timeout', () => request.destroy(new Error('timeout')));
  request.on('error', () => callback(false));
}

const server = http.createServer((req, res) => {
  const origin = String(req.headers.origin || '');
  const cors = corsHeaders(origin);

  if (req.url === '/health') {
    checkBackend(ok => {
      res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8', ...cors });
      res.end(JSON.stringify({ ok, service: 'mineradio-cloud' }));
    });
    return;
  }

  const rawUrl = String(req.url || '/');
  if (rawUrl !== routePrefix && !rawUrl.startsWith(routePrefix + '/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...cors });
    res.end('Not found');
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const upstreamPath = rawUrl.slice(routePrefix.length) || '/';
  const headers = { ...req.headers, host: `127.0.0.1:${INTERNAL_PORT}` };
  delete headers.origin;

  const upstream = http.request({
    host: '127.0.0.1',
    port: INTERNAL_PORT,
    method: req.method,
    path: upstreamPath,
    headers
  }, upstreamResponse => {
    const responseHeaders = { ...upstreamResponse.headers, ...cors };
    delete responseHeaders['content-security-policy'];
    res.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(res);
  });

  upstream.on('error', error => {
    if (res.headersSent) return res.destroy(error);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', ...cors });
    res.end(JSON.stringify({ ok: false, error: 'BACKEND_UNAVAILABLE' }));
  });

  req.pipe(upstream);
});

server.listen(PUBLIC_PORT, PUBLIC_HOST, () => {
  console.log(`[Mineradio Cloud] listening on ${PUBLIC_HOST}:${PUBLIC_PORT}`);
  console.log('[Mineradio Cloud] protected route enabled');
});

function shutdown(signal) {
  console.log('[Mineradio Cloud] shutting down', signal);
  server.close(() => {
    if (!child.killed) child.kill('SIGTERM');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
