import { useCallback, useMemo } from "react";
import {
  BaseBoxShapeUtil,
  createShapeId,
  type Editor,
  HTMLContainer,
  RecordProps,
  T,
  TLShape,
  useEditor,
} from "tldraw";
import {
  CodeMirrorEditor,
  type EntityCallDecoration,
  type EntityCallDecorationType,
} from "./CodeMirrorEditor";
import { DEFAULT_LIVECODE_SOURCE } from "./defaultSource";
import { livecodeDocumentUri } from "./denoLsp";
import type { SourceRange } from "./livecodeProtocol";
import { useLivecodeRuntime } from "./livecodeRuntime";
import { createEntityView, entityRefForCanvasView } from "./canvasViews";
import {
  createSignalScopeShape,
  SIGNAL_SCOPE_SHAPE_TYPE,
  type SignalScopeShape,
} from "./SignalScopeShape";
import { PARAMS_ENTITY_TYPE, PIANO_ROLL_ENTITY_TYPE } from "./serverRequests";

export const LIVECODE_EDITOR_SHAPE_TYPE = "livecode-editor";

declare module "tldraw" {
  export interface TLGlobalShapePropsMap {
    [LIVECODE_EDITOR_SHAPE_TYPE]: {
      w: number;
      h: number;
      moduleId: string;
      projectModulePath?: string;
      projectModuleKind?: "runnable";
      projectSourceUri?: string;
      title: string;
      source: string;
      /** Baked modules: the code is display-only, per the bake's contract. */
      readOnly?: boolean;
    };
  }
}

export type LivecodeEditorShape = TLShape<typeof LIVECODE_EDITOR_SHAPE_TYPE>;

