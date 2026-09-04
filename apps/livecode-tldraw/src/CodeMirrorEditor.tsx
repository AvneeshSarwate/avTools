import { indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { lintGutter } from '@codemirror/lint'
import {
  Compartment,
  type Extension,
  type Range,
  StateEffect,
  StateField,
} from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  WidgetType,
} from '@codemirror/view'
import { type LSClient, LSCore } from '@valtown/codemirror-ls'
import { basicSetup } from 'codemirror'
import { useEffect, useMemo, useRef } from 'react'
import { createDenoLspExtensions } from './denoLsp'
import type { SourceRange } from './livecodeProtocol'

const setWaitDecorationsEffect = StateEffect.define<SourceRange[]>()
const setEntityDecorationsEffect = StateEffect.define<EntityCallDecoration[]>()
const debugEditorViews = new Map<string, EditorView>()

declare global {
  interface Window {
    __livecodeTldrawDebug?: LivecodeTldrawDebug
  }
}

interface LivecodeTldrawDebug {
  getDocumentUris(): string[]
  getDocumentText(documentUri: string): string
  focusDocumentAtOffset(documentUri: string, offset: number): void
  requestCompletionAtOffset(
    documentUri: string,
    offset: number,
  ): Promise<string[]>
}

export type EntityCallDecorationType =
  | 'pianoRoll'
  | 'params'
  | 'animationTimeline'
  | 'drawing'
  | 'signal'

export interface EntityCallDecoration {
  /** Start offset of the name argument; the widget is placed before it. */
  at: number
  entityType: EntityCallDecorationType
  entityName: string
  /** A piano-roll lookup whose literal has not yet been confirmed by a run. */
  tentative?: boolean
}

export type OpenEntityCallback = (
  entityType: EntityCallDecorationType,
  entityName: string,
) => void

const waitLineDecoration = Decoration.line({
  attributes: { class: 'ltc-wait-line' },
})
const waitMarkDecoration = Decoration.mark({
  attributes: { class: 'ltc-wait-active' },
})

const waitDecorationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(decorations, transaction) {
    decorations = decorations.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (!effect.is(setWaitDecorationsEffect)) continue
      const adds = effect.value.flatMap((range) => {
        const from = clampPosition(transaction.state.doc.length, range.from)
        const to = clampPosition(
          transaction.state.doc.length,
          Math.max(range.to, from + 1),
        )
        const line = transaction.state.doc.lineAt(from)
        return [
          waitLineDecoration.range(line.from),
          waitMarkDecoration.range(from, to),
        ]
      })
      decorations = Decoration.set(adds, true)
    }
    return decorations
  },
  provide: (field) => EditorView.decorations.from(field),
})

const entityDecorationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(decorations, transaction) {
    decorations = decorations.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (!effect.is(setEntityDecorationsEffect)) continue
      const adds: Range<Decoration>[] = effect.value.map((entry) => {
        const at = clampPosition(transaction.state.doc.length, entry.at)
        return Decoration.widget({
          widget: new EntityOpenWidget(entry),
          side: -1,
        }).range(at)
      })
      decorations = Decoration.set(adds, true)
    }
    return decorations
  },
  provide: (field) => EditorView.decorations.from(field),
})

const ENTITY_DECORATION_PRESENTATION: Record<
  EntityCallDecorationType,
  { emoji: string; label: string; className: string }
> = {
  pianoRoll: {
    emoji: '🎹',
    label: 'piano roll',
    className: 'ltc-entity-open-btn--piano-roll',
  },
  params: {
    emoji: '🎛️',
    label: 'params pane',
    className: 'ltc-entity-open-btn--params',
  },
  animationTimeline: {
    emoji: '▶️',
    label: 'animation editor',
    className: 'ltc-entity-open-btn--animation-timeline',
  },
  drawing: {
    emoji: '✏️',
    label: 'drawing canvas',
    className: 'ltc-entity-open-btn--drawing',
  },
  signal: {
    emoji: '📈',
    label: 'signal monitor',
    className: 'ltc-entity-open-btn--signal',
  },
}

