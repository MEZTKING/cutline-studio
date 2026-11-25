/**
 * Cutline Studio — desktop (heavy) shell.
 *
 * The renderer is the same editor as the web build. This process adds what a
 * browser cannot do: disk-streamed media, native project files, crash-safe
 * autosave, and FFmpeg master exports (H.264 / HEVC / ProRes).
 */
const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { Readable } = require('node:stream');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

app.setName('Cutline Studio');
if (process.env.CUTLINE_USER_DATA) {
  app.setPath('userData', process.env.CUTLINE_USER_DATA);
}
if (process.env.CUTLINE_SOFTWARE === '1') {
  app.disableHardwareAcceleration();
}

const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.CUTLINE_DEV_URL || null;
const IS_TEST = process.env.CUTLINE_TEST === '1';
const MEDIA_FILTERS = [
  {
    name: 'Media',
    extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ogv', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'],
  },
  { name: 'All files', extensions: ['*'] },
];

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cutline',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
  {
    scheme: 'cutline-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

const allowedMedia = new Set();
let mainWindow = null;
let currentProjectPath = null;
let exporting = false;

function mediaUrlFor(filePath) {
  return `cutline-media://file/${Buffer.from(path.resolve(filePath), 'utf8').toString('base64url')}`;
}

function allowMedia(filePath) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  allowedMedia.add(resolved);
  return resolved;
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function autosaveFile() {
  return path.join(app.getPath('userData'), 'autosave.cutline');
}

function readJsonSync(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value), 'utf8');
  await fsp.rename(tmp, file);
}

function loadSettings() {
  return readJsonSync(settingsFile()) || {};
}

async function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  await writeJsonAtomic(settingsFile(), next);
}

function ffmpegPath() {
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  if (app.isPackaged) {
    const packaged = path.join(process.resourcesPath, 'ffmpeg', name);
    if (fs.existsSync(packaged)) return packaged;
  }
  try {
    const resolved = require('ffmpeg-static');
    if (typeof resolved === 'string' && fs.existsSync(resolved)) return resolved;
  } catch {
    /* not installed */
  }
  return null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.tflite': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
};

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

async function serveFile(file, request) {
  const stat = await fsp.stat(file);
  const type = mimeFor(file);
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
  const range = request.headers.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : stat.size - 1;
      if (!match[1] && match[2]) {
        start = Math.max(0, stat.size - Number(match[2]));
        end = stat.size - 1;
      }
      if (start >= stat.size || start > end) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
      }
      end = Math.min(end, stat.size - 1);
      return new Response(Readable.toWeb(createReadStream(file, { start, end })), {
        status: 206,
        headers: {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Content-Length': String(end - start + 1),
        },
      });
    }
  }
  return new Response(Readable.toWeb(createReadStream(file)), {
    status: 200,
    headers: { ...headers, 'Content-Length': String(stat.size) },
  });
}

function registerProtocols() {
  protocol.handle('cutline', async (request) => {
    const url = new URL(request.url);
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!relative) relative = 'index.html';
    const candidate = path.normalize(path.join(DIST, relative));
    if (!candidate.startsWith(DIST + path.sep) && candidate !== DIST) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      await fsp.access(candidate);
      return serveFile(candidate, request);
    } catch {
      // SPA fallback for client-side routes.
      try {
        return await net.fetch(pathToFileURL(path.join(DIST, 'index.html')).toString());
      } catch {
        return new Response('Not found', { status: 404 });
      }
    }
  });

  protocol.handle('cutline-media', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'file') return new Response('Bad media URL', { status: 400 });
    let decoded;
    try {
      decoded = Buffer.from(url.pathname.replace(/^\/+/, ''), 'base64url').toString('utf8');
    } catch {
      return new Response('Bad media path', { status: 400 });
    }
    const resolved = path.resolve(decoded);
    if (!allowedMedia.has(resolved)) return new Response('Media not allowed', { status: 403 });
    try {
      return await serveFile(resolved, request);
    } catch {
      return new Response('Media not found', { status: 404 });
    }
  });
}

