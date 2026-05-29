<script setup lang="ts">
import { basicSetup, EditorView } from 'codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { lintGutter } from '@codemirror/lint'
import { oneDark } from '@codemirror/theme-one-dark'
import { Decoration, showDialog, type DecorationSet } from '@codemirror/view'
import { Compartment, StateEffect, StateField, type Extension } from '@codemirror/state'
import { LSClient, LSCore, languageServerWithClient } from '@valtown/codemirror-ls'
import { LSWebSocketTransport } from '@valtown/codemirror-ls/transport'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { DEFAULT_LIVECODE_SOURCE } from './defaultSource'

interface SourceRange {
  from: number
  to: number
}

interface VisualizerDiagnostic extends SourceRange {
  severity: 'error' | 'warning'
  code: string
  message: string
}

interface WaitCallsiteManifestEntry {
  id: string
  moduleId: string
  sourceUri: string
  range: SourceRange
  kind: 'timeContextMethod' | 'timeContextArgumentCall'
  displayName: string
}

interface VisualizerManifestMessage {
  type: 'manifest'
  moduleId: string
  sourceVersion: number
  callsites: WaitCallsiteManifestEntry[]
}

interface AnalyzeSuccess {
  type: 'analyzeSuccess'
  moduleId: string
  sourceVersion: number
  generatedRunId: string
  manifest: VisualizerManifestMessage
  transformedModuleUri: string
}

interface AnalyzeFailure {
  type: 'analyzeFailure'
  moduleId: string
  sourceVersion: number
  diagnostics: VisualizerDiagnostic[]
}

type AnalyzeResponse = AnalyzeSuccess | AnalyzeFailure

interface ActiveWaitSnapshot {
  type: 'activeWaitSnapshot'
  seq: number
  timestampMs: number
  modules: Record<string, string[]>
}

interface HistoryEntry {
  generatedRunId: string
  sourceVersion: number
  callsiteCount: number
  transformedModuleUri: string
}

interface LivecodeVisualizerDebug {
  lastManifestByModule: Record<string, VisualizerManifestMessage>
  receivedSnapshots: ActiveWaitSnapshot[]
  appliedHighlightsByModule: Record<string, string[]>
  appliedHighlightHistoryByModule: Record<string, string[][]>
  lspReady: boolean
  lspNotifications: string[]
  lspRequests: string[]
  lspErrors: string[]
  lspDiagnosticsByUri: Record<string, LspDiagnosticSummary[]>
  lspCompletionLabels: string[]
  setSource?: (source: string) => void
  getSource?: () => string
  getModuleId?: () => string
  getLspSessionId?: () => string
  focusEditorEnd?: () => void
  focusEditorAtOffset?: (offset: number) => void
  requestLspCompletionAtCursor?: () => Promise<string[]>
  requestLspHoverAtOffset?: (offset: number) => Promise<string>
  reset?: () => void
}

interface LspDiagnosticSummary {
  message: string
  severity?: number
  source?: string
  code?: string | number
}

declare global {
  interface Window {
    __livecodeVisualizerDebug?: LivecodeVisualizerDebug
  }
}

const setWaitDecorationsEffect = StateEffect.define<SourceRange[]>()

const waitLineDecoration = Decoration.line({
  attributes: { class: 'tcv-wait-line' }
})
const waitMarkDecoration = Decoration.mark({
  attributes: { class: 'tcv-wait-active' }
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
        const to = clampPosition(transaction.state.doc.length, Math.max(range.to, from + 1))
        const line = transaction.state.doc.lineAt(from)
        return [waitLineDecoration.range(line.from), waitMarkDecoration.range(from, to)]
      })
      decorations = Decoration.set(adds, true)
    }
    return decorations
  },
  provide: (field) => EditorView.decorations.from(field)
})

const visualizerTheme = EditorView.theme({
  '&': {
    height: '100%',
    minHeight: '0',
    fontSize: '14px'
  },
  '.cm-scroller': {
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    lineHeight: '1.55',
    overflow: 'auto'
  },
  '.tcv-wait-line': {
    backgroundColor: 'rgba(29, 120, 97, 0.18)',
    borderLeft: '3px solid #25b08d'
  },
  '.tcv-wait-active': {
    backgroundColor: 'rgba(37, 176, 141, 0.28)',
    borderBottom: '1px solid rgba(37, 176, 141, 0.85)'
  }
})

