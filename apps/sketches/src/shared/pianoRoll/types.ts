// Public contract of the React + Konva piano roll. The runner framework and
// the shapes build against this file; the component implementation lives in
// ./PianoRoll.tsx. Keep this file small and stable.
import type { ReactNode } from "react";

export type JsonObject = Record<string, unknown>;

/**
 * A scale in the shape `new Scale(degrees, root)` takes in packages/music-types
 * (scale.ts): `degrees` are semitones above the root counted from 0, with the
 * octave as the last degree (ionian is 0 2 4 5 7 9 11 12); `root` is a MIDI
 * note (60 = C4). The roll only uses the pitch classes, for row shading.
 */
export interface PianoRollScale {
  root: number;
  degrees: number[];
}

export interface PianoRollNote {
  id: string;
  pitch: number; // MIDI 0..127
  position: number; // beats (quarter notes)
  duration: number; // beats
  velocity: number; // 0..127
  metadata?: JsonObject;
  /** Per-note MPE expression, `time` 0..1 across the note (see src/model/mpe.ts). */
  mpePitch?: { points: { time: number; pitchOffset: number; rooted?: boolean }[] };
  mpePressure?: { points: { time: number; value: number }[] };
  mpeTimbre?: { points: { time: number; value: number }[] };
}

/** Zoom and scroll of one view; never part of musical data. */
export interface PianoRollView {
  quarterNoteWidth: number;
  noteHeight: number;
  startBeat: number;
  topRow: number;
}

export interface PlayheadMarker {
  id: string;
  position: number; // beats
  color?: string;
  /** A tinted band behind the line, in beats (for example the chord the line picks). */
  span?: { from: number; to: number };
}

/**
 * A read-only note drawn over the roll: variant alternatives, notes that
 * actually played, a trill phrase. `linkTo` draws a thin connector to the
 * source note with that id when it is visible.
 */
export interface GhostNote {
  id: string;
  pitch: number;
  position: number;
  duration: number;
  color?: string;
  opacity?: number;
  label?: string;
  linkTo?: string;
}

/**
 * Live MIDI input drawn over the roll, Ableton style: `keys` are the pitches
 * held on the input right now (a row highlight, offset by their bend), `notes`
 * are notes being recorded, growing until their note-off. Per-frame data:
 * pushed through `PianoRollHandle.setLiveInput`, never through props.
 */
export interface LiveInputKey {
  pitch: number;
  /** Current bend in semitones. */
  pitchOffset: number;
  /** 0..127, shown as the highlight's strength. */
  velocity: number;
}

export interface LiveInputNote {
  id: string;
  pitch: number;
  position: number;
  duration: number;
  velocity: number;
  /** Recorded bend so far, absolute beats. */
  curve?: { position: number; pitchOffset: number }[];
}

export interface LiveInput {
  keys: LiveInputKey[];
  notes: LiveInputNote[];
}

export interface MetadataPanelProps {
  /** The currently selected notes (live objects, do not mutate). */
  selected: PianoRollNote[];
  /** Apply one undoable metadata edit to the given notes. */
  applyMetadata: (
    label: string,
    noteIds: string[],
    update: (metadata: JsonObject | undefined, note: PianoRollNote) => JsonObject | undefined,
  ) => void;
}

