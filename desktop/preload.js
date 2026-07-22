const { contextBridge, ipcRenderer } = require('electron');

const PERSISTENT_UI_STATE_KEYS = [
  'apex-player-volume',
  'mineradio-lyric-layout-v1',
  'mineradio-playback-quality-v1',
  'mineradio-audio-effects-v1',
  'mineradio-playback-tuning-v1',
  'mineradio-diy-player-mode-v1',
  'mineradio-playlist-panel-pinned-v1',
  'mineradio-playlist-panel-pinned-v2',
  'mineradio-playlist-panel-position-v1',
  'mineradio-home-playlist-order-v1',
  'mineradio-home-more-playlists-expanded-v1',
  'mineradio-wallpaper-scene-recordings-v1',
  'mineradio-wallpaper-record-fps-v1',
  'mineradio-wallpaper-record-fps-v2',
  'mineradio-user-capsule-auto-hide-v1',
  'mineradio-fx-fab-auto-hide-v1',
  'mineradio-controls-auto-hide-v1',
  'mineradio-ui-motion-v1',
  'mineradio-primary-nav-auto-hide-v1',
  'mineradio-primary-nav-auto-hide-v2',
  'mineradio-primary-nav-auto-hide-v3',
  'mineradio-primary-nav-manual-hidden-v1',
  'mineradio-free-camera-v1',
  'mineradio-local-library-folder-v1',
  'mineradio-local-library-folders-v2',
  'mineradio-hidden-wallpapers-v1',
  'mineradio-favorite-wallpapers-v1',
  'mineradio-last-visual-preset-v1',
  'mineradio-local-user-playlists-v1',
  'mineradio-playlist-custom-covers-v1',
  'mineradio-lx-playlist-song-order-v1',
  'mineradio-playback-session-v1',
  'mineradio-user-fx-archives-v1',
  'mineradio-hotkey-settings-v1',
  'mineradio-visual-guide-seen-v2',
  'mineradio-upload-tip-seen',
];

const JSON_ARRAY_UI_STATE_KEYS = new Set([
  'mineradio-home-playlist-order-v1',
  'mineradio-local-library-folders-v2',
  'mineradio-hidden-wallpapers-v1',
  'mineradio-favorite-wallpapers-v1',
  'mineradio-local-user-playlists-v1',
  'mineradio-user-fx-archives-v1',
]);
const JSON_OBJECT_UI_STATE_KEYS = new Set([
  'mineradio-lyric-layout-v1',
  'mineradio-audio-effects-v1',
  'mineradio-playback-tuning-v1',
  'mineradio-playlist-panel-position-v1',
  'mineradio-wallpaper-scene-recordings-v1',
  'mineradio-free-camera-v1',
  'mineradio-playlist-custom-covers-v1',
  'mineradio-lx-playlist-song-order-v1',
  'mineradio-playback-session-v1',
  'mineradio-hotkey-settings-v1',
]);
const FLAG_UI_STATE_KEYS = new Set([
  'mineradio-diy-player-mode-v1',
  'mineradio-playlist-panel-pinned-v1',
  'mineradio-playlist-panel-pinned-v2',
  'mineradio-home-more-playlists-expanded-v1',
  'mineradio-user-capsule-auto-hide-v1',
  'mineradio-fx-fab-auto-hide-v1',
  'mineradio-controls-auto-hide-v1',
  'mineradio-ui-motion-v1',
  'mineradio-primary-nav-auto-hide-v1',
  'mineradio-primary-nav-auto-hide-v2',
  'mineradio-primary-nav-auto-hide-v3',
  'mineradio-primary-nav-manual-hidden-v1',
  'mineradio-visual-guide-seen-v2',
  'mineradio-upload-tip-seen',
]);
const NUMBER_UI_STATE_KEYS = new Set([
  'apex-player-volume',
  'mineradio-wallpaper-record-fps-v1',
  'mineradio-wallpaper-record-fps-v2',
  'mineradio-last-visual-preset-v1',
]);
const LARGE_UI_STATE_KEYS = new Set([
  'mineradio-lyric-layout-v1',
  'mineradio-wallpaper-scene-recordings-v1',
  'mineradio-local-user-playlists-v1',
  'mineradio-playlist-custom-covers-v1',
  'mineradio-user-fx-archives-v1',
]);
const STARTUP_SAFE_RESET_KEYS = [
  'mineradio-lyric-layout-v1',
  'mineradio-last-visual-preset-v1',
  'mineradio-free-camera-v1',
];
const STARTUP_SAFE_MODE = /(?:\?|&)mineradio-safe-start=1(?:&|$)/.test(String(window.location.search || ''));
const PROFILE_NATIVE_STATE_REPAIR = /(?:\?|&)mineradio-profile-repair=1(?:&|$)/.test(String(window.location.search || ''));
let rendererStartupReportedReady = false;

