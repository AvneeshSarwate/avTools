import { useMemo } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  RecordProps,
  T,
  TLShape,
  useEditor,
} from "tldraw";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { DEFAULT_LIVECODE_SOURCE } from "./defaultSource";
import { livecodeDocumentUri } from "./denoLsp";
import type { SourceRange } from "./livecodeProtocol";
import { useLivecodeRuntime } from "./livecodeRuntime";

export const LIVECODE_EDITOR_SHAPE_TYPE = "livecode-editor";

declare module "tldraw" {
  export interface TLGlobalShapePropsMap {
    [LIVECODE_EDITOR_SHAPE_TYPE]: {
      w: number;
      h: number;
      moduleId: string;
      projectModulePath?: string;
      projectModuleKind?: "library" | "runnable";
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
    projectModuleKind: T.literalEnum("library", "runnable").optional(),
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

  const diagnostics = moduleState?.diagnostics ?? [];
  const lspDiagnostics = runtime.lspDiagnosticsByUri[documentUri] ?? [];
  const buildStatus = moduleState?.buildStatus ?? "idle";
  const runStatus = moduleState?.runStatus ?? "idle";
  const callsiteCount = moduleState?.manifest?.callsites.length ?? 0;
  const canRun = shape.props.projectModuleKind !== "library";

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
            disabled={!canRun || runtime.connectionStatus !== "open" ||
              runStatus === "running"}
            title={!canRun
              ? "Library modules are imported by runnable modules"
              : undefined}
            onClick={() => void runtime.runModule(shape.props.moduleId)}
          >
            Run
          </button>
          <button
            type="button"
            disabled={!canRun || runtime.connectionStatus !== "open" ||
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
        {shape.props.projectModuleKind
          ? <span>{shape.props.projectModuleKind}</span>
          : null}
      </div>

      <div className="livecode-shape__editor">
        <CodeMirrorEditor
          value={shape.props.source}
          documentUri={documentUri}
          activeRanges={activeRanges}
          lspClient={runtime.lspClient}
          readOnly={runtime.connectionStatus === "connecting"}
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
