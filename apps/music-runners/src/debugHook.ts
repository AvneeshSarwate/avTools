// Everything a test script (or a curious console) needs, on window.__musicRunners.
import type { Editor } from "tldraw";
import { snapshot } from "valtio";
import { banksStore, createBank, setBankLoopLength, setBankNotes } from "./store/banks";
import { clockStore, nowBeats, setBpm } from "./store/clock";
import { arrowTargets, emitEvent, eventLogStore } from "./store/events";
import { ensureMidi, midiStore } from "./store/midi";
import { playbackStore, regenerate, startPlay, startRun, stopAll, stopInstance } from "./store/playback";
import { projectStore, saveProject } from "./store/project";
import { createInstance, listInstances } from "./shapes";
import { sourceRollHandles } from "./store/rollHandles";
import { recordingStore, setInstanceInput, startRecording, stopRecording, liveInputFor } from "./store/recording";

export function installDebugHook(editor: Editor): void {
  (window as unknown as { __musicRunners: unknown }).__musicRunners = {
    editor,
    stores: { banksStore, clockStore, midiStore, playbackStore, projectStore, eventLogStore, recordingStore },
    snapshot,
    banks: { createBank, setBankNotes, setBankLoopLength },
    clock: { setBpm, nowBeats },
    midi: { ensureMidi },
    events: { emitEvent, arrowTargets },
    playback: { startRun, startPlay, stopInstance, stopAll, regenerate },
    project: { saveProject },
    shapes: { createInstance, listInstances },
    recording: { setInstanceInput, startRecording, stopRecording, liveInputFor },
    sourceRollHandles,
  };
}
