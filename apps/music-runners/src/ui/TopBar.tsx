import { useState } from "react";
import type { Editor } from "tldraw";
import { RUNNERS } from "../runners/registry";
import { createInstance, listInstances } from "../shapes";
import { clockStore, setBpm } from "../store/clock";
import { ensureMidi, midiStore, panicAllOutputs, refreshOutputs } from "../store/midi";
import { useSnapshot } from "valtio";
import { playbackStore, startRun, stopAll } from "../store/playback";
import { listProjects, projectStore, saveProject, switchProject } from "../store/project";
import { Button, Chooser, Field, Lamp, NumberBox, TextField } from "./controls/controls";

export function TopBar({ editor }: { editor: Editor | null }) {
  const clock = useSnapshot(clockStore);
  const midi = useSnapshot(midiStore);
  const project = useSnapshot(projectStore);
  const playback = useSnapshot(playbackStore);
  const activeCount = Object.values(playback.instances).filter((runtime) => runtime.mode !== "idle").length;

  const playQueued = () => {
    if (!editor) return;
    const queued = listInstances(editor).filter((instance) => instance.props.queued);
    for (const instance of queued) startRun(instance.id);
  };

  const [newProjectName, setNewProjectName] = useState("");
  const projectOptions = [project.name, ...project.available.filter((name) => name !== project.name)].map((name) => ({ value: name, label: name }));
  const saveTone = project.status === "error" ? "rec" : project.status === "dirty" ? "warn" : project.status === "saving" ? "select" : "off";
  const savedAt = project.lastSavedAt ? new Date(project.lastSavedAt).toLocaleTimeString() : "";
  const midiTone = midi.status === "ready" ? "play" : midi.status === "error" ? "rec" : midi.status === "opening" ? "warn" : "off";

  return (
    <div className="top-bar">
      <div className="ui-group">
        <span className="top-bar__title">music runners</span>
        <Chooser
          value={project.name}
          options={projectOptions}
          onOpen={() => void listProjects()}
          onChange={(name) => switchProject(name)}
          title="project (projects/<name>/project.json)"
          width={130}
        />
        <TextField
          value={newProjectName}
          onChange={setNewProjectName}
          onCommit={() => {
            if (/^[a-zA-Z0-9_-]+$/.test(newProjectName)) switchProject(newProjectName);
          }}
          placeholder="new project…"
          title="type a name and press Enter to create or open it"
          width={110}
        />
        <Button icon="save" quiet onClick={() => void saveProject()} title="save now (autosave runs a second after any change)" />
        <span className="top-bar__status" title={project.error ?? undefined}>
          <Lamp tone={saveTone} />
          {project.status === "saved" && savedAt ? `saved ${savedAt}` : project.status}
        </span>
      </div>

      <span className="ui-spacer" />

      <div className="ui-group">
        <Field label="bpm">
          <NumberBox value={clock.bpm} min={20} max={400} step={0.01} format={(value) => value.toFixed(2)} width={58} onChange={setBpm} title="tempo of the shared clock" />
        </Field>
      </div>
      <div className="ui-group">
        <Button icon="play" label="Play queued" tone="play" onClick={playQueued} disabled={!editor} title="run every instance with Q on, together" />
        <Button icon="stop" label={activeCount ? `Stop all (${activeCount})` : "Stop all"} onClick={stopAll} disabled={activeCount === 0} />
        <Button icon="panic" label="Panic" quiet onClick={panicAllOutputs} title="all notes off on every open output" />
      </div>

      <span className="ui-spacer" />

      <div className="ui-group">
        <span className="top-bar__status" title={midi.error ?? `${midi.outputs.length} outputs, ${midi.inputs.length} inputs`}>
          <Lamp tone={midiTone} />
          MIDI {midi.status === "ready" ? `${midi.outputs.length} out · ${midi.inputs.length} in` : midi.status}
        </span>
        {midi.status === "ready" ? (
          <Button icon="refresh" quiet onClick={refreshOutputs} title="re-scan MIDI ports" />
        ) : (
          <Button label="Connect" onClick={() => void ensureMidi()} />
        )}
        {midi.error ? <span className="top-bar__error">{midi.error}</span> : null}
      </div>
      <div className="ui-group">
        <span className="ui-caption">add</span>
        {RUNNERS.map((def) => (
          <Button key={def.type} icon="plus" label={def.label} disabled={!editor} title={def.description} onClick={() => editor && createInstance(editor, def.type)} />
        ))}
      </div>
    </div>
  );
}
