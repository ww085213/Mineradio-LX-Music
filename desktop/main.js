const { app, BrowserWindow, ipcMain, shell, screen, globalShortcut, dialog, Tray, Menu, nativeImage, desktopCapturer, session, protocol, clipboard } = require('electron');
const net = require('net');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const appMemory = require('./app-memory');
const systemMemory = require('./system-memory');
const { createDirectLocalProxy } = require('./direct-local-proxy');
const {
  WallpaperEngineLibrary,
  registerWallpaperEngineScheme,
} = require('./wallpaper-engine-library');
const { WallpaperEngineRuntime } = require('./wallpaper-engine-runtime');
const { FullDesktopModeRuntime } = require('./full-desktop-mode-runtime');

registerWallpaperEngineScheme(protocol);

let mainWindow = null;
let mainWindowDesktopEmbedded = false;
let mainWindowDesktopInteractive = false;
let fullDesktopModeRuntime = null;
// A native SetParent/style command can fail after it has already changed part
// of the HWND state. While uncertain, never trust the JS flag to skip detach.
let mainWindowDesktopEmbeddingUncertain = false;
let mainWindowPreDesktopBounds = null;
let mainWindowPreDesktopState = null;
let localServer = null;
let directLocalProxy = null;
let networkSplitEnabled = true;
let networkSplitApplyPromise = Promise.resolve();
let networkSplitSettingsWatcherStarted = false;
let mainServerPort = 0;
let desktopLyricsWindow = null;
let desktopLyricsState = {};
let desktopLyricsUserBounds = null;
let desktopLyricsProgrammaticMove = false;
let desktopLyricsPointerCapture = false;
let desktopLyricsMouseIgnored = null;
let desktopLyricsMousePoller = null;
let desktopLyricsMousePollerBuffer = '';
let desktopLyricsHotBounds = null;
let desktopLyricsLastMiddleAt = 0;
let wallpaperWindow = null;
let wallpaperState = {};
let preferredDisplayMediaSourceId = '';
let preferredDisplayMediaSourceTitle = '';
let htmlFullscreenActive = false;
let windowFullscreenActive = false;
let mainWindowPreFullscreenBounds = null;
let mainWindowStateTimer = null;
let mainWindowBoundsSaveTimer = null;
let mainWindowSplashWatchdogTimer = null;
let mainWindowStartupReady = false;
let mainWindowStartupRecoveryAttempted = false;
let mainWindowStartupRecoveryStage = 0;
let mainWindowStartupRecoveryPromise = null;
let mainWindowStartupSafeMode = false;
let profileNativeStartupRepairPending = false;
let mainWindowShowFallbackTimer = null;
let appMemoryTrimTimer = null;
let appMemoryTrimInFlight = false;
let lastAppMemoryTrimAt = 0;
let lastAppMemoryTrimReason = '';
let memoryAutoTimer = null;
let memoryAutoState = {
  appTrimEnabled: true,
  backgroundTrimEnabled: true,
  enabled: false,
  mask: systemMemory.MEMORY_MASK_DEFAULT,
  intervalMin: 30,
  thresholdPercent: 78,
  autoElevate: false,
  lastRunAt: 0,
  lastReason: '',
  lastResult: null,
  lastError: '',
};
let tray = null;
let trayRightClickGuardUntil = 0;
let trayPlaybackState = { title: '', artist: '', playing: false, volume: 80 };
let trayCreateRetryTimer = null;
let trayCreateAttempts = 0;
let closeToTrayEnabled = true;
let appQuitting = false;
let mainWindowClosePersisting = false;
let lxPlaybackLinked = false;
let lxPauseBeforeQuitDone = false;
const registeredGlobalHotkeys = new Map();
const DESKTOP_INTERACTION_FALLBACK_HOTKEYS = ['Control+Shift+M', 'Alt+Shift+M', 'Control+Alt+M'];
let desktopInteractionHotkeyBusy = false;
const authorizedLocalMusicRoots = new Set();
const mainWindowResizeStates = new Map();

async function pauseLinkedLxPlayback() {
  if (!lxPlaybackLinked) return true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch('http://127.0.0.1:23330/pause', {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    return response.ok;
  } catch (_err) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function collectAppTrimPids() {
  const pids = new Set([process.pid]);
  try {
    app.getAppMetrics().forEach((row) => {
      if (row && Number.isFinite(Number(row.pid))) pids.add(Math.round(Number(row.pid)));
    });
  } catch (_error) {}
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      const pid = win.webContents && win.webContents.getOSProcessId();
      if (pid) pids.add(pid);
    } catch (_error) {}
  });
  return Array.from(pids);
}

function isMainWindowForegroundVisible() {
  try {
    return !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized());
  } catch (_error) {
    return false;
  }
}

async function trimAppMemoryNow(reason = 'renderer') {
  if (appMemoryTrimInFlight) return { ok:false, skipped:true, reason:'in-flight' };
  if (isMainWindowForegroundVisible() && reason !== 'manual-force') {
    return { ok:false, skipped:true, reason:'foreground-visible' };
  }
  appMemoryTrimInFlight = true;
  lastAppMemoryTrimAt = Date.now();
  lastAppMemoryTrimReason = String(reason || 'renderer');
  try {
    const before = appMemory.getMemorySnapshot();
    const trim = await appMemory.trimAppWorkingSets(collectAppTrimPids());
    const after = appMemory.getMemorySnapshot();
    return { ok:trim.ok !== false, reason:lastAppMemoryTrimReason, before, trim, after };
  } catch (error) {
    return { ok:false, reason:lastAppMemoryTrimReason, error:error.message || 'APP_MEMORY_TRIM_FAILED' };
  } finally {
    appMemoryTrimInFlight = false;
  }
}

function scheduleAppMemoryTrim(reason, delay = 2200) {
  if (process.platform !== 'win32') return;
  if (memoryAutoState.appTrimEnabled === false || memoryAutoState.backgroundTrimEnabled === false) return;
  if (Date.now() - lastAppMemoryTrimAt < 120000) return;
  if (appMemoryTrimTimer) clearTimeout(appMemoryTrimTimer);
  appMemoryTrimTimer = setTimeout(() => {
    appMemoryTrimTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isMinimized() && mainWindow.isVisible()) return;
    trimAppMemoryNow(reason).catch(() => {});
  }, Math.max(1200, Number(delay) || 2200));
}

function normalizeMemoryAutoState(payload = {}) {
  const systemEnabled = systemMemory.SYSTEM_PURGE_AVAILABLE === true && systemMemory.SYSTEM_PURGE_ENABLED === true;
  return {
    appTrimEnabled: payload.appTrimEnabled !== false,
    backgroundTrimEnabled: payload.backgroundTrimEnabled !== false,
    enabled: systemEnabled && payload.enabled === true,
    mask: systemMemory.normalizeMask(payload.mask != null ? payload.mask : memoryAutoState.mask),
    intervalMin: Math.max(5, Math.min(180, Math.round(Number(payload.intervalMin != null ? payload.intervalMin : memoryAutoState.intervalMin) || 30))),
    thresholdPercent: Math.max(0, Math.min(100, Math.round(Number(payload.thresholdPercent != null ? payload.thresholdPercent : memoryAutoState.thresholdPercent) || 0))),
    autoElevate: payload.autoElevate === true,
    lastRunAt: memoryAutoState.lastRunAt || 0,
    lastReason: memoryAutoState.lastReason || '',
    lastResult: memoryAutoState.lastResult || null,
    lastError: '',
  };
}

function stopMemoryAutoTimer() {
  if (memoryAutoTimer) clearInterval(memoryAutoTimer);
  memoryAutoTimer = null;
}

function syncMemoryAutoTimer() {
  stopMemoryAutoTimer();
  if (!memoryAutoState.enabled) return;
  memoryAutoTimer = setInterval(() => {
    runMemoryAutoTick('timer').catch(() => {});
  }, Math.max(5, memoryAutoState.intervalMin) * 60000);
}

async function runMemoryAutoTick(reason = 'auto') {
  if (!memoryAutoState.enabled) return { ok:false, skipped:true, reason:'disabled', state:memoryAutoState };
  if (isMainWindowForegroundVisible()) {
    memoryAutoState.lastRunAt = Date.now();
    memoryAutoState.lastReason = reason + ':foreground-visible';
    memoryAutoState.lastResult = { ok:true, skipped:true, reason:'foreground-visible' };
    return { ok:true, skipped:true, reason:'foreground-visible', state:memoryAutoState };
  }
  const snapshot = await systemMemory.getMemorySnapshotExtended();
  const threshold = Number(memoryAutoState.thresholdPercent) || 0;
  if (threshold > 0 && snapshot && snapshot.usedPercent < threshold) {
    memoryAutoState.lastRunAt = Date.now();
    memoryAutoState.lastReason = reason + ':below-threshold';
    memoryAutoState.lastResult = { ok:true, skipped:true, usedPercent:snapshot.usedPercent, thresholdPercent:threshold };
    return { ok:true, skipped:true, snapshot, state:memoryAutoState };
  }
  memoryAutoState.lastRunAt = Date.now();
  memoryAutoState.lastReason = reason;
  try {
    const result = await systemMemory.purgeSystemMemorySmart(memoryAutoState.mask, { autoElevate:memoryAutoState.autoElevate === true });
    memoryAutoState.lastResult = result;
    memoryAutoState.lastError = '';
    return { ok:true, result, snapshot:await systemMemory.getMemorySnapshotExtended(), state:memoryAutoState };
  } catch (error) {
    memoryAutoState.lastError = error.message || 'MEMORY_AUTO_FAILED';
    memoryAutoState.lastResult = { ok:false, error:memoryAutoState.lastError };
    return { ok:false, error:memoryAutoState.lastError, snapshot:systemMemory.getMemorySnapshot(), state:memoryAutoState };
  }
}

const WINDOWED_ASPECT = 16 / 9;
const WINDOWED_SCALE = 3 / 4;
const WINDOWED_MARGIN = 32;
const MIN_WINDOWED_WIDTH = 960;
const MIN_WINDOWED_HEIGHT = 540;
const APP_NAME = 'Mineradio';
const APP_USER_MODEL_ID = 'com.mineradio.desktop';
const DESKTOP_SHORTCUT_NAME = 'Mineradio';
const APP_TRAY_GUID = '7e6162ca-f43f-4d0a-b5bb-8b8fcd17a865';
const APP_ICON_ICO = path.join(__dirname, '..', 'build', 'icon.ico');
const APP_TRAY_ICON_PNG = path.join(__dirname, '..', 'public', 'tray-icon.png');
const STABLE_USER_DATA_NAME = 'Mineradio';
const PROFILE_COMPAT_SCHEMA = 2;
const PROFILE_COMPAT_FILE = 'profile-compat-v2.json';
const PROFILE_NATIVE_REPAIR_FILE = 'profile-native-state-repair-v2.json';
const PROFILE_NATIVE_REPAIR_COMPLETE_FILE = 'profile-native-state-repair-v2.complete.json';
const APP_RELEASE_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) || {};
    return String(pkg.mineradio?.releaseVersion || pkg.version || '0.0.0');
  } catch (_error) {
    return '0.0.0';
  }
})();
const DESKTOP_UI_STATE_KEYS = new Set([
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
  'mineradio-wallpaper-engine-selection-v1',
  'mineradio-wallpaper-engine-hidden-v1',
  'mineradio-wallpaper-engine-favorites-v1',
  'mineradio-original-feature-pack-v2',
  'mineradio-audio-fade-v1',
  'mineradio-player-spectrum-v1',
  'mineradio-player-spectrum-height-v1',
  'mineradio-home-always-transparent-v1',
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
  'mineradio-wallpaper-engine-hidden-v1',
  'mineradio-wallpaper-engine-favorites-v1',
  'mineradio-last-visual-preset-v1',
  'mineradio-local-user-playlists-v1',
  'mineradio-playlist-custom-covers-v1',
  'mineradio-lx-playlist-song-order-v1',
  'mineradio-playback-session-v1',
  'mineradio-user-fx-archives-v1',
  'mineradio-hotkey-settings-v1',
  'mineradio-visual-guide-seen-v2',
  'mineradio-upload-tip-seen',
]);
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
  'mineradio-wallpaper-engine-selection-v1',
  'mineradio-original-feature-pack-v2',
  'mineradio-audio-fade-v1',
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
  'mineradio-player-spectrum-v1',
  'mineradio-home-always-transparent-v1',
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
  'mineradio-player-spectrum-height-v1',
  'mineradio-last-visual-preset-v1',
]);
const LARGE_UI_STATE_KEYS = new Set([
  'mineradio-lyric-layout-v1',
  'mineradio-wallpaper-scene-recordings-v1',
  'mineradio-local-user-playlists-v1',
  'mineradio-playlist-custom-covers-v1',
  'mineradio-user-fx-archives-v1',
]);
const STARTUP_SAFE_RESET_KEYS = new Set([
  'mineradio-lyric-layout-v1',
  'mineradio-last-visual-preset-v1',
  'mineradio-free-camera-v1',
]);
let cachedAppWindowIcon = null;

function getAppWindowIcon() {
  if (cachedAppWindowIcon && !cachedAppWindowIcon.isEmpty()) return cachedAppWindowIcon;
  for (const iconPath of [APP_TRAY_ICON_PNG, APP_ICON_ICO]) {
    if (!fs.existsSync(iconPath)) continue;
    try {
      const image = nativeImage.createFromPath(iconPath);
      if (!image.isEmpty()) {
        cachedAppWindowIcon = image;
        return image;
      }
    } catch (_error) {}
  }
  return APP_ICON_ICO;
}

function repairWindowsShellShortcutIcons() {
  // A source/dev launch uses Electron's generic executable. It must never
  // replace shortcuts owned by an installed Mineradio build.
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const target = process.execPath;
  if (!/^Mineradio\.exe$/i.test(path.basename(target))) return;
  const roots = [
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    app.getPath('desktop'),
    path.join(app.getPath('appData'), 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
  ];
  const links = [];
  function collect(dir, depth) {
    if (!dir || !fs.existsSync(dir) || depth > 2) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_error) { return; }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(fullPath, depth + 1);
      else if (entry.isFile() && /\.lnk$/i.test(entry.name) && /mineradio/i.test(entry.name) && !/uninstall/i.test(entry.name)) links.push(fullPath);
    }
  }
  roots.forEach(root => collect(root, 0));
  for (const shortcutPath of links) {
    try {
      const current = shell.readShortcutLink(shortcutPath) || {};
      const currentTarget = String(current.target || '');
      if (currentTarget && !/mineradio\.exe$/i.test(currentTarget)) continue;
      shell.writeShortcutLink(shortcutPath, 'replace', {
        target,
        cwd: path.dirname(target),
        args: String(current.args || ''),
        description: String(current.description || 'Mineradio desktop music player'),
        icon: fs.existsSync(APP_ICON_ICO) ? APP_ICON_ICO : target,
        iconIndex: 0,
        appUserModelId: APP_USER_MODEL_ID,
      });
    } catch (error) {
      console.warn('[ShortcutIconRepair]', shortcutPath, error.message);
    }
  }
  const ie4uinit = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'ie4uinit.exe') : '';
  if (ie4uinit && fs.existsSync(ie4uinit)) execFile(ie4uinit, ['-show'], { windowsHide: true }, () => {});
}

function sanitizeDesktopUiStateValue(key, value, options = {}) {
  if (!DESKTOP_UI_STATE_KEYS.has(key) || typeof value !== 'string') return null;
  const limit = LARGE_UI_STATE_KEYS.has(key) ? 16 * 1024 * 1024 : 512 * 1024;
  // Oversized known values are not suitable for synchronous renderer backup,
  // but an existing target profile must not lose them during housekeeping.
  if (value.length > limit) return options.preserveOversizedKnownValues ? value : null;
  const text = String(value);
  if (FLAG_UI_STATE_KEYS.has(key)) return /^(?:0|1)$/.test(text) ? text : null;
  if (NUMBER_UI_STATE_KEYS.has(key)) {
    if (!text.trim()) return null;
    const number = Number(text);
    if (!Number.isFinite(number)) return null;
    if (key === 'apex-player-volume' && (number < 0 || number > 1)) return null;
    if (/wallpaper-record-fps/.test(key) && (number < 15 || number > 120)) return null;
    if (key === 'mineradio-last-visual-preset-v1' && (number < 0 || number > 14)) return null;
    return text;
  }
  if (key === 'mineradio-playback-quality-v1') {
    return /^(?:standard|high|exhigh|lossless|hires|jymaster|128k|320k|flac|flac24bit)$/.test(text) ? text : null;
  }
  if (JSON_ARRAY_UI_STATE_KEYS.has(key) || JSON_OBJECT_UI_STATE_KEYS.has(key)) {
    try {
      const parsed = JSON.parse(text);
      if (JSON_ARRAY_UI_STATE_KEYS.has(key) && !Array.isArray(parsed)) return null;
      if (JSON_OBJECT_UI_STATE_KEYS.has(key) && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) return null;
      if (key === 'mineradio-lyric-layout-v1' && options.stripNativeStartupState) {
        parsed.wallpaperMode = false;
        parsed.desktopLyrics = false;
      }
      return JSON.stringify(parsed);
    } catch (_error) {
      return null;
    }
  }
  return text.length <= 32768 ? text : null;
}

function sanitizeDesktopUiStateValues(values, options = {}) {
  const clean = {};
  if (!values || typeof values !== 'object' || Array.isArray(values)) return clean;
  Object.entries(values).forEach(([key, value]) => {
    const sanitized = sanitizeDesktopUiStateValue(key, value, options);
    if (sanitized != null) clean[key] = sanitized;
  });
  return clean;
}

function writeJsonFileAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temporary, file);
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_cleanupError) {}
    throw error;
  }
}

function backupCorruptProfileFile(file, stableDir, label) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(stableDir, 'recovery', `corrupt-profile-${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `${String(label || 'state').replace(/[^a-z0-9._-]/gi, '_')}.json`);
  fs.copyFileSync(file, backupFile, fs.constants.COPYFILE_EXCL);
  return backupFile;
}

function copyMissingAppOwnedTree(sourceDir, targetDir, depth = 0) {
  if (!sourceDir || !targetDir || sourceDir === targetDir || !fs.existsSync(sourceDir) || depth > 6) return true;
  try { fs.mkdirSync(targetDir, { recursive: true }); } catch (_error) { return false; }
  let entries = [];
  try { entries = fs.readdirSync(sourceDir, { withFileTypes: true }); } catch (_error) { return false; }
  let complete = true;
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      if (!copyMissingAppOwnedTree(source, target, depth + 1)) complete = false;
      continue;
    }
    if (!entry.isFile() || fs.existsSync(target)) continue;
    try {
      if (fs.statSync(source).size > 8 * 1024 * 1024) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      complete = false;
      console.warn('App-owned user data migration skipped entry:', source, error.message);
    }
  }
  return complete;
}

function mergeDesktopUiStateFile(sourceDir, targetDir, options = {}) {
  const sourceFile = path.join(sourceDir, 'desktop-ui-state.json');
  const targetFile = path.join(targetDir, 'desktop-ui-state.json');
  if (!fs.existsSync(sourceFile)) return true;
  const sameFile = path.resolve(sourceFile).toLowerCase() === path.resolve(targetFile).toLowerCase();
  try {
    let source = {};
    let target = {};
    if (sameFile) {
      try {
        target = JSON.parse(fs.readFileSync(targetFile, 'utf8')) || {};
        source = target;
      } catch (error) {
        backupCorruptProfileFile(targetFile, targetDir, 'desktop-ui-state');
        console.warn('Corrupt stable desktop UI state quarantined:', error.message);
      }
    } else {
      try {
        source = JSON.parse(fs.readFileSync(sourceFile, 'utf8')) || {};
      } catch (error) {
        if (error instanceof SyntaxError) {
          console.warn('Corrupt legacy desktop UI state skipped:', sourceFile);
          return true;
        }
        throw error;
      }
      if (fs.existsSync(targetFile)) {
        try { target = JSON.parse(fs.readFileSync(targetFile, 'utf8')) || {}; }
        catch (error) {
          backupCorruptProfileFile(targetFile, targetDir, 'desktop-ui-state');
          console.warn('Corrupt stable desktop UI state quarantined:', error.message);
          target = {};
        }
      }
    }
    const sourceValues = sanitizeDesktopUiStateValues(source.values, { stripNativeStartupState: true });
    const targetValues = sanitizeDesktopUiStateValues(target.values, {
      preserveOversizedKnownValues: true,
      stripNativeStartupState: !!options.stripTargetNativeStartupState,
    });
    const next = {
      schema: 1,
      updatedAt: Math.max(Number(source.updatedAt) || 0, Number(target.updatedAt) || 0, Date.now()),
      // Existing stable-profile values always win. A legacy/fork profile may
      // only fill missing, validated app-owned keys.
      values: { ...sourceValues, ...targetValues },
    };
    writeJsonFileAtomic(targetFile, next);
    return true;
  } catch (error) {
    console.warn('Desktop UI state migration skipped:', error.message);
    return false;
  }
}

function mergeDesktopShellSettingsFile(sourceDir, targetDir) {
  const sourceFile = path.join(sourceDir, 'desktop-shell-settings.json');
  const targetFile = path.join(targetDir, 'desktop-shell-settings.json');
  if (!fs.existsSync(sourceFile)) return true;
  const sameFile = path.resolve(sourceFile).toLowerCase() === path.resolve(targetFile).toLowerCase();
  try {
    let source = {};
    let target = {};
    if (sameFile) {
      try {
        target = JSON.parse(fs.readFileSync(targetFile, 'utf8')) || {};
        source = target;
      } catch (error) {
        backupCorruptProfileFile(targetFile, targetDir, 'desktop-shell-settings');
        console.warn('Corrupt stable desktop shell settings quarantined:', error.message);
      }
    } else {
      try { source = JSON.parse(fs.readFileSync(sourceFile, 'utf8')) || {}; }
      catch (error) {
        if (error instanceof SyntaxError) {
          console.warn('Corrupt legacy desktop shell settings skipped:', sourceFile);
          return true;
        }
        throw error;
      }
      if (fs.existsSync(targetFile)) {
        try { target = JSON.parse(fs.readFileSync(targetFile, 'utf8')) || {}; }
        catch (error) {
          backupCorruptProfileFile(targetFile, targetDir, 'desktop-shell-settings');
          console.warn('Corrupt stable desktop shell settings quarantined:', error.message);
          target = {};
        }
      }
    }
    const next = { ...source, ...target };
    writeJsonFileAtomic(targetFile, next);
    return true;
  } catch (error) {
    console.warn('Desktop shell settings migration skipped:', error.message);
    return false;
  }
}

function quarantineDisposableChromiumData(stableDir, reason) {
  const names = [
    'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
    'ShaderCache', 'GrShaderCache', 'Session Storage', 'blob_storage', 'Shared Dictionary',
  ];
  const existing = names.filter(name => fs.existsSync(path.join(stableDir, name)));
  if (!existing.length) return { backupDir: '', complete: true };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(stableDir, 'recovery', `profile-cache-${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true });
  let complete = true;
  for (const name of existing) {
    const source = path.join(stableDir, name);
    const target = path.join(backupDir, name);
    try { fs.renameSync(source, target); }
    catch (error) {
      complete = false;
      console.warn('Profile cache quarantine skipped:', source, error.message);
    }
  }
  try { fs.writeFileSync(path.join(backupDir, 'reason.txt'), String(reason || 'version-change'), 'utf8'); } catch (_error) {}
  return { backupDir, complete };
}

async function backupChromiumLocalStorageForRecovery(stableDir, reason) {
  const source = path.join(stableDir, 'Local Storage');
  if (!fs.existsSync(source)) return { ok: true, backupDir: '', hadStorage: false };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(stableDir, 'recovery', `profile-storage-${stamp}`);
  await fs.promises.mkdir(backupDir, { recursive: true });
  await fs.promises.cp(source, path.join(backupDir, 'Local Storage'), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await fs.promises.writeFile(
    path.join(backupDir, 'reason.txt'),
    String(reason || 'startup-storage-recovery'),
    'utf8',
  );
  return { ok: true, backupDir, hadStorage: true };
}

function readProfileCompat(stableDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(stableDir, PROFILE_COMPAT_FILE), 'utf8')) || {};
  } catch (_error) {
    return {};
  }
}

function writeProfileCompat(
  stableDir,
  migratedFrom,
  schema = PROFILE_COMPAT_SCHEMA,
  releaseVersion = APP_RELEASE_VERSION,
) {
  const file = path.join(stableDir, PROFILE_COMPAT_FILE);
  const next = {
    schema,
    releaseVersion,
    updatedAt: Date.now(),
    migratedFrom: Array.from(new Set(migratedFrom || [])),
  };
  writeJsonFileAtomic(file, next);
}

function profileNativeRepairPath(stableDir) {
  return path.join(stableDir, PROFILE_NATIVE_REPAIR_FILE);
}

function profileNativeRepairCompletePath(stableDir) {
  return path.join(stableDir, PROFILE_NATIVE_REPAIR_COMPLETE_FILE);
}

