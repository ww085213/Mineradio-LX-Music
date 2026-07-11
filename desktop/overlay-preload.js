const { contextBridge, ipcRenderer } = require('electron');

function bind(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload || {});
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('desktopOverlay', {
  onLyricsState: (callback) => bind('mineradio-desktop-lyrics-state', callback),
  onWallpaperState: (callback) => bind('mineradio-wallpaper-state', callback),
  setWallpaperPointerCapture: (active) => ipcRenderer.invoke('mineradio-wallpaper-set-pointer-capture', !!active),
  sendWallpaperCommand: (payload) => ipcRenderer.invoke('mineradio-wallpaper-command', payload || {}),
  setLyricsDrag: (dragging) => ipcRenderer.invoke('mineradio-desktop-lyrics-set-dragging', !!dragging),
  setLyricsPointerCapture: (active) => ipcRenderer.invoke('mineradio-desktop-lyrics-set-pointer-capture', !!active),
  setLyricsHotBounds: (bounds) => ipcRenderer.invoke('mineradio-desktop-lyrics-set-hot-bounds', bounds || {}),
  setLyricsLockState: (locked) => ipcRenderer.invoke('mineradio-desktop-lyrics-set-lock-state', !!locked),
  setLyricsSize: (size) => ipcRenderer.invoke('mineradio-desktop-lyrics-set-size', Number(size) || 1),
  moveLyricsBy: (dx, dy) => ipcRenderer.invoke('mineradio-desktop-lyrics-move-by', Number(dx) || 0, Number(dy) || 0),
  startLyricsGlobalDrag: (screenX, screenY) => ipcRenderer.invoke('mineradio-desktop-lyrics-start-global-drag', Number(screenX) || 0, Number(screenY) || 0),
  dragLyricsTo: (screenX, screenY) => ipcRenderer.send('mineradio-desktop-lyrics-drag-to', Number(screenX) || 0, Number(screenY) || 0),
  stopLyricsGlobalDrag: () => ipcRenderer.invoke('mineradio-desktop-lyrics-stop-global-drag'),
  closeLyrics: () => ipcRenderer.invoke('mineradio-desktop-lyrics-set-enabled', false, {}),
});
