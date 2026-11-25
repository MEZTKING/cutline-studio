import {
  COLOR_DEFAULTS,
  TRANSFORM_DEFAULTS,
  type AnimatableProp,
  type Clip,
  type Keyframe,
  type MediaAsset,
  type Project,
  type Track,
  type TrackKind,
  type Transition,
  type TransitionType,
  type CaptionSegment,
} from './types';

let counter = 0;
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 100000;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function createProject(name = 'Untitled project'): Project {
  return {
    id: uid('prj'),
    name,
    width: 1920,
    height: 1080,
    fps: 30,
    tracks: [
      { id: uid('trk'), kind: 'video', name: 'V1', muted: false, solo: false, hidden: false, locked: false, clips: [] },
      { id: uid('trk'), kind: 'audio', name: 'A1', muted: false, solo: false, hidden: false, locked: false, clips: [] },
    ],
  };
}

export function defaultColor(): import('./types').ColorGrade {
  return {
    ...COLOR_DEFAULTS,
    lift: { ...(COLOR_DEFAULTS.lift ?? { x: 0, y: 0, master: 0 }) },
    gamma: { ...(COLOR_DEFAULTS.gamma ?? { x: 0, y: 0, master: 0 }) },
    gain: { ...(COLOR_DEFAULTS.gain ?? { x: 0, y: 0, master: 0 }) },
  };
}

export function createClip(asset: MediaAsset, start: number, inPoint = 0, duration?: number): Clip {
  const maxDur = asset.kind === 'image' ? Number.POSITIVE_INFINITY : Math.max(0.1, asset.duration - inPoint);
  const dur = duration ?? Math.min(asset.duration || 10, maxDur);
  return {
    id: uid('clp'),
    assetId: asset.id,
    name: asset.name,
    start: Math.max(0, round(start)),
    duration: Math.max(0.1, round(Math.min(dur, maxDur))),
    inPoint: Math.max(0, round(inPoint)),
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    fadeCurve: 'linear',
    pan: 0,
    eqLow: 0,
    eqMid: 0,
    eqHigh: 0,
    compress: 0,
    muted: false,
    audioType: null,
    transform: { ...TRANSFORM_DEFAULTS },
    color: defaultColor(),
    transition: null,
    keyframes: {},
  };
}

export function createTextClip(start: number, content = 'Your title'): Clip {
  return {
    id: uid('txt'),
    assetId: '',
    name: 'Title',
    start: Math.max(0, round(start)),
    duration: 5,
    inPoint: 0,
    speed: 1,
    volume: 0,
    fadeIn: 0,
    fadeOut: 0,
    fadeCurve: 'linear',
    pan: 0,
    eqLow: 0,
    eqMid: 0,
    eqHigh: 0,
    compress: 0,
    muted: false,
    audioType: null,
    transform: { ...TRANSFORM_DEFAULTS },
    color: defaultColor(),
    transition: null,
    keyframes: {},
    fill: false,
    text: {
      content,
      size: 8,
      color: '#ffffff',
      align: 'center',
      bold: true,
      shadow: true,
      background: '#000000',
      backgroundOpacity: 0.28,
      padding: 1.6,
    },
  };
}

export function createCaptionClip(start: number, duration: number, content: string): Clip {
  const clip = createTextClip(start, content);
  return {
    ...clip,
    name: 'Caption',
    duration: Math.max(0.3, round(duration)),
    transform: { ...clip.transform, y: 0.355 },
    text: {
      ...clip.text!,
      caption: true,
      size: 4.4,
      bold: false,
      shadow: true,
      align: 'center',
      background: '#000000',
      backgroundOpacity: 0.62,
      padding: 0.85,
    },
  };
}

