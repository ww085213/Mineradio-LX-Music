'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const zlib = require('zlib');
let electronFetch = null;
try {
  const electronNet = require('electron').net;
  if (electronNet && typeof electronNet.fetch === 'function') electronFetch = electronNet.fetch.bind(electronNet);
} catch (_err) {}

const EVENT_NAMES = Object.freeze({
  request: 'request',
  inited: 'inited',
  updateAlert: 'updateAlert',
  showConfigView: 'showConfigView',
});

const APPDATA_DIR = process.env.APPDATA || '';
const LOCALAPPDATA_DIR = process.env.LOCALAPPDATA || '';
const LX_DATA_DIRS = [
  APPDATA_DIR && path.join(APPDATA_DIR, 'lx-music-desktop', 'LxDatas'),
  LOCALAPPDATA_DIR && path.join(LOCALAPPDATA_DIR, 'Programs', 'lx-music-desktop', 'portable', 'LxDatas'),
].filter(Boolean);
const MR_SOURCE_DIR = path.join(APPDATA_DIR || LOCALAPPDATA_DIR || process.cwd(), 'Mineradio', 'sources');
const MR_SOURCE_FILE = path.join(MR_SOURCE_DIR, 'active-source.json');
const MR_SOURCES_FILE = path.join(MR_SOURCE_DIR, 'sources.json');
const ALLOWED_SOURCES = new Set(['kw', 'kg', 'tx', 'wy', 'mg', 'xm', 'local']);
const ALLOWED_ACTIONS = new Set(['musicUrl', 'lyric', 'pic']);
const LX_HTTP_TIMEOUT_MS = 12000;
const LX_ACTION_TIMEOUT_MS = 14000;

function ignoreBrokenPipe(stream) {
  try {
    if (!stream || typeof stream.on !== 'function') return;
    stream.on('error', err => {
      if (err && err.code === 'EPIPE') return;
      throw err;
    });
  } catch (_err) {}
}

ignoreBrokenPipe(process.stdout);
ignoreBrokenPipe(process.stderr);

function safeConsoleMethod(method) {
  return (...args) => {
    try {
      const fn = console && typeof console[method] === 'function' ? console[method] : console.log;
      if (typeof fn === 'function') fn.apply(console, args);
    } catch (err) {
      if (err && err.code === 'EPIPE') return;
      throw err;
    }
  };
}

const safeSourceConsole = Object.freeze({
  log: safeConsoleMethod('log'),
  info: safeConsoleMethod('info'),
  warn: safeConsoleMethod('warn'),
  error: safeConsoleMethod('error'),
  debug: safeConsoleMethod('debug'),
  trace: safeConsoleMethod('trace'),
});

function withTimeout(promise, timeoutMs, code) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(code || 'LX_SOURCE_TIMEOUT')), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

let runtime = null;
let loading = null;
const fallbackRuntimeCache = new Map();

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonIfExists(file) {
  try {
    if (!file || !fs.existsSync(file)) return null;
    return readJson(file);
  } catch (_err) {
    return null;
  }
}

function backupBrokenJson(file) {
  try {
    if (!file || !fs.existsSync(file)) return;
    fs.renameSync(file, file + '.broken-' + Date.now());
  } catch (_err) {}
}

function lxDataFileCandidates(fileName) {
  return LX_DATA_DIRS.map(dir => path.join(dir, fileName));
}

function readFirstLxJson(fileName) {
  for (const file of lxDataFileCandidates(fileName)) {
    const value = readJsonIfExists(file);
    if (value != null) return value;
  }
  return null;
}

function saveMigratedSource(record) {
  if (!record || typeof record.script !== 'string' || !record.script.trim()) return;
  try {
    fs.mkdirSync(MR_SOURCE_DIR, { recursive: true });
    fs.writeFileSync(MR_SOURCE_FILE, JSON.stringify(record), 'utf8');
    const store = readSourceStore();
    if (!store.records.some(item => item.id === record.id || item.script === record.script)) {
      store.records.push(record);
    }
    store.activeId = record.id;
    writeSourceStore(store);
  } catch (_err) {}
}

function readSourceStore() {
  const saved = readJsonIfExists(MR_SOURCES_FILE);
  if (!saved && fs.existsSync(MR_SOURCES_FILE)) backupBrokenJson(MR_SOURCES_FILE);
  const records = Array.isArray(saved?.records)
    ? saved.records.filter(item => item && typeof item.script === 'string' && item.script.trim())
    : [];
  const legacy = readJsonIfExists(MR_SOURCE_FILE);
  if (legacy && typeof legacy.script === 'string' && legacy.script.trim() &&
      !records.some(item => item.id === legacy.id || item.script === legacy.script)) {
    records.push(legacy);
  }
  return { activeId: String(saved?.activeId || legacy?.id || ''), records };
}

function writeSourceStore(store) {
  fs.mkdirSync(MR_SOURCE_DIR, { recursive: true });
  fs.writeFileSync(MR_SOURCES_FILE, JSON.stringify({
    activeId: String(store?.activeId || ''),
    records: Array.isArray(store?.records) ? store.records : [],
  }), 'utf8');
}

