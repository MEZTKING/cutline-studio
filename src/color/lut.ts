import type { ProjectLut } from '../core/types';

export interface BuiltinLut {
  id: string;
  name: string;
  lut: ProjectLut;
}

function makeLut(size: number, fn: (r: number, g: number, b: number) => [number, number, number]): ProjectLut {
  const data: number[] = [];
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const rr = r / (size - 1);
        const gg = g / (size - 1);
        const bb = b / (size - 1);
        const out = fn(rr, gg, bb);
        data.push(Math.min(1, Math.max(0, out[0])), Math.min(1, Math.max(0, out[1])), Math.min(1, Math.max(0, out[2])));
      }
    }
  }
  return { name: 'builtin', size, data };
}

const lum = (r: number, g: number, b: number) => r * 0.2126 + g * 0.7152 + b * 0.0722;

let builtins: BuiltinLut[] | null = null;

export function builtinLuts(): BuiltinLut[] {
  if (builtins) return builtins;
  builtins = [
    {
      id: 'builtin:bw',
      name: 'Monochrome',
      lut: makeLut(17, (r, g, b) => {
        const y = lum(r, g, b);
        return [y, y, y];
      }),
    },
    {
      id: 'builtin:teal-orange',
      name: 'Teal & Orange',
      lut: makeLut(17, (r, g, b) => {
        const y = lum(r, g, b);
        return [
          r * 0.94 + y * y * 0.16 - (1 - y) * 0.02,
          g * 1.01 + (1 - y) * 0.02,
          b + (1 - y) * 0.13 - y * 0.05,
        ];
      }),
    },
    {
      id: 'builtin:warm-film',
      name: 'Warm Film',
      lut: makeLut(17, (r, g, b) => [
        r * 1.07 + 0.022,
        g * 1.015 + 0.006,
        b * 0.9 - 0.012 + (1 - lum(r, g, b)) * 0.02,
      ]),
    },
    {
      id: 'builtin:cool-film',
      name: 'Cool Film',
      lut: makeLut(17, (r, g, b) => [r * 0.92, g * 1.005, b * 1.08 + 0.012]),
    },
    {
      id: 'builtin:fade',
      name: 'Faded Matte',
      lut: makeLut(17, (r, g, b) => [
        r * 0.82 + 0.11,
        g * 0.82 + 0.1,
        b * 0.8 + 0.12 - lum(r, g, b) * 0.02,
      ]),
    },
  ];
  return builtins;
}

export function findLut(projectLuts: Record<string, ProjectLut> | undefined, id: string | null | undefined): ProjectLut | undefined {
  if (!id) return undefined;
  const builtin = builtinLuts().find((b) => b.id === id);
  if (builtin) return builtin.lut;
  return projectLuts?.[id];
}

export function lutLabel(projectLuts: Record<string, ProjectLut> | undefined, id: string | null | undefined): string {
  if (!id) return 'None';
  const builtin = builtinLuts().find((b) => b.id === id);
  if (builtin) return builtin.name;
  return projectLuts?.[id]?.name ?? 'Missing LUT';
}

export function lutChoices(projectLuts: Record<string, ProjectLut> | undefined): { id: string; name: string }[] {
  return [
    ...builtinLuts().map((b) => ({ id: b.id, name: b.name })),
    ...Object.entries(projectLuts ?? {}).map(([id, lut]) => ({ id, name: lut.name })),
  ];
}

export interface ParsedCube {
  name: string;
  size: number;
  data: number[];
  domainMin: [number, number, number];
  domainMax: [number, number, number];
}

const DEFAULT_MIN: [number, number, number] = [0, 0, 0];
const DEFAULT_MAX: [number, number, number] = [1, 1, 1];

/** Parse Adobe/Resolve .cube 3D LUTs (red changes fastest). */
export function parseCube(text: string, fallbackName = 'Imported LUT'): ParsedCube {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let size = 0;
  let title = '';
  let domainMin = [...DEFAULT_MIN] as [number, number, number];
  let domainMax = [...DEFAULT_MAX] as [number, number, number];
  const values: number[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith('TITLE')) {
      title = line.slice(5).trim().replace(/^"|"$/g, '');
      continue;
    }
    if (upper.startsWith('LUT_1D_SIZE')) {
      throw new Error('1D LUTs are not supported. Export a 3D .cube instead.');
    }
    if (upper.startsWith('LUT_3D_SIZE')) {
      size = Number(line.split(/\s+/)[1]);
      continue;
    }
    if (upper.startsWith('DOMAIN_MIN')) {
      const parts = line.split(/\s+/).slice(1).map(Number);
      if (parts.length >= 3 && parts.every(Number.isFinite)) domainMin = [parts[0], parts[1], parts[2]];
      continue;
    }
    if (upper.startsWith('DOMAIN_MAX')) {
      const parts = line.split(/\s+/).slice(1).map(Number);
      if (parts.length >= 3 && parts.every(Number.isFinite)) domainMax = [parts[0], parts[1], parts[2]];
      continue;
    }
    if (/^[A-Z_]/i.test(line)) continue;
    const parts = line.split(/[\s,]+/).map(Number);
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) continue;
    values.push(parts[0], parts[1], parts[2]);
  }

  if (!Number.isInteger(size) || size < 2 || size > 129) {
    throw new Error('Invalid or missing LUT_3D_SIZE.');
  }
  const needed = size * size * size * 3;
  if (values.length < needed) {
    throw new Error(`LUT has ${values.length / 3} entries; a ${size}³ LUT needs ${needed / 3}.`);
  }
  return {
    name: title || fallbackName,
    size,
    data: values.slice(0, needed),
    domainMin,
    domainMax,
  };
}
