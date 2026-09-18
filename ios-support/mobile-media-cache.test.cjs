'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { handle } = require('../mobile-media-cache');
test('local audio cache supports native range reads and rejects path traversal', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-cache-test-'));
  const server = http.createServer((req, res) => handle(req, res, new URL(req.url, 'http://localhost'), temp));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const response = await fetch(base + '/api/mobile/audio-cache', { method: 'POST', headers: { 'Content-Type': 'audio/mpeg' }, body: Buffer.from('0123456789') });
    const data = await response.json();
    assert.equal(data.ok, true);
    const part = await fetch(base + data.url, { headers: { Range: 'bytes=2-5' } });
    assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(part.headers.get('content-type'), 'audio/mpeg'); assert.equal(await part.text(), '2345');
    const suffix = await fetch(base + data.url, { headers: { Range: 'bytes=-3' } });
    assert.equal(await suffix.text(), '789');
    assert.equal((await fetch(base + data.url, { headers: { Range: 'bytes=100-' } })).status, 416);
    assert.equal((await fetch(base + '/api/mobile/audio-cache/%2e%2e%2fsecret')).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
