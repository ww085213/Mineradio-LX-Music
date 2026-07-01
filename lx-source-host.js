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
});

const APPDATA_DIR = process.env.APPDATA || '';
const LOCALAPPDATA_DIR = process.env.LOCALAPPDATA || '';
const LX_DATA_DIRS = [
  APPDATA_DIR && path.join(APPDATA_DIR, 'lx-music-desktop', 'LxDatas'),
  LOCALAPPDATA_DIR && path.join(LOCALAPPDATA_DIR, 'Programs', 'lx-music-desktop', 'portable', 'LxDatas'),
].filter(Boolean);
const MR_SOURCE_DIR = path.join(APPDATA_DIR || LOCALAPPDATA_DIR || process.cwd(), 'Mineradio', 'sources');
const MR_SOURCE_FILE = path.join(MR_SOURCE_DIR, 'active-source.json');
const ALLOWED_SOURCES = new Set(['kw', 'kg', 'tx', 'wy', 'mg', 'xm', 'local']);
const ALLOWED_ACTIONS = new Set(['musicUrl', 'lyric', 'pic']);
const LX_HTTP_TIMEOUT_MS = 12000;
const LX_ACTION_TIMEOUT_MS = 14000;

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
  } catch (_err) {}
}

function activeScriptRecord() {
  const imported = readJsonIfExists(MR_SOURCE_FILE);
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
  const records = [];
  const imported = readJsonIfExists(MR_SOURCE_FILE);
  if (imported && typeof imported.script === 'string') records.push(imported);
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
  const headers = Object.assign({
    'accept': '*/*',
    'accept-encoding': 'gzip, deflate, br',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Mineradio/LXSource',
  }, options.headers || {});
  const body = encodeRequestData(options, headers);
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
  };
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
    request: lxRequest,
    on(eventName, handler) {
      if (eventName !== EVENT_NAMES.request || typeof handler !== 'function') {
        return Promise.reject(new Error('Unsupported LX event'));
      }
      state.handler = handler;
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
      name: record.name || '',
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
    console,
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    atob: value => Buffer.from(String(value), 'base64').toString('binary'),
    btoa: value => Buffer.from(String(value), 'binary').toString('base64'),
  };
  sandbox.globalThis = sandbox;
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
    if (ALLOWED_SOURCES.has(key)) sources[key] = value;
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
  if (!script.trim() || script.length > 2 * 1024 * 1024) throw new Error('LX_SOURCE_FILE_INVALID');
  if (!/(?:globalThis|global|this)\s*(?:\.\s*lx|\[\s*['\"]lx['\"]\s*\])|(?:^|[^\w])lx\s*[.;]/.test(script)) throw new Error('LX_SOURCE_API_NOT_FOUND');
  const record = metadataFromScript(script, fileName);
  fs.mkdirSync(MR_SOURCE_DIR, { recursive: true });
  fs.writeFileSync(MR_SOURCE_FILE, JSON.stringify(record), 'utf8');
  try {
    const host = await getRuntime(true);
    return { ok: true, name: host.name, version: host.version, sources: host.sources };
  } catch (err) {
    try { fs.unlinkSync(MR_SOURCE_FILE); } catch (_err) {}
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
      if (!raw.length || raw.length > 2 * 1024 * 1024) return reject(new Error('LX_SOURCE_FILE_INVALID'));
      resolve(raw.toString('utf8'));
    });
  });
}

async function importSourceUrl(sourceUrl) {
  sourceUrl = String(sourceUrl || '').trim();
  if (!/^https?:\/\/\S+$/i.test(sourceUrl)) throw new Error('LX_SOURCE_URL_INVALID');
  const script = await downloadSourceScript(sourceUrl);
  let fileName = 'remote-source.js';
  try {
    fileName = path.basename(new URL(sourceUrl).pathname) || fileName;
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
  };
}

function normalizeMusicInfo(source, input) {
  const info = { ...(input || {}) };
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

function extractHttpUrl(value, depth = 0) {
  if (depth > 5 || value == null) return '';
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^https?:\/\//i.test(text)) return text;
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
    for (const key of ['url', 'musicUrl', 'playUrl', 'play_url', 'audio', 'src', 'link']) {
      const found = extractHttpUrl(value[key], depth + 1);
      if (found) return found;
    }
    for (const key of ['data', 'body', 'result', 'music', 'song']) {
      const found = extractHttpUrl(value[key], depth + 1);
      if (found) return found;
    }
  }
  return '';
}

async function resolveMusicUrl(source, musicInfo, quality) {
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
        if (/^http:\/\/mcp\.nianxinxz\.com\//i.test(url)) {
          url = url.replace(/^http:/i, 'https:');
        }
        if (url) return { url, quality: candidate, resolver: host.name };
        errors.push(`${candidate}:LX_SOURCE_URL_INVALID`);
      } catch (err) {
        errors.push(`${candidate}:${err && err.message ? err.message : 'LX_SOURCE_RESOLVE_FAILED'}`);
      }
    }
    throw new Error(errors.join(';') || 'LX_SOURCE_RESOLVE_FAILED');
  });
  try {
    return await Promise.race([
      Promise.any(attempts),
      new Promise((_, reject) => setTimeout(() => reject(new Error('所有音源解析超时')), 45000)),
    ]);
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
  resolveMusicUrl,
  resolveLyrics,
  status,
};
