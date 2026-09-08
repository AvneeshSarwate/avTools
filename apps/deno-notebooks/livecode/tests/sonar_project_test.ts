import { assert, assertEquals } from "jsr:@std/assert@1";
import { toFileUrl } from "jsr:@std/path@1";
import { AbletonClip } from "@avtools/music-types";
import { launch } from "@avtools/core-timing";
import { createLivecodeEngine } from "@avtools/livecode-engine";
import { emit } from "@avtools/livecode-engine/events.ts";
import { getPianoRoll } from "@avtools/livecode-engine/piano_roll_store.ts";
import {
  __testingRegisterMidiOutput,
  initMidi,
} from "../helpers/midi_helpers.ts";
import { analyzeAndTransformTimedModule } from "../visualizer/analyze_transform.ts";
import { sleep, waitFor } from "./test_helpers.ts";

const project = new URL(
  "../../../livecode-tldraw/example-projects/sonar-melodies/",
  import.meta.url,
);

Deno.test("sonar port: analysis, original-pipeline parity, independent controls and event playback", async (t) => {
  const temp = await Deno.makeTempDir({ prefix: "sonar-test-" });
  const base = toFileUrl(`${temp}/`);
  const runtimeImport =
    new URL("../../../../packages/livecode-engine/runtime.ts", import.meta.url)
      .href;
  try {
    const manifest = JSON.parse(
      await Deno.readTextFile(
        new URL("project.avtools-livecode.json", project),
      ),
    );
    await t.step(
      "all canonical modules analyze without the string DSL",
      async () => {
        for (const module of manifest.modules) {
          const sourceUri = new URL(module.sourcePath, project).href;
          const sourceText = await Deno.readTextFile(new URL(sourceUri));
          const result = analyzeAndTransformTimedModule({
            moduleId: module.id,
            sourceVersion: 1,
            sourceUri,
            sourceText,
            generatedRunId: "sonar-test",
            runtimeImport,
          });
          assertEquals(result.type, "analyzeSuccess", JSON.stringify(result));
          if (result.type === "analyzeSuccess") {
            await Deno.writeTextFile(
              new URL(module.path.split("/").at(-1), base),
              result.transformedCode,
            );
          }
          assert(!sourceText.includes("buildClipFromLine"));
          assert(!sourceText.includes("TRANSFORM_REGISTRY"));
        }
        assertEquals(manifest.canvas.pianoRollViews.length, 3);
        for (const entry of manifest.data) {
          const saved = JSON.parse(
            await Deno.readTextFile(new URL(entry.path, project)),
          );
          assertEquals(saved.name, entry.name);
          assert(saved.data.notes.length > 0);
        }
      },
    );
    const { sources } = await import(new URL("sources.ts", base).href);
    const { pipelineDefaults, createPipeline } = await import(
      new URL("pipeline.ts", base).href
    );
    const { melodies, transport } = await import(
      new URL("controls.ts", base).href
    );
    const { createNoteOutput, playClip } = await import(
      new URL("playback.ts", base).href
    );
    const clip = (name: string) => {
      const s = sources[name];
      return new AbletonClip(s.name, s.duration, s.notes);
    };
    await t.step(
      "nine base/delay snapshots match the original registry with seeded ornaments",
      async () => {
        const golden = JSON.parse(
          await Deno.readTextFile(
            new URL("tests/original-pipeline-golden.json", project),
          ),
        );
        const digest = async (c: AbletonClip) => {
          const data = JSON.stringify(
            c.notes.map((n) =>
              [n.pitch, n.position, n.duration, n.velocity].map((x) =>
                Math.round(x * 1e8) / 1e8
              )
            ),
          );
          const hash = [
            ...new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(data),
              ),
            ),
          ].map((x) => x.toString(16).padStart(2, "0")).join("");
          return { duration: c.duration, notes: c.notes.length, hash };
        };
        for (const row of golden) {
          let seed = 123;
          const p = pipelineDefaults();
          const keys = [
            "transpose",
            "stretch",
            "rotate",
            "reverse",
            "ornament",
            "easing",
          ];
          keys.forEach((key, i) => {
            p.base[key] = row.values[i];
            p.delay[key] = row.values[i];
          });
          p.base.spread = row.values[6];
          const pipe = createPipeline(
            p,
            () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) /
              4294967296),
          );
          const original = clip(row.name);
          const before = JSON.stringify(original);
          const main = pipe.base(original);
          assertEquals(
            await digest(main),
            row.base,
            `${row.name}/${row.index}/base`,
          );
          assertEquals(
            await digest(pipe.delay(main)),
            row.delay,
            `${row.name}/${row.index}/delay`,
          );
          assertEquals(JSON.stringify(original), before);
        }
      },
    );
    await t.step(
      "each melody owns its params; zero stretch stays finite",
      () => {
        assert(melodies.dscale5 !== melodies.dscale7);
        assert(melodies.dscale5.base !== melodies.dscale7.base);
        const a = createPipeline(melodies.dscale5),
          b = createPipeline(melodies.dscale7);
        const before = b.base(clip("dscale7"));
        melodies.dscale5.base.transpose = 1;
        assertEquals(b.base(clip("dscale7")), before);
        melodies.dscale5.base.stretch = 0;
        assert(
          a.base(clip("dscale5")).notes.every((n: { duration: number; position: number }) =>
            Number.isFinite(n.duration) && Number.isFinite(n.position)
          ),
        );
        Object.assign(melodies.dscale5.base, pipelineDefaults().base);
      },
    );
    await t.step(
      "cancelled overlapping notes release exactly once",
      async () => {
        const messages: string[] = [];
        const out = createNoteOutput({
          noteOn: () => messages.push("on"),
          noteOff: () => messages.push("off"),
        });
        const single = new AbletonClip("held", 1, [clip("dscale5").notes[0]]);
        let cancelFirst = () => {};
        const handle = launch(async (ctx) => {
          const a = ctx.branch(async (child) => {
            await playClip(child, single, {
              output: out,
              channel: 0,
              secondsPerBeat: 1,
              gate: 1,
            });
          });
          cancelFirst = a.cancel;
          ctx.branch(async (child) => {
            await playClip(child, single, {
              output: out,
              channel: 0,
              secondsPerBeat: 1,
              gate: 1,
            });
          });
          while (true) await ctx.waitSec(0.01);
        });
        try {
          await waitFor(() => messages.length === 2, "two overlapping notes");
          cancelFirst();
          await sleep(20);
          assertEquals(messages, ["on", "on"]);
        } finally {
          handle.cancel();
          await handle.catch(() => {});
          out.release();
        }
        assertEquals(messages, ["on", "on", "off"]);
      },
    );
    await t.step(
      "canvas events play, release gates, stop and replace without stale listeners",
      async () => {
        await initMidi();
        const messages: { kind: string; pitch: number; port: string }[] = [];
        const disposers = ["sonar-test-base", "sonar-test-delay"].map((port) =>
          __testingRegisterMidiOutput({ id: port, name: port }, {
            noteOn: (_c, pitch) => {
              messages.push({ kind: "on", pitch, port });
            },
            noteOff: (_c, pitch) => {
              messages.push({ kind: "off", pitch, port });
            },
            cc: () => {},
            pitchBend: () => {},
            programChange: () => {},
            send: () => {},
            close: () => {},
          })
        );
        transport.baseOutput = "sonar-test-base";
        transport.delayOutput = "sonar-test-delay";
        transport.bpm = 300;
        for (
          const p of Object.values(melodies) as ReturnType<
            typeof pipelineDefaults
          >[]
        ) {
          p.base.stretch = 0.05;
          p.delay.stretch = 1 / 3;
          p.delayTime = 0;
        }
        const engine = createLivecodeEngine({
          log: () => {},
          onSyncTick: () => {},
          seedDemoRoll: false,
        });
        const req = {
          moduleId: "sonar/player",
          generatedRunId: "sonar-test",
          transformedModuleUri: new URL("player.ts", base).href,
        };
        const trigger = (mode: string, state: string, melody = "dscale5") =>
          emit({ type: "sonar/trigger", body: { melody, mode, state } });
        try {
          await engine.launchModule(req);
          await waitFor(
            () => Boolean(getPianoRoll("sonar/dscale5")),
            "source rolls seeded",
          );
          await sleep(20);
          assertEquals(trigger("gate", "down").delivered, 1);
          await waitFor(
            () => messages.filter((e) => e.kind === "on").length >= 2,
            "base and echo started",
          );
          trigger("gate", "up");
          await sleep(50);
          assertEquals(
            messages.filter((e) => e.kind === "on").length,
            messages.filter((e) => e.kind === "off").length,
          );
          messages.length = 0;
          melodies.dscale5.delayTime = 1;
          trigger("gate", "down");
          await waitFor(
            () => messages.some((e) => e.kind === "on"),
            "base starts before delayed echo",
          );
          trigger("gate", "up");
          await sleep(40);
          assert(
            !messages.some((e) =>
              e.kind === "on" && e.port === "sonar-test-delay"
            ),
          );
          melodies.dscale5.delayTime = 0;
          messages.length = 0;
          trigger("oneShot", "down");
          trigger("oneShot", "up");
          await waitFor(
            () =>
              messages.filter((e) => e.kind === "on").length === 12 &&
              messages.filter((e) => e.kind === "off").length === 12,
            "one-shot base and echo completed",
          );
          assert(
            messages.filter((e) => e.kind === "on").length > 2,
            "one-shot continues after button up",
          );
          assertEquals(
            messages.filter((e) => e.kind === "on").length,
            messages.filter((e) => e.kind === "off").length,
          );
          const beforeDryRun = messages.length;
          transport.dryRun = true;
          trigger("oneShot", "down");
          await sleep(250);
          assertEquals(
            messages.length,
            beforeDryRun,
            "dryRun does not reuse a live MIDI output",
          );
          transport.dryRun = false;
          await engine.launchModule({ ...req, replaceRunning: true });
          await sleep(30);
          assertEquals(trigger("gate", "down", "dscale7").delivered, 1);
          await sleep(20);
          await engine.stopModule(req.moduleId, "test");
          assertEquals(trigger("gate", "down").delivered, 0);
          await engine.launchModule(req);
          await sleep(30);
          trigger("gate", "down");
          await sleep(20);
          await engine.panicRuntime("test");
          assertEquals(trigger("gate", "down").delivered, 0);
        } finally {
          await engine.close();
          for (const dispose of disposers) dispose();
        }
      },
    );
  } finally {
    await Deno.remove(temp, { recursive: true });
  }
});
