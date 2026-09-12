import {
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  BaseBoxShapeUtil,
  createShapeId,
  type Editor,
  HTMLContainer,
  RecordProps,
  T,
  TLShape,
} from 'tldraw'
import '@avtools/piano-roll'
import type {
  PianoRollComponentElement,
  PianoRollPlayheadMarker,
} from './custom-elements'
import type {
  NoteData,
  PianoRollData,
} from '@avtools/livecode-protocol'
import { usePianoRollsSync } from './syncRuntime'
import { PIANO_ROLL_ENTITY_TYPE } from './serverRequests'
import { useSignalPlayheadMarkers } from './useSignalPlayheadMarkers'
import {
  type AppliedPianoRollView,
  decidePianoRollHydration,
} from './pianoRollHydration'

export const PIANO_ROLL_SHAPE_TYPE = 'piano-roll-view'
// The Vue component's default stage contract; the browser E2E asserts the
// rendered Konva container so these values cannot silently drift apart.
const PIANO_ROLL_STAGE_WIDTH = 640
const PIANO_ROLL_STAGE_HEIGHT = 360
const PIANO_ROLL_EMBED_WIDTH = PIANO_ROLL_STAGE_WIDTH + 42
const PIANO_ROLL_EMBED_MIN_HEIGHT = PIANO_ROLL_STAGE_HEIGHT + 76
// At the default host width, the component's controls and scrollbars add 127px.
const PIANO_ROLL_EMBED_NATURAL_HEIGHT = PIANO_ROLL_STAGE_HEIGHT + 127
const SHAPE_BORDER = 2
const BODY_PADDING = 16
const HEADER_HEIGHT = 52
const DEFAULT_PIANO_ROLL_WIDTH =
  PIANO_ROLL_EMBED_WIDTH + BODY_PADDING + SHAPE_BORDER
const DEFAULT_PIANO_ROLL_HEIGHT =
  PIANO_ROLL_EMBED_NATURAL_HEIGHT + HEADER_HEIGHT + BODY_PADDING + SHAPE_BORDER

declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    [PIANO_ROLL_SHAPE_TYPE]: {
      w: number
      h: number
      rollName: string
      title: string
      showControlPanel: boolean
      interactive: boolean
    }
  }
}

export type PianoRollShape = TLShape<typeof PIANO_ROLL_SHAPE_TYPE>

// The element's imperative surface lives beside its JSX declaration in
// custom-elements.d.ts, so the ref type and the tag type cannot drift apart.
type PianoRollElement = PianoRollComponentElement

/** One roll view and the marker lines its element is currently rendering. */
export interface PianoRollMarkerViewState {
  shapeId: string
  rollName: string
  markers: PianoRollPlayheadMarker[]
}

// Markers live in the web component, not in React state or the tldraw store, so
// the debug surface reads them back out of the element through this registry.
const markerViewReaders = new Map<string, () => PianoRollMarkerViewState>()

export function listPianoRollMarkerViews(): PianoRollMarkerViewState[] {
  return Array.from(markerViewReaders.values(), (read) => read())
}

export class PianoRollShapeUtil extends BaseBoxShapeUtil<PianoRollShape> {
  static override type = PIANO_ROLL_SHAPE_TYPE
  static override props: RecordProps<PianoRollShape> = {
    w: T.number,
    h: T.number,
    rollName: T.string,
    title: T.string,
    showControlPanel: T.boolean,
    interactive: T.boolean,
  }

  override canScroll(): boolean {
    return true
  }

  override canEdit(): boolean {
    return true
  }

  override canResize(): boolean {
    return true
  }

  override getDefaultProps(): PianoRollShape['props'] {
    return {
      w: DEFAULT_PIANO_ROLL_WIDTH,
      h: DEFAULT_PIANO_ROLL_HEIGHT,
      rollName: 'melody',
      title: 'piano roll: melody',
      showControlPanel: true,
      interactive: true,
    }
  }

  override component(shape: PianoRollShape) {
    return <PianoRollShapeComponent shape={shape} />
  }

