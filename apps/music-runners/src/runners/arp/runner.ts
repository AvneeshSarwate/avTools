// Runner 3: "arp". Arpeggiates the chord under the source roll's cursor
// (click the empty grid to move it): the notes sounding at the cursor, low
// to high, are indexes 0, 1, 2, … for a Tidal/Strudel mini-notation pattern
// (pattern.ts). One pattern cycle lasts `cycle` beats. The chord is read at
// the start of each cycle, so moving the cursor takes effect on the next
// one; the "playing" line on the source roll marks the chord that is
// sounding until then. With no notes under the cursor the arp goes quiet
// and starts a new cycle as soon as there is a chord there again.
import type { Clip } from "../../model/types";
import type { PianoRollNote } from "../../pianoRoll/types";
import { type LoopNotes, numberParam, type Params, type RunnerApi, type RunnerDefinition, textParam } from "../runnerTypes";
import { arpCycle, arpPatternError, chordAt, chordNote, parseArpPattern } from "./pattern";

const DEFAULT_PATTERN = "0 1 2 <3 -1>";
/** The run colour (styles.css --c-run): the chord that is sounding. */
const PLAYING_COLOR = "#ffab3d";
/** How often a waiting arp looks for a chord under the cursor. */
const WAIT_POLL_SEC = 0.01;

/** One cycle of the pattern over `chord`, laid out from `start` on the roll. */
function arpLoop(chord: PianoRollNote[], params: Params, cycle: number, start: number): LoopNotes | null {
  const parsed = parseArpPattern(textParam(params, "pattern", DEFAULT_PATTERN));
  if (!parsed.ok || chord.length === 0) return null;
  const cycleBeats = Math.max(0.25, numberParam(params, "cycle", 4));
  const gate = numberParam(params, "gate", 0.9);
  const wrapShift = numberParam(params, "wrapShift", 0);
  const notes = arpCycle(parsed.pattern, cycle).map((step, i): PianoRollNote => {
    const { note, pitch } = chordNote(chord, step.index, wrapShift);
    return {
      id: `arp_${cycle}_${i}`,
      pitch,
      velocity: note.velocity,
      position: start + step.begin * cycleBeats,
      duration: Math.max(0.01, step.duration * cycleBeats * gate),
      metadata: { arpIndex: step.index },
    };
  });
  return { notes, loopLength: cycleBeats, start };
}

function generateArp(clip: Clip, _random: () => number, params: Params, context: { cursor: number }): LoopNotes {
  return arpLoop(chordAt(clip.notes, context.cursor), params, 0, context.cursor) ?? { notes: [], loopLength: numberParam(params, "cycle", 4), start: context.cursor };
}

async function runArp(api: RunnerApi): Promise<void> {
  /** The chord under the cursor and its loop; null without a chord (or with a bad pattern). */
  const next = (cycle: number) => {
    const cursor = api.getCursor();
    const chord = chordAt(api.getClip().notes, cursor);
    const loop = arpLoop(chord, api.getParams(), cycle, cursor);
    return loop ? { loop, chord, cursor } : null;
  };
  for (let cycle = 0; ; cycle += 1) {
    let current = next(cycle);
    if (!current) {
      // Quiet until the cursor (or an edit) puts a chord under it; then a
      // new cycle starts right away, not on the old cycle grid
      api.publishLoop(null);
      api.setMarkers([]);
      api.log("waiting: no notes under the cursor");
      while (!current) {
        await api.ctx.waitSec(WAIT_POLL_SEC);
        current = next(cycle);
      }
    }
    // The playing line at the cursor this cycle read, its chord's extent tinted
    const { loop, chord, cursor } = current;
    const span = { from: Math.min(...chord.map((note) => note.position)), to: Math.max(...chord.map((note) => note.position + note.duration)) };
    api.setMarkers([{ id: "playing", position: cursor, color: PLAYING_COLOR, span }]);
    api.publishLoop(loop);
    await api.playLoop(loop);
  }
}

export const arpRunner: RunnerDefinition = {
  type: "arp",
  label: "Arp",
  description:
    "Arpeggiates the chord under the source roll's cursor (click the empty grid to move it) with a Tidal/Strudel mini-notation pattern of chord indexes: 0 is the lowest note, indexes wrap both ways. The chord is picked up at the start of each cycle; with no notes under the cursor the arp waits and restarts as soon as there is a chord.",
  tags: [],
  usesCursor: true,
  sourcePlayhead: false,
  params: [
    {
      kind: "text",
      key: "pattern",
      label: "pattern",
      default: DEFAULT_PATTERN,
      hint: "mini-notation of chord indexes: 0 1 2, [0 1] 2, <0 2>, 0*2, 0(3,8), [0,2], ~ rests; -1 wraps to the top note",
      validate: arpPatternError,
    },
    { key: "cycle", label: "cycle", min: 0.25, max: 32, step: 0.25, default: 4, hint: "beats per pattern cycle" },
    { key: "gate", label: "gate", min: 0.05, max: 1, step: 0.05, default: 0.9, hint: "note length as a fraction of its step" },
    { key: "wrapShift", label: "wrap shift", min: 0, max: 24, step: 1, default: 0, hint: "semitones per wrap past the chord's ends (0: wrap in place, 12: next octave)" },
    { key: "transpose", label: "transpose", min: -24, max: 24, step: 1, default: 0, hint: "semitones, immediate" },
    { key: "speed", label: "speed", min: 0.25, max: 4, step: 0.05, default: 1, hint: "applies at next cycle" },
  ],
  generate: generateArp,
  generatedNoteColor: () => PLAYING_COLOR,
  // The bar is the current cycle, wherever on the roll the cursor started it
  sidebarPhase: ({ elapsed, loopLength }) => (loopLength > 0 ? elapsed / loopLength : null),
  run: runArp,
};
