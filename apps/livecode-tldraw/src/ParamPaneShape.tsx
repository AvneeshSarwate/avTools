import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type SyntheticEvent,
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
import { type BindingParams, type FolderApi, Pane } from 'tweakpane'
import type {
  ParamsEntity,
  ParamsFieldMeta,
  ParamsMeta,
  ParamsPrimitive,
  ParamsValues,
  LivecodeEvent,
} from '@avtools/livecode-protocol'
import {
  useParamsSync,
  useSyncActions,
  useSyncEntityNames,
} from './syncRuntime'
import { emitEvent } from './serverRequests'
import { bindParamButton } from './paramButton'
import {
  applyChangedParamValues,
  retainParamPaneLayout,
  type ParamPaneLayoutSnapshot,
} from './paramPaneUpdates'

export const PARAM_PANE_SHAPE_TYPE = 'param-pane'
const DEFAULT_PARAM_PANE_WIDTH = 320
const DEFAULT_PARAM_PANE_HEIGHT = 320

declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    [PARAM_PANE_SHAPE_TYPE]: {
      w: number
      h: number
      paramsName: string
      title: string
    }
  }
}

export type ParamPaneShape = TLShape<typeof PARAM_PANE_SHAPE_TYPE>

// tweakpane 4 exports neither the binding nor the container interface by name;
// a Pane is a FolderApi, and a binding is what addBinding returns.
type PaneBinding = ReturnType<FolderApi['addBinding']>

// One tweakpane binding plus what the pane needs to decide whether a snapshot
// may overwrite it.
interface BindingEntry {
  path: string[]
  key: string
  target: ParamsValues
  binding: PaneBinding
  /** Rev the server assigned to this pane's most recent write of this leaf. */
  localRev: number
  /** Unresolved /params/set calls for this leaf. */
  inFlight: number
  /** Tweakpane emits change events even during an incoming truth refresh. */
  applyingTruth: boolean
}

export class ParamPaneShapeUtil extends BaseBoxShapeUtil<ParamPaneShape> {
  static override type = PARAM_PANE_SHAPE_TYPE
  static override props: RecordProps<ParamPaneShape> = {
    w: T.number,
    h: T.number,
    paramsName: T.string,
    title: T.string,
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

  override getDefaultProps(): ParamPaneShape['props'] {
    return {
      w: DEFAULT_PARAM_PANE_WIDTH,
      h: DEFAULT_PARAM_PANE_HEIGHT,
      paramsName: 'params',
      title: 'params: params',
    }
  }

  override component(shape: ParamPaneShape) {
    return <ParamPaneShapeComponent shape={shape} />
  }

  override getIndicatorPath(shape: ParamPaneShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}

export function createParamPaneShape(
  editor: Editor,
  options: Partial<ParamPaneShape['props']> & {
    x?: number
    y?: number
    id?: ParamPaneShape['id']
  } = {},
) {
  const id = options.id ?? createShapeId()
  const paramsName = options.paramsName ?? 'params'
  const center = editor.getViewportPageBounds().center
  editor.createShape<ParamPaneShape>({
    id,
    type: PARAM_PANE_SHAPE_TYPE,
    x: options.x ?? center.x + 40,
    y: options.y ?? center.y - 160,
    props: {
      w: options.w ?? DEFAULT_PARAM_PANE_WIDTH,
      h: options.h ?? DEFAULT_PARAM_PANE_HEIGHT,
      paramsName,
      title: options.title ?? `params: ${paramsName}`,
    },
  })
  editor.select(id)
  return id
}

function ParamPaneShapeComponent({ shape }: { shape: ParamPaneShape }) {
  const runtime = useParamsSync(shape.props.paramsName)
  const { serverBaseUrl } = useSyncActions()
  const entity = runtime.params[shape.props.paramsName]
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const paneRef = useRef<Pane | null>(null)
  const entriesRef = useRef<BindingEntry[]>([])
  const draftRef = useRef<ParamsValues>({})
  const lastAppliedRevRef = useRef<number | null>(null)
  const activeEntryRef = useRef<BindingEntry | null>(null)
  const latestEntityRef = useRef<ParamsEntity | null>(null)
  const runtimeRef = useRef(runtime)
  const layoutRef = useRef<ParamPaneLayoutSnapshot | null>(null)
  const originId = useMemo(() => `param-pane-${shape.id}`, [shape.id])
  const paramsName = shape.props.paramsName

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    // React's delegated onWheel runs after tldraw's native canvas listener,
    // which prevents scrolling unless the shape is in editing mode.
    const stopWheel = (event: WheelEvent) => event.stopPropagation()
    body.addEventListener('wheel', stopWheel, { passive: true })
    return () => body.removeEventListener('wheel', stopWheel)
  }, [])

