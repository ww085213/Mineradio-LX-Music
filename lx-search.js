'use strict';

const crypto = require('crypto');

const SOURCE_NAMES = { tx: '小秋音乐', wy: '小芸音乐', kw: '小蜗音乐', kg: '小狗音乐', mg: '小菇音乐' };
let networkFetch = globalThis.fetch;

function setFetchImplementation(implementation) {
  if (typeof implementation === 'function') networkFetch = implementation;
}

function durationText(seconds) {
  seconds = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function singers(value) {
  if (!Array.isArray(value)) return String(value || '');
  return value.map(item => item && (item.name || item.singerName)).filter(Boolean).join('、');
}

async function fetchJson(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const selectedFetch = options.useNodeFetch ? globalThis.fetch : networkFetch;
      const fetchOptions = { ...options };
      delete fetchOptions.useNodeFetch;
      const response = await selectedFetch(url, {
        ...fetchOptions,
        signal: controller.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'referer': new URL(url).origin + '/',
          ...(fetchOptions.headers || {}),
        },
      });
      if (!response.ok) {
        const error = new Error(`HTTP_${response.status}`);
        const retryAfter = response.headers && response.headers.get && response.headers.get('retry-after');
        if (retryAfter) {
          const seconds = Number(retryAfter);
          const dateDelay = Date.parse(retryAfter) - Date.now();
          error.retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, dateDelay);
        }
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      const retryable = /HTTP_(?:429|5\d\d)|abort|timeout|fetch|network|socket|ECONN|ENOTFOUND/i.test(String(error && (error.message || error)));
      if (!retryable || attempt >= 2) throw error;
      const exponentialDelay = 350 * (2 ** attempt);
      const retryAfterDelay = Math.min(10000, Math.max(0, Number(error.retryAfterMs) || 0));
      await new Promise(resolve => setTimeout(resolve, Math.max(exponentialDelay, retryAfterDelay)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('SEARCH_REQUEST_FAILED');
}

async function searchKw(query, limit) {
  const url = `https://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(query)}&pn=0&rn=${limit}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`;
  const data = await fetchJson(url, { useNodeFetch: true });
  return (data.abslist || []).map(item => ({
    id: String(item.MUSICRID || '').replace('MUSIC_', ''),
    songmid: String(item.MUSICRID || '').replace('MUSIC_', ''),
    name: item.SONGNAME || '',
    singer: item.ARTIST || '',
    albumName: item.ALBUM || '',
    albumId: item.ALBUMID || '',
    interval: durationText(item.DURATION),
    source: 'kw',
    types: ['flac24bit', 'flac', '320k', '128k'],
  }));
}

async function searchKg(query, limit) {
  const baseUrl = `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(query)}&page=1&pagesize=${limit}&userid=0&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`;
  let rows = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const data = await fetchJson(`${baseUrl}&_=${Date.now()}_${attempt}`, { useNodeFetch: true });
    rows = data?.data?.lists || [];
    if (rows.length) break;
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 380 * (2 ** attempt)));
  }
  return rows.map(item => ({
    id: item.Audioid,
    songmid: item.Audioid,
    name: item.SongName || '',
    singer: singers(item.Singers) || item.SingerName || '',
    albumName: item.AlbumName || '',
    albumId: item.AlbumID || '',
    hash: item.FileHash || '',
    interval: durationText(item.Duration),
    source: 'kg',
    types: ['flac24bit', 'flac', '320k', '128k'],
  }));
}

async function searchWy(query, limit) {
  const apiPath = '/api/search/song/list/page';
  const payload = JSON.stringify({
    keyword: query, needCorrect: '1', channel: 'typing', offset: 0,
    scene: 'normal', total: true, limit,
  });
  const digest = crypto.createHash('md5').update(`nobody${apiPath}use${payload}md5forencrypt`).digest('hex');
  const plain = `${apiPath}-36cd479b6b5-${payload}-36cd479b6b5-${digest}`;
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from('e82ckenh8dichen8'), null);
  const params = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]).toString('hex').toUpperCase();
  const data = await fetchJson('http://interface.music.163.com/eapi/batch', {
    method: 'POST',
    headers: {
      origin: 'https://music.163.com',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ params }).toString(),
  });
  const resources = data?.data?.resources || [];
  return resources.map(resource => resource?.baseInfo?.simpleSongData).filter(Boolean).map(item => ({
    id: item.id,
    songmid: item.id,
    name: item.name || '',
    singer: singers(item.ar),
    albumName: item.al?.name || '',
    albumId: item.al?.id || '',
    picUrl: item.al?.picUrl || '',
    interval: durationText((item.dt || 0) / 1000),
    source: 'wy',
    types: ['flac', '320k', '128k'],
  }));
}

function qqSign(text) {
  const hash = crypto.createHash('sha1').update(text).digest('hex');
  const part1 = [23, 14, 6, 36, 16, 40, 7, 19].map(index => hash[index]).join('');
  const part2 = [16, 1, 32, 12, 19, 27, 8, 5].map(index => hash[index]).join('');
  const scramble = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179];
  const bytes = scramble.map((value, index) => value ^ parseInt(hash.slice(index * 2, index * 2 + 2), 16));
  const middle = Buffer.from(bytes).toString('base64').replace(/[\\/+=]/g, '');
  return `zzc${part1}${middle}${part2}`.toLowerCase();
}

