const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const failures = [];

function fail(message) { failures.push(message); }
function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`缺少文件: ${relativePath}`);
    return '';
  }
  return fs.readFileSync(absolutePath, 'utf8');
}
function requireText(relativePath, source, marker) {
  if (!source.includes(marker)) fail(`${relativePath} 缺少发布能力标记: ${marker}`);
}
function checkSyntax(relativePath) {
  const source = read(relativePath);
  if (!source) return;
  try { new vm.Script(source, { filename: relativePath }); }
  catch (error) { fail(`${relativePath} 语法错误: ${error.message}`); }
}

const packageJson = JSON.parse(read('package.json'));
const releaseVersion = packageJson.mineradio && packageJson.mineradio.releaseVersion;
if (!/^\d+\.\d+\.\d+$/.test(releaseVersion || '')) fail(`发布版本无效: ${releaseVersion || '(empty)'}`);
if (packageJson.version !== releaseVersion) fail(`package version 与 releaseVersion 不一致: ${packageJson.version} / ${releaseVersion}`);
if (packageJson.build.buildVersion !== releaseVersion) fail(`buildVersion 与 releaseVersion 不一致: ${packageJson.build.buildVersion} / ${releaseVersion}`);
if (packageJson.build.nsis.artifactName !== `Mineradio.Setup.${releaseVersion}.\${ext}`) fail('Windows 安装包文件名版本不正确');

for (const entry of [
  'desktop/**/*', 'public/**/*', 'bin/**/*', 'agent-api.js', 'qishui-auth-v6.js',
  'qishui-auth-v6/**/*', 'qishui-qr-login.js', 'NOTICE.md', 'LICENSE', 'package.json',
]) {
  if (!packageJson.build.files.includes(entry)) fail(`安装包 files 缺少: ${entry}`);
}
for (const forbidden of ['Mineradio-Network-Split-Switch.ps1', 'Mineradio网络分流开关.cmd', 'desktop-ui-state.json']) {
  if (!packageJson.build.files.includes(`!${forbidden}`) && !packageJson.build.files.includes(`!**/${forbidden}`)) {
    fail(`发布规则未排除私有文件: ${forbidden}`);
  }
}

const serverSource = read('server.js');
const agentSource = read('agent-api.js');
const commandSource = read('public/js/music-agent-command.js');
const toolsSource = read('public/js/agent-music-tools.js');
const indexSource = read('public/index.html');
const mainSource = read('desktop/main.js');
const preloadSource = read('desktop/preload.js');
const installerSource = read('build/installer.nsh');

requireText('server.js', serverSource, "require('./agent-api')");
requireText('server.js', serverSource, "pn === '/api/agent/chat'");
requireText('server.js', serverSource, "pn === '/api/agent/config'");
requireText('server.js', serverSource, "pn === '/api/agent/speech/recognize'");
for (const provider of ['openai', 'anthropic', 'gemini', 'deepseek', 'qwen', 'kimi', 'ollama', 'custom']) {
  requireText('agent-api.js', agentSource, `'${provider}'`);
}
for (const tool of [
  'search_and_play_music', 'control_playback', 'set_volume', 'skip_track',
  'control_audio_quality', 'open_mineradio_interface', 'control_mineradio_app',
  'control_lyric_animation', 'save_music_to_playlist', 'create_local_playlist',
  'build_recommended_playlist', 'control_diy_visual',
]) {
  requireText('agent-api.js', agentSource, `'${tool}'`);
}
requireText('public/js/music-agent-command.js', commandSource, 'isWorldPeaceEasterEggIntent');
requireText('public/js/music-agent-command.js', commandSource, 'focusChatInputAfterReply');
requireText('public/js/music-agent-command.js', commandSource, 'togglePetVisible');
requireText('public/js/agent-music-tools.js', toolsSource, 'control_audio_quality');
requireText('public/js/agent-music-tools.js', toolsSource, 'open_mineradio_interface');
requireText('public/index.html', indexSource, 'music-agent-command.css');
requireText('public/index.html', indexSource, 'music-agent-advanced-controls');
requireText('public/index.html', indexSource, `Mineradio v${releaseVersion}`);
requireText('public/index.html', indexSource, `currentVersion: '${releaseVersion}'`);
requireText('desktop/main.js', mainSource, 'handleGlobalHotkeyAction');
requireText('public/index.html', indexSource, "key:'toggleMusicAgent'");
requireText('desktop/preload.js', preloadSource, 'requestDesktopKeyboardFocus');
requireText('build/installer.nsh', installerSource, '!macro customCheckAppRunning');
requireText('build/installer.nsh', installerSource, 'nsProcess::CloseProcess');
requireText('build/installer.nsh', installerSource, 'nsProcess::KillProcess');

for (const relativePath of [
  'desktop/main.js', 'desktop/preload.js', 'desktop/local-music-library.js',
  'server.js', 'agent-api.js', 'lx-source-host.js', 'qishui-auth-v6.js',
  'qishui-qr-login.js', 'public/js/music-agent-command.js',
  'public/js/agent-music-tools.js', 'public/js/modules/08-account/00-login-easter-egg.js',
]) checkSyntax(relativePath);

const inlineScriptPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
let inlineMatch;
let inlineIndex = 0;
while ((inlineMatch = inlineScriptPattern.exec(indexSource))) {
  inlineIndex += 1;
  if (!inlineMatch[1].trim()) continue;
  try { new vm.Script(inlineMatch[1], { filename: `public/index.html#inline-${inlineIndex}` }); }
  catch (error) { fail(`public/index.html 内联脚本 ${inlineIndex} 语法错误: ${error.message}`); }
}

if (/矿灵/.test([serverSource, agentSource, commandSource, toolsSource, indexSource].join('\n'))) {
  fail('AI Agent 用户界面仍包含旧称“矿灵”');
}

if (failures.length) {
  console.error('\nMineradio 发布前检查失败：');
  failures.forEach(message => console.error(`  - ${message}`));
  process.exit(1);
}

console.log(`Mineradio ${releaseVersion} 发布前检查通过：AI Agent、小M工具、安装升级逻辑、版本与代码语法均已就绪。`);
