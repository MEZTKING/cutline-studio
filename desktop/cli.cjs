'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const HELP = `Cutline Studio CLI

Render a project:
  Cutline Studio.exe --render project.cutline --out output.mp4 [options]
  npm run cli -- render project.cutline -o output.webm

Options:
  -o, --out <file>       Output file (.mp4 or .webm)
  --width <px>           Override output width (even numbers, max 7680)
  --height <px>          Override output height
  --fps <n>              Output frame rate (12–60)
  --quality <fast|balanced|high>
  --format <auto|mp4|webm>
  --no-audio             Exclude the audio mix
  --json                 Machine-readable JSON lines on stdout

Serve a local HTTP API (127.0.0.1 only):
  Cutline Studio.exe --serve --port 4317 --token <secret>
  POST /v1/render   {"projectPath":"...","outputPath":"...","width":1920,"height":1080,"fps":30}
  GET  /v1/jobs/:id
  GET  /v1/health

The API requires Authorization: Bearer <token> on every /v1 route except /v1/health.
Without --token, a token is generated into the app data folder.
`;

function parseIntArg(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number.`);
  return n;
}

function parseCli(args) {
  const list = [...args];
  const out = {
    mode: null,
    help: false,
    version: false,
    json: false,
    project: null,
    out: null,
    width: null,
    height: null,
    fps: null,
    quality: 'balanced',
    format: null,
    includeAudio: true,
    port: 4317,
    token: null,
    serve: false,
  };
  if (!list.length) return out;
  if (list[0] === 'render') {
    out.mode = 'render';
    list.shift();
  } else if (list[0] === 'serve') {
    out.mode = 'serve';
    out.serve = true;
    list.shift();
  }
  for (let i = 0; i < list.length; i++) {
    const arg = list[i];
    const next = () => {
      if (i + 1 >= list.length) throw new Error(`${arg} needs a value.`);
      return list[++i];
    };
    switch (arg) {
      case '--help':
      case '-h':
        out.help = true;
        break;
      case '--version':
      case '-V':
        out.version = true;
        break;
      case '--render':
        out.mode = 'render';
        out.project = next();
        break;
      case '--serve':
        out.mode = 'serve';
        out.serve = true;
        break;
      case '--port':
        out.port = parseIntArg(next(), '--port');
        break;
      case '--token':
        out.token = next();
        break;
      case '--project':
        out.project = next();
        break;
      case '--out':
      case '-o':
        out.out = next();
        break;
      case '--width':
        out.width = parseIntArg(next(), '--width');
        break;
      case '--height':
        out.height = parseIntArg(next(), '--height');
        break;
      case '--fps':
        out.fps = parseIntArg(next(), '--fps');
        break;
      case '--quality':
        out.quality = next();
        break;
      case '--format':
        out.format = next();
        break;
      case '--no-audio':
        out.includeAudio = false;
        break;
      case '--json':
        out.json = true;
        break;
      default:
        if (!arg.startsWith('-') && !out.project && out.mode !== 'serve') out.project = arg;
        break;
    }
  }
  if (out.help || out.version) return out;
  if (out.mode === 'render' && (!out.project || !out.out)) throw new Error('--render needs a project and --out.');
  if (out.mode === 'serve' && (out.port < 1024 || out.port > 65535)) throw new Error('--port must be between 1024 and 65535.');
  if (out.width && out.width % 2) throw new Error('--width must be even.');
  if (out.height && out.height % 2) throw new Error('--height must be even.');
  if (out.fps && (out.fps < 12 || out.fps > 60)) throw new Error('--fps must be 12–60.');
  if (!['fast', 'balanced', 'high'].includes(out.quality)) throw new Error('--quality must be fast, balanced, or high.');
  if (out.format && !['auto', 'mp4', 'webm'].includes(out.format)) throw new Error('--format must be auto, mp4, or webm.');
  return out;
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

function readBody(req, limit = 256_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('Body must be JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function startApiServer({ port, token, jobs, submitRender, version }) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
        });
        res.end();
        return;
      }
      if (url.pathname === '/v1/health') {
        json(res, 200, { ok: true, version, jobs: jobs.list().length });
        return;
      }
      const auth = req.headers.authorization || '';
      if (auth !== `Bearer ${token}`) {
        json(res, 401, { error: 'Unauthorized' });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/v1/render') {
        const body = await readBody(req);
        const job = submitRender(body);
        json(res, 202, { id: job.id, status: job.status });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/jobs') {
        json(res, 200, { jobs: jobs.list() });
        return;
      }
      const match = /^\/v1\/jobs\/([\w-]+)$/.exec(url.pathname);
      if (req.method === 'GET' && match) {
        const job = jobs.get(match[1]);
        if (!job) {
          json(res, 404, { error: 'No such job' });
          return;
        }
        json(res, 200, job);
        return;
      }
      json(res, 404, { error: 'Not found' });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, port, token });
    });
  });
}

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

module.exports = { parseCli, startApiServer, newToken, HELP };
