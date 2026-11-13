import { useEffect } from "react";
import type { Editor, TLShapeId } from "tldraw";
import type { UiEvent, UiEventBatch } from "@avtools/livecode-protocol";
import { entityRefForCanvasView } from "./canvasViews";
import { requestPianoRollFit } from "./PianoRollShape";

// Engine-to-UI events on this page. Every sync transport hands its `uiEvents`
// batches to `deliverUiEventBatch`; anything on the page can listen with
// `subscribeUiEvents`. The tldraw handlers below are one such listener: the
// `tldraw.*` types are this app's vocabulary, not the platform's, and other
// UIs are free to ignore them or define their own. Events are fire and
// forget: nothing is replayed to a listener that subscribes late.

type UiEventListener = (event: UiEvent) => void;

const listeners = new Set<UiEventListener>();

/** Called by the sync transports; one call per received batch. */
export function deliverUiEventBatch(batch: UiEventBatch): void {
  if (batch.dropped) {
    console.warn(
      `[livecode-tldraw] engine dropped ${batch.dropped} UI events (queue bound)`,
    );
  }
  if (!Array.isArray(batch.events)) return;
  for (const event of batch.events) {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error("[livecode-tldraw] UI event listener failed", error);
      }
    }
  }
}

/** Receive every engine UI event from now on, until the returned function runs. */
export function subscribeUiEvents(listener: UiEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type TldrawUiEventHandler = (editor: Editor, body: unknown) => void;

const CAMERA_ANIMATION = { animation: { duration: 250 } };

/**
 * `tldraw.focusEntity` `{type, name, zoom?: "fit" | "keep"}`: select the first
 * view on this page bound to that entity and bring it into view. `fit`
 * (default) zooms to the view; `keep` pans without changing zoom. No bound
 * view means nothing happens: the UI never creates a view on the engine's say.
 */
function focusEntity(editor: Editor, body: unknown): void {
  if (!body || typeof body !== "object") return;
  const { type, name, zoom } = body as {
    type?: unknown;
    name?: unknown;
    zoom?: unknown;
  };
  if (typeof type !== "string" || typeof name !== "string") return;
  const shape = editor.getCurrentPageShapes().find((candidate) => {
    const ref = entityRefForCanvasView(candidate);
    return ref?.type === type && ref.name === name;
  });
  if (!shape) return;
  const id = shape.id as TLShapeId;
  editor.select(id);
  if (zoom === "keep") {
    const bounds = editor.getShapePageBounds(id);
    if (bounds) editor.centerOnPoint(bounds.center, CAMERA_ANIMATION);
  } else {
    editor.zoomToSelection(CAMERA_ANIMATION);
  }
}

/**
 * `tldraw.fitPianoRoll` `{name, rev?}`: frame the notes in every view of that
 * roll. With `rev`, a view that has not received that revision yet fits when
 * it does, since the event is not ordered against the roll's sync.
 */
function fitPianoRoll(_editor: Editor, body: unknown): void {
  if (!body || typeof body !== "object") return;
  const { name, rev } = body as { name?: unknown; rev?: unknown };
  if (typeof name !== "string") return;
  requestPianoRollFit(
    name,
    typeof rev === "number" && Number.isFinite(rev) ? rev : undefined,
  );
}

export const TLDRAW_UI_EVENT_HANDLERS: Readonly<
  Record<string, TldrawUiEventHandler>
> = {
  "tldraw.focusEntity": focusEntity,
  "tldraw.fitPianoRoll": fitPianoRoll,
};

/** Route this app's `tldraw.*` events to the mounted editor. */
export function useTldrawUiEvents(editor: Editor | null): void {
  useEffect(() => {
    if (!editor) return;
    return subscribeUiEvents((event) => {
      const handler = Object.hasOwn(TLDRAW_UI_EVENT_HANDLERS, event.type)
        ? TLDRAW_UI_EVENT_HANDLERS[event.type]
        : undefined;
      handler?.(editor, event.body);
    });
  }, [editor]);
}
