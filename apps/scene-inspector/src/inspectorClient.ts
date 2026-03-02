/**
 * InspectorClient — browser-side WebSocket client for the Scene Inspector.
 *
 * Connects to the InspectorServer's registry WebSocket endpoint.
 * Receives registry updates (entries added/removed/updated) and
 * handles session creation/destruction for viewing components.
 */

// === Type Definitions (mirrors kernel-side types) ===

export type ComponentType = 'piano-roll' | 'animation-editor' | 'tweakpane'

export interface RegistryEntry {
  name: string
  componentType: ComponentType
  bridgeBaseUrl: string
  registeredAt: number
}

export type RegistryMessage =
  | { type: 'registrySnapshot'; entries: RegistryEntry[] }
  | { type: 'entryAdded'; entry: RegistryEntry }
  | { type: 'entryRemoved'; name: string }
  | { type: 'entryUpdated'; entry: RegistryEntry }

interface CreateSessionRequest {
  type: 'createSession'
  name: string
  requestId: string
}

interface DestroySessionRequest {
  type: 'destroySession'
  name: string
  sessionId: string
}

interface CreateSessionResponse {
  type: 'sessionCreated'
  name: string
  wsUrl: string
  sessionId: string
  requestId: string
}

type ServerMessage = RegistryMessage | CreateSessionResponse

// === InspectorClient Class ===

export class InspectorClient {
  private ws: WebSocket | null = null
  private pendingRequests = new Map<string, {
    resolve: (value: { wsUrl: string; sessionId: string }) => void
    reject: (error: Error) => void
  }>()

  onRegistryUpdate?: (entries: RegistryEntry[]) => void
  onConnectionChange?: (connected: boolean) => void

  private entries = new Map<string, RegistryEntry>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0

  constructor(private serverUrl: string) {}

  connect(): void {
    const wsUrl = this.serverUrl.replace(/^http/, 'ws') + '/ws/registry'
    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      this.onConnectionChange?.(true)
    }

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage
        this.handleMessage(msg)
      } catch (e) {
        console.warn('[InspectorClient] Error parsing message:', e)
      }
    }

    this.ws.onclose = () => {
      this.onConnectionChange?.(false)
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      // will trigger onclose
    }
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'registrySnapshot':
        this.entries.clear()
        for (const entry of msg.entries) {
          this.entries.set(entry.name, entry)
        }
        this.notifyUpdate()
        break

      case 'entryAdded':
      case 'entryUpdated':
        this.entries.set(msg.entry.name, msg.entry)
        this.notifyUpdate()
        break

      case 'entryRemoved':
        this.entries.delete(msg.name)
        this.notifyUpdate()
        break

      case 'sessionCreated': {
        const pending = this.pendingRequests.get(msg.requestId)
        if (pending) {
          this.pendingRequests.delete(msg.requestId)
          pending.resolve({ wsUrl: msg.wsUrl, sessionId: msg.sessionId })
        }
        break
      }
    }
  }

  private notifyUpdate(): void {
    this.onRegistryUpdate?.(Array.from(this.entries.values()))
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= 10) return
    const delay = 1000 * Math.pow(2, Math.min(this.reconnectAttempts, 5))
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++
      this.connect()
    }, delay)
  }

  /** Request a new session for viewing a component in the inspector */
  createSession(name: string): Promise<{ wsUrl: string; sessionId: string }> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'))
        return
      }
      const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`
      this.pendingRequests.set(requestId, { resolve, reject })
      this.ws.send(JSON.stringify({
        type: 'createSession',
        name,
        requestId,
      } satisfies CreateSessionRequest))

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          reject(new Error('Session creation timed out'))
        }
      }, 10000)
    })
  }

  /** Notify the server that we're done viewing a component */
  destroySession(name: string, sessionId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'destroySession',
        name,
        sessionId,
      } satisfies DestroySessionRequest))
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
  }
}
