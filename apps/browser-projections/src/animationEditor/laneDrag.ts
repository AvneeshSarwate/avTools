import type Konva from 'konva'
import type { TrackElement, TrackRuntime } from './types'

/** Adding requires a stationary gesture that began AND ended on the background. */
export function bindLaneBackgroundClick(stage: Konva.Stage, add: () => void) {
  let origin: { x: number; y: number } | null = null
  const cancel = () => {
    origin = null
  }
  stage.on('mousedown touchstart', (event) => {
    const pointer = stage.getPointerPosition()
    origin = event.target === stage && pointer ? { ...pointer } : null
  })
  stage.on('mousemove touchmove mouseup touchend', () => {
    const pointer = stage.getPointerPosition()
    if (
      origin &&
      pointer &&
      Math.max(Math.abs(pointer.x - origin.x), Math.abs(pointer.y - origin.y)) >=
        stage.dragDistance()
    )
      cancel()
  })
  stage.on('dragstart', cancel)
  stage.on('click tap', (event) => {
    const isClick = origin && event.target === stage
    cancel()
    if (isClick) add()
  })
  return cancel
}

/** A gesture owns a preview, never a mutable reference into authoritative data. */
export function createLaneDrag(options: {
  tracks: () => TrackRuntime[]
  frontTrackId: () => string | undefined
  duration: () => number
  onCancel: () => void
}) {
  let active: {
    node: Konva.Node
    trackId: string
    elementId: string
    baseline: string
    duration: number
    offset: { x: number; y: number }
    time: number
    value?: number
  } | null = null

  let prepared: { node: Konva.Node; offset: { x: number; y: number } } | null = null

  function fingerprint(track: TrackRuntime, element: TrackElement): string {
    const index = track.elementData.findIndex((e) => e.id === element.id)
    // Number drags may not cross neighbours. A changed constraint cancels too.
    const neighbours =
      track.def.fieldType === 'number'
        ? [track.elementData[index - 1], track.elementData[index + 1]].map(
            (e) => e && [e.id, e.time]
          )
        : undefined
    return JSON.stringify([track.def.fieldType, track.low, track.high, element, neighbours])
  }

  function valid(): boolean {
    if (!active) return false
    const track = options.tracks().find((t) => t.id === active!.trackId)
    const element = track?.elementData.find((e) => e.id === active!.elementId)
    return (
      !!track &&
      !!element &&
      options.frontTrackId() === track.id &&
      options.duration() === active.duration &&
      fingerprint(track, element) === active.baseline
    )
  }

  function cancel(): void {
    if (!active) return
    const node = active.node
    // stopDrag/destroy can synchronously emit dragend. Clear ownership FIRST.
    active = null
    node.stopDrag()
    options.onCancel()
  }

  return {
    get active() {
      return active
    },
    valid,
    cancel,
    prepare(node: Konva.Node) {
      const pointer = node.getStage()?.getPointerPosition()
      prepared = pointer
        ? { node, offset: { x: pointer.x - node.x(), y: pointer.y - node.y() } }
        : null
    },
    begin(node: Konva.Node, track: TrackRuntime, element: TrackElement) {
      cancel()
      const pointer = node.getStage()?.getPointerPosition() ?? node.position()
      active = {
        node,
        trackId: track.id,
        elementId: element.id,
        baseline: fingerprint(track, element),
        duration: options.duration(),
        offset:
          prepared?.node === node
            ? prepared.offset
            : { x: pointer.x - node.x(), y: pointer.y - node.y() },
        time: element.time,
        value: typeof element.value === 'number' ? element.value : undefined
      }
    },
    position() {
      if (!active) return null
      const pointer = active.node.getStage()?.getPointerPosition()
      return pointer && { x: pointer.x - active.offset.x, y: pointer.y - active.offset.y }
    },
    finish(event: Konva.KonvaEventObject<MouseEvent | TouchEvent | PointerEvent>) {
      if (!active) return null
      // Only an actual release commits. Teardown and cancellation never do.
      if (
        !valid() ||
        !event.evt ||
        !['mouseup', 'touchend', 'pointerup'].includes(event.evt.type)
      ) {
        cancel()
        return null
      }
      const finished = active
      active = null
      return finished
    }
  }
}
