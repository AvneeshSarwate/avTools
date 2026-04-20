/// <reference lib="dom" />

// Shared hand bounding-box data source for hanoiShow sketches.
//
// Parallels body_contour_provider.ts. Owns a WebSocket receiver that parses
// JSON hand frames and exposes a frame-cached list of bboxes (normalized
// [0,1], top-left origin).

import type { PaneContainer } from "../../window/mod.ts";
import {
  createHandReceiver,
  type HandBBox,
  type HandFrame,
} from "../../tools/hand_receiver.ts";

export type { HandBBox };

export interface HandBBoxProvider {
  readonly params: { enabled: boolean };
  setup(): void;
  tick(): void;
  getHands(): readonly HandBBox[];
  getRawFrame(): HandFrame | null;
  getFrameNumber(): number;
  setupPane(container: PaneContainer): void;
  cleanup(): void;
}

export function createHandBBoxProvider(): HandBBoxProvider {
  const params = { enabled: true };

  let receiver: ReturnType<typeof createHandReceiver> | null = null;
  let lastProcessedFrame = -1;
  let lastFrame: HandFrame | null = null;
  let cachedHands: readonly HandBBox[] = [];

  return {
    params,

    setup() {
      receiver = createHandReceiver();
    },

    tick() {
      if (!receiver || !params.enabled) {
        cachedHands = [];
        return;
      }
      const raw = receiver.latestFrame;
      if (raw && raw.frameNumber !== lastProcessedFrame) {
        lastFrame = raw;
        lastProcessedFrame = raw.frameNumber;
        cachedHands = raw.hands;
      }
    },

    getHands() {
      return cachedHands;
    },

    getRawFrame() {
      return lastFrame;
    },

    getFrameNumber() {
      return lastFrame?.frameNumber ?? -1;
    },

    setupPane(container: PaneContainer) {
      container.addBinding(params, "enabled", { label: "Hand tracking" });
    },

    cleanup() {
      receiver?.close();
      receiver = null;
    },
  };
}
