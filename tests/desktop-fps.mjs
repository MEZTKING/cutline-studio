import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cutline-fps-'));
const env = {
  ...process.env,
  DISPLAY: process.env.DISPLAY || ':99',
  CUTLINE_USER_DATA: userData,
  CUTLINE_TEST: '1',
  CUTLINE_SOFTWARE: '1',
  ELECTRON_DISABLE_SANDBOX: '1',
};
const app = await electron.launch({ args: ['.', '--no-sandbox', '--disable-gpu'], cwd: process.cwd(), env });
const win = await app.firstWindow();
await win.waitForSelector('.app', { timeout: 30000 });
const result = await win.evaluate((file) => window.__cutlineDesktop.importPaths([file]), path.resolve('tests/fixtures/source-24fps.webm'));
await win.waitForFunction(() => document.querySelectorAll('.clip').length >= 1, null, { timeout: 60000 });
await win.waitForTimeout(1200);
const state = await win.evaluate(() => {
  const s = window.__cutline.getState();
  const video = Object.values(s.assets).find((a) => a.kind === 'video');
  return {
    w: s.project.width, h: s.project.height, fps: s.project.fps, auto: s.project.autoSettings,
    assetFps: video?.fps, source: video?.name, toast: document.querySelector('.toast')?.innerText ?? '',
  };
});
console.log('desktop import:', JSON.stringify(result));
console.log('desktop state:', JSON.stringify(state));
const ok = state.w === 960 && state.h === 540 && state.assetFps === 24 && state.fps === 24 && state.auto === true;
await win.screenshot({ path: 'test-results/desktop-auto-project.png' });
await app.close();
fs.rmSync(userData, { recursive: true, force: true });
console.log(ok ? 'DESKTOP AUTO-PROJECT OK' : 'DESKTOP AUTO-PROJECT FAILED');
process.exit(ok ? 0 : 1);
