import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { noteName, SixSinesDrone } from "../push2/modules/six_sines_drone.ts";
import {
  dronePatch,
  openOsc,
  validateParameterTable,
} from "../push2/six_sines_osc.ts";
import { COLOR } from "../push2/constants.ts";
import type { Push2 } from "../push2/push2.ts";

const { values: options } = parseArgs({
  args: Deno.args,
  options: {
    port: { type: "string", default: "9000" },
    params: { type: "string" },
    "validate-only": { type: "boolean" },
    terminal: { type: "boolean" },
    "smoke-test": { type: "boolean" },
    "no-display": { type: "boolean" },
    "midi-port": { type: "string", default: "Ableton Push 2 Live Port" },
  },
});
const port = Number(options.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Invalid OSC port");
}
if (!options.params) {
  throw new Error(
    "Use run_push2_six_sines.sh (requires a validated host parameter table)",
  );
}
validateParameterTable(await Deno.readTextFile(options.params));
if (options["validate-only"]) Deno.exit(0);

let finish!: () => void;
const stopped = new Promise<void>((resolve) => {
  finish = resolve;
});
let failure: Error | undefined;
const osc = openOsc(port, (error) => {
  failure = error;
  finish();
});
const drone = new SixSinesDrone((messages) => osc.send(messages));
let push: Push2 | undefined;
let displayAvailable = false;
let terminal: ReturnType<typeof createInterface> | undefined;
const unsubs: (() => void)[] = [];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(signal, finish);
}

const help =
  `Tap grid: toggle drone. Shift+lit pad: select (green). Orange: other drones.
Encoders 1-6: macros / harmonics 1-6. Hold Shift for fine adjustment.
Upper buttons 1-6: reset one macro. Delete: reset selected note's six macros.
Octave up/down: +/-12. Page left/right: -/+1. Left/right: select previous/next drone.
Track 8 or Master encoder: output level (0-30%). Stop: all notes off. Ctrl+C: quit.
Terminal: on 60 | select 60 | macro 1 0.5 | reset | octave 1 | volume 0.12 | stop | status | quit
'on' toggles a MIDI note; macro values are -1..1. Initial notes use a soft harmonic blend.`;

function summary() {
  const selected = drone.selection;
  return `${drone.status}\nGrid ${
    noteName(drone.layout.baseNote)
  } | ${drone.voices.size}/12 drones: ${
    [...drone.voices.keys()].map(noteName).join(" ") || "none"
  } | Output ${(drone.volume * 100).toFixed(0)}%\n` +
    (selected
      ? `Selected ${noteName(selected.key)} (#${selected.id}): ${
        selected.macros.map((v, i) => `M${i + 1}=${v.toFixed(3)}`).join(" ")
      }`
      : "No selected note");
}

