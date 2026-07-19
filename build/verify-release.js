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
if (packageJson.version !== '1.5.6') fail(`npm package version 应保持有效 SemVer 1.5.6，实际为 ${packageJson.version}`);
if (packageJson.build.buildVersion !== '1.5.6.1') fail('Windows buildVersion 未同步为 1.5.6.1');
if (releaseVersion !== '1.5.6.1') fail('应用内 releaseVersion 未同步为 1.5.6.1');
if (!packageJson.build.files.includes('bin/**/*')) fail('安装包未声明包含 bin/**/*');
if (!packageJson.build.files.includes('LICENSE')) fail('安装包未声明包含 GPL-3.0 LICENSE');
if (!packageJson.build.files.includes('!public/**/*.map')) fail('正式安装包未排除前端源码映射文件');
if (!packageJson.build.files.includes('!build/finalize-windows-release.js')) fail('正式安装包未排除仅用于发布机的收尾脚本');
if (packageJson.build.nsis.artifactName !== 'Mineradio.Setup.1.5.6.1.${ext}') fail('安装包文件名版本不正确');
if (!packageJson.scripts['build:win'].includes('build/finalize-windows-release.js')) fail('Windows 构建未固定 latest.yml 的四段发布版本');

const mainSource = read('desktop/main.js');
const indexSource = read('public/index.html');
const installerSource = read('build/installer.nsh');
const converterSource = read('wallpaper-converter.js');

requireText('desktop/main.js', mainSource, "writeStartupDiagnostic('app-when-ready'");
requireText('desktop/main.js', mainSource, 'setIgnoreMouseEvents(true)');
requireText('desktop/main.js', mainSource, 'mainWindowSplashWatchdogTimer');
requireText('desktop/main.js', mainSource, 'splash watchdog forced the home screen to reveal');
requireText('desktop/main.js', mainSource, "process.platform !== 'win32' || !app.isPackaged");
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
requireText('build/installer.nsh', installerSource, 'MINERADIO_LEGACY_UNINSTALL_KEY');
requireText('build/installer.nsh', installerSource, '9733721a-009e-52bc-b705-49059cd80258');
requireText('build/installer.nsh', installerSource, 'MineradioDisableUnsafePreviousUninstallers');
requireText('build/installer.nsh', installerSource, 'Call MineradioNormalizeInstallDir');
requireText('build/installer.nsh', installerSource, 'WriteRegStr SHELL_CONTEXT "${MINERADIO_INSTALL_KEY}" "InstallLocation" "$INSTDIR"');
requireText('build/installer.nsh', installerSource, 'it is an explicit user choice and must never be replaced');
const directoryShowBody = (installerSource.match(/Function MineradioDirectoryShow([\s\S]*?)FunctionEnd/) || [])[1] || '';
if (!directoryShowBody) fail('build/installer.nsh 缺少 MineradioDirectoryShow');
if (directoryShowBody.includes('MineradioUsePreferredInstallDir')) fail('自定义目录页仍会用旧注册表路径覆盖用户选择');
requireText('wallpaper-converter.js', converterSource, "path.join(this.appDir, 'bin', 'ffmpeg.exe')");
requireText('wallpaper-converter.js', converterSource, "path.join(this.appDir, 'bin', 'repkg', 'RePKG.exe')");

for (const relativePath of [
  'desktop/main.js',
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
]) read(notice);

if (failures.length) {
  console.error('\nMineradio 发布前检查失败：');
  failures.forEach((message) => console.error(`  - ${message}`));
  process.exit(1);
}

console.log(`Mineradio ${releaseVersion} 发布前检查通过：代码语法、安装迁移、进度时间、性能调度和壁纸转换工具均已就绪。`);