export class LivecodeEditorShapeUtil
  extends BaseBoxShapeUtil<LivecodeEditorShape> {
  static override type = LIVECODE_EDITOR_SHAPE_TYPE;
  static override props: RecordProps<LivecodeEditorShape> = {
    w: T.number,
    h: T.number,
    moduleId: T.string,
    projectModulePath: T.string.optional(),
    projectModuleKind: T.literalEnum("runnable").optional(),
    projectSourceUri: T.string.optional(),
    title: T.string,
    source: T.string,
    readOnly: T.boolean.optional(),
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

  override getDefaultProps(): LivecodeEditorShape["props"] {
    const moduleId = createModuleId();
    return {
      w: 640,
      h: 520,
      moduleId,
      title: "livecode module",
      source: DEFAULT_LIVECODE_SOURCE,
    };
  }

  override component(shape: LivecodeEditorShape) {
    return <LivecodeEditorShapeComponent shape={shape} />;
  }

  override getIndicatorPath(shape: LivecodeEditorShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}

export function createModuleId() {
  return `module-${crypto.randomUUID()}`;
}

/**
 * The one way a module shape is born, wherever the gesture comes from: the
 * topbar, project open, the client-control bridge, or the debug surface. The
 * store listener in App.tsx turns the new shape into a registered module.
 */
export function createLivecodeShape(
  editor: Editor,
  options: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    moduleId?: string;
    projectModulePath?: string;
    projectModuleKind?: "runnable";
    projectSourceUri?: string;
    title?: string;
    source?: string;
    readOnly?: boolean;
  } = {},
) {
  const id = createShapeId();
  const moduleId = options.moduleId ?? createModuleId();
  const center = editor.getViewportPageBounds().center;
  editor.createShape<LivecodeEditorShape>({
    id,
    type: LIVECODE_EDITOR_SHAPE_TYPE,
    x: options.x ?? center.x - 320,
    y: options.y ?? center.y - 260,
    props: {
      w: options.w ?? 640,
      h: options.h ?? 520,
      moduleId,
      projectModulePath: options.projectModulePath,
      projectModuleKind: options.projectModuleKind,
      projectSourceUri: options.projectSourceUri,
      title: options.title ?? `module ${moduleId.slice(7, 15)}`,
      source: options.source ?? DEFAULT_LIVECODE_SOURCE,
      readOnly: options.readOnly,
    },
  });
  editor.select(id);
  return id;
}

interface LivecodeEditorShapeComponentProps {
  shape: LivecodeEditorShape;
}

function LivecodeEditorShapeComponent(
  { shape }: LivecodeEditorShapeComponentProps,
) {
  const editor = useEditor();
  const runtime = useLivecodeRuntime();
  const { setModuleSource } = runtime;
  const moduleState = runtime.modules[shape.props.moduleId];
  const documentUri = useMemo(
    () =>
      shape.props.projectSourceUri ?? livecodeDocumentUri(shape.props.moduleId),
    [shape.props.moduleId, shape.props.projectSourceUri],
  );

  const activeRanges = useMemo<SourceRange[]>(() => {
    if (!moduleState?.manifest) return [];
    const active = new Set(moduleState.activeIds);
    return moduleState.manifest.callsites
      .filter((callsite) => active.has(callsite.id))
      .map((callsite) => callsite.range);
  }, [moduleState?.activeIds, moduleState?.manifest]);

  const entityCallsites = useMemo<EntityCallDecoration[]>(() => {
    if (!moduleState?.manifest) return [];
    const lookups = moduleState.pianoRollLookups ?? {};
    const out: EntityCallDecoration[] = [];
    for (const callsite of moduleState.manifest.callsites) {
      if (!callsite.nameArgRange) continue;
      if (callsite.kind === "pianoRollLookup") {
        const resolved = lookups[callsite.id];
        if (resolved !== undefined) {
          out.push({
            at: callsite.nameArgRange.from,
            entityType: PIANO_ROLL_ENTITY_TYPE,
            entityName: resolved,
          });
        } else if (callsite.staticName !== undefined) {
          out.push({
            at: callsite.nameArgRange.from,
            entityType: PIANO_ROLL_ENTITY_TYPE,
            entityName: callsite.staticName,
            tentative: true,
          });
        }
      } else if (
        callsite.kind === "canvasParams" && callsite.staticName !== undefined
      ) {
        out.push({
          at: callsite.nameArgRange.from,
          entityType: PARAMS_ENTITY_TYPE,
          entityName: callsite.staticName,
        });
      } else if (
        callsite.kind === "canvasSignal" && callsite.staticName !== undefined
      ) {
        out.push({
          at: callsite.nameArgRange.from,
          entityType: "signal",
          entityName: callsite.staticName,
        });
      }
    }
    return out;
  }, [moduleState?.manifest, moduleState?.pianoRollLookups]);

  const openEntity = useCallback(
    (entityType: EntityCallDecorationType, entityName: string) => {
      if (entityType === "signal") {
        const existing = editor
          .getCurrentPageShapes()
          .find((candidate): candidate is SignalScopeShape =>
            candidate.type === SIGNAL_SCOPE_SHAPE_TYPE &&
            candidate.props.sourceType === "signal" &&
            candidate.props.name === entityName &&
            candidate.props.path === ""
          );
        if (existing) {
          editor.select(existing.id);
          editor.zoomToSelection();
          return;
        }
        createSignalScopeShape(editor, {
          x: shape.x + shape.props.w + 40,
          y: shape.y,
          sourceType: "signal",
          name: entityName,
        });
        editor.zoomToSelection();
        return;
      }

      const existing = editor
        .getCurrentPageShapes()
        .find((candidate) => {
          const ref = entityRefForCanvasView(candidate);
          return ref?.type === entityType && ref.name === entityName;
        });
      if (existing) {
        editor.select(existing.id);
        editor.zoomToSelection();
        return;
      }
      createEntityView(editor, entityType, entityName, {
        x: shape.x + shape.props.w + 40,
        y: shape.y,
      });
      editor.zoomToSelection();
    },
    [editor, shape.x, shape.y, shape.props.w],
  );

  const diagnostics = moduleState?.diagnostics ?? [];
  const lspDiagnostics = runtime.lspDiagnosticsByUri[documentUri] ?? [];
  const projectModuleDiagnostics = runtime.projectDiagnostics?.modules.find((
    moduleEntry,
  ) => moduleEntry.moduleId === shape.props.moduleId);
  const dependencyDiagnostics =
    projectModuleDiagnostics?.dependencyDiagnostics ?? [];
  const changedDependencies = projectModuleDiagnostics?.changedDependencies ??
    [];
  const dependencies = projectModuleDiagnostics?.dependencies ?? [];
  const hasDependencyIssue = dependencyDiagnostics.length > 0;
  const buildStatus = moduleState?.buildStatus ?? "idle";
  const runStatus = moduleState?.runStatus ?? "idle";
  // Run over a running module is a replacement, and the button says so rather
  // than going dead: the flag it sends is the server's consent check.
  const isRunning = runStatus === "running";
  const callsiteCount = moduleState?.manifest?.callsites.length ?? 0;
  return (
    <HTMLContainer
      className="livecode-shape"
      style={{
        width: shape.props.w,
        height: shape.props.h,
      }}
    >
      <div className="livecode-shape__header">
        <div className="livecode-shape__title">
          <strong>{shape.props.title}</strong>
          <span>{shape.props.projectModulePath ?? shape.props.moduleId}</span>
        </div>
        <div
          className="livecode-shape__actions"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            disabled={runtime.connectionStatus !== "open"}
            onClick={() =>
              void (isRunning
                ? runtime.replaceModule(shape.props.moduleId)
                : runtime.runModule(shape.props.moduleId))}
          >
            {isRunning ? "Replace" : "Run"}
          </button>
          <button
            type="button"
            disabled={runtime.connectionStatus !== "open" ||
              runStatus === "stopping"}
            onClick={() => void runtime.stopModule(shape.props.moduleId)}
          >
            Stop
          </button>
        </div>
      </div>

      <div className="livecode-shape__meta">
        <span className={`status-pill status-pill--${buildStatus}`}>
          build: {buildStatus}
        </span>
        <span className={`status-pill status-pill--${runStatus}`}>
          run: {runStatus}
        </span>
        <span>runs: {moduleState?.executionCount ?? 0}</span>
        <span className={`status-pill status-pill--${runtime.lspStatus}`}>
          lsp: {runtime.lspStatus}
        </span>
        <span>{callsiteCount} callsites</span>
        <span>{moduleState?.activeIds.length ?? 0} active</span>
        <span>{lspDiagnostics.length} lsp diagnostics</span>
        {dependencies.length > 0
          ? <span>{dependencies.length} deps</span>
          : null}
        {changedDependencies.length > 0 || hasDependencyIssue
          ? (
            <span
              className={hasDependencyIssue
                ? "dependency-pill dependency-pill--error"
                : "dependency-pill dependency-pill--changed"}
              title={changedDependencies.length > 0
                ? changedDependencies.join(", ")
                : "project diagnostics"}
            >
              {hasDependencyIssue ? "dep issue" : "dep changed"}
            </span>
          )
          : null}
      </div>

      <div className="livecode-shape__editor">
        <CodeMirrorEditor
          value={shape.props.source}
          documentUri={documentUri}
          activeRanges={activeRanges}
          entityCallsites={entityCallsites}
          lspClient={runtime.lspClient}
          readOnly={shape.props.readOnly === true ||
            runtime.connectionStatus === "connecting"}
          onOpenEntity={openEntity}
          onChange={(next) => {
            setModuleSource(shape.props.moduleId, next);
            editor.updateShape({
              id: shape.id,
              type: LIVECODE_EDITOR_SHAPE_TYPE,
              props: { source: next },
            });
          }}
        />
      </div>

      <div
        className="livecode-shape__footer"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {diagnostics.length > 0
          ? (
            diagnostics.slice(0, 2).map((diagnostic) => (
              <div
                key={`${diagnostic.code}-${diagnostic.from}-${diagnostic.to}`}
                className="diagnostic"
              >
                {diagnostic.message}
              </div>
            ))
          )
          : dependencyDiagnostics.length > 0
          ? (
            dependencyDiagnostics.slice(0, 2).map((diagnostic, index) => (
              <div
                key={`dependency-${diagnostic.code}-${index}`}
                className="diagnostic"
              >
                dependency {diagnostic.code}: {diagnostic.message}
              </div>
            ))
          )
          : lspDiagnostics.length > 0
          ? (
            lspDiagnostics.slice(0, 2).map((diagnostic, index) => (
              <div
                key={`${diagnostic.code ?? "lsp"}-${index}`}
                className="diagnostic"
              >
                {diagnostic.message}
              </div>
            ))
          )
          : moduleState?.latestError
          ? <div className="diagnostic">{moduleState.latestError}</div>
          : (
            <div className="diagnostic diagnostic--quiet">
              snapshot {moduleState?.lastSnapshotSeq ?? "-"}{" "}
              / source v{moduleState?.sourceVersion ?? 0}
            </div>
          )}
      </div>
    </HTMLContainer>
  );
}
