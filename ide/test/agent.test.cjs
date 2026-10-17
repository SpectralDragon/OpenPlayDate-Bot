const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {AgentWorkspace}=require('../agent-workspace.cjs');
const {AgentService}=require('../agent-service.cjs');
const {CodingAgent}=require('../agent.cjs');
const {transcribe}=require('../voice.cjs');
async function setup(){const temp=await fs.mkdtemp(path.join(os.tmpdir(),'openplay-agent-test-'));const root=path.join(temp,'original');await fs.cp(path.join(__dirname,'../../examples/bouncing-ball'),root,{recursive:true});return {temp,root};}
test('Agent changes stay in a copy; apply/undo are guarded against external edits',async()=>{
  const {temp,root}=await setup();let workspace;
  try{
    workspace=await AgentWorkspace.create(root,temp);const original=await fs.readFile(path.join(root,'main.lua'),'utf8');
    await fs.writeFile(path.join(workspace.stage,'main.lua'),'return {}');const preview=await workspace.preview();assert.equal(preview.length,1);assert.equal(preview[0].kind,'changed');
    assert.equal(await fs.readFile(path.join(root,'main.lua'),'utf8'),original);
    await workspace.apply();assert.equal(await fs.readFile(path.join(root,'main.lua'),'utf8'),'return {}');
    await workspace.undo();assert.equal(await fs.readFile(path.join(root,'main.lua'),'utf8'),original);
    await fs.writeFile(path.join(root,'main.lua'),'-- external');await assert.rejects(workspace.apply(),/изменились/);
    const agent=new CodingAgent();agent.stage=workspace.stage;await assert.rejects(agent.file('../outside.lua',true),/путь/);
  }finally{await workspace?.dispose();await fs.rm(temp,{recursive:true,force:true});}
});
test('Real ACP stdio: file callbacks, permission response, automatic Lua repair, preview, apply and undo',async()=>{
  const {temp,root}=await setup();const events=[];
  const service=new AgentService({data:temp,temp,executable:path.join(__dirname,'../native/build',process.platform==='win32'?'openplay-simulator.exe':'openplay-simulator'),documentation:path.join(__dirname,'../../docs/lua-api.md'),safeStorage:{isEncryptionAvailable:()=>false},send:event=>{events.push(event);if(event.type==='permission')service.permission(event.id,'yes');}});
  try{
    await service.saveSettings({executable:process.execPath,args:[path.join(__dirname,'fake-acp.cjs'),'--permission','--repair']});
    const original=await fs.readFile(path.join(root,'main.lua'),'utf8');const result=await service.run(root,'Сделай игру с котиком');
    assert.ok(result.changes.some(c=>c.path==='main.lua'));assert.ok(events.some(e=>e.type==='permission'));assert.ok(events.some(e=>/исправляет/.test(e.text||'')));
    assert.equal(await fs.readFile(path.join(root,'main.lua'),'utf8'),original);
    await service.apply(root);assert.match(await fs.readFile(path.join(root,'main.lua'),'utf8'),/Игра агента/);
    await service.undo(root);assert.equal(await fs.readFile(path.join(root,'main.lua'),'utf8'),original);
  }finally{service.close();await service.discard();await service.undoWorkspace?.dispose();await fs.rm(temp,{recursive:true,force:true});}
});
test('ACP cancellation closes a pending generation without editing the project',async()=>{
  const {temp,root}=await setup();const service=new AgentService({data:temp,temp,documentation:path.join(__dirname,'../../docs/lua-api.md'),send:()=>{}});
  try{
    await service.saveSettings({executable:process.execPath,args:[path.join(__dirname,'fake-acp.cjs'),'--wait']});
    const result=service.run(root,'Игра');const rejection=assert.rejects(result,/остановлена|closed|connection/i);
    while(!service.agent?.session)await new Promise(resolve=>setTimeout(resolve,20));service.cancel();await rejection;assert.equal(service.active,false);
  }finally{service.close();await fs.rm(temp,{recursive:true,force:true});}
});
test('Voice API keeps credentials in the main process and returns only transcript text',async()=>{
  const bytes=new Uint8Array(200);await assert.rejects(transcribe(bytes,''),/ключ/);
  const text=await transcribe(bytes,'test-key',async(url,request)=>{
    assert.equal(url,'https://api.openai.com/v1/audio/transcriptions');assert.equal(request.headers.Authorization,'Bearer test-key');
    assert.equal(request.body.get('language'),'ru');assert.equal(request.body.get('file').name,'voice.webm');
    return {ok:true,json:async()=>({text:'Сделай игру про котика'})};
  });assert.equal(text,'Сделай игру про котика');
  await assert.rejects(transcribe(bytes,'test-key',async()=>({ok:false,status:401})),/не принят/);
});
