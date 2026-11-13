import type {
  DurableEntityRef,
  ProjectCanvasState,
} from "@avtools/livecode-protocol";

export interface CanvasViewDispatchCodec {
  isShape(value: unknown): boolean;
  collect(shapes: readonly unknown[]): Partial<ProjectCanvasState>;
  hasChanged(before: unknown, after: unknown): boolean;
  entityRef?(shape: unknown): DurableEntityRef;
}

export function collectViewsFromCodecs(
  codecs: readonly CanvasViewDispatchCodec[],
  shapes: readonly unknown[],
): ProjectCanvasState {
  return Object.assign({}, ...codecs.map((codec) => codec.collect(shapes)));
}

export function isRegisteredCanvasView(
  codecs: readonly CanvasViewDispatchCodec[],
  value: unknown,
): boolean {
  return codecs.some((codec) => codec.isShape(value));
}

export function registeredCanvasViewChanged(
  codecs: readonly CanvasViewDispatchCodec[],
  before: unknown,
  after: unknown,
): boolean {
  const beforeCodec = codecs.find((codec) => codec.isShape(before));
  const afterCodec = codecs.find((codec) => codec.isShape(after));
  if (!beforeCodec || beforeCodec !== afterCodec) {
    return Boolean(beforeCodec || afterCodec);
  }
  return beforeCodec.hasChanged(before, after);
}

export function registeredEntityRef(
  codecs: readonly CanvasViewDispatchCodec[],
  shape: unknown,
): DurableEntityRef | null {
  const codec = codecs.find((candidate) => candidate.isShape(shape));
  return codec?.entityRef?.(shape) ?? null;
}
