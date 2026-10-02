import type { TimeContext } from "@avtools/core-timing";
import type {
  AbletonClip,
  AbletonNote,
  CurveValue,
} from "@avtools/music-types";
export interface NoteOutput {
  noteOn(channel: number, pitch: number, velocity: number): void;
  noteOff(channel: number, pitch: number): void;
  /** MPE expression. Optional: a notes-only output still plays the notes. */
  pitchBend?(channel: number, bend: number): void;
  channelPressure?(channel: number, pressure: number): void;
  cc?(channel: number, controller: number, value: number): void;
}

/** MPE lower zone: channel 0 is the master, notes go on 1..15. */
const MPE_MEMBER_CHANNELS = Array.from({ length: 15 }, (_, i) => i + 1);
/** Expression is resent at most this often while a note sounds. */
const EXPRESSION_TICK_SEC = 0.01;
const TIMBRE_CC = 74;
/** A note without a curve gets the MPE rest value before its note-on. */
const REST_PRESSURE = 0;
const REST_TIMBRE = 64;

/** One shared note ledger per run, so overlapping phrases cannot release each other. */
export function createNoteOutput(device?: NoteOutput) {
  const counts = new Map<
    string,
    { channel: number; pitch: number; count: number }
  >();
  // MPE channel allocation: a free channel, least recently used first, so a
  // released note's tail keeps its own bend as long as possible. With all 15
  // busy, the channel holding the fewest notes is shared.
  const channelNotes = new Map(MPE_MEMBER_CHANNELS.map((c) => [c, 0]));
  const channelUsed = new Map(MPE_MEMBER_CHANNELS.map((c) => [c, 0]));
  let useClock = 0;
  return {
    noteOn(channel: number, pitch: number, velocity = 100) {
      pitch = Math.max(0, Math.min(127, Math.round(pitch)));
      const key = `${channel}/${pitch}`;
      const entry = counts.get(key) ?? { channel, pitch, count: 0 };
      entry.count++;
      counts.set(key, entry);
      device?.noteOn(channel, pitch, velocity);
    },
    noteOff(channel: number, pitch: number) {
      pitch = Math.max(0, Math.min(127, Math.round(pitch)));
      const key = `${channel}/${pitch}`;
      const entry = counts.get(key);
      if (!entry || --entry.count > 0) return;
      counts.delete(key);
      device?.noteOff(channel, pitch);
    },
    /** Semitones from the note's pitch, scaled by the synth's bend range. */
    bend(channel: number, semitones: number, bendRange: number) {
      const bend = Math.round((semitones / Math.max(1, bendRange)) * 8192);
      device?.pitchBend?.(channel, Math.max(-8192, Math.min(8191, bend)));
    },
    pressure(channel: number, value: number) {
      device?.channelPressure?.(channel, clamp7(value));
    },
    timbre(channel: number, value: number) {
      device?.cc?.(channel, TIMBRE_CC, clamp7(value));
    },
    claimChannel(): number {
      let best = MPE_MEMBER_CHANNELS[0];
      for (const channel of MPE_MEMBER_CHANNELS) {
        const notes = channelNotes.get(channel)!;
        const bestNotes = channelNotes.get(best)!;
        if (
          notes < bestNotes ||
          (notes === bestNotes &&
            channelUsed.get(channel)! < channelUsed.get(best)!)
        ) best = channel;
      }
      channelNotes.set(best, channelNotes.get(best)! + 1);
      channelUsed.set(best, ++useClock);
      return best;
    },
    releaseChannel(channel: number) {
      const notes = channelNotes.get(channel);
      if (!notes) return;
      channelNotes.set(channel, notes - 1);
      channelUsed.set(channel, ++useClock);
    },
    release() {
      for (const entry of counts.values()) {
        device?.noteOff(entry.channel, entry.pitch);
      }
      counts.clear();
      for (const channel of MPE_MEMBER_CHANNELS) channelNotes.set(channel, 0);
    },
  };
}
export type LedgerOutput = ReturnType<typeof createNoteOutput>;

const clamp7 = (value: number) => Math.max(0, Math.min(127, Math.round(value)));

