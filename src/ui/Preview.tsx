import { useEffect, useRef, useState } from 'react';
import { projectDuration } from '../core/model';
import { getAudioEngine } from '../audio/engine';
import { drawFrame, MediaPool, prepareFrame, type FrameMode } from '../render/renderer';
import { useEditor } from '../state/store';
import { formatTimecode } from '../core/model';
import { Icon } from './icons';

function previewSize(project: { width: number; height: number }): { width: number; height: number } {
  const max = 1280;
  const factor = Math.min(1, max / Math.max(project.width, project.height));
  const width = Math.max(32, Math.round((project.width * factor) / 2) * 2);
  const height = Math.max(32, Math.round((project.height * factor) / 2) * 2);
  return { width, height };
}

export function Preview({ onImport }: { onImport: () => void }) {
  const project = useEditor((s) => s.project);
  const playing = useEditor((s) => s.playing);
  const hasVideo = project.tracks.some((t) => t.kind === 'video' && t.clips.length > 0);
  const [size, setSize] = useState(() => previewSize(project));

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poolRef = useRef<MediaPool | null>(null);
  const sizeRef = useRef(size);
  const renderRef = useRef<(mode?: FrameMode) => void>(() => {});

  sizeRef.current = size;

  useEffect(() => {
    setSize(previewSize(project));
  }, [project.width, project.height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !ctx) return;

    const pool = new MediaPool();
    poolRef.current = pool;
    let queued = 0;
    let seq = 0;

    const render = (mode: FrameMode) => {
      const state = useEditor.getState();
      const { width, height } = sizeRef.current;
      const mine = ++seq;
      if (mode === 'play') {
        drawFrame(ctx, state.project, state.assets, state.playhead, width, height, pool, {
          luts: state.project.luts,
          bypassColor: state.colorBypass,
        });
        void prepareFrame(state.project, state.assets, state.playhead, pool, 'play');
      } else {
        void prepareFrame(state.project, state.assets, state.playhead, pool, 'seek').then(() => {
          if (mine !== seq) return;
          const cur = useEditor.getState();
          drawFrame(ctx, cur.project, cur.assets, cur.playhead, width, height, pool, {
            luts: cur.project.luts,
            bypassColor: cur.colorBypass,
          });
        });
      }
    };

    renderRef.current = (mode = 'seek') => render(mode);

    const schedule = () => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        render(useEditor.getState().playing ? 'play' : 'seek');
      });
    };
    pool.onReady = schedule;

    const unsub = useEditor.subscribe((state, prev) => {
      if (state.project !== prev.project && state.playing) state.setPlaying(false);
      if (
        state.project !== prev.project ||
        state.assets !== prev.assets ||
        state.playhead !== prev.playhead ||
        state.playing !== prev.playing ||
        state.colorBypass !== prev.colorBypass
      ) {
        schedule();
      }
    });

    schedule();
    return () => {
      unsub();
      if (queued) cancelAnimationFrame(queued);
      pool.dispose();
      poolRef.current = null;
    };
  }, []);

  useEffect(() => {
    renderRef.current('seek');
  }, [size]);

  useEffect(() => {
    if (!playing) {
      getAudioEngine().stop();
      renderRef.current('seek');
      return;
    }
    const engine = getAudioEngine();
    let raf = 0;
    let cancelled = false;
    const start = useEditor.getState();

    engine
      .start(start.project, start.assets, start.playhead)
      .then(() => {
        if (cancelled) return;
        const tick = () => {
          const state = useEditor.getState();
          const total = projectDuration(state.project);
          const t = engine.time();
          if (t >= total - 0.01) {
            state.setPlayhead(total);
            state.setPlaying(false);
            return;
          }
          state.setPlayhead(t);
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const state = useEditor.getState();
        state.setPlaying(false);
        state.notify(err instanceof Error ? err.message : 'Playback could not start.', 'error');
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      engine.stop();
    };
  }, [playing]);

  return (
    <div className="preview-shell">
      <div className="preview-frame">
        <canvas ref={canvasRef} width={size.width} height={size.height} aria-label="Program monitor" />
        {!hasVideo && (
          <div className="preview-empty">
            <Icon name="film" size={30} style={{ opacity: 0.35 }} />
            <h2>Start your cut</h2>
            <p>Import footage, then tap a clip in the media bin to drop it at the playhead.</p>
            <button className="btn primary sm" onClick={onImport} style={{ marginTop: 4 }}>
              <Icon name="upload" size={13} /> Import media
            </button>
          </div>
        )}
        <div className="preview-badge">
          <button
            className="pill accent"
            title="Project settings — canvas resolution and frame rate"
            onClick={() => {
              const state = useEditor.getState();
              state.setPlaying(false);
              state.select(null, null);
              state.setWorkspace('edit');
              state.setMobilePanel('inspector');
            }}
          >
            {project.width}×{project.height}
          </button>
          <button
            className="pill"
            title="Project settings — canvas resolution and frame rate"
            onClick={() => {
              const state = useEditor.getState();
              state.setPlaying(false);
              state.select(null, null);
              state.setWorkspace('edit');
              state.setMobilePanel('inspector');
            }}
          >
            {project.fps} fps
          </button>
        </div>
      </div>
    </div>
  );
}

function Timecode() {
  const playhead = useEditor((s) => s.playhead);
  const fps = useEditor((s) => s.project.fps);
  const total = useEditor((s) => projectDuration(s.project));
  return (
    <div className="tc">
      <span className="tc-current">{formatTimecode(playhead, fps)}</span>
      <span className="tc-sep">/</span>
      <span className="tc-total">{formatTimecode(total, fps)}</span>
    </div>
  );
}

export function Transport() {
  const playing = useEditor((s) => s.playing);
  const fps = useEditor((s) => s.project.fps);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    getAudioEngine().setMasterVolume(muted ? 0 : volume);
  }, [volume, muted, playing]);

  const seekBy = (delta: number) => {
    const state = useEditor.getState();
    state.setPlaying(false);
    state.setPlayhead(Math.max(0, state.playhead + delta));
  };

  const toggle = () => {
    const state = useEditor.getState();
    if (state.playing) {
      state.setPlaying(false);
      return;
    }
    const total = projectDuration(state.project);
    if (total <= 0.01) {
      state.notify('Add media to the timeline first.', 'error');
      return;
    }
    if (state.playhead >= total - 0.01) state.setPlayhead(0);
    void getAudioEngine().context.resume().catch(() => undefined);
    state.setPlaying(true);
  };

  return (
    <div className="transport">
      <div className="transport-main">
        <button
          className="btn ghost icon"
          title="Go to start (Home)"
          onClick={() => {
            useEditor.getState().setPlaying(false);
            useEditor.getState().setPlayhead(0);
          }}
        >
          <Icon name="backs" size={15} />
        </button>
        <button className="btn ghost icon" title="Previous frame (←)" onClick={() => seekBy(-1 / fps)}>
          <Icon name="start" size={14} />
        </button>
        <button className="pp-btn" onClick={toggle} title={playing ? 'Pause (Space)' : 'Play (Space)'} aria-label={playing ? 'Pause' : 'Play'}>
          <Icon name={playing ? 'pause' : 'play'} size={19} />
        </button>
        <button className="btn ghost icon" title="Next frame (→)" onClick={() => seekBy(1 / fps)}>
          <Icon name="end" size={14} />
        </button>
        <button
          className="btn ghost icon"
          title="Go to end (End)"
          onClick={() => {
            const state = useEditor.getState();
            state.setPlaying(false);
            state.setPlayhead(projectDuration(state.project));
          }}
        >
          <Icon name="fwds" size={15} />
        </button>
      </div>

      <Timecode />

      <div className="vol">
        <button
          className="btn ghost icon sm"
          title={muted ? 'Unmute' : 'Mute preview'}
          onClick={() => setMuted((m) => !m)}
        >
          <Icon name={muted || volume === 0 ? 'mute' : 'volume'} size={15} />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          aria-label="Preview volume"
          onChange={(e) => {
            const v = Number(e.target.value);
            setVolume(v);
            setMuted(v === 0);
          }}
        />
        <button
          className="btn ghost icon sm"
          title="Fullscreen preview"
          onClick={() => {
            const stage = document.querySelector('.stage');
            if (!document.fullscreenElement && stage instanceof HTMLElement) {
              void stage.requestFullscreen?.().catch(() => undefined);
            } else {
              void document.exitFullscreen?.().catch(() => undefined);
            }
          }}
        >
          <Icon name="expand" size={15} />
        </button>
      </div>
    </div>
  );
}