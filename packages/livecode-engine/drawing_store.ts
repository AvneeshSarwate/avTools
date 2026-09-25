// The drawing store: one lossless handwriting-canvas document per name. The
// document format and its Konva-free bake come from `@avtools/drawing-document`,
// so a module can read world-space geometry for a drawing no view has displayed.
//
// Writes are whole-document replaces with optional compare-and-set (the
// animation-timeline shape) or node-level patches (the in-gesture stream a
// view sends while a shape is dragged or drawn). Either way the store ships
// sparse patches on the sync transport, in the same `{name, patches}` form as
// Six Sines. Unlike Six Sines there is no tracked live object: every mutation
// comes through this module, which therefore knows the exact path it changed
// and records it directly. (Reconciling a whole document through a proxy
// tracker costs tens of milliseconds at a few thousand points; recording the
// path is free, and `render()` keeps baking plain objects.)

import type {
  DrawingDocument,
  DrawingEntity,
  DrawingLayerName,
  DrawingNode,
  DrawingNodeDelete,
  DrawingNodeUpsert,
  DrawingPatchResult,
  DrawingRenderData,
  DrawingSetResult,
  EntityPatch,
  EntityPatchValue,
} from "@avtools/livecode-protocol";
import {
  bakeDrawingDocument,
  createEmptyDrawingDocument,
  drawingDocumentVersion,
  listDrawingNodeIds,
  normalizeDrawingDocument,
  normalizeDrawingNode,
} from "@avtools/drawing-document";
import {
  clearEntityRecords,
  cloneEntityValueForWire,
  commitEntityWrite,
  consumeEntityTypeChanges,
  createEntityRecord,
  deleteEntityRecord,
  type EntityChange,
  type EntityRecord,
  getEntityRecord,
  isEntityRevConflict,
  listEntityRecords,
  normalizeEntityName,
  safeStringifyEntityValue,
} from "./entity_store.ts";

export const DRAWING_ENTITY_TYPE = "drawing";

const LAYERS: readonly DrawingLayerName[] = ["freehand", "polygon", "circle"];

/**
 * Patches recorded since the last collect, entity-relative under `data`.
 * "full" means the next delivery ships the whole entity: creation, load, and
 * duplication start there, and it is sticky within a tick so a client never
 * sees a patch before the reset it applies to.
 */
const pending = new Map<string, EntityPatch[] | "full">();

function recordPatches(name: string, patches: EntityPatch[]): void {
  const current = pending.get(name);
  if (current === "full") return;
  if (current) current.push(...patches);
  else pending.set(name, [...patches]);
}

function recordFull(name: string): void {
  pending.set(name, "full");
}

export interface DrawingWriteOptions {
  originId?: string;
  expectedRev?: number;
}

/** The module-facing handle `drawing(name)` returns. */
export interface DrawingHandle {
  readonly name: string;
  /** The current revision, for compare-and-set callers. */
  rev(): number;
  /** A deep copy of the document; mutate it and pass it to `set`. */
  document(): DrawingDocument;
  /** World-space render data, baked without Konva and cached per revision. */
  render(): DrawingRenderData;
  set(data: DrawingDocument, options?: DrawingWriteOptions): DrawingSetResult;
  /**
   * Read-modify-write in one call: the mutator receives a copy of the
   * current document and may edit it in place or return a replacement.
   */
  update(
    mutate: (doc: DrawingDocument) => DrawingDocument | void,
    options?: DrawingWriteOptions,
  ): DrawingSetResult;
}

/**
 * Declare a drawing: create it empty (or from `initial`) when absent, reattach
 * when present. The declaration never overwrites existing content.
 */
