import { useEffect, useMemo, useState } from 'react'
import { type Editor, Tldraw, createShapeId } from 'tldraw'
import { DEFAULT_LIVECODE_SOURCE } from './defaultSource'
import {
  LIVECODE_EDITOR_SHAPE_TYPE,
  LivecodeEditorShapeUtil,
  createModuleId,
  type LivecodeEditorShape,
} from './LivecodeEditorShape'
import { LivecodeRuntimeProvider, useLivecodeRuntime } from './livecodeRuntime'

const shapeUtils = [LivecodeEditorShapeUtil]

export function App() {
  return (
    <LivecodeRuntimeProvider>
      <LivecodeTldrawPage />
    </LivecodeRuntimeProvider>
  )
}

function LivecodeTldrawPage() {
  const [editor, setEditor] = useState<Editor | null>(null)
  const runtime = useLivecodeRuntime()
  const { registerModule, unregisterModule, setModuleSource } = runtime

  useEffect(() => {
    if (!editor) return

    for (const shape of editor.getCurrentPageShapes()) {
      if (isLivecodeShape(shape)) {
        registerModule(shape.props.moduleId, shape.props.source)
      }
    }

    return editor.store.listen(
      (entry) => {
        for (const record of Object.values(entry.changes.added)) {
          if (isLivecodeShape(record)) {
            registerModule(record.props.moduleId, record.props.source)
          }
        }

        for (const [before, after] of Object.values(entry.changes.updated)) {
          if (isLivecodeShape(before) && !isLivecodeShape(after)) {
            unregisterModule(before.props.moduleId)
          } else if (!isLivecodeShape(before) && isLivecodeShape(after)) {
            registerModule(after.props.moduleId, after.props.source)
          } else if (isLivecodeShape(before) && isLivecodeShape(after)) {
            if (before.props.moduleId !== after.props.moduleId) {
              unregisterModule(before.props.moduleId)
              registerModule(after.props.moduleId, after.props.source)
            } else if (before.props.source !== after.props.source) {
              setModuleSource(after.props.moduleId, after.props.source)
            }
          }
        }

        for (const record of Object.values(entry.changes.removed)) {
          if (isLivecodeShape(record)) {
            unregisterModule(record.props.moduleId)
          }
        }
      },
      { source: 'all', scope: 'document' },
    )
  }, [editor, registerModule, setModuleSource, unregisterModule])

  return (
    <div className="app-shell">
      <TopBar editor={editor} />
      <div className="canvas-shell">
        <Tldraw
          persistenceKey="livecode-tldraw-poc"
          shapeUtils={shapeUtils}
          onMount={(mountedEditor) => {
            setEditor(mountedEditor)
            if (!hasLivecodeShapes(mountedEditor)) {
              createLivecodeShape(mountedEditor, { x: 120, y: 120, title: 'module 1' })
            }
          }}
        />
      </div>
    </div>
  )
}

function TopBar({ editor }: { editor: Editor | null }) {
  const runtime = useLivecodeRuntime()
  const moduleCount = useMemo(() => Object.keys(runtime.modules).length, [runtime.modules])

  return (
    <div className="topbar" onPointerDown={(event) => event.stopPropagation()}>
      <div className="topbar__group topbar__group--server">
        <label htmlFor="server-url">Server</label>
        <input
          id="server-url"
          value={runtime.serverBaseUrl}
          onChange={(event) => runtime.setServerBaseUrl(event.currentTarget.value)}
          spellCheck={false}
        />
        <button
          type="button"
          disabled={runtime.connectionStatus === 'connecting'}
          onClick={() =>
            runtime.connectionStatus === 'open' ? runtime.disconnect() : void runtime.connect()
          }
        >
          {runtime.connectionStatus === 'open' ? 'Disconnect' : 'Connect'}
        </button>
      </div>

      <button
        type="button"
        disabled={!editor}
        onClick={() => {
          if (editor) createLivecodeShape(editor)
        }}
      >
        New module
      </button>

      <div className="topbar__status">
        <span className={`status-pill status-pill--${runtime.connectionStatus}`}>
          {runtime.connectionStatus}
        </span>
        <span className={`status-pill status-pill--${runtime.lspStatus}`}>
          lsp: {runtime.lspStatus}
        </span>
        <span>{moduleCount} modules</span>
        {runtime.connectionError ? <span className="topbar__error">{runtime.connectionError}</span> : null}
      </div>
    </div>
  )
}

function hasLivecodeShapes(editor: Editor) {
  return editor.getCurrentPageShapes().some((shape) => shape.type === LIVECODE_EDITOR_SHAPE_TYPE)
}

function isLivecodeShape(record: unknown): record is LivecodeEditorShape {
  if (!record || typeof record !== 'object') return false
  const candidate = record as { typeName?: unknown; type?: unknown }
  return candidate.typeName === 'shape' && candidate.type === LIVECODE_EDITOR_SHAPE_TYPE
}

function createLivecodeShape(
  editor: Editor,
  options: { x?: number; y?: number; title?: string; source?: string } = {},
) {
  const id = createShapeId()
  const moduleId = createModuleId()
  const center = editor.getViewportPageBounds().center
  editor.createShape<LivecodeEditorShape>({
    id,
    type: LIVECODE_EDITOR_SHAPE_TYPE,
    x: options.x ?? center.x - 320,
    y: options.y ?? center.y - 260,
    props: {
      w: 640,
      h: 520,
      moduleId,
      title: options.title ?? `module ${moduleId.slice(7, 15)}`,
      source: options.source ?? DEFAULT_LIVECODE_SOURCE,
    },
  })
  editor.select(id)
  return id
}
