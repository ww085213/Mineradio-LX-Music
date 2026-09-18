'use strict';

const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const Module = require('module');
const { app, channel } = require('bridge');

// NodeMobile's Web Fetch API is present on some iOS runtimes but is not
// reliable for every external music endpoint. Use the small HTTP/HTTPS
// implementation below for all mobile API calls so search, source resolution
// and the media proxy share the same predictable network path.
const useMobileHttpFallback = true; // this entry point is only bundled into the mobile runtime
if (useMobileHttpFallback || typeof globalThis.fetch !== 'function') {
  const zlib = require('zlib');
  let ReadableStreamCtor = null;
  try { ReadableStreamCtor = require('stream/web').ReadableStream; } catch (_error) {}
  function headerValue(headers, name) {
    const key = String(name || '').toLowerCase();
    for (const [entryKey, entryValue] of Object.entries(headers || {})) {
      if (entryKey.toLowerCase() === key) return Array.isArray(entryValue) ? entryValue.join(', ') : String(entryValue || '');
    }
    return null;
  }
  function decodeBody(buffer, encoding) {
    const value = String(encoding || '').toLowerCase();
    try {
      if (value.includes('br')) return zlib.brotliDecompressSync(buffer);
      if (value.includes('gzip')) return zlib.gunzipSync(buffer);
      if (value.includes('deflate')) return zlib.inflateSync(buffer);
    } catch (_error) {}
    return buffer;
  }
  function mobileFetch(input, options = {}, redirectCount = 0) {
    const target = new URL(typeof input === 'string' ? input : String(input && input.url || input));
    if (!/^https?:$/.test(target.protocol)) return Promise.reject(new Error('Unsupported URL protocol'));
    if (redirectCount > 5) return Promise.reject(new Error('Too many redirects'));
    const transport = target.protocol === 'https:' ? https : http;
    const headers = { ...(options.headers || {}) };
    if (!headerValue(headers, 'accept-encoding')) headers['accept-encoding'] = 'identity';
    const method = String(options.method || 'GET').toUpperCase();
    let requestBody = options.body;
    if (requestBody instanceof URLSearchParams) requestBody = requestBody.toString();
    if (requestBody != null && !Buffer.isBuffer(requestBody) && typeof requestBody !== 'string') requestBody = JSON.stringify(requestBody);
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = error => { if (!settled) { settled = true; reject(error); } };
      const req = transport.request(target, { method, headers }, response => {
        const status = Number(response.statusCode || 0);
        const location = response.headers && response.headers.location;
        if (location && [301, 302, 303, 307, 308].includes(status)) {
          response.resume();
          mobileFetch(new URL(location, target).href, { ...options, method: status === 303 ? 'GET' : method }, redirectCount + 1).then(resolve, reject);
          return;
        }
        const chunks = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('error', fail);
        response.on('end', () => {
          if (settled) return;
          settled = true;
          const body = decodeBody(Buffer.concat(chunks), response.headers && response.headers['content-encoding']);
          const responseHeaders = { get(name) { return headerValue(response.headers, name); } };
          let stream = null;
          if (ReadableStreamCtor) stream = new ReadableStreamCtor({ start(controller) { controller.enqueue(new Uint8Array(body)); controller.close(); } });
          resolve({ ok: status >= 200 && status < 300, status, url: target.href, headers: responseHeaders, body: stream || body,
            async arrayBuffer() { return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength); },
            async text() { return body.toString('utf8'); }, async json() { return JSON.parse(body.toString('utf8')); } });
        });
      });
      req.on('error', fail);
      if (options.signal) {
        if (options.signal.aborted) { req.destroy(); fail(new Error('This operation was aborted')); return; }
        options.signal.addEventListener('abort', () => { req.destroy(); fail(new Error('This operation was aborted')); }, { once: true });
      }
      if (requestBody != null && method !== 'GET' && method !== 'HEAD') req.write(requestBody);
      req.end();
    });
  }
  globalThis.fetch = mobileFetch;
}

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
process.env.MINERADIO_MOBILE = '1';
process.env.MINERADIO_MOBILE_DATA_DIR = dataDir;
process.env.MINERADIO_AGENT_CONFIG_DIR = path.join(dataDir, 'Mineradio');

// Only ciphertext is persisted by agent-api.js. The encryption key lives in
// iOS Keychain; requests cross the private Capacitor/Node message channel.
if (typeof channel.on === 'function') {
  const pendingSecrets = new Map();
  channel.on('mineradio-secure-response', value => {
    const pending = value && pendingSecrets.get(value.id);
    if (!pending) return;
    pendingSecrets.delete(value.id);
    clearTimeout(pending.timer);
    if (value.error) pending.reject(new Error('IOS_KEYCHAIN_UNAVAILABLE'));
    else pending.resolve(value.result);
  });
  function secureRequest(action, value) {
    return new Promise((resolve, reject) => {
      const id = require('crypto').randomBytes(16).toString('hex');
      const timer = setTimeout(() => { pendingSecrets.delete(id); reject(new Error('IOS_KEYCHAIN_TIMEOUT')); }, 10000);
      pendingSecrets.set(id, { resolve, reject, timer });
      channel.post('mineradio-secure-request', { id, action, value });
    });
  }
  globalThis.mineradioSecureStorage = {
    isEncryptionAvailable: () => true,
    isAsyncEncryptionAvailable: async () => true,
    async encryptStringAsync(value) { return Buffer.from(await secureRequest('encrypt', value), 'base64'); },
    async decryptStringAsync(value) { return { result: await secureRequest('decrypt', Buffer.from(value).toString('base64')) }; }
  };
}

function reportRuntimeFailure(reason) {
  const message = reason && (reason.stack || reason.message) || String(reason);
  try { fs.writeFileSync(path.join(dataDir, 'mineradio-node-runtime.log'), message, 'utf8'); } catch (_writeError) {}
  try { channel.post('mineradio-node-status', { state: 'failed', message }); } catch (_postError) {}
}

// Keep an asynchronous backend error from terminating the embedded Node
// runtime. The UI can remain open and display the diagnostic instead.
process.on('uncaughtException', reportRuntimeFailure);
process.on('unhandledRejection', reportRuntimeFailure);

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
