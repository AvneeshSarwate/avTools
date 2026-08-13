import { parseTldrawJsonFile, serializeTldrawJson, type Editor } from 'tldraw'
import type { LivecodeRuntimeApi, ModuleViewState } from './livecodeRuntime'
import type { VisualizerManifestMessage } from './livecodeProtocol'
import { createParamPaneShape } from './ParamPaneShape'

export interface TldrawRuntimeDebugModule {
  moduleId: string
  projectModulePath?: string
  sourceText: string
  sourceVersion: number
  buildStatus: string
  runStatus: string
  manifest: VisualizerManifestMessage | null
  pianoRollLookups: Record<string, string>
  activeIds: string[]
  latestError: string | null
}

export interface TldrawRuntimeDebugShape {
  id: string
  type: string
  x: number
  y: number
  props: Record<string, unknown>
}

export interface TldrawRuntimeDebug {
  connectionStatus: string
  serverBaseUrl: string
  modules: Record<string, TldrawRuntimeDebugModule>
  shapes: TldrawRuntimeDebugShape[]
  setSource(moduleId: string, source: string): void
  runModule(moduleId: string): Promise<void>
  stopModule(moduleId: string): Promise<void>
  connect(): Promise<void>
  disconnect(): void
  getModuleIds(): string[]
  getShapes(): TldrawRuntimeDebugShape[]
  selectShape(id: string): void
  getSelectedShapeIds(): string[]
  createParamPane(paramsName: string): string | null
  exportTldrJson(): Promise<string>
  loadTldrJson(json: string): void
}

declare global {
  interface Window {
    __livecodeTldrawRuntimeDebug?: TldrawRuntimeDebug
  }
}

interface DebugRefs {
  runtime: LivecodeRuntimeApi | null
  editor: Editor | null
}

const refs: DebugRefs = { runtime: null, editor: null }

export function setRuntimeDebugRefs(runtime: LivecodeRuntimeApi | null, editor: Editor | null) {
  refs.runtime = runtime
  refs.editor = editor
  installDebugApi()
}

function installDebugApi() {
  if (window.__livecodeTldrawRuntimeDebug) return
  window.__livecodeTldrawRuntimeDebug = {
    get connectionStatus() {
      return refs.runtime?.connectionStatus ?? 'closed'
    },
    get serverBaseUrl() {
      return refs.runtime?.serverBaseUrl ?? ''
    },
    get modules() {
      return snapshotModules()
    },
    get shapes() {
      return snapshotShapes()
    },
    setSource(moduleId, source) {
      const editor = refs.editor
      const runtime = refs.runtime
      if (!editor || !runtime) return
      const shape = editor
        .getCurrentPageShapes()
        .find((s) => s.type === 'livecode-editor' && (s.props as { moduleId?: string }).moduleId === moduleId)
      if (shape) {
        editor.updateShape({
          id: shape.id,
          type: shape.type,
          props: { source },
        } as never)
      }
      runtime.setModuleSource(moduleId, source)
    },
    runModule(moduleId) {
      return refs.runtime?.runModule(moduleId) ?? Promise.resolve()
    },
    stopModule(moduleId) {
      return refs.runtime?.stopModule(moduleId) ?? Promise.resolve()
    },
    connect() {
      return refs.runtime?.connect() ?? Promise.resolve()
    },
    disconnect() {
      refs.runtime?.disconnect()
    },
    getModuleIds() {
      return Object.keys(refs.runtime?.modules ?? {})
    },
    getShapes() {
      return snapshotShapes()
    },
    selectShape(id) {
      refs.editor?.select(id as never)
    },
    getSelectedShapeIds() {
      return refs.editor?.getSelectedShapeIds().map(String) ?? []
    },
    createParamPane(paramsName) {
      const editor = refs.editor
      if (!editor) return null
      return String(createParamPaneShape(editor, { paramsName }))
    },
    exportTldrJson() {
      const editor = refs.editor
      return editor ? serializeTldrawJson(editor) : Promise.resolve('')
    },
    loadTldrJson(json) {
      const editor = refs.editor
      if (!editor) return
      const result = parseTldrawJsonFile({ json, schema: editor.store.schema })
      if (!result.ok) throw new Error(`Could not load .tldr debug json: ${result.error.type}`)
      editor.loadSnapshot(result.value.getStoreSnapshot())
      editor.clearHistory()
    },
  }
}

function snapshotModules(): Record<string, TldrawRuntimeDebugModule> {
  const modules = refs.runtime?.modules ?? {}
  const out: Record<string, TldrawRuntimeDebugModule> = {}
  for (const [moduleId, state] of Object.entries(modules)) {
    out[moduleId] = toDebugModule(state)
  }
  return out
}

function toDebugModule(state: ModuleViewState): TldrawRuntimeDebugModule {
  return {
    moduleId: state.moduleId,
    projectModulePath: state.projectModulePath,
    sourceText: state.sourceText,
    sourceVersion: state.sourceVersion,
    buildStatus: state.buildStatus,
    runStatus: state.runStatus,
    manifest: state.manifest,
    pianoRollLookups: state.pianoRollLookups,
    activeIds: state.activeIds,
    latestError: state.latestError,
  }
}

function snapshotShapes(): TldrawRuntimeDebugShape[] {
  const editor = refs.editor
  if (!editor) return []
  return editor.getCurrentPageShapes().map((shape) => ({
    id: shape.id,
    type: shape.type,
    x: shape.x,
    y: shape.y,
    props: shape.props as Record<string, unknown>,
  }))
}
