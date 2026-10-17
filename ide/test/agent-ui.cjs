const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'openplay-agent-ui-'));const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const packaged=process.argv.includes('--packaged');
  const options={env,args:['--user-data-dir='+data,'--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']};
  if(packaged)options.executablePath=path.join(__dirname,'../dist/OpenPlay-Studio-win32-x64/OpenPlay-Studio.exe');else options.args.unshift(path.join(__dirname,'..'));
  const app=await electron.launch(options);let page;
  try{
    page=await app.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.waitForFunction(()=>document.getElementById('state-label').textContent==='Работает');
    await page.locator('#agent-toggle').click();await page.locator('#agent-settings').click();
    await page.locator('.agent-custom summary').click();await page.locator('#agent-executable').fill(process.execPath);
    await page.locator('#agent-args').fill(JSON.stringify([path.join(__dirname,'fake-acp.cjs'),'--repair']));
    await page.locator('#agent-key').fill('sk-test-voice-not-a-real-key');await page.locator('#agent-settings-form button[type="submit"]').click();
    const saved=await page.evaluate(()=>window.studio.agentSettings());assert.equal(saved.hasVoiceKey,true);assert.ok(!JSON.stringify(saved).includes('sk-test'));
    const actualData=await app.evaluate(({app})=>app.getPath('userData'));
    assert.ok(!(await fs.readFile(path.join(actualData,'voice-key'))).includes(Buffer.from('sk-test-voice-not-a-real-key')));
    // Test only: no real API requests. The renderer still records WebM audio.
    await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('voice:transcribe');ipcMain.handle('voice:transcribe',(_event,bytes)=>{if(bytes.length<100)throw Error('No recorded audio');return {ok:true,value:'Сделай игру с котиком'};});});
    await page.locator('#agent-mic').click();await page.waitForFunction(()=>document.getElementById('agent-mic').classList.contains('recording'));
    await page.waitForFunction(()=>document.getElementById('agent-status').textContent.startsWith('Слушаю'));
    // A small recording is required to produce an actual WebM chunk.
    await new Promise(resolve=>setTimeout(resolve,350));await page.locator('#agent-mic').click();
    await page.waitForFunction(()=>document.getElementById('agent-idea').value==='Сделай игру с котиком');
    await page.locator('#agent-speak').uncheck();await page.locator('#agent-send').click();
    await page.locator('#agent-preview-dialog').waitFor({state:'visible'});assert.match(await page.locator('#agent-check-result').innerText(),/5 кадров/);
    assert.match(await page.locator('#agent-messages').innerText(),/Игра готова/);
    await page.locator('#agent-apply').click();await page.waitForFunction(()=>document.getElementById('state-label').textContent==='Работает'&&document.getElementById('agent-status').textContent.includes('Игра готова'));
    assert.ok(await page.evaluate(()=>monaco.editor.getModels().some(model=>model.getValue().includes('Игра агента'))));
    await page.locator('#agent-toggle').click();
    await page.screenshot({path:path.join(__dirname,'artifacts/agent.png')});
    await page.locator('#agent-undo').click();await page.waitForFunction(()=>monaco.editor.getModels().some(model=>model.getValue().includes('Прыгучий шарик'))&&document.getElementById('agent-undo').disabled);
    assert.ok(await page.evaluate(()=>monaco.editor.getModels().some(model=>model.getValue().includes('Прыгучий шарик'))));
    assert.deepEqual(errors,[]);
    console.log('PASS: Electron ACP settings, DPAPI key storage, real WebM microphone capture, mocked transcription, ACP generation/repair, diff preview, apply/play and undo');
  }catch(error){if(page){await page.screenshot({path:path.join(__dirname,'artifacts/agent-failure.png')});console.error(await page.locator('body').innerText());}throw error;}
  finally{await app.evaluate(({app})=>app.exit());await app.close().catch(()=>{});await fs.rm(data,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
