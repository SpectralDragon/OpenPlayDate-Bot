/* global require, monaco */
const $ = id => document.getElementById(id);
const api = window.studio;
const models = new Map();
let project, editor, active, busy = false, running = false, paused = false, mask = 0, stickTimer;
let frameCount = 0, frameAt = performance.now(), logCount = 0;
let consoleDevice = null, consoleDevices = [], findingDevices = false;
const bits = { a: 1, b: 2, stick: 4, left: 8, right: 16, up: 32, down: 64 };
const keyboard = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyZ: 'a', KeyX: 'b', Enter: 'stick' };
const screen = $('screen');
const context = screen.getContext('2d', { alpha: false });
const image = context.createImageData(320, 240);
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', '#i-' + name); svg.append(use); return svg;
}
function log(message, kind = 'info') {
  const row = document.createElement('div'); row.className = 'log ' + kind;
  const time = document.createElement('time'); time.textContent = new Date().toLocaleTimeString('ru-RU');
  const tag = document.createElement('span'); tag.className = 'log-kind'; tag.textContent = ({ info: 'STUDIO', error: 'ОШИБКА', lua: 'LUA', build: 'СБОРКА' })[kind] || kind.toUpperCase();
  const text = document.createElement('span'); text.textContent = message; row.append(time, tag, text);
  const match = message.match(/([\w./-]+\.lua):(\d+):/);
  if (match) {
    row.classList.add('link'); row.title = 'Перейти к строке ' + match[2];
    row.addEventListener('click', () => execute(async () => { await openFile(match[1]); editor.setPosition({ lineNumber: Number(match[2]), column: 1 }); editor.revealLineInCenter(Number(match[2])); editor.focus(); }));
    const entry = models.get(match[1]);
    if (entry) monaco.editor.setModelMarkers(entry.model, 'runtime', [{ startLineNumber: Number(match[2]), endLineNumber: Number(match[2]), startColumn: 1, endColumn: entry.model.getLineMaxColumn(Math.min(entry.model.getLineCount(), Number(match[2]))), message, severity: monaco.MarkerSeverity.Error }]);
  }
  $('logs').append(row); while ($('logs').children.length > 400) $('logs').firstChild.remove();
  $('logs').scrollTop = $('logs').scrollHeight; $('log-count').textContent = ++logCount;
}
function status(text) { $('status').textContent = text; }
async function execute(fn) {
  if (busy) return;
  busy = true; updateButtons();
  try { return await fn(); }
  catch (error) { log(error.message, 'error'); status(error.message); }
  finally { busy = false; updateButtons(); }
}
function updateButtons() {
  for (const id of ['run', 'restart', 'save', 'export', 'open', 'new-project', 'new-robot', 'new-file']) $(id).disabled = busy || !editor;
  $('pause').disabled = !running || busy;
  $('step').disabled = !running || !paused || busy;
  $('stop').disabled = !running || busy;
  $('pause').setAttribute('aria-label', paused ? 'Продолжить' : 'Пауза');
  $('pause').replaceChildren(icon(paused ? 'play' : 'pause'));
  $('device-send').disabled = busy || findingDevices || !consoleDevice;
  $('device-quick-send').disabled = busy || !editor;
  $('device-scan').disabled = busy || findingDevices;
  $('device-connect').disabled = busy || findingDevices;
  $('device-list').disabled = busy || findingDevices || !consoleDevices.length;
}
function setState(state) {
  running = ['running', 'paused'].includes(state); paused = state === 'paused';
  $('state-dot').className = state;
  $('state-label').textContent = ({ running: 'Работает', paused: 'На паузе', stopped: 'Остановлен', error: 'Ошибка программы', loading: 'Запускается…' })[state] || state;
  $('screen-overlay').hidden = !paused;
  if (!running || paused) { releaseInput(); $('fps').textContent = paused ? 'пауза' : '— fps'; }
  frameCount = 0; frameAt = performance.now(); updateButtons();
}
function dirty(entry) { return entry.model.getValue() !== entry.saved; }
function dirtyEntries() { return [...models.entries()].filter(([, entry]) => dirty(entry)); }
function refreshDirty() {
  const count = dirtyEntries().length;
  $('dirty-label').textContent = count ? `${count} несохранённых` : 'Всё сохранено';
  document.title = `${count ? '● ' : ''}${project?.manifest.name || 'OpenPlay'} — OpenPlay Studio`;
  renderTabs();
}
function renderTabs() {
  $('tabs').replaceChildren();
  for (const [name, entry] of models) {
    const tab = document.createElement('button'); tab.className = 'tab' + (active === name ? ' active' : ''); tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(active === name));
    const type = document.createElement('span'); type.className = 'tab-type'; type.textContent = name.endsWith('.lua') ? 'Lua' : name.endsWith('.json') ? '{}' : '≡';
    const title = document.createElement('span'); title.textContent = name.split('/').pop();
    const close = document.createElement('span'); close.className = 'tab-close' + (dirty(entry) ? ' dirty' : ''); close.textContent = dirty(entry) ? '•' : '×'; close.title = 'Закрыть вкладку';
    tab.append(type, title, close); tab.title = name;
    tab.addEventListener('click', event => { if (event.target === close) execute(() => closeTab(name)); else execute(() => openFile(name)); });
    $('tabs').append(tab);
  }
}
function renderFiles() {
  $('files').replaceChildren(); let previousFolder = '';
  for (const file of project.files) {
    const parts = file.path.split('/'), folder = parts.slice(0, -1).join('/');
    if (folder && folder !== previousFolder) {
      const row = document.createElement('div'); row.className = 'folder-row'; row.append(icon('folder'), document.createTextNode(folder)); $('files').append(row);
    }
    previousFolder = folder;
    const row = document.createElement('button'); row.className = 'file-row' + (active === file.path ? ' active' : ''); row.dataset.kind = file.text ? 'source' : 'asset'; row.dataset.path = file.path;
    if (folder) row.style.paddingLeft = '43px';
    const type = document.createElement('span'); type.className = 'file-icon'; type.textContent = file.path.endsWith('.lua') ? 'Lua' : file.path.endsWith('.json') ? '{ }' : file.text ? '≡' : '▧';
    const label = document.createElement('span'); label.className = 'file-label'; label.textContent = parts.at(-1);
    row.append(type, label); row.title = `${file.path} · ${file.size} байт`;
    row.addEventListener('click', () => execute(async () => {
      if (file.text) await openFile(file.path);
      else { log(`${file.path} · ${file.size} байт. Доступен через opd.assets.read и graphics.image.`); status('Бинарный ассет: ' + file.path); }
    }));
    $('files').append(row);
  }
}
async function openFile(name) {
  if (!project.files.some(f => f.path === name && f.text)) throw new Error('Файл не найден: ' + name);
  if (active) models.get(active).view = editor.saveViewState();
  if (!models.has(name)) {
    const text = await api.read(name);
    const language = name.endsWith('.lua') ? 'lua' : name.endsWith('.json') ? 'json' : 'plaintext';
    const model = monaco.editor.createModel(text, language);
    model.setEOL(monaco.editor.EndOfLineSequence.LF);
    const entry = { model, saved: model.getValue(), disk: text, view: null };
    model.onDidChangeContent(() => { refreshDirty(); monaco.editor.setModelMarkers(model, 'runtime', []); }); models.set(name, entry);
  }
  active = name; const entry = models.get(name); editor.setModel(entry.model);
  if (entry.view) editor.restoreViewState(entry.view);
  $('crumb-file').textContent = name; $('language').textContent = name.endsWith('.lua') ? 'Lua' : name.endsWith('.json') ? 'JSON' : 'Текст';
  renderFiles(); renderTabs(); status(project.root);
}
async function saveAll() {
  for (const [name, entry] of dirtyEntries()) {
    const text = entry.model.getValue(); await api.save(name, text, entry.disk); entry.saved = entry.disk = text;
  }
  refreshDirty(); status('Все файлы сохранены');
}
function modal({ title, message = '', input, buttons = [{ value: 'ok', label: 'Понятно', primary: true }], documentation }) {
  return new Promise(resolve => {
    $('modal-title').textContent = title; $('modal-message').textContent = message;
    $('modal-input').hidden = input === undefined; $('modal-input').value = input || '';
    $('api-text').hidden = !documentation; $('api-text').textContent = documentation || '';
    $('modal-actions').replaceChildren();
    for (const b of buttons) {
      const button = document.createElement('button'); button.value = b.value; button.textContent = b.label; if (b.primary) button.className = 'primary'; $('modal-actions').append(button);
    }
    $('modal').addEventListener('close', () => resolve({ action: $('modal').returnValue, value: $('modal-input').value }), { once: true });
    $('modal').returnValue = 'cancel'; $('modal').showModal();
    if (input !== undefined) $('modal-input').focus();
  });
}
async function confirmChanges() {
  if (!dirtyEntries().length) return true;
  const result = await modal({ title: 'Сохранить изменения?', message: 'В проекте есть изменённый код.', buttons: [{ value: 'cancel', label: 'Вернуться' }, { value: 'discard', label: 'Не сохранять' }, { value: 'save', label: 'Сохранить', primary: true }] });
  if (result.action === 'save') { await saveAll(); return true; }
  return result.action === 'discard';
}
async function closeTab(name) {
  if (models.size === 1) return;
  const entry = models.get(name);
  if (dirty(entry)) {
    const result = await modal({ title: 'Закрыть ' + name + '?', message: 'В файле есть несохранённые изменения.', buttons: [{ value: 'cancel', label: 'Вернуться' }, { value: 'discard', label: 'Не сохранять' }, { value: 'save', label: 'Сохранить', primary: true }] });
    if (result.action === 'save') { const text = entry.model.getValue(); await api.save(name, text, entry.disk); }
    else if (result.action !== 'discard') return;
  }
  if (active === name) { active = null; await openFile([...models.keys()].find(k => k !== name)); }
  models.delete(name); entry.model.dispose(); refreshDirty(); renderFiles();
}
async function applyProject(value) {
  if (!value) return;
  releaseInput(); setState('stopped'); editor.setModel(null); active = null;
  for (const entry of models.values()) entry.model.dispose(); models.clear();
  project = value; $('project-name').textContent = value.manifest.name || 'Мой проект'; $('root-name').textContent = value.root.split(/[\\/]/).at(-1);
  $('hardware-panel').open = value.manifest.kind === 'robot';
  renderFiles(); refreshDirty();
  const first = value.files.find(f => f.path === value.manifest.entry) || value.files.find(f => f.text);
  if (first) await openFile(first.path);
  log(`Открыт проект «${value.manifest.name}»`); status(value.root);
}
async function run() {
  await saveAll(); for (const entry of models.values()) monaco.editor.setModelMarkers(entry.model, 'runtime', []);
  setState('loading');
  try { const info = await api.run(); log(`Запуск «${info.name}» · ${info.fps} fps · Lua 5.4.9`); }
  catch (error) { setState('error'); throw error; }
}
function setKey(key, down) {
  const bit = bits[key]; const next = down ? mask | bit : mask & ~bit;
  if (next === mask) return;
  mask = next; api.input(mask).catch(() => {});
  document.querySelector(`[data-key="${key}"]`)?.classList.toggle('held', down);
  if (key === 'stick') {
    clearTimeout(stickTimer);
    if (down) stickTimer = setTimeout(() => { if (running && !paused) execute(() => api.control('pause')); }, 700);
  }
}
function releaseInput() {
  mask = 0; clearTimeout(stickTimer); api.input(0).catch(() => {});
  document.querySelectorAll('.held').forEach(button => button.classList.remove('held'));
}
function bootPicture() {
  context.fillStyle = '#171e25'; context.fillRect(0, 0, 320, 240);
  context.fillStyle = '#f9c75b'; context.font = 'bold 29px Segoe UI'; context.fillText('openplay', 95, 112);
  context.fillStyle = '#728296'; context.font = '12px Segoe UI'; context.fillText('Здесь оживает твой код', 94, 142);
}
api.onFrame(bytes => {
  if (bytes.length !== 320 * 240 * 2) return;
  for (let i = 0, p = 0; i < bytes.length; i += 2, p += 4) {
    const c = bytes[i] | bytes[i + 1] << 8;
    image.data[p] = Math.round(((c >> 11) & 31) * 255 / 31);
    image.data[p + 1] = Math.round(((c >> 5) & 63) * 255 / 63);
    image.data[p + 2] = Math.round((c & 31) * 255 / 31); image.data[p + 3] = 255;
  }
  context.putImageData(image, 0, 0); frameCount++;
  const elapsed = performance.now() - frameAt;
  if (elapsed >= 1000) { $('fps').textContent = (frameCount * 1000 / elapsed).toFixed(0) + ' fps'; frameCount = 0; frameAt = performance.now(); }
});
api.onEvent(event => {
  switch (event.type) {
    case 'ready': setState('running'); status('Программа работает · нажми на экран для управления'); break;
    case 'paused': setState('paused'); status('Пауза · можно выполнить один кадр'); break;
    case 'resumed': setState('running'); break;
    case 'error': setState('error'); log(event.message, 'error'); status('Ошибка Lua · нажми на сообщение в консоли'); break;
    case 'exit': setState('stopped'); log('Программа завершилась'); break;
    case 'stopped': setState('stopped'); log('Симулятор остановлен'); break;
    case 'closed': if (running) setState('stopped'); break;
    case 'log': log(event.message, 'lua'); break;
    case 'hardware': {
      for (const pin of event.pins) {
        let button = document.querySelector(`[data-pin="${pin.pin}"]`);
        if (!button) {
          button = document.createElement('button'); button.dataset.pin = pin.pin;
          button.addEventListener('click', () => execute(() => api.gpio(pin.pin, !button.classList.contains('high')))); $('pins').append(button);
        }
        const configured = pin.mode !== 0 && pin.mode !== -1;
        button.classList.toggle('high', !!pin.level); button.disabled = pin.mode === 3 || !configured;
        button.title = pin.mode === 3 ? 'Выход: управляется программой' : configured ? 'Нажми, чтобы изменить вход' : 'Вывод не настроен';
        const label = document.createElement('span'); label.textContent = !configured ? '—' : (pin.mode === 3 ? 'OUT ' : 'IN ') + (pin.level ? '1' : '0');
        button.replaceChildren(document.createTextNode(pin.pin), label);
      }
      $('uart-state').textContent = event.uartOpen ? 'открыт' : 'закрыт';
      if (event.tx) log('UART1 TX: ' + event.tx, 'lua');
      break;
    }
  }
});
$('run').onclick = $('restart').onclick = () => execute(run);
$('save').onclick = () => execute(async () => { await saveAll(); log('Все изменения сохранены'); });
$('pause').onclick = () => execute(() => api.control(paused ? 'resume' : 'pause'));
$('step').onclick = () => execute(() => api.control('step'));
$('stop').onclick = () => execute(() => api.control('stop'));
$('open').onclick = () => execute(async () => { if (await confirmChanges()) await applyProject(await api.open()); });
function newProject(template) { return execute(async () => { if (await confirmChanges()) await applyProject(await api.create(template)); }); }
$('new-project').onclick = () => newProject('bouncing-ball'); $('new-robot').onclick = () => newProject('robot-ports');
$('new-file').onclick = () => execute(async () => {
  const result = await modal({ title: 'Новый файл', message: 'Например: player.lua или assets/story.txt', input: 'player.lua', buttons: [{ value: 'cancel', label: 'Отмена' }, { value: 'create', label: 'Создать', primary: true }] });
  if (result.action === 'create') { project.files = await api.newFile(result.value.trim()); renderFiles(); await openFile(result.value.trim()); editor.focus(); }
});
$('export').onclick = () => execute(async () => { await saveAll(); const result = await api.export(); if (result) { log(`${result.path} · ${result.count} файлов · ${result.bytes} байт`, 'build'); status('Бандл .opd готов для загрузки на консоль'); } });
$('api').onclick = () => execute(async () => { await modal({ title: 'OpenPlay · справочник Lua API 1', documentation: await api.api() }); });
$('screenshot').onclick = () => execute(async () => { if (await api.screenshot(screen.toDataURL('image/png'))) log('Снимок экрана сохранён · 320 × 240'); });
$('portal').onclick = () => execute(async () => {
  const result = await modal({ title: 'Подключение консоли', message: '1. На консоли открой «Настройки → Wi-Fi → Настроить с телефона».\n2. Подключись к сети OpenPlay и открой страницу настройки.\n3. Подключи консоль к той же домашней сети, что и компьютер.\n4. Верни компьютер в домашнюю сеть и нажми поиск рядом с «Настоящая консоль».\n\nДля загрузки из Studio нужна прошивка с поддержкой локальной сети. Если поиск заблокирован роутером, введи IP из настроек Wi-Fi консоли вручную. Во время Game Boy загрузка недоступна: сначала выйди из игры.', buttons: [{ value: 'cancel', label: 'Вернуться' }, { value: 'portal', label: 'Открыть настройку Wi-Fi', primary: true }] });
  if (result.action === 'portal') await api.portal();
});
function deviceOptions(selected = '') {
  $('device-list').replaceChildren();
  const placeholder = document.createElement('option'); placeholder.value = '';
  placeholder.textContent = consoleDevices.length ? 'Выбери консоль…' : 'Консоль пока не найдена'; $('device-list').append(placeholder);
  for (const device of consoleDevices) {
    const option = document.createElement('option'); option.value = device.address; option.textContent = `${device.name} · ${device.address}`; $('device-list').append(option);
  }
  $('device-list').value = selected;
}
async function connectDevice(address) {
  consoleDevice = null; updateButtons();
  $('device-status').textContent = 'Подключаемся к консоли…';
  try {
    const device = await api.connect(address); consoleDevice = device;
    consoleDevices = consoleDevices.filter(item => item.id !== device.id && item.address !== device.address); consoleDevices.push(device);
    deviceOptions(device.address); $('device-address').value = device.address;
    $('device-status').textContent = device.storage ? 'На связи. Готова принять и запустить твою программу.' : 'Консоль найдена, но её хранилище недоступно.';
    log(`Консоль ${device.name} · ${device.address}`); return device;
  } catch (error) { $('device-status').textContent = error.message; throw error; }
  finally { updateButtons(); }
}
async function findDevices() {
  if (findingDevices || busy) return;
  const previous = consoleDevice?.address;
  findingDevices = true; consoleDevice = null; updateButtons();
  $('device-status').textContent = 'Ищем консоли в локальной сети…'; $('device-progress').hidden = true;
  try {
    consoleDevices = await api.discover(); deviceOptions();
    const device = consoleDevices.find(item => item.address === previous) || (consoleDevices.length === 1 ? consoleDevices[0] : null);
    if (device) await connectDevice(device.address);
    else $('device-status').textContent = consoleDevices.length ? `Найдено консолей: ${consoleDevices.length}. Выбери нужную.` : 'Не найдена. Проверь общую Wi-Fi сеть и нажми поиск ещё раз или введи IP вручную.';
  } catch (error) { $('device-status').textContent = error.message; log(error.message, 'error'); }
  finally { findingDevices = false; updateButtons(); }
}
$('device-scan').onclick = findDevices;
$('device-list').onchange = () => {
  const address = $('device-list').value;
  if (!address) { consoleDevice = null; updateButtons(); return; }
  execute(() => connectDevice(address));
};
$('device-connect').onclick = () => execute(() => connectDevice($('device-address').value.trim()));
$('device-address').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('device-connect').click(); } });
$('device-send').onclick = () => execute(async () => {
  try {
    await saveAll(); $('device-progress').hidden = false; $('device-progress').value = 0;
    const result = await api.deploy();
    log(`${result.file} → ${result.name} (${result.address}) · ${result.bytes} байт · запущено`, 'build');
    status('Программа загружена и запущена на консоли');
  } catch (error) { $('device-status').textContent = error.message; $('device-progress').hidden = true; throw error; }
});
$('device-quick-send').onclick = () => {
  if (consoleDevice) $('device-send').click();
  else document.querySelector('.device-connection').scrollIntoView({ behavior: 'smooth', block: 'end' });
};
api.onDeployProgress(event => { $('device-progress').value = event.percent; $('device-status').textContent = event.stage; });
$('clear-log').onclick = () => { $('logs').replaceChildren(); $('log-count').textContent = logCount = 0; };
$('uart-form').onsubmit = event => { event.preventDefault(); execute(async () => { await api.uart($('uart-input').value); $('uart-input').value = ''; }); };
for (const button of document.querySelectorAll('[data-key]')) {
  button.addEventListener('pointerdown', event => {
    event.preventDefault(); if (!running || paused) return;
    screen.focus(); button.setPointerCapture(event.pointerId); setKey(button.dataset.key, true);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => setKey(button.dataset.key, false));
}
screen.addEventListener('focus', () => { $('focus-hint').textContent = 'Клавиатура подключена'; $('focus-hint').classList.add('focused'); });
screen.addEventListener('blur', () => { releaseInput(); $('focus-hint').textContent = 'Нажми на экран'; $('focus-hint').classList.remove('focused'); });
window.addEventListener('blur', releaseInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseInput(); });
document.addEventListener('keydown', event => {
  if ($('modal').open) return;
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') { event.preventDefault(); $('save').click(); }
  else if ((event.ctrlKey || event.metaKey) && event.code === 'KeyO') { event.preventDefault(); $('open').click(); }
  else if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'KeyB') { event.preventDefault(); $('export').click(); }
  else if (event.key === 'F5') { event.preventDefault(); (event.shiftKey ? $('stop') : $('run')).click(); }
  else if (event.key === 'F6') { event.preventDefault(); $('device-send').click(); }
  else if (event.key === 'F1') { event.preventDefault(); $('api').click(); }
  else if (document.activeElement === screen && keyboard[event.code] && running && !paused) { event.preventDefault(); setKey(keyboard[event.code], true); }
});
document.addEventListener('keyup', event => { if (keyboard[event.code] && (mask & bits[keyboard[event.code]])) { event.preventDefault(); setKey(keyboard[event.code], false); } });
api.onClosing(() => execute(async () => { if (await confirmChanges()) await api.close(); }));
bootPicture(); updateButtons();
$('modal-input').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); $('modal-actions').querySelector('.primary')?.click(); }
});
require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });
require(['vs/editor/editor.main'], () => {
  monaco.editor.defineTheme('openplay', { base: 'vs-dark', inherit: true, rules: [
    { token: 'comment', foreground: '536578', fontStyle: 'italic' }, { token: 'keyword', foreground: 'C7A4D8' },
    { token: 'string', foreground: 'A6C79A' }, { token: 'number', foreground: 'D5B67C' }, { token: 'identifier', foreground: 'BBC7D8' }
  ], colors: { 'editor.background': '#101318', 'editor.foreground': '#BBC7D8', 'editorLineNumber.foreground': '#354456', 'editorLineNumber.activeForeground': '#9DADBD', 'editor.lineHighlightBackground': '#171E26', 'editor.selectionBackground': '#354354', 'editorCursor.foreground': '#F9C75B', 'editorIndentGuide.background1': '#212C38', 'editorWidget.background': '#1A222D', 'editorWidget.border': '#344151' } });
  $('editor').replaceChildren();
  editor = monaco.editor.create($('editor'), { theme: 'openplay', model: null, fontFamily: '"Cascadia Code", Consolas, monospace', fontSize: 13, lineHeight: 23, tabSize: 4, insertSpaces: true, minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false, padding: { top: 22, bottom: 20 }, lineNumbersMinChars: 4, renderLineHighlight: 'all', smoothScrolling: true, wordWrap: 'off', bracketPairColorization: { enabled: true }, fixedOverflowWidgets: true });
  editor.onDidChangeCursorPosition(event => { $('cursor').textContent = `Стр ${event.position.lineNumber}, стлб ${event.position.column}`; });
  const signatures = {
    'graphics.clear': 'clear(${1:0})', 'graphics.color': 'color(${1:65535})', 'graphics.rgb': 'rgb(${1:255}, ${2:211}, ${3:77})',
    'graphics.pixel': 'pixel(${1:x}, ${2:y})', 'graphics.line': 'line(${1:x1}, ${2:y1}, ${3:x2}, ${4:y2})',
    'graphics.rect': 'rect(${1:x}, ${2:y}, ${3:w}, ${4:h})', 'graphics.fillRect': 'fillRect(${1:x}, ${2:y}, ${3:w}, ${4:h})',
    'graphics.circle': 'circle(${1:x}, ${2:y}, ${3:r})', 'graphics.fillCircle': 'fillCircle(${1:x}, ${2:y}, ${3:r})',
    'graphics.text': 'text("${1:Привет!}", ${2:10}, ${3:10})', 'graphics.image': 'image("${1:assets/picture.opi}", ${2:0}, ${3:0})',
    'input.down': 'down("${1:a}")', 'input.pressed': 'pressed("${1:a}")', 'input.released': 'released("${1:a}")', 'input.axis': 'axis("${1:x}")',
    'system.log': 'log("${1:Привет!}")', 'system.millis': 'millis()', 'system.exit': 'exit()', 'assets.read': 'read("${1:assets/hint.txt}")',
    'gpio.mode': 'mode(${1:16}, "${2:output}")', 'gpio.read': 'read(${1:16})', 'gpio.write': 'write(${1:16}, ${2:true})',
    'uart.open': 'open()', 'uart.available': 'available()', 'uart.read': 'read(${1:256})', 'uart.write': 'write("${1:hello}")'
  };
  monaco.languages.registerCompletionItemProvider('lua', {
    triggerCharacters: ['.'], provideCompletionItems(model, position) {
      const prefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const word = model.getWordUntilPosition(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
      const namespace = prefix.match(/(?:opd\.([a-z]+)|\b(g))\.\w*$/);
      const group = namespace ? namespace[1] || 'graphics' : null;
      return { suggestions: Object.entries(signatures).filter(([key]) => !group || key.startsWith(group + '.')).map(([key, snippet]) => ({ label: group ? key.split('.')[1] : 'opd.' + key, kind: monaco.languages.CompletionItemKind.Function, insertText: group ? snippet : 'opd.' + key.split('.')[0] + '.' + snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range, detail: 'OpenPlay API 1 · ' + key })) };
    }
  });
  execute(async () => { await applyProject(await api.initial()); log('F5 — симулятор · F6 — на консоль · F1 — справочник'); await run(); }).then(findDevices);
}, error => { log('Не удалось открыть редактор: ' + error.message, 'error'); status('Проверь npm install в папке ide'); });
