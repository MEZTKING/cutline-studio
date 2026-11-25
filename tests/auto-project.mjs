import { chromium } from 'playwright-core';
import fs from 'node:fs';
const OUT = 'test-results';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  headless: false,
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
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

import path from 'node:path';
console.log('\n[1] 24 fps 960×540 source');
await page.setInputFiles('input[type=file]', path.resolve('tests/fixtures/source-24fps.webm'));
await page.waitForFunction(() => document.querySelectorAll('.clip').length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1200);

const state = await page.evaluate(() => {
  const s = window.__cutline.getState();
  const video = Object.values(s.assets).find((a) => a.kind === 'video');
  return { w: s.project.width, h: s.project.height, fps: s.project.fps, auto: s.project.autoSettings, assetFps: video?.fps, toast: document.querySelector('.toast')?.innerText ?? '' };
});
check('project adopts 960×540 canvas', state.w === 960 && state.h === 540, JSON.stringify(state));
check('source frame rate detected', typeof state.assetFps === 'number', String(state.assetFps));
check('detected rate is close to 24', typeof state.assetFps === 'number' && Math.abs(state.assetFps - 24) < 0.15, String(state.assetFps));
check('project fps follows source', state.fps === state.assetFps, `${state.fps} vs ${state.assetFps}`);
check('project is marked auto', state.auto === true);
check('import toast mentions match', /project 960×540/.test(state.toast), state.toast);

console.log('\n[2] Manual override + match source');
await page.locator('.preview-badge .pill.accent').click();
await page.waitForTimeout(300);
await page.getByLabel('Canvas').selectOption('1080x1920');
await page.waitForTimeout(500);
let overridden = await page.evaluate(() => ({ w: window.__cutline.getState().project.width, auto: window.__cutline.getState().project.autoSettings }));
check('changing canvas clears auto', overridden.w === 1080 && overridden.auto === false, JSON.stringify(overridden));
await page.locator('button', { hasText: 'Match source' }).click();
await page.waitForTimeout(500);
let matched = await page.evaluate(() => ({ w: window.__cutline.getState().project.width, h: window.__cutline.getState().project.height, fps: window.__cutline.getState().project.fps, auto: window.__cutline.getState().project.autoSettings }));
check('match source restores canvas + auto', matched.w === 960 && matched.h === 540 && matched.fps === state.assetFps && matched.auto === true, JSON.stringify(matched));

console.log('\n[3] Fullscreen uses display resolution');
const normal = await page.evaluate(() => { const c = document.querySelector('.preview-frame canvas'); return { w: c.width, h: c.height }; });
await page.locator('button[title^="Fullscreen preview"]').click();
let entered = false;
try {
  await page.waitForFunction(() => Boolean(document.fullscreenElement), null, { timeout: 5000 });
  entered = true;
} catch {
  entered = false;
}
check('fullscreen entered', entered);
if (entered) {
  await page.waitForTimeout(500);
  const full = await page.evaluate(() => {
    const c = document.querySelector('.preview-frame canvas');
    return { w: c.width, h: c.height, stage: document.fullscreenElement?.classList.contains('stage'), badge: getComputedStyle(document.querySelector('.preview-badge')).display };
  });
  check('fullscreen canvas renders above 1280', full.w > 1280, JSON.stringify(full));
  check('fullscreen is the viewer only', full.stage === true);
  await page.screenshot({ path: `${OUT}/desktop-fullscreen.png` });
  await page.locator('.fullscreen-exit').click();
  await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 5000 });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => { const c = document.querySelector('.preview-frame canvas'); return c.width; });
  check('exiting fullscreen restores preview budget', after === normal.w, `${normal.w} → ${after}`);
}
check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '));
fs.writeFileSync(`${OUT}/auto-project-report.json`, JSON.stringify({ checks, errors, state, normal }, null, 2));
await browser.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
