// Properties of the selected region: split tool, colours, the A/B notes,
// slide duration, sharpness, and solo playback.
import { useCallback, useEffect, useRef } from "react";
import type { PianoRollHandle } from "../../shared/pianoRoll/types";
import { useSnapshot } from "valtio";
import { Button, Field, NumberBox, Toggle } from "../../shared/controls/controls";
import { PianoRoll } from "../../shared/pianoRoll/PianoRoll";
import type { PianoRollNote } from "../../shared/pianoRoll/types";
import { logisticSigmoid } from "../../shared/logisticSigmoid";
import { canSplit, regionPitches, type Region } from "./model";
import { engine } from "./engine";
import { applySplit, beginSplit, cancelSplit, doc, history, setRegionNotes, ui, updateRegion } from "./store";

const ROLL_WIDTH = 300;
const ROLL_HEIGHT = 200;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// The roll's convention: C3 = 60.
const noteName = (pitch: number) => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 2}`;

export function RegionPanel() {
  const state = useSnapshot(ui);
  const snap = useSnapshot(doc);
  const region = snap.regions.find((r) => r.id === state.selectedId) as Region | undefined;
  if (!region) return <div className="panel panel--empty">Click a region to select it.</div>;
  return <RegionEditor region={region} />;
}

function RegionEditor({ region }: { region: Region }) {
  const state = useSnapshot(ui);
  const id = region.id;
  const { a, b } = regionPitches(region);
  const firstTwo = new Set([...region.notes].sort((p, q) => p.position - q.position || p.pitch - q.pitch).slice(0, 2).map((n) => n.id));

  const onNotesChange = useCallback((notes: PianoRollNote[], label: string) => setRegionNotes(id, notes, label), [id]);
  const onKeyboardNote = useCallback((pitch: number, on: boolean) => {
    engine.start();
    engine.previewKey(on ? pitch : null);
  }, []);
  const onNotePreview = useCallback((note: { pitch: number }) => {
    engine.start();
    engine.audition(note.pitch);
  }, []);
  const onHistoryKey = useCallback((action: "undo" | "redo") => (action === "undo" ? history.undo() : history.redo()), []);
  const noteColor = useCallback(
    (note: PianoRollNote) => (firstTwo.has(note.id) ? undefined : "#555"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [[...firstTwo].join()],
  );
  useEffect(() => () => engine.previewKey(null), []);
  const roll = useRef<PianoRollHandle>(null);
  // Each region's roll opens framed on its notes.
  useEffect(() => {
    const frame = requestAnimationFrame(() => roll.current?.fitToContent());
    return () => cancelAnimationFrame(frame);
  }, [id]);

  const split = state.split;
  return (
    <div className="panel">
      <section className="panel__section">
        <header>Region <span className="dim">{(region.w * 100).toFixed(0)} × {(region.h * 100).toFixed(0)}</span></header>
        {!split ? (
          <div className="row">
            <Button label="Split…" onClick={beginSplit} title="Click in the region to drop an anchor, then choose the line" />
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

      <section className="panel__section">
        <header>Colours</header>
        <div className="row">
          <ColorField label="A" value={region.colorA} onChange={(colorA) => updateRegion(id, "colour A", { colorA }, `colorA:${id}`)} />
          <ColorField label="B" value={region.colorB} onChange={(colorB) => updateRegion(id, "colour B", { colorB }, `colorB:${id}`)} />
          <div className="swatch-ramp" style={{ background: `linear-gradient(90deg, ${region.colorA}, ${region.colorB})` }} title="RGB → Macro 1 / 2 / 3 (0..1) per voice" />
        </div>
      </section>

      <section className="panel__section">
        <header>Notes <span className="dim">A {noteName(a)} → B {noteName(b)} · first two notes in time; double-click to add</span></header>
        <div className="roll-frame" onPointerDown={() => engine.start()}>
          <PianoRoll
            key={id}
            ref={roll}
            notes={region.notes as PianoRollNote[]}
            onNotesChange={onNotesChange}
            loopLength={4}
            width={ROLL_WIDTH}
            height={ROLL_HEIGHT}
            interactive
            showControlPanel={false}
            expressionLanes={false}
            rawMetadataEditor={false}
            noteColor={noteColor}
            onKeyboardNote={onKeyboardNote}
            onNotePreview={onNotePreview}
            onHistoryKey={onHistoryKey}
          />
        </div>
      </section>

      <section className="panel__section">
        <header>Slide</header>
        <div className="row">
          <Field label="Duration">
            <NumberBox value={region.slideSec} min={0.05} max={20} step={0.05} unit="s" bar horizontal width={150}
              onChange={(slideSec) => updateRegion(id, "slide duration", { slideSec }, `slide:${id}`)} />
          </Field>
          <Field label="Sharpness">
            <NumberBox value={region.sharpness} min={0} max={0.99} step={0.01} bar horizontal width={150}
              onChange={(sharpness) => updateRegion(id, "sharpness", { sharpness }, `sharp:${id}`)} />
          </Field>
          <CurvePreview sharpness={region.sharpness} />
        </div>
      </section>
    </div>
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

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="color-field">
      <span>{label}</span>
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
      <code>{value}</code>
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
