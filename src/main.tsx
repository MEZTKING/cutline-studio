import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { useEditor } from './state/store';
import './styles.css';

// Exposed for power users and automated tests: inspect or drive the editor.
(window as unknown as { __cutline: typeof useEditor }).__cutline = useEditor;

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

createRoot(root).render(<App />);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}