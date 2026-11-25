// Left sidebar: everything that applies to the whole canvas. Its look (line
// thickness, corner radius) on top, then the palette: every region's A -> B
// colours in one column, editable, so the palette can be shaped as a whole.
// Each palette row carries a thumbnail of where its region sits; hovering a
// row outlines the region on the grid, clicking selects it. (The right panel
// is the selected region; the dock is the sound; the top bar is the app.)
import { memo } from "react";
import { useSnapshot } from "valtio";
import { Field, NumberBox } from "../../shared/controls/controls";
import { ASPECT, REFERENCE_HEIGHT, type Region } from "./model";
import { ColorField } from "./RegionPanel";
import { doc, select, setCornerRadius, setLineWidth, ui, updateRegion } from "./store";

const THUMB_W = 34;
const THUMB_H = Math.round(THUMB_W / ASPECT);

export const PaletteBar = memo(function PaletteBar() {
  const snap = useSnapshot(doc);
  const state = useSnapshot(ui);
  return (
    <aside className="palette" onPointerLeave={() => (ui.hoverId = null)}>
      <section className="sidebar__section">
        <header>Canvas</header>
        <div className="sidebar__fields">
          <Field label="Lines" title={`Divider, frame and sweep line thickness, in px at ${REFERENCE_HEIGHT}p (scales with the canvas)`}>
            <NumberBox value={Math.round(snap.lineWidth * REFERENCE_HEIGHT)} min={1} max={40} step={1} unit="px" bar horizontal width={100}
              onChange={setLineWidth} />
          </Field>
          <Field label="Corners" title={`Tile corner radius, in px at ${REFERENCE_HEIGHT}p (scales with the canvas)`}>
            <NumberBox value={Math.round(snap.cornerRadius * REFERENCE_HEIGHT)} min={0} max={80} step={1} unit="px" bar horizontal width={100}
              onChange={setCornerRadius} />
          </Field>
        </div>
      </section>
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
