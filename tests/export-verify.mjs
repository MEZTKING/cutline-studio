import { chromium } from 'playwright-core';
import fs from 'node:fs';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
const b64 = fs.readFileSync('test-results/export-test.webm').toString('base64');
const out = await page.evaluate(async (b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'video/webm' });
  const src = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.src = src; v.muted = true; v.playsInline = true;
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('video failed')); setTimeout(() => rej(new Error('timeout')), 10000); });
  const meta = { duration: v.duration, w: v.videoWidth, h: v.videoHeight };
  v.currentTime = 2.2;
  await new Promise((res) => { v.onseeked = res; setTimeout(res, 3000); });
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
  const ctx = c.getContext('2d'); ctx.drawImage(v, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * 211) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  const frame = { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  const buf = await blob.arrayBuffer();
  const ac = new AudioContext();
  const audio = await ac.decodeAudioData(buf.slice(0));
  let sum = 0, count = 0;
  const ch = audio.getChannelData(0);
  for (let i = 0; i < Math.min(ch.length, audio.sampleRate); i += 8) { sum += ch[i] * ch[i]; count++; }
  const rms = Math.sqrt(sum / count);
  return { meta, frame, audioDuration: audio.duration, channels: audio.numberOfChannels, rms };
}, b64);
console.log(JSON.stringify(out, null, 2));
await browser.close();
