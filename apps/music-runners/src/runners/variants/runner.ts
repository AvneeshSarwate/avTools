// Runner 1: "variants". Some notes carry alternatives that replace them with a
// probability each loop; some notes are trill triggers that tell every
// arrow-target instance which pitch just played.
import type { Bank } from "../../model/types";
import type { GhostNote, PianoRollNote } from "../../pianoRoll/types";
import { clampPitch, type LoopNotes, notesInLoop, type RunnerApi, type RunnerDefinition, tagValue } from "../runnerTypes";

export const VARIANT_TAG = "variant";
export const TRILL_TAG = "trill";
/**
 * The event sent when a trill-tagged note fires: `{ pitch, velocity, count? }`.
 * `count` is the number of trill notes requested (absent: the receiver's own
 * default).
 */
export const TRILL_EVENT = "trill";
export const VARIANT_COLOR = "#f0a34a";
export const TRILL_COLOR = "#6cd4ff";

interface VariantTag {
  pitches: number[];
  probability: number;
}

interface TrillTag {
  /** Chance (0..1) that the trigger fires each time the note plays. */
  probability: number;
  /** Trill note counts to choose from uniformly; empty: the receiver's default. */
  notes: number[];
}

/** The trill tag's fields; a bare `true` (an older flag) fires always with the receiver's count. */
function readTrill(note: PianoRollNote): TrillTag | null {
  const value = tagValue(note, TRILL_TAG);
  if (!value) return null;
  if (value === true) return { probability: 1, notes: [] };
  const probability = typeof value.probability === "number" ? value.probability : 1;
  const notes = Array.isArray(value.notes)
    ? value.notes.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 1).map((n) => Math.round(n))
    : [];
  return { probability, notes };
}

function readVariant(note: PianoRollNote): VariantTag | null {
  const value = tagValue(note, VARIANT_TAG);
  if (!value || value === true) return null;
  const pitches = Array.isArray(value.pitches) ? value.pitches.filter((p): p is number => typeof p === "number") : [];
  const probability = typeof value.probability === "number" ? value.probability : 0.5;
  return { pitches, probability };
}

export function generateVariantsLoop(bank: Bank, random: () => number): LoopNotes {
  const notes = notesInLoop(bank.notes, bank.loopLength).map((note) => {
    const variant = readVariant(note);
    if (!variant || variant.pitches.length === 0 || random() >= variant.probability) return note;
    const pitch = clampPitch(variant.pitches[Math.floor(random() * variant.pitches.length)]);
    return { ...note, pitch, metadata: { ...(note.metadata ?? {}), chosenVariant: true, originalPitch: note.pitch } };
  });
  return { notes, loopLength: bank.loopLength };
}

function variantGhosts(bank: Bank): GhostNote[] {
  const ghosts: GhostNote[] = [];
  for (const note of bank.notes) {
    const variant = readVariant(note);
    if (!variant) continue;
    variant.pitches.forEach((pitch, index) => {
      ghosts.push({
        id: `${note.id}:variant:${index}`,
        pitch: clampPitch(pitch),
        position: note.position,
        duration: note.duration,
        color: VARIANT_COLOR,
        opacity: 0.45,
        label: index === 0 ? `${Math.round(variant.probability * 100)}%` : undefined,
        linkTo: note.id,
      });
    });
  }
  return ghosts;
}

async function runVariants(api: RunnerApi): Promise<void> {
  while (true) {
    const bank = api.getBank();
    const loop = generateVariantsLoop(bank, api.random);
    api.publishLoop(loop);
    await api.playLoop(loop, {
      onNoteOn: (note) => {
        const trill = readTrill(note);
        if (!trill || api.random() >= trill.probability) return;
        const count = trill.notes.length > 0 ? trill.notes[Math.floor(api.random() * trill.notes.length)] : undefined;
        api.emit({ type: TRILL_EVENT, pitch: note.pitch, velocity: note.velocity, ...(count !== undefined ? { count } : {}) });
      },
    });
  }
}

export const variantsRunner: RunnerDefinition = {
  type: "variants",
  label: "Variants",
  description: "Notes tagged 'variant' are replaced by one of their alternative pitches with the given probability each loop. Notes tagged 'trill' emit a trill event with their pitch when they play, with the tag's probability, requesting a trill note count picked from the tag's list.",
  tags: [
    {
      key: VARIANT_TAG,
      label: "variant",
      hotkey: "v",
      color: VARIANT_COLOR,
      badge: "V",
      fields: [
        { key: "pitches", label: "alt pitches", kind: "numberList", default: [] },
        { key: "probability", label: "probability", kind: "number", default: 0.5, min: 0, max: 1, step: 0.05 },
      ],
    },
    {
      key: TRILL_TAG,
      label: "trill trigger",
      hotkey: "t",
      color: TRILL_COLOR,
      badge: "T",
      fields: [
        { key: "probability", label: "probability", kind: "number", default: 1, min: 0, max: 1, step: 0.05 },
        { key: "notes", label: "trill notes", kind: "numberList", default: [], placeholder: "8 or 3 4 5" },
      ],
    },
  ],
  params: [],
  emits: [TRILL_EVENT],
  generate: generateVariantsLoop,
  sourceGhostNotes: variantGhosts,
  generatedNoteColor: (note) => (note.metadata?.chosenVariant ? VARIANT_COLOR : tagValue(note, TRILL_TAG) ? TRILL_COLOR : undefined),
  run: runVariants,
};
