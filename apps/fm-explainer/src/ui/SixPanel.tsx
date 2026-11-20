import { useEffect, useRef, useState } from "react";
import type { SixSinesEditorElement, SixSinesEditorEventMap } from "../../../../packages/six-sines/ui/six-sines-editor.js";
import { sixSines, sixSinesAssetBase } from "../audio/engine";

// The editor is laid out for this size; the panel scales it to the page width.
const EDITOR_WIDTH = 1180;
const EDITOR_HEIGHT = 1040;
// One editor element for the whole page. It is large to build, so it is
// created on first use and moved between benches instead of being rebuilt.
let editor: Promise<SixSinesEditorElement> | undefined;

function loadEditor() {
  editor ??= import("../../../../packages/six-sines/ui/six-sines-editor.js").then(({ registerSixSinesEditor }) => {
    registerSixSinesEditor();
    const element = document.createElement("six-sines-editor");
    element.presetBaseUrl = sixSinesAssetBase();
    // What is done in the editor goes to the engine, and stays until the step changes.
    element.addEventListener("parameters-change", (event: SixSinesEditorEventMap["parameters-change"]) => {
      sixSines.editorChanged(event.detail.changes);
    });
    element.addEventListener("preset-change", (event: SixSinesEditorEventMap["preset-change"]) => {
      sixSines.editorLoadedPreset(event.detail.preset);
    });
    return element;
  });
  return editor;
}

/**
 * The Six Sines editor, showing whatever the engine currently holds. It takes
 * the place of the diagram and sliders while Six Sines is selected.
 */
export function SixPanel() {
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setZoom(Math.min(1, entry.contentRect.width / EDITOR_WIDTH)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let element: SixSinesEditorElement | undefined;
    let unsubscribe = () => {};
    let disposed = false;
    loadEditor().then(
      (loaded) => {
        if (disposed) return;
        element = loaded;
        host.current?.append(element);
        // Catch up with the engine, then follow it.
        const { text, params } = sixSines.snapshot();
        if (text) element.loadPreset(text);
        element.setParameters(params);
        unsubscribe = sixSines.subscribe((event) => {
          if (event.kind === "preset") loaded.loadPreset(event.text);
          else loaded.setParameters(event.changes);
        });
        setStatus("ready");
      },
      () => !disposed && setStatus("error"),
    );
    return () => {
      disposed = true;
      unsubscribe();
      element?.remove();
    };
  }, []);

  return (
    <div className="six-panel">
      <div className="six-panel-frame" ref={frame} style={{ height: EDITOR_HEIGHT * zoom }}>
        {status === "loading" && <span className="loading">loading editor…</span>}
        {status === "error" && <span className="loading">The editor could not be loaded.</span>}
        <div ref={host} style={{ width: EDITOR_WIDTH, height: EDITOR_HEIGHT, zoom }} />
      </div>
      <p className="six-panel-note">
        The editor shows the patch you are hearing. Anything you change in it is heard straight away and is undone when
        you leave this step.
      </p>
    </div>
  );
}
