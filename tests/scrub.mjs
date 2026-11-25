import { chromium } from 'playwright-core';
import fs from 'node:fs';
const OUT = 'test-results';
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
const png = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 1280, 720); g.addColorStop(0, '#0d4a3e'); g.addColorStop(1, '#061312');
  x.fillStyle = g; x.fillRect(0, 0, 1280, 720);
  x.fillStyle = '#5cf2b0'; x.beginPath(); x.arc(300, 360, 120, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#eafff8'; x.font = 'bold 74px sans-serif'; x.fillText('SCRUB PREVIEW', 500, 390);
  const blob = await new Promise((r) => c.toBlob((b) => r(b), 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer()); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
});
await page.setInputFiles('input[type=file]', [{ name: 'scrub.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
await page.waitForFunction(() => document.querySelectorAll('.clip').length >= 1, null, { timeout: 30000 });
await page.waitForTimeout(900);

console.log('\n[1] Scrub thumbnail');
const ruler = await page.locator('.tl-ruler').boundingBox();
await page.mouse.move(ruler.x + 64, ruler.y + 12);
await page.waitForTimeout(900);
const previewCount = await page.locator('.scrub-preview').count();
check('scrub preview appears on hover', previewCount === 1);
const previewInfo = await page.evaluate(() => {
  const el = document.querySelector('.scrub-preview');
  if (!el) return null;
  const c = el.querySelector('canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let sum = 0; let n = 0;
  for (let i = 0; i < d.length; i += 4 * 17) { sum += d[i] + d[i + 1] + d[i + 2]; n++; }
  return { w: c.width, h: c.height, avg: sum / n / 3, text: el.innerText.replace(/\n/g, ' ') };
});
check('preview canvas renders a frame', previewInfo && previewInfo.avg > 8, JSON.stringify(previewInfo));
check('preview shows timecode', /00:00:01/.test(previewInfo?.text ?? ''), previewInfo?.text ?? '');
await page.screenshot({ path: `${OUT}/scrub-preview.png` });

console.log('\n[2] Fine scrub');
await page.evaluate(() => window.__cutline.getState().setPlayhead(1));
await page.locator('button[title^="Fine scrub"]').click();
await page.waitForTimeout(200);
check('fine mode toggles', await page.evaluate(() => window.__cutline.getState().fineScrub));
await page.mouse.move(ruler.x + 64, ruler.y + 12);
await page.mouse.down();
await page.mouse.move(ruler.x + 124, ruler.y + 12, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(250);
const fineTime = await page.evaluate(() => window.__cutline.getState().playhead);
check('fine drag is 1/5 speed and frame-snapped', Math.abs(fineTime - 1.2) < 0.06, String(fineTime));

await page.locator('button[title^="Fine scrub"]').click();
await page.waitForTimeout(200);
await page.evaluate(() => window.__cutline.getState().setPlayhead(1));
await page.mouse.move(ruler.x + 64, ruler.y + 12);
await page.mouse.down();
await page.mouse.move(ruler.x + 124, ruler.y + 12, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(250);
const normalTime = await page.evaluate(() => window.__cutline.getState().playhead);
check('normal drag is 1:1', Math.abs(normalTime - 1.9375) < 0.06, String(normalTime));
check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
