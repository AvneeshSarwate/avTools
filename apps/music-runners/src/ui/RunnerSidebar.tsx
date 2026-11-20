// The left sidebar: every runner type with a button to add an instance, and
// under it the instances on the current page with their transport state.
// Clicking a row selects the instance and brings it into view.
import { useEffect, useRef, useState } from "react";
import { type Editor, type TLShapeId, useValue } from "tldraw";
import { useSnapshot } from "valtio";
import { Button, Lamp, TextField } from "./controls/controls";
import { RUNNERS } from "../runners/registry";
import { createInstance, listInstances, revealInstance } from "../shapes";
import { clipsStore } from "../store/clips";
import type { Clip } from "../model/types";
import { getRuntime, playbackStore, playheadBeats, startPlay, startRun, stopInstance } from "../store/playback";
import { createSixSinesShape, type SixSinesShape } from "../shapes/SixSinesShape";
import { recordingStore } from "../store/recording";
import { SIX_SINES_TYPE } from "../store/sixSines";

interface InstanceRow {
  id: TLShapeId;
  name: string;
  runnerType: string;
  queued: boolean;
}

/** How often the rows' loop-progress bars are redrawn (the shape's playhead rate). */
const PROGRESS_INTERVAL_MS = 33;

export function RunnerSidebar({ editor }: { editor: Editor | null }) {
  const [collapsed, setCollapsed] = useState(false);
  const rows = useValue(
    "runner rows",
    () => (editor ? listInstances(editor).map(({ id, props }) => ({ id, name: props.name, runnerType: props.runnerType, queued: props.queued })) : []),
    [editor],
  );
  const synths = useValue(
    "Six Sines rows",
    () => editor?.getCurrentPageShapes().filter((shape) => shape.type === SIX_SINES_TYPE) ?? [],
    [editor],
  );
  const selected = useValue("selected ids", () => new Set(editor?.getSelectedShapeIds() ?? []), [editor]);
  const progressBars = useLoopProgress(rows);

  if (collapsed) {
    return (
      <aside className="runner-sidebar runner-sidebar--collapsed">
        <Button icon="chevronRight" quiet onClick={() => setCollapsed(false)} title="show runners" />
      </aside>
    );
  }

  return (
    <aside className="runner-sidebar">
      <div className="runner-sidebar__header">
        <span className="ui-caption">runners</span>
        <Button icon="chevronLeft" quiet onClick={() => setCollapsed(true)} title="hide runners" />
      </div>
      {RUNNERS.map((def) => {
        const instances = rows.filter((row) => row.runnerType === def.type);
        return (
          <section key={def.type} className="runner-group" data-runner-type={def.type}>
            <div className="runner-group__header" title={def.description}>
              <span className="runner-group__label">{def.label}</span>
              <Button
                icon="plus"
                quiet
                className="runner-group__add"
                disabled={!editor}
                title={`new ${def.label} instance`}
                onClick={() => {
                  if (!editor) return;
                  const id = createInstance(editor, def.type);
                  revealInstance(editor, id);
                }}
              />
            </div>
            {instances.length === 0 ? <div className="runner-row runner-row--empty">none yet</div> : null}
            {instances.map((row) => (
              <InstanceRowView key={row.id} editor={editor} row={row} selected={selected.has(row.id)} progressRef={progressBars(row.id)} />
            ))}
          </section>
        );
      })}
      <section className="runner-group">
        <div className="runner-group__header">
          <span className="runner-group__label">Six Sines</span>
          <Button icon="plus" quiet disabled={!editor} title="Add Six Sines synth" onClick={() => {
            if (editor) revealInstance(editor, createSixSinesShape(editor));
          }} />
        </div>
        {synths.length === 0 ? <div className="runner-row runner-row--empty">none yet</div> : null}
        {editor && synths.map((shape) => (
          <SynthRow key={shape.id} editor={editor} shape={shape} selected={selected.has(shape.id)} />
        ))}
      </section>
    </aside>
  );
}

