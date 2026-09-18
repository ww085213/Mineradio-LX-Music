'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');

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
  return value.map(item => typeof item === 'string' ? item : item && (item.name || item.singerName)).filter(Boolean).join('、');
}

function kuwoCoverUrl(item) {
  item = item || {};
  let value = String(item.picUrl || item.pic || item.PIC || item.web_albumpic_short || item.web_album_pic || item.albumpic || item.hts_MVPIC || item.MVPIC || '').trim();
  if (!value) return '';
  value = value.replace(/^https?:\/\/[^/]+\/star\/albumcover\/\d+\//i, '');
  value = value.replace(/^\d+\//, '');
  if (/^https?:\/\//i.test(value)) return value;
  return `https://img1.kuwo.cn/star/albumcover/500/${value.replace(/^\/+/, '')}`;
}

function cleanText(value) {
  return String(value || '')
    .replace(/&nbsp;|&#32;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function playlistResult(source, item) {
  const id = String(item.id || '').trim();
  return {
    id,
    input: String(item.input || id).trim(),
    source,
    sourceName: SOURCE_NAMES[source] || source,
    name: cleanText(item.name) || `${SOURCE_NAMES[source] || source}歌单`,
    creator: cleanText(item.creator),
    description: cleanText(item.description),
    cover: String(item.cover || '').replace(/^http:\/\//i, 'https://'),
    trackCount: Math.max(0, Number(item.trackCount) || 0),
    playCount: Math.max(0, Number(item.playCount) || 0),
    collectCount: Math.max(0, Number(item.collectCount) || 0),
    tags: Array.isArray(item.tags) ? item.tags.map(cleanText).filter(Boolean).slice(0, 5) : [],
    url: String(item.url || ''),
  };
}

async function fetchJson(url, options = {}) {
  let lastError;
  const mobile = process.env.MINERADIO_MOBILE === '1';
  const attempts = mobile ? 2 : 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), mobile ? 6500 : 12000);
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
      if (!retryable || attempt >= attempts - 1) throw error;
      const exponentialDelay = 350 * (2 ** attempt);
      const retryAfterDelay = Math.min(mobile ? 1000 : 10000, Math.max(0, Number(error.retryAfterMs) || 0));
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
    picUrl: kuwoCoverUrl(item),
    interval: durationText(item.DURATION),
    source: 'kw',
    types: ['flac24bit', 'flac', '320k', '128k'],
  }));
}

async function searchKg(query, limit) {
  const baseUrl = `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(query)}&page=1&pagesize=${limit}&userid=0&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`;
  let rows = [];
  const attempts = process.env.MINERADIO_MOBILE === '1' ? 1 : 3;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const data = await fetchJson(`${baseUrl}&_=${Date.now()}_${attempt}`, { useNodeFetch: true });
    rows = data?.data?.lists || [];
    if (rows.length) break;
    if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, 380 * (2 ** attempt)));
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

async function searchTxPlaylists(query, limit, page = 1) {
  const url = `https://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist?remoteplace=txt.yqq.playlist&searchid=${Date.now()}&query=${encodeURIComponent(query)}&page_no=${page}&num_per_page=${limit}&format=json`;
  const data = await fetchJson(url, { headers:{ referer:'https://y.qq.com/' } });
  return (data?.data?.list || []).map(item => playlistResult('tx', {
    id:item.dissid,
    name:item.dissname,
    creator:item.creator?.name,
    description:item.introduction,
    cover:item.imgurl,
    trackCount:item.song_count || item.copyrightnum,
    playCount:item.listennum,
    url:item.dissid ? `https://y.qq.com/n/ryqq/playlist/${item.dissid}` : '',
  }));
}

async function searchWyPlaylists(query, limit, page = 1) {
  const url = `https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(query)}&type=1000&offset=${(page - 1) * limit}&limit=${limit}`;
  const data = await fetchJson(url, { headers:{ referer:'https://music.163.com/' } });
  return (data?.result?.playlists || []).map(item => playlistResult('wy', {
    id:item.id,
    name:item.name,
    creator:item.creator?.nickname,
    description:item.description,
    cover:item.coverImgUrl,
    trackCount:item.trackCount,
    playCount:item.playCount,
    collectCount:item.bookCount,
    tags:item.officialTags,
    url:item.id ? `https://music.163.com/playlist?id=${item.id}` : '',
  }));
}

