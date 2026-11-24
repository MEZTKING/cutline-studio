import { clipEnd, clipAt, propValue, sourceTimeAt, transitionAt, type ActiveTransition } from '../core/model';
import type { Clip, MediaAsset, Project, Track } from '../core/types';

export type FrameMode = 'play' | 'seek';

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const easeFade = (p: number) => clamp01(p);

export interface VisualSource {
  clip: Clip;
  asset: MediaAsset;
  /** Absolute timeline time the clip should display. */
  at: number;
}

export class MediaPool {
  private videos = new Map<string, HTMLVideoElement>();
  private images = new Map<string, HTMLImageElement>();
  private imageRequests = new Map<string, Promise<HTMLImageElement | null>>();
  onReady: (() => void) | null = null;

  video(key: string, url: string): HTMLVideoElement {
    let v = this.videos.get(key);
    if (!v) {
      v = document.createElement('video');
      v.src = url;
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.loop = false;
      v.crossOrigin = 'anonymous';
      (v as HTMLVideoElement & { disablePictureInPicture?: boolean }).disablePictureInPicture = true;
      v.addEventListener('loadeddata', () => this.onReady?.());
      v.addEventListener('seeked', () => this.onReady?.());
      v.addEventListener('loadedmetadata', () => this.onReady?.());
      v.load();
      this.videos.set(key, v);
    }
    return v;
  }

  getVideo(key: string): HTMLVideoElement | null {
    return this.videos.get(key) ?? null;
  }

  async image(url: string): Promise<HTMLImageElement | null> {
    const hit = this.images.get(url);
    if (hit) return hit;
    let req = this.imageRequests.get(url);
    if (!req) {
      req = new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          this.images.set(url, img);
          this.onReady?.();
          resolve(img);
        };
        img.onerror = () => resolve(null);
        img.src = url;
      });
      this.imageRequests.set(url, req);
    }
    return req;
  }

  hasImage(url: string): boolean {
    return this.images.has(url);
  }

  getImage(url: string): HTMLImageElement | null {
    return this.images.get(url) ?? null;
  }

  trim(active: Set<string>, limit = 16): void {
    if (this.videos.size <= limit) return;
    for (const [key, v] of [...this.videos]) {
      if (this.videos.size <= limit) break;
      if (active.has(key)) continue;
      v.pause();
      v.removeAttribute('src');
      v.load();
      this.videos.delete(key);
    }
  }

  pauseAllExcept(active: Set<string>): void {
    for (const [key, v] of this.videos) {
      if (!active.has(key) && !v.paused) v.pause();
    }
  }

  dispose(): void {
    for (const v of this.videos.values()) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
    this.videos.clear();
    this.images.clear();
    this.imageRequests.clear();
  }
}

function sourceKey(clip: Clip): string {
  return `clip:${clip.id}`;
}

/** Clips that contribute a picture at time t, including the outgoing side of a transition. */
export function collectVisuals(project: Project, t: number): { track: Track; clip: Clip; partner: Clip | null; transition: ActiveTransition | null }[] {
  const out: { track: Track; clip: Clip; partner: Clip | null; transition: ActiveTransition | null }[] = [];
  for (const track of project.tracks) {
    if (track.kind !== 'video' || track.hidden) continue;
    const clip = clipAt(track, t);
    if (!clip) continue;
    const tr = transitionAt(track, clip, t);
    out.push({ track, clip, partner: tr ? tr.from : null, transition: tr });
  }
  return out;
}

function desiredTime(clip: Clip, at: number, asset: MediaAsset): number {
  const raw = sourceTimeAt(clip, at);
  const max = asset.kind === 'image' ? Number.POSITIVE_INFINITY : Math.max(0, asset.duration - 0.033);
  return Math.min(raw, max);
}

async function seekElement(v: HTMLVideoElement, time: number): Promise<void> {
  if (v.readyState < 1) {
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        v.removeEventListener('loadedmetadata', finish);
        resolve();
      };
      v.addEventListener('loadedmetadata', finish, { once: true });
      window.setTimeout(finish, 4000);
    });
  }
  if (Math.abs(v.currentTime - time) < 0.008) return;
  const p = new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      v.removeEventListener('seeked', finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, 2500);
    v.addEventListener('seeked', finish, { once: true });
  });
  try {
    v.currentTime = Math.max(0, time);
  } catch {
    /* element may be tearing down */
  }
  await p;
}

