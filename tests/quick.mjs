import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1255/chrome-linux-arm64/chrome',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', m => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', e => logs.push(`PAGEERROR: ${e.message}`));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
console.log('title:', await page.title());
console.log('splash gone:', await page.locator('.app').count());
console.log('webcodecs:', await page.evaluate(() => ({ V: typeof VideoEncoder, A: typeof AudioEncoder, F: typeof VideoFrame })));
console.log('sizes:', await page.evaluate(() => ({ inner: [innerWidth, innerHeight], canvas: !!document.querySelector('canvas'), body: document.body.scrollHeight })));
await page.screenshot({ path: '/workspaces/Video Editor/test-results/initial.png' });
console.log('logs:', logs.slice(0, 20).join('\n') || 'none');
await browser.close();
