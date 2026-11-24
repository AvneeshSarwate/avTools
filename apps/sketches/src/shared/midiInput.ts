// Web MIDI input: one selected input port at a time, events to a listener.
import { type MidiAccess, type MidiInput, type MidiInputEvent, openMidiAccess } from "@avtools/midi/browser";
import { proxy } from "valtio";

export const midiInputStore = proxy<{
  status: "idle" | "opening" | "ready" | "error";
  inputs: { id: string; name: string }[];
  /** Port name (survives re-plugging; ids may not). */
  selected: string | null;
  error?: string;
}>({ status: "idle", inputs: [], selected: null });

let access: MidiAccess | null = null;
let opening: Promise<MidiAccess | null> | null = null;
let open: { input: MidiInput; off: () => void } | null = null;
let listener: (event: MidiInputEvent) => void = () => {};

export function setMidiListener(next: (event: MidiInputEvent) => void) {
  listener = next;
}

export function ensureMidi(): Promise<MidiAccess | null> {
  if (access) return Promise.resolve(access);
  if (opening) return opening;
  midiInputStore.status = "opening";
  opening = openMidiAccess().then((opened) => {
    access = opened;
    midiInputStore.status = "ready";
    refreshInputs();
    return opened;
  }, (error: unknown) => {
    midiInputStore.status = "error";
    midiInputStore.error = error instanceof Error ? error.message : String(error);
    opening = null;
    return null;
  });
  return opening;
}

export function refreshInputs() {
  if (!access) return;
  midiInputStore.inputs = access.listInputs().map((port) => ({ id: port.id, name: port.name }));
}

export async function selectMidiInput(name: string | null): Promise<void> {
  midiInputStore.selected = name;
  open?.off();
  open?.input.close();
  open = null;
  if (!name) return;
  const opened = await ensureMidi();
  const port = opened && midiInputStore.inputs.find((candidate) => candidate.name === name);
  if (!opened || !port || midiInputStore.selected !== name) return;
  const input = await opened.openInput(port.id);
  if (midiInputStore.selected !== name) {
    input.close();
    return;
  }
  open = { input, off: input.onMessage((event) => listener(event)) };
}
