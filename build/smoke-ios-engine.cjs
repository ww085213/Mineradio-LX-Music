'use strict';
// Optional live-network smoke test. It uses the real mobile Node entry point,
// but a test bridge instead of iOS, and an isolated package with NO sources.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

if (process.argv[2] === '--child') {
  const Module = require('node:module');
  const originalLoad = Module._load;
  Module._load = function (name, parent, isMain) {
    if (name === 'bridge') return {
      app: { datadir: () => process.argv[4], on() {} },
      channel: { post(event, data) { if (data.state === 'failed') process.send({ error: data.message }); } }
    };
    return originalLoad.call(this, name, parent, isMain);
  };
  process.chdir(process.argv[3]);
  require(path.join(process.argv[3], 'mobile-node-main.js'));
} else {
  async function main() {
    const repo = path.resolve(__dirname, '..');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-ios-nosource-'));
    const pkg = path.join(tmp, 'nodejs');
    const data = path.join(tmp, 'data');
    fs.mkdirSync(pkg); fs.mkdirSync(data);
    for (const name of fs.readdirSync(repo)) {
      if (name.endsWith('.js')) fs.copyFileSync(path.join(repo, name), path.join(pkg, name));
    }
    fs.copyFileSync(path.join(repo, 'package.json'), path.join(pkg, 'package.json'));
    fs.copyFileSync(path.join(repo, 'ios-support/mobile-node-main.js'), path.join(pkg, 'mobile-node-main.js'));
    const portServer = require('node:net').createServer();
    await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
    const port = portServer.address().port;
    await new Promise(resolve => portServer.close(resolve));
    const child = require('node:child_process').fork(__filename, ['--child', pkg, data], {
      env: { ...process.env, NODE_PATH: path.join(repo, 'node_modules'), APPDATA: data, LOCALAPPDATA: data,
        MINERADIO_MOBILE_PORT: String(port), MINERADIO_UPDATE_DIR: path.join(data, 'updates') },
      silent: true
    });
    let runtimeError = '';
    child.on('message', message => { if (message.error) runtimeError = message.error; });
    child.stdout.resume(); child.stderr.resume();
    const base = `http://127.0.0.1:${port}`;
    const get = async route => {
      const response = await fetch(base + route, { headers: { Origin: 'capacitor://localhost' }, signal: AbortSignal.timeout(40000) });
      assert.equal(response.headers.get('access-control-allow-origin'), 'capacitor://localhost');
      return { status: response.status, data: await response.json() };
    };
    try {
      let health;
      for (let i = 0; i < 60; i++) {
        if (runtimeError) throw new Error(runtimeError);
        try { health = await get('/api/health'); break; } catch (_error) { await new Promise(r => setTimeout(r, 100)); }
      }
      assert.equal(health?.data.service, 'mineradio-local-engine');
      assert.equal(health.data.mobile, true);
      const status = await get('/api/lx-source/status');
      assert.equal(status.data.error, 'LX_SOURCE_NOT_CONFIGURED');
      assert.equal(fs.existsSync(path.join(pkg, 'builtin-source.json')), false);
      console.log('PASS: actual mobile engine starts; CORS works; no imported or built-in source');
      const missing = await get('/api/does-not-exist');
      assert.equal(missing.status, 404);
      assert.equal(missing.data.error, 'API_NOT_FOUND');
      for (const [kind, route, field] of [
        ['songs', '/api/lx-source/search?q=' + encodeURIComponent('晴天') + '&sources=tx,wy,kw,kg,mg&limit=3', 'songs'],
        ['playlists', '/api/lx-source/playlist-search?q=' + encodeURIComponent('周杰伦') + '&sources=tx,wy,kw,kg,mg&limit=3', 'playlists']
      ]) {
        const started = Date.now();
        const result = await get(route);
        console.log(JSON.stringify({ kind, status: result.status, ok: result.data.ok, count: result.data[field]?.length,
          elapsedMs: Date.now() - started, sample: result.data[field]?.slice(0, 2).map(row => ({ name: row.name, source: row.source })),
          failures: result.data.failures }));
        assert.ok(result.data.ok && result.data[field]?.length, `${kind} live search returned no results`);
      }
      assert.equal(fs.existsSync(path.join(data, 'Mineradio/sources/sources.json')), false);
      console.log('PASS: song and playlist search independent of audio sources (desktop-hosted mobile runtime; not iPad hardware)');
    } finally {
      child.kill();
      console.log('Isolated test fixtures retained: ' + tmp);
    }
  }
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
