import { useEffect, useRef, useState } from 'react';
import { projectDuration } from '../core/model';
import { autoReframeProject, REFRAME_TARGETS, type ReframeProgress } from '../reframe/reframe';
import { useEditor } from '../state/store';
import { Icon } from './icons';

export function AutoReframeDialog() {
  const open = useEditor((s) => s.reframeOpen);
  const setOpen = useEditor((s) => s.setReframeOpen);
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);

  const [targetKey, setTargetKey] = useState('9:16');
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [progress, setProgress] = useState<ReframeProgress>({ phase: 'load', percent: 0, detail: '' });
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const target = REFRAME_TARGETS.find((t) => t.key === targetKey) ?? REFRAME_TARGETS[0];
  const visualClips = project.tracks
    .filter((t) => t.kind === 'video' && !t.hidden && !t.locked)
    .reduce((n, t) => n + t.clips.filter((c) => !c.text).length, 0);
  const duration = projectDuration(project);

  useEffect(() => {
    if (!open) return;
    setStatus('idle');
    setError(null);
    setProgress({ phase: 'load', percent: 0, detail: '' });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && status !== 'running') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, status, setOpen]);

  if (!open) return null;

  const start = async () => {
    if (!visualClips || duration <= 0.05) {
      setError('Add a video or image clip first.');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('running');
    setError(null);
    setProgress({ phase: 'load', percent: 0, detail: 'Starting…' });
    try {
      const result = await autoReframeProject(project, assets, target, setProgress, controller.signal);
      const state = useEditor.getState();
      state.setPlaying(false);
      state.commitProject({ ...result.project, autoSettings: false });
      const faceNote = result.stats.faceTracking
        ? result.stats.faces > 0
          ? `faces found in ${result.stats.faces}/${result.stats.samples} samples`
          : 'no faces found — centre crop'
        : 'centre crop (face detector unavailable)';
      state.notify(
        `Reframed ${result.stats.clips} clip${result.stats.clips === 1 ? '' : 's'} to ${target.ratio} · ${faceNote}`,
        result.stats.faceTracking ? 'success' : 'info',
      );
      setStatus('idle');
      setOpen(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatus('idle');
        setProgress({ phase: 'load', percent: 0, detail: 'Cancelled' });
      } else {
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      abortRef.current = null;
    }
  };

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && status !== 'running') setOpen(false);
      }}
    >
      <div className="modal" role="dialog" aria-label="Auto-reframe">
        <div className="modal-head">
          <div style={{ flex: 1 }}>
            <div className="modal-title">Auto-reframe</div>
            <div className="modal-sub">
              Face-following crop for Reels, Shorts, TikTok, and square posts
            </div>
          </div>
          <button className="btn ghost icon" onClick={() => setOpen(false)} disabled={status === 'running'} title="Close">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="captions-hero">
            <div className="captions-hero-icon">
              <Icon name="reframe" size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="captions-hero-title">Same cut. New shape.</div>
              <div className="captions-hero-copy">
                Detects faces locally, fills the new canvas, and keyframes the pan so the subject stays in frame.
                Nothing leaves this device.
              </div>
            </div>
          </div>

          <div className="field">
            <label>Target frame</label>
            <div className="aspect-grid">
              {REFRAME_TARGETS.map((t) => {
                const h = 24;
                const w = Math.max(10, Math.round((t.width / t.height) * h));
                return (
                  <button
                    key={t.key}
                    className={`aspect-option ${t.key === target.key ? 'on' : ''}`}
                    disabled={status === 'running'}
                    onClick={() => setTargetKey(t.key)}
                    title={t.label}
                  >
                    <span className="aspect-box" style={{ width: w, height: t.width > t.height ? Math.max(10, Math.round(h * 0.62)) : h }} />
                    <span className="aspect-key">{t.ratio}</span>
                    <span className="aspect-label">{t.label.split(' / ')[0]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="export-band">
            <span>
              New canvas <b>{target.width}×{target.height}</b>
            </span>
            <span>
              <b>{visualClips}</b> visual clip{visualClips === 1 ? '' : 's'} · <b>{duration.toFixed(1)}s</b>
            </span>
          </div>

          {status === 'running' && (
            <div>
              <div className="progress">
                <div style={{ width: `${Math.max(1, progress.percent)}%` }} />
              </div>
              <div className="progress-meta">
                <span>{progress.detail || 'Working…'}</span>
                <span>{Math.round(progress.percent)}%</span>
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                Face detection samples a few frames per clip; longer clips take longer.
              </div>
            </div>
          )}

          {error && (
            <div
              className="hint warn"
              style={{
                padding: '10px',
                border: '1px solid rgba(255,93,122,.35)',
                borderRadius: 8,
                background: 'rgba(255,93,122,.07)',
              }}
            >
              {error}
            </div>
          )}

          <div className="hint">
            This changes the project canvas, sets clips to <b>fill frame</b>, resets their scale/rotation, and replaces
            position keyframes on visual clips. <b>Undo</b> restores the previous edit exactly.
          </div>
        </div>

        <div className="modal-foot">
          {status === 'running' ? (
            <>
              <button className="btn danger" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
              <span style={{ flex: 1 }} />
              <span className="hint">Keep the tab in the foreground</span>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => setOpen(false)}>
                Close
              </button>
              <span style={{ flex: 1 }} />
              <button className="btn primary" disabled={!visualClips || duration <= 0.05} onClick={() => void start()}>
                <Icon name="reframe" size={14} /> Analyze & reframe
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}