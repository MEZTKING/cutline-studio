import { useEffect, useState } from 'react';
import { desktop, isDesktop, serializeProjectForDesktop, type DesktopQueueJob } from '../desktop/bridge';
import { useEditor } from '../state/store';
import { Icon } from './icons';

const PRESETS = [
  { id: 'youtube1080', label: 'YouTube · 1080p WebM', width: 1920, height: 1080, fps: 30, quality: 'high' as const },
  { id: 'youtube4k', label: 'YouTube · 4K WebM', width: 3840, height: 2160, fps: 30, quality: 'high' as const },
  { id: 'reels', label: 'Reels / Shorts · 9:16', width: 1080, height: 1920, fps: 30, quality: 'high' as const },
  { id: 'square', label: 'Square · 1:1', width: 1080, height: 1080, fps: 30, quality: 'high' as const },
  { id: 'review', label: 'Review copy · 720p', width: 1280, height: 720, fps: 30, quality: 'fast' as const },
];

export function RenderQueueDialog() {
  const open = useEditor((s) => s.queueOpen);
  const setOpen = useEditor((s) => s.setQueueOpen);
  const notify = useEditor((s) => s.notify);
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [jobs, setJobs] = useState<DesktopQueueJob[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!open || !desktop) return;
    void desktop.queueList().then(setJobs);
    return desktop.onQueueUpdate(setJobs);
  }, [open]);

  if (!open) return null;

  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];

  const addCurrent = async () => {
    if (!desktop) return;
    setAdding(true);
    try {
      const state = useEditor.getState();
      const data = serializeProjectForDesktop(state.project, state.assets);
      if (!data.assets.length) {
        notify('Add media from disk first — the queue needs a desktop project.', 'error');
        return;
      }
      const output = await desktop.queueChooseOutput(state.project.name || 'Cutline render');
      if (!output) return;
      const result = await desktop.queueAdd(data, {
        width: preset.width,
        height: preset.height,
        fps: preset.fps,
        quality: preset.quality,
        format: 'webm',
        includeAudio: true,
      }, output);
      if ('id' in result) {
        setJobs((prev) => [result, ...prev.filter((j) => j.id !== result.id)]);
        notify(`Queued ${preset.label}`, 'success');
      } else {
        notify(result.error, 'error');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setAdding(false);
    }
  };

  const clear = async () => {
    if (desktop) setJobs(await desktop.queueClear());
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal queue-modal">
        <div className="modal-head">
          <div>
            <div className="eyebrow">Delivery</div>
            <h2>Render queue</h2>
          </div>
          <button className="btn ghost icon" title="Close" onClick={() => setOpen(false)}>
            <Icon name="close" size={15} />
          </button>
        </div>
        <div className="modal-body queue-body">
          {!isDesktop ? (
            <div className="hint">The render queue is available in the desktop app.</div>
          ) : (
            <>
              <div className="queue-add">
                <select aria-label="Render preset" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                  {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <button className="btn primary" disabled={adding} onClick={() => void addCurrent()}>
                  <Icon name="plus" size={13} /> Add current project
                </button>
              </div>
              <div className="hint">
                Each job snapshots the project as it is now and renders in the background. This queue uses
                WebM for reliable audio; MP4/ProRes masters are still exported from the Export dialog.
              </div>
              {jobs.length === 0 ? (
                <div className="empty-state" style={{ padding: '24px 0' }}>
                  <Icon name="layers" size={24} style={{ opacity: 0.3 }} />
                  <p>No renders yet. Add the current project above.</p>
                </div>
              ) : (
                <div className="queue-list">
                  {jobs.map((job) => (
                    <div className={`queue-job ${job.status}`} key={job.id}>
                      <div className="queue-job-main">
                        <div className="queue-job-title">
                          <strong>{job.settings.width}×{job.settings.height} · {job.settings.fps} fps</strong>
                          <span className={`queue-status ${job.status}`}>{job.status}</span>
                        </div>
                        <div className="queue-output" title={job.outputPath}>{job.outputPath}</div>
                        {(job.status === 'running' || job.status === 'queued') && (
                          <div className="queue-progress">
                            <span style={{ width: `${job.status === 'queued' ? 0 : job.progress}%` }} />
                          </div>
                        )}
                        <div className="queue-phase">
                          {job.status === 'running' ? `${Math.round(job.progress)}% · ${job.phase}` : job.status === 'done' ? `${(Number(job.bytes || 0) / 1e6).toFixed(1)} MB` : job.error || job.phase}
                        </div>
                      </div>
                      <div className="queue-actions">
                        {job.status === 'done' && (
                          <button className="btn ghost icon sm" title="Show output" onClick={() => void desktop?.showItem(job.outputPath)}>
                            <Icon name="download" size={13} />
                          </button>
                        )}
                        {job.status === 'queued' && (
                          <button className="btn ghost icon sm" title="Remove from queue" onClick={() => void desktop?.queueRemove(job.id).then(setJobs)}>
                            <Icon name="close" size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => void clear()}>Clear finished</button>
          <button className="btn" onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}
