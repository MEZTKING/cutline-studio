import { chromium } from 'playwright-core';
import fs from 'node:fs';
const OUT = 'test-results';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  headless: false,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  env: { ...process.env, DISPLAY: process.env.DISPLAY || ':99', LIBGL_ALWAYS_SOFTWARE: '1' },
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
const sample = (x, y) => page.evaluate(({ x, y }) => {
  const c = document.querySelector('.preview-frame canvas');
  const d = c.getContext('2d').getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data;
  return [d[0], d[1], d[2]];
}, { x, y });
const near = (px, r, g, b, tol = 18) => Math.abs(px[0] - r) <= tol && Math.abs(px[1] - g) <= tol && Math.abs(px[2] - b) <= tol;
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app');
const png = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
  const x = c.getContext('2d'); x.fillStyle = '#ff0000'; x.fillRect(0, 0, 640, 720); x.fillStyle = '#0000ff'; x.fillRect(640, 0, 640, 720);
  const blob = await new Promise((r) => c.toBlob((b) => r(b), 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer()); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
});
await page.setInputFiles('input[type=file]', [{ name: 'mask.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
await page.waitForFunction(() => document.querySelectorAll('.clip').length >= 1, null, { timeout: 30000 });
await page.waitForTimeout(700);
await page.locator('button[title="Colour page"]').click();
await page.waitForTimeout(500);
check('qualifier controls present', (await page.getByText('HSL qualifier', { exact: true }).count()) > 0);
check('window controls present', (await page.getByText('Power window', { exact: true }).count()) > 0);

console.log('\n[1] Red-only HSL qualifier');
await page.evaluate(() => {
  const s = window.__cutline.getState();
  const clip = s.project.tracks.find((t) => t.kind === 'video').clips[0];
  s.updateClip(clip.id, { color: { ...clip.color, saturation: -100, qualifier: { enabled: true, hue: 0, hueRange: 0.06, satMin: 0.5, satMax: 1, lumMin: 0, lumMax: 1, softness: 0.1, invert: false }, window: { ...clip.color.window, enabled: false } } });
});
await page.waitForTimeout(800);
const qRed = await sample(0.25, 0.5);
const qBlue = await sample(0.75, 0.5);
check('red is desaturated inside qualifier', Math.abs(qRed[0] - qRed[1]) < 8 && Math.abs(qRed[1] - qRed[2]) < 8, JSON.stringify(qRed));
check('blue outside qualifier stays blue', near(qBlue, 0, 0, 255, 25), JSON.stringify(qBlue));

console.log('\n[2] Left-side power window');
await page.evaluate(() => {
  const s = window.__cutline.getState();
  const clip = s.project.tracks.find((t) => t.kind === 'video').clips[0];
  s.updateClip(clip.id, { color: { ...clip.color, saturation: -100, qualifier: { ...clip.color.qualifier, enabled: false }, window: { enabled: true, shape: 'ellipse', cx: 0.25, cy: 0.5, width: 0.22, height: 0.42, feather: 0.12, invert: false } } });
});
await page.waitForTimeout(800);
const wRed = await sample(0.25, 0.5);
const wBlue = await sample(0.75, 0.5);
check('window grades inside the shape', Math.abs(wRed[0] - wRed[1]) < 8 && Math.abs(wRed[1] - wRed[2]) < 8, JSON.stringify(wRed));
check('window leaves outside untouched', near(wBlue, 0, 0, 255, 25), JSON.stringify(wBlue));
console.log('\n[3] Master RGB curve');
await page.evaluate(() => {
  const s = window.__cutline.getState();
  const clip = s.project.tracks.find((t) => t.kind === 'video').clips[0];
  s.updateClip(clip.id, { color: { ...clip.color, saturation: 0, qualifier: { ...clip.color.qualifier, enabled: false }, window: { ...clip.color.window, enabled: false }, curve: [{ x: 0, y: 1 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }] } });
});
await page.waitForTimeout(800);
check('curve editor present', (await page.locator('.curve-canvas').count()) === 1);
const cRed = await sample(0.25, 0.5);
const cBlue = await sample(0.75, 0.5);
check('inverted curve flips red to cyan', near(cRed, 0, 255, 255, 25), JSON.stringify(cRed));
check('inverted curve flips blue to yellow', near(cBlue, 255, 255, 0, 25), JSON.stringify(cBlue));
await page.screenshot({ path: `${OUT}/color-secondaries.png` });
check('no GPU/runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/color-secondaries-report.json`, JSON.stringify({ checks, errors, qRed, qBlue, wRed, wBlue, cRed, cBlue }, null, 2));

await browser.close();
console.log(checks.every((c) => c.ok) ? 'COLOR SECONDARIES OK' : 'COLOR SECONDARIES FAILED');
process.exit(checks.every((c) => c.ok) ? 0 : 1);
