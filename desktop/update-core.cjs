'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

function normalizeVersion(value) {
  return String(value || '0')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0];
}

function compareVersions(a, b) {
  const pa = normalizeVersion(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = normalizeVersion(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function platformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

function artifactFor(manifest, key = platformKey()) {
  const platforms = manifest && manifest.platforms;
  if (!platforms || typeof platforms !== 'object') return null;
  return platforms[key] || platforms[process.platform] || platforms.default || null;
}

function isValidSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value.trim());
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function findExecutable(root, name, depth = 2) {
  const wanted = name.toLowerCase();
  const walk = (dir, level) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === wanted) return full;
    }
    if (level <= 1) return null;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = walk(path.join(dir, entry.name), level - 1);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(root, depth);
}

async function fetchJson(url, timeout = 20000) {
  if (!/^https?:\/\//i.test(String(url))) throw new Error('Update feed must be an http(s) URL.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'application/json', 'user-agent': 'Cutline updater' },
    });
    if (!res.ok) throw new Error(`Update server returned HTTP ${res.status}.`);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Update feed is not valid JSON.');
    }
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  compareVersions,
  normalizeVersion,
  platformKey,
  artifactFor,
  isValidSha,
  sha256File,
  findExecutable,
  fetchJson,
};
