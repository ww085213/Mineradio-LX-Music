'use strict';

(function installMineradioAgentMusicTools() {
  var DEFAULT_SOURCES = ['tx', 'wy', 'kw', 'kg', 'mg'];
  var SOURCE_ALIASES = {
    qq: 'tx', tx: 'tx',
    netease: 'wy', wy: 'wy',
    kuwo: 'kw', kw: 'kw',
    kugou: 'kg', kg: 'kg',
    migu: 'mg', mg: 'mg'
  };
  var lastSearch = { query: '', songs: [], at: 0 };
  var pendingRecommendedSongs = null;
  var DIY_VISUAL_PRESETS = {
    album_cover: { index: 0, label: 'emily专辑封面' },
    tunnel: { index: 1, label: '滚筒' },
    planet: { index: 2, label: '星球' },
    void: { index: 3, label: '虚空' },
    disc: { index: 4, label: '唱片' },
    star_river: { index: 5, label: '星河' },
    skull: { index: 6, label: '安魂' },
    terrain: { index: 7, label: '声境' },
    aurora: { index: 8, label: '极光' },
    neon_rain: { index: 9, label: '霓虹雨夜' },
    ink: { index: 11, label: '水墨' },
    minimal: { index: 12, label: '纯净舞台' },
    sonic_ajin: { index: 13, label: '音域回响 · Ajin' },
    sonic_wallpaper_engine: { index: 14, label: '音域回响 · Wallpaper Engine' }
  };
  var DIY_LYRIC_FONTS = {
    sans: '默认', hei: '黑体', song: '宋体', 'bold-song': '粗宋', 'stone-song': '石印宋',
    'kai-song': '楷宋', 'serif-en': 'Serif', gothic: 'Gothic', editorial: 'Editorial',
    humanist: 'Humanist', round: '圆体', mono: '等宽', display: '标题'
  };

  function toolError(code, message, details) {
    return {
      ok: false,
      error: code,
      message: message,
      details: details || null,
      authMode: 'imported-lx-source',
      requiresLogin: false
    };
  }

  function asOptions(input) {
    if (typeof input === 'string') return { query: input };
    return input && typeof input === 'object' ? input : {};
  }

  function normalizeText(value) {
    var text = String(value || '');
    try { text = text.normalize('NFKC'); } catch (_error) {}
    return text.toLowerCase()
      .replace(/&amp;/g, '&')
      .replace(/[\s\u00b7\u30fb,，。.!！?？'"“”‘’|\-_/（）()【】\[\]]+/g, '');
  }

  function hasOwn(object, key) {
    return !!(object && Object.prototype.hasOwnProperty.call(object, key));
  }

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, Number(value)));
  }

  function percentFromRange(value, min, max) {
    return Math.round(clampNumber((Number(value) - min) / (max - min), 0, 1) * 100);
  }

  function valueFromPercent(value, min, max) {
    return Math.round((min + clampNumber(value, 0, 100) / 100 * (max - min)) * 1000) / 1000;
  }

  function normalizeDiyPreset(value) {
    if (typeof value === 'number' && isFinite(value)) {
      var numeric = Math.round(value);
      var numericKey = Object.keys(DIY_VISUAL_PRESETS).find(function (key) { return DIY_VISUAL_PRESETS[key].index === numeric; });
      return numericKey || '';
    }
    var raw = String(value || '').trim().toLowerCase();
    if (raw === 'smart') return 'smart';
    if (hasOwn(DIY_VISUAL_PRESETS, raw)) return raw;
    var token = normalizeText(raw);
    var aliases = {
      '智能声境': 'smart', '智能': 'smart',
      'emily专辑封面': 'album_cover', '专辑封面': 'album_cover', '封面粒子': 'album_cover',
      '滚筒': 'tunnel', '隧道': 'tunnel',
      '星球': 'planet', '行星': 'planet',
      '虚空': 'void',
      '唱片': 'disc', '圆形封面': 'disc',
      '星河': 'star_river', '壁纸粒子': 'star_river',
      '安魂': 'skull', '骷髅': 'skull',
      '声境': 'terrain', '地形': 'terrain', '3d地形': 'terrain',
      '极光': 'aurora',
      '霓虹雨夜': 'neon_rain', '霓虹': 'neon_rain', '雨夜': 'neon_rain',
      '水墨': 'ink', '国风': 'ink',
      '纯净舞台': 'minimal', '极简舞台': 'minimal', '极简': 'minimal',
      '音域回响': 'sonic_ajin', '音域回响ajin': 'sonic_ajin', 'sonictopography': 'sonic_ajin', 'ajin': 'sonic_ajin',
      '音域回响wallpaperengine': 'sonic_wallpaper_engine', '音域回响we': 'sonic_wallpaper_engine', 'wallpaperengine': 'sonic_wallpaper_engine', 'cmzya': 'sonic_wallpaper_engine'
    };
    if (aliases[token]) return aliases[token];
    return Object.keys(DIY_VISUAL_PRESETS).find(function (key) { return normalizeText(key) === token; }) || '';
  }

  function normalizeDiyLyricFont(value) {
    var raw = String(value || '').trim().toLowerCase();
    if (hasOwn(DIY_LYRIC_FONTS, raw)) return raw;
    var aliases = {
      '默认': 'sans', '无衬线': 'sans', '黑体': 'hei', '宋体': 'song', '粗宋': 'bold-song',
      '石印宋': 'stone-song', '楷宋': 'kai-song', '楷体': 'kai-song', '衬线': 'serif-en',
      '哥特': 'gothic', '编辑体': 'editorial', '人文': 'humanist', '圆体': 'round',
      '等宽': 'mono', '等宽字体': 'mono', '标题': 'display', '标题体': 'display'
    };
    return aliases[normalizeText(raw)] || '';
  }

  function normalizeDiyColor(value) {
    var raw = String(value || '').trim().toLowerCase();
    var named = {
      '黑色': '#000000', '白色': '#ffffff', '红色': '#ff3b5c', '橙色': '#ff8a3d',
      '黄色': '#ffd84d', '绿色': '#35d07f', '青色': '#00f5d4', '蓝色': '#368cff',
      '深蓝色': '#0b1f3a', '紫色': '#8a63ff', '粉色': '#ff79b0', '灰色': '#7f8792'
    };
    if (named[raw]) return named[raw];
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
    if (/^[0-9a-f]{6}$/i.test(raw)) return '#' + raw.toLowerCase();
    return '';
  }

  function normalizeSources(value) {
    var raw = Array.isArray(value) ? value : String(value || '').split(',');
    var sources = raw.map(function (item) {
      return SOURCE_ALIASES[String(item || '').trim().toLowerCase()] || '';
    }).filter(function (item, index, all) {
      return item && all.indexOf(item) === index;
    });
    return sources.length ? sources : DEFAULT_SOURCES.slice();
  }

  function safeSongSummary(song) {
    song = song || {};
    var artist = '';
    try {
      artist = typeof songArtistText === 'function'
        ? songArtistText(song)
        : String(song.singer || song.artist || song.author || '');
    } catch (_error) {
      artist = String(song.singer || song.artist || song.author || '');
    }
    return {
      title: String(song.name || song.title || '').slice(0, 240),
      artist: String(artist || '').slice(0, 240),
      album: String(song.albumName || song.album || '').slice(0, 240)
    };
  }

  function getCurrentPlayerSong() {
    try {
      if (typeof currentCoverSong === 'function') return currentCoverSong();
      if (typeof playQueue !== 'undefined' && typeof currentIdx !== 'undefined' && currentIdx >= 0) return playQueue[currentIdx] || null;
    } catch (_error) {}
    return null;
  }

  function getDiyContext() {
    var visual = null;
    try { visual = typeof fx !== 'undefined' && fx && typeof fx === 'object' ? fx : null; } catch (_error) {}
    var enabled = false;
    var smart = false;
    try { enabled = typeof diyPlayerMode !== 'undefined' && !!diyPlayerMode; } catch (_error) {}
    try { smart = typeof smartSoundscapeEnabled !== 'undefined' && !!smartSoundscapeEnabled; } catch (_error) {}
    var presetIndex = visual ? Math.round(Number(visual.preset) || 0) : 0;
    var presetKey = Object.keys(DIY_VISUAL_PRESETS).find(function (key) {
      return DIY_VISUAL_PRESETS[key].index === presetIndex;
    }) || 'album_cover';
    var fontKey = visual ? normalizeDiyLyricFont(visual.lyricFont) : 'sans';
    if (!fontKey) fontKey = 'sans';
    return {
      enabled: enabled,
      preset: smart ? 'smart' : presetKey,
      presetName: smart ? '智能声境' : DIY_VISUAL_PRESETS[presetKey].label,
      intensity: visual ? percentFromRange(visual.intensity, 0.2, 1.6) : 46,
      depth: visual ? percentFromRange(visual.depth, 0.2, 1.8) : 50,
      backgroundMode: visual && (visual.backgroundColorMode === 'custom' || visual.backgroundColorCustom) ? 'custom' : 'auto',
      backgroundColor: visual ? normalizeDiyColor(visual.backgroundColor) || '#000000' : '#000000',
      lyricColorMode: visual && visual.lyricColorMode === 'custom' ? 'custom' : 'auto',
      lyricColor: visual ? normalizeDiyColor(visual.lyricColor) || '#a9b8c8' : '#a9b8c8',
      lyricFont: fontKey,
      lyricFontName: DIY_LYRIC_FONTS[fontKey]
    };
  }

  function getPlayerContext() {
    var currentSong = getCurrentPlayerSong();
    var queueItems = [];
    var queueLength = 0;
    var queueIndex = -1;
    try {
      queueLength = Array.isArray(playQueue) ? playQueue.length : 0;
      queueIndex = Number.isInteger(currentIdx) ? currentIdx : -1;
      if (queueLength) {
        var start = Math.max(0, queueIndex - 1);
        queueItems = playQueue.slice(start, start + 5).map(function (song, offset) {
          var summary = safeSongSummary(song);
          summary.position = start + offset;
          summary.current = start + offset === queueIndex;
          return summary;
        });
      }
    } catch (_error) {}
    var progressSeconds = 0;
    var durationSeconds = 0;
    var isPlaying = false;
    try {
      progressSeconds = audio && isFinite(audio.currentTime) ? Math.max(0, Number(audio.currentTime)) : 0;
      durationSeconds = typeof getPlaybackDurationSeconds === 'function'
        ? Math.max(0, Number(getPlaybackDurationSeconds()) || 0)
        : (audio && isFinite(audio.duration) ? Math.max(0, Number(audio.duration)) : 0);
      isPlaying = !!(audio && audio.src && !audio.paused && !audio.ended);
    } catch (_error) {}
    var volume = 100;
    try { volume = Math.round(Math.max(0, Math.min(1, Number(targetVolume))) * 100); } catch (_error) {}
    var mode = 'loop';
    try { mode = String(playMode || 'loop'); } catch (_error) {}
    var audioQuality = '';
    var audioQualityLabel = '';
    var audioQualityProvider = '';
    try {
      audioQualityProvider = typeof currentPlaybackQualityProvider === 'function' ? currentPlaybackQualityProvider() : '';
      audioQuality = typeof getProviderPlaybackQuality === 'function' ? getProviderPlaybackQuality(audioQualityProvider) : '';
      audioQualityLabel = typeof playbackQualityLabel === 'function' ? playbackQualityLabel(audioQuality, audioQualityProvider) : audioQuality;
    } catch (_error) {}
    var appState = {};
    try {
      appState = {
        playbackSpeed: typeof playbackTuning !== 'undefined' ? Number(playbackTuning.speed) || 1 : 1,
        playbackPitch: typeof playbackTuning !== 'undefined' ? Number(playbackTuning.pitch) || 0 : 0,
        fullscreen: typeof isMineradioFullscreenActive === 'function' ? !!isMineradioFullscreenActive() : !!document.fullscreenElement,
        immersive: typeof immersiveMode !== 'undefined' && !!immersiveMode,
        windowLyrics: typeof fx !== 'undefined' && !!fx.particleLyrics,
        diyMode: typeof diyPlayerMode !== 'undefined' && !!diyPlayerMode,
        controlsAutoHide: typeof controlsAutoHide !== 'undefined' && !!controlsAutoHide,
        navigationAutoHide: typeof primaryNavAutoHide !== 'undefined' && !!primaryNavAutoHide,
        interfaceMotion: typeof uiMotionEnabled === 'undefined' ? true : !!uiMotionEnabled
      };
    } catch (_error) {}
    return {
      currentSong: currentSong ? safeSongSummary(currentSong) : null,
      playing: isPlaying,
      progressSeconds: Math.round(progressSeconds),
      durationSeconds: Math.round(durationSeconds),
      volume: volume,
      playMode: mode,
      audioQuality: audioQuality,
      audioQualityLabel: audioQualityLabel,
      audioQualityProvider: audioQualityProvider,
      queueLength: queueLength,
      queueIndex: queueIndex,
      queue: queueItems,
      app: appState,
      diy: getDiyContext()
    };
  }

  function songStableId(song, index) {
    song = song || {};
    return [
      String(song.source || ''),
      String(song.songmid || song.id || song.hash || song.copyrightId || index || ''),
      normalizeText(song.name),
      normalizeText(song.singer || song.artist)
    ].join('|');
  }

  function scoreSong(song, options, index) {
    var query = normalizeText(options.query);
    var wantedTitle = normalizeText(options.title);
    var wantedArtist = normalizeText(options.artist);
    var title = normalizeText(song && (song.name || song.title));
    var artist = normalizeText(song && (song.singer || song.artist));
    var album = normalizeText(song && (song.albumName || song.album));
    var haystack = title + artist + album;
    var score = Math.max(0, 30 - index * 0.2);

    if (wantedTitle) {
      if (title === wantedTitle) score += 500;
      else if (title.indexOf(wantedTitle) === 0) score += 260;
      else if (title.indexOf(wantedTitle) >= 0 || wantedTitle.indexOf(title) >= 0) score += 150;
      else score -= 180;
    }
    if (wantedArtist) {
      if (artist === wantedArtist) score += 320;
      else if (artist.indexOf(wantedArtist) >= 0 || wantedArtist.indexOf(artist) >= 0) score += 210;
      else score -= 140;
    }
    if (!wantedTitle && query) {
      if (title === query) score += 420;
      else if (query.indexOf(title) >= 0 && title) score += 240;
      else if (title.indexOf(query) >= 0) score += 170;
    }
    if (query && haystack.indexOf(query) >= 0) score += 120;

    var queryTokens = String(options.query || '')
      .split(/[\s，,、/]+/)
      .map(normalizeText)
      .filter(Boolean);
    queryTokens.forEach(function (token) {
      if (title.indexOf(token) >= 0) score += 55;
      else if (artist.indexOf(token) >= 0) score += 45;
      else if (album.indexOf(token) >= 0) score += 15;
      else score -= 25;
    });

    var rawName = String(song && (song.name || song.title) || '');
    var queryRequestsVersion = /live|现场|remix|dj|翻唱|cover|伴奏|instrumental/i.test(String(options.query || ''));
    if (!queryRequestsVersion && /live|现场|remix|dj版|翻唱|cover|伴奏|instrumental/i.test(rawName)) score -= 90;
    return score;
  }

  function prepareSearchSong(song, index, query) {
    var prepared = Object.assign({}, song || {});
    prepared.type = 'lx-online';
    prepared.lxPlaylistIndex = -1;
    prepared.lxSongIndex = -1;
    prepared.lxPlaylistName = 'AI 搜索';
    prepared.agentResultId = songStableId(prepared, index);
    prepared.agentSearchQuery = query;
    return prepared;
  }

  async function searchMusic(input) {
    var options = asOptions(input);
    var title = String(options.title || '').trim();
    var artist = String(options.artist || '').trim();
    var query = String(options.query || [title, artist].filter(Boolean).join(' ')).trim();
    if (!query) return toolError('QUERY_REQUIRED', '请提供歌曲名、歌手或搜索关键词');

    var sources = normalizeSources(options.sources);
    var fetchLimit = Math.max(1, Math.min(30, Number(options.fetchLimit) || 20));
    var resultLimit = Math.max(1, Math.min(150, Number(options.limit) || 12));
    try {
      var result = await apiJson(
        '/api/lx-source/search?q=' + encodeURIComponent(query) +
        '&limit=' + fetchLimit +
        '&sources=' + encodeURIComponent(sources.join(',')) +
        '&t=' + Date.now(),
        { timeoutMs: Math.max(8000, Number(options.timeoutMs) || 24000) }
      );
      var rawSongs = result && Array.isArray(result.songs) ? result.songs : [];
      var songs = rawSongs.map(function (song, index) {
        return {
          song: prepareSearchSong(song, index, query),
          score: scoreSong(song, { query: query, title: title, artist: artist }, index),
          index: index
        };
      }).sort(function (a, b) {
        return b.score - a.score || a.index - b.index;
      }).slice(0, resultLimit).map(function (entry) {
        entry.song.agentMatchScore = Math.round(entry.score);
        return entry.song;
      });

      lastSearch = { query: query, songs: songs, at: Date.now() };
      return {
        ok: songs.length > 0,
        query: query,
        songs: songs,
        failures: result && Array.isArray(result.failures) ? result.failures : [],
        error: songs.length ? '' : 'NO_RESULTS',
        message: songs.length ? ('找到 ' + songs.length + ' 个候选结果') : '没有找到匹配歌曲',
        authMode: 'imported-lx-source',
        requiresLogin: false
      };
    } catch (error) {
      return toolError('SEARCH_FAILED', error && error.message ? error.message : '搜索失败');
    }
  }

  function findLastSearchSong(input) {
    var options = asOptions(input);
    if (options.song && typeof options.song === 'object') return options.song;
    if (options.agentResultId || options.resultId) {
      var wantedId = String(options.agentResultId || options.resultId);
      return lastSearch.songs.find(function (song) { return song.agentResultId === wantedId; }) || null;
    }
    if (options.index != null) {
      var index = Number(options.index);
      return Number.isInteger(index) && index >= 0 ? lastSearch.songs[index] || null : null;
    }
    if (input && typeof input === 'object' && (input.name || input.title) && (input.source || input.provider)) return input;
    return null;
  }

  async function importedSourceStatus() {
    try {
      var info = await apiJson('/api/lx-source/status?t=' + Date.now(), { timeoutMs: 10000 });
      var installed = info && Array.isArray(info.installed) ? info.installed : [];
      var enabled = installed.filter(function (item) { return item && item.enabled !== false; });
      if (!info || !info.ok || !enabled.length) {
        return toolError('LX_SOURCE_NOT_CONFIGURED', '请先导入并启用至少一个 LX 兼容音源');
      }
      return {
        ok: true,
        name: info.name || '',
        version: info.version || '',
        installedCount: installed.length,
        enabledCount: enabled.length,
        authMode: 'imported-lx-source',
        requiresLogin: false
      };
    } catch (error) {
      return toolError('LX_SOURCE_NOT_CONFIGURED', '请先导入并启用至少一个 LX 兼容音源', {
        cause: error && error.message ? error.message : String(error || '')
      });
    }
  }

  async function playMusic(input) {
    var options = asOptions(input);
    var song = findLastSearchSong(input);
    if (!song) return toolError('SONG_REQUIRED', '没有可播放的搜索结果，请先调用 search_music');
    if (typeof playLxMirrorSong !== 'function') {
      return toolError('PLAYER_NOT_READY', '播放器尚未完成初始化');
    }

    // Keep the existing Chromium media-unlock path. This is intentionally
    // called before the first await so a future button/voice gesture can be
    // consumed synchronously.
    if (typeof primeOnlineAudioForUserGesture === 'function') primeOnlineAudioForUserGesture();

    var sourceState = await importedSourceStatus();
    if (!sourceState.ok) return sourceState;
    try {
      var playableSong = Object.assign({}, song, {
        type: 'lx-online',
        lxPlaylistName: song.lxPlaylistName || 'AI 搜索'
      });
      if (options.remember !== false && typeof rememberExactSearchPlayedSong === 'function') {
        playableSong = rememberExactSearchPlayedSong(playableSong);
      }
      var played = await playLxMirrorSong(
        Number(playableSong.lxPlaylistIndex),
        Number(playableSong.lxSongIndex),
        playableSong
      );
      if (!played) return toolError('PLAYBACK_FAILED', '现有播放器未能开始播放这首歌曲');
      return {
        ok: true,
        message: '正在播放：' + String(playableSong.name || playableSong.title || '未知歌曲'),
        song: playableSong,
        source: sourceState,
        authMode: 'imported-lx-source',
        requiresLogin: false
      };
    } catch (error) {
      return toolError('PLAYBACK_FAILED', error && error.message ? error.message : '播放失败');
    }
  }

  async function searchAndPlayMusic(input) {
    var options = asOptions(input);
    if (typeof primeOnlineAudioForUserGesture === 'function') primeOnlineAudioForUserGesture();
    var searchResult = await searchMusic(options);
    if (!searchResult.ok || !searchResult.songs.length) return searchResult;
    var selectedIndex = Math.max(0, Math.min(searchResult.songs.length - 1, Number(options.resultIndex) || 0));
    var playResult = await playMusic({ song: searchResult.songs[selectedIndex], remember: options.remember });
    playResult.search = {
      query: searchResult.query,
      selectedIndex: selectedIndex,
      candidateCount: searchResult.songs.length,
      failures: searchResult.failures
    };
    return playResult;
  }

  async function replayCurrentMusic() {
    var song = getCurrentPlayerSong();
    if (!song) return toolError('NO_CURRENT_SONG', '当前没有正在播放或暂停的歌曲');
    if (typeof primeOnlineAudioForUserGesture === 'function') primeOnlineAudioForUserGesture();
    try {
      var restarted = false;
      if (typeof audio !== 'undefined' && audio && audio.src) {
        audio.currentTime = 0;
        if (typeof attemptAudioPlay === 'function') restarted = !!(await attemptAudioPlay({ manual: true }));
        else {
          await audio.play();
          restarted = true;
        }
      } else if (typeof playQueueAt === 'function' && typeof currentIdx !== 'undefined' && currentIdx >= 0) {
        restarted = (await playQueueAt(currentIdx, { manual: true, resumeAt: 0 })) !== false;
      }
      if (!restarted) return toolError('REPLAY_FAILED', '当前歌曲未能重新开始播放');
      var summary = safeSongSummary(song);
      if (typeof showToast === 'function') showToast('重新播放：' + (summary.title || '当前歌曲'));
      return {
        ok: true,
        message: '已从头播放：' + (summary.title || '当前歌曲'),
        song: summary,
        authMode: 'imported-lx-source',
        requiresLogin: false
      };
    } catch (error) {
      return toolError('REPLAY_FAILED', error && error.message ? error.message : '重新播放失败');
    }
  }

  function setPlayerVolume(input) {
    var options = asOptions(input);
    var value = options.volume != null ? Number(options.volume) : Number(options.value);
    if (!isFinite(value)) return toolError('VOLUME_REQUIRED', '请提供 0 到 100 的目标音量');
    var volume = Math.max(0, Math.min(100, Math.round(value)));
    if (typeof setVolume !== 'function') return toolError('PLAYER_NOT_READY', '播放器音量控制尚未初始化');
    try {
      setVolume(volume / 100, false);
      return {
        ok: true,
        message: volume === 0 ? '已静音' : ('音量已调到 ' + volume + '%'),
        volume: volume,
        authMode: 'local-player',
        requiresLogin: false
      };
    } catch (error) {
      return toolError('SET_VOLUME_FAILED', error && error.message ? error.message : '音量调整失败');
    }
  }

  async function controlPlayback(input) {
    var options = asOptions(input);
    var action = String(options.action || '').trim().toLowerCase();
    if (action !== 'play' && action !== 'pause') return toolError('PLAYBACK_ACTION_INVALID', '播放控制只支持 play 或 pause');
    var before = getPlayerContext();
    if (action === 'play' && !before.currentSong) return toolError('NO_CURRENT_SONG', '当前没有可以继续播放的歌曲');
    var needsChange = action === 'play' ? !before.playing : before.playing;
    try {
      if (needsChange) {
        if (typeof togglePlay !== 'function') return toolError('PLAYER_NOT_READY', '播放器控制尚未初始化');
        await togglePlay();
      }
      var after = getPlayerContext();
      var changedSuccessfully = action === 'play' ? after.playing : !after.playing;
      if (!changedSuccessfully) return toolError('PLAYBACK_CONTROL_FAILED', action === 'play' ? '未能继续播放' : '未能暂停播放');
      return {
        ok: true,
        action: action,
        changed: needsChange,
        playing: after.playing,
        currentSong: after.currentSong,
        message: action === 'play' ? (needsChange ? '已继续播放' : '当前已在播放') : (needsChange ? '已暂停' : '当前已经暂停'),
        authMode: 'local-player',
        requiresLogin: false
      };
    } catch (error) {
      return toolError('PLAYBACK_CONTROL_FAILED', error && error.message ? error.message : '播放控制失败');
    }
  }

  async function skipTrack(input) {
    var options = asOptions(input);
    var direction = String(options.direction || '').trim().toLowerCase();
    if (direction !== 'next' && direction !== 'previous') return toolError('TRACK_DIRECTION_INVALID', '切歌只支持 next 或 previous');
    var before = getPlayerContext();
    if (!before.currentSong) return toolError('NO_CURRENT_SONG', '当前没有可以切换的歌曲');
    var handler = direction === 'next'
      ? (typeof nextTrack === 'function' ? nextTrack : null)
      : (typeof prevTrack === 'function' ? prevTrack : null);
    if (!handler) return toolError('PLAYER_NOT_READY', '播放器切歌控制尚未初始化');
    try {
      var actionResult = handler();
      if (actionResult && typeof actionResult.then === 'function') await actionResult;
      await new Promise(function (resolve) { setTimeout(resolve, 0); });
      var after = getPlayerContext();
      return {
        ok: true,
        direction: direction,
        currentSong: after.currentSong,
        message: direction === 'next' ? '已切换到下一首' : '已切换到上一首',
        authMode: 'local-player',
        requiresLogin: false
      };
    } catch (error) {
      return toolError('SKIP_TRACK_FAILED', error && error.message ? error.message : '切换歌曲失败');
    }
  }

  function setPlayMode(input) {
    var options = asOptions(input);
    var mode = String(options.mode || '').trim().toLowerCase();
    if (mode !== 'loop' && mode !== 'shuffle' && mode !== 'single' && mode !== 'heart') return toolError('PLAY_MODE_INVALID', '播放模式只支持 loop、shuffle、single 或 heart');
    if (typeof nfSelectPlayMode !== 'function') return toolError('PLAYER_NOT_READY', '播放器模式控制尚未初始化');
    try {
      var before = '';
      try { before = String(playMode || 'loop'); } catch (_error) {}
      if (before !== mode) nfSelectPlayMode(null, mode);
      var after = '';
      try { after = String(playMode || 'loop'); } catch (_error) {}
      if (after !== mode) return toolError('SET_PLAY_MODE_FAILED', '播放模式未能完成切换');
      var label = { loop: '顺序循环', shuffle: '随机播放', single: '单曲循环', heart: '心动模式' }[mode];
      return {
        ok: true,
        mode: mode,
        changed: before !== mode,
        message: before === mode ? ('当前已经是' + label) : ('已切换为' + label),
        authMode: 'local-player',
        requiresLogin: false
      };
    } catch (error) {
      return toolError('SET_PLAY_MODE_FAILED', error && error.message ? error.message : '播放模式切换失败');
    }
  }

  function controlAudioQuality(input) {
    var options = asOptions(input);
    var action = String(options.action || '').trim().toLowerCase();
    var quality = String(options.quality || options.level || '').trim().toLowerCase();
    if (!quality && (action === 'open' || !action)) {
      try {
        var nowFlow = document.getElementById('now-flow');
        var nowFlowQuality = document.querySelector('#now-flow .nf-option-wrap[data-nf-menu="quality"]');
        var nowFlowOnly = !!(document.body && document.body.classList.contains('now-flow-only'));
        var nowFlowVisible = !!(nowFlow && nowFlowQuality && (nowFlowOnly || nowFlow.getClientRects().length));
        if (nowFlowVisible) {
          if (typeof nfCloseOptionMenus === 'function') nfCloseOptionMenus('quality');
          nowFlowQuality.classList.add('open');
          nowFlow.classList.add('nf-option-open');
          if (typeof nowFlowWakeControls === 'function') nowFlowWakeControls(5200);
          if (typeof updateNowFlowActions === 'function') updateNowFlowActions();
        } else {
          if (typeof diyPlayerMode !== 'undefined' && !diyPlayerMode && typeof applyDiyMode === 'function') {
            applyDiyMode(true, { save: true, toast: false, animate: true });
          }
          var control = document.getElementById('quality-control');
          if (!control) return toolError('QUALITY_CONTROL_NOT_FOUND', '没有找到音质控制面板');
          control.classList.add('open');
          if (typeof forcePlaybackControlsInteractive === 'function') forcePlaybackControlsInteractive();
          if (typeof revealBottomControls === 'function') revealBottomControls(5200);
        }
        return {
          ok: true,
          action: 'open',
          message: '已打开音质选择面板，请选择需要的音质',
          authMode: 'local-player',
          requiresLogin: false
        };
      } catch (error) {
        return toolError('QUALITY_PANEL_FAILED', error && error.message ? error.message : '音质面板打开失败');
      }
    }
    var aliases = {
      '128k': 'standard', 'standard': 'standard', 'normal': 'standard',
      '320k': 'exhigh', 'exhigh': 'exhigh', 'high': 'exhigh', 'hq': 'exhigh',
      'flac': 'lossless', 'lossless': 'lossless', 'sq': 'lossless',
      'hires': 'hires', 'hi-res': 'hires', 'highres': 'hires',
      'master': 'jymaster', 'jymaster': 'jymaster', 'svip': 'jymaster'
    };
    quality = aliases[quality] || '';
    if (!quality) return toolError('QUALITY_INVALID', '音质只支持标准、320k、无损、Hi-Res 或超清母带');
    if (typeof setPlaybackQuality !== 'function') {
      return toolError('QUALITY_CONTROL_NOT_READY', '音质控制尚未初始化');
    }
    try {
      var provider = typeof currentPlaybackQualityProvider === 'function' ? currentPlaybackQualityProvider() : 'netease';
      var wanted = typeof normalizePlaybackQualityForProvider === 'function' ? normalizePlaybackQualityForProvider(quality, provider) : quality;
      setPlaybackQuality(wanted);
      var current = typeof getProviderPlaybackQuality === 'function'
        ? getProviderPlaybackQuality(provider)
        : (typeof playbackQuality !== 'undefined' ? String(playbackQuality || wanted) : wanted);
      var label = typeof playbackQualityLabel === 'function' ? playbackQualityLabel(current, provider) : current;
      if (current !== wanted) return toolError('QUALITY_UNAVAILABLE', '当前歌曲或账号暂时不能切换到这个音质，已保留原音质：' + label);
      return {
        ok: true,
        action: 'set',
        provider: provider,
        quality: current,
        label: label,
        message: '音质已切换为：' + label,
        authMode: 'local-player',
        requiresLogin: false
      };
    } catch (error) {
      return toolError('QUALITY_CHANGE_FAILED', error && error.message ? error.message : '音质切换失败');
    }
  }

  async function openMusicSourceManager() {
    if (typeof showCurrentLxSource !== 'function') return toolError('SOURCE_MANAGER_NOT_READY', '音源管理尚未初始化');
    try {
      await showCurrentLxSource();
      return {
        ok: true,
        message: '已打开音源管理',
        authMode: 'imported-lx-source',
        requiresLogin: false
      };
    } catch (error) {
      return toolError('SOURCE_MANAGER_FAILED', error && error.message ? error.message : '音源管理打开失败');
    }
  }

  function openMusicLibrary() {
    if (typeof openPrimaryView !== 'function') return toolError('MUSIC_LIBRARY_NOT_READY', '音乐库尚未初始化');
    try {
      openPrimaryView('library');
      return {
        ok: true,
        action: 'open',
        message: '已打开音乐库',
        authMode: 'local-player',
        requiresLogin: false
      };
    } catch (error) {
      return toolError('MUSIC_LIBRARY_FAILED', error && error.message ? error.message : '音乐库打开失败');
    }
  }

  function openLyricAnimationSettings() {
    if (typeof applyDiyMode !== 'function' || typeof setFxPanelTab !== 'function') {
      return toolError('LYRIC_ANIMATION_NOT_READY', '歌词动画设置尚未初始化');
    }
    try {
      if (typeof diyPlayerMode !== 'undefined' && !diyPlayerMode) {
        applyDiyMode(true, { save: true, toast: false, animate: true });
      }
      if (typeof compactLyricPanelSections === 'function') compactLyricPanelSections();
      if (typeof toggleFxPanel === 'function') toggleFxPanel(true);
      setFxPanelTab('lyrics');
      var panel = document.getElementById('fx-panel');
      var fold = document.getElementById('fx-lyric-animation-fold');
      if (!panel || !fold) return toolError('LYRIC_ANIMATION_NOT_FOUND', '没有找到歌词动画设置区域');
      panel.classList.remove('closing', 'peek');
      panel.classList.add('show');
      var fab = document.getElementById('fx-fab');
      if (fab) fab.classList.add('active');
      fold.classList.add('open');
      var head = fold.querySelector('.fx-fold-head');
      if (head) head.setAttribute('aria-expanded', 'true');
      if (typeof clearFxPanelAutoCloseTimer === 'function') clearFxPanelAutoCloseTimer();
      requestAnimationFrame(function () {
        if (typeof scrollFxFeatureIntoPanel === 'function') scrollFxFeatureIntoPanel(panel, fold, 'smooth');
        else fold.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      return {
        ok: true,
        action: 'open',
        message: '已打开歌词动画设置',
        authMode: 'local-player',
        requiresLogin: false
      };
    } catch (error) {
      return toolError('LYRIC_ANIMATION_FAILED', error && error.message ? error.message : '歌词动画设置打开失败');
    }
  }

  function controlLyricAnimation(input) {
    var options = asOptions(input);
    var mode = String(options.mode || options.style || options.value || '').trim().toLowerCase();
    var legacyLabels = { off:'关闭', float:'漂浮', smooth:'柔滑', glass:'玻璃', shine:'线光', glitch:'故障' };
    var modernLabels = { classic:'流光', cadenza:'心象', partita:'云阶', fume:'浮名', cappella:'群唱', tilt:'倾诉', monet:'莫奈' };
    if (!legacyLabels[mode] && !modernLabels[mode]) return toolError('LYRIC_ANIMATION_MODE_INVALID', '不支持这个歌词动画模式');
    try {
      if (typeof diyPlayerMode !== 'undefined' && !diyPlayerMode && typeof applyDiyMode === 'function') {
        applyDiyMode(true, { save:true, toast:false, animate:true });
      }
      if (modernLabels[mode]) {
        if (typeof setLyricMotionStyle === 'function') setLyricMotionStyle('off');
        if (!window.LyricAnimation || typeof window.LyricAnimation.setMode !== 'function') return toolError('LYRIC_ANIMATION_NOT_READY', '新歌词动画尚未初始化');
        window.LyricAnimation.setMode(mode);
        return { ok:true, action:'set', mode:mode, family:'modern', message:'歌词动画已切换为：' + modernLabels[mode], requiresLogin:false };
      }
      if (window.LyricAnimation && typeof window.LyricAnimation.setMode === 'function') window.LyricAnimation.setMode('off');
      if (typeof setLyricMotionStyle !== 'function') return toolError('LYRIC_ANIMATION_NOT_READY', '歌词动画尚未初始化');
      setLyricMotionStyle(mode);
      return { ok:true, action:'set', mode:mode, family:'legacy', message:mode === 'off' ? '歌词动画已关闭' : ('歌词动画已切换为：' + legacyLabels[mode]), requiresLogin:false };
    } catch (error) {
      return toolError('LYRIC_ANIMATION_CHANGE_FAILED', error && error.message ? error.message : '歌词动画切换失败');
    }
  }

  function openVisualConsoleTab(tab) {
    if (typeof applyDiyMode !== 'function' || typeof setFxPanelTab !== 'function') {
      return toolError('VISUAL_CONSOLE_NOT_READY', '视觉控制台尚未初始化');
    }
    if (typeof diyPlayerMode !== 'undefined' && !diyPlayerMode) {
      applyDiyMode(true, { save: true, toast: false, animate: true });
    }
    if (typeof toggleFxPanel === 'function') toggleFxPanel(true);
    setFxPanelTab(tab || 'presets');
    var panel = document.getElementById('fx-panel');
    if (!panel) return toolError('VISUAL_CONSOLE_NOT_FOUND', '没有找到视觉控制台');
    panel.classList.remove('closing', 'peek');
    panel.classList.add('show');
    var fab = document.getElementById('fx-fab');
    if (fab) fab.classList.add('active');
    if (typeof clearFxPanelAutoCloseTimer === 'function') clearFxPanelAutoCloseTimer();
    panel.scrollTop = 0;
    return { ok: true };
  }

  async function openMineradioInterface(input) {
    var options = asOptions(input);
    var section = String(options.section || options.page || '').trim().toLowerCase();
    var labels = {
      home: '首页', library: '音乐库', radio: '音乐电台', ranking: '各平台排行榜',
      visual_console: '视觉控制台', advanced_settings: '高级设置', lyric_animation: '歌词动画设置',
      hotkeys: '热键设置', audio_output: '输出接口', wallpaper: '壁纸选择', update: '更新界面',
      remote_control: '遥控器', music_planet: '音乐星球', song_details: '歌曲详情',
      artist_details: '歌手详情', collect: '收藏界面', current_queue: '当前队列',
      playlist_panel: '歌单面板', global_search: '搜索界面', playback_tuning: '倍速与音调面板',
      volume_panel: '音量面板', playlist_import: '歌单导入', lx_playlist_import: '落雪歌单文件导入',
      playlist_selection: '主页歌单选择', source_import: '音源文件导入', local_file_import: '本地音乐文件导入',
      local_folder_import: '本地音乐文件夹导入', custom_lyrics: '自定义歌词', daily_review: '每日热评管理',
      listening_insight: '听歌偏好', visual_guide: '使用引导', author_support: '作者支持', beat_analysis: '本曲鼓点分析'
    };
    if (!labels[section]) return toolError('INTERFACE_INVALID', '不支持打开这个界面');
    try {
      var result = null;
      if (section === 'home' || section === 'library') {
        if (typeof openPrimaryView !== 'function') return toolError('INTERFACE_NOT_READY', labels[section] + '尚未初始化');
        openPrimaryView(section);
      } else if (section === 'radio') {
        if (typeof openRadioModes !== 'function') return toolError('INTERFACE_NOT_READY', '音乐电台尚未初始化');
        openRadioModes('all');
      } else if (section === 'ranking') {
        if (typeof openPlatformRanking !== 'function') return toolError('INTERFACE_NOT_READY', '排行榜尚未初始化');
        openPlatformRanking('all');
      } else if (section === 'lyric_animation') {
        result = openLyricAnimationSettings();
      } else if (section === 'visual_console' || section === 'advanced_settings') {
        result = openVisualConsoleTab(section === 'advanced_settings' ? 'advanced' : 'presets');
      } else if (section === 'current_queue' || section === 'playlist_panel') {
        if (typeof openPlaylistPanelTab !== 'function') return toolError('INTERFACE_NOT_READY', labels[section] + '尚未初始化');
        openPlaylistPanelTab(section === 'current_queue' ? 'queue' : 'playlists', true);
      } else if (section === 'playback_tuning') {
        var tuningRoot = document.getElementById('now-flow');
        var tuningWrap = document.querySelector('#now-flow .nf-option-wrap[data-nf-menu="tuning"]');
        if (tuningRoot && tuningWrap && (document.body.classList.contains('now-flow-only') || tuningRoot.getClientRects().length)) {
          if (typeof nfCloseOptionMenus === 'function') nfCloseOptionMenus('tuning');
          tuningWrap.classList.add('open');
          tuningRoot.classList.add('nf-option-open');
          if (typeof nowFlowWakeControls === 'function') nowFlowWakeControls(5200);
        } else {
          var tuningControl = document.getElementById('playback-tuning-control');
          if (!tuningControl) return toolError('INTERFACE_NOT_READY', '倍速与音调面板尚未初始化');
          tuningControl.classList.add('open');
          if (typeof revealBottomControls === 'function') revealBottomControls(5200);
        }
      } else if (section === 'volume_panel') {
        var volumeRoot = document.getElementById('now-flow');
        if (volumeRoot && (document.body.classList.contains('now-flow-only') || volumeRoot.getClientRects().length)) {
          volumeRoot.classList.add('nf-volume-open', 'nf-controls-awake');
          if (typeof nowFlowWakeControls === 'function') nowFlowWakeControls(5200);
        } else {
          var volumeControl = document.getElementById('volume-control');
          if (!volumeControl) return toolError('INTERFACE_NOT_READY', '音量面板尚未初始化');
          volumeControl.classList.add('open');
          if (typeof revealBottomControls === 'function') revealBottomControls(5200);
        }
      } else {
        var openers = {
          hotkeys: typeof openHotkeySettings === 'function' ? openHotkeySettings : null,
          audio_output: typeof openAudioOutputSettings === 'function' ? openAudioOutputSettings : null,
          wallpaper: typeof openWallpaperPicker === 'function' ? openWallpaperPicker : null,
          update: typeof openUpdatePanel === 'function' ? openUpdatePanel : null,
          remote_control: typeof openRemoteControl === 'function' ? openRemoteControl : null,
          music_planet: typeof openMusicPlanet === 'function' ? openMusicPlanet : null,
          song_details: typeof openTrackDetailModal === 'function' ? function () { return openTrackDetailModal('song'); } : null,
          artist_details: typeof openTrackDetailModal === 'function' ? function () { return openTrackDetailModal('artist'); } : null,
          collect: typeof openCollectModalForCurrent === 'function' ? openCollectModalForCurrent : null,
          global_search: typeof focusGlobalSearch === 'function' ? focusGlobalSearch : null,
          playlist_import: typeof openPlatformPlaylistImport === 'function' ? openPlatformPlaylistImport : null,
          lx_playlist_import: typeof openLxPlaylistImport === 'function' ? openLxPlaylistImport : null,
          playlist_selection: typeof openPlaylistSelection === 'function' ? openPlaylistSelection : null,
          source_import: typeof openLxSourceImport === 'function' ? openLxSourceImport : null,
          local_file_import: typeof openLocalFileImport === 'function' ? openLocalFileImport : null,
          local_folder_import: typeof openLocalFolderImport === 'function' ? openLocalFolderImport : null,
          custom_lyrics: typeof openCustomLyricModal === 'function' ? openCustomLyricModal : null,
          daily_review: typeof openDailyReviewManager === 'function' ? openDailyReviewManager : null,
          listening_insight: typeof openHomeInsight === 'function' ? openHomeInsight : null,
          visual_guide: typeof startVisualGuide === 'function' ? function () { return startVisualGuide({ manual: true }); } : null,
          author_support: typeof openAuthorSupportPanel === 'function' ? openAuthorSupportPanel : null,
          beat_analysis: typeof openLocalBeatModal === 'function' && typeof currentCoverSong === 'function' && typeof audio !== 'undefined'
            ? function () { return openLocalBeatModal(currentCoverSong(), audio && audio.src || ''); } : null
        };
        if (!openers[section]) return toolError('INTERFACE_NOT_READY', labels[section] + '尚未初始化');
        await Promise.resolve(openers[section]());
      }
      if (result && !result.ok) return result;
      return {
        ok: true,
        action: 'open',
        section: section,
        message: '已打开' + labels[section],
        authMode: 'local-player',
        requiresLogin: false
      };
    } catch (error) {
      return toolError('INTERFACE_OPEN_FAILED', error && error.message ? error.message : (labels[section] + '打开失败'));
    }
  }

  async function controlMineradioApp(input) {
    var options = asOptions(input);
    var operation = String(options.operation || options.action || 'set').trim().toLowerCase();
    var target = String(options.target || options.control || '').trim().toLowerCase();
    if (operation === 'open') return openMineradioInterface({ section: target });
    var labels = {
      playback_speed: '播放倍速', playback_pitch: '播放音调', playback_tuning: '倍速与音调',
      playback_mode: '播放模式', fullscreen: '全屏', immersive: '全沉浸式', window_lyrics: '窗口内歌词',
      diy_mode: 'DIY 玩家模式', controls_auto_hide: '控制条自动隐藏', navigation_auto_hide: '顶部导航自动隐藏',
      interface_motion: '软件界面动画', visual_console_auto_hide: '视觉控制台自动隐藏', wallpaper_mirror: '壁纸镜像',
      queue_shuffle: '随机打乱队列', queue_clear: '清空播放队列', backing_track: '当前歌曲伴奏',
      app_memory_trim: '压缩播放器内存', system_memory_trim: '释放系统内存', visual_settings_reset: '重置视觉设置',
      window_minimize: '最小化窗口', window_close: '关闭 Mineradio'
    };
    if (!labels[target]) return toolError('APP_CONTROL_INVALID', '不支持这个软件控制目标');
    function desiredEnabled(current) {
      if (typeof options.enabled === 'boolean') return options.enabled;
      var value = String(options.value == null ? '' : options.value).trim().toLowerCase();
      if (/^(?:true|1|on|open|enable|开启|打开|启用)$/.test(value)) return true;
      if (/^(?:false|0|off|close|disable|关闭|停用|禁用)$/.test(value)) return false;
      return !current;
    }
    try {
      var current;
      var desired;
      if (target === 'playback_speed') {
        if (typeof setPlaybackSpeed !== 'function') return toolError('APP_CONTROL_NOT_READY', '播放倍速控制尚未初始化');
        var speed = Number(options.value);
        if (!isFinite(speed)) return toolError('APP_CONTROL_VALUE_REQUIRED', '请提供 0.5 到 2.0 的播放倍速');
        setPlaybackSpeed(speed);
        current = typeof playbackTuning !== 'undefined' ? Number(playbackTuning.speed) : Math.max(0.5, Math.min(2, speed));
        return { ok:true, target:target, value:current, message:'播放倍速已调整为 ' + current.toFixed(2) + '×', requiresLogin:false };
      }
      if (target === 'playback_pitch') {
        if (typeof setPlaybackPitch !== 'function') return toolError('APP_CONTROL_NOT_READY', '播放音调控制尚未初始化');
        var pitch = Number(options.value);
        if (!isFinite(pitch)) return toolError('APP_CONTROL_VALUE_REQUIRED', '请提供 -12 到 +12 的半音值');
        setPlaybackPitch(pitch);
        current = typeof playbackTuning !== 'undefined' ? Number(playbackTuning.pitch) : Math.max(-12, Math.min(12, Math.round(pitch)));
        return { ok:true, target:target, value:current, message:'播放音调已调整为 ' + (current > 0 ? '+' : '') + current + ' 半音', requiresLogin:false };
      }
      if (target === 'playback_tuning') {
        if (operation !== 'reset' || typeof resetPlaybackTuning !== 'function') return toolError('APP_CONTROL_UNSUPPORTED', '倍速与音调仅支持 reset 操作');
        resetPlaybackTuning();
        return { ok:true, target:target, message:'倍速与音调已重置', requiresLogin:false };
      }
      if (target === 'playback_mode') return setPlayMode({ mode: String(options.value || options.mode || '').toLowerCase() });
      if (target === 'fullscreen') {
        if (typeof toggleFullscreen !== 'function') return toolError('APP_CONTROL_NOT_READY', '全屏控制尚未初始化');
        current = typeof isMineradioFullscreenActive === 'function' ? !!isMineradioFullscreenActive() : !!document.fullscreenElement;
        desired = desiredEnabled(current);
        if (current !== desired) await Promise.resolve(toggleFullscreen());
      } else if (target === 'immersive') {
        if (typeof setImmersiveMode !== 'function') return toolError('APP_CONTROL_NOT_READY', '沉浸模式尚未初始化');
        current = typeof immersiveMode !== 'undefined' && !!immersiveMode;
        desired = desiredEnabled(current);
        if (current !== desired) setImmersiveMode(desired);
      } else if (target === 'window_lyrics') {
        if (typeof toggleLyricsPanel !== 'function') return toolError('APP_CONTROL_NOT_READY', '歌词控制尚未初始化');
        current = typeof fx !== 'undefined' && !!fx.particleLyrics;
        desired = desiredEnabled(current);
        if (current !== desired) toggleLyricsPanel(desired);
      } else if (target === 'diy_mode') {
        if (typeof applyDiyMode !== 'function') return toolError('APP_CONTROL_NOT_READY', 'DIY 玩家模式尚未初始化');
        current = typeof diyPlayerMode !== 'undefined' && !!diyPlayerMode;
        desired = desiredEnabled(current);
        if (current !== desired) applyDiyMode(desired, { save:true, toast:true, animate:true });
      } else if (target === 'controls_auto_hide') {
        if (typeof toggleControlsAutoHide !== 'function') return toolError('APP_CONTROL_NOT_READY', '控制条自动隐藏尚未初始化');
        current = typeof controlsAutoHide !== 'undefined' && !!controlsAutoHide;
        desired = desiredEnabled(current);
        if (current !== desired) toggleControlsAutoHide();
      } else if (target === 'navigation_auto_hide') {
        if (typeof togglePrimaryNavAutoHide !== 'function') return toolError('APP_CONTROL_NOT_READY', '顶部导航自动隐藏尚未初始化');
        current = typeof primaryNavAutoHide !== 'undefined' && !!primaryNavAutoHide;
        desired = desiredEnabled(current);
        if (current !== desired) togglePrimaryNavAutoHide();
      } else if (target === 'interface_motion') {
        if (typeof toggleUiMotion !== 'function') return toolError('APP_CONTROL_NOT_READY', '界面动画控制尚未初始化');
        current = typeof uiMotionEnabled === 'undefined' ? true : !!uiMotionEnabled;
        desired = desiredEnabled(current);
        if (current !== desired) toggleUiMotion();
      } else if (target === 'visual_console_auto_hide') {
        if (typeof toggleFxFabAutoHide !== 'function') return toolError('APP_CONTROL_NOT_READY', '视觉控制台自动隐藏尚未初始化');
        current = typeof fxFabAutoHide !== 'undefined' && !!fxFabAutoHide;
        desired = desiredEnabled(current);
        if (current !== desired) toggleFxFabAutoHide();
      } else if (target === 'wallpaper_mirror') {
        if (typeof toggleWallpaperMirror !== 'function') return toolError('APP_CONTROL_NOT_READY', '壁纸镜像控制尚未初始化');
        current = typeof fx !== 'undefined' && !!fx.wallpaperMirror;
        desired = desiredEnabled(current);
        if (current !== desired) toggleWallpaperMirror();
      } else if (target === 'queue_shuffle') {
        if (typeof shuffleQueue !== 'function') return toolError('APP_CONTROL_NOT_READY', '队列随机功能尚未初始化');
        shuffleQueue();
        return { ok:true, target:target, message:'播放队列已随机打乱', requiresLogin:false };
      } else if (target === 'queue_clear') {
        if (options.confirmed !== true) return toolError('APP_CONTROL_CONFIRM_REQUIRED', '清空播放队列需要明确确认');
        if (typeof clearQueue !== 'function') return toolError('APP_CONTROL_NOT_READY', '清空队列功能尚未初始化');
        clearQueue();
        return { ok:true, target:target, message:'播放队列已清空', requiresLogin:false };
      } else if (target === 'backing_track') {
        if (typeof playCurrentBackingTrack !== 'function') return toolError('APP_CONTROL_NOT_READY', '伴奏搜索尚未初始化');
        await playCurrentBackingTrack();
        return { ok:true, target:target, message:'已开始查找并播放当前歌曲伴奏', requiresLogin:false };
      } else if (target === 'app_memory_trim') {
        if (typeof runAppMemoryTrim !== 'function') return toolError('APP_CONTROL_NOT_READY', '播放器内存压缩尚未初始化');
        await Promise.resolve(runAppMemoryTrim('manual'));
        return { ok:true, target:target, message:'已执行播放器内存压缩', requiresLogin:false };
      } else if (target === 'system_memory_trim') {
        if (typeof runSystemMemoryPurge !== 'function') return toolError('APP_CONTROL_NOT_READY', '系统内存释放尚未初始化');
        await Promise.resolve(runSystemMemoryPurge(false));
        return { ok:true, target:target, message:'已执行系统内存释放', requiresLogin:false };
      } else if (target === 'visual_settings_reset') {
        if (options.confirmed !== true) return toolError('APP_CONTROL_CONFIRM_REQUIRED', '重置视觉设置需要明确确认');
        if (typeof resetFx !== 'function') return toolError('APP_CONTROL_NOT_READY', '视觉设置重置尚未初始化');
        resetFx();
        return { ok:true, target:target, message:'视觉设置已重置', requiresLogin:false };
      } else if (target === 'window_minimize') {
        if (!window.desktopWindow || typeof window.desktopWindow.minimize !== 'function') return toolError('APP_CONTROL_NOT_READY', '窗口最小化功能尚未初始化');
        await Promise.resolve(window.desktopWindow.minimize());
        return { ok:true, target:target, message:'Mineradio 已最小化', requiresLogin:false };
      } else if (target === 'window_close') {
        if (options.confirmed !== true) return toolError('APP_CONTROL_CONFIRM_REQUIRED', '关闭 Mineradio 需要明确确认');
        if (!window.desktopWindow || typeof window.desktopWindow.close !== 'function') return toolError('APP_CONTROL_NOT_READY', '窗口关闭功能尚未初始化');
        await Promise.resolve(window.desktopWindow.close());
        return { ok:true, target:target, message:'正在关闭 Mineradio', requiresLogin:false };
      }
      return { ok:true, target:target, enabled:desired, message:labels[target] + (desired ? '已开启' : '已关闭'), requiresLogin:false };
    } catch (error) {
      return toolError('APP_CONTROL_FAILED', error && error.message ? error.message : (labels[target] + '操作失败'));
    }
  }

  async function searchAndQueueMusic(input) {
    var options = asOptions(input);
    var position = String(options.position || 'next').trim().toLowerCase() === 'end' ? 'end' : 'next';
    var searchResult = await searchMusic(options);
    if (!searchResult.ok || !searchResult.songs.length) return searchResult;
    if (typeof queueSong !== 'function') return toolError('PLAYER_NOT_READY', '播放队列尚未初始化');
    var selectedIndex = Math.max(0, Math.min(searchResult.songs.length - 1, Number(options.resultIndex) || 0));
    var song = searchResult.songs[selectedIndex];
    try {
      var queueIndex = queueSong(song, position === 'next' ? { position: 'next' } : {});
      if (queueIndex < 0) return toolError('QUEUE_FAILED', '歌曲未能加入播放队列');
      var summary = safeSongSummary(song);
      return {
        ok: true,
        position: position,
        queueIndex: queueIndex,
        song: summary,
        message: position === 'next' ? ('已设为下一首：《' + (summary.title || '歌曲') + '》') : ('已加入播放队列：《' + (summary.title || '歌曲') + '》'),
        authMode: 'imported-lx-source',
        requiresLogin: false
      };
    } catch (error) {
      return toolError('QUEUE_FAILED', error && error.message ? error.message : '加入播放队列失败');
    }
  }

  function activePlaylistNameHint() {
    try {
      if (playlistPanelDetailState && playlistPanelDetailState.playlist && playlistPanelDetailState.playlist.name) {
        return String(playlistPanelDetailState.playlist.name);
      }
    } catch (_error) {}
    try {
      if (lxMirrorActivePlaylist >= 0 && lxMirrorPlaylists[lxMirrorActivePlaylist]) {
        return String(lxMirrorPlaylists[lxMirrorActivePlaylist].name || '');
      }
    } catch (_error) {}
    try {
      if (activePlaybackContext && activePlaybackContext.playlistName) return String(activePlaybackContext.playlistName);
    } catch (_error) {}
    return '';
  }

  function playlistQueueCandidates() {
    try {
      if (typeof ensureLocalUserPlaylistsLoaded === 'function') ensureLocalUserPlaylistsLoaded();
      if (typeof secondaryLibraryCollections === 'function') {
        return secondaryLibraryCollections().filter(function (entry) {
          return entry && entry.name && Array.isArray(entry.songs);
        });
      }
    } catch (_error) {}
    var entries = [];
    try {
      (userPlaylists || []).forEach(function (playlist, index) {
        if (playlist && playlist.localUserPlaylist) entries.push({ kind: 'custom', name: playlist.name, songs: playlist.songs || [], source: playlist, playlistIndex: index });
      });
    } catch (_error) {}
    try {
      (localFolderPlaylists || []).forEach(function (playlist, index) {
        entries.push({ kind: 'folder', name: playlist.name, songs: playlist.songs || [], source: playlist, folderIndex: index });
      });
    } catch (_error) {}
    try {
      (lxMirrorPlaylists || []).forEach(function (playlist, index) {
        entries.push({ kind: 'lx', name: playlist.name, songs: playlist.songs || [], source: playlist, playlistIndex: index });
      });
    } catch (_error) {}
    return entries;
  }

  function findPlaylistQueueCandidate(name, entries) {
    var wanted = normalizeText(name);
    if (!wanted) return null;
    var exact = entries.find(function (entry) { return normalizeText(entry.name) === wanted; });
    if (exact) return exact;
    return entries.find(function (entry) {
      var candidate = normalizeText(entry.name);
      return candidate && (candidate.indexOf(wanted) >= 0 || wanted.indexOf(candidate) >= 0);
    }) || null;
  }

  function preparePlaylistQueueSong(song, candidate, songIndex) {
    if (candidate && candidate.kind === 'lx' && typeof lxQueueSong === 'function') {
      return lxQueueSong(song, Number(candidate.playlistIndex) || 0, songIndex);
    }
    if (typeof playlistPanelQueueSong === 'function') return playlistPanelQueueSong(song);
    if (typeof cloneSong === 'function') return cloneSong(song);
    return Object.assign({}, song);
  }

  function stableQueueKey(song, index) {
    var key = '';
    try { if (typeof queueItemKey === 'function') key = queueItemKey(song); } catch (_error) {}
    if (!key) {
      try { if (typeof songStableId === 'function') key = songStableId(song, index); } catch (_error) {}
    }
    if (!key) key = normalizeText((song && (song.name || song.title) || '') + '|' + (song && (song.artist || song.singer) || ''));
    return String(key || '');
  }

  async function addPlaylistToQueue(input) {
    var options = asOptions(input);
    var requestedName = normalizePlaylistName(options.playlist_name || options.playlistName || options.name);
    var position = String(options.position || 'end').trim().toLowerCase() === 'next' ? 'next' : 'end';
    try {
      if ((!Array.isArray(lxMirrorPlaylists) || !lxMirrorPlaylists.length) && typeof loadLxMirrorPlaylists === 'function') {
        await loadLxMirrorPlaylists(true);
      }
    } catch (_error) {}
    var entries = playlistQueueCandidates();
    var resolvedName = requestedName || normalizePlaylistName(activePlaylistNameHint());
    if (!resolvedName) {
      return toolError('PLAYLIST_NAME_REQUIRED', '请告诉我要加入队列的歌单名称，或先在播放器中打开一个歌单');
    }
    var candidate = findPlaylistQueueCandidate(resolvedName, entries);
    if (!candidate) {
      return toolError('PLAYLIST_NOT_FOUND', '没有找到歌单“' + resolvedName + '”', {
        availablePlaylists: entries.slice(0, 12).map(function (entry) { return entry.name; })
      });
    }
    var sourceSongs = Array.isArray(candidate.songs) ? candidate.songs : [];
    if (!sourceSongs.length) return toolError('PLAYLIST_EMPTY', '歌单“' + candidate.name + '”中还没有歌曲');
    if (!Array.isArray(playQueue)) return toolError('PLAYER_NOT_READY', '播放队列尚未初始化');

    var knownKeys = Object.create(null);
    playQueue.forEach(function (song, index) {
      var key = stableQueueKey(song, index);
      if (key) knownKeys[key] = true;
    });
    var additions = [];
    sourceSongs.forEach(function (song, index) {
      if (!song) return;
      var queued = preparePlaylistQueueSong(song, candidate, index);
      var key = stableQueueKey(queued, index);
      if (!key || knownKeys[key]) return;
      knownKeys[key] = true;
      additions.push(queued);
    });
    if (!additions.length) {
      return {
        ok: true,
        playlistName: candidate.name,
        addedCount: 0,
        duplicateCount: sourceSongs.length,
        queueLength: playQueue.length,
        message: '歌单“' + candidate.name + '”的歌曲已经都在当前队列中',
        authMode: 'local-player',
        requiresLogin: false
      };
    }

    try {
      if (typeof clearLocalLibraryPassiveQueue === 'function') clearLocalLibraryPassiveQueue();
      var insertAt = position === 'next'
        ? Math.max(0, Math.min(playQueue.length, (Number.isInteger(currentIdx) ? currentIdx : -1) + 1))
        : playQueue.length;
      playQueue.splice.apply(playQueue, [insertAt, 0].concat(additions));
      if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('agent-add-playlist-to-queue', { scrollCurrent: false, deferWhenHidden: false });
      if (typeof safeSwitchPlaylistTab === 'function') safeSwitchPlaylistTab('queue', 'agent-add-playlist-to-queue');
      if (typeof safeShelfRebuild === 'function') safeShelfRebuild('agent-add-playlist-to-queue', true);
      if (typeof savePlaybackSession === 'function') savePlaybackSession(true);
      if (typeof forcePlaybackControlsInteractive === 'function') forcePlaybackControlsInteractive();
      if (typeof showToast === 'function') showToast('已加入队列：' + candidate.name + ' · ' + additions.length + ' 首');
      return {
        ok: true,
        playlistName: candidate.name,
        position: position,
        addedCount: additions.length,
        duplicateCount: Math.max(0, sourceSongs.length - additions.length),
        queueLength: playQueue.length,
        message: '已把歌单“' + candidate.name + '”的 ' + additions.length + ' 首歌曲加入当前播放队列',
        authMode: 'local-player',
        requiresLogin: false
      };
    } catch (error) {
      return toolError('PLAYLIST_QUEUE_FAILED', error && error.message ? error.message : '整张歌单加入队列失败');
    }
  }

  function seekPlayback(input) {
    var options = asOptions(input);
    var context = getPlayerContext();
    var duration = Number(context.durationSeconds) || 0;
    if (!context.currentSong || duration <= 0) return toolError('SEEK_UNAVAILABLE', '当前歌曲还不能调整播放进度');
    var targetSeconds = NaN;
    if (options.position_seconds != null || options.positionSeconds != null) {
      targetSeconds = Number(options.position_seconds != null ? options.position_seconds : options.positionSeconds);
    } else if (options.percent != null) {
      targetSeconds = duration * Number(options.percent) / 100;
    }
    if (!isFinite(targetSeconds)) return toolError('SEEK_POSITION_REQUIRED', '请提供目标秒数或进度百分比');
    targetSeconds = Math.max(0, Math.min(duration, targetSeconds));
    if (typeof seekNowFlowToRatio !== 'function') return toolError('PLAYER_NOT_READY', '播放器进度控制尚未初始化');
    try {
      if (seekNowFlowToRatio(targetSeconds / duration, true) === false) return toolError('SEEK_FAILED', '播放进度未能完成调整');
      return {
        ok: true,
        positionSeconds: Math.round(targetSeconds),
        percent: Math.round(targetSeconds / duration * 100),
        durationSeconds: Math.round(duration),
        message: '已跳转到 ' + Math.floor(targetSeconds / 60) + ':' + String(Math.round(targetSeconds % 60)).padStart(2, '0'),
        authMode: 'local-player',
        requiresLogin: false
      };
    } catch (error) {
      return toolError('SEEK_FAILED', error && error.message ? error.message : '播放进度调整失败');
    }
  }

  function normalizePlaylistName(value) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
  }

  function findLocalPlaylistByName(name) {
    var wanted = normalizePlaylistName(name).toLowerCase();
    try {
      return (userPlaylists || []).find(function (playlist) {
        return playlist && playlist.localUserPlaylist && normalizePlaylistName(playlist.name).toLowerCase() === wanted;
      }) || null;
    } catch (_error) { return null; }
  }

  function newLocalPlaylist(name) {
    return {
      id: 'local-pl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      name: name,
      songs: [],
      trackCount: 0,
      cover: '',
      creator: '本地歌单',
      localUserPlaylist: true,
      updatedAt: Date.now()
    };
  }

  function refreshLocalPlaylistViews() {
    try {
      if (typeof refreshSharedPlaylistOrderViews === 'function') refreshSharedPlaylistOrderViews();
    } catch (_error) {}
  }

  function addSongToLocalPlaylist(song, playlistName, createIfMissing) {
    var name = normalizePlaylistName(playlistName || '我喜欢');
    if (!name) return toolError('PLAYLIST_NAME_REQUIRED', '请提供歌单名称');
    if (!song) return toolError('NO_CURRENT_SONG', '当前没有可以收藏的歌曲');
    if (typeof ensureLocalUserPlaylistsLoaded !== 'function' || typeof saveLocalUserPlaylists !== 'function') {
      return toolError('PLAYLISTS_NOT_READY', '本地歌单尚未初始化');
    }
    ensureLocalUserPlaylistsLoaded();
    var playlist = findLocalPlaylistByName(name);
    var created = false;
    if (!playlist) {
      if (createIfMissing === false) return toolError('PLAYLIST_NOT_FOUND', '没有找到歌单：' + name);
      playlist = newLocalPlaylist(name);
      userPlaylists.unshift(playlist);
      created = true;
    }
    playlist.songs = Array.isArray(playlist.songs) ? playlist.songs : [];
    var songKey = typeof localPlaylistSongKey === 'function'
      ? localPlaylistSongKey(song)
      : [song.name || song.title || '', song.singer || song.artist || ''].join('|');
    var duplicate = playlist.songs.some(function (item) {
      var itemKey = typeof localPlaylistSongKey === 'function'
        ? localPlaylistSongKey(item)
        : [item.name || item.title || '', item.singer || item.artist || ''].join('|');
      return itemKey && itemKey === songKey;
    });
    if (duplicate) {
      return {
        ok: true,
        created: created,
        duplicate: true,
        playlist: { id: playlist.id, name: playlist.name, trackCount: playlist.songs.length },
        song: safeSongSummary(song),
        message: '《' + (safeSongSummary(song).title || '歌曲') + '》已经在歌单“' + name + '”中',
        authMode: 'local-player',
        requiresLogin: false
      };
    }
    var limit = 1000;
    try { if (typeof PLAYLIST_MAX_SONGS !== 'undefined') limit = Number(PLAYLIST_MAX_SONGS) || limit; } catch (_error) {}
    if (playlist.songs.length >= limit) {
      if (created) userPlaylists = userPlaylists.filter(function (item) { return item !== playlist; });
      return toolError('PLAYLIST_LIMIT_REACHED', '单个歌单最多 ' + limit + ' 首歌曲');
    }
    var previousSongs = playlist.songs.slice();
    var previousCover = playlist.cover || '';
    var storedSong = typeof cloneSong === 'function' ? cloneSong(song) : Object.assign({}, song);
    playlist.songs.unshift(storedSong);
    playlist.trackCount = playlist.songs.length;
    try {
      playlist.cover = playlist.cover || (typeof songCoverSrc === 'function' ? songCoverSrc(storedSong, 88) : '') || storedSong.picUrl || storedSong.cover || '';
    } catch (_error) {}
    playlist.updatedAt = Date.now();
    if (!saveLocalUserPlaylists()) {
      if (created) userPlaylists = userPlaylists.filter(function (item) { return item !== playlist; });
      else {
        playlist.songs = previousSongs;
        playlist.trackCount = previousSongs.length;
        playlist.cover = previousCover;
      }
      return toolError('PLAYLIST_SAVE_FAILED', '本地歌单保存失败');
    }
    refreshLocalPlaylistViews();
    var summary = safeSongSummary(storedSong);
    return {
      ok: true,
      created: created,
      duplicate: false,
      playlist: { id: playlist.id, name: playlist.name, trackCount: playlist.songs.length },
      song: summary,
      message: '已把《' + (summary.title || '歌曲') + '》收藏到“' + name + '”',
      authMode: 'local-player',
      requiresLogin: false
    };
  }

  async function saveMusicToPlaylist(input) {
    var options = asOptions(input);
    var song = null;
    var hasSearch = String(options.query || options.title || options.artist || '').trim();
    if (hasSearch) {
      var searchResult = await searchMusic(options);
      if (!searchResult.ok || !searchResult.songs.length) return searchResult;
      var selectedIndex = Math.max(0, Math.min(searchResult.songs.length - 1, Number(options.resultIndex) || 0));
      song = searchResult.songs[selectedIndex];
    } else {
      song = getCurrentPlayerSong();
    }
    return addSongToLocalPlaylist(song, options.playlist_name || options.playlistName || '我喜欢', options.create_if_missing !== false);
  }

  function createLocalPlaylist(input) {
    var options = asOptions(input);
    var name = normalizePlaylistName(options.name || options.playlist_name || options.playlistName);
    if (!name) return toolError('PLAYLIST_NAME_REQUIRED', '请提供歌单名称');
    if (typeof ensureLocalUserPlaylistsLoaded !== 'function' || typeof saveLocalUserPlaylists !== 'function') {
      return toolError('PLAYLISTS_NOT_READY', '本地歌单尚未初始化');
    }
    ensureLocalUserPlaylistsLoaded();
    var existing = findLocalPlaylistByName(name);
    if (existing) {
      if (options.add_current_song === true || options.addCurrentSong === true) return addSongToLocalPlaylist(getCurrentPlayerSong(), name, true);
      return {
        ok: true,
        created: false,
        playlist: { id: existing.id, name: existing.name, trackCount: Array.isArray(existing.songs) ? existing.songs.length : 0 },
        message: '歌单“' + name + '”已经存在',
        authMode: 'local-player',
        requiresLogin: false
      };
    }
    var playlist = newLocalPlaylist(name);
    var currentSong = options.add_current_song === true || options.addCurrentSong === true ? getCurrentPlayerSong() : null;
    if ((options.add_current_song === true || options.addCurrentSong === true) && !currentSong) return toolError('NO_CURRENT_SONG', '当前没有可以加入歌单的歌曲');
    if (currentSong) {
      var storedSong = typeof cloneSong === 'function' ? cloneSong(currentSong) : Object.assign({}, currentSong);
      playlist.songs.push(storedSong);
      playlist.trackCount = 1;
      try { playlist.cover = typeof songCoverSrc === 'function' ? songCoverSrc(storedSong, 88) : (storedSong.picUrl || storedSong.cover || ''); } catch (_error) {}
    }
    userPlaylists.unshift(playlist);
    if (!saveLocalUserPlaylists()) {
      userPlaylists = userPlaylists.filter(function (item) { return item !== playlist; });
      return toolError('PLAYLIST_SAVE_FAILED', '本地歌单保存失败');
    }
    refreshLocalPlaylistViews();
    return {
      ok: true,
      created: true,
      playlist: { id: playlist.id, name: playlist.name, trackCount: playlist.songs.length },
      message: currentSong ? ('已创建歌单“' + name + '”并加入当前歌曲') : ('已创建歌单“' + name + '”'),
      authMode: 'local-player',
      requiresLogin: false
    };
  }

  function addSongsToLocalPlaylist(songs, playlistName) {
    var name = normalizePlaylistName(playlistName);
    if (!name) return toolError('PLAYLIST_NAME_REQUIRED', '请提供歌单名称');
    if (!Array.isArray(songs) || !songs.length) return toolError('NO_RECOMMENDATIONS', '没有找到可以加入歌单的歌曲');
    if (typeof ensureLocalUserPlaylistsLoaded !== 'function' || typeof saveLocalUserPlaylists !== 'function') {
      return toolError('PLAYLISTS_NOT_READY', '本地歌单尚未初始化');
    }
    ensureLocalUserPlaylistsLoaded();
    var playlist = findLocalPlaylistByName(name);
    var created = false;
    if (!playlist) {
      playlist = newLocalPlaylist(name);
      userPlaylists.unshift(playlist);
      created = true;
    }
    playlist.songs = Array.isArray(playlist.songs) ? playlist.songs : [];
    var previousSongs = playlist.songs.slice();
    var previousCover = playlist.cover || '';
    var existingKeys = Object.create(null);
    previousSongs.forEach(function (song) {
      var key = typeof localPlaylistSongKey === 'function' ? localPlaylistSongKey(song) : songStableId(song);
      if (key) existingKeys[key] = true;
    });
    var limit = 1000;
    try { if (typeof PLAYLIST_MAX_SONGS !== 'undefined') limit = Number(PLAYLIST_MAX_SONGS) || limit; } catch (_error) {}
    var additions = [];
    songs.forEach(function (song) {
      if (!song || playlist.songs.length + additions.length >= limit) return;
      var key = typeof localPlaylistSongKey === 'function' ? localPlaylistSongKey(song) : songStableId(song);
      if (!key || existingKeys[key]) return;
      existingKeys[key] = true;
      additions.push(typeof cloneSong === 'function' ? cloneSong(song) : Object.assign({}, song));
    });
    if (!additions.length) {
      return {
        ok: true,
        created: created,
        addedCount: 0,
        duplicateCount: songs.length,
        playlist: { id: playlist.id, name: playlist.name, trackCount: playlist.songs.length },
        message: '推荐歌曲已经都在歌单“' + name + '”中',
        authMode: 'local-player',
        requiresLogin: false
      };
    }
    playlist.songs = playlist.songs.concat(additions);
    playlist.trackCount = playlist.songs.length;
    try {
      var coverSong = playlist.songs[0];
      playlist.cover = playlist.cover || (typeof songCoverSrc === 'function' ? songCoverSrc(coverSong, 88) : '') || coverSong.picUrl || coverSong.cover || '';
    } catch (_error) {}
    playlist.updatedAt = Date.now();
    if (!saveLocalUserPlaylists()) {
      if (created) userPlaylists = userPlaylists.filter(function (item) { return item !== playlist; });
      else {
        playlist.songs = previousSongs;
        playlist.trackCount = previousSongs.length;
        playlist.cover = previousCover;
      }
      return toolError('PLAYLIST_SAVE_FAILED', '推荐歌单保存失败');
    }
    refreshLocalPlaylistViews();
    return {
      ok: true,
      created: created,
      addedCount: additions.length,
      duplicateCount: Math.max(0, songs.length - additions.length),
      playlist: { id: playlist.id, name: playlist.name, trackCount: playlist.songs.length },
      message: '已向歌单“' + name + '”加入 ' + additions.length + ' 首歌曲',
      authMode: 'local-player',
      requiresLogin: false
    };
  }

  function savePendingRecommendedPlaylist(input) {
    var options = asOptions(input);
    if (!pendingRecommendedSongs || !Array.isArray(pendingRecommendedSongs.songs) || !pendingRecommendedSongs.songs.length) {
      return toolError('NO_PENDING_RECOMMENDATIONS', '当前没有等待保存的推荐歌曲');
    }
    var requestedName = normalizePlaylistName(options.playlist_name || options.playlistName || options.name);
    var name = requestedName || pendingRecommendedSongs.playlistName || '小M推荐';
    var saved = addSongsToLocalPlaylist(pendingRecommendedSongs.songs, name);
    if (saved && saved.ok) pendingRecommendedSongs = null;
    return saved;
  }

  function discardPendingRecommendedPlaylist() {
    pendingRecommendedSongs = null;
    return { ok: true, message: '好的，推荐歌曲只保留在当前播放队列中', requiresLogin: false };
  }

  async function addRecommendedSongsToQueue(songs, options, playlistName) {
    if (!Array.isArray(playQueue)) return toolError('PLAYER_NOT_READY', '播放队列尚未初始化');
    var knownKeys = Object.create(null);
    playQueue.forEach(function (song, index) {
      var key = stableQueueKey(song, index);
      if (key) knownKeys[key] = true;
    });
    var additions = [];
    songs.forEach(function (song, index) {
      if (!song) return;
      var queued = typeof playlistPanelQueueSong === 'function'
        ? playlistPanelQueueSong(song)
        : (typeof cloneSong === 'function' ? cloneSong(song) : Object.assign({}, song));
      var key = stableQueueKey(queued, index);
      if (!key || knownKeys[key]) return;
      knownKeys[key] = true;
      additions.push(queued);
    });
    var insertAt = playQueue.length;
    if (additions.length) {
      if (typeof clearLocalLibraryPassiveQueue === 'function') clearLocalLibraryPassiveQueue();
      playQueue.push.apply(playQueue, additions);
      try { if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('agent-recommended-queue', { scrollCurrent: false, deferWhenHidden: false }); } catch (_error) {}
      try { if (typeof safeSwitchPlaylistTab === 'function') safeSwitchPlaylistTab('queue', 'agent-recommended-queue'); } catch (_error) {}
      try { if (typeof safeShelfRebuild === 'function') safeShelfRebuild('agent-recommended-queue', true); } catch (_error) {}
      try { if (typeof savePlaybackSession === 'function') savePlaybackSession(true); } catch (_error) {}
      try { if (typeof forcePlaybackControlsInteractive === 'function') forcePlaybackControlsInteractive(); } catch (_error) {}
    }
    var playbackStarted = false;
    if (additions.length && (options.start_playback === true || options.startPlayback === true) && typeof playQueueAt === 'function') {
      try { playbackStarted = (await playQueueAt(insertAt, { manual: true, context: { type: 'agent-recommendation', playlistName: playlistName } })) !== false; } catch (_error) {}
    }
    return {
      ok: true,
      addedCount: additions.length,
      duplicateCount: Math.max(0, songs.length - additions.length),
      queueLength: playQueue.length,
      playbackStarted: playbackStarted
    };
  }

  async function playLocalPlaylistByName(playlistName) {
    var playlist = findLocalPlaylistByName(playlistName);
    if (!playlist || !Array.isArray(playlist.songs) || !playlist.songs.length) return false;
    if (typeof playQueueAt !== 'function') return false;
    try {
      if (typeof primeOnlineAudioForUserGesture === 'function') primeOnlineAudioForUserGesture();
      playQueue = playlist.songs.map(function (song) {
        if (typeof playlistPanelQueueSong === 'function') return playlistPanelQueueSong(song);
        return typeof cloneSong === 'function' ? cloneSong(song) : Object.assign({}, song);
      });
      currentIdx = 0;
      try { if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('agent-recommended-playlist'); } catch (_error) {}
      try { if (typeof safeSwitchPlaylistTab === 'function') safeSwitchPlaylistTab('queue', 'agent-recommended-playlist'); } catch (_error) {}
      try { if (typeof safeShelfRebuild === 'function') safeShelfRebuild('agent-recommended-playlist', true); } catch (_error) {}
      try { if (typeof forcePlaybackControlsInteractive === 'function') forcePlaybackControlsInteractive(); } catch (_error) {}
      return (await playQueueAt(0, { manual: true, context: { type: 'agent-playlist', playlistName: playlist.name } })) !== false;
    } catch (_error) {
      return false;
    }
  }

  async function buildRecommendedPlaylist(input) {
    var options = asOptions(input);
    var playlistName = normalizePlaylistName(options.playlist_name || options.playlistName);
    var rawQueries = Array.isArray(options.search_queries || options.searchQueries) ? (options.search_queries || options.searchQueries) : [];
    var queries = rawQueries.map(function (item) { return String(item || '').trim().slice(0, 240); }).filter(function (item, index, all) {
      return item && all.indexOf(item) === index;
    }).slice(0, 20);
    if (!playlistName) return toolError('PLAYLIST_NAME_REQUIRED', '请提供推荐歌单名称');
    if (!queries.length) return toolError('RECOMMENDATION_QUERIES_REQUIRED', '请提供至少一个歌曲搜索词');
    var maxSongs = Math.max(1, Math.min(100, Math.round(Number(options.max_songs || options.maxSongs) || Math.min(10, queries.length))));
    var songsNeeded = maxSongs;
    var excludeKeywords = (Array.isArray(options.exclude_keywords || options.excludeKeywords) ? (options.exclude_keywords || options.excludeKeywords) : [])
      .map(normalizeText).filter(Boolean).slice(0, 8);
    var onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    var searchResults = new Array(queries.length);
    var cursor = 0;
    var completed = 0;
    async function worker() {
      while (cursor < queries.length) {
        var index = cursor++;
        var query = queries[index];
        try {
          var perQueryLimit = queries.length === 1 ? Math.min(150, songsNeeded + 12) : 6;
          searchResults[index] = await searchMusic({ query: query, limit: perQueryLimit, fetchLimit: Math.max(15, perQueryLimit), timeoutMs: 24000 });
        } catch (error) {
          searchResults[index] = toolError('SEARCH_FAILED', error && error.message ? error.message : '搜索失败');
        }
        completed += 1;
        if (onProgress) {
          try { onProgress({ completed: completed, total: queries.length, query: query }); } catch (_error) {}
        }
      }
    }
    var workers = [];
    for (var workerIndex = 0; workerIndex < Math.min(3, queries.length); workerIndex++) workers.push(worker());
    await Promise.all(workers);

    function allowedSong(song) {
      if (!song) return false;
      if (!excludeKeywords.length) return true;
      var text = normalizeText((song.name || song.title || '') + ' ' + (song.singer || song.artist || ''));
      return !excludeKeywords.some(function (keyword) { return text.indexOf(keyword) >= 0; });
    }
    var selected = [];
    var selectedKeys = Object.create(null);
    function trySelect(song) {
      if (!allowedSong(song) || selected.length >= songsNeeded) return false;
      var summary = safeSongSummary(song);
      var key = normalizeText(summary.title) + '|' + normalizeText(summary.artist);
      if (!key || key === '|') key = typeof localPlaylistSongKey === 'function' ? localPlaylistSongKey(song) : songStableId(song, selected.length);
      if (!key || selectedKeys[key]) return false;
      selectedKeys[key] = true;
      selected.push(song);
      return true;
    }
    searchResults.forEach(function (result) {
      var songs = result && result.ok && Array.isArray(result.songs) ? result.songs : [];
      for (var i = 0; i < songs.length; i++) if (trySelect(songs[i])) break;
    });
    if (selected.length < maxSongs) {
      searchResults.forEach(function (result) {
        var songs = result && result.ok && Array.isArray(result.songs) ? result.songs : [];
        songs.forEach(trySelect);
      });
    }
    if (!selected.length) return toolError('NO_RECOMMENDATIONS', '没有搜索到符合条件的推荐歌曲');
    var queued = await addRecommendedSongsToQueue(selected, options, playlistName);
    if (!queued.ok) return queued;
    pendingRecommendedSongs = { playlistName: playlistName, songs: selected.slice(), createdAt: Date.now() };
    var failedQueries = searchResults.filter(function (result) { return !result || !result.ok; }).length;
    return {
      ok: true,
      addedCount: queued.addedCount,
      duplicateCount: queued.duplicateCount,
      queueLength: queued.queueLength,
      selectedCount: selected.length,
      queryCount: queries.length,
      failedQueries: failedQueries,
      playbackStarted: queued.playbackStarted,
      songs: selected.map(safeSongSummary),
      pendingPlaylist: { name: playlistName, trackCount: selected.length },
      awaitingPlaylistConfirmation: true,
      message: '已把 ' + queued.addedCount + ' 首推荐歌曲加入当前播放队列。需要再保存为“' + playlistName + '”歌单吗？回复“要”或“不用”。',
      authMode: 'imported-lx-source',
      requiresLogin: false
    };
  }

  function diyConsoleEntryIsSafe(entry) {
    if (!entry || entry.history === false || !entry.element || !entry.element.isConnected) return false;
    var element = entry.element;
    if (element.closest && element.closest('#audio-output-panel,#cache-storage-panel,.memory-action-row,.bg-media-row,.wallpaper-engine-row,#user-archive-grid')) return false;
    if (element.querySelector && element.querySelector('input[type="file"],input[type="password"],textarea')) return false;
    return true;
  }

  function diyConsoleSafeButtons(element) {
    if (!element) return [];
    var buttons = [];
    if (element.matches && element.matches('button')) buttons.push(element);
    if (element.querySelectorAll) buttons = buttons.concat(Array.prototype.slice.call(element.querySelectorAll('button')));
    return buttons.filter(function (button) {
      if (!button || button.disabled || button.closest('.fx-console-toolbar,.memory-action-row,.bg-media-row,.wallpaper-engine-row,#user-archive-grid')) return false;
      if (button.matches('.fx-reset-one,[data-action*="delete"],[data-action*="remove"],[data-action*="clear"],[data-action*="import"],[data-action*="export"]')) return false;
      return !/(删除|移除|清空|释放|导入|导出|选择文件|打开目录|重置|恢复默认)/.test(String(button.textContent || button.title || ''));
    });
  }

  function diyConsoleEntryDetails(entry) {
    var element = entry && entry.element;
    var range = element && (element.matches('input[type="range"]') ? element : element.querySelector('input[type="range"]'));
    var color = element && (element.matches('input[type="color"]') ? element : element.querySelector('input[type="color"]'));
    var select = element && (element.matches('select') ? element : element.querySelector('select'));
    var checkbox = element && (element.matches('input[type="checkbox"],input[type="radio"]') ? element : element.querySelector('input[type="checkbox"],input[type="radio"]'));
    var buttons = diyConsoleSafeButtons(element);
    var details = {
      title: entry.title,
      section: entry.tabLabel,
      group: entry.groupLabel,
      current: typeof fxConsoleCurrentValue === 'function' ? fxConsoleCurrentValue(entry) : ''
    };
    if (range) {
      details.type = 'range';
      details.value = Number(range.value);
      details.min = Number(range.min);
      details.max = Number(range.max);
      details.step = Number(range.step) || 1;
    } else if (color) {
      details.type = 'color';
      details.value = String(color.value || '').toUpperCase();
    } else if (select) {
      details.type = 'select';
      details.value = select.value;
      details.options = Array.prototype.slice.call(select.options || []).map(function (option) { return String(option.textContent || option.value).trim(); }).filter(Boolean);
    } else if (checkbox) {
      details.type = 'toggle';
      details.value = !!checkbox.checked;
    } else if (element && element.classList && element.classList.contains('fx-toggle')) {
      details.type = 'toggle';
      details.value = element.classList.contains('on') || element.getAttribute('aria-pressed') === 'true';
    } else if (buttons.length) {
      details.type = 'options';
      details.options = buttons.map(function (button) { return String(button.textContent || button.title || '').replace(/\s+/g, ' ').trim(); }).filter(Boolean).slice(0, 30);
    } else {
      details.type = 'unsupported';
    }
    return details;
  }

  function diyConsoleRuntimeEntries() {
    var panel = document.getElementById('fx-panel');
    if (!panel) return [];
    var blockSelector = '.fx-slider,.fx-toggle,.fx-seg,.lyric-color-row,.lyric-color-grid,.preset-grid,.fx-font-grid,.lyric-glitch-controls,.lyric-glow-effect-row';
    var nodes = [];
    panel.querySelectorAll('input[type="range"],input[type="color"],input[type="checkbox"],input[type="radio"],select').forEach(function (control) {
      var block = control.closest(blockSelector) || control;
      if (nodes.indexOf(block) < 0) nodes.push(block);
    });
    panel.querySelectorAll('.fx-toggle,.fx-seg,.fx-actions,.preset-grid,.fx-font-grid,.lyric-color-row,.lyric-color-grid').forEach(function (block) {
      if (nodes.indexOf(block) < 0) nodes.push(block);
    });
    return nodes.map(function (element, index) {
      var label = element.querySelector && element.querySelector('label');
      var titleNode = element.querySelector && element.querySelector('.fx-fold-title strong,.fx-fold-title,h3,h4');
      var previous = element.previousElementSibling;
      var sectionTitle = previous && previous.classList && previous.classList.contains('fx-section-label') ? previous.textContent : '';
      var title = String(element.getAttribute && element.getAttribute('data-fx-console-title') || (label && label.textContent) || sectionTitle || (titleNode && titleNode.textContent) || '').replace(/\s+/g, ' ').trim();
      if (!title && element.matches && element.matches('.fx-toggle,button')) title = String(element.textContent || element.title || '').replace(/\s+/g, ' ').trim();
      var control = element.matches && element.matches('input,select') ? element : element.querySelector && element.querySelector('input:not([type="hidden"]),select');
      if (!title && control) title = String(control.getAttribute('aria-label') || control.title || control.id || '').trim();
      var fold = element.closest && element.closest('.fx-fold,.fx-advanced');
      var foldTitle = fold && fold.querySelector('.fx-fold-title,.fx-advanced-head,.fx-fold-head');
      var groupLabel = String(foldTitle && foldTitle.textContent || 'DIY').replace(/\s+/g, ' ').trim();
      return {
        id: 'diy-runtime-entry-' + (index + 1),
        title: title || ('DIY 控件 ' + (index + 1)),
        aliases: String(element.textContent || '') + ' ' + String(control && control.id || ''),
        tab: 'diy',
        tabLabel: 'DIY',
        group: normalizeText(groupLabel) || 'settings',
        groupLabel: groupLabel,
        history: true,
        element: element
      };
    });
  }

  function resolveDiyConsoleEntry(query, section, operation) {
    try {
      if (typeof organizeFxConsoleWorkspace === 'function') organizeFxConsoleWorkspace();
    } catch (_error) {}
    var registry = typeof fxConsoleRegistry !== 'undefined' && Array.isArray(fxConsoleRegistry) && fxConsoleRegistry.length
      ? fxConsoleRegistry
      : diyConsoleRuntimeEntries();
    if (!registry.length) return { error: toolError('DIY_CONSOLE_NOT_READY', 'DIY 视觉控制台尚未加载完成') };
    var queryToken = normalizeText(query);
    var sectionToken = normalizeText(section);
    if (!queryToken) return { error: toolError('DIY_CONTROL_REQUIRED', '请提供 DIY 控件名称') };
    var ranked = registry.filter(diyConsoleEntryIsSafe).map(function (entry) {
      var title = normalizeText(entry.title);
      var aliases = normalizeText(entry.aliases);
      var location = normalizeText([entry.tabLabel, entry.groupLabel].join(' '));
      var all = normalizeText([entry.title, entry.aliases, entry.tabLabel, entry.groupLabel, entry.element && entry.element.textContent].join(' '));
      if (sectionToken && location.indexOf(sectionToken) < 0 && sectionToken.indexOf(location) < 0) return null;
      var score = 0;
      if (title === queryToken) score = 1000;
      else if (title.indexOf(queryToken) >= 0) score = 850;
      else if (queryToken.indexOf(title) >= 0) score = 750;
      else if (aliases.indexOf(queryToken) >= 0) score = 600;
      else if (all.indexOf(queryToken) >= 0) score = 400;
      if (score && /^(set|increase|decrease)$/.test(operation) && entry.element.querySelector('input[type="range"],input[type="color"]')) score += 120;
      if (score && operation === 'toggle' && (entry.element.classList.contains('fx-toggle') || entry.element.querySelector('input[type="checkbox"],input[type="radio"]'))) score += 120;
      if (score && operation === 'select' && (entry.element.matches('select,.fx-seg,.fx-font-grid,.preset-grid,.fx-actions') || entry.element.querySelector('select,button'))) score += 120;
      return score ? { entry: entry, score: score } : null;
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score; });
    if (!ranked.length) return { error: toolError('DIY_CONTROL_NOT_FOUND', '没有找到 DIY 控件“' + String(query).slice(0, 60) + '”') };
    var top = ranked[0];
    var tied = ranked.filter(function (item) { return item.score === top.score; });
    if (tied.length > 1) {
      var candidates = tied.slice(0, 8).map(function (item) {
        return item.entry.tabLabel + ' / ' + item.entry.groupLabel + ' / ' + item.entry.title;
      });
      return { error: toolError('DIY_CONTROL_AMBIGUOUS', '找到多个相似控件，请说出完整名称或所属分组。', { candidates: candidates }) };
    }
    return { entry: top.entry };
  }

  function diyConsoleDispatch(control) {
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function applyDiyConsoleControl(options) {
    var operation = String(options.operation || 'inspect').toLowerCase();
    var controlToken = normalizeText(options.control);
    if ((controlToken === '3d歌单架' || controlToken === '歌单架') && operation === 'select') {
      var shelfOption = normalizeText(options.option);
      var shelfMode = /关闭|停用|禁用|off/.test(shelfOption) ? 'off' : (/舞台|stage/.test(shelfOption) ? 'stage' : 'side');
      if (typeof setShelfMode !== 'function') return toolError('DIY_NOT_READY', '3D 歌单架尚未加载完成');
      setShelfMode(shelfMode);
      return {
        ok: true,
        message: shelfMode === 'off' ? '3D 歌单架已关闭' : ('3D 歌单架已打开为' + (shelfMode === 'stage' ? '舞台模式' : '侧栏模式')),
        setting: { title: '3D 歌单架', type: 'options', value: shelfMode, current: shelfMode === 'off' ? '关闭' : (shelfMode === 'stage' ? '舞台' : '侧栏') },
        requiresLogin: false
      };
    }
    var directElement = null;
    if (/歌词溢光/.test(controlToken) && /^(inspect|set|increase|decrease)$/.test(operation)) {
      directElement = document.getElementById('fx-lyricglow');
    }
    var resolved = directElement ? {
      entry: {
        id: 'diy-direct-' + directElement.id,
        title: '歌词溢光强度',
        aliases: '歌词溢光 歌词溢光强度',
        tab: 'diy',
        tabLabel: 'DIY',
        group: 'lyrics',
        groupLabel: '歌词溢光强度',
        history: true,
        element: directElement
      }
    } : resolveDiyConsoleEntry(options.control, options.section, operation);
    if (resolved.error) return resolved.error;
    var entry = resolved.entry;
    var element = entry.element;
    var details = diyConsoleEntryDetails(entry);
    if (operation === 'inspect') {
      var inspection = entry.title + '：当前 ' + (details.current || details.value || '可调整');
      if (details.type === 'range') inspection += '，范围 ' + details.min + '–' + details.max + '，步进 ' + details.step;
      if (details.options && details.options.length) inspection += '，选项：' + details.options.join('、');
      return { ok: true, message: inspection, setting: details, requiresLogin: false };
    }

    var range = element.matches('input[type="range"]') ? element : element.querySelector('input[type="range"]');
    if (range && /^(set|increase|decrease)$/.test(operation)) {
      var min = Number(range.min);
      var max = Number(range.max);
      var step = Number(range.step) || 1;
      var current = Number(range.value);
      var supplied = Number(options.value);
      if (!isFinite(supplied) && operation === 'set') return toolError('DIY_VALUE_REQUIRED', entry.title + '需要提供 value');
      if (!isFinite(supplied)) supplied = options.valueMode === 'percent' ? 10 : step;
      var target = current;
      if (options.valueMode === 'percent') {
        var currentPercent = percentFromRange(current, min, max);
        var targetPercent = operation === 'set' ? supplied : currentPercent + (operation === 'increase' ? supplied : -supplied);
        target = valueFromPercent(targetPercent, min, max);
      } else {
        target = operation === 'set' ? supplied : current + (operation === 'increase' ? supplied : -supplied);
      }
      target = clampNumber(target, min, max);
      if (step > 0) target = min + Math.round((target - min) / step) * step;
      var decimals = step < 1 ? Math.min(6, String(step).split('.')[1] ? String(step).split('.')[1].length : 3) : 0;
      range.value = String(Number(target.toFixed(decimals)));
      diyConsoleDispatch(range);
      var updatedRange = diyConsoleEntryDetails(entry);
      var rangeMessage = options.valueMode === 'percent'
        ? entry.title + '：' + Math.round(percentFromRange(Number(range.value), min, max)) + '%'
        : entry.title + '已调整为 ' + (updatedRange.current || updatedRange.value);
      return { ok: true, message: rangeMessage, setting: updatedRange, requiresLogin: false };
    }

    var color = element.matches('input[type="color"]') ? element : element.querySelector('input[type="color"]');
    if (color && operation === 'set') {
      var selectedColor = normalizeDiyColor(options.color || options.option);
      if (!selectedColor) return toolError('DIY_COLOR_REQUIRED', entry.title + '需要有效颜色名或 #RRGGBB');
      color.value = selectedColor;
      diyConsoleDispatch(color);
      var updatedColor = diyConsoleEntryDetails(entry);
      return { ok: true, message: entry.title + '已调整为 ' + selectedColor.toUpperCase(), setting: updatedColor, requiresLogin: false };
    }

    var select = element.matches('select') ? element : element.querySelector('select');
    if (select && operation === 'select') {
      var optionToken = normalizeText(options.option);
      var selectOption = Array.prototype.slice.call(select.options || []).find(function (option) {
        return normalizeText(option.value) === optionToken || normalizeText(option.textContent) === optionToken || normalizeText(option.textContent).indexOf(optionToken) >= 0;
      });
      if (!selectOption) return toolError('DIY_OPTION_NOT_FOUND', '没有找到选项“' + String(options.option || '').slice(0, 50) + '”；可选：' + (details.options || []).join('、'), { options: details.options || [] });
      select.value = selectOption.value;
      diyConsoleDispatch(select);
      return { ok: true, message: entry.title + '已切换为 ' + String(selectOption.textContent || selectOption.value).trim(), setting: diyConsoleEntryDetails(entry), requiresLogin: false };
    }

    var checkbox = element.matches('input[type="checkbox"],input[type="radio"]') ? element : element.querySelector('input[type="checkbox"],input[type="radio"]');
    if (checkbox && operation === 'toggle') {
      var desiredToken = normalizeText(options.option);
      var desired = /^(开启|打开|启用|on|true|1)$/.test(desiredToken) ? true : (/^(关闭|停用|禁用|off|false|0)$/.test(desiredToken) ? false : !checkbox.checked);
      if (checkbox.checked !== desired) {
        checkbox.checked = desired;
        diyConsoleDispatch(checkbox);
      }
      return { ok: true, message: entry.title + (desired ? '已开启' : '已关闭'), setting: diyConsoleEntryDetails(entry), requiresLogin: false };
    }

    if (operation === 'toggle' && element.classList && element.classList.contains('fx-toggle')) {
      var desiredElementToken = normalizeText(options.option);
      var elementOn = element.classList.contains('on') || element.classList.contains('active') || element.getAttribute('aria-pressed') === 'true';
      var desiredElementOn = /^(开启|打开|启用|on|true|1)$/.test(desiredElementToken) ? true : (/^(关闭|停用|禁用|off|false|0)$/.test(desiredElementToken) ? false : !elementOn);
      if (elementOn !== desiredElementOn) element.click();
      return { ok: true, message: entry.title + (desiredElementOn ? '已开启' : '已关闭'), setting: diyConsoleEntryDetails(entry), requiresLogin: false };
    }

    var buttons = diyConsoleSafeButtons(element);
    if (operation === 'toggle' && buttons.length) {
      var toggleButton = buttons[0];
      var desiredToggleToken = normalizeText(options.option);
      var currentOn = element.classList.contains('on') || toggleButton.classList.contains('on') || toggleButton.classList.contains('active') || toggleButton.getAttribute('aria-pressed') === 'true';
      var desiredOn = /^(开启|打开|启用|on|true|1)$/.test(desiredToggleToken) ? true : (/^(关闭|停用|禁用|off|false|0)$/.test(desiredToggleToken) ? false : !currentOn);
      if (currentOn !== desiredOn) toggleButton.click();
      return { ok: true, message: entry.title + (desiredOn ? '已开启' : '已关闭'), setting: diyConsoleEntryDetails(entry), requiresLogin: false };
    }

    if (operation === 'select' && buttons.length) {
      var buttonToken = normalizeText(options.option);
      var selectedButton = buttons.find(function (button) {
        var text = normalizeText([button.textContent, button.title, button.value, button.getAttribute('data-value'), button.getAttribute('data-mode'), button.getAttribute('data-preset')].join(' '));
        return text === buttonToken || text.indexOf(buttonToken) >= 0;
      });
      if (!selectedButton) return toolError('DIY_OPTION_NOT_FOUND', '没有找到选项“' + String(options.option || '').slice(0, 50) + '”；可选：' + (details.options || []).join('、'), { options: details.options || [] });
      selectedButton.click();
      return { ok: true, message: entry.title + '已切换为 ' + String(selectedButton.textContent || selectedButton.title || options.option).replace(/\s+/g, ' ').trim(), setting: diyConsoleEntryDetails(entry), requiresLogin: false };
    }

    return toolError('DIY_CONTROL_UNSUPPORTED', entry.title + '暂不支持此操作', { setting: details, operation: operation });
  }

  function localDiyColorFromText(text) {
    var hexMatch = /#[0-9a-f]{6}\b/i.exec(text);
    if (hexMatch) return hexMatch[0];
    var names = ['深蓝色','浅蓝色','深绿色','浅绿色','玫红色','紫红色','橙黄色','白色','黑色','红色','橙色','黄色','绿色','青色','蓝色','紫色','粉色','灰色','金色'];
    return names.find(function (name) { return text.indexOf(name) >= 0; }) || '';
  }

  function localDiyClauseForToken(text, token) {
    var clauses = String(text || '').split(/(?:然后|接着|并且|同时|还有)|[，,。；;]/).map(function (part) { return part.trim(); }).filter(Boolean);
    var normalizedToken = normalizeText(token);
    return clauses.find(function (part) { return normalizeText(part).indexOf(normalizedToken) >= 0; }) || String(text || '');
  }

  function localDiyPresetFromText(text) {
    var presets = [
      [/音域回响.{0,5}(?:wallpaper\s*engine|we)|(?:wallpaper\s*engine|cmzya).{0,5}音域回响/i, 'sonic_wallpaper_engine'],
      [/音域回响.{0,5}(?:ajin|sonic[\s-]*topography)|(?:ajin|sonic[\s-]*topography).{0,5}音域回响/i, 'sonic_ajin'],
      [/智能声境/, 'smart'], [/emily专辑封面|封面粒子/, 'album_cover'], [/滚筒|隧道/, 'tunnel'],
      [/星球|行星/, 'planet'], [/虚空/, 'void'], [/唱片|圆形封面/, 'disc'], [/星河|壁纸粒子/, 'star_river'],
      [/安魂|骷髅/, 'skull'], [/(?:^|切换|换成|使用|预设).{0,4}(?:声境|3d地形)/i, 'terrain'],
      [/极光/, 'aurora'], [/霓虹雨夜|雨夜/, 'neon_rain'], [/水墨|国风/, 'ink'], [/纯净舞台|极简舞台/, 'minimal']
    ];
    if (!/(?:切换|换成|改成|使用|设为|设置为|打开|启用|预设|模式)/i.test(text)) return '';
    for (var index = 0; index < presets.length; index += 1) if (presets[index][0].test(text)) return presets[index][1];
    return '';
  }

  function localDiyEntryMatch(entry, normalizedMessage) {
    var title = normalizeText(entry.title);
    var variants = [title];
    if (/^3d/.test(title)) variants.push(title.replace(/^3d/, ''));
    if (/开关$/.test(title)) variants.push(title.replace(/开关$/, ''));
    var score = 0;
    var token = '';
    variants.forEach(function (candidate) {
      if (candidate.length >= 2 && normalizedMessage.indexOf(candidate) >= 0 && 1000 + candidate.length > score) {
        score = 1000 + candidate.length;
        token = candidate;
      }
    });
    String(entry.aliases || '').split(/\s+/).forEach(function (alias) {
      var candidate = normalizeText(alias);
      if (candidate.length >= 3 && normalizedMessage.indexOf(candidate) >= 0 && 500 + candidate.length > score) {
        score = 500 + candidate.length;
        token = candidate;
      }
    });
    return score ? { entry: entry, score: score, token: token } : null;
  }

  function localDiyControlRequest(match, message) {
    var entry = match.entry;
    var details = diyConsoleEntryDetails(entry);
    var clause = localDiyClauseForToken(message, match.token);
    var source = clause || message;
    var normalizedSource = normalizeText(source);
    var opening = /(?:打开|开启|启用|启动|显示)/.test(source);
    var closing = /(?:关闭|关掉|停用|禁用|隐藏|取消)/.test(source);
    var inspecting = /(?:查看|当前|现在|多少|什么值|状态)/.test(source) && !opening && !closing;

    if (details.type === 'range') {
      var operation = /(?:增加|加大|调高|提高|变大)/.test(source) ? 'increase' : (/(?:减少|减小|调低|降低|变小)/.test(source) ? 'decrease' : 'set');
      var numbers = source.match(/-?\d+(?:\.\d+)?\s*(?:%|％)?/g) || [];
      if (!numbers.length) return inspecting ? { control: entry.title, section: entry.groupLabel, operation: 'inspect' } : null;
      var rawNumber = numbers[numbers.length - 1];
      var value = Number(rawNumber.replace(/\s*(?:%|％)$/, ''));
      var valueMode = /(?:%|％)$/.test(rawNumber) || (details.max <= 10 && Math.abs(value) > details.max) ? 'percent' : 'absolute';
      return { control: entry.title, section: entry.groupLabel, operation: operation, value: value, value_mode: valueMode };
    }

    if (details.type === 'color') {
      var color = localDiyColorFromText(source);
      if (color) return { control: entry.title, section: entry.groupLabel, operation: 'set', color: color };
      return inspecting ? { control: entry.title, section: entry.groupLabel, operation: 'inspect' } : null;
    }

    if (details.type === 'toggle') {
      if (!opening && !closing && !/(?:切换|反转)/.test(source)) return inspecting ? { control: entry.title, section: entry.groupLabel, operation: 'inspect' } : null;
      return { control: entry.title, section: entry.groupLabel, operation: 'toggle', option: closing ? '关闭' : (opening ? '开启' : '') };
    }

    if (details.type === 'select' || details.type === 'options') {
      var options = (details.options || []).slice().sort(function (a, b) { return normalizeText(b).length - normalizeText(a).length; });
      var selected = options.find(function (option) {
        var token = normalizeText(option);
        return token && normalizedSource.indexOf(token) >= 0;
      }) || '';
      if (!selected && closing) selected = options.find(function (option) { return /关闭|停用|禁用|off/i.test(option); }) || '';
      if (!selected && opening) {
        if (/歌单架/.test(entry.title)) selected = options.find(function (option) { return /侧栏/.test(option); }) || '';
        if (!selected) selected = options.find(function (option) { return !/关闭|停用|禁用|off/i.test(option); }) || '';
      }
      if (selected) return { control: entry.title, section: entry.groupLabel, operation: 'select', option: selected };
      return inspecting ? { control: entry.title, section: entry.groupLabel, operation: 'inspect' } : null;
    }
    return null;
  }

  function parseLocalDiyCommand(input) {
    var message = String(input || '').trim();
    if (!message) return null;
    try { if (typeof organizeFxConsoleWorkspace === 'function') organizeFxConsoleWorkspace(); } catch (_error) {}
    var request = {};
    var controls = [];
    var recognized = false;
    var normalizedMessage = normalizeText(message);

    if (/(?:打开|开启|启用).{0,5}(?:diy|玩家模式)/i.test(message)) { request.enabled = true; recognized = true; }
    else if (/(?:关闭|停用|禁用).{0,5}(?:diy|玩家模式)|(?:diy|玩家模式).{0,5}(?:关闭|停用|禁用)/i.test(message)) { request.enabled = false; recognized = true; }

    var preset = localDiyPresetFromText(message);
    if (preset) { request.preset = preset; recognized = true; }

    var intensityMatch = message.match(/律动强度[^\d-]{0,12}(-?\d+(?:\.\d+)?)\s*(?:%|％)?/i);
    if (intensityMatch) {
      request.intensity = clampNumber(Number(intensityMatch[1]), 0, 100);
      recognized = true;
    }
    var depthMatch = message.match(/(?:画面景深|立体感)[^\d-]{0,12}(-?\d+(?:\.\d+)?)\s*(?:%|％)?/i);
    if (depthMatch) {
      request.depth = clampNumber(Number(depthMatch[1]), 0, 100);
      recognized = true;
    }

    var registry = typeof fxConsoleRegistry !== 'undefined' && Array.isArray(fxConsoleRegistry) && fxConsoleRegistry.length
      ? fxConsoleRegistry
      : diyConsoleRuntimeEntries();
    var matches = registry.filter(diyConsoleEntryIsSafe).map(function (entry) { return localDiyEntryMatch(entry, normalizedMessage); }).filter(Boolean);
    if (matches.length) {
      var exactMatches = matches.filter(function (match) { return match.score >= 1000; });
      if (exactMatches.length) matches = exactMatches;
      if (/随歌曲变色/.test(message) && matches.length > 1 && typeof fx !== 'undefined' && fx) {
        var wanted = Number(fx.preset) === 14 ? /^WE / : (Number(fx.preset) === 13 ? /^Ajin / : null);
        if (wanted) {
          var activeMatch = matches.find(function (match) { return wanted.test(match.entry.title); });
          if (activeMatch) matches = [activeMatch];
        }
      }
      var seen = {};
      matches.sort(function (a, b) { return b.score - a.score; }).forEach(function (match) {
        if (seen[match.entry.id]) return;
        if (preset && match.entry.title === '视觉预设') return;
        if (hasOwn(request, 'intensity') && match.entry.title === '律动强度') return;
        if (hasOwn(request, 'depth') && match.entry.title === '画面景深') return;
        var control = localDiyControlRequest(match, message);
        if (!control) return;
        seen[match.entry.id] = true;
        controls.push(control);
      });
    }

    if (!controls.length && /歌单架/.test(message) && /(?:打开|开启|启用|关闭|关掉|舞台|侧栏)/.test(message)) {
      controls.push({ control: '3D 歌单架', section: '显示方式', operation: 'select', option: /关闭|关掉/.test(message) ? '关闭' : (/舞台/.test(message) ? '舞台' : '侧栏') });
    }

    if (controls.length) { request.controls = controls; recognized = true; }
    return recognized ? request : null;
  }

  function controlDiyVisual(input) {
    var options = input && typeof input === 'object' && !Array.isArray(input) ? input : { preset: input };
    var request = {};
    var hasChange = false;
    function readOption(snake, camel) {
      if (hasOwn(options, snake)) return { present: true, value: options[snake] };
      if (camel && hasOwn(options, camel)) return { present: true, value: options[camel] };
      return { present: false, value: undefined };
    }

    var enabledOption = readOption('enabled');
    if (enabledOption.present) {
      if (typeof enabledOption.value !== 'boolean') return toolError('DIY_ENABLED_INVALID', 'DIY 开关必须是 true 或 false');
      request.enabled = enabledOption.value;
      hasChange = true;
    }

    var presetOption = readOption('preset');
    if (presetOption.present) {
      request.preset = normalizeDiyPreset(presetOption.value);
      if (!request.preset) return toolError('DIY_PRESET_INVALID', '没有找到这个 DIY 视觉预设');
      hasChange = true;
    }

    ['intensity', 'depth'].forEach(function (key) {
      var option = readOption(key);
      if (!option.present || request.error) return;
      var value = Number(option.value);
      if (!isFinite(value)) {
        request.error = toolError('DIY_VALUE_INVALID', (key === 'intensity' ? '律动强度' : '立体感') + '必须是 0 到 100 的数字');
        return;
      }
      request[key] = clampNumber(value, 0, 100);
      hasChange = true;
    });
    if (request.error) return request.error;

    var backgroundMode = readOption('background_mode', 'backgroundMode');
    var backgroundColor = readOption('background_color', 'backgroundColor');
    if (backgroundMode.present) {
      request.backgroundMode = String(backgroundMode.value || '').trim().toLowerCase();
      if (request.backgroundMode !== 'auto' && request.backgroundMode !== 'custom') {
        return toolError('DIY_BACKGROUND_MODE_INVALID', '背景颜色模式只支持 auto 或 custom');
      }
      hasChange = true;
    }
    if (backgroundColor.present) {
      if (String(backgroundColor.value || '').trim().toLowerCase() === 'auto') request.backgroundMode = 'auto';
      else {
        request.backgroundColor = normalizeDiyColor(backgroundColor.value);
        if (!request.backgroundColor) return toolError('DIY_BACKGROUND_COLOR_INVALID', '背景颜色必须是 #RRGGBB 格式');
        request.backgroundMode = 'custom';
      }
      hasChange = true;
    }

    var lyricColorMode = readOption('lyric_color_mode', 'lyricColorMode');
    var lyricColor = readOption('lyric_color', 'lyricColor');
    if (lyricColorMode.present) {
      request.lyricColorMode = String(lyricColorMode.value || '').trim().toLowerCase();
      if (request.lyricColorMode !== 'auto' && request.lyricColorMode !== 'custom') {
        return toolError('DIY_LYRIC_COLOR_MODE_INVALID', '歌词颜色模式只支持 auto 或 custom');
      }
      hasChange = true;
    }
    if (lyricColor.present) {
      if (String(lyricColor.value || '').trim().toLowerCase() === 'auto') request.lyricColorMode = 'auto';
      else {
        request.lyricColor = normalizeDiyColor(lyricColor.value);
        if (!request.lyricColor) return toolError('DIY_LYRIC_COLOR_INVALID', '歌词颜色必须是 #RRGGBB 格式');
        request.lyricColorMode = 'custom';
      }
      hasChange = true;
    }

    var lyricFont = readOption('lyric_font', 'lyricFont');
    if (lyricFont.present) {
      request.lyricFont = normalizeDiyLyricFont(lyricFont.value);
      if (!request.lyricFont) return toolError('DIY_LYRIC_FONT_INVALID', '没有找到这个歌词字体');
      hasChange = true;
    }
    var consoleControl = readOption('control', 'setting');
    var consoleControls = Array.isArray(options.controls) ? options.controls.slice(0, 20).filter(function (item) {
      return item && typeof item === 'object' && !Array.isArray(item) && String(item.control || item.setting || '').trim();
    }) : [];
    if (consoleControl.present) hasChange = true;
    if (consoleControls.length) hasChange = true;
    if (!hasChange) return toolError('DIY_ACTION_REQUIRED', '请提供至少一个要调整的 DIY 项目');

    var changes = [];
    var failures = [];
    try {
      if (hasOwn(request, 'enabled')) {
        if (typeof applyDiyMode !== 'function') return toolError('DIY_NOT_READY', 'DIY 模式尚未加载完成');
        applyDiyMode(request.enabled, { save: true, toast: false, animate: true });
        changes.push(request.enabled ? 'DIY 已开启' : 'DIY 已关闭');
      }

      if (request.preset) {
        if (request.preset === 'smart') {
          if (typeof toggleSmartSoundscape !== 'function') return toolError('DIY_NOT_READY', '智能声境尚未加载完成');
          var smartEnabled = false;
          try { smartEnabled = typeof smartSoundscapeEnabled !== 'undefined' && !!smartSoundscapeEnabled; } catch (_error) {}
          if (!smartEnabled) toggleSmartSoundscape();
          changes.push('视觉预设：智能声境');
        } else {
          if (typeof setPreset !== 'function') return toolError('DIY_NOT_READY', '视觉预设尚未加载完成');
          var currentSmart = false;
          try { currentSmart = typeof smartSoundscapeEnabled !== 'undefined' && !!smartSoundscapeEnabled; } catch (_error) {}
          if (currentSmart && typeof toggleSmartSoundscape === 'function') toggleSmartSoundscape();
          setPreset(DIY_VISUAL_PRESETS[request.preset].index, { silent: true });
          changes.push('视觉预设：' + DIY_VISUAL_PRESETS[request.preset].label);
        }
      }

      if (hasOwn(request, 'intensity') || hasOwn(request, 'depth')) {
        if (typeof fx === 'undefined' || !fx) return toolError('DIY_NOT_READY', 'DIY 参数尚未加载完成');
        if (hasOwn(request, 'intensity')) {
          fx.intensity = valueFromPercent(request.intensity, 0.2, 1.6);
          if (typeof setRange === 'function') setRange('fx-intensity', fx.intensity);
          changes.push('律动强度：' + Math.round(request.intensity) + '%');
        }
        if (hasOwn(request, 'depth')) {
          fx.depth = valueFromPercent(request.depth, 0.2, 1.8);
          if (typeof setRange === 'function') setRange('fx-depth', fx.depth);
          changes.push('立体感：' + Math.round(request.depth) + '%');
        }
        if (typeof syncFxUniforms === 'function') syncFxUniforms();
        if (typeof saveLyricLayout === 'function') saveLyricLayout();
      }

      if (request.backgroundMode === 'auto') {
        if (typeof setCustomBackgroundCoverMode !== 'function') return toolError('DIY_NOT_READY', '背景颜色控制尚未加载完成');
        setCustomBackgroundCoverMode(true);
        changes.push('背景颜色：随歌曲');
      } else if (request.backgroundColor || request.backgroundMode === 'custom') {
        if (typeof setCustomBackgroundColor !== 'function') return toolError('DIY_NOT_READY', '背景颜色控制尚未加载完成');
        var selectedBackground = request.backgroundColor;
        if (!selectedBackground) {
          try { selectedBackground = normalizeDiyColor(fx && fx.backgroundColor) || '#000000'; } catch (_error) { selectedBackground = '#000000'; }
        }
        setCustomBackgroundColor(selectedBackground, true, true);
        changes.push('背景颜色：' + selectedBackground.toUpperCase());
      }

      if (request.lyricColorMode === 'auto') {
        if (typeof setLyricColorAuto !== 'function') return toolError('DIY_NOT_READY', '歌词颜色控制尚未加载完成');
        setLyricColorAuto();
        changes.push('歌词颜色：随封面');
      } else if (request.lyricColor || request.lyricColorMode === 'custom') {
        if (typeof setLyricColorCustom !== 'function') return toolError('DIY_NOT_READY', '歌词颜色控制尚未加载完成');
        var selectedLyricColor = request.lyricColor;
        if (!selectedLyricColor) {
          try { selectedLyricColor = normalizeDiyColor(fx && fx.lyricColor) || '#a9b8c8'; } catch (_error) { selectedLyricColor = '#a9b8c8'; }
        }
        setLyricColorCustom(selectedLyricColor, true);
        changes.push('歌词颜色：' + selectedLyricColor.toUpperCase());
      }

      if (request.lyricFont) {
        if (typeof setLyricFont !== 'function') return toolError('DIY_NOT_READY', '歌词字体控制尚未加载完成');
        setLyricFont(request.lyricFont);
        changes.push('歌词字体：' + DIY_LYRIC_FONTS[request.lyricFont]);
      }

      if (consoleControl.present) {
        var consoleResult = applyDiyConsoleControl({
          control: consoleControl.value,
          section: options.section || options.group || '',
          operation: options.operation || options.action || 'inspect',
          value: options.value,
          valueMode: options.value_mode || options.valueMode || 'absolute',
          option: options.option,
          color: options.color
        });
        if (!consoleResult || !consoleResult.ok) return consoleResult || toolError('DIY_CONTROL_FAILED', 'DIY 控件调整失败');
        changes.push(consoleResult.message);
      }

      consoleControls.forEach(function (controlItem) {
        var consoleResult = applyDiyConsoleControl({
          control: controlItem.control || controlItem.setting,
          section: controlItem.section || controlItem.group || '',
          operation: controlItem.operation || controlItem.action || 'inspect',
          value: controlItem.value,
          valueMode: controlItem.value_mode || controlItem.valueMode || 'absolute',
          option: controlItem.option,
          color: controlItem.color
        });
        if (consoleResult && consoleResult.ok) changes.push(consoleResult.message);
        else failures.push(String(controlItem.control || controlItem.setting || 'DIY 控件'));
      });
    } catch (error) {
      return toolError('DIY_CONTROL_FAILED', error && error.message ? error.message : 'DIY 控制失败');
    }

    if (!changes.length && failures.length) {
      return toolError('DIY_CONTROL_FAILED', '未能调整：' + failures.join('、'), { failed: failures });
    }

    var resultMessage = changes.join('；');
    if (failures.length) resultMessage += '；未完成：' + failures.join('、');
    return {
      ok: true,
      partial: failures.length > 0,
      message: resultMessage,
      changed: changes,
      failed: failures,
      diy: getDiyContext(),
      requiresLogin: false
    };
  }

  function inferSharedPlaylistSource(message) {
    var text = String(message || '');
    if (/(?:小枸概念版|概念版|collection_)/i.test(text)) return 'kgc';
    if (/(?:小秋|QQ音乐|y\.qq\.com|c\.y\.qq\.com)/i.test(text)) return 'tx';
    if (/(?:小芸|网易云|music\.163\.com|163cn\.tv)/i.test(text)) return 'wy';
    if (/(?:小蜗|酷我|kuwo\.cn)/i.test(text)) return 'kw';
    if (/(?:小枸|酷狗|kugou\.com)/i.test(text)) return 'kg';
    if (/(?:小菇|咪咕|music\.migu\.cn|c\.migu\.cn)/i.test(text)) return 'mg';
    if (/(?:小绿|spotify|open\.spotify\.com)/i.test(text)) return 'sp';
    if (/(?:小水|汽水|qishui)/i.test(text)) return 'qs';
    if (/(?:小果|apple\s*music|music\.apple\.com)/i.test(text)) return 'am';
    return '';
  }

  function parseSharedPlaylistImportCommand(input) {
    var message = String(input || '').trim();
    if (!message) return null;
    var source = inferSharedPlaylistSource(message);
    var urlMatch = message.match(/https?:\/\/[^\s<>"']+/i);
    var hasImportIntent = /(?:导入|添加|解析|识别|打开|同步|歌单|playlist|songlist|collection_)/i.test(message);
    var knownShareLink = !!(urlMatch && /(?:playlist|songlist|collection_|y\.qq\.com|163\.com|163cn\.tv|kuwo\.cn|kugou\.com|migu\.cn|spotify\.com|qishui|music\.apple\.com)/i.test(urlMatch[0]));
    if (!urlMatch && !(hasImportIntent && source && /\b\d{4,}\b/.test(message))) return null;
    if (urlMatch && !hasImportIntent && !knownShareLink) return null;
    var numericId = !urlMatch && message.match(/\b\d{4,}\b/);
    return { input:urlMatch ? message : (numericId ? numericId[0] : message), source:source };
  }

  async function importSharedPlaylist(args) {
    args = args || {};
    var input = String(args.input || args.url || args.link || '').trim();
    var source = String(args.source || inferSharedPlaylistSource(input) || '').trim().toLowerCase();
    if (!input) return toolError('PLAYLIST_LINK_REQUIRED', '请发送歌单分享链接、分享文案或歌单数字 ID');
    if (typeof window.importPlatformPlaylistFromInput !== 'function') {
      return toolError('PLAYLIST_IMPORT_NOT_READY', '歌单导入功能尚未完成初始化');
    }
    try {
      var result = await window.importPlatformPlaylistFromInput(input, source, { confirmDuplicate:false, silent:true });
      if (!result || result.ok === false) return toolError('PLAYLIST_IMPORT_CANCELED', result && result.message || '歌单导入已取消');
      return {
        ok:true,
        updated:result.updated === true,
        playlist:result.playlist,
        message:result.message || '歌单已导入',
        requiresLogin:false
      };
    } catch (error) {
      var message = error && error.message || '歌单链接解析失败';
      if (/HTTP_40[13]/.test(message)) message = '平台拒绝访问，请换公开歌单或稍后重试';
      else if (/abort|timeout/i.test(message)) message = '读取超时，请检查网络后重试';
      else if (/getaddrinfo|ENOTFOUND|EAI_AGAIN|DNS/i.test(message)) message = '无法连接歌单平台，请检查网络或 DNS 后重试';
      return toolError('PLAYLIST_IMPORT_FAILED', message);
    }
  }

  function triggerWorldPeaceEasterEgg() {
    if (typeof window.playWorldPeaceEasterEgg !== 'function') {
      return toolError('WORLD_PEACE_EASTER_EGG_NOT_READY', '世界和平彩蛋尚未加载完成，请重启 Mineradio 后再试');
    }
    try {
      var result = window.playWorldPeaceEasterEgg();
      if (result && result.ok === false) return result;
      return Object.assign({
        ok: true,
        active: true,
        message: '已触发世界和平彩蛋',
        requiresLogin: false
      }, result || {});
    } catch (error) {
      return toolError('WORLD_PEACE_EASTER_EGG_FAILED', error && error.message ? error.message : '世界和平彩蛋触发失败');
    }
  }

  function getCapabilities() {
    return {
      name: 'Mineradio music tools',
      authMode: 'imported-lx-source',
      requiresLogin: false,
      searchSources: DEFAULT_SOURCES.slice(),
      tools: ['search_music', 'play_music', 'search_and_play_music', 'replay_current_music', 'set_volume', 'control_playback', 'skip_track', 'set_play_mode', 'control_audio_quality', 'open_music_source_manager', 'open_mineradio_interface', 'control_mineradio_app', 'control_lyric_animation', 'trigger_world_peace_easter_egg', 'open_music_library', 'open_lyric_animation_settings', 'search_and_queue_music', 'add_playlist_to_queue', 'seek_playback', 'save_music_to_playlist', 'create_local_playlist', 'build_recommended_playlist', 'save_pending_recommended_playlist', 'discard_pending_recommended_playlist', 'import_shared_playlist', 'control_diy_visual', 'get_player_context']
    };
  }

  window.MineradioAgentMusicTools = {
    search_music: searchMusic,
    play_music: playMusic,
    search_and_play_music: searchAndPlayMusic,
    searchMusic: searchMusic,
    playMusic: playMusic,
    searchAndPlayMusic: searchAndPlayMusic,
    replay_current_music: replayCurrentMusic,
    replayCurrentMusic: replayCurrentMusic,
    set_volume: setPlayerVolume,
    setVolume: setPlayerVolume,
    control_playback: controlPlayback,
    controlPlayback: controlPlayback,
    skip_track: skipTrack,
    skipTrack: skipTrack,
    set_play_mode: setPlayMode,
    setPlayMode: setPlayMode,
    control_audio_quality: controlAudioQuality,
    controlAudioQuality: controlAudioQuality,
    open_music_source_manager: openMusicSourceManager,
    openMusicSourceManager: openMusicSourceManager,
    open_music_library: openMusicLibrary,
    openMusicLibrary: openMusicLibrary,
    open_lyric_animation_settings: openLyricAnimationSettings,
    openLyricAnimationSettings: openLyricAnimationSettings,
    open_mineradio_interface: openMineradioInterface,
    openMineradioInterface: openMineradioInterface,
    control_mineradio_app: controlMineradioApp,
    controlMineradioApp: controlMineradioApp,
    control_lyric_animation: controlLyricAnimation,
    controlLyricAnimation: controlLyricAnimation,
    trigger_world_peace_easter_egg: triggerWorldPeaceEasterEgg,
    triggerWorldPeaceEasterEgg: triggerWorldPeaceEasterEgg,
    search_and_queue_music: searchAndQueueMusic,
    searchAndQueueMusic: searchAndQueueMusic,
    add_playlist_to_queue: addPlaylistToQueue,
    addPlaylistToQueue: addPlaylistToQueue,
    seek_playback: seekPlayback,
    seekPlayback: seekPlayback,
    save_music_to_playlist: saveMusicToPlaylist,
    saveMusicToPlaylist: saveMusicToPlaylist,
    create_local_playlist: createLocalPlaylist,
    createLocalPlaylist: createLocalPlaylist,
    build_recommended_playlist: buildRecommendedPlaylist,
    buildRecommendedPlaylist: buildRecommendedPlaylist,
    save_pending_recommended_playlist: savePendingRecommendedPlaylist,
    savePendingRecommendedPlaylist: savePendingRecommendedPlaylist,
    discard_pending_recommended_playlist: discardPendingRecommendedPlaylist,
    discardPendingRecommendedPlaylist: discardPendingRecommendedPlaylist,
    import_shared_playlist: importSharedPlaylist,
    importSharedPlaylist: importSharedPlaylist,
    parse_shared_playlist_import_command: parseSharedPlaylistImportCommand,
    parseSharedPlaylistImportCommand: parseSharedPlaylistImportCommand,
    control_diy_visual: controlDiyVisual,
    controlDiyVisual: controlDiyVisual,
    parse_local_diy_command: parseLocalDiyCommand,
    parseLocalDiyCommand: parseLocalDiyCommand,
    get_player_context: getPlayerContext,
    getPlayerContext: getPlayerContext,
    importedSourceStatus: importedSourceStatus,
    getCapabilities: getCapabilities,
    getLastSearch: function () { return lastSearch; }
  };
})();
