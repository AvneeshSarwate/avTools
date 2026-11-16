import { proxy } from "valtio";
import { type Clip, DEFAULT_LOOP_LENGTH } from "../model/types";
import type { PianoRollNote, PianoRollScale } from "../pianoRoll/types";
import { cloneNote } from "../pianoRoll/utils";

// Each runner instance owns one clip, keyed by its shape id. The clips live
// here rather than in the shape's props so note edits stay on the roll's own
// undo stack and never in tldraw's history (an undone shape move would
// otherwise put back the notes from before it).
//
// A deleted instance's clip stays in memory so undoing the delete brings the
// notes back; saving writes only the clips of instances that exist.
//
// UI-facing state lives in valtio proxies: components read through
// useSnapshot and re-render only for the fields they touched. Nothing hot
// (timing, MIDI ports, note data mid-gesture) goes through these.
export const clipsStore = proxy<{ clips: Record<string, Clip> }>({ clips: {} });

export function getClip(shapeId: string): Clip | undefined {
  return clipsStore.clips[shapeId];
}

/** A plain deep copy (live store data is a proxy, which structuredClone rejects). */
export function copyClip(source: Partial<Clip>): Clip {
  return {
    notes: (source.notes ?? []).map((note) => cloneNote(note)),
    loopLength: source.loopLength ?? DEFAULT_LOOP_LENGTH,
    ...(source.scale ? { scale: { root: source.scale.root, degrees: [...source.scale.degrees] } } : {}),
  };
}

/** Give `shapeId` a clip (a copy of `init`, or empty) and return the live record. */
export function setClip(shapeId: string, init: Partial<Clip> = {}): Clip {
  clipsStore.clips[shapeId] = copyClip(init);
  return clipsStore.clips[shapeId];
}

/** Notes are replaced as one array so a roll sees one identity change per edit. */
export function setClipNotes(shapeId: string, notes: PianoRollNote[]): void {
  const clip = clipsStore.clips[shapeId];
  if (clip) clip.notes = notes;
}

export function setClipLoopLength(shapeId: string, loopLength: number): void {
  const clip = clipsStore.clips[shapeId];
  if (!clip || !Number.isFinite(loopLength) || loopLength <= 0) return;
  clip.loopLength = loopLength;
}

export function setClipScale(shapeId: string, scale: PianoRollScale): void {
  const clip = clipsStore.clips[shapeId];
  if (clip) clip.scale = { root: scale.root, degrees: [...scale.degrees] };
}

export function replaceAllClips(clips: Record<string, Clip>): void {
  clipsStore.clips = Object.fromEntries(Object.entries(clips).map(([id, clip]) => [id, copyClip(clip)]));
}
