import type {
  AnimationFunctionHit,
  AnimationSample,
  AnimationTimelineData,
  AnimationTimelineEntity,
  AnimationTimelineSetResult,
  AnimationTrack,
} from "@avtools/livecode-protocol";
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
  serializeEntityValue,
} from "./entity_store.ts";

export const ANIMATION_TIMELINE_ENTITY_TYPE = "animationTimeline";

export interface AnimationTimelineHandle {
  readonly name: string;
  data(): AnimationTimelineData;
  sample(time: number): AnimationSample;
  functionHits(fromTime: number, toTime: number): AnimationFunctionHit[];
  set(
    data: AnimationTimelineData,
    options?: { originId?: string; expectedRev?: number },
  ): AnimationTimelineSetResult;
}

export function animationTimeline(
  name: string,
  initial: AnimationTimelineData = { tracks: [], trackOrder: [] },
): AnimationTimelineHandle {
  const entityName = normalizeEntityName(ANIMATION_TIMELINE_ENTITY_TYPE, name);
  if (!getEntityRecord(ANIMATION_TIMELINE_ENTITY_TYPE, entityName)) {
    createAnimationTimeline(entityName, initial, "declare");
  }
  return {
    name: entityName,
    data: () => requireAnimationTimelineData(entityName),
    sample: (time) => sampleAnimationTimeline(entityName, time),
    functionHits: (fromTime, toTime) =>
      animationFunctionHits(entityName, fromTime, toTime),
    set: (data, options = {}) =>
      setAnimationTimeline(entityName, data, options),
  };
}

export function createEmptyAnimationTimeline(
  name: string,
): AnimationTimelineEntity {
  return createAnimationTimeline(
    name,
    { tracks: [], trackOrder: [] },
    "create",
  );
}

export function getAnimationTimeline(
  name: string,
): AnimationTimelineEntity | undefined {
  const record = getEntityRecord<AnimationTimelineData>(
    ANIMATION_TIMELINE_ENTITY_TYPE,
    name.trim(),
  );
  return record ? toAnimationTimelineEntity(record) : undefined;
}

export function listAnimationTimelines(): AnimationTimelineEntity[] {
  return listEntityRecords<AnimationTimelineData>(
    ANIMATION_TIMELINE_ENTITY_TYPE,
  )
    .map(toAnimationTimelineEntity);
}

export function listAnimationTimelineNames(): string[] {
  return listEntityRecords(ANIMATION_TIMELINE_ENTITY_TYPE).map((record) =>
    record.name
  );
}

export function setAnimationTimeline(
  name: string,
  data: AnimationTimelineData,
  options: { originId?: string; expectedRev?: number } = {},
): AnimationTimelineSetResult {
  const entityName = normalizeEntityName(ANIMATION_TIMELINE_ENTITY_TYPE, name);
  const record = getEntityRecord<AnimationTimelineData>(
    ANIMATION_TIMELINE_ENTITY_TYPE,
    entityName,
  );
  if (!record) {
    return { ok: false, error: `No animation timeline "${entityName}"` };
  }
  if (isEntityRevConflict(record, options.expectedRev)) {
    return {
      ok: false,
      error: `Animation timeline "${entityName}" changed before this edit`,
      current: toAnimationTimelineEntity(record),
    };
  }

  let next: AnimationTimelineData;
  try {
    next = normalizeAnimationTimelineData(data, entityName);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      current: toAnimationTimelineEntity(record),
    };
  }
  const nextJson = JSON.stringify(next);
  if (safeStringifyEntityValue(record.value) === nextJson) {
    return { ok: true, timeline: toAnimationTimelineEntity(record) };
  }

  replaceTimelineData(record.value, next);
  commitEntityWrite(record, {
    updatedBy: options.originId ?? "client",
    valueJson: nextJson,
  });
  return { ok: true, timeline: toAnimationTimelineEntity(record) };
}

export function duplicateAnimationTimeline(
  sourceName: string,
  targetName: string,
): AnimationTimelineEntity {
  const source = normalizeEntityName(
    ANIMATION_TIMELINE_ENTITY_TYPE,
    sourceName,
  );
  const target = normalizeEntityName(
    ANIMATION_TIMELINE_ENTITY_TYPE,
    targetName,
  );
  const sourceRecord = getEntityRecord<AnimationTimelineData>(
    ANIMATION_TIMELINE_ENTITY_TYPE,
    source,
  );
  if (!sourceRecord) throw new Error(`No animation timeline "${source}"`);
  if (getEntityRecord(ANIMATION_TIMELINE_ENTITY_TYPE, target)) {
    throw new Error(`Animation timeline "${target}" already exists`);
  }
  return createAnimationTimeline(target, sourceRecord.value, "duplicate");
}

export function removeAnimationTimeline(name: string): boolean {
  return deleteEntityRecord(
    ANIMATION_TIMELINE_ENTITY_TYPE,
    normalizeEntityName(ANIMATION_TIMELINE_ENTITY_TYPE, name),
  );
}

