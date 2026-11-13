import { assertEquals } from "jsr:@std/assert@1";
import {
  __testingRegisterMidiOutput,
  __testingSoundingNoteCount,
  getMidiDevice,
  type MidiOutputTransport,
  panicMidi,
} from "../helpers/midi_helpers.ts";

Deno.test("panicMidi sends note-offs and all-notes-off controllers for tracked notes", () => {
  const sent: Array<
    | {
      type: "noteOn" | "noteOff";
      channel: number;
      pitch: number;
      velocity: number;
    }
    | { type: "cc"; channel: number; controller: number; value: number }
  > = [];
  const output: MidiOutputTransport = {
    noteOn: (channel, pitch, velocity) => {
      sent.push({ type: "noteOn", channel, pitch, velocity });
    },
    noteOff: (channel, pitch, velocity) => {
      sent.push({ type: "noteOff", channel, pitch, velocity });
    },
    cc: (channel, controller, value) => {
      sent.push({ type: "cc", channel, controller, value });
    },
    pitchBend: () => {},
    programChange: () => {},
    send: () => {},
    close: () => {},
  };

  const unregister = __testingRegisterMidiOutput({
    id: "fake-output",
    name: "Fake Output",
  }, output);
  try {
    const device = getMidiDevice("Fake Output");
    device.noteOn(2, 64, 90);
    device.noteOn(3, 67, 91);
    assertEquals(__testingSoundingNoteCount(), 2);

    panicMidi();

    assertEquals(__testingSoundingNoteCount(), 0);
    assertEquals(
      hasEvent(sent, {
        type: "noteOff",
        channel: 2,
        pitch: 64,
        velocity: 0,
      }),
      true,
    );
    assertEquals(
      hasEvent(sent, {
        type: "noteOff",
        channel: 3,
        pitch: 67,
        velocity: 0,
      }),
      true,
    );
    for (const channel of [0, 2, 3]) {
      assertEquals(
        hasEvent(sent, {
          type: "cc",
          channel,
          controller: 123,
          value: 0,
        }),
        true,
      );
      assertEquals(
        hasEvent(sent, {
          type: "cc",
          channel,
          controller: 120,
          value: 0,
        }),
        true,
      );
    }
  } finally {
    unregister();
    panicMidi();
  }
});

function hasEvent<T extends Record<string, unknown>>(
  events: readonly unknown[],
  expected: T,
): boolean {
  return events.some((event) =>
    Object.entries(expected).every(([key, value]) =>
      (event as Record<string, unknown>)[key] === value
    )
  );
}