export function drawing(
  name: string,
  initial: DrawingDocument = createEmptyDrawingDocument(),
): DrawingHandle {
  const entityName = normalizeEntityName(DRAWING_ENTITY_TYPE, name);
  if (!getEntityRecord(DRAWING_ENTITY_TYPE, entityName)) {
    createDrawing(entityName, initial, "declare");
  }
  let cachedRender: { rev: number; render: DrawingRenderData } | null = null;
  const handle: DrawingHandle = {
    name: entityName,
    rev: () => requireDrawingRecord(entityName).rev,
    document: () => requireDrawingDocument(entityName),
    render() {
      const record = requireDrawingRecord(entityName);
      if (cachedRender?.rev !== record.rev) {
        cachedRender = {
          rev: record.rev,
          render: bakeDrawingDocument(record.value),
        };
      }
      return cachedRender.render;
    },
    set: (data, options = {}) => setDrawing(entityName, data, options),
    update(mutate, options = {}) {
      const draft = requireDrawingDocument(entityName);
      const returned = mutate(draft);
      return setDrawing(entityName, returned ?? draft, options);
    },
  };
  return handle;
}

export function createEmptyDrawing(name: string): DrawingEntity {
  return createDrawing(name, createEmptyDrawingDocument(), "create");
}

export function getDrawing(name: string): DrawingEntity | undefined {
  const record = getEntityRecord<DrawingDocument>(
    DRAWING_ENTITY_TYPE,
    name.trim(),
  );
  return record ? toDrawingEntity(record) : undefined;
}

export function listDrawings(): DrawingEntity[] {
  return listEntityRecords<DrawingDocument>(DRAWING_ENTITY_TYPE)
    .map(toDrawingEntity);
}

export function listDrawingNames(): string[] {
  return listEntityRecords(DRAWING_ENTITY_TYPE).map((record) => record.name);
}

/**
 * Replace a drawing's document. The candidate is normalized first, so an
 * invalid document is rejected without touching the entity; an unchanged
 * canonical form is a no-op that leaves `rev` alone.
 */
export function setDrawing(
  name: string,
  data: DrawingDocument,
  options: DrawingWriteOptions = {},
): DrawingSetResult {
  const entityName = normalizeEntityName(DRAWING_ENTITY_TYPE, name);
  const record = getEntityRecord<DrawingDocument>(
    DRAWING_ENTITY_TYPE,
    entityName,
  );
  if (!record) return { ok: false, error: `No drawing "${entityName}"` };
  if (isEntityRevConflict(record, options.expectedRev)) {
    return {
      ok: false,
      error: `Drawing "${entityName}" changed before this edit`,
      current: toDrawingEntity(record),
    };
  }

  let next: DrawingDocument;
  try {
    next = normalizeDrawingDocument(data, `Drawing "${entityName}"`);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      current: toDrawingEntity(record),
    };
  }
  const nextJson = JSON.stringify(next);
  if (safeStringifyEntityValue(record.value) === nextJson) {
    return { ok: true, drawing: toDrawingEntity(record) };
  }

  recordPatches(entityName, diffDrawingDocuments(record.value, next));
  record.value = next;
  commitEntityWrite(record, {
    updatedBy: options.originId ?? "client",
    valueJson: nextJson,
  });
  return { ok: true, drawing: toDrawingEntity(record) };
}

/**
 * Apply node-level edits: each upsert replaces the node with that id wherever
 * it sits (or appends it at the layer's top level), each delete removes one.
 * The batch is validated before anything is written; an unchanged batch is a
 * no-op that leaves `rev` alone.
 */
