/**
 * DenoNotebookBridge - Generic Deno Jupyter Notebook UI Component Infrastructure
 *
 * Provides the HTTP server, WebSocket upgrade, and iframe display logic
 * shared across UI components (piano roll, animation editor, canvas, etc.)
 *
 * Component-specific logic lives in separate adapter modules.
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface IframeConfig {
  width?: number
  height?: number
  style?: string
}

export interface Session<TClient, TSessionData> {
  id: string
  client?: TClient
  data: TSessionData
}

/**
 * Adapter interface that component-specific modules implement.
 */
export interface ComponentAdapter<TClient, THandle, TSessionData> {
  readonly name: string
  readonly bundleUrl: URL
  readonly defaultIframeConfig?: IframeConfig

  renderHTML(wsUrl: string, sessionId: string, sessionData: TSessionData): string

  handleConnection(
    socket: WebSocket,
    session: Session<TClient, TSessionData>,
    bridge: DenoNotebookBridge<TClient, THandle, TSessionData>
  ): TClient

  createHandle(
    session: Session<TClient, TSessionData>,
    bridge: DenoNotebookBridge<TClient, THandle, TSessionData>
  ): THandle

  getConfig(session: Session<TClient, TSessionData>): Record<string, unknown>

  onSessionCleanup?(session: Session<TClient, TSessionData>): void
}

interface BridgeState<TClient, TSessionData> {
  server: Deno.HttpServer
  baseUrl: string
  sessions: Map<string, Session<TClient, TSessionData>>
  bundleUrl: URL
}

// ============================================================================
// DenoNotebookBridge Class
// ============================================================================

export class DenoNotebookBridge<TClient, THandle, TSessionData> {
  private globalKey: string

  constructor(private adapter: ComponentAdapter<TClient, THandle, TSessionData>) {
    this.globalKey = `__denoNotebookBridge_${adapter.name}__`
  }

  private getBridgeState(): BridgeState<TClient, TSessionData> {
    // deno-lint-ignore no-explicit-any
    const global = globalThis as any
    if (!global[this.globalKey]) {
      console.log(`[${this.adapter.name}] Auto-initializing server...`)
      this.initializeBridge()
    }
    return global[this.globalKey]
  }

  private initializeBridge(): void {
    const sessions = new Map<string, Session<TClient, TSessionData>>()
    const bundleUrl = this.adapter.bundleUrl

    const server = Deno.serve(
      {
        port: 0,
        onListen: ({ port, hostname }) => {
          console.log(`[${this.adapter.name}] Server running at http://${hostname}:${port}`)
        }
      },
      async (req) => {
        const url = new URL(req.url)

        if (req.headers.get("upgrade") === "websocket") {
          const sessionId = url.searchParams.get("id")
          if (!sessionId || !sessions.has(sessionId)) {
            return new Response("Session not found", { status: 404 })
          }
          return this.handleWebSocket(req, sessionId, sessions)
        }

        if (url.pathname === "/editor") {
          return this.handleEditorRoute(url, sessions)
        }

        if (url.pathname === `/static/${this.adapter.name}.js`) {
          return await this.handleBundleRoute(bundleUrl)
        }

        if (url.pathname === "/config") {
          return this.handleConfigRoute(url, sessions)
        }

        return new Response("Not found", { status: 404 })
      }
    )

    const addr = server.addr as Deno.NetAddr
    const baseUrl = `http://127.0.0.1:${addr.port}`

    // deno-lint-ignore no-explicit-any
    ;(globalThis as any)[this.globalKey] = {
      server,
      baseUrl,
      sessions,
      bundleUrl
    }
  }

