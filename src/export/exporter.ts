import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer';
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer';
import { projectDuration } from '../core/model';
import type { MediaAsset, Project } from '../core/types';
import { renderMixdown } from '../audio/mixdown';
import { drawFrame, MediaPool, prepareFrame } from '../render/renderer';

export type ExportFormat = 'auto' | 'mp4' | 'webm';
export type ExportQuality = 'fast' | 'balanced' | 'high';

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  quality: ExportQuality;
  format: ExportFormat;
  includeAudio: boolean;
  fileName: string;
}

export interface ExportProgress {
  phase: string;
  percent: number;
}

export interface ExportResult {
  blob: Blob;
  extension: 'mp4' | 'webm';
  filename: string;
  durationSeconds: number;
}

interface EncoderPlan {
  container: 'mp4' | 'webm';
  videoCodec: string;
  muxerVideoCodec: 'avc' | 'vp9' | 'vp8';
  audioCodec: string | null;
  muxerAudioCodec: 'aac' | 'opus' | null;
  mime: string;
}

const VIDEO_CODECS: Record<'mp4' | 'webm', { codec: string; muxer: 'avc' | 'vp9' | 'vp8' }[]> = {
  mp4: [
    { codec: 'avc1.640028', muxer: 'avc' },
    { codec: 'avc1.4d0028', muxer: 'avc' },
    { codec: 'avc1.42001f', muxer: 'avc' },
  ],
  webm: [
    { codec: 'vp09.00.10.08', muxer: 'vp9' },
    { codec: 'vp8', muxer: 'vp8' },
  ],
};

function bitrateFor(width: number, height: number, fps: number, quality: ExportQuality): number {
  const mult = quality === 'fast' ? 0.055 : quality === 'high' ? 0.16 : 0.1;
  return Math.min(80_000_000, Math.max(2_000_000, Math.round(width * height * fps * mult)));
}

function hasWebCodecs(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { VideoEncoder?: unknown }).VideoEncoder === 'function';
}

export function webCodecsAvailable(): boolean {
  return hasWebCodecs();
}

async function videoConfigSupported(codec: string, width: number, height: number, fps: number, bitrate: number): Promise<boolean> {
  try {
    const VE = (window as unknown as { VideoEncoder: { isConfigSupported: (c: unknown) => Promise<{ supported?: boolean }> } }).VideoEncoder;
    const config: Record<string, unknown> = { codec, width, height, bitrate, framerate: fps, latencyMode: 'quality' };
    if (codec.startsWith('avc1')) config.avc = { format: 'avc' };
    const res = await VE.isConfigSupported(config);
    return !!res.supported;
  } catch {
    return false;
  }
}

async function audioConfigSupported(codec: 'mp4a.40.2' | 'opus'): Promise<boolean> {
  try {
    const AE = (window as unknown as { AudioEncoder?: { isConfigSupported: (c: unknown) => Promise<{ supported?: boolean }> } }).AudioEncoder;
    if (!AE) return false;
    const res = await AE.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
    return !!res.supported;
  } catch {
    return false;
  }
}

export async function getExportCapabilities(): Promise<{ mp4: boolean; webm: boolean; webcodecs: boolean }> {
  if (!hasWebCodecs()) return { mp4: false, webm: false, webcodecs: false };
  const [avc, vp9, aac, opus] = await Promise.all([
    videoConfigSupported('avc1.640028', 1920, 1080, 30, 8_000_000),
    videoConfigSupported('vp09.00.10.08', 1920, 1080, 30, 8_000_000),
    audioConfigSupported('mp4a.40.2'),
    audioConfigSupported('opus'),
  ]);
  return { mp4: avc || aac, webm: vp9 || opus, webcodecs: true };
}

