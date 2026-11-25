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
const crypto = require('node:crypto');
const { parseCli, startApiServer, newToken, HELP } = require('./cli.cjs');
const { Updater } = require('./updater.cjs');

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
const cliArgs = process.argv.slice(app.isPackaged ? 1 : 2);
let CLI = { mode: null, help: false, version: false, json: false, project: null, out: null, width: null, height: null, fps: null, quality: 'balanced', format: null, includeAudio: true, port: 4317, token: null };
let CLI_ERROR = null;
try {
  CLI = parseCli(cliArgs);
} catch (err) {
  CLI_ERROR = err instanceof Error ? err.message : String(err);
}
const CLI_MODE = Boolean(CLI_ERROR || CLI.mode || CLI.help || CLI.version);
const UPDATE_DEV = process.env.CUTLINE_UPDATE_ALLOW_DEV === '1';
const updater = new Updater();
let lastUpdateInfo = null;
let updateConfig = {};
try {
  updateConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'update-config.json'), 'utf8'));
} catch {
  updateConfig = {};
}
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
let activeAutomation = null;
let automationWindow = null;
let automationIpcReady = false;
let automationSettled = null;

function mediaUrlFor(filePath) {
  return `cutline-media://file/${Buffer.from(path.resolve(filePath), 'utf8').toString('base64url')}`;
}

function allowMedia(filePath) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  allowedMedia.add(resolved);
  return resolved;
}

const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ogv']);

/** Ask the bundled FFmpeg for the container's exact frame rate. */
function probeFps(file) {
  const ffmpeg = ffmpegPath();
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!ffmpeg || !VIDEO_EXTENSIONS.has(ext)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-i', file], { windowsHide: true });
    let stderr = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(undefined);
    }, 6000);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 16000) stderr = stderr.slice(-16000);
    });
    child.on('error', () => {
      clearTimeout(timer);
      finish(undefined);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const match = /(\d+(?:\.\d+)?)\s+fps\b/.exec(stderr);
      const value = match ? Number(match[1]) : undefined;
      finish(Number.isFinite(value) && value > 0 && value <= 240 ? value : undefined);
    });
  });
}

async function describeMedia(files) {
  const list = (Array.isArray(files) ? files : []).filter((file) => typeof file === 'string' && file.length);
  const entries = list.map((file) => ({
    path: path.resolve(file),
    url: mediaUrlFor(allowMedia(file)),
    name: path.basename(file),
  }));
  await Promise.all(
    entries.map(async (entry) => {
      const fps = await probeFps(entry.path);
      if (fps) entry.fps = fps;
    }),
  );
  return entries;
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

function updateFeedUrl() {
  return process.env.CUTLINE_UPDATE_URL || loadSettings().updateFeedUrl || updateConfig.feedUrl || '';
}

async function autoUpdateCheck() {
  const feed = updateFeedUrl();
  if (!feed) return;
  try {
    const info = await updater.check(feed, app.getVersion());
    if (!info) return;
    lastUpdateInfo = info;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:available', info);
    }
  } catch (err) {
    if (UPDATE_DEV) console.error('[cutline-update]', err);
  }
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

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress ?? 0,
    phase: job.phase ?? 'Queued',
    projectPath: job.projectPath,
    outputPath: job.outputPath,
    bytes: job.bytes ?? null,
    error: job.error ?? null,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
    settings: job.settings,
  };
}

function prepareAutomationJob(input) {
  const projectPath = path.resolve(String(input.projectPath || input.project || ''));
  const outputPath = path.resolve(String(input.outputPath || input.out || ''));
  if (!input.projectPath && !input.project) throw new Error('projectPath is required.');
  if (!input.outputPath && !input.out) throw new Error('outputPath is required.');
  if (!fs.existsSync(projectPath)) throw new Error(`Project not found: ${projectPath}`);
  const data = readJsonSync(projectPath);
  if (!data || data.format !== 'cutline-project' || !data.project) throw new Error('Not a Cutline project file.');
  for (const asset of data.assets || []) if (asset?.path) allowMedia(asset.path);
  const ext = path.extname(outputPath).toLowerCase();
  let format = input.format;
  if (!format || format === 'auto') format = ext === '.mp4' ? 'mp4' : ext === '.webm' ? 'webm' : 'auto';
  if (!['auto', 'mp4', 'webm'].includes(format)) throw new Error('format must be auto, mp4, or webm.');
  const width = Math.min(7680, Math.max(16, Math.round(Number(input.width) || data.project.width || 1920)));
  const height = Math.min(7680, Math.max(16, Math.round(Number(input.height) || data.project.height || 1080)));
  const fps = Math.min(60, Math.max(12, Math.round(Number(input.fps) || data.project.fps || 30)));
  const quality = ['fast', 'balanced', 'high'].includes(input.quality) ? input.quality : 'balanced';
  return {
    id: crypto.randomUUID(),
    status: 'queued',
    progress: 0,
    phase: 'Queued',
    createdAt: new Date().toISOString(),
    projectPath,
    outputPath,
    data,
    settings: {
      width: Math.round(width / 2) * 2,
      height: Math.round(height / 2) * 2,
      fps,
      quality,
      format,
      includeAudio: input.includeAudio !== false,
      fileName: data.project.name || 'render',
    },
  };
}

