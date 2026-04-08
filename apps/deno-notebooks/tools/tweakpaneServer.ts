/**
 * TweakpaneServer — Kernel-side proxy for tweakpane in Deno notebooks.
 *
 * Provides a 1:1 API-compatible proxy of tweakpane's Pane class. All operations
 * are recorded in an operation log and broadcast to connected iframe clients.
 * Each iframe runs a real tweakpane Pane instance.
 *
 * Proxy classes formally implement interfaces derived from tweakpane's public
 * API types so TypeScript enforces API completeness.
 */

import type {
  BladeApi as TpBladeApi,
  FolderApi as TpFolderApi,
  ButtonApi as TpButtonApi,
  TabApi as TpTabApi,
  TabPageApi as TpTabPageApi,
  SliderBladeApi as TpSliderBladeApi,
  ListBladeApi as TpListBladeApi,
  TextBladeApi as TpTextBladeApi,
  SeparatorBladeApi as TpSeparatorBladeApi,
  InputBindingApi as TpInputBindingApi,
  BindingParams,
  FolderParams,
  ButtonParams,
  TabParams,
  TabPageParams,
  BaseBladeParams,
  TpChangeEvent,
  TpPluginBundle,
} from "tweakpane"

// Types not directly exported from tweakpane's main entry — defined locally
// to match @tweakpane/core's types exactly
export type Bindable = Record<string, unknown>
export type BladeState = Record<string, unknown>
export interface ListItem<T> { text: string; value: T }

// Event types matching @tweakpane/core (not exported from tweakpane main)
export interface TpFoldEvent<Target> { readonly expanded: boolean; readonly target: Target }
export interface TpTabSelectEvent<Target> { readonly index: number; readonly target: Target }
export interface TpMouseEvent<Target> { readonly target: Target }
export interface ApiChangeEvents<T> { change: TpChangeEvent<T, BladeProxy> }

import type {
  OpMessage,
  ServerMessage,
  SerializedPaneConfig,
} from "./tweakpaneProtocol.ts"

import {
  serializeOptions,
} from "./tweakpaneProtocol.ts"

import type {
  DenoNotebookBridge,
  IframeConfig,
  BridgeAccessHost,
} from "@avtools/ui-bridge"

import {
  getInspectorRegistry,
  getInspectorServer,
} from "@avtools/ui-bridge"

import {
  buildShareInfo,
  type TweakpaneShareInfo,
} from "./tweakpane_share.ts"

// ============================================================================
// Forward declarations for adapter (set lazily)
// ============================================================================

// The adapter module sets this function so TweakpaneServer can lazily create a bridge
let _createAdapterAndBridge: ((server: TweakpaneServer) => DenoNotebookBridge<TweakpaneWsClient, TweakpaneHandle, TweakpaneSessionData>) | null = null

/** @internal Called by tweakpaneAdapter.ts to register the bridge factory */
export function _setAdapterFactory(
  factory: (server: TweakpaneServer) => DenoNotebookBridge<TweakpaneWsClient, TweakpaneHandle, TweakpaneSessionData>
): void {
  _createAdapterAndBridge = factory
}

// Placeholder types that the adapter will concretize
export interface TweakpaneWsClient {
  readonly connected: boolean
  sendMessage(msg: ServerMessage): void
  disconnect(): void
}

export interface TweakpaneHandle {
  disconnect(): void
}

export interface TweakpaneSessionData {
  server: TweakpaneServer
}

// ============================================================================
// ID Generation
// ============================================================================

let _idCounter = 0
function generateId(prefix = 'tp'): string {
  return `${prefix}_${++_idCounter}_${Math.random().toString(36).slice(2, 7)}`
}

// ============================================================================
// Event System
// ============================================================================

type EventMap = Map<string, ((...args: unknown[]) => void)[]>

class ProxyEventEmitter {
  private listeners = new Map<string, EventMap>()

  addListener(proxyId: string, event: string, handler: (...args: unknown[]) => void): void {
    if (!this.listeners.has(proxyId)) {
      this.listeners.set(proxyId, new Map())
    }
    const eventMap = this.listeners.get(proxyId)!
    if (!eventMap.has(event)) {
      eventMap.set(event, [])
    }
    eventMap.get(event)!.push(handler)
  }

  removeListener(proxyId: string, event: string, handler: (...args: unknown[]) => void): void {
    const eventMap = this.listeners.get(proxyId)
    if (!eventMap) return
    const handlers = eventMap.get(event)
    if (!handlers) return
    const idx = handlers.indexOf(handler)
    if (idx >= 0) handlers.splice(idx, 1)
  }

  fire(proxyId: string, event: string, ...args: unknown[]): void {
    const eventMap = this.listeners.get(proxyId)
    if (!eventMap) return
    const handlers = eventMap.get(event)
    if (!handlers) return
    for (const handler of [...handlers]) {
      try {
        handler(...args)
      } catch (e) {
        console.error(`[TweakpaneServer] Event handler error:`, e)
      }
    }
  }

  removeAll(proxyId: string): void {
    this.listeners.delete(proxyId)
  }
}

// ============================================================================
// Interfaces matching tweakpane's public API (excluding DOM-specific members)
// ============================================================================

/**
 * These interfaces mirror the public API of the corresponding tweakpane classes,
 * excluding DOM-only members (controller, element, rackApi_).
 * Our proxy classes implement these interfaces so TypeScript enforces API completeness.
 */

interface IBladeProxy {
  readonly disabled: boolean
  readonly hidden: boolean
  dispose(): void
  importState(state: BladeState): boolean
  exportState(): BladeState
}

interface IContainerProxy {
  readonly children: BladeProxy[]
  addBinding<O extends Bindable, Key extends keyof O>(
    object: O, key: Key, opt_params?: BindingParams
  ): BindingProxy
  addFolder(params: FolderParams): FolderProxy
  addButton(params: ButtonParams): ButtonProxy
  addTab(params: TabParams): TabProxy
  addBlade(params: BaseBladeParams): BladeProxy
  add(api: BladeProxy, opt_index?: number): BladeProxy
  remove(api: BladeProxy): void
  refresh(): void
}

// ============================================================================
// BladeProxy — Base class for all proxy blades
// ============================================================================