function activeScriptRecord() {
  const store = readSourceStore();
  const imported = store.records.find(item => item.id === store.activeId) || store.records[0];
  if (imported && typeof imported.script === 'string' && imported.script.trim()) return imported;

  const saved = readFirstLxJson('user_api.json');
  const records = saved && (Array.isArray(saved) ? saved : saved.userApis);
  if (!Array.isArray(records) || !records.length) throw new Error('LX_SOURCE_NOT_CONFIGURED');

  let selectedId = '';
  const config = readFirstLxJson('config_v2.json');
  if (config) selectedId = String(config?.setting?.common?.apiSource || '');
  const selected = records.find(item => item && item.id === selectedId) ||
    records.slice().reverse().find(item => item && typeof item.script === 'string' && item.script.trim());
  if (!selected) throw new Error('LX_SOURCE_NOT_CONFIGURED');
  saveMigratedSource(selected);
  return selected;
}

function allScriptRecords() {
  const store = readSourceStore();
  const records = store.records.slice();
  const saved = readFirstLxJson('user_api.json');
  const userApis = saved && (Array.isArray(saved) ? saved : saved.userApis);
  if (Array.isArray(userApis)) records.push(...userApis.filter(item => item && typeof item.script === 'string'));
  const seen = new Set();
  return records.filter(record => {
    const fingerprint = crypto.createHash('sha1').update(record.script).digest('hex');
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

function decodeResponseBody(buffer, encoding) {
  return new Promise((resolve, reject) => {
    const done = (err, value) => err ? reject(err) : resolve(value);
    if (/\bgzip\b/i.test(encoding || '')) return zlib.gunzip(buffer, done);
    if (/\bdeflate\b/i.test(encoding || '')) return zlib.inflate(buffer, done);
    if (/\bbr\b/i.test(encoding || '') && zlib.brotliDecompress) return zlib.brotliDecompress(buffer, done);
    resolve(buffer);
  });
}

function encodeRequestData(options, headers) {
  if (options.body != null) {
    if (Buffer.isBuffer(options.body) || typeof options.body === 'string') return options.body;
    headers['content-type'] ||= 'application/json';
    return JSON.stringify(options.body);
  }
  if (options.form && typeof options.form === 'object') {
    headers['content-type'] ||= 'application/x-www-form-urlencoded';
    return new URLSearchParams(options.form).toString();
  }
  if (options.formData && typeof options.formData === 'object') {
    headers['content-type'] ||= 'application/json';
    return JSON.stringify(options.formData);
  }
  return null;
}


function sanitizeHeaderValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(sanitizeHeaderValue).join(', ');
  const text = String(value).replace(/[\r\n]+/g, ' ');
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 9 || (code >= 32 && code <= 255)) out += text[i];
    else out += encodeURIComponent(text[i]);
  }
  return out;
}

function sanitizeHeaders(headers) {
  const safe = {};
  for (const [rawKey, rawValue] of Object.entries(headers || {})) {
    const key = String(rawKey || '').trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)) continue;
    safe[key.toLowerCase()] = sanitizeHeaderValue(rawValue);
  }
  return safe;
}

function sourceUrlHttpFallback(sourceUrl, err) {
  try {
    const target = new URL(String(sourceUrl || '').trim());
    const message = String((err && (err.code || err.message)) || err || '');
    if (target.protocol === 'https:' && target.hostname === 'ynx.de5.net' && /CERT|SSL|TLS|COMMON_NAME|certificate/i.test(message)) {
      target.protocol = 'http:';
      return target.href;
    }
  } catch (_err) {}
  return '';
}


function normalizeCurrentScriptInfoName(name) {
  name = String(name || '');
  // 兼容部分玉宁熙脚本：注释里的 @name 带 -Pro，但脚本内部校验用的是 lx-玉宁熙。
  if (/玉宁熙/i.test(name)) return name.replace(/-?Pro$/i, '').trim() || 'lx-玉宁熙';
  return name;
}

function normalizeImportSourceUrl(input) {
  let text = String(input || '').trim();
  if (!text) throw new Error('LX_SOURCE_URL_INVALID');
  if (/^[a-f0-9]{64}$/i.test(text)) {
    text = 'http://ynx.de5.net/API/lx-ynx.php?APIKEY=' + text;
  } else if (/^ynx\.de5\.net\//i.test(text)) {
    text = 'http://' + text;
  }
  let target;
  try {
    target = new URL(text);
  } catch (_err) {
    throw new Error('LX_SOURCE_URL_INVALID');
  }
  if (!/^https?:$/.test(target.protocol)) throw new Error('LX_SOURCE_URL_INVALID');
  if (target.protocol === 'https:' && target.hostname === 'ynx.de5.net') {
    // 这个域名的 https 证书经常不匹配，直接走官方注释给的 http。
    target.protocol = 'http:';
  }
  return target.href;
}

