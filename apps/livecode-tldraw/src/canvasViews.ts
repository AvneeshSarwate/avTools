import type {
  DurableEntityRef,
  ProjectCanvasState,
  ProjectSaveResponse,
} from "@avtools/livecode-protocol";
import type { Editor } from "tldraw";
import {
  ANIMATION_EDITOR_SHAPE_TYPE,
  ANIMATION_TIMELINE_ENTITY_TYPE,
  type AnimationEditorShape,
  AnimationEditorShapeUtil,
  createAnimationEditorShape,
} from "./AnimationEditorShape";
import {
  createDrawingShape,
  DRAWING_ENTITY_TYPE,
  DRAWING_SHAPE_TYPE,
  type DrawingShape,
  DrawingShapeUtil,
} from "./DrawingShape";
import {
  createParamPaneShape,
  PARAM_PANE_SHAPE_TYPE,
  type ParamPaneShape,
  ParamPaneShapeUtil,
} from "./ParamPaneShape";
import {
  createPianoRollShape,
  PIANO_ROLL_SHAPE_TYPE,
  type PianoRollShape,
  PianoRollShapeUtil,
} from "./PianoRollShape";
import {
  CANVAS_SURFACE_SHAPE_TYPE,
  type CanvasSurfaceShape,
  CanvasSurfaceShapeUtil,
  createCanvasSurfaceShape,
} from "./CanvasSurfaceShape";
import {
  createSignalScopeShape,
  describeScopeSource,
  SIGNAL_SCOPE_SHAPE_TYPE,
  type SignalScopeShape,
  SignalScopeShapeUtil,
} from "./SignalScopeShape";
import {
  PARAMS_ENTITY_TYPE,
  PIANO_ROLL_ENTITY_TYPE,
  postServerJson,
  saveProject,
} from "./serverRequests";
import {
  type CanvasViewDispatchCodec,
  collectViewsFromCodecs,
  isRegisteredCanvasView,
  registeredCanvasViewChanged,
  registeredEntityRef,
} from "./canvasViewRegistry";

interface CanvasViewCodec extends CanvasViewDispatchCodec {
  shapeUtil:
    | typeof PianoRollShapeUtil
    | typeof ParamPaneShapeUtil
    | typeof AnimationEditorShapeUtil
    | typeof DrawingShapeUtil
    | typeof SignalScopeShapeUtil
    | typeof CanvasSurfaceShapeUtil;
  restore(editor: Editor, canvas: ProjectCanvasState): void;
  entityType?: string;
  createEntityView?(
    editor: Editor,
    name: string,
    position?: { x: number; y: number },
  ): string;
}