export class BladeProxy implements IBladeProxy {
  readonly proxyId: string
  /** @internal */ readonly _server: TweakpaneServer
  /** @internal */ readonly _parentId: string
  private _disabled = false
  private _hidden = false

  constructor(id: string, parentId: string, server: TweakpaneServer) {
    this.proxyId = id
    this._parentId = parentId
    this._server = server
  }

  get disabled(): boolean {
    return this._disabled
  }

  set disabled(value: boolean) {
    this._disabled = value
    this._server._recordOp({ type: 'setProperty', id: this.proxyId, prop: 'disabled', value })
  }

  get hidden(): boolean {
    return this._hidden
  }

  set hidden(value: boolean) {
    this._hidden = value
    this._server._recordOp({ type: 'setProperty', id: this.proxyId, prop: 'hidden', value })
  }

  get element(): never {
    throw new Error('BladeProxy.element is not available on the kernel side — DOM only exists in iframes')
  }

  dispose(): void {
    this._server._emitter.removeAll(this.proxyId)
    this._server._recordOp({ type: 'dispose', id: this.proxyId })
    this._server._removeChild(this._parentId, this)
  }

  importState(state: BladeState): boolean {
    if (typeof state.disabled === 'boolean') this._disabled = state.disabled
    if (typeof state.hidden === 'boolean') this._hidden = state.hidden
    this._server._broadcastToIframes({ type: 'setProperty', id: this.proxyId, prop: 'disabled', value: this._disabled })
    this._server._broadcastToIframes({ type: 'setProperty', id: this.proxyId, prop: 'hidden', value: this._hidden })
    return true
  }

  exportState(): BladeState {
    return { disabled: this._disabled, hidden: this._hidden }
  }
}

// ============================================================================
// Container Mixin — shared add* methods for TweakpaneServer, FolderProxy, TabPageProxy
// ============================================================================

function addContainerMethods<T extends { proxyId: string; _server: TweakpaneServer }>(target: T): void {
  const proto = target.constructor.prototype

  if (proto._containerMethodsAdded) return
  proto._containerMethodsAdded = true

  proto.addBinding = function <O extends Bindable, Key extends keyof O>(
    this: T & { _children: BladeProxy[] },
    object: O,
    key: Key,
    opt_params?: BindingParams,
  ): BindingProxy {
    const id = generateId('bind')
    const value = object[key as string]
    const opts = serializeOptions(opt_params as Record<string, unknown> | undefined)

    this._server._registerBinding(id, object as Bindable, key as string)
    this._server._recordOp({
      type: 'addBinding', id, parentId: this.proxyId,
      key: key as string, value, opts,
    })

    const proxy = new BindingProxy(id, this.proxyId, key as string, object as Bindable, this._server)
    this._children.push(proxy)
    return proxy
  }

  proto.addFolder = function (
    this: T & { _children: BladeProxy[] },
    params: FolderParams,
  ): FolderProxy {
    const id = generateId('folder')
    this._server._recordOp({
      type: 'addFolder', id, parentId: this.proxyId,
      opts: { title: params.title, expanded: params.expanded, disabled: params.disabled, hidden: params.hidden, index: params.index },
    })
    const proxy = new FolderProxy(id, this.proxyId, params, this._server)
    this._children.push(proxy)
    return proxy
  }

  proto.addButton = function (
    this: T & { _children: BladeProxy[] },
    params: ButtonParams,
  ): ButtonProxy {
    const id = generateId('btn')
    this._server._recordOp({
      type: 'addButton', id, parentId: this.proxyId,
      opts: { title: params.title, label: params.label, disabled: params.disabled, hidden: params.hidden, index: params.index },
    })
    const proxy = new ButtonProxy(id, this.proxyId, params, this._server)
    this._children.push(proxy)
    return proxy
  }

  proto.addTab = function (
    this: T & { _children: BladeProxy[] },
    params: TabParams,
  ): TabProxy {
    const id = generateId('tab')
    const pageIds = params.pages.map(() => generateId('tabpage'))
    this._server._recordOp({
      type: 'addTab', id, parentId: this.proxyId,
      opts: { pages: params.pages, disabled: params.disabled, hidden: params.hidden, index: params.index },
      pageIds,
    })
    const proxy = new TabProxy(id, this.proxyId, params, pageIds, this._server)
    this._children.push(proxy)
    return proxy
  }

  proto.addBlade = function (
    this: T & { _children: BladeProxy[] },
    params: BaseBladeParams,
  ): BladeProxy {
    const view = (params as Record<string, unknown>).view as string | undefined

    if (view === 'separator') {
      const id = generateId('sep')
      this._server._recordOp({
        type: 'addSeparator', id, parentId: this.proxyId,
        opts: { disabled: params.disabled, hidden: params.hidden, index: params.index },
      })
      const proxy = new SeparatorBladeProxy(id, this.proxyId, this._server)
      this._children.push(proxy)
      return proxy
    }

    const id = generateId('blade')
    const opts = serializeOptions(params as Record<string, unknown>)

    if (view === 'slider') {
      const p = params as Record<string, unknown>
      this._server._registerBladeValue(id, (p.value as number) ?? 0)
      this._server._recordOp({ type: 'addBlade', id, parentId: this.proxyId, opts })
      const proxy = new SliderBladeProxy(id, this.proxyId, p, this._server)
      this._children.push(proxy)
      return proxy
    }

    if (view === 'list') {
      const p = params as Record<string, unknown>
      this._server._registerBladeValue(id, p.value)
      this._server._recordOp({ type: 'addBlade', id, parentId: this.proxyId, opts })
      const proxy = new ListBladeProxy(id, this.proxyId, p, this._server)
      this._children.push(proxy)
      return proxy
    }

    if (view === 'text') {
      const p = params as Record<string, unknown>
      this._server._registerBladeValue(id, p.value)
      this._server._recordOp({ type: 'addBlade', id, parentId: this.proxyId, opts })
      const proxy = new TextBladeProxy(id, this.proxyId, p, this._server)
      this._children.push(proxy)
      return proxy
    }

    // Generic blade
    this._server._recordOp({ type: 'addBlade', id, parentId: this.proxyId, opts })
    const proxy = new BladeProxy(id, this.proxyId, this._server)
    this._children.push(proxy)
    return proxy
  }

  proto.add = function (
    this: T & { _children: BladeProxy[] },
    api: BladeProxy,
    _opt_index?: number,
  ): BladeProxy {
    this._children.push(api)
    return api
  }

  proto.remove = function (
    this: T & { _children: BladeProxy[] },
    api: BladeProxy,
  ): void {
    const idx = this._children.indexOf(api)
    if (idx >= 0) this._children.splice(idx, 1)
    this._server._recordOp({ type: 'remove', id: api.proxyId, parentId: this.proxyId })
  }
}

