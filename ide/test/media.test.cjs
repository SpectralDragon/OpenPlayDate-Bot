const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const codec=require('../media-codec.cjs');
const media=require('../media-project.cjs');
const {pack}=require('../sdk.cjs');
const {readBlocks,saveBlocks}=require('../blocks-project.cjs');
const blocks=require('../blocks.cjs');
test('Transparent RGB565 images roundtrip a mask across byte boundaries',()=>{
  const rgba=new Uint8Array(3*5*4);for(let i=0;i<15;i++){rgba[i*4]=255;rgba[i*4+3]=i%3?255:0;}
  const bytes=codec.encodeImage(rgba,3,5),image=codec.decodeImage(bytes);assert.equal(Buffer.from(bytes).subarray(0,4).toString(),'OPI2');assert.deepEqual(image.rgba,rgba);
  rgba.forEach((_,i)=>{if(i%4===3)rgba[i]=255;});assert.equal(Buffer.from(codec.encodeImage(rgba,3,5)).subarray(0,4).toString(),'OPI1');
  assert.throws(()=>codec.imageInfo(bytes.subarray(0,-1)),/Повреждённая/);
});
test('Music uses bounded canonical PCM WAV data and rejects malformed audio',()=>{
  const bytes=codec.encodeWav(new Float32Array([0,1,-1,0.5]));assert.equal(codec.wavInfo(bytes).duration,4/22050);
  const v=new DataView(bytes.buffer);assert.equal(v.getInt16(46,true),32767);assert.equal(v.getInt16(48,true),-32768);
  assert.throws(()=>codec.encodeWav(new Float32Array(22050*31)),/30 секунд/);bytes[24]=0;assert.throws(()=>codec.wavInfo(bytes),/PCM/);
});
test('Transparent images deploy only to consoles declaring the new image format',async()=>{
  const {fakeConsole}=require('./device-fixture.cjs'),{deploy}=require('../device.cjs');
  const old=await fakeConsole(),updated=await fakeConsole({info:{imageVersion:2}}),bundle={data:Buffer.from('OPD1-test'),manifest:{id:'image-test'},imageVersion:2};
  try{await assert.rejects(deploy(old.address,old.info.id,bundle),/обнови прошивку/);assert.equal(old.received.length,0);await deploy(updated.address,updated.info.id,bundle);assert.equal(updated.received.length,1);}
  finally{await old.close();await updated.close();}
});
test('Imported files enter real OPD bundles, preserve names and roll back an oversized import',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openplay-media-'));
  try{
    await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({api:1,id:'media',name:'Медиа',kind:'game',entry:'main.lua'}));await fs.writeFile(path.join(root,'main.lua'),'return {}');
    const pic=await media.importMedia(root,'image',{name:'Мой рисунок',width:1,height:1,rgba:[255,0,0,0]});assert.equal(pic.asset.masked,true);
    const wav=codec.encodeWav(new Float32Array(22050*30));const music=await media.importMedia(root,'sound',{name:'Моя музыка',data:wav});
    const bundle=await pack(root);assert.equal(bundle.count,3);assert.equal(media.extractSounds(bundle).size,1);assert.equal((await media.listMedia(root))[0].name,'Мой рисунок');
    const before=await fs.readdir(path.join(root,'assets'));await assert.rejects(media.importMedia(root,'sound',{name:'Лишняя',data:wav}),/2 МиБ/);assert.deepEqual(await fs.readdir(path.join(root,'assets')),before);
    await assert.rejects(media.readMedia(root,'../secret.wav'),/библиотеки/);
    assert.equal((await media.readMedia(root,music.asset.path)).duration,30);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('Existing v1 block projects migrate only when their Lua matches the original generator',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openplay-block-migration-'));
  try{
    const doc=blocks.starter(),raw=JSON.stringify(doc),old=require('../blocks-v1.cjs').compile(doc);
    await fs.writeFile(path.join(root,blocks.SOURCE),raw);await fs.writeFile(path.join(root,'main.lua'),old);
    const before=await readBlocks(root,'main.lua');assert.equal(before.needsBuild,true);
    await saveBlocks(root,doc,raw,old);assert.equal((await readBlocks(root,'main.lua')).needsBuild,false);
    await fs.writeFile(path.join(root,'main.lua'),old+'\n-- пользователь');await assert.rejects(readBlocks(root,'main.lua'),/изменён отдельно/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
