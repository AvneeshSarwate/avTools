// A runner instance's view: chrome (name, MIDI output, loop length, params,
// transports, queue) plus three collapsible rolls. Components only, so it
// Fast Refreshes; the shape util is in RunnerShape.tsx.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { atom, HTMLContainer, type TLBaseBoxShape, useEditor, useValue } from "tldraw";
import { PianoRoll } from "../../pianoRoll/PianoRoll";
import { isSixSinesOutput, sixSinesOutputOptions } from "../../store/sixSines";
import type { GhostNote, MetadataPanelProps, PianoRollHandle, PianoRollNote, PianoRollScale, PianoRollView } from "../../pianoRoll/types";
import { clipsStore, setClipLoopLength, setClipNotes, setClipScale } from "../../store/clips";
import { displayStore } from "../../store/display";
import { GUTTER_WIDTH } from "../../pianoRoll/gutter";
import { LAYOUT_GAP, SCROLLBAR_THICKNESS } from "../../pianoRoll/constants";
import { eventLogStore } from "../../store/events";
import type { Clip } from "../../model/types";
import { defaultOutputName, ensureMidi, getOutput, midiStore, refreshPorts } from "../../store/midi";
import {
  closeInput,
  freeTakePlayhead,
  liveInputFor,
  recordingStore,
  type RecordingUi,
  setInstanceInput,
  startRecording,
  stopRecording,
} from "../../store/recording";
import { useSnapshot } from "valtio";
import {
  auditionNote,
  keyboardKeyDown,
  keyboardKeyUp,
  getRuntime,
  type InstanceRuntime,
  playbackStore,
  markersFor,
  playheadBeats,
  startPlay,
  startRun,
  stopInstance,
} from "../../store/playback";
import { sourceRollHandles } from "../../store/rollHandles";
import { defaultParams, numberParam, type ParamValue, type Params, type RunnerDefinition, scaleParam, tagValue, textParam } from "../runnerTypes";
import { ScaleControls } from "../../pianoRoll/ControlPanel";
import { CURSOR_META_KEY, cursorFromMeta, type RunnerInstanceProps, type RunnerShape } from "./instanceProps";
import { GeneratedSection, PreviewSection } from "./OutputRollSections";
import { RollSection } from "./RollSection";
import { TagEditor } from "./TagEditor";
import { toggleTag } from "./toggleTag";
import { Button, Chooser, Field, Lamp, NumberBox, TextField, Toggle } from "../../ui/controls/controls";
import { Icon } from "../../ui/controls/icons";

/** Shape border (1px each side) around the content. */
const SHAPE_BORDER = 2;
/** Section body padding (10.5px each side, styles.css), keyboard column and its gap, roll border, scrollbar gap and vertical scrollbar. */
const ROLL_CHROME_WIDTH = 10.5 * 2 + GUTTER_WIDTH + LAYOUT_GAP + 2 + LAYOUT_GAP + SCROLLBAR_THICKNESS;
/** Playhead colours: the play / run / rec tokens in styles.css. */
const PLAYHEAD_COLORS = { play: "#62d26f", run: "#ffab3d", rec: "#ff4f4f" } as const;
/** Default grid heights per section; each is resizable from the section's bottom edge. */
const DEFAULT_ROLL_HEIGHTS = { source: 240, generated: 180, preview: 180 } as const;
type RollSectionName = keyof typeof DEFAULT_ROLL_HEIGHTS;
const MIN_ROLL_HEIGHT = 80;
const MAX_ROLL_HEIGHT = 1200;
/** Shape meta key for the resized heights (layout, like the saved view). */
const HEIGHTS_META_KEY = "rollHeights";

