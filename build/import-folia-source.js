#!/usr/bin/env node
// Mechanical, byte-for-byte import of selected Folia v0.7.16 source files.
// The local Folia checkout is pinned to c69afdcba85fe6ca1f5c9f5cb83be3e83adfcd67.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '../../folia-v0.7.16');
const outputRoot = path.resolve(__dirname, '../lyric-viz-bridge');
const expectedCommit = 'c69afdcba85fe6ca1f5c9f5cb83be3e83adfcd67';
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
if (commit !== expectedCommit) throw new Error(`Unexpected Folia revision: ${commit}`);

for (const relative of process.argv.slice(2)) {
  if (!relative.startsWith('src/') || relative.includes('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe source path: ${relative}`);
  }
  const target = path.resolve(outputRoot, relative);
  if (!target.startsWith(outputRoot + path.sep)) throw new Error(`Unsafe target: ${target}`);
  const bytes = execFileSync('git', ['show', `HEAD:${relative}`], { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  console.log(`Imported ${relative} (${bytes.length} bytes)`);
}
