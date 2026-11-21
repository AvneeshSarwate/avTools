import { useEffect, useMemo, useRef, useState } from "react";
import { PianoRoll } from "../../../music-runners/src/pianoRoll/PianoRoll";
import type { PianoRollHandle, PianoRollNote } from "../../../music-runners/src/pianoRoll/types";
import { resume, type Instrument } from "../audio/engine";
import { Transport } from "../audio/transport";
import type { Clip } from "../lessons/types";

const NOTE_COLOR = () => "#cfc8b4";

const toNotes = (clip: Clip): PianoRollNote[] =>
  clip.notes.map(([pitch, position, duration, velocity = 100], i) => ({
    id: `n${i}`,
    pitch,
    position,
    duration,
    velocity,
  }));

/**
 * The lesson's clip in the music-runners piano roll, with a loop transport.
 * The keyboard column plays the instrument directly; notes can be edited.
 */
export function Roll({
  clip,
  instrument,
  onNote,
}: {
  clip: Clip;
  instrument: () => Instrument | undefined;
  onNote: (key: number) => void;
}) {
  const [notes, setNotes] = useState(() => toNotes(clip));
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpm] = useState(clip.bpm ?? 100);
  const [width, setWidth] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const handle = useRef<PianoRollHandle>(null);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const onNoteRef = useRef(onNote);
  onNoteRef.current = onNote;
  const instrumentRef = useRef(instrument);
  instrumentRef.current = instrument;

  const transport = useMemo(
    () =>
      new Transport(
        () => notesRef.current,
        () => clip.loop,
        () => instrumentRef.current(),
        (key) => onNoteRef.current(key),
      ),
    [clip],
  );
  transport.bpm = bpm;

  useEffect(() => {
    setNotes(toNotes(clip));
    setBpm(clip.bpm ?? 100);
    return () => {
      transport.stop();
      setPlaying(false);
    };
  }, [clip, transport]);

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (width) requestAnimationFrame(() => handle.current?.fitToContent());
  }, [width, clip]);

  useEffect(() => {
    if (!playing) {
      handle.current?.setPlayheadMarkers([]);
      return;
    }
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      handle.current?.setPlayheadMarkers([{ id: "play", position: transport.beat(), color: "#e2703a" }]);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [playing, transport]);

  const toggle = () => {
    resume();
    if (playing) transport.stop();
    else transport.start();
    setPlaying(!playing);
  };

  return (
    <div className="roll">
      <div className="roll-bar">
        <button className={playing ? "play on" : "play"} onClick={toggle}>
          {playing ? "Stop" : "Play loop"}
        </button>
        <label className="bpm">
          <input
            type="number"
            min={30}
            max={240}
            value={bpm}
            onChange={(e) => setBpm(Math.max(30, Math.min(240, Number(e.target.value) || 100)))}
          />
          bpm
        </label>
        <span className="hint">
          Click the keys to play. Double-click the grid to add a note, drag to move, Delete to remove. Drag a marker in
          the velocity lane to change how hard that note is struck.
        </span>
      </div>
      <div className="roll-frame" ref={frameRef}>
        {width > 0 && (
          <PianoRoll
            ref={handle}
            notes={notes}
            onNotesChange={setNotes}
            loopLength={clip.loop}
            width={Math.max(200, width - 78)}
            height={236}
            interactive
            showControlPanel={false}
            expressionLanes
            rawMetadataEditor={false}
            noteColor={NOTE_COLOR}
            onKeyboardNote={(pitch, on) => {
              resume();
              const target = instrumentRef.current();
              if (on) {
                target?.noteOn(pitch, 0.8);
                onNoteRef.current(pitch);
              } else target?.noteOff(pitch);
            }}
            onNotePreview={({ pitch, velocity }) => {
              if (transport.playing) return;
              resume();
              const target = instrumentRef.current();
              target?.noteOn(pitch, velocity / 127);
              onNoteRef.current(pitch);
              window.setTimeout(() => target?.noteOff(pitch), 350);
            }}
          />
        )}
      </div>
    </div>
  );
}
