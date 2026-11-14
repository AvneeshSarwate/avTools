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

const SHAPE_PADDING = 10;
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
      push(position === null ? [] : [{ id: "▶", position, color: "#ff5252" }]);
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
  }, [active, shapeId]);
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
  usePlayhead(shapeId, runtime.mode !== "idle" || recording.listening !== null, playheadRolls, sourceRollRef);
  const selectedIdsRef = useRef<string[]>([]);
  // The three rolls share one view so they read as a score: the source roll
  // owns it, the read-only rolls follow, and it is saved in the shape's meta.
  const sourceViewRef = useRef<PianoRollView | null>(viewFromMeta(shape.meta));
  const saveViewTimerRef = useRef<number | undefined>(undefined);
  const [loopLengthDraft, setLoopLengthDraft] = useState<string>(bank ? String(bank.loopLength) : "");
  const bankLoopLength = bank?.loopLength;
  useEffect(() => {
    setLoopLengthDraft(bankLoopLength === undefined ? "" : String(bankLoopLength));
  }, [bankLoopLength]);

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
      const next = Math.ceil(el.getBoundingClientRect().height / editor.getZoomLevel()) + SHAPE_PADDING * 2;
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

  const stageWidth = Math.max(320, Math.round(props.w - SHAPE_PADDING * 2 - 42));

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

  const commitLoopLength = () => {
    if (!bank) return;
    const value = Number(loopLengthDraft);
    if (Number.isFinite(value) && value > 0) setBankLoopLength(bank.id, value);
    else setLoopLengthDraft(String(bank.loopLength));
  };

  const onBankSelect = (value: string) => {
    if (value === "__new__") {
      const created = createBank(def.type);
      updateProps({ bankId: created.id });
    } else {
      updateProps({ bankId: value });
    }
  };

  // Pointer events inside the body never reach tldraw (otherwise every click
  // in a roll would select or drag the shape). The header is the exception:
  // its background is the grip for moving the shape and for starting an
  // arrow with the arrow tool; only its own controls stop propagation.
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  // With any tool other than select (arrow, draw, ...), the whole header
  // passes through so an arrow can be started from it; with the select tool,
  // only its controls keep tldraw out so dropdowns and inputs work.
  const stopIfControl = (event: React.SyntheticEvent) => {
    if (editor.getCurrentToolId() !== "select") return;
    const target = event.target as HTMLElement;
    if (target.closest("input, select, button, label")) event.stopPropagation();
  };
  const modeLabel = runtime.mode === "idle" ? "idle" : `${runtime.mode} · loop ${runtime.loopCount}`;
  const lastEvent = eventLog[0];

  return (
    <HTMLContainer className={`runner-shape runner-shape--${runtime.mode}`} style={{ width: props.w, height: props.h }}>
      <div ref={contentRef} className="runner-shape__content" onKeyDown={stop} onKeyUp={stop}>
        <header
          className="runner-shape__header"
          title="drag here to move the shape; with the arrow tool, start an arrow here"
          onPointerDown={stopIfControl}
          onPointerMove={stopIfControl}
          onPointerUp={stopIfControl}
          onWheel={stopIfControl}
        >
          <span className="runner-shape__grip" aria-hidden="true">⠿</span>
          <strong className="runner-shape__title">{def.label}</strong>
          <label>
            bank
            <select value={bank ? bank.id : ""} onChange={(e) => onBankSelect(e.target.value)}>
              {!bank ? <option value="">(none)</option> : null}
              {bankOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
              <option value="__new__">+ new bank</option>
            </select>
          </label>
          <label>
            midi
            <select
              value={props.midiOutputName}
              onPointerDown={() => void ensureMidi()}
              onChange={(e) => updateProps({ midiOutputName: e.target.value })}
            >
              {midi.status !== "ready" ? <option value={props.midiOutputName}>{props.midiOutputName || "(connect MIDI)"}</option> : null}
              {midi.status === "ready" && !props.midiOutputName ? <option value="">(none)</option> : null}
              {midi.status === "ready"
                ? outputNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))
                : null}
            </select>
          </label>
          <label>
            loop
            <input
              className="runner-shape__loop-length"
              type="text"
              inputMode="decimal"
              value={loopLengthDraft}
              disabled={!bank}
              onChange={(e) => setLoopLengthDraft(e.target.value)}
              onBlur={commitLoopLength}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitLoopLength();
                }
              }}
            />
            beats
          </label>
          <label className="runner-shape__queue">
            <input type="checkbox" checked={props.queued} onChange={(e) => updateProps({ queued: e.target.checked })} />
            queue
          </label>
        </header>

        <div className="runner-shape__body" onPointerDown={stop} onPointerMove={stop} onPointerUp={stop} onWheel={stop}>
        <div className="runner-shape__params">
          {[...BASE_PARAMS, ...def.params].map((spec) => (
            <label key={spec.key} className="runner-shape__param" title={spec.hint}>
              <span>{spec.label}</span>
              <input
                type="range"
                min={spec.min}
                max={spec.max}
                step={spec.step}
                value={params[spec.key] ?? spec.default}
                onChange={(e) => setParam(spec.key, Number(e.target.value))}
              />
              <output>{formatParam(params[spec.key] ?? spec.default)}</output>
            </label>
          ))}
        </div>

        <div className="runner-shape__transport">
          <button type="button" className="runner-shape__run" disabled={!bank || runtime.mode === "run"} onClick={() => startRun(shapeId)}>
            Run
          </button>
          <button type="button" disabled={!bank || runtime.mode === "play"} onClick={() => startPlay(shapeId)}>
            Play
          </button>
          <button type="button" className="runner-shape__stop" onClick={() => stopInstance(shapeId)} title="always available: stops this instance and releases its notes">
            Stop
          </button>
          <button type="button" disabled={!bank} onClick={() => regenerate(shapeId)} title="dry-run the algorithm into the Preview roll">
            Regenerate
          </button>
          <span className={`runner-shape__state runner-shape__state--${runtime.mode}`}>{modeLabel}</span>
          {lastEvent ? (
            <span className="runner-shape__event" title={JSON.stringify(lastEvent.event)}>
              {lastEvent.direction === "in" ? "←" : "→"} {lastEvent.event.type}
              {typeof lastEvent.event.pitch === "number" ? ` ${lastEvent.event.pitch}` : ""}
            </span>
          ) : null}
          {runtime.logs[0] ? <span className="runner-shape__log">{runtime.logs[0]}</span> : null}
        </div>

        <div className="runner-shape__input" title="live MIDI input: held keys show on the source roll; Rec records into the bank">
          <label>
            in
            <select
              value={midiInputName}
              onPointerDown={() => {
                void ensureMidi().then(() => refreshPorts());
              }}
              onChange={(e) => updateProps({ midiInputName: e.target.value })}
            >
              <option value="">{midi.status === "ready" ? "(none)" : "(connect MIDI)"}</option>
              {inputNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`runner-shape__rec ${recording.recording ? "runner-shape__rec--on" : ""}`}
            disabled={!bank || (!recording.recording && recording.listening === null)}
            onClick={() => (recording.recording ? stopRecording(shapeId) : startRecording(shapeId))}
            title="while playing: overdub at the loop position · idle with notes: start Play and overdub · empty bank: free take, loop length set on stop"
          >
            {recording.recording ? "■ Rec" : "● Rec"}
          </button>
          <label title="echo the input to this instance's output, with transpose">
            <input type="checkbox" checked={props.midiThru ?? true} onChange={(e) => updateProps({ midiThru: e.target.checked })} />
            thru
          </label>
          <label title="MPE out: each note on its own channel (2-16) with its recorded pitch bend, pressure and timbre (CC74)">
            <input type="checkbox" checked={props.mpe ?? false} onChange={(e) => updateProps({ mpe: e.target.checked })} />
            MPE
          </label>
          <label title="semitones at full pitch bend, for recording and MPE output (48 is the MPE default, ordinary keyboards are usually 2)">
            bend
            <input
              className="runner-shape__bend"
              type="number"
              min={1}
              max={96}
              step={1}
              value={bendRange}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isFinite(value) && value >= 1 && value <= 96) updateProps({ bendRange: value });
              }}
            />
          </label>
          {recording.recording ? (
            <span className="runner-shape__rec-state">
              {recording.recording === "free" ? "free take" : "overdub"} · {recording.recorded} notes
            </span>
          ) : recording.status ? (
            <span className="runner-shape__log">{recording.status}</span>
          ) : null}
        </div>

        {runtime.error ? (
          <div className="runner-shape__error" role="alert">
            could not start: {runtime.error}
          </div>
        ) : null}

        <Section title="source" open={props.showSource} onToggle={() => updateProps({ showSource: !props.showSource })} extra={bank ? `${bank.name} · ${bank.notes.length} notes` : "no bank"}>
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

        <Section title="generated" open={props.showGenerated} onToggle={() => updateProps({ showGenerated: !props.showGenerated })} extra={runtime.generated ? `${runtime.generated.notes.length} notes · ${runtime.played.length} played` : "nothing generated yet"}>
          <PianoRoll
            ref={generatedRollRef}
            notes={(runtime.generated?.notes as PianoRollNote[] | undefined) ?? EMPTY_NOTES}
            loopLength={runtime.generated?.loopLength ?? bank?.loopLength ?? 16}
            width={stageWidth}
            height={OUTPUT_STAGE_HEIGHT}
            interactive={false}
            showControlPanel={false}
            ghostNotes={played}
            noteBadge={noteBadge}
            noteColor={generatedNoteColor}
          />
        </Section>

        <Section title="preview" open={props.showPreview} onToggle={() => updateProps({ showPreview: !props.showPreview })} extra={runtime.preview ? `${runtime.preview.notes.length} notes` : "press Regenerate"}>
          <PianoRoll
            ref={previewRollRef}
            notes={(runtime.preview?.notes as PianoRollNote[] | undefined) ?? EMPTY_NOTES}
            loopLength={runtime.preview?.loopLength ?? bank?.loopLength ?? 16}
            width={stageWidth}
            height={OUTPUT_STAGE_HEIGHT}
            interactive={false}
            showControlPanel={false}
            noteBadge={noteBadge}
            noteColor={previewNoteColor}
          />
        </Section>
        </div>
      </div>
    </HTMLContainer>
  );
}

const EMPTY_NOTES: PianoRollNote[] = [];
const EMPTY_GHOSTS: GhostNote[] = [];
const EMPTY_LOG: readonly never[] = [];
const EMPTY_RUNTIME = getRuntime("__none__");
const EMPTY_RECORDING: RecordingUi = { listening: null, recording: null, recorded: 0, status: "" };
const UNPLAYED_COLOR = "#b9b4ae";

function formatParam(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function Section({ title, open, onToggle, extra, children }: { title: string; open: boolean; onToggle: () => void; extra?: string; children: React.ReactNode }) {
  return (
    <section className={`runner-section ${open ? "runner-section--open" : ""}`}>
      <button type="button" className="runner-section__header" onClick={onToggle}>
        <span className="runner-section__chevron">{open ? "▾" : "▸"}</span>
        <span className="runner-section__title">{title}</span>
        {extra ? <span className="runner-section__extra">{extra}</span> : null}
      </button>
      {open ? <div className="runner-section__body">{children}</div> : null}
    </section>
  );
}

export type { RunnerShape };
