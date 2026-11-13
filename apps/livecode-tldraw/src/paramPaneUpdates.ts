import type { ParamsMeta, ParamsPrimitive, ParamsValues } from '@avtools/livecode-protocol'

export interface ParamPaneLayoutSnapshot {
  values: ParamsValues | null | undefined
  meta: ParamsMeta | undefined
  token: object
}

export interface ParamValueEntry {
  path: readonly string[]
  key: string
  target: ParamsValues
  localRev: number
}

/** Retain the effect dependency while the existing Tweakpane controls still fit. */
export function retainParamPaneLayout(
  previous: ParamPaneLayoutSnapshot | null,
  values: ParamsValues | null | undefined,
  meta: ParamsMeta | undefined,
): ParamPaneLayoutSnapshot {
  const token = previous &&
      sameValueLayout(previous.values, values) &&
      sameJsonValue(previous.meta, meta)
    ? previous.token
    : {}
  return { values, meta, token }
}

/**
 * Copy accepted truth into the pane draft and refresh only controls whose
 * displayed value changed. Graph bindings poll the same draft separately.
 */
export function applyChangedParamValues<T extends ParamValueEntry>(
  entries: readonly T[],
  values: ParamsValues,
  rev: number,
  shouldSkip: (entry: T) => boolean,
  refresh: (entry: T) => void,
): number {
  let refreshed = 0
  for (const entry of entries) {
    if (shouldSkip(entry) || rev <= entry.localRev) continue
    const value = readLeaf(values, entry.path)
    if (!isParamsPrimitive(value)) continue
    if (Object.is(entry.target[entry.key], value)) continue
    entry.target[entry.key] = value
    refresh(entry)
    refreshed += 1
  }
  return refreshed
}

function sameValueLayout(
  previous: ParamsValues | null | undefined,
  next: ParamsValues | null | undefined,
): boolean {
  if (previous === next) return true
  if (!previous || !next) return false
  const previousKeys = Object.keys(previous)
  const nextKeys = Object.keys(next)
  if (previousKeys.length !== nextKeys.length) return false
  for (const key of previousKeys) {
    if (!Object.hasOwn(next, key)) return false
    const previousValue = previous[key]
    const nextValue = next[key]
    const previousObject = isPlainObject(previousValue)
    if (previousObject !== isPlainObject(nextValue)) return false
    if (previousObject) {
      if (!sameValueLayout(previousValue, nextValue as ParamsValues)) return false
    } else if (valueKind(previousValue) !== valueKind(nextValue)) return false
  }
  return true
}

function valueKind(value: unknown): string {
  return value === null ? 'null' : typeof value
}

function sameJsonValue(previous: unknown, next: unknown): boolean {
  if (Object.is(previous, next)) return true
  if (Array.isArray(previous) || Array.isArray(next)) {
    if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length) {
      return false
    }
    return previous.every((value, index) => sameJsonValue(value, next[index]))
  }
  if (!isPlainRecord(previous) || !isPlainRecord(next)) return false
  const previousKeys = Object.keys(previous)
  const nextKeys = Object.keys(next)
  if (previousKeys.length !== nextKeys.length) return false
  return previousKeys.every((key) =>
    Object.hasOwn(next, key) && sameJsonValue(previous[key], next[key])
  )
}

function readLeaf(values: ParamsValues, path: readonly string[]): unknown {
  let node: unknown = values
  for (const key of path) {
    if (!isPlainRecord(node)) return undefined
    node = node[key]
  }
  return node
}

function isParamsPrimitive(value: unknown): value is ParamsPrimitive {
  return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'
}

function isPlainObject(value: unknown): value is ParamsValues {
  return isPlainRecord(value) && !Array.isArray(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
