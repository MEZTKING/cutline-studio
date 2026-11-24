import type { MediaAsset, Project, Track } from '../core/types';
import { clipEnd } from './model';

export function preferredTrack(project: Project, kind: MediaAsset['kind'], selectedTrackId?: string | null): Track | null {
  const wanted = kind === 'audio' ? 'audio' : 'video';
  if (selectedTrackId) {
    const sel = project.tracks.find((t) => t.id === selectedTrackId);
    if (sel && sel.kind === wanted && !sel.locked) return sel;
  }
  // Visuals land on the lowest video track (V1); audio on the first audio track.
  const candidates = project.tracks.filter((t) => t.kind === wanted && !t.locked);
  return wanted === 'video' ? candidates[candidates.length - 1] ?? null : candidates[0] ?? null;
}

/** First gap at or after t on this track that fits the clip. */
export function freeStart(track: Track, t: number, duration: number): number {
  const clips = [...track.clips].sort((a, b) => a.start - b.start);
  let start = Math.max(0, t);
  let moved = true;
  let guard = 0;
  while (moved && guard < 200) {
    moved = false;
    guard++;
    for (const c of clips) {
      const end = clipEnd(c);
      if (start < end - 0.001 && start + duration > c.start + 0.001) {
        start = end;
        moved = true;
      }
    }
  }
  return start;
}

export function defaultInsertStart(track: Track, playhead: number, duration: number): number {
  return freeStart(track, playhead, duration);
}