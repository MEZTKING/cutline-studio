import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const electron = require('electron');
const ffmpeg = require('ffmpeg-static');
const root = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutline-cli-test-'));
const userData = path.join(tmp, 'userdata');
fs.mkdirSync(userData);
const assetPath = path.resolve('tests/fixtures/source-av.webm');
const projectPath = path.join(tmp, 'project.cutline');
const directOut = path.join(tmp, 'direct.webm');
const apiOut = path.join(tmp, 'api.webm');
const project = {
  format: 'cutline-project', version: 1, savedAt: Date.now(),
  project: {
    id: 'prj_cli', name: 'CLI Test', width: 960, height: 540, fps: 30, autoSettings: false,
    tracks: [
      { id: 'trk_v', kind: 'video', name: 'V1', muted: false, solo: false, hidden: false, locked: false, clips: [{
        id: 'clp_v', assetId: 'ast_v', name: 'source', start: 0, duration: 2, inPoint: 0, speed: 1,
        volume: 1, fadeIn: 0, fadeOut: 0, fadeCurve: 'linear', pan: 0, eqLow: 0, eqMid: 0, eqHigh: 0, compress: 0,
        muted: false, audioType: null, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
        color: { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0, temperature: 0, vignette: 0 },
        transition: null, keyframes: {},
      }] },
      { id: 'trk_a', kind: 'audio', name: 'A1', muted: false, solo: false, hidden: false, locked: false, clips: [] },
    ],
  },
  assets: [{ id: 'ast_v', name: 'source', kind: 'video', duration: 4, width: 960, height: 540, hasAudio: true, path: assetPath }],
};
fs.writeFileSync(projectPath, JSON.stringify(project));

const baseEnv = { ...process.env, DISPLAY: process.env.DISPLAY || ':99', CUTLINE_USER_DATA: userData, CUTLINE_SOFTWARE: '1', ELECTRON_DISABLE_SANDBOX: '1' };
function run(args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(electron, [root, '--no-sandbox', ...args], { env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI timed out')); }, timeout);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
function streams(file) {
  const r = require('node:child_process').spawnSync(ffmpeg, ['-i', file], { encoding: 'utf8' });
  return (r.stderr || '').split('\n').filter((l) => l.includes('Stream #')).join('\n');
}
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };

console.log('\n[1] Direct headless CLI render');
const direct = await run(['--render', projectPath, '--out', directOut, '--format', 'webm', '--width', '640', '--height', '360', '--fps', '24', '--json']);
check('CLI exits cleanly', direct.code === 0, direct.stderr.slice(-300));
check('CLI reports a verified output', /"event":"done"/.test(direct.stdout) && /"bytes":\d+/.test(direct.stdout), direct.stdout.slice(-300));
const directStreams = fs.existsSync(directOut) ? streams(directOut) : '';
check('CLI output has video + audio', /Video: vp9/.test(directStreams) && /Audio: opus/.test(directStreams), directStreams.replace(/\n/g, ' | '));

console.log('\n[2] Local HTTP API');
const port = 4397;
const server = spawn(electron, [root, '--no-sandbox', '--serve', '--port', String(port), '--token', 'testtoken'], { env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d.toString(); });
server.stderr.on('data', (d) => { serverLog += d.toString(); });
const base = `http://127.0.0.1:${port}`;
let health = null;
for (let i = 0; i < 40 && !health; i++) {
  try { const r = await fetch(`${base}/v1/health`); if (r.ok) health = await r.json(); } catch { /* wait */ }
  if (!health) await new Promise((r) => setTimeout(r, 250));
}
check('API health responds', health?.ok === true, JSON.stringify(health));
const unauth = await fetch(`${base}/v1/jobs`);
check('API rejects unauthenticated requests', unauth.status === 401, String(unauth.status));
const submit = await fetch(`${base}/v1/render`, {
  method: 'POST',
  headers: { authorization: 'Bearer testtoken', 'content-type': 'application/json' },
  body: JSON.stringify({ projectPath, outputPath: apiOut, format: 'webm', width: 640, height: 360, fps: 24 }),
});
const submitted = await submit.json();
check('API accepts a render job', submit.status === 202 && Boolean(submitted.id), JSON.stringify(submitted));
let job = null;
for (let i = 0; i < 120; i++) {
  const r = await fetch(`${base}/v1/jobs/${submitted.id}`, { headers: { authorization: 'Bearer testtoken' } });
  job = await r.json();
  if (job.status === 'done' || job.status === 'error') break;
  await new Promise((r) => setTimeout(r, 250));
}
check('API job completes', job?.status === 'done', JSON.stringify(job));
const apiStreams = fs.existsSync(apiOut) ? streams(apiOut) : '';
check('API output has video + audio', /Video: vp9/.test(apiStreams) && /Audio: opus/.test(apiStreams), apiStreams.replace(/\n/g, ' | '));
try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill('SIGTERM'); }
await new Promise((r) => setTimeout(r, 300));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(checks.every((c) => c.ok) ? '\nCLI/API OK' : '\nCLI/API FAILED');
process.exit(checks.every((c) => c.ok) ? 0 : 1);
