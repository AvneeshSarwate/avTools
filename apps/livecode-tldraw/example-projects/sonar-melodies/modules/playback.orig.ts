import type { TimeContext } from "@avtools/core-timing";
import type { AbletonClip } from "@avtools/music-types";
export interface NoteOutput {
  noteOn(channel: number, pitch: number, velocity: number): void;
  noteOff(channel: number, pitch: number): void;
}
/** One shared note ledger per run, so overlapping phrases cannot release each other. */
export function createNoteOutput(device?: NoteOutput) {
  const counts = new Map<
    string,
    { channel: number; pitch: number; count: number }
  >();
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
    release() {
      for (const entry of counts.values()) {
        device?.noteOff(entry.channel, entry.pitch);
      }
      counts.clear();
    },
  };
}

/** Idempotent note cleanup is necessary for shared-pitch reference counting. */
export async function playClip(
  ctx: TimeContext,
  clip: AbletonClip,
  options: {
    output: NoteOutput;
    channel: number;
    secondsPerBeat: number;
    gate: number;
  },
) {
  let cursor = 0;
  for (
    const note of [...clip.notes].filter((n) => n.isEnabled && n.duration > 0)
      .sort((a, b) => a.position - b.position)
  ) {
    if (note.position > cursor) {
      await ctx.waitSec((note.position - cursor) * options.secondsPerBeat);
    }
    const pitch = Math.max(0, Math.min(127, Math.round(note.pitch)));
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      options.output.noteOff(options.channel, pitch);
    };
    options.output.noteOn(
      options.channel,
      pitch,
      Math.max(1, Math.min(127, Math.round(note.velocity))),
    );
    const handle = ctx.branch(async (noteCtx) => {
      try {
        await noteCtx.waitSec(
          Math.max(0.01, note.duration * options.secondsPerBeat * options.gate),
        );
      } finally {
        release();
      }
    });
    handle.handleCancel(release);
    cursor = note.position;
  }
  if (clip.duration > cursor) {
    await ctx.waitSec((clip.duration - cursor) * options.secondsPerBeat);
  }
}
export default async function describe(ctx: TimeContext) {
  await ctx.waitSec(0.01);
}
