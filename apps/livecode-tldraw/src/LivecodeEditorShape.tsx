import { useCallback, useMemo } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  RecordProps,
  T,
  TLShape,
  useEditor,
} from "tldraw";
import {
  CodeMirrorEditor,
  type ParamPaneCallDecoration,
  type PianoRollCallDecoration,
} from "./CodeMirrorEditor";
import { DEFAULT_LIVECODE_SOURCE } from "./defaultSource";
import { livecodeDocumentUri } from "./denoLsp";
import type { SourceRange } from "./livecodeProtocol";
import { useLivecodeRuntime } from "./livecodeRuntime";
import {
  createParamPaneShape,
  PARAM_PANE_SHAPE_TYPE,
  type ParamPaneShape,
} from "./ParamPaneShape";
import {
  createPianoRollShape,
  PIANO_ROLL_SHAPE_TYPE,
  type PianoRollShape,
} from "./PianoRollShape";

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

  const pianoRollCallsites = useMemo<PianoRollCallDecoration[]>(() => {
    if (!moduleState?.manifest) return [];
    const lookups = moduleState.pianoRollLookups ?? {};
    const out: PianoRollCallDecoration[] = [];
    for (const callsite of moduleState.manifest.callsites) {
      if (callsite.kind !== "pianoRollLookup") continue;
      if (!callsite.nameArgRange) continue;
      const resolved = lookups[callsite.id];
      if (resolved !== undefined) {
        out.push({
          at: callsite.nameArgRange.to,
          rollName: resolved,
          resolvedAtRuntime: true,
        });
      } else if (callsite.staticName !== undefined) {
        out.push({
          at: callsite.nameArgRange.to,
          rollName: callsite.staticName,
          resolvedAtRuntime: false,
        });
      }
    }
    return out;
  }, [moduleState?.manifest, moduleState?.pianoRollLookups]);

  // Params have no runtime name resolution, so only a static literal name
  // produces a widget.
  const paramPaneCallsites = useMemo<ParamPaneCallDecoration[]>(() => {
    if (!moduleState?.manifest) return [];
    const out: ParamPaneCallDecoration[] = [];
    for (const callsite of moduleState.manifest.callsites) {
      if (callsite.kind !== "canvasParams") continue;
      if (!callsite.nameArgRange || callsite.staticName === undefined) continue;
      out.push({
        at: callsite.nameArgRange.to,
        paramsName: callsite.staticName,
      });
    }
    return out;
  }, [moduleState?.manifest]);

  const openPianoRoll = useCallback(
    (rollName: string) => {
      const existing = editor
        .getCurrentPageShapes()
        .find((s): s is PianoRollShape =>
          s.type === PIANO_ROLL_SHAPE_TYPE && s.props.rollName === rollName);
      if (existing) {
        editor.select(existing.id);
        editor.zoomToSelection();
        return;
      }
      createPianoRollShape(editor, {
        x: shape.x + shape.props.w + 40,
        y: shape.y,
        rollName,
      });
      editor.zoomToSelection();
    },
    [editor, shape.x, shape.y, shape.props.w],
  );

  const openParamPane = useCallback(
    (paramsName: string) => {
      const existing = editor
        .getCurrentPageShapes()
        .find((s): s is ParamPaneShape =>
          s.type === PARAM_PANE_SHAPE_TYPE && s.props.paramsName === paramsName
        );
      if (existing) {
        editor.select(existing.id);
        editor.zoomToSelection();
        return;
      }
      createParamPaneShape(editor, {
        x: shape.x + shape.props.w + 40,
        y: shape.y,
        paramsName,
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
            disabled={runtime.connectionStatus !== "open" ||
              runStatus === "running"}
            onClick={() => void runtime.runModule(shape.props.moduleId)}
          >
            Run
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
        <span className={`status-pill status-pill--${runtime.lspStatus}`}>
          lsp: {runtime.lspStatus}
        </span>
        <span>{callsiteCount} callsites</span>
        <span>{moduleState?.activeIds.length ?? 0} active</span>
        <span>{lspDiagnostics.length} lsp diagnostics</span>
        {dependencies.length > 0 ? <span>{dependencies.length} deps</span> : null}
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
          pianoRollCallsites={pianoRollCallsites}
          paramPaneCallsites={paramPaneCallsites}
          lspClient={runtime.lspClient}
          readOnly={runtime.connectionStatus === "connecting"}
          onOpenPianoRoll={openPianoRoll}
          onOpenParamPane={openParamPane}
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