function lxRequest(url, options, callback, redirectCount = 0) {
  options = options || {};
  let callbackDone = false;
  const done = (err, resp, body) => {
    if (callbackDone) return;
    callbackDone = true;
    callback(err, resp, body);
  };
  let target;
  try {
    target = new URL(String(url));
  } catch (err) {
    queueMicrotask(() => done(err));
    return () => {};
  }
  if (!/^https?:$/.test(target.protocol)) {
    queueMicrotask(() => done(new Error('Unsupported protocol')));
    return () => {};
  }
  let headers = sanitizeHeaders(Object.assign({
    'accept': '*/*',
    'accept-encoding': 'gzip, deflate, br',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Mineradio/LXSource',
  }, options.headers || {}));
  const body = encodeRequestData(options, headers);
  headers = sanitizeHeaders(headers);
  if (electronFetch) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(Math.max(Number(options.timeout) || 60000, 1000), 60000));
    electronFetch(target.href, {
      method: String(options.method || 'GET').toUpperCase(),
      headers,
      body: body == null ? undefined : body,
      redirect: 'follow',
      signal: controller.signal,
    }).then(async response => {
      const raw = Buffer.from(await response.arrayBuffer());
      const text = raw.toString('utf8');
      let parsed = text;
      try { parsed = JSON.parse(text); } catch (_err) {}
      const responseHeaders = {};
      response.headers.forEach((value, key) => { responseHeaders[key] = value; });
      callback(null, {
        statusCode: response.status,
        statusMessage: response.statusText,
        headers: responseHeaders,
        bytes: raw.length,
        raw,
        body: parsed,
      }, parsed);
    }).catch(err => callback(err)).finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }
  if (body != null && !Object.keys(headers).some(key => key.toLowerCase() === 'content-length')) {
    headers['content-length'] = Buffer.byteLength(body);
  }
  const transport = target.protocol === 'https:' ? https : http;
  const req = transport.request(target, {
    method: String(options.method || 'GET').toUpperCase(),
    headers,
    timeout: Math.min(Math.max(Number(options.timeout) || LX_HTTP_TIMEOUT_MS, 1000), 20000),
  }, res => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectCount < 5) {
      res.resume();
      return lxRequest(new URL(res.headers.location, target).href, options, callback, redirectCount + 1);
    }
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', async () => {
      try {
        const raw = await decodeResponseBody(Buffer.concat(chunks), res.headers['content-encoding']);
        const text = raw.toString('utf8');
        let parsed = text;
        try { parsed = JSON.parse(text); } catch (_err) {}
        const response = {
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          headers: res.headers,
          bytes: raw.length,
          raw,
          body: parsed,
        };
        done(null, response, parsed);
      } catch (err) {
        done(err);
      }
    });
  });
  req.on('error', err => callback(err));
  req.on('timeout', () => req.destroy(new Error('Request timeout')));
  if (body != null) req.write(body);
  req.end();
  return () => req.destroy();
}

function lxRequestCompat(url, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (typeof callback === 'function') {
    return lxRequest(url, options || {}, callback);
  }
  const promise = new Promise((resolve, reject) => {
    lxRequest(url, options || {}, (err, response, body) => {
      if (err) return reject(err);
      resolve({ ...response, body });
    });
  });
  return promise;
}

function cryptoUtils() {
  return {
    aesEncrypt(buffer, mode, key, iv) {
      const cipher = crypto.createCipheriv(mode, key, iv);
      return Buffer.concat([cipher.update(buffer), cipher.final()]);
    },
    rsaEncrypt(buffer, key) {
      buffer = Buffer.concat([Buffer.alloc(Math.max(0, 128 - buffer.length)), buffer]);
      return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, buffer);
    },
    randomBytes: size => crypto.randomBytes(size),
    md5: value => crypto.createHash('md5').update(value).digest('hex'),
    sha1: value => crypto.createHash('sha1').update(value).digest('hex'),
    sha256: value => crypto.createHash('sha256').update(value).digest('hex'),
    hmacSha1: (key, value) => crypto.createHmac('sha1', key).update(value).digest('hex'),
    hmacSha256: (key, value) => crypto.createHmac('sha256', key).update(value).digest('hex'),
  };
}

function normalizeSourceConfig(value) {
  if (!value || typeof value !== 'object') return value || {};
  const out = { ...value };
  const qualitys = out.qualitys || out.qualities || out.quality || out.types;
  if (Array.isArray(qualitys)) out.qualitys = qualitys.map(item => String(item || '')).filter(Boolean);
  else if (qualitys && typeof qualitys === 'object') out.qualitys = Object.keys(qualitys).filter(Boolean);
  return out;
}

