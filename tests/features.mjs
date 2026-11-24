import { chromium } from 'playwright-core';
import fs from 'node:fs';
const OUT = 'test-results';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app');
await page.waitForTimeout(400);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('\n[1] Add a title');
await page.locator('.tl-toolbar button[title="Add a title at the playhead"]').click();
await page.waitForTimeout(400);
check('title clip created', (await page.locator('.clip.text').count()) === 1);
check('inspector shows Title section', (await page.getByText('Title', { exact: true }).count()) > 0);
const textArea = page.locator('.section-body textarea');
check('title textarea present', (await textArea.count()) === 1);
await textArea.fill('BIG SALE\nToday only');
await page.locator('.stage').click({ position: { x: 10, y: 10 } });
await page.waitForTimeout(700);
const content = await page.evaluate(() => window.__cutline.getState().project.tracks.flatMap((t) => t.clips)[0]?.text?.content);
check('title content updates', content === 'BIG SALE\nToday only', JSON.stringify(content));

const bright = await page.evaluate(() => {
  const c = document.querySelector('.preview-frame canvas');
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 215 && d[i + 1] > 215 && d[i + 2] > 215) n++;
  return n;
});
check('title pixels render in the preview', bright > 200, `${bright} bright pixels`);
await page.screenshot({ path: `${OUT}/desktop-title.png` });

console.log('\n[2] Numeric fields accept decimals');
const scaleRow = page.locator('.param').filter({ hasText: 'Scale' }).first();
const num = scaleRow.locator('input.num');
await num.fill('150.5');
await num.press('Enter');
await page.waitForTimeout(300);
const scale = await page.evaluate(() => window.__cutline.getState().project.tracks.flatMap((t) => t.clips)[0]?.transform.scale);
check('scale field commits 150.5% exactly', Math.abs(scale - 1.505) < 0.002, String(scale));

console.log('\n[3] Duplicate + undo');
const before = await page.locator('.clip').count();
await page.keyboard.press('Control+d');
await page.waitForTimeout(300);
const after = await page.locator('.clip').count();
check('Ctrl+D duplicates the clip', after === before + 1, `${before} → ${after}`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
check('undo removes the duplicate', (await page.locator('.clip').count()) === before);

console.log('\n[4] Text edits survive reload');
await page.waitForTimeout(1400);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const titleAfterReload = await page.locator('.clip.text').count();
check('title clip restored after reload', titleAfterReload === 1);
check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await page.screenshot({ path: `${OUT}/desktop-restored.png` });
fs.writeFileSync(`${OUT}/features-report.json`, JSON.stringify({ checks, errors }, null, 2));
await browser.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
