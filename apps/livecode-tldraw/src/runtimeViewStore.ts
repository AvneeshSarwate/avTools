import type { ProjectShadowCheckResponse } from "./livecodeProtocol";
import type { LivecodeRuntimeApi, ModuleViewState } from "./livecodeRuntime";

type Listener = () => void;

/** A module consumer observes its diagnostic rows, not global check timestamps/results. */
type ModuleProjectDiagnostics = Pick<
  ProjectShadowCheckResponse,
  "modules" | "diagnostics" | "edges"
>;
export type ScopedRuntimeApi = Omit<
  LivecodeRuntimeApi,
  "projectDiagnostics"
> & {
  projectDiagnostics: ModuleProjectDiagnostics | null;
};

const EMPTY_MODULES: Record<string, ModuleViewState> = Object.freeze({});
const EMPTY_LSP_DIAGNOSTICS: LivecodeRuntimeApi["lspDiagnosticsByUri"] =
  Object.freeze({});

/** Stable external store for broad and module/document-scoped runtime views. */
export class RuntimeViewStore {
  private current: LivecodeRuntimeApi | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly selected = new Map<
    string,
    {
      snapshot: ScopedRuntimeApi;
      projectInput: ProjectShadowCheckResponse | null;
      projectModulePath: string | undefined;
    }
  >();
  private readonly subscriptionsByKey = new Map<string, number>();

  initialize(value: LivecodeRuntimeApi): void {
    if (this.current === null) this.current = value;
  }

  publish(value: LivecodeRuntimeApi): void {
    if (Object.is(this.current, value)) return;
    this.current = value;
    for (const key of this.selected.keys()) {
      if (!this.subscriptionsByKey.has(key)) this.selected.delete(key);
    }
    for (const listener of this.listeners) listener();
  }

  subscribe(
    listener: Listener,
    moduleId?: string,
    documentUri?: string,
  ): () => void {
    this.listeners.add(listener);
    const key = selectionKey(moduleId, documentUri);
    if (key) {
      this.subscriptionsByKey.set(
        key,
        (this.subscriptionsByKey.get(key) ?? 0) + 1,
      );
    }
    return () => {
      this.listeners.delete(listener);
      if (!key) return;
      const remaining = (this.subscriptionsByKey.get(key) ?? 1) - 1;
      if (remaining > 0) {
        this.subscriptionsByKey.set(key, remaining);
      } else {
        this.subscriptionsByKey.delete(key);
        this.selected.delete(key);
      }
    };
  }

  getSnapshot(): LivecodeRuntimeApi;
  getSnapshot(
    moduleId: string | undefined,
    documentUri?: string,
  ): ScopedRuntimeApi;
  getSnapshot(moduleId?: string, documentUri?: string): ScopedRuntimeApi {
    const current = this.current;
    if (!current) throw new Error("RuntimeViewStore is not initialized");
    if (moduleId === undefined && documentUri === undefined) return current;

    const key = selectionKey(moduleId, documentUri)!;
    const entry = this.selected.get(key);
    const prior = entry?.snapshot;
    const modules = selectOne(
      current.modules,
      moduleId,
      prior?.modules,
      EMPTY_MODULES,
    );
    const lspDiagnosticsByUri = selectOne(
      current.lspDiagnosticsByUri,
      documentUri,
      prior?.lspDiagnosticsByUri,
      EMPTY_LSP_DIAGNOSTICS,
      jsonEqual,
    );
    const projectModulePath =
      moduleId === undefined ? undefined : modules[moduleId]?.projectModulePath;
    const projectDiagnostics =
      moduleId === undefined
        ? current.projectDiagnostics
        : entry?.projectInput === current.projectDiagnostics &&
            entry.projectModulePath === projectModulePath
          ? prior!.projectDiagnostics
          : scopeProjectDiagnostics(
              current.projectDiagnostics,
              moduleId,
              projectModulePath,
              prior?.projectDiagnostics,
            );
    const next: ScopedRuntimeApi = {
      ...current,
      modules,
      lspDiagnosticsByUri,
      projectDiagnostics,
    };
    const snapshot = prior && shallowEqualApi(prior, next) ? prior : next;
    this.selected.set(key, {
      snapshot,
      projectInput: current.projectDiagnostics,
      projectModulePath,
    });
    return snapshot;
  }
}

function selectionKey(moduleId?: string, documentUri?: string): string | null {
  if (moduleId === undefined && documentUri === undefined) return null;
  return `${moduleId ?? "\u0000"}\u0001${documentUri ?? "\u0000"}`;
}

function selectOne<T>(
  values: Record<string, T>,
  name: string | undefined,
  prior: Record<string, T> | undefined,
  empty: Record<string, T>,
  equal: (left: T, right: T) => boolean = Object.is,
): Record<string, T> {
  if (name === undefined) return values;
  const value = values[name];
  if (value === undefined) return empty;
  if (prior?.[name] !== undefined && equal(prior[name], value)) return prior;
  return { [name]: value };
}

function scopeProjectDiagnostics(
  diagnostics: ProjectShadowCheckResponse | null,
  moduleId: string,
  projectModulePath: string | undefined,
  prior: ModuleProjectDiagnostics | null | undefined,
): ModuleProjectDiagnostics | null {
  if (!diagnostics) return null;
  const next = {
    modules: diagnostics.modules.filter((entry) => entry.moduleId === moduleId),
    diagnostics: diagnostics.diagnostics.filter(
      (entry) =>
        entry.moduleId === moduleId ||
        (projectModulePath !== undefined && entry.path === projectModulePath),
    ),
    edges: diagnostics.edges.filter(
      (edge) => edge.fromModuleId === moduleId || edge.toModuleId === moduleId,
    ),
  };
  return prior && projectScopeEqual(prior, next) ? prior : next;
}

function projectScopeEqual(
  left: ModuleProjectDiagnostics,
  right: ModuleProjectDiagnostics,
): boolean {
  return (
    jsonEqual(left.modules, right.modules) &&
    jsonEqual(left.diagnostics, right.diagnostics) &&
    jsonEqual(left.edges, right.edges)
  );
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return (
    Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right)
  );
}

function shallowEqualApi(
  left: ScopedRuntimeApi,
  right: ScopedRuntimeApi,
): boolean {
  for (const key of Object.keys(right) as Array<keyof ScopedRuntimeApi>) {
    if (!Object.is(left[key], right[key])) return false;
  }
  return true;
}
