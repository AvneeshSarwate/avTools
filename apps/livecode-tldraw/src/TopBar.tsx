import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Editor, useValue } from "tldraw";
import { createLivecodeShape } from "./LivecodeEditorShape";
import type { DurableEntityRef, ProjectSaveResponse } from "./livecodeProtocol";
import { useLivecodeRuntime } from "./livecodeRuntime";
import {
  useAnimationTimelinesSync,
  useDrawingsSync,
  useParamsSync,
  usePianoRollsSync,
  useSignalsSync,
} from "./syncRuntime";
import {
  createSignalScopeShape,
  type SignalScopeSourceType,
} from "./SignalScopeShape";
import {
  createAdjacentEntityView,
  createEntityView,
  entityRefForCanvasView,
  saveProjectWithCanvas,
} from "./canvasViews";
import { ANIMATION_TIMELINE_ENTITY_TYPE } from "./AnimationEditorShape";
import {
  createEntity,
  deleteEntity,
  DRAWING_ENTITY_TYPE,
  duplicateEntity,
  fetchProjectStatus,
  PARAMS_ENTITY_TYPE,
  PIANO_ROLL_ENTITY_TYPE,
} from "./serverRequests";
import {
  createDefaultLivecodeCanvas,
  exportBakedDataFile,
  isBakedServerBaseUrl,
  saveTldrawCanvas,
} from "./projectCanvas";
import {
  inProcessEngineHost,
  useInProcessEngineState,
} from "./inProcessEngine";
import {
  createCanvasSurfaceShape,
  listCanvasSurfaceNames,
} from "./CanvasSurfaceShape";

