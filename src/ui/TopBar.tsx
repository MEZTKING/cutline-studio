import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/store';
import { Icon } from './icons';

export function TopBar({ onImport, onExport }: { onImport: () => void; onExport: () => void }) {
  const project = useEditor((s) => s.project);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const [name, setName] = useState(project.name);
  const lastProject = useRef(project.name);

  useEffect(() => {
    if (project.name !== lastProject.current) {
      lastProject.current = project.name;
      setName(project.name);
    }
  }, [project.name]);

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <Icon name="play" size={13} />
        </div>
        <div className="brand-name">
          CUTLINE <span>STUDIO</span>
        </div>
      </div>

      <input
        className="project-name"
        value={name}
        aria-label="Project name"
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const clean = name.trim() || 'Untitled project';
          setName(clean);
          lastProject.current = clean;
          useEditor.getState().renameProject(clean);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />

      <span className="topbar-spacer" />

      <div className="btn-group">
        <button className="btn ghost icon" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
          <Icon name="undo" size={16} />
        </button>
        <button className="btn ghost icon" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
          <Icon name="redo" size={16} />
        </button>
      </div>

      <button className="btn" onClick={onImport} title="Import media">
        <Icon name="upload" size={15} />
        <span className="label">Import</span>
      </button>

      <button className="btn primary" onClick={onExport} title="Export video">
        <Icon name="download" size={15} />
        <span className="label">Export</span>
      </button>
    </header>
  );
}