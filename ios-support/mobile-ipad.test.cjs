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
  const windowListeners = new Map(), documentListeners = new Map();
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
    addEventListener(name, fn) { windowListeners.set(name, fn); },
    attemptAudioPlay: async options => { calls.push({ method:'attemptAudioPlay', options }); media.paused = false; return true; },
    configureSystemMediaSessionControls() { calls.push({ method:'configureSystemMediaSessionControls' }); },
    nextTrack() { calls.push({ method:'nextTrack' }); }, prevTrack() { calls.push({ method:'prevTrack' }); },
    applyRendererPowerMode() { calls.push({ method: 'resize' }); }
  };
  const document = { hidden: false, head: { appendChild() {} }, getElementById: () => null, querySelector: () => null,
    createElement: () => ({}), addEventListener(name, fn) { documentListeners.set(name, fn); if (name === 'DOMContentLoaded') domReady = fn; } };
  const context = vm.createContext({ window, document, navigator: {}, console, innerWidth: 1180, innerHeight: 820,
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) },
    requestAnimationFrame(fn) { raf.set(++sequence, fn); return sequence; }, cancelAnimationFrame(id) { raf.delete(id); },
    setTimeout, clearTimeout, Date: { now: () => now },
    MouseEvent: class { constructor(type, values) { Object.assign(this, { type }, values); } },
    WheelEvent: class { constructor(type, values) { Object.assign(this, { type }, values); } }
  });
  vm.runInContext(code, context); domReady();
  return { mobile, media, calls, events, listeners, raf, mediaListeners, window, document,
    windowListeners, documentListeners, setNow: value => { now = value; } };
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
test('system media mode uses one native player and never performs audio handoff', async () => {
  const app = boot();
  app.mobile.enterBackgroundAudio();
  assert.equal(app.media.paused, false);
  app.mobile.nativeBackgroundAudioDidStart();
  assert.equal(app.media.paused, false);
  await Promise.all([app.mobile.resumeForegroundAudio(), app.mobile.resumeForegroundAudio()]);
  assert.equal(app.calls.filter(c => ['syncAudio', 'resumeWebAudio', 'finishWebAudioResume'].includes(c.method)).length, 0);
  assert.equal(app.media.paused, false);
  assert.equal(app.mobile.isNativeAudioOwned(), false);
  app.mobile.createAudio();
  assert.equal(app.mobile.isNativeAudioOwned(), true);
  assert.equal(app.mobile.backgroundPlaybackMode, 'native-avplayer');
});
test('native audio facade forwards play, seek, volume and end without WebKit playback', async () => {
  const app = boot();
  app.window.Capacitor.nativePromise = (plugin, method, value) => {
    app.calls.push({ plugin, method, value });
    return Promise.resolve(method === 'playAudio' ? { duration:210 } : {});
  };
  const audio = app.mobile.createAudio();
  const seen = [];
  ['play', 'playing', 'loadedmetadata', 'timeupdate', 'seeked', 'ended'].forEach(name => audio.addEventListener(name, () => seen.push(name)));
  audio.src = 'http://localhost:3000/api/audio?url=test';
  audio.currentTime = 12;
  audio.volume = 0.6;
  await audio.play();
  assert.equal(audio.paused, false);
  assert.equal(audio.duration, 210);
  assert.equal(app.calls.find(c => c.method === 'playAudio').value.position, 12);
  assert.ok(seen.includes('playing'));
  app.mobile.nativePlaybackEvent({ url:audio.src, event:'timeupdate', position:42, duration:210, playing:true });
  assert.equal(audio.currentTime, 42);
  app.mobile.nativePlaybackEvent({ url:audio.src, event:'seeked', position:98, duration:210, playing:true });
  assert.equal(audio.currentTime, 98);
  assert.ok(seen.includes('seeked'));
  app.mobile.nativePlaybackEvent({ url:audio.src, event:'ended', position:210, duration:210, playing:false });
  assert.equal(audio.ended, true);
  assert.ok(seen.includes('ended'));
  audio.pause();
  assert.ok(app.calls.every(c => c.method !== 'syncAudio'));
});
test('native PCM visual levels are accepted only for the current song', () => {
  const app = boot();
  const audio = app.mobile.createAudio();
  audio.src = 'http://localhost:3000/api/audio?url=one';
  app.mobile.nativeVisualEvent({ url:audio.src, levels:[12, 34, 56, 78] });
  assert.deepEqual(Array.from(app.mobile.visualLevels.levels), [12, 34, 56, 78]);
  audio.src = 'http://localhost:3000/api/audio?url=two';
  app.mobile.nativeVisualEvent({ url:'http://localhost:3000/api/audio?url=one', levels:[200, 200, 200, 200] });
  assert.deepEqual(Array.from(app.mobile.visualLevels.levels), [12, 34, 56, 78]);
});
test('native song time advances smoothly between updates and freezes while buffering', async () => {
  const app = boot();
  const audio = app.mobile.createAudio();
  audio.src = 'http://localhost:3000/api/audio?url=song';
  await audio.play();
  app.mobile.nativePlaybackEvent({ url:audio.src, event:'timeupdate', position:7, duration:180, bufferedEnd:23, playing:true });
  assert.equal(audio.buffered.end(0), 23, 'report AVPlayer buffer rather than pretending the whole song is cached');
  app.setNow(10250);
  assert.ok(Math.abs(audio.currentTime - 7.25) < 0.001);
  app.mobile.nativePlaybackEvent({ url:audio.src, event:'buffering', position:7.25, duration:180, bufferedEnd:7.25, playing:false });
  app.setNow(11000);
  assert.equal(audio.currentTime, 7.25);
  assert.equal(audio.paused, false, 'buffering must not be presented as a user pause');
  assert.equal(audio.readyState, 2);
  app.mobile.nativePlaybackEvent({ url:audio.src, event:'playing', position:7.25, duration:180, bufferedEnd:35, playing:true });
  assert.equal(audio.readyState, 4);
  assert.equal(audio.buffered.end(0), 35);
});
test('audio session activation is explicit and the playing event does not reactivate it', async () => {
  const app = boot();
  await app.mobile.activateAudio();
  await app.mobile.activateAudio();
  await tick();
  assert.equal(app.calls.filter(c => c.method === 'activateAudio').length, 1);
  assert.equal(app.calls.filter(c => c.method === 'syncAudio').length, 0);
  assert.equal(app.mediaListeners.has('playing'), false);
  await app.mobile.activateAudio(true);
  assert.equal(app.calls.filter(c => c.method === 'activateAudio').length, 2);
});
test('official music session is claimed before playback without waiting for the metadata timer', async () => {
  const app = boot();
  app.window.Capacitor.nativePromise = (plugin, method, value) => {
    app.calls.push({ plugin, method, value });
    return Promise.resolve({ officialNowPlaying:true });
  };
  const state = { title:'下一首', artist:'歌手', playing:false };
  assert.equal(await app.mobile.claimOfficialNowPlaying(state), true);
  assert.equal(app.mobile.officialNowPlaying, true);
  assert.equal(app.calls.filter(c => c.method === 'syncNowPlaying').length, 1);
  assert.equal(app.calls.find(c => c.method === 'syncNowPlaying').value, state);
  assert.equal(await app.mobile.claimOfficialNowPlaying(state), true);
  assert.equal(app.calls.filter(c => c.method === 'syncNowPlaying').length, 1);
});
test('foreground return does not reactivate a playing stream and resumes only an unintended pause', async () => {
  const app = boot();
  const visibility = app.documentListeners.get('visibilitychange');
  app.document.hidden = true; visibility();
  app.document.hidden = false; visibility();
  await tick();
  assert.equal(app.calls.filter(c => c.method === 'activateAudio').length, 0);
  assert.equal(app.calls.filter(c => c.method === 'attemptAudioPlay').length, 0);
  app.document.hidden = true; visibility();
  app.media.paused = true;
  app.document.hidden = false; visibility();
  await tick();
  assert.equal(app.calls.filter(c => c.method === 'attemptAudioPlay').length, 1);
  assert.equal(app.media.paused, false);
  // iOS may pause the element just before it reports that the page is hidden.
  app.mediaListeners.get('play')();
  app.media.paused = true;
  app.document.hidden = true; visibility();
  app.document.hidden = false; visibility();
  await tick();
  assert.equal(app.calls.filter(c => c.method === 'attemptAudioPlay').length, 2);
  app.document.hidden = true; visibility();
  app.media.paused = true; app.media.__mrExplicitPause = true;
  app.document.hidden = false; visibility();
  await tick();
  assert.equal(app.calls.filter(c => c.method === 'attemptAudioPlay').length, 2);
});
test('native Now Playing provides track commands without starting another player', async () => {
  const app = boot();
  app.window.Capacitor.nativePromise = (plugin, method, value) => {
    app.calls.push({ plugin, method, value });
    return Promise.resolve({ officialNowPlaying:true });
  };
  app.mobile.syncNowPlaying({ title:'喜欢', artist:'阿肆', cover:'https://music.example/cover.jpg', playing:true });
  await new Promise(resolve => setTimeout(resolve, 150));
  const sync = app.calls.find(c => c.method === 'syncNowPlaying');
  assert.equal(sync.value.title, '喜欢');
  assert.equal(sync.value.cover, 'https://music.example/cover.jpg');
  assert.equal(app.mobile.nativeNowPlayingCommands, true);
  assert.equal(app.mobile.officialNowPlaying, true);
  app.mobile.remoteSystemCommand('previous'); app.mobile.remoteSystemCommand('next');
  app.window.dispatchSystemPlaybackCommand = command => app.calls.push({ method:'playbackCommand', command });
  app.mobile.remoteSystemCommand('play'); app.mobile.remoteSystemCommand('pause');
  assert.equal(app.calls.filter(c => c.method === 'prevTrack').length, 1);
  assert.equal(app.calls.filter(c => c.method === 'nextTrack').length, 1);
  assert.deepEqual(app.calls.filter(c => c.method === 'playbackCommand').map(c => c.command), ['play', 'pause']);
  assert.equal(app.calls.filter(c => c.method === 'configureSystemMediaSessionControls').length, 0);
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
  assert.match(html, /previoustrack: function\(\)\{ systemTrackCommand\('previous'\); \}/);
  assert.match(html, /nexttrack: function\(\)\{ systemTrackCommand\('next'\); \}/);
  assert.match(html, /window\.MineradioMobile\.syncNowPlaying/);
  assert.match(html, /raw\.lyricGlowStrength == null/);
});

