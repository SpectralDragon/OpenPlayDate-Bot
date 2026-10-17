// Explicit read-only connection check. Never sends a model prompt.
const {CodingAgent}=require(process.argv.includes('--packaged')?'../dist/OpenPlay-Studio-win32-x64/resources/app/agent.cjs':'../agent.cjs');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'openplay-acp-connect-'));const agent=new CodingAgent();
  agent.on('status',message=>console.log(message));
  try{await agent.connect(temp);console.log('PASS: bundled Codex ACP initialize and session/new, using existing login');}
  finally{await agent.shutdown();await fs.rm(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
