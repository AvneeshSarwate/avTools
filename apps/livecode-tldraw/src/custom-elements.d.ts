import type React from 'react'
import type { NoteData, NoteDataInput } from './pianoRollTypes'

declare module '@avtools/piano-roll'

/** One labeled playhead line on the roll; the component renders N of them. */
export interface PianoRollPlayheadMarker {
  id: string
  /** Quarter notes, the component's own unit. */
  position: number
  color?: string
}

/**
 * The imperative surface `<piano-roll-component>` exposes. Every member is
 * optional because the element is upgraded by the bundled web component after
 * React creates it: a ref can be read before the definition lands.
 */
export interface PianoRollComponentElement extends HTMLElement {
  width?: number
  height?: number
  initialNotes?: Array<[string, NoteData]>
  interactive?: boolean
  showControlPanel?: boolean
  setNotes?: (notes: NoteDataInput[]) => void
  setPlayheadMarkers?: (markers: PianoRollPlayheadMarker[]) => void
  getPlayheadMarkers?: () => PianoRollPlayheadMarker[]
  fitZoomToNotes?: () => void
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'piano-roll-component': React.DetailedHTMLProps<
        React.HTMLAttributes<PianoRollComponentElement>,
        PianoRollComponentElement
      >
    }
  }
}
