// Tiny read-only server so a Windows machine can download the portable build.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('release');
const PORT = Number(process.env.PORT || 5180);
const HOST = process.env.HOST || '0.0.0.0';

function list() {
  try {
    return fs.readdirSync(ROOT).filter((f) => f.endsWith('.zip'));
  } catch {
    return [];
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/updates/latest.json') {
    const manifest = path.join(ROOT, 'updates', 'latest.json');
    fs.readFile(manifest, (err, data) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'no update manifest yet' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(data);
    });
    return;
  }
  if (url.pathname === '/') {
    const rows = list().map((f) => {
      const size = fs.statSync(path.join(ROOT, f)).size;
      return `<li><a href="/${encodeURIComponent(f)}">${f}</a> — ${(size / 1e6).toFixed(0)} MB</li>`;
    });
    if (fs.existsSync(path.join(ROOT, 'updates', 'latest.json'))) {
      rows.push('<li><a href="/updates/latest.json">updates/latest.json</a> — update feed (SHA-256 verified)</li>');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta name=viewport content="width=device-width"><title>Cutline downloads</title>
      <style>body{background:#0b0d10;color:#e7eaf0;font-family:system-ui;padding:24px}a{color:#5cf2b0}</style>
      <h2>Cutline Studio 0.7.0</h2><ul>${rows.join('')}</ul>
      <p style="color:#8b93a5">Download the portable Windows zip, extract it fully, then run <b>Cutline Studio.exe</b>.<br>
      Windows SmartScreen: More info ? Run anyway (unsigned build).</p>`);
    return;
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!name || name.includes('/') || name.includes('..') || !name.endsWith('.zip')) {
    res.writeHead(400).end('bad request');
    return;
  }
  const file = path.join(ROOT, name);
  fs.stat(file, (err, stat) => {
    if (err) {
      res.writeHead(404).end('not found');
      return;
    }
    const range = req.headers.range;
    const headers = {
      'content-type': 'application/zip',
      'accept-ranges': 'bytes',
      'content-disposition': `attachment; filename="${name}"`,
    };
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        let start = m[1] ? Number(m[1]) : 0;
        let end = m[2] ? Number(m[2]) : stat.size - 1;
        if (!m[1] && m[2]) {
          start = Math.max(0, stat.size - Number(m[2]));
          end = stat.size - 1;
        }
        if (start >= stat.size || start > end) {
          res.writeHead(416, { 'content-range': `bytes */${stat.size}` }).end();
          return;
        }
        end = Math.min(end, stat.size - 1);
        res.writeHead(206, {
          ...headers,
          'content-range': `bytes ${start}-${end}/${stat.size}`,
          'content-length': String(end - start + 1),
        });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
    }
    res.writeHead(200, { ...headers, 'content-length': String(stat.size) });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[release] serving ${ROOT} on http://0.0.0.0:${PORT}/`);
});
