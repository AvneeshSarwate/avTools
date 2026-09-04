/// <reference lib="dom" />
// Module-facing entry for named canvas surfaces: a browser-engine module asks
// for a surface by name and draws into it with p5 or plain Canvas 2D; a
// `canvas-surface` view shape in the tldraw UI mirrors that canvas next to the
// module's code, frame by frame, when the engine runs in the UI's own tab (the
// in-process topology, docs/livecode/current/system-architecture.md).
//
// The contract between the two sides is deliberately a DOM naming convention,
// not an entity: the engine owns a container element under `#livecode-stage`
// tagged with the surface name, and the view finds the first <canvas> inside
// it. Nothing about the view reaches the engine — deleting the view never
// touches the sketch, and the module works identically in a standalone engine
// tab (where the stage is simply visible page DOM instead).

/** Attribute the view queries: `[data-livecode-canvas-surface="<name>"]`. */
export const CANVAS_SURFACE_ATTRIBUTE = "data-livecode-canvas-surface";
const STAGE_ID = "livecode-stage";

export interface CanvasSurface {
  readonly name: string;
  /**
   * The surface's container element. Hand it to p5 as the sketch parent
   * (`new p5(sketch, surface.container)`) so `createCanvas` appends there.
   */
  readonly container: HTMLDivElement;
  /** Create (or replace) a plain <canvas> of this size inside the container. */
  createCanvas(width: number, height: number): HTMLCanvasElement;
  /** The first <canvas> inside the container, however it got there. */
  canvas(): HTMLCanvasElement | null;
  /** Remove the container's contents (a sketch's own `remove()` is enough for p5). */
  clear(): void;
}

/**
 * Find or create the named surface. Redeclaring a name (a module relaunch)
 * reuses the container and clears whatever the previous run left in it, so a
 * Replace never stacks two canvases under one name.
 */
export function canvasSurface(name: string): CanvasSurface {
  const surfaceName = name.trim();
  if (!surfaceName) throw new Error("canvas surface name must not be empty");
  if (typeof document === "undefined") {
    throw new Error(
      `canvasSurface("${surfaceName}") needs a browser engine (no document)`,
    );
  }
  const stage = ensureStage();
  let container = stage.querySelector<HTMLDivElement>(
    `:scope > [${CANVAS_SURFACE_ATTRIBUTE}="${cssEscape(surfaceName)}"]`,
  );
  if (!container) {
    container = document.createElement("div");
    container.setAttribute(CANVAS_SURFACE_ATTRIBUTE, surfaceName);
    container.className = "livecode-canvas-surface";
    stage.appendChild(container);
  } else {
    container.replaceChildren();
  }
  const owned = container;
  return {
    name: surfaceName,
    container: owned,
    createCanvas(width, height) {
      owned.replaceChildren();
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      owned.appendChild(canvas);
      return canvas;
    },
    canvas: () => owned.querySelector("canvas"),
    clear: () => owned.replaceChildren(),
  };
}

/**
 * `#livecode-stage` is user-module DOM in every browser embedder (the engine
 * page declares it; the in-process UI renders one). A page without it — an
 * observer tab, a test harness — gets a hidden one so drawing still works.
 */
function ensureStage(): HTMLElement {
  let stage = document.getElementById(STAGE_ID);
  if (!stage) {
    stage = document.createElement("div");
    stage.id = STAGE_ID;
    stage.hidden = true;
    document.body.appendChild(stage);
  }
  return stage;
}

function cssEscape(value: string): string {
  const escaper = (globalThis as { CSS?: { escape?: (v: string) => string } })
    .CSS?.escape;
  return escaper ? escaper(value) : value.replace(/["\\]/g, "\\$&");
}
