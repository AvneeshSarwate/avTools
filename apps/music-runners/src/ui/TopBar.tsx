import { useRef, useState } from "react";
import { type Editor, useValue } from "tldraw";
import { listInstances } from "../shapes";
import { clockStore, setBpm } from "../store/clock";
import { ensureMidi, midiStore, panicAllOutputs, refreshOutputs } from "../store/midi";
import { useSnapshot } from "valtio";
import { playbackStore, startPlay, startRun, stopAll } from "../store/playback";
import { listProjects, loadProjectFromFile, projectStore, saveProject, saveProjectToFile, switchProject } from "../store/project";
import { Button, Chooser, Field, Lamp, NumberBox, TextField, Toggle } from "./controls/controls";
import { displayStore, setPitchLabels } from "../store/display";

export function TopBar({ editor }: { editor: Editor | null }) {
  const clock = useSnapshot(clockStore);
  const midi = useSnapshot(midiStore);
  const project = useSnapshot(projectStore);
  const display = useSnapshot(displayStore);
  const playback = useSnapshot(playbackStore);
  const activeCount = Object.values(playback.instances).filter((runtime) => runtime.mode !== "idle").length;

  const queuedCount = useValue("queued count", () => (editor ? listInstances(editor).filter((instance) => instance.props.queued).length : 0), [editor]);
  const startQueued = (start: (shapeId: string) => void) => {
    if (!editor) return;
    for (const instance of listInstances(editor)) if (instance.props.queued) start(instance.id);
  };

  const [newProjectName, setNewProjectName] = useState("");
  const projectOptions = [project.name, ...project.available.filter((name) => name !== project.name)].map((name) => ({ value: name, label: name }));
  const saveTone = project.status === "error" ? "rec" : project.status === "dirty" ? "warn" : project.status === "saving" ? "select" : "off";
  const savedAt = project.lastSavedAt ? new Date(project.lastSavedAt).toLocaleTimeString() : "";
  const manual = project.backend === "manual";
  const fileInput = useRef<HTMLInputElement>(null);
  const statusText = project.status === "saved" && savedAt ? `saved ${savedAt}` : manual && project.status === "dirty" ? "unsaved" : manual && project.status === "idle" ? "not saved" : project.status;
  const midiTone = midi.status === "ready" ? "play" : midi.status === "error" ? "rec" : midi.status === "opening" ? "warn" : "off";

  return (
    <div className="top-bar">
      <div className="ui-group">
        <span className="top-bar__title">music runners</span>
        {manual ? null : (
          <>
            <Chooser
              value={project.name}
              options={projectOptions}
              onOpen={() => void listProjects()}
              onChange={(name) => switchProject(name)}
              title="project (projects/<name>/project.json)"
              width={128}
            />
            <TextField
              value={newProjectName}
              onChange={setNewProjectName}
              onCommit={() => {
                if (/^[a-zA-Z0-9_-]+$/.test(newProjectName)) switchProject(newProjectName);
              }}
              placeholder="new project…"
              title="type a name and press Enter to create or open it"
              width={100}
            />
            <Button icon="save" quiet onClick={() => void saveProject()} title="save now (autosave runs a second after any change)" />
          </>
        )}
        <Button
          icon={manual ? "save" : undefined}
          label={manual ? "Save" : "Export"}
          onClick={saveProjectToFile}
          disabled={!editor}
          title={manual ? "save the project to a JSON file (nothing is saved automatically here)" : "download the project as a JSON file"}
        />
        <Button
          label={manual ? "Load" : "Import"}
          onClick={() => fileInput.current?.click()}
          disabled={!editor}
          title={manual ? "load a project from a JSON file, replacing what is open" : "replace this project's contents with a JSON file"}
        />
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void loadProjectFromFile(file);
          }}
        />
        <span className="top-bar__status top-bar__status--save" title={project.error ?? (savedAt ? `last saved ${savedAt}` : undefined)}>
          <Lamp tone={saveTone} />
          {statusText}
        </span>
      </div>

      <span className="ui-spacer" />

      <div className="ui-group">
        <span className="ui-caption">notes</span>
        <Toggle label="Name" on={display.pitchLabels === "name"} onChange={() => setPitchLabels("name")} title="label notes and keys with note names (C3 = 60); hover shows the MIDI number" />
        <Toggle label="MIDI" on={display.pitchLabels === "midi"} onChange={() => setPitchLabels("midi")} title="label notes and keys with MIDI numbers; hover shows the note name" />
      </div>
      <div className="ui-group">
        <Field label="bpm">
          <NumberBox value={clock.bpm} min={20} max={400} step={0.01} format={(value) => value.toFixed(2)} width={75} onChange={setBpm} title="project tempo: new instances start at it (each instance has its own tempo)" />
        </Field>
      </div>
      <div className="ui-group">
        <span className="ui-caption" title="instances with Q on (in the sidebar or their title bar)">{queuedCount ? `queued ${queuedCount}` : "queued"}</span>
        <Button icon="play" label="Play" tone="play" className="top-bar__play-queued" onClick={() => startQueued(startPlay)} disabled={!editor || queuedCount === 0} title="Play every instance with Q on (their clips verbatim), together" />
        <Button icon="run" label="Run" tone="run" className="top-bar__run-queued" onClick={() => startQueued(startRun)} disabled={!editor || queuedCount === 0} title="Run every instance with Q on (their runners' algorithms), together" />
        <Button
          icon="stop"
          label={activeCount ? String(activeCount) : undefined}
          className="top-bar__stop-all"
          onClick={stopAll}
          disabled={activeCount === 0}
          title={activeCount ? `stop all (${activeCount} playing or running)` : "stop all (nothing playing)"}
        />
        <Button icon="panic" quiet onClick={panicAllOutputs} title="panic: all notes off on every open output" />
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
    </div>
  );
}
