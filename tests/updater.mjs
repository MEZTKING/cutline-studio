import { _electron as electron } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

const OUT = 'test-results';
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutline-update-test-'));
const userData = path.join(tmp, 'userdata');
fs.mkdirSync(userData, { recursive: true });
const zipPath = path.join(tmp, 'update.zip');
const zip = new AdmZip();
zip.addFile('README.txt', Buffer.from('Cutline update integration test\n'));
zip.addFile('Cutline Studio.exe', Buffer.from('not a real exe'));
zip.writeZip(zipPath);
const zipBuf = fs.readFileSync(zipPath);
const sha256 = crypto.createHash('sha256').update(zipBuf).digest('hex');
const port = 5197;
const manifest = {
  version: '99.0.0',
  released: new Date().toISOString(),
  notes: 'Integration test update\n- SHA verification\n- progress UI',
  platforms: {
    'linux-arm64': { url: `http://127.0.0.1:${port}/update.zip`, sha256, size: zipBuf.length, executable: 'Cutline Studio.exe' },
    'linux-x64': { url: `http://127.0.0.1:${port}/update.zip`, sha256, size: zipBuf.length, executable: 'Cutline Studio.exe' },
    'win32-x64': { url: `http://127.0.0.1:${port}/update.zip`, sha256, size: zipBuf.length, executable: 'Cutline Studio.exe' },
  },
};
const server = http.createServer((req, res) => {
  if (req.url === '/latest.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(manifest));
  } else if (req.url === '/update.zip') {
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': zipBuf.length });
    res.end(zipBuf);
  } else {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

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
    CUTLINE_UPDATE_ALLOW_DEV: '1',
    CUTLINE_UPDATE_URL: `http://127.0.0.1:${port}/latest.json`,
    ELECTRON_DISABLE_SANDBOX: '1',
  },
});
const win = await app.firstWindow();
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForSelector('.app', { timeout: 30000 });

console.log('\n[1] Automatic version check');
await win.waitForSelector('.update-pill', { timeout: 20000 });
const pill = await win.locator('.update-pill').innerText();
check('startup check surfaces an update badge', pill.includes('99.0.0'), pill);

const config = await win.evaluate(() => window.cutlineDesktop.updateConfig());
check('update config exposes feed + dev allowance', config.feedUrl.includes('/latest.json') && config.allowDev === true, JSON.stringify(config));

console.log('\n[2] Update dialog + verified download');
await win.locator('.update-pill').click();
await win.waitForSelector('.updates-modal');
check('dialog shows latest version', (await win.locator('.updates-modal').innerText()).includes('v99.0.0'));
check('release notes render', (await win.locator('.update-notes').innerText()).includes('SHA verification'));
await win.locator('button', { hasText: 'Download update' }).click();
await win.waitForFunction(() => document.querySelector('.update-status.success')?.textContent?.includes('SHA-256 verified'), null, { timeout: 30000 });
check('download verifies SHA-256 and becomes ready', true);
await win.screenshot({ path: `${OUT}/desktop-update.png` });

const dirs = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('cutline-update-'));
dirs.sort((a, b) => fs.statSync(path.join(os.tmpdir(), b)).mtimeMs - fs.statSync(path.join(os.tmpdir(), a)).mtimeMs);
const downloaded = dirs.length ? path.join(os.tmpdir(), dirs[0], 'update.zip') : '';
const downloadedHash = downloaded && fs.existsSync(downloaded) ? crypto.createHash('sha256').update(fs.readFileSync(downloaded)).digest('hex') : '';
check('downloaded file matches manifest hash', downloadedHash === sha256, `${downloadedHash.slice(0, 12)}…`);

check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await app.close();
server.close();
for (const dir of dirs) fs.rmSync(path.join(os.tmpdir(), dir), { recursive: true, force: true });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(checks.every((c) => c.ok) ? '\nUPDATER OK' : '\nUPDATER FAILED');
process.exit(checks.every((c) => c.ok) ? 0 : 1);
