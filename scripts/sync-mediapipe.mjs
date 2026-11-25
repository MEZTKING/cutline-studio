// Copies the MediaPipe vision runtime from node_modules into public/ so the app
// can bundle it and serve it offline (same-origin, service-worker cached).
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('node_modules/@mediapipe/tasks-vision/wasm');
const OUT = path.resolve('public/vendor/mediapipe');
const FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'];

if (!fs.existsSync(SRC)) {
  console.warn('[mediapipe] package not installed yet; skipping asset sync');
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });
for (const file of FILES) {
  const from = path.join(SRC, file);
  const to = path.join(OUT, file);
  if (!fs.existsSync(from)) {
    console.warn(`[mediapipe] missing ${file}`);
    continue;
  }
  const srcSize = fs.statSync(from).size;
  const outSize = fs.existsSync(to) ? fs.statSync(to).size : -1;
  if (srcSize !== outSize) fs.copyFileSync(from, to);
}
console.log('[mediapipe] runtime assets ready');
