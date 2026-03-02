/**
 * InspectorServer — HTTP/WebSocket server for the Scene Inspector.
 *
 * Responsibilities:
 * 1. Serves the built Vue inspector app (static files)
 * 2. Provides a WebSocket endpoint for registry updates
 * 3. Handles session creation/destruction requests from the inspector browser
 * 4. Cleans up inspector-created sessions when the browser disconnects
 */

import {
  type InspectorRegistry,
  getInspectorRegistry,
  type RegistryMessage,
} from './inspector_registry.ts'

// === Type Definitions ===

export interface InspectorServerOptions {
  /** Port to listen on (0 = auto-assign) */
  port?: number
  /** Path to the built Vue inspector app directory */
  staticDir?: string
  /** Whether to auto-open the browser */
  openBrowser?: boolean
}

/** Session factory registered by each adapter */
export interface SessionFactory {
  createSession: () => { sessionId: string; wsUrl: string }
  destroySession: (sessionId: string) => void
}

/** Message from inspector browser to create a session for viewing a component */
interface CreateSessionRequest {
  type: 'createSession'
  name: string
  requestId: string
}

/** Response with the WS URL to connect to for the component */
interface CreateSessionResponse {
  type: 'sessionCreated'
  name: string
  wsUrl: string
  sessionId: string
  requestId: string
}

/** Message to destroy a session */
interface DestroySessionRequest {
  type: 'destroySession'
  name: string
  sessionId: string
}

type InspectorClientMessage = CreateSessionRequest | DestroySessionRequest

// === InspectorServer Class ===

const SERVER_GLOBAL_KEY = '__inspectorServer__'

export class InspectorServer {
  private server: Deno.HttpServer | null = null
  private registry: InspectorRegistry
  private registryClients = new Set<WebSocket>()
  private baseUrl = ''
  private unsubscribe: (() => void) | null = null

  /** Map of entry name → session creation function */
  private sessionFactories = new Map<string, SessionFactory>()

  /** Track sessions per registry client for cleanup on disconnect */
  private clientSessions = new Map<WebSocket, Set<{ name: string; sessionId: string }>>()

  constructor(private options: InspectorServerOptions = {}) {
    this.registry = getInspectorRegistry()
  }

  /** Merge in options provided after initial creation (before start). */
  updateOptions(opts: InspectorServerOptions): void {
    this.options = { ...this.options, ...opts }
  }

  /** Register a session factory for a named entry.
   *  Called by adapters when they register with the inspector. */
  registerSessionFactory(name: string, factory: SessionFactory): void {
    this.sessionFactories.set(name, factory)
  }

  unregisterSessionFactory(name: string): void {
    this.sessionFactories.delete(name)
  }

  async start(): Promise<string> {
    if (this.server) return this.baseUrl

    const staticDir = this.options.staticDir

    // Use a promise to wait for the server to be listening
    const listenPromise = new Promise<string>((resolve) => {
      this.server = Deno.serve(
        {
          port: this.options.port ?? 0,
          onListen: ({ port }) => {
            this.baseUrl = `http://127.0.0.1:${port}`
            console.log(`[Inspector] Server running at ${this.baseUrl}`)
            resolve(this.baseUrl)
          },
        },
        async (req: Request) => {
          const url = new URL(req.url)

          // WebSocket: registry updates + session management
          if (url.pathname === '/ws/registry' && req.headers.get('upgrade') === 'websocket') {
            return this.handleRegistryWs(req)
          }

          // REST: get registry snapshot
          if (url.pathname === '/api/registry') {
            return new Response(JSON.stringify(this.registry.getAll()), {
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            })
          }

          // CORS preflight
          if (req.method === 'OPTIONS') {
            return new Response(null, {
              headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
              },
            })
          }

          // Static files for inspector app
          if (staticDir) {
            return await this.serveStatic(url.pathname, staticDir)
          }

          return new Response('Not found', { status: 404 })
        },
      )
    })

    await listenPromise

    // Subscribe to registry changes and broadcast to all WS clients
    this.unsubscribe = this.registry.subscribe((msg) => {
      // Skip the initial snapshot from subscribe — we send our own on connect
      if (msg.type !== 'registrySnapshot') {
        this.broadcastRegistryMessage(msg)
      }
    })

    if (this.options.openBrowser) {
      this.openInBrowser()
    }

