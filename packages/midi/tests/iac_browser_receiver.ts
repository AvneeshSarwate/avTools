import { MidiAccess } from "../../../apps/deno-notebooks/midi/mod.ts";

const requestedName = Deno.args[0] ?? "IAC Driver Bus 1";
const midi = MidiAccess.open();
const port = midi.listInputs().find((candidate) =>
  candidate.id === requestedName || candidate.name === requestedName ||
  candidate.name.includes(requestedName)
);
if (!port) {
  throw new Error(
    `MIDI input not found: ${requestedName}. Available: ${
      midi.listInputs().map((candidate) => candidate.name).join(", ") || "none"
    }`,
  );
}

const input = midi.openInput(port.id, { rateHz: 250 });
const timeout = setTimeout(() => {
  console.error("FAIL timed out waiting for browser IAC messages");
  input.close();
  midi.close();
  Deno.exit(1);
}, 20_000);

console.log(`READY ${port.name}`);
input.onNote((event) => {
  console.log(`${event.on ? "on" : "off"}:${event.noteNum}:${event.velocity}`);
  if (!event.on && event.noteNum === 61) {
    clearTimeout(timeout);
    console.log("PASS browser IAC loopback");
    input.close();
    midi.close();
    Deno.exit(0);
  }
});
