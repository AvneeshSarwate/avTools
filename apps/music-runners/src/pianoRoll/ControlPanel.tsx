// The roll's tool row: edit history, grid, zoom, delete, the metadata panel,
// and the note count. One compact row of icon controls (names in tooltips);
// a host can render it into its own header through `toolbarTarget`.
import { useEffect, useState } from 'react'
import { Button, Chooser, TextField, Toggle } from '../ui/controls/controls'
import { formatDegrees, parseDegrees, ROOT_NAMES, withRootPitchClass } from './scale'
import type { PianoRollScale } from './types'

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
  scale: PianoRollScale
  onScaleChange: (scale: PianoRollScale) => void
}

const ROOT_OPTIONS = ROOT_NAMES.map((name, pitchClass) => ({ value: String(pitchClass), label: name }))
const INVALID_FLASH_MS = 900

/** Root chooser plus the degree list, e.g. "0 2 4 5 7 9 11 12". */
function ScaleControls({ scale, onChange }: { scale: PianoRollScale; onChange: (scale: PianoRollScale) => void }) {
  const text = formatDegrees(scale.degrees)
  const [draft, setDraft] = useState(text)
  const [invalid, setInvalid] = useState(false)
  useEffect(() => setDraft(text), [text])
  useEffect(() => {
    if (!invalid) return
    const timer = window.setTimeout(() => setInvalid(false), INVALID_FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [invalid])
  const commit = () => {
    if (draft === text) return
    const degrees = parseDegrees(draft)
    if (!degrees) {
      setInvalid(true)
      setDraft(text)
      return
    }
    setDraft(formatDegrees(degrees))
    onChange({ ...scale, degrees })
  }
  return (
    <div className="ui-group pr-scale">
      <Chooser
        className="pr-scale-root"
        title="Scale root: root rows are lighter, out-of-scale rows darker"
        value={String(((scale.root % 12) + 12) % 12)}
        options={ROOT_OPTIONS}
        width={66}
        onChange={(value) => onChange(withRootPitchClass(scale, Number(value)))}
      />
      <TextField
        className={'pr-scale-degrees' + (invalid ? ' is-invalid' : '')}
        title="Scale degrees: semitones above the root from 0, octave last (ionian: 0 2 4 5 7 9 11 12). Enter to apply."
        value={draft}
        width={118}
        onChange={setDraft}
        onCommit={commit}
        onCancel={() => setDraft(text)}
      />
    </div>
  )
}

const GRID_OPTIONS = [
  { value: '4', label: '1/4' },
  { value: '8', label: '1/8' },
  { value: '16', label: '1/16' },
  { value: '32', label: '1/32' }
]

export function ControlPanel(props: ControlPanelProps) {
  const { interactive } = props
  return (
    <div className="pr-control-panel">
      <span className="pr-info" title="notes in the roll, selected">
        {props.noteCount} notes{props.selectionCount ? `, ${props.selectionCount} selected` : ''}
      </span>
      <div className="ui-group">
        <Button icon="undo" quiet className="pr-undo" title="Undo (Cmd/Ctrl+Z)" onClick={props.onUndo} disabled={!interactive || !props.canUndo} />
        <Button icon="redo" quiet className="pr-redo" title="Redo (Shift+Cmd/Ctrl+Z)" onClick={props.onRedo} disabled={!interactive || !props.canRedo} />
      </div>
      <ScaleControls scale={props.scale} onChange={props.onScaleChange} />
      <div className="ui-group">
        <Chooser
          className="pr-grid"
          title="Grid: snap and draw resolution"
          value={String(props.subdivision)}
          options={GRID_OPTIONS}
          disabled={!interactive}
          width={64}
          onChange={(value) => props.onSubdivisionChange(Number(value))}
        />
        <Toggle
          icon="magnet"
          className="pr-snap-toggle"
          on={props.snapToGrid}
          disabled={!interactive}
          onChange={props.onSnapToggle}
          title="Snap moves, resizes and new notes to the grid"
        />
        <Toggle
          icon="pencil"
          className="pr-draw-toggle"
          on={props.drawMode}
          disabled={!interactive}
          onChange={props.onDrawToggle}
          title="Draw: click-drag on the background creates a note (off: marquee select, double-click adds)"
        />
      </div>
      <div className="ui-group">
        <Button icon="zoomOut" quiet className="pr-zoom-out" onClick={props.onZoomOut} disabled={!interactive} title="Zoom out (time)" />
        <Button icon="zoomIn" quiet className="pr-zoom-in" onClick={props.onZoomIn} disabled={!interactive} title="Zoom in (time)" />
        <Button icon="fit" quiet className="pr-fit" onClick={props.onFit} disabled={!interactive} title="Fit the view to the notes" />
      </div>
      <div className="ui-group">
        <Button
          icon="trash"
          quiet
          className="pr-delete"
          onClick={props.onDelete}
          disabled={!interactive || props.selectionCount === 0}
          title="Delete the selected notes (Delete)"
        />
        <Toggle
          icon="tag"
          label="Tags"
          className="pr-metadata-toggle"
          on={props.showMetadata}
          onChange={props.onMetadataToggle}
          title="Metadata: tag and edit the selected notes"
        />
      </div>
    </div>
  )
}
