import {
  BaseBoxShapeUtil,
  createShapeId,
  type Editor,
  HTMLContainer,
  RecordProps,
  T,
  type TLShape,
} from "tldraw";
import {
  type SyntheticEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "@avtools/handwriting-canvas";
import type {
  DrawingDocument,
  DrawingEntity,
} from "@avtools/livecode-protocol";
import type { HandwritingCanvasElement } from "./custom-elements";
import {
  type AppliedDrawingView,
  decideDrawingHydration,
  drawingDocumentJson,
} from "./drawingViewHydration";
import { DRAWING_ENTITY_TYPE } from "./serverRequests";
import { useDrawingsSync } from "./syncRuntime";

export const DRAWING_SHAPE_TYPE = "drawing-view";
export { DRAWING_ENTITY_TYPE };
const DEFAULT_WIDTH = 760;
const DEFAULT_HEIGHT = 600;
// The header row plus the component's own toolbar and padding, subtracted so
// the Konva stage fits the shape without the body scrolling.
const HEADER_HEIGHT = 48;
const COMPONENT_CHROME_HEIGHT = 96;
const COMPONENT_CHROME_WIDTH = 24;

declare module "tldraw" {
  export interface TLGlobalShapePropsMap {
    [DRAWING_SHAPE_TYPE]: {
      w: number;
      h: number;
      drawingName: string;
      title: string;
      interactive: boolean;
    };
  }
}

export type DrawingShape = TLShape<typeof DRAWING_SHAPE_TYPE>;

export class DrawingShapeUtil extends BaseBoxShapeUtil<DrawingShape> {
  static override type = DRAWING_SHAPE_TYPE;
  static override props: RecordProps<DrawingShape> = {
    w: T.number,
    h: T.number,
    drawingName: T.string,
    title: T.string,
    interactive: T.boolean,
  };

  override canScroll(): boolean {
    return true;
  }

  override canEdit(): boolean {
    return true;
  }

  override canResize(): boolean {
    return true;
  }

  override getDefaultProps(): DrawingShape["props"] {
    return {
      w: DEFAULT_WIDTH,
      h: DEFAULT_HEIGHT,
      drawingName: "drawing",
      title: "drawing: drawing",
      interactive: true,
    };
  }

  override component(shape: DrawingShape) {
    return <DrawingShapeComponent shape={shape} />;
  }

  override getIndicatorPath(shape: DrawingShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}

export function createDrawingShape(
  editor: Editor,
  options:
    & Partial<DrawingShape["props"]>
    & { x?: number; y?: number; id?: DrawingShape["id"] } = {},
) {
  const id = options.id ?? createShapeId();
  const drawingName = options.drawingName ?? "drawing";
  const w = options.w ?? DEFAULT_WIDTH;
  const h = options.h ?? DEFAULT_HEIGHT;
  const center = editor.getViewportPageBounds().center;
  editor.createShape<DrawingShape>({
    id,
    type: DRAWING_SHAPE_TYPE,
    x: options.x ?? center.x - w / 2,
    y: options.y ?? center.y - h / 2,
    props: {
      w,
      h,
      drawingName,
      title: options.title ?? `drawing: ${drawingName}`,
      interactive: options.interactive ?? true,
    },
  });
  editor.select(id);
  return id;
}

/**
 * One view of a drawing entity. The element is hydrated from accepted engine
 * truth and its edits are written back whole with compare-and-set, like the
 * animation editor. Two guards keep the loop honest: the element suppresses
 * its own `document-update` while hydrating (so a pushed document never echoes
 * as an edit), and this component ignores its own writes when they return
 * through sync (so an in-progress edit is not rebuilt underneath the user).
 */
function DrawingShapeComponent({ shape }: { shape: DrawingShape }) {
  const runtime = useDrawingsSync(shape.props.drawingName);
  const entity = runtime.drawings[shape.props.drawingName];
  const hasEntity = entity !== undefined;
  const setDrawing = runtime.setDrawing;
  const elementRef = useRef<HandwritingCanvasElement | null>(null);
  const bindingRef = useRef<
    {
      drawingName: string;
      element: HandwritingCanvasElement;
      latestEntity: DrawingEntity;
    } | null
  >(null);
  // The accepted document currently shown by this particular element. A new
  // element or drawing binding must hydrate even when its rev happens to match
  // the previous one.
  const appliedRef = useRef<AppliedDrawingView | null>(null);
  const lastSentJsonRef = useRef<string | null>(null);
  const writeQueueRef = useRef(Promise.resolve());
  const [writeError, setWriteError] = useState<string | null>(null);
  const originId = useMemo(() => `drawing-view-${shape.id}`, [shape.id]);

  useEffect(() => {
    const element = elementRef.current;
    if (!entity || !element) {
      bindingRef.current = null;
      appliedRef.current = null;
      return;
    }
    let binding = bindingRef.current;
    if (
      !binding || binding.drawingName !== shape.props.drawingName ||
      binding.element !== element
    ) {
      binding = {
        drawingName: shape.props.drawingName,
        element,
        latestEntity: entity,
      };
      bindingRef.current = binding;
    } else {
      binding.latestEntity = entity;
    }
    const decision = decideDrawingHydration(
      appliedRef.current,
      shape.props.drawingName,
      element,
      entity,
      originId,
    );
    if (decision.kind === "ignore") return;
    if (decision.kind === "accept") {
      appliedRef.current = decision.applied;
      lastSentJsonRef.current = decision.applied.documentJson;
      return;
    }
    try {
      element.setDrawingDocument?.(entity.data);
      appliedRef.current = decision.applied;
      lastSentJsonRef.current = decision.applied.documentJson;
      setWriteError(null);
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : String(error));
    }
  }, [entity, originId, shape.props.drawingName]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.width = Math.max(240, shape.props.w - COMPONENT_CHROME_WIDTH);
    element.height = Math.max(
      160,
      shape.props.h - HEADER_HEIGHT - COMPONENT_CHROME_HEIGHT,
    );
  }, [shape.props.w, shape.props.h, hasEntity]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const onDocumentUpdate = (event: Event) => {
      const data = (event as CustomEvent<[DrawingDocument]>).detail?.[0];
      if (!data || !shape.props.interactive) return;
      const binding = bindingRef.current;
      if (!binding || binding.element !== element) return;
      const json = drawingDocumentJson(data);
      if (json === lastSentJsonRef.current) return;
      lastSentJsonRef.current = json;
      const baseRev = binding.latestEntity.rev;
      writeQueueRef.current = writeQueueRef.current.then(async () => {
        const current = binding.latestEntity;
        try {
          const expectedRev = current.updatedBy === originId
            ? current.rev
            : baseRev;
          const result = await setDrawing(shape.props.drawingName, data, {
            originId,
            expectedRev,
          });
          if (result.ok) {
            binding.latestEntity = result.drawing;
            if (bindingRef.current === binding) {
              appliedRef.current = {
                drawingName: binding.drawingName,
                element,
                rev: result.drawing.rev,
                documentJson: drawingDocumentJson(result.drawing.data),
              };
              setWriteError(null);
            }
          } else {
            const truth = result.current ?? current;
            binding.latestEntity = truth;
            if (bindingRef.current === binding) {
              element.setDrawingDocument?.(truth.data);
              const documentJson = drawingDocumentJson(truth.data);
              appliedRef.current = {
                drawingName: binding.drawingName,
                element,
                rev: truth.rev,
                documentJson,
              };
              lastSentJsonRef.current = documentJson;
              setWriteError(result.error);
            }
          }
        } catch (error) {
          const truth = binding.latestEntity;
          if (bindingRef.current === binding) {
            element.setDrawingDocument?.(truth.data);
            const documentJson = drawingDocumentJson(truth.data);
            appliedRef.current = {
              drawingName: binding.drawingName,
              element,
              rev: truth.rev,
              documentJson,
            };
            lastSentJsonRef.current = documentJson;
            setWriteError(
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      });
    };

    element.addEventListener("document-update", onDocumentUpdate);
    return () =>
      element.removeEventListener("document-update", onDocumentUpdate);
  }, [
    hasEntity,
    originId,
    setDrawing,
    shape.props.drawingName,
    shape.props.interactive,
  ]);

  const stopCanvasEvent = (event: SyntheticEvent) => event.stopPropagation();

  return (
    <HTMLContainer
      className="drawing-shape"
      style={{ width: shape.props.w, height: shape.props.h }}
    >
      <div className="drawing-shape__header">
        <div>
          <strong>{shape.props.title}</strong>
          <span>
            {runtime.connectionStatus} | rev {entity?.rev ?? "-"} | snapshot
            {" "}
            {runtime.latestSeq ?? "-"}
          </span>
        </div>
        {writeError
          ? (
            <span className="entity-error-badge" title={writeError}>
              write rejected
            </span>
          )
          : null}
      </div>
      <div
        className="drawing-shape__body"
        onPointerDown={stopCanvasEvent}
        onPointerMove={stopCanvasEvent}
        onPointerUp={stopCanvasEvent}
        onPointerCancel={stopCanvasEvent}
        onTouchStart={stopCanvasEvent}
        onKeyDownCapture={stopCanvasEvent}
        onWheel={stopCanvasEvent}
      >
        {entity
          ? (
            <handwriting-canvas
              ref={elementRef}
              data-drawing-name={shape.props.drawingName}
            />
          )
          : (
            <div className="drawing-shape__empty">
              Waiting for <code>{shape.props.drawingName}</code>{" "}
              from the server...
              {runtime.connectionError
                ? <span>{runtime.connectionError}</span>
                : null}
            </div>
          )}
      </div>
    </HTMLContainer>
  );
}
