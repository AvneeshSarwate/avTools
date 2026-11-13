import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { createSocket } from "node:dgram";
import { SixSinesDrone } from "./modules/six_sines_drone.ts";
import { COLOR, padIJToN } from "./constants.ts";
import {
  DEFAULT_MACROS,
  dronePatch,
  encodeBundle,
  MACRO_IDS,
  openOsc,
  type OscMessage,
  validateParameterTable,
} from "./six_sines_osc.ts";

function setup() {
  const sent: OscMessage[][] = [];
  return { sent, drone: new SixSinesDrone((messages) => sent.push(messages)) };
}

Deno.test("latch, select without retrigger, isolate edits, new ID on retrigger", () => {
  const { drone, sent } = setup();
  drone.press(60);
  const first = drone.selection!.id;
  equal(sent[0][0].address, "/note/on");
  equal(sent[0].length, 7);
  drone.press(67);
  const other = drone.selection!;
  const count = sent.length;
  drone.press(60, 80, true);
  equal(sent.length, count);
  equal(drone.voices.size, 2);
  for (let i = 0; i < 6; i++) {
    drone.setMacro(i, 0.75);
    deepEqual(sent.at(-1)![0], {
      address: "/param/mod",
      types: "iidiii",
      args: [first, MACRO_IDS[i], 0.75, 60, 0, 0],
    });
  }
  deepEqual(other.macros, DEFAULT_MACROS);
  drone.press(60);
  equal(sent.at(-1)![0].address, "/note/off");
  equal(sent.at(-1)![0].args[0], first);
  equal(drone.selected, 67);
  drone.press(60);
  ok(drone.selection!.id > first);
  deepEqual(drone.selection!.macros, DEFAULT_MACROS);
});

Deno.test("inactive Shift pad never starts a note or changes selection", () => {
  const { drone, sent } = setup();
  drone.press(60);
  const count = sent.length;
  drone.press(61, 80, true);
  equal(drone.selected, 60);
  equal(sent.length, count);
  equal(drone.voices.size, 1);
});

Deno.test("fine adjustment, clamping and reset preserve other voices", () => {
  const { drone } = setup();
  drone.press(60);
  drone.rotate(0, 2);
  equal(drone.selection!.macros[0], 0.02);
  drone.shift = true;
  drone.rotate(0, -1);
  equal(drone.selection!.macros[0], 0.019);
  drone.setMacro(0, -100);
  equal(drone.selection!.macros[0], -1);
  drone.setMacro(1, 100);
  equal(drone.selection!.macros[1], 1);
  drone.reset(0);
  equal(drone.selection!.macros[0], DEFAULT_MACROS[0]);
  drone.reset();
  deepEqual(drone.selection!.macros, DEFAULT_MACROS);
});

Deno.test("duplicate pitches share lights and toggle; navigation preserves held notes", () => {
  const { drone, sent } = setup();
  const key = drone.layout.midiNoteAt(7, 5);
  equal(key, drone.layout.midiNoteAt(6, 0));
  drone.press(key);
  const lights = new Map<number, number>();
  drone.lights((pad, color) => lights.set(pad, color));
  equal(lights.get(padIJToN(7, 5)), COLOR.GREEN);
  equal(lights.get(padIJToN(6, 0)), COLOR.GREEN);
  const count = sent.length;
  drone.move(1200);
  equal(drone.layout.baseNote, 85);
  equal(drone.layout.midiNoteAt(0, 7), 127);
  drone.move(-1200);
  equal(drone.layout.baseNote, 0);
  equal(sent.length, count);
  ok(drone.voices.has(key));
  drone.press(key);
  equal(drone.voices.size, 0);
});

Deno.test("voice limit, invalid notes, hidden-note selection and panic", () => {
  const { drone, sent } = setup();
  for (let key = 60; key < 74; key++) drone.press(key);
  equal(drone.voices.size, 12);
  drone.press(-1);
  drone.press(128);
  drone.press(NaN);
  equal(drone.voices.size, 12);
  drone.move(-36);
  drone.nextSelection(1);
  equal(drone.selected, 60);
  drone.panic();
  equal(drone.voices.size, 0);
  equal(drone.selected, null);
  deepEqual(sent.at(-1)![0].args, [-1, -1, 0, 0, 0]);
  const count = sent.length;
  drone.rotate(0, 1);
  equal(sent.length, count);
});

Deno.test("OSC wire types and immediate bundle; UDP preserves note-before-mod order", async () => {
  const receiver = createSocket("udp4");
  await new Promise<void>((resolve) => receiver.bind(0, "127.0.0.1", resolve));
  const received = new Promise<Uint8Array>((resolve) =>
    receiver.once("message", resolve)
  );
  const errors: Error[] = [];
  const client = openOsc(
    (receiver.address() as { port: number }).port,
    (error) => errors.push(error),
  );
  try {
    const drone = new SixSinesDrone(client.send);
    drone.press(60);
    const bytes = await received;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    equal(new TextDecoder().decode(bytes.subarray(0, 8)), "#bundle\0");
    equal(view.getUint32(12), 1);
    let offset = 16;
    const strings = (start: number) => {
      const end = bytes.indexOf(0, start);
      return {
        value: new TextDecoder().decode(bytes.subarray(start, end)),
        next: start + Math.ceil((end - start + 1) / 4) * 4,
      };
    };
    for (let i = 0; i < 7; i++) {
      const size = view.getUint32(offset);
      const address = strings(offset + 4), tags = strings(address.next);
      equal(address.value, i === 0 ? "/note/on" : "/param/mod");
      equal(tags.value, i === 0 ? ",iifii" : ",iidiii");
      equal(view.getInt32(tags.next), 1);
      if (i > 0) {
        equal(view.getInt32(tags.next + 4), MACRO_IDS[i - 1]);
        equal(view.getFloat64(tags.next + 8), DEFAULT_MACROS[i - 1]);
        equal(view.getInt32(tags.next + 16), 60);
      }
      offset += size + 4;
    }
    equal(offset, bytes.length);
    deepEqual(errors, []);
  } finally {
    await client.close();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  }
});

Deno.test("startup routes all six per-note modulated macros and validates metadata", () => {
  const patch = dronePatch();
  ok(encodeBundle(patch).length < 4096);
  const values = new Map(patch.map((p) => [p.args[0], p.args[1]]));
  for (let i = 0; i < 6; i++) {
    equal(values.get(MACRO_IDS[i]), 0);
    equal(values.get(20050 + 100 * i), 410 + i);
    equal(values.get(20060 + 100 * i), 10);
  }
  const table = MACRO_IDS.map((id, i) =>
    `${id} Macro ${i + 1} Level  Macro ${i + 1} -1.0000 1.0000 0.0000 NO YES`
  ).join("\n");
  validateParameterTable(table);
  throws(() => validateParameterTable(table.replace(/YES/g, "NO")));
  throws(() => validateParameterTable(""));
});
