import { clipEnd, round } from '../core/model';
import type { Clip, Keyframe, MediaAsset, Project } from '../core/types';
import { detectFaces, loadFaceDetector, type FaceBox } from './face';
import { computeFraming } from './framing';

export interface ReframeTarget {
  key: string;
  label: string;
  ratio: string;
  width: number;
  height: number;
}

export const REFRAME_TARGETS: ReframeTarget[] = [
  { key: '9:16', label: 'Reels / Shorts / TikTok', ratio: '9:16', width: 1080, height: 1920 },
  { key: '4:5', label: 'Instagram feed', ratio: '4:5', width: 1080, height: 1350 },
  { key: '1:1', label: 'Square', ratio: '1:1', width: 1080, height: 1080 },
  { key: '16:9', label: 'Landscape', ratio: '16:9', width: 1920, height: 1080 },
];

export interface ReframeProgress {
  phase: 'load' | 'analyze' | 'apply';
  percent: number;
  detail: string;
}

export interface ReframeStats {
  clips: number;
  samples: number;
  faces: number;
  faceTracking: boolean;
}

export interface ReframeResult {
  project: Project;
  stats: ReframeStats;
}

interface Sample {
  t: number;
  x: number;
  y: number;
  known: boolean;
}

interface Analysis {
  baseX: number;
  baseY: number;
  keys: { t: number; x: number; y: number }[];
  samples: number;
  faces: number;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function pickFace(faces: FaceBox[], previous: FaceBox | null): FaceBox | null {
  const viable = faces.filter((f) => f.score >= 0.35);
  if (!viable.length) return null;
  if (previous) {
    const near = viable
      .filter((f) => Math.hypot(f.cx - previous.cx, f.cy - previous.cy) < 0.32)
      .sort((a, b) => b.size - a.size)[0];
    if (near) return near;
  }
  return viable.sort((a, b) => b.size - a.size)[0];
}

function fillAndSmooth(samples: Sample[]): { x: number[]; y: number[] } {
  const n = samples.length;
  const xs = samples.map((s) => (s.known ? s.x : Number.NaN));
  const ys = samples.map((s) => (s.known ? s.y : Number.NaN));

  const fill = (values: number[]) => {
    let last = Number.NaN;
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(values[i])) last = values[i];
      else if (Number.isFinite(last)) values[i] = last;
    }
    let next = Number.NaN;
    for (let i = n - 1; i >= 0; i--) {
      if (Number.isFinite(values[i])) next = values[i];
      else if (Number.isFinite(next)) values[i] = next;
    }
    for (let i = 0; i < n; i++) if (!Number.isFinite(values[i])) values[i] = 0;
    return values;
  };

  fill(xs);
  fill(ys);

  const smooth = (values: number[]) =>
    values.map((_, i) => {
      const a = values[Math.max(0, i - 1)];
      const b = values[i];
      const c = values[Math.min(n - 1, i + 1)];
      return round((a + 2 * b + c) / 4, 4);
    });

  return { x: smooth(xs), y: smooth(ys) };
}

function shouldAnimate(xs: number[], ys: number[]): boolean {
  const range = (v: number[]) => Math.max(...v) - Math.min(...v);
  return range(xs) > 0.004 || range(ys) > 0.004;
}

function buildKeys(samples: Sample[], xs: number[], ys: number[]): { x: Keyframe[]; y: Keyframe[] } {
  const x: Keyframe[] = [];
  const y: Keyframe[] = [];
  for (let i = 0; i < samples.length; i++) {
    const kx = { t: round(samples[i].t, 3), v: xs[i] };
    const ky = { t: round(samples[i].t, 3), v: ys[i] };
    const lastX = x[x.length - 1];
    const lastY = y[y.length - 1];
    const unchanged =
      lastX && lastY && Math.abs(lastX.v - kx.v) < 0.004 && Math.abs(lastY.v - ky.v) < 0.004;
    if (unchanged) {
      if (i === samples.length - 1) {
        x[x.length - 1] = kx;
        y[y.length - 1] = ky;
      }
      continue;
    }
    x.push(kx);
    y.push(ky);
  }
  return { x, y };
}

