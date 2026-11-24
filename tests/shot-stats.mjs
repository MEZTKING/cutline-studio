import { chromium } from 'playwright-core';
import fs from 'node:fs';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
const files = ['desktop-editing', 'desktop-export', 'mobile-editing', 'mobile-inspector'];
for (const f of files) {
  const b64 = fs.readFileSync(`docs/screens/${f}.png`).toString('base64');
  const stats = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0, sum2 = 0, n = 0; const colors = new Set();
    for (let i = 0; i < d.length; i += 4 * 13) {
      const l = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
      sum += l; sum2 += l * l; n++;
      if (colors.size < 5000) colors.add(((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3));
    }
    const mean = sum / n;
    return { w: img.width, h: img.height, mean: mean.toFixed(1), std: Math.sqrt(sum2 / n - mean * mean).toFixed(1), colors: colors.size };
  }, b64);
  console.log(f, JSON.stringify(stats));
}
await browser.close();
