import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { react, useEditor, type Signal } from "tldraw";
import { useSnapshot, type Snapshot } from "valtio";
import { PianoRoll } from "../../pianoRoll/PianoRoll";
import type { GhostNote, PianoRollHandle, PianoRollNote, PianoRollProps, PianoRollView } from "../../pianoRoll/types";
import { clipsStore } from "../../store/clips";
import { playbackStore, regenerate, regenerateThrottled } from "../../store/playback";
import { Button, Toggle } from "../../ui/controls/controls";
import type { LoopNotes, RunnerDefinition } from "../runnerTypes";
import { cursorFromMeta, type RunnerInstanceProps } from "./instanceProps";
import { RollSection } from "./RollSection";
import type { RunnerShape } from "./RunnerShape";

type RollRef = RefObject<PianoRollHandle | null>;
type RollAppearance = Pick<PianoRollProps, "width" | "height" | "scale" | "pitchLabels" | "noteBadge">;

interface SectionProps extends RollAppearance {
  shape: RunnerShape;
  def: RunnerDefinition;
  sourceView: Signal<PianoRollView | null>;
  onToggle: () => void;
  onResizeStart: React.PointerEventHandler<HTMLDivElement>;
}

/**
 * Shape meta key for the Preview roll's auto-regenerate toggle (a view
 * preference, outside undo like the heights). Missing means on.
 */
const AUTO_REGENERATE_META_KEY = "autoRegenerate";
/** Auto-regenerate runs at most this often (~15 Hz), with a trailing run on the latest input. */
const AUTO_REGENERATE_INTERVAL_MS = 66;

function autoRegenerateFromMeta(meta: unknown): boolean {
  return (meta as Record<string, unknown> | undefined)?.[AUTO_REGENERATE_META_KEY] !== false;
}
const EMPTY_GHOSTS: GhostNote[] = [];
const UNPLAYED_COLOR = "#8f8a85";

export function GeneratedSection({
  shape,
  def,
  sourceView,
  onToggle,
  onResizeStart,
  rollRef,
  ...appearance
}: SectionProps & { rollRef: RollRef }) {
  const loop = useSnapshot(playbackStore).instances[shape.id]?.generated;
  return (
    <OutputSection
      title="generated"
      open={shape.props.showGenerated}
      onToggle={onToggle}
      onResizeStart={onResizeStart}
      sourceView={sourceView}
      rollRef={rollRef}
      loop={loop}
      extra={loop && <GeneratedCount shapeId={shape.id} notes={loop.notes.length} />}
    >
      {loop ? (
        <GeneratedRoll
          {...appearance}
          shapeId={shape.id}
          def={def}
          rollRef={rollRef}
          notes={loop.notes as PianoRollNote[]}
          loopLength={(loop.start ?? 0) + loop.loopLength}
          interactive={false}
          showControlPanel={false}
          navigable
        />
      ) : (
        <div className="runner-section__placeholder">Play or Run to see the loop that is sounding</div>
      )}
    </OutputSection>
  );
}

function GeneratedCount({ shapeId, notes }: { shapeId: string; notes: number }) {
  const count = useSnapshot(playbackStore).instances[shapeId]?.played.length ?? 0;
  return (
    <>
      {notes} notes · {count} played
    </>
  );
}

function GeneratedRoll({
  shapeId,
  def,
  rollRef,
  ...props
}: PianoRollProps & {
  shapeId: string;
  def: RunnerDefinition;
  rollRef: React.RefObject<PianoRollHandle | null>;
}) {
  // In the Generated roll a note that has not sounded yet this loop is dimmed,
  // so the live overlay reads as "played so far" even where it coincides with
  // the note itself. Ad hoc notes (trills) still show as their own ghosts.
  const runtime = useSnapshot(playbackStore).instances[shapeId];
  const played = (runtime?.played ?? EMPTY_GHOSTS) as GhostNote[];
  const active = runtime?.mode !== "idle";
  const playedIds = useMemo(() => new Set(played.map((ghost) => ghost.linkTo)), [played]);
  const generatedNoteColor = useCallback(
    (note: PianoRollNote) => {
      if (active && !playedIds.has(note.id)) return UNPLAYED_COLOR;
      return def.generatedNoteColor?.(note);
    },
    [def, playedIds, active],
  );

  return <PianoRoll {...props} ref={rollRef} ghostNotes={played} noteColor={generatedNoteColor} />;
}