async function choosePlan(width: number, height: number, fps: number, quality: ExportQuality, format: ExportFormat, wantsAudio: boolean): Promise<EncoderPlan> {
  const bitrate = bitrateFor(width, height, fps, quality);
  const order: ('mp4' | 'webm')[] =
    format === 'auto' ? ['mp4', 'webm'] : format === 'mp4' ? ['mp4'] : ['webm'];

  for (const container of order) {
    const audioOk = wantsAudio
      ? container === 'mp4'
        ? await audioConfigSupported('mp4a.40.2')
        : await audioConfigSupported('opus')
      : false;
    // In auto mode, prefer a container that can carry sound over a silent MP4.
    if (wantsAudio && !audioOk && format === 'auto') continue;
    for (const v of VIDEO_CODECS[container]) {
      if (!(await videoConfigSupported(v.codec, width, height, fps, bitrate))) continue;
      return {
        container,
        videoCodec: v.codec,
        muxerVideoCodec: v.muxer,
        audioCodec: audioOk ? (container === 'mp4' ? 'mp4a.40.2' : 'opus') : null,
        muxerAudioCodec: audioOk ? (container === 'mp4' ? 'aac' : 'opus') : null,
        mime: container === 'mp4' ? 'video/mp4' : 'video/webm',
      };
    }
  }
  throw new Error('No supported hardware or software encoder was found in this browser. Try Chrome on Android or desktop Chrome/Edge.');
}

function projectHasAudio(project: Project, assets: Record<string, MediaAsset>): boolean {
  for (const track of project.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      const a = assets[clip.assetId];
      if (a && (a.kind === 'audio' || (a.kind === 'video' && a.audioBuffer))) return true;
    }
  }
  return false;
}

