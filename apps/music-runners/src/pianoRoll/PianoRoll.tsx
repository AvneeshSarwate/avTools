// React + Konva piano roll: a port of browser-projections' PianoRollRoot.vue.
// React owns the wrapper, control panel, scrollbars, metadata panel and the
// lifecycle; Konva is driven imperatively by core.ts exactly as in the Vue
// version (visible-note culling, needsRedraw flag, one batchDraw per layer per
// RAF frame). MPE pitch curves are drawn read-only; expression lanes and curve
// editing are not ported. Live MIDI input is an overlay set through the handle.
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { createPortal } from 'react-dom'
import { proxy, useSnapshot } from 'valtio'
import './pianoRoll.css'
import { ControlPanel, NoteCount } from './ControlPanel'
import { ExpressionMenu, type ExpressionMenuActions, type ExpressionMenuState } from './ExpressionMenu'
import { deletePoint, setNoteVelocity, setPointValue, togglePointRooted } from './expression'
import { DEFAULT_SCALE } from './scale'
import { drawGutter, GUTTER_WIDTH, gutterPitchAt } from './gutter'
import { lanesHeight, LANE_HEIGHT } from './lanes'
import { NumberBox, Toggle } from '../ui/controls/controls'
import type { ExpressionLane } from './state'
import { DEFAULT_VELOCITY } from './constants'
import type { JsonObject, LiveInput, PianoRollHandle, PianoRollScale, PianoRollNote, PianoRollProps, PianoRollView, PlayheadMarker } from './types'
import { createPianoRollState, type NoteData, type PianoRollState } from './state'
import {
  initializeLayers,
  setupEventHandlers,
  renderGrid,
  renderGhostNotes,
  renderVisibleNotes,
  renderResizeHandles,
  updateQueuePlayheadPosition,
  updatePlayheadMarkers,
  mutateSelection,
  captureState
} from './core'
import { cloneNote, executeOverlapChanges } from './utils'
import { invalidateNoteIndex } from './noteIndex'
import {
  applyHorizontalZoom,
  applyVerticalZoom,
  fitZoomToNotes as fitZoomToNotesHelper,
  getHorizontalViewportRange,
  getVerticalViewportRange,
  getView as getViewHelper,
  setView as setViewHelper,
  updateScrollBounds,
  zoomHorizontalBy,
  zoomVerticalBy
} from './viewport'
import {
  HorizontalScrollbarController,
  VerticalScrollbarController,
  type HorizontalDragMode,
  type VerticalDragMode
} from './scrollbars'
import { createCommandHandlers } from './commands'
import { createKeyboardController } from './keyboard'
import { StageManager } from './stageManager'
import { MetadataTree } from './metadata/MetadataTree'
import { applyPlan, type EditPlan } from './metadata/groupEdit'
import { DEFAULT_SUBDIVISION, LAYOUT_GAP, SCROLLBAR_THICKNESS } from './constants'

const VIEW_CHANGE_DEBOUNCE_MS = 300
const ZOOM_BUTTON_FACTOR = 1.25
const WHEEL_ZOOM_SENSITIVITY = 0.002

/**
 * The UI-facing projection of the imperative core, as a valtio proxy. The core
 * writes it at commit points (selection, note edits, command stack); React
 * reads it with useSnapshot, so each piece of chrome re-renders only when a
 * field it actually read changed. Nothing per-frame lives here: scroll thumbs
 * and playhead markers are written straight to the DOM / Konva.
 */
interface UiState {
  noteCount: number
  selectionCount: number
  canUndo: boolean
  canRedo: boolean
  selectedNotes: NoteData[]
}

const isEditableTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

