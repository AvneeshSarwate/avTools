import type { Extension } from '@codemirror/state'
import { showDialog, type EditorView } from '@codemirror/view'
import { LSClient, languageServerWithClient } from '@valtown/codemirror-ls'
import { LSWebSocketTransport } from '@valtown/codemirror-ls/transport'

export type LspStatus = 'closed' | 'connecting' | 'open' | 'ready' | 'error'

export interface LspDiagnosticSummary {
  message: string
  severity?: number
  source?: string
  code?: string | number
}

export interface DenoLspConnection {
  client: LSClient
  transport: LSWebSocketTransport
}

export function createDenoLspConnection({
  serverBaseUrl,
  sessionId,
  onStatus,
  onDiagnostics,
  onError,
}: {
  serverBaseUrl: string
  sessionId: string
  onStatus(status: LspStatus): void
  onDiagnostics(uri: string, diagnostics: LspDiagnosticSummary[]): void
  onError(message: string): void
}): DenoLspConnection {
  const transport = new LSWebSocketTransport(
    toWebSocketUrl(serverBaseUrl, `/lsp?session=${encodeURIComponent(sessionId)}`),
    {
      onWSOpen: () => onStatus('open'),
      onWSClose: () => onStatus('closed'),
      onWSError: () => onStatus('error'),
      onLSHealthy: () => onStatus('ready'),
    },
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
          dataSupport: true,
        },
      },
      workspace: {
        ...defaults.workspace,
        configuration: true,
      },
    }),
    initializationOptions: {
      inlayHints: {
        parameterNames: {
          enabled: 'all',
          suppressWhenArgumentMatchesName: true,
        },
        parameterTypes: { enabled: true },
        variableTypes: {
          enabled: true,
          suppressWhenTypeMatchesName: true,
        },
        propertyDeclarationTypes: { enabled: true },
        functionLikeReturnTypes: { enabled: true },
        enumMemberValues: { enabled: true },
      },
    },
  })

  client.onInitialize(() => onStatus('ready'))
  client.onError((error) => onError(stringifyError(error)))
  client.onNotification((method, params) => {
    if (method === 'textDocument/publishDiagnostics' && isLspDiagnosticsParams(params)) {
      onDiagnostics(
        params.uri,
        params.diagnostics.map((diagnostic) => ({
          message: diagnostic.message,
          severity: diagnostic.severity,
          source: diagnostic.source,
          code: diagnostic.code,
        })),
      )
    }
  })

  return { client, transport }
}

export function createDenoLspExtensions({
  client,
  documentUri,
  onError,
}: {
  client: LSClient
  documentUri: string
  onError(message: string): void
}): Extension[] {
  return languageServerWithClient({
    client,
    documentUri,
    languageId: 'typescript',
    sendDidOpen: true,
    features: {
      hovers: { render: renderLspContents },
      linting: {
        render: renderLspContents,
        enableCodeActions: false,
      },
      completion: {
        render: renderLspContents,
        completionMatchBefore: /[\w$./"'-]+$/,
        additionalCompletionConfig: {
          activateOnTyping: true,
        },
      },
      signatureHelp: { disabled: true },
      references: { disabled: true },
      renames: { disabled: true },
      contextMenu: { disabled: true },
      inlayHints: { disabled: true },
      window: { render: renderLspContents },
    },
    onError: (error, view) => {
      onError(error.message)
      showDialog(view, { label: error.message })
    },
  })
}

export function retireLspConnection(connection: DenoLspConnection | null) {
  if (!connection?.transport.connection) return
  window.setTimeout(() => {
    const socket = connection.transport.connection
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, 'LSP session retired')
    }
  }, 100)
}

export function livecodeDocumentUri(moduleId: string) {
  return `file:///modules/${moduleId}.ts`
}

function toWebSocketUrl(serverBaseUrl: string, path: string) {
  const normalized = serverBaseUrl.trim().replace(/\/+$/, '')
  const url = new URL(path, `${normalized}/`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
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

function isLspDiagnosticsParams(params: unknown): params is {
  uri: string
  diagnostics: LspDiagnosticSummary[]
} {
  if (!params || typeof params !== 'object') return false
  const record = params as Record<string, unknown>
  return typeof record.uri === 'string' && Array.isArray(record.diagnostics)
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
