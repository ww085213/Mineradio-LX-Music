'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
function sourceBetween(start, end) {
  const first = html.indexOf(start);
  const last = html.indexOf(end, first);
  assert.ok(first >= 0 && last > first, 'playback source boundaries must exist');
  return html.slice(first, last);
}
const tick = () => new Promise(resolve => setImmediate(resolve));

function playbackHarness() {
  const timers = new Map();
  const icons = [];
  let nextTimer = 0;
  let pauseCount = 0;
  const media = {
    src: 'https://music.example/old.mp3', currentTime: 10, paused: false, ended: false,
    play() { return new Promise(() => {}); },
    pause() { pauseCount++; this.paused = true; }
  };
  const context = vm.createContext({
    audio:media, audioReady:true, trackSwitchToken:1, playing:false,
    window:{}, console:{ warn() {} },
    document:{ hidden:false }, iosSystemMediaPlaybackMode:() => false,
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    preparePlaybackFadeIn() {}, resumeAudioAnalysis:async () => {},
    switchPlaybackVisualToEmily() {}, startPlaybackFadeIn() {}, restorePlaybackGain() {},
    forcePlaybackControlsInteractive() {}, hideLoading() {}, showToast() {},
    setPlayIcon(value) { icons.push(value); }
  });
  vm.runInContext(sourceBetween('var mediaPlayAttemptSerial = 0;', 'async function playAudio('), context);
  return { context, media, timers, icons, get pauseCount() { return pauseCount; } };
}

test('an old play timeout cannot pause or relabel a newer song', async () => {
  const app = playbackHarness();
  const pending = app.context.attemptAudioPlay({ manual:true, silent:true, fade:false, playbackToken:1, playTimeoutMs:1500 });
  await tick();
  assert.equal(app.timers.size, 1);
  app.media.src = 'https://music.example/new.mp3';
  app.context.trackSwitchToken = 2;
  app.context.playing = true;
  [...app.timers.values()][0]();
  assert.equal(await pending, false);
  assert.equal(app.pauseCount, 0);
  assert.equal(app.context.playing, true);
  assert.deepEqual(app.icons, []);
});

test('a progressing song survives a late play-promise timeout', async () => {
  const app = playbackHarness();
  const pending = app.context.attemptAudioPlay({ manual:true, silent:true, fade:false, playbackToken:1, playTimeoutMs:1500 });
  await tick();
  app.media.currentTime = 11;
  [...app.timers.values()][0]();
  assert.equal(await pending, true);
  assert.equal(app.pauseCount, 0);
  assert.equal(app.context.playing, true);
});

test('an old same-address attempt cannot pause a newer reconnect', async () => {
  const app = playbackHarness();
  const first = app.context.attemptAudioPlay({ manual:true, silent:true, fade:false, playbackToken:1, playTimeoutMs:1500 });
  await tick();
  const firstTimeout = [...app.timers.values()][0];
  const second = app.context.attemptAudioPlay({ manual:true, silent:true, fade:false, playbackToken:1, playTimeoutMs:1500 });
  await tick();
  const secondTimeout = [...app.timers.values()][1];
  firstTimeout();
  assert.equal(await first, false);
  assert.equal(app.pauseCount, 0);
  app.media.currentTime = 11;
  secondTimeout();
  assert.equal(await second, true);
  assert.equal(app.pauseCount, 0);
});

function matchingHarness(apiJson) {
  const notices = [];
  const context = vm.createContext({
    trackSwitchToken:1, apiJson,
    normalizeLxSourceName:value => value,
    simpleSearchNorm:value => String(value || '').toLowerCase(),
    lxSongPlayPayload:song => song,
    lxSourceQualityCandidates:() => ['128k'],
    saveImportedLxPlaylists() {}, applyLxCoverForStatus() {},
    safeRenderQueuePanel() {}, scheduleShelfRebuild() {},
    showSourceFallbackNotice(...args) { notices.push(args); },
    console:{ warn() {} }, Date
  });
  vm.runInContext(sourceBetween('function applyCrossPlatformSongMatch(', 'async function resolveImportedLxAudio('), context);
  return { context, notices };
}

test('a cross-platform match changes stored song details only after playback succeeds', async () => {
  const candidate = { name:'Song', singer:'Singer', source:'wy', id:'new', cover:'new.jpg' };
  const app = matchingHarness(async route => route.includes('/search?')
    ? { songs:[candidate] } : { ok:true, url:'https://music.example/match.mp3', resolver:'test' });
  const song = { name:'Song', singer:'Singer', source:'tx', id:'old', cover:'old.jpg' };
  const match = await app.context.resolveCrossPlatformAudioFallback(song, 'tx', [], { playbackToken:1 });
  assert.equal(match.url, 'https://music.example/match.mp3');
  assert.deepEqual({ source:song.source, id:song.id, cover:song.cover }, { source:'tx', id:'old', cover:'old.jpg' });
  assert.equal(app.notices.length, 0);
  app.context.commitCrossPlatformAudioFallback(song, match, { preservePresentation:true });
  assert.deepEqual({ source:song.source, id:song.id, cover:song.cover }, { source:'wy', id:'new', cover:'old.jpg' });
  assert.equal(app.notices.length, 1);
});

test('a superseded cross-platform search cannot change the new song', async () => {
  let finishSearch;
  const app = matchingHarness(() => new Promise(resolve => { finishSearch = resolve; }));
  const song = { name:'Song', singer:'Singer', source:'tx', id:'old' };
  const pending = app.context.resolveCrossPlatformAudioFallback(song, 'tx', [], { playbackToken:1 });
  app.context.trackSwitchToken = 2;
  finishSearch({ songs:[{ name:'Song', singer:'Singer', source:'wy', id:'new' }] });
  assert.equal(await pending, null);
  assert.equal(song.id, 'old');
  assert.equal(app.notices.length, 0);
});

function runtimeErrorHarness(explicitPause) {
  const timers = [];
  const restarted = [];
  const media = {
    src:'https://music.example/stream.mp3', currentSrc:'https://music.example/stream.mp3',
    currentTime:10, paused:true, ended:false, __mrExplicitPause:explicitPause
  };
  const context = vm.createContext({
    song:{ _lastLxResolver:'manual-source' }, opts:{}, audio:media,
    runtimeRetry:0, playbackToken:1, trackSwitchToken:1,
    excludedResolvers:[], playlistIndex:0, songIndex:0,
    window:{}, console:{ warn() {} },
    setTimeout(fn) { timers.push(fn); },
    startImportedAudioUrl:async (...args) => { restarted.push(args); return true; },
    showSourceFallbackNotice() {}, playImportedLxInsideMineradio:async () => {}
  });
  vm.runInContext(sourceBetween('  var playingResolver = ', '  if (!recovering) {\n    safePlaybackStep'), context);
  return { context, media, timers, restarted };
}

test('a media error still reconnects when the error itself paused the player', async () => {
  const app = runtimeErrorHarness(false);
  app.media.onerror();
  for (let i = 0; i < 3; i++) await app.timers.shift()();
  assert.equal(app.restarted.length, 1);
  assert.equal(app.restarted[0][0], app.media.src);
  assert.equal(typeof app.media.onerror, 'function');
});

test('an explicit user pause does not reconnect the stream', async () => {
  const app = runtimeErrorHarness(true);
  app.media.onerror();
  assert.equal(app.timers.length, 0);
  assert.equal(app.restarted.length, 0);
});
