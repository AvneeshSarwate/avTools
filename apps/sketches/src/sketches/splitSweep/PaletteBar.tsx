import { memo } from "react";
// Left sidebar: every region's A -> B colours in one column, editable, so the
// palette can be shaped as a whole. Each row carries a thumbnail of where its
// region sits; hovering a row outlines the region on the grid, clicking
// selects it.
import { useSnapshot } from "valtio";
import { ASPECT } from "./Grid";
import type { Region } from "./model";
import { ColorField } from "./RegionPanel";
import { doc, select, ui, updateRegion } from "./store";

const THUMB_W = 34;
const THUMB_H = Math.round(THUMB_W / ASPECT);

export const PaletteBar = memo(function PaletteBar() {
  const snap = useSnapshot(doc);
  const state = useSnapshot(ui);
  return (
    <aside className="palette" onPointerLeave={() => (ui.hoverId = null)}>
      <header>Palette</header>
      {(snap.regions as Region[]).map((region) => (
        <div
          key={region.id}
          className={`palette__row${region.id === state.selectedId ? " is-selected" : ""}${region.id === state.hoverId ? " is-hover" : ""}`}
          onPointerEnter={() => (ui.hoverId = region.id)}
          onClick={(event) => {
            // The colour inputs keep their own clicks.
            if ((event.target as HTMLElement).tagName !== "INPUT" && ui.mode === "edit") select(region.id);
          }}
        >
          <svg className="palette__thumb" width={THUMB_W} height={THUMB_H} viewBox={`0 0 ${THUMB_W} ${THUMB_H}`}>
            <rect x={0.5} y={0.5} width={THUMB_W - 1} height={THUMB_H - 1} />
            <rect className="palette__thumb-region" x={region.x * THUMB_W} y={region.y * THUMB_H}
              width={Math.max(1.5, region.w * THUMB_W)} height={Math.max(1.5, region.h * THUMB_H)} />
          </svg>
          <ColorField hex={false} label="A" value={region.colorA}
            onChange={(colorA) => updateRegion(region.id, "colour A", { colorA }, `colorA:${region.id}`)} />
          <ColorField hex={false} label="B" value={region.colorB}
            onChange={(colorB) => updateRegion(region.id, "colour B", { colorB }, `colorB:${region.id}`)} />
          <div className="palette__ramp" style={{ background: `linear-gradient(90deg, ${region.colorA}, ${region.colorB})` }} />
        </div>
      ))}
    </aside>
  );
});