/**
 * Bring every visible source to the right frame. In 'seek' mode this resolves once
 * frames are decodable (used by scrubbing and export); in 'play' mode it nudges
 * drifting elements without stalling.
 */
export async function prepareFrame(project: Project, assets: Record<string, MediaAsset>, t: number, pool: MediaPool, mode: FrameMode): Promise<void> {
  const visuals = collectVisuals(project, t);
  const active = new Set<string>();
  const jobs: Promise<void>[] = [];

  for (const { clip, partner } of visuals) {
    const asset = assets[clip.assetId];
    if (!asset) continue;
    if (asset.kind === 'image') {
      if (!pool.hasImage(asset.url)) void pool.image(asset.url);
      continue;
    }
    if (asset.kind !== 'video') continue;

    const key = sourceKey(clip);
    active.add(key);
    const v = pool.video(key, asset.url);
    const time = desiredTime(clip, t, asset);

    if (mode === 'play') {
      v.playbackRate = Math.min(16, Math.max(0.0625, clip.speed));
      if (Math.abs(v.currentTime - time) > 0.35) {
        jobs.push(seekElement(v, time));
      }
      if (v.paused) void v.play().catch(() => undefined);
    } else {
      if (!v.paused) v.pause();
      jobs.push(seekElement(v, time));
    }

    if (partner) {
      const pAsset = assets[partner.assetId];
      if (pAsset && pAsset.kind === 'image') {
        if (!pool.hasImage(pAsset.url)) void pool.image(pAsset.url);
      }
      if (pAsset && pAsset.kind === 'video') {
        const pKey = sourceKey(partner);
        active.add(pKey);
        const pv = pool.video(pKey, pAsset.url);
        const pTime = desiredTime(partner, Math.min(t, clipEnd(partner) - 0.001), pAsset);
        if (mode === 'play') {
          if (pv.paused) void pv.play().catch(() => undefined);
          if (Math.abs(pv.currentTime - pTime) > 0.35) jobs.push(seekElement(pv, pTime));
        } else {
          if (!pv.paused) pv.pause();
          jobs.push(seekElement(pv, pTime));
        }
      }
    }
  }

  pool.pauseAllExcept(active);
  if (jobs.length) await Promise.all(jobs);
  pool.trim(active);
}

