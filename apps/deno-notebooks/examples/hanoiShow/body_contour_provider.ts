/// <reference lib="dom" />

// Shared body contour data source for the hanoiShow sketches.
//
// Owns the WebSocket receiver and temporal smoother, exposes a single
// frame-cached list of RenderContours that multiple sketches can consume
// without re-doing the smoothing work.

import type { Point } from "../../tools/text_on_path.ts";
import type { PaneContainer } from "../../window/mod.ts";
import {
  type ContourFrame,
  createContourReceiver,
} from "../../tools/contour_receiver.ts";
import {
  createContourSmoother,
  defaultSmootherParams,
} from "../../tools/contour_smoother.ts";

export interface RenderContour {
  /** Stable id from the smoother, or -1 if source is the raw (unsmoothed) frame. */
  id: number;
  /** Points in normalized [0,1] coordinates. Scale to pixels at the consumer. */
  points: Point[];
  parentIndex: number;
  /** 0–1 fade in/out weight from the smoother (always 1.0 for raw frames). */
  opacity: number;
}

export interface BodyContourProvider {
  readonly params: {
    smooth: typeof defaultSmootherParams;
    enableSmoothing: boolean;
  };
  setup(): void;
  /** Called once per frame by the host before any consumer reads. */
  tick(): void;
  /** Returns the smoothed (or raw) contours for the current frame. */
  getContours(): RenderContour[];
  getRawFrame(): ContourFrame | null;
  getFrameNumber(): number;
  setupPane(container: PaneContainer): void;
  cleanup(): void;
}

export function createBodyContourProvider(): BodyContourProvider {
  const params = {
    smooth: { ...defaultSmootherParams },
    enableSmoothing: true,
  };

  let receiver: ReturnType<typeof createContourReceiver> | null = null;
  let smoother: ReturnType<typeof createContourSmoother> | null = null;

  let lastProcessedFrame = -1;
  let smoothedFrame: ReturnType<
    ReturnType<typeof createContourSmoother>["process"]
  > | null = null;
  let lastRawFrame: ContourFrame | null = null;

  // Frame-cached render contours so multiple consumers share one list.
  let cacheKey = "";
  let cachedContours: RenderContour[] = [];

  function rebuildCache(): void {
    const useSmoothed = params.enableSmoothing;
    const sourceFrame = useSmoothed ? smoothedFrame : lastRawFrame;
    if (!sourceFrame) {
      cacheKey = "";
      cachedContours = [];
      return;
    }

    const nextKey = `${useSmoothed ? "smooth" : "raw"}:${sourceFrame.frameNumber}`;
    if (nextKey === cacheKey) return;

    const next: RenderContour[] = [];
    for (let i = 0; i < sourceFrame.contours.length; i += 1) {
      const contour = sourceFrame.contours[i]!;
      const smoothed = useSmoothed ? smoothedFrame!.contours[i]! : null;

      next.push({
        id: smoothed?.id ?? -1,
        points: contour.points,
        parentIndex: contour.parentIndex,
        opacity: smoothed?.opacity ?? 1.0,
      });
    }

    cacheKey = nextKey;
    cachedContours = next;
  }

  return {
    params,

    setup() {
      receiver = createContourReceiver();
      smoother = createContourSmoother(params.smooth);
    },

    tick() {
      if (!receiver) return;
      const rawFrame = receiver.latestFrame;
      if (rawFrame && rawFrame.frameNumber !== lastProcessedFrame) {
        if (params.enableSmoothing && smoother) {
          smoothedFrame = smoother.process(rawFrame);
        }
        lastRawFrame = rawFrame;
        lastProcessedFrame = rawFrame.frameNumber;
      }
      rebuildCache();
    },

    getContours() {
      return cachedContours;
    },

    getRawFrame() {
      return lastRawFrame;
    },

    getFrameNumber() {
      const useSmoothed = params.enableSmoothing;
      const src = useSmoothed ? smoothedFrame : lastRawFrame;
      return src?.frameNumber ?? -1;
    },

    setupPane(container: PaneContainer) {
      container.addBinding(params, "enableSmoothing", { label: "Smoothing" });

      const smooth = container.addFolder({ title: "Smoothing" });
      smooth.addBinding(params.smooth, "mincutoff", {
        min: 0.1,
        max: 15,
        step: 0.1,
        label: "Min Cutoff",
      });
      smooth.addBinding(params.smooth, "beta", {
        min: 0.0,
        max: 0.2,
        step: 0.001,
        label: "Beta",
      });
      smooth.addBinding(params.smooth, "dcutoff", {
        min: 0.1,
        max: 5.0,
        step: 0.1,
        label: "D Cutoff",
      });
      smooth.addBinding(params.smooth, "resampleCount", {
        min: 50,
        max: 800,
        step: 10,
        label: "Resample N",
      });
      smooth.addBinding(params.smooth, "matchThreshold", {
        min: 0.01,
        max: 0.5,
        step: 0.01,
        label: "Match Thresh",
      });
      smooth.addBinding(params.smooth, "fadeInFrames", {
        min: 1,
        max: 20,
        step: 1,
        label: "Fade In",
      });
      smooth.addBinding(params.smooth, "fadeOutFrames", {
        min: 1,
        max: 30,
        step: 1,
        label: "Fade Out",
      });

      const stability = container.addFolder({ title: "Stability" });
      stability.addBinding(params.smooth, "youngMaxAge", {
        min: 1,
        max: 10,
        step: 1,
        label: "Young Max Age",
      });
      stability.addBinding(params.smooth, "overlapDist", {
        min: 0.0,
        max: 0.3,
        step: 0.01,
        label: "Overlap Dist",
      });
      stability.addBinding(params.smooth, "shapeResetThreshold", {
        min: 0.01,
        max: 0.2,
        step: 0.005,
        label: "Shape Reset",
      });
    },

    cleanup() {
      receiver?.close();
      receiver = null;
      smoother = null;
    },
  };
}