async function searchKwPlaylists(query, limit, page = 1) {
  const url = `https://search.kuwo.cn/r.s?all=${encodeURIComponent(query)}&ft=playlist&client=kt&pn=${page - 1}&rn=${limit}&rformat=json&encoding=utf8&mobi=1`;
  const data = await fetchJson(url, { useNodeFetch:true });
  return (data?.abslist || []).map(item => {
    const id = item.playlistid || item.DC_TARGETID;
    return playlistResult('kw', {
      id,
      name:item.name,
      creator:item.nickname,
      description:item.intro,
      cover:item.hts_pic || item.pic,
      trackCount:item.songnum,
      playCount:item.playcnt,
      tags:String(item.tags || '').split(/[;,，]/),
      url:id ? `https://www.kuwo.cn/playlist_detail/${id}` : '',
    });
  });
}

async function searchKgPlaylists(query, limit, page = 1) {
  const url = `https://specialsearch.kugou.com/special_search?keyword=${encodeURIComponent(query)}&page=${page}&pagesize=${limit}&platform=WebFilter&filter=0&iscorrection=1`;
  const data = await fetchJson(url, { useNodeFetch:true, headers:{ referer:'https://www.kugou.com/' } });
  return (data?.data?.lists || []).map(item => playlistResult('kg', {
    id:item.specialid,
    name:item.specialname,
    creator:item.nickname,
    description:item.intro,
    cover:item.img,
    trackCount:item.song_count,
    playCount:item.total_play_count || item.play_count,
    collectCount:item.collect_count,
    tags:String(item.tag_str || '').split(/[;,，]/),
    url:item.specialid ? `https://www.kugou.com/yy/special/single/${item.specialid}.html` : '',
  }));
}

async function searchMgPlaylists(query, limit, page = 1) {
  const timestamp = String(Date.now());
  const deviceId = '963B7AA0D21511ED807EE5846EC87D20';
  const sign = crypto.createHash('md5').update(`${query}6cdc72a439cef99a3418d2a78aa28c73yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${timestamp}`).digest('hex');
  const searchSwitch = encodeURIComponent(JSON.stringify({
    song:0, album:0, singer:0, tagSong:0, mvSong:0, bestShow:0, songlist:1, lyricSong:0,
  }));
  const url = `https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=${searchSwitch}&pageSize=${limit}&text=${encodeURIComponent(query)}&pageNo=${page}&sort=0&sid=USS`;
  const data = await fetchJson(url, { headers:{ uiVersion:'A_music_3.6.1', deviceId, timestamp, sign, channel:'0146921' } });
  return (data?.songListResultData?.result || []).map(item => playlistResult('mg', {
    id:item.id,
    name:item.name,
    creator:item.userName,
    description:item.intro,
    cover:item.musicListPicUrl,
    trackCount:item.musicNum,
    playCount:item.playNum,
    collectCount:item.keepNum,
    tags:item.ts,
    url:item.id ? `https://music.migu.cn/v3/music/playlist/${item.id}` : '',
  }));
}

const PROVIDERS = { tx: searchTx, wy: searchWy, kw: searchKw, kg: searchKg, mg: searchMg };
const PLAYLIST_PROVIDERS = {
  tx:searchTxPlaylists, wy:searchWyPlaylists, kw:searchKwPlaylists,
  kg:searchKgPlaylists, mg:searchMgPlaylists,
};
const searchCache = new Map();
const playlistSearchCache = new Map();
const providerHealth = new Map();

