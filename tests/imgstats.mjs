import { chromium } from 'playwright-core';
import fs from 'node:fs';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
const b64 = fs.readFileSync('/tmp/user-image.png').toString('base64');
const out = await page.evaluate(async (data) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0,0,c.width,c.height).data;
  let sum=0,sum2=0,n=0; const colors=new Set();
  for (let i=0;i<d.length;i+=4*7) { const l=d[i]*.2126+d[i+1]*.7152+d[i+2]*.0722; sum+=l; sum2+=l*l; n++; if(colors.size<5000) colors.add(((d[i]>>4)<<8)|((d[i+1]>>4)<<4)|(d[i+2]>>4)); }
  const mean=sum/n;
  // sample quadrants
  const at=(x,y)=>{ const i=(Math.floor(c.height*y)*c.width+Math.floor(c.width*x))*4; return [d[i],d[i+1],d[i+2]]; };
  return { w: img.width, h: img.height, mean:+mean.toFixed(1), std:+Math.sqrt(sum2/n-mean*mean).toFixed(1), colors:colors.size, samples:{tl:at(.1,.1), tc:at(.5,.1), tr:at(.9,.1), mid:at(.5,.5), bottom:at(.5,.9)} };
}, b64);
console.log(JSON.stringify(out,null,2));
await browser.close();
