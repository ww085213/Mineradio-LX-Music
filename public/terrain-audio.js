/**
 * Terrain audio analyzer — adapted from sonic-topography (Non-Commercial Learning License)
 * https://github.com/yin-yizhen/sonic-topography
 */
(function (global) {
  'use strict';

  var G = global.TerrainGroundEq;
  var BD = global.TerrainBeatDetector;

  function TriggerConfig(action) {
    this.action = action;
    this.enabled = true;
    this.mode = 'Auto Beat';
    this.sensitivity = 0.15;
    this.cooldown = 60;
    this.pulseStrength = 0.2;
    this.beatHold = 0;
    this.fluxHistory = new Array(40).fill(0);
    this.fluxHistoryIndex = 0;
    this.smoothedFlux = 0;
    this.prevSmoothedFlux = 0;
    this.sonicBandStart = 0;
    this.sonicBandEnd = 16;
    if (action === 'Pulse') {
      this.sonicBandStart = 1;
      this.sonicBandEnd = 2;
      this.sensitivity = 0.85;
      this.cooldown = 15;
    } else if (action === 'Meteor') {
      this.sonicBandStart = 159;
      this.sonicBandEnd = 174;
      this.sensitivity = 0.45;
      this.cooldown = 241;
      this.pulseStrength = 0.5;
    } else if (action === 'Snare') {
      this.sonicBandStart = 47;
      this.sonicBandEnd = 120;
      this.sensitivity = 0.6;
      this.cooldown = 30;
      this.pulseStrength = 0.3;
    }
  }

  TriggerConfig.prototype.getRange = function (binCount) {
    if (!BD) return [0, Math.min(16, binCount - 1)];
    return [
      BD.scaleBin(this.sonicBandStart, binCount),
      BD.scaleBin(this.sonicBandEnd, binCount)
    ];
  };

  function TerrainAudioAnalyzer() {
    this.prevData = new Float32Array(1024);
    this.smoothed = {
      bass: 0, mid: 0, treble: 0, energy: 0,
      subBass: 0, lowMid: 0, highMid: 0, presence: 0, brilliance: 0, air: 0,
      warmth: 0, brightness: 0, sharpness: 0, smoothness: 0, density: 0, spectralCentroid: 0,
      kickEnvelope: 0
    };
    this.prevBrightness = 0;
    this.visualReleaseUntil = 0;
    this.pulseTrigger = new TriggerConfig('Pulse');
    this.meteorTrigger = new TriggerConfig('Meteor');
    this.snareTrigger = new TriggerConfig('Snare');
    this.onTrigger = null;
    this.beatDetectorState = BD ? BD.createBeatDetectorState() : null;
  }

  TerrainAudioAnalyzer.prototype.beginVisualRelease = function (sec) {
    this.visualReleaseUntil = performance.now() + (sec || 1.6) * 1000;
  };

  TerrainAudioAnalyzer.prototype.evaluateTrigger = function (cfg, fluxScore, isPlaying) {
    if (!cfg.enabled || !isPlaying) return;
    cfg.smoothedFlux += (fluxScore - cfg.smoothedFlux) * 0.4;
    cfg.fluxHistory[cfg.fluxHistoryIndex] = cfg.smoothedFlux;
    cfg.fluxHistoryIndex = (cfg.fluxHistoryIndex + 1) % cfg.fluxHistory.length;
    var avgFlux = 0;
    for (var i = 0; i < cfg.fluxHistory.length; i++) avgFlux += cfg.fluxHistory[i];
    avgFlux /= cfg.fluxHistory.length;
    var fluxVariance = 0;
    for (var j = 0; j < cfg.fluxHistory.length; j++) {
      fluxVariance += Math.pow(cfg.fluxHistory[j] - avgFlux, 2);
    }
    fluxVariance /= cfg.fluxHistory.length;
    var fluxStdDev = Math.sqrt(fluxVariance);
    var thresholdMultiplier = Math.max(0.1, 5.0 - cfg.sensitivity * 4.0);
    var adaptiveThreshold = Math.max(0.01, avgFlux + fluxStdDev * thresholdMultiplier);
    var isPeak = cfg.prevSmoothedFlux > adaptiveThreshold && cfg.prevSmoothedFlux >= cfg.smoothedFlux;
    if (cfg.beatHold > 0) {
      cfg.beatHold--;
    } else if (isPeak && cfg.prevSmoothedFlux - cfg.smoothedFlux > 0.0001) {
      var strength = cfg.prevSmoothedFlux * 30.0 * cfg.pulseStrength;
      if (strength > 0.08 && this.onTrigger) {
        this.onTrigger(strength, 'Kick', cfg.action);
      }
      cfg.beatHold = cfg.cooldown;
    }
    cfg.prevSmoothedFlux = cfg.smoothedFlux;
  };

  TerrainAudioAnalyzer.prototype.sumBand = function (frequencyData, sonicStart, sonicEnd, binCount) {
    if (!BD) return { sum: 0, count: 1 };
    var start = BD.scaleBin(sonicStart, binCount);
    var end = BD.scaleBin(sonicEnd, binCount);
    if (end < start) end = start;
    var sum = 0;
    for (var i = start; i <= end; i++) sum += frequencyData[i] / 255;
    return { sum: sum, count: end - start + 1 };
  };

  TerrainAudioAnalyzer.prototype.step = function (opts) {
    opts = opts || {};
    var frequencyData = opts.frequencyData;
    var playing = !!opts.playing;
    var dt = Math.max(0, Number(opts.dt) || 0.016);
    var binCount = frequencyData ? frequencyData.length : 0;
    if (!binCount) return this.smoothed;

    var isVisualReleasing = performance.now() < this.visualReleaseUntil;
    var energySum = 0;
    var centroidNum = 0;
    var centroidDen = 0;
    var jumpVolatilitySum = 0;
    var fluxPulse = 0;
    var fluxMeteor = 0;
    var fluxSnare = 0;
    var pulseRange = this.pulseTrigger.getRange(binCount);
    var meteorRange = this.meteorTrigger.getRange(binCount);
    var snareRange = this.snareTrigger.getRange(binCount);

    var subBand = this.sumBand(frequencyData, 0, 1, binCount);
    var bassBand = this.sumBand(frequencyData, 2, 3, binCount);
    var lowMidBand = this.sumBand(frequencyData, 4, 7, binCount);
    var midBand = this.sumBand(frequencyData, 8, 18, binCount);
    var highMidBand = this.sumBand(frequencyData, 19, 46, binCount);
    var presenceBand = this.sumBand(frequencyData, 47, 93, binCount);
    var brillianceBand = this.sumBand(frequencyData, 94, 186, binCount);
    var airBand = this.sumBand(frequencyData, 187, 372, binCount);

    if (playing) {
      for (var i = 0; i < binCount; i++) {
        var val = frequencyData[i] / 255;
        energySum += val;
        centroidNum += i * val;
        centroidDen += val;
        var prevVal = this.prevData[i] || 0;
        jumpVolatilitySum += Math.abs(val - prevVal);
        var diff = val - prevVal;
        if (diff > 0.01) {
          if (i >= pulseRange[0] && i <= pulseRange[1]) fluxPulse += diff;
          if (i >= snareRange[0] && i <= snareRange[1]) fluxSnare += diff;
          if (i >= meteorRange[0] && i <= meteorRange[1]) fluxMeteor += diff;
        }
        this.prevData[i] = val;
      }
      var pulseBins = Math.max(1, pulseRange[1] - pulseRange[0] + 1);
      var snareBins = Math.max(1, snareRange[1] - snareRange[0] + 1);
      var meteorBins = Math.max(1, meteorRange[1] - meteorRange[0] + 1);
      this.evaluateTrigger(this.pulseTrigger, fluxPulse / pulseBins, playing);
      this.evaluateTrigger(this.snareTrigger, fluxSnare / snareBins, playing);
      this.evaluateTrigger(this.meteorTrigger, fluxMeteor / meteorBins, playing);
    } else {
      for (var k = 0; k < binCount; k++) {
        this.prevData[k] = isVisualReleasing ? this.prevData[k] * 0.94 : 0;
      }
    }

    var energy = energySum / Math.max(1, binCount);
    var subBass = subBand.sum / Math.max(1, subBand.count);
    var bass = bassBand.sum / Math.max(1, bassBand.count);
    var lowMid = lowMidBand.sum / Math.max(1, lowMidBand.count);
    var mid = midBand.sum / Math.max(1, midBand.count);
    var highMid = highMidBand.sum / Math.max(1, highMidBand.count);
    var presence = presenceBand.sum / Math.max(1, presenceBand.count);
    var brilliance = brillianceBand.sum / Math.max(1, brillianceBand.count);
    var air = airBand.sum / Math.max(1, airBand.count);
    var oldBass = (subBand.sum + bassBand.sum + lowMidBand.sum) / Math.max(1, subBand.count + bassBand.count + lowMidBand.count);
    var oldMid = (midBand.sum + highMidBand.sum) / Math.max(1, midBand.count + highMidBand.count);
    var oldTreble = (presenceBand.sum + brillianceBand.sum + airBand.sum) / Math.max(1, presenceBand.count + brillianceBand.count + airBand.count);
    var warmth = energySum > 0 ? (subBand.sum + bassBand.sum + lowMidBand.sum + midBand.sum) / energySum : 0;
    var brightness = energySum > 0 ? (presenceBand.sum + brillianceBand.sum + airBand.sum) / energySum : 0;
    var sharpness = Math.max(0, brightness - this.prevBrightness) * 10;
    this.prevBrightness = brightness;
    var smoothnessVal = Math.max(0, 1.0 - (jumpVolatilitySum / Math.max(1, binCount)) * 2.0);
    var activeThreshold = energy * 1.5;
    var activeBands = 0;
    if (subBass > activeThreshold) activeBands++;
    if (bass > activeThreshold) activeBands++;
    if (lowMid > activeThreshold) activeBands++;
    if (mid > activeThreshold) activeBands++;
    if (highMid > activeThreshold) activeBands++;
    if (presence > activeThreshold) activeBands++;
    if (brilliance > activeThreshold) activeBands++;
    if (air > activeThreshold) activeBands++;
    var density = activeBands / 8;
    var spectralCentroid = centroidDen > 0 ? centroidNum / centroidDen : 0;

    var kickEnvelope = 0;
    if (BD && this.beatDetectorState && playing) {
      var beatOut = BD.stepBeatDetector(this.beatDetectorState, frequencyData, dt, binCount);
      this.beatDetectorState = beatOut.state;
      kickEnvelope = beatOut.kickEnvelope;
    }

    var blend = playing && energySum > 0 ? 0.15 : (isVisualReleasing ? 0.035 : 0.08);
    var s = this.smoothed;
    s.bass += (oldBass - s.bass) * blend;
    s.mid += (oldMid - s.mid) * blend;
    s.treble += (oldTreble - s.treble) * blend;
    s.energy += (energy - s.energy) * blend;
    s.subBass += (subBass - s.subBass) * blend;
    s.lowMid += (lowMid - s.lowMid) * blend;
    s.highMid += (highMid - s.highMid) * blend;
    s.presence += (presence - s.presence) * blend;
    s.brilliance += (brilliance - s.brilliance) * blend;
    s.air += (air - s.air) * blend;
    s.warmth += (warmth - s.warmth) * blend;
    s.brightness += (brightness - s.brightness) * blend;
    s.sharpness += (sharpness - s.sharpness) * blend;
    s.smoothness += (smoothnessVal - s.smoothness) * blend;
    s.density += (density - s.density) * blend;
    s.spectralCentroid += (spectralCentroid - s.spectralCentroid) * blend;
    s.kickEnvelope = kickEnvelope;
    return s;
  };

  global.TerrainAudioAnalyzer = TerrainAudioAnalyzer;
})(typeof window !== 'undefined' ? window : globalThis);
