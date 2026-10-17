const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const root = path.resolve(__dirname, '..');
  const native = path.join(__dirname, 'native/build/openplay-simulator.exe');
  await fs.access(native);
  for (const name of ['examples', 'docs/lua-api.md', 'lib/Lua/LICENSE']) {
    const target = path.join(__dirname, 'resources', name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(path.join(root, name), target, { recursive: true });
  }
  const { packager } = await import('@electron/packager');
  console.log('Packaging Windows app…');
  const results = await packager({ dir: __dirname, name: 'OpenPlay-Studio', platform: 'win32', arch: 'x64', out: path.join(__dirname, 'dist'), overwrite: true,
    electronZipDir: process.env.ELECTRON_ZIP_DIR,
    executableName: 'OpenPlay-Studio', appVersion: '0.1.0', prune: true, asar: false,
    ignore: [/^\/test(?:\/|$)/, /^\/dist(?:\/|$)/, /^\/native\/build\/.*\.o$/, /^\/native\/.*\.(cpp|h|py)$/],
    win32metadata: { CompanyName: 'OpenPlay', FileDescription: 'OpenPlay Studio — Lua IDE & Simulator', ProductName: 'OpenPlay Studio' } });
  console.log('Portable app: ' + results.join(', '));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
