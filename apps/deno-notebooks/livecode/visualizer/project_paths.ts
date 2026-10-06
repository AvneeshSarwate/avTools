// Project-relative path rules shared by the coordination server and the
// standalone project checker: a manifest module names its runtime path, and
// its canonical source is the paired `*.orig.ts`.

import { basename, isAbsolute, normalize } from "jsr:@std/path@1";
import type { ProjectModuleRecord } from "./protocol.ts";

export const SOURCE_SUFFIX = ".orig.ts";

export function normalizeProjectModuleRecord(
  moduleRecord: ProjectModuleRecord,
): ProjectModuleRecord {
  const runtimePath = normalizeProjectRuntimePath(
    moduleRecord.runtimePath ?? moduleRecord.path,
  );
  const sourcePath = moduleRecord.sourcePath
    ? normalizeProjectSourcePath(moduleRecord.sourcePath)
    : sourcePathForRuntimePath(runtimePath);
  return {
    ...moduleRecord,
    path: runtimePath,
    runtimePath,
    sourcePath,
    sourceVersion: moduleRecord.sourceVersion ?? 1,
    kind: "runnable",
    title: moduleRecord.title ?? basename(runtimePath, ".ts"),
  };
}

export function normalizeProjectRelativePath(path: string): string {
  return normalizeProjectPath(path, ".ts", "Project module");
}

/** Same relative/inside-project/no-NUL rules as modules, for data files. */
export function normalizeProjectDataPath(path: string): string {
  return normalizeProjectPath(path, ".json", "Project data");
}

export function normalizeProjectPath(
  path: string,
  suffix: string,
  label: string,
): string {
  if (!path || path.includes("\0")) {
    throw new Error(`${label} path is required`);
  }
  if (path.startsWith("file:") || isAbsolute(path)) {
    throw new Error(`${label} paths must be relative`);
  }
  const normalized = normalize(path).replaceAll("\\", "/");
  if (
    normalized === "." || normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(`${label} paths must stay inside the project`);
  }
  if (!normalized.endsWith(suffix)) {
    throw new Error(`${label} paths must end in ${suffix}`);
  }
  return normalized;
}

export function normalizeProjectRuntimePath(path: string): string {
  const normalized = normalizeProjectRelativePath(path);
  if (normalized.endsWith(SOURCE_SUFFIX)) {
    return `${normalized.slice(0, -SOURCE_SUFFIX.length)}.ts`;
  }
  return normalized;
}

export function normalizeProjectSourcePath(path: string): string {
  const normalized = normalizeProjectRelativePath(path);
  if (normalized.endsWith(SOURCE_SUFFIX)) return normalized;
  return sourcePathForRuntimePath(normalized);
}

export function sourcePathForRuntimePath(runtimePath: string): string {
  const normalized = normalizeProjectRelativePath(runtimePath);
  if (normalized.endsWith(SOURCE_SUFFIX)) return normalized;
  return `${normalized.slice(0, -".ts".length)}${SOURCE_SUFFIX}`;
}
