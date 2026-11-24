import { chromium } from 'playwright-core';
import fs from 'node:fs';
const OUT = 'docs/screens';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app');

const png = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 1280, 720);
  g.addColorStop(0, '#062c26'); g.addColorStop(0.55, '#0d4f43'); g.addColorStop(1, '#041714');
  x.fillStyle = g; x.fillRect(0, 0, 1280, 720);
  for (let i = 0; i < 4; i++) {
    x.beginPath(); x.arc(250 + i * 260, 250 + (i % 2) * 140, 90 - i * 10, 0, Math.PI * 2);
    x.fillStyle = `rgba(92,242,176,${0.22 - i * 0.04})`; x.fill();
  }
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(80, 430, 760, 180);
  x.fillStyle = '#eafff8'; x.font = '800 92px sans-serif'; x.fillText('CUTLINE', 130, 530);
  x.fillStyle = '#5cf2b0'; x.font = '500 38px sans-serif'; x.fillText('captions that travel', 134, 590);
  const blob = await new Promise((r) => c.toBlob((b) => r(b), 'image/png'));
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
});
await page.setInputFiles('input[type=file]', [{ name: 'hero-still.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
await page.waitForFunction(() => document.querySelectorAll('.clip').length >= 1, null, { timeout: 30000 });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const s = window.__cutline.getState();
  s.addCaptions([
    { start: 0.4, end: 2.6, text: 'Captions generated on this phone' },
    { start: 2.7, end: 4.6, text: 'No cloud. No upload. Just words.' },
  ]);
  const st = window.__cutline.getState();
  const cap = st.project.tracks.flatMap((t) => t.clips).find((c) => c.text?.caption);
  if (cap) st.select(cap.id, st.project.tracks.find((t) => t.clips.includes(cap)).id);
  st.setPlayhead(1.2);
});
await page.waitForTimeout(1300);
await page.screenshot({ path: `${OUT}/mobile-captions.png` });
await page.evaluate(() => window.__cutline.getState().setCaptionsOpen(true));
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/mobile-captions-dialog.png` });
console.log(JSON.stringify({ errors, clips: await page.locator('.clip').count(), captionClips: await page.locator('.clip.caption').count() }));
await browser.close();
