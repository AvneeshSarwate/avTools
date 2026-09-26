import type { TimeContext } from "@avtools/core-timing";
import { drawing } from "canvas-drawing";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";
import {
  buildStrokeScene,
  CanvasPresenter,
  createRadianceRenderer,
  type DisplayMode,
  type MergeMode,
  type RadianceCascadeConfig,
  radianceDeviceDescriptor,
  type RadianceRenderer,
  type RendererBackend,
  type ToneMap,
} from "../lib/radiance-cascades/mod.ts";

/**
 * Lights the outlines of a drawing with 2D radiance cascades. Every frame the
 * sketch re-reads the pane parameters; when the drawing's revision changes
 * (a committed edit or a streamed in-gesture preview) it rebuilds the stroke
 * scene. Shape `metadata` carries the light material: `strokeWidth`,
 * `emission` [r, g, b] (HDR), `transmittance` [r, g, b] or a number (0 opaque,
 * 1 clear), `albedo` [r, g, b]; see `lib/radiance-cascades/materials.ts` for
 * the defaults. The **backend** parameter swaps the compute-shader renderer
 * (the default, about twice as fast) for the original fragment-shader one
 * (same output; the HUD shows per-pass GPU times when the device supports
 * timestamp queries).
 */
const shapes = drawing("radiance-cascades_shapes");

// The canvas component's default stage.
const STAGE_WIDTH = 1000;
const STAGE_HEIGHT = 500;

export const params = canvasParams(
  "radiance-cascades/params",
  {
    render: {
      backend: "compute",
      scale: 1,
      exposure: 1,
      toneMap: "aces",
      view: "irradiance",
      debugCascade: 0,
    },
    cascades: {
      probeSpacing: 1,
      baseRayCount: 16,
      branching: 2,
      intervalLength: 2,
      intervalScale: 4,
      cascadeCount: 0,
      mergeMode: "bilinearFix",
      preAverage: false,
      intervalOverlap: 1,
    },
    march: { useDistanceField: true, stepSize: 1 },
    light: { skyRed: 0, skyGreen: 0, skyBlue: 0, bounceStrength: 0 },
    reference: { rays: 64 },
  },
  {
    render: {
      backend: {
        label: "backend",
        options: {
          "compute shaders (raw WebGPU)": "compute",
          "fragment shaders (shader-fx)": "fragment",
        },
      },
      scale: { label: "render scale", min: 0.25, max: 2, step: 0.25 },
      exposure: { label: "exposure", min: 0.05, max: 8, step: 0.05 },
      toneMap: {
        label: "tone map",
        options: { ACES: "aces", "soft (1 - 1/(1+x)^2.5)": "soft" },
      },
      view: {
        label: "view",
        options: {
          "irradiance (final)": "irradiance",
          "reference (brute force)": "reference",
          "cascade N merged": "cascadeMerged",
          "cascade N raw": "cascadeRaw",
          "scene emission": "emission",
          "emission + bounce": "effectiveEmission",
          "scene transmittance": "transmittance",
          "scene albedo": "albedo",
          "scene distance": "distance",
        },
      },
      debugCascade: { label: "cascade N", min: 0, max: 9, step: 1 },
    },
    cascades: {
      probeSpacing: {
        label: "c0 probe spacing (px)",
        min: 1,
        max: 16,
        step: 1,
      },
      baseRayCount: { label: "c0 rays", min: 1, max: 64, step: 1 },
      branching: { label: "angular branching", min: 1, max: 8, step: 1 },
      intervalLength: { label: "c0 interval (px)", min: 1, max: 64, step: 1 },
      intervalScale: { label: "interval scale", min: 1, max: 8, step: 0.5 },
      cascadeCount: { label: "cascades (0 = auto)", min: 0, max: 10, step: 1 },
      mergeMode: {
        label: "merge",
        options: {
          vanilla: "vanilla",
          "bilinear fix": "bilinearFix",
          "parallax fix": "parallaxFix",
        },
      },
      preAverage: { label: "pre-average directions" },
      intervalOverlap: {
        label: "interval overlap",
        min: 0.5,
        max: 2,
        step: 0.05,
      },
    },
    march: {
      useDistanceField: { label: "distance field" },
      stepSize: { label: "step (px)", min: 0.25, max: 8, step: 0.25 },
    },
    light: {
      skyRed: { label: "sky R", min: 0, max: 4, step: 0.01 },
      skyGreen: { label: "sky G", min: 0, max: 4, step: 0.01 },
      skyBlue: { label: "sky B", min: 0, max: 4, step: 0.01 },
      bounceStrength: { label: "bounce", min: 0, max: 2, step: 0.01 },
    },
    reference: {
      rays: { label: "rays / pixel", min: 4, max: 512, step: 4 },
    },
  },
);

