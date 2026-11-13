import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import {
  BaseBoxShapeUtil,
  createShapeId,
  type Editor,
  HTMLContainer,
  RecordProps,
  T,
  TLShape,
} from 'tldraw'
import { useParamsSync, useSignalsSync } from './syncRuntime'
import {
  advanceSignalScopeSamples,
  type SignalScopeSample,
} from './signalRendering'

export const SIGNAL_SCOPE_SHAPE_TYPE = 'signal-scope'
const DEFAULT_SCOPE_WIDTH = 280
const DEFAULT_SCOPE_HEIGHT = 160
const DEFAULT_WINDOW_SEC = 10
/** Hard cap on retained samples, so a huge window cannot grow without bound. */
const MAX_SCOPE_SAMPLES = 4_000

export type SignalScopeSourceType = 'signal' | 'params'

declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    [SIGNAL_SCOPE_SHAPE_TYPE]: {
      w: number
      h: number
      sourceType: SignalScopeSourceType
      name: string
      /** Dot-joined field path into the bound value; empty for whole values. */
      path: string
      windowSec: number
      title: string
    }
  }
}

export type SignalScopeShape = TLShape<typeof SIGNAL_SCOPE_SHAPE_TYPE>

/** What one scope is currently accumulating; read by the debug surface. */
export interface SignalScopeDebugState {
  shapeId: string
  sourceType: SignalScopeSourceType
  name: string
  path: string
  windowSec: number
  sampleCount: number
  latest: number | null
  min: number | null
  max: number | null
  distinctCount: number
  ended: boolean
  waiting: boolean
}

// Scopes are imperative by design (no React state per sample), so the debug
// surface reads them through this registry rather than through the store.
const scopeDebugReaders = new Map<string, () => SignalScopeDebugState>()

export function readSignalScopeDebug(
  shapeId: string,
): SignalScopeDebugState | null {
  return scopeDebugReaders.get(shapeId)?.() ?? null
}

export function listSignalScopeDebug(): SignalScopeDebugState[] {
  return Array.from(scopeDebugReaders.values(), (read) => read())
}

export class SignalScopeShapeUtil extends BaseBoxShapeUtil<SignalScopeShape> {
  static override type = SIGNAL_SCOPE_SHAPE_TYPE
  static override props: RecordProps<SignalScopeShape> = {
    w: T.number,
    h: T.number,
    sourceType: T.literalEnum('signal', 'params'),
    name: T.string,
    path: T.string,
    windowSec: T.number,
    title: T.string,
  }

  override canEdit(): boolean {
    return true
  }

  override canResize(): boolean {
    return true
  }

  override getDefaultProps(): SignalScopeShape['props'] {
    return {
      w: DEFAULT_SCOPE_WIDTH,
      h: DEFAULT_SCOPE_HEIGHT,
      sourceType: 'signal',
      name: '',
      path: '',
      windowSec: DEFAULT_WINDOW_SEC,
      title: 'scope',
    }
  }

  override component(shape: SignalScopeShape) {
    return <SignalScopeShapeComponent shape={shape} />
  }