function scheduleProfileNativeStateRepair(stableDir, previous) {
  const file = profileNativeRepairPath(stableDir);
  if (!fs.existsSync(file)) {
    writeJsonFileAtomic(file, {
      schema: 1,
      token: crypto.randomBytes(16).toString('hex'),
      fromSchema: Number(previous && previous.schema) || 0,
      fromRelease: String(previous && previous.releaseVersion || 'legacy'),
      createdAt: Date.now(),
    });
  }
  profileNativeStartupRepairPending = true;
}

function prepareStableUserData(stableDir) {
  try {
    const appDataDir = app.getPath('appData');
    const previous = readProfileCompat(stableDir);
    const nativeRepairAlreadyCompleted = fs.existsSync(profileNativeRepairCompletePath(stableDir));
    const needsNativeStartupStateReset = !nativeRepairAlreadyCompleted && (
      Number(previous.schema) < PROFILE_COMPAT_SCHEMA || previous.releaseVersion === '1.5.6.1'
    );
    const candidates = new Set();
    for (const entry of fs.readdirSync(appDataDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === STABLE_USER_DATA_NAME) continue;
      if (/^Mineradio/i.test(entry.name)) candidates.add(path.join(appDataDir, entry.name));
    }
    fs.mkdirSync(stableDir, { recursive: true });
    const migratedFrom = [];
    let migrationComplete = true;
    let cacheQuarantineComplete = true;
    if (Number(previous.schema) < PROFILE_COMPAT_SCHEMA) {
      for (const candidate of Array.from(candidates).sort()) {
        const uiComplete = mergeDesktopUiStateFile(candidate, stableDir);
        const shellComplete = mergeDesktopShellSettingsFile(candidate, stableDir);
        const sourcesComplete = copyMissingAppOwnedTree(path.join(candidate, 'sources'), path.join(stableDir, 'sources'));
        if (uiComplete && shellComplete && sourcesComplete) migratedFrom.push(path.basename(candidate));
        else migrationComplete = false;
      }
    }
    if (previous.releaseVersion !== APP_RELEASE_VERSION) {
      const quarantine = quarantineDisposableChromiumData(
        stableDir,
        `${previous.releaseVersion || 'legacy'} -> ${APP_RELEASE_VERSION}`,
      );
      cacheQuarantineComplete = !!(quarantine && quarantine.complete);
    }
    // Re-write the stable backup once so malformed values already imported by
    // 1.5.6.1 cannot be restored by preload on the next renderer launch.
    const stableState = path.join(stableDir, 'desktop-ui-state.json');
    if (fs.existsSync(stableState)) {
      const stableStateComplete = mergeDesktopUiStateFile(stableDir, stableDir, {
        // One-time repair for legacy/1.5.6.1 native window state. Later normal
        // upgrades must preserve the user's desktop-mode preference.
        stripTargetNativeStartupState: needsNativeStartupStateReset,
      });
      if (!stableStateComplete) migrationComplete = false;
    }
    if (needsNativeStartupStateReset) scheduleProfileNativeStateRepair(stableDir, previous);
    else profileNativeStartupRepairPending = fs.existsSync(profileNativeRepairPath(stableDir));
    const previousMigratedFrom = Array.isArray(previous.migratedFrom) ? previous.migratedFrom : [];
    const nextSchema = migrationComplete
      ? PROFILE_COMPAT_SCHEMA
      : Math.min(Number(previous.schema) || 0, PROFILE_COMPAT_SCHEMA - 1);
    writeProfileCompat(
      stableDir,
      [...previousMigratedFrom, ...migratedFrom],
      nextSchema,
      cacheQuarantineComplete ? APP_RELEASE_VERSION : String(previous.releaseVersion || ''),
    );
  } catch (error) {
    console.warn('Stable user data preparation skipped:', error.message);
    profileNativeStartupRepairPending = fs.existsSync(profileNativeRepairPath(stableDir));
  }
}

const explicitUserDataArg = process.argv.find((arg) => String(arg || '').startsWith('--user-data-dir='));
const explicitUserDataPath = explicitUserDataArg
  ? String(explicitUserDataArg).slice('--user-data-dir='.length).trim()
  : '';
const stableUserDataPath = explicitUserDataPath
  ? path.resolve(explicitUserDataPath)
  : path.join(app.getPath('appData'), STABLE_USER_DATA_NAME);
app.setPath('userData', stableUserDataPath);
app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);

const WALLPAPER_ENGINE_NATIVE_TEMP_PATH = path.join(stableUserDataPath, 'wallpaper-engine-native');
fs.mkdirSync(WALLPAPER_ENGINE_NATIVE_TEMP_PATH, { recursive: true });
const FULL_DESKTOP_NATIVE_TEMP_PATH = path.join(stableUserDataPath, 'full-desktop-native');
fs.mkdirSync(FULL_DESKTOP_NATIVE_TEMP_PATH, { recursive: true });
const wallpaperEngineNativeLibrary = new WallpaperEngineLibrary({ userDataPath: stableUserDataPath });
const wallpaperEngineNativeRuntime = new WallpaperEngineRuntime({
  library: wallpaperEngineNativeLibrary,
  desktopCapturer,
  hostElevationProbe: systemMemory.probeProcessElevation,
  nativeTempPath: WALLPAPER_ENGINE_NATIVE_TEMP_PATH,
});
let wallpaperEngineNativeOperation = 0;
let wallpaperEngineNativeGrant = null;
let desktopFusionOverlayState = {
  enabled: false,
  softwareInteractionLocked: false,
  pointerRoute: { overSoftwareUi: false, overDesktopControls: false },
  ignoreMouseEvents: false,
  restoreSnapshot: null,
  displayBounds: null,
};
let lastDesktopFusionDiagnosticKey = '';

function publishFullDesktopModeStatus(status, reason = '') {
  const next = status && typeof status === 'object'
    ? { ...status, reason: String(status.reason || reason || '') }
    : {
        ok: true,
        supported: process.platform === 'win32',
        enabled: false,
        active: false,
        interactive: false,
        softwareInteractionLocked: false,
        desktopIconsVisible: true,
        reason: String(reason || ''),
      };
  mainWindowDesktopEmbedded = next.enabled === true || next.active === true;
  mainWindowDesktopInteractive = mainWindowDesktopEmbedded && next.interactive === true;
  mainWindowDesktopEmbeddingUncertain = next.nativeStateKnown === false;
  const diagnosticKey = [
    next.enabled === true ? '1' : '0',
    next.interactive === true ? '1' : '0',
    next.softwareInteractionLocked === true ? '1' : '0',
    String(next.phase || ''),
    String(next.parentClassName || ''),
    String(next.lastError || ''),
  ].join('|');
  if (diagnosticKey !== lastDesktopFusionDiagnosticKey) {
    lastDesktopFusionDiagnosticKey = diagnosticKey;
    writeDesktopFusionDiagnostic('state', String(next.reason || reason || ''), JSON.stringify({
      enabled:next.enabled === true,
      interactive:next.interactive === true,
      softwareInteractionLocked:next.softwareInteractionLocked === true,
      phase:String(next.phase || ''),
      parentClassName:String(next.parentClassName || ''),
      coexisting:next.coexisting === true,
      nativeStateKnown:next.nativeStateKnown !== false,
      lastError:String(next.lastError || ''),
    }));
  }
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    try { mainWindow.webContents.send('mineradio-wallpaper-mode-state', next); } catch (_error) {}
    try { sendWindowState(mainWindow); } catch (_error) {}
  }
  try { refreshTrayMenu(); } catch (_error) {}
  return next;
}

function getFullDesktopModeRuntime() {
  if (fullDesktopModeRuntime) return fullDesktopModeRuntime;
  fullDesktopModeRuntime = new FullDesktopModeRuntime({
    screen,
    nativeTempPath: FULL_DESKTOP_NATIVE_TEMP_PATH,
    onStatus: (status) => publishFullDesktopModeStatus(status),
    requestReconcile: (reason) => {
      setTimeout(() => {
        if (!fullDesktopModeRuntime || !fullDesktopModeRuntime.isEnabled()) return;
        fullDesktopModeRuntime.reconcile(reason || 'desktop-host-changed').catch(() => {});
      }, 0);
      return { ok: true, queued: true };
    },
  });
  return fullDesktopModeRuntime;
}

function getDesktopFusionOverlayStatus(reason = '') {
  const enabled = desktopFusionOverlayState.enabled === true
    && !!(mainWindow && !mainWindow.isDestroyed());
  const interactive = enabled && mainWindowDesktopInteractive === true;
  return {
    ok: true,
    supported: process.platform === 'win32',
    enabled,
    active: enabled,
    embedded: enabled && !interactive,
    coexisting: false,
    interactive,
    nativeStateKnown: true,
    busy: false,
    attaching: false,
    phase: enabled ? (interactive ? 'software-control' : 'desktop-control') : 'disabled',
    generation: 1,
    parentClassName: enabled ? (interactive ? 'TOPLEVEL' : 'WorkerW') : '',
    bounds: desktopFusionOverlayState.displayBounds,
    softwareInteractionLocked: enabled && !interactive,
    desktopIconsVisible: true,
    ignoreMouseEvents: enabled && !interactive,
    pointerRoute: { ...desktopFusionOverlayState.pointerRoute },
    iconRevealRects: [],
    iconShapeActive: false,
    iconCount: 0,
    iconShapeRectCount: 0,
    iconLayerMode: enabled ? 'workerw-toggle' : '',
    lastError: '',
    reason: String(reason || ''),
  };
}

function applyDesktopFusionOverlayPointerRoute(reason = 'desktop-pointer-route') {
  desktopFusionOverlayState.ignoreMouseEvents = desktopFusionOverlayState.enabled === true
    && mainWindowDesktopInteractive !== true;
  return getDesktopFusionOverlayStatus(reason);
}

async function setDesktopFusionOverlayLocked(locked, reason = 'desktop-software-lock') {
  if (!desktopFusionOverlayState.enabled || !mainWindow || mainWindow.isDestroyed()) {
    return {
      ok: false,
      enabled: false,
      interactive: false,
      error: 'DESKTOP_MODE_INACTIVE',
      status: getDesktopFusionOverlayStatus(reason),
    };
  }
  const desired = locked === true;
  const changed = await setMainWindowDesktopInteractive(!desired);
  if (!changed || changed.ok !== true) {
    return {
      ...(changed || {}),
      ok: false,
      enabled: true,
      interactive: mainWindowDesktopInteractive === true,
      locked: mainWindowDesktopInteractive !== true,
      softwareInteractionLocked: mainWindowDesktopInteractive !== true,
      status: getDesktopFusionOverlayStatus(reason + '-failed'),
    };
  }
  desktopFusionOverlayState.softwareInteractionLocked = desired;
  desktopFusionOverlayState.pointerRoute = {
    overSoftwareUi: false,
    overDesktopControls: desktopFusionOverlayState.pointerRoute.overDesktopControls === true,
  };
  const status = applyDesktopFusionOverlayPointerRoute(reason);
  publishFullDesktopModeStatus(status);
  return {
    ok: true,
    enabled: true,
    interactive: mainWindowDesktopInteractive === true,
    locked: desired,
    softwareInteractionLocked: desired,
    ignoreMouseEvents: desktopFusionOverlayState.ignoreMouseEvents,
    status,
  };
}

async function enableDesktopFusionOverlay(payload = {}) {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, enabled: false, interactive: false, error: 'MAIN_WINDOW_UNAVAILABLE' };
  }
  if (fullDesktopModeRuntime && fullDesktopModeRuntime.isEnabled()) {
    await fullDesktopModeRuntime.disable('workerw-toggle-migration').catch(() => {});
  }
  const win = mainWindow;
  if (!desktopFusionOverlayState.enabled) desktopFusionOverlayState.restoreSnapshot = capturePreDesktopWindowState(win);
  const embedded = await setMainWindowDesktopEmbedded(true, { force:true });
  if (!embedded || embedded.ok !== true) {
    desktopFusionOverlayState.enabled = false;
    return { ...(embedded || {}), ok:false, enabled:false, interactive:false };
  }
  desktopFusionOverlayState.enabled = true;
  const interactive = await setMainWindowDesktopInteractive(true);
  if (!interactive || interactive.ok !== true) {
    await setMainWindowDesktopEmbedded(false, { force:true }).catch(() => {});
    desktopFusionOverlayState.enabled = false;
    return { ...(interactive || {}), ok:false, enabled:false, interactive:false };
  }
  desktopFusionOverlayState.softwareInteractionLocked = false;
  desktopFusionOverlayState.pointerRoute = { overSoftwareUi: false, overDesktopControls: false };
  desktopFusionOverlayState.ignoreMouseEvents = false;
  desktopFusionOverlayState.displayBounds = screen.getDisplayMatching(
    desktopFusionOverlayState.restoreSnapshot && desktopFusionOverlayState.restoreSnapshot.bounds || win.getBounds(),
  ).bounds;
  wallpaperState = { ...wallpaperState, ...(payload || {}), enabled: true };
  closeWallpaperWindow();
  const status = publishFullDesktopModeStatus(getDesktopFusionOverlayStatus('wallpaper-mode-ready'));
  return { ok: true, enabled: true, interactive: true, status };
}

async function disableDesktopFusionOverlay(reason = 'wallpaper-mode-disabled') {
  const win = mainWindow;
  closeWallpaperWindow();
  if (!desktopFusionOverlayState.enabled) {
    const status = publishFullDesktopModeStatus(getDesktopFusionOverlayStatus(reason));
    return { ok: true, enabled: false, interactive: false, status };
  }
  const detached = await setMainWindowDesktopEmbedded(false, { force:true });
  if (!detached || detached.ok !== true) {
    return { ...(detached || {}), ok:false, enabled:true, status:getDesktopFusionOverlayStatus(reason + '-failed') };
  }
  desktopFusionOverlayState.enabled = false;
  desktopFusionOverlayState.softwareInteractionLocked = false;
  desktopFusionOverlayState.pointerRoute = { overSoftwareUi: false, overDesktopControls: false };
  desktopFusionOverlayState.ignoreMouseEvents = false;
  desktopFusionOverlayState.displayBounds = null;
  desktopFusionOverlayState.restoreSnapshot = null;
  wallpaperState = { ...wallpaperState, enabled: false };
  const status = publishFullDesktopModeStatus(getDesktopFusionOverlayStatus(reason));
  setTimeout(() => {
    if (!desktopFusionOverlayState.enabled) {
      mainWindowPreDesktopState = null;
      mainWindowPreDesktopBounds = null;
    }
  }, 1200);
  return { ok: true, enabled: false, interactive: false, status };
}

function writeStartupDiagnostic(stage, error) {
  const logPath = path.join(app.getPath('userData'), 'startup-crash.log');
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const details = error && error.stack ? error.stack : String(error && error.message ? error.message : error || 'UNKNOWN_ERROR');
    const entry = [
      `[${new Date().toISOString()}] ${stage}`,
      `app=${app.getVersion()} release=${APP_RELEASE_VERSION} electron=${process.versions.electron || ''} node=${process.versions.node || ''}`,
      `exec=${process.execPath}`,
      details,
      '',
    ].join('\n');
    fs.appendFileSync(logPath, entry, 'utf8');
  } catch (_logError) {}
  return logPath;
}

app.on('render-process-gone', (_event, _webContents, details) => {
  writeStartupDiagnostic('render-process-gone', JSON.stringify(details || {}));
});

const LOCAL_FILE_TOKEN = crypto.randomBytes(16).toString('hex');
const DESKTOP_SHELL_SETTINGS_FILE = 'desktop-shell-settings.json';
const DESKTOP_UI_STATE_FILE = 'desktop-ui-state.json';
const WINDOWS_POWERSHELL_EXE = process.platform === 'win32' && process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'powershell.exe';

function writeDesktopFusionDiagnostic(stage, error, stderr) {
  try {
    const details = String(stderr || (error && error.message) || error || 'UNKNOWN_ERROR').trim().slice(-2000);
    const line = `${new Date().toISOString()} [${stage}] ${details}\n`;
    fs.appendFileSync(path.join(app.getPath('userData'), 'desktop-fusion.log'), line, 'utf8');
  } catch (_error) {}
}
const CHROMIUM_PERFORMANCE_SWITCHES = [
  ['autoplay-policy', 'no-user-gesture-required'],
  // Keep accelerated rendering available without forcing a discrete GPU or
  // disabling Chromium's normal background/minimized-window throttling.
  ['enable-gpu-rasterization'],
  ['enable-zero-copy'],
];
for (const [name, value] of CHROMIUM_PERFORMANCE_SWITCHES) {
  if (value == null) app.commandLine.appendSwitch(name);
  else app.commandLine.appendSwitch(name, value);
}
// Normal launches remain single-instance. The explicit private flag is used by
// local clean-profile verification so an installed/admin instance does not
// prevent testing the exact files that are about to be packaged.
const gotSingleInstanceLock = process.argv.includes('--mineradio-test-instance') || app.requestSingleInstanceLock();
if (gotSingleInstanceLock && !explicitUserDataPath) prepareStableUserData(stableUserDataPath);

function findOpenPort(startPort) {
  return new Promise((resolve, reject) => {
    function tryPort(port) {
      const tester = net.createServer();

      tester.once('error', (err) => {
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
          tryPort(port + 1);
          return;
        }
        reject(err);
      });

      tester.once('listening', () => {
        tester.close(() => resolve(port));
      });

      tester.listen(port, '127.0.0.1');
    }

    tryPort(startPort);
  });
}

