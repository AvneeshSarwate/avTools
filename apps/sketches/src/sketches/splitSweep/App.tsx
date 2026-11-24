import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { Button } from "../../shared/controls/controls";
import { engine } from "./engine";
import { RegionPanel } from "./RegionPanel";
import { ASPECT, Grid } from "./Grid";
import { SynthDock } from "./SynthDock";
import { applySplit, cancelSplit, history, loadDoc, PROJECT, ui } from "./store";

export function SplitSweepApp() {
  const state = useSnapshot(ui);
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
  }, [ready]);

  // Mode changes start from silence: play mode opens with every region off.
  useEffect(() => {
    engine.releaseAll();
    if (state.mode === "play") ui.split = null;
  }, [state.mode]);

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
        event.preventDefault();
        ui.mode = ui.mode === "edit" ? "play" : "edit";
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
  return (
    <div className="split-sweep">
      <header className="topbar">
        <span className="topbar__title">split · sweep</span>
        <div className="mode-switch">
          <Button label="Edit" active={state.mode === "edit"} tone="select" onClick={() => (ui.mode = "edit")} />
          <Button label="Play" active={state.mode === "play"} tone="play" onClick={() => {
            engine.start();
            ui.mode = "play";
          }} />
        </div>
        <span className="dim">Tab switches · {state.mode === "play" ? "click: ramp in / sweep / reverse · right-click: off" : "click: select"}</span>
        <span className="spacer" />
        <Button icon="undo" onClick={() => history.undo()} disabled={!state.canUndo} title="Undo (Cmd-Z)" />
        <Button icon="redo" onClick={() => history.redo()} disabled={!state.canRedo} title="Redo (Shift-Cmd-Z)" />
        <span className="dim">{state.lastAction}</span>
        <span className={`save save--${state.save}`}>{PROJECT}: {state.save}</span>
      </header>
      <main className="workspace">
        <div className="stage" ref={stageRef}>
          <Grid width={gridWidth} />
        </div>
        {/* Kept mounted in play mode (just hidden) so the row and the grid keep their size. */}
        <div className={`panel-slot${state.mode === "play" ? " is-hidden" : ""}`}>
          <RegionPanel />
        </div>
      </main>
      <SynthDock />
    </div>
  );
}