export const PianoRoll = forwardRef<PianoRollHandle, PianoRollProps>(function PianoRoll(props, ref) {
  const {
    notes,
    loopLength,
    width,
    height,
    interactive = true,
    showControlPanel = true,
    playheadMarkers,
    ghostNotes,
    noteBadge,
    noteColor,
    onNotePreview,
    renderMetadataPanel,
    initialView,
    snapToGrid,
    toolbarTarget,
    scale: scaleProp,
    onScaleChange,
    expressionLanes,
    pitchLabels = 'name',
    navigable: navigableProp,
    rawMetadataEditor = true
  } = props
  const navigable = navigableProp ?? interactive
  // Lanes and the Notes/MPE switch belong to an editable roll with tools.
  const lanesEnabled = expressionLanes ?? (interactive && showControlPanel)

  // Latest props for the stable controllers below.
  const propsRef = useRef(props)
  propsRef.current = props
  const sizeRef = useRef({ width, height })
  sizeRef.current = { width, height }
  const interactiveRef = useRef(interactive)
  interactiveRef.current = interactive
  // Scrolling and zooming; editing still needs `interactive`.
  const navigableRef = useRef(navigable)
  navigableRef.current = navigable

  const stateRef = useRef<PianoRollState | null>(null)
  if (!stateRef.current) stateRef.current = createPianoRollState()
  const state = stateRef.current

  const wrapperRef = useRef<HTMLDivElement>(null)
  const konvaContainerRef = useRef<HTMLDivElement>(null)
  const horizontalTrackRef = useRef<HTMLDivElement>(null)
  const verticalTrackRef = useRef<HTMLDivElement>(null)

  const [uiState] = useState(() =>
    proxy<UiState>({ noteCount: 0, selectionCount: 0, canUndo: false, canRedo: false, selectedNotes: [] })
  )
  const ui = useSnapshot(uiState)
  const hThumbRef = useRef<HTMLDivElement>(null)
  const vThumbRef = useRef<HTMLDivElement>(null)
  const [subdivision, setSubdivision] = useState(DEFAULT_SUBDIVISION)
  const [snap, setSnap] = useState(snapToGrid ?? true)
  const [drawMode, setDrawMode] = useState(false)
  const [showMetadata, setShowMetadata] = useState(false)
  // Note expression (expression.ts): Notes or MPE mode, and which lanes show.
  const [expressionMode, setExpressionMode] = useState<'notes' | 'mpe'>('notes')
  const [lanesVisible, setLanesVisible] = useState<Record<ExpressionLane, boolean>>({ velocity: true, pressure: true, timbre: true })
  const gutterRef = useRef<HTMLCanvasElement>(null)
  const [expressionMenu, setExpressionMenu] = useState<ExpressionMenuState | null>(null)
  const closeExpressionMenu = useCallback(() => setExpressionMenu(null), [])
  // Controlled by the host when it passes `scale`; otherwise kept here.
  const [localScale, setLocalScale] = useState<PianoRollScale>(DEFAULT_SCALE)
  const scale = scaleProp ?? localScale
  const changeScale = useCallback(
    (next: PianoRollScale) => {
      if (onScaleChange) onScaleChange(next)
      if (!scaleProp) setLocalScale(next)
    },
    [onScaleChange, scaleProp]
  )

  // The array last emitted or last hydrated from, by reference first and by
  // JSON second: echoes of our own emission (and identical re-sends) never
  // re-hydrate, and the common case costs one identity check.
  const lastSyncedArrayRef = useRef<PianoRollNote[] | null>(null)
  const lastSyncedJsonRef = useRef<string | null>(null)
  const lastSelectionKeyRef = useRef('')
  const viewChangeTimerRef = useRef<number | undefined>(undefined)

  // ---------- controllers (created once) ----------

  // Built once per component instance (a state initializer never re-runs).
  const [controllers] = useState(() => {
    const notifyViewportChange = () => {
      window.clearTimeout(viewChangeTimerRef.current)
      viewChangeTimerRef.current = window.setTimeout(() => {
        propsRef.current.onViewChange?.(getViewHelper(state))
      }, VIEW_CHANGE_DEBOUNCE_MS)
      syncThumbs()
    }

    // Scroll thumbs move every scroll frame: written to the DOM directly.
    const syncThumbs = () => {
      const h = horizontalScrollbar.getThumbStyle()
      const v = verticalScrollbar.getThumbStyle()
      const hEl = hThumbRef.current
      const vEl = vThumbRef.current
      if (hEl) {
        hEl.style.left = h.left
        hEl.style.width = h.width
      }
      if (vEl) {
        vEl.style.top = v.top
        vEl.style.height = v.height
      }
    }

    // Commit-point projection: selection, note count, undo/redo availability.
    // Selected notes are compared by identity of the note objects (the core
    // replaces a note object when it edits it), so an unchanged selection
    // writes nothing and nothing re-renders.
    let lastSelected: NoteData[] = []
    const syncUi = () => {
      const selectedNotes = Array.from(state.selection.selectedIds)
        .map((id) => state.notes.get(id))
        .filter((note): note is NoteData => note !== undefined)
      const sameSelection =
        selectedNotes.length === lastSelected.length && selectedNotes.every((note, index) => note === lastSelected[index])
      if (!sameSelection) {
        lastSelected = selectedNotes
        uiState.selectedNotes = selectedNotes.map(cloneNote)
        uiState.selectionCount = selectedNotes.length
      }
      if (uiState.noteCount !== state.notes.size) uiState.noteCount = state.notes.size
      const canUndo = state.command.stack?.canUndo() ?? false
      const canRedo = state.command.stack?.canRedo() ?? false
      if (uiState.canUndo !== canUndo) uiState.canUndo = canUndo
      if (uiState.canRedo !== canRedo) uiState.canRedo = canRedo

      const selectionKey = Array.from(state.selection.selectedIds).sort().join('\u0000')
      if (selectionKey !== lastSelectionKeyRef.current) {
        lastSelectionKeyRef.current = selectionKey
        propsRef.current.onSelectionChange?.(Array.from(state.selection.selectedIds))
      }
    }

    // Selection and playhead changes outside the command stack report here
    // (the Vue emitStateUpdate path), so onSelectionChange never waits a frame.
    state.notifyExternalChange = () => syncUi()

    const emitNotes = (label: string) => {
      const arr = Array.from(state.notes.values()).map(cloneNote)
      lastSyncedArrayRef.current = arr
      lastSyncedJsonRef.current = null
      propsRef.current.onNotesChange?.(arr, label)
    }

    const setPlayheadMarkers = (markers: PlayheadMarker[]) => {
      // Entries without a finite numeric position are dropped rather than
      // rendered at 0, and a later id wins over an earlier duplicate.
      const next = new Map<string, PlayheadMarker>()
      for (const marker of Array.isArray(markers) ? markers : []) {
        const id = typeof marker?.id === 'string' ? marker.id : ''
        if (!id || !Number.isFinite(marker?.position)) continue
        next.set(id, {
          id,
          position: Math.max(0, marker.position),
          ...(typeof marker.color === 'string' ? { color: marker.color } : {})
        })
      }
      state.playheadMarkers.markers = Array.from(next.values())
      state.dirty.overlay = true
    }

    const enforceScrollBounds = () => {
      updateScrollBounds(state, sizeRef.current.width, sizeRef.current.height, notifyViewportChange)
    }

    const applyHorizontalZoomWithState = (newQuarterNoteWidth: number, newStartQuarter: number) => {
      applyHorizontalZoom(state, newQuarterNoteWidth, newStartQuarter, sizeRef.current.width, sizeRef.current.height, notifyViewportChange)
    }

    const applyVerticalZoomWithState = (newNoteHeight: number, newTopIndex: number) => {
      applyVerticalZoom(state, newNoteHeight, newTopIndex, sizeRef.current.width, sizeRef.current.height, notifyViewportChange)
    }

    const horizontalScrollbar = new HorizontalScrollbarController({
      state,
      getTrack: () => horizontalTrackRef.current,
      isInteractive: () => navigableRef.current,
      getViewportRange: () => getHorizontalViewportRange(state, sizeRef.current.width),
      applyHorizontalZoom: applyHorizontalZoomWithState,
      enforceScrollBounds,
      notifyViewportChange,
      getFallbackWidth: () => sizeRef.current.width
    })

    const verticalScrollbar = new VerticalScrollbarController({
      state,
      getTrack: () => verticalTrackRef.current,
      isInteractive: () => navigableRef.current,
      getViewportRange: () => getVerticalViewportRange(state, sizeRef.current.height),
      applyVerticalZoom: applyVerticalZoomWithState,
      enforceScrollBounds,
      notifyViewportChange,
      getFallbackHeight: () => sizeRef.current.height
    })

    const commandHandlers = createCommandHandlers({
      state,
      onButtonsChange: () => syncUi()
    })

    const keyboard = createKeyboardController({
      state,
      isInteractive: () => interactiveRef.current,
      undo: commandHandlers.undo,
      redo: commandHandlers.redo,
      deleteSelected: commandHandlers.deleteSelected,
      updateCommandStackButtons: commandHandlers.updateCommandStackButtons,
      executeOverlapChanges,
      getContainer: () => wrapperRef.current
    })

    const stageManager = new StageManager({
      state,
      getContainer: () => konvaContainerRef.current,
      initializeLayers: (s, stage) =>
        initializeLayers(s, stage, (change, name) => {
          if (change === 'push') emitNotes(name)
          else if (change === 'undo') emitNotes(`Undo ${name}`)
          else if (change === 'redo') emitNotes(`Redo ${name}`)
          commandHandlers.updateCommandStackButtons()
        }),
      setupEventHandlers,
      renderGrid,
      renderGhostNotes,
      renderVisibleNotes,
      renderResizeHandles,
      updateQueuePlayheadPosition,
      updatePlayheadMarkers,
      afterRedraw: syncUi,
      renderGutter: () => drawGutter(state, gutterRef.current),
      enforceScrollBounds,
      attachKeyboard: () => keyboard.attach(),
      detachKeyboard: () => keyboard.detach()
    })

    const fitToContent = () => {
      fitZoomToNotesHelper(state, sizeRef.current.width, sizeRef.current.height, notifyViewportChange)
    }

    const setView = (view: PianoRollView) => {
      setViewHelper(state, view, sizeRef.current.width, sizeRef.current.height, notifyViewportChange)
    }

    const zoomBy = (factor: number) => {
      zoomHorizontalBy(state, factor, sizeRef.current.width / 2, sizeRef.current.width, sizeRef.current.height, notifyViewportChange)
    }

    const onWheel = (event: WheelEvent) => {
      if (!navigableRef.current || !state.stage) return
      event.preventDefault()
      const rect = state.stage.container().getBoundingClientRect()
      const anchorX = event.clientX - rect.left
      const anchorY = event.clientY - rect.top
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY)
        zoomHorizontalBy(state, factor, anchorX, sizeRef.current.width, sizeRef.current.height, notifyViewportChange)
        return
      }
      if (event.altKey) {
        const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY)
        zoomVerticalBy(state, factor, anchorY, sizeRef.current.width, sizeRef.current.height, notifyViewportChange)
        return
      }
      const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX
      const dy = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY
      state.viewport.scrollX += dx
      state.viewport.scrollY += dy
      enforceScrollBounds()
      state.needsRedraw = true
      notifyViewportChange()
    }

    /** One undoable metadata edit over the given notes; emits through onNotesChange. */
    const applyMetadata = (
      label: string,
      noteIds: string[],
      update: (metadata: JsonObject | undefined, note: PianoRollNote) => JsonObject | undefined
    ) => {
      if (noteIds.length === 0) return
      state.command.stack?.executeCommand(label, () => {
        for (const noteId of noteIds) {
          const target = state.notes.get(noteId)
          if (!target) continue
          const current = target.metadata ? (JSON.parse(JSON.stringify(target.metadata)) as JsonObject) : undefined
          const next = update(current, target)
          const updated: NoteData = { ...target }
          if (next && Object.keys(next).length > 0) updated.metadata = next
          else delete updated.metadata
          state.notes.set(noteId, updated)
        }
        state.needsRedraw = true
      })
      commandHandlers.updateCommandStackButtons()
    }

    /** What the right-click menu does: each is one undo step. */
    const expressionMenuActions: ExpressionMenuActions = {
      setValue: (target, value) => {
        if (target.kind === 'velocity') setNoteVelocity(state, target.noteId, value)
        else setPointValue(state, target.area, target.noteId, target.index, value)
      },
      deletePoint: (target) => deletePoint(state, target.area, target.noteId, target.index),
      toggleRooted: (target) => togglePointRooted(state, target.noteId, target.index)
    }

    /** One undoable velocity edit for the selected notes (the lane bar's field). */
    const setSelectedVelocity = (velocity: number) => {
      const value = Math.max(1, Math.min(127, Math.round(velocity)))
      state.command.stack?.executeCommand('Set Velocity', () => {
        for (const id of state.selection.selectedIds) {
          const note = state.notes.get(id)
          if (note && note.velocity !== value) state.notes.set(id, { ...note, velocity: value })
        }
        state.dirty.notes = true
      })
      commandHandlers.updateCommandStackButtons()
    }

    const applyMetadataPlan = (plan: EditPlan) => {
      const ids = Array.from(state.selection.selectedIds)
      if (ids.length === 0 || plan.ops.length === 0) return
      applyMetadata('Edit Note Metadata', ids, (metadata) => applyPlan(metadata, plan))
    }

    return {
      notifyViewportChange,
      syncUi,
      syncThumbs,
      setPlayheadMarkers,
      enforceScrollBounds,
      horizontalScrollbar,
      verticalScrollbar,
      commandHandlers,
      keyboard,
      stageManager,
      fitToContent,
      setView,
      zoomBy,
      onWheel,
      applyMetadata,
      applyMetadataPlan,
      setSelectedVelocity,
      expressionMenuActions
    }
  })

  // ---------- hydration from the controlled `notes` prop ----------

  useEffect(() => {
    if (notes === lastSyncedArrayRef.current) return
    const json = JSON.stringify(notes)
    if (lastSyncedJsonRef.current === null && lastSyncedArrayRef.current) {
      // Our own emission came back as a different array: compare content once.
      lastSyncedJsonRef.current = JSON.stringify(lastSyncedArrayRef.current)
    }
    if (json === lastSyncedJsonRef.current) {
      lastSyncedArrayRef.current = notes
      return
    }
    lastSyncedArrayRef.current = notes
    lastSyncedJsonRef.current = json
    state.notes = new Map(notes.map((note) => [note.id, cloneNote(note)]))
    for (const id of Array.from(state.selection.selectedIds)) {
      if (!state.notes.has(id)) state.selection.selectedIds.delete(id)
    }
    state.needsRedraw = true
    controllers.enforceScrollBounds()
  }, [notes, state, controllers])

  // ---------- mount / unmount ----------

  useEffect(() => {
    controllers.stageManager.mount({
      width: sizeRef.current.width,
      height: sizeRef.current.height,
      interactive: interactiveRef.current,
      initialNotes: []
    })
    const view = propsRef.current.initialView
    if (view) controllers.setView(view)
    controllers.enforceScrollBounds()
    controllers.syncUi()
    controllers.syncThumbs()

    const container = konvaContainerRef.current
    container?.addEventListener('wheel', controllers.onWheel, { passive: false })
    const gutter = gutterRef.current
    gutter?.addEventListener('wheel', controllers.onWheel, { passive: false })

    return () => {
      container?.removeEventListener('wheel', controllers.onWheel)
      gutter?.removeEventListener('wheel', controllers.onWheel)
      window.clearTimeout(viewChangeTimerRef.current)
      controllers.horizontalScrollbar.stopDrag()
      controllers.verticalScrollbar.stopDrag()
      controllers.stageManager.unmount()
    }
  }, [controllers])

  // Keyboard shield: a native bubble-phase listener on the wrapper so a host
  // canvas (tldraw) never sees the roll's keys. Events from form fields inside
  // the wrapper keep bubbling (React's delegated handlers need them and tldraw
  // ignores keys typed into fields on its own).
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const shield = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      // A read-only roll has no selection: Cmd-A does nothing (not the page's text)
      if (!interactiveRef.current && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') event.preventDefault()
      event.stopPropagation()
    }
    wrapper.addEventListener('keydown', shield)
    wrapper.addEventListener('keyup', shield)
    return () => {
      wrapper.removeEventListener('keydown', shield)
      wrapper.removeEventListener('keyup', shield)
    }
  }, [])

  // ---------- prop syncs ----------

  useEffect(() => {
    state.expression.enabled = lanesEnabled
    state.expression.mode = lanesEnabled ? expressionMode : 'notes'
    state.expression.lanesVisible = lanesVisible
    state.expression.pointSelection = null
    state.expression.activeArea = null
    state.expression.range = null
    controllers.stageManager.resize(width, height + lanesHeight(state))
    state.needsRedraw = true
    controllers.enforceScrollBounds()
  }, [width, height, controllers, lanesEnabled, expressionMode, lanesVisible, state])

  useEffect(() => {
    controllers.stageManager.setInteractive(interactive)
    if (!interactive) {
      controllers.horizontalScrollbar.stopDrag()
      controllers.verticalScrollbar.stopDrag()
    }
  }, [interactive, controllers])

  useEffect(() => {
    state.grid.loopLength = Math.max(0, Number.isFinite(loopLength) ? loopLength : 0)
    state.needsRedraw = true
    controllers.enforceScrollBounds()
    controllers.syncUi()
  }, [loopLength, state, controllers])

  useEffect(() => {
    if (snapToGrid !== undefined) setSnap(snapToGrid)
  }, [snapToGrid])

  useEffect(() => {
    state.grid.pitchLabels = pitchLabels
    state.dirty.notes = true
    state.dirty.gutter = true
  }, [pitchLabels, state])

  // The grid compares the scale by identity, so only a new scale redraws it.
  const scaleKey = `${scale.root}:${scale.degrees.join(',')}`
  useEffect(() => {
    state.grid.scale = scale
    state.needsRedraw = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleKey, state])

  useEffect(() => {
    state.grid.snapToGrid = snap
  }, [snap, state])

  useEffect(() => {
    state.grid.drawMode = drawMode
    if (konvaContainerRef.current) konvaContainerRef.current.style.cursor = drawMode ? 'crosshair' : 'default'
  }, [drawMode, state])

  useEffect(() => {
    state.grid.subdivision = subdivision
    state.needsRedraw = true
  }, [subdivision, state])

  useEffect(() => {
    state.hooks = { onNotePreview, noteBadge, noteColor, onExpressionMenu: setExpressionMenu }
    state.dirty.notes = true
  }, [onNotePreview, noteBadge, noteColor, state])

  useEffect(() => {
    if (playheadMarkers !== undefined) controllers.setPlayheadMarkers(playheadMarkers)
  }, [playheadMarkers, controllers])

  useEffect(() => {
    state.ghostNotes = ghostNotes ?? []
    state.dirty.ghosts = true
  }, [ghostNotes, state])

  useEffect(() => {
    if (!showControlPanel) setShowMetadata(false)
  }, [showControlPanel])

  // ---------- imperative handle ----------

  useImperativeHandle(
    ref,
    () => ({
      setPlayheadMarkers: (markers) => controllers.setPlayheadMarkers(markers),
      fitToContent: () => controllers.fitToContent(),
      zoomBy: (factor) => controllers.zoomBy(factor),
      getView: () => getViewHelper(state),
      setView: (view) => controllers.setView(view),
      getSelectedIds: () => Array.from(state.selection.selectedIds),
      selectNotes: (ids) => {
        mutateSelection(state, () => {
          state.selection.selectedIds = new Set(ids.filter((id) => state.notes.has(id)))
        })
        state.needsRedraw = true
      },
      focus: () => wrapperRef.current?.focus({ preventScroll: true }),
      setLiveInput: (input: LiveInput) => {
        const current = state.liveInput
        // Idle input sends empty overlays every tick: redraw only on change.
        if (current.keys.length === 0 && current.notes.length === 0 && input.keys.length === 0 && input.notes.length === 0) return
        state.liveInput = input
        state.dirty.overlay = true
      },
      commitExternalEdit: (label, before, after) => {
        const stack = state.command.stack
        const snapshotOf = (notes: PianoRollNote[]) =>
          JSON.stringify({ notes: notes.map((note) => [note.id, cloneNote(note)]), selection: [] })
        state.notes = new Map(after.map((note) => [note.id, cloneNote(note)]))
        for (const id of Array.from(state.selection.selectedIds)) {
          if (!state.notes.has(id)) state.selection.selectedIds.delete(id)
        }
        invalidateNoteIndex(state)
        state.needsRedraw = true
        controllers.enforceScrollBounds()
        // pushCommand emits the new notes through onNotesChange.
        if (stack) stack.pushCommand(label, snapshotOf(before), captureState(state))
        else controllers.syncUi()
      }
    }),
    [controllers, state]
  )

  // ---------- DOM handlers ----------

  const focusWrapper = useCallback(() => {
    wrapperRef.current?.focus({ preventScroll: true })
  }, [])

  const onHorizontalTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    controllers.horizontalScrollbar.onTrackPointerDown(event.nativeEvent)
  }

  const onVerticalTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    controllers.verticalScrollbar.onTrackPointerDown(event.nativeEvent)
  }

  const startHorizontalDrag = (mode: HorizontalDragMode) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.preventDefault()
    controllers.horizontalScrollbar.startDrag(mode, event.nativeEvent, event.currentTarget)
  }

  const startVerticalDrag = (mode: VerticalDragMode) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.preventDefault()
    controllers.verticalScrollbar.startDrag(mode, event.nativeEvent, event.currentTarget)
  }

  // Only read when the metadata panel is open, so selection changes do not
  // touch this subscription otherwise.
  const metadataOpen = showControlPanel && showMetadata
  const selectedForPanel = metadataOpen ? (ui.selectedNotes as NoteData[]) : EMPTY_SELECTED
  const metadataDocuments = useMemo(() => {
    if (!interactive || selectedForPanel.length === 0) return null
    return selectedForPanel.map((note) => (note.metadata ? (JSON.parse(JSON.stringify(note.metadata)) as JsonObject) : {}))
  }, [selectedForPanel, interactive])

  // Content width: stage (plus its 1px border each side), gap, vertical scrollbar.
  const shellStyle = {
    '--pr-scrollbar-thickness': `${SCROLLBAR_THICKNESS}px`,
    '--pr-scrollbar-gap': `${LAYOUT_GAP}px`,
    width: GUTTER_WIDTH + LAYOUT_GAP + width + 2 + LAYOUT_GAP + SCROLLBAR_THICKNESS
  } as CSSProperties

  const stageHeight = height + (lanesEnabled ? lanesHeightFor(lanesEnabled ? expressionMode : 'notes', lanesVisible) : 0)
  const selectedVelocity = useMemo(() => {
    const notes = ui.selectedNotes as NoteData[]
    if (notes.length === 0) return null
    const first = notes[0]!.velocity
    return notes.every((note) => note.velocity === first) ? first : null
  }, [ui.selectedNotes])

  // Keyboard column: press a key to hear it (held while pressed, glide across keys).
  const gutterY = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const scale = rect.height > 0 ? event.currentTarget.offsetHeight / rect.height : 1
    return (event.clientY - rect.top) * scale
  }
  const pressKey = (pitch: number | null) => {
    const previous = state.keyboard.pressedPitch
    if (previous === pitch) return
    const handler = propsRef.current.onKeyboardNote
    if (previous !== null) handler?.(previous, false)
    state.keyboard.pressedPitch = pitch
    if (pitch !== null) {
      if (handler) handler(pitch, true)
      else propsRef.current.onNotePreview?.({ pitch, velocity: DEFAULT_VELOCITY })
    }
    state.dirty.gutter = true
  }
  const onGutterPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.stopPropagation()
    focusWrapper()
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pressKey(gutterPitchAt(state, gutterY(event)))
  }
  const onGutterPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const pitch = gutterPitchAt(state, gutterY(event))
    if (state.keyboard.pressedPitch !== null) pressKey(pitch)
    if (state.keyboard.hoverPitch !== pitch) {
      state.keyboard.hoverPitch = pitch
      state.dirty.gutter = true
    }
  }
  const onGutterPointerUp = () => pressKey(null)
  const onGutterPointerLeave = () => {
    if (state.keyboard.pressedPitch !== null) return
    state.keyboard.hoverPitch = null
    state.dirty.gutter = true
  }

  const controlPanel = (
    <ControlPanelSlot
      interactive={interactive}
      ui={ui}
      subdivision={subdivision}
      snap={snap}
      drawMode={drawMode}
      showMetadata={showMetadata}
      onUndo={controllers.commandHandlers.undo}
      onRedo={controllers.commandHandlers.redo}
      onSubdivisionChange={setSubdivision}
      onSnapToggle={() => setSnap((v) => !v)}
      onDrawToggle={() => setDrawMode((v) => !v)}
      onZoomIn={() => controllers.zoomBy(ZOOM_BUTTON_FACTOR)}
      onZoomOut={() => controllers.zoomBy(1 / ZOOM_BUTTON_FACTOR)}
      onFit={controllers.fitToContent}
      onDelete={controllers.commandHandlers.deleteSelected}
      onMetadataToggle={() => setShowMetadata((v) => !v)}
      scale={scale}
      onScaleChange={changeScale}
      expressionMode={lanesEnabled ? expressionMode : null}
      onExpressionModeChange={setExpressionMode}
      showInfo={!lanesEnabled}
    />
  )

  return (
    <div ref={wrapperRef} className="pr-root" tabIndex={0} style={shellStyle}>
      {showControlPanel &&
        (toolbarTarget
          ? createPortal(
              // The tool row sits in the host's header, outside this element:
              // its keys still belong to the roll (Cmd-A, Delete, undo...)
              <div className="pr-toolbar-scope" onKeyDown={(event) => controllers.keyboard.handleKeyDown(event.nativeEvent)}>
                {controlPanel}
              </div>,
              toolbarTarget
            )
          : controlPanel)}
      <div className="pr-layout">
        <canvas
          ref={gutterRef}
          className="pr-gutter"
          style={{ width: GUTTER_WIDTH, height: stageHeight }}
          onPointerDown={onGutterPointerDown}
          onPointerMove={onGutterPointerMove}
          onPointerUp={onGutterPointerUp}
          onPointerCancel={onGutterPointerUp}
          onPointerLeave={onGutterPointerLeave}
        />
        <div className="pr-stage-wrapper">
          <div
            ref={konvaContainerRef}
            className={'pr-container' + (navigable ? '' : ' is-disabled')}
            style={{ width, height: stageHeight }}
            onContextMenu={(event) => {
              // The roll owns right-click: no browser or tldraw menu over it
              event.preventDefault()
              event.stopPropagation()
            }}
            onPointerDown={focusWrapper}
          />
          <div
            ref={horizontalTrackRef}
            className={'pr-scrollbar horizontal' + (navigable ? '' : ' is-disabled')}
            style={{ width }}
            onPointerDown={onHorizontalTrackPointerDown}
          >
            <div ref={hThumbRef} className="pr-scrollbar-thumb horizontal-thumb">
              <div className="pr-scrollbar-handle handle-left" onPointerDown={startHorizontalDrag('resize-start')} />
              <div className="pr-scrollbar-body" onPointerDown={startHorizontalDrag('move')} />
              <div className="pr-scrollbar-handle handle-right" onPointerDown={startHorizontalDrag('resize-end')} />
            </div>
          </div>
        </div>
        <div
          ref={verticalTrackRef}
          className={'pr-scrollbar vertical' + (navigable ? '' : ' is-disabled')}
          style={{ height }}
          onPointerDown={onVerticalTrackPointerDown}
        >
          <div ref={vThumbRef} className="pr-scrollbar-thumb vertical-thumb">
            <div className="pr-scrollbar-handle handle-top" onPointerDown={startVerticalDrag('resize-start')} />
            <div className="pr-scrollbar-body vertical-body" onPointerDown={startVerticalDrag('move')} />
            <div className="pr-scrollbar-handle handle-bottom" onPointerDown={startVerticalDrag('resize-end')} />
          </div>
        </div>
      </div>
      {expressionMenu ? (
        <ExpressionMenu menu={expressionMenu} actions={controllers.expressionMenuActions} onClose={closeExpressionMenu} />
      ) : null}
      {lanesEnabled && (
        <div className="pr-lane-bar" style={{ paddingLeft: GUTTER_WIDTH + LAYOUT_GAP }}>
          {expressionMode === 'notes' ? (
            <>
              <Toggle label="Velocity" className="pr-lane-toggle" on={lanesVisible.velocity} onChange={(on) => setLanesVisible((v) => ({ ...v, velocity: on }))} title="Show the velocity lane" />
              <NumberBox
                className="pr-velocity-value"
                value={selectedVelocity}
                placeholder={ui.selectionCount ? 'mixed' : '—'}
                min={1}
                max={127}
                step={1}
                bar
                width={94}
                disabled={!interactive || ui.selectionCount === 0}
                onChange={() => {}}
                onCommit={controllers.setSelectedVelocity}
                title="Velocity of the selected notes"
              />
              <span className="pr-lane-hint">drag a marker · Alt/Cmd-drag a note · draw mode paints · right-click to edit</span>
            </>
          ) : (
            <>
              <Toggle label="Pressure" className="pr-lane-toggle" on={lanesVisible.pressure} onChange={(on) => setLanesVisible((v) => ({ ...v, pressure: on }))} title="Show the pressure lane" />
              <Toggle label="Timbre" className="pr-lane-toggle" on={lanesVisible.timbre} onChange={(on) => setLanesVisible((v) => ({ ...v, timbre: on }))} title="Show the timbre (CC74) lane" />
              <span className="pr-lane-hint">click the line to add · click a point to delete · drag near a segment to move it · drag a column for a range · right-click to edit · R rooted</span>
            </>
          )}
          <span className="ui-spacer" />
          <NoteCount noteCount={ui.noteCount} selectionCount={ui.selectionCount} />
        </div>
      )}
      {metadataOpen && (
        // Below the stage, so opening it on a selection never shifts the canvas
        // under a pressed pointer.
        <div className="pr-metadata-wrapper">
          {selectedForPanel.length > 0 && renderMetadataPanel
            ? renderMetadataPanel({ selected: selectedForPanel, applyMetadata: controllers.applyMetadata })
            : null}
          {rawMetadataEditor ? <MetadataTree documents={metadataDocuments} onApply={controllers.applyMetadataPlan} /> : null}
        </div>
      )}
    </div>
  )
})

