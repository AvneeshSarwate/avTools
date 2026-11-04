import Konva from 'konva'
import type { PianoRollState, NoteData } from './state'

export interface StageManagerDependencies {
  state: PianoRollState
  getContainer: () => HTMLDivElement | null
  initializeLayers: (state: PianoRollState, stage: Konva.Stage) => void
  setupEventHandlers: (state: PianoRollState, stage: Konva.Stage) => () => void
  renderGrid: (state: PianoRollState) => void
  renderGhostNotes: (state: PianoRollState) => void
  renderVisibleNotes: (state: PianoRollState) => void
  renderResizeHandles: (state: PianoRollState) => void
  updateQueuePlayheadPosition: (state: PianoRollState) => void
  updatePlayheadMarkers: (state: PianoRollState) => void
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

  private renderFrame = () => {
    const state = this.deps.state
    const all = state.needsRedraw
    const { dirty } = state
    if (all || dirty.ghosts || dirty.notes || dirty.overlay) {
      if (all) this.deps.renderGrid(state)
      if (all || dirty.ghosts) this.deps.renderGhostNotes(state)
      if (all || dirty.notes) {
        this.deps.renderVisibleNotes(state)
        this.deps.renderResizeHandles(state)
      }
      if (all || dirty.overlay) {
        this.deps.updateQueuePlayheadPosition(state)
        this.deps.updatePlayheadMarkers(state)
      }
      const notesChanged = all || dirty.notes
      state.needsRedraw = false
      dirty.ghosts = false
      dirty.notes = false
      dirty.overlay = false
      // Counters and selection only move with the notes layer.
      if (notesChanged) this.deps.afterRedraw()
    }
    state.rafHandle = requestAnimationFrame(this.renderFrame)
  }

  private startRenderLoop() {
    this.stopRenderLoop()
    this.deps.state.rafHandle = requestAnimationFrame(this.renderFrame)
  }

  private stopRenderLoop() {
    if (this.deps.state.rafHandle) {
      cancelAnimationFrame(this.deps.state.rafHandle)
      this.deps.state.rafHandle = undefined
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

    this.startRenderLoop()
    this.deps.state.needsRedraw = true

    this.deps.enforceScrollBounds()
  }

  unmount() {
    this.stopRenderLoop()
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
    this.deps.state.needsRedraw = true
    this.deps.enforceScrollBounds()
  }
}