class EntityOpenWidget extends WidgetType {
  constructor(readonly entry: EntityCallDecoration) {
    super()
  }

  override eq(other: EntityOpenWidget) {
    return (
      other.entry.at === this.entry.at &&
      other.entry.entityType === this.entry.entityType &&
      other.entry.entityName === this.entry.entityName &&
      other.entry.tentative === this.entry.tentative
    )
  }

  override toDOM(view: EditorView) {
    const presentation = ENTITY_DECORATION_PRESENTATION[this.entry.entityType]
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `ltc-entity-open-btn ${presentation.className}`
    button.dataset.entityType = this.entry.entityType
    button.dataset.entityName = this.entry.entityName
    button.textContent = presentation.emoji
    const action = `Open ${presentation.label} for "${this.entry.entityName}"`
    button.title = this.entry.tentative
      ? `${action} (static name; run the module to confirm)`
      : action
    button.setAttribute('aria-label', action)
    button.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      event.preventDefault()
      view.focus()
      entityOpenListeners.get(view)?.(
        this.entry.entityType,
        this.entry.entityName,
      )
    })
    return button
  }

  override ignoreEvent() {
    return true
  }
}

const entityOpenListeners = new Map<EditorView, OpenEntityCallback>()

const livecodeTheme = EditorView.theme({
  '&': {
    height: '100%',
    minHeight: '0',
    fontSize: '13px',
  },
  '.cm-scroller': {
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    lineHeight: '1.5',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '10px 0',
  },
  '.ltc-wait-line': {
    backgroundColor: 'rgba(28, 132, 114, 0.2)',
    borderLeft: '3px solid #25b08d',
  },
  '.ltc-wait-active': {
    backgroundColor: 'rgba(37, 176, 141, 0.28)',
    borderBottom: '1px solid rgba(37, 176, 141, 0.85)',
  },
  '.ltc-entity-open-btn': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    margin: '0 1px',
    border: '0',
    borderRadius: '4px',
    padding: '0',
    background: 'transparent',
    fontSize: '13px',
    lineHeight: '1',
    cursor: 'pointer',
    userSelect: 'none',
    verticalAlign: 'middle',
  },
  '.ltc-entity-open-btn--piano-roll:hover': {
    background: 'rgba(37, 176, 141, 0.32)',
  },
  '.ltc-entity-open-btn--params:hover': {
    background: 'rgba(122, 137, 224, 0.32)',
  },
  '.ltc-entity-open-btn--animation-timeline:hover': {
    background: 'rgba(240, 160, 64, 0.3)',
  },
  '.ltc-entity-open-btn--signal:hover': {
    background: 'rgba(223, 113, 184, 0.28)',
  },
})

interface CodeMirrorEditorProps {
  value: string
  documentUri: string
  activeRanges: SourceRange[]
  entityCallsites: EntityCallDecoration[]
  lspClient: LSClient | null
  readOnly?: boolean
  onChange(next: string): void
  onOpenEntity?: OpenEntityCallback
}