export function patchDrawing(
  name: string,
  edits: { upserts?: DrawingNodeUpsert[]; deletes?: DrawingNodeDelete[] },
  options: DrawingWriteOptions = {},
): DrawingPatchResult {
  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, error: "Drawing name is required", status: 400 };
  }
  const entityName = normalizeEntityName(DRAWING_ENTITY_TYPE, name);
  const record = getEntityRecord<DrawingDocument>(
    DRAWING_ENTITY_TYPE,
    entityName,
  );
  if (!record) {
    return { ok: false, error: `No drawing "${entityName}"`, status: 404 };
  }
  if (isEntityRevConflict(record, options.expectedRev)) {
    return {
      ok: false,
      error: `Drawing "${entityName}" changed before this edit`,
      status: 409,
    };
  }
  const upserts = edits.upserts ?? [];
  const deletes = edits.deletes ?? [];
  if (!Array.isArray(upserts) || !Array.isArray(deletes)) {
    return { ok: false, error: "upserts/deletes must be arrays", status: 422 };
  }

  // Validate every node first, then check ids against the document minus the
  // nodes being replaced or removed, so a rejected batch touches nothing.
  const doc = record.value;
  let normalized: Array<{ layer: DrawingLayerName; node: DrawingNode }>;
  try {
    normalized = upserts.map((upsert, index) => {
      const layer = requireLayer(upsert?.layer, `upserts[${index}].layer`);
      return {
        layer,
        node: normalizeDrawingNode(upsert.node, layer, `upserts[${index}]`),
      };
    });
    for (const [index, del] of deletes.entries()) {
      requireLayer(del?.layer, `deletes[${index}].layer`);
      if (typeof del.id !== "string" || !del.id) {
        throw new Error(`deletes[${index}].id must be a non-empty string`);
      }
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      status: 422,
    };
  }
  // Ids that remain after this batch: everything except the nodes (and their
  // subtrees) this batch replaces or removes on the same layer.
  const otherIds = new Set<string>();
  for (const layer of LAYERS) {
    const replaced = new Set([
      ...normalized.filter((u) => u.layer === layer).map((u) => u.node.id),
      ...deletes.filter((d) => d.layer === layer).map((d) => d.id),
    ]);
    collectIdsExcluding(doc[layer].nodes, replaced, otherIds);
  }
  const incomingIds = new Set<string>();
  for (const { node } of normalized) {
    for (const id of listDrawingNodeIds([node])) {
      if (otherIds.has(id) || incomingIds.has(id)) {
        return {
          ok: false,
          error: `Node id "${id}" is used more than once`,
          status: 422,
        };
      }
      incomingIds.add(id);
    }
  }

  const patches: EntityPatch[] = [];
  for (const { layer, node } of normalized) {
    const nodes = doc[layer].nodes;
    const position = topLevelPosition(nodes, node.id);
    if (position === -1) {
      nodes.push(node);
      patches.push(nodeSet(layer, nodes.length - 1, node));
      continue;
    }
    const replaced = replaceWithin(nodes[position], node);
    if (JSON.stringify(replaced) === JSON.stringify(nodes[position])) continue;
    nodes[position] = replaced;
    patches.push(nodeSet(layer, position, replaced));
  }
  const touchedLayers = new Set<DrawingLayerName>();
  for (const del of deletes) {
    if (removeAnywhere(doc[del.layer].nodes, del.id)) {
      touchedLayers.add(del.layer);
    }
  }
  for (const layer of touchedLayers) {
    patches.push({
      op: "set",
      path: [layer, "nodes"],
      value: json(doc[layer].nodes),
    });
  }
  if (patches.length === 0) return { ok: true, rev: record.rev };
  const version = drawingDocumentVersion(doc.polygon);
  if (version !== doc.version) {
    doc.version = version;
    patches.push({ op: "set", path: ["version"], value: version });
  }
  recordPatches(entityName, patches);
  commitEntityWrite(record, {
    updatedBy: options.originId ?? "client",
    valueJson: null,
  });
  return { ok: true, rev: record.rev };
}

function collectIdsExcluding(
  nodes: readonly DrawingNode[],
  excluded: ReadonlySet<string>,
  into: Set<string>,
): void {
  for (const node of nodes) {
    if (excluded.has(node.id)) continue;
    into.add(node.id);
    if (node.type === "group") {
      collectIdsExcluding(node.children, excluded, into);
    }
  }
}

