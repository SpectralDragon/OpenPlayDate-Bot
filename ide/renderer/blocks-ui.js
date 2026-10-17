/* global Blockly, OpenPlayBlocks, $, api, editor, project, models, active, busy, refreshDirty, renderFiles, execute, newProject, log */
const blocksUI = (() => {
  let doc=null, workspace=null, selected=null, baseline='', raw='', savedLua='', loading=false, mode=false;
  let mediaAssets=[];
  const images=()=>mediaAssets.filter(a=>a.kind==='image').length?mediaAssets.filter(a=>a.kind==='image'):(doc?.media?.images||[]);
  const sounds=()=>mediaAssets.filter(a=>a.kind==='sound').length?mediaAssets.filter(a=>a.kind==='sound'):(doc?.media?.sounds||[]);
  Blockly.defineBlocksWithJsonArray(OpenPlayBlocks.definitions);
  // Resolve the available characters when opening this dropdown, including newly added ones.
  Blockly.Blocks.op_if_touch.init=function(){
    const definition=OpenPlayBlocks.definitions.find(b=>b.type==='op_if_touch');
    this.jsonInit({...definition,args0:[{type:'field_dropdown',name:'OTHER',options:()=>{
      const choices=doc?.sprites.filter(s=>s.id!==selected).map(s=>[s.name,s.id])||[];
      return choices.length?choices:[['добавь другого героя','missing']];
    }},...definition.args0.slice(1)]});
  };
  for(const [type,field,getOptions] of [['op_look','LOOK',()=>[...OpenPlayBlocks.looks,...images().map(a=>[a.name.slice(0,30),a.path])]],['op_sound','SOUND',()=>sounds().length?sounds().map(a=>[a.name.slice(0,30),a.path]):[['добавь музыку','missing']]]]){
    Blockly.Blocks[type].init=function(){const d=OpenPlayBlocks.definitions.find(b=>b.type===type);this.jsonInit({...d,args0:d.args0.map(a=>a.name===field?{...a,options:getOptions}:a)});};
  }
  const groups=[['События',42,['start','forever','pressed']],['Движение',215,['move','goto','joystick','stay','random']],['Управление',32,['wait','repeat','if_button','if_touch']],['Внешность',285,['say','look','color','visible']],['Очки',155,['score','set_score']],['Музыка',330,['sound','sound_stop']]];
  function capture(){if(doc&&workspace&&selected&&!loading)doc.sprites.find(s=>s.id===selected).workspace=Blockly.serialization.workspaces.save(workspace);}
  const themes={};
  function currentTheme(){
    const name=StudioPreferences.theme,dark=name==='dark';
    return themes[name]||=Blockly.Theme.defineTheme('openplay-blocks-'+name,{base:Blockly.Themes.Classic,fontStyle:{family:'Segoe UI, sans-serif',size:12},componentStyles:{workspaceBackgroundColour:dark?'#161e29':'#f5f8fd',toolboxBackgroundColour:dark?'#202c3b':'#e7edf7',toolboxForegroundColour:dark?'#d0deee':'#273d58',flyoutBackgroundColour:dark?'#27364a':'#dde6f4',flyoutForegroundColour:dark?'#d0deee':'#273d58',flyoutOpacity:1,scrollbarColour:dark?'#506780':'#9aacbf',scrollbarOpacity:0.6}});
  }
  addEventListener('studio-theme',()=>{if(workspace)workspace.setTheme(currentTheme());});
  function ensure(){
    if(workspace)return;
    workspace=Blockly.inject('blockly-workspace',{
      media:'../node_modules/blockly/media/',renderer:'zelos',sounds:false,trashcan:true,
      toolbox:{kind:'categoryToolbox',contents:groups.map(([name,colour,types])=>({kind:'category',name,colour:String(colour),contents:types.map(type=>({kind:'block',type:'op_'+type}))}))},
      grid:{spacing:24,length:2,colour:'#d5dfea',snap:true},zoom:{controls:true,wheel:true,startScale:0.9,maxScale:1.6,minScale:0.45,scaleSpeed:1.1},move:{scrollbars:true,drag:true,wheel:true},
      theme:currentTheme()
    });
    workspace.addChangeListener(event=>{
      if(loading||event.isUiEvent||event.type===Blockly.Events.FINISHED_LOADING)return;
      capture(); validate(); refreshDirty();
    });
    new ResizeObserver(()=>{if(mode)Blockly.svgResize(workspace);}).observe($('blocks-editor'));
  }
  function validate(){
    try{OpenPlayBlocks.compile(doc);$('blocks-hint').textContent='Жёлтый блок начинает цепочку. Блоки внутри выполняются по порядку.';$('blocks-hint').classList.remove('error');}
    catch(e){$('blocks-hint').textContent=e.message;$('blocks-hint').classList.add('error');}
  }
  function setMode(value){
    mode=!!doc&&value;
    $('blocks-editor').hidden=!mode;$('editor').hidden=mode;$('tabs').hidden=mode;
    $('files').hidden=mode;$('block-sprites').hidden=!mode;
    $('blocks-mode').classList.toggle('selected',mode);$('code-mode').classList.toggle('selected',!mode);
    if(mode){$('language').textContent='Блоки';$('crumb-file').textContent='Моя игра';Blockly.svgResize(workspace);}
    else{editor?.layout();if(active)$('crumb-file').textContent=active;$('language').textContent=active?.endsWith('.lua')?'Lua':'Текст';}
    if(editor)editor.updateOptions({readOnly:!!doc&&active==='main.lua'});
  }
  function renderSprites(){
    $('sprite-list').replaceChildren();
    if(!doc)return;
    for(const s of doc.sprites){
      const button=document.createElement('button');button.className='sprite-card'+(s.id===selected?' selected':'');button.dataset.sprite=s.id;
      const face=document.createElement('span');face.className='sprite-face';
      if(s.look==='image'&&typeof mediaUI!=='undefined'){const img=document.createElement('img');img.alt='';face.append(img);mediaUI.thumbnail(s.image.path).then(src=>img.src=src).catch(()=>{});}
      else face.textContent=({cat:'🐱',star:'⭐',ball:'●',box:'■'})[s.look]||'▧';
      const name=document.createElement('span');name.textContent=s.name;const small=document.createElement('small');small.textContent='Мои блоки →';name.append(small);
      button.append(face,name);button.onclick=()=>select(s.id);$('sprite-list').append(button);
    }
    $('sprite-add').disabled=busy||doc.sprites.length>=12;
  }
  function select(id){
    capture();selected=id;loading=true;
    try{Blockly.serialization.workspaces.load(doc.sprites.find(s=>s.id===id).workspace||{},workspace);workspace.clearUndo();}
    finally{loading=false;}
    const s=doc.sprites.find(s=>s.id===id);
    refreshLooks();
    for(const key of ['name','look','color','x','y','size'])$('sprite-'+key).value=String(key==='look'&&s.look==='image'?s.image.path:s[key]);
    for(const key of ['size','color'])$('sprite-'+key).closest('label').hidden=s.look==='image';
    $('blocks-hero').textContent='Блоки: '+s.name;renderSprites();validate();
  }
  async function load(value){
    loading=true;doc=null;selected=null;mediaAssets=[];workspace?.clear();loading=false;
    $('blocks-mode').hidden=!value;
    if(!value){setMode(false);return;}
    doc=structuredClone(value.document);raw=value.raw;savedLua=value.lua;ensure();
    // Normalize all workspaces once: selecting another hero must not mark the game dirty.
    loading=true;
    try{for(const s of doc.sprites){selected=s.id;Blockly.serialization.workspaces.load(s.workspace||{},workspace);s.workspace=Blockly.serialization.workspaces.save(workspace);}}
    finally{loading=false;}
    selected=null;select(doc.sprites[0].id);capture();baseline=JSON.stringify(doc);setMode(true);refreshDirty();
  }
  async function save(){
    if(!doc)return;capture();if(JSON.stringify(doc)===baseline)return;
    const result=await api.saveBlocks(doc,raw,savedLua);
    raw=result.raw;savedLua=result.lua;baseline=JSON.stringify(doc);project.files=result.files;
    const entry=models.get('main.lua');
    if(entry){entry.saved=entry.disk=savedLua;entry.model.setValue(savedLua);}
    renderFiles();refreshDirty();log('Блоки сохранены · игра собрана в Lua','build');
  }
  for(const [id,options] of [['look',OpenPlayBlocks.looks],['color',OpenPlayBlocks.colors]]){
    for(const [name,value] of options){const option=document.createElement('option');option.value=value;option.textContent=name;$('sprite-'+id).append(option);}
  }
  function refreshLooks(){
    const field=$('sprite-look');field.replaceChildren();
    for(const [name,value] of [...OpenPlayBlocks.looks,...images().map(a=>[a.name,a.path])]){const option=document.createElement('option');option.value=value;option.textContent=name;field.append(option);}
    const s=doc?.sprites.find(s=>s.id===selected);if(s)field.value=s.look==='image'?s.image.path:s.look;
  }
  function setMedia(assets){mediaAssets=assets;refreshLooks();renderSprites();}
  function rememberMedia(){doc.media={images:images().map(a=>({path:a.path,name:a.name,width:a.width,height:a.height})),sounds:sounds().map(a=>({path:a.path,name:a.name}))};}
  function useImage(asset){
    if(!doc)return;rememberMedia();const s=doc.sprites.find(s=>s.id===selected);s.look='image';s.image={path:asset.path,width:asset.width,height:asset.height};select(selected);refreshDirty();
  }
  function useSound(asset){
    if(!doc)return;rememberMedia();
    if(workspace.getAllBlocks(false).some(b=>b.type==='op_sound'&&b.getFieldValue('SOUND')===asset.path))return;
    Blockly.serialization.blocks.append({type:'op_start',x:400,y:35,inputs:{DO:{block:{type:'op_sound',fields:{SOUND:asset.path,LOOP:'yes'}}}}},workspace);capture();refreshDirty();
  }
  for(const key of ['name','look','color','x','y','size'])$('sprite-'+key).onchange=()=>{
    if(!doc||busy)return;capture();const s=doc.sprites.find(s=>s.id===selected),field=$('sprite-'+key);
    if(['x','y','size','color'].includes(key)){
      if(!field.checkValidity()||field.value===''){field.value=s[key];return;}s[key]=Number(field.value);
    }else if(key==='look'&&images().some(a=>a.path===field.value)){useImage(images().find(a=>a.path===field.value));return;}
    else s[key]=field.value.trim()||'Герой';
    field.value=s[key];for(const prop of ['size','color'])$('sprite-'+prop).closest('label').hidden=s.look==='image';renderSprites();$('blocks-hero').textContent='Блоки: '+s.name;validate();refreshDirty();
  };
  $('sprite-add').onclick=()=>{
    if(!doc||busy||doc.sprites.length>=12)return;capture();
    const id='s'+crypto.randomUUID().slice(0,8);
    doc.sprites.push({id,name:'Новый герой',look:'ball',color:26111,x:160,y:120,size:12,workspace:{blocks:{languageVersion:0,blocks:[{type:'op_start',x:30,y:30}]}}});
    select(id);capture();refreshDirty();
  };
  $('blocks-mode').onclick=()=>setMode(true);$('code-mode').onclick=()=>execute(async()=>{await saveAll();setMode(false);});
  $('new-blocks').onclick=()=>newProject('blocks-stars');
  $('blocks-undo').onclick=()=>{workspace?.undo(false);};$('blocks-redo').onclick=()=>{workspace?.undo(true);};
  $('blocks-tidy').onclick=()=>workspace?.cleanUp();
  return {load,save,capture,setMode,setMedia,useImage,useSound,get active(){return !!doc;},get workspace(){return workspace;},get document(){capture();return structuredClone(doc);},dirty(){capture();return !!doc&&JSON.stringify(doc)!==baseline;},setDisabled(value){
    for(const element of $('blocks-editor').querySelectorAll('input,select,button'))element.disabled=value;
    $('new-blocks').disabled=value||!editor;$('sprite-add').disabled=value||!doc||doc.sprites.length>=12;
    $('blockly-workspace').inert=value;for(const b of $('sprite-list').children)b.disabled=value;
  }};
})();
