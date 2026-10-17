const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {fakeConsole}=require('./device-fixture.cjs');
(async()=>{
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'openplay-block-ui-')),root=path.join(data,'my-block-game');
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const options={env,args:['--user-data-dir='+data]};
  if(process.argv.includes('--packaged'))options.executablePath=path.join(__dirname,'../dist/OpenPlay-Studio-win32-x64/OpenPlay-Studio.exe');else options.args.unshift(path.join(__dirname,'..'));
  const app=await electron.launch(options),device=await fakeConsole();let page;
  const artifacts=path.join(__dirname,'artifacts');await fs.mkdir(artifacts,{recursive:true});
  try{
    page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')console.error('Renderer:',m.text());});
    await page.waitForFunction(()=>document.getElementById('state-label').textContent==='Работает');
    await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},root);
    await page.locator('#new-blocks').click();await page.locator('#blocks-editor').waitFor({state:'visible'});
    await page.waitForFunction(()=>!document.getElementById('run').disabled);
    assert.equal(await page.locator('.sprite-card').count(),2);
    assert.equal(await page.locator('#dirty-label').innerText(),'Всё сохранено');
    await page.locator('[data-sprite="star"]').click();await page.locator('[data-sprite="cat"]').click();
    assert.equal(await page.locator('#dirty-label').innerText(),'Всё сохранено');
    await page.locator('#run').click();await page.waitForFunction(()=>document.getElementById('state-label').textContent==='Работает'&&!document.getElementById('run').disabled);
    const old=await page.locator('#screen').evaluate(c=>c.toDataURL());
    await page.locator('#screen').click();await page.keyboard.down('ArrowRight');
    await page.waitForFunction(previous=>document.getElementById('screen').toDataURL()!==previous,old);await page.keyboard.up('ArrowRight');
    await page.locator('#sprite-name').fill('Моя кошечка');await page.locator('#sprite-name').press('Tab');
    await page.locator('#sprite-x').fill('240');await page.locator('#sprite-x').press('Tab');
    await page.locator('#sprite-y').fill('90');await page.locator('#sprite-y').press('Tab');
    await page.locator('#save').click();await page.waitForFunction(()=>document.getElementById('dirty-label').textContent==='Всё сохранено');
    assert.equal(JSON.parse(await fs.readFile(path.join(root,'.openplay-blocks.json'),'utf8')).sprites[0].name,'Моя кошечка');
    // Real drag from the toolbox into the workspace, followed by undo and redo.
    await page.locator('.blocklyToolboxCategory').filter({hasText:'Внешность'}).click();
    const block=page.locator('.blocklyFlyout .blocklyDraggable').first();await block.waitFor({state:'visible'});
    const from=await block.boundingBox(),area=await page.locator('#blockly-workspace').boundingBox();
    const count=await page.evaluate(()=>blocksUI.workspace.getAllBlocks(false).length);
    await page.mouse.move(from.x+30,from.y+20);await page.mouse.down();await page.mouse.move(area.x+area.width-100,area.y+120,{steps:20});await page.mouse.up();
    await page.waitForFunction(n=>blocksUI.workspace.getAllBlocks(false).length===n+1,count);
    await page.locator('#blocks-undo').click();await page.waitForFunction(n=>blocksUI.workspace.getAllBlocks(false).length===n,count);
    await page.locator('#blocks-redo').click();await page.waitForFunction(n=>blocksUI.workspace.getAllBlocks(false).length===n+1,count);
    await page.locator('#run').click();await page.waitForFunction(()=>document.getElementById('logs').textContent.includes('подсоедини свободные'));
    await page.locator('#blocks-undo').click();
    await page.locator('#run').click();await page.waitForFunction(()=>document.getElementById('state-label').textContent==='Работает'&&!document.getElementById('run').disabled);
    // Reopen from disk through main/preload and ensure real blocks survived.
    await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},root);
    await page.locator('#open').click();await page.waitForFunction(()=>document.getElementById('sprite-name').value==='Моя кошечка'&&!document.getElementById('run').disabled);
    await page.locator('#code-mode').click();await page.locator('#editor').waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>editor.getOption(monaco.editor.EditorOption.readOnly)),true);
    await page.locator('#blocks-mode').click();await page.locator('#run').click();await page.waitForFunction(()=>document.getElementById('state-label').textContent==='Работает'&&!document.getElementById('run').disabled);
    await page.waitForFunction(()=>!findingDevices);
    await page.locator('.device-manual summary').click();await page.locator('#device-address').fill(device.address);await page.locator('#device-connect').click();
    await page.waitForFunction(()=>document.getElementById('device-status').textContent.includes('На связи')&&consoleDevice?.name==='OpenPlay Test');
    await page.waitForFunction(()=>!document.getElementById('device-send').disabled);await page.locator('#device-send').click();
    await page.waitForFunction(()=>document.getElementById('device-status').textContent==='Программа запущена на консоли');
    assert.equal(device.received[0].filename,'blocks-stars.opd');assert.ok(!device.received[0].data.includes(Buffer.from('.openplay-blocks.json')));
    await page.evaluate(()=>{document.querySelector('.simulator-pane').scrollTop=0;blocksUI.workspace.scrollCenter();});
    await page.screenshot({path:path.join(artifacts,'blocks.png')});
    await page.locator('#sprite-add').click();assert.equal(await page.locator('.sprite-card').count(),3);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await page.locator('#modal').waitFor({state:'visible'});
    await page.locator('#modal-actions button[value="cancel"]').click();
    await page.locator('[data-sprite="cat"]').click();
    // Select the movement category, leaving the child's own script visible.
    await page.locator('.blocklyToolboxCategory').filter({hasText:'Движение'}).click();await page.evaluate(()=>blocksUI.workspace.getToolbox().clearSelection());
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1080,720));
    assert.ok((await page.locator('#blockly-workspace').boundingBox()).height>130);
    await page.screenshot({path:path.join(artifacts,'blocks-small.png')});assert.deepEqual(errors,[]);
    console.log('PASS: real block drag, undo/redo, hero edits, native joystick gameplay, JSON/Lua save/reopen, detached-block validation, readonly Lua, OPD LAN deploy, unsaved-close guard and 1080×720 layout');
  }catch(error){if(page){await page.screenshot({path:path.join(artifacts,'blocks-failure.png')});console.error(await page.locator('body').innerText());}throw error;}
  finally{await app.evaluate(({app})=>app.exit());await app.close().catch(()=>{});await device.close();await fs.rm(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
