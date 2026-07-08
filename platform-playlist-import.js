'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
let networkFetch = globalThis.fetch;
function setFetchImplementation(fn) {
  if (typeof fn === 'function') networkFetch = fn;
}

async function fetchJson(url, options = {}) {
  let lastError;
  const maxAttempts = Math.max(1, Math.min(3, Number(options.retryAttempts) || 3));
  const requestOptions = { ...options };
  delete requestOptions.retryAttempts;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    try {
      let response;
      try {
        response = await networkFetch(url, {
          ...requestOptions,
          signal: controller.signal,
          headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            ...(requestOptions.headers || {}),
          },
        });
      } catch (error) {
        try {
          return await fetchJsonNative(url, requestOptions);
        } catch (nativeError) {
          nativeError.cause = nativeError.cause || error;
          throw nativeError;
        }
      }
      if (!response.ok) {
        const error = new Error(`HTTP_${response.status}`);
        const retryAfter = response.headers && response.headers.get && response.headers.get('retry-after');
        if (retryAfter) {
          const seconds = Number(retryAfter);
          error.retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now());
        }
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      const retryable = /HTTP_(?:429|5\d\d)|abort|timeout|fetch|network|socket|ECONN|ENOTFOUND/i.test(String(error && (error.message || error)));
      if (!retryable || attempt >= maxAttempts - 1) throw error;
      const delay = Math.max(350 * (2 ** attempt), Math.min(10000, Math.max(0, Number(error.retryAfterMs) || 0)));
      await new Promise(resolve => setTimeout(resolve, delay));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('PLAYLIST_REQUEST_FAILED');
}

function fetchJsonNative(url, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('TOO_MANY_REDIRECTS'));
      return;
    }
    const target = new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    const method = String(options.method || 'GET').toUpperCase();
    let body = options.body == null ? null : options.body;
    if (body != null && !Buffer.isBuffer(body)) body = Buffer.from(String(body));
    const headers = {
      'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...(options.headers || {}),
    };
    if (body && !Object.keys(headers).some(key => key.toLowerCase() === 'content-length')) {
      headers['content-length'] = String(body.length);
    }
    const request = transport.request(target, { method, headers }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, target).href;
        const switchToGet = response.statusCode === 303 || ((response.statusCode === 301 || response.statusCode === 302) && method === 'POST');
        const nextOptions = switchToGet
          ? { ...options, method:'GET', body:undefined, headers:{ ...(options.headers || {}) } }
          : options;
        if (switchToGet && nextOptions.headers) {
          for (const key of Object.keys(nextOptions.headers)) {
            if (['content-length', 'content-type'].includes(key.toLowerCase())) delete nextOptions.headers[key];
          }
        }
        resolve(fetchJsonNative(nextUrl, nextOptions, redirects + 1));
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP_${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')));
        } catch (_error) {
          reject(new Error('INVALID_JSON'));
        }
      });
    });
    request.setTimeout(18000, () => request.destroy(new Error('REQUEST_TIMEOUT')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  const headers = {
    'user-agent':'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile Safari/537.36',
    ...(options.headers || {}),
  };
  try {
    try {
      const response = await networkFetch(url, { ...options, signal:controller.signal, headers });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      return await response.text();
    } catch (error) {
      const native = await requestShareStepNative(url, String(options.method || 'GET').toUpperCase(), headers);
      if (native.status < 200 || native.status >= 400) throw error;
      return native.body;
    }
  } finally {
    clearTimeout(timer);
  }
}

function durationText(seconds) {
  seconds = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function singerText(value) {
  if (Array.isArray(value)) {
    return value.map(item => typeof item === 'string' ? item : (item?.name || item?.singerName || item?.artistName || item?.singer)).filter(Boolean).join('、');
  }
  if (value && typeof value === 'object') return String(value.name || value.singerName || value.artistName || value.singer || '');
  return String(value || '');
}


function uniqueBy(items, getKey) {
  const seen = new Set();
  return (items || []).filter(item => {
    const key = String(getKey(item) || '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableImportKey(parts, prefix) {
  const text = (parts || []).map(value => String(value || '').trim().toLowerCase()).filter(Boolean).join('|');
  return text ? `${prefix || 'row'}_${crypto.createHash('sha1').update(text).digest('hex').slice(0, 16)}` : '';
}

function ensureImportSongId(song, prefix, index) {
  if (!song) return song;
  const existing = String(song.songmid || song.id || '').trim();
  if (existing) {
    if (/^(?:tx|wy|kw|kg|mg|song|row)_[0-9a-f]{12,}$/i.test(existing)) song.importFallbackId = true;
    song.id = song.id || existing;
    song.songmid = song.songmid || existing;
    return song;
  }
  const generated = stableImportKey([song.name, song.singer, song.albumName, song.interval, index], prefix || song.source || 'song');
  song.id = generated || `${prefix || song.source || 'song'}_${index}`;
  song.songmid = song.id;
  song.importFallbackId = true;
  return song;
}

function finalizeImportedSongs(songs, prefix) {
  return (songs || [])
    .map((song, index) => ensureImportSongId(song, prefix, index))
    .filter(song => song && song.name && song.songmid);
}

function parseAssignedJson(html, marker) {
  const markerIndex = String(html || '').indexOf(marker);
  if (markerIndex < 0) return null;
  const start = html.indexOf('[', markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '[' || char === '{') depth += 1;
    else if (char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(html.slice(start, index + 1));
    }
  }
  return null;
}

function parseAssignedObject(html, marker) {
  const text = String(html || '');
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = text.indexOf('{', markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, index + 1)); } catch (_error) { return null; }
      }
    }
  }
  return null;
}

const SOURCE_ALIASES = {
  tx:'tx', qq:'tx', '小秋':'tx',
  wy:'wy', '163':'wy', netease:'wy', '小芸':'wy',
  kw:'kw', kuwo:'kw', '小蜗':'kw',
  kg:'kg', kugou:'kg', '小枸':'kg', '小狗':'kg',
  kgc:'kgc', kglite:'kgc', concept:'kgc', '小枸概念版':'kgc', '酷狗概念版':'kgc', '概念版':'kgc',
  mg:'mg', migu:'mg', '小菇':'mg',
};

function normalizeSource(value) {
  return SOURCE_ALIASES[String(value || '').trim().toLowerCase()] || '';
}

function extractFirstUrl(input) {
  const match = String(input || '').match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[，。；;、）)\]}>]+$/g, '') : '';
}

function safeUrl(value, base) {
  try { return new URL(String(value || '').trim(), base).href; } catch (_error) { return ''; }
}

function getUrlParamEverywhere(rawUrl, keys) {
  try {
    const parsed = new URL(rawUrl);
    for (const key of keys) {
      const value = parsed.searchParams.get(key);
      if (value) return value;
    }
    const fragment = decodeURIComponent(parsed.hash || '');
    for (const key of keys) {
      const match = fragment.match(new RegExp(`(?:[?&#]|^|\\b)${key}=([^&#\\s]+)`, 'i'));
      if (match) return match[1];
    }
  } catch (_error) {}
  return '';
}