function requireLayer(value: unknown, path: string): DrawingLayerName {
  if (!LAYERS.includes(value as DrawingLayerName)) {
    throw new Error(`${path} must be one of ${LAYERS.join(", ")}`);
  }
  return value as DrawingLayerName;
}

/** Canonical nodes are plain JSON; the patch value type only lacks the index signature. */
function json(value: unknown): EntityPatchValue {
  return value as EntityPatchValue;
}

function nodeSet(
  layer: DrawingLayerName,
  index: number,
  node: DrawingNode,
): EntityPatch {
  return {
    op: "set",
    path: [layer, "nodes", String(index)],
    value: json(node),
  };
}

/** Index of the top-level node that is, or contains, `id`; -1 when absent. */
function topLevelPosition(nodes: readonly DrawingNode[], id: string): number {
  return nodes.findIndex((node) =>
    node.id === id ||
    (node.type === "group" && listDrawingNodeIds(node.children).has(id))
  );
}

/** `root` with the node sharing `replacement.id` swapped, at any depth. */
function replaceWithin(
  root: DrawingNode,
  replacement: DrawingNode,
): DrawingNode {
  if (root.id === replacement.id) return replacement;
  if (root.type !== "group") return root;
  return {
    ...root,
    children: root.children.map((child) => replaceWithin(child, replacement)),
  };
}

function removeAnywhere(nodes: DrawingNode[], id: string): boolean {
  const index = nodes.findIndex((node) => node.id === id);
  if (index !== -1) {
    nodes.splice(index, 1);
    return true;
  }
  return nodes.some((node) =>
    node.type === "group" && removeAnywhere(node.children, id)
  );
}

/**
 * Patches turning `prev` into `next`, both canonical. A layer whose top-level
 * ids are unchanged ships only its changed nodes by index; any reorder,
 * insertion, or deletion ships that layer's node array whole.
 */
export function diffDrawingDocuments(
  prev: DrawingDocument,
  next: DrawingDocument,
): EntityPatch[] {
  const patches: EntityPatch[] = [];
  if (prev.version !== next.version) {
    patches.push({ op: "set", path: ["version"], value: next.version });
  }
  for (const layer of LAYERS) {
    const before = prev[layer];
    const after = next[layer];
    if (JSON.stringify(before.transform) !== JSON.stringify(after.transform)) {
      patches.push(
        after.transform === undefined
          ? { op: "delete", path: [layer, "transform"] }
          : {
            op: "set",
            path: [layer, "transform"],
            value: json(after.transform),
          },
      );
    }
    const sameShape = before.nodes.length === after.nodes.length &&
      before.nodes.every((node, index) => node.id === after.nodes[index].id);
    if (!sameShape) {
      patches.push({
        op: "set",
        path: [layer, "nodes"],
        value: json(after.nodes),
      });
      continue;
    }
    after.nodes.forEach((node, index) => {
      if (JSON.stringify(node) !== JSON.stringify(before.nodes[index])) {
        patches.push(nodeSet(layer, index, node));
      }
    });
  }
  return patches;
}

export function duplicateDrawing(
  sourceName: string,
  targetName: string,
): DrawingEntity {
  const source = normalizeEntityName(DRAWING_ENTITY_TYPE, sourceName);
  const target = normalizeEntityName(DRAWING_ENTITY_TYPE, targetName);
  const sourceRecord = getEntityRecord<DrawingDocument>(
    DRAWING_ENTITY_TYPE,
    source,
  );
  if (!sourceRecord) throw new Error(`No drawing "${source}"`);
  if (getEntityRecord(DRAWING_ENTITY_TYPE, target)) {
    throw new Error(`Drawing "${target}" already exists`);
  }
  return createDrawing(target, sourceRecord.value, "duplicate");
}

export function removeDrawing(name: string): boolean {
  return deleteEntityRecord(
    DRAWING_ENTITY_TYPE,
    normalizeEntityName(DRAWING_ENTITY_TYPE, name),
  );
}

