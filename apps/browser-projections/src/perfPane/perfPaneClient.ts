/**
 * PerfPaneClient — browser-side client for the hanoiShow "perf pane" UI.
 *
 * Speaks the same wire protocol as webcomponents/tweakpane/src/tweakpane-client.ts
 * (receives `OpMessage`s over WebSocket, sends `valueChange` on user drag), but
 * exposes a reactive Vue model instead of building a Tweakpane Pane. The Vue
 * components render that model as vertical sliders.
 *
 * Protocol types are duplicated here to keep the webcomponent free of
 * cross-environment imports (same pattern as tweakpane-client.ts).
 */

import { reactive } from 'vue'

// ── Protocol (duplicated to avoid cross-env imports) ────────────────

interface SerializedOptions {
  [key: string]: unknown
  _functions?: Record<string, string>
}

type OpMessage =
  | { type: 'addBinding'; id: string; parentId: string; key: string; value: unknown; opts: SerializedOptions }
  | { type: 'addFolder'; id: string; parentId: string; opts: { title: string; expanded?: boolean } }
  | { type: 'addButton'; id: string; parentId: string; opts: { title: string; label?: string } }
  | { type: 'addTab'; id: string; parentId: string; opts: { pages: { title: string }[] }; pageIds: string[] }
  | { type: 'addBlade'; id: string; parentId: string; opts: SerializedOptions }
  | { type: 'addSeparator'; id: string; parentId: string; opts?: unknown }
  | { type: 'remove'; id: string; parentId: string }
  | { type: 'dispose'; id: string }
  | { type: 'setProperty'; id: string; prop: string; value: unknown }
  | { type: 'refresh'; values: Record<string, unknown> }
  | { type: 'bladeValue'; id: string; value: unknown }

type ServerMessage =
  | { type: 'replay'; paneConfig: { title?: string }; operations: OpMessage[] }
  | OpMessage

type ClientMessage =
  | { type: 'valueChange'; id: string; key: string; value: unknown; last: boolean }
  | { type: 'connectionReady' }

// ── Reactive view model ─────────────────────────────────────────────

export interface SliderModel {
  id: string
  parentId: string
  key: string
  label: string
  min: number
  max: number
  step: number
  value: number
}

export interface TabPageModel {
  id: string
  title: string
  sliders: SliderModel[]
}

export interface TabModel {
  id: string
  pages: TabPageModel[]
  selectedIndex: number
}

export interface MixerSliderModel {
  id: string
  label: string
  slider: SliderModel
}

export interface PerfPaneModel {
  connected: boolean
  title: string
  tabs: TabModel[]
  mixerSliders: MixerSliderModel[]
  /** Sliders that live at the root (no tab container). */
  rootSliders: SliderModel[]
}

/**
 * Minimal WebSocket shape we accept. The real browser `WebSocket` satisfies it;
 * dev-harness mocks only need implement these.
 */
export interface WsLike {
  readyState: number
  send(data: string): void
  close(): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: unknown) => void) | null
}

// ── Client ──────────────────────────────────────────────────────────

export class PerfPaneClient {
  readonly model: PerfPaneModel
  private ws: WsLike
  private sliderById = new Map<string, SliderModel>()
  private tabPageParentOf = new Map<string, { tab: TabModel; pageIndex: number }>()
  private suppressSync = false

  constructor(wsOrUrl: WsLike | string) {
    this.model = reactive({
      connected: false,
      title: '',
      tabs: [],
      mixerSliders: [],
      rootSliders: [],
    }) as PerfPaneModel

    this.ws = typeof wsOrUrl === 'string' ? (new WebSocket(wsOrUrl) as WsLike) : wsOrUrl

    this.ws.onopen = () => {
      this.model.connected = true
      this.send({ type: 'connectionReady' })
    }
    this.ws.onclose = () => {
      this.model.connected = false
    }
    this.ws.onmessage = (ev) => {
      try {
        const msg: ServerMessage = typeof ev.data === 'string'
          ? JSON.parse(ev.data)
          : (ev.data as ServerMessage)
        this.handleMessage(msg)
      } catch (e) {
        console.error('[PerfPaneClient] parse error', e)
      }
    }
  }

