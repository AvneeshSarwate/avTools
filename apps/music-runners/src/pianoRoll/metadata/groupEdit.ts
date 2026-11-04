// Group editing of note metadata: N JSON documents viewed as one tree whose
// leaves carry a shared / mixed / partial / conflict state, edited through a
// list of path operations applied to every document.
//
// Arrays are atomic leaves. A path that is an object in some documents and a
// non-object in others is a conflict; setting under it replaces the non-object.

export type Path = string[]
export type JsonObject = Record<string, unknown>

export type NodeState =
  // An object wherever present. `have` < count means some documents lack it.
  | { kind: 'object'; have: number }
  // Present in every document with one deep-equal value.
  | { kind: 'shared'; value: unknown }
  // Present in every document with differing values.
  | { kind: 'mixed'; distinct: number }
  // Present in some documents; `value` when those agree.
  | { kind: 'partial'; have: number; value?: unknown }
  // Object in some documents, non-object in others.
  | { kind: 'conflict'; have: number }

export interface GroupNode {
  key: string
  path: Path
  state: NodeState
  children: GroupNode[]
}

export interface GroupSummary {
  count: number
  docs: JsonObject[]
  root: GroupNode
}

export type EditOp =
  | { op: 'set'; path: Path; value: unknown }
  | { op: 'remove'; path: Path }

export interface EditWarning {
  path: Path
  // `overwrites`: documents holding a different value at the path.
  // `replaces`: documents holding a non-object at an ancestor of the path.
  kind: 'overwrites' | 'replaces'
  affected: number
}

export interface EditPlan {
  ops: EditOp[]
  warnings: EditWarning[]
}

// Joined with NUL (as in the original) so keys containing spaces cannot collide.
export const PATH_KEY_SEPARATOR = '\u0000'
export const pathKey = (path: Path) => path.join(PATH_KEY_SEPARATOR)

export const isPlainObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => deepEqual(item, b[index]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a)
    if (keysA.length !== Object.keys(b).length) return false
    return keysA.every((key) => key in b && deepEqual(a[key], b[key]))
  }
  return false
}

export const clone = <T>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value))

export const getAtPath = (doc: unknown, path: Path): unknown => {
  let current = doc
  for (const key of path) {
    if (!isPlainObject(current) || !(key in current)) return undefined
    current = current[key]
  }
  return current
}

const distinctValues = (values: unknown[]): unknown[] => {
  const out: unknown[] = []
  for (const value of values) {
    if (!out.some((seen) => deepEqual(seen, value))) out.push(value)
  }
  return out
}

const buildNode = (key: string, path: Path, values: unknown[], count: number): GroupNode => {
  const objects = values.filter(isPlainObject)
  const have = values.length
  let state: NodeState
  if (objects.length === have) {
    state = { kind: 'object', have }
  } else if (objects.length > 0) {
    state = { kind: 'conflict', have }
  } else {
    const distinct = distinctValues(values)
    if (have === count) {
      state = distinct.length === 1
        ? { kind: 'shared', value: distinct[0] }
        : { kind: 'mixed', distinct: distinct.length }
    } else {
      state = distinct.length === 1
        ? { kind: 'partial', have, value: distinct[0] }
        : { kind: 'partial', have }
    }
  }
  const children: GroupNode[] = []
  if (objects.length > 0) {
    const childKeys: string[] = []
    for (const object of objects) {
      for (const childKey of Object.keys(object)) {
        if (!childKeys.includes(childKey)) childKeys.push(childKey)
      }
    }
    for (const childKey of childKeys) {
      const childValues = objects
        .filter((object) => childKey in object)
        .map((object) => object[childKey])
      children.push(buildNode(childKey, [...path, childKey], childValues, count))
    }
  }
  return { key, path, state, children }
}

export const summarize = (docs: JsonObject[]): GroupSummary => ({
  count: docs.length,
  docs,
  root: buildNode('', [], docs, docs.length)
})