export interface PianoRollProps {
  /** External truth. Edits are emitted through onNotesChange; the component re-hydrates when a foreign change arrives. */
  notes: PianoRollNote[];
  onNotesChange?: (notes: PianoRollNote[], label: string) => void;
  /** Loop length in beats. Drawn as an end line; notes past it stay in data. */
  loopLength: number;
  /** Konva stage size in CSS px. Chrome (control panel, scrollbars) is added outside the stage. */
  width: number;
  height: number;
  interactive?: boolean;
  showControlPanel?: boolean;
  playheadMarkers?: PlayheadMarker[];
  ghostNotes?: GhostNote[];
  /** Connections drawn under the ghosts and notes; endpoints are note or ghost ids, resolved live. */
  links?: RollLink[];
  /**
   * Ghost notes as targets: the ghost under the pointer (null when none) and
   * a press on one. Real notes win; among overlapping ghosts the last drawn
   * (last in `ghostNotes`) is on top. A ghost press does not start a marquee.
   */
  onGhostHover?: (ghostId: string | null) => void;
  onGhostClick?: (ghostId: string) => void;
  /** Short text drawn on a note (tag badges). */
  noteBadge?: (note: PianoRollNote) => string | null;
  /** Fill override; falls back to metadata.color then the default. */
  /**
   * `selected` is whether the note is selected; return undefined for a
   * selected note to keep the roll's own selection fill.
   */
  noteColor?: (note: PianoRollNote, selected: boolean) => string | undefined;
  onSelectionChange?: (ids: string[]) => void;
  /** Audition hook: fired when a note is created, clicked, or dragged to a new pitch. */
  onNotePreview?: (note: { pitch: number; velocity: number }) => void;
  /** Rendered inside the control panel area when notes are selected. */
  renderMetadataPanel?: (props: MetadataPanelProps) => ReactNode;
  initialView?: PianoRollView;
  onViewChange?: (view: PianoRollView) => void;
  /** Toggled by the host; the component also exposes it in its control panel. */
  snapToGrid?: boolean;
  /**
   * Scale for row shading (root rows lighter, out-of-scale rows darker).
   * Default C major. Edited from the control panel; without onScaleChange
   * the roll keeps edits to itself.
   */
  scale?: PianoRollScale;
  onScaleChange?: (scale: PianoRollScale) => void;
  /**
   * The cursor (the roll's queue playhead, where pastes land), in beats. A
   * click on the empty grid moves it and reports through onCursorChange.
   * Given, the roll draws it always (also at 0) and follows the prop.
   */
  cursor?: number;
  onCursorChange?: (position: number) => void;
  /**
   * Expression lanes under the grid and the Notes/MPE mode switch (Ableton's
   * velocity lane and Note Expression editor). Default: on for an
   * interactive roll with its control panel.
   */
  expressionLanes?: boolean;
  /**
   * A key pressed (on: true) or released in the keyboard column. Without it a
   * press auditions through onNotePreview.
   */
  onKeyboardNote?: (pitch: number, on: boolean) => void;
  /**
   * Cmd-Z / Cmd-Shift-Z inside the roll. Given, the host's history handles
   * them (one undo stack for the page) instead of the roll's own stack.
   */
  onHistoryKey?: (action: 'undo' | 'redo') => void;
  /**
   * Label notes and keyboard rows with note names ("C3" = 60, the default) or
   * MIDI numbers; hovering a note shows the other form.
   */
  pitchLabels?: 'name' | 'midi';
  /**
   * Scroll and zoom (wheel, scrollbars) even when not interactive: a
   * read-only roll you can still look around in. Default: interactive.
   */
  navigable?: boolean;
  /**
   * Show the raw JSON metadata tree under the host's metadata panel (default
   * true). Hosts with a structured editor can hide it.
   */
  rawMetadataEditor?: boolean;
  /**
   * Render the control panel into this element (a host's section header)
   * instead of above the stage. Null while the host element is not mounted.
   */
  toolbarTarget?: HTMLElement | null;
}

/**
 * A drawn connection from one note to another (either may be a ghost): from
 * `inset` beats before the end of `from` to `inset` beats after the start of
 * `to`, so it reads as a diagonal between the two bars. `curve` maps 0..1
 * along the line to 0..1 of the pitch change (default linear).
 */
export interface RollLink {
  id: string;
  from: string;
  to: string;
  color?: string;
  opacity?: number;
  lineWidth?: number;
  dash?: number[];
  curve?: (t: number) => number;
  /** Beats into each note the line starts / ends (default 0). */
  inset?: number;
}

export interface PianoRollHandle {
  /**
   * Per-frame marker updates go here, not through the `playheadMarkers` prop:
   * a prop change re-renders the host and the roll, a handle call only moves
   * the overlay layer.
   */
  setPlayheadMarkers(markers: PlayheadMarker[]): void;
  /** Fit the view to the notes and ghost notes. */
  fitToContent(): void;
  /** Zoom time by a factor around the view's centre (>1 zooms in). */
  zoomBy(factor: number): void;
  getView(): PianoRollView;
  setView(view: PianoRollView): void;
  getSelectedIds(): string[];
  selectNotes(ids: string[]): void;
  focus(): void;
  /** Live input overlay (held keys, notes being recorded); see LiveInput. */
  setLiveInput(input: LiveInput): void;
  /** Fill these notes with `color` (what is playing); [] clears. Redraws only on change. */
  setNoteHighlights(ids: string[], color: string): void;
  /**
   * Replace the notes with `after` as one undoable step whose undo restores
   * `before`. For edits made outside the roll that should still undo as one
   * (a recorded take). Emits through onNotesChange like any edit.
   */
  commitExternalEdit(label: string, before: PianoRollNote[], after: PianoRollNote[]): void;
}
