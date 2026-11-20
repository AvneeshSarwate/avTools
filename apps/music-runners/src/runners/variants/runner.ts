// Runner 1: "variants". Some notes carry alternatives that replace them with a
// probability each loop; some notes are trill triggers that tell every
// arrow-target instance which pitch just played.
import type { Clip } from "../../model/types";
import type { GhostNote, PianoRollNote } from "../../pianoRoll/types";
import { type LoopNotes, notesInLoop, type Params, type RunnerApi, type RunnerDefinition, scaleParam, tagValue } from "../runnerTypes";
import { fireTrill, TRILL_COLOR, TRILL_EVENT, TRILL_TAG, trillTagSpec } from "../trillTrigger";
import { parseVariantSteps, resolveVariantStep, type VariantStep } from "./steps";

export { TRILL_COLOR, TRILL_EVENT, TRILL_TAG };

export const VARIANT_TAG = "variant";
export const VARIANT_COLOR = "#f0a34a";

interface VariantTag {
  /** Moves from the note in the instance's scale param (steps.ts): "+1 -5 +2+". */
  steps: VariantStep[];
  probability: number;
}

function readVariant(note: PianoRollNote): VariantTag | null {
  const value = tagValue(note, VARIANT_TAG);
  if (!value || value === true) return null;
  const steps = typeof value.steps === "string" ? parseVariantSteps(value.steps).steps : [];
  const probability = typeof value.probability === "number" ? value.probability : 0.5;
  return { steps, probability };
}

/** C major: the scale param's default. */
const C_MAJOR = { root: 60, degrees: [0, 2, 4, 5, 7, 9, 11, 12] };

/** The scale the variant steps move in: this instance's `scale` param. */
function variantScale(params: Params) {
  return scaleParam(params, "scale") ?? C_MAJOR;
}

export function generateVariantsLoop(clip: Clip, random: () => number, params: Params): LoopNotes {
  const scale = variantScale(params);
  const notes = notesInLoop(clip.notes, clip.loopLength).map((note) => {
    const variant = readVariant(note);
    if (!variant || variant.steps.length === 0 || random() >= variant.probability) return note;
    const step = variant.steps[Math.floor(random() * variant.steps.length)];
    const pitch = resolveVariantStep(note.pitch, step, scale);
    return { ...note, pitch, metadata: { ...(note.metadata ?? {}), chosenVariant: true, originalPitch: note.pitch, chosenStep: step.text } };
  });
  return { notes, loopLength: clip.loopLength };
}

function variantGhosts(clip: Clip, params: Params): GhostNote[] {
  const scale = variantScale(params);
  const ghosts: GhostNote[] = [];
  for (const note of clip.notes) {
    const variant = readVariant(note);
    if (!variant) continue;
    variant.steps.forEach((step, index) => {
      ghosts.push({
        id: `${note.id}:variant:${index}`,
        pitch: resolveVariantStep(note.pitch, step, scale),
        position: note.position,
        duration: note.duration,
        color: VARIANT_COLOR,
        opacity: 0.45,
        label: index === 0 ? `${Math.round(variant.probability * 100)}% ${step.text}` : step.text,
        linkTo: note.id,
      });
    });
  }
  return ghosts;
}

async function runVariants(api: RunnerApi): Promise<void> {
  while (true) {
    const clip = api.getClip();
    const loop = generateVariantsLoop(clip, api.random, api.getParams());
    api.publishLoop(loop);
    await api.playLoop(loop, {
      onNoteOn: (note) => fireTrill(api, note, note.pitch, note.velocity),
    });
  }
}

export const variantsRunner: RunnerDefinition = {
  type: "variants",
  label: "Variants",
  description: "Notes tagged 'variant' are replaced, with the given probability each loop, by one of their alternative steps: scale degrees from the note in the runner's scale param (+1, -5), optionally plus raw semitones (+2+ = 2 degrees and a semitone, +2+2 = 2 degrees and a whole tone). Notes tagged 'trill' emit a trill event with their pitch when they play, with the tag's probability, requesting a trill note count picked from the tag's list.",
  tags: [
    {
      key: VARIANT_TAG,
      label: "variant",
      hotkey: "v",
      color: VARIANT_COLOR,
      badge: "V",
      fields: [
        { key: "steps", label: "alt steps", kind: "string", default: "", placeholder: "+1 -2 +2+" },
        { key: "probability", label: "probability", kind: "number", default: 0.5, min: 0, max: 1, step: 0.05 },
      ],
    },
    trillTagSpec,
  ],
  params: [
    { kind: "scale", key: "scale", label: "scale", default: C_MAJOR, hint: "the scale variant steps move in (+1 = one degree of this scale)" },
    { key: "transpose", label: "transpose", min: -24, max: 24, step: 1, default: 0, hint: "semitones, immediate" },
    { key: "speed", label: "speed", min: 0.25, max: 4, step: 0.05, default: 1, hint: "applies at next loop" },
  ],
  emits: [TRILL_EVENT],
  generate: generateVariantsLoop,
  sourceGhostNotes: variantGhosts,
  generatedNoteColor: (note) => (note.metadata?.chosenVariant ? VARIANT_COLOR : tagValue(note, TRILL_TAG) ? TRILL_COLOR : undefined),
  run: runVariants,
};
