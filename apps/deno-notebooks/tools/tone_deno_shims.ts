/**
 * Polyfills required to run Tone.js on Deno via node-web-audio-api.
 *
 * Must be imported BEFORE importing Tone.js or node-web-audio-api.
 * After importing this module, use dynamic imports for both:
 *   const WAA = await import("node-web-audio-api");
 *   const Tone = await import("tone");
 *
 * Fixes three Deno incompatibilities:
 * 1. standardized-audio-context expects `window.AudioContext` (browser global)
 * 2. URL.createObjectURL blob URLs can't be resolved by node-web-audio-api
 *    (Deno lacks node:buffer's resolveObjectURL)
 * 3. node-web-audio-api's AudioWorklet worker uses markAsUntransferable from
 *    node:worker_threads, which Deno exports as a stub that throws
 */

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const _require = createRequire(import.meta.url);
// deno-lint-ignore no-explicit-any
const Module = _require("node:module") as any;

// --- Shim 3 (must be first): Worker wrapper for markAsUntransferable ---
// node-web-audio-api's AudioWorkletGlobalScope.js does:
//   const { markAsUntransferable } = require('node:worker_threads');
// Deno exports this as a stub that throws "Not implemented".
//
// Strategy: Hook CJS Module._load to intercept require('node:worker_threads').
// Return a Proxy that:
//   a) Replaces Worker with PatchedWorker that redirects AudioWorkletGlobalScope.js
//      loads through a shim script
//   b) Replaces markAsUntransferable with a no-op (for main thread usage)
//
// The shim script patches markAsUntransferable on the node:worker_threads
// module BEFORE requiring the real AudioWorkletGlobalScope.js. Because
// require() caches modules, the destructured binding picks up the no-op.

const RealWorker = _require("node:worker_threads").Worker;

const _shimPath = join(tmpdir(), `deno-waa-worker-shim-${Date.now()}.js`);
let _shimWritten = false;

function ensureWorkerShim(originalPath: string): string {
  if (!originalPath.includes("AudioWorkletGlobalScope")) {
    return originalPath;
  }
  if (!_shimWritten) {
    const escaped = originalPath.replace(/\\/g, "\\\\");
    const shimCode = `
// Patch markAsUntransferable before loading AudioWorkletGlobalScope
const wt = require('node:worker_threads');
wt.markAsUntransferable = function markAsUntransferable() {};
require("${escaped}");
`;
    writeFileSync(_shimPath, shimCode, "utf-8");
    _shimWritten = true;
  }
  return _shimPath;
}

// deno-lint-ignore no-explicit-any
function PatchedWorker(this: any, filename: string | URL, opts?: any) {
  const file = typeof filename === "string" ? filename : filename.toString();
  const shimmed = ensureWorkerShim(file);
  return new RealWorker(shimmed, opts);
}
Object.setPrototypeOf(PatchedWorker, RealWorker);
PatchedWorker.prototype = RealWorker.prototype;

// Hook CJS Module._load
const origLoad = Module._load;
// deno-lint-ignore no-explicit-any
Module._load = function (request: string, parent: any, isMain: boolean) {
  const result = origLoad.call(Module, request, parent, isMain);
  if (request === "node:worker_threads" || request === "worker_threads") {
    return new Proxy(result, {
      get(target: Record<string, unknown>, prop: string) {
        if (prop === "Worker") return PatchedWorker;
        if (prop === "markAsUntransferable") {
          return function markAsUntransferable() {};
        }
        return target[prop];
      },
    });
  }
  return result;
};

// --- Shim 1: Web Audio globals + window ---
// Must be done AFTER hooks but BEFORE importing node-web-audio-api/Tone.
// We do this by dynamically importing WAA here.
const WAA = await import("node-web-audio-api");

const globalAny = globalThis as Record<string, unknown>;
for (const [key, value] of Object.entries(WAA)) {
  if (key !== "default" && key !== "mediaDevices") {
    globalAny[key] = value;
  }
}
if (typeof globalAny.window === "undefined") {
  globalAny.window = globalAny;
}
// Tone.js uses `typeof self === "object" ? self : null` for theWindow
if (typeof globalAny.self === "undefined") {
  globalAny.self = globalAny;
}
// standardized-audio-context gates AudioWorkletNode on window.isSecureContext
if (typeof globalAny.isSecureContext === "undefined") {
  globalAny.isSecureContext = true;
}

// --- Shim 2: Blob URL → temp file ---
// Tone.js creates worklet code as: URL.createObjectURL(new Blob([code]))
// node-web-audio-api's addModule tries resolveObjectURL for blob: URLs,
// which Deno doesn't implement. Instead, we write the blob to a temp file
// and return the file path so addModule hits the existsSync() branch.
const _OrigBlob = globalThis.Blob;
const _blobSourceMap = new WeakMap<Blob, string>();
// deno-lint-ignore no-explicit-any
(globalThis as any).Blob = class PatchedBlob extends _OrigBlob {
  // deno-lint-ignore no-explicit-any
  constructor(parts?: any[], options?: BlobPropertyBag) {
    super(parts, options);
    if (parts) {
      const textParts = parts.map((p: unknown) =>
        typeof p === "string" ? p : ""
      );
      _blobSourceMap.set(this, textParts.join(""));
    }
  }
};

let _blobCounter = 0;
URL.createObjectURL = (blob: Blob): string => {
  const text = _blobSourceMap.get(blob);
  if (text !== undefined) {
    const filePath = join(
      tmpdir(),
      `tone-worklet-${Date.now()}-${_blobCounter++}.js`
    );
    writeFileSync(filePath, text, "utf-8");
    return filePath;
  }
  return `blob:null/${crypto.randomUUID()}`;
};

export { WAA };
