import type { TimeContext } from "@avtools/core-timing";

export const state = {
  frame: 0,
  x: 320,
  direction: 1,
  sped: 4,
  color: [235, 90, 140] as [number, number, number],
  snapshotRequested: false,
  snapshotPath: new URL("../snapshots/livecode-test.png", import.meta.url)
    .pathname,
};

export default async function (_ctx: TimeContext) {
  // Running this module commits and validates the shared state surface.
}