const editorHost = ref<HTMLDivElement | null>(null)
const initialSearchParams = new URLSearchParams(window.location.search)
clearLegacyLivecodeStorage()
const serverBaseUrl = ref(initialSearchParams.get('serverBaseUrl') ?? 'http://127.0.0.1:7777')
const moduleId = ref(createEditorModuleId())
const sourceVersion = ref(0)
const status = ref('Disconnected')
const socketState = ref<'closed' | 'connecting' | 'open'>('closed')
const lspStatus = ref<'closed' | 'connecting' | 'open' | 'ready' | 'error'>('closed')
const diagnostics = ref<VisualizerDiagnostic[]>([])
const manifest = ref<VisualizerManifestMessage | null>(null)
const history = ref<HistoryEntry[]>([])
const activeIds = ref<string[]>([])
const lastSnapshotSeq = ref<number | null>(null)

let editorView: EditorView | null = null
let snapshotsSocket: WebSocket | null = null
let lspTransport: LSWebSocketTransport | null = null
let lspClient: LSClient | null = null
let lspSessionId = createLspSessionId()
let pendingSnapshot: ActiveWaitSnapshot | null = null
let animationFrame = 0
const lspCompartment = new Compartment()

const debugState: LivecodeVisualizerDebug = {
  lastManifestByModule: {},
  receivedSnapshots: [],
  appliedHighlightsByModule: {},
  appliedHighlightHistoryByModule: {},
  lspReady: false,
  lspNotifications: [],
  lspRequests: [],
  lspErrors: [],
  lspDiagnosticsByUri: {},
  lspCompletionLabels: []
}
window.__livecodeVisualizerDebug = debugState

const callsiteById = computed(() => {
  const map = new Map<string, WaitCallsiteManifestEntry>()
  for (const callsite of manifest.value?.callsites ?? []) {
    map.set(callsite.id, callsite)
  }
  return map
})

const diagnosticRows = computed(() => {
  return diagnostics.value.map((diagnostic) => {
    const line = editorView?.state.doc.lineAt(diagnostic.from)
    return {
      ...diagnostic,
      location: line ? `${line.number}:${diagnostic.from - line.from + 1}` : '1:1'
    }
  })
})

onMounted(async () => {
  await nextTick()
  if (!editorHost.value) return

  editorView = new EditorView({
    doc: DEFAULT_LIVECODE_SOURCE,
    extensions: [
      basicSetup,
      javascript({ typescript: true }),
      oneDark,
      lintGutter(),
      lspCompartment.of(createDenoLspExtensions()),
      waitDecorationField,
      visualizerTheme,
      EditorView.lineWrapping
    ],
    parent: editorHost.value
  })
  installDebugHooks()

  connectSnapshots()
  void connectDenoLsp()
})

onBeforeUnmount(() => {
  if (animationFrame) cancelAnimationFrame(animationFrame)
  snapshotsSocket?.close()
  editorView?.destroy()
  retireLspTransport(lspTransport)
})

async function runModule() {
  if (!editorView) return

  sourceVersion.value += 1
  diagnostics.value = []
  status.value = 'Analyzing'
  activeIds.value = []
  applyActiveIds([])

  const response = await postJson<AnalyzeResponse>('/runtime/analyze', {
    moduleId: moduleId.value,
    sourceVersion: sourceVersion.value,
    sourceText: editorView.state.doc.toString()
  })

  if (response.type === 'analyzeFailure') {
    diagnostics.value = response.diagnostics
    manifest.value = null
    delete debugState.lastManifestByModule[moduleId.value]
    status.value = `Blocked by ${response.diagnostics.length} diagnostic(s)`
    return
  }

  manifest.value = response.manifest
  debugState.lastManifestByModule[moduleId.value] = response.manifest
  history.value.unshift({
    generatedRunId: response.generatedRunId,
    sourceVersion: response.sourceVersion,
    callsiteCount: response.manifest.callsites.length,
    transformedModuleUri: response.transformedModuleUri
  })

  await postJson('/runtime/launch', {
    moduleId: response.moduleId,
    generatedRunId: response.generatedRunId,
    transformedModuleUri: response.transformedModuleUri
  })
  status.value = `Running ${response.generatedRunId}`
}

