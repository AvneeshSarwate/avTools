import { useEffect, useRef, type SyntheticEvent } from 'react'
import {
  BaseBoxShapeUtil,
  createShapeId,
  type Editor,
  HTMLContainer,
  RecordProps,
  T,
  TLShape,
} from 'tldraw'
import { IN_PROCESS_ENGINE } from './inProcessEngine'

/**
 * A canvas view: mirrors a named engine canvas (`canvasSurface(name)` in a
 * module, helpers/canvas_surface.ts) onto the tldraw canvas, one `drawImage`
 * per animation frame. It only has something to mirror when the engine runs
 * in this same tab (`engine=inprocess`): the source is found by DOM lookup
 * under `#livecode-stage`, never through the sync transport, so a frame is a
 * GPU blit and no pixels cross any message boundary. It is a view, not an
 * entity: deleting it never touches the sketch, and the sketch never learns
 * the view's size — the source canvas keeps its own resolution and the view
 * letterboxes it.
 */
export const CANVAS_SURFACE_SHAPE_TYPE = 'canvas-surface'
export const CANVAS_SURFACE_ATTRIBUTE = 'data-livecode-canvas-surface'
const DEFAULT_WIDTH = 480
const DEFAULT_HEIGHT = 400
const HEADER_HEIGHT = 40

declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    [CANVAS_SURFACE_SHAPE_TYPE]: {
      w: number
      h: number
      surfaceName: string
      title: string
    }
  }
}

export type CanvasSurfaceShape = TLShape<typeof CANVAS_SURFACE_SHAPE_TYPE>

/** What one view is currently mirroring; read by the debug surface. */
export interface CanvasSurfaceDebugState {
  shapeId: string
  surfaceName: string
  sourceFound: boolean
  sourceWidth: number
  sourceHeight: number
  frameCount: number
}

const debugReaders = new Map<string, () => CanvasSurfaceDebugState>()

export function readCanvasSurfaceDebug(
  shapeId: string,
): CanvasSurfaceDebugState | null {
  return debugReaders.get(shapeId)?.() ?? null
}

export function listCanvasSurfaceDebug(): CanvasSurfaceDebugState[] {
  return Array.from(debugReaders.values(), (read) => read())
}

export class CanvasSurfaceShapeUtil extends BaseBoxShapeUtil<CanvasSurfaceShape> {
  static override type = CANVAS_SURFACE_SHAPE_TYPE
  static override props: RecordProps<CanvasSurfaceShape> = {
    w: T.number,
    h: T.number,
    surfaceName: T.string,
    title: T.string,
  }

  override canEdit(): boolean {
    return false
  }

  override canResize(): boolean {
    return true
  }

  override getDefaultProps(): CanvasSurfaceShape['props'] {
    return {
      w: DEFAULT_WIDTH,
      h: DEFAULT_HEIGHT,
      surfaceName: '',
      title: 'canvas',
    }
  }

  override component(shape: CanvasSurfaceShape) {
    return <CanvasSurfaceShapeComponent shape={shape} />
  }