function makeVideo(url: string): HTMLVideoElement {
  const v = document.createElement('video');
  v.src = url;
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  return v;
}

function waitMetadata(v: HTMLVideoElement): Promise<void> {
  if (v.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      v.removeEventListener('loadedmetadata', done);
      v.removeEventListener('error', fail);
      clearTimeout(timer);
      resolve();
    };
    const fail = () => {
      v.removeEventListener('loadedmetadata', done);
      v.removeEventListener('error', fail);
      clearTimeout(timer);
      reject(new Error('Video could not be read for reframing.'));
    };
    const timer = window.setTimeout(() => reject(new Error('Timed out reading video for reframing.')), 8000);
    v.addEventListener('loadedmetadata', done, { once: true });
    v.addEventListener('error', fail, { once: true });
  });
}

function seek(v: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(v.currentTime - time) < 0.025 && v.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      v.removeEventListener('seeked', finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, 4000);
    v.addEventListener('seeked', finish, { once: true });
    try {
      v.currentTime = Math.max(0, time);
    } catch {
      finish();
    }
  });
}

async function analyzeClip(
  clip: Clip,
  asset: MediaAsset,
  target: ReframeTarget,
  onProgress: (fraction: number, detail: string) => void,
  signal: AbortSignal,
): Promise<Analysis> {
  const empty: Analysis = { baseX: 0, baseY: 0, keys: [], samples: 0, faces: 0 };
  let v: HTMLVideoElement | null = null;
  try {
    const maxDim = 640;
    let sw = asset.width;
    let sh = asset.height;
    const samples: Sample[] = [];
    let faceCount = 0;
    let previous: FaceBox | null = null;
    const canvas = document.createElement('canvas');

    if (asset.kind === 'image') {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Image could not be read for reframing.'));
        el.src = asset.url;
      });
      sw = img.naturalWidth;
      sh = img.naturalHeight;
      const scale = Math.min(1, maxDim / Math.max(sw, sh));
      canvas.width = Math.max(2, Math.round(sw * scale));
      canvas.height = Math.max(2, Math.round(sh * scale));
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      let face: FaceBox | null = null;
      try {
        face = pickFace(await detectFaces(canvas), null);
      } catch {
        face = null;
      }
      if (face) faceCount = 1;
      const framing = computeFraming(sw, sh, target.width, target.height, face?.cx ?? 0.5, face?.cy ?? 0.5);
      return { baseX: framing.x, baseY: framing.y, keys: [], samples: 1, faces: faceCount };
    }

    if (asset.kind !== 'video') return empty;
    v = makeVideo(asset.url);
    await waitMetadata(v);
    sw = v.videoWidth || asset.width;
    sh = v.videoHeight || asset.height;
    const scale = Math.min(1, maxDim / Math.max(sw, sh));
    canvas.width = Math.max(2, Math.round(sw * scale));
    canvas.height = Math.max(2, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');

    const count = Math.min(30, Math.max(3, Math.ceil(clip.duration) + 1));
    for (let i = 0; i < count; i++) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const t = (clip.duration * i) / (count - 1);
      const sourceT = clamp(clip.inPoint + t * clip.speed, 0, Math.max(0, asset.duration - 0.04));
      await seek(v, sourceT);
      let face: FaceBox | null = null;
      if (v.readyState >= 2 && ctx) {
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        try {
          face = pickFace(await detectFaces(canvas), previous);
        } catch {
          face = null;
        }
      }
      if (face) {
        previous = face;
        faceCount++;
        const framing = computeFraming(sw, sh, target.width, target.height, face.cx, face.cy);
        samples.push({ t, x: framing.x, y: framing.y, known: true });
      } else {
        samples.push({ t, x: 0, y: 0, known: false });
      }
      onProgress((i + 1) / count, `Analyzing ${asset.name} · ${i + 1}/${count}`);
    }

    if (!samples.length) return empty;
    const { x, y } = fillAndSmooth(samples);
    if (!faceCount) return { ...empty, samples: samples.length };
    if (!shouldAnimate(x, y)) {
      return {
        baseX: x[0] ?? 0,
        baseY: y[0] ?? 0,
        keys: [],
        samples: samples.length,
        faces: faceCount,
      };
    }
    const keys = buildKeys(samples, x, y);
    const merged = keys.x.map((kx, i) => ({ t: kx.t, x: kx.v, y: keys.y[i].v }));
    return { baseX: merged[0]?.x ?? 0, baseY: merged[0]?.y ?? 0, keys: merged, samples: samples.length, faces: faceCount };
  } finally {
    if (v) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
  }
}

