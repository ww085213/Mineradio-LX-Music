'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
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

process.env.PORT = '3000';
process.env.HOST = '127.0.0.1';
process.env.MINERADIO_REMOTE_PORT = '3001';
process.env.MINERADIO_BEAT_CACHE_DIR = path.join(cacheDir, 'beatmaps');
process.env.MINERADIO_WALLPAPER_CACHE_DIR = path.join(cacheDir, 'wallpapers');
process.env.MINERADIO_UPDATE_DIR = path.join(cacheDir, 'updates');
process.env.LOCALAPPDATA = dataDir;

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
  require('./server');
  channel.post('mineradio-node-status', { state: 'listening', port: 3000 });
} catch (error) {
  channel.post('mineradio-node-status', {
    state: 'failed',
    message: error && (error.stack || error.message) || String(error),
  });
  throw error;
}

app.on('pause', pauseLock => pauseLock.release());
app.on('resume', () => {});