async function searchTx(query, limit) {
  const body = {
    comm: {
      ct: '11', cv: '14090508', v: '14090508', tmeAppID: 'qqmusic',
      phonetype: 'EBG-AN10', os_ver: '12', OpenUDID: '0', QIMEI36: '0',
      udid: '0', chid: '0', aid: '0', oaid: '0', taid: '0', tid: '0',
      wid: '0', uid: '0', sid: '0', modeSwitch: '6', teenMode: '0',
      ui_mode: '2', nettype: '1020',
    },
    req: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicMobile',
      param: {
        search_type: 0, searchid: Math.random().toString().slice(2), query,
        page_num: 1, num_per_page: limit, highlight: 0, nqc_flag: 0,
        multi_zhida: 0, cat: 2, grp: 1, sin: 0, sem: 0,
      },
    },
  };
  const text = JSON.stringify(body);
  const data = await fetchJson(`https://u.y.qq.com/cgi-bin/musics.fcg?sign=${qqSign(text)}`, {
    method: 'POST',
    headers: { 'user-agent': 'QQMusic 14090508(android 12)', 'content-type': 'application/json' },
    body: text,
  });
  const list = data?.req?.data?.body?.item_song || [];
  return list.map(item => {
    const albumMid = item.album?.mid || item.albummid || '';
    const mediaMid = item.file?.media_mid || item.strMediaMid || item.songmid || item.mid || '';
    return {
      id: item.id || item.songid,
      songmid: item.mid || item.songmid,
      name: item.title || item.songname || item.name || '',
      singer: singers(item.singer),
      albumName: item.album?.name || item.albumname || '',
      albumId: albumMid,
      albumMid,
      strMediaMid: mediaMid,
      picUrl: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg` : '',
      interval: durationText(item.interval),
      source: 'tx',
      types: ['flac', '320k', '128k'],
    };
  });
}

async function searchMg(query, limit) {
  const timestamp = String(Date.now());
  const deviceId = '963B7AA0D21511ED807EE5846EC87D20';
  const sign = crypto.createHash('md5').update(`${query}6cdc72a439cef99a3418d2a78aa28c73yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${timestamp}`).digest('hex');
  const url = `https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D&pageSize=${limit}&text=${encodeURIComponent(query)}&pageNo=1&sort=0&sid=USS`;
  const data = await fetchJson(url, { headers: { uiVersion: 'A_music_3.6.1', deviceId, timestamp, sign, channel: '0146921' } });
  const groups = data?.songResultData?.resultList || [];
  return groups.flat().filter(item => item.songId && item.copyrightId).map(item => ({
    id: item.songId,
    songmid: item.songId,
    copyrightId: item.copyrightId,
    name: item.name || '',
    singer: singers(item.singerList),
    albumName: item.album || '',
    albumId: item.albumId || '',
    picUrl: item.img3 || item.img2 || item.img1 || '',
    lrcUrl: item.lrcUrl || '',
    mrcUrl: item.mrcurl || '',
    trcUrl: item.trcUrl || '',
    interval: durationText(item.duration),
    source: 'mg',
    types: ['flac24bit', 'flac', '320k', '128k'],
  }));
}

const PROVIDERS = { tx: searchTx, wy: searchWy, kw: searchKw, kg: searchKg, mg: searchMg };
const searchCache = new Map();
const providerHealth = new Map();

function providerState(source) {
  if (!providerHealth.has(source)) providerHealth.set(source, { failures:0, cooldownUntil:0 });
  return providerHealth.get(source);
}

async function searchAll(query, options = {}) {
  query = String(query || '').trim();
  if (!query) return { ok: true, songs: [], failures: [] };
  const limit = Math.min(Math.max(Number(options.limit) || 12, 1), 30);
  const requested = String(options.sources || 'tx,wy,kw,kg,mg').split(',').filter(source => PROVIDERS[source]);
  const cacheKey = `${requested.join(',')}|${limit}|${query.toLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 2 * 60 * 1000) return cached.value;
  const now = Date.now();
  const active = requested.filter(source => requested.length === 1 || providerState(source).cooldownUntil <= now);
  const cooled = requested.filter(source => !active.includes(source));
  const settled = await Promise.allSettled(active.map(source => PROVIDERS[source](query, limit)));
  const songs = [];
  const failures = cooled.map(source => ({ source, name:SOURCE_NAMES[source], error:'SOURCE_COOLDOWN' }));
  settled.forEach((result, index) => {
    const source = active[index];
    const health = providerState(source);
    if (result.status === 'fulfilled') {
      songs.push(...result.value);
      health.failures = 0;
      health.cooldownUntil = 0;
    } else {
      health.failures += 1;
      if (health.failures >= 3) health.cooldownUntil = Date.now() + Math.min(120000, 15000 * (health.failures - 1));
      failures.push({ source, name: SOURCE_NAMES[source], error: result.reason?.message || 'SEARCH_FAILED' });
    }
  });
  const seen = new Set();
  const value = {
    ok: songs.length > 0 || failures.length < requested.length,
    songs: songs.filter(song => {
      const key = `${song.source}|${song.songmid || song.id}`;
      if (!song.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    failures,
  };
  if (value.songs.length) {
    searchCache.set(cacheKey, { time: Date.now(), value });
    if (searchCache.size > 80) searchCache.delete(searchCache.keys().next().value);
  }
  return value;
}

module.exports = { searchAll, setFetchImplementation };