export function captionSegments(project: Project): CaptionSegment[] {
  const out: CaptionSegment[] = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (!clip.text?.caption) continue;
      out.push({ start: clip.start, end: clipEnd(clip), text: clip.text.content });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function round(n: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export const clipEnd = (c: Clip): number => c.start + c.duration;

export function sourceDuration(clip: Clip, asset: MediaAsset): number {
  if (asset.kind === 'image') return Number.POSITIVE_INFINITY;
  return Math.max(0.1, (asset.duration - clip.inPoint) / clip.speed);
}

/** Source media time for a timeline time. */
export function sourceTimeAt(clip: Clip, t: number): number {
  return Math.max(0, clip.inPoint + (t - clip.start) * clip.speed);
}

export function sortedClips(track: Track): Clip[] {
  return [...track.clips].sort((a, b) => a.start - b.start);
}

export function clipAt(track: Track, t: number): Clip | null {
  let hit: Clip | null = null;
  for (const c of track.clips) {
    if (t >= c.start - 1e-6 && t < clipEnd(c) - 1e-6) {
      if (!hit || c.start > hit.start) hit = c;
    }
  }
  return hit;
}

export function previousClip(track: Track, clip: Clip): Clip | null {
  let best: Clip | null = null;
  for (const c of track.clips) {
    if (c.id === clip.id) continue;
    if (clipEnd(c) <= clip.start + 0.04 && (!best || clipEnd(c) > clipEnd(best))) best = c;
  }
  return best;
}

export interface ActiveTransition {
  type: TransitionType;
  duration: number;
  progress: number;
  from: Clip;
  to: Clip;
}

/** A transition only exists if the incoming clip declares one and the previous clip abuts it. */
export function transitionAt(track: Track, clip: Clip, t: number): ActiveTransition | null {
  const tr = clip.transition;
  if (!tr || tr.duration <= 0.01) return null;
  const prev = previousClip(track, clip);
  if (!prev) return null;
  if (Math.abs(clipEnd(prev) - clip.start) > 0.05) return null;
  const duration = Math.min(tr.duration, clip.duration, prev.duration);
  if (t < clip.start || t > clip.start + duration) return null;
  return {
    type: tr.type,
    duration,
    progress: Math.min(1, Math.max(0, (t - clip.start) / duration)),
    from: prev,
    to: clip,
  };
}

export function evalKeyframes(kfs: Keyframe[] | undefined, localT: number, fallback: number): number {
  if (!kfs || kfs.length === 0) return fallback;
  if (kfs.length === 1) return kfs[0].v;
  if (localT <= kfs[0].t) return kfs[0].v;
  const last = kfs[kfs.length - 1];
  if (localT >= last.t) return last.v;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (localT >= a.t && localT <= b.t) {
      const span = b.t - a.t;
      const p = span <= 0 ? 0 : (localT - a.t) / span;
      // smoothstep for a filmic ease in/out
      const e = p * p * (3 - 2 * p);
      return a.v + (b.v - a.v) * e;
    }
  }
  return last.v;
}

export function propValue(clip: Clip, prop: AnimatableProp, localT: number): number {
  const base: Record<AnimatableProp, number> = {
    x: clip.transform.x,
    y: clip.transform.y,
    scale: clip.transform.scale,
    rotation: clip.transform.rotation,
    opacity: clip.transform.opacity,
    volume: clip.volume,
  };
  return evalKeyframes(clip.keyframes[prop], localT, base[prop]);
}

export function isAnimated(clip: Clip, prop: AnimatableProp): boolean {
  return (clip.keyframes[prop]?.length ?? 0) > 0;
}

export function upsertKeyframe(clip: Clip, prop: AnimatableProp, localT: number, value: number): Partial<Record<AnimatableProp, Keyframe[]>> {
  const list = [...(clip.keyframes[prop] ?? [])];
  const idx = list.findIndex((k) => Math.abs(k.t - localT) < 0.02);
  const kf = { t: round(localT), v: round(value) };
  if (idx >= 0) list[idx] = kf;
  else list.push(kf);
  list.sort((a, b) => a.t - b.t);
  return { ...clip.keyframes, [prop]: list };
}

export function removeKeyframe(clip: Clip, prop: AnimatableProp, localT: number): Partial<Record<AnimatableProp, Keyframe[]>> {
  const list = (clip.keyframes[prop] ?? []).filter((k) => Math.abs(k.t - localT) >= 0.02);
  const next = { ...clip.keyframes };
  if (list.length === 0) delete next[prop];
  else next[prop] = list;
  return next;
}

export function keyframeAt(clip: Clip, prop: AnimatableProp, localT: number): Keyframe | null {
  return (clip.keyframes[prop] ?? []).find((k) => Math.abs(k.t - localT) < 0.02) ?? null;
}

export function findClip(project: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export function mapClip(project: Project, clipId: string, fn: (clip: Clip) => Clip): Project {
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.clips.some((c) => c.id === clipId)
        ? { ...track, clips: track.clips.map((c) => (c.id === clipId ? fn(c) : c)) }
        : track,
    ),
  };
}

