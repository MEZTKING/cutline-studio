import { chromium } from 'playwright-core';
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
  const g = x.createLinearGradient(0, 0, 1280, 720); g.addColorStop(0, '#0f3b33'); g.addColorStop(1, '#071413');
  x.fillStyle = g; x.fillRect(0, 0, 1280, 720);
  x.fillStyle = '#eafff8'; x.font = 'bold 80px sans-serif'; x.fillText('PROJECT SETTINGS', 80, 380);
  const blob = await new Promise((r) => c.toBlob((b) => r(b), 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer()); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
});
await page.setInputFiles('input[type=file]', [{ name: 'settings.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
await page.waitForFunction(() => document.querySelectorAll('.clip').length >= 1, null, { timeout: 30000 });
await page.waitForTimeout(900);
check('a clip is selected after import', (await page.locator('.clip-card-name').count()) === 1);

await page.locator('.preview-badge .pill.accent').click();
await page.waitForTimeout(400);
check('resolution badge opens project settings', (await page.getByText('Project settings', { exact: true }).count()) > 0);
check('canvas + fps controls visible', (await page.getByLabel('Canvas').count()) === 1);

await page.getByLabel('Canvas').selectOption('1080x1920');
await page.waitForTimeout(800);
let state = await page.evaluate(() => ({ w: window.__cutline.getState().project.width, h: window.__cutline.getState().project.height }));
check('canvas switches to vertical 1080×1920', state.w === 1080 && state.h === 1920, JSON.stringify(state));
const preview = await page.evaluate(() => { const c = document.querySelector('.preview-frame canvas'); return { w: c.width, h: c.height }; });
check('preview follows the new canvas', preview.h > preview.w, JSON.stringify(preview));

await page.getByLabel('Frame rate').selectOption('24');
await page.waitForTimeout(500);
state = await page.evaluate(() => ({ fps: window.__cutline.getState().project.fps }));
check('project frame rate becomes 24', state.fps === 24, JSON.stringify(state));
await page.screenshot({ path: `${OUT}/project-settings.png` });

await page.keyboard.press('Control+z');
await page.waitForTimeout(400);
const undone = await page.evaluate(() => ({ fps: window.__cutline.getState().project.fps, w: window.__cutline.getState().project.width, h: window.__cutline.getState().project.height }));
check('undo restores frame rate, keeps canvas', undone.fps === 30 && undone.w === 1080, JSON.stringify(undone));

console.log('\n[2] Deselect');
await page.evaluate(() => {
  const s = window.__cutline.getState();
  const track = s.project.tracks.find((t) => t.kind === 'video' && t.clips.length);
  s.select(track.clips[0].id, track.id);
});
await page.waitForTimeout(200);
const box = await page.locator('.track-row.video').boundingBox();
await page.mouse.click(box.x + box.width - 40, box.y + box.height / 2);
await page.waitForTimeout(300);
check('clicking empty timeline shows project settings', (await page.evaluate(() => window.__cutline.getState().selection.clipId)) === null);
check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
