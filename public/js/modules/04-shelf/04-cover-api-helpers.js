function compactCount(n) {
  n = Number(n) || 0;
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}
function drawCanvasHeart(ctx, cx, cy, size, color) {
  var s = (size || 20) / 28;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, 10.2);
  ctx.bezierCurveTo(-8.9, 2.6, -13.8, -1.9, -13.8, -7.4);
  ctx.bezierCurveTo(-13.8, -12.0, -10.3, -15.2, -5.9, -15.2);
  ctx.bezierCurveTo(-3.2, -15.2, -1.1, -13.9, 0, -11.9);
  ctx.bezierCurveTo(1.1, -13.9, 3.2, -15.2, 5.9, -15.2);
  ctx.bezierCurveTo(10.3, -15.2, 13.8, -12.0, 13.8, -7.4);
  ctx.bezierCurveTo(13.8, -1.9, 8.9, 2.6, 0, 10.2);
  ctx.closePath();
  ctx.fillStyle = color || '#ff7a90';
  ctx.fill();
  ctx.restore();
}
function requestPlaylistCover(url, cb) {
  if (!url) { if (cb) cb(null); return; }
  var originalUrl = String(url);
  url = normalizeRemoteCoverUrl(url);
  var rec = playlistCoverCache[url] || playlistCoverCache[originalUrl];
  if (rec && rec.loaded) { if (cb) setTimeout(function () { cb(rec.img); }, 0); return; }
  if (rec && rec.loading) { if (cb) rec.waiters.push(cb); return; }
  if (rec && rec.failed && Date.now() - (rec.failedAt || 0) < 15000) {
    if (cb) setTimeout(function () { cb(null); }, 0);
    return;
  }
  rec = { loaded: false, loading: true, waiters: cb ? [cb] : [], img: null, failed: false, failedAt: 0 };
  playlistCoverCache[url] = rec;
  playlistCoverCache[originalUrl] = rec;
  var candidates = isInlineCoverSrc(url) ? [url] : [coverProxySrc(url), url];
  candidates = candidates.filter(function (src, index, all) { return src && all.indexOf(src) === index; });
  var candidateIndex = 0;
  function finish(img) {
    rec.loading = false;
    rec.loaded = !!img;
    rec.failed = !img;
    rec.failedAt = img ? 0 : Date.now();
    rec.img = img || null;
    rec.waiters.splice(0).forEach(function (fn) { setTimeout(function () { fn(img || null); }, 0); });
  }
  function tryNext() {
    if (candidateIndex >= candidates.length) { finish(null); return; }
    var img = new Image();
    if (!isInlineCoverSrc(candidates[candidateIndex])) img.crossOrigin = 'anonymous';
    img.onload = function () { finish(img); };
    img.onerror = function () { candidateIndex++; tryNext(); };
    img.src = candidates[candidateIndex];
  }
  tryNext();
}

var missingSongCoverRequests = Object.create(null);
var missingSongCoverRetryAt = Object.create(null);
var missingSongCoverSaveTimer = 0;
function missingSongCoverKey(song) {
  song = song || {};
  return [normalizeLxSourceName(song.source || song.provider || song.type), song.songmid || song.id || song.hash || '', song.name || song.title || '', song.singer || song.artist || ''].join('|');
}
function missingSongCoverNorm(value) {
  value = String(value || '');
  try { value = value.normalize('NFKC'); } catch (_error) {}
  return value.toLowerCase().replace(/[\s·・•_—–\-~,\uff0c.\u3002!\uff01?\uff1f:\uff1a;\uff1b'"\u201c\u201d\u2018\u2019`´/\\|()（）\[\]【】]+/g, '');
}
function pickMissingSongCover(result, title, singer) {
  var wantedTitle = missingSongCoverNorm(title);
  var wantedSinger = missingSongCoverNorm(singer);
  var candidates = result && Array.isArray(result.songs) ? result.songs : [];
  var best = null, bestScore = -1;
  candidates.forEach(function (candidate) {
    var candidateTitle = missingSongCoverNorm(candidate && (candidate.name || candidate.title));
    var candidateSinger = missingSongCoverNorm(candidate && (candidate.singer || candidate.artist));
    if (!candidateTitle || !(candidateTitle === wantedTitle || candidateTitle.indexOf(wantedTitle) >= 0 || wantedTitle.indexOf(candidateTitle) >= 0)) return;
    var score = candidateTitle === wantedTitle ? 100 : 64;
    if (wantedSinger && candidateSinger && (candidateSinger.indexOf(wantedSinger) >= 0 || wantedSinger.indexOf(candidateSinger) >= 0)) score += 36;
    var cover = songCoverSrc(candidate, 160);
    if (cover && score > bestScore) { best = { candidate: candidate, cover: cover }; bestScore = score; }
  });
  return best;
}
function requestMissingSongCover(song, cb) {
  var sourceName = normalizeLxSourceName(song && (song.source || song.provider || song.type));
  var title = String(song && (song.name || song.title) || '').trim();
  if (!song || !title || !/^(tx|wy|kw|kg|mg)$/.test(sourceName)) { if (cb) cb(''); return; }
  var key = missingSongCoverKey(song);
  if (missingSongCoverRequests[key]) {
    if (cb) missingSongCoverRequests[key].then(cb, function () { cb(''); });
    return;
  }
  if (missingSongCoverRetryAt[key] && Date.now() < missingSongCoverRetryAt[key]) { if (cb) cb(''); return; }
  var singer = String(song.singer || song.artist || song.author || '').trim();
  var query = [title, singer].filter(Boolean).join(' ');
  var promise = apiJson('/api/lx-source/search?q=' + encodeURIComponent(query) + '&limit=8&sources=' + sourceName, { timeoutMs: 8000 }).then(function (result) {
    var best = pickMissingSongCover(result, title, singer);
    if (best) return best;
    return apiJson('/api/song-cover-search?q=' + encodeURIComponent(query) + '&limit=12', { timeoutMs: 10000 })
      .then(function (fallbackResult) { return pickMissingSongCover(fallbackResult, title, singer); });
  }).then(function (best) {
    if (!best) throw new Error('COVER_NOT_FOUND');
    song.picUrl = best.cover;
    song.cover = best.cover;
    if (best.candidate.albumName && !song.albumName) song.albumName = best.candidate.albumName;
    if (missingSongCoverSaveTimer) clearTimeout(missingSongCoverSaveTimer);
    missingSongCoverSaveTimer = setTimeout(function () {
      missingSongCoverSaveTimer = 0;
      try { if (typeof saveLocalUserPlaylists === 'function') saveLocalUserPlaylists(); } catch (_error) {}
    }, 900);
    return best.cover;
  }).catch(function () {
    missingSongCoverRetryAt[key] = Date.now() + 5 * 60 * 1000;
    return '';
  }).finally(function () { delete missingSongCoverRequests[key]; });
  missingSongCoverRequests[key] = promise;
  if (cb) promise.then(cb);
}

// ============================================================
//  3D 卡片交互 - PSP 风格
//   - 滚轮: 滚动 center 卡 (一级或二级)
//   - 点击 center 卡: 打开内容框 (歌单) 或 播放 (队列)
//   - 点击两侧卡: 滚到那张
//   - ESC: 关闭内容框
