import { createSocket } from "node:dgram";

export const MACRO_IDS = Array.from({ length: 6 }, (_, i) => 40000 + 250 * i);
export const DEFAULT_MACROS = [0, -0.5, -0.65, -0.75, -0.85, -0.9];
export type OscMessage = { address: string; types: string; args: number[] };
export type Send = (messages: OscMessage[]) => void;
export const param = (id: number, value: number): OscMessage => ({
  address: "/param/set",
  types: "id",
  args: [id, value],
});

function oscString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  const result = new Uint8Array(Math.ceil((bytes.length + 1) / 4) * 4);
  result.set(bytes);
  return result;
}

/** Explicit OSC types: IDs are int32, modulation amounts are float64. */
export function encodeMessage(message: OscMessage): Uint8Array {
  const { address, types, args } = message;
  if (
    types.length !== args.length || !/^[ifd]*$/.test(types) ||
    args.some((v) => !Number.isFinite(v))
  ) throw new Error("Invalid OSC message");
  const prefix = oscString(address), tags = oscString("," + types);
  const result = new Uint8Array(
    prefix.length + tags.length +
      [...types].reduce((n, t) => n + (t === "d" ? 8 : 4), 0),
  );
  result.set(prefix);
  result.set(tags, prefix.length);
  const view = new DataView(result.buffer);
  let offset = prefix.length + tags.length;
  [...types].forEach((type, i) => {
    if (type === "i") view.setInt32(offset, args[i]);
    else if (type === "f") view.setFloat32(offset, args[i]);
    else view.setFloat64(offset, args[i]);
    offset += type === "d" ? 8 : 4;
  });
  return result;
}

export function encodeBundle(messages: OscMessage[]): Uint8Array {
  const packets = messages.map(encodeMessage);
  const result = new Uint8Array(
    16 + packets.reduce((n, p) => n + 4 + p.length, 0),
  );
  result.set(oscString("#bundle"));
  const view = new DataView(result.buffer);
  view.setUint32(12, 1); // OSC immediate timetag
  let offset = 16;
  for (const packet of packets) {
    view.setUint32(offset, packet.length);
    result.set(packet, offset + 4);
    offset += 4 + packet.length;
  }
  if (result.length > 4096) {
    throw new Error("Bundle exceeds host receive buffer");
  }
  return result;
}

export function openOsc(port: number, onError: (error: Error) => void) {
  const socket = createSocket("udp4");
  socket.on("error", onError);
  let pending = Promise.resolve();
  return {
    send(messages: OscMessage[]) {
      const bytes = encodeBundle(messages);
      pending = pending.then(() =>
        new Promise<void>((resolve) => {
          socket.send(bytes, port, "127.0.0.1", (error) => {
            if (error) onError(error);
            resolve();
          });
        })
      );
    },
    async close() {
      await pending;
      await new Promise<void>((resolve) => socket.close(() => resolve()));
    },
  };
}

/** A fresh host starts with Init. Make each macro audibly control one harmonic.
 * IDs and routing enums come from src/synth/patch.h and mod_matrix.h.
 * MACRO_MOD (410+i), unlike MACRO amplitude (400+i), includes per-note offsets.
 */
export function dronePatch(volume = 0.12): OscMessage[] {
  const messages = [
    param(500, volume),
    param(506, 1),
    param(523, 0),
    param(526, 16),
  ];
  for (let i = 0; i < 6; i++) {
    const source = 1500 + 250 * i, mixer = 20000 + 100 * i;
    messages.push(
      param(MACRO_IDS[i], 0),
      param(MACRO_IDS[i] + 1, 0),
      param(source, Math.log2(i + 1)),
      param(source + 1, 1),
      param(mixer, 0.5),
      param(mixer + 1, 1),
      param(mixer + 50, 410 + i),
      param(mixer + 51, 0.5),
      param(mixer + 60, 10),
    );
  }
  return messages;
}

export function validateParameterTable(table: string) {
  for (const id of MACRO_IDS) {
    const line = table.split("\n").find((line) =>
      new RegExp(`^\\s*${id}\\s`).test(line)
    );
    if (
      !line || !/Macro/.test(line) || !/-1\.0000\s+1\.0000/.test(line) ||
      !/YES\s*$/.test(line)
    ) {
      throw new Error(
        `Six Sines macro ${id} is missing or does not support per-note modulation. Rebuild the local plugin.`,
      );
    }
  }
}