// ============================================================================
// BindingProxy
// ============================================================================

export class BindingProxy extends BladeProxy {
  readonly key: string
  readonly boundObj: Bindable

  private _label: string | null | undefined
  private _tag: string | undefined

  constructor(id: string, parentId: string, key: string, obj: Bindable, server: TweakpaneServer) {
    super(id, parentId, server)
    this.key = key
    this.boundObj = obj
  }

  get label(): string | null | undefined {
    return this._label
  }

  set label(label: string | null | undefined) {
    this._label = label
    this._server._recordOp({ type: 'setProperty', id: this.proxyId, prop: 'label', value: label })
  }

  get tag(): string | undefined {
    return this._tag
  }

  set tag(tag: string | undefined) {
    this._tag = tag
  }

  on<EventName extends keyof { change: TpChangeEvent<unknown, BindingProxy> }>(
    eventName: EventName,
    handler: (ev: { change: TpChangeEvent<unknown, BindingProxy> }[EventName]) => void,
  ): this {
    this._server._emitter.addListener(this.proxyId, eventName as string, handler as (...args: unknown[]) => void)
    return this
  }

  off<EventName extends keyof { change: TpChangeEvent<unknown, BindingProxy> }>(
    eventName: EventName,
    handler: (ev: { change: TpChangeEvent<unknown, BindingProxy> }[EventName]) => void,
  ): this {
    this._server._emitter.removeListener(this.proxyId, eventName as string, handler as (...args: unknown[]) => void)
    return this
  }

  refresh(): void {
    const value = this.boundObj[this.key]
    this._server._broadcastToIframes({ type: 'refresh', values: { [this.proxyId]: value } })
  }

  override exportState(): BladeState {
    return {
      ...super.exportState(),
      binding: { key: this.key, value: this.boundObj[this.key] },
      tag: this._tag,
      label: this._label,
    }
  }

  override importState(state: BladeState): boolean {
    super.importState(state)
    const binding = state.binding as { key: string; value: unknown } | undefined
    if (binding && binding.key === this.key) {
      this.boundObj[this.key] = binding.value
      this.refresh()
    }
    if (typeof state.tag === 'string') this._tag = state.tag
    if (state.label !== undefined) this.label = state.label as string | null | undefined
    return true
  }
}

// ============================================================================
// FolderProxy
// ============================================================================

export class FolderProxy extends BladeProxy implements IContainerProxy {
  _children: BladeProxy[] = []
  private _title: string | undefined
  private _expanded: boolean

  constructor(id: string, parentId: string, params: FolderParams, server: TweakpaneServer) {
    super(id, parentId, server)
    this._title = params.title
    this._expanded = params.expanded ?? true
    addContainerMethods(this)
  }

  get title(): string | undefined {
    return this._title
  }

  set title(title: string | undefined) {
    this._title = title
    this._server._recordOp({ type: 'setProperty', id: this.proxyId, prop: 'title', value: title })
  }

  get expanded(): boolean {
    return this._expanded
  }

  set expanded(expanded: boolean) {
    this._expanded = expanded
    this._server._recordOp({ type: 'setProperty', id: this.proxyId, prop: 'expanded', value: expanded })
  }

  /** @internal Update expanded without broadcasting (for incoming iframe changes) */
  _setExpandedSilent(expanded: boolean): void {
    this._expanded = expanded
  }

  get children(): BladeProxy[] {
    return [...this._children]
  }

  // Container methods added by mixin
  declare addBinding: <O extends Bindable, Key extends keyof O>(object: O, key: Key, opt_params?: BindingParams) => BindingProxy
  declare addFolder: (params: FolderParams) => FolderProxy
  declare addButton: (params: ButtonParams) => ButtonProxy
  declare addTab: (params: TabParams) => TabProxy
  declare addBlade: (params: BaseBladeParams) => BladeProxy
  declare add: (api: BladeProxy, opt_index?: number) => BladeProxy
  declare remove: (api: BladeProxy) => void

  on<EventName extends keyof FolderProxyEvents>(
    eventName: EventName,
    handler: (ev: FolderProxyEvents[EventName]) => void,
  ): this {
    this._server._emitter.addListener(this.proxyId, eventName as string, handler as (...args: unknown[]) => void)
    return this
  }

  off<EventName extends keyof FolderProxyEvents>(
    eventName: EventName,
    handler: (ev: FolderProxyEvents[EventName]) => void,
  ): this {
    this._server._emitter.removeListener(this.proxyId, eventName as string, handler as (...args: unknown[]) => void)
    return this
  }

  refresh(): void {
    for (const child of this._children) {
      if ('refresh' in child && typeof (child as { refresh: () => void }).refresh === 'function') {
        (child as { refresh: () => void }).refresh()
      }
    }
  }

  override exportState(): BladeState {
    return {
      ...super.exportState(),
      title: this._title,
      expanded: this._expanded,
      children: this._children.map(c => c.exportState()),
    }
  }

  override importState(state: BladeState): boolean {
    super.importState(state)
    if (typeof state.title === 'string') this.title = state.title
    if (typeof state.expanded === 'boolean') this.expanded = state.expanded
    return true
  }
}

interface FolderProxyEvents {
  change: TpChangeEvent<unknown, BladeProxy>
  fold: TpFoldEvent<FolderProxy>
}

// ============================================================================
// ButtonProxy
// ============================================================================

export class ButtonProxy extends BladeProxy {
  private _title: string
  private _label: string | null | undefined

  constructor(id: string, parentId: string, params: ButtonParams, server: TweakpaneServer) {
    super(id, parentId, server)
    this._title = params.title
    this._label = params.label
  }

