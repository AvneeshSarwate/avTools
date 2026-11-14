// The base runner instance shape: chrome (bank, MIDI output, loop length,
// params, transports, queue) plus three collapsible rolls. One tldraw shape
// type per runner definition is produced by defineRunnerShape.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BaseBoxShapeUtil,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  HTMLContainer,
  type RecordProps,
  T,
  type TLBaseBoxShape,
  useEditor,
} from "tldraw";
import { PianoRoll } from "../../pianoRoll/PianoRoll";
import type { GhostNote, MetadataPanelProps, PianoRollHandle, PianoRollNote, PianoRollView } from "../../pianoRoll/types";
import { banksStore, createBank, listBanks, setBankLoopLength, setBankNotes } from "../../store/banks";
import { eventLogStore } from "../../store/events";
import type { Bank } from "../../model/types";
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
  getRuntime,
  type InstanceRuntime,
  playbackStore,
  playheadBeats,
  regenerate,
  startPlay,
  startRun,
  stopInstance,
} from "../../store/playback";
import { sourceRollHandles } from "../../store/rollHandles";
import { runnerShapeType } from "../registry";
import { BASE_PARAMS, defaultParams, type Params, type RunnerDefinition, tagValue } from "../runnerTypes";
import { DEFAULT_INPUT_PROPS, DEFAULT_INSTANCE_HEIGHT, DEFAULT_INSTANCE_WIDTH, type RunnerInstanceProps } from "./instanceProps";
import { TagEditor, toggleTag } from "./TagEditor";
import { Button, Chooser, Field, Lamp, NumberBox, Toggle } from "../../ui/controls/controls";
import { Icon } from "../../ui/controls/icons";

/** Shape border (1px each side) around the content. */
const SHAPE_BORDER = 2;
/** Section body padding, roll border, scrollbar gap and vertical scrollbar. */
const ROLL_CHROME_WIDTH = 6 * 2 + 2 + 1 + 12;
/** Playhead colours: the play / run / rec tokens in styles.css. */
const PLAYHEAD_COLORS = { play: "#62d26f", run: "#ffab3d", rec: "#ff4f4f" } as const;
const SOURCE_STAGE_HEIGHT = 240;
const OUTPUT_STAGE_HEIGHT = 180;
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

type RunnerShape = TLBaseBoxShape & { props: RunnerInstanceProps };

export function defineRunnerShape(def: RunnerDefinition) {
  const type = runnerShapeType(def.type);

  function View({ shape }: { shape: RunnerShape }) {
    return <RunnerInstanceView shape={shape} def={def} />;
  }

  const versions = createShapePropsMigrationIds(type, { AddLiveInput: 1 });
  const migrations = createShapePropsMigrationSequence({
    sequence: [
      {
        id: versions.AddLiveInput,
        up(props: Record<string, unknown>) {
          for (const [key, value] of Object.entries(DEFAULT_INPUT_PROPS)) props[key] ??= value;
        },
        down(props: Record<string, unknown>) {
          for (const key of Object.keys(DEFAULT_INPUT_PROPS)) delete props[key];
        },
      },
    ],
  });

  class RunnerShapeUtil extends BaseBoxShapeUtil<TLBaseBoxShape> {
    static override type = type as TLBaseBoxShape["type"];
    static override migrations = migrations;
    static override props = {
      w: T.number,
      h: T.number,
      runnerType: T.string,
      bankId: T.string,
      midiOutputName: T.string,
      midiInputName: T.string,
      midiThru: T.boolean,
      mpe: T.boolean,
      bendRange: T.number,
      params: T.dict(T.string, T.number),
      queued: T.boolean,
      showSource: T.boolean,
      showGenerated: T.boolean,
      showPreview: T.boolean,
    } as unknown as RecordProps<TLBaseBoxShape>;

    override canScroll(): boolean {
      return true;
    }

    override canEdit(): boolean {
      return true;
    }

    override canResize(): boolean {
      return true;
    }

    override isAspectRatioLocked(): boolean {
      return false;
    }

    override getDefaultProps(): TLBaseBoxShape["props"] {
      const props: RunnerInstanceProps = {
        w: DEFAULT_INSTANCE_WIDTH,
        h: DEFAULT_INSTANCE_HEIGHT,
        runnerType: def.type,
        bankId: "",
        midiOutputName: "",
        ...DEFAULT_INPUT_PROPS,
        params: defaultParams(def),
        queued: false,
        showSource: true,
        showGenerated: true,
        showPreview: false,
      };
      return props as unknown as TLBaseBoxShape["props"];
    }

    override component(shape: TLBaseBoxShape) {
      return <View shape={shape as RunnerShape} />;
    }

    override getIndicatorPath(shape: TLBaseBoxShape) {
      const path = new Path2D();
      path.rect(0, 0, shape.props.w, shape.props.h);
      return path;
    }
  }

  return RunnerShapeUtil;
}

