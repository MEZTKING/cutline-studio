import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const OUT = 'test-results';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app');
await page.setInputFiles('input[type=file]', path.resolve('tests/fixtures/source-av.webm'));
await page.waitForFunction(() => document.querySelectorAll('.clip').length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1200);

console.log('\n[1] Detach audio + linked move');
const head = page.locator('.section-head').filter({ hasText: 'Audio & Speed' });
if ((await head.count()) && (await head.getAttribute('class'))?.includes('collapsed')) await head.click();
await page.locator('button', { hasText: 'Detach audio' }).click();
await page.waitForTimeout(500);
let clips = await page.evaluate(() => {
  const s = window.__cutline.getState();
  const videoTrack = s.project.tracks.find((t) => t.kind === 'video');
  const audioTrack = s.project.tracks.find((t) => t.kind === 'audio');
  const video = videoTrack.clips[0];
  const audio = audioTrack.clips[0];
  return {
    video: { id: video.id, start: video.start, dur: video.duration, inPoint: video.inPoint, muted: video.muted, detached: video.audioDetached, link: video.linkId },
    audio: { id: audio.id, start: audio.start, dur: audio.duration, inPoint: audio.inPoint, link: audio.linkId },
    videoTrack: videoTrack.id, audioTrack: audioTrack.id,
    selection: s.selection.clipId,
  };
});
check('audio clip created on the audio track', Boolean(clips.audio) && clips.audioTrack);
check('video audio marked detached and muted', clips.video.detached === true && clips.video.muted === true);
check('A/V share a link', Boolean(clips.video.link) && clips.video.link === clips.audio.link);
check('audio starts with the picture', Math.abs(clips.video.start - clips.audio.start) < 0.01);
check('audio clip is selected after detach', clips.selection === clips.audio.id);

await page.evaluate(({ videoId, trackId, start }) => window.__cutline.getState().moveClip(videoId, trackId, start + 1), { videoId: clips.video.id, trackId: clips.videoTrack, start: clips.video.start });
await page.waitForTimeout(400);
let moved = await page.evaluate(() => {
  const s = window.__cutline.getState();
  const v = s.project.tracks.find((t) => t.kind === 'video').clips[0];
  const a = s.project.tracks.find((t) => t.kind === 'audio').clips[0];
  return { v: v.start, a: a.start };
});
check('linked audio moves with the video', Math.abs(moved.v - (clips.video.start + 1)) < 0.01 && Math.abs(moved.a - moved.v) < 0.01, JSON.stringify(moved));

console.log('\n[2] Independent trim (J/L cut)');
await page.evaluate(({ id, start, dur, ip }) => window.__cutline.getState().updateClip(id, { start: start + 0.4, duration: dur - 0.4, inPoint: ip + 0.4 }), { id: clips.audio.id, start: moved.a, dur: clips.audio.dur, ip: clips.audio.inPoint });
await page.waitForTimeout(400);
const jl = await page.evaluate(() => {
  const s = window.__cutline.getState();
  const v = s.project.tracks.find((t) => t.kind === 'video').clips[0];
  const a = s.project.tracks.find((t) => t.kind === 'audio').clips[0];
  return { v: v.start, a: a.start, vDur: v.duration, aDur: a.duration };
});
check('audio can be trimmed off the picture', jl.a > jl.v + 0.3 && jl.aDur < clips.audio.dur - 0.3, JSON.stringify(jl));

