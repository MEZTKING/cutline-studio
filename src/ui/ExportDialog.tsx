import { useEffect, useMemo, useRef, useState } from 'react';
import { projectDuration } from '../core/model';
import { exportProject, getExportCapabilities, webCodecsAvailable, type ExportFormat, type ExportProgress, type ExportQuality, type ExportResult } from '../export/exporter';
import { useEditor } from '../state/store';
import { desktop, isDesktop } from '../desktop/bridge';
import { Icon } from './icons';

const FPS_OPTIONS = [24, 25, 30, 50, 60];
const QUALITY_LABEL: Record<ExportQuality, string> = { fast: 'Fast', balanced: 'Balanced', high: 'High' };

function fileSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${Math.max(0.1, bytes / 1e6).toFixed(1)} MB`;
}

function triggerDownload(result: ExportResult): void {
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function ExportDialog() {
  const open = useEditor((s) => s.exportOpen);
  const setOpen = useEditor((s) => s.setExportOpen);
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);

  const [width, setWidth] = useState(project.width);
  const [height, setHeight] = useState(project.height);
  const [fps, setFps] = useState(project.fps);
  const [quality, setQuality] = useState<ExportQuality>('balanced');
  const [format, setFormat] = useState<ExportFormat>('auto');
  const [includeAudio, setIncludeAudio] = useState(true);
  const [fileName, setFileName] = useState(project.name);
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<ExportProgress>({ phase: 'Ready', percent: 0 });
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [caps, setCaps] = useState<{ mp4: boolean; webm: boolean; webcodecs: boolean } | null>(null);
  const [ffmpegAvailable, setFfmpegAvailable] = useState<boolean | null>(null);
  const [nativeMaster, setNativeMaster] = useState(false);
  const [codec, setCodec] = useState<'h264' | 'hevc' | 'prores'>('h264');
  const [nativeResult, setNativeResult] = useState<{ path: string; size: number } | null>(null);
  const [mastering, setMastering] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setWidth(project.width);
    setHeight(project.height);
    setFps(project.fps);
    setFileName(project.name);
    setStatus('idle');
    setResult(null);
    setNativeResult(null);
    setMastering(false);
    setError(null);
    setProgress({ phase: 'Ready', percent: 0 });
    const hasAudio = Object.values(assets).some((a) => a.kind === 'audio' || (a.kind === 'video' && a.hasAudio));
    setIncludeAudio(hasAudio);
    void getExportCapabilities().then(setCaps);
    if (isDesktop && desktop) {
      void desktop.info().then((info) => {
        setFfmpegAvailable(Boolean(info.ffmpeg));
        setNativeMaster(Boolean(info.ffmpeg));
      }).catch(() => setFfmpegAvailable(false));
    } else {
      setFfmpegAvailable(null);
      setNativeMaster(false);
    }
  }, [open, project.width, project.height, project.fps, project.name, assets]);

  const duration = projectDuration(project);
  const totalClips = project.tracks.reduce((n, t) => n + t.clips.length, 0);
  const hasAudioClips = useMemo(
    () => project.tracks.some((t) => !t.muted && t.clips.some((c) => assets[c.assetId]?.kind === 'audio' || assets[c.assetId]?.hasAudio)),
    [project, assets],
  );

  const resOptions = useMemo(() => {
    const list = [
      { key: `${project.width}x${project.height}`, label: `Project · ${project.width}×${project.height}`, w: project.width, h: project.height },
      { key: '3840x2160', label: '4K · 3840×2160', w: 3840, h: 2160 },
      { key: '1920x1080', label: '1080p · 1920×1080', w: 1920, h: 1080 },
      { key: '1280x720', label: '720p · 1280×720', w: 1280, h: 720 },
      { key: '1080x1920', label: 'Vertical · 1080×1920', w: 1080, h: 1920 },
      { key: '1080x1080', label: 'Square · 1080×1080', w: 1080, h: 1080 },
    ];
    return list.filter((item, i) => list.findIndex((x) => x.key === item.key) === i);
  }, [project.width, project.height]);

  const qualityMult = quality === 'fast' ? 0.055 : quality === 'high' ? 0.16 : 0.1;
  const estimatedBytes = ((width * height * fps * qualityMult + 192_000) * duration) / 8;
  const canExport = webCodecsAvailable() && duration > 0.05 && status !== 'running';

  const close = () => {
    if (status === 'running') return;
    setOpen(false);
  };

  const start = async () => {
    const state = useEditor.getState();
    state.setPlaying(false);
    const controller = new AbortController();
    abortRef.current = controller;
    const useNative = isDesktop && nativeMaster && Boolean(ffmpegAvailable) && Boolean(desktop);
    setStatus('running');
    setError(null);
    setResult(null);
    setNativeResult(null);
    setMastering(false);
    setProgress({ phase: 'Preparing', percent: 0 });
    try {
      const out = await exportProject(
        project,
        assets,
        {
          width,
          height,
          fps,
          quality,
          format,
          includeAudio: includeAudio && hasAudioClips,
          fileName,
        },
        (p) => setProgress({ phase: p.phase, percent: p.percent * (useNative ? 0.7 : 1) }),
        controller.signal,
      );

      if (useNative && desktop) {
        setMastering(true);
        setProgress({ phase: 'Encoding master with FFmpeg…', percent: 71 });
        const unsubscribe = desktop.onExportProgress((p) => {
          setProgress({ phase: p.detail ?? 'Encoding master…', percent: 72 + Math.min(1, p.percent / 100) * 27 });
        });
        try {
          const res = await desktop.transcode({
            data: await out.blob.arrayBuffer(),
            inputExtension: out.extension,
            suggestedName: `${fileName || project.name}.${out.extension}`,
            codec,
            quality,
            durationSeconds: out.durationSeconds,
          });
          if (!res.ok) {
            if (res.canceled) {
              setStatus('idle');
              setProgress({ phase: 'Cancelled', percent: 0 });
              return;
            }
            throw new Error(res.error || 'FFmpeg could not encode the master.');
          }
          setResult(out);
          setNativeResult({ path: res.path!, size: res.size! });
        } finally {
          unsubscribe();
          setMastering(false);
        }
      } else {
        setResult(out);
        triggerDownload(out);
      }

      setStatus('done');
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatus('idle');
        setProgress({ phase: 'Cancelled', percent: 0 });
      } else {
        setStatus('error');
        setError(message);
      }
    } finally {
      abortRef.current = null;
    }
  };

  const share = async () => {
    if (!result) return;
    const file = new File([result.blob], result.filename, { type: result.blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: result.filename });
        return;
      } catch {
        /* user dismissed */
      }
    }
    useEditor.getState().notify('Use Download — sharing files is not supported here.', 'info');
  };

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal" role="dialog" aria-label="Export video">
        <div className="modal-head">
          <div style={{ flex: 1 }}>
            <div className="modal-title">Export</div>
            <div className="modal-sub">
              {totalClips} clip{totalClips === 1 ? '' : 's'} · {duration.toFixed(1)}s · renders locally on this device
            </div>
          </div>
          <button className="btn ghost icon" onClick={close} disabled={status === 'running'} title="Close">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="modal-body">
          {caps && !caps.webcodecs && (
            <div className="hint warn" style={{ padding: '10px', border: '1px solid rgba(255,196,107,.3)', borderRadius: 8, background: 'rgba(255,196,107,.06)' }}>
              This browser has no WebCodecs encoder. Open Cutline in Chrome or Edge — on Android, desktop mode is not needed.
            </div>
          )}

          <div className="export-grid">
            <div className="field">
              <label>Resolution</label>
              <select
                value={`${width}x${height}`}
                disabled={status === 'running'}
                onChange={(e) => {
                  const found = resOptions.find((r) => r.key === e.target.value);
                  if (found) {
                    setWidth(found.w);
                    setHeight(found.h);
                  }
                }}
              >
                {resOptions.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Frame rate</label>
              <select value={fps} disabled={status === 'running'} onChange={(e) => setFps(Number(e.target.value))}>
                {[...new Set([...FPS_OPTIONS, project.fps])].sort((a, b) => a - b).map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Quality</label>
              <div className="seg">
                {(['fast', 'balanced', 'high'] as ExportQuality[]).map((q) => (
                  <button key={q} className={quality === q ? 'on' : ''} disabled={status === 'running'} onClick={() => setQuality(q)}>
                    {QUALITY_LABEL[q]}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Container</label>
              <select value={format} disabled={status === 'running'} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
                <option value="auto">Auto (best supported)</option>
                <option value="mp4" disabled={caps ? !caps.mp4 : false}>
                  MP4 · H.264{caps && !caps.mp4 ? ' (unsupported)' : ''}
                </option>
                <option value="webm" disabled={caps ? !caps.webm : false}>
                  WebM · VP9{caps && !caps.webm ? ' (unsupported)' : ''}
                </option>
              </select>
            </div>
          </div>

          {isDesktop && (
            <div className="export-band" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <label className="toggle-row" style={{ alignItems: 'flex-start', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={nativeMaster}
                  disabled={!ffmpegAvailable || status === 'running'}
                  onChange={(e) => setNativeMaster(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <b>Desktop master with FFmpeg</b>
                  <br />
                  <span style={{ color: 'var(--text-3)', fontSize: 10 }}>
                    Adds H.264, HEVC, and ProRes delivery masters, encoded on disk.
                  </span>
                </span>
              </label>
              {nativeMaster && (
                <div className="field">
                  <label>Master codec</label>
                  <select value={codec} disabled={status === 'running'} onChange={(e) => setCodec(e.target.value as 'h264' | 'hevc' | 'prores')}>
                    <option value="h264">H.264 MP4 · maximum compatibility</option>
                    <option value="hevc">HEVC MP4 · smaller high-quality files</option>
                    <option value="prores">ProRes 422 MOV · edit-ready master</option>
                  </select>
                </div>
              )}
              {ffmpegAvailable === false && (
                <div className="hint warn">FFmpeg was not found in this desktop install.</div>
              )}
              {nativeMaster && (
                <div className="hint">
                  The browser renders at {width}×{height}, then FFmpeg writes the final master with a save dialog. This
                  is a delivery transcode, not a frame-accurate native render.
                </div>
              )}
            </div>
          )}

          <div className="field">
            <label>File name</label>
            <input type="text" value={fileName} disabled={status === 'running'} onChange={(e) => setFileName(e.target.value)} />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--text-2)' }}>
            <input
              type="checkbox"
              checked={includeAudio && hasAudioClips}
              disabled={!hasAudioClips || status === 'running'}
              onChange={(e) => setIncludeAudio(e.target.checked)}
            />
            Include audio{!hasAudioClips ? ' — no audible clips' : ''}
          </label>

          <div className="export-band">
            <span>
              Estimated <b>{fileSize(estimatedBytes)}</b>
            </span>
            <span>
              {width}×{height} · <b>{fps}</b> fps
            </span>
          </div>

          {status === 'running' && (
            <div>
              <div className="progress">
                <div style={{ width: `${Math.max(1, progress.percent)}%` }} />
              </div>
              <div className="progress-meta">
                <span>{progress.phase}</span>
                <span>{Math.round(progress.percent)}%</span>
              </div>
            </div>
          )}

          {status === 'error' && error && (
            <div className="hint warn" style={{ padding: '10px', border: '1px solid rgba(255,93,122,.35)', borderRadius: 8, background: 'rgba(255,93,122,.07)' }}>
              {error}
            </div>
          )}

          {status === 'done' && result && (
            <div className="result-card" ref={resultRef}>
              <div className="result-icon">
                <Icon name="check" size={16} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="result-name">
                  {nativeResult ? nativeResult.path.split(/[\\/]/).pop() : result.filename}
                </div>
                <div className="result-sub">
                  {nativeResult
                    ? `${fileSize(nativeResult.size)} · ${result.durationSeconds.toFixed(1)}s · master saved`
                    : `${fileSize(result.blob.size)} · ${result.durationSeconds.toFixed(1)}s · saved to Downloads`}
                </div>
              </div>
            </div>
          )}

          <div className="hint">
            Long exports can take a while — keep the tab in the foreground. For the best quality/speed, use High with a 1080p canvas.
          </div>
        </div>

        <div className="modal-foot">
          {status === 'running' ? (
            mastering ? (
              <span className="hint">Encoding master with FFmpeg…</span>
            ) : (
              <button className="btn danger" onClick={() => abortRef.current?.abort()}>
                Cancel export
              </button>
            )
          ) : (
            <>
              <button className="btn" onClick={close}>
                Close
              </button>
              {status === 'done' && result && !nativeResult && (
                <>
                  <button className="btn" onClick={() => triggerDownload(result)}>
                    <Icon name="download" size={14} /> Download again
                  </button>
                  <button className="btn" onClick={share}>
                    <Icon name="share" size={14} /> Share
                  </button>
                </>
              )}
              {status === 'done' && nativeResult && (
                <button className="btn" onClick={() => void desktop?.showItem(nativeResult.path)}>
                  <Icon name="film" size={14} /> Show in folder
                </button>
              )}
            </>
          )}
          <span style={{ flex: 1 }} />
          {status !== 'running' && (
            <button className="btn primary" disabled={!canExport} onClick={() => void start()}>
              <Icon name="download" size={14} /> {nativeMaster ? 'Export master' : 'Export'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

