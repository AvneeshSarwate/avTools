import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import {
  BaseBoxShapeUtil,
  createShapeId,
  HTMLContainer,
  T,
  type Editor,
  type RecordProps,
  type TLShape,
} from "tldraw";
import { registerSixSinesEditor } from "../../../packages/six-sines/ui/six-sines-editor.js";
registerSixSinesEditor();
import type { SixSinesEditorElement } from "../../../packages/six-sines/ui/six-sines-editor.js";
import type { SixSinesData } from "@avtools/livecode-protocol";
import { useSixSinesSync } from "./syncRuntime";

export const SIX_SINES_SHAPE_TYPE = "six-sines-view";
export const SIX_SINES_ENTITY_TYPE = "sixSines";
declare module "tldraw" {
  export interface TLGlobalShapePropsMap {
    [SIX_SINES_SHAPE_TYPE]: {
      w: number;
      h: number;
      synthName: string;
      title: string;
    };
  }
}
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "six-sines-editor": React.DetailedHTMLProps<
        React.HTMLAttributes<SixSinesEditorElement>,
        SixSinesEditorElement
      >;
    }
  }
}
export type SixSinesShape = TLShape<typeof SIX_SINES_SHAPE_TYPE>;
export class SixSinesShapeUtil extends BaseBoxShapeUtil<SixSinesShape> {
  static override type = SIX_SINES_SHAPE_TYPE;
  static override props: RecordProps<SixSinesShape> = {
    w: T.number,
    h: T.number,
    synthName: T.string,
    title: T.string,
  };
  override canScroll() {
    return true;
  }
  override canEdit() {
    return true;
  }
  override canResize() {
    return true;
  }
  override getDefaultProps() {
    return { w: 1260, h: 1140, synthName: "lead", title: "Six Sines: lead" };
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
export function createSixSinesShape(
  editor: Editor,
  options: Partial<SixSinesShape["props"]> & {
    x?: number;
    y?: number;
    id?: SixSinesShape["id"];
  } = {},
) {
  const id = options.id ?? createShapeId();
  const synthName = options.synthName ?? "lead";
  const w = options.w ?? 1260,
    h = options.h ?? 1140;
  const center = editor.getViewportPageBounds().center;
  editor.createShape<SixSinesShape>({
    id,
    type: SIX_SINES_SHAPE_TYPE,
    x: options.x ?? center.x - w / 2,
    y: options.y ?? center.y - h / 2,
    props: {
      w,
      h,
      synthName,
      title: options.title ?? `Six Sines: ${synthName}`,
    },
  });
  editor.select(id);
  return id;
}
function SixSinesView({ shape }: { shape: SixSinesShape }) {
  const runtime = useSixSinesSync();
  const entity = runtime.synths[shape.props.synthName];
  const elementRef = useRef<SixSinesEditorElement | null>(null);
  const applied = useRef<SixSinesData | null>(null);
  const latest = useRef(entity);
  latest.current = entity;
  const lane = useRef<Promise<unknown>>(Promise.resolve());
  const [error, setError] = useState<string | null>(null);
  const originId = useMemo(() => `six-sines-view-${shape.id}`, [shape.id]);
  const { setSixSinesParameters, setSixSinesPreset } = runtime;
  const exists = Boolean(entity);

  function applyTruth(data: SixSinesData, force = false) {
    const el = elementRef.current;
    if (!el) return;
    const prior = applied.current;
    const reload =
      force ||
      !prior ||
      prior.preset !== data.preset ||
      Object.keys(prior.values).some((id) => !(id in data.values));
    if (reload) el.loadPreset(data.preset);
    const changes = Object.entries(data.values)
      .filter(([id, value]) => reload || prior?.values[id] !== value)
      .map(([id, value]) => ({ id: Number(id), value }));
    if (changes.length) el.setParameters(changes);
    applied.current = data;
  }
  useEffect(() => {
    applied.current = null;
  }, [shape.props.synthName, exists]);
  useEffect(() => {
    if (entity) applyTruth(entity.data);
  }, [entity]);
  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    el.presetBaseUrl = new URL("./six-sines-ui/", document.baseURI).href;
    const enqueue = (write: () => Promise<unknown>) => {
      lane.current = lane.current
        .catch(() => {})
        .then(write)
        .then(
          () => setError(null),
          (reason: unknown) => {
            setError(reason instanceof Error ? reason.message : String(reason));
            if (latest.current) applyTruth(latest.current.data, true);
          },
        );
    };
    const parameters = (event: Event) => {
      const { changes } = (
        event as CustomEvent<{ changes: Array<{ id: number; value: number }> }>
      ).detail;
      enqueue(() =>
        setSixSinesParameters(shape.props.synthName, changes, { originId }),
      );
    };
    const preset = (event: Event) => {
      const data = (event as CustomEvent<SixSinesData>).detail;
      enqueue(() =>
        setSixSinesPreset(shape.props.synthName, data, { originId }),
      );
    };
    el.addEventListener("parameters-change", parameters);
    el.addEventListener("preset-change", preset);
    return () => {
      el.removeEventListener("parameters-change", parameters);
      el.removeEventListener("preset-change", preset);
    };
  }, [
    exists,
    originId,
    shape.props.synthName,
    setSixSinesParameters,
    setSixSinesPreset,
  ]);
  const stopCanvasEvent = (event: SyntheticEvent) => event.stopPropagation();
  return (
    <HTMLContainer
      className="six-sines-shape"
      style={{ width: shape.props.w, height: shape.props.h }}
    >
      <div className="six-sines-shape__header">
        <strong>{shape.props.title}</strong>
        <span>
          {runtime.connectionStatus} · rev {entity?.rev ?? "–"}
        </span>
        {error && (
          <span className="entity-error-badge" title={error}>
            write rejected
          </span>
        )}
      </div>
      <div
        className="six-sines-shape__body"
        onPointerDown={stopCanvasEvent}
        onPointerMove={stopCanvasEvent}
        onPointerUp={stopCanvasEvent}
        onPointerCancel={stopCanvasEvent}
        onWheel={stopCanvasEvent}
        onKeyDown={stopCanvasEvent}
        onTouchStart={stopCanvasEvent}
      >
        {entity ? (
          <six-sines-editor
            ref={elementRef}
            data-synth-name={shape.props.synthName}
          />
        ) : (
          <p>
            Waiting for synth <code>{shape.props.synthName}</code>…{" "}
            {runtime.connectionError}
          </p>
        )}
      </div>
    </HTMLContainer>
  );
}