export function TopBar({
  editor,
  projectPath,
  onOpenTldrawFile,
}: {
  editor: Editor | null;
  projectPath: string | null;
  onOpenTldrawFile: (file: File) => Promise<void>;
}) {
  const runtime = useLivecodeRuntime();
  const paramsRuntime = useParamsSync();
  const pianoRollRuntime = usePianoRollsSync();
  const animationRuntime = useAnimationTimelinesSync();
  const drawingsRuntime = useDrawingsSync();
  const signalsRuntime = useSignalsSync();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [scopeDraft, setScopeDraft] = useState<string | null>(null);
  const [canvasSurfaceDraft, setCanvasSurfaceDraft] = useState<string | null>(
    null,
  );
  const [duplicateDraft, setDuplicateDraft] = useState<string | null>(null);
  // The name the delete button is armed for, so a selection change disarms it:
  // a confirm can never land on an entity the operator was not looking at.
  const [deleteArmedName, setDeleteArmedName] = useState<string | null>(null);
  const [entityError, setEntityError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const selection = useSelectedEntity(editor);
  const unsavedCount = useUnsavedEntityCount(
    runtime.serverBaseUrl,
    projectPath,
  );
  const knownParamsNames = useMemo(
    () => Object.keys(paramsRuntime.params).sort(),
    [paramsRuntime.params],
  );
  const knownRollNames = useMemo(
    () => Object.keys(pianoRollRuntime.rolls).sort(),
    [pianoRollRuntime.rolls],
  );
  const knownAnimationNames = useMemo(
    () => Object.keys(animationRuntime.timelines).sort(),
    [animationRuntime.timelines],
  );
  const knownDrawingNames = useMemo(
    () => Object.keys(drawingsRuntime.drawings).sort(),
    [drawingsRuntime.drawings],
  );
  // Everything a scope can bind to, in the one syntax the input accepts: signal
  // names as they are, param leaves as `params:<name>.<field>`. Ended signals
  // stay listed — a stopped run's trace is still worth looking at — but say so.
  const scopeSourceOptions = useMemo(
    () => [
      ...Object.values(signalsRuntime.signals)
        .map((signal) => ({
          value: signal.name,
          label: signal.ended ? `${signal.name} (ended)` : signal.name,
        }))
        .sort((a, b) => a.value.localeCompare(b.value)),
      ...Object.values(paramsRuntime.params)
        .flatMap((entity) =>
          listParamsLeafPaths(entity.values).map((leafPath) => ({
            value: `${PARAMS_ENTITY_TYPE}:${entity.name}.${leafPath}`,
            label: `${PARAMS_ENTITY_TYPE}:${entity.name}.${leafPath}`,
          }))
        )
        .sort((a, b) => a.value.localeCompare(b.value)),
    ],
    [paramsRuntime.params, signalsRuntime.signals],
  );
  const moduleCount = useMemo(() => Object.keys(runtime.modules).length, [
    runtime.modules,
  ]);
  const selectionKey = selection ? `${selection.type} ${selection.name}` : "";

  // Entity actions are ordinary serialized POSTs; a rejection is the server's
  // wording, shown in the topbar rather than thrown away.
  const runEntityAction = useCallback(async (action: () => Promise<void>) => {
    setEntityError(null);
    try {
      await action();
      return true;
    } catch (error) {
      console.error("[livecode-tldraw] entity action failed", error);
      setEntityError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, []);

  // A new selection is a new subject: never carry a prefilled duplicate name or
  // an armed delete across it.
  useEffect(() => {
    setDuplicateDraft(null);
    setDeleteArmedName(null);
  }, [selectionKey]);

  useEffect(() => {
    if (deleteArmedName === null) return;
    const timer = window.setTimeout(() => setDeleteArmedName(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [deleteArmedName]);

  const dependencyIssueCount = runtime.projectDiagnostics?.modules.filter((
    moduleEntry,
  ) => moduleEntry.hasDependencyWarnings).length ?? 0;
  const changedDependencyCount = runtime.projectDiagnostics?.modules.filter((
    moduleEntry,
  ) => moduleEntry.changedDependencies.length > 0).length ?? 0;

  return (
    <div
      className="topbar"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <strong className="topbar__brand">Livecode</strong>

      <div className="topbar__actions">
        <details className="topbar__menu" name="livecode-topbar-menu">
          <summary>Server</summary>
          <div className="topbar__panel">
            <label htmlFor="server-url">Server URL</label>
            <input
              id="server-url"
              value={runtime.serverBaseUrl}
              onChange={(event) =>
                runtime.setServerBaseUrl(event.currentTarget.value)}
              spellCheck={false}
            />
            <button
              type="button"
              disabled={runtime.connectionStatus === "connecting"}
              onClick={() =>
                runtime.connectionStatus === "open"
                  ? runtime.disconnect()
                  : void runtime.connect()}
            >
              {runtime.connectionStatus === "open" ? "Disconnect" : "Connect"}
            </button>
          </div>
        </details>

        <details className="topbar__menu" name="livecode-topbar-menu">
          <summary>Canvas</summary>
          <div className="topbar__panel topbar__panel--stack">
            <button
              type="button"
              disabled={!editor}
              onClick={() => {
                if (editor) createDefaultLivecodeCanvas(editor);
              }}
            >
              New canvas
            </button>
            <button
              type="button"
              disabled={!editor}
              onClick={() => fileInputRef.current?.click()}
            >
              Open .tldr
            </button>
            <button
              type="button"
              disabled={!editor}
              onClick={() => {
                if (editor) void saveTldrawCanvas(editor);
              }}
            >
              Save .tldr
            </button>
          </div>
        </details>
        <input
          ref={fileInputRef}
          type="file"
          accept=".tldr,application/json"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (editor && file) {
              void onOpenTldrawFile(file).catch((error) => {
                console.error(
                  "[livecode-tldraw] failed to open .tldr file",
                  error,
                );
              });
            }
          }}
        />

        <details className="topbar__menu" name="livecode-topbar-menu">
          <summary>Add</summary>
          <div className="topbar__panel topbar__panel--stack">
            <button
              type="button"
              disabled={!editor}
              onClick={() => {
                if (editor) createLivecodeShape(editor);
              }}
            >
              New module
            </button>
            <EntityViewCreator
              editor={editor}
              buttonLabel="New piano roll"
              submitLabel="Add roll"
              placeholder="piano roll name"
              datalistId="topbar-roll-names"
              knownNames={knownRollNames}
              onAdd={(name) =>
                runEntityAction(async () => {
                  if (!knownRollNames.includes(name)) {
                    await createEntity(
                      runtime.serverBaseUrl,
                      PIANO_ROLL_ENTITY_TYPE,
                      name,
                    );
                  }
                  if (editor) {
                    createEntityView(editor, PIANO_ROLL_ENTITY_TYPE, name);
                  }
                })}
            />
            <EntityViewCreator
              editor={editor}
              buttonLabel="New params pane"
              submitLabel="Add pane"
              placeholder="params name"
              datalistId="topbar-params-names"
              knownNames={knownParamsNames}
              initialName={knownParamsNames[0] ?? ""}
              onAdd={async (name) => {
                if (!editor) return false;
                createEntityView(editor, PARAMS_ENTITY_TYPE, name);
                return true;
              }}
            />
            <EntityViewCreator
              editor={editor}
              buttonLabel="New animation"
              submitLabel="Add animation"
              placeholder="animation name"
              datalistId="topbar-animation-names"
              knownNames={knownAnimationNames}
              onAdd={(name) =>
                runEntityAction(async () => {
                  if (!knownAnimationNames.includes(name)) {
                    await createEntity(
                      runtime.serverBaseUrl,
                      ANIMATION_TIMELINE_ENTITY_TYPE,
                      name,
                    );
                  }
                  if (editor) {
                    createEntityView(
                      editor,
                      ANIMATION_TIMELINE_ENTITY_TYPE,
                      name,
                    );
                  }
                })}
            />
            <EntityViewCreator
              editor={editor}
              buttonLabel="New drawing"
              submitLabel="Add drawing"
              placeholder="drawing name"
              datalistId="topbar-drawing-names"
              knownNames={knownDrawingNames}
              onAdd={(name) =>
                runEntityAction(async () => {
                  if (!knownDrawingNames.includes(name)) {
                    await createEntity(
                      runtime.serverBaseUrl,
                      DRAWING_ENTITY_TYPE,
                      name,
                    );
                  }
                  if (editor) {
                    createEntityView(editor, DRAWING_ENTITY_TYPE, name);
                  }
                })}
            />
            {scopeDraft === null
              ? (
                <button
                  type="button"
                  disabled={!editor}
                  onClick={() => setScopeDraft("")}
                >
                  New scope
                </button>
              )
              : (
                <form
                  className="topbar__group"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const source = parseScopeSource(
                      scopeDraft,
                      Object.keys(signalsRuntime.signals),
                    );
                    if (!editor || !source) return;
                    createSignalScopeShape(editor, source);
                    setScopeDraft(null);
                  }}
                >
                  <input
                    autoFocus
                    list="topbar-scope-sources"
                    placeholder="signal name or params:name.field"
                    value={scopeDraft}
                    spellCheck={false}
                    onChange={(event) =>
                      setScopeDraft(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setScopeDraft(null);
                    }}
                  />
                  <datalist id="topbar-scope-sources">
                    {scopeSourceOptions.map((option) => (
                      <option
                        key={option.value}
                        value={option.value}
                        label={option.label}
                      />
                    ))}
                  </datalist>
                  <button
                    type="submit"
                    disabled={!editor || !scopeDraft.trim()}
                  >
                    Add scope
                  </button>
                  <button type="button" onClick={() => setScopeDraft(null)}>
                    Cancel
                  </button>
                </form>
              )}
            {canvasSurfaceDraft === null
              ? (
                <button
                  type="button"
                  disabled={!editor}
                  onClick={() => setCanvasSurfaceDraft("")}
                >
                  New canvas view
                </button>
              )
              : (
                <form
                  className="topbar__group"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const surfaceName = canvasSurfaceDraft.trim();
                    if (!editor || !surfaceName) return;
                    createCanvasSurfaceShape(editor, { surfaceName });
                    setCanvasSurfaceDraft(null);
                  }}
                >
                  <input
                    autoFocus
                    list="topbar-canvas-surfaces"
                    placeholder="canvasSurface name"
                    value={canvasSurfaceDraft}
                    spellCheck={false}
                    onChange={(event) =>
                      setCanvasSurfaceDraft(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setCanvasSurfaceDraft(null);
                    }}
                  />
                  <datalist id="topbar-canvas-surfaces">
                    {listCanvasSurfaceNames().map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                  <button
                    type="submit"
                    disabled={!editor || !canvasSurfaceDraft.trim()}
                  >
                    Add canvas view
                  </button>
                  <button
                    type="button"
                    onClick={() => setCanvasSurfaceDraft(null)}
                  >
                    Cancel
                  </button>
                </form>
              )}
          </div>
        </details>

        {selection
          ? (
            <details className="topbar__menu" name="livecode-topbar-menu">
              <summary>Entity</summary>
              <div className="topbar__panel topbar__panel--stack">
                <span className="topbar__selection-name">
                  {selection.type}: {selection.name}
                </span>
                {duplicateDraft === null
                  ? (
                    <button
                      type="button"
                      onClick={() =>
                        setDuplicateDraft(`${selection.name}-copy`)}
                    >
                      Duplicate entity
                    </button>
                  )
                  : (
                    <form
                      className="topbar__group"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const targetName = duplicateDraft.trim();
                        if (!editor || !targetName) return;
                        void runEntityAction(async () => {
                          await duplicateEntity(
                            runtime.serverBaseUrl,
                            selection.type,
                            selection.name,
                            targetName,
                          );
                          createAdjacentEntityView(
                            editor,
                            selection.type,
                            targetName,
                          );
                          setDuplicateDraft(null);
                        });
                      }}
                    >
                      <input
                        autoFocus
                        placeholder={`copy of ${selection.name}`}
                        value={duplicateDraft}
                        spellCheck={false}
                        onChange={(event) =>
                          setDuplicateDraft(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setDuplicateDraft(null);
                        }}
                      />
                      <button
                        type="submit"
                        disabled={!editor || !duplicateDraft.trim()}
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        onClick={() => setDuplicateDraft(null)}
                      >
                        Cancel
                      </button>
                    </form>
                  )}
                <button
                  type="button"
                  className="topbar__danger"
                  onClick={() => {
                    if (deleteArmedName !== selection.name) {
                      setDeleteArmedName(selection.name);
                      return;
                    }
                    setDeleteArmedName(null);
                    void runEntityAction(async () => {
                      await deleteEntity(
                        runtime.serverBaseUrl,
                        selection.type,
                        selection.name,
                      );
                    });
                  }}
                >
                  {deleteArmedName === selection.name
                    ? `Really delete ${selection.name}?`
                    : "Delete entity"}
                </button>
              </div>
            </details>
          )
          : null}

        {isBakedServerBaseUrl(runtime.serverBaseUrl)
          ? (
            <button
              type="button"
              className="topbar__primary"
              onClick={() => {
                setSaveNotice(null);
                void runEntityAction(async () => {
                  setSaveNotice(await exportBakedDataFile());
                });
              }}
            >
              Export data
            </button>
          )
          : null}

        {projectPath
          ? (
            <div className="topbar__save">
              <button
                type="button"
                className="topbar__primary"
                disabled={!editor}
                onClick={() => {
                  setSaveNotice(null);
                  void runEntityAction(async () => {
                    if (!editor) throw new Error("No canvas is mounted yet");
                    setSaveNotice(describeProjectSave(
                      await saveProjectWithCanvas(
                        editor,
                        runtime.serverBaseUrl,
                      ),
                    ));
                  });
                }}
              >
                Save project
              </button>
              {unsavedCount === null ? null : (
                <span
                  className={`status-pill status-pill--${
                    unsavedCount > 0 ? "unsaved" : "saved"
                  }`}
                >
                  {unsavedCount > 0 ? `${unsavedCount} unsaved` : "saved"}
                </span>
              )}
            </div>
          )
          : null}
      </div>

      <div className="topbar__status">
        <InProcessEnginePill />
        <span
          className={`status-pill status-pill--${runtime.connectionStatus}`}
        >
          {runtime.connectionStatus}
        </span>
        <span className={`status-pill status-pill--${runtime.lspStatus}`}>
          lsp: {runtime.lspStatus}
        </span>
        <span className="topbar__secondary-status">{moduleCount} modules</span>
        {changedDependencyCount > 0
          ? <span>{changedDependencyCount} dependency updates</span>
          : null}
        {dependencyIssueCount > 0
          ? (
            <span className="topbar__error">
              {dependencyIssueCount} dependency issues
            </span>
          )
          : null}
        {runtime.projectDiagnosticsError
          ? (
            <span className="topbar__error">
              diagnostics: {runtime.projectDiagnosticsError}
            </span>
          )
          : null}
        {runtime.connectionError
          ? <span className="topbar__error">{runtime.connectionError}</span>
          : null}
        {entityError
          ? <span className="topbar__error">{entityError}</span>
          : null}
        {saveNotice
          ? <span className="topbar__notice">{saveNotice}</span>
          : null}
      </div>
    </div>
  );
}

