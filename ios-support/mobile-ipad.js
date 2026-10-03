(function () {
  'use strict';
  var mobile = window.MineradioMobile;
  if (!mobile) return;
  mobile.renderScale = 1;
  var slowSamples = 0, fastSamples = 0, lastScaleChange = 0;
  mobile.updatePerformance = function (fps) {
    if (document.hidden || !(fps > 0)) return;
    slowSamples = fps < 48 ? slowSamples + 1 : 0;
    fastSamples = fps >= 58 ? fastSamples + 1 : 0;
    if (Date.now() - lastScaleChange < 4000) return;
    var scale = mobile.renderScale;
    if (slowSamples >= 2) scale = Math.max(0.78, scale - 0.08);
    else if (fastSamples >= 8) scale = Math.min(1, scale + 0.04);
    if (scale === mobile.renderScale) return;
    mobile.renderScale = Math.round(scale * 100) / 100; lastScaleChange = Date.now();
    slowSamples = fastSamples = 0;
    if (typeof window.applyRendererPowerMode === 'function') window.applyRendererPowerMode();
  };
  var native = function (method, data) { return window.Capacitor.nativePromise('MineradioNative', method, data || {}); };
  var boundAudio = null;
  var wasPlayingWhenHidden = false;
  var nowPlayingTimer = 0;
  var pendingNowPlaying = null;
  var audioActivation = null;
  mobile.nativeNowPlayingCommands = false;
  mobile.officialNowPlaying = false;
  var nativeAudio = null;
  var cachedNativeBlobUrls = Object.create(null);
  function nativeReadableAudioUrl(source) {
    if (!/^blob:/i.test(source)) return Promise.resolve(source);
    if (cachedNativeBlobUrls[source]) return Promise.resolve(cachedNativeBlobUrls[source]);
    return fetch(source).then(function (response) {
      if (!response.ok) throw new Error('无法读取本地歌曲');
      return response.blob();
    }).then(function (body) {
      return fetch('/api/mobile/audio-cache', {
        method:'POST', headers:{ 'Content-Type':body.type || 'application/octet-stream' }, body:body
      });
    }).then(function (response) {
      if (!response.ok) throw new Error('本地歌曲缓存失败：HTTP ' + response.status);
      return response.json();
    }).then(function (result) {
      if (!result || !result.ok || !result.url) throw new Error(result && result.error || '本地歌曲缓存失败');
      return (cachedNativeBlobUrls[source] = mobile.getServerUrl() + result.url);
    });
  }
  mobile.createAudio = function () {
    if (nativeAudio) return nativeAudio;
    var listeners = Object.create(null);
    var media = {
      _mrNativeAudio:true, _src:'', _position:0, _positionAt:Date.now(), _duration:NaN,
      _paused:true, _advancing:false, _ended:false, _readyState:0, _error:null, _bufferedStart:0, _bufferedEnd:0,
      _volume:1, _muted:false, _rate:1, _loop:false,
      crossOrigin:'anonymous', defaultPlaybackRate:1,
      addEventListener:function (name, callback) {
        if (typeof callback === 'function') (listeners[name] || (listeners[name] = [])).push(callback);
      },
      removeEventListener:function (name, callback) {
        var list = listeners[name];
        if (list) listeners[name] = list.filter(function (item) { return item !== callback; });
      },
      setAttribute:function () {},
      removeAttribute:function (name) { if (name === 'src') this.src = ''; },
      load:function () { if (this._src) this._emit('loadstart'); },
      _emit:function (name) {
        var event = { type:name, target:this, currentTarget:this };
        var handler = this['on' + name];
        if (typeof handler === 'function') { try { handler.call(this, event); } catch (error) { console.warn('[iOS audio event]', error); } }
        (listeners[name] || []).slice().forEach(function (callback) {
          try { callback.call(media, event); } catch (error) { console.warn('[iOS audio listener]', error); }
        });
      },
      play:function () {
        if (!this._src) return Promise.reject(new Error('没有播放地址'));
        var source = this._src;
        var self = this;
        return nativeReadableAudioUrl(source).then(function (nativeUrl) {
          if (source !== self._src) throw new Error('已切换歌曲');
          return native('playAudio', {
            url:nativeUrl, clientUrl:source, position:self._position, volume:self._volume,
            muted:self._muted, rate:self._rate, loop:self._loop
          });
        }).then(function (state) {
          if (source !== self._src) throw new Error('已切换歌曲');
          if (state && Number(state.duration) > 0) {
            self._duration = Number(state.duration);
            self._emit('loadedmetadata'); self._emit('durationchange');
          }
          if (self._paused) { self._paused = false; self._emit('play'); }
          self._advancing = !!(state && state.playing);
          self._positionAt = Date.now();
          self._readyState = state && state.playing ? 4 : 2;
          self._ended = false; self._error = null;
          self._emit('playing'); self._emit('canplay'); self._emit('loadeddata');
        }).catch(function (error) {
          if (source === self._src) {
            self._paused = true; self._error = { code:4, message:String(error && error.message || error) };
            self._emit('error');
          }
          throw error;
        });
      },
      pause:function () {
        if (!this._paused) {
          this._position = this.currentTime; this._positionAt = Date.now();
          this._paused = true; this._advancing = false; this._emit('pause');
        }
        native('pauseAudio').catch(function (error) { console.warn('[iOS pause]', error); });
      }
    };
    Object.defineProperties(media, {
      src:{ get:function () { return this._src; }, set:function (value) {
        var next = String(value || '');
        if (next === this._src) return;
        var previous = this._src;
        this._src = next; this._position = 0; this._positionAt = Date.now(); this._duration = NaN;
        this._advancing = false;
        this._readyState = 0; this._paused = true; this._ended = false; this._error = null;
        this._bufferedStart = 0; this._bufferedEnd = 0;
        this._emit('emptied');
        if (!next) native('stopAudio', { url:previous }).catch(function () {});
      } },
      currentSrc:{ get:function () { return this._src; } },
      currentTime:{ get:function () {
        var position = this._position;
        if (!this._paused && this._advancing) {
          position += Math.max(0, Date.now() - this._positionAt) / 1000 * this._rate;
        }
        return isFinite(this._duration) && this._duration > 0 ? Math.min(this._duration, position) : position;
      }, set:function (value) {
        var target = Math.max(0, Number(value) || 0);
        this._position = target; this._positionAt = Date.now();
        native('seekAudio', { url:this._src, position:target }).catch(function () {});
        this._emit('seeked'); this._emit('timeupdate');
      } },
      duration:{ get:function () { return this._duration; } },
      paused:{ get:function () { return this._paused; } },
      ended:{ get:function () { return this._ended; } },
      readyState:{ get:function () { return this._readyState; } },
      error:{ get:function () { return this._error; } },
      buffered:{ get:function () {
        var start = Math.max(0, Number(this._bufferedStart) || 0);
        var end = Math.max(0, Number(this._bufferedEnd) || 0);
        return { length:end > start ? 1 : 0, start:function () { return start; }, end:function () { return end; } };
      } },
      volume:{ get:function () { return this._volume; }, set:function (value) {
        this._volume = Math.max(0, Math.min(1, Number(value) || 0)); scheduleSettings();
      } },
      muted:{ get:function () { return this._muted; }, set:function (value) {
        this._muted = !!value; scheduleSettings();
      } },
      playbackRate:{ get:function () { return this._rate; }, set:function (value) {
        this._rate = Math.max(0.5, Math.min(2, Number(value) || 1)); scheduleSettings();
      } },
      loop:{ get:function () { return this._loop; }, set:function (value) {
        this._loop = !!value; scheduleSettings();
      } }
    });
    var settingsTimer = 0;
    function scheduleSettings() {
      if (settingsTimer) return;
      settingsTimer = setTimeout(function () {
        settingsTimer = 0;
        native('setAudioSettings', {
          volume:media._volume, muted:media._muted, rate:media._rate, loop:media._loop
        }).catch(function () {});
      }, 60);
    }
    nativeAudio = media;
    return media;
  };
  mobile.nativePlaybackEvent = function (state) {
    var media = nativeAudio;
    if (!media || !state || state.url !== media._src) return;
    var duration = Number(state.duration);
    if (duration > 0 && isFinite(duration) && duration !== media._duration) {
      media._duration = duration; media._emit('loadedmetadata'); media._emit('durationchange');
    }
    var position = Number(state.position);
    if (position >= 0 && isFinite(position)) { media._position = position; media._positionAt = Date.now(); }
    var bufferedEnd = Number(state.bufferedEnd);
    if (bufferedEnd >= 0 && isFinite(bufferedEnd)) media._bufferedEnd = bufferedEnd;
    var bufferedStart = Number(state.bufferedStart);
    if (bufferedStart >= 0 && isFinite(bufferedStart)) media._bufferedStart = bufferedStart;
    media._advancing = !!state.playing;
    if (state.event === 'seeked') media._emit('seeked');
    if (state.event === 'error') {
      media._paused = true; media._error = { code:4, message:String(state.message || '播放失败') };
      media._emit('error'); return;
    }
    if (state.event === 'ended') {
      media._ended = true; media._paused = true; media._emit('timeupdate'); media._emit('ended'); return;
    }
    if (state.playing && media._paused) { media._paused = false; media._emit('play'); media._emit('playing'); }
    else if (state.event === 'pause' && !media._paused) { media._paused = true; media._emit('pause'); }
    if (state.event === 'buffering') { media._readyState = 2; media._emit('waiting'); }
    else if (state.playing) media._readyState = 4;
    media._emit('timeupdate');
  };
  mobile.nativeVisualEvent = function (state) {
    if (!nativeAudio || !state || state.url !== nativeAudio._src || !Array.isArray(state.levels)) return;
    var levels = state.levels.slice(0, 4).map(function (value) {
      return Math.max(0, Math.min(255, Number(value) || 0));
    });
    if (levels.length !== 4) return;
    mobile.visualLevels = { levels:levels, at:Date.now(), url:state.url };
  };
  mobile.activateAudio = function (force) {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_error) {}
    // An already active session needs no Capacitor round trip. In the
    // background that round trip can be held until WebKit returns to the UI.
    if (audioActivation && !force) return audioActivation;
    audioActivation = native('activateAudio').catch(function (error) {
      audioActivation = null;
      console.warn('[iOS audio session]', error && error.message || error);
      return false;
    });
    return audioActivation;
  };
  mobile.bindAudio = function (media) {
    boundAudio = media;
    if (media.__ipadBound) return;
    media.__ipadBound = true;
    media.setAttribute('playsinline', '');
    media.addEventListener('play', function () { wasPlayingWhenHidden = true; });
    // This is a JS facade only. The native AVPlayer remains the sole audible
    // decoder across foreground and background, with no WebKit media session.
  };
  mobile.remoteTrackCommand = function (command) {
    if (typeof window.dispatchSystemTrackCommand === 'function') window.dispatchSystemTrackCommand(command);
    else if (command === 'previous' && typeof window.prevTrack === 'function') window.prevTrack();
    else if (command === 'next' && typeof window.nextTrack === 'function') window.nextTrack();
  };
  mobile.remoteSystemCommand = function (command) {
    if (command === 'previous' || command === 'next') mobile.remoteTrackCommand(command);
    else if (typeof window.dispatchSystemPlaybackCommand === 'function') window.dispatchSystemPlaybackCommand(command);
  };
  mobile.syncNowPlaying = function (state) {
    pendingNowPlaying = state;
    if (nowPlayingTimer) clearTimeout(nowPlayingTimer);
    nowPlayingTimer = setTimeout(function () {
      nowPlayingTimer = 0;
      if (!pendingNowPlaying) return;
      var snapshot = pendingNowPlaying;
      pendingNowPlaying = null;
      native('syncNowPlaying', snapshot).then(function (result) {
        mobile.nativeNowPlayingCommands = true;
        mobile.officialNowPlaying = !!(result && result.officialNowPlaying);
      }).catch(function (error) { console.warn('[iOS Now Playing]', error && error.message || error); });
    }, 120);
  };
  mobile.claimOfficialNowPlaying = function (state) {
    if (mobile.officialNowPlaying || document.hidden) return Promise.resolve(mobile.officialNowPlaying);
    if (nowPlayingTimer) { clearTimeout(nowPlayingTimer); nowPlayingTimer = 0; }
    pendingNowPlaying = null;
    return native('syncNowPlaying', state).then(function (result) {
      mobile.nativeNowPlayingCommands = true;
      mobile.officialNowPlaying = !!(result && result.officialNowPlaying);
      return mobile.officialNowPlaying;
    }).catch(function (error) {
      console.warn('[iOS Now Playing]', error && error.message || error);
      return false;
    });
  };
  mobile.backgroundPlaybackMode = 'native-avplayer';
  mobile.enterBackgroundAudio = function () {};
  mobile.nativeBackgroundAudioDidStart = function () {};
  mobile.isNativeAudioOwned = function () { return !!nativeAudio; };
  var resuming = false;
  mobile.resumeForegroundAudio = async function () {
    if (!boundAudio || resuming || document.hidden) return;
    resuming = true;
    try {
      // A currently playing element already owns the audio session. Calling
      // setActive again on each focus/visibility event can interrupt it.
      if (boundAudio.paused && !boundAudio.ended && wasPlayingWhenHidden && !boundAudio.__mrExplicitPause && boundAudio.src &&
          typeof window.attemptAudioPlay === 'function') {
        await mobile.activateAudio(true);
        await window.attemptAudioPlay({ manual: true, silent: true, fade: false });
      }
      if (typeof window.resumeAudioAnalysis === 'function') await window.resumeAudioAnalysis();
    } catch (error) {
      console.warn('[iOS system media resume]', error && error.message || error);
    } finally {
      if (!boundAudio.paused || boundAudio.__mrExplicitPause) wasPlayingWhenHidden = false;
      resuming = false;
    }
  };

  var style = document.createElement('style');
  style.textContent = [
    'html,body.mobile-device{width:100%;height:100%;height:100dvh;margin:0!important;padding:0!important;background:#050608!important;overflow:hidden;color-scheme:dark}',
    'body.mobile-device{border-radius:0!important;clip-path:none!important;-webkit-text-size-adjust:100%}',
    'body.mobile-device #desktop-window-shell{border-radius:0!important;clip-path:none!important}',
    'body.mobile-device #canvas-container{inset:0!important}body.mobile-device #canvas-container canvas{touch-action:none}',
    'body.mobile-device #render-fps-hud{pointer-events:auto;cursor:pointer;top:calc(12px + env(safe-area-inset-top));right:calc(12px + env(safe-area-inset-right))}',
    'body.mobile-device #empty-home{top:130px;bottom:calc(86px + env(safe-area-inset-bottom));width:calc(100% - 32px);max-width:1240px;overflow:hidden;touch-action:none}',
    'body.mobile-device .empty-home-shell{min-height:0;height:100%;grid-template-columns:minmax(220px,.85fr) minmax(0,1.4fr);overflow:hidden}',
    'body.mobile-device .mobile-home-right-scroll{grid-column:2;grid-row:1 / span 2;min-width:0;min-height:0;height:100%;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;touch-action:pan-y;overscroll-behavior:contain;padding-right:2px;display:flex;flex-direction:column;gap:14px}',
    'body.mobile-device .mobile-home-right-scroll>.home-grid,body.mobile-device .mobile-home-right-scroll>.home-rail,body.mobile-device .mobile-home-right-scroll>.home-feature-strip{flex:0 0 auto;min-width:0}',
    'body.mobile-device #control-cover{display:block!important;visibility:visible!important;opacity:1!important}',
    'body.mobile-device.home-always-transparent #empty-home .home-card,body.mobile-device.home-always-transparent #empty-home .home-hero,body.mobile-device.home-always-transparent #empty-home .home-insight-card,body.mobile-device.home-always-transparent #empty-home .home-discovery-strip,body.mobile-device.home-always-transparent #empty-home .home-feature-card{background:rgba(4,8,12,.10)!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:inset 0 0 0 1px #ffffff18!important}',
    'body.mobile-device.home-always-transparent #empty-home .home-grid.home-quick-grid .home-card-quick:not(:hover),body.mobile-device.home-always-transparent #empty-home .home-grid.home-quick-grid .home-card-quick:hover{background:rgba(4,8,12,.10)!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:inset 0 0 0 1px #ffffff18!important}',
    'body.mobile-device.home-always-transparent #empty-home .home-card::before,body.mobile-device.home-always-transparent #empty-home .home-card::after,body.mobile-device.home-always-transparent #empty-home .home-hero::before,body.mobile-device.home-always-transparent #empty-home .home-insight-card::before,body.mobile-device.home-always-transparent #empty-home .home-discovery-strip::before{display:none!important}',
    'body.mobile-device #fx-panel,body.mobile-device #playlist-panel{max-height:calc(100dvh - 100px - env(safe-area-inset-top) - env(safe-area-inset-bottom));touch-action:pan-y;-webkit-overflow-scrolling:touch}',
    'body.mobile-device #fx-panel.show{right:12px!important;bottom:calc(64px + env(safe-area-inset-bottom))}',
    'body.mobile-device input,body.mobile-device select,body.mobile-device textarea{font-size:16px!important;-webkit-appearance:none;appearance:none;box-sizing:border-box}',
    '@media(max-width:900px){body.mobile-device #empty-home{overflow-y:auto;overflow-x:hidden;touch-action:pan-y;-webkit-overflow-scrolling:touch}body.mobile-device .empty-home-shell{height:auto;grid-template-columns:1fr;overflow:visible}body.mobile-device .home-hero{grid-row:auto}body.mobile-device #empty-home .home-feature-strip{grid-template-columns:1fr}body.mobile-device #empty-home .home-hero{min-height:240px}body.mobile-device #empty-home .home-grid{gap:8px}}',
    '@media(max-height:650px){body.mobile-device #empty-home{top:110px;bottom:70px}}'
  ].join('\n');
  document.head.appendChild(style);

  // Phone-only layout. Keep the existing iPad shell and the single native
  // player untouched; these rules only arrange the existing web controls.
  var phoneStyle = document.createElement('style');
  phoneStyle.textContent = `
    body.phone-device #mineradio-network-button,
    body.phone-device #mineradio-network-panel,
    body.phone-landscape #mineradio-network-button,
    body.phone-landscape #mineradio-network-panel {display:none!important;}
    body.phone-landscape #phone-header,
    body.phone-landscape #phone-nav,
    body.phone-landscape #phone-home,
    body.phone-landscape #phone-player-close {display:none!important;}
    body.phone-device #app-primary-nav,
    body.phone-device #app-nav-edge-handle,
    body.phone-device #top-right,
    body.phone-device #bottom-handle,
    body.phone-device #fx-fab,
    body.phone-device #fx-fab-hide-btn { display:none!important; }
    body.phone-device #phone-header {
      position:fixed;z-index:24;top:calc(env(safe-area-inset-top) + 8px);
      left:18px;right:74px;height:48px;display:flex;align-items:center;
      color:#fff;font:800 22px/1.1 system-ui,sans-serif;letter-spacing:-.045em;
      pointer-events:none;text-shadow:0 2px 18px rgba(0,0,0,.6);
    }
    body.phone-device #lx-source-top-right {
      position:fixed!important;z-index:25!important;top:calc(env(safe-area-inset-top) + 9px)!important;
      right:16px!important;left:auto!important;transform:none!important;
    }
    body.phone-device #lx-source-top-btn {width:46px!important;min-width:46px!important;height:46px!important;padding:0!important;justify-content:center!important;}
    body.phone-device #lx-source-top-label,body.phone-device #lx-source-top-count {display:none!important;}
    body.phone-device #phone-nav {
      position:fixed;z-index:40;left:0;right:0;bottom:0;height:calc(65px + env(safe-area-inset-bottom));
      box-sizing:border-box;padding:5px 10px calc(5px + env(safe-area-inset-bottom));
      display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;
      background:rgba(7,11,17,.83);border-top:1px solid rgba(255,255,255,.12);
      -webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);
    }
    body.phone-device #phone-nav button {
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
      min-width:0;min-height:48px;border:0;border-radius:13px;background:none;
      color:rgba(255,255,255,.66);font:650 11px/1.1 system-ui,sans-serif;
    }
    body.phone-device #phone-nav button.active {color:#dffffa;background:rgba(0,245,212,.11);}
    body.phone-device #phone-nav svg {width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;}
    body.phone-device #empty-home {display:none!important;}
    body.phone-device #phone-home {
      position:fixed;z-index:8;left:12px;right:12px;
      top:calc(env(safe-area-inset-top) + 68px);
      bottom:calc(146px + env(safe-area-inset-bottom));
      overflow-y:auto;overflow-x:hidden;touch-action:pan-y;-webkit-overflow-scrolling:touch;
      color:#fff;scrollbar-width:none;
    }
    body.phone-device #phone-home::-webkit-scrollbar {display:none;}
    body.phone-device #phone-home .phone-hero {
      position:relative;overflow:hidden;min-height:174px;box-sizing:border-box;padding:23px 21px;
      border:1px solid rgba(255,255,255,.15);border-radius:25px;
      background:linear-gradient(130deg,rgba(20,55,67,.84),rgba(12,19,36,.92));
    }
    body.phone-device #phone-home .phone-hero::after {
      content:'';position:absolute;right:-25px;top:-45px;width:190px;height:190px;border-radius:50%;
      background:radial-gradient(circle,rgba(0,245,212,.22),transparent 67%);pointer-events:none;
    }
    body.phone-device #phone-home .phone-kicker {display:block;color:#9cf7e8;font:760 10px/1.2 system-ui,sans-serif;letter-spacing:.22em;}
    body.phone-device #phone-home h1 {margin:12px 0 8px;font:780 clamp(27px,8vw,34px)/1.12 system-ui,sans-serif;letter-spacing:-.06em;}
    body.phone-device #phone-home p {margin:0;color:rgba(255,255,255,.69);font:500 13px/1.5 system-ui,sans-serif;}
    body.phone-device #phone-home .phone-hero button {
      position:relative;z-index:1;margin-top:17px;min-height:43px;padding:0 18px;
      border:1px solid rgba(156,247,232,.35);border-radius:999px;
      background:rgba(0,245,212,.13);color:#eafffb;font:750 13px system-ui,sans-serif;
    }
    body.phone-device #phone-home .phone-home-label {margin:22px 4px 11px;color:rgba(255,255,255,.68);font:700 13px system-ui,sans-serif;}
    body.phone-device #phone-home .phone-home-grid {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
    body.phone-device #phone-home .phone-home-grid button {
      min-width:0;min-height:96px;text-align:left;padding:15px 14px;
      border:1px solid rgba(255,255,255,.12);border-radius:20px;
      background:rgba(9,16,24,.86);color:#fff;font:750 16px system-ui,sans-serif;
    }
    body.phone-device #phone-home .phone-home-grid button span {display:block;margin-top:8px;color:rgba(255,255,255,.55);font:500 11px/1.4 system-ui,sans-serif;}
    body.phone-device.phone-search-open #phone-home,
    body.phone-device.secondary-view-active #phone-home,
    body.phone-device.phone-player-open #phone-home {display:none!important;}
    body.phone-device #app-secondary-view {
      left:10px!important;right:10px!important;top:calc(env(safe-area-inset-top) + 64px)!important;
      bottom:calc(78px + env(safe-area-inset-bottom))!important;width:auto!important;
      height:auto!important;transform:none!important;
    }
    body.phone-device .secondary-shell {
      border-radius:20px;background:#0b1018;
      backdrop-filter:none;-webkit-backdrop-filter:none;
    }
    body.phone-device.secondary-view-active #lyric-viz-stage-host,
    body.phone-device.secondary-view-active #hand-canvas {display:none!important;}
    body.phone-device:not(.phone-player-open) #lyric-viz-stage-host {display:none!important;}
    body.phone-device.phone-player-open #lyric-viz-stage-host.active {
      top:46%!important;bottom:25%!important;left:0!important;right:0!important;
      width:100%!important;height:auto!important;overflow:hidden!important;
    }
    body.phone-device.phone-player-open #lyric-viz-stage-host.active .mineradio-lyric-viz-root {
      position:relative!important;left:-26.9%!important;top:0!important;
      width:153.8%!important;height:153.8%!important;min-height:0!important;
      transform-origin:top center!important;scale:.65!important;
    }
    body.phone-device.secondary-view-active #canvas-container,
    body.phone-device.phone-search-open #canvas-container {visibility:hidden!important;}
    body.phone-device .secondary-head {padding:13px 15px 10px;gap:7px;}
    body.phone-device .secondary-title {font-size:22px;}
    body.phone-device .secondary-subtitle {display:none;}
    body.phone-device .secondary-toolbar {padding:10px 12px 0;gap:7px;}
    body.phone-device .secondary-action {min-height:42px;}
    body.phone-device .secondary-content {padding:12px;}
    body.phone-device #secondary-library-page .library-layout {display:flex;flex-direction:column;min-height:0;overflow-y:auto;}
    body.phone-device #secondary-library-page .library-collection-grid {grid-template-columns:repeat(2,minmax(0,1fr));flex:0 0 auto;}
    body.phone-device #secondary-library-page .library-detail {min-height:280px;flex:1 0 auto;}
    body.phone-device #now-flow {
      left:12px!important;right:12px!important;bottom:calc(74px + env(safe-area-inset-bottom))!important;
      width:auto!important;height:62px!important;padding:6px 10px!important;
      transform:translateY(10px)!important;box-sizing:border-box;
    }
    body.phone-device #now-flow.visible {transform:none!important;opacity:1!important;pointer-events:auto!important;}
    body.phone-device #now-flow .now-flow-cover {width:46px;height:46px;flex-basis:46px;}
    body.phone-device #now-flow .now-flow-main {min-width:0;padding:0;}
    body.phone-device #now-flow .now-flow-artist {display:block;max-width:35%;}
    body.phone-device #now-flow .now-flow-lyric-box,
    body.phone-device #now-flow-progress,
    body.phone-device #now-flow .now-flow-actions>*:not(#nf-play-btn),
    body.phone-device #now-flow .now-flow-bars {display:none!important;}
    body.phone-device #now-flow #nf-play-btn {display:grid!important;min-width:44px;min-height:44px;}
    body.phone-device #bottom-bar {display:none!important;}
    body.phone-device.phone-player-open #bottom-bar {
      display:flex!important;position:fixed!important;z-index:1200!important;
      inset:0!important;width:100vw!important;height:100dvh!important;max-height:none!important;
      margin:0!important;box-sizing:border-box;padding:calc(env(safe-area-inset-top) + 65px) 16px calc(env(safe-area-inset-bottom) + 22px)!important;
      transform:none!important;opacity:1!important;pointer-events:auto!important;
      background:linear-gradient(180deg,rgba(5,8,13,.64),rgba(5,8,13,.12) 32%,rgba(5,8,13,.55) 70%,rgba(5,8,13,.90))!important;
      backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none!important;border-radius:0!important;
    }
    body.phone-device.phone-player-open.now-flow-only #bottom-bar,
    body.phone-device.phone-player-open.now-flow-only #bottom-bar.visible,
    body.phone-device.phone-player-open.now-flow-only #bottom-bar.soft-hidden {
      opacity:1!important;pointer-events:auto!important;transform:none!important;
    }
    body.phone-device.phone-player-open #controls,
    body.phone-device.phone-player-open.diy-mode #controls {
      display:flex!important;flex-direction:column!important;justify-content:flex-end!important;
      align-items:center!important;gap:6px!important;width:100%;height:100%;padding:0!important;
    }
    body.phone-device.phone-player-open .control-track {
      position:absolute!important;top:calc(env(safe-area-inset-top) + 65px)!important;
      left:20px!important;right:20px!important;display:flex!important;
      flex-direction:column!important;align-items:center!important;gap:16px!important;
    }
    body.phone-device.phone-player-open #control-cover {
      display:block!important;visibility:visible!important;opacity:1!important;
      width:min(66vw,34dvh,320px)!important;height:auto!important;aspect-ratio:1!important;
      border-radius:25px!important;flex:none!important;
    }
    body.phone-device.phone-player-open .control-meta {
      display:flex!important;max-width:100%!important;width:100%;align-items:center;text-align:center;
    }
    body.phone-device.phone-player-open .control-kicker {font-size:11px;}
    body.phone-device.phone-player-open .control-title {font-size:clamp(19px,5.4vw,27px);max-width:100%;}
    body.phone-device.phone-player-open .control-artist {font-size:14px;max-width:100%;}
    body.phone-device.phone-player-open .control-lyric-box {display:none!important;}
    body.phone-device.phone-player-open #progress-bar {
      display:flex!important;position:absolute!important;left:23px!important;right:23px!important;
      top:auto!important;bottom:calc(184px + env(safe-area-inset-bottom))!important;
      width:auto!important;height:32px!important;z-index:3!important;touch-action:none!important;
    }
    body.phone-device.phone-player-open .control-cluster.transport {order:1!important;flex:0 0 65px;width:100%!important;justify-content:space-evenly!important;}
    body.phone-device.phone-player-open .control-cluster.actions {order:2!important;flex:0 0 46px;width:100%!important;justify-content:center!important;}
    body.phone-device.phone-player-open .control-cluster.modes {order:3!important;flex:0 0 47px;width:100%!important;justify-content:flex-start!important;overflow-x:auto!important;}
    body.phone-device.phone-player-open .control-cluster.actions .control-track {display:flex!important;}
    body.phone-device.phone-player-open #now-flow,
    body.phone-device.phone-player-open #phone-nav,
    body.phone-device.phone-player-open #phone-header,
    body.phone-device.phone-player-open #lx-source-top-right {display:none!important;}
    body.phone-device #phone-player-close {
      display:none;position:fixed;z-index:1300;top:calc(env(safe-area-inset-top) + 12px);left:16px;
      width:48px;height:48px;border:1px solid rgba(255,255,255,.2);border-radius:50%;
      background:rgba(8,12,18,.54);color:#fff;font:700 28px/1 system-ui,sans-serif;
    }
    body.phone-device.phone-player-open #phone-player-close {display:grid;place-items:center;}
    body.phone-device #mobile-diy-btn {display:none!important;}
    body.phone-device.phone-player-open #mobile-diy-btn {display:flex!important;z-index:1300;top:calc(env(safe-area-inset-top) + 16px);}
    body.phone-device.phone-search-open #search-area {
      z-index:26!important;display:flex!important;flex-direction:column!important;
      left:12px!important;right:12px!important;top:calc(env(safe-area-inset-top) + 64px)!important;
      bottom:calc(78px + env(safe-area-inset-bottom))!important;width:auto!important;
      height:auto!important;opacity:1!important;visibility:visible!important;pointer-events:auto!important;
      transform:none!important;box-sizing:border-box;padding:12px!important;
      border:1px solid rgba(255,255,255,.12);border-radius:20px;background:#0b1018;
    }
    body.phone-device.phone-search-open #search-stack {
      box-sizing:border-box;padding:0;border:0;background:none;
    }
    body.phone-device.phone-search-open #search-stack {width:100%!important;max-width:none!important;min-height:0;}
    body.phone-device.phone-search-open #search-results {max-height:calc(100dvh - 255px - env(safe-area-inset-top) - env(safe-area-inset-bottom))!important;overflow-y:auto;}
    body.phone-device.phone-search-open #empty-home {opacity:0!important;visibility:hidden!important;pointer-events:none!important;}
    body.phone-device:not(.phone-search-open) #search-area {opacity:0!important;visibility:hidden!important;pointer-events:none!important;}
    body.phone-device #playlist-panel,body.phone-device #fx-panel {
      top:calc(env(safe-area-inset-top) + 64px)!important;
      bottom:calc(76px + env(safe-area-inset-bottom))!important;
    }
    body.phone-device.phone-player-open #fx-panel.show {z-index:1400!important;bottom:calc(24px + env(safe-area-inset-bottom))!important;}
    body.phone-device.phone-player-open #playlist-panel.show,
    body.phone-device.phone-player-open #playlist-panel.peek {z-index:1400!important;}
    body.phone-device.phone-player-open #mobile-back-btn {z-index:1500;}
    body.phone-device #nf-mode-menu [data-mode="heart"],
    body.phone-landscape #nf-mode-menu [data-mode="heart"] {display:none!important;}
  `;
  document.head.appendChild(phoneStyle);

  function bindGestures(canvas) {
    if (!canvas || canvas.__ipadGestures) return;
    canvas.__ipadGestures = true;
    var start = null, previous = null, pinch = 0, dragged = false, shelf = false;
    var pendingMove = null, moveFrame = 0;
    function dispatchMouse(type, point) {
      canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: point.clientX, clientY: point.clientY, button: 0, buttons: type === 'mouseup' ? 0 : 1 }));
    }
    function flushMove() {
      moveFrame = 0;
      if (pendingMove) { var point = pendingMove; pendingMove = null; dispatchMouse('mousemove', point); }
    }
    function mouse(type, point) {
      if (type === 'mousemove') {
        pendingMove = { clientX: point.clientX, clientY: point.clientY };
        if (!moveFrame) moveFrame = requestAnimationFrame(flushMove);
        return;
      }
      if (moveFrame) { cancelAnimationFrame(moveFrame); flushMove(); }
      dispatchMouse(type, point);
    }
    function distance(touches) { return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY); }
    canvas.addEventListener('touchstart', function (event) {
      event.preventDefault();
      if (event.touches.length === 2) { pinch = distance(event.touches); dragged = true; mouse('mouseup', event.touches[0]); return; }
      start = previous = { clientX: event.touches[0].clientX, clientY: event.touches[0].clientY };
      dragged = false; shelf = false;
      try {
        if (window.shelfManager && window.raycasterFromPointerEvent) {
          var ray = window.raycasterFromPointerEvent(start);
          var content = window.shelfManager.getContentList();
          shelf = !!(window.pointerCardHit(ray, start) || content && content.screenContainsPanel && content.screenContainsPanel(start.clientX, start.clientY));
        }
      } catch (_error) {}
      if (!shelf) mouse('mousedown', start);
    }, { passive: false });
    canvas.addEventListener('touchmove', function (event) {
      event.preventDefault();
      if (!start) return;
      var point = event.touches[0];
      if (event.touches.length >= 2) {
        var next = distance(event.touches);
        if (pinch > 0) canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: innerWidth / 2, clientY: innerHeight / 2, deltaY: Math.log(pinch / Math.max(1, next)) * 400 }));
        pinch = next; dragged = true; return;
      }
      if (Math.hypot(point.clientX - start.clientX, point.clientY - start.clientY) > 8) dragged = true;
      if (shelf) {
        if (Math.abs(point.clientY - previous.clientY) > 12) {
          canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: start.clientX, clientY: start.clientY, deltaY: previous.clientY - point.clientY, shiftKey: true }));
          previous = { clientX: point.clientX, clientY: point.clientY };
        }
      } else mouse('mousemove', point);
    }, { passive: false });
    function finish(event) {
      event.preventDefault();
      if (!start) return;
      var point = event.changedTouches[0] || start;
      mouse('mouseup', point);
      if (!dragged && event.type !== 'touchcancel') mouse('click', point);
      if (!event.touches.length) { start = previous = null; pinch = 0; }
      else { start = previous = { clientX: event.touches[0].clientX, clientY: event.touches[0].clientY }; pinch = 0; }
    }
    canvas.addEventListener('touchend', finish, { passive: false });
    canvas.addEventListener('touchcancel', finish, { passive: false });
  }
  function arrangeMobileHomeColumns() {
    var shell = document.querySelector('#empty-home .empty-home-shell');
    if (!shell) return;
    var existing = shell.querySelector(':scope > .mobile-home-right-scroll');
    if (window.innerWidth <= 900) {
      if (existing) {
        while (existing.firstChild) shell.appendChild(existing.firstChild);
        existing.remove();
      }
      return;
    }
    if (existing) return;
    var hero = shell.querySelector(':scope > .home-hero');
    var right = document.createElement('div');
    right.className = 'mobile-home-right-scroll';
    Array.prototype.slice.call(shell.children).forEach(function (child) {
      if (child !== hero && child !== right) right.appendChild(child);
    });
    shell.appendChild(right);
  }

  function mountPhoneLayout() {
    if (!/iPhone|iPod/i.test(navigator.userAgent || '') || !document.body) return;
    var body = document.body;
    function syncPhoneOrientation() {
      var portrait = window.innerHeight >= window.innerWidth;
      body.classList.toggle('phone-device', portrait);
      body.classList.toggle('phone-landscape', !portrait);
    }
    syncPhoneOrientation();
    window.addEventListener('resize', syncPhoneOrientation, { passive:true });
    // A diagnostic overlay should not cover the phone header on first launch;
    // an explicit user preference still wins, and DIY can show it again.
    if (localStorage.getItem('mineradio-render-fps-hud-v1') == null &&
        typeof window.toggleRenderFpsHud === 'function') window.toggleRenderFpsHud(false);
    var header = document.createElement('div');
    header.id = 'phone-header';
    header.textContent = 'Mineradio';
    body.appendChild(header);
    var home = document.createElement('main');
    home.id = 'phone-home';
    home.setAttribute('aria-label', 'Mineradio 手机首页');
    home.innerHTML = [
      '<section class="phone-hero"><span class="phone-kicker">YOUR VISUAL RADIO</span>',
      '<h1>让音乐成为画面</h1><p>同一首歌，同一份视觉氛围。横过手机，进入沉浸播放。</p>',
      '<button type="button" data-phone-view="player">进入播放器 →</button></section>',
      '<div class="phone-home-label">为你推荐</div><div class="phone-home-grid">',
      '<button type="button" data-phone-action="radio">音乐电台<span>按心情和场景选歌</span></button>',
      '<button type="button" data-phone-action="daily">每日推荐<span>看看今天的新歌</span></button>',
      '<button type="button" data-phone-action="square">歌单广场<span>发现公开歌单</span></button>',
      '<button type="button" data-phone-action="ranking">热门榜单<span>浏览平台排行榜</span></button></div>'
    ].join('');
    body.appendChild(home);
    var nav = document.createElement('nav');
    nav.id = 'phone-nav';
    nav.setAttribute('aria-label', '手机底部导航');
    nav.innerHTML = [
      '<button type="button" data-phone-view="home" aria-label="首页"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10 12 3l9 7v11H3z"/><path d="M9 21v-7h6v7"/></svg><span>首页</span></button>',
      '<button type="button" data-phone-view="search" aria-label="搜索歌曲和歌单"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="7"/><path d="m16 16 5 5"/></svg><span>搜索</span></button>',
      '<button type="button" data-phone-view="library" aria-label="音乐库和歌单"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v16M9 4v16M14 5h6v14h-6z"/></svg><span>音乐库</span></button>',
      '<button type="button" data-phone-view="player" aria-label="打开播放器"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 3v3"/></svg><span>播放</span></button>'
    ].join('');
    body.appendChild(nav);
    var close = document.createElement('button');
    close.id = 'phone-player-close';
    close.type = 'button';
    close.setAttribute('aria-label', '返回手机页面');
    close.textContent = '⌄';
    body.appendChild(close);
    var currentView = 'home';
    function show(view) {
      if (!/^(home|search|library|player)$/.test(view)) return;
      currentView = view;
      body.classList.toggle('phone-player-open', view === 'player');
      body.classList.toggle('phone-search-open', view === 'search');
      ['playlist-panel', 'fx-panel'].forEach(function (id) {
        var panel = document.getElementById(id);
        if (panel) panel.classList.remove('show', 'peek');
      });
      Array.prototype.forEach.call(nav.querySelectorAll('[data-phone-view]'), function (button) {
        var active = button.getAttribute('data-phone-view') === view;
        button.classList.toggle('active', active);
        button.setAttribute('aria-current', active ? 'page' : 'false');
      });
      if (view === 'player') return;
      if (view === 'library') {
        if (typeof window.openPrimaryView === 'function') window.openPrimaryView('library');
        return;
      }
      if (body.classList.contains('secondary-view-active') ||
          (view === 'home' && !body.classList.contains('empty-home-active'))) {
        if (typeof window.openPrimaryView === 'function') window.openPrimaryView('home');
      }
      var search = document.getElementById('search-area');
      if (search) search.classList.toggle('peek', view === 'search');
      if (view === 'search') {
        var input = document.getElementById('search-input');
        if (input) input.focus();
      }
    }
    nav.addEventListener('click', function (event) {
      var button = event.target.closest('[data-phone-view]');
      if (button) show(button.getAttribute('data-phone-view'));
    });
    home.addEventListener('click', function (event) {
      var button = event.target.closest('button');
      if (!button) return;
      var view = button.getAttribute('data-phone-view');
      if (view) { show(view); return; }
      var action = button.getAttribute('data-phone-action');
      if (action === 'radio' && typeof window.openRadioModes === 'function') window.openRadioModes('all');
      if (action === 'daily' && typeof window.playHomeDailyRecommend === 'function') window.playHomeDailyRecommend();
      if (action === 'square' && typeof window.openPlaylistSquare === 'function') { show('library'); window.openPlaylistSquare(); }
      if (action === 'ranking' && typeof window.openPlatformRanking === 'function') { show('library'); window.openPlatformRanking('all'); }
    });
    close.addEventListener('click', function () { show('home'); });
    var miniCover = document.getElementById('now-flow-cover');
    var fullCover = document.getElementById('control-cover');
    function syncPhonePlayerCover() {
      if (!miniCover || !fullCover || miniCover.classList.contains('cover-empty')) return;
      var image = miniCover.style.backgroundImage;
      if (!image || image === 'none') return;
      fullCover.style.backgroundImage = image;
      fullCover.classList.remove('cover-empty');
      if (typeof window.updateWallpaperCoverToggleUi === 'function') window.updateWallpaperCoverToggleUi();
    }
    if (miniCover && fullCover) {
      new MutationObserver(syncPhonePlayerCover).observe(miniCover, { attributes:true, attributeFilter:['style','class'] });
      syncPhonePlayerCover();
    }
    var flow = document.getElementById('now-flow');
    if (flow) {
      // The existing cover click toggles a desktop visual. On phones it opens
      // the full player instead, while the mini play button remains unchanged.
      flow.addEventListener('click', function (event) {
        if (!event.target.closest('#now-flow-cover,.now-flow-main')) return;
        event.preventDefault();
        event.stopPropagation();
        show('player');
      }, true);
      var main = flow.querySelector('.now-flow-main');
      if (main) {
        main.setAttribute('role', 'button');
        main.setAttribute('tabindex', '0');
        main.setAttribute('aria-label', '打开完整播放器');
        main.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); show('player'); }
        });
      }
    }
    show('home');
  }

  document.addEventListener('DOMContentLoaded', function () {
    arrangeMobileHomeColumns();
    mountPhoneLayout();
    window.addEventListener('resize', function () { arrangeMobileHomeColumns(); }, { passive: true });
    var hud = document.getElementById('render-fps-hud');
    if (hud) {
      hud.title = '点击隐藏帧率，可在 DIY 面板重新显示'; hud.setAttribute('role', 'button'); hud.tabIndex = 0;
      hud.addEventListener('click', function (event) { event.stopPropagation(); window.toggleRenderFpsHud(false); });
    }
    var panel = document.getElementById('fx-panel');
    if (panel) {
      var button = document.createElement('button'); button.className = 'fx-mini-btn'; button.type = 'button'; button.textContent = '显示 / 隐藏帧率';
      button.onclick = function () { window.toggleRenderFpsHud(); }; panel.prepend(button);
    }
    // Touch has no hover: use the existing transparent mode by default once.
    if ((!document.body || (!document.body.classList.contains('phone-device') && !document.body.classList.contains('phone-landscape'))) &&
        !localStorage.getItem('mineradio-ipad-glass-v4')) {
      window.toggleHomeTransparencyMode(true); localStorage.setItem('mineradio-ipad-glass-v4', '1');
    }
    bindGestures(window.renderer && window.renderer.domElement);
    if (window.audio) mobile.bindAudio(window.audio);
    window.addEventListener('focus', function () { mobile.resumeForegroundAudio(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && boundAudio && boundAudio.__mrExplicitPause) wasPlayingWhenHidden = false;
      else if (document.hidden && boundAudio && boundAudio.src && !boundAudio.paused && !boundAudio.ended) wasPlayingWhenHidden = true;
      else mobile.resumeForegroundAudio();
    });
    var resizeTimer;
    if (window.visualViewport) window.visualViewport.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (typeof window.scheduleMainRendererViewportRefresh === 'function') window.scheduleMainRendererViewportRefresh('ipad-viewport');
      }, 100);
    });
  });
})();
