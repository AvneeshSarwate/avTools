// Runner 2: "extender". Every loop one random note is stretched by a full
// loop length so it rings into the next pass. On an incoming trill event it
// plays a trill between the last pitch it sent and the event's pitch.
import type { Bank } from "../../model/types";
import type { PianoRollNote } from "../../pianoRoll/types";
import { clampPitch, type LoopNotes, notesInLoop, type RunnerApi, type RunnerDefinition, tagValue } from "../runnerTypes";

export const NO_EXTEND_TAG = "noExtend";
export const EXTENDED_COLOR = "#9be37a";
export const TRILL_NOTE_COLOR = "#ff7eb6";

export function generateExtenderLoop(bank: Bank, random: () => number): LoopNotes {
  const notes: PianoRollNote[] = notesInLoop(bank.notes, bank.loopLength).map((note) => ({ ...note }));
  const candidates = notes.filter((note) => !tagValue(note, NO_EXTEND_TAG));
  if (candidates.length > 0) {
    const chosen = candidates[Math.floor(random() * candidates.length)];
    chosen.duration += bank.loopLength;
    chosen.metadata = { ...(chosen.metadata ?? {}), extended: true };
  }
  return { notes, loopLength: bank.loopLength };
}

function trillPhrase(from: number, to: number, count: number): number[] {
  const phrase: number[] = [];
  for (let i = 0; i < count; i += 1) phrase.push(i % 2 === 0 ? from : to);
  return phrase.map(clampPitch);
}

async function runExtender(api: RunnerApi): Promise<void> {
  const offEvent = api.onEvent((event) => {
    if (event.type !== "trill" || typeof event.pitch !== "number") return;
    const last = api.lastPlayed();
    if (!last) {
      api.log("trill ignored: nothing played yet");
      return;
    }
    const params = api.getParams();
    const count = Math.max(2, Math.round(params.trillNotes ?? 8));
    const rate = Math.max(1, params.trillRate ?? 8);
    const incoming = event.pitch as number;
    const velocity = typeof event.velocity === "number" ? event.velocity : last.velocity;
    const phrase = trillPhrase(last.pitch, incoming, count);
    api.log(`trill ${last.pitch} <-> ${incoming} x${count}`);
    const step = 1 / rate;
    api.ctx.branch(async (ctx) => {
      for (const pitch of phrase) {
        api.playNote(pitch, velocity, step * 0.9, TRILL_NOTE_COLOR);
        await ctx.wait(step);
      }
    }, "trill").finally(() => {}).catch(() => {});
  });
  try {
    while (true) {
      const bank = api.getBank();
      const loop = generateExtenderLoop(bank, api.random);
      api.publishLoop(loop);
      await api.playLoop(loop);
    }
  } finally {
    offEvent();
  }
}

export const extenderRunner: RunnerDefinition = {
  type: "extender",
  label: "Extender",
  description: "Each loop, one random note (not tagged 'noExtend') is held a full extra loop. A received trill event plays a trill between this runner's last pitch and the event's pitch.",
  tags: [{ key: NO_EXTEND_TAG, label: "never extend", hotkey: "x", color: "#999", badge: "X", fields: [] }],
  params: [
    { key: "trillNotes", label: "trill notes", min: 2, max: 32, step: 1, default: 8 },
    { key: "trillRate", label: "trill rate", min: 1, max: 32, step: 1, default: 8, hint: "notes per beat" },
  ],
  generate: generateExtenderLoop,
  generatedNoteColor: (note) => (note.metadata?.extended ? EXTENDED_COLOR : undefined),
  run: runExtender,
};
