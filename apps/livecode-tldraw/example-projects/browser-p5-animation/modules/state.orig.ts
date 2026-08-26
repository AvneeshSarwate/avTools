import type { TimeContext } from "@avtools/core-timing";

/**
 * Normalized circle position (0..1 in both axes): the player writes it from
 * the animation timeline, the sketch reads it every draw frame. Both modules
 * import this file by its runtime path, so they share one instance.
 */
export const circle = { x: 0.5, y: 0.5 };

export default async function (_ctx: TimeContext) {
  // Shared-data module: nothing to run.
}
