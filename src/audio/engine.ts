import { clipEnd, previousClip, propValue } from '../core/model';
import type { Clip, MediaAsset, Project, Track } from '../core/types';
import { ensureAudioDecoded, getAudioContext } from '../media/import';
import { clamp, curveValue } from './envelope';
import { createClipChain } from './chain';

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
  const anySolo = project.tracks.some((t) => t.solo);

  for (const track of project.tracks) {
    if (track.muted) continue;
    if (anySolo && !track.solo) continue;
    for (const clip of track.clips) {
      if (clip.muted || clip.audioDetached) continue;
      const asset = assets[clip.assetId];
      if (!asset?.audioBuffer) continue;
      if (clipEnd(clip) <= from + 0.005) continue;

      const buffer = asset.audioBuffer;
      const extraOut = transitionOutOf(track, clip, asset);
      const sourceEnd = clip.start + (asset.duration - clip.inPoint) / clip.speed;
      const end = Math.min(clipEnd(clip) + extraOut, sourceEnd);
      const start = Math.max(from, clip.start);
      const playDur = end - start;
      if (playDur <= 0.01) continue;

      const offset = clip.inPoint + (start - clip.start) * clip.speed;
      if (offset >= buffer.duration - 0.01) continue;

      const local = start - clip.start;
      const prev = previousClip(track, clip);
      const dIn = clip.transition && prev ? Math.min(clip.transition.duration, clip.duration, prev.duration) : 0;
      const inDur = Math.max(clip.fadeIn ?? 0, dIn);
      const fadeOut = clip.fadeOut ?? 0;
      const curve = clip.fadeCurve ?? 'linear';

      const gainAt = (atLocal: number): number => {
        const l = clamp(atLocal, 0, clip.duration);
        let v = propValue(clip, 'volume', l);
        if (inDur > 0.005) v *= curveValue(curve, l / inDur);
        if (fadeOut > 0.005) v *= curveValue(curve, (clip.duration - l) / fadeOut);
        if (extraOut > 0.005 && atLocal > clip.duration) {
          v *= 1 - curveValue(curve, (atLocal - clip.duration) / extraOut);
        }
        return clamp(v, 0, 4);
      };

      const times = new Set<number>();
      const add = (t: number) => {
        if (Number.isFinite(t)) times.add(Math.round(t * 1000) / 1000);
      };
      if (inDur > local) {
        for (let i = 0; i <= 8; i++) add(local + ((inDur - local) * i) / 8);
      }
      if (fadeOut > 0.005) {
        const fadeStart = clip.duration - fadeOut;
        for (let i = 0; i <= 8; i++) add(fadeStart + (fadeOut * i) / 8);
      }
      if (extraOut > 0.005) {
        for (let i = 0; i <= 8; i++) add(clip.duration + (extraOut * i) / 8);
      }
      for (const k of clip.keyframes.volume ?? []) add(k.t);
      add(clip.duration);
      add(clip.duration + extraOut);

      const events: GainEvent[] = [...times]
        .filter((t) => t > local + 0.005 && t <= end + 0.005)
        .sort((a, b) => a - b)
        .map((t) => ({ t: t - local, v: gainAt(t) }));

      items.push({
        clip,
        track,
        asset,
        buffer,
        when: Math.max(0, start - from),
        offset,
        playDur,
        startGain: gainAt(local),
        events,
      });
    }
  }
  return items;
}

export class AudioEngine {
  private ctx: AudioContext;
  private master: GainNode;
  private active: { src: AudioBufferSourceNode; nodes: AudioNode[] }[] = [];
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
    const anySolo = project.tracks.some((t) => t.solo);
    for (const track of project.tracks) {
      if (track.muted || (anySolo && !track.solo)) continue;
      for (const clip of track.clips) {
        if (clip.muted || clip.audioDetached) continue;
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
      const chain = createClipChain(this.ctx, item.clip, this.master);
      const gain = chain.gain;
      const startAt = t0 + item.when;
      gain.gain.setValueAtTime(item.startGain, startAt);
      for (const ev of item.events) {
        const at = startAt + ev.t;
        if (at <= startAt) continue;
        gain.gain.linearRampToValueAtTime(Math.max(0, ev.v), at);
      }
      src.connect(chain.input);
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
      this.active.push({ src, nodes: chain.nodes });
    }
    this.startedAtCtx = t0;
    this.startedAtTimeline = from;
    this.running = true;
  }

  stop(): void {
    for (const { src, nodes } of this.active) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
      src.disconnect();
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          /* already disconnected */
        }
      }
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