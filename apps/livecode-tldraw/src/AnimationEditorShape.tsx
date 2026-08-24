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
import "@avtools/animation-editor";
import type {
  AnimationTimelineData,
  AnimationTimelineEntity,
} from "@avtools/livecode-protocol";
import type { AnimationEditorComponentElement } from "./custom-elements";
import { ANIMATION_TIMELINE_ENTITY_TYPE } from "./serverRequests";
import { signalPlayheadMarkers } from "./signalPlayheadMarkers";
import { useAnimationTimelinesSync, useSignalsSync } from "./syncRuntime";

export const ANIMATION_EDITOR_SHAPE_TYPE = "animation-editor-view";
export { ANIMATION_TIMELINE_ENTITY_TYPE };
const DEFAULT_WIDTH = 720;
const DEFAULT_HEIGHT = 440;

declare module "tldraw" {
  export interface TLGlobalShapePropsMap {
    [ANIMATION_EDITOR_SHAPE_TYPE]: {
      w: number;
      h: number;
      animationName: string;
      title: string;
      interactive: boolean;
    };
  }
}

export type AnimationEditorShape = TLShape<typeof ANIMATION_EDITOR_SHAPE_TYPE>;

export class AnimationEditorShapeUtil
  extends BaseBoxShapeUtil<AnimationEditorShape> {
  static override type = ANIMATION_EDITOR_SHAPE_TYPE;
  static override props: RecordProps<AnimationEditorShape> = {
    w: T.number,
    h: T.number,
    animationName: T.string,
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

  override getDefaultProps(): AnimationEditorShape["props"] {
    return {
      w: DEFAULT_WIDTH,
      h: DEFAULT_HEIGHT,
      animationName: "animation",
      title: "animation: animation",
      interactive: true,
    };
  }

  override component(shape: AnimationEditorShape) {
    return <AnimationEditorShapeComponent shape={shape} />;
  }

  override getIndicatorPath(shape: AnimationEditorShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}

export function createAnimationEditorShape(
  editor: Editor,
  options:
    & Partial<AnimationEditorShape["props"]>
    & { x?: number; y?: number; id?: AnimationEditorShape["id"] } = {},
) {
  const id = options.id ?? createShapeId();
  const animationName = options.animationName ?? "animation";
  const w = options.w ?? DEFAULT_WIDTH;
  const h = options.h ?? DEFAULT_HEIGHT;
  const center = editor.getViewportPageBounds().center;
  editor.createShape<AnimationEditorShape>({
    id,
    type: ANIMATION_EDITOR_SHAPE_TYPE,
    x: options.x ?? center.x - w / 2,
    y: options.y ?? center.y - h / 2,
    props: {
      w,
      h,
      animationName,
      title: options.title ?? `animation: ${animationName}`,
      interactive: options.interactive ?? true,
    },
  });
  editor.select(id);
  return id;
}

function AnimationEditorShapeComponent({
  shape,
}: {
  shape: AnimationEditorShape;
}) {
  const runtime = useAnimationTimelinesSync();
  const signalsRuntime = useSignalsSync();
  const timeline = runtime.timelines[shape.props.animationName];
  const hasTimeline = timeline !== undefined;
  const setTimeline = runtime.setTimeline;
  const elementRef = useRef<AnimationEditorComponentElement | null>(null);
  const latestEntityRef = useRef<AnimationTimelineEntity | null>(
    timeline ?? null,
  );
  const writeQueueRef = useRef(Promise.resolve());
  const lastMarkerKeyRef = useRef<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const originId = useMemo(() => `animation-editor-view-${shape.id}`, [
    shape.id,
  ]);
  const markers = useMemo(
    () =>
      signalsRuntime.connectionStatus === "open"
        ? signalPlayheadMarkers(
          signalsRuntime.signals,
          ANIMATION_TIMELINE_ENTITY_TYPE,
          shape.props.animationName,
        )
        : [],
    [
      signalsRuntime.connectionStatus,
      signalsRuntime.signals,
      shape.props.animationName,
    ],
  );

  useEffect(() => {
    latestEntityRef.current = timeline ?? null;
    if (timeline) elementRef.current?.setTimeline?.(timeline.data);
  }, [timeline]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const key = JSON.stringify(markers);
    if (lastMarkerKeyRef.current === key) return;
    lastMarkerKeyRef.current = key;
    element.setPlayheadMarkers?.(markers);
  }, [markers, timeline]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.interactive = shape.props.interactive;
  }, [shape.props.interactive, timeline]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const onTimelineChange = (event: Event) => {
      const data = (event as CustomEvent<[AnimationTimelineData]>).detail?.[0];
      if (!data || !shape.props.interactive) return;
      const baseRev = latestEntityRef.current?.rev;
      writeQueueRef.current = writeQueueRef.current.then(async () => {
        const current = latestEntityRef.current;
        if (!current || baseRev === undefined) return;
        try {
          const expectedRev = current.updatedBy === originId
            ? current.rev
            : baseRev;
          const result = await setTimeline(shape.props.animationName, data, {
            originId,
            expectedRev,
          });
          if (result.ok) {
            latestEntityRef.current = result.timeline;
            element.setTimeline?.(result.timeline.data);
            setWriteError(null);
          } else {
            latestEntityRef.current = result.current ?? current;
            element.setTimeline?.((result.current ?? current).data);
            setWriteError(result.error);
          }
        } catch (error) {
          element.setTimeline?.(latestEntityRef.current?.data ?? current.data);
          setWriteError(error instanceof Error ? error.message : String(error));
        }
      });
    };

    element.addEventListener("timeline-change", onTimelineChange);
    return () =>
      element.removeEventListener("timeline-change", onTimelineChange);
  }, [
    hasTimeline,
    originId,
    setTimeline,
    shape.props.animationName,
    shape.props.interactive,
  ]);

  const stopCanvasEvent = (event: SyntheticEvent) => event.stopPropagation();

  return (
    <HTMLContainer
      className="animation-editor-shape"
      style={{ width: shape.props.w, height: shape.props.h }}
    >
      <div className="animation-editor-shape__header">
        <div>
          <strong>{shape.props.title}</strong>
          <span>
            {runtime.connectionStatus} | rev {timeline?.rev ?? "-"} | snapshot
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
        className="animation-editor-shape__body"
        onPointerDown={stopCanvasEvent}
        onPointerMove={stopCanvasEvent}
        onPointerUp={stopCanvasEvent}
        onPointerCancel={stopCanvasEvent}
        onTouchStart={stopCanvasEvent}
        onKeyDownCapture={stopCanvasEvent}
        onWheel={stopCanvasEvent}
      >
        {timeline
          ? (
            <animation-editor-component
              ref={elementRef}
              data-animation-name={shape.props.animationName}
              style={{ width: "100%", height: "100%", display: "block" }}
            />
          )
          : (
            <div className="animation-editor-shape__empty">
              Waiting for <code>{shape.props.animationName}</code>{" "}
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
