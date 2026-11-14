// Small stroke/fill icons on a 12px grid, drawn in currentColor so a control's
// state colour reaches its icon. One place for every glyph the chrome uses, so
// no emoji or font glyphs end up in controls.
import type { ReactElement } from "react";

export type IconName =
  | "play"
  | "run"
  | "stop"
  | "record"
  | "undo"
  | "redo"
  | "zoomIn"
  | "zoomOut"
  | "fit"
  | "trash"
  | "tag"
  | "pencil"
  | "magnet"
  | "chevronDown"
  | "chevronRight"
  | "chevronLeft"
  | "refresh"
  | "panic"
  | "plus"
  | "copy"
  | "close"
  | "save"
  | "grip"
  | "regenerate";

const PATHS: Record<IconName, ReactElement> = {
  play: <path d="M3 2v8l7-4z" fill="currentColor" />,
  // Run = the algorithm: a die.
  run: (
    <g>
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="4" cy="4" r="1" fill="currentColor" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
      <circle cx="6" cy="6" r="1" fill="currentColor" />
    </g>
  ),
  stop: <rect x="2.5" y="2.5" width="7" height="7" fill="currentColor" />,
  record: <circle cx="6" cy="6" r="3.8" fill="currentColor" />,
  undo: <path d="M4 3L1.5 5.5 4 8M2 5.5h5a3 3 0 010 6H5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />,
  redo: <path d="M8 3l2.5 2.5L8 8M10 5.5H5a3 3 0 000 6h2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />,
  zoomIn: <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />,
  zoomOut: <path d="M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />,
  fit: <path d="M1.5 4V1.5H4M8 1.5h2.5V4M10.5 8v2.5H8M4 10.5H1.5V8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />,
  trash: <path d="M2 3h8M4.5 3V1.8h3V3M3 3l.6 7.5h4.8L9 3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />,
  tag: (
    <g>
      <path d="M1.5 1.5h4.2l5 5-4.2 4.2-5-5z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="4" cy="4" r="0.9" fill="currentColor" />
    </g>
  ),
  pencil: <path d="M8.2 1.8l2 2-6.4 6.4-2.6.6.6-2.6zM7 3l2 2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />,
  magnet: <path d="M2.5 2v4a3.5 3.5 0 007 0V2M2.5 4h2M7.5 4h2M4.5 2v4a1.5 1.5 0 003 0V2" fill="none" stroke="currentColor" strokeWidth="1.2" />,
  chevronDown: <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />,
  chevronRight: <path d="M4.5 3l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />,
  chevronLeft: <path d="M7.5 3l-3 3 3 3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />,
  refresh: <path d="M10 6a4 4 0 11-1.2-2.8M10 1.5v2.2H7.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />,
  panic: <path d="M6 1.5l5 9H1zM6 5v2.5M6 9v.01" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />,
  plus: <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />,
  copy: <path d="M4 4h6v6.5H4zM2 8V1.5h6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />,
  close: <path d="M3 3l6 6M9 3L3 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />,
  save: <path d="M2 1.5h6.5l1.5 1.5v7.5H2zM4 1.5v3h4v-3M4 10.5V7h4v3.5" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />,
  grip: (
    <g fill="currentColor">
      <circle cx="4" cy="2.5" r="0.9" />
      <circle cx="8" cy="2.5" r="0.9" />
      <circle cx="4" cy="6" r="0.9" />
      <circle cx="8" cy="6" r="0.9" />
      <circle cx="4" cy="9.5" r="0.9" />
      <circle cx="8" cy="9.5" r="0.9" />
    </g>
  ),
  regenerate: <path d="M1.8 6a4.2 4.2 0 017.4-2.7M10.2 6a4.2 4.2 0 01-7.4 2.7M9.5 1.2v2.4H7.1M2.5 10.8V8.4h2.4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />,
};

export function Icon({ name, size = 12 }: { name: IconName; size?: number }) {
  return (
    <svg className="ui-icon" width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