  override getIndicatorPath(shape: CanvasSurfaceShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}

export function createCanvasSurfaceShape(
  editor: Editor,
  options:
    & Partial<CanvasSurfaceShape['props']>
    & { x?: number; y?: number; id?: CanvasSurfaceShape['id'] } = {},
) {
  const id = options.id ?? createShapeId()
  const surfaceName = options.surfaceName ?? ''
  const center = editor.getViewportPageBounds().center
  editor.createShape<CanvasSurfaceShape>({
    id,
    type: CANVAS_SURFACE_SHAPE_TYPE,
    x: options.x ?? center.x - DEFAULT_WIDTH / 2,
    y: options.y ?? center.y - DEFAULT_HEIGHT / 2,
    props: {
      w: options.w ?? DEFAULT_WIDTH,
      h: options.h ?? DEFAULT_HEIGHT,
      surfaceName,
      title: options.title ?? `canvas: ${surfaceName}`,
    },
  })
  editor.select(id)
  return id
}

/** The surface names currently present in this tab's engine stage. */
export function listCanvasSurfaceNames(): string[] {
  return Array.from(
    document.querySelectorAll(`#livecode-stage [${CANVAS_SURFACE_ATTRIBUTE}]`),
    (node) => node.getAttribute(CANVAS_SURFACE_ATTRIBUTE) ?? '',
  ).filter(Boolean).sort()
}

function findSourceCanvas(surfaceName: string): HTMLCanvasElement | null {
  if (!surfaceName) return null
  const escaped = typeof CSS !== 'undefined' && CSS.escape
    ? CSS.escape(surfaceName)
    : surfaceName.replace(/["\\]/g, '\\$&')
  return document.querySelector<HTMLCanvasElement>(
    `#livecode-stage [${CANVAS_SURFACE_ATTRIBUTE}="${escaped}"] canvas`,
  )
}

function CanvasSurfaceShapeComponent({ shape }: { shape: CanvasSurfaceShape }) {
  const { surfaceName, w, h } = shape.props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const emptyRef = useRef<HTMLDivElement | null>(null)
  const sizeRef = useRef({ w, h })
  sizeRef.current = { w, h }
  const stateRef = useRef({
    source: null as HTMLCanvasElement | null,
    frameCount: 0,
  })

  useEffect(() => {
    stateRef.current = { source: null, frameCount: 0 }
    let frame = 0
    let lastEmpty: boolean | null = null
    const tick = () => {
      frame = window.requestAnimationFrame(tick)
      const target = canvasRef.current
      if (!target) return
      const state = stateRef.current
      // Re-resolve when the source is gone (a relaunch replaces the canvas)
      // or not yet there; a query per frame while waiting is cheap.
      if (!state.source || !state.source.isConnected) {
        state.source = findSourceCanvas(surfaceName)
      }
      const source = state.source
      const empty = !source || source.width === 0 || source.height === 0
      if (empty !== lastEmpty) {
        lastEmpty = empty
        if (emptyRef.current) emptyRef.current.hidden = !empty
      }
      const dpr = window.devicePixelRatio || 1
      const bodyW = Math.max(1, Math.round(sizeRef.current.w * dpr))
      const bodyH = Math.max(
        1,
        Math.round((sizeRef.current.h - HEADER_HEIGHT) * dpr),
      )
      if (target.width !== bodyW || target.height !== bodyH) {
        target.width = bodyW
        target.height = bodyH
      }
      const ctx = target.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, bodyW, bodyH)
      if (empty || !source) return
      // Letterbox: the source keeps its own resolution and aspect ratio.
      const scale = Math.min(bodyW / source.width, bodyH / source.height)
      const drawW = source.width * scale
      const drawH = source.height * scale
      ctx.drawImage(
        source,
        (bodyW - drawW) / 2,
        (bodyH - drawH) / 2,
        drawW,
        drawH,
      )
      state.frameCount += 1
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [surfaceName])

  useEffect(() => {
    const shapeId = String(shape.id)
    debugReaders.set(shapeId, () => {
      const { source, frameCount } = stateRef.current
      const live = source?.isConnected ? source : null
      return {
        shapeId,
        surfaceName,
        sourceFound: live !== null,
        sourceWidth: live?.width ?? 0,
        sourceHeight: live?.height ?? 0,
        frameCount,
      }
    })
    return () => {
      debugReaders.delete(shapeId)
    }
  }, [shape.id, surfaceName])

  const stopCanvasEvent = (event: SyntheticEvent) => {
    event.stopPropagation()
  }

  return (
    <HTMLContainer
      className="canvas-surface-shape"
      style={{ width: w, height: h }}
    >
      <div className="canvas-surface-shape__header">
        <div className="canvas-surface-shape__title">
          <strong>{shape.props.title}</strong>
          <span>{surfaceName || '(unbound)'}</span>
        </div>
      </div>
      <div
        className="canvas-surface-shape__body"
        onPointerDown={stopCanvasEvent}
        onWheel={stopCanvasEvent}
      >
        <canvas ref={canvasRef} className="canvas-surface-shape__canvas" />
        <div ref={emptyRef} className="canvas-surface-shape__empty">
          {IN_PROCESS_ENGINE
            ? <>Waiting for a module to draw into <code>canvasSurface("{surfaceName || '…'}")</code>.</>
            : <>Canvas views mirror the engine's canvases only when the engine runs in this tab (<code>engine=inprocess</code>, the single-page bake).</>}
        </div>
      </div>
    </HTMLContainer>
  )
}
