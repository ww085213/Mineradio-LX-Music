(function(global) {
  'use strict';

  var LYRIC_ANIM_MODES = ['off', 'classic', 'cadenza', 'partita', 'fume', 'cappella', 'tilt', 'monet', 'claddagh', 'diorama', 'lumiere', 'pendolo', 'sonnet', 'still', 'tempera'];
  var LYRIC_ANIM_BACKGROUND_MODES = ['common', 'monet', 'nomand', 'latent', 'url', 'sora', 'transparent'];
  var LYRIC_ANIM_MODE_LABELS = {
    off: '关闭',
    classic: '流光',
    cadenza: '心象',
    partita: '云阶',
    fume: '浮名',
    cappella: '群唱',
    tilt: '倾诉',
    monet: '莫奈',
    claddagh: 'Claddagh',
    diorama: '镜台',
    lumiere: '绘光',
    pendolo: 'Pendolo',
    sonnet: '商籁',
    still: 'Still',
    tempera: '凝彩'
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
      keywordColoringEnabled: true,
      showDescription: true,
      showAudioVisualization: true,
      audioStyle: 'bar',
      fontScale: 1,
      portraitSource: 'cover',
      portraitOffsetX: 0,
      portraitStyle: 'square',
      showPortraitDragHanger: false
    }
  };

  var state = {
    bundleLoaded: false,
    bundleLoading: null,
    stageMounted: false,
    stageReady: false,
    host: null,
    lastFailToastAt: 0,
    beatShakeDrive: 0
  };

  function resetBeatShake(host) {
    state.beatShakeDrive = 0;
    if (!host) return;
    var root = host.querySelector('.mineradio-lyric-viz-root');
    if (!root) return;
    root.style.translate = '';
    root.style.rotate = '';
    root.style.scale = '';
    root.style.filter = '';
    root.style.willChange = '';
  }

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

  function normalizeThemePreset(value) {
    return value === 'folia-light' || value === 'folia-custom' || value === 'mineradio' ? value : 'folia-dark';
  }

  function normalizeThemeColors(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var defaults = { backgroundColor: '#09090b', primaryColor: '#f4f4f5', accentColor: '#eeb9ef', secondaryColor: '#927c9d' };
    var colors = {};
    Object.keys(defaults).forEach(function(key) {
      colors[key] = /^#[0-9a-f]{6}$/i.test(String(raw[key] || '')) ? String(raw[key]) : defaults[key];
    });
    return colors;
  }

  function normalizeBackground(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var mode = LYRIC_ANIM_BACKGROUND_MODES.indexOf(raw.mode) >= 0 ? raw.mode : null;
    return {
      mode: mode === 'transparent' ? 'common' : mode || undefined,
      transparent: raw.transparent === true || mode === 'transparent',
      useCoverColorBg: raw.useCoverColorBg === true,
      opacity: clampRangeLocal(raw.opacity == null ? 0.75 : Number(raw.opacity), 0, 1),
      disableGeometricBackground: raw.disableGeometricBackground === true,
      disableVignette: raw.disableVignette === true,
      monetTuning: raw.monetTuning && typeof raw.monetTuning === 'object' ? raw.monetTuning : {},
      nomandTuning: raw.nomandTuning && typeof raw.nomandTuning === 'object' ? raw.nomandTuning : {},
      latentTuning: raw.latentTuning && typeof raw.latentTuning === 'object' ? raw.latentTuning : {},
      soraTuning: raw.soraTuning && typeof raw.soraTuning === 'object' ? raw.soraTuning : {},
      urlItems: Array.isArray(raw.urlItems) ? raw.urlItems.slice(0, 12).filter(function(item) { return item && typeof item.url === 'string'; }) : [],
      urlSelectedId: typeof raw.urlSelectedId === 'string' ? raw.urlSelectedId : null
    };
  }

  function selectedBackgroundMode(fxRef) {
    var raw = fxRef && fxRef.lyricAnimationBackground;
    if (raw && raw.transparent) return 'transparent';
    return raw && LYRIC_ANIM_BACKGROUND_MODES.indexOf(raw.mode) >= 0
      ? raw.mode : (fxRef && fxRef.lyricAnimationMode === 'monet' ? 'monet' : 'common');
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

  function foreignLyricRatio(lines) {
    var nonEmpty = (Array.isArray(lines) ? lines : []).filter(function(line) {
      return line && String(line.text || '').trim();
    });
    if (!nonEmpty.length) return 0;
    var foreignCount = nonEmpty.filter(function(line) {
      return isForeignLineText(line.text);
    }).length;
    return foreignCount / nonEmpty.length;
  }

  function isForeignDominantLyrics() {
    return foreignLyricRatio(getLyricsLines()) >= 0.3;
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
    // 仅旧版 Mineradio 配色保留外语整行行为；Folia 配色沿用逐词时间轴。
    if (normalizeThemePreset(fxRef && fxRef.lyricAnimationThemePreset) === 'mineradio' && isForeignLineText(copy.text)) {
      var originalWords = Array.isArray(copy.words) ? copy.words : [];
      var start = isFinite(Number(copy.t)) ? Number(copy.t) : 0;
      if (originalWords.length && isFinite(Number(originalWords[0].t))) start = Number(originalWords[0].t);
      var duration = Number(copy.duration);
      if (!(duration > 0) && originalWords.length) {
        var lastWord = originalWords[originalWords.length - 1] || {};
        duration = (Number(lastWord.t) || start) + (Number(lastWord.d) || 0) - start;
      }
      duration = Math.max(0.12, isFinite(duration) ? duration : 2.4);
      copy.words = [{
        text: String(copy.text || ''),
        t: start,
        d: duration,
        c0: 0,
        c1: String(copy.text || '').length
      }];
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
        css.href = 'vendor/lyric-viz/lyric-viz-bridge.css?v=20261010-pixi-no-eval';
        css.setAttribute('data-lyric-viz-css', '1');
        document.head.appendChild(css);
      }
      var script = document.createElement('script');
      script.src = 'vendor/lyric-viz/lyric-viz-bridge.js?v=20261010-pixi-no-eval';
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
    var preset = normalizeThemePreset(fxRef.lyricAnimationThemePreset);
    if (preset !== 'mineradio') {
      if (preset === 'folia-custom') {
        var custom = normalizeThemeColors(fxRef.lyricAnimationThemeColors);
        return {
          name: 'Folia Custom',
          backgroundColor: custom.backgroundColor,
          primaryColor: custom.primaryColor,
          accentColor: custom.accentColor,
          secondaryColor: custom.secondaryColor,
          fontStyle: 'sans',
          animationIntensity: fxRef.lyricAnimationIntensity || 'normal',
          wordColors: [],
          lyricsIcons: []
        };
      }
      var daylight = preset === 'folia-light';
      return {
        name: daylight ? 'Daylight Default' : 'Midnight Default',
        backgroundColor: daylight ? '#f5f5f4' : '#09090b',
        primaryColor: daylight ? '#1c1917' : '#f4f4f5',
        accentColor: daylight ? '#ea580c' : '#f4f4f5',
        secondaryColor: daylight ? '#44403c' : '#71717a',
        fontStyle: 'sans',
        animationIntensity: fxRef.lyricAnimationIntensity || 'normal',
        wordColors: [],
        lyricsIcons: []
      };
    }
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
      // “当前配色”只继承颜色。旧播放器返回的是整段 CSS 字体栈，
      // Folia 接口却把 fontFamily 当作单个字体名；嵌套引号使测量和绘制不一致，
      // 商籁等逐字动画因而把字排到画布外。沿用歌词引擎自己的字体栈。
      animationIntensity: fxRef.lyricAnimationIntensity || 'normal'
    };
    if (mode === 'fume' || mode === 'monet') {
      theme.backgroundColor = '#040608';
    }
    return theme;
  }

  function lyricAnimationTuningFromFx(fxRef) {
    var raw = fxRef.lyricAnimationTuning && typeof fxRef.lyricAnimationTuning === 'object' ? fxRef.lyricAnimationTuning : {};
    var tuning = {
      classic: Object.assign({}, DEFAULT_TUNING.classic, raw.classic || {}),
      cadenza: Object.assign({}, DEFAULT_TUNING.cadenza, raw.cadenza || {}),
      partita: Object.assign({}, DEFAULT_TUNING.partita, raw.partita || {}),
      fume: Object.assign({}, DEFAULT_TUNING.fume, raw.fume || {}),
      cappella: Object.assign({}, DEFAULT_TUNING.cappella, raw.cappella || {}),
      tilt: Object.assign({}, DEFAULT_TUNING.tilt, raw.tilt || {}),
      monet: Object.assign({}, DEFAULT_TUNING.monet, raw.monet || {})
    };
    ['claddagh', 'diorama', 'lumiere', 'pendolo', 'sonnet', 'tempera'].forEach(function(mode) {
      tuning[mode] = raw[mode] && typeof raw[mode] === 'object' ? Object.assign({}, raw[mode]) : {};
    });
    if (normalizeThemePreset(fxRef.lyricAnimationThemePreset) === 'mineradio' && isForeignDominantLyrics()) {
      tuning.classic.enableWordRotation = false;
      tuning.classic.wordSpacing = Math.min(Number(tuning.classic.wordSpacing) || 0.7, 0.35);
      tuning.cadenza.fontScale = Math.min(Number(tuning.cadenza.fontScale) || 1, 0.9);
      tuning.cadenza.widthRatio = Math.max(Number(tuning.cadenza.widthRatio) || 0.72, 0.88);
      tuning.cadenza.motionAmount = Math.min(Number(tuning.cadenza.motionAmount) || 1, 0.4);
      tuning.partita.useSemanticLayout = false;
      tuning.partita.staggerMin = 0;
      tuning.partita.staggerMax = 0;
      tuning.fume.heroScale = Math.min(Number(tuning.fume.heroScale) || 1, 0.86);
      tuning.tilt.splitProbability = 0;
      tuning.tilt.tiltStyleProbability = 0;
    }
    return tuning;
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
      lyricsFontScale: clampRangeLocal(
        Math.min(Number(fxRef.lyricScale) || 1, isForeignDominantLyrics() ? 0.9 : 1.65),
        0.35,
        1.65
      ),
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
    var useLxProgress = !!global.lxBridgeActive && typeof global.currentLxProgress === 'function';
    var base = useLxProgress ? Number(global.currentLxProgress()) : Number(audioRef && audioRef.currentTime);
    if (!isFinite(base)) base = 0;
    var fxRef = getFx();
    var offset = fxRef ? clampRangeLocal(Number(fxRef.lyricTimeOffset) || 0, -3, 3) : 0;
    return Math.max(0, base + offset);
  }

  function isPlaybackPaused() {
    if (!global.playing) return true;
    if (global.lxBridgeActive) return false;
    return !global.audio || !!global.audio.paused;
  }

  function isStageLyricLayerAllowed(fxRef) {
    fxRef = fxRef || getFx();
    return isStageAnimationActive(fxRef);
  }

  function restorePlaybackControlsAfterAnimationChange() {
    if (typeof global.forcePlaybackControlsInteractive === 'function') global.forcePlaybackControlsInteractive();
    if (typeof global.revealBottomControls === 'function') global.revealBottomControls(900);
  }

  function applyStageHostClasses(fxRef, active) {
    var host = getHost();
    var layerAllowed = !!active;
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
    if (typeof api.setBackground === 'function') api.setBackground(host, normalizeBackground(fxRef.lyricAnimationBackground));
    api.setMeta(host, lyricAnimationMetaFromContext(fxRef));
    api.setLines(host, lines);
    api.setPaused(host, isPlaybackPaused());
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
        resetBeatShake(getHost());
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
    if (!isStageLyricLayerAllowed() || !state.bundleLoaded || !state.stageMounted) {
      resetBeatShake(getHost());
      return;
    }
    var host = getHost();
    var api = resolveLyricVizApi();
    if (!host || !api) return;
    var t = currentPlaybackTime();
    api.setTime(host, t);
    api.setPaused(host, isPlaybackPaused());
    var bassVal = typeof global.bass !== 'undefined' ? global.bass : 0;
    var midVal = typeof global.mid !== 'undefined' ? global.mid : 0;
    var trebleVal = typeof global.treble !== 'undefined' ? global.treble : 0;
    var power = Math.max(0, Math.min(1.2, bassVal * 0.7 + midVal * 0.3));
    api.setAudio(host, {
      power: power,
      bands: { bass: bassVal, mid: midVal, treble: trebleVal }
    });
    var fxRef = getFx() || {};
    var shakeEnabled = fxRef.lyricBeatShakeEnabled !== false && !isPlaybackPaused();
    var shakeIntensity = clampRangeLocal(
      isFinite(Number(fxRef.lyricBeatShakeIntensity)) ? Number(fxRef.lyricBeatShakeIntensity) : 0.68,
      0,
      1.5
    );
    var rawShake = shakeEnabled
      ? Math.min(1.5, Math.max(0, Number(global.lyricBeatImpact) || 0))
      : 0;
    state.beatShakeDrive += (rawShake - state.beatShakeDrive) * (rawShake > state.beatShakeDrive ? 0.72 : 0.20);
    var root = host.querySelector('.mineradio-lyric-viz-root');
    if (root) {
      var shake = state.beatShakeDrive * shakeIntensity;
      var phase = Math.max(0, Number(global.lyricBeatImpactPhase) || 0);
      var clarity = clampRangeLocal(isFinite(Number(fxRef.lyricClarity)) ? Number(fxRef.lyricClarity) : 1.12, 0.45, 1.6);
      root.style.translate = (Math.sin(phase) * 6.2 * shake).toFixed(2) + 'px ' +
        ((-7.4 + Math.cos(phase * 1.16) * 3.2) * shake).toFixed(2) + 'px';
      root.style.rotate = (Math.sin(phase * 0.92) * 0.38 * shake).toFixed(3) + 'deg';
      root.style.scale = (1 + shake * 0.036).toFixed(4);
      root.style.filter = 'contrast(' + (0.88 + clarity * 0.18).toFixed(3) + ') brightness(' +
        (0.96 + clarity * 0.045).toFixed(3) + ')';
      root.style.willChange = shake > 0.01 ? 'translate, rotate, scale, filter' : '';
    }
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

  function setLyricAnimationThemePreset(preset) {
    var fxRef = getFx();
    if (!fxRef) return;
    fxRef.lyricAnimationThemePreset = normalizeThemePreset(preset);
    syncStageLyricAnimation(true);
    if (typeof global.saveLyricLayout === 'function') global.saveLyricLayout();
    if (typeof global.updateLyricAnimationControls === 'function') global.updateLyricAnimationControls();
  }

  function setLyricAnimationThemeColor(key, value) {
    var fxRef = getFx();
    if (!fxRef || ['backgroundColor', 'primaryColor', 'accentColor', 'secondaryColor'].indexOf(key) < 0) return;
    if (!/^#[0-9a-f]{6}$/i.test(String(value))) return;
    fxRef.lyricAnimationThemeColors = normalizeThemeColors(Object.assign({}, fxRef.lyricAnimationThemeColors || {}, { [key]: value }));
    fxRef.lyricAnimationThemePreset = 'folia-custom';
    refreshLyricAnimationAppearance();
    if (typeof global.saveLyricLayout === 'function') global.saveLyricLayout();
    if (typeof global.updateLyricAnimationControls === 'function') global.updateLyricAnimationControls();
  }

  function setLyricAnimationBackgroundMode(mode) {
    var fxRef = getFx();
    if (!fxRef || LYRIC_ANIM_BACKGROUND_MODES.indexOf(mode) < 0) return;
    var background = normalizeBackground(fxRef.lyricAnimationBackground);
    background.transparent = mode === 'transparent';
    background.mode = mode === 'transparent' ? 'common' : mode;
    fxRef.lyricAnimationBackground = background;
    applyLiveLyricAnimationSettings(fxRef, 'background');
    if (typeof global.saveLyricLayout === 'function') global.saveLyricLayout();
    if (typeof global.updateLyricAnimationControls === 'function') global.updateLyricAnimationControls();
  }

  function patchLyricAnimationBackground(patch) {
    var fxRef = getFx();
    if (!fxRef || !patch || typeof patch !== 'object') return;
    fxRef.lyricAnimationBackground = normalizeBackground(Object.assign({}, fxRef.lyricAnimationBackground || {}, patch));
    applyLiveLyricAnimationSettings(fxRef, 'background');
    if (typeof global.saveLyricLayout === 'function') global.saveLyricLayout();
  }

  function patchLyricAnimationBackgroundTuning(mode, patch) {
    var fxRef = getFx();
    var key = { monet: 'monetTuning', nomand: 'nomandTuning', latent: 'latentTuning', sora: 'soraTuning' }[mode];
    if (!fxRef || !key || !patch || typeof patch !== 'object') return;
    var background = normalizeBackground(fxRef.lyricAnimationBackground);
    background[key] = Object.assign({}, background[key], patch);
    fxRef.lyricAnimationBackground = background;
    applyLiveLyricAnimationSettings(fxRef, 'background');
    if (typeof global.saveLyricLayout === 'function') global.saveLyricLayout();
  }

  function resetLyricAnimationBackground() {
    var fxRef = getFx();
    if (!fxRef) return;
    var mode = selectedBackgroundMode(fxRef);
    var background = normalizeBackground(fxRef.lyricAnimationBackground);
    if (mode === 'common') {
      background.useCoverColorBg = false;
      background.opacity = 0.75;
      background.disableGeometricBackground = false;
      background.disableVignette = false;
    } else if (mode === 'url') {
      background.urlItems = [];
      background.urlSelectedId = null;
    } else if (mode === 'transparent') {
      background.transparent = false;
      background.mode = 'common';
    } else {
      background[mode + 'Tuning'] = {};
    }
    fxRef.lyricAnimationBackground = background;
    applyLiveLyricAnimationSettings(fxRef, 'background');
    if (typeof global.saveLyricLayout === 'function') global.saveLyricLayout();
    renderLyricAnimationSettingsControls();
  }

  function resetLyricAnimationModeTuning() {
    var fxRef = getFx();
    if (!fxRef) return;
    var mode = normalizeMode(fxRef.lyricAnimationMode);
    if (!fxRef.lyricAnimationTuning) fxRef.lyricAnimationTuning = {};
    fxRef.lyricAnimationTuning[mode] = {};
    applyLiveLyricAnimationSettings(fxRef, 'tuning');
    if (typeof global.saveLyricLayout === 'function') global.saveLyricLayout();
    renderLyricAnimationSettingsControls();
  }

  var BACKGROUND_FIELDS = {
    common: [
      ['useCoverColorBg', '叠加封面色彩', 'toggle', false],
      ['opacity', '背景层透明度', 'range', 0.75, 0, 1, 0.01],
      ['disableGeometricBackground', '隐藏通用几何背景', 'toggle', false],
      ['disableVignette', '禁用暗角', 'toggle', false]
    ],
    monet: [
      ['backgroundLayout', '封面布局', 'select', 'full-overlay', [['full-overlay', '全屏'], ['half-pane-gradient', '半屏渐变']]],
      ['backgroundBlurPx', '模糊半径', 'range', 6, 0, 40, 1],
      ['backgroundOverlayOpacity', '遮罩透明度', 'range', 0.74, 0, 1, 0.01],
      ['backgroundGrayscale', '黑白程度', 'range', 0, 0, 1, 0.01],
      ['backgroundSaturation', '饱和度', 'range', 1.05, 0, 2, 0.05],
      ['backgroundWash', '色彩晕染', 'range', 0.34, 0, 1, 0.01],
      ['backgroundDriftEnabled', '缓慢漂移', 'toggle', true],
      ['backgroundDriftStrength', '漂移幅度', 'range', 0.5, 0, 1, 0.05],
      ['backgroundStreaksEnabled', '细线纹理', 'toggle', true]
    ],
    nomand: [
      ['effect', '封面效果', 'select', 'dithering', [['dithering', '抖动像素'], ['fluted-glass', '棱纹玻璃'], ['paper-texture', '纸张纹理'], ['halftone-dots', '半调圆点'], ['lens-distortion', '镜头畸变']]],
      ['ditheringType', '像素矩阵', 'select', '8x8', [['2x2', '2×2'], ['4x4', '4×4'], ['8x8', '8×8']]],
      ['size', '颗粒大小', 'range', 3, 1, 8, 0.1],
      ['colorSteps', '色阶', 'range', 4, 2, 12, 1],
      ['originalColors', '保留封面颜色', 'toggle', false],
      ['inverted', '反相', 'toggle', false],
      ['flutedGlassSize', '玻璃纹宽度', 'range', 0.5, 0, 1, 0.01],
      ['flutedGlassDistortion', '玻璃扭曲', 'range', 0.5, 0, 1, 0.01],
      ['paperTextureContrast', '纸张对比度', 'range', 0.32, 0, 1, 0.01],
      ['paperTextureRoughness', '纸张粗糙度', 'range', 0.42, 0, 1, 0.01],
      ['halftoneDotsSize', '圆点大小', 'range', 0.5, 0, 1, 0.01],
      ['halftoneDotsContrast', '圆点对比度', 'range', 0.4, 0, 1, 0.01],
      ['lensDistortionSpread', '镜头扩散', 'range', 0.45, 0, 1, 0.01],
      ['lensDistortionBulge', '镜头鼓起', 'range', 0.3, 0, 1, 0.01],
      ['overlayEnabled', '背景遮罩', 'toggle', true],
      ['overlayOpacity', '遮罩透明度', 'range', 0.35, 0, 1, 0.01]
    ],
    latent: [
      ['displayMode', '动画层', 'select', 'both', [['both', '双层'], ['dithering', '抖动'], ['mesh', '渐变']]],
      ['colorSource', '取色来源', 'select', 'cover-theme', [['cover-theme', '封面＋主题'], ['cover-only', '仅封面']]],
      ['enhancedBeatResponse', '增强节奏响应', 'toggle', true],
      ['ditheringSpeed', '像素速度', 'range', 0.1, 0, 2, 0.05],
      ['ditheringSize', '像素大小', 'range', 2.5, 0.5, 8, 0.1],
      ['ditheringOpacity', '像素透明度', 'range', 0.55, 0, 1, 0.01],
      ['meshSpeed', '渐变速度', 'range', 0.3, 0, 2, 0.05],
      ['meshDistortion', '渐变扭曲', 'range', 0.8, 0, 2, 0.05],
      ['overlayEnabled', '背景遮罩', 'toggle', true],
      ['overlayOpacity', '遮罩透明度', 'range', 0.35, 0, 1, 0.01]
    ],
    sora: [['blank', '纯色空白背景', 'toggle', false]]
  };

  var MODE_FIELDS = {
    classic: [
      ['enableWordRotation', '逐词旋转', 'toggle', true],
      ['breathingFloatMultiplier', '呼吸漂浮', 'range', 1, 0, 2, 0.05],
      ['useLegacyLayout', '传统排版', 'toggle', false],
      ['wordSpacing', '词间距', 'range', 0.7, 0, 2, 0.05]
    ],
    cadenza: [
      ['fontScale', '字号比例', 'range', 1.12, 0.6, 1.8, 0.02],
      ['widthRatio', '排版宽度', 'range', 0.72, 0.4, 1, 0.02],
      ['motionAmount', '运动幅度', 'range', 1, 0, 2, 0.05],
      ['glowIntensity', '辉光强度', 'range', 1, 0, 2, 0.05],
      ['beamIntensity', '光束强度', 'range', 0, 0, 2, 0.05]
    ],
    partita: [
      ['showGuideLines', '显示引导线', 'toggle', true],
      ['useSemanticLayout', '语义排版', 'toggle', true],
      ['staggerMin', '错落最小', 'range', 20, 0, 180, 1],
      ['staggerMax', '错落最大', 'range', 100, 0, 180, 1]
    ],
    fume: [
      ['hidePrintSymbols', '隐藏印刷符号', 'toggle', false],
      ['disableGeometricBackground', '隐藏几何背景', 'toggle', true],
      ['backgroundObjectOpacity', '背景物件透明度', 'range', 0.5, 0, 1, 0.01],
      ['textHoldRatio', '文字停留', 'range', 1, 0, 2, 0.05],
      ['cameraTrackingMode', '镜头跟踪', 'select', 'smooth', [['smooth', '平滑'], ['stepped', '分段']]],
      ['cameraSpeed', '镜头速度', 'range', 1, 0.2, 2, 0.05],
      ['glowIntensity', '辉光强度', 'range', 1, 0, 2, 0.05],
      ['heroScale', '主标题比例', 'range', 1, 0.5, 1.8, 0.05]
    ],
    cappella: [
      ['showEmoMessages', '显示表情消息', 'toggle', true],
      ['emojiPackSource', '表情来源', 'select', 'builtin', [['builtin', '内置'], ['custom', '自定义']]],
      ['avatarSource', '头像来源', 'select', 'cover', [['cover', '封面'], ['builtin', '内置'], ['color', '纯色'], ['custom', '自定义']]]
    ],
    tilt: [
      ['splitProbability', '拆分概率', 'range', 0.75, 0, 1, 0.05],
      ['tiltStyleProbability', '倾斜概率', 'range', 0.35, 0, 1, 0.05],
      ['colorScheme', '配色', 'select', 'default', [['default', '默认'], ['swap', '对调'], ['accentAll', '全部强调色'], ['primaryAll', '全部主色']]]
    ],
    monet: [
      ['keywordColoringEnabled', '关键词着色', 'toggle', true],
      ['showDescription', '显示歌曲描述', 'toggle', true],
      ['showAudioVisualization', '显示音频图形', 'toggle', true],
      ['audioStyle', '音频图形样式', 'select', 'bar', [['bar', '柱形'], ['line', '线条']]],
      ['fontScale', '字号比例', 'range', 1, 0.5, 2, 0.05],
      ['portraitSource', '肖像来源', 'select', 'cover', [['cover', '封面'], ['custom', '自定义']]],
      ['portraitOffsetX', '肖像横移', 'range', 0, -1, 1, 0.05],
      ['portraitStyle', '肖像形状', 'select', 'square', [['square', '方形'], ['rectangular', '长方形']]]
    ],
    claddagh: [
      ['focusScaleRatio', '焦点比例', 'range', 0.65, 0, 1.5, 0.05],
      ['radiusScale', '圆弧半径', 'range', 1, 0.5, 1.5, 0.05],
      ['ellipseTiltDeg', '椭圆角度', 'range', 45, 0, 60, 1],
      ['showAxisLine', '显示轴线', 'toggle', true],
      ['letterSpacingOffset', '字间距偏移', 'range', 0, -0.5, 0.5, 0.01]
    ],
    diorama: [
      ['cameraSpeed', '镜头速度', 'range', 1, 0.1, 2, 0.05],
      ['motionAmount', '运动幅度', 'range', 1, 0, 2, 0.05],
      ['audioReactivity', '音频响应', 'range', 1, 0, 2, 0.05],
      ['particleDensity', '点云密度', 'range', 576, 96, 1536, 24],
      ['particleScale', '点云大小', 'range', 1, 0.65, 1.6, 0.05],
      ['showParticles', '背景粒子', 'toggle', true],
      ['particleGlowEnabled', '点云辉光', 'toggle', true],
      ['particleGlowIntensity', '点云辉光强度', 'range', 0.65, 0.1, 1.5, 0.05],
      ['glowEnabled', '普通跟唱辉光', 'toggle', true],
      ['soulEnabled', '灵魂出窍跟唱', 'toggle', true],
      ['gradientEnabled', '渐变跟唱', 'toggle', false],
      ['geometryVisibility.enabled', '显示点云结构', 'toggle', true],
      ['geometryVisibility.mode', '点云形态', 'select', 'clouds', [['clouds', '云团'], ['corridor', '通道']]]
    ],
    lumiere: [
      ['lightIntensity', '光强', 'range', 1, 0.3, 2, 0.05],
      ['audioResponse', '音频响应', 'range', 1, 0, 2, 0.05],
      ['fogDensity', '烟雾浓度', 'range', 1, 0, 2, 0.05],
      ['darkField', '暗场强度', 'range', 0.75, 0, 1, 0.01],
      ['bloom', '图形辉光', 'range', 1, 0, 2, 0.05],
      ['textBloom', '文字辉光', 'range', 1, 0, 2, 0.05],
      ['echo', '背景歌词亮度', 'range', 1, 0, 2, 0.05],
      ['lineArt', '线稿', 'toggle', true],
      ['trails', '轨迹线', 'toggle', true],
      ['overlayFrame', '画框', 'toggle', true],
      ['textOnly', '仅显示歌词', 'toggle', false],
      ['renderQuality', '画质', 'select', 'full', [['full', '完整'], ['balanced', '均衡'], ['low', '省电']]]
    ],
    pendolo: [
      ['arcRadius', '文字弧半径', 'range', 0.42, 0.2, 0.8, 0.01],
      ['arcAngleDeg', '弧度角', 'range', 100, 30, 180, 1],
      ['tickSnappiness', '钟摆响应', 'range', 2, 0.2, 4, 0.05],
      ['activeScale', '当前歌词比例', 'range', 1.25, 0.8, 2, 0.05],
      ['showGearDecor', '齿轮装饰', 'select', 'subtle', [['none', '关闭'], ['subtle', '轻微'], ['full', '完整']]],
      ['showCenterGradient', '中心渐变', 'toggle', true],
      ['showCoverOnWatchFace', '表盘封面', 'toggle', false],
      ['enableLineGlow', '逐行辉光', 'toggle', false]
    ],
    sonnet: [
      ['cameraIntensity', '镜头强度', 'range', 1, 0, 2, 0.05],
      ['typographyMotion', '排版运动', 'range', 1, 0, 2, 0.05],
      ['mgDensity', '动态图形密度', 'range', 1, 0, 2, 0.05],
      ['showOnlyText', '仅文字', 'toggle', false],
      ['showGuide', '辅助线', 'toggle', true],
      ['showBackgroundMg', '背景动态图形', 'toggle', true],
      ['showGiantDecorativeText', '巨型装饰字', 'toggle', true],
      ['enableTransitions', '转场', 'toggle', true],
      ['outerFrameMode', '外框', 'select', 'full', [['none', '关闭'], ['frame', '边框'], ['full', '完整']]],
      ['postProcessEnabled', '后期处理', 'toggle', false],
      ['postProcessGrain', '胶片颗粒', 'range', 0.2, 0, 1, 0.05]
    ],
    tempera: [
      ['cameraIntensity', '镜头强度', 'range', 1, 0, 2, 0.05],
      ['glyphMotion', '逐字运动', 'range', 1, 0, 2, 0.05],
      ['wholeLineLyrics', '整行歌词镜头', 'toggle', false],
      ['glyphSettleStretch', '逐字入场跨度', 'range', 0.5, 0, 1, 0.01],
      ['colorMode', '色彩方式', 'select', 'duo', [['duo', '双色'], ['mono', '单色'], ['gradient', '渐变']]],
      ['showBlocks', '色块', 'toggle', true],
      ['showDecor', '装饰', 'toggle', true],
      ['textInversion', '文字动态反色', 'toggle', true],
      ['enableTransitions', '转场', 'toggle', true],
      ['postProcessEnabled', '后期处理', 'toggle', true],
      ['postProcessGrain', '胶片颗粒', 'range', 0.2, 0, 1, 0.05]
    ]
  };

  function renderSettingField(container, field, values, apply) {
    var path = field[0], label = field[1], kind = field[2], fallback = field[3];
    var parts = path.split('.');
    var value = parts.length === 2 ? ((values[parts[0]] || {})[parts[1]]) : values[path];
    if (value == null) value = fallback;
    var row = document.createElement('div');
    row.className = kind === 'toggle' ? 'fx-toggle' : 'fx-slider';
    var title = document.createElement(kind === 'toggle' ? 'span' : 'label');
    title.textContent = label;
    row.appendChild(title);
    function submit(next) {
      var patch = {};
      if (parts.length === 2) { patch[parts[0]] = {}; patch[parts[0]][parts[1]] = next; }
      else patch[path] = next;
      apply(patch);
    }
    if (kind === 'toggle') {
      var dot = document.createElement('span');
      dot.className = 'dot';
      row.classList.toggle('on', !!value);
      row.appendChild(dot);
      row.addEventListener('click', function() {
        value = !value;
        row.classList.toggle('on', !!value);
        submit(value);
      });
    } else if (kind === 'select') {
      var select = document.createElement('select');
      field[4].forEach(function(option) {
        var element = document.createElement('option');
        element.value = option[0]; element.textContent = option[1];
        select.appendChild(element);
      });
      select.value = String(value);
      select.addEventListener('change', function() { submit(select.value); });
      row.appendChild(select);
    } else {
      var output = document.createElement('output');
      output.textContent = String(value);
      title.appendChild(output);
      var slider = document.createElement('input');
      slider.type = 'range'; slider.min = String(field[4]); slider.max = String(field[5]);
      slider.step = String(field[6]); slider.value = String(value);
      slider.addEventListener('input', function() {
        output.textContent = slider.value;
        submit(Number(slider.value));
      });
      row.appendChild(slider);
    }
    container.appendChild(row);
  }

  function renderLyricAnimationSettingsControls() {
    var fxRef = getFx();
    var bgHost = document.getElementById('lyric-anim-background-settings');
    var modeHost = document.getElementById('lyric-anim-mode-settings');
    if (!fxRef || !bgHost || !modeHost) return;
    var bgMode = selectedBackgroundMode(fxRef);
    document.querySelectorAll('#lyric-anim-background-grid [data-lyric-anim-bg]').forEach(function(button) {
      button.classList.toggle('active', button.getAttribute('data-lyric-anim-bg') === bgMode);
    });
    var background = normalizeBackground(fxRef.lyricAnimationBackground);
    bgHost.replaceChildren();
    var bgReset = document.createElement('button');
    bgReset.type = 'button'; bgReset.className = 'fx-mini-btn'; bgReset.textContent = '背景恢复默认';
    bgReset.addEventListener('click', resetLyricAnimationBackground);
    bgHost.appendChild(bgReset);
    if (bgMode === 'url') {
      var url = document.createElement('input');
      url.type = 'url'; url.placeholder = '输入网页背景的 HTTPS 地址';
      url.value = background.urlItems[0] ? background.urlItems[0].url : '';
      var save = document.createElement('button');
      save.type = 'button'; save.textContent = '使用此背景';
      save.addEventListener('click', function() {
        var value = url.value.trim();
        if (value && !/^https:\/\//i.test(value)) {
          if (typeof global.showToast === 'function') global.showToast('请使用 HTTPS 背景地址');
          return;
        }
        patchLyricAnimationBackground({ urlItems: value ? [{ id: 'custom', url: value, note: '自定义背景' }] : [], urlSelectedId: value ? 'custom' : null });
      });
      bgHost.appendChild(url); bgHost.appendChild(save);
    } else if (bgMode === 'transparent') {
      var hint = document.createElement('span');
      hint.textContent = '透明背景会显示 Mineradio 原有的舞台背景。';
      bgHost.appendChild(hint);
    } else {
      var key = bgMode === 'common' ? null : bgMode + 'Tuning';
      var values = key ? background[key] || {} : background;
      (BACKGROUND_FIELDS[bgMode] || []).forEach(function(field) {
        renderSettingField(bgHost, field, values, function(patch) {
          if (key) patchLyricAnimationBackgroundTuning(bgMode, patch);
          else patchLyricAnimationBackground(patch);
        });
      });
    }
    modeHost.replaceChildren();
    var mode = normalizeMode(fxRef.lyricAnimationMode);
    var fields = MODE_FIELDS[mode];
    if (!fields || !fields.length) {
      modeHost.textContent = mode === 'still' ? 'Still 模式无需额外参数。' : '选择一个歌词动画查看参数。';
      return;
    }
    var modeReset = document.createElement('button');
    modeReset.type = 'button'; modeReset.className = 'fx-mini-btn'; modeReset.textContent = '歌词效果恢复默认';
    modeReset.addEventListener('click', resetLyricAnimationModeTuning);
    modeHost.appendChild(modeReset);
    var tuning = fxRef.lyricAnimationTuning && fxRef.lyricAnimationTuning[mode] || {};
    fields.forEach(function(field) {
      renderSettingField(modeHost, field, tuning, function(patch) { patchLyricAnimationTuning(mode, patch); });
    });
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
    Object.keys(patch || {}).forEach(function(key) {
      var value = patch[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        fxRef.lyricAnimationTuning[mode][key] = Object.assign({}, fxRef.lyricAnimationTuning[mode][key] || {}, value);
      } else {
        fxRef.lyricAnimationTuning[mode][key] = value;
      }
    });
    applyLiveLyricAnimationSettings(fxRef, 'tuning');
    if (typeof global.saveLyricLayout === 'function') global.saveLyricLayout();
    if (typeof global.pushDesktopLyricsState === 'function') global.pushDesktopLyricsState(true);
  }

  function applyLiveLyricAnimationSettings(fxRef, target) {
    var api = resolveLyricVizApi();
    var host = getHost();
    if (isStageReady() && api && host) {
      if (target !== 'background') api.setTuning(host, lyricAnimationTuningFromFx(fxRef));
      if (target !== 'tuning' && typeof api.setBackground === 'function') api.setBackground(host, normalizeBackground(fxRef.lyricAnimationBackground));
    } else if (isStageLyricLayerAllowed(fxRef)) {
      syncStageLyricAnimation(true);
    }
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
      lyricAnimationBackground: normalizeBackground(fxRef.lyricAnimationBackground),
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
      lyricAnimationThemePreset: normalizeThemePreset(raw.lyricAnimationThemePreset),
      lyricAnimationThemeColors: normalizeThemeColors(raw.lyricAnimationThemeColors),
      lyricAnimationBackground: normalizeBackground(raw.lyricAnimationBackground),
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
        monet: Object.assign({}, DEFAULT_TUNING.monet, tuning.monet || {}),
        claddagh: tuning.claddagh || {},
        diorama: tuning.diorama || {},
        lumiere: tuning.lumiere || {},
        pendolo: tuning.pendolo || {},
        sonnet: tuning.sonnet || {},
        tempera: tuning.tempera || {}
      }
    };
  }

  function serializeLyricAnimationFx(fxRef) {
    return {
      lyricAnimationMode: normalizeMode(fxRef.lyricAnimationMode),
      lyricAnimationStage: !!fxRef.lyricAnimationStage,
      lyricAnimationDesktop: false,
      lyricAnimationIntensity: fxRef.lyricAnimationIntensity || 'normal',
      lyricAnimationThemePreset: normalizeThemePreset(fxRef.lyricAnimationThemePreset),
      lyricAnimationThemeColors: normalizeThemeColors(fxRef.lyricAnimationThemeColors),
      lyricAnimationBackground: normalizeBackground(fxRef.lyricAnimationBackground),
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
      if (typeof api.setBackground === 'function') api.setBackground(host, normalizeBackground(fxRef.lyricAnimationBackground));
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
    setThemePreset: setLyricAnimationThemePreset,
    setThemeColor: setLyricAnimationThemeColor,
    themeColors: normalizeThemeColors,
    BACKGROUND_MODES: LYRIC_ANIM_BACKGROUND_MODES,
    selectedBackgroundMode: selectedBackgroundMode,
    setBackgroundMode: setLyricAnimationBackgroundMode,
    patchBackground: patchLyricAnimationBackground,
    patchBackgroundTuning: patchLyricAnimationBackgroundTuning,
    renderSettingsControls: renderLyricAnimationSettingsControls,
    toggleTarget: toggleLyricAnimationTarget,
    patchTuning: patchLyricAnimationTuning,
    desktopPayload: desktopLyricAnimationPayload,
    normalizeFx: normalizeLyricAnimationFx,
    serializeFx: serializeLyricAnimationFx,
    debug: {
      cloneLine: cloneLyricLineForAnimation,
      foreignRatio: foreignLyricRatio,
      currentTime: currentPlaybackTime,
      tuning: lyricAnimationTuningFromFx
    }
  };
})(window);
