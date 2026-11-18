import { useEffect, useRef, type SyntheticEvent } from "react";
import { BaseBoxShapeUtil, createShapeId, HTMLContainer, T, useEditor, type Editor, type TLShape } from "tldraw";
import { registerSixSinesEditor, type SixSinesEditorElement, type SixSinesEditorEventMap } from "../../../../packages/six-sines/ui/six-sines-editor.js";
import { listSixSines, sixSinesAssets, SIX_SINES_TYPE } from "../store/sixSines";

import { instrumentPosition } from "./index";

registerSixSinesEditor();

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [SIX_SINES_TYPE]: { w: number; h: number; name: string; preset: string; parameters: Record<string, number> };
  }
}

export type SixSinesShape = TLShape<typeof SIX_SINES_TYPE>;

const WIDTH = 1260;
const HEIGHT = 1140;

export function createSixSinesShape(editor: Editor) {
  const id = createShapeId();
  const names = new Set(listSixSines(editor).map((shape) => shape.props.name));
  let index = 1;
  while (names.has(`Six Sines ${index}`)) index++;
  editor.markHistoryStoppingPoint("create Six Sines");
  editor.createShape<SixSinesShape>({
    id,
    type: SIX_SINES_TYPE,
    ...instrumentPosition(editor, WIDTH, HEIGHT),
    props: { name: `Six Sines ${index}` },
  });
  return id;
}

export class SixSinesShapeUtil extends BaseBoxShapeUtil<SixSinesShape> {
  static override type = SIX_SINES_TYPE;
  static override props = {
    w: T.number,
    h: T.number,
    name: T.string,
    preset: T.string,
    parameters: T.dict(T.string, T.number),
  };

  override getDefaultProps() {
    return { w: WIDTH, h: HEIGHT, name: "Six Sines", preset: "", parameters: {} };
  }

  override canScroll() {
    return true;
  }

  override component(shape: SixSinesShape) {
    return <SixSinesView shape={shape} />;
  }

  override getIndicatorPath(shape: SixSinesShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}

function SixSinesView({ shape }: { shape: SixSinesShape }) {
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