/** Adopt disk truth on project open: validate, then create or replace. */
export function loadDrawing(name: string, data: unknown): DrawingEntity {
  const entityName = normalizeEntityName(DRAWING_ENTITY_TYPE, name);
  const next = normalizeDrawingDocument(data, `Saved drawing "${entityName}"`);
  const record = getEntityRecord<DrawingDocument>(
    DRAWING_ENTITY_TYPE,
    entityName,
  );
  if (!record) return createDrawing(entityName, next, "load");
  recordFull(entityName);
  record.value = next;
  commitEntityWrite(record, {
    updatedBy: "load",
    valueJson: JSON.stringify(next),
  });
  return toDrawingEntity(record);
}

export function latestDrawingJson(name: string): string | null {
  const record = getEntityRecord<DrawingDocument>(
    DRAWING_ENTITY_TYPE,
    name.trim(),
  );
  return record ? safeStringifyEntityValue(record.value) : null;
}

/**
 * One tick's deliveries: the whole entity for a name whose pending state is
 * "full", otherwise its recorded patches (prefixed with `data`, followed by
 * the revision fields) — the Six Sines wire shape.
 */
export function collectDrawingChanges(): EntityChange<DrawingEntity>[] | null {
  const changed = consumeEntityTypeChanges(DRAWING_ENTITY_TYPE);
  if (!changed) return null;
  const changes: EntityChange<DrawingEntity>[] = [];
  for (const name of changed.changed) {
    const record = getEntityRecord<DrawingDocument>(DRAWING_ENTITY_TYPE, name);
    const recorded = pending.get(name);
    pending.delete(name);
    if (!record) continue;
    if (recorded && recorded !== "full") {
      changes.push({
        name,
        patches: [
          ...recorded.map((patch) => ({
            ...patch,
            path: ["data", ...patch.path],
          })),
          { op: "set", path: ["rev"], value: record.rev },
          { op: "set", path: ["updatedAt"], value: record.updatedAt },
          { op: "set", path: ["updatedBy"], value: record.updatedBy },
        ],
      });
    } else {
      changes.push({ name, entity: toDrawingEntity(record) });
    }
  }
  for (const name of changed.deleted) {
    pending.delete(name);
    changes.push({ name, entity: null });
  }
  return changes;
}

/** Test seam. */
export function clearDrawingStore(): void {
  clearEntityRecords(DRAWING_ENTITY_TYPE);
  pending.clear();
}

function createDrawing(
  name: string,
  data: DrawingDocument,
  updatedBy: string,
): DrawingEntity {
  const entityName = normalizeEntityName(DRAWING_ENTITY_TYPE, name);
  if (getEntityRecord(DRAWING_ENTITY_TYPE, entityName)) {
    throw new Error(`Drawing "${entityName}" already exists`);
  }
  const value = normalizeDrawingDocument(data, `Drawing "${entityName}"`);
  recordFull(entityName);
  return toDrawingEntity(createEntityRecord(
    DRAWING_ENTITY_TYPE,
    entityName,
    value,
    { updatedBy, valueJson: JSON.stringify(value) },
  ));
}

function requireDrawingRecord(name: string): EntityRecord<DrawingDocument> {
  const record = getEntityRecord<DrawingDocument>(
    DRAWING_ENTITY_TYPE,
    name.trim(),
  );
  if (!record) throw new Error(`No drawing "${name.trim()}"`);
  return record;
}

function requireDrawingDocument(name: string): DrawingDocument {
  return structuredClone(requireDrawingRecord(name).value);
}

function toDrawingEntity(record: EntityRecord<DrawingDocument>): DrawingEntity {
  const wire = cloneEntityValueForWire(record);
  if (!wire.ok) {
    throw new Error(
      `Drawing "${record.name}" is not serializable: ${wire.error}`,
    );
  }
  return {
    name: record.name,
    rev: record.rev,
    data: wire.value,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  };
}
