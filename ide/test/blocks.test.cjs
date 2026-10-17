const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {compile,starter,SOURCE}=require('../blocks.cjs');
const {readBlocks,saveBlocks}=require('../blocks-project.cjs');
const {pack}=require('../sdk.cjs');
const exe=path.join(__dirname,'../native/build',process.platform==='win32'?'openplay-simulator.exe':'openplay-simulator');
const b=(type,fields={},body,next)=>({type:'op_'+type,fields,...(body?{inputs:{DO:{block:body}}}:{}),...(next?{next:{block:next}}:{})});
async function project(doc){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openplay-blocks-'));
  await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({api:1,id:'blocks',name:'Блоки',kind:'game',entry:'main.lua',fps:30}));
  await fs.writeFile(path.join(root,SOURCE),JSON.stringify(doc));await fs.writeFile(path.join(root,'main.lua'),compile(doc));return root;
}
async function execute(doc,commands){
  const root=await project(doc);
  try{
    // Observe state inside the generated Lua lexical scope; execute everything in the real firmware VM.
    const instrumented=compile(doc).replace('g.clear(background)','opd.system.log(tostring(score)..","..tostring(actors[1].x)..","..tostring(actors[1].color))\n    g.clear(background)');
    await fs.unlink(path.join(root,SOURCE));await fs.writeFile(path.join(root,'main.lua'),instrumented);
    const bundle=await pack(root);await fs.mkdir(path.join(root,'apps'));await fs.writeFile(path.join(root,'apps/blocks.opd'),bundle.data);
    const result=spawnSync(exe,[root,'blocks.opd'],{input:commands.join('\n')+'\nstop\n',timeout:5000,windowsHide:true,maxBuffer:8*1024*1024});
    assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr?.toString());
    const events=[];let bytes=result.stdout;
    while(bytes.length>=5){const size=bytes.readUInt32LE(1),payload=bytes.subarray(5,5+size);if(bytes[0]===74)events.push(JSON.parse(payload));bytes=bytes.subarray(5+size);}
    assert.deepEqual(events.filter(e=>e.type==='error'),[]);
    return events.filter(e=>e.type==='log').map(e=>e.message.split(',').map(Number));
  }finally{await fs.rm(root,{recursive:true,force:true});}
}
test('Blocks preserve parallel waits, nested repeats and button events in real Lua',async()=>{
  const doc=starter();doc.sprites=doc.sprites.slice(0,1);
  doc.sprites[0].workspace.blocks.blocks=[
    b('start',{},b('repeat',{TIMES:2},b('repeat',{TIMES:3},b('score',{VALUE:1})),b('wait',{SECONDS:0.2},null,b('score',{VALUE:10})))),
    b('forever',{},b('move',{X:1,Y:0})),
    b('pressed',{KEY:'a'},b('color',{COLOR:'26111'},null,b('wait',{SECONDS:0.1},null,b('color',{COLOR:'63768'}))))
  ];
  const states=await execute(doc,['frame 34 0','frame 68 1','frame 102 0','frame 136 0','frame 170 0','frame 204 0','frame 238 0','frame 272 0']);
  assert.equal(states[0][0],6);assert.equal(states.at(-1)[0],16);assert.ok(states.at(-1)[1]>states[0][1]);
  assert.ok(states.some(s=>s[2]===26111));assert.equal(states.at(-1)[2],63768);
});
test('Blocks starter collisions score once and move the collectible away',async()=>{
  const doc=starter();doc.sprites[0].x=240;doc.sprites[0].y=90;
  const states=await execute(doc,['frame 34 0','frame 68 0','frame 102 0']);assert.ok(states.every(s=>s[0]===1));
});
test('Busy block scripts yield within the firmware instruction budget',async()=>{
  const doc=starter();doc.sprites=doc.sprites.slice(0,1);
  doc.sprites[0].workspace.blocks.blocks=Array.from({length:64},()=>b('forever',{},b('repeat',{TIMES:1000},b('score',{VALUE:1}))));
  const states=await execute(doc,['frame 34 0','frame 68 0','frame 102 0']);
  assert.equal(states.length,3);assert.ok(states[2][0]>states[0][0]);
});
test('Block saves guard both source and generated Lua; OPD excludes editor JSON',async()=>{
  const doc=starter(),root=await project(doc);
  try{
    const before=await readBlocks(root,'main.lua');doc.sprites[0].name='Кошечка';
    const after=await saveBlocks(root,doc,before.raw,before.lua);assert.equal((await readBlocks(root,'main.lua')).document.sprites[0].name,'Кошечка');
    const bundle=await pack(root);assert.equal(bundle.count,1);assert.ok(!bundle.data.includes(Buffer.from(SOURCE)));
    await assert.rejects(saveBlocks(root,starter(),before.raw,before.lua),/другой программой/);
    await fs.writeFile(path.join(root,'main.lua'),after.lua+'\n-- external');
    await assert.rejects(pack(root),/изменён отдельно/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('Compiler rejects detached blocks, missing sprites, unbounded values and excessive nesting',()=>{
  let doc=starter();doc.sprites[0].workspace.blocks.blocks=[b('move',{X:1,Y:0})];assert.throws(()=>compile(doc),/подсоедини/);
  doc=starter();doc.sprites[1].workspace.blocks.blocks[0].inputs.DO.block.fields.OTHER='gone';assert.throws(()=>compile(doc),/неизвестное/);
  doc=starter();doc.sprites[0].x=Infinity;assert.throws(()=>compile(doc),/границ/);
  doc=starter();let body=b('wait',{SECONDS:0});for(let i=0;i<26;i++)body=b('repeat',{TIMES:1},body);
  doc.sprites[0].workspace.blocks.blocks=[b('start',{},body)];assert.throws(()=>compile(doc),/вложенных/);
});
