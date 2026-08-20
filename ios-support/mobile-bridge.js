(function () {
  'use strict';

  var STORAGE_KEY = 'mineradio-ios-backend-url';
  var BUILD_BACKEND = '__MINERADIO_BACKEND_URL__';

  function normalizeOrigin(value) {
    value = String(value || '').trim().replace(/\/+$/, '');
    if (!value || value === '__MINERADIO_BACKEND_URL__') return '';
    return value;
  }

  function getBackendOrigin() {
    return normalizeOrigin(localStorage.getItem(STORAGE_KEY)) || normalizeOrigin(BUILD_BACKEND);
  }

  function setBackendOrigin(value) {
    var origin = normalizeOrigin(value);
    if (origin) localStorage.setItem(STORAGE_KEY, origin);
    else localStorage.removeItem(STORAGE_KEY);
    window.MOBILE_API_ORIGIN = origin;
    return origin;
  }

  function rewriteApiUrl(value) {
    var origin = getBackendOrigin();
    if (!origin) return value;
    if (typeof value === 'string' && value.indexOf('/api/') === 0) return origin + value;
    if (value instanceof URL && value.pathname.indexOf('/api/') === 0) {
      return new URL(origin + value.pathname + value.search + value.hash);
    }
    return value;
  }

  window.MOBILE_API_ORIGIN = getBackendOrigin();
  window.MineradioMobile = {
    isMobile: true,
    isCapacitor: true,
    localLxApp: false,
    platform: 'ios',
    getServerUrl: getBackendOrigin,
    setServerUrl: setBackendOrigin,
    reconnect: function (value) {
      var origin = setBackendOrigin(value);
      if (origin) location.reload();
      return origin;
    }
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

  function addConnectScreen() {
    if (getBackendOrigin() || document.getElementById('mineradio-ios-connect')) return;
    var root = document.createElement('div');
    root.id = 'mineradio-ios-connect';
    root.innerHTML =
      '<section class="mineradio-ios-connect-card">' +
      '<div class="mineradio-ios-connect-kicker">MINERADIO // iOS</div>' +
      '<h1>连接你的云端后端</h1>' +
      '<p>填入 HTTPS 地址。地址只保存在这台 iPhone 中。</p>' +
      '<input id="mineradio-ios-backend" type="url" inputmode="url" autocomplete="url" autocapitalize="none" spellcheck="false" placeholder="https://你的服务地址">' +
      '<button id="mineradio-ios-connect-button" type="button">连接并进入</button>' +
      '<div id="mineradio-ios-connect-message" role="status"></div>' +
      '</section>';
    document.body.appendChild(root);

    var button = document.getElementById('mineradio-ios-connect-button');
    var input = document.getElementById('mineradio-ios-backend');
    var message = document.getElementById('mineradio-ios-connect-message');
    function connect() {
      var value = normalizeOrigin(input.value);
      if (!/^https:\/\//i.test(value)) {
        message.textContent = '请输入以 https:// 开头的公网地址';
        return;
      }
      button.disabled = true;
      message.textContent = '正在检查连接…';
      originalFetch(value + '/api/lx-source/status?t=' + Date.now(), { cache: 'no-store' })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          setBackendOrigin(value);
          location.reload();
        })
        .catch(function () {
          button.disabled = false;
          message.textContent = '无法连接，请检查地址和服务状态';
        });
    }
    button.addEventListener('click', connect);
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') connect();
    });
  }

  var style = document.createElement('style');
  style.textContent =
    'html,body{min-height:100%;overscroll-behavior:none}' +
    'body.mobile-device{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);-webkit-tap-highlight-color:transparent}' +
    '#desktop-titlebar,#desktop-resize-handles{display:none!important}' +
    '#mineradio-ios-connect{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:calc(24px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom));background:radial-gradient(circle at 50% 0,#172435 0,#080a0e 48%,#030405 100%);color:#eef8ff;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif}' +
    '.mineradio-ios-connect-card{width:min(100%,420px);padding:30px 24px;border:1px solid rgba(255,255,255,.12);border-radius:28px;background:rgba(8,12,17,.84);box-shadow:0 28px 90px rgba(0,0,0,.55);backdrop-filter:blur(24px)}' +
    '.mineradio-ios-connect-kicker{color:#79ecd7;font-size:11px;font-weight:800;letter-spacing:.2em}' +
    '.mineradio-ios-connect-card h1{margin:14px 0 8px;font-size:28px}' +
    '.mineradio-ios-connect-card p{margin:0 0 22px;color:rgba(238,248,255,.58);font-size:14px;line-height:1.6}' +
    '.mineradio-ios-connect-card input{box-sizing:border-box;width:100%;min-height:52px;padding:0 15px;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:#0d1218;color:#fff;font-size:16px;outline:none}' +
    '.mineradio-ios-connect-card input:focus{border-color:#79ecd7;box-shadow:0 0 0 3px rgba(121,236,215,.12)}' +
    '.mineradio-ios-connect-card button{width:100%;min-height:52px;margin-top:12px;border:0;border-radius:999px;background:#79ecd7;color:#06100f;font-size:16px;font-weight:800}' +
    '.mineradio-ios-connect-card button:disabled{opacity:.55}' +
    '#mineradio-ios-connect-message{min-height:20px;margin-top:12px;color:#ff8997;font-size:12px;text-align:center}';
  document.head.appendChild(style);

  document.addEventListener('DOMContentLoaded', function () {
    document.documentElement.classList.remove('desktop-native-root', 'desktop-shell-root');
    document.body.classList.remove('desktop-shell');
    document.body.classList.add('mobile-device');
    addConnectScreen();
  });
})();