function ensureAutomationIpc() {
  if (automationIpcReady) return;
  automationIpcReady = true;
  ipcMain.handle('automation:job', () => {
    if (!activeAutomation) throw new Error('No automation job is active.');
    return { data: activeAutomation.data, settings: activeAutomation.settings, outputPath: activeAutomation.outputPath };
  });
  ipcMain.on('automation:progress', (_event, progress) => {
    if (!activeAutomation) return;
    const percent = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
    activeAutomation.progress = percent;
    activeAutomation.phase = String(progress?.phase || 'Rendering');
    activeAutomation.onProgress?.(activeAutomation);
  });
  ipcMain.handle('automation:write', async (_event, buffer) => {
    if (!activeAutomation) throw new Error('No automation job is active.');
    const bytes = Buffer.isBuffer(buffer)
      ? buffer
      : buffer instanceof ArrayBuffer
        ? Buffer.from(buffer)
        : ArrayBuffer.isView(buffer)
          ? Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
          : Buffer.from(buffer);
    await fsp.mkdir(path.dirname(activeAutomation.outputPath), { recursive: true });
    await fsp.writeFile(activeAutomation.outputPath, bytes);
    activeAutomation.bytes = bytes.length;
    return { ok: true };
  });
  ipcMain.on('automation:done', () => {
    activeAutomation?.resolve?.();
  });
  ipcMain.on('automation:error', (_event, message) => {
    activeAutomation?.reject?.(new Error(String(message || 'Automation render failed.')));
  });
}

async function runAutomationWorker(job, onProgress) {
  ensureAutomationIpc();
  activeAutomation = job;
  job.onProgress = onProgress;
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  automationWindow = win;
  win.setMenu(null);
  let finished = false;
  const timeout = setTimeout(() => {
    activeAutomation?.reject?.(new Error('Render timed out after 30 minutes.'));
  }, 30 * 60 * 1000);
  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        activeAutomation = null;
        clearTimeout(timeout);
        if (!win.isDestroyed()) win.destroy();
        if (automationWindow === win) automationWindow = null;
      };
      win.webContents.on('render-process-gone', (_e, details) => {
        cleanup();
        reject(new Error(`Render process exited: ${details.reason}`));
      });
      win.webContents.on('did-fail-load', (_e, code, description) => {
        cleanup();
        reject(new Error(`Could not load render worker: ${description} (${code})`));
      });
      activeAutomation = job;
      job.resolve = () => {
        if (finished) return;
        finished = true;
        cleanup();
        resolve();
      };
      job.reject = (err) => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(err);
      };
      const url = DEV_URL ? new URL('automation.html', DEV_URL).toString() : 'cutline://app/automation.html';
      win.loadURL(url).catch((err) => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(err);
      });
    });
  } finally {
    clearTimeout(timeout);
    if (automationWindow && !automationWindow.isDestroyed()) automationWindow.destroy();
    automationWindow = null;
    activeAutomation = null;
  }
  return job;
}

function writeCliProgress(job) {
  if (CLI.json) {
    console.log(JSON.stringify({ event: 'progress', id: job.id, percent: Math.round(job.progress ?? 0), phase: job.phase ?? '' }));
  } else {
    process.stdout.write(`\r[${String(Math.round(job.progress ?? 0)).padStart(3)}%] ${job.phase ?? ''}\x1b[K`);
  }
}

