import { useCallback, useEffect, useState } from "react";
import { type Editor, Tldraw, type TLComponents } from "tldraw";

// Runner shapes have no tldraw styles; the style panel only got in the way.
const TLDRAW_COMPONENTS: TLComponents = { StylePanel: null };
import { RUNNER_SHAPE_UTILS, isRunnerShapeType } from "./shapes";
import { setEditor } from "./store/editorRef";
import { ensureMidi } from "./store/midi";
import { clearRuntime, stopAll } from "./store/playback";
import { loadProject, projectNameFromUrl, startAutosave, listProjects } from "./store/project";
import { installDebugHook } from "./debugHook";
import { BankSidebar } from "./ui/BankSidebar";
import { TopBar } from "./ui/TopBar";

export function App() {
  const [editor, setEditorState] = useState<Editor | null>(null);

  const onMount = useCallback((mounted: Editor) => {
    setEditor(mounted);
    setEditorState(mounted);
    installDebugHook(mounted);
    mounted.user.updateUserPreferences({ colorScheme: "dark" });
    const stopAutosave = { current: () => {} };
    void (async () => {
      await listProjects();
      await loadProject(mounted, projectNameFromUrl());
      stopAutosave.current = startAutosave(mounted);
    })();
    const removeDeleteHandler = mounted.sideEffects.registerAfterDeleteHandler("shape", (shape) => {
      if (isRunnerShapeType(shape.type)) clearRuntime(shape.id);
    });
    return () => {
      stopAutosave.current();
      removeDeleteHandler();
      stopAll();
      setEditor(null);
      setEditorState(null);
    };
  }, []);

  // Web MIDI opens on the first gesture so outputs are listed before anyone looks.
  useEffect(() => {
    const once = () => {
      void ensureMidi();
      window.removeEventListener("pointerdown", once);
    };
    window.addEventListener("pointerdown", once);
    return () => window.removeEventListener("pointerdown", once);
  }, []);

  return (
    <div className="app-root">
      <TopBar editor={editor} />
      <div className="app-body">
        <BankSidebar editor={editor} />
        <div className="app-canvas">
          <Tldraw shapeUtils={RUNNER_SHAPE_UTILS} onMount={onMount} components={TLDRAW_COMPONENTS} />
        </div>
      </div>
    </div>
  );
}
