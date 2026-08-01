const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`缺少文件: ${relativePath}`);
    return '';
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function requireText(relativePath, text, label) {
  if (!text.includes(label)) fail(`${relativePath} 缺少发布能力标记: ${label}`);
}

function checkPortableExecutable(relativePath, minimumBytes) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`缺少转换工具: ${relativePath}`);
    return;
  }
  const stat = fs.statSync(absolutePath);
  if (stat.size < minimumBytes) fail(`${relativePath} 文件大小异常: ${stat.size}`);
  const header = Buffer.alloc(2);
  const fd = fs.openSync(absolutePath, 'r');
  try { fs.readSync(fd, header, 0, 2, 0); } finally { fs.closeSync(fd); }
  if (header.toString('ascii') !== 'MZ') fail(`${relativePath} 不是有效的 Windows 可执行文件`);
}

const packageJson = JSON.parse(read('package.json'));
const releaseVersion = packageJson.mineradio && packageJson.mineradio.releaseVersion;
if (packageJson.version !== '1.5.7') fail(`npm package version 未同步为 1.5.7，实际为 ${packageJson.version}`);
if (packageJson.build.buildVersion !== '1.5.7.1') fail('Windows buildVersion 未同步为 1.5.7.1');
if (releaseVersion !== '1.5.7.1') fail('应用内 releaseVersion 未同步为 1.5.7.1');
if (!packageJson.build.files.includes('bin/**/*')) fail('安装包未声明包含 bin/**/*');
if (!packageJson.build.files.includes('node_modules/qrcode/**/*')) fail('安装包未显式声明包含 qrcode 运行时');
if (!packageJson.build.files.includes('LICENSE')) fail('安装包未声明包含 GPL-3.0 LICENSE');
if (!packageJson.build.files.includes('!public/**/*.map')) fail('正式安装包未排除前端源码映射文件');
if (!packageJson.build.files.includes('!build/finalize-windows-release.js')) fail('正式安装包未排除仅用于发布机的收尾脚本');
if (packageJson.build.nsis.artifactName !== 'Mineradio.Setup.1.5.7.1.${ext}') fail('安装包文件名版本不正确');
if (!packageJson.scripts['build:win'].includes('build/finalize-windows-release.js')) fail('Windows 构建未固定 latest.yml 的发布版本');
if (packageJson.dependencies.qrcode !== '1.5.4') fail('局域网遥控二维码运行时依赖 qrcode@1.5.4 未固定');
try {
  const QRCode = require(path.join(root, 'node_modules', 'qrcode'));
  if (!QRCode || typeof QRCode.toDataURL !== 'function') fail('qrcode 运行时接口不可用');
} catch (error) {
  fail(`qrcode 运行时依赖无法加载: ${error.message}`);
}

const mainSource = read('desktop/main.js');
const indexSource = read('public/index.html');
const installerSource = read('build/installer.nsh');
const converterSource = read('wallpaper-converter.js');
const serverSource = read('server.js');
const preloadSource = read('desktop/preload.js');
const proxySource = read('desktop/direct-local-proxy.js');

