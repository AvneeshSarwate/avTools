/**
 * TweakpaneClient — Browser-side client for tweakpane in Deno notebooks.
 *
 * Runs inside an iframe. Receives operation messages from the kernel via WebSocket,
 * builds and manages a real tweakpane Pane instance, and sends value changes back.
 */

import { Pane } from 'tweakpane'
import type { BladeApi, FolderApi, TabApi, TabPageApi, ButtonApi, BindingApi } from 'tweakpane'

// ============================================================================
// Protocol types (duplicated here to avoid cross-environment import issues)
// ============================================================================

interface SerializedOptions {
  [key: string]: unknown
  _functions?: Record<string, string>
}

interface SerializedPaneConfig {
  title?: string
  expanded?: boolean
}

type OpMessage =
  | { type: 'addBinding'; id: string; parentId: string; key: string; value: unknown; opts: SerializedOptions }
  | { type: 'addFolder'; id: string; parentId: string; opts: { title: string; expanded?: boolean; disabled?: boolean; hidden?: boolean; index?: number } }
  | { type: 'addButton'; id: string; parentId: string; opts: { title: string; label?: string; disabled?: boolean; hidden?: boolean; index?: number } }
  | { type: 'addTab'; id: string; parentId: string; opts: { pages: { title: string }[]; disabled?: boolean; hidden?: boolean; index?: number }; pageIds: string[] }
  | { type: 'addBlade'; id: string; parentId: string; opts: SerializedOptions }
  | { type: 'addSeparator'; id: string; parentId: string; opts?: { disabled?: boolean; hidden?: boolean; index?: number } }
  | { type: 'remove'; id: string; parentId: string }
  | { type: 'dispose'; id: string }
  | { type: 'setProperty'; id: string; prop: string; value: unknown }
  | { type: 'refresh'; values: Record<string, unknown> }
  | { type: 'bladeValue'; id: string; value: unknown }

type ServerMessage =
  | { type: 'replay'; paneConfig: SerializedPaneConfig; operations: OpMessage[] }
  | OpMessage

type ClientMessage =
  | { type: 'valueChange'; id: string; key: string; value: unknown; last: boolean }
  | { type: 'buttonClick'; id: string }
  | { type: 'foldChange'; id: string; expanded: boolean }
  | { type: 'tabSelect'; id: string; index: number }
  | { type: 'bladeValueChange'; id: string; value: unknown; last: boolean }
  | { type: 'connectionReady' }

// ============================================================================
// Deserialization
// ============================================================================

