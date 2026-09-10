'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const MAX_CANDIDATES = 200;
const MAX_SIGNALS = 500;

function safeText(value, limit = 500) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, limit);
}

function remoteUrl(value) {
  const text = safeText(value, 4096);
  return /^https?:\/\//i.test(text) ? text : '';
}

function stableKey(song, index) {
  const explicit = safeText(song && (song.key || song.id || song.localFileId), 300);
  if (explicit) return explicit.toLowerCase();
  return `${safeText(song && (song.title || song.name), 300).toLowerCase()}|${safeText(song && (song.artist || song.singer), 300).toLowerCase()}|${index}`;
}

function tokenize(value) {
  const text = safeText(value, 2000).toLowerCase().normalize('NFKC');
  const tokens = text.match(/[a-z0-9]{2,}|[\u3400-\u9fff]/g) || [];
  const cjk = Array.from(text.replace(/[^\u3400-\u9fff]/g, ''));
  for (let index = 0; index + 1 < cjk.length; index += 1) tokens.push(cjk[index] + cjk[index + 1]);
  return new Set(tokens);
}

function overlap(left, right) {
  if (!left.size || !right.size) return 0;
  let hits = 0;
  left.forEach(token => { if (right.has(token)) hits += 1; });
  return hits / Math.sqrt(left.size * right.size);
}

class MultimodalRecommender {
  constructor(options = {}) {
    this.appDir = path.resolve(options.appDir || __dirname);
    this.modelDir = path.join(this.appDir, 'multimodal-recommender');
    this.script = path.join(this.modelDir, 'model_service.py');
    this.userDataPath = path.resolve(options.userDataPath || process.env.MINERADIO_USER_DATA_DIR || path.join(process.env.APPDATA || os.homedir(), 'Mineradio'));
    this.feedbackFile = path.join(this.userDataPath, 'multimodal-recommendation-feedback.jsonl');
    this.python = this.findPython();
    this.child = null;
    this.buffer = '';
    this.pending = new Map();
    this.sequence = 0;
    this.probeCache = null;
    this.probeAt = 0;
  }

  findPython() {
    const names = process.platform === 'win32' ? ['python.exe'] : ['python'];
    const candidates = [
      process.env.MINERADIO_MULTIMODAL_PYTHON,
      path.join(this.modelDir, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', names[0]),
      process.env.MINERADIO_PYTHON,
      process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'python.exe') : '',
      names[0],
    ].filter(Boolean);
    return candidates.find(candidate => candidate === names[0] || fs.existsSync(candidate)) || names[0];
  }

