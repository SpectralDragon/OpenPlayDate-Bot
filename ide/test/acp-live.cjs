// Opt-in end-to-end generation using the user's Codex account/quota.
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {AgentService}=require('../agent-service.cjs');
(async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'openplay-live-agent-'));const root=path.join(temp,'game');
  await fs.cp(path.join(__dirname,'../../examples/bouncing-ball'),root,{recursive:true});
  const service=new AgentService({data:temp,temp,executable:path.join(__dirname,'../native/build',process.platform==='win32'?'openplay-simulator.exe':'openplay-simulator'),documentation:path.join(__dirname,'../../docs/lua-api.md'),send:event=>{
    if(event.type==='status')console.log(event.text);
    if(event.type==='permission'){
      const reject=event.options.find(o=>o.kind==='reject_once');
      if(reject)service.permission(event.id,reject.optionId);else service.cancel();
    }
  }});
  try{const result=await service.run(root,'Сделай простую игру: котик ловит звёздочку. Движение стрелками, A начинает заново, B выходит. Нарисуй котика простыми фигурами, добавь счёт. Сделай игру сразу, не задавай вопросов.');console.log('PASS: live Codex generated a game; '+result.message+'; changed '+result.changes.map(c=>c.path).join(', '));}
  finally{service.close();await service.discard();await fs.rm(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