type View = keyof typeof VIEW_MODES;

const VIEW_MODES = {
  irradiance: "hdr",
  reference: "hdr",
  cascadeMerged: "hdr",
  cascadeRaw: "hdr",
  emission: "hdr",
  effectiveEmission: "hdr",
  transmittance: "color",
  albedo: "color",
  distance: "distance",
} as const satisfies Record<string, DisplayMode>;

const configFromParams = (): RadianceCascadeConfig => ({
  probeSpacing: params.cascades.probeSpacing,
  baseRayCount: params.cascades.baseRayCount,
  branching: params.cascades.branching,
  intervalLength: params.cascades.intervalLength,
  intervalScale: params.cascades.intervalScale,
  cascadeCount: params.cascades.cascadeCount,
  mergeMode: params.cascades.mergeMode as MergeMode,
  preAverage: params.cascades.preAverage,
  sky: [params.light.skyRed, params.light.skyGreen, params.light.skyBlue],
  bounceStrength: params.light.bounceStrength,
  useDistanceField: params.march.useDistanceField,
  stepSize: params.march.stepSize,
  intervalOverlap: params.cascades.intervalOverlap,
  referenceRays: params.reference.rays,
});

interface Running {
  stop(): void;
}

/**
 * Starts the GPU side without awaiting inside the timed root: device setup
 * is ordinary browser async work, and the frame loop is requestAnimationFrame.
 */
