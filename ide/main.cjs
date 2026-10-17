const { app, BrowserWindow, ipcMain, dialog, Menu, shell, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pack, scan, projectFile, safePath } = require('./sdk.cjs');
const { Simulator } = require('./simulator.cjs');
const devices = require('./device.cjs');
const { AgentService } = require('./agent-service.cjs');
const { readBlocks, saveBlocks } = require('./blocks-project.cjs');
const blockLanguage = require('./blocks.cjs');
const mediaProject = require('./media-project.cjs');
let agentService;
let win, project, simulator, allowClose = false;
let selectedDevice = null, deploying = false;
const resource = name => app.isPackaged ? path.join(__dirname, 'resources', name) : path.join(__dirname, '..', name);
const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };
const handle = (name, fn) => ipcMain.handle(name, async (event, ...args) => {
  if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Unknown sender');
  try { return { ok: true, value: await fn(...args) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
function stop() { send('sim:event',{type:'audio',action:'stop'}); if (simulator) { simulator.removeAllListeners(); simulator.stop(); simulator = null; } }
async function loadProject(root) {
  const canonicalRoot = await fs.realpath(root);
  const files = await scan(canonicalRoot);
  if (!files.some(f => f.path === 'manifest.json')) throw new Error('В этой папке нет manifest.json. Открой папку проекта OpenPlay.');
  const manifest = JSON.parse(await fs.readFile(await projectFile(canonicalRoot, 'manifest.json'), 'utf8'));
  let blocks = await readBlocks(canonicalRoot, manifest.entry);
  if(blocks?.needsBuild){await saveBlocks(canonicalRoot,blocks.document,blocks.raw,blocks.lua);blocks=await readBlocks(canonicalRoot,manifest.entry);}
  stop(); project = canonicalRoot;
  await fs.writeFile(path.join(app.getPath('userData'), 'studio.json'), JSON.stringify({ project }));
  return { root: project, files: blocks ? await scan(project) : files, manifest, blocks };
}
async function initialProject() {
  try { const prefs = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'studio.json'), 'utf8')); return await loadProject(prefs.project); }
  catch { /* First launch, or a moved project: create an editable local example. */ }
  const base = path.join(app.getPath('userData'), 'Projects', 'bouncing-ball');
  try { await fs.access(base); } catch { await fs.cp(resource('examples/bouncing-ball'), base, { recursive: true, errorOnExist: true, force: false }); }
  return loadProject(base);
}
handle('project:initial', initialProject);
handle('agent:settings',()=>agentService.settings());
handle('agent:save-settings',value=>agentService.saveSettings(value));
handle('agent:pick',async()=>{const result=await dialog.showOpenDialog(win,{title:'Выбрать ACP-агента',properties:['openFile'],filters:[{name:'ACP executable / Node.js',extensions:['exe','js','mjs','cjs']}]});return result.canceled?null:result.filePaths[0];});
handle('agent:login',()=>agentService.login());
handle('agent:run',async idea=>{
  if(await readBlocks(project,'main.lua'))throw new Error('Помощник пока работает с Lua-проектами. Игру из блоков меняй во вкладке «Блоки».');
  return agentService.run(project,idea);
});
handle('agent:cancel',()=>agentService.cancel());
handle('agent:permission',(id,option)=>agentService.permission(id,option));
handle('agent:apply',async()=>{await agentService.apply(project);return loadProject(project);});
handle('agent:undo',async()=>{await agentService.undo(project);return loadProject(project);});
handle('agent:discard',()=>agentService.discard());
handle('voice:transcribe',bytes=>agentService.speech(bytes));
handle('project:open', async () => {
  const result = await dialog.showOpenDialog(win, { title: 'Открой папку проекта OpenPlay', properties: ['openDirectory'] });
  return result.canceled ? null : loadProject(result.filePaths[0]);
});
handle('project:new', async (template = 'bouncing-ball') => {
  if (!['bouncing-ball', 'robot-ports', 'blocks-stars'].includes(template)) throw new Error('Неизвестный шаблон');
  const result = await dialog.showSaveDialog(win, { title: 'Новая папка проекта', defaultPath: path.join(app.getPath('documents'), template), buttonLabel: 'Создать проект' });
  if (result.canceled) return null;
  // mkdir without recursive refuses existing folders, so templates never overwrite work.
  await fs.mkdir(result.filePath);
  if (template === 'blocks-stars') {
    const document = blockLanguage.starter();
    await fs.writeFile(path.join(result.filePath, 'manifest.json'), JSON.stringify({api:1,id:'blocks-stars',name:'Котик и звёзды',kind:'game',entry:'main.lua',fps:30},null,2)+'\n');
    await fs.writeFile(path.join(result.filePath, blockLanguage.SOURCE), JSON.stringify(document,null,2)+'\n');
    await fs.writeFile(path.join(result.filePath, 'main.lua'), blockLanguage.compile(document));
  } else await fs.cp(resource('examples/' + template), result.filePath, { recursive: true, force: false, errorOnExist: true });
  return loadProject(result.filePath);
});
handle('blocks:save', async (document, expected, expectedLua) => {
  const saved = await saveBlocks(project, document, expected, expectedLua);
  return { ...saved, files: await scan(project) };
});
handle('media:list',()=>mediaProject.listMedia(project));
handle('media:read',relative=>mediaProject.readMedia(project,relative));
handle('media:import',(kind,value)=>mediaProject.importMedia(project,kind,value));
handle('media:choose',async kind=>{
  if(!['image','sound'].includes(kind))throw new Error('Неизвестный тип файла');
  const result=await dialog.showOpenDialog(win,{title:kind==='image'?'Добавить картинку':'Добавить музыку или звук',properties:['openFile'],filters:[{name:kind==='image'?'Картинки':'Музыка и звуки',extensions:kind==='image'?['png','jpg','jpeg','webp','bmp']:['wav','mp3','ogg','flac']}]});
  if(result.canceled)return null;
  const file=result.filePaths[0];if((await fs.stat(file)).size>32*1024*1024)throw new Error('Для импорта выбери файл до 32 МиБ');
  const types={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',bmp:'image/bmp',wav:'audio/wav',mp3:'audio/mpeg',ogg:'audio/ogg',flac:'audio/flac'};
  const mime=types[path.extname(file).slice(1).toLowerCase()];if(!mime||!mime.startsWith(kind==='image'?'image/':'audio/'))throw new Error('Формат файла не поддерживается');
  return {name:path.basename(file,path.extname(file)),mime,data:await fs.readFile(file)};
});
handle('file:read', async relative => {
  const file = await projectFile(project, relative); const info = await fs.stat(file);
  if (info.size > 262144) throw new Error('Текстовый файл больше 256 КиБ');
  return fs.readFile(file, 'utf8');
});
handle('file:save', async (relative, content, expected) => {
  if(relative===blockLanguage.SOURCE || (relative==='main.lua' && await readBlocks(project,'main.lua')))throw new Error('Этот файл создаётся из блоков. Сохраняй игру во вкладке «Блоки».');
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
  const sounds=mediaProject.extractSounds(bundle);
  current.on('frame', bytes => send('sim:frame', bytes));
  current.on('event', event => {
    if(event.type==='audio'&&event.action==='play'){
      const data=sounds.get(event.path);
      if(data)send('sim:event',{...event,data});
      else send('sim:event',{type:'log',message:'Звук не найден или имеет неподдерживаемый формат: '+event.path});
    }else send('sim:event', event);
  });
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
  agentService = new AgentService({data:app.getPath('userData'),temp:app.getPath('temp'),executable:path.join(__dirname,'native/build',process.platform==='win32'?'openplay-simulator.exe':'openplay-simulator'),documentation:resource('docs/lua-api.md'),safeStorage,send:event=>send('agent:event',event)});
  win = new BrowserWindow({ title: 'OpenPlay Studio', width: 1540, height: 980, minWidth: 1080, minHeight: 720, backgroundColor: '#101318', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  Menu.setApplicationMenu(null);
  // Microphone access belongs only to this local editor, and audio only.
  const editorUrl = require('node:url').pathToFileURL(path.join(__dirname,'renderer/index.html')).href;
  win.webContents.session.setPermissionRequestHandler((contents,permission,callback,details)=>callback(!!(contents===win.webContents&&contents.getURL()===editorUrl&&permission==='media'&&details.mediaTypes?.length&&details.mediaTypes.every(type=>type==='audio'))));
  win.webContents.session.setPermissionCheckHandler((contents,permission,_origin,details)=>contents===win.webContents&&contents.getURL()===editorUrl&&permission==='media'&&details.mediaType==='audio');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('close', event => { if (!allowClose) { event.preventDefault(); send('window:closing'); } });
  win.on('closed', () => { stop(); win = null; });
  await win.loadFile(path.join(__dirname, 'renderer/index.html'));
  win.show();
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {stop();agentService?.close();});