  // Latched before the build/apply effects below, which must not re-run per
  // snapshot: they read the newest entity and runtime through these refs.
  useEffect(() => {
    latestEntityRef.current = entity ?? null
    runtimeRef.current = runtime
  })

  // Preserve one dependency token while scalar values change. The comparison
  // short-circuits unchanged branches retained by syncState patch materialization.
  const bindingLayout = retainParamPaneLayout(
    layoutRef.current,
    entity?.values,
    entity?.meta,
  )
  layoutRef.current = bindingLayout

  const applyEntity = useCallback((next: ParamsEntity | null) => {
    if (!next?.values) return
    applyChangedParamValues(
      entriesRef.current,
      next.values,
      next.rev,
      (entry) => isEntryBusy(entry, activeEntryRef.current),
      (entry) => {
        entry.applyingTruth = true
        try {
          entry.binding.refresh()
        } finally {
          entry.applyingTruth = false
        }
      },
    )
  }, [])

  const handleLeafChange = useCallback(
    (entry: BindingEntry, value: ParamsPrimitive) => {
      entry.inFlight += 1
      runtimeRef.current
        .setParams(paramsName, makeLeafPatch(entry.path, value), { originId })
        .then((result) => {
          entry.localRev = Math.max(entry.localRev, result.rev)
        })
        .catch((error: unknown) => {
          console.error('[livecode-tldraw] failed to set params', error)
        })
        .finally(() => {
          entry.inFlight -= 1
          if (entry.inFlight === 0) applyEntity(latestEntityRef.current)
        })
    },
    [applyEntity, originId, paramsName],
  )

  useEffect(() => {
    const container = containerRef.current
    const current = latestEntityRef.current
    if (!container || !current?.values) return

    const draft = JSON.parse(JSON.stringify(current.values)) as ParamsValues
    const entries: BindingEntry[] = []
    const cleanups: Array<() => void> = []
    const pane = new Pane({ container })
    buildBindings(
      pane,
      draft,
      current.meta,
      [],
      entries,
      handleLeafChange,
      (event) => {
        emitEvent(serverBaseUrl, event).catch((error) => {
          console.error('[livecode-tldraw] button event failed', error)
        })
      },
      cleanups,
    )

    draftRef.current = draft
    entriesRef.current = entries
    paneRef.current = pane
    lastAppliedRevRef.current = current.rev
    activeEntryRef.current = null

    return () => {
      cleanups.forEach((cleanup) => cleanup())
      pane.dispose()
      paneRef.current = null
      entriesRef.current = []
      activeEntryRef.current = null
    }
  }, [bindingLayout.token, handleLeafChange, serverBaseUrl])