  override getIndicatorPath(shape: SignalScopeShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}

export function createSignalScopeShape(
  editor: Editor,
  options:
    & Partial<SignalScopeShape['props']>
    & { x?: number; y?: number; id?: SignalScopeShape['id'] } = {},
) {
  const id = options.id ?? createShapeId()
  const sourceType = options.sourceType ?? 'signal'
  const name = options.name ?? ''
  const path = options.path ?? ''
  const center = editor.getViewportPageBounds().center
  editor.createShape<SignalScopeShape>({
    id,
    type: SIGNAL_SCOPE_SHAPE_TYPE,
    x: options.x ?? center.x - DEFAULT_SCOPE_WIDTH / 2,
    y: options.y ?? center.y + 200,
    props: {
      w: options.w ?? DEFAULT_SCOPE_WIDTH,
      h: options.h ?? DEFAULT_SCOPE_HEIGHT,
      sourceType,
      name,
      path,
      windowSec: options.windowSec ?? DEFAULT_WINDOW_SEC,
      title: options.title ?? describeScopeSource(sourceType, name, path),
    },
  })
  editor.select(id)
  return id
}

/** `signal foo`, `signal foo.position`, `params synth.gain`. */
export function describeScopeSource(
  sourceType: SignalScopeSourceType,
  name: string,
  path: string,
) {
  return `${sourceType} ${name}${path ? `.${path}` : ''}`
}

interface ScopeReading {
  /** The bound value when it is a finite number, else null. */
  value: number | null
  /** The bound entity exists. */
  present: boolean
  /** The owning run ended (signals only): freeze the trace. */
  ended: boolean
  /** The source's socket is open. */
  live: boolean
  unserializable: boolean
}

function SignalScopeShapeComponent({ shape }: { shape: SignalScopeShape }) {
  const { sourceType, name, path, windowSec } = shape.props
  const signalsRuntime = useSignalsSync(sourceType === 'signal' ? name : null)
  const paramsRuntime = useParamsSync(sourceType === 'params' ? name : null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const samplesRef = useRef<SignalScopeSample[]>([])
  const paintDirtyRef = useRef(true)
  const viewportNowRef = useRef<number | null>(null)
  const wakePaintLoopRef = useRef<(() => void) | null>(null)
  const hasSamplesRef = useRef(false)
  const [hasSamples, setHasSamples] = useState(false)
  const readingRef = useRef<ScopeReading>({
    value: null,
    present: false,
    ended: false,
    live: false,
    unserializable: false,
  })
  const windowSecRef = useRef(windowSec)
  const pathSegments = useMemo(
    () => path.split('.').map((part) => part.trim()).filter(Boolean),
    [path],
  )

  const reading: ScopeReading = sourceType === 'signal'
    ? readSignalSource(signalsRuntime, name, pathSegments)
    : readParamsSource(paramsRuntime, name, pathSegments)

  // Latched every render (one per snapshot at most) so the RAF loop below can
  // stay a plain imperative loop with no React work per sample.
  readingRef.current = reading
  windowSecRef.current = windowSec

  // A rebind is a new subject: never carry the old source's trace into it.
  useEffect(() => {
    samplesRef.current = []
    viewportNowRef.current = null
    paintDirtyRef.current = true
    if (hasSamplesRef.current) {
      hasSamplesRef.current = false
      setHasSamples(false)
    }
    wakePaintLoopRef.current?.()
  }, [name, pathSegments, sourceType])

  useEffect(() => {
    let frame = 0
    let mounted = true
    const schedule = () => {
      if (mounted && frame === 0) frame = window.requestAnimationFrame(tick)
    }
    const tick = () => {
      frame = 0
      const current = readingRef.current
      const samples = samplesRef.current
      const now = performance.now()
      const advancing = current.live && !current.ended
      // Per-RAF latest-value sampling: a constant signal draws a continuous
      // line. Live non-numeric gaps still advance and prune prior history.
      const samplesChanged = advancing
        ? advanceSignalScopeSamples(
          samples,
          now,
          windowSecRef.current,
          current.value,
          MAX_SCOPE_SAMPLES,
        )
        : false
      const nextHasSamples = samples.length > 0
      if (samplesChanged && hasSamplesRef.current !== nextHasSamples) {
        hasSamplesRef.current = nextHasSamples
        setHasSamples(nextHasSamples)
      }

      if (advancing) viewportNowRef.current = now
      const viewportNow = viewportNowRef.current ?? now
      if (
        paintDirtyRef.current || samplesChanged ||
        (advancing && samples.length > 0)
      ) {
        drawScope(
          canvasRef.current,
          samples,
          windowSecRef.current,
          viewportNow,
        )
        paintDirtyRef.current = false
      }

      if (advancing && (current.value !== null || samples.length > 0)) schedule()
    }
    wakePaintLoopRef.current = schedule
    schedule()
    return () => {
      mounted = false
      wakePaintLoopRef.current = null
      if (frame !== 0) window.cancelAnimationFrame(frame)
    }
  }, [])

  // Entity/status/window changes restart an idle loop for one required paint.
  useEffect(() => {
    paintDirtyRef.current = true
    wakePaintLoopRef.current?.()
  }, [reading.ended, reading.live, reading.present, reading.unserializable, reading.value, windowSec])

  // A static frozen scope still needs a fresh backing store after resize or a
  // device-pixel-ratio change.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const invalidate = () => {
      paintDirtyRef.current = true
      wakePaintLoopRef.current?.()
    }
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(invalidate)
    observer?.observe(canvas)
    window.addEventListener('resize', invalidate)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', invalidate)
    }
  }, [])

  useEffect(() => {
    const shapeId = String(shape.id)
    scopeDebugReaders.set(shapeId, () => {
      const samples = samplesRef.current
      const values = samples.map((sample) => sample.v)
      const current = readingRef.current
      return {
        shapeId,
        sourceType,
        name,
        path,
        windowSec: windowSecRef.current,
        sampleCount: samples.length,
        latest: values.length > 0 ? values[values.length - 1] : null,
        min: values.length > 0 ? Math.min(...values) : null,
        max: values.length > 0 ? Math.max(...values) : null,
        distinctCount: new Set(values).size,
        ended: current.ended,
        waiting: current.value === null,
      }
    })
    return () => {
      scopeDebugReaders.delete(shapeId)
    }
  }, [name, path, shape.id, sourceType])

  const stopCanvasEvent = (event: SyntheticEvent) => {
    event.stopPropagation()
  }

  const status = reading.ended
    ? 'ended'
    : !reading.live
    ? 'disconnected'
    : !reading.present
    ? 'waiting'
    : reading.unserializable
    ? 'value unavailable'
    : reading.value === null
    ? 'not numeric'
    : formatScopeValue(reading.value)

  return (
    <HTMLContainer
      className={`signal-scope-shape${
        reading.ended ? ' signal-scope-shape--ended' : ''
      }`}
      style={{ width: shape.props.w, height: shape.props.h }}
    >
      <div className="signal-scope-shape__header">
        <div className="signal-scope-shape__title">
          <strong>{shape.props.title}</strong>
          <span>{status}</span>
        </div>
      </div>
      <div
        className="signal-scope-shape__body"
        onPointerDown={stopCanvasEvent}
        onWheel={stopCanvasEvent}
      >
        <canvas ref={canvasRef} className="signal-scope-shape__canvas" />
        {reading.value === null && !hasSamples
          ? (
            <div className="signal-scope-shape__empty">
              {reading.unserializable
                ? <>The current value from <code>{name || '(unbound)'}</code> cannot be represented.</>
                : reading.present
                ? <>Waiting for a number from <code>{name || '(unbound)'}</code>: v1 scopes plot numeric values only.</>
                : <>Waiting for <code>{name || '(unbound)'}</code>.</>}
            </div>
          )
          : null}
      </div>
    </HTMLContainer>
  )
}

