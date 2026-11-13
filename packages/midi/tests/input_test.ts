import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  decodeMidiMessage,
  MidiInput,
  type MidiInputEvent,
  MidiOutput,
} from "../api.ts";

const port = { id: "test", name: "Test", manufacturer: null };

Deno.test("decodeMidiMessage mirrors the MidiOutput encoding", () => {
  const sent: number[][] = [];
  const output = new MidiOutput(port, { send: (b) => sent.push([...b]) });
  output.noteOn(0, 60, 100);
  output.noteOff(15, 61, 64);
  output.polyPressure(1, 62, 63);
  output.cc(2, 74, 127);
  output.programChange(3, 10);
  output.channelPressure(4, 80);
  output.pitchBend(5, -8192);
  output.pitchBend(5, 0);
  output.pitchBend(5, 8191);

  assertEquals(sent.map((bytes) => decodeMidiMessage(bytes, 7)), [
    { type: "noteOn", channel: 0, note: 60, velocity: 100, timeMs: 7 },
    { type: "noteOff", channel: 15, note: 61, velocity: 64, timeMs: 7 },
    { type: "polyPressure", channel: 1, note: 62, pressure: 63, timeMs: 7 },
    { type: "cc", channel: 2, controller: 74, value: 127, timeMs: 7 },
    { type: "programChange", channel: 3, program: 10, timeMs: 7 },
    { type: "channelPressure", channel: 4, pressure: 80, timeMs: 7 },
    { type: "pitchBend", channel: 5, bend: -8192, timeMs: 7 },
    { type: "pitchBend", channel: 5, bend: 0, timeMs: 7 },
    { type: "pitchBend", channel: 5, bend: 8191, timeMs: 7 },
  ]);
});

Deno.test("decodeMidiMessage normalizes and rejects edge cases", () => {
  assertEquals(decodeMidiMessage([0x92, 60, 0], 1), {
    type: "noteOff",
    channel: 2,
    note: 60,
    velocity: 0,
    timeMs: 1,
  });
  assertEquals(decodeMidiMessage([], 0), null);
  assertEquals(decodeMidiMessage([0x40, 1, 2], 0), null); // no status byte
  assertEquals(decodeMidiMessage([0xF8], 0), null); // clock
  assertEquals(decodeMidiMessage([0xF0, 0x7E, 0xF7], 0), null); // SysEx
  assertEquals(decodeMidiMessage([0x90, 60], 0), null); // truncated
  assertEquals(decodeMidiMessage([0xC0], 0), null); // truncated
});

Deno.test("MidiInput dispatches in order, filters by type, and closes", async () => {
  let emit: (event: MidiInputEvent) => void = () => {};
  let transportClosed = 0;
  const input = await MidiInput.open(port, (e) => {
    emit = e;
    return { close: () => transportClosed++ };
  });

  const all: string[] = [];
  const notes: number[] = [];
  input.onMessage((event) => all.push(event.type));
  const offNoteOn = input.on("noteOn", (event) => notes.push(event.note));
  // A throwing listener must not stop the others.
  const originalError = console.error;
  console.error = () => {};
  input.onMessage(() => {
    throw new Error("listener failure");
  });

  try {
    emit({ type: "noteOn", channel: 0, note: 60, velocity: 1, timeMs: 0 });
    emit({ type: "cc", channel: 0, controller: 1, value: 2, timeMs: 1 });
    offNoteOn();
    emit({ type: "noteOn", channel: 0, note: 62, velocity: 1, timeMs: 2 });
  } finally {
    console.error = originalError;
  }

  assertEquals(all, ["noteOn", "cc", "noteOn"]);
  assertEquals(notes, [60]);

  input.close();
  input.close();
  assertEquals(transportClosed, 1);
  assertEquals(input.closed, true);
  emit({ type: "noteOn", channel: 0, note: 64, velocity: 1, timeMs: 3 });
  assertEquals(all.length, 3);
  assertThrows(() => input.onMessage(() => {}));
});
