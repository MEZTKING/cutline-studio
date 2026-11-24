import { useEffect, useState } from 'react';
import { useEditor } from '../state/store';
import { Icon } from './icons';

export function Toast() {
  const toast = useEditor((s) => s.toast);
  const [shown, setShown] = useState(toast);

  useEffect(() => {
    if (!toast) return;
    setShown(toast);
    const id = window.setTimeout(() => setShown(null), 4200);
    return () => window.clearTimeout(id);
  }, [toast?.id, toast]);

  if (!shown) return null;

  return (
    <div className={`toast ${shown.kind}`} role="status">
      <span className="toast-dot" />
      <span style={{ flex: 1 }}>{shown.text}</span>
      <button className="btn ghost icon sm" onClick={() => setShown(null)} aria-label="Dismiss">
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}