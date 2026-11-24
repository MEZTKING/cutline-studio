import type { MediaAsset, Project } from '../core/types';

const DB_NAME = 'cutline-studio';
const DB_VERSION = 1;
const STORE = 'workspace';
const KEY = 'current';

interface StoredAsset {
  id: string;
  name: string;
  kind: MediaAsset['kind'];
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  thumbnail?: string;
  peaks?: number[];
  file?: Blob;
}

interface StoredWorkspace {
  version: number;
  savedAt: number;
  project: Project;
  assets: StoredAsset[];
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveWorkspace(project: Project, assets: MediaAsset[]): Promise<void> {
  try {
    const db = await openDB();
    const stored: StoredWorkspace = {
      version: 1,
      savedAt: Date.now(),
      project,
      assets: assets.map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        duration: a.duration,
        width: a.width,
        height: a.height,
        hasAudio: a.hasAudio,
        thumbnail: a.thumbnail,
        peaks: a.peaks,
        file: a.file,
      })),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(stored, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    // Quota errors are the common case; don't break editing over autosave.
    console.warn('Autosave failed', err);
  }
}

export async function loadWorkspace(): Promise<{ project: Project; assets: MediaAsset[]; savedAt: number } | null> {
  try {
    const db = await openDB();
    const stored = await new Promise<StoredWorkspace | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!stored || stored.version !== 1 || !stored.project) return null;
    const assets: MediaAsset[] = stored.assets.map((a) => ({
      ...a,
      url: a.file ? URL.createObjectURL(a.file) : '',
      file: a.file,
    }));
    return { project: stored.project, assets, savedAt: stored.savedAt };
  } catch (err) {
    console.warn('Workspace restore failed', err);
    return null;
  }
}

export async function clearWorkspace(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    /* ignore */
  }
}