function SynthRow({ editor, shape, selected }: { editor: Editor; shape: SixSinesShape; selected: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const name = shape.props.name;
  const className = `runner-row runner-row--synth${selected ? " is-selected" : ""}`;
  const commitName = () => {
    const next = draft?.trim();
    if (next && next !== name && editor.getShape(shape.id)) {
      editor.markHistoryStoppingPoint("rename Six Sines");
      editor.updateShape<SixSinesShape>({ id: shape.id, type: SIX_SINES_TYPE, props: { name: next } });
    }
    setDraft(null);
  };

  if (draft !== null) {
    return (
      <div className={className}>
        <TextField autoFocus value={draft} onChange={setDraft} onCommit={commitName} onCancel={() => setDraft(null)} />
      </div>
    );
  }

  return (
    <button
      type="button"
      className={className}
      aria-pressed={selected}
      title={`${name} · click to show it on the canvas, double-click to rename`}
      onClick={() => revealInstance(editor, shape.id)}
      onDoubleClick={() => setDraft(name)}
      onKeyDown={(event) => {
        if (event.key === "F2") {
          event.preventDefault();
          setDraft(name);
        }
      }}
    >
      <span className="runner-row__name">{name}</span>
    </button>
  );
}

function InstanceRowView({
  editor,
  row,
  selected,
  progressRef,
}: {
  editor: Editor | null;
  row: InstanceRow;
  selected: boolean;
  progressRef: (el: HTMLDivElement | null) => void;
}) {
  // Each row reads only its own fields, so a note sounding elsewhere (the
  // runtime's `played` list) does not re-render the sidebar.
  const runtime = useSnapshot(playbackStore).instances[row.id];
  const mode = runtime?.mode ?? "idle";
  const loopCount = runtime?.loopCount ?? 0;
  const error = runtime?.error ?? null;
  // Active with nothing sounding (an arp with no chord under its cursor)
  const waiting = mode !== "idle" && runtime?.generated === null;
  const recording = useSnapshot(recordingStore).byShape[row.id]?.recording ?? null;
  const clip = useSnapshot(clipsStore).clips[row.id] as Clip;
  const [draft, setDraft] = useState<string | null>(null);

  const state = recording ? "rec" : mode;
  // The lamp and the text colour say which transport; the text says how far
  const status = recording === "free"
    ? "take"
    : waiting && !recording
      ? "waiting"
      : recording || mode !== "idle"
        ? `loop ${loopCount}`
      : `${clip.notes.length}n · ${clip.loopLength}b`;
  const commitName = () => {
    const next = draft?.trim();
    const shape = editor?.getShape(row.id);
    if (editor && shape && next && next !== row.name) editor.updateShape({ id: row.id, type: shape.type, props: { name: next } as never });
    setDraft(null);
  };

  return (
    <div
      className={`runner-row runner-row--${state}${selected ? " is-selected" : ""}`}
      data-shape-id={row.id}
      onClick={(event) => {
        if (!editor || (event.target as HTMLElement).closest("[data-control]")) return;
        revealInstance(editor, row.id);
      }}
    >
      <Lamp tone={state === "idle" ? "off" : state} pulse={state === "rec"} />
      {draft !== null ? (
        <TextField autoFocus value={draft} onChange={setDraft} onCommit={commitName} onCancel={() => setDraft(null)} />
      ) : (
        <span
          className="runner-row__name"
          title={`${row.name} · click to show it on the canvas, double-click to rename`}
          onDoubleClick={() => setDraft(row.name)}
        >
          {row.name}
        </span>
      )}
      {draft !== null ? null : (
        <>
          {row.queued ? (
            <span className="runner-row__queued" title="queued: started by Play queued">
              Q
            </span>
          ) : null}
          <span
            className={`runner-row__status${error ? " is-error" : ""}`}
            title={error ?? `${recording ? "recording · " : mode !== "idle" ? `${mode} · ` : ""}${clip.notes.length} notes · loop ${clip.loopLength} beats`}
          >
            {error ? "error" : status}
          </span>
          <span className="runner-row__transport">
            <Button icon="play" tone="play" quiet active={mode === "play"} title={mode === "play" ? "Playing: click to stop" : "Play: the clip verbatim, looping"} onClick={() => (mode === "play" ? stopInstance(row.id) : startPlay(row.id))} />
            <Button icon="run" tone="run" quiet active={mode === "run"} title={mode === "run" ? "Running: click to stop" : "Run: the runner's algorithm, looping"} onClick={() => (mode === "run" ? stopInstance(row.id) : startRun(row.id))} />
            <Button icon="stop" quiet disabled={mode === "idle"} title="stop" onClick={() => stopInstance(row.id)} />
          </span>
        </>
      )}
      <div className="runner-row__progress" ref={progressRef} />
    </div>
  );
}

/**
 * Loop progress under each active row, written straight to the DOM on a
 * timer (per-frame data never goes through React). Returns a ref callback
 * per instance id.
 */
function useLoopProgress(rows: InstanceRow[]): (id: string) => (el: HTMLDivElement | null) => void {
  const bars = useRef(new Map<string, HTMLDivElement>());
  const callbacks = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const active = useSnapshot(playbackStore).instances;
  const anyActive = rows.some((row) => (active[row.id]?.mode ?? "idle") !== "idle");

  useEffect(() => {
    const draw = () => {
      for (const [id, el] of bars.current) {
        const runtime = getRuntime(id);
        const position = playheadBeats(runtime);
        const fraction = position === null || runtime.loopLength <= 0 ? 0 : Math.min(1, position / runtime.loopLength);
        el.style.transform = `scaleX(${fraction})`;
      }
    };
    draw();
    if (!anyActive) return;
    const timer = window.setInterval(draw, PROGRESS_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      draw();
    };
  }, [anyActive]);

  return (id: string) => {
    let callback = callbacks.current.get(id);
    if (!callback) {
      callback = (el) => {
        if (el) bars.current.set(id, el);
        else bars.current.delete(id);
      };
      callbacks.current.set(id, callback);
    }
    return callback;
  };
}
