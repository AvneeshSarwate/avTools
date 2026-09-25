import type { TimeContext } from "@avtools/core-timing";
import type { SixSinesEvent } from "@avtools/six-sines";
import { canvasParams } from "canvas-params";
import { getPianoRoll } from "piano-roll-store";
import {
  allocateNoteId,
  isSixSinesReady,
  sendSixSinesEvents,
  startSixSines,
  stopSixSines,
} from "./instrument.ts";

const ROLL = "six-sines-recording/take";
const NOTE_ON = 1;
const NOTE_OFF = 2;
const NOTE_EXPRESSION = 3;
// CLAP note expression IDs. Six Sines feeds pressure and brightness to its
// MPE Pressure / Timbre mod sources, so MPE presets respond per note.
const TUNING = 2;
const BRIGHTNESS = 5;
const PRESSURE = 6;
/** Expression update rate: one batched message per tick for all held notes. */
const TICK_SEC = 1 / 100;

const playback = canvasParams("six-sines-recording/playback", {
  loop: true,
  status: "idle",
}, {
  loop: { label: "loop take" },
  status: { label: "status" },
});

type CurvePoint = { time: number; value: number };

interface NoteLike {
  pitch: number;
  position: number;
  duration: number;
  velocity?: number;
  mpePitch?: { points: { time: number; pitchOffset: number }[] };
  mpePressure?: { points: CurvePoint[] };
  mpeTimbre?: { points: CurvePoint[] };
}

interface Voice {
  noteId: number;
  key: number;
  startBeat: number;
  durationBeats: number;
  pitch?: CurvePoint[];
  pressure?: CurvePoint[];
  timbre?: CurvePoint[];
}

/** Linear interpolation over 0..1 note time; holds the end values outside. */
function sampleCurve(points: CurvePoint[], t: number): number {
  if (t <= points[0].time) return points[0].value;
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (t <= b.time) {
      const a = points[i - 1];
      const span = b.time - a.time;
      return span > 0
        ? a.value + ((t - a.time) / span) * (b.value - a.value)
        : b.value;
    }
  }
  return points[points.length - 1].value;
}

function expressionEvents(voice: Voice, t: number): SixSinesEvent[] {
  const events: SixSinesEvent[] = [];
  const push = (expressionId: number, value: number) =>
    events.push({
      type: NOTE_EXPRESSION,
      noteId: voice.noteId,
      key: voice.key,
      expressionId,
      value,
    });
  // Tuning is semitones; pressure and brightness are CLAP's 0..1.
  if (voice.pitch) push(TUNING, sampleCurve(voice.pitch, t));
  if (voice.pressure) push(PRESSURE, sampleCurve(voice.pressure, t) / 127);
  if (voice.timbre) push(BRIGHTNESS, sampleCurve(voice.timbre, t) / 127);
  return events;
}

function voiceFor(note: NoteLike, noteId: number, startBeat: number): Voice {
  const points = (curve?: { points: CurvePoint[] }) =>
    curve?.points.length
      ? [...curve.points].sort((a, b) => a.time - b.time)
      : undefined;
  return {
    noteId,
    key: Math.max(0, Math.min(127, Math.round(note.pitch))),
    startBeat,
    durationBeats: note.duration,
    pitch: points(
      note.mpePitch && {
        points: note.mpePitch.points.map((p) => ({
          time: p.time,
          value: p.pitchOffset,
        })),
      },
    ),
    pressure: points(note.mpePressure),
    timbre: points(note.mpeTimbre),
  };
}

/**
 * Plays `six-sines-recording/take` through Six Sines with each note's recorded
 * pitch, pressure and timbre curves as per-note CLAP note expressions. Re-reads
 * the roll every pass, so edits made in the roll (including its Pressure and
 * Timbre lanes) are heard on the next loop.
 */
export default async function run(ctx: TimeContext) {
  startSixSines();
  for (let polls = 0; !isSixSinesReady(); polls++) {
    if (polls >= 200) {
      throw new Error("Timed out waiting for the Six Sines AudioWorklet");
    }
    await ctx.waitSec(0.05);
  }

  const active = new Map<number, Voice>();
  const release = (noteId: number) => {
    const voice = active.get(noteId);
    if (!voice) return;
    active.delete(noteId);
    try {
      sendSixSinesEvents([{ type: NOTE_OFF, noteId, key: voice.key }]);
    } catch {
      // The synth is already stopped; allNotesOff covered this voice.
    }
  };

  // One ticker for every held note, instead of a message stream per note.
  ctx.branch(async (tick) => {
    while (true) {
      const now = tick.beats;
      const events: SixSinesEvent[] = [];
      for (const voice of active.values()) {
        const t = Math.min(
          1,
          Math.max(0, (now - voice.startBeat) / voice.durationBeats),
        );
        events.push(...expressionEvents(voice, t));
      }
      if (events.length) sendSixSinesEvents(events);
      await tick.waitSec(TICK_SEC);
    }
  }, "six-sines-expression");

  try {
    do {
      const notes = [...(getPianoRoll(ROLL)?.data.notes ?? [])]
        .filter((note) => note.duration > 0)
        .sort((a, b) => a.position - b.position) as NoteLike[];
      if (notes.length === 0) {
        playback.status = "no take recorded yet";
        await ctx.waitSec(0.5);
        continue;
      }
      playback.status = `playing ${notes.length} notes`;

      // The roll has no length field: a pass ends at the last note's end.
      const clipEnd = Math.max(...notes.map((n) => n.position + n.duration));
      let cursor = 0;
      for (const note of notes) {
        if (note.position > cursor) await ctx.wait(note.position - cursor);
        cursor = note.position;

        const noteId = allocateNoteId();
        const voice = voiceFor(note, noteId, ctx.beats);
        active.set(noteId, voice);
        sendSixSinesEvents([
          {
            type: NOTE_ON,
            noteId,
            key: voice.key,
            value: Math.max(0, Math.min(1, (note.velocity ?? 100) / 127)),
          },
          ...expressionEvents(voice, 0),
        ]);
        const handle = ctx.branch(async (noteCtx) => {
          try {
            await noteCtx.wait(note.duration);
          } finally {
            release(noteId);
          }
        }, `six-sines-note-${noteId}`);
        handle.handleCancel(() => release(noteId));
      }
      if (clipEnd > cursor) await ctx.wait(clipEnd - cursor);
    } while (playback.loop);
    playback.status = "done";
  } finally {
    stopSixSines();
  }
}

/** Graceful Stop/Replace; idempotent with the `finally` above. */
export function stop() {
  stopSixSines();
}
