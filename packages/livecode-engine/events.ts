import type { TimeContext } from "@avtools/core-timing";
import type {
  EmitEventResult,
  LivecodeEvent,
} from "@avtools/livecode-protocol";

type Listener = {
  handler: (event: LivecodeEvent) => unknown;
  ctx: TimeContext;
  unsubscribe: () => void;
};
const listeners = new Set<Listener>();
const ended = new WeakSet<TimeContext>();

/** Reject values that JSON would silently drop or change, even in same-tab mode. */
export function cloneEvent<T extends LivecodeEvent>(event: T): T {
  const visit = (value: unknown, seen = new Set<object>()): void => {
    if (
      value === null || typeof value === "string" || typeof value === "boolean"
    ) return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object" || value === null) {
      throw new Error("Event bodies must contain only JSON values");
    }
    if (seen.has(value)) {
      throw new Error("Event bodies must not contain cycles");
    }
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
      throw new Error("Event bodies must contain plain objects or arrays");
    }
    if (Object.getOwnPropertySymbols(value).length) {
      throw new Error("Event bodies cannot contain symbol keys");
    }
    seen.add(value);
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      visit(child, seen);
    }
    seen.delete(value);
  };
  if (
    !event || typeof event.type !== "string" || !event.type.trim() ||
    !("body" in event)
  ) {
    throw new Error("Expected an event with a nonempty type and a body");
  }
  visit(event);
  return JSON.parse(JSON.stringify(event)) as T;
}

/** The analyzer supplies ctx for direct calls in a timed scope. Headless code passes it. */
export function onEvent<E extends LivecodeEvent = LivecodeEvent>(
  handler: (event: E) => unknown,
  ctx?: TimeContext,
): () => void {
  if (!ctx) {
    throw new Error(
      "onEvent needs a TimeContext: call it in a timed scope or pass ctx explicitly",
    );
  }
  if (ctx.isCanceled || ended.has(ctx)) return () => {};
  const listener: Listener = {
    handler: handler as Listener["handler"],
    ctx,
    unsubscribe: () => {},
  };
  const unsubscribe = () => {
    listeners.delete(listener);
    ctx.abortController.signal.removeEventListener("abort", unsubscribe);
  };
  listener.unsubscribe = unsubscribe;
  listeners.add(listener);
  ctx.abortController.signal.addEventListener("abort", unsubscribe, {
    once: true,
  });
  // At the start of a headless launch, the proxy's block promise is assigned
  // only after the block yields. Register settlement cleanup in the next microtask.
  queueMicrotask(() => {
    ctx.cancelPromise.then(unsubscribe, unsubscribe);
  });
  return unsubscribe;
}

/** Natural module completion also retires listeners on its still-live children. */
export function endEventContext(ctx: TimeContext): void {
  ended.add(ctx);
  for (const listener of listeners) {
    if (listener.ctx === ctx) listener.unsubscribe();
  }
  for (const child of ctx.childContexts) endEventContext(child);
}

/** No persistence, replay, or entity lookup. Dispatch does not await musical work. */
export function emit(event: LivecodeEvent): EmitEventResult {
  const message = cloneEvent(event);
  let delivered = 0;
  for (const listener of [...listeners]) {
    if (
      !listeners.has(listener) || listener.ctx.isCanceled ||
      ended.has(listener.ctx)
    ) continue;
    delivered++;
    try {
      // Isolate subscribers and transport modes from shared mutable payloads.
      const result = listener.handler(cloneEvent(message));
      Promise.resolve(result).catch(reportHandlerError);
    } catch (error) {
      reportHandlerError(error);
    }
  }
  return { delivered };
}

function reportHandlerError(error: unknown): void {
  console.error("[livecode-events] handler failed", error);
}
