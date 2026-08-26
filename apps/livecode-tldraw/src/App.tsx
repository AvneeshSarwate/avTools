import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Editor, Tldraw } from "tldraw";
import {
  type LivecodeEditorShape,
  LivecodeEditorShapeUtil,
} from "./LivecodeEditorShape";
import type { ProjectStatusResponse } from "./livecodeProtocol";
import { LivecodeRuntimeProvider, useLivecodeRuntime } from "./livecodeRuntime";
import { SyncRuntimeProvider } from "./syncRuntime";
import {
  CANVAS_VIEW_SHAPE_UTILS,
  collectCanvasViews,
  hasCanvasViewShapeChanged,
  isCanvasViewShape,
} from "./canvasViews";
import { setRuntimeDebugRefs } from "./livecodeTldrawDebug";
import { useClientControlBridge } from "./clientControlBridge";
import { TopBar } from "./TopBar";
import {
  createDefaultLivecodeCanvas,
  hasLivecodeShapes,
  hasShapeLayoutChanged,
  isBakedServerBaseUrl,
  isLivecodeShape,
  loadBakedProjectIntoCanvas,
  loadProjectIntoCanvas,
  loadTldrawCanvasFromFile,
  loadTldrawCanvasFromUrl,
  postJson,
} from "./projectCanvas";

const shapeUtils = [
  LivecodeEditorShapeUtil,
  ...CANVAS_VIEW_SHAPE_UTILS,
];
export function App() {
  // The sync provider is outermost because everything else reads from it: the
  // entity shapes take their maps from it directly, and the livecode runtime
  // takes runs/waits/lookups plus its socket lifecycle from it.
  return (
    <SyncRuntimeProvider>
      <LivecodeRuntimeProvider>
        <LivecodeTldrawPage />
      </LivecodeRuntimeProvider>
    </SyncRuntimeProvider>
  );
}