  get title(): string {
    return this._title
  }

  set title(title: string) {
    this._title = title
    this._server._recordOp({ type: 'setProperty', id: this.proxyId, prop: 'title', value: title })
  }

  get label(): string | null | undefined {
    return this._label
  }

  set label(label: string | null | undefined) {
    this._label = label
    this._server._recordOp({ type: 'setProperty', id: this.proxyId, prop: 'label', value: label })
  }

  on<EventName extends keyof ButtonProxyEvents>(
    eventName: EventName,
    handler: (ev: ButtonProxyEvents[EventName]) => void,
  ): this {
    this._server._emitter.addListener(this.proxyId, eventName as string, handler as (...args: unknown[]) => void)
    return this
  }

  off<EventName extends keyof ButtonProxyEvents>(
    eventName: EventName,
    handler: (ev: ButtonProxyEvents[EventName]) => void,
  ): this {
    this._server._emitter.removeListener(this.proxyId, eventName as string, handler as (...args: unknown[]) => void)
    return this
  }
}

interface ButtonProxyEvents {
  click: TpMouseEvent<ButtonProxy>
}

// ============================================================================
// TabProxy
// ============================================================================

export class TabProxy extends BladeProxy {
  private _pages: TabPageProxy[]

  constructor(id: string, parentId: string, params: TabParams, pageIds: string[], server: TweakpaneServer) {
    super(id, parentId, server)
    this._pages = params.pages.map((p: { title: string }, i: number) =>
      new TabPageProxy(pageIds[i], id, p.title, i === 0, server)
    )
  }

  get pages(): TabPageProxy[] {
    return [...this._pages]
  }

  addPage(params: TabPageParams): TabPageProxy {
    const id = generateId('tabpage')
    const page = new TabPageProxy(id, this.proxyId, params.title, false, this._server)
    const index = params.index ?? this._pages.length
    this._pages.splice(index, 0, page)
    // Send as addBlade so the client creates the page
    this._server._recordOp({
      type: 'setProperty', id: this.proxyId,
      prop: '_addPage', value: { pageId: id, title: params.title, index },
    })
    return page
  }

  removePage(index: number): void {
    const page = this._pages[index]
    if (!page) return
    this._pages.splice(index, 1)
    this._server._recordOp({
      type: 'setProperty', id: this.proxyId,
      prop: '_removePage', value: { index },
    })
  }

  on<EventName extends keyof TabProxyEvents>(
    eventName: EventName,
    handler: (ev: TabProxyEvents[EventName]) => void,
  ): this {
    this._server._emitter.addListener(this.proxyId, eventName as string, handler as (...args: unknown[]) => void)
    return this
  }

  off<EventName extends keyof TabProxyEvents>(
    eventName: EventName,
    handler: (ev: TabProxyEvents[EventName]) => void,
  ): this {
    this._server._emitter.removeListener(this.proxyId, eventName as string, handler as (...args: unknown[]) => void)
    return this
  }

  refresh(): void {
    for (const page of this._pages) {
      page.refresh()
    }
  }

  override exportState(): BladeState {
    return {
      ...super.exportState(),
      pages: this._pages.map(p => p.exportState()),
    }
  }
}

interface TabProxyEvents {
  change: TpChangeEvent<unknown, BladeProxy>
  select: TpTabSelectEvent<TabProxy>
}

// ============================================================================
// TabPageProxy
// ============================================================================

export class TabPageProxy extends BladeProxy implements IContainerProxy {
  _children: BladeProxy[] = []
  private _title: string
  private _selected: boolean

  constructor(id: string, parentId: string, title: string, selected: boolean, server: TweakpaneServer) {
    super(id, parentId, server)
    this._title = title
    this._selected = selected
    addContainerMethods(this)
  }

  get title(): string {
    return this._title
  }

  set title(title: string) {
    this._title = title
    this._server._recordOp({ type: 'setProperty', id: this.proxyId, prop: 'title', value: title })
  }

  get selected(): boolean {
    return this._selected
  }

  set selected(selected: boolean) {
    this._selected = selected
    this._server._recordOp({ type: 'setProperty', id: this.proxyId, prop: 'selected', value: selected })
  }

  get children(): BladeProxy[] {
    return [...this._children]
  }

  // Container methods added by mixin
  declare addBinding: <O extends Bindable, Key extends keyof O>(object: O, key: Key, opt_params?: BindingParams) => BindingProxy
  declare addFolder: (params: FolderParams) => FolderProxy
  declare addButton: (params: ButtonParams) => ButtonProxy
  declare addTab: (params: TabParams) => TabProxy
  declare addBlade: (params: BaseBladeParams) => BladeProxy
  declare add: (api: BladeProxy, opt_index?: number) => BladeProxy
  declare remove: (api: BladeProxy) => void

  refresh(): void {
    for (const child of this._children) {
      if ('refresh' in child && typeof (child as { refresh: () => void }).refresh === 'function') {
        (child as { refresh: () => void }).refresh()
      }
    }
  }

  override exportState(): BladeState {
    return {
      ...super.exportState(),
      title: this._title,
      selected: this._selected,
      children: this._children.map(c => c.exportState()),
    }
  }
}

// ============================================================================
// Standalone Blade Proxies (SliderBlade, ListBlade, TextBlade, Separator)
// ============================================================================

export class SliderBladeProxy extends BladeProxy {
  private _value: number
  private _min: number
  private _max: number
  private _label: string | null | undefined

  constructor(id: string, parentId: string, params: Record<string, unknown>, server: TweakpaneServer) {
    super(id, parentId, server)
    this._value = (params.value as number) ?? 0
    this._min = (params.min as number) ?? 0
    this._max = (params.max as number) ?? 100
    this._label = params.label as string | undefined
  }

  get value(): number {
    return this._value
  }

  set value(value: number) {
    this._value = value
    this._server._updateBladeValue(this.proxyId, value)
    this._server._broadcastToIframes({ type: 'bladeValue', id: this.proxyId, value })
  }

  /** @internal Update value without broadcasting */
  _setValueSilent(value: number): void { this._value = value }

  get min(): number {
    return this._min
  }

