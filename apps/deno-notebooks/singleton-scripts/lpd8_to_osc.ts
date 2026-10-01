// LPD8 mk2 knobs -> OSC.
//   CC 70 -> /mirage/speed     (0..2)
//   CC 71 -> /mirage/displace  (0..0.2)
//   CC 72 -> /mirage/scanlineSpeed (0..1)
// Sent to 127.0.0.1:9004 as OSC floats. Speed/displace ranges match the
// Mirage macro sliders in examples/hanoiShow/combined_landscape.ts.
//
// Run from apps/deno-notebooks:
//   deno run --allow-ffi --allow-read --allow-env --allow-net singleton-scripts/lpd8_to_osc.ts

import { Client } from "node-osc";
import { MidiAccess } from "../midi/mod.ts";

const OSC_HOST = "127.0.0.1";
const OSC_PORT = 9004;
const DEVICE_MATCH = "LPD8";

const CC_MAP: Record<number, { address: string; min: number; max: number }> = {
  70: { address: "/mirage/speed", min: 0, max: 2 },
  71: { address: "/mirage/displace", min: 0, max: 0.2 },
  72: { address: "/mirage/scanlineSpeed", min: 0, max: 1 },
};

const midi = MidiAccess.open();
const port = midi.listInputs().find((p) => p.name.includes(DEVICE_MATCH));
if (!port) {
  console.error(`No MIDI input matching "${DEVICE_MATCH}". Available:`);
  for (const p of midi.listInputs()) console.error(`  ${p.name}`);
  midi.close();
  Deno.exit(1);
}

const input = midi.openInput(port.id);
const osc = new Client(OSC_HOST, OSC_PORT);

input.onCC(({ ctrlNum, ctrlVal }) => {
  const mapping = CC_MAP[ctrlNum];
  if (!mapping) return;
  const { address, min, max } = mapping;
  const value = min + (ctrlVal / 127) * (max - min);
  // Explicit float type: node-osc would otherwise send whole numbers as ints.
  osc.send({ address, args: [{ type: "float", value }] });
  console.log(`${address} ${value.toFixed(3)}`);
});

console.log(`${port.name} -> osc://${OSC_HOST}:${OSC_PORT}  (Ctrl-C to quit)`);

Deno.addSignalListener("SIGINT", () => {
  input.close();
  midi.close();
  osc.close();
  Deno.exit(0);
});