function EntityViewCreator({
  editor,
  buttonLabel,
  submitLabel,
  placeholder,
  datalistId,
  knownNames,
  initialName = "",
  onAdd,
}: {
  editor: Editor | null;
  buttonLabel: string;
  submitLabel: string;
  placeholder: string;
  datalistId: string;
  knownNames: string[];
  initialName?: string;
  onAdd(name: string): Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  if (draft === null) {
    return (
      <button
        type="button"
        disabled={!editor}
        onClick={() => setDraft(initialName)}
      >
        {buttonLabel}
      </button>
    );
  }

  return (
    <form
      className="topbar__group"
      onSubmit={(event) => {
        event.preventDefault();
        const name = draft.trim();
        if (!editor || !name || submitting) return;
        setSubmitting(true);
        void onAdd(name).then((ok) => {
          if (ok) setDraft(null);
        }).finally(() => setSubmitting(false));
      }}
    >
      <input
        autoFocus
        list={datalistId}
        placeholder={placeholder}
        value={draft}
        spellCheck={false}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setDraft(null);
        }}
      />
      <datalist id={datalistId}>
        {knownNames.map((name) => <option key={name} value={name} />)}
      </datalist>
      <button type="submit" disabled={!editor || !draft.trim() || submitting}>
        {submitLabel}
      </button>
      <button type="button" onClick={() => setDraft(null)}>
        Cancel
      </button>
    </form>
  );
}

