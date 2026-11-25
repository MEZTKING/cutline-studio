import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const core = require('../desktop/update-core.cjs');

assert.equal(core.compareVersions('0.7.0', '0.7.0'), 0);
assert.equal(core.compareVersions('0.8.0', '0.7.9'), 1);
assert.equal(core.compareVersions('v1.2.10', '1.2.9'), 1);
assert.equal(core.compareVersions('1.0', '1.0.1'), -1);
assert.equal(core.normalizeVersion('v2.3.4-beta'), '2.3.4');
assert.equal(core.platformKey('win32', 'x64'), 'win32-x64');

const manifest = { platforms: { 'win32-x64': { url: 'https://x/y.zip', sha256: 'a'.repeat(64) }, default: { url: 'z' } } };
assert.equal(core.artifactFor(manifest, 'win32-x64').url, 'https://x/y.zip');
assert.equal(core.artifactFor(manifest, 'linux-arm64').url, 'z');
assert.equal(core.artifactFor({}, 'x'), null);
assert.equal(core.isValidSha('A'.repeat(64)), true);
assert.equal(core.isValidSha('abc'), false);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutline-core-'));
const file = path.join(tmp, 'sample.bin');
fs.writeFileSync(file, 'cutline update test');
const expected = crypto.createHash('sha256').update('cutline update test').digest('hex');
assert.equal(await core.sha256File(file), expected);

const nested = path.join(tmp, 'stage', 'nested');
fs.mkdirSync(nested, { recursive: true });
fs.writeFileSync(path.join(nested, 'Cutline Studio.exe'), 'x');
assert.equal(path.basename(core.findExecutable(path.join(tmp, 'stage'), 'Cutline Studio.exe')), 'Cutline Studio.exe');
assert.equal(core.findExecutable(path.join(tmp, 'stage'), 'missing.exe'), null);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('Update core: all assertions passed');
