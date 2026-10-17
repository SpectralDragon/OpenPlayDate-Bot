(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.OpenPlayMedia=factory();})(globalThis,function(){
  const view=bytes=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const magic=bytes=>String.fromCharCode(...bytes.subarray(0,4));
  function imageInfo(bytes){
    if(bytes.length<8||!['OPI1','OPI2'].includes(magic(bytes)))throw Error('Неизвестный формат картинки');
    const v=view(bytes),width=v.getUint16(4,true),height=v.getUint16(6,true),masked=magic(bytes)==='OPI2',pixels=width*height;
    if(!width||width>320||!height||height>240||bytes.length!==8+pixels*2+(masked?Math.ceil(pixels/8):0))throw Error('Повреждённая картинка');
    return {width,height,masked};
  }
  function encodeImage(rgba,width,height){
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>320||height>240||rgba.length!==width*height*4)throw Error('Картинка: размер до 320 × 240');
    const count=width*height,masked=rgba.some((v,i)=>i%4===3&&v<128),bytes=new Uint8Array(8+count*2+(masked?Math.ceil(count/8):0)),v=view(bytes);
    bytes.set([79,80,73,masked?50:49]);v.setUint16(4,width,true);v.setUint16(6,height,true);
    for(let i=0;i<count;i++){
      v.setUint16(8+i*2,((rgba[i*4]&248)<<8)|((rgba[i*4+1]&252)<<3)|(rgba[i*4+2]>>3),true);
      if(masked&&rgba[i*4+3]>=128)bytes[8+count*2+(i>>3)]|=1<<(i&7);
    }
    return bytes;
  }
  function decodeImage(bytes){
    const info=imageInfo(bytes),{width,height,masked}=info,count=width*height,rgba=new Uint8Array(count*4),v=view(bytes);
    for(let i=0;i<count;i++){const c=v.getUint16(8+i*2,true);rgba[i*4]=Math.round((c>>11)*255/31);rgba[i*4+1]=Math.round(((c>>5)&63)*255/63);rgba[i*4+2]=Math.round((c&31)*255/31);rgba[i*4+3]=!masked||(bytes[8+count*2+(i>>3)]&(1<<(i&7)))?255:0;}
    return {...info,rgba};
  }
  function encodeWav(samples,rate=22050){
    if(rate!==22050||!samples.length||samples.length>rate*30)throw Error('Музыка: фрагмент до 30 секунд');
    const bytes=new Uint8Array(44+samples.length*2),v=view(bytes),text=(offset,s)=>bytes.set([...s].map(c=>c.charCodeAt(0)),offset);
    text(0,'RIFF');v.setUint32(4,bytes.length-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,samples.length*2,true);
    for(let i=0;i<samples.length;i++){const n=Math.max(-1,Math.min(1,samples[i]||0));v.setInt16(44+i*2,Math.round(n*(n<0?32768:32767)),true);}return bytes;
  }
  function wavInfo(bytes){
    const v=view(bytes);
    if(bytes.length<46||magic(bytes)!=='RIFF'||String.fromCharCode(...bytes.subarray(8,16))!=='WAVEfmt '||v.getUint32(16,true)!==16||v.getUint16(20,true)!==1||v.getUint16(22,true)!==1||v.getUint32(24,true)!==22050||v.getUint16(32,true)!==2||v.getUint16(34,true)!==16||String.fromCharCode(...bytes.subarray(36,40))!=='data'||v.getUint32(40,true)!==bytes.length-44||v.getUint32(4,true)!==bytes.length-8||(bytes.length-44)%2||bytes.length>44+22050*30*2)throw Error('Нужен WAV PCM: моно, 22050 Гц, 16 бит, до 30 секунд');
    return {duration:(bytes.length-44)/44100};
  }
  return {imageInfo,encodeImage,decodeImage,encodeWav,wavInfo};
});
