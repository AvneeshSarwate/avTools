// The grid (16:9): one Konva layer drawn immediate-mode every frame by a
// core-timing frame loop (regions, sweep fills, the black lines, and in edit
// mode the selection and split preview). Pointer input is hit-tested against
// the document rectangles directly.
import Konva from "konva";
import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { asBrowser, rootContext } from "../../shared/clock";
import { regionAt, type Region } from "./model";
import { engine } from "./engine";
import { doc, findRegion, placeAnchor, select, ui } from "./store";

const LINE = 6;
const OFF_FILL = "#ece8df";
const SELECT = "#ffcc00";

/** Width : height of the grid. Regions are stored in unit coordinates on both axes. */
export const ASPECT = 16 / 9;

export function Grid({ width }: { width: number }) {
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
    const loop = rootContext().branch(async (ctx) => {
      const frames = asBrowser(ctx);
      while (true) {
        await frames.waitFrame();
        const size = sizeRef.current;
        if (stage.width() !== size.width || stage.height() !== size.height) stage.size(size);
        layer.batchDraw();
      }
    }, "square draw loop");
    return () => {
      loop.cancel();
      stage.destroy();
    };
  }, []);

  const unit = (event: { clientX: number; clientY: number }) => {
    const rect = host.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    engine.start();
    const point = unit(event);
    const region = regionAt(doc.regions, point.x, point.y);
    if (!region) return;
    const right = event.button === 2;
    if (event.button !== 0 && !right) return;
    if (ui.mode === "play") {
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
    hover.current = unit(event);
  };

  return (
    <div
      ref={host}
      className="grid-canvas"
      style={{ width, height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => (hover.current = null)}
      onContextMenu={(event: ReactMouseEvent) => event.preventDefault()}
    />
  );
}

function draw(g: CanvasRenderingContext2D, width: number, height: number, hover: { x: number; y: number } | null) {
  const px = (r: Region) => ({ x: r.x * width, y: r.y * height, w: r.w * width, h: r.h * height });
  g.fillStyle = OFF_FILL;
  g.fillRect(0, 0, width, height);

  for (const region of doc.regions) {
    const { level, mix } = engine.display(region.id);
    if (level <= 0.0005) continue;
    const r = px(region);
    // The sweep line: A to its left, B to its right. Fully A puts it on the
    // right edge, so A -> B moves it right to left.
    const line = r.x + r.w * (1 - mix);
    g.save();
    g.globalAlpha = level;
    g.fillStyle = region.colorA;
    g.fillRect(r.x, r.y, line - r.x, r.h);
    g.fillStyle = region.colorB;
    g.fillRect(line, r.y, r.x + r.w - line, r.h);
    g.restore();
  }

  // Lines: every region's outline; shared edges overlap into one stroke.
  g.strokeStyle = "#000";
  g.lineWidth = LINE;
  for (const region of doc.regions) {
    const r = px(region);
    g.strokeRect(r.x, r.y, r.w, r.h);
  }
  g.strokeRect(LINE / 2, LINE / 2, width - LINE, height - LINE);

  if (ui.mode !== "edit") return;
  const selected = findRegion(ui.selectedId);
  if (!selected) return;
  const r = px(selected);
  g.save();
  g.strokeStyle = SELECT;
  g.lineWidth = 3;
  g.setLineDash([8, 5]);
  const inset = LINE / 2 + 3;
  g.strokeRect(r.x + inset, r.y + inset, r.w - 2 * inset, r.h - 2 * inset);
  g.restore();

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
