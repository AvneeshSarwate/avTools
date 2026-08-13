import { useCallback, useEffect, useMemo, useRef, type SyntheticEvent } from 'react'
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
} from './paramsTypes'
import { useParamsRuntime } from './paramsRuntime'

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
  options:
    & Partial<ParamPaneShape['props']>
    & { x?: number; y?: number; id?: ParamPaneShape['id'] } = {},
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
  const runtime = useParamsRuntime()
  const entity = runtime.params[shape.props.paramsName]
  const containerRef = useRef<HTMLDivElement | null>(null)
  const paneRef = useRef<Pane | null>(null)
  const entriesRef = useRef<BindingEntry[]>([])
  const draftRef = useRef<ParamsValues>({})
  const lastAppliedRevRef = useRef<number | null>(null)
  const activeEntryRef = useRef<BindingEntry | null>(null)
  const latestEntityRef = useRef<ParamsEntity | null>(null)
  const runtimeRef = useRef(runtime)
  const originId = useMemo(() => `param-pane-${shape.id}`, [shape.id])
  const paramsName = shape.props.paramsName

  // Latched before the build/apply effects below, which must not re-run per
  // snapshot: they read the newest entity and runtime through these refs.
  useEffect(() => {
    latestEntityRef.current = entity ?? null
    runtimeRef.current = runtime
  })

  // Rebuilding bindings is only correct when the value shape or the meta
  // changed; a rev advance just refreshes values.
  const structureKey = useMemo(
    () =>
      entity
        ? `${describeStructure(entity.values)}|${JSON.stringify(entity.meta ?? {})}`
        : '',
    [entity],
  )

  const applyEntity = useCallback((next: ParamsEntity | null) => {
    if (!next) return
    for (const entry of entriesRef.current) {
      if (isEntryBusy(entry, activeEntryRef.current)) continue
      // A generation this pane produced (or an older one) must never be written
      // back over the value the user is looking at.
      if (next.rev <= entry.localRev) continue
      const value = readLeaf(next.values, entry.path)
      if (value === undefined || value === null || isPlainObject(value)) continue
      entry.target[entry.key] = value
      entry.binding.refresh()
    }
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
    if (!container || !current) return

    const draft = JSON.parse(JSON.stringify(current.values)) as ParamsValues
    const entries: BindingEntry[] = []
    const pane = new Pane({ container })
    buildBindings(pane, draft, current.meta, [], entries, handleLeafChange)

    draftRef.current = draft
    entriesRef.current = entries
    paneRef.current = pane
    lastAppliedRevRef.current = current.rev
    activeEntryRef.current = null

    return () => {
      pane.dispose()
      paneRef.current = null
      entriesRef.current = []
      activeEntryRef.current = null
    }
  }, [handleLeafChange, structureKey])

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

  const knownNames = useMemo(
    () => Object.keys(runtime.params).sort(),
    [runtime.params],
  )

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
          <span className="param-pane-shape__badge" title="Code wrote a value that cannot be serialized; showing the last good values.">
            unserializable
          </span>
        ) : null}
      </div>
      <div
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
        onKeyDownCapture={stopCanvasEvent}
        onWheel={stopCanvasEvent}
      >
        <div ref={containerRef} className="param-pane-shape__pane" />
        {entity ? null : (
          <div className="param-pane-shape__empty">
            Waiting for <code>{paramsName}</code>: declare it with{' '}
            <code>canvasParams(...)</code> in a running module.
            {knownNames.length > 0 ? (
              <span>known params: {knownNames.join(', ')}</span>
            ) : null}
            {runtime.connectionError ? <span>{runtime.connectionError}</span> : null}
          </div>
        )}
      </div>
    </HTMLContainer>
  )
}

function buildBindings(
  container: FolderApi,
  target: ParamsValues,
  meta: ParamsMeta | undefined,
  path: string[],
  entries: BindingEntry[],
  onChange: (entry: BindingEntry, value: ParamsPrimitive) => void,
) {
  for (const key of Object.keys(target)) {
    const value = target[key]
    const fieldMeta = meta?.[key]

    if (isPlainObject(value)) {
      const folder = container.addFolder({ title: key })
      buildBindings(
        folder,
        value,
        isPlainObject(fieldMeta) ? (fieldMeta as ParamsMeta) : undefined,
        [...path, key],
        entries,
        onChange,
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
    }
    entry.binding.on('change', (event) => {
      const next = event.value
      if (
        typeof next === 'number' || typeof next === 'string' ||
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

function readLeaf(
  values: ParamsValues,
  path: string[],
): ParamsPrimitive | ParamsValues | undefined {
  let node: ParamsPrimitive | ParamsValues | undefined = values
  for (const key of path) {
    if (!isPlainObject(node)) return undefined
    node = node[key]
  }
  return node
}

// Order-insensitive description of the key tree and leaf kinds: the only shape
// facts a tweakpane binding set depends on.
function describeStructure(values: ParamsValues): string {
  const parts: string[] = []
  const walk = (node: ParamsValues, prefix: string) => {
    for (const key of Object.keys(node).sort()) {
      const value = node[key]
      if (isPlainObject(value)) {
        parts.push(`${prefix}${key}:{}`)
        walk(value, `${prefix}${key}.`)
      } else {
        parts.push(`${prefix}${key}:${value === null ? 'null' : typeof value}`)
      }
    }
  }
  walk(values, '')
  return parts.join(',')
}

function isPlainObject(value: unknown): value is ParamsValues {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