async function createRuntime(recordOverride) {
  const record = recordOverride || activeScriptRecord();
  if (!record || typeof record.script !== 'string') throw new Error('LX_SOURCE_SCRIPT_INVALID');
  const script = record.script.startsWith('gz_')
    ? zlib.inflateSync(Buffer.from(record.script.substring(3), 'base64')).toString('utf8')
    : record.script;
  const state = { handler: null, info: null };
  let finishInit;
  let failInit;
  const initialized = new Promise((resolve, reject) => {
    finishInit = resolve;
    failInit = reject;
  });
  const lx = {
    EVENT_NAMES,
    request: lxRequestCompat,
    on(eventName, handler) {
      if (eventName === EVENT_NAMES.request && typeof handler === 'function') {
        state.handler = handler;
      }
      // Some third-party LX sources register optional events that Mineradio does
      // not need. Treat them as supported no-ops so import validation does not
      // fail before playback can use the request handler.
      return Promise.resolve();
    },
    send(eventName, data) {
      if (eventName === EVENT_NAMES.inited) {
        state.info = data || {};
        finishInit(state.info);
      }
      return Promise.resolve();
    },
    utils: {
      request: lxRequestCompat,
      fetch: lxRequestCompat,
      httpFetch: lxRequestCompat,
      crypto: cryptoUtils(),
      buffer: {
        from: (...args) => Buffer.from(...args),
        bufToString: (buf, format) => Buffer.from(buf, 'binary').toString(format),
      },
      zlib: {
        inflate: data => new Promise((resolve, reject) => zlib.inflate(data, (err, buf) => err ? reject(err) : resolve(buf))),
        deflate: data => new Promise((resolve, reject) => zlib.deflate(data, (err, buf) => err ? reject(err) : resolve(buf))),
      },
    },
    currentScriptInfo: {
      name: normalizeCurrentScriptInfoName(record.name || ''),
      description: record.description || '',
      version: record.version || '',
      author: record.author || '',
      homepage: record.homepage || '',
      rawScript: script,
    },
    version: '2.0.0',
    env: 'desktop',
  };
  const sandbox = {
    lx,
    console: safeSourceConsole,
    Buffer,
    process: { platform: process.platform, versions: process.versions, env: {} },
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    fetch: typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined,
    crypto: crypto.webcrypto,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    atob: value => Buffer.from(String(value), 'base64').toString('binary'),
    btoa: value => Buffer.from(String(value), 'binary').toString('base64'),
  };
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  try {
    vm.runInNewContext(script, sandbox, {
      filename: `lx-source-${record.id || 'active'}.js`,
      timeout: 5000,
      displayErrors: true,
    });
  } catch (err) {
    failInit(err);
    throw err;
  }
  await Promise.race([
    initialized,
    new Promise((_, reject) => setTimeout(() => reject(new Error('LX_SOURCE_INIT_TIMEOUT')), 10000)),
  ]);
  if (typeof state.handler !== 'function') throw new Error('LX_SOURCE_REQUEST_HANDLER_MISSING');
  const sources = {};
  for (const [key, value] of Object.entries(state.info.sources || {})) {
    if (ALLOWED_SOURCES.has(key)) sources[key] = normalizeSourceConfig(value);
  }
  return {
    id: record.id,
    name: record.name || 'LX source',
    version: record.version || '',
    sources,
    async request(source, action, info) {
      if (!ALLOWED_SOURCES.has(source) || !sources[source]) throw new Error('LX_SOURCE_UNSUPPORTED');
      if (!ALLOWED_ACTIONS.has(action)) throw new Error('LX_ACTION_UNSUPPORTED');
      return withTimeout(
        state.handler({ source, action, info }),
        LX_ACTION_TIMEOUT_MS,
        'LX_SOURCE_ACTION_TIMEOUT'
      );
    },
  };
}

async function getRuntime(forceReload = false) {
  if (forceReload) runtime = null;
  if (runtime) return runtime;
  if (!loading) {
    loading = createRuntime().then(value => {
      runtime = value;
      return value;
    }).finally(() => { loading = null; });
  }
  return loading;
}

function metadataFromScript(script, fallbackName) {
  const readTag = tag => {
    const match = script.match(new RegExp('@' + tag + '\\s+([^\\r\\n*]+)', 'i'));
    return match ? match[1].trim() : '';
  };
  return {
    id: `mineradio_${Date.now()}`,
    name: readTag('name') || String(fallbackName || 'MR 导入音源').replace(/\.js$/i, ''),
    description: readTag('description'),
    version: readTag('version') || 'unknown',
    author: readTag('author'),
    homepage: readTag('homepage'),
    script,
  };
}

async function importSource(script, fileName) {
  script = String(script || '').replace(/^\uFEFF/, '');
  if (!script.trim() || script.length > 5 * 1024 * 1024) throw new Error('LX_SOURCE_FILE_INVALID');
  const record = metadataFromScript(script, fileName);
  fs.mkdirSync(MR_SOURCE_DIR, { recursive: true });
  const previousStore = readSourceStore();
  const store = { activeId: record.id, records: previousStore.records.slice() };
  const duplicateIndex = store.records.findIndex(item => item.script === record.script);
  if (duplicateIndex >= 0) {
    record.id = store.records[duplicateIndex].id;
    store.records[duplicateIndex] = record;
  } else {
    store.records.push(record);
  }
  store.activeId = record.id;
  writeSourceStore(store);
  fs.writeFileSync(MR_SOURCE_FILE, JSON.stringify(record), 'utf8');
  try {
    const host = await getRuntime(true);
    return { ok: true, name: host.name, version: host.version, sources: host.sources, installed: listSources() };
  } catch (err) {
    writeSourceStore(previousStore);
    const previous = previousStore.records.find(item => item.id === previousStore.activeId);
    try {
      if (previous) fs.writeFileSync(MR_SOURCE_FILE, JSON.stringify(previous), 'utf8');
      else fs.unlinkSync(MR_SOURCE_FILE);
    } catch (_err) {}
    runtime = null;
    throw err;
  }
}

