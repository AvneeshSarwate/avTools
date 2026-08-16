import type { MidiAccess, MidiBackend } from "./api.ts";

export * from "./api.ts";

export interface AutoMidiAccessOptions {
  /** Override runtime detection when embedding in a nonstandard host. */
  backend?: MidiBackend | "auto";
  /** Native bridge override. Ignored by the browser backend. */
  libPath?: string;
}

export function detectMidiBackend(): MidiBackend {
  const candidate = globalThis as typeof globalThis & {
    navigator?: { requestMIDIAccess?: unknown };
  };
  return typeof candidate.navigator?.requestMIDIAccess === "function"
    ? "browser"
    : "native";
}

export async function openMidiAccess(
  options: AutoMidiAccessOptions = {},
): Promise<MidiAccess> {
  const backend = options.backend && options.backend !== "auto"
    ? options.backend
    : detectMidiBackend();

  if (backend === "browser") {
    const browser = await import("./browser.ts");
    return await browser.openMidiAccess();
  }

  // Keep the FFI implementation out of browser bundles. Deno can resolve the
  // source-relative module when this branch is actually selected.
  const nativeModule = "./native.ts";
  const native = await import(
    /* @vite-ignore */ nativeModule
  ) as typeof import("./native.ts");
  return await native.openMidiAccess({ libPath: options.libPath });
}
