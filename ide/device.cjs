const dgram = require('node:dgram');
const http = require('node:http');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const DISCOVERY_PORT = 42420;
const QUERY = 'OPENPLAY_DISCOVER_V1';
function localIPv4(ip) {
  if (!net.isIPv4(ip)) return false;
  const [a,b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
function target(value) {
  if (typeof value !== 'string' || value.length > 100) throw new Error('Укажи локальный IPv4-адрес консоли');
  let url; try { url = new URL(value.includes('://') ? value : 'http://' + value); } catch { throw new Error('Неверный адрес консоли'); }
  if (url.protocol !== 'http:' || !localIPv4(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Нужен адрес консоли в локальной сети, например 192.168.3.32');
  const port = Number(url.port || 80);
  if (port < 1 || port > 65535) throw new Error('Неверный порт консоли');
  return { host: url.hostname, port, address: url.host, url: url.origin };
}
function request(device, route, { method = 'GET', body, headers = {}, timeout = 4000, progress } = {}) {
  return new Promise((resolve, reject) => {
    let received = 0, settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(deadline); error ? reject(error) : resolve(value); };
    const req = http.request({ hostname: device.host, port: device.port, path: route, method, headers: { 'X-OpenPlay-Studio': '1', ...headers } }, res => {
      const chunks = [];
      res.on('data', bytes => { received += bytes.length; if (received > 65536) req.destroy(new Error('Слишком большой ответ консоли')); else chunks.push(bytes); });
      res.on('aborted', () => finish(new Error('Консоль прервала ответ')));
      res.on('error', error => finish(error));
      res.on('end', () => {
        let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { finish(new Error('Это не совместимая консоль OpenPlay. Возможно, нужно обновить прошивку.')); return; }
        if (res.statusCode < 200 || res.statusCode >= 300) finish(new Error(data.error || `Консоль вернула HTTP ${res.statusCode}`));
        else finish(null, data);
      });
    });
    const deadline = setTimeout(() => req.destroy(new Error('Консоль не ответила. Проверь Wi-Fi и её адрес.')), timeout);
    req.on('error', error => finish(error));
    req.on('close', () => { if (!settled) finish(new Error('Соединение с консолью закрыто')); });
    if (!body) { req.end(); return; }
    let offset = 0;
    function write() {
      while (offset < body.length && !req.destroyed) {
        const end = Math.min(offset + 16384, body.length);
        const ready = req.write(body.subarray(offset, end)); offset = end;
        progress?.(Math.round(offset / body.length * 90));
        if (!ready) { req.once('drain', write); return; }
      }
      if (!req.destroyed) req.end();
    }
    write();
  });
}
function identity(info) {
  if (!info || info.product !== 'OpenPlay' || info.protocol !== 1 || info.api !== 1 || typeof info.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(info.id) || typeof info.name !== 'string' || info.name.length > 80)
    throw new Error('Консоль не поддерживает загрузку из Studio. Обнови её прошивку.');
  return info;
}
async function probe(address, timeout = 2000) {
  const device = target(address);
  const info = identity(await request(device, '/api/info', { timeout }));
  return { id: info.id, name: info.name, address: device.address, storage: info.storage === true };
}
function broadcastAddresses(interfaces = os.networkInterfaces()) {
  const addresses = new Set(['255.255.255.255']);
  for (const list of Object.values(interfaces)) for (const iface of list || []) {
    if (iface.internal || iface.family !== 'IPv4' || !localIPv4(iface.address) || !net.isIPv4(iface.netmask)) continue;
    const ip = iface.address.split('.').map(Number), mask = iface.netmask.split('.').map(Number);
    addresses.add(ip.map((v,i) => (v | (~mask[i] & 255))).join('.'));
  }
  return [...addresses];
}
function udpDiscovery({ duration = 1600, port = DISCOVERY_PORT, addresses = broadcastAddresses() } = {}) {
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4'), found = new Map();
    const done = () => { clearTimeout(timer); try { socket.close(); } catch {} resolve([...found.values()]); };
    const timer = setTimeout(done, duration);
    socket.on('error', done);
    socket.on('message', (bytes, remote) => {
      if (bytes.length > 2048 || !localIPv4(remote.address)) return;
      try {
        const info = identity(JSON.parse(bytes.toString()));
        if (!Number.isInteger(info.port) || info.port < 1 || info.port > 65535) return;
        found.set(info.id, { id: info.id, address: remote.address + (info.port === 80 ? '' : ':' + info.port) });
      } catch { /* Ignore unrelated datagrams. HTTP verifies every candidate. */ }
    });
    socket.bind(0, '0.0.0.0', () => {
      try {
        socket.setBroadcast(true);
        for (const address of addresses) socket.send(QUERY, port, address, () => {});
      } catch { done(); }
    });
  });
}
async function discover(remembered, options) {
  // UDP discovers all devices, including across multiple adapters. Direct probes
  // also work when a router/firewall blocks broadcast replies.
  const direct = [...new Set([remembered, '192.168.4.1'].filter(Boolean))].map(address => probe(address).catch(() => null));
  const candidates = await udpDiscovery(options);
  const replies = await Promise.all([...direct, ...candidates.slice(0,32).map(async candidate => {
    try { const device = await probe(candidate.address); return device.id === candidate.id ? device : null; } catch { return null; }
  })]);
  return [...new Map(replies.filter(Boolean).map(device => [device.id, device])).values()].sort((a,b) => a.name.localeCompare(b.name));
}
async function deploy(address, expectedId, bundle, progress = () => {}) {
  const device = target(address);
  if (!bundle.data || bundle.data.length > 2*1024*1024 || !/^[a-z0-9_-]{1,40}$/.test(bundle.manifest.id)) throw new Error('Неверный бандл .opd');
  progress({ percent: 0, stage: 'Подключение к консоли…' });
  const session = identity(await request(device, '/api/studio'));
  if (session.id !== expectedId) throw new Error('По этому адресу теперь другая консоль. Найди устройства заново.');
  if (!session.storage) throw new Error('На консоли недоступно хранилище');
  if (typeof session.token !== 'string' || !/^[a-f0-9]{24}$/.test(session.token)) throw new Error('Не удалось получить разрешение на загрузку');
  const filename = bundle.manifest.id + '.opd';
  const boundary = '----OpenPlayStudio' + crypto.randomBytes(12).toString('hex');
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="opd"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), bundle.data, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  let percent = -1;
  const result = await request(device, '/api/apps?token=' + session.token, { method: 'POST', body, timeout: 60000,
    headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length },
    progress: value => { if (value !== percent) { percent = value; progress({ percent, stage: value === 90 ? 'Проверка и запуск на консоли…' : 'Загрузка на консоль…' }); } }
  });
  if (result.ok !== true || result.file !== filename || result.bytes !== bundle.data.length || result.running !== true) throw new Error(result.error || 'Консоль не подтвердила загрузку и запуск');
  progress({ percent: 100, stage: 'Программа запущена на консоли' });
  return { file: filename, bytes: bundle.data.length, name: session.name, address: device.address };
}
module.exports = { target, probe, discover, deploy, broadcastAddresses, udpDiscovery, request, DISCOVERY_PORT, QUERY };