  set min(min: number) {
    this._min = min
    this._server._recordOp({ type: 'setProperty', id: this.proxyId, prop: 'min', value: min })
  }

  get max(): number {
    return this._max
  }

  set max(max: number) {
    this._max = max
    this._server._recordOp({ type: 'setProperty', id: this.proxyId, prop: 'max', value: max })
  }

  get label(): string | null | undefined {
    return this._label
  }

  set label(label: string | null | undefined) {
    this._label = label
    this._server._recordOp({ type: 'setProperty', id: this.proxyId, prop: 'label', value: label })
  }

  on<EventName extends keyof ApiChangeEvents<number>>(
    eventName: EventName,
    handler: (ev: ApiChangeEvents<number>[EventName]) => void,
  ): this {
    this._server._emitter.addListener(this.proxyId, eventName as string, handler as (...args: unknown[]) => void)
    return this
  }

  off<EventName extends keyof ApiChangeEvents<number>>(
    eventName: EventName,
    handler: (ev: ApiChangeEvents<number>[EventName]) => void,
  ): this {
    this._server._emitter.removeListener(this.proxyId, eventName as string, handler as (...args: unknown[]) => void)
    return this
  }

  override exportState(): BladeState {
    return {
      ...super.exportState(),
      value: this._value, min: this._min, max: this._max, label: this._label,
    }
  }
}

export class ListBladeProxy<T = unknown> extends BladeProxy {
  private _value: T
  private _options: ListItem<T>[]
  private _label: string | null | undefined

  constructor(id: string, parentId: string, params: Record<string, unknown>, server: TweakpaneServer) {
    super(id, parentId, server)
    this._value = params.value as T
    this._options = (params.options ?? []) as ListItem<T>[]
    this._label = params.label as string | undefined
  }

  get value(): T {
    return this._value
  }

  set value(value: T) {
    this._value = value
    this._server._updateBladeValue(this.proxyId, value)
    this._server._broadcastToIframes({ type: 'bladeValue', id: this.proxyId, value })
  }

  /** @internal Update value without broadcasting */
  _setValueSilent(value: T): void { this._value = value }

  get options(): ListItem<T>[] {
    return this._options
  }

  set options(options: ListItem<T>[]) {
    this._options = options
    this._server._recordOp({ type: 'setProperty', id: this.proxyId, prop: 'options', value: options })
  }

  get label(): string | null | undefined {
    return this._label
  }

  set label(label: string | null | undefined) {
    this._label = label
    this._server._recordOp({ type: 'setProperty', id: this.proxyId, prop: 'label', value: label })
  }

  on<EventName extends keyof ApiChangeEvents<T>>(
    eventName: EventName,
    handler: (ev: ApiChangeEvents<T>[EventName]) => void,
  ): this {
    this._server._emitter.addListener(this.proxyId, eventName as string, handler as (...args: unknown[]) => void)
    return this
  }

  off<EventName extends keyof ApiChangeEvents<T>>(
    eventName: EventName,
    handler: (ev: ApiChangeEvents<T>[EventName]) => void,
  ): this {
    this._server._emitter.removeListener(this.proxyId, eventName as string, handler as (...args: unknown[]) => void)
    return this
  }

  override exportState(): BladeState {
    return {
      ...super.exportState(),
      value: this._value, options: this._options, label: this._label,
    }
  }
}

export class TextBladeProxy<T = unknown> extends BladeProxy {
  private _value: T
  private _label: string | null | undefined

  constructor(id: string, parentId: string, params: Record<string, unknown>, server: TweakpaneServer) {
    super(id, parentId, server)
    this._value = params.value as T
    this._label = params.label as string | undefined
  }

  get value(): T {
    return this._value
  }

  set value(value: T) {
    this._value = value
    this._server._updateBladeValue(this.proxyId, value)
    this._server._broadcastToIframes({ type: 'bladeValue', id: this.proxyId, value })
  }

  /** @internal Update value without broadcasting */
  _setValueSilent(value: T): void { this._value = value }

  get label(): string | null | undefined {
    return this._label
  }

  set label(label: string | null | undefined) {
    this._label = label
    this._server._recordOp({ type: 'setProperty', id: this.proxyId, prop: 'label', value: label })
  }

  on<EventName extends keyof ApiChangeEvents<T>>(
    eventName: EventName,
    handler: (ev: ApiChangeEvents<T>[EventName]) => void,
  ): this {
    this._server._emitter.addListener(this.proxyId, eventName as string, handler as (...args: unknown[]) => void)
    return this
  }

  off<EventName extends keyof ApiChangeEvents<T>>(
    eventName: EventName,
    handler: (ev: ApiChangeEvents<T>[EventName]) => void,
  ): this {
    this._server._emitter.removeListener(this.proxyId, eventName as string, handler as (...args: unknown[]) => void)
    return this
  }

  override exportState(): BladeState {
    return {
      ...super.exportState(),
      value: this._value, label: this._label,
    }
  }
}

export class SeparatorBladeProxy extends BladeProxy {
  // No additional members — matches SeparatorBladeApi
}

// ============================================================================
// TweakpaneServer — The main class (replaces Pane)
// ============================================================================

export class TweakpaneServer implements IContainerProxy {
  readonly proxyId = 'root'
  /** @internal Self-reference so container mixin can use _server uniformly */
  readonly _server: TweakpaneServer = this

  /** @internal */
  _children: BladeProxy[] = []
  /** @internal */
  _emitter = new ProxyEventEmitter()

  // Operation log for replay to new iframes
  private _operations: OpMessage[] = []
  private _paneConfig: SerializedPaneConfig

  // Binding registry: proxyId → { obj, key }
  private _bindings = new Map<string, { obj: Bindable; key: string }>()
  // Standalone blade value registry: proxyId → value
  private _bladeValues = new Map<string, unknown>()

  // Active sessions
  private _sessions = new Set<string>()
  private _namedSessions = new Map<string, string>()
  private _bridge: DenoNotebookBridge<TweakpaneWsClient, TweakpaneHandle, TweakpaneSessionData> | null = null

  // Properties
  private _title: string | undefined
  private _expanded: boolean
  private _disabled = false
  private _hidden = false
  private _inspectorName: string | undefined
  private _inspectorRegistered = false

