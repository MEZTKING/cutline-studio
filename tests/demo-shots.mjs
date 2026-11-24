import { chromium } from 'playwright-core';
import fs from 'node:fs';
const OUT = 'docs/screens';
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.APP_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.app');
await page.waitForTimeout(500);

const media = await page.evaluate(async () => {
  const toB64 = (buf) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
  const vc = document.createElement('canvas'); vc.width = 1280; vc.height = 720;
  const x = vc.getContext('2d');
  const rec = new MediaRecorder(vc.captureStream(30), { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 2_500_000 });
  const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stop = new Promise((r) => (rec.onstop = r)); rec.start(100);
  const t0 = performance.now();
  await new Promise((res) => {
    const draw = () => {
      const t = (performance.now() - t0) / 1000;
      const g = x.createLinearGradient(0, 0, 1280, 720);
      g.addColorStop(0, `hsl(${150 + t * 20} 70% 12%)`);
      g.addColorStop(0.55, `hsl(${170 + t * 25} 65% 26%)`);
      g.addColorStop(1, `hsl(${195 + t * 20} 70% 8%)`);
      x.fillStyle = g; x.fillRect(0, 0, 1280, 720);
      for (let i = 0; i < 5; i++) {
        const cx = 300 + i * 170 + Math.sin(t * 1.2 + i) * 60;
        const cy = 360 + Math.cos(t * 0.9 + i * 1.4) * 120;
        x.beginPath(); x.arc(cx, cy, 46 - i * 4, 0, Math.PI * 2);
        x.fillStyle = `rgba(92,242,176,${0.5 - i * 0.07})`; x.fill();
      }
      x.fillStyle = 'rgba(4,8,10,0.5)'; x.fillRect(0, 588, 1280, 132);
      x.fillStyle = '#dffef1'; x.font = '600 40px sans-serif'; x.fillText('Shot on location  ·  4K', 64, 652);
      if (t < 4) requestAnimationFrame(draw); else res();
    };
    draw();
  });
  rec.stop(); await stop;
  const vb = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer();

  const sr = 48000, n = sr * 3, d = new Int16Array(n);
  for (let i = 0; i < n; i++) d[i] = Math.sin((2 * Math.PI * 392 * i) / sr) * 5000;
  const h = new ArrayBuffer(44), dv = new DataView(h); const ws = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ws(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, n * 2, true);
  const wav = new Uint8Array(44 + n * 2); wav.set(new Uint8Array(h), 0); wav.set(new Uint8Array(d.buffer), 44);

  const ic = document.createElement('canvas'); ic.width = 1280; ic.height = 720; const ix = ic.getContext('2d');
  const ig = ix.createLinearGradient(0, 0, 1280, 720); ig.addColorStop(0, '#0b2f2a'); ig.addColorStop(1, '#071413');
  ix.fillStyle = ig; ix.fillRect(0, 0, 1280, 720);
  ix.fillStyle = 'rgba(92,242,176,0.12)'; ix.fillRect(80, 90, 1120, 540);
  ix.strokeStyle = 'rgba(92,242,176,0.45)'; ix.lineWidth = 3; ix.strokeRect(80, 90, 1120, 540);
  ix.fillStyle = '#eafff8'; ix.font = '800 96px sans-serif'; ix.fillText('CUTLINE', 140, 330);
  ix.fillStyle = '#5cf2b0'; ix.font = '500 44px sans-serif'; ix.fillText('Studio still frame', 140, 410);
  const png = await new Promise((r) => ic.toBlob((b) => r(b), 'image/png'));
  return { video: toB64(vb), wav: toB64(wav.buffer), png: toB64(await png.arrayBuffer()) };
});

await page.setInputFiles('input[type=file]', [
  { name: 'coastline-motion.webm', mimeType: 'video/webm', buffer: Buffer.from(media.video, 'base64') },
  { name: 'ambient-tone.wav', mimeType: 'audio/wav', buffer: Buffer.from(media.wav, 'base64') },
  { name: 'studio-still.png', mimeType: 'image/png', buffer: Buffer.from(media.png, 'base64') },
]);
await page.waitForFunction(() => document.querySelectorAll('.clip').length >= 3, null, { timeout: 30000 });
await page.waitForTimeout(1200);

await page.evaluate(() => {
  const s = window.__cutline.getState();
  s.setPlayhead(1.35);
  s.addText();
  const st = window.__cutline.getState();
  const textClip = st.project.tracks.flatMap((t) => t.clips).find((c) => c.text);
  if (textClip) {
    st.updateClip(textClip.id, {
      start: 0.85,
      duration: 4,
      text: { ...textClip.text, content: 'ANYWHERE\nEDITING', size: 7.2, backgroundOpacity: 0.34 },
      transform: { ...textClip.transform, y: -0.02 },
    }, false);
  }
  const s2 = window.__cutline.getState();
  const v1 = s2.project.tracks.find((t) => t.name === 'V1');
  if (v1) s2.select(v1.clips[0].id, v1.id);
  s2.setPlayhead(1.35);
});
await page.waitForTimeout(1400);
await page.screenshot({ path: `${OUT}/desktop-editing.png` });
await page.screenshot({ path: 'test-results/hero-desktop.png' });

console.log('desktop', await page.evaluate(() => ({ clips: document.querySelectorAll('.clip').length, tracks: window.__cutline.getState().project.tracks.length })));

await page.locator('.topbar .btn.primary').click();
await page.waitForSelector('.modal');
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/desktop-export.png` });
await page.keyboard.press('Escape');
await page.locator('.modal-head .btn.ghost.icon').click().catch(() => undefined);
await page.waitForTimeout(300);

const mobile = await context.newPage();
await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.goto(URL, { waitUntil: 'networkidle' });
await mobile.waitForSelector('.app');
await mobile.waitForTimeout(1600);
await mobile.evaluate(() => {
  const s = window.__cutline.getState();
  const v1 = s.project.tracks.find((t) => t.name === 'V1');
  if (v1) s.select(v1.clips[0].id, v1.id);
  s.setPlayhead(1.35);
});
await mobile.waitForTimeout(1200);
await mobile.screenshot({ path: `${OUT}/mobile-editing.png` });

await mobile.locator('.tab').nth(1).click();
await mobile.waitForSelector('.sheet');
await mobile.waitForTimeout(500);
await mobile.screenshot({ path: `${OUT}/mobile-inspector.png` });

console.log('mobile', await mobile.evaluate(() => ({ clips: document.querySelectorAll('.clip').length, errors: 0 })));
await browser.close();