async function stopModule() {
  await postJson('/runtime/stop', { moduleId: moduleId.value })
  status.value = 'Stopped'
  activeIds.value = []
  applyActiveIds([])
}

async function checkHealth() {
  const response = await getJson<{ ok: true; serverVersion: string; activeModules: string[] }>(
    '/health'
  )
  status.value = `Connected to server ${response.serverVersion}`
  connectSnapshots()
  await reconnectDenoLsp()
}

function createDenoLspExtensions(): Extension[] {
  const transport = new LSWebSocketTransport(
    toWebSocketUrl(`/lsp?session=${encodeURIComponent(lspSessionId)}`),
    {
      onWSOpen: () => {
        if (lspTransport !== transport) return
        lspStatus.value = 'open'
      },
      onWSClose: () => {
        if (lspTransport !== transport) return
        lspStatus.value = 'closed'
      },
      onWSError: () => {
        if (lspTransport !== transport) return
        lspStatus.value = 'error'
      },
      onLSHealthy: () => {
        if (lspTransport !== transport) return
        lspStatus.value = 'ready'
      }
    }
  )

  const client = new LSClient({
    transport,
    workspaceFolders: [{ uri: 'file:///', name: 'Livecode' }],
    capabilities: (defaults) => ({
      ...defaults,
      textDocument: {
        ...defaults.textDocument,
        publishDiagnostics: {
          relatedInformation: true,
          versionSupport: true,
          codeDescriptionSupport: true,
          dataSupport: true
        }
      },
      workspace: {
        ...defaults.workspace,
        configuration: true
      }
    }),
    initializationOptions: {
      inlayHints: {
        parameterNames: {
          enabled: 'all',
          suppressWhenArgumentMatchesName: true
        },
        parameterTypes: { enabled: true },
        variableTypes: {
          enabled: true,
          suppressWhenTypeMatchesName: true
        },
        propertyDeclarationTypes: { enabled: true },
        functionLikeReturnTypes: { enabled: true },
        enumMemberValues: { enabled: true }
      }
    }
  })

  client.onInitialize(() => {
    debugState.lspReady = true
    lspStatus.value = 'ready'
  })
  client.onRequest((method) => {
    debugState.lspRequests.push(method)
  })
  client.onError((error) => {
    debugState.lspErrors.push(stringifyError(error))
  })
  client.onNotification((method, params) => {
    debugState.lspNotifications.push(method)
    if (method === 'textDocument/publishDiagnostics' && isLspDiagnosticsParams(params)) {
      debugState.lspDiagnosticsByUri[params.uri] = params.diagnostics.map((diagnostic) => ({
        message: diagnostic.message,
        severity: diagnostic.severity,
        source: diagnostic.source,
        code: diagnostic.code
      }))
    }
  })

  lspTransport = transport
  lspClient = client

  return languageServerWithClient({
    client,
    documentUri: 'file:///main.ts',
    languageId: 'typescript',
    sendDidOpen: true,
    onError: (error, view) => {
      showDialog(view, { label: error.message })
    },
    features: {
      hovers: { render: renderLspContents },
      linting: {
        render: renderLspContents,
        enableCodeActions: false
      },
      completion: {
        render: renderLspContents,
        completionMatchBefore: /[\w$./"'-]+$/,
        additionalCompletionConfig: {
          activateOnTyping: true
        }
      },
      signatureHelp: { disabled: true },
      references: { disabled: true },
      renames: { disabled: true },
      contextMenu: { disabled: true },
      inlayHints: { disabled: true },
      window: { render: renderLspContents }
    }
  })
}

async function connectDenoLsp() {
  if (!lspTransport || lspTransport.connected()) return
  const transport = lspTransport
  lspStatus.value = 'connecting'
  try {
    await transport.connect()
  } catch (error) {
    if (lspTransport === transport) lspStatus.value = 'error'
    console.error('Deno LSP connection failed', error)
  }
}

async function reconnectDenoLsp() {
  if (!editorView) return

  const oldClient = lspClient
  const oldTransport = lspTransport

  lspSessionId = createLspSessionId()
  debugState.lspReady = false
  lspStatus.value = 'connecting'
  editorView.dispatch({
    effects: lspCompartment.reconfigure(createDenoLspExtensions())
  })
  void oldClient
  retireLspTransport(oldTransport)
  await connectDenoLsp()
}

function connectSnapshots() {
  snapshotsSocket?.close()
  socketState.value = 'connecting'
  const socket = new WebSocket(toWebSocketUrl('/runtime/snapshots'))
  snapshotsSocket = socket

  socket.onopen = () => {
    socketState.value = 'open'
  }
  socket.onclose = () => {
    if (snapshotsSocket === socket) socketState.value = 'closed'
  }
  socket.onerror = () => {
    if (snapshotsSocket === socket) socketState.value = 'closed'
  }
  socket.onmessage = (event) => {
    const snapshot = JSON.parse(event.data) as ActiveWaitSnapshot
    debugState.receivedSnapshots.push(snapshot)
    pendingSnapshot = snapshot
    if (!animationFrame) {
      animationFrame = requestAnimationFrame(flushPendingSnapshot)
    }
  }
}

function flushPendingSnapshot() {
  animationFrame = 0
  if (!pendingSnapshot) return

  const snapshot = pendingSnapshot
  pendingSnapshot = null
  lastSnapshotSeq.value = snapshot.seq
  const ids = snapshot.modules[moduleId.value] ?? []
  activeIds.value = ids
  applyActiveIds(ids)
}

function applyActiveIds(ids: string[]) {
  const ranges = ids
    .map((id) => callsiteById.value.get(id)?.range)
    .filter((range): range is SourceRange => Boolean(range))
  editorView?.dispatch({ effects: setWaitDecorationsEffect.of(ranges) })
  debugState.appliedHighlightsByModule[moduleId.value] = ids
  const history = (debugState.appliedHighlightHistoryByModule[moduleId.value] ??= [])
  history.push([...ids])
}

function installDebugHooks() {
  debugState.setSource = (source: string) => {
    if (!editorView) throw new Error('Editor is not ready')
    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: source
      }
    })
  }
  debugState.getSource = () => editorView?.state.doc.toString() ?? ''
  debugState.getModuleId = () => moduleId.value
  debugState.getLspSessionId = () => lspSessionId
  debugState.focusEditorEnd = () => {
    if (!editorView) throw new Error('Editor is not ready')
    editorView.dispatch({
      selection: { anchor: editorView.state.doc.length }
    })
    editorView.focus()
  }
  debugState.focusEditorAtOffset = (offset: number) => {
    if (!editorView) throw new Error('Editor is not ready')
    editorView.dispatch({
      selection: { anchor: clampPosition(editorView.state.doc.length, offset) }
    })
    editorView.focus()
  }
  debugState.requestLspCompletionAtCursor = async () => {
    if (!editorView) throw new Error('Editor is not ready')
    const lspCore = LSCore.ofOrThrow(editorView)
    await lspCore.syncChanges()
    const cursor = editorView.state.selection.main.head
    const position = lspPositionAtOffset(editorView.state.doc, cursor)
    const previousCharacter = editorView.state.doc.sliceString(Math.max(0, cursor - 1), cursor)
    const result = await lspCore.requestWithLock('textDocument/completion', {
      textDocument: { uri: lspCore.documentUri },
      position,
      context: {
        triggerKind: previousCharacter === '.' ? 2 : 1,
        ...(previousCharacter === '.' ? { triggerCharacter: '.' } : {})
      }
    })
    const labels = lspCompletionLabels(result)
    debugState.lspCompletionLabels = labels
    return labels
  }
  debugState.requestLspHoverAtOffset = async (offset: number) => {
    if (!editorView) throw new Error('Editor is not ready')
    const lspCore = LSCore.ofOrThrow(editorView)
    await lspCore.syncChanges()
    const position = lspPositionAtOffset(
      editorView.state.doc,
      clampPosition(editorView.state.doc.length, offset)
    )
    const result = await lspCore.requestWithLock('textDocument/hover', {
      textDocument: { uri: lspCore.documentUri },
      position
    })
    return lspHoverText(result)
  }
  debugState.reset = () => {
    debugState.lastManifestByModule = {}
    debugState.receivedSnapshots.length = 0
    debugState.appliedHighlightsByModule = {}
    debugState.appliedHighlightHistoryByModule = {}
    debugState.lspNotifications.length = 0
    debugState.lspRequests.length = 0
    debugState.lspErrors.length = 0
    debugState.lspDiagnosticsByUri = {}
    debugState.lspCompletionLabels = []
  }
}