function deserializeOptions(opts: SerializedOptions): Record<string, unknown> {
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

// ============================================================================
// TweakpaneClient
// ============================================================================

// deno-lint-ignore no-explicit-any
type AnyApi = any

export class TweakpaneClient {
  private pane: Pane | null = null
  private ws: WebSocket
  private container: HTMLElement

  // Maps proxy IDs to real tweakpane API objects
  private idMap = new Map<string, AnyApi>()

  // Maps proxy IDs to local bound objects (for bindings)
  private localObjects = new Map<string, { obj: Record<string, unknown>; key: string }>()

  // Suppress sync flag to prevent echo loops during remote updates
  private suppressSync = false

  constructor(wsUrl: string, container: HTMLElement) {
    this.container = container
    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ type: 'connectionReady' } satisfies ClientMessage))
    }

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage
        this.handleMessage(msg)
      } catch (e) {
        console.warn('[TweakpaneClient] Error handling message:', e)
      }
    }

    this.ws.onclose = () => {
      console.log('[TweakpaneClient] WebSocket closed')
    }

    this.ws.onerror = () => {
      console.error('[TweakpaneClient] WebSocket error')
    }
  }

  private send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'replay':
        this.handleReplay(msg)
        break

      case 'addBinding':
      case 'addFolder':
      case 'addButton':
      case 'addTab':
      case 'addBlade':
      case 'addSeparator':
      case 'remove':
      case 'dispose':
        this.applyOperation(msg)
        break

      case 'refresh':
        this.handleRefresh(msg.values)
        break

      case 'setProperty':
        this.handleSetProperty(msg.id, msg.prop, msg.value)
        break

      case 'bladeValue':
        this.handleBladeValue(msg.id, msg.value)
        break
    }
  }

  private handleReplay(msg: { paneConfig: SerializedPaneConfig; operations: OpMessage[] }): void {
    // Create the pane
    this.pane = new Pane({
      container: this.container,
      title: msg.paneConfig.title,
      expanded: msg.paneConfig.expanded,
    })
    this.idMap.set('root', this.pane)

    // Replay all operations
    for (const op of msg.operations) {
      this.applyOperation(op)
    }
  }

  private handleRefresh(values: Record<string, unknown>): void {
    this.suppressSync = true
    try {
      for (const [id, value] of Object.entries(values)) {
        // Update local bound object
        const entry = this.localObjects.get(id)
        if (entry) {
          entry.obj[entry.key] = value
        }

        // Refresh the tweakpane binding
        const api = this.idMap.get(id)
        if (api && typeof api.refresh === 'function') {
          api.refresh()
        }

        // For standalone blades (slider, list, text), set value directly
        if (api && 'value' in api && !entry) {
          api.value = value
        }
      }
    } finally {
      this.suppressSync = false
    }
  }

  private handleSetProperty(id: string, prop: string, value: unknown): void {
    const target = this.idMap.get(id)
    if (!target) return

    this.suppressSync = true
    try {
      // Special properties
      if (prop === '_addPage' && target.addPage) {
        const { pageId, title, index } = value as { pageId: string; title: string; index: number }
        const page = target.addPage({ title, index })
        this.idMap.set(pageId, page)
        return
      }

      if (prop === '_removePage' && target.removePage) {
        const { index } = value as { index: number }
        target.removePage(index)
        return
      }

      if (prop === '_selectTab') {
        // Select the tab page at the given index
        const tab = target as TabApi
        if (tab.pages && tab.pages[value as number]) {
          tab.pages[value as number].selected = true
        }
        return
      }

      // Generic property set
      target[prop] = value
    } finally {
      this.suppressSync = false
    }
  }

  private handleBladeValue(id: string, value: unknown): void {
    const target = this.idMap.get(id)
    if (!target || !('value' in target)) return

    this.suppressSync = true
    try {
      target.value = value
    } finally {
      this.suppressSync = false
    }
  }

  private applyOperation(op: OpMessage): void {
    switch (op.type) {
      case 'addBinding':
        this.applyAddBinding(op)
        break
      case 'addFolder':
        this.applyAddFolder(op)
        break
      case 'addButton':
        this.applyAddButton(op)
        break
      case 'addTab':
        this.applyAddTab(op)
        break
      case 'addBlade':
        this.applyAddBlade(op)
        break
      case 'addSeparator':
        this.applyAddSeparator(op)
        break
      case 'remove':
        this.applyRemove(op)
        break
      case 'dispose':
        this.applyDispose(op)
        break
      case 'setProperty':
        this.handleSetProperty(op.id, op.prop, op.value)
        break
      case 'refresh':
        this.handleRefresh(op.values)
        break
      case 'bladeValue':
        this.handleBladeValue(op.id, op.value)
        break
    }
  }

  private applyAddBinding(op: { id: string; parentId: string; key: string; value: unknown; opts: SerializedOptions }): void {
    const parent = this.idMap.get(op.parentId)
    if (!parent) {
      console.warn(`[TweakpaneClient] Parent ${op.parentId} not found for addBinding`)
      return
    }

    // Create a local object for this binding
    const localObj: Record<string, unknown> = { [op.key]: op.value }
    const opts = deserializeOptions(op.opts)

    const binding: BindingApi = parent.addBinding(localObj, op.key, opts)
    this.idMap.set(op.id, binding)
    this.localObjects.set(op.id, { obj: localObj, key: op.key })

    // Listen for changes and send back to kernel
    binding.on('change', (ev: { value: unknown; last: boolean }) => {
      if (this.suppressSync) return
      this.send({
        type: 'valueChange',
        id: op.id,
        key: op.key,
        value: ev.value,
        last: ev.last,
      })
    })
  }

  private applyAddFolder(op: { id: string; parentId: string; opts: { title: string; expanded?: boolean; disabled?: boolean; hidden?: boolean; index?: number } }): void {
    const parent = this.idMap.get(op.parentId)
    if (!parent) return

    const folder: FolderApi = parent.addFolder({
      title: op.opts.title,
      expanded: op.opts.expanded,
      disabled: op.opts.disabled,
      hidden: op.opts.hidden,
      index: op.opts.index,
    })
    this.idMap.set(op.id, folder)

    // Listen for fold events
    folder.on('fold', (ev: { expanded: boolean }) => {
      if (this.suppressSync) return
      this.send({
        type: 'foldChange',
        id: op.id,
        expanded: ev.expanded,
      })
    })
  }

  private applyAddButton(op: { id: string; parentId: string; opts: { title: string; label?: string; disabled?: boolean; hidden?: boolean; index?: number } }): void {
    const parent = this.idMap.get(op.parentId)
    if (!parent) return

    const btn: ButtonApi = parent.addButton({
      title: op.opts.title,
      label: op.opts.label,
      disabled: op.opts.disabled,
      hidden: op.opts.hidden,
      index: op.opts.index,
    })
    this.idMap.set(op.id, btn)

    btn.on('click', () => {
      this.send({ type: 'buttonClick', id: op.id })
    })
  }

  private applyAddTab(op: { id: string; parentId: string; opts: { pages: { title: string }[]; disabled?: boolean; hidden?: boolean; index?: number }; pageIds: string[] }): void {
    const parent = this.idMap.get(op.parentId)
    if (!parent) return

    const tab: TabApi = parent.addTab({
      pages: op.opts.pages,
      disabled: op.opts.disabled,
      hidden: op.opts.hidden,
      index: op.opts.index,
    })
    this.idMap.set(op.id, tab)

    // Map each page to its ID
    tab.pages.forEach((page: TabPageApi, i: number) => {
      if (op.pageIds[i]) {
        this.idMap.set(op.pageIds[i], page)
      }
    })

    // Listen for tab select events
    tab.on('select', (ev: { index: number }) => {
      if (this.suppressSync) return
      this.send({
        type: 'tabSelect',
        id: op.id,
        index: ev.index,
      })
    })
  }

  private applyAddBlade(op: { id: string; parentId: string; opts: SerializedOptions }): void {
    const parent = this.idMap.get(op.parentId)
    if (!parent) return

    const opts = deserializeOptions(op.opts)
    const blade: BladeApi = parent.addBlade(opts)
    this.idMap.set(op.id, blade)

    // If the blade has change events (slider, list, text), listen for them
    if (blade && typeof (blade as AnyApi).on === 'function') {
      try {
        (blade as AnyApi).on('change', (ev: { value: unknown; last?: boolean }) => {
          if (this.suppressSync) return
          this.send({
            type: 'bladeValueChange',
            id: op.id,
            value: ev.value,
            last: ev.last ?? true,
          })
        })
      } catch {
        // Some blades may not support 'change' event — that's ok
      }
    }
  }

  private applyAddSeparator(op: { id: string; parentId: string; opts?: { disabled?: boolean; hidden?: boolean; index?: number } }): void {
    const parent = this.idMap.get(op.parentId)
    if (!parent) return

    const separator: BladeApi = parent.addBlade({
      view: 'separator',
      ...(op.opts ?? {}),
    })
    this.idMap.set(op.id, separator)
  }

  private applyRemove(op: { id: string; parentId: string }): void {
    const parent = this.idMap.get(op.parentId)
    const child = this.idMap.get(op.id)
    if (parent && child && typeof parent.remove === 'function') {
      parent.remove(child)
    }
    this.idMap.delete(op.id)
    this.localObjects.delete(op.id)
  }

  private applyDispose(op: { id: string }): void {
    const target = this.idMap.get(op.id)
    if (target && typeof target.dispose === 'function') {
      target.dispose()
    }
    this.idMap.delete(op.id)
    this.localObjects.delete(op.id)
  }

  /** Clean up all resources — call when the containing element is being removed */
  dispose(): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close()
    }
    if (this.pane) {
      this.pane.dispose()
      this.pane = null
    }
    this.idMap.clear()
    this.localObjects.clear()
  }
}