try {
  osc.send(dronePatch(drone.volume));
  // Give the audio thread a block to apply routing before accepting notes.
  await wait(150);
  if (!options.terminal && !options["smoke-test"]) {
    const { MidiAccess } = await import("../midi/midi_access.ts");
    const access = MidiAccess.open();
    let found = false;
    try {
      found = access.listInputs().some((p) =>
        p.name.includes(options["midi-port"]!)
      ) &&
        access.listOutputs().some((p) =>
          p.name.includes(options["midi-port"]!)
        );
    } finally {
      access.close();
    }
    if (found) {
      const { Push2 } = await import("../push2/push2.ts");
      push = Push2.create({ midiPortName: options["midi-port"] });
    } else {console.log(
        `No Push 2 connected (${
          options["midi-port"]
        }); using terminal controls. Connect it and restart for hardware mode.`,
      );}
  }

  if (push) {
    const device = push;
    drone.onChange = () => {
      drone.lights((pad, color) => device.setPadColor(pad, color));
      device.setButtonColor("Stop", drone.voices.size ? 127 : 20);
      if (!displayAvailable) console.log(summary());
    };
    unsubs.push(
      device.onPadPressed((_pad, [i, j], velocity) =>
        drone.press(drone.layout.midiNoteAt(i, j), velocity)
      ),
    );
    unsubs.push(device.onButtonPressed("Shift", () => {
      drone.shift = true;
    }));
    unsubs.push(device.onButtonReleased("Shift", () => {
      drone.shift = false;
    }));
    for (let i = 0; i < 6; i++) {
      unsubs.push(
        device.onEncoderRotated(
          `Track${i + 1}`,
          (delta) => drone.rotate(i, delta),
        ),
      );
      unsubs.push(
        device.onButtonPressed(`Upper${i + 1}`, () => drone.reset(i)),
      );
      device.setButtonColor(`Upper${i + 1}`, COLOR.GREEN);
    }
    const actions: Record<string, () => void> = {
      Stop: () => drone.panic(),
      Delete: () => drone.reset(),
      OctaveUp: () => drone.move(12),
      OctaveDown: () => drone.move(-12),
      PageLeft: () => drone.move(-1),
      PageRight: () => drone.move(1),
      Left: () => drone.nextSelection(-1),
      Right: () => drone.nextSelection(1),
    };
    for (const [name, action] of Object.entries(actions)) {
      unsubs.push(device.onButtonPressed(name, action));
      device.setButtonColor(name, 50);
    }
    for (const encoder of ["Track8", "Master"]) {
      unsubs.push(
        device.onEncoderRotated(encoder, (delta) =>
          drone.setVolume(
            drone.volume + delta * (drone.shift ? 0.001 : 0.005),
          )),
      );
    }
    unsubs.push(device.onButtonReleased("User", () => {
      drone.shift = false;
      device.refreshLEDs();
    }));
    drone.onChange();
    if (!options["no-display"]) {
      try {
        await device.startDisplay((p5) => {
          p5.background(12);
          p5.noStroke();
          p5.textAlign("left", "top");
          p5.fill(220);
          p5.textSize(15);
          const selected = drone.selection;
          p5.text(
            `SIX SINES | ${
              selected
                ? `EDIT ${noteName(selected.key)}  #${selected.id}`
                : "Tap a pad to start"
            } | ${drone.voices.size}/12 ON | Grid ${
              noteName(drone.layout.baseNote)
            }`,
            8,
            5,
          );
          for (let i = 0; i < 6; i++) {
            const x = i * 120 + 8, value = selected?.macros[i];
            p5.fill(150, 200, 170);
            p5.textSize(14);
            p5.text(`M${i + 1} Harm ${i + 1}`, x, 36);
            p5.fill(255);
            p5.textSize(24);
            p5.text(value?.toFixed(2) ?? "--", x, 58);
            p5.fill(40);
            p5.rect(x, 94, 104, 8);
            p5.fill(70, 220, 130);
            p5.rect(x, 94, ((value ?? -1) + 1) * 52, 8);
          }
          p5.fill(200);
          p5.textSize(14);
          p5.text("Stop: all off", 730, 38);
          p5.text(`Output ${(drone.volume * 100).toFixed(0)}%`, 842, 64);
          p5.text("Encoder 8", 842, 86);
          p5.text(drone.status, 8, 115);
          p5.fill(130);
          p5.textSize(12);
          p5.text(
            "Shift+pad: select | Shift+turn: fine | Upper 1-6: reset macro | Delete: reset all six",
            8,
            140,
          );
        }, { fps: 15 });
        displayAvailable = true;
      } catch (error) {
        console.warn(
          "Push display unavailable; LEDs, encoders and terminal still work:",
          error,
        );
      }
    }
  } else drone.onChange = () => console.log(summary());

  console.log(help);
  if (options["smoke-test"]) {
    drone.press(60);
    drone.press(67);
    await wait(250);
    drone.press(60, 80, true);
    for (let i = 0; i < 6; i++) {
      drone.setMacro(i, 0.65);
      await wait(60);
    }
    drone.press(60);
    drone.press(60); // new ID, fresh values, no stale modulation
    await wait(150);
    drone.panic();
    console.log(
      "OSC smoke sequence sent: two drones, select, six per-note macros, retrigger, all off.",
    );
  } else {
    terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Deno.stdin.isTerminal(),
    });
    terminal.on("line", (line) => {
      const [command, a, b] = line.trim().split(/\s+/);
      const integer = (v: string | undefined) =>
        v !== undefined && Number.isInteger(Number(v));
      if (
        command === "on" && integer(a) && Number(a) >= 0 && Number(a) <= 127
      ) drone.press(Number(a));
      else if (command === "select" && integer(a)) {
        drone.press(Number(a), 80, true);
      } else if (
        command === "macro" && integer(a) && Number(a) >= 1 && Number(a) <= 6 &&
        b !== undefined && Number.isFinite(Number(b))
      ) drone.setMacro(Number(a) - 1, Number(b));
      else if (
        command === "volume" && a !== undefined && Number.isFinite(Number(a))
      ) drone.setVolume(Number(a));
      else if (command === "octave" && integer(a)) drone.move(Number(a) * 12);
      else if (command === "reset") drone.reset();
      else if (command === "stop") drone.panic();
      else if (command === "quit" || command === "exit") finish();
      else if (command === "status") console.log(summary());
      else console.log(help);
      if (push && command !== "status") console.log(summary());
    });
    terminal.on("close", () => {
      if (!push) finish();
    });
    await stopped;
  }
} finally {
  terminal?.close();
  unsubs.forEach((fn) => fn());
  drone.onChange = () => {};
  drone.panic();
  await osc.close();
  if (push) {
    for (let pad = 36; pad <= 99; pad++) push.setPadColor(pad, COLOR.BLACK);
    for (
      const button of [
        "Stop",
        "Delete",
        "OctaveUp",
        "OctaveDown",
        "PageLeft",
        "PageRight",
        "Left",
        "Right",
        ...Array.from({ length: 6 }, (_, i) => `Upper${i + 1}`),
      ]
    ) push.setButtonColor(button, COLOR.BLACK);
    push.close();
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    Deno.removeSignalListener(signal, finish);
  }
}
if (failure) throw failure;
