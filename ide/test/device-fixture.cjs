const http = require('node:http');
const { QUERY } = require('../device.cjs');
const dgram = require('node:dgram');
const token = '0123456789abcdef01234567';
async function fakeConsole(options = {}) {
  const received = [];
  const info = { product: 'OpenPlay', protocol: 1, api: 1, id: 'test-console', name: 'OpenPlay Test', storage: true, ...options.info };
  const server = http.createServer((req, res) => {
    const answer = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.url === '/api/info') { answer(200, info); return; }
    if (req.url === '/api/studio') {
      if (req.headers['x-openplay-studio'] !== '1') { answer(403, { error: 'header' }); return; }
      answer(200, { ...info, token }); return;
    }
    if (req.url.startsWith('/api/apps?token=')) {
      const chunks = []; req.on('data', data => chunks.push(data));
      req.on('end', () => {
        if (req.headers['x-openplay-studio'] !== '1' || req.url !== '/api/apps?token=' + token) { answer(403, { error: 'Нет доступа' }); return; }
        const body = Buffer.concat(chunks), start = body.indexOf('\r\n\r\n') + 4;
        const boundary = req.headers['content-type'].split('boundary=')[1];
        const end = body.lastIndexOf(Buffer.from('\r\n--' + boundary + '--'));
        const filename = body.subarray(0,start).toString().match(/filename="([^"]+)"/)?.[1];
        const data = body.subarray(start,end); received.push({ filename, data });
        if (options.reject) { answer(422, { ok: false, error: options.reject }); return; }
        answer(200, { ok: true, running: true, file: filename, bytes: options.wrongSize ? data.length + 1 : data.length });
      });
      return;
    }
    answer(404, { error: 'not found' });
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  info.port = server.address().port;
  const udp = dgram.createSocket('udp4');
  udp.on('message', (bytes, remote) => { if (bytes.toString() === QUERY) udp.send(JSON.stringify(info), remote.port, remote.address); });
  await new Promise(resolve => udp.bind(0,'127.0.0.1',resolve));
  return { address: '127.0.0.1:' + info.port, info, received, udpPort: udp.address().port,
    async close() { udp.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
module.exports = { fakeConsole };