async function runCliMode() {
  if (CLI_ERROR) {
    console.error(`cutline: ${CLI_ERROR}\n\n${HELP}`);
    app.exit(2);
    return;
  }
  if (CLI.help) {
    console.log(HELP);
    app.exit(0);
    return;
  }
  if (CLI.version) {
    console.log(app.getVersion());
    app.exit(0);
    return;
  }
  registerProtocols();
  ipcHandlers();
  ensureAutomationIpc();
  if (CLI.mode === 'render') {
    try {
      const job = prepareAutomationJob({ projectPath: CLI.project, outputPath: CLI.out, width: CLI.width, height: CLI.height, fps: CLI.fps, quality: CLI.quality, format: CLI.format, includeAudio: CLI.includeAudio });
      await runAutomationWorker(job, writeCliProgress);
      if (!CLI.json) process.stdout.write('\n');
      console.log(CLI.json ? JSON.stringify({ event: 'done', id: job.id, output: job.outputPath, bytes: job.bytes }) : `Rendered ${job.outputPath} (${(job.bytes / 1e6).toFixed(1)} MB)`);
      app.exit(0);
    } catch (err) {
      if (!CLI.json) process.stdout.write('\n');
      console.error(`cutline: ${err instanceof Error ? err.message : String(err)}`);
      app.exit(1);
    }
    return;
  }
  if (CLI.mode === 'serve') {
    const jobs = new Map();
    const queue = [];
    let busy = false;
    const pump = async () => {
      if (busy) return;
      const job = queue.shift();
      if (!job) return;
      busy = true;
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      try {
        await runAutomationWorker(job, (p) => {
          job.progress = p.percent;
          job.phase = p.phase;
        });
        job.status = 'done';
        job.progress = 100;
        job.phase = 'Done';
      } catch (err) {
        job.status = 'error';
        job.error = err instanceof Error ? err.message : String(err);
        job.phase = 'Error';
      } finally {
        job.finishedAt = new Date().toISOString();
        busy = false;
        void pump();
      }
    };
    const submitRender = (body) => {
      const job = prepareAutomationJob(body || {});
      jobs.set(job.id, job);
      queue.push(job);
      void pump();
      return publicJob(job);
    };
    const apiJobs = {
      list: () => [...jobs.values()].map(publicJob),
      get: (id) => {
        const job = jobs.get(id);
        return job ? publicJob(job) : null;
      },
    };
    const token = CLI.token || process.env.CUTLINE_API_TOKEN || newToken();
    if (!CLI.token && !process.env.CUTLINE_API_TOKEN) {
      await fsp.writeFile(path.join(app.getPath('userData'), 'api-token'), token, 'utf8').catch(() => undefined);
    }
    const { port } = await startApiServer({ port: CLI.port, token, jobs: apiJobs, submitRender, version: app.getVersion() });
    console.log(JSON.stringify({ event: 'serving', url: `http://127.0.0.1:${port}`, token, version: app.getVersion() }));
    process.on('SIGINT', () => app.exit(0));
    process.on('SIGTERM', () => app.exit(0));
  }
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
        { label: 'Project Settings…', accelerator: 'CmdOrCtrl+,', click: () => sendMenu('project-settings') },
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
          label: 'Check for Updates…',
          click: () => sendMenu('check-updates'),
        },
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

  ipcMain.handle('update:config', () => ({
    feedUrl: updateFeedUrl(),
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    allowDev: !app.isPackaged && UPDATE_DEV,
    platform: process.platform,
  }));

  ipcMain.handle('update:setFeed', async (_event, feedUrl) => {
    if (typeof feedUrl !== 'string' || !/^https?:\/\//i.test(feedUrl.trim())) {
      throw new Error('Enter a full http(s) update feed URL.');
    }
    await saveSettings({ updateFeedUrl: feedUrl.trim() });
    lastUpdateInfo = null;
    return { feedUrl: feedUrl.trim() };
  });

  ipcMain.handle('update:check', async (_event, feedOverride) => {
    const feed = typeof feedOverride === 'string' && feedOverride.trim() ? feedOverride.trim() : updateFeedUrl();
    if (!feed) throw new Error('No update feed configured.');
    const info = await updater.check(feed, app.getVersion());
    lastUpdateInfo = info;
    return info;
  });

  ipcMain.handle('update:download', async (event) => {
    if (!lastUpdateInfo) throw new Error('Check for an update first.');
    const downloaded = await updater.download(lastUpdateInfo, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('update:progress', progress);
    });
    return { path: downloaded.path, size: downloaded.size, sha256: downloaded.sha256 };
  });

  ipcMain.handle('update:cancel', () => {
    updater.cancel();
    return { ok: true };
  });

  ipcMain.handle('update:install', async () => {
    if (!lastUpdateInfo) throw new Error('No update is ready to install.');
    return updater.install(lastUpdateInfo);
  });

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
    return describeMedia(result.filePaths);
  });

  ipcMain.handle('media:register', (_event, files) => describeMedia(files));

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

const gotLock = CLI_MODE ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else if (CLI_MODE) {
  app.on('window-all-closed', () => {
    /* keep the local API process alive after the hidden render worker closes */
  });
  app.whenReady().then(() => runCliMode()).catch((err) => {
    console.error(err);
    app.exit(1);
  });
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
    if (app.isPackaged || UPDATE_DEV) setTimeout(() => void autoUpdateCheck(), 8000);
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