export function CodeMirrorEditor({
  value,
  documentUri,
  activeRanges,
  entityCallsites,
  lspClient,
  readOnly = false,
  onChange,
  onOpenEntity,
}: CodeMirrorEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const editableCompartmentRef = useRef(new Compartment())
  const lspCompartmentRef = useRef(new Compartment())
  onChangeRef.current = onChange

  const extensions = useMemo<Extension[]>(
    () => [
      basicSetup,
      keymap.of([indentWithTab]),
      javascript({ typescript: true }),
      oneDark,
      lintGutter(),
      livecodeTheme,
      waitDecorationField,
      entityDecorationField,
      editableCompartmentRef.current.of(EditorView.editable.of(!readOnly)),
      lspCompartmentRef.current.of([]),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        onChangeRef.current(update.state.doc.toString())
      }),
      EditorView.domEventHandlers({
        pointerdown(event) {
          event.stopPropagation()
        },
        touchstart(event) {
          event.stopPropagation()
        },
        wheel(event) {
          event.stopPropagation()
        },
        keydown(event) {
          event.stopPropagation()
        },
      }),
      EditorView.lineWrapping,
    ],
    [],
  )

  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      parent: hostRef.current,
      doc: value,
      extensions,
    })
    viewRef.current = view
    ensureDebugApi()
    debugEditorViews.set(documentUri, view)
    return () => {
      debugEditorViews.delete(documentUri)
      entityOpenListeners.delete(view)
      view.destroy()
      viewRef.current = null
    }
  }, [documentUri, extensions])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (onOpenEntity) {
      entityOpenListeners.set(view, onOpenEntity)
    } else {
      entityOpenListeners.delete(view)
    }
  }, [onOpenEntity])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: lspCompartmentRef.current.reconfigure(
        lspClient
          ? createDenoLspExtensions({
              client: lspClient,
              documentUri,
              onError: console.warn,
            })
          : [],
      ),
    })
  }, [documentUri, lspClient])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    })
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: setWaitDecorationsEffect.of(activeRanges) })
  }, [activeRanges])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: setEntityDecorationsEffect.of(entityCallsites),
    })
  }, [entityCallsites])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: editableCompartmentRef.current.reconfigure(
        EditorView.editable.of(!readOnly),
      ),
    })
  }, [readOnly])

  return <div ref={hostRef} className="livecode-codemirror" />
}

function clampPosition(docLength: number, value: number) {
  return Math.min(docLength, Math.max(0, value))
}

function ensureDebugApi() {
  if (window.__livecodeTldrawDebug) return
  window.__livecodeTldrawDebug = {
    getDocumentUris() {
      return [...debugEditorViews.keys()]
    },
    getDocumentText(documentUri) {
      const view = getDebugEditorView(documentUri)
      return view.state.doc.toString()
    },
    focusDocumentAtOffset(documentUri, offset) {
      const view = getDebugEditorView(documentUri)
      view.dispatch({
        selection: { anchor: clampPosition(view.state.doc.length, offset) },
        scrollIntoView: true,
      })
      view.focus()
    },
    async requestCompletionAtOffset(documentUri, offset) {
      const view = getDebugEditorView(documentUri)
      const lspCore = LSCore.ofOrThrow(view)
      const safeOffset = clampPosition(view.state.doc.length, offset)
      view.dispatch({ selection: { anchor: safeOffset } })
      await lspCore.syncChanges()
      const position = lspPositionAtOffset(view.state.doc, safeOffset)
      const previousCharacter = view.state.doc.sliceString(
        Math.max(0, safeOffset - 1),
        safeOffset,
      )
      const result = await lspCore.requestWithLock('textDocument/completion', {
        textDocument: { uri: lspCore.documentUri },
        position,
        context: {
          triggerKind: previousCharacter === '.' ? 2 : 1,
          ...(previousCharacter === '.' ? { triggerCharacter: '.' } : {}),
        },
      })
      return lspCompletionLabels(result)
    },
  }
}

function getDebugEditorView(documentUri: string) {
  const view = debugEditorViews.get(documentUri)
  if (!view) {
    throw new Error(`No CodeMirror document registered for ${documentUri}`)
  }
  return view
}

function lspPositionAtOffset(doc: EditorView['state']['doc'], offset: number) {
  const line = doc.lineAt(offset)
  return {
    line: line.number - 1,
    character: offset - line.from,
  }
}

function lspCompletionLabels(result: unknown): string[] {
  const items = Array.isArray(result)
    ? result
    : result &&
        typeof result === 'object' &&
        Array.isArray((result as { items?: unknown }).items)
      ? (result as { items: unknown[] }).items
      : []
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const label = (item as { label?: unknown }).label
      return typeof label === 'string' ? label : null
    })
    .filter((label): label is string => Boolean(label))
}