const EMPTY_SELECTED: NoteData[] = []

/** Lane height for a mode and visibility, before the core state exists (layout). */
function lanesHeightFor(mode: 'notes' | 'mpe', visible: Record<ExpressionLane, boolean>): number {
  const lanes: ExpressionLane[] = mode === 'notes' ? ['velocity'] : ['pressure', 'timbre']
  return lanes.filter((lane) => visible[lane]).length * LANE_HEIGHT
}

// Thin adapter so the panel's props stay a flat list of primitives/callbacks.
function ControlPanelSlot(props: {
  interactive: boolean
  ui: Pick<UiState, 'canUndo' | 'canRedo' | 'noteCount' | 'selectionCount'>
  subdivision: number
  snap: boolean
  drawMode: boolean
  showMetadata: boolean
  onUndo: () => void
  onRedo: () => void
  onSubdivisionChange: (value: number) => void
  onSnapToggle: () => void
  onDrawToggle: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onDelete: () => void
  onMetadataToggle: () => void
  scale: PianoRollScale
  onScaleChange: (scale: PianoRollScale) => void
  expressionMode: 'notes' | 'mpe' | null
  onExpressionModeChange: (mode: 'notes' | 'mpe') => void
  showInfo: boolean
}) {
  const { ui, snap, ...rest } = props
  return (
    <ControlPanel
      {...rest}
      snapToGrid={snap}
      canUndo={ui.canUndo}
      canRedo={ui.canRedo}
      noteCount={ui.noteCount}
      selectionCount={ui.selectionCount}
    />
  )
}