function LivecodeTldrawPage() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const runtime = useLivecodeRuntime();
  const { registerModule, unregisterModule, setModuleSource } = runtime;
  const projectPath = useMemo(
    () => new URLSearchParams(window.location.search).get("projectPath"),
    [],
  );
  const canvasUrl = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tldr") ?? params.get("canvas") ??
      params.get("canvasUrl");
  }, []);
  // `serverBaseUrl=none` is the serverless baked topology: the project shape
  // comes from the bake's static baked.json instead of project routes.
  const bakedMode = isBakedServerBaseUrl(runtime.serverBaseUrl);
  const projectLoadedRef = useRef(false);
  const canvasLoadedRef = useRef(false);
  const bakedLoadedRef = useRef(false);
  const suppressStoreListenerRef = useRef(false);
  const layoutUpdateTimersRef = useRef(new Map<string, number>());
  const canvasUpdateTimerRef = useRef<number | undefined>(undefined);

  useClientControlBridge(editor, runtime);

  const syncLivecodeShapesToRuntime = useCallback(() => {
    if (!editor) return;
    const shapes = editor.getCurrentPageShapes().filter(isLivecodeShape);
    const shapeModuleIds = new Set(shapes.map((shape) => shape.props.moduleId));
    for (const moduleId of Object.keys(runtime.modules)) {
      if (!shapeModuleIds.has(moduleId)) unregisterModule(moduleId);
    }
    for (const shape of shapes) {
      registerModule(
        shape.props.moduleId,
        shape.props.source,
        shape.props.projectModulePath,
      );
    }
  }, [editor, registerModule, runtime.modules, unregisterModule]);

  const scheduleProjectModuleLayoutUpdate = useCallback(
    (shape: LivecodeEditorShape) => {
      if (!shape.props.projectModulePath) return;
      const previous = layoutUpdateTimersRef.current.get(shape.props.moduleId);
      if (previous !== undefined) window.clearTimeout(previous);
      const timer = window.setTimeout(() => {
        layoutUpdateTimersRef.current.delete(shape.props.moduleId);
        void postJson<ProjectStatusResponse>(
          `${runtime.serverBaseUrl}/project/modules/update`,
          {
            id: shape.props.moduleId,
            x: shape.x,
            y: shape.y,
            w: shape.props.w,
            h: shape.props.h,
          },
        ).catch((error) => {
          console.error(
            "[livecode-tldraw] failed to persist module layout",
            error,
          );
        });
      }, 1_000);
      layoutUpdateTimersRef.current.set(shape.props.moduleId, timer);
    },
    [runtime.serverBaseUrl],
  );

  // One collector for every canvas view kind: `/project/canvas` replaces the
  // whole canvas object, so a post that carried only one array would drop the
  // other kind's layout.
  const scheduleCanvasViewsUpdate = useCallback(() => {
    if (!editor || !projectPath) return;
    if (canvasUpdateTimerRef.current !== undefined) {
      window.clearTimeout(canvasUpdateTimerRef.current);
    }
    canvasUpdateTimerRef.current = window.setTimeout(() => {
      canvasUpdateTimerRef.current = undefined;
      const shapes = editor.getCurrentPageShapes();
      void postJson(`${runtime.serverBaseUrl}/project/canvas`, {
        canvas: collectCanvasViews(shapes),
      }).catch((error) => {
        console.error(
          "[livecode-tldraw] failed to persist canvas view layout",
          error,
        );
      });
    }, 1_000);
  }, [editor, projectPath, runtime.serverBaseUrl]);

  const loadTldrawFile = useCallback(
    async (file: File) => {
      if (!editor) return;
      suppressStoreListenerRef.current = true;
      try {
        await loadTldrawCanvasFromFile(editor, file);
      } finally {
        suppressStoreListenerRef.current = false;
        syncLivecodeShapesToRuntime();
      }
    },
    [editor, syncLivecodeShapesToRuntime],
  );

  useEffect(() => {
    setRuntimeDebugRefs(runtime, editor);
  }, [runtime, editor]);

  useEffect(() => {
    if (!editor) return;

    syncLivecodeShapesToRuntime();

    const unsubscribe = editor.store.listen(
      (entry) => {
        if (suppressStoreListenerRef.current) return;
        for (const record of Object.values(entry.changes.added)) {
          if (isLivecodeShape(record)) {
            registerModule(
              record.props.moduleId,
              record.props.source,
              record.props.projectModulePath,
            );
          } else if (isCanvasViewShape(record)) {
            scheduleCanvasViewsUpdate();
          }
        }

        for (const [before, after] of Object.values(entry.changes.updated)) {
          if (isLivecodeShape(before) && !isLivecodeShape(after)) {
            unregisterModule(before.props.moduleId);
          } else if (!isLivecodeShape(before) && isLivecodeShape(after)) {
            registerModule(
              after.props.moduleId,
              after.props.source,
              after.props.projectModulePath,
            );
          } else if (isLivecodeShape(before) && isLivecodeShape(after)) {
            if (before.props.moduleId !== after.props.moduleId) {
              unregisterModule(before.props.moduleId);
              registerModule(
                after.props.moduleId,
                after.props.source,
                after.props.projectModulePath,
              );
            } else if (before.props.source !== after.props.source) {
              setModuleSource(after.props.moduleId, after.props.source);
            }
            if (
              after.props.projectModulePath &&
              hasShapeLayoutChanged(before, after)
            ) {
              scheduleProjectModuleLayoutUpdate(after);
            }
          } else if (hasCanvasViewShapeChanged(before, after)) {
            scheduleCanvasViewsUpdate();
          }
        }

        for (const record of Object.values(entry.changes.removed)) {
          if (isLivecodeShape(record)) {
            unregisterModule(record.props.moduleId);
          } else if (isCanvasViewShape(record)) {
            scheduleCanvasViewsUpdate();
          }
        }
      },
      { source: "all", scope: "document" },
    );

    return unsubscribe;
  }, [
    editor,
    registerModule,
    scheduleCanvasViewsUpdate,
    scheduleProjectModuleLayoutUpdate,
    setModuleSource,
    syncLivecodeShapesToRuntime,
    unregisterModule,
  ]);

  useEffect(() => {
    return () => {
      for (const timer of layoutUpdateTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      layoutUpdateTimersRef.current.clear();
      if (canvasUpdateTimerRef.current !== undefined) {
        window.clearTimeout(canvasUpdateTimerRef.current);
        canvasUpdateTimerRef.current = undefined;
      }
    };
  }, []);

  useEffect(() => {
    if (!editor || !canvasUrl || projectPath || canvasLoadedRef.current) return;

    void (async () => {
      suppressStoreListenerRef.current = true;
      try {
        await loadTldrawCanvasFromUrl(editor, canvasUrl);
        canvasLoadedRef.current = true;
      } catch (error) {
        canvasLoadedRef.current = false;
        console.error("[livecode-tldraw] failed to load tldraw canvas", error);
      } finally {
        suppressStoreListenerRef.current = false;
        syncLivecodeShapesToRuntime();
      }
    })();
  }, [canvasUrl, editor, projectPath, syncLivecodeShapesToRuntime]);

  useEffect(() => {
    if (!editor || !projectPath || projectLoadedRef.current) return;

    void (async () => {
      suppressStoreListenerRef.current = true;
      try {
        await loadProjectIntoCanvas(editor, runtime.serverBaseUrl, projectPath);
        projectLoadedRef.current = true;
        if (runtime.connectionStatus === "closed") {
          void runtime.connect();
        }
      } catch (error) {
        projectLoadedRef.current = false;
        console.error("[livecode-tldraw] failed to load project", error);
      } finally {
        suppressStoreListenerRef.current = false;
        syncLivecodeShapesToRuntime();
      }
    })();
  }, [editor, projectPath, runtime, syncLivecodeShapesToRuntime]);

  useEffect(() => {
    if (!editor || !bakedMode || projectPath || canvasUrl) return;
    if (bakedLoadedRef.current) return;
    bakedLoadedRef.current = true;

    void (async () => {
      suppressStoreListenerRef.current = true;
      try {
        await loadBakedProjectIntoCanvas(editor);
      } catch (error) {
        // A bake always ships baked.json; missing means this is a plain
        // serverless page, which still deserves a canvas to look at.
        console.error("[livecode-tldraw] failed to load baked project", error);
        if (!hasLivecodeShapes(editor)) createDefaultLivecodeCanvas(editor);
      } finally {
        suppressStoreListenerRef.current = false;
        syncLivecodeShapesToRuntime();
      }
    })();
  }, [bakedMode, canvasUrl, editor, projectPath, syncLivecodeShapesToRuntime]);

  return (
    <div className="app-shell">
      <TopBar
        editor={editor}
        projectPath={projectPath}
        onOpenTldrawFile={loadTldrawFile}
      />
      <div className="canvas-shell">
        <Tldraw
          shapeUtils={shapeUtils}
          onMount={(mountedEditor) => {
            setEditor(mountedEditor);
            if (
              !projectPath && !canvasUrl && !bakedMode &&
              !hasLivecodeShapes(mountedEditor)
            ) {
              createDefaultLivecodeCanvas(mountedEditor);
            }
          }}
        />
      </div>
    </div>
  );
}