function extractMiguPlaylistId(value) {
  const text = String(value || '');
  const url = extractFirstUrl(text) || (/^https?:\/\//i.test(text.trim()) ? text.trim() : '');
  if (url && /(?:^|\.)migu\.cn$/i.test((() => { try { return new URL(url).hostname; } catch (_e) { return ''; } })())) {
    const direct = getUrlParamEverywhere(url, ['playlistId', 'playListId', 'id']);
    if (/^\d+$/.test(direct)) return direct;
    try {
      const pathMatch = new URL(url).pathname.match(/\/(\d{5,})(?:\.html?)?\/?$/i);
      if (pathMatch) return pathMatch[1];
    } catch (_error) {}
  }
  const match = text.match(/(?:playlistId|playListId|(?:[?&#]|\b)id)\s*[=/:_-]+\s*(\d{5,})/i);
  return match ? match[1] : '';
}

function extractMiguPlaylistIdentity(value) {
  const id = extractMiguPlaylistId(value);
  if (id) return id;
  const text = String(value || '');
  const url = extractFirstUrl(text) || (/^https?:\/\//i.test(text.trim()) ? text.trim() : '');
  if (!url) return '';
  try {
    if (/(?:^|\.)migu\.cn$/i.test(new URL(url).hostname)) return `url:${url}`;
  } catch (_error) {}
  return '';
}

function extractKugouPlaylistIdentity(value) {
  const text = String(value || '');
  const collectionMatch = text.match(/(?:global_collection_id|global_specialid)["'\s:=]+(collection_[a-z0-9_-]+)/i)
    || text.match(/\b(collection_[a-z0-9_-]+)\b/i);
  if (collectionMatch) return collectionMatch[1].toLowerCase();
  const gcidMatch = text.match(/\b(gcid_[a-z0-9]+)\b/i);
  if (gcidMatch) return gcidMatch[1].toLowerCase();
  const specialMatch = text.match(/(?:specialid|specialId|plistid|listid)["'\s:=]+(\d{3,})/i)
    || text.match(/\/special\/single\/(\d+)/i);
  if (specialMatch) return specialMatch[1];

  const url = extractFirstUrl(text) || (/^https?:\/\//i.test(text.trim()) ? text.trim() : '');
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (!/(?:^|\.)kugou\.(?:com|cn)$/i.test(parsed.hostname)) return '';
    for (const key of ['global_collection_id', 'global_specialid']) {
      const value = parsed.searchParams.get(key);
      if (/^collection_[a-z0-9_-]+$/i.test(value || '')) return value.toLowerCase();
    }
    for (const key of ['gcid', 'songlistid', 'encode_gic', 'encode_src_gid']) {
      const value = parsed.searchParams.get(key);
      if (/^gcid_[a-z0-9]+$/i.test(value || '')) return value.toLowerCase();
    }
    for (const key of ['specialid', 'specialId', 'plistid', 'listid', 'id']) {
      const value = parsed.searchParams.get(key);
      if (/^\d+$/.test(value || '')) return value;
    }
    const pathGCID = parsed.pathname.match(/songlist\/(gcid_[a-z0-9]+)/i);
    if (pathGCID) return pathGCID[1].toLowerCase();
    const pathSpecial = parsed.pathname.match(/(?:special|playlist)\/(?:single\/)?(\d+)/i);
    if (pathSpecial) return pathSpecial[1];
    // Concept-edition playlist links commonly carry an opaque chain and reveal
    // global_collection_id only after redirect/page loading. Keep the URL as an
    // import identity so importKG can resolve it instead of rejecting it early.
    return `url:${url}`;
  } catch (_error) {
    return '';
  }
}


function extractKugouNormalIdentity(value) {
  const text = String(value || '');
  const gcidMatch = text.match(/\b(gcid_[a-z0-9]+)\b/i);
  if (gcidMatch) return gcidMatch[1].toLowerCase();
  const specialMatch = text.match(/(?:specialid|specialId|plistid|listid)["'\s:=]+(\d{3,})/i)
    || text.match(/\/(?:special|playlist)\/(?:single\/)?(\d+)/i);
  if (specialMatch) return specialMatch[1];
  const url = extractFirstUrl(text) || (/^https?:\/\//i.test(text.trim()) ? text.trim() : '');
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (!/(?:^|\.)kugou\.(?:com|cn)$/i.test(parsed.hostname)) return '';
    for (const key of ['gcid', 'songlistid', 'encode_gic', 'encode_src_gid']) {
      const item = parsed.searchParams.get(key);
      if (/^gcid_[a-z0-9]+$/i.test(item || '')) return item.toLowerCase();
    }
    for (const key of ['specialid', 'specialId', 'plistid', 'listid', 'id']) {
      const item = parsed.searchParams.get(key);
      if (/^\d+$/.test(item || '')) return item;
    }
    const pathGCID = parsed.pathname.match(/songlist\/(gcid_[a-z0-9]+)/i);
    if (pathGCID) return pathGCID[1].toLowerCase();
    const pathSpecial = parsed.pathname.match(/(?:special|playlist)\/(?:single\/)?(\d+)/i);
    if (pathSpecial) return pathSpecial[1];
  } catch (_error) {}
  return '';
}

function extractKugouConceptIdentity(value) {
  const text = String(value || '');
  const explicit = text.match(/(?:global_collection_id|global_specialid)["'\s:=]+([a-z0-9_-]{4,})/i)
    || text.match(/\b(collection_[a-z0-9_-]+)\b/i);
  if (explicit) return String(explicit[1]).toLowerCase();
  const url = extractFirstUrl(text) || (/^https?:\/\//i.test(text.trim()) ? text.trim() : '');
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (!/(?:^|\.)kugou\.(?:com|cn)$/i.test(parsed.hostname)) return '';
    for (const key of ['global_collection_id', 'global_specialid']) {
      const item = parsed.searchParams.get(key);
      if (/^[a-z0-9_-]{4,}$/i.test(item || '')) return item.toLowerCase();
    }
    for (const key of ['gcid', 'songlistid', 'encode_gic', 'encode_src_gid']) {
      const item = parsed.searchParams.get(key);
      if (/^gcid_[a-z0-9]+$/i.test(item || '')) return item.toLowerCase();
    }
    for (const key of ['specialid', 'specialId']) {
      const item = parsed.searchParams.get(key);
      if (/^\d+$/.test(item || '') && item !== '0') return item;
    }
    if (/^t1\.kugou\.com$/i.test(parsed.hostname) || /\/share\/zlist\.html/i.test(parsed.pathname)) return `url:${url}`;
  } catch (_error) {}
  return '';
}

function findKugouConceptIdentityInPayload(payload, depth = 0, seen = new Set()) {
  if (payload == null || depth > 8) return '';
  if (typeof payload === 'string') return extractKugouConceptIdentity(payload);
  if (typeof payload !== 'object' || seen.has(payload)) return '';
  seen.add(payload);
  for (const key of ['global_collection_id', 'global_specialid', 'collection_id', 'gcid', 'specialid']) {
    const value = payload[key];
    if (value != null) {
      const direct = extractKugouConceptIdentity(`${key}=${String(value)}`);
      if (direct) return direct;
    }
  }
  for (const value of Object.values(payload)) {
    const found = findKugouConceptIdentityInPayload(value, depth + 1, seen);
    if (found) return found;
  }
  return '';
}

function extractJsonRedirect(body, baseUrl) {
  const text = String(body || '').trim().replace(/^\uFEFF/, '');
  if (!text || (text[0] !== '{' && text[0] !== '[')) return '';
  try {
    const payload = JSON.parse(text);
    const candidates = [];
    const visit = (value, depth = 0) => {
      if (value == null || depth > 7) return;
      if (typeof value === 'string') {
        if (/^https?:\/\//i.test(value)) candidates.push(value);
        return;
      }
      if (typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        if (/url|link|jump|redirect|target/i.test(key) && typeof item === 'string') candidates.push(item);
        visit(item, depth + 1);
      }
    };
    visit(payload);
    for (const candidate of candidates) {
      const resolved = safeUrl(candidate, baseUrl);
      if (resolved && resolved !== baseUrl) return resolved;
    }
  } catch (_error) {}
  return '';
}

function detect(input, preferredSource) {
  const text = String(input || '').trim();
  const source = normalizeSource(preferredSource);
  const preferredPlaylistId = source && extractPlatformPlaylistId(source, text);
  if (preferredPlaylistId) return { source, kind:'playlist', id:preferredPlaylistId, input:text };
  const preferredAlbumId = source && extractPlatformAlbumId(source, text);
  if (preferredAlbumId) return { source, kind:'album', id:preferredAlbumId, input:text };
  const albumLike = /(?:\/|[?&#])album(?:Detail|_detail)?(?:[/?&#=_-]|$)|(?:albumId|albumid|albumMid|albummid)\s*=/i.test(text);
  if (source && albumLike) {
    if (['tx', 'wy', 'kw'].includes(source)) throw new Error('已识别为专辑链接，但没有取得专辑编号；请重新复制专辑分享链接');
    throw new Error('当前平台暂不支持专辑导入，请使用歌单分享链接');
  }

  if (source === 'kgc') {
    const pureConceptGCID = text.match(/^gcid_[a-z0-9]+$/i);
    if (pureConceptGCID) return { source:'kgc', id:pureConceptGCID[0].toLowerCase(), input:text };
    const conceptId = extractKugouConceptIdentity(text);
    if (conceptId) return { source:'kgc', id:conceptId, input:text };
    if (extractKugouNormalIdentity(text)) throw new Error('这是普通小枸歌单链接，请选择“小枸”后再导入');
    throw new Error('无法识别小枸概念版歌单；请粘贴概念版分享链接或 collection_ 开头的歌单编号');
  }
  if (source === 'kg') {
    const normalId = extractKugouNormalIdentity(text);
    if (normalId) return { source:'kg', id:normalId, input:text };
    if (extractKugouConceptIdentity(text)) throw new Error('这是小枸概念版歌单，请选择“小枸概念版”后再导入');
  }

  const miguId = extractMiguPlaylistIdentity(text);
  if (miguId && (/migu\.cn/i.test(text) || source === 'mg')) return { source:'mg', id:miguId, input:text };
  const kugouId = extractKugouNormalIdentity(text);
  if (kugouId && (/kugou\.(?:com|cn)/i.test(text) || source === 'kg')) return { source:'kg', id:kugouId, input:text };

  const rules = [
    ['tx', 'album', /(?:y\.qq\.com|i\d*\.y\.qq\.com|c\d*\.y\.qq\.com|m\.qq\.com)[^\s]*?(?:album(?:Detail)?[/?]|[?&#](?:albumId|albumid|albumMid|albummid)=)([a-z0-9_-]+)/i],
    ['wy', 'album', /(?:music\.163\.com|y\.music\.163\.com|m\.music\.163\.com|163cn\.tv)[^\s]*?(?:album(?:\?id=|\/)|[?&#]albumId=)(\d+)/i],
    ['kw', 'album', /(?:kuwo\.cn|kuwo\.com|h5app\.kuwo\.cn|m\.kuwo\.cn)[^\s]*?(?:album(?:_detail)?[/?_-]|[?&#](?:albumId|albumid)=)(\d+)/i],
    ['tx', 'playlist', /(?:y\.qq\.com|i\d*\.y\.qq\.com|c\d*\.y\.qq\.com|m\.qq\.com)[^\s]*?(?:playlist(?:\.html)?[/?]|[?&#](?:id|disstid)=)(\d+)/i],
    ['wy', 'playlist', /(?:music\.163\.com|y\.music\.163\.com|m\.music\.163\.com|163cn\.tv)[^\s]*?(?:playlist(?:\?id=|\/)|[?&#](?:playlistId|id)=)(\d+)/i],
    ['kw', 'playlist', /(?:kuwo\.cn|kuwo\.com|h5app\.kuwo\.cn|m\.kuwo\.cn)[^\s]*?(?:playlist(?:_detail)?[/?_-]|[?&#](?:pid|playlistId|id)=)(\d+)/i],
  ];
  for (const [ruleSource, ruleKind, rx] of rules) {
    const match = text.match(rx);
    if (match) return { source:ruleSource, kind:ruleKind, id:match[1], input:text };
  }
  const prefixed = text.match(/^(tx|qq|wy|163|kw|kg|kgc|kglite|mg|小秋|小芸|小蜗|小枸|小狗|小菇|小枸概念版|酷狗概念版|概念版)\s*[:：]\s*([a-z0-9_-]+)$/i);
  if (prefixed) return { source:normalizeSource(prefixed[1]), id:prefixed[2], input:text };
  if (source && /^\d+$/.test(text)) return { source, id:text, input:text };
  if (source === 'kg' && /^gcid_[a-z0-9_-]+$/i.test(text)) return { source, id:text.toLowerCase(), input:text };
  if (source === 'kgc' && /^(?:collection_|gcid_)[a-z0-9_-]+$/i.test(text)) return { source, id:text.toLowerCase(), input:text };
  if (source) {
    const matches = [...text.matchAll(/(?:playlist(?:Id)?|disstid|specialid|pid|id)[=/:_-]+(\d{4,})/ig)];
    if (matches.length) return { source, id:matches[matches.length - 1][1], input:text };
  }
  throw new Error('无法识别链接；请选择平台并粘贴歌单分享链接，或直接输入数字歌单 ID');
}

function extractPlatformAlbumId(source, value) {
  const text = decodeHtmlEntities(String(value || ''));
  const sourcePatterns = {
    tx: [
      /(?:albumMid|albummid|albumId|albumid)["'\s:=/&?#-]+([a-z0-9_-]{4,})/i,
      /\/album(?:Detail)?\/([a-z0-9_-]{4,})/i,
    ],
    wy: [
      /\/album\/(\d{4,})/i,
      /album[^"'<>]*[?&#]id=(\d{4,})/i,
      /(?:albumId|album_id)["'\s:=/&?#-]+(\d{4,})/i,
    ],
    kw: [
      /\/album(?:_detail)?\/(\d{4,})/i,
      /(?:albumId|albumid)["'\s:=/&?#-]+(\d{4,})/i,
    ],
  };
  for (const pattern of sourcePatterns[source] || []) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return '';
}

function extractPlatformPlaylistId(source, value) {
  const text = decodeHtmlEntities(String(value || ''));
  const sourcePatterns = {
    tx: [
      /(?:disstid|playlistId|playlist_id|tid)["'\s:=/&?#-]+(\d{4,})/i,
      /\/playlist\/(\d{4,})/i,
      /\/playlist\.html[^"'<>]*[?&#](?:id|disstid)=(\d{4,})/i,
    ],
    wy: [
      /(?:playlistId|playlist_id|resourceId)["'\s:=/&?#-]+(\d{4,})/i,
      /\/playlist\/(\d{4,})/i,
      /playlist[^"'<>]*[?&#]id=(\d{4,})/i,
    ],
    kw: [
      /(?:playlistId|playlist_id|pid)["'\s:=/&?#-]+(\d{4,})/i,
      /\/playlist(?:_detail)?\/(\d{4,})/i,
    ],
  };
  for (const pattern of sourcePatterns[source] || []) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return '';
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function extractHtmlRedirect(html, baseUrl) {
  const text = decodeHtmlEntities(html);
  const patterns = [
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*?url\s*=\s*([^"'>]+)["']/i,
    /<meta[^>]+content=["'][^"']*?url\s*=\s*([^"'>]+)["'][^>]+http-equiv=["']?refresh/i,
    /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
    /location\.(?:replace|assign)\(\s*["']([^"']+)["']\s*\)/i,
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const url = safeUrl(match[1].trim(), baseUrl);
      if (url) return url;
    }
  }
  return '';
}

async function requestShareStep(url, method = 'GET') {
  const headers = {
    'user-agent':'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
    Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    try {
      const response = await networkFetch(url, { method, redirect:'manual', signal:controller.signal, headers });
      const location = response.headers.get('location') || '';
      const body = method === 'HEAD' ? '' : await response.text();
      return { status:Number(response.status) || 0, location, body, responseUrl:response.url || url };
    } catch (_fetchError) {
      return await requestShareStepNative(url, method, headers);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function requestShareFollow(url, method = 'GET') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await networkFetch(url, {
      method,
      redirect:'follow',
      signal:controller.signal,
      headers:{
        'user-agent':'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
        Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    return {
      status:Number(response.status) || 0,
      body:method === 'HEAD' ? '' : await response.text(),
      responseUrl:response.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

function requestShareStepNative(url, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    const request = transport.request(target, { method, headers }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        if (method === 'HEAD' || size >= 2 * 1024 * 1024) return;
        size += chunk.length;
        if (size <= 2 * 1024 * 1024) chunks.push(chunk);
      });
      response.on('end', () => resolve({
        status:Number(response.statusCode) || 0,
        location:String(response.headers.location || ''),
        body:Buffer.concat(chunks).toString('utf8'),
        responseUrl:target.href,
      }));
    });
    request.setTimeout(12000, () => request.destroy(new Error('REQUEST_TIMEOUT')));
    request.on('error', reject);
    request.end();
  });
}

async function expandShareLinkDetailed(input) {
  const originalUrl = extractFirstUrl(input);
  if (!originalUrl) return { url:String(input || ''), html:'', chain:[] };
  let current = originalUrl;
  let html = '';
  const chain = [current];
  const visited = new Set();
  for (let index = 0; index < 8; index += 1) {
    if (visited.has(current)) break;
    visited.add(current);
    let step = null;
    try { step = await requestShareStep(current, 'HEAD'); } catch (_error) {}
    let location = step?.location ? safeUrl(step.location, current) : '';
    const knownShort = /(?:^|\.)(?:t1\.kugou\.com|c\.migu\.cn)$/i.test((() => { try { return new URL(current).hostname; } catch (_e) { return ''; } })());
    // Some Node/Electron builds do not expose Location on manual redirects.
    // Probe once with follow mode and use response.url as the canonical target.
    if (!location && knownShort) {
      try {
        const followed = await requestShareFollow(current, 'HEAD');
        if (followed.responseUrl && followed.responseUrl !== current) location = followed.responseUrl;
      } catch (_error) {}
    }
    if (!location) {
      try { step = await requestShareStep(current, 'GET'); } catch (_error) { step = null; }
      location = step?.location ? safeUrl(step.location, current) : '';
      html = step?.body || html;
      if (!location && html) location = extractHtmlRedirect(html, current) || extractJsonRedirect(html, current);
    }
    if (!location && knownShort) {
      try {
        const followed = await requestShareFollow(current, 'GET');
        html = followed.body || html;
        if (followed.responseUrl && followed.responseUrl !== current) location = followed.responseUrl;
        if (!location && html) location = extractHtmlRedirect(html, current) || extractJsonRedirect(html, current);
      } catch (_error) {}
    }
    if (location && location !== current) {
      current = location;
      chain.push(current);
      html = '';
      continue;
    }
    if (!knownShort || html) break;
  }
  return { url:current, html, chain };
}

async function expandShareLink(input) {
  const result = await expandShareLinkDetailed(input);
  return result.url || String(input || '');
}

async function importQQ(id) {
  const headers = { Origin:'https://y.qq.com', Referer:`https://y.qq.com/n/ryqq/playlist/${id}` };
  const rowKey = item => String(item && (item.mid || item.songmid || item.id || item.songid || item.songId) || '').trim()
    || stableImportKey([item?.title || item?.name || item?.songname, singerText(item?.singer), item?.album?.name || item?.albumname, item?.interval], 'tx');
  const normalizeRows = rows => (rows || []).map(item => item?.songInfo || item?.songinfo || item).filter(Boolean);
  const legacyPage = async (begin, count) => {
    const query = `type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=${encodeURIComponent(id)}&song_begin=${encodeURIComponent(begin)}&song_num=${encodeURIComponent(count)}&loginUin=0&hostUin=0&format=json&platform=yqq.json&needNewCode=0`;
    const urls = [
      `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?${query}`,
      `https://c6.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?${query}`,
      `https://i.y.qq.com/qzone-music/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?${query}`,
    ];
    for (const url of urls) {
      try {
        const data = await fetchJson(url, { headers, retryAttempts:1 });
        const list = data?.cdlist?.[0];
        if (list) {
          return {
            info:list,
            rows:normalizeRows(list.songlist || list.songList || []),
            total:Number(list.songnum || list.songNum || data.total_song_num || data.total || 0),
          };
        }
      } catch (_error) {}
    }
    return null;
  };
  const musicuPage = async (begin, count) => {
    const body = {
      comm:{ ct:24, cv:0 },
      req_0:{
        module:'music.srfDissInfo.aiDissInfo',
        method:'uniform_get_Dissinfo',
        param:{ disstid:Number(id), enc_host_uin:'', tag:1, userinfo:1, song_begin:begin, song_num:count },
      },
    };
    const data = await fetchJson('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method:'POST',
      retryAttempts:1,
      headers:{ ...headers, 'content-type':'application/json' },
      body:JSON.stringify(body),
    });
    const payload = data?.req_0?.data || {};
    const info = payload.dirinfo || payload.dissinfo || {};
    const rows = normalizeRows(payload.songlist || payload.songList || []);
    return { info, rows, total:Number(info.songnum || info.songNum || payload.total_song_num || payload.total || rows.length) };
  };

  const firstResults = await Promise.allSettled([legacyPage(0, 200), musicuPage(0, 200)]);
  const legacyFirst = firstResults[0].status === 'fulfilled' ? firstResults[0].value : null;
  const modernFirst = firstResults[1].status === 'fulfilled' ? firstResults[1].value : null;
  const baseInfo = legacyFirst?.info || modernFirst?.info || null;
  if (!baseInfo && !(legacyFirst?.rows?.length || modernFirst?.rows?.length)) throw new Error('小秋歌单读取失败');

  const rows = [];
  const seen = new Set();
  const addRows = pageRows => {
    let added = 0;
    for (const item of pageRows || []) {
      const key = rowKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(item);
      added += 1;
    }
    return added;
  };
  addRows(legacyFirst && legacyFirst.rows);
  addRows(modernFirst && modernFirst.rows);

  let total = Math.max(
    Number(legacyFirst && legacyFirst.total || 0),
    Number(modernFirst && modernFirst.total || 0),
    Number(baseInfo && (baseInfo.songnum || baseInfo.songNum) || 0),
    rows.length
  );
  // Older QQ endpoints often expose only the first 120 songs unless song_begin
  // and song_num are requested explicitly. Continue paging through both modern
  // and legacy endpoints and stop only after repeated stagnant pages or total is reached.
  let stagnantPages = 0;
  for (let begin = rows.length; begin < 30000 && (!total || seen.size < total); begin += 200) {
    const pageResults = await Promise.allSettled([
      musicuPage(begin, 200),
      legacyPage(begin, 200),
    ]);
    let added = 0;
    for (const result of pageResults) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      total = Math.max(total, Number(result.value.total || 0));
      added += addRows(result.value.rows);
    }
    stagnantPages = added ? 0 : stagnantPages + 1;
    if (stagnantPages >= 2) break;
    // Some endpoints return fewer rows than requested near the end; if there is
    // no trustworthy total, one stagnant page is enough to stop.
    if (!total && !added) break;
  }

  return {
    name:baseInfo.dissname || baseInfo.title || baseInfo.name || `小秋歌单 ${id}`,
    cover:baseInfo.logo || baseInfo.picurl || baseInfo.cover || '',
    songs:finalizeImportedSongs(rows.map(item => ({
      id:item.id || item.songid || item.songId,
      songmid:item.mid || item.songmid,
      name:item.title || item.name || item.songname || '',
      singer:singerText(item.singer),
      albumName:item.album?.name || item.albumname || '',
      albumId:item.album?.mid || item.albummid || '',
      albumMid:item.album?.mid || item.albummid || '',
      strMediaMid:item.file?.media_mid || item.strMediaMid || item.mid || item.songmid || '',
      picUrl:(item.album?.mid || item.albummid) ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.album?.mid || item.albummid}.jpg` : '',
      interval:durationText(item.interval),
      source:'tx',
      types:['flac','320k','128k'],
    })), 'tx'),
  };
}

async function importQQAlbum(id) {
  const albumId = String(id || '').trim();
  const headers = { Origin:'https://y.qq.com', Referer:`https://y.qq.com/n/ryqq/albumDetail/${albumId}` };
  const rows = [];
  let info = {};
  for (let begin = 0; begin < 3000; begin += 200) {
    const isNumeric = /^\d+$/.test(albumId);
    const body = {
      comm:{ ct:24, cv:0 },
      req_0:{
        module:'music.musichallAlbum.AlbumSongList',
        method:'GetAlbumSongList',
        param:{
          albumMid:isNumeric ? '' : albumId,
          albumID:isNumeric ? Number(albumId) : 0,
          begin,
          num:200,
          order:2,
        },
      },
    };
    const data = await fetchJson('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method:'POST',
      retryAttempts:2,
      headers:{ ...headers, 'content-type':'application/json' },
      body:JSON.stringify(body),
    });
    const payload = data?.req_0?.data || {};
    info = info && Object.keys(info).length ? info : (payload.album || payload.albumInfo || payload.info || {});
    const pageRows = (payload.songList || payload.songlist || payload.list || [])
      .map(item => item?.songInfo || item?.songinfo || item)
      .filter(Boolean);
    rows.push(...pageRows);
    const total = Number(payload.totalNum || payload.total || info.total || rows.length);
    if (!pageRows.length || (total && rows.length >= total)) break;
  }
  if (!rows.length) throw new Error('QQ album import failed');
  return {
    name:info.name || info.title || info.Falbum_name || `QQ Album ${albumId}`,
    cover:(info.mid || info.albumMid || albumId) ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${info.mid || info.albumMid || albumId}.jpg` : '',
    songs:finalizeImportedSongs(rows.map(item => ({
      id:item.id || item.songid || item.songId,
      songmid:item.mid || item.songmid,
      name:item.title || item.name || item.songname || '',
      singer:singerText(item.singer),
      albumName:item.album?.name || item.albumname || info.name || info.title || '',
      albumId:item.album?.mid || item.albummid || info.mid || info.albumMid || albumId,
      albumMid:item.album?.mid || item.albummid || info.mid || info.albumMid || albumId,
      strMediaMid:item.file?.media_mid || item.strMediaMid || item.mid || item.songmid || '',
      picUrl:(item.album?.mid || item.albummid || info.mid || info.albumMid || albumId) ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.album?.mid || item.albummid || info.mid || info.albumMid || albumId}.jpg` : '',
      interval:durationText(item.interval),
      source:'tx',
      types:['flac','320k','128k'],
    })), 'tx'),
  };
}

async function importWY(id) {
  const data = await fetchJson(`https://music.163.com/api/v6/playlist/detail?id=${id}&n=10000&s=0`, { headers:{ Referer:'https://music.163.com/' } });
  const list = data?.playlist || data?.result;
  if (!list) throw new Error('网易云歌单读取失败');
  const initialTracks = Array.isArray(list?.tracks) ? list.tracks : [];
  const trackIds = (list?.trackIds || []).map(item => String(item?.id || item)).filter(Boolean);
  const loadedIds = new Set(initialTracks.map(item => String(item?.id || '')));
  const missingIds = trackIds.filter(trackId => !loadedIds.has(trackId));
  const extraTracks = [];
  for (let offset = 0; offset < missingIds.length; offset += 500) {
    const ids = missingIds.slice(offset, offset + 500);
    const details = await fetchJson(
      `https://music.163.com/api/song/detail?ids=${encodeURIComponent(JSON.stringify(ids.map(Number)))}`,
      { headers:{ Referer:'https://music.163.com/' } }
    );
    extraTracks.push(...(details?.songs || []));
  }
  const byId = new Map([...initialTracks, ...extraTracks].map(item => [String(item.id), item]));
  const tracks = trackIds.length
    ? trackIds.map(trackId => byId.get(trackId) || { id:trackId, name:`网易云歌曲 ${trackId}`, ar:[], al:{} })
    : initialTracks;
  return {
    name:list.name || `小芸歌单 ${id}`, cover:list.coverImgUrl || '',
    songs:tracks.map(item => ({
      id:item.id, songmid:item.id, name:item.name || '', singer:singerText(item.ar || item.artists),
      albumName:(item.al || item.album)?.name || '', albumId:(item.al || item.album)?.id || '',
      picUrl:(item.al || item.album)?.picUrl || '', interval:durationText((item.dt || item.duration || 0) / 1000),
      source:'wy', types:['flac','320k','128k'],
    })),
  };
}

async function importWYAlbum(id) {
  const data = await fetchJson(`https://music.163.com/api/album/${encodeURIComponent(id)}`, { headers:{ Referer:'https://music.163.com/' } });
  const album = data?.album || {};
  const songs = Array.isArray(data?.songs) ? data.songs : (Array.isArray(album.songs) ? album.songs : []);
  if (!songs.length) throw new Error('Netease album import failed');
  return {
    name:album.name || `Netease Album ${id}`,
    cover:album.picUrl || '',
    songs:songs.map(item => ({
      id:item.id, songmid:item.id, name:item.name || '', singer:singerText(item.ar || item.artists),
      albumName:(item.al || item.album)?.name || album.name || '', albumId:(item.al || item.album)?.id || album.id || '',
      picUrl:(item.al || item.album)?.picUrl || album.picUrl || '', interval:durationText((item.dt || item.duration || 0) / 1000),
      source:'wy', types:['flac','320k','128k'],
    })),
  };
}

async function importKW(id) {
  const pageSize = 200;
  const makeUrl = page => `https://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${id}&pn=${page}&rn=${pageSize}&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1`;
  const data = await fetchJson(makeUrl(0));
  if (data?.result !== 'ok') throw new Error(`酷我歌单读取失败${data?.reason ? `：${data.reason}` : ''}`);
  const rows = [...(data.musiclist || [])];
  const total = Number(data.total || data.validtotal || rows.length);
  const seen = new Set(rows.map(item => String(item.musicrid || item.id || '').replace('MUSIC_', '') || stableImportKey([item.name || item.songname, item.artist, item.album, item.duration], 'kw')).filter(Boolean));
  let stagnantPages = 0;
  for (let page = 1; page < 300 && (!total || seen.size < total); page += 1) {
    const pageData = await fetchJson(makeUrl(page));
    const pageRows = pageData?.musiclist || [];
    if (!pageRows.length) break;
    let added = 0;
    for (const item of pageRows) {
      const key = String(item.musicrid || item.id || '').replace('MUSIC_', '') || stableImportKey([item.name || item.songname, item.artist, item.album, item.duration], 'kw');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(item);
      added += 1;
    }
    stagnantPages = added ? 0 : stagnantPages + 1;
    if (stagnantPages >= 2) break;
  }
  const musiclist = uniqueBy(rows, item => String(item.musicrid || item.id || '').replace('MUSIC_', '') || stableImportKey([item.name || item.songname, item.artist, item.album, item.duration], 'kw'));
  return {
    name:data.title || `小蜗歌单 ${id}`, cover:data.pic || '',
    songs:finalizeImportedSongs(musiclist.map(item => ({
      id:String(item.musicrid || item.id || '').replace('MUSIC_', ''),
      songmid:String(item.musicrid || item.id || '').replace('MUSIC_', ''),
      name:item.name || item.songname || '', singer:item.artist || '', albumName:item.album || '',
      albumId:item.albumid || '', interval:durationText(item.duration), source:'kw',
      types:['flac24bit','flac','320k','128k'],
    })), 'kw'),
  };
}

async function importKWAlbum(id) {
  const url = `https://search.kuwo.cn/r.s?stype=albuminfo&albumid=${encodeURIComponent(id)}&show_copyright_off=1&alflac=1&vipver=MUSIC_9.0.5.0_W1&encoding=utf8`;
  const data = await fetchJson(url, { headers:{ Referer:'https://www.kuwo.cn/' } });
  const rows = data.musiclist || data.songlist || data.songs || data.musicList || [];
  if (!Array.isArray(rows) || !rows.length) throw new Error('Kuwo album import failed');
  return {
    name:data.title || data.album || data.name || `Kuwo Album ${id}`,
    cover:data.pic || data.img || data.cover || '',
    songs:finalizeImportedSongs(rows.map(item => ({
      id:String(item.musicrid || item.id || item.rid || '').replace('MUSIC_', ''),
      songmid:String(item.musicrid || item.id || item.rid || '').replace('MUSIC_', ''),
      name:item.name || item.songname || '', singer:item.artist || item.singer || '', albumName:item.album || data.title || '',
      albumId:item.albumid || id, interval:durationText(item.duration), source:'kw',
      types:['flac24bit','flac','320k','128k'],
    })), 'kw'),
  };
}

const KUGOU_GATEWAY_SIGN_KEY = 'OIlwieks28dk2k092lksi2UIkp';
const KUGOU_PLAYLIST_SIGN_KEY = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';

function kugouSignatureForParams(params, secret = KUGOU_GATEWAY_SIGN_KEY, body = '') {
  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (String(key).toLowerCase() === 'signature') continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  return crypto.createHash('md5').update(`${secret}${pairs.join('')}${body}${secret}`).digest('hex');
}

function buildSignedKugouUrl(base, values, secret = KUGOU_GATEWAY_SIGN_KEY, body = '') {
  const url = new URL(base);
  Object.entries(values || {}).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  });
  url.searchParams.set('signature', kugouSignatureForParams(url.searchParams, secret, body));
  return url.href;
}

function buildSignedKugouUrlIncludingEmpty(base, values, secret = KUGOU_GATEWAY_SIGN_KEY, body = '') {
  const url = new URL(base);
  Object.entries(values || {}).forEach(([key, value]) => {
    if (value != null) url.searchParams.set(key, String(value));
  });
  url.searchParams.set('signature', kugouSignatureForParams(url.searchParams, secret, body));
  return url.href;
}

function kugouAndroidBaseParams(extra = {}, clientver = 20489) {
  const dfid = '-';
  const deviceId = crypto.createHash('md5').update(dfid).digest('hex');
  return {
    token:'', userid:'0', appid:1005, clientver,
    dfid, mid:deviceId, uuid:deviceId,
    clienttime:String(Math.floor(Date.now() / 1000)),
    ...extra,
  };
}

async function decodeKugouGCIDVariant(gcid, idType, clientver = 20489) {
  const body = JSON.stringify({ ret_info:1, data:[{ id:String(gcid), id_type:idType }] });
  const values = kugouAndroidBaseParams({}, clientver);
  const endpoints = [
    'https://t.kugou.com/v1/songlist/batch_decode',
    'http://t.kugou.com/v1/songlist/batch_decode',
  ];
  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const url = buildSignedKugouUrlIncludingEmpty(endpoint, values, KUGOU_GATEWAY_SIGN_KEY, body);
      const payload = await fetchJson(url, {
        method:'POST',
        headers:{
          'content-type':'application/json',
          'user-agent':'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile Safari/537.36',
          referer:'https://m.kugou.com/',
        },
        body,
      });
      const decoded = payload?.data?.list?.[0] || {};
      const value = String(decoded.global_collection_id || decoded.global_specialid || decoded?.info?.global_specialid || decoded?.info?.specialid || '');
      if (value) return value;
    } catch (error) { lastError = error; }
  }
  if (lastError) throw lastError;
  return '';
}

async function fetchKugouGlobalNoFilterRows(globalId) {
  const rows = [];
  const seen = new Set();
  let total = 0;
  const pageSize = 100;
  for (let page = 0; page < 500; page += 1) {
    const values = kugouAndroidBaseParams({
      global_collection_id:globalId,
      pagesize:pageSize,
      plat:1,
      type:1,
      mode:1,
      area_code:1,
      begin_idx:page * pageSize,
    });
    const url = buildSignedKugouUrlIncludingEmpty(
      'https://gateway.kugou.com/pubsongs/v2/get_other_list_file_nofilt',
      values,
      KUGOU_GATEWAY_SIGN_KEY,
    );
    let payload;
    try {
      payload = await fetchJson(url, { headers:{
        'user-agent':'Android13-AndroidPhone-20489-18-0-playlist-wifi',
        'x-router':'pubsongs.kugou.com',
        dfid:String(values.dfid), mid:String(values.mid), clienttime:String(values.clienttime),
        referer:'https://m.kugou.com/',
      } });
    } catch (_error) { break; }
    const data = payload?.data || {};
    const pageRows = Array.isArray(data.songs) ? data.songs : kugouRowsFromPayload(payload);
    if (!pageRows.length) break;
    total = Math.max(total, Number(data.count || data.total || payload?.count || payload?.total || 0));
    let added = 0;
    for (const item of pageRows) {
      const key = kugouRowKey(item, rows.length + added);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(item);
      added += 1;
    }
    if (!added) break;
    if (total && rows.length >= total) break;
    if (!total && pageRows.length < pageSize) break;
  }
  return { rows, total };
}

async function fetchKugouGlobalInfoGateway(globalId) {
  const body = JSON.stringify({ data:[{ global_collection_id:globalId }], userid:'0', token:'' });
  const values = kugouAndroidBaseParams({}, 20489);
  const url = buildSignedKugouUrlIncludingEmpty('https://gateway.kugou.com/v3/get_list_info', values, KUGOU_GATEWAY_SIGN_KEY, body);
  try {
    const payload = await fetchJson(url, {
      method:'POST',
      headers:{
        'content-type':'application/json',
        'x-router':'pubsongs.kugou.com',
        'user-agent':'Android13-AndroidPhone-20489-18-0-playlist-wifi',
        dfid:String(values.dfid), mid:String(values.mid), clienttime:String(values.clienttime),
      },
      body,
    });
    const info = payload?.data?.[0] || payload?.data || {};
    return info && typeof info === 'object' ? info : {};
  } catch (_error) {
    return {};
  }
}

function kugouPlaylistSignature(url) {
  const parsed = new URL(url);
  return kugouSignatureForParams(parsed.searchParams, KUGOU_GATEWAY_SIGN_KEY, '');
}

function kugouRowsFromPayload(payload) {
  const data = payload?.data || {};
  const candidates = [data.info, data.songs, data.list, data.data, payload?.info, payload?.songs];
  return candidates.find(Array.isArray) || [];
}

function kugouRowKey(item, index) {
  return String(item?.audio_id || item?.audioid || item?.rp_id || item?.album_audio_id || item?.album_audioid || item?.id || item?.hash || item?.HASH || item?.FileHash || '')
    || stableImportKey([
      item?.songname || item?.SongName || item?.song_name || item?.audio_name || item?.AudioName || item?.name || item?.filename || item?.FileName,
      item?.singername || item?.SingerName || item?.author_name || item?.AuthorName || item?.authorName || singerText(item?.singerinfo || item?.authors),
      item?.album_name || item?.AlbumName || item?.albumname,
      item?.duration || item?.Duration || item?.timelength || item?.timelen || item?.time_length,
    ], 'kg');
}

function mapKugouSongs(rows) {
  return (rows || []).map((item, index) => {
    const singer = item.singername || item.SingerName || item.author_name || item.AuthorName || item.authorName || singerText(item.singerinfo || item.authors)
      || String(item.filename || item.name || '').split(' - ')[0] || '';
    let name = item.songname || item.SongName || item.song_name || item.audio_name || item.AudioName || item.ori_audio_name || item.OriSongName || item.name || String(item.filename || item.FileName || '').split(' - ').slice(1).join(' - ');
    if (singer && name.startsWith(`${singer} - `)) name = name.slice(singer.length + 3);
    const hash = item.hash || item.HASH || item.FileHash || item.file_hash || item.audio_info?.hash || item.audio_info?.hash_128 || '';
    const strongId = item.audio_id || item.audioid || item.rp_id || item.album_audio_id || item.album_audioid || item.id || hash;
    const id = strongId ||
      stableImportKey([name, singer, item.album_name || item.AlbumName || item.albumname, item.duration || item.Duration || item.timelength], 'kg');
    return {
      id, songmid:id, name, singer,
      importFallbackId:!strongId,
      albumName:item.album_name || item.AlbumName || item.albumname || item.albuminfo?.name || '',
      albumId:item.album_id || item.AlbumID || item.albumid || item.albuminfo?.id || '',
      hash,
      picUrl:String(item.img || item.Image || item.image || item.cover || item.trans_param?.union_cover || item.album_info?.sizable_cover || '').replace('{size}', '400'),
      interval:durationText(item.duration || item.Duration || (item.timelength || item.timelen || item.time_length || 0) / 1000),
      source:'kg', types:['flac','320k','128k'],
    };
  }).filter(song => song.name && song.songmid);
}

async function importKugouPagedRows(specialId) {
  const rows = [];
  const seen = new Set();
  let firstPayload = null;
  let total = 0;
  const pageSize = 300;
  // The server may silently cap each response at 10 songs even when pagesize is
  // much larger. Do not treat a short page as the end; continue until total is
  // reached, an empty page arrives, or a page contains no new songs.
  for (let page = 1; page <= 500; page += 1) {
    const values = {
      specialid:specialId, need_sort:1, module:'CloudMusic', clientver:11239,
      pagesize:pageSize, specalidpgc:specialId, userid:0, page, type:0,
      area_code:1, appid:1005,
    };
    const url = buildSignedKugouUrl('https://gatewayretry.kugou.com/v2/get_other_list_file', values);
    let payload;
    try {
      payload = await fetchJson(url, { headers:{
        'user-agent':'Android9-AndroidPhone-11239-18-0-playlist-wifi',
        'x-router':'pubsongscdn.kugou.com', mid:'239526275778893399526700786998289824956',
        dfid:'-', clienttime:String(Math.floor(Date.now() / 1000)), referer:'https://www.kugou.com/',
      } });
    } catch (_error) { break; }
    if (!firstPayload) firstPayload = payload;
    const pageRows = kugouRowsFromPayload(payload);
    if (!pageRows.length) break;
    total = Math.max(total, Number(payload?.data?.count || payload?.data?.total || 0));
    let added = 0;
    for (const item of pageRows) {
      const key = kugouRowKey(item, rows.length + added);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(item);
      added += 1;
    }
    if (!added) break;
    if (total && rows.length >= total) break;
  }
  return { rows, payload:firstPayload, total };
}

async function decodeKugouGCID(gcid) {
  gcid = String(gcid || '').trim();
  if (!/^gcid_[a-z0-9]+$/i.test(gcid)) return '';
  const attempts = [
    // Newer public songlist/gcid links use id_type "1" with current Android parameters.
    [gcid, '1', 20489],
    [gcid, 1, 20489],
    // Keep compatibility with older links and existing clients.
    [gcid.toLowerCase(), 2, 20109],
    [gcid.toLowerCase(), '2', 20489],
  ];
  let lastError = null;
  for (const [value, idType, clientver] of attempts) {
    try {
      const decoded = await decodeKugouGCIDVariant(value, idType, clientver);
      if (decoded) return decoded;
    } catch (error) { lastError = error; }
  }
  if (lastError) throw lastError;
  return '';
}

function normalizeKugouChain(value) {
  const chain = String(value || '').trim().replace(/^gcid_/i, '');
  return /^[a-z0-9]+$/i.test(chain) ? chain : '';
}

async function fetchKugouChainTransfer(chain) {
  chain = normalizeKugouChain(chain);
  if (!chain) throw new Error('INVALID_KUGOU_CHAIN');
  const query = `pagesize=10000&chain=${encodeURIComponent(chain)}&su=1&page=1&n=${Math.random()}`;
  let lastError = null;
  for (const base of ['https://m.kugou.com/schain/transfer', 'http://m.kugou.com/schain/transfer']) {
    try {
      const payload = await fetchJson(`${base}?${query}`, { headers:{
        'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 Version/13.0.3 Mobile/15E148 Safari/604.1',
        referer:'https://m.kugou.com/',
      } });
      const info = payload?.info || payload?.data?.info || payload?.data || {};
      const rows = info?.list || payload?.list || payload?.data?.list || [];
      return {
        globalId:String(info.global_collection_id || info.global_specialid || payload?.global_collection_id || payload?.data?.global_collection_id || ''),
        specialId:String(info.id || info.specialid || info.special_id || payload?.data?.specialid || ''),
        total:Number(info.count || info.songcount || payload?.data?.count || payload?.count || 0),
        rows:Array.isArray(rows) ? rows : [],
        name:info?.info?.name || info.specialname || info.name || '',
        cover:info?.info?.img || info.imgurl || info.img || '',
      };
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('KUGOU_CHAIN_TRANSFER_FAILED');
}

async function fetchKugouChainShare(chain) {
  chain = normalizeKugouChain(chain);
  if (!chain) throw new Error('INVALID_KUGOU_CHAIN');
  let name = '';
  let cover = '';
  try {
    const metaHtml = await fetchText(`https://m.kugou.com/share/?chain=${encodeURIComponent(chain)}&id=${encodeURIComponent(chain)}`, {
      headers:{ 'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' },
    });
    const match = /var\s+phpParam\s*=\s*({[\s\S]+?});/.exec(metaHtml);
    if (match) {
      try {
        const meta = JSON.parse(match[1]);
        name = meta.specialname || meta.name || '';
        cover = meta.imgurl || meta.img || '';
      } catch (_error) {}
    }
  } catch (_error) {}
  let rows = [];
  try {
    const html = await fetchText(`http://www.kugou.com/share/${encodeURIComponent(chain)}.html`, {
      headers:{ 'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' },
    });
    rows = parseAssignedJson(html, 'var dataFromSmarty') || parseAssignedJson(html, 'dataFromSmarty') || [];
  } catch (_error) {}
  return { name, cover, rows:Array.isArray(rows) ? rows : [] };
}

function kugouWebQuery(extra = {}) {
  const stamp = String(Date.now());
  return { appid:1058, srcappid:2919, clientver:20000, clienttime:stamp, mid:stamp, uuid:stamp, dfid:'-', ...extra };
}

async function fetchKugouGlobalRows(globalId) {
  const rows = [];
  const seen = new Set();
  let firstPayload = null;
  let total = 0;
  const pageSize = 300;
  for (let page = 1; page <= 500; page += 1) {
    const url = buildSignedKugouUrl('https://mobiles.kugou.com/api/v5/special/song_v2', kugouWebQuery({
      global_specialid:globalId, specialid:0, plat:0, version:8000, page, pagesize:pageSize,
    }), KUGOU_PLAYLIST_SIGN_KEY);
    let payload;
    try {
      payload = await fetchJson(url, { headers:{
        'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 Mobile/15A372 Safari/604.1',
        referer:'https://m3ws.kugou.com/share/index.php',
      } });
    } catch (_error) { break; }
    if (!firstPayload) firstPayload = payload;
    const pageRows = kugouRowsFromPayload(payload);
    if (!pageRows.length) break;
    total = Math.max(total, Number(payload?.data?.total || payload?.data?.count || 0));
    let added = 0;
    for (const item of pageRows) {
      const key = kugouRowKey(item, rows.length + added);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(item);
      added += 1;
    }
    if (!added) break;
    if (total && rows.length >= total) break;
  }
  return { rows, payload:firstPayload, total };
}

async function fetchKugouGlobalLegacyRows(globalId) {
  const rows = [];
  const seen = new Set();
  let total = 0;
  const pageSize = 500;
  for (let page = 1; page <= 500; page += 1) {
    const url = buildSignedKugouUrl('https://pubsongscdn.kugou.com/v2/get_other_list_file', {
      need_sort:1, module:'CloudMusic', clientver:11589, pagesize:pageSize, page,
      global_collection_id:globalId, userid:0, type:0, area_code:1, appid:1005,
    }, KUGOU_GATEWAY_SIGN_KEY);
    let payload;
    try {
      payload = await fetchJson(url, { headers:{
        'user-agent':'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Mobile Safari/537.36',
        referer:'https://m3ws.kugou.com/share/index.php', dfid:'-',
      } });
    } catch (_error) { break; }
    const pageRows = kugouRowsFromPayload(payload);
    if (!pageRows.length) break;
    total = Math.max(total, Number(payload?.data?.total || payload?.data?.count || payload?.total || payload?.count || 0));
    let added = 0;
    for (const item of pageRows) {
      const key = kugouRowKey(item, rows.length + added);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(item);
      added += 1;
    }
    if (!added) break;
    if (total && rows.length >= total) break;
  }
  return rows;
}


async function resolveKugouGlobalSpecialID(specialId) {
  if (!/^\d+$/.test(String(specialId || ''))) return '';
  try {
    const payload = await fetchJson(`http://mobilecdnbj.kugou.com/api/v5/special/info?specialid=${encodeURIComponent(specialId)}`, {
      headers:{ 'user-agent':'Mozilla/5.0' },
    });
    return String(payload?.data?.global_specialid || payload?.data?.global_collection_id || '');
  } catch (_error) {
    return '';
  }
}

async function requestKugouLiteFallback(action, params = {}) {
  let lastError = null;
  for (const base of ['https://api.vsaa.cn/api/music.kugou.lite', 'http://api.vsaa.cn/api/music.kugou.lite']) {
    try {
      const url = new URL(base);
      url.searchParams.set('act', action);
      Object.entries(params).forEach(([key, value]) => {
        if (value != null && value !== '') url.searchParams.set(key, String(value));
      });
      return await fetchJson(url.href, { headers:{ Accept:'application/json, text/plain, */*' } });
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('KUGOU_LITE_FALLBACK_FAILED');
}

async function importKugouConceptFallback(globalId) {
  let detail = {};
  try {
    const detailPayload = await requestKugouLiteFallback('playlist.detail', { ids:globalId });
    detail = detailPayload?.data?.[0] || detailPayload?.data || {};
  } catch (_error) {}
  const rows = [];
  const seen = new Set();
  let total = 0;
  const pageSize = 300;
  for (let page = 1; page <= 500; page += 1) {
    let payload;
    try {
      payload = await requestKugouLiteFallback('playlist.track.all', { id:globalId, page, pagesize:pageSize });
    } catch (_error) { break; }
    const data = payload?.data || {};
    const pageRows = data.songs || data.info || data.list || [];
    if (!Array.isArray(pageRows) || !pageRows.length) break;
    total = Math.max(total, Number(data.count || data.total || payload?.count || payload?.total || 0));
    let added = 0;
    for (const item of pageRows) {
      const key = kugouRowKey(item, rows.length + added);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(item);
      added += 1;
    }
    if (!added) break;
    if (total && rows.length >= total) break;
  }
  const songs = mapKugouSongs(rows);
  if (!songs.length) throw new Error('小枸概念版备用接口也没有返回歌曲');
  return {
    name:detail.specialname || detail.name || detail.title || `小枸概念版歌单 ${globalId}`,
    cover:String(detail.img || detail.imgurl || detail.cover || '').replace('{size}', '400'),
    songs,
  };
}

async function resolveKugouConceptIdentity(id, originalInput, context = {}) {
  let identity = String(id || '').trim();
  const sourceUrl = context.resolvedUrl || extractFirstUrl(originalInput) || (identity.startsWith('url:') ? identity.slice(4) : '');
  const texts = [identity, originalInput, context.resolvedUrl, ...(context.redirectChain || []), context.html].filter(Boolean);
  for (const text of texts) {
    const found = extractKugouConceptIdentity(text);
    if (found && !found.startsWith('url:')) { identity = found; break; }
  }
  if (identity.startsWith('url:') || !identity) identity = '';
  if (/^gcid_/i.test(identity)) {
    try { identity = await decodeKugouGCID(identity) || identity; } catch (_error) {}
  }
  if (/^\d+$/.test(identity)) {
    const resolved = await resolveKugouGlobalSpecialID(identity);
    if (resolved) identity = resolved;
  }
  if ((!identity || /^gcid_/i.test(identity)) && sourceUrl) {
    let html = String(context.html || '');
    if (!html) {
      try { html = await fetchText(sourceUrl, { headers:{ Referer:'https://m.kugou.com/' } }); } catch (_error) {}
    }
    if (html) {
      let payload = null;
      try { payload = JSON.parse(html.trim().replace(/^\uFEFF/, '')); } catch (_error) {}
      const payloadIdentity = payload ? findKugouConceptIdentityInPayload(payload) : '';
      const htmlIdentity = payloadIdentity || extractKugouConceptIdentity(html);
      if (htmlIdentity && !htmlIdentity.startsWith('url:')) identity = htmlIdentity;
    }
  }
  if (/^gcid_/i.test(identity)) {
    try { identity = await decodeKugouGCID(identity) || identity; } catch (_error) {}
  }
  if (/^\d+$/.test(identity)) {
    const resolved = await resolveKugouGlobalSpecialID(identity);
    if (resolved) identity = resolved;
  }
  return identity;
}

async function importKGC(id, originalInput, context = {}) {
  const identity = await resolveKugouConceptIdentity(id, originalInput, context);
  if (!identity || /^gcid_/i.test(identity) || identity.startsWith('url:')) {
    const body = String(context.html || '').trim();
    if (/"data"\s*:\s*null/i.test(body)) {
      throw new Error('该小枸概念版短链接已返回 data:null，链接本身没有歌单编号；请重新生成公开分享链接，或直接粘贴 collection_ 开头的歌单编号');
    }
    throw new Error('没有取得小枸概念版歌单编号；请粘贴有效的小枸概念版公开分享链接，或直接输入 collection_ 开头的歌单编号');
  }
  try {
    return await importKugouGlobalCollection(identity, { label:'小枸概念版歌单' });
  } catch (officialError) {
    try { return await importKugouConceptFallback(identity); }
    catch (fallbackError) {
      throw new Error(`小枸概念版歌单读取失败：${officialError.message || officialError}；备用接口：${fallbackError.message || fallbackError}`);
    }
  }
}

async function importKugouGlobalCollection(globalId, options = {}) {
  const label = String(options.label || '小枸歌单');
  let info = await fetchKugouGlobalInfoGateway(globalId);
  if (!info || !Object.keys(info).length) {
    try {
      const infoUrl = buildSignedKugouUrl('https://mobiles.kugou.com/api/v5/special/info_v2', kugouWebQuery({
        specialid:0, global_specialid:globalId, format:'json',
      }), KUGOU_PLAYLIST_SIGN_KEY);
      const infoPayload = await fetchJson(infoUrl, { headers:{
        'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 Mobile/15A372 Safari/604.1',
        referer:'https://m3ws.kugou.com/share/index.php',
      } });
      info = infoPayload?.data || {};
    } catch (_error) {}
  }

  // New no-filter endpoint is the primary path for songlist/gcid shares.
  // Merge older endpoints as fallbacks because different regions/accounts can
  // expose different subsets.
  const noFilter = await fetchKugouGlobalNoFilterRows(globalId);
  const noFilterRows = noFilter.rows || [];
  const noFilterComplete = noFilterRows.length > 0 && (!noFilter.total || noFilterRows.length >= noFilter.total);
  const paged = noFilterComplete ? { rows:[], total:0 } : await fetchKugouGlobalRows(globalId);
  let legacyRows = [];
  const knownTotal = Math.max(Number(noFilter.total || 0), Number(paged.total || 0), Number(info.count || info.total || info.song_count || 0));
  const combinedBeforeLegacy = uniqueBy([...(noFilter.rows || []), ...(paged.rows || [])],
    item => item.audio_id || item.album_audio_id || item.id || item.hash || item.HASH || item.FileHash);
  if (!combinedBeforeLegacy.length || (knownTotal && combinedBeforeLegacy.length < knownTotal)) {
    legacyRows = await fetchKugouGlobalLegacyRows(globalId);
  }
  const rows = uniqueBy([
    ...(noFilter.rows || []),
    ...(paged.rows || []),
    ...legacyRows,
  ], item => item.audio_id || item.album_audio_id || item.id || item.hash || item.HASH || item.FileHash);
  const songs = mapKugouSongs(rows);
  if (!songs.length) throw new Error(`${label}读取失败；服务器未返回公开歌曲数据`);
  return {
    name:info.specialname || info.name || info.title || `${label} ${globalId}`,
    cover:String(info.imgurl || info.pic || info.cover || info.image || '').replace('{size}', '400'),
    songs,
  };
}

async function importKG(id, originalInput, context = {}) {
  let identity = String(id || '').trim();
  const sourceUrl = context.resolvedUrl || extractFirstUrl(originalInput) || (identity.startsWith('url:') ? identity.slice(4) : '');
  const isNormalSonglistUrl = /(?:^|\.)kugou\.(?:com|cn)\/songlist\/gcid_/i.test(sourceUrl || extractFirstUrl(originalInput) || '');
  let html = String(context.html || '');
  if (identity.startsWith('url:')) identity = '';
  if ((!identity || !/^(?:\d+|gcid_|collection_)/i.test(identity)) && sourceUrl) {
    if (!html) {
      try { html = await fetchText(sourceUrl, { headers:{ Referer:'https://www.kugou.com/' } }); } catch (_error) {}
    }
    identity = extractKugouPlaylistIdentity(`${sourceUrl}\n${html}`);
    if (identity.startsWith('url:')) identity = '';
  }
  if (/^gcid_/i.test(identity)) {
    try {
      const decoded = await decodeKugouGCID(identity);
      if (decoded) identity = decoded;
    } catch (_error) {}
  }
  if (/^collection_/i.test(identity)) return importKugouGlobalCollection(identity, { label:'小枸歌单' });

  let sharedInfo = null;
  let embeddedRows = [];
  if (html) {
    const output = parseAssignedObject(html, 'window.$output')
      || parseAssignedObject(html, 'window.__INITIAL_STATE__')
      || parseAssignedObject(html, '__NEXT_DATA__');
    if (output) sharedInfo = output?.info || output?.data?.info || output?.data || output;

    // New Kugou links use gcid_ even for ordinary Kugou playlists. If the
    // decode API fails, prefer a stronger identity exposed by the page itself.
    const htmlIdentity = extractKugouPlaylistIdentity(html);
    if (htmlIdentity && !String(htmlIdentity).startsWith('url:') && (!identity || /^gcid_/i.test(identity))) {
      identity = htmlIdentity;
      if (/^gcid_/i.test(identity)) {
        try { identity = await decodeKugouGCID(identity) || identity; } catch (_error) {}
      }
      if (/^collection_/i.test(identity)) return importKugouGlobalCollection(identity, { label:'小枸歌单' });
    }

    // Some public m.kugou.com/songlist pages already embed the complete list.
    // Import it directly instead of incorrectly treating every gcid_ as a
    // concept-edition-only link.
    const previewRows = sharedInfo?.songs || sharedInfo?.songlist || sharedInfo?.list || sharedInfo?.data?.songs || [];
    embeddedRows = Array.isArray(previewRows) ? previewRows : [];
  }
  if (!/^\d+$/.test(identity)) {
    // New ordinary Xiaogou shares use songlist/gcid_* and often expose only
    // ten preview rows. Reuse the global collection resolver and Lite API
    // before reporting failure instead of requiring a legacy numeric ID.
    if (isNormalSonglistUrl || /^gcid_/i.test(identity)) {
      const candidates = [];
      const addCandidate = value => {
        value = String(value || '').trim();
        if (value && !candidates.includes(value)) candidates.push(value);
      };
      addCandidate(identity);
      if (/^gcid_/i.test(identity)) addCandidate(identity.replace(/^gcid_/i, ''));
      try {
        const parsed = sourceUrl ? new URL(sourceUrl) : null;
        if (parsed) {
          addCandidate(parsed.searchParams.get('src_cid'));
          addCandidate(parsed.searchParams.get('gcid'));
          addCandidate(parsed.searchParams.get('global_collection_id'));
          addCandidate(parsed.searchParams.get('global_specialid'));
        }
      } catch (_error) {}

      // New ordinary shares expose a short chain in both gcid_* and src_cid.
      // The schain transfer endpoint can return a global collection ID, legacy
      // special ID, or the complete hash list. Try it before third-party fallbacks.
      const chainCandidates = [];
      const addChain = value => {
        const chain = normalizeKugouChain(value);
        if (chain && !chainCandidates.includes(chain)) chainCandidates.push(chain);
      };
      addChain(identity);
      try {
        const parsed = sourceUrl ? new URL(sourceUrl) : null;
        if (parsed) {
          addChain(parsed.searchParams.get('src_cid'));
          addChain(parsed.searchParams.get('chain'));
          addChain(parsed.pathname.match(/songlist\/(gcid_[a-z0-9]+)/i)?.[1]);
        }
      } catch (_error) {}

      for (const chain of chainCandidates) {
        try {
          const transfer = await fetchKugouChainTransfer(chain);
          if (transfer.globalId) return await importKugouGlobalCollection(transfer.globalId, { label:'小枸歌单' });
          if (/^\d+$/.test(transfer.specialId)) {
            const paged = await importKugouPagedRows(transfer.specialId);
            const merged = uniqueBy([...(paged.rows || []), ...(transfer.rows || []), ...embeddedRows], item =>
              item.audio_id || item.audioid || item.rp_id || item.album_audio_id || item.album_audioid || item.id || item.hash || item.HASH || item.FileHash
            );
            const songs = mapKugouSongs(merged);
            if (songs.length) return {
              name:transfer.name || `小枸歌单 ${transfer.specialId}`,
              cover:String(transfer.cover || '').replace('{size}', '400'),
              songs,
            };
          }
          if (transfer.rows.length && transfer.total > 0 && transfer.rows.length >= transfer.total) {
            const songs = mapKugouSongs(transfer.rows);
            if (songs.length) return {
              name:transfer.name || `小枸歌单 ${chain}`,
              cover:String(transfer.cover || '').replace('{size}', '400'),
              songs,
            };
          }
        } catch (_transferError) {}

        try {
          const shared = await fetchKugouChainShare(chain);
          if (shared.rows.length > 10 && (!shared.total || shared.rows.length >= shared.total)) {
            const songs = mapKugouSongs(shared.rows);
            if (songs.length) return {
              name:shared.name || `小枸歌单 ${chain}`,
              cover:String(shared.cover || '').replace('{size}', '400'),
              songs,
            };
          }
        } catch (_shareError) {}
      }

      try {
        const resolved = await resolveKugouConceptIdentity(identity, originalInput, context);
        if (resolved && !/^gcid_/i.test(resolved) && !String(resolved).startsWith('url:')) {
          try {
            return await importKugouGlobalCollection(resolved, { label:'小枸歌单' });
          } catch (_officialError) {
            const fallback = await importKugouConceptFallback(resolved);
            if (fallback && fallback.name) fallback.name = fallback.name.replace(/^小枸概念版歌单/, '小枸歌单');
            return fallback;
          }
        }
      } catch (_resolveError) {}

      for (const candidate of candidates) {
        try {
          const fallback = await importKugouConceptFallback(candidate);
          if (fallback && fallback.name) fallback.name = fallback.name.replace(/^小枸概念版歌单/, '小枸歌单');
          return fallback;
        } catch (_fallbackError) {}
      }

      if (embeddedRows.length) {
        const listInfo = sharedInfo?.listinfo || sharedInfo?.special_info || sharedInfo?.playlist || {};
        const embeddedTotal = Number(listInfo.count || listInfo.total || sharedInfo?.count || sharedInfo?.total || 0);
        if (!embeddedTotal || embeddedRows.length >= embeddedTotal) {
          return {
            name:listInfo.name || listInfo.specialname || sharedInfo?.name || sharedInfo?.specialname || `小枸歌单 ${identity || ''}`.trim(),
            cover:String(listInfo.pic || listInfo.imgurl || listInfo.img || sharedInfo?.pic || sharedInfo?.imgurl || '').replace('{size}', '400'),
            songs:mapKugouSongs(embeddedRows),
          };
        }
      }
      throw new Error('小枸歌单已识别，但服务器未返回完整歌曲列表；为避免只导入预览歌曲，本次没有保存不完整结果');
    }
    throw new Error('该链接不是可读取的普通小枸歌单；概念版歌单请切换到“小枸概念版”入口');
  }

  let detailHtml = '';
  let detailRows = [];
  try {
    detailHtml = await fetchText(`https://www.kugou.com/yy/special/single/${identity}.html`, { headers:{ Referer:'https://www.kugou.com/' } });
    detailRows = parseAssignedJson(detailHtml, 'var data=') || [];
  } catch (_error) {}
  const paged = await importKugouPagedRows(identity);
  const rows = uniqueBy([...(paged.rows || []), ...embeddedRows, ...detailRows], item =>
    item.audio_id || item.audioid || item.rp_id || item.album_audio_id || item.album_audioid || item.id || item.hash || item.HASH || item.FileHash
  );
  const info = sharedInfo?.listinfo || paged?.payload?.data?.listinfo || paged?.payload?.data?.special_info || {};
  const songs = mapKugouSongs(rows);
  if (!songs.length) throw new Error('小狗歌单读取失败');
  return {
    name:info.name || info.specialname || detailHtml.match(/<title>([^<]+)/i)?.[1]?.replace(/_酷狗音乐.*$/i, '') || `小枸歌单 ${identity}`,
    cover:String(info.pic || info.imgurl || info.img || '').replace('{size}', '400'),
    songs,
  };
}

function miguRows(payload) {
  const data = payload?.data || {};
  const rows = data.songList || data.contentItemList || data.items || data.list || data.records || data.result ||
    data.songs || data.musicList || payload?.songList || payload?.contentItemList || payload?.items ||
    payload?.songs || payload?.list || payload?.records || [];
  return (Array.isArray(rows) ? rows : []).map(item => item?.objectInfo || item?.song || item?.music || item).filter(Boolean);
}

function miguSongId(item) {
  return String(
    item?.contentId || item?.songId || item?.copyrightId || item?.resourceId ||
    item?.musicId || item?.id || item?.songID || item?.song_id || item?.cid || ''
  ).trim();
}

function miguSongName(item) {
  return String(item?.name || item?.songName || item?.title || item?.contentName || item?.musicName || item?.song_name || '').trim();
}

function miguSongSinger(item) {
  return singerText(item?.singerList || item?.singers || item?.singer || item?.artists || item?.artist || item?.singerName || item?.artistName);
}

function miguSongKey(item, index) {
  const strong = miguSongId(item);
  if (strong) return 'id:' + strong;
  const weak = [
    miguSongName(item).toLowerCase(),
    miguSongSinger(item).toLowerCase(),
    String(item?.album || item?.albumName || item?.albums?.[0]?.name || '').toLowerCase(),
    String(item?.duration || item?.length || item?.totalTime || ''),
  ].join('|').replace(/\s+/g, ' ').trim();
  return weak.replace(/\|+$/g, '') || ('row:' + index);
}

function uniqueMiguRows(rows) {
  const seen = new Set();
  const out = [];
  (rows || []).forEach((item, index) => {
    const key = miguSongKey(item, index);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

async function importMG(id, originalInput, context = {}) {
  let playlistId = String(id || '').trim();
  if (playlistId.startsWith('url:')) playlistId = '';
  if (!/^\d+$/.test(playlistId)) {
    const candidates = [context.resolvedUrl, context.html, originalInput, id].filter(Boolean).join('\n');
    playlistId = extractMiguPlaylistId(candidates);
  }
  if (!playlistId) {
    const sourceUrl = context.resolvedUrl || extractFirstUrl(originalInput) || (String(id || '').startsWith('url:') ? String(id).slice(4) : '');
    if (sourceUrl) {
      try {
        const resolved = await expandShareLinkDetailed(sourceUrl);
        playlistId = extractMiguPlaylistId(`${resolved.url}\n${resolved.html}`);
      } catch (_error) {}
    }
  }
  if (!playlistId) throw new Error('咪咕分享链接已识别，但没有取得歌单编号；请确认歌单已设为公开后重新分享');

  const headers = {
    Referer:'https://m.music.migu.cn/',
    Accept:'application/json, text/plain, */*',
    'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 Version/13.0.3 Mobile/15E148 Safari/604.1',
  };
  const pageSize = 50;
  const songUrls = page => [
    `https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?pageNo=${page}&pageSize=${pageSize}&playlistId=${encodeURIComponent(playlistId)}`,
    `https://c.musicapp.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?pageNo=${page}&pageSize=${pageSize}&playlistId=${encodeURIComponent(playlistId)}`,
    `https://app.c.nf.migu.cn/resource/playlist/song/v2.0?pageNo=${page}&pageSize=${pageSize}&playlistId=${encodeURIComponent(playlistId)}`,
    `https://c.musicapp.migu.cn/resource/playlist/song/v2.0?pageNo=${page}&pageSize=${pageSize}&playlistId=${encodeURIComponent(playlistId)}`,
    `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?resourceType=2021&resourceId=${encodeURIComponent(playlistId)}&pageNo=${page}&pageSize=${pageSize}`,
  ];
  async function fetchMiguSongPage(page) {
    let lastError = null;
    for (const candidateUrl of songUrls(page)) {
      try {
        const payload = await fetchJson(candidateUrl, { headers, retryAttempts:2 });
        const rows = miguRows(payload);
        if (rows.length || page === 1) return payload;
      } catch (error) {
        lastError = error;
      }
    }
    if (page === 1 && lastError) throw lastError;
    return {};
  }
  const songsData = await fetchMiguSongPage(1);
  let infoData = {};
  for (const infoUrl of [
    `https://c.musicapp.migu.cn/MIGUM3.0/resource/playlist/v2.0?playlistId=${encodeURIComponent(playlistId)}`,
    `https://app.c.nf.migu.cn/resource/playlist/v2.0?playlistId=${encodeURIComponent(playlistId)}`,
  ]) {
    try {
      infoData = await fetchJson(infoUrl, { headers });
      if (infoData?.data || infoData?.title || infoData?.name) break;
    } catch (_error) {}
  }
  const rows = [...miguRows(songsData)];
  const total = Number(
    songsData?.data?.totalCount || songsData?.data?.total || songsData?.data?.count ||
    songsData?.totalCount || songsData?.total || songsData?.count ||
    infoData?.data?.musicNum || infoData?.data?.songCount || infoData?.data?.totalCount || rows.length
  );
  let uniqueCount = uniqueMiguRows(rows).length;
  let stagnantPages = 0;
  for (let page = 2; page <= 500 && (!total || uniqueCount < total); page += 1) {
    const pageData = await fetchMiguSongPage(page);
    const pageRows = miguRows(pageData);
    if (!pageRows.length) break;
    const before = uniqueCount;
    rows.push(...pageRows);
    uniqueCount = uniqueMiguRows(rows).length;
    stagnantPages = uniqueCount > before ? 0 : stagnantPages + 1;
    if (stagnantPages >= 2) break;
  }
  const songs = uniqueMiguRows(rows);
  if (!songs.length) throw new Error('小菇歌单读取失败；请确认歌单已公开并在中国大陆网络环境下重试');
  const info = infoData?.data || infoData || {};
  return {
    name:info.title || info.name || info.playListName || `小菇歌单 ${playlistId}`,
    cover:info?.imgItem?.img || info?.imgItems?.[0]?.img || info?.img || info?.cover || info?.image || '',
    songs:songs.map((item, index) => {
      const strongId = miguSongId(item);
      const songId = strongId || ('mg_' + crypto.createHash('sha1').update(miguSongKey(item, index)).digest('hex').slice(0, 16));
      let duration = Number(item.duration || item.length || item.totalTime || 0);
      if (duration > 36000) duration /= 1000;
      return {
        id:songId, songmid:songId, contentId:item.contentId || songId, copyrightId:item.copyrightId || '',
        importFallbackId:!strongId,
        name:miguSongName(item),
        singer:miguSongSinger(item),
        albumName:item.album || item.albumName || item?.albums?.[0]?.name || '', albumId:item.albumId || item?.albums?.[0]?.id || '',
        picUrl:item.img3 || item.img2 || item.img1 || item.img || item.image || item?.albumImgs?.[0]?.img || item?.imgItems?.[0]?.img || '',
        lrcUrl:item.lrcUrl || item.lyricUrl || '', mrcUrl:item.mrcurl || item.mrcUrl || '', trcUrl:item.trcUrl || '',
        interval:durationText(duration), source:'mg', types:['flac24bit','flac','320k','128k'],
      };
    }).filter(song => song.name && song.songmid),
  };
}

const IMPORTERS = { tx:importQQ, wy:importWY, kw:importKW, kg:importKG, kgc:importKGC, mg:importMG };
const ALBUM_IMPORTERS = { tx:importQQAlbum, wy:importWYAlbum, kw:importKWAlbum };
async function importPlaylist(input, preferredSource) {
  const originalInput = String(input || '').trim();
  const firstUrl = extractFirstUrl(originalInput);
  let resolution = { url:firstUrl || originalInput, html:'', chain:[] };
  if (firstUrl) {
    try { resolution = await expandShareLinkDetailed(originalInput); } catch (_error) {}
  }

  let parsed = null;
  let lastDetectError = null;
  const candidates = [resolution.url, originalInput].filter(Boolean);
  for (const candidate of candidates) {
    try {
      parsed = detect(candidate, preferredSource);
      break;
    } catch (error) { lastDetectError = error; }
  }
  if (!parsed && resolution.html) {
    const source = normalizeSource(preferredSource);
    if (source === 'mg') {
      const id = extractMiguPlaylistId(`${resolution.url}\n${resolution.html}`);
      if (id) parsed = { source:'mg', id, input:resolution.url };
    } else if (source === 'kg') {
      const id = extractKugouNormalIdentity(`${resolution.url}\n${resolution.html}`);
      if (id) parsed = { source:'kg', id, input:resolution.url };
    } else if (source === 'kgc') {
      const id = extractKugouConceptIdentity(`${resolution.url}\n${resolution.html}`);
      if (id) parsed = { source:'kgc', id, input:resolution.url };
    } else if (['tx', 'wy', 'kw'].includes(source)) {
      const playlistId = extractPlatformPlaylistId(source, `${resolution.url}\n${resolution.html}\n${originalInput}`);
      const albumId = playlistId ? '' : extractPlatformAlbumId(source, `${resolution.url}\n${resolution.html}\n${originalInput}`);
      const id = playlistId || albumId;
      if (id) parsed = { source, kind:playlistId ? 'playlist' : 'album', id, input:resolution.url };
    }
  }
  if (!parsed) {
    const source = normalizeSource(preferredSource);
    if (['tx', 'wy', 'kw'].includes(source)) {
      const playlistId = extractPlatformPlaylistId(source, `${resolution.url}\n${resolution.html}\n${originalInput}`);
      const albumId = playlistId ? '' : extractPlatformAlbumId(source, `${resolution.url}\n${resolution.html}\n${originalInput}`);
      const id = playlistId || albumId;
      if (id) parsed = { source, kind:playlistId ? 'playlist' : 'album', id, input:resolution.url || originalInput };
    }
  }
  if (!parsed) throw lastDetectError || new Error('无法识别链接；请选择平台并粘贴歌单分享链接，或直接输入数字歌单 ID');

  const importer = parsed.kind === 'album' ? ALBUM_IMPORTERS[parsed.source] : IMPORTERS[parsed.source];
  if (!importer) throw new Error('当前平台暂不支持专辑导入，请使用歌单分享链接');
  const result = await importer(parsed.id, parsed.input, {
    originalInput, resolvedUrl:resolution.url, html:resolution.html, redirectChain:resolution.chain,
  });
  result.songs = finalizeImportedSongs(result.songs || [], parsed.source);
  if (!result.songs.length) throw new Error('歌单中没有可导入的歌曲');
  return {
    ok:true,
    playlist:{
      id:`platform_${parsed.source}_${String(parsed.id).replace(/[^a-z0-9_-]+/ig, '_').slice(0, 120)}`,
      name:result.name,
      cover:result.cover,
      source:parsed.source,
      sourceListId:parsed.id,
      sourceInput:parsed.input || originalInput || parsed.id,
      imported:true,
      songs:result.songs,
    },
  };
}

module.exports = { importPlaylist, setFetchImplementation, detect, expandShareLinkDetailed, extractMiguPlaylistId, extractMiguPlaylistIdentity, extractKugouPlaylistIdentity, extractKugouNormalIdentity, extractKugouConceptIdentity };
