/* global $, api, project, editor, monaco, blocksUI, execute, log, renderFiles, updateButtons, OpenPlayMedia */
const mediaUI=(()=>{
  let assets=[],pending=null,previewAsset=null,previewUrl=null,gameUrl=null,generation=0;
  const thumbnails=new Map(),gameAudio=new Audio();gameAudio.volume=0.7;
  const url=(bytes,type)=>URL.createObjectURL(new Blob([bytes],{type}));
  function stopGame(){generation++;gameAudio.pause();gameAudio.removeAttribute('src');gameAudio.load();if(gameUrl)URL.revokeObjectURL(gameUrl);gameUrl=null;}
  api.onEvent(event=>{
    if(event.type==='audio'){
      if(event.action==='play'){
        stopGame();const token=generation;gameUrl=url(event.data,'audio/wav');gameAudio.src=gameUrl;gameAudio.loop=!!event.loop;
        gameAudio.play().catch(e=>{if(token===generation)log('Не удалось воспроизвести звук: '+e.message,'error');});
      }else if(event.action==='stop')stopGame();
      else if(event.action==='pause')gameAudio.pause();
      else if(event.action==='resume'&&gameUrl)gameAudio.play().catch(()=>{});
    }else if(['error','exit','stopped','closed'].includes(event.type))stopGame();
  });
  function draw(canvas,rgba,width,height){canvas.width=width;canvas.height=height;const c=canvas.getContext('2d');c.putImageData(new ImageData(new Uint8ClampedArray(rgba),width,height),0,0);}
  async function thumbnail(path){
    if(thumbnails.has(path))return thumbnails.get(path);
    const promise=api.mediaRead(path).then(image=>{const canvas=document.createElement('canvas');draw(canvas,image.rgba,image.width,image.height);return canvas.toDataURL();});
    thumbnails.set(path,promise);try{return await promise;}catch(e){thumbnails.delete(path);throw e;}
  }
  async function load(){assets=await api.mediaList();thumbnails.clear();render();blocksUI.setMedia(assets);}
  function render(){
    $('media-list').replaceChildren();$('media-count').textContent=assets.length;$('media-empty').hidden=!!assets.length;
    for(const asset of assets){
      const button=document.createElement('button');button.className='media-item';button.dataset.asset=asset.path;button.title=asset.name;
      if(asset.kind==='image'){const img=document.createElement('img');img.alt='';thumbnail(asset.path).then(value=>img.src=value).catch(e=>log(e.message,'error'));button.append(img);}
      else{const note=document.createElement('span');note.className='media-note';note.textContent='♫';button.append(note);}
      const title=document.createElement('span');title.textContent=asset.name;const detail=document.createElement('small');detail.textContent=asset.kind==='image'?`${asset.width} × ${asset.height}`:`${asset.duration.toFixed(1)} сек.`;title.append(detail);button.append(title);button.onclick=()=>execute(()=>preview(asset));$('media-list').append(button);
    }
  }
  function closeImport(){
    $('sound-preview').pause();if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;pending?.bitmap?.close();pending=null;$('media-import-dialog').close();
  }
  function resizeImage(changed='width'){
    if(!pending?.bitmap)return;const ratio=pending.bitmap.width/pending.bitmap.height;
    let width=Number($('image-width').value),height=Number($('image-height').value);
    if($('image-proportions').checked){if(changed==='height')width=Math.round(height*ratio);else height=Math.round(width/ratio);}
    width=Math.max(1,Math.min(320,width||1));height=Math.max(1,Math.min(240,height||1));
    if($('image-proportions').checked){if(width/height>ratio)width=Math.max(1,Math.round(height*ratio));else height=Math.max(1,Math.round(width/ratio));}
    $('image-width').value=width;$('image-height').value=height;
    const canvas=$('image-preview');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,width,height);ctx.drawImage(pending.bitmap,0,0,width,height);
  }
  async function begin(kind){
    const source=await api.mediaChoose(kind);if(!source)return;
    $('media-import-error').textContent='';$('media-name').value=source.name;$('media-title').textContent=kind==='image'?'Добавить картинку':'Добавить музыку или звук';
    $('image-import-fields').hidden=kind!=='image';$('sound-import-fields').hidden=kind!=='sound';
    $('image-use-label').hidden=$('sound-use-label').hidden=!blocksUI.active;
    if(kind==='image'){
      const bitmap=await createImageBitmap(new Blob([source.data],{type:source.mime}));
      if(bitmap.width*bitmap.height>32000000){bitmap.close();throw Error('Выбери картинку до 32 миллионов пикселей');}
      pending={kind,bitmap};const max=blocksUI.active?64:320,scale=Math.min(1,max/bitmap.width,(blocksUI.active?64:240)/bitmap.height);
      $('image-width').value=Math.max(1,Math.round(bitmap.width*scale));$('image-height').value=Math.max(1,Math.round(bitmap.height*scale));resizeImage();
    }else{
      const context=new AudioContext();let audio;
      try{const bytes=new Uint8Array(source.data);audio=await context.decodeAudioData(bytes.buffer);}finally{await context.close();}
      if(audio.duration>600)throw Error('Для импорта выбери запись до 10 минут, затем нужный фрагмент');
      if(audio.duration<0.01)throw Error('Запись должна быть длиннее 0,01 секунды');
      pending={kind,audio};$('sound-start').value=0;$('sound-start').max=Math.max(0,audio.duration-0.01);$('sound-length').value=(Math.floor(Math.min(30,audio.duration)*100)/100).toFixed(2);$('sound-duration').textContent=`Длина записи: ${audio.duration.toFixed(2)} сек. В игру добавится выбранный фрагмент.`;
      previewUrl=url(source.data,source.mime);$('sound-preview').src=previewUrl;
    }
    $('media-import-dialog').showModal();
  }
  async function add(){
    if(!pending)return;const kind=pending.kind,name=$('media-name').value.trim()||'Мой файл';let value;
    if(kind==='image'){
      resizeImage();const canvas=$('image-preview');value={name,width:canvas.width,height:canvas.height,rgba:canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data};
    }else{
      const start=Number($('sound-start').value),length=Number($('sound-length').value);
      if(!Number.isFinite(start)||!Number.isFinite(length)||start<0||length<0.01||length>30||start+length>pending.audio.duration+0.002)throw Error('Выбери фрагмент внутри записи, от 0,01 до 30 секунд');
      const offline=new OfflineAudioContext(1,Math.max(1,Math.round(length*22050)),22050),source=offline.createBufferSource();source.buffer=pending.audio;source.connect(offline.destination);source.start(0,start,length);
      const converted=await offline.startRendering();value={name,data:OpenPlayMedia.encodeWav(converted.getChannelData(0))};
    }
    const result=await api.mediaImport(kind,value);assets=result.assets;project.files=result.files;renderFiles();render();blocksUI.setMedia(assets);
    if(blocksUI.active&&kind==='image'&&$('image-use').checked)blocksUI.useImage(result.asset);
    if(blocksUI.active&&kind==='sound'&&$('sound-use').checked)blocksUI.useSound(result.asset);
    closeImport();log('Добавлен файл: '+result.asset.name,'build');
  }
  async function preview(asset){
    previewAsset=asset;const content=await api.mediaRead(asset.path);$('media-preview-title').textContent=asset.name;$('asset-preview').hidden=asset.kind!=='image';$('asset-audio').hidden=asset.kind!=='sound';
    if(content.kind==='image'){draw($('asset-preview'),content.rgba,content.width,content.height);$('asset-description').textContent=`${content.width} × ${content.height} · ${(asset.bytes/1024).toFixed(1)} КиБ`;}
    else{previewUrl=url(content.data,'audio/wav');$('asset-audio').src=previewUrl;$('asset-description').textContent=`${content.duration.toFixed(1)} сек. · Звук в симуляторе; аудиовыход консоли пока не подключён.`;}
    $('media-use').textContent=blocksUI.active?(asset.kind==='image'?'Костюм этого героя':'Играть с начала игры'):'Вставить в Lua';
    $('media-preview-dialog').showModal();
  }
  function closePreview(){$('asset-audio').pause();if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;previewAsset=null;$('media-preview-dialog').close();}
  $('media-use').onclick=()=>execute(async()=>{
    if(blocksUI.active){if(previewAsset.kind==='image')blocksUI.useImage(previewAsset);else blocksUI.useSound(previewAsset);}
    else{const text=previewAsset.kind==='image'?`opd.graphics.image("${previewAsset.path}", 0, 0)`:`if opd.audio and opd.audio.available then opd.audio.play("${previewAsset.path}", true) end`;editor.trigger('media','type',{text});editor.focus();}
    closePreview();
  });
  $('import-image').onclick=()=>execute(()=>begin('image'));$('import-sound').onclick=()=>execute(()=>begin('sound'));
  $('media-add').onclick=()=>execute(async()=>{try{await add();}catch(e){$('media-import-error').textContent=e.message;throw e;}});
  $('media-cancel').onclick=closeImport;$('media-import-dialog').addEventListener('cancel',e=>{e.preventDefault();if(!busy)closeImport();});
  $('media-preview-close').onclick=closePreview;$('media-preview-dialog').addEventListener('cancel',e=>{e.preventDefault();closePreview();});
  $('image-width').onchange=()=>resizeImage('width');$('image-height').onchange=()=>resizeImage('height');$('image-proportions').onchange=()=>resizeImage();
  $('sound-start').onchange=()=>{$('sound-preview').currentTime=Math.max(0,Number($('sound-start').value)||0);};
  return {load,thumbnail,stopGame,get gameAudio(){return gameAudio;},setDisabled(value){for(const id of ['import-image','import-sound','media-add','media-cancel'])$(id).disabled=value||!editor;}};
})();
