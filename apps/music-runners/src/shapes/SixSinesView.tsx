// The Six Sines shape's view: the <six-sines-editor> widget, synced with the
// shape's preset and parameters. Components only, so it Fast Refreshes; the
// shape util is in SixSinesShape.tsx.
import { useEffect, useRef, type SyntheticEvent } from "react";
import { HTMLContainer, useEditor } from "tldraw";
import type { SixSinesEditorElement, SixSinesEditorEventMap } from "../../../../packages/six-sines/ui/six-sines-editor.js";
import { sixSinesAssets, SIX_SINES_TYPE } from "../store/sixSines";
import type { SixSinesShape } from "./SixSinesShape";

export function SixSinesView({ shape }: { shape: SixSinesShape }) {
  const editor = useEditor();
  const host = useRef<HTMLDivElement>(null);
  const widget = useRef<SixSinesEditorElement | null>(null);
  const displayedPreset = useRef<string | undefined>(undefined);
  const defaults = useRef<Uint8Array | undefined>(undefined);
  const id = shape.id;

  useEffect(() => {
    const element = document.createElement("six-sines-editor");
    element.presetBaseUrl = sixSinesAssets().href;
    host.current?.append(element);
    widget.current = element;
    defaults.current = element.getPreset();
    displayedPreset.current = undefined;
    const onParameters = (event: Event) => {
      const { changes } = (event as SixSinesEditorEventMap["parameters-change"]).detail;
      const current = editor.getShape<SixSinesShape>(id);
      if (!current) return;
      const parameters = { ...current.props.parameters };
      for (const change of changes) parameters[change.id] = change.value;
      editor.updateShape<SixSinesShape>({ id, type: SIX_SINES_TYPE, props: { parameters } });
    };
    const onPreset = (event: Event) => {
      const { preset } = (event as SixSinesEditorEventMap["preset-change"]).detail;
      displayedPreset.current = preset;
      displayedParameters.current = {};
      editor.markHistoryStoppingPoint("change Six Sines preset");
      editor.updateShape<SixSinesShape>({
        id, type: SIX_SINES_TYPE, props: { preset, parameters: {} },
      });
    };
    element.addEventListener("parameters-change", onParameters);
    element.addEventListener("preset-change", onPreset);
    return () => {
      element.removeEventListener("parameters-change", onParameters);
      element.removeEventListener("preset-change", onPreset);
      element.remove();
      widget.current = null;
    };
  }, [editor, id]);

  const { preset, parameters, name, w, h } = shape.props;
  const displayedParameters = useRef<Record<string, number>>({});
  useEffect(() => {
    const element = widget.current;
    if (!element) return;
    if (displayedPreset.current !== preset || Object.keys(displayedParameters.current).some((key) => !(key in parameters))) {
      const patch = preset || defaults.current;
      if (patch) element.loadPreset(patch);
      displayedPreset.current = preset;
    }
    element.setParameters(Object.entries(parameters).map(([key, value]) => ({ id: Number(key), value })));
    displayedParameters.current = parameters;
  }, [id, preset, parameters]);

  const stop = (event: SyntheticEvent) => event.stopPropagation();
  return (
    <HTMLContainer className="six-sines-shape" style={{ width: w, height: h }}>
      <div className="six-sines-shape__header">{name}</div>
      <div className="six-sines-shape__body" ref={host}
        onPointerDown={stop} onPointerMove={stop} onPointerUp={stop}
        onPointerCancel={stop} onWheel={stop} onKeyDown={stop} />
    </HTMLContainer>
  );
}
