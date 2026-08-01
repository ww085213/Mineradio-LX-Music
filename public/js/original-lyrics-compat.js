(function () {
  'use strict';

  // The legacy single-file build creates its first lyric group before the
  // modular renderer is loaded. Dispose that group so the original renderer
  // can take ownership without leaving an orphaned Three.js layer behind.
  if (typeof disposeLyricsParticles === 'function') {
    try { disposeLyricsParticles(); } catch (_error) {}
  }

  if (typeof window.CUSTOM_LYRIC_FONT_STORE_KEY === 'undefined') {
    window.CUSTOM_LYRIC_FONT_STORE_KEY = 'mineradio-custom-lyric-fonts-v1';
  }
  if (typeof window.CUSTOM_LYRIC_FONT_MAX_COUNT === 'undefined') {
    window.CUSTOM_LYRIC_FONT_MAX_COUNT = 6;
  }
  if (!Array.isArray(window.customLyricFonts)) window.customLyricFonts = [];
  if (!Array.isArray(window.lyricsTranslationLines)) window.lyricsTranslationLines = [];
  if (typeof window.lyricsTranslationSource === 'undefined') window.lyricsTranslationSource = 'merged';

  // This build stores translated text directly on each primary lyric line.
  // The original renderer calls the shared normalizer, so expose the same
  // contract without replacing the existing lyric parser.
  window.normalizeLyricTranslationText = function (text) {
    text = typeof normalizeStageLyricText === 'function'
      ? normalizeStageLyricText(text)
      : String(text || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (typeof isNoLyricText === 'function' && isNoLyricText(text)) return '';
    return text;
  };
})();
