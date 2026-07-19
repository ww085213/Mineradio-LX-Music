const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = require(path.join(root, 'package.json'));
const releaseVersion = packageJson.mineradio && packageJson.mineradio.releaseVersion;
const artifactName = `Mineradio.Setup.${releaseVersion}.exe`;
const artifactPath = path.join(root, 'dist', artifactName);
const latestPath = path.join(root, 'dist', 'latest.yml');

if (!releaseVersion || !/^\d+\.\d+\.\d+\.\d+$/.test(releaseVersion)) {
  throw new Error(`无效的 Mineradio 发布版本: ${releaseVersion || '(empty)'}`);
}
if (!fs.existsSync(artifactPath) || !fs.existsSync(latestPath)) {
  throw new Error('Windows 安装包或 latest.yml 尚未生成');
}

let latest = fs.readFileSync(latestPath, 'utf8');
if (!/^version:\s*[^\r\n]+/m.test(latest)) throw new Error('latest.yml 缺少 version 字段');
latest = latest.replace(/^version:\s*[^\r\n]+/m, `version: ${releaseVersion}`);
fs.writeFileSync(latestPath, latest, 'utf8');

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex');
const checksumName = `Mineradio.Setup.${releaseVersion}.SHA256.txt`;
fs.writeFileSync(path.join(root, 'dist', checksumName), `${sha256}  ${artifactName}\n`, 'ascii');

console.log(`发布清单已固定为 ${releaseVersion}`);
console.log(`SHA256 ${sha256}`);