function isLspDiagnosticsParams(params: unknown): params is {
  uri: string
  diagnostics: LspDiagnosticSummary[]
} {
  if (!params || typeof params !== 'object') return false
  const record = params as Record<string, unknown>
  return typeof record.uri === 'string' && Array.isArray(record.diagnostics)
}

function lspCompletionLabels(result: unknown): string[] {
  const items = Array.isArray(result)
    ? result
    : result && typeof result === 'object' && Array.isArray((result as { items?: unknown }).items)
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

function lspHoverText(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  const contents = (result as { contents?: unknown }).contents
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) return contents.map(lspHoverContentText).join('\n\n')
  return lspHoverContentText(contents)
}

function lspHoverContentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (content && typeof content === 'object') {
    const value = (content as { value?: unknown }).value
    return typeof value === 'string' ? value : ''
  }
  return ''
}

function lspPositionAtOffset(doc: EditorView['state']['doc'], offset: number) {
  const line = doc.lineAt(offset)
  return {
    line: line.number - 1,
    character: offset - line.from
  }
}

async function renderLspContents(dom: HTMLElement, contents: unknown) {
  dom.textContent = stringifyLspContents(contents)
}

function stringifyLspContents(contents: unknown): string {
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) return contents.map(stringifyLspContents).join('\n\n')
  if (contents && typeof contents === 'object') {
    const value = 'value' in contents ? (contents as { value?: unknown }).value : undefined
    if (typeof value === 'string') return value
  }
  return ''
}

