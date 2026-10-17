/* Shared by Electron main and the sandboxed renderer. No eval or generated JS. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OpenPlayBlocks = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const SOURCE = '.openplay-blocks.json';
  const buttons = [['A', 'a'], ['B', 'b'], ['↑', 'up'], ['↓', 'down'], ['←', 'left'], ['→', 'right']];
  const looks = [['Котик', 'cat'], ['Звезда', 'star'], ['Шарик', 'ball'], ['Квадрат', 'box']];
  const colors = [['Жёлтый', '65504'], ['Розовый', '63768'], ['Голубой', '26111'], ['Зелёный', '24431'], ['Белый', '65535']];
  const num = (name, value, min = -320, max = 320) => ({ type: 'field_number', name, value, min, max, precision: 1 });
  const dropdown = (name, options) => ({ type: 'field_dropdown', name, options });
  const statement = { type: 'input_statement', name: 'DO' };
  const definitions = [
    { type: 'op_start', message0: '⚑ Когда игра началась %1 %2', args0: [{type:'input_dummy'}, statement], colour: 42 },
    { type: 'op_forever', message0: '↻ Всё время %1 %2', args0: [{type:'input_dummy'}, statement], colour: 42 },
    { type: 'op_pressed', message0: 'Когда нажали %1 %2 %3', args0: [dropdown('KEY', buttons), {type:'input_dummy'}, statement], colour: 42 },
    { type: 'op_move', message0: 'Сдвинуться: вправо %1 вниз %2', args0: [num('X',10), num('Y',0)], colour: 215 },
    { type: 'op_goto', message0: 'Перейти: x %1 y %2', args0: [num('X',160,0,320), num('Y',120,0,240)], colour: 215 },
    { type: 'op_joystick', message0: 'Идти за джойстиком · скорость %1', args0: [num('SPEED',100,1,400)], colour: 215 },
    { type: 'op_stay', message0: 'Остаться внутри экрана', colour: 215 },
    { type: 'op_random', message0: 'Перейти в случайное место', colour: 215 },
    { type: 'op_wait', message0: 'Ждать %1 сек.', args0: [{type:'field_number',name:'SECONDS',value:1,min:0,max:60,precision:0.1}], colour: 32 },
    { type: 'op_repeat', message0: 'Повторить %1 раз %2 %3', args0: [num('TIMES',10,0,1000), {type:'input_dummy'}, statement], colour: 32 },
    { type: 'op_if_button', message0: 'Если удерживается %1 %2 %3', args0: [dropdown('KEY', buttons), {type:'input_dummy'}, statement], colour: 32 },
    { type: 'op_if_touch', message0: 'Если касается %1 %2 %3', args0: [dropdown('OTHER', [['другого героя','other']]), {type:'input_dummy'}, statement], colour: 32 },
    { type: 'op_say', message0: 'Сказать %1', args0: [{type:'field_input',name:'TEXT',text:'Привет!'}], colour: 285 },
    { type: 'op_look', message0: 'Стать %1', args0: [dropdown('LOOK',looks)], colour: 285 },
    { type: 'op_color', message0: 'Цвет %1', args0: [dropdown('COLOR',colors)], colour: 285 },
    { type: 'op_visible', message0: '%1 персонажа', args0: [dropdown('SHOW',[['Показать','yes'],['Спрятать','no']])], colour: 285 },
    { type: 'op_score', message0: 'Добавить %1 к очкам', args0: [num('VALUE',1,-1000,1000)], colour: 155 },
    { type: 'op_set_score', message0: 'Очки = %1', args0: [num('VALUE',0,-1000,1000)], colour: 155 }
    ,{ type:'op_sound',message0:'Играть %1 %2',args0:[dropdown('SOUND',[['добавь музыку','missing']]),dropdown('LOOP',[['один раз','no'],['по кругу','yes']])],colour:330 }
    ,{ type:'op_sound_stop',message0:'Остановить музыку',colour:330 }
  ].map(d => d.type.match(/^op_(start|forever|pressed)$/) ? d : {...d, previousStatement:null, nextStatement:null});
  const chain = (...blocks) => blocks.reduceRight((next, b) => next ? {...b,next:{block:next}} : b, undefined);
  const block = (type, fields = {}, body) => ({type:'op_'+type,fields,...(body?{inputs:{DO:{block:body}}}:{})});
  function starter() {
    return {format:'openplay-blocks',version:1,background:4163,sprites:[
      {id:'cat',name:'Котик',look:'cat',color:63768,x:160,y:150,size:14,workspace:{blocks:{languageVersion:0,blocks:[
        {...block('start',{},block('say',{TEXT:'Лови звёзды!'})),x:30,y:25},
        {...block('forever',{},chain(block('joystick',{SPEED:110}),block('stay'))),x:30,y:155},
        {...block('pressed',{KEY:'a'},chain(block('color',{COLOR:'26111'}),block('wait',{SECONDS:0.5}),block('color',{COLOR:'63768'}))),x:30,y:340}
      ]}}},
      {id:'star',name:'Звёздочка',look:'star',color:65504,x:240,y:90,size:10,workspace:{blocks:{languageVersion:0,blocks:[
        {...block('forever',{},block('if_touch',{OTHER:'cat'},chain(block('score',{VALUE:1}),block('random'),block('wait',{SECONDS:0.2})))),x:30,y:30}
      ]}}}
    ]};
  }
  const fail = text => { throw new Error('Блоки: ' + text); };
  function number(v, min, max) { if(typeof v !== 'number'||!Number.isFinite(v)||v<min||v>max)fail('число вне допустимых границ'); return v; }
  function choice(v, values) { if(!values.includes(v))fail('неизвестное значение '+v); return v; }
  const quote = s => '"'+String(s).replace(/[\\"\x00-\x1f\x7f]/g,c=>c==='\\'?'\\\\':c==='"'?'\\"':'\\'+c.charCodeAt(0).toString().padStart(3,'0'))+'"';
  function lua(v) { return Array.isArray(v)?'{'+v.map(lua).join(',')+'}':typeof v==='string'?quote(v):String(v); }
  function compile(doc) {
    if(!doc||doc.format!=='openplay-blocks'||doc.version!==1)fail('неизвестный формат проекта');
    if(!Array.isArray(doc.sprites)||doc.sprites.length<1||doc.sprites.length>12)fail('нужно от 1 до 12 персонажей');
    number(doc.background,0,65535);
    const ids = doc.sprites.map(s=>s.id);
    if(ids.some(id=>typeof id!=='string'||!/^s?[a-zA-Z0-9_-]{1,32}$/.test(id))||new Set(ids).size!==ids.length)fail('имена персонажей должны быть уникальны');
    const scripts=[], actors=[]; let count=0;
    function assetPath(value,extension){if(typeof value!=='string'||!/^assets\/[a-zA-Z0-9_./-]+$/.test(value)||value.split('/').some(p=>!p||p==='.'||p==='..')||!value.endsWith(extension))fail('выбери файл из библиотеки');return value;}
    function picture(image){if(!image)fail('выбери костюм персонажа');return [assetPath(image.path,'.opi'),number(image.width,1,320),number(image.height,1,240)];}
    doc.sprites.forEach((s,index)=>{
      if(typeof s.name!=='string'||s.name.length>30)fail('слишком длинное имя персонажа');
      actors.push([s.name,choice(s.look,[...looks.map(v=>v[1]),'image']),number(s.color,0,65535),number(s.x,0,320),number(s.y,0,240),number(s.size,4,32),...(s.look==='image'?picture(s.image):[])]);
      const tops=s.workspace?.blocks?.blocks||[];
      if(!Array.isArray(tops)||tops.length>64)fail('слишком много цепочек');
      function statements(b,code,depth=0) {
        if(depth>24)fail('слишком много вложенных блоков');
        while(b) {
          if(++count>512)fail('в проекте больше 512 блоков');
          const f=b.fields||{}, op=b.type; const emit=(...v)=>code.push(v);
          const n=(key,min=-320,max=320)=>number(f[key],min,max);
          const body=()=>statements(b.inputs?.DO?.block,code,depth+1);
          if(op==='op_move'||op==='op_goto')emit(op==='op_move'?'move':'goto',n('X',op==='op_goto'?0:-320,320),n('Y',op==='op_goto'?0:-320,op==='op_goto'?240:320));
          else if(op==='op_joystick')emit('joystick',n('SPEED',1,400));
          else if(op==='op_stay'||op==='op_random')emit(op.slice(3));
          else if(op==='op_wait')emit('wait',n('SECONDS',0,60));
          else if(op==='op_say'){if(typeof f.TEXT!=='string'||f.TEXT.length>60)fail('реплика: до 60 символов');emit('say',f.TEXT);}
          else if(op==='op_color')emit('color',number(Number(f.COLOR),0,65535));
          else if(op==='op_look'){
            if(looks.some(v=>v[1]===f.LOOK))emit('look',f.LOOK);
            else emit('costume',...picture(doc.media?.images?.find(i=>i.path===f.LOOK)));
          }
          else if(op==='op_sound'){if(!doc.media?.sounds?.some(a=>a.path===f.SOUND))fail('сначала добавь музыку');emit('sound',assetPath(f.SOUND,'.wav'),choice(f.LOOP,['yes','no'])==='yes');}
          else if(op==='op_sound_stop')emit('sound_stop');
          else if(op==='op_visible')emit('visible',choice(f.SHOW,['yes','no']));
          else if(op==='op_score'||op==='op_set_score')emit(op==='op_score'?'score':'set_score',n('VALUE',-1000,1000));
          else if(op==='op_repeat') {
            const start=code.length;emit('repeat',n('TIMES',0,1000),0);body();emit('jump',start+1);code[start][2]=code.length+1;
          } else if(op==='op_if_button'||op==='op_if_touch') {
            const start=code.length;
            emit(op==='op_if_button'?'button':'touch',op==='op_if_button'?choice(f.KEY,buttons.map(v=>v[1])):ids.indexOf(choice(f.OTHER,ids))+1,0);
            body();code[start][2]=code.length+1;
          } else fail('блок «'+op+'» нужно поставить под событие');
          b=b.next?.block;
        }
      }
      for(const top of tops) {
        if(!['op_start','op_forever','op_pressed'].includes(top.type))fail('подсоедини свободные блоки к жёлтому событию');
        if(++count>512)fail('в проекте больше 512 блоков');
        const code=[];statements(top.inputs?.DO?.block,code);
        scripts.push([index+1,top.type.slice(3),top.type==='op_pressed'?choice(top.fields?.KEY,buttons.map(v=>v[1])):'',code]);
      }
    });
    if(scripts.length>96)fail('слишком много событий');
    return '-- OpenPlay Blocks v2: создано из блоков. Меняй игру во вкладке «Блоки».\nlocal background='+doc.background+'\nlocal actors='+lua(actors)+'\nlocal scripts='+lua(scripts)+'\n'+RUNTIME;
  }
  const RUNTIME = `local g=opd.graphics
local score=0
local threads={}
local cursor=0
local function halfSize(a)
  if a.look=="image" then return a.iw/2,a.ih/2 end
  return a.size,a.size
end
local function touching(a,b)
  local aw,ah=halfSize(a) local bw,bh=halfSize(b)
  return a.show and b.show and math.abs(a.x-b.x)<aw+bw and math.abs(a.y-b.y)<ah+bh
end
local function tick(dt)
  local remaining=384
  for offset=1,#scripts do
    local i=(cursor+offset-1)%#scripts+1 local d=scripts[i]
    local t=threads[i]
    if d[2]=="pressed" and opd.input.pressed(d[3]) and not t.on then
      t.on=true t.pc=1 t.wait=0 t.counts={}
    end
    if t.on then
      t.wait=t.wait-dt
      if t.wait<=0 then
        local a=actors[d[1]]
        for budget=1,64 do
          if remaining<=0 then break end
          remaining=remaining-1
          local v=d[4][t.pc]
          if not v then
            if d[2]=="forever" then t.pc=1 else t.on=false end
            break
          end
          local p=t.pc t.pc=p+1 local op=v[1]
          if op=="move" then a.x=a.x+v[2] a.y=a.y+v[3]
          elseif op=="goto" then a.x=v[2] a.y=v[3]
          elseif op=="joystick" then a.x=a.x+opd.input.axis("x")*v[2]*dt a.y=a.y+opd.input.axis("y")*v[2]*dt
          elseif op=="stay" then local w,h=halfSize(a) a.x=math.max(w,math.min(320-w,a.x)) a.y=math.max(h,math.min(240-h,a.y))
          elseif op=="random" then local w,h=halfSize(a) a.x=math.random(math.ceil(w),math.max(math.ceil(w),math.floor(320-w))) a.y=math.random(math.ceil(h),math.max(math.ceil(h),math.floor(240-h)))
          elseif op=="wait" then t.wait=v[2] break
          elseif op=="say" then a.say=v[2]
          elseif op=="color" then a.color=v[2]
          elseif op=="look" then a.look=v[2]
          elseif op=="costume" then a.look="image" a.image=v[2] a.iw=v[3] a.ih=v[4]
          elseif op=="sound" then if opd.audio and opd.audio.available then opd.audio.play(v[2],v[3]) end
          elseif op=="sound_stop" then if opd.audio then opd.audio.stop() end
          elseif op=="visible" then a.show=v[2]=="yes"
          elseif op=="score" then score=score+v[2]
          elseif op=="set_score" then score=v[2]
          elseif op=="button" then if not opd.input.down(v[2]) then t.pc=v[3] end
          elseif op=="touch" then if not touching(a,actors[v[2]]) then t.pc=v[3] end
          elseif op=="repeat" then
            if t.counts[p]==nil then t.counts[p]=math.floor(v[2]) end
            if t.counts[p]<=0 then t.counts[p]=nil t.pc=v[3] else t.counts[p]=t.counts[p]-1 end
          elseif op=="jump" then t.pc=v[2] end
        end
      end
    end
  end
  cursor=(cursor+1)%math.max(1,#scripts)
end
local function drawActor(a)
  local x,y,r=math.floor(a.x),math.floor(a.y),a.size
  g.color(a.color)
  if a.look=="image" then g.image(a.image,math.floor(x-a.iw/2),math.floor(y-a.ih/2))
  elseif a.look=="box" then g.fillRect(x-r,y-r,r*2,r*2)
  elseif a.look=="star" then
    for k=0,9 do
      local angle=k*math.pi/5-math.pi/2 local radius=k%2==0 and r or r*0.45
      local xx=math.floor(x+math.cos(angle)*radius) local yy=math.floor(y+math.sin(angle)*radius)
      g.line(x,y,xx,yy)
      local angle2=(k+1)*math.pi/5-math.pi/2 local r2=k%2==0 and r*0.45 or r
      g.line(xx,yy,math.floor(x+math.cos(angle2)*r2),math.floor(y+math.sin(angle2)*r2))
    end
  else
    g.fillCircle(x,y,r)
    if a.look=="cat" then
      g.fillRect(x-r,y-r-3,math.max(3,math.floor(r/2)),math.floor(r/2))
      g.fillRect(x+math.floor(r/2),y-r-3,math.max(3,math.floor(r/2)),math.floor(r/2))
      g.color(0) g.fillCircle(x-math.floor(r/3),y-2,2) g.fillCircle(x+math.floor(r/3),y-2,2)
      g.line(x-2,y+4,x+2,y+4)
    end
  end
  if a.say~="" then g.color(65535) g.text(a.say,math.max(2,math.min(180,x-r)),math.max(25,y-r-16)) end
end
return {
  init=function()
    math.randomseed(opd.system.millis())
    for _,a in ipairs(actors) do a.name=a[1] a.look=a[2] a.color=a[3] a.x=a[4] a.y=a[5] a.size=a[6] a.image=a[7] a.iw=a[8] a.ih=a[9] a.show=true a.say="" end
    for i,d in ipairs(scripts) do threads[i]={pc=1,wait=0,on=d[2]~="pressed",counts={}} end
    tick(0)
  end,
  update=tick,
  draw=function()
    g.clear(background)
    for _,a in ipairs(actors) do if a.show then drawActor(a) end end
    g.color(65535) g.text("Очки: "..tostring(score),8,7)
  end
}
`;
  return {SOURCE,definitions,buttons,looks,colors,starter,compile};
});
