import { chromium } from 'playwright-core';
import fs from 'node:fs';
const OUT = 'test-results';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const noise = /XNNPACK|TensorFlow Lite|INFO:|gl_context|Feedback manager/i;
page.on('console', (m) => { if (m.type() === 'error' && !noise.test(m.text())) errors.push('console: ' + m.text()); });
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app');
const faceB64 = fs.readFileSync('tests/fixtures/face-public.jpg').toString('base64');

console.log('\n[1] Build a clip with a moving face');
const videoB64 = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = 'data:image/jpeg;base64,' + b64;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = 1280; c.height = 720;
  const x = c.getContext('2d');
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 2_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start(100);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const draw = () => {
      const t = Math.min(1, (performance.now() - t0) / 4500);
      x.fillStyle = '#0b1512'; x.fillRect(0, 0, 1280, 720);
      const g = x.createLinearGradient(0, 0, 1280, 720);
      g.addColorStop(0, '#0d3a31'); g.addColorStop(1, '#06100d');
      x.fillStyle = g; x.fillRect(0, 0, 1280, 720);
      const w = (img.width / img.height) * 700;
      const px = 100 + t * 660;
      x.drawImage(img, px, 10, w, 700);
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, 620, 1280, 100);
      x.fillStyle = '#5cf2b0'; x.font = 'bold 28px sans-serif'; x.fillText('MOVING SUBJECT TEST', 40, 678);
      if (t < 1) requestAnimationFrame(draw); else resolve();
    };
    draw();
  });
  rec.stop(); await stopped;
  const blob = new Blob(chunks, { type: 'video/webm' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}, faceB64);
await page.setInputFiles('input[type=file]', [{ name: 'moving-face.webm', mimeType: 'video/webm', buffer: Buffer.from(videoB64, 'base64') }]);
await page.waitForFunction(() => document.querySelectorAll('.clip').length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1200);
check('test footage imported', (await page.locator('.clip').count()) === 1);

console.log('\n[2] Auto-reframe to 9:16');
await page.locator('button[title="Auto-reframe for social"]').click();
await page.waitForSelector('.modal');
await page.waitForTimeout(500);
await page.locator('.modal-foot .btn.primary').click();
const t0 = Date.now();
let done = false;
let last = '';
while (Date.now() - t0 < 120000) {
  const st = await page.evaluate(() => ({
    open: window.__cutline.getState().reframeOpen,
    width: window.__cutline.getState().project.width,
    height: window.__cutline.getState().project.height,
    prog: document.querySelector('.modal .progress-meta span')?.textContent ?? '',
    err: document.querySelector('.modal .hint.warn')?.textContent ?? '',
  }));
  if (st.prog && st.prog !== last) { last = st.prog; console.log('   ', st.prog); }
  if (st.err) { console.log('    error:', st.err.slice(0, 200)); break; }
  if (!st.open && st.width === 1080 && st.height === 1920) { done = true; break; }
  await page.waitForTimeout(700);
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
check('reframe completed', done, `${elapsed}s`);
const info = await page.evaluate(() => {
  const s = window.__cutline.getState();
  const v = s.project.tracks.find((t) => t.kind === 'video');
  const clip = v?.clips[0];
  const xs = (clip?.keyframes?.x ?? []).map((k) => k.v);
  return {
    w: s.project.width,
    h: s.project.height,
    fill: clip?.fill,
    scale: clip?.transform?.scale,
    keys: xs.length,
    range: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
    first: xs[0],
    last: xs[xs.length - 1],
  };
});
console.log('   clip:', JSON.stringify(info));
check('canvas is 1080×1920', info.w === 1080 && info.h === 1920);
check('clip fills the frame', info.fill === true && info.scale === 1);
check('pan keyframes generated', info.keys >= 2, `${info.keys} keys`);
check('keyframes actually follow the subject', info.range > 0.1, `range ${info.range.toFixed(2)}`);

const preview = await page.evaluate(() => {
  const c = document.querySelector('.preview-frame canvas');
  return c ? { w: c.width, h: c.height } : null;
});
check('preview switched to vertical', preview && preview.h > preview.w, JSON.stringify(preview));
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/desktop-reframe.png` });

console.log('\n[3] Phone view + undo');
await page.waitForTimeout(1500);
const mobile = await context.newPage();
await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.goto(process.env.APP_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await mobile.waitForSelector('.app');
await mobile.waitForTimeout(1800);
const mInfo = await mobile.evaluate(() => ({ w: window.__cutline.getState().project.width, h: window.__cutline.getState().project.height }));
check('vertical edit restores on phone', mInfo.w === 1080 && mInfo.h === 1920, JSON.stringify(mInfo));
await mobile.screenshot({ path: `${OUT}/mobile-reframe.png` });
await mobile.close();

await page.keyboard.press('Control+z');
await page.waitForTimeout(500);
const undone = await page.evaluate(() => ({ w: window.__cutline.getState().project.width, h: window.__cutline.getState().project.height, fill: window.__cutline.getState().project.tracks.find((t) => t.kind === 'video')?.clips[0]?.fill }));
check('undo restores canvas + framing', undone.w === 1920 && undone.h === 1080 && !undone.fill, JSON.stringify(undone));
check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '));
fs.writeFileSync(`${OUT}/reframe-report.json`, JSON.stringify({ checks, errors, info }, null, 2));
await browser.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
