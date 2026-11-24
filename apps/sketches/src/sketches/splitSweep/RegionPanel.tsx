// Properties of the selected region: split tool, colours, the A/B notes,
// slide duration, sharpness, and solo playback.
import { useRef, memo } from "react";
import { useSnapshot } from "valtio";
import { Button, Field, NumberBox, Toggle } from "../../shared/controls/controls";
import { logisticSigmoid } from "../../shared/logisticSigmoid";
import { canSplit, deletePlan, regionPitches, type Region } from "./model";
import { engine } from "./engine";
import { NotesRoll } from "./NotesRoll";
import { applySplit, beginSplit, cancelSplit, deleteRegion, doc, ui, updateRegion, view } from "./store";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// The roll's convention: C3 = 60.
const noteName = (pitch: number) => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 2}`;

export const RegionPanel = memo(function RegionPanel() {
  const state = useSnapshot(ui);
  const snap = useSnapshot(doc);
  const region = snap.regions.find((r) => r.id === state.selectedId) as Region | undefined;
  if (!region) return <div className="panel panel--empty">Click a region to select it.</div>;
  return <RegionEditor region={region} />;
});

function RegionEditor({ region }: { region: Region }) {
  const state = useSnapshot(ui);
  const layout = useSnapshot(view);
  const id = region.id;
  const { a, b } = regionPitches(region);
  const full = layout.rollFull;
  const toggleFull = () => {
    // Full height needs a fixed row height to fill: keep the current one.
    if (!view.rollFull && view.topHeight === null) {
      const row = document.querySelector(".workspace");
      if (row) view.topHeight = row.clientHeight;
    }
    view.rollFull = !view.rollFull;
  };

  const split = state.split;
  return (
    <div className={`panel${full ? " is-roll-full" : ""}`}>
      {full ? null : (
        <section className="panel__section">
          <header>Region <span className="dim">{(region.w * 100).toFixed(0)} × {(region.h * 100).toFixed(0)}</span></header>
          {!split ? (
            <div className="row">
              <Button label="Split…" onClick={beginSplit} title="Click in the region to drop an anchor, then choose the line" />
              <DeleteButton id={id} />
              <Toggle label="Solo" on={state.solo} tone="play" onChange={(on) => {
                engine.start();
                ui.solo = on;
              }} title="Only this region drones; click it to trigger, right-click to stop" />
              {state.solo ? (
                <>
                  <Button label="Trigger" tone="play" onClick={() => engine.trigger(id)} />
                  <Button label="Off" onClick={() => engine.release(id)} />
                </>
              ) : null}
            </div>
          ) : (
            <div className="row">
              {split.anchor ? (
                <>
                  <SplitButton axis="vertical" label="Vertical  (V)" region={region} />
                  <SplitButton axis="horizontal" label="Horizontal  (H)" region={region} />
                </>
              ) : <span className="hint">Click inside the region to drop the anchor.</span>}
              <Button label="Cancel" onClick={cancelSplit} title="Escape" />
            </div>
          )}
        </section>
      )}

      {full ? null : (
        <section className="panel__section">
          <header>Colours</header>
          <div className="row">
            <ColorField label="A" value={region.colorA} onChange={(colorA) => updateRegion(id, "colour A", { colorA }, `colorA:${id}`)} />
            <ColorField label="B" value={region.colorB} onChange={(colorB) => updateRegion(id, "colour B", { colorB }, `colorB:${id}`)} />
            <div className="swatch-ramp" style={{ background: `linear-gradient(90deg, ${region.colorA}, ${region.colorB})` }} title="RGB → Macro 1 / 2 / 3 (0..1) per voice" />
          </div>
        </section>
      )}

      <section className="panel__section panel__section--notes">
        <header>
          Notes <span className="dim">A {noteName(a)} → B {noteName(b)} · double-click to add</span>
          <span className="spacer" />
          <Toggle label="Full height" on={full} onChange={toggleFull} title="Show only the roll, at the panel's full height" />
        </header>
        <NotesRoll region={region} full={full} />
      </section>

      {full ? null : (
        <section className="panel__section">
          <header>Slide</header>
          <div className="row slide-row">
            <div className="stack">
            <Field label="Duration">
              <NumberBox value={region.slideSec} min={0.05} max={20} step={0.05} unit="s" bar horizontal width={150}
                onChange={(slideSec) => updateRegion(id, "slide duration", { slideSec }, `slide:${id}`)} />
            </Field>
            <Field label="Sharpness">
              <NumberBox value={region.sharpness} min={0} max={0.99} step={0.01} bar horizontal width={150}
                onChange={(sharpness) => updateRegion(id, "sharpness", { sharpness }, `sharp:${id}`)} />
            </Field>
            </div>
            <CurvePreview sharpness={region.sharpness} />
          </div>
        </section>
      )}
    </div>
  );
}

function DeleteButton({ id }: { id: string }) {
  const snap = useSnapshot(doc);
  const plan = deletePlan(snap.regions as Region[], id);
  return (
    <span onPointerEnter={() => (ui.deletePreview = true)} onPointerLeave={() => (ui.deletePreview = false)}>
      <Button label="Delete" tone="rec" disabled={!plan} onClick={() => deleteRegion(id)}
        title={plan ? `Delete (⌫): the ${plan.side} neighbour${plan.absorbers.length > 1 ? "s grow" : " grows"} over it` : "The only region can't be deleted"} />
    </span>
  );
}

function SplitButton({ axis, label, region }: { axis: "vertical" | "horizontal"; label: string; region: Region }) {
  return (
    <span
      onPointerEnter={() => ui.split && (ui.split.hover = axis)}
      onPointerLeave={() => ui.split && (ui.split.hover = null)}
    >
      <Button label={label} tone="select" disabled={!canSplit(region, axis)} onClick={() => applySplit(axis)} />
    </span>
  );
}

export function ColorField({ label, value, onChange, hex = true }: { label: string; value: string; onChange: (value: string) => void; hex?: boolean }) {
  return (
    <label className="color-field">
      <span>{label}</span>
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
      {hex ? <code>{value}</code> : null}
    </label>
  );
}

function CurvePreview({ sharpness }: { sharpness: number }) {
  const ref = useRef<SVGPathElement>(null);
  const points = Array.from({ length: 41 }, (_, i) => {
    const x = i / 40;
    return `${(x * 60).toFixed(1)},${(30 - logisticSigmoid(x, sharpness) * 30).toFixed(1)}`;
  });
  return (
    <svg className="curve" width={64} height={34} viewBox="-2 -2 64 34">
      <path ref={ref} d={`M${points.join("L")}`} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}
