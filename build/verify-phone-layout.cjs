'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, 'dist', 'phone-layout-check'));
const iphoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
fs.mkdirSync(output, { recursive: true });

async function main() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok:true, service:'mineradio-local-engine', mobile:true,
        version:'1.6.1', sources:{}, installed:[], songs:[], playlists:[], files:[], items:[],
        entries:[], commands:[], settings:{} }));
      return;
    }
    let file = path.join(root, 'public', decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname));
    if (url.pathname === '/mobile-ipad.js' || url.pathname === '/mobile-bridge.js') {
      file = path.join(root, 'ios-support', path.basename(url.pathname));
    }
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    res.setHeader('Content-Type', { '.js':'text/javascript', '.html':'text/html', '.css':'text/css',
      '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml' }[path.extname(file)] || 'application/octet-stream');
    let body = fs.readFileSync(file);
    if (file.endsWith('mobile-bridge.js')) body = body.toString().replaceAll(':3000', ':' + server.address().port);
    if (file.endsWith('index.html')) {
      const stub = '<script>window.Capacitor={Plugins:{Nodejs:{start:async()=>{},addListener:()=>{},send:async()=>{}}},nativePromise:async()=>({status:200,owned:false})};</script>';
      const html = body.toString();
      body = html.includes('<script src="mobile-bridge.js"></script>')
        ? html.replace('<script src="mobile-bridge.js"></script>', stub + '<script src="mobile-bridge.js"></script>')
        : html.replace('</head>', stub + '<script src="mobile-bridge.js"></script><script src="mobile-ipad.js"></script></head>');
    }
    res.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  try {
    for (const [name, width, height, phone] of [
      ['iphone-portrait', 430, 932, true], ['iphone-landscape', 932, 430, true],
      ['ipad-portrait', 820, 1180, false]
    ]) {
      const context = await browser.newContext({ viewport:{ width, height }, deviceScaleFactor:1,
        hasTouch:true, isMobile:true, userAgent:phone ? iphoneUA : undefined });
      await context.addInitScript(() => localStorage.setItem('mineradio-lyric-layout-v1',
        JSON.stringify({ lyricGlowStrength:0, lyricGlow:false })));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil:'domcontentloaded' });
      await page.waitForFunction(() => window.renderer && window.MineradioMobile?.build === '1.6.1-ipad-17');
      await page.evaluate(() => {
        document.body.classList.remove('splash-active', 'splash-revealing', 'immersive-mode');
        document.querySelectorAll('[id*="splash"]').forEach(el => { el.style.display = 'none'; });
        // The Node runtime is stubbed in this browser-only layout test.
        document.getElementById('mineradio-ios-startup')?.remove();
        document.getElementById('mineradio-network-button')?.remove();
        document.body.classList.add('empty-home-active');
      });
      await page.waitForTimeout(350);
      const base = await page.evaluate(() => {
        const nav = document.getElementById('phone-nav');
        const home = document.getElementById(nav ? 'phone-home' : 'empty-home');
        const rect = home.getBoundingClientRect();
        return { phone:document.body.classList.contains('phone-device'),
          nav:nav && getComputedStyle(nav).display, homeLeft:rect.left, homeRight:rect.right,
          homeOverflow:home.scrollWidth - home.clientWidth, bodyOverflow:document.body.scrollWidth - innerWidth };
      });
      assert.equal(base.phone, phone, name + ' device layout mismatch');
      assert.ok(base.bodyOverflow <= 1, name + ' page horizontal overflow');
      if (phone && height > width) {
        assert.notEqual(base.nav, 'none');
        assert.ok(base.homeLeft >= 0 && base.homeRight <= width + 1, 'phone home outside viewport');
        assert.ok(base.homeOverflow <= 1, 'phone home horizontal overflow');
        await page.screenshot({ path:path.join(output, 'iphone-home.png') });
        await page.locator('#phone-nav [data-phone-view="library"]').click();
        await page.waitForFunction(() => document.body.classList.contains('secondary-view-active'));
        await page.screenshot({ path:path.join(output, 'iphone-library.png') });
        await page.locator('#phone-nav [data-phone-view="search"]').click();
        await page.waitForFunction(() => document.body.classList.contains('phone-search-open'));
        await page.waitForFunction(() => {
          const el = document.getElementById('search-area');
          return Number(getComputedStyle(el).opacity) > .95 && el.getBoundingClientRect().left >= 0;
        });
        assert.equal(await page.locator('#search-area').evaluate(el => getComputedStyle(el).visibility), 'visible');
        await page.screenshot({ path:path.join(output, 'iphone-search.png') });
        await page.locator('#phone-nav [data-phone-view="player"]').click();
        assert.equal(await page.locator('#bottom-bar').evaluate(el => getComputedStyle(el).display), 'flex');
        assert.ok(Number(await page.locator('#bottom-bar').evaluate(el => getComputedStyle(el).opacity)) > .9);
        assert.equal(await page.locator('#control-cover').evaluate(el => getComputedStyle(el).display), 'block');
        await page.screenshot({ path:path.join(output, 'iphone-player.png') });
        await page.locator('#phone-player-close').click();
        assert.ok(await page.locator('body').evaluate(el => el.classList.contains('phone-search-open')));
        await page.locator('#phone-nav [data-phone-view="home"]').click();
        await page.screenshot({ path:path.join(output, name + '.png') });
      } else {
        if (phone) {
          assert.equal(base.nav, 'none', 'landscape should expose the full visual canvas');
          assert.equal(await page.locator('#bottom-bar').evaluate(el => getComputedStyle(el).display), 'flex');
          assert.ok(Number(await page.locator('#bottom-bar').evaluate(el => getComputedStyle(el).opacity)) > .9);
        } else {
          assert.equal(base.nav, null, 'iPad must keep its existing layout');
        }
        await page.screenshot({ path:path.join(output, name + '.png') });
      }
      assert.deepEqual(errors, [], name + ' uncaught JavaScript errors');
      console.log(JSON.stringify({ name, base, errors }));
      await context.close();
    }
    console.log('PASS: iPhone portrait navigation/player, landscape visual, and unchanged iPad mode');
  } finally { await browser.close(); server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
