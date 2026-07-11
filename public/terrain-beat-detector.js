/**
 * Beat detector + kick envelope — adapted from sonic-topography (Non-Commercial Learning License)
 */
(function (global) {
  'use strict';

  var BEAT_WINDOWS = [
    { name: 'Deep', start: 0, end: 2 },
    { name: 'Classic', start: 1, end: 4 },
    { name: 'Punch', start: 2, end: 6 },
    { name: 'Wide', start: 0, end: 7 }
  ];
  var FLUX_HISTORY_SIZE = 90;
  var WINDOW_SCORE_DECAY = 0.965;
  var FLUX_SMOOTHING = 0.35;
  var COOLDOWN_SECONDS = 0.12;
  var SONIC_BIN_COUNT = 512;

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function blendForRate(rate, deltaSeconds) {
    var safeDelta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
    return clamp(1 - Math.exp(-rate * safeDelta), 0, 1);
  }

  function scaleBin(sonicBin, binCount) {
    return Math.min(Math.max(0, binCount - 1), Math.round(sonicBin * binCount / SONIC_BIN_COUNT));
  }

  function createKickEnvelopeState() {
    return { noiseFloor: 0, kickLevel: 0, kickOnset: 0, kickEnvelope: 0 };
  }

  function stepKickEnvelope(state, rawKickLevel, onset, deltaSeconds) {
    var safeRaw = clamp(Number.isFinite(rawKickLevel) ? rawKickLevel : 0, 0, 1);
    var floorRate = safeRaw > state.noiseFloor ? 1.15 : 0.35;
    var noiseFloor = state.noiseFloor + (safeRaw - state.noiseFloor) * blendForRate(floorRate, deltaSeconds);
    var kickLevel = clamp(safeRaw - noiseFloor - 0.025, 0, 1);
    var breathTarget = Math.min(0.11, kickLevel * 0.18);
    var onsetTarget = onset ? Math.max(0.48, kickLevel * 0.95) : 0;
    var targetEnvelope = Math.max(breathTarget, onsetTarget);
    var envelopeRate = targetEnvelope > state.kickEnvelope ? 42 : 11.5;
    var kickEnvelope = Math.max(
      breathTarget,
      state.kickEnvelope + (targetEnvelope - state.kickEnvelope) * blendForRate(envelopeRate, deltaSeconds)
    );
    return {
      noiseFloor: noiseFloor,
      kickLevel: kickLevel,
      kickOnset: onset ? 1 : 0,
      kickEnvelope: clamp(kickEnvelope, 0, 1)
    };
  }

  function createBeatDetectorState() {
    return {
      activeWindowIndex: 1,
      windowScores: new Array(BEAT_WINDOWS.length).fill(0),
      previousWindowLevels: new Array(BEAT_WINDOWS.length).fill(0),
      fluxHistory: new Array(FLUX_HISTORY_SIZE).fill(0),
      fluxHistoryIndex: 0,
      smoothedFlux: 0,
      previousSmoothedFlux: 0,
      cooldownRemaining: 0,
      kickEnvelopeState: createKickEnvelopeState()
    };
  }

  function readWindowLevel(frequencyData, window, binCount) {
    var start = scaleBin(window.start, binCount);
    var end = scaleBin(window.end, binCount);
    if (end < start) end = start;
    var weighted = 0;
    var weightTotal = 0;
    var center = (start + end) / 2;
    var halfWidth = Math.max(1, (end - start + 1) / 2);
    for (var bin = start; bin <= end; bin++) {
      var distance = Math.abs(bin - center);
      var weight = 0.35 + 0.65 * (1 - Math.min(1, distance / halfWidth));
      weighted += (frequencyData[bin] / 255) * weight;
      weightTotal += weight;
    }
    return weightTotal > 0 ? weighted / weightTotal : 0;
  }

  function fluxStats(history) {
    var avg = 0;
    for (var i = 0; i < history.length; i++) avg += history[i];
    avg /= Math.max(1, history.length);
    var variance = 0;
    for (var j = 0; j < history.length; j++) variance += Math.pow(history[j] - avg, 2);
    variance /= Math.max(1, history.length);
    return { avg: avg, stdDev: Math.sqrt(variance) };
  }

  function stepBeatDetector(state, frequencyData, deltaSeconds, binCount) {
    var safeDelta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
    var windowLevels = BEAT_WINDOWS.map(function (w) {
      return readWindowLevel(frequencyData, w, binCount);
    });
    var nextScores = state.windowScores.map(function (score, index) {
      var flux = Math.max(0, windowLevels[index] - state.previousWindowLevels[index]);
      var windowWidth = scaleBin(BEAT_WINDOWS[index].end, binCount) - scaleBin(BEAT_WINDOWS[index].start, binCount) + 1;
      var focusBonus = 1 / Math.sqrt(Math.max(1, windowWidth));
      return score * WINDOW_SCORE_DECAY + flux * focusBonus;
    });
    var activeWindowIndex = state.activeWindowIndex;
    for (var i = 0; i < nextScores.length; i++) {
      if (nextScores[i] > nextScores[activeWindowIndex] * 1.03) activeWindowIndex = i;
    }
    var rawFlux = Math.max(0, windowLevels[activeWindowIndex] - state.previousWindowLevels[activeWindowIndex]);
    var smoothedFlux = state.smoothedFlux + (rawFlux - state.smoothedFlux) * FLUX_SMOOTHING;
    var stats = fluxStats(state.fluxHistory);
    var threshold = Math.max(0.028, stats.avg + stats.stdDev * 1.8);
    var cooldownRemaining = Math.max(0, state.cooldownRemaining - safeDelta);
    var isPeak = state.previousSmoothedFlux > threshold
      && state.previousSmoothedFlux >= smoothedFlux
      && state.previousSmoothedFlux >= 0.045;
    var onset = cooldownRemaining <= 0 && isPeak;
    var nextHistory = state.fluxHistory.slice();
    nextHistory[state.fluxHistoryIndex] = smoothedFlux;
    var nextHistoryIndex = (state.fluxHistoryIndex + 1) % nextHistory.length;
    var nextEnvelope = stepKickEnvelope(
      state.kickEnvelopeState,
      windowLevels[activeWindowIndex],
      onset,
      safeDelta || 1 / 60
    );
    return {
      state: {
        activeWindowIndex: activeWindowIndex,
        windowScores: nextScores,
        previousWindowLevels: windowLevels,
        fluxHistory: nextHistory,
        fluxHistoryIndex: nextHistoryIndex,
        smoothedFlux: smoothedFlux,
        previousSmoothedFlux: smoothedFlux,
        cooldownRemaining: onset ? COOLDOWN_SECONDS : cooldownRemaining,
        kickEnvelopeState: nextEnvelope
      },
      kickEnvelope: nextEnvelope.kickEnvelope,
      kickOnset: onset ? 1 : 0
    };
  }

  global.TerrainBeatDetector = {
    createBeatDetectorState: createBeatDetectorState,
    stepBeatDetector: stepBeatDetector,
    scaleBin: scaleBin,
    SONIC_BIN_COUNT: SONIC_BIN_COUNT
  };
})(typeof window !== 'undefined' ? window : globalThis);
