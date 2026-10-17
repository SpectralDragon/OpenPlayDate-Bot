const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fakeConsole } = require('./device-fixture.cjs');
const { target, probe, udpDiscovery, discover, deploy, broadcastAddresses } = require('../device.cjs');
const { pack } = require('../sdk.cjs');
test('Discovery uses directed broadcasts for each IPv4 LAN adapter', () => {
  assert.deepEqual(broadcastAddresses({ ethernet: [{ family: 'IPv4', internal: false, address: '192.168.3.12', netmask: '255.255.255.0' }], vpn: [{ family: 'IPv4', internal: false, address: '10.1.2.3', netmask: '255.255.0.0' }] }), ['255.255.255.255','192.168.3.255','10.1.255.255']);
  for (const address of ['https://192.168.3.32', 'http://8.8.8.8', 'example.com', 'http://user:pass@192.168.3.32', '192.168.3.32/api']) assert.throws(() => target(address));
});
test('Real UDP discovery and HTTP probing agree on device identity, with a direct-IP fallback', async () => {
  const device = await fakeConsole();
  try {
    const found = await udpDiscovery({ port: device.udpPort, addresses: ['127.0.0.1'], duration: 80 });
    assert.equal(found[0].id, device.info.id); assert.equal(found[0].address, device.address);
    const info = await probe(found[0].address); assert.equal(info.name,'OpenPlay Test');
    const devices = await discover(device.address, { port: device.udpPort, addresses: ['127.0.0.1'], duration: 80 });
    assert.equal(devices.length,1); assert.equal(devices[0].address, device.address);
  } finally { await device.close(); }
});
test('Deployment sends the exact OPD binary and requires confirmed bytes, file and successful launch', async () => {
  const bundle = await pack(path.join(__dirname, '../../examples/bouncing-ball'));
  const device = await fakeConsole(); const progress = [];
  try {
    const result = await deploy(device.address, device.info.id, bundle, p=>progress.push(p));
    assert.equal(result.file,'bouncing-ball.opd'); assert.deepEqual(device.received[0].data,bundle.data);
    assert.equal(progress.at(-1).percent,100);
    await assert.rejects(deploy(device.address,'different-console',bundle), /другая консоль/);
    assert.equal(device.received.length,1);
  } finally { await device.close(); }
  for (const options of [{ reject: 'main.lua:1: unexpected symbol' }, { wrongSize: true }]) {
    const broken = await fakeConsole(options);
    try { await assert.rejects(deploy(broken.address,broken.info.id,bundle), /main.lua|не подтвердила/); }
    finally { await broken.close(); }
  }
});
