import type { CSSProperties, ReactNode } from 'react';

const P = {
  play: <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />,
  pause: <><rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" /></>,
  start: <><path d="M6 5v14" /><path d="M19 5l-10 7 10 7z" /></>,
  end: <><path d="M18 5v14" /><path d="M5 5l10 7-10 7z" /></>,
  backs: <path d="M15 5l-7 7 7 7M9 5l-7 7 7 7" />,
  fwds: <path d="M9 5l7 7-7 7M15 5l7 7-7 7" />,
  scissors: <><circle cx="6" cy="6" r="2.6" /><circle cx="6" cy="18" r="2.6" /><path d="M8.2 7.8L19 18M8.2 16.2L19 6" /></>,
  trash: <><path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12.5h9.4L17.5 7" /><path d="M10 11v5M14 11v5" /></>,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h9.5a5.5 5.5 0 010 11H9" /></>,
  redo: <><path d="M15 14l5-5-5-5" /><path d="M20 9h-9.5a5.5 5.5 0 000 11H15" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  download: <><path d="M12 3v12" /><path d="M7.5 10.5L12 15l4.5-4.5" /><path d="M4 19h16" /></>,
  upload: <><path d="M12 16V4" /><path d="M7.5 8.5L12 4l4.5 4.5" /><path d="M4 20h16" /></>,
  film: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></>,
  music: <><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5" /></>,
  volume: <><path d="M4 9.5h3L12 5v14l-5-4.5H4z" /><path d="M16 8.5a5 5 0 010 7M18.6 6a8.5 8.5 0 010 12" /></>,
  mute: <><path d="M4 9.5h3L12 5v14l-5-4.5H4z" /><path d="M16 9l5 6M21 9l-5 6" /></>,
  magnet: <><path d="M5 4v8a7 7 0 0014 0V4h-4v8a3 3 0 01-6 0V4z" /><path d="M5 8h4M15 8h4" /></>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2.5" /><path d="M8 10V7.5a4 4 0 018 0V10" /></>,
  unlock: <><rect x="5" y="10" width="14" height="10" rx="2.5" /><path d="M8 10V7.5a4 4 0 017.5-2" /></>,
  eye: <><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3 3l18 18" /><path d="M10.6 6.1A9.8 9.8 0 0112 6c6 0 9.5 6 9.5 6a17 17 0 01-3.2 4M6.4 7.6A17 17 0 002.5 12s3.5 6.5 9.5 6.5a9.6 9.6 0 003.5-.7" /></>,
  settings: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.2" /><circle cx="9" cy="17" r="2.2" /></>,
  layers: <><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></>,
  diamond: <path d="M12 3.5L20.5 12 12 20.5 3.5 12z" />,
  reset: <><path d="M4 10a8 8 0 111.5 6.5" /><path d="M4 4v6h6" /></>,
  check: <path d="M4.5 12.5l5 5L20 6.5" />,
  chevron: <path d="M6 9l6 6 6-6" />,
  expand: <><path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" /></>,
  share: <><circle cx="18" cy="5.5" r="2.6" /><circle cx="6" cy="12" r="2.6" /><circle cx="18" cy="18.5" r="2.6" /><path d="M8.3 10.8l7.4-4M8.3 13.2l7.4 4" /></>,
  sparkle: <><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" /><path d="M19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9z" /></>,
  zoomIn: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.4 15.4L21 21M10.5 7.5v6M7.5 10.5h6" /></>,
  zoomOut: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.4 15.4L21 21M7.5 10.5h6" /></>,
  more: <><circle cx="5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="19" cy="12" r="1.4" fill="currentColor" /></>,
  split: <><rect x="3" y="4" width="6" height="16" rx="1.5" /><rect x="15" y="4" width="6" height="16" rx="1.5" /><path d="M13 3v18" strokeDasharray="2 2" /></>,
  flag: <><path d="M5 21V4M5 4h11l-1.5 4L16 12H5" /></>,
  loop: <><path d="M4 9a5 5 0 015-5h10M20 15a5 5 0 01-5 5H5" /><path d="M16 1.5L19 4l-3 2.5M8 18.5L5 16l3-2.5" /></>,
  text: <><path d="M4 6V4h16v2M12 4v16M8 20h8" /></>,
  captions: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10 9.6a2.5 2.5 0 100 4.8M17 9.6a2.5 2.5 0 100 4.8" /></>,
  reframe: <><path d="M6 2v16h16" /><path d="M2 6h16v16" /></>,
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18, style, strokeWidth = 1.7, className }: { name: IconName; size?: number; style?: CSSProperties; strokeWidth?: number; className?: string }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      aria-hidden="true"
    >
      {P[name]}
    </svg>
  );
}