function waitForServer(server) {
  if (!server || server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

const ENCRYPTED_AUDIO_EXTS = new Set(['.ncm', '.qmc0', '.qmc3', '.qmcflac', '.qmcogg', '.kgm', '.kgma', '.vpr', '.kwm', '.mflac', '.mgg']);
const EXTRA_AUDIO_EXTS = ['.aiff', '.aif', '.aifc', '.caf', '.amr', '.awb', '.oga', '.mka', '.mkv', '.m4b', '.alac', '.ac3', '.dts', '.tta', '.tak', '.wv', '.au', '.snd', '.ra', '.rm'];
const LOCAL_LIBRARY_EXTS = new Set(['.mp3', '.flac', '.wav', '.ogg', '.opus', '.m4a', '.mp4', '.aac', '.webm', '.ape', '.wma', ...EXTRA_AUDIO_EXTS, ...ENCRYPTED_AUDIO_EXTS, '.lrc', '.txt', '.jpg', '.jpeg', '.png', '.webp']);
const LOCAL_LIBRARY_MIME = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm',
  '.ape': 'audio/x-ape',
  '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.aifc': 'audio/aiff',
  '.caf': 'audio/x-caf',
  '.amr': 'audio/amr',
  '.awb': 'audio/amr-wb',
  '.oga': 'audio/ogg',
  '.mka': 'audio/x-matroska',
  '.mkv': 'audio/x-matroska',
  '.m4b': 'audio/mp4',
  '.alac': 'audio/alac',
  '.ac3': 'audio/ac3',
  '.dts': 'audio/vnd.dts',
  '.tta': 'audio/x-tta',
  '.tak': 'audio/x-tak',
  '.wv': 'audio/x-wavpack',
  '.au': 'audio/basic',
  '.snd': 'audio/basic',
  '.ra': 'audio/vnd.rn-realaudio',
  '.rm': 'application/vnd.rn-realmedia',
  '.ncm': 'application/x-encrypted-audio',
  '.qmc0': 'application/x-encrypted-audio',
  '.qmc3': 'application/x-encrypted-audio',
  '.qmcflac': 'application/x-encrypted-audio',
  '.qmcogg': 'application/x-encrypted-audio',
  '.kgm': 'application/x-encrypted-audio',
  '.kgma': 'application/x-encrypted-audio',
  '.vpr': 'application/x-encrypted-audio',
  '.kwm': 'application/x-encrypted-audio',
  '.mflac': 'application/x-encrypted-audio',
  '.mgg': 'application/x-encrypted-audio',
  '.lrc': 'text/plain',
  '.txt': 'text/plain',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function normalizeLocalMusicRoot(folderPath) {
  const resolved = path.resolve(String(folderPath || ''));
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error('LOCAL_LIBRARY_NOT_DIRECTORY');
  return resolved;
}

function rememberLocalMusicRoot(folderPath) {
  const root = normalizeLocalMusicRoot(folderPath);
  authorizedLocalMusicRoots.add(root);
  return root;
}

function resolveAuthorizedLocalFile(filePath) {
  const target = path.resolve(String(filePath || ''));
  for (const root of authorizedLocalMusicRoots) {
    if (target === root || target.startsWith(root + path.sep)) return target;
  }
  throw new Error('LOCAL_FILE_NOT_AUTHORIZED');
}

function localLibraryRelativePath(root, relPath) {
  return path.join(path.basename(root), relPath).replace(/\\/g, '/');
}

function localFileProxyUrl(filePath) {
  if (!mainServerPort) return pathToFileURL(filePath).href;
  return `http://127.0.0.1:${mainServerPort}/api/local-file?token=${encodeURIComponent(LOCAL_FILE_TOKEN)}&path=${encodeURIComponent(filePath)}`;
}

function hasMp4AudioSignature(data) {
  if (!data || !data.length) return false;
  const ftyp = data.indexOf(Buffer.from('ftyp'));
  if (ftyp >= 4 && ftyp < 1024 * 1024) return true;
  const moov = data.indexOf(Buffer.from('moov'));
  const mdat = data.indexOf(Buffer.from('mdat'));
  return moov >= 0 && mdat >= 0;
}

async function validateLocalAudioFile(filePath, ext) {
  if (ENCRYPTED_AUDIO_EXTS.has(ext)) {
    return { playable:false, encrypted:true, code:'ENCRYPTED_AUDIO', error:'检测到平台加密音频；MR 不进行破解，请先从平台导出合法的普通音频文件' };
  }
  if (!['.mp3', '.flac', '.wav', '.ogg', '.opus', '.m4a', '.mp4', '.aac', '.webm'].includes(ext)) return { playable:true, error:'' };
  try {
    const handle = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(256 * 1024);
    let bytesRead = 0;
    try { ({ bytesRead } = await handle.read(buffer, 0, buffer.length, 0)); } finally { await handle.close(); }
    const data = buffer.subarray(0, bytesRead);
    let valid = false;
    if (ext === '.flac') valid = data.indexOf(Buffer.from('fLaC')) >= 0;
    else if (ext === '.wav') valid = data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WAVE';
    else if (ext === '.ogg' || ext === '.opus') valid = data.subarray(0, 4).toString('ascii') === 'OggS';
    else if (ext === '.m4a' || ext === '.mp4') valid = hasMp4AudioSignature(data) || data.length > 0;
    else if (ext === '.aac') {
      let start = 0;
      if (data.subarray(0, 3).toString('ascii') === 'ID3' && data.length >= 10) {
        start = 10 + ((data[6] & 0x7f) << 21) + ((data[7] & 0x7f) << 14) + ((data[8] & 0x7f) << 7) + (data[9] & 0x7f);
      }
      valid = data.length >= start + 2 && data[start] === 0xff && (data[start + 1] & 0xf6) === 0xf0;
    }
    else if (ext === '.webm') valid = data.length >= 4 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3;
    else {
      let start = 0;
      if (data.subarray(0, 3).toString('ascii') === 'ID3' && data.length >= 10) {
        start = 10 + ((data[6] & 0x7f) << 21) + ((data[7] & 0x7f) << 14) + ((data[8] & 0x7f) << 7) + (data[9] & 0x7f);
      }
      for (let i = Math.min(start, data.length); i + 1 < data.length; i++) {
        if (data[i] === 0xff && (data[i + 1] & 0xe0) === 0xe0 && (data[i + 1] & 0x06) !== 0) { valid = true; break; }
      }
    }
    return { playable:valid, error:valid ? '' : '音频数据损坏、加密或扩展名不正确' };
  } catch (_error) {
    return { playable:false, error:'文件无法读取' };
  }
}

function findAudioSignature(data) {
  const candidates = [];
  const flac = data.indexOf(Buffer.from('fLaC'));
  if (flac >= 0) candidates.push({ offset:flac, ext:'.flac' });
  const ogg = data.indexOf(Buffer.from('OggS'));
  if (ogg >= 0) candidates.push({ offset:ogg, ext:'.ogg' });
  const webm = data.indexOf(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (webm >= 0) candidates.push({ offset:webm, ext:'.webm' });
  for (let i = 0; i + 12 <= data.length; i++) {
    if (data.subarray(i, i + 4).toString('ascii') === 'RIFF' && data.subarray(i + 8, i + 12).toString('ascii') === 'WAVE') {
      candidates.push({ offset:i, ext:'.wav' });
      break;
    }
  }
  const ftyp = data.indexOf(Buffer.from('ftyp'));
  if (ftyp >= 4) candidates.push({ offset:ftyp - 4, ext:'.m4a' });
  for (let i = 0; i + 1 < data.length; i++) {
    if (data[i] === 0xff && (data[i + 1] & 0xf6) === 0xf0) {
      candidates.push({ offset:i, ext:'.aac' });
      break;
    }
  }
  const id3 = data.indexOf(Buffer.from('ID3'));
  if (id3 >= 0) candidates.push({ offset:id3, ext:'.mp3' });
  for (let i = 0; i + 1 < data.length; i++) {
    if (data[i] === 0xff && (data[i + 1] & 0xe0) === 0xe0 && (data[i + 1] & 0x06) !== 0) {
      candidates.push({ offset:i, ext:'.mp3' });
      break;
    }
  }
  return candidates.sort((a, b) => a.offset - b.offset)[0] || null;
}

async function inspectLocalAudioForRepair(filePath) {
  const abs = path.resolve(String(filePath || ''));
  const ext = path.extname(abs).toLowerCase();
  if (ENCRYPTED_AUDIO_EXTS.has(ext)) {
    return { ok:false, code:'ENCRYPTED_AUDIO', encrypted:true, message:'检测到 NCM/QMC/KGM 等平台加密音频；MR 只识别并提示，不进行破解' };
  }
  const stat = await fs.promises.stat(abs);
  const handle = await fs.promises.open(abs, 'r');
  const buffer = Buffer.alloc(Math.min(stat.size, 1024 * 1024));
  let bytesRead = 0;
  try { ({ bytesRead } = await handle.read(buffer, 0, buffer.length, 0)); } finally { await handle.close(); }
  const signature = findAudioSignature(buffer.subarray(0, bytesRead));
  if (!signature) return { ok:false, code:'AUDIO_HEADER_INVALID', message:'未找到可识别的 MP3、FLAC、WAV、OGG 或 M4A 文件头' };
  const repairNeeded = signature.offset > 0 || signature.ext !== ext;
  return { ok:true, repairNeeded, offset:signature.offset, detectedExt:signature.ext, originalExt:ext };
}

function compatibleAudioCacheDir() {
  const dir = path.join(app.getPath('userData'), 'compatible-audio');
  fs.mkdirSync(dir, { recursive:true });
  authorizedLocalMusicRoots.add(dir);
  return dir;
}

async function preparedAudioEntry(filePath, suffix, ext, offset) {
  const stat = await fs.promises.stat(filePath);
  const key = crypto.createHash('sha1').update(path.resolve(filePath)).update(String(stat.size)).update(String(stat.mtimeMs)).update(String(offset || 0)).digest('hex');
  const output = path.join(compatibleAudioCacheDir(), `${key}-${suffix}${ext}`);
  if (!fs.existsSync(output)) {
    await new Promise((resolve, reject) => {
      const input = fs.createReadStream(filePath, { start:Math.max(0, Number(offset) || 0) });
      const target = fs.createWriteStream(output, { flags:'wx' });
      input.once('error', reject);
      target.once('error', reject);
      target.once('finish', resolve);
      input.pipe(target);
    }).catch(async error => {
      if (error && error.code === 'EEXIST') return;
      try { await fs.promises.unlink(output); } catch (_e) {}
      throw error;
    });
  }
  return localMusicEntryFromPath(output);
}

async function prepareLocalAudioForPlayback(filePath) {
  try {
    const inspection = await inspectLocalAudioForRepair(filePath);
    if (!inspection.ok) return inspection;
    if (!inspection.repairNeeded) return { ok:true, inspection, file:null };
    const file = await preparedAudioEntry(filePath, 'header-fixed', inspection.detectedExt, inspection.offset);
    return { ok:true, inspection, file, reused:!!file && fs.existsSync(file.fullPath) };
  } catch (error) {
    return { ok:false, code:'LOCAL_AUDIO_PREPARE_FAILED', message:error.message || '本地音频检查失败' };
  }
}

function findFfmpegExecutable() {
  const candidates = [
    path.join(__dirname, '..', 'bin', 'ffmpeg.exe'),
    path.join(process.resourcesPath || '', 'ffmpeg.exe'),
    path.join(process.resourcesPath || '', 'bin', 'ffmpeg.exe'),
    path.join(path.dirname(process.execPath), 'ffmpeg.exe'),
  ];
  for (const candidate of candidates) if (candidate && fs.existsSync(candidate)) return candidate;
  try {
    const found = require('child_process').execFileSync('where.exe', ['ffmpeg.exe'], { encoding:'utf8', windowsHide:true, timeout:2500 })
      .split(/\r?\n/).map(value => value.trim()).find(Boolean);
    return found || '';
  } catch (_error) {
    return '';
  }
}

async function transcodeLocalAudioForPlayback(filePath) {
  const inspection = await inspectLocalAudioForRepair(filePath).catch(error => ({ ok:false, code:'LOCAL_AUDIO_INSPECT_FAILED', message:error.message }));
  if (inspection.encrypted || inspection.code === 'ENCRYPTED_AUDIO') return inspection;
  const ffmpeg = findFfmpegExecutable();
  if (!ffmpeg) return { ok:false, code:'FFMPEG_NOT_FOUND', message:'未找到 ffmpeg.exe，无法创建兼容 WAV 副本' };
  const stat = await fs.promises.stat(filePath);
  const key = crypto.createHash('sha1').update(path.resolve(filePath)).update(String(stat.size)).update(String(stat.mtimeMs)).digest('hex');
  const output = path.join(compatibleAudioCacheDir(), `${key}-decoded.wav`);
  if (!fs.existsSync(output)) {
    await new Promise((resolve, reject) => {
      execFile(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-err_detect', 'ignore_err', '-y', '-i', filePath, '-vn', '-acodec', 'pcm_s16le', output], {
        windowsHide:true,
        timeout:120000,
        maxBuffer:2 * 1024 * 1024,
      }, error => error ? reject(error) : resolve());
    }).catch(async error => {
      try { await fs.promises.unlink(output); } catch (_e) {}
      throw error;
    });
  }
  return { ok:true, file:await localMusicEntryFromPath(output), reused:fs.existsSync(output) };
}

async function localMusicEntryFromPath(filePath, relativeRoot) {
  const abs = path.resolve(String(filePath || ''));
  const ext = path.extname(abs).toLowerCase();
  if (!LOCAL_LIBRARY_EXTS.has(ext)) return null;
  let stat;
  try {
    stat = await fs.promises.stat(abs);
  } catch (_e) {
    return null;
  }
  if (!stat.isFile()) return null;
  const validation = await validateLocalAudioFile(abs, ext);
  const root = relativeRoot ? path.resolve(relativeRoot) : path.dirname(abs);
  rememberLocalMusicRoot(root);
  const rel = path.relative(root, abs) || path.basename(abs);
  const webkitRelativePath = localLibraryRelativePath(root, rel);
  return {
    fullPath: abs,
    filePath: abs,
    url: localFileProxyUrl(abs),
    name: path.basename(abs),
    relativePath: webkitRelativePath,
    webkitRelativePath,
    size: stat.size,
    lastModified: Math.round(stat.mtimeMs),
    type: LOCAL_LIBRARY_MIME[ext] || '',
    playable: validation.playable,
    validationError: validation.error,
  };
}

async function scanLocalMusicFolder(folderPath) {
  const root = rememberLocalMusicRoot(folderPath);
  const files = [];
  const stack = [''];
  let visited = 0;
  while (stack.length) {
    const relDir = stack.pop();
    const absDir = path.join(root, relDir);
    let entries = [];
    try {
      entries = await fs.promises.readdir(absDir, { withFileTypes: true });
    } catch (_e) {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }));
    for (const entry of entries) {
      visited += 1;
      if (visited > 60000) break;
      const rel = path.join(relDir, entry.name);
      const abs = path.join(root, rel);
      if (entry.isDirectory()) {
        stack.push(rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!LOCAL_LIBRARY_EXTS.has(ext)) continue;
      let stat = null;
      try {
        stat = await fs.promises.stat(abs);
      } catch (_e) {
        continue;
      }
      const webkitRelativePath = localLibraryRelativePath(root, rel);
      const validation = await validateLocalAudioFile(abs, ext);
      files.push({
        fullPath: abs,
        filePath: abs,
        url: localFileProxyUrl(abs),
        name: entry.name,
        relativePath: webkitRelativePath,
        webkitRelativePath,
        size: stat.size,
        lastModified: Math.round(stat.mtimeMs),
        type: LOCAL_LIBRARY_MIME[ext] || '',
        playable: validation.playable,
        validationError: validation.error,
      });
    }
    if (visited > 60000) break;
  }
  return { ok: true, folderPath: root, files, truncated: visited > 60000 };
}

async function refreshLocalMusicFileEntries(folderPath, files) {
  const root = rememberLocalMusicRoot(folderPath);
  const list = Array.isArray(files) ? files : [];
  const out = [];
  for (const file of list) {
    if (!file) continue;
    const rawPath = file.fullPath || file.filePath || file.path || file.localFilePathAbsolute || '';
    if (!rawPath) continue;
    const abs = path.resolve(String(rawPath));
    if (abs !== root && !abs.startsWith(root + path.sep)) continue;
    const ext = path.extname(file.name || abs).toLowerCase();
    if (!LOCAL_LIBRARY_EXTS.has(ext)) continue;
    let stat = null;
    try {
      stat = await fs.promises.stat(abs);
    } catch (_e) {
      continue;
    }
    if (!stat.isFile()) continue;
    out.push({
      ...file,
      fullPath: abs,
      filePath: abs,
      url: localFileProxyUrl(abs),
      name: file.name || path.basename(abs),
      relativePath: file.relativePath || file.webkitRelativePath || localLibraryRelativePath(root, path.relative(root, abs)),
      webkitRelativePath: file.webkitRelativePath || file.relativePath || localLibraryRelativePath(root, path.relative(root, abs)),
      size: stat.size,
      lastModified: Math.round(stat.mtimeMs),
      type: file.type || LOCAL_LIBRARY_MIME[ext] || '',
    });
  }
  return { ok: true, folderPath: root, files: out, snapshot: true };
}

async function readAuthorizedLocalFileRange(filePath, start, end) {
  const target = resolveAuthorizedLocalFile(filePath);
  const stat = await fs.promises.stat(target);
  if (!stat.isFile()) throw new Error('LOCAL_FILE_NOT_FOUND');
  const fileSize = stat.size;
  const from = Math.max(0, Math.min(fileSize, Number(start) || 0));
  const requestedEnd = end == null ? fileSize : Number(end);
  const to = Math.max(from, Math.min(fileSize, Number.isFinite(requestedEnd) ? requestedEnd : fileSize));
  const maxBytes = 64 * 1024 * 1024;
  const length = Math.min(maxBytes, to - from);
  const handle = await fs.promises.open(target, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const result = await handle.read(buffer, 0, length, from);
    return { ok: true, size: fileSize, start: from, end: from + result.bytesRead, base64: buffer.subarray(0, result.bytesRead).toString('base64') };
  } finally {
    await handle.close();
  }
}

async function readAuthorizedLocalFileDataUrl(filePath) {
  const target = resolveAuthorizedLocalFile(filePath);
  const ext = path.extname(target).toLowerCase();
  const mime = LOCAL_LIBRARY_MIME[ext] || 'application/octet-stream';
  if (!mime.startsWith('image/')) throw new Error('LOCAL_FILE_NOT_IMAGE');
  const stat = await fs.promises.stat(target);
  if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('LOCAL_IMAGE_TOO_LARGE');
  const buffer = await fs.promises.readFile(target);
  return { ok: true, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
}

function sendWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const state = getWindowState(win);
  try {
    if (typeof win.webContents.setFrameRate === 'function') {
      win.webContents.setFrameRate(state.isMinimized || state.isVisible === false
        ? 15
        : Math.max(60, Math.min(240, Number(state.displayFrequency) || 120)));
    }
  } catch (_frameRateError) {}
  win.webContents.send('desktop-window-state', state);
}

function sendGlobalHotkeyAction(action) {
  if (!mainWindow || mainWindow.isDestroyed() || !action) return;
  mainWindow.webContents.send('mineradio-global-hotkey', { action });
}

function handleGlobalHotkeyAction(action) {
  if (action !== 'toggleDesktopInteraction') {
    sendGlobalHotkeyAction(action);
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed() || desktopInteractionHotkeyBusy) return;
  // The desktop layer hotkey must remain functional even when the renderer is
  // hidden behind Explorer or has not yet attached its IPC listener. Perform
  // the actual layer switch in the main process whenever desktop mode is active.
  if (mainWindowDesktopEmbedded) {
    desktopInteractionHotkeyBusy = true;
    toggleMainWindowDesktopInteraction()
      .catch(() => {})
      .finally(() => { desktopInteractionHotkeyBusy = false; });
    return;
  }
  // Outside desktop mode the renderer owns the wallpaper payload. Ask it to
  // enable desktop mode, after which subsequent presses switch the two layers
  // directly in this process.
  sendGlobalHotkeyAction(action);
}

function storedHotkeyToAccelerator(hotkey) {
  const parts = String(hotkey || '').split('+').filter(Boolean);
  if (!parts.length) return '';
  return parts.map((part) => {
    if (part === 'Ctrl') return 'Control';
    if (part === 'Meta') return 'Super';
    if (part === 'ArrowLeft') return 'Left';
    if (part === 'ArrowRight') return 'Right';
    if (part === 'ArrowUp') return 'Up';
    if (part === 'ArrowDown') return 'Down';
    if (/^Key[A-Z]$/.test(part)) return part.slice(3);
    if (/^Digit[0-9]$/.test(part)) return part.slice(5);
    return part;
  }).join('+');
}

function desktopInteractionBootstrapAccelerator() {
  const fallback = DESKTOP_INTERACTION_FALLBACK_HOTKEYS[0];
  try {
    const saved = readDesktopUiState().values?.['mineradio-hotkey-settings-v1'];
    if (!saved) return fallback;
    const settings = JSON.parse(saved);
    const accelerator = storedHotkeyToAccelerator(settings?.global?.toggleDesktopInteraction);
    return accelerator || fallback;
  } catch (_error) {
    return fallback;
  }
}

function registerBootstrapDesktopInteractionHotkey() {
  const preferred = desktopInteractionBootstrapAccelerator();
  const accelerators = [preferred, ...DESKTOP_INTERACTION_FALLBACK_HOTKEYS]
    .filter((item, index, all) => item && all.indexOf(item) === index);
  for (const accelerator of accelerators) {
    let registered = false;
    try {
      registered = globalShortcut.register(accelerator, () => handleGlobalHotkeyAction('toggleDesktopInteraction'));
    } catch (_error) {
      registered = false;
    }
    if (registered) {
      registeredGlobalHotkeys.set(accelerator, 'toggleDesktopInteraction');
      if (accelerator !== preferred) console.warn(`Desktop interaction hotkey fallback registered: ${accelerator}`);
      return;
    }
  }
  console.warn(`Desktop interaction hotkey unavailable: ${accelerators.join(', ')}`);
}

function unregisterMineradioGlobalHotkeys() {
  for (const accelerator of registeredGlobalHotkeys.keys()) {
    try { globalShortcut.unregister(accelerator); } catch (e) {}
  }
  registeredGlobalHotkeys.clear();
}

function configureMineradioGlobalHotkeys(bindings = []) {
  unregisterMineradioGlobalHotkeys();
  const results = [];
  const seen = new Set();
  const normalizedBindings = (Array.isArray(bindings) ? bindings : []).slice();
  if (!normalizedBindings.some(item => item && item.action === 'toggleDesktopInteraction')) {
    normalizedBindings.push({ action: 'toggleDesktopInteraction', accelerator: DESKTOP_INTERACTION_FALLBACK_HOTKEYS[0], fallback: true });
  }
  for (const item of normalizedBindings) {
    const action = item && String(item.action || '').trim();
    const accelerator = item && String(item.accelerator || '').trim();
    if (!action || !accelerator || seen.has(accelerator)) continue;
    seen.add(accelerator);
    let registered = false;
    try {
      registered = globalShortcut.register(accelerator, () => handleGlobalHotkeyAction(action));
    } catch (error) {
      registered = false;
    }
    if (registered) {
      registeredGlobalHotkeys.set(accelerator, action);
      results.push({ action, accelerator, ok: true });
    } else {
      results.push({
        action,
        accelerator,
        ok: false,
        conflict: {
          sourceName: '系统 / 其他软件',
          sourceIcon: 'warning',
          reason: '该组合键已被占用或被系统保留',
        },
      });
    }
  }
  return { ok: true, results };
}

function scheduleWindowStateSend(win, delay = 80) {
  if (!win || win.isDestroyed()) return;
  if (mainWindowStateTimer) clearTimeout(mainWindowStateTimer);
  mainWindowStateTimer = setTimeout(() => {
    mainWindowStateTimer = null;
    sendWindowState(win);
  }, delay);
}

function rectsOverlapOnY(a, b) {
  if (!a || !b) return false;
  const aTop = Number(a.y) || 0;
  const bTop = Number(b.y) || 0;
  const aBottom = aTop + (Number(a.height) || 0);
  const bBottom = bTop + (Number(b.height) || 0);
  return aBottom > bTop && bBottom > aTop;
}

function getDisplayState(win) {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const display = win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds())
    : primary;
  const bounds = display && display.bounds ? display.bounds : primary.bounds;
  const displayId = display && display.id;
  const primaryId = primary && primary.id;
  const edgeTolerance = 2;
  const hasDisplayOnLeft = displays.some((candidate) => {
    if (!candidate || candidate.id === displayId || !candidate.bounds) return false;
    return rectsOverlapOnY(bounds, candidate.bounds)
      && Math.abs((candidate.bounds.x + candidate.bounds.width) - bounds.x) <= edgeTolerance;
  });
  const hasDisplayOnRight = displays.some((candidate) => {
    if (!candidate || candidate.id === displayId || !candidate.bounds) return false;
    return rectsOverlapOnY(bounds, candidate.bounds)
      && Math.abs((bounds.x + bounds.width) - candidate.bounds.x) <= edgeTolerance;
  });
  return {
    displayId,
    primaryDisplayId: primaryId,
    displayFrequency: Math.max(30, Number(display && display.displayFrequency) || 60),
    isPrimaryDisplay: !!(display && primary && display.id === primary.id),
    hasDisplayOnLeft,
    hasDisplayOnRight,
    displayBounds: bounds ? {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    } : null,
  };
}

function getWindowState(win) {
  if (!win || win.isDestroyed()) return {
    isMaximized: false,
    isNativeFullScreen: false,
    isHtmlFullScreen: false,
    isWindowFullScreen: false,
    isFullScreen: false,
    isMinimized: false,
    isVisible: false,
    isFocused: false,
    bounds: null,
    normalBounds: null,
    isPrimaryDisplay: true,
    displayFrequency: 60,
    hasDisplayOnLeft: false,
    hasDisplayOnRight: false,
    displayBounds: null,
  };
  return {
    isMaximized: win.isMaximized(),
    isNativeFullScreen: win.isFullScreen(),
    isHtmlFullScreen: htmlFullscreenActive,
    isWindowFullScreen: windowFullscreenActive,
    isFullScreen: win.isFullScreen() || htmlFullscreenActive || windowFullscreenActive,
    isMinimized: win.isMinimized(),
    isVisible: win.isVisible(),
    isFocused: win.isFocused(),
    bounds: win.getBounds(),
    normalBounds: typeof win.getNormalBounds === 'function' ? win.getNormalBounds() : win.getBounds(),
    isDesktopEmbedded: mainWindowDesktopEmbedded,
    isDesktopInteractive: mainWindowDesktopInteractive,
    ...getDisplayState(win),
  };
}

function getSenderWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  // Windows 隐藏到托盘时会同时从任务栏移除，恢复时必须显式加回来。
  // 托盘的 click 事件在部分 Windows 隐藏图标面板中可能重复触发，
  // 因此恢复操作必须保持幂等：无论触发一次还是多次，都只显示和置前窗口。
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  if (typeof mainWindow.moveTop === 'function') mainWindow.moveTop();
  mainWindow.focus();
  sendWindowState(mainWindow);
  return true;
}

function hideMainWindowToTray({ pauseLinked = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  try { mainWindow.webContents.send('mineradio-tray-command', { command: 'persist-session' }); } catch (_e) {}
  if (pauseLinked) pauseLinkedLxPlayback();
  mainWindow.setSkipTaskbar(true);
  mainWindow.hide();
  sendWindowState(mainWindow);
  return true;
}

function toggleMainWindowFromTray() {
  // 左键托盘图标只恢复窗口，不再执行显示/隐藏切换。
  // 隐藏仍由关闭按钮或托盘右键菜单完成，避免重复 click 导致刚显示又隐藏。
  return focusMainWindow();
}

/**
 * 读取桌面壳设置文件。托盘关闭策略需要早于前端加载生效，所以放在主进程持久化。
 * @returns {{closeToTray?: boolean}} 已保存的桌面壳设置。
 */
function readDesktopShellSettings() {
  try {
    const file = path.join(app.getPath('userData'), DESKTOP_SHELL_SETTINGS_FILE);
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch (_e) {
    return {};
  }
}

/**
 * 写入桌面壳设置文件。该文件只保存主进程必须提前知道的窗口行为。
 * @param {{closeToTray?: boolean}} patch 要覆盖的设置字段。
 * @returns {{closeToTray?: boolean}} 写入后的完整设置。
 */
function writeDesktopShellSettings(patch) {
  const file = path.join(app.getPath('userData'), DESKTOP_SHELL_SETTINGS_FILE);
  const next = { ...readDesktopShellSettings(), ...(patch || {}) };
  writeJsonFileAtomic(file, next);
  return next;
}

function resolveNetworkSplitEnabled() {
  if (process.env.MINERADIO_FORCE_DIRECT_ROUTE === '1') return true;
  if (process.env.MINERADIO_FORCE_DIRECT_ROUTE === '0') return false;
  const saved = readDesktopShellSettings();
  return typeof saved.networkSplitEnabled === 'boolean' ? saved.networkSplitEnabled : true;
}

async function applyNetworkSplitMode(enabled, reason = 'runtime') {
  const nextEnabled = enabled !== false;
  if (nextEnabled) {
    if (!directLocalProxy) directLocalProxy = await createDirectLocalProxy();
    await session.defaultSession.setProxy({
      mode: 'fixed_servers',
      proxyRules: `http://127.0.0.1:${directLocalProxy.port}`,
      proxyBypassRules: 'localhost,127.0.0.1,<local>',
    });
    networkSplitEnabled = true;
    console.info(`[NetworkSplit] enabled (${reason}): ordinary traffic direct via ${directLocalProxy.localAddress}; Spotify keeps the system route`);
  } else {
    await session.defaultSession.setProxy({ mode: 'system' });
    const previousProxy = directLocalProxy;
    directLocalProxy = null;
    networkSplitEnabled = false;
    if (previousProxy) await previousProxy.close().catch(() => {});
    console.info(`[NetworkSplit] disabled (${reason}): all traffic follows the Windows system route`);
  }
  return { ok: true, enabled: networkSplitEnabled };
}

function queueNetworkSplitMode(enabled, reason) {
  networkSplitApplyPromise = networkSplitApplyPromise
    .catch(() => {})
    .then(() => applyNetworkSplitMode(enabled, reason))
    .catch((error) => {
      console.warn('[NetworkSplit] apply failed:', error && error.message || error);
      return { ok: false, enabled: networkSplitEnabled, error: error && error.message || 'NETWORK_SPLIT_APPLY_FAILED' };
    });
  return networkSplitApplyPromise;
}

function startNetworkSplitSettingsWatcher() {
  if (networkSplitSettingsWatcherStarted) return;
  networkSplitSettingsWatcherStarted = true;
  const file = path.join(app.getPath('userData'), DESKTOP_SHELL_SETTINGS_FILE);
  fs.watchFile(file, { interval: 800, persistent: false }, () => {
    const nextEnabled = resolveNetworkSplitEnabled();
    if (nextEnabled === networkSplitEnabled) return;
    queueNetworkSplitMode(nextEnabled, 'external-switch');
  });
}

function desktopUiStatePath() {
  return path.join(app.getPath('userData'), DESKTOP_UI_STATE_FILE);
}

function readRawDesktopUiState() {
  try {
    const file = desktopUiStatePath();
    if (!fs.existsSync(file)) return { schema: 1, values: {}, updatedAt: 0 };
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    return data && typeof data === 'object' && !Array.isArray(data)
      ? data
      : { schema: 1, values: {}, updatedAt: 0 };
  } catch (_e) {
    return { schema: 1, values: {}, updatedAt: 0 };
  }
}

function readDesktopUiState() {
  const data = readRawDesktopUiState();
  return {
    schema: 1,
    values: sanitizeDesktopUiStateValues(data.values),
    updatedAt: Number(data.updatedAt) || 0,
  };
}

function writeDesktopUiStatePatch(patch) {
  const current = readRawDesktopUiState();
  const values = sanitizeDesktopUiStateValues(current.values, { preserveOversizedKnownValues: true });
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (!DESKTOP_UI_STATE_KEYS.has(key)) return;
    if (value == null) {
      delete values[key];
      return;
    }
    const text = sanitizeDesktopUiStateValue(key, String(value));
    if (text == null) return;
    values[key] = text;
  });
  const next = { schema: 1, updatedAt: Date.now(), values };
  const file = desktopUiStatePath();
  writeJsonFileAtomic(file, next);
  return next;
}

