/**
 * Tweakpane Adapter — ComponentAdapter + WebSocket client + bridge factory
 *
 * Follows the exact pattern of pianoRollAdapter.ts.
 * Connects TweakpaneServer to DenoNotebookBridge infrastructure.
 */

import {
  DenoNotebookBridge,
  type ComponentAdapter,
  type Session,
  type IframeConfig,
} from "@avtools/ui-bridge"

import { WebSocketClientBase } from "@avtools/ui-bridge"

import type {
  ClientMessage,
  ServerMessage,
  OpMessage,
} from "./tweakpaneProtocol.ts"

import {
  TweakpaneServer,
  _setAdapterFactory,
  type TweakpaneWsClient,
  type TweakpaneHandle,
  type TweakpaneSessionData,
} from "./tweakpaneServer.ts"

import { renderTweakpaneShellHtml } from "./tweakpane_shell_html.ts"

// ============================================================================
// WebSocket Client (kernel-side, one per iframe connection)
// ============================================================================

type TweakpaneOutgoing = ServerMessage | OpMessage

class TweakpaneWebSocketClient
  extends WebSocketClientBase<ClientMessage, TweakpaneOutgoing>
  implements TweakpaneWsClient
{
  readonly sessionId: string

  onValueChange?: (id: string, key: string, value: unknown, last: boolean, sessionId: string) => void
  onButtonClick?: (id: string, sessionId: string) => void
  onFoldChange?: (id: string, expanded: boolean, sessionId: string) => void
  onTabSelect?: (id: string, index: number, sessionId: string) => void
  onBladeValueChange?: (id: string, value: unknown, last: boolean, sessionId: string) => void

  constructor(ws: WebSocket, sessionId: string) {
    super(ws, { logPrefix: 'TweakpaneWS' })
    this.sessionId = sessionId
  }

  get connected(): boolean {
    return this._connected
  }

  sendMessage(msg: ServerMessage): void {
    this.send(msg as TweakpaneOutgoing)
  }

  disconnect(): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close()
    }
  }

  protected handleMessage(msg: ClientMessage): void {
    switch (msg.type) {
      case 'connectionReady':
        this.onConnectionReady?.()
        break
      case 'valueChange':
        this.onValueChange?.(msg.id, msg.key, msg.value, msg.last, this.sessionId)
        break
      case 'buttonClick':
        this.onButtonClick?.(msg.id, this.sessionId)
        break
      case 'foldChange':
        this.onFoldChange?.(msg.id, msg.expanded, this.sessionId)
        break
      case 'tabSelect':
        this.onTabSelect?.(msg.id, msg.index, this.sessionId)
        break
      case 'bladeValueChange':
        this.onBladeValueChange?.(msg.id, msg.value, msg.last, this.sessionId)
        break
    }
  }
}

// ============================================================================
// Session Types
// ============================================================================

type TweakpaneSession = Session<TweakpaneWebSocketClient, TweakpaneSessionData>
type TweakpaneBridge = DenoNotebookBridge<TweakpaneWebSocketClient, TweakpaneHandle, TweakpaneSessionData>

// ============================================================================
// Component Adapter
// ============================================================================

function createTweakpaneAdapter(): ComponentAdapter<
  TweakpaneWebSocketClient,
  TweakpaneHandle,
  TweakpaneSessionData
> {
  return {
    name: "tweakpane",
    bundleUrl: new URL("../../../webcomponents/tweakpane/dist/tweakpane-client.js", import.meta.url),
    defaultIframeConfig: {
      width: 360,
      height: 50,
      style: "border: none; border-radius: 8px; background: #2b2b2b;",
      autoResize: true,
    },

    renderHTML(wsUrl: string, sessionId: string, _sessionData: TweakpaneSessionData): string {
      const shareInfo = _sessionData.server.getMobileShareInfo()
      return renderTweakpaneShellHtml({
        title: "Tweakpane",
        wsUrl,
        sessionId,
        bundleImportSpecifier: "/static/tweakpane.js",
        mobileUrl: shareInfo?.lanUrl ?? null,
        qrSvg: shareInfo?.qrSvg ?? null,
        autoResizeToParent: true,
      })
    },

    getConfig(_session: TweakpaneSession): Record<string, unknown> {
      return {}
    },

    handleConnection(
      socket: WebSocket,
      session: TweakpaneSession,
      _bridge: TweakpaneBridge,
    ): TweakpaneWebSocketClient {
      const client = new TweakpaneWebSocketClient(socket, session.id)
      const server = session.data.server
      server.sessions.add(session.id)

      client.onConnectionReady = () => {
        // Send full operation replay to build the pane
        client.sendMessage({
          type: 'replay',
          paneConfig: server.paneConfig,
          operations: server.operations,
        })
      }

      // Wire up event callbacks to route through TweakpaneServer
      client.onValueChange = (id, key, value, last, sessionId) => {
        server._handleValueChange(id, key, value, last, sessionId)
      }

      client.onButtonClick = (id, sessionId) => {
        server._handleButtonClick(id, sessionId)
      }

      client.onFoldChange = (id, expanded, sessionId) => {
        server._handleFoldChange(id, expanded, sessionId)
      }

      client.onTabSelect = (id, index, sessionId) => {
        server._handleTabSelect(id, index, sessionId)
      }

      client.onBladeValueChange = (id, value, last, sessionId) => {
        server._handleBladeValueChange(id, value, last, sessionId)
      }

      client.onDisconnect = () => {
        server._removeSession(session.id)
      }

      return client
    },

    createHandle(session: TweakpaneSession, bridge: TweakpaneBridge): TweakpaneHandle {
      return {
        disconnect(): void {
          session.client?.disconnect()
          bridge.removeSession(session.id)
        },
      }
    },

    onSessionCleanup(session: TweakpaneSession): void {
      session.client?.disconnect()
    },
  }
}

// ============================================================================
// Register the adapter factory with TweakpaneServer (lazy bridge creation)
// ============================================================================

_setAdapterFactory((server: TweakpaneServer) => {
  const adapter = createTweakpaneAdapter()
  return new DenoNotebookBridge(adapter)
})

// ============================================================================
// Convenience Export
// ============================================================================

/**
 * Create a new TweakpaneServer with the adapter already wired up.
 *
 * Usage:
 * ```typescript
 * import { createTweakpane } from "./tweakpaneAdapter.ts"
 *
 * const pane = createTweakpane({ title: 'My Controls' })
 * pane.addBinding(params, 'speed', { min: 0, max: 100 })
 * pane.show()
 * ```
 */
export function createTweakpane(config?: { title?: string; expanded?: boolean }): TweakpaneServer {
  return new TweakpaneServer(config)
}

// Re-export for convenience
export { TweakpaneServer } from "./tweakpaneServer.ts"
export type { TweakpaneHandle, TweakpaneSessionData } from "./tweakpaneServer.ts"
