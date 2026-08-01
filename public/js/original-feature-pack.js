(function () {
  'use strict';

  var STORE_KEY = 'mineradio-original-feature-pack-v2';
  var FADE_STORE_KEY = 'mineradio-audio-fade-v1';
  var FADE_DEFAULT_MIGRATION_KEY = 'mineradio-original-fade-default-v2';
  var BEAT_SHAKE_DEFAULT_MIGRATION_KEY = 'mineradio-original-beat-shake-default-v2';
  var DEFAULTS = {
    sonicGroundAmplitude: 50, sonicGroundMotionSpeed: 50, sonicGroundDensity: 46,
    sonicGroundRange: 82, sonicGroundLower: 68, sonicGroundDepth: 62,
    sonicGroundAutoRotate: 50, sonicGroundColorMode: 'cover', sonicAdaptiveSongColor: false,
    sonicGroundBaseColor: '#05070c', sonicGroundCoolColor: '#0066ff',
    sonicGroundWarmColor: '#ff3c19', sonicGroundAccentColor: '#33e6ff',
    sonicGroundGlow: 20, sonicGroundSubBass: 90, sonicGroundBass: 92,
    sonicGroundLowMid: 50, sonicGroundMid: 50, sonicGroundHighMid: 50,
    sonicGroundPresence: 25, sonicGroundBrilliance: 50, sonicGroundAir: 48,
    sonicGroundFloatingEnabled: true, sonicGroundFloatingIntensity: 36,
    sonicGroundFloatingMinSize: 9, sonicGroundFloatingMaxSize: 12,
    sonicGroundFloatingSpeed: 59, sonicGroundFloatingCount: 80,
    sonicAudioMonitorEnabled: true, sonicAudioAutoTrack: true,
    sonicAudioSensitivity: 100, sonicAudioBandStart: 1, sonicAudioBandEnd: 4,
    sonicAudioThreshold: 32, sonicAudioPulseStrength: 62,
    sonicWorkshopInputGain: 82, sonicWorkshopAudioIntensity: 1.15,
    sonicWorkshopResponseRange: 1.30, sonicWorkshopPeakIntensity: 0.62,
    sonicWorkshopColorMode: 'cover', sonicWorkshopTheme: 'minimal-monochrome',
    sonicWorkshopCustomColor: '#d9dde3', sonicWorkshopBaseColorMode: 'cover',
    sonicWorkshopBaseColor: '#0b0c0e', sonicWorkshopWarmColorMode: 'cover',
    sonicWorkshopWarmColor: '#d9dde3', sonicWorkshopCoolColorMode: 'custom',
    sonicWorkshopCoolColor: '#ffffff', sonicWorkshopRippleColorMode: 'cover',
    sonicWorkshopRippleColor: '#ffffff', sonicWorkshopPeakColorMode: 'cover',
    sonicWorkshopPeakColor: '#f2f5f8',
    lyricMotionStyle: 'off', lyricGlitchEnabled: false, lyricGlitchCameraBind: true,
    lyricBeatShakeEnabled: true, lyricBeatShakeIntensity: 0.68, lyricClarity: 1.12,
    lyricTextureClarity: 2,
    lyricGlitchIntensity: 1, lyricGlitchSlice: 0.72, lyricGlitchChroma: 0.86,
    lyricGlitchRate: 1, lyricGlitchJitter: 0.72,
    memoryAutoTrimApp: true, memoryAutoTrimOnBackground: true,
    memoryAutoSystemTrim: false, memorySystemAutoElevate: false,
    memorySystemIntervalMin: 30, memorySystemThresholdPercent: 78,
    memorySystemMask: 29, memorySafetyRevision: 3,
    albumGaplessEnabled: true
  };

  var SLIDERS = [
    ['fx-sonicamp','sonicGroundAmplitude',0], ['fx-sonicspeed','sonicGroundMotionSpeed',0],
    ['fx-sonicdensity','sonicGroundDensity',0], ['fx-sonicrange','sonicGroundRange',0],
    ['fx-soniclower','sonicGroundLower',0], ['fx-sonicdepth','sonicGroundDepth',0],
    ['fx-sonicautorotate','sonicGroundAutoRotate',0], ['fx-sonicaudiosensitivity','sonicAudioSensitivity',0],
    ['fx-sonicaudiobandstart','sonicAudioBandStart',0], ['fx-sonicaudiobandend','sonicAudioBandEnd',0],
    ['fx-sonicaudiothreshold','sonicAudioThreshold',0], ['fx-sonicaudiopulse','sonicAudioPulseStrength',0],
    ['fx-sonicsubbass','sonicGroundSubBass',0], ['fx-sonicbass','sonicGroundBass',0],
    ['fx-soniclowmid','sonicGroundLowMid',0], ['fx-sonicmid','sonicGroundMid',0],
    ['fx-sonichighmid','sonicGroundHighMid',0], ['fx-sonicpresence','sonicGroundPresence',0],
    ['fx-sonicbrilliance','sonicGroundBrilliance',0], ['fx-sonicair','sonicGroundAir',0],
    ['fx-sonicglow','sonicGroundGlow',0], ['fx-sonicfloatcount','sonicGroundFloatingCount',0],
    ['fx-sonicfloatintensity','sonicGroundFloatingIntensity',0], ['fx-sonicfloatmin','sonicGroundFloatingMinSize',0],
    ['fx-sonicfloatmax','sonicGroundFloatingMaxSize',0], ['fx-sonicfloatspeed','sonicGroundFloatingSpeed',0],
    ['fx-sonicwegain','sonicWorkshopInputGain',0], ['fx-sonicweaudio','sonicWorkshopAudioIntensity',2],
    ['fx-sonicwerange','sonicWorkshopResponseRange',2], ['fx-sonicwepeak','sonicWorkshopPeakIntensity',2],
    ['fx-lyricglitchintensity','lyricGlitchIntensity',2], ['fx-lyricglitchslice','lyricGlitchSlice',2],
    ['fx-lyricglitchchroma','lyricGlitchChroma',2], ['fx-lyricglitchrate','lyricGlitchRate',2],
    ['fx-lyricglitchjitter','lyricGlitchJitter',2],
    ['fx-lyricbeatshakeintensity','lyricBeatShakeIntensity',2]
  ];

  var COLOR_FIELDS = {
    'sonic-ground-base-picker': ['sonicGroundBaseColor','sonicGroundColorMode','sonic-ground-base-value'],
    'sonic-ground-cool-picker': ['sonicGroundCoolColor','sonicGroundColorMode','sonic-ground-cool-value'],
    'sonic-ground-warm-picker': ['sonicGroundWarmColor','sonicGroundColorMode','sonic-ground-warm-value'],
    'sonic-ground-accent-picker': ['sonicGroundAccentColor','sonicGroundColorMode','sonic-ground-accent-value'],
    'sonic-workshop-cover-picker': ['sonicWorkshopCustomColor','sonicWorkshopColorMode','sonic-workshop-theme-value'],
    'sonic-workshop-base-picker': ['sonicWorkshopBaseColor','sonicWorkshopBaseColorMode','sonic-workshop-base-value'],
    'sonic-workshop-warm-picker': ['sonicWorkshopWarmColor','sonicWorkshopWarmColorMode','sonic-workshop-warm-value'],
    'sonic-workshop-cool-picker': ['sonicWorkshopCoolColor','sonicWorkshopCoolColorMode','sonic-workshop-cool-value'],
    'sonic-workshop-ripple-picker': ['sonicWorkshopRippleColor','sonicWorkshopRippleColorMode','sonic-workshop-ripple-value'],
    'sonic-workshop-peak-picker': ['sonicWorkshopPeakColor','sonicWorkshopPeakColorMode','sonic-workshop-peak-value']
  };

  var WORKSHOP_THEMES = {
    'coral-mirage': ['#cb6c89','#16060f','#cb6c89','#99c4ff','#f8d8ff','#fff3ff'],
    'ocean-deep': ['#46b9e8','#031522','#157fa7','#83ddff','#9ff6ff','#e1fbff'],
    'arctic-aurora': ['#b8ebff','#07131a','#9edcff','#dff9ff','#c8fff4','#ffffff'],
    'cyber-forest': ['#5ff0a0','#04150e','#29c978','#a5ffe0','#8affc5','#e9fff5'],
    'minimal-monochrome': ['#d9dde3','#0b0c0e','#d9dde3','#ffffff','#ffffff','#f2f5f8']
  };

  function clamp(value, min, max) {
    value = Number(value);
    if (!isFinite(value)) value = min;
    return Math.max(min, Math.min(max, value));
  }
  function hex(value, fallback) {
    value = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
  }
  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (_e) { return {}; }
  }
  function persist() {
    var payload = {};
    Object.keys(DEFAULTS).forEach(function (key) { payload[key] = fx[key]; });
    try { localStorage.setItem(STORE_KEY, JSON.stringify(payload)); } catch (_e) {}
  }
  window.persistOriginalFeaturePack = persist;
  function mergeDefaults() {
    var saved = readStore();
    try {
      if (localStorage.getItem(BEAT_SHAKE_DEFAULT_MIGRATION_KEY) !== '1') {
        var savedBeatIntensity = Number(saved.lyricBeatShakeIntensity);
        if (!isFinite(savedBeatIntensity) || Math.abs(savedBeatIntensity - 0.72) < 0.001) saved.lyricBeatShakeIntensity = 0.68;
        localStorage.setItem(STORE_KEY, JSON.stringify(saved));
        localStorage.setItem(BEAT_SHAKE_DEFAULT_MIGRATION_KEY, '1');
      }
    } catch (_beatMigrationError) {}
    var savedMotionStyle = String(saved.lyricMotionStyle || (fx && fx.lyricMotionStyle) || '');
    if (!/^(off|float|smooth|glass|shine|glitch)$/.test(savedMotionStyle)) {
      savedMotionStyle = saved.lyricGlitchEnabled === true || (fx && fx.lyricGlitchEnabled === true) ? 'glitch' : 'off';
    }
    saved.lyricMotionStyle = savedMotionStyle;
    Object.keys(DEFAULTS).forEach(function (key) {
      if (typeof fxDefaults !== 'undefined' && fxDefaults && fxDefaults[key] == null) fxDefaults[key] = DEFAULTS[key];
      if (fx[key] == null) fx[key] = DEFAULTS[key];
      if (saved[key] != null) fx[key] = saved[key];
    });
    fx.lyricMotionStyle = /^(off|float|smooth|glass|shine|glitch)$/.test(String(fx.lyricMotionStyle || '')) ? String(fx.lyricMotionStyle) : 'off';
    fx.lyricGlitchEnabled = fx.lyricMotionStyle === 'glitch';
    fx.albumGaplessEnabled = fx.albumGaplessEnabled !== false;
  }
  function outputFor(input, value, digits) {
    if (!input) return;
    input.value = String(value);
    var out = input.parentElement && input.parentElement.querySelector('output');
    if (out) out.textContent = digits ? Number(value).toFixed(digits) : String(Math.round(Number(value)));
  }
  function refreshToggles() {
    [
      ['t-sonicGroundFloatingEnabled','sonicGroundFloatingEnabled'],
      ['t-sonicAdaptiveSongColor','sonicAdaptiveSongColor'],
      ['t-sonicAudioMonitorEnabled','sonicAudioMonitorEnabled'],
      ['t-sonicAudioAutoTrack','sonicAudioAutoTrack'],
      ['t-lyricBeatShakeEnabled','lyricBeatShakeEnabled'],
      ['t-memoryAutoTrimApp','memoryAutoTrimApp'],
      ['t-memoryAutoTrimOnBackground','memoryAutoTrimOnBackground'],
      ['t-memoryAutoSystemTrim','memoryAutoSystemTrim'],
      ['t-memorySystemAutoElevate','memorySystemAutoElevate']
    ].forEach(function (item) {
      var el = document.getElementById(item[0]);
      if (el) el.classList.toggle('on', !!fx[item[1]]);
    });
    var gapless = document.getElementById('t-albumGaplessEnabled');
    if (gapless) {
      gapless.classList.toggle('on', fx.albumGaplessEnabled !== false);
      gapless.textContent = fx.albumGaplessEnabled !== false ? '无缝衔接 · 已开启' : '无缝衔接 · 已关闭';
    }
  }
  function refreshColors() {
    Object.keys(COLOR_FIELDS).forEach(function (id) {
      var field = COLOR_FIELDS[id], input = document.getElementById(id);
      if (!input) return;
      var value = hex(fx[field[0]], DEFAULTS[field[0]] || '#ffffff');
      input.value = value;
      var label = document.getElementById(field[2]);
      if (label) label.textContent = fx[field[1]] === 'cover' ? '封面取色' : value.toUpperCase();
    });
  }
  function refreshMotionUi() {
    var style = /^(off|float|smooth|glass|shine|glitch)$/.test(String(fx.lyricMotionStyle || '')) ? String(fx.lyricMotionStyle) : 'off';
    var seg = document.getElementById('lyric-motion-style-seg');
    if (seg) seg.classList.toggle('glitch-selected', style === 'glitch');
    document.querySelectorAll('#lyric-motion-style-seg [data-motion]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-motion') === style);
    });
    var glitch = document.getElementById('lyric-glitch-controls');
    if (glitch) glitch.classList.toggle('active', style === 'glitch');
    var bind = document.getElementById('lyric-glitch-camera-bind');
    if (bind) {
      bind.classList.toggle('active', !!fx.lyricGlitchCameraBind);
      bind.textContent = fx.lyricGlitchCameraBind ? '已跟随鼓点故障' : '跟随鼓点故障';
    }
  }
  function refreshSonicPane() {
    var p = Number(fx.preset);
    var fold = document.getElementById('fx-original-sonic-fold');
    var topo = document.getElementById('original-sonic-topography-pane');
    var workshop = document.getElementById('original-sonic-workshop-pane');
    var sonicPresetActive = p === 13 || p === 14;
    if (fold) {
      fold.hidden = !sonicPresetActive;
      fold.style.display = sonicPresetActive ? '' : 'none';
      if (!sonicPresetActive) fold.classList.remove('open');
    }
    if (topo) topo.classList.toggle('active', p === 13);
    if (workshop) workshop.classList.toggle('active', p === 14);
    document.querySelectorAll('#sonic-workshop-theme-seg [data-sonic-workshop-theme]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-sonic-workshop-theme') === fx.sonicWorkshopTheme);
    });
  }
  function refreshFadeUi() {
    var inSlider = document.getElementById('fade-in-slider');
    var outSlider = document.getElementById('fade-out-slider');
    if (inSlider) inSlider.value = (AUDIO_FADE_IN_MS / 1000).toFixed(2);
    if (outSlider) outSlider.value = (AUDIO_FADE_OUT_MS / 1000).toFixed(2);
    var inValue = document.getElementById('fade-in-value');
    var outValue = document.getElementById('fade-out-value');
    if (inValue) inValue.textContent = (AUDIO_FADE_IN_MS / 1000).toFixed(2) + 's';
    if (outValue) outValue.textContent = (AUDIO_FADE_OUT_MS / 1000).toFixed(2) + 's';
  }
  function refreshLyricTextureQualityUi() {
    var tier = Math.max(1, Math.min(4, Math.round(Number(fx.lyricTextureClarity) || 2)));
    fx.lyricTextureClarity = tier;
    document.querySelectorAll('#lyric-texture-quality-seg [data-lyric-texture-clarity]').forEach(function (btn) {
      var active = Number(btn.getAttribute('data-lyric-texture-clarity')) === tier;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }
  function refreshOriginalFeatureUi() {
    SLIDERS.forEach(function (item) { outputFor(document.getElementById(item[0]), fx[item[1]], item[2]); });
    refreshToggles(); refreshColors(); refreshMotionUi(); refreshSonicPane(); refreshFadeUi(); refreshLyricTextureQualityUi();
    if (typeof refreshSonicAudioMonitorUi === 'function') refreshSonicAudioMonitorUi();
  }

  window.refreshOriginalFeatureUi = refreshOriginalFeatureUi;
  window.toggleOriginalFeature = function (key) {
    fx[key] = !fx[key];
    persist(); refreshToggles();
    if (/^sonicAudio/.test(key) && typeof refreshSonicAudioMonitorUi === 'function') refreshSonicAudioMonitorUi();
    if (/^memory/.test(key) && typeof configureMemoryReductFromFx === 'function') {
      if (typeof updateMemoryControls === 'function') updateMemoryControls();
      configureMemoryReductFromFx('toggle', key === 'memoryAutoSystemTrim' && !!fx[key]);
    }
  };
  window.toggleOriginalGapless = function () {
    fx.albumGaplessEnabled = fx.albumGaplessEnabled === false;
    persist(); refreshToggles();
    if (!fx.albumGaplessEnabled) clearOriginalGaplessPreload('disabled');
    else if (typeof trackSwitchToken !== 'undefined') scheduleOriginalGaplessPreload(trackSwitchToken, 'enabled');
    if (typeof showToast === 'function') showToast(fx.albumGaplessEnabled ? '无缝衔接已开启' : '无缝衔接已关闭');
  };
  window.setLyricGlitchEnabled = function (enabled) {
    window.setLyricMotionStyle(enabled ? 'glitch' : 'off');
  };
  window.setLyricMotionStyle = function (style) {
    style = String(style || 'off');
    if (!/^(off|float|smooth|glass|shine|glitch)$/.test(style)) style = 'off';
    fx.lyricMotionStyle = style;
    fx.lyricGlitchEnabled = style === 'glitch';
    persist(); refreshMotionUi();
    var names = { off:'关闭', float:'漂浮', smooth:'柔滑', glass:'玻璃', shine:'线光', glitch:'故障' };
    if (typeof showToast === 'function') showToast(style === 'off' ? '歌词效果已关闭' : ('歌词效果已切换：' + names[style]));
  };
  window.setLyricTextureClarity = function (value, silent) {
    var next = Math.max(1, Math.min(4, Math.round(Number(value) || 2)));
    var changed = next !== Math.max(1, Math.min(4, Math.round(Number(fx.lyricTextureClarity) || 2)));
    fx.lyricTextureClarity = next;
    fx.lyricClarity = next >= 4 ? 1.28 : (next === 3 ? 1.20 : (next === 2 ? 1.12 : 0.96));
    persist();
    refreshLyricTextureQualityUi();
    if (changed && typeof refreshCurrentLyricStyle === 'function') refreshCurrentLyricStyle();
    if (typeof saveLyricLayout === 'function') saveLyricLayout();
    if (!silent && typeof showToast === 'function') {
      var labels = { 1:'1× 标清', 2:'2× 高清', 3:'3× 超清', 4:'4× 极致' };
      showToast('歌词清晰度：' + labels[next]);
    }
  };
  window.toggleLyricGlitchCameraBind = function () {
    fx.lyricGlitchCameraBind = !fx.lyricGlitchCameraBind;
    persist(); refreshMotionUi();
    if (typeof showToast === 'function') showToast(fx.lyricGlitchCameraBind ? '故障歌词已跟随鼓点' : '故障歌词已取消鼓点跟随');
  };
  window.resetSonicGroundColor = function (key) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return;
    fx[key] = DEFAULTS[key]; fx.sonicGroundColorMode = 'custom'; persist(); refreshColors();
  };
  window.setSonicWorkshopRegionColorMode = function (region, mode) {
    var map = { theme:'sonicWorkshopColorMode', base:'sonicWorkshopBaseColorMode', warm:'sonicWorkshopWarmColorMode', cool:'sonicWorkshopCoolColorMode', ripple:'sonicWorkshopRippleColorMode', peak:'sonicWorkshopPeakColorMode' };
    if (!map[region]) return;
    fx[map[region]] = mode === 'custom' ? 'custom' : 'cover'; persist(); refreshColors();
  };
  window.setSonicWorkshopTheme = function (name) {
    var palette = WORKSHOP_THEMES[name] || WORKSHOP_THEMES['minimal-monochrome'];
    fx.sonicWorkshopTheme = WORKSHOP_THEMES[name] ? name : 'minimal-monochrome';
    fx.sonicWorkshopColorMode = 'custom'; fx.sonicWorkshopCustomColor = palette[0];
    fx.sonicWorkshopBaseColorMode = 'custom'; fx.sonicWorkshopBaseColor = palette[1];
    fx.sonicWorkshopWarmColorMode = 'custom'; fx.sonicWorkshopWarmColor = palette[2];
    fx.sonicWorkshopCoolColorMode = 'custom'; fx.sonicWorkshopCoolColor = palette[3];
    fx.sonicWorkshopRippleColorMode = 'custom'; fx.sonicWorkshopRippleColor = palette[4];
    fx.sonicWorkshopPeakColorMode = 'custom'; fx.sonicWorkshopPeakColor = palette[5];
    persist(); refreshColors(); refreshSonicPane();
  };

  function bindSliders() {
    SLIDERS.forEach(function (item) {
      var input = document.getElementById(item[0]);
      if (!input || input._originalFeatureBound) return;
      input._originalFeatureBound = true;
      input.addEventListener('input', function () {
        fx[item[1]] = Number(input.value);
        if (item[1] === 'sonicGroundFloatingMinSize' && fx.sonicGroundFloatingMinSize > fx.sonicGroundFloatingMaxSize) fx.sonicGroundFloatingMaxSize = fx.sonicGroundFloatingMinSize;
        if (item[1] === 'sonicGroundFloatingMaxSize' && fx.sonicGroundFloatingMaxSize < fx.sonicGroundFloatingMinSize) fx.sonicGroundFloatingMinSize = fx.sonicGroundFloatingMaxSize;
        if (typeof sonicAudioNormalizeFx === 'function' && /^sonicAudio/.test(item[1])) sonicAudioNormalizeFx(fx);
        outputFor(input, fx[item[1]], item[2]); persist();
      });
    });
  }
  function bindColors() {
    Object.keys(COLOR_FIELDS).forEach(function (id) {
      var input = document.getElementById(id), field = COLOR_FIELDS[id];
      if (!input || input._originalFeatureBound) return;
      input._originalFeatureBound = true;
      input.addEventListener('input', function () {
        fx[field[0]] = hex(input.value, DEFAULTS[field[0]] || '#ffffff');
        fx[field[1]] = 'custom'; persist(); refreshColors();
      });
    });
  }
  function bindFades() {
    [['fade-in-slider','in'],['fade-out-slider','out']].forEach(function (item) {
      var input = document.getElementById(item[0]);
      if (!input || input._originalFeatureBound) return;
      input._originalFeatureBound = true;
      input.addEventListener('input', function () {
        var ms = Math.round(clamp(input.value, 0, 3) * 1000);
        if (item[1] === 'in') AUDIO_FADE_IN_MS = ms; else AUDIO_FADE_OUT_MS = ms;
        try { localStorage.setItem(FADE_STORE_KEY, JSON.stringify({ fadeInMs:AUDIO_FADE_IN_MS, fadeOutMs:AUDIO_FADE_OUT_MS })); } catch (_e) {}
        refreshFadeUi();
      });
    });
  }

  function ensureOriginalFadeDefaults() {
    try {
      if (localStorage.getItem(FADE_DEFAULT_MIGRATION_KEY) === '1') return;
      var saved = JSON.parse(localStorage.getItem(FADE_STORE_KEY) || '{}') || {};
      var fadeIn = Number(saved.fadeInMs);
      var fadeOut = Number(saved.fadeOutMs);
      if (!isFinite(fadeIn) || fadeIn <= 0) fadeIn = 460;
      if (!isFinite(fadeOut) || fadeOut <= 0) fadeOut = 420;
      AUDIO_FADE_IN_MS = clamp(fadeIn, 0, 3000);
      AUDIO_FADE_OUT_MS = clamp(fadeOut, 0, 3000);
      localStorage.setItem(FADE_STORE_KEY, JSON.stringify({
        fadeInMs:AUDIO_FADE_IN_MS,
        fadeOutMs:AUDIO_FADE_OUT_MS
      }));
      localStorage.setItem(FADE_DEFAULT_MIGRATION_KEY, '1');
    } catch (_e) {
      if (!(Number(AUDIO_FADE_IN_MS) > 0)) AUDIO_FADE_IN_MS = 460;
      if (!(Number(AUDIO_FADE_OUT_MS) > 0)) AUDIO_FADE_OUT_MS = 420;
    }
  }

  // Lightweight local-file gapless engine. It preloads the next queue item,
  // performs an equal-power boundary crossfade, then hands the live Audio element
  // back to the existing player so lyrics, beat analysis and media controls stay native.
  var gapless = { preload:null, monitor:0, frame:0, serial:0, mixing:false };
  function disposeGaplessMedia(media) {
    if (!media) return;
    try { media.pause(); media.removeAttribute('src'); media.load(); } catch (_e) {}
  }
  function clearOriginalGaplessPreload(reason) {
    gapless.serial++;
    if (gapless.monitor) clearInterval(gapless.monitor);
    if (gapless.frame) cancelAnimationFrame(gapless.frame);
    gapless.monitor = 0; gapless.frame = 0; gapless.mixing = false;
    var pending = gapless.preload; gapless.preload = null;
    if (pending && !pending.adopted) disposeGaplessMedia(pending.media);
  }
  window.clearOriginalGaplessPreload = clearOriginalGaplessPreload;
  function canGaplessAdvance(idx) {
    if (!fx || fx.albumGaplessEnabled === false || playMode === 'single' || playMode === 'shuffle') return false;
    if (!Array.isArray(playQueue) || idx < 0 || idx + 1 >= playQueue.length) return false;
    var current = playQueue[idx], next = playQueue[idx + 1];
    return !!(current && next && current.type === 'local' && next.type === 'local');
  }
  async function scheduleOriginalGaplessPreload(token, reason) {
    if (!canGaplessAdvance(currentIdx) || token !== trackSwitchToken) {
      clearOriginalGaplessPreload(reason || 'not-eligible'); return false;
    }
    var nextIndex = currentIdx + 1, song = playQueue[nextIndex];
    var key = typeof queueItemKey === 'function' ? queueItemKey(song) : String(nextIndex);
    if (gapless.preload && gapless.preload.index === nextIndex && gapless.preload.key === key) return true;
    clearOriginalGaplessPreload(reason || 'replace');
    var serial = ++gapless.serial;
    try {
      var url = typeof refreshLocalSongProxyUrl === 'function' ? await refreshLocalSongProxyUrl(song) : '';
      if (!url && typeof ensureLocalSongUrl === 'function') url = ensureLocalSongUrl(song);
      if (!url && typeof createLocalAudioBlobUrl === 'function') url = await createLocalAudioBlobUrl(song);
      if (!url || serial !== gapless.serial || token !== trackSwitchToken || !canGaplessAdvance(currentIdx)) return false;
      var media = new Audio();
      media.preload = 'auto'; media.volume = 0; media.src = url;
      if (typeof configurePlaybackAudioElement === 'function') configurePlaybackAudioElement(media);
      if (typeof applyAudioOutputDevice === 'function') await applyAudioOutputDevice(media);
      media.load();
      gapless.preload = { media:media, index:nextIndex, key:key, token:token, serial:serial, song:song, url:url, adopted:false };
      gapless.monitor = setInterval(function () {
        var pending = gapless.preload;
        if (!pending || pending.token !== trackSwitchToken || pending.index !== currentIdx + 1 || !canGaplessAdvance(currentIdx)) {
          clearOriginalGaplessPreload('monitor-invalid'); return;
        }
        if (!audio || audio.paused || !isFinite(audio.duration) || !isFinite(audio.currentTime) || pending.media.readyState < 2) return;
        var remaining = audio.duration - audio.currentTime;
        var boundary = Math.max(0.18, Math.min(1.15, Math.max(260, Number(AUDIO_FADE_OUT_MS) || 420) / 1000));
        var quietTail = remaining < Math.min(1.35, boundary + 0.42) && Math.max(Number(audioEnergy) || 0, Number(smoothEnergy) || 0) < 0.022;
        if (remaining <= boundary || quietTail) startOriginalGaplessMix(pending, remaining);
      }, 70);
      return true;
    } catch (error) {
      if (serial === gapless.serial) console.warn('[OriginalGapless] preload failed', error);
      return false;
    }
  }
  window.scheduleOriginalGaplessPreload = scheduleOriginalGaplessPreload;
  function startOriginalGaplessMix(pending, remaining) {
    if (!pending || gapless.mixing || pending !== gapless.preload || !canGaplessAdvance(currentIdx)) return false;
    gapless.mixing = true;
    if (gapless.monitor) clearInterval(gapless.monitor); gapless.monitor = 0;
    var outgoing = audio, incoming = pending.media, token = trackSwitchToken;
    var duration = Math.max(180, Math.min(1200, Number(AUDIO_FADE_OUT_MS) || 420));
    if (isFinite(remaining) && remaining > 0) duration = Math.min(duration, Math.max(160, Math.round(remaining * 1000 + 45)));
    try {
      incoming.muted = false; incoming.volume = 0;
      var start = incoming.play();
      Promise.resolve(start).then(function () {
        if (pending !== gapless.preload || token !== trackSwitchToken) { clearOriginalGaplessPreload('mix-stale'); return; }
        audioFadeSerial++;
        if (typeof clearAudioFadeTimers === 'function') clearAudioFadeTimers();
        if (gainNode && audioCtx && gainNode.gain) {
          try { gainNode.gain.cancelScheduledValues(audioCtx.currentTime); } catch (_e) {}
        }
        var started = performance.now(), target = clamp(targetVolume, 0, 1);
        function step(now) {
          if (pending !== gapless.preload || token !== trackSwitchToken) { clearOriginalGaplessPreload('mix-cancel'); return; }
          var t = clamp((now - started) / duration, 0, 1), theta = t * Math.PI * 0.5;
          var outGain = target * Math.cos(theta), inGain = target * Math.sin(theta);
          if (gainNode && gainNode.gain) gainNode.gain.value = outGain; else if (outgoing) outgoing.volume = outGain;
          incoming.volume = inGain;
          if (t < 1) { gapless.frame = requestAnimationFrame(step); return; }
          gapless.frame = 0; pending.adopted = true; gapless.preload = null; gapless.mixing = false;
          Promise.resolve(playQueueAt(pending.index, {
            gaplessHandoff:true, preloadedAudio:incoming, gaplessOutgoingAudio:outgoing,
            preserveHomeState:true, fade:false
          })).catch(function (error) {
            console.warn('[OriginalGapless] handoff failed', error); disposeGaplessMedia(incoming);
          });
        }
        gapless.frame = requestAnimationFrame(step);
      }).catch(function (error) {
        console.warn('[OriginalGapless] play failed', error); clearOriginalGaplessPreload('play-failed');
      });
    } catch (error) {
      console.warn('[OriginalGapless] start failed', error); clearOriginalGaplessPreload('start-failed');
    }
    return true;
  }
  window.playOriginalGaplessNextOnEnded = function (token) {
    var pending = gapless.preload;
    if (!pending || pending.token !== token || pending.index !== currentIdx + 1 || pending.media.readyState < 2) return false;
    return startOriginalGaplessMix(pending, 0.08);
  };
  window.adoptOriginalGaplessAudio = function (incoming, outgoing) {
    if (!incoming) return false;
    try { if (source && source.disconnect) source.disconnect(); } catch (_e) {}
    audio = incoming;
    if (typeof configurePlaybackAudioElement === 'function') configurePlaybackAudioElement(audio);
    if (audioCtx) {
      try {
        source = audioCtx.createMediaElementSource(audio);
        source.connect(analyser); source.connect(beatAnalyser);
      } catch (error) { console.warn('[OriginalGapless] analyser handoff', error); }
    }
    audioReady = true; audio.volume = gainNode ? 1 : clamp(targetVolume, 0, 1);
    if (gainNode && audioCtx && gainNode.gain) {
      try { gainNode.gain.cancelScheduledValues(audioCtx.currentTime); gainNode.gain.setValueAtTime(clamp(targetVolume, 0, 1), audioCtx.currentTime); } catch (_e2) {}
    }
    if (outgoing && outgoing !== incoming) {
      try { outgoing.onended = null; outgoing.pause(); outgoing.removeAttribute('src'); outgoing.load(); } catch (_e3) {}
    }
    return true;
  };

  function bindAll() {
    mergeDefaults();
    ensureOriginalFadeDefaults();
    try {
      var fade = JSON.parse(localStorage.getItem(FADE_STORE_KEY) || '{}');
      if (isFinite(Number(fade.fadeInMs))) AUDIO_FADE_IN_MS = clamp(fade.fadeInMs, 0, 3000);
      if (isFinite(Number(fade.fadeOutMs))) AUDIO_FADE_OUT_MS = clamp(fade.fadeOutMs, 0, 3000);
    } catch (_e) {}
    bindSliders(); bindColors(); bindFades(); refreshOriginalFeatureUi();
    document.addEventListener('seeking', function () { clearOriginalGaplessPreload('seek'); }, true);
  }

  mergeDefaults();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindAll);
  else bindAll();
})();
