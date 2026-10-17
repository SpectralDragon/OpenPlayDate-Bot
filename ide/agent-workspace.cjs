const fs = require('node:fs/promises');
const path = require('node:path');
const { scan, projectFile } = require('./sdk.cjs');
async function snapshot(root) {
  const result = new Map();
  for (const entry of await scan(root)) result.set(entry.path, await fs.readFile(await projectFile(root, entry.path)));
  return result;
}
const equal = (a,b) => a === undefined ? b === undefined : b !== undefined && a.equals(b);
async function assertSnapshot(root, expected) {
  const current = await snapshot(root);
  if (current.size !== expected.size || [...expected].some(([name, bytes]) => !equal(bytes,current.get(name))))
    throw new Error('Файлы проекта изменились во время работы агента. Сохрани свою версию и повтори запрос.');
}
async function restore(root, from, to) {
  // Validate every path first. Generated candidates have already passed pack().
  const paths = new Map();
  for (const name of new Set([...from.keys(),...to.keys()])) paths.set(name,await projectFile(root,name,true));
  for (const [name,bytes] of to) {
    if (equal(bytes,from.get(name))) continue;
    const file = paths.get(name); await fs.mkdir(path.dirname(file),{recursive:true});
    const temporary = file + '.agent-' + process.pid;
    try { await fs.writeFile(temporary,bytes,{flag:'wx'}); await fs.rename(temporary,file); }
    finally { await fs.rm(temporary,{force:true}); }
  }
  for (const name of from.keys()) if (!to.has(name)) await fs.rm(paths.get(name));
}
class AgentWorkspace {
  static async create(root, temporaryRoot) {
    const workspace = new AgentWorkspace(); workspace.root = await fs.realpath(root);
    workspace.base = await snapshot(workspace.root);
    workspace.temp = await fs.mkdtemp(path.join(temporaryRoot,'openplay-agent-'));
    workspace.stage = path.join(workspace.temp,'game'); await fs.mkdir(workspace.stage);
    await restore(workspace.stage,new Map(),workspace.base);
    return workspace;
  }
  async preview() {
    this.candidate = await snapshot(this.stage);
    return [...new Set([...this.base.keys(),...this.candidate.keys()])].sort().filter(name=>!equal(this.base.get(name),this.candidate.get(name))).map(name=>({
      path:name, kind:!this.base.has(name)?'added':!this.candidate.has(name)?'deleted':'changed',
      binary:!(/\.(lua|json|txt|md|csv|glsl)$/i.test(name)),
      before:this.base.get(name)?.toString('utf8') || '', after:this.candidate.get(name)?.toString('utf8') || ''
    }));
  }
  async apply() {
    if (!this.candidate || this.applied) throw new Error('Нет подготовленных изменений');
    await assertSnapshot(this.root,this.base);
    try { await restore(this.root,this.base,this.candidate); this.applied=true; }
    catch (error) { await restore(this.root,await snapshot(this.root),this.base); throw error; }
  }
  async undo() {
    if (!this.applied) throw new Error('Нечего отменять');
    await assertSnapshot(this.root,this.candidate);
    await restore(this.root,this.candidate,this.base); this.applied=false;
  }
  async dispose() { if (this.temp) await fs.rm(this.temp,{recursive:true,force:true}); }
}
module.exports = { AgentWorkspace, snapshot };
