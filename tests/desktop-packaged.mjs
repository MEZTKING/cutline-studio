import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cutline-packaged-'));
const executablePath = path.resolve('release/linux-arm64-unpacked/cutline-studio');
const app = await electron.launch({
  executablePath,
  args: ['--no-sandbox', '--disable-gpu'],
  env: { ...process.env, DISPLAY: process.env.DISPLAY || ':99', CUTLINE_USER_DATA: userData, CUTLINE_SOFTWARE: '1', ELECTRON_DISABLE_SANDBOX: '1' },
});
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForSelector('.app', { timeout: 30000 });
await win.waitForTimeout(1200);
const info = await win.evaluate(() => window.cutlineDesktop.info());
console.log('packaged:', JSON.stringify({ version: info.version, packaged: info.isPackaged, ffmpeg: info.ffmpeg, exists: fs.existsSync(info.ffmpeg || '') }));
await win.evaluate((paths) => window.__cutlineDesktop.importPaths(paths), [
  path.resolve('tests/fixtures/face-public.jpg'),
  path.resolve('test-results/export-test.webm'),
]);
await win.waitForFunction(() => document.querySelectorAll('.clip').length >= 2, null, { timeout: 60000 });
await win.waitForTimeout(1000);
const state = await win.evaluate(() => ({
  clips: document.querySelectorAll('.clip').length,
  media: Object.values(window.__cutline.getState().assets).map((a) => ({ kind: a.kind, url: a.url, audio: !!a.audioBuffer })),
}));
console.log('state:', JSON.stringify(state));
await win.screenshot({ path: 'test-results/desktop-packaged.png' });
fs.writeFileSync('test-results/desktop-packaged.json', JSON.stringify({ info, state, errors }, null, 2));
const ok = state.clips >= 2 && info.isPackaged && fs.existsSync(info.ffmpeg || '') && errors.length === 0 && state.media.every((m) => m.url.startsWith('cutline-media://'));
console.log(ok ? 'PACKAGED APP OK' : 'PACKAGED APP FAILED');
await app.close();
process.exit(ok ? 0 : 1);
