import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import type { IMIDIAccess, IMIDIInput, IMIDIOutput } from "@midival/core";
import { openMidiAccess } from "../browser.ts";

Deno.test("browser backend wraps MIDIVal while preserving the shared API", async () => {
  const sent: number[][] = [];
  let connectCount = 0;
  let openCount = 0;
  let closeCount = 0;
  const port = {
    id: "browser-output",
    name: "Browser Output",
    manufacturer: "Test Maker",
    send: (bytes: Uint8Array | number[]) => sent.push([...bytes]),
  } satisfies IMIDIOutput;
  const access = {
    connect: () => {
      connectCount++;
      return Promise.resolve();
    },
    inputs: [],
    outputs: [port],
    onInputConnected: () => () => {},
    onInputDisconnected: () => () => {},
    onOutputConnected: () => () => {},
    onOutputDisconnected: () => () => {},
  } satisfies IMIDIAccess;
  const webMidiPort = {
    open: () => {
      openCount++;
      return Promise.resolve();
    },
    close: () => {
      closeCount++;
      return Promise.resolve();
    },
  };
  const webMidiAccess = {
    outputs: new Map([["browser-output", webMidiPort]]),
  };

  const midi = await openMidiAccess({ access, webMidiAccess });
  assertEquals(connectCount, 1);
  assertEquals(midi.backend, "browser");
  assertEquals(midi.listOutputs(), [{
    id: "browser-output",
    name: "Browser Output",
    manufacturer: "Test Maker",
  }]);

  const output = await midi.openOutput("browser-output");
  assertEquals(openCount, 1);
  output.noteOn(0, 60, 100);
  output.pitchBend(1, 4096);
  output.noteOff(0, 60, 17);
  assertEquals(sent, [
    [0x90, 60, 100],
    [0xe1, 0, 96],
    [0x80, 60, 17],
  ]);

  midi.close();
  assertEquals(closeCount, 1);
  assertThrows(() => output.noteOn(0, 60));
  assertThrows(() => midi.listOutputs());
});

Deno.test("browser backend decodes MIDIVal input into shared events", async () => {
  type RawCallback = (
    message: { receivedTime: number; data: Uint8Array },
  ) => void;
  const callbacks = new Set<RawCallback>();
  const inputPort = {
    id: "browser-input",
    name: "Browser Input",
    manufacturer: "",
    onMessage: (callback: RawCallback) => {
      callbacks.add(callback);
      return Promise.resolve(() => callbacks.delete(callback));
    },
  } satisfies IMIDIInput;
  const access = {
    connect: () => Promise.resolve(),
    inputs: [inputPort],
    outputs: [],
    onInputConnected: () => () => {},
    onInputDisconnected: () => () => {},
    onOutputConnected: () => () => {},
    onOutputDisconnected: () => () => {},
  } satisfies IMIDIAccess;
  // MIDIVal's browser wrapper passes the DOM MIDIMessageEvent, which has
  // `timeStamp` (not the `receivedTime` its types declare).
  const deliver = (time: number, bytes: number[]) => {
    for (const cb of callbacks) {
      cb({ timeStamp: time, data: Uint8Array.from(bytes) } as unknown as {
        receivedTime: number;
        data: Uint8Array;
      });
    }
  };

  const midi = await openMidiAccess({ access });
  assertEquals(midi.listInputs(), [{
    id: "browser-input",
    name: "Browser Input",
    manufacturer: null,
  }]);

  const input = await midi.openInput("browser-input");
  const received: unknown[] = [];
  input.onMessage((event) => received.push(event));
  deliver(10, [0x91, 64, 90]);
  deliver(11, [0xF8]); // clock is dropped
  deliver(12, [0xE1, 0, 96]);
  deliver(13, [0x91, 64, 0]);
  assertEquals(received, [
    { type: "noteOn", channel: 1, note: 64, velocity: 90, timeMs: 10 },
    { type: "pitchBend", channel: 1, bend: 4096, timeMs: 12 },
    { type: "noteOff", channel: 1, note: 64, velocity: 0, timeMs: 13 },
  ]);

  midi.close();
  assertEquals(input.closed, true);
  assertEquals(callbacks.size, 0);
  assertThrows(() => midi.listInputs());
});
