(function () {
  'use strict';

  var LOCAL_ORIGIN = 'http://127.0.0.1:3000';
  var READY_KEY = 'mineradio-ios-node-ready';
  var START_KEY = 'mineradio-ios-node-start-requested';
  var nodeStartupError = '';

  function rewriteApiUrl(value) {
    if (typeof value === 'string' && value.indexOf('/api/') === 0) return LOCAL_ORIGIN + value;
    if (value instanceof URL && value.pathname.indexOf('/api/') === 0) {
      return new URL(LOCAL_ORIGIN + value.pathname + value.search + value.hash);
    }
    return value;
  }

  window.MOBILE_API_ORIGIN = LOCAL_ORIGIN;
  window.MineradioMobile = {
    isMobile: true,
    isCapacitor: true,
    localLxApp: false,
    localNode: true,
    platform: 'ios',
    getServerUrl: function () { return LOCAL_ORIGIN; },
    setServerUrl: function () { return LOCAL_ORIGIN; },
    reconnect: function () { location.reload(); return LOCAL_ORIGIN; }
  };

  var originalFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof Request !== 'undefined' && input instanceof Request) {
      var nextRequestUrl = rewriteApiUrl(new URL(input.url));
      if (String(nextRequestUrl) !== input.url) input = new Request(nextRequestUrl, input);
    } else {
      input = rewriteApiUrl(input);
    }
    return originalFetch(input, init);
  };

  var originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    arguments[1] = rewriteApiUrl(url);
    return originalOpen.apply(this, arguments);
  };

  var style = document.createElement('style');
  style.textContent =
    'html,body{min-height:100%;overscroll-behavior:none}' +
    'body.mobile-device{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);-webkit-tap-highlight-color:transparent}' +
    '#desktop-titlebar,#desktop-resize-handles{display:none!important}' +
    '#mineradio-ios-startup{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:calc(24px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom));background:radial-gradient(circle at 50% 0,#172435 0,#080a0e 48%,#030405 100%);color:#eef8ff;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif}' +
    '.mineradio-ios-startup-card{width:min(100%,420px);padding:30px 24px;border:1px solid rgba(255,255,255,.12);border-radius:28px;background:rgba(8,12,17,.84);box-shadow:0 28px 90px rgba(0,0,0,.55);text-align:center}' +
    '.mineradio-ios-startup-kicker{color:#79ecd7;font-size:11px;font-weight:800;letter-spacing:.2em}' +
    '.mineradio-ios-startup-card h1{margin:14px 0 8px;font-size:28px}' +
    '.mineradio-ios-startup-card p{margin:0;color:rgba(238,248,255,.58);font-size:14px;line-height:1.6}' +
    '.mineradio-ios-startup-dot{width:44px;height:44px;margin:22px auto 0;border:3px solid rgba(121,236,215,.18);border-top-color:#79ecd7;border-radius:50%;animation:mineradio-ios-spin .8s linear infinite}' +
    '#mineradio-ios-startup button{display:none;width:100%;min-height:50px;margin-top:18px;border:0;border-radius:999px;background:#79ecd7;color:#06100f;font-weight:800}' +
    '@keyframes mineradio-ios-spin{to{transform:rotate(360deg)}}';
  document.head.appendChild(style);

  function createStartupScreen() {
    if (document.getElementById('mineradio-ios-startup')) return;
    var root = document.createElement('div');
    root.id = 'mineradio-ios-startup';
    root.innerHTML =
      '<section class="mineradio-ios-startup-card">' +
      '<div class="mineradio-ios-startup-kicker">MINERADIO // LOCAL</div>' +
      '<h1>正在准备 Mineradio</h1>' +
      '<p id="mineradio-ios-startup-message">正在加载本地音乐库和播放服务，请稍候。</p>' +
      '<div class="mineradio-ios-startup-dot"></div>' +
      '<button type="button">重新尝试</button>' +
      '</section>';
    document.body.appendChild(root);
    root.querySelector('button').onclick = function () { location.reload(); };
  }

  function showStartupError(value) {
    nodeStartupError = String(value || '未知启动错误');
    var root = document.getElementById('mineradio-ios-startup');
    var message = document.getElementById('mineradio-ios-startup-message');
    if (message) message.textContent = '本地播放服务启动失败：' + nodeStartupError.split('\n')[0];
    if (root) {
      var dot = root.querySelector('.mineradio-ios-startup-dot');
      var button = root.querySelector('button');
      if (dot) dot.style.display = 'none';
      if (button) button.style.display = 'block';
    }
  }

  function bindNodeStatus() {
    var nodejs = getNodePlugin();
    if (!nodejs || typeof nodejs.addListener !== 'function') return;
    nodejs.addListener('message', function (event) {
      if (!event || event.eventName !== 'mineradio-node-status') return;
      var status = event.args && event.args[0];
      if (status && status.state === 'failed') showStartupError(status.message);
    });
  }

  function getNodePlugin() {
    var capacitor = window.Capacitor;
    return capacitor && capacitor.Plugins && capacitor.Plugins.Nodejs;
  }

  function startNodeRuntime() {
    if (sessionStorage.getItem(START_KEY)) return Promise.resolve();
    var nodejs = getNodePlugin();
    if (!nodejs || typeof nodejs.start !== 'function') {
      showStartupError('iOS 本机引擎插件不可用');
      return Promise.reject(new Error('Nodejs plugin start() is unavailable'));
    }
    sessionStorage.setItem(START_KEY, '1');
    // The native plugin may keep the returned promise pending for the lifetime
    // of the embedded Node process. Start it and let the health check below
    // decide when the local service is ready instead of blocking the UI here.
    try {
      var startPromise = nodejs.start({ script: 'mobile-node-main.js' });
      if (startPromise && typeof startPromise.catch === 'function') {
        startPromise.catch(function (error) {
          sessionStorage.removeItem(START_KEY);
          showStartupError(error && (error.message || error) || '本地播放服务启动失败');
        });
      }
    } catch (error) {
      sessionStorage.removeItem(START_KEY);
      showStartupError(error && (error.message || error) || '本地播放服务启动失败');
      return Promise.reject(error);
    }
    return Promise.resolve();
  }

  function waitForLocalNode() {
    var startedAt = Date.now();
    var root = document.getElementById('mineradio-ios-startup');
    var message = document.getElementById('mineradio-ios-startup-message');
    function check() {
      originalFetch(LOCAL_ORIGIN + '/api/health?t=' + Date.now(), { cache: 'no-store' })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          if (!sessionStorage.getItem(READY_KEY)) {
            sessionStorage.setItem(READY_KEY, '1');
            location.reload();
            return;
          }
          if (root) root.remove();
        })
        .catch(function () {
          if (nodeStartupError) {
            showStartupError(nodeStartupError);
            return;
          }
          if (Date.now() - startedAt < 30000) {
            setTimeout(check, 350);
            return;
          }
          if (message) message.textContent = '本地播放服务启动失败，请彻底关闭应用后重试。';
          if (root) {
            var dot = root.querySelector('.mineradio-ios-startup-dot');
            var button = root.querySelector('button');
            if (dot) dot.style.display = 'none';
            if (button) button.style.display = 'block';
          }
        });
    }
    check();
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.documentElement.classList.remove('desktop-native-root', 'desktop-shell-root');
    document.body.classList.remove('desktop-shell');
    document.body.classList.add('mobile-device');
    createStartupScreen();
    bindNodeStatus();
    startNodeRuntime().then(waitForLocalNode).catch(function () {});
  });
})();
