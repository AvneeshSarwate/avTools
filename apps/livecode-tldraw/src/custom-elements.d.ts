import type React from "react";
import type {
  AnimationTimelineData,
  DrawingDocument,
  NoteData,
  NoteDataInput,
} from "@avtools/livecode-protocol";

declare module "@avtools/piano-roll";
declare module "@avtools/animation-editor";
declare module "@avtools/handwriting-canvas";

/** One labeled playhead line in a component's native position unit. */
export interface PlayheadMarker {
  id: string;
  position: number;
  color?: string;
}

export type PianoRollPlayheadMarker = PlayheadMarker;

/**
 * The imperative surface `<piano-roll-component>` exposes. Every member is
 * optional because the element is upgraded by the bundled web component after
 * React creates it: a ref can be read before the definition lands.
 */
export interface PianoRollComponentElement extends HTMLElement {
  width?: number;
  height?: number;
  initialNotes?: Array<[string, NoteData]>;
  interactive?: boolean;
  showControlPanel?: boolean;
  setNotes?: (notes: NoteDataInput[]) => void;
  setPlayheadMarkers?: (markers: PlayheadMarker[]) => void;
  getPlayheadMarkers?: () => PlayheadMarker[];
  fitZoomToNotes?: () => void;
}

export interface AnimationEditorComponentElement extends HTMLElement {
  interactive?: boolean;
  setTimeline?: (value: AnimationTimelineData) => void;
  getTimeline?: () => AnimationTimelineData;
  setPlayheadMarkers?: (markers: PlayheadMarker[]) => void;
  getPlayheadMarkers?: () => PlayheadMarker[];
}

/**
 * The imperative surface `<handwriting-canvas>` exposes. Documents are the
 * lossless form (`@avtools/drawing-document`); the element emits
 * `document-update` (detail `[DrawingDocument]`) on every committed edit and
 * never while a document is being pushed in.
 */
export interface HandwritingCanvasElement extends HTMLElement {
  width?: number | string;
  height?: number | string;
  showTimeline?: boolean;
  showVisualizations?: boolean;
  showSnapshots?: boolean;
  showRescale?: boolean;
  setDrawingDocument?: (value: DrawingDocument) => void;
  getDrawingDocument?: () => DrawingDocument;
  setCanvasState?: (serialized: string) => void;
  getCanvasState?: () => string;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "piano-roll-component": React.DetailedHTMLProps<
        React.HTMLAttributes<PianoRollComponentElement>,
        PianoRollComponentElement
      >;
      "animation-editor-component": React.DetailedHTMLProps<
        React.HTMLAttributes<AnimationEditorComponentElement>,
        AnimationEditorComponentElement
      >;
      "handwriting-canvas": React.DetailedHTMLProps<
        React.HTMLAttributes<HandwritingCanvasElement>,
        HandwritingCanvasElement
      >;
    }
  }
}
