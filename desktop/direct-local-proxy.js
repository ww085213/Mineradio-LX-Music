const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');
const dns = require('dns');

const directDnsCache = new Map();

function ipv4Number(value) {
  const parts = String(value || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function inCidr(value, base, bits) {
  const address = ipv4Number(value);
  const network = ipv4Number(base);
  if (address === null || network === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (address & mask) === (network & mask);
}

function findPhysicalIpv4() {
  const configured = String(process.env.MINERADIO_DIRECT_LOCAL_ADDRESS || '').trim();
  if (ipv4Number(configured) !== null) return configured;

  const candidates = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const item of addresses || []) {
      const family = typeof item.family === 'string' ? item.family : (item.family === 4 ? 'IPv4' : 'IPv6');
      if (family !== 'IPv4' || item.internal || ipv4Number(item.address) === null) continue;
      if (inCidr(item.address, '100.64.0.0', 10) || inCidr(item.address, '169.254.0.0', 16)) continue;
      const virtualName = /(?:vpn|tap|tun|wintun|wireguard|strongvpn|loopback|virtualbox|vmware|hyper-v)/i.test(name);
      const privateAddress = inCidr(item.address, '10.0.0.0', 8)
        || inCidr(item.address, '172.16.0.0', 12)
        || inCidr(item.address, '192.168.0.0', 16);
      candidates.push({ address: item.address, score: (privateAddress ? 10 : 0) + (virtualName ? -100 : 0) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length || candidates[0].score < 0) throw new Error('DIRECT_LOCAL_IPV4_NOT_FOUND');
  return candidates[0].address;
}

function resolve4OverHttps(hostname, localAddress, callback) {
  const request = https.request({
    protocol: 'https:',
    hostname: '223.5.5.5',
    servername: 'dns.alidns.com',
    port: 443,
    path: `/resolve?name=${encodeURIComponent(hostname)}&type=A`,
    method: 'GET',
    localAddress,
    family: 4,
    headers: {
      Accept: 'application/dns-json',
      Host: 'dns.alidns.com',
      'User-Agent': 'Mineradio-Direct-DNS/1.0',
    },
    agent: false,
    timeout: 2500,
  }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => {
      try {
        if (response.statusCode !== 200) throw new Error(`DIRECT_DOH_HTTP_${response.statusCode}`);
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const answers = Array.isArray(payload.Answer) ? payload.Answer : [];
        const addresses = answers
          .filter(answer => Number(answer && answer.type) === 1 && ipv4Number(answer.data) !== null)
          .map(answer => String(answer.data));
        if (!addresses.length) throw new Error('DIRECT_DOH_NO_IPV4');
        const ttlSeconds = Math.max(30, Math.min(600, ...answers.map(answer => Number(answer && answer.TTL) || 60)));
        callback(null, addresses, ttlSeconds * 1000);
      } catch (error) {
        callback(error);
      }
    });
  });
  request.once('timeout', () => request.destroy(new Error('DIRECT_DOH_TIMEOUT')));
  request.once('error', callback);
  request.end();
}

function createBoundLookup(localAddress) {
  const resolver = new dns.Resolver({ timeout: 1800, tries: 1 });
  resolver.setServers(['223.5.5.5', '119.29.29.29']);
  if (typeof resolver.setLocalAddress === 'function') resolver.setLocalAddress(localAddress);

  return function boundLookup(hostname, options, callback) {
    if (net.isIP(hostname)) {
      callback(null, hostname, net.isIPv6(hostname) ? 6 : 4);
      return;
    }
    const cacheKey = String(hostname || '').toLowerCase();
    const cached = directDnsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && cached.addresses.length) {
      const addresses = cached.addresses;
      if (options && options.all) callback(null, addresses.map(address => ({ address, family: 4 })));
      else callback(null, addresses[0], 4);
      return;
    }

    const finish = addresses => {
      if (options && options.all) callback(null, addresses.map(address => ({ address, family: 4 })));
      else callback(null, addresses[0], 4);
    };
    resolve4OverHttps(hostname, localAddress, (dohError, dohAddresses, ttlMs) => {
      if (!dohError && dohAddresses && dohAddresses.length) {
        directDnsCache.set(cacheKey, { addresses: dohAddresses, expiresAt: Date.now() + ttlMs });
        finish(dohAddresses);
        return;
      }
      resolver.resolve4(hostname, (error, addresses) => {
      if (!error && addresses && addresses.length) {
          directDnsCache.set(cacheKey, { addresses, expiresAt: Date.now() + 60000 });
          finish(addresses);
        return;
      }
      dns.lookup(hostname, Object.assign({}, options || {}, { family: 4 }), callback);
      });
    });
  };
}

function connectTarget(targetHost, targetPort, localAddress, lookup) {
  return net.connect({
    host: targetHost,
    port: targetPort,
    localAddress,
    family: 4,
    lookup,
  });
}

function parseConnectTarget(authority) {
  const value = String(authority || '');
  const ipv6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(value);
  if (ipv6) return { host: ipv6[1], port: Number(ipv6[2] || 443) };
  const index = value.lastIndexOf(':');
  if (index > 0) return { host: value.slice(0, index), port: Number(value.slice(index + 1) || 443) };
  return { host: value, port: 443 };
}

async function createDirectLocalProxy() {
  const localAddress = findPhysicalIpv4();
  const lookup = createBoundLookup(localAddress);

  const server = http.createServer((request, response) => {
    let target;
    try {
      target = new URL(request.url);
    } catch (_error) {
      response.writeHead(400, { Connection: 'close' });
      response.end('Invalid proxy URL');
      return;
    }

    const transport = target.protocol === 'https:' ? https : http;
    const headers = Object.assign({}, request.headers, { host: target.host });
    delete headers['proxy-connection'];
    const upstream = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: Number(target.port || (target.protocol === 'https:' ? 443 : 80)),
      method: request.method,
      path: `${target.pathname}${target.search}`,
      headers,
      localAddress,
      family: 4,
      lookup,
      agent: false,
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.setTimeout(30000, () => upstream.destroy(new Error('DIRECT_PROXY_TIMEOUT')));
    upstream.on('error', (error) => {
      if (!response.headersSent) response.writeHead(502, { Connection: 'close' });
      response.end(error.message || 'Direct proxy error');
    });
    request.pipe(upstream);
  });

  server.on('connect', (request, clientSocket, head) => {
    const target = parseConnectTarget(request.url);
    if (!target.host || !target.port) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstream = connectTarget(target.host, target.port, localAddress, lookup);
    upstream.setTimeout(30000, () => upstream.destroy(new Error('DIRECT_PROXY_TIMEOUT')));
    upstream.once('connect', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: MineRadio-Direct\r\n\r\n');
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });

  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    localAddress,
    port: address.port,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

module.exports = {
  createDirectLocalProxy,
  findPhysicalIpv4,
};
