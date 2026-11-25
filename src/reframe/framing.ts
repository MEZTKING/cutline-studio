const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const round = (n: number, places = 4) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * Where an image must sit inside a reframed canvas so that a subject at
 * (cx, cy) source fractions lands at the frame centre, with fill (no bars).
 */
export function computeFraming(
  assetW: number,
  assetH: number,
  frameW: number,
  frameH: number,
  cx: number,
  cy: number,
): { x: number; y: number } {
  if (!assetW || !assetH) return { x: 0, y: 0 };
  const fillScale = Math.max(frameW / assetW, frameH / assetH);
  const dw = assetW * fillScale;
  const dh = assetH * fillScale;
  const sx = dw / frameW;
  const sy = dh / frameH;
  const maxX = Math.max(0, (sx - 1) / 2 - 0.002);
  const maxY = Math.max(0, (sy - 1) / 2 - 0.002);
  return {
    x: round(clamp(-(cx - 0.5) * sx, -maxX, maxX)),
    y: round(clamp(-(cy - 0.5) * sy, -maxY, maxY)),
  };
}
