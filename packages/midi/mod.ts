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
    // Same discipline as the native branch below, for the opposite reason:
    // `browser.ts` carries `/// <reference lib="dom" />`, and TypeScript lib
    // references are program-global, so a static (even string-literal dynamic)
    // import here would inject DOM types into every Deno program that can
    // reach this module and collide with Deno's own stream/global types.
    const browserModule = "./browser.ts";
    const browser = await import(
      /* @vite-ignore */ browserModule
    ) as {
      openMidiAccess(): Promise<MidiAccess>;
    };
    return await browser.openMidiAccess();
  }

  // Keep the FFI implementation out of browser bundles AND out of
  // browser-target typechecks. The variable specifier hides the module from
  // bundlers and from `deno check`'s import graph; the structural cast (rather
  // than `typeof import("./native.ts")`, which is a type-level import and
  // would drag the FFI graph back into every checked program) keeps the call
  // typed without referencing the module.
  const nativeModule = "./native.ts";
  const native = await import(
    /* @vite-ignore */ nativeModule
  ) as {
    openMidiAccess(options?: { libPath?: string }): Promise<MidiAccess>;
  };
  return await native.openMidiAccess({ libPath: options.libPath });
}