    return this.baseUrl
  }

  private handleRegistryWs(req: Request): Response {
    const { socket, response } = Deno.upgradeWebSocket(req)

    socket.onopen = () => {
      this.registryClients.add(socket)
      this.clientSessions.set(socket, new Set())

      // Send current snapshot
      const snapshot: RegistryMessage = {
        type: 'registrySnapshot',
        entries: this.registry.getAll(),
      }
      socket.send(JSON.stringify(snapshot))
    }

    socket.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as InspectorClientMessage
        this.handleClientMessage(socket, msg)
      } catch (e) {
        console.warn('[Inspector] Error handling client message:', e)
      }
    }

    socket.onclose = () => {
      this.registryClients.delete(socket)

      // Clean up all sessions this client created
      const sessions = this.clientSessions.get(socket)
      if (sessions) {
        for (const { name, sessionId } of sessions) {
          const factory = this.sessionFactories.get(name)
          factory?.destroySession(sessionId)
        }
        this.clientSessions.delete(socket)
      }
    }

    return response
  }

  private handleClientMessage(socket: WebSocket, msg: InspectorClientMessage): void {
    switch (msg.type) {
      case 'createSession': {
        const factory = this.sessionFactories.get(msg.name)
        if (!factory) {
          console.warn(`[Inspector] No session factory for "${msg.name}"`)
          return
        }
        const { sessionId, wsUrl } = factory.createSession()

        // Track for cleanup
        this.clientSessions.get(socket)?.add({ name: msg.name, sessionId })

        const response: CreateSessionResponse = {
          type: 'sessionCreated',
          name: msg.name,
          wsUrl,
          sessionId,
          requestId: msg.requestId,
        }
        socket.send(JSON.stringify(response))
        break
      }
      case 'destroySession': {
        const factory = this.sessionFactories.get(msg.name)
        if (factory) {
          factory.destroySession(msg.sessionId)
        }

        // Remove from tracking
        const sessions = this.clientSessions.get(socket)
        if (sessions) {
          for (const entry of sessions) {
            if (entry.name === msg.name && entry.sessionId === msg.sessionId) {
              sessions.delete(entry)
              break
            }
          }
        }
        break
      }
    }
  }

  private broadcastRegistryMessage(msg: RegistryMessage): void {
    const data = JSON.stringify(msg)
    for (const ws of this.registryClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    }
  }

  private async serveStatic(pathname: string, dir: string): Promise<Response> {
    const filePath = pathname === '/' ? '/index.html' : pathname
    const fullPath = `${dir}${filePath}`
    try {
      const file = await Deno.readFile(fullPath)
      const ext = fullPath.split('.').pop() ?? ''
      const mimeTypes: Record<string, string> = {
        html: 'text/html',
        js: 'application/javascript',
        css: 'text/css',
        json: 'application/json',
        svg: 'image/svg+xml',
        png: 'image/png',
        woff2: 'font/woff2',
        woff: 'font/woff',
      }
      return new Response(file, {
        headers: { 'Content-Type': mimeTypes[ext] ?? 'application/octet-stream' },
      })
    } catch {
      // SPA fallback: serve index.html for any non-file path
      try {
        const file = await Deno.readFile(`${dir}/index.html`)
        return new Response(file, {
          headers: { 'Content-Type': 'text/html' },
        })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    }
  }

  private async openInBrowser(): Promise<void> {
    try {
      const command = Deno.build.os === 'darwin'
        ? 'open'
        : Deno.build.os === 'windows'
          ? 'start'
          : 'xdg-open'
      const process = new Deno.Command(command, { args: [this.baseUrl] })
      await process.output()
    } catch (e) {
      console.warn('[Inspector] Could not open browser:', e)
    }
  }

  get url(): string {
    return this.baseUrl
  }

  shutdown(): void {
    this.unsubscribe?.()
    for (const ws of this.registryClients) {
      ws.close()
    }
    this.registryClients.clear()
    this.clientSessions.clear()
    this.server?.shutdown()
    this.server = null

    const g = globalThis as Record<string, unknown>
    delete g[SERVER_GLOBAL_KEY]
  }
}

// === Singleton getter ===

export function getInspectorServer(options?: InspectorServerOptions): InspectorServer {
  const g = globalThis as Record<string, unknown>
  if (!g[SERVER_GLOBAL_KEY]) {
    g[SERVER_GLOBAL_KEY] = new InspectorServer(options)
  } else if (options) {
    (g[SERVER_GLOBAL_KEY] as InspectorServer).updateOptions(options)
  }
  return g[SERVER_GLOBAL_KEY] as InspectorServer
}
