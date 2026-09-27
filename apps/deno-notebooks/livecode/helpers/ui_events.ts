/**
 * Engine-to-UI events: `send({type, body})` reaches every connected UI. Fire
 * and forget; the tldraw app understands the `tldraw.*` types it documents.
 */
export { send } from "@avtools/livecode-engine/ui_events.ts";
export type {
  LivecodeEvent,
  UiEvent,
  UiEventBatch,
} from "@avtools/livecode-protocol";
