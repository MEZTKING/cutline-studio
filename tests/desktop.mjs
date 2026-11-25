import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = 'test-results';
fs.mkdirSync(OUT, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cutline-desktop-'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cutline-project-'));
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const errors = [];

const app = await electron.launch({
  args: ['.', '--no-sandbox', '--disable-gpu'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    DISPLAY: process.env.DISPLAY || ':99',
    CUTLINE_USER_DATA: userData,
    CUTLINE_TEST: '1',
    CUTLINE_SOFTWARE: '1',
    ELECTRON_DISABLE_SANDBOX: '1',
  },
});
const win = await app.firstWindow();
win.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
win.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 180)); });
await win.waitForSelector('.app', { timeout: 30000 });
await win.waitForTimeout(1000);

console.log('\n[1] Shell + native bridge');
check('desktop window loads the editor', (await win.locator('.timeline-dock').count()) === 1);
const info = await win.evaluate(() => window.cutlineDesktop.info());
check('native bridge is exposed', Boolean(await win.evaluate(() => window.cutlineDesktop?.isDesktop)));
check('bundled FFmpeg is found', typeof info.ffmpeg === 'string' && fs.existsSync(info.ffmpeg), info.ffmpeg);
const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label));
check('native menu installed', Array.isArray(menu) && menu.includes('File') && menu.includes('Edit'), JSON.stringify(menu));
check('window title set', (await win.title()).includes('Cutline Studio'), await win.title());