function sanitizePersistentUiStateValue(key, value) {
  if (!PERSISTENT_UI_STATE_KEYS.includes(key) || typeof value !== 'string') return null;
  const limit = LARGE_UI_STATE_KEYS.has(key) ? 16 * 1024 * 1024 : 512 * 1024;
  if (value.length > limit) return null;
  if (FLAG_UI_STATE_KEYS.has(key)) return /^(?:0|1)$/.test(value) ? value : null;
  if (NUMBER_UI_STATE_KEYS.has(key)) {
    if (!value.trim()) return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    if (key === 'apex-player-volume' && (number < 0 || number > 1)) return null;
    if (/wallpaper-record-fps/.test(key) && (number < 15 || number > 120)) return null;
    if (key === 'mineradio-last-visual-preset-v1' && (number < 0 || number > 12)) return null;
    return value;
  }
  if (key === 'mineradio-playback-quality-v1') {
    return /^(?:standard|high|exhigh|lossless|hires|jymaster|128k|320k|flac|flac24bit)$/.test(value) ? value : null;
  }
  if (JSON_ARRAY_UI_STATE_KEYS.has(key) || JSON_OBJECT_UI_STATE_KEYS.has(key)) {
    try {
      const parsed = JSON.parse(value);
      if (JSON_ARRAY_UI_STATE_KEYS.has(key) && !Array.isArray(parsed)) return null;
      if (JSON_OBJECT_UI_STATE_KEYS.has(key) && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) return null;
      return JSON.stringify(parsed);
    } catch (_error) {
      return null;
    }
  }
  return value.length <= 32768 ? value : null;
}

function applyStartupSafeReset() {
  if (!STARTUP_SAFE_MODE) return;
  const rendererValues = {};
  let totalLength = 0;
  STARTUP_SAFE_RESET_KEYS.forEach((key) => {
    try {
      const value = window.localStorage.getItem(key);
      if (typeof value !== 'string' || value.length > 24 * 1024 * 1024) return;
      if (totalLength + value.length > 32 * 1024 * 1024) return;
      rendererValues[key] = value;
      totalLength += value.length;
    } catch (_error) {}
  });
  let resetResult = null;
  try { resetResult = ipcRenderer.sendSync('mineradio-startup-safe-reset-sync', rendererValues); }
  catch (_error) { resetResult = null; }
  if (!resetResult || !resetResult.ok) {
    try {
      ipcRenderer.send('mineradio-startup-issue', {
        type: 'safe-reset-backup-failed',
        message: String(resetResult && resetResult.error || 'STARTUP_SAFE_RESET_UNAVAILABLE'),
      });
    } catch (_error) {}
    return;
  }
  const backedUpKeys = new Set(Array.isArray(resetResult.backedUpRendererKeys)
    ? resetResult.backedUpRendererKeys
    : []);
  backedUpKeys.forEach((key) => {
    if (!STARTUP_SAFE_RESET_KEYS.includes(key)) return;
    try { window.localStorage.removeItem(key); } catch (_error) {}
  });
}

function applyProfileNativeStateRepair() {
  if (!PROFILE_NATIVE_STATE_REPAIR) return;
  const key = 'mineradio-lyric-layout-v1';
  let original = null;
  try { original = window.localStorage.getItem(key); } catch (_error) { return; }
  let backupResult = null;
  try {
    backupResult = ipcRenderer.sendSync(
      'mineradio-profile-native-state-repair-backup-sync',
      original,
    );
  } catch (_error) { backupResult = null; }
  if (!backupResult || !backupResult.ok || backupResult.pending === false) return;
  try {
    if (original != null) {
      const parsed = JSON.parse(original);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('PROFILE_LAYOUT_INVALID');
      parsed.wallpaperMode = false;
      parsed.desktopLyrics = false;
      window.localStorage.setItem(key, JSON.stringify(parsed));
    }
  } catch (_error) {
    try { window.localStorage.removeItem(key); } catch (_removeError) { return; }
  }
  try {
    ipcRenderer.sendSync('mineradio-profile-native-state-repair-complete-sync', backupResult.token);
  } catch (_error) {}
}

