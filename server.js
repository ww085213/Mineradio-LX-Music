// ====================================================================
//  Mineradio local desktop server
//  - 本地文件代理 / 本地节奏缓存 / 更新检查
//  - 默认纯本地模式，不再加载网易云 / QQ 音乐运行依赖
// ====================================================================
const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const tls = require('tls');
const { once } = require('events');
const { Readable } = require('stream');
const { fileURLToPath } = require('url');
const { execFileSync, execFile } = require('child_process');
const lxSourceHost = require('./lx-source-host');
const lxSearch = require('./lx-search');
const platformPlaylistImport = require('./platform-playlist-import');
let electronNet = null;
try {
  electronNet = require('electron').net;
} catch (_err) {}
if (electronNet && typeof electronNet.fetch === 'function') {
  lxSearch.setFetchImplementation(electronNet.fetch.bind(electronNet));
  platformPlaylistImport.setFetchImplementation(electronNet.fetch.bind(electronNet));
}

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const LOCAL_FILE_TOKEN = process.env.MINERADIO_LOCAL_FILE_TOKEN || '';
const UPDATE_WORK_DIR = process.env.MINERADIO_UPDATE_DIR || path.join(__dirname, 'updates');
const UPDATE_DOWNLOAD_DIR = process.env.MINERADIO_UPDATE_DOWNLOAD_DIR || path.join(UPDATE_WORK_DIR, 'downloads');
const UPDATE_PATCH_BACKUP_DIR = process.env.MINERADIO_PATCH_BACKUP_DIR || path.join(UPDATE_WORK_DIR, 'backups', 'patches');
const TEST_UPDATE_MANIFEST_FILE = path.join(UPDATE_WORK_DIR, 'test-update-manifest.json');
const BEATMAP_CACHE_DIR = process.env.MINERADIO_BEAT_CACHE_DIR || 'D:\\MineradioCache\\beatmaps';
const WALLPAPER_TRANSCODE_CACHE_DIR = process.env.MINERADIO_WALLPAPER_CACHE_DIR || 'D:\\MineradioCache\\wallpapers';
const APP_PACKAGE = readPackageInfo();
const APP_VERSION = process.env.MINERADIO_VERSION || (APP_PACKAGE.mineradio && APP_PACKAGE.mineradio.releaseVersion) || APP_PACKAGE.version || '0.9.11';
const UPDATE_CONFIG = readUpdateConfig(APP_PACKAGE);
const PATCH_MAX_BYTES = 12 * 1024 * 1024;
const PATCH_ALLOWED_ROOTS = new Set(['public', 'desktop', 'build']);
const PATCH_ALLOWED_FILES = new Set(['server.js', 'package.json', 'package-lock.json']);
const UPDATE_FALLBACK_NOTES = [
  '电影镜头节奏更松',
  '音源失败自动换源',
  '右上角更新提示',
];
const updateDownloadJobs = new Map();

function applySystemCertificateAuthorities() {
  try {
    if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') return;
    const bundled = tls.getCACertificates('default') || [];
    const system = tls.getCACertificates('system') || [];
    if (!system.length) return;
    const seen = new Set();
    const merged = [];
    bundled.concat(system).forEach(cert => {
      if (!cert || seen.has(cert)) return;
      seen.add(cert);
      merged.push(cert);
    });
    if (merged.length > bundled.length) tls.setDefaultCACertificates(merged);
  } catch (e) {
    console.warn('[TLS] system CA merge skipped:', e.message);
  }
}

applySystemCertificateAuthorities();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

const LOCAL_FILE_MIME = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm',
  '.ape': 'audio/x-ape',
  '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.aifc': 'audio/aiff',
  '.caf': 'audio/x-caf',
  '.amr': 'audio/amr',
  '.awb': 'audio/amr-wb',
  '.oga': 'audio/ogg',
  '.mka': 'audio/x-matroska',
  '.mkv': 'audio/x-matroska',
  '.m4b': 'audio/mp4',
  '.alac': 'audio/alac',
  '.ac3': 'audio/ac3',
  '.dts': 'audio/vnd.dts',
  '.tta': 'audio/x-tta',
  '.tak': 'audio/x-tak',
  '.wv': 'audio/x-wavpack',
  '.au': 'audio/basic',
  '.snd': 'audio/basic',
  '.ra': 'audio/vnd.rn-realaudio',
  '.rm': 'application/vnd.rn-realmedia',
  '.lrc': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

function localContentTypeForPath(filePath) {
  return LOCAL_FILE_MIME[path.extname(String(filePath || '')).toLowerCase()] || 'application/octet-stream';
}

function findFfmpegExecutable() {
  const candidates = [
    path.join(process.resourcesPath || '', 'ffmpeg.exe'),
    path.join(process.resourcesPath || '', 'bin', 'ffmpeg.exe'),
    path.join(path.dirname(process.execPath || ''), 'ffmpeg.exe'),
    path.join(__dirname, 'ffmpeg.exe'),
    path.join(__dirname, 'bin', 'ffmpeg.exe'),
  ];
  for (const candidate of candidates) {
    try { if (candidate && fs.existsSync(candidate)) return candidate; } catch (_e) {}
  }
  try {
    return execFileSync('where.exe', ['ffmpeg.exe'], { encoding:'utf8', windowsHide:true, timeout:2500 })
      .split(/\r?\n/).map(value => value.trim()).find(Boolean) || '';
  } catch (_error) {
    return '';
  }
}

function wallpaperTranscodeCachePath(filePath) {
  const stat = fs.statSync(filePath);
  const key = crypto.createHash('sha1')
    .update(path.resolve(filePath))
    .update(String(stat.size))
    .update(String(stat.mtimeMs))
    .digest('hex');
  return path.join(WALLPAPER_TRANSCODE_CACHE_DIR, key + '.mp4');
}

async function compatibleWallpaperMediaFile(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (!filePath || !fs.existsSync(filePath)) return filePath;
  if (ext === '.mp4') return filePath;
  if (!['.webm', '.mov', '.m4v', '.gif'].includes(ext)) return filePath;
  const ffmpeg = findFfmpegExecutable();
  if (!ffmpeg) return filePath;
  const output = wallpaperTranscodeCachePath(filePath);
  if (fs.existsSync(output)) return output;
  await fs.promises.mkdir(path.dirname(output), { recursive:true });
  const temp = output + '.tmp';
  await new Promise((resolve, reject) => {
    execFile(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', filePath,
      '-map', '0:v:0',
      '-an',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      temp,
    ], { windowsHide:true, timeout:180000, maxBuffer:2 * 1024 * 1024 }, error => error ? reject(error) : resolve());
  }).then(async () => {
    await fs.promises.rename(temp, output);
  }).catch(async error => {
    try { await fs.promises.unlink(temp); } catch (_e) {}
    console.warn('[WallpaperTranscode]', error.message || error);
  });
  return fs.existsSync(output) ? output : filePath;
}

// ---------- 工具 ----------
function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    // Resource patches are applied in-place.  Chromium may otherwise reuse an
    // older index/script after restart and make a successful update look as if
    // it contained no new features.
    const headers = { 'Content-Type': MIME[ext] || 'text/plain' };
    if (/\.(?:html|js|css|json)$/i.test(ext)) {
      headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate';
      headers.Pragma = 'no-cache';
      headers.Expires = '0';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}
function sendJSON(res, data, status) {
  res.writeHead(status || 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  });
  res.end(JSON.stringify(data));
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value || {}), 'utf8').toString('base64url');
}

function parseBase64UrlJson(value) {
  try {
    if (!value) return {};
    return JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8')) || {};
  } catch (_err) {
    return {};
  }
}

function audioProxyHeadersFromQuery(value) {
  const raw = parseBase64UrlJson(value);
  const out = {};
  const allowed = new Set(['accept', 'cookie', 'origin', 'referer', 'user-agent']);
  for (const [rawKey, rawValue] of Object.entries(raw || {})) {
    const key = String(rawKey || '').trim().toLowerCase();
    if (!allowed.has(key) || rawValue == null) continue;
    out[key] = String(rawValue).replace(/[\r\n]+/g, ' ');
  }
  return out;
}

function audioProxyUrl(originalUrl, headers) {
  if (!originalUrl) return '';
  const params = new URLSearchParams({ url: originalUrl });
  if (headers && Object.keys(headers).length) params.set('h', base64UrlJson(headers));
  return '/api/audio?' + params.toString();
}

const wallpaperMediaIndex = new Map();
function steamRegistryRoots() {
  if (process.platform !== 'win32') return [];
  const roots = new Set();
  const queries = [
    ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
    ['HKCU\\Software\\Valve\\Steam', 'SteamExe'],
    ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
    ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'],
  ];
  queries.forEach(([key, value]) => {
    try {
      const output = execFileSync('reg.exe', ['query', key, '/v', value], {
        encoding:'utf8',
        windowsHide:true,
        timeout:2500,
      });
      const match = output.match(new RegExp(`${value}\\s+REG_\\w+\\s+(.+)$`, 'mi'));
      if (!match) return;
      let found = match[1].trim().replace(/\//g, '\\');
      if (/steam\.exe$/i.test(found)) found = path.dirname(found);
      if (found) roots.add(found);
    } catch (_error) {}
  });
  return [...roots];
}
function steamLibraryRoots() {
  const roots = new Set([
    'C:\\Program Files\\Steam',
    'C:\\Program Files (x86)\\Steam',
    'D:\\SteamLibrary',
    'E:\\SteamLibrary',
    'F:\\SteamLibrary',
  ]);
  [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env['ProgramW6432']]
    .filter(Boolean)
    .forEach(base => roots.add(path.join(base, 'Steam')));
  steamRegistryRoots().forEach(root => roots.add(root));
  // 兼容 Steam 或 Wallpaper Engine 安装在任意盘符的常见自定义目录。
  for (let code = 67; code <= 90; code++) {
    const drive = String.fromCharCode(code) + ':\\';
    roots.add(path.join(drive, 'Steam'));
    roots.add(path.join(drive, 'SteamLibrary'));
    roots.add(path.join(drive, 'Program Files', 'Steam'));
    roots.add(path.join(drive, 'Program Files (x86)', 'Steam'));
    roots.add(path.join(drive, 'Games', 'Steam'));
    roots.add(path.join(drive, 'Games', 'SteamLibrary'));
  }
  for (const root of [...roots]) {
    [
      path.join(root, 'steamapps', 'libraryfolders.vdf'),
      path.join(root, 'config', 'libraryfolders.vdf'),
    ].forEach(vdf => {
      try {
        const text = fs.readFileSync(vdf, 'utf8').replace(/^\uFEFF/, '');
        // Steam 新版格式：
        // "1" { "path" "D:\\SteamLibrary" }
        for (const match of text.matchAll(/"path"\s+"([^"]+)"/gi)) {
          const found = match[1].replace(/\\\\/g, '\\').trim();
          if (/^[a-z]:\\/i.test(found)) roots.add(found);
        }
        // Steam 旧版格式：
        // "1" "D:\\SteamLibrary"
        for (const match of text.matchAll(/"\d+"\s+"([a-z]:\\{1,2}[^"]+)"/gi)) {
          const found = match[1].replace(/\\\\/g, '\\').trim();
          if (/^[a-z]:\\/i.test(found)) roots.add(found);
        }
      } catch (_err) {}
    });
  }
  return [...roots].filter(root => fs.existsSync(root));
}
function firstExistingWallpaperFile(dir, candidates) {
  for (const value of candidates) {
    if (!value) continue;
    const target = path.resolve(dir, String(value));
    if (target.startsWith(path.resolve(dir) + path.sep) && fs.existsSync(target) && fs.statSync(target).isFile()) return target;
  }
  return '';
}

function imageDimensions(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const len = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const data = buf.subarray(0, len);
    if (data.length >= 24 && data.readUInt32BE(0) === 0x89504e47 && data.toString('ascii', 12, 16) === 'IHDR') {
      return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    }
    if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
      const tag = data.toString('ascii', 12, 16);
      if (tag === 'VP8X' && data.length >= 30) {
        return {
          width: 1 + data.readUIntLE(24, 3),
          height: 1 + data.readUIntLE(27, 3),
        };
      }
      if (tag === 'VP8 ' && data.length >= 30) {
        return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
      }
      if (tag === 'VP8L' && data.length >= 25) {
        const b0 = data[21], b1 = data[22], b2 = data[23], b3 = data[24];
        return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
      }
    }
    if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
      let pos = 2;
      while (pos + 9 < data.length) {
        if (data[pos] !== 0xff) { pos++; continue; }
        const marker = data[pos + 1];
        const size = data.readUInt16BE(pos + 2);
        if (size < 2) break;
        if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
          return { width: data.readUInt16BE(pos + 7), height: data.readUInt16BE(pos + 5) };
        }
        pos += 2 + size;
      }
    }
  } catch (_error) {}
  return { width: 0, height: 0 };
}