  constructor(config?: { title?: string; expanded?: boolean; name?: string }) {
    this._title = config?.title
    this._expanded = config?.expanded ?? true
    this._inspectorName = config?.name
    this._paneConfig = { title: config?.title, expanded: config?.expanded }
    addContainerMethods(this)

    // Auto-initialize bridge and register with inspector
    this._ensureBridge()
    this._registerWithInspector()
  }

  /** The name used for the inspector registry. Defaults to title, then 'Tweakpane'. */
  get inspectorName(): string {
    return this._inspectorName ?? this._title ?? 'Tweakpane'
  }

  set inspectorName(name: string) {
    this._inspectorName = name
  }

  // --- Properties ---

  get title(): string | undefined {
    return this._title
  }

  set title(title: string | undefined) {
    this._title = title
    this._broadcastToIframes({ type: 'setProperty', id: 'root', prop: 'title', value: title })
  }

  get expanded(): boolean {
    return this._expanded
  }

  set expanded(expanded: boolean) {
    this._expanded = expanded
    this._broadcastToIframes({ type: 'setProperty', id: 'root', prop: 'expanded', value: expanded })
  }

  get disabled(): boolean {
    return this._disabled
  }

  set disabled(disabled: boolean) {
    this._disabled = disabled
    this._broadcastToIframes({ type: 'setProperty', id: 'root', prop: 'disabled', value: disabled })
  }

  get hidden(): boolean {
    return this._hidden
  }

  set hidden(hidden: boolean) {
    this._hidden = hidden
    this._broadcastToIframes({ type: 'setProperty', id: 'root', prop: 'hidden', value: hidden })
  }

  get element(): never {
    throw new Error('TweakpaneServer.element is not available on the kernel side')
  }

  get children(): BladeProxy[] {
    return [...this._children]
  }

  // --- Container methods (added by mixin) ---
  declare addBinding: <O extends Bindable, Key extends keyof O>(object: O, key: Key, opt_params?: BindingParams) => BindingProxy
  declare addFolder: (params: FolderParams) => FolderProxy
  declare addButton: (params: ButtonParams) => ButtonProxy
  declare addTab: (params: TabParams) => TabProxy
  declare addBlade: (params: BaseBladeParams) => BladeProxy
  declare add: (api: BladeProxy, opt_index?: number) => BladeProxy
  declare remove: (api: BladeProxy) => void

  // --- Events ---

  on<EventName extends keyof FolderProxyEvents>(
    eventName: EventName,
    handler: (ev: FolderProxyEvents[EventName]) => void,
  ): this {
    this._emitter.addListener('root', eventName as string, handler as (...args: unknown[]) => void)
    return this
  }

  off<EventName extends keyof FolderProxyEvents>(
    eventName: EventName,
    handler: (ev: FolderProxyEvents[EventName]) => void,
  ): this {
    this._emitter.removeListener('root', eventName as string, handler as (...args: unknown[]) => void)
    return this
  }

  // --- State Sync ---

  refresh(): void {
    const values: Record<string, unknown> = {}

    for (const [id, { obj, key }] of this._bindings) {
      values[id] = obj[key]
    }
    for (const [id, value] of this._bladeValues) {
      values[id] = value
    }

    this._broadcastToIframes({ type: 'refresh', values })
  }

  show(config?: IframeConfig): void {
    const sessionId = this.ensureClientSession()
    this._bridge!.displayIframe(sessionId, config)
  }

  ensureClientSession(name?: string): string {
    this._ensureBridge()

    if (name) {
      const existingSessionId = this._namedSessions.get(name)
      if (existingSessionId) {
        if (!this._bridge!.getSession(existingSessionId)) {
          this._bridge!.registerSession(existingSessionId, { server: this })
        }
        this._sessions.add(existingSessionId)
        return existingSessionId
      }
    }

    const sessionId = this._bridge!.generateSessionId()
    this._bridge!.registerSession(sessionId, { server: this })
    this._sessions.add(sessionId)

    if (name) {
      this._namedSessions.set(name, sessionId)
    }

    return sessionId
  }

  removeClientSession(sessionIdOrName: string): void {
    const sessionId = this._namedSessions.get(sessionIdOrName) ?? sessionIdOrName
    this._removeSession(sessionId)
    this._bridge?.removeSession(sessionId)

    for (const [name, id] of this._namedSessions.entries()) {
      if (id === sessionId) {
        this._namedSessions.delete(name)
      }
    }
  }

  getSessionEditorUrl(sessionId: string, accessHost: BridgeAccessHost = 'loopback'): string | null {
    return this._bridge?.buildEditorUrl(sessionId, accessHost) ?? null
  }

  getSessionWebSocketUrl(sessionId: string, accessHost: BridgeAccessHost = 'loopback'): string | null {
    return this._bridge?.buildWebSocketUrl(sessionId, accessHost) ?? null
  }

  getMobileShareInfo(): TweakpaneShareInfo | null {
    const sessionId = this.ensureClientSession('mobile')
    const loopbackUrl = this.getSessionEditorUrl(sessionId, 'loopback')
    if (!loopbackUrl) {
      return null
    }
    const lanUrl = this.getSessionEditorUrl(sessionId, 'lan')
    return buildShareInfo(sessionId, loopbackUrl, lanUrl)
  }

  private _ensureBridge(): void {
    if (!this._bridge) {
      if (!_createAdapterAndBridge) {
        throw new Error(
          'TweakpaneServer: adapter not registered. Import tweakpaneAdapter.ts before calling show() or register().'
        )
      }
      this._bridge = _createAdapterAndBridge(this)
    }
  }

  /** @internal Register this pane with the scene inspector */
  _registerWithInspector(): void {
    if (!this._bridge || this._inspectorRegistered) return

    const registry = getInspectorRegistry()
    const server = getInspectorServer()
    const baseUrl = this._bridge.getBaseUrl()
    const name = this.inspectorName

    registry.register({
      name,
      componentType: 'tweakpane',
      bridgeBaseUrl: baseUrl,
      registeredAt: Date.now(),
    })

    const bridge = this._bridge
    const self = this
    server.registerSessionFactory(name, {
      createSession: () => {
        const sessionId = self.ensureClientSession()
        const wsUrl = bridge.buildWebSocketUrl(sessionId, 'loopback')
        if (!wsUrl) {
          throw new Error(`Could not build WebSocket URL for tweakpane inspector session ${sessionId}`)
        }
        return { sessionId, wsUrl }
      },
      destroySession: (sessionId: string) => {
        self.removeClientSession(sessionId)
      },
    })

    this._inspectorRegistered = true
  }

