import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1255/chrome-linux-arm64/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app');
const media = await page.evaluate(async () => {
  const toB64 = (buf) => { const b = new Uint8Array(buf); let s=''; for (let i=0;i<b.length;i+=0x8000) s += String.fromCharCode(...b.subarray(i,i+0x8000)); return btoa(s); };
  const vc = document.createElement('canvas'); vc.width=640; vc.height=360;
  const x = vc.getContext('2d');
  const stream = vc.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 800000 });
  const chunks=[]; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const stop = new Promise(r => rec.onstop=r); rec.start(100);
  const t0=performance.now();
  await new Promise(res => { const f=()=>{ const t=(performance.now()-t0)/1000; x.fillStyle=`hsl(${t*200%360} 80% 50%)`; x.fillRect(0,0,640,360); if(t<1.6) requestAnimationFrame(f); else res(); }; f(); });
  rec.stop(); await stop;
  const vb = await new Blob(chunks,{type:'video/webm'}).arrayBuffer();
  const sr=48000,n=sr*2,d=new Int16Array(n); for(let i=0;i<n;i++) d[i]=Math.sin(2*Math.PI*440*i/sr)*8000;
  const h=new ArrayBuffer(44), dv=new DataView(h); const ws=(o,s)=>[...s].forEach((c,i)=>dv.setUint8(o+i,c.charCodeAt(0)));
  ws(0,'RIFF'); dv.setUint32(4,36+n*2,true); ws(8,'WAVEfmt '); dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,1,true); dv.setUint32(24,sr,true); dv.setUint32(28,sr*2,true); dv.setUint16(32,2,true); dv.setUint16(34,16,true); ws(36,'data'); dv.setUint32(40,n*2,true);
  const wav=new Uint8Array(44+n*2); wav.set(new Uint8Array(h),0); wav.set(new Uint8Array(d.buffer),44);
  const ic=document.createElement('canvas'); ic.width=640; ic.height=360; const ix=ic.getContext('2d'); ix.fillStyle='#0f766e'; ix.fillRect(0,0,640,360); ix.fillStyle='#fff'; ix.font='40px sans-serif'; ix.fillText('STILL', 40, 180);
  const png=await new Promise(r=>ic.toBlob(b=>r(b),'image/png'));
  return { video: toB64(vb), wav: toB64(wav.buffer), png: toB64(await png.arrayBuffer()) };
});
await page.setInputFiles('input[type=file]', [
  { name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.from(media.video,'base64') },
  { name: 'tone.wav', mimeType: 'audio/wav', buffer: Buffer.from(media.wav,'base64') },
  { name: 'still.png', mimeType: 'image/png', buffer: Buffer.from(media.png,'base64') },
]);
await page.waitForFunction(() => document.querySelectorAll('.clip').length >= 3, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const s = window.__cutline.getState();
  return {
    zoom: s.zoom,
    tracks: s.project.tracks.map(t => ({ name: t.name, kind: t.kind, clips: t.clips.map(c => ({ name: c.name, start: c.start, dur: c.duration, inPoint: c.inPoint })) })),
    dom: [...document.querySelectorAll('.clip')].map(el => ({ label: el.querySelector('.clip-label')?.textContent, left: el.style.left, width: el.style.width })),
    duration: document.querySelector('.tc-total')?.textContent,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
