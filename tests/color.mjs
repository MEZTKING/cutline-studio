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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sample = (x, y) => page.evaluate(({ x, y }) => {
  const c = document.querySelector('.preview-frame canvas');
  const d = c.getContext('2d').getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data;
  return [d[0], d[1], d[2]];
}, { x, y });
const near = (px, r, g, b, tol = 12) => Math.abs(px[0] - r) <= tol && Math.abs(px[1] - g) <= tol && Math.abs(px[2] - b) <= tol;

await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app');
await page.waitForTimeout(400);
check('WebGL2 exposed', await page.evaluate(() => typeof WebGL2RenderingContext !== 'undefined'));

console.log('\n[1] Import a red/blue test still');
const png = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
  const x = c.getContext('2d');
  x.fillStyle = '#ff0000'; x.fillRect(0, 0, 640, 720);
  x.fillStyle = '#0000ff'; x.fillRect(640, 0, 640, 720);
  x.fillStyle = '#ffffff'; x.font = 'bold 64px sans-serif'; x.fillText('COLOR TEST', 60, 660);
  const blob = await new Promise((r) => c.toBlob((b) => r(b), 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer()); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
});
await page.setInputFiles('input[type=file]', [{ name: 'red-blue.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
await page.waitForFunction(() => document.querySelectorAll('.clip').length >= 1, null, { timeout: 30000 });
await page.waitForTimeout(1000);
const original = await sample(0.25, 0.5);
check('original red pixel', near(original, 255, 0, 0, 20), JSON.stringify(original));

console.log('\n[2] Colour page');
await page.locator('button[title="Colour page"]').click();
await page.waitForTimeout(600);
check('colour page opens', (await page.locator('.color-body').count()) === 1);
check('three primary wheels', (await page.locator('.wheel-face').count()) === 3);
const scopePixels = await page.evaluate(() => {
  const c = document.querySelector('.scope-wave');
  if (!c) return 0;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n++;
  return n;
});
check('scopes are drawing', scopePixels > 200, `${scopePixels} active px`);

console.log('\n[3] Built-in LUT');
await page.locator('.color-card select').first().selectOption('builtin:bw');
await page.waitForTimeout(800);
const bw = await sample(0.25, 0.5);
check('B&W LUT removes colour', Math.abs(bw[0] - bw[1]) < 6 && Math.abs(bw[1] - bw[2]) < 6, JSON.stringify(bw));

console.log('\n[4] Import a channel-swapping invert LUT');
const lines = [];
for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) {
  lines.push(`${(1 - r).toFixed(6)} ${(1 - g).toFixed(6)} ${(1 - b).toFixed(6)}`);
}
fs.writeFileSync(`${OUT}/invert.cube`, `TITLE "Invert Swap"\nLUT_3D_SIZE 2\n${lines.join('\n')}\n`);
await page.locator('input[accept*=".cube"]').setInputFiles(`${OUT}/invert.cube`);
await page.waitForTimeout(900);
const cyan = await sample(0.25, 0.5);
check('imported LUT applies with correct channel order', near(cyan, 0, 255, 255, 18), JSON.stringify(cyan));
const lutName = await page.locator('.color-card .hint').first().innerText();
check('LUT library shows the import', lutName.includes('Invert Swap'), lutName);
const lutOptions = await page.locator('.color-card select option').count();
check('LUT appears in selector', lutOptions >= 6, String(lutOptions));

console.log('\n[5] Viewer bypass');
await page.getByRole('button', { name: /Compare/ }).click();
await page.waitForTimeout(700);
const bypassed = await sample(0.25, 0.5);
check('bypass restores original', near(bypassed, 255, 0, 0, 20), JSON.stringify(bypassed));
await page.getByRole('button', { name: /Bypassed/ }).click();
await page.waitForTimeout(700);
check('bypass returns to graded view', near(await sample(0.25, 0.5), 0, 255, 255, 18));
await page.screenshot({ path: `${OUT}/desktop-color.png` });

console.log('\n[6] Export bakes the grade');
await page.locator('.topbar .btn.primary').click();
await page.waitForSelector('.modal');
await page.waitForTimeout(500);
await page.locator('.modal select').first().selectOption('1280x720');
const dlPromise = page.waitForEvent('download', { timeout: 180000 });
await page.locator('.modal-foot .btn.primary').click();
const dl = await dlPromise;
const exportPath = `${OUT}/color-export.webm`;
await dl.saveAs(exportPath);
await page.waitForTimeout(500);
await page.locator('.modal-head .btn.ghost.icon').click().catch(() => undefined);

const verify = await context.newPage();
await verify.goto(process.env.APP_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
const b64 = fs.readFileSync(exportPath).toString('base64');
const exported = await verify.evaluate(async (data) => {
  const bin = atob(data); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const v = document.createElement('video');
  v.src = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
  v.muted = true;
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('decode failed')); setTimeout(() => rej(new Error('timeout')), 15000); });
  v.currentTime = 0.4;
  await new Promise((res) => { v.onseeked = res; setTimeout(res, 4000); });
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
  const ctx = c.getContext('2d'); ctx.drawImage(v, 0, 0);
  const d = ctx.getImageData(Math.floor(c.width * 0.25), Math.floor(c.height * 0.5), 1, 1).data;
  return { duration: v.duration, w: v.videoWidth, rgb: [d[0], d[1], d[2]] };
}, b64);
check('exported frame carries the LUT', near(exported.rgb, 0, 255, 255, 24), JSON.stringify(exported));
await verify.close();

console.log('\n[7] Persistence');
await page.waitForTimeout(1600);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.app');
await page.waitForTimeout(2000);
const restored = await sample(0.25, 0.5);
check('LUT survives reload', near(restored, 0, 255, 255, 24), JSON.stringify(restored));
console.log('\n[8] Phone colour sheet');
const mobile = await context.newPage();
await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.goto(process.env.APP_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await mobile.waitForSelector('.app');
await mobile.waitForTimeout(1800);
await mobile.evaluate(() => {
  const s = window.__cutline.getState();
  const track = s.project.tracks.find((t) => t.kind === 'video' && t.clips.length);
  if (track) s.select(track.clips[0].id, track.id);
});
await mobile.waitForTimeout(400);
await mobile.locator('.tab', { hasText: 'Color' }).click();
await mobile.waitForSelector('.color-sheet');
await mobile.waitForTimeout(700);
const mobileLayout = await mobile.evaluate(() => {
  const sheet = document.querySelector('.sheet').getBoundingClientRect();
  const preview = document.querySelector('.preview-frame canvas').getBoundingClientRect();
  return { sheetTop: sheet.top, previewBottom: preview.bottom, wheels: document.querySelectorAll('.wheel-face').length, docW: document.documentElement.scrollWidth, vw: innerWidth };
});
check('phone sheet keeps preview visible', mobileLayout.sheetTop >= mobileLayout.previewBottom - 3 && mobileLayout.wheels === 3, JSON.stringify(mobileLayout));
check('phone colour layout has no overflow', mobileLayout.docW <= mobileLayout.vw + 1, `${mobileLayout.docW}/${mobileLayout.vw}`);
await mobile.screenshot({ path: `${OUT}/mobile-color.png` });
await mobile.close();
check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '));
fs.writeFileSync(`${OUT}/color-report.json`, JSON.stringify({ checks, errors, mobileLayout }, null, 2));
await browser.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
