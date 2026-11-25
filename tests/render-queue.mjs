import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutline-queue-'));
const userData = path.join(tmp, 'userdata');
fs.mkdirSync(userData);
const output = path.join(tmp, 'queue.webm');
const app = await electron.launch({ args: ['.', '--no-sandbox', '--disable-gpu'], cwd: process.cwd(), env: { ...process.env, DISPLAY: process.env.DISPLAY || ':99', CUTLINE_USER_DATA: userData, CUTLINE_TEST: '1', CUTLINE_SOFTWARE: '1', ELECTRON_DISABLE_SANDBOX: '1' } });
const win = await app.firstWindow();
await win.waitForSelector('.app', { timeout: 30000 });
await win.evaluate((file) => window.__cutlineDesktop.importPaths([file]), path.resolve('tests/fixtures/source-av.webm'));
await win.waitForFunction(() => document.querySelectorAll('.clip').length >= 1, null, { timeout: 60000 });
await win.waitForTimeout(700);
const data = await win.evaluate(() => {
  const s = window.__cutline.getState();
  return {
    format: 'cutline-project', version: 1, project: s.project,
    assets: Object.values(s.assets).map((a) => ({ id: a.id, name: a.name, kind: a.kind, duration: a.duration, fps: a.fps, width: a.width, height: a.height, hasAudio: a.hasAudio, path: a.path, thumbnail: a.thumbnail, peaks: a.peaks })),
  };
});
const added = await win.evaluate(({ data, output }) => window.cutlineDesktop.queueAdd(data, { width: 640, height: 360, fps: 24, quality: 'balanced', format: 'webm', includeAudio: true }, output), { data, output });
console.log('queued:', JSON.stringify(added));
let job = null;
for (let i = 0; i < 120; i++) {
  const list = await win.evaluate(() => window.cutlineDesktop.queueList());
  job = list.find((j) => j.id === added.id);
  if (job?.status === 'done' || job?.status === 'error') break;
  await win.waitForTimeout(250);
}
const streams = fs.existsSync(output) ? require('node:child_process').spawnSync(ffmpeg, ['-i', output], { encoding: 'utf8' }).stderr.split('\n').filter((l) => l.includes('Stream #')).join(' | ') : '';
console.log('job:', JSON.stringify(job));
console.log('streams:', streams);
const ok = job?.status === 'done' && /Video: vp9/.test(streams) && /Audio: opus/.test(streams);
await win.evaluate(() => window.__cutline.getState().setQueueOpen(true));
await win.waitForSelector('.queue-modal');
await win.waitForSelector('.queue-job', { timeout: 10000 });
await win.waitForTimeout(400);
const queueText = await win.locator('.queue-modal').innerText();
console.log('queue ui:', queueText);
await win.screenshot({ path: 'test-results/desktop-queue.png' });
console.log('ui flags', queueText.includes('640×360'), queueText.toLowerCase().includes('done'), queueText.includes('Add current project'));
const uiOk = queueText.includes('640×360') && queueText.toLowerCase().includes('done') && queueText.includes('Add current project');
if (!uiOk) { console.error('queue UI check failed'); process.exit(1); }
await app.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(ok ? 'RENDER QUEUE OK' : 'RENDER QUEUE FAILED');
process.exit(ok ? 0 : 1);
