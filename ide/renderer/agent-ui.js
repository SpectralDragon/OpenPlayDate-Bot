/* global $, api, busy, editor, execute, saveAll, applyProject, run, log, monaco */
let agentRunning=false, agentPreview=null, diffEditor, diffModels=[], recording, recordingStream, recordingTimer, speechBusy=false, voiceConfigured=false, agentAnswer='';
let closeAfterAgent=false;
function closeAgentOnExit(){if(!agentRunning)return false;closeAfterAgent=true;api.cancelAgent().catch(()=>{});return true;}
function updateAgentButtons(){
  const blockProject=typeof blocksUI!=='undefined'&&blocksUI.active;
  $('agent-send').disabled=busy||agentRunning||speechBusy||!!recording||!editor||blockProject;
  $('agent-send').title=blockProject?'Помощник пока меняет Lua-проекты. Эту игру можно менять блоками.':'';
  $('agent-settings').disabled=busy||agentRunning||speechBusy||!!recording;
  $('agent-mic').disabled=(busy||agentRunning||speechBusy)&&!recording;
  $('agent-cancel').hidden=!agentRunning;
  $('agent-undo').disabled=busy||blockProject||!$('agent-undo').dataset.available;
  if(blockProject&&!agentRunning)$('agent-status').textContent='Эту игру меняем блоками. Помощник пока работает с Lua-проектами.';
}
function agentBubble(text,kind='assistant'){
  const bubble=document.createElement('div');bubble.className='agent-bubble '+kind;bubble.textContent=text;
  $('agent-messages').append(bubble);
  while($('agent-messages').children.length>60)$('agent-messages').firstChild.remove();
  $('agent-messages').scrollTop=$('agent-messages').scrollHeight;return bubble;
}
function say(text){
  if(!$('agent-speak').checked||!window.speechSynthesis)return;
  const readable=text.replace(/```[\s\S]*?```/g,'').replace(/[*#`]/g,'').slice(-1200);
  if(!readable.trim())return;
  speechSynthesis.cancel();const speech=new SpeechSynthesisUtterance(readable);speech.lang='ru-RU';speech.rate=1;
  speech.voice=speechSynthesis.getVoices().find(v=>v.lang.startsWith('ru'))||null;speechSynthesis.speak(speech);
}
function openAgent(){$('agent-panel').hidden=false;$('agent-idea').focus();}
$('agent-toggle').onclick=()=>$('agent-panel').hidden?openAgent():$('agent-panel').hidden=true;
$('agent-hide').onclick=()=>{$('agent-panel').hidden=true;};
$('agent-speak').onchange=()=>{if(!$('agent-speak').checked)window.speechSynthesis?.cancel();};
let answerBubble;
api.onAgentEvent(event=>{
  if(event.type==='text'){
    agentAnswer=(agentAnswer+event.text).slice(-100000);
    if(!answerBubble)answerBubble=agentBubble('');answerBubble.textContent=agentAnswer;
    $('agent-messages').scrollTop=$('agent-messages').scrollHeight;
  }
  if(event.type==='status')$('agent-status').textContent=event.text;
  if(event.type==='login'){$('agent-login-status').textContent=($('agent-login-status').textContent+event.text+'\n').slice(-8000);}
  if(event.type==='permission'){
    const card=document.createElement('div');card.className='agent-permission';
    const title=document.createElement('p');title.textContent=event.title;card.append(title);
    // Show single-action decisions only; never grant a persistent broad approval.
    for(const option of event.options.filter(o=>!o.kind.endsWith('_always'))){
      const button=document.createElement('button');button.className='quiet';button.textContent=option.kind==='allow_once'?'Разрешить один раз':option.kind==='reject_once'?'Не разрешать':option.name;
      button.onclick=async()=>{await api.agentPermission(event.id,option.optionId);card.remove();};card.append(button);
    }
    $('agent-permissions').append(card);openAgent();
  }
});
function showAgentDiff(){
  if(!agentPreview)return;
  const change=agentPreview.changes[Number($('agent-diff-files').value)||0];
  if(!change)return;
  diffEditor?.setModel(null);for(const model of diffModels)model.dispose();
  const language=change.path.endsWith('.lua')?'lua':change.path.endsWith('.json')?'json':'plaintext';
  diffModels=[monaco.editor.createModel(change.binary?'Бинарный файл':change.before,language),monaco.editor.createModel(change.binary?'Бинарный файл':change.after,language)];
  diffEditor.setModel({original:diffModels[0],modified:diffModels[1]});
}
function previewAgent(result){
  agentPreview=result;$('agent-diff-files').replaceChildren();
  result.changes.forEach((change,index)=>{const option=document.createElement('option');option.value=index;option.textContent=({added:'+ ',deleted:'− ',changed:'↔ '})[change.kind]+change.path;$('agent-diff-files').append(option);});
  $('agent-check-result').textContent=result.message+' · Файлов: '+result.changes.length+'. Слева твой код, справа — предложение агента.';
  $('agent-preview-dialog').showModal();
  if(!diffEditor)diffEditor=monaco.editor.createDiffEditor($('agent-diff'),{theme:StudioPreferences.theme==='light'?'openplay-light':'openplay',readOnly:true,automaticLayout:true,fontSize:12,minimap:{enabled:false},renderSideBySide:true,scrollBeyondLastLine:false});
  showAgentDiff();
}
$('agent-diff-files').onchange=showAgentDiff;
function closeAgentPreview(){
  $('agent-preview-dialog').close();diffEditor?.setModel(null);for(const model of diffModels)model.dispose();diffModels=[];agentPreview=null;
}
async function discardAgentPreview(){await api.discardAgent();closeAgentPreview();$('agent-status').textContent='Сохранили твой код. Можем попробовать другую идею.';}
$('agent-preview-close').onclick=$('agent-discard').onclick=()=>execute(discardAgentPreview);
$('agent-preview-dialog').addEventListener('cancel',event=>{event.preventDefault();execute(discardAgentPreview);});
$('agent-apply').onclick=()=>execute(async()=>{
  const project=await api.applyAgent();closeAgentPreview();await applyProject(project);
  $('agent-undo').dataset.available='yes';agentBubble('Готово! Изменения применены, запускаю игру.');$('agent-status').textContent='Игра готова. Можно попросить что-нибудь добавить.';$('agent-panel').hidden=true;await run();
});
$('agent-undo').onclick=()=>execute(async()=>{await saveAll();await applyProject(await api.undoAgent());delete $('agent-undo').dataset.available;agentBubble('Вернули код, который был до работы агента.');await run();});
$('agent-send').onclick=()=>execute(async()=>{
  const idea=$('agent-idea').value.trim();if(!idea)return;
  await saveAll();agentRunning=true;updateAgentButtons();editor.updateOptions({readOnly:true});
  agentAnswer='';answerBubble=null;agentBubble(idea,'user');$('agent-idea').value='';$('agent-permissions').replaceChildren();
  try{
    const result=await api.askAgent(idea);
    $('agent-status').textContent=result.message;
    if(result.changes.length){previewAgent(result);say((agentAnswer||'Игра готова.')+' Посмотри изменения и нажми «Применить и играть».');}
    else{agentBubble(result.message);say(agentAnswer||result.message);}
  }catch(error){$('agent-status').textContent=error.message;agentBubble(error.message,'error');throw error;}
  finally{agentRunning=false;editor.updateOptions({readOnly:false});$('agent-permissions').replaceChildren();updateAgentButtons();if(closeAfterAgent)api.close();}
});
$('agent-idea').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();$('agent-send').click();}});
$('agent-cancel').onclick=()=>{api.cancelAgent().catch(error=>agentBubble(error.message,'error'));$('agent-status').textContent='Останавливаем агента…';};
async function agentSettings(){
  const config=await api.agentSettings();voiceConfigured=config.hasVoiceKey;
  $('agent-key').value='';$('agent-clear-key').checked=false;
  $('agent-executable').value=config.executable||'';$('agent-args').value=JSON.stringify(config.args||[]);
  $('agent-key-status').textContent=voiceConfigured?'Ключ голоса настроен. Оставь поле пустым, чтобы сохранить его.':'Без ключа можно писать агенту текстом. Для микрофона добавь ключ OpenAI API.';
  $('agent-settings-dialog').showModal();
}
$('agent-settings').onclick=()=>execute(agentSettings);
$('agent-settings-close').onclick=()=>{$('agent-key').value='';$('agent-settings-dialog').close();};
$('agent-settings-dialog').addEventListener('close',()=>{$('agent-key').value='';});
$('agent-pick').onclick=()=>execute(async()=>{const file=await api.pickAgent();if(file)$('agent-executable').value=file;});
$('agent-login').onclick=()=>execute(async()=>{$('agent-login-status').textContent='Открываем вход в Codex…\n';await api.agentLogin();});
$('agent-settings-form').onsubmit=event=>{event.preventDefault();execute(async()=>{
  let args;try{args=JSON.parse($('agent-args').value||'[]');}catch{throw new Error('Аргументы ACP: введи JSON-массив, например ["--acp"]');}
  const config=await api.saveAgentSettings({executable:$('agent-executable').value,args,voiceKey:$('agent-key').value,clearVoiceKey:$('agent-clear-key').checked});
  voiceConfigured=config.hasVoiceKey;$('agent-key').value='';$('agent-settings-dialog').close();$('agent-status').textContent='Настройки сохранены';
});};
function stopRecording(){if(recording&&recording.state!=='inactive')recording.stop();}
$('agent-mic').onclick=async()=>{
  if(recording){stopRecording();return;}
  if(busy||speechBusy)return;
  try{
    const config=await api.agentSettings();voiceConfigured=config.hasVoiceKey;
    if(!voiceConfigured){await execute(agentSettings);return;}
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('Микрофон недоступен в этой системе');
    speechBusy=true;updateAgentButtons();
    window.speechSynthesis?.cancel();
    recordingStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true},video:false});
    const chunks=[];const type=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/webm';
    const recorder=new MediaRecorder(recordingStream,{mimeType:type});recording=recorder;
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    recorder.onstop=async()=>{
      clearTimeout(recordingTimer);recordingStream?.getTracks().forEach(track=>track.stop());recordingStream=null;recording=null;
      $('agent-mic').classList.remove('recording');$('agent-mic').setAttribute('aria-label','Начать запись голоса');speechBusy=true;updateAgentButtons();
      $('agent-status').textContent='Распознаём твою идею…';
      try{
        const bytes=new Uint8Array(await new Blob(chunks,{type}).arrayBuffer());
        const text=await api.transcribe(bytes);$('agent-idea').value=[$('agent-idea').value,text].filter(Boolean).join(' ');$('agent-idea').focus();
        $('agent-status').textContent=text?'Проверь текст и нажми «Сделать»':'Не расслышал. Попробуй ещё раз.';
      }catch(error){$('agent-status').textContent=error.message;agentBubble(error.message,'error');}
      finally{speechBusy=false;updateAgentButtons();}
    };
    recorder.onerror=()=>{stopRecording();};recorder.start();recordingTimer=setTimeout(stopRecording,60000);
    speechBusy=false;$('agent-mic').classList.add('recording');$('agent-mic').setAttribute('aria-label','Закончить запись голоса');$('agent-status').textContent='Слушаю… Нажми микрофон ещё раз, когда закончишь.';updateAgentButtons();
  }catch(error){recordingStream?.getTracks().forEach(track=>track.stop());recordingStream=null;recording=null;speechBusy=false;updateAgentButtons();$('agent-status').textContent=error.name==='NotAllowedError'?'Разреши доступ к микрофону в настройках системы.':error.message;}
};
window.addEventListener('beforeunload',()=>{clearTimeout(recordingTimer);recordingStream?.getTracks().forEach(track=>track.stop());window.speechSynthesis?.cancel();});
updateAgentButtons();