export function patchClip(project: Project, clipId: string, patch: Partial<Clip>): Project {
  return mapClip(project, clipId, (c) => ({ ...c, ...patch }));
}

export function clampClipToSource(clip: Clip, asset: MediaAsset): Clip {
  const available = asset.kind === 'image' ? Number.POSITIVE_INFINITY : Math.max(0.1, asset.duration);
  const speed = Math.min(16, Math.max(0.1, clip.speed));
  const maxDur = asset.kind === 'image' ? Number.POSITIVE_INFINITY : Math.max(0.1, (available - clip.inPoint) / speed);
  const duration = Math.min(clip.duration, maxDur);
  const inPoint = Math.min(Math.max(0, clip.inPoint), Math.max(0, available - duration * speed));
  return {
    ...clip,
    speed,
    inPoint: round(inPoint),
    duration: round(Math.max(0.1, duration)),
    start: round(Math.max(0, clip.start)),
  };
}

/** Split the clip under the playhead. Returns null when the playhead is on an edge. */
export function splitClip(clip: Clip, t: number): [Clip, Clip] | null {
  const EPS = 0.02;
  if (t <= clip.start + EPS || t >= clipEnd(clip) - EPS) return null;
  const leftDur = round(t - clip.start);
  const rightDur = round(clip.duration - leftDur);
  const cutPoint = round(clip.inPoint + leftDur * clip.speed);
  const left: Clip = { ...clip, duration: leftDur, transition: clip.transition, keyframes: shiftKeyframes(clip.keyframes, 0, leftDur) };
  const right: Clip = {
    ...clip,
    id: uid('clp'),
    start: round(t),
    duration: rightDur,
    inPoint: cutPoint,
    transition: null,
    fadeIn: 0,
    keyframes: shiftKeyframes(clip.keyframes, leftDur, clip.duration),
    transform: { ...clip.transform },
    color: { ...clip.color },
  };
  return [left, right];
}

function shiftKeyframes(kfs: Clip['keyframes'], from: number, to: number): Clip['keyframes'] {
  const out: Clip['keyframes'] = {};
  for (const [prop, list] of Object.entries(kfs) as [AnimatableProp, Keyframe[]][]) {
    const kept = list.filter((k) => k.t >= from - 0.001 && k.t <= to + 0.001).map((k) => ({ ...k, t: round(k.t - from) }));
    if (kept.length) out[prop] = kept;
  }
  return out;
}

export function splitAt(project: Project, t: number, onlyClipId?: string): Project {
  let next = project;
  for (const track of project.tracks) {
    if (track.locked) continue;
    for (const clip of track.clips) {
      if (onlyClipId && clip.id !== onlyClipId) continue;
      const parts = splitClip(clip, t);
      if (!parts) continue;
      next = {
        ...next,
        tracks: next.tracks.map((tr) =>
          tr.id === track.id ? { ...tr, clips: [...tr.clips.filter((c) => c.id !== clip.id), ...parts] } : tr,
        ),
      };
    }
  }
  return next;
}

