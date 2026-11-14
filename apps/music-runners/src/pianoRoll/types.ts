// Public contract of the React + Konva piano roll. The runner framework and
// the shapes build against this file; the component implementation lives in
// ./PianoRoll.tsx. Keep this file small and stable.
import type { ReactNode } from "react";

export type JsonObject = Record<string, unknown>;

export interface PianoRollNote {
  id: string;
  pitch: number; // MIDI 0..127
  position: number; // beats (quarter notes)
  duration: number; // beats
  velocity: number; // 0..127
  metadata?: JsonObject;
  /** Per-note MPE expression, `time` 0..1 across the note (see src/model/mpe.ts). */
  mpePitch?: { points: { time: number; pitchOffset: number }[] };
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
  /** Short text drawn on a note (tag badges). */
  noteBadge?: (note: PianoRollNote) => string | null;
  /** Fill override; falls back to metadata.color then the default. */
  noteColor?: (note: PianoRollNote) => string | undefined;
  onSelectionChange?: (ids: string[]) => void;
  /** Audition hook: fired when a note is created, clicked, or dragged to a new pitch. */
  onNotePreview?: (note: { pitch: number; velocity: number }) => void;
  /** Rendered inside the control panel area when notes are selected. */
  renderMetadataPanel?: (props: MetadataPanelProps) => ReactNode;
  initialView?: PianoRollView;
  onViewChange?: (view: PianoRollView) => void;
  /** Toggled by the host; the component also exposes it in its control panel. */
  snapToGrid?: boolean;
}

export interface PianoRollHandle {
  /**
   * Per-frame marker updates go here, not through the `playheadMarkers` prop:
   * a prop change re-renders the host and the roll, a handle call only moves
   * the overlay layer.
   */
  setPlayheadMarkers(markers: PlayheadMarker[]): void;
  fitToContent(): void;
  getView(): PianoRollView;
  setView(view: PianoRollView): void;
  getSelectedIds(): string[];
  selectNotes(ids: string[]): void;
  focus(): void;
  /** Live input overlay (held keys, notes being recorded); see LiveInput. */
  setLiveInput(input: LiveInput): void;
  /**
   * Replace the notes with `after` as one undoable step whose undo restores
   * `before`. For edits made outside the roll that should still undo as one
   * (a recorded take). Emits through onNotesChange like any edit.
   */
  commitExternalEdit(label: string, before: PianoRollNote[], after: PianoRollNote[]): void;
}
