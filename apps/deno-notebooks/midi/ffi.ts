import type { PortInfo } from "./types.ts";

export const CALLBACK_DEF = {
  parameters: ["pointer", "u32"],
  result: "void",
} as const;

export type MidiCallback = Deno.UnsafeCallback<typeof CALLBACK_DEF>;

export const FFI_SYMBOLS = {
  midi_list_inputs: { parameters: ["pointer", "u32"], result: "u32" },
  midi_list_outputs: { parameters: ["pointer", "u32"], result: "u32" },
  midi_open_input: {
    parameters: ["pointer", "u32", "u32", "u32", "function"],
    result: "u32",
  },
  midi_close_input: { parameters: ["u32"], result: "void" },
  midi_open_output: { parameters: ["pointer", "u32"], result: "u32" },
  midi_close_output: { parameters: ["u32"], result: "void" },
  midi_send: { parameters: ["u32", "pointer", "u32"], result: "i32" },
} as const;

export type MidiBridgeSymbols = typeof FFI_SYMBOLS;
export type MidiBridgeLibrary = Deno.DynamicLibrary<MidiBridgeSymbols>;

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function defaultLibUrl(): URL {
  const base = new URL("../native/midi_bridge/target/release/", import.meta.url);
  const os = Deno.build.os;
  const candidates =
    os === "windows"
      ? ["midi_bridge.dll", "libmidi_bridge.dll"]
      : os === "darwin"
      ? ["libmidi_bridge.dylib"]
      : ["libmidi_bridge.so"];

  for (const name of candidates) {
    const u = new URL(name, base);
    try {
      const t = Deno.dlopen(u, FFI_SYMBOLS);
      t.close();
      return u;
    } catch {
      // try next
    }
  }

  throw new Error(
    `Could not find native midi_bridge library in ${base.toString()} (tried ${candidates.join(", ")})`,
  );
}

export function openLibrary(libPath?: string): MidiBridgeLibrary {
  const path = libPath ? libPath : defaultLibUrl();
  return Deno.dlopen(path, FFI_SYMBOLS);
}

export function readPortList(
  lib: MidiBridgeLibrary,
  fn: "midi_list_inputs" | "midi_list_outputs",
): PortInfo[] {
  const required = lib.symbols[fn](null, 0);
  if (required === 0) {
    return [];
  }
  const buf = new Uint8Array(required);
  const ptr = Deno.UnsafePointer.of(buf);
  const written = lib.symbols[fn](ptr, buf.length);
  const text = textDecoder.decode(buf.subarray(0, written));
  return JSON.parse(text) as PortInfo[];
}

export function withPortId<T>(portId: string, fn: (ptr: Deno.PointerValue, len: number) => T): T {
  const bytes = textEncoder.encode(portId);
  const ptr = Deno.UnsafePointer.of(bytes);
  return fn(ptr, bytes.length);
}
