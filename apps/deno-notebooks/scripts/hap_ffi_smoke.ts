// Run from the repo root:
//   bash apps/deno-notebooks/scripts/build_hap_decoder.sh
//   deno run --unstable-ffi --allow-ffi --allow-read --allow-env apps/deno-notebooks/scripts/hap_ffi_smoke.ts

import { NativeHapDecoder } from "../hap/native_decoder.ts";

const DEFAULT_HAPPACK_PATH = `${Deno.env.get("HOME") ?? ""}/Downloads/Local_dialect_avneesh_promo_chunk1.happack`;
const path = Deno.args.find((arg) => !arg.startsWith("--")) ?? DEFAULT_HAPPACK_PATH;

const decoder = NativeHapDecoder.open(path);
try {
  const frameBytes = new Uint8Array(decoder.info.decodedByteLength);
  const frame0 = decoder.decodeFrame(0, frameBytes);
  const midFrame = Math.floor(decoder.info.frameCount / 2);
  const middle = decoder.decodeFrame(midFrame, frameBytes);

  console.log(JSON.stringify({
    info: decoder.info,
    frame0,
    middle,
  }, null, 2));
} finally {
  decoder.close();
}
