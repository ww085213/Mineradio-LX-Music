'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'mobile-bridge.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function boot(options = {}) {
  const nodes = new Map();
  const listeners = new Map();
  function element() {
    const children = new Map();
    return { style: {}, classList: { add() {}, remove() {} },
      appendChild(child) { if (child.id) nodes.set(child.id, child); },
      setAttribute() {}, focus() {}, remove() { nodes.delete(this.id); },
      querySelector(selector) { if (!children.has(selector)) children.set(selector, element()); return children.get(selector); }
    };
  }
  const calls = [], native = [];
  let starts = 0, reloads = 0;
  const window = {
    fetch: async (input, init) => {
      const url = String(input.url || input);
      calls.push({ url, init, input });
      if (url.includes('/api/health')) {
        if (options.health) return options.health(url);
        return { ok: true, json: async () => ({ ok: true, mobile: true, service: 'mineradio-local-engine' }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, songs: [{ name: '晴天' }] }) };
    },
    Capacitor: {
      Plugins: options.missingPlugin ? {} : { Nodejs: {
        addListener() {}, start() { starts++; return options.start ? options.start() : new Promise(() => {}); }
      } },
      nativePromise(plugin, method, args) { native.push({ plugin, method, args }); return Promise.resolve({ status: 200, data: 'robots' }); }
    }
  };
  const context = vm.createContext({ window, URL, Request, AbortController, DOMException, setTimeout, clearTimeout, console,
    XMLHttpRequest: function () {},
    location: { href: 'capacitor://localhost/index.html', origin: 'capacitor://localhost', reload() { reloads++; } },
    document: { head: element(), body: element(), documentElement: element(),
      createElement: element, getElementById: id => nodes.get(id),
      addEventListener: (name, fn) => listeners.set(name, fn) }
  });
  context.XMLHttpRequest.prototype.open = function () {};
  vm.runInContext(source, context);
  return { window, nodes, calls, native, context, start: () => listeners.get('DOMContentLoaded')(),
    get starts() { return starts; }, get reloads() { return reloads; } };
}

test('queue early API requests; start native engine once; no automatic reload', async () => {
  const app = boot();
  const result = app.window.fetch('/api/lx-source/search?q=test');
  await flush();
  assert.equal(app.calls.length, 0);
  app.start();
  await result;
  assert.equal(app.starts, 1);
  assert.equal(app.reloads, 0);
  assert.equal(app.nodes.has('mineradio-ios-startup'), false);
  assert.equal(app.calls.at(-1).url, 'http://localhost:3000/api/lx-source/search?q=test');
  assert.equal(app.native[0].plugin, 'CapacitorHttp');
  assert.equal(app.native[0].method, 'request');
  assert.match(app.native[0].args.url, /^https:\/\//);
});

test('HTTP 200 HTML is not health; numeric loopback fallback selects valid JSON', async () => {
  const app = boot({ health: async url => ({ ok: true, json: async () => {
    if (url.startsWith('http://localhost')) throw new SyntaxError('HTML not JSON');
    return { ok: true, mobile: true, service: 'mineradio-local-engine' };
  } }) });
  app.start();
  await app.window.fetch(new URL('capacitor://localhost/api/health'));
  assert.equal(app.window.MOBILE_API_ORIGIN, 'http://127.0.0.1:3000');
  assert.equal(app.calls.at(-1).url, 'http://127.0.0.1:3000/api/health');
});

test('reject generic ok JSON as health and preserve already-running native engine', async () => {
  const app = boot({ start: () => Promise.reject(new Error('Already started')), health: async url => ({ ok: true, json: async () =>
    url.startsWith('http://localhost') ? { ok: true } : { ok: true, mobile: true, service: 'mineradio-local-engine' }
  }) });
  app.start();
  await app.window.fetch('capacitor://localhost/api/test');
  assert.equal(app.window.MOBILE_API_ORIGIN, 'http://127.0.0.1:3000');
  assert.equal(app.reloads, 0);
});

test('external API URLs are not hijacked; relative assets remain offline', async () => {
  const app = boot();
  await app.window.fetch('https://example.com/api/test');
  await app.window.fetch('vendor/three.r128.min.js');
  assert.equal(app.calls[0].url, 'https://example.com/api/test');
  assert.equal(app.calls[1].url, 'vendor/three.r128.min.js');
  assert.equal(app.starts, 0);
});

test('cancel a queued API before startup without sending it to Capacitor static server', async () => {
  const app = boot();
  const controller = new AbortController();
  const result = app.window.fetch('/api/test', { signal: controller.signal });
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(app.calls.length, 0);
});

test('Request body/method/headers survive loopback mapping', async () => {
  const app = boot();
  app.start();
  await app.window.fetch(new Request('capacitor://localhost/api/test', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"test":true}'
  }));
  assert.equal(app.calls.at(-1).url, 'http://localhost:3000/api/test');
  assert.equal(app.calls.at(-1).input.method, 'POST');
  assert.equal(app.calls.at(-1).input.headers.get('content-type'), 'application/json');
  assert.equal(await app.calls.at(-1).input.text(), '{"test":true}');
});

test('missing Node plugin fails queued API explicitly; native network check still runs', async () => {
  const app = boot({ missingPlugin: true });
  app.start();
  await assert.rejects(app.window.fetch('/api/test'), /Nodejs plugin/);
  assert.equal(app.native.length, 1);
  assert.equal(app.calls.length, 0);
});

test('all inline UI JavaScript parses', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  let count = 0;
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!body.trim() || /type=["'](?:application\/ld\+json|application\/json|importmap)["']/i.test(attrs)) continue;
    new vm.Script(body, { filename: `inline-script-${++count}.js` });
  }
  assert.ok(count > 0);
});
