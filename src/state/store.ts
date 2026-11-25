import type { DesktopUpdateInfo } from '../desktop/bridge';
import { create } from 'zustand';
import {
  addTrack as addTrackModel,
  clampClipToSource,
  createProject,
  createCaptionClip,
  createTextClip,
  uid,
  defaultTransition,
  findClip,
  patchClip,
  removeClip,
  removeTrack as removeTrackModel,
  moveClipWithLinks,
  rippleDelete,
  splitAt,
  upsertKeyframe,
  removeKeyframe as removeKeyframeModel,
  propValue,
  round,
  addClip as addClipModel,
  clipEnd,
  sortedClips,
  type ActiveTransition,
} from '../core/model';
import type { AnimatableProp, CaptionSegment, Clip, MediaAsset, Project, ProjectLut, Track, TransitionType } from '../core/types';
import { COLOR_DEFAULTS, TRANSFORM_DEFAULTS } from '../core/types';

const HISTORY_LIMIT = 50;

export type MobilePanel = 'media' | 'inspector' | 'color' | null;

interface EditorState {
  project: Project;
  assets: Record<string, MediaAsset>;
  workspace: 'edit' | 'color';
  colorBypass: boolean;
  fineScrub: boolean;
  updateOpen: boolean;
  updateAvailable: DesktopUpdateInfo | null;
  queueOpen: boolean;
  assetOrder: string[];
  playhead: number;
  playing: boolean;
  selection: { clipId: string | null; trackId: string | null };
  zoom: number;
  snap: boolean;
  past: Project[];
  future: Project[];
  gestureBase: Project | null;
  gestureDirty: boolean;
  toast: { id: number; text: string; kind: 'info' | 'error' | 'success' } | null;
  importBusy: number;
  mobilePanel: MobilePanel;
  exportOpen: boolean;
  captionsOpen: boolean;
  reframeOpen: boolean;
  setWorkspace: (workspace: 'edit' | 'color') => void;
  setColorBypass: (bypass: boolean) => void;
  setFineScrub: (fine: boolean) => void;
  setUpdateOpen: (open: boolean) => void;
  setUpdateAvailable: (info: DesktopUpdateInfo | null) => void;
  setQueueOpen: (open: boolean) => void;
  addLut: (lut: ProjectLut) => string;
  removeLut: (id: string) => void;

  setProject: (p: Project, assets?: Record<string, MediaAsset>) => void;
  loadWorkspace: (project: Project, assets: MediaAsset[]) => void;
  renameProject: (name: string) => void;
  setProjectSettings: (patch: Partial<Pick<Project, 'width' | 'height' | 'fps' | 'name'>>) => void;
  matchProjectToSource: (width: number, height: number, fps?: number) => void;
  resetProject: () => void;

  addAssets: (assets: MediaAsset[]) => void;
  setAssetAudio: (assetId: string, buffer: AudioBuffer, peaks: number[]) => void;
  removeAsset: (assetId: string) => void;
  relinkAssets: (matches: { id: string; path: string; url: string }[]) => void;

  setPlayhead: (t: number) => void;
  setPlaying: (playing: boolean) => void;
  setZoom: (zoom: number) => void;
  setSnap: (snap: boolean) => void;
  select: (clipId: string | null, trackId?: string | null) => void;
  setMobilePanel: (panel: MobilePanel) => void;
  setExportOpen: (open: boolean) => void;
  setCaptionsOpen: (open: boolean) => void;
  setReframeOpen: (open: boolean) => void;
  commitProject: (project: Project) => void;
  addCaptions: (segments: CaptionSegment[]) => number;
  addCaptionAtPlayhead: () => void;
  clearCaptions: () => void;
  notify: (text: string, kind?: 'info' | 'error' | 'success') => void;