requireText('desktop/main.js', mainSource, "writeStartupDiagnostic('app-when-ready'");
requireText('desktop/main.js', mainSource, 'setIgnoreMouseEvents(true)');
requireText('desktop/main.js', mainSource, 'mainWindowSplashWatchdogTimer');
requireText('desktop/main.js', mainSource, 'splash watchdog forced the home screen to reveal');
requireText('desktop/main.js', mainSource, "process.platform !== 'win32' || !app.isPackaged");
requireText('desktop/main.js', mainSource, "'startup-storage-preserved'");
requireText('desktop/main.js', mainSource, "require('./full-desktop-mode-runtime')");
requireText('desktop/main.js', mainSource, 'enableDesktopFusionOverlay(payload || {})');
requireText('desktop/main.js', mainSource, "iconLayerMode: enabled ? 'workerw-toggle' : ''");
requireText('desktop/main.js', mainSource, 'setMainWindowDesktopEmbedded(true, { force:true })');
requireText('desktop/main.js', mainSource, 'setMainWindowDesktopInteractive(!desired)');
if (/fullDesktopModeRuntime\s*\.\s*enable\s*\(/.test(mainSource) || /getFullDesktopModeRuntime\(\)\s*\.\s*enable\s*\(/.test(mainSource)) {
  fail('桌面融合仍可能启动复制图标的旧原生运行时');
}
requireText('desktop/main.js', mainSource, "process.env.MINERADIO_FORCE_DIRECT_ROUTE === '1'");
requireText('desktop/main.js', mainSource, "setProxy({ mode: 'system' })");
if (/clearStorageData\s*\(\s*\{\s*storages\s*:\s*\[\s*['"]localstorage['"]\s*\]/.test(mainSource)) {
  fail('desktop/main.js 鍚姩鎭㈠浠嶄細娓呯┖鍏ㄩ儴 localStorage');
}
requireText('server.js', serverSource, "persist:mineradio-system-network");
requireText('server.js', serverSource, "hostname.endsWith('.spotify.com')");
requireText('public/index.html', indexSource, 'body.desktop-wallpaper-mode #fullscreen-diy-zone');
requireText('public/index.html', indexSource, 'body.desktop-embedded #fullscreen-diy-zone');
requireText('public/index.html', indexSource, 'body.desktop-wallpaper-mode #mobile-back-btn');
requireText('public/index.html', indexSource, 'body.desktop-wallpaper-mode #mobile-diy-btn');
requireText('public/index.html', indexSource, 'html.desktop-native-root #mobile-back-btn');
requireText('public/index.html', indexSource, 'html.desktop-native-root #mobile-diy-btn');
requireText('public/index.html', indexSource, 'id="desktop-fusion-corners"');
requireText('public/index.html', indexSource, 'body.desktop-shell.desktop-embedded.desktop-software-locked #desktop-window-shell > *{pointer-events:none!important}');
if (/desktop-software-locked[^\n{]*[^\n]*\{[^}]*visibility\s*:\s*hidden/i.test(indexSource)) {
  fail('桌面融合锁定态仍会隐藏 Mineradio 画面');
}
requireText('public/index.html', indexSource, 'id="app-nav-diy"');
requireText('public/index.html', indexSource, 'onclick="toggleDiyMode()"');
requireText('public/index.html', indexSource, "['diy-mode-btn', 'fullscreen-diy-btn', 'app-nav-diy']");
requireText('public/index.html', indexSource, 'data-corner="tl"');
requireText('public/index.html', indexSource, 'data-corner="tr"');
requireText('public/index.html', indexSource, 'data-corner="bl"');
requireText('public/index.html', indexSource, 'data-corner="br"');
requireText('public/index.html', indexSource, 'function toggleDesktopFusionCornerControl');
requireText('desktop/preload.js', preloadSource, 'setDesktopSoftwareLocked:');
requireText('desktop/preload.js', preloadSource, 'updateDesktopPointerRoute:');
requireText('desktop/preload.js', preloadSource, 'onWallpaperModeState:');
requireText('public/index.html', indexSource, 'id="now-flow-time"');
requireText('public/index.html', indexSource, 'function setPlaybackTimeText(text)');
requireText('public/index.html', indexSource, "nowFlowProgressBar.addEventListener('click'");
const nowFlowRootTag = (indexSource.match(/<div id="now-flow"[^>]*>/) || [''])[0];
if (!nowFlowRootTag) fail('public/index.html 缺少 Now Flow 播放条根节点');
if (/onclick\s*=/.test(nowFlowRootTag)) fail('Now Flow 播放条空白区域仍会切换播放状态');
requireText('public/index.html', indexSource, 'function getAdaptiveRenderFps()');
requireText('public/index.html', indexSource, 'remaining = (1000 / fps)');
requireText('public/index.html', indexSource, 'var RENDER_VISIBLE_VSYNC = true;');
requireText('public/index.html', indexSource, 'function markSplashReadyToEnter()');
requireText('public/index.html', indexSource, 'Never leave a first-time install waiting indefinitely on the intro.');
requireText('public/index.html', indexSource, 'A click/keyboard action is an explicit request to enter.');
requireText('public/index.html', indexSource, "performanceQuality: 'ultra'");
requireText('public/index.html', indexSource, 'mineradio-performance-ultra-default-v1');
requireText('public/index.html', indexSource, `Mineradio v${releaseVersion}`);
requireText('public/index.html', indexSource, `currentVersion: '${releaseVersion}'`);
if (indexSource.includes('1.5.5.1')) fail('public/index.html 仍包含上一版 1.5.5.1 的界面或更新兜底版本');
requireText('build/installer.nsh', installerSource, 'MINERADIO_INSTALL_MARKER');
requireText('build/installer.nsh', installerSource, '!macro customRemoveFiles');
requireText('build/installer.nsh', installerSource, 'MineradioDisableUnsafeOldUninstallers');
requireText('build/installer.nsh', installerSource, 'MineradioExistingInstallPathCanBeAdopted');
requireText('build/installer.nsh', installerSource, 'MineradioValidateInstallDir');
requireText('build/installer.nsh', installerSource, 'un.MineradioValidateUninstallDir');
requireText('public/index.html', indexSource, 'function renderOnlineArtistOverview()');
requireText('public/index.html', indexSource, 'function createSoundFieldChain(ctx)');
requireText('public/index.html', indexSource, 'id="fx-player-spectrum-height"');
requireText('public/index.html', indexSource, 'id="t-homeAlwaysTransparent"');
requireText('public/index.html', indexSource, 'id="fx-desktoplyricsx"');
requireText('server.js', serverSource, "pn === '/api/remote/info'");
requireText('desktop/preload.js', preloadSource, 'exportTextFile:');
requireText('desktop/preload.js', preloadSource, 'copyText: (text)');
requireText('desktop/preload.js', preloadSource, 'suppressDesktopOnlyMobileNavigation();');
requireText('desktop/preload.js', preloadSource, "element.style.setProperty('display', 'none', 'important')");
requireText('desktop/preload.js', preloadSource, "ipcRenderer.invoke('mineradio-clipboard-read-text')");
requireText('desktop/main.js', mainSource, "ipcMain.handle('mineradio-clipboard-write-text'");
requireText('desktop/main.js', mainSource, "ipcMain.handle('mineradio-clipboard-read-text'");
requireText('desktop/main.js', mainSource, "require('./direct-local-proxy')");
requireText('desktop/direct-local-proxy.js', proxySource, 'createDirectLocalProxy');
requireText('desktop/main.js', mainSource, "path.join(__dirname, '..', 'bin', 'ffmpeg.exe')");
requireText('wallpaper-converter.js', converterSource, "path.join(this.appDir, 'bin', 'ffmpeg.exe')");
requireText('wallpaper-converter.js', converterSource, "path.join(this.appDir, 'bin', 'repkg', 'RePKG.exe')");
requireText('public/index.html', indexSource, "lxSourceOneClickButton.addEventListener('click', oneClickImportLxSource)");
requireText('public/index.html', indexSource, 'body.empty-home-active #search-area{top:24px;opacity:1;pointer-events:auto}');
requireText('public/index.html', indexSource, '一次选择一个或多个本地落雪音源脚本并导入');
requireText('public/index.html', indexSource, '主要使用枪码复制和导入');
requireText('public/index.html', indexSource, "var USER_FX_SHARE_PREFIX = 'MR2'");
requireText('public/index.html', indexSource, '>导出枪码</button>');
const userFxExportBody = (indexSource.match(/async function exportUserFxArchive\(index\)\s*\{([\s\S]*?)\n\}/) || [,''])[1];
if (!/copyUserFxArchiveShareCode\(index\)/.test(userFxExportBody) || /exportJsonFile|createObjectURL|\.download\s*=/.test(userFxExportBody)) {
  fail('用户 FX 卡片导出必须复制枪码，不能下载文件');
}
const userFxCopyBody = (indexSource.match(/async function copyUserFxArchiveShareCode\(index\)\s*\{([\s\S]*?)\n\}/) || [,''])[1];
if (!/api\.copyText\(code\)/.test(userFxCopyBody)) fail('用户 FX 枪码导出未使用 Electron 原生剪贴板');
const userFxImportBody = (indexSource.match(/async function promptUserFxArchiveShareCode\(\)\s*\{([\s\S]*?)\n\}/) || [,''])[1];
if (!/api\.readText\(\)/.test(userFxImportBody)) fail('用户 FX 枪码导入未使用 Electron 原生剪贴板');
requireText('public/index.html', indexSource, 'id="t-sonicAdaptiveSongColor"');
requireText('public/index.html', indexSource, 'Require the title or album to');
requireText('public/index.html', indexSource, 'song.albumCover || song.coverUrl');
requireText('server.js', serverSource, "'Accept': 'image/avif,image/webp");
const oneClickBody = (indexSource.match(/async function oneClickImportLxSource\(\)\s*\{([\s\S]*?)\n\}/) || [,''])[1];
if (!/openLxSourceImport\(\)/.test(oneClickBody) || /readLxSourceClipboardText/.test(oneClickBody)) {
  fail('一键音源导入没有保持为本地文件选择');
}
const platformImporterSource = read('platform-playlist-import.js');
requireText('platform-playlist-import.js', platformImporterSource, 'embedFallback.songs.map');
requireText('platform-playlist-import.js', platformImporterSource, 'The embed list is the canonical full ordering.');
requireText('platform-playlist-import.js', platformImporterSource, 'selected song during playback');
requireText('platform-playlist-import.js', platformImporterSource, "'spotify-playlist-cache'");
requireText('platform-playlist-import.js', platformImporterSource, 'readSpotifyPlaylistCache(id)');
requireText('platform-playlist-import.js', platformImporterSource, 'writeSpotifyPlaylistCache(id, result)');
if (/songs\s*:\s*await\s+matchReferenceSongsForPlayback\(rows,\s*['"]spotifyMeta['"]\)/.test(platformImporterSource)) {
  fail('Spotify playlist import still waits for eager cross-platform matching');
}

try {
  const playlistImporter = require(path.join(root, 'platform-playlist-import.js'));
  const detectionCases = [
    ['tx', 'https://y.qq.com/n/ryqq/playlist/123456789'],
    ['wy', 'https://music.163.com/#/playlist?id=123456789'],
    ['kw', 'https://www.kuwo.cn/playlist_detail/123456789'],
    ['kg', 'https://www.kugou.com/yy/special/single/123456.html'],
    ['kgc', 'https://t1.kugou.com/share/zlist.html?global_collection_id=collection_abc123'],
    ['mg', 'https://music.migu.cn/v3/music/playlist/123456789'],
    ['sp', 'https://open.spotify.com/playlist/5FV0B8IjLkD58AxFYb60k2'],
    ['qs', 'https://qishui.douyin.com/s/AbCdEf12/'],
    ['am', 'https://music.apple.com/cn/playlist/example/pl.u-abc123'],
  ];
  detectionCases.forEach(([source, input]) => {
    const detected = playlistImporter.detect(input, source);
    if (!detected || detected.source !== source || !detected.id) {
      fail(`平台歌单识别失败: ${source}`);
    }
  });
} catch (error) {
  fail(`平台歌单导入模块检查失败: ${error.message}`);
}

try {
  const djStart = indexSource.indexOf('var RADIO_DJ_TRACK_PATTERN');
  const djEnd = indexSource.indexOf('function radioModeAcceptsSong', djStart);
  if (djStart < 0 || djEnd < 0) throw new Error('DJ filter source not found');
  const djContext = { isRadioMusicSong: () => true };
  vm.runInNewContext(indexSource.slice(djStart, djEnd), djContext, { filename:'dj-filter-smoke.js' });
  if (djContext.isRadioDjSong({ name:'Faded', singer:'Alan Walker', album:'Different World' })) {
    fail('热门 DJ 仍会把普通制作人歌曲误判为 DJ 歌曲');
  }
  if (!djContext.isRadioDjSong({ name:'Faded (DJ Remix)', singer:'Test Artist', album:'Mixes' })) {
    fail('热门 DJ 无法识别标题明确标注的 Remix 歌曲');
  }
  if (djContext.isRadioDjSong({ name:'普通歌曲', singer:'DJ Example', album:'普通专辑' })) {
    fail('热门 DJ 仍会只凭歌手名称误收普通歌曲');
  }
} catch (error) {
  fail(`热门 DJ 过滤检查失败: ${error.message}`);
}

try {
  const coverStart = indexSource.indexOf('function coverUrlWithSize');
  const coverEnd = indexSource.indexOf('function songCustomCoverKey', coverStart);
  if (coverStart < 0 || coverEnd < 0) throw new Error('cover helper source not found');
  const coverContext = { URL, isInlineCoverSrc: () => false };
  vm.runInNewContext(indexSource.slice(coverStart, coverEnd), coverContext, { filename:'cover-url-smoke.js' });
  const spotifyCover = 'https://i.scdn.co/image/abc123';
  if (coverContext.coverUrlWithSize(spotifyCover, 220) !== spotifyCover) fail('Spotify 封面 URL 仍被追加不兼容尺寸参数');
  const neteaseCover = coverContext.coverUrlWithSize('https://p1.music.126.net/example.jpg', 220);
  if (!/[?&]param=220y220/.test(neteaseCover)) fail('网易封面没有保留受支持的尺寸参数');
} catch (error) {
  fail(`封面 URL 兼容检查失败: ${error.message}`);
}

for (const relativePath of [
  'desktop/main.js',
  'desktop/preload.js',
  'desktop/direct-local-proxy.js',
  'server.js',
  'wallpaper-converter.js',
  'dj-analyzer.js',
  'lx-search.js',
  'lx-source-host.js',
  'platform-playlist-import.js',
  'public/lyric-animation.js',
]) {
  const source = read(relativePath);
  if (!source) continue;
  try { new vm.Script(source, { filename: relativePath }); }
  catch (error) { fail(`${relativePath} 语法错误: ${error.message}`); }
}

const inlineScriptPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
let inlineMatch;
let inlineIndex = 0;
while ((inlineMatch = inlineScriptPattern.exec(indexSource))) {
  inlineIndex += 1;
  if (!inlineMatch[1].trim()) continue;
  try { new vm.Script(inlineMatch[1], { filename: `public/index.html#inline-${inlineIndex}` }); }
  catch (error) { fail(`public/index.html 内联脚本 ${inlineIndex} 语法错误: ${error.message}`); }
}

checkPortableExecutable('bin/ffmpeg.exe', 100 * 1024 * 1024);
checkPortableExecutable('bin/repkg/RePKG.exe', 1024 * 1024);
for (const notice of [
  'bin/FFMPEG-NOTICE.txt',
  'bin/repkg/LICENSE',
  'bin/repkg/MINERADIO-NOTICE.txt',
  'bin/repkg/THIRD-PARTY-NOTICES.txt',
  'build/icon.ico',
  'build/prepare-windows-tools.ps1',
  'build/finalize-windows-release.js',
  'LICENSE',
  'public/assets/music-planet-bg.webp',
]) read(notice);

if (failures.length) {
  console.error('\nMineradio 发布前检查失败：');
  failures.forEach((message) => console.error(`  - ${message}`));
  process.exit(1);
}

console.log(`Mineradio ${releaseVersion} 发布前检查通过：代码语法、安装迁移、进度时间、性能调度和壁纸转换工具均已就绪。`);
