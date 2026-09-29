'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const references = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"'#?]+)["']/gi)]
  .map(match => match[1])
  .filter(value => !/^(?:https?:|data:|\/\/)/i.test(value));
const missing = [...new Set(references)]
  .filter(value => {
    const relative = value.replace(/^\.\//, '');
    if (fs.existsSync(path.resolve(root, relative))) return false;
    if (/^mobile-(?:bridge|ipad)\.js$/i.test(relative) && fs.existsSync(path.resolve(__dirname, '..', 'ios-support', relative))) return false;
    return true;
  });
if (missing.length) throw new Error('Missing public assets:\n' + missing.join('\n'));

let inlineCount = 0;
for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
  if (!body.trim() || /type=["'](?:application\/ld\+json|application\/json|importmap)["']/i.test(attrs)) continue;
  new vm.Script(body, { filename:`index-inline-${++inlineCount}.js` });
}
process.stdout.write(`public assets ok (${new Set(references).size} references, ${inlineCount} inline scripts)\n`);
