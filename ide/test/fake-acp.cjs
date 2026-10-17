// An actual stdio JSON-RPC ACP server used only by tests; no inference or network.
const readline=require('node:readline');
const path=require('node:path');
let cwd, counter=100, turns=0, waitingPrompt;
const pending=new Map();
const send=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
const result=(id,value)=>send({id,result:value});
const client=(method,params)=>new Promise((resolve,reject)=>{const id=++counter;pending.set(id,{resolve,reject});send({id,method,params});});
const notify=update=>send({method:'session/update',params:{sessionId:'test-session',update}});
readline.createInterface({input:process.stdin}).on('line',async line=>{
  const message=JSON.parse(line);
  if(!message.method){const p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(new Error(message.error.message)):p.resolve(message.result);}return;}
  const {id,method,params}=message;
  try{
    if(method==='initialize'){result(id,{protocolVersion:1,agentInfo:{name:'Test ACP'},agentCapabilities:{},authMethods:[]});return;}
    if(method==='session/new'){cwd=params.cwd;result(id,{sessionId:'test-session'});return;}
    if(method==='session/cancel'){if(waitingPrompt!==undefined)result(waitingPrompt,{stopReason:'cancelled'});return;}
    if(method==='session/prompt'){
      if(process.argv.includes('--wait')){waitingPrompt=id;return;}
      if(process.argv.includes('--permission')){
        const response=await client('session/request_permission',{sessionId:'test-session',toolCall:{toolCallId:'write',title:'Записать новую игру',kind:'edit',status:'pending'},options:[{optionId:'yes',name:'Allow',kind:'allow_once'},{optionId:'no',name:'Reject',kind:'reject_once'}]});
        if(response.outcome.optionId!=='yes'){result(id,{stopReason:'refusal'});return;}
      }
      await client('fs/read_text_file',{sessionId:'test-session',path:path.join(cwd,'manifest.json')});
      const bad=process.argv.includes('--repair')&&++turns===1;
      await client('fs/write_text_file',{sessionId:'test-session',path:path.join(cwd,'main.lua'),content:bad?'return {draw=function(}':`local g=opd.graphics\nreturn { draw=function() g.clear(g.rgb(12,35,42)); g.color(65535); g.text("Игра агента",20,20) end }\n`});
      notify({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Игра готова!'}});
      result(id,{stopReason:'end_turn'});
    }
  }catch(error){send({id,error:{code:-32603,message:error.message}});}
}).on('close',()=>process.exit());
