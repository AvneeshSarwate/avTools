export const state = {
  frame: 0,
  x: 320,
  direction: 1,
  speed: 4,
  color: [235, 90, 140] as [number, number, number],
  snapshotRequested: false,
  snapshotPath: new URL("../snapshots/livecode-test.png", import.meta.url)
    .pathname,
};
