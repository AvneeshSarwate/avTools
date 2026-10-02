import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import { toFileUrl } from "jsr:@std/path@1";
import { AbletonClip } from "@avtools/music-types";
import { launch } from "@avtools/core-timing";
import { createLivecodeEngine } from "@avtools/livecode-engine";
import { emit } from "@avtools/livecode-engine/events.ts";
import { getPianoRoll } from "@avtools/livecode-engine/piano_roll_store.ts";
import { listSignals } from "@avtools/livecode-engine/signals_store.ts";
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
    const { melodies, transport, beatstep } = await import(
      new URL("controls.ts", base).href
    );
    const {
      createBeatstepController,
      TOP_ROW_NOTES,
      BOTTOM_ROW_NOTES,
      ENCODER_CCS,
    } = await import(new URL("beatstep.ts", base).href);
    const { createClockMapper, createTakeRecorder, takeToRollNotes } =
      await import(new URL("recording.ts", base).href);
    const { createNoteOutput, playClip } = await import(
      new URL("playback.ts", base).href
    );
    const { easeCirc, ornamentClip } = await import(
      new URL("transforms.ts", base).href
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
          a.base(clip("dscale5")).notes.every((
            n: { duration: number; position: number },
          ) => Number.isFinite(n.duration) && Number.isFinite(n.position)),
        );
        Object.assign(melodies.dscale5.base, pipelineDefaults().base);
      },
    );
    await t.step(
      "BeatStep: LPD8 launch columns, stop, record, radio focus, follow toggle, encoders",
      () => {
        const snapshot = JSON.stringify(melodies);
        const triggers: { type: string; body: Record<string, unknown> }[] = [];
        const leds = new Map<number, boolean>();
        const ledSends: number[] = [];
        const canvas: string[] = [];
        const settings = {
          focus: "dscale5",
          followFocus: true,
          encoderMode: "delta",
        };
        const pads = createBeatstepController({
          melodies,
          settings,
          trigger: (event: { type: string; body: Record<string, unknown> }) =>
            triggers.push(event),
          setLed: (note: number, on: boolean) => {
            leds.set(note, on);
            ledSends.push(note);
          },
          focusCanvas: (name: string) => canvas.push(name),
        });
        const note = (on: boolean, n: number) =>
          pads.handle({
            type: on ? "noteOn" : "noteOff",
            channel: 0,
            note: n,
            velocity: on ? 100 : 0,
            timeMs: 0,
          });
        const tap = (n: number) => {
          note(true, n);
          note(false, n);
        };
        const cc = (controller: number, value: number) =>
          pads.handle({ type: "cc", channel: 0, controller, value, timeMs: 0 });
        try {
          // Columns 1-3: top one-shot, bottom gate, one melody per column.
          tap(TOP_ROW_NOTES[0]);
          note(true, BOTTOM_ROW_NOTES[1]);
          note(false, BOTTOM_ROW_NOTES[1]);
          assertEquals(
            triggers.map((e) => [e.body.melody, e.body.mode, e.body.state]),
            [
              ["dscale5", "oneShot", "down"],
              ["dscale5", "oneShot", "up"],
              ["dscale7", "gate", "down"],
              ["dscale7", "gate", "up"],
            ],
          );
          assert(triggers.every((e) => e.body.origin === "beatstep"));
          // Columns 4-6: stop on top (press only), record toggle on the bottom.
          triggers.length = 0;
          tap(TOP_ROW_NOTES[5]);
          assertEquals(triggers, [{
            type: "sonar/stop",
            body: { melody: "d7mel", state: "down" },
          }]);
          tap(BOTTOM_ROW_NOTES[3]);
          assertEquals(melodies.dscale5.record, true);
          assertEquals(leds.get(BOTTOM_ROW_NOTES[3]), true, "record pad lit");
          tap(BOTTOM_ROW_NOTES[3]);
          assertEquals(melodies.dscale5.record, false);
          assertEquals(leds.get(BOTTOM_ROW_NOTES[3]), false);

          // Focus radio: top 7, top 8, bottom 7. One lit at a time.
          pads.resendLeds();
          assertEquals(leds.get(TOP_ROW_NOTES[6]), true, "initial focus lit");
          note(true, TOP_ROW_NOTES[7]);
          assertEquals(settings.focus, "dscale7");
          assertEquals(canvas, ["dscale7"]);
          assertEquals(leds.get(TOP_ROW_NOTES[6]), false, "old focus cleared");
          assertEquals(leds.get(TOP_ROW_NOTES[7]), true);
          ledSends.length = 0;
          note(false, TOP_ROW_NOTES[7]);
          assertEquals(
            ledSends,
            [TOP_ROW_NOTES[7]],
            "a released lit pad is relit (the BeatStep turned it off)",
          );
          // Pressing the focused pad again still moves the canvas.
          tap(TOP_ROW_NOTES[7]);
          assertEquals(canvas, ["dscale7", "dscale7"]);
          // Bottom right toggles whether focus moves the canvas.
          assertEquals(leds.get(BOTTOM_ROW_NOTES[7]), true);
          tap(BOTTOM_ROW_NOTES[7]);
          assertEquals(settings.followFocus, false);
          assertEquals(leds.get(BOTTOM_ROW_NOTES[7]), false);
          tap(BOTTOM_ROW_NOTES[6]);
          assertEquals(settings.focus, "d7mel");
          assertEquals(canvas.length, 2, "no canvas move while follow is off");
          // A pane-side focus change shows on the pads at the next refresh.
          settings.focus = "dscale5";
          pads.refreshLeds();
          assertEquals(leds.get(TOP_ROW_NOTES[6]), true);
          assertEquals(leds.get(BOTTOM_ROW_NOTES[6]), false);

          // Encoders edit the focused melody only. Delta mode: the first
          // message sets a baseline, so a focus change never jumps a value.
          const other = JSON.stringify(melodies.dscale7);
          // The mapping as measured on the owner's unit: CC 10 is base
          // transpose, CC 73 base spread, CC 75 the note-length CC.
          assertEquals(ENCODER_CCS[0], 10);
          const start = melodies.dscale5.base.transpose;
          cc(10, 100);
          assertEquals(melodies.dscale5.base.transpose, start);
          cc(10, 106);
          assertAlmostEquals(melodies.dscale5.base.transpose, start + 6 / 127);
          cc(ENCODER_CCS[15], 64);
          cc(ENCODER_CCS[15], 65);
          assertEquals(melodies.dscale5.delayEnabled, true);
          cc(ENCODER_CCS[15], 60);
          assertEquals(melodies.dscale5.delayEnabled, false);
          settings.encoderMode = "relative1";
          const stretch = melodies.dscale5.base.stretch;
          cc(ENCODER_CCS[1], 66);
          assertAlmostEquals(melodies.dscale5.base.stretch, stretch + 2 / 127);
          settings.encoderMode = "relative2";
          cc(ENCODER_CCS[1], 127);
          assertAlmostEquals(melodies.dscale5.base.stretch, stretch + 1 / 127);
          settings.encoderMode = "absolute";
          cc(ENCODER_CCS[14], 127);
          assertEquals(melodies.dscale5.delayTime, 1);
          cc(73, 127);
          assertEquals(melodies.dscale5.base.spread, 1);
          cc(75, 0);
          assertEquals(melodies.dscale5.noteLength, 0);
          cc(ENCODER_CCS[8], 127);
          assertEquals(melodies.dscale5.delay.transpose, 1);
          assertEquals(JSON.stringify(melodies.dscale7), other);

          // Note 41 toggles recording on whichever melody has focus, and is
          // lit while that melody records.
          tap(41);
          assertEquals(melodies.dscale5.record, true);
          assertEquals(leds.get(41), true);
          settings.focus = "dscale7";
          pads.refreshLeds();
          assertEquals(leds.get(41), false, "the newly focused bank is idle");
          tap(41);
          assertEquals(melodies.dscale7.record, true);
          assertEquals(
            melodies.dscale5.record,
            true,
            "the other take continues",
          );
          tap(41);
          settings.focus = "dscale5";
          tap(41);
          assertEquals([melodies.dscale5.record, melodies.dscale7.record], [
            false,
            false,
          ]);
          pads.allLedsOff();
          assert([...leds.values()].every((on) => !on));
        } finally {
          const saved = JSON.parse(snapshot);
          for (const name of Object.keys(saved)) {
            Object.assign(melodies[name].base, saved[name].base);
            Object.assign(melodies[name].delay, saved[name].delay);
            const { base: _b, delay: _d, ...rest } = saved[name];
            Object.assign(melodies[name], rest);
          }
        }
      },
    );
    await t.step("recording: takes become roll notes, quantized or not", () => {
      let engineNow = 100;
      const clock = createClockMapper(() => engineNow);
      const at = (timeMs: number) => ({
        type: "noteOn" as const,
        channel: 0,
        note: 60,
        velocity: 90,
        timeMs,
      });
      assertEquals(clock.toEngineSec(at(5000)), 100);
      engineNow = 100.5; // delivered late: keeps its device spacing
      assertEquals(clock.toEngineSec(at(5100)), 100.1);

      const recorder = createTakeRecorder();
      recorder.handle(at(0), 1); // not recording yet: ignored
      recorder.start(10);
      const on = (note: number, sec: number) =>
        recorder.handle(
          { type: "noteOn", channel: 0, note, velocity: 90, timeMs: 0 },
          sec,
        );
      const off = (note: number, sec: number) =>
        recorder.handle(
          { type: "noteOff", channel: 0, note, velocity: 0, timeMs: 0 },
          sec,
        );
      on(60, 10.52);
      off(60, 11.0);
      on(64, 11.01);
      const notes = recorder.finish(12); // 64 still held: closes at 12
      assertEquals(recorder.recording, false);
      const exact = takeToRollNotes(notes, {
        secondsPerBeat: 0.5,
        quantize: 0,
        bendRange: 48,
      });
      assertEquals(exact.notes.map((n: { pitch: number }) => n.pitch), [
        60,
        64,
      ]);
      assertAlmostEquals(exact.notes[0].position, 0);
      assertAlmostEquals(exact.notes[1].position, 0.98);
      assertAlmostEquals(exact.notes[0].duration, 0.96);
      assertEquals(exact.lengthBeats, 3);
      const snapped = takeToRollNotes(notes, {
        secondsPerBeat: 0.5,
        quantize: 0.5,
        bendRange: 48,
      });
      assertEquals(
        snapped.notes.map((n: { position: number; duration: number }) => [
          n.position,
          n.duration,
        ]),
        [[0, 1], [1, 2]],
      );
      recorder.start(20);
      assertEquals(recorder.finish(21), null, "an empty take writes nothing");
    });
    await t.step("recording: MPE expression becomes roll curves", () => {
      const recorder = createTakeRecorder();
      const send = (event: Record<string, unknown>, sec: number) =>
        recorder.handle({ timeMs: 0, ...event }, sec);
      // Sent before the take starts: the note's initial values still count.
      send({ type: "pitchBend", channel: 2, bend: 0 }, 9);
      send({ type: "cc", channel: 2, controller: 74, value: 30 }, 9);
      recorder.start(10);
      send({ type: "noteOn", channel: 2, note: 60, velocity: 90 }, 10);
      send({ type: "noteOn", channel: 3, note: 64, velocity: 90 }, 10);
      send({ type: "pitchBend", channel: 2, bend: 4096 }, 10.5); // +24 at 48
      send({ type: "channelPressure", channel: 2, pressure: 100 }, 10.5);
      send({ type: "noteOff", channel: 2, note: 60, velocity: 0 }, 11);
      send({ type: "noteOff", channel: 3, note: 64, velocity: 0 }, 11);
      const take = takeToRollNotes(recorder.finish(12), {
        secondsPerBeat: 1,
        quantize: 0,
        bendRange: 48,
      });
      const [bent, plain] = take.notes;
      assertEquals(bent.mpePitch.points.at(-1).pitchOffset, 24);
      assertEquals(bent.mpePitch.points[0], { time: 0, pitchOffset: 0 });
      assertEquals(
        bent.mpePressure.points.map((p: { value: number }) => p.value),
        [0, 100, 100],
      );
      assertEquals(bent.mpeTimbre.points, [{ time: 0, value: 30 }, {
        time: 1,
        value: 30,
      }]);
      // Another channel's expression is not this note's.
      assertEquals(
        [plain.mpePitch, plain.mpePressure, plain.mpeTimbre],
        [undefined, undefined, undefined],
      );
    });
    await t.step("transforms that change note length carry the curves", () => {
      const curved = new AbletonClip("curved", 4, [{
        pitch: 62,
        position: 0,
        duration: 2,
        velocity: 100,
        offVelocity: 100,
        probability: 1,
        isEnabled: true,
        pitchCurve: [0, 2].map((timeOffset) => ({
          timeOffset,
          value: timeOffset,
          x1: 0.5,
          y1: 0.5,
          x2: 0.5,
          y2: 0.5,
        })),
      }]);
      const eased = easeCirc(curved, 0).notes[0];
      assertAlmostEquals(eased.pitchCurve.at(-1).timeOffset, eased.duration);
      assertEquals(curved.notes[0].pitchCurve?.[1].timeOffset, 2);
      const ornament = ornamentClip(curved, 1, "dR7", () => 0).notes;
      assertEquals(ornament.length, 3);
      for (const [i, note] of ornament.entries()) {
        const curve = note.pitchCurve;
        assertAlmostEquals(curve[0].value, (2 * i) / 3);
        assertAlmostEquals(curve.at(-1).value, (2 * (i + 1)) / 3);
        assertAlmostEquals(curve.at(-1).timeOffset, note.duration);
      }
    });
    await t.step(
      "MPE playback: a channel per note, expression before note-on",
      async () => {
        const messages: string[] = [];
        const out = createNoteOutput({
          noteOn: (c: number, p: number) => messages.push(`on ${c} ${p}`),
          noteOff: (c: number, p: number) => messages.push(`off ${c} ${p}`),
          pitchBend: (c: number, b: number) => messages.push(`bend ${c} ${b}`),
          channelPressure: (c: number, v: number) =>
            messages.push(`pressure ${c} ${v}`),
          cc: (c: number, n: number, v: number) =>
            messages.push(`cc ${c} ${n} ${v}`),
        });
        const note = (pitch: number, curve?: number) => ({
          pitch,
          position: 0,
          duration: 0.05,
          velocity: 100,
          offVelocity: 100,
          probability: 1,
          isEnabled: true,
          pitchCurve: curve === undefined ? undefined : [
            { timeOffset: 0, value: 0, x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 },
            {
              timeOffset: 0.05,
              value: curve,
              x1: 0.5,
              y1: 0.5,
              x2: 0.5,
              y2: 0.5,
            },
          ],
        });
        const chord = new AbletonClip("chord", 0.05, [note(60, 12), note(64)]);
        const play = (mpe?: { bendRange: number }) => {
          const handle = launch(async (ctx) => {
            await playClip(ctx, chord, {
              output: out,
              channel: 0,
              secondsPerBeat: 1,
              gate: 1,
              mpe,
            });
            await ctx.waitSec(0.05);
          });
          return handle;
        };
        await play({ bendRange: 48 });
        assertEquals(messages.slice(0, 4), [
          "bend 1 0",
          "pressure 1 0",
          "cc 1 74 64",
          "on 1 60",
        ]);
        assert(messages.includes("on 2 64"), "second note gets channel 2");
        // +12 of 48 semitones is 2048; the last tick lands just before it.
        const bends = messages.filter((m) => m.startsWith("bend 1 "))
          .map((m) => Number(m.split(" ")[2]));
        assert(bends.length > 2, "the bend is resent while the note sounds");
        assert(Math.max(...bends) > 1500 && Math.max(...bends) <= 2048);
        assert(
          !messages.some((m) => m.startsWith("bend 2 ") && m !== "bend 2 0"),
        );
        assertEquals(messages.filter((m) => m.startsWith("off")).sort(), [
          "off 1 60",
          "off 2 64",
        ]);
        messages.length = 0;
        await play();
        assertEquals(messages.sort(), [
          "off 0 60",
          "off 0 64",
          "on 0 60",
          "on 0 64",
        ], "without MPE the curves are ignored");
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
          p.delayEnabled = true; // Exercise echo playback explicitly; it defaults off.
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
        // Never auto-select a real BeatStep attached to the machine running
        // the tests; a missing name just reports that it could not open.
        beatstep.device = "sonar-test-no-beatstep";
        // A toggle left on must not start a take on the next run.
        melodies.d7mel.record = true;
        try {
          await engine.launchModule(req);
          await waitFor(
            () => Boolean(getPianoRoll("sonar/dscale5")),
            "source rolls seeded",
          );
          await waitFor(() => !melodies.d7mel.record, "stale record cleared");
          await waitFor(
            () => beatstep.status === "could not open sonar-test-no-beatstep",
            "BeatStep status reports the missing device",
          );
          melodies.dscale5.record = true;
          await waitFor(
            () => melodies.dscale5.recordStatus.startsWith("recording"),
            "record toggle starts a take",
          );
          melodies.dscale5.record = false;
          await waitFor(
            () =>
              melodies.dscale5.recordStatus ===
                "no notes recorded; roll unchanged",
            "an empty take leaves the roll alone",
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

          // Preview plays the roll as written: transforms and echo ignored.
          const preview = (state: string, melody = "dscale5") =>
            emit({ type: "sonar/preview", body: { melody, state } });
          const playhead = () =>
            listSignals().find((s) => s.name === "sonar/dscale5/preview")
              ?.value;
          const rollPitches = getPianoRoll("sonar/dscale5")!.data.notes
            .map((n) => n.pitch).sort((a, b) => a - b);
          const ons = () => messages.filter((e) => e.kind === "on");
          const balanced = () =>
            ons().length === messages.filter((e) => e.kind === "off").length;
          messages.length = 0;
          melodies.dscale5.base.transpose = 1;
          preview("down");
          preview("up");
          await waitFor(
            () => typeof playhead() === "number",
            "preview playhead moves",
          );
          await waitFor(
            () => ons().length === rollPitches.length && balanced(),
            "preview completed",
          );
          await waitFor(() => playhead() === null, "playhead cleared");
          assertEquals(
            ons().map((e) => e.pitch).sort((a, b) => a - b),
            rollPitches,
            "preview ignores transforms",
          );
          assert(
            messages.every((e) => e.port === "sonar-test-base"),
            "preview has no echo",
          );
          melodies.dscale5.base.transpose = 0.5;
          // A second press restarts rather than stacking.
          messages.length = 0;
          preview("down");
          await waitFor(() => ons().length >= 2, "preview started");
          preview("down");
          await waitFor(
            () =>
              ons().length >= rollPitches.length + 2 && balanced() &&
              playhead() === null,
            "restarted preview completed",
          );
          assertEquals(ons().length, rollPitches.length + 2);
          // The melody's stop ends a preview and its playhead.
          messages.length = 0;
          preview("down");
          await waitFor(() => ons().length >= 1, "preview started again");
          emit({
            type: "sonar/stop",
            body: { melody: "dscale5", state: "down" },
          });
          await waitFor(
            () => balanced() && playhead() === null,
            "stop ends the preview",
          );
          await sleep(700);
          assert(
            ons().length < rollPitches.length,
            "stopped preview stays stopped",
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
          // `delivered` counts listeners whatever the type, so a probe shows
          // when the replacement's listener is live without playing anything.
          await waitFor(
            () => emit({ type: "sonar/probe", body: {} }).delivered === 1,
            "the replacement's listener is registered",
          );
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