export function PreviewSection({ shape, def, sourceView, onToggle, onResizeStart, ...appearance }: SectionProps) {
  const editor = useEditor();
  const shapeId = shape.id;
  const open = shape.props.showPreview;
  const clip = useSnapshot(clipsStore).clips[shapeId];
  const loop = useSnapshot(playbackStore).instances[shapeId]?.preview;
  const rollRef = useRef<PianoRollHandle | null>(null);
  const noteColor = useCallback((note: PianoRollNote) => def.generatedNoteColor?.(note), [def]);
  const onRegenerate = () => {
    if (!open) onToggle();
    regenerate(shapeId);
  };

  // Auto-regenerate: while the Preview roll is open, any change to what
  // `generate` reads (notes and their tags, loop length, scale, params, the
  // cursor) re-runs the dry run, throttled so a slider drag updates
  // continuously. regenerate() is pure (no events, no MIDI); the button still
  // re-rolls the randomness on unchanged input.
  const autoRegenerate = autoRegenerateFromMeta(shape.meta);
  const setAutoRegenerate = (on: boolean) => {
    const current = editor.getShape(shapeId);
    if (!current) return;
    editor.run(
      () =>
        editor.updateShape({
          id: shapeId,
          type: current.type,
          meta: { ...current.meta, [AUTO_REGENERATE_META_KEY]: on },
        }),
      { history: "ignore" },
    );
  };
  const autoActive = autoRegenerate && open;
  const generateCursor = cursorFromMeta(shape.meta);
  useEffect(() => {
    if (!autoActive) return;
    // Checked again when a trailing run fires, so turning Auto off or closing
    // the pane drops it.
    const stillWanted = () => {
      const current = editor.getShape(shapeId);
      return !!current && (current.props as RunnerInstanceProps).showPreview && autoRegenerateFromMeta(current.meta);
    };
    regenerateThrottled(shapeId, AUTO_REGENERATE_INTERVAL_MS, stillWanted);
  }, [autoActive, editor, shapeId, clip.notes, clip.loopLength, clip.scale, shape.props.params, generateCursor]);

  return (
    <OutputSection
      title="preview"
      open={open}
      onToggle={onToggle}
      onResizeStart={onResizeStart}
      sourceView={sourceView}
      rollRef={rollRef}
      loop={loop}
      extra={loop && `${loop.notes.length} notes`}
      tools={
        <>
          <Toggle
            label="Auto"
            className="runner-shape__auto-regenerate"
            on={autoRegenerate}
            onChange={setAutoRegenerate}
            title="auto-regenerate: while the Preview is open, re-run the dry run whenever the notes, their tags or the params change"
          />
          <Button
            icon="regenerate"
            label="Regenerate"
            className="runner-shape__regenerate"
            onClick={onRegenerate}
            title="dry-run the algorithm into the Preview roll"
          />
        </>
      }
    >
      {loop ? (
        <PianoRoll
          {...appearance}
          ref={rollRef}
          notes={loop.notes as PianoRollNote[]}
          loopLength={(loop.start ?? 0) + loop.loopLength}
          interactive={false}
          showControlPanel={false}
          noteColor={noteColor}
          navigable
        />
      ) : (
        <div className="runner-section__placeholder">Regenerate to preview one loop of the algorithm</div>
      )}
    </OutputSection>
  );
}

function OutputSection({
  title,
  open,
  onToggle,
  onResizeStart,
  sourceView,
  rollRef,
  loop,
  extra,
  tools,
  children,
}: {
  title: "generated" | "preview";
  open: boolean;
  onToggle: () => void;
  onResizeStart: SectionProps["onResizeStart"];
  sourceView: SectionProps["sourceView"];
  rollRef: RollRef;
  loop: Snapshot<LoopNotes> | null | undefined;
  extra: ReactNode;
  tools?: ReactNode;
  children: ReactNode;
}) {
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (!open || !follow || !loop) return;
    return react(`follow source view in ${title}`, () => {
      const view = sourceView.get();
      if (view) rollRef.current?.setView(view);
    });
  }, [open, follow, loop, sourceView, rollRef, title]);

  return (
    <RollSection
      title={title}
      open={open}
      extra={extra}
      onToggle={onToggle}
      onResizeStart={loop ? onResizeStart : undefined}
      tools={
        <>
          {loop && (
            <span className="runner-section__view-tools">
              <Toggle
                icon="link"
                label="Follow"
                className={`runner-shape__follow-${title}`}
                on={follow}
                onChange={setFollow}
                title="follow the Source roll's view; scrolling or zooming here turns it off, turning it on snaps back"
              />
              <Button
                icon="zoomOut"
                quiet
                title="zoom out"
                onClick={() => {
                  setFollow(false);
                  rollRef.current?.zoomBy(1 / 1.25);
                }}
              />
              <Button
                icon="zoomIn"
                quiet
                title="zoom in"
                onClick={() => {
                  setFollow(false);
                  rollRef.current?.zoomBy(1.25);
                }}
              />
              <Button
                icon="fit"
                quiet
                className={`runner-shape__fit-${title}`}
                title="fit the notes, including played trills and other ghost notes"
                onClick={() => {
                  setFollow(false);
                  rollRef.current?.fitToContent();
                }}
              />
            </span>
          )}
          {tools}
        </>
      }
    >
      {loop ? (
        <div
          onWheelCapture={() => setFollow(false)}
          onPointerDownCapture={(event) => {
            if ((event.target as HTMLElement).closest(".pr-scrollbar")) setFollow(false);
          }}
        >
          {children}
        </div>
      ) : (
        children
      )}
    </RollSection>
  );
}