  // The shape body stops bubbling, so gesture ends are observed in the capture
  // phase. Releasing a control resumes refreshes and catches it up. Enter ends
  // a keyboard editing session the same way: the blur is deferred one tick so
  // tweakpane's own commit handler (and its in-flight write guard) runs first,
  // otherwise a focused field would hold the monitor stale indefinitely.
  useEffect(() => {
    const endGesture = () => {
      if (!activeEntryRef.current) return
      activeEntryRef.current = null
      applyEntity(latestEntityRef.current)
    }
    const endKeyboardEdit = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return
      const container = containerRef.current
      const focused = document.activeElement
      if (!container || !(focused instanceof HTMLElement)) return
      if (!container.contains(focused)) return
      setTimeout(() => {
        focused.blur()
        applyEntity(latestEntityRef.current)
      }, 0)
    }
    window.addEventListener('pointerup', endGesture, true)
    window.addEventListener('pointercancel', endGesture, true)
    window.addEventListener('keydown', endKeyboardEdit, true)
    return () => {
      window.removeEventListener('pointerup', endGesture, true)
      window.removeEventListener('pointercancel', endGesture, true)
      window.removeEventListener('keydown', endKeyboardEdit, true)
    }
  }, [applyEntity])

  useEffect(() => {
    if (!entity || !paneRef.current) return
    if (lastAppliedRevRef.current === entity.rev) return
    // Echoes of this pane's own writes never need re-applying, but the first
    // application after a mount always runs so a reload restores server truth.
    if (entity.updatedBy === originId && lastAppliedRevRef.current !== null) {
      lastAppliedRevRef.current = entity.rev
      return
    }
    lastAppliedRevRef.current = entity.rev
    applyEntity(entity)
  }, [applyEntity, entity, originId])

  const stopCanvasEvent = (event: SyntheticEvent) => {
    event.stopPropagation()
  }

  return (
    <HTMLContainer
      className="param-pane-shape"
      style={{ width: shape.props.w, height: shape.props.h }}
    >
      <div className="param-pane-shape__header">
        <div className="param-pane-shape__title">
          <strong>{shape.props.title}</strong>
          <span>
            {runtime.connectionStatus} | rev {entity?.rev ?? '-'} | snapshot{' '}
            {runtime.latestSeq ?? '-'}
          </span>
        </div>
        {entity?.unserializable ? (
          <span
            className="entity-error-badge"
            title="Code wrote a value that cannot be represented in the editor."
          >
            value unavailable
          </span>
        ) : null}
      </div>
      <div
        ref={bodyRef}
        className="param-pane-shape__body"
        onPointerDownCapture={(event) => {
          activeEntryRef.current = findEntryForTarget(
            entriesRef.current,
            event.target,
          )
        }}
        onPointerDown={stopCanvasEvent}
        onPointerMove={stopCanvasEvent}
        onPointerUp={stopCanvasEvent}
        onPointerCancel={stopCanvasEvent}
        onTouchStart={stopCanvasEvent}
        onKeyDownCapture={(event) => {
          // Event buttons handle keys at the native target; other bindings keep
          // the existing canvas keyboard shield.
          if (
            !(event.target instanceof Element) ||
            !event.target.closest('[data-param-event-button]')
          )
            stopCanvasEvent(event)
        }}
      >
        <div ref={containerRef} className="param-pane-shape__pane" />
        {entity?.values === null ? (
          <div className="param-pane-shape__empty">
            The current value cannot be represented in the editor. Fix the value
            in code to restore these controls.
          </div>
        ) : entity ? null : (
          <div className="param-pane-shape__empty">
            Waiting for <code>{paramsName}</code>: declare it with{' '}
            <code>canvasParams(...)</code> in a running module.
            <KnownParamNames />
            {runtime.connectionError ? (
              <span>{runtime.connectionError}</span>
            ) : null}
          </div>
        )}
      </div>
    </HTMLContainer>
  )
}

function KnownParamNames() {
  const names = useSyncEntityNames('params')
  return names.length > 0 ? <span>known params: {names.join(', ')}</span> : null
}

