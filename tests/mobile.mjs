import { chromium } from 'playwright-core';
import fs from 'node:fs';
const OUT = 'test-results';
const URL = process.env.APP_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.app');
await page.waitForTimeout(800);
await page.evaluate(() => window.__cutline.getState().addText());
await page.waitForTimeout(700);
if (await page.locator('.sheet').count()) await page.locator('.sheet-head .btn').click();
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const m = await page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right, top: r.top };
  };
  const canvas = document.querySelector('.preview-frame canvas');
  let bright = 0;
  if (canvas) {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 215 && d[i + 1] > 215 && d[i + 2] > 215) bright++;
  }
  return {
    vw: innerWidth, vh: innerHeight,
    docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight,
    topbar: box('.topbar'), preview: box('.preview-frame'), stage: box('.stage'),
    dock: box('.timeline-dock'), tabs: box('.mobile-tabs'),
    canvas: canvas ? { w: canvas.width, h: canvas.height, css: box('.preview-frame canvas') } : null,
    bright,
    toolbar: (() => { const el = document.querySelector('.tl-toolbar'); return el ? { cw: el.clientWidth, sw: el.scrollWidth } : null; })(),
    clipCount: document.querySelectorAll('.clip').length,
  };
});
console.log(JSON.stringify(m, null, 2));
check('no horizontal page overflow', m.docW <= m.vw + 1, `${m.docW} vs ${m.vw}`);
check('topbar is 48px', Math.round(m.topbar.h) === 48, String(m.topbar.h));
check('preview fits the viewport', m.preview && m.preview.right <= m.vw + 1 && m.preview.x >= -1 && m.preview.h > 100, JSON.stringify(m.preview));
check('timeline sits above the tab bar', m.dock.bottom <= m.tabs.top + 1, `${m.dock.bottom} / ${m.tabs.top}`);
check('tab bar is pinned to the bottom', Math.abs(m.tabs.bottom - m.vh) <= 1, `${m.tabs.bottom} vs ${m.vh}`);
check('title renders on mobile', m.bright > 100, `${m.bright} bright px`);
check('timeline toolbar scrolls horizontally', m.toolbar && m.toolbar.sw >= m.toolbar.cw, JSON.stringify(m.toolbar));
await page.screenshot({ path: `${OUT}/mobile-title.png` });

await page.locator('.tab').first().click();
await page.waitForSelector('.sheet');
await page.waitForTimeout(350);
const sheet = await page.evaluate(() => {
  const r = document.querySelector('.sheet').getBoundingClientRect();
  const s = document.querySelector('.sheet-scroll');
  return { top: r.top, bottom: r.bottom, scrollH: s?.clientHeight, contentH: s?.scrollHeight, tabsTop: document.querySelector('.mobile-tabs').getBoundingClientRect().top };
});
console.log(JSON.stringify(sheet));
check('media sheet fits between bar and tabs', sheet.top >= 47 && sheet.bottom <= sheet.tabsTop + 1, JSON.stringify(sheet));
check('sheet content is scrollable', (sheet.scrollH ?? 0) > 250, `${sheet.scrollH}px viewport, ${sheet.contentH}px content`);
await page.screenshot({ path: `${OUT}/mobile-media.png` });
await page.locator('.sheet-head .btn').click();

await page.locator('.tab').nth(1).click();
await page.waitForSelector('.sheet');
await page.waitForTimeout(400);
const touchTargets = await page.evaluate(() => {
  const els = [...document.querySelectorAll('.sheet .kf, .sheet input[type=range], .sheet select')].slice(0, 40);
  return els.map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName, w: r.width, h: r.height }; });
});
const small = touchTargets.filter((t) => t.h < 18 || t.w < 18);
check('inspector controls are tappable', small.length === 0, JSON.stringify(small.slice(0, 3)));
await page.screenshot({ path: `${OUT}/mobile-inspector.png` });
await page.locator('.sheet-head .btn').click();

await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(500);
const land = await page.evaluate(() => {
  const d = document.querySelector('.timeline-dock').getBoundingClientRect();
  const c = document.querySelector('.preview-frame').getBoundingClientRect();
  return { docW: document.documentElement.scrollWidth, vw: innerWidth, dockH: d.height, previewH: c.height, dockBottom: d.bottom, vh: innerHeight };
});
console.log(JSON.stringify(land));
check('landscape has no horizontal overflow', land.docW <= land.vw + 1, `${land.docW}/${land.vw}`);
check('landscape keeps preview + timeline usable', land.previewH > 60 && land.dockH > 120 && land.dockBottom <= land.vh + 1, JSON.stringify(land));
await page.screenshot({ path: `${OUT}/mobile-landscape.png` });

check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '));
fs.writeFileSync(`${OUT}/mobile-report.json`, JSON.stringify({ checks, errors, metrics: m }, null, 2));
await browser.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