export function loadAnimationTimeline(
  name: string,
  data: AnimationTimelineData,
): AnimationTimelineEntity {
  const entityName = normalizeEntityName(ANIMATION_TIMELINE_ENTITY_TYPE, name);
  const next = normalizeAnimationTimelineData(data, entityName);
  const record = getEntityRecord<AnimationTimelineData>(
    ANIMATION_TIMELINE_ENTITY_TYPE,
    entityName,
  );
  if (!record) return createAnimationTimeline(entityName, next, "load");
  replaceTimelineData(record.value, next);
  commitEntityWrite(record, {
    updatedBy: "load",
    valueJson: JSON.stringify(next),
  });
  return toAnimationTimelineEntity(record);
}

export function latestAnimationTimelineJson(name: string): string | null {
  const record = getEntityRecord<AnimationTimelineData>(
    ANIMATION_TIMELINE_ENTITY_TYPE,
    name.trim(),
  );
  return record ? safeStringifyEntityValue(record.value) : null;
}

export function collectAnimationTimelineChanges():
  | EntityChange<AnimationTimelineEntity>[]
  | null {
  const changed = consumeEntityTypeChanges(ANIMATION_TIMELINE_ENTITY_TYPE);
  if (!changed) return null;
  const changes: EntityChange<AnimationTimelineEntity>[] = [];
  for (const name of changed.changed) {
    const entity = getAnimationTimeline(name);
    if (entity) changes.push({ name, entity });
  }
  for (const name of changed.deleted) changes.push({ name, entity: null });
  return changes;
}

export function clearAnimationTimelineStore(): void {
  clearEntityRecords(ANIMATION_TIMELINE_ENTITY_TYPE);
}

export function sampleAnimationTimeline(
  name: string,
  time: number,
): AnimationSample {
  if (!Number.isFinite(time)) {
    throw new Error("Animation sample time must be finite");
  }
  const data = requireAnimationTimelineData(name);
  const tracks = new Map(data.tracks.map((track) => [track.id, track]));
  const sample: AnimationSample = { numbers: {}, enums: {} };
  for (const id of data.trackOrder) {
    const track = tracks.get(id)!;
    if (track.fieldType === "number") {
      sample.numbers[track.name] = sampleNumberTrack(track, time);
    } else if (track.fieldType === "enum") {
      sample.enums[track.name] = sampleEnumTrack(track, time);
    }
  }
  return sample;
}

export function animationFunctionHits(
  name: string,
  fromTime: number,
  toTime: number,
): AnimationFunctionHit[] {
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) {
    throw new Error("Animation function-hit times must be finite");
  }
  if (toTime <= fromTime) return [];
  const data = requireAnimationTimelineData(name);
  const tracks = new Map(data.tracks.map((track) => [track.id, track]));
  const hits: AnimationFunctionHit[] = [];
  for (const id of data.trackOrder) {
    const track = tracks.get(id)!;
    if (track.fieldType !== "func") continue;
    for (const element of track.elementData) {
      if (element.time > fromTime && element.time <= toTime) {
        hits.push({
          trackName: track.name,
          time: element.time,
          funcName: element.value.funcName,
          args: structuredClone(element.value.args),
        });
      }
    }
  }
  return hits;
}

function createAnimationTimeline(
  name: string,
  data: AnimationTimelineData,
  updatedBy: string,
): AnimationTimelineEntity {
  const entityName = normalizeEntityName(ANIMATION_TIMELINE_ENTITY_TYPE, name);
  if (getEntityRecord(ANIMATION_TIMELINE_ENTITY_TYPE, entityName)) {
    throw new Error(`Animation timeline "${entityName}" already exists`);
  }
  const value = normalizeAnimationTimelineData(data, entityName);
  return toAnimationTimelineEntity(createEntityRecord(
    ANIMATION_TIMELINE_ENTITY_TYPE,
    entityName,
    value,
    { updatedBy, valueJson: JSON.stringify(value) },
  ));
}

function requireAnimationTimelineData(name: string): AnimationTimelineData {
  const record = getEntityRecord<AnimationTimelineData>(
    ANIMATION_TIMELINE_ENTITY_TYPE,
    name.trim(),
  );
  if (!record) throw new Error(`No animation timeline "${name.trim()}"`);
  return structuredClone(record.value);
}

