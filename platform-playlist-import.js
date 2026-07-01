'use strict';

const http = require('http');
const https = require('https');
let networkFetch = globalThis.fetch;
function setFetchImplementation(fn) {
  if (typeof fn === 'function') networkFetch = fn;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    let response;
    try {
      response = await networkFetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...(options.headers || {}),
        },
      });
    } catch (error) {
      // Electron net may classify some official music API hosts as blocked clients.
      // A native Node HTTPS request avoids that Chromium filtering path.
      if (/BLOCKED_BY_CLIENT|fetch failed|ERR_FAILED/i.test(String(error && (error.message || error)))) {
        return await fetchJsonNative(url, options.headers || {});
      }
      throw error;
    }
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function fetchJsonNative(url, headers = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('TOO_MANY_REDIRECTS'));
      return;
    }
    const target = new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    const request = transport.get(target, {
      headers:{
        'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...headers,
      },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        resolve(fetchJsonNative(new URL(response.headers.location, target).href, headers, redirects + 1));
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
  });
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await networkFetch(url, {
      ...options,
      signal:controller.signal,
      headers:{
        'user-agent':'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile Safari/537.36',
        ...(options.headers || {}),
      },
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function durationText(seconds) {
  seconds = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function singerText(value) {
  return Array.isArray(value) ? value.map(item => item?.name || item?.singerName).filter(Boolean).join('、') : String(value || '');
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

const SOURCE_ALIASES = {
  tx:'tx', qq:'tx', '小秋':'tx',
  wy:'wy', '163':'wy', netease:'wy', '小芸':'wy',
  kw:'kw', kuwo:'kw', '小蜗':'kw',
  kg:'kg', kugou:'kg', '小狗':'kg',
  mg:'mg', migu:'mg', '小菇':'mg',
};

function normalizeSource(value) {
  return SOURCE_ALIASES[String(value || '').trim().toLowerCase()] || '';
}

function detect(input, preferredSource) {
  const text = String(input || '').trim();
  const rules = [
    ['tx', /(?:y\.qq\.com|i\d*\.y\.qq\.com|c\d*\.y\.qq\.com|m\.qq\.com)[^\s]*?(?:playlist(?:\.html)?[/?]|[?&](?:id|disstid)=)(\d+)/i],
    ['wy', /(?:music\.163\.com|y\.music\.163\.com|m\.music\.163\.com|163cn\.tv)[^\s]*?(?:playlist(?:\?id=|\/)|[?&](?:playlistId|id)=)(\d+)/i],
    ['kw', /(?:kuwo\.cn|kuwo\.com|h5app\.kuwo\.cn|m\.kuwo\.cn)[^\s]*?(?:playlist(?:_detail)?[/?_-]|[?&](?:pid|playlistId|id)=)(\d+)/i],
    ['kg', /(?:kugou\.com|kugou\.cn)[^\s]*?(?:songlist\/gcid_|plist\/list\/|special\/single\/|zlist\.html[^\s]*?[?&](?:listid|id)=|[?&](?:listid|specialid|id)=)([a-z0-9_]+)/i],
    ['mg', /(?:migu\.cn|nf\.migu\.cn)[^\s]*?(?:playlist(?:contents_query_tag)?[/?_-]|[?&](?:playlistId|playListId|id)=)(\d+)/i],
  ];
  for (const [source, rx] of rules) {
    const match = text.match(rx);
    if (match) return { source, id:match[1], input:text };
  }
  const prefixed = text.match(/^(tx|qq|wy|163|kw|kg|mg|小秋|小芸|小蜗|小狗|小菇)\s*[:：]\s*(\d+)$/i);
  if (prefixed) {
    return { source:normalizeSource(prefixed[1]), id:prefixed[2], input:text };
  }
  const source = normalizeSource(preferredSource);
  if (source) {
    if (/^\d+$/.test(text)) return { source, id:text, input:text };
    const matches = [...text.matchAll(/(?:playlist(?:Id)?|disstid|specialid|pid|id)[=/:_-]+(\d{4,})/ig)];
    if (matches.length) return { source, id:matches[matches.length - 1][1], input:text };
  }
  throw new Error('无法识别链接；请选择平台并粘贴歌单分享链接，或直接输入数字歌单 ID');
}

async function expandShareLink(input) {
  const match = String(input || '').match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return String(input || '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await networkFetch(match[0], {
      method:'GET',
      redirect:'follow',
      signal:controller.signal,
      headers:{ 'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    return response.url || match[0];
  } catch (_error) {
    try {
      return await expandShareLinkNative(match[0]);
    } catch (_nativeError) {
      return String(input || '');
    }
  } finally {
    clearTimeout(timer);
  }
}

function expandShareLinkNative(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) {
      reject(new Error('TOO_MANY_REDIRECTS'));
      return;
    }
    const target = new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    const request = transport.get(target, {
      headers:{ 'user-agent':'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile Safari/537.36' },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        resolve(expandShareLinkNative(new URL(response.headers.location, target).href, redirects + 1));
        return;
      }
      response.resume();
      resolve(target.href);
    });
    request.setTimeout(10000, () => request.destroy(new Error('REQUEST_TIMEOUT')));
    request.on('error', reject);
  });
}

async function importQQ(id) {
  const url = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=${id}&loginUin=0&hostUin=0&format=json&platform=yqq.json&needNewCode=0`;
  const data = await fetchJson(url, { headers:{ Origin:'https://y.qq.com', Referer:`https://y.qq.com/n/ryqq/playlist/${id}` } });
  const list = data?.cdlist?.[0];
  if (!list) throw new Error('小秋歌单读取失败');
  return {
    name:list.dissname || `小秋歌单 ${id}`, cover:list.logo || '',
    songs:(list.songlist || []).map(item => ({
      id:item.id, songmid:item.mid, name:item.title || item.name || '', singer:singerText(item.singer),
      albumName:item.album?.name || '', albumId:item.album?.mid || '', albumMid:item.album?.mid || '',
      strMediaMid:item.file?.media_mid || item.mid || '', picUrl:item.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.album.mid}.jpg` : '',
      interval:durationText(item.interval), source:'tx', types:['flac','320k','128k'],
    })),
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
    ? trackIds.map(trackId => byId.get(trackId)).filter(Boolean)
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

async function importKW(id) {
  const pageSize = 200;
  const makeUrl = page => `https://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${id}&pn=${page}&rn=${pageSize}&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1`;
  const data = await fetchJson(makeUrl(0));
  if (data?.result !== 'ok') throw new Error(`酷我歌单读取失败${data?.reason ? `：${data.reason}` : ''}`);
  const rows = [...(data.musiclist || [])];
  const total = Number(data.total || data.validtotal || rows.length);
  for (let page = 1; rows.length < total && page < 100; page += 1) {
    const pageData = await fetchJson(makeUrl(page));
    const pageRows = pageData?.musiclist || [];
    if (!pageRows.length) break;
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }
  const musiclist = uniqueBy(rows, item => String(item.musicrid || item.id || '').replace('MUSIC_', ''));
  return {
    name:data.title || `小蜗歌单 ${id}`, cover:data.pic || '',
    songs:musiclist.map(item => ({
      id:String(item.musicrid || item.id || '').replace('MUSIC_', ''),
      songmid:String(item.musicrid || item.id || '').replace('MUSIC_', ''),
      name:item.name || item.songname || '', singer:item.artist || '', albumName:item.album || '',
      albumId:item.albumid || '', interval:durationText(item.duration), source:'kw',
      types:['flac24bit','flac','320k','128k'],
    })),
  };
}

async function importKG(id, originalInput) {
  let legacyId = id;
  let sharedInfo = null;
  if (!/^\d+$/.test(legacyId)) {
    const sharedUrl = String(originalInput || '').match(/https?:\/\/[^\s<>"']+/i)?.[0];
    const html = await fetchText(sharedUrl || `https://m.kugou.com/songlist/gcid_${encodeURIComponent(legacyId)}/`, {
      headers:{ Referer:'https://www.kugou.com/' },
    });
    const outputMatch = html.match(/window\.\$output\s*=\s*(\{[\s\S]*?\});\s*<\/script>/i);
    if (outputMatch) {
      try { sharedInfo = JSON.parse(outputMatch[1])?.info || null; } catch (_error) {}
    }
    const match = html.match(/["']?specialid["']?\s*[:=]\s*["']?(\d+)/i)
      || html.match(/\/special\/single\/(\d+)/i);
    if (!match) throw new Error('酷狗新式歌单链接暂时无法换取歌单 ID，请确认歌单已设为公开');
    legacyId = match[1];
  }
  const detailHtml = await fetchText(`https://www.kugou.com/yy/special/single/${legacyId}.html`, {
    headers:{ Referer:'https://www.kugou.com/' },
  });
  const detailRows = parseAssignedJson(detailHtml, 'var data=') || [];
  const rows = uniqueBy([...(sharedInfo?.songs || []), ...detailRows], item =>
    item.audio_id || item.audioid || item.rp_id || item.album_audio_id || item.id || item.hash || item.HASH
  );
  const info = sharedInfo?.listinfo || {};
  if (!rows.length) throw new Error('小狗歌单读取失败');
  return {
    name:info.name || detailHtml.match(/<title>([^<]+)/i)?.[1]?.replace(/_酷狗音乐.*$/i, '') || `小狗歌单 ${id}`,
    cover:String(info.pic || '').replace('{size}', '400'),
    songs:rows.map(item => {
      const singer = item.singername || singerText(item.singerinfo || item.authors)
        || String(item.filename || '').split(' - ')[0] || '';
      let name = item.songname || item.name || String(item.filename || '').split(' - ').slice(1).join(' - ');
      if (singer && name.startsWith(`${singer} - `)) name = name.slice(singer.length + 3);
      return {
        id:item.audio_id || item.audioid || item.rp_id || item.album_audio_id || item.id,
        songmid:item.audio_id || item.audioid || item.rp_id || item.album_audio_id || item.id,
        name, singer,
        albumName:item.album_name || item.albuminfo?.name || '', albumId:item.album_id || item.albuminfo?.id || '',
        hash:item.hash || item.HASH || item.audio_info?.hash || '',
        picUrl:String(item.img || item.cover || item.trans_param?.union_cover || '').replace('{size}', '400'),
        interval:durationText((item.timelength || item.timelen || 0) / 1000),
        source:'kg', types:['flac','320k','128k'],
      };
    }),
  };
}

async function importMG(id) {
  // The service caps responses at 50 but still calculates offsets from the
  // requested pageSize. Requesting more than 50 silently skips songs.
  const pageSize = 50;
  const [songsData, infoData] = await Promise.all([
    fetchJson(`https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?pageNo=1&pageSize=${pageSize}&playlistId=${id}`),
    fetchJson(`https://c.musicapp.migu.cn/MIGUM3.0/resource/playlist/v2.0?playlistId=${id}`),
  ]);
  const rows = [...(songsData?.data?.songList || [])];
  const total = Number(songsData?.data?.totalCount || infoData?.data?.musicNum || rows.length);
  const actualPageSize = Math.max(1, rows.length || pageSize);
  for (let page = 2; rows.length < total && page <= Math.ceil(total / actualPageSize) + 1; page += 1) {
    const pageData = await fetchJson(
      `https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?pageNo=${page}&pageSize=${pageSize}&playlistId=${id}`
    );
    const pageRows = pageData?.data?.songList || [];
    if (!pageRows.length) break;
    const before = uniqueBy(rows, item => item.songId || item.id || item.copyrightId).length;
    rows.push(...pageRows);
    const after = uniqueBy(rows, item => item.songId || item.id || item.copyrightId).length;
    if (after === before) break;
  }
  const songs = uniqueBy(rows, item => item.songId || item.id || item.copyrightId);
  if (!rows.length) throw new Error('小菇歌单读取失败');
  return {
    name:infoData?.data?.title || `小菇歌单 ${id}`, cover:infoData?.data?.imgItem?.img || '',
    songs:songs.map(item => ({
      id:item.songId || item.id, songmid:item.songId || item.id, copyrightId:item.copyrightId || '',
      name:item.name || item.songName || '', singer:singerText(item.singerList || item.singers),
      albumName:item.album || item.albumName || '', albumId:item.albumId || '', picUrl:item.img3 || item.img || '',
      lrcUrl:item.lrcUrl || '', mrcUrl:item.mrcurl || '', trcUrl:item.trcUrl || '',
      interval:durationText(item.duration), source:'mg', types:['flac24bit','flac','320k','128k'],
    })),
  };
}

const IMPORTERS = { tx:importQQ, wy:importWY, kw:importKW, kg:importKG, mg:importMG };
async function importPlaylist(input, preferredSource) {
  let parsed;
  try {
    parsed = detect(input, preferredSource);
  } catch (firstError) {
    const expanded = await expandShareLink(input);
    if (expanded === String(input || '')) throw firstError;
    parsed = detect(expanded, preferredSource);
  }
  const result = await IMPORTERS[parsed.source](parsed.id, parsed.input);
  result.songs = (result.songs || []).filter(song => song.name && song.songmid);
  if (!result.songs.length) throw new Error('歌单中没有可导入的歌曲');
  return {
    ok:true,
    playlist:{
      id:`platform_${parsed.source}_${parsed.id}`,
      name:result.name,
      cover:result.cover,
      source:parsed.source,
      sourceListId:parsed.id,
      imported:true,
      songs:result.songs,
    },
  };
}

module.exports = { importPlaylist, setFetchImplementation, detect };