/**
 * The durable entity the single selected view addresses, or null. Reactive
 * through tldraw's own signals: `useValue` recomputes only when the selection
 * (or the selected view's entity name) changes, and both halves are primitives
 * so an unrelated shape edit never re-renders the topbar.
 */
function useSelectedEntity(editor: Editor | null): DurableEntityRef | null {
  const type = useValue(
    "selected entity type",
    () => selectedEntityRef(editor)?.type ?? null,
    [editor],
  );
  const name = useValue(
    "selected entity name",
    () => selectedEntityRef(editor)?.name ?? null,
    [editor],
  );
  return type && name ? { type, name } : null;
}

function selectedEntityRef(editor: Editor | null): DurableEntityRef | null {
  return entityRefForCanvasView(editor?.getOnlySelectedShape());
}

/**
 * What the "New scope" input accepts, in one function so the datalist and the
 * typed form agree: `params:<name>.<field...>` binds one durable param leaf,
 * anything else is a signal name. A signal name that is already known is taken
 * whole (names may contain dots); an unknown one splits at its first dot, so a
 * field of an object-valued signal can be bound before it is published.
 */
function parseScopeSource(
  text: string,
  knownSignalNames: string[],
): { sourceType: SignalScopeSourceType; name: string; path: string } | null {
  // The datalist labels ended signals; accept the label back as the name.
  const trimmed = text.trim().replace(/\s*\(ended\)$/, "");
  if (!trimmed) return null;

  const paramsPrefix = `${PARAMS_ENTITY_TYPE}:`;
  if (trimmed.startsWith(paramsPrefix)) {
    const [name, ...pathParts] = trimmed.slice(paramsPrefix.length).split(".");
    if (!name) return null;
    return { sourceType: "params", name, path: pathParts.join(".") };
  }

  const signalText = trimmed.startsWith("signal:")
    ? trimmed.slice("signal:".length)
    : trimmed;
  if (!signalText) return null;
  if (knownSignalNames.includes(signalText)) {
    return { sourceType: "signal", name: signalText, path: "" };
  }
  const [name, ...pathParts] = signalText.split(".");
  if (!name) return null;
  return { sourceType: "signal", name, path: pathParts.join(".") };
}