  private handleMessage(msg: ServerMessage): void {
    if (msg.type === 'replay') {
      this.model.title = msg.paneConfig?.title ?? ''
      this.model.tabs = []
      this.model.mixerSliders = []
      this.model.rootSliders = []
      this.sliderById.clear()
      this.tabPageParentOf.clear()
      for (const op of msg.operations) this.applyOp(op)
      return
    }
    this.applyOp(msg)
  }

  private applyOp(op: OpMessage): void {
    switch (op.type) {
      case 'addTab': {
        const tab: TabModel = reactive({
          id: op.id,
          pages: op.opts.pages.map((p, i) => ({
            id: op.pageIds[i],
            title: p.title,
            sliders: [] as SliderModel[],
          })),
          selectedIndex: 0,
        }) as TabModel
        this.model.tabs.push(tab)
        op.pageIds.forEach((pageId, i) => {
          this.tabPageParentOf.set(pageId, { tab, pageIndex: i })
        })
        break
      }
      case 'addBinding': {
        if (typeof op.value !== 'number') break
        const slider: SliderModel = reactive({
          id: op.id,
          parentId: op.parentId,
          key: op.key,
          label: (op.opts.label as string) ?? op.key,
          min: typeof op.opts.min === 'number' ? (op.opts.min as number) : 0,
          max: typeof op.opts.max === 'number' ? (op.opts.max as number) : 1,
          step: typeof op.opts.step === 'number' ? (op.opts.step as number) : 0.001,
          value: op.value,
        }) as SliderModel
        this.sliderById.set(op.id, slider)
        const parent = this.tabPageParentOf.get(op.parentId)
        if (parent) {
          parent.tab.pages[parent.pageIndex].sliders.push(slider)
          if (isSceneFadeSlider(op.key, slider.label)) {
            this.model.mixerSliders.push({
              id: `mixer_${slider.id}`,
              label: parent.tab.pages[parent.pageIndex].title,
              slider,
            })
          }
        } else {
          this.model.rootSliders.push(slider)
        }
        break
      }
      case 'refresh': {
        this.suppressSync = true
        try {
          for (const [id, value] of Object.entries(op.values)) {
            const slider = this.sliderById.get(id)
            if (slider && typeof value === 'number') slider.value = value
          }
        } finally {
          this.suppressSync = false
        }
        break
      }
      case 'bladeValue': {
        const slider = this.sliderById.get(op.id)
        if (slider && typeof op.value === 'number') {
          this.suppressSync = true
          slider.value = op.value
          this.suppressSync = false
        }
        break
      }
      case 'setProperty': {
        const slider = this.sliderById.get(op.id)
        if (!slider) break
        if (op.prop === 'label' && typeof op.value === 'string') slider.label = op.value
        if (op.prop === 'min' && typeof op.value === 'number') slider.min = op.value
        if (op.prop === 'max' && typeof op.value === 'number') slider.max = op.value
        break
      }
      // addFolder / addButton / addBlade / addSeparator / remove / dispose —
      // perf pane doesn't drive these today. Silently ignored.
      default:
        break
    }
  }

  /** Called by the UI on drag. `last=true` on pointerup. */
  setSliderValue(slider: SliderModel, value: number, last: boolean): void {
    const clamped = Math.max(slider.min, Math.min(slider.max, value))
    const stepped = slider.step > 0
      ? Math.round(clamped / slider.step) * slider.step
      : clamped
    slider.value = stepped
    if (this.suppressSync) return
    this.send({ type: 'valueChange', id: slider.id, key: slider.key, value: stepped, last })
  }

  private send(msg: ClientMessage): void {
    if (this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  disconnect(): void {
    if (this.ws.readyState === 1) this.ws.close()
  }
}

function isSceneFadeSlider(key: string, label: string): boolean {
  return label === 'Scene Fade' || key === 'fade' || key === 'sceneFade'
}