function toAnimationTimelineEntity(
  record: EntityRecord<AnimationTimelineData>,
): AnimationTimelineEntity {
  const wire = cloneEntityValueForWire(record);
  if (!wire.ok) {
    throw new Error(
      `Animation timeline "${record.name}" is not serializable: ${wire.error}`,
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

function normalizeAnimationTimelineData(
  data: AnimationTimelineData,
  name: string,
): AnimationTimelineData {
  const serialized = serializeEntityValue(data);
  if (!serialized.ok) {
    throw new Error(`Animation timeline "${name}" ${serialized.error}`);
  }
  const value = JSON.parse(serialized.json) as AnimationTimelineData;
  if (!Array.isArray(value.tracks) || !Array.isArray(value.trackOrder)) {
    throw new Error(
      `Animation timeline "${name}" must have tracks and trackOrder arrays`,
    );
  }

  const trackIds = new Set<string>();
  const trackNames = new Set<string>();
  for (const track of value.tracks) {
    validateTrack(track, name, trackIds, trackNames);
    track.elementData.sort((a, b) => a.time - b.time);
  }
  if (
    value.trackOrder.length !== trackIds.size ||
    new Set(value.trackOrder).size !== value.trackOrder.length ||
    value.trackOrder.some((id) => !trackIds.has(id))
  ) {
    throw new Error(
      `Animation timeline "${name}" trackOrder must contain every track id exactly once`,
    );
  }
  return value;
}

function validateTrack(
  track: AnimationTrack,
  timelineName: string,
  trackIds: Set<string>,
  trackNames: Set<string>,
): void {
  if (!track || typeof track !== "object") {
    throw new Error(
      `Animation timeline "${timelineName}" contains an invalid track`,
    );
  }
  if (typeof track.id !== "string" || !track.id) {
    throw new Error(
      `Animation timeline "${timelineName}" has a track without an id`,
    );
  }
  if (trackIds.has(track.id)) {
    throw new Error(
      `Animation timeline "${timelineName}" repeats track id "${track.id}"`,
    );
  }
  trackIds.add(track.id);
  if (typeof track.name !== "string" || !track.name) {
    throw new Error(
      `Animation timeline "${timelineName}" has a track without a name`,
    );
  }
  if (trackNames.has(track.name)) {
    throw new Error(
      `Animation timeline "${timelineName}" repeats track name "${track.name}"`,
    );
  }
  trackNames.add(track.name);
  if (!["number", "enum", "func"].includes(track.fieldType)) {
    throw new Error(
      `Animation timeline "${timelineName}" track "${track.name}" has an invalid fieldType`,
    );
  }
  if (
    !Number.isFinite(track.low) || !Number.isFinite(track.high) ||
    track.low > track.high
  ) {
    throw new Error(
      `Animation timeline "${timelineName}" track "${track.name}" has invalid bounds`,
    );
  }
  if (
    track.enumOptions !== undefined &&
    (!Array.isArray(track.enumOptions) ||
      track.enumOptions.some((option) => typeof option !== "string"))
  ) {
    throw new Error(
      `Animation timeline "${timelineName}" track "${track.name}" has invalid enumOptions`,
    );
  }
  if (!Array.isArray(track.elementData)) {
    throw new Error(
      `Animation timeline "${timelineName}" track "${track.name}" elementData must be an array`,
    );
  }

  const elementIds = new Set<string>();
  for (const element of track.elementData) {
    if (
      typeof element.id !== "string" || !element.id ||
      elementIds.has(element.id)
    ) {
      throw new Error(
        `Animation timeline "${timelineName}" track "${track.name}" has an invalid element id`,
      );
    }
    elementIds.add(element.id);
    if (!Number.isFinite(element.time) || element.time < 0) {
      throw new Error(
        `Animation timeline "${timelineName}" track "${track.name}" has an invalid element time`,
      );
    }
    const validValue = track.fieldType === "number"
      ? typeof element.value === "number" && Number.isFinite(element.value)
      : track.fieldType === "enum"
      ? typeof element.value === "string"
      : typeof element.value === "object" && element.value !== null &&
        typeof (element.value as { funcName?: unknown }).funcName ===
          "string" &&
        Array.isArray((element.value as { args?: unknown }).args);
    if (!validValue) {
      throw new Error(
        `Animation timeline "${timelineName}" track "${track.name}" has a value that does not match ${track.fieldType}`,
      );
    }
  }
}

function replaceTimelineData(
  current: AnimationTimelineData,
  next: AnimationTimelineData,
): void {
  current.tracks.splice(0, current.tracks.length, ...next.tracks);
  current.trackOrder.splice(0, current.trackOrder.length, ...next.trackOrder);
}

function sampleNumberTrack(
  track: Extract<AnimationTrack, { fieldType: "number" }>,
  time: number,
): number {
  const elements = track.elementData;
  if (elements.length === 0) return track.low;
  const right = elements.findIndex((element) => element.time > time);
  if (right === 0) return elements[0].value;
  if (right === -1) return elements[elements.length - 1].value;
  const before = elements[right - 1];
  const after = elements[right];
  const alpha = (time - before.time) / (after.time - before.time);
  return Math.max(
    track.low,
    Math.min(track.high, before.value + (after.value - before.value) * alpha),
  );
}

function sampleEnumTrack(
  track: Extract<AnimationTrack, { fieldType: "enum" }>,
  time: number,
): string {
  if (track.elementData.length === 0) return "";
  let value = track.elementData[0].value;
  for (const element of track.elementData) {
    if (element.time > time) break;
    value = element.value;
  }
  return value;
}