  addClipToTrack: (trackId: string, asset: MediaAsset, start: number, duration?: number) => string | null;
  addText: () => void;
  duplicateClip: (clipId: string) => void;
  liveMoveClip: (clipId: string, trackId: string, start: number) => void;
  moveClip: (clipId: string, trackId: string, start: number) => void;
  detachAudio: (clipId: string) => void;
  unlinkClip: (clipId: string) => void;
  livePatchClip: (clipId: string, patch: Partial<Clip>) => void;
  updateClip: (clipId: string, patch: Partial<Clip>, record?: boolean) => void;
  updateTrack: (trackId: string, patch: Partial<Track>) => void;
  deleteClip: (clipId: string, ripple?: boolean) => void;
  split: () => void;
  addTrack: (kind: 'video' | 'audio') => void;
  removeTrack: (trackId: string) => void;
  setTransition: (clipId: string, type: TransitionType | null, duration?: number) => void;
  getTransition: (clipId: string) => ActiveTransition | null;
  toggleKeyframe: (clipId: string, prop: AnimatableProp) => void;
  beginGesture: () => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
}

function pushHistory(past: Project[], project: Project): Project[] {
  return [...past, project].slice(-HISTORY_LIMIT);
}

function ensureCaptionTrack(project: Project): { project: Project; trackId: string; trackName: string } {
  const existing = project.tracks.find((t) => t.kind === 'video' && t.clips.some((c) => c.text?.caption));
  if (existing) {
    return {
      project: {
        ...project,
        tracks: project.tracks.map((t) =>
          t.id === existing.id ? { ...t, clips: t.clips.filter((c) => !c.text?.caption) } : t,
        ),
      },
      trackId: existing.id,
      trackName: existing.name,
    };
  }

  const used = new Set(project.tracks.map((t) => t.name));
  let name = 'CC';
  let n = 2;
  while (used.has(name)) {
    name = `CC${n}`;
    n++;
  }

  const withTrack = addTrackModel(project, 'video');
  const created = withTrack.tracks[0];
  return {
    project: {
      ...withTrack,
      tracks: withTrack.tracks.map((t) => (t.id === created.id ? { ...t, name } : t)),
    },
    trackId: created.id,
    trackName: name,
  };
}

