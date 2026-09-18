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
  var boundAudio = null, handedOff = false, nativeUrl = '', blobSource = '', lastSync = 0, lastQueueKey = '', lastQueue = null;
  mobile.activateAudio = function () {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_error) {}
    return native('activateAudio').catch(function (error) { console.warn('[iOS audio session]', error.message); });
  };
  function showAudioError(message) {
    if (mobile.diagnostics) mobile.diagnostics.audio = message;
    if (typeof window.showToast === 'function') window.showToast(message);
  }
  function snapshot() {
    if (!boundAudio || handedOff) return Promise.resolve();
    var media = boundAudio;
    var src = media.currentSrc || media.src;
    if (!src) return Promise.resolve();
    var meta = typeof window.currentDesktopSongMeta === 'function' ? window.currentDesktopSongMeta() : {};
    var data = { url: src.indexOf('blob:') === 0 ? nativeUrl : src,
      position: Number(media.currentTime) || 0, duration: Number(media.duration) || 0,
      playing: !media.paused && !media.ended, rate: media.playbackRate || 1,
      volume: typeof window.targetVolume === 'number' ? window.targetVolume : media.volume,
      loop: media.loop, title: meta.title || 'Mineradio', artist: meta.artist || '', cover: meta.cover || '',
      queueIndex: typeof window.currentIdx === 'number' ? window.currentIdx : -1 };
    var queue = window.playQueue || [];
    var queueKey = queue.length + '|' + data.queueIndex;
    if (queue !== lastQueue || queueKey !== lastQueueKey) {
      lastQueueKey = queueKey; lastQueue = queue;
      data.queue = queue.map(function (song) {
        return { title: song.name || song.title || '', artist: song.singer || song.artist || '',
          source: song.source || song.provider || '', cover: song.picUrl || song.cover || '',
          musicInfo: typeof window.lxSongPlayPayload === 'function' ? window.lxSongPlayPayload(song) : song };
      });
    }
    data.playMode = window.playMode || 'list';
    return native('syncAudio', data).catch(function (error) { showAudioError('后台音频准备失败：' + error.message); });
  }
  mobile.bindAudio = function (media) {
    boundAudio = media;
    if (media.__ipadBound) return;
    media.__ipadBound = true;
    media.setAttribute('playsinline', '');
    function sync() {
      if (handedOff) return;
      var src = media.currentSrc || media.src;
      if (src.indexOf('blob:') === 0 && src !== blobSource) {
        blobSource = src; nativeUrl = '';
        fetch(src).then(function (response) { return response.blob(); }).then(function (body) {
          return fetch('/api/mobile/audio-cache', { method: 'POST', headers: { 'Content-Type': body.type || 'application/octet-stream' }, body: body });
        }).then(function (response) { return response.json(); }).then(function (result) {
          if (!result.ok) throw new Error(result.error || 'LOCAL_AUDIO_CACHE_FAILED');
          if (src === blobSource) { nativeUrl = mobile.getServerUrl() + result.url; snapshot(); }
        }).catch(function () { showAudioError('本地文件的后台播放缓存未准备好，请稍后重试'); });
      }
      lastSync = Date.now(); snapshot();
    }
    ['playing', 'pause', 'seeked', 'loadedmetadata', 'ratechange', 'volumechange', 'ended'].forEach(function (event) { media.addEventListener(event, sync); });
    media.addEventListener('timeupdate', function () { if (Date.now() - lastSync > 750) sync(); });
  };
  // Called by the native lifecycle *before* WebKit can suspend its audio graph.
  mobile.enterBackgroundAudio = function () {
    if (!boundAudio || handedOff || boundAudio.paused) return;
    snapshot();
    handedOff = true;
    boundAudio.pause();
  };
  var resuming = false;
  mobile.resumeForegroundAudio = async function () {
    if (!boundAudio || resuming) return;
    resuming = true;
    try {
      var state = await native('resumeWebAudio');
      if (!state.owned) return;
      handedOff = false;
      if (!boundAudio) return;
      if (state.queueIndex >= 0 && state.queueIndex !== window.currentIdx && typeof window.playQueueAt === 'function') {
        await window.playQueueAt(state.queueIndex);
      }
      if (Number.isFinite(state.position)) boundAudio.currentTime = state.position;
      if (state.playing) {
        await mobile.activateAudio();
        if (typeof window.resumeAudioAnalysis === 'function') await window.resumeAudioAnalysis();
        await boundAudio.play();
      } else boundAudio.pause();
      snapshot();
    } catch (error) { handedOff = false; showAudioError('返回前台后请点击播放：' + error.message); }
    finally { resuming = false; }
  };

  var style = document.createElement('style');
  style.textContent = [
    'html,body.mobile-device{width:100%;height:100%;height:100dvh;margin:0!important;padding:0!important;background:#050608!important;overflow:hidden;color-scheme:dark}',
    'body.mobile-device{border-radius:0!important;clip-path:none!important;-webkit-text-size-adjust:100%}',
    'body.mobile-device #desktop-window-shell{border-radius:0!important;clip-path:none!important}',
    'body.mobile-device #canvas-container{inset:0!important}body.mobile-device #canvas-container canvas{touch-action:none}',
    'body.mobile-device #render-fps-hud{pointer-events:auto;cursor:pointer;top:calc(12px + env(safe-area-inset-top));right:calc(12px + env(safe-area-inset-right))}',
    'body.mobile-device #empty-home{top:130px;bottom:calc(86px + env(safe-area-inset-bottom));width:calc(100% - 32px);max-width:1240px;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;touch-action:pan-y}',
    'body.mobile-device .empty-home-shell{min-height:0;height:auto;grid-template-columns:minmax(220px,.85fr) minmax(0,1.4fr)}',
    'body.mobile-device.home-always-transparent #empty-home .home-card,body.mobile-device.home-always-transparent #empty-home .home-hero,body.mobile-device.home-always-transparent #empty-home .home-insight-card,body.mobile-device.home-always-transparent #empty-home .home-discovery-strip,body.mobile-device.home-always-transparent #empty-home .home-feature-card{background:rgba(4,8,12,.10)!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:inset 0 0 0 1px #ffffff18!important}',
    'body.mobile-device.home-always-transparent #empty-home .home-card::before,body.mobile-device.home-always-transparent #empty-home .home-card::after,body.mobile-device.home-always-transparent #empty-home .home-hero::before,body.mobile-device.home-always-transparent #empty-home .home-insight-card::before,body.mobile-device.home-always-transparent #empty-home .home-discovery-strip::before{display:none!important}',
    'body.mobile-device #fx-panel,body.mobile-device #playlist-panel{max-height:calc(100dvh - 100px - env(safe-area-inset-top) - env(safe-area-inset-bottom));touch-action:pan-y;-webkit-overflow-scrolling:touch}',
    'body.mobile-device #fx-panel.show{right:12px!important;bottom:calc(64px + env(safe-area-inset-bottom))}',
    'body.mobile-device input,body.mobile-device select,body.mobile-device textarea{font-size:16px!important;-webkit-appearance:none;appearance:none;box-sizing:border-box}',
    '@media(max-width:900px){body.mobile-device .empty-home-shell{grid-template-columns:1fr}body.mobile-device .home-hero{grid-row:auto}body.mobile-device #empty-home .home-feature-strip{grid-template-columns:1fr}body.mobile-device #empty-home .home-hero{min-height:240px}body.mobile-device #empty-home .home-grid{gap:8px}}',
    '@media(max-height:650px){body.mobile-device #empty-home{top:110px;bottom:70px}}'
  ].join('\n');
  document.head.appendChild(style);

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
  document.addEventListener('DOMContentLoaded', function () {
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
    if (!localStorage.getItem('mineradio-ipad-glass-v4')) {
      window.toggleHomeTransparencyMode(true); localStorage.setItem('mineradio-ipad-glass-v4', '1');
    }
    bindGestures(window.renderer && window.renderer.domElement);
    if (window.audio) mobile.bindAudio(window.audio);
    window.addEventListener('focus', function () { mobile.resumeForegroundAudio(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) mobile.resumeForegroundAudio(); });
    var resizeTimer;
    if (window.visualViewport) window.visualViewport.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (typeof window.scheduleMainRendererViewportRefresh === 'function') window.scheduleMainRendererViewportRefresh('ipad-viewport');
      }, 100);
    });
  });
})();
