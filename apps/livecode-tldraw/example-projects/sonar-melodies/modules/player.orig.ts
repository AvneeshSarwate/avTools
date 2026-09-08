import type { TimeContext } from "@avtools/core-timing";
import { AbletonClip } from "@avtools/music-types";
import * as events from "canvas-events";
import { getPianoRoll } from "piano-roll-store";
import { getPianoRollClip, setPianoRollClip } from "piano-roll-helpers";
import { getMidiDevice } from "midi-helpers";
import { melodies, transport } from "./controls.ts";
import { type MelodyName, melodyNames, sources } from "./sources.ts";
import { createNoteOutput, playClip } from "./playback.ts";
import { createPipeline } from "./pipeline.ts";

export default async function run(ctx: TimeContext) {
  for (const name of melodyNames) {
    if (!getPianoRoll(`sonar/${name}`)) {
      const s = sources[name];
      setPianoRollClip(
        `sonar/${name}`,
        new AbletonClip(s.name, s.duration, s.notes),
      );
    }
  }
  const outputs = new Map<string, ReturnType<typeof createNoteOutput>>();
  const output = (name: string) => {
    const key = `${transport.dryRun ? "dry" : "midi"}/${name}`;
    if (!outputs.has(key)) {
      outputs.set(
        key,
        createNoteOutput(transport.dryRun ? undefined : getMidiDevice(name)),
      );
    }
    return outputs.get(key)!;
  };
  // These are intentionally three distinct pipeline instances and live objects.
  const pipelines = {
    dscale5: createPipeline(melodies.dscale5),
    dscale7: createPipeline(melodies.dscale7),
    d7mel: createPipeline(melodies.d7mel),
  };
  type Handle = ReturnType<TimeContext["branch"]>;
  const active = new Map<MelodyName, Set<Handle>>(
    melodyNames.map((n) => [n, new Set()]),
  );
  const gates = new Map<string, Handle>();
  const pending: events.LivecodeEvent[] = [];
  events.onEvent((event) => {
    if (event.type === "sonar/trigger" || event.type === "sonar/stop") {
      pending.push(event);
    }
  });
  try {
    while (true) {
      ctx.setBpm(transport.bpm);
      for (const event of pending.splice(0)) {
        const body = event.body;
        if (!body || !Object.hasOwn(pipelines, body.melody)) continue;
        const name = body.melody as MelodyName;
        const gateKey = `${name}/${body.origin ?? "ui"}`;
        if (event.type === "sonar/stop") {
          if (body.state === "down") {
            for (const task of active.get(name)!) task.cancel();
          }
          continue;
        }
        if (body.mode !== "oneShot" && body.mode !== "gate") continue;
        if (body.state === "up") {
          if (body.mode === "gate") {
            gates.get(gateKey)?.cancel();
            gates.delete(gateKey);
          }
          continue;
        }
        if (body.state !== "down") continue;
        if (body.mode === "gate") gates.get(gateKey)?.cancel();
        const pipeline = pipelines[name];
        const source = getPianoRollClip(`sonar/${name}`);
        // Roll data has no loop-length field: keep original trailing silence,
        // extending it if an edit adds notes beyond the original phrase.
        source.duration = Math.max(source.duration, sources[name].duration);
        const base = pipeline.base(source);
        const delayBeats = pipeline.delayBeats();
        const p = melodies[name];
        const secondsPerBeat = 60 / Math.max(20, Math.min(300, transport.bpm));
        const channel = Math.max(
          0,
          Math.min(15, Math.round(transport.channel)),
        );
        try {
          const baseOut = output(transport.baseOutput);
          const delayOut = p.delayEnabled
            ? output(transport.delayOutput)
            : baseOut;
          // Preserve the old external s6 mapping; the rack decides note-length meaning.
          if (!transport.dryRun) {
            getMidiDevice(transport.baseOutput).cc(
              channel,
              76,
              p.noteLength * 127,
            );
          }
          const handle = ctx.branch(async (phraseCtx) => {
            await Promise.all([
              phraseCtx.branchWait(async (baseCtx) => {
                await playClip(baseCtx, base, {
                  output: baseOut,
                  channel,
                  secondsPerBeat,
                  gate: 0.98,
                });
              }),
              phraseCtx.branchWait(async (delayCtx) => {
                if (!p.delayEnabled) return;
                await delayCtx.waitSec(delayBeats * secondsPerBeat);
                // As in the original, delay knobs are sampled when the echo begins.
                const echo = pipeline.delay(base);
                await playClip(delayCtx, echo, {
                  output: delayOut,
                  channel,
                  secondsPerBeat,
                  gate: 0.98,
                });
              }),
            ]);
          }, `${name}/${body.mode}`);
          active.get(name)!.add(handle);
          if (body.mode === "gate") gates.set(gateKey, handle);
          void handle.finally(() => {
            active.get(name)!.delete(handle);
            if (gates.get(gateKey) === handle) gates.delete(gateKey);
          }).catch(() => {});
        } catch (error) {
          console.error(`[sonar] ${name}:`, error);
        }
      }
      await ctx.waitSec(0.005);
    }
  } finally {
    for (const tasks of active.values()) {
      for (const task of tasks) task.cancel();
    }
    for (const port of outputs.values()) port.release();
    pending.length = 0;
  }
}
