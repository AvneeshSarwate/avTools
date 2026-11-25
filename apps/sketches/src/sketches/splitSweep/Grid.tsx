// The grid (16:9): one Konva layer drawn immediate-mode every frame by a
// core-timing frame loop (regions, sweep fills, the black lines, and in edit
// mode the selection and split preview). Pointer input is hit-tested against
// the document rectangles directly.
import Konva from "konva";
import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, memo } from "react";
import { onRender } from "../../shared/frameLoop";
import { ASPECT, DEFAULT_LINE_WIDTH, deletePlan, regionAt, type Region } from "./model";
import { engine } from "./engine";
import { doc, findRegion, placeAnchor, select, ui } from "./store";

/**
 * Divider / frame / sweep line thickness in px for the frame being drawn:
 * set from doc.lineWidth at the start of each draw (it scales with the canvas).
 */
let LINE = 6;
const OFF_FILL = "#ece8df";
const SELECT = "#ffcc00";
const HOVER = "#4fb3ff";
const DELETE = "#ff4f4f";


/** `rotated`: the grid is shown turned 90° clockwise (presentation on a portrait screen). */
export const Grid = memo(function Grid({ width, rotated = false }: { width: number; rotated?: boolean }) {
  const height = Math.round(width / ASPECT);
  const host = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };
  const hover = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const container = host.current!;
    const stage = new Konva.Stage({ container, ...sizeRef.current });
    const layer = new Konva.Layer({ listening: false });
    const shape = new Konva.Shape({
      sceneFunc: (context) => draw(context._context, sizeRef.current.width, sizeRef.current.height, hover.current),
    });
    layer.add(shape);
    stage.add(layer);
    // Drawn in the page's frame loop, after the engine's update, synchronously
    // (layer.draw, not batchDraw, which would defer to Konva's own RAF).
    const off = onRender(() => {
      const size = sizeRef.current;
      if (stage.width() !== size.width || stage.height() !== size.height) stage.size(size);
      layer.draw();
    });
    return () => {
      off();
      stage.destroy();
    };
  }, []);

  // A pointer in the grid's own unit square. Turned 90° clockwise, the grid's
  // x runs down the screen and its y runs right to left.
  const unit = (event: { clientX: number; clientY: number }) => {
    const rect = host.current!.getBoundingClientRect();
    const across = (event.clientX - rect.left) / rect.width;
    const down = (event.clientY - rect.top) / rect.height;
    return rotated ? { x: down, y: 1 - across } : { x: across, y: down };
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    engine.start();
    const point = unit(event);
    const region = regionAt(doc.regions, point.x, point.y);
    if (!region) return;
    const right = event.button === 2;
    if (event.button !== 0 && !right) return;
    // Present and play: the performance gestures
    if (ui.mode !== "edit") {
      if (right) engine.release(region.id);
      else engine.trigger(region.id);
      return;
    }
    // Edit mode
    if (ui.split && !right) {
      if (region.id === ui.selectedId) placeAnchor(point.x, point.y);
      return;
    }
    if (region.id !== ui.selectedId) {
      select(region.id);
      return;
    }
    // Soloing the selected region: clicks play it like play mode does
    if (ui.solo) {
      if (right) engine.release(region.id);
      else engine.trigger(region.id);
    }
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const point = unit(event);
    hover.current = point;
    // Edit mode: the region under the pointer gets the same hover as the
    // palette and roll (outline here, its palette row, its notes in the roll).
    // Not in play mode, where the grid is the piece; not while placing a split.
    const id = ui.mode === "edit" && !ui.split ? (regionAt(doc.regions, point.x, point.y)?.id ?? null) : null;
    if (ui.hoverId !== id) ui.hoverId = id;
  };

  return (
    <div
      ref={host}
      className="grid-canvas"
      style={{ width, height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => {
        hover.current = null;
        ui.hoverId = null;
      }}
      onContextMenu={(event: ReactMouseEvent) => event.preventDefault()}
    />
  );
});

