import { clipEnd, previousClip } from '../core/model';
import type { Clip, MediaAsset, Project, Track } from '../core/types';
import { ensureAudioDecoded, getAudioContext } from '../media/import';

export interface GainEvent {
  /** Seconds from the start of the scheduled region (i.e. of the clip segment being played). */
  t: number;
  v: number;
}

export interface AudioItem {
  clip: Clip;
  track: Track;
  asset: MediaAsset;
  buffer: AudioBuffer;
  /** Seconds after `from` when this source should start. */
  when: number;
  /** Source offset in seconds. */
  offset: number;
  /** Timeline seconds to play. */
  playDur: number;
  /** Start gain when the region begins. */
  startGain: number;
  /** Remaining envelope points after the start. */
  events: GainEvent[];
}

function fadeFactors(clip: Clip, local: number): number {
  let f = 1;
  if (clip.fadeIn > 0.005) f *= Math.min(1, Math.max(0, local / clip.fadeIn));
  if (clip.fadeOut > 0.005) f *= Math.min(1, Math.max(0, (clip.duration - local) / clip.fadeOut));
  return f;
}

function transitionOutOf(track: Track, clip: Clip, asset: MediaAsset): number {
  const ordered = [...track.clips].sort((a, b) => a.start - b.start);
  const idx = ordered.findIndex((c) => c.id === clip.id);
  const next = idx >= 0 ? ordered[idx + 1] : undefined;
  if (!next || !next.transition) return 0;
  if (Math.abs(next.start - clipEnd(clip)) > 0.05) return 0;
  const d = Math.min(next.transition.duration, next.duration, clip.duration);
  const remainingSource = Math.max(0, asset.duration - (clip.inPoint + clip.duration * clip.speed));
  return Math.min(d, remainingSource / Math.max(0.1, clip.speed));
}

/** Build the schedule for every audible clip at or after `from`. */
export function planAudio(project: Project, assets: Record<string, MediaAsset>, from: number): AudioItem[] {
  const items: AudioItem[] = [];
  for (const track of project.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      const asset = assets[clip.assetId];
      if (!asset?.audioBuffer) continue;
      if (clipEnd(clip) <= from + 0.005) continue;
      if (clip.start < from && clipEnd(clip) <= from) continue;

      const buffer = asset.audioBuffer;
      const extraOut = transitionOutOf(track, clip, asset);
      const end = Math.min(clipEnd(clip) + extraOut, clip.start + (asset.duration - clip.inPoint) / clip.speed);
      const start = Math.max(from, clip.start);
      const playDur = end - start;
      if (playDur <= 0.01) continue;

      const offset = clip.inPoint + (start - clip.start) * clip.speed;
      if (offset >= buffer.duration - 0.01) continue;

      const local = start - clip.start;
      let startGain = clip.volume * fadeFactors(clip, local);

      // Transition-in fades the clip up from silence.
      const prev = previousClip(track, clip);
      const dIn = clip.transition && prev ? Math.min(clip.transition.duration, clip.duration, prev.duration) : 0;
      if (dIn > 0.01) {
        if (local < dIn) startGain *= Math.min(1, Math.max(0, local / dIn));
        else startGain *= 1;
      }

      const events: GainEvent[] = [];
      const inDur = Math.max(clip.fadeIn, dIn);
      if (inDur > 0.01 && local < inDur) {
        events.push({ t: inDur - local, v: clip.volume });
      } else if (local < 0.02) {
        events.push({ t: 0.02, v: clip.volume });
      }

      if (clip.fadeOut > 0.01) {
        const fadeStart = Math.max(0, clip.duration - clip.fadeOut - local);
        const fadeEnd = clip.duration - local;
        if (fadeEnd > 0.01) {
          events.push({ t: fadeStart, v: clip.volume });
          events.push({ t: fadeEnd, v: 0 });
        }
      }
      if (extraOut > 0.01) {
        const outStart = clip.duration - local;
        if (outStart >= 0) {
          events.push({ t: outStart, v: clip.volume });
          events.push({ t: outStart + extraOut, v: 0 });
        }
      }

      events.sort((a, b) => a.t - b.t);
      const trimmed = events.filter((e) => e.t > 0.001);
      items.push({ clip, track, asset, buffer, when: Math.max(0, start - from), offset, playDur, startGain, events: trimmed });
    }
  }
  return items;
}

export class AudioEngine {
  private ctx: AudioContext;
  private master: GainNode;
  private active: AudioBufferSourceNode[] = [];
  private startedAtCtx = 0;
  private startedAtTimeline = 0;
  private running = false;

  constructor() {
    this.ctx = getAudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.ctx.destination);
  }

  get context(): AudioContext {
    return this.ctx;
  }

  setMasterVolume(v: number): void {
    this.master.gain.setTargetAtTime(Math.max(0, v), this.ctx.currentTime, 0.02);
  }

  async start(project: Project, assets: Record<string, MediaAsset>, from: number): Promise<void> {
    this.stop();
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => undefined);
    }
    // Make sure restored projects can decode their audio lazily.
    const needed = new Set<string>();
    for (const track of project.tracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (clipEnd(clip) > from && !assets[clip.assetId]?.audioBuffer) needed.add(clip.assetId);
      }
    }
    if (needed.size) {
      await Promise.all([...needed].map((id) => (assets[id] ? ensureAudioDecoded(assets[id]) : Promise.resolve(null))));
    }

    const items = planAudio(project, assets, from);
    const t0 = this.ctx.currentTime + 0.06;
    for (const item of items) {
      const src = this.ctx.createBufferSource();
      src.buffer = item.buffer;
      src.playbackRate.value = Math.min(16, Math.max(0.0625, item.clip.speed));
      const gain = this.ctx.createGain();
      const startAt = t0 + item.when;
      gain.gain.setValueAtTime(item.startGain, startAt);
      for (const ev of item.events) {
        const at = startAt + ev.t;
        if (at <= startAt) continue;
        gain.gain.linearRampToValueAtTime(Math.max(0, ev.v), at);
      }
      src.connect(gain).connect(this.master);
      try {
        src.start(startAt, item.offset);
        const endAt = startAt + item.playDur;
        src.stop(endAt);
        if (item.events.length) {
          const last = item.events[item.events.length - 1];
          if (last.t > item.playDur) src.stop(startAt + last.t);
        }
      } catch {
        continue;
      }
      this.active.push(src);
    }
    this.startedAtCtx = t0;
    this.startedAtTimeline = from;
    this.running = true;
  }

  stop(): void {
    for (const src of this.active) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
      src.disconnect();
    }
    this.active = [];
    this.running = false;
  }

  get playing(): boolean {
    return this.running;
  }

  time(): number {
    if (!this.running) return this.startedAtTimeline;
    return this.startedAtTimeline + Math.max(0, this.ctx.currentTime - this.startedAtCtx);
  }
}

let engineSingleton: AudioEngine | null = null;
export function getAudioEngine(): AudioEngine {
  if (!engineSingleton) engineSingleton = new AudioEngine();
  return engineSingleton;
}