console.log('\n[2] Import from disk (streamed, not copied)');
const image = path.resolve('tests/fixtures/face-public.jpg');
const video = path.join(work, 'disk-test.webm');
const videoB64 = await win.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 360;
  const ctx = c.getContext('2d');
  const ac = new AudioContext();
  const osc = ac.createOscillator();
  osc.frequency.value = 330;
  const dest = ac.createMediaStreamDestination();
  const gain = ac.createGain();
  gain.gain.value = 0.08;
  osc.connect(gain).connect(dest);
  osc.start();
  const stream = c.captureStream(30);
  stream.addTrack(dest.stream.getAudioTracks()[0]);
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 1_500_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start(100);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const draw = () => {
      const t = Math.min(1, (performance.now() - t0) / 1800);
      const g = ctx.createLinearGradient(0, 0, 640, 360);
      g.addColorStop(0, `hsl(${160 + t * 40} 70% 22%)`);
      g.addColorStop(1, `hsl(${200 + t * 30} 70% 12%)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, 640, 360);
      ctx.fillStyle = '#5cf2b0'; ctx.beginPath(); ctx.arc(80 + t * 480, 180, 40, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#eafff8'; ctx.font = 'bold 26px sans-serif'; ctx.fillText('DESKTOP TEST FOOTAGE', 40, 320);
      if (t < 1) requestAnimationFrame(draw); else resolve();
    };
    draw();
  });
  rec.stop(); await stopped;
  osc.stop(); await ac.close();
  const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
});
fs.writeFileSync(video, Buffer.from(videoB64, 'base64'));
await win.evaluate((paths) => window.__cutlineDesktop.importPaths(paths), [video, image]);
await win.waitForFunction(() => document.querySelectorAll('.clip').length >= 2, null, { timeout: 60000 });
await win.waitForTimeout(1200);
const imported = await win.evaluate(() => {
  const s = window.__cutline.getState();
  return {
    clips: document.querySelectorAll('.clip').length,
    assets: Object.values(s.assets).map((a) => ({ name: a.name, kind: a.kind, url: a.url, path: a.path, audio: !!a.audioBuffer, dur: a.duration })),
  };
});
console.log('   assets:', JSON.stringify(imported.assets));
check('disk media imported', imported.clips >= 2);
check('assets keep their source paths', imported.assets.every((a) => typeof a.path === 'string' && fs.existsSync(a.path)));
check('media streams over the custom protocol', imported.assets.every((a) => a.url.startsWith('cutline-media://')));
check('video audio extracted through FFmpeg', imported.assets.some((a) => a.kind === 'video' && a.audio));
check('generated clip is two seconds', imported.assets.some((a) => a.kind === 'video' && a.dur > 1.5));

const stream = await win.evaluate(async () => {
  const s = window.__cutline.getState();
  const asset = Object.values(s.assets).find((a) => a.kind === 'video');
  const v = document.createElement('video');
  v.src = asset.url; v.muted = true; v.preload = 'auto';
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('load failed')); setTimeout(() => rej(new Error('timeout')), 15000); });
  v.currentTime = 1;
  await new Promise((res) => { v.onseeked = res; setTimeout(res, 5000); });
  return { duration: v.duration, w: v.videoWidth, h: v.videoHeight, at: v.currentTime };
});
const videoDuration = imported.assets.find((a) => a.kind === 'video')?.dur ?? 0;
check('range streaming supports seeking', Math.abs(stream.at - 1) < 0.3 && stream.w === 640 && videoDuration > 1.5, JSON.stringify({ ...stream, assetDuration: videoDuration }));

console.log('\n[3] Save + reopen project');
const projectFile = path.join(work, 'heavy-test.cutline');
const saved = await win.evaluate((target) => window.__cutlineDesktop.saveTo(target), projectFile);
check('project written to disk', saved && fs.existsSync(projectFile), projectFile);
const parsed = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
check('project file records media paths', parsed.format === 'cutline-project' && parsed.assets.length >= 2 && parsed.assets.every((a) => a.path));
check('autosave mirror written', fs.existsSync(path.join(userData, 'autosave.cutline')));
await win.evaluate(() => window.__cutline.getState().resetProject());
await win.waitForTimeout(300);
check('new project clears the timeline', (await win.locator('.clip').count()) === 0);
await win.evaluate((target) => window.__cutlineDesktop.openPath(target), projectFile);
await win.waitForTimeout(1800);
const reopened = await win.evaluate(() => ({
  clips: document.querySelectorAll('.clip').length,
  assets: Object.keys(window.__cutline.getState().assets).length,
  project: window.__cutline.getState().project.name,
}));
check('project reopens with media', reopened.clips >= 2 && reopened.assets >= 2, JSON.stringify(reopened));

console.log('\n[4] Native master export');
const inputB64 = fs.readFileSync(video).toString('base64');
const output = path.join(work, 'native-master.mp4');
const transcode = await win.evaluate(async ({ b64, target }) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return window.cutlineDesktop.transcode({
    data: bytes.buffer,
    inputExtension: 'webm',
    suggestedName: 'native-master',
    codec: 'h264',
    quality: 'balanced',
    durationSeconds: 2,
    outputPath: target,
  });
}, { b64: inputB64, target: output });
check('FFmpeg master exported', transcode.ok && fs.existsSync(output), JSON.stringify(transcode).slice(0, 160));
if (transcode.ok) {
  check('master has real size', fs.statSync(output).size > 100_000, `${(fs.statSync(output).size / 1e6).toFixed(2)} MB`);
  let probe = '';
  try {
    execFileSync(info.ffmpeg, ['-hide_banner', '-i', output, '-f', 'null', '-'], { stdio: 'pipe' });
    probe = 'decoded';
  } catch (err) {
    probe = String(err).slice(0, 200);
  }
  check('master decodes cleanly', probe === 'decoded', probe);
}

const proresOut = path.join(work, 'native-master.mov');
const prores = await win.evaluate(async ({ b64, target }) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return window.cutlineDesktop.transcode({
    data: bytes.buffer,
    inputExtension: 'webm',
    suggestedName: 'native-master-prores',
    codec: 'prores',
    quality: 'balanced',
    durationSeconds: 2,
    outputPath: target,
  });
}, { b64: inputB64, target: proresOut });
check('ProRes master exported', prores.ok && fs.existsSync(proresOut), JSON.stringify(prores).slice(0, 140));
if (prores.ok) {
  let ok = true;
  try {
    execFileSync(info.ffmpeg, ['-hide_banner', '-v', 'error', '-i', proresOut, '-f', 'null', '-'], { stdio: 'pipe' });
  } catch {
    ok = false;
  }
  check('ProRes master decodes', ok, `${(fs.statSync(proresOut).size / 1e6).toFixed(2)} MB`);
}

console.log('\n[5] UI');
await win.evaluate(() => window.__cutline.getState().setPlayhead(1.2));
await win.waitForTimeout(700);
await win.screenshot({ path: `${OUT}/desktop-heavy.png` });
await win.locator('.topbar .btn.primary').click();
await win.waitForSelector('.modal');
await win.waitForTimeout(800);
const exportText = await win.locator('.modal').innerText();
check('export dialog exposes FFmpeg master controls', exportText.includes('Desktop master with FFmpeg') && exportText.includes('ProRes'));
await win.screenshot({ path: `${OUT}/desktop-heavy-export.png` });
await win.locator('.modal-head .btn.ghost.icon').click();
await win.waitForTimeout(300);

check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await app.close();

console.log('\n[6] Relaunch restores the saved project');
const app2 = await electron.launch({
  args: ['.', '--no-sandbox', '--disable-gpu'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    DISPLAY: process.env.DISPLAY || ':99',
    CUTLINE_USER_DATA: userData,
    CUTLINE_TEST: '1',
    CUTLINE_SOFTWARE: '1',
    ELECTRON_DISABLE_SANDBOX: '1',
  },
});
const win2 = await app2.firstWindow();
await win2.waitForSelector('.app', { timeout: 30000 });
await win2.waitForTimeout(2200);
const restored = await win2.evaluate(() => ({
  clips: document.querySelectorAll('.clip').length,
  assets: Object.keys(window.__cutline.getState().assets).length,
  offMedia: Object.values(window.__cutline.getState().assets).every((a) => a.url.startsWith('cutline-media://')),
}));
check('last project reopens on launch', restored.clips >= 2 && restored.assets >= 2, JSON.stringify(restored));
check('reopened media uses disk URLs', restored.offMedia, JSON.stringify(restored));
await app2.close();

fs.writeFileSync(`${OUT}/desktop-report.json`, JSON.stringify({ checks, errors, info, stream, imported, transcode, restored }, null, 2));
process.exit(checks.every((c) => c.ok) ? 0 : 1);
