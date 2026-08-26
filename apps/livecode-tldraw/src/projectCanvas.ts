import { type Editor, parseTldrawJsonFile, serializeTldrawJson } from "tldraw";
import {
  createLivecodeShape,
  LIVECODE_EDITOR_SHAPE_TYPE,
  type LivecodeEditorShape,
} from "./LivecodeEditorShape";
import type {
  BakedProjectFile,
  ProjectCurrentResponse,
  ProjectModuleSourceResponse,
} from "./livecodeProtocol";
import { createEntityView, restoreCanvasViews } from "./canvasViews";
import { captureBakedEntities, PIANO_ROLL_ENTITY_TYPE } from "./serverRequests";

const TLDR_MIME_TYPE = "application/vnd.tldraw+json";

export function hasLivecodeShapes(editor: Editor): boolean {
  return editor.getCurrentPageShapes().some((shape) =>
    shape.type === LIVECODE_EDITOR_SHAPE_TYPE
  );
}

export function isLivecodeShape(
  record: unknown,
): record is LivecodeEditorShape {
  if (!record || typeof record !== "object") return false;
  const candidate = record as { typeName?: unknown; type?: unknown };
  return candidate.typeName === "shape" &&
    candidate.type === LIVECODE_EDITOR_SHAPE_TYPE;
}

export function hasShapeLayoutChanged(
  before: LivecodeEditorShape,
  after: LivecodeEditorShape,
): boolean {
  return before.x !== after.x ||
    before.y !== after.y ||
    before.props.w !== after.props.w ||
    before.props.h !== after.props.h;
}

export function createDefaultLivecodeCanvas(editor: Editor): void {
  const shapes = editor.getCurrentPageShapes();
  if (shapes.length > 0) editor.deleteShapes(shapes.map((shape) => shape.id));
  const moduleId = createLivecodeShape(editor, {
    x: 120,
    y: 120,
    title: "module 1",
  });
  createEntityView(editor, PIANO_ROLL_ENTITY_TYPE, "melody", {
    x: 820,
    y: 120,
  });
  editor.select(moduleId);
  editor.zoomToSelection();
}

export async function saveTldrawCanvas(editor: Editor): Promise<void> {
  const json = await serializeTldrawJson(editor);
  downloadTextFile(
    `livecode-tldraw-${new Date().toISOString().slice(0, 10)}.tldr`,
    json,
    TLDR_MIME_TYPE,
  );
}

export function isBakedServerBaseUrl(serverBaseUrl: string): boolean {
  return serverBaseUrl.trim().replace(/\/+$/, "") === "none";
}

export async function exportBakedDataFile(): Promise<string> {
  const { entities, skippedCount } = await captureBakedEntities();
  const json = JSON.stringify(
    { exportedAt: new Date().toISOString(), data: entities },
    null,
    2,
  ) + "\n";
  downloadTextFile(
    `livecode-data-${
      new Date().toISOString().slice(0, 19).replaceAll(":", "-")
    }.json`,
    json,
    "application/json",
  );
  const noun = entities.length === 1 ? "entity" : "entities";
  const skippedNote = skippedCount > 0 ? ` (${skippedCount} skipped)` : "";
  return `exported ${entities.length} ${noun}${skippedNote}`;
}

export async function loadTldrawCanvasFromFile(
  editor: Editor,
  file: File,
): Promise<void> {
  await loadTldrawCanvasJson(editor, await file.text(), file.name);
}

export async function loadTldrawCanvasFromUrl(
  editor: Editor,
  url: string,
): Promise<void> {
  const resolvedUrl = new URL(url, window.location.href).href;
  const response = await fetch(resolvedUrl);
  if (!response.ok) {
    throw new Error(
      `${resolvedUrl} failed with ${response.status}: ${await response.text()}`,
    );
  }
  await loadTldrawCanvasJson(editor, await response.text(), resolvedUrl);
}

export async function loadProjectIntoCanvas(
  editor: Editor,
  serverBaseUrl: string,
  projectPath: string,
): Promise<void> {
  const baseUrl = serverBaseUrl.trim().replace(/\/+$/, "");
  const currentShapes = editor.getCurrentPageShapes();
  if (currentShapes.length > 0) {
    editor.deleteShapes(currentShapes.map((shape) => shape.id));
  }

  const project = await postJson<ProjectCurrentResponse>(
    `${baseUrl}/project/open`,
    { projectPath },
  );
  const projectRoot = project.project?.root;
  for (const moduleRecord of project.project?.manifest.modules ?? []) {
    const source = await fetchJson<ProjectModuleSourceResponse>(
      `${baseUrl}/project/modules/source?path=${
        encodeURIComponent(moduleRecord.path)
      }`,
    );
    createLivecodeShape(editor, {
      x: moduleRecord.x,
      y: moduleRecord.y,
      w: moduleRecord.w,
      h: moduleRecord.h,
      moduleId: moduleRecord.id,
      projectModulePath: moduleRecord.path,
      projectModuleKind: moduleRecord.kind,
      projectSourceUri: projectRoot
        ? fileUrlFromPath(
          `${projectRoot.replace(/\/+$/, "")}/${source.module.sourcePath}`,
        )
        : undefined,
      title: moduleRecord.title,
      source: source.sourceText,
    });
  }
  restoreCanvasViews(editor, project.project?.manifest.canvas);
}

export async function loadBakedProjectIntoCanvas(
  editor: Editor,
): Promise<void> {
  const baked = await fetchJson<BakedProjectFile>(
    new URL("engine/baked.json", window.location.href).href,
  );
  const currentShapes = editor.getCurrentPageShapes();
  if (currentShapes.length > 0) {
    editor.deleteShapes(currentShapes.map((shape) => shape.id));
  }
  const sourceByModuleId = new Map(
    baked.modules.map((entry) => [entry.moduleId, entry.sourceText]),
  );
  for (const moduleRecord of baked.manifest.modules) {
    createLivecodeShape(editor, {
      x: moduleRecord.x,
      y: moduleRecord.y,
      w: moduleRecord.w,
      h: moduleRecord.h,
      moduleId: moduleRecord.id,
      projectModuleKind: moduleRecord.kind,
      title: moduleRecord.title,
      source: sourceByModuleId.get(moduleRecord.id) ?? "",
      readOnly: true,
    });
  }
  restoreCanvasViews(editor, baked.manifest.canvas);
}

export function fileUrlFromPath(path: string): string {
  return `file://${
    path.split("/").map((part, index) =>
      index === 0 ? "" : encodeURIComponent(part)
    ).join("/")
  }`;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

function downloadTextFile(filename: string, text: string, mimeType: string) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadTldrawCanvasJson(
  editor: Editor,
  json: string,
  label: string,
): Promise<void> {
  const result = parseTldrawJsonFile({ json, schema: editor.store.schema });
  if (!result.ok) {
    throw new Error(`Could not load ${label}: ${result.error.type}`);
  }
  editor.loadSnapshot(result.value.getStoreSnapshot());
  editor.clearHistory();
  const bounds = editor.getCurrentPageBounds();
  if (bounds) editor.zoomToBounds(bounds, { targetZoom: 1, immediate: true });
}
