import { useEffect, useState } from "react";
import type { Editor } from "tldraw";
import { RUNNERS } from "../runners/registry";
import { createInstance, listInstances } from "../shapes";
import { clockStore, setBpm } from "../store/clock";
import { ensureMidi, midiStore, panicAllOutputs, refreshOutputs } from "../store/midi";
import { useSnapshot } from "valtio";
import { playbackStore, startRun, stopAll } from "../store/playback";
import { listProjects, projectStore, saveProject, switchProject } from "../store/project";

export function TopBar({ editor }: { editor: Editor | null }) {
  const clock = useSnapshot(clockStore);
  const midi = useSnapshot(midiStore);
  const project = useSnapshot(projectStore);
  const playback = useSnapshot(playbackStore);
  const [bpmDraft, setBpmDraft] = useState(String(clock.bpm));
  useEffect(() => setBpmDraft(String(clock.bpm)), [clock.bpm]);
  const activeCount = Object.values(playback.instances).filter((runtime) => runtime.mode !== "idle").length;

  const commitBpm = () => {
    const value = Number(bpmDraft);
    if (Number.isFinite(value) && value > 0) setBpm(value);
    else setBpmDraft(String(clock.bpm));
  };

  const playQueued = () => {
    if (!editor) return;
    const queued = listInstances(editor).filter((instance) => instance.props.queued);
    for (const instance of queued) startRun(instance.id);
  };

  const [newProjectName, setNewProjectName] = useState("");

  return (
    <div className="top-bar">
      <div className="top-bar__group">
        <strong>music runners</strong>
        <select
          value={project.name}
          onPointerDown={() => void listProjects()}
          onChange={(e) => {
            if (e.target.value !== project.name) switchProject(e.target.value);
          }}
        >
          {[project.name, ...project.available.filter((name) => name !== project.name)].map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="new project"
          value={newProjectName}
          onChange={(e) => setNewProjectName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && /^[a-zA-Z0-9_-]+$/.test(newProjectName)) switchProject(newProjectName);
          }}
          size={12}
        />
        <button type="button" onClick={() => void saveProject()}>
          Save
        </button>
        <span className={`top-bar__status top-bar__status--${project.status}`} title={project.error ?? undefined}>
          {project.status}
          {project.lastSavedAt ? ` ${new Date(project.lastSavedAt).toLocaleTimeString()}` : ""}
        </span>
      </div>

      <div className="top-bar__group">
        <label>
          bpm
          <input
            type="text"
            inputMode="decimal"
            value={bpmDraft}
            size={5}
            onChange={(e) => setBpmDraft(e.target.value)}
            onBlur={commitBpm}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitBpm();
            }}
          />
        </label>
        <button type="button" className="top-bar__play" onClick={playQueued} disabled={!editor}>
          ▶ play queued
        </button>
        <button type="button" onClick={stopAll} disabled={activeCount === 0}>
          ■ stop all{activeCount ? ` (${activeCount})` : ""}
        </button>
        <button type="button" onClick={panicAllOutputs} title="all notes off on every open output">
          panic
        </button>
      </div>

      <div className="top-bar__group">
        <span>midi: {midi.status}</span>
        {midi.status === "ready" ? (
          <button type="button" onClick={refreshOutputs}>
            refresh ({midi.outputs.length})
          </button>
        ) : (
          <button type="button" onClick={() => void ensureMidi()}>
            connect
          </button>
        )}
        {midi.error ? <span className="top-bar__error">{midi.error}</span> : null}
      </div>

      <div className="top-bar__group">
        <span>add</span>
        {RUNNERS.map((def) => (
          <button key={def.type} type="button" disabled={!editor} title={def.description} onClick={() => editor && createInstance(editor, def.type)}>
            + {def.label}
          </button>
        ))}
      </div>
    </div>
  );
}