function buildBindings(
  container: FolderApi,
  target: ParamsValues,
  meta: ParamsMeta | undefined,
  path: string[],
  entries: BindingEntry[],
  onChange: (entry: BindingEntry, value: ParamsPrimitive) => void,
  sendEvent: (event: LivecodeEvent) => void,
  cleanups: Array<() => void>,
) {
  for (const key of new Set([
    ...Object.keys(target),
    ...Object.keys(meta ?? {}),
  ])) {
    const value = target[key]
    const fieldMeta = meta?.[key]

    if (!(key in target)) {
      const buttonMeta = fieldMeta as ParamsFieldMeta | undefined
      if (buttonMeta?.button) {
        const blade = container.addButton({ title: buttonMeta.label ?? key })
        const element = blade.element.querySelector('button')
        if (element)
          cleanups.push(bindParamButton(element, buttonMeta.button, sendEvent))
      }
      continue
    }

    if (isPlainObject(value)) {
      const folder = container.addFolder({ title: key })
      buildBindings(
        folder,
        value,
        isPlainObject(fieldMeta) ? (fieldMeta as ParamsMeta) : undefined,
        [...path, key],
        entries,
        onChange,
        sendEvent,
        cleanups,
      )
      continue
    }

    // A null leaf is a value code made unserializable (NaN/Infinity round-trip
    // to null); tweakpane cannot bind it. The structure key covers it, so the
    // binding appears as soon as a real value is sampled.
    if (value === null) continue

    const entry: BindingEntry = {
      path: [...path, key],
      key,
      target,
      binding: container.addBinding(
        target,
        key,
        toBindingParams(fieldMeta as ParamsFieldMeta | undefined),
      ),
      localRev: 0,
      inFlight: 0,
      applyingTruth: false,
    }
    entry.binding.on('change', (event) => {
      if (entry.applyingTruth) return
      const next = event.value
      if (
        typeof next === 'number' ||
        typeof next === 'string' ||
        typeof next === 'boolean'
      ) {
        onChange(entry, next)
      }
    })
    entries.push(entry)

    addGraphRow(
      container,
      target,
      key,
      value,
      fieldMeta as ParamsFieldMeta | undefined,
    )
  }
}

/**
 * The opt-in history view for a numeric leaf: a second, readonly binding on the
 * same draft key, added after the editable one. Deliberately NOT a BindingEntry
 * — it has no change handler, never takes part in the busy guard, and is never
 * refreshed by `applyEntity`, because a tweakpane monitor polls the draft on its
 * own interval. Bounds come from the field's `min`/`max`; without them the pane
 * falls back to tweakpane's default range, so declarations should carry bounds.
 */
function addGraphRow(
  container: FolderApi,
  target: ParamsValues,
  key: string,
  value: ParamsPrimitive | ParamsValues,
  meta: ParamsFieldMeta | undefined,
) {
  if (!meta?.graph || typeof value !== 'number') return
  const params: Record<string, unknown> = { readonly: true, view: 'graph' }
  if (meta.min !== undefined) params.min = meta.min
  if (meta.max !== undefined) params.max = meta.max
  if (meta.rows !== undefined) params.rows = meta.rows
  container.addBinding(target, key, params as BindingParams)
}

function toBindingParams(
  meta: ParamsFieldMeta | undefined,
): BindingParams | undefined {
  if (!meta) return undefined
  const params: Record<string, unknown> = {}
  if (meta.label !== undefined) params.label = meta.label
  if (meta.options !== undefined) params.options = meta.options
  if (meta.min !== undefined) params.min = meta.min
  if (meta.max !== undefined) params.max = meta.max
  if (meta.step !== undefined) params.step = meta.step
  return Object.keys(params).length > 0 ? (params as BindingParams) : undefined
}

function isEntryBusy(entry: BindingEntry, activeEntry: BindingEntry | null) {
  if (entry === activeEntry) return true
  if (entry.inFlight > 0) return true
  const focused = document.activeElement
  return focused !== null && entry.binding.element.contains(focused)
}

function findEntryForTarget(
  entries: BindingEntry[],
  target: EventTarget | null,
): BindingEntry | null {
  if (!(target instanceof Node)) return null
  return entries.find((entry) => entry.binding.element.contains(target)) ?? null
}

function makeLeafPatch(path: string[], value: ParamsPrimitive): ParamsValues {
  const patch: ParamsValues = {}
  let node = patch
  for (const key of path.slice(0, -1)) {
    const child: ParamsValues = {}
    node[key] = child
    node = child
  }
  node[path[path.length - 1]] = value
  return patch
}

function isPlainObject(value: unknown): value is ParamsValues {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
