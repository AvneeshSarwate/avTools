import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import type { IMIDIAccess, IMIDIOutput } from "@midival/core";
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
