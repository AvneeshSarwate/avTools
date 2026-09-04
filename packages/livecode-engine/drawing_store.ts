// The drawing store: one lossless handwriting-canvas document per name,
// replaced whole with optional compare-and-set. Structured like the animation
// timeline store; the document format and its Konva-free bake come from
// `@avtools/drawing-document`, so a module can read world-space geometry for a
// drawing no view has displayed.

import type {
  DrawingDocument,
  DrawingEntity,
  DrawingRenderData,
  DrawingSetResult,
} from "@avtools/livecode-protocol";
import {
  bakeDrawingDocument,
  createEmptyDrawingDocument,
  normalizeDrawingDocument,
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

  record.value = next;
  commitEntityWrite(record, {
    updatedBy: options.originId ?? "client",
    valueJson: nextJson,
  });
  return { ok: true, drawing: toDrawingEntity(record) };
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

export function collectDrawingChanges(): EntityChange<DrawingEntity>[] | null {
  const changed = consumeEntityTypeChanges(DRAWING_ENTITY_TYPE);
  if (!changed) return null;
  const changes: EntityChange<DrawingEntity>[] = [];
  for (const name of changed.changed) {
    const entity = getDrawing(name);
    if (entity) changes.push({ name, entity });
  }
  for (const name of changed.deleted) changes.push({ name, entity: null });
  return changes;
}

/** Test seam. */
export function clearDrawingStore(): void {
  clearEntityRecords(DRAWING_ENTITY_TYPE);
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