export const CANVAS_VIEW_CODECS: readonly CanvasViewCodec[] = [
  {
    shapeUtil: PianoRollShapeUtil,
    isShape: isPianoRollShape,
    entityType: PIANO_ROLL_ENTITY_TYPE,
    entityRef: (shape) => ({
      type: PIANO_ROLL_ENTITY_TYPE,
      name: (shape as PianoRollShape).props.rollName,
    }),
    createEntityView: (editor, name, position) =>
      String(createPianoRollShape(editor, { ...position, rollName: name })),
    collect: (shapes) => ({
      pianoRollViews: shapes.filter(isPianoRollShape).map((shape) => ({
        id: shape.id,
        rollName: shape.props.rollName,
        x: shape.x,
        y: shape.y,
        w: shape.props.w,
        h: shape.props.h,
      })),
    }),
    restore(editor, canvas) {
      for (const view of canvas.pianoRollViews ?? []) {
        const id = view.id as PianoRollShape["id"];
        if (editor.getShape(id)) continue;
        createPianoRollShape(editor, {
          id,
          x: view.x,
          y: view.y,
          w: view.w,
          h: view.h,
          rollName: view.rollName,
          title: `piano roll: ${view.rollName}`,
        });
      }
    },
    hasChanged: (before, after) => {
      const a = before as PianoRollShape;
      const b = after as PianoRollShape;
      return hasBoxChanged(a, b) || a.props.rollName !== b.props.rollName;
    },
  },
  {
    shapeUtil: ParamPaneShapeUtil,
    isShape: isParamPaneShape,
    entityType: PARAMS_ENTITY_TYPE,
    entityRef: (shape) => ({
      type: PARAMS_ENTITY_TYPE,
      name: (shape as ParamPaneShape).props.paramsName,
    }),
    createEntityView: (editor, name, position) =>
      String(createParamPaneShape(editor, { ...position, paramsName: name })),
    collect: (shapes) => ({
      paramPaneViews: shapes.filter(isParamPaneShape).map((shape) => ({
        id: shape.id,
        paramsName: shape.props.paramsName,
        x: shape.x,
        y: shape.y,
        w: shape.props.w,
        h: shape.props.h,
      })),
    }),
    restore(editor, canvas) {
      for (const view of canvas.paramPaneViews ?? []) {
        const id = view.id as ParamPaneShape["id"];
        if (editor.getShape(id)) continue;
        createParamPaneShape(editor, {
          id,
          x: view.x,
          y: view.y,
          w: view.w,
          h: view.h,
          paramsName: view.paramsName,
          title: `params: ${view.paramsName}`,
        });
      }
    },
    hasChanged: (before, after) => {
      const a = before as ParamPaneShape;
      const b = after as ParamPaneShape;
      return hasBoxChanged(a, b) || a.props.paramsName !== b.props.paramsName;
    },
  },
  {
    shapeUtil: AnimationEditorShapeUtil,
    isShape: isAnimationEditorShape,
    entityType: ANIMATION_TIMELINE_ENTITY_TYPE,
    entityRef: (shape) => ({
      type: ANIMATION_TIMELINE_ENTITY_TYPE,
      name: (shape as AnimationEditorShape).props.animationName,
    }),
    createEntityView: (editor, name, position) =>
      String(
        createAnimationEditorShape(editor, {
          ...position,
          animationName: name,
        }),
      ),
    collect: (shapes) => ({
      animationEditorViews: shapes.filter(isAnimationEditorShape).map((
        shape,
      ) => ({
        id: shape.id,
        animationName: shape.props.animationName,
        x: shape.x,
        y: shape.y,
        w: shape.props.w,
        h: shape.props.h,
      })),
    }),
    restore(editor, canvas) {
      for (const view of canvas.animationEditorViews ?? []) {
        const id = view.id as AnimationEditorShape["id"];
        if (editor.getShape(id)) continue;
        createAnimationEditorShape(editor, {
          id,
          x: view.x,
          y: view.y,
          w: view.w,
          h: view.h,
          animationName: view.animationName,
          title: `animation: ${view.animationName}`,
        });
      }
    },
    hasChanged: (before, after) => {
      const a = before as AnimationEditorShape;
      const b = after as AnimationEditorShape;
      return hasBoxChanged(a, b) ||
        a.props.animationName !== b.props.animationName;
    },
  },
  {
    shapeUtil: DrawingShapeUtil,
    isShape: isDrawingShape,
    entityType: DRAWING_ENTITY_TYPE,
    entityRef: (shape) => ({
      type: DRAWING_ENTITY_TYPE,
      name: (shape as DrawingShape).props.drawingName,
    }),
    createEntityView: (editor, name, position) =>
      String(createDrawingShape(editor, { ...position, drawingName: name })),
    collect: (shapes) => ({
      drawingViews: shapes.filter(isDrawingShape).map((shape) => ({
        id: shape.id,
        drawingName: shape.props.drawingName,
        x: shape.x,
        y: shape.y,
        w: shape.props.w,
        h: shape.props.h,
      })),
    }),
    restore(editor, canvas) {
      for (const view of canvas.drawingViews ?? []) {
        const id = view.id as DrawingShape["id"];
        if (editor.getShape(id)) continue;
        createDrawingShape(editor, {
          id,
          x: view.x,
          y: view.y,
          w: view.w,
          h: view.h,
          drawingName: view.drawingName,
          title: `drawing: ${view.drawingName}`,
        });
      }
    },
    hasChanged: (before, after) => {
      const a = before as DrawingShape;
      const b = after as DrawingShape;
      return hasBoxChanged(a, b) ||
        a.props.drawingName !== b.props.drawingName;
    },
  },
  {
    shapeUtil: SignalScopeShapeUtil,
    isShape: isSignalScopeShape,
    collect: (shapes) => ({
      scopeViews: shapes.filter(isSignalScopeShape).map((shape) => ({
        id: shape.id,
        sourceType: shape.props.sourceType,
        name: shape.props.name,
        path: shape.props.path,
        windowSec: shape.props.windowSec,
        x: shape.x,
        y: shape.y,
        w: shape.props.w,
        h: shape.props.h,
      })),
    }),
    restore(editor, canvas) {
      for (const view of canvas.scopeViews ?? []) {
        const id = view.id as SignalScopeShape["id"];
        if (editor.getShape(id)) continue;
        createSignalScopeShape(editor, {
          id,
          x: view.x,
          y: view.y,
          w: view.w,
          h: view.h,
          sourceType: view.sourceType,
          name: view.name,
          path: view.path,
          windowSec: view.windowSec,
          title: describeScopeSource(view.sourceType, view.name, view.path),
        });
      }
    },
    hasChanged: (before, after) => {
      const a = before as SignalScopeShape;
      const b = after as SignalScopeShape;
      return hasBoxChanged(a, b) ||
        a.props.sourceType !== b.props.sourceType ||
        a.props.name !== b.props.name ||
        a.props.path !== b.props.path ||
        a.props.windowSec !== b.props.windowSec;
    },
  },
  {
    shapeUtil: CanvasSurfaceShapeUtil,
    isShape: isCanvasSurfaceShape,
    collect: (shapes) => ({
      canvasSurfaceViews: shapes.filter(isCanvasSurfaceShape).map((shape) => ({
        id: shape.id,
        surfaceName: shape.props.surfaceName,
        x: shape.x,
        y: shape.y,
        w: shape.props.w,
        h: shape.props.h,
      })),
    }),
    restore(editor, canvas) {
      for (const view of canvas.canvasSurfaceViews ?? []) {
        const id = view.id as CanvasSurfaceShape["id"];
        if (editor.getShape(id)) continue;
        createCanvasSurfaceShape(editor, {
          id,
          x: view.x,
          y: view.y,
          w: view.w,
          h: view.h,
          surfaceName: view.surfaceName,
          title: `canvas: ${view.surfaceName}`,
        });
      }
    },
    hasChanged: (before, after) => {
      const a = before as CanvasSurfaceShape;
      const b = after as CanvasSurfaceShape;
      return hasBoxChanged(a, b) ||
        a.props.surfaceName !== b.props.surfaceName;
    },
  },
];