  override getIndicatorPath(shape: PianoRollShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}

export function createPianoRollShape(
  editor: Editor,
  options: Partial<PianoRollShape['props']> & {
    x?: number
    y?: number
    id?: PianoRollShape['id']
  } = {},
) {
  const id = options.id ?? createShapeId()
  const rollName = options.rollName ?? 'melody'
  const w = options.w ?? DEFAULT_PIANO_ROLL_WIDTH
  const h = options.h ?? DEFAULT_PIANO_ROLL_HEIGHT
  const center = editor.getViewportPageBounds().center
  editor.createShape<PianoRollShape>({
    id,
    type: PIANO_ROLL_SHAPE_TYPE,
    x: options.x ?? center.x - w / 2,
    y: options.y ?? center.y - h / 2,
    props: {
      w,
      h,
      rollName,
      title: options.title ?? `piano roll: ${rollName}`,
      showControlPanel: options.showControlPanel ?? true,
      interactive: options.interactive ?? true,
    },
  })
  editor.select(id)
  return id
}

function PianoRollShapeComponent({ shape }: { shape: PianoRollShape }) {
  const runtime = usePianoRollsSync(shape.props.rollName)
  const { redoRoll, setRoll, setRollCursor, undoRoll } = runtime
  const roll = runtime.rolls[shape.props.rollName]
  const hasRoll = roll !== undefined
  const elementRef = useRef<PianoRollElement | null>(null)
  const cursorWriteLane = useRef(Promise.resolve())
  const lastAppliedRollRef = useRef<AppliedPianoRollView | null>(null)
  const lastMarkerKeyRef = useRef<string | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)
  const originId = useMemo(() => `piano-roll-view-${shape.id}`, [shape.id])
  const setElementRef = useCallback((element: PianoRollElement | null) => {
    elementRef.current = element
    if (!element) return
    element.width = PIANO_ROLL_STAGE_WIDTH
    element.height = PIANO_ROLL_STAGE_HEIGHT
    element.interactive = shape.props.interactive
    element.showControlPanel = shape.props.showControlPanel
  }, [shape.props.interactive, shape.props.showControlPanel])

  // Every live signal anchored at this roll, as marker lines. Ended signals and
  // a dropped signals socket both render as no markers at all: a marker frozen
  // where a stopped process left it would read as a still-playing one.
  const markers = useSignalPlayheadMarkers(
    PIANO_ROLL_ENTITY_TYPE,
    shape.props.rollName,
  )

  useEffect(() => {
    const el = elementRef.current
    if (!el) {
      // A missing roll removes the custom element. Ensure a later recreation
      // receives its markers even if their values did not change meanwhile.
      lastMarkerKeyRef.current = null
      return
    }
    // The provider already coalesces snapshots to one per frame; this key skips
    // the redraw a re-pushed identical marker set would otherwise cost.
    const key = JSON.stringify(markers)
    if (lastMarkerKeyRef.current === key) return
    lastMarkerKeyRef.current = key
    el.setPlayheadMarkers?.(markers)
  }, [markers, roll])

  useEffect(() => {
    const shapeId = String(shape.id)
    markerViewReaders.set(shapeId, () => ({
      shapeId,
      rollName: shape.props.rollName,
      // Read back from the element rather than from `markers`: what the roll is
      // rendering is the thing worth observing.
      markers: elementRef.current?.getPlayheadMarkers?.() ?? [],
    }))
    return () => {
      markerViewReaders.delete(shapeId)
    }
  }, [shape.id, shape.props.rollName])

  useEffect(() => {
    const el = elementRef.current
    if (!el || !roll) {
      // Deletion unmounts the element. A recreated entity can reuse the same
      // revision and must still hydrate the replacement element.
      lastAppliedRollRef.current = null
      return
    }
    el.setPlayStartPosition?.(roll.data.playStartPosition ?? 0)
    const lastApplied = lastAppliedRollRef.current
    const decision = decidePianoRollHydration(
      lastApplied,
      shape.props.rollName,
      el,
      roll,
      originId,
    )
    if (decision.kind === 'ignore') return
    // Suppress echoes of this view's own edits independently of HTTP-response
    // timing: the websocket snapshot carrying the new rev can arrive before
    // /piano-roll/set resolves, so we cannot key suppression on a recorded rev.
    // The originating view already holds this state in its component, so it
    // never needs its own echo re-applied — regardless of rev. Undo/redo use a
    // distinct origin (see undoRoll/redoRoll below), so their results still
    // apply here. Accepted divergence: server-side note normalization (assigned
    // ids, velocity defaults) is not echoed back into the originating view; the
    // next foreign-origin application syncs it.
    // Initial application (lastAppliedRollRef.current === null) always runs, so a
    // page reload restores the latest state even when updatedBy === originId
    // (originId is persistent, derived from the shape id).
    if (decision.kind === 'accept') {
      lastAppliedRollRef.current = decision.applied
      return
    }
    lastAppliedRollRef.current = decision.applied
    el.setNotes?.(roll.data.notes, { silent: true })
    if (roll.rev === 1) {
      window.setTimeout(() => el.fitZoomToNotes?.(), 0)
    }
  }, [originId, roll, shape.props.rollName])

