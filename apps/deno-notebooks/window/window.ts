/// <reference lib="dom" />

import { encodeTitle, openLibrary } from "./ffi.ts";
import type { WindowEvent } from "./events.ts";

export interface WindowOptions {
  width: number;
  height: number;
  title?: string;
  libPath?: string;
}

export interface GpuWindow {
  device: GPUDevice;
  surface: Deno.UnsafeWindowSurface;
  ctx: GPUCanvasContext;
  format: GPUTextureFormat;
  width: number;
  height: number;
  pollEvents(): WindowEvent[];
  present(): void;
  close(): void;
}

function systemFromId(id: number): "cocoa" | "x11" | "wayland" {
  if (id === 1) return "x11";
  if (id === 2) return "wayland";
  return "cocoa";
}

export async function createGpuWindow(device: GPUDevice, options: WindowOptions): Promise<GpuWindow> {
  const debug = Deno.env.get("DENO_WINDOW_DEBUG") !== undefined;
  const lib = openLibrary(options.libPath);
  const title = options.title ?? "raw-webgpu";
  const { ptr, len } = encodeTitle(title);

  const state = lib.symbols.create_window(options.width, options.height, ptr, len);
  if (!state) {
    lib.close();
    throw new Error("Failed to create native window");
  }

  let windowHandle = 0n;
  let displayHandle = 0n;
  for (let i = 0; i < 60; i += 1) {
    windowHandle = lib.symbols.get_raw_window_handle(state);
    displayHandle = lib.symbols.get_raw_display_handle(state);
    if (debug) {
      console.log("deno_window handles", {
        i,
        windowHandle,
        displayHandle,
        windowHandleType: typeof windowHandle,
        displayHandleType: typeof displayHandle,
      });
    }
    if (windowHandle !== 0n) {
      break;
    }
    const buf = new Uint8Array(1024);
    lib.symbols.poll_events(state, Deno.UnsafePointer.of(buf), buf.length);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (windowHandle === 0n) {
    lib.symbols.destroy_window(state);
    lib.close();
    throw new Error("Native window handle was not available (ns_view null).");
  }

  const systemId = lib.symbols.get_window_system(state);
  const system = systemFromId(systemId);

  let surfaceWindowHandle: Deno.PointerValue = windowHandle;
  let surfaceDisplayHandle: Deno.PointerValue = displayHandle;
  if (system === "cocoa") {
    // Deno expects the NSView* in displayHandle for cocoa.
    const nsView = windowHandle !== 0n ? windowHandle : displayHandle;
    surfaceDisplayHandle = nsView;
    // Keep a non-null external for windowHandle to satisfy parameter validation.
    surfaceWindowHandle = nsView;
  }
  if (debug) {
    console.log("deno_window surface handles", {
      system,
      surfaceWindowHandle,
      surfaceDisplayHandle,
    });
  }

  const surface = new Deno.UnsafeWindowSurface({
    system,
    windowHandle: Deno.UnsafePointer.create(surfaceWindowHandle as bigint),
    displayHandle: Deno.UnsafePointer.create(surfaceDisplayHandle as bigint),
    width: options.width,
    height: options.height,
  });

  const ctx = surface.getContext("webgpu") as GPUCanvasContext;
  const format = navigator.gpu.getPreferredCanvasFormat();
  if (debug) {
    console.log("deno_window preferred format", format);
  }
  const config: GPUCanvasConfiguration = {
    device,
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
    alphaMode: "opaque",
  };
  if (debug) {
    device.pushErrorScope("validation");
  }
  ctx.configure(config);
  if (debug) {
    const configError = await device.popErrorScope();
    if (configError) {
      console.error("deno_window configure error", configError);
    }
  }
  if (debug) {
    console.log("deno_window configured surface");
  }

  let width = options.width;
  let height = options.height;

  const pollEvents = (): WindowEvent[] => {
    const buf = new Uint8Array(65536);
    const written = lib.symbols.poll_events(state, Deno.UnsafePointer.of(buf), buf.length);
    if (!written) {
      return [];
    }
    const text = new TextDecoder().decode(buf.subarray(0, written));
    const events = JSON.parse(text) as WindowEvent[];
    for (const ev of events) {
      if (ev.type === "resize") {
        width = ev.width;
        height = ev.height;
        surface.resize(width, height);
      }
    }
    return events;
  };

  const present = () => {
    surface.present();
  };

  const close = () => {
    lib.symbols.destroy_window(state);
    lib.close();
  };

  return {
    device,
    surface,
    ctx,
    format,
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    pollEvents,
    present,
    close,
  };
}
