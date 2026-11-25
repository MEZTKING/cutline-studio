import assert from 'node:assert/strict';
import { computeFraming } from '../src/reframe/framing.ts';

const close = (a, b, eps = 0.002) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

// 16:9 source into 9:16 — pans horizontally, cannot move vertically when filling.
const centre = computeFraming(1920, 1080, 1080, 1920, 0.5, 0.5);
close(centre.x, 0);
close(centre.y, 0);

const right = computeFraming(1920, 1080, 1080, 1920, 0.75, 0.5);
assert.ok(right.x < -0.5, `expected left pan, got ${right.x}`);
close(right.y, 0);

// Extreme subject positions clamp inside the source (never show bars).
const biased = computeFraming(1920, 1080, 1080, 1920, 0.98, 0.2);
assert.ok(biased.x < -1.0 && biased.x >= -1.0782, `clamped, got ${biased.x}`);
close(biased.y, 0);

// 9:16 source into 16:9 — vertical pan, x fixed.
const vertical = computeFraming(1080, 1920, 1920, 1080, 0.5, 0.25);
close(vertical.x, 0);
assert.ok(vertical.y > 0.3, `expected down pan, got ${vertical.y}`);

// Same aspect ratio means no movement.
const same = computeFraming(1920, 1080, 3840, 2160, 0.2, 0.8);
close(same.x, 0);
close(same.y, 0);

// Square target from landscape source.
const square = computeFraming(1920, 1080, 1080, 1080, 0.8, 0.5);
assert.ok(square.x <= -0.38, `expected pan, got ${square.x}`);
assert.ok(Math.abs(square.y) < 0.001);

console.log('Auto-reframe framing math: all assertions passed');
