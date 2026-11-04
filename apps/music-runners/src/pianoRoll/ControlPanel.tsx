// The control row above the stage: port of the Vue control panel without the
// MPE and lane toggles, plus snap, draw, zoom and fit controls.
export interface ControlPanelProps {
  interactive: boolean
  canUndo: boolean
  canRedo: boolean
  subdivision: number
  snapToGrid: boolean
  drawMode: boolean
  showMetadata: boolean
  noteCount: number
  selectionCount: number
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
}

export function ControlPanel(props: ControlPanelProps) {
  const { interactive } = props
  return (
    <div className="pr-control-panel">
      <button type="button" onClick={props.onUndo} disabled={!interactive || !props.canUndo} title="Undo (Cmd/Ctrl+Z)">
        {'↶'} Undo
      </button>
      <button type="button" onClick={props.onRedo} disabled={!interactive || !props.canRedo} title="Redo (Shift+Cmd/Ctrl+Z)">
        {'↷'} Redo
      </button>
      <span className="pr-separator">|</span>
      <label>
        Grid:
        <select
          value={props.subdivision}
          disabled={!interactive}
          onChange={(event) => props.onSubdivisionChange(Number(event.target.value))}
        >
          <option value={4}>Quarter</option>
          <option value={8}>Eighth</option>
          <option value={16}>16th</option>
          <option value={32}>32nd</option>
        </select>
      </label>
      <button
        type="button"
        className={'pr-toggle pr-snap-toggle' + (props.snapToGrid ? ' active' : '')}
        disabled={!interactive}
        onClick={props.onSnapToggle}
        title="Snap moves, resizes and new notes to the grid"
      >
        Snap
      </button>
      <button
        type="button"
        className={'pr-toggle pr-draw-toggle' + (props.drawMode ? ' active' : '')}
        disabled={!interactive}
        onClick={props.onDrawToggle}
        title="Draw: click-drag on the background creates a note (off: marquee select, double-click adds)"
      >
        {'✏️'} Draw
      </button>
      <span className="pr-separator">|</span>
      <button type="button" className="pr-zoom-out" onClick={props.onZoomOut} disabled={!interactive} title="Zoom out (time)">
        {'−'}
      </button>
      <button type="button" className="pr-zoom-in" onClick={props.onZoomIn} disabled={!interactive} title="Zoom in (time)">
        +
      </button>
      <button type="button" className="pr-fit" onClick={props.onFit} disabled={!interactive} title="Fit the view to the notes">
        Fit
      </button>
      <span className="pr-separator">|</span>
      <button type="button" className="pr-delete" onClick={props.onDelete} disabled={!interactive || props.selectionCount === 0}>
        {'🗑️'} Delete
      </button>
      <span className="pr-separator">|</span>
      <button
        type="button"
        className={'pr-toggle pr-metadata-toggle' + (props.showMetadata ? ' active' : '')}
        onClick={props.onMetadataToggle}
      >
        {'📝'} Metadata
      </button>
      <span className="pr-separator">|</span>
      <span className="pr-info">
        {props.noteCount} notes, {props.selectionCount} selected
      </span>
    </div>
  )
}
