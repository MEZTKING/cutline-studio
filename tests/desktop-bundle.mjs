import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutline-bundle-e2e-'));
const userData = path.join(tmp, 'userdata');
fs.mkdirSync(userData);
const bundle = path.join(tmp, 'Portable.cutlinebundle');
const app = await electron.launch({
  args: ['.', '--no-sandbox', '--disable-gpu'],
  cwd: process.cwd(),
  env: { ...process.env, DISPLAY: process.env.DISPLAY || ':99', CUTLINE_USER_DATA: userData, CUTLINE_TEST: '1', CUTLINE_SOFTWARE: '1', ELECTRON_DISABLE_SANDBOX: '1' },
});
const win = await app.firstWindow();
await win.waitForSelector('.app', { timeout: 30000 });
await win.evaluate((file) => window.__cutlineDesktop.importPaths([file]), path.resolve('tests/fixtures/source-av.webm'));
await win.waitForFunction(() => document.querySelectorAll('.clip').length >= 1, null, { timeout: 60000 });
await win.waitForTimeout(800);
const data = await win.evaluate(() => {
  const s = window.__cutline.getState();
  const assets = Object.values(s.assets).map((a) => ({
    id: a.id, name: a.name, kind: a.kind, duration: a.duration, fps: a.fps,
    width: a.width, height: a.height, hasAudio: a.hasAudio, path: a.path,
    thumbnail: a.thumbnail, peaks: a.peaks,
  }));
  return { format: 'cutline-project', version: 1, project: s.project, assets };
});
const saved = await win.evaluate(({ data, bundle }) => window.cutlineDesktop.saveBundleTo(data, bundle), { data, bundle });
console.log('saved:', JSON.stringify(saved));
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
check('bundle folder created', fs.existsSync(bundle));
check('media copied into bundle', fs.existsSync(path.join(bundle, 'media', 'source-av.webm')));
check('manifest written', JSON.parse(fs.readFileSync(path.join(bundle, 'bundle.json'), 'utf8')).format === 'cutline-bundle');
const stored = JSON.parse(fs.readFileSync(path.join(bundle, 'project.cutline'), 'utf8'));
check('project stores relative paths', stored.assets.every((a) => !path.isAbsolute(a.path)) && stored.assets[0].path.startsWith('media/'), stored.assets[0]?.path);
const moved = path.join(tmp, 'Moved.cutlinebundle');
fs.renameSync(bundle, moved);
const opened = await win.evaluate((root) => window.cutlineDesktop.openBundlePath(root), moved);
check('moved bundle opens', !opened.error && opened.bundleRoot === moved, JSON.stringify(opened?.error));
check('opened paths resolve inside moved bundle', opened.data.assets[0].path.startsWith(moved) && fs.existsSync(opened.data.assets[0].path), opened.data.assets[0].path);
check('no missing media', opened.missing.length === 0);
await win.screenshot({ path: 'test-results/desktop-bundle.png' });
await app.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(checks.every((c) => c.ok) ? 'BUNDLE E2E OK' : 'BUNDLE E2E FAILED');
process.exit(checks.every((c) => c.ok) ? 0 : 1);
