import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { Button } from "../../shared/controls/controls";
import { ProjectControls } from "../../shared/ProjectControls";
import { engine } from "./engine";
import { PaletteBar } from "./PaletteBar";
import { RegionPanel } from "./RegionPanel";
import { Grid } from "./Grid";
import { ASPECT } from "./model";
import { SynthDock } from "./SynthDock";
import { applySplit, cancelSplit, deleteRegion, doc, history, rememberDevView, loadDoc, PANEL_MAX, PANEL_MIN, project, TOP_MIN, ui, view } from "./store";

/** Track a pointer drag on window until release. */
function dragWith(event: React.PointerEvent, move: (dx: number, dy: number) => void) {
  event.preventDefault();
  const x0 = event.clientX;
  const y0 = event.clientY;
  const onMove = (e: PointerEvent) => move(e.clientX - x0, e.clientY - y0);
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.classList.remove("is-resizing");
  };
  document.body.classList.add("is-resizing");
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/** Undo/redo and save status: its own subscriber, so edits and autosaves re-render only this. */
function HistoryStatus() {
  const state = useSnapshot(ui);
  return (
    <>
      <Button icon="undo" onClick={() => history.undo()} disabled={!state.canUndo} title="Undo (Cmd-Z)" />
      <Button icon="redo" onClick={() => history.redo()} disabled={!state.canRedo} title="Redo (Shift-Cmd-Z)" />
      <span className="dim">{state.lastAction}</span>
      <ProjectControls project={project} />
    </>
  );
}

/**
 * The default view: the canvas alone, as large as the window allows, played
 * by clicking. Always landscape: on a portrait window (a phone held upright)
 * the whole view is turned 90° to fill the screen sideways, since a page
 * cannot lock the orientation (iOS never, Android only in fullscreen).
 */
function Presentation() {
  const lineWidth = useSnapshot(doc).lineWidth;
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  const rotated = viewport.h > viewport.w;
  // The landscape box the view lays out in (the window, sideways when rotated)
  const boxW = rotated ? viewport.h : viewport.w;
  const boxH = rotated ? viewport.w : viewport.h;
  const width = Math.max(200, Math.floor(Math.min(boxW, boxH * ASPECT)));
  return (
    <div className={`present${rotated ? " is-rotated" : ""}`} style={rotated ? { width: boxW, height: boxH } : undefined}>
      <div className="present__canvas">
        <Grid width={width} rotated={rotated} />
        {/* Inside the frame's corner, so the black text is always on a tile */}
        <button className="present__edit" onClick={() => (ui.mode = "edit")}
          style={{ top: lineWidth * (width / ASPECT) + 8, right: lineWidth * (width / ASPECT) + 12 }}>edit</button>
      </div>
    </div>
  );
}

export function SplitSweepApp() {
  const state = useSnapshot(ui);
  const layout = useSnapshot(view);
  const workspaceRef = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(640);

  useEffect(() => {
    void loadDoc().then(() => setReady(true));
  }, []);

  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      // The largest 16:9 that fits, with a margin.
      setGridWidth(Math.max(320, Math.floor(Math.min(width - 32, (height - 32) * ASPECT))));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready, state.mode === "present"]);

  // Mode changes start from silence: play mode opens with every region off.
  useEffect(() => {
    engine.releaseAll();
    ui.hoverId = null;

    if (state.mode !== "edit") ui.split = null;
  }, [state.mode]);

  // Dev: a reload comes back to this view and selection.
  useEffect(rememberDevView, [state.mode, state.selectedId]);

  // Solo: only the selected region drones while editing.
  useEffect(() => {
    if (state.mode !== "edit") return;
    if (!state.solo) {
      engine.releaseAll();
      return;
    }
    engine.releaseOthers(state.selectedId);
    if (state.selectedId && !engine.isOn(state.selectedId)) engine.trigger(state.selectedId);
  }, [state.solo, state.selectedId, state.mode]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable], six-sines-editor, .pr-root")) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        history.redo();
        return;
      }
      if (mod) return;
      if (event.key === "Tab") {
        if (ui.mode === "present") return;
        event.preventDefault();
        ui.mode = ui.mode === "edit" ? "play" : "edit";
      } else if ((event.key === "Backspace" || event.key === "Delete") && ui.mode === "edit" && !ui.split && ui.selectedId) {
        event.preventDefault();
        deleteRegion(ui.selectedId);
      } else if (ui.split) {
        if (event.key === "Escape") cancelSplit();
        else if (event.key === "v" && ui.split.anchor) applySplit("vertical");
        else if (event.key === "h" && ui.split.anchor) applySplit("horizontal");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready) return <div className="loading">loading…</div>;
  if (state.mode === "present") return <Presentation />;
  return (
    <div className="split-sweep">
      <header className="topbar">
        <span className="topbar__title">split · sweep</span>
        <Button label="Present" onClick={() => (ui.mode = "present")} title="The canvas alone, full window, played" />
        <div className="mode-switch">
          <Button label="Edit" active={state.mode === "edit"} tone="select" onClick={() => (ui.mode = "edit")} />
          <Button label="Play" active={state.mode === "play"} tone="play" onClick={() => {
            engine.start();
            ui.mode = "play";
          }} />
        </div>
        <span className="dim">Tab switches · {state.mode === "play" ? "click: ramp in / sweep / reverse · right-click: off" : "click: select"}</span>
        <span className="spacer" />
        <HistoryStatus />
      </header>
      <main className="workspace" ref={workspaceRef} style={{ height: layout.topHeight ?? undefined }}>
        <PaletteBar />
        <div className="stage" ref={stageRef}>
          <Grid width={gridWidth} />
        </div>
        {/* Kept mounted in play mode (just hidden) so the row and the grid keep their size. */}
        <div
          className={`resizer resizer--col${state.mode === "play" ? " is-hidden" : ""}`}
          title="Drag to resize the properties panel"
          onPointerDown={(event) => {
            const start = view.panelWidth;
            dragWith(event, (dx) => (view.panelWidth = Math.min(PANEL_MAX, Math.max(PANEL_MIN, start - dx))));
          }}
        />
        <div className={`panel-slot${state.mode === "play" ? " is-hidden" : ""}`} style={{ width: layout.panelWidth }}>
          <RegionPanel />
        </div>
      </main>
      <div
        className="resizer resizer--row"
        title="Drag to resize; double-click to fit the properties panel"
        onDoubleClick={() => {
          if (!view.rollFull) view.topHeight = null;
        }}
        onPointerDown={(event) => {
          const start = view.topHeight ?? workspaceRef.current?.clientHeight ?? 560;
          dragWith(event, (_, dy) => (view.topHeight = Math.max(TOP_MIN, Math.round(start + dy))));
        }}
      />
      <SynthDock />
    </div>
  );
}