export async function exportProject(
  project: Project,
  assets: Record<string, MediaAsset>,
  settings: ExportSettings,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
): Promise<ExportResult> {
  if (!hasWebCodecs()) {
    throw new Error('This browser lacks WebCodecs. Use Chrome, Edge, or Chrome on Android to export.');
  }
  const duration = projectDuration(project);
  if (duration < 0.1) throw new Error('Nothing to export — add a clip to the timeline first.');

  const width = Math.max(16, Math.round(settings.width / 2) * 2);
  const height = Math.max(16, Math.round(settings.height / 2) * 2);
  const fps = Math.min(60, Math.max(12, Math.round(settings.fps)));
  const wantsAudio = settings.includeAudio && projectHasAudio(project, assets);

  onProgress({ phase: 'Preparing', percent: 0 });
  const plan = await choosePlan(width, height, fps, settings.quality, settings.format, wantsAudio);

  const checkAbort = () => {
    if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
  };

  // ---- Audio mix ----
  let audioBuffer: AudioBuffer | null = null;
  if (plan.audioCodec) {
    onProgress({ phase: 'Mixing audio', percent: 2 });
    audioBuffer = await renderMixdown(project, assets, duration, 48000);
    checkAbort();
  }

  const mp4Target = plan.container === 'mp4' ? new Mp4Target() : null;
  const webmTarget = plan.container === 'webm' ? new WebmTarget() : null;

  const muxer = plan.container === 'mp4'
    ? new Mp4Muxer({
        target: mp4Target!,
        fastStart: 'in-memory',
        video: { codec: 'avc', width, height, frameRate: fps },
        audio: audioBuffer && plan.muxerAudioCodec === 'aac' ? { codec: 'aac', numberOfChannels: 2, sampleRate: 48000 } : undefined,
      })
    : new WebmMuxer({
        target: webmTarget!,
        video: { codec: plan.muxerVideoCodec === 'vp9' ? 'V_VP9' : 'V_VP8', width, height, frameRate: fps },
        audio: audioBuffer && plan.muxerAudioCodec === 'opus' ? { codec: 'A_OPUS', numberOfChannels: 2, sampleRate: 48000 } : undefined,
      });

  let fatal: Error | null = null;

  // ---- Audio encode ----
  if (audioBuffer && plan.audioCodec) {
    const AE = (window as unknown as { AudioEncoder: new (init: unknown) => AudioEncoderLike }).AudioEncoder;
    const aenc = new AE({
      output: (chunk: unknown, meta: unknown) => {
        try {
          muxer.addAudioChunk(chunk as never, meta as never);
        } catch (e) {
          fatal = e instanceof Error ? e : new Error(String(e));
        }
      },
      error: (e: unknown) => {
        fatal = e instanceof Error ? e : new Error(String(e));
      },
    });
    aenc.configure({ codec: plan.audioCodec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
    try {
    const sr = audioBuffer.sampleRate;
    const channels = Math.min(2, audioBuffer.numberOfChannels);
    const total = audioBuffer.length;
    const chunkFrames = 9600; // 200ms
    const p0 = audioBuffer.getChannelData(0);
    const p1 = channels > 1 ? audioBuffer.getChannelData(1) : p0;
    for (let off = 0; off < total; off += chunkFrames) {
      checkAbort();
      if (fatal) throw fatal;
      const frames = Math.min(chunkFrames, total - off);
      const planar = new Float32Array(frames * channels);
      planar.set(p0.subarray(off, off + frames), 0);
      if (channels > 1) planar.set(p1.subarray(off, off + frames), frames);
      const data = makeAudioData({
        format: 'f32-planar',
        sampleRate: sr,
        numberOfFrames: frames,
        numberOfChannels: channels,
        timestamp: Math.round((off / sr) * 1_000_000),
        data: planar,
      });
      aenc.encode(data as never);
      data.close();
      while (aenc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
    }
    await aenc.flush();
    } finally {
      try {
        aenc.close();
      } catch {
        /* already closed */
      }
    }
    onProgress({ phase: 'Encoding audio', percent: 8 });
  }

  const VE = (window as unknown as { VideoEncoder: new (init: unknown) => VideoEncoderLike }).VideoEncoder;
  const venc = new VE({
    output: (chunk: unknown, meta: unknown) => {
      try {
        muxer.addVideoChunk(chunk as never, meta as never);
      } catch (e) {
        fatal = e instanceof Error ? e : new Error(String(e));
      }
    },
    error: (e: unknown) => {
      fatal = e instanceof Error ? e : new Error(String(e));
    },
  });
  venc.configure({
    codec: plan.videoCodec,
    width,
    height,
    bitrate: bitrateFor(width, height, fps, settings.quality),
    framerate: fps,
    latencyMode: 'quality',
    ...(plan.videoCodec.startsWith('avc1') ? { avc: { format: 'avc' } } : {}),
  });


  // ---- Video frames ----
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas is unavailable.');
  const pool = new MediaPool();

  const totalFrames = Math.max(1, Math.ceil(duration * fps));
  const keyEvery = Math.max(1, Math.round(fps * 2));
  const VideoFrameCtor = (window as unknown as { VideoFrame: new (source: CanvasImageSource, init: { timestamp: number; duration?: number }) => VideoFrameLike }).VideoFrame;
  if (!VideoFrameCtor) throw new Error('VideoFrame is unavailable in this browser.');

  try {
  for (let i = 0; i < totalFrames; i++) {
    checkAbort();
    if (fatal) throw fatal;
    const t = i / fps;
    await prepareFrame(project, assets, t, pool, 'seek');
    drawFrame(ctx, project, assets, t, width, height, pool);
    const frame = new VideoFrameCtor(canvas, {
      timestamp: Math.round((i * 1_000_000) / fps),
      duration: Math.round(1_000_000 / fps),
    });
    venc.encode(frame, { keyFrame: i % keyEvery === 0 });
    frame.close();
    while (venc.encodeQueueSize > 6) {
      await new Promise((r) => setTimeout(r, 4));
      if (fatal) throw fatal;
    }
    if (i % 4 === 0 || i === totalFrames - 1) {
      onProgress({ phase: `Rendering ${i + 1}/${totalFrames}`, percent: 8 + Math.round((i / totalFrames) * 82) });
    }
  }
  await venc.flush();
  } finally {
    try {
      venc.close();
    } catch {
      /* already closed */
    }
    pool.dispose();
  }

  checkAbort();
  onProgress({ phase: 'Finalising file', percent: 92 });
  muxer.finalize();

  const buffer = plan.container === 'mp4' ? mp4Target!.buffer : webmTarget!.buffer;
  if (!buffer) throw new Error('The muxer produced no data.');
  const blob = new Blob([buffer], { type: plan.mime });
  onProgress({ phase: 'Done', percent: 100 });

  const base = (settings.fileName || project.name || 'cutline-export')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return { blob, extension: plan.container, filename: `${base || 'export'}.${plan.container}`, durationSeconds: duration };
}

interface VideoEncoderLike {
  configure(config: Record<string, unknown>): void;
  encode(frame: unknown, opts?: { keyFrame?: boolean }): void;
  flush(): Promise<void>;
  close(): void;
  encodeQueueSize: number;
}

interface AudioEncoderLike {
  configure(config: Record<string, unknown>): void;
  encode(data: unknown): void;
  flush(): Promise<void>;
  close(): void;
  encodeQueueSize: number;
}

interface VideoFrameLike {
  close(): void;
}

function makeAudioData(init: Record<string, unknown>): { close(): void } {
  const Ctor = (window as unknown as { AudioData?: new (i: unknown) => { close(): void } }).AudioData;
  if (!Ctor) throw new Error('AudioData is unavailable, so audio cannot be encoded here.');
  return new Ctor(init);
}