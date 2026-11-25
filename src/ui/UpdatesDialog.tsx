import { useEffect, useRef, useState } from 'react';
import {
  desktop,
  type DesktopUpdateConfig,
  type DesktopUpdateDownload,
} from '../desktop/bridge';
import { useEditor } from '../state/store';
import { Icon } from './icons';

type Phase = 'idle' | 'checking' | 'available' | 'uptodate' | 'downloading' | 'ready' | 'installing' | 'error';

const fmtSize = (n: number) => {
  if (!n) return '—';
  if (n > 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n > 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.round(n / 1e3)} KB`;
};

export function UpdatesDialog() {
  const open = useEditor((s) => s.updateOpen);
  const available = useEditor((s) => s.updateAvailable);
  const setOpen = useEditor((s) => s.setUpdateOpen);
  const setAvailable = useEditor((s) => s.setUpdateAvailable);
  const [config, setConfig] = useState<DesktopUpdateConfig | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ received: 0, total: 0, percent: 0 });
  const [download, setDownload] = useState<DesktopUpdateDownload | null>(null);
  const [error, setError] = useState('');
  const [feed, setFeed] = useState('');
  const progressOff = useRef<(() => void) | null>(null);
  const ranFor = useRef(false);

  const close = () => {
    if (phase === 'downloading') void desktop?.cancelUpdate();
    progressOff.current?.();
    progressOff.current = null;
    setOpen(false);
  };

  useEffect(() => {
    if (!open) {
      ranFor.current = false;
      return;
    }
    if (ranFor.current) return;
    ranFor.current = true;
    setError('');
    setDownload(null);
    setPhase('checking');
    if (!desktop) {
      setPhase('error');
      setError('Updates are only available in the desktop app.');
      return;
    }
    void (async () => {
      try {
        const cfg = await desktop!.updateConfig();
        setConfig(cfg);
        setFeed(cfg.feedUrl);
        if (available) {
          setPhase('available');
          return;
        }
        const info = await desktop!.checkUpdate();
        if (info) {
          setAvailable(info);
          setPhase('available');
        } else {
          setPhase('uptodate');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    })();
    // `available` is intentionally only read on first open of this run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => progressOff.current?.(), []);

  const check = async () => {
    if (!desktop) return;
    setError('');
    setDownload(null);
    setPhase('checking');
    try {
      const info = await desktop.checkUpdate();
      setAvailable(info);
      setPhase(info ? 'available' : 'uptodate');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  const startDownload = async () => {
    if (!desktop) return;
    setError('');
    setPhase('downloading');
    setProgress({ received: 0, total: available?.size ?? 0, percent: 0 });
    progressOff.current?.();
    progressOff.current = desktop.onUpdateProgress((p) => setProgress(p));
    try {
      const result = await desktop.downloadUpdate();
      setDownload(result);
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('available');
    } finally {
      progressOff.current?.();
      progressOff.current = null;
    }
  };

  const cancel = async () => {
    await desktop?.cancelUpdate().catch(() => undefined);
  };

  const install = async () => {
    if (!desktop || !available) return;
    const ok = window.confirm(
      `Install Cutline Studio ${available.version} now?\n\nThe app will close, replace its files, and reopen. Save your project first.`,
    );
    if (!ok) return;
    setError('');
    setPhase('installing');
    try {
      await desktop.installUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('ready');
    }
  };

  const saveFeed = async () => {
    if (!desktop) return;
    try {
      const result = await desktop.setUpdateFeed(feed);
      setConfig((c) => (c ? { ...c, feedUrl: result.feedUrl } : c));
      setFeed(result.feedUrl);
      await check();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  if (!open) return null;
  const canUpdate = Boolean(config?.packaged || config?.allowDev);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal updates-modal" role="dialog" aria-label="App updates">
        <div className="modal-head">
          <div>
            <div className="eyebrow">App updates</div>
            <h2>Cutline Studio</h2>
          </div>
          <button className="btn ghost icon" title="Close" onClick={close}>
            <Icon name="close" size={15} />
          </button>
        </div>

        <div className="modal-body update-body">
          <div className="update-versions">
            <div>
              <span>Installed</span>
              <b>v{config?.currentVersion ?? '—'}</b>
            </div>
            <div className="update-arrow">→</div>
            <div>
              <span>Latest</span>
              <b>{available ? `v${available.version}` : phase === 'checking' ? 'checking…' : '—'}</b>
            </div>
          </div>

          {available && (
            <div className="update-meta">
              {available.released ? `Released ${new Date(available.released).toLocaleDateString()}` : `Channel stable`} · {fmtSize(available.size)} ·
              {' '}verified with SHA-256
            </div>
          )}

          {available?.notes && phase !== 'uptodate' && <pre className="update-notes">{available.notes}</pre>}

          {phase === 'checking' && (
            <div className="update-status">
              <span className="spinner" /> Contacting the update feed…
            </div>
          )}

          {phase === 'uptodate' && (
            <div className="update-status success">
              <Icon name="check" size={16} /> You’re running the newest build.
            </div>
          )}

          {phase === 'downloading' && (
            <div className="update-progress">
              <div className="update-progress-head">
                <span>Downloading {available ? `v${available.version}` : 'update'}</span>
                <b>{Math.round(progress.percent)}%</b>
              </div>
              <div className="update-progress-bar">
                <span style={{ width: `${Math.max(1, progress.percent)}%` }} />
              </div>
              <div className="hint">
                {fmtSize(progress.received)} of {fmtSize(progress.total)} · the app stays open while it downloads.
              </div>
            </div>
          )}

          {phase === 'ready' && download && (
            <div className="update-status success">
              <Icon name="check" size={16} />
              <span>Downloaded and SHA-256 verified ({fmtSize(download.size)}). Ready to install.</span>
            </div>
          )}

          {phase === 'installing' && (
            <div className="update-status">
              <span className="spinner" /> Installing and restarting…
            </div>
          )}

          {error && (
            <div className="hint warn update-error">
              {error}
            </div>
          )}

          {config && !config.packaged && phase !== 'error' && (
            <div className="hint">Development build: updates cannot install, but check and download are live.</div>
          )}

          <details className="update-feed">
            <summary>Update feed</summary>
            <div className="row update-feed-row">
              <input
                value={feed}
                aria-label="Update feed URL"
                placeholder="https://example.com/latest.json"
                onChange={(e) => setFeed(e.target.value)}
                spellCheck={false}
              />
              <button className="btn sm" onClick={() => void saveFeed()}>
                Save & check
              </button>
            </div>
            <div className="hint">
              Downloads are verified against the SHA-256 in the feed. Use HTTPS for public feeds; HTTP is only
              appropriate on a private LAN.
            </div>
          </details>
        </div>

        <div className="modal-foot update-foot">
          {phase === 'downloading' ? (
            <button className="btn" onClick={() => void cancel()}>
              Cancel download
            </button>
          ) : phase === 'ready' || phase === 'installing' ? (
            <button className="btn primary" disabled={phase === 'installing' || !config?.packaged} onClick={() => void install()}>
              <Icon name="download" size={14} /> Restart & install
            </button>
          ) : (
            <button className="btn primary" disabled={phase === 'checking' || !canUpdate} onClick={() => void check()}>
              Check again
            </button>
          )}
          {phase === 'available' && (
            <button className="btn primary" disabled={!canUpdate} onClick={() => void startDownload()}>
              <Icon name="download" size={14} /> Download update
            </button>
          )}
          {phase !== 'ready' && phase !== 'installing' && (
            <button className="btn" onClick={close}>
              Later
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