  private handleEditorRoute(
    url: URL,
    sessions: Map<string, Session<TClient, TSessionData>>
  ): Response {
    const sessionId = url.searchParams.get("id")
    if (!sessionId) {
      return new Response("Missing session ID", { status: 400 })
    }

    const session = sessions.get(sessionId)
    if (!session) {
      return new Response("Session not found", { status: 404 })
    }

    const state = this.getBridgeState()
    const wsUrl = `ws://127.0.0.1:${(state.server.addr as Deno.NetAddr).port}/ws?id=${sessionId}`
    const html = this.adapter.renderHTML(wsUrl, sessionId, session.data)

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    })
  }

  private async handleBundleRoute(bundleUrl: URL): Promise<Response> {
    try {
      const file = await Deno.readFile(bundleUrl)
      return new Response(file, {
        headers: { "Content-Type": "application/javascript; charset=utf-8" }
      })
    } catch (error) {
      console.error(`[${this.adapter.name}] Failed to read bundle:`, error)
      return new Response("Bundle not found", { status: 404 })
    }
  }

  private handleConfigRoute(
    url: URL,
    sessions: Map<string, Session<TClient, TSessionData>>
  ): Response {
    const sessionId = url.searchParams.get("id")
    if (!sessionId) {
      return new Response("Missing session ID", { status: 400 })
    }

    const session = sessions.get(sessionId)
    if (!session) {
      return new Response("Session not found", { status: 404 })
    }

    const config = this.adapter.getConfig(session)
    return new Response(JSON.stringify(config), {
      headers: { "Content-Type": "application/json" }
    })
  }

  private handleWebSocket(
    req: Request,
    sessionId: string,
    sessions: Map<string, Session<TClient, TSessionData>>
  ): Response {
    const { socket, response } = Deno.upgradeWebSocket(req)
    const session = sessions.get(sessionId)!

    const client = this.adapter.handleConnection(socket, session, this)
    session.client = client

    return response
  }

  // ============================================================================
  // Public API
  // ============================================================================

  generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  }

  getSession(id: string): Session<TClient, TSessionData> | undefined {
    return this.getBridgeState().sessions.get(id)
  }

  getSessions(): Map<string, Session<TClient, TSessionData>> {
    return this.getBridgeState().sessions
  }

  registerSession(id: string, data: TSessionData): Session<TClient, TSessionData> {
    const session: Session<TClient, TSessionData> = { id, data }
    this.getBridgeState().sessions.set(id, session)
    return session
  }

  removeSession(id: string): void {
    const state = this.getBridgeState()
    const session = state.sessions.get(id)
    if (session) {
      this.adapter.onSessionCleanup?.(session)
      state.sessions.delete(id)
    }
  }

  displayIframe(sessionId: string, config?: IframeConfig): void {
    const state = this.getBridgeState()
    const url = `${state.baseUrl}/editor?id=${sessionId}`
    const width = config?.width ?? this.adapter.defaultIframeConfig?.width ?? 680
    const height = config?.height ?? this.adapter.defaultIframeConfig?.height ?? 460
    const style = config?.style ?? this.adapter.defaultIframeConfig?.style ??
      "border: 1px solid #ccc; border-radius: 8px; background: white;"

    // @ts-ignore - Deno.jupyter is only available in notebook context
    const view = Deno.jupyter.html`<iframe
      src="${url}"
      width="${width}"
      height="${height}"
      style="${style}"
    ></iframe>`
    Deno.jupyter.display(view)
  }

  show(data: TSessionData, config?: IframeConfig): THandle {
    const sessionId = this.generateSessionId()
    const session = this.registerSession(sessionId, data)
    this.displayIframe(sessionId, config)
    return this.adapter.createHandle(session, this)
  }

  getBaseUrl(): string {
    return this.getBridgeState().baseUrl
  }

  shutdown(): void {
    // deno-lint-ignore no-explicit-any
    const global = globalThis as any
    const state = global[this.globalKey] as BridgeState<TClient, TSessionData> | undefined
    if (state) {
      for (const session of state.sessions.values()) {
        this.adapter.onSessionCleanup?.(session)
      }
      state.server.shutdown()
      delete global[this.globalKey]
      console.log(`[${this.adapter.name}] Server shutdown`)
    }
  }
}
