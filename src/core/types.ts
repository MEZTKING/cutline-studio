/**
 * Cutline Studio — core project model.
 * A project is a pure, serialisable document. Media buffers live outside it.
 */

export type MediaKind = 'video' | 'audio' | 'image';

export interface MediaAsset {
  id: string;
  name: string;
  kind: MediaKind;
  /** Source duration in seconds. Images get a nominal 10s. */
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  url: string;
  /** Absolute path when running inside the desktop shell. */
  path?: string;
  file?: File | Blob;
  thumbnail?: string;
  /** Decoded audio, kept in memory only. */
  audioBuffer?: AudioBuffer;
  peaks?: number[];
}

export interface Keyframe {
  /** Seconds from clip start. */
  t: number;
  v: number;
}

export type AnimatableProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume';

export interface Transform {
  /** Horizontal offset as a fraction of frame width (-0.5 .. 0.5 is a half-frame). */
  x: number;
  y: number;
  /** 1 = fit the frame, >1 zooms in. */
  scale: number;
  rotation: number;
  opacity: number;
}

export interface ColorWheel {
  /** Puck position inside the colour wheel, -1..1 within a unit circle. */
  x: number;
  y: number;
  /** Overall luminance offset, -0.5..0.5. */
  master: number;
}

export interface ProjectLut {
  name: string;
  /** Cube edge length (17, 33, ...). */
  size: number;
  /** RGB floats, 0..1, red changing fastest. */
  data: number[];
  domainMin?: [number, number, number];
  domainMax?: [number, number, number];
}

export interface ColorGrade {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  blur: number;
  temperature: number;
  vignette: number;
  lift?: ColorWheel;
  gamma?: ColorWheel;
  gain?: ColorWheel;
  lutId?: string | null;
  /** 0..1 blend between the original and the LUT. */
  lutMix?: number;
}

export type TransitionType =
  | 'dissolve'
  | 'dip-black'
  | 'dip-white'
  | 'wipe-left'
  | 'wipe-right'
  | 'wipe-up'
  | 'wipe-down'
  | 'slide-left'
  | 'slide-right'
  | 'iris';

export interface Transition {
  type: TransitionType;
  duration: number;
}

export interface TextStyle {
  content: string;
  /** Caption cues are styled and placed as subtitles rather than free titles. */
  caption?: boolean;
  /** Font size as a percentage of frame height. */
  size: number;
  color: string;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  shadow: boolean;
  background: string;
  /** 0..1 */
  backgroundOpacity: number;
  /** Padding as a percentage of frame height. */
  padding: number;
}

export interface Clip {
  id: string;
  assetId: string;
  name: string;
  /** Timeline start in seconds. */
  start: number;
  /** Timeline duration in seconds. */
  duration: number;
  /** Source in-point in seconds. */
  inPoint: number;
  speed: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  transform: Transform;
  color: ColorGrade;
  /** Incoming transition; overlaps the previous clip on the same track. */
  transition?: Transition | null;
  keyframes: Partial<Record<AnimatableProp, Keyframe[]>>;
  /** When true, scale 1 covers the frame (crops) instead of fitting inside it. */
  fill?: boolean;
  /** Present on title clips; they need no media asset. */
  text?: TextStyle;
}

export type TrackKind = 'video' | 'audio';

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  clips: Clip[];
}

export interface Project {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  tracks: Track[];
  /** Imported and built-in 3D LUTs referenced by clips. */
  luts?: Record<string, ProjectLut>;
}

export interface CaptionSegment {
  /** Timeline seconds. */
  start: number;
  end: number;
  text: string;
}

export const TRANSITION_LABEL: Record<TransitionType, string> = {
  dissolve: 'Cross dissolve',
  'dip-black': 'Dip to black',
  'dip-white': 'Dip to white',
  'wipe-left': 'Wipe left',
  'wipe-right': 'Wipe right',
  'wipe-up': 'Wipe up',
  'wipe-down': 'Wipe down',
  'slide-left': 'Slide left',
  'slide-right': 'Slide right',
  iris: 'Iris',
};

export const ZERO_WHEEL: ColorWheel = { x: 0, y: 0, master: 0 };

export const COLOR_DEFAULTS: ColorGrade = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  blur: 0,
  temperature: 0,
  vignette: 0,
  lift: { ...ZERO_WHEEL },
  gamma: { ...ZERO_WHEEL },
  gain: { ...ZERO_WHEEL },
  lutId: null,
  lutMix: 1,
};

export const TRANSFORM_DEFAULTS: Transform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
};