/**
 * Drives the playhead line on the given rolls, and the live input overlay
 * (held keys, notes being recorded) on the source roll, through their
 * imperative handles, never through React state: nothing in the shape
 * re-renders per tick. A free take has no loop, so its playhead comes from
 * the recorder.
 */
function usePlayhead(
  shapeId: string,
  active: boolean,
  color: string,
  rolls: React.RefObject<PianoRollHandle | null>[],
  sourceRoll: React.RefObject<PianoRollHandle | null>,
): void {
  useEffect(() => {
    const push = (markers: { id: string; position: number; color?: string }[]) => {
      for (const roll of rolls) roll.current?.setPlayheadMarkers(markers);
    };
    const clear = () => {
      push([]);
      sourceRoll.current?.setLiveInput({ keys: [], notes: [] });
    };
    if (!active) {
      clear();
      return;
    }
    const tick = () => {
      const position = freeTakePlayhead(shapeId) ?? playheadBeats(getRuntime(shapeId));
      push(position === null ? [] : [{ id: "▶", position, color }]);
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
  }, [active, color, shapeId]);
}

function RunnerInstanceView({ shape, def }: { shape: RunnerShape; def: RunnerDefinition }) {
  const editor = useEditor();
  const shapeId = shape.id;
  const props = shape.props;
  // Snapshots: this view re-renders only for the bank, instance runtime, MIDI
  // and event-log fields it reads, not for other instances' activity.
  const bank = useSnapshot(banksStore).banks[props.bankId] as Bank | undefined;
  const bankId = bank?.id;
  const runtime = (useSnapshot(playbackStore).instances[shapeId] ?? EMPTY_RUNTIME) as InstanceRuntime;
  const midi = useSnapshot(midiStore);
  const eventLog = useSnapshot(eventLogStore).byShape[shapeId] ?? EMPTY_LOG;
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sourceRollRef = useRef<PianoRollHandle | null>(null);
  const generatedRollRef = useRef<PianoRollHandle | null>(null);
  const previewRollRef = useRef<PianoRollHandle | null>(null);
  const playheadRolls = useMemo(() => [sourceRollRef, generatedRollRef], []);
  const recording = (useSnapshot(recordingStore).byShape[shapeId] ?? EMPTY_RECORDING) as RecordingUi;
  const playheadColor = recording.recording === "free" ? PLAYHEAD_COLORS.rec : runtime.mode === "run" ? PLAYHEAD_COLORS.run : PLAYHEAD_COLORS.play;
  usePlayhead(shapeId, runtime.mode !== "idle" || recording.listening !== null, playheadColor, playheadRolls, sourceRollRef);
  const selectedIdsRef = useRef<string[]>([]);
  // The three rolls share one view so they read as a score: the source roll
  // owns it, the read-only rolls follow, and it is saved in the shape's meta.
  const sourceViewRef = useRef<PianoRollView | null>(viewFromMeta(shape.meta));
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

  const followSourceView = useCallback(() => {
    const view = sourceViewRef.current;
    if (!view) return;
    generatedRollRef.current?.setView(view);
    previewRollRef.current?.setView(view);
  }, []);

  const onSourceViewChange = useCallback(
    (view: PianoRollView) => {
      sourceViewRef.current = view;
      followSourceView();
      window.clearTimeout(saveViewTimerRef.current);
      saveViewTimerRef.current = window.setTimeout(() => {
        const current = editor.getShape(shapeId);
        if (!current) return;
        const rounded = Object.fromEntries(Object.entries(view).map(([key, value]) => [key, Math.round(value * 1000) / 1000]));
        if (JSON.stringify(viewFromMeta(current.meta)) === JSON.stringify(rounded)) return;
        editor.run(() => editor.updateShape({ id: shapeId, type: current.type, meta: { ...current.meta, [VIEW_META_KEY]: rounded } }), { history: "ignore" });
      }, 400);
    },
    [editor, followSourceView, shapeId],
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

  // Frame the source roll when it has no saved view yet (new instance, bank
  // switch, or the first notes arriving); otherwise restore the saved view.
  const hasNotes = (bank?.notes.length ?? 0) > 0;
  useEffect(() => {
    if (!bankId) return;
    afterLayout(() => {
      const roll = sourceRollRef.current;
      if (!roll) return;
      const saved = sourceViewRef.current;
      if (saved) roll.setView(saved);
      else {
        roll.fitToContent();
        sourceViewRef.current = roll.getView();
      }
      followSourceView();
    });
  }, [bankId, hasNotes, props.showSource, followSourceView]);

  const generatedLoop = runtime.generated;
  const previewLoop = runtime.preview;
  useEffect(() => {
    afterLayout(followSourceView);
  }, [generatedLoop, previewLoop, props.showGenerated, props.showPreview, followSourceView]);

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
    if (midi.status === "ready" && props.midiOutputName) void getOutput(props.midiOutputName);
  }, [midi.status, props.midiOutputName]);

  // The live input follows the shape prop once MIDI is ready, and closes
  // (ending any take) when the shape goes away.
  const midiInputName = props.midiInputName ?? "";
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
  const setParam = (key: string, value: number) => updateProps({ params: { ...params, [key]: value } });

  const bankOptions = listBanks(def.type);
  const outputNames = midi.outputs.map((port) => port.name);
  if (props.midiOutputName && !outputNames.includes(props.midiOutputName)) outputNames.unshift(props.midiOutputName);
  const inputNames = midi.inputs.map((port) => port.name);
  if (midiInputName && !inputNames.includes(midiInputName)) inputNames.unshift(midiInputName);
  const bendRange = props.bendRange ?? DEFAULT_INPUT_PROPS.bendRange;

  const stageWidth = Math.max(320, Math.round(props.w - SHAPE_BORDER - ROLL_CHROME_WIDTH));

  const sourceGhosts = useMemo<GhostNote[]>(() => (bank && def.sourceGhostNotes ? def.sourceGhostNotes(bank) : EMPTY_GHOSTS), [bank, def]);
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
  const previewNoteColor = useCallback((note: PianoRollNote) => def.generatedNoteColor?.(note), [def]);
  // In the Generated roll a note that has not sounded yet this loop is dimmed,
  // so the live overlay reads as "played so far" even where it coincides with
  // the note itself. Ad hoc notes (trills) still show as their own ghosts.
  const played = runtime.played as GhostNote[];
  const playedIds = useMemo(() => new Set(played.map((ghost) => ghost.linkTo)), [played]);
  const generatedNoteColor = useCallback(
    (note: PianoRollNote) => {
      if (runtime.mode !== "idle" && !playedIds.has(note.id)) return UNPLAYED_COLOR;
      return def.generatedNoteColor?.(note);
    },
    [def, playedIds, runtime.mode],
  );

  const onSourceNotesChange = useCallback(
    (notes: PianoRollNote[]) => {
      if (bankId) setBankNotes(bankId, notes);
    },
    [bankId],
  );
  const onNotePreview = useCallback(
    (note: { pitch: number; velocity: number }) => auditionNote(shapeId, note.pitch, note.velocity),
    [shapeId],
  );
  const onSelectionChange = useCallback((ids: string[]) => {
    selectedIdsRef.current = ids;
  }, []);
  const renderMetadataPanel = useCallback(
    (panel: MetadataPanelProps) => <TagEditor def={def} {...panel} />,
    [def],
  );

  // Tag hotkeys while the source roll has focus: applied straight to the bank.
  const onSourceKeyDown = (event: React.KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = def.tags.find((candidate) => candidate.hotkey && candidate.hotkey === event.key);
    if (!tag || !bank) return;
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    const liveBank = banksStore.banks[bank.id];
    if (!liveBank) return;
    const selected = liveBank.notes.filter((note) => selectedIdsRef.current.includes(note.id));
    if (selected.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    toggleTag(tag, selected, (_label, ids, update) => {
      const idSet = new Set(ids);
      setBankNotes(
        liveBank.id,
        liveBank.notes.map((note) => {
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

  const onBankSelect = (value: string) => {
    if (value === "__new__") {
      const created = createBank(def.type);
      updateProps({ bankId: created.id });
    } else {
      updateProps({ bankId: value });
    }
  };
  const onRegenerate = () => {
    if (!props.showPreview) updateProps({ showPreview: true });
    regenerate(shapeId);
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
  const lastEvent = eventLog[0];
  const shapeState = recordingKind ? "recording" : runtime.mode;

  const bankChoices = [
    ...(bank ? [] : [{ value: "", label: "(no bank)", muted: true }]),
    ...bankOptions.map((option) => ({ value: option.id, label: option.name })),
    { value: "__new__", label: "+ new bank", divider: true },
  ];
  const portChoices = (names: string[], current: string, connected: string[]) => [
    { value: "", label: midi.status === "ready" ? "none" : "connect MIDI", muted: true },
    ...names.map((name) => ({ value: name, label: connected.includes(name) ? name : `${name} (missing)`, muted: !connected.includes(name) || undefined })),
  ].filter((option, index) => index > 0 || current === "" || midi.status === "ready");
  const connectedOutputs = midi.outputs.map((port) => port.name);
  const connectedInputs = midi.inputs.map((port) => port.name);
  const openPorts = () => {
    void ensureMidi().then(() => refreshPorts());
  };

  return (
    <HTMLContainer className={`runner-shape runner-shape--${shapeState}`} style={{ width: props.w, height: props.h }}>
      <div ref={contentRef} className="runner-shape__content" onKeyDown={stop} onKeyUp={stop}>
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
          <Chooser value={bank ? bank.id : ""} options={bankChoices} onChange={onBankSelect} title="bank: the notes this instance plays" />
          <Field label="loop" title="loop length in beats (notes past it stay in the bank)">
            <NumberBox
              className="runner-shape__loop-length"
              value={bank ? bank.loopLength : null}
              min={0.25}
              max={256}
              step={0.25}
              perPixel={0.25}
              format={(value) => (Number.isInteger(value) ? String(value) : value.toFixed(2))}
              disabled={!bank}
              width={46}
              onChange={(value) => bank && setBankLoopLength(bank.id, value)}
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
                disabled={!bank}
                onClick={() => runtime.mode !== "play" && startPlay(shapeId)}
                title="play the bank verbatim, looping"
              />
              <Button
                icon="run"
                label="Run"
                tone="run"
                className="runner-shape__run"
                active={runtime.mode === "run"}
                disabled={!bank}
                onClick={() => runtime.mode !== "run" && startRun(shapeId)}
                title="run the runner's algorithm, looping"
              />
              <Button icon="stop" className="runner-shape__stop" onClick={() => stopInstance(shapeId)} title="stop this instance and release its notes" />
              <Button
                icon="record"
                label="Rec"
                tone="rec"
                className="runner-shape__rec"
                active={Boolean(recordingKind)}
                disabled={!bank || (!recordingKind && recording.listening === null)}
                onClick={() => (recordingKind ? stopRecording(shapeId) : startRecording(shapeId))}
                title="record from the MIDI input · playing: overdub at the loop position · idle with notes: start Play and overdub · empty bank: free take, loop length set on stop"
              />
            </div>
            <div className="ui-group ui-group--io">
              <span className="ui-caption">out</span>
              <Chooser
                className="runner-shape__output"
                value={props.midiOutputName}
                options={portChoices(outputNames, props.midiOutputName, connectedOutputs)}
                onOpen={openPorts}
                onChange={(value) => updateProps({ midiOutputName: value })}
                title="MIDI output"
              />
              <span className="ui-caption">in</span>
              <Chooser
                className="runner-shape__input"
                value={midiInputName}
                options={portChoices(inputNames, midiInputName, connectedInputs)}
                onOpen={openPorts}
                onChange={(value) => updateProps({ midiInputName: value })}
                title="MIDI input: held keys show on the source roll, Rec records from it"
              />
              <Toggle
                label="Thru"
                on={props.midiThru ?? true}
                onChange={(on) => updateProps({ midiThru: on })}
                title="echo the input to this instance's output, with transpose"
              />
              <Toggle
                label="MPE"
                on={props.mpe ?? false}
                onChange={(on) => updateProps({ mpe: on })}
                title="MPE out: each note on its own channel (2-16) with its recorded pitch bend, pressure and timbre (CC74)"
              />
              <Field label="bend" title="semitones at full pitch bend, for recording and MPE output (48 is the MPE default, ordinary keyboards are usually 2)">
                <NumberBox className="runner-shape__bend" value={bendRange} min={1} max={96} step={1} width={34} onChange={(value) => updateProps({ bendRange: value })} />
              </Field>
            </div>
          </div>

          <div className="runner-shape__params">
            {[...BASE_PARAMS, ...def.params].map((spec) => (
              <label key={spec.key} className="runner-shape__param" title={spec.hint}>
                <span className="runner-shape__param-label">{spec.label}</span>
                <NumberBox
                  bar
                  value={params[spec.key] ?? spec.default}
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  format={formatParam}
                  title={spec.hint ?? spec.label}
                  onChange={(value) => setParam(spec.key, value)}
                />
              </label>
            ))}
          </div>

          <Section
            title="source"
            open={props.showSource}
            onToggle={() => updateProps({ showSource: !props.showSource })}
            extra={bank ? undefined : "no bank"}
            toolsRef={setSourceToolbar}
          >
            {bank ? (
              <div onKeyDownCapture={onSourceKeyDown}>
                <PianoRoll
                  ref={setSourceRollRef}
                  notes={bank.notes as PianoRollNote[]}
                  onNotesChange={onSourceNotesChange}
                  loopLength={bank.loopLength}
                  width={stageWidth}
                  height={SOURCE_STAGE_HEIGHT}
                  interactive
                  showControlPanel
                  toolbarTarget={sourceToolbar}
                  ghostNotes={sourceGhosts}
                  noteBadge={noteBadge}
                  noteColor={noteColor}
                  onSelectionChange={onSelectionChange}
                  onNotePreview={onNotePreview}
                  renderMetadataPanel={renderMetadataPanel}
                  initialView={sourceViewRef.current ?? undefined}
                  onViewChange={onSourceViewChange}
                />
              </div>
            ) : (
              <div className="runner-shape__empty">Pick or create a bank.</div>
            )}
          </Section>

          <Section
            title="generated"
            open={props.showGenerated}
            onToggle={() => updateProps({ showGenerated: !props.showGenerated })}
            extra={runtime.generated ? `${runtime.generated.notes.length} notes · ${runtime.played.length} played` : undefined}
          >
            {runtime.generated ? (
              <PianoRoll
                ref={generatedRollRef}
                notes={runtime.generated.notes as PianoRollNote[]}
                loopLength={runtime.generated.loopLength}
                width={stageWidth}
                height={OUTPUT_STAGE_HEIGHT}
                interactive={false}
                showControlPanel={false}
                ghostNotes={played}
                noteBadge={noteBadge}
                noteColor={generatedNoteColor}
              />
            ) : (
              <div className="runner-section__placeholder">Play or Run to see the loop that is sounding</div>
            )}
          </Section>

          <Section
            title="preview"
            open={props.showPreview}
            onToggle={() => updateProps({ showPreview: !props.showPreview })}
            extra={runtime.preview ? `${runtime.preview.notes.length} notes` : undefined}
            tools={
              <Button
                icon="regenerate"
                label="Regenerate"
                className="runner-shape__regenerate"
                disabled={!bank}
                onClick={onRegenerate}
                title="dry-run the algorithm into the Preview roll"
              />
            }
          >
            {runtime.preview ? (
              <PianoRoll
                ref={previewRollRef}
                notes={runtime.preview.notes as PianoRollNote[]}
                loopLength={runtime.preview.loopLength}
                width={stageWidth}
                height={OUTPUT_STAGE_HEIGHT}
                interactive={false}
                showControlPanel={false}
                noteBadge={noteBadge}
                noteColor={previewNoteColor}
              />
            ) : (
              <div className="runner-section__placeholder">Regenerate to preview one loop of the algorithm</div>
            )}
          </Section>
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
        </div>
      </div>
    </HTMLContainer>
  );
}

const EMPTY_GHOSTS: GhostNote[] = [];
const EMPTY_LOG: readonly never[] = [];
const EMPTY_RUNTIME = getRuntime("__none__");
const EMPTY_RECORDING: RecordingUi = { listening: null, recording: null, recorded: 0, status: "" };
const UNPLAYED_COLOR = "#8f8a85";

function formatParam(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function Section({
  title,
  open,
  onToggle,
  extra,
  tools,
  toolsRef,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  extra?: string;
  /** The section's own controls, right-aligned in its header. */
  tools?: React.ReactNode;
  /** Header slot a roll renders its tool row into (only while open). */
  toolsRef?: (el: HTMLElement | null) => void;
  children: React.ReactNode;
}) {
  return (
    <section className={`runner-section ${open ? "runner-section--open" : ""}`}>
      <div className="runner-section__header">
        <button type="button" data-control className="runner-section__toggle" onClick={onToggle} aria-expanded={open}>
          <Icon name={open ? "chevronDown" : "chevronRight"} size={10} />
          <span className="runner-section__title">{title}</span>
        </button>
        {extra ? <span className="runner-section__extra">{extra}</span> : null}
        <span className="runner-section__tools">
          {tools}
          {open && toolsRef ? <span ref={toolsRef} className="runner-section__toolbar" /> : null}
        </span>
      </div>
      {open ? <div className="runner-section__body">{children}</div> : null}
    </section>
  );
}

export type { RunnerShape };
