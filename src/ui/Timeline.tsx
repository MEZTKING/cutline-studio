import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { clipEnd, formatDuration, formatTimecode, previousClip, projectDuration } from '../core/model';
import { freeStart, preferredTrack } from '../core/placement';
import type { Clip, Track } from '../core/types';
import { useEditor } from '../state/store';
import { drawFrame, MediaPool, prepareFrame } from '../render/renderer';
import { Icon } from './icons';

const RULER_H = 26;
const VIDEO_H = 64;
const AUDIO_H = 46;
const MIN_DUR = 0.1;

const rowHeight = (track: Track) => (track.kind === 'video' ? VIDEO_H : AUDIO_H);
const quantize = (t: number, fps: number) => Math.max(0, Math.round(t * fps) / fps);

function tickStep(zoom: number): number {
  const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((s) => s * zoom >= 74) ?? 600;
}

function shortLabel(t: number, step: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  if (step < 1) return `${m}:${s.toFixed(1).padStart(4, '0')}`;
  return `${m}:${Math.round(s).toString().padStart(2, '0')}`;
}

function Ruler({ width, zoom }: { width: number; zoom: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.floor(RULER_H * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, RULER_H);
    const grad = ctx.createLinearGradient(0, 0, 0, RULER_H);
    grad.addColorStop(0, '#11151c');
    grad.addColorStop(1, '#0d1015');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, RULER_H);

    const step = tickStep(zoom);
    const minor = step / 5;
    const maxT = width / zoom;

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    if (minor * zoom >= 6) {
      for (let t = 0; t <= maxT; t += minor) {
        const x = Math.round(t * zoom) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, RULER_H - 4);
        ctx.lineTo(x, RULER_H);
        ctx.stroke();
      }
    }

    ctx.font = '9px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.fillStyle = '#727b8a';
    ctx.textBaseline = 'top';
    for (let t = 0; t <= maxT; t += step) {
      const x = Math.round(t * zoom) + 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.moveTo(x, RULER_H - 9);
      ctx.lineTo(x, RULER_H);
      ctx.stroke();
      ctx.fillText(shortLabel(t, step), x + 4, 6);
    }
  }, [width, zoom]);

  return <canvas ref={ref} style={{ width, height: RULER_H, pointerEvents: 'none' }} />;
}

function PlayheadMarker({ zoom }: { zoom: number }) {
  const playhead = useEditor((s) => s.playhead);
  return (
    <div className="playhead" style={{ left: playhead * zoom }}>
      <div className="playhead-grip" />
      <div className="playhead-line" />
    </div>
  );
}

function toolbarZoomIn() {
  useEditor.getState().setZoom(useEditor.getState().zoom * 1.3);
}
function toolbarZoomOut() {
  useEditor.getState().setZoom(useEditor.getState().zoom / 1.3);
}

export function Timeline() {
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const zoom = useEditor((s) => s.zoom);
  const snap = useEditor((s) => s.snap);
  const fineScrub = useEditor((s) => s.fineScrub);
  const selectedClips = useEditor((s) => s.selectedClips);
  const selection = useEditor((s) => s.selection);

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const headersRef = useRef<HTMLDivElement>(null);
  const [guide, setGuide] = useState<number | null>(null);
  const [dropTrack, setDropTrack] = useState<string | null>(null);

  const totalDuration = projectDuration(project);
  const contentWidth = Math.max(640, Math.ceil((Math.max(totalDuration, 12) + 6) * zoom));
  const rowsHeight = project.tracks.reduce((sum, t) => sum + rowHeight(t), 0);
  const hasClips = project.tracks.some((t) => t.clips.length > 0);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const t = Math.max(0, (clientX - rect.left) / zoom);
      useEditor.getState().setPlayhead(t);
    },
    [zoom],
  );

  const onRulerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const state = useEditor.getState();
    state.setPlaying(false);
    const startX = e.clientX;
    const rect = canvasRef.current?.getBoundingClientRect();
    const startT = rect ? Math.max(0, (e.clientX - rect.left) / zoom) : 0;
    state.setPlayhead(startT);
    const move = (ev: PointerEvent) => {
      const current = useEditor.getState();
      const raw = startT + (ev.clientX - startX) / zoom * (current.fineScrub ? 0.2 : 1);
      current.setPlayhead(current.fineScrub ? quantize(raw, current.project.fps) : raw);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
  };

  const onRowDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.clip')) return;
    const state = useEditor.getState();
    state.setPlaying(false);
    state.select(null, null);
    seekFromClientX(e.clientX);
  };

  const findTrackAtY = (clientY: number): string | null => {
    const rows = document.querySelectorAll<HTMLElement>('[data-track-row]');
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) return row.dataset.trackId ?? null;
    }
    return null;
  };

  const startClipDrag = (e: ReactPointerEvent<HTMLDivElement>, clip: Clip, track: Track) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (track.locked) {
      useEditor.getState().notify('This track is locked.', 'error');
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const handle = (e.target as HTMLElement).closest('[data-handle]') as HTMLElement | null;
    const state = useEditor.getState();
    if ((e.ctrlKey || e.metaKey) && !handle) {
      state.setPlaying(false);
      state.select(clip.id, track.id, true);
      return;
    }
    state.setPlaying(false);
    const ordered = [...track.clips].sort((a, b) => a.start - b.start);
    const idx = ordered.findIndex((c) => c.id === clip.id);
    const prev = idx > 0 ? ordered[idx - 1] : null;
    const next = idx >= 0 ? ordered[idx + 1] : null;
    const canSlide = Boolean(
      prev && next &&
      Math.abs(clipEnd(prev) - clip.start) < 0.05 &&
      Math.abs(clipEnd(clip) - next.start) < 0.05 &&
      !clip.text && !prev.text && !next.text &&
      !clip.transition && !prev.transition && !next.transition,
    );
    const mode: 'move' | 'trim-start' | 'trim-end' | 'slip' | 'slide' =
      handle?.dataset.handle === 'start'
        ? 'trim-start'
        : handle?.dataset.handle === 'end'
          ? 'trim-end'
          : e.altKey && !clip.text
            ? 'slip'
            : e.shiftKey && canSlide
              ? 'slide'
              : 'move';
    if (!(state.selectedClips.length > 1 && state.selectedClips.includes(clip.id)) || mode !== 'move') {
      state.select(clip.id, track.id);
    }
    state.beginGesture();

    const origin = {
      x: e.clientX,
      y: e.clientY,
      clip: { ...clip },
      trackId: track.id,
      mode,
      moved: false,
      groupIds: useEditor.getState().selectedClips,
      prev,
      next,
    };
    const original = origin.clip;

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - origin.x;
      if (!origin.moved && Math.abs(dx) < 3 && Math.abs(ev.clientY - origin.y) < 3) return;
      origin.moved = true;

      const store = useEditor.getState();
      const proj = store.project;
      const current = proj.tracks.flatMap((t) => t.clips).find((c) => c.id === clip.id);
      if (!current) return;

      const asset = store.assets[current.assetId];
      if (!asset) return;

      const dt = dx / zoom;
      const threshold = 9 / zoom;
      const points: number[] = [0, store.playhead];
      for (const t of proj.tracks) for (const c of t.clips) if (c.id !== clip.id) points.push(c.start, clipEnd(c));

      const snapPoint = (value: number): { at: number; target: number } | null => {
        if (!store.snap) return null;
        let best: { at: number; target: number } | null = null;
        for (const p of points) {
          const d = p - value;
          if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.target - value))) best = { at: p, target: p };
        }
        return best;
      };

      if (origin.mode === 'slide') {
        if (!origin.prev || !origin.next) return;
        const pFound = proj.tracks.flatMap((t) => t.clips).find((c) => c.id === origin.prev!.id);
        const nFound = proj.tracks.flatMap((t) => t.clips).find((c) => c.id === origin.next!.id);
        if (!pFound || !nFound) return;
        const pAsset = store.assets[pFound.assetId];
        const nAsset = store.assets[nFound.assetId];
        const maxPrev = pAsset && pAsset.kind !== 'image' ? Math.max(0.1, (pAsset.duration - pFound.inPoint) / Math.max(0.1, pFound.speed)) : Number.POSITIVE_INFINITY;
        const minDelta = Math.max(MIN_DUR - origin.prev!.duration, -(origin.next!.inPoint / Math.max(0.1, origin.next!.speed)), -original.start);
        const maxDelta = Math.min(maxPrev - origin.prev!.duration, origin.next!.duration - MIN_DUR, 60);
        let delta = Math.min(maxDelta, Math.max(minDelta, dt));
        if (Math.abs(delta) < 0.001) return;
        store.livePatchClip(pFound.id, { duration: origin.prev!.duration + delta });
        store.livePatchClip(clip.id, { start: original.start + delta });
        store.livePatchClip(nFound.id, {
          start: origin.next!.start + delta,
          duration: origin.next!.duration - delta,
          inPoint: nAsset?.kind === 'image' ? origin.next!.inPoint : origin.next!.inPoint + delta * origin.next!.speed,
        });
        return;
      }

      if (origin.mode === 'slip') {
        if (asset.kind === 'image') return;
        const maxIn = Math.max(0, asset.duration - original.duration * original.speed);
        const nextIn = Math.min(maxIn, Math.max(0, original.inPoint + dt * original.speed));
        setGuide(null);
        store.livePatchClip(clip.id, { inPoint: nextIn });
        return;
      }

      if (origin.mode === 'move') {
        let nextStart = Math.max(0, original.start + dt);
        let guideAt: number | null = null;
        if (store.snap) {
          let bestDelta: number | null = null;
          let bestTarget: number | null = null;
          for (const edge of [nextStart, nextStart + original.duration]) {
            for (const p of points) {
              const d = p - edge;
              if (Math.abs(d) <= threshold && (bestDelta === null || Math.abs(d) < Math.abs(bestDelta))) {
                bestDelta = d;
                bestTarget = p;
              }
            }
          }
          if (bestDelta !== null) {
            nextStart = Math.max(0, nextStart + bestDelta);
            guideAt = bestTarget;
          }
        }
        setGuide(guideAt);

        const overTrackId = findTrackAtY(ev.clientY) ?? origin.trackId;
        const overTrack = proj.tracks.find((t) => t.id === overTrackId);
        const canMove = overTrack && !overTrack.locked && overTrack.kind === track.kind;
        const targetTrackId = canMove ? overTrackId : origin.trackId;
        if (origin.groupIds.length > 1 && origin.groupIds.includes(clip.id)) {
          store.liveMoveSelection(clip.id, targetTrackId, nextStart, origin.groupIds);
        } else {
          store.liveMoveClip(clip.id, targetTrackId, nextStart);
        }
        origin.trackId = targetTrackId;
        return;
      }

      if (origin.mode === 'trim-start') {
        const minStart = asset.kind === 'image' ? 0 : Math.max(0, original.start - original.inPoint / Math.max(0.1, original.speed));
        const maxStart = original.start + original.duration - MIN_DUR;
        let nextStart = Math.min(maxStart, Math.max(minStart, original.start + dt));
        const snapped = snapPoint(nextStart);
        if (snapped) {
          nextStart = Math.min(maxStart, Math.max(minStart, snapped.at));
          setGuide(snapped.target);
        } else setGuide(null);
        const delta = nextStart - original.start;
        const duration = original.duration - delta;
        const inPoint = asset.kind === 'image' ? 0 : original.inPoint + delta * original.speed;
        store.livePatchClip(clip.id, { start: nextStart, duration, inPoint });
        return;
      }

      const maxEnd =
        asset.kind === 'image'
          ? original.start + 3600
          : original.start + Math.max(0.1, (asset.duration - original.inPoint) / Math.max(0.1, original.speed));
      let nextEnd = Math.min(maxEnd, Math.max(original.start + MIN_DUR, original.start + original.duration + dt));
      const snapped = snapPoint(nextEnd);
      if (snapped) {
        nextEnd = Math.min(maxEnd, Math.max(original.start + MIN_DUR, snapped.at));
        setGuide(snapped.target);
      } else setGuide(null);
      store.livePatchClip(clip.id, { duration: nextEnd - original.start });
    };

    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      useEditor.getState().endGesture();
      setGuide(null);
    };

    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  };

  const startRollEdit = (
    e: ReactPointerEvent<HTMLDivElement>,
    prev: Clip,
    clip: Clip,
    track: Track,
  ) => {
    if (track.locked) return;
    e.preventDefault();
    e.stopPropagation();
    const state = useEditor.getState();
    const prevAsset = state.assets[prev.assetId];
    const clipAsset = state.assets[clip.assetId];
    state.setPlaying(false);
    state.select(clip.id, track.id);
    state.beginGesture();
    const startX = e.clientX;
    const prevDur = prev.duration;
    const clipStart = clip.start;
    const clipDur = clip.duration;
    const clipIn = clip.inPoint;
    const maxPrev =
      prevAsset && prevAsset.kind !== 'image' ? Math.max(0.1, (prevAsset.duration - prev.inPoint) / Math.max(0.1, prev.speed)) : Number.POSITIVE_INFINITY;
    const maxClip =
      clipAsset && clipAsset.kind !== 'image' ? Math.max(0.1, (clipAsset.duration - clip.inPoint) / Math.max(0.1, clip.speed)) : Number.POSITIVE_INFINITY;
    const minDelta = Math.max(MIN_DUR - prevDur, -(clipDur - MIN_DUR), -clipStart, -(clipIn / Math.max(0.1, clip.speed)));
    const maxDelta = Math.min(maxPrev - prevDur, maxClip - clipDur, clipDur - MIN_DUR);
    const move = (ev: PointerEvent) => {
      let delta = (ev.clientX - startX) / zoom;
      delta = Math.min(maxDelta, Math.max(minDelta, delta));
      if (Math.abs(delta) < 0.001) return;
      const store = useEditor.getState();
      store.livePatchClip(prev.id, { duration: prevDur + delta });
      store.livePatchClip(clip.id, {
        start: clipStart + delta,
        duration: clipDur - delta,
        inPoint: clipAsset?.kind === 'image' ? clipIn : clipIn + delta * clip.speed,
      });
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      useEditor.getState().endGesture();
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  };

  const onWheel = useCallback((e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const timeAtPointer = (el.scrollLeft + localX) / zoom;
    const state = useEditor.getState();
    const next = Math.min(400, Math.max(8, zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
    state.setZoom(next);
    requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, timeAtPointer * next - localX);
    });
  }, [zoom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  useEffect(() => {
    const unsub = useEditor.subscribe((state) => {
      if (!state.playing) return;
      const el = scrollRef.current;
      if (!el) return;
      const x = state.playhead * state.zoom;
      const left = el.scrollLeft;
      const view = el.clientWidth;
      if (x < left || x > left + view - 48) {
        el.scrollLeft = Math.max(0, x - view * 0.3);
      }
    });
    return unsub;
  }, []);

  const fitToTimeline = () => {
    const el = scrollRef.current;
    const duration = Math.max(5, totalDuration + 1);
    const available = Math.max(200, (el?.clientWidth ?? 640) - 32);
    useEditor.getState().setZoom(Math.min(400, Math.max(8, available / duration)));
    if (el) el.scrollLeft = 0;
  };

  const applyQuickTransition = () => {
    const state = useEditor.getState();
    if (!state.selection.clipId) return;
    const found = state.project.tracks.find((t) => t.clips.some((c) => c.id === state.selection.clipId));
    if (!found) return;
    const clip = found.clips.find((c) => c.id === state.selection.clipId)!;
    if (clip.transition) {
      state.setTransition(clip.id, null);
      return;
    }
    if (!previousClip(found, clip)) {
      state.notify('A transition needs a clip directly before this one.', 'error');
      return;
    }
    state.setTransition(clip.id, 'dissolve', 0.6);
    state.notify('Cross dissolve added — tune it in the Inspector.', 'success');
  };

  return (
    <div className="timeline-dock">
      <div className="tl-toolbar">
        <button className="btn ghost sm" title="Split at playhead (S)" onClick={() => useEditor.getState().split()}>
          <Icon name="scissors" size={14} /> <span className="tl-label">Split</span>
        </button>
        <button
          className="btn ghost sm"
          title="Delete selected clip (Del)"
          disabled={!selection.clipId}
          onClick={() => {
            const s = useEditor.getState();
            s.deleteSelected(false);
          }}
        >
          <Icon name="trash" size={14} /> <span className="tl-label">Delete</span>
        </button>
        <button
          className="btn ghost sm"
          title="Ripple delete (Shift+Delete) — closes the gap"
          disabled={!selection.clipId}
          onClick={() => {
            const s = useEditor.getState();
            s.deleteSelected(true);
          }}
        >
          <Icon name="split" size={14} /> <span className="tl-label">Ripple</span>
        </button>
        <button
          className="btn ghost sm"
          title="Quick cross dissolve"
          disabled={!selection.clipId}
          onClick={applyQuickTransition}
        >
          <Icon name="sparkle" size={14} />
        </button>
        <button
          className="btn ghost sm"
          title="Add a title at the playhead"
          onClick={() => useEditor.getState().addText()}
        >
          <Icon name="text" size={14} /> <span className="tl-label">Title</span>
        </button>
        <button
          className="btn ghost sm"
          title="Captions — auto, SRT import/export"
          onClick={() => useEditor.getState().setCaptionsOpen(true)}
        >
          <Icon name="captions" size={15} /> <span className="tl-label">CC</span>
        </button>
        <button
          className="btn ghost sm"
          title="Auto-reframe for social"
          onClick={() => useEditor.getState().setReframeOpen(true)}
        >
          <Icon name="reframe" size={15} /> <span className="tl-label">Frame</span>
        </button>
        <span className="divider" />
        <button
          className={`btn ghost sm ${snap ? 'active' : ''}`}
          title="Toggle snapping"
          onClick={() => useEditor.getState().setSnap(!snap)}
          style={{ color: snap ? 'var(--accent)' : undefined }}
        >
          <Icon name="magnet" size={15} />
        </button>
        <button
          className={`btn ghost sm ${fineScrub ? 'active' : ''}`}
          title="Fine scrub (F) — 1/5 speed and frame-snapped"
          style={fineScrub ? { color: 'var(--warn)', borderColor: 'rgba(255,196,107,.45)' } : undefined}
          onClick={() => useEditor.getState().setFineScrub(!fineScrub)}
        >
          <Icon name="gauge" size={14} /> <span className="tl-label">Fine</span>
        </button>
        <span className="divider" />
        <button className="btn ghost icon sm" title="Zoom out" onClick={toolbarZoomOut}>
          <Icon name="zoomOut" size={15} />
        </button>
        <span className="zoom-label">{Math.round(zoom)} px/s</span>
        <button className="btn ghost icon sm" title="Zoom in" onClick={toolbarZoomIn}>
          <Icon name="zoomIn" size={15} />
        </button>
        <button className="btn ghost sm" title="Fit timeline" onClick={fitToTimeline}>
          Fit
        </button>
        <span className="spacer" />
        <button className="btn ghost sm" title="Add a video track" onClick={() => useEditor.getState().addTrack('video')}>
          <Icon name="plus" size={13} /> V
        </button>
        <button className="btn ghost sm" title="Add an audio track" onClick={() => useEditor.getState().addTrack('audio')}>
          <Icon name="plus" size={13} /> A
        </button>
      </div>

      <div className="tl-body">
        <div className="tl-headers">
          <div className="tl-headers-inner" ref={headersRef}>
            <div className="ruler-spacer" />
            {project.tracks.map((track) => (
              <div key={track.id} className="track-head" style={{ height: rowHeight(track) }}>
                <div className="th-top">
                  <span className={`track-name ${track.kind}`}>{track.name}</span>
                  <div className="th-btns">
                    {track.kind === 'video' ? (
                      <button
                        className={`th-btn ${track.hidden ? 'on' : ''}`}
                        title={track.hidden ? 'Show track' : 'Hide track'}
                        onClick={() => useEditor.getState().updateTrack(track.id, { hidden: !track.hidden })}
                      >
                        <Icon name={track.hidden ? 'eyeOff' : 'eye'} size={12} />
                      </button>
                    ) : (
                      <>
                        <button
                          className={`th-btn ${track.solo ? 'on' : ''}`}
                          title={track.solo ? 'Unsolo track' : 'Solo track'}
                          style={track.solo ? { color: 'var(--accent)' } : undefined}
                          onClick={() => useEditor.getState().updateTrack(track.id, { solo: !track.solo })}
                        >
                          <span style={{ fontSize: 9, fontWeight: 800 }}>S</span>
                        </button>
                        <button
                          className={`th-btn ${track.muted ? 'on' : ''}`}
                          title={track.muted ? 'Unmute track' : 'Mute track'}
                          onClick={() => useEditor.getState().updateTrack(track.id, { muted: !track.muted })}
                        >
                          <Icon name={track.muted ? 'mute' : 'volume'} size={12} />
                        </button>
                      </>
                    )}
                    <button
                      className={`th-btn ${track.locked ? 'on' : ''}`}
                      title={track.locked ? 'Unlock track' : 'Lock track'}
                      onClick={() => useEditor.getState().updateTrack(track.id, { locked: !track.locked })}
                    >
                      <Icon name={track.locked ? 'lock' : 'unlock'} size={12} />
                    </button>
                  </div>
                </div>
                <div className="th-badge">
                  <span className="dot" style={{ background: track.kind === 'audio' ? 'var(--audio)' : undefined }} />
                  {track.clips.length} clip{track.clips.length === 1 ? '' : 's'}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          className="tl-scroll"
          ref={scrollRef}
          onScroll={(e) => {
            if (headersRef.current) headersRef.current.style.transform = `translateY(${-e.currentTarget.scrollTop}px)`;
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('text/x-cutline-asset')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            const id = findTrackAtY(e.clientY);
            const hover = id ? project.tracks.find((t) => t.id === id) : null;
            setDropTrack(hover && !hover.locked ? hover.id : null);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDropTrack(null);
          }}
          onDrop={(e) => {
            const assetId = e.dataTransfer.getData('text/x-cutline-asset');
            if (!assetId) return;
            e.preventDefault();
            setDropTrack(null);
            const s = useEditor.getState();
            const asset = s.assets[assetId];
            if (!asset) return;
            const wanted = asset.kind === 'audio' ? 'audio' : 'video';
            const hoveredId = findTrackAtY(e.clientY);
            const hovered = hoveredId ? s.project.tracks.find((t) => t.id === hoveredId) : null;
            const track = hovered && hovered.kind === wanted && !hovered.locked ? hovered : preferredTrack(s.project, asset.kind);
            if (!track) {
              s.notify(`No unlocked ${wanted} track available.`, 'error');
              return;
            }
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;
            const t = Math.max(0, (e.clientX - rect.left) / zoom);
            const duration = asset.kind === 'image' ? 5 : asset.duration;
            const start = freeStart(track, t, duration);
            s.addClipToTrack(track.id, asset, start, duration);
            s.notify(`Added “${asset.name}” to ${track.name}`, 'success');
          }}
        >
          <div className="tl-canvas" ref={canvasRef} style={{ width: contentWidth }}>
            <div
              className="tl-ruler"
              style={{ width: contentWidth }}
              onPointerDown={onRulerDown}
              role="slider"
              aria-label="Timeline ruler"
              aria-valuemin={0}
              aria-valuemax={Math.round(totalDuration)}
            >
              <Ruler width={contentWidth} zoom={zoom} />
            </div>

            <div className="tl-rows" style={{ height: rowsHeight }} onPointerDown={onRowDown}>
              {project.tracks.map((track) => (
                <div
                  key={track.id}
                  className={`track-row ${track.kind} ${track.locked ? 'locked' : ''} ${dropTrack === track.id ? 'drop-target' : ''}`}
                  data-track-row
                  data-track-id={track.id}
                  style={{ height: rowHeight(track) }}
                >
                  <div className="row-grid" style={{ '--grid': `${zoom}px` } as CSSProperties} />
                  {track.clips.map((clip) => {
                    const asset = assets[clip.assetId];
                    const isText = Boolean(clip.text);
                    const isCaption = Boolean(clip.text?.caption);
                    const width = Math.max(3, clip.duration * zoom);
                    const selected = selectedClips.includes(clip.id);
                    const hasKf = Object.keys(clip.keyframes).length > 0;
                    const animated = Object.values(clip.keyframes).some((list) => (list?.length ?? 0) > 0);
                    return (
                      <div
                        key={clip.id}
                        className={`clip ${track.kind} ${isText ? 'text' : ''} ${isCaption ? 'caption' : ''} ${selected ? 'selected' : ''}`}
                        style={{ left: clip.start * zoom, width }}
                        onPointerDown={(e) => startClipDrag(e, clip, track)}
                        title={`${clip.name} · ${formatDuration(clip.duration)} · Alt-drag slip · Shift-drag slide · Ctrl-click multi-select`}
                      >
                        {asset?.thumbnail && (
                          <div
                            className="clip-thumb"
                            style={{ backgroundImage: `url(${asset.thumbnail})` }}
                          />
                        )}
                        <div className="shade" />
                        {clip.transition && previousClip(track, clip) && (
                          <div className="clip-transition">
                            <Icon name="sparkle" size={9} />
                          </div>
                        )}
                        {width > 46 && (
                          <div className="clip-label">
                            {isText ? clip.text!.content.split('\n')[0] || 'Title' : clip.name}
                            {!isText && clip.speed !== 1 ? ` · ${clip.speed}×` : ''}
                          </div>
                        )}
                        {width > 76 && (
                          <div className="clip-sub">
                            <Icon name={isCaption ? 'captions' : isText ? 'text' : track.kind === 'audio' ? 'music' : 'film'} size={8} />
                            {formatDuration(clip.duration)}
                          </div>
                        )}
                        {(hasKf || animated) && width > 30 && (
                          <div className="clip-fx">
                            <Icon name="diamond" size={8} />
                          </div>
                        )}
                        {clip.linkId && (
                          <div className="clip-link" title="Linked A/V — moves with its partner">
                            <Icon name="link" size={9} />
                          </div>
                        )}
                        {clip.muted && !clip.audioDetached && (
                          <div className="clip-muted" title="Clip audio muted">
                            <Icon name="mute" size={9} />
                          </div>
                        )}
                        <div className="clip-handle start" data-handle="start" />
                        <div className="clip-handle end" data-handle="end" />
                      </div>
                    );
                  })}
                  {track.clips.map((clip) => {
                    const prev = previousClip(track, clip);
                    if (!prev || clip.text || prev.text || clip.transition || prev.transition) return null;
                    if (Math.abs(clipEnd(prev) - clip.start) > 0.05) return null;
                    return (
                      <div
                        key={`roll-${clip.id}`}
                        className="roll-handle"
                        style={{ left: clip.start * zoom }}
                        title="Roll edit — drag this cut"
                        onPointerDown={(e) => startRollEdit(e, prev, clip, track)}
                      />
                    );
                  })}
                </div>
              ))}

              {!hasClips && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                    color: 'var(--text-3)',
                    fontSize: 11.5,
                  }}
                >
                  Timeline is empty — tap a media card or drag it here
                </div>
              )}
              {guide !== null && <div className="snap-line" style={{ left: guide * zoom }} />}
            </div>

            <PlayheadMarker zoom={zoom} />
          </div>
        </div>
      </div>
      <ScrubPreview zoom={zoom} scrollRef={scrollRef} canvasRef={canvasRef} />
    </div>
  );
}

function ScrubPreview({
  zoom,
  scrollRef,
  canvasRef,
}: {
  zoom: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLDivElement | null>;
}) {
  const project = useEditor((s) => s.project);
  const fps = project.fps;
  const [pos, setPos] = useState<{ x: number; y: number; time: number } | null>(null);
  const [thumbTime, setThumbTime] = useState<number | null>(null);
  const canvasEl = useRef<HTMLCanvasElement>(null);
  const poolRef = useRef<MediaPool | null>(null);
  const seq = useRef(0);

  const ratio = project.width / Math.max(1, project.height);
  const maxW = 176;
  const maxH = 112;
  const tw = ratio >= 1 ? maxW : Math.max(30, Math.round(maxH * ratio));
  const th = ratio >= 1 ? Math.max(30, Math.round(maxW / ratio)) : maxH;

  useEffect(() => {
    const pool = new MediaPool();
    poolRef.current = pool;
    return () => {
      pool.dispose();
      poolRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let touchScrub = false;
    let last = 0;
    let hideTimer = 0;
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.tl-ruler')) touchScrub = true;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' && !touchScrub) return;
      const now = performance.now();
      if (now - last < 55) return;
      last = now;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const state = useEditor.getState();
      const time = state.fineScrub ? state.playhead : Math.max(0, (e.clientX - rect.left) / zoom);
      setPos({ x: e.clientX, y: e.clientY, time });
    };
    const onLeave = () => {
      if (!touchScrub) setPos(null);
    };
    const onUp = () => {
      if (!touchScrub) return;
      touchScrub = false;
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setPos(null), 450);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerleave', onLeave);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pointerup', onUp);
      window.clearTimeout(hideTimer);
    };
  }, [zoom, scrollRef, canvasRef]);

  useEffect(() => {
    if (!pos) {
      setThumbTime(null);
      return;
    }
    const t = window.setTimeout(() => setThumbTime(pos.time), 80);
    return () => window.clearTimeout(t);
  }, [pos?.time]);

  useEffect(() => {
    if (thumbTime == null) return;
    const pool = poolRef.current;
    const canvas = canvasEl.current;
    if (!pool || !canvas) return;
    const mine = ++seq.current;
    let cancelled = false;
    const draw = async () => {
      try {
        const state = useEditor.getState();
        await prepareFrame(state.project, state.assets, thumbTime, pool, 'seek');
        if (cancelled || mine !== seq.current) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        drawFrame(ctx, state.project, state.assets, thumbTime, tw, th, pool, {
          luts: state.project.luts,
          bypassColor: state.colorBypass,
        });
      } catch {
        /* frame not ready */
      }
    };
    void draw();
    return () => {
      cancelled = true;
    };
  }, [thumbTime, tw, th]);

  if (!pos) return null;
  const left = Math.min(Math.max(6, pos.x - tw / 2 - 6), window.innerWidth - tw - 14);
  const top = pos.y - th - 48 < 60 ? pos.y + 26 : pos.y - th - 48;
  return (
    <div className="scrub-preview" style={{ left, top }}>
      <canvas ref={canvasEl} width={tw} height={th} />
      <div className="scrub-tc">
        {formatTimecode(pos.time, fps)}
        <span>· {Math.round(pos.time * fps)} frames</span>
      </div>
    </div>
  );
}