function resetStartupCriticalUiState(reason, rendererValues = {}) {
  const current = readRawDesktopUiState();
  const removed = {};
  const rawValues = current.values && typeof current.values === 'object' && !Array.isArray(current.values)
    ? current.values
    : {};
  const values = sanitizeDesktopUiStateValues(rawValues, { preserveOversizedKnownValues: true });
  STARTUP_SAFE_RESET_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(rawValues, key)) removed[key] = rawValues[key];
    if (typeof rendererValues[key] === 'string') removed[key] = rendererValues[key];
    delete values[key];
  });
  if (!Object.keys(removed).length) return { ok: true, removed: [] };
  let backupDir = '';
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupDir = path.join(app.getPath('userData'), 'recovery', `startup-state-${stamp}`);
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'desktop-ui-state.json'), JSON.stringify(current, null, 2), 'utf8');
    fs.writeFileSync(path.join(backupDir, 'renderer-local-storage.json'), JSON.stringify({
      schema: 1,
      values: Object.fromEntries(Object.entries(removed).filter(([, value]) => typeof value === 'string')),
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(backupDir, 'reason.txt'), String(reason || 'startup-safe-mode'), 'utf8');
  } catch (backupError) {
    writeStartupDiagnostic('startup-safe-backup-failed', backupError);
    return { ok: false, error: 'STARTUP_SAFE_BACKUP_FAILED', removed: [] };
  }
  const next = { schema: 1, updatedAt: Date.now(), values };
  try {
    writeJsonFileAtomic(desktopUiStatePath(), next);
  } catch (writeError) {
    writeStartupDiagnostic('startup-safe-state-write-failed', writeError);
    return { ok: false, error: 'STARTUP_SAFE_STATE_WRITE_FAILED', removed: [], backupDir };
  }
  return {
    ok: true,
    removed: Object.keys(removed),
    backedUpRendererKeys: Object.keys(rendererValues).filter(key => Object.prototype.hasOwnProperty.call(removed, key)),
    backupDir,
  };
}

function beginProfileNativeStateRepair(rendererLayoutValue) {
  const pendingFile = profileNativeRepairPath(app.getPath('userData'));
  if (!fs.existsSync(pendingFile)) {
    profileNativeStartupRepairPending = false;
    return { ok: true, pending: false };
  }
  const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8')) || {};
  if (!pending.token) throw new Error('PROFILE_REPAIR_TOKEN_MISSING');
  if (rendererLayoutValue != null && typeof rendererLayoutValue !== 'string') {
    throw new Error('PROFILE_REPAIR_VALUE_INVALID');
  }
  if (typeof rendererLayoutValue === 'string' && rendererLayoutValue.length > 32 * 1024 * 1024) {
    throw new Error('PROFILE_REPAIR_VALUE_TOO_LARGE');
  }
  if (!pending.backupDir || !fs.existsSync(pending.backupDir)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(app.getPath('userData'), 'recovery', `native-state-repair-${stamp}`);
    fs.mkdirSync(backupDir, { recursive: true });
    writeJsonFileAtomic(path.join(backupDir, 'renderer-local-storage.json'), {
      schema: 1,
      values: rendererLayoutValue == null ? {} : { 'mineradio-lyric-layout-v1': rendererLayoutValue },
    });
    fs.writeFileSync(path.join(backupDir, 'reason.txt'), 'one-time native startup state compatibility repair', 'utf8');
    pending.backupDir = backupDir;
    pending.backedUpAt = Date.now();
    writeJsonFileAtomic(pendingFile, pending);
  }
  profileNativeStartupRepairPending = true;
  return { ok: true, pending: true, token: String(pending.token) };
}

function completeProfileNativeStateRepair(token) {
  const stableDir = app.getPath('userData');
  const pendingFile = profileNativeRepairPath(stableDir);
  if (!fs.existsSync(pendingFile)) {
    writeJsonFileAtomic(profileNativeRepairCompletePath(stableDir), { schema: 1, completedAt: Date.now() });
    profileNativeStartupRepairPending = false;
    return { ok: true, completed: true };
  }
  const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8')) || {};
  if (!token || String(token) !== String(pending.token || '')) {
    return { ok: false, error: 'PROFILE_REPAIR_TOKEN_MISMATCH' };
  }
  writeJsonFileAtomic(profileNativeRepairCompletePath(stableDir), {
    schema: 1,
    completedAt: Date.now(),
    backupDir: String(pending.backupDir || ''),
  });
  fs.unlinkSync(pendingFile);
  profileNativeStartupRepairPending = false;
  return { ok: true, completed: true };
}

function markMainWindowStartupReady(payload) {
  mainWindowStartupReady = true;
  if (mainWindowSplashWatchdogTimer) {
    clearTimeout(mainWindowSplashWatchdogTimer);
    mainWindowSplashWatchdogTimer = null;
  }
  if (payload && payload.safeMode) mainWindowStartupSafeMode = true;
  // Renderer-ready is the authoritative startup signal. Do not keep a healthy
  // page hidden merely because an optional subresource has not fired window.load.
  if (mainWindow && !mainWindow.isDestroyed()) {
    restoreMainWindowElectronInteraction(mainWindow, true);
  }
}

/**
 * 应用已保存的桌面壳设置，确保关闭按钮行为在窗口创建前就确定。
 * @returns {void}
 */
function applySavedDesktopShellSettings() {
  const saved = readDesktopShellSettings();
  if (typeof saved.closeToTray === 'boolean') closeToTrayEnabled = saved.closeToTray;
}

/**
 * 读取 Windows 开机启动状态；开发环境和正式包都走 Electron 登录项接口。
 * @returns {boolean} 当前账号登录后是否自动启动 Mineradio。
 */
function isStartupEnabled() {
  if (process.platform !== 'win32') return false;
  try {
    return !!app.getLoginItemSettings().openAtLogin;
  } catch (_e) {
    return false;
  }
}

/**
 * 设置 Windows 开机启动。失败时直接抛错，由 IPC 返回明确错误。
 * @param {boolean} enabled 是否开启开机启动。
 * @returns {{ok:boolean, enabled:boolean}} 设置后的真实状态。
 */
function setStartupEnabled(enabled) {
  if (process.platform !== 'win32') return { ok: false, enabled: false, unsupported: true };
  app.setLoginItemSettings({
    openAtLogin: !!enabled,
    path: process.execPath,
    args: [],
  });
  return { ok: true, enabled: isStartupEnabled() };
}

/**
 * 根据当前状态重建托盘菜单，确保菜单勾选态和真实设置一致。
 * @returns {void}
 */
function refreshTrayMenu() {
  if (!tray) return;
  const songLabel = trayPlaybackState.title
    ? `${trayPlaybackState.title}${trayPlaybackState.artist ? ` - ${trayPlaybackState.artist}` : ''}`
    : '暂无正在播放的歌曲';
  const sendTrayCommand = (command, value) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mineradio-tray-command', { command, value });
    }
  };
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: songLabel.slice(0, 80), enabled: false },
    { type: 'separator' },
    { label: trayPlaybackState.playing ? '暂停' : '播放', click: () => sendTrayCommand('toggle-play') },
    { label: '上一曲', click: () => sendTrayCommand('previous') },
    { label: '下一曲', click: () => sendTrayCommand('next') },
    {
      label: `音量 ${Math.max(0, Math.min(100, Number(trayPlaybackState.volume) || 0))}%`,
      submenu: [
        { label: '音量 +10%', click: () => sendTrayCommand('volume', 10) },
        { label: '音量 -10%', click: () => sendTrayCommand('volume', -10) },
        { label: '静音 / 恢复', click: () => sendTrayCommand('mute') },
      ],
    },
    { type: 'separator' },
    { label: '显示 Mineradio', click: focusMainWindow },
    { label: '隐藏到托盘', click: hideMainWindowToTray },
    {
      label: desktopFusionOverlayState.softwareInteractionLocked
        ? '操作 Mineradio'
        : '返回桌面图标',
      visible: mainWindowDesktopEmbedded,
      click: () => toggleMainWindowDesktopInteraction(),
    },
    {
      label: '退出桌面播放器模式',
      visible: mainWindowDesktopEmbedded,
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('mineradio-wallpaper-command', { command: 'wallpaper-off' });
        }
        queueWallpaperModeTransition(false, { enabled: false, source: 'tray' });
      },
    },
    {
      label: '关闭按钮隐藏到托盘',
      type: 'checkbox',
      checked: closeToTrayEnabled,
      click: (item) => {
        closeToTrayEnabled = !!item.checked;
        writeDesktopShellSettings({ closeToTray: closeToTrayEnabled });
        refreshTrayMenu();
      },
    },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: isStartupEnabled(),
      click: (item) => {
        const result = setStartupEnabled(item.checked);
        if (!result.ok) item.checked = false;
        refreshTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: '退出 Mineradio',
      click: () => {
        // Windows 托盘菜单在任务栏上方弹出时，鼠标可能正好压在“退出”区域。
        // 右键刚弹出菜单的瞬间先忽略退出动作，避免误触导致程序直接关闭。
        if (Date.now() < trayRightClickGuardUntil) return;
        appQuitting = true;
        app.quit();
      },
    },
    // 托盘图标靠近任务栏底部时，菜单底部最容易被误点。
    // 放一个不可点的“取消”垫底，避免右键弹出时直接落到退出项。
    { label: '取消', enabled: false },
  ]));
}

/**
 * 创建系统托盘入口。托盘用于恢复窗口、切换关闭到托盘和开机启动。
 * @returns {void}
 */
function createTray() {
  if (tray || process.platform !== 'win32' || !app.isReady()) return !!tray;
  if (trayCreateRetryTimer) {
    clearTimeout(trayCreateRetryTimer);
    trayCreateRetryTimer = null;
  }
  // Prefer the dedicated PNG. Unsigned in-place upgrades can leave a stale
  // Windows notification-area registration when a fixed GUID is reused.
  const candidates = [APP_TRAY_ICON_PNG, APP_ICON_ICO, process.execPath].filter((item, index, list) => item && list.indexOf(item) === index && (item === process.execPath || fs.existsSync(item)));
  let lastError = null;
  for (const iconPath of candidates) {
    try {
      let icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty()) continue;
      if (iconPath !== APP_ICON_ICO) icon = icon.resize({ width: 16, height: 16, quality: 'best' });
      tray = new Tray(icon);
      break;
    } catch (error) {
      lastError = error;
      tray = null;
    }
  }
  if (!tray) {
    trayCreateAttempts += 1;
    const delay = Math.min(15000, 1000 * Math.max(1, trayCreateAttempts));
    console.warn('[Tray] creation failed; retrying in', delay, 'ms', lastError || 'no usable icon');
    trayCreateRetryTimer = setTimeout(createTray, delay);
    return false;
  }
  trayCreateAttempts = 0;
  tray.setToolTip(`${APP_NAME}（单击显示窗口）`);
  tray.on('click', focusMainWindow);
  tray.on('double-click', focusMainWindow);
  tray.on('right-click', () => {
    trayRightClickGuardUntil = Date.now() + 900;
    if (tray) tray.popUpContextMenu();
  });
  tray.on('destroyed', () => {
    tray = null;
    if (!appQuitting) trayCreateRetryTimer = setTimeout(createTray, 1200);
  });
  refreshTrayMenu();
  console.info('[Tray] ready');
  return true;
}

function getUpdateDownloadDir() {
  return path.join(app.getPath('userData'), 'updates');
}

function shouldEnsureDesktopShortcut() {
  if (process.platform !== 'win32') return false;
  if (process.env.MINERADIO_NO_DESKTOP_SHORTCUT === '1') return false;
  // The installer owns shortcut creation. Recreating a deleted shortcut on
  // every packaged-app launch ignores the user's explicit deletion.
  return process.env.MINERADIO_CREATE_DESKTOP_SHORTCUT === '1';
}

function ensureDesktopShortcut() {
  if (!shouldEnsureDesktopShortcut()) return { ok: false, skipped: true };
  try {
    const shortcutPath = path.join(app.getPath('desktop'), `${DESKTOP_SHORTCUT_NAME}.lnk`);
    const target = process.execPath;
    // Per-machine installers create the shortcut on the Public desktop. Do
    // not create a second, visually identical shortcut on the user's desktop.
    const publicShortcutPath = process.env.PUBLIC
      ? path.join(process.env.PUBLIC, 'Desktop', `${DESKTOP_SHORTCUT_NAME}.lnk`)
      : '';
    if (publicShortcutPath && fs.existsSync(publicShortcutPath) && shell.readShortcutLink) {
      try {
        const publicShortcut = shell.readShortcutLink(publicShortcutPath);
        if (path.resolve(publicShortcut.target || '') === path.resolve(target)) {
          if (fs.existsSync(shortcutPath)) {
            try {
              const userShortcut = shell.readShortcutLink(shortcutPath);
              if (path.resolve(userShortcut.target || '') === path.resolve(target)) fs.unlinkSync(shortcutPath);
            } catch (_) {}
          }
          return { ok: true, path: publicShortcutPath, existing: true, public: true };
        }
      } catch (_) {}
    }
    const shortcut = {
      target,
      cwd: path.dirname(target),
      args: '',
      description: 'Mineradio desktop music player',
      icon: fs.existsSync(APP_ICON_ICO) ? APP_ICON_ICO : target,
      iconIndex: 0,
      appUserModelId: APP_USER_MODEL_ID,
    };

    if (fs.existsSync(shortcutPath) && shell.readShortcutLink) {
      try {
        const existing = shell.readShortcutLink(shortcutPath);
        const expectedIcon = fs.existsSync(APP_ICON_ICO) ? APP_ICON_ICO : target;
        const existingIcon = String(existing.icon || '');
        const shortcutOk = existing &&
          path.resolve(existing.target || '') === path.resolve(target) &&
          String(existing.args || '') === '' &&
          String(existing.appUserModelId || '') === APP_USER_MODEL_ID &&
          existingIcon &&
          path.resolve(existingIcon) === path.resolve(expectedIcon);
        if (shortcutOk) {
          return { ok: true, path: shortcutPath, existing: true };
        }
      } catch (_) {}
      shell.writeShortcutLink(shortcutPath, 'replace', shortcut);
    } else {
      shell.writeShortcutLink(shortcutPath, 'create', shortcut);
    }
    return { ok: true, path: shortcutPath, created: true };
  } catch (e) {
    console.warn('Desktop shortcut creation skipped:', e.message);
    return { ok: false, error: e.message || 'DESKTOP_SHORTCUT_FAILED' };
  }
}

function savedWindowedBounds() {
  const saved = readDesktopShellSettings().windowBounds;
  if (!saved || typeof saved !== 'object') return null;
  const bounds = {
    x: Math.round(Number(saved.x)),
    y: Math.round(Number(saved.y)),
    width: Math.round(Number(saved.width)),
    height: Math.round(Number(saved.height)),
  };
  if (!Object.values(bounds).every(Number.isFinite)) return null;
  if (bounds.width < MIN_WINDOWED_WIDTH || bounds.height < MIN_WINDOWED_HEIGHT) return null;

  // Keep a restored window reachable when a monitor was removed or its DPI changed.
  const displays = screen.getAllDisplays();
  const visible = displays.some(display => {
    const area = display.workArea || display.bounds;
    const overlapWidth = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x));
    const overlapHeight = Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
    return overlapWidth >= 120 && overlapHeight >= 80;
  });
  if (!visible) return null;

  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea || display.bounds;
  bounds.width = Math.min(bounds.width, area.width);
  bounds.height = Math.min(bounds.height, area.height);
  bounds.x = Math.min(Math.max(bounds.x, area.x - bounds.width + 120), area.x + area.width - 120);
  bounds.y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - 80);
  return bounds;
}

function scheduleMainWindowBoundsSave(win) {
  if (!win || win.isDestroyed() || windowFullscreenActive || htmlFullscreenActive || win.isFullScreen() || win.isMaximized() || win.isMinimized()) return;
  if (mainWindowBoundsSaveTimer) clearTimeout(mainWindowBoundsSaveTimer);
  mainWindowBoundsSaveTimer = setTimeout(() => {
    mainWindowBoundsSaveTimer = null;
    if (!win || win.isDestroyed() || windowFullscreenActive || htmlFullscreenActive || win.isFullScreen() || win.isMaximized() || win.isMinimized()) return;
    writeDesktopShellSettings({ windowBounds: win.getBounds() });
  }, 250);
}

function getWindowedBounds(win, useSaved = true) {
  if (useSaved) {
    const saved = savedWindowedBounds();
    if (saved) return saved;
  }
  const display = win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds())
    : screen.getPrimaryDisplay();
  const area = display.workArea;
  const basis = display.bounds || area;
  const maxWidth = Math.max(640, area.width - WINDOWED_MARGIN);
  const maxHeight = Math.max(360, area.height - WINDOWED_MARGIN);

  let width = Math.round(basis.width * WINDOWED_SCALE);
  let height = Math.round(width / WINDOWED_ASPECT);
  const scaledHeight = Math.round(basis.height * WINDOWED_SCALE);

  if (height > scaledHeight) {
    height = scaledHeight;
    width = Math.round(height * WINDOWED_ASPECT);
  }

  if (width < MIN_WINDOWED_WIDTH && maxWidth >= MIN_WINDOWED_WIDTH && maxHeight >= MIN_WINDOWED_HEIGHT) {
    width = MIN_WINDOWED_WIDTH;
    height = MIN_WINDOWED_HEIGHT;
  }

  if (width > maxWidth) {
    width = maxWidth;
    height = Math.round(width / WINDOWED_ASPECT);
  }
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * WINDOWED_ASPECT);
  }

  width = Math.round(width);
  height = Math.round(height);

  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

function capturePreFullscreenBounds(win) {
  if (!win || win.isDestroyed()) return null;
  const bounds = win.isMaximized() && typeof win.getNormalBounds === 'function'
    ? win.getNormalBounds()
    : win.getBounds();
  if (!bounds || bounds.width < MIN_WINDOWED_WIDTH || bounds.height < MIN_WINDOWED_HEIGHT) return null;
  mainWindowPreFullscreenBounds = { ...bounds };
  writeDesktopShellSettings({ windowBounds: mainWindowPreFullscreenBounds });
  return mainWindowPreFullscreenBounds;
}

function applyWindowedBounds(win, preferredBounds = null) {
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized()) win.unmaximize();
  win.setMinimumSize(MIN_WINDOWED_WIDTH, MIN_WINDOWED_HEIGHT);
  const target = preferredBounds || mainWindowPreFullscreenBounds || getWindowedBounds(win);
  const restore = () => {
    if (!win || win.isDestroyed() || win.isFullScreen()) return;
    if (win.isMaximized()) win.unmaximize();
    win.setBounds(target, false);
    sendWindowState(win);
  };
  restore();
  // Windows can briefly re-apply the pre-fullscreen maximized state after the
  // leave-full-screen event. Reassert the exact saved normal bounds once more.
  setTimeout(restore, 160);
  sendWindowState(win);
}

function capturePreDesktopWindowState(win) {
  if (!win || win.isDestroyed()) return null;
  const wasMaximized = win.isMaximized();
  const wasFullScreen = win.isFullScreen();
  const wasWindowFullscreen = windowFullscreenActive;
  let bounds = null;
  if ((wasFullScreen || wasWindowFullscreen) && mainWindowPreFullscreenBounds) {
    bounds = mainWindowPreFullscreenBounds;
  } else if (typeof win.getNormalBounds === 'function') {
    bounds = win.getNormalBounds();
  }
  if (!bounds || bounds.width < MIN_WINDOWED_WIDTH || bounds.height < MIN_WINDOWED_HEIGHT) {
    bounds = savedWindowedBounds() || win.getBounds();
  }
  mainWindowPreDesktopBounds = { ...bounds };
  mainWindowPreDesktopState = {
    bounds: { ...bounds },
    wasMaximized,
    wasFullScreen,
    wasWindowFullscreen,
  };
  return mainWindowPreDesktopState;
}

function restorePreDesktopWindowState(win, snapshot) {
  if (!win || win.isDestroyed()) return;
  const state = snapshot || {};
  const bounds = state.bounds || mainWindowPreDesktopBounds || savedWindowedBounds() || getWindowedBounds(win);
  const applyNormalBounds = () => {
    if (!win || win.isDestroyed()) return;
    try { if (win.isFullScreen()) win.setFullScreen(false); } catch (_e) {}
    try { if (win.isMaximized()) win.unmaximize(); } catch (_e) {}
    try { win.setMinimumSize(MIN_WINDOWED_WIDTH, MIN_WINDOWED_HEIGHT); } catch (_e) {}
    try { win.setBounds(bounds, false); } catch (_e) {}
  };

  // Re-parenting out of WorkerW can make Windows re-apply the desktop-sized
  // placement after Electron has already restored the window. Reassert the
  // exact pre-desktop normal bounds across that transition, then restore the
  // original maximized/full-screen state only after the placement is stable.
  applyNormalBounds();
  setTimeout(applyNormalBounds, 140);
  setTimeout(applyNormalBounds, 360);
  setTimeout(() => {
    applyNormalBounds();
    if (!win || win.isDestroyed()) return;
    if (state.wasMaximized) {
      try { win.maximize(); } catch (_e) {}
    } else if (state.wasFullScreen || state.wasWindowFullscreen) {
      windowFullscreenActive = true;
      try { win.setFullScreen(true); } catch (_e) {}
    }
    sendWindowState(win);
  }, 700);
}

function exitFullscreenToWindow(win) {
  if (!win || win.isDestroyed()) return;
  const restoreBounds = mainWindowPreFullscreenBounds || savedWindowedBounds();
  windowFullscreenActive = false;

  if (!win.isFullScreen()) {
    applyWindowedBounds(win, restoreBounds);
    return;
  }

  let applied = false;
  const applyOnce = () => {
    if (applied || !win || win.isDestroyed() || win.isFullScreen()) return;
    applied = true;
    applyWindowedBounds(win, restoreBounds);
  };

  win.once('leave-full-screen', () => setTimeout(applyOnce, 50));
  win.setFullScreen(false);
  setTimeout(applyOnce, 500);
}

function toggleFullscreen(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isFullScreen() || windowFullscreenActive) {
    exitFullscreenToWindow(win);
    return;
  }
  capturePreFullscreenBounds(win);
  windowFullscreenActive = true;
  win.setFullScreen(true);
  sendWindowState(win);
}

function overlayUrl(page) {
  const port = mainServerPort || process.env.PORT || 3000;
  return `http://127.0.0.1:${port}/${page}`;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function desktopLyricsDefaultBounds(payload = desktopLyricsState) {
  const display = desktopLyricsUserBounds
    ? screen.getDisplayMatching(desktopLyricsUserBounds)
    : screen.getPrimaryDisplay();
  const bounds = display.bounds;
  const xRatio = clampNumber(payload.x, 0.02, 0.98, 0.5);
  const yRatio = clampNumber(payload.y, 0.08, 0.92, 0.76);
  const width = Math.round(Math.min(Math.max(880, bounds.width * 0.72), bounds.width - 96));
  const height = Math.round(Math.min(Math.max(340, bounds.height * 0.38), 560, bounds.height - 96));
  return {
    x: Math.round(bounds.x + (bounds.width - width) * xRatio),
    y: Math.round(bounds.y + bounds.height * yRatio - height / 2),
    width,
    height,
  };
}

function constrainDesktopLyricsBounds(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const area = display.bounds;
  const next = {
    ...bounds,
    width: Math.round(Math.min(Math.max(320, bounds.width), area.width)),
    height: Math.round(Math.min(Math.max(180, bounds.height), area.height)),
  };
  const maxX = area.x + Math.max(0, area.width - next.width);
  const maxY = area.y + Math.max(0, area.height - next.height);
  next.x = Math.round(clampNumber(next.x, area.x, maxX, area.x));
  next.y = Math.round(clampNumber(next.y, area.y, maxY, area.y));
  return next;
}

function setDesktopLyricsBounds(bounds) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const nextBounds = constrainDesktopLyricsBounds(bounds);
  const currentBounds = desktopLyricsWindow.getBounds();
  if (
    currentBounds.x === nextBounds.x
    && currentBounds.y === nextBounds.y
    && currentBounds.width === nextBounds.width
    && currentBounds.height === nextBounds.height
  ) {
    return;
  }
  desktopLyricsProgrammaticMove = true;
  desktopLyricsWindow.setBounds(nextBounds, false);
  setTimeout(() => {
    desktopLyricsProgrammaticMove = false;
  }, 120);
}

function rememberDesktopLyricsBounds() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed() || desktopLyricsProgrammaticMove) return;
  desktopLyricsUserBounds = desktopLyricsWindow.getBounds();
}

function applyDesktopLyricsMouseBehavior() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const locked = desktopLyricsState.clickThrough !== false;
  const mode = locked ? 'locked' : (desktopLyricsPointerCapture ? 'interactive' : 'hover-forward');
  if (desktopLyricsMouseIgnored === mode) return;
  desktopLyricsMouseIgnored = mode;
  // On Windows, forwarding mouse moves from a locked always-on-top overlay can
  // disturb the native move loop of another window passing underneath it. A
  // locked lyric window must therefore be completely inert. Forwarding is only
  // needed while unlocked so its controls can request pointer capture.
  if (mode === 'locked') desktopLyricsWindow.setIgnoreMouseEvents(true);
  else if (mode === 'hover-forward') desktopLyricsWindow.setIgnoreMouseEvents(true, { forward: true });
  else desktopLyricsWindow.setIgnoreMouseEvents(false);
}

