'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const AdmZip = require('adm-zip');
const {
  compareVersions,
  platformKey,
  artifactFor,
  isValidSha,
  sha256File,
  findExecutable,
  fetchJson,
} = require('./update-core.cjs');

const ALLOW_DEV = process.env.CUTLINE_UPDATE_ALLOW_DEV === '1';

class Updater {
  constructor() {
    this.abort = null;
    this.downloaded = null;
  }

  async check(feedUrl, currentVersion) {
    const manifest = await fetchJson(feedUrl);
    if (!manifest || !manifest.version) throw new Error('Update feed has no version.');
    const artifact = artifactFor(manifest, platformKey());
    if (!artifact) return null;
    if (compareVersions(manifest.version, currentVersion) <= 0) return null;
    if (!artifact.url || !/^https?:\/\//i.test(artifact.url)) throw new Error('Update has an invalid download URL.');
    if (!isValidSha(artifact.sha256)) throw new Error('Update is missing a valid SHA-256 checksum.');
    return {
      version: String(manifest.version),
      notes: String(manifest.notes || ''),
      released: manifest.released || null,
      size: Number(artifact.size) || 0,
      url: new URL(artifact.url, feedUrl).toString(),
      sha256: artifact.sha256.toLowerCase(),
      executable: artifact.executable || path.basename(process.execPath),
      currentVersion,
      platform: platformKey(),
      feedUrl,
    };
  }

  cancel() {
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
    }
  }