  // --- Lifecycle ---

  dispose(): void {
    for (const child of [...this._children]) {
      child.dispose()
    }
    this._children = []
    this._emitter.removeAll('root')
  }

  shutdown(): void {
    // Unregister from inspector
    if (this._inspectorRegistered) {
      const registry = getInspectorRegistry()
      const server = getInspectorServer()
      const name = this.inspectorName
      registry.unregister(name)
      server.unregisterSessionFactory(name)
      this._inspectorRegistered = false
    }

    if (this._bridge) {
      const sessionIds = new Set<string>([
        ...this._sessions,
        ...this._namedSessions.values(),
      ])
      for (const sessionId of sessionIds) {
        this._bridge.removeSession(sessionId)
      }
      this._sessions.clear()
      this._namedSessions.clear()
    }

    this.dispose()
    if (this._bridge) {
      if (this._bridge.getSessions().size === 0) {
        this._bridge.shutdown()
      }
      this._bridge = null
    }
  }

  // --- State Export/Import ---

  exportState(): BladeState {
    return {
      disabled: this._disabled,
      hidden: this._hidden,
      title: this._title,
      expanded: this._expanded,
      children: this._children.map(c => c.exportState()),
    }
  }

  importState(state: BladeState): boolean {
    if (typeof state.disabled === 'boolean') this.disabled = state.disabled
    if (typeof state.hidden === 'boolean') this.hidden = state.hidden
    if (typeof state.title === 'string') this.title = state.title
    if (typeof state.expanded === 'boolean') this.expanded = state.expanded
    return true
  }

  // --- Plugin Registration ---

  registerPlugin(_bundle: TpPluginBundle): void {
    // Custom plugins contain browser-side code. For now, log a warning.
    // TODO: Support passing plugin URLs to iframes for dynamic import.
    console.warn(
      '[TweakpaneServer] registerPlugin() is a no-op on the kernel side. ' +
      'Built-in plugins work automatically. Custom plugins need browser-side loading.'
    )
  }

  // ============================================================================
  // Internal API (used by adapter and proxies)
  // ============================================================================

  /** @internal */
  get operations(): OpMessage[] {
    return this._operations
  }

  /** @internal */
  get paneConfig(): SerializedPaneConfig {
    return this._paneConfig
  }

  /** @internal */
  get sessions(): Set<string> {
    return this._sessions
  }

  /** @internal */
  get bridge(): DenoNotebookBridge<TweakpaneWsClient, TweakpaneHandle, TweakpaneSessionData> | null {
    return this._bridge
  }

  /** @internal Record an operation: append to log + broadcast to live iframes */
  _recordOp(op: OpMessage): void {
    this._operations.push(op)
    this._broadcastToIframes(op)
  }

  /** @internal Broadcast a message to all connected iframes */
  _broadcastToIframes(msg: ServerMessage | OpMessage, excludeSessionId?: string): void {
    if (!this._bridge) return

    for (const sessionId of this._sessions) {
      if (sessionId === excludeSessionId) continue
      const session = this._bridge.getSession(sessionId)
      if (session?.client?.connected) {
        session.client.sendMessage(msg as ServerMessage)
      }
    }
  }

  /** @internal Register a binding for value tracking */
  _registerBinding(id: string, obj: Bindable, key: string): void {
    this._bindings.set(id, { obj, key })
  }

  /** @internal Register a standalone blade value */
  _registerBladeValue(id: string, value: unknown): void {
    this._bladeValues.set(id, value)
  }

  /** @internal Update a standalone blade value */
  _updateBladeValue(id: string, value: unknown): void {
    this._bladeValues.set(id, value)
  }

  /** @internal Remove a child from a parent's children list */
  _removeChild(parentId: string, child: BladeProxy): void {
    if (parentId === 'root') {
      const idx = this._children.indexOf(child)
      if (idx >= 0) this._children.splice(idx, 1)
    }
    // For nested containers, the dispose() method on the child handles removal
  }

  // --- Client Message Handlers (called by adapter) ---

  /** @internal Handle a value change from an iframe */
  _handleValueChange(id: string, key: string, value: unknown, last: boolean, originSessionId: string): void {
    const binding = this._bindings.get(id)
    if (binding) {
      binding.obj[binding.key] = value
    }

    // Fire kernel-side listeners on the specific binding
    this._emitter.fire(id, 'change', { value, last, target: this._findProxy(id) })
    // Bubble to root (pane-level 'change' listeners)
    this._emitter.fire('root', 'change', { value, last, target: this._findProxy(id) })
    // Bubble to parent containers
    this._bubbleChangeEvent(id, value, last)

    // Fan out to other iframes
    this._broadcastToIframes({ type: 'refresh', values: { [id]: value } }, originSessionId)
  }

  /** @internal Handle a button click from an iframe */
  _handleButtonClick(id: string, _originSessionId: string): void {
    this._emitter.fire(id, 'click', { target: this._findProxy(id) })
  }

  /** @internal Handle a fold change from an iframe */
  _handleFoldChange(id: string, expanded: boolean, originSessionId: string): void {
    const proxy = this._findProxy(id)
    if (proxy instanceof FolderProxy) {
      proxy._setExpandedSilent(expanded)
    }
    this._emitter.fire(id, 'fold', { expanded, target: proxy })

    // Sync to other iframes
    this._broadcastToIframes(
      { type: 'setProperty', id, prop: 'expanded', value: expanded },
      originSessionId
    )
  }

  /** @internal Handle a tab select from an iframe */
  _handleTabSelect(id: string, index: number, originSessionId: string): void {
    this._emitter.fire(id, 'select', { index, target: this._findProxy(id) })

    // Sync to other iframes
    this._broadcastToIframes(
      { type: 'setProperty', id, prop: '_selectTab', value: index },
      originSessionId
    )
  }

