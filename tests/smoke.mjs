import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || chromium.executablePath();
const URL = process.env.APP_URL || 'http://127.0.0.1:5173/';
const OUT = path.resolve('test-results');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const failures = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  if (ok) console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

console.log('\n[1] Load app');
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.app');
await page.waitForTimeout(400);
check('app shell renders', (await page.locator('.timeline-dock').count()) === 1);
check('preview canvas present', (await page.locator('.preview-frame canvas').count()) === 1);
const wc = await page.evaluate(() => ({ v: typeof VideoEncoder, a: typeof AudioEncoder }));
check('WebCodecs available', wc.v === 'function' && wc.a === 'function', JSON.stringify(wc));
check('service worker registered', await page.evaluate(async () => { try { const r = await Promise.race([navigator.serviceWorker.ready, new Promise((res) => setTimeout(() => res(null), 4000))]); return !!r?.active; } catch { return false; } }));

console.log('\n[2] Generate test media in-browser');
const media = await page.evaluate(async () => {
  const toB64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(s);
  };

  // --- moving video via MediaRecorder ---
  const vc = document.createElement('canvas');
  vc.width = 640;
  vc.height = 360;
  const vctx = vc.getContext('2d');
  const stream = vc.captureStream(30);
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start(100);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const draw = () => {
      const t = (performance.now() - t0) / 1000;
      const g = vctx.createLinearGradient(0, 0, 640, 360);
      g.addColorStop(0, `hsl(${(t * 120) % 360} 85% 55%)`);
      g.addColorStop(1, `hsl(${(t * 120 + 140) % 360} 85% 45%)`);
      vctx.fillStyle = g;
      vctx.fillRect(0, 0, 640, 360);
      vctx.fillStyle = 'rgba(4,10,14,0.92)';
      vctx.fillRect(40, 130, 560, 100);
      vctx.fillStyle = '#eafff8';
      vctx.font = 'bold 44px sans-serif';
      vctx.fillText('CUTLINE', 70, 196);
      vctx.fillStyle = '#5cf2b0';
      vctx.beginPath();
      vctx.arc(80 + ((t * 180) % 480), 300, 18, 0, Math.PI * 2);
      vctx.fill();
      if (t < 1.6) requestAnimationFrame(draw);
      else resolve();
    };
    draw();
  });
  rec.stop();
  await stopped;
  const vblob = new Blob(chunks, { type: 'video/webm' });

  // --- WAV tone ---
  const sr = 48000;
  const seconds = 2;
  const n = sr * seconds;
  const data = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 2400) * Math.min(1, (n - i) / 2400);
    data[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.22 * env * 32767;
  }
  const hdr = new ArrayBuffer(44);
  const dv = new DataView(hdr);
  const ws = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  ws(0, 'RIFF');
  dv.setUint32(4, 36 + n * 2, true);
  ws(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  ws(36, 'data');
  dv.setUint32(40, n * 2, true);
  const wav = new Uint8Array(44 + n * 2);
  wav.set(new Uint8Array(hdr), 0);
  wav.set(new Uint8Array(data.buffer), 44);

  // --- still ---
  const ic = document.createElement('canvas');
  ic.width = 1280;
  ic.height = 720;
  const ictx = ic.getContext('2d');
  const ig = ictx.createLinearGradient(0, 0, 1280, 720);
  ig.addColorStop(0, '#0b3d33');
  ig.addColorStop(0.6, '#0f766e');
  ig.addColorStop(1, '#134e4a');
  ictx.fillStyle = ig;
  ictx.fillRect(0, 0, 1280, 720);
  ictx.fillStyle = 'rgba(0,0,0,0.35)';
  ictx.fillRect(90, 240, 1100, 240);
  ictx.fillStyle = '#eafff8';
  ictx.font = 'bold 92px sans-serif';
  ictx.fillText('STILL FRAME', 140, 330);
  ictx.fillStyle = '#5cf2b0';
  ictx.font = 'bold 44px sans-serif';
  ictx.fillText('Cutline Studio smoke test', 140, 410);
  const png = await new Promise((r) => ic.toBlob((b) => r(b), 'image/png'));

  return {
    video: toB64(await vblob.arrayBuffer()),
    wav: toB64(wav.buffer),
    png: toB64(await png.arrayBuffer()),
  };
});
console.log(`  media sizes: video ${(media.video.length * 0.75 / 1e6).toFixed(2)}MB, wav ${(media.wav.length * 0.75 / 1e6).toFixed(2)}MB, png ${(media.png.length * 0.75 / 1e6).toFixed(2)}MB`);