function heightsFromMeta(meta: unknown): Partial<Record<RollSectionName, number>> {
  const raw = (meta as Record<string, unknown> | undefined)?.[HEIGHTS_META_KEY] as Record<string, unknown> | undefined;
  const out: Partial<Record<RollSectionName, number>> = {};
  for (const key of Object.keys(DEFAULT_ROLL_HEIGHTS) as RollSectionName[]) {
    const value = raw?.[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}
const PLAYHEAD_INTERVAL_MS = 33;
const VIEW_META_KEY = "sourceView";


function viewFromMeta(meta: unknown): PianoRollView | null {
  const view = (meta as Record<string, unknown> | undefined)?.[VIEW_META_KEY] as Record<string, unknown> | undefined;
  if (!view) return null;
  const values = [view.quarterNoteWidth, view.noteHeight, view.startBeat, view.topRow];
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  return view as unknown as PianoRollView;
}

/** Let the roll lay out at its real size before framing anything. */
function afterLayout(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

/**
 * Drives the playhead line on the source and generated rolls (plus any
 * lines the runner draws on the source roll, api.setMarkers), and the live
 * input overlay (held keys, notes being recorded) on the source roll,
 * through their imperative handles, never through React state: nothing in
 * the shape re-renders per tick. A free take has no loop, so its playhead
 * comes from the recorder.
 */
function usePlayhead(
  shapeId: string,
  active: boolean,
  color: string,
  sourcePlayhead: boolean,
  sourceRoll: React.RefObject<PianoRollHandle | null>,
  generatedRoll: React.RefObject<PianoRollHandle | null>,
): void {
  useEffect(() => {
    const clear = () => {
      sourceRoll.current?.setPlayheadMarkers([]);
      generatedRoll.current?.setPlayheadMarkers([]);
      sourceRoll.current?.setLiveInput({ keys: [], notes: [] });
    };
    if (!active) {
      clear();
      return;
    }
    const tick = () => {
      const free = freeTakePlayhead(shapeId);
      const position = free ?? playheadBeats(getRuntime(shapeId));
      const playhead = position === null ? [] : [{ id: "▶", position, color }];
      sourceRoll.current?.setPlayheadMarkers([...(sourcePlayhead || free !== null ? playhead : []), ...markersFor(shapeId)]);
      generatedRoll.current?.setPlayheadMarkers(playhead);
      sourceRoll.current?.setLiveInput(liveInputFor(shapeId));
    };
    tick();
    const id = window.setInterval(tick, PLAYHEAD_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      clear();
    };
    // The refs are stable objects; only the active flag matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, color, sourcePlayhead, shapeId]);
}

export function RunnerInstanceView({ shape, def }: { shape: RunnerShape; def: RunnerDefinition }) {
  const editor = useEditor();
  const shapeId = shape.id;
  const props = shape.props;
  const clip = useSnapshot(clipsStore).clips[shapeId] as Clip;
  const runtime = (useSnapshot(playbackStore).instances[shapeId] ?? EMPTY_RUNTIME) as InstanceRuntime;
  const midi = useSnapshot(midiStore);
  const synthOptions = useValue(sixSinesOutputOptions(editor));
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sourceRollRef = useRef<PianoRollHandle | null>(null);
  const generatedRollRef = useRef<PianoRollHandle | null>(null);
  const recording = (useSnapshot(recordingStore).byShape[shapeId] ?? EMPTY_RECORDING) as RecordingUi;
  const pitchLabels = useSnapshot(displayStore).pitchLabels;

  // Roll heights: saved in the shape's meta; a drag previews locally and
  // writes the meta once, on release (like the saved view, outside undo).
  const [draftHeights, setDraftHeights] = useState<Partial<Record<RollSectionName, number>>>({});
  const savedHeights = heightsFromMeta(shape.meta);
  const rollHeight = (section: RollSectionName) => draftHeights[section] ?? savedHeights[section] ?? DEFAULT_ROLL_HEIGHTS[section];
  const startRollResize = (section: RollSectionName) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = rollHeight(section);
    const zoom = editor.getZoomLevel() || 1;
    let latest = startHeight;
    const onMove = (move: PointerEvent) => {
      latest = Math.round(Math.max(MIN_ROLL_HEIGHT, Math.min(MAX_ROLL_HEIGHT, startHeight + (move.clientY - startY) / zoom)));
      setDraftHeights((prev) => ({ ...prev, [section]: latest }));
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      const current = editor.getShape(shapeId);
      if (current && latest !== startHeight) {
        const heights = { ...heightsFromMeta(current.meta), [section]: latest };
        editor.run(() => editor.updateShape({ id: shapeId, type: current.type, meta: { ...current.meta, [HEIGHTS_META_KEY]: heights } }), { history: "ignore" });
      }
      setDraftHeights((prev) => {
        const next = { ...prev };
        delete next[section];
        return next;
      });
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };
  const playheadColor = recording.recording === "free" ? PLAYHEAD_COLORS.rec : runtime.mode === "run" ? PLAYHEAD_COLORS.run : PLAYHEAD_COLORS.play;
  const animateRolls = (runtime.mode !== "idle" && (props.showSource || props.showGenerated)) || (props.showSource && recording.listening !== null);
  usePlayhead(shapeId, animateRolls, playheadColor, def.sourcePlayhead !== false, sourceRollRef, generatedRollRef);
  const selectedIdsRef = useRef<string[]>([]);
  // The three rolls share one view so they read as a score: the source roll
  // owns it, the read-only rolls follow, and it is saved in the shape's meta.
  const [sourceView] = useState(() => atom<PianoRollView | null>("source roll view", viewFromMeta(shape.meta)));
  const saveViewTimerRef = useRef<number | undefined>(undefined);
  // The source roll renders its tool row into the Source section header.
  const [sourceToolbar, setSourceToolbar] = useState<HTMLElement | null>(null);

  const updateProps = useCallback(
    (patch: Partial<RunnerInstanceProps>, ignoreHistory = false) => {
      editor.run(
        () => {
          editor.updateShape({ id: shapeId, type: shape.type, props: patch as Partial<TLBaseBoxShape["props"]> });
        },
        ignoreHistory ? { history: "ignore" } : undefined,
      );
    },
    [editor, shape.type, shapeId],
  );

  const onSourceViewChange = useCallback(
    (view: PianoRollView) => {
      sourceView.set(view);
      window.clearTimeout(saveViewTimerRef.current);
      saveViewTimerRef.current = window.setTimeout(() => {
        const current = editor.getShape(shapeId);
        if (!current) return;
        const rounded = Object.fromEntries(Object.entries(view).map(([key, value]) => [key, Math.round(value * 1000) / 1000]));
        if (JSON.stringify(viewFromMeta(current.meta)) === JSON.stringify(rounded)) return;
        editor.run(() => editor.updateShape({ id: shapeId, type: current.type, meta: { ...current.meta, [VIEW_META_KEY]: rounded } }), { history: "ignore" });
      }, 400);
    },
    [editor, sourceView, shapeId],
  );
  useEffect(() => () => window.clearTimeout(saveViewTimerRef.current), []);
  const setSourceRollRef = useCallback(
    (handle: PianoRollHandle | null) => {
      sourceRollRef.current = handle;
      if (handle) sourceRollHandles.set(shapeId, handle);
      else sourceRollHandles.delete(shapeId);
    },
    [shapeId],
  );

  // Frame the source roll when it has no saved view yet (new instance or the
  // first notes arriving); otherwise restore the saved view.
  const hasNotes = clip.notes.length > 0;
  useEffect(() => {
    afterLayout(() => {
      const roll = sourceRollRef.current;
      if (!roll) return;
      const saved = sourceView.get();
      if (saved) roll.setView(saved);
      else {
        roll.fitToContent();
        sourceView.set(roll.getView());
      }
    });
  }, [hasNotes, props.showSource, sourceView]);

  // The shape's height follows its content: sections collapse and expand.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const next = Math.ceil(el.getBoundingClientRect().height / editor.getZoomLevel()) + SHAPE_BORDER;
      const current = editor.getShape(shapeId)?.props as RunnerInstanceProps | undefined;
      if (current && Math.abs(current.h - next) > 1) updateProps({ h: next }, true);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [editor, shapeId, updateProps]);

  // Open the instance's output as soon as it is known so the first audition sounds.
  useEffect(() => {
    if (midi.status === "ready" && props.midiOutputName && !isSixSinesOutput(props.midiOutputName)) void getOutput(props.midiOutputName);
  }, [midi.status, props.midiOutputName]);

  // The live input follows the shape prop once MIDI is ready, and closes
  // (ending any take) when the shape goes away.
  const midiInputName = props.midiInputName;
  useEffect(() => {
    if (midi.status === "ready") void setInstanceInput(shapeId, midiInputName);
  }, [midi.status, midiInputName, shapeId]);
  useEffect(() => () => closeInput(shapeId), [shapeId]);

  // An overdub ends with the playback it was recorded over.
  useEffect(() => {
    if (runtime.mode === "idle" && recording.recording === "overdub") stopRecording(shapeId);
  }, [runtime.mode, recording.recording, shapeId]);

  // A fresh instance picks a default output once MIDI is ready.
  useEffect(() => {
    if (props.midiOutputName || midi.status !== "ready") return;
    const name = defaultOutputName();
    if (name) updateProps({ midiOutputName: name }, true);
  }, [midi.status, props.midiOutputName, updateProps]);

  const params: Params = useMemo(() => ({ ...defaultParams(def), ...props.params }), [def, props.params]);
  const setParam = (key: string, value: ParamValue) => updateProps({ params: { ...params, [key]: value } });

  const outputNames = midi.outputs.map((port) => port.name);
  if (props.midiOutputName && !isSixSinesOutput(props.midiOutputName) && !outputNames.includes(props.midiOutputName)) outputNames.unshift(props.midiOutputName);
  const inputNames = midi.inputs.map((port) => port.name);
  if (midiInputName && !inputNames.includes(midiInputName)) inputNames.unshift(midiInputName);

  const stageWidth = Math.max(320, Math.round(props.w - SHAPE_BORDER - ROLL_CHROME_WIDTH));

  const sourceGhosts = useMemo<GhostNote[]>(() => (def.sourceGhostNotes ? def.sourceGhostNotes(clip, params) : EMPTY_GHOSTS), [clip, def, params]);
  const noteBadge = useCallback(
    (note: PianoRollNote) => {
      const badges = def.tags.filter((tag) => tagValue(note, tag.key) !== undefined).map((tag) => tag.badge ?? tag.label.slice(0, 1).toUpperCase());
      return badges.length ? badges.join("") : null;
    },
    [def],
  );
  const noteColor = useCallback(
    (note: PianoRollNote) => {
      const tag = def.tags.find((candidate) => candidate.color && tagValue(note, candidate.key) !== undefined);
      return tag?.color;
    },
    [def],
  );
  // The cursor is saved in the shape's meta, outside undo (like the view);
  // a runner with usesCursor reads it live (api.getCursor).
  const onCursorChange = useCallback(
    (position: number) => {
      const current = editor.getShape(shapeId);
      if (!current || cursorFromMeta(current.meta) === position) return;
      editor.run(() => editor.updateShape({ id: shapeId, type: current.type, meta: { ...current.meta, [CURSOR_META_KEY]: position } }), { history: "ignore" });
    },
    [editor, shapeId],
  );
  const onSourceNotesChange = useCallback(
    (notes: PianoRollNote[]) => setClipNotes(shapeId, notes),
    [shapeId],
  );
  const onNotePreview = useCallback(
    (note: { pitch: number; velocity: number }) => auditionNote(shapeId, note.pitch, note.velocity),
    [shapeId],
  );
  const scale = clip.scale as PianoRollScale;
  const onScaleChange = useCallback((next: PianoRollScale) => setClipScale(shapeId, next), [shapeId]);
  const onKeyboardNote = useCallback(
    (pitch: number, on: boolean) => (on ? keyboardKeyDown(shapeId, pitch) : keyboardKeyUp(shapeId)),
    [shapeId],
  );
  useEffect(() => () => keyboardKeyUp(shapeId), [shapeId]);
  const onSelectionChange = useCallback((ids: string[]) => {
    selectedIdsRef.current = ids;
  }, []);
  const renderMetadataPanel = useCallback(
    (panel: MetadataPanelProps) => <TagEditor def={def} {...panel} />,
    [def],
  );

  // Tag hotkeys while the source roll has focus: applied straight to the clip.
  const onSourceKeyDown = (event: React.KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = def.tags.find((candidate) => candidate.hotkey && candidate.hotkey === event.key);
    if (!tag) return;
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    const liveClip = clipsStore.clips[shapeId];
    if (!liveClip) return;
    const selected = liveClip.notes.filter((note) => selectedIdsRef.current.includes(note.id));
    if (selected.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    toggleTag(tag, selected, (_label, ids, update) => {
      const idSet = new Set(ids);
      setClipNotes(
        shapeId,
        liveClip.notes.map((note) => {
          if (!idSet.has(note.id)) return note;
          const metadata = update(note.metadata, note);
          const next = { ...note };
          if (metadata) next.metadata = metadata;
          else delete next.metadata;
          return next;
        }),
      );
    });
  };

  // The name field edits a draft and commits on Enter or blur.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const commitName = () => {
    const next = nameDraft?.trim();
    if (next && next !== props.name) updateProps({ name: next });
    setNameDraft(null);
  };
  // Pointer events inside the body never reach tldraw (otherwise every click
  // in a roll would select or drag the shape). The title bar is the exception:
  // its background is the grip for moving the shape and for starting an
  // arrow with the arrow tool; only its own controls keep tldraw out.
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  // With any tool other than select (arrow, draw, ...), the whole title bar
  // passes through so an arrow can be started from it.
  const stopIfControl = (event: React.SyntheticEvent) => {
    if (editor.getCurrentToolId() !== "select") return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-control], input")) event.stopPropagation();
  };

  const recordingKind = recording.recording;
  const modeText = runtime.mode === "idle" ? "idle" : `${runtime.mode} · loop ${runtime.loopCount}`;
  const shapeState = recordingKind ? "recording" : runtime.mode;

  const portChoices = (names: string[], current: string, connected: string[]) => [
    { value: "", label: midi.status === "ready" ? "none" : "connect MIDI", muted: true },
    ...names.map((name) => ({ value: name, label: connected.includes(name) ? name : `${name} (missing)`, muted: !connected.includes(name) || undefined })),
  ].filter((option, index) => index > 0 || current === "" || midi.status === "ready");
  const connectedOutputs = midi.outputs.map((port) => port.name);
  const outputChoices: Array<{ value: string; label: string; muted?: boolean; divider?: boolean }> = [
    ...portChoices(outputNames, props.midiOutputName, connectedOutputs),
    ...synthOptions,
  ];
  if (isSixSinesOutput(props.midiOutputName) && !synthOptions.some(({ value }) => value === props.midiOutputName)) {
    outputChoices.push({ value: props.midiOutputName, label: "Six Sines (missing)", muted: true });
  }
  const connectedInputs = midi.inputs.map((port) => port.name);
  const outputRollProps = { shape, def, sourceView, width: stageWidth, pitchLabels, noteBadge, scale };
  const openPorts = () => {
    void ensureMidi().then(() => refreshPorts());
  };

  return (
    <HTMLContainer className={`runner-shape runner-shape--${shapeState}`} style={{ width: props.w, height: props.h }}>
      <div
        ref={contentRef}
        className="runner-shape__content"
        onKeyDown={(event) => {
          // Cmd-A on the instance's own controls: not the page's text, not tldraw's shapes
          const target = event.target as HTMLElement;
          const editable = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a" && !editable) event.preventDefault();
          stop(event);
        }}
        onKeyUp={stop}
      >
        <header
          className="runner-shape__title"
          title="drag here to move the shape; with the arrow tool, start an arrow here"
          onPointerDown={stopIfControl}
          onPointerMove={stopIfControl}
          onPointerUp={stopIfControl}
          onWheel={stopIfControl}
        >
          <span className="runner-shape__grip" aria-hidden="true">
            <Icon name="grip" />
          </span>
          <span className="runner-shape__name">{def.label}</span>
          <TextField
            className="runner-shape__instance-name"
            value={nameDraft ?? props.name}
            placeholder={def.type}
            onChange={setNameDraft}
            onCommit={commitName}
            onCancel={() => setNameDraft(null)}
            title="instance name (also in the sidebar)"
            width={170}
          />
          <Field label="loop" title="loop length in beats (notes past it stay in the clip)">
            <NumberBox
              className="runner-shape__loop-length"
              value={clip.loopLength}
              min={0.25}
              max={256}
              step={0.25}
              perPixel={0.25}
              format={(value) => (Number.isInteger(value) ? String(value) : value.toFixed(2))}
              width={78}
              onChange={(value) => setClipLoopLength(shapeId, value)}
            />
          </Field>
          <span className="ui-spacer" />
          <span className={`runner-shape__mode runner-shape__mode--${runtime.mode}`}>
            <Lamp tone={runtime.mode === "idle" ? "off" : runtime.mode} />
            {modeText}
          </span>
          <Toggle
            label="Q"
            className="runner-shape__queue"
            on={props.queued}
            onChange={(on) => updateProps({ queued: on })}
            title="queue: started together by Play queued in the top bar"
          />
        </header>

        <div className="runner-shape__body" onPointerDown={stop} onPointerMove={stop} onPointerUp={stop} onWheel={stop}>
          <div className="runner-shape__strip">
            <div className="ui-group">
              <Button
                icon="play"
                label="Play"
                tone="play"
                active={runtime.mode === "play"}
                onClick={() => (runtime.mode === "play" ? stopInstance(shapeId) : startPlay(shapeId))}
                title={runtime.mode === "play" ? "playing: click to stop" : "play the clip verbatim, looping"}
              />
              <Button
                icon="run"
                label="Run"
                tone="run"
                className="runner-shape__run"
                active={runtime.mode === "run"}
                onClick={() => (runtime.mode === "run" ? stopInstance(shapeId) : startRun(shapeId))}
                title={runtime.mode === "run" ? "running: click to stop" : "run the runner's algorithm, looping"}
              />
              <Button icon="stop" className="runner-shape__stop" onClick={() => stopInstance(shapeId)} title="stop this instance and release its notes" />
              <Button
                icon="record"
                label="Rec"
                tone="rec"
                className="runner-shape__rec"
                active={Boolean(recordingKind)}
                disabled={!recordingKind && recording.listening === null}
                onClick={() => (recordingKind ? stopRecording(shapeId) : startRecording(shapeId))}
                title="record from the MIDI input · playing: overdub at the loop position · idle with notes: start Play and overdub · empty clip: free take, loop length set on stop"
              />
            </div>
            <div className="ui-group ui-group--io">
              <span className="ui-caption">out</span>
              <Chooser
                className="runner-shape__output"
                value={props.midiOutputName}
                options={outputChoices}
                onOpen={openPorts}
                onChange={(value) => {
                  updateProps({ midiOutputName: value });
                  if (isSixSinesOutput(value)) void getOutput(value);
                }}
                title="Runner output"
              />
              <span className="ui-caption">in</span>
              <Chooser
                className="runner-shape__input"
                value={midiInputName}
                options={portChoices(inputNames, midiInputName, connectedInputs)}
                onOpen={openPorts}
                onChange={(value) => updateProps({ midiInputName: value })}
                title={`MIDI input${midiInputName ? `: ${midiInputName}` : ""} · held keys show on the source roll, Rec records from it`}
              />
              <Toggle
                label="Thru"
                on={props.midiThru ?? true}
                onChange={(on) => updateProps({ midiThru: on })}
                title="echo the input to this instance's output, with transpose"
              />
            </div>
            <div className="ui-group">
              <Toggle
                label="MPE Out"
                className="runner-shape__mpe-out"
                on={(props.mpe ?? false) || isSixSinesOutput(props.midiOutputName)}
                disabled={isSixSinesOutput(props.midiOutputName)}
                onChange={(on) => updateProps({ mpe: on })}
                title={isSixSinesOutput(props.midiOutputName)
                  ? "Six Sines always gets each note's pitch bend, pressure and timbre (no MPE setup needed)"
                  : "MPE out: each note on its own channel (2-16) with its recorded pitch bend, pressure and timbre (CC74)"}
              />
              <Field label="bend" title="semitones at full pitch bend, for recording and MPE output (48 is the MPE default, ordinary keyboards are usually 2)">
                <NumberBox className="runner-shape__bend" value={props.bendRange} min={1} max={96} step={1} width={57} onChange={(value) => updateProps({ bendRange: value })} />
              </Field>
              <Toggle
                label="Root"
                className="runner-shape__auto-root"
                on={props.autoRoot}
                onChange={(on) => updateProps({ autoRoot: on })}
                title="auto-root: recorded pitch-curve points within the tolerance of a semitone are marked rooted (scale-aware transposition moves them with the scale; chromatic transpose ignores it). Filled dots on the roll."
              />
              <NumberBox
                className="runner-shape__root-tolerance"
                value={props.rootToleranceCents}
                min={1}
                max={50}
                step={1}
                unit="¢"
                width={64}
                disabled={!(props.autoRoot)}
                title="auto-root tolerance: cents either side of a semitone"
                onChange={(value) => updateProps({ rootToleranceCents: value })}
              />
            </div>
          </div>

          <div className="runner-shape__params">
            {def.params.map((spec) =>
              spec.kind === "scale" ? (
                // A scale param: root chooser and degree list (the roll's tool row has the same pair)
                <div key={spec.key} className="runner-shape__param runner-shape__param--scale" title={spec.hint}>
                  <span className="runner-shape__param-label">{spec.label}</span>
                  <ScaleControls scale={scaleParam(params, spec.key) ?? spec.default} onChange={(scale) => setParam(spec.key, scale)} />
                </div>
              ) : spec.kind === "text" ? (
                <div key={spec.key} className="runner-shape__param runner-shape__param--text" title={spec.hint}>
                  <span className="runner-shape__param-label">{spec.label}</span>
                  <TextParam value={textParam(params, spec.key, spec.default)} validate={spec.validate} onCommit={(value) => setParam(spec.key, value)} />
                </div>
              ) : (
                <label key={spec.key} className="runner-shape__param" title={spec.hint}>
                  <span className="runner-shape__param-label">{spec.label}</span>
                  <NumberBox
                    bar
                    value={numberParam(params, spec.key, spec.default)}
                    min={spec.min}
                    max={spec.max}
                    step={spec.step}
                    format={formatParam}
                    title={spec.hint ?? spec.label}
                    onChange={(value) => setParam(spec.key, value)}
                  />
                </label>
              ),
            )}
          </div>

          <RollSection
            title="source"
            open={props.showSource}
            onToggle={() => updateProps({ showSource: !props.showSource })}
            toolsRef={setSourceToolbar}
            tools={
              <Field label="tempo" title="this instance's tempo: its run plays on its own TimeContext tempo, in beats (changes apply live; speed multiplies on top)">
                <NumberBox
                  className="runner-shape__tempo"
                  value={props.tempo}
                  min={20}
                  max={400}
                  step={0.5}
                  perPixel={0.5}
                  format={(value) => value.toFixed(2)}
                  unit="bpm"
                  width={118}
                  onChange={(value) => updateProps({ tempo: value })}
                />
              </Field>
            }
            onResizeStart={startRollResize("source")}
          >
            <div onKeyDownCapture={onSourceKeyDown}>
                <PianoRoll
                  ref={setSourceRollRef}
                  notes={clip.notes as PianoRollNote[]}
                  onNotesChange={onSourceNotesChange}
                  loopLength={clip.loopLength}
                  width={stageWidth}
                  height={rollHeight("source")}
                  pitchLabels={pitchLabels}
                  interactive
                  showControlPanel
                  toolbarTarget={sourceToolbar}
                  scale={scale}
                  onScaleChange={onScaleChange}
                  onKeyboardNote={onKeyboardNote}
                  ghostNotes={sourceGhosts}
                  noteBadge={noteBadge}
                  noteColor={noteColor}
                  onSelectionChange={onSelectionChange}
                  onNotePreview={onNotePreview}
                  renderMetadataPanel={renderMetadataPanel}
                  rawMetadataEditor={false}
                  initialView={sourceView.get() ?? undefined}
                  onViewChange={onSourceViewChange}
                  cursor={def.usesCursor ? cursorFromMeta(shape.meta) : undefined}
                  onCursorChange={onCursorChange}
                />
            </div>
          </RollSection>

          <GeneratedSection
            {...outputRollProps}
            rollRef={generatedRollRef}
            height={rollHeight("generated")}
            onToggle={() => updateProps({ showGenerated: !props.showGenerated })}
            onResizeStart={startRollResize("generated")}
          />
          <PreviewSection
            {...outputRollProps}
            height={rollHeight("preview")}
            onToggle={() => updateProps({ showPreview: !props.showPreview })}
            onResizeStart={startRollResize("preview")}
          />
          <RunnerStatus shapeId={shapeId} />
        </div>
      </div>
    </HTMLContainer>
  );
}

function RunnerStatus({ shapeId }: { shapeId: string }) {
  const runtime = useSnapshot(playbackStore).instances[shapeId] ?? EMPTY_RUNTIME;
  const recording = useSnapshot(recordingStore).byShape[shapeId] ?? EMPTY_RECORDING;
  const recordingKind = recording.recording;
  const lastEvent = useSnapshot(eventLogStore).byShape[shapeId]?.[0];
  return (
    <div className="runner-shape__status" role="status">
      {runtime.error ? (
        <span className="runner-shape__status-error" role="alert">
          could not start: {runtime.error}
        </span>
      ) : null}
      {recordingKind ? (
        <span className="runner-shape__status-rec">
          recording {recordingKind === "free" ? "a free take" : "overdub"} · {recording.recorded} notes
        </span>
      ) : recording.status ? (
        <span className="runner-shape__status-log">{recording.status}</span>
      ) : null}
      {lastEvent ? (
        <span className="runner-shape__status-event" title={JSON.stringify(lastEvent.event)}>
          {lastEvent.direction === "in" ? "←" : "→"} {lastEvent.event.type}
          {typeof lastEvent.event.pitch === "number" ? ` ${lastEvent.event.pitch}` : ""}
        </span>
      ) : null}
      {runtime.logs[0] ? <span className="runner-shape__status-log">{runtime.logs[0]}</span> : null}
    </div>
  );
}

const EMPTY_GHOSTS: GhostNote[] = [];
const EMPTY_RUNTIME = getRuntime("__none__");
const EMPTY_RECORDING: RecordingUi = { listening: null, recording: null, recorded: 0, status: "" };

/**
 * A text param: edits a draft, commits on Enter or blur when `validate`
 * accepts it; otherwise the error shows under the field and the instance
 * keeps the last good value. Escape reverts.
 */
function TextParam({ value, validate, onCommit }: { value: string; validate?: (text: string) => string | null; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const problem = validate?.(draft) ?? null;
    setError(problem);
    if (problem) return;
    if (draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <span className="runner-shape__text-param">
      <TextField
        className={error ? "is-invalid" : undefined}
        value={draft ?? value}
        onChange={(next) => {
          setDraft(next);
          if (error) setError(null);
        }}
        onCommit={commit}
        onCancel={() => {
          setDraft(null);
          setError(null);
        }}
      />
      {error ? <span className="runner-shape__param-error" role="alert">{error}</span> : null}
    </span>
  );
}

function formatParam(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

