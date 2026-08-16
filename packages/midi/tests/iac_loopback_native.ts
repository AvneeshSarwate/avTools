import { MidiAccess as NativeMidiIo } from "../../../apps/deno-notebooks/midi/mod.ts";
import { openMidiAccess } from "../mod.ts";
import { selectLoopbackPort } from "./iac_test_helpers.ts";

const requestedName = Deno.args[0];
const io = NativeMidiIo.open();
const midi = await openMidiAccess();

if (midi.backend !== "native") {
  throw new Error(`Expected automatic native backend, got ${midi.backend}`);
}

const outputPort = selectLoopbackPort(midi.listOutputs(), requestedName);
const inputPort = io.listInputs().find((port) =>
  port.id === outputPort.id || port.name === outputPort.name
);
if (!inputPort) {
  throw new Error(`No matching native input for output "${outputPort.name}"`);
}

console.log(`IAC native loopback: ${outputPort.name}`);
const input = io.openInput(inputPort.id, { rateHz: 250, keepAlive: false });
const output = await midi.openOutput(outputPort.id);
const received: string[] = [];

const done = new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("Timed out waiting for IAC note-on/note-off")),
    3_000,
  );
  input.onNote((event) => {
    received.push(`${event.on ? "on" : "off"}:${event.noteNum}`);
    if (!event.on && event.noteNum === 60) {
      clearTimeout(timeout);
      resolve();
    }
  });
});

try {
  output.noteOn(0, 60, 101);
  await new Promise((resolve) => setTimeout(resolve, 80));
  output.noteOff(0, 60, 45);
  await done;
  console.log(`PASS ${received.join(",")}`);
} finally {
  input.close();
  output.close();
  midi.close();
  io.close();
}