console.log('\n[3] Import media');
await page.setInputFiles('input[type=file]', [
  { name: 'gradient-motion.webm', mimeType: 'video/webm', buffer: Buffer.from(media.video, 'base64') },
  { name: 'tone-440.wav', mimeType: 'audio/wav', buffer: Buffer.from(media.wav, 'base64') },
  { name: 'still-frame.png', mimeType: 'image/png', buffer: Buffer.from(media.png, 'base64') },
]);
await page.waitForFunction(() => document.querySelectorAll('.clip').length >= 3, null, { timeout: 30000 });
await page.waitForTimeout(1200);
check('three clips land on the timeline', (await page.locator('.clip').count()) === 3);
check('media bin shows three cards', (await page.locator('.asset-card').count()) === 3);
const videoVisible = await page.evaluate(() => {
  const c = document.querySelector('.preview-frame canvas');
  if (!c) return { avg: 0 };
  const ctx = c.getContext('2d');
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4 * 97) sum += data[i] + data[i + 1] + data[i + 2];
  return { avg: sum / (data.length / (4 * 97)) / 3 };
});
check('preview renders the first frame', videoVisible.avg > 12, `avg luma ${videoVisible.avg.toFixed(1)}`);
await page.screenshot({ path: path.join(OUT, 'desktop-editing.png') });

console.log('\n[4] Playback');
const tcBefore = await page.locator('.tc-current').innerText();
await page.locator('.pp-btn').click();
await page.waitForTimeout(900);
const tcAfter = await page.locator('.tc-current').innerText();
check('transport advances the playhead', tcBefore !== tcAfter, `${tcBefore} → ${tcAfter}`);
check('preview canvas still painting during playback', (await page.evaluate(() => document.querySelector('.preview-frame canvas').getContext('2d').getImageData(0, 0, 1, 1).data[3])) === 255);
await page.locator('.pp-btn').click();

