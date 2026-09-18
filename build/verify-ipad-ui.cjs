'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: true });
async function main() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, service: 'mineradio-local-engine', mobile: true, version: '1.6.1', sources: {}, installed: [], songs: [], playlists: [], files: [], items: [], entries: [], commands: [], settings: {} })); return;
    }
    let file = path.join(root, 'public', decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname));
    if (url.pathname === '/mobile-ipad.js' || url.pathname === '/mobile-bridge.js') file = path.join(root, 'ios-support', path.basename(url.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    const type = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    let body = fs.readFileSync(file);
    if (file.endsWith('mobile-bridge.js')) body = body.toString().replaceAll(':3000', ':' + server.address().port);
    if (file.endsWith('index.html')) body = body.toString().replace('</head>', '<script>window.Capacitor={Plugins:{Nodejs:{start:async()=>{},addListener:()=>{},send:async()=>{}}},nativePromise:async()=>({status:200,owned:false})};</script><script src="mobile-bridge.js"></script><script src="mobile-ipad.js"></script></head>');
    res.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [name, width, height] of [['landscape', 1180, 820], ['portrait', 820, 1180], ['split-view', 600, 800]]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.renderer && window.toggleRenderFpsHud && window.MineradioMobile?.build === '1.6.1-ipad-4');
      await page.evaluate(() => {
        document.body.classList.remove('splash-active', 'splash-revealing', 'immersive-mode');
        document.body.classList.add('empty-home-active');
        document.querySelectorAll('[id*="splash"]').forEach(el => { el.style.display = 'none'; });
        window.toggleHomeTransparencyMode(true);
        window.toggleRenderFpsHud(true);
      });
      await page.waitForTimeout(1000);
      await page.locator('#render-fps-hud').click({ force: true });
      assert.equal(await page.locator('#render-fps-hud').evaluate(el => getComputedStyle(el).display), 'none');
      const metrics = await page.evaluate(() => {
        const home = document.getElementById('empty-home');
        const rect = home.getBoundingClientRect();
        const card = home.querySelector('.home-card');
        return { width: innerWidth, height: innerHeight, bodyWidth: document.body.scrollWidth,
          home: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, scrollWidth: home.scrollWidth, clientWidth: home.clientWidth },
          cardBackground: card && getComputedStyle(card).backgroundColor, cardBlur: card && getComputedStyle(card).backdropFilter,
          quickCards: [...home.querySelectorAll('.home-card-quick')].map(el => ({ background: getComputedStyle(el).backgroundColor, blur: getComputedStyle(el).backdropFilter })),
          dpr: renderer.getPixelRatio(), fpsHint: document.getElementById('render-fps-hud').title };
      });
      assert.ok(metrics.home.x >= 0 && metrics.home.right <= width + 1, name + ' home outside viewport');
      assert.ok(metrics.home.scrollWidth <= metrics.home.clientWidth + 1, name + ' home horizontal overflow');
      assert.equal(metrics.cardBlur, 'none');
      assert.ok(metrics.quickCards.every(card => card.blur === 'none' && card.background === 'rgba(4, 8, 12, 0.1)'));
      assert.ok(metrics.dpr <= 1);
      assert.deepEqual(errors, [], name + ' uncaught JavaScript errors');
      await page.screenshot({ path: path.join(output, name + '.png') });
      console.log(JSON.stringify({ name, metrics, errors }));
      await context.close();
    }
    console.log('PASS: iPad-size browser layout, transparent cards, tap FPS and capped DPR (not iPad hardware)');
  } finally { await browser.close(); server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
