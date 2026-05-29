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
  | {
      type: 'addBinding'
      id: string
      parentId: string
      key: string
      value: unknown
      opts: SerializedOptions
    }
  | { type: 'addFolder'; id: string; parentId: string; opts: { title: string; expanded?: boolean } }
  | { type: 'addButton'; id: string; parentId: string; opts: { title: string; label?: string } }
  | {
      type: 'addTab'
      id: string
      parentId: string
      opts: { pages: { title: string }[] }
      pageIds: string[]
    }
  | { type: 'addBlade'; id: string; parentId: string; opts: SerializedOptions }
  | { type: 'addSeparator'; id: string; parentId: string; opts?: unknown }
  | { type: 'remove'; id: string; parentId: string }
  | { type: 'dispose'; id: string }
  | { type: 'setProperty'; id: string; prop: string; value: unknown }
  | { type: 'refresh'; values: Record<string, unknown> }
  | { type: 'bladeValue'; id: string; value: unknown }

type ServerMessage =
  | { type: 'replay'; paneConfig: { title?: string }; operations: OpMessage[] }
  | { type: 'midiEncoderDelta'; channel: number; cc: number; delta: number }
  | { type: 'midiControllerAbsolute'; channel: number; cc: number; value: number }
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
  defaultValue: number
}

export interface ToggleModel {
  id: string
  parentId: string
  key: string
  label: string
  value: boolean
}

export interface TabPageModel {
  id: string
  title: string
  sliders: SliderModel[]
  toggles: ToggleModel[]
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
  /** Boolean bindings that live at the root (no tab container). */
  rootToggles: ToggleModel[]
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

export function coerceSliderValue(slider: SliderModel, value: number): number {
  const clamped = Math.max(slider.min, Math.min(slider.max, value))
  return slider.step > 0 ? Math.round(clamped / slider.step) * slider.step : clamped
}

const MIDI_FIGHTER_TWISTER_ENCODER_CHANNEL = 0
const MIDI_FIGHTER_TWISTER_ENCODER_CC_MIN = 0
const MIDI_FIGHTER_TWISTER_ENCODER_CC_MAX = 63
const MIDI_FIGHTER_TWISTER_ENCODERS_PER_BANK = 16
const MIDI_TARGET_FULL_SWEEP_TICKS = 96
const MIDI_ABSOLUTE_TAKEOVER_THRESHOLD = 0.04

// ── Client ──────────────────────────────────────────────────────────

export class PerfPaneClient {
  readonly model: PerfPaneModel
  private ws: WsLike
  private sliderById = new Map<string, SliderModel>()
  private toggleById = new Map<string, ToggleModel>()
  private tabPageParentOf = new Map<string, { tab: TabModel; pageIndex: number }>()
  private absoluteMidiTakeoverByControl = new Map<string, string>()
  private suppressSync = false