function readSignalSource(
  runtime: ReturnType<typeof useSignalsSync>,
  name: string,
  pathSegments: string[],
): ScopeReading {
  const entity = runtime.signals[name]
  return {
    value: entity ? readNumericAtPath(entity.value, pathSegments) : null,
    present: Boolean(entity),
    ended: Boolean(entity?.ended),
    live: runtime.connectionStatus === 'open',
    unserializable: Boolean(entity?.unserializable),
  }
}

function readParamsSource(
  runtime: ReturnType<typeof useParamsSync>,
  name: string,
  pathSegments: string[],
): ScopeReading {
  const entity = runtime.params[name]
  return {
    value: entity ? readNumericAtPath(entity.values, pathSegments) : null,
    // A durable param field has no owning run, so it never ends.
    present: Boolean(entity),
    ended: false,
    live: runtime.connectionStatus === 'open',
    unserializable: Boolean(entity?.unserializable),
  }
}

/**
 * Walk a dot-joined path into a user-shaped value and return it only when it is
 * a finite number. Everything else — missing keys, objects, strings, NaN — is a
 * non-numeric binding, which renders the placeholder rather than a trace.
 */
function readNumericAtPath(value: unknown, pathSegments: string[]): number | null {
  let node: unknown = value
  for (const key of pathSegments) {
    if (typeof node !== 'object' || node === null) return null
    node = (node as Record<string, unknown>)[key]
  }
  return typeof node === 'number' && Number.isFinite(node) ? node : null
}

/**
 * One polyline over the retained window, drawn straight to the 2D context. The
 * y-axis auto-scales to the window's own range: signals declare no bounds, and
 * a fixed range would flatten most traces into a line.
 */
function drawScope(
  canvas: HTMLCanvasElement | null,
  samples: SignalScopeSample[],
  windowSec: number,
  now: number,
) {
  if (!canvas) return
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width <= 0 || height <= 0) return
  const dpr = window.devicePixelRatio || 1
  const pixelWidth = Math.round(width * dpr)
  const pixelHeight = Math.round(height * dpr)
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight

  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, width, height)
  if (samples.length === 0) return

  let min = Infinity
  let max = -Infinity
  for (const sample of samples) {
    if (sample.v < min) min = sample.v
    if (sample.v > max) max = sample.v
  }
  // A constant trace would divide by zero; give it a band to sit in the middle.
  if (max - min < 1e-9) {
    const pad = Math.max(Math.abs(max) * 0.1, 0.5)
    min -= pad
    max += pad
  }

  const spanMs = windowSec * 1_000
  const toX = (t: number) => width - ((now - t) / spanMs) * width
  const toY = (v: number) => height - ((v - min) / (max - min)) * (height - 4) - 2

  context.beginPath()
  samples.forEach((sample, index) => {
    const x = toX(sample.t)
    const y = toY(sample.v)
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  })
  context.strokeStyle = '#7ee0b8'
  context.lineWidth = 1.5
  context.stroke()
}

function formatScopeValue(value: number) {
  return Math.abs(value) >= 1_000 || Number.isInteger(value)
    ? String(value)
    : value.toFixed(3)
}