/** Unit-square edges within this of the border count as on it. */
const EDGE = 1e-6;

interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radii: top-left, top-right, bottom-right, bottom-left. */
  radii: [number, number, number, number];
}

/**
 * A region's visible tile: its rectangle inset by half a divider inside the
 * canvas and by a whole one at the frame, so the black ground shows through
 * as the dividers and the frame. Every tile corner is rounded, including
 * those against the frame (the frame's own outer corners, the canvas edge,
 * stay square). `inset` shrinks it further (outlines).
 */
function tileOf(region: Region, width: number, height: number, radius: number, inset = 0): Tile {
  const left = region.x < EDGE;
  const top = region.y < EDGE;
  const right = region.x + region.w > 1 - EDGE;
  const bottom = region.y + region.h > 1 - EDGE;
  const x0 = region.x * width + (left ? LINE : LINE / 2) + inset;
  const y0 = region.y * height + (top ? LINE : LINE / 2) + inset;
  const x1 = (region.x + region.w) * width - (right ? LINE : LINE / 2) - inset;
  const y1 = (region.y + region.h) * height - (bottom ? LINE : LINE / 2) - inset;
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const r = Math.max(0, Math.min(radius - inset, w / 2, h / 2));
  return {
    x: x0, y: y0, w, h,
    radii: [r, r, r, r],
  };
}

function tilePath(g: CanvasRenderingContext2D, t: Tile) {
  g.beginPath();
  g.roundRect(t.x, t.y, t.w, t.h, t.radii);
}

/** An outline just inside a tile, with a black underlay so it reads on any region colour. */
function outlineTile(g: CanvasRenderingContext2D, region: Region, width: number, height: number, radius: number, color: string, dash?: number[]) {
  const t = tileOf(region, width, height, radius, 3);
  g.save();
  tilePath(g, t);
  g.strokeStyle = "#000";
  g.lineWidth = dash ? 5 : 7;
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = 3;
  if (dash) g.setLineDash(dash);
  g.stroke();
  g.restore();
}

