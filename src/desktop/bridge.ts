import type { MediaAsset, Project } from '../core/types';

export interface DesktopMediaEntry {
  path: string;
  url: string;
  name: string;
}

export interface DesktopAssetRecord {
  id: string;
  name: string;
  kind: MediaAsset['kind'];
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  path?: string;
  thumbnail?: string;
  peaks?: number[];
}

export interface DesktopProjectData {
  format: 'cutline-project';
  version: 1;
  savedAt?: number;
  project: Project;
  assets: DesktopAssetRecord[];
}

export interface DesktopStartup {
  source: 'file' | 'autosave' | 'blank';
  path: string | null;
  data: DesktopProjectData | null;
}

export interface DesktopInfo {
  version: string;
  platform: string;
  isPackaged: boolean;
  ffmpeg: string | null;
  userData: string;
  projectPath: string | null;
}

export type DesktopMenuCommand =
  | 'new-project'
  | 'open-project'
  | 'save-project'
  | 'save-project-as'
  | 'import-media'
  | 'export'
  | 'undo'
  | 'redo'
  | 'project-settings';

export interface NativeExportPayload {
  data: ArrayBuffer;
  inputExtension: 'mp4' | 'webm';
  suggestedName: string;
  codec: 'h264' | 'hevc' | 'prores';
  quality: 'fast' | 'balanced' | 'high';
  durationSeconds: number;
  outputPath?: string;
}

export interface NativeExportResult {
  ok: boolean;
  path?: string;
  size?: number;
  error?: string;
  canceled?: boolean;
}

export interface CutlineDesktopApi {
  isDesktop: true;
  platform: string;
  info(): Promise<DesktopInfo>;
  startup(): Promise<DesktopStartup>;
  pickMedia(): Promise<DesktopMediaEntry[]>;
  registerMedia(paths: string[]): Promise<DesktopMediaEntry[]>;
  pathForFile(file: File): string;
  openProject(): Promise<{ path: string; data: DesktopProjectData } | { error: string } | null>;
  newProject(): Promise<{ ok: boolean }>;
  openProjectPath(path: string): Promise<{ path: string; data: DesktopProjectData } | { error: string } | null>;
  saveProject(data: DesktopProjectData, options?: { saveAs?: boolean }): Promise<{ path: string } | { error: string } | null>;
  saveProjectTo(data: DesktopProjectData, path: string): Promise<{ path: string } | { error: string }>;
  autosave(data: DesktopProjectData): Promise<{ ok: boolean }>;
  extractAudio(path: string): Promise<{ ok: boolean; wav?: ArrayBuffer; error?: string }>;
  transcode(payload: NativeExportPayload): Promise<NativeExportResult>;
  title(title: string): Promise<void>;
  showItem(path: string): Promise<void>;
  onMenuCommand(callback: (command: DesktopMenuCommand) => void): () => void;
  onExportProgress(callback: (progress: { percent: number; detail?: string }) => void): () => void;
}

declare global {
  interface Window {
    cutlineDesktop?: CutlineDesktopApi;
  }
}

export const desktop: CutlineDesktopApi | undefined = typeof window !== 'undefined' ? window.cutlineDesktop : undefined;
export const isDesktop = Boolean(desktop?.isDesktop);

export function mediaUrlForPath(filePath: string): string {
  const bytes = new TextEncoder().encode(filePath);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `cutline-media://file/${encoded}`;
}

export function serializeProjectForDesktop(
  project: Project,
  assets: Record<string, MediaAsset>,
): DesktopProjectData {
  const records: DesktopAssetRecord[] = [];
  for (const asset of Object.values(assets)) {
    if (!asset.path) continue;
    records.push({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      duration: asset.duration,
      width: asset.width,
      height: asset.height,
      hasAudio: asset.hasAudio,
      path: asset.path,
      thumbnail: asset.thumbnail,
      peaks: asset.peaks,
    });
  }
  return { format: 'cutline-project', version: 1, savedAt: Date.now(), project, assets: records };
}

export async function hydrateDesktopProject(
  data: DesktopProjectData,
  api: CutlineDesktopApi = desktop!,
): Promise<{ project: Project; assets: MediaAsset[] }> {
  const records = Array.isArray(data.assets) ? data.assets : [];
  const paths = records.map((record) => record.path).filter((p): p is string => Boolean(p));
  const registered = paths.length ? await api.registerMedia(paths) : [];
  const urlByPath = new Map(registered.map((entry) => [entry.path, entry.url]));
  const assets: MediaAsset[] = records.map((record) => ({
    ...record,
    url: record.path ? urlByPath.get(record.path) ?? mediaUrlForPath(record.path) : '',
  }));
  return { project: data.project, assets };
}