console.log('\n[5] Split / undo / drag / trim');
const zoom = 64;
const playheadX = 1.0 * zoom;
const ruler = await page.locator('.tl-ruler').boundingBox();
await page.mouse.click(ruler.x + playheadX, ruler.y + 12);
await page.waitForTimeout(200);
const tcSeek = await page.locator('.tc-current').innerText();
check('ruler seeks the playhead', tcSeek.includes(':01:00'), tcSeek);
await page.keyboard.press('s');
await page.waitForTimeout(300);
const afterSplit = await page.locator('.clip').count();
check('split adds clips at the playhead', afterSplit > 3, `${3} → ${afterSplit}`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
check('undo restores clip count', (await page.locator('.clip').count()) === 3);

const firstClip = page.locator('.clip').first();
const box1 = await firstClip.boundingBox();
await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
await page.mouse.down();
await page.mouse.move(box1.x + box1.width / 2 + 48, box1.y + box1.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(250);
const box2 = await page.locator('.clip').first().boundingBox();
check('clip drag moves it on the timeline', Math.abs(box2.x - box1.x - 48) <= 3, `Δ${(box2.x - box1.x).toFixed(1)}px`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);

const stillClip = page.locator('.clip').nth(1);
const stillBox = await stillClip.boundingBox();
await page.mouse.move(stillBox.x + stillBox.width - 5, stillBox.y + stillBox.height / 2);
await page.mouse.down();
await page.mouse.move(stillBox.x + stillBox.width - 65, stillBox.y + stillBox.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(250);
const trimmed = await page.locator('.clip').nth(1).boundingBox();
check('trim handle shortens the clip', trimmed.width < stillBox.width - 40, `${stillBox.width.toFixed(0)}px → ${trimmed.width.toFixed(0)}px`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);

console.log('\n[5b] Transition');
await page.evaluate(() => {
  const s = window.__cutline.getState();
  const track = s.project.tracks.find((t) => t.kind === 'video');
  const still = [...track.clips].sort((a, b) => a.start - b.start)[1];
  s.setTransition(still.id, 'dissolve', 0.6);
  s.setPlayhead(still.start + 0.25);
});
await page.waitForTimeout(600);
check('transition badge shows on the incoming clip', (await page.locator('.clip-transition').count()) >= 1);
check('transition renders without error', (await page.locator('.preview-frame canvas').count()) === 1);

console.log('\n[6] Export');
await page.locator('.topbar .btn.primary').click();
await page.waitForSelector('.modal');
await page.waitForTimeout(500);
await page.locator('.modal select').first().selectOption('1280x720');
const downloadPromise = page.waitForEvent('download', { timeout: 240000 });
const startedAt = Date.now();
await page.locator('.modal-foot .btn.primary').click();
const download = await downloadPromise;
const saved = path.join(OUT, 'export-test.' + download.suggestedFilename().split('.').pop());
await download.saveAs(saved);
const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
await page.waitForSelector('.result-card', { timeout: 30000 });
const resultText = await page.locator('.result-card').innerText();
const buf = fs.readFileSync(saved);
const isWebm = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
const isMp4 = buf.slice(4, 8).toString() === 'ftyp';
check('export produced a valid container', isWebm || isMp4, `${path.basename(saved)} · ${(buf.length / 1e6).toFixed(2)}MB · ${elapsed}s · webm=${isWebm} mp4=${isMp4}`);
check('export result card reports the file', resultText.includes('saved to Downloads'), resultText.replace(/\n/g, ' '));
await page.screenshot({ path: path.join(OUT, 'desktop-export.png') });
await page.locator('.modal-head .btn.ghost.icon').click();
await page.waitForTimeout(300);

console.log('\n[7] Persistence across reload');
const clipCount = await page.locator('.clip').count();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.app');
await page.waitForTimeout(1500);
const restoredClips = await page.locator('.clip').count();
const restoredAssets = await page.locator('.asset-card').count();
check('autosave restores the timeline', restoredClips === clipCount, `${clipCount} → ${restoredClips} clips`);
check('autosave restores media', restoredAssets === 3, `${restoredAssets} cards`);

console.log('\n[7b] Offline reload');
await context.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.app', { timeout: 20000 });
await page.waitForTimeout(1800);
check('app shell loads offline', (await page.locator('.timeline-dock').count()) === 1);
check('project restores offline', (await page.locator('.clip').count()) === clipCount, `${clipCount} clips`);
await context.setOffline(false).catch(() => undefined);

console.log('\n[8] Mobile layout');
const mobile = await context.newPage();
await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.goto(URL, { waitUntil: 'networkidle' });
await mobile.waitForSelector('.app');
await mobile.waitForTimeout(1500);
check('mobile tab bar visible', await mobile.locator('.mobile-tabs').isVisible());
check('desktop panels hidden on mobile', !(await mobile.locator('.panel').first().isVisible()));
await mobile.screenshot({ path: path.join(OUT, 'mobile-editing.png') });
await mobile.locator('.tab').first().click();
await mobile.waitForSelector('.sheet');
check('media sheet opens on tap', await mobile.locator('.sheet').isVisible());
await mobile.screenshot({ path: path.join(OUT, 'mobile-media.png') });
await mobile.locator('.sheet-head .btn').click();
await mobile.locator('.tab').nth(1).click();
await mobile.waitForSelector('.sheet');
await mobile.screenshot({ path: path.join(OUT, 'mobile-inspector.png') });

check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

fs.writeFileSync(path.join(OUT, 'smoke-report.json'), JSON.stringify({ results, failures, errors }, null, 2));
console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `FAILURES (${failures.length}): ${failures.join(', ')}`}`);
await browser.close();
process.exit(failures.length === 0 ? 0 : 1);