function startRenderer(surface: ReturnType<typeof canvasSurface>): Running {
  let stopped = false;
  let frame = 0;
  let renderer: RadianceRenderer | null = null;
  let presenter: CanvasPresenter | null = null;
  // A one-line readout under the canvas: render size, frame rate, cascades.
  const hud = document.createElement("div");
  hud.style.cssText =
    "font: 12px/1.5 ui-monospace, Menlo, monospace; color: #cfd6e6; background: #12161f; padding: 2px 8px; white-space: pre;";
  let hudFrames = 0;
  let hudSince = performance.now();

  const teardown = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    presenter?.dispose();
    renderer?.dispose();
    presenter = null;
    renderer = null;
    surface.clear();
  };

  const run = async () => {
    if (!("gpu" in navigator)) {
      console.error("[radiance-cascades] this browser has no WebGPU");
      return;
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      console.error("[radiance-cascades] no WebGPU adapter");
      return;
    }
    const device = await adapter.requestDevice(
      radianceDeviceDescriptor(adapter),
    );
    if (stopped) return;
    device.lost.then((info) =>
      console.error("[radiance-cascades] device lost:", info.message)
    );

    let scale = 0;
    let backend: RendererBackend | "" = "";
    let renderedRev = -1;
    let configKey = "";
    let planKey = "";
    let referenceDirty = true;

    const rebuild = (nextScale: number, nextBackend: RendererBackend) => {
      presenter?.dispose();
      renderer?.dispose();
      scale = nextScale;
      backend = nextBackend;
      const width = Math.round(STAGE_WIDTH * scale);
      const height = Math.round(STAGE_HEIGHT * scale);
      renderer = createRadianceRenderer(
        device,
        width,
        height,
        configFromParams(),
        { backend },
      );
      presenter = new CanvasPresenter(
        device,
        surface.createCanvas(width, height),
      );
      surface.container.appendChild(hud);
      hud.textContent = `${width}x${height}`;
      renderedRev = -1;
      configKey = "";
      planKey = "";
    };

    const tick = () => {
      if (stopped) return;
      frame = requestAnimationFrame(tick);
      const wantedBackend = params.render.backend as RendererBackend;
      if (params.render.scale !== scale || wantedBackend !== backend) {
        rebuild(params.render.scale, wantedBackend);
      }
      if (!renderer || !presenter) return;

      const rev = shapes.rev();
      if (rev !== renderedRev) {
        renderer.setScene(buildStrokeScene(shapes.render(), { scale }));
        renderedRev = rev;
        referenceDirty = true;
      }

      const config = configFromParams();
      const nextConfigKey = JSON.stringify(config);
      if (nextConfigKey !== configKey) {
        const plan = renderer.configure(config);
        configKey = nextConfigKey;
        referenceDirty = true;
        const nextPlanKey = JSON.stringify(plan) + renderer.describe().join();
        if (nextPlanKey !== planKey) {
          planKey = nextPlanKey;
          console.log(
            `[radiance-cascades] ${renderer.backend} backend, ${plan.effective.cascadeCount} cascades\n  ${
              renderer.describe().join("\n  ")
            }`,
          );
          for (const warning of plan.warnings) {
            console.warn(`[radiance-cascades] ${warning}`);
          }
        }
      }

      const view = params.render.view as View;
      renderer.setDebugViews(view === "cascadeMerged" || view === "cascadeRaw");
      renderer.render();
      if (
        view === "reference" && (referenceDirty || config.bounceStrength > 0)
      ) {
        renderer.renderReference();
        referenceDirty = false;
      }
      const views = renderer.views;
      const cascade = views.cascades[
        Math.min(
          views.cascades.length - 1,
          Math.max(0, params.render.debugCascade),
        )
      ];
      const source = view === "cascadeMerged"
        ? cascade.merged
        : view === "cascadeRaw"
        ? cascade.raw
        : views[view] ?? views.irradiance;
      presenter.present(source, {
        mode: VIEW_MODES[view] ?? "hdr",
        exposure: params.render.exposure,
        toneMap: params.render.toneMap as ToneMap,
      });

      hudFrames++;
      const now = performance.now();
      if (now - hudSince >= 500) {
        const fps = (hudFrames * 1000) / (now - hudSince);
        const plan = renderer.plan.effective;
        const timings = renderer.timings;
        const gpu = timings
          ? `  gpu ${timings.total.toFixed(1)} ms (` +
            Object.entries(timings)
              .filter(([label]) => label !== "total")
              .map(([label, ms]) => `${label} ${ms.toFixed(1)}`)
              .join(", ") +
            ")"
          : "";
        hud.textContent =
          `${renderer.backend}  ${renderer.width}x${renderer.height}  ${
            fps.toFixed(0)
          } fps  ${plan.cascadeCount} cascades  ${plan.baseRayCount} rays x${plan.branching}  ${config.mergeMode}${
            plan.preAverage ? " pre-avg" : ""
          }  view: ${view}${gpu}`;
        hudFrames = 0;
        hudSince = now;
      }
    };
    frame = requestAnimationFrame(tick);
  };

  run().catch((error) => {
    console.error("[radiance-cascades] failed to start:", error);
    teardown();
  });

  return {
    stop() {
      stopped = true;
      teardown();
    },
  };
}

let running: Running | null = null;

export function stop() {
  running?.stop();
  running = null;
}

export default async function (ctx: TimeContext) {
  stop();
  running = startRenderer(canvasSurface("radiance-cascades/render"));
  try {
    // Idle cancellably forever; the frame loop does the per-frame work.
    while (true) await ctx.waitSec(3600);
  } finally {
    stop();
  }
}