export async function autoReframeProject(
  project: Project,
  assets: Record<string, MediaAsset>,
  target: ReframeTarget,
  onProgress: (p: ReframeProgress) => void,
  signal: AbortSignal,
): Promise<ReframeResult> {
  const entries: { clip: Clip; asset: MediaAsset }[] = [];
  for (const track of project.tracks) {
    if (track.kind !== 'video' || track.hidden || track.locked) continue;
    for (const clip of track.clips) {
      if (clip.text) continue;
      const asset = assets[clip.assetId];
      if (!asset || (asset.kind !== 'video' && asset.kind !== 'image')) continue;
      if (asset.width < 2 || asset.height < 2) continue;
      if (clipEnd(clip) <= clip.start + 0.05) continue;
      entries.push({ clip, asset });
    }
  }

  onProgress({ phase: 'load', percent: 0, detail: 'Loading face detector…' });
  let faceTracking = true;
  try {
    await loadFaceDetector();
  } catch {
    faceTracking = false;
  }
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');

  const analyses = new Map<string, Analysis>();
  let totalSamples = 0;
  let faceSamples = 0;
  let completed = 0;
  const totalWeight = Math.max(1, entries.reduce((n, e) => n + Math.max(1, Math.ceil(e.clip.duration)), 0));

  for (const entry of entries) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    let analysis: Analysis;
    if (!faceTracking) {
      analysis = { baseX: 0, baseY: 0, keys: [], samples: 0, faces: 0 };
    } else {
      analysis = await analyzeClip(entry.clip, entry.asset, target, (fraction) => {
        onProgress({
          phase: 'analyze',
          percent: 3 + (Math.min(1, (completed + Math.ceil(entry.clip.duration) * fraction) / totalWeight) * 90),
          detail: `Analyzing ${entry.asset.name}`,
        });
      }, signal);
    }
    analyses.set(entry.clip.id, analysis);
    completed += Math.max(1, Math.ceil(entry.clip.duration));
    totalSamples += analysis.samples;
    faceSamples += analysis.faces;
    onProgress({
      phase: 'analyze',
      percent: 3 + Math.min(1, completed / totalWeight) * 90,
      detail: `Framed ${analyses.size} of ${entries.length} clips`,
    });
  }

  onProgress({ phase: 'apply', percent: 96, detail: 'Applying keyframes…' });
  const projectOut: Project = {
    ...project,
    width: target.width,
    height: target.height,
    tracks: project.tracks.map((track) => {
      if (track.kind !== 'video' || track.locked) return track;
      return {
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.text) return clip;
          const a = analyses.get(clip.id);
          if (!a) return clip;
          const keyframes = { ...clip.keyframes };
          delete keyframes.x;
          delete keyframes.y;
          if (a.keys.length >= 2) {
            keyframes.x = a.keys.map((k) => ({ t: k.t, v: k.x }));
            keyframes.y = a.keys.map((k) => ({ t: k.t, v: k.y }));
          }
          return {
            ...clip,
            fill: true,
            transform: {
              ...clip.transform,
              scale: 1,
              rotation: 0,
              x: a.keys[0]?.x ?? a.baseX,
              y: a.keys[0]?.y ?? a.baseY,
            },
            keyframes,
          };
        }),
      };
    }),
  };

  onProgress({ phase: 'apply', percent: 100, detail: 'Done' });
  return {
    project: projectOut,
    stats: { clips: entries.length, samples: totalSamples, faces: faceSamples, faceTracking },
  };
}