function listSources() {
  const store = readSourceStore();
  return store.records.map(item => ({
    id: item.id,
    name: item.name || '未命名音源',
    version: item.version || '',
    author: item.author || '',
    active: item.id === store.activeId,
  }));
}

async function selectSource(id) {
  const store = readSourceStore();
  const record = store.records.find(item => item.id === String(id || ''));
  if (!record) throw new Error('LX_SOURCE_NOT_FOUND');
  const previousId = store.activeId;
  store.activeId = record.id;
  writeSourceStore(store);
  fs.writeFileSync(MR_SOURCE_FILE, JSON.stringify(record), 'utf8');
  try {
    const host = await getRuntime(true);
    return { ok: true, name: host.name, version: host.version, sources: host.sources, installed: listSources() };
  } catch (err) {
    store.activeId = previousId;
    writeSourceStore(store);
    runtime = null;
    throw err;
  }
}

async function deleteSource(id) {
  id = String(id || '');
  const previousStore = readSourceStore();
  const target = previousStore.records.find(item => item.id === id);
  if (!target) throw new Error('LX_SOURCE_NOT_FOUND');

  const nextRecords = previousStore.records.filter(item => item.id !== id);
  const nextStore = {
    activeId: previousStore.activeId === id ? (nextRecords[0] && nextRecords[0].id || '') : previousStore.activeId,
    records: nextRecords,
  };
  if (nextStore.activeId && !nextRecords.some(item => item.id === nextStore.activeId)) {
    nextStore.activeId = nextRecords[0] && nextRecords[0].id || '';
  }

  const previousActive = previousStore.records.find(item => item.id === previousStore.activeId);
  writeSourceStore(nextStore);
  fallbackRuntimeCache.delete(id);

  if (!nextRecords.length) {
    try { fs.unlinkSync(MR_SOURCE_FILE); } catch (_err) {}
    runtime = null;
    return { ok: true, name: '未配置', version: '', sources: {}, installed: [] };
  }

  const activeRecord = nextRecords.find(item => item.id === nextStore.activeId) || nextRecords[0];
  nextStore.activeId = activeRecord.id;
  writeSourceStore(nextStore);
  fs.writeFileSync(MR_SOURCE_FILE, JSON.stringify(activeRecord), 'utf8');

  try {
    const host = await getRuntime(previousStore.activeId === id);
    return { ok: true, name: host.name, version: host.version, sources: host.sources, installed: listSources() };
  } catch (err) {
    writeSourceStore(previousStore);
    try {
      if (previousActive) fs.writeFileSync(MR_SOURCE_FILE, JSON.stringify(previousActive), 'utf8');
      else fs.unlinkSync(MR_SOURCE_FILE);
    } catch (_err) {}
    runtime = null;
    throw err;
  }
}

function downloadSourceScript(sourceUrl) {
  return new Promise((resolve, reject) => {
    lxRequest(sourceUrl, {
      method: 'GET',
      timeout: 20000,
      headers: { accept: 'application/javascript,text/javascript,text/plain,*/*' },
    }, (err, response) => {
      if (err) return reject(err);
      if (!response || response.statusCode < 200 || response.statusCode >= 300) {
        return reject(new Error(`LX_SOURCE_DOWNLOAD_HTTP_${response?.statusCode || 0}`));
      }
      const raw = Buffer.isBuffer(response.raw) ? response.raw : Buffer.from(String(response.body || ''));
      if (!raw.length || raw.length > 5 * 1024 * 1024) return reject(new Error('LX_SOURCE_FILE_INVALID'));
      resolve(raw.toString('utf8'));
    });
  });
}

async function importSourceUrl(sourceUrl) {
  sourceUrl = normalizeImportSourceUrl(sourceUrl);
  let script;
  try {
    script = await downloadSourceScript(sourceUrl);
  } catch (err) {
    const fallbackUrl = sourceUrlHttpFallback(sourceUrl, err);
    if (!fallbackUrl) throw err;
    sourceUrl = fallbackUrl;
    script = await downloadSourceScript(sourceUrl);
  }
  let fileName = 'remote-source.js';
  try {
    fileName = decodeURIComponent(path.basename(new URL(sourceUrl).pathname)) || fileName;
  } catch (_err) {}
  return importSource(script, fileName);
}

async function status() {
  const host = await getRuntime();
  return {
    ok: true,
    name: host.name,
    version: host.version,
    sources: host.sources,
    installed: listSources(),
  };
}