function restorePersistentUiState() {
  try {
    const values = ipcRenderer.sendSync('mineradio-ui-state-read-sync') || {};
    PERSISTENT_UI_STATE_KEYS.forEach((key) => {
      const existing = window.localStorage.getItem(key);
      if (existing != null) {
        const limit = LARGE_UI_STATE_KEYS.has(key) ? 16 * 1024 * 1024 : 512 * 1024;
        // Keep an existing oversized value in its original Chromium profile.
        // It is skipped for synchronous backup, not treated as corruption.
        if (existing.length > limit) return;
        const sanitizedExisting = sanitizePersistentUiStateValue(key, existing);
        if (sanitizedExisting != null) {
          if (sanitizedExisting !== existing) window.localStorage.setItem(key, sanitizedExisting);
          return;
        }
        window.localStorage.removeItem(key);
      }
      if (STARTUP_SAFE_MODE) return;
      const sanitizedBackup = sanitizePersistentUiStateValue(key, values[key]);
      if (sanitizedBackup != null) window.localStorage.setItem(key, sanitizedBackup);
    });
  } catch (_e) {}
}

applyProfileNativeStateRepair();
applyStartupSafeReset();
restorePersistentUiState();

contextBridge.exposeInMainWorld('desktopWindow', {
  isDesktop: true,
  minimize: () => ipcRenderer.invoke('desktop-window-minimize'),
  toggleMaximize: () => ipcRenderer.invoke('desktop-window-toggle-maximize'),
  toggleFullscreen: () => ipcRenderer.invoke('desktop-window-toggle-fullscreen'),
  exitFullscreenWindowed: () => ipcRenderer.invoke('desktop-window-exit-fullscreen-windowed'),
  getState: () => ipcRenderer.invoke('desktop-window-get-state'),
  toggleDesktopInteraction: () => ipcRenderer.invoke('desktop-window-toggle-desktop-interaction'),
  close: () => ipcRenderer.invoke('desktop-window-close'),
  beginWindowDrag: () => ipcRenderer.invoke('desktop-window-drag-state', true),
  endWindowDrag: () => ipcRenderer.invoke('desktop-window-drag-state', false),
  beginWindowResize: (direction, screenX, screenY) => ipcRenderer.send('desktop-window-resize-start', { direction, screenX, screenY }),
  updateWindowResize: (screenX, screenY) => ipcRenderer.send('desktop-window-resize-update', { screenX, screenY }),
  endWindowResize: () => ipcRenderer.send('desktop-window-resize-end'),
  getTraySettings: () => ipcRenderer.invoke('mineradio-tray-get-settings'),
  setCloseToTray: (enabled) => ipcRenderer.invoke('mineradio-tray-set-close-to-tray', !!enabled),
  setStartupEnabled: (enabled) => ipcRenderer.invoke('mineradio-startup-set-enabled', !!enabled),
  updateTrayPlayback: (state) => ipcRenderer.invoke('mineradio-tray-update-playback', state || {}),
  onTrayCommand: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('mineradio-tray-command', listener);
    return () => ipcRenderer.removeListener('mineradio-tray-command', listener);
  },
  openUpdateInstaller: (filePath) => ipcRenderer.invoke('mineradio-open-update-installer', filePath),
  restartApp: () => ipcRenderer.invoke('mineradio-restart-app'),
  openLxScheme: (schemeUrl) => ipcRenderer.invoke('mineradio-lx-open-scheme', schemeUrl),
  setLxPlaybackLinked: (linked) => ipcRenderer.invoke('mineradio-lx-set-linked', !!linked),
  configureGlobalHotkeys: (bindings) => ipcRenderer.invoke('mineradio-hotkeys-configure-global', bindings || []),
  exportJsonFile: (payload) => ipcRenderer.invoke('mineradio-export-json-file', payload || {}),
  importJsonFile: () => ipcRenderer.invoke('mineradio-import-json-file'),
  backupUiState: (patch) => ipcRenderer.invoke('mineradio-ui-state-write', patch || {}),
  reportStartupReady: (payload) => {
    rendererStartupReportedReady = true;
    ipcRenderer.send('mineradio-startup-ready', {
      ...(payload || {}),
      safeMode: STARTUP_SAFE_MODE,
    });
  },
  reportStartupIssue: (payload) => ipcRenderer.send('mineradio-startup-issue', payload || {}),
  chooseLocalMusicFiles: () => ipcRenderer.invoke('mineradio-local-music-choose-files'),
  chooseLocalMusicFolder: () => ipcRenderer.invoke('mineradio-local-music-choose-folder'),
  chooseLocalCoverFile: () => ipcRenderer.invoke('mineradio-local-cover-choose-file'),
  chooseLocalLyricFile: () => ipcRenderer.invoke('mineradio-local-lyric-choose-file'),
  scanLocalMusicFolder: (folderPath) => ipcRenderer.invoke('mineradio-local-music-scan-folder', folderPath),
  refreshLocalMusicFiles: (folderPath, files) => ipcRenderer.invoke('mineradio-local-music-refresh-entries', folderPath, files || []),
  prepareLocalAudio: (filePath) => ipcRenderer.invoke('mineradio-local-audio-prepare', filePath),
  prepareWallpaperCapture: (payload) => ipcRenderer.invoke('mineradio-wallpaper-capture-prepare', payload || {}),
  finishWallpaperCapture: () => ipcRenderer.invoke('mineradio-wallpaper-capture-finish'),
  transcodeLocalAudio: (filePath) => ipcRenderer.invoke('mineradio-local-audio-transcode', filePath),
  readLocalFileRange: (filePath, start, end) => ipcRenderer.invoke('mineradio-local-file-read-range', filePath, start, end),
  readLocalFileDataUrl: (filePath) => ipcRenderer.invoke('mineradio-local-file-read-data-url', filePath),
  onGlobalHotkey: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('mineradio-global-hotkey', listener);
    return () => ipcRenderer.removeListener('mineradio-global-hotkey', listener);
  },
  setDesktopLyricsEnabled: (enabled, payload) => ipcRenderer.invoke('mineradio-desktop-lyrics-set-enabled', !!enabled, payload || {}),
  updateDesktopLyrics: (payload) => ipcRenderer.invoke('mineradio-desktop-lyrics-update', payload || {}),
  onDesktopLyricsLockState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('mineradio-desktop-lyrics-lock-state', listener);
    return () => ipcRenderer.removeListener('mineradio-desktop-lyrics-lock-state', listener);
  },
  onDesktopLyricsEnabledState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('mineradio-desktop-lyrics-enabled-state', listener);
    return () => ipcRenderer.removeListener('mineradio-desktop-lyrics-enabled-state', listener);
  },
  onDesktopLyricsSizeState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('mineradio-desktop-lyrics-size-state', listener);
    return () => ipcRenderer.removeListener('mineradio-desktop-lyrics-size-state', listener);
  },
  setWallpaperMode: (enabled, payload) => ipcRenderer.invoke('mineradio-wallpaper-set-enabled', !!enabled, payload || {}),
  updateWallpaperMode: (payload) => ipcRenderer.invoke('mineradio-wallpaper-update', payload || {}),
  onWallpaperCommand: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('mineradio-wallpaper-command', listener);
    return () => ipcRenderer.removeListener('mineradio-wallpaper-command', listener);
  },
  onStateChange: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop-window-state', listener);
    return () => ipcRenderer.removeListener('desktop-window-state', listener);
  },
});

window.addEventListener('error', (event) => {
  if (rendererStartupReportedReady) return;
  // Capture-phase `error` also fires for images, fonts and other resources.
  // Those failures are non-fatal and must not be recorded as renderer crashes.
  if (event && event.target && event.target !== window && !event.error) return;
  try {
    ipcRenderer.send('mineradio-startup-issue', {
      type: 'error',
      message: String(event && event.message || 'Renderer error').slice(0, 600),
      filename: String(event && event.filename || '').slice(-240),
      line: Number(event && event.lineno) || 0,
      column: Number(event && event.colno) || 0,
    });
  } catch (_error) {}
}, true);

window.addEventListener('unhandledrejection', (event) => {
  if (rendererStartupReportedReady) return;
  try {
    const reason = event && event.reason;
    ipcRenderer.send('mineradio-startup-issue', {
      type: 'unhandledrejection',
      message: String(reason && (reason.stack || reason.message) || reason || 'Unhandled rejection').slice(0, 1200),
    });
  } catch (_error) {}
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('desktop-shell-root');
  document.body.classList.add('desktop-shell');
});
