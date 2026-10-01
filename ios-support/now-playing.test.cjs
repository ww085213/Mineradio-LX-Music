'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
function section(start, end) {
  const first = html.indexOf(start);
  const last = html.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return html.slice(first, last);
}

test('iPad uses only native system handlers and rejects duplicate track taps', () => {
  const handlers = {};
  const calls = [];
  let now = 1000;
  const context = vm.createContext({
    window:{ MineradioMobile:{ platform:'ios', nativeNowPlayingCommands:true } },
    navigator:{ mediaSession:{ setActionHandler(name, handler) { handlers[name] = handler; } } },
    iosSystemMediaPlaybackMode:() => true,
    Date:{ now:() => now },
    prevTrack() { calls.push('previous'); }, nextTrack() { calls.push('next'); }
  });
  vm.runInContext(section('function configureSystemMediaSessionControls()', 'var wallpaperCoverToggle'), context);
  assert.deepEqual(handlers, {});
  context.window.dispatchSystemTrackCommand('previous');
  context.window.dispatchSystemTrackCommand('previous');
  assert.deepEqual(calls, ['previous']);
  now += 301;
  context.window.dispatchSystemTrackCommand('next');
  context.window.dispatchSystemTrackCommand('next');
  assert.deepEqual(calls, ['previous', 'next']);
});

