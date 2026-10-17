const fs=require('node:fs/promises');
const path=require('node:path');
const {Simulator}=require('./simulator.cjs');
async function checkGame(bundle,storage,executable) {
  await fs.mkdir(path.join(storage,'apps'),{recursive:true});
  await fs.writeFile(path.join(storage,'apps','agent-check.opd'),bundle.data);
  return new Promise((resolve,reject)=>{
    let count=0, settled=false;
    const sim=new Simulator(executable,storage,'agent-check.opd',bundle.manifest.fps??30);
    const timer=setTimeout(()=>done(new Error('Игра не показала кадры в симуляторе')),Math.max(5000,Math.ceil(1000/(bundle.manifest.fps??30))*7));
    function done(error){if(settled)return;settled=true;clearTimeout(timer);sim.stop();
      const finish=()=>error?reject(error):resolve({frames:count});
      if(sim.closed)finish();else sim.child.once('exit',finish);
    }
    sim.on('frame',()=>{if(++count>=5)done();});
    sim.on('event',event=>{if(event.type==='error')done(new Error(event.message));else if(event.type==='exit')done(new Error('Игра завершилась до проверки пяти кадров'));else if(event.type==='closed'&&!settled)done(new Error('Симулятор завершился'));});
  });
}
module.exports={checkGame};
