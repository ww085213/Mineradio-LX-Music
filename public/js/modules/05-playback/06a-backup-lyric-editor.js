'use strict';

var MINERADIO_FULL_BACKUP_TYPE = 'mineradio-full-backup';
var MINERADIO_FULL_BACKUP_SCHEMA = 1;
var lyricTrackEditorState = { songKey: '', lines: [], dirty: false, sliderOffset: 0 };

function isSensitiveBackupKey(key) {
  return /(cookie|token|credential|secret|password|login[-_]?session|auth[-_]?session)/i.test(String(key || ''));
}
function collectMineradioBackupStorage() {
  var values = {};
  for (var i = 0; i < localStorage.length; i++) {
    var key = localStorage.key(i);
    if (!key || isSensitiveBackupKey(key)) continue;
    values[key] = localStorage.getItem(key);
  }
  return values;
}
function mineradioBackupDefaultName() {
  var now = new Date();
  function pad(value) { return String(value).padStart(2, '0'); }
  return 'Mineradio-完整备份-' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes()) + '.json';
}
function exportMineradioFullBackup() {
  var api = window.desktopWindow;
  if (!api || typeof api.exportJsonFile !== 'function') {
    showToast('当前环境不支持文件导出');
    return;
  }
  var payload = {
    type: MINERADIO_FULL_BACKUP_TYPE,
    schema: MINERADIO_FULL_BACKUP_SCHEMA,
    exportedAt: Date.now(),
    appVersion: '1.5.6.3',
    note: '包含设置、歌单、视觉存档和歌词校准；不包含登录 Cookie/Token。',
    localStorage: collectMineradioBackupStorage()
  };
  api.exportJsonFile({ defaultName: mineradioBackupDefaultName(), text: JSON.stringify(payload, null, 2) }).then(function (result) {
    if (result && result.ok) showToast('完整备份已导出');
    else if (!(result && result.canceled)) showToast('完整备份导出失败');
  });
}
function importMineradioFullBackup() {
  var api = window.desktopWindow;
  if (!api || typeof api.importJsonFile !== 'function') {
    showToast('当前环境不支持文件导入');
    return;
  }
  api.importJsonFile().then(function (result) {
    if (!result || !result.ok) {
      if (!(result && result.canceled)) showToast('读取备份失败');
      return;
    }
    var payload;
    try { payload = JSON.parse(result.text || ''); } catch (_error) { showToast('备份文件不是有效 JSON'); return; }
    if (!payload || payload.type !== MINERADIO_FULL_BACKUP_TYPE || !payload.localStorage || typeof payload.localStorage !== 'object') {
      showToast('这不是 Mineradio 完整备份');
      return;
    }
    var keys = Object.keys(payload.localStorage).filter(function (key) { return !isSensitiveBackupKey(key); });
    if (!keys.length) { showToast('备份中没有可恢复的数据'); return; }
    if (!window.confirm('将恢复 ' + keys.length + ' 项设置、歌单、视觉存档和歌词数据，并重启界面。\n\n当前数据不会先被清空，备份内容会覆盖同名项目。是否继续？')) return;
    try {
      keys.forEach(function (key) {
        var value = payload.localStorage[key];
        if (typeof value === 'string') localStorage.setItem(key, value);
      });
      showToast('恢复完成，正在重新载入');
      setTimeout(function () { location.reload(); }, 650);
    } catch (error) {
      console.warn('[FullBackup] restore failed:', error);
      showToast('恢复失败，本地存储空间可能不足');
    }
  });
}
function installFullBackupActions() {
  var toolbar = document.querySelector('#user-archive-grid .user-archive-tools');
  if (!toolbar || toolbar.querySelector('[data-full-backup]')) return;
  var exportButton = document.createElement('button');
  exportButton.className = 'fx-mini-btn ghost';
  exportButton.type = 'button';
  exportButton.dataset.fullBackup = 'export';
  exportButton.textContent = '完整备份';
  exportButton.title = '一键导出设置、歌单、视觉预设和歌词校准';
  exportButton.onclick = exportMineradioFullBackup;
  var importButton = document.createElement('button');
  importButton.className = 'fx-mini-btn ghost';
  importButton.type = 'button';
  importButton.dataset.fullBackup = 'import';
  importButton.textContent = '完整恢复';
  importButton.title = '从完整备份恢复，登录态不会被导入';
  importButton.onclick = importMineradioFullBackup;
  toolbar.appendChild(exportButton);
  toolbar.appendChild(importButton);
}
var renderUserFxArchivesBeforeFullBackup = renderUserFxArchives;
renderUserFxArchives = function () {
  var result = renderUserFxArchivesBeforeFullBackup.apply(this, arguments);
  installFullBackupActions();
  return result;
};