export function addClip(project: Project, trackId: string, asset: MediaAsset, start: number, opts: { inPoint?: number; duration?: number } = {}): { project: Project; clip: Clip } {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return { project, clip: createClip(asset, start) };
  const clip = createClip(asset, start, opts.inPoint ?? 0, opts.duration);
  const next = {
    ...project,
    tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, clips: sortedClips({ ...t, clips: [...t.clips, clip] }) } : t)),
  };
  return { project: next, clip };
}

export function removeClip(project: Project, clipId: string): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) })),
  };
}

/** Delete and close the gap on this track, pulling later clips left. */
export function rippleDelete(project: Project, clipId: string): Project {
  return {
    ...project,
    tracks: project.tracks.map((track) => {
      const clip = track.clips.find((c) => c.id === clipId);
      if (!clip) return track;
      return {
        ...track,
        clips: track.clips
          .filter((c) => c.id !== clipId)
          .map((c) => (c.start >= clipEnd(clip) - 1e-6 ? { ...c, start: round(Math.max(0, c.start - clip.duration)) } : c)),
      };
    }),
  };
}

export function moveClip(project: Project, clipId: string, targetTrackId: string, newStart: number): Project {
  const found = findClip(project, clipId);
  if (!found) return project;
  const { track: fromTrack, clip } = found;
  const toTrack = project.tracks.find((t) => t.id === targetTrackId);
  if (!toTrack || toTrack.locked) return project;
  if (toTrack.kind !== fromTrack.kind) return project;
  const moved = { ...clip, start: round(Math.max(0, newStart)) };
  if (fromTrack.id === toTrack.id) {
    return {
      ...project,
      tracks: project.tracks.map((t) =>
        t.id === fromTrack.id ? { ...t, clips: sortedClips({ ...t, clips: t.clips.map((c) => (c.id === clipId ? moved : c)) }) } : t,
      ),
    };
  }
  return {
    ...project,
    tracks: project.tracks.map((t) => {
      if (t.id === fromTrack.id) return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
      if (t.id === toTrack.id) return { ...t, clips: sortedClips({ ...t, clips: [...t.clips, moved] }) };
      return t;
    }),
  };
}

export function addTrack(project: Project, kind: TrackKind): Project {
  const count = project.tracks.filter((t) => t.kind === kind).length + 1;
  const track: Track = {
    id: uid('trk'),
    kind,
    name: `${kind === 'video' ? 'V' : 'A'}${count}`,
    muted: false,
    solo: false,
    hidden: false,
    locked: false,
    clips: [],
  };
  const tracks = [...project.tracks];
  if (kind === 'video') {
    // New video tracks stack above the existing ones so overlays sit on top.
    tracks.unshift(track);
  } else {
    tracks.push(track);
  }
  return { ...project, tracks };
}

export function removeTrack(project: Project, trackId: string): Project {
  const videos = project.tracks.filter((t) => t.kind === 'video' && t.id !== trackId).length;
  const audios = project.tracks.filter((t) => t.kind === 'audio' && t.id !== trackId).length;
  if (videos === 0 && audios === 0) return project;
  return { ...project, tracks: project.tracks.filter((t) => t.id !== trackId) };
}

export function projectDuration(project: Project): number {
  let end = 0;
  for (const track of project.tracks) for (const clip of track.clips) end = Math.max(end, clipEnd(clip));
  return end;
}

export function trackDisplayName(track: Track): string {
  return track.name;
}

export function defaultTransition(type: TransitionType): Transition {
  return { type, duration: 0.6 };
}

export function formatTimecode(seconds: number, fps = 30): string {
  const s = Math.max(0, seconds);
  const totalFrames = Math.round(s * fps);
  const f = totalFrames % fps;
  const total = Math.floor(totalFrames / fps);
  const sec = total % 60;
  const min = Math.floor(total / 60) % 60;
  const hr = Math.floor(total / 3600);
  const p = (n: number, w = 2) => n.toString().padStart(w, '0');
  return `${p(hr)}:${p(min)}:${p(sec)}:${p(f)}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return m > 0 ? `${m}:${rest.toFixed(1).padStart(4, '0')}` : `${rest.toFixed(1)}s`;
}