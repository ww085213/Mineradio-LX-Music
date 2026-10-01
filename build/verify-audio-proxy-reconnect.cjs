const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

function listen(server, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => resolve(server.address().port));
  });
}

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      http.get(url, response => {
        response.resume();
        if (response.statusCode) resolve();
        else setTimeout(check, 100);
      }).on('error', () => {
        if (Date.now() >= deadline) reject(new Error('Mineradio test server did not start'));
        else setTimeout(check, 100);
      });
    };
    check();
  });
}

function fetchBuffer(url, headers) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers:headers || {} }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('end', () => resolve({ status:response.statusCode, headers:response.headers, body:Buffer.concat(chunks) }));
      response.once('error', reject);
    }).once('error', reject);
  });
}

function nonLoopbackAddress() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  throw new Error('No non-loopback IPv4 address is available for the SSRF-safe proxy test');
}

(async () => {
  const payload = crypto.randomBytes(768 * 1024);
  const icon = fs.readFileSync(path.resolve(__dirname, 'icon.png'));
  let prematureDisconnects = 0;
  let rangeReconnects = 0;
  const upstream = http.createServer((req, res) => {
    if (req.url === '/cover') {
      res.writeHead(200, { 'Content-Type':'image/png', 'Content-Length':String(icon.length) });
      res.end(icon);
      return;
    }
    const match = /^bytes=(\d+)-(\d*)$/i.exec(String(req.headers.range || ''));
    const start = match ? Number(match[1]) : 0;
    const end = match && match[2] ? Math.min(payload.length - 1, Number(match[2])) : payload.length - 1;
    if (match) rangeReconnects += 1;
    res.writeHead(match ? 206 : 200, {
      'Content-Type':'audio/mpeg',
      'Content-Length':String(end - start + 1),
      'Accept-Ranges':'bytes',
      'ETag':'"mineradio-proxy-test"',
      ...(match ? { 'Content-Range':`bytes ${start}-${end}/${payload.length}` } : {}),
    });
    if (prematureDisconnects < 4) {
      const partial = prematureDisconnects++ === 0 ? 128 * 1024 : 16 * 1024;
      res.write(payload.subarray(start, Math.min(end + 1, start + partial)));
      setTimeout(() => res.socket.destroy(), 20);
      return;
    }
    res.end(payload.subarray(start, end + 1));
  });

  const hostAddress = nonLoopbackAddress();
  const upstreamPort = await listen(upstream, '0.0.0.0');
  const appPort = 39000 + Math.floor(Math.random() * 1500);
  const root = path.resolve(__dirname, '..');
  const child = spawn(process.execPath, ['server.js'], {
    cwd:root,
    env:{ ...process.env, HOST:'127.0.0.1', PORT:String(appPort), MINERADIO_MOBILE:'1' },
    stdio:['ignore', 'pipe', 'pipe'],
    windowsHide:true,
  });
  let childOutput = '';
  child.stdout.on('data', chunk => { childOutput += chunk; });
  child.stderr.on('data', chunk => { childOutput += chunk; });
  try {
    await waitForServer(`http://127.0.0.1:${appPort}/api/health`, 15000);
    const target = `http://${hostAddress}:${upstreamPort}/audio`;
    const result = await fetchBuffer(`http://127.0.0.1:${appPort}/api/audio?url=${encodeURIComponent(target)}`);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.headers['x-mineradio-audio-proxy'], 'range-reconnect-v2');
    assert.deepStrictEqual(result.body, payload);
    assert.ok(rangeReconnects >= 4, 'iPad proxy did not survive repeated byte-range reconnects');
    const rangeStart = 222222;
    const ranged = await fetchBuffer(`http://127.0.0.1:${appPort}/api/audio?url=${encodeURIComponent(target)}`, { Range:`bytes=${rangeStart}-` });
    assert.strictEqual(ranged.status, 206);
    assert.strictEqual(ranged.headers['content-range'], `bytes ${rangeStart}-${payload.length - 1}/${payload.length}`);
    assert.deepStrictEqual(ranged.body, payload.subarray(rangeStart));
    const coverTarget = `http://${hostAddress}:${upstreamPort}/cover`;
    const cover = await fetchBuffer(`http://127.0.0.1:${appPort}/api/image-proxy?url=${encodeURIComponent(coverTarget)}`);
    assert.strictEqual(cover.status, 200);
    assert.match(String(cover.headers['content-type']), /^image\/png/);
    assert.deepStrictEqual(cover.body, icon);
    process.stdout.write(`audio reconnect/range and cover proxy ok (${payload.length} bytes, ${rangeReconnects} range requests)\n`);
  } catch (error) {
    process.stderr.write(childOutput);
    throw error;
  } finally {
    child.kill();
    await new Promise(resolve => upstream.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
