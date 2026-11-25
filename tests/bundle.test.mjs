import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { writeBundle, readBundle, isBundleRoot } = require('../desktop/bundle.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutline-bundle-'));
const sourceA = path.join(tmp, 'a', 'clip.mp4');
const sourceB = path.join(tmp, 'b', 'clip.mp4');
fs.mkdirSync(path.dirname(sourceA), { recursive: true });
fs.mkdirSync(path.dirname(sourceB), { recursive: true });
fs.writeFileSync(sourceA, 'video-a');
fs.writeFileSync(sourceB, 'video-b');
const project = {
  format: 'cutline-project', version: 1,
  project: { id: 'p', name: 'Bundle Test', width: 1920, height: 1080, fps: 30, tracks: [] },
  assets: [
    { id: 'a', name: 'clip-a', kind: 'video', duration: 1, width: 1920, height: 1080, hasAudio: true, path: sourceA },
    { id: 'b', name: 'clip-b', kind: 'video', duration: 1, width: 1920, height: 1080, hasAudio: false, path: sourceB },
    { id: 'c', name: 'dupe-a', kind: 'video', duration: 1, width: 1920, height: 1080, hasAudio: false, path: sourceA },
  ],
};
const bundleA = path.join(tmp, 'Project.cutlinebundle');
await writeBundle(bundleA, project);
assert.equal(isBundleRoot(bundleA), true);
assert.equal(fs.existsSync(path.join(bundleA, 'bundle.json')), true);
assert.equal(fs.readFileSync(path.join(bundleA, 'media', 'clip.mp4'), 'utf8'), 'video-a');
assert.equal(fs.readFileSync(path.join(bundleA, 'media', 'clip-2.mp4'), 'utf8'), 'video-b');
const saved = JSON.parse(fs.readFileSync(path.join(bundleA, 'project.cutline'), 'utf8'));
assert.equal(saved.assets.length, 3);
assert.equal(saved.assets[0].path, 'media/clip.mp4');
assert.equal(saved.assets[1].path, 'media/clip-2.mp4');
assert.equal(saved.assets[2].path, 'media/clip.mp4');

const moved = path.join(tmp, 'Moved.cutlinebundle');
fs.renameSync(bundleA, moved);
const read = readBundle(moved);
assert.equal(read.data.assets[0].path, path.join(moved, 'media', 'clip.mp4'));
assert.equal(read.data.assets[0].missing, false);
assert.equal(read.missing.length, 0);

fs.rmSync(path.join(moved, 'media', 'clip-2.mp4'));
const missing = readBundle(moved);
assert.equal(missing.missing.length, 1);
assert.equal(missing.data.assets[1].missing, true);

fs.writeFileSync(path.join(tmp, 'outside.mp4'), 'outside');
const bad = { ...project, assets: [{ ...project.assets[0], path: path.join(tmp, 'outside.mp4') }] };
const badDir = path.join(tmp, 'Bad.cutlinebundle');
await writeBundle(badDir, bad);
const badData = JSON.parse(fs.readFileSync(path.join(badDir, 'project.cutline'), 'utf8'));
badData.assets[0].path = '../outside.mp4';
fs.writeFileSync(path.join(badDir, 'project.cutline'), JSON.stringify(badData));
assert.throws(() => readBundle(badDir), /escapes/);
console.log('Project bundles: all assertions passed');
fs.rmSync(tmp, { recursive: true, force: true });
