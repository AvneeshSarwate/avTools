import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { MidiOutput, type MidiOutputTransport } from "../api.ts";

Deno.test("MidiOutput encodes the shared zero-based API", () => {
  const sent: number[][] = [];
  let closeCount = 0;
  const transport: MidiOutputTransport = {
    send: (bytes) => sent.push([...bytes]),
    close: () => closeCount++,
  };
  const output = new MidiOutput({
    id: "test",
    name: "Test",
    manufacturer: null,
  }, transport);

  output.noteOn(0, 60, 100);
  output.noteOff(15, 61, 64);
  output.polyPressure(1, 62, 63);
  output.cc(2, 74, 127);
  output.programChange(3, 10);
  output.channelPressure(4, 80);
  output.pitchBend(5, -8192);
  output.pitchBend(5, 0);
  output.pitchBend(5, 8191);
  output.allSoundOff(6);
  output.allNotesOff(6);

  assertEquals(sent, [
    [0x90, 60, 100],
    [0x8f, 61, 64],
    [0xa1, 62, 63],
    [0xb2, 74, 127],
    [0xc3, 10],
    [0xd4, 80],
    [0xe5, 0, 0],
    [0xe5, 0, 64],
    [0xe5, 127, 127],
    [0xb6, 120, 0],
    [0xb6, 123, 0],
  ]);

  output.close();
  output.close();
  assertEquals(closeCount, 1);
  assertThrows(() => output.noteOn(0, 60));
});

Deno.test("MidiOutput clamps public message values consistently", () => {
  const sent: number[][] = [];
  const output = new MidiOutput({
    id: "test",
    name: "Test",
    manufacturer: null,
  }, { send: (bytes) => sent.push([...bytes]) });

  output.noteOn(99, -4, 200);
  output.pitchBend(-10, Number.POSITIVE_INFINITY);

  assertEquals(sent, [
    [0x9f, 0, 127],
    [0xe0, 0, 64],
  ]);
});
