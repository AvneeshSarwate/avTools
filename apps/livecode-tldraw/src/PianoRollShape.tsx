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
  useEditor,
} from 'tldraw'
import '@avtools/piano-roll'
import type {
  PianoRollComponentElement,
  PianoRollPlayheadMarker,
} from './custom-elements'
import type {
  NoteData,
  PianoRollData,
  PianoRollViewState,
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
// rendered Konva container so these values cannot silently drift apart. The
// stage follows the shape: a resized view grows or shrinks it by the same
// amount (see stageSizeFor), so the default shape gets exactly this size.
const PIANO_ROLL_STAGE_WIDTH = 640
const PIANO_ROLL_STAGE_HEIGHT = 360
const PIANO_ROLL_MIN_STAGE_WIDTH = 320
const PIANO_ROLL_MIN_STAGE_HEIGHT = 160
const PIANO_ROLL_CHROME_WIDTH = 42
const PIANO_ROLL_EMBED_WIDTH = PIANO_ROLL_STAGE_WIDTH + PIANO_ROLL_CHROME_WIDTH
const PIANO_ROLL_EMBED_MIN_CHROME = 76
// At the default host width, the component's controls and scrollbars add 144px
// (the control row wraps once at a 640px stage).
const PIANO_ROLL_EMBED_NATURAL_HEIGHT = PIANO_ROLL_STAGE_HEIGHT + 144
const SHAPE_BORDER = 2
const BODY_PADDING = 16
const HEADER_HEIGHT = 52
const DEFAULT_PIANO_ROLL_WIDTH =
  PIANO_ROLL_EMBED_WIDTH + BODY_PADDING + SHAPE_BORDER
const DEFAULT_PIANO_ROLL_HEIGHT =
  PIANO_ROLL_EMBED_NATURAL_HEIGHT + HEADER_HEIGHT + BODY_PADDING + SHAPE_BORDER

/** Konva stage size for a shape: the default stage plus the shape's growth. */
function stageSizeFor(w: number, h: number): { width: number; height: number } {
  return {
    width: Math.max(
      PIANO_ROLL_MIN_STAGE_WIDTH,
      Math.round(PIANO_ROLL_STAGE_WIDTH + (w - DEFAULT_PIANO_ROLL_WIDTH)),
    ),
    height: Math.max(
      PIANO_ROLL_MIN_STAGE_HEIGHT,
      Math.round(PIANO_ROLL_STAGE_HEIGHT + (h - DEFAULT_PIANO_ROLL_HEIGHT)),
    ),
  }
}

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

// A view's zoom and scroll are view state: they live in the shape's meta (no
// schema change, saved with canvas layout), never in the roll entity, so two
// views of one roll can differ and scrolling never edits musical content.
const VIEW_META_KEY = 'pianoRollView'

export function pianoRollViewFromMeta(meta: unknown): PianoRollViewState | null {
  const view = (meta as Record<string, unknown> | undefined)?.[VIEW_META_KEY] as
    | Record<string, unknown>
    | undefined
  if (!view) return null
  const { quarterNoteWidth, noteHeight, startBeat, topRow } = view
  const values = [quarterNoteWidth, noteHeight, startBeat, topRow]
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return null
  }
  return view as unknown as PianoRollViewState
}

/** The view as a plain JSON object, which is what tldraw accepts in meta. */
function viewMeta(view: PianoRollViewState) {
  return {
    quarterNoteWidth: view.quarterNoteWidth,
    noteHeight: view.noteHeight,
    startBeat: view.startBeat,
    topRow: view.topRow,
  }
}

function roundView(view: PianoRollViewState): PianoRollViewState {
  const round = (value: number) => Math.round(value * 1000) / 1000
  return {
    quarterNoteWidth: round(view.quarterNoteWidth),
    noteHeight: round(view.noteHeight),
    startBeat: round(view.startBeat),
    topRow: round(view.topRow),
  }
}

/** Let the element lay out at its real size before framing anything. */
function afterLayout(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn))
}

const fitRequesters = new Map<
  string,
  { rollName: string; request: (minRev?: number) => void }
>()

/**
 * Frame the notes in every view of `rollName`. With `minRev`, a view that has
 * not yet received that revision fits when it does: the request may arrive
 * before the notes it is about.
 */
