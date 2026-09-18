'use strict';
// App-private cache for WebView blob audio that native AVPlayer cannot open.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');

async function handle(req, res, url, dataDir) {
  const directory = path.join(dataDir, 'cache', 'background-audio');
  fs.mkdirSync(directory, { recursive: true });
  if (req.method === 'POST' && url.pathname === '/api/mobile/audio-cache') {
    const id = crypto.randomBytes(16).toString('hex');
    const target = path.join(directory, id + '.audio');
    let bytes = 0;
    try {
      const limiter = new Transform({ transform(chunk, _encoding, done) {
        bytes += chunk.length;
        if (bytes > 256 * 1024 * 1024) done(new Error('LOCAL_AUDIO_TOO_LARGE'));
        else done(null, chunk);
      } });
      await pipeline(req, limiter, fs.createWriteStream(target, { flags: 'wx' }));
      const supplied = String(req.headers['content-type'] || '');
      const mime = /^audio\/[\w.+-]+$/i.test(supplied) ? supplied : 'application/octet-stream';
      fs.writeFileSync(path.join(directory, id + '.json'), JSON.stringify({ mime }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, url: '/api/mobile/audio-cache/' + id }));
    } catch (_error) {
      try { fs.unlinkSync(target); } catch (_ignore) {}
      if (!res.destroyed) { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'LOCAL_AUDIO_CACHE_FAILED' })); }
    }
    return;
  }
  const match = /^\/api\/mobile\/audio-cache\/([a-f0-9]{32})$/.exec(url.pathname);
  if (!match || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end(); return; }
  try {
    const file = path.join(directory, match[1] + '.audio');
    const size = fs.statSync(file).size;
    const mime = JSON.parse(fs.readFileSync(path.join(directory, match[1] + '.json'), 'utf8')).mime;
    let start = 0, end = size - 1, status = 200;
    if (req.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!range || (!range[1] && !range[2])) throw new Error('RANGE');
      start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': 'bytes */' + size }); res.end(); return; }
      status = 206;
    }
    const headers = { 'Content-Type': mime, 'Content-Length': String(Math.max(0, end - start + 1)), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400' };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || size === 0) { res.end(); return; }
    const stream = fs.createReadStream(file, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch (_error) { res.writeHead(404); res.end(); }
}
module.exports = { handle };
