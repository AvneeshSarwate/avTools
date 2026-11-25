import { memo } from "react";
// Sound: the sweep boost (global), the Six Sines editor for the sketch's
// patch (every region's engine runs it), and the live MIDI input (played on
// its own engine with the same patch).
import { useSnapshot } from "valtio";
import { Button, Chooser, Field, NumberBox } from "../../shared/controls/controls";
import { ensureMidi, midiInputStore, refreshInputs, selectMidiInput } from "../../shared/midiInput";
import { SixSinesPanel } from "../../shared/sixSines/SixSinesPanel";
import type { SynthPatch } from "../../shared/sixSines/synth";
import { engine } from "./engine";
import { doc, setSweepBoost, setSweepBoostRamp, setSynthParameters, setSynthPreset } from "./store";

const NONE = "__none__";

export const SynthDock = memo(function SynthDock() {
  const snap = useSnapshot(doc);
  const midi = useSnapshot(midiInputStore);
  const options = [
    { value: NONE, label: "No MIDI input", muted: true },
    ...midi.inputs.map((port) => ({ value: port.name, label: port.name })),
  ];
  return (
    <div className="synth-dock">
      <div className="synth-dock__bar">
        <span className="synth-dock__title">Six Sines</span>
        <span className="dim">Macro 1/2/3 ← region R/G/B · Macro 4 ← sweep boost (per voice; routed to Main Amplitude)</span>
        <span className="spacer" />
        <Field label="Sweep boost" title="How much louder a region's note is while it sweeps between A and B">
          <NumberBox value={snap.sweepBoostDb} min={0} max={12} step={0.5} unit="dB" bar horizontal width={110} onChange={setSweepBoost} />
        </Field>
        <Field label="Ramp" title="Time for the boost to ramp up when a sweep starts, and back down when it ends">
          <NumberBox value={Math.round(snap.sweepBoostRampSec * 1000)} min={5} max={500} step={5} unit="ms" bar horizontal width={110} onChange={setSweepBoostRamp} />
        </Field>
        <Chooser
          value={midi.selected ?? NONE}
          options={options}
          width={220}
          onOpen={() => void ensureMidi().then(refreshInputs)}
          onChange={(value) => {
            engine.start();
            void selectMidiInput(value === NONE ? null : value);
          }}
          title="Live MIDI input; plays its own Six Sines instance with this patch"
        />
        {midi.status === "error" ? <span className="warn">MIDI: {midi.error}</span> : null}
        <Button label="Panic" onClick={() => engine.panic()} title="All notes off on every engine" />
      </div>
      <div className="synth-dock__editor" onPointerDown={() => engine.start()}>
        <SixSinesPanel patch={snap.synth as SynthPatch} onParameters={setSynthParameters} onPreset={setSynthPreset} />
      </div>
    </div>
  );
});
