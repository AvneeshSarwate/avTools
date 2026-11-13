// Two independent PianoRoll instances side by side, with every hook logged and
// mirrored onto window.__pianoRollDemo for the Playwright check (e2e.mjs).
import { useCallback, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { PianoRoll } from '../src/pianoRoll/PianoRoll'
import type {
  GhostNote,
  MetadataPanelProps,
  PianoRollHandle,
  PianoRollNote,
  PianoRollView,
  PlayheadMarker
} from '../src/pianoRoll/types'

interface RollDebug {
  notes: PianoRollNote[]
  lastLabel: string | null
  changeCount: number
  selection: string[]
  previews: Array<{ pitch: number; velocity: number }>
  views: PianoRollView[]
  getView: () => PianoRollView | undefined
  fit: () => void
  focus: () => void
  /** Replace the notes from outside, as a host would after a foreign change. */
  hydrate: (notes: PianoRollNote[]) => void
  getSelectedIds: () => string[]
}

declare global {
  interface Window {
    __pianoRollDemo: Record<string, RollDebug>
  }
}

window.__pianoRollDemo = {}

const seedNotes = (prefix: string): PianoRollNote[] => {
  const scale = [60, 62, 64, 65, 67, 69, 71, 72]
  const out: PianoRollNote[] = []
  for (let i = 0; i < 12; i++) {
    out.push({
      id: `${prefix}_n${i}`,
      pitch: scale[i % scale.length]! + (i >= 8 ? 12 : 0),
      position: i * 0.5,
      duration: i % 3 === 2 ? 1 : 0.5,
      velocity: 80 + (i % 4) * 10,
      ...(i % 4 === 0 ? { metadata: { tag: i === 0 ? 'lead' : 'acc', color: i === 4 ? '#3a86ff' : undefined } } : {})
    })
  }
  // Drop the undefined color key so the metadata stays plain JSON.
  for (const note of out) {
    if (note.metadata && note.metadata.color === undefined) delete note.metadata.color
  }
  return out
}

const ghosts = (prefix: string): GhostNote[] => [
  { id: `${prefix}_g1`, pitch: 74, position: 1, duration: 1, label: 'alt', linkTo: `${prefix}_n2` },
  { id: `${prefix}_g2`, pitch: 65, position: 4.5, duration: 0.5, color: '#ffb703', opacity: 0.5, label: 'played' }
]

const markers: PlayheadMarker[] = [
  { id: 'runner-a', position: 2.5 },
  { id: 'runner-b', position: 5, color: '#ff6b6b' }
]

function DemoRoll({ name, width, height, loopLength }: { name: string; width: number; height: number; loopLength: number }) {
  const [notes, setNotes] = useState<PianoRollNote[]>(() => seedNotes(name))
  const [log, setLog] = useState<string[]>([])
  const handleRef = useRef<PianoRollHandle>(null)
  const debug = useMemo<RollDebug>(() => {
    const entry: RollDebug = {
      notes: [],
      lastLabel: null,
      changeCount: 0,
      selection: [],
      previews: [],
      views: [],
      getView: () => handleRef.current?.getView(),
      fit: () => handleRef.current?.fitToContent(),
      focus: () => handleRef.current?.focus(),
      hydrate: (next) => setNotes(next),
      getSelectedIds: () => handleRef.current?.getSelectedIds() ?? []
    }
    window.__pianoRollDemo[name] = entry
    return entry
  }, [name])
  debug.notes = notes

  const pushLog = useCallback((line: string) => {
    setLog((prev) => [line, ...prev].slice(0, 8))
  }, [])

  const onNotesChange = useCallback(
    (next: PianoRollNote[], label: string) => {
      console.log(`[${name}] onNotesChange`, label, next)
      debug.lastLabel = label
      debug.changeCount += 1
      debug.notes = next
      setNotes(next)
      pushLog(`${label}: ${next.length} notes`)
    },
    [name, debug, pushLog]
  )

  const onSelectionChange = useCallback(
    (ids: string[]) => {
      console.log(`[${name}] onSelectionChange`, ids)
      debug.selection = ids
      pushLog(`selection: ${ids.length}`)
    },
    [name, debug, pushLog]
  )

  const onNotePreview = useCallback(
    (note: { pitch: number; velocity: number }) => {
      console.log(`[${name}] onNotePreview`, note)
      debug.previews.push(note)
      pushLog(`preview: pitch ${note.pitch} vel ${note.velocity}`)
    },
    [name, debug, pushLog]
  )

  const onViewChange = useCallback(
    (view: PianoRollView) => {
      console.log(`[${name}] onViewChange`, view)
      debug.views.push(view)
    },
    [name, debug]
  )

  const noteBadge = useCallback((note: PianoRollNote) => {
    const tag = note.metadata?.tag
    return typeof tag === 'string' ? tag : null
  }, [])

  const ghostNotes = useMemo(() => ghosts(name), [name])

  const renderMetadataPanel = useCallback(
    ({ selected, applyMetadata }: MetadataPanelProps) => (
      <div className="demo-meta-host">
        <span>host slot: {selected.length} selected</span>
        <button
          type="button"
          className="demo-tag-button"
          onClick={() =>
            applyMetadata('Tag Notes', selected.map((n) => n.id), (metadata) => ({ ...(metadata ?? {}), tag: 'host' }))
          }
        >
          tag = host
        </button>
        <button
          type="button"
          className="demo-color-button"
          onClick={() =>
            applyMetadata('Color Notes', selected.map((n) => n.id), (metadata) => ({ ...(metadata ?? {}), color: '#8ac926' }))
          }
        >
          color = green
        </button>
      </div>
    ),
    []
  )

  return (
    <div className="demo-roll" data-roll={name}>
      <h3>roll {name}</h3>
      <PianoRoll
        ref={handleRef}
        notes={notes}
        onNotesChange={onNotesChange}
        loopLength={loopLength}
        width={width}
        height={height}
        ghostNotes={ghostNotes}
        playheadMarkers={markers}
        noteBadge={noteBadge}
        onSelectionChange={onSelectionChange}
        onNotePreview={onNotePreview}
        onViewChange={onViewChange}
        renderMetadataPanel={renderMetadataPanel}
      />
      <pre className="demo-log">{log.join('\n')}</pre>
    </div>
  )
}

function Demo() {
  return (
    <div>
      <style>{`
        .demo-rolls { display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap; }
        .demo-roll h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #9ca8a2; }
        .demo-log { margin: 8px 0 0; padding: 6px; min-height: 60px; font-size: 10px; color: #9ca8a2; background: #111412; border-radius: 4px; }
        .demo-meta-host { display: flex; gap: 8px; align-items: center; padding: 4px 6px; border: 1px dashed rgba(255,255,255,0.25); border-radius: 3px; font-size: 11px; }
        .demo-meta-host button { font-size: 11px; padding: 2px 6px; }
      `}</style>
      <div className="demo-rolls">
        <DemoRoll name="a" width={640} height={360} loopLength={8} />
        <DemoRoll name="b" width={480} height={280} loopLength={8} />
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Demo />)