function wallpaperImageCandidateScore(file, size, rootDir) {
  const name = path.basename(file).toLowerCase();
  const rel = path.relative(rootDir, file).replace(/\\/g, '/').toLowerCase();
  if (/(^|[._-])(preview|cover|poster|thumbnail|thumb|icon|avatar)([._-]|$)/i.test(name)) return -1;
  if (/(normal|roughness|metallic|height|specular|emissive|opacity|alpha|mask|noise|bump|ao|sprite|particle|cursor)/i.test(rel)) return -1;
  const dim = imageDimensions(file);
  const area = Math.max(0, dim.width * dim.height);
  if (area && area < 900 * 500) return -1;
  if (!area && size < 350 * 1024) return -1;
  const ratio = dim.width && dim.height ? dim.width / dim.height : 16 / 9;
  const ratioPenalty = Math.min(1.4, Math.abs(Math.log(ratio / (16 / 9))));
  const rootBonus = path.dirname(file) === rootDir ? 1.15 : 1;
  return ((area || size * 3) / (1 + ratioPenalty)) * rootBonus;
}

function compatibleWallpaperMedia(dir, project) {
  const supported = new Map([
    ['.mp4', 'video'], ['.webm', 'video'], ['.mov', 'video'], ['.m4v', 'video'], ['.gif', 'video'],
    ['.jpg', 'image'], ['.jpeg', 'image'], ['.png', 'image'], ['.webp', 'image'],
  ]);
  const direct = firstExistingWallpaperFile(dir, [project && project.file]);
  if (direct && supported.has(path.extname(direct).toLowerCase())) {
    return { file: direct, mediaType: supported.get(path.extname(direct).toLowerCase()) };
  }
  const candidates = [];
  const stack = [dir];
  let visited = 0;
  while (stack.length && visited < 5000) {
    const current = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_error) { continue; }
    for (const entry of entries) {
      if (++visited > 5000) break;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(target);
        continue;
      }
      if (!entry.isFile() || /^preview\./i.test(entry.name)) continue;
      const mediaType = supported.get(path.extname(entry.name).toLowerCase());
      if (!mediaType) continue;
      let size = 0;
      try { size = fs.statSync(target).size; } catch (_error) {}
      const score = mediaType === 'image' ? wallpaperImageCandidateScore(target, size, dir) : size;
      if (mediaType === 'image' && score < 0) continue;
      candidates.push({ file:target, mediaType, size, score });
    }
  }
  candidates.sort((a, b) => {
    if (a.mediaType !== b.mediaType) return a.mediaType === 'video' ? -1 : 1;
    return (b.score || b.size) - (a.score || a.size);
  });
  return candidates[0] || { file:'', mediaType:'' };
}
function bestWallpaperPreview(dir, project) {
  const preferred = firstExistingWallpaperFile(dir, [
    project && project.preview,
    project && project.cover,
    project && project.poster,
    'preview.jpg', 'preview.png', 'preview.jpeg', 'preview.webp',
    'cover.jpg', 'cover.png', 'poster.jpg', 'poster.png',
  ]);
  const candidates = [];
  if (preferred) {
    try { candidates.push({ file:preferred, size:fs.statSync(preferred).size, priority:2 }); } catch (_error) {}
  }
  const stack = [dir];
  let visited = 0;
  while (stack.length && visited < 3000) {
    const current = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes:true }); } catch (_error) { continue; }
    for (const entry of entries) {
      if (++visited > 3000) break;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(target);
        continue;
      }
      if (!entry.isFile() || !/^(?:preview|cover|poster|thumbnail)[^/]*\.(?:jpe?g|png|webp)$/i.test(entry.name)) continue;
      try { candidates.push({ file:target, size:fs.statSync(target).size, priority:current === dir ? 2 : 1 }); } catch (_error) {}
    }
  }
  candidates.sort((a, b) => b.priority - a.priority || b.size - a.size);
  return candidates[0] && candidates[0].file || '';
}
function wallpaperContentFingerprint(file) {
  if (!file) return '';
  try {
    const stat = fs.statSync(file);
    const length = Math.min(stat.size, 128 * 1024);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buffer, 0, length, 0); } finally { fs.closeSync(fd); }
    return crypto.createHash('sha1')
      .update(String(stat.size))
      .update(buffer)
      .digest('hex');
  } catch (_error) {
    return '';
  }
}
function scanWallpaperEngineLibrary() {
  wallpaperMediaIndex.clear();
  const results = [];
  const projectRoots = [];
  steamLibraryRoots().forEach(root => {
    projectRoots.push(path.join(root, 'steamapps', 'workshop', 'content', '431960'));
    projectRoots.push(path.join(root, 'steamapps', 'common', 'wallpaper_engine', 'projects', 'myprojects'));
  });
  const seen = new Set();
  const seenContent = new Set();
  projectRoots.forEach(root => {
    if (!fs.existsSync(root)) return;
    let dirs = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => path.join(root, entry.name)); } catch (_err) {}
    dirs.forEach(dir => {
      const projectPath = path.join(dir, 'project.json');
      if (!fs.existsSync(projectPath)) return;
      try {
        const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
        const type = String(project.type || '').toLowerCase();
        const compatible = compatibleWallpaperMedia(dir, project);
        const media = compatible.file;
        const preview = bestWallpaperPreview(dir, project);
        if (!media && !preview) return;
        const fingerprint = crypto.createHash('sha1').update(projectPath).digest('hex').slice(0, 18);
        if (seen.has(fingerprint)) return;
        const contentFingerprint = wallpaperContentFingerprint(media || preview);
        if (contentFingerprint && seenContent.has(contentFingerprint)) return;
        seen.add(fingerprint);
        if (contentFingerprint) seenContent.add(contentFingerprint);
        if (media) wallpaperMediaIndex.set(fingerprint + ':media', media);
        if (preview) wallpaperMediaIndex.set(fingerprint + ':preview', preview);
        results.push({
          id: fingerprint,
          title: String(project.title || path.basename(dir)).slice(0, 160),
          type: media ? compatible.mediaType : type || 'scene',
          projectType: type || '',
          mediaType: compatible.mediaType || '',
          playable: !!media,
          dynamic: !!media && compatible.mediaType === 'video',
          hasPreview: !!preview,
          dedupeKey: contentFingerprint || fingerprint,
        });
      } catch (_err) {}
    });
  });
  return results.sort((a, b) => Number(b.playable) - Number(a.playable) || a.title.localeCompare(b.title, 'zh-CN'));
}

