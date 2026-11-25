import type { AudioType, Clip, FadeCurve } from '../core/types';

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** 0..1 progress through a fade, shaped by the clip's fade curve. */
export function curveValue(curve: FadeCurve | undefined, p: number): number {
  const x = clamp(p, 0, 1);
  switch (curve) {
    case 'smooth':
      return x * x * (3 - 2 * x);
    case 'exponential':
      return x * x;
    default:
      return x;
  }
}

export function dbToLinear(db: number): number {
  if (!Number.isFinite(db) || db <= -60) return 0;
  return Math.pow(10, db / 20);
}

export function linearToDb(value: number): number {
  if (!Number.isFinite(value) || value <= 0.0001) return -60;
  return 20 * Math.log10(value);
}

export interface AudioPreset {
  label: string;
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  compress: number;
}

export const AUDIO_PRESETS: Record<AudioType, AudioPreset> = {
  dialogue: { label: 'Dialogue', eqLow: -3, eqMid: 2, eqHigh: 1, compress: 0.45 },
  music: { label: 'Music', eqLow: 2, eqMid: 0, eqHigh: -1, compress: 0.15 },
  sfx: { label: 'SFX', eqLow: 0, eqMid: 1, eqHigh: 2, compress: 0.25 },
};

export function presetPatch(type: AudioType | ''): Partial<Clip> {
  if (!type) {
    return { audioType: null, eqLow: 0, eqMid: 0, eqHigh: 0, compress: 0 };
  }
  const preset = AUDIO_PRESETS[type];
  return { audioType: type, eqLow: preset.eqLow, eqMid: preset.eqMid, eqHigh: preset.eqHigh, compress: preset.compress };
}