/** Linear interpolation over the curve's beat offsets; holds its end values. */
function sampleCurve(curve: CurveValue[], beat: number): number {
  if (beat <= curve[0].timeOffset) return curve[0].value;
  for (let i = 1; i < curve.length; i++) {
    const b = curve[i];
    if (beat <= b.timeOffset) {
      const a = curve[i - 1];
      const span = b.timeOffset - a.timeOffset;
      return span > 0
        ? a.value + ((beat - a.timeOffset) / span) * (b.value - a.value)
        : b.value;
    }
  }
  return curve[curve.length - 1].value;
}

const sorted = (curve?: CurveValue[]) =>
  curve?.length
    ? [...curve].sort((a, b) => a.timeOffset - b.timeOffset)
    : undefined;

/**
 * Sends a note's expression at `beat` into the note, only where it changed
 * since the last send. Notes without a curve get the rest value once.
 */
function expressionSender(
  note: AbletonNote,
  output: LedgerOutput,
  channel: number,
  bendRange: number,
) {
  const pitch = sorted(note.pitchCurve);
  const pressure = sorted(note.pressureCurve);
  const timbre = sorted(note.timbreCurve);
  const sent = { bend: NaN, pressure: NaN, timbre: NaN };
  return {
    animated: Boolean(pitch || pressure || timbre),
    send(beat: number) {
      const bend = pitch ? sampleCurve(pitch, beat) : 0;
      const p = clamp7(pressure ? sampleCurve(pressure, beat) : REST_PRESSURE);
      const t = clamp7(timbre ? sampleCurve(timbre, beat) : REST_TIMBRE);
      if (!(Math.abs(bend - sent.bend) < 1e-3)) {
        output.bend(channel, bend, bendRange);
        sent.bend = bend;
      }
      if (p !== sent.pressure) {
        output.pressure(channel, p);
        sent.pressure = p;
      }
      if (t !== sent.timbre) {
        output.timbre(channel, t);
        sent.timbre = t;
      }
    },
  };
}

/**
 * Idempotent note cleanup is necessary for shared-pitch reference counting.
 * With `mpe`, each note gets its own member channel and its pitch, pressure
 * and timbre curves play as that channel's bend, pressure and CC74; without
 * it, notes go on `channel` and the curves are ignored.
 */
export async function playClip(
  ctx: TimeContext,
  clip: AbletonClip,
  options: {
    output: LedgerOutput;
    channel: number;
    secondsPerBeat: number;
    gate: number;
    mpe?: { bendRange: number };
  },
) {
  const { output, secondsPerBeat, mpe } = options;
  let cursor = 0;
  for (
    const note of [...clip.notes].filter((n) => n.isEnabled && n.duration > 0)
      .sort((a, b) => a.position - b.position)
  ) {
    if (note.position > cursor) {
      await ctx.waitSec((note.position - cursor) * secondsPerBeat);
    }
    const pitch = Math.max(0, Math.min(127, Math.round(note.pitch)));
    const channel = mpe ? output.claimChannel() : options.channel;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      output.noteOff(channel, pitch);
      if (mpe) output.releaseChannel(channel);
    };
    const expression = mpe
      ? expressionSender(note, output, channel, mpe.bendRange)
      : null;
    // MPE sends a note's initial expression just before its note-on.
    expression?.send(0);
    output.noteOn(
      channel,
      pitch,
      Math.max(1, Math.min(127, Math.round(note.velocity))),
    );
    const holdSec = Math.max(
      0.01,
      note.duration * secondsPerBeat * options.gate,
    );
    const handle = ctx.branch(async (noteCtx) => {
      try {
        if (!expression?.animated) {
          await noteCtx.waitSec(holdSec);
          return;
        }
        for (let sec = 0; sec < holdSec - 1e-9; sec += EXPRESSION_TICK_SEC) {
          expression.send(sec / secondsPerBeat);
          await noteCtx.waitSec(Math.min(EXPRESSION_TICK_SEC, holdSec - sec));
        }
      } finally {
        release();
      }
    });
    handle.handleCancel(release);
    cursor = note.position;
  }
  if (clip.duration > cursor) {
    await ctx.waitSec((clip.duration - cursor) * secondsPerBeat);
  }
}
export default async function describe(ctx: TimeContext) {
  await ctx.waitSec(0.01);
}