async function lxApiRequest(apiPath) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2200);
  try {
    const response = await fetch('http://127.0.0.1:23330' + apiPath, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    const text = await response.text();
    let data = text;
    try { data = text ? JSON.parse(text) : {}; } catch (_e) {}
    if (!response.ok) throw new Error('LX_HTTP_' + response.status);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function findLxDatabasePath() {
  const candidates = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'lx-music-desktop', 'LxDatas', 'lx.data.db'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'lx-music-desktop', 'portable', 'LxDatas', 'lx.data.db'),
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || '';
}

function decodeLxText(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_m, code) => {
      try { return String.fromCodePoint(Number(code)); } catch (_e) { return _m; }
    })
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function readLxPlaylists() {
  const dbPath = findLxDatabasePath();
  if (!dbPath) throw new Error('LX_DATABASE_NOT_FOUND');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const storedLists = db.prepare(
      'SELECT id, name, source, sourceListId, position FROM my_list ORDER BY position ASC'
    ).all();
    const lists = [
      { id: 'default', name: '默认列表', source: '', sourceListId: '', position: -2 },
      { id: 'love', name: '我的收藏', source: '', sourceListId: '', position: -1 },
      ...storedLists,
    ];
    const songs = db.prepare(
      'SELECT m.id, m.listId, m.name, m.singer, m.source, m.interval, m.meta, ' +
      'COALESCE(o."order", 999999) AS sortOrder ' +
      'FROM my_list_music_info m LEFT JOIN my_list_music_info_order o ' +
      'ON o.listId=m.listId AND o.musicInfoId=m.id ' +
      "WHERE m.listId <> 'temp' ORDER BY m.listId, sortOrder ASC"
    ).all();
    const songsByList = new Map();
    songs.forEach(row => {
      let meta = {};
      try { meta = JSON.parse(row.meta || '{}') || {}; } catch (_e) {}
      const song = {
        id: row.id,
        name: decodeLxText(row.name),
        singer: decodeLxText(row.singer),
        source: row.source,
        interval: row.interval || '',
        songmid: meta.songId == null ? row.id : meta.songId,
        albumName: decodeLxText(meta.albumName),
        picUrl: meta.picUrl || '',
        albumId: meta.albumId == null ? '' : meta.albumId,
        types: Array.isArray(meta.qualitys) ? meta.qualitys : [],
        hash: meta.hash || '',
        strMediaMid: meta.strMediaMid || '',
        albumMid: meta.albumMid || '',
        copyrightId: meta.copyrightId || '',
        lrcUrl: meta.lrcUrl || '',
        trcUrl: meta.trcUrl || '',
        mrcUrl: meta.mrcUrl || '',
        meta,
      };
      if (!songsByList.has(row.listId)) songsByList.set(row.listId, []);
      songsByList.get(row.listId).push(song);
    });
    return {
      ok: true,
      dbPath,
      playlists: lists
        .map(list => ({
          id: list.id,
          name: decodeLxText(list.name),
          source: list.source || '',
          sourceListId: list.sourceListId || '',
          songs: songsByList.get(list.id) || [],
        }))
        .filter(list => list.songs.length),
    };
  } finally {
    db.close();
  }
}
function readPackageInfo() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}
function parseGitHubRepository(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const direct = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (direct) return { owner: direct[1], repo: direct[2].replace(/\.git$/i, '') };
  const github = raw.match(/github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[#/?].*)?$/i);
  if (github) return { owner: github[1], repo: github[2].replace(/\.git$/i, '') };
  return null;
}
function readUpdateConfig(pkg) {
  const local = (pkg && pkg.mineradio && pkg.mineradio.update) || {};
  const repoHint = process.env.MINERADIO_UPDATE_REPOSITORY
    || process.env.GITHUB_REPOSITORY
    || local.repository
    || local.github
    || (pkg && pkg.repository && (pkg.repository.url || pkg.repository))
    || '';
  const parsed = parseGitHubRepository(repoHint) || {};
  const owner = process.env.MINERADIO_UPDATE_OWNER || local.owner || parsed.owner || '';
  const repo = process.env.MINERADIO_UPDATE_REPO || local.repo || parsed.repo || '';
  return {
    provider: local.provider || 'github',
    owner,
    repo,
    configured: !!(owner && repo),
    preview: local.preview !== false,
    preferMirrors: local.preferMirrors !== false,
    mirrors: readUpdateMirrors(local),
    manifest: process.env.MINERADIO_UPDATE_MANIFEST
      || process.env.MINERADIO_UPDATE_MANIFEST_URL
      || process.env.MINERADIO_UPDATE_MANIFEST_FILE
      || '',
  };
}
function parseUpdateMirrorList(value) {
  if (Array.isArray(value)) return value;
  return String(value || '').split(/[\n,;]/);
}
function readUpdateMirrors(local) {
  const envMirrors = process.env.MINERADIO_UPDATE_MIRRORS || process.env.MINERADIO_UPDATE_MIRROR || '';
  const raw = envMirrors
    ? parseUpdateMirrorList(envMirrors)
    : parseUpdateMirrorList(local.mirrors || local.downloadMirrors || []);
  const seen = new Set();
  const mirrors = [];
  raw.forEach(item => {
    const url = String(item || '').trim();
    if (!/^https?:\/\//i.test(url)) return;
    const key = url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    mirrors.push(url);
  });
  return mirrors.slice(0, 6);
}
function normalizeDigest(value, algorithm) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const prefix = new RegExp('^' + algorithm + ':', 'i');
  return raw.replace(prefix, '').trim().replace(/^['"]|['"]$/g, '');
}
function assetDigestInfo(asset) {
  const digest = String(asset && asset.digest || '').trim();
  return {
    sha256: normalizeDigest((asset && asset.sha256) || (/^sha256:/i.test(digest) ? digest : ''), 'sha256').toLowerCase(),
    sha512: normalizeDigest((asset && asset.sha512) || (/^sha512:/i.test(digest) ? digest : ''), 'sha512'),
  };
}
function buildMirrorUrl(originalUrl, mirror) {
  const source = String(originalUrl || '').trim();
  const base = String(mirror || '').trim();
  if (!/^https?:\/\//i.test(source) || !/^https?:\/\//i.test(base)) return '';
  if (base.includes('{encodedUrl}')) return base.replace(/\{encodedUrl\}/g, encodeURIComponent(source));
  if (base.includes('{url}')) return base.replace(/\{url\}/g, source);
  return base.replace(/\/+$/, '/') + source;
}
function uniqueDownloadCandidates(urls, opts) {
  opts = opts || {};
  const directUrls = (Array.isArray(urls) ? urls : [urls])
    .map(url => String(url || '').trim())
    .filter(url => /^https?:\/\//i.test(url));
  const directSet = new Set(directUrls.map(url => url.toLowerCase()));
  const allLocal = directUrls.length && directUrls.every(url => /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|\/)/i.test(url));
  const mirrors = (opts.useMirrors === false || allLocal) ? [] : (UPDATE_CONFIG.mirrors || []);
  const mirrored = [];
  directUrls.forEach(source => {
    mirrors.forEach((mirror, index) => {
      const url = buildMirrorUrl(source, mirror);
      if (url) mirrored.push({
        url,
        label: '国内加速线路 ' + (index + 1),
        mirrored: true,
      });
    });
  });
  const direct = directUrls.map(url => ({
    url,
    label: /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|\/)/i.test(url)
      ? '本地测试包'
      : (directSet.has(url.toLowerCase()) ? 'GitHub 直连' : '下载线路'),
    mirrored: false,
  }));
  const ordered = UPDATE_CONFIG.preferMirrors === false ? direct.concat(mirrored) : mirrored.concat(direct);
  const seen = new Set();
  return ordered.filter(item => {
    const key = item.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function publicDownloadUrls(candidates) {
  return (Array.isArray(candidates) ? candidates : [])
    .map(item => item && item.url)
    .filter(Boolean);
}
function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').replace(/[+].*$/, '').replace(/-.+$/, '');
}
function compareVersions(a, b) {
  const aa = normalizeVersion(a).split('.').map(n => parseInt(n, 10) || 0);
  const bb = normalizeVersion(b).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(aa.length, bb.length, 3);
  for (let i = 0; i < len; i++) {
    const left = aa[i] || 0;
    const right = bb[i] || 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}
function cleanReleaseLine(line) {
  return String(line || '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim();
}
function extractReleaseNotes(body) {
  const notes = [];
  String(body || '').split(/\r?\n/).forEach(line => {
    const text = cleanReleaseLine(line);
    if (!text) return;
    if (/^(what'?s changed|changes|changelog|full changelog|更新日志)$/i.test(text)) return;
    if (/^https?:\/\//i.test(text)) return;
    if (text.length > 72) return;
    notes.push(text);
  });
  return notes.slice(0, 4);
}
function pickReleaseAsset(assets) {
  const list = Array.isArray(assets) ? assets : [];
  const preferred = list.find(a => /supplement.*\.(exe|msi)$/i.test(a && a.name || ''))
    || list.find(a => /\.(exe|msi)$/i.test(a && a.name || ''))
    || list.find(a => /\.(zip|7z)$/i.test(a && a.name || ''))
    || list[0];
  if (!preferred) return null;
  const digest = assetDigestInfo(preferred);
  const candidates = uniqueDownloadCandidates(preferred.browser_download_url || '');
  return {
    name: preferred.name || '',
    size: preferred.size || 0,
    contentType: preferred.content_type || '',
    downloadUrl: preferred.browser_download_url || '',
    downloadUrls: publicDownloadUrls(candidates),
    sha256: digest.sha256 || '',
    sha512: digest.sha512 || '',
  };
}
function effectiveReleaseVersion(version, asset) {
  const base = normalizeVersion(version || APP_VERSION) || APP_VERSION;
  return asset && /supplement/i.test(String(asset.name || '')) ? `${base}.1` : base;
}
function patchAssetVersions(name) {
  const matches = String(name || '').match(/\d+(?:[._-]\d+){1,3}/g) || [];
  return matches.map(item => normalizeVersion(item.replace(/[._-]/g, '.'))).filter(Boolean);
}
function pickPatchAsset(assets, currentVersion, latestVersion) {
  const list = Array.isArray(assets) ? assets : [];
  const current = normalizeVersion(currentVersion || APP_VERSION);
  const latest = normalizeVersion(latestVersion || '');
  const preferred = list.find(a => {
    const name = String(a && a.name || '');
    if (!/\.(patch\.json|patch|json)$/i.test(name)) return false;
    const versions = patchAssetVersions(name);
    if (latest) return versions[0] === current && versions[versions.length - 1] === latest;
    return versions[0] === current && name.toLowerCase().includes('patch');
  }) || list.find(a => {
    const name = String(a && a.name || '');
    if (!/\.(patch\.json|patch|json)$/i.test(name)) return false;
    const versions = patchAssetVersions(name);
    return versions[0] === current && name.toLowerCase().includes('patch');
  }) || list.find(a => /\.(patch\.json|patch)$/i.test(a && a.name || ''));
  if (!preferred) return null;
  const digest = assetDigestInfo(preferred);
  const candidates = uniqueDownloadCandidates(preferred.browser_download_url || '');
  return {
    name: preferred.name || '',
    size: preferred.size || 0,
    contentType: preferred.content_type || '',
    downloadUrl: preferred.browser_download_url || '',
    downloadUrls: publicDownloadUrls(candidates),
    sha256: digest.sha256 || '',
    sha512: digest.sha512 || '',
  };
}
function updateAssetNameFromUrl(value) {
  try {
    const u = new URL(String(value || ''));
    const base = path.basename(decodeURIComponent(u.pathname || ''));
    if (base) return base;
  } catch (_) {}
  return path.basename(String(value || '').split('?')[0]) || '';
}
function normalizeManifestUpdateInfo(data) {
  data = data || {};
  const release = data.release || {};
  const asset = release.asset || data.asset || {};
  const latestVersion = normalizeVersion(
    data.latestVersion
    || data.version
    || release.version
    || release.tagName
    || release.tag_name
    || release.name
    || APP_VERSION
  ) || APP_VERSION;
  const downloadUrl = release.downloadUrl || data.downloadUrl || asset.downloadUrl || asset.browser_download_url || '';
  const patch = release.patch || data.patch || null;
  const assetUrls = [downloadUrl].concat(Array.isArray(asset.downloadUrls) ? asset.downloadUrls : []);
  const patchUrls = patch ? [patch.downloadUrl].concat(Array.isArray(patch.downloadUrls) ? patch.downloadUrls : []) : [];
  const patchInfo = patch && patch.downloadUrl ? {
    name: patch.name || updateAssetNameFromUrl(patch.downloadUrl) || `Mineradio-${APP_VERSION}→${latestVersion}.patch.json`,
    size: Number(patch.size || 0) || 0,
    contentType: patch.contentType || patch.content_type || 'application/json',
    downloadUrl: patch.downloadUrl,
    downloadUrls: publicDownloadUrls(uniqueDownloadCandidates(patchUrls)),
    from: normalizeVersion(patch.from || APP_VERSION),
    to: normalizeVersion(patch.to || latestVersion),
    sha256: normalizeDigest(patch.sha256 || '', 'sha256').toLowerCase(),
    sha512: normalizeDigest(patch.sha512 || '', 'sha512'),
  } : null;
  const notes = Array.isArray(release.notes) && release.notes.length
    ? release.notes.slice(0, 4).map(cleanReleaseLine).filter(Boolean)
    : (extractReleaseNotes(release.body || data.body).length ? extractReleaseNotes(release.body || data.body) : UPDATE_FALLBACK_NOTES);
  const assetInfo = downloadUrl ? {
    name: asset.name || updateAssetNameFromUrl(downloadUrl) || `Mineradio-${latestVersion}-Setup.exe`,
    size: Number(asset.size || 0) || 0,
    contentType: asset.contentType || asset.content_type || '',
    downloadUrl,
    downloadUrls: publicDownloadUrls(uniqueDownloadCandidates(assetUrls)),
    sha256: normalizeDigest(asset.sha256 || '', 'sha256').toLowerCase(),
    sha512: normalizeDigest(asset.sha512 || release.sha512 || data.sha512 || '', 'sha512'),
  } : null;
  return {
    configured: true,
    preview: false,
    updateAvailable: data.updateAvailable != null ? !!data.updateAvailable : compareVersions(latestVersion, APP_VERSION) > 0,
    currentVersion: APP_VERSION,
    latestVersion,
    release: {
      tagName: release.tagName || release.tag_name || data.tagName || ('v' + latestVersion),
      name: release.name || data.name || ('Mineradio v' + latestVersion),
      version: latestVersion,
      publishedAt: release.publishedAt || release.published_at || data.publishedAt || '',
      htmlUrl: release.htmlUrl || release.html_url || data.htmlUrl || '',
      downloadUrl,
      asset: assetInfo,
      patch: patchInfo,
      patchAvailable: !!(patchInfo && patchInfo.downloadUrl && compareVersions(latestVersion, APP_VERSION) > 0),
      summary: release.summary || data.summary || notes[0] || '发现新版本，建议更新。',
      notes,
    },
    source: 'manifest',
  };
}
function localServerBaseUrl() {
  const port = String(process.env.PORT || '').trim() || '3000';
  return `http://127.0.0.1:${port}`;
}
function readLocalTestUpdateManifest() {
  if (!fs.existsSync(TEST_UPDATE_MANIFEST_FILE)) return null;
  const data = JSON.parse(fs.readFileSync(TEST_UPDATE_MANIFEST_FILE, 'utf8'));
  if (!data || data.enabled === false) return null;
  const localInstallerPath = data.localInstallerPath || (data.asset && data.asset.localFilePath) || '';
  if (localInstallerPath && fs.existsSync(localInstallerPath)) {
    const stat = fs.statSync(localInstallerPath);
    data.release = data.release || {};
    data.release.asset = data.release.asset || data.asset || {};
    data.release.downloadUrl = data.release.downloadUrl || `${localServerBaseUrl()}/api/update/test-installer`;
    data.release.asset.downloadUrl = data.release.asset.downloadUrl || data.release.downloadUrl;
    data.release.asset.name = data.release.asset.name || `Mineradio.Setup.${normalizeVersion(data.latestVersion || data.version || 'test')}.exe`;
    data.release.asset.size = Number(data.release.asset.size || stat.size || 0) || 0;
    data.release.asset.sha256 = data.release.asset.sha256 || sha256Hex(fs.readFileSync(localInstallerPath));
    data.release.asset.contentType = data.release.asset.contentType || 'application/x-msdownload';
  }
  data.preview = false;
  data.updateAvailable = data.updateAvailable !== false;
  return data;
}
async function readUpdateManifest(ref) {
  const value = String(ref || '').trim();
  if (!value) throw new Error('UPDATE_MANIFEST_MISSING');
  if (/^https?:\/\//i.test(value)) {
    const resp = await fetch(value, {
      headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
    });
    if (!resp.ok) throw new Error('Update manifest ' + resp.status);
    return resp.json();
  }
  const file = /^file:/i.test(value) ? fileURLToPath(value) : path.resolve(value);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
async function fetchManifestUpdateInfo(ref) {
  try {
    const data = await readUpdateManifest(ref);
    return normalizeManifestUpdateInfo(data);
  } catch (err) {
    return localUpdateFallback(err.message || 'Update manifest failed', { configured: true });
  }
}
function beatCacheRootInfo() {
  const dir = path.resolve(BEATMAP_CACHE_DIR);
  const root = path.parse(dir).root;
  const drive = root ? root.replace(/[\\\/]+$/, '').toUpperCase() : '';
  const allowed = !!root && !/^C:$/i.test(drive);
  const available = allowed && fs.existsSync(root);
  return { dir, root, drive, allowed, available };
}
function ensureBeatMapCacheDir() {
  const info = beatCacheRootInfo();
  if (!info.allowed) {
    const err = new Error('BEAT_CACHE_ON_C_DRIVE_DISABLED');
    err.code = 'BEAT_CACHE_ON_C_DRIVE_DISABLED';
    err.info = info;
    throw err;
  }
  if (!info.available) {
    const err = new Error('BEAT_CACHE_DRIVE_UNAVAILABLE');
    err.code = 'BEAT_CACHE_DRIVE_UNAVAILABLE';
    err.info = info;
    throw err;
  }
  fs.mkdirSync(info.dir, { recursive: true });
  return info.dir;
}
function safeBeatMapCacheFile(key) {
  const raw = String(key || '').trim();
  if (!raw || raw.length > 240) return null;
  const hash = crypto.createHash('sha1').update(raw).digest('hex');
  const label = raw.replace(/[^a-z0-9_.-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'beatmap';
  return path.join(ensureBeatMapCacheDir(), `${label}-${hash}.json`);
}
function compactBeatMapCachePayload(body) {
  const key = String(body && body.key || '').trim();
  const map = body && body.map;
  if (!key || !map || typeof map !== 'object') return null;
  return {
    v: 1,
    key,
    savedAt: Date.now(),
    meta: {
      provider: String(body.provider || '').slice(0, 32),
      title: String(body.title || '').slice(0, 160),
      artist: String(body.artist || '').slice(0, 160),
      mode: String(body.mode || 'mr').slice(0, 32),
    },
    map,
  };
}
function readBeatMapCache(key) {
  const file = safeBeatMapCacheFile(key);
  if (!file || !fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return raw && raw.map ? raw : null;
}
function writeBeatMapCache(body) {
  const payload = compactBeatMapCachePayload(body);
  if (!payload) return { ok: false, error: 'INVALID_BEATMAP_CACHE_PAYLOAD' };
  const file = safeBeatMapCacheFile(payload.key);
  if (!file) return { ok: false, error: 'INVALID_BEATMAP_CACHE_KEY' };
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, file);
  return { ok: true, key: payload.key, savedAt: payload.savedAt, dir: path.dirname(file) };
}
function localUpdateFallback(reason, opts) {
  opts = opts || {};
  const configured = !!(opts.configured != null ? opts.configured : false);
  return {
    configured,
    preview: UPDATE_CONFIG.preview,
    updateAvailable: false,
    currentVersion: APP_VERSION,
    latestVersion: APP_VERSION,
    release: {
      tagName: 'v' + APP_VERSION,
      name: 'Mineradio v' + APP_VERSION,
      version: APP_VERSION,
      htmlUrl: '',
      downloadUrl: '',
      summary: '当前版本，更新检测已就绪。',
      notes: UPDATE_FALLBACK_NOTES,
    },
    reason: reason || '',
  };
}
function updateError(code, message, cause) {
  const err = new Error(message || code);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}
function classifyUpdateError(err) {
  const code = String(err && err.code || '').trim();
  const message = String(err && err.message || err || '').trim();
  const detail = message || code || '未知错误';
  if (/HASH|DIGEST|CHECKSUM/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_HASH_MISMATCH', reason: '文件校验失败，可能是线路缓存异常，已拦截该安装包。', detail };
  }
  if (/SIZE_MISMATCH|content length/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_SIZE_MISMATCH', reason: '下载文件大小不一致，可能是网络中断或线路缓存不完整。', detail };
  }
  if (/AbortError|TIMEOUT|ETIMEDOUT|timeout/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_TIMEOUT', reason: '连接超时，当前网络到更新线路不稳定。', detail };
  }
  if (/ENOTFOUND|EAI_AGAIN|DNS|fetch failed|getaddrinfo/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_DNS_FAILED', reason: '域名解析失败，可能是当前网络无法连接该更新线路。', detail };
  }
  if (/ECONNRESET|ECONNREFUSED|socket|network/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_NETWORK_FAILED', reason: '网络连接被中断，已尝试切换更新线路。', detail };
  }
  const http = message.match(/\bHTTP[_\s-]?(\d{3})\b/i) || message.match(/\b(\d{3})\b/);
  if (http) {
    const status = Number(http[1]);
    if (status === 403) return { code: code || 'UPDATE_HTTP_403', reason: '更新线路返回 403，可能被限流或拦截。', detail };
    if (status === 404) return { code: code || 'UPDATE_HTTP_404', reason: '更新文件不存在，可能 release 资源还没有同步完成。', detail };
    if (status >= 500) return { code: code || 'UPDATE_HTTP_5XX', reason: '更新线路服务器异常，请稍后重试。', detail };
    return { code: code || ('UPDATE_HTTP_' + status), reason: '更新线路返回 HTTP ' + status + '。', detail };
  }
  return { code: code || 'UPDATE_FAILED', reason: '更新失败：' + detail, detail };
}
async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 12000);
  try {
    return await fetch(url, Object.assign({}, opts || {}, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}
async function fetchTextFromCandidates(candidates, timeoutMs) {
  const list = Array.isArray(candidates) && candidates.length ? candidates : [];
  const failures = [];
  for (let i = 0; i < list.length; i++) {
    const candidate = list[i];
    try {
      const resp = await fetchWithTimeout(candidate.url, {
        headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
      }, timeoutMs || 6500);
      if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status);
      return { text: await resp.text(), candidate };
    } catch (err) {
      const info = classifyUpdateError(err);
      failures.push(candidate.label + ': ' + info.reason);
    }
  }
  throw updateError('UPDATE_ALL_LINES_FAILED', failures.join('；') || 'All update lines failed');
}
function yamlScalar(text, key) {
  const pattern = new RegExp('^\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*(.+?)\\s*$', 'm');
  const match = String(text || '').match(pattern);
  if (!match) return '';
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}
function githubReleaseDownloadUrl(version, fileName) {
  const tag = 'v' + normalizeVersion(version);
  const encodedOwner = encodeURIComponent(UPDATE_CONFIG.owner);
  const encodedRepo = encodeURIComponent(UPDATE_CONFIG.repo);
  const encodedName = String(fileName || '').split('/').map(part => encodeURIComponent(part)).join('/');
  return `https://github.com/${encodedOwner}/${encodedRepo}/releases/download/${tag}/${encodedName}`;
}
function parseLatestYmlUpdateInfo(text, reason) {
  const latestVersion = normalizeVersion(yamlScalar(text, 'version') || APP_VERSION) || APP_VERSION;
  const assetPath = yamlScalar(text, 'path') || yamlScalar(text, 'url') || `Mineradio-${latestVersion}-Setup.exe`;
  const sha512 = normalizeDigest(yamlScalar(text, 'sha512'), 'sha512');
  const size = Number(yamlScalar(text, 'size') || 0) || 0;
  const releaseDate = yamlScalar(text, 'releaseDate');
  const downloadUrl = githubReleaseDownloadUrl(latestVersion, assetPath);
  const candidates = uniqueDownloadCandidates(downloadUrl);
  const asset = {
    name: updateAssetNameFromUrl(downloadUrl) || assetPath,
    size,
    contentType: 'application/octet-stream',
    downloadUrl,
    downloadUrls: publicDownloadUrls(candidates),
    sha256: '',
    sha512,
  };
  return {
    configured: true,
    preview: false,
    updateAvailable: compareVersions(latestVersion, APP_VERSION) > 0,
    currentVersion: APP_VERSION,
    latestVersion,
    release: {
      tagName: 'v' + latestVersion,
      name: 'Mineradio v' + latestVersion,
      version: latestVersion,
      publishedAt: releaseDate,
      htmlUrl: `https://github.com/${UPDATE_CONFIG.owner}/${UPDATE_CONFIG.repo}/releases/tag/v${latestVersion}`,
      downloadUrl,
      asset,
      patch: null,
      patchAvailable: false,
      summary: '发现新版本，已启用备用更新线路。',
      notes: ['更新检测已切换到备用线路', '下载时会自动选择国内加速线路', '下载失败会显示具体原因和当前速度'],
    },
    source: 'latest-yml',
    reason: reason || '',
  };
}
async function fetchLatestYmlUpdateInfo(reason) {
  if (!UPDATE_CONFIG.configured || UPDATE_CONFIG.provider !== 'github') throw updateError('UPDATE_REPOSITORY_NOT_CONFIGURED');
  const latestYmlUrl = `https://github.com/${encodeURIComponent(UPDATE_CONFIG.owner)}/${encodeURIComponent(UPDATE_CONFIG.repo)}/releases/latest/download/latest.yml`;
  const candidates = uniqueDownloadCandidates(latestYmlUrl);
  const result = await fetchTextFromCandidates(candidates, 6500);
  return parseLatestYmlUpdateInfo(result.text, reason);
}
async function fetchLatestUpdateInfo() {
  const testManifest = readLocalTestUpdateManifest();
  if (testManifest) return normalizeManifestUpdateInfo(testManifest);
  if (UPDATE_CONFIG.manifest) return fetchManifestUpdateInfo(UPDATE_CONFIG.manifest);
  if (!UPDATE_CONFIG.configured || UPDATE_CONFIG.provider !== 'github') return localUpdateFallback();
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(UPDATE_CONFIG.owner)}/${encodeURIComponent(UPDATE_CONFIG.repo)}/releases/latest`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);
  try {
    const resp = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': `Mineradio/${APP_VERSION}`,
        'Accept': 'application/vnd.github+json',
      },
    });
    if (!resp.ok) {
      try { return await fetchLatestYmlUpdateInfo('GitHub Releases ' + resp.status); }
      catch (_) { return localUpdateFallback('GitHub Releases ' + resp.status, { configured: true }); }
    }
    const data = await resp.json();
    const releaseVersion = normalizeVersion(data.tag_name || data.name || APP_VERSION) || APP_VERSION;
    const asset = pickReleaseAsset(data.assets);
    const latestVersion = effectiveReleaseVersion(releaseVersion, asset);
    const patch = pickPatchAsset(data.assets, APP_VERSION, latestVersion);
    const notes = extractReleaseNotes(data.body).length ? extractReleaseNotes(data.body) : UPDATE_FALLBACK_NOTES;
    return {
      configured: true,
      preview: false,
      updateAvailable: compareVersions(latestVersion, APP_VERSION) > 0,
      currentVersion: APP_VERSION,
      latestVersion,
      release: {
        tagName: data.tag_name || ('v' + latestVersion),
        name: data.name || ('Mineradio v' + latestVersion),
        version: latestVersion,
        publishedAt: data.published_at || '',
        htmlUrl: data.html_url || '',
        downloadUrl: asset ? asset.downloadUrl : '',
        asset,
        patch,
        patchAvailable: !!(patch && patch.downloadUrl && compareVersions(latestVersion, APP_VERSION) > 0),
        summary: notes[0] || '发现新版本，建议更新。',
        notes,
      },
    };
  } catch (err) {
    const reason = err && err.message || 'Update check failed';
    try { return await fetchLatestYmlUpdateInfo(reason); }
    catch (fallbackErr) { return localUpdateFallback((fallbackErr && fallbackErr.message) || reason, { configured: true }); }
  } finally {
    clearTimeout(timer);
  }
}
function safeUpdateFileName(name, version) {
  const raw = String(name || '').trim() || `Mineradio-${version || APP_VERSION}.exe`;
  const cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return cleaned || `Mineradio-${version || APP_VERSION}.exe`;
}
function publicUpdateJob(job) {
  if (!job) return { ok: false, error: 'UPDATE_JOB_NOT_FOUND' };
  return {
    ok: job.status !== 'error',
    id: job.id,
    status: job.status,
    progress: job.progress || 0,
    received: job.received || 0,
    total: job.total || 0,
    speedBps: job.speedBps || 0,
    etaSeconds: job.etaSeconds || 0,
    sourceLabel: job.sourceLabel || '',
    attempt: job.attempt || 0,
    attempts: job.attempts || 0,
    mode: job.mode || 'installer',
    message: job.message || '',
    restartRequired: !!job.restartRequired,
    cached: !!job.cached,
    fileName: job.fileName || '',
    filePath: job.status === 'ready' ? job.filePath : '',
    version: job.version || '',
    releaseUrl: job.releaseUrl || '',
    error: job.error || '',
    errorReason: job.errorReason || '',
    errorDetail: job.errorDetail || '',
    failedAttempts: Array.isArray(job.failedAttempts) ? job.failedAttempts.slice(0, 6) : [],
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
function activeUpdateJobFor(version) {
  const jobs = Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return jobs.find(job => job.version === version && (job.status === 'queued' || job.status === 'downloading' || job.status === 'ready'));
}
function trimUpdateJobs() {
  const jobs = Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  jobs.slice(8).forEach(job => updateDownloadJobs.delete(job.id));
}
async function downloadUpdateAsset(job) {
  const tmpPath = job.filePath + '.download';
  try {
    fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
    job.status = 'downloading';
    job.updatedAt = Date.now();

    const resp = await fetch(job.downloadUrl, {
      headers: {
        'User-Agent': `Mineradio/${APP_VERSION}`,
      },
    });
    if (!resp.ok) throw new Error('Download failed ' + resp.status);

    const totalHeader = parseInt(resp.headers.get('content-length') || '0', 10) || 0;
    job.total = totalHeader || job.total || 0;
    job.received = 0;
    job.progress = 0;
    job.speedBps = 0;
    job.etaSeconds = 0;
    job.message = job.total ? '正在下载完整安装包' : '正在下载完整安装包，等待服务器返回大小';
    job.updatedAt = Date.now();
    let speedWindowAt = Date.now();
    let speedWindowBytes = 0;

    const writer = fs.createWriteStream(tmpPath);
    const reader = resp.body.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const buf = Buffer.from(chunk.value);
        job.received += buf.length;
        speedWindowBytes += buf.length;
        const now = Date.now();
        if (now - speedWindowAt >= 900) {
          job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000));
          speedWindowAt = now;
          speedWindowBytes = 0;
        }
        if (job.total > 0) {
          job.progress = Math.max(1, Math.min(99, Math.round((job.received / job.total) * 100)));
          job.etaSeconds = job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0;
        } else {
          const kb = Math.max(1, job.received / 1024);
          job.progress = Math.max(1, Math.min(88, Math.round(Math.log10(kb + 1) * 24)));
        }
        job.message = job.total > 0 ? '正在下载完整安装包' : '正在下载完整安装包，服务器未提供总大小';
        job.updatedAt = Date.now();
        if (!writer.write(buf)) await once(writer, 'drain');
      }
    } finally {
      writer.end();
      await once(writer, 'finish').catch(() => {});
    }

    if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
    fs.renameSync(tmpPath, job.filePath);
    job.status = 'ready';
    job.progress = 100;
    job.message = '安装包已下载';
    job.updatedAt = Date.now();
  } catch (e) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    job.status = 'error';
    job.error = e.message || 'UPDATE_DOWNLOAD_FAILED';
    job.updatedAt = Date.now();
  }
}
function sha512Base64(buffer) {
  return crypto.createHash('sha512').update(buffer).digest('base64');
}
function sha512Hex(buffer) {
  return crypto.createHash('sha512').update(buffer).digest('hex');
}
function verifyUpdateBuffer(buffer, job) {
  const expectedSize = Number(job.expectedSize || job.total || 0) || 0;
  if (expectedSize > 0 && buffer.length !== expectedSize) {
    throw updateError('UPDATE_SIZE_MISMATCH', `Expected ${expectedSize} bytes, got ${buffer.length}`);
  }
  const expectedSha256 = normalizeDigest(job.sha256 || '', 'sha256').toLowerCase();
  if (expectedSha256 && sha256Hex(buffer) !== expectedSha256) {
    throw updateError('UPDATE_SHA256_MISMATCH', 'Downloaded sha256 mismatch');
  }
  const expectedSha512 = normalizeDigest(job.sha512 || '', 'sha512');
  if (expectedSha512) {
    const actualBase64 = sha512Base64(buffer);
    const actualHex = sha512Hex(buffer).toLowerCase();
    if (actualBase64 !== expectedSha512 && actualHex !== expectedSha512.toLowerCase()) {
      throw updateError('UPDATE_SHA512_MISMATCH', 'Downloaded sha512 mismatch');
    }
  }
}
function verifyUpdateFile(filePath, job) {
  verifyUpdateBuffer(fs.readFileSync(filePath), job);
}
function moveInvalidUpdateFile(filePath, reason) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return;
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const invalidPath = path.join(dir, `${base}.invalid-${Date.now()}${ext || '.bin'}`);
    fs.renameSync(filePath, invalidPath);
    console.warn('[UpdateDownload] cached installer moved aside:', reason || 'invalid', invalidPath);
  } catch (e) {
    console.warn('[UpdateDownload] failed to move invalid cached installer:', e.message);
  }
}
function reuseVerifiedInstallerJob(opts) {
  if (!opts || !opts.filePath || !fs.existsSync(opts.filePath)) return null;
  if (!opts.expectedSize && !opts.sha256 && !opts.sha512) return null;
  const now = Date.now();
  const stat = fs.statSync(opts.filePath);
  const job = {
    id: 'cached-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'ready',
    progress: 100,
    received: stat.size || 0,
    total: opts.expectedSize || stat.size || 0,
    speedBps: 0,
    etaSeconds: 0,
    sourceLabel: '本地缓存',
    attempt: 0,
    attempts: opts.attempts || 0,
    mode: 'installer',
    message: '安装包已下载，可直接打开安装',
    fileName: opts.fileName || path.basename(opts.filePath),
    filePath: opts.filePath,
    version: opts.version || '',
    downloadUrl: opts.downloadUrl || '',
    downloadCandidates: opts.downloadCandidates || [],
    expectedSize: opts.expectedSize || 0,
    sha256: opts.sha256 || '',
    sha512: opts.sha512 || '',
    releaseUrl: opts.releaseUrl || '',
    failedAttempts: [],
    cached: true,
    createdAt: now,
    updatedAt: now,
    error: '',
  };
  try {
    verifyUpdateFile(opts.filePath, job);
    updateDownloadJobs.set(job.id, job);
    trimUpdateJobs();
    return job;
  } catch (err) {
    moveInvalidUpdateFile(opts.filePath, (err && err.message) || 'cache verification failed');
    return null;
  }
}
function setUpdateJobError(job, err, fallbackMessage) {
  const info = classifyUpdateError(err);
  job.status = 'error';
  job.error = info.code;
  job.errorReason = info.reason;
  job.errorDetail = info.detail;
  job.message = fallbackMessage || info.reason;
  job.updatedAt = Date.now();
}
function prepareUpdateJobAttempt(job, candidate, index, total) {
  job.status = 'downloading';
  job.sourceLabel = candidate.label || '下载线路';
  job.attempt = index + 1;
  job.attempts = total;
  job.received = 0;
  job.speedBps = 0;
  job.etaSeconds = 0;
  job.error = '';
  job.errorReason = '';
  job.errorDetail = '';
  job.updatedAt = Date.now();
}
function ensureMirrorCanBeVerified(job, candidate) {
  if (!candidate || !candidate.mirrored) return;
  if (job.sha256 || job.sha512) return;
  throw updateError('MIRROR_HASH_MISSING', 'Mirror download skipped because no digest is available');
}
async function downloadUpdateAssetWithMirrors(job) {
  const tmpPath = job.filePath + '.download';
  const candidates = Array.isArray(job.downloadCandidates) && job.downloadCandidates.length
    ? job.downloadCandidates
    : uniqueDownloadCandidates(job.downloadUrl || '');
  const failures = [];
  fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
      ensureMirrorCanBeVerified(job, candidate);
      prepareUpdateJobAttempt(job, candidate, i, candidates.length);
      job.message = job.total ? '正在下载完整安装包' : '正在下载完整安装包，等待服务器返回大小';

      const resp = await fetchWithTimeout(candidate.url, {
        headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
      }, 14000);
      if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status);

      const totalHeader = parseInt(resp.headers.get('content-length') || '0', 10) || 0;
      job.total = totalHeader || job.expectedSize || job.total || 0;
      job.progress = 0;
      job.updatedAt = Date.now();
      let speedWindowAt = Date.now();
      let speedWindowBytes = 0;

      const writer = fs.createWriteStream(tmpPath);
      const reader = resp.body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const buf = Buffer.from(chunk.value);
          job.received += buf.length;
          speedWindowBytes += buf.length;
          const now = Date.now();
          if (now - speedWindowAt >= 900) {
            job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000));
            speedWindowAt = now;
            speedWindowBytes = 0;
          }
          if (job.total > 0) {
            job.progress = Math.max(1, Math.min(99, Math.round((job.received / job.total) * 100)));
            job.etaSeconds = job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0;
          } else {
            const kb = Math.max(1, job.received / 1024);
            job.progress = Math.max(1, Math.min(88, Math.round(Math.log10(kb + 1) * 24)));
          }
          job.message = job.total > 0 ? '正在下载完整安装包' : '正在下载完整安装包，服务器未提供总大小';
          job.updatedAt = Date.now();
          if (!writer.write(buf)) await once(writer, 'drain');
        }
      } finally {
        writer.end();
        await once(writer, 'finish').catch(() => {});
      }

      verifyUpdateFile(tmpPath, job);
      if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
      fs.renameSync(tmpPath, job.filePath);
      job.status = 'ready';
      job.progress = 100;
      job.etaSeconds = 0;
      job.message = '安装包已下载';
      job.updatedAt = Date.now();
      return;
    } catch (err) {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
      const info = classifyUpdateError(err);
      failures.push({ source: candidate.label || '下载线路', reason: info.reason, detail: info.detail });
      job.failedAttempts = failures.slice(-6);
      job.message = i < candidates.length - 1 ? ((candidate.label || '当前线路') + '失败，正在切换线路') : info.reason;
      job.updatedAt = Date.now();
      if (i >= candidates.length - 1) setUpdateJobError(job, err, '下载失败：' + info.reason);
    }
  }
}
function startUpdateDownloadJob(info) {
  const release = info && info.release ? info.release : {};
  const asset = release.asset || {};
  const downloadUrl = release.downloadUrl || asset.downloadUrl || '';
  if (!info || !info.configured) return { ok: false, error: 'UPDATE_REPOSITORY_NOT_CONFIGURED' };
  if (!info.updateAvailable) return { ok: false, error: 'NO_UPDATE_AVAILABLE' };
  if (!/^https?:\/\//i.test(downloadUrl)) return { ok: false, error: 'UPDATE_ASSET_MISSING' };

  const version = info.latestVersion || release.version || '';
  const existing = activeUpdateJobFor(version);
  if (existing) return publicUpdateJob(existing);

  const fileName = safeUpdateFileName(asset.name || '', version);
  const filePath = path.join(UPDATE_DOWNLOAD_DIR, fileName);
  const downloadCandidates = uniqueDownloadCandidates([downloadUrl].concat(Array.isArray(asset.downloadUrls) ? asset.downloadUrls : []));
  const expectedSize = asset.size || 0;
  const sha256 = normalizeDigest(asset.sha256 || '', 'sha256').toLowerCase();
  const sha512 = normalizeDigest(asset.sha512 || '', 'sha512');
  const cached = reuseVerifiedInstallerJob({
    fileName,
    filePath,
    version,
    downloadUrl,
    downloadCandidates,
    expectedSize,
    sha256,
    sha512,
    releaseUrl: release.htmlUrl || '',
    attempts: downloadCandidates.length,
  });
  if (cached) return publicUpdateJob(cached);

  const now = Date.now();
  const job = {
    id: now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'queued',
    progress: 0,
    received: 0,
    total: expectedSize,
    mode: 'installer',
    fileName,
    filePath,
    version,
    downloadUrl,
    downloadCandidates,
    expectedSize,
    sha256,
    sha512,
    releaseUrl: release.htmlUrl || '',
    sourceLabel: '',
    attempt: 0,
    attempts: downloadCandidates.length,
    failedAttempts: [],
    createdAt: now,
    updatedAt: now,
    error: '',
  };
  updateDownloadJobs.set(job.id, job);
  trimUpdateJobs();
  downloadUpdateAssetWithMirrors(job);
  return publicUpdateJob(job);
}
function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
function safePatchRelativePath(value) {
  const rel = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!rel || rel.includes('\0')) return '';
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '..' || part === '.')) return '';
  const root = parts[0];
  if (PATCH_ALLOWED_FILES.has(rel)) return rel;
  if (!PATCH_ALLOWED_ROOTS.has(root)) return '';
  if (/\.(exe|dll|node|msi|bat|cmd|ps1|pfx|pem|key)$/i.test(rel)) return '';
  return parts.join('/');
}
function patchTargetPath(rel) {
  const safeRel = safePatchRelativePath(rel);
  if (!safeRel) return null;
  const target = path.resolve(__dirname, safeRel);
  const root = path.resolve(__dirname);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}
function decodePatchFile(file) {
  if (!file || typeof file !== 'object') return null;
  if (typeof file.contentBase64 === 'string') return Buffer.from(file.contentBase64, 'base64');
  if (typeof file.content === 'string') return Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8');
  return null;
}
function backupPatchTarget(job, rel, target) {
  if (!fs.existsSync(target)) return;
  const backup = path.join(UPDATE_PATCH_BACKUP_DIR, job.id, rel);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(target, backup);
}
function writePatchFile(job, file) {
  const rel = safePatchRelativePath(file.path || file.name);
  const target = rel ? patchTargetPath(rel) : null;
  const content = decodePatchFile(file);
  if (!rel || !target || !content) throw new Error('INVALID_PATCH_FILE');
  if (content.length > PATCH_MAX_BYTES) throw new Error('PATCH_FILE_TOO_LARGE');
  const expected = String(file.sha256 || '').trim().toLowerCase();
  const actual = sha256Hex(content);
  if (expected && expected !== actual) throw new Error('PATCH_HASH_MISMATCH:' + rel);
  backupPatchTarget(job, rel, target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.mineradio-patch';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, target);
  if (expected && sha256Hex(fs.readFileSync(target)) !== expected) throw new Error('PATCH_WRITE_VERIFY_FAILED:' + rel);
  return rel;
}
function normalizePatchPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('INVALID_PATCH_PAYLOAD');
  const type = String(payload.type || payload.kind || '');
  if (type && type !== 'mineradio-resource-patch') throw new Error('UNSUPPORTED_PATCH_TYPE');
  const from = normalizeVersion(payload.from || payload.baseVersion || '');
  const to = normalizeVersion(payload.to || payload.version || payload.targetVersion || '');
  const files = Array.isArray(payload.files) ? payload.files : [];
  if (!from || compareVersions(from, APP_VERSION) !== 0) throw new Error('PATCH_VERSION_MISMATCH');
  if (!to || compareVersions(to, APP_VERSION) <= 0) throw new Error('PATCH_TARGET_VERSION_INVALID');
  if (!files.length) throw new Error('PATCH_EMPTY');
  if (files.length > 40) throw new Error('PATCH_TOO_MANY_FILES');
  return { from, to, files, restartRequired: payload.restartRequired !== false };
}
async function downloadAndApplyPatch(job) {
  const chunks = [];
  try {
    fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
    job.status = 'downloading';
    job.mode = 'patch';
    job.message = '正在下载快速补丁';
    job.updatedAt = Date.now();

    const resp = await fetch(job.downloadUrl, {
      headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
    });
    if (!resp.ok) throw new Error('Patch download failed ' + resp.status);

    job.total = parseInt(resp.headers.get('content-length') || '0', 10) || job.total || 0;
    job.received = 0;
    const reader = resp.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const buf = Buffer.from(chunk.value);
      job.received += buf.length;
      if (job.received > PATCH_MAX_BYTES) throw new Error('PATCH_TOO_LARGE');
      chunks.push(buf);
      job.progress = job.total > 0
        ? Math.max(1, Math.min(84, Math.round((job.received / job.total) * 84)))
        : Math.max(1, Math.min(76, Math.round(Math.log10(job.received / 1024 + 1) * 24)));
      job.updatedAt = Date.now();
    }

    const raw = Buffer.concat(chunks);
    const expectedPatchHash = String(job.sha256 || '').trim().toLowerCase();
    if (expectedPatchHash && sha256Hex(raw) !== expectedPatchHash) throw new Error('PATCH_PACKAGE_HASH_MISMATCH');
    const patch = normalizePatchPayload(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')));
    job.version = patch.to;
    job.message = '正在应用快速补丁';
    job.progress = 88;
    job.updatedAt = Date.now();
    const changed = [];
    patch.files.forEach(file => changed.push(writePatchFile(job, file)));
    job.changedFiles = changed;
    job.status = 'ready';
    job.progress = 100;
    job.restartRequired = patch.restartRequired;
    job.message = patch.restartRequired ? '快速补丁已应用，重启后生效' : '快速补丁已应用';
    job.updatedAt = Date.now();
  } catch (e) {
    job.status = 'error';
    job.error = e.message || 'PATCH_APPLY_FAILED';
    job.message = '快速补丁失败，可改用完整安装包';
    job.updatedAt = Date.now();
  }
}
async function downloadPatchBufferFromCandidate(job, candidate, index, total) {
  ensureMirrorCanBeVerified(job, candidate);
  prepareUpdateJobAttempt(job, candidate, index, total);
  job.mode = 'patch';
  job.message = '正在下载快速补丁';
  job.progress = 0;
  job.updatedAt = Date.now();

  const resp = await fetchWithTimeout(candidate.url, {
    headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
  }, 12000);
  if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status);

  job.total = parseInt(resp.headers.get('content-length') || '0', 10) || job.expectedSize || job.total || 0;
  job.received = 0;
  const chunks = [];
  const reader = resp.body.getReader();
  let speedWindowAt = Date.now();
  let speedWindowBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    const buf = Buffer.from(chunk.value);
    job.received += buf.length;
    speedWindowBytes += buf.length;
    if (job.received > PATCH_MAX_BYTES) throw updateError('PATCH_TOO_LARGE', 'Patch package is too large');
    chunks.push(buf);
    const now = Date.now();
    if (now - speedWindowAt >= 700) {
      job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000));
      speedWindowAt = now;
      speedWindowBytes = 0;
    }
    job.progress = job.total > 0
      ? Math.max(1, Math.min(84, Math.round((job.received / job.total) * 84)))
      : Math.max(1, Math.min(76, Math.round(Math.log10(job.received / 1024 + 1) * 24)));
    job.etaSeconds = job.total > 0 && job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0;
    job.updatedAt = Date.now();
  }
  const raw = Buffer.concat(chunks);
  verifyUpdateBuffer(raw, job);
  return raw;
}
async function downloadAndApplyPatchWithMirrors(job) {
  const candidates = Array.isArray(job.downloadCandidates) && job.downloadCandidates.length
    ? job.downloadCandidates
    : uniqueDownloadCandidates(job.downloadUrl || '');
  const failures = [];
  fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      const raw = await downloadPatchBufferFromCandidate(job, candidate, i, candidates.length);
      const patch = normalizePatchPayload(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')));
      job.version = patch.to;
      job.message = '正在应用快速补丁';
      job.progress = 88;
      job.etaSeconds = 0;
      job.updatedAt = Date.now();
      const changed = [];
      patch.files.forEach(file => changed.push(writePatchFile(job, file)));
      job.changedFiles = changed;
      job.status = 'ready';
      job.progress = 100;
      job.restartRequired = patch.restartRequired;
      job.message = patch.restartRequired ? '快速补丁已应用，重启后生效' : '快速补丁已应用';
      job.updatedAt = Date.now();
      return;
    } catch (err) {
      const info = classifyUpdateError(err);
      failures.push({ source: candidate.label || '下载线路', reason: info.reason, detail: info.detail });
      job.failedAttempts = failures.slice(-6);
      job.message = i < candidates.length - 1 ? ((candidate.label || '当前线路') + '失败，正在切换线路') : info.reason;
      job.updatedAt = Date.now();
      if (i >= candidates.length - 1) setUpdateJobError(job, err, '快速补丁失败：' + info.reason);
    }
  }
}
function startUpdatePatchJob(info) {
  const release = info && info.release ? info.release : {};
  const patch = release.patch || {};
  const downloadUrl = patch.downloadUrl || '';
  if (!info || !info.configured) return { ok: false, error: 'UPDATE_REPOSITORY_NOT_CONFIGURED' };
  if (!info.updateAvailable) return { ok: false, error: 'NO_UPDATE_AVAILABLE' };
  if (!release.patchAvailable || !/^https?:\/\//i.test(downloadUrl)) return { ok: false, error: 'PATCH_ASSET_MISSING' };

  const version = info.latestVersion || release.version || patch.to || '';
  const existing = Array.from(updateDownloadJobs.values())
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .find(job => job.mode === 'patch' && job.version === version && (job.status === 'queued' || job.status === 'downloading' || job.status === 'ready'));
  if (existing) return publicUpdateJob(existing);

  const now = Date.now();
  const downloadCandidates = uniqueDownloadCandidates([downloadUrl].concat(Array.isArray(patch.downloadUrls) ? patch.downloadUrls : []));
  const job = {
    id: 'patch-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'queued',
    progress: 0,
    received: 0,
    total: patch.size || 0,
    mode: 'patch',
    fileName: patch.name || safeUpdateFileName('', version).replace(/\.exe$/i, '.patch.json'),
    filePath: '',
    version,
    downloadUrl,
    downloadCandidates,
    releaseUrl: release.htmlUrl || '',
    expectedSize: patch.size || 0,
    sha256: normalizeDigest(patch.sha256 || '', 'sha256').toLowerCase(),
    sha512: normalizeDigest(patch.sha512 || '', 'sha512'),
    restartRequired: true,
    sourceLabel: '',
    attempt: 0,
    attempts: downloadCandidates.length,
    failedAttempts: [],
    message: '等待下载快速补丁',
    createdAt: now,
    updatedAt: now,
    error: '',
  };
  updateDownloadJobs.set(job.id, job);
  trimUpdateJobs();
  downloadAndApplyPatchWithMirrors(job);
  return publicUpdateJob(job);
}
function readRequestBody(req) {
  return new Promise(resolve => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 8 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch (e) {
        const params = new URLSearchParams(raw);
        const out = {};
        params.forEach((v, k) => { out[k] = v; });
        resolve(out);
      }
    });
    req.on('error', () => resolve({}));
  });
}

// ====================================================================
//  Daily hot 30 recommendation
// ====================================================================
const DAILY_HOT_CACHE_MS = 6 * 60 * 60 * 1000;
let dailyHotCache = null;
function dailyHotDurationText(seconds) {
  seconds = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function dailyHotNormalizeText(value) {
  return String(value || '').toLowerCase().replace(/&amp;/g, '&').replace(/[\s·•・,，、/\\|_\-]+/g, ' ').trim();
}
function dailyHotSingers(value) {
  if (!Array.isArray(value)) return String(value || '');
  return value.map(item => item && (item.name || item.singerName)).filter(Boolean).join('、');
}
async function dailyHotFetchJson(targetUrl, options = {}) {
  const fetchImpl = electronNet && typeof electronNet.fetch === 'function'
    ? electronNet.fetch.bind(electronNet)
    : globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('FETCH_UNAVAILABLE');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs) || 12000);
  try {
    const response = await fetchImpl(targetUrl, {
      method: options.method || 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'referer': 'https://music.163.com/',
        ...(options.headers || {}),
      },
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
function dailyHotSongFromNeteaseTrack(item) {
  item = item || {};
  const album = item.album || item.al || {};
  const durationMs = Number(item.duration == null ? item.dt : item.duration) || 0;
  return {
    id: item.id,
    songmid: item.id,
    name: item.name || '',
    singer: dailyHotSingers(item.artists || item.ar),
    albumName: album.name || '',
    albumId: album.id || '',
    picUrl: album.picUrl || '',
    interval: dailyHotDurationText(durationMs / 1000),
    source: 'wy',
    types: ['flac', '320k', '128k'],
  };
}
function dailyHotSongKey(song) {
  song = song || {};
  return [
    String(song.source || '').toLowerCase(),
    String(song.songmid || song.id || song.hash || song.copyrightId || ''),
    dailyHotNormalizeText(song.name),
    dailyHotNormalizeText(song.singer || song.artist),
  ].join('|');
}
function dailyHotPushUnique(list, song, seen, limit) {
  if (!song || !song.name || list.length >= limit) return false;
  const key = dailyHotSongKey(song);
  if (seen.has(key)) return false;
  seen.add(key);
  list.push(song);
  return true;
}
async function fetchNeteaseHotSeeds(limit) {
  const endpoints = [
    'https://music.163.com/api/playlist/detail?id=3778678',
    'https://music.163.com/api/v6/playlist/detail?id=3778678',
  ];
  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const data = await dailyHotFetchJson(endpoint, { timeoutMs: 14000 });
      const tracks = data?.result?.tracks || data?.playlist?.tracks || [];
      const songs = tracks.map(dailyHotSongFromNeteaseTrack).filter(song => song.name);
      if (songs.length) return songs.slice(0, limit);
    } catch (err) {
      lastError = err;
      console.warn('[DailyHotSeeds]', endpoint, err.message || err);
    }
  }
  if (lastError) throw lastError;
  return [];
}
const DAILY_HOT_FALLBACK_SEEDS = [
  ['句号', 'G.E.M.邓紫棋'], ['悬溺', '葛东琪'], ['若月亮没来', '王宇宙Leto / 乔浚丞'], ['凄美地', '郭顶'],
  ['离别开出花', '就是南方凯'], ['唯一', '告五人'], ['不如见一面', '海来阿木'], ['晴天', '周杰伦'],
  ['起风了', '买辣椒也用券'], ['可能', '程响'], ['后来', '刘若英'], ['反方向的钟', '周杰伦'],
  ['你不是真正的快乐', '五月天'], ['如愿', '王菲'], ['嘉宾', '张远'], ['爱人错过', '告五人'],
  ['一路生花', '温奕心'], ['我记得', '赵雷'], ['Night Dancer', 'imase'], ['APT.', 'ROSÉ / Bruno Mars'],
  ['Die With A Smile', 'Lady Gaga / Bruno Mars'], ['Espresso', 'Sabrina Carpenter'], ['Birds of a Feather', 'Billie Eilish'], ['Lose Control', 'Teddy Swims'],
  ['Cruel Summer', 'Taylor Swift'], ['Seven', 'Jung Kook'], ['Supernova', 'aespa'], ['Drama', 'aespa'],
  ['Magnetic', 'ILLIT'], ['Ditto', 'NewJeans'], ['青花瓷', '周杰伦'], ['稻香', '周杰伦'],
].map(([name, singer]) => ({ name, singer, source: 'wy', songmid: '', id: '', interval: '', types: ['flac', '320k', '128k'] }));
async function resolveDailyHotSeedsAcrossSources(seeds, limit) {
  const out = [];
  const seen = new Set();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, seeds.length) }, async () => {
    while (cursor < seeds.length && out.length < limit) {
      const seed = seeds[cursor++];
      const query = [seed.name, seed.singer].filter(Boolean).join(' ');
      try {
        const result = await lxSearch.searchAll(query || seed.name, { sources: 'tx,wy,kw,kg,mg', limit: 5 });
        const candidates = Array.isArray(result?.songs) ? result.songs : [];
        const seedName = dailyHotNormalizeText(seed.name);
        const seedSinger = dailyHotNormalizeText(seed.singer);
        const exact = candidates.find(song => {
          const sameName = dailyHotNormalizeText(song.name) === seedName;
          const singer = dailyHotNormalizeText(song.singer);
          return sameName && (!seedSinger || !singer || seedSinger.includes(singer) || singer.includes(seedSinger));
        });
        dailyHotPushUnique(out, exact || candidates[0] || seed, seen, limit);
      } catch (err) {
        console.warn('[DailyHotResolve]', query, err.message || err);
        dailyHotPushUnique(out, seed, seen, limit);
      }
    }
  });
  await Promise.all(workers);
  for (const seed of seeds) dailyHotPushUnique(out, seed, seen, limit);
  return out.slice(0, limit);
}
async function getDailyHotSongs(limit) {
  limit = Math.min(Math.max(Number(limit) || 30, 1), 30);
  const now = Date.now();
  if (dailyHotCache && now - dailyHotCache.time < DAILY_HOT_CACHE_MS && dailyHotCache.songs.length >= Math.min(10, limit)) {
    return { ok: true, songs: dailyHotCache.songs.slice(0, limit), cached: true, updatedAt: dailyHotCache.time };
  }
  let seeds = [];
  try {
    seeds = await fetchNeteaseHotSeeds(Math.max(limit, 30));
  } catch (_err) {
    seeds = [];
  }
  if (!seeds.length) seeds = DAILY_HOT_FALLBACK_SEEDS;
  const songs = await resolveDailyHotSeedsAcrossSources(seeds, limit);
  dailyHotCache = { time: now, songs };
  return { ok: songs.length > 0, songs, cached: false, updatedAt: now, source: seeds === DAILY_HOT_FALLBACK_SEEDS ? 'fallback-seeds' : 'netease-hot-3778678+multi-source-search' };
}

// ====================================================================
//  HTTP Server
// ====================================================================
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const pn = url.pathname;

  if (pn === '/api/app/version') {
    sendJSON(res, {
      name: APP_PACKAGE.name || 'mineradio',
      productName: APP_PACKAGE.productName || 'Mineradio',
      version: APP_VERSION,
      update: {
        provider: UPDATE_CONFIG.provider,
        configured: UPDATE_CONFIG.configured,
        owner: UPDATE_CONFIG.owner,
        repo: UPDATE_CONFIG.repo,
        preview: UPDATE_CONFIG.preview,
        manifestOverride: !!UPDATE_CONFIG.manifest,
      },
    });
    return;
  }

  if (pn === '/api/lx-source/status') {
    try {
      sendJSON(res, await lxSourceHost.status());
    } catch (err) {
      sendJSON(res, { ok: false, error: err.message || 'LX_SOURCE_UNAVAILABLE' }, 503);
    }
    return;
  }

  if (pn === '/api/lx-source/resolve') {
    if (req.method !== 'POST') {
      sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      return;
    }
    try {
      const body = await readRequestBody(req);
      const source = String(body.source || '').toLowerCase();
      const musicInfo = body.musicInfo && typeof body.musicInfo === 'object' ? body.musicInfo : {};
      const result = await lxSourceHost.resolveMusicUrl(source, musicInfo, String(body.quality || ''), {
        excludeResolvers: Array.isArray(body.excludeResolvers) ? body.excludeResolvers : [],
      });
      sendJSON(res, { ok: true, source, ...result, proxyUrl: audioProxyUrl(result && result.url, result && result.headers) });
    } catch (err) {
      console.warn('[LXSourceResolve]', err.message);
      sendJSON(res, { ok: false, error: err.message || 'LX_SOURCE_RESOLVE_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/lx-source/lyric') {
    if (req.method !== 'POST') {
      sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      return;
    }
    try {
      const body = await readRequestBody(req);
      const source = String(body.source || '').toLowerCase();
      const musicInfo = body.musicInfo && typeof body.musicInfo === 'object' ? body.musicInfo : {};
      const lyrics = await lxSourceHost.resolveLyrics(source, musicInfo);
      sendJSON(res, { ok: true, source, ...lyrics });
    } catch (err) {
      console.warn('[LXSourceLyric]', err.message);
      sendJSON(res, { ok: false, error: err.message || 'LX_SOURCE_LYRIC_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/platform-lyric') {
    try {
      const source = String(url.searchParams.get('source') || '').toLowerCase();
      const id = String(url.searchParams.get('id') || '');
      const hash = String(url.searchParams.get('hash') || '');
      const albumId = String(url.searchParams.get('albumId') || '');
      const lrcUrl = String(url.searchParams.get('lrcUrl') || '');
      const trcUrl = String(url.searchParams.get('trcUrl') || '');
      const name = String(url.searchParams.get('name') || '').trim();
      const singer = String(url.searchParams.get('singer') || '').trim();
      let lyric = '';
      let tlyric = '';
      let yrc = '';
      if (source === 'tx' && id) {
        const response = await fetch(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(id)}&format=json&nobase64=1`, {
          headers: { Referer: 'https://y.qq.com/', 'User-Agent': 'Mozilla/5.0' },
        });
        const data = response.ok ? await response.json() : {};
        lyric = data.lyric || '';
        tlyric = data.trans || '';
      } else if (source === 'wy' && id) {
        const response = await fetch(`https://music.163.com/api/song/lyric?id=${encodeURIComponent(id)}&lv=1&kv=1&tv=1&yv=1`, {
          headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' },
        });
        const data = response.ok ? await response.json() : {};
        lyric = data?.lrc?.lyric || '';
        tlyric = data?.tlyric?.lyric || '';
        yrc = data?.yrc?.lyric || '';
      } else if (source === 'mg') {
        const normalizeRemoteLyricUrl = value => {
          value = String(value || '').trim();
          if (value.startsWith('//')) return 'https:' + value;
          return value;
        };
        const originalUrl = normalizeRemoteLyricUrl(lrcUrl);
        const translationUrl = normalizeRemoteLyricUrl(trcUrl);
        if (/^https?:\/\//i.test(originalUrl)) {
          const response = await fetch(originalUrl, { headers: { Referer: 'https://m.music.migu.cn/', 'User-Agent': 'Mozilla/5.0' } });
          if (response.ok) lyric = await response.text();
        }
        if (/^https?:\/\//i.test(translationUrl)) {
          const response = await fetch(translationUrl, { headers: { Referer: 'https://m.music.migu.cn/', 'User-Agent': 'Mozilla/5.0' } });
          if (response.ok) tlyric = await response.text();
        }
      } else if (source === 'kg' && hash) {
        const response = await fetch(`https://www.kugou.com/yy/index.php?r=play/getdata&hash=${encodeURIComponent(hash)}&album_id=${encodeURIComponent(albumId)}`, {
          headers: { Referer: 'https://www.kugou.com/' },
        });
        const data = response.ok ? await response.json() : {};
        lyric = data?.data?.lyrics || '';
      } else if (source === 'kw' && id) {
        const response = await fetch(`https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodeURIComponent(id)}`, {
          headers: { Referer: 'https://m.kuwo.cn/' },
        });
        const data = response.ok ? await response.json() : {};
        lyric = (data?.data?.lrclist || []).map(item => {
          const seconds = Number(item.time) || 0;
          const minutes = Math.floor(seconds / 60);
          const rest = (seconds - minutes * 60).toFixed(2).padStart(5, '0');
          return `[${String(minutes).padStart(2, '0')}:${rest}]${item.lineLyric || ''}`;
        }).join('\n');
      }
      // Imported tracks often keep the source platform's original lyric but
      // omit its translated track. Search both Netease and QQ with several
      // title variants, rank candidates, and try candidates until an actual
      // translation is found. This only supplements lyrics; artwork is never
      // read or changed here.
      if (name && ((!lyric && !yrc) || !tlyric)) {
        try {
          const normalizeMatchText = value => String(value || '')
            .normalize('NFKC')
            .replace(/&amp;/gi, '&')
            .replace(/[\s·・•_—–\-‐‑‒―~～,，.。!！?？:：;；'"“”‘’`´/\\|]+/g, '')
            .replace(/[\[\]【】{}<>《》〈〉]/g, '')
            .toLowerCase();
          const hasHangul = value => /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(String(value || ''));
          const lyricLanguageStats = value => {
            const text = String(value || '').replace(/\[[^\]]*\]/g, '');
            const hangul = (text.match(/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g) || []).length;
            const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
            const latin = (text.match(/[a-z]/ig) || []).length;
            return { hangul, cjk, latin };
          };
          const titleVariants = value => {
            const raw = String(value || '').normalize('NFKC').trim();
            const variants = new Set([raw]);
            const withoutFeat = raw
              .replace(/\s*[（(\[]\s*(?:feat\.?|ft\.?|with)\s+[^）)\]]+[）)\]]/ig, '')
              .replace(/\s+(?:feat\.?|ft\.?|with)\s+.+$/ig, '')
              .trim();
            if (withoutFeat) variants.add(withoutFeat);
            const withoutVersion = withoutFeat
              .replace(/\s*[（(\[][^）)\]]*(?:live|remix|mix|ver(?:sion)?\.?|edit|cover|翻唱|伴奏|纯音乐|现场|重制|重录|动画|电影|剧场版)[^）)\]]*[）)\]]\s*$/ig, '')
              .replace(/\s*[-–—]\s*(?:live|remix|mix|ver(?:sion)?\.?|edit|cover|翻唱|伴奏|纯音乐|现场|重制|重录).*/ig, '')
              .trim();
            if (withoutVersion) variants.add(withoutVersion);
            const withoutAllTailBrackets = withoutFeat.replace(/\s*[（(\[].*?[）)\]]\s*$/g, '').trim();
            if (withoutAllTailBrackets) variants.add(withoutAllTailBrackets);
            return Array.from(variants).filter(Boolean);
          };
          const singerParts = value => String(value || '')
            .normalize('NFKC')
            .split(/[、,&，/\\|＋+×xX;；]|\s+(?:feat\.?|ft\.?|with)\s+/i)
            .map(part => normalizeMatchText(part))
            .filter(Boolean);
          const wantedTitles = titleVariants(name);
          const wantedNormalizedTitles = wantedTitles.map(normalizeMatchText).filter(Boolean);
          const wantedSingerParts = singerParts(singer);
          const wantsHangulLyric = hasHangul(name) || hasHangul(singer);
          const searchQueries = [];
          wantedTitles.forEach(title => {
            if (singer) searchQueries.push(`${title} ${singer}`.trim());
            searchQueries.push(title);
          });
          const uniqueQueries = Array.from(new Set(searchQueries.filter(Boolean))).slice(0, 6);
          const candidateMap = new Map();
          for (const queryText of uniqueQueries) {
            const searchResult = await lxSearch.searchAll(queryText, {
              sources: 'wy,tx',
              limit: 20,
            });
            const found = Array.isArray(searchResult.songs) ? searchResult.songs : [];
            found.forEach(item => {
              const key = `${item.source || ''}|${item.songmid || item.id || ''}`;
              if (key !== '|') candidateMap.set(key, item);
            });
          }
          const scoreCandidate = item => {
            const candidateName = normalizeMatchText(item && item.name);
            if (!candidateName) return -999;
            let score = -20;
            if (wantedNormalizedTitles.includes(candidateName)) score = 120;
            else {
              const titleSimilarity = wantedNormalizedTitles.reduce((best, wanted) => {
                if (!wanted) return best;
                if (candidateName.includes(wanted) || wanted.includes(candidateName)) {
                  const shorter = Math.min(candidateName.length, wanted.length);
                  const longer = Math.max(candidateName.length, wanted.length) || 1;
                  return Math.max(best, 70 + Math.round(25 * shorter / longer));
                }
                return best;
              }, -20);
              score = Math.max(score, titleSimilarity);
            }
            const candidateSinger = normalizeMatchText(item && (item.singer || item.artist));
            if (wantedSingerParts.length && candidateSinger) {
              let singerHits = 0;
              wantedSingerParts.forEach(part => {
                if (candidateSinger.includes(part) || part.includes(candidateSinger)) singerHits++;
              });
              score += Math.min(36, singerHits * 18);
            }
            if (String(item && item.source || '') === source) score += 3;
            return score;
          };
          const candidates = Array.from(candidateMap.values())
            .map(item => ({ item, score: scoreCandidate(item) }))
            .filter(entry => entry.score >= 60)
            .sort((a, b) => b.score - a.score)
            .slice(0, 14);
          for (const entry of candidates) {
            const matched = entry.item;
            let candidateLyric = '';
            let candidateYrc = '';
            let candidateTranslation = '';
            try {
              if (matched.source === 'tx') {
                const response = await fetch(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(matched.songmid || matched.id)}&format=json&nobase64=1`, {
                  headers: { Referer: 'https://y.qq.com/', 'User-Agent': 'Mozilla/5.0' },
                });
                const data = response.ok ? await response.json() : {};
                candidateLyric = data.lyric || '';
                candidateTranslation = data.trans || data.translation || '';
              } else if (matched.source === 'wy') {
                const response = await fetch(`https://music.163.com/api/song/lyric?id=${encodeURIComponent(matched.songmid || matched.id)}&lv=1&kv=1&tv=1&yv=1`, {
                  headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' },
                });
                const data = response.ok ? await response.json() : {};
                candidateLyric = data?.lrc?.lyric || '';
                candidateYrc = data?.yrc?.lyric || '';
                // Romanized lyrics are not treated as a translation.
                candidateTranslation = data?.tlyric?.lyric || '';
              }
            } catch (candidateError) {
              console.warn('[PlatformLyricCandidate]', candidateError.message || candidateError);
              continue;
            }
            const stats = lyricLanguageStats(candidateLyric || candidateYrc);
            const likelyWrongKoreanMatch = wantsHangulLyric && stats.cjk > Math.max(8, stats.hangul * 2) && stats.hangul < 4;
            const canUseCandidatePrimary = entry.score >= 132 && !likelyWrongKoreanMatch;
            if (!lyric && !yrc && canUseCandidatePrimary) {
              lyric = candidateLyric || lyric;
              yrc = candidateYrc || yrc;
            }
            if ((lyric || yrc) && candidateTranslation && !likelyWrongKoreanMatch) {
              tlyric = candidateTranslation;
              break;
            }
          }
        } catch (translationError) {
          console.warn('[PlatformLyricTranslationSupplement]', translationError.message || translationError);
        }
      }
      sendJSON(res, { ok: !!(lyric || yrc), lyric, tlyric, yrc });
    } catch (err) {
      sendJSON(res, { ok: false, lyric: '', error: err.message || 'PLATFORM_LYRIC_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/lx-source/import') {
    if (req.method !== 'POST') {
      sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      return;
    }
    try {
      const body = await readRequestBody(req);
      const result = body.url
        ? await lxSourceHost.importSourceUrl(body.url)
        : await lxSourceHost.importSource(body.script, body.fileName);
      sendJSON(res, result);
    } catch (err) {
      sendJSON(res, { ok: false, error: err.message || 'LX_SOURCE_IMPORT_FAILED' }, 400);
    }
    return;
  }

  if (pn === '/api/lx-source/select') {
    if (req.method !== 'POST') {
      sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      return;
    }
    try {
      const body = await readRequestBody(req);
      sendJSON(res, await lxSourceHost.selectSource(body.id));
    } catch (err) {
      sendJSON(res, { ok: false, error: err.message || 'LX_SOURCE_SELECT_FAILED' }, 400);
    }
    return;
  }

  if (pn === '/api/lx-source/delete') {
    if (req.method !== 'POST') {
      sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      return;
    }
    try {
      const body = await readRequestBody(req);
      sendJSON(res, await lxSourceHost.deleteSource(body.id));
    } catch (err) {
      sendJSON(res, { ok: false, error: err.message || 'LX_SOURCE_DELETE_FAILED' }, 400);
    }
    return;
  }

  if (pn === '/api/daily-hot') {
    try {
      const result = await getDailyHotSongs(url.searchParams.get('limit'));
      sendJSON(res, result, result.ok ? 200 : 502);
    } catch (err) {
      sendJSON(res, { ok: false, songs: [], error: err.message || 'DAILY_HOT_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/lx-source/search') {
    try {
      const result = await lxSearch.searchAll(url.searchParams.get('q'), {
        sources: url.searchParams.get('sources'),
        limit: url.searchParams.get('limit'),
      });
      sendJSON(res, result, result.ok ? 200 : 502);
    } catch (err) {
      sendJSON(res, { ok: false, songs: [], error: err.message || 'LX_SEARCH_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/audio') {
    let target;
    try {
      target = new URL(String(url.searchParams.get('url') || ''));
      if (!/^https?:$/.test(target.protocol)) throw new Error('INVALID_AUDIO_URL');
      if (/^(localhost|127\.|0\.0\.0\.0|\[?::1\]?)$/i.test(target.hostname)) throw new Error('LOCAL_AUDIO_URL_BLOCKED');
    } catch (err) {
      sendJSON(res, { ok:false, error:err.message || 'INVALID_AUDIO_URL' }, 400);
      return;
    }
    const controller = new AbortController();
    req.on('close', () => controller.abort());
    try {
      const fetchImpl = electronNet && typeof electronNet.fetch === 'function'
        ? electronNet.fetch.bind(electronNet)
        : globalThis.fetch;
      const playbackHeaders = audioProxyHeadersFromQuery(url.searchParams.get('h'));
      const upstream = await fetchImpl(target.href, {
        method: req.method === 'HEAD' ? 'HEAD' : 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: '*/*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...playbackHeaders,
          ...(req.headers.range ? { Range:req.headers.range } : {}),
          ...(req.headers['if-range'] ? { 'If-Range':req.headers['if-range'] } : {}),
        },
      });
      const headers = {
        'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
        'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      };
      ['content-length', 'content-range', 'etag', 'last-modified'].forEach(name => {
        const value = upstream.headers.get(name);
        if (value) headers[name] = value;
      });
      res.writeHead(upstream.status, headers);
      if (req.method === 'HEAD' || !upstream.body) {
        res.end();
      } else {
        Readable.fromWeb(upstream.body).on('error', () => {
          if (!res.destroyed) res.destroy();
        }).pipe(res);
      }
    } catch (err) {
      if (!res.headersSent) sendJSON(res, { ok:false, error:err.message || 'AUDIO_PROXY_FAILED' }, 502);
      else if (!res.destroyed) res.destroy();
    }
    return;
  }

  if (pn === '/api/platform-playlist/import') {
    if (req.method !== 'POST') {
      sendJSON(res, { ok:false, error:'METHOD_NOT_ALLOWED' }, 405);
      return;
    }
    try {
      const body = await readRequestBody(req);
      sendJSON(res, await platformPlaylistImport.importPlaylist(body.input, body.source));
    } catch (err) {
      sendJSON(res, { ok:false, error:err.message || 'PLAYLIST_IMPORT_FAILED' }, 400);
    }
    return;
  }

  if (pn === '/api/lx/status') {
    try {
      const status = await lxApiRequest('/status?filter=status,name,singer,albumName,duration,progress,playbackRate,picUrl,lyricLineText,volume,mute');
      sendJSON(res, { ok: true, connected: true, status });
    } catch (err) {
      sendJSON(res, { ok: false, connected: false, error: err.message || 'LX_UNAVAILABLE' }, 503);
    }
    return;
  }

  if (pn === '/api/lx/playlists') {
    try {
      sendJSON(res, readLxPlaylists());
    } catch (err) {
      sendJSON(res, { ok: false, error: err.message || 'LX_PLAYLIST_READ_FAILED' }, 500);
    }
    return;
  }

  if (pn === '/api/lx/lyrics') {
    try {
      const lyrics = await lxApiRequest('/lyric-all');
      sendJSON(res, { ok: true, lyrics });
    } catch (err) {
      sendJSON(res, { ok: false, error: err.message || 'LX_LYRIC_FAILED' }, 503);
    }
    return;
  }

  if (pn === '/api/lx/control') {
    const action = String(url.searchParams.get('action') || '').trim();
    const endpointByAction = {
      play: '/play',
      pause: '/pause',
      next: '/skip-next',
      prev: '/skip-prev',
      collect: '/collect',
      uncollect: '/uncollect',
    };
    if (action === 'volume') {
      const rawVolume = Number(url.searchParams.get('value'));
      const volume = Math.max(0, Math.min(100, Math.round(Number.isFinite(rawVolume) ? rawVolume : 0)));
      endpointByAction.volume = '/volume?volume=' + volume;
    }
    if (action === 'seek') {
      const offset = Math.max(0, Number(url.searchParams.get('value')) || 0);
      endpointByAction.seek = '/seek?offset=' + encodeURIComponent(offset.toFixed(3));
    }
    if (!endpointByAction[action]) {
      sendJSON(res, { ok: false, error: 'LX_CONTROL_NOT_ALLOWED' }, 400);
      return;
    }
    try {
      await lxApiRequest(endpointByAction[action]);
      sendJSON(res, { ok: true, action });
    } catch (err) {
      sendJSON(res, { ok: false, error: err.message || 'LX_CONTROL_FAILED' }, 503);
    }
    return;
  }

  if (pn === '/api/wallpaper/list') {
    const wallpapers = scanWallpaperEngineLibrary();
    sendJSON(res, { ok: true, wallpapers, count: wallpapers.length });
    return;
  }

  if (pn === '/api/wallpaper/media') {
    if (!wallpaperMediaIndex.size) scanWallpaperEngineLibrary();
    const id = String(url.searchParams.get('id') || '');
    const kind = url.searchParams.get('kind') === 'media' ? 'media' : 'preview';
    const originalTarget = wallpaperMediaIndex.get(id + ':' + kind);
    if (!originalTarget) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    try {
      const target = kind === 'media' ? await compatibleWallpaperMediaFile(originalTarget) : originalTarget;
      const stat = fs.statSync(target);
      let start = 0, end = stat.size - 1, status = 200;
      const match = /^bytes=(\d*)-(\d*)$/i.exec(req.headers.range || '');
      if (match) {
        start = match[1] ? Math.max(0, Number(match[1])) : 0;
        end = match[2] ? Math.min(end, Number(match[2])) : end;
        status = 206;
      }
      const headers = {
        'Content-Type': localContentTypeForPath(target),
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
      };
      if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      res.writeHead(status, headers);
      fs.createReadStream(target, { start, end }).pipe(res);
    } catch (_err) {
      res.writeHead(500);
      res.end('Wallpaper read failed');
    }
    return;
  }

  if (pn === '/api/image-proxy') {
    try {
      const target = new URL(String(url.searchParams.get('url') || ''));
      if (!/^https?:$/.test(target.protocol) || /^(?:localhost|127\.|0\.0\.0\.0|::1$)/i.test(target.hostname)) {
        throw new Error('IMAGE_PROXY_URL_NOT_ALLOWED');
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      let response;
      try {
        const fetchImpl = electronNet && typeof electronNet.fetch === 'function'
          ? electronNet.fetch.bind(electronNet)
          : fetch;
        response = await fetchImpl(target.href, { signal: controller.signal, redirect: 'follow' });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new Error('IMAGE_PROXY_HTTP_' + response.status);
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      if (!/^image\//i.test(contentType)) throw new Error('IMAGE_PROXY_NOT_IMAGE');
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > 16 * 1024 * 1024) throw new Error('IMAGE_PROXY_TOO_LARGE');
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': String(data.length),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(data);
    } catch (err) {
      sendJSON(res, { ok: false, error: err.message || 'IMAGE_PROXY_FAILED' }, 502);
    }
    return;
  }

  if (pn === '/api/update/test-installer') {
    try {
      const data = readLocalTestUpdateManifest();
      const localInstallerPath = data && (data.localInstallerPath || (data.asset && data.asset.localFilePath));
      if (!localInstallerPath || !fs.existsSync(localInstallerPath)) {
        sendJSON(res, { ok:false, error:'TEST_UPDATE_INSTALLER_MISSING' }, 404);
        return;
      }
      const stat = fs.statSync(localInstallerPath);
      res.writeHead(200, {
        'Content-Type': 'application/x-msdownload',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="${path.basename(localInstallerPath).replace(/"/g, '')}"`,
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(localInstallerPath).pipe(res);
    } catch (err) {
      sendJSON(res, { ok:false, error:err.message || 'TEST_UPDATE_INSTALLER_FAILED' }, 500);
    }
    return;
  }

  if (pn === '/api/update/latest') {
    try {
      sendJSON(res, await fetchLatestUpdateInfo());
    } catch (err) {
      sendJSON(res, {
        ...localUpdateFallback(err.message || 'Update check failed', { configured: UPDATE_CONFIG.configured }),
        error: err.message || 'Update check failed',
      });
    }
    return;
  }

  if (pn === '/api/update/download') {
    try {
      const info = await fetchLatestUpdateInfo();
      const job = startUpdateDownloadJob(info);
      sendJSON(res, job, job.ok ? 200 : 400);
    } catch (err) {
      console.error('[UpdateDownload]', err);
      sendJSON(res, { ok: false, error: err.message || 'UPDATE_DOWNLOAD_START_FAILED' }, 500);
    }
    return;
  }

  if (pn === '/api/update/download/status') {
    const id = url.searchParams.get('id') || '';
    const job = id
      ? updateDownloadJobs.get(id)
      : Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    sendJSON(res, publicUpdateJob(job), job ? 200 : 404);
    return;
  }

  if (pn === '/api/update/patch') {
    try {
      const info = await fetchLatestUpdateInfo();
      const job = startUpdatePatchJob(info);
      sendJSON(res, job, job.ok ? 200 : 400);
    } catch (err) {
      console.error('[UpdatePatch]', err);
      sendJSON(res, { ok: false, error: err.message || 'UPDATE_PATCH_START_FAILED' }, 500);
    }
    return;
  }

  if (pn === '/api/update/patch/status') {
    const id = url.searchParams.get('id') || '';
    const job = id
      ? updateDownloadJobs.get(id)
      : Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).find(item => item.mode === 'patch');
    sendJSON(res, publicUpdateJob(job), job ? 200 : 404);
    return;
  }

  if (pn === '/api/beatmap/cache/status') {
    const info = beatCacheRootInfo();
    sendJSON(res, {
      enabled: info.allowed && info.available,
      dir: info.dir,
      drive: info.drive,
      reason: !info.allowed ? 'C_DRIVE_DISABLED' : (!info.available ? 'TARGET_DRIVE_UNAVAILABLE' : ''),
      mode: info.allowed && info.available ? 'disk' : 'memory-only',
    });
    return;
  }

  if (pn === '/api/beatmap/cache') {
    if (req.method === 'GET') {
      const key = url.searchParams.get('key') || '';
      try {
        const entry = readBeatMapCache(key);
        sendJSON(res, entry
          ? { ok: true, hit: true, key: entry.key || key, map: entry.map, meta: entry.meta || {}, savedAt: entry.savedAt || 0 }
          : { ok: true, hit: false, key });
      } catch (err) {
        const info = err.info || beatCacheRootInfo();
        sendJSON(res, {
          ok: false,
          hit: false,
          enabled: false,
          mode: 'memory-only',
          key,
          reason: err.code || err.message || 'BEAT_CACHE_READ_FAILED',
          dir: info.dir,
        });
      }
      return;
    }

    if (req.method === 'POST') {
      try {
        const body = await readRequestBody(req);
        sendJSON(res, writeBeatMapCache(body));
      } catch (err) {
        const info = err.info || beatCacheRootInfo();
        sendJSON(res, {
          ok: false,
          enabled: false,
          mode: 'memory-only',
          reason: err.code || err.message || 'BEAT_CACHE_WRITE_FAILED',
          dir: info.dir,
        });
      }
      return;
    }

    sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
    return;
  }

  // ---------- 本地文件代理 (支持 Range，用于持久化本地库) ----------
  if (pn === '/api/local-file') {
    try {
      if (!LOCAL_FILE_TOKEN || url.searchParams.get('token') !== LOCAL_FILE_TOKEN) {
        res.writeHead(403, { 'Access-Control-Allow-Origin': '*' });
        res.end('Forbidden');
        return;
      }
      const target = path.resolve(String(url.searchParams.get('path') || ''));
      const stat = fs.statSync(target);
      if (!stat.isFile()) {
        res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
        res.end('Not found');
        return;
      }
      const total = stat.size;
      let start = 0;
      let end = Math.max(0, total - 1);
      let status = 200;
      const range = req.headers.range || '';
      const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
      if (match) {
        const parsedStart = match[1] ? Number(match[1]) : 0;
        const parsedEnd = match[2] ? Number(match[2]) : end;
        if (!Number.isFinite(parsedStart) || !Number.isFinite(parsedEnd) || parsedStart > parsedEnd || parsedStart >= total) {
          res.writeHead(416, {
            'Access-Control-Allow-Origin': '*',
            'Content-Range': `bytes */${total}`,
          });
          res.end();
          return;
        }
        start = Math.max(0, parsedStart);
        end = Math.min(end, parsedEnd);
        status = 206;
      }
      const headers = {
        'Content-Type': localContentTypeForPath(target),
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'no-store',
      };
      if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
      res.writeHead(status, headers);
      fs.createReadStream(target, { start, end })
        .on('error', (err) => {
          console.error('[LocalFile]', err);
          if (!res.headersSent) res.writeHead(500);
          res.end();
        })
        .pipe(res);
    } catch (err) {
      console.error('[LocalFile]', err);
      res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
      res.end();
    }
    return;
  }

  // ---------- 静态资源 ----------
  if (pn === '/favicon.ico') {
    serveStatic(res, path.join(__dirname, 'build', 'icon.ico'));
    return;
  }

  const publicRoot = path.resolve(__dirname, 'public');
  const relativePath = pn === '/' ? 'index.html' : pn.replace(/^[/\\]+/, '');
  let filePath = path.resolve(publicRoot, relativePath);
  if (filePath !== publicRoot && !filePath.startsWith(publicRoot + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  serveStatic(res, filePath);
});

server.listen(PORT, HOST, () => {
  console.log('======================================================');
  console.log(' 粒子音乐可视化 v2  →  http://localhost:' + PORT);
  console.log('======================================================');
});

module.exports = server;
