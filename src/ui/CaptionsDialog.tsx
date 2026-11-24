import { useEffect, useRef, useState } from 'react';
import { projectDuration, captionSegments } from '../core/model';
import { formatSrt, parseSrt, downloadTextFile } from '../captions/srt';
import { transcribeAudio, ASR_APPROX_MB, type AsrProgress } from '../captions/asr';
import { renderSpeech } from '../audio/mixdown';
import { useEditor } from '../state/store';
import { Icon } from './icons';

const MAX_TRANSCRIBE_SECONDS = 600;

function safeName(name: string): string {
  return (name || 'captions').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 80) || 'captions';
}

export function CaptionsDialog() {
  const open = useEditor((s) => s.captionsOpen);
  const setOpen = useEditor((s) => s.setCaptionsOpen);
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);

  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [progress, setProgress] = useState<AsrProgress>({ phase: 'download', percent: 0, detail: '' });
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const captions = captionSegments(project);
  const duration = projectDuration(project);
  const hasAudio = project.tracks.some((t) => !t.muted && t.clips.some((c) => assets[c.assetId]?.hasAudio || assets[c.assetId]?.audioBuffer));
  const tooLong = duration > MAX_TRANSCRIBE_SECONDS;

  useEffect(() => {
    if (!open) return;
    setStatus('idle');
    setError(null);
    setProgress({ phase: 'download', percent: 0, detail: '' });
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
    if (status === 'running') return;
    if (duration < 0.2) {
      setError('Add some footage with audio first.');
      return;
    }
    if (!hasAudio) {
      setError('No audible clips on the timeline. Captions need dialogue or voice-over.');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('running');
    setError(null);
    try {
      const audio = await renderSpeech(project, assets, Math.min(duration, MAX_TRANSCRIBE_SECONDS), 16000);
      if (!audio) throw new Error('The timeline has no audio to transcribe.');
      const segments = await transcribeAudio(audio, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (!segments.length) {
        setStatus('idle');
        setError('No speech detected. Try clearer dialogue or import an .srt instead.');
        return;
      }
      const editor = useEditor.getState();
      const count = editor.addCaptions(segments);
      if (!count) {
        setStatus('idle');
        setError('Captions could not be created.');
        return;
      }
      editor.notify(`Generated ${count} captions on the CC track${tooLong ? ' (first 10 minutes)' : ''}`, 'success');
      setStatus('idle');
      setOpen(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatus('idle');
        setProgress({ phase: 'download', percent: 0, detail: 'Cancelled' });
      } else {
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      abortRef.current = null;
    }
  };

  const importSrt = async (file: File) => {
    try {
      const text = await file.text();
      const segments = parseSrt(text);
      if (!segments.length) {
        setStatus('error');
        setError('That file has no valid SRT cues. Export one from another editor and try again.');
        return;
      }
      const count = useEditor.getState().addCaptions(segments);
      if (count) {
        useEditor.getState().notify(`Imported ${count} captions from ${file.name}`, 'success');
        setOpen(false);
      }
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const exportSrt = () => {
    if (!captions.length) return;
    downloadTextFile(`${safeName(project.name)}.srt`, formatSrt(captions));
    useEditor.getState().notify('Captions exported as .srt', 'success');
  };

  const phaseLabel =
    progress.phase === 'download' ? 'Speech model' : progress.phase === 'transcribe' ? 'Transcribing' : 'Preparing';

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && status !== 'running') setOpen(false);
      }}
    >
      <div className="modal" role="dialog" aria-label="Captions">
        <div className="modal-head">
          <div style={{ flex: 1 }}>
            <div className="modal-title">Captions</div>
            <div className="modal-sub">
              {captions.length > 0 ? `${captions.length} caption${captions.length === 1 ? '' : 's'} on the CC track` : 'On-device subtitles — no upload'}
            </div>
          </div>
          <button className="btn ghost icon" onClick={() => setOpen(false)} disabled={status === 'running'} title="Close">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="captions-hero">
            <div className="captions-hero-icon">
              <Icon name="sparkle" size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="captions-hero-title">Generate from audio</div>
              <div className="captions-hero-copy">
                Whisper runs locally in this browser. The first run downloads a {ASR_APPROX_MB} MB English model once, then works offline.
              </div>
            </div>
          </div>

          {status === 'running' && (
            <div>
              <div className="progress">
                <div style={{ width: `${Math.max(1, progress.percent)}%` }} />
              </div>
              <div className="progress-meta">
                <span>{phaseLabel} · {progress.detail || 'working…'}</span>
                <span>{Math.round(progress.percent)}%</span>
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                Transcription can take a few minutes on a phone. Keep the tab in the foreground.
              </div>
            </div>
          )}

          {error && (
            <div className="hint warn" style={{ padding: '10px', border: '1px solid rgba(255,93,122,.35)', borderRadius: 8, background: 'rgba(255,93,122,.07)' }}>
              {error}
            </div>
          )}

          {!hasAudio && (
            <div className="hint warn">No audible clips yet — import a video with sound or add an audio file.</div>
          )}
          {tooLong && (
            <div className="hint warn">This project is longer than 10 minutes. Auto captions only cover the first 10 minutes for now.</div>
          )}

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {status === 'running' ? (
              <button className="btn danger" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            ) : (
              <button className="btn primary" disabled={!hasAudio} onClick={() => void start()}>
                <Icon name="sparkle" size={14} /> {captions.length ? 'Regenerate captions' : 'Generate captions'}
              </button>
            )}
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={status === 'running'}>
              <Icon name="upload" size={14} /> Import .srt
            </button>
            <button className="btn" onClick={exportSrt} disabled={!captions.length || status === 'running'}>
              <Icon name="download" size={14} /> Export .srt
            </button>
          </div>

          <div className="export-band">
            <span>
              Manual cue at the playhead
            </span>
            <button className="btn sm" onClick={() => useEditor.getState().addCaptionAtPlayhead()} disabled={status === 'running'}>
              <Icon name="plus" size={12} /> Add caption
            </button>
          </div>

          {captions.length > 0 && (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="hint">Click a caption clip to edit its words, colour, or position.</span>
              <button className="btn sm danger" onClick={() => useEditor.getState().clearCaptions()} disabled={status === 'running'}>
                Clear all
              </button>
            </div>
          )}

          <div className="hint">
            Auto captions replace existing captions. Everything is editable afterwards — cues are normal text clips on the CC track.
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={() => setOpen(false)} disabled={status === 'running'}>
            Close
          </button>
          <span style={{ flex: 1 }} />
          {status !== 'running' && (
            <span className="hint" style={{ textAlign: 'right' }}>
              English · runs on this device
            </span>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".srt,text/plain,application/x-subrip"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importSrt(file);
          }}
        />
      </div>
    </div>
  );
}
