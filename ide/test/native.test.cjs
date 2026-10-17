const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pack } = require('../sdk.cjs');
const exe = path.join(__dirname, '../native/build', process.platform === 'win32' ? 'openplay-simulator.exe' : 'openplay-simulator');
async function fixture(script, manifest = {}, extra = {}) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'openplay-тест-'));
  const project = path.join(temp, 'project'); await fs.mkdir(project);
  await fs.writeFile(path.join(project, 'manifest.json'), JSON.stringify({ api: 1, id: 'test', name: 'Тест', kind: 'game', entry: 'main.lua', ...manifest }));
  await fs.writeFile(path.join(project, 'main.lua'), script);
  for (const [name, data] of Object.entries(extra)) await fs.writeFile(path.join(project, name), data);
  const bundle = await pack(project); await fs.mkdir(path.join(temp, 'apps')); await fs.writeFile(path.join(temp, 'apps/test.opd'), bundle.data);
  return temp;
}
function session(storage) {
  const child = spawn(exe, [storage, 'test.opd'], { windowsHide: true });
  const queue = [], waiters = []; let buffer = Buffer.alloc(0);
  child.stdout.on('data', data => {
    buffer = Buffer.concat([buffer, data]);
    while (buffer.length >= 5 && buffer.length >= buffer.readUInt32LE(1) + 5) {
      const size = buffer.readUInt32LE(1), bytes = buffer.subarray(5, 5 + size);
      const result = buffer[0] === 70 ? { type: 'frame', bytes } : JSON.parse(bytes);
      buffer = buffer.subarray(size + 5); if (waiters.length) waiters.shift()(result); else queue.push(result);
    }
  });
  child.stdin.on('error', () => {});
  return { child, send: s => child.stdin.write(s + '\n'), async next(type) {
    for (;;) {
      const item = queue.length ? queue.shift() : await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout waiting for ' + type)), 4000);
        waiters.push(value => { clearTimeout(timer); resolve(value); });
      });
      if (item.type === type) return item;
    }
  }, async close() { child.kill(); await new Promise(r => { if (child.exitCode !== null) r(); else child.once('exit', r); }); await fs.rm(storage, { recursive: true, force: true }); } };
}
test('Real Lua: modules, assets, Russian font, RGB565 raster and input edges', async () => {
  const temp = await fixture(`local g=opd.graphics
local module=require('helper')
local pressed,released=false,false
return {update=function(dt)
  if opd.input.pressed('a') then pressed=true end
  if opd.input.released('a') then released=true end
end,draw=function()
 g.clear(0); g.color(g.rgb(255,0,0)); g.line(1,1,10,1); g.rect(20,20,8,8)
 g.fillCircle(50,50,5); g.text('Привет',80,80)
 if pressed and released then g.pixel(0,0) end
 if module==42 and opd.assets.read('hint.txt')=='ok' then g.pixel(319,239) end
end}`, {}, { 'helper.lua': 'return 42', 'hint.txt': 'ok' });
  const s = session(temp);
  try {
    await s.next('ready'); s.send('frame 34 0'); let frame = (await s.next('frame')).bytes;
    const pixel = (x,y) => frame.readUInt16LE((y*320+x)*2);
    assert.equal(pixel(10,1), 0xf800); assert.equal(pixel(27,27), 0xf800); assert.equal(pixel(50,55), 0xf800); assert.equal(pixel(319,239), 0xf800);
    assert.ok(frame.subarray((80*320+80)*2, (100*320+150)*2).some(b => b));
    s.send('input 40 1'); s.send('input 45 0'); s.send('frame 70 0'); frame = (await s.next('frame')).bytes; assert.equal(pixel(0,0), 0xf800);
  } finally { await s.close(); }
});
test('Robot ports release on pause and accept virtual GPIO/UART', async () => {
  const temp = await fixture(`local function setup() opd.gpio.mode(16,'output'); opd.gpio.mode(1,'input_pullup'); opd.uart.open() end
return {init=setup,resume=setup,update=function()
 opd.gpio.write(16,opd.gpio.read(1))
 if opd.uart.available()>0 then opd.system.log(opd.uart.read(256)); opd.uart.write('pong') end
end}`, { kind: 'robot', permissions: { gpio: [16,1], uart: { port: 1, tx: 17, rx: 18, baud: 9600 } } });
  const s = session(temp);
  try {
    await s.next('ready'); s.send('frame 34 0'); let hw = await s.next('hardware'); assert.equal(hw.pins.find(p=>p.pin===16).level,1);
    s.send('gpio 1 0'); s.send('uart 112 105 110 103'); s.send('frame 70 0'); assert.equal((await s.next('log')).message,'ping'); hw=await s.next('hardware'); assert.equal(hw.tx,'pong'); assert.equal(hw.pins.find(p=>p.pin===16).level,0);
    s.send('pause'); hw=await s.next('hardware'); assert.equal(hw.uartOpen,false); assert.equal(hw.pins.find(p=>p.pin===16).mode,1); await s.next('paused');
    s.send('resume'); await s.next('resumed'); s.send('frame 105 0'); hw=await s.next('hardware'); assert.equal(hw.uartOpen,true);
  } finally { await s.close(); }
});
test('Syntax errors and infinite loops produce readable errors and terminate', async () => {
  for (const script of ['return { draw = function( }', 'while true do end', 'return {update=function() while true do end end}']) {
    const temp = await fixture(script); const s = session(temp);
    try {
      if (script.startsWith('return {update')) { await s.next('ready'); s.send('frame 34 0'); }
      const error=await s.next('error'); assert.match(error.message, /main.lua|budget/);
    } finally { await s.close(); }
  }
});
test('Transparent imported images preserve underlying pixels on cache hits and clipping',async()=>{
  const {encodeImage}=require('../media-codec.cjs');
  const rgba=new Uint8Array([255,0,0,255,0,0,0,0,255,0,0,255,0,0,0,0,255,0,0,255,0,0,0,0]);
  const temp=await fixture(`return {draw=function() local g=opd.graphics g.clear(31) g.image('mask.opi',10,10) g.image('mask.opi',20,20) g.image('mask.opi',-1,-1) end}`,{}, {'mask.opi':encodeImage(rgba,3,2)}),s=session(temp);
  try{await s.next('ready');s.send('frame 34 0');const frame=(await s.next('frame')).bytes,pixel=(x,y)=>frame.readUInt16LE((y*320+x)*2);
    assert.equal(pixel(10,10),0xf800);assert.equal(pixel(11,10),31);assert.equal(pixel(10,11),31);assert.equal(pixel(11,11),0xf800);assert.equal(pixel(21,21),0xf800);assert.equal(pixel(0,0),0xf800);assert.equal(pixel(1,0),31);
  }finally{await s.close();}
});
test('Native audio protocol follows Lua playback and pause/resume/stop lifecycle',async()=>{
  const wav=require('../media-codec.cjs').encodeWav(new Float32Array(2205));
  const temp=await fixture(`return {init=function() assert(opd.audio.available) opd.audio.play('tone.wav',true) end}`,{}, {'tone.wav':wav}),s=session(temp);
  try{
    let event=await s.next('audio');while(event.action!=='play')event=await s.next('audio');assert.equal(event.path,'tone.wav');assert.equal(event.loop,true);await s.next('ready');
    s.send('pause');assert.equal((await s.next('audio')).action,'pause');await s.next('paused');s.send('resume');assert.equal((await s.next('audio')).action,'resume');await s.next('resumed');s.send('stop');assert.equal((await s.next('audio')).action,'stop');
  }finally{await s.close();}
});