  useEffect(() => {
    const el = elementRef.current
    if (!el) return

    const handleNotesUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<[Array<[string, NoteData]>]>
      const notesEntries = customEvent.detail?.[0]
      if (!notesEntries || !shape.props.interactive) return
      const data: PianoRollData = {
        notes: notesEntries.map(([, note]) => note),
      }
      void setRoll(shape.props.rollName, data, {
        originId,
        label: `Edit ${shape.props.rollName}`,
      })
        .then((result) => {
          if (result.ok) {
            setWriteError(null)
            return
          }
          setWriteError(result.error)
          if (result.current) el.setNotes?.(result.current.data.notes, { silent: true })
        })
        .catch((error: unknown) => {
          setWriteError(error instanceof Error ? error.message : String(error))
        })
    }

    const handleCursorChange = (event: Event) => {
      const position = (event as CustomEvent<[number]>).detail?.[0]
      if (!shape.props.interactive || !Number.isFinite(position)) return
      cursorWriteLane.current = cursorWriteLane.current.catch(() => {}).then(async () => {
        const result = await setRollCursor(shape.props.rollName, position, { originId })
        if (elementRef.current !== el) return
        if (!result.ok) {
          setWriteError(result.error)
          if (result.current) {
            el.setPlayStartPosition?.(result.current.data.playStartPosition ?? 0)
          }
        } else setWriteError(null)
      }).catch((error: unknown) => {
        if (elementRef.current === el) {
          setWriteError(error instanceof Error ? error.message : String(error))
        }
      })
    }
    el.addEventListener('cursor-change', handleCursorChange)
    el.addEventListener('notes-update', handleNotesUpdate)
    return () => {
      el.removeEventListener('cursor-change', handleCursorChange)
      el.removeEventListener('notes-update', handleNotesUpdate)
    }
  }, [hasRoll, originId, setRoll, setRollCursor, shape.props.interactive, shape.props.rollName])

  const stopCanvasEvent = (event: SyntheticEvent) => {
    event.stopPropagation()
  }

  return (
    <HTMLContainer
      className="piano-roll-shape"
      style={{ width: shape.props.w, height: shape.props.h }}
    >
      <div className="piano-roll-shape__header">
        <div className="piano-roll-shape__title">
          <strong>{shape.props.title}</strong>
          <span>
            {runtime.connectionStatus} | rev {roll?.rev ?? '-'} | snapshot{' '}
            {runtime.latestSeq ?? '-'}
          </span>
        </div>
        {writeError ? (
          <span className="entity-error-badge" title={writeError}>
            write rejected
          </span>
        ) : null}
        <div
          className="piano-roll-shape__actions"
          onPointerDown={stopCanvasEvent}
        >
          <button
            type="button"
            disabled={!roll?.canUndo}
            onClick={() =>
              void undoRoll(shape.props.rollName, `${originId}:history`)
            }
          >
            Undo object
          </button>
          <button
            type="button"
            disabled={!roll?.canRedo}
            onClick={() =>
              void redoRoll(shape.props.rollName, `${originId}:history`)
            }
          >
            Redo object
          </button>
        </div>
      </div>
      <div
        className="piano-roll-shape__body"
        onPointerDown={stopCanvasEvent}
        onPointerMove={stopCanvasEvent}
        onPointerUp={stopCanvasEvent}
        onPointerCancel={stopCanvasEvent}
        onTouchStart={stopCanvasEvent}
        onKeyDownCapture={stopCanvasEvent}
        onWheel={stopCanvasEvent}
      >
        {roll ? (
          <div
            className="piano-roll-shape__viewport"
            style={{ width: PIANO_ROLL_EMBED_WIDTH }}
          >
            <piano-roll-component
              ref={setElementRef}
              style={{
                width: PIANO_ROLL_EMBED_WIDTH,
                minHeight: PIANO_ROLL_EMBED_MIN_HEIGHT,
              }}
            />
          </div>
        ) : (
          <div className="piano-roll-shape__empty">
            Waiting for <code>{shape.props.rollName}</code> from the server...
            {runtime.connectionError ? (
              <span>{runtime.connectionError}</span>
            ) : null}
          </div>
        )}
      </div>
    </HTMLContainer>
  )
}
