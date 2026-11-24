import { uid } from '../core/model';
import type { MediaAsset, MediaKind } from '../core/types';

let audioCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctor({ latencyHint: 'interactive', sampleRate: 48000 });
  }
  return audioCtx;
}

export function classify(file: File): MediaKind | null {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('image/')) return 'image';
  if (/\.(mp4|m4v|mov|webm|mkv|avi|ogv)$/.test(name)) return 'video';
  if (/\.(mp3|m4a|aac|wav|ogg|opus|flac)$/.test(name)) return 'audio';
  if (/\.(png|jpe?g|webp|gif|avif|bmp)$/.test(name)) return 'image';
  return null;
}

function waitEvent(el: HTMLMediaElement, event: string, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      el.removeEventListener(event, onOk);
      el.removeEventListener('error', onErr);
      clearTimeout(timer);
    };
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error('Media could not be decoded by this browser.'));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out reading media metadata.'));
    }, timeoutMs);
    el.addEventListener(event, onOk, { once: true });
    el.addEventListener('error', onErr, { once: true });
  });
}

function makeVideo(url: string): HTMLVideoElement {
  const v = document.createElement('video');
  v.src = url;
  v.crossOrigin = 'anonymous';
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  return v;
}

/** Some containers (WebM from MediaRecorder, streams) report Infinity until probed. */
async function probeVideoDuration(v: HTMLVideoElement): Promise<number> {
  let d = v.duration;
  if (Number.isFinite(d) && d > 0) return d;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      v.removeEventListener('durationchange', finish);
      v.removeEventListener('seeked', finish);
      resolve();
    };
    v.addEventListener('durationchange', finish);
    v.addEventListener('seeked', finish);
    try {
      v.currentTime = 1e7;
    } catch {
      finish();
    }
    window.setTimeout(finish, 3500);
  });
  d = v.duration;
  return Number.isFinite(d) && d > 0 ? d : 0;
}

async function seekVideo(v: HTMLVideoElement, t: number): Promise<void> {
  if (Math.abs(v.currentTime - t) < 0.01 && v.readyState >= 2) return;
  const p = waitEvent(v, 'seeked', 8000);
  v.currentTime = Math.max(0, t);
  await p;
}

export function computePeaks(buffer: AudioBuffer, buckets = 900): number[] {
  const data = buffer.getChannelData(0);
  const peaks: number[] = [];
  const step = Math.max(1, Math.floor(data.length / buckets));
  for (let i = 0; i < buckets; i++) {
    let peak = 0;
    const start = i * step;
    const end = Math.min(data.length, start + step);
    for (let j = start; j < end; j += 4) {
      const v = Math.abs(data[j]);
      if (v > peak) peak = v;
    }
    peaks.push(Math.min(1, peak));
  }
  return peaks;
}

export function waveformThumbnail(peaks: number[], width = 480, height = 270, color = '#6ee7b7'): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, '#0c1a16');
  g.addColorStop(1, '#07100d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = color;
  const mid = height / 2;
  const step = width / peaks.length;
  ctx.beginPath();
  for (let i = 0; i < peaks.length; i++) {
    const h = Math.max(1, peaks[i] * (height * 0.38));
    const x = i * step;
    ctx.rect(x, mid - h, Math.max(1, step * 0.8), h * 2);
  }
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(width, mid);
  ctx.stroke();
  return canvas.toDataURL('image/jpeg', 0.72);
}

function imageThumbnail(img: HTMLImageElement, width = 480): string {
  const ratio = img.naturalHeight / img.naturalWidth || 0.5625;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round(width * Math.min(1.6, Math.max(0.4, ratio)));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0b0d0f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.75);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = src;
  });
}

async function decodeAudioFromBlob(blob: Blob): Promise<AudioBuffer | null> {
  try {
    const buf = await blob.arrayBuffer();
    const ctx = getAudioContext();
    return await ctx.decodeAudioData(buf.slice(0));
  } catch {
    return null;
  }
}

export interface ImportProgress {
  name: string;
  index: number;
  total: number;
}

export async function importFile(file: File, onProgress?: (p: ImportProgress) => void): Promise<MediaAsset> {
  const kind = classify(file);
  if (!kind) throw new Error(`${file.name}: unsupported file type. Use MP4, MOV, WebM, MP3, WAV, or image files.`);

  onProgress?.({ name: file.name, index: 0, total: 1 });
  const url = URL.createObjectURL(file);
  const base: MediaAsset = {
    id: uid('ast'),
    name: file.name.replace(/\.[^.]+$/, ''),
    kind,
    duration: 10,
    width: 1920,
    height: 1080,
    hasAudio: false,
    url,
    file,
  };

  if (kind === 'video') {
    const v = makeVideo(url);
    try {
      await waitEvent(v, 'loadedmetadata');
      base.width = v.videoWidth || 1920;
      base.height = v.videoHeight || 1080;

      const audio = await decodeAudioFromBlob(file);
      if (audio && audio.duration > 0.05) {
        base.hasAudio = true;
        base.audioBuffer = audio;
        base.peaks = computePeaks(audio);
      }

      let duration = await probeVideoDuration(v);
      if (duration <= 0.05 && audio && audio.duration > 0.05) duration = audio.duration;
      base.duration = duration > 0.05 ? duration : 10;

      const seekTo = Math.min(Math.max(0.05, base.duration * 0.15), Math.max(0.05, base.duration - 0.05));
      v.currentTime = 0;
      await seekVideo(v, seekTo).catch(() => undefined);
      const tw = 480;
      const th = Math.max(1, Math.round((tw * base.height) / base.width));
      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext('2d')!;
      if (v.readyState >= 2) ctx.drawImage(v, 0, 0, tw, th);
      base.thumbnail = canvas.toDataURL('image/jpeg', 0.72);
      if (base.hasAudio && !base.thumbnail) base.thumbnail = waveformThumbnail(base.peaks ?? []);
    } finally {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
  } else if (kind === 'audio') {
    const audio = await decodeAudioFromBlob(file);
    let duration = audio?.duration ?? 0;
    if (!duration) {
      const a = document.createElement('audio');
      a.src = url;
      await waitEvent(a, 'loadedmetadata').catch(() => undefined);
      duration = Number.isFinite(a.duration) ? a.duration : 0;
      a.src = '';
    }
    base.duration = duration || 10;
    base.hasAudio = true;
    base.width = 0;
    base.height = 0;
    if (audio) {
      base.audioBuffer = audio;
      base.peaks = computePeaks(audio);
      base.thumbnail = waveformThumbnail(base.peaks);
    }
  } else {
    const img = await loadImage(url);
    base.width = img.naturalWidth;
    base.height = img.naturalHeight;
    base.duration = 10;
    base.thumbnail = imageThumbnail(img);
  }

  return base;
}

export async function ensureAudioDecoded(asset: MediaAsset): Promise<AudioBuffer | null> {
  if (asset.kind === 'image') return null;
  if (asset.audioBuffer) return asset.audioBuffer;
  if (!asset.file) return null;
  const audio = await decodeAudioFromBlob(asset.file);
  if (audio) {
    asset.audioBuffer = audio;
    asset.hasAudio = true;
    if (!asset.peaks) asset.peaks = computePeaks(audio);
  }
  return audio;
}