function readCustomLyricMap() {
  try {
    var raw = JSON.parse(localStorage.getItem(CUSTOM_LYRIC_STORE_KEY) || '{}') || {};
    var out = {};
    Object.keys(raw).forEach(function (key) {
      var item = raw[key];
      if (typeof item === 'string') out[key] = { text: item, updatedAt: 0 };
      else if (item && typeof item.text === 'string') {
        out[key] = { text: item.text, updatedAt: item.updatedAt || 0, fileName: item.fileName || '' };
        if (item.editor && Array.isArray(item.editor.lines)) {
          out[key].editor = {
            schema: 1,
            lines: item.editor.lines.map(normalizeLyricEditorLine).filter(Boolean)
          };
        }
      }
    });
    return out;
  } catch (_error) { return {}; }
}
function normalizeLyricEditorLine(line) {
  line = line || {};
  var time = Number(line.t);
  if (!isFinite(time)) return null;
  return {
    t: Math.max(0, Math.round(time * 1000) / 1000),
    original: String(line.original != null ? line.original : (line.text || '')),
    translation: String(line.translation || ''),
    romanization: String(line.romanization || line.romaji || '')
  };
}
function lyricEditorLinesFromCurrent(song) {
  var entry = getCustomLyricEntry(song);
  if (entry && entry.editor && Array.isArray(entry.editor.lines) && entry.editor.lines.length) {
    return entry.editor.lines.map(normalizeLyricEditorLine).filter(Boolean);
  }
  var source = entry && entry.text ? parseCustomLyricText(entry.text) : (originalLyricsState.lines && originalLyricsState.lines.length ? originalLyricsState.lines : lyricsLines);
  return (source || []).filter(function (line) { return line && !line.fallback; }).map(function (line) {
    return normalizeLyricEditorLine({ t: line.t, original: line.text, translation: line.translation || '', romanization: line.romanization || '' });
  }).filter(Boolean);
}
function formatLyricTimestamp(seconds, millisecondPrecision) {
  seconds = Math.max(0, Number(seconds) || 0);
  var minutes = Math.floor(seconds / 60);
  var rest = seconds - minutes * 60;
  var digits = millisecondPrecision ? 3 : 2;
  return String(minutes).padStart(2, '0') + ':' + rest.toFixed(digits).padStart(digits + 3, '0');
}
function lyricEditorStandardLrc(lines) {
  return (lines || []).filter(function (line) { return String(line.original || '').trim(); }).map(function (line) {
    return '[' + formatLyricTimestamp(line.t, false) + '] ' + String(line.original || '').trim();
  }).join('\n');
}
function lyricEditorEnhancedLrc(lines, song) {
  var output = ['[ti:' + String(song && (song.name || song.title) || '') + ']', '[ar:' + String(song && song.artist || '') + ']', '[by:Mineradio 三轨歌词编辑器]'];
  (lines || []).forEach(function (line) {
    var stamp = '[' + formatLyricTimestamp(line.t, true) + ']';
    if (String(line.original || '').trim()) output.push(stamp + ' ' + String(line.original).trim());
    if (String(line.translation || '').trim()) output.push(stamp + ' [tr]' + String(line.translation).trim());
    if (String(line.romanization || '').trim()) output.push(stamp + ' [roma]' + String(line.romanization).trim());
  });
  return output.join('\n');
}
function parseEnhancedEditorText(text) {
  var grouped = {};
  String(text || '').split(/\r?\n/).forEach(function (raw) {
    var match = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
    if (!match) return;
    var time = Number(match[1]) * 60 + Number(match[2]);
    var key = String(Math.round(time * 1000));
    var row = grouped[key] || (grouped[key] = { t: time, original: '', translation: '', romanization: '' });
    var value = match[3] || '';
    if (/^\[tr\]/i.test(value)) row.translation = value.replace(/^\[tr\]\s*/i, '');
    else if (/^\[(?:roma|romaji)\]/i.test(value)) row.romanization = value.replace(/^\[(?:roma|romaji)\]\s*/i, '');
    else row.original = value;
  });
  return Object.keys(grouped).map(function (key) { return grouped[key]; }).sort(function (a, b) { return a.t - b.t; });
}
function buildAppliedEditorState(lines) {
  var sorted = (lines || []).map(normalizeLyricEditorLine).filter(Boolean).sort(function (a, b) { return a.t - b.t; });
  var primary = finalizeLyricLineDurations(sorted.map(function (line) {
    return { t: line.t, text: line.original || line.translation || line.romanization || '…', translation: line.translation || '', romanization: line.romanization || '', source: 'custom-editor', charCount: Math.max(1, String(line.original || '').length) };
  }));
  var translations = sorted.filter(function (line) { return String(line.translation || '').trim(); }).map(function (line) {
    return { t: line.t, text: line.translation, source: 'custom-editor-translation' };
  });
  return { lines: primary, translations: translations };
}
function applyCustomLyricState(song, silent, renderOptions) {
  song = song || currentLyricSong();
  var entry = getCustomLyricEntry(song);
  if (!entry || !String(entry.text || '').trim()) {
    if (!silent) openCustomLyricModal();
    updateCustomLyricControls();
    return false;
  }
  if (entry.editor && Array.isArray(entry.editor.lines) && entry.editor.lines.length) {
    var state = buildAppliedEditorState(entry.editor.lines);
    if (!state.lines.length) return false;
    lyricSourceMode = 'custom';
    applyLyricsState(state.lines, false, 'custom-editor', state.translations, state.translations.length ? 'custom-editor' : 'none', renderOptions);
    return true;
  }
  var lines = parseCustomLyricText(entry.text);
  if (!lines.length) return false;
  lyricSourceMode = 'custom';
  applyLyricsState(lines, false, lines[0] && lines[0].source === 'custom-lrc' ? 'custom-lrc' : 'custom-text', [], 'none', renderOptions);
  return true;
}
function ensureLyricTrackEditorUi() {
  var modal = document.querySelector('#custom-lyric-modal .custom-lyric-modal');
  var legacy = document.getElementById('custom-lyric-input');
  if (!modal || !legacy || document.getElementById('lyric-track-editor')) return;
  modal.classList.add('lyric-editor-modal');
  legacy.style.display = 'none';
  var editor = document.createElement('div');
  editor.id = 'lyric-track-editor';
  editor.innerHTML = '<div class="lyric-editor-toolbar"><button class="modal-btn" type="button" onclick="loadCurrentLyricsIntoEditor()">从当前歌词载入</button><button class="modal-btn" type="button" onclick="addLyricEditorLine()">＋ 添加行</button><label>精确偏移 <input id="lyric-editor-offset" type="number" step="0.1" value="0"> 秒</label><button class="modal-btn" type="button" onclick="applyLyricEditorOffset()">应用</button><label class="lyric-editor-drag">拖动整轨 <input id="lyric-editor-drag" type="range" min="-5" max="5" step="0.05" value="0" oninput="dragLyricEditorTimeline(this.value)" onchange="finishLyricEditorTimelineDrag(this)"><output id="lyric-editor-drag-value">0.00s</output></label></div><div class="lyric-editor-hint">播放时点击每行左侧的“校时”，即可把该句时间设为当前播放位置。可分别编辑原文、翻译和罗马音。</div><div class="lyric-editor-head"><span>校时</span><span>时间（秒）</span><span>原文</span><span>翻译</span><span>罗马音</span><span></span></div><div id="lyric-editor-rows"></div><div class="lyric-editor-export"><button class="modal-btn" type="button" onclick="exportCurrentLyrics(false)">导出 LRC</button><button class="modal-btn" type="button" onclick="exportCurrentLyrics(true)">导出增强 LRC</button></div>';
  legacy.parentNode.insertBefore(editor, legacy.nextSibling);
  var style = document.createElement('style');
  style.textContent = '.lyric-editor-modal{width:min(1120px,96vw)!important;max-width:min(1120px,96vw)!important}.lyric-editor-toolbar,.lyric-editor-export{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}.lyric-editor-toolbar label{font-size:11px;color:rgba(255,255,255,.62)}.lyric-editor-toolbar input[type="number"]{width:74px;margin:0 4px;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:rgba(255,255,255,.06);color:#fff;padding:7px}.lyric-editor-drag{display:flex;align-items:center;gap:6px;flex:1;min-width:210px}.lyric-editor-drag input{flex:1;min-width:100px;accent-color:#f4d28a}.lyric-editor-drag output{width:48px;color:#f4d28a}.lyric-editor-hint{font-size:11px;color:rgba(255,255,255,.48);margin-bottom:8px}.lyric-editor-head,.lyric-editor-row{display:grid;grid-template-columns:58px 92px minmax(160px,1fr) minmax(150px,1fr) minmax(150px,1fr) 34px;gap:7px;align-items:center}.lyric-editor-head{padding:0 4px 6px;font-size:10px;color:rgba(255,255,255,.4)}#lyric-editor-rows{max-height:42vh;overflow:auto;padding-right:5px}.lyric-editor-row{margin-bottom:6px}.lyric-editor-row input{min-width:0;width:100%;border:1px solid rgba(255,255,255,.09);border-radius:8px;background:rgba(255,255,255,.045);color:#fff;padding:8px;font:12px inherit}.lyric-editor-row input:focus{outline:none;border-color:rgba(244,210,138,.42)}.lyric-sync-btn,.lyric-delete-btn{border:1px solid rgba(255,255,255,.1);border-radius:8px;background:rgba(255,255,255,.05);color:rgba(255,255,255,.72);height:32px;cursor:pointer}.lyric-sync-btn{color:#f4d28a}.lyric-editor-export{justify-content:flex-end}@media(max-width:760px){.lyric-editor-head{display:none}.lyric-editor-row{grid-template-columns:52px 82px 1fr 34px}.lyric-editor-row input[data-field="translation"],.lyric-editor-row input[data-field="romanization"]{grid-column:3 / 5}.lyric-editor-modal{padding:18px!important}}';
  document.head.appendChild(style);
}
function renderLyricTrackEditor() {
  ensureLyricTrackEditorUi();
  var root = document.getElementById('lyric-editor-rows');
  if (!root) return;
  root.innerHTML = '';
  lyricTrackEditorState.lines.forEach(function (line, index) {
    var row = document.createElement('div');
    row.className = 'lyric-editor-row';
    var sync = document.createElement('button');
    sync.type = 'button'; sync.className = 'lyric-sync-btn'; sync.textContent = '校时'; sync.title = '设为当前播放时间';
    sync.onclick = function () { syncLyricEditorLine(index); };
    row.appendChild(sync);
    ['t', 'original', 'translation', 'romanization'].forEach(function (field) {
      var input = document.createElement('input');
      input.dataset.field = field;
      input.value = field === 't' ? Number(line.t || 0).toFixed(3) : String(line[field] || '');
      input.type = field === 't' ? 'number' : 'text';
      if (field === 't') input.step = '0.001';
      input.placeholder = field === 'original' ? '原文' : (field === 'translation' ? '翻译' : (field === 'romanization' ? '罗马音' : '秒'));
      input.oninput = function () {
        lyricTrackEditorState.lines[index][field] = field === 't' ? Math.max(0, Number(input.value) || 0) : input.value;
        lyricTrackEditorState.dirty = true;
      };
      row.appendChild(input);
    });
    var remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'lyric-delete-btn'; remove.textContent = '×'; remove.title = '删除这一行';
    remove.onclick = function () { lyricTrackEditorState.lines.splice(index, 1); lyricTrackEditorState.dirty = true; renderLyricTrackEditor(); };
    row.appendChild(remove);
    root.appendChild(row);
  });
}
function openCustomLyricModal() {
  var song = currentLyricSong();
  if (!song) { showToast('先播放或选择一首歌'); return; }
  if (immersiveMode) setImmersiveMode(false);
  ensureLyricTrackEditorUi();
  var entry = getCustomLyricEntry(song);
  var title = document.getElementById('custom-lyric-title');
  var sub = document.getElementById('custom-lyric-sub');
  if (title) title.textContent = song.name || song.title || '当前歌曲';
  if (sub) sub.textContent = (song.artist || '') + (entry ? ' · 已保存三轨歌词' : ' · 点击“校时”可对齐当前播放位置');
  lyricTrackEditorState = { songKey: songCustomLyricKey(song), lines: lyricEditorLinesFromCurrent(song), dirty: false, sliderOffset: 0 };
  if (!lyricTrackEditorState.lines.length) lyricTrackEditorState.lines.push({ t: 0, original: '', translation: '', romanization: '' });
  renderLyricTrackEditor();
  setCustomLyricStatus(entry ? '已读取本地歌词校准' : '可从当前歌词载入后开始校准', entry ? 'good' : '');
  openGsapModal(document.getElementById('custom-lyric-modal'));
}
function loadCurrentLyricsIntoEditor() {
  var source = (originalLyricsState.lines && originalLyricsState.lines.length ? originalLyricsState.lines : lyricsLines) || [];
  var next = source.filter(function (line) { return line && !line.fallback; }).map(function (line) {
    return normalizeLyricEditorLine({ t: line.t, original: line.text, translation: line.translation || '', romanization: line.romanization || '' });
  }).filter(Boolean);
  if (!next.length) { showToast('当前没有可载入的歌词'); return; }
  if (lyricTrackEditorState.dirty && !window.confirm('载入会覆盖编辑器里尚未保存的内容，继续吗？')) return;
  lyricTrackEditorState.lines = next; lyricTrackEditorState.dirty = true; renderLyricTrackEditor();
  setCustomLyricStatus('已载入当前歌词，共 ' + next.length + ' 行');
}
function addLyricEditorLine() {
  var last = lyricTrackEditorState.lines[lyricTrackEditorState.lines.length - 1];
  lyricTrackEditorState.lines.push({ t: last ? Number(last.t || 0) + 4 : (audio ? Number(audio.currentTime || 0) : 0), original: '', translation: '', romanization: '' });
  lyricTrackEditorState.dirty = true; renderLyricTrackEditor();
  var root = document.getElementById('lyric-editor-rows'); if (root) root.scrollTop = root.scrollHeight;
}
function syncLyricEditorLine(index) {
  var time = audio && isFinite(audio.currentTime) ? audio.currentTime : 0;
  if (!lyricTrackEditorState.lines[index]) return;
  lyricTrackEditorState.lines[index].t = Math.max(0, Math.round(time * 1000) / 1000);
  lyricTrackEditorState.dirty = true; renderLyricTrackEditor();
  setCustomLyricStatus('第 ' + (index + 1) + ' 行已校准到 ' + formatLyricTimestamp(time, true), 'good');
}
function applyLyricEditorOffset() {
  var input = document.getElementById('lyric-editor-offset');
  var offset = Number(input && input.value);
  if (!isFinite(offset) || offset === 0) { showToast('请输入非零偏移秒数'); return; }
  lyricTrackEditorState.lines.forEach(function (line) { line.t = Math.max(0, Math.round((Number(line.t || 0) + offset) * 1000) / 1000); });
  lyricTrackEditorState.dirty = true; renderLyricTrackEditor();
  setCustomLyricStatus('整轨已偏移 ' + (offset > 0 ? '+' : '') + offset.toFixed(3) + ' 秒', 'good');
}
function dragLyricEditorTimeline(value) {
  value = Number(value) || 0;
  var delta = value - (Number(lyricTrackEditorState.sliderOffset) || 0);
  if (!delta) return;
  lyricTrackEditorState.lines.forEach(function (line) { line.t = Math.max(0, Math.round((Number(line.t || 0) + delta) * 1000) / 1000); });
  lyricTrackEditorState.sliderOffset = value;
  lyricTrackEditorState.dirty = true;
  var output = document.getElementById('lyric-editor-drag-value');
  if (output) output.textContent = (value > 0 ? '+' : '') + value.toFixed(2) + 's';
  renderLyricTrackEditor();
}
function finishLyricEditorTimelineDrag(input) {
  var applied = Number(lyricTrackEditorState.sliderOffset) || 0;
  lyricTrackEditorState.sliderOffset = 0;
  if (input) input.value = '0';
  var output = document.getElementById('lyric-editor-drag-value');
  if (output) output.textContent = '0.00s';
  setCustomLyricStatus('整轨拖动完成：' + (applied > 0 ? '+' : '') + applied.toFixed(2) + ' 秒', 'good');
}
function saveCustomLyricForCurrent() {
  var song = currentLyricSong();
  var key = songCustomLyricKey(song);
  if (!song || !key) { setCustomLyricStatus('请先播放或选择一首歌', 'fail'); return; }
  var lines = lyricTrackEditorState.lines.map(normalizeLyricEditorLine).filter(function (line) {
    return line && (String(line.original).trim() || String(line.translation).trim() || String(line.romanization).trim());
  }).sort(function (a, b) { return a.t - b.t; });
  if (!lines.length) { setCustomLyricStatus('至少需要一行歌词', 'fail'); return; }
  var text = lyricEditorStandardLrc(lines);
  if (!text) text = lyricEditorEnhancedLrc(lines, song);
  customLyricMap[key] = { text: text, updatedAt: Date.now(), editor: { schema: 1, lines: lines } };
  customLyricPrefs[key] = 'custom';
  var saved = saveCustomLyricMap(); saveCustomLyricPrefs();
  lyricTrackEditorState.lines = lines; lyricTrackEditorState.dirty = false;
  applyCustomLyricState(song, true); updateCustomLyricControls();
  setCustomLyricStatus(saved ? ('已保存 ' + lines.length + ' 行三轨歌词') : '已应用，但本地存储空间不足', saved ? 'good' : 'fail');
  showToast(saved ? '三轨歌词与校准已保存' : '歌词已应用');
}
function exportCurrentLyrics(enhanced) {
  var song = currentLyricSong();
  var lines = lyricTrackEditorState.lines.map(normalizeLyricEditorLine).filter(Boolean).sort(function (a, b) { return a.t - b.t; });
  if (!song || !lines.length) { showToast('没有可导出的歌词'); return; }
  var text = enhanced ? lyricEditorEnhancedLrc(lines, song) : lyricEditorStandardLrc(lines);
  if (!text) { showToast('没有可导出的原文歌词'); return; }
  var safeName = String(song.name || song.title || 'Mineradio 歌词').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 70) + (enhanced ? '.elrc' : '.lrc');
  var api = window.desktopWindow;
  if (api && typeof api.exportTextFile === 'function') {
    api.exportTextFile({ defaultName: safeName, extension: enhanced ? 'elrc' : 'lrc', filterName: enhanced ? '增强 LRC' : 'LRC 歌词', title: enhanced ? '导出增强 LRC' : '导出 LRC', text: text }).then(function (result) {
      if (result && result.ok) showToast(enhanced ? '增强 LRC 已导出' : 'LRC 已导出');
      else if (!(result && result.canceled)) showToast('歌词导出失败');
    });
  } else showToast('当前环境不支持文件导出');
}

setTimeout(function () { ensureLyricTrackEditorUi(); installFullBackupActions(); }, 0);
