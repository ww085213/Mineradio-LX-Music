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

test('iPad keeps usable web track handlers alongside native buttons and rejects duplicate taps', () => {
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
  assert.equal(typeof handlers.previoustrack, 'function');
  assert.equal(typeof handlers.nexttrack, 'function');
  assert.equal(handlers.seekbackward, null);
  assert.equal(handlers.seekforward, null);
  handlers.previoustrack();
  context.window.dispatchSystemTrackCommand('previous');
  assert.deepEqual(calls, ['previous']);
  now += 301;
  handlers.nexttrack();
  context.window.dispatchSystemTrackCommand('next');
  assert.deepEqual(calls, ['previous', 'next']);
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
  assert.equal(metadata.at(-1).artwork[0].src, states[2].cover);
  assert.equal(metadata.at(-1).artist, '尹美莱');
  context.trackSwitchToken += 1;
  context.updateSystemMediaSessionMetadata();
  assert.match(states[3].cover, /\/api\/image-proxy\?url=/);
  context.window.MineradioMobile.officialNowPlaying = true;
  const webMetadataCount = metadata.length;
  context.updateSystemMediaSessionMetadata();
  assert.equal(states.length, 5);
  assert.equal(metadata.length, webMetadataCount, 'native system session must not compete with WebKit metadata');
});