function draw(g: CanvasRenderingContext2D, width: number, height: number, hover: { x: number; y: number } | null) {
  const px = (r: Region) => ({ x: r.x * width, y: r.y * height, w: r.w * width, h: r.h * height });
  const radius = (doc.cornerRadius ?? 0) * height;
  LINE = Math.max(1, (doc.lineWidth ?? DEFAULT_LINE_WIDTH) * height);
  // Black ground: what shows between the tiles is the dividers and the frame.
  g.fillStyle = "#000";
  g.fillRect(0, 0, width, height);

  for (const region of doc.regions) {
    const t = tileOf(region, width, height, radius);
    const { level, mix } = engine.display(region.id);
    // The sweep line moves across the tile along its direction: A -> B runs
    // left to right (or top to bottom), B behind the line, A ahead of it;
    // B -> A runs back. Mid-sweep it is a gap of line width like a divider,
    // and the two sides are rounded tiles of their own, so its corners round
    // like the dividers' do. Each side's corners (outer ones too) shrink with
    // it once it is thinner than twice the radius: a sliver, not a wedge.
    const sweeping = level > 0.0005 && mix > 0.0005 && mix < 0.9995;
    const vertical = region.direction === "vertical";
    const start = vertical ? t.y : t.x;
    const span = vertical ? t.h : t.w;
    // The gap enters from just outside the leading edge and leaves just
    // outside the far one (merging into the divider), so each side is
    // exactly full size at mix 0 and 1: no jump when the sweep ends.
    const line = start - LINE / 2 + (span + LINE) * mix;
    const end = start + span;
    const parts: { from: number; size: number; color: string }[] = sweeping
      ? [
        { from: start, size: Math.max(0, Math.min(end, line - LINE / 2) - start), color: region.colorB },
        { from: Math.max(start, line + LINE / 2), size: Math.max(0, end - Math.max(start, line + LINE / 2)), color: region.colorA },
      ]
      : [{ from: start, size: span, color: mix >= 0.5 ? region.colorB : region.colorA }];
    // The tile's own radius (already capped by its size); the ground is black.
    const tileRadius = t.radii[0];
    for (const part of parts) {
      if (part.size <= 0.25) continue;
      const r = Math.max(0, Math.min(tileRadius, part.size / 2));
      g.beginPath();
      if (vertical) g.roundRect(t.x, part.from, t.w, part.size, r);
      else g.roundRect(part.from, t.y, part.size, t.h, r);
      g.fillStyle = OFF_FILL;
      g.fill();
      if (level > 0.0005) {
        g.globalAlpha = level;
        g.fillStyle = part.color;
        g.fill();
        g.globalAlpha = 1;
      }
    }
  }

  const hovered = findRegion(ui.hoverId);
  if (hovered) {
    g.save();
    tilePath(g, tileOf(hovered, width, height, radius));
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.fill();
    g.restore();
    outlineTile(g, hovered, width, height, radius, HOVER);
  }

  if (ui.mode !== "edit") return;
  const selected = findRegion(ui.selectedId);
  if (!selected) return;

  // Delete preview: the doomed region struck through, the neighbours that
  // will grow over it washed and outlined.
  const plan = ui.deletePreview ? deletePlan(doc.regions, selected.id) : null;
  if (plan) {
    const d = tileOf(selected, width, height, radius);
    g.save();
    tilePath(g, d);
    g.clip();
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(d.x, d.y, d.w, d.h);
    g.beginPath();
    g.moveTo(d.x, d.y);
    g.lineTo(d.x + d.w, d.y + d.h);
    g.moveTo(d.x + d.w, d.y);
    g.lineTo(d.x, d.y + d.h);
    g.strokeStyle = "#000";
    g.lineWidth = 8;
    g.stroke();
    g.strokeStyle = DELETE;
    g.lineWidth = 4;
    g.stroke();
    g.restore();
    for (const id of plan.absorbers) {
      const n = findRegion(id);
      if (!n) continue;
      g.save();
      tilePath(g, tileOf(n, width, height, radius));
      g.fillStyle = "rgba(255,255,255,0.2)";
      g.fill();
      g.restore();
      outlineTile(g, n, width, height, radius, HOVER);
    }
    return;
  }
  outlineTile(g, selected, width, height, radius, SELECT, [8, 5]);
  const r = px(selected);

  const split = ui.split;
  if (!split) return;
  const inside = (p: { x: number; y: number }) =>
    p.x >= selected.x && p.x <= selected.x + selected.w && p.y >= selected.y && p.y <= selected.y + selected.h;
  const point = split.anchor ?? (hover && inside(hover) ? hover : null);
  if (!point) return;
  const ax = point.x * width;
  const ay = point.y * height;
  g.save();
  g.lineWidth = LINE;
  g.setLineDash([10, 8]);
  const showVertical = !split.anchor || split.hover !== "horizontal";
  const showHorizontal = !split.anchor || split.hover !== "vertical";
  g.strokeStyle = split.anchor ? "rgba(0,0,0,0.75)" : "rgba(0,0,0,0.3)";
  if (showVertical) {
    g.beginPath();
    g.moveTo(ax, r.y);
    g.lineTo(ax, r.y + r.h);
    g.stroke();
  }
  if (showHorizontal) {
    g.beginPath();
    g.moveTo(r.x, ay);
    g.lineTo(r.x + r.w, ay);
    g.stroke();
  }
  g.setLineDash([]);
  g.fillStyle = split.anchor ? "#000" : "rgba(0,0,0,0.4)";
  g.beginPath();
  g.arc(ax, ay, 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = SELECT;
  g.beginPath();
  g.arc(ax, ay, 3, 0, Math.PI * 2);
  g.fill();
  g.restore();
}
