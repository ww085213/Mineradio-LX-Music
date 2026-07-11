(function(global) {
  'use strict';

  var LYRIC_ANIM_MODES = ['off', 'classic', 'cadenza', 'partita', 'fume', 'cappella', 'tilt', 'monet'];
  var LYRIC_ANIM_MODE_LABELS = {
    off: '关闭',
    classic: '流光',
    cadenza: '心象',
    partita: '云阶',
    fume: '浮名',
    cappella: '群唱',
    tilt: '倾诉',
    monet: '莫奈'
  };

  var DEFAULT_TUNING = {
    classic: { enableWordRotation: true, breathingFloatMultiplier: 1, wordSpacing: 0.7 },
    cadenza: { fontScale: 1.12, widthRatio: 0.72, motionAmount: 1, glowIntensity: 1, beamIntensity: 0 },
    partita: { showGuideLines: true, useSemanticLayout: true, staggerMin: 20, staggerMax: 100 },
    fume: {
      hidePrintSymbols: false,
      disableGeometricBackground: true,
      backgroundObjectOpacity: 0.5,
      textHoldRatio: 1,
      cameraTrackingMode: 'smooth',
      cameraSpeed: 1,
      glowIntensity: 1,
      heroScale: 1
    },
    cappella: { showEmoMessages: true, emojiPackSource: 'builtin', avatarSource: 'cover' },
    tilt: { splitProbability: 0.75, tiltStyleProbability: 0.35, colorScheme: 'default' },
    monet: {
      lyricsFocusScale: 1,
      portraitScale: 1,
      portraitOffsetX: 0,
      portraitOffsetY: 0,
      audioStyle: 'bar',
      audioOpacity: 0.72
    }
  };

  var state = {
    bundleLoaded: false,
    bundleLoading: null,
    stageMounted: false,
    stageReady: false,
    host: null,
    lastFailToastAt: 0
  };

  function safeClamp(v, min, max) {
    var n = Number(v);
    if (!isFinite(n)) n = min;
    return Math.max(min, Math.min(max, n));
  }

  function clampRangeLocal(v, min, max) {
    if (typeof global.clampRange === 'function') return global.clampRange(v, min, max);
    return safeClamp(v, min, max);
  }

  function normalizeMode(mode) {
    var key = String(mode || 'off');
    return LYRIC_ANIM_MODES.indexOf(key) >= 0 ? key : 'off';
  }

  function getFx() {
    return global.fx || null;
  }

  function getLyricsLines() {
    return Array.isArray(global.lyricsLines) ? global.lyricsLines : [];
  }

  function hasCjkText(text) {
    return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(String(text || ''));
  }

  function isForeignLineText(text) {
    var raw = String(text || '').trim();
    if (!raw || hasCjkText(raw)) return false;
    return /[A-Za-zÀ-ÖØ-öø-ÿА-Яа-яЁё]/.test(raw);
  }

  function cloneLyricLineForAnimation(line, fxRef) {
    var copy = Object.assign({}, line || {});
    if (line && Array.isArray(line.words)) {
      copy.words = line.words.map(function(w) { return Object.assign({}, w); });
    }
    if (fxRef && fxRef.lyricTranslation === false) {
      delete copy.translation;
      delete copy.translationSource;
    }
    // 外语歌词带逐词时间轴时，部分动画会把每个词拆开飘散。
    // 这里把外语行降级成整行动画，中文/日文/韩文仍保留原来的逐字/逐词效果。
    if (isForeignLineText(copy.text) && Array.isArray(copy.words)) {
      delete copy.words;
    }
    return copy;
  }

  function getLyricsLinesForAnimation(fxRef) {
    return getLyricsLines().map(function(line) {
      return cloneLyricLineForAnimation(line, fxRef || getFx());
    }).filter(function(line) {
      return line && (String(line.text || '').trim() || String(line.translation || '').trim());
    });
  }

  function resolveLyricVizApi() {
    var api = global.MineradioLyricViz;
    if (!api) return null;
    if (typeof api.mount === 'function') return api;
    if (api.default && typeof api.default.mount === 'function') return api.default;
    return null;
  }

  function isLyricAnimationActive(fxRef) {
    fxRef = fxRef || getFx();
    if (!fxRef) return false;
    return normalizeMode(fxRef.lyricAnimationMode) !== 'off';
  }

  function isStageAnimationActive(fxRef) {
    fxRef = fxRef || getFx();
    return !!fxRef && normalizeMode(fxRef.lyricAnimationMode) !== 'off' && !!fxRef.lyricAnimationStage;
  }

  function isStageReady() {
    return !!state.stageReady && state.stageMounted && state.bundleLoaded;
  }

  function setStageReady(ready) {
    state.stageReady = !!ready;
    document.body.classList.toggle('lyric-animation-stage-ready', state.stageReady);
  }

  function loadBundle() {
    var existing = resolveLyricVizApi();
    if (existing) {
      state.bundleLoaded = true;
      return Promise.resolve(existing);
    }
    if (state.bundleLoading) {
      return state.bundleLoading.then(function(api) {
        return api || resolveLyricVizApi();
      });
    }
    state.bundleLoading = new Promise(function(resolve, reject) {
      if (!document.querySelector('link[data-lyric-viz-css]')) {
        var css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'vendor/lyric-viz/lyric-viz-bridge.css';
        css.setAttribute('data-lyric-viz-css', '1');
        document.head.appendChild(css);
      }
      var script = document.createElement('script');
      script.src = 'vendor/lyric-viz/lyric-viz-bridge.js';
      script.async = true;
      script.onload = function() {
        var api = resolveLyricVizApi();
        state.bundleLoaded = !!api;
        if (!api) {
          state.bundleLoading = null;
          reject(new Error('lyric-viz bundle loaded but API missing'));
          return;
        }
        resolve(api);
      };
      script.onerror = function() {
        state.bundleLoading = null;
        reject(new Error('lyric-viz bundle load failed'));
      };
      document.head.appendChild(script);
    });
    return state.bundleLoading;
  }

  function getHost() {
    if (!state.host) state.host = document.getElementById('lyric-viz-stage-host');
    return state.host;
  }

  function lyricAnimationThemeFromFx(fxRef, palette) {
    palette = palette || {};
    var mode = normalizeMode(fxRef.lyricAnimationMode);
    var primary = fxRef.lyricColorMode === 'custom'
      ? (fxRef.lyricColor || palette.primary || '#f6fdff')
      : (palette.primary || fxRef.lyricColor || '#f6fdff');
    var highlight = fxRef.lyricHighlightMode === 'custom'
      ? (fxRef.lyricHighlightColor || palette.highlight || primary || '#fff0b8')
      : (palette.highlight || fxRef.lyricHighlightColor || primary || '#fff0b8');
    var glow = fxRef.lyricGlowLinked === false
      ? (fxRef.lyricGlowColor || palette.glowColor || palette.glow || highlight || '#9cffdf')
      : (palette.glowColor || palette.glow || palette.secondary || highlight || fxRef.lyricGlowColor || '#9cffdf');
    var theme = {
      primary: primary,
      secondary: palette.secondary || fxRef.visualTintColor || glow || '#9cffdf',
      highlight: highlight,
      glow: glow,
      fontFamily: typeof global.lyricFontStackForKey === 'function' ? global.lyricFontStackForKey(fxRef.lyricFont) : '',
      animationIntensity: fxRef.lyricAnimationIntensity || 'normal'
    };
    if (mode === 'fume' || mode === 'monet') {
      theme.backgroundColor = '#040608';
    }
    return theme;
  }

  function lyricAnimationTuningFromFx(fxRef) {
    var raw = fxRef.lyricAnimationTuning && typeof fxRef.lyricAnimationTuning === 'object' ? fxRef.lyricAnimationTuning : {};
    return {
      classic: Object.assign({}, DEFAULT_TUNING.classic, raw.classic || {}),
      cadenza: Object.assign({}, DEFAULT_TUNING.cadenza, raw.cadenza || {}),
      partita: Object.assign({}, DEFAULT_TUNING.partita, raw.partita || {}),
      fume: Object.assign({}, DEFAULT_TUNING.fume, raw.fume || {}),
      cappella: Object.assign({}, DEFAULT_TUNING.cappella, raw.cappella || {}),
      tilt: Object.assign({}, DEFAULT_TUNING.tilt, raw.tilt || {}),
      monet: Object.assign({}, DEFAULT_TUNING.monet, raw.monet || {})
    };
  }

  function lyricAnimationMetaFromContext(fxRef) {
    var song = typeof global.currentLyricSong === 'function' ? global.currentLyricSong() : null;
    song = song || (global.playQueue && global.currentIdx >= 0 ? global.playQueue[global.currentIdx] : null) || {};
    var meta = typeof global.currentDesktopSongMeta === 'function' ? global.currentDesktopSongMeta() : {};
    var cover = '';
    if (typeof global.songCoverSrc === 'function' && song) cover = global.songCoverSrc(song, 640) || song.cover || '';
    return {
      coverUrl: cover || meta.cover || null,
      songTitle: song.name || song.title || meta.title || null,
      songArtist: song.artist || meta.artist || null,
      songAlbum: song.album || '',
      lyricsFontScale: clampRangeLocal(Number(fxRef.lyricScale) || 1, 0.35, 1.65),
      lyricsLetterSpacing: clampRangeLocal(Number(fxRef.lyricLetterSpacing) || 0, -0.04, 0.18),
      lyricsLineHeight: clampRangeLocal(Number(fxRef.lyricLineHeight) || 1, 0.86, 1.35),
      lyricsFontWeight: clampRangeLocal(Number(fxRef.lyricWeight) || 700, 500, 900),
      visualizerOpacity: clampRangeLocal(Number(fxRef.lyricAnimationOpacity) == null ? 1 : Number(fxRef.lyricAnimationOpacity), 0.2, 1),
      staticMode: fxRef.lyricAnimationStatic === true || (typeof global.normalizePerformanceQuality === 'function' && global.normalizePerformanceQuality(fxRef.performanceQuality) === 'eco'),
      animationIntensity: fxRef.lyricAnimationIntensity || 'normal'
    };
  }

  function currentPlaybackTime() {
    var audioRef = global.audio;
    return audioRef && isFinite(audioRef.currentTime) ? Number(audioRef.currentTime) : 0;
  }

  function isHomePageVisible() {
    return !!(document.body && document.body.classList.contains('empty-home-active'));
  }

  function isStageLyricLayerAllowed(fxRef) {
    fxRef = fxRef || getFx();
    return isStageAnimationActive(fxRef) && !isHomePageVisible();
  }

  function restorePlaybackControlsAfterAnimationChange() {
    if (typeof global.forcePlaybackControlsInteractive === 'function') global.forcePlaybackControlsInteractive();
    if (typeof global.revealBottomControls === 'function') global.revealBottomControls(900);
  }

  function applyStageHostClasses(fxRef, active) {
    var host = getHost();
    var layerAllowed = !!active && !isHomePageVisible();
    if (host) {
      host.classList.toggle('active', layerAllowed);
    }
    document.body.classList.toggle('lyric-animation-stage-on', layerAllowed);
    // 歌词动画开启时固定隐藏原舞台歌词，避免两套歌词重叠。
    document.body.classList.toggle('lyric-animation-hide-particles', layerAllowed);
    if (typeof global.syncStageParticleLyricsVisibility === 'function') global.syncStageParticleLyricsVisibility();
  }

  function ensureStageMounted(api) {
    var host = getHost();
    if (!host || !api) return false;
    if (!state.stageMounted) {
      api.mount(host, { target: 'stage', transparent: true });
      state.stageMounted = true;
    }
    return true;
  }

  function pushStageVizState(api, host, fxRef) {
    var pal = global.stageLyrics && global.stageLyrics.palette ? global.stageLyrics.palette : {};
    var lines = getLyricsLinesForAnimation(fxRef);
    api.setMode(host, normalizeMode(fxRef.lyricAnimationMode));
    api.setTheme(host, lyricAnimationThemeFromFx(fxRef, pal));
    api.setTuning(host, lyricAnimationTuningFromFx(fxRef));
    api.setMeta(host, lyricAnimationMetaFromContext(fxRef));
    api.setLines(host, lines);
    api.setPaused(host, !global.playing || !global.audio || !!global.audio.paused);
    api.setVisible(host, true);
    api.setTime(host, currentPlaybackTime());
  }

  function syncStageLyricAnimation(force) {
    try {
      var fxRef = getFx();
      if (!fxRef) return Promise.resolve();
      var active = isStageLyricLayerAllowed(fxRef);
      applyStageHostClasses(fxRef, active);
      if (!active) {
        setStageReady(false);
        var inactiveApi = resolveLyricVizApi();
        var inactiveHost = getHost();
        if (state.stageMounted && inactiveApi && inactiveHost) {
          inactiveApi.setVisible(inactiveHost, false);
        }
        restorePlaybackControlsAfterAnimationChange();
        return Promise.resolve();
      }
      if (typeof global.clearStageLyrics === 'function') global.clearStageLyrics();
      return loadBundle().then(function(api) {
        if (!api || !ensureStageMounted(api)) {
          setStageReady(false);
          return;
        }
        var host = getHost();
        if (!host) {
          setStageReady(false);
          return;
        }
        try {
          pushStageVizState(api, host, fxRef);
          setStageReady(true);
          applyStageHostClasses(fxRef, true);
          if (typeof global.clearStageLyrics === 'function') global.clearStageLyrics();
        } catch (pushErr) {
          setStageReady(false);
          console.warn('lyric animation push failed:', pushErr);
          throw pushErr;
        }
      }).catch(function(err) {
        setStageReady(false);
        state.bundleLoading = null;
        state.bundleLoaded = false;
        applyStageHostClasses(fxRef, true);
        console.warn('lyric animation sync failed:', err);
        var now = Date.now();
        if (typeof global.showToast === 'function' && now - state.lastFailToastAt > 12000) {
          state.lastFailToastAt = now;
          global.showToast('歌词动画加载失败，已保留原歌词');
        }
      });
    } catch (err) {
      setStageReady(false);
      console.warn('lyric animation sync failed:', err);
      return Promise.resolve();
    }
  }

  function tickLyricAnimation() {
    if (!isStageLyricLayerAllowed() || !state.bundleLoaded || !state.stageMounted) return;
    var host = getHost();
    var api = resolveLyricVizApi();
    if (!host || !api) return;
    var t = currentPlaybackTime();
    api.setTime(host, t);
    api.setPaused(host, !global.playing || !global.audio || !!global.audio.paused);
    var bassVal = typeof global.bass !== 'undefined' ? global.bass : 0;
    var midVal = typeof global.mid !== 'undefined' ? global.mid : 0;
    var trebleVal = typeof global.treble !== 'undefined' ? global.treble : 0;
    var power = Math.max(0, Math.min(1.2, bassVal * 0.7 + midVal * 0.3));
    api.setAudio(host, {
      power: power,
      bands: { bass: bassVal, mid: midVal, treble: trebleVal }
    });
  }

  function onLyricsChangedForAnimation() {
    if (!isLyricAnimationActive()) return;
    syncStageLyricAnimation(true);
    if (typeof global.pushDesktopLyricsState === 'function') global.pushDesktopLyricsState(true);
  }

  function setLyricAnimationMode(mode) {
    var fxRef = getFx();
    if (!fxRef) return;
    fxRef.lyricAnimationMode = normalizeMode(mode);
    if (fxRef.lyricAnimationMode === 'off') {
      fxRef.lyricAnimationStage = false;
      fxRef.lyricAnimationDesktop = false;
    } else if (!fxRef.lyricAnimationStage) {
      fxRef.lyricAnimationStage = true;
    }
    fxRef.lyricAnimationDesktop = false;
    if (fxRef.lyricAnimationMode !== 'off') loadBundle().catch(function() {});
    syncStageLyricAnimation(true);
    if (typeof global.syncStageParticleLyricsVisibility === 'function') global.syncStageParticleLyricsVisibility();
    if (typeof global.saveLyricLayout === 'function') global.saveLyricLayout();
    if (typeof global.pushDesktopLyricsState === 'function') global.pushDesktopLyricsState(true);
    if (typeof global.updateLyricAnimationControls === 'function') global.updateLyricAnimationControls();
    if (typeof global.showToast === 'function') {
      global.showToast('歌词动画：' + (LYRIC_ANIM_MODE_LABELS[fxRef.lyricAnimationMode] || '关闭'));
    }
  }

  function toggleLyricAnimationTarget(key) {
    var fxRef = getFx();
    if (!fxRef) return;
    if (key === 'desktop') return;
    if (key === 'stage') fxRef.lyricAnimationStage = !fxRef.lyricAnimationStage;
    if (normalizeMode(fxRef.lyricAnimationMode) !== 'off' && !fxRef.lyricAnimationStage) {
      fxRef.lyricAnimationMode = 'off';
    }
    if (normalizeMode(fxRef.lyricAnimationMode) !== 'off' && fxRef.lyricAnimationStage) {
      loadBundle().catch(function() {});
    }
    syncStageLyricAnimation(true);
    if (typeof global.saveLyricLayout === 'function') global.saveLyricLayout();
    if (typeof global.pushDesktopLyricsState === 'function') global.pushDesktopLyricsState(true);
    if (typeof global.updateLyricAnimationControls === 'function') global.updateLyricAnimationControls();
  }

  function patchLyricAnimationTuning(mode, patch) {
    var fxRef = getFx();
    if (!fxRef) return;
    if (!fxRef.lyricAnimationTuning || typeof fxRef.lyricAnimationTuning !== 'object') fxRef.lyricAnimationTuning = {};
    if (!fxRef.lyricAnimationTuning[mode] || typeof fxRef.lyricAnimationTuning[mode] !== 'object') fxRef.lyricAnimationTuning[mode] = {};
    Object.assign(fxRef.lyricAnimationTuning[mode], patch || {});
    syncStageLyricAnimation(true);
    if (typeof global.saveLyricLayout === 'function') global.saveLyricLayout();
    if (typeof global.pushDesktopLyricsState === 'function') global.pushDesktopLyricsState(true);
  }

  function desktopLyricAnimationPayload() {
    var fxRef = getFx();
    if (!fxRef || normalizeMode(fxRef.lyricAnimationMode) === 'off' || !fxRef.lyricAnimationDesktop) {
      return { lyricAnimationEnabled: false, lyricAnimationMode: 'off' };
    }
    var pal = global.stageLyrics && global.stageLyrics.palette ? global.stageLyrics.palette : {};
    return {
      lyricAnimationEnabled: true,
      lyricAnimationMode: normalizeMode(fxRef.lyricAnimationMode),
      lyricAnimationTheme: lyricAnimationThemeFromFx(fxRef, pal),
      lyricAnimationTuning: lyricAnimationTuningFromFx(fxRef),
      lyricAnimationMeta: lyricAnimationMetaFromContext(fxRef),
      lyricAnimationLines: getLyricsLinesForAnimation(fxRef),
      lyricAnimationOpacity: clampRangeLocal(Number(fxRef.lyricAnimationOpacity) == null ? 1 : Number(fxRef.lyricAnimationOpacity), 0.2, 1),
      lyricAnimationIntensity: fxRef.lyricAnimationIntensity || 'normal',
      lyricAnimationStatic: fxRef.lyricAnimationStatic === true
    };
  }

  function normalizeLyricAnimationFx(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var tuning = raw.lyricAnimationTuning && typeof raw.lyricAnimationTuning === 'object' ? raw.lyricAnimationTuning : {};
    var mode = normalizeMode(raw.lyricAnimationMode);
    return {
      lyricAnimationMode: mode,
      lyricAnimationStage: mode !== 'off',
      lyricAnimationDesktop: false,
      lyricAnimationIntensity: /^(calm|normal|chaotic)$/.test(String(raw.lyricAnimationIntensity || '')) ? raw.lyricAnimationIntensity : 'normal',
      lyricAnimationOpacity: clampRangeLocal(raw.lyricAnimationOpacity == null ? 1 : Number(raw.lyricAnimationOpacity), 0.2, 1),
      lyricAnimationHideParticles: true,
      lyricAnimationStatic: raw.lyricAnimationStatic === true,
      lyricAnimationTuning: {
        classic: Object.assign({}, DEFAULT_TUNING.classic, tuning.classic || {}),
        cadenza: Object.assign({}, DEFAULT_TUNING.cadenza, tuning.cadenza || {}),
        partita: Object.assign({}, DEFAULT_TUNING.partita, tuning.partita || {}),
        fume: Object.assign({}, DEFAULT_TUNING.fume, tuning.fume || {}),
        cappella: Object.assign({}, DEFAULT_TUNING.cappella, tuning.cappella || {}),
        tilt: Object.assign({}, DEFAULT_TUNING.tilt, tuning.tilt || {}),
        monet: Object.assign({}, DEFAULT_TUNING.monet, tuning.monet || {})
      }
    };
  }

  function serializeLyricAnimationFx(fxRef) {
    return {
      lyricAnimationMode: normalizeMode(fxRef.lyricAnimationMode),
      lyricAnimationStage: !!fxRef.lyricAnimationStage,
      lyricAnimationDesktop: false,
      lyricAnimationIntensity: fxRef.lyricAnimationIntensity || 'normal',
      lyricAnimationOpacity: clampRangeLocal(fxRef.lyricAnimationOpacity == null ? 1 : Number(fxRef.lyricAnimationOpacity), 0.2, 1),
      lyricAnimationHideParticles: true,
      lyricAnimationStatic: fxRef.lyricAnimationStatic === true,
      lyricAnimationTuning: lyricAnimationTuningFromFx(fxRef)
    };
  }

  function refreshLyricAnimationAppearance() {
    if (!isStageReady()) return;
    var fxRef = getFx();
    var api = resolveLyricVizApi();
    var host = getHost();
    if (!fxRef || !api || !host) return;
    try {
      var pal = global.stageLyrics && global.stageLyrics.palette ? global.stageLyrics.palette : {};
      api.setTheme(host, lyricAnimationThemeFromFx(fxRef, pal));
      api.setMeta(host, lyricAnimationMetaFromContext(fxRef));
    } catch (err) {
      console.warn('lyric animation appearance refresh failed:', err);
    }
  }

  function deferSyncStage(force) {
    var run = function() { syncStageLyricAnimation(force); };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 1200 });
    } else {
      setTimeout(run, 0);
    }
  }

  global.LyricAnimation = {
    MODES: LYRIC_ANIM_MODES,
    LABELS: LYRIC_ANIM_MODE_LABELS,
    DEFAULT_TUNING: DEFAULT_TUNING,
    normalizeMode: normalizeMode,
    isActive: isLyricAnimationActive,
    isStageActive: isStageAnimationActive,
    isStageLayerAllowed: function(fxRef) { return isStageLyricLayerAllowed(fxRef || getFx()); },
    isStageReady: isStageReady,
    loadBundle: loadBundle,
    syncStage: syncStageLyricAnimation,
    deferSyncStage: deferSyncStage,
    tick: tickLyricAnimation,
    refreshAppearance: refreshLyricAnimationAppearance,
    onLyricsChanged: onLyricsChangedForAnimation,
    setMode: setLyricAnimationMode,
    toggleTarget: toggleLyricAnimationTarget,
    patchTuning: patchLyricAnimationTuning,
    desktopPayload: desktopLyricAnimationPayload,
    normalizeFx: normalizeLyricAnimationFx,
    serializeFx: serializeLyricAnimationFx
  };
})(window);