export const useEditor = create<EditorState>((set, get) => ({
  project: createProject(),
  assets: {},
  workspace: 'edit',
  colorBypass: false,
  fineScrub: false,
  updateOpen: false,
  updateAvailable: null,
  queueOpen: false,
  assetOrder: [],
  playhead: 0,
  playing: false,
  selection: { clipId: null, trackId: null },
  zoom: 64,
  snap: true,
  past: [],
  future: [],
  gestureBase: null,
  gestureDirty: false,
  toast: null,
  importBusy: 0,
  mobilePanel: null,
  exportOpen: false,
  captionsOpen: false,
  reframeOpen: false,

  setProject: (project, assets) => set((s) => ({ project, assets: assets ?? s.assets })),
  loadWorkspace: (project, assets) =>
    set({
      project,
      assets: Object.fromEntries(assets.map((a) => [a.id, a])),
      assetOrder: assets.map((a) => a.id),
      past: [],
      future: [],
      playhead: 0,
      selection: { clipId: null, trackId: null },
      playing: false,
    }),
  renameProject: (name) => set((s) => ({ project: { ...s.project, name } })),
  setProjectSettings: (patch) =>
    set((s) => {
      const changesFormat = 'width' in patch || 'height' in patch || 'fps' in patch;
      return {
        project: { ...s.project, ...patch, ...(changesFormat ? { autoSettings: false } : {}) },
        gestureDirty: s.gestureBase ? true : s.gestureDirty,
      };
    }),
  matchProjectToSource: (width, height, fps) =>
    set((s) => {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 16 || height < 16) return s;
      const w = Math.max(16, Math.round(width / 2) * 2);
      const h = Math.max(16, Math.round(height / 2) * 2);
      const nextFps = fps && Number.isFinite(fps) && fps >= 1 && fps <= 240 ? Math.round(fps * 1000) / 1000 : s.project.fps;
      return {
        project: { ...s.project, width: w, height: h, fps: nextFps, autoSettings: true },
        past: pushHistory(s.past, s.project),
        future: [],
      };
    }),
  resetProject: () =>
    set((s) => ({
      project: createProject(s.project.name === 'Untitled project' ? 'Untitled project' : s.project.name),
      past: [],
      future: [],
      playhead: 0,
      playing: false,
      selection: { clipId: null, trackId: null },
    })),

  addAssets: (assets) =>
    set((s) => {
      const map = { ...s.assets };
      const order = [...s.assetOrder];
      for (const a of assets) {
        map[a.id] = a;
        if (!order.includes(a.id)) order.push(a.id);
      }
      return { assets: map, assetOrder: order };
    }),
  setAssetAudio: (assetId, buffer, peaks) =>
    set((s) => {
      const asset = s.assets[assetId];
      if (!asset) return s;
      return {
        assets: {
          ...s.assets,
          [assetId]: { ...asset, audioBuffer: buffer, peaks, hasAudio: true },
        },
      };
    }),
  relinkAssets: (matches) =>
    set((s) => {
      if (!matches.length) return s;
      const assets = { ...s.assets };
      for (const match of matches) {
        const current = assets[match.id];
        if (!current) continue;
        assets[match.id] = {
          ...current,
          path: match.path,
          url: match.url,
          offline: false,
          audioBuffer: undefined,
          peaks: undefined,
        };
      }
      return { assets };
    }),

  removeAsset: (assetId) =>
    set((s) => {
      const aspects = s.assets[assetId];
      if (!aspects) return s;
      URL.revokeObjectURL(aspects.url);
      const assets = { ...s.assets };
      delete assets[assetId];
      const project = {
        ...s.project,
        tracks: s.project.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.assetId !== assetId) })),
      };
      return {
        assets,
        assetOrder: s.assetOrder.filter((id) => id !== assetId),
        project,
        past: pushHistory(s.past, s.project),
        future: [],
        selection: { clipId: null, trackId: null },
      };
    }),

  setPlayhead: (t) => set({ playhead: Math.max(0, round(t, 3)) }),
  setPlaying: (playing) => set({ playing }),
  setZoom: (zoom) => set({ zoom: Math.min(400, Math.max(8, zoom)) }),
  setSnap: (snap) => set({ snap }),
  select: (clipId, trackId = null) => set({ selection: { clipId, trackId } }),
  setMobilePanel: (panel) => set({ mobilePanel: panel }),
  setExportOpen: (open) => set({ exportOpen: open }),
  setCaptionsOpen: (open) => set({ captionsOpen: open }),
  setReframeOpen: (open) => set({ reframeOpen: open }),
  setWorkspace: (workspace) => set({ workspace }),
  setColorBypass: (bypass) => set({ colorBypass: bypass }),
  setFineScrub: (fine) => set({ fineScrub: fine }),
  setUpdateOpen: (open) => set({ updateOpen: open }),
  setUpdateAvailable: (info) => set({ updateAvailable: info }),
  setQueueOpen: (open) => set({ queueOpen: open }),

  addLut: (lut) => {
    const id = uid('lut');
    set((s) => ({
      project: { ...s.project, luts: { ...(s.project.luts ?? {}), [id]: lut } },
      past: pushHistory(s.past, s.project),
      future: [],
    }));
    return id;
  },

  removeLut: (id) =>
    set((s) => {
      if (!s.project.luts?.[id]) return s;
      const luts = { ...s.project.luts };
      delete luts[id];
      const tracks = s.project.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.color.lutId === id ? { ...c, color: { ...c.color, lutId: null } } : c)),
      }));
      return {
        project: { ...s.project, tracks, luts },
        past: pushHistory(s.past, s.project),
        future: [],
      };
    }),

  commitProject: (project) =>
    set((s) => ({
      project,
      past: pushHistory(s.past, s.project),
      future: [],
      playing: false,
      selection: validateSelection(project, s.selection),
    })),

  addCaptions: (segments) => {
    const state = get();
    const ensured = ensureCaptionTrack(state.project);
    const trackId = ensured.trackId;
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    const clips: Clip[] = [];
    let cursor = 0;
    for (const seg of sorted) {
      const text = seg.text.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const start = Math.max(0, round(seg.start), cursor);
      const end = Math.max(start + 0.3, seg.end);
      const clip = createCaptionClip(start, Math.min(30, end - start), text);
      clips.push(clip);
      cursor = clip.start + clip.duration + 0.01;
    }
    if (!clips.length) {
      state.notify('No speech found in the audio.', 'error');
      return 0;
    }
    const project: Project = {
      ...ensured.project,
      tracks: ensured.project.tracks.map((t) =>
        t.id === trackId ? { ...t, clips: sortedClips({ ...t, clips: [...t.clips, ...clips] }) } : t,
      ),
    };
    set({
      project,
      past: pushHistory(state.past, state.project),
      future: [],
      selection: { clipId: clips[0].id, trackId },
      captionsOpen: false,
    });
    const shown = ensured.trackName ? ` on ${ensured.trackName}` : '';
    state.notify(`Added ${clips.length} caption${clips.length === 1 ? '' : 's'}${shown}`, 'success');
    return clips.length;
  },

  addCaptionAtPlayhead: () => {
    const state = get();
    const ensured = ensureCaptionTrack(state.project);
    const clip = createCaptionClip(state.playhead, 3, 'New caption');
    const project: Project = {
      ...ensured.project,
      tracks: ensured.project.tracks.map((t) =>
        t.id === ensured.trackId ? { ...t, clips: sortedClips({ ...t, clips: [...t.clips, clip] }) } : t,
      ),
    };
    set({
      project,
      past: pushHistory(state.past, state.project),
      future: [],
      selection: { clipId: clip.id, trackId: ensured.trackId },
      captionsOpen: false,
      mobilePanel: 'inspector',
    });
  },

  clearCaptions: () => {
    const state = get();
    const has = state.project.tracks.some((t) => t.clips.some((c) => c.text?.caption));
    if (!has) return;
    const tracks = state.project.tracks
      .map((t) => ({ ...t, clips: t.clips.filter((c) => !c.text?.caption) }))
      .filter((t) => !(t.kind === 'video' && t.clips.length === 0 && /^CC/.test(t.name)));
    const selection = state.project.tracks.some((t) => t.clips.some((c) => c.id === state.selection.clipId && c.text?.caption))
      ? { clipId: null, trackId: null }
      : state.selection;
    set({
      project: { ...state.project, tracks },
      past: pushHistory(state.past, state.project),
      future: [],
      selection,
    });
    state.notify('Captions cleared', 'info');
  },
  notify: (text, kind = 'info') => set({ toast: { id: Date.now(), text, kind } }),

  addClipToTrack: (trackId, asset, start, duration) => {
    const state = get();
    const { project, clip } = addClipModel(state.project, trackId, asset, Math.max(0, start), { duration });
    const real = findClip(project, clip.id);
    if (!real) return null;
    set({
      project,
      past: pushHistory(state.past, state.project),
      future: [],
      selection: { clipId: clip.id, trackId },
    });
    return clip.id;
  },

  addText: () => {
    const state = get();
    const playhead = state.playhead;
    const isFreeAt = (track: Track) =>
      !track.clips.some((c) => playhead >= c.start - 1e-6 && playhead < clipEnd(c) - 1e-6);

    let project = state.project;
    let track = project.tracks.find((t) => t.kind === 'video' && !t.locked && isFreeAt(t)) ?? null;

    if (!track) {
      project = addTrackModel(project, 'video');
      track = project.tracks.find((t) => t.kind === 'video' && !state.project.tracks.some((old) => old.id === t.id)) ?? project.tracks[0] ?? null;
    }
    if (!track) {
      state.notify('Add a video track before adding a title.', 'error');
      return;
    }

    const clip = createTextClip(playhead);
    const targetId = track.id;
    const next = {
      ...project,
      tracks: project.tracks.map((t) =>
        t.id === targetId ? { ...t, clips: [...t.clips, clip].sort((a, b) => a.start - b.start) } : t,
      ),
    };
    set({
      project: next,
      past: pushHistory(state.past, state.project),
      future: [],
      selection: { clipId: clip.id, trackId: targetId },
      mobilePanel: 'inspector',
    });
  },

  duplicateClip: (clipId) => {
    const state = get();
    const found = findClip(state.project, clipId);
    if (!found) return;
    const original = found.clip;
    const copy: Clip = {
      ...original,
      id: uid('clp'),
      start: round(clipEnd(original)),
      transform: { ...original.transform },
      color: { ...original.color },
      keyframes: Object.fromEntries(Object.entries(original.keyframes).map(([k, v]) => [k, v ? v.map((kf) => ({ ...kf })) : v])) as Clip['keyframes'],
      transition: null,
      text: original.text ? { ...original.text } : undefined,
    };
    const next = {
      ...state.project,
      tracks: state.project.tracks.map((t) =>
        t.id === found.track.id ? { ...t, clips: [...t.clips, copy].sort((a, b) => a.start - b.start) } : t,
      ),
    };
    set({
      project: next,
      past: pushHistory(state.past, state.project),
      future: [],
      selection: { clipId: copy.id, trackId: found.track.id },
    });
  },

  liveMoveClip: (clipId, trackId, start) =>
    set((s) => {
      const next = moveClipWithLinks(s.project, clipId, trackId, Math.max(0, start));
      if (next === s.project) return s;
      return { project: next, gestureDirty: true };
    }),

  moveClip: (clipId, trackId, start) =>
    set((s) => {
      const next = moveClipWithLinks(s.project, clipId, trackId, start);
      if (next === s.project) return s;
      return { project: next, past: pushHistory(s.past, s.project), future: [] };
    }),

  detachAudio: (clipId) =>
    set((s) => {
      const found = findClip(s.project, clipId);
      if (!found || found.clip.audioDetached || found.track.kind !== 'video' || found.clip.text) return s;
      const asset = s.assets[found.clip.assetId];
      if (!asset?.hasAudio) return s;
      let project = s.project;
      let audioTrack = project.tracks.find((t) => t.kind === 'audio' && !t.locked);
      if (!audioTrack) {
        project = addTrackModel(project, 'audio');
        audioTrack = project.tracks.find((t) => t.kind === 'audio');
      }
      if (!audioTrack) return s;
      const linkId = uid('lnk');
      const audioClip: Clip = {
        ...found.clip,
        id: uid('clp'),
        name: `${found.clip.name} (audio)`,
        linkId,
        muted: false,
        audioDetached: undefined,
        transition: null,
        text: undefined,
        fill: undefined,
      };
      project = patchClip(project, found.clip.id, { linkId, audioDetached: true, muted: true });
      project = {
        ...project,
        tracks: project.tracks.map((t) =>
          t.id === audioTrack.id ? { ...t, clips: sortedClips({ ...t, clips: [...t.clips, audioClip] }) } : t,
        ),
      };
      return {
        project,
        past: pushHistory(s.past, s.project),
        future: [],
        selection: { clipId: audioClip.id, trackId: audioTrack.id },
      };
    }),

  unlinkClip: (clipId) =>
    set((s) => {
      const found = findClip(s.project, clipId);
      const linkId = found?.clip.linkId;
      if (!linkId) return s;
      return {
        project: {
          ...s.project,
          tracks: s.project.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) => (c.linkId === linkId ? { ...c, linkId: undefined } : c)),
          })),
        },
        past: pushHistory(s.past, s.project),
        future: [],
      };
    }),

  livePatchClip: (clipId, patch) =>
    set((s) => {
      const found = findClip(s.project, clipId);
      if (!found) return s;
      let merged = { ...found.clip, ...patch };
      if (patch.transform) merged.transform = { ...found.clip.transform, ...patch.transform };
      const asset = s.assets[merged.assetId];
      if (asset) merged = clampClipToSource(merged, asset);
      const next = patchClip(s.project, clipId, merged);
      return { project: next, gestureDirty: true };
    }),

  updateClip: (clipId, patch, record = true) =>
    set((s) => {
      const found = findClip(s.project, clipId);
      if (!found) return s;
      let merged = { ...found.clip, ...patch };
      if (patch.transform) merged.transform = { ...found.clip.transform, ...patch.transform };
      const asset = s.assets[merged.assetId];
      if (asset) merged = clampClipToSource(merged, asset);
      const next = patchClip(s.project, clipId, merged);
      return {
        project: next,
        past: record ? pushHistory(s.past, s.project) : s.past,
        future: record ? [] : s.future,
      };
    }),

  updateTrack: (trackId, patch) =>
    set((s) => ({
      project: { ...s.project, tracks: s.project.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)) },
      past: pushHistory(s.past, s.project),
      future: [],
    })),

  deleteClip: (clipId, ripple = false) =>
    set((s) => {
      const next = ripple ? rippleDelete(s.project, clipId) : removeClip(s.project, clipId);
      return {
        project: next,
        selection: { clipId: null, trackId: null },
        past: pushHistory(s.past, s.project),
        future: [],
      };
    }),

  split: () =>
    set((s) => {
      const t = s.playhead;
      const selected = s.selection.clipId ? findClip(s.project, s.selection.clipId) : null;
      const insideSelected = selected && t > selected.clip.start + 0.02 && t < clipEnd(selected.clip) - 0.02;
      const next = splitAt(s.project, t, insideSelected ? selected!.clip.id : undefined);
      if (next === s.project) {
        get().notify('Place the playhead inside a clip to split.', 'error');
        return s;
      }
      return { project: next, past: pushHistory(s.past, s.project), future: [] };
    }),

  addTrack: (kind) =>
    set((s) => ({
      project: addTrackModel(s.project, kind),
      past: pushHistory(s.past, s.project),
      future: [],
    })),

  removeTrack: (trackId) =>
    set((s) => ({
      project: removeTrackModel(s.project, trackId),
      past: pushHistory(s.past, s.project),
      future: [],
      selection: { clipId: null, trackId: null },
    })),

  setTransition: (clipId, type, duration = 0.6) =>
    set((s) => {
      const found = findClip(s.project, clipId);
      if (!found) return s;
      const transition = type ? { ...defaultTransition(type), duration } : null;
      return {
        project: patchClip(s.project, clipId, { transition }),
        past: pushHistory(s.past, s.project),
        future: [],
      };
    }),

  getTransition: (clipId) => {
    const s = get();
    const found = findClip(s.project, clipId);
    if (!found) return null;
    const tr = found.clip.transition;
    if (!tr) return null;
    // Transition presence is validated by the compositor.
    return { type: tr.type, duration: tr.duration, progress: 0, from: found.clip, to: found.clip };
  },

  toggleKeyframe: (clipId, prop) =>
    set((s) => {
      const found = findClip(s.project, clipId);
      if (!found) return s;
      const { clip } = found;
      const localT = Math.max(0, s.playhead - clip.start);
      const existing = (clip.keyframes[prop] ?? []).some((k) => Math.abs(k.t - localT) < 0.02);
      const keyframes = existing
        ? removeKeyframeModel(clip, prop, localT)
        : upsertKeyframe(clip, prop, localT, propValue(clip, prop, localT));
      return {
        project: patchClip(s.project, clipId, { keyframes }),
        past: pushHistory(s.past, s.project),
        future: [],
      };
    }),

  beginGesture: () => set((s) => ({ gestureBase: s.project, gestureDirty: false })),
  endGesture: () =>
    set((s) => {
      if (!s.gestureBase) return { gestureBase: null, gestureDirty: false };
      if (!s.gestureDirty) return { gestureBase: null, gestureDirty: false };
      return {
        past: pushHistory(s.past, s.gestureBase),
        future: [],
        gestureBase: null,
        gestureDirty: false,
      };
    }),

  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return {
        project: prev,
        past: s.past.slice(0, -1),
        future: [s.project, ...s.future].slice(0, HISTORY_LIMIT),
        playing: false,
        selection: validateSelection(prev, s.selection),
      };
    }),

  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return s;
      return {
        project: next,
        past: pushHistory(s.past, s.project),
        future: s.future.slice(1),
        playing: false,
        selection: validateSelection(next, s.selection),
      };
    }),
}));

function validateSelection(project: Project, selection: { clipId: string | null; trackId: string | null }) {
  if (!selection.clipId) return selection;
  const found = findClip(project, selection.clipId);
  return found ? selection : { clipId: null, trackId: null };
}

export function resetClipVisuals(clip: Clip): Clip {
  return {
    ...clip,
    transform: { ...TRANSFORM_DEFAULTS },
    color: {
      ...COLOR_DEFAULTS,
      lift: { ...(COLOR_DEFAULTS.lift ?? { x: 0, y: 0, master: 0 }) },
      gamma: { ...(COLOR_DEFAULTS.gamma ?? { x: 0, y: 0, master: 0 }) },
      gain: { ...(COLOR_DEFAULTS.gain ?? { x: 0, y: 0, master: 0 }) },
    },
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    fadeCurve: 'linear',
    pan: 0,
    eqLow: 0,
    eqMid: 0,
    eqHigh: 0,
    compress: 0,
    muted: false,
    audioType: null,
    keyframes: {},
  };
}

export { clipEnd };