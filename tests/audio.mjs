import { chromium } from 'playwright-core';
import fs from 'node:fs';
const OUT = 'test-results';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app');
const wav = await page.evaluate(() => {
  const sr = 48000, n = sr * 3;
  const data = new Int16Array(n);
  for (let i = 0; i < n; i++) data[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.22 * 32767;
  const h = new ArrayBuffer(44); const dv = new DataView(h);
  const ws = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ws(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  ws(36, 'data'); dv.setUint32(40, n * 2, true);
  const out = new Uint8Array(44 + n * 2); out.set(new Uint8Array(h), 0); out.set(new Uint8Array(data.buffer), 44);
  let s = ''; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return btoa(s);
});
await page.setInputFiles('input[type=file]', [{ name: 'tone.wav', mimeType: 'audio/wav', buffer: Buffer.from(wav, 'base64') }]);
await page.waitForFunction(() => document.querySelectorAll('.clip').length >= 1, null, { timeout: 30000 });
await page.waitForTimeout(900);

console.log('\n[1] Audio controls');
check('sound type selector present', (await page.locator('#audio-type').count()) === 1);
check('fade curve selector present', (await page.locator('#fade-curve').count()) === 1);
check('EQ + compressor controls present', (await page.getByText('EQ low', { exact: true }).count()) > 0 && (await page.getByText('Compress', { exact: true }).count()) > 0);
await page.locator('#audio-type').selectOption('dialogue');
await page.waitForTimeout(300);
let audio = await page.evaluate(() => {
  const s = window.__cutline.getState();
  const clip = s.project.tracks.flatMap((t) => t.clips)[0];
  return { type: clip.audioType, low: clip.eqLow, comp: clip.compress };
});
check('dialogue preset applies EQ + compression', audio.type === 'dialogue' && audio.low === -3 && audio.comp === 0.45, JSON.stringify(audio));

const norm = page.locator('button', { hasText: 'Normalize' });
await norm.click();
await page.waitForTimeout(1200);
const normVolume = await page.evaluate(() => window.__cutline.getState().project.tracks.flatMap((t) => t.clips)[0].volume);
check('normalize raises gain to -1 dBFS', normVolume > 3.8, String(normVolume));
await page.screenshot({ path: `${OUT}/audio-panel.png` });

console.log('\n[2] Pan through export');
await page.evaluate(() => {
  const s = window.__cutline.getState();
  const clip = s.project.tracks.flatMap((t) => t.clips)[0];
  s.updateClip(clip.id, {
    volume: 0.5,
    pan: -1,
    eqLow: 0, eqMid: 0, eqHigh: 0,
    compress: 0,
    audioType: null,
    fadeIn: 0, fadeOut: 0, fadeCurve: 'linear', muted: false,
  });
});
await page.waitForTimeout(300);
await page.locator('.topbar .btn.primary').click();
await page.waitForSelector('.modal');
await page.waitForTimeout(400);
await page.locator('.modal select').first().selectOption('1280x720');
let dlPromise = page.waitForEvent('download', { timeout: 180000 });
await page.locator('.modal-foot .btn.primary').click();
let dl = await dlPromise;
const panFile = `${OUT}/audio-pan.webm`;
await dl.saveAs(panFile);
await page.waitForTimeout(400);
await page.locator('.modal-head .btn.ghost.icon').click().catch(() => undefined);

const analyze = async (file) => {
  const b64 = fs.readFileSync(file).toString('base64');
  const verify = await context.newPage();
  await verify.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  const result = await verify.evaluate(async (data) => {
    const bin = atob(data); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ctx = new AudioContext();
    let audio;
    try {
      audio = await ctx.decodeAudioData(await new Blob([bytes]).arrayBuffer());
    } catch {
      return { noAudio: true };
    }
    const ch = audio.getChannelData(0);
    const ch2 = audio.numberOfChannels > 1 ? audio.getChannelData(1) : ch;
    const count = Math.min(ch.length, Math.floor(audio.sampleRate * 1.2));
    let l = 0, r = 0;
    for (let i = 0; i < count; i += 8) { l += ch[i] * ch[i]; r += ch2[i] * ch2[i]; }
    return { noAudio: false, l: Math.sqrt(l / (count / 8)), r: Math.sqrt(r / (count / 8)), ch: audio.numberOfChannels };
  }, b64);
  await verify.close();
  return result;
};
const panned = await analyze(panFile);
check('left-panned mono tone stays left', !panned.noAudio && panned.l > 0.02 && panned.l > panned.r * 4, JSON.stringify(panned));

console.log('\n[3] Clip mute silences export');
await page.evaluate(() => {
  const s = window.__cutline.getState();
  const clip = s.project.tracks.flatMap((t) => t.clips)[0];
  s.updateClip(clip.id, { muted: true });
});
await page.waitForTimeout(300);
await page.locator('.topbar .btn.primary').click();
await page.waitForSelector('.modal');
await page.waitForTimeout(400);
await page.locator('.modal select').first().selectOption('1280x720');
dlPromise = page.waitForEvent('download', { timeout: 180000 });
await page.locator('.modal-foot .btn.primary').click();
dl = await dlPromise;
const muteFile = `${OUT}/audio-mute.webm`;
await dl.saveAs(muteFile);
await page.waitForTimeout(300);
await page.locator('.modal-head .btn.ghost.icon').click().catch(() => undefined);
const muted = await analyze(muteFile);
check('muted clip exports silence', muted.noAudio || (muted.l < 0.004 && muted.r < 0.004), JSON.stringify(muted));
check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '));
fs.writeFileSync(`${OUT}/audio-report.json`, JSON.stringify({ checks, errors, panned, muted }, null, 2));
await browser.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
