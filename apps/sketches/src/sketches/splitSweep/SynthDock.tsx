// Sound design: the Six Sines editor for the sketch's patch, and the live
// MIDI input (played on a second engine with the same patch).
import { useSnapshot } from "valtio";
import { Button, Chooser } from "../../shared/controls/controls";
import { ensureMidi, midiInputStore, refreshInputs, selectMidiInput } from "../../shared/midiInput";
import { SixSinesPanel } from "../../shared/sixSines/SixSinesPanel";
import type { SynthPatch } from "../../shared/sixSines/synth";
import { engine } from "./engine";
import { doc, setSynthParameters, setSynthPreset } from "./store";

const NONE = "__none__";

export function SynthDock() {
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
        <span className="dim">Macro 1/2/3 ← region R/G/B · Macro 4 ← fade level (all per voice)</span>
        <span className="spacer" />
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
        <Button label="Panic" onClick={() => engine.panic()} title="All notes off on both engines" />
      </div>
      <div className="synth-dock__editor" onPointerDown={() => engine.start()}>
        <SixSinesPanel patch={snap.synth as SynthPatch} onParameters={setSynthParameters} onPreset={setSynthPreset} />
      </div>
    </div>
  );
}
