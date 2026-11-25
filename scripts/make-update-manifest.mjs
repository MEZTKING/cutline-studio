#!/usr/bin/env node
// Build the JSON feed consumed by the in-app updater.
// Usage:
//   node scripts/make-update-manifest.mjs --zip release/Cutline-...zip \
//     --url http://host/Cutline-...zip --version 0.7.0 --notes "..." \
//     --out release/updates/latest.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    zip: { type: 'string' },
    url: { type: 'string' },
    version: { type: 'string' },
    notes: { type: 'string', default: '' },
    platform: { type: 'string', default: 'win32-x64' },
    executable: { type: 'string', default: 'Cutline Studio.exe' },
    out: { type: 'string', default: 'release/updates/latest.json' },
    released: { type: 'string' },
  },
});

if (!values.zip || !values.url || !values.version) {
  console.error('Need --zip, --url and --version');
  process.exit(1);
}
if (!fs.existsSync(values.zip)) {
  console.error(`No such zip: ${values.zip}`);
  process.exit(1);
}
if (!/^https?:\/\//i.test(values.url)) {
  console.error('Update URL must be http(s)');
  process.exit(1);
}

const buffer = fs.readFileSync(values.zip);
const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
const size = buffer.length;

let manifest = { version: values.version, released: values.released || new Date().toISOString(), notes: values.notes, platforms: {} };
if (fs.existsSync(values.out)) {
  try {
    const prev = JSON.parse(fs.readFileSync(values.out, 'utf8'));
    if (prev.version === values.version && prev.platforms) manifest.platforms = prev.platforms;
  } catch {
    /* replace malformed */
  }
}
const artifact = {
  url: values.url,
  sha256,
  size,
  executable: values.executable,
};
manifest.platforms[values.platform] = artifact;
// Architecture-agnostic fallback (e.g. win32) for emulated/unsupported arches.
const osKey = values.platform.split('-')[0];
if (osKey && osKey !== values.platform) manifest.platforms[osKey] = artifact;

fs.mkdirSync(path.dirname(values.out), { recursive: true });
fs.writeFileSync(values.out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${values.out}: v${manifest.version} ${values.platform} ${(size / 1e6).toFixed(0)}MB ${sha256.slice(0, 12)}…`);
