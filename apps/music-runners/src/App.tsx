import { useCallback, useEffect, useState } from "react";
import { type Editor, Tldraw, type TLComponents } from "tldraw";

// Runner shapes have no tldraw styles; the style panel only got in the way.
const TLDRAW_COMPONENTS: TLComponents = { StylePanel: null, OnTheCanvas: ConnectionLayer };
import { RUNNER_SHAPE_UTILS, isRunnerShapeType, listInstances } from "./shapes";
import { getEditor, setEditor } from "./store/editorRef";
import { ensureMidi, getOutput } from "./store/midi";
import { clearRuntime, stopAll } from "./store/playback";
import { loadProject, projectNameFromUrl, startAutosave, listProjects } from "./store/project";
import { installDebugHook } from "./debugHook";
import { RunnerSidebar } from "./ui/RunnerSidebar";
import { TopBar } from "./ui/TopBar";
import { ConnectionLayer } from "./ui/ConnectionLayer";
import { installConnectionRules } from "./store/connections";
import { SixSinesShapeUtil } from "./shapes/SixSinesShape";
import { installSixSines, isSixSinesOutput } from "./store/sixSines";
import { installClipCopyRules } from "./shapes/clipOnCopy";

const SHAPE_UTILS = [...RUNNER_SHAPE_UTILS, SixSinesShapeUtil];
// tldraw needs a licence key on a deployed site (not on localhost). Set
// VITE_TLDRAW_LICENSE_KEY in .env.local; the key is tied to the site's domain.
const TLDRAW_LICENSE_KEY = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_TLDRAW_LICENSE_KEY;

export function App() {
  const [editor, setEditorState] = useState<Editor | null>(null);

  const onMount = useCallback((mounted: Editor) => {
    setEditor(mounted);
    setEditorState(mounted);
    installDebugHook(mounted);
    const removeSynths = installSixSines(mounted);
    mounted.user.updateUserPreferences({ colorScheme: "dark" });
    const stopAutosave = { current: () => {} };
    void (async () => {
      await listProjects();
      await loadProject(mounted, projectNameFromUrl());
      stopAutosave.current = startAutosave(mounted);
    })();
    const removeConnectionRules = installConnectionRules(mounted);
    const removeClipCopy = installClipCopyRules(mounted);
    const removeDeleteHandler = mounted.sideEffects.registerAfterDeleteHandler("shape", (shape) => {
      if (isRunnerShapeType(shape.type)) clearRuntime(shape.id);
    });
    return () => {
      removeConnectionRules();
      removeClipCopy();
      stopAutosave.current();
      removeDeleteHandler();
      stopAll();
      removeSynths();
      setEditor(null);
      setEditorState(null);
    };
  }, []);

  // Web MIDI opens on the first gesture so outputs are listed before anyone looks.
  useEffect(() => {
    const once = () => {
      void ensureMidi();
      const mounted = getEditor();
      if (mounted) {
        for (const { props } of listInstances(mounted)) {
          if (isSixSinesOutput(props.midiOutputName)) void getOutput(props.midiOutputName);
        }
      }
      window.removeEventListener("pointerdown", once);
    };
    window.addEventListener("pointerdown", once);
    return () => window.removeEventListener("pointerdown", once);
  }, []);

  return (
    <div className="app-root">
      <TopBar editor={editor} />
      <div className="app-body">
        <RunnerSidebar editor={editor} />
        <div className="app-canvas">
          <Tldraw shapeUtils={SHAPE_UTILS} onMount={onMount} components={TLDRAW_COMPONENTS} licenseKey={TLDRAW_LICENSE_KEY} />
        </div>
      </div>
    </div>
  );
}
