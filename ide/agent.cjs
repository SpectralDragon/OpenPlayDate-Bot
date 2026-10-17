const { spawn } = require('node:child_process');
const { Readable, Writable } = require('node:stream');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const fs = require('node:fs/promises');
const { projectFile } = require('./sdk.cjs');
const deadline = (promise, ms, message) => {
  let timer; return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]).finally(()=>clearTimeout(timer));
};
class CodingAgent extends EventEmitter {
  constructor() { super(); this.permissions=new Map(); this.permissionId=0; this.cancelled=false; }
  async connect(stage, config = {}) {
    this.stage=stage;
    const acp = await import('@agentclientprotocol/sdk');
    let executable, args;
    const env={...process.env, INITIAL_AGENT_MODE:'workspace-write'};
    // Never pass the speech key to a child process. ACP manages its own login.
    delete env.OPENPLAY_VOICE_API_KEY;
    if (config.executable) {
      if (!path.isAbsolute(config.executable) || !/\.(exe|js|mjs|cjs)$/i.test(config.executable)) throw new Error('ACP: выбери абсолютный путь к .exe или Node.js-скрипту');
      args=config.args || [];
      if (/\.[cm]?js$/i.test(config.executable)) { executable=process.execPath; args=[config.executable,...args]; env.ELECTRON_RUN_AS_NODE='1'; }
      else { executable=config.executable; delete env.ELECTRON_RUN_AS_NODE; }
    } else {
      executable=process.execPath; args=[require.resolve('@agentclientprotocol/codex-acp')]; env.ELECTRON_RUN_AS_NODE='1';
      env.CODEX_CONFIG=JSON.stringify({sandbox_mode:'workspace-write', approval_policy:'on-request', features:{multi_agent:false}, mcp_servers:{}});
    }
    this.child=spawn(executable,args,{cwd:stage,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child.stdin.on('error',()=>{});
    this.child.stderr.on('data',()=>{}); // Adapter debug output can contain credentials; never forward it.
    this.child.on('error',error=>this.emit('status',error.message));
    const handlers={
      sessionUpdate: async notification=>{
        if (this.session && notification.sessionId!==this.session) return;
        const update=notification.update;
        if (update.sessionUpdate==='agent_message_chunk' && update.content.type==='text') this.emit('text',update.content.text);
        if (update.sessionUpdate==='tool_call') this.emit('status',String(update.title || 'Агент работает…').slice(0,300));
      },
      requestPermission: params=>new Promise(resolve=>{
        if(this.cancelled) {resolve({outcome:{outcome:'cancelled'}});return;}
        const id=String(++this.permissionId); this.permissions.set(id,{resolve,options:params.options});
        this.emit('permission',{id,title:params.toolCall.title || 'Действие агента',options:params.options.map(o=>({optionId:o.optionId,name:o.name,kind:o.kind}))});
      }),
      readTextFile: async params=>{
        const file=await this.file(params.path); const bytes=await fs.readFile(file);
        if(bytes.length>262144)throw new Error('Файл больше 256 КиБ');
        const lines=bytes.toString('utf8').split('\n');
        return {content:params.line ? lines.slice(Math.max(0,params.line-1),params.limit?params.line-1+params.limit:undefined).join('\n'):bytes.toString('utf8')};
      },
      writeTextFile: async params=>{
        if(this.cancelled)throw new Error('Остановлено');
        if(typeof params.content!=='string'||Buffer.byteLength(params.content)>262144)throw new Error('Файл больше 256 КиБ');
        const file=await this.file(params.path,true); await fs.mkdir(path.dirname(file),{recursive:true}); await fs.writeFile(file,params.content);return {};
      }
    };
    this.connection=new acp.ClientSideConnection(()=>handlers,acp.ndJsonStream(Writable.toWeb(this.child.stdin),Readable.toWeb(this.child.stdout)));
    const info=await deadline(this.connection.initialize({protocolVersion:acp.PROTOCOL_VERSION,clientInfo:{name:'openplay-studio',version:'0.1.0'},clientCapabilities:{fs:{readTextFile:true,writeTextFile:true},terminal:false}}),30000,'Агент ACP не ответил при подключении');
    this.emit('status','ACP: '+(info.agentInfo?.name || 'агент подключён'));
    try { const session=await deadline(this.connection.newSession({cwd:stage,mcpServers:[]}),45000,'Агент не открыл проект'); this.session=session.sessionId; }
    catch(error) {
      if(error.code===-32000 || /auth|login|sign.in/i.test(error.message))throw new Error('Сначала войди в Codex. В настройках агента есть кнопка «Войти в Codex».');
      throw error;
    }
  }
  async file(value,create=false) {
    if(typeof value!=='string')throw new Error('Неверный путь агента');
    const relative=path.isAbsolute(value)?path.relative(this.stage,value):value;
    return projectFile(this.stage,relative.split(path.sep).join('/'),create);
  }
  async prompt(text) {
    if(this.cancelled)throw new Error('Работа агента остановлена');
    const response=await deadline(this.connection.prompt({sessionId:this.session,prompt:[{type:'text',text}]}),15*60*1000,'Агент не завершил запрос за 15 минут');
    if(this.cancelled || response.stopReason==='cancelled')throw new Error('Работа агента остановлена');
    return response;
  }
  permission(id,optionId) {
    const pending=this.permissions.get(id); if(!pending)return;
    if(!pending.options.some(o=>o.optionId===optionId))throw new Error('Неизвестный вариант разрешения');
    this.permissions.delete(id);pending.resolve({outcome:{outcome:'selected',optionId}});
  }
  stop() {
    if(this.cancelled)return;
    this.cancelled=true;
    for(const {resolve} of this.permissions.values())resolve({outcome:{outcome:'cancelled'}});this.permissions.clear();
    if(this.session)this.connection?.cancel({sessionId:this.session}).catch(()=>{}).finally(()=>this.child?.stdin.end());
    else this.child?.stdin.end(); const child=this.child;
    if(child){const timer=setTimeout(()=>child.kill(),1000);timer.unref();}
  }
  async shutdown() {
    const child=this.child;
    if(!child||child.exitCode!==null)return;
    this.stop();
    await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},2000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
  }
}
module.exports = { CodingAgent };
