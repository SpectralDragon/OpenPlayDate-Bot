// Opt in: deploys a small test program to the specified physical console.
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {encodeImage,encodeWav}=require('../media-codec.cjs');
const {pack}=require('../sdk.cjs');
const {probe,deploy}=require('../device.cjs');
(async()=>{
  if(process.argv.length!==4)throw Error('Usage: node test/media-hardware.cjs PRIVATE_IP COM_PORT');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openplay-hardware-media-'));
  try{
    await fs.mkdir(path.join(root,'assets'));
    const rgba=new Uint8Array(64*64*4);
    for(let y=0;y<64;y++)for(let x=0;x<64;x++){const p=(y*64+x)*4;rgba[p]=255;rgba[p+3]=((x>>4)+(y>>4))%2===0?255:0;}
    await fs.writeFile(path.join(root,'assets/check.opi'),encodeImage(rgba,64,64));await fs.writeFile(path.join(root,'assets/check.wav'),encodeWav(new Float32Array(2205)));
    await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({api:1,id:'studio-media-check',name:'Проверка костюмов',kind:'game',entry:'main.lua',fps:30}));
    await fs.writeFile(path.join(root,'main.lua'),`return {init=function() assert(opd.audio.available==false) assert(opd.audio.play('assets/check.wav',true)==false) end,draw=function() local g=opd.graphics g.clear(31) g.image('assets/check.opi',100,80) g.image('assets/check.opi',20,20) g.color(65535) g.text('Картинки работают',80,170) end}`);
    const device=await probe(process.argv[2]),result=await deploy(device.address,device.id,await pack(root));console.log(JSON.stringify(result));
    const output=path.join(__dirname,'artifacts/media-hardware.ppm');await fs.mkdir(path.dirname(output),{recursive:true});
    const python=path.join(process.env.USERPROFILE,'.platformio/penv/Scripts/python.exe');
    console.log(execFileSync(python,[path.join(__dirname,'../../tools/dump_screen.py'),'--port',process.argv[3],'--output',output],{windowsHide:true,timeout:30000}).toString().trim());
    const ppm=await fs.readFile(output),header=Buffer.from('P6\n320 240\n255\n');assert.ok(ppm.subarray(0,header.length).equals(header));
    const pixel=(x,y)=>Array.from(ppm.subarray(header.length+(y*320+x)*3,header.length+(y*320+x)*3+3));
    assert.deepEqual(pixel(100,80),[255,0,0]);assert.deepEqual(pixel(116,80),[0,0,255]);assert.deepEqual(pixel(100,96),[0,0,255]);assert.deepEqual(pixel(116,96),[255,0,0]);assert.deepEqual(pixel(20,20),[255,0,0]);
    console.log('PASS: physical ESP32 Lua, OPI2 mask and cache, screenshot pixels, audio.available=false and validated no-output WAV playback');
  }finally{await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
