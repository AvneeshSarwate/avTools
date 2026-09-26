/**
 * 2D radiance cascades fed by the outlines of a drawing, in two swappable
 * backends: fragment shaders over the raw shader-fx runtime (`renderer.ts`)
 * and compute shaders over raw WebGPU (`compute/`). `backend.ts` has the
 * shared contract and the factory. Browser-specific (WebGPU); `materials.ts`
 * and `geometry.ts` are platform-agnostic. A project library, not a package:
 * copy it where it is useful (docs/livecode/principles.md, "Project libraries
 * are normal code").
 */

export * from "./materials.ts";
export * from "./geometry.ts";
export * from "./effects.ts";
export * from "./renderer.ts";
export * from "./present.ts";
export * from "./backend.ts";
export * from "./compute/plan.ts";
export * from "./compute/renderer.ts";
export * from "./compute/timer.ts";
