// The <six-sines-editor> widget bound to a patch held by the host. Edits come
// out as onParameters / onPreset; a patch change from outside (undo, load)
// is pushed into the widget. Adapted from music-runners' SixSinesView.
import { useEffect, useRef } from "react";
import {
  registerSixSinesEditor,
  type SixSinesEditorElement,
  type SixSinesEditorEventMap,
} from "../../../../../packages/six-sines/ui/six-sines-editor.js";
import { sixSinesAssets, type SynthPatch } from "./synth";

registerSixSinesEditor();

export function SixSinesPanel({ patch, onParameters, onPreset }: {
  patch: SynthPatch;
  onParameters: (changes: { id: number; value: number }[]) => void;
  onPreset: (preset: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const widget = useRef<SixSinesEditorElement | null>(null);
  const defaults = useRef<Uint8Array | undefined>(undefined);
  const displayedPreset = useRef<string | undefined>(undefined);
  const displayedParameters = useRef<Record<string, number>>({});
  const callbacks = useRef({ onParameters, onPreset });
  callbacks.current = { onParameters, onPreset };

  useEffect(() => {
    const element = document.createElement("six-sines-editor");
    element.presetBaseUrl = sixSinesAssets().href;
    host.current?.append(element);
    widget.current = element;
    defaults.current = element.getPreset();
    displayedPreset.current = undefined;
    displayedParameters.current = {};
    const parameters = (event: Event) => {
      const { changes } = (event as SixSinesEditorEventMap["parameters-change"]).detail;
      for (const change of changes) displayedParameters.current[change.id] = change.value;
      callbacks.current.onParameters(changes);
    };
    const preset = (event: Event) => {
      const { preset: xml } = (event as SixSinesEditorEventMap["preset-change"]).detail;
      displayedPreset.current = xml;
      displayedParameters.current = {};
      callbacks.current.onPreset(xml);
    };
    element.addEventListener("parameters-change", parameters);
    element.addEventListener("preset-change", preset);
    return () => {
      element.removeEventListener("parameters-change", parameters);
      element.removeEventListener("preset-change", preset);
      element.remove();
      widget.current = null;
    };
  }, []);

  const { preset, parameters } = patch;
  useEffect(() => {
    const element = widget.current;
    if (!element) return;
    const reload = displayedPreset.current !== preset || Object.keys(displayedParameters.current).some((key) => !(key in parameters));
    if (reload) {
      const bytes = preset ?? defaults.current;
      if (bytes) element.loadPreset(bytes);
      displayedPreset.current = preset;
      displayedParameters.current = {};
    }
    // Only what the widget is not already showing (its own edits come back
    // through the host already displayed).
    const changes = Object.entries(parameters)
      .filter(([key, value]) => displayedParameters.current[key] !== value)
      .map(([key, value]) => ({ id: Number(key), value }));
    if (changes.length) element.setParameters(changes);
    displayedParameters.current = { ...parameters };
  }, [preset, parameters]);

  return <div className="six-sines-panel" ref={host} onKeyDown={(event) => event.stopPropagation()} />;
}
