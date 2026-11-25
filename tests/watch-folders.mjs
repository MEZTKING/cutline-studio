import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutline-watch-'));
const userData = path.join(tmp, 'userdata');
const watchDir = path.join(tmp, 'watched');
fs.mkdirSync(userData);
fs.mkdirSync(watchDir);
const app = await electron.launch({ args: ['.', '--no-sandbox', '--disable-gpu'], cwd: process.cwd(), env: { ...process.env, DISPLAY: process.env.DISPLAY || ':99', CUTLINE_USER_DATA: userData, CUTLINE_TEST: '1', CUTLINE_SOFTWARE: '1', ELECTRON_DISABLE_SANDBOX: '1' } });
const win = await app.firstWindow();
await win.waitForSelector('.app', { timeout: 30000 });
const preset = { label: 'YouTube · 1080p', width: 640, height: 360, fps: 24, quality: 'balanced' };
const added = await win.evaluate(({ preset, watchDir }) => window.cutlineDesktop.watchAdd(preset, watchDir), { preset, watchDir });
console.log('watch:', JSON.stringify(added));
const assetPath = path.resolve('tests/fixtures/source-av.webm');
const project = {
  format: 'cutline-project', version: 1,
  project: { id: 'prj_watch', name: 'Watched Project', width: 960, height: 540, fps: 30, autoSettings: false, tracks: [
    { id: 'v', kind: 'video', name: 'V1', muted: false, hidden: false, locked: false, clips: [{ id: 'c', assetId: 'a', name: 'source', start: 0, duration: 1.5, inPoint: 0, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, fadeCurve: 'linear', pan: 0, eqLow: 0, eqMid: 0, eqHigh: 0, compress: 0, muted: false, audioType: null, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, color: { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0, temperature: 0, vignette: 0 }, transition: null, keyframes: {} }] },
    { id: 'a', kind: 'audio', name: 'A1', muted: false, hidden: false, locked: false, clips: [] },
  ] },
  assets: [{ id: 'a', name: 'source', kind: 'video', duration: 4, width: 960, height: 540, hasAudio: true, path: assetPath }],
};
fs.writeFileSync(path.join(watchDir, 'incoming.cutline'), JSON.stringify(project));
let job = null;
for (let i = 0; i < 100; i++) {
  const list = await win.evaluate(() => window.cutlineDesktop.queueList());
  job = list[0];
  if (job?.status === 'done' || job?.status === 'error') break;
  await win.waitForTimeout(500);
}
const output = path.join(watchDir, 'renders', 'Watched Project.webm');
const streams = fs.existsSync(output) ? require('node:child_process').spawnSync(ffmpeg, ['-i', output], { encoding: 'utf8' }).stderr.split('\n').filter((l) => l.includes('Stream #')).join(' | ') : '';
const watches = await win.evaluate(() => window.cutlineDesktop.watchList());
console.log('job:', JSON.stringify(job));
console.log('output:', output, fs.existsSync(output), streams);
await win.evaluate(() => window.__cutline.getState().setQueueOpen(true));
await win.waitForSelector('.queue-modal');
await win.waitForTimeout(400);
const ui = await win.locator('.queue-modal').innerText();
await win.screenshot({ path: 'test-results/desktop-watch.png' });
const ok = added?.id && job?.status === 'done' && /Audio: opus/.test(streams) && watches.length === 1 && ui.includes('Watch folders') && ui.includes('Watched Project');
if (watches.length) await win.evaluate((id) => window.cutlineDesktop.watchRemove(id), watches[0].id);
await app.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(ok ? 'WATCH FOLDERS OK' : 'WATCH FOLDERS FAILED');
process.exit(ok ? 0 : 1);
