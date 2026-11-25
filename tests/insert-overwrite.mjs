import { chromium } from 'playwright-core';
import path from 'node:path';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app');
await page.setInputFiles('input[type=file]', path.resolve('tests/fixtures/source-av.webm'));
await page.waitForFunction(() => document.querySelectorAll('.clip').length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(800);
const setup = await page.evaluate(() => {
  const s = window.__cutline.getState();
  const track = s.project.tracks.find((t) => t.kind === 'video');
  const asset = Object.values(s.assets).find((a) => a.kind === 'video');
  s.updateClip(track.clips[0].id, { duration: 2 });
  s.addClipToTrack(track.id, asset, 2, 2);
  s.addClipToTrack(track.id, asset, 4, 2);
  return { trackId: track.id, assetId: asset.id };
});
await page.waitForTimeout(300);
const insertId = await page.evaluate(({ trackId, assetId }) => {
  const s = window.__cutline.getState();
  return s.insertClipToTrack(trackId, s.assets[assetId], 1, 1);
}, setup);
const insert = await page.evaluate((trackId) => {
  const s = window.__cutline.getState();
  return { newId: s.selection.clipId, clips: s.project.tracks.find((t) => t.id === trackId).clips.map((c) => ({ id: c.id, start: +c.start.toFixed(3), dur: +c.duration.toFixed(3), inPoint: +c.inPoint.toFixed(3) })) };
}, setup.trackId);
insert.newId = insertId;
console.log('insert:', JSON.stringify(insert));
check('insert adds a clip at the edit point', insert.clips.some((c) => c.id === insert.newId && c.start === 1 && c.dur === 1));
check('insert splits the spanning clip', insert.clips.some((c) => c.start === 0 && c.dur === 1) && insert.clips.some((c) => c.start === 2 && c.dur === 1));
check('insert ripples later clips right', insert.clips.some((c) => c.start === 3) && insert.clips.some((c) => c.start === 5));
check('insert leaves no overlaps', insert.clips.every((c, i) => i === 0 || insert.clips[i - 1].start + insert.clips[i - 1].dur <= c.start + 0.001));
const overwriteId = await page.evaluate(({ trackId, assetId }) => {
  const s = window.__cutline.getState();
  return s.overwriteClipToTrack(trackId, s.assets[assetId], 0.5, 1);
}, setup);
const overwrite = await page.evaluate((trackId) => {
  const s = window.__cutline.getState();
  return { newId: s.selection.clipId, clips: s.project.tracks.find((t) => t.id === trackId).clips.map((c) => ({ id: c.id, start: +c.start.toFixed(3), dur: +c.duration.toFixed(3), inPoint: +c.inPoint.toFixed(3) })) };
}, setup.trackId);
overwrite.newId = overwriteId;
console.log('overwrite:', JSON.stringify(overwrite));
check('overwrite places the clip at the drop point', overwrite.clips.some((c) => c.id === overwrite.newId && c.start === 0.5 && c.dur === 1));
check('overwrite trims both sides of a covered edit', overwrite.clips.some((c) => c.start === 0 && c.dur === 0.5) && overwrite.clips.some((c) => c.start === 1.5 && c.dur === 0.5));
check('overwrite leaves no overlaps', overwrite.clips.every((c, i) => i === 0 || overwrite.clips[i - 1].start + overwrite.clips[i - 1].dur <= c.start + 0.001));
check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await page.evaluate(() => window.__cutline.getState().setQueueOpen(true));
await page.evaluate(() => window.__cutline.getState().setQueueOpen(false));
await page.screenshot({ path: 'test-results/desktop-insert-overwrite.png' });
await browser.close();
console.log(checks.every((c) => c.ok) ? 'INSERT/OVERWRITE OK' : 'INSERT/OVERWRITE FAILED');
process.exit(checks.every((c) => c.ok) ? 0 : 1);
