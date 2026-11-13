/**
 * Tweakpane WebSocket Protocol — Shared message types
 *
 * Imported by both kernel-side (tweakpaneServer.ts / tweakpaneAdapter.ts)
 * and browser-side (tweakpane-client.ts).
 */

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
 * Options object with functions serialized as source strings.
 * JSON-safe values are copied as-is; functions are stored in `_functions`
 * as `fn.toString()` strings and reconstructed on the client via `new Function()`.
 *
 * NOTE: Closures over external variables won't survive serialization — only pure functions.
 */
export interface SerializedOptions {
  [key: string]: unknown
  _functions?: Record<string, string>
}

export interface SerializedPaneConfig {
  title?: string
  expanded?: boolean
}

// ============================================================================
// Kernel → Client Messages (OpMessage)
// ============================================================================

export type OpMessage =
  // Structural operations
  | AddBindingOp
  | AddFolderOp
  | AddButtonOp
  | AddTabOp
  | AddBladeOp
  | AddSeparatorOp
  | RemoveOp
  | DisposeOp
  // Property updates
  | SetPropertyOp
  // Value updates
  | RefreshOp
  | BladeValueOp

export interface AddBindingOp {
  type: 'addBinding'
  id: string
  parentId: string
  key: string
  value: unknown
  opts: SerializedOptions
}

export interface AddFolderOp {
  type: 'addFolder'
  id: string
  parentId: string
  opts: { title: string; expanded?: boolean; disabled?: boolean; hidden?: boolean; index?: number }
}

export interface AddButtonOp {
  type: 'addButton'
  id: string
  parentId: string
  opts: { title: string; label?: string; disabled?: boolean; hidden?: boolean; index?: number }
}

export interface AddTabOp {
  type: 'addTab'
  id: string
  parentId: string
  opts: { pages: { title: string }[]; disabled?: boolean; hidden?: boolean; index?: number }
  pageIds: string[]
}

export interface AddBladeOp {
  type: 'addBlade'
  id: string
  parentId: string
  opts: SerializedOptions
}

export interface AddSeparatorOp {
  type: 'addSeparator'
  id: string
  parentId: string
  opts?: { disabled?: boolean; hidden?: boolean; index?: number }
}

export interface RemoveOp {
  type: 'remove'
  id: string
  parentId: string
}

export interface DisposeOp {
  type: 'dispose'
  id: string
}

export interface SetPropertyOp {
  type: 'setProperty'
  id: string
  prop: string
  value: unknown
}

export interface RefreshOp {
  type: 'refresh'
  values: Record<string, unknown>
}

export interface BladeValueOp {
  type: 'bladeValue'
  id: string
  value: unknown
}

// ============================================================================
// Envelope Messages (Kernel → Client)
// ============================================================================

export type ServerMessage =
  | ReplayMessage
  | OpMessage

export interface ReplayMessage {
  type: 'replay'
  paneConfig: SerializedPaneConfig
  operations: OpMessage[]
}

// ============================================================================
// Client → Kernel Messages
// ============================================================================

export type ClientMessage =
  | ValueChangeMessage
  | ButtonClickMessage
  | FoldChangeMessage
  | TabSelectMessage
  | BladeValueChangeMessage
  | ConnectionReadyMessage

export interface ValueChangeMessage {
  type: 'valueChange'
  id: string
  key: string
  value: unknown
  last: boolean
}

export interface ButtonClickMessage {
  type: 'buttonClick'
  id: string
}

export interface FoldChangeMessage {
  type: 'foldChange'
  id: string
  expanded: boolean
}

export interface TabSelectMessage {
  type: 'tabSelect'
  id: string
  index: number
}

export interface BladeValueChangeMessage {
  type: 'bladeValueChange'
  id: string
  value: unknown
  last: boolean
}

export interface ConnectionReadyMessage {
  type: 'connectionReady'
}

// ============================================================================
// Serialization Utilities
// ============================================================================

/**
 * Serialize an options object, converting functions to source strings.
 */
export function serializeOptions(opts: Record<string, unknown> | undefined): SerializedOptions {
  if (!opts) return {}

  const result: SerializedOptions = {}
  const functions: Record<string, string> = {}

  for (const [key, value] of Object.entries(opts)) {
    if (typeof value === 'function') {
      functions[key] = value.toString()
    } else if (value !== undefined) {
      result[key] = value
    }
  }

  if (Object.keys(functions).length > 0) {
    result._functions = functions
  }

  return result
}

/**
 * Deserialize an options object, reconstructing functions from source strings.
 */
export function deserializeOptions(opts: SerializedOptions): Record<string, unknown> {
  const result: Record<string, unknown> = { ...opts }

  if (opts._functions) {
    for (const [key, source] of Object.entries(opts._functions)) {
      try {
        result[key] = new Function('return ' + source)()
      } catch (e) {
        console.warn(`[TweakpaneClient] Failed to deserialize function '${key}':`, e)
      }
    }
    delete result._functions
  }

  return result
}
