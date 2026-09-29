'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, 'mobile-ipad.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function boot() {
  const calls = [], events = [], listeners = new Map(), raf = new Map(), stored = new Map();
  let sequence = 0, domReady, now = 10000;
  const canvas = { addEventListener(name, fn) { listeners.set(name, fn); }, dispatchEvent(event) { events.push(event); } };
  const mobile = { getServerUrl: () => 'http://localhost:3000', diagnostics: {} };
  const mediaListeners = new Map();
  const media = { src: 'http://localhost:3000/api/audio?url=test', currentSrc: '', currentTime: 12, duration: 90,
    volume: 1, playbackRate: 1, paused: false, ended: false, loop: false,
    setAttribute() {}, addEventListener(name, fn) { mediaListeners.set(name, fn); },
    pause() { this.paused = true; mediaListeners.get('pause')?.(); }, async play() { this.paused = false; mediaListeners.get('playing')?.(); }
  };
  const window = {
    MineradioMobile: mobile, renderer: { domElement: canvas }, audio: media,
    playQueue: [{ id: '1', name: 'song', source: 'wy' }], currentIdx: 0,
    toggleHomeTransparencyMode() {},
    Capacitor: { nativePromise(plugin, method, value) {
      calls.push({ plugin, method, value });
      return Promise.resolve({});
    } },
    addEventListener() {}, applyRendererPowerMode() { calls.push({ method: 'resize' }); }
  };
  const document = { hidden: false, head: { appendChild() {} }, getElementById: () => null, querySelector: () => null,
    createElement: () => ({}), addEventListener(name, fn) { if (name === 'DOMContentLoaded') domReady = fn; } };
  const context = vm.createContext({ window, document, navigator: {}, console, innerWidth: 1180, innerHeight: 820,
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) },
    requestAnimationFrame(fn) { raf.set(++sequence, fn); return sequence; }, cancelAnimationFrame(id) { raf.delete(id); },
    setTimeout, clearTimeout, Date: { now: () => now },
    MouseEvent: class { constructor(type, values) { Object.assign(this, { type }, values); } },
    WheelEvent: class { constructor(type, values) { Object.assign(this, { type }, values); } }
  });
  vm.runInContext(code, context); domReady();
  return { mobile, media, calls, events, listeners, raf, mediaListeners, window, setNow: value => { now = value; } };
}
test('touch movement is coalesced to one event per rendered frame', () => {
  const app = boot();
  const touch = (x, y) => ({ clientX: x, clientY: y });
  app.listeners.get('touchstart')({ touches: [touch(100, 100)], preventDefault() {} });
  for (let i = 0; i < 240; i++) app.listeners.get('touchmove')({ touches: [touch(100 + i, 101)], preventDefault() {} });
  assert.equal(app.events.filter(e => e.type === 'mousemove').length, 0);
  assert.equal(app.raf.size, 1);
  [...app.raf.values()][0]();
  assert.equal(app.events.filter(e => e.type === 'mousemove').length, 1);
  assert.equal(app.events.at(-1).clientX, 339);
});
test('pinch produces zoom, not an unintended song click', () => {
  const app = boot();
  const touches = [{ clientX: 100, clientY: 100 }, { clientX: 200, clientY: 100 }];
  app.listeners.get('touchstart')({ touches: [touches[0]], preventDefault() {} });
  app.listeners.get('touchstart')({ touches, preventDefault() {} });
  app.listeners.get('touchmove')({ touches: [touches[0], { clientX: 250, clientY: 100 }], preventDefault() {} });
  app.listeners.get('touchend')({ touches: [], changedTouches: touches, type: 'touchend', preventDefault() {} });
  assert.ok(app.events.some(e => e.type === 'wheel' && e.deltaY < 0));
  assert.equal(app.events.filter(e => e.type === 'click').length, 0);
});
test('system media mode keeps one player and never performs native handoff', async () => {
  const app = boot();
  app.mobile.enterBackgroundAudio();
  assert.equal(app.media.paused, false);
  app.mobile.nativeBackgroundAudioDidStart();
  assert.equal(app.media.paused, false);
  await Promise.all([app.mobile.resumeForegroundAudio(), app.mobile.resumeForegroundAudio()]);
  assert.equal(app.calls.filter(c => ['syncAudio', 'resumeWebAudio', 'finishWebAudioResume'].includes(c.method)).length, 0);
  assert.equal(app.media.paused, false);
  assert.equal(app.mobile.isNativeAudioOwned(), false);
  assert.equal(app.mobile.backgroundPlaybackMode, 'system-media-session');
});
test('playing only activates the iOS audio session and does not serialize a native queue', async () => {
  const app = boot();
  app.mediaListeners.get('playing')();
  await tick();
  assert.equal(app.calls.filter(c => c.method === 'activateAudio').length, 1);
  assert.equal(app.calls.filter(c => c.method === 'syncAudio').length, 0);
});
test('adaptive resolution reduces pixel cost under load, with hysteresis', () => {
  const app = boot();
  app.mobile.updatePerformance(40); app.mobile.updatePerformance(40);
  assert.equal(app.mobile.renderScale, 0.92);
  for (let i = 0; i < 8; i++) app.mobile.updatePerformance(60);
  assert.equal(app.mobile.renderScale, 0.92);
  app.setNow(15000); app.mobile.updatePerformance(60);
  assert.equal(app.mobile.renderScale, 0.96);
  const reduction = 1 - (1 / (1.18 * 1.18));
  assert.ok(reduction > 0.28 && reduction < 0.29);
});
test('cover proxy functions use existing backend route; FPS supports tap', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.ok(!html.includes("'/api/cover?url='"));
  assert.ok(html.includes("'/api/image-proxy?url='"));
  assert.ok(html.includes("window.MineradioMobile ? '点击隐藏'"));
  assert.match(html, /transportRetries < 2/);
  assert.match(html, /startImportedAudioUrl\(failedSource/);
  assert.match(html, /\[LXImportedTransportResume\]/);
  assert.match(html, /stillAdvancing/);
  assert.match(html, /preservePresentation:recovering/);
  assert.match(html, /action === 'seekbackward' \|\| action === 'seekforward'/);
  assert.match(html, /raw\.lyricGlowStrength == null/);
});

test('native lifecycle cannot start the retired second background player', () => {
  const swift = fs.readFileSync(path.join(__dirname, 'AppDelegate.swift'), 'utf8');
  assert.doesNotMatch(swift, /AVPlayer|MPRemoteCommand|syncAudio|takeOver\(|resumeWebAudio|finishWebAudioResume/);
  assert.match(swift, /setCategory\(\.playback/);
  assert.match(code, /backgroundPlaybackMode = 'system-media-session'/);
  assert.match(code, /mobile\.isNativeAudioOwned = function \(\) \{ return false; \}/);
  assert.doesNotMatch(code, /native\('syncAudio'/);
});
