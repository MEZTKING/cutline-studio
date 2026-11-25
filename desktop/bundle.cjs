'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MANIFEST = 'bundle.json';
const PROJECT = 'project.cutline';
const MEDIA = 'media';
const FORMAT = 'cutline-bundle';

const posix = (p) => p.split(path.sep).join('/');
const isInside = (root, file) => {
  const rel = path.relative(root, file);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
};

function isBundleRoot(dir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
    return manifest?.format === FORMAT && Number(manifest.version) === 1;
  } catch {
    return false;
  }
}

function bundleRootForProject(file) {
  const dir = path.dirname(file);
  if (path.basename(file) === PROJECT && isBundleRoot(dir)) return dir;
  return null;
}

async function uniqueMediaName(dir, original, claimed) {
  const parsed = path.parse(original.replace(/[\\/:*?"<>|]+/g, '_'));
  const base = parsed.name || 'media';
  const ext = parsed.ext || '';
  let name = `${base}${ext}`;
  let i = 2;
  while (claimed.has(name.toLowerCase()) || fs.existsSync(path.join(dir, name))) {
    name = `${base}-${i}${ext}`;
    i++;
  }
  claimed.add(name.toLowerCase());
  return name;
}

async function writeBundle(root, data) {
  const bundleRoot = path.resolve(root);
  if (fs.existsSync(bundleRoot)) {
    if (!fs.statSync(bundleRoot).isDirectory()) throw new Error('A bundle path must be a folder.');
    if (fs.readdirSync(bundleRoot).length && !isBundleRoot(bundleRoot)) {
      throw new Error('That folder already exists and is not a Cutline bundle.');
    }
  }
  await fsp.mkdir(path.join(bundleRoot, MEDIA), { recursive: true });

  let previousCreatedAt = null;
  try {
    previousCreatedAt = JSON.parse(fs.readFileSync(path.join(bundleRoot, MANIFEST), 'utf8')).createdAt ?? null;
  } catch {
    /* new bundle */
  }

  const copied = new Map();
  const claimed = new Set();
  const assets = [];
  const missing = [];
  for (const record of data.assets || []) {
    if (!record.path) {
      assets.push({ ...record });
      continue;
    }
    const source = path.resolve(record.path);
    if (!fs.existsSync(source)) {
      missing.push(record.name || path.basename(source));
      continue;
    }
    let relative;
    if (isInside(bundleRoot, source)) {
      relative = posix(path.relative(bundleRoot, source));
    } else if (copied.has(source)) {
      relative = copied.get(source);
    } else {
      const name = await uniqueMediaName(path.join(bundleRoot, MEDIA), path.basename(source), claimed);
      await fsp.copyFile(source, path.join(bundleRoot, MEDIA, name));
      relative = posix(path.join(MEDIA, name));
      copied.set(source, relative);
    }
    assets.push({ ...record, path: relative });
  }
  if (missing.length) {
    throw new Error(`Cannot bundle missing media: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}. Relink those files first.`);
  }

  const bundleData = { ...data, assets, savedAt: Date.now() };
  await fsp.writeFile(path.join(bundleRoot, PROJECT), JSON.stringify(bundleData, null, 2), 'utf8');
  const manifest = {
    format: FORMAT,
    version: 1,
    project: PROJECT,
    createdAt: previousCreatedAt || new Date().toISOString(),
  };
  await fsp.writeFile(path.join(bundleRoot, MANIFEST), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return { root: bundleRoot, projectPath: path.join(bundleRoot, PROJECT), data: bundleData };
}

function readBundle(root) {
  const bundleRoot = path.resolve(root);
  if (!isBundleRoot(bundleRoot)) throw new Error('That folder is not a Cutline project bundle.');
  const manifest = JSON.parse(fs.readFileSync(path.join(bundleRoot, MANIFEST), 'utf8'));
  const projectFile = path.resolve(bundleRoot, manifest.project || PROJECT);
  if (!isInside(bundleRoot, projectFile)) throw new Error('Bundle manifest points outside the bundle.');
  const data = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
  if (!data || data.format !== 'cutline-project' || !data.project) throw new Error('Bundle project is invalid.');
  const missing = [];
  const assets = (data.assets || []).map((record) => {
    let resolved = '';
    if (!record.path) {
      resolved = '';
    } else if (path.isAbsolute(record.path)) {
      resolved = path.resolve(record.path);
    } else {
      const candidate = path.resolve(bundleRoot, record.path);
      if (!isInside(bundleRoot, candidate)) throw new Error(`Bundle asset path escapes the bundle: ${record.path}`);
      resolved = candidate;
    }
    const offline = Boolean(resolved) && !fs.existsSync(resolved);
    if (offline) missing.push(record.id);
    return { ...record, path: resolved, missing: offline };
  });
  return { root: bundleRoot, projectPath: projectFile, data: { ...data, assets }, missing };
}

module.exports = { MANIFEST, PROJECT, MEDIA, FORMAT, isBundleRoot, bundleRootForProject, writeBundle, readBundle };
