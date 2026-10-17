const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { fakeConsole } = require('./device-fixture.cjs');
(async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'openplay-ui-'));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.argv.includes('--packaged');
  const app = await electron.launch(packaged
    ? { executablePath: path.join(__dirname, '../dist/OpenPlay-Studio-win32-x64/OpenPlay-Studio.exe'), args: ['--user-data-dir=' + data], env }
    : { args: [path.join(__dirname, '..'), '--user-data-dir=' + data], env });
  const artifacts = path.join(__dirname, 'artifacts'); await fs.mkdir(artifacts, { recursive: true });
  let page;
  const device = await fakeConsole();
  try {
    page = await app.firstWindow(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => { if (message.type() === 'error') console.error('Renderer:', message.text()); });
    await page.waitForFunction(() => document.getElementById('state-label').textContent === 'Работает', { timeout: 20000 });
    await page.waitForFunction(() => /^\d+ fps$/.test(document.getElementById('fps').textContent));
    await page.screenshot({ path: path.join(artifacts, 'studio.png') });
    assert.equal(await page.locator('.monaco-editor').count(), 1);
    assert.equal(await page.evaluate(() => typeof window.require), 'function');
    assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
    await page.locator('#pause').click(); await page.waitForFunction(() => document.getElementById('state-label').textContent === 'На паузе');
    const before = await page.locator('#screen').evaluate(c => c.toDataURL());
    await page.locator('#step').click(); await page.waitForFunction(() => document.getElementById('state-label').textContent === 'На паузе');
    await page.waitForFunction(previous => document.getElementById('screen').toDataURL() !== previous, before);
    await page.locator('#pause').click(); await page.waitForFunction(() => document.getElementById('state-label').textContent === 'Работает');
    await page.locator('#screen').click(); await page.keyboard.press('KeyX');
    await page.waitForFunction(() => document.getElementById('state-label').textContent === 'Остановлен');
    await page.locator('[data-path="ball.lua"]').click(); await page.waitForFunction(() => document.getElementById('crumb-file').textContent === 'ball.lua');
    await page.locator('[data-path="main.lua"]').click();
    const original = await page.evaluate(() => monaco.editor.getModels().find(m => m.getValue().includes('Прыгучий шарик')).getValue());
    await page.evaluate(() => monaco.editor.getModels().find(m=>m.getValue().includes('Прыгучий шарик')).setValue('return {draw=function() invalid( end}'));
    await page.locator('#run').click(); await page.waitForFunction(() => document.getElementById('state-label').textContent === 'Ошибка программы');
    assert.match(await page.locator('#logs').innerText(), /main.lua:1:/);
    await page.evaluate(text => monaco.editor.getModels().find(m=>m.getValue().includes('invalid')).setValue(text), original);
    await page.locator('#run').click(); await page.waitForFunction(() => document.getElementById('state-label').textContent === 'Работает');
    await page.locator('#new-file').click(); await page.locator('#modal-input').fill('helper.lua'); await page.locator('#modal-actions button[value="create"]').click();
    await page.waitForFunction(() => document.getElementById('crumb-file').textContent === 'helper.lua');
    await page.locator('#api').click(); await page.locator('#api-text').waitFor({ state: 'visible' });
    assert.match(await page.locator('#api-text').innerText(), /opd.graphics/); await page.locator('#modal-actions button').click();
    await page.locator('[data-path="main.lua"]').click();
    // Native dialogs are replaced only in this isolated test process.
    const exported = path.join(data, 'ui-test.opd');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, exported);
    await page.locator('#export').click(); await page.waitForFunction(() => document.getElementById('status').textContent.includes('Бандл .opd готов'));
    assert.equal((await fs.readFile(exported)).subarray(0, 4).toString(), 'OPD1');
    const png = path.join(data, 'screen.png');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, png);
    await page.locator('#screenshot').click(); await page.waitForFunction(() => document.getElementById('logs').textContent.includes('Снимок экрана сохранён'));
    assert.deepEqual((await fs.readFile(png)).subarray(0,8), Buffer.from([137,80,78,71,13,10,26,10]));
    // Connect to a real local HTTP test server through the actual preload bridge.
    await page.waitForFunction(() => !document.getElementById('device-connect').disabled);
    await page.locator('.device-manual summary').click(); await page.locator('#device-address').fill(device.address);
    await page.locator('#device-connect').click(); await page.waitForFunction(() => !document.getElementById('device-send').disabled);
    await page.locator('#device-send').click();
    await page.waitForFunction(() => document.getElementById('device-status').textContent === 'Программа запущена на консоли');
    assert.equal(device.received[0].filename, 'bouncing-ball.opd'); assert.equal(device.received[0].data.subarray(0,4).toString(),'OPD1');
    assert.equal(await page.locator('#device-progress').getAttribute('value'), '100');
    await page.evaluate(() => monaco.editor.getModels().find(m=>m.getValue().includes('Прыгучий шарик')).setValue('-- несохранённый код\nreturn {}'));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await page.locator('#modal').waitFor({ state: 'visible' }); assert.match(await page.locator('#modal-title').innerText(), /Сохранить/);
    await page.locator('#modal-actions button[value="cancel"]').click();
    assert.match(await page.locator('#dirty-label').innerText(), /несохранённых/);
    await page.evaluate(text => monaco.editor.getModels().find(m=>m.getValue().includes('несохранённый')).setValue(text), original);
    // Minimum window size still keeps all primary controls reachable.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1080,720));
    await page.locator('#run').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(artifacts, 'studio-small.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1540,980));
    await page.screenshot({ path: path.join(artifacts, 'studio-verified.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: Electron UI, native frames, pause/step/resume, keyboard B, tabs, save/run, Lua errors/recovery, new file, OPD export, PNG screenshot, LAN connection and deploy, unsaved close dialog, API help, context isolation, minimum window size');
  } catch (e) {
    if (page) { await page.screenshot({ path: path.join(artifacts, 'failure.png') }); console.error(await page.locator('body').innerText()); }
    throw e;
  } finally {
    // The test has no unsaved work; bypass the close handshake for test cleanup.
    await app.evaluate(({ app }) => app.exit()); await app.close().catch(() => {});
    await fs.rm(data, { recursive: true, force: true });
    await device.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
