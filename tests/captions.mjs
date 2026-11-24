import { chromium } from 'playwright-core';
import fs from 'node:fs';
const OUT = 'test-results';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.setDefaultTimeout(30000);
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('\n[1] Import speech');
await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app');
const wav = fs.readFileSync('tests/fixtures/jfk.wav');
await page.setInputFiles('input[type=file]', [{ name: 'jfk.wav', mimeType: 'audio/wav', buffer: wav }]);
await page.waitForFunction(() => document.querySelectorAll('.clip').length >= 1, null, { timeout: 60000 });
await page.waitForTimeout(1000);
check('speech clip on the timeline', (await page.locator('.clip').count()) === 1);

console.log('\n[2] Generate captions on-device');
await page.locator('button[title^="Captions"]').click();
await page.waitForSelector('.modal');
await page.waitForTimeout(600);
const generate = page.locator('.modal .btn.primary');
check('generate button available', await generate.isEnabled());
const t0 = Date.now();
await generate.click();
let lastProgress = '';
while (Date.now() - t0 < 300000) {
  const caps = await page.locator('.clip.caption').count();
  if (caps > 0) break;
  const state = await page.evaluate(() => ({
    open: window.__cutline.getState().captionsOpen,
    text: document.querySelector('.modal .progress-meta span')?.textContent ?? '',
    err: document.querySelector('.modal .hint.warn')?.textContent ?? '',
  }));
  if (state.text && state.text !== lastProgress) {
    lastProgress = state.text;
    console.log('   ', state.text);
  }
  if (state.err) {
    console.log('    ASR error:', state.err.slice(0, 200));
    break;
  }
  if (!state.open) break;
  await page.waitForTimeout(900);
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const captionInfo = await page.evaluate(() => {
  const s = window.__cutline.getState();
  const clips = s.project.tracks.flatMap((t) => t.clips).filter((c) => c.text?.caption);
  const track = s.project.tracks.find((t) => t.clips.some((c) => c.text?.caption));
  return { count: clips.length, texts: clips.map((c) => c.text.content), track: track?.name, start: clips[0]?.start };
});
console.log('   captions:', JSON.stringify(captionInfo));
check('captions generated', captionInfo.count >= 2, `${captionInfo.count} cues in ${elapsed}s`);
check('caption text is accurate', captionInfo.texts.join(' ').toLowerCase().includes('country'), captionInfo.texts.join(' | ').slice(0, 120));
check('captions land on a CC track', captionInfo.track === 'CC', captionInfo.track ?? 'none');
check('caption timing is on the timeline', captionInfo.start === 0, String(captionInfo.start));

await page.evaluate(() => {
  const s = window.__cutline.getState();
  const cap = s.project.tracks.flatMap((t) => t.clips).find((c) => c.text?.caption);
  if (cap) s.select(cap.id, s.project.tracks.find((t) => t.clips.includes(cap)).id);
  s.setPlayhead(2.0);
});
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/desktop-captions.png` });

if (await page.locator('.modal').count()) {
  await page.locator('.modal-head .btn.ghost.icon').click().catch(() => undefined);
  await page.waitForTimeout(300);
}
console.log('\n[3] Export SRT');
await page.locator('button[title^="Captions"]').click();
await page.waitForSelector('.modal');
await page.waitForTimeout(400);
const dlPromise = page.waitForEvent('download', { timeout: 30000 });
await page.locator('.modal button', { hasText: 'Export .srt' }).click();
const dl = await dlPromise;
const srtPath = `${OUT}/captions-export.srt`;
await dl.saveAs(srtPath);
const srt = fs.readFileSync(srtPath, 'utf8');
console.log('   srt head:', JSON.stringify(srt.split('\n').slice(0, 4).join(' / ')));
check('SRT downloaded', srt.includes('-->'), dl.suggestedFilename());
check('SRT preserves cue text', srt.toLowerCase().includes('country'));
await page.locator('.modal-head .btn.ghost.icon').click();
await page.waitForTimeout(300);

console.log('\n[4] Import SRT and edit');
const importedSrt = `1
00:00:00,500 --> 00:00:02,000
First imported line

2
00:00:03,000 --> 00:00:05,500
Second imported line
`;
fs.writeFileSync(`${OUT}/import.srt`, importedSrt);
await page.locator('button[title^="Captions"]').click();
await page.waitForSelector('.modal');
await page.setInputFiles('input[accept*="srt"]', `${OUT}/import.srt`);
await page.waitForTimeout(800);
const imported = await page.evaluate(() => {
  const s = window.__cutline.getState();
  return s.project.tracks.flatMap((t) => t.clips).filter((c) => c.text?.caption).map((c) => c.text.content);
});
check('SRT import replaces captions', imported.length === 2 && imported[0] === 'First imported line', JSON.stringify(imported));

console.log('\n[5] Persistence');
await page.waitForTimeout(1600);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.app');
await page.waitForTimeout(1600);
check('captions restore after reload', (await page.locator('.clip.caption').count()) === 2);
check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '));

fs.writeFileSync(`${OUT}/captions-report.json`, JSON.stringify({ checks, errors, captionInfo }, null, 2));
await browser.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
