/// <reference lib="dom" />
// Same-tab canvas views find the first canvas in a named stage container.
// Deleting/resizing a view never changes this module-owned DOM.

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
    `:scope > [${CANVAS_SURFACE_ATTRIBUTE}="${CSS.escape(surfaceName)}"]`,
  );
  if (!container) {
    container = document.createElement("div");
    container.setAttribute(CANVAS_SURFACE_ATTRIBUTE, surfaceName);
    container.className = "livecode-canvas-surface";
    stage.appendChild(container);
  } else {
    container.replaceChildren();
  }
  const surfaceContainer = container;
  return {
    name: surfaceName,
    container: surfaceContainer,
    createCanvas(width, height) {
      surfaceContainer.replaceChildren();
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      surfaceContainer.appendChild(canvas);
      return canvas;
    },
    canvas: () => surfaceContainer.querySelector("canvas"),
    clear: () => surfaceContainer.replaceChildren(),
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
