import Konva from 'konva'
import type { PianoRollState, NoteData, RedrawLayer } from './state'

export interface StageManagerDependencies {
  state: PianoRollState
  getContainer: () => HTMLDivElement | null
  initializeLayers: (state: PianoRollState, stage: Konva.Stage) => void
  setupEventHandlers: (state: PianoRollState, stage: Konva.Stage) => () => void
  renderGrid: (state: PianoRollState) => void
  renderGhostNotes: (state: PianoRollState) => void
  renderVisibleNotes: (state: PianoRollState) => void
  updatePlayheadMarkers: (state: PianoRollState) => void
  /** The keyboard column beside the stage (gutter.ts). */
  renderGutter: () => void
  /** Called after every frame that redrew; the wrapper syncs its counters here. */
  afterRedraw: () => void
  enforceScrollBounds: () => void
  attachKeyboard: () => void
  detachKeyboard: () => void
}

export interface StageMountOptions {
  width: number
  height: number
  interactive: boolean
  initialNotes: Array<[string, NoteData]>
}

export class StageManager {
  private eventHandlersInitialized = false
  private teardownEventHandlers: (() => void) | null = null
  private keyboardAttached = false

  constructor(private readonly deps: StageManagerDependencies) {}

  private pending = new Set<RedrawLayer>()
  private frame?: number
  private visible = true
  private visibility?: IntersectionObserver

  private requestRedraw = (layer: RedrawLayer = 'all') => {
    this.pending.add(layer)
    if (this.visible && this.frame === undefined) this.frame = requestAnimationFrame(this.renderFrame)
  }

  private renderFrame = () => {
    this.frame = undefined
    if (!this.visible) return
    const dirty = this.pending
    this.pending = new Set()
    const { state } = this.deps
    const all = dirty.has('all')
    if (all) this.deps.renderGrid(state)
    if (all || dirty.has('gutter')) this.deps.renderGutter()
    // Links follow their notes, so a notes redraw also redraws them
    if (all || dirty.has('ghosts') || (dirty.has('notes') && state.links.length > 0)) this.deps.renderGhostNotes(state)
    if (all || dirty.has('overlay')) this.deps.updatePlayheadMarkers(state)
    if (all || dirty.has('notes')) {
      this.deps.renderVisibleNotes(state)
      this.deps.afterRedraw()
    }
  }

  private enableInteractivity() {
    if (!this.deps.state.stage) return

    if (!this.eventHandlersInitialized) {
      this.teardownEventHandlers = this.deps.setupEventHandlers(this.deps.state, this.deps.state.stage)
      this.eventHandlersInitialized = true
    }

    this.deps.state.stage.listening(true)

    if (!this.keyboardAttached) {
      this.deps.attachKeyboard()
      this.keyboardAttached = true
    }
  }

  private disableInteractivity() {
    if (!this.deps.state.stage) return

    this.deps.state.stage.listening(false)
    this.deps.state.interaction.isDragging = false
    this.deps.state.interaction.isResizing = false
    this.deps.state.interaction.isMarqueeSelecting = false
    this.deps.state.interaction.isDrawing = false

    if (this.keyboardAttached) {
      this.deps.detachKeyboard()
      this.keyboardAttached = false
    }

    this.deps.state.layers.overlay?.batchDraw()
    this.deps.afterRedraw()
  }

  mount({ width, height, interactive, initialNotes }: StageMountOptions) {
    const container = this.deps.getContainer()
    if (!container) {
      console.error('Konva container ref not found')
      return
    }

    const stageInstance = new Konva.Stage({
      container,
      width,
      height
    })

    this.deps.state.stage = stageInstance
    this.deps.state.konvaContainer = container

    this.deps.initializeLayers(this.deps.state, stageInstance)

    if (interactive) {
      this.enableInteractivity()
    } else {
      this.disableInteractivity()
    }

    if (initialNotes.length > 0) {
      this.deps.state.notes = new Map(initialNotes)
    }

    this.visible = true
    this.visibility = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (!entry) return
      this.visible = entry.isIntersecting
      if (this.visible && this.pending.size) this.requestRedraw()
    })
    this.visibility.observe(container)
    this.deps.state.requestRedraw = this.requestRedraw
    this.requestRedraw()

    this.deps.enforceScrollBounds()
  }

  unmount() {
    this.deps.state.requestRedraw = () => {}
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    this.frame = undefined
    this.pending.clear()
    this.visibility?.disconnect()
    this.disableInteractivity()
    this.teardownEventHandlers?.()
    this.teardownEventHandlers = null
    // Destroying the stage destroys its layers and the per-layer shapes; the
    // references are dropped so a remount builds fresh ones.
    this.deps.state.stage?.destroy()
    this.deps.state.stage = undefined
    this.deps.state.konvaContainer = undefined
    this.deps.state.layers = {}
    this.deps.state.shapes = {}
    this.eventHandlersInitialized = false
  }

  setInteractive(interactive: boolean) {
    if (!this.deps.state.stage) return
    if (interactive) {
      this.enableInteractivity()
    } else {
      this.disableInteractivity()
    }
  }

  resize(width: number, height: number) {
    if (!this.deps.state.stage) return
    this.deps.state.stage.width(width)
    this.deps.state.stage.height(height)
    this.requestRedraw()
    this.deps.enforceScrollBounds()
  }
}