function colorFilter(clip: Clip): string {
  const c = clip.color;
  const parts: string[] = [];
  if (c.brightness) parts.push(`brightness(${(1 + c.brightness / 100).toFixed(3)})`);
  if (c.contrast) parts.push(`contrast(${(1 + c.contrast / 100).toFixed(3)})`);
  if (c.saturation) parts.push(`saturate(${(1 + c.saturation / 100).toFixed(3)})`);
  if (c.hue) parts.push(`hue-rotate(${c.hue}deg)`);
  if (c.blur > 0) parts.push(`blur(${c.blur.toFixed(2)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

interface DrawOptions {
  alpha?: number;
  offsetX?: number;
  offsetY?: number;
}

function drawClip(ctx: CanvasRenderingContext2D, clip: Clip, asset: MediaAsset | undefined, at: number, w: number, h: number, pool: MediaPool, opts: DrawOptions = {}): void {
  const local = Math.max(0, at - clip.start);
  if (local < -0.02) return;
  let opacity = propValue(clip, 'opacity', local);
  if (clip.fadeIn > 0.01) opacity *= easeFade(local / clip.fadeIn);
  if (clip.fadeOut > 0.01) opacity *= easeFade((clip.duration - local) / clip.fadeOut);
  opacity *= opts.alpha ?? 1;
  if (opacity <= 0.002) return;

  if (clip.text) {
    drawTextClip(ctx, clip, local, w, h, opacity, opts);
    return;
  }
  if (!asset) return;

  let source: CanvasImageSource | null = null;
  let sw = asset.width;
  let sh = asset.height;
  if (asset.kind === 'video') {
    const v = pool.getVideo(sourceKey(clip));
    if (v && v.readyState >= 2 && v.videoWidth > 0) {
      source = v;
      sw = v.videoWidth;
      sh = v.videoHeight;
    } else {
      const still = pool.getVideo(sourceKey(clip));
      if (still && still.readyState >= 2) {
        source = still;
      }
    }
  } else if (asset.kind === 'image') {
    const img = pool.getImage(asset.url);
    if (img) source = img;
  }
  if (!source || !sw || !sh) return;

  const scaleFit = clip.fill ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh);
  const scale = Math.max(0.01, propValue(clip, 'scale', local));
  const dw = sw * scaleFit * scale;
  const dh = sh * scaleFit * scale;
  const x = propValue(clip, 'x', local) * w + (opts.offsetX ?? 0);
  const y = propValue(clip, 'y', local) * h + (opts.offsetY ?? 0);
  const rot = (propValue(clip, 'rotation', local) * Math.PI) / 180;

  ctx.save();
  ctx.translate(w / 2 + x, h / 2 + y);
  if (rot) ctx.rotate(rot);
  ctx.globalAlpha = clamp01(opacity);
  ctx.filter = colorFilter(clip);
  try {
    ctx.drawImage(source, -dw / 2, -dh / 2, dw, dh);
  } catch {
    /* tainted or not-ready frame */
  }
  ctx.filter = 'none';

  const temp = clip.color.temperature;
  if (Math.abs(temp) > 0.5) {
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = clamp01(Math.abs(temp) / 120);
    ctx.fillStyle = temp > 0 ? '#ff9a3c' : '#3c9aff';
    ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = clamp01(opacity);
  }

  if (clip.color.vignette > 0.5) {
    const r0 = Math.min(dw, dh) * 0.32;
    const r1 = Math.max(dw, dh) * 0.78;
    const g = ctx.createRadialGradient(0, 0, r0, 0, 0, r1);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${clamp01(clip.color.vignette / 100) * 0.9})`);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = g;
    ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
  }
  ctx.restore();
}

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace('#', '').trim();
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return `rgba(0,0,0,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (!line || ctx.measureText(test).width <= maxWidth) line = test;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

function drawTextClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  local: number,
  w: number,
  h: number,
  opacity: number,
  opts: DrawOptions,
): void {
  const spec = clip.text;
  if (!spec || !spec.content.trim()) return;
  const scale = Math.max(0.01, propValue(clip, 'scale', local));
  const x = propValue(clip, 'x', local) * w + (opts.offsetX ?? 0);
  const y = propValue(clip, 'y', local) * h + (opts.offsetY ?? 0);
  const rot = (propValue(clip, 'rotation', local) * Math.PI) / 180;
  const fontSize = Math.max(4, (spec.size / 100) * h * scale);
  const lineHeight = fontSize * 1.19;
  const pad = (spec.padding / 100) * h * scale;

  ctx.save();
  ctx.translate(w / 2 + x, h / 2 + y);
  if (rot) ctx.rotate(rot);
  ctx.globalAlpha = clamp01(opacity);
  ctx.filter = 'none';
  ctx.font = `${spec.bold ? '700' : '400'} ${fontSize}px -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`;
  ctx.textBaseline = 'middle';

  const lines = wrapLines(ctx, spec.content, Math.max(24, w * 0.84));
  let blockWidth = 0;
  for (const line of lines) blockWidth = Math.max(blockWidth, ctx.measureText(line).width);
  const blockHeight = Math.max(lineHeight, lines.length * lineHeight);
  const bgAlpha = clamp01(spec.backgroundOpacity) * clamp01(opacity);
  if (bgAlpha > 0.01) {
    ctx.fillStyle = hexToRgba(spec.background, bgAlpha);
    const r = Math.min(pad * 0.55, 36);
    const bx = -blockWidth / 2 - pad;
    const by = -blockHeight / 2 - pad * 0.65;
    const bw = blockWidth + pad * 2;
    const bh = blockHeight + pad * 1.3;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, r);
    ctx.fill();
  }

  ctx.fillStyle = spec.color;
  if (spec.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = Math.max(2, fontSize * 0.22);
    ctx.shadowOffsetY = Math.max(1, fontSize * 0.05);
  }
  const anchor = spec.align === 'left' ? -blockWidth / 2 : spec.align === 'right' ? blockWidth / 2 : 0;
  ctx.textAlign = spec.align;
  for (let i = 0; i < lines.length; i++) {
    const lineY = -blockHeight / 2 + lineHeight * (i + 0.5);
    ctx.fillText(lines[i], anchor, lineY);
  }
  ctx.restore();
}

function drawTransition(
  ctx: CanvasRenderingContext2D,
  tr: ActiveTransition,
  track: Track,
  assets: Record<string, MediaAsset>,
  at: number,
  w: number,
  h: number,
  pool: MediaPool,
): void {
  const { from, to } = tr;
  const p = clamp01(tr.progress);
  const fromAsset = assets[from.assetId];
  const toAsset = assets[to.assetId];
  if ((!fromAsset && !from.text) || (!toAsset && !to.text)) return;
  const fromAt = Math.min(at, clipEnd(from) - 0.001);
  const toAt = at;
  const drawA = (alpha = 1, ox = 0, oy = 0) => drawClip(ctx, from, fromAsset, fromAt, w, h, pool, { alpha, offsetX: ox, offsetY: oy });
  const drawB = (alpha = 1, ox = 0, oy = 0) => drawClip(ctx, to, toAsset, toAt, w, h, pool, { alpha, offsetX: ox, offsetY: oy });
  void track;

  switch (tr.type) {
    case 'dissolve':
      drawA();
      drawB(p);
      break;
    case 'dip-black':
    case 'dip-white': {
      const color = tr.type === 'dip-black' ? '#000000' : '#ffffff';
      if (p < 0.5) {
        drawA();
        ctx.fillStyle = color;
        ctx.globalAlpha = p * 2;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      } else {
        drawB();
        ctx.fillStyle = color;
        ctx.globalAlpha = (1 - p) * 2;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'wipe-right':
    case 'wipe-left':
    case 'wipe-down':
    case 'wipe-up': {
      drawA();
      ctx.save();
      const curve = p * p * (3 - 2 * p);
      if (tr.type === 'wipe-right') ctx.rect(0, 0, w * curve, h);
      else if (tr.type === 'wipe-left') ctx.rect(w * (1 - curve), 0, w * curve, h);
      else if (tr.type === 'wipe-down') ctx.rect(0, 0, w, h * curve);
      else ctx.rect(0, h * (1 - curve), w, h * curve);
      ctx.clip();
      drawB();
      ctx.restore();
      break;
    }
    case 'slide-left':
      drawA(1, -w * p, 0);
      drawB(1, w * (1 - p), 0);
      break;
    case 'slide-right':
      drawA(1, w * p, 0);
      drawB(1, -w * (1 - p), 0);
      break;
    case 'iris': {
      drawA();
      ctx.save();
      ctx.beginPath();
      const r = Math.hypot(w, h) * 0.5 * p;
      ctx.arc(w / 2, h / 2, Math.max(0, r), 0, Math.PI * 2);
      ctx.clip();
      drawB();
      ctx.restore();
      break;
    }
  }
}

export interface RenderOptions {
  /** Draw a subtle safe-area frame + labels (preview only). */
  guides?: boolean;
  background?: string;
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  assets: Record<string, MediaAsset>,
  t: number,
  w: number,
  h: number,
  pool: MediaPool,
  opts: RenderOptions = {},
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.fillStyle = opts.background ?? '#000';
  ctx.fillRect(0, 0, w, h);

  const tracks = [...project.tracks].reverse();
  for (const track of tracks) {
    if (track.kind !== 'video' || track.hidden) continue;
    const clip = clipAt(track, t);
    if (!clip) continue;
    const asset = assets[clip.assetId];
    if (!asset && !clip.text) continue;
    const tr = transitionAt(track, clip, t);
    if (tr) drawTransition(ctx, tr, track, assets, t, w, h, pool);
    else drawClip(ctx, clip, asset, t, w, h, pool);
  }

  if (opts.guides) {
    const pad = Math.round(Math.min(w, h) * 0.04);
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.moveTo(pad, pad);
    ctx.lineTo(w - pad, pad);
    ctx.lineTo(w - pad, h - pad);
    ctx.lineTo(pad, h - pad);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}