  /** @internal Handle a blade value change from an iframe */
  _handleBladeValueChange(id: string, value: unknown, last: boolean, originSessionId: string): void {
    this._bladeValues.set(id, value)

    // Update the proxy's internal value
    const proxy = this._findProxy(id)
    if (proxy instanceof SliderBladeProxy) {
      proxy._setValueSilent(value as number)
    } else if (proxy instanceof ListBladeProxy) {
      proxy._setValueSilent(value)
    } else if (proxy instanceof TextBladeProxy) {
      proxy._setValueSilent(value)
    }

    // Fire kernel-side listeners
    this._emitter.fire(id, 'change', { value, last, target: proxy })
    this._emitter.fire('root', 'change', { value, last, target: proxy })

    // Fan out to other iframes
    this._broadcastToIframes({ type: 'bladeValue', id, value }, originSessionId)
  }

  /** @internal Remove a session */
  _removeSession(sessionId: string): void {
    this._sessions.delete(sessionId)
  }

  // --- Private helpers ---

  private _findProxy(id: string): BladeProxy | undefined {
    if (id === 'root') return undefined
    return this._findProxyInChildren(id, this._children)
  }

  private _findProxyInChildren(id: string, children: BladeProxy[]): BladeProxy | undefined {
    for (const child of children) {
      if (child.proxyId === id) return child
      // Search in container children
      if (child instanceof FolderProxy || child instanceof TabPageProxy) {
        const found = this._findProxyInChildren(id, child._children)
        if (found) return found
      }
      if (child instanceof TabProxy) {
        for (const page of child.pages) {
          if (page.proxyId === id) return page
          const found = this._findProxyInChildren(id, page._children)
          if (found) return found
        }
      }
    }
    return undefined
  }

  private _bubbleChangeEvent(id: string, value: unknown, last: boolean): void {
    // Walk up the tree to find parent containers and fire their 'change' events
    const parentId = this._findParentId(id, this._children, 'root')
    if (parentId && parentId !== 'root') {
      this._emitter.fire(parentId, 'change', { value, last, target: this._findProxy(id) })
      this._bubbleChangeEvent(parentId, value, last)
    }
  }

  private _findParentId(targetId: string, children: BladeProxy[], parentId: string): string | undefined {
    for (const child of children) {
      if (child.proxyId === targetId) return parentId
      if (child instanceof FolderProxy || child instanceof TabPageProxy) {
        const found = this._findParentId(targetId, child._children, child.proxyId)
        if (found) return found
      }
      if (child instanceof TabProxy) {
        for (const page of child.pages) {
          if (page.proxyId === targetId) return child.proxyId
          const found = this._findParentId(targetId, page._children, page.proxyId)
          if (found) return found
        }
      }
    }
    return undefined
  }
}

// ============================================================================
// Type Compatibility Assertions
//
// These type-level checks verify our proxy classes match tweakpane's public API
// surface (excluding DOM-only members). A type error here means we've missed
// or incorrectly typed a public API member.
// ============================================================================

// Helper: extract public instance members, excluding DOM-specific ones
type PublicMembers<T> = {
  // deno-lint-ignore no-explicit-any
  [K in keyof T as K extends 'controller' | 'rackApi_' ? never : K]: T[K]
}

// Check BladeProxy covers BladeApi's public surface
type _BladeCheck = {
  [K in keyof PublicMembers<TpBladeApi>]:
    K extends keyof BladeProxy ? true : `MISSING on BladeProxy: ${K & string}`
}

// Check BindingProxy covers InputBindingApi's public surface
type _BindingCheck = {
  [K in keyof PublicMembers<TpInputBindingApi>]:
    K extends keyof BindingProxy ? true : `MISSING on BindingProxy: ${K & string}`
}

// Check FolderProxy covers FolderApi's public surface
type _FolderCheck = {
  [K in keyof PublicMembers<TpFolderApi>]:
    K extends keyof FolderProxy ? true : `MISSING on FolderProxy: ${K & string}`
}

// Check ButtonProxy covers ButtonApi's public surface
type _ButtonCheck = {
  [K in keyof PublicMembers<TpButtonApi>]:
    K extends keyof ButtonProxy ? true : `MISSING on ButtonProxy: ${K & string}`
}

// Check TabProxy covers TabApi's public surface
type _TabCheck = {
  [K in keyof PublicMembers<TpTabApi>]:
    K extends keyof TabProxy ? true : `MISSING on TabProxy: ${K & string}`
}

// Check TabPageProxy covers TabPageApi's public surface
type _TabPageCheck = {
  [K in keyof PublicMembers<TpTabPageApi>]:
    K extends keyof TabPageProxy ? true : `MISSING on TabPageProxy: ${K & string}`
}

// Check SliderBladeProxy covers SliderBladeApi's public surface
type _SliderBladeCheck = {
  [K in keyof PublicMembers<TpSliderBladeApi>]:
    K extends keyof SliderBladeProxy ? true : `MISSING on SliderBladeProxy: ${K & string}`
}

// Check ListBladeProxy covers ListBladeApi's public surface
type _ListBladeCheck = {
  [K in keyof PublicMembers<TpListBladeApi<unknown>>]:
    K extends keyof ListBladeProxy ? true : `MISSING on ListBladeProxy: ${K & string}`
}

// Check TextBladeProxy covers TextBladeApi's public surface
type _TextBladeCheck = {
  [K in keyof PublicMembers<TpTextBladeApi<unknown>>]:
    K extends keyof TextBladeProxy ? true : `MISSING on TextBladeProxy: ${K & string}`
}

// Check SeparatorBladeProxy covers SeparatorBladeApi's public surface
type _SeparatorBladeCheck = {
  [K in keyof PublicMembers<TpSeparatorBladeApi>]:
    K extends keyof SeparatorBladeProxy ? true : `MISSING on SeparatorBladeProxy: ${K & string}`
}

// Force TypeScript to evaluate the checks (unused vars are fine — they're type-only)
// deno-lint-ignore no-explicit-any
type _ForceEval = _BladeCheck & _BindingCheck & _FolderCheck & _ButtonCheck & _TabCheck & _TabPageCheck & _SliderBladeCheck & _ListBladeCheck & _TextBladeCheck & _SeparatorBladeCheck & any
