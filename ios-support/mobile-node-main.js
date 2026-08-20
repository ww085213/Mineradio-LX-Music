'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const Module = require('module');
const { app, channel } = require('bridge');

const dataDir = app.datadir();
const cacheDir = path.join(dataDir, 'cache');
for (const dir of [
  dataDir,
  cacheDir,
  path.join(cacheDir, 'beatmaps'),
  path.join(cacheDir, 'wallpapers'),
  path.join(cacheDir, 'updates'),
]) {
  fs.mkdirSync(dir, { recursive: true });
}

process.env.PORT = process.env.MINERADIO_MOBILE_PORT || '3000';
process.env.HOST = '127.0.0.1';
process.env.MINERADIO_REMOTE_PORT = process.env.MINERADIO_MOBILE_REMOTE_PORT || '3001';
process.env.MINERADIO_BEAT_CACHE_DIR = path.join(cacheDir, 'beatmaps');
process.env.MINERADIO_WALLPAPER_CACHE_DIR = path.join(cacheDir, 'wallpapers');
process.env.MINERADIO_UPDATE_DIR = path.join(cacheDir, 'updates');
process.env.LOCALAPPDATA = dataDir;

// Node.js for Mobile does not implement child_process. The desktop backend
// imports it at module load time, although those Windows-only features are not
// used by the iOS UI. Supply a narrow shim so the local music/search server can
// boot while unsupported desktop actions fail only if they are actually used.
const originalModuleLoad = Module._load;
function unsupportedChildProcess() {
  const error = new Error('child_process is not available in Mineradio for iOS');
  error.code = 'ERR_IOS_UNSUPPORTED_CHILD_PROCESS';
  throw error;
}
const childProcessShim = {
  exec: unsupportedChildProcess,
  execFile: unsupportedChildProcess,
  execFileSync: unsupportedChildProcess,
  execSync: unsupportedChildProcess,
  fork: unsupportedChildProcess,
  spawn: unsupportedChildProcess,
  spawnSync: unsupportedChildProcess,
};
Module._load = function mobileModuleLoad(request, parent, isMain) {
  if (request === 'child_process' || request === 'node:child_process') return childProcessShim;
  return originalModuleLoad.call(this, request, parent, isMain);
};

// The bundled UI is served by Capacitor while the API and media proxy run on
// loopback. Add CORS once at the Node HTTP boundary and hide the cross-origin
// headers from the desktop-only local-request guard in server.js.
const createServer = http.createServer;
http.createServer = function mobileCreateServer(listener) {
  if (typeof listener !== 'function') return createServer.apply(this, arguments);
  const wrapped = function mobileRequestListener(req, res) {
    const origin = String(req.headers.origin || '');
    const allowedOrigin = /^(?:capacitor|https?):\/\/localhost(?::\d+)?$/i.test(origin);
    if (allowedOrigin) {
      const setHeader = res.setHeader.bind(res);
      res.setHeader = function mobileSetHeader(name, value) {
        if (String(name).toLowerCase() === 'cross-origin-resource-policy') value = 'cross-origin';
        return setHeader(name, value);
      };
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization, Accept');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
      res.setHeader('Vary', 'Origin');
      delete req.headers.origin;
      req.headers['sec-fetch-site'] = 'same-origin';
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    return listener(req, res);
  };
  return createServer.call(this, wrapped);
};

channel.post('mineradio-node-status', { state: 'starting', dataDir });

try {
  require(process.env.MINERADIO_MOBILE_SERVER_ENTRY || './server');
  channel.post('mineradio-node-status', { state: 'listening', port: 3000 });
} catch (error) {
  const message = error && (error.stack || error.message) || String(error);
  try {
    fs.writeFileSync(path.join(dataDir, 'mineradio-node-startup.log'), message, 'utf8');
  } catch (_writeError) {}
  channel.post('mineradio-node-status', {
    state: 'failed',
    message,
  });
  // Never rethrow here. An unsupported backend feature must not terminate the
  // embedded Node thread and take the whole iOS application down with it.
  console.error('[Mineradio iOS] Local engine failed to start:', message);
}

app.on('pause', pauseLock => pauseLock.release());
app.on('resume', () => {});