function sendMenu(command) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('menu-command', command);
  }
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => sendMenu('new-project') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => sendMenu('open-project') },
        { type: 'separator' },
        { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save-project') },
        { label: 'Save Project As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenu('save-project-as') },
        { type: 'separator' },
        { label: 'Import Media…', accelerator: 'CmdOrCtrl+I', click: () => sendMenu('import-media') },
        { type: 'separator' },
        { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: () => sendMenu('export') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => sendMenu('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendMenu('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Cutline Studio',
          click: async () => {
            await dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Cutline Studio',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
              message: `Cutline Studio ${app.getVersion()}`,
              detail: `Desktop (heavy) build\nFFmpeg: ${ffmpegPath() || 'not found'}\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
            });
          },
        },
        { label: 'Open Data Folder', click: () => shell.openPath(app.getPath('userData')) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#060709',
    show: false,
    title: 'Cutline Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_URL) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadURL('cutline://app/index.html');
  }
}

async function openProjectFile(file) {
  const payload = readJsonSync(file);
  if (!payload || payload.format !== 'cutline-project' || !payload.project) {
    throw new Error('That is not a Cutline project file.');
  }
  for (const asset of payload.assets || []) {
    if (asset && asset.path) allowMedia(asset.path);
  }
  currentProjectPath = file;
  await saveSettings({ lastProjectPath: file });
  return { path: file, data: payload };
}

async function chooseProject() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Cutline project',
    properties: ['openFile'],
    filters: [
      { name: 'Cutline project', extensions: ['cutline', 'json'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return openProjectFile(result.filePaths[0]);
}

async function saveProjectPayload(data, { saveAs = false, path: explicitPath = null } = {}) {
  if (!data || data.format !== 'cutline-project') throw new Error('Invalid project payload.');
  let target = explicitPath || currentProjectPath;
  if (!target || saveAs) {
    const suggested = `${(data.project?.name || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-')}.cutline`;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Cutline project',
      defaultPath: path.join(app.getPath('documents'), suggested),
      filters: [{ name: 'Cutline project', extensions: ['cutline'] }],
    });
    if (result.canceled || !result.filePath) return null;
    target = result.filePath;
  }
  data.savedAt = Date.now();
  await writeJsonAtomic(target, data);
  await writeJsonAtomic(autosaveFile(), data);
  currentProjectPath = target;
  await saveSettings({ lastProjectPath: target });
  const parsed = path.parse(target);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(`${parsed.name} — Cutline Studio`);
  return { path: target };
}

function ipcHandlers() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    ffmpeg: ffmpegPath(),
    userData: app.getPath('userData'),
    projectPath: currentProjectPath,
  }));

  ipcMain.handle('app:startup', async () => {
    const settings = loadSettings();
    if (settings.lastProjectPath && fs.existsSync(settings.lastProjectPath)) {
      try {
        const loaded = await openProjectFile(settings.lastProjectPath);
        return { source: 'file', ...loaded };
      } catch {
        /* fall through to autosave */
      }
    }
    const auto = readJsonSync(autosaveFile());
    if (auto && auto.format === 'cutline-project' && auto.project) {
      for (const asset of auto.assets || []) if (asset?.path) allowMedia(asset.path);
      return { source: 'autosave', path: null, data: auto };
    }
    return { source: 'blank', path: null, data: null };
  });

  ipcMain.handle('media:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import media',
      properties: ['openFile', 'multiSelections'],
      filters: MEDIA_FILTERS,
    });
    if (result.canceled) return [];
    return result.filePaths.map((file) => ({
      path: file,
      url: mediaUrlFor(allowMedia(file)),
      name: path.basename(file),
    }));
  });

  ipcMain.handle('media:register', (_event, files) => {
    const list = Array.isArray(files) ? files : [];
    return list
      .filter((file) => typeof file === 'string' && file.length)
      .map((file) => ({ path: path.resolve(file), url: mediaUrlFor(allowMedia(file)), name: path.basename(file) }));
  });

  ipcMain.handle('media:unregister', (_event, file) => {
    if (typeof file === 'string') allowedMedia.delete(path.resolve(file));
    return true;
  });

  ipcMain.handle('project:open', async () => {
    try {
      return await chooseProject();
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('project:openPath', async (_event, file) => {
    try {
      return await openProjectFile(file);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('project:save', async (_event, data, options) => {
    try {
      return await saveProjectPayload(data, options || {});
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('project:saveTo', async (_event, data, file) => {
    try {
      return await saveProjectPayload(data, { path: file });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('project:new', async () => {
    currentProjectPath = null;
    await saveSettings({ lastProjectPath: null });
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle('Cutline Studio');
    return { ok: true };
  });

  ipcMain.handle('project:autosave', async (_event, data) => {
    try {
      if (data && data.format === 'cutline-project') {
        data.savedAt = Date.now();
        await writeJsonAtomic(autosaveFile(), data);
        return { ok: true };
      }
      return { ok: false };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('audio:extract', async (_event, file) => {
    const ffmpeg = ffmpegPath();
    if (!ffmpeg) return { ok: false, error: 'FFmpeg is not available.' };
    const resolved = allowMedia(file);
    const dir = await fsp.mkdtemp(path.join(app.getPath('temp'), 'cutline-audio-'));
    const out = path.join(dir, 'audio.wav');
    try {
      await runProcess(ffmpeg, ['-v', 'error', '-y', '-i', resolved, '-vn', '-ac', '2', '-ar', '48000', '-f', 'wav', out]);
      const buffer = await fsp.readFile(out);
      return {
        ok: true,
        wav: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  ipcMain.handle('export:transcode', async (event, payload) => {
    if (exporting) return { ok: false, error: 'A native export is already running.' };
    const ffmpeg = ffmpegPath();
    if (!ffmpeg) return { ok: false, error: 'FFmpeg is not available. Reinstall the desktop app.' };
    const codec = payload?.codec === 'hevc' ? 'hevc' : payload?.codec === 'prores' ? 'prores' : 'h264';
    const extension = codec === 'prores' ? 'mov' : 'mp4';
    const quality = payload?.quality === 'fast' ? 22 : payload?.quality === 'high' ? 16 : 19;
    const suggested = `${(payload?.suggestedName || 'cutline-export').replace(/\.(mp4|webm|mov)$/i, '')}.${extension}`;

    let target = payload?.outputPath || null;
    if (!target) {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export master',
        defaultPath: path.join(app.getPath('videos'), suggested),
        filters: [
          {
            name: codec === 'prores' ? 'ProRes QuickTime' : codec === 'hevc' ? 'HEVC MP4' : 'H.264 MP4',
            extensions: [extension],
          },
        ],
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      target = result.filePath;
    }

    const data = payload?.data;
    if (!data) return { ok: false, error: 'No rendered data to encode.' };
    const inputExt = payload?.inputExtension === 'mp4' ? 'mp4' : 'webm';
    const dir = await fsp.mkdtemp(path.join(app.getPath('temp'), 'cutline-export-'));
    const input = path.join(dir, `intermediate.${inputExt}`);
    await fsp.writeFile(input, Buffer.from(data));

    const args = ['-v', 'error', '-y', '-i', input];
    if (codec === 'h264') {
      args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(quality), '-pix_fmt', 'yuv420p');
    } else if (codec === 'hevc') {
      args.push('-c:v', 'libx265', '-preset', 'medium', '-crf', String(quality + 3), '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1');
    } else {
      args.push('-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le');
    }
    args.push(codec === 'prores' ? '-c:a' : '-c:a', codec === 'prores' ? 'pcm_s16le' : 'aac');
    if (codec !== 'prores') args.push('-b:a', '192k', '-movflags', '+faststart');
    args.push('-progress', 'pipe:1', '-nostats', target);

    exporting = true;
    try {
      const duration = Number(payload?.durationSeconds) || 0;
      await runProcess(ffmpeg, args, (chunk) => {
        const text = chunk.toString();
        for (const line of text.split('\n')) {
          const match = /^out_time_us=(\d+)/.exec(line.trim());
          if (match && duration > 0) {
            const percent = Math.min(99, (Number(match[1]) / 1e6 / duration) * 100);
            if (!mainWindow?.isDestroyed()) event.sender.send('export:progress', { percent, detail: 'Encoding master…' });
          }
        }
      });
      const stat = await fsp.stat(target);
      return { ok: true, path: target, size: stat.size };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      exporting = false;
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      if (!mainWindow?.isDestroyed()) event.sender.send('export:progress', { percent: 100, detail: 'Master ready' });
    }
  });

  ipcMain.handle('window:title', (_event, title) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(`${title || 'Untitled'} — Cutline Studio`);
    }
  });

  ipcMain.handle('shell:showItem', (_event, file) => {
    if (typeof file === 'string') shell.showItemInFolder(file);
  });
}

function runProcess(command, args, onData) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.on('data', (chunk) => onData?.(chunk));
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('FFmpeg timed out.'));
    }, 6 * 60 * 60 * 1000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}`));
    });
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerProtocols();
    ipcHandlers();
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

if (IS_TEST) {
  console.log('[cutline-desktop] test mode');
}