import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { clipEnd, formatDuration, previousClip, projectDuration } from '../core/model';
import { freeStart, preferredTrack } from '../core/placement';
import type { Clip, Track } from '../core/types';
import { useEditor } from '../state/store';
import { Icon } from './icons';

const RULER_H = 26;
const VIDEO_H = 64;
const AUDIO_H = 46;
const MIN_DUR = 0.1;

const rowHeight = (track: Track) => (track.kind === 'video' ? VIDEO_H : AUDIO_H);

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
    seekFromClientX(e.clientX);
    const move = (ev: PointerEvent) => seekFromClientX(ev.clientX);
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
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('row-grid')) return;
    useEditor.getState().setPlaying(false);
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
    const mode: 'move' | 'trim-start' | 'trim-end' =
      handle?.dataset.handle === 'start' ? 'trim-start' : handle?.dataset.handle === 'end' ? 'trim-end' : 'move';

    const state = useEditor.getState();
    state.setPlaying(false);
    state.select(clip.id, track.id);
    state.beginGesture();

    const origin = {
      x: e.clientX,
      y: e.clientY,
      clip: { ...clip },
      trackId: track.id,
      mode,
      moved: false,
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
        if (targetTrackId !== origin.trackId) {
          store.liveMoveClip(clip.id, targetTrackId, nextStart);
          origin.trackId = targetTrackId;
        } else {
          store.livePatchClip(clip.id, { start: nextStart });
        }
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
            if (s.selection.clipId) s.deleteClip(s.selection.clipId, false);
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
            if (s.selection.clipId) s.deleteClip(s.selection.clipId, true);
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
        <span className="divider" />
        <button
          className={`btn ghost sm ${snap ? 'active' : ''}`}
          title="Toggle snapping"
          onClick={() => useEditor.getState().setSnap(!snap)}
          style={{ color: snap ? 'var(--accent)' : undefined }}
        >
          <Icon name="magnet" size={15} />
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
                      <button
                        className={`th-btn ${track.muted ? 'on' : ''}`}
                        title={track.muted ? 'Unmute track' : 'Mute track'}
                        onClick={() => useEditor.getState().updateTrack(track.id, { muted: !track.muted })}
                      >
                        <Icon name={track.muted ? 'mute' : 'volume'} size={12} />
                      </button>
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
                    const width = Math.max(3, clip.duration * zoom);
                    const selected = selection.clipId === clip.id;
                    const hasKf = Object.keys(clip.keyframes).length > 0;
                    const animated = Object.values(clip.keyframes).some((list) => (list?.length ?? 0) > 0);
                    return (
                      <div
                        key={clip.id}
                        className={`clip ${track.kind} ${isText ? 'text' : ''} ${selected ? 'selected' : ''}`}
                        style={{ left: clip.start * zoom, width }}
                        onPointerDown={(e) => startClipDrag(e, clip, track)}
                        title={`${clip.name} · ${formatDuration(clip.duration)}`}
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
                            <Icon name={isText ? 'text' : track.kind === 'audio' ? 'music' : 'film'} size={8} />
                            {formatDuration(clip.duration)}
                          </div>
                        )}
                        {(hasKf || animated) && width > 30 && (
                          <div className="clip-fx">
                            <Icon name="diamond" size={8} />
                          </div>
                        )}
                        <div className="clip-handle start" data-handle="start" />
                        <div className="clip-handle end" data-handle="end" />
                      </div>
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
    </div>
  );
}