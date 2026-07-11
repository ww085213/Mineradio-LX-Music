/**
 * Ground EQ settings — adapted from sonic-topography (Non-Commercial Learning License)
 * https://github.com/yin-yizhen/sonic-topography
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'mineradio-terrain-ground-eq-v1';
  var BAND_COUNT = 8;
  var DEFAULT_EQ_VALUE = 50;
  var DEFAULT_MOTION_SPEED = 50;
  var DEFAULT_AMPLITUDE = 50;
  var DEFAULT_TERRAIN_DENSITY = 42;
  var DEFAULT_FLOATING_BLOCKS_ENABLED = true;
  var DEFAULT_FLOATING_BLOCK_INTENSITY = 55;
  var DEFAULT_FLOATING_BLOCK_MIN_SIZE = 9;
  var DEFAULT_FLOATING_BLOCK_MAX_SIZE = 26;
  var DEFAULT_FLOATING_BLOCK_SPEED = 77;
  var DEFAULT_FLOATING_BLOCK_COUNT = 80;
  var DEFAULT_PLATTER_SPIN = 15;
  var TERRAIN_BASE_SIZE = 168;
  var TERRAIN_MIN_GRID = 96;
  var TERRAIN_MAX_GRID = 224;

  var BAND_IDS = ['subBass', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'brilliance', 'air'];
  var BAND_LABELS = [
    'SUB BASS / 中心抬升',
    'BASS / 低频重量',
    'LOW MID / 慢波流动',
    'MID / 方向流',
    'HIGH MID / 尖峰',
    'PRESENCE / 闪光触发',
    'BRILLIANCE / 边缘微闪',
    'AIR / 空气颗粒'
  ];
  var DEFAULT_BANDS = [90, 92, 50, 50, 50, 50, 50, 48];

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function normBand(v) {
    var n = Number(v);
    return Number.isFinite(n) ? clamp(Math.round(n), 0, 100) : DEFAULT_EQ_VALUE;
  }

  function normMotion(v) {
    var n = Number(v);
    return Number.isFinite(n) ? clamp(Math.round(n), 0, 100) : DEFAULT_MOTION_SPEED;
  }

  function normAmp(v) {
    var n = Number(v);
    return Number.isFinite(n) ? clamp(Math.round(n), 0, 100) : DEFAULT_AMPLITUDE;
  }

  function normDensity(v) {
    var n = Number(v);
    return Number.isFinite(n) ? clamp(Math.round(n), 0, 100) : DEFAULT_TERRAIN_DENSITY;
  }

  function normEnabledBands(v) {
    if (Array.isArray(v) && v.length === BAND_COUNT) {
      return v.map(function (b) { return typeof b === 'boolean' ? b : true; });
    }
    return new Array(BAND_COUNT).fill(true);
  }

  function normalizeSettings(raw) {
    raw = raw || {};
    var src = Array.isArray(raw.bands) ? raw.bands : DEFAULT_BANDS;
    var bands = [];
    for (var i = 0; i < BAND_COUNT; i++) bands.push(normBand(src[i]));
    return {
      bands: bands,
      motionSpeed: normMotion(raw.motionSpeed),
      amplitude: normAmp(raw.amplitude),
      terrainDensity: normDensity(raw.terrainDensity),
      enabledBands: normEnabledBands(raw.enabledBands),
      floatingBlocksEnabled: typeof raw.floatingBlocksEnabled === 'boolean' ? raw.floatingBlocksEnabled : DEFAULT_FLOATING_BLOCKS_ENABLED,
      floatingBlockIntensity: normBand(raw.floatingBlockIntensity != null ? raw.floatingBlockIntensity : DEFAULT_FLOATING_BLOCK_INTENSITY),
      floatingBlockMinSize: normBand(raw.floatingBlockMinSize != null ? raw.floatingBlockMinSize : DEFAULT_FLOATING_BLOCK_MIN_SIZE),
      floatingBlockMaxSize: normBand(raw.floatingBlockMaxSize != null ? raw.floatingBlockMaxSize : DEFAULT_FLOATING_BLOCK_MAX_SIZE),
      floatingBlockSpeed: normBand(raw.floatingBlockSpeed != null ? raw.floatingBlockSpeed : DEFAULT_FLOATING_BLOCK_SPEED),
      floatingBlockCount: clamp(Math.round(Number(raw.floatingBlockCount) || DEFAULT_FLOATING_BLOCK_COUNT), 20, 120),
      platterSpin: normBand(raw.platterSpin != null ? raw.platterSpin : DEFAULT_PLATTER_SPIN)
    };
  }

  function defaults() {
    return normalizeSettings({});
  }

  function readStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return normalizeSettings(raw ? JSON.parse(raw) : undefined);
    } catch (e) {
      return defaults();
    }
  }

  function writeStorage(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
    } catch (e) {}
  }

  function readBandValue(bands, bandId) {
    var idx = BAND_IDS.indexOf(bandId);
    var normalized = normalizeSettings({ bands: bands }).bands;
    return normalized[idx >= 0 ? idx : 0];
  }

  function applyBandValue(value, bands, bandId) {
    var eq = readBandValue(bands, bandId);
    var delta = (eq - DEFAULT_EQ_VALUE) / DEFAULT_EQ_VALUE;
    var v = Number(value) || 0;
    if (delta >= 0) return clamp(v * (1 + delta * 1.8), 0, 1);
    var dull = Math.abs(delta);
    return clamp(Math.max(0, v - dull * 0.35) * (1 - dull * 0.35), 0, 1);
  }

  function deriveGridSettings(terrainDensity, ecoCap) {
    var density = normDensity(terrainDensity);
    var maxGrid = ecoCap ? Math.min(TERRAIN_MAX_GRID, 96) : TERRAIN_MAX_GRID;
    var gridSize = Math.round(TERRAIN_MIN_GRID + ((maxGrid - TERRAIN_MIN_GRID) * density) / 100);
    var spacing = TERRAIN_BASE_SIZE / gridSize;
    return {
      density: density,
      gridSize: gridSize,
      spacing: spacing,
      boxWidth: spacing * (0.9 / 1.05),
      instanceCount: gridSize * gridSize,
      terrainSize: TERRAIN_BASE_SIZE
    };
  }

  var MAX_KICK = 0.75;
  var KICK_GAIN = 0.35;

  function clampBlend(v) {
    return clamp(Number.isFinite(v) ? v : 0, 0, 1);
  }

  function applyKickImpulse(target, strength) {
    var t = Number.isFinite(target) ? target : 0;
    var s = Number.isFinite(strength) ? Math.max(0, strength) : 0;
    return clamp(t + s * KICK_GAIN, 0, MAX_KICK);
  }

  function stepKickDeform(current, target, delta) {
    var d = Math.max(0, Number.isFinite(delta) ? delta : 0);
    var tb = clampBlend(10 * d);
    var cb = clampBlend(18 * d);
    var nextTarget = clamp(target + (0 - target) * tb, 0, MAX_KICK);
    var nextCurrent = clamp(current + (nextTarget - current) * cb, 0, MAX_KICK);
    return { current: nextCurrent, target: nextTarget };
  }

  function deriveKickLowBands(kickEnvelope, subBassEnergy, bassEnergy, bands, enabledBands) {
    var kick = clamp(Number.isFinite(kickEnvelope) ? kickEnvelope : 0, 0, MAX_KICK);
    var nk = kick / MAX_KICK;
    var subE = clamp(Number.isFinite(subBassEnergy) ? subBassEnergy : 0, 0, 1);
    var bassE = clamp(Number.isFinite(bassEnergy) ? bassEnergy : 0, 0, 1);
    var subIn = subE * 0.22 + nk * 1.28;
    var bassIn = bassE * 0.2 + nk * 1.15;
    var subBass = enabledBands[0] ? applyLowBand(subIn, bands, 'subBass', 1.2) : 0;
    var bass = enabledBands[1] ? applyLowBand(bassIn, bands, 'bass', 1.15) : 0;
    return { subBass: clamp(subBass, 0, 1.2), bass: clamp(bass, 0, 1.15) };
  }

  function applyLowBand(value, bands, bandId, max) {
    var eq = readBandValue(bands, bandId);
    var delta = (eq - DEFAULT_EQ_VALUE) / DEFAULT_EQ_VALUE;
    if (delta >= 0) return clamp(value * (1 + delta * 1.8), 0, max);
    var dull = Math.abs(delta);
    return clamp(Math.max(0, value - dull * 0.35) * (1 - dull * 0.35), 0, max);
  }

  global.TerrainGroundEq = {
    STORAGE_KEY: STORAGE_KEY,
    BAND_COUNT: BAND_COUNT,
    BAND_IDS: BAND_IDS,
    BAND_LABELS: BAND_LABELS,
    DEFAULT_EQ_VALUE: DEFAULT_EQ_VALUE,
    defaults: defaults,
    normalize: normalizeSettings,
    read: readStorage,
    write: writeStorage,
    readBandValue: readBandValue,
    applyBandValue: applyBandValue,
    deriveGridSettings: deriveGridSettings,
    clampBlend: clampBlend,
    applyKickImpulse: applyKickImpulse,
    stepKickDeform: stepKickDeform,
    deriveKickLowBands: deriveKickLowBands,
    platterRotationSpeed: function (settings) {
      var spin = normBand((settings && settings.platterSpin != null) ? settings.platterSpin : DEFAULT_PLATTER_SPIN);
      return (spin / 100) * 0.5;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
