import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cutline-autosave-'));
const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':99', CUTLINE_USER_DATA: userData, CUTLINE_SOFTWARE: '1', ELECTRON_DISABLE_SANDBOX: '1' };
const app = await electron.launch({ args: ['.', '--no-sandbox', '--disable-gpu'], cwd: process.cwd(), env });
const win = await app.firstWindow();
await win.waitForSelector('.app');
await win.evaluate((paths) => window.__cutlineDesktop.importPaths(paths), [path.resolve('tests/fixtures/face-public.jpg')]);
await win.waitForFunction(() => document.querySelectorAll('.clip').length >= 1, null, { timeout: 30000 });
await win.waitForTimeout(2500);
const autoPath = path.join(userData, 'autosave.cutline');
const auto = fs.existsSync(autoPath) ? JSON.parse(fs.readFileSync(autoPath, 'utf8')) : null;
console.log('autosave:', Boolean(auto), auto?.project?.tracks?.flatMap((t) => t.clips).length);
await app.close();
const app2 = await electron.launch({ args: ['.', '--no-sandbox', '--disable-gpu'], cwd: process.cwd(), env });
const win2 = await app2.firstWindow();
await win2.waitForSelector('.app', { timeout: 30000 });
await win2.waitForTimeout(2200);
const state = await win2.evaluate(() => ({
  clips: document.querySelectorAll('.clip').length,
  assets: Object.keys(window.__cutline.getState().assets).length,
  toast: document.querySelector('.toast')?.innerText ?? '',
}));
console.log('restored:', JSON.stringify(state));
await win2.screenshot({ path: 'test-results/desktop-autosave.png' });
await app2.close();
const ok = Boolean(auto) && auto.project.tracks.flatMap((t) => t.clips).length >= 1 && state.clips >= 1 && state.assets >= 1 && state.toast.includes('Recovered');
console.log(ok ? 'AUTOSAVE RECOVERY OK' : 'AUTOSAVE RECOVERY FAILED');
process.exit(ok ? 0 : 1);
