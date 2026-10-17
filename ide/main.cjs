const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pack, scan, projectFile, safePath } = require('./sdk.cjs');
const { Simulator } = require('./simulator.cjs');
const devices = require('./device.cjs');
let win, project, simulator, allowClose = false;
let selectedDevice = null, deploying = false;
const resource = name => app.isPackaged ? path.join(__dirname, 'resources', name) : path.join(__dirname, '..', name);
const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };
const handle = (name, fn) => ipcMain.handle(name, async (event, ...args) => {
  if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Unknown sender');
  try { return { ok: true, value: await fn(...args) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
function stop() { if (simulator) { simulator.removeAllListeners(); simulator.stop(); simulator = null; } }
async function loadProject(root) {
  const canonicalRoot = await fs.realpath(root);
  const files = await scan(canonicalRoot);
  if (!files.some(f => f.path === 'manifest.json')) throw new Error('В этой папке нет manifest.json. Открой папку Lua-программы.');
  const manifest = JSON.parse(await fs.readFile(await projectFile(canonicalRoot, 'manifest.json'), 'utf8'));
  stop(); project = canonicalRoot;
  await fs.writeFile(path.join(app.getPath('userData'), 'studio.json'), JSON.stringify({ project }));
  return { root: project, files, manifest };
}
async function initialProject() {
  try { const prefs = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'studio.json'), 'utf8')); return await loadProject(prefs.project); }
  catch { /* First launch, or a moved project: create an editable local example. */ }
  const base = path.join(app.getPath('userData'), 'Projects', 'bouncing-ball');
  try { await fs.access(base); } catch { await fs.cp(resource('examples/bouncing-ball'), base, { recursive: true, errorOnExist: true, force: false }); }
  return loadProject(base);
}
handle('project:initial', initialProject);
handle('project:open', async () => {
  const result = await dialog.showOpenDialog(win, { title: 'Открой папку Lua-программы', properties: ['openDirectory'] });
  return result.canceled ? null : loadProject(result.filePaths[0]);
});
handle('project:new', async (template = 'bouncing-ball') => {
  if (!['bouncing-ball', 'robot-ports'].includes(template)) throw new Error('Неизвестный шаблон');
  const result = await dialog.showSaveDialog(win, { title: 'Новая папка проекта', defaultPath: path.join(app.getPath('documents'), template), buttonLabel: 'Создать проект' });
  if (result.canceled) return null;
  // mkdir without recursive refuses existing folders, so templates never overwrite work.
  await fs.mkdir(result.filePath);
  await fs.cp(resource('examples/' + template), result.filePath, { recursive: true, force: false, errorOnExist: true });
  return loadProject(result.filePath);
});
handle('file:read', async relative => {
  const file = await projectFile(project, relative); const info = await fs.stat(file);
  if (info.size > 262144) throw new Error('Текстовый файл больше 256 КиБ');
  return fs.readFile(file, 'utf8');
});
handle('file:save', async (relative, content, expected) => {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 262144) throw new Error('Текстовый файл больше 256 КиБ');
  const file = await projectFile(project, relative);
  if (await fs.readFile(file, 'utf8') !== expected) throw new Error(`${relative} изменён другой программой. Открой проект заново, чтобы прочитать изменения.`);
  const temp = file + '.studio-tmp-' + process.pid;
  try { await fs.writeFile(temp, content, { flag: 'wx' }); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }); }
});
handle('file:create', async relative => {
  if (!safePath(relative) || !/\.(lua|json|txt|md)$/.test(relative)) throw new Error('Имя: латиница, цифры, _ или -, расширение .lua, .json, .txt или .md');
  const file = await projectFile(project, relative, true);
  await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, relative.endsWith('.lua') ? '-- Новый модуль\nreturn {}\n' : '', { flag: 'wx' });
  return scan(project);
});
handle('project:export', async () => {
  const bundle = await pack(project);
  const result = await dialog.showSaveDialog(win, { title: 'Собрать программу для консоли', defaultPath: path.join(path.dirname(project), bundle.manifest.id + '.opd'), filters: [{ name: 'OpenPlay', extensions: ['opd'] }] });
  if (result.canceled) return null;
  const target = path.resolve(result.filePath); const rel = path.relative(project, target);
  if (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)) throw new Error('Сохрани .opd вне папки проекта');
  if (!/^[a-z0-9_-]{1,40}\.opd$/.test(path.basename(target))) throw new Error('Имя .opd: a-z, 0-9, _ или -, до 40 символов');
  await fs.writeFile(target, bundle.data);
  return { path: target, bytes: bundle.data.length, count: bundle.count };
});
async function rememberDevice(device) {
  selectedDevice = device;
  await fs.writeFile(path.join(app.getPath('userData'), 'device.json'), JSON.stringify({ address: device.address, id: device.id }));
  return device;
}
handle('device:discover', async () => {
  let remembered;
  try { remembered = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'device.json'), 'utf8')).address; } catch {}
  const found = await devices.discover(remembered);
  return found;
});
handle('device:connect', async address => rememberDevice(await devices.probe(address)));
handle('device:deploy', async () => {
  if (deploying) throw new Error('Загрузка уже выполняется');
  if (!selectedDevice) throw new Error('Сначала выбери консоль');
  deploying = true;
  try {
    send('device:progress', { percent: 0, stage: 'Сборка программы…' });
    const bundle = await pack(project);
    return await devices.deploy(selectedDevice.address, selectedDevice.id, bundle, event => send('device:progress', event));
  } finally { deploying = false; }
});
handle('sim:run', async () => {
  stop(); const bundle = await pack(project);
  const executable = path.join(__dirname, 'native/build', process.platform === 'win32' ? 'openplay-simulator.exe' : 'openplay-simulator');
  try { await fs.access(executable); } catch { throw new Error('Сначала собери симулятор: npm run build:native'); }
  const storage = await fs.mkdtemp(path.join(app.getPath('temp'), 'openplay-studio-'));
  await fs.mkdir(path.join(storage, 'apps')); await fs.writeFile(path.join(storage, 'apps', 'preview.opd'), bundle.data);
  simulator = new Simulator(executable, storage, 'preview.opd', bundle.manifest.fps ?? 30);
  const current = simulator;
  current.on('frame', bytes => send('sim:frame', bytes));
  current.on('event', event => send('sim:event', event));
  current.child.once('exit', () => { fs.rm(storage, { recursive: true, force: true }).catch(() => {}); });
  return { name: bundle.manifest.name, fps: bundle.manifest.fps ?? 30, kind: bundle.manifest.kind };
});
handle('sim:control', command => {
  if (!['pause', 'resume', 'step', 'stop'].includes(command)) throw new Error('Unknown command');
  if (command === 'stop') { stop(); send('sim:event', { type: 'stopped' }); }
  else simulator?.[command]();
});
handle('sim:input', mask => { if (Number.isInteger(mask)) simulator?.input(mask); });
handle('sim:gpio', (pin, level) => { if ([1,2,16,17,18,21].includes(pin) && typeof level === 'boolean') simulator?.command(`gpio ${pin} ${level ? 1 : 0}`); });
handle('sim:uart', text => {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 256) throw new Error('UART: до 256 байт');
  simulator?.command('uart ' + Array.from(Buffer.from(text)).join(' '));
});
handle('help:api', () => fs.readFile(resource('docs/lua-api.md'), 'utf8'));
handle('help:portal', () => shell.openExternal('http://192.168.4.1/'));
handle('screen:save', async data => {
  if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,') || data.length > 1024*1024) throw new Error('Неверный PNG');
  const result = await dialog.showSaveDialog(win, { defaultPath: 'openplay-screen.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (!result.canceled) await fs.writeFile(result.filePath, Buffer.from(data.split(',')[1], 'base64'));
  return !result.canceled;
});
handle('window:close', () => { allowClose = true; win.close(); });
async function createWindow() {
  win = new BrowserWindow({ title: 'OpenPlay Studio', width: 1540, height: 980, minWidth: 1080, minHeight: 720, backgroundColor: '#101318', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('close', event => { if (!allowClose) { event.preventDefault(); send('window:closing'); } });
  win.on('closed', () => { stop(); win = null; });
  await win.loadFile(path.join(__dirname, 'renderer/index.html'));
  win.show();
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => stop());
