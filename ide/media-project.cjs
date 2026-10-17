const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {scan,projectFile,pack}=require('./sdk.cjs');
const codec=require('./media-codec.cjs');
const META='.openplay-media.json';
async function metadata(root){try{return JSON.parse(await fs.readFile(await projectFile(root,META,true),'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}}
async function listMedia(root){
  const names=await metadata(root),files=await scan(root),assets=[];
  for(const file of files.filter(f=>/\.(opi|wav)$/i.test(f.path))){
    const data=await fs.readFile(await projectFile(root,file.path));
    try{const kind=file.path.endsWith('.opi')?'image':'sound';assets.push({path:file.path,name:names[file.path]||path.basename(file.path),kind,bytes:data.length,...(kind==='image'?codec.imageInfo(data):codec.wavInfo(data))});}catch{/* Unrecognized hand-added media remains visible in Files. */}
  }
  return assets;
}
async function readMedia(root,relative){
  if(typeof relative!=='string'||!/^assets\/[a-zA-Z0-9_./-]+\.(opi|wav)$/.test(relative))throw Error('Выбери картинку или музыку из библиотеки');
  const file=await projectFile(root,relative);if((await fs.stat(file)).size>2*1024*1024)throw Error('Слишком большой файл');
  const data=await fs.readFile(file);return relative.endsWith('.opi')?{kind:'image',...codec.decodeImage(data)}:{kind:'sound',data,...codec.wavInfo(data)};
}
let importing=false;
async function importMedia(root,kind,value){
  if(importing)throw Error('Дождись завершения импорта');importing=true;let file;
  try{
    let bytes;
    if(kind==='image')bytes=Buffer.from(codec.encodeImage(new Uint8Array(value.rgba),value.width,value.height));
    else if(kind==='sound'){bytes=Buffer.from(value.data);codec.wavInfo(bytes);}else throw Error('Неизвестный тип медиа');
    const relative='assets/'+kind+'-'+randomUUID().slice(0,8)+(kind==='image'?'.opi':'.wav');
    const target=await projectFile(root,relative,true);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx'});file=target;
    await pack(root); // Includes the actual project's bundle and file-count limits.
    const names=await metadata(root);names[relative]=String(value.name||'Мой файл').slice(0,80);
    const meta=await projectFile(root,META,true),temp=meta+'.studio-tmp-'+process.pid;
    try{await fs.writeFile(temp,JSON.stringify(names,null,2)+'\n',{flag:'wx'});await fs.rename(temp,meta);}finally{await fs.rm(temp,{force:true});}
    file=null;const assets=await listMedia(root);return {asset:assets.find(a=>a.path===relative),assets,files:await scan(root)};
  }finally{if(file)await fs.rm(file,{force:true});importing=false;}
}
function extractSounds(bundle){
  const data=bundle.data,result=new Map();let at=12+data.readUInt32LE(4);
  for(let i=0;i<data.readUInt32LE(8);i++){const n=data.readUInt16LE(at),size=data.readUInt32LE(at+2);at+=6;const name=data.subarray(at,at+n).toString();at+=n;if(name.endsWith('.wav')){const bytes=data.subarray(at,at+size);try{codec.wavInfo(bytes);result.set(name,bytes);}catch{}}at+=size;}return result;
}
module.exports={listMedia,readMedia,importMedia,extractSounds};
