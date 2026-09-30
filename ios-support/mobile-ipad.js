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
    // One media element owns playback in both foreground and background. iOS
    // publishes its Media Session to Control Center; no second AVPlayer is
    // started and no source/cover/playhead handoff occurs.
    // attemptAudioPlay activates the session before play(). Reconfiguring it
    // again on every playing event can disturb an already audible stream.
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
  mobile.backgroundPlaybackMode = 'system-media-session';
  mobile.enterBackgroundAudio = function () {};
  mobile.nativeBackgroundAudioDidStart = function () {};
  mobile.isNativeAudioOwned = function () { return false; };
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

  document.addEventListener('DOMContentLoaded', function () {
    arrangeMobileHomeColumns();
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
    if (!localStorage.getItem('mineradio-ipad-glass-v4')) {
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