function desktopLyricsHotBoundsOnScreen() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return null;
  const winBounds = desktopLyricsWindow.getBounds();
  const rel = desktopLyricsHotBounds;
  if (!rel) return winBounds;
  return {
    x: winBounds.x + rel.left,
    y: winBounds.y + rel.top,
    width: Math.max(1, rel.right - rel.left),
    height: Math.max(1, rel.bottom - rel.top),
  };
}

function pointInBounds(point, bounds) {
  if (!point || !bounds) return false;
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height;
}

function handleDesktopLyricsGlobalMiddleClick() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  if (!desktopLyricsState.enabled) return;
  const now = Date.now();
  if (now - desktopLyricsLastMiddleAt < 260) return;
  const point = screen.getCursorScreenPoint();
  if (!pointInBounds(point, desktopLyricsHotBoundsOnScreen())) return;
  desktopLyricsLastMiddleAt = now;
  const nextLocked = desktopLyricsState.clickThrough === false;
  desktopLyricsState = { ...desktopLyricsState, clickThrough: nextLocked };
  desktopLyricsPointerCapture = !nextLocked;
  applyDesktopLyricsMouseBehavior();
  broadcastDesktopLyricsLockState();
}

function startDesktopLyricsMousePoller() {
  if (process.platform !== 'win32' || desktopLyricsMousePoller) return;
  const script = `
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MineradioMousePoll {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
"@
$prev = $false
while ($true) {
  $down = (([MineradioMousePoll]::GetAsyncKeyState(4) -band 0x8000) -ne 0)
  if ($down -and -not $prev) {
    [Console]::Out.WriteLine("MMB")
    [Console]::Out.Flush()
  }
  $prev = $down
  Start-Sleep -Milliseconds 24
}
`;
  try {
    desktopLyricsMousePoller = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    desktopLyricsMousePoller.stdout.on('data', (chunk) => {
      desktopLyricsMousePollerBuffer += chunk.toString('utf8');
      const lines = desktopLyricsMousePollerBuffer.split(/\r?\n/);
      desktopLyricsMousePollerBuffer = lines.pop() || '';
      lines.forEach((line) => {
        if (line.trim() === 'MMB') handleDesktopLyricsGlobalMiddleClick();
      });
    });
    desktopLyricsMousePoller.on('exit', () => {
      desktopLyricsMousePoller = null;
      desktopLyricsMousePollerBuffer = '';
    });
    desktopLyricsMousePoller.on('error', () => {
      desktopLyricsMousePoller = null;
      desktopLyricsMousePollerBuffer = '';
    });
  } catch (e) {
    desktopLyricsMousePoller = null;
    desktopLyricsMousePollerBuffer = '';
  }
}

function stopDesktopLyricsMousePoller() {
  if (!desktopLyricsMousePoller) return;
  try {
    desktopLyricsMousePoller.kill();
  } catch (e) {}
  desktopLyricsMousePoller = null;
  desktopLyricsMousePollerBuffer = '';
}

function broadcastDesktopLyricsLockState() {
  const locked = desktopLyricsState.clickThrough !== false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mineradio-desktop-lyrics-lock-state', { locked });
  }
  sendDesktopLyricsState();
}

function broadcastDesktopLyricsEnabledState(enabled) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mineradio-desktop-lyrics-enabled-state', { enabled: !!enabled });
  }
}

function positionDesktopLyricsWindow(payload = desktopLyricsState, options = {}) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const shouldUseManualBounds = desktopLyricsUserBounds && !options.force;
  setDesktopLyricsBounds(shouldUseManualBounds ? desktopLyricsUserBounds : desktopLyricsDefaultBounds(payload));
  if (typeof desktopLyricsWindow.setOpacity === 'function') {
    desktopLyricsWindow.setOpacity(clampNumber(payload.opacity, 0.28, 1, 0.92));
  }
}

function sendDesktopLyricsState() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  desktopLyricsWindow.webContents.send('mineradio-desktop-lyrics-state', desktopLyricsState);
}

function createDesktopLyricsWindow(payload = {}) {
  const previousX = desktopLyricsState.x;
  const previousY = desktopLyricsState.y;
  const previousOpacity = desktopLyricsState.opacity;
  desktopLyricsState = { ...desktopLyricsState, ...payload, enabled: true };
  const hasX = Object.prototype.hasOwnProperty.call(payload || {}, 'x');
  const hasY = Object.prototype.hasOwnProperty.call(payload || {}, 'y');
  const nextX = clampNumber(desktopLyricsState.x, 0.02, 0.98, 0.5);
  const nextY = clampNumber(desktopLyricsState.y, 0.08, 0.92, 0.76);
  const xChanged = hasX && Number.isFinite(Number(previousX)) && Math.abs(nextX - clampNumber(previousX, 0.02, 0.98, 0.5)) > 0.001;
  const yChanged = hasY && Number.isFinite(Number(previousY)) && Math.abs(nextY - clampNumber(previousY, 0.08, 0.92, 0.76)) > 0.001;
  const opacityChanged = Object.prototype.hasOwnProperty.call(payload || {}, 'opacity')
    && Math.abs(clampNumber(desktopLyricsState.opacity, 0.28, 1, 0.92) - clampNumber(previousOpacity, 0.28, 1, 0.92)) > 0.001;
  const positionChanged = xChanged || yChanged;
  if (positionChanged) desktopLyricsUserBounds = null;
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    if (positionChanged) {
      positionDesktopLyricsWindow(desktopLyricsState, { force: true });
    } else if (opacityChanged && typeof desktopLyricsWindow.setOpacity === 'function') {
      desktopLyricsWindow.setOpacity(clampNumber(desktopLyricsState.opacity, 0.28, 1, 0.92));
    }
    applyDesktopLyricsMouseBehavior();
    sendDesktopLyricsState();
    return desktopLyricsWindow;
  }

  desktopLyricsWindow = new BrowserWindow({
    width: 920,
    height: 190,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: true,
    focusable: false,
    skipTaskbar: true,
    show: false,
    title: 'Mineradio Desktop Lyrics',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  try {
    desktopLyricsWindow.setAlwaysOnTop(true, 'screen-saver');
    desktopLyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (e) {
    console.warn('Desktop lyrics topmost setup skipped:', e.message);
  }
  startDesktopLyricsMousePoller();
  applyDesktopLyricsMouseBehavior();
  positionDesktopLyricsWindow(desktopLyricsState, { force: positionChanged || !desktopLyricsUserBounds });
  desktopLyricsWindow.once('ready-to-show', () => {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
    desktopLyricsWindow.showInactive();
    sendDesktopLyricsState();
  });
  desktopLyricsWindow.webContents.once('did-finish-load', sendDesktopLyricsState);
  desktopLyricsWindow.on('closed', () => {
    desktopLyricsWindow = null;
    desktopLyricsMouseIgnored = null;
  });
  desktopLyricsWindow.on('moved', rememberDesktopLyricsBounds);
  desktopLyricsWindow.loadURL(overlayUrl('desktop-lyrics.html')).catch((e) => console.warn('Desktop lyrics load failed:', e.message));
  return desktopLyricsWindow;
}

function closeDesktopLyricsWindow() {
  desktopLyricsState = { ...desktopLyricsState, enabled: false };
  desktopLyricsPointerCapture = false;
  desktopLyricsMouseIgnored = null;
  desktopLyricsHotBounds = null;
  stopDesktopLyricsMousePoller();
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    sendDesktopLyricsState();
    desktopLyricsWindow.close();
  }
  desktopLyricsWindow = null;
  broadcastDesktopLyricsEnabledState(false);
}

function nativeWindowHandleDecimal(win) {
  const handle = win.getNativeWindowHandle();
  if (process.arch === 'x64') return handle.readBigUInt64LE(0).toString();
  return String(handle.readUInt32LE(0));
}

function wallpaperEngineNativePhysicalBounds(win, fallback = {}) {
  const content = win && !win.isDestroyed()
    ? win.getContentBounds()
    : {
      x: Number(fallback.x) || 0,
      y: Number(fallback.y) || 0,
      width: Number(fallback.width) || 1280,
      height: Number(fallback.height) || 720,
    };
  const display = screen.getDisplayMatching(content);
  const scale = Math.max(1, Number(display && display.scaleFactor) || 1);
  let physical = null;
  if (win && !win.isDestroyed() && typeof screen.dipToScreenRect === 'function') {
    try { physical = screen.dipToScreenRect(win, content); } catch (_error) {}
  }
  if (!physical || Number(physical.width) <= 0 || Number(physical.height) <= 0) {
    const dipOrigin = { x: Number(content.x) || 0, y: Number(content.y) || 0 };
    const dipEnd = {
      x: dipOrigin.x + Math.max(1, Number(content.width) || Number(fallback.width) || 1280),
      y: dipOrigin.y + Math.max(1, Number(content.height) || Number(fallback.height) || 720),
    };
    const physicalOrigin = typeof screen.dipToScreenPoint === 'function'
      ? screen.dipToScreenPoint(dipOrigin)
      : { x: Math.round(dipOrigin.x * scale), y: Math.round(dipOrigin.y * scale) };
    const physicalEnd = typeof screen.dipToScreenPoint === 'function'
      ? screen.dipToScreenPoint(dipEnd)
      : { x: Math.round(dipEnd.x * scale), y: Math.round(dipEnd.y * scale) };
    physical = {
      x: Number(physicalOrigin.x) || 0,
      y: Number(physicalOrigin.y) || 0,
      width: Math.max(1, Math.abs(Math.round(Number(physicalEnd.x) - Number(physicalOrigin.x)))),
      height: Math.max(1, Math.abs(Math.round(Number(physicalEnd.y) - Number(physicalOrigin.y)))),
    };
  }
  const displayFps = Math.max(24, Math.min(240, Math.round(Number(display && display.displayFrequency) || 60)));
  const requestedFps = Number(fallback.fps);
  return {
    x: Math.round(Number(physical.x) || 0),
    y: Math.round(Number(physical.y) || 0),
    width: Math.max(640, Math.min(7680, Math.round(Number(physical.width) || 1920))),
    height: Math.max(360, Math.min(4320, Math.round(Number(physical.height) || 1080))),
    fps: Number.isFinite(requestedFps) && requestedFps > 0
      ? Math.max(24, Math.min(displayFps, 240, Math.round(requestedFps)))
      : displayFps,
  };
}

function clearWallpaperEngineNativeGrant(sessionId = '') {
  const expected = String(sessionId || '');
  if (expected && (!wallpaperEngineNativeGrant || wallpaperEngineNativeGrant.sessionId !== expected)) return false;
  if (!wallpaperEngineNativeGrant) return false;
  wallpaperEngineNativeGrant = null;
  return true;
}

function applyMainWindowBorderlessCorners(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  const hwnd = nativeWindowHandleDecimal(win);
  const script = `
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MineradioBorderlessCorners {
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr h, int attribute, ref int value, int size);
}
"@
$target=[IntPtr]::new([Int64]${hwnd})
$ncPolicy=1
$nativeCorner=1
[MineradioBorderlessCorners]::DwmSetWindowAttribute($target,2,[ref]$ncPolicy,4)|Out-Null
[MineradioBorderlessCorners]::DwmSetWindowAttribute($target,33,[ref]$nativeCorner,4)|Out-Null
`;
  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    timeout: 4000,
  }, () => {});
}

function restoreMainWindowElectronInteraction(win, focus = true) {
  if (!win || win.isDestroyed()) return;
  mainWindowDesktopInteractive = false;
  try { win.webContents.setBackgroundThrottling(true); } catch (_e) {}
  try { win.setResizable(true); } catch (_e) {}
  try { win.setMovable(true); } catch (_e) {}
  try { win.setFocusable(true); } catch (_e) {}
  try { win.setIgnoreMouseEvents(false); } catch (_e) {}
  try { win.setSkipTaskbar(false); } catch (_e) {}
  try { win.show(); } catch (_e) {}
  if (focus) {
    try { win.focus(); } catch (_e) {}
  }
  try { sendWindowState(win); } catch (_e) {}
}

function setMainWindowDesktopEmbedded(enabled, options = {}) {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ ok: false, error: 'MAIN_WINDOW_UNAVAILABLE' });
  }
  const next = !!enabled;
  if (!options.force && !mainWindowDesktopEmbeddingUncertain && next === mainWindowDesktopEmbedded) {
    return Promise.resolve({ ok: true, enabled: next });
  }
  const win = mainWindow;
  const hwnd = nativeWindowHandleDecimal(win);
  if (next) capturePreDesktopWindowState(win);
  const restoreState = mainWindowPreDesktopState;
  const restore = restoreState?.bounds || mainWindowPreDesktopBounds || savedWindowedBounds();
  const script = next ? `
$ErrorActionPreference = "Stop"
if (-not ("MineradioDesktopHost" -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MineradioDesktopHost {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindow(string c, string n);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string n);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder text, int max);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetParent(IntPtr child);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetClientRect(IntPtr h, out RECT rect);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr", SetLastError=true)] public static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtr", SetLastError=true)] public static extern IntPtr SetWindowLongPtr(IntPtr h, int index, IntPtr value);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
}
"@
}
$progman=[MineradioDesktopHost]::FindWindow("Progman",$null)
$result=[IntPtr]::Zero
if ($progman -ne [IntPtr]::Zero) {
  [MineradioDesktopHost]::SendMessageTimeout($progman,0x052C,[IntPtr]::new(0xD),[IntPtr]::new(1),0,1000,[ref]$result)|Out-Null
  [MineradioDesktopHost]::SendMessageTimeout($progman,0x052C,[IntPtr]::new(0xD),[IntPtr]::Zero,0,1000,[ref]$result)|Out-Null
  [MineradioDesktopHost]::SendMessageTimeout($progman,0x052C,[IntPtr]::Zero,[IntPtr]::Zero,0,1000,[ref]$result)|Out-Null
}
$script:iconHost=[IntPtr]::Zero
$script:workerw=[IntPtr]::Zero
$script:cleanWorker=[IntPtr]::Zero
$enum=[MineradioDesktopHost+EnumWindowsProc]{param([IntPtr]$top,[IntPtr]$p)
  $defView=[MineradioDesktopHost]::FindWindowEx($top,[IntPtr]::Zero,"SHELLDLL_DefView",$null)
  if($defView -ne [IntPtr]::Zero){
    $script:iconHost=$top
    $script:workerw=[MineradioDesktopHost]::FindWindowEx([IntPtr]::Zero,$top,"WorkerW",$null)
  }
  $className=New-Object System.Text.StringBuilder 64
  [MineradioDesktopHost]::GetClassName($top,$className,$className.Capacity)|Out-Null
  if($className.ToString() -eq "WorkerW" -and $defView -eq [IntPtr]::Zero){
    $script:cleanWorker=$top
  }
  return $true
}
[MineradioDesktopHost]::EnumWindows($enum,[IntPtr]::Zero)|Out-Null
if ($script:iconHost -eq [IntPtr]::Zero -and $progman -ne [IntPtr]::Zero) { $script:iconHost=$progman }
if ($script:workerw -eq [IntPtr]::Zero -and $script:cleanWorker -ne [IntPtr]::Zero) { $script:workerw=$script:cleanWorker }
if ($script:workerw -eq [IntPtr]::Zero -and $progman -ne [IntPtr]::Zero) { $script:workerw=$progman }
if ($script:workerw -eq [IntPtr]::Zero -and $script:iconHost -ne [IntPtr]::Zero) { $script:workerw=$script:iconHost }
if ($script:workerw -eq [IntPtr]::Zero) { throw "DESKTOP_HOST_NOT_FOUND" }
$target=[IntPtr]::new([Int64]${hwnd})
$style=[MineradioDesktopHost]::GetWindowLongPtr($target,-16).ToInt64()
$style=($style -band (-bnot 0x80C40000L)) -bor 0x40000000L
[MineradioDesktopHost]::SetWindowLongPtr($target,-16,[IntPtr]::new($style))|Out-Null
$exStyle=[MineradioDesktopHost]::GetWindowLongPtr($target,-20).ToInt64()
$exStyle=($exStyle -band (-bnot 0x00000080L)) -bor 0x00040000L
[MineradioDesktopHost]::SetWindowLongPtr($target,-20,[IntPtr]::new($exStyle))|Out-Null
[MineradioDesktopHost]::SetParent($target,$script:workerw)|Out-Null
if ([MineradioDesktopHost]::GetParent($target) -ne $script:workerw) { throw "DESKTOP_PARENT_FAILED" }
$rect=New-Object MineradioDesktopHost+RECT
if (-not [MineradioDesktopHost]::GetClientRect($script:workerw,[ref]$rect)) { throw "DESKTOP_BOUNDS_FAILED" }
$width=[Math]::Max(1,$rect.Right-$rect.Left)+16
$height=[Math]::Max(1,$rect.Bottom-$rect.Top)+16
[MineradioDesktopHost]::SetWindowPos($target,[IntPtr]::Zero,0,0,$width,$height,0x0070)|Out-Null
` : `
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MineradioDesktopDetach {
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetParent(IntPtr child);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr", SetLastError=true)] public static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtr", SetLastError=true)] public static extern IntPtr SetWindowLongPtr(IntPtr h, int index, IntPtr value);
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr h, int attribute, ref int value, int size);
}
"@
$target=[IntPtr]::new([Int64]${hwnd})
[MineradioDesktopDetach]::SetParent($target,[IntPtr]::Zero)|Out-Null
if ([MineradioDesktopDetach]::GetParent($target) -ne [IntPtr]::Zero) { throw "DESKTOP_DETACH_FAILED" }
$style=[MineradioDesktopDetach]::GetWindowLongPtr($target,-16).ToInt64()
$style=($style -band (-bnot 0x40000000L)) -bor 0x80000000L
[MineradioDesktopDetach]::SetWindowLongPtr($target,-16,[IntPtr]::new($style))|Out-Null
$exStyle=[MineradioDesktopDetach]::GetWindowLongPtr($target,-20).ToInt64()
$exStyle=($exStyle -band (-bnot 0x00000080L)) -bor 0x00040000L
[MineradioDesktopDetach]::SetWindowLongPtr($target,-20,[IntPtr]::new($exStyle))|Out-Null
$corner=2
[MineradioDesktopDetach]::DwmSetWindowAttribute($target,33,[ref]$corner,4)|Out-Null
[MineradioDesktopDetach]::SetWindowPos($target,[IntPtr]::Zero,${restore.x},${restore.y},${restore.width},${restore.height},0x0060)|Out-Null
`;
  mainWindowDesktopEmbeddingUncertain = true;
  return new Promise((resolve) => {
    execFile(WINDOWS_POWERSHELL_EXE, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      timeout: 6000,
    }, (error, _stdout, stderr) => {
      if (error || !mainWindow || mainWindow.isDestroyed()) {
        if (error) writeDesktopFusionDiagnostic(next ? 'embed' : 'detach', error, stderr);
        const detail = String(stderr || (error && error.message) || '').trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' | ').slice(0, 600);
        // PowerShell can fail after SetParent/style changes have already been
        // applied. Never leave the Electron window mouse-transparent merely
        // because the JS bookkeeping flag was not updated yet.
        if (mainWindow && !mainWindow.isDestroyed()) restoreMainWindowElectronInteraction(mainWindow, true);
        resolve({ ok: false, error: error ? 'DESKTOP_EMBED_FAILED' : 'MAIN_WINDOW_UNAVAILABLE', detail });
        return;
      }
      mainWindowDesktopEmbedded = next;
      mainWindowDesktopEmbeddingUncertain = false;
      mainWindowDesktopInteractive = false;
      // Desktop fusion is continuously visible and must remain at full speed.
      // Normal/minimized mode may use Chromium's power throttling.
      try { win.webContents.setBackgroundThrottling(!next); } catch (_e) {}
      win.setSkipTaskbar(false);
      try { win.setHasShadow(false); } catch (_e) {}
      applyMainWindowBorderlessCorners(win);
      if (next) {
        try { win.setResizable(false); } catch (_e) {}
        try { win.setMovable(false); } catch (_e) {}
        try { win.setFocusable(false); } catch (_e) {}
        // Fixed desktop fusion must be completely inert. Forwarding mouse moves
        // here lets Chromium keep running hover/edge-reveal handlers even though
        // clicks already pass through to Explorer.
        try { win.setIgnoreMouseEvents(true); } catch (_e) {}
        win.showInactive();
      } else {
        windowFullscreenActive = false;
        htmlFullscreenActive = false;
        try { win.setFullScreen(false); } catch (_e) {}
        try { win.setResizable(true); } catch (_e) {}
        try { win.setMovable(true); } catch (_e) {}
        try { win.setFocusable(true); } catch (_e) {}
        try { win.setIgnoreMouseEvents(false); } catch (_e) {}
        try { win.setHasShadow(false); } catch (_e) {}
        try {
          win.webContents.executeJavaScript('document.fullscreenElement && document.exitFullscreen ? document.exitFullscreen() : false', true).catch(() => {});
        } catch (_e) {}
        win.hide();
        restorePreDesktopWindowState(win, restoreState);
        win.show();
        win.focus();
        setTimeout(() => {
          if (mainWindowPreDesktopState === restoreState) {
            mainWindowPreDesktopState = null;
            mainWindowPreDesktopBounds = null;
          }
        }, 1200);
      }
      sendWindowState(win);
      refreshTrayMenu();
      resolve({ ok: true, enabled: next });
    });
  });
}

