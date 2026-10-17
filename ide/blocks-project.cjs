const fs = require('node:fs/promises');
const path = require('node:path');
const { SOURCE, compile } = require('./blocks.cjs');
// sdk imports this lazily while packing, so this module can reuse its path checks.
const projectPath = (...args) => require('./sdk.cjs').projectFile(...args);
async function readBlocks(root, entry) {
  const source = await projectPath(root, SOURCE, true);
  let raw;
  try {
    if ((await fs.stat(source)).size > 524288) throw new Error('Проект блоков больше 512 КиБ');
    raw = await fs.readFile(source, 'utf8');
  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  if (Buffer.byteLength(raw) > 524288) throw new Error('Проект блоков больше 512 КиБ');
  if (entry !== 'main.lua') throw new Error('Проект блоков должен запускаться из main.lua');
  const document = JSON.parse(raw), generated = compile(document);
  const lua = await fs.readFile(await projectPath(root, 'main.lua'), 'utf8');
  const needsBuild=lua!==generated;
  let legacyMatches=false;
  if(needsBuild){try{legacyMatches=lua===require('./blocks-v1.cjs').compile(document);}catch{/* New media blocks cannot be an old v1 project. */}}
  if (needsBuild && !legacyMatches) throw new Error('main.lua изменён отдельно от блоков. Сохрани копию кода и восстанови сгенерированный файл перед открытием блоков.');
  return { document, raw, lua, needsBuild };
}
const saving = new Set();
async function saveBlocks(root, document, expected, expectedLua) {
  if (saving.has(root)) throw new Error('Блоки уже сохраняются');
  saving.add(root);
  const temps = [];
  try {
    const raw = JSON.stringify(document, null, 2) + '\n', lua = compile(document);
    if (Buffer.byteLength(raw) > 524288 || Buffer.byteLength(lua) > 65536) throw new Error('Слишком большая игра из блоков');
    const source = await projectPath(root, SOURCE), main = await projectPath(root, 'main.lua');
    if (await fs.readFile(source, 'utf8') !== expected || await fs.readFile(main, 'utf8') !== expectedLua) throw new Error('Блоки или Lua изменены другой программой. Сначала открой проект заново.');
    for (const [file, content] of [[main, lua], [source, raw]]) {
      const temp = file + '.studio-tmp-' + process.pid; temps.push(temp);
      await fs.writeFile(temp, content, { flag:'wx' });
    }
    await fs.rename(temps[0], main);
    try { await fs.rename(temps[1], source); }
    catch (error) { await fs.writeFile(main, expectedLua); throw error; }
    return { raw, lua };
  } finally { await Promise.all(temps.map(file => fs.rm(file, {force:true}))); saving.delete(root); }
}
module.exports = { readBlocks, saveBlocks };
