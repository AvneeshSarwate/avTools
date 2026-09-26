/**
 * 2D radiance cascades over the raw shader-fx runtime, fed by the outlines of
 * a drawing. Browser-specific (WebGPU); `materials.ts` and `geometry.ts` are
 * platform-agnostic. A project library, not a package: copy it where it is
 * useful (docs/livecode/principles.md, "Project libraries are normal code").
 */

export * from "./materials.ts";
export * from "./geometry.ts";
export * from "./effects.ts";
export * from "./renderer.ts";
export * from "./present.ts";