function setMainWindowDesktopInteractive(enabled) {
  if (!mainWindowDesktopEmbedded || !mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ ok: false, error: 'DESKTOP_MODE_INACTIVE' });
  }
  const next = !!enabled;
  const win = mainWindow;
  const hwnd = nativeWindowHandleDecimal(win);
  const desktopSourceBounds = mainWindowPreDesktopBounds || savedWindowedBounds();
  const interactiveBounds = screen.getDisplayMatching(desktopSourceBounds).bounds;
  const script = `
$ErrorActionPreference = "Stop"
if (-not ("MineradioDesktopLayer" -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MineradioDesktopLayer {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindow(string c, string n);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string n);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder text, int max);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetParent(IntPtr child);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetClientRect(IntPtr h, out RECT rect);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr", SetLastError=true)] public static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtr", SetLastError=true)] public static extern IntPtr SetWindowLongPtr(IntPtr h, int index, IntPtr value);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
}
"@
}
$progman=[MineradioDesktopLayer]::FindWindow("Progman",$null)
$result=[IntPtr]::Zero
if ($progman -ne [IntPtr]::Zero) {
  [MineradioDesktopLayer]::SendMessageTimeout($progman,0x052C,[IntPtr]::new(0xD),[IntPtr]::new(1),0,1000,[ref]$result)|Out-Null
  [MineradioDesktopLayer]::SendMessageTimeout($progman,0x052C,[IntPtr]::new(0xD),[IntPtr]::Zero,0,1000,[ref]$result)|Out-Null
  [MineradioDesktopLayer]::SendMessageTimeout($progman,0x052C,[IntPtr]::Zero,[IntPtr]::Zero,0,1000,[ref]$result)|Out-Null
}
$script:iconHost=[IntPtr]::Zero
$script:workerw=[IntPtr]::Zero
$script:cleanWorker=[IntPtr]::Zero
$enum=[MineradioDesktopLayer+EnumWindowsProc]{param([IntPtr]$top,[IntPtr]$p)
  $defView=[MineradioDesktopLayer]::FindWindowEx($top,[IntPtr]::Zero,"SHELLDLL_DefView",$null)
  if($defView -ne [IntPtr]::Zero){
    $script:iconHost=$top
    $script:workerw=[MineradioDesktopLayer]::FindWindowEx([IntPtr]::Zero,$top,"WorkerW",$null)
  }
  $className=New-Object System.Text.StringBuilder 64
  [MineradioDesktopLayer]::GetClassName($top,$className,$className.Capacity)|Out-Null
  if($className.ToString() -eq "WorkerW" -and $defView -eq [IntPtr]::Zero){
    $script:cleanWorker=$top
  }
  return $true
}
[MineradioDesktopLayer]::EnumWindows($enum,[IntPtr]::Zero)|Out-Null
if ($script:iconHost -eq [IntPtr]::Zero -and $progman -ne [IntPtr]::Zero) { $script:iconHost=$progman }
if ($script:workerw -eq [IntPtr]::Zero -and $script:cleanWorker -ne [IntPtr]::Zero) { $script:workerw=$script:cleanWorker }
if ($script:workerw -eq [IntPtr]::Zero -and $progman -ne [IntPtr]::Zero) { $script:workerw=$progman }
if ($script:workerw -eq [IntPtr]::Zero -and $script:iconHost -ne [IntPtr]::Zero) { $script:workerw=$script:iconHost }
if ($script:workerw -eq [IntPtr]::Zero) { throw "DESKTOP_HOST_NOT_FOUND" }
$target=[IntPtr]::new([Int64]${hwnd})
if (${next ? '$true' : '$false'}) {
  # Explorer's icon host always wins hit-testing over its child windows on
  # some Windows 11 builds. Detach while editing so every click reaches MR.
  [MineradioDesktopLayer]::SetParent($target,[IntPtr]::Zero)|Out-Null
  $style=[MineradioDesktopLayer]::GetWindowLongPtr($target,-16).ToInt64()
  $style=($style -band (-bnot 0x40C40000L)) -bor 0x80000000L
  [MineradioDesktopLayer]::SetWindowLongPtr($target,-16,[IntPtr]::new($style))|Out-Null
  if ([MineradioDesktopLayer]::GetParent($target) -ne [IntPtr]::Zero) { throw "DESKTOP_INTERACTIVE_DETACH_FAILED" }
  [MineradioDesktopLayer]::SetWindowPos($target,[IntPtr]::Zero,${interactiveBounds.x},${interactiveBounds.y},${interactiveBounds.width},${interactiveBounds.height},0x0060)|Out-Null
} else {
  $style=[MineradioDesktopLayer]::GetWindowLongPtr($target,-16).ToInt64()
  $style=($style -band (-bnot 0x80C40000L)) -bor 0x40000000L
  [MineradioDesktopLayer]::SetWindowLongPtr($target,-16,[IntPtr]::new($style))|Out-Null
  [MineradioDesktopLayer]::SetParent($target,$script:workerw)|Out-Null
  if ([MineradioDesktopLayer]::GetParent($target) -ne $script:workerw) { throw "DESKTOP_LAYER_FAILED" }
  $rect=New-Object MineradioDesktopLayer+RECT
  if (-not [MineradioDesktopLayer]::GetClientRect($script:workerw,[ref]$rect)) { throw "DESKTOP_BOUNDS_FAILED" }
  $width=[Math]::Max(1,$rect.Right-$rect.Left)+16
  $height=[Math]::Max(1,$rect.Bottom-$rect.Top)+16
  [MineradioDesktopLayer]::SetWindowPos($target,[IntPtr]::Zero,0,0,$width,$height,0x0070)|Out-Null
}
`;
  mainWindowDesktopEmbeddingUncertain = true;
  return new Promise((resolve) => {
    execFile(WINDOWS_POWERSHELL_EXE, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      timeout: 6000,
    }, (error, _stdout, stderr) => {
      if (error || !mainWindow || mainWindow.isDestroyed()) {
        if (error) writeDesktopFusionDiagnostic(next ? 'interactive' : 'reattach', error, stderr);
        const detail = String(stderr || (error && error.message) || '').trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' | ').slice(0, 600);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindowDesktopEmbeddingUncertain = true;
          try { mainWindow.setIgnoreMouseEvents(false); } catch (_e) {}
          try { mainWindow.setFocusable(true); } catch (_e) {}
          try { mainWindow.show(); } catch (_e) {}
        }
        resolve({ ok: false, error: error ? 'DESKTOP_LAYER_FAILED' : 'MAIN_WINDOW_UNAVAILABLE', detail });
        return;
      }
      mainWindowDesktopInteractive = next;
      mainWindowDesktopEmbeddingUncertain = false;
      try {
        if (next) win.setIgnoreMouseEvents(false);
        else win.setIgnoreMouseEvents(true);
      } catch (_e) {}
      try { win.setFocusable(next); } catch (_e) {}
      if (next) {
        try { win.setResizable(false); } catch (_e) {}
        try { win.setMovable(false); } catch (_e) {}
        try { win.setBounds(interactiveBounds, false); } catch (_e) {}
        win.show();
        win.focus();
      } else {
        win.showInactive();
      }
      sendWindowState(win);
      refreshTrayMenu();
      resolve({ ok: true, interactive: next });
    });
  });
}

function toggleMainWindowDesktopInteraction() {
  if (desktopFusionOverlayState.enabled) {
    return setDesktopFusionOverlayLocked(
      desktopFusionOverlayState.softwareInteractionLocked !== true,
      'desktop-interaction-toggled',
    );
  }
  const runtime = getFullDesktopModeRuntime();
  const status = runtime.getStatus('desktop-interaction-toggle-requested');
  if (!status.enabled || !status.interactive) {
    return Promise.resolve({ ok: false, error: 'DESKTOP_MODE_INACTIVE', status });
  }
  return runtime.setSoftwareInteractionLocked(
    status.softwareInteractionLocked !== true,
    'desktop-interaction-toggled',
  );
}

function refreshWallpaperDesktopPlacement() {
  if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
  positionWallpaperWindow();
  wallpaperWindow.showInactive();
  attachWallpaperToWorkerW(wallpaperWindow);
  sendWallpaperState();
}

function hookExplorerRestartForWallpaper(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed() || typeof win.hookWindowMessage !== 'function') return;
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class MineradioShellMessage {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern uint RegisterWindowMessage(string lpString);
}
"@
[MineradioShellMessage]::RegisterWindowMessage("TaskbarCreated")
`;
  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    timeout: 5000,
  }, (error, stdout) => {
    if (error || !win || win.isDestroyed()) return;
    const messageId = Number.parseInt(String(stdout || '').trim(), 10);
    if (!Number.isInteger(messageId) || messageId <= 0) return;
    try {
      win.hookWindowMessage(messageId, () => {
        setTimeout(() => refreshWallpaperDesktopPlacement(), 650);
        setTimeout(() => {
          if (fullDesktopModeRuntime && fullDesktopModeRuntime.isEnabled()) {
            fullDesktopModeRuntime.reconcile('explorer-restarted').catch(() => {});
          }
        }, 900);
      });
    } catch (e) {
      console.warn('Explorer restart hook failed:', e && e.message || e);
    }
  });
}

function attachWallpaperToWorkerW(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  const hwnd = nativeWindowHandleDecimal(win);
  const script = `
$ErrorActionPreference = "Stop"
if (-not ("MineradioNativeWin" -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MineradioNativeWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
}
"@
}
$progman = [MineradioNativeWin]::FindWindow("Progman", $null)
$result = [IntPtr]::Zero
[MineradioNativeWin]::SendMessageTimeout($progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 0, 1000, [ref]$result) | Out-Null
$script:workerw = [IntPtr]::Zero
$enum = [MineradioNativeWin+EnumWindowsProc]{
  param([IntPtr]$top, [IntPtr]$param)
  $shell = [MineradioNativeWin]::FindWindowEx($top, [IntPtr]::Zero, "SHELLDLL_DefView", $null)
  if ($shell -ne [IntPtr]::Zero) {
    $script:workerw = [MineradioNativeWin]::FindWindowEx([IntPtr]::Zero, $top, "WorkerW", $null)
  }
  return $true
}
[MineradioNativeWin]::EnumWindows($enum, [IntPtr]::Zero) | Out-Null
if ($script:workerw -eq [IntPtr]::Zero) { $script:workerw = $progman }
$target = [IntPtr]::new([Int64]${hwnd})
[MineradioNativeWin]::SetParent($target, $script:workerw) | Out-Null
[MineradioNativeWin]::SetWindowPos($target, [IntPtr]::Zero, 0, 0, 0, 0, 0x0013) | Out-Null
`;
  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    timeout: 5000,
  }, (error) => {
    if (error) console.warn('Wallpaper WorkerW attach failed:', error.message);
  });
}

function positionWallpaperWindow() {
  if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
  const bounds = screen.getPrimaryDisplay().bounds;
  wallpaperWindow.setBounds(bounds, false);
}

function sendWallpaperState() {
  if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
  wallpaperWindow.webContents.send('mineradio-wallpaper-state', wallpaperState);
}

function createWallpaperWindow(payload = {}) {
  wallpaperState = { ...wallpaperState, ...payload, enabled: true };
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    positionWallpaperWindow();
    sendWallpaperState();
    return wallpaperWindow;
  }
  const bounds = screen.getPrimaryDisplay().bounds;
  wallpaperWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    title: 'Mineradio Wallpaper',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  wallpaperWindow.setIgnoreMouseEvents(true, { forward: true });
  wallpaperWindow.once('ready-to-show', () => {
    if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
    positionWallpaperWindow();
    wallpaperWindow.showInactive();
    attachWallpaperToWorkerW(wallpaperWindow);
    sendWallpaperState();
  });
  wallpaperWindow.webContents.once('did-finish-load', sendWallpaperState);
  wallpaperWindow.on('closed', () => {
    wallpaperWindow = null;
  });
  wallpaperWindow.loadURL(overlayUrl('wallpaper.html')).catch((e) => console.warn('Wallpaper load failed:', e.message));
  return wallpaperWindow;
}

function closeWallpaperWindow() {
  wallpaperState = { ...wallpaperState, enabled: false };
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    sendWallpaperState();
    wallpaperWindow.close();
  }
  wallpaperWindow = null;
}

function closeOverlayWindows() {
  closeDesktopLyricsWindow();
  closeWallpaperWindow();
}

ipcMain.handle('desktop-window-minimize', (event) => {
  const win = getSenderWindow(event);
  if (!win || win.isDestroyed()) return;
  // Minimize to the Windows taskbar. Closing to the notification-area tray
  // remains a separate, user-configurable action for the close button.
  if (mainWindowDesktopEmbedded) {
    win.webContents.send('mineradio-wallpaper-command', { command: 'wallpaper-off' });
    queueWallpaperModeTransition(false, { enabled: false, source: 'minimize' }).finally(() => {
      if (!win.isDestroyed()) win.minimize();
    });
    return;
  }
  win.setSkipTaskbar(false);
  win.minimize();
});

ipcMain.handle('desktop-window-toggle-maximize', (event) => {
  toggleFullscreen(getSenderWindow(event));
});

ipcMain.handle('desktop-window-toggle-fullscreen', (event) => {
  toggleFullscreen(getSenderWindow(event));
});

ipcMain.handle('desktop-window-exit-fullscreen-windowed', (event) => {
  exitFullscreenToWindow(getSenderWindow(event));
});

ipcMain.handle('desktop-window-get-state', (event) => {
  return getWindowState(getSenderWindow(event));
});

ipcMain.handle('desktop-window-toggle-desktop-interaction', () => toggleMainWindowDesktopInteraction());
ipcMain.handle('mineradio-wallpaper-mode-status', () => {
  return desktopFusionOverlayState.enabled
    ? getDesktopFusionOverlayStatus('renderer-status-request')
    : getFullDesktopModeRuntime().getStatus('renderer-status-request');
});
ipcMain.handle('mineradio-desktop-software-lock', (_event, locked) => {
  if (desktopFusionOverlayState.enabled) {
    return setDesktopFusionOverlayLocked(locked === true, 'renderer-software-lock');
  }
  return getFullDesktopModeRuntime().setSoftwareInteractionLocked(locked === true, 'renderer-software-lock');
});
ipcMain.handle('mineradio-desktop-icons-visible', (_event, visible) => {
  if (desktopFusionOverlayState.enabled) {
    return {
      ok: visible !== false,
      enabled: true,
      interactive: true,
      desktopIconsVisible: true,
      status: getDesktopFusionOverlayStatus('renderer-icons-visible'),
    };
  }
  return getFullDesktopModeRuntime().setDesktopIconsVisible(visible !== false, 'renderer-icons-visible');
});
ipcMain.handle('mineradio-desktop-pointer-route', (_event, route) => {
  if (desktopFusionOverlayState.enabled) {
    desktopFusionOverlayState.pointerRoute = {
      overSoftwareUi: route && route.overSoftwareUi === true,
      overDesktopControls: route && route.overDesktopControls === true,
    };
    const status = applyDesktopFusionOverlayPointerRoute('renderer-pointer-route');
    return {
      ok: true,
      applied: true,
      ignoreMouseEvents: desktopFusionOverlayState.ignoreMouseEvents,
      pointerRoute: { ...desktopFusionOverlayState.pointerRoute },
      status,
    };
  }
  return getFullDesktopModeRuntime().updatePointerRoute(route || {}, 'renderer-pointer-route');
});
ipcMain.handle('mineradio-desktop-icon-shields', (_event, payload = {}) => {
  if (desktopFusionOverlayState.enabled) {
    return { ok: true, applied: false, status: getDesktopFusionOverlayStatus('icon-shields-safe-overlay') };
  }
  return getFullDesktopModeRuntime().updateIconShields(payload.rects || [], payload.viewport || {});
});
ipcMain.handle('mineradio-desktop-keyboard-focus', (_event, reason) => {
  if (desktopFusionOverlayState.enabled) {
    const active = !desktopFusionOverlayState.softwareInteractionLocked
      && !!(mainWindow && !mainWindow.isDestroyed());
    if (active) {
      try { mainWindow.setFocusable(true); } catch (_error) {}
      try { mainWindow.show(); } catch (_error) {}
      try { mainWindow.focus(); } catch (_error) {}
      try { mainWindow.webContents.focus(); } catch (_error) {}
    }
    return {
      ok: active,
      focused: active,
      error: active ? '' : 'DESKTOP_SOFTWARE_LOCKED',
      status: getDesktopFusionOverlayStatus(String(reason || 'renderer-keyboard-focus')),
    };
  }
  return getFullDesktopModeRuntime().requestKeyboardFocus(String(reason || 'renderer-keyboard-focus'));
});

ipcMain.handle('desktop-window-close', (event) => {
  getSenderWindow(event)?.close();
});

ipcMain.handle('desktop-window-drag-state', (_event, active) => {
  return { ok:true, active:!!active };
});

ipcMain.on('desktop-window-resize-start', (event, payload = {}) => {
  const win = getSenderWindow(event);
  if (!win || win.isDestroyed() || win.isFullScreen() || win.isMaximized()) return;
  const direction = String(payload.direction || '');
  if (!/^(n|s|e|w|ne|nw|se|sw)$/.test(direction)) return;
  mainWindowResizeStates.set(event.sender.id, {
    win,
    direction,
    startX:Number(payload.screenX) || 0,
    startY:Number(payload.screenY) || 0,
    bounds:win.getBounds(),
  });
});

ipcMain.on('desktop-window-resize-update', (event, payload = {}) => {
  const state = mainWindowResizeStates.get(event.sender.id);
  if (!state || !state.win || state.win.isDestroyed()) return;
  const dx = (Number(payload.screenX) || 0) - state.startX;
  const dy = (Number(payload.screenY) || 0) - state.startY;
  const start = state.bounds;
  const direction = state.direction;
  let x = start.x;
  let y = start.y;
  let width = start.width;
  let height = start.height;
  if (direction.includes('e')) width = start.width + dx;
  if (direction.includes('s')) height = start.height + dy;
  if (direction.includes('w')) { x = start.x + dx; width = start.width - dx; }
  if (direction.includes('n')) { y = start.y + dy; height = start.height - dy; }
  if (width < MIN_WINDOWED_WIDTH) {
    if (direction.includes('w')) x = start.x + start.width - MIN_WINDOWED_WIDTH;
    width = MIN_WINDOWED_WIDTH;
  }
  if (height < MIN_WINDOWED_HEIGHT) {
    if (direction.includes('n')) y = start.y + start.height - MIN_WINDOWED_HEIGHT;
    height = MIN_WINDOWED_HEIGHT;
  }
  state.win.setBounds({ x:Math.round(x), y:Math.round(y), width:Math.round(width), height:Math.round(height) }, false);
});

ipcMain.on('desktop-window-resize-end', (event) => {
  mainWindowResizeStates.delete(event.sender.id);
});

ipcMain.handle('mineradio-lx-set-linked', (_event, linked) => {
  lxPlaybackLinked = !!linked;
  return { ok: true, linked: lxPlaybackLinked };
});

ipcMain.handle('mineradio-tray-get-settings', () => {
  return { ok: true, closeToTray: closeToTrayEnabled, startup: isStartupEnabled(), startupEnabled: isStartupEnabled() };
});

ipcMain.handle('mineradio-tray-set-close-to-tray', (_event, enabled) => {
  closeToTrayEnabled = !!enabled;
  writeDesktopShellSettings({ closeToTray: closeToTrayEnabled });
  refreshTrayMenu();
  return { ok: true, closeToTray: closeToTrayEnabled };
});

ipcMain.handle('mineradio-tray-update-playback', (_event, state = {}) => {
  trayPlaybackState = {
    title: String(state.title || '').slice(0, 120),
    artist: String(state.artist || '').slice(0, 120),
    playing: !!state.playing,
    volume: Math.max(0, Math.min(100, Math.round(Number(state.volume) || 0))),
  };
  refreshTrayMenu();
  return { ok: true };
});

ipcMain.handle('mineradio-startup-set-enabled', (_event, enabled) => {
  const result = setStartupEnabled(!!enabled);
  refreshTrayMenu();
  return result;
});

ipcMain.handle('mineradio-hotkeys-configure-global', (_event, bindings) => {
  return configureMineradioGlobalHotkeys(bindings);
});

ipcMain.handle('mineradio-export-json-file', async (event, payload = {}) => {
  try {
    const owner = getSenderWindow(event);
    const defaultName = String(payload.defaultName || 'mineradio-export.json').replace(/[\\/:*?"<>|]+/g, '-');
    const result = await dialog.showSaveDialog(owner, {
      title: '导出 Mineradio 存档',
      defaultPath: defaultName.toLowerCase().endsWith('.json') ? defaultName : `${defaultName}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const text = typeof payload.text === 'string' ? payload.text : JSON.stringify(payload.data || {}, null, 2);
    fs.writeFileSync(result.filePath, text, 'utf8');
    return { ok: true, filePath: result.filePath };
  } catch (e) {
    return { ok: false, error: e.message || 'EXPORT_FAILED' };
  }
});