  readLocalIndex() {
    const map = new Map();
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(this.userDataPath, 'local-music-library.json'), 'utf8'));
      (Array.isArray(parsed && parsed.records) ? parsed.records : []).forEach(record => {
        const id = safeText(record && record.id, 80).toLowerCase();
        if (!id) return;
        map.set(id, {
          audioPath: fs.existsSync(record.audioPath || '') ? path.resolve(record.audioPath) : '',
          coverPath: fs.existsSync(record.coverPath || '') ? path.resolve(record.coverPath) : '',
        });
      });
    } catch (_error) {}
    return map;
  }

  normalizeCandidates(input) {
    const localIndex = this.readLocalIndex();
    return (Array.isArray(input) ? input : []).slice(0, MAX_CANDIDATES).map((song, index) => {
      song = song && typeof song === 'object' ? song : {};
      const localId = safeText(song.localFileId || (String(song.id || '').startsWith('local:') ? String(song.id).slice(6) : ''), 80).toLowerCase();
      const local = localIndex.get(localId) || {};
      return {
        clientIndex: index,
        key: stableKey(song, index),
        id: safeText(song.id, 300),
        localFileId: localId,
        title: safeText(song.title || song.name, 300),
        artist: safeText(song.artist || song.singer, 300),
        album: safeText(song.album || song.albumName, 300),
        tags: safeText(song.tags || song.genre || song.playlistNames, 500),
        source: safeText(song.source || song.provider, 40),
        cover_path: local.coverPath || '',
        audio_path: local.audioPath || '',
        cover_url: remoteUrl(song.coverUrl || song.cover || song.picUrl || song.img),
        audio_url: remoteUrl(song.audioUrl || song.url || song.src),
        preference_weight: Math.max(0, Math.min(5, Number(song.preferenceWeight) || 0)),
      };
    }).filter(song => song.title || song.artist);
  }

  normalizeSignals(signals) {
    return (Array.isArray(signals) ? signals : []).slice(0, MAX_SIGNALS).map(item => ({
      key: safeText(item && item.key, 300).toLowerCase(),
      weight: Math.max(-5, Math.min(5, Number(item && item.weight) || 0)),
      event: safeText(item && item.event, 40),
    })).filter(item => item.key && item.weight);
  }

  async probe(force = false) {
    const cacheLifetime = this.probeCache && this.probeCache.ready ? 60000 : 5000;
    if (!force && this.probeCache && Date.now() - this.probeAt < cacheLifetime) return this.probeCache;
    const result = await new Promise(resolve => {
      execFile(this.python, [this.script, '--probe'], { windowsHide: true, timeout: 30000, encoding: 'utf8' }, (error, stdout) => {
        let parsed = null;
        try { parsed = JSON.parse(String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '{}'); } catch (_error) {}
        resolve(parsed && typeof parsed === 'object' ? parsed : { ok: false, ready: false, error: error && error.code || 'PROBE_FAILED', message: '无法检查多模态模型环境。' });
      });
    });
    this.probeCache = result;
    this.probeAt = Date.now();
    return result;
  }

  startService() {
    if (this.child && !this.child.killed) return this.child;
    const child = spawn(this.python, [this.script], {
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', MINERADIO_FFMPEG: path.join(this.appDir, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), MINERADIO_MULTIMODAL_CACHE: path.join(this.userDataPath, 'multimodal-embeddings') },
    });
    this.child = child;
    this.buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => this.onStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { if (/error|traceback/i.test(chunk)) console.warn('[MultimodalModel]', chunk.trim().slice(-2000)); });
    child.once('close', code => {
      if (this.child === child) this.child = null;
      const error = new Error(`多模态模型服务已退出 (${code})`);
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
      this.pending.clear();
    });
    return child;
  }

  onStdout(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';
    lines.filter(Boolean).forEach(line => {
      let data;
      try { data = JSON.parse(line); } catch (_error) { return; }
      const entry = this.pending.get(String(data.id || ''));
      if (!entry) return;
      this.pending.delete(String(data.id || ''));
      clearTimeout(entry.timer);
      if (data.ok === false) entry.reject(Object.assign(new Error(data.message || data.error || '多模态推理失败'), { code: data.error }));
      else entry.resolve(data);
    });
  }

  requestModel(payload) {
    const id = `${process.pid}-${Date.now()}-${++this.sequence}`;
    const child = this.startService();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error('多模态模型推理超时。'), { code: 'MODEL_TIMEOUT' }));
      }, 4 * 60 * 1000);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, action: 'recommend', payload }) + '\n', 'utf8', error => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  fallback(payload, dependencyStatus) {
    const preferenceTokens = tokenize(payload.preference_text);
    const signalMap = new Map(payload.signals.map(item => [item.key, item.weight]));
    const likedArtists = new Map();
    payload.candidates.forEach(song => {
      const weight = signalMap.get(song.key) || song.preference_weight || 0;
      if (weight > 0 && song.artist) likedArtists.set(song.artist.toLowerCase(), (likedArtists.get(song.artist.toLowerCase()) || 0) + weight);
    });
    const ranked = payload.candidates.map(song => {
      const metadata = tokenize(`${song.title} ${song.artist} ${song.album} ${song.tags}`);
      const semantic = overlap(preferenceTokens, metadata);
      const behavior = Math.min(1, (likedArtists.get(song.artist.toLowerCase()) || 0) / 3);
      const existing = Math.max(0, signalMap.get(song.key) || song.preference_weight || 0);
      const mediaReady = (song.cover_path || song.cover_url ? .5 : 0) + (song.audio_path || song.audio_url ? .5 : 0);
      const score = semantic * .52 + behavior * .28 + Math.min(1, existing / 3) * .12 + mediaReady * .08;
      return {
        clientIndex: song.clientIndex, key: song.key, title: song.title, artist: song.artist,
        score: Math.round(score * 1000000) / 1000000,
        components: { metadata: semantic, behavior, mediaReady }, modalities: [],
      };
    }).sort((left, right) => right.score - left.score || left.clientIndex - right.clientIndex).slice(0, payload.limit);
    return {
      ok: true, mode: 'metadata-behavior-fallback', modelReady: false,
      message: dependencyStatus && dependencyStatus.message || '完整模型未安装，已使用偏好与元数据轻量排序。',
      candidateCount: payload.candidates.length, preferenceText: payload.preference_text, ranked,
    };
  }

  async recommend(input = {}) {
    const payload = {
      preference_text: safeText(input.preference_text || input.preferenceText || '符合我的音乐口味', 1000) || '符合我的音乐口味',
      limit: Math.max(1, Math.min(50, Math.round(Number(input.limit || input.max_songs || input.maxSongs) || 10))),
      candidates: this.normalizeCandidates(input.candidates),
      signals: this.normalizeSignals(input.signals),
    };
    if (!payload.candidates.length) return { ok: false, error: 'NO_CANDIDATES', message: '没有可用于推荐的歌曲，请先导入本地音乐或载入歌单。' };
    let status = await this.probe(false);
    // Electron startup can briefly starve the first Python probe.  A failed
    // result must never lock the user into fallback mode for a full minute.
    if (!status.ready) status = await this.probe(true);
    if (!status.ready || input.fullModel === false) return this.fallback(payload, status);
    try {
      return { ...(await this.requestModel(payload)), modelReady: true };
    } catch (error) {
      console.warn('[MultimodalRecommend]', error.message);
      return { ...this.fallback(payload, { message: `完整模型暂不可用（${error.message}），已自动降级。` }), modelError: error.code || 'MODEL_FAILED' };
    }
  }

  async feedback(input = {}) {
    const event = safeText(input.event, 40).toLowerCase();
    if (!['impression', 'play', 'like', 'skip', 'save'].includes(event)) return { ok: false, error: 'INVALID_EVENT', message: '不支持的反馈类型。' };
    const row = {
      version: 1, at: new Date().toISOString(), event,
      recommendationId: safeText(input.recommendationId, 200), key: safeText(input.key, 300),
      title: safeText(input.title, 300), artist: safeText(input.artist, 300),
      rank: Math.max(0, Math.round(Number(input.rank) || 0)), mode: safeText(input.mode, 80),
    };
    await fs.promises.mkdir(path.dirname(this.feedbackFile), { recursive: true });
    await fs.promises.appendFile(this.feedbackFile, JSON.stringify(row) + '\n', 'utf8');
    return { ok: true };
  }

  async status() {
    const probe = await this.probe(false);
    return {
      ok: true, ready: !!probe.ready, python: this.python, modelDirectory: this.modelDir,
      mode: probe.ready ? 'clip-clap-fusion' : 'metadata-behavior-fallback',
      message: probe.message || '', feedbackFile: this.feedbackFile,
      models: { cover: 'openai/clip-vit-base-patch32', audio: 'laion/clap-htsat-unfused' },
    };
  }
}

module.exports = { MultimodalRecommender, tokenize, overlap, stableKey };




