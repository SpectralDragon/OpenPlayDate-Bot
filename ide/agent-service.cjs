const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {CodingAgent}=require('./agent.cjs');
const {AgentWorkspace}=require('./agent-workspace.cjs');
const {pack}=require('./sdk.cjs');
const {checkGame}=require('./agent-check.cjs');
const {transcribe}=require('./voice.cjs');
class AgentService {
  constructor({data,temp,executable,documentation,safeStorage,send}){Object.assign(this,{data,temp,executable,documentation,safeStorage,send});}
  async config(){try{return JSON.parse(await fs.readFile(path.join(this.data,'agent.json'),'utf8'));}catch{return {};}}
  async settings(){const c=await this.config();let stored=false;try{await fs.access(path.join(this.data,'voice-key'));stored=true;}catch{}return {...c,hasVoiceKey:stored||!!(process.env.OPENPLAY_VOICE_API_KEY||process.env.OPENAI_API_KEY)};}
  async saveSettings(value){
    if(this.active)throw new Error('Дождись завершения агента или останови его');
    if(!value||typeof value!=='object')throw new Error('Неверные настройки');
    const executable=String(value.executable||'').trim();
    if(executable&&(!path.isAbsolute(executable)||!/\.(exe|js|mjs|cjs)$/i.test(executable)))throw new Error('Выбери путь к ACP .exe или Node.js-скрипту');
    const args=value.args||[];
    if(!Array.isArray(args)||args.length>32||args.some(a=>typeof a!=='string'||a.length>1000))throw new Error('Аргументы ACP должны быть JSON-массивом строк');
    const config={executable,args};
    if(value.voiceKey){
      if(typeof value.voiceKey!=='string'||value.voiceKey.length>512||/[\r\n]/.test(value.voiceKey))throw new Error('Неверный API-ключ');
      if(!this.safeStorage.isEncryptionAvailable())throw new Error('Системное хранилище ключей недоступно');
      await fs.writeFile(path.join(this.data,'voice-key'),this.safeStorage.encryptString(value.voiceKey.trim()),{mode:0o600});
    }
    if(value.clearVoiceKey)await fs.rm(path.join(this.data,'voice-key'),{force:true});
    await fs.writeFile(path.join(this.data,'agent.json'),JSON.stringify(config));return this.settings();
  }
  async speech(bytes){
    let key=process.env.OPENPLAY_VOICE_API_KEY||process.env.OPENAI_API_KEY;
    try{key=this.safeStorage.decryptString(await fs.readFile(path.join(this.data,'voice-key')));}catch{}
    return transcribe(bytes,key);
  }
  async run(root,idea){
    if(this.active)throw new Error('Агент уже работает');
    if(typeof idea!=='string'||!idea.trim()||idea.length>10000)throw new Error('Опиши игру или изменение, до 10 000 символов');
    this.active=true;let workspace,agent;
    try{
      if(this.pending){await this.pending.dispose();this.pending=null;}
      workspace=await AgentWorkspace.create(root,this.temp);
      agent=new CodingAgent();this.agent=agent;
      agent.on('text',text=>this.send({type:'text',text}));
      agent.on('status',text=>this.send({type:'status',text}));
      agent.on('permission',request=>this.send({type:'permission',...request}));
      this.send({type:'status',text:'Подключаем агента через ACP…'});
      await agent.connect(workspace.stage,await this.config());
      const docs=await fs.readFile(this.documentation,'utf8');
      await agent.prompt(`Ты помогаешь семилетней девочке создавать игры для OpenPlay. Отвечай по-русски, просто и коротко. Если замысел неполный, придумай подходящие детали сам. В детской речи звук Р иногда заменяется на Л: учитывай смысл, не заменяй буквы вслепую.
Работай с файлами игры в текущей папке. Реализуй просьбу, а не только объясняй. Это отдельная рабочая копия: исходники будут применены пользователем после просмотра. Используй только OpenPlay Lua API 1 из справочника ниже. Сохрани валидный manifest.json; kind=game, если пользователь не просит робота. Экран 320x240, кнопки a/b/stick и направления. Координаты целые. Никаких Playdate API, os, io, сторонних зависимостей или сети. update/draw должны возвращаться каждый кадр. Не создавай служебные файлы в бандле. Не обращайся к файлам вне текущей папки и не запускай других агентов. В конце кратко расскажи управление. Не отправляй ничего на физическую консоль.
СПРАВОЧНИК API:\n${docs}\n\nПРОСЬБА ПОЛЬЗОВАТЕЛЯ:\n${idea}`);
      for(let attempt=0;attempt<3;attempt++){
        if(agent.cancelled)throw new Error('Работа агента остановлена');
        this.send({type:'status',text:'Проверяем игру в симуляторе…'});
        try{
          const bundle=await pack(workspace.stage);
          await checkGame(bundle,path.join(workspace.temp,'check'),this.executable);break;
        }catch(error){
          if(attempt===2)throw new Error('Агент не исправил ошибку игры: '+error.message);
          this.send({type:'status',text:'Нашлась ошибка. Агент исправляет её…'});
          await agent.prompt('При проверке возникла ошибка: '+error.message+'\nИсправь её в файлах. Игра должна показать минимум 5 кадров update/draw. Не меняй принципиально идею игры.');
        }
      }
      const changes=await workspace.preview();
      if(!changes.length){await workspace.dispose();return {changes:[],message:'Агент не изменил файлы'};}
      this.pending=workspace;return {changes,message:'Игра проверена: 5 кадров без ошибок'};
    }catch(error){const cancelled=agent?.cancelled;await agent?.shutdown();await workspace?.dispose();if(cancelled)throw new Error('Работа агента остановлена');throw error;}
    finally{await agent?.shutdown();await workspace?.dispose();this.agent=null;this.active=false;}
  }
  async apply(root){
    if(!this.pending||this.pending.root!==await fs.realpath(root))throw new Error('Проект изменился. Повтори запрос агента.');
    await this.pending.apply();
    await this.undoWorkspace?.dispose();this.undoWorkspace=this.pending;this.pending=null;
  }
  async undo(root){if(!this.undoWorkspace||this.undoWorkspace.root!==await fs.realpath(root))throw new Error('Нет изменений агента для этого проекта');await this.undoWorkspace.undo();await this.undoWorkspace.dispose();this.undoWorkspace=null;}
  async discard(){await this.pending?.dispose();this.pending=null;}
  cancel(){this.agent?.stop();}
  permission(id,optionId){this.agent?.permission(id,optionId);}
  login(){
    if(this.loginProcess)throw new Error('Вход уже выполняется');
    const child=spawn(process.execPath,[require.resolve('@agentclientprotocol/codex-acp'),'login'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
    this.loginProcess=child;
    for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>this.send({type:'login',text:bytes.toString().replace(/\x1b\[[0-9;]*m/g,'').slice(0,4000)}));
    child.on('error',error=>{this.send({type:'login',text:error.message});this.loginProcess=null;});
    child.on('exit',code=>{this.send({type:'login',text:code===0?'Вход в Codex выполнен':'Вход не завершён'});this.loginProcess=null;});
  }
  close(){this.cancel();this.loginProcess?.kill();}
}
module.exports={AgentService};