/** Dot-joined paths of every numeric leaf, for the scope datalist. */
function listParamsLeafPaths(values: unknown, prefix = ""): string[] {
  if (typeof values !== "object" || values === null) return [];
  const paths: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const leafPath = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "number") {
      paths.push(leafPath);
    } else if (typeof value === "object" && value !== null) {
      paths.push(...listParamsLeafPaths(value, leafPath));
    }
  }
  return paths;
}

function describeProjectSave(result: ProjectSaveResponse): string {
  const failed = result.data.filter((entry) => !entry.ok);
  for (const entry of failed) {
    console.error(
      `[livecode-tldraw] ${entry.type} "${entry.name}" failed to save: ${entry.error}`,
    );
  }
  for (const entry of result.skipped) {
    console.warn(
      `[livecode-tldraw] ${entry.type} "${entry.name}" skipped by save: ${entry.reason}`,
    );
  }
  return [
    `saved ${result.data.length - failed.length}`,
    failed.length > 0 ? `${failed.length} failed` : null,
    result.skipped.length > 0 ? `${result.skipped.length} skipped` : null,
  ].filter((part) => part !== null).join(" | ");
}

/**
 * Unsaved durable entities from `/project/status`, polled while a project is
 * open (the same gate as the canvas collector). Purely informational: nothing
 * here ever writes.
 */
