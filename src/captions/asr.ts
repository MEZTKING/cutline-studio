import type { CaptionSegment } from '../core/types';

export const ASR_MODEL = 'onnx-community/whisper-tiny.en';
export const ASR_APPROX_MB = 41;

export interface AsrProgress {
  phase: 'download' | 'transcribe' | 'done';
  percent: number;
  detail: string;
}

export interface TranscribeOptions {
  onProgress?: (p: AsrProgress) => void;
  signal?: AbortSignal;
}

type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{
  text?: string;
  chunks?: { text: string; timestamp: [number, number | null] }[];
}>;

let transcriber: Transcriber | null = null;
let loading: Promise<Transcriber> | null = null;
let downloadEmit: ((p: AsrProgress) => void) | null = null;

async function loadTranscriber(onProgress?: (p: AsrProgress) => void): Promise<Transcriber> {
  if (transcriber) return transcriber;
  if (!loading) {
    downloadEmit = onProgress ?? null;
    loading = (async () => {
      const mod = (await import('@huggingface/transformers')) as unknown as {
        pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<Transcriber>;
        env: { allowLocalModels: boolean; allowRemoteModels: boolean };
      };
      mod.env.allowLocalModels = false;
      mod.env.allowRemoteModels = true;
      const files = new Map<string, { loaded: number; total: number }>();
      let lastEmit = 0;
      const pipe = await mod.pipeline('automatic-speech-recognition', ASR_MODEL, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (raw: unknown) => {
          const evt = raw as { status?: string; file?: string; loaded?: number; total?: number };
          if (evt?.status !== 'progress' || !evt.file) return;
          files.set(evt.file, { loaded: evt.loaded ?? 0, total: evt.total ?? 0 });
          let loaded = 0;
          let total = 0;
          for (const f of files.values()) {
            loaded += f.loaded;
            total += f.total;
          }
          const percent = total > 0 ? Math.min(99, (loaded / total) * 100) : 0;
          const now = performance.now();
          if (now - lastEmit > 140 || percent > 99) {
            lastEmit = now;
            downloadEmit?.({
              phase: 'download',
              percent,
              detail: `Downloading speech model · ${(loaded / 1e6).toFixed(0)} MB`, 
            });
          }
        },
      });
      return pipe;
    })()
      .then((pipe) => {
        transcriber = pipe;
        downloadEmit?.({ phase: 'download', percent: 100, detail: 'Speech model ready' });
        return pipe;
      })
      .catch((err: unknown) => {
        loading = null;
        throw new Error(
          `Could not load the on-device speech model. Connect to the internet once to cache it (about ${ASR_APPROX_MB} MB). ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }
  return loading;
}

function splitCue(seg: CaptionSegment, maxChars = 84, maxDuration = 8.5): CaptionSegment[] {
  const words = seg.text.split(/\s+/).filter(Boolean);
  const duration = seg.end - seg.start;
  if ((seg.text.length <= maxChars && duration <= maxDuration) || words.length < 5) return [seg];

  const pieces = Math.max(2, Math.ceil(seg.text.length / maxChars), Math.ceil(duration / maxDuration));
  const per = Math.ceil(words.length / pieces);
  const groups: string[][] = [];
  for (let i = 0; i < words.length; i += per) groups.push(words.slice(i, i + per));
  // Avoid orphan words at the end of a cue.
  if (groups.length > 1 && groups[groups.length - 1].length < 3) {
    const tail = groups.pop()!;
    groups[groups.length - 1] = [...groups[groups.length - 1], ...tail];
  }
  if (groups.length <= 1) return [seg];

  const totalChars = groups.reduce((n, g) => n + g.join(' ').length, 0);
  let cursor = seg.start;
  return groups.map((group, i) => {
    const text = group.join(' ');
    const start = cursor;
    const share = duration * (text.length / totalChars);
    const end = i === groups.length - 1 ? seg.end : Math.min(seg.end, start + Math.max(0.6, share));
    cursor = end;
    return { start: round3(start), end: round3(Math.max(end, start + 0.35)), text };
  });
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function cleanText(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—]+/, '')
    .trim();
}

/** Transcribe mono 16 kHz audio on-device, returning timeline-ready caption cues. */
export async function transcribeAudio(audio: Float32Array, opts: TranscribeOptions = {}): Promise<CaptionSegment[]> {
  const { onProgress, signal } = opts;
  const sampleRate = 16000;
  const chunkSeconds = 28;
  const totalChunks = Math.max(1, Math.ceil(audio.length / (sampleRate * chunkSeconds)));

  onProgress?.({ phase: 'download', percent: 0, detail: `Preparing speech engine (${ASR_APPROX_MB} MB one-time download)` });
  const pipe = await loadTranscriber(onProgress);
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

  const cues: CaptionSegment[] = [];
  for (let i = 0; i < totalChunks; i++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const base = i * chunkSeconds;
    onProgress?.({
      phase: 'transcribe',
      percent: (i / totalChunks) * 100,
      detail: `Transcribing ${i + 1} of ${totalChunks} · ${Math.round(base + Math.min(chunkSeconds, audio.length / sampleRate - base))}s`,
    });
    const slice = audio.subarray(base * sampleRate, Math.min(audio.length, (base + chunkSeconds) * sampleRate));
    if (slice.length < sampleRate * 0.2) continue;
    let result: Awaited<ReturnType<Transcriber>>;
    try {
      result = await pipe(slice, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      });
    } catch (err) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      throw new Error(`Transcription failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

    for (const chunk of result.chunks ?? []) {
      const text = cleanText(chunk.text ?? '');
      if (!text || /^\[[^\]]*\]$/.test(text) || /^\([^)]*\)$/.test(text)) continue;
      const ts = chunk.timestamp;
      const start = base + (ts?.[0] ?? 0);
      const end = base + (ts?.[1] ?? Math.min(chunkSeconds, start - base + 4));
      if (start < 0) continue;
      const cue = { start: round3(start), end: round3(Math.max(start + 0.3, end)), text };
      for (const piece of splitCue(cue)) cues.push(piece);
    }
  }

  // Drop duplicate cues produced at chunk seams.
  const deduped: CaptionSegment[] = [];
  for (const cue of cues) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.text.toLowerCase() === cue.text.toLowerCase() && Math.abs(prev.start - cue.start) < 1.2) continue;
    deduped.push(cue);
  }

  onProgress?.({ phase: 'done', percent: 100, detail: `Transcribed ${deduped.length} cues` });
  return deduped.sort((a, b) => a.start - b.start);
}
