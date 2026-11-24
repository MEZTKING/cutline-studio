import { ensureAudioDecoded } from '../media/import';
import { planAudio } from './engine';
import type { MediaAsset, Project } from '../core/types';

/** Mix the timeline to mono 16 kHz PCM for on-device speech recognition. */
export async function renderSpeech(project: Project, assets: Record<string, MediaAsset>, duration: number, sampleRate = 16000): Promise<Float32Array | null> {
  if (duration <= 0.1) return null;

  await Promise.all(
    Object.values(assets)
      .filter((a) => !a.audioBuffer && (a.kind === 'video' || a.kind === 'audio') && project.tracks.some((t) => t.clips.some((c) => c.assetId === a.id)))
      .map((a) => ensureAudioDecoded(a)),
  );

  const items = planAudio(project, assets, 0);
  if (!items.length) return null;

  const length = Math.ceil(duration * sampleRate);
  const ctx = new OfflineAudioContext(1, length, sampleRate);
  for (const item of items) {
    const src = ctx.createBufferSource();
    src.buffer = item.buffer;
    src.playbackRate.value = item.clip.speed;
    const gain = ctx.createGain();
    const startAt = Math.max(0, item.when);
    gain.gain.setValueAtTime(Math.max(0.0001, item.startGain), startAt);
    for (const ev of item.events) {
      if (ev.t <= 0) continue;
      gain.gain.linearRampToValueAtTime(Math.max(0.0001, ev.v), startAt + ev.t);
    }
    src.connect(gain).connect(ctx.destination);
    try {
      src.start(startAt, Math.max(0, item.offset));
      src.stop(startAt + item.playDur + 0.05);
    } catch {
      continue;
    }
  }
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

/** Mix the whole timeline to a stereo buffer for export. */
export async function renderMixdown(project: Project, assets: Record<string, MediaAsset>, duration: number, sampleRate = 48000): Promise<AudioBuffer | null> {
  if (duration <= 0.05) return null;

  // Decode anything still pending so restored projects export with sound.
  await Promise.all(
    Object.values(assets)
      .filter((a) => !a.audioBuffer && (a.kind === 'video' || a.kind === 'audio') && project.tracks.some((t) => t.clips.some((c) => c.assetId === a.id)))
      .map((a) => ensureAudioDecoded(a)),
  );

  const items = planAudio(project, assets, 0);
  if (!items.length) return null;

  const length = Math.ceil(duration * sampleRate);
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  for (const item of items) {
    const src = ctx.createBufferSource();
    src.buffer = item.buffer;
    src.playbackRate.value = item.clip.speed;
    const gain = ctx.createGain();
    const startAt = item.when;
    gain.gain.setValueAtTime(Math.max(0.0001, item.startGain), startAt);
    for (const ev of item.events) {
      if (ev.t <= 0) continue;
      gain.gain.linearRampToValueAtTime(Math.max(0.0001, ev.v), startAt + ev.t);
    }
    src.connect(gain).connect(ctx.destination);
    try {
      src.start(startAt, Math.max(0, item.offset));
      src.stop(startAt + item.playDur + 0.05);
    } catch {
      continue;
    }
  }
  const rendered = await ctx.startRendering();
  return rendered;
}