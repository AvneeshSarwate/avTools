import type { TimeContext } from "@avtools/core-timing";
import type { SixSinesEvent } from "@avtools/six-sines";
import { button, canvasParams } from "canvas-params";
import * as events from "canvas-events";
import { animationTimeline } from "animation-timeline";
import { getPianoRoll } from "piano-roll-store";
import {
  allocateNoteId,
  isSixSinesReady,
  sendSixSinesEvents,
  startSixSines,
  stopSixSines,
} from "./instrument.ts";

const ROLL = "cursor-chords/chords";
const MACROS = ["macro1", "macro2", "macro3"] as const;
const MACRO_IDS = [40000, 40250, 40500] as const;
const lfoMeta = {
  mode: {
    label: "Mode",
    options: { Off: "off", "On (sine)": "on", "Random ramp": "random-ramp" },
  },
  rateHz: { label: "Rate Hz / ramp speed", min: 0, max: 12, step: 0.01 },
  depth: { label: "Depth (+/-)", min: 0, max: 1, step: 0.01 },
  rateSpreadHz: {
    label: "Rate spread (next notes)",
    min: 0,
    max: 8,
    step: 0.01,
  },
};
const controls = canvasParams("cursor-chords/controls", {
  play: button({ type: "cursor-chords/play", body: {} }),
  off: button({ type: "cursor-chords/off", body: {} }),
  macro1: { mode: "off", rateHz: 1, depth: 0.5, rateSpreadHz: 0.08 },
  macro2: { mode: "off", rateHz: 1, depth: 0.5, rateSpreadHz: 0.16 },
  macro3: { mode: "off", rateHz: 1, depth: 0.5, rateSpreadHz: 0.24 },
}, {
  play: { label: "Play at cursor" },
  off: { label: "Off" },
  macro1: lfoMeta,
  macro2: lfoMeta,
  macro3: lfoMeta,
});

// The editable entity stays in the store. Each oscillator only copies its lane
// at a cycle boundary, so editing the timeline does not jump an active ramp.
const ramps = animationTimeline("cursor-chords/ramps");
interface Ramp {
  trackId?: string;
  points: { time: number; value: number }[];
  duration: number;
  elapsed: number;
}
function captureRamp(random: () => number, trackId?: string): Ramp {
  const tracks = ramps.data().tracks.filter((track) =>
    track.fieldType === "number"
  );
  const track = tracks.find((track) => track.id === trackId) ??
    tracks[Math.floor(random() * tracks.length)];
  const points = track?.elementData.map((point) => ({
    time: point.time,
    value: point.value,
  })).sort((a, b) => a.time - b.time) ?? [];
  return {
    trackId: track?.id,
    points,
    duration: Math.max(1 / 60, points.at(-1)?.time ?? 1),
    elapsed: 0,
  };
}
function rampValue(ramp: Ramp, rate: number): number {
  const time = rate < 0 ? ramp.duration - ramp.elapsed : ramp.elapsed;
  const points = ramp.points;
  if (!points.length) return 0;
  if (time <= points[0]!.time) return points[0]!.value;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    if (time < b.time) {
      return a.value +
        (b.value - a.value) * (time - a.time) / (b.time - a.time);
    }
  }
  return points.at(-1)!.value;
}

interface HeldNote {
  noteId: number;
  key: number;
  startedAt: number;
  rates: number[];
  amounts: number[];
  ramps: (Ramp | undefined)[];
}

export default async function run(ctx: TimeContext) {
  // Held voices and oscillators are runtime state, not UI-bound entities.
  const held: HeldNote[] = [];
  const off = (): SixSinesEvent[] =>
    held.splice(0).map((note) => ({
      type: 2,
      noteId: note.noteId,
      key: note.key,
      port: 0,
      channel: 0,
      value: 0,
    }));
  const cleanup = () => {
    held.length = 0;
    stopSixSines();
  };
  ctx.abortController.signal.addEventListener("abort", cleanup, { once: true });
  let unsubscribe: (() => void) | undefined;
  try {
    startSixSines();
    let polls = 0;
    while (!isSixSinesReady()) {
      if (polls++ >= 200) {
        throw new Error(
          "Audio startup timed out; activate the engine tab and run again",
        );
      }
      await ctx.waitSec(0.05);
    }
    console.log(
      "Cursor chords ready: Play at cursor latches a chord; Off releases it.",
    );
    unsubscribe = events.onEvent((event) => {
      if (event.body.state !== undefined && event.body.state !== "down") return;
      if (
        event.type !== "cursor-chords/play" &&
        event.type !== "cursor-chords/off"
      ) return;
      const batch = off(); // release old IDs before creating new ones, even at matching pitches
      if (event.type === "cursor-chords/play") {
        const roll = getPianoRoll(ROLL);
        const cursor = roll?.data.playStartPosition ?? 0;
        for (const note of roll?.data.notes ?? []) {
          // Half-open intervals: a boundary belongs to the chord beginning there.
          if (
            !(note.position <= cursor && cursor < note.position + note.duration)
          ) continue;
          const key = Math.max(0, Math.min(127, Math.round(note.pitch)));
          const noteId = allocateNoteId();
          held.push({
            noteId,
            key,
            startedAt: ctx.time,
            amounts: [0, 0, 0],
            ramps: [],
            rates: MACROS.map((name) => {
              const lfo = controls[name];
              return lfo.rateHz + (2 * ctx.random() - 1) * lfo.rateSpreadHz;
            }),
          });
          batch.push({
            type: 1,
            noteId,
            key,
            port: 0,
            channel: 0,
            value: Math.max(0, Math.min(1, (note.velocity ?? 100) / 127)),
          });
        }
      }
      sendSixSinesEvents(batch);
    }, ctx);
    let previousTime = ctx.time;
    while (true) {
      const dt = Math.max(0, ctx.time - previousTime);
      previousTime = ctx.time;
      const batch: SixSinesEvent[] = [];
      for (const note of held) {
        for (let index = 0; index < MACROS.length; index++) {
          const lfo = controls[MACROS[index]!];
          // Off explicitly clears an existing per-note offset. Negative sampled
          // rates reverse phase; they are not clamped or resampled mid-note.
          const rate = note.rates[index]!;
          let value = 0;
          if (lfo.mode === "random-ramp") {
            let ramp = note.ramps[index];
            if (!ramp) ramp = captureRamp(() => ctx.random());
            else {
              ramp.elapsed += Math.abs(rate) * dt;
              if (ramp.elapsed >= ramp.duration) {
                const remainder = ramp.elapsed - ramp.duration;
                ramp = captureRamp(() => ctx.random(), ramp.trackId);
                ramp.elapsed = remainder % ramp.duration;
              }
            }
            note.ramps[index] = ramp;
            value = rampValue(ramp, rate);
          } else {
            note.ramps[index] = undefined;
            if (lfo.mode === "on") {
              value = Math.sin(
                2 * Math.PI * rate * (ctx.time - note.startedAt),
              );
            }
          }
          const amount = lfo.depth * Math.max(-1, Math.min(1, value));
          if (Object.is(amount, note.amounts[index])) continue;
          note.amounts[index] = amount;
          batch.push({
            type: 5,
            noteId: note.noteId,
            key: note.key,
            port: 0,
            channel: 0,
            paramId: MACRO_IDS[index],
            value: amount,
          });
        }
      }
      sendSixSinesEvents(batch); // one batched port message for all voices/macros
      await ctx.waitSec(1 / 60);
    }
  } finally {
    unsubscribe?.();
    ctx.abortController.signal.removeEventListener("abort", cleanup);
    cleanup();
  }
}

export function stop() {
  stopSixSines();
}
