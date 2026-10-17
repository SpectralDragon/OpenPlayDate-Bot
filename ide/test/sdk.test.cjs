const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pack, projectFile, validateManifest } = require('../sdk.cjs');
const root = path.resolve(__dirname, '../..');

test('OPD bytes match the existing Python SDK for both bundled projects', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'openplay-pack-'));
  try {
    for (const name of ['bouncing-ball', 'robot-ports']) {
      const output = path.join(temp, name + '.opd');
      execFileSync('python', [path.join(root, 'tools/opd.py'), 'pack', path.join(root, 'examples', name), output]);
      const result = await pack(path.join(root, 'examples', name));
      assert.deepEqual(result.data, await fs.readFile(output));
    }
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
test('Reject traversal, missing entry, permissions conflicts, and oversized sources', async () => {
  await assert.rejects(projectFile(root, '../README.md'), /путь/);
  await assert.rejects(projectFile(root, 'C:/Windows/win.ini'), /путь/);
  const m = { api: 1, id: 'test', name: 'Тест', kind: 'game', entry: 'main.lua' };
  assert.throws(() => validateManifest({ ...m, permissions: { gpio: [16] } }), /robot/);
  assert.throws(() => validateManifest({ ...m, kind: 'robot', permissions: { gpio: [16], uart: { port: 1, tx: 16, rx: 18, baud: 9600 } } }), /Конфликт/);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'openplay-invalid-'));
  try {
    await fs.writeFile(path.join(temp, 'manifest.json'), JSON.stringify(m));
    await fs.writeFile(path.join(temp, 'other.lua'), 'return {}');
    await assert.rejects(pack(temp), /entry/);
    await fs.writeFile(path.join(temp, 'main.lua'), 'x'.repeat(65537));
    await assert.rejects(pack(temp), /64 КиБ/);
    await fs.rm(path.join(temp, 'main.lua')); await fs.symlink(path.join(root, 'README.md'), path.join(temp, 'main.lua'));
    await assert.rejects(pack(temp), /ссылк/);
    await assert.rejects(projectFile(temp, 'main.lua'), /ссылк/);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