  constructor(wsOrUrl: WsLike | string) {
    this.model = reactive({
      connected: false,
      title: '',
      tabs: [],
      mixerSliders: [],
      rootSliders: [],
      rootToggles: []
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
        const msg: ServerMessage =
          typeof ev.data === 'string' ? JSON.parse(ev.data) : (ev.data as ServerMessage)
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
      this.model.rootToggles = []
      this.sliderById.clear()
      this.toggleById.clear()
      this.tabPageParentOf.clear()
      this.absoluteMidiTakeoverByControl.clear()
      for (const op of msg.operations) this.applyOp(op)
      return
    }
    if (msg.type === 'midiEncoderDelta') {
      this.applyMidiEncoderDelta(msg.channel, msg.cc, msg.delta)
      return
    }
    if (msg.type === 'midiControllerAbsolute') {
      this.applyMidiControllerAbsolute(msg.channel, msg.cc, msg.value)
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
            toggles: [] as ToggleModel[]
          })),
          selectedIndex: 0
        }) as TabModel
        this.model.tabs.push(tab)
        op.pageIds.forEach((pageId, i) => {
          this.tabPageParentOf.set(pageId, { tab, pageIndex: i })
        })
        break
      }
      case 'addBinding': {
        const parent = this.tabPageParentOf.get(op.parentId)
        if (typeof op.value === 'number') {
          const slider: SliderModel = reactive({
            id: op.id,
            parentId: op.parentId,
            key: op.key,
            label: (op.opts.label as string) ?? op.key,
            min: typeof op.opts.min === 'number' ? (op.opts.min as number) : 0,
            max: typeof op.opts.max === 'number' ? (op.opts.max as number) : 1,
            step: typeof op.opts.step === 'number' ? (op.opts.step as number) : 0.001,
            value: op.value,
            defaultValue: op.value
          }) as SliderModel
          this.sliderById.set(op.id, slider)
          if (parent) {
            parent.tab.pages[parent.pageIndex].sliders.push(slider)
            if (isSceneFadeSlider(op.key, slider.label)) {
              this.model.mixerSliders.push({
                id: `mixer_${slider.id}`,
                label: parent.tab.pages[parent.pageIndex].title,
                slider
              })
            }
          } else {
            this.model.rootSliders.push(slider)
          }
        } else if (typeof op.value === 'boolean') {
          const toggle: ToggleModel = reactive({
            id: op.id,
            parentId: op.parentId,
            key: op.key,
            label: (op.opts.label as string) ?? op.key,
            value: op.value
          }) as ToggleModel
          this.toggleById.set(op.id, toggle)
          if (parent) {
            parent.tab.pages[parent.pageIndex].toggles.push(toggle)
          } else {
            this.model.rootToggles.push(toggle)
          }
        }
        break
      }
      case 'refresh': {
        this.suppressSync = true
        try {
          for (const [id, value] of Object.entries(op.values)) {
            const slider = this.sliderById.get(id)
            if (slider && typeof value === 'number') {
              slider.value = value
              this.releaseAbsoluteMidiTakeoverForSlider(slider.id)
            }
            const toggle = this.toggleById.get(id)
            if (toggle && typeof value === 'boolean') toggle.value = value
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
          this.releaseAbsoluteMidiTakeoverForSlider(slider.id)
          this.suppressSync = false
        }
        const toggle = this.toggleById.get(op.id)
        if (toggle && typeof op.value === 'boolean') {
          this.suppressSync = true
          toggle.value = op.value
          this.suppressSync = false
        }
        break
      }
      case 'setProperty': {
        const slider = this.sliderById.get(op.id)
        if (slider) {
          if (op.prop === 'label' && typeof op.value === 'string') slider.label = op.value
          if (op.prop === 'min' && typeof op.value === 'number') slider.min = op.value
          if (op.prop === 'max' && typeof op.value === 'number') slider.max = op.value
          if ((op.prop === 'min' || op.prop === 'max') && typeof op.value === 'number') {
            this.releaseAbsoluteMidiTakeoverForSlider(slider.id)
          }
        }
        const toggle = this.toggleById.get(op.id)
        if (toggle) {
          if (op.prop === 'label' && typeof op.value === 'string') toggle.label = op.value
        }
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
    this.releaseAbsoluteMidiTakeoverForSlider(slider.id)
    this.writeSliderValue(slider, value, last)
  }

  private writeSliderValue(slider: SliderModel, value: number, last: boolean): void {
    const stepped = coerceSliderValue(slider, value)
    slider.value = stepped
    if (this.suppressSync) return
    this.send({ type: 'valueChange', id: slider.id, key: slider.key, value: stepped, last })
  }

  setToggleValue(toggle: ToggleModel, value: boolean, last: boolean): void {
    toggle.value = value
    if (this.suppressSync) return
    this.send({ type: 'valueChange', id: toggle.id, key: toggle.key, value, last })
  }

  private applyMidiEncoderDelta(channel: number, cc: number, delta: number): void {
    if (delta === 0) return
    const slider = this.findMidiMappedSlider(channel, cc)
    if (!slider) return

    const stepSize = getMidiStepSize(slider)
    this.setSliderValue(slider, slider.value + delta * stepSize, true)
  }

  private applyMidiControllerAbsolute(channel: number, cc: number, value: number): void {
    const slider = this.findMidiMappedSlider(channel, cc)
    if (!slider) return

    const controlKey = getMidiControlKey(channel, cc)
    const controllerNorm = clampNormalized(value)
    const sliderNorm = sliderValueToNorm(slider, slider.value)
    const latchedSliderId = this.absoluteMidiTakeoverByControl.get(controlKey)

    if (latchedSliderId !== slider.id) {
      if (Math.abs(controllerNorm - sliderNorm) > MIDI_ABSOLUTE_TAKEOVER_THRESHOLD) {
        return
      }
      this.absoluteMidiTakeoverByControl.set(controlKey, slider.id)
    }

    this.writeSliderValue(slider, sliderNormToValue(slider, controllerNorm), true)
  }

  private findMidiMappedSlider(channel: number, cc: number): SliderModel | null {
    if (channel !== MIDI_FIGHTER_TWISTER_ENCODER_CHANNEL) return null
    if (cc < MIDI_FIGHTER_TWISTER_ENCODER_CC_MIN || cc > MIDI_FIGHTER_TWISTER_ENCODER_CC_MAX) {
      return null
    }

    const activePage = this.getActivePage()
    if (!activePage) return null

    // Default Twister encoder CCs are assigned in 16-wide bank blocks.
    const macroIndex = cc % MIDI_FIGHTER_TWISTER_ENCODERS_PER_BANK
    return activePage.sliders[macroIndex] ?? null
  }

  private getActivePage(): TabPageModel | null {
    for (const tab of this.model.tabs) {
      const page = tab.pages[tab.selectedIndex]
      if (page) return page
    }
    return null
  }

  private send(msg: ClientMessage): void {
    if (this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  disconnect(): void {
    if (this.ws.readyState === 1) this.ws.close()
  }

  private releaseAbsoluteMidiTakeoverForSlider(sliderId: string): void {
    for (const [controlKey, latchedSliderId] of this.absoluteMidiTakeoverByControl) {
      if (latchedSliderId === sliderId) {
        this.absoluteMidiTakeoverByControl.delete(controlKey)
      }
    }
  }
}

function isSceneFadeSlider(key: string, label: string): boolean {
  return label === 'Scene Fade' || key === 'fade' || key === 'sceneFade'
}

function getMidiStepSize(slider: SliderModel): number {
  const range = slider.max - slider.min
  if (!(range > 0)) {
    return slider.step > 0 ? slider.step : 0.01
  }

  const targetDelta = range / MIDI_TARGET_FULL_SWEEP_TICKS
  if (slider.step > 0) {
    const stepCount = Math.max(1, Math.round(targetDelta / slider.step))
    return stepCount * slider.step
  }

  return targetDelta
}

function getMidiControlKey(channel: number, cc: number): string {
  return `${channel}:${cc}`
}

function clampNormalized(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function sliderValueToNorm(slider: SliderModel, value: number): number {
  const range = slider.max - slider.min
  if (range <= 0) return 0
  return clampNormalized((value - slider.min) / range)
}

function sliderNormToValue(slider: SliderModel, norm: number): number {
  return slider.min + clampNormalized(norm) * (slider.max - slider.min)
}