ipcMain.handle('mineradio-export-text-file', async (event, payload = {}) => {
  try {
    const owner = getSenderWindow(event);
    const requestedName = String(payload.defaultName || 'mineradio-export.txt').replace(/[\\/:*?"<>|]+/g, '-');
    const extension = String(payload.extension || 'txt').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'txt';
    const defaultName = requestedName.toLowerCase().endsWith(`.${extension}`) ? requestedName : `${requestedName}.${extension}`;
    const result = await dialog.showSaveDialog(owner, {
      title: String(payload.title || '导出 Mineradio 文件'),
      defaultPath: defaultName,
      filters: [{ name: String(payload.filterName || extension.toUpperCase()), extensions: [extension] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, String(payload.text || ''), 'utf8');
    return { ok: true, filePath: result.filePath };
  } catch (e) {
    return { ok: false, error: e.message || 'EXPORT_TEXT_FAILED' };
  }
});

ipcMain.handle('mineradio-export-lxmc-file', async (event, payload = {}) => {
  try {
    const owner = getSenderWindow(event);
    const requestedName = String(payload.defaultName || 'Mineradio歌单.lxmc').replace(/[\\/:*?"<>|]+/g, '-');
    const defaultName = requestedName.toLowerCase().endsWith('.lxmc') ? requestedName : `${requestedName}.lxmc`;
    const jsonText = JSON.stringify(payload.data || {});
    if (!jsonText || jsonText.length > 32 * 1024 * 1024) {
      return { ok: false, error: 'LXMC_EXPORT_TOO_LARGE' };
    }
    const result = await dialog.showSaveDialog(owner, {
      title: '导出 LX Music 歌单',
      defaultPath: defaultName,
      filters: [{ name: 'LX Music 歌单', extensions: ['lxmc'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const compressed = zlib.gzipSync(Buffer.from(jsonText, 'utf8'), { level: 6 });
    fs.writeFileSync(result.filePath, compressed);
    return { ok: true, filePath: result.filePath, bytes: compressed.length };
  } catch (e) {
    return { ok: false, error: e.message || 'EXPORT_LXMC_FAILED' };
  }
});

ipcMain.handle('mineradio-import-json-file', async (event) => {
  try {
    const owner = getSenderWindow(event);
    const result = await dialog.showOpenDialog(owner, {
      title: '导入 Mineradio 存档',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };
    const filePath = result.filePaths[0];
    const text = fs.readFileSync(filePath, 'utf8');
    return { ok: true, filePath, text };
  } catch (e) {
    return { ok: false, error: e.message || 'IMPORT_FAILED' };
  }
});

ipcMain.handle('mineradio-clipboard-write-text', (event, value) => {
  try {
    const owner = getSenderWindow(event);
    if (!mainWindow || owner !== mainWindow) return { ok: false, error: 'CLIPBOARD_SENDER_REJECTED' };
    const text = String(value == null ? '' : value);
    if (text.length > 16 * 1024 * 1024) return { ok: false, error: 'CLIPBOARD_TEXT_TOO_LARGE' };
    clipboard.writeText(text);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error && error.message || 'CLIPBOARD_WRITE_FAILED' };
  }
});

ipcMain.handle('mineradio-clipboard-read-text', (event) => {
  try {
    const owner = getSenderWindow(event);
    if (!mainWindow || owner !== mainWindow) return { ok: false, error: 'CLIPBOARD_SENDER_REJECTED' };
    const text = String(clipboard.readText() || '');
    if (text.length > 16 * 1024 * 1024) return { ok: false, error: 'CLIPBOARD_TEXT_TOO_LARGE' };
    return { ok: true, text };
  } catch (error) {
    return { ok: false, error: error && error.message || 'CLIPBOARD_READ_FAILED' };
  }
});

ipcMain.on('mineradio-ui-state-read-sync', (event) => {
  event.returnValue = readDesktopUiState().values || {};
});

ipcMain.on('mineradio-startup-safe-reset-sync', (event, rendererValues) => {
  try {
    const safeRendererValues = {};
    let totalLength = 0;
    STARTUP_SAFE_RESET_KEYS.forEach((key) => {
      const value = rendererValues && rendererValues[key];
      if (typeof value !== 'string' || value.length > 24 * 1024 * 1024) return;
      if (totalLength + value.length > 32 * 1024 * 1024) return;
      safeRendererValues[key] = value;
      totalLength += value.length;
    });
    event.returnValue = resetStartupCriticalUiState('automatic startup recovery', safeRendererValues);
  }
  catch (error) { event.returnValue = { ok: false, error: error.message || 'STARTUP_SAFE_RESET_FAILED' }; }
});

ipcMain.on('mineradio-profile-native-state-repair-backup-sync', (event, rendererLayoutValue) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow || sender !== mainWindow) {
    event.returnValue = { ok: false, error: 'PROFILE_REPAIR_SENDER_REJECTED' };
    return;
  }
  try { event.returnValue = beginProfileNativeStateRepair(rendererLayoutValue); }
  catch (error) { event.returnValue = { ok: false, error: error.message || 'PROFILE_REPAIR_BACKUP_FAILED' }; }
});

ipcMain.on('mineradio-profile-native-state-repair-complete-sync', (event, token) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow || sender !== mainWindow) {
    event.returnValue = { ok: false, error: 'PROFILE_REPAIR_SENDER_REJECTED' };
    return;
  }
  try { event.returnValue = completeProfileNativeStateRepair(token); }
  catch (error) { event.returnValue = { ok: false, error: error.message || 'PROFILE_REPAIR_COMPLETE_FAILED' }; }
});

ipcMain.on('mineradio-startup-ready', (event, payload) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow || sender !== mainWindow) return;
  markMainWindowStartupReady(payload || {});
});

ipcMain.on('mineradio-startup-issue', (event, payload) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow || sender !== mainWindow) return;
  writeStartupDiagnostic('renderer-startup-issue', JSON.stringify(payload || {}));
});

ipcMain.handle('mineradio-ui-state-write', async (_event, patch) => {
  try {
    const state = writeDesktopUiStatePatch(patch || {});
    return { ok: true, updatedAt: state.updatedAt };
  } catch (e) {
    return { ok: false, error: e.message || 'UI_STATE_WRITE_FAILED' };
  }
});

ipcMain.on('mineradio-ui-state-write-sync', (event, patch) => {
  try {
    const state = writeDesktopUiStatePatch(patch || {});
    event.returnValue = { ok: true, updatedAt: state.updatedAt };
  } catch (error) {
    event.returnValue = { ok: false, error: error.message || 'UI_STATE_WRITE_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-engine-list', async (_event, payload = {}) => {
  try {
    const snapshot = await wallpaperEngineNativeLibrary.list({ force: payload && payload.force === true });
    const runtime = await wallpaperEngineNativeRuntime.probe(payload && payload.force === true);
    return { ...snapshot, runtime };
  } catch (error) {
    return { ok: false, projects: [], count: 0, error: error.message || 'WALLPAPER_ENGINE_SCAN_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-engine-project-details', async (_event, id) => {
  try {
    return await wallpaperEngineNativeLibrary.getProjectDetails(String(id || ''));
  } catch (error) {
    return { ok: false, error: error.message || 'WALLPAPER_ENGINE_PROJECT_DETAILS_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-engine-open-project-details', async (_event, payload = {}) => {
  try {
    const details = await wallpaperEngineNativeLibrary.getProjectDetails(String(payload.id || ''));
    const workshopId = String(details && details.workshopId || '');
    if (!/^\d{5,32}$/.test(workshopId)) return { ok: false, error: 'WALLPAPER_ENGINE_WORKSHOP_DETAILS_UNAVAILABLE' };
    if (payload.target !== 'workshop') {
      try {
        await wallpaperEngineNativeRuntime.revealWorkshop(workshopId);
        return { ok: true, opened: 'wallpaper-engine', workshopId };
      } catch (_error) {}
    }
    await shell.openExternal('steam://url/CommunityFilePage/' + workshopId);
    return { ok: true, opened: 'steam-workshop', workshopId };
  } catch (error) {
    return { ok: false, error: error.message || 'WALLPAPER_ENGINE_OPEN_PROJECT_DETAILS_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-engine-choose-directory', async () => {
  try {
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(mainWindow, { title: '导入 Wallpaper Engine 项目目录', buttonLabel: '导入目录', properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ title: '导入 Wallpaper Engine 项目目录', buttonLabel: '导入目录', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: true, canceled: true };
    const snapshot = await wallpaperEngineNativeLibrary.addManualRoot(result.filePaths[0]);
    return { ...snapshot, runtime: await wallpaperEngineNativeRuntime.probe(false), canceled: false };
  } catch (error) {
    return { ok: false, canceled: false, projects: [], count: 0, error: error.message || 'WALLPAPER_ENGINE_IMPORT_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-engine-choose-project-file', async () => {
  try {
    const options = {
      title: '选择 Wallpaper Engine project.json 或场景包',
      buttonLabel: '导入项目',
      properties: ['openFile'],
      filters: [{ name: 'Wallpaper Engine 项目', extensions: ['pkg', 'pak', 'json'] }],
    };
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: true, canceled: true };
    const snapshot = await wallpaperEngineNativeLibrary.addManualProjectFile(path.resolve(result.filePaths[0]));
    return { ...snapshot, runtime: await wallpaperEngineNativeRuntime.probe(false), canceled: false };
  } catch (error) {
    return { ok: false, canceled: false, projects: [], count: 0, error: error.message || 'WALLPAPER_ENGINE_IMPORT_PROJECT_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-engine-remove-directory', async (_event, rootId) => {
  try {
    const snapshot = await wallpaperEngineNativeLibrary.removeManualRoot(String(rootId || ''));
    return { ...snapshot, runtime: await wallpaperEngineNativeRuntime.probe(false) };
  } catch (error) {
    return { ok: false, projects: [], count: 0, error: error.message || 'WALLPAPER_ENGINE_REMOVE_ROOT_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-engine-runtime-status', async (_event, payload = {}) => {
  try {
    const probe = await wallpaperEngineNativeRuntime.probe(payload && payload.force === true);
    return { ...probe, ...wallpaperEngineNativeRuntime.getStatus(), pending: wallpaperEngineNativeRuntime.pending != null };
  } catch (error) {
    return { ok: false, available: false, error: error.message || 'WALLPAPER_ENGINE_RUNTIME_PROBE_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-engine-start-scene', async (_event, payload = {}) => {
  const operation = ++wallpaperEngineNativeOperation;
  let sessionId = '';
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'WALLPAPER_ENGINE_HOST_UNAVAILABLE' };
    const elevated = await systemMemory.probeProcessElevation().catch(() => false);
    if (elevated) return { ok: false, error: 'WALLPAPER_ENGINE_HOST_ELEVATED' };
    const bounds = wallpaperEngineNativePhysicalBounds(mainWindow, payload);
    const hostDisplay = screen.getDisplayMatching(mainWindow.getContentBounds());
    const hostCornerRadius = mainWindow.isMaximized() || mainWindow.isFullScreen()
      ? 0
      : Math.max(0, Math.round(34 * Math.max(1, Number(hostDisplay && hostDisplay.scaleFactor) || 1)));
    const started = await wallpaperEngineNativeRuntime.start(String(payload.id || ''), bounds);
    sessionId = String(started && started.sessionId || '');
    if (operation !== wallpaperEngineNativeOperation) {
      await wallpaperEngineNativeRuntime.stop(sessionId).catch(() => {});
      return { ok: false, error: 'WALLPAPER_ENGINE_START_SUPERSEDED', sessionId };
    }
    const embedded = await wallpaperEngineNativeRuntime.embedActiveWindow(sessionId, {
      hostWindowId: nativeWindowHandleDecimal(mainWindow),
      hostExecutable: process.execPath,
      cornerRadius: hostCornerRadius,
      desktopIconLayering: false,
    });
    wallpaperEngineNativeGrant = { sessionId, operation };
    try { mainWindow.moveTop(); } catch (_error) {}
    try { mainWindow.focus(); } catch (_error) {}
    return { ...started, ...embedded, ok: true, capturePrepared: true, captureMode: 'dwm-thumbnail' };
  } catch (error) {
    if (sessionId) await wallpaperEngineNativeRuntime.stop(sessionId).catch(() => {});
    return { ok: false, error: error.code || error.message || 'WALLPAPER_ENGINE_SCENE_START_FAILED', sessionId };
  }
});

ipcMain.handle('mineradio-wallpaper-engine-capture-result', async (_event, payload = {}) => {
  const sessionId = String(payload.sessionId || '');
  if (!/^[a-f0-9]{24}$/i.test(sessionId)) return { ok: false, error: 'WALLPAPER_ENGINE_SESSION_INVALID' };
  const matched = clearWallpaperEngineNativeGrant(sessionId);
  let confirmed = false;
  if (matched && payload.ok === true) {
    confirmed = await wallpaperEngineNativeRuntime.confirmCaptureReady(sessionId).catch(() => false);
  }
  if (matched && !confirmed) await wallpaperEngineNativeRuntime.stop(sessionId).catch(() => {});
  return {
    ok: matched && confirmed,
    accepted: matched,
    captureReady: confirmed,
    captureMode: confirmed ? 'dwm-thumbnail' : '',
    error: matched && !confirmed ? 'WALLPAPER_ENGINE_DWM_SURFACE_FAILED' : '',
  };
});

ipcMain.handle('mineradio-wallpaper-engine-activate-dwm-surface', async (_event, payload = {}) => {
  try {
    const result = await wallpaperEngineNativeRuntime.activateDwmSurface(String(payload.sessionId || ''));
    return { ok: !!(result && result.dwmSurfaceActive), active: !!(result && result.dwmSurfaceActive), captureMode: 'dwm-thumbnail' };
  } catch (error) {
    return { ok: false, active: false, error: error.code || error.message || 'WALLPAPER_ENGINE_DWM_SURFACE_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-engine-stop-scene', async (_event, payload = {}) => {
  try {
    const sessionId = String(payload.sessionId || '');
    const stopAll = payload.all === true || !sessionId;
    if (stopAll) {
      wallpaperEngineNativeOperation += 1;
      clearWallpaperEngineNativeGrant();
    } else {
      clearWallpaperEngineNativeGrant(sessionId);
    }
    return await wallpaperEngineNativeRuntime.stop(stopAll ? '' : sessionId);
  } catch (error) {
    return { ok: false, error: error.code || error.message || 'WALLPAPER_ENGINE_SCENE_STOP_FAILED' };
  }
});

ipcMain.handle('mineradio-local-music-choose-files', async (event) => {
  try {
    const owner = getSenderWindow(event);
    const result = await dialog.showOpenDialog(owner, {
      title: '选择本地音乐、歌词或封面文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '音乐与配套文件', extensions: ['mp3', 'flac', 'wav', 'ogg', 'opus', 'm4a', 'mp4', 'aac', 'webm', 'ape', 'wma', 'aiff', 'aif', 'aifc', 'caf', 'amr', 'awb', 'oga', 'mka', 'mkv', 'm4b', 'alac', 'ac3', 'dts', 'tta', 'tak', 'wv', 'au', 'snd', 'ra', 'rm', 'ncm', 'qmc0', 'qmc3', 'qmcflac', 'qmcogg', 'kgm', 'kgma', 'vpr', 'kwm', 'mflac', 'mgg', 'lrc', 'txt', 'jpg', 'jpeg', 'png', 'webp'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths || !result.filePaths.length) return { ok:false, canceled:true, files:[] };
    const files = (await Promise.all(result.filePaths.map(filePath => localMusicEntryFromPath(filePath)))).filter(Boolean);
    return { ok:true, canceled:false, files };
  } catch (e) {
    return { ok:false, canceled:false, files:[], error:e.message || 'LOCAL_FILES_CHOOSE_FAILED' };
  }
});

ipcMain.handle('mineradio-local-music-choose-folder', async (event) => {
  try {
    const owner = getSenderWindow(event);
    const result = await dialog.showOpenDialog(owner, {
      title: '选择本地音乐文件夹',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };
    return scanLocalMusicFolder(result.filePaths[0]);
  } catch (e) {
    return { ok: false, error: e.message || 'LOCAL_LIBRARY_CHOOSE_FAILED' };
  }
});


ipcMain.handle('mineradio-local-cover-choose-file', async (event) => {
  try {
    const owner = getSenderWindow(event);
    const result = await dialog.showOpenDialog(owner, {
      title: '选择当前歌曲封面',
      properties: ['openFile'],
      filters: [
        { name: '封面图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok:false, canceled:true };
    const file = await localMusicEntryFromPath(result.filePaths[0]);
    return file ? { ok:true, canceled:false, file } : { ok:false, canceled:false, error:'LOCAL_COVER_UNSUPPORTED' };
  } catch (e) {
    return { ok:false, canceled:false, error:e.message || 'LOCAL_COVER_CHOOSE_FAILED' };
  }
});

ipcMain.handle('mineradio-local-lyric-choose-file', async (event) => {
  try {
    const owner = getSenderWindow(event);
    const result = await dialog.showOpenDialog(owner, {
      title: '选择当前歌曲歌词',
      properties: ['openFile'],
      filters: [
        { name: '歌词文件', extensions: ['lrc', 'txt'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok:false, canceled:true };
    const file = await localMusicEntryFromPath(result.filePaths[0]);
    return file ? { ok:true, canceled:false, file } : { ok:false, canceled:false, error:'LOCAL_LYRIC_UNSUPPORTED' };
  } catch (e) {
    return { ok:false, canceled:false, error:e.message || 'LOCAL_LYRIC_CHOOSE_FAILED' };
  }
});

ipcMain.handle('mineradio-local-music-scan-folder', async (_event, folderPath) => {
  try {
    if (!folderPath) return { ok: false, error: 'LOCAL_LIBRARY_PATH_EMPTY' };
    return await scanLocalMusicFolder(folderPath);
  } catch (e) {
    return { ok: false, error: e.message || 'LOCAL_LIBRARY_SCAN_FAILED' };
  }
});

ipcMain.handle('mineradio-local-music-refresh-entries', async (_event, folderPath, files) => {
  try {
    if (!folderPath) return { ok: false, error: 'LOCAL_LIBRARY_PATH_EMPTY' };
    return await refreshLocalMusicFileEntries(folderPath, files);
  } catch (e) {
    return { ok: false, error: e.message || 'LOCAL_LIBRARY_REFRESH_FAILED' };
  }
});

ipcMain.handle('mineradio-local-audio-prepare', async (_event, filePath) => {
  return prepareLocalAudioForPlayback(filePath);
});

ipcMain.handle('mineradio-local-audio-transcode', async (_event, filePath) => {
  try {
    return await transcodeLocalAudioForPlayback(filePath);
  } catch (error) {
    return { ok:false, code:'FFMPEG_TRANSCODE_FAILED', message:error.message || 'FFmpeg 转换失败' };
  }
});

ipcMain.handle('mineradio-local-file-read-range', async (_event, filePath, start, end) => {
  try {
    return await readAuthorizedLocalFileRange(filePath, start, end);
  } catch (e) {
    return { ok: false, error: e.message || 'LOCAL_FILE_READ_FAILED' };
  }
});

ipcMain.handle('mineradio-local-file-read-data-url', async (_event, filePath) => {
  try {
    return await readAuthorizedLocalFileDataUrl(filePath);
  } catch (e) {
    return { ok: false, error: e.message || 'LOCAL_FILE_READ_FAILED' };
  }
});

ipcMain.handle('mineradio-open-update-installer', async (_event, filePath) => {
  try {
    const target = path.resolve(String(filePath || ''));
    const updateDir = path.resolve(getUpdateDownloadDir());
    if (!target || !target.startsWith(updateDir + path.sep)) {
      return { ok: false, error: 'INVALID_UPDATE_PATH' };
    }
    if (!fs.existsSync(target)) return { ok: false, error: 'UPDATE_FILE_MISSING' };
    const error = await shell.openPath(target);
    return error ? { ok: false, error } : { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'OPEN_UPDATE_FAILED' };
  }
});

ipcMain.handle('mineradio-restart-app', async () => {
  try {
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'RESTART_FAILED' };
  }
});

ipcMain.handle('mineradio-memory-get-snapshot', async () => {
  try {
    return {
      ok:true,
      snapshot:await systemMemory.getMemorySnapshotExtended(),
      elevated:await systemMemory.isProcessElevated(),
      systemPurgeAvailable:systemMemory.SYSTEM_PURGE_AVAILABLE === true,
      systemPurgeEnabled:systemMemory.SYSTEM_PURGE_ENABLED === true,
      appMetrics:appMemory.getMemorySnapshot().process,
      auto:memoryAutoState,
      lastTrimAt:lastAppMemoryTrimAt,
      lastTrimReason:lastAppMemoryTrimReason,
    };
  } catch (error) {
    return { ok:false, error:error.message || 'MEMORY_SNAPSHOT_FAILED', snapshot:appMemory.getMemorySnapshot(), auto:memoryAutoState };
  }
});

ipcMain.handle('mineradio-memory-configure-auto', async (_event, payload = {}) => {
  memoryAutoState = normalizeMemoryAutoState(payload);
  syncMemoryAutoTimer();
  if (memoryAutoState.enabled && payload.runNow === true && !isMainWindowForegroundVisible()) await runMemoryAutoTick('configure');
  return {
    ok:true,
    state:memoryAutoState,
    systemPurgeAvailable:systemMemory.SYSTEM_PURGE_AVAILABLE === true,
    systemPurgeEnabled:systemMemory.SYSTEM_PURGE_ENABLED === true,
  };
});

ipcMain.handle('mineradio-memory-trim-app', async (_event, payload = {}) => {
  return trimAppMemoryNow(payload.reason || 'renderer');
});

ipcMain.handle('mineradio-memory-purge-system', async (_event, payload = {}) => {
  const mask = systemMemory.normalizeMask(payload && payload.mask);
  const autoElevate = payload && payload.autoElevate === true;
  try {
    if (isMainWindowForegroundVisible()) {
      return {
        ok:true,
        result:{ ok:false, skipped:true, reason:'foreground-visible', message:'System memory purge is skipped while Mineradio is visible.' },
        snapshot:systemMemory.getMemorySnapshot(),
        elevated:false,
        systemPurgeAvailable:systemMemory.SYSTEM_PURGE_AVAILABLE === true,
        systemPurgeEnabled:systemMemory.SYSTEM_PURGE_ENABLED === true,
      };
    }
    const elevatedBefore = await systemMemory.isProcessElevated();
    const result = await systemMemory.purgeSystemMemorySmart(mask, { autoElevate, manual:true });
    return {
      ok:true,
      result,
      snapshot:await systemMemory.getMemorySnapshotExtended(),
      elevated:elevatedBefore || await systemMemory.isProcessElevated(),
      systemPurgeAvailable:systemMemory.SYSTEM_PURGE_AVAILABLE === true,
      systemPurgeEnabled:systemMemory.SYSTEM_PURGE_ENABLED === true,
    };
  } catch (error) {
    return {
      ok:false,
      error:error.message || 'MEMORY_PURGE_FAILED',
      snapshot:systemMemory.getMemorySnapshot(),
      elevated:false,
      systemPurgeAvailable:systemMemory.SYSTEM_PURGE_AVAILABLE === true,
      systemPurgeEnabled:systemMemory.SYSTEM_PURGE_ENABLED === true,
    };
  }
});

ipcMain.handle('mineradio-lx-open-scheme', async (_event, schemeUrl) => {
  const target = String(schemeUrl || '').trim();
  if (!/^lxmusic:\/\/(?:music|songlist|player)\//i.test(target)) {
    throw new Error('LX_SCHEME_NOT_ALLOWED');
  }
  await shell.openExternal(target);
  return { ok: true };
});

ipcMain.handle('mineradio-desktop-lyrics-set-enabled', async (_event, enabled, payload) => {
  try {
    if (enabled) {
      createDesktopLyricsWindow(payload || {});
      broadcastDesktopLyricsEnabledState(true);
    } else {
      closeDesktopLyricsWindow();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-update', async (_event, payload) => {
  try {
    const nextState = { ...desktopLyricsState, ...(payload || {}) };
    if (nextState.enabled) {
      createDesktopLyricsWindow(payload || {});
    } else if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
      desktopLyricsState = nextState;
      sendDesktopLyricsState();
    } else {
      desktopLyricsState = nextState;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_UPDATE_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-set-dragging', async () => {
  return { ok: true };
});

ipcMain.handle('mineradio-desktop-lyrics-set-pointer-capture', async (_event, active) => {
  try {
    desktopLyricsPointerCapture = !!active;
    applyDesktopLyricsMouseBehavior();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_POINTER_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-set-hot-bounds', async (_event, bounds) => {
  try {
    const left = clampNumber(bounds && bounds.left, -2000, 4000, 0);
    const top = clampNumber(bounds && bounds.top, -2000, 4000, 0);
    const right = clampNumber(bounds && bounds.right, left + 1, 6000, left + 1);
    const bottom = clampNumber(bounds && bounds.bottom, top + 1, 6000, top + 1);
    desktopLyricsHotBounds = { left, top, right, bottom };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_HOT_BOUNDS_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-set-lock-state', async (_event, locked) => {
  try {
    desktopLyricsState = { ...desktopLyricsState, clickThrough: !!locked };
    if (desktopLyricsState.clickThrough !== false) desktopLyricsPointerCapture = false;
    applyDesktopLyricsMouseBehavior();
    broadcastDesktopLyricsLockState();
    return { ok: true, locked: desktopLyricsState.clickThrough !== false };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_LOCK_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-move-by', async (_event, dx, dy) => {
  try {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return { ok: false, error: 'NO_DESKTOP_LYRICS_WINDOW' };
    if (desktopLyricsState.clickThrough !== false) return { ok: false, error: 'DESKTOP_LYRICS_LOCKED' };
    const bounds = desktopLyricsWindow.getBounds();
    const next = {
      ...bounds,
      x: Math.round(bounds.x + clampNumber(dx, -160, 160, 0)),
      y: Math.round(bounds.y + clampNumber(dy, -160, 160, 0)),
    };
    desktopLyricsWindow.setBounds(next, false);
    desktopLyricsUserBounds = desktopLyricsWindow.getBounds();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_MOVE_FAILED' };
  }
});

ipcMain.on('mineradio-desktop-lyrics-drag-to', (_event, screenX, screenY) => {
  try {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
    if (!desktopLyricsDragging || desktopLyricsState.clickThrough !== false) return;
    applyDesktopLyricsGlobalDragPoint({ x: Math.round(Number(screenX) || 0), y: Math.round(Number(screenY) || 0) });
  } catch (_error) {}
});


ipcMain.handle('mineradio-desktop-lyrics-start-global-drag', async (_event, screenX, screenY) => {
  try {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return { ok: false, error: 'NO_DESKTOP_LYRICS_WINDOW' };
    if (desktopLyricsState.clickThrough !== false) return { ok: false, error: 'DESKTOP_LYRICS_LOCKED' };
    const point = { x: Math.round(Number(screenX) || 0), y: Math.round(Number(screenY) || 0) };
    stopDesktopLyricsGlobalDrag();
    const started = startDesktopLyricsGlobalDrag(point);
    applyDesktopLyricsMouseBehavior();
    return { ok: !!started };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_GLOBAL_DRAG_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-stop-global-drag', async () => {
  try {
    stopDesktopLyricsGlobalDrag();
    applyDesktopLyricsMouseBehavior();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_GLOBAL_DRAG_STOP_FAILED' };
  }
});

let wallpaperModeTransitionGeneration = 0;
let wallpaperModeTransitionChain = Promise.resolve();

async function rollbackWallpaperModeTransition(error, detail, extra = {}) {
  let rollback = null;
  try {
    if (fullDesktopModeRuntime && fullDesktopModeRuntime.isEnabled()) {
      rollback = await fullDesktopModeRuntime.disable('wallpaper-mode-rollback');
    }
    if (desktopFusionOverlayState.enabled) {
      const overlayRollback = await disableDesktopFusionOverlay('wallpaper-mode-overlay-rollback');
      if (!rollback || rollback.ok === true) rollback = overlayRollback;
    }
  } catch (rollbackError) {
    rollback = { ok: false, error: rollbackError && rollbackError.message || 'DESKTOP_ROLLBACK_FAILED' };
  }
  wallpaperState.enabled = false;
  const status = publishFullDesktopModeStatus(
    rollback && rollback.status || getDesktopFusionOverlayStatus('wallpaper-mode-rollback'),
  );
  return {
    ok: false,
    enabled: false,
    interactive: false,
    error: error || 'DESKTOP_EMBED_FAILED',
    detail: detail || '',
    rolledBack: !!(rollback && rollback.ok),
    rollbackError: rollback && !rollback.ok ? rollback.error || '' : '',
    status,
    ...extra,
  };
}

async function applyWallpaperModeTransition(requestId, enabled, payload) {
  const requested = !!enabled;
  if (requestId !== wallpaperModeTransitionGeneration) {
    return { ok: false, enabled: false, interactive: false, stale: true };
  }
  wallpaperState = { ...wallpaperState, ...(payload || {}), enabled: false };
  try {
    if (!requested) {
      let detached = null;
      if (fullDesktopModeRuntime && fullDesktopModeRuntime.isEnabled()) {
        detached = await fullDesktopModeRuntime.disable('wallpaper-mode-disabled');
      }
      if (desktopFusionOverlayState.enabled) {
        const overlayDetached = await disableDesktopFusionOverlay('wallpaper-mode-overlay-disabled');
        if (!detached || detached.ok === true) detached = overlayDetached;
      }
      if (!detached) {
        detached = {
          ok: true,
          enabled: false,
          interactive: false,
          status: getFullDesktopModeRuntime().getStatus('wallpaper-mode-already-disabled'),
        };
      }
      wallpaperState.enabled = false;
      const status = publishFullDesktopModeStatus(
        detached && detached.status || getDesktopFusionOverlayStatus('wallpaper-mode-disabled'),
      );
      return {
        ...(detached || {}),
        ok: !!(detached && detached.ok),
        enabled: false,
        interactive: false,
        status,
        stale: requestId !== wallpaperModeTransitionGeneration,
      };
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
      return rollbackWallpaperModeTransition('MAIN_WINDOW_UNAVAILABLE', '');
    }
    // Keep Explorer's real icon ListView untouched. Desktop-control mode puts
    // Mineradio in WorkerW; software-control mode temporarily detaches the same
    // HWND as a full-display top-level window. The global hotkey switches only
    // these two verified states, so no copied icon layer can flicker or eat input.
    const enabledResult = await enableDesktopFusionOverlay(payload || {});
    const enabledStatus = enabledResult && enabledResult.status || getDesktopFusionOverlayStatus('wallpaper-mode-ready');
    if (!enabledResult || !enabledResult.ok || !enabledResult.interactive) {
      const failure = enabledResult && enabledResult.error || enabledStatus.lastError || 'DESKTOP_INTERACTIVE_FAILED';
      writeDesktopFusionDiagnostic('workerw-toggle-enable', failure, JSON.stringify(enabledStatus));
      return rollbackWallpaperModeTransition(
        failure,
        enabledResult && enabledResult.detail || '',
      );
    }
    if (requestId !== wallpaperModeTransitionGeneration) {
      return rollbackWallpaperModeTransition('DESKTOP_REQUEST_SUPERSEDED', '', { stale: true });
    }
    wallpaperState.enabled = true;
    const status = publishFullDesktopModeStatus(
      enabledStatus,
    );
    return { ...enabledResult, ok: true, enabled: true, interactive: true, status };
  } catch (error) {
    return rollbackWallpaperModeTransition(error && error.message || 'DESKTOP_EMBED_FAILED', '');
  }
}

ipcMain.handle('mineradio-wallpaper-set-enabled', (_event, enabled, payload) => {
  return queueWallpaperModeTransition(enabled, payload);
});

function queueWallpaperModeTransition(enabled, payload) {
  const requestId = ++wallpaperModeTransitionGeneration;
  const task = wallpaperModeTransitionChain
    .catch(() => {})
    .then(() => applyWallpaperModeTransition(requestId, enabled, payload));
  wallpaperModeTransitionChain = task.catch(() => {});
  return task;
}

function forceDisableWallpaperMode(reason) {
  // Emergency shutdown still goes through the same FIFO as normal toggles.
  // Incrementing the generation makes any in-flight enable roll itself back;
  // queuing the final forced detach guarantees it is the last native command.
  return queueWallpaperModeTransition(false, {
    enabled: false,
    recoveryReason: String(reason || ''),
  });
}

ipcMain.handle('mineradio-wallpaper-update', async (_event, payload) => {
  try {
    wallpaperState = { ...wallpaperState, ...(payload || {}) };
    return { ok: true, status: getFullDesktopModeRuntime().getStatus('wallpaper-state-updated') };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_EMBED_UPDATE_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-capture-prepare', async (_event, payload) => {
  preferredDisplayMediaSourceId = '';
  preferredDisplayMediaSourceTitle = String(payload && payload.windowTitle || '').trim().slice(0, 160);
  if (!preferredDisplayMediaSourceTitle) return { ok:false, error:'WALLPAPER_CAPTURE_TITLE_REQUIRED' };
  const deadline = Date.now() + 10000;
  do {
    try {
      const sources = await desktopCapturer.getSources({ types:['window'], thumbnailSize:{ width:0, height:0 } });
      const wanted = preferredDisplayMediaSourceTitle.toLowerCase();
      const source = sources.find(item => String(item && item.name || '').toLowerCase() === wanted)
        || sources.find(item => String(item && item.name || '').toLowerCase().includes(wanted));
      if (source) {
        preferredDisplayMediaSourceId = source.id;
        return { ok:true, sourceId:source.id, sourceName:source.name };
      }
    } catch (_error) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  preferredDisplayMediaSourceTitle = '';
  return { ok:false, error:'WALLPAPER_CAPTURE_WINDOW_NOT_FOUND' };
});

ipcMain.handle('mineradio-wallpaper-capture-finish', async () => {
  preferredDisplayMediaSourceId = '';
  preferredDisplayMediaSourceTitle = '';
  return { ok:true };
});

function mainWindowUrl(port, safeStart = false) {
  const url = new URL(`http://127.0.0.1:${port}/`);
  url.searchParams.set('mineradio-build', APP_RELEASE_VERSION);
  if (safeStart) url.searchParams.set('mineradio-safe-start', '1');
  if (profileNativeStartupRepairPending) url.searchParams.set('mineradio-profile-repair', '1');
  return url.toString();
}

function withStartupDeadline(operation, timeoutMs, code, onTimeout) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { if (typeof onTimeout === 'function') onTimeout(); } catch (_timeoutError) {}
      const error = new Error(code || 'STARTUP_OPERATION_TIMEOUT');
      error.code = code || 'STARTUP_OPERATION_TIMEOUT';
      reject(error);
    }, Math.max(250, Number(timeoutMs) || 0));
  });
  return Promise.race([Promise.resolve(operation), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function loadWindowWithStartupDeadline(win, url, timeoutMs, code, options = {}) {
  const preserveWhenRendererReady = options && options.preserveWhenRendererReady === true;
  return withStartupDeadline(
    win.loadURL(url),
    timeoutMs,
    code,
    () => {
      // `loadURL()` waits for every subresource, including optional remote
      // stylesheets.  Once the renderer has explicitly reported that the home
      // screen is ready, a slow font/CDN request must not stop the healthy page.
      if (preserveWhenRendererReady && mainWindowStartupReady) return;
      try { if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.stop(); } catch (_stopError) {}
    },
  );
}

async function forceRevealMainWindowSplash(win) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return null;
  const execution = win.webContents.executeJavaScript(`(() => {
    const body = document.body;
    if (!body) return { revealed: false, bootstrapped: false };
    const bootstrapped = window.__mineradioRendererBootstrapped === true;
    const splash = document.getElementById('splash');
    const splashVisible = !!(splash && !splash.classList.contains('hide') && splash.style.display !== 'none');
    if (splashVisible) {
      splash.classList.add('hide');
      splash.style.display = 'none';
    }
    body.classList.remove('splash-active', 'splash-revealing');
    if (typeof splashAnimating !== 'undefined') splashAnimating = false;
    if (typeof splashReadyToEnter !== 'undefined') splashReadyToEnter = false;
    if (typeof updateEmptyHomeVisibility === 'function') updateEmptyHomeVisibility({ forceLoad: true });
    if (typeof wakeMainRenderLoop === 'function') wakeMainRenderLoop();
    if (bootstrapped && typeof reportMineradioStartupReady === 'function') {
      reportMineradioStartupReady('watchdog-home-revealed');
    }
    return {
      revealed: splashVisible,
      bootstrapped
    };
  })()`, true).catch(() => null);
  return Promise.race([
    execution,
    new Promise(resolve => setTimeout(() => resolve(null), 1800)),
  ]);
}

async function runMainWindowStartupRecoveryStage(win, stage, reason) {
  writeStartupDiagnostic(`startup-safe-recovery-stage-${stage}`, reason || 'STARTUP_TIMEOUT');
  try {
    await withStartupDeadline(
      forceDisableWallpaperMode(`startup-recovery-stage-${stage}`),
      15000,
      `STARTUP_WALLPAPER_DETACH_STAGE_${stage}_TIMEOUT`,
    );
  } catch (error) {
    writeStartupDiagnostic(`startup-wallpaper-detach-stage-${stage}-failed`, error);
  }
  if (mainWindowStartupReady || win.isDestroyed() || win.webContents.isDestroyed()) return true;

  if (stage === 2) {
    try {
      await loadWindowWithStartupDeadline(win, 'about:blank', 5000, 'STARTUP_BLANK_LOAD_TIMEOUT');
    } catch (error) {
      writeStartupDiagnostic('startup-blank-load-failed', error);
    }
    // Never clear the full renderer localStorage as part of automatic startup
    // recovery. A slow GPU, font request, antivirus scan, or low-end machine can
    // legitimately miss the startup deadline; treating that as profile
    // corruption erased wallpaper choices, playlists, and every user setting.
    //
    // The safe-start preload already backs up and removes only the small set of
    // startup-critical visual keys. Cache cleanup below is sufficient for
    // disposable Chromium data and leaves durable user state intact.
    try { await session.defaultSession.flushStorageData(); } catch (_flushError) {}
    writeStartupDiagnostic(
      'startup-storage-preserved',
      reason || 'SECOND_STAGE_STARTUP_RECOVERY',
    );
  }
  if (mainWindowStartupReady || win.isDestroyed() || win.webContents.isDestroyed()) return true;
  try {
    await withStartupDeadline(
      session.defaultSession.clearCache(),
      6000,
      `STARTUP_CACHE_CLEAR_STAGE_${stage}_TIMEOUT`,
    );
  } catch (_cacheError) {}
  try {
    await loadWindowWithStartupDeadline(
      win,
      mainWindowUrl(mainServerPort, true),
      12000,
      `STARTUP_SAFE_LOAD_STAGE_${stage}_TIMEOUT`,
    );
    restoreMainWindowElectronInteraction(win, true);
    return true;
  } catch (error) {
    writeStartupDiagnostic(`startup-safe-reload-stage-${stage}-failed`, error);
    restoreMainWindowElectronInteraction(win, true);
    return false;
  }
}

function recoverMainWindowStartup(win, reason) {
  // Already-ready means startup recovery has nothing left to do and should be
  // reported as success to callers. Returning false here used to make a benign
  // loadURL subresource timeout bubble up and terminate the whole application.
  if (mainWindowStartupReady) return Promise.resolve(true);
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return Promise.resolve(false);
  if (mainWindowStartupRecoveryPromise) return mainWindowStartupRecoveryPromise;
  if (mainWindowStartupRecoveryStage >= 2) return Promise.resolve(false);

  mainWindowStartupRecoveryAttempted = true;
  mainWindowStartupSafeMode = true;
  const recovery = (async () => {
    for (let stage = mainWindowStartupRecoveryStage + 1; stage <= 2; stage += 1) {
      mainWindowStartupRecoveryStage = stage;
      const loaded = await runMainWindowStartupRecoveryStage(win, stage, reason);
      if (loaded || mainWindowStartupReady) return true;
      if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return false;
    }
    return false;
  })();
  const recoveryPromise = recovery.finally(() => {
    if (mainWindowStartupRecoveryPromise === recoveryPromise) mainWindowStartupRecoveryPromise = null;
  });
  mainWindowStartupRecoveryPromise = recoveryPromise;
  return recoveryPromise;
}

async function handleMainWindowStartupWatchdog(win) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed() || mainWindowStartupReady) return;
  const result = await forceRevealMainWindowSplash(win);
  if (mainWindowStartupReady || !win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  if (result && result.bootstrapped) {
    console.warn('[Startup] splash watchdog forced the home screen to reveal');
    await forceDisableWallpaperMode('startup-watchdog');
    await new Promise(resolve => setTimeout(resolve, 500));
    if (mainWindowStartupReady) return;
  }
  if (mainWindowStartupReady) return;
  await recoverMainWindowStartup(win, result ? 'RENDERER_BOOTSTRAP_INCOMPLETE' : 'RENDERER_UNRESPONSIVE');
}

async function createWindow() {
  htmlFullscreenActive = false;
  windowFullscreenActive = false;
  mainWindowDesktopEmbedded = false;
  mainWindowDesktopInteractive = false;
  mainWindowDesktopEmbeddingUncertain = false;
  mainWindowStartupReady = false;
  mainWindowStartupRecoveryAttempted = false;
  mainWindowStartupRecoveryStage = 0;
  mainWindowStartupRecoveryPromise = null;
  mainWindowStartupSafeMode = false;
  const port = await findOpenPort(3000);
  mainServerPort = port;

  // Listen on the LAN as well so the same full web UI can be used from a phone.
  // The desktop window continues to connect through loopback below.
  process.env.HOST = process.env.MINERADIO_HOST || '127.0.0.1';
  process.env.PORT = String(port);
  process.env.MINERADIO_UPDATE_DIR = getUpdateDownloadDir();
  process.env.MINERADIO_LOCAL_FILE_TOKEN = LOCAL_FILE_TOKEN;

  localServer = require(path.join(__dirname, '..', 'server.js'));
  await waitForServer(localServer);

  const initialBounds = getWindowedBounds();

  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: 960,
    minHeight: 540,
    resizable: true,
    maximizable: true,
    thickFrame: false,
    show: false,
    frame: false,
    fullscreen: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    autoHideMenuBar: true,
    title: APP_NAME,
    icon: getAppWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
    },
  });
  const mainAppUrl = `http://127.0.0.1:${port}`;
  let safeMediaRecoveryUsed = false;
  let unresponsiveRecoveryTimer = null;

  const watchedMainWindow = mainWindow;
  if (mainWindowShowFallbackTimer) clearTimeout(mainWindowShowFallbackTimer);
  mainWindowShowFallbackTimer = setTimeout(() => {
    mainWindowShowFallbackTimer = null;
    if (!watchedMainWindow || watchedMainWindow.isDestroyed()) return;
    // Do not depend solely on ready-to-show: a driver/media failure may prevent
    // that event even though the renderer has already produced usable content.
    watchedMainWindow.setSkipTaskbar(false);
    watchedMainWindow.show();
  }, 3200);

  try { mainWindow.setIcon(getAppWindowIcon()); } catch (_iconError) {}

  applyMainWindowBorderlessCorners(mainWindow);

  try {
    if (mainWindow.webContents && typeof mainWindow.webContents.setFrameRate === 'function') {
      const display = screen.getDisplayMatching(mainWindow.getBounds());
      mainWindow.webContents.setFrameRate(Math.max(60, Math.min(240, Number(display && display.displayFrequency) || 120)));
    }
  } catch (_e) {}

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(String(url || ''))) shell.openExternal(url);
    return { action: 'deny' };
  });
  hookExplorerRestartForWallpaper(mainWindow);

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const target = String(url || '');
    if (/^http:\/\/127\.0\.0\.1:\d+(?:\/|$)/i.test(target)) return;
    event.preventDefault();
    if (/^(https?:|mailto:)/i.test(target)) shell.openExternal(target);
  });

  const armSplashWatchdog = () => {
    if (mainWindowSplashWatchdogTimer) return;
    const watchedWindow = mainWindow;
    mainWindowSplashWatchdogTimer = setTimeout(() => {
      mainWindowSplashWatchdogTimer = null;
      handleMainWindowStartupWatchdog(watchedWindow).catch((error) => {
        writeStartupDiagnostic('startup-watchdog-failed', error);
      });
    }, 7000);
  };

  mainWindow.webContents.on('dom-ready', armSplashWatchdog);
  mainWindow.webContents.on('did-finish-load', () => {
    sendWindowState(mainWindow);
    armSplashWatchdog();
  });

  const recoverRendererWithSessionMediaDisabled = (reason) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    if (safeMediaRecoveryUsed) {
      console.error('[Startup] renderer recovery already used; skipped:', reason);
      return;
    }
    safeMediaRecoveryUsed = true;
    console.warn('[Startup] reloading with background video disabled for this session:', reason);
    try {
      mainWindow.setSkipTaskbar(false);
      mainWindow.show();
      mainWindow.webContents.loadURL(`${mainAppUrl}?safeMedia=1&recovery=1`).catch((error) => {
        console.error('[Renderer] safe-media recovery failed:', error);
      });
    } catch (error) {
      console.error('[Renderer] safe-media recovery failed:', error);
    }
  };

  mainWindow.webContents.on('unresponsive', () => {
    if (appQuitting || unresponsiveRecoveryTimer) return;
    unresponsiveRecoveryTimer = setTimeout(() => {
      unresponsiveRecoveryTimer = null;
      recoverRendererWithSessionMediaDisabled('renderer unresponsive during startup');
    }, 2200);
  });
  mainWindow.webContents.on('responsive', () => {
    if (!unresponsiveRecoveryTimer) return;
    clearTimeout(unresponsiveRecoveryTimer);
    unresponsiveRecoveryTimer = null;
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Renderer] process gone:', details && details.reason, details && details.exitCode);
    if (appQuitting) return;
    setTimeout(async () => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      if (!mainWindowStartupReady) {
        await recoverMainWindowStartup(mainWindow, JSON.stringify(details || {})).catch(() => {});
        return;
      }
      mainWindowStartupReady = false;
      mainWindowStartupRecoveryAttempted = false;
      mainWindowStartupRecoveryStage = 0;
      mainWindowStartupRecoveryPromise = null;
      await recoverMainWindowStartup(mainWindow, JSON.stringify(details || {})).catch((error) => {
        console.error('[Renderer] recovery failed:', error);
      });
    }, 700);
  });

  mainWindow.on('unresponsive', () => {
    writeStartupDiagnostic('main-window-unresponsive', 'Renderer did not respond');
    if (!mainWindowStartupReady) recoverMainWindowStartup(mainWindow, 'WINDOW_UNRESPONSIVE').catch(() => {});
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    const detail = `${code} ${description || ''} ${validatedURL || ''}`.trim();
    writeStartupDiagnostic('main-window-did-fail-load', detail);
    if (!mainWindowStartupReady) recoverMainWindowStartup(mainWindow, detail).catch(() => {});
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'Escape' || input.code === 'Escape') && (mainWindow.isFullScreen() || windowFullscreenActive || htmlFullscreenActive)) {
      event.preventDefault();
      exitFullscreenToWindow(mainWindow);
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindowShowFallbackTimer) {
      clearTimeout(mainWindowShowFallbackTimer);
      mainWindowShowFallbackTimer = null;
    }
    mainWindow.setSkipTaskbar(false);
    mainWindow.show();
    sendWindowState(mainWindow);
  });

  mainWindow.on('maximize', () => sendWindowState(mainWindow));
  mainWindow.on('unmaximize', () => sendWindowState(mainWindow));
  mainWindow.on('minimize', () => {
    // 最小化是正常缩到任务栏，不受“关闭到托盘”设置影响。
    mainWindow.setSkipTaskbar(false);
    sendWindowState(mainWindow);
    scheduleAppMemoryTrim('minimize', 1600);
  });
  mainWindow.on('restore', () => sendWindowState(mainWindow));
  mainWindow.on('show', () => sendWindowState(mainWindow));
  mainWindow.on('hide', () => {
    sendWindowState(mainWindow);
    scheduleAppMemoryTrim('hide', 2200);
  });
  mainWindow.on('focus', () => sendWindowState(mainWindow));
  mainWindow.on('blur', () => sendWindowState(mainWindow));
  mainWindow.on('move', () => {
    scheduleWindowStateSend(mainWindow);
    scheduleMainWindowBoundsSave(mainWindow);
  });
  mainWindow.on('resize', () => {
    scheduleWindowStateSend(mainWindow);
    scheduleMainWindowBoundsSave(mainWindow);
  });
  mainWindow.on('close', (event) => {
    if (mainWindowClosePersisting) return;
    event.preventDefault();
    // Do not hide into an invisible background process when tray creation
    // fails. In that case closing leaves the window available to the user.
    const shouldHideToTray = !appQuitting && closeToTrayEnabled && createTray();
    const win = mainWindow;
    mainWindowClosePersisting = true;
    const persist = win && !win.isDestroyed()
      ? Promise.race([
          win.webContents.executeJavaScript('try { savePlaybackSession(true); true; } catch (e) { false; }', true),
          new Promise((resolve) => setTimeout(resolve, 420)),
        ]).catch(() => false)
      : Promise.resolve(false);
    persist.finally(() => {
      mainWindowClosePersisting = false;
      if (!win || win.isDestroyed()) return;
      if (shouldHideToTray) {
        hideMainWindowToTray({ pauseLinked: true });
        return;
      }
      win.destroy();
    });
  });
  mainWindow.on('closed', () => {
    if (mainWindowShowFallbackTimer) {
      clearTimeout(mainWindowShowFallbackTimer);
      mainWindowShowFallbackTimer = null;
    }
    if (unresponsiveRecoveryTimer) {
      clearTimeout(unresponsiveRecoveryTimer);
      unresponsiveRecoveryTimer = null;
    }
    if (mainWindowSplashWatchdogTimer) {
      clearTimeout(mainWindowSplashWatchdogTimer);
      mainWindowSplashWatchdogTimer = null;
    }
    if (mainWindowStateTimer) {
      clearTimeout(mainWindowStateTimer);
      mainWindowStateTimer = null;
    }
    if (mainWindowBoundsSaveTimer) {
      clearTimeout(mainWindowBoundsSaveTimer);
      mainWindowBoundsSaveTimer = null;
    }
    closeOverlayWindows();
    mainWindowResizeStates.clear();
    mainWindow = null;
  });
  mainWindow.on('enter-full-screen', () => {
    windowFullscreenActive = true;
    sendWindowState(mainWindow);
  });
  mainWindow.on('leave-full-screen', () => {
    windowFullscreenActive = false;
    const restoreBounds = mainWindowPreFullscreenBounds || savedWindowedBounds();
    setTimeout(() => applyWindowedBounds(mainWindow, restoreBounds), 50);
  });
  mainWindow.on('enter-html-full-screen', () => {
    if (!mainWindowPreFullscreenBounds) capturePreFullscreenBounds(mainWindow);
    htmlFullscreenActive = true;
    sendWindowState(mainWindow);
  });
  mainWindow.on('leave-html-full-screen', () => {
    htmlFullscreenActive = false;
    const restoreBounds = mainWindowPreFullscreenBounds || savedWindowedBounds();
    setTimeout(() => applyWindowedBounds(mainWindow, restoreBounds), 50);
  });

  try {
    await loadWindowWithStartupDeadline(
      mainWindow,
      mainWindowUrl(port, false),
      12000,
      'INITIAL_MAIN_WINDOW_LOAD_TIMEOUT',
      { preserveWhenRendererReady: true },
    );
  } catch (error) {
    if (mainWindowStartupReady && error && error.code === 'INITIAL_MAIN_WINDOW_LOAD_TIMEOUT') {
      // The app's renderer-ready IPC is the authoritative startup signal.
      // Electron's loadURL promise can remain pending on an optional resource,
      // which is not a reason to enter recovery or terminate the application.
      writeStartupDiagnostic('initial-main-window-subresource-timeout-ignored', error);
      restoreMainWindowElectronInteraction(mainWindow, true);
      return;
    }
    writeStartupDiagnostic('initial-main-window-load-failed', error);
    const recovered = await recoverMainWindowStartup(mainWindow, 'INITIAL_MAIN_WINDOW_LOAD_FAILED');
    if (!recovered) throw error;
  }
}

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!focusMainWindow()) {
      app.whenReady().then(() => createWindow()).catch((error) => {
        writeStartupDiagnostic('second-instance-window-restore', error);
        console.error('Second instance window restore failed:', error);
      });
    }
  });

  app.whenReady().then(async () => {
    applySavedDesktopShellSettings();
    try {
      await wallpaperEngineNativeLibrary.installProtocol(protocol);
    } catch (error) {
      console.warn('[Wallpaper Engine] local media protocol unavailable:', error && error.message || error);
    }
    // Ordinary Mineradio traffic can bypass the VPN while Spotify keeps the
    // isolated system-network session below. An external switch persists the
    // choice and the file watcher applies changes without restarting the app.
    await queueNetworkSplitMode(resolveNetworkSplitEnabled(), 'startup');
    startNetworkSplitSettingsWatcher();
    // Playlist imports use an isolated session so Spotify cookies and cache do
    // not leak into the renderer. Explicitly inherit the Windows system proxy;
    // relying on Chromium's partition default made domestic-network behavior
    // vary between clean installs and upgraded profiles.
    try {
      const spotifyNetworkSession = session.fromPartition('persist:mineradio-system-network');
      await spotifyNetworkSession.setProxy({ mode:'system' });
    } catch (error) {
      console.warn('[Network] Spotify import session could not inherit the Windows system proxy:', error && error.message || error);
    }
    session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
      if (permission !== 'media' && permission !== 'speaker-selection') return false;
      return /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(String(requestingOrigin || ''));
    });
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const url = webContents && !webContents.isDestroyed() ? webContents.getURL() : '';
      callback((permission === 'media' || permission === 'speaker-selection') && /^http:\/\/127\.0\.0\.1:\d+\//.test(String(url || '')));
    });
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      const types = preferredDisplayMediaSourceId ? ['window', 'screen'] : ['screen'];
      desktopCapturer.getSources({ types, thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          const source = preferredDisplayMediaSourceId
            ? sources.find(item => item && item.id === preferredDisplayMediaSourceId)
            : sources[0];
          if (!source) {
            callback({});
            return;
          }
          callback(preferredDisplayMediaSourceId ? { video: source } : { video: source, audio: 'loopback' });
        })
        .catch(() => callback({}));
    });
    screen.on('display-metrics-changed', () => {
      positionDesktopLyricsWindow();
      positionWallpaperWindow();
      scheduleWindowStateSend(mainWindow);
      if (fullDesktopModeRuntime && fullDesktopModeRuntime.isEnabled()) {
        fullDesktopModeRuntime.reconcile('display-metrics-changed').catch(() => {});
      }
    });
    screen.on('display-added', () => {
      refreshWallpaperDesktopPlacement();
      scheduleWindowStateSend(mainWindow);
      if (fullDesktopModeRuntime && fullDesktopModeRuntime.isEnabled()) {
        fullDesktopModeRuntime.reconcile('display-added').catch(() => {});
      }
    });
    screen.on('display-removed', () => {
      refreshWallpaperDesktopPlacement();
      scheduleWindowStateSend(mainWindow);
      if (fullDesktopModeRuntime && fullDesktopModeRuntime.isEnabled()) {
        fullDesktopModeRuntime.reconcile('display-removed').catch(() => {});
      }
    });
    registerBootstrapDesktopInteractionHotkey();
    createTray();
    await createWindow();
    repairWindowsShellShortcutIcons();
    createTray();
    ensureDesktopShortcut();
    refreshTrayMenu();
  }).catch((error) => {
    const logPath = writeStartupDiagnostic('app-when-ready', error);
    console.error('Mineradio startup failed:', error);
    try {
      dialog.showErrorBox(
        'Mineradio 启动失败',
        `程序没有静默退出，错误信息已保存到：\n${logPath}\n\n请把这个文件发给开发者。`,
      );
    } catch (_dialogError) {}
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => {
        writeStartupDiagnostic('activate-create-window', error);
        console.error('Window activation failed:', error);
      });
    }
    else focusMainWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && (appQuitting || !closeToTrayEnabled)) app.quit();
  });

  app.on('before-quit', (event) => {
    if (appMemoryTrimTimer) { clearTimeout(appMemoryTrimTimer); appMemoryTrimTimer = null; }
    if (trayCreateRetryTimer) {
      clearTimeout(trayCreateRetryTimer);
      trayCreateRetryTimer = null;
    }
    if (lxPlaybackLinked && !lxPauseBeforeQuitDone) {
      event.preventDefault();
      appQuitting = true;
      Promise.race([
        pauseLinkedLxPlayback(),
        new Promise(resolve => setTimeout(resolve, 1300)),
      ]).finally(() => {
        lxPauseBeforeQuitDone = true;
        app.quit();
      });
      return;
    }
    appQuitting = true;
    unregisterMineradioGlobalHotkeys();
    closeOverlayWindows();
    if (fullDesktopModeRuntime) fullDesktopModeRuntime.dispose('app-before-quit').catch(() => {});
    wallpaperEngineNativeOperation += 1;
    clearWallpaperEngineNativeGrant();
    wallpaperEngineNativeRuntime.stop().catch(() => {});
    if (localServer && localServer.close) localServer.close();
    if (directLocalProxy && directLocalProxy.close) directLocalProxy.close().catch(() => {});
  });
}