async function postJson<T = unknown>(path: string, body: unknown): Promise<T> {
  const response = await fetch(toHttpUrl(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  return (await response.json()) as T
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(toHttpUrl(path))
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  return (await response.json()) as T
}

function toHttpUrl(path: string) {
  return new URL(path, normalizedServerBase()).href
}

function toWebSocketUrl(path: string) {
  const url = new URL(path, normalizedServerBase())
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}

function normalizedServerBase() {
  const trimmed = serverBaseUrl.value.trim()
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

function clampPosition(length: number, value: number) {
  return Math.max(0, Math.min(length, value))
}

function createEditorModuleId() {
  return `editor-${crypto.randomUUID()}`
}

function createLspSessionId() {
  return `lsp-${crypto.randomUUID()}`
}

function retireLspTransport(transport: LSWebSocketTransport | null) {
  if (!transport?.connection) return
  window.setTimeout(() => {
    const socket = transport.connection
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, 'LSP session retired')
    }
  }, 100)
}

function stringifyError(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function clearLegacyLivecodeStorage() {
  localStorage.removeItem('tcv-module-id')
  localStorage.removeItem('tcv-server-base-url')
}
</script>

<template>
  <main class="livecode-visualizer" data-testid="livecode-visualizer">
    <section class="toolbar" aria-label="Livecode runtime controls">
      <label class="field">
        <span>Server</span>
        <input v-model="serverBaseUrl" data-testid="server-base-url" type="url" />
      </label>

      <label class="field module-field">
        <span>Module</span>
        <input v-model="moduleId" data-testid="module-id" type="text" />
      </label>

      <button data-testid="connect-server" type="button" @click="checkHealth">Connect</button>
      <button data-testid="run-module" type="button" @click="runModule">Run</button>
      <button data-testid="stop-module" type="button" @click="stopModule">Stop</button>

      <div class="status-strip">
        <span :data-state="socketState">snapshots: {{ socketState }}</span>
        <span :data-state="lspStatus">lsp: {{ lspStatus }}</span>
        <span>status: {{ status }}</span>
        <span v-if="lastSnapshotSeq !== null">seq: {{ lastSnapshotSeq }}</span>
      </div>
    </section>

    <section class="workspace">
      <div ref="editorHost" class="editor-host" data-testid="livecode-editor"></div>

      <aside class="side-panel">
        <section>
          <h2>Active Waits</h2>
          <div class="active-list" data-testid="wait-decoration-layer">
            <span v-for="id in activeIds" :key="id" class="active-id">{{ id }}</span>
            <span v-if="activeIds.length === 0" class="empty">none</span>
          </div>
        </section>

        <section>
          <h2>Diagnostics</h2>
          <div class="diagnostics" data-testid="transform-diagnostics">
            <div
              v-for="diagnostic in diagnosticRows"
              :key="`${diagnostic.code}:${diagnostic.from}`"
            >
              <strong>{{ diagnostic.code }}</strong>
              <span>{{ diagnostic.location }}</span>
              <p>{{ diagnostic.message }}</p>
            </div>
            <span v-if="diagnostics.length === 0" class="empty">none</span>
          </div>
        </section>

        <section>
          <h2>Generated Runs</h2>
          <ol class="history" data-testid="generated-history">
            <li v-for="entry in history" :key="entry.generatedRunId">
              <code>{{ entry.generatedRunId }}</code>
              <span>v{{ entry.sourceVersion }} · {{ entry.callsiteCount }} callsites</span>
            </li>
          </ol>
          <span v-if="history.length === 0" class="empty">none</span>
        </section>
      </aside>
    </section>
  </main>
</template>

<style scoped>
.livecode-visualizer {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: #15171a;
  color: #e8ecef;
}

.toolbar {
  display: grid;
  grid-template-columns: minmax(220px, 1.2fr) minmax(220px, 1fr) auto auto auto minmax(280px, 1.4fr);
  gap: 10px;
  align-items: end;
  padding: 12px 14px;
  border-bottom: 1px solid #2a3036;
  background: #1c2025;
}

.field {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.field span {
  font-size: 12px;
  color: #aeb8c2;
}

input {
  min-width: 0;
  height: 34px;
  padding: 0 9px;
  border: 1px solid #3a424c;
  border-radius: 5px;
  color: #e8ecef;
  background: #111316;
  font: inherit;
}

button {
  height: 34px;
  padding: 0 13px;
  border: 1px solid #3e4a54;
  border-radius: 5px;
  color: #f4f7f8;
  background: #25313b;
  font: inherit;
  cursor: pointer;
}

button:hover {
  background: #30404d;
}

.status-strip {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  color: #b8c1ca;
  font-size: 12px;
}

.status-strip span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-strip [data-state='open'] {
  color: #7de2bf;
}

.workspace {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
}

.editor-host {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.side-panel {
  min-height: 0;
  overflow: auto;
  display: grid;
  align-content: start;
  gap: 18px;
  padding: 14px;
  border-left: 1px solid #2a3036;
  background: #181b1f;
}

h2 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 650;
  color: #d9e1e8;
}

.active-list {
  min-height: 28px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.active-id {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 4px 7px;
  border-radius: 5px;
  background: rgba(37, 176, 141, 0.18);
  color: #9af0d4;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
}

.diagnostics {
  display: grid;
  gap: 10px;
}

.diagnostics div {
  display: grid;
  gap: 4px;
  padding: 8px;
  border-left: 3px solid #d05f5f;
  background: rgba(208, 95, 95, 0.12);
}

.diagnostics strong {
  font-size: 12px;
  color: #ffc1c1;
}

.diagnostics span,
.history span,
.empty {
  color: #aeb8c2;
  font-size: 12px;
}

.diagnostics p {
  margin: 0;
  color: #e8ecef;
  font-size: 13px;
  line-height: 1.4;
}

.history {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 8px;
}

.history li {
  min-width: 0;
}

.history code {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #e8ecef;
  font-size: 12px;
}

@media (max-width: 900px) {
  .toolbar {
    grid-template-columns: 1fr 1fr;
  }

  .status-strip {
    grid-column: 1 / -1;
  }

  .workspace {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(360px, 1fr) auto;
  }

  .side-panel {
    border-left: 0;
    border-top: 1px solid #2a3036;
  }
}
</style>