function normalizeMusicInfo(source, input) {
  const info = { ...(input || {}) };
  const fallbackIdPattern = /^(?:tx|wy|kw|kg|mg|song|row)_[0-9a-f]{12,}$/i;
  const hasFallbackId = info.importFallbackId === true ||
    fallbackIdPattern.test(String(info.songmid || '')) ||
    fallbackIdPattern.test(String(info.id || ''));
  if (hasFallbackId) {
    for (const key of ['id', 'songmid', 'mid', 'songId', 'rid', 'musicId', 'hash', 'FileHash', 'fileHash', 'copyrightId', 'copyrightid']) {
      if (info[key] != null) info[key] = '';
    }
    info.importFallbackId = true;
  }
  const id = info.songmid ?? info.id ?? info.hash ?? info.copyrightId ?? '';
  info.id ??= id;
  info.songmid ??= id;
  info.mid ??= info.songmid;
  info.songId ??= info.id;
  info.rid ??= info.songmid;
  info.musicId ??= info.songmid;
  info.name ??= info.songName ?? info.title ?? '';
  info.songName ??= info.name;
  info.title ??= info.name;
  info.singer ??= info.artist ?? info.singerName ?? '';
  info.artist ??= info.singer;
  info.albumName ??= info.album ?? '';
  info.album ??= info.albumName;
  info.meta = { ...(info.meta || {}) };
  if (hasFallbackId) {
    for (const key of ['mid', 'songmid', 'songid', 'id', 'hash', 'rid', 'musicId', 'copyrightId']) {
      if (info.meta[key] != null) info.meta[key] = '';
    }
    for (const platformKey of ['qq', 'wy', 'kw', 'kg', 'mg']) {
      if (info.meta[platformKey] && typeof info.meta[platformKey] === 'object') {
        info.meta[platformKey] = {};
      }
    }
  }
  info.meta.mid ??= info.songmid;
  info.meta.songmid ??= info.songmid;
  info.meta.songid ??= info.id;
  info.meta.id ??= info.id;
  info.meta.hash ??= info.hash;
  if (source === 'tx') {
    info.meta.qq = { ...(info.meta.qq || {}), mid: info.songmid, songmid: info.songmid, songid: info.id };
    info.strMediaMid ??= info.songmid;
  } else if (source === 'wy') {
    info.meta.wy = { ...(info.meta.wy || {}), id: info.id };
  } else if (source === 'kw') {
    info.meta.kw = { ...(info.meta.kw || {}), id: info.songmid, rid: info.songmid };
  } else if (source === 'kg') {
    info.meta.kg = { ...(info.meta.kg || {}), id: info.id, hash: info.hash };
  } else if (source === 'mg') {
    info.meta.mg = { ...(info.meta.mg || {}), id: info.id, copyrightId: info.copyrightId };
  }
  return info;
}