// A small Node HTTP fallback keeps search usable on iOS even when the
// embedded Web Fetch implementation cannot reach one of the platform hosts.
// The bundled GD Studio catalog is metadata-only; playback is handled by the
// matching built-in source and its Netease resolver.
function directJson(url, redirectCount = 0) {
  if (redirectCount > 4) return Promise.reject(new Error('SEARCH_TOO_MANY_REDIRECTS'));
  return new Promise((resolve, reject) => {
    let target;
    try { target = new URL(url); } catch (error) { reject(error); return; }
    const transport = target.protocol === 'https:' ? https : http;
    const req = transport.get(target, {
      headers: {
        accept: 'application/json,text/plain,*/*',
        'accept-encoding': 'identity',
        'user-agent': 'Mozilla/5.0 Mineradio iOS',
      },
      timeout: 12000,
    }, response => {
      const status = Number(response.statusCode || 0);
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        directJson(new URL(response.headers.location, target).href, redirectCount + 1).then(resolve, reject);
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('error', reject);
      response.on('end', () => {
        if (status < 200 || status >= 300) {
          reject(new Error(`SEARCH_HTTP_${status}`));
          return;
        }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (_error) { reject(new Error('SEARCH_INVALID_JSON')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('SEARCH_TIMEOUT')));
  });
}

async function searchGdStudio(query, limit) {
  const target = `https://music-api.gdstudio.xyz/api.php?types=search&source=netease&name=${encodeURIComponent(query)}&count=${limit}`;
  const rows = await directJson(target);
  if (!Array.isArray(rows)) throw new Error('SEARCH_INVALID_RESPONSE');
  return rows.map(item => ({
    id: String(item.id || '').trim(),
    songmid: String(item.id || '').trim(),
    name: cleanText(item.name),
    singer: singers(item.artist),
    albumName: cleanText(item.album),
    albumId: String(item.album_id || ''),
    picUrl: item.pic_id ? `https://music.126.net/cover/${item.pic_id}` : '',
    interval: durationText(item.duration),
    source: 'wy',
    types: ['flac', '320k', '128k'],
  })).filter(item => item.id && item.name);
}

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
  if (!value.songs.length) {
    try {
      const fallbackSongs = await searchGdStudio(query, limit);
      if (fallbackSongs.length) {
        value.ok = true;
        value.songs = fallbackSongs;
        value.failures = value.failures.concat([{ source:'gdstudio', name:'内置聚合搜索', error:'PLATFORM_SEARCH_FALLBACK' }]);
      }
    } catch (fallbackError) {
      value.failures.push({ source:'gdstudio', name:'内置聚合搜索', error:fallbackError.message || 'SEARCH_FALLBACK_FAILED' });
    }
  }
  if (value.songs.length) {
    searchCache.set(cacheKey, { time: Date.now(), value });
    if (searchCache.size > 80) searchCache.delete(searchCache.keys().next().value);
  }
  return value;
}

async function searchPlaylists(query, options = {}) {
  query = String(query || '').trim();
  if (!query) return { ok:true, playlists:[], failures:[] };
  const limit = Math.min(Math.max(Number(options.limit) || 12, 1), 30);
  const page = Math.min(Math.max(Number(options.page) || 1, 1), 50);
  const requested = String(options.sources || 'tx,wy,kw,kg,mg').split(',').filter(source => PLAYLIST_PROVIDERS[source]);
  const cacheKey = `${requested.join(',')}|${limit}|${page}|${query.toLowerCase()}`;
  const cached = playlistSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 2 * 60 * 1000) return cached.value;
  const settled = await Promise.allSettled(requested.map(source => PLAYLIST_PROVIDERS[source](query, limit, page)));
  const playlists = [];
  const failures = [];
  settled.forEach((result, index) => {
    const source = requested[index];
    if (result.status === 'fulfilled') playlists.push(...result.value);
    else failures.push({ source, name:SOURCE_NAMES[source], error:result.reason?.message || 'PLAYLIST_SEARCH_FAILED' });
  });
  const seen = new Set();
  const value = {
    ok:playlists.length > 0 || failures.length < requested.length,
    playlists:playlists.filter(item => {
      const key = `${item.source}|${item.id}`;
      if (!item.id || !item.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    failures,
    page,
    query,
  };
  if (value.playlists.length) {
    playlistSearchCache.set(cacheKey, { time:Date.now(), value });
    if (playlistSearchCache.size > 80) playlistSearchCache.delete(playlistSearchCache.keys().next().value);
  }
  return value;
}

module.exports = { searchAll, searchPlaylists, setFetchImplementation };
