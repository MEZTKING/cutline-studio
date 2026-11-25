import { COLOR_DEFAULTS, ZERO_WHEEL, type ColorGrade, type ColorWheel } from '../core/types';

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Convert HSL (hue 0..1, saturation/lightness 0..1) to RGB in 0..1. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 1) + 1) % 1;
  if (s <= 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const to = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [to(hue + 1 / 3), to(hue), to(hue - 1 / 3)];
}

/** The hue/saturation colour represented by the wheel puck (0..1 per channel). */
export function wheelColor(wheel: ColorWheel): { rgb: [number, number, number]; sat: number } {
  const x = clamp(Number.isFinite(wheel.x) ? wheel.x : 0, -1, 1);
  const y = clamp(Number.isFinite(wheel.y) ? wheel.y : 0, -1, 1);
  const sat = Math.min(1, Math.hypot(x, y));
  if (sat < 0.001) return { rgb: [0.5, 0.5, 0.5], sat: 0 };
  const angle = Math.atan2(-y, x);
  const hue = ((angle / (Math.PI * 2)) % 1 + 1) % 1;
  return { rgb: hslToRgb(hue, 1, 0.5), sat };
}

export interface GradeUniforms {
  lift: [number, number, number];
  gain: [number, number, number];
  gamma: [number, number, number];
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  hue: number;
}

/** Convert the UI grade into shader-friendly uniforms. */
export function gradeUniforms(grade: ColorGrade | undefined): GradeUniforms {
  const g = grade ?? COLOR_DEFAULTS;
  const liftWheel = g.lift ?? ZERO_WHEEL;
  const gammaWheel = g.gamma ?? ZERO_WHEEL;
  const gainWheel = g.gain ?? ZERO_WHEEL;

  const wheelOffsets = (wheel: ColorWheel, strength: number, master: number): [number, number, number] => {
    const { rgb, sat } = wheelColor(wheel);
    const m = clamp(Number.isFinite(wheel.master) ? wheel.master : 0, -0.5, 0.5);
    return [
      clamp((rgb[0] - 0.5) * 2 * sat * strength + m * master, -0.6, 0.6),
      clamp((rgb[1] - 0.5) * 2 * sat * strength + m * master, -0.6, 0.6),
      clamp((rgb[2] - 0.5) * 2 * sat * strength + m * master, -0.6, 0.6),
    ];
  };

  const lift = wheelOffsets(liftWheel, 0.22, 0.12);
  const gainOff = wheelOffsets(gainWheel, 0.7, 0.4);
  const gammaOff = wheelOffsets(gammaWheel, 0.7, 0.4);

  return {
    lift: [lift[0], lift[1], lift[2]],
    gain: [clamp(1 + gainOff[0], 0.2, 2.2), clamp(1 + gainOff[1], 0.2, 2.2), clamp(1 + gainOff[2], 0.2, 2.2)],
    gamma: [
      clamp(1 / (1 + gammaOff[0]), 0.2, 3),
      clamp(1 / (1 + gammaOff[1]), 0.2, 3),
      clamp(1 / (1 + gammaOff[2]), 0.2, 3),
    ],
    exposure: clamp(1 + (g.brightness ?? 0) / 100, 0, 4),
    contrast: clamp(1 + (g.contrast ?? 0) / 100, 0, 4),
    saturation: clamp(1 + (g.saturation ?? 0) / 100, 0, 4),
    temperature: clamp((g.temperature ?? 0) / 100, -1, 1),
    hue: ((g.hue ?? 0) * Math.PI) / 180,
  };
}

export function isNeutralGrade(grade: ColorGrade | undefined): boolean {
  if (!grade) return true;
  const g = grade;
  return (
    !g.lutId &&
    !g.brightness &&
    !g.contrast &&
    !g.saturation &&
    !g.hue &&
    !g.temperature &&
    !g.vignette &&
    !g.blur &&
    !(g.lift && (g.lift.x || g.lift.y || g.lift.master)) &&
    !(g.gamma && (g.gamma.x || g.gamma.y || g.gamma.master)) &&
    !(g.gain && (g.gain.x || g.gain.y || g.gain.master))
  );
}
