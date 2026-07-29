const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createRequire } = require('module');

function findNewestRceditInCache(cacheRoot) {
  if (!cacheRoot || !fs.existsSync(cacheRoot)) return null;
  var newest = null;
  var stack = [cacheRoot];
  while (stack.length) {
    var dir = stack.pop();
    var entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    entries.forEach(function(entry) {
      var fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        return;
      }
      if (entry.isFile() && entry.name.toLowerCase() === 'rcedit-x64.exe') {
        var stat = fs.statSync(fullPath);
        if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { path: fullPath, mtimeMs: stat.mtimeMs };
      }
    });
  }
  return newest && newest.path;
}

function resolveRcedit(projectDir) {
  var candidates = [
    path.join(projectDir, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe')
  ];
  var localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    var cached = findNewestRceditInCache(path.join(localAppData, 'electron-builder', 'Cache', 'winCodeSign'));
    if (cached) candidates.push(cached);
  }
  candidates.push(path.join(projectDir, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe'));
  var hit = candidates.find(function(candidate) { return candidate && fs.existsSync(candidate); });
  if (!hit) throw new Error('No usable rcedit executable was found for Mineradio icon injection.');
  return hit;
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const appName = context.packager.appInfo.productFilename || 'Mineradio';
  const productName = context.packager.appInfo.productName || appName;
  const companyName = context.packager.appInfo.companyName || productName;
  const exePath = path.join(context.appOutDir, `${appName}.exe`);
  const iconPath = path.join(context.packager.info.buildResourcesDir, 'icon.ico');
  const rceditPath = resolveRcedit(context.packager.projectDir);
  const packagedAppDir = path.join(context.appOutDir, 'resources', 'app');

  if (!fs.existsSync(exePath)) throw new Error(`Mineradio executable was not found: ${exePath}`);
  if (!fs.existsSync(iconPath)) throw new Error(`Mineradio icon was not found: ${iconPath}`);
  if (!fs.existsSync(path.join(packagedAppDir, 'server.js'))) {
    throw new Error(`Mineradio packaged server was not found: ${packagedAppDir}`);
  }

  // Resolve and exercise production dependencies from the packaged app itself.
  // This prevents a successful installer build whose first launch immediately
  // fails because a module existed in the development tree but was not shipped.
  const packagedRequire = createRequire(path.join(packagedAppDir, 'server.js'));
  let QRCode;
  try {
    packagedRequire.resolve('qrcode');
    QRCode = packagedRequire('qrcode');
  } catch (error) {
    throw new Error(`Packaged runtime dependency qrcode is unavailable: ${error.message}`);
  }
  const qrSvg = await QRCode.toString('Mineradio packaged runtime check', { type: 'svg' });
  if (!/^<svg[\s>]/.test(String(qrSvg || ''))) {
    throw new Error('Packaged qrcode runtime check returned invalid SVG output.');
  }
  console.log('  • verified packaged runtime dependencies  qrcode=ready');

  const packageMetadata = JSON.parse(fs.readFileSync(path.join(context.packager.projectDir, 'package.json'), 'utf8'));
  const version = String(
    packageMetadata && packageMetadata.mineradio && packageMetadata.mineradio.releaseVersion
      || packageMetadata && packageMetadata.build && packageMetadata.build.buildVersion
      || context.packager.appInfo.version
  );
  const windowsVersion = /^\d+\.\d+\.\d+$/.test(version) ? `${version}.0` : version;
  console.log(`  • injecting Mineradio resources  rcedit=${rceditPath}`);
  execFileSync(rceditPath, [
    exePath,
    '--set-icon', iconPath,
    '--set-version-string', 'FileDescription', productName,
    '--set-version-string', 'ProductName', productName,
    '--set-version-string', 'CompanyName', companyName,
    '--set-version-string', 'OriginalFilename', `${appName}.exe`,
    '--set-file-version', windowsVersion,
    '--set-product-version', windowsVersion
  ], { stdio: 'inherit' });
};