console.log('\n[3] Roll and slip');
await page.evaluate(({ id }) => window.__cutline.getState().updateClip(id, { inPoint: 0.5, duration: 3 }), { id: clips.video.id });
await page.waitForTimeout(300);
const add = await page.evaluate(({ trackId, assetId, start }) => {
  const s = window.__cutline.getState();
  const asset = s.assets[assetId];
  const id = s.addClipToTrack(trackId, asset, start);
  if (id) s.updateClip(id, { duration: 3 });
  return id;
}, { trackId: clips.videoTrack, assetId: Object.values((await page.evaluate(() => window.__cutline.getState().assets)))[0].id, start: moved.v + 3 });
await page.waitForTimeout(500);
check('second adjacent clip added', Boolean(add));
let beforeRoll = await page.evaluate(() => {
  const s = window.__cutline.getState();
  const clips = s.project.tracks.find((t) => t.kind === 'video').clips;
  return clips.map((c) => ({ start: c.start, dur: c.duration, inPoint: c.inPoint }));
});
const row = page.locator('.track-row.video');
await row.hover();
const handle = page.locator('.roll-handle').last();
await handle.waitFor({ state: 'attached' });
const hb = await handle.boundingBox();
check('roll handle exists at the cut', Boolean(hb));
if (hb) {
  await page.mouse.move(hb.x + hb.width / 2, hb.y + 3);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 15, hb.y + 3, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);
}
const afterRoll = await page.evaluate(() => {
  const s = window.__cutline.getState();
  const clips = s.project.tracks.find((t) => t.kind === 'video').clips;
  return clips.map((c) => ({ start: c.start, dur: c.duration, inPoint: c.inPoint }));
});
check('roll moves the cut, not the clips', afterRoll[0].dur > beforeRoll[0].dur + 0.05 && afterRoll[1].start > beforeRoll[1].start + 0.05 && afterRoll[1].dur < beforeRoll[1].dur - 0.05, JSON.stringify({ beforeRoll, afterRoll }));
check('roll preserves total duration', Math.abs(afterRoll[0].dur + afterRoll[1].dur - (beforeRoll[0].dur + beforeRoll[1].dur)) < 0.05, JSON.stringify(afterRoll));

const vbox = await page.locator('.track-row.video .clip').first().boundingBox();
check('first clip is visible for slip', Boolean(vbox));
if (vbox) {
  const beforeSlip = afterRoll[0];
  await page.keyboard.down('Alt');
  await page.mouse.move(vbox.x + vbox.width / 2, vbox.y + vbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(vbox.x + vbox.width / 2 + 20, vbox.y + vbox.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(500);
  const slipped = await page.evaluate(() => {
    const c = window.__cutline.getState().project.tracks.find((t) => t.kind === 'video').clips[0];
    return { start: c.start, dur: c.duration, inPoint: c.inPoint };
  });
  check('slip changes source in-point only', slipped.inPoint > beforeSlip.inPoint + 0.05 && Math.abs(slipped.start - beforeSlip.start) < 0.02 && Math.abs(slipped.dur - beforeSlip.dur) < 0.05, JSON.stringify({ beforeSlip, slipped }));
}
await page.screenshot({ path: `${OUT}/desktop-edit-tools.png` });

console.log('\n[4] Orphaned link still moves');
await page.evaluate((id) => window.__cutline.getState().deleteClip(id), clips.audio.id);
const orphanBefore = await page.evaluate((id) => {
  const s = window.__cutline.getState();
  const v = s.project.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
  return { start: v.start, link: Boolean(v.linkId) };
}, clips.video.id);
await page.evaluate(({ id, trackId, start }) => window.__cutline.getState().moveClip(id, trackId, start + 0.2), { id: clips.video.id, trackId: clips.videoTrack, start: orphanBefore.start });
await page.waitForTimeout(300);
const orphanAfter = await page.evaluate((id) => {
  const s = window.__cutline.getState();
  return s.project.tracks.flatMap((t) => t.clips).find((c) => c.id === id).start;
}, clips.video.id);
check('linked clip still moves after its partner is deleted', orphanBefore.link && orphanAfter > orphanBefore.start + 0.1, JSON.stringify({ orphanBefore, orphanAfter }));
check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '));
fs.writeFileSync(`${OUT}/edit-tools-report.json`, JSON.stringify({ checks, errors }, null, 2));
await browser.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
