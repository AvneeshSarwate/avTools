import { useEffect, useMemo, useRef, type SyntheticEvent } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, RecordProps, T, TLShape } from 'tldraw'
import '@avtools/piano-roll'
import type { NoteData, NoteDataInput, PianoRollData } from './pianoRollTypes'
import { usePianoRollRuntime } from './pianoRollRuntime'

export const PIANO_ROLL_SHAPE_TYPE = 'piano-roll-view'

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

interface PianoRollElement extends HTMLElement {
  width?: number
  height?: number
  initialNotes?: Array<[string, NoteData]>
  interactive?: boolean
  showControlPanel?: boolean
  setNotes?: (notes: NoteDataInput[]) => void
  fitZoomToNotes?: () => void
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
      w: 720,
      h: 500,
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

function PianoRollShapeComponent({ shape }: { shape: PianoRollShape }) {
  const runtime = usePianoRollRuntime()
  const roll = runtime.rolls[shape.props.rollName]
  const elementRef = useRef<PianoRollElement | null>(null)
  const lastAppliedRevRef = useRef<number | null>(null)
  const originId = useMemo(() => `piano-roll-view-${shape.id}`, [shape.id])

  useEffect(() => {
    const el = elementRef.current
    if (!el) return
    el.width = Math.max(120, shape.props.w - 24)
    el.height = Math.max(160, shape.props.h - 104)
    el.interactive = shape.props.interactive
    el.showControlPanel = shape.props.showControlPanel
  }, [
    shape.props.h,
    shape.props.interactive,
    shape.props.showControlPanel,
    shape.props.w,
  ])

  useEffect(() => {
    const el = elementRef.current
    if (!el || !roll) return
    if (lastAppliedRevRef.current === roll.rev) return
    lastAppliedRevRef.current = roll.rev
    el.setNotes?.(roll.data.notes)
    if (roll.rev === 1) {
      window.setTimeout(() => el.fitZoomToNotes?.(), 0)
    }
  }, [roll])

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
      void runtime.setRoll(shape.props.rollName, data, {
        originId,
        label: `Edit ${shape.props.rollName}`,
      })
    }

    el.addEventListener('notes-update', handleNotesUpdate)
    return () => el.removeEventListener('notes-update', handleNotesUpdate)
  }, [originId, runtime, shape.props.interactive, shape.props.rollName])

  const stopCanvasEvent = (event: SyntheticEvent) => {
    event.stopPropagation()
  }

  const stageWidth = Math.max(120, shape.props.w - 24)
  const stageHeight = Math.max(160, shape.props.h - 104)

  return (
    <HTMLContainer
      className="piano-roll-shape"
      style={{ width: shape.props.w, height: shape.props.h }}
      onPointerDown={stopCanvasEvent}
      onPointerMove={stopCanvasEvent}
      onPointerUp={stopCanvasEvent}
      onWheel={stopCanvasEvent}
    >
      <div className="piano-roll-shape__header">
        <div className="piano-roll-shape__title">
          <strong>{shape.props.title}</strong>
          <span>
            {runtime.connectionStatus} | rev {roll?.rev ?? '-'} | snapshot{' '}
            {runtime.latestSeq ?? '-'}
          </span>
        </div>
        <div className="piano-roll-shape__actions" onPointerDown={stopCanvasEvent}>
          <button
            type="button"
            disabled={!roll?.canUndo}
            onClick={() => void runtime.undoRoll(shape.props.rollName, originId)}
          >
            Undo object
          </button>
          <button
            type="button"
            disabled={!roll?.canRedo}
            onClick={() => void runtime.redoRoll(shape.props.rollName, originId)}
          >
            Redo object
          </button>
        </div>
      </div>
      <div className="piano-roll-shape__body">
        {roll ? (
          <piano-roll-component
            ref={elementRef}
            style={{ width: stageWidth + 24, height: stageHeight + 72 }}
          />
        ) : (
          <div className="piano-roll-shape__empty">
            Waiting for <code>{shape.props.rollName}</code> from the server...
            {runtime.connectionError ? <span>{runtime.connectionError}</span> : null}
          </div>
        )}
      </div>
    </HTMLContainer>
  )
}
