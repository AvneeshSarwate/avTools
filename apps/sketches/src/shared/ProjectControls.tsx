// Project chooser and save/load, as in music-runners' top bar. With the dev
// server: a project chooser, a new-project field, save now, Export, Import.
// On a static host: Save and Load (JSON files), and the unsaved mark.
import { useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { Button, Chooser, Lamp, TextField } from "./controls/controls";
import { listProjects, projectStore, switchProject } from "./project";

export function ProjectControls({ project }: {
  project: { saveNow(): Promise<void>; saveToFile(): void; loadFromFile(file: File): Promise<void> };
}) {
  const state = useSnapshot(projectStore);
  const [newName, setNewName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const manual = state.backend === "manual";
  const savedAt = state.lastSavedAt ? new Date(state.lastSavedAt).toLocaleTimeString() : "";
  const statusText = state.status === "saved" && savedAt ? `saved ${savedAt}`
    : manual && state.status === "dirty" ? "unsaved"
    : manual && state.status === "idle" ? "not saved"
    : state.status;
  const tone = state.status === "error" ? "rec" : state.status === "dirty" ? "warn" : state.status === "saving" ? "select" : "off";
  const options = [state.name, ...state.available.filter((name) => name !== state.name)].map((name) => ({ value: name, label: name }));

  return (
    <div className="project-controls">
      {manual ? null : (
        <>
          <Chooser value={state.name} options={options} onOpen={() => void listProjects()} onChange={switchProject}
            title="project (projects/<name>/project.json)" width={130} />
          <TextField value={newName} onChange={setNewName} onCommit={() => switchProject(newName)}
            placeholder="new project…" title="type a name and press Enter to create or open it" width={100} />
          <Button icon="save" quiet onClick={() => void project.saveNow()} title="save now (autosave runs a second after any change)" />
        </>
      )}
      <Button icon={manual ? "save" : undefined} label={manual ? "Save" : "Export"} onClick={project.saveToFile}
        title={manual ? "save the project to a JSON file (nothing is saved automatically here)" : "download the project as a JSON file"} />
      <Button label={manual ? "Load" : "Import"} onClick={() => fileInput.current?.click()}
        title={manual ? "load a project from a JSON file, replacing what is open" : "replace this project's contents with a JSON file"} />
      <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void project.loadFromFile(file);
      }} />
      <span className="project-controls__status" title={state.error ?? (savedAt ? `last saved ${savedAt}` : undefined)}>
        <Lamp tone={tone} />
        {statusText}
      </span>
    </div>
  );
}
