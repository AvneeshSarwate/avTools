/**
 * Project-owned UI: a project may carry `ui/index.tsx`, ordinary code in its
 * own directory that exports tldraw shape utils built with `@livecode-ui`.
 * The UI dev server compiles it against the app's own React and tldraw (one
 * instance of each, HMR included), so the file is imported straight from the
 * page's origin under Vite's `/@fs/` prefix.
 *
 * It is a project library by the platform's rules: no manifest entry, no
 * analyzer pass, no Deno check. Registering a new shape type after `<Tldraw>`
 * has mounted is not possible, so the entry is loaded before the editor
 * mounts, and a changed shape class needs a tab reload (the engine holds all
 * state, so a UI reload loses nothing).
 */
import type { TLAnyShapeUtilConstructor } from "tldraw";

export const PROJECT_UI_ENTRY = "ui/index.tsx";

export interface ProjectUiState {
  /** "none": the project has no UI entry. */
  status: "none" | "loaded" | "failed";
  entryUrl: string | null;
  shapeTypes: string[];
  error: string | null;
  /** Saved project shapes whose type no loaded util defines, by type. */
  unrestoredTypes: string[];
}

interface ProjectUiModule {
  shapeUtils?: unknown;
}

let state: ProjectUiState = {
  status: "none",
  entryUrl: null,
  shapeTypes: [],
  error: null,
  unrestoredTypes: [],
};
const registeredTypes = new Set<string>();

export function getProjectUiState(): ProjectUiState {
  return { ...state, shapeTypes: [...state.shapeTypes] };
}

export function isProjectShapeType(type: string): boolean {
  return registeredTypes.has(type);
}

export function recordUnrestoredProjectShapeTypes(types: string[]): void {
  const merged = new Set([...state.unrestoredTypes, ...types]);
  state = { ...state, unrestoredTypes: [...merged].sort() };
}

/** The project directory behind a `projectPath` URL parameter (a root or its manifest). */
export function projectRootFromPath(projectPath: string): string {
  const trimmed = projectPath.trim().replace(/\/+$/, "");
  return trimmed.endsWith(".json")
    ? trimmed.slice(0, trimmed.lastIndexOf("/"))
    : trimmed;
}

export function projectUiEntryUrl(projectRoot: string): string {
  const root = projectRoot.startsWith("/") ? projectRoot : `/${projectRoot}`;
  return new URL(`/@fs${root}/${PROJECT_UI_ENTRY}`, window.location.href).href;
}

/**
 * Load the project's UI entry, if it has one. Never throws: a missing entry
 * is "none", anything else that goes wrong is "failed" with the message, and
 * the app carries on with its built-in shapes either way. `builtinTypes` are
 * refused so a project cannot shadow a built-in view.
 */
export async function loadProjectUi(
  projectPath: string,
  builtinTypes: readonly string[],
): Promise<TLAnyShapeUtilConstructor[]> {
  const entryUrl = projectUiEntryUrl(projectRootFromPath(projectPath));
  registeredTypes.clear();
  state = {
    status: "none",
    entryUrl,
    shapeTypes: [],
    error: null,
    unrestoredTypes: [],
  };
  const fail = (error: string) => {
    state = { ...state, status: "failed", error };
    console.error(`[livecode-tldraw] project UI ${entryUrl}: ${error}`);
    return [];
  };

  // A probe first: a dynamic import reports a missing file and a compile
  // error identically ("failed to fetch"), and only the second is worth
  // telling the user about.
  let probe: Response;
  try {
    probe = await fetch(entryUrl, { cache: "no-store" });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  if (probe.status === 404) return [];
  if (!probe.ok) {
    return fail(`${probe.status} ${await probe.text().catch(() => "")}`.trim());
  }

  let module: ProjectUiModule;
  try {
    module = await import(/* @vite-ignore */ entryUrl) as ProjectUiModule;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  const utils = module.shapeUtils;
  if (!Array.isArray(utils)) {
    return fail("ui/index.tsx must export `shapeUtils`, an array of shape utils");
  }
  const accepted: TLAnyShapeUtilConstructor[] = [];
  for (const candidate of utils) {
    const type = (candidate as { type?: unknown })?.type;
    if (typeof candidate !== "function" || typeof type !== "string" || !type) {
      return fail("every entry in `shapeUtils` must be a shape util class with a static `type`");
    }
    if (builtinTypes.includes(type)) {
      return fail(`shape type "${type}" is a built-in view and cannot be redefined`);
    }
    if (registeredTypes.has(type)) {
      return fail(`shape type "${type}" is exported twice`);
    }
    registeredTypes.add(type);
    accepted.push(candidate as TLAnyShapeUtilConstructor);
  }
  state = { ...state, status: "loaded", shapeTypes: [...registeredTypes] };
  return accepted;
}
