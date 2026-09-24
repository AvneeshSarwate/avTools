import { openMidiAccess } from "../mod.ts";
import { selectLoopbackPort } from "./iac_test_helpers.ts";

const requestedName = Deno.args[0];
const midi = await openMidiAccess();

if (midi.backend !== "native") {
  throw new Error(`Expected automatic native backend, got ${midi.backend}`);
}

const outputPort = selectLoopbackPort(midi.listOutputs(), requestedName);
const inputPort = midi.listInputs().find((port) =>
  port.id === outputPort.id || port.name === outputPort.name
);
if (!inputPort) {
  throw new Error(`No matching native input for output "${outputPort.name}"`);
}

console.log(`IAC native loopback: ${outputPort.name}`);
const input = await midi.openInput(inputPort.id);
const output = await midi.openOutput(outputPort.id);
const received: string[] = [];
const expected = ["noteOn:60:101", "cc:74:1", "cc:74:2", "noteOff:60:45"];

const done = new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error(`Timed out; received ${received.join(",")}`)),
    3_000,
  );
  input.onMessage((event) => {
    if (event.type === "noteOn" || event.type === "noteOff") {
      received.push(`${event.type}:${event.note}:${event.velocity}`);
    } else if (event.type === "cc") {
      received.push(`cc:${event.controller}:${event.value}`);
    }
    if (event.type === "noteOff" && event.note === 60) {
      clearTimeout(timeout);
      resolve();
    }
  });
});

try {
  output.noteOn(0, 60, 101);
  // Two CCs inside one dispatch tick: both must arrive (no coalescing).
  output.cc(0, 74, 1);
  output.cc(0, 74, 2);
  await new Promise((resolve) => setTimeout(resolve, 80));
  output.noteOff(0, 60, 45);
  await done;
  if (received.join(",") !== expected.join(",")) {
    throw new Error(
      `Expected ${expected.join(",")}, got ${received.join(",")}`,
    );
  }
  console.log(`PASS ${received.join(",")}`);
} finally {
  midi.close();
}