test('native AVPlayer is the sole system player with music controls and artwork', () => {
  const swift = fs.readFileSync(path.join(__dirname, 'AppDelegate.swift'), 'utf8');
  assert.match(swift, /private var musicPlayer: AVPlayer\?/);
  assert.match(swift, /CAPPluginMethod\(name: "playAudio"/);
  assert.doesNotMatch(swift, /syncAudio|takeOver\(|resumeWebAudio|finishWebAudioResume/);
  assert.match(swift, /commands\.skipForwardCommand\.isEnabled = false/);
  assert.match(swift, /commands\.nextTrackCommand\.isEnabled = true/);
  assert.match(swift, /commands\.changePlaybackPositionCommand\.isEnabled = true/);
  assert.match(swift, /event as\? MPChangePlaybackPositionCommandEvent/);
  assert.match(swift, /self\?\.seekFromSystem\(position\)/);
  assert.match(swift, /if event != "timeupdate" \{ publishNowPlaying\(\) \}/);
  assert.match(swift, /MPMediaItemPropertyArtwork/);
  assert.match(swift, /MPNowPlayingInfoPropertyPlaybackQueueCount/);
  assert.doesNotMatch(swift, /import NowPlaying|MediaSession<MineradioOfficialNowPlayingModel>/);
  assert.match(swift, /commands\.previousTrackCommand\.isEnabled = true/);
  assert.match(swift, /commands\.playCommand\.addTarget/);
  assert.match(swift, /commands\.pauseCommand\.addTarget/);
  assert.match(swift, /guard !audioSessionActivated else \{ return \}/);
  assert.match(swift, /setCategory\(\.playback/);
  assert.match(code, /backgroundPlaybackMode = 'native-avplayer'/);
  assert.match(code, /mobile\.isNativeAudioOwned = function \(\) \{ return !!nativeAudio; \}/);
  assert.doesNotMatch(code, /native\('syncAudio'/);
});