export const CANVAS_VIEW_SHAPE_UTILS = CANVAS_VIEW_CODECS.map((codec) =>
  codec.shapeUtil
);

export function collectCanvasViews(
  shapes: readonly unknown[],
): ProjectCanvasState {
  return collectViewsFromCodecs(CANVAS_VIEW_CODECS, shapes);
}

export async function saveProjectWithCanvas(
  editor: Editor,
  serverBaseUrl: string,
): Promise<ProjectSaveResponse> {
  await postServerJson(serverBaseUrl, "/project/canvas", {
    canvas: collectCanvasViews(editor.getCurrentPageShapes()),
  });
  return await saveProject(serverBaseUrl);
}

export function restoreCanvasViews(
  editor: Editor,
  canvas: ProjectCanvasState | undefined,
): void {
  if (!canvas) return;
  for (const codec of CANVAS_VIEW_CODECS) codec.restore(editor, canvas);
}

export function isCanvasViewShape(value: unknown): boolean {
  return isRegisteredCanvasView(CANVAS_VIEW_CODECS, value);
}

export function hasCanvasViewShapeChanged(
  before: unknown,
  after: unknown,
): boolean {
  return registeredCanvasViewChanged(CANVAS_VIEW_CODECS, before, after);
}

export function entityRefForCanvasView(
  shape: unknown,
): DurableEntityRef | null {
  return registeredEntityRef(CANVAS_VIEW_CODECS, shape);
}

export function createEntityView(
  editor: Editor,
  entityType: string,
  name: string,
  position?: { x: number; y: number },
): string {
  const codec = CANVAS_VIEW_CODECS.find((candidate) =>
    candidate.entityType === entityType && candidate.createEntityView
  );
  if (!codec?.createEntityView) {
    throw new Error(
      `No canvas view registered for entity type "${entityType}"`,
    );
  }
  return codec.createEntityView(editor, name, position);
}

export function createAdjacentEntityView(
  editor: Editor,
  entityType: string,
  name: string,
): void {
  const codec = CANVAS_VIEW_CODECS.find((candidate) =>
    candidate.entityType === entityType && candidate.createEntityView
  );
  if (!codec?.createEntityView) {
    throw new Error(
      `No canvas view registered for entity type "${entityType}"`,
    );
  }
  const source = editor.getOnlySelectedShape();
  const sourceCodec = CANVAS_VIEW_CODECS.find((candidate) =>
    candidate.entityRef && candidate.isShape(source)
  );
  const sourceBox = sourceCodec && source
    ? source as { x: number; y: number; props: { w: number } }
    : null;
  const position = sourceBox
    ? { x: sourceBox.x + sourceBox.props.w + 40, y: sourceBox.y }
    : undefined;
  codec.createEntityView(editor, name, position);
}

function hasBoxChanged(
  before: { x: number; y: number; props: { w: number; h: number } },
  after: { x: number; y: number; props: { w: number; h: number } },
): boolean {
  return before.x !== after.x || before.y !== after.y ||
    before.props.w !== after.props.w || before.props.h !== after.props.h;
}

function hasShapeType(value: unknown, type: string): boolean {
  return Boolean(
    value && typeof value === "object" && "type" in value &&
      (value as { type?: unknown }).type === type,
  );
}

function isPianoRollShape(value: unknown): value is PianoRollShape {
  return hasShapeType(value, PIANO_ROLL_SHAPE_TYPE);
}

function isParamPaneShape(value: unknown): value is ParamPaneShape {
  return hasShapeType(value, PARAM_PANE_SHAPE_TYPE);
}

function isAnimationEditorShape(value: unknown): value is AnimationEditorShape {
  return hasShapeType(value, ANIMATION_EDITOR_SHAPE_TYPE);
}

function isDrawingShape(value: unknown): value is DrawingShape {
  return hasShapeType(value, DRAWING_SHAPE_TYPE);
}

function isSignalScopeShape(value: unknown): value is SignalScopeShape {
  return hasShapeType(value, SIGNAL_SCOPE_SHAPE_TYPE);
}

function isCanvasSurfaceShape(value: unknown): value is CanvasSurfaceShape {
  return hasShapeType(value, CANVAS_SURFACE_SHAPE_TYPE);
}
