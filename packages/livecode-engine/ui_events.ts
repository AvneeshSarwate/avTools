import type {
  LivecodeEvent,
  UiEvent,
  UiEventBatch,
} from "@avtools/livecode-protocol";
import { cloneEvent } from "./events.ts";

// Engine-to-UI events: the outbound mirror of `events.ts`. `send` is fire and
// forget; events sent in one synchronous turn leave as one batch on a
// microtask, independent of the sync tick. The host registers the sink that
// carries batches to its transports. Like the other engine singletons this
// assumes one engine per isolate.

/** Events one flush may carry; older ones beyond this are dropped and counted. */
export const UI_EVENT_QUEUE_LIMIT = 1000;

type Sink = (batch: UiEventBatch) => void;

const sinks = new Set<Sink>();
let queue: UiEvent[] = [];
let dropped = 0;
let seq = 0;
let flushScheduled = false;

/**
 * Send one `{type, body}` event to whatever UIs are listening. Returns nothing:
 * code cannot learn whether anyone received it, and a headless run behaves the
 * same. The body must be JSON data; anything else throws here, where the
 * mistake was made.
 */
export function send(event: LivecodeEvent): void {
  const message = cloneEvent(event);
  queue.push({ seq: ++seq, type: message.type, body: message.body });
  if (queue.length > UI_EVENT_QUEUE_LIMIT) {
    const excess = queue.length - UI_EVENT_QUEUE_LIMIT;
    queue.splice(0, excess);
    dropped += excess;
  }
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flush);
  }
}

function flush(): void {
  flushScheduled = false;
  if (queue.length === 0 && dropped === 0) return;
  const batch: UiEventBatch = {
    type: "uiEvents",
    events: queue,
    ...(dropped > 0 ? { dropped } : {}),
  };
  queue = [];
  dropped = 0;
  // Every sink gets the same batch object, so none may mutate it.
  for (const sink of [...sinks]) {
    try {
      sink(batch);
    } catch (error) {
      console.error("[livecode-ui-events] sink failed", error);
    }
  }
}

/** Host plumbing: receive every outbound batch until the returned function runs. */
export function addUiEventSink(sink: Sink): () => void {
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}