test('iPad visual analysis follows song time without routing the audible element through Web Audio', () => {
  const context = vm.createContext({
    FFT_SIZE:2048,
    audio:{ currentTime:0.01, paused:false, ended:false },
    currentBeatMap:{ spectrumStep:0.05, spectrumFrames:[80, 90, 100, 110, 180, 190, 200, 210] },
    currentDjBeatMap:null,
    djMode:{ active:false },
    Math, Number
  });
  vm.runInContext(section('function createIosVisualAnalyser()', 'function initAudio()'), context);
  const analyser = context.createIosVisualAnalyser();
  const first = new Uint8Array(1024);
  const second = new Uint8Array(1024);
  const paused = new Uint8Array(1024);
  analyser.getByteFrequencyData(first);
  context.audio.currentTime = 0.08;
  analyser.getByteFrequencyData(second);
  assert.ok(second[4] > first[4]);
  context.audio.paused = true;
  analyser.getByteFrequencyData(paused);
  assert.equal(paused[4], 0);
  assert.doesNotMatch(section('function createIosVisualAnalyser()', 'function initAudio()'), /createMediaElementSource|\.connect\(/);
});

test('missing playlist cover is resolved and republished to the system card', () => {
  const states = [];
  const metadata = [];
  const song = { name:'ANGEL (天使)', singer:'尹美莱', source:'tx', cover:'' };
  let finishCover;
  const context = vm.createContext({
    window:{ location:{ href:'capacitor://localhost/index.html' }, MineradioMobile:{
      syncNowPlaying(state) { states.push(state); }
    } },
    document:{ createElement(name) {
      assert.equal(name, 'canvas');
      return { getContext() { return { drawImage() {} }; }, toDataURL() { return 'data:image/jpeg;base64,Y292ZXI='; } };
    } },
    navigator:{ mediaSession:{} },
    MediaMetadata:class { constructor(value) { metadata.push(value); } },
    audio:{ src:'http://localhost:3000/api/audio?url=song', paused:false, ended:false },
    playQueue:[song], currentIdx:0, trackSwitchToken:4,
    currentDesktopSongMeta:() => ({ title:song.name, artist:song.singer, cover:song.cover }),
    syncWindowNowPlayingTitle() {},
    isProxyableCoverUrl:value => /^https?:/.test(value),
    coverUrlWithSize:value => value,
    coverProxySrc:value => 'http://localhost:3000/api/image-proxy?url=' + encodeURIComponent(value),
    iosSystemMediaPlaybackMode:() => true,
    buildLxFallbackCover:() => 'data:image/png;base64,Zml4dHVyZQ==',
    requestMissingSongCover(target, callback) { assert.equal(target, song); finishCover = callback; },
    getPlaybackDurationSeconds:() => 255, getPlaybackCurrentSeconds:() => 131
  });
  vm.runInContext(section('var iosSystemCoverSnapshot', 'function configureSystemMediaSessionControls()'), context);
  context.updateSystemMediaSessionMetadata();
  assert.equal(states.length, 1);
  assert.match(states[0].cover, /^data:image/);
  assert.equal(states[0].queueCount, 1);
  assert.equal(typeof finishCover, 'function');
  song.cover = 'https://y.gtimg.cn/music/photo_new/album.jpg';
  finishCover(song.cover);
  assert.equal(states.length, 2);
  assert.match(states[1].cover, /\/api\/image-proxy\?url=/);
  context.captureSystemMediaSessionCover({});
  assert.equal(states.length, 3);
  assert.equal(states[2].cover, 'data:image/jpeg;base64,Y292ZXI=');
  assert.equal(metadata.length, 0, 'WebKit must not compete with native Now Playing');
  context.trackSwitchToken += 1;
  context.updateSystemMediaSessionMetadata();
  assert.match(states[3].cover, /\/api\/image-proxy\?url=/);
  const webMetadataCount = metadata.length;
  context.updateSystemMediaSessionMetadata();
  assert.equal(states.length, 5);
  assert.equal(metadata.length, webMetadataCount, 'native system session must not compete with WebKit metadata');
});

test('iPad auto-next skips the silent gesture clip and never waits for a background fade', async () => {
  const calls = [];
  const media = { src:'https://example.test/next.mp3', paused:true, ended:false,
    play() { calls.push('play'); this.paused = false; return Promise.resolve(); } };
  const context = vm.createContext({
    window:{ MineradioMobile:{ platform:'ios', activateAudio:() => Promise.resolve(true) } },
    document:{ hidden:true }, navigator:{}, audio:media, audioReady:true,
    trackSwitchToken:5, playing:false,
    iosSystemMediaPlaybackMode:() => true,
    resumeAudioAnalysis:() => Promise.resolve(),
    preparePlaybackFadeIn() { calls.push('fade-to-zero'); },
    startPlaybackFadeIn() { calls.push('fade-in'); },
    restorePlaybackGain() { calls.push('restore-volume'); },
    switchPlaybackVisualToEmily() {}, setPlayIcon() {},
    forcePlaybackControlsInteractive() {}, hideLoading() {},
    console, setTimeout, clearTimeout
  });
  vm.runInContext(section('var mediaPlayAttemptSerial', 'async function playAudio'), context);
  assert.equal(await context.attemptAudioPlay({ manual:true, silent:true, playbackToken:5 }), true);
  assert.deepEqual(calls, ['restore-volume', 'play', 'restore-volume']);
  assert.match(html, /playLxMirrorSong\(playlistIndex, next, null, \{ autoAdvance:true \}\)/);
  assert.match(html, /if \(!opts\.autoAdvance\) primeOnlineAudioForUserGesture\(\)/);
});

test('iPad online playback uses cached beats without downloading the full song mid-play', async () => {
  const calls = [];
  const context = vm.createContext({
    beatMapToken:3, trackSwitchToken:7, beatMapCache:{},
    beatMapSongKey:() => 'online-song',
    showBeatChip:() => calls.push('show'), hideBeatChip:() => calls.push('hide'),
    readBeatDiskCache:async () => null,
    applyBeatMapCacheForCurrent:() => { calls.push('cache'); return true; },
    iosSystemMediaPlaybackMode:() => true,
    scheduleBeatAnalysis:() => calls.push('analyze')
  });
  vm.runInContext(section('async function loadBeatMapForEveryTrack(', 'function localBeatDiskKey('), context);
  assert.equal(await context.loadBeatMapForEveryTrack({}, 'https://example.test/song', 7), false);
  assert.deepEqual(calls, ['show', 'hide']);
  context.beatMapCache['online-song'] = { beats:[1, 2] };
  assert.equal(await context.loadBeatMapForEveryTrack({}, 'https://example.test/song', 7), true);
  assert.equal(calls.at(-1), 'cache');
  assert.ok(!calls.includes('analyze'));
});
