(function () {
  'use strict';

  // Prefer the named loopback host, then fall back to the numeric address.
  // Different WKWebView/iOS combinations handle these two spellings
  // differently when talking to the embedded Node service.
  var LOCAL_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];
  var LOCAL_ORIGIN = LOCAL_ORIGINS[0];
  var BRIDGE_VERSION = '1.6.1-ipad-4';
  var nodeStartupError = '';
  var engineResolve;
  var engineReject;
  var engineReady = new Promise(function (resolve, reject) { engineResolve = resolve; engineReject = reject; });
  engineReady.catch(function () {});
  var diagnostics = { build: BRIDGE_VERSION, engine: '等待启动', native: '尚未检查', search: '尚未检查' };

  function isLocalUrl(url) {
    var page = new URL(location.href);
    // Custom-scheme URL.origin can be "null" even when location.origin is not.
    return (url.protocol === page.protocol && url.host === page.host) || LOCAL_ORIGINS.indexOf(url.origin) >= 0;
  }

  function rewriteApiUrl(value) {
    if (typeof value === 'string' && value.indexOf('/api/') === 0) return LOCAL_ORIGIN + value;
    if (value instanceof URL && value.pathname.indexOf('/api/') === 0 &&
        isLocalUrl(value)) {
      return new URL(LOCAL_ORIGIN + value.pathname + value.search + value.hash);
    }
    return value;
  }

  function apiPath(input) {
    try {
      var url = new URL(typeof input === 'string' ? input : input.url || String(input), location.href);
      return isLocalUrl(url) && url.pathname.indexOf('/api/') === 0;
    } catch (_error) { return false; }
  }

  function bounded(promise, ms, signal) {
    return new Promise(function (resolve, reject) {
      var timer;
      function done(error, value) {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value);
      }
      function abort() { done(new DOMException('请求已取消', 'AbortError')); }
      timer = setTimeout(function () { done(new Error('请求超时')); }, ms);
      if (signal) {
        if (signal.aborted) { abort(); return; }
        signal.addEventListener('abort', abort, { once: true });
      }
      Promise.resolve(promise).then(function (value) { done(null, value); }, function (error) { done(error); });
    });
  }

  window.MOBILE_API_ORIGIN = LOCAL_ORIGIN;
  window.MineradioMobile = {
    isMobile: true,
    isCapacitor: true,
    localLxApp: false,
    localNode: true,
    platform: 'ios',
    build: BRIDGE_VERSION,
    diagnostics: diagnostics,
    getServerUrl: function () { return LOCAL_ORIGIN; },
    setServerUrl: function () { return LOCAL_ORIGIN; },
    reconnect: function () { location.reload(); return LOCAL_ORIGIN; }
  };

  var originalFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (!apiPath(input)) return originalFetch(input, init);
    var signal = init && init.signal || input && input.signal;
    return bounded(engineReady, 35000, signal).then(function () {
      if (typeof Request !== 'undefined' && input instanceof Request) {
        var nextRequestUrl = rewriteApiUrl(new URL(input.url));
        if (String(nextRequestUrl) !== input.url) input = new Request(nextRequestUrl, input);
      } else if (typeof input === 'string') {
        input = rewriteApiUrl(new URL(input, location.href)).href;
      } else {
        input = rewriteApiUrl(input);
      }
      return originalFetch(input, init);
    });
  };

  function nativeRequest(options) {
    var cap = window.Capacitor;
    // CapacitorHttp is part of the existing native Capacitor framework. This
    // invokes URLSession, not the WebView or the embedded Node HTTP stack.
    if (!cap || typeof cap.nativePromise !== 'function') return Promise.reject(new Error('原生联网接口不可用'));
    return bounded(cap.nativePromise('CapacitorHttp', 'request', options), 12000);
  }

  var nativeCheckPending = null;
  function checkNativeNetwork() {
    if (nativeCheckPending) return nativeCheckPending;
    diagnostics.native = '正在通过系统网络接口连接…';
    renderDiagnostics();
    nativeCheckPending = (async function () {
      var targets = ['https://music.163.com/robots.txt', 'https://y.qq.com/robots.txt'];
      var errors = [];
      for (var i = 0; i < targets.length; i++) {
        try {
          var response = await nativeRequest({ url: targets[i], method: 'GET', responseType: 'text', connectTimeout: 10000, readTimeout: 10000 });
          if (!response || !(response.status >= 100 && response.status <= 599)) throw new Error('未收到有效 HTTP 响应');
          diagnostics.native = '已收到外网响应（HTTP ' + response.status + '，' + new URL(targets[i]).hostname + '）';
          renderDiagnostics();
          return true;
        } catch (error) { errors.push(String(error && error.message || error).slice(0, 160)); }
      }
      diagnostics.native = '未连接：' + errors.join('；') + '。若系统提示使用无线网络，请选择允许；允许后可重试。';
      renderDiagnostics();
      return false;
    })().finally(function () { nativeCheckPending = null; });
    return nativeCheckPending;
  }

  function renderDiagnostics() {
    var output = document.getElementById('mineradio-network-output');
    if (output) output.textContent = '版本：' + diagnostics.build + '\n\n本机服务：' + diagnostics.engine + '\n\n系统联网：' + diagnostics.native + '\n\n歌曲搜索：' + diagnostics.search;
  }

  async function checkSearchNetwork() {
    diagnostics.search = '正在搜索“晴天”（不使用播放音源）…';
    renderDiagnostics();
    try {
      var response = await bounded(window.fetch('/api/lx-source/search?q=' + encodeURIComponent('晴天') + '&sources=tx,wy&limit=3'), 30000);
      var data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || (data.failures || []).map(function (row) { return row.source + ': ' + row.error; }).join('；') || '搜索服务未返回有效结果');
      diagnostics.search = data.songs && data.songs.length ? '成功，返回 ' + data.songs.length + ' 首歌曲：' + data.songs[0].name : '服务已响应，但当前查询无结果';
    } catch (error) { diagnostics.search = '失败：' + String(error && error.message || error).slice(0, 400); }
    renderDiagnostics();
  }

  function createDiagnostics() {
    var button = document.createElement('button');
    button.id = 'mineradio-network-button';
    button.textContent = '联网检查';
    button.type = 'button';
    button.onclick = function () {
      if (document.getElementById('mineradio-network-panel')) return;
      var panel = document.createElement('section');
      panel.id = 'mineradio-network-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', '联网检查');
      panel.innerHTML = '<h2>联网检查</h2><pre id="mineradio-network-output"></pre><p>搜索不需要导入音源。系统联网检查仅访问音乐平台，不代表所有音乐接口都可用。</p><button type="button" id="mineradio-network-retry">重新检测联网和搜索</button><button type="button" id="mineradio-network-close">关闭</button>';
      document.body.appendChild(panel);
      panel.querySelector('#mineradio-network-close').onclick = function () { panel.remove(); button.focus(); };
      panel.querySelector('#mineradio-network-retry').onclick = async function () {
        this.disabled = true;
        try { await checkNativeNetwork(); await checkSearchNetwork(); } finally { this.disabled = false; }
      };
      renderDiagnostics();
      panel.querySelector('#mineradio-network-close').focus();
    };
    document.body.appendChild(button);
    window.MineradioMobile.checkNetwork = checkNativeNetwork;
    window.MineradioMobile.checkSearch = checkSearchNetwork;
  }

  var originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    arguments[1] = rewriteApiUrl(url);
    return originalOpen.apply(this, arguments);
  };

  var style = document.createElement('style');
  style.textContent =
    '#mineradio-network-button{position:fixed;left:10px;bottom:calc(10px + env(safe-area-inset-bottom));z-index:2147483647;padding:9px 12px;border:1px solid #ffffff40;border-radius:20px;background:#101d29;color:#b5fff1;font:12px system-ui}' +
    '#mineradio-network-panel{position:fixed;inset:calc(20px + env(safe-area-inset-top)) 14px calc(20px + env(safe-area-inset-bottom));z-index:2147483647;overflow:auto;background:#101820;color:#eef8ff;border:1px solid #668;border-radius:20px;padding:20px;font:15px system-ui}' +
    '#mineradio-network-panel pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px system-ui;line-height:1.6}#mineradio-network-panel button{padding:12px;margin:10px 8px 0 0;font:15px system-ui}' +
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
    diagnostics.engine = '启动失败：' + nodeStartupError.split('\n')[0];
    renderDiagnostics();
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
      if (event && event.eventName === 'mineradio-secure-request') {
        var request = event.args && event.args[0];
        if (!request || typeof nodejs.send !== 'function') return;
        window.Capacitor.nativePromise('MineradioNative', 'secure', request).then(function (result) {
          return nodejs.send({ eventName: 'mineradio-secure-response', args: [{ id: request.id, result: result.value }] });
        }).catch(function () {
          nodejs.send({ eventName: 'mineradio-secure-response', args: [{ id: request.id, error: 'IOS_KEYCHAIN_UNAVAILABLE' }] }).catch(function () {});
        });
        return;
      }
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
    var nodejs = getNodePlugin();
    if (!nodejs || typeof nodejs.start !== 'function') {
      showStartupError('iOS 本机引擎插件不可用');
      return Promise.reject(new Error('Nodejs plugin start() is unavailable'));
    }
    // The native plugin may keep the returned promise pending for the lifetime
    // of the embedded Node process. Start it and let the health check below
    // decide when the local service is ready instead of blocking the UI here.
    try {
      var startPromise = nodejs.start({ script: 'mobile-node-main.js' });
      if (startPromise && typeof startPromise.catch === 'function') {
        startPromise.catch(function (error) {
          // A WebView reload can encounter an already-running native engine.
          // Only the health check decides whether startup actually failed.
          nodeStartupError = String(error && (error.message || error) || '本地播放服务启动失败');
        });
      }
    } catch (error) {
      nodeStartupError = String(error && (error.message || error) || '本地播放服务启动失败');
    }
    return Promise.resolve();
  }

  function waitForLocalNode() {
    var startedAt = Date.now();
    var root = document.getElementById('mineradio-ios-startup');
    var message = document.getElementById('mineradio-ios-startup-message');
    function probeOrigin(index) {
      if (index >= LOCAL_ORIGINS.length) return Promise.reject(new Error('LOCAL_NODE_UNREACHABLE'));
      var candidate = LOCAL_ORIGINS[index];
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 1200);
      return originalFetch(candidate + '/api/health?t=' + Date.now(), { cache: 'no-store', signal: controller.signal })
        .then(async function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          var health = await response.json();
          if (health.ok !== true || health.mobile !== true || health.service !== 'mineradio-local-engine') throw new Error('地址未返回 Mineradio 本机服务');
          LOCAL_ORIGIN = candidate;
          window.MOBILE_API_ORIGIN = candidate;
          return health;
        })
        .catch(function (error) {
          return probeOrigin(index + 1).catch(function () { throw error; });
        }).finally(function () { clearTimeout(timer); });
    }
    function check() {
      probeOrigin(0)
        .then(function () {
          nodeStartupError = '';
          diagnostics.engine = '已连接 ' + LOCAL_ORIGIN;
          renderDiagnostics();
          engineResolve(LOCAL_ORIGIN);
          if (root) root.remove();
        })
        .catch(function () {
          if (Date.now() - startedAt < 30000) {
            setTimeout(check, 350);
            return;
          }
          engineReject(new Error('本机音乐服务未连接，请关闭应用后重试'));
          showStartupError(nodeStartupError || '本机服务没有返回有效响应');
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
    createDiagnostics();
    bindNodeStatus();
    // Run a real native HTTPS request in the foreground. The OS decides
    // whether consent is needed; a successful response is not a permission API.
    checkNativeNetwork();
    startNodeRuntime().then(waitForLocalNode).catch(function (error) { engineReject(error); });
  });
})();
