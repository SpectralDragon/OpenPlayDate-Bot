const fs = require('node:fs/promises');
const path = require('node:path');
const LIMIT = 2 * 1024 * 1024;
const safePath = p => typeof p === 'string' && p.length <= 96 && /^[A-Za-z0-9_./-]+$/.test(p) && p.split('/').every(s => s && s !== '.' && s !== '..');
const check = (ok, message) => { if (!ok) throw new Error(message); };
function validateManifest(m) {
  check(m && typeof m === 'object' && !Array.isArray(m), 'Манифест должен быть объектом JSON');
  check(m.api === 1, 'Поддерживается api: 1');
  check(typeof m.id === 'string' && /^[a-z0-9_-]{1,40}$/.test(m.id), 'id: 1–40 символов a-z, 0-9, _ или -');
  check(typeof m.name === 'string' && Buffer.byteLength(m.name) >= 1 && Buffer.byteLength(m.name) <= 80 && !/[\x00-\x1f]/.test(m.name), 'Название: 1–80 байт UTF-8');
  check(['game', 'robot'].includes(m.kind), 'kind должен быть game или robot');
  check(safePath(m.entry) && m.entry.endsWith('.lua'), 'entry должен указывать на Lua-файл');
  check(m.fps === undefined || (Number.isInteger(m.fps) && m.fps >= 1 && m.fps <= 60), 'fps: целое число от 1 до 60');
  const p = m.permissions ?? {};
  check(p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).every(k => ['gpio', 'uart'].includes(k)), 'Неизвестные разрешения');
  const pins = p.gpio ?? [], allowed = [1, 2, 16, 17, 18, 21];
  check(Array.isArray(pins) && pins.length <= 6 && pins.every(n => Number.isInteger(n) && allowed.includes(n)) && new Set(pins).size === pins.length, 'Неверный список GPIO');
  if (p.uart !== undefined) {
    const u = p.uart;
    check(u && u.port === 1 && Number.isInteger(u.baud) && u.baud >= 300 && u.baud <= 115200, 'UART1: скорость 300–115200');
    check([u.tx, u.rx].every(n => Number.isInteger(n) && allowed.includes(n) && !pins.includes(n)) && u.tx !== u.rx, 'Конфликт выводов UART/GPIO');
  }
  check(m.kind === 'robot' || (!pins.length && p.uart === undefined), 'Порты доступны только kind: robot');
  return m;
}
async function projectFile(root, relative, create = false) {
  check(safePath(relative), 'Недопустимый путь файла');
  const base = await fs.realpath(root);
  let current = base;
  const parts = relative.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try { check(!(await fs.lstat(current)).isSymbolicLink(), 'Символические ссылки не поддерживаются'); }
    catch (e) { if (!(create && e.code === 'ENOENT')) throw e; }
  }
  return current;
}
async function scan(root) {
  const files = []; let size = 0;
  async function walk(dir, prefix = '') {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const name = prefix + entry.name;
      check(safePath(name), `Недопустимое имя: ${name}`);
      check(!entry.isSymbolicLink(), `Символическая ссылка: ${name}`);
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), name + '/');
      else if (entry.isFile()) {
        const stat = await fs.stat(path.join(dir, entry.name)); size += stat.size;
        check(size <= LIMIT + 4096 && files.length < 65, 'Проект: до 2 МиБ и 64 файлов + манифест');
        files.push({ path: name, size: stat.size, text: /\.(lua|json|txt|md|csv|glsl)$/i.test(name) });
      }
    }
  }
  await walk(root); return files;
}
// Sort JSON keys recursively, matching tools/opd.py's deterministic format.
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
async function pack(root) {
  const files = await scan(root);
  const rawManifest = await fs.readFile(await projectFile(root, 'manifest.json'), 'utf8');
  check(Buffer.byteLength(rawManifest) <= 4096, 'Манифест больше 4096 байт');
  const manifest = validateManifest(JSON.parse(rawManifest));
  const blocks = await require('./blocks-project.cjs').readBlocks(root, manifest.entry);
  check(!blocks?.needsBuild,'Открой проект в Studio и сохрани его, чтобы обновить сборку блоков');
  const raw = Buffer.from(JSON.stringify(canonical(manifest)));
  const entries = files.filter(f => f.path !== 'manifest.json').sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  check(entries.length >= 1 && entries.length <= 64 && entries.some(f => f.path === manifest.entry), 'Не найден entry или неверное число файлов');
  const header = Buffer.alloc(12); header.write('OPD1'); header.writeUInt32LE(raw.length, 4); header.writeUInt32LE(entries.length, 8);
  const chunks = [header, raw]; let imageVersion=1;
  for (const file of entries) {
    const data = await fs.readFile(await projectFile(root, file.path));
    if(file.path.endsWith('.opi')&&data.subarray(0,4).toString()==='OPI2')imageVersion=2;
    if (file.path.endsWith('.lua')) check(data.length >= 1 && data.length <= 65536 && data[0] !== 27, `${file.path}: нужен исходный Lua, до 64 КиБ`);
    const name = Buffer.from(file.path); const record = Buffer.alloc(6);
    record.writeUInt16LE(name.length); record.writeUInt32LE(data.length, 2);
    chunks.push(record, name, data);
  }
  const data = Buffer.concat(chunks); check(data.length <= LIMIT, 'Бандл больше 2 МиБ');
  return { data, manifest, count: entries.length, imageVersion };
}
module.exports = { pack, scan, projectFile, validateManifest, safePath };
