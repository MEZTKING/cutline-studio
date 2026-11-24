import type { CaptionSegment } from '../core/types';

function parseTimestamp(raw: string): number | null {
  const m = raw
    .trim()
    .replace(',', '.')
    .match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const sec = Number(m[3]);
  const ms = Number((m[4] ?? '0').padEnd(3, '0'));
  return h * 3600 + min * 60 + sec + ms / 1000;
}

/** Parse SubRip (SRT). Tolerates CRLF, BOM, dot or comma milliseconds, and missing indices. */
export function parseSrt(input: string): CaptionSegment[] {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const out: CaptionSegment[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
    if (!lines.length) continue;
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx < 0) continue;
    const [rawStart, rawEnd] = lines[timingIdx].split('-->');
    const start = parseTimestamp((rawStart ?? '').trim());
    const end = parseTimestamp((rawEnd ?? '').trim().split(/\s+/)[0] ?? '');
    if (start == null || end == null || end <= start) continue;
    const content = lines
      .slice(timingIdx + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\{\\[^}]+\}/g, '')
      .trim();
    if (!content) continue;
    out.push({ start, end, text: content });
  }
  return out.sort((a, b) => a.start - b.start);
}

function stamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const total = Math.floor(totalMs / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

export function formatSrt(segments: CaptionSegment[]): string {
  return segments
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((seg, i) => {
      const content = seg.text.trim().replace(/\n{3,}/g, '\n\n');
      return `${i + 1}\n${stamp(seg.start)} --> ${stamp(seg.end)}\n${content}`;
    })
    .join('\n\n')
    .concat('\n');
}

export function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