function normalizeExtractedHttpUrl(text) {
  text = String(text || '').trim();
  if (!text) return '';
  text = text.replace(/\\\//g, '/').replace(/^['"]|['"]$/g, '').trim();
  if (/^\/\//.test(text)) text = 'https:' + text;
  if (/^https?:\/\//i.test(text)) return text;
  const embedded = text.match(/https?:\\?\/\\?\/[^\s"'<>]+/i);
  if (embedded) return normalizeExtractedHttpUrl(embedded[0]);
  try {
    const decoded = decodeURIComponent(text);
    if (decoded !== text) return normalizeExtractedHttpUrl(decoded);
  } catch (_err) {}
  return '';
}

function extractHttpUrl(value, depth = 0) {
  if (depth > 5 || value == null) return '';
  if (typeof value === 'string') {
    const text = value.trim();
    const direct = normalizeExtractedHttpUrl(text);
    if (direct) return direct;
    try { return extractHttpUrl(JSON.parse(text), depth + 1); } catch (_err) { return ''; }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractHttpUrl(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value === 'object') {
    for (const key of ['url', 'musicUrl', 'music_url', 'playUrl', 'play_url', 'audio', 'src', 'link', 'location', 'href', 'file', 'purl']) {
      const found = extractHttpUrl(value[key], depth + 1);
      if (found) return found;
    }
    for (const key of ['data', 'body', 'result', 'music', 'song', 'info', 'response']) {
      const found = extractHttpUrl(value[key], depth + 1);
      if (found) return found;
    }
  }
  return '';
}

function sanitizePlaybackHeaders(headers) {
  const out = {};
  const allowed = new Set(['accept', 'cookie', 'origin', 'referer', 'referrer', 'user-agent']);
  for (const [rawKey, rawValue] of Object.entries(headers || {})) {
    const key = String(rawKey || '').trim().toLowerCase();
    if (!allowed.has(key) || rawValue == null) continue;
    const normalizedKey = key === 'referrer' ? 'referer' : key;
    out[normalizedKey] = sanitizeHeaderValue(rawValue);
  }
  return out;
}

function extractPlaybackHeaders(value, depth = 0) {
  if (depth > 5 || value == null) return {};
  if (typeof value === 'string') {
    try { return extractPlaybackHeaders(JSON.parse(value), depth + 1); } catch (_err) { return {}; }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractPlaybackHeaders(item, depth + 1);
      if (Object.keys(found).length) return found;
    }
    return {};
  }
  if (typeof value !== 'object') return {};
  for (const key of ['headers', 'header', 'requestHeaders', 'playHeaders', 'audioHeaders', 'proxyHeaders']) {
    const headers = sanitizePlaybackHeaders(value[key]);
    if (Object.keys(headers).length) return headers;
  }
  for (const key of ['data', 'body', 'result', 'music', 'song', 'info', 'response']) {
    const found = extractPlaybackHeaders(value[key], depth + 1);
    if (Object.keys(found).length) return found;
  }
  return {};
}

function readMp3FrameInfo(bytes) {
  let offset = 0;
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    offset = 10 + ((bytes[6] & 0x7f) << 21) + ((bytes[7] & 0x7f) << 14) +
      ((bytes[8] & 0x7f) << 7) + (bytes[9] & 0x7f);
  }
  const mpeg1Rates = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
  const mpeg2Rates = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0];
  const sampleRates = {
    3: [44100, 48000, 32000],
    2: [22050, 24000, 16000],
    0: [11025, 12000, 8000],
  };
  for (let i = Math.max(0, offset); i + 3 < bytes.length; i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;
    const version = (bytes[i + 1] >> 3) & 3;
    const layer = (bytes[i + 1] >> 1) & 3;
    const bitrateIndex = (bytes[i + 2] >> 4) & 15;
    const sampleIndex = (bytes[i + 2] >> 2) & 3;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) continue;
    const rates = version === 3 ? mpeg1Rates : mpeg2Rates;
    return {
      codec: 'mp3',
      lossless: false,
      bitrate: rates[bitrateIndex] * 1000,
      sampleRate: sampleRates[version][sampleIndex],
    };
  }
  return null;
}

async function probeAudioUrl(url, playbackHeaders) {
  const fetchImpl = electronFetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('LX_AUDIO_PROBE_UNAVAILABLE');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const headers = sanitizeHeaders(Object.assign({
      Range: 'bytes=0-131071',
      'User-Agent': 'Mozilla/5.0 Mineradio/1.5',
      Accept: 'audio/*,*/*;q=0.8',
    }, playbackHeaders || {}));
    headers.Range = 'bytes=0-131071';
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers,
    });
    if (!response.ok && response.status !== 206) throw new Error(`LX_AUDIO_PROBE_HTTP_${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length >= 4 && bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) {
      let sampleRate = 0;
      let bitDepth = 0;
      if (bytes.length >= 26 && (bytes[4] & 0x7f) === 0) {
        sampleRate = (bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4);
        bitDepth = (((bytes[20] & 1) << 4) | (bytes[21] >> 4)) + 1;
      }
      return { codec: 'flac', lossless: true, bitrate: 0, sampleRate, bitDepth };
    }
    if (bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      return { codec: 'wav', lossless: true, bitrate: 0, sampleRate: 0 };
    }
    const mp3 = readMp3FrameInfo(bytes);
    if (mp3) return mp3;
    throw new Error('LX_AUDIO_FORMAT_UNVERIFIED');
  } finally {
    clearTimeout(timer);
  }
}

function audioProbeSatisfiesQuality(probe, quality) {
  if (!probe) return false;
  if (['master', 'flac24bit'].includes(quality)) return probe.lossless === true && probe.bitDepth >= 24;
  if (quality === 'hires') {
    return probe.lossless === true && (probe.bitDepth >= 24 || probe.sampleRate > 48000);
  }
  if (quality === 'flac') return probe.lossless === true;
  if (quality === '320k') return probe.lossless === true || probe.bitrate >= 256000;
  return probe.lossless === true || probe.bitrate >= 96000;
}

const musicUrlCache = new Map();
async function resolveMusicUrl(source, musicInfo, quality, options) {
  options = options || {};
  const excludedResolvers = new Set((Array.isArray(options.excludeResolvers) ? options.excludeResolvers : [])
    .map(item => String(item || '').trim().toLowerCase()).filter(Boolean));
  const requested = String(quality || '').trim();
  const fallbackMap = {
    master: ['master', 'flac24bit', 'hires', 'flac', '320k', '128k'],
    atmos_plus: ['atmos_plus', 'master', 'flac24bit', 'hires', 'flac', '320k', '128k'],
    flac24bit: ['flac24bit', 'hires', 'flac', '320k', '128k'],
    hires: ['hires', 'flac', '320k', '128k'],
    flac: ['flac', '320k', '128k'],
    '320k': ['320k', '128k'],
    '128k': ['128k'],
  };
  const normalizedInfo = normalizeMusicInfo(source, musicInfo);
  const cacheKey = [
    source,
    normalizedInfo.songmid || normalizedInfo.id || normalizedInfo.hash || normalizedInfo.copyrightId || '',
    requested,
  ].join('|');
  const cached = musicUrlCache.get(cacheKey);
  if (!excludedResolvers.size && cached && Date.now() - cached.time < 90 * 1000) return cached.value;
  const activeHost = await getRuntime();
  const hostPromises = [Promise.resolve(activeHost)];
  for (const record of allScriptRecords()) {
    if (record.id === activeHost.id) continue;
    if (!fallbackRuntimeCache.has(record.id)) {
      fallbackRuntimeCache.set(record.id, createRuntime(record).catch(err => {
        fallbackRuntimeCache.delete(record.id);
        throw err;
      }));
    }
    hostPromises.push(fallbackRuntimeCache.get(record.id));
  }
  const attempts = hostPromises.map(async hostPromise => {
    const host = await hostPromise;
    if (excludedResolvers.has(String(host.name || '').trim().toLowerCase()) ||
        excludedResolvers.has(String(host.id || '').trim().toLowerCase())) {
      throw new Error('LX_SOURCE_EXCLUDED');
    }
    const supported = Array.isArray(host.sources[source]?.qualitys) ? host.sources[source].qualitys : [];
    const rawCandidates = /^念心音源/i.test(host.name)
      ? ['320k', '128k', requested, 'flac']
      : (fallbackMap[requested] || [requested, 'flac', '320k', '128k']);
    const candidates = rawCandidates
      .filter((item, index, all) => item && (!supported.length || supported.includes(item)) && all.indexOf(item) === index)
      .slice(0, 4);
    if (!host.sources[source] || !candidates.length) throw new Error('LX_QUALITY_UNSUPPORTED');
    const errors = [];
    for (const candidate of candidates) {
      try {
        const result = await withTimeout(
          host.request(source, 'musicUrl', { type: candidate, quality: candidate, musicInfo: normalizedInfo }),
          LX_ACTION_TIMEOUT_MS,
          `LX_SOURCE_TIMEOUT_${candidate}`
        );
        let url = extractHttpUrl(result);
        const playbackHeaders = extractPlaybackHeaders(result);
        if (/^http:\/\/mcp\.nianxinxz\.com\//i.test(url)) {
          url = url.replace(/^http:/i, 'https:');
        }
        if (url) {
          let probe = null;
          try {
            probe = await probeAudioUrl(url, playbackHeaders);
            if (!audioProbeSatisfiesQuality(probe, requested)) {
              errors.push(`${candidate}:LX_AUDIO_QUALITY_DOWNGRADED_${probe.codec}_${probe.bitrate || 0}`);
              if (requested && !['master', 'flac24bit', 'hires', 'flac'].includes(requested)) continue;
            }
          } catch (probeErr) {
            errors.push(`${candidate}:${probeErr && probeErr.message ? probeErr.message : 'LX_AUDIO_PROBE_FAILED'}_ACCEPTED`);
          }
          return { url, headers: playbackHeaders, quality: candidate, actual: probe, resolver: host.name };
        }
        errors.push(`${candidate}:LX_SOURCE_URL_INVALID`);
      } catch (err) {
        errors.push(`${candidate}:${err && err.message ? err.message : 'LX_SOURCE_RESOLVE_FAILED'}`);
      }
    }
    throw new Error(errors.join(';') || 'LX_SOURCE_RESOLVE_FAILED');
  });
  try {
    const value = await Promise.race([
      Promise.any(attempts),
      new Promise((_, reject) => setTimeout(() => reject(new Error('所有音源解析超时')), 45000)),
    ]);
    if (value && value.url) {
      musicUrlCache.set(cacheKey, { time:Date.now(), value });
      if (musicUrlCache.size > 120) musicUrlCache.delete(musicUrlCache.keys().next().value);
    }
    return value;
  } catch (error) {
    if (error && error.message === '所有音源解析超时') throw error;
    const reasons = error && Array.isArray(error.errors)
      ? error.errors.map(item => item && item.message).filter(Boolean)
      : [];
    if (reasons.length) console.warn('[LXSourceAllRejected]', reasons);
    throw new Error('这首歌的所有可用音源和音质均解析失败，请稍后重试或更换音源');
  }
}

async function resolveLyrics(source, musicInfo) {
  const host = await getRuntime();
  if (!host.sources[source]) throw new Error('LX_SOURCE_UNSUPPORTED');
  const result = await host.request(source, 'lyric', {
    musicInfo: normalizeMusicInfo(source, musicInfo),
  });
  if (typeof result === 'string') {
    return { lyric: result, tlyric: '', rlyric: '', lxlyric: '' };
  }
  const raw = result && typeof result === 'object' ? result : {};
  const body = raw.data && typeof raw.data === 'object' ? raw.data : raw;
  return {
    lyric: body.lyric || body.lrc || body.lyrics || '',
    tlyric: body.tlyric || body.tlrc || body.trans || body.translation || '',
    rlyric: body.rlyric || body.roma || body.romalrc || '',
    lxlyric: body.lxlyric || body.wordLyric || body.yrc || '',
  };
}

module.exports = {
  getRuntime,
  importSource,
  importSourceUrl,
  listSources,
  selectSource,
  deleteSource,
  resolveMusicUrl,
  resolveLyrics,
  status,
};