  async download(info, onProgress) {
    if (!app.isPackaged && !ALLOW_DEV) throw new Error('Updates are disabled in development builds.');
    this.cancel();
    const controller = new AbortController();
    this.abort = controller;
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cutline-update-'));
    const zipPath = path.join(tmpDir, 'update.zip');
    const out = fs.createWriteStream(zipPath);
    let received = 0;
    let lastSent = 0;
    try {
      const res = await fetch(info.url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'user-agent': `Cutline/${app.getVersion()}` },
      });
      if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}.`);
      const total = Number(res.headers.get('content-length')) || info.size || 0;
      const hash = crypto.createHash('sha256');
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        received += value.length;
        if (!out.write(value)) await new Promise((resolve) => out.once('drain', resolve));
        const now = Date.now();
        if (now - lastSent > 100 || received === total) {
          lastSent = now;
          onProgress({ received, total, percent: total ? Math.min(100, (received / total) * 100) : 0 });
        }
      }
      await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
      const digest = hash.digest('hex');
      if (digest.toLowerCase() !== info.sha256.toLowerCase()) {
        throw new Error('Downloaded update failed its SHA-256 check. It was discarded.');
      }
      this.abort = null;
      this.downloaded = { path: zipPath, size: received, sha256: digest, tmpDir };
      return this.downloaded;
    } catch (err) {
      out.destroy();
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) throw new Error('Update download cancelled.');
      throw err;
    } finally {
      if (this.abort === controller) this.abort = null;
    }
  }

  async install(info) {
    if (!this.downloaded) throw new Error('Download the update first.');
    if (!app.isPackaged && !ALLOW_DEV) throw new Error('Updates are disabled in development builds.');
    const download = this.downloaded;
    const actual = await sha256File(download.path);
    if (actual.toLowerCase() !== info.sha256.toLowerCase()) throw new Error('Update file changed after download.');

    const appDir = process.env.PORTABLE_EXECUTABLE_DIR
      ? path.resolve(process.env.PORTABLE_EXECUTABLE_DIR)
      : path.dirname(process.execPath);
    try {
      await fsp.access(path.dirname(appDir), fs.constants.W_OK);
    } catch {
      throw new Error(`The app folder is not writable. Move Cutline to a user folder such as Documents, then update.`);
    }
    if (process.platform === 'darwin') throw new Error('Automatic in-place updates are not enabled for macOS builds yet.');

    const stage = `${appDir}.update-${Date.now()}`;
    await fsp.rm(stage, { recursive: true, force: true }).catch(() => undefined);
    await fsp.mkdir(stage, { recursive: true });
    try {
      new AdmZip(download.path).extractAllTo(stage, true);
    } catch (err) {
      await fsp.rm(stage, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(`Could not extract the update: ${err.message}`);
    }
    const exeName = info.executable || path.basename(process.execPath);
    const found = findExecutable(stage, exeName);
    if (!found) {
      await fsp.rm(stage, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(`The update does not contain ${exeName}.`);
    }
    const sourceRoot = path.dirname(found);
    const isWindows = process.platform === 'win32';
    const scriptPath = path.join(os.tmpdir(), `cutline-apply-update-${Date.now()}.${isWindows ? 'ps1' : 'sh'}`);
    if (isWindows) await fsp.writeFile(scriptPath, WINDOWS_HELPER, 'utf8');
    else {
      await fsp.writeFile(scriptPath, UNIX_HELPER, 'utf8');
      await fsp.chmod(scriptPath, 0o755);
    }

    let child;
    try {
      if (isWindows) {
        child = spawn(
          'powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath, String(process.pid), appDir, sourceRoot, exeName],
          { cwd: os.tmpdir(), detached: true, stdio: 'ignore', windowsHide: true },
        );
      } else {
        child = spawn('/bin/sh', [scriptPath, String(process.pid), appDir, sourceRoot, exeName], {
          cwd: os.tmpdir(),
          detached: true,
          stdio: 'ignore',
        });
      }
      child.unref();
    } catch (err) {
      await fsp.rm(stage, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(`Could not start the update helper: ${err.message}`);
    }
    setTimeout(() => app.quit(), 400);
    return { ok: true, appDir };
  }
}

const WINDOWS_HELPER = String.raw`param(
  [int]$AppPid,
  [string]$AppDir,
  [string]$StageDir,
  [string]$ExeName
)
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'cutline-update.log'
try { Wait-Process -Id $AppPid -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Seconds 2
$parent = Split-Path -LiteralPath $AppDir -Parent
$leaf = Split-Path -LiteralPath $AppDir -Leaf
$backup = Join-Path $parent ($leaf + '.old')
try {
  if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue }
  Move-Item -LiteralPath $AppDir -Destination $backup -Force
  Move-Item -LiteralPath $StageDir -Destination $AppDir -Force
  $exe = Join-Path $AppDir $ExeName
  Start-Process -FilePath $exe -WorkingDirectory $AppDir
  Start-Sleep -Seconds 2
  Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
  "updated to stage $StageDir" | Out-File -FilePath $log -Encoding utf8
} catch {
  "update failed: $_" | Out-File -FilePath $log -Encoding utf8
  if (Test-Path -LiteralPath $backup) {
    if (Test-Path -LiteralPath $AppDir) { Remove-Item -LiteralPath $AppDir -Recurse -Force -ErrorAction SilentlyContinue }
    Move-Item -LiteralPath $backup -Destination $AppDir -Force
    Start-Process -FilePath (Join-Path $AppDir $ExeName) -WorkingDirectory $AppDir
  }
}`;

const UNIX_HELPER = String.raw`#!/bin/sh
pid="$1"
app="$2"
stage="$3"
exe="$4"
while kill -0 "$pid" 2>/dev/null; do sleep 0.5; done
sleep 1
parent=$(dirname "$app")
backup="$app.old-$(date +%s)"
if mv "$app" "$backup"; then
  if mv "$stage" "$app"; then
    chmod +x "$app/$exe" 2>/dev/null || true
    ( cd "$app" && nohup "./$exe" >/dev/null 2>&1 & )
    rm -rf "$backup" 2>/dev/null || true
  else
    mv "$backup" "$app"
  fi
fi
`;

module.exports = { Updater, WINDOWS_HELPER, UNIX_HELPER };
