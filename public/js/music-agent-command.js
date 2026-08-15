'use strict';

(function installMusicAgentCommand() {
  var panel = null;
  var input = null;
  var submitButton = null;
  var voiceButton = null;
  var status = null;
  var pet = null;
  var card = null;
  var chatLog = null;
  var settingsForm = null;
  var settingsHint = null;
  var modeBadge = null;
  var busy = false;
  var thinkingMessage = null;
  var messageTypingQueue = Promise.resolve();
  var chatFocusTimers = [];
  var chatFocusRequestId = 0;
  var dragState = null;
  var dialogDragState = null;
  var dialogResizeState = null;
  var dialogLayout = null;
  var dialogLayoutRestored = false;
  var speechRecognition = null;
  var voiceListening = false;
  var voiceInputPrefix = '';
  var voiceRequestSerial = 0;
  var voiceMediaRecorder = null;
  var voiceMediaStream = null;
  var voiceAudioChunks = [];
  var voiceStopTimer = null;
  var voicePlaybackIsolated = false;
  var voiceAudioContext = null;
  var voiceMonitorFrame = 0;
  var voiceProcessing = false;
  var pendingRecommendedPlaylist = null;
  var pendingSharedPlaylistImport = false;
  var chatHistoryRestored = false;
  var agentConfig = null;
  var chatHistory = [];
  var currentView = 'chat';
  var petVisible = true;
  var PET_POSITION_KEY = 'mineradio-music-agent-pet-position-v1';
  var PET_VISIBILITY_KEY = 'mineradio-music-agent-pet-visible-v1';
  var DIALOG_LAYOUT_KEY = 'mineradio-music-agent-dialog-layout-v1';
  var CHAT_HISTORY_KEY = 'mineradio-music-agent-chat-history-v1';
  var CHAT_HISTORY_LIMIT = 40;
  var AGENT_MAX_STEPS = 30;
  var DAILY_RECOMMENDATIONS = [
    ['晴天', '周杰伦'], ['遇见', '孙燕姿'], ['十年', '陈奕迅'], ['江南', '林俊杰'],
    ['小幸运', '田馥甄'], ['后来', '刘若英'], ['夜空中最亮的星', '逃跑计划'], ['平凡之路', '朴树'],
    ['修炼爱情', '林俊杰'], ['七里香', '周杰伦'], ['红豆', '王菲'], ['光年之外', '邓紫棋'],
    ['爱你', '王心凌'], ['如果这就是爱情', '张靓颖'], ['慢冷', '梁静茹'], ['这世界那么多人', '莫文蔚'],
    ['海阔天空', 'Beyond'], ['Beautiful Love', '蔡健雅'], ['唯一', '告五人'], ['刻在我心底的名字', '卢广仲'],
    ['Free Loop', 'Daniel Powter'], ['Hotel California', 'Eagles'], ['Yellow', 'Coldplay'], ['Perfect', 'Ed Sheeran'],
    ['Blinding Lights', 'The Weeknd'], ['Love Story', 'Taylor Swift'], ['Counting Stars', 'OneRepublic'], ['Viva La Vida', 'Coldplay']
  ];
  var PROVIDER_DEFAULTS = {
    openai: { baseUrl: 'https://api.openai.com/v1', model: '例如：gpt-5.6-luna' },
    anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: '例如：claude-…' },
    gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: '例如：gemini-3.6-flash' },
    deepseek: { baseUrl: 'https://api.deepseek.com', model: '例如：deepseek-v4-flash' },
    qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: '例如：qwen3.8-max' },
    kimi: { baseUrl: 'https://api.moonshot.cn/v1', model: '例如：kimi-k3' },
    ollama: { baseUrl: 'http://127.0.0.1:11434/v1', model: '例如：qwen3:8b' },
    custom: { baseUrl: 'https://api.openai.com/v1', model: '填写服务商提供的模型 ID' }
  };
  var PROVIDER_API_PORTALS = {
    openai: { name: 'OpenAI', url: 'https://platform.openai.com/api-keys' },
    anthropic: { name: 'Claude', url: 'https://platform.claude.com/settings/keys' },
    gemini: { name: 'Gemini', url: 'https://aistudio.google.com/apikey' },
    deepseek: { name: 'DeepSeek', url: 'https://platform.deepseek.com/api_keys' },
    qwen: { name: '千问', url: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key' },
    kimi: { name: 'Kimi', url: 'https://platform.kimi.com/console/api-keys' }
  };
  var PROVIDER_MODELS = {
    openai: [
      { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna（轻量）' },
      { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra（均衡）' },
      { value: 'gpt-5.6', label: 'GPT-5.6（旗舰）' }
    ],
    anthropic: [
      { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5（快速）' },
      { value: 'claude-sonnet-5', label: 'Claude Sonnet 5（均衡）' },
      { value: 'claude-opus-5', label: 'Claude Opus 5（高性能）' },
      { value: 'claude-fable-5', label: 'Claude Fable 5（最强）' }
    ],
    gemini: [
      { value: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash（推荐）' },
      { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite（轻量）' }
    ],
    deepseek: [
      { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash（推荐）' },
      { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro（高性能）' }
    ],
    qwen: [
      { value: 'qwen3.8-max', label: '千问 3.8 Max（旗舰）' },
      { value: 'qwen3.7-plus', label: '千问 3.7 Plus（推荐）' },
      { value: 'qwen3.6-flash', label: '千问 3.6 Flash（快速）' },
      { value: 'qwen-plus', label: '千问 Plus（兼容）' }
    ],
    kimi: [
      { value: 'kimi-k3', label: 'Kimi K3（旗舰推荐）' },
      { value: 'kimi-k2.6', label: 'Kimi K2.6（通用）' },
      { value: 'kimi-k2.7-code-highspeed', label: 'Kimi K2.7 Code Highspeed（编程）' }
    ],
    ollama: [
      { value: 'qwen3:8b', label: 'Qwen 3 8B' },
      { value: 'gpt-oss:20b', label: 'GPT-OSS 20B' }
    ],
    custom: []
  };

  function cleanPart(value) {
    return String(value || '').replace(/^[\s“”'"《》]+|[\s。！!？?，,“”'"《》]+$/g, '').trim();
  }

  function normalizeXiaoMName(value) {
    return [String.fromCodePoint(30719, 28789), String.fromCodePoint(31014, 38728)]
      .reduce(function (text, legacyName) { return text.split(legacyName).join('小M'); }, String(value == null ? '' : value));
  }

  function isWorldPeaceEasterEggIntent(message) {
    var text = String(message || '').trim()
      .replace(/^(?:请|麻烦)?(?:你)?(?:帮我|给我)?\s*/, '')
      .replace(/^(?:对|跟|和)?\s*(?:嘿[,，]?\s*)?(?:ai|AI|小助手|助手|小\s*M)[,，:\s]*(?:说)?\s*/i, '')
      .replace(/[\s。！!？?，,、：“”'"《》]/g, '');
    return text === String.fromCodePoint(19990, 30028, 21644, 24179);
  }

  function dailyRecommendation() {
    var now = new Date();
    var dayNumber = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
    var selected = DAILY_RECOMMENDATIONS[Math.abs(dayNumber) % DAILY_RECOMMENDATIONS.length];
    return { title: selected[0], artist: selected[1], command: '播放' + selected[1] + '的' + selected[0] };
  }

  function updateDailyRecommendationExample() {
    if (!panel) return;
    var button = panel.querySelector('[data-agent-daily-recommendation]');
    if (!button) return;
    var recommendation = dailyRecommendation();
    button.textContent = '试着对我说：播放《' + recommendation.title + '》';
    button.setAttribute('data-agent-example', recommendation.command);
    button.title = '播放 ' + recommendation.title + ' · ' + recommendation.artist + '（每天更新）';
  }

  function parseMusicCommand(command) {
    var original = String(command || '').trim();
    var text = original
      .replace(/^(?:嘿[,，]?\s*)?(?:ai|AI|小助手|助手|小M)[,，]?\s*/i, '')
      .replace(/^(?:请|麻烦)?(?:你)?(?:帮我)?\s*/, '')
      .trim();
    var patterns = [
      /^(?:播放|放|来一首|我想听|想听|听)(.+?)的[《“"]?(.+?)[》”"]?$/,
      /^(?:播放|放|来一首|我想听|想听|听)[《“"]?(.+?)[》”"]?\s*[-—–]\s*(.+)$/
    ];
    var match = patterns[0].exec(text);
    if (match) {
      return { action: 'search_and_play_music', artist: cleanPart(match[1]), title: cleanPart(match[2]), query: cleanPart(match[1]) + ' ' + cleanPart(match[2]), original: original };
    }
    match = patterns[1].exec(text);
    if (match) {
      return { action: 'search_and_play_music', title: cleanPart(match[1]), artist: cleanPart(match[2]), query: cleanPart(match[1]) + ' ' + cleanPart(match[2]), original: original };
    }
    text = text.replace(/^(?:播放|放|来一首|我想听|想听|听)\s*/, '').trim();
    return { action: 'search_and_play_music', query: cleanPart(text), original: original };
  }

  function isMusicIntent(message) {
    return /(?:播放|放(?:一首|点|一下)?|想听|听首|来一首|找.{0,12}(?:歌|音乐)|歌曲|音乐)|\b(?:play|listen to)\b/i.test(String(message || ''));
  }

  function isReplayIntent(message) {
    return /(?:再放一遍|再播一遍|重新播放|重播|从头播放|从头再来)|\b(?:replay|restart (?:this|the) song|play it again)\b/i.test(String(message || ''));
  }

  function isVolumeIntent(message) {
    return /(?:音量|声音.{0,6}(?:大|小|高|低|静)|静音|取消静音)|\b(?:volume|mute|unmute|louder|quieter)\b/i.test(String(message || ''));
  }

  function playbackActionFromCommand(message) {
    var text = String(message || '').trim();
    if (/(?:暂停|先停一下|停一下|暂停播放)|\bpause\b/i.test(text)) return 'pause';
    if (/^(?:请|帮我|麻烦)?\s*(?:继续播放|恢复播放|接着播放|继续|恢复)(?:当前歌曲|这首歌|音乐)?[。！!]?$/i.test(text)
        || /\b(?:resume|continue playing)\b/i.test(text)) return 'play';
    return '';
  }

  function isPlaybackControlIntent(message) {
    return !!playbackActionFromCommand(message);
  }

  function trackDirectionFromCommand(message) {
    var text = String(message || '').trim();
    if (/(?:上一首|上首|前一首|回到上一首|返回上一首)|\b(?:previous|prev)(?:\s+(?:song|track))?\b/i.test(text)) return 'previous';
    if (/(?:下一首|下首|换一首|换首|跳过(?:这|当前)?首|切到下一首)|\b(?:next|skip)(?:\s+(?:song|track))?\b/i.test(text)) return 'next';
    return '';
  }

  function isTrackSkipIntent(message) {
    return !!trackDirectionFromCommand(message);
  }

  function playModeFromCommand(message) {
    var text = String(message || '').trim();
    if (/(?:取消|关闭|不要)(?:随机播放|随机模式)|(?:顺序播放|顺序循环|列表循环|正常顺序)|\b(?:loop|ordered play)\b/i.test(text)) return 'loop';
    if (/(?:随机播放|随机模式|打乱播放)|\bshuffle\b/i.test(text)) return 'shuffle';
    if (/(?:单曲循环|循环这首|只循环这首|重复当前歌曲)|\b(?:single repeat|repeat one)\b/i.test(text)) return 'single';
    if (/(?:心动模式|心动播放|开启心动)|\bheart mode\b/i.test(text)) return 'heart';
    return '';
  }

  function isPlayModeIntent(message) {
    return !!playModeFromCommand(message);
  }

  function audioQualityRequestFromCommand(message) {
    var text = String(message || '');
    var quality = '';
    if (/(?:超清母带|母带|jymaster|master)/i.test(text)) quality = 'jymaster';
    else if (/(?:hi[\s-]?res|高清臻音|臻音)/i.test(text)) quality = 'hires';
    else if (/(?:无损|flac|\bSQ\b)/i.test(text)) quality = 'lossless';
    else if (/(?:320\s*k|极高|\bHQ\b)/i.test(text)) quality = 'exhigh';
    else if (/(?:128\s*k|标准音质|普通音质)/i.test(text)) quality = 'standard';
    return quality ? { action: 'set', quality: quality } : { action: 'open' };
  }

  function isAudioQualityIntent(message) {
    return /(?:音质|无损|超清母带|高清臻音|hi[\s-]?res|flac|(?:128|320)\s*k)|\b(?:audio quality)\b/i.test(String(message || ''));
  }

  function isSourceManagerIntent(message) {
    var text = String(message || '');
    if (/(?:导入|添加).{0,8}音源|音源.{0,8}(?:导入|添加)/i.test(text)) return false;
    return /(?:打开|进入|显示|查看).{0,8}(?:音源|音源管理)|(?:音源管理|音源设置).{0,8}(?:打开|进入|显示|查看)?/i.test(text);
  }

  function mineradioInterfaceFromCommand(message) {
    var text = String(message || '').trim()
      .replace(/^(?:请|麻烦)?(?:你)?(?:帮我|给我)?\s*/, '')
      .replace(/[。！!？?]+$/g, '');
    var hasOpenAction = /(?:打开|进入|显示|查看|调出|展开|去|前往|导入|选择)/.test(text);
    function matches(target) {
      return hasOpenAction || new RegExp('^' + target + '(?:界面|页面|设置)?$').test(text);
    }
    if (/(?:歌词动画).*(?:漂浮|柔滑|玻璃|线光|故障|流光|心象|云阶|浮名|群唱|倾诉|莫奈|关闭)/.test(text)) return '';
    if (/(?:音乐库|本地音乐库)/.test(text) && matches('(?:音乐库|本地音乐库)')) return 'library';
    if (/(?:音乐电台|电台模式|听歌模式)/.test(text) && matches('(?:音乐电台|电台模式|听歌模式)')) return 'radio';
    if (/(?:各平台排行榜|平台排行榜|排行榜|热歌榜|热榜)/.test(text) && matches('(?:各平台排行榜|平台排行榜|排行榜|热歌榜|热榜)')) return 'ranking';
    if (/(?:歌词动画)/.test(text) && matches('歌词动画')) return 'lyric_animation';
    if (/(?:视觉控制台|视觉面板|DIY控制台|DIY面板)/i.test(text) && matches('(?:视觉控制台|视觉面板|DIY控制台|DIY面板)')) return 'visual_console';
    if (/(?:高级设置|高级面板|高级参数)/.test(text) && matches('(?:高级设置|高级面板|高级参数)')) return 'advanced_settings';
    if (/(?:热键设置|快捷键设置|热键面板)/.test(text) && matches('(?:热键设置|快捷键设置|热键面板)')) return 'hotkeys';
    if (/(?:输出接口|音频输出|输出设备)/.test(text) && matches('(?:输出接口|音频输出|输出设备)')) return 'audio_output';
    if (/(?:壁纸选择|壁纸库|壁纸面板)/.test(text) && matches('(?:壁纸选择|壁纸库|壁纸面板)')) return 'wallpaper';
    if (/(?:检查更新|更新界面|更新面板)/.test(text) && matches('(?:检查更新|更新界面|更新面板)')) return 'update';
    if (/(?:遥控器|远程控制)/.test(text) && matches('(?:遥控器|远程控制)')) return 'remote_control';
    if (/(?:音乐星球)/.test(text) && matches('音乐星球')) return 'music_planet';
    if (/(?:歌曲详情|歌曲信息)/.test(text) && matches('(?:歌曲详情|歌曲信息)')) return 'song_details';
    if (/(?:歌手详情|歌手信息|艺人详情)/.test(text) && matches('(?:歌手详情|歌手信息|艺人详情)')) return 'artist_details';
    if (/(?:收藏界面|收藏面板|加入歌单界面)/.test(text) && matches('(?:收藏界面|收藏面板|加入歌单界面)')) return 'collect';
    if (/(?:当前队列|播放队列|队列面板|打开队列|查看队列)/.test(text) && matches('(?:当前队列|播放队列|队列面板|队列)')) return 'current_queue';
    if ((/(?:歌单面板|我的歌单)/.test(text) && matches('(?:歌单面板|我的歌单)')) || /^(?:打开|查看|显示)歌单$/.test(text)) return 'playlist_panel';
    if (/(?:搜索界面|全局搜索|搜索框)/.test(text) && matches('(?:搜索界面|全局搜索|搜索框)')) return 'global_search';
    if (/(?:倍速与音调|倍速面板|音调面板|打开倍速|查看倍速)/.test(text) && matches('(?:倍速与音调|倍速面板|音调面板|倍速)')) return 'playback_tuning';
    if (/(?:音量面板|音量控制|打开音量|查看音量)/.test(text) && matches('(?:音量面板|音量控制|音量)')) return 'volume_panel';
    if (/(?:落雪歌单文件|lxmc|落雪歌单导入)/i.test(text) && matches('(?:落雪歌单文件|lxmc|落雪歌单导入)')) return 'lx_playlist_import';
    if (/(?:歌单导入|导入歌单界面|平台歌单导入)/.test(text) && matches('(?:歌单导入|导入歌单界面|平台歌单导入)')) return 'playlist_import';
    if (/(?:主页歌单选择|选择主页歌单|选择歌单)/.test(text) && matches('(?:主页歌单选择|选择主页歌单|选择歌单)')) return 'playlist_selection';
    if (/(?:导入音源|音源文件导入|添加音源)/.test(text) && matches('(?:导入音源|音源文件导入|添加音源)')) return 'source_import';
    if (/(?:导入本地音乐文件|导入本地文件|本地文件导入)/.test(text) && matches('(?:导入本地音乐文件|导入本地文件|本地文件导入)')) return 'local_file_import';
    if (/(?:导入本地音乐文件夹|导入文件夹|文件夹导入|本地文件夹导入|导入本地音乐)/.test(text) && matches('(?:导入本地音乐文件夹|导入文件夹|文件夹导入|本地文件夹导入|导入本地音乐)')) return 'local_folder_import';
    if (/(?:自定义歌词|歌词编辑|编辑歌词)/.test(text) && matches('(?:自定义歌词|歌词编辑|编辑歌词)')) return 'custom_lyrics';
    if (/(?:每日热评|热评管理)/.test(text) && matches('(?:每日热评|热评管理)')) return 'daily_review';
    if (/(?:听歌偏好|偏好画像|听歌画像)/.test(text) && matches('(?:听歌偏好|偏好画像|听歌画像)')) return 'listening_insight';
    if (/(?:使用引导|新手引导|功能引导)/.test(text) && matches('(?:使用引导|新手引导|功能引导)')) return 'visual_guide';
    if (/(?:作者支持|支持作者)/.test(text) && matches('(?:作者支持|支持作者)')) return 'author_support';
    if (/(?:本曲鼓点分析|鼓点分析)/.test(text) && matches('(?:本曲鼓点分析|鼓点分析)')) return 'beat_analysis';
    if (/(?:首页|主页)/.test(text) && matches('(?:首页|主页)')) return 'home';
    return '';
  }

  function isMineradioInterfaceIntent(message) {
    return !!mineradioInterfaceFromCommand(message);
  }

  function lyricAnimationRequestFromCommand(message) {
    var text = String(message || '').trim()
      .replace(/^(?:请|麻烦)?(?:你)?(?:帮我|给我)?\s*/, '')
      .replace(/[。！!？?]+$/g, '');
    var modes = [
      ['monet', '莫奈'], ['cappella', '群唱'], ['partita', '云阶'], ['cadenza', '心象'],
      ['classic', '流光'], ['fume', '浮名'], ['tilt', '倾诉'],
      ['smooth', '柔滑'], ['glass', '玻璃'], ['shine', '线光'], ['glitch', '故障'], ['float', '漂浮']
    ];
    var hasAnimationContext = /(?:歌词|动画|效果|切换|改成|换成|设为|模式|新歌词)/.test(text);
    for (var i = 0; i < modes.length; i++) {
      if (text === modes[i][1] || (hasAnimationContext && text.indexOf(modes[i][1]) >= 0)) return { mode:modes[i][0] };
    }
    if (/(?:关闭|关掉|停用|取消).{0,5}(?:歌词动画|歌词效果)|(?:歌词动画|歌词效果).{0,5}(?:关闭|关掉|停用|取消)/.test(text)) return { mode:'off' };
    return null;
  }

  function isLyricAnimationControlIntent(message) {
    return !!lyricAnimationRequestFromCommand(message);
  }

  function mineradioAppControlFromCommand(message) {
    var text = String(message || '').trim();
    var match = /(?:倍速|播放速度).{0,8}?(\d+(?:\.\d+)?)\s*(?:倍|x|×)?/i.exec(text)
      || /(\d+(?:\.\d+)?)\s*(?:倍|x|×).{0,8}(?:倍速|播放)/i.exec(text);
    if (match) return { target:'playback_speed', operation:'set', value:Number(match[1]) };
    if (/(?:播放|倍速).{0,5}(?:快一点|加快|提高)|(?:快一点|加快).{0,5}(?:播放|倍速)/.test(text)) {
      var fasterContext = playerContext();
      var fasterCurrent = fasterContext && fasterContext.app ? Number(fasterContext.app.playbackSpeed) : 1;
      return { target:'playback_speed', operation:'set', value:Math.min(2, Math.round((fasterCurrent + 0.1) * 20) / 20) };
    }
    if (/(?:播放|倍速).{0,5}(?:慢一点|减慢|降低)|(?:慢一点|减慢).{0,5}(?:播放|倍速)/.test(text)) {
      var slowerContext = playerContext();
      var slowerCurrent = slowerContext && slowerContext.app ? Number(slowerContext.app.playbackSpeed) : 1;
      return { target:'playback_speed', operation:'set', value:Math.max(0.5, Math.round((slowerCurrent - 0.1) * 20) / 20) };
    }
    match = /(?:音调|升调|降调).{0,8}?([+-]?\d+)\s*(?:半音)?/.exec(text);
    if (match) {
      var pitch = Number(match[1]);
      if (/降调/.test(text) && pitch > 0) pitch = -pitch;
      return { target:'playback_pitch', operation:'set', value:pitch };
    }
    if (/(?:升调|音调升高).{0,4}(?:一点)?/.test(text)) {
      var pitchUpContext = playerContext();
      var pitchUpCurrent = pitchUpContext && pitchUpContext.app ? Number(pitchUpContext.app.playbackPitch) : 0;
      return { target:'playback_pitch', operation:'set', value:Math.min(12, pitchUpCurrent + 1) };
    }
    if (/(?:降调|音调降低).{0,4}(?:一点)?/.test(text)) {
      var pitchDownContext = playerContext();
      var pitchDownCurrent = pitchDownContext && pitchDownContext.app ? Number(pitchDownContext.app.playbackPitch) : 0;
      return { target:'playback_pitch', operation:'set', value:Math.max(-12, pitchDownCurrent - 1) };
    }
    if (/(?:重置|恢复默认).{0,8}(?:倍速|音调)|(?:倍速|音调).{0,8}(?:重置|恢复默认)/.test(text)) return { target:'playback_tuning', operation:'reset' };
    function enabledFromText() { return !/(?:关闭|退出|取消|停用|禁用|不要)/.test(text); }
    if (/(?:进入|打开|开启|退出|关闭).{0,5}全屏|全屏.{0,5}(?:模式|打开|开启|退出|关闭)/.test(text)) return { target:'fullscreen', operation:'set', enabled:enabledFromText() };
    if (/(?:打开|开启|进入|关闭|退出).{0,5}(?:全沉浸|沉浸模式)|(?:全沉浸|沉浸模式).{0,5}(?:打开|开启|关闭|退出)/.test(text)) return { target:'immersive', operation:'set', enabled:enabledFromText() };
    if (/(?:打开|开启|显示|关闭|隐藏).{0,5}(?:窗口内歌词|窗口歌词)|(?:窗口内歌词|窗口歌词).{0,5}(?:打开|开启|显示|关闭|隐藏)/.test(text)) return { target:'window_lyrics', operation:'set', enabled:enabledFromText() };
    if (/^(?:打开|开启|显示|关闭|隐藏)歌词$/.test(text)) return { target:'window_lyrics', operation:'set', enabled:enabledFromText() };
    if (/(?:打开|开启|关闭|退出).{0,5}(?:DIY|玩家模式)|(?:DIY|玩家模式).{0,5}(?:打开|开启|关闭|退出)/i.test(text)) return { target:'diy_mode', operation:'set', enabled:enabledFromText() };
    if (/(?:打开|开启|关闭|取消).{0,5}控制条自动隐藏|控制条自动隐藏.{0,5}(?:打开|开启|关闭|取消)/.test(text)) return { target:'controls_auto_hide', operation:'set', enabled:enabledFromText() };
    if (/(?:打开|开启|关闭|取消).{0,5}(?:顶部导航|导航栏)自动隐藏|(?:顶部导航|导航栏)自动隐藏.{0,5}(?:打开|开启|关闭|取消)/.test(text)) return { target:'navigation_auto_hide', operation:'set', enabled:enabledFromText() };
    if (/(?:打开|开启|关闭).{0,5}(?:软件界面动画|界面动画)|(?:软件界面动画|界面动画).{0,5}(?:打开|开启|关闭)/.test(text)) return { target:'interface_motion', operation:'set', enabled:enabledFromText() };
    if (/(?:打开|开启|关闭|取消).{0,5}视觉控制台自动隐藏|视觉控制台自动隐藏.{0,5}(?:打开|开启|关闭|取消)/.test(text)) return { target:'visual_console_auto_hide', operation:'set', enabled:enabledFromText() };
    if (/(?:打开|开启|关闭|取消).{0,5}壁纸镜像|壁纸镜像.{0,5}(?:打开|开启|关闭|取消)/.test(text)) return { target:'wallpaper_mirror', operation:'set', enabled:enabledFromText() };
    if (/(?:随机打乱|打乱).{0,5}(?:播放)?队列|(?:播放)?队列.{0,5}(?:随机打乱|打乱)/.test(text)) return { target:'queue_shuffle', operation:'run' };
    if (/(?:清空|全部清除).{0,5}(?:播放)?队列/.test(text)) return { target:'queue_clear', operation:'clear', confirmed:true };
    if (/(?:播放|搜索|查找).{0,5}(?:当前歌曲|这首歌)?伴奏|伴奏版/.test(text)) return { target:'backing_track', operation:'run' };
    if (/(?:压缩|释放).{0,5}(?:播放器|应用)内存/.test(text)) return { target:'app_memory_trim', operation:'run' };
    if (/(?:释放|清理).{0,5}系统内存/.test(text)) return { target:'system_memory_trim', operation:'run' };
    if (/(?:重置|恢复默认).{0,5}(?:视觉设置|视觉效果|DIY设置)/i.test(text)) return { target:'visual_settings_reset', operation:'reset', confirmed:true };
    if (/(?:最小化)(?:Mineradio|播放器|软件|应用|窗口)?/i.test(text)) return { target:'window_minimize', operation:'run' };
    if (/(?:关闭|退出)(?:Mineradio|播放器|软件|应用)(?:程序)?$/i.test(text)) return { target:'window_close', operation:'run', confirmed:true };
    return null;
  }

  function isMineradioAppControlIntent(message) {
    return !!mineradioAppControlFromCommand(message);
  }

  function isDiyControlIntent(message) {
    return /(?:\bDIY\b|玩家模式|视觉预设|智能声境|律动强度|立体感|背景颜色|歌词颜色|歌词字体|音域回响|霓虹雨夜|纯净舞台)/i.test(String(message || ''));
  }

  function queueMusicRequestFromCommand(message) {
    var text = String(message || '').trim()
      .replace(/^(?:请|麻烦)?(?:你)?(?:帮我)?\s*/, '')
      .replace(/^(?:把|将)\s*/, '');
    var position = /(?:设为|设置为|排到)?下一首|下一首播放/.test(text) ? 'next' : 'end';
    text = text
      .replace(/^(?:下一首播放|把|将)\s*/, '')
      .replace(/\s*(?:设为|设置为|排到)?下一首(?:播放)?\s*[。！!]?$/g, '')
      .replace(/\s*(?:加入|加到|放进)(?:播放)?队列(?:末尾)?\s*[。！!]?$/g, '')
      .trim();
    var parsed = parseMusicCommand('播放' + text);
    parsed.action = 'search_and_queue_music';
    parsed.position = position;
    return parsed;
  }

  function isQueueMusicIntent(message) {
    return /(?:加入|加到|放进)(?:播放)?队列|(?:设为|设置为|排到)下一首|下一首播放/i.test(String(message || ''));
  }

  function playlistQueueRequestFromCommand(message) {
    var text = String(message || '').trim();
    var name = '';
    var match = /(?:把|将)\s*[《“"]?(.{1,40}?)[》”"]?\s*(?:这个|这张|整个|整张)?歌单/.exec(text)
      || /(?:名为|叫作|叫)\s*[《“"]?(.{1,40}?)[》”"]?\s*(?:的)?歌单/.exec(text);
    if (match) name = cleanPart(match[1]).replace(/^(?:这个|这张|整个|整张)$/, '');
    return {
      playlist_name: name,
      position: /(?:下一首之后|接下来|排在当前歌曲后|插到前面)/.test(text) ? 'next' : 'end'
    };
  }

  function isPlaylistQueueIntent(message) {
    var text = String(message || '');
    return /(?:把|将)?.{0,45}(?:这个|这张|整个|整张|全部|所有)?.{0,8}歌单.{0,24}(?:全部|所有|整张|整个|都)?.{0,8}(?:加入|加到|放进|排进).{0,8}(?:当前|播放)?队列/.test(text)
      || /(?:歌单).{0,20}(?:全部|所有|都).{0,12}(?:加到|加入|放进).{0,8}当前/.test(text);
  }

  function seekRequestFromCommand(message) {
    var text = String(message || '').trim();
    if (!/(?:跳到|快进|往后|后退|倒退|进度|播放到|定位到|拖到)|\bseek\b/i.test(text)) return null;
    var context = playerContext() || {};
    var current = Number(context.progressSeconds) || 0;
    var relative = /(?:快进|往后|后退|倒退)\s*(\d+(?:\.\d+)?)\s*(秒|分钟|分)/.exec(text);
    if (relative) {
      var delta = Number(relative[1]) * (relative[2] === '秒' ? 1 : 60);
      if (/(?:后退|倒退)/.test(text)) delta = -delta;
      return { position_seconds: Math.max(0, current + delta) };
    }
    var percent = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(text);
    if (percent) return { percent: Math.max(0, Math.min(100, Number(percent[1]))) };
    if (/(?:一半|中间)/.test(text)) return { percent: 50 };
    var clock = /(\d{1,3})\s*[:：]\s*(\d{1,2})/.exec(text);
    if (clock) return { position_seconds: Number(clock[1]) * 60 + Number(clock[2]) };
    var minuteSecond = /(?:(\d+(?:\.\d+)?)\s*(?:分钟|分))?\s*(?:(\d+(?:\.\d+)?)\s*秒)?/.exec(text.replace(/^.*?(?:跳到|播放到|定位到|拖到)\s*/, ''));
    if (minuteSecond && (minuteSecond[1] || minuteSecond[2])) {
      return { position_seconds: (Number(minuteSecond[1]) || 0) * 60 + (Number(minuteSecond[2]) || 0) };
    }
    return null;
  }

  function isSeekIntent(message) {
    return !!seekRequestFromCommand(message);
  }

  function recommendedPlaylistRequestFromCommand(message) {
    var text = String(message || '').trim();
    var countMatch = /(\d{1,3})\s*首/.exec(text);
    var maxSongs = Math.max(1, Math.min(100, countMatch ? Number(countMatch[1]) : 10));
    var nameMatch = /(?:名为|叫作|叫)\s*[《“"]?(.{1,40}?)[》”"]?\s*(?:的)?歌单/.exec(text)
      || /(?:创建|生成|做)(?:一个)?\s*[《“"]?(.{1,30}?)[》”"]?\s*歌单/.exec(text);
    var name = nameMatch ? cleanPart(nameMatch[1]).replace(/的$/, '') : '小M推荐';
    if (!name || /^(?:适合|一个)$/.test(name)) name = '小M推荐';
    var excludeKeywords = [];
    if (/不要.{0,4}(?:现场|live)/i.test(text)) excludeKeywords.push('现场', 'live');
    if (/不要.{0,4}(?:DJ|混音|remix)/i.test(text)) excludeKeywords.push('DJ', 'remix');
    if (/不要.{0,4}(?:翻唱|cover)/i.test(text)) excludeKeywords.push('翻唱', 'cover');
    return {
      playlist_name: name,
      search_queries: [text.replace(/(?:创建|生成|做)(?:一个)?|歌单|\d{1,3}\s*首|然后|并且|立即播放|开始播放/g, ' ').replace(/\s+/g, ' ').trim() || text],
      max_songs: maxSongs,
      exclude_keywords: excludeKeywords,
      start_playback: /(?:然后|并且|创建后|生成后|立即|直接)?.{0,6}(?:播放|开始听)/.test(text)
    };
  }

  function isRecommendedPlaylistIntent(message) {
    var text = String(message || '');
    return /(?:推荐|适合|场景|心情|风格).{0,30}歌单|(?:创建|生成|做).{0,35}\d{1,3}\s*首|歌单.{0,24}\d{1,3}\s*首/.test(text);
  }

  function createPlaylistRequestFromCommand(message) {
    var text = String(message || '').trim();
    var match = /(?:创建|新建)(?:一个)?(?:名为|叫作|叫)?\s*[《“"]?(.{1,40}?)[》”"]?\s*(?:的)?歌单/.exec(text);
    if (!match) return null;
    return {
      name: cleanPart(match[1]),
      add_current_song: /(?:并|同时).{0,16}(?:当前歌曲|当前这首歌|这首(?:歌|歌曲)?)|(?:把|将).{0,10}(?:当前歌曲|当前这首歌|这首(?:歌|歌曲)?).{0,16}(?:加入|放进|收藏)/.test(text)
    };
  }

  function isCreatePlaylistIntent(message) {
    return !isRecommendedPlaylistIntent(message) && !!createPlaylistRequestFromCommand(message);
  }

  function savePlaylistRequestFromCommand(message) {
    var text = String(message || '').trim();
    var playlistName = '我喜欢';
    var nameMatch = /(?:收藏到|加入|加到|放进)\s*[《“"]?(.{1,40}?)[》”"]?\s*歌单/.exec(text)
      || /到\s*[《“"]?(.{1,40}?)[》”"]?\s*歌单/.exec(text);
    if (nameMatch) playlistName = cleanPart(nameMatch[1]);
    if (/我喜欢|喜欢的音乐/.test(text)) playlistName = '我喜欢';
    var request = { playlist_name: playlistName, create_if_missing: true };
    if (!/(?:当前歌曲|当前这首歌|这首(?:歌|歌曲)?)/.test(text)) {
      var songPart = text
        .replace(/^(?:请|麻烦)?(?:你)?(?:帮我)?\s*(?:把|将)?\s*/, '')
        .replace(/\s*(?:收藏到|加入|加到|放进).*$/g, '')
        .replace(/^收藏\s*/, '')
        .trim();
      if (songPart && !/^(?:歌|歌曲|音乐)$/.test(songPart)) {
        var parsed = parseMusicCommand('播放' + songPart);
        request.query = parsed.query;
        if (parsed.title) request.title = parsed.title;
        if (parsed.artist) request.artist = parsed.artist;
      }
    }
    return request;
  }

  function isSavePlaylistIntent(message) {
    if (isCreatePlaylistIntent(message)) return false;
    return /(?:收藏|喜欢)(?:当前歌曲|当前这首歌|这首(?:歌|歌曲)?)|(?:把|将).{0,40}(?:收藏到|加入|加到|放进).{0,20}歌单|(?:收藏到|加入|加到|放进).{1,20}歌单/i.test(String(message || ''));
  }

  function volumeFromCommand(message) {
    var text = String(message || '');
    var match = /(?:音量|声音)?\s*(?:调到|设置为|设为|到)?\s*(\d{1,3})\s*%?/.exec(text);
    if (match) return Math.max(0, Math.min(100, Number(match[1])));
    if (/(?:取消静音|恢复声音)|\bunmute\b/i.test(text)) {
      var unmuteContext = playerContext() || {};
      return Number(unmuteContext.volume) > 0 ? Number(unmuteContext.volume) : 50;
    }
    if (/(?:静音|关掉声音)|\bmute\b/i.test(text)) return 0;
    if (/(?:最大音量|音量最大|声音最大)/.test(text)) return 100;
    var context = playerContext() || {};
    var current = Number(context.volume);
    if (!isFinite(current)) current = 50;
    if (/(?:大一点|调大|声音大|音量大)|\blouder\b/i.test(text)) return Math.min(100, current + 10);
    if (/(?:小一点|调小|声音小|音量小)|\bquieter\b/i.test(text)) return Math.max(0, current - 10);
    return null;
  }

  function playerContext() {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.get_player_context !== 'function') return null;
    try { return tools.get_player_context(); } catch (_error) { return null; }
  }

  async function triggerWorldPeaceEasterEggFromTool() {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.trigger_world_peace_easter_egg !== 'function') {
      throw new Error('世界和平彩蛋尚未加载，请重启 Mineradio 后再试。');
    }
    var result = await tools.trigger_world_peace_easter_egg();
    if (!result || !result.ok) throw new Error(result && result.message || '世界和平彩蛋触发失败');
    setStatus('愿望已收到', 'success');
    addMessage('assistant', '愿望已收到。');
    return result;
  }

  async function requestJson(url, options) {
    var response;
    try {
      response = await fetch(url, options || {});
    } catch (_error) {
      var networkError = new Error('无法连接 Mineradio 本地服务，请重启软件后再试。');
      networkError.code = 'AGENT_LOCAL_SERVER_UNREACHABLE';
      throw networkError;
    }
    var data = {};
    try { data = await response.json(); } catch (_error) {}
    if (!response.ok || !data.ok) {
      var error = new Error(data.message || data.error || '请求失败');
      error.code = data.error || 'AGENT_REQUEST_FAILED';
      throw error;
    }
    return data;
  }

  function setStatus(message, state) {
    if (!status) return;
    setThinkingMessage(state === 'busy' && currentView === 'chat');
    status.textContent = state === 'busy' && currentView === 'chat'
      ? ''
      : (state === 'success' && currentView === 'chat' ? '' : (message || ''));
    status.className = 'music-agent-status' + (state ? ' ' + state : '');
    if (pet) {
      pet.classList.toggle('success', state === 'success');
      pet.classList.toggle('error', state === 'error');
    }
  }

  function setThinkingMessage(show) {
    if (!chatLog) return;
    if (!show) {
      if (thinkingMessage && thinkingMessage.parentNode) thinkingMessage.parentNode.removeChild(thinkingMessage);
      thinkingMessage = null;
      return;
    }
    if (thinkingMessage && thinkingMessage.parentNode === chatLog) {
      chatLog.scrollTop = chatLog.scrollHeight;
      return;
    }
    thinkingMessage = document.createElement('div');
    thinkingMessage.className = 'music-agent-message assistant thinking-indicator';
    thinkingMessage.setAttribute('aria-label', '小M正在思考');
    thinkingMessage.innerHTML = '<i></i><i></i><i></i>';
    chatLog.appendChild(thinkingMessage);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function setBusy(nextBusy) {
    busy = !!nextBusy;
    if (pet) pet.classList.toggle('thinking', busy);
    if (submitButton) {
      submitButton.disabled = busy;
      submitButton.textContent = busy ? '思考中…' : '发送';
    }
    if (input) input.disabled = busy;
    if (voiceButton) voiceButton.disabled = busy || voiceProcessing;
    if (panel) {
      var memoryButton = panel.querySelector('.music-agent-memory-clear');
      if (memoryButton) memoryButton.disabled = busy;
    }
    if (!busy) focusChatInputAfterReply();
  }

  function isEditableAgentFocusTarget(target) {
    if (!target || target === document.body || target === document.documentElement) return false;
    if (target.isContentEditable) return true;
    var tag = String(target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' ||
      (typeof target.closest === 'function' && !!target.closest('[contenteditable="true"],[role="textbox"]'));
  }

  function cancelPendingChatFocus() {
    chatFocusRequestId += 1;
    chatFocusTimers.forEach(function (timer) { window.clearTimeout(timer); });
    chatFocusTimers = [];
  }

  function requestNativeKeyboardFocus(reason) {
    var api = window.desktopWindow;
    if (!api || typeof api.requestDesktopKeyboardFocus !== 'function') {
      return Promise.resolve({ ok: true, browser: true });
    }
    try {
      return Promise.resolve(api.requestDesktopKeyboardFocus(
        'music-agent-' + String(reason || 'input').slice(0, 48)
      )).catch(function () {
        return { ok: false, error: 'DESKTOP_KEYBOARD_FOCUS_FAILED' };
      });
    } catch (_error) {
      return Promise.resolve({ ok: false, error: 'DESKTOP_KEYBOARD_FOCUS_FAILED' });
    }
  }

  function focusChatInputAfterReply() {
    if (!input || !panel || !panel.classList.contains('show') || currentView !== 'chat') return;
    cancelPendingChatFocus();
    var requestId = chatFocusRequestId;
    requestNativeKeyboardFocus('reply-complete');
    [0, 120, 420, 900].forEach(function (delay) {
      var timer = window.setTimeout(function () {
        if (requestId !== chatFocusRequestId || busy || voiceListening || voiceProcessing || currentView !== 'chat' || !panel.classList.contains('show')) return;
        var active = document.activeElement;
        // Once the user clicks another text field (for example global search),
        // delayed retries must never pull focus back into the XiaoM dialog.
        if (active && active !== input && isEditableAgentFocusTarget(active)) {
          cancelPendingChatFocus();
          return;
        }
        try { input.focus({ preventScroll: true }); } catch (_error) { input.focus(); }
        try {
          var end = input.value.length;
          input.setSelectionRange(end, end);
        } catch (_error) {}
      }, delay);
      chatFocusTimers.push(timer);
    });
  }

  function persistChatHistory() {
    try { localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(chatHistory.slice(-CHAT_HISTORY_LIMIT))); } catch (_error) {}
  }

  function restoreChatHistory() {
    if (chatHistoryRestored) return;
    chatHistoryRestored = true;
    try {
      var saved = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || '[]');
      if (!Array.isArray(saved)) return;
      chatHistory = saved.slice(-CHAT_HISTORY_LIMIT).map(function (item) {
        return {
          role: item && item.role === 'assistant' ? 'assistant' : 'user',
          content: normalizeXiaoMName(String(item && item.content || '').slice(0, 4000))
        };
      }).filter(function (item) { return item.content.trim(); });
      persistChatHistory();
    } catch (_error) { chatHistory = []; }
  }

  function clearConversationMemory() {
    cancelPendingChatFocus();
    requestNativeKeyboardFocus('memory-cleared');
    chatHistory = [];
    try { localStorage.removeItem(CHAT_HISTORY_KEY); } catch (_error) {}
    if (chatLog) chatLog.innerHTML = '';
    addMessage('assistant', '对话记忆已清除。你可以重新和我聊天，或让我控制播放器。', false);
    setStatus('对话记忆已清除', 'success');
    switchView('chat');
  }

  function updateVoiceButton() {
    if (!voiceButton) return;
    voiceButton.classList.toggle('listening', voiceListening);
    voiceButton.setAttribute('aria-pressed', voiceListening ? 'true' : 'false');
    voiceButton.setAttribute('aria-label', voiceListening ? '停止语音输入' : '语音转文字');
    voiceButton.title = voiceListening ? '停止语音输入' : '语音转文字';
  }

  function microphoneOnlyConstraints(deviceId) {
    var supported = navigator.mediaDevices && typeof navigator.mediaDevices.getSupportedConstraints === 'function'
      ? navigator.mediaDevices.getSupportedConstraints()
      : {};
    var audio = {
      channelCount: { ideal: 1 },
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true }
    };
    if (supported.voiceIsolation) audio.voiceIsolation = { ideal: true };
    if (deviceId) audio.deviceId = { exact: deviceId };
    return { audio: audio };
  }

  function isSystemLoopbackInput(label) {
    return /stereo\s*mix|立体声混音|what\s*u\s*hear|wave\s*out\s*mix|loopback|cable\s*output|扬声器\s*\(|speaker\s*\(/i.test(String(label || ''));
  }

  async function getMicrophoneOnlyStream() {
    var stream = await navigator.mediaDevices.getUserMedia(microphoneOnlyConstraints());
    var track = stream.getAudioTracks()[0];
    if (!track || !isSystemLoopbackInput(track.label)) return stream;
    var devices = typeof navigator.mediaDevices.enumerateDevices === 'function'
      ? await navigator.mediaDevices.enumerateDevices()
      : [];
    var microphone = devices.find(function (device) {
      return device.kind === 'audioinput' && device.deviceId && device.label && !isSystemLoopbackInput(device.label);
    });
    stream.getTracks().forEach(function (item) { item.stop(); });
    if (!microphone) throw new Error('当前录音设备是系统混音，请在 Windows 中选择真正的麦克风。');
    return navigator.mediaDevices.getUserMedia(microphoneOnlyConstraints(microphone.deviceId));
  }

  async function beginVoicePlaybackIsolation() {
    if (voicePlaybackIsolated) return;
    voicePlaybackIsolated = true;
    if (typeof window.beginVoiceInputIsolation === 'function') {
      await Promise.resolve(window.beginVoiceInputIsolation());
    }
  }

  function endVoicePlaybackIsolation() {
    if (!voicePlaybackIsolated) return;
    voicePlaybackIsolated = false;
    if (typeof window.endVoiceInputIsolation === 'function') window.endVoiceInputIsolation();
  }

  function stopVoiceInput() {
    voiceRequestSerial += 1;
    voiceListening = false;
    updateVoiceButton();
    if (voiceStopTimer) window.clearTimeout(voiceStopTimer);
    voiceStopTimer = null;
    if (voiceMonitorFrame) window.cancelAnimationFrame(voiceMonitorFrame);
    voiceMonitorFrame = 0;
    if (voiceAudioContext) { try { voiceAudioContext.close(); } catch (_error) {} }
    voiceAudioContext = null;
    if (voiceMediaRecorder && voiceMediaRecorder.state !== 'inactive') {
      try {
        voiceMediaRecorder.stop();
        return;
      } catch (_error) {}
    }
    if (voiceMediaStream) voiceMediaStream.getTracks().forEach(function (track) { track.stop(); });
    voiceMediaStream = null;
    endVoicePlaybackIsolation();
    requestJson('/api/agent/speech/cancel', { method: 'POST' }).catch(function () {});
    if (!speechRecognition) {
      if (status && status.classList.contains('listening')) setStatus('', '');
      return;
    }
    try { speechRecognition.stop(); } catch (_error) {}
    speechRecognition = null;
  }

  function applyVoiceTranscript(transcript) {
    var text = String(transcript || '').trim();
    if (!text) throw new Error('没有听清，请再说一次。');
    if (!input) return;
    input.value = [voiceInputPrefix, text].filter(Boolean).join(voiceInputPrefix && text ? ' ' : '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }

  async function recognizeWithWindowsSpeech(requestId) {
    await beginVoicePlaybackIsolation();
    if (requestId !== voiceRequestSerial) {
      endVoicePlaybackIsolation();
      return;
    }
    voiceListening = true;
    updateVoiceButton();
    setStatus('正在听你说话… 再点一次结束', 'listening');
    try {
      var result = await requestJson('/api/agent/speech/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeoutSeconds: 18 })
      });
      if (requestId !== voiceRequestSerial) return;
      applyVoiceTranscript(result.text);
      setStatus('', '');
    } catch (error) {
      if (requestId === voiceRequestSerial) setStatus(error && error.message ? error.message : '语音识别失败，请检查麦克风。', 'error');
    } finally {
      if (requestId === voiceRequestSerial) {
        voiceListening = false;
        updateVoiceButton();
        if (input) input.focus();
      }
      endVoicePlaybackIsolation();
    }
  }

  async function toggleVoiceInput() {
    if (busy || voiceProcessing) return;
    if (voiceListening) {
      if (voiceStopTimer) window.clearTimeout(voiceStopTimer);
      voiceStopTimer = null;
      if (voiceMediaRecorder && voiceMediaRecorder.state !== 'inactive') {
        try { voiceMediaRecorder.stop(); } catch (_error) {}
      } else {
        voiceRequestSerial += 1;
        voiceListening = false;
        updateVoiceButton();
        endVoicePlaybackIsolation();
        requestJson('/api/agent/speech/cancel', { method: 'POST' }).catch(function () {});
      }
      return;
    }
    var requestId = ++voiceRequestSerial;
    voiceInputPrefix = String(input && input.value || '').trim();
    try {
      var speechCapabilities = null;
      try { speechCapabilities = await requestJson('/api/agent/speech/capabilities'); } catch (_error) {}
      if (speechCapabilities && speechCapabilities.whisperAvailable === false && speechCapabilities.windowsSpeechAvailable) {
        await recognizeWithWindowsSpeech(requestId);
        return;
      }
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function' || typeof MediaRecorder !== 'function') {
        throw new Error('当前环境不能录音，请检查麦克风权限。');
      }
      voiceMediaStream = await getMicrophoneOnlyStream();
      if (requestId !== voiceRequestSerial) {
        voiceMediaStream.getTracks().forEach(function (track) { track.stop(); });
        voiceMediaStream = null;
        return;
      }
      await beginVoicePlaybackIsolation();
      if (requestId !== voiceRequestSerial) {
        voiceMediaStream.getTracks().forEach(function (track) { track.stop(); });
        voiceMediaStream = null;
        endVoicePlaybackIsolation();
        return;
      }
      var mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(function (type) {
        return MediaRecorder.isTypeSupported(type);
      });
      voiceAudioChunks = [];
      voiceMediaRecorder = mimeType ? new MediaRecorder(voiceMediaStream, { mimeType: mimeType }) : new MediaRecorder(voiceMediaStream);
      voiceMediaRecorder.addEventListener('dataavailable', function (event) { if (event.data && event.data.size) voiceAudioChunks.push(event.data); });
      voiceMediaRecorder.addEventListener('stop', async function () {
        var recorder = voiceMediaRecorder;
        voiceListening = false;
        voiceProcessing = true;
        updateVoiceButton();
        if (voiceButton) voiceButton.disabled = true;
        if (voiceMonitorFrame) window.cancelAnimationFrame(voiceMonitorFrame);
        voiceMonitorFrame = 0;
        if (voiceAudioContext) { try { voiceAudioContext.close(); } catch (_error) {} }
        voiceAudioContext = null;
        if (voiceMediaStream) voiceMediaStream.getTracks().forEach(function (track) { track.stop(); });
        voiceMediaStream = null;
        voiceMediaRecorder = null;
        endVoicePlaybackIsolation();
        if (!voiceAudioChunks.length || requestId !== voiceRequestSerial) {
          voiceProcessing = false;
          updateVoiceButton();
          if (voiceButton) voiceButton.disabled = busy;
          return;
        }
        setStatus('正在高精度识别…', 'busy');
        try {
          var audioBlob = new Blob(voiceAudioChunks, { type: recorder && recorder.mimeType || 'audio/webm' });
          voiceAudioChunks = [];
          var response = await fetch('/api/agent/speech/transcribe', { method: 'POST', headers: { 'Content-Type': audioBlob.type || 'audio/webm' }, body: audioBlob });
          var result = {};
          try { result = await response.json(); } catch (_error) {}
          if (!response.ok || !result.ok) throw new Error(result.message || '语音识别失败。');
          if (requestId !== voiceRequestSerial) return;
          applyVoiceTranscript(result.text);
          setStatus('', '');
        } catch (error) {
          if (requestId === voiceRequestSerial) setStatus(error && error.message ? error.message : '语音识别失败，请检查麦克风。', 'error');
        } finally {
          if (requestId === voiceRequestSerial) {
            voiceListening = false;
            voiceProcessing = false;
            updateVoiceButton();
            if (voiceButton) voiceButton.disabled = busy;
            if (input) input.focus();
          }
        }
      });
      voiceListening = true;
      updateVoiceButton();
      setStatus('正在听你说话… 再点一次结束', 'listening');
      voiceMediaRecorder.start(250);
      try {
        voiceAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        var sourceNode = voiceAudioContext.createMediaStreamSource(voiceMediaStream);
        var analyser = voiceAudioContext.createAnalyser();
        analyser.fftSize = 1024;
        sourceNode.connect(analyser);
        var levels = new Uint8Array(analyser.fftSize);
        var heardSpeech = false;
        var silenceStartedAt = 0;
        var monitorStartedAt = performance.now();
        function monitorSilence(now) {
          if (!voiceListening || !voiceMediaRecorder || voiceMediaRecorder.state === 'inactive') return;
          analyser.getByteTimeDomainData(levels);
          var energy = 0;
          for (var sampleIndex = 0; sampleIndex < levels.length; sampleIndex += 1) {
            var level = (levels[sampleIndex] - 128) / 128;
            energy += level * level;
          }
          var rms = Math.sqrt(energy / levels.length);
          if (rms >= 0.018) {
            heardSpeech = true;
            silenceStartedAt = 0;
          } else if (heardSpeech) {
            if (!silenceStartedAt) silenceStartedAt = now;
            if (now - silenceStartedAt >= 1050 && now - monitorStartedAt >= 1400) {
              try { voiceMediaRecorder.stop(); } catch (_error) {}
              return;
            }
          }
          voiceMonitorFrame = window.requestAnimationFrame(monitorSilence);
        }
        voiceMonitorFrame = window.requestAnimationFrame(monitorSilence);
      } catch (_error) {}
      voiceStopTimer = window.setTimeout(function () {
        if (voiceListening && voiceMediaRecorder && voiceMediaRecorder.state !== 'inactive') voiceMediaRecorder.stop();
      }, 18000);
    } catch (error) {
      if (requestId !== voiceRequestSerial) return;
      setStatus(error && error.message ? error.message : '语音识别失败，请检查麦克风。', 'error');
      voiceListening = false;
      updateVoiceButton();
      if (voiceMediaStream) voiceMediaStream.getTracks().forEach(function (track) { track.stop(); });
      voiceMediaStream = null;
      endVoicePlaybackIsolation();
    }
  }

  function addMessage(role, message, remember) {
    if (!chatLog || !message) return;
    var messageRole = role === 'user' ? 'user' : 'assistant';
    var fullText = normalizeXiaoMName(message);
    if (messageRole === 'assistant') setThinkingMessage(false);
    var item = document.createElement('div');
    item.className = 'music-agent-message ' + messageRole;
    var shouldType = messageRole === 'assistant' && remember !== false;
    item.textContent = shouldType ? '' : fullText;
    if (shouldType) item.hidden = true;
    chatLog.appendChild(item);
    while (chatLog.children.length > CHAT_HISTORY_LIMIT) chatLog.removeChild(chatLog.firstChild);
    chatLog.scrollTop = chatLog.scrollHeight;
    if (remember !== false) {
      chatHistory.push({ role: messageRole, content: fullText.slice(0, 4000) });
      if (chatHistory.length > CHAT_HISTORY_LIMIT) chatHistory = chatHistory.slice(-CHAT_HISTORY_LIMIT);
      persistChatHistory();
    }
    if (shouldType) {
      messageTypingQueue = messageTypingQueue.catch(function () {}).then(function () {
        var characters = Array.from(fullText);
        var index = 0;
        item.hidden = false;
        item.classList.add('typing');
        chatLog.scrollTop = chatLog.scrollHeight;
        return new Promise(function (resolve) {
          function revealNext() {
            if (!item.isConnected || index >= characters.length) {
              item.textContent = fullText;
              item.classList.remove('typing');
              chatLog.scrollTop = chatLog.scrollHeight;
              focusChatInputAfterReply();
              resolve();
              return;
            }
            var character = characters[index++];
            item.textContent += character;
            chatLog.scrollTop = chatLog.scrollHeight;
            var pause = /[。！？!?；;\n]/.test(character) ? 95 : (/[，、,:：]/.test(character) ? 55 : 28);
            window.setTimeout(revealNext, pause);
          }
          revealNext();
        });
      });
    }
    return item;
  }

  function addAgentStep(message, state) {
    // Keep internal multi-step execution details out of the conversation UI.
    // The user sees a single ellipsis while work is running and the final reply.
    if (state === 'running') setStatus('…', 'busy');
  }

  function refreshModeBadge() {
    if (!modeBadge) return;
    if (agentConfig && agentConfig.enabled && agentConfig.configured) {
      modeBadge.textContent = 'AI 已启用';
      modeBadge.className = 'music-agent-mode-badge enabled';
    } else {
      modeBadge.textContent = '本地软件控制';
      modeBadge.className = 'music-agent-mode-badge';
    }
  }

  async function loadAgentConfig(force) {
    if (agentConfig && !force) return agentConfig;
    agentConfig = await requestJson('/api/agent/config?t=' + Date.now());
    applyConfigToSettings();
    refreshModeBadge();
    if (status && !busy) {
      if (agentConfig.enabled && agentConfig.configured) {
        setStatus('AI 已启用，可直接对话或控制音乐。', 'success');
      } else {
        setStatus('无需 API：播放、歌单和明确的 DIY 设置均在本地执行。', '');
      }
    }
    return agentConfig;
  }

  function applyConfigToSettings() {
    if (!settingsForm || !agentConfig) return;
    settingsForm.elements.enabled.checked = !!agentConfig.enabled;
    settingsForm.elements.provider.value = agentConfig.provider || 'openai';
    settingsForm.elements.baseUrl.value = agentConfig.baseUrl || '';
    updateProviderFields(false, agentConfig.model || '');
    renderSavedKey();
    var keyState = agentConfig.hasApiKey ? ('已安全保存 ' + (agentConfig.apiKeyHint || 'API Key')) : '尚未保存 API Key';
    if (!agentConfig.secureStorageAvailable) keyState += '；当前安全存储不可用';
    settingsHint.textContent = keyState + '。密钥只在本机加密保存，不会显示在页面中。';
  }

  function populateModelOptions(provider, preferredModel) {
    var select = settingsForm.elements.model;
    var customInput = settingsForm.elements.customModel;
    var models = PROVIDER_MODELS[provider] || [];
    select.innerHTML = '';
    models.forEach(function (model) {
      var option = document.createElement('option');
      option.value = model.value;
      option.textContent = model.label + ' · ' + model.value;
      select.appendChild(option);
    });
    var customOption = document.createElement('option');
    customOption.value = '__custom__';
    customOption.textContent = provider === 'ollama' ? '其他已安装的本地模型…' : '自定义模型 ID…';
    select.appendChild(customOption);
    var known = models.some(function (model) { return model.value === preferredModel; });
    if (preferredModel && known) {
      select.value = preferredModel;
      customInput.value = '';
    } else if (preferredModel) {
      select.value = '__custom__';
      customInput.value = preferredModel;
    } else if (models.length) {
      select.value = models[0].value;
      customInput.value = '';
    } else {
      select.value = '__custom__';
      customInput.value = '';
    }
    updateCustomModelVisibility();
  }

  function updateCustomModelVisibility() {
    if (!settingsForm) return;
    var customField = settingsForm.querySelector('.music-agent-custom-model');
    var isCustom = settingsForm.elements.model.value === '__custom__';
    customField.hidden = !isCustom;
    settingsForm.elements.customModel.required = isCustom;
  }

  function updateProviderApiPortal() {
    if (!settingsForm) return;
    var button = settingsForm.querySelector('.music-agent-api-apply');
    if (!button) return;
    var provider = settingsForm.elements.provider.value || 'openai';
    var portal = PROVIDER_API_PORTALS[provider];
    button.hidden = !portal;
    button.disabled = !portal;
    button.dataset.provider = provider;
    button.textContent = portal ? ('申请 ' + portal.name + ' API Key ↗') : '';
    button.title = portal ? ('打开 ' + portal.name + ' 官方 API Key 页面') : '';
  }

  function openProviderApiPortal() {
    if (!settingsForm) return;
    var provider = settingsForm.elements.provider.value || 'openai';
    var portal = PROVIDER_API_PORTALS[provider];
    if (!portal) {
      setStatus(provider === 'ollama' ? 'Ollama 是本地模型，不需要申请 API Key。' : '自定义接口请向对应服务商申请 API Key。', '');
      return;
    }
    window.open(portal.url, '_blank', 'noopener,noreferrer');
    setStatus('已打开 ' + portal.name + ' 官方 API Key 页面。', 'success');
  }

  function renderSavedKey() {
    if (!settingsForm) return;
    var keyInput = settingsForm.elements.apiKey;
    keyInput.dataset.dirty = 'false';
    if (agentConfig && agentConfig.hasApiKey) {
      var hint = String(agentConfig.apiKeyHint || '');
      var suffix = hint.replace(/^[•·*]+/, '');
      keyInput.type = 'text';
      keyInput.value = suffix === '环境变量' ? '••••••••（环境变量）' : '••••••••' + suffix;
      keyInput.dataset.saved = 'true';
      keyInput.classList.add('saved');
      keyInput.placeholder = '已安全保存；输入新 Key 可替换';
    } else {
      keyInput.type = 'password';
      keyInput.value = '';
      keyInput.dataset.saved = 'false';
      keyInput.classList.remove('saved');
    }
  }

  function updateProviderFields(replaceDefaults, preferredModel) {
    if (!settingsForm) return;
    var provider = settingsForm.elements.provider.value || 'openai';
    var defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.custom;
    var baseInput = settingsForm.elements.baseUrl;
    var currentBase = String(baseInput.value || '').trim();
    var knownDefault = Object.keys(PROVIDER_DEFAULTS).some(function (key) { return PROVIDER_DEFAULTS[key].baseUrl === currentBase; });
    if (replaceDefaults && (!currentBase || knownDefault)) baseInput.value = defaults.baseUrl;
    populateModelOptions(provider, preferredModel || '');
    settingsForm.elements.apiKey.placeholder = provider === 'ollama' ? '本地 Ollama 不需要填写' : '留空表示保留已保存的 Key';
    settingsForm.querySelector('.music-agent-key-row').classList.toggle('optional', provider === 'ollama' || provider === 'custom');
    updateProviderApiPortal();
  }

  function settingsPayload(clearApiKey) {
    var selectedModel = settingsForm.elements.model.value;
    return {
      enabled: !!settingsForm.elements.enabled.checked,
      provider: settingsForm.elements.provider.value,
      apiKey: settingsForm.elements.apiKey.dataset.dirty === 'true' ? settingsForm.elements.apiKey.value : '',
      baseUrl: settingsForm.elements.baseUrl.value,
      model: selectedModel === '__custom__' ? settingsForm.elements.customModel.value.trim() : selectedModel,
      clearApiKey: !!clearApiKey
    };
  }

  async function saveSettings(showSuccess) {
    var data = await requestJson('/api/agent/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsPayload(false))
    });
    agentConfig = data;
    applyConfigToSettings();
    refreshModeBadge();
    if (showSuccess !== false) setStatus('AI 设置已安全保存在本机。', 'success');
    return data;
  }

  async function saveAiEnabledImmediately(enabled) {
    if (!settingsForm) return;
    var enabledInput = settingsForm.elements.enabled;
    var previousEnabled = !!(agentConfig && agentConfig.enabled);
    enabledInput.checked = !!enabled;
    if (agentConfig) agentConfig.enabled = !!enabled;
    refreshModeBadge();
    setBusy(true);
    setStatus(enabled ? '正在开启 AI 对话…' : '正在关闭 AI 对话…', 'busy');
    try {
      await saveSettings(false);
      setStatus(enabled ? 'AI 对话已开启。' : 'AI 对话已关闭；本地播放、歌单和 DIY 设置仍可使用。', 'success');
    } catch (error) {
      enabledInput.checked = previousEnabled;
      if (agentConfig) agentConfig.enabled = previousEnabled;
      refreshModeBadge();
      setStatus(error && error.message ? error.message : 'AI 开关保存失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    if (busy) return;
    setBusy(true);
    setStatus('正在保存设置并测试模型连接…', 'busy');
    try {
      await saveSettings(false);
      var result = await requestJson('/api/agent/test', { method: 'POST' });
      setStatus('连接成功：' + result.provider + ' / ' + result.model, 'success');
    } catch (error) {
      setStatus(error.message || '连接测试失败', 'error');
    } finally { setBusy(false); }
  }

  async function clearSavedKey() {
    if (busy || !window.confirm('确定清除本机保存的 API Key 吗？')) return;
    setBusy(true);
    try {
      var data = await requestJson('/api/agent/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settingsPayload(true))
      });
      agentConfig = data;
      applyConfigToSettings();
      refreshModeBadge();
      setStatus('已清除本机保存的 API Key。', 'success');
    } catch (error) { setStatus(error.message || '清除失败', 'error'); }
    finally { setBusy(false); }
  }

  async function playFromTool(toolArguments, originalMessage) {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.search_and_play_music !== 'function') {
      throw new Error('音乐工具尚未加载，请重启 Mineradio 后再试。');
    }
    var args = toolArguments && typeof toolArguments === 'object' ? Object.assign({}, toolArguments) : {};
    if (!args.query && !args.title) args = parseMusicCommand(originalMessage);
    setStatus('正在搜索并匹配歌曲…', 'busy');
    var result = await tools.search_and_play_music(args);
    if (!result || !result.ok) {
      var message = result && result.message ? result.message : '没有找到可播放的歌曲';
      if (result && result.error === 'LX_SOURCE_NOT_CONFIGURED') message = '请先在 Mineradio 中导入并启用 LX 兼容音源。';
      throw new Error(message);
    }
    var song = result.song || {};
    var title = String(song.name || song.title || '歌曲');
    var artist = String(song.singer || song.artist || '');
    var nowPlaying = '正在播放《' + title + '》' + (artist ? ' · ' + artist : '');
    setStatus(nowPlaying, 'success');
    addMessage('assistant', nowPlaying);
    return result;
  }

  async function replayCurrentSong() {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.replay_current_music !== 'function') throw new Error('当前歌曲重播工具尚未加载，请重启 Mineradio。');
    setStatus('正在从头播放当前歌曲…', 'busy');
    var result = await tools.replay_current_music();
    if (!result || !result.ok) throw new Error(result && result.message || '当前歌曲重新播放失败');
    var summary = result.song || {};
    var message = '已从头播放《' + String(summary.title || '当前歌曲') + '》' + (summary.artist ? ' · ' + summary.artist : '');
    setStatus(message, 'success');
    addMessage('assistant', message);
    return result;
  }

  async function setPlayerVolume(toolArguments, originalMessage) {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.set_volume !== 'function') throw new Error('音量控制工具尚未加载，请重启 Mineradio。');
    var target = toolArguments && toolArguments.volume != null ? Number(toolArguments.volume) : volumeFromCommand(originalMessage);
    if (!isFinite(target)) throw new Error('请告诉我要把音量调到多少，例如：音量调到 30%。');
    setStatus('正在调整音量…', 'busy');
    var result = await tools.set_volume({ volume: target });
    if (!result || !result.ok) throw new Error(result && result.message || '音量调整失败');
    var message = result.volume === 0 ? '已静音' : ('音量已调到 ' + result.volume + '%');
    setStatus(message, 'success');
    addMessage('assistant', message);
    return result;
  }

  async function controlCurrentPlayback(toolArguments, originalMessage) {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.control_playback !== 'function') throw new Error('播放控制工具尚未加载，请重启 Mineradio。');
    var action = toolArguments && String(toolArguments.action || '').toLowerCase();
    if (action !== 'play' && action !== 'pause') action = playbackActionFromCommand(originalMessage);
    if (!action) throw new Error('没有识别出播放或暂停动作。');
    setStatus(action === 'pause' ? '正在暂停…' : '正在继续播放…', 'busy');
    var result = await tools.control_playback({ action: action });
    if (!result || !result.ok) throw new Error(result && result.message || '播放控制失败');
    var song = result.currentSong || {};
    var message = result.message + (song.title ? '《' + song.title + '》' : '');
    setStatus(message, 'success');
    addMessage('assistant', message);
    return result;
  }

  async function skipCurrentTrack(toolArguments, originalMessage) {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.skip_track !== 'function') throw new Error('切歌工具尚未加载，请重启 Mineradio。');
    var direction = toolArguments && String(toolArguments.direction || '').toLowerCase();
    if (direction !== 'next' && direction !== 'previous') direction = trackDirectionFromCommand(originalMessage);
    if (!direction) throw new Error('没有识别出上一首或下一首动作。');
    setStatus(direction === 'next' ? '正在切换下一首…' : '正在切换上一首…', 'busy');
    var result = await tools.skip_track({ direction: direction });
    if (!result || !result.ok) throw new Error(result && result.message || '切换歌曲失败');
    var song = result.currentSong || {};
    var message = result.message + (song.title ? '《' + song.title + '》' : '');
    setStatus(message, 'success');
    addMessage('assistant', message);
    return result;
  }

  async function setCurrentPlayMode(toolArguments, originalMessage) {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.set_play_mode !== 'function') throw new Error('播放模式工具尚未加载，请重启 Mineradio。');
    var mode = toolArguments && String(toolArguments.mode || '').toLowerCase();
    if (mode !== 'loop' && mode !== 'shuffle' && mode !== 'single' && mode !== 'heart') mode = playModeFromCommand(originalMessage);
    if (!mode) throw new Error('没有识别出播放模式。');
    setStatus('正在切换播放模式…', 'busy');
    var result = await tools.set_play_mode({ mode: mode });
    if (!result || !result.ok) throw new Error(result && result.message || '播放模式切换失败');
    setStatus(result.message, 'success');
    addMessage('assistant', result.message);
    return result;
  }

  async function controlAudioQualityFromTool(toolArguments, originalMessage) {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.control_audio_quality !== 'function') throw new Error('音质控制工具尚未加载，请重启 Mineradio。');
    var args = toolArguments && typeof toolArguments === 'object' ? Object.assign({}, toolArguments) : {};
    var inferred = audioQualityRequestFromCommand(originalMessage);
    if (isAudioQualityIntent(originalMessage)) {
      // The user's wording is authoritative: vague requests open the selector,
      // while an explicitly named quality may be applied directly. This also
      // prevents an AI tool call from inventing a quality for “调整音质”.
      if (inferred.action === 'open' || !args.quality) args = inferred;
    } else if (!args.action && !args.quality) {
      args = inferred;
    }
    setStatus(args.action === 'open' ? '正在打开音质选择…' : '正在切换音质…', 'busy');
    var result = await tools.control_audio_quality(args);
    if (!result || !result.ok) throw new Error(result && result.message || '音质控制失败');
    setStatus(result.message, 'success');
    addMessage('assistant', result.message);
    return result;
  }

  async function openMusicSourceManagerFromTool() {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.open_music_source_manager !== 'function') throw new Error('音源管理工具尚未加载，请重启 Mineradio。');
    setStatus('正在打开音源管理…', 'busy');
    var result = await tools.open_music_source_manager();
    if (!result || !result.ok) throw new Error(result && result.message || '音源管理打开失败');
    setStatus(result.message, 'success');
    addMessage('assistant', result.message);
    return result;
  }

  async function openMineradioInterfaceFromTool(toolArguments, originalMessage) {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.open_mineradio_interface !== 'function') throw new Error('界面导航工具尚未加载，请重启 Mineradio。');
    var args = toolArguments && typeof toolArguments === 'object' ? Object.assign({}, toolArguments) : {};
    if (!args.section) args.section = mineradioInterfaceFromCommand(originalMessage);
    if (!args.section) throw new Error('没有识别出要打开的 Mineradio 界面。');
    setStatus('正在打开界面…', 'busy');
    var result = await tools.open_mineradio_interface(args);
    if (!result || !result.ok) throw new Error(result && result.message || '界面打开失败');
    setStatus(result.message, 'success');
    addMessage('assistant', result.message);
    return result;
  }

  async function controlMineradioAppFromTool(toolArguments, originalMessage) {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.control_mineradio_app !== 'function') throw new Error('全局软件控制工具尚未加载，请重启 Mineradio。');
    var args = toolArguments && typeof toolArguments === 'object' ? Object.assign({}, toolArguments) : {};
    if (!args.target) args = mineradioAppControlFromCommand(originalMessage) || {};
    if (!args.target) throw new Error('没有识别出要控制的软件功能。');
    setStatus('正在控制 Mineradio…', 'busy');
    var result = await tools.control_mineradio_app(args);
    if (!result || !result.ok) throw new Error(result && result.message || '软件控制失败');
    setStatus(result.message, 'success');
    addMessage('assistant', result.message);
    return result;
  }

  async function controlLyricAnimationFromTool(toolArguments, originalMessage) {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.control_lyric_animation !== 'function') throw new Error('歌词动画控制工具尚未加载，请重启 Mineradio。');
    var args = toolArguments && typeof toolArguments === 'object' ? Object.assign({}, toolArguments) : {};
    if (!args.mode) args = lyricAnimationRequestFromCommand(originalMessage) || {};
    if (!args.mode) throw new Error('没有识别出歌词动画模式。');
    setStatus('正在切换歌词动画…', 'busy');
    var result = await tools.control_lyric_animation(args);
    if (!result || !result.ok) throw new Error(result && result.message || '歌词动画切换失败');
    setStatus(result.message, 'success');
    addMessage('assistant', result.message);
    return result;
  }

  async function queueMusicFromTool(toolArguments, originalMessage) {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.search_and_queue_music !== 'function') throw new Error('播放队列工具尚未加载，请重启 Mineradio。');
    var args = toolArguments && typeof toolArguments === 'object' ? Object.assign({}, toolArguments) : {};
    if (!args.query && !args.title) args = queueMusicRequestFromCommand(originalMessage);
    setStatus(args.position === 'end' ? '正在加入播放队列…' : '正在查找下一首…', 'busy');
    var result = await tools.search_and_queue_music(args);
    if (!result || !result.ok) throw new Error(result && result.message || '歌曲加入播放队列失败');
    setStatus(result.message, 'success');
    addMessage('assistant', result.message);
    return result;
  }

  async function addPlaylistToQueueFromTool(toolArguments, originalMessage) {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.add_playlist_to_queue !== 'function') throw new Error('整张歌单加入队列工具尚未加载，请重启 Mineradio。');
    var args = toolArguments && typeof toolArguments === 'object' ? Object.assign({}, toolArguments) : {};
    if (!args.playlist_name) {
      var parsed = playlistQueueRequestFromCommand(originalMessage);
      if (parsed.playlist_name) args.playlist_name = parsed.playlist_name;
      if (!args.position) args.position = parsed.position;
    }
    setStatus('正在把整张歌单加入当前队列…', 'busy');
    var result = await tools.add_playlist_to_queue(args);
    if (!result || !result.ok) throw new Error(result && result.message || '整张歌单加入队列失败');
    setStatus(result.message, 'success');
    addMessage('assistant', result.message);
    return result;
  }

  async function seekPlaybackFromTool(toolArguments, originalMessage) {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.seek_playback !== 'function') throw new Error('播放进度工具尚未加载，请重启 Mineradio。');
    var args = toolArguments && typeof toolArguments === 'object' ? Object.assign({}, toolArguments) : {};
    if (args.position_seconds == null && args.percent == null) args = seekRequestFromCommand(originalMessage) || {};
    setStatus('正在调整播放进度…', 'busy');
    var result = await tools.seek_playback(args);
    if (!result || !result.ok) throw new Error(result && result.message || '播放进度调整失败');
    setStatus(result.message, 'success');
    addMessage('assistant', result.message);
    return result;
  }

  async function saveMusicToPlaylistFromTool(toolArguments, originalMessage) {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.save_music_to_playlist !== 'function') throw new Error('本地收藏工具尚未加载，请重启 Mineradio。');
    var args = toolArguments && typeof toolArguments === 'object' ? Object.assign({}, toolArguments) : {};
    if (!args.playlist_name) args = savePlaylistRequestFromCommand(originalMessage);
    setStatus('正在保存到本地歌单…', 'busy');
    var result = await tools.save_music_to_playlist(args);
    if (!result || !result.ok) throw new Error(result && result.message || '歌曲收藏失败');
    setStatus(result.message, 'success');
    addMessage('assistant', result.message);
    return result;
  }

  async function createLocalPlaylistFromTool(toolArguments, originalMessage) {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.create_local_playlist !== 'function') throw new Error('本地歌单工具尚未加载，请重启 Mineradio。');
    var args = toolArguments && typeof toolArguments === 'object' ? Object.assign({}, toolArguments) : {};
    if (!args.name) args = createPlaylistRequestFromCommand(originalMessage) || {};
    setStatus('正在创建本地歌单…', 'busy');
    var result = await tools.create_local_playlist(args);
    if (!result || !result.ok) throw new Error(result && result.message || '歌单创建失败');
    setStatus(result.message, 'success');
    addMessage('assistant', result.message);
    return result;
  }

  async function buildRecommendedPlaylistFromTool(toolArguments, originalMessage) {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.build_recommended_playlist !== 'function') throw new Error('推荐歌单工具尚未加载，请重启 Mineradio。');
    var args = toolArguments && typeof toolArguments === 'object' ? Object.assign({}, toolArguments) : {};
    if (!Array.isArray(args.search_queries) || !args.search_queries.length) args = recommendedPlaylistRequestFromCommand(originalMessage);
    args.onProgress = function (progress) {
      var current = Math.max(0, Number(progress && progress.completed) || 0);
      var total = Math.max(current, Number(progress && progress.total) || 0);
      setStatus('正在搜索推荐歌曲 ' + current + '/' + total + '…', 'busy');
    };
    setStatus('正在规划并搜索推荐歌单…', 'busy');
    var result = await tools.build_recommended_playlist(args);
    if (!result || !result.ok) throw new Error(result && result.message || '推荐歌单生成失败');
    pendingRecommendedPlaylist = result.awaitingPlaylistConfirmation && result.pendingPlaylist
      ? { name: String(result.pendingPlaylist.name || args.playlist_name || '小M推荐') }
      : null;
    setStatus(result.message, 'success');
    addMessage('assistant', result.message);
    return result;
  }

  function pendingPlaylistDecision(message) {
    if (!pendingRecommendedPlaylist) return '';
    var text = String(message || '').trim();
    if (/^(?:要|需要|可以|好|好的|行|同意|保存|建|建立|创建|确定|确认|是|yes|ok)(?:了|吧|的)?[。！! ]*$/i.test(text)) return 'save';
    if (/^(?:不要|不用|不需要|算了|取消|否|no|不用了|不保存)[。！! ]*$/i.test(text)) return 'discard';
    return '';
  }

  async function resolvePendingRecommendedPlaylist(decision) {
    var tools = window.MineradioAgentMusicTools;
    var pending = pendingRecommendedPlaylist;
    if (!tools || !pending) throw new Error('当前没有等待确认的推荐歌单。');
    if (decision === 'discard') {
      pendingRecommendedPlaylist = null;
      var discarded = typeof tools.discard_pending_recommended_playlist === 'function'
        ? tools.discard_pending_recommended_playlist()
        : { ok: true, message: '好的，推荐歌曲只保留在当前播放队列中。' };
      addMessage('assistant', discarded.message || '好的，推荐歌曲只保留在当前播放队列中。');
      setStatus('', '');
      return discarded;
    }
    if (typeof tools.save_pending_recommended_playlist !== 'function') throw new Error('推荐歌单保存工具尚未加载，请重启 Mineradio。');
    setStatus('正在保存推荐歌单…', 'busy');
    var saved = tools.save_pending_recommended_playlist({ playlist_name: pending.name });
    if (!saved || !saved.ok) throw new Error(saved && saved.message || '推荐歌单保存失败');
    pendingRecommendedPlaylist = null;
    addMessage('assistant', saved.message || ('已保存为“' + pending.name + '”歌单。'));
    setStatus('', '');
    return saved;
  }

  async function controlDiyVisualFromTool(toolArguments, originalMessage) {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.control_diy_visual !== 'function') throw new Error('DIY 控制工具尚未加载，请重启 Mineradio。');
    var args = toolArguments && typeof toolArguments === 'object' ? Object.assign({}, toolArguments) : {};
    if (Array.isArray(args.controls)) {
      var originalText = String(originalMessage || '');
      var controls = args.controls.map(function (item) { return Object.assign({}, item); });
      var shelfStageRequested = /歌单架/.test(originalText) && controls.some(function (item) {
        return String(item.option || '').indexOf('舞台') >= 0;
      });
      controls = controls.map(function (item) {
        var controlName = String(item.control || item.setting || '');
        if ((item.operation === 'select' || item.action === 'select') && /^(?:eq|均衡器)$/i.test(controlName.trim()) && item.option) {
          item.control = '音效预设';
          controlName = item.control;
        }
        if (shelfStageRequested && String(item.option || '').indexOf('舞台') >= 0) item.control = '3D 歌单架';
        if ((item.operation === 'toggle' || item.action === 'toggle') && !item.option) {
          var probe = controlName.replace(/^(?:软件|DIY)/i, '');
          var index = probe ? originalText.indexOf(probe) : -1;
          var nearby = index >= 0 ? originalText.slice(Math.max(0, index - 8), index + probe.length + 8) : originalText;
          if (/(?:关闭|停用|禁用)/.test(nearby)) item.option = '关闭';
          else if (/(?:打开|开启|启用)/.test(nearby)) item.option = '开启';
        }
        return item;
      }).filter(function (item) {
        if ((args.lyric_font || args.lyricFont) && /歌词.*字体|字体/.test(String(item.control || ''))) return false;
        return !(shelfStageRequested && /歌单架/.test(String(item.control || '')) && (item.operation === 'toggle' || item.action === 'toggle'));
      });
      args.controls = controls;
    }
    setStatus('正在调整 DIY 视觉…', 'busy');
    var result = await tools.control_diy_visual(args);
    if (!result || !result.ok) throw new Error(result && result.message || 'DIY 视觉调整失败');
    setStatus(result.message, 'success');
    addMessage('assistant', result.message);
    return result;
  }

  async function controlLocalDiyFromCommand(message) {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.parse_local_diy_command !== 'function') return null;
    var parsed = tools.parse_local_diy_command(message);
    if (!parsed) return null;
    return controlDiyVisualFromTool(parsed, message);
  }

  async function importSharedPlaylistFromCommand(message) {
    var tools = window.MineradioAgentMusicTools;
    if (!tools || typeof tools.parse_shared_playlist_import_command !== 'function' || typeof tools.import_shared_playlist !== 'function') return null;
    var text = String(message || '').trim();
    var openEntry = /(?:打开|进入|显示).*(?:导入歌单|歌单导入)|(?:导入歌单|歌单导入).*(?:入口|窗口|页面)/i.test(text);
    var cancelPending = /^(?:取消|算了|不用了|不导入了)[。！! ]*$/i.test(text);
    var bareImport = /^(?:(?:请|麻烦)?(?:帮我|给我|我要|我想)?\s*)?(?:导入歌单|歌单导入)(?:吧|一下|一个)?[。！! ]*$/i.test(text);
    var looksLikePlaylistFollowup = /https?:\/\/|collection_|\b\d{4,}\b|(?:歌单|playlist|songlist).{0,8}(?:链接|分享|文案|ID|id)|(?:导入|解析|同步).{0,8}(?:歌单|playlist)/i.test(text);
    if (cancelPending && pendingSharedPlaylistImport) {
      pendingSharedPlaylistImport = false;
      addMessage('assistant', '好的，已取消导入歌单。');
      setStatus('', '');
      return { ok:true, canceled:true, message:'已取消导入歌单' };
    }
    if (openEntry) {
      pendingSharedPlaylistImport = false;
      addMessage('assistant', '已为你打开导入歌单入口。');
      setStatus('', 'success');
      window.setTimeout(function () {
        if (panel) {
          panel.classList.remove('show');
          panel.setAttribute('aria-hidden', 'true');
        }
        if (typeof window.openPlatformPlaylistImport === 'function') window.openPlatformPlaylistImport();
      }, 120);
      return { ok:true, opened:true, message:'已打开导入歌单入口' };
    }
    var parsed = tools.parse_shared_playlist_import_command(text);
    if (!parsed && pendingSharedPlaylistImport && /^https?:\/\//i.test(text)) {
      parsed = tools.parse_shared_playlist_import_command('导入歌单 ' + text);
    }
    if (!parsed) {
      if (!bareImport && !pendingSharedPlaylistImport) return null;
      if (!bareImport && pendingSharedPlaylistImport && !looksLikePlaylistFollowup) {
        pendingSharedPlaylistImport = false;
        return null;
      }
      pendingSharedPlaylistImport = true;
      var prompt = bareImport
        ? '请把歌单分享链接或分享文案发给我；数字 ID 请同时写平台名。也可以说“打开导入歌单入口”。'
        : '还没有识别到歌单链接。请发送分享链接；如果是数字 ID，请写成“导入小秋歌单 12345678”，或说“打开导入歌单入口”。';
      addMessage('assistant', prompt);
      setStatus('', '');
      return { ok:true, awaitingPlaylistLink:true, message:prompt };
    }
    setStatus('正在识别并导入歌单…', 'busy');
    var result = await tools.import_shared_playlist(parsed);
    var reply = result && result.message ? result.message : (result && result.ok === false ? '歌单导入失败，请检查链接。' : '歌单已导入。');
    pendingSharedPlaylistImport = !(result && result.ok !== false);
    addMessage('assistant', reply);
    setStatus(result && result.ok === false ? reply : '', result && result.ok === false ? 'error' : 'success');
    return result || { ok:false, message:reply };
  }

  function agentToolLabel(name) {
    return {
      search_and_play_music: '搜索并播放歌曲',
      replay_current_music: '重播当前歌曲',
      set_volume: '调整音量',
      control_playback: '控制播放状态',
      skip_track: '切换歌曲',
      set_play_mode: '设置播放模式',
      control_audio_quality: '控制播放音质',
      open_music_source_manager: '打开音源管理',
      open_mineradio_interface: '打开 Mineradio 界面',
      control_mineradio_app: '控制 Mineradio 软件',
      control_lyric_animation: '切换歌词动画',
      search_and_queue_music: '搜索并加入队列',
      add_playlist_to_queue: '整张歌单加入队列',
      seek_playback: '调整播放进度',
      save_music_to_playlist: '收藏到本地歌单',
      create_local_playlist: '创建本地歌单',
      build_recommended_playlist: '生成推荐歌单',
      control_diy_visual: '调整 DIY 视觉'
    }[String(name || '')] || '执行 Mineradio 动作';
  }

  async function executeAgentToolCall(toolCall, originalMessage) {
    var name = toolCall && String(toolCall.name || '');
    var args = toolCall && toolCall.arguments && typeof toolCall.arguments === 'object' ? toolCall.arguments : {};
    if (name === 'search_and_play_music') return playFromTool(args, originalMessage);
    if (name === 'replay_current_music') return replayCurrentSong();
    if (name === 'set_volume') return setPlayerVolume(args, originalMessage);
    if (name === 'control_playback') return controlCurrentPlayback(args, originalMessage);
    if (name === 'skip_track') return skipCurrentTrack(args, originalMessage);
    if (name === 'set_play_mode') return setCurrentPlayMode(args, originalMessage);
    if (name === 'control_audio_quality') return controlAudioQualityFromTool(args, originalMessage);
    if (name === 'open_music_source_manager') return openMusicSourceManagerFromTool();
    if (name === 'open_mineradio_interface') return openMineradioInterfaceFromTool(args, originalMessage);
    if (name === 'control_mineradio_app') return controlMineradioAppFromTool(args, originalMessage);
    if (name === 'control_lyric_animation') return controlLyricAnimationFromTool(args, originalMessage);
    if (name === 'search_and_queue_music') return queueMusicFromTool(args, originalMessage);
    if (name === 'add_playlist_to_queue') return addPlaylistToQueueFromTool(args, originalMessage);
    if (name === 'seek_playback') return seekPlaybackFromTool(args, originalMessage);
    if (name === 'save_music_to_playlist') return saveMusicToPlaylistFromTool(args, originalMessage);
    if (name === 'create_local_playlist') return createLocalPlaylistFromTool(args, originalMessage);
    if (name === 'build_recommended_playlist') return buildRecommendedPlaylistFromTool(args, originalMessage);
    if (name === 'control_diy_visual') return controlDiyVisualFromTool(args, originalMessage);
    throw new Error('模型请求了未开放的 Mineradio 操作。');
  }

  function isComplexAgentRequest(message) {
    var text = String(message || '');
    if (isRecommendedPlaylistIntent(text)) return true;
    var stateActionCount = (text.match(/(?:调到|调成|改成|换成|设成|设为|设置|打开|关闭|开启|切换|增加|减少)/g) || []).length;
    if (stateActionCount > 1) return true;
    if (/(?:然后|接着|并且|同时|并把|并将|再把|再将|完成后|创建后|生成后)|\b(?:then|and then)\b/i.test(text)) return true;
    var intentCount = [
      isPlaylistQueueIntent(text), !isPlaylistQueueIntent(text) && isQueueMusicIntent(text), isSeekIntent(text), isSavePlaylistIntent(text), isCreatePlaylistIntent(text),
      isPlayModeIntent(text), isPlaybackControlIntent(text), isVolumeIntent(text), isTrackSkipIntent(text), isReplayIntent(text),
      isAudioQualityIntent(text), isSourceManagerIntent(text), isMineradioInterfaceIntent(text), isMineradioAppControlIntent(text), isLyricAnimationControlIntent(text), isDiyControlIntent(text)
    ].filter(Boolean).length;
    return intentCount > 1;
  }

  function isStateChangingAgentRequest(message) {
    var text = String(message || '');
    var action = /(?:打开|关闭|开启|启用|停用|切换|调整|调到|调成|改成|换成|设置|设为|增加|减少|恢复|重置|播放|暂停|继续|上一首|下一首|加入|创建|保存|收藏)/.test(text);
    if (!action) return false;
    return isMusicIntent(text) || isReplayIntent(text) || isVolumeIntent(text) || isPlaybackControlIntent(text)
      || isTrackSkipIntent(text) || isPlayModeIntent(text) || isAudioQualityIntent(text) || isSourceManagerIntent(text)
      || isMineradioInterfaceIntent(text)
      || isMineradioAppControlIntent(text)
      || isLyricAnimationControlIntent(text)
      || isPlaylistQueueIntent(text) || isQueueMusicIntent(text) || isSeekIntent(text) || isSavePlaylistIntent(text)
      || isCreatePlaylistIntent(text) || isRecommendedPlaylistIntent(text) || isDiyControlIntent(text)
      || /(?:歌词|淡入|淡出|均衡器|\bEQ\b|频段|混响|声场|歌单架|摄像头|界面动画|导航自动隐藏|高级参数|粒子|镜头|溢光|字间距|行距|字重)/i.test(text);
  }

  function summarizeAgentToolResult(result, error) {
    if (error) return String(error && error.message || error || '执行失败').slice(0, 800);
    if (!result || typeof result !== 'object') return '工具没有返回结果';
    if (result.message) return String(result.message).slice(0, 800);
    var summary = [];
    if (result.playlist && result.playlist.name) summary.push('歌单：' + result.playlist.name);
    if (result.addedCount != null) summary.push('新增 ' + result.addedCount + ' 首');
    if (result.currentSong && result.currentSong.title) summary.push('当前歌曲：' + result.currentSong.title);
    if (result.volume != null) summary.push('音量：' + result.volume + '%');
    return summary.join('；') || '操作已完成';
  }

  async function requestAgentResponse(message, history, agentState) {
    return requestJson('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message, history: history, context: playerContext(), agentState: agentState || null })
    });
  }

  async function runAgentLoop(message, history, initialResponse) {
    var state = { objective: message, step: 0, maxSteps: AGENT_MAX_STEPS, results: [] };
    var response = initialResponse;
    var lastResult = null;
    var seenCalls = Object.create(null);
    var duplicateRecoveries = 0;
    var stopMessage = '';
    while (response && response.toolCall && state.step < state.maxSteps) {
      var call = response.toolCall;
      var signature = String(call.name || '') + '|' + JSON.stringify(call.arguments || {});
      if (seenCalls[signature]) {
        var previousStep = state.results.filter(function (item) { return item.tool === String(call.name || ''); }).slice(-1)[0];
        duplicateRecoveries += 1;
        if (duplicateRecoveries <= 2 && state.step < state.maxSteps) {
          state.step += 1;
          state.results.push({
            step: state.step,
            tool: 'skip_duplicate_action',
            ok: true,
            summary: '已跳过重复动作“' + agentToolLabel(call.name) + '”。此前结果：' + (previousStep && previousStep.summary || '已处理') + '。请继续原目标中尚未完成的其他设置。'
          });
          response = await requestAgentResponse(message, history, state);
          continue;
        }
        stopMessage = previousStep && previousStep.ok ? '操作已完成：' + previousStep.summary : '操作未完成：' + (previousStep && previousStep.summary || agentToolLabel(call.name));
        addAgentStep(stopMessage, previousStep && previousStep.ok ? 'success' : 'error');
        break;
      }
      seenCalls[signature] = true;
      state.step += 1;
      addAgentStep('步骤 ' + state.step + '/' + state.maxSteps + ' · ' + agentToolLabel(call.name), 'running');
      var result = null;
      var executionError = null;
      try {
        result = await executeAgentToolCall(call, message);
        lastResult = result;
      } catch (error) {
        executionError = error;
      }
      var ok = !executionError && !!(result && result.ok !== false);
      var summary = summarizeAgentToolResult(result, executionError);
      state.results.push({ step: state.step, tool: String(call.name || ''), ok: ok, summary: summary });
      addAgentStep('步骤 ' + state.step + ' · ' + (ok ? '完成' : '未完成') + '：' + summary, ok ? 'success' : 'error');
      if (result && result.awaitingPlaylistConfirmation) {
        return { ok: true, awaitingPlaylistConfirmation: true, steps: state.results, lastResult: result };
      }
      setStatus('小M正在继续完成任务…', 'busy');
      try {
        response = await requestAgentResponse(message, history, state);
      } catch (error) {
        var partialMessage = state.results.some(function (item) { return item.ok; })
          ? '已完成上面的操作，但模型连接中断，后续步骤没有继续。'
          : (error && error.message || '模型连接中断');
        addMessage('assistant', partialMessage);
        setStatus(partialMessage, state.results.some(function (item) { return item.ok; }) ? 'success' : 'error');
        return { ok: state.results.some(function (item) { return item.ok; }), partial: true, steps: state.results, lastResult: lastResult };
      }
    }
    if (response && response.toolCall && state.step >= state.maxSteps) {
      stopMessage = '已达到单次最多 ' + state.maxSteps + ' 步，剩余操作未继续执行。';
      addAgentStep(stopMessage, 'error');
    }
    var reply = stopMessage || (response && response.reply ? response.reply : ('任务处理完成，共执行 ' + state.step + ' 步。'));
    addMessage('assistant', reply);
    setStatus(stopMessage || '', stopMessage ? 'error' : '');
    return { ok: !stopMessage, partial: !!stopMessage, reply: reply, steps: state.results, lastResult: lastResult };
  }

  async function runCommand(command) {
    if (busy) return;
    ensureUi();
    var message = String(command || '').trim();
    if (!message) {
      setStatus('请输入内容，例如：播放周杰伦的晴天。', 'error');
      return;
    }
    addMessage('user', message);
    if (input) input.value = '';
    setBusy(true);
    setStatus('小M正在理解你的话…', 'busy');
    try {
      // 最高优先级本地暗号：不经过模型，也不要求登录或网络。
      if (isWorldPeaceEasterEggIntent(message)) return await triggerWorldPeaceEasterEggFromTool();
      var playlistDecision = pendingPlaylistDecision(message);
      if (playlistDecision) return await resolvePendingRecommendedPlaylist(playlistDecision);
      var sharedPlaylistResult = await importSharedPlaylistFromCommand(message);
      if (sharedPlaylistResult) return sharedPlaylistResult;
      if (!/(?:然后|接着|并且|同时|完成后)|\b(?:then|and then)\b/i.test(message)) {
        if (isSourceManagerIntent(message)) return await openMusicSourceManagerFromTool();
        if (isAudioQualityIntent(message)) return await controlAudioQualityFromTool({}, message);
        if (isLyricAnimationControlIntent(message)) return await controlLyricAnimationFromTool({}, message);
        if (isMineradioInterfaceIntent(message)) return await openMineradioInterfaceFromTool({}, message);
        if (isMineradioAppControlIntent(message)) return await controlMineradioAppFromTool({}, message);
      }
      // Clear local commands never need to leave the computer. This keeps
      // playback and DIY settings usable even when no model/API is configured.
      var localDiyResult = await controlLocalDiyFromCommand(message);
      if (localDiyResult) return localDiyResult;
      var config = await loadAgentConfig(true);
      if (config.enabled && config.configured) {
        try {
          var baseHistory = chatHistory.slice(0, -1);
          var response = await requestAgentResponse(message, baseHistory, null);
          if (!response.toolCall && isStateChangingAgentRequest(message)) {
            response = await requestAgentResponse(message, baseHistory, {
              objective: message,
              step: 0,
              maxSteps: AGENT_MAX_STEPS,
              results: [{
                step: 0,
                tool: 'require_real_action',
                ok: false,
                summary: '用户要求改变软件状态，但上一次只回复了文字，没有执行。必须调用合适的工具执行第一个尚未完成的动作，不能声称已完成。'
              }]
            });
          }
          if (response.toolCall) {
            if (response.toolCall.name === 'build_recommended_playlist') {
              return await executeAgentToolCall(response.toolCall, message);
            }
            var bulkDiy = response.toolCall.name === 'control_diy_visual'
              && response.toolCall.arguments && Array.isArray(response.toolCall.arguments.controls)
              && response.toolCall.arguments.controls.length > 0;
            if (bulkDiy) return await executeAgentToolCall(response.toolCall, message);
            var genericDiyMulti = response.toolCall.name === 'control_diy_visual'
              && response.toolCall.arguments && response.toolCall.arguments.control
              && /(?:和|、|以及|还有)/.test(message);
            if (isComplexAgentRequest(message) || response.toolCall.name === 'build_recommended_playlist' || genericDiyMulti) {
              return await runAgentLoop(message, baseHistory, response);
            }
            return await executeAgentToolCall(response.toolCall, message);
          }
          var reply = response.reply || '我暂时没有合适的回答。';
          addMessage('assistant', reply);
          setStatus('对话完成', 'success');
          return response;
        } catch (agentError) {
          if (!isMusicIntent(message) && !isReplayIntent(message) && !isVolumeIntent(message) && !isPlaybackControlIntent(message) && !isTrackSkipIntent(message) && !isPlayModeIntent(message) && !isAudioQualityIntent(message) && !isSourceManagerIntent(message) && !isMineradioInterfaceIntent(message) && !isMineradioAppControlIntent(message) && !isLyricAnimationControlIntent(message) && !isPlaylistQueueIntent(message) && !isQueueMusicIntent(message) && !isSeekIntent(message) && !isSavePlaylistIntent(message) && !isCreatePlaylistIntent(message) && !isRecommendedPlaylistIntent(message)) throw agentError;
          addMessage('assistant', '模型连接失败，我先用本地播放器指令帮你执行。', false);
        }
      }
      if (isRecommendedPlaylistIntent(message)) return await buildRecommendedPlaylistFromTool({}, message);
      if (isPlaylistQueueIntent(message)) return await addPlaylistToQueueFromTool({}, message);
      if (isCreatePlaylistIntent(message)) return await createLocalPlaylistFromTool({}, message);
      if (isSavePlaylistIntent(message)) return await saveMusicToPlaylistFromTool({}, message);
      if (isQueueMusicIntent(message)) return await queueMusicFromTool({}, message);
      if (isSeekIntent(message)) return await seekPlaybackFromTool({}, message);
      if (isSourceManagerIntent(message)) return await openMusicSourceManagerFromTool();
      if (isAudioQualityIntent(message)) return await controlAudioQualityFromTool({}, message);
      if (isLyricAnimationControlIntent(message)) return await controlLyricAnimationFromTool({}, message);
      if (isMineradioInterfaceIntent(message)) return await openMineradioInterfaceFromTool({}, message);
      if (isMineradioAppControlIntent(message)) return await controlMineradioAppFromTool({}, message);
      if (isPlayModeIntent(message)) return await setCurrentPlayMode({}, message);
      if (isTrackSkipIntent(message)) return await skipCurrentTrack({}, message);
      if (isPlaybackControlIntent(message)) return await controlCurrentPlayback({}, message);
      if (isVolumeIntent(message)) return await setPlayerVolume({}, message);
      if (isReplayIntent(message)) return await replayCurrentSong();
      if (isMusicIntent(message)) return await playFromTool(parseMusicCommand(message), message);
      var setupMessage = config.enabled
        ? '这句话需要 AI 理解，模型设置还不完整。播放、界面、设置和明确的软件控制仍可在本地直接执行。'
        : '这句话需要 AI 对话。播放、界面、设置和明确的软件控制无需 API，可在本地直接执行。';
      addMessage('assistant', setupMessage, false);
      setStatus('本地指令可直接使用；仅聊天需要 AI', '');
      return { ok: false, error: 'AGENT_NOT_CONFIGURED' };
    } catch (error) {
      var errorMessage = error && error.message ? error.message : '指令执行失败';
      addMessage('assistant', errorMessage, false);
      setStatus(errorMessage, 'error');
      return { ok: false, error: error && error.code || 'COMMAND_FAILED', message: errorMessage };
    } finally {
      setBusy(false);
      focusChatInputAfterReply();
    }
  }

  function clampPetPosition(x, y) {
    var width = pet ? pet.offsetWidth || 92 : 92;
    var height = pet ? pet.offsetHeight || 112 : 112;
    return {
      x: Math.max(8, Math.min(window.innerWidth - width - 8, Number(x) || 8)),
      y: Math.max(42, Math.min(window.innerHeight - height - 8, Number(y) || 42))
    };
  }

  function setPetPosition(x, y, persist, skipDialogSync) {
    if (!pet) return;
    var previousRect = pet.getBoundingClientRect();
    var position = clampPetPosition(x, y);
    pet.style.left = position.x + 'px';
    pet.style.top = position.y + 'px';
    // auto-collapse near edges
    var edgeThreshold = 20;
    var width = pet.offsetWidth || 92;
    var height = pet.offsetHeight || 112;
    pet.classList.remove('collapsed-left', 'collapsed-right', 'collapsed-top', 'collapsed-bottom');
    if (position.x < edgeThreshold) pet.classList.add('collapsed-left');
    else if (position.x > window.innerWidth - width - edgeThreshold) pet.classList.add('collapsed-right');
    if (position.y < edgeThreshold) pet.classList.add('collapsed-top');
    else if (position.y > window.innerHeight - height - edgeThreshold) pet.classList.add('collapsed-bottom');
    if (persist) {
      try { localStorage.setItem(PET_POSITION_KEY, JSON.stringify(position)); } catch (_error) {}
    }
    if (panel && panel.classList.contains('show') && !skipDialogSync) {
      if (dialogLayout && card && card.classList.contains('custom-sized') && window.innerWidth > 620) {
        applyDialogLayout({
          x: dialogLayout.x + position.x - previousRect.left,
          y: dialogLayout.y + position.y - previousRect.top,
          width: dialogLayout.width,
          height: dialogLayout.height
        }, persist);
      } else {
        positionDialogNearPet();
      }
    }
  }

  function restorePetPosition() {
    if (!pet) return;
    try {
      var saved = JSON.parse(localStorage.getItem(PET_POSITION_KEY) || 'null');
      if (saved && isFinite(saved.x) && isFinite(saved.y)) return setPetPosition(saved.x, saved.y, false);
    } catch (_error) {}
    setPetPosition(window.innerWidth - 132, window.innerHeight - 218, false);
  }

  function savedPetVisibility() {
    try { return localStorage.getItem(PET_VISIBILITY_KEY) !== 'false'; }
    catch (_error) { return true; }
  }

  function setPetVisibility(visible, persist) {
    visible = visible !== false;
    petVisible = visible;
    if (pet) {
      pet.classList.toggle('user-hidden', !visible);
      pet.setAttribute('aria-hidden', visible ? 'false' : 'true');
      pet.tabIndex = visible ? 0 : -1;
      if (visible) startPetBarsAnim();
      else stopPetBarsAnim();
    }
    var advancedToggle = document.getElementById('t-musicAgentPetVisible');
    if (advancedToggle) {
      advancedToggle.classList.toggle('on', visible);
      advancedToggle.setAttribute('aria-checked', visible ? 'true' : 'false');
    }
    if (persist) {
      try { localStorage.setItem(PET_VISIBILITY_KEY, visible ? 'true' : 'false'); } catch (_error) {}
    }
    if (visible && panel && panel.classList.contains('show')) requestAnimationFrame(positionDialogNearPet);
  }

  function togglePetVisibility() {
    setPetVisibility(!petVisible, true);
    if (typeof window.showToast === 'function') {
      window.showToast(petVisible ? '小M悬浮球已显示' : '小M悬浮球已隐藏，可在高级设置中重新显示');
    }
  }

  function restoreDialogLayout() {
    if (dialogLayoutRestored) return;
    dialogLayoutRestored = true;
    try {
      var saved = JSON.parse(localStorage.getItem(DIALOG_LAYOUT_KEY) || 'null');
      if (saved && isFinite(saved.x) && isFinite(saved.y) && isFinite(saved.width) && isFinite(saved.height)) dialogLayout = saved;
    } catch (_error) { dialogLayout = null; }
  }

  function clampDialogLayout(layout) {
    var maxWidth = Math.max(280, window.innerWidth - 16);
    var maxHeight = Math.max(280, window.innerHeight - 16);
    var minWidth = Math.min(360, maxWidth);
    var minHeight = Math.min(330, maxHeight);
    var width = Math.max(minWidth, Math.min(maxWidth, Number(layout && layout.width) || 520));
    var height = Math.max(minHeight, Math.min(maxHeight, Number(layout && layout.height) || 430));
    return {
      x: Math.max(8, Math.min(window.innerWidth - width - 8, Number(layout && layout.x) || 8)),
      y: Math.max(8, Math.min(window.innerHeight - height - 8, Number(layout && layout.y) || 8)),
      width: width,
      height: height
    };
  }

  function applyDialogLayout(layout, persist) {
    if (!card || !layout) return;
    dialogLayout = clampDialogLayout(layout);
    card.style.left = dialogLayout.x + 'px';
    card.style.top = dialogLayout.y + 'px';
    card.style.width = dialogLayout.width + 'px';
    card.style.height = dialogLayout.height + 'px';
    card.classList.add('custom-sized', 'detached-tail');
    card.classList.remove('tail-top');
    if (persist) {
      try { localStorage.setItem(DIALOG_LAYOUT_KEY, JSON.stringify(dialogLayout)); } catch (_error) {}
    }
  }

  function dialogLayoutIsNearPet(layout) {
    if (!pet || !layout) return false;
    var petRect = pet.getBoundingClientRect();
    var right = Number(layout.x) + Number(layout.width);
    var bottom = Number(layout.y) + Number(layout.height);
    var horizontalGap = Math.max(0, Math.max(Number(layout.x) - petRect.right, petRect.left - right));
    var verticalGap = Math.max(0, Math.max(Number(layout.y) - petRect.bottom, petRect.top - bottom));
    return horizontalGap <= 120 && verticalGap <= 120;
  }

  function sizedDialogLayoutNearPet(width, height) {
    var petRect = pet.getBoundingClientRect();
    width = Math.max(280, Math.min(window.innerWidth - 16, Number(width) || 520));
    height = Math.max(280, Math.min(window.innerHeight - 16, Number(height) || 430));
    var above = petRect.top - height - 10 >= 8;
    var below = petRect.bottom + height + 10 <= window.innerHeight - 8;
    var top = above ? petRect.top - height - 10 : (below ? petRect.bottom + 10 : petRect.top + petRect.height / 2 - height / 2);
    var petCenter = petRect.left + petRect.width / 2;
    var left = (!above && !below)
      ? (petRect.left - width - 10 >= 8 ? petRect.left - width - 10 : petRect.right + 10)
      : petCenter - width + 48;
    return clampDialogLayout({ x: left, y: top, width: width, height: height });
  }

  function dockPetToDialog() {
    if (!pet || !card || window.innerWidth <= 620) return;
    var cardRect = card.getBoundingClientRect();
    var petWidth = pet.offsetWidth || 92;
    var petHeight = pet.offsetHeight || 112;
    var x = cardRect.right - petWidth - 18;
    var y = cardRect.bottom + 10;
    if (y + petHeight > window.innerHeight - 8) y = cardRect.top - petHeight - 10;
    if (y < 42) {
      x = cardRect.right + 10;
      y = cardRect.bottom - petHeight;
      if (x + petWidth > window.innerWidth - 8) x = cardRect.left - petWidth - 10;
    }
    setPetPosition(x, y, true, true);
  }

  function resetDialogLayout() {
    dialogLayout = null;
    dialogLayoutRestored = true;
    try { localStorage.removeItem(DIALOG_LAYOUT_KEY); } catch (_error) {}
    if (card) {
      card.style.width = '';
      card.style.height = '';
      card.classList.remove('custom-sized', 'detached-tail', 'tail-top');
    }
    positionDialogNearPet();
    setStatus('对话框大小和位置已重置', 'success');
  }

  function positionDialogNearPet() {
    if (!pet || !card) return;
    restoreDialogLayout();
    if (dialogLayout && window.innerWidth > 620) {
      if (!dialogLayoutIsNearPet(dialogLayout)) dialogLayout = sizedDialogLayoutNearPet(dialogLayout.width, dialogLayout.height);
      applyDialogLayout(dialogLayout, true);
      return;
    }
    var petRect = pet.getBoundingClientRect();
    var width = Math.min(520, window.innerWidth - 32);
    card.style.height = '';
    card.classList.remove('custom-sized');
    card.style.width = width + 'px';
    card.style.left = '12px';
    card.style.top = '12px';
    var cardHeight = card.offsetHeight || 430;
    var above = petRect.top - cardHeight - 10 >= 10;
    var below = petRect.bottom + cardHeight + 10 <= window.innerHeight - 10;
    var top = above ? petRect.top - cardHeight - 10 : (below ? petRect.bottom + 10 : petRect.top + petRect.height / 2 - cardHeight / 2);
    top = Math.max(10, Math.min(window.innerHeight - cardHeight - 10, top));
    var petCenter = petRect.left + petRect.width / 2;
    var detached = !above && !below;
    var left = detached
      ? (petRect.left - width - 10 >= 8 ? petRect.left - width - 10 : petRect.right + 10)
      : Math.max(16, Math.min(window.innerWidth - width - 16, petCenter - width + 48));
    left = Math.max(8, Math.min(window.innerWidth - width - 8, left));
    var tailX = Math.max(26, Math.min(width - 26, petCenter - left));
    card.style.left = left + 'px';
    card.style.top = top + 'px';
    card.style.setProperty('--agent-tail-x', tailX + 'px');
    card.classList.toggle('tail-top', !above);
    card.classList.toggle('detached-tail', detached);
  }

  function switchView(view) {
    currentView = view === 'settings' ? 'settings' : 'chat';
    if (!panel) return;
    requestNativeKeyboardFocus('switch-' + currentView);
    panel.querySelector('.music-agent-chat-view').hidden = currentView !== 'chat';
    panel.querySelector('.music-agent-settings-view').hidden = currentView !== 'settings';
    panel.querySelector('.music-agent-settings-toggle').classList.toggle('active', currentView === 'settings');
    requestAnimationFrame(positionDialogNearPet);
    setTimeout(function () {
      var active = document.activeElement;
      if (active && isEditableAgentFocusTarget(active) &&
          active !== input && (!settingsForm || !settingsForm.contains(active))) return;
      if (currentView === 'chat' && input && !input.disabled) input.focus();
      if (currentView === 'settings' && settingsForm) settingsForm.elements.provider.focus();
    }, 30);
  }

  function openPanel() {
    ensureUi();
    requestNativeKeyboardFocus('open');
    updateDailyRecommendationExample();
    panel.classList.add('show');
    panel.setAttribute('aria-hidden', 'false');
    if (pet) pet.classList.add('talking');
    loadAgentConfig(true).catch(function (error) { setStatus(error.message, 'error'); });
    requestAnimationFrame(positionDialogNearPet);
    setTimeout(function () { if (currentView === 'chat' && input) input.focus(); }, 40);
  }

  function closePanel() {
    if (!panel) return;
    cancelPendingChatFocus();
    if (voiceListening) stopVoiceInput();
    panel.classList.remove('show');
    panel.setAttribute('aria-hidden', 'true');
    if (pet) pet.classList.remove('talking');
  }

  function togglePanel() {
    ensureUi();
    if (panel.classList.contains('show')) closePanel();
    else openPanel();
  }

  function ensurePet() {
    if (pet) return;
    pet = document.createElement('button');
    pet.id = 'music-agent-pet';
    pet.className = 'music-agent-pet';
    pet.type = 'button';
    pet.setAttribute('aria-label', '音乐桌宠：拖动位置，点击对话');
    pet.innerHTML =
      '<div class="music-agent-pet-inner" aria-hidden="true">' +
      '<i class="music-agent-pet-ring"></i>' +
      '<i class="music-agent-pet-ripple"></i>' +
      '<div class="music-agent-pet-orb">' +
        '<i class="music-agent-pet-wave w1"></i>' +
        '<i class="music-agent-pet-wave w2"></i>' +
        '<i class="music-agent-pet-wave w3"></i>' +
        '<i class="music-agent-pet-bars"><i></i><i></i><i></i><i></i><i></i></i>' +
        '<i class="music-agent-pet-dot"></i>' +
      '</div></div>' +
      '<span class="music-agent-pet-tip">拖动我 · 点击对话</span>';
    document.body.appendChild(pet);
    restorePetPosition();
    startPetBarsAnim();
    pet.addEventListener('pointerdown', function (event) {
      if (event.button != null && event.button !== 0) return;
      var rect = pet.getBoundingClientRect();
      dragState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, moved: false };
      pet.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    pet.addEventListener('pointermove', function (event) {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      if (Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) > 5) dragState.moved = true;
      if (!dragState.moved) return;
      pet.classList.add('dragging');
      setPetPosition(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY, false);
      event.preventDefault();
    });
    function finishPointer(event) {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      var moved = dragState.moved;
      dragState = null;
      pet.classList.remove('dragging');
      try { pet.releasePointerCapture(event.pointerId); } catch (_error) {}
      var rect = pet.getBoundingClientRect();
      if (moved) setPetPosition(rect.left, rect.top, true);
      else if (panel && panel.classList.contains('show')) closePanel();
      else openPanel();
    }
    pet.addEventListener('pointerup', finishPointer);
    pet.addEventListener('pointercancel', finishPointer);
    pet.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (panel && panel.classList.contains('show')) closePanel(); else openPanel();
      }
    });
  }

  // --- pet equalizer bars: driven by window.__mineradioAgentAudio ---
  var petBarsRaf = null;
  var petBarSmooth = [0, 0, 0, 0, 0]; // smoothed heights per bar

  function startPetBarsAnim() {
    if (petBarsRaf) return;
    var bandKeys = ['subBass', 'bass', 'energy', 'mid', 'treble'];
    var minH = [4, 5, 5, 5, 4];
    var maxH = [20, 22, 24, 22, 20];
    function tick() {
      petBarsRaf = requestAnimationFrame(tick);
      if (!pet) return;
      // re-query every frame so rebuilds are handled
      var barEls = pet.querySelectorAll('.music-agent-pet-bars > i');
      if (!barEls.length) return;
      var aud = window.__mineradioAgentAudio;
      for (var i = 0; i < barEls.length; i++) {
        var raw = aud ? Math.min(1, (aud[bandKeys[i]] || 0) * 1.6) : 0;
        var prev = petBarSmooth[i] || 0;
        petBarSmooth[i] = raw > prev
          ? prev * 0.20 + raw * 0.80
          : prev * 0.65 + raw * 0.35;
        var h = minH[i] + (maxH[i] - minH[i]) * petBarSmooth[i];
        barEls[i].style.height = h.toFixed(1) + 'px';
      }
    }
    tick();
  }

  function stopPetBarsAnim() {
    if (petBarsRaf) { cancelAnimationFrame(petBarsRaf); petBarsRaf = null; }
  }

  function bindDialogInteractions() {
    if (!card) return;
    var head = card.querySelector('.music-agent-head');
    var resizeHandle = card.querySelector('.music-agent-resize-handle');
    if (head) {
      head.addEventListener('pointerdown', function (event) {
        if (event.button != null && event.button !== 0) return;
        if (event.target.closest('button,input,select,a')) return;
        var rect = card.getBoundingClientRect();
        dialogDragState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: rect.left, y: rect.top, width: rect.width, height: rect.height, moved: false };
        card.classList.add('dragging');
        try { head.setPointerCapture(event.pointerId); } catch (_error) {}
        event.preventDefault();
      });
      head.addEventListener('pointermove', function (event) {
        if (!dialogDragState || dialogDragState.pointerId !== event.pointerId) return;
        if (!dialogDragState.moved && Math.hypot(event.clientX - dialogDragState.startX, event.clientY - dialogDragState.startY) < 3) return;
        dialogDragState.moved = true;
        card.classList.add('custom-sized', 'detached-tail');
        applyDialogLayout({
          x: dialogDragState.x + event.clientX - dialogDragState.startX,
          y: dialogDragState.y + event.clientY - dialogDragState.startY,
          width: dialogDragState.width,
          height: dialogDragState.height
        }, false);
        event.preventDefault();
      });
      function finishDialogDrag(event) {
        if (!dialogDragState || dialogDragState.pointerId !== event.pointerId) return;
        var moved = dialogDragState.moved;
        dialogDragState = null;
        card.classList.remove('dragging');
        try { head.releasePointerCapture(event.pointerId); } catch (_error) {}
        if (moved && dialogLayout) {
          applyDialogLayout(dialogLayout, true);
          dockPetToDialog();
        }
      }
      head.addEventListener('pointerup', finishDialogDrag);
      head.addEventListener('pointercancel', finishDialogDrag);
    }
    if (resizeHandle) {
      resizeHandle.addEventListener('pointerdown', function (event) {
        if (event.button != null && event.button !== 0) return;
        var rect = card.getBoundingClientRect();
        dialogResizeState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        card.classList.add('resizing', 'custom-sized', 'detached-tail');
        try { resizeHandle.setPointerCapture(event.pointerId); } catch (_error) {}
        event.preventDefault();
        event.stopPropagation();
      });
      resizeHandle.addEventListener('pointermove', function (event) {
        if (!dialogResizeState || dialogResizeState.pointerId !== event.pointerId) return;
        applyDialogLayout({
          x: dialogResizeState.x,
          y: dialogResizeState.y,
          width: dialogResizeState.width + event.clientX - dialogResizeState.startX,
          height: dialogResizeState.height + event.clientY - dialogResizeState.startY
        }, false);
        event.preventDefault();
      });
      function finishDialogResize(event) {
        if (!dialogResizeState || dialogResizeState.pointerId !== event.pointerId) return;
        dialogResizeState = null;
        card.classList.remove('resizing');
        try { resizeHandle.releasePointerCapture(event.pointerId); } catch (_error) {}
        if (dialogLayout) {
          applyDialogLayout(dialogLayout, true);
          dockPetToDialog();
        }
      }
      resizeHandle.addEventListener('pointerup', finishDialogResize);
      resizeHandle.addEventListener('pointercancel', finishDialogResize);
    }
    // bind all 8-direction resize handles
    var resizeHandles = card.querySelectorAll('.music-agent-resize-handle[data-resize-dir]');
    resizeHandles.forEach(function(handle) {
      var dir = handle.getAttribute('data-resize-dir');
      handle.addEventListener('pointerdown', function (event) {
        if (event.button != null && event.button !== 0) return;
        var rect = card.getBoundingClientRect();
        dialogResizeState = { pointerId: event.pointerId, dir: dir, startX: event.clientX, startY: event.clientY, x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        card.classList.add('resizing', 'custom-sized', 'detached-tail');
        try { handle.setPointerCapture(event.pointerId); } catch (_error) {}
        event.preventDefault();
        event.stopPropagation();
      });
      handle.addEventListener('pointermove', function (event) {
        if (!dialogResizeState || dialogResizeState.pointerId !== event.pointerId) return;
        var dx = event.clientX - dialogResizeState.startX;
        var dy = event.clientY - dialogResizeState.startY;
        var newLayout = { x: dialogResizeState.x, y: dialogResizeState.y, width: dialogResizeState.width, height: dialogResizeState.height };
        if (dir.includes('e')) newLayout.width = dialogResizeState.width + dx;
        if (dir.includes('w')) { newLayout.width = dialogResizeState.width - dx; newLayout.x = dialogResizeState.x + dx; }
        if (dir.includes('s')) newLayout.height = dialogResizeState.height + dy;
        if (dir.includes('n')) { newLayout.height = dialogResizeState.height - dy; newLayout.y = dialogResizeState.y + dy; }
        applyDialogLayout(newLayout, false);
        event.preventDefault();
      });
      function finishResize(event) {
        if (!dialogResizeState || dialogResizeState.pointerId !== event.pointerId) return;
        dialogResizeState = null;
        card.classList.remove('resizing');
        try { handle.releasePointerCapture(event.pointerId); } catch (_error) {}
        if (dialogLayout) {
          applyDialogLayout(dialogLayout, true);
          dockPetToDialog();
        }
      }
      handle.addEventListener('pointerup', finishResize);
      handle.addEventListener('pointercancel', finishResize);
    });
  }

  function ensureUi() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'music-agent-command-mask';
    panel.className = 'music-agent-mask';
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML =
      '<section class="music-agent-card" role="dialog" aria-labelledby="music-agent-title">' +
        '<i class="music-agent-glow" aria-hidden="true"></i>' +
        '<div class="music-agent-head"><div class="music-agent-heading"><div class="music-agent-kicker">MINERADIO AGENT</div>' +
        '<div class="music-agent-title-row"><div class="music-agent-title" id="music-agent-title">小M</div><span class="music-agent-mode-badge">本地软件控制</span></div>' +
        '<div class="music-agent-sub">自然语言控制整个 Mineradio · 软件功能无需账号登录</div></div>' +
        '<div class="music-agent-head-actions"><button class="music-agent-settings-toggle" type="button" aria-label="AI 设置" title="AI 设置">⚙</button>' +
        '<button class="music-agent-close" type="button" aria-label="关闭">×</button></div></div>' +
        '<div class="music-agent-chat-view">' +
          '<div class="music-agent-chat-log" aria-live="polite"></div>' +
          '<form class="music-agent-form"><input class="music-agent-input" type="text" name="music-agent-command" autocomplete="off" spellcheck="false" placeholder="和小M说话，或让它播放一首歌…" aria-label="发送给音乐 Agent">' +
          '<button class="music-agent-voice" type="button" aria-label="语音转文字" title="语音转文字"><span aria-hidden="true"></span></button>' +
          '<button class="music-agent-submit" type="submit">发送</button></form>' +
          '<div class="music-agent-status" role="status" aria-live="polite">无需 API：播放、界面、设置和明确的软件控制均在本地执行。</div>' +
          '<div class="music-agent-examples"><button class="music-agent-example" type="button" data-agent-daily-recommendation data-agent-example="">试着对我说：播放一首歌</button>' +
          '<button class="music-agent-example" type="button" data-agent-example="导入歌单">导入歌单</button>' +
          '<button class="music-agent-example" type="button" data-agent-example="打开音源">打开音源</button></div>' +
        '</div>' +
        '<div class="music-agent-settings-view" hidden><form class="music-agent-settings-form">' +
          '<label class="music-agent-enable"><span><b>启用 AI 对话</b><small>关闭后仍可使用本地播放、歌单和 DIY 设置</small></span><input type="checkbox" name="enabled"><i aria-hidden="true"></i></label>' +
          '<label class="music-agent-field"><span>模型提供商</span><select name="provider">' +
            '<option value="openai">OpenAI</option><option value="anthropic">Claude（Anthropic）</option><option value="gemini">Gemini</option>' +
            '<option value="deepseek">DeepSeek</option><option value="qwen">千问（阿里云百炼）</option><option value="kimi">Kimi（月之暗面）</option>' +
            '<option value="ollama">Ollama（本地）</option><option value="custom">自定义 OpenAI Compatible</option>' +
          '</select></label>' +
          '<button type="button" class="music-agent-api-apply">申请 OpenAI API Key ↗</button>' +
          '<label class="music-agent-field music-agent-key-row"><span>API Key <em>Ollama / 无鉴权接口可留空</em></span><input type="password" name="apiKey" autocomplete="new-password" placeholder="留空表示保留已保存的 Key"></label>' +
          '<label class="music-agent-field"><span>Base URL</span><input type="url" name="baseUrl" required spellcheck="false"></label>' +
          '<label class="music-agent-field"><span>模型名称</span><select name="model" required></select></label>' +
          '<label class="music-agent-field music-agent-custom-model" hidden><span>自定义模型 ID</span><input type="text" name="customModel" spellcheck="false" placeholder="输入接口支持的模型 ID"></label>' +
          '<p class="music-agent-settings-hint"></p>' +
          '<div class="music-agent-settings-actions"><button type="button" class="music-agent-key-clear">清除 Key</button><span></span>' +
          '<button type="button" class="music-agent-test">测试连接</button><button type="submit" class="music-agent-save">保存</button></div>' +
          '<div class="music-agent-utility-actions"><button type="button" class="music-agent-memory-clear">清除对话记忆</button><button type="button" class="music-agent-layout-reset">重置窗口大小和位置</button></div>' +
          '<p class="music-agent-privacy">测试连接会向所选服务发送一次最小请求，可能产生少量 API 费用。项目不内置、不收集你的密钥。</p>' +
        '</form></div>' +
        '<i class="music-agent-resize-handle resize-e" data-resize-dir="e"></i>' +
        '<i class="music-agent-resize-handle resize-s" data-resize-dir="s"></i>' +
        '<i class="music-agent-resize-handle resize-w" data-resize-dir="w"></i>' +
        '<i class="music-agent-resize-handle resize-n" data-resize-dir="n"></i>' +
        '<i class="music-agent-resize-handle resize-se" data-resize-dir="se"></i>' +
        '<i class="music-agent-resize-handle resize-sw" data-resize-dir="sw"></i>' +
        '<i class="music-agent-resize-handle resize-ne" data-resize-dir="ne"></i>' +
        '<i class="music-agent-resize-handle resize-nw" data-resize-dir="nw"></i>' +
      '</section>';
    document.body.appendChild(panel);
    card = panel.querySelector('.music-agent-card');
    input = panel.querySelector('.music-agent-input');
    submitButton = panel.querySelector('.music-agent-submit');
    voiceButton = panel.querySelector('.music-agent-voice');
    status = panel.querySelector('.music-agent-status');
    chatLog = panel.querySelector('.music-agent-chat-log');
    settingsForm = panel.querySelector('.music-agent-settings-form');
    settingsHint = panel.querySelector('.music-agent-settings-hint');
    modeBadge = panel.querySelector('.music-agent-mode-badge');
    updateDailyRecommendationExample();
    restoreChatHistory();
    if (chatHistory.length) chatHistory.forEach(function (item) { addMessage(item.role, item.content, false); });
    else addMessage('assistant', '你好，我是小M。你可以让我播放歌曲、打开界面或控制 Mineradio 的各项功能；配置模型后也可以直接聊天。', false);
    bindDialogInteractions();
    panel.querySelector('.music-agent-close').addEventListener('click', closePanel);
    panel.querySelector('.music-agent-settings-toggle').addEventListener('click', function () { switchView(currentView === 'settings' ? 'chat' : 'settings'); });
    // The voice control is optional. Some builds do not render it; do not let
    // that prevent the form's submit handler (registered below) from loading.
    if (voiceButton) voiceButton.addEventListener('click', toggleVoiceInput);
    panel.addEventListener('pointerdown', function () {
      requestNativeKeyboardFocus('panel-pointerdown');
    }, true);
    panel.addEventListener('click', function (event) {
      if (event.target === panel) closePanel();
      var example = event.target.closest('[data-agent-example]');
      if (example && !busy) {
        switchView('chat');
        input.value = example.getAttribute('data-agent-example') || '';
        input.focus();
      }
    });
    panel.querySelector('.music-agent-form').addEventListener('submit', function (event) { event.preventDefault(); runCommand(input.value); });
    document.addEventListener('keydown', function (event) {
      if (!panel.classList.contains('show') || currentView !== 'chat' || busy || voiceListening || voiceProcessing || event.defaultPrevented) return;
      if (event.key === 'Escape' || event.altKey) return;
      var activeTarget = event.target || document.activeElement;
      // Do not hijack typing from Mineradio search, modal inputs, textareas,
      // selects, or any other editable control outside the XiaoM input.
      if (activeTarget !== input && isEditableAgentFocusTarget(activeTarget)) return;
      // Buttons and controls in other Mineradio panels must keep their own
      // keyboard handling while XiaoM remains open in the background.
      if (activeTarget && activeTarget !== document.body && activeTarget !== document.documentElement &&
          activeTarget !== input && !panel.contains(activeTarget)) return;
      if ((event.ctrlKey || event.metaKey) && String(event.key || '').toLowerCase() === 'v') {
        input.focus();
        return;
      }
      if (event.ctrlKey || event.metaKey) return;
      if (document.activeElement === input) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        input.focus();
        if (input.value.trim()) runCommand(input.value);
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        input.value = input.value.slice(0, -1);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        return;
      }
      if (String(event.key || '').length === 1) {
        event.preventDefault();
        input.value += event.key;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }
    }, true);
    settingsForm.elements.provider.addEventListener('change', function () { updateProviderFields(true, ''); });
    settingsForm.elements.model.addEventListener('change', updateCustomModelVisibility);
    settingsForm.elements.apiKey.addEventListener('focus', function () {
      if (this.dataset.saved === 'true' && this.dataset.dirty !== 'true') {
        this.type = 'password';
        this.value = '';
        this.classList.remove('saved');
        this.placeholder = '输入新 Key；留空仍保留原 Key';
      }
    });
    settingsForm.elements.apiKey.addEventListener('input', function () {
      this.dataset.dirty = this.value ? 'true' : 'false';
    });
    settingsForm.elements.apiKey.addEventListener('blur', function () {
      if (!this.value && agentConfig && agentConfig.hasApiKey) renderSavedKey();
    });
    settingsForm.elements.enabled.addEventListener('change', function () {
      if (busy) {
        this.checked = !!(agentConfig && agentConfig.enabled);
        return;
      }
      saveAiEnabledImmediately(this.checked);
    });
    settingsForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      saveSettings(true).catch(function (error) { setStatus(error.message || '保存失败', 'error'); }).finally(function () { setBusy(false); });
    });
    panel.querySelector('.music-agent-test').addEventListener('click', testConnection);
    panel.querySelector('.music-agent-api-apply').addEventListener('click', openProviderApiPortal);
    panel.querySelector('.music-agent-key-clear').addEventListener('click', clearSavedKey);
    panel.querySelector('.music-agent-memory-clear').addEventListener('click', function () {
      if (busy) {
        setStatus('请等待当前操作完成后再清除对话记忆', 'error');
        return;
      }
      if (window.confirm('确定清除本机保存的小M对话记忆吗？')) clearConversationMemory();
    });
    panel.querySelector('.music-agent-layout-reset').addEventListener('click', resetDialogLayout);
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && panel && panel.classList.contains('show')) closePanel();
  });

  // Electron desktop-fusion windows are hosted beneath Explorer. Closing a
  // native confirm dialog can leave Chromium visible and clickable but without
  // keyboard focus. Restore webContents focus immediately on the next click in
  // any editable Mineradio control instead of waiting for Windows to recover it.
  document.addEventListener('pointerdown', function (event) {
    if (!event || event.isTrusted === false) return;
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    if (!target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"],#search-box')) return;
    requestNativeKeyboardFocus('editable-pointerdown');
  }, true);

  function initialize() { ensurePet(); ensureUi(); setPetVisibility(savedPetVisibility(), false); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
  window.addEventListener('resize', function () {
    if (!pet) return;
    var rect = pet.getBoundingClientRect();
    setPetPosition(rect.left, rect.top, false);
  });

  window.MineradioMusicAgentCommand = { open: openPanel, close: closePanel, toggle: togglePanel, run: runCommand, parse: parseMusicCommand, setPetVisible: setPetVisibility, togglePetVisible: togglePetVisibility };
  window.openMineradioMusicAgent = openPanel;
})();
