import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchPresetText, keyToHz, NativeFm, Operators, SixSines, type Instrument, type NativeFmParams,
} from "../audio/engine";
import { clonePatch, getPath, setPath, type Patch } from "../audio/patch";
import {
  decodePreset, FEEDBACK, MATRIX, MIXER, patchToSixSines, RADIANS_PER_FEEDBACK, translatable, type DecodedPreset,
} from "../audio/sixSinesMap";
import type { Control, SixControl, Step } from "../lessons/types";
import { Graph, type GraphEdge, type GraphOp } from "../viz/Graph";
import { Scope } from "../viz/Scope";
import { Spectrum } from "../viz/Spectrum";
import { Roll } from "./Roll";

const fmt = (v: number, digits = 2) =>
  Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(digits);

function Slider({ control, value, onChange }: { control: Control; value: number; onChange: (v: number) => void }) {
  const { min, max, log } = control;
  const toPos = (v: number) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromPos = (p: number) => (log ? min * Math.pow(max / min, p) : min + p * (max - min));
  const snap = (v: number) => (control.step ? Math.round(v / control.step) * control.step : v);
  return (
    <div className="control">
      <label>
        <span className="control-label">{control.label}</span>
        <span className="control-value">
          {fmt(value)}
          {control.unit ? ` ${control.unit}` : ""}
        </span>
      </label>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={Math.max(0, Math.min(1, toPos(Math.max(value, log ? min : -Infinity))))}
        onChange={(e) => onChange(snap(fromPos(Number(e.target.value))))}
      />
      {control.marks && (
        <div className="marks">
          {control.marks.map((m) => (
            <button key={m} className={Math.abs(m - value) < 1e-6 ? "on" : ""} onClick={() => onChange(m)}>
              {fmt(m)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SixSlider({ control, value, onChange }: { control: SixControl; value: number; onChange: (v: number) => void }) {
  if (control.options) {
    return (
      <div className="control">
        <label>
          <span className="control-label">{control.label}</span>
        </label>
        <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
          {control.options.map((o, i) => (
            <option key={o} value={i}>{o}</option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <Slider
      control={{ label: control.label, path: "", min: control.min ?? 0, max: control.max ?? 1, step: control.step }}
      value={value}
      onChange={onChange}
    />
  );
}

const ratioText = (r: number) => `×${Number(r.toFixed(3))}`;

function patchGraph(patch: Patch): { ops: GraphOp[]; edges: GraphEdge[] } {
  return {
    ops: patch.ops.map((o, i) => ({
      number: i + 1,
      ratio: o.fixed ? `${o.hz} Hz` : ratioText(o.ratio),
      audible: o.level > 0,
      feedback: o.feedback ? `${fmt(o.feedback)} rad` : undefined,
      note: o.label,
    })),
    edges: patch.edges.map((e) => {
      const mode = e.mode ?? "pm";
      return {
        from: e.from + 1,
        to: e.to + 1,
        label: mode === "rm" ? `ring ${fmt(e.index)}` : mode === "fm" ? `${fmt(e.index)} Hz` : `${fmt(e.index)} rad`,
        weight: mode === "pm" ? e.index / 8 : 0.4,
        dashed: mode === "rm",
      };
    }),
  };
}

function presetGraph(preset: DecodedPreset, off: Set<string>): { ops: GraphOp[]; edges: GraphEdge[] } {
  return {
    ops: preset.ops.map((o) => ({
      number: o.index + 1,
      ratio: o.keytrack ? ratioText(o.ratio) : "fixed",
      audible: o.level > 0.005 && !off.has(`mix${o.index}`),
      feedback:
        o.feedback && !off.has(`fb${o.index}`)
          ? `${fmt(Math.abs(o.feedback) * RADIANS_PER_FEEDBACK * (o.feedbackOverdrive ? 10 : 1))} rad${o.feedback < 0 ? " (neg)" : ""}`
          : undefined,
      note: o.extended || (o.waveform !== "Sin" ? o.waveform : undefined),
    })),
    edges: preset.edges.map((e) => ({
      from: e.from + 1,
      to: e.to + 1,
      label: e.mode === "PM" ? `${fmt(e.radians)} rad` : `${e.mode} ${fmt(e.depth)}`,
      weight: e.mode === "PM" ? e.radians / 8 : 0.4,
      dashed: e.mode !== "PM",
      muted: off.has(`edge${e.from}-${e.to}`),
    })),
  };
}

/** The switchable stages of a preset: every matrix cell, feedback loop and audible operator. */
function presetStages(preset: DecodedPreset) {
  const stages: { key: string; label: string; id: number }[] = [];
  for (const e of preset.edges)
    stages.push({ key: `edge${e.from}-${e.to}`, label: `${e.from + 1} → ${e.to + 1}`, id: MATRIX(e.from, e.to) + 1 });
  for (const o of preset.ops)
    if (o.feedback) stages.push({ key: `fb${o.index}`, label: `feedback ${o.index + 1}`, id: FEEDBACK(o.index) + 1 });
  for (const o of preset.ops)
    if (o.level > 0.005) stages.push({ key: `mix${o.index}`, label: `output ${o.index + 1}`, id: MIXER(o.index) + 1 });
  return stages;
}

export function Bench({ step }: { step: Step }) {
  const source = step.source;
  const canSix = source.kind === "operators" && translatable(source.patch);
  const [engine, setEngine] = useState<"raw" | "six">(
    source.kind === "preset" ? "six" : source.kind === "operators" && source.engine === "six" && canSix ? "six" : "raw",
  );
  const [state, setState] = useState<Patch | NativeFmParams | null>(() =>
    source.kind === "operators" ? clonePatch(source.patch) : source.kind === "native" ? { ...source.params } : null,
  );
  const [sixValues, setSixValues] = useState(
    () => new Map((step.sixControls ?? []).map((c) => [c.id, c.initial] as [number, number])),
  );
  const [preset, setPreset] = useState<DecodedPreset | null>(null);
  const [off, setOff] = useState(() => new Set<string>());
  const [noteKey, setNoteKey] = useState(step.clip.notes[0]?.[0] ?? 60);
  const [answer, setAnswer] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const instrument = useRef<Instrument | undefined>(undefined);

  // Build the instrument for this engine. The parent keys the Bench by step,
  // so a new step always starts from a fresh mount.
  useEffect(() => {
    let disposed = false;
    if (source.kind === "native") {
      instrument.current = new NativeFm(state as NativeFmParams);
    } else if (source.kind === "operators" && engine === "raw") {
      instrument.current = new Operators(state as Patch);
    } else {
      const six = new SixSines();
      instrument.current = six;
      setLoading(true);
      six.onReady = () => !disposed && setLoading(false);
      if (source.kind === "operators") {
        six.loadPatch(state as Patch);
        six.setParams(sixValues);
      } else {
        void fetchPresetText(source.path).then((text) => {
          if (disposed) return;
          setPreset(decodePreset(text));
          six.loadPreset(text);
        });
      }
    }
    const built = instrument.current;
    return () => {
      disposed = true;
      built?.panic();
      if (built instanceof Operators) built.dispose();
      instrument.current = undefined;
    };
    // state is deliberately read once: later changes go through update calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  const change = (path: string, value: number) => {
    const next = setPath(state, path, value) as Patch | NativeFmParams;
    setState(next);
    const target = instrument.current;
    if (target instanceof NativeFm) target.update(next as NativeFmParams);
    else if (target instanceof Operators) target.update(next as Patch);
    else if (target instanceof SixSines) target.setParams(new Map([...patchToSixSines(next as Patch), ...sixValues]));
  };

  const changeSix = (id: number, value: number) => {
    const next = new Map(sixValues).set(id, value);
    setSixValues(next);
    if (instrument.current instanceof SixSines) instrument.current.setParams(next);
  };

  const stages = useMemo(() => (preset ? presetStages(preset) : []), [preset]);
  const toggleStage = (key: string) => {
    const next = new Set(off);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOff(next);
    if (instrument.current instanceof SixSines)
      instrument.current.setParams(new Map(stages.map((s) => [s.id, next.has(s.key) ? 0 : 1])));
  };

  const graph = useMemo(() => {
    if (source.kind === "operators") return patchGraph(state as Patch);
    if (source.kind === "preset") return preset ? presetGraph(preset, off) : null;
    const p = state as NativeFmParams;
    return {
      ops: [
        { number: 1, ratio: p.modHz !== undefined ? `${fmt(p.modHz)} Hz` : ratioText(p.ratio), audible: false, note: "modulator" },
        { number: 2, ratio: "×1", audible: true, note: "carrier" },
      ],
      edges: [{
        from: 1, to: 2, weight: 0.5,
        label: p.deviationHz !== undefined ? `±${fmt(p.deviationHz)} Hz` : `index ${fmt(p.index)}`,
      }],
    };
  }, [source.kind, state, preset, off]);

  const hidden = !!step.predict && answer === null;
  const noteHz = keyToHz(noteKey);
  const predicted = step.predicted && !hidden ? step.predicted(state) : undefined;

  return (
    <div className="bench-wrap">
      {step.predict && (
        <div className="predict">
          <div className="predict-tag">Predict first</div>
          <p className="predict-q">{step.predict.question}</p>
          <div className="predict-options">
            {step.predict.options.map((option, i) => (
              <button
                key={i}
                className={
                  answer === null ? "" : i === step.predict!.answer ? "right" : i === answer ? "wrong" : "dim"
                }
                onClick={() => answer === null && setAnswer(i)}
              >
                {option}
              </button>
            ))}
          </div>
          {answer !== null && <div className="predict-explain">{step.predict.explain}</div>}
        </div>
      )}

      <div className="bench">
        <div className="bench-head">
          <span className="bench-title">
            {source.kind === "native"
              ? "Web Audio: two OscillatorNodes and a GainNode"
              : source.kind === "preset"
                ? `Six Sines factory preset${preset ? `: ${preset.name}${preset.author ? `, by ${preset.author}` : ""}` : ""}`
                : engine === "raw"
                  ? "Operator worklet (phase modulation)"
                  : "Six Sines, same patch"}
          </span>
          {source.kind === "operators" && canSix && (
            <span className="engine-switch">
              <button className={engine === "raw" ? "on" : ""} onClick={() => setEngine("raw")}>Raw</button>
              <button className={engine === "six" ? "on" : ""} onClick={() => setEngine("six")}>Six Sines</button>
            </span>
          )}
          {loading && <span className="loading">loading engine…</span>}
        </div>

        <div className="bench-top">
          <figure className="fig fig-graph">
            {graph && <Graph ops={graph.ops} edges={graph.edges} />}
            <figcaption>Routing. Boxes with a tail are heard; the rest only modulate.</figcaption>
          </figure>
          <figure className="fig">
            <Scope noteHz={noteHz} />
            <figcaption>Waveform, three periods of the last note</figcaption>
          </figure>
        </div>
        <figure className="fig fig-wide">
          <Spectrum noteHz={noteHz} maxRatio={step.maxRatio ?? 16} predicted={predicted} hidden={hidden} />
          <figcaption>
            Spectrum. Horizontal axis in multiples of the played note
            {step.predicted ? "; orange bars are the predicted partials" : ""}
          </figcaption>
        </figure>

        {(step.controls || (step.sixControls && engine === "six") || stages.length > 0) && (
          <div className="controls">
            {step.controls?.map((control) => (
              <Slider
                key={control.path}
                control={control}
                value={getPath(state, control.path)}
                onChange={(v) => change(control.path, v)}
              />
            ))}
            {engine === "six" &&
              step.sixControls?.map((control) => (
                <SixSlider
                  key={control.id}
                  control={control}
                  value={sixValues.get(control.id) ?? control.initial}
                  onChange={(v) => changeSix(control.id, v)}
                />
              ))}
            {stages.length > 0 && (
              <div className="stages">
                <div className="control-label">Switch stages off to hear what each contributes (applies from the next note)</div>
                <div className="stage-list">
                  {stages.map((s) => (
                    <button key={s.key} className={off.has(s.key) ? "" : "on"} onClick={() => toggleStage(s.key)}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {step.sixControls && engine === "raw" && canSix && (
          <p className="bench-note">Switch to Six Sines for this step’s extra controls.</p>
        )}

        <Roll clip={step.clip} instrument={() => instrument.current} onNote={setNoteKey} />
      </div>

      {step.code && (
        <details className="code" open>
          <summary>The code that makes this sound</summary>
          <pre>{step.code}</pre>
        </details>
      )}
    </div>
  );
}
