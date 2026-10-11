#!/usr/bin/env node
// Recover the existing bridge's authored sources from its committed source map.
// This is a reproducible, mechanical extraction; edit the extracted sources,
// then rebuild the browser bundle rather than editing minified output.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mapPath = path.join(root, 'public/vendor/lyric-viz/lyric-viz-bridge.js.map');
const outputRoot = path.join(root, 'lyric-viz-bridge');
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const prefix = '../../../lyric-viz-bridge/';

let extracted = 0;
for (let index = 0; index < map.sources.length; index += 1) {
  const source = map.sources[index];
  if (!source.startsWith(prefix) || source.includes('/node_modules/')) continue;
  const relative = source.slice(prefix.length);
  if (!relative.startsWith('src/') || relative.includes('..')) continue;
  const destination = path.resolve(outputRoot, relative);
  if (!destination.startsWith(outputRoot + path.sep)) throw new Error(`Unsafe path: ${source}`);
  const content = map.sourcesContent[index];
  if (typeof content !== 'string') throw new Error(`No source content: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (path.extname(destination) === '.png') {
    const match = /^export default "data:image\/png;base64,([A-Za-z0-9+/=]+)";?$/.exec(content.trim());
    if (!match) throw new Error(`Unexpected image source: ${source}`);
    fs.writeFileSync(destination, Buffer.from(match[1], 'base64'));
  } else {
    fs.writeFileSync(destination, content);
  }
  extracted += 1;
}

console.log(`Extracted ${extracted} authored bridge sources to ${outputRoot}`);
