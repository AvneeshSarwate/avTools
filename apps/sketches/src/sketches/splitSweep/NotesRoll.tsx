// The notes roll: the selected region's notes in orange and editable, every
// other region's notes as faded ghosts, and a line from each region's A to
// its B: a diagonal from just inside the end of A to just inside the start of B.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { PianoRoll } from "../../shared/pianoRoll/PianoRoll";
import type { GhostNote, PianoRollHandle, PianoRollNote, RollLink } from "../../shared/pianoRoll/types";
import { engine } from "./engine";
import type { Region } from "./model";
import { doc, history, select, setRegionNotes, ui } from "./store";

const ORANGE = "#ff9a1f";
const ORANGE_DIM = "#9a6324";
/**
 * Other regions. The roll already spends: dark greys (background, rows,
 * grid), a white tint (root rows), red (notes), blue (selection, marquee,
 * cursor), and here orange (the selected region). Violet is the free hue.
 */
const GHOST = "#b48cff";
const GHOST_HOVER = "#d9c4ff";
const LINK_INSET = 0.25;
/** Piano roll chrome around the stage: gutter, gaps, border, scrollbar. */
const CHROME_W = 78;
const CHROME_H = 30;

/** The A and B notes: the first two in time (ties: lower first). */
function abNotes(notes: readonly PianoRollNote[]) {
  const sorted = [...notes].sort((p, q) => p.position - q.position || p.pitch - q.pitch);
  return { a: sorted[0], b: sorted[1] };
}

const ghostId = (region: Region, note: PianoRollNote) => `${region.id}:${note.id}`;

export function NotesRoll({ region, full }: { region: Region; full: boolean }) {
  const snap = useSnapshot(doc);
  const regions = snap.regions as Region[];
  const id = region.id;
  const frame = useRef<HTMLDivElement>(null);
  const roll = useRef<PianoRollHandle>(null);
  const [box, setBox] = useState({ width: 400, height: 260 });

  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox({ width: Math.floor(width), height: Math.floor(height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Only the notes matter here: colour or slide edits must not rebuild the
  // ghosts and links (that would redraw the roll on every picker tick).
  const notesKey = JSON.stringify(regions.map((r) => [r.id, r.notes]));
  // The region hovered here or in the palette: its ghosts and line light up.
  const hoverId = useSnapshot(ui).hoverId;
  const { ghosts, links, selectedAB } = useMemo(() => {
    const ghosts: GhostNote[] = [];
    const links: RollLink[] = [];
    for (const other of regions) {
      const { a, b } = abNotes(other.notes);
      const selected = other.id === id;
      const hovered = other.id === hoverId;
      if (!selected) {
        for (const note of other.notes) {
          ghosts.push({ id: ghostId(other, note), pitch: note.pitch, position: note.position, duration: note.duration, color: hovered ? GHOST_HOVER : GHOST, opacity: hovered ? 1 : 0.6 });
        }
      }
      if (!a || !b) continue;
      links.push(selected
        ? { id: `link:${other.id}`, from: a.id, to: b.id, color: ORANGE, opacity: 0.95, lineWidth: 2, inset: LINK_INSET }
        : { id: `link:${other.id}`, from: ghostId(other, a), to: ghostId(other, b), color: hovered ? GHOST_HOVER : GHOST, opacity: hovered ? 1 : 0.8, lineWidth: hovered ? 2.5 : 1.5, inset: LINK_INSET });
    }
    const { a, b } = abNotes(regions.find((r) => r.id === id)?.notes ?? []);
    return { ghosts, links, selectedAB: new Set([a?.id, b?.id]) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesKey, id, hoverId]);

  const onNotesChange = useCallback((notes: PianoRollNote[], label: string) => setRegionNotes(id, notes, label), [id]);
  const onKeyboardNote = useCallback((pitch: number, on: boolean) => {
    engine.start();
    engine.previewKey(on ? pitch : null);
  }, []);
  const onNotePreview = useCallback((note: { pitch: number }) => {
    engine.start();
    engine.audition(note.pitch);
  }, []);
  const onHistoryKey = useCallback((action: "undo" | "redo") => (action === "undo" ? history.undo() : history.redo()), []);
  // Selected notes keep the roll's blue selection fill.
  const noteColor = useCallback(
    (note: PianoRollNote, selected: boolean) => (selected ? undefined : selectedAB.has(note.id) ? ORANGE : ORANGE_DIM),
    [selectedAB],
  );
  useEffect(() => () => engine.previewKey(null), []);
  // Other regions' notes: hover outlines the region (grid, palette), a press selects it.
  // Ghost ids are "<regionId>:<noteId>"; region ids never contain ":".
  const onGhostHover = useCallback((ghost: string | null) => {
    ui.hoverId = ghost ? ghost.slice(0, ghost.indexOf(":")) : null;
  }, []);
  const onGhostClick = useCallback((ghost: string) => {
    ui.hoverId = null;
    select(ghost.slice(0, ghost.indexOf(":")));
  }, []);

  // One roll for every region: switching swaps its notes (the roll re-hydrates
  // from the prop) and frames them in the same commit, so there is no remount
  // and no frame of the old view. The roll's effects run before this one.
  useEffect(() => {
    roll.current?.selectNotes([]);
    roll.current?.fitToContent();
  }, [id]);
  useEffect(() => {
    roll.current?.fitToContent();
  }, [full, box.width, box.height]);

  const width = Math.max(120, box.width - CHROME_W);
  const height = full ? Math.max(120, box.height - CHROME_H) : 220;
  return (
    <div className={`roll-frame${full ? " is-full" : ""}`} ref={frame} onPointerDown={() => engine.start()}>
      <PianoRoll
        ref={roll}
        notes={region.notes as PianoRollNote[]}
        onNotesChange={onNotesChange}
        ghostNotes={ghosts}
        links={links}
        loopLength={4}
        width={width}
        height={height}
        interactive
        showControlPanel={false}
        expressionLanes={false}
        rawMetadataEditor={false}
        noteColor={noteColor}
        onKeyboardNote={onKeyboardNote}
        onNotePreview={onNotePreview}
        onHistoryKey={onHistoryKey}
        onGhostHover={onGhostHover}
        onGhostClick={onGhostClick}
      />
    </div>
  );
}
