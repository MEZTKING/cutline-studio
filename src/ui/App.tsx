import { useEffect, useRef, useState } from 'react';
import { projectDuration } from '../core/model';
import { getAudioEngine } from '../audio/engine';
import { preferredTrack } from '../core/placement';
import type { MediaAsset } from '../core/types';
import { importFile, importNative } from '../media/import';
import {
  desktop,
  hydrateDesktopProject,
  isDesktop,
  serializeProjectForDesktop,
  type DesktopMediaEntry,
} from '../desktop/bridge';
import { loadWorkspace, saveWorkspace } from '../persistence/db';
import { useEditor } from '../state/store';
import { AutoReframeDialog } from './AutoReframeDialog';
import { CaptionsDialog } from './CaptionsDialog';
import { ColorWorkspace } from './ColorWorkspace';
import { ExportDialog } from './ExportDialog';
import { Icon } from './icons';
import { Inspector } from './Inspector';
import { MediaBin } from './MediaBin';
import { Preview, Transport } from './Preview';
import { Timeline } from './Timeline';
import { Toast } from './Toast';
import { TopBar } from './TopBar';
import { UpdatesDialog } from './UpdatesDialog';

function useIsMobile(): boolean {
  const query = '(max-width: 980px)';
  const [mobile, setMobile] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMobile(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return mobile;
}

function togglePlay(): void {
  const state = useEditor.getState();
  if (state.playing) {
    state.setPlaying(false);
    return;
  }
  const total = projectDuration(state.project);
  if (total <= 0.01) return;
  if (state.playhead >= total - 0.01) state.setPlayhead(0);
  // Resume inside the user gesture so mobile browsers unlock audio reliably.
  void getAudioEngine().context.resume().catch(() => undefined);
  state.setPlaying(true);
}

export function App() {
  const [booted, setBooted] = useState(false);
  const [busy, setBusy] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  const mobilePanel = useEditor((s) => s.mobilePanel);
  const setMobilePanel = useEditor((s) => s.setMobilePanel);
  const assetCount = useEditor((s) => s.assetOrder.length);
  const setExportOpen = useEditor((s) => s.setExportOpen);
  const workspace = useEditor((s) => s.workspace);
  const setWorkspace = useEditor((s) => s.setWorkspace);

  useEffect(() => {
    let alive = true;

    const boot = async () => {
      if (isDesktop && desktop) {
        try {
          const start = await desktop.startup();
          if (!alive) return;
          if (start.data?.project) {
            const hydrated = await hydrateDesktopProject(start.data);
            if (!alive) return;
            useEditor.getState().loadWorkspace(hydrated.project, hydrated.assets);
            const label = start.source === 'autosave' ? 'Recovered your autosave' : `Opened ${start.path?.split(/[\\/]/).pop() ?? 'project'}`;
            window.setTimeout(() => useEditor.getState().notify(label, 'success'), 500);
          }
        } catch (err) {
          useEditor.getState().notify(`Desktop project could not be restored: ${err instanceof Error ? err.message : String(err)}`, 'error');
        } finally {
          if (alive) setBooted(true);
        }
        return;
      }

      try {
        const ws = await loadWorkspace();
        if (!alive) return;
        if (ws && ws.project) {
          useEditor.getState().loadWorkspace(ws.project, ws.assets);
          if (ws.assets.length > 0) {
            window.setTimeout(() => {
              useEditor.getState().notify(`Restored your last session · ${ws.assets.length} media item(s)`, 'success');
            }, 500);
          }
        }
      } finally {
        if (alive) setBooted(true);
      }
    };

    void boot();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!booted) return;
    let timer = 0;
    const persist = () => {
      const s = useEditor.getState();
      if (isDesktop && desktop) {
        void desktop.autosave(serializeProjectForDesktop(s.project, s.assets));
        return;
      }
      const list = s.assetOrder.map((id) => s.assets[id]).filter(Boolean);
      void saveWorkspace(s.project, list);
    };
    const unsub = useEditor.subscribe((state, prev) => {
      if (state.project === prev.project && state.assets === prev.assets) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(persist, 900);
    });
    const onHide = () => persist();
    window.addEventListener('pagehide', onHide);
    return () => {
      unsub();
      window.clearTimeout(timer);
      window.removeEventListener('pagehide', onHide);
    };
  }, [booted]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (useEditor.getState().exportOpen) return;

      const state = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;

      if (mod && (key === 'z' || key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (mod && (key === 'y' || key === 'Y')) {
        e.preventDefault();
        state.redo();
        return;
      }
      if (mod && (key === 'k' || key === 'K')) {
        e.preventDefault();
        state.split();
        return;
      }
      if (mod && (key === 'd' || key === 'D')) {
        e.preventDefault();
        if (state.selection.clipId) state.duplicateClip(state.selection.clipId);
        return;
      }

      switch (key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 's':
        case 'S':
          state.split();
          break;
        case 't':
        case 'T':
          state.addText();
          break;
        case 'c':
        case 'C':
          state.setCaptionsOpen(true);
          break;
        case 'r':
        case 'R':
          state.setReframeOpen(true);
          break;
        case 'f':
        case 'F':
          state.setFineScrub(!state.fineScrub);
          break;
        case 'Delete':
        case 'Backspace':
          if (state.selection.clipId) {
            e.preventDefault();
            state.deleteClip(state.selection.clipId, e.shiftKey);
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          state.setPlaying(false);
          state.setPlayhead(Math.max(0, state.playhead - (e.shiftKey ? 1 : 1 / state.project.fps)));
          break;
        case 'ArrowRight':
          e.preventDefault();
          state.setPlaying(false);
          state.setPlayhead(state.playhead + (e.shiftKey ? 1 : 1 / state.project.fps));
          break;
        case 'Home':
          e.preventDefault();
          state.setPlaying(false);
          state.setPlayhead(0);
          break;
        case 'End':
          e.preventDefault();
          state.setPlaying(false);
          state.setPlayhead(projectDuration(state.project));
          break;
        case '+':
        case '=':
          state.setZoom(state.zoom * 1.3);
          break;
        case '-':
        case '_':
          state.setZoom(state.zoom / 1.3);
          break;
        case 'Escape':
          if (state.mobilePanel) state.setMobilePanel(null);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const placeImported = (imported: MediaAsset[]) => {
    const state = useEditor.getState();
    const empty = state.project.tracks.every((t) => t.clips.length === 0);
    if (!empty) return;
    let videoTime = 0;
    let audioTime = 0;
    for (const asset of imported) {
      const track = preferredTrack(useEditor.getState().project, asset.kind);
      if (!track) continue;
      const duration = asset.kind === 'image' ? 5 : asset.duration;
      if (asset.kind === 'audio') {
        useEditor.getState().addClipToTrack(track.id, asset, audioTime, duration);
        audioTime += duration;
      } else {
        useEditor.getState().addClipToTrack(track.id, asset, videoTime, duration);
        videoTime += duration;
      }
    }
  };

  const importFiles = async (files: File[]) => {
    const list = files.filter((f) => f.size > 0);
    if (!list.length) return;
    const state = useEditor.getState();
    if (state.playing) state.setPlaying(false);
    setBusy((b) => b + 1);
    state.notify(`Importing ${list.length} item${list.length === 1 ? '' : 's'}…`);

    const imported: MediaAsset[] = [];
    const errors: string[] = [];
    for (const file of list) {
      try {
        imported.push(await importFile(file));
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    if (imported.length) {
      useEditor.getState().addAssets(imported);
      placeImported(imported);
    }
    setBusy((b) => Math.max(0, b - 1));
    if (errors.length) {
      useEditor.getState().notify(errors[0], 'error');
    } else if (imported.length) {
      useEditor.getState().notify(`Imported ${imported.length} item${imported.length === 1 ? '' : 's'}`, 'success');
    }
  };

  async function importNativeEntries(entries: DesktopMediaEntry[]) {
    if (!entries.length) return;
    const state = useEditor.getState();
    if (state.playing) state.setPlaying(false);
    setBusy((b) => b + 1);
    state.notify(`Importing ${entries.length} file${entries.length === 1 ? '' : 's'} from disk…`);
    const imported: MediaAsset[] = [];
    const errors: string[] = [];
    for (const entry of entries) {
      try {
        imported.push(await importNative(entry));
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    if (imported.length) {
      useEditor.getState().addAssets(imported);
      placeImported(imported);
    }
    setBusy((b) => Math.max(0, b - 1));
    if (errors.length) useEditor.getState().notify(errors[0], 'error');
    else if (imported.length) useEditor.getState().notify(`Imported ${imported.length} file${imported.length === 1 ? '' : 's'}`, 'success');
  }

  async function pickDesktopMedia() {
    if (!desktop) return;
    const entries = await desktop.pickMedia();
    await importNativeEntries(entries);
  }

  async function saveDesktop(saveAs = false) {
    if (!desktop) return;
    const state = useEditor.getState();
    const data = serializeProjectForDesktop(state.project, state.assets);
    const result = await desktop.saveProject(data, { saveAs });
    if (!result) return;
    if ('error' in result) {
      state.notify(result.error, 'error');
      return;
    }
    state.notify(`Saved to ${result.path}`, 'success');
    void desktop.title(state.project.name);
  }

  async function openDesktopProject(filePath?: string) {
    if (!desktop) return;
    const result = filePath ? await desktop.openProjectPath(filePath) : await desktop.openProject();
    if (!result) return;
    if ('error' in result) {
      useEditor.getState().notify(result.error, 'error');
      return;
    }
    const hydrated = await hydrateDesktopProject(result.data);
    useEditor.getState().loadWorkspace(hydrated.project, hydrated.assets);
    useEditor.getState().notify(`Opened ${hydrated.project.name}`, 'success');
    void desktop.title(hydrated.project.name);
  }

  const openPicker = () => {
    if (isDesktop && desktop) {
      void pickDesktopMedia();
      return;
    }
    fileInput.current?.click();
  };

  useEffect(() => {
    if (!isDesktop || !desktop) return;
    return desktop.onMenuCommand((command) => {
      const state = useEditor.getState();
      switch (command) {
        case 'new-project':
          if (confirm('Start a new project? The current timeline clears; media stays in the bin.')) {
            state.resetProject();
            state.setPlayhead(0);
            void desktop?.newProject();
          }
          break;
        case 'open-project':
          void openDesktopProject();
          break;
        case 'save-project':
          void saveDesktop(false);
          break;
        case 'save-project-as':
          void saveDesktop(true);
          break;
        case 'import-media':
          void pickDesktopMedia();
          break;
        case 'export':
          state.setExportOpen(true);
          break;
        case 'project-settings':
          state.select(null, null);
          state.setWorkspace('edit');
          state.setMobilePanel('inspector');
          break;
        case 'undo':
          state.undo();
          break;
        case 'redo':
          state.redo();
          break;
        case 'check-updates':
          state.setUpdateOpen(true);
          break;
        default:
          break;
      }
    });
  }, []);

  useEffect(() => {
    if (!isDesktop || !desktop) return;
    return desktop.onUpdateAvailable((info) => {
      useEditor.getState().setUpdateAvailable(info);
      useEditor.getState().notify(`Update ${info.version} available`, 'info');
    });
  }, []);

  useEffect(() => {
    if (!isDesktop || !desktop) return;
    const api = {
      importPaths: async (paths: string[]) => {
        const entries = await desktop!.registerMedia(paths);
        await importNativeEntries(entries);
        return entries;
      },
      saveTo: async (target: string) => {
        const state = useEditor.getState();
        return desktop!.saveProjectTo(serializeProjectForDesktop(state.project, state.assets), target);
      },
      openPath: async (target: string) => {
        await openDesktopProject(target);
      },
      getProject: () => useEditor.getState().project,
    };
    (window as unknown as { __cutlineDesktop: typeof api }).__cutlineDesktop = api;
    return () => {
      delete (window as unknown as { __cutlineDesktop?: typeof api }).__cutlineDesktop;
    };
  }, []);

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  if (!booted) {
    return (
      <div className="splash">
        <div className="splash-inner">
          <div className="brand-mark" style={{ width: 42, height: 42, borderRadius: 12 }}>
            <Icon name="play" size={19} />
          </div>
          <div style={{ fontWeight: 800, letterSpacing: '0.18em', fontSize: 12 }}>
            CUTLINE <span style={{ color: 'var(--accent)' }}>STUDIO</span>
          </div>
          <div className="spinner" />
          <div className="hint">Restoring your session…</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="app"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragOver(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (isDesktop && desktop) {
          const paths = files.map((file) => desktop!.pathForFile(file)).filter(Boolean);
          if (paths.length === files.length) {
            void (async () => {
              const entries = await desktop!.registerMedia(paths);
              await importNativeEntries(entries);
            })();
            return;
          }
        }
        void importFiles(files);
      }}
    >
      <TopBar onImport={openPicker} onExport={() => setExportOpen(true)} onSave={isDesktop ? () => void saveDesktop(false) : undefined} />

      <div className="workspace">
        {!isMobile && (
          <aside className="panel">
            <MediaBin onImport={openPicker} />
          </aside>
        )}

        <section className="stage">
          <Preview onImport={openPicker} />
          <Transport />
        </section>

        {!isMobile && (
          <aside className="panel inspector">
            {workspace === 'color' ? <ColorWorkspace /> : <Inspector />}
          </aside>
        )}
      </div>

      <Timeline />

      {isMobile && (
        <nav className="mobile-tabs">
          <button
            className={`tab ${mobilePanel === 'media' ? 'active' : ''}`}
            onClick={() => setMobilePanel(mobilePanel === 'media' ? null : 'media')}
          >
            <Icon name="film" size={18} />
            <span>Media</span>
            {assetCount > 0 && <span className="badge">{assetCount}</span>}
          </button>
          <button
            className={`tab ${mobilePanel === 'inspector' ? 'active' : ''}`}
            onClick={() => {
              setWorkspace('edit');
              setMobilePanel(mobilePanel === 'inspector' ? null : 'inspector');
            }}
          >
            <Icon name="settings" size={18} />
            <span>Edit</span>
          </button>
          <button
            className={`tab ${mobilePanel === 'color' ? 'active' : ''}`}
            onClick={() => {
              setWorkspace('color');
              setMobilePanel(mobilePanel === 'color' ? null : 'color');
            }}
          >
            <Icon name="palette" size={18} />
            <span>Color</span>
          </button>
          <button
            className="tab"
            onClick={() => {
              setMobilePanel(null);
              setExportOpen(true);
            }}
          >
            <Icon name="download" size={18} />
            <span>Export</span>
          </button>
        </nav>
      )}

      {isMobile && mobilePanel && (
        <div className={`sheet ${mobilePanel === 'color' ? 'color-sheet' : ''}`}>
          <div className="sheet-head">
            <span>{mobilePanel === 'media' ? 'Media library' : mobilePanel === 'color' ? 'Color' : 'Inspector'}</span>
            <button className="btn ghost icon" onClick={() => setMobilePanel(null)} aria-label="Close panel">
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="sheet-scroll">
            {mobilePanel === 'media' ? (
              <MediaBin showHead={false} onImport={openPicker} />
            ) : mobilePanel === 'color' ? (
              <ColorWorkspace showHead={false} />
            ) : (
              <Inspector showHead={false} />
            )}
          </div>
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        multiple
        accept="video/*,audio/*,image/*,.mkv,.mov,.m4v,.webm"
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void importFiles(files);
        }}
      />

      {dragOver && (
        <div className="drop-overlay">
          <div className="drop-card">
            <Icon name="upload" size={26} style={{ marginBottom: 8 }} />
            Drop to import
            <small>Video, audio, and images stay on your device</small>
          </div>
        </div>
      )}

      {busy > 0 && (
        <div className="busy-pill">
          <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
          Importing… on-device
        </div>
      )}

      <UpdatesDialog />
      <ExportDialog />
      <CaptionsDialog />
      <AutoReframeDialog />
      <Toast />
    </div>
  );
}