function useUnsavedEntityCount(
  serverBaseUrl: string,
  projectPath: string | null,
) {
  const [unsavedCount, setUnsavedCount] = useState<number | null>(null);

  useEffect(() => {
    if (!projectPath) {
      setUnsavedCount(null);
      return;
    }
    let cancelled = false;
    const poll = () => {
      fetchProjectStatus(serverBaseUrl)
        .then((status) => {
          if (cancelled) return;
          setUnsavedCount(status.data.filter((entry) => entry.unsaved).length);
        })
        .catch(() => {
          if (!cancelled) setUnsavedCount(null);
        });
    };
    poll();
    const timer = window.setInterval(poll, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [projectPath, serverBaseUrl]);

  return unsavedCount;
}

/**
 * Where the engine is when it is THIS tab (`engine=inprocess`): running,
 * blocked by another tab on the origin (with the same takeover the engine
 * page offers), stopped, or never loaded. Absent in every other topology.
 */
function InProcessEnginePill() {
  const state = useInProcessEngineState();
  if (state.phase === "off") return null;
  if (state.phase === "loading") {
    return (
      <span className="status-pill status-pill--connecting">
        engine: loading…
      </span>
    );
  }
  if (state.phase === "failed") {
    return (
      <span className="status-pill status-pill--error" title={state.error}>
        engine: unavailable
      </span>
    );
  }
  const { status, serverless } = state;
  const midiTitle = status.midi ?? undefined;
  switch (status.lock) {
    case "engine":
      return (
        <span
          className={`status-pill status-pill--${
            serverless || status.uplinkOpen ? "running" : "connecting"
          }`}
          title={midiTitle}
        >
          {serverless || status.uplinkOpen
            ? "engine: this tab"
            : "engine: this tab (attaching to server…)"}
        </span>
      );
    case "blocked":
      return (
        <span
          className="status-pill status-pill--unknown status-pill--engine-blocked"
          title={status.message}
        >
          engine: another tab
          <button
            type="button"
            className="livecode-engine-takeover"
            onClick={() => {
              void inProcessEngineHost().then((host) => host.takeover());
            }}
          >
            Take over
          </button>
        </span>
      );
    case "takenOver":
    case "stopped":
      return (
        <span className="status-pill status-pill--error" title={status.message}>
          engine: stopped
        </span>
      );
    default:
      return (
        <span className="status-pill status-pill--connecting">
          engine: starting…
        </span>
      );
  }
}