export function requestPianoRollFit(rollName: string, minRev?: number): void {
  for (const entry of fitRequesters.values()) {
    if (entry.rollName === rollName) entry.request(minRev)
  }
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
    view?: PianoRollViewState
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
    ...(options.view ? { meta: { [VIEW_META_KEY]: viewMeta(options.view) } } : {}),
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
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const cursorWriteLane = useRef(Promise.resolve())
  const lastAppliedRollRef = useRef<AppliedPianoRollView | null>(null)
  const lastMarkerKeyRef = useRef<string | null>(null)
  const pendingFitRevRef = useRef<number | null>(null)
  const saveViewTimerRef = useRef<number | undefined>(undefined)
  const editor = useEditor()
  const [writeError, setWriteError] = useState<string | null>(null)
  const originId = useMemo(() => `piano-roll-view-${shape.id}`, [shape.id])
  const stageSize = stageSizeFor(shape.props.w, shape.props.h)
  const setElementRef = useCallback((element: PianoRollElement | null) => {
    elementRef.current = element
    if (!element) return
    element.width = stageSize.width
    element.height = stageSize.height
    element.interactive = shape.props.interactive
    element.showControlPanel = shape.props.showControlPanel
  }, [shape.props.interactive, shape.props.showControlPanel, stageSize.width, stageSize.height])

  // Write the element's current view into the shape's meta, outside undo
  // history. Only user gestures and explicit fits call this: the automatic
  // first framing on load must not mark the project changed.
  const saveView = useCallback(() => {
    const view = elementRef.current?.getView?.()
    const current = editor.getShape(shape.id)
    if (!view || !current) return
    const next = roundView(view)
    const saved = pianoRollViewFromMeta(current.meta)
    if (saved && JSON.stringify(saved) === JSON.stringify(next)) return
    editor.run(() => {
      editor.updateShape({
        id: shape.id,
        type: PIANO_ROLL_SHAPE_TYPE,
        meta: { ...current.meta, [VIEW_META_KEY]: viewMeta(next) },
      })
    }, { history: 'ignore' })
  }, [editor, shape.id])

  const scheduleSaveView = useCallback(() => {
    window.clearTimeout(saveViewTimerRef.current)
    saveViewTimerRef.current = window.setTimeout(saveView, 400)
  }, [saveView])

  useEffect(() => () => window.clearTimeout(saveViewTimerRef.current), [])

  const fitNow = useCallback(() => {
    afterLayout(() => {
      elementRef.current?.fitToContent?.()
      saveView()
    })
  }, [saveView])

  useEffect(() => {
    const shapeId = String(shape.id)
    fitRequesters.set(shapeId, {
      rollName: shape.props.rollName,
      request: (minRev) => {
        const appliedRev = lastAppliedRollRef.current?.entity.rev
        if (
          minRev === undefined ||
          (appliedRev !== undefined && appliedRev >= minRev)
        ) {
          fitNow()
        } else {
          pendingFitRevRef.current = Math.max(pendingFitRevRef.current ?? 0, minRev)
        }
      },
    })
    return () => {
      fitRequesters.delete(shapeId)
    }
  }, [fitNow, shape.id, shape.props.rollName])

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
    const firstForElement = lastApplied === null || lastApplied.element !== el
    const settlePendingFit = () => {
      const pending = pendingFitRevRef.current
      if (pending !== null && roll.rev >= pending) {
        pendingFitRevRef.current = null
        fitNow()
      }
    }
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
      settlePendingFit()
      return
    }
    lastAppliedRollRef.current = decision.applied
    el.setNotes?.(roll.data.notes, { silent: true })
    if (firstForElement) {
      // A view opens where it was left, or framed on its notes.
      const saved = pianoRollViewFromMeta(editor.getShape(shape.id)?.meta)
      afterLayout(() => {
        if (saved) el.setView?.(saved)
        else el.fitToContent?.()
      })
    }
    settlePendingFit()
  }, [editor, fitNow, originId, roll, shape.id, shape.props.rollName])

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

  // Keyboard shield for the canvas, as a native bubble-phase listener on the
  // body. Both phases of a React handler would be wrong here: React delegates
  // to the app root, above tldraw's `.tl-container`, so an `onKeyDownCapture`
  // stop kills the event before it ever descends to the roll's own handler
  // (arrow-key note moves, delete, undo, copy/paste), while an `onKeyDown` stop
  // runs only after tldraw's native container listener has already nudged the
  // shape. A listener on the body sits between the two: the embedded component
  // sees the key first, then propagation ends short of tldraw.
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const shieldKey = (event: KeyboardEvent) => event.stopPropagation()
    body.addEventListener('keydown', shieldKey)
    body.addEventListener('keyup', shieldKey)
    // Scrolls, zooms, and the fit button end in one of these; the view is
    // read back after the gesture settles.
    body.addEventListener('wheel', scheduleSaveView, { passive: true })
    body.addEventListener('pointerup', scheduleSaveView)
    return () => {
      body.removeEventListener('keydown', shieldKey)
      body.removeEventListener('keyup', shieldKey)
      body.removeEventListener('wheel', scheduleSaveView)
      body.removeEventListener('pointerup', scheduleSaveView)
    }
  }, [hasRoll, scheduleSaveView])

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
        ref={bodyRef}
        className="piano-roll-shape__body"
        onPointerDown={stopCanvasEvent}
        onPointerMove={stopCanvasEvent}
        onPointerUp={stopCanvasEvent}
        onPointerCancel={stopCanvasEvent}
        onTouchStart={stopCanvasEvent}
        onWheel={stopCanvasEvent}
      >
        {roll ? (
          <div
            className="piano-roll-shape__viewport"
            style={{ width: stageSize.width + PIANO_ROLL_CHROME_WIDTH }}
          >
            <piano-roll-component
              ref={setElementRef}
              style={{
                width: stageSize.width + PIANO_ROLL_CHROME_WIDTH,
                minHeight: stageSize.height + PIANO_ROLL_EMBED_MIN_CHROME,
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