export const findNode = (root: GroupNode, path: Path): GroupNode | null => {
  let node: GroupNode | null = root
  for (const key of path) {
    node = node.children.find((child) => child.key === key) ?? null
    if (!node) return null
  }
  return node
}

/** The object of every leaf shared by all documents; what a raw editor shows. */
export const sharedDocument = (summary: GroupSummary): JsonObject => {
  const build = (node: GroupNode): unknown => {
    if (node.state.kind === 'shared') return clone(node.state.value)
    if (node.state.kind === 'object' && node.state.have === summary.count) {
      const out: JsonObject = {}
      for (const child of node.children) {
        const value = build(child)
        if (value !== undefined) out[child.key] = value
      }
      return out
    }
    return undefined
  }
  return (build(summary.root) as JsonObject | undefined) ?? {}
}

export const planEdit = (summary: GroupSummary, ops: EditOp[]): EditPlan => {
  const warnings: EditWarning[] = []
  for (const op of ops) {
    if (op.op !== 'set') continue
    let overwrites = 0
    let replaces = 0
    for (const doc of summary.docs) {
      let current: unknown = doc
      let replaced = false
      for (const key of op.path.slice(0, -1)) {
        if (!isPlainObject(current)) break
        if (!(key in current)) {
          current = undefined
          break
        }
        current = current[key]
        if (current !== undefined && !isPlainObject(current)) {
          replaced = true
          break
        }
      }
      if (replaced) {
        replaces++
        continue
      }
      const existing = getAtPath(doc, op.path)
      if (existing !== undefined && !deepEqual(existing, op.value)) overwrites++
    }
    if (overwrites > 0) warnings.push({ path: op.path, kind: 'overwrites', affected: overwrites })
    if (replaces > 0) warnings.push({ path: op.path, kind: 'replaces', affected: replaces })
  }
  return { ops, warnings }
}

/** Apply a plan to one document. Returns undefined when nothing remains. */
export const applyPlan = (metadata: unknown, plan: EditPlan): JsonObject | undefined => {
  const root: JsonObject = isPlainObject(metadata) ? clone(metadata) : {}
  for (const op of plan.ops) {
    if (op.path.length === 0) continue
    const parents = op.path.slice(0, -1)
    const leaf = op.path[op.path.length - 1]!
    if (op.op === 'set') {
      let current = root
      for (const key of parents) {
        if (!isPlainObject(current[key])) current[key] = {}
        current = current[key] as JsonObject
      }
      current[leaf] = clone(op.value)
    } else {
      const chain: JsonObject[] = [root]
      let current: JsonObject | null = root
      for (const key of parents) {
        const next: unknown = current[key]
        if (!isPlainObject(next)) {
          current = null
          break
        }
        chain.push(next)
        current = next
      }
      if (!current) continue
      delete current[leaf]
      // Prune only the ancestors emptied by this removal.
      for (let i = chain.length - 1; i > 0; i--) {
        if (Object.keys(chain[i]!).length > 0) break
        delete chain[i - 1]![parents[i - 1]!]
      }
    }
  }
  return Object.keys(root).length === 0 ? undefined : root
}

/** Ops turning `base` into `next`, descending through objects shared by both. */
export const diffToOps = (base: JsonObject, next: JsonObject, prefix: Path = []): EditOp[] => {
  const ops: EditOp[] = []
  for (const key of Object.keys(next)) {
    const path = [...prefix, key]
    const before = base[key]
    const after = next[key]
    if (isPlainObject(before) && isPlainObject(after)) {
      ops.push(...diffToOps(before, after, path))
    } else if (!(key in base) || !deepEqual(before, after)) {
      ops.push({ op: 'set', path, value: after })
    }
  }
  for (const key of Object.keys(base)) {
    if (!(key in next)) ops.push({ op: 'remove', path: [...prefix, key] })
  }
  return ops
}
