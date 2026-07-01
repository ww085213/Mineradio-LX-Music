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

function durationText(seconds) {
  seconds = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function singerText(value) {
  return Array.isArray(value) ? value.map(item => item?.name || item?.singerName).filter(Boolean).join('、') : String(value || '');
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
    ['kg', /(?:kugou\.com|kugou\.cn)[^\s]*?(?:plist\/list\/|special\/single\/|zlist\.html[^\s]*?[?&](?:listid|id)=|[?&](?:listid|specialid|id)=)(\d+)/i],
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
  if (!list) throw new Error('小芸歌单读取失败');
  return {
    name:list.name || `小芸歌单 ${id}`, cover:list.coverImgUrl || '',
    songs:(list.tracks || []).map(item => ({
      id:item.id, songmid:item.id, name:item.name || '', singer:singerText(item.ar || item.artists),
      albumName:(item.al || item.album)?.name || '', albumId:(item.al || item.album)?.id || '',
      picUrl:(item.al || item.album)?.picUrl || '', interval:durationText((item.dt || item.duration || 0) / 1000),
      source:'wy', types:['flac','320k','128k'],
    })),
  };
}

async function importKW(id) {
  const data = await fetchJson(`https://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${id}&pn=0&rn=10000&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1`);
  if (data?.result !== 'ok') throw new Error('小蜗歌单读取失败');
  return {
    name:data.title || `小蜗歌单 ${id}`, cover:data.pic || '',
    songs:(data.musiclist || []).map(item => ({
      id:String(item.musicrid || item.id || '').replace('MUSIC_', ''),
      songmid:String(item.musicrid || item.id || '').replace('MUSIC_', ''),
      name:item.name || item.songname || '', singer:item.artist || '', albumName:item.album || '',
      albumId:item.albumid || '', interval:durationText(item.duration), source:'kw',
      types:['flac24bit','flac','320k','128k'],
    })),
  };
}

async function importKG(id) {
  const data = await fetchJson(`https://m.kugou.com/plist/list/${id}?json=true`);
  const info = data?.info || data?.data?.info;
  const rows = data?.list?.list?.info || data?.data?.songs || [];
  if (!rows.length) throw new Error('小狗歌单读取失败');
  return {
    name:info?.specialname || `小狗歌单 ${id}`, cover:info?.imgurl || '',
    songs:rows.map(item => ({
      id:item.audio_id || item.audioid || item.id, songmid:item.audio_id || item.audioid || item.id,
      name:item.songname || String(item.filename || '').split(' - ').slice(1).join(' - '),
      singer:item.singername || String(item.filename || '').split(' - ')[0] || '',
      albumName:item.album_name || '', albumId:item.album_id || '', hash:item.hash || item.audio_info?.hash || '',
      interval:durationText(item.duration), source:'kg', types:['flac','320k','128k'],
    })),
  };
}

async function importMG(id) {
  const [songsData, infoData] = await Promise.all([
    fetchJson(`https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?pageNo=1&pageSize=10000&playlistId=${id}`),
    fetchJson(`https://c.musicapp.migu.cn/MIGUM3.0/resource/playlist/v2.0?playlistId=${id}`),
  ]);
  const rows = songsData?.data?.songList || [];
  if (!rows.length) throw new Error('小菇歌单读取失败');
  return {
    name:infoData?.data?.title || `小菇歌单 ${id}`, cover:infoData?.data?.imgItem?.img || '',
    songs:rows.map(item => ({
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
  const result = await IMPORTERS[parsed.source](parsed.id);
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
