// Engine-to-UI events: a lightweight outbound stream of `{type, body}`
// messages, the mirror image of the global input events in `events.ts`.
// See docs/livecode/history/ui-events-plan-2026-09.md.
//
// Fire and forget: no acknowledgement, replay, or ordering with sync. A
// consumer that was not connected when an event was sent never sees it.

/** One outbound event as a consumer receives it. */
// deno-lint-ignore no-explicit-any
export interface UiEvent<Body = any> {
  /** Monotonic per engine lifetime; a jump means events were missed. */
  seq: number;
  type: string;
  body: Body;
}

/**
 * The one wire message, identical on every transport: the `/sync` socket,
 * the engine tab's sync BroadcastChannel, and in-process observers. It never
 * advances the sync `seq`, and clients that predate it ignore it.
 */
export interface UiEventBatch {
  type: "uiEvents";
  events: UiEvent[];
  /** Events the engine's queue bound discarded since the previous batch. */
  dropped?: number;
}
