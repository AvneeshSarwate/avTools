import { type MidiAccess, type MidiOutput, type MidiPortInfo, openMidiAccess } from "@avtools/midi/browser";
import { proxy } from "valtio";

export interface MidiState {
  status: "idle" | "opening" | "ready" | "error";
  outputs: MidiPortInfo[];
  error?: string;
}

export const midiStore = proxy<MidiState>({ status: "idle", outputs: [] });

// Port objects stay out of the proxy (ref) and the open outputs are plain
// module state: they are runtime handles, not UI state.
let access: MidiAccess | null = null;
let opening: Promise<MidiAccess | null> | null = null;
const openOutputs = new Map<string, MidiOutput>();
const pendingOutputs = new Map<string, Promise<MidiOutput | null>>();

function publishOutputs(opened: MidiAccess): void {
  midiStore.outputs = opened.listOutputs().map((port) => ({ id: port.id, name: port.name, manufacturer: port.manufacturer }));
}

export function ensureMidi(): Promise<MidiAccess | null> {
  if (access) return Promise.resolve(access);
  if (opening) return opening;
  midiStore.status = "opening";
  opening = openMidiAccess()
    .then((opened) => {
      access = opened;
      publishOutputs(opened);
      midiStore.status = "ready";
      midiStore.error = undefined;
      return opened;
    })
    .catch((error: unknown) => {
      midiStore.status = "error";
      midiStore.outputs = [];
      midiStore.error = error instanceof Error ? error.message : String(error);
      opening = null;
      return null;
    });
  return opening;
}

export function refreshOutputs(): void {
  if (access) publishOutputs(access);
}

/** The port named `name`; a name is used (not an id) so a project survives re-plugging. */
export function findOutputPort(name: string | undefined): MidiPortInfo | undefined {
  if (!name) return undefined;
  return midiStore.outputs.find((port) => port.name === name);
}

export function defaultOutputName(): string | undefined {
  const outputs = midiStore.outputs;
  return (outputs.find((port) => /IAC/i.test(port.name)) ?? outputs[0])?.name;
}

export async function getOutput(name: string | undefined): Promise<MidiOutput | null> {
  const opened = await ensureMidi();
  if (!opened) return null;
  const port = findOutputPort(name);
  if (!port) return null;
  const existing = openOutputs.get(port.id);
  if (existing && !existing.closed) return existing;
  const pending = pendingOutputs.get(port.id);
  if (pending) return pending;
  const promise = opened.openOutput(port.id)
    .then((output) => {
      openOutputs.set(port.id, output);
      return output;
    })
    .catch((error: unknown) => {
      console.error("[midi] open output failed", error);
      return null;
    })
    .finally(() => pendingOutputs.delete(port.id));
  pendingOutputs.set(port.id, promise);
  return promise;
}

/** Already-open output by name, for synchronous use (note audition). */
export function getOutputSync(name: string | undefined): MidiOutput | null {
  const port = findOutputPort(name);
  if (!port) return null;
  const output = openOutputs.get(port.id);
  return output && !output.closed ? output : null;
}

export function panicAllOutputs(): void {
  for (const output of openOutputs.values()) {
    if (output.closed) continue;
    for (let channel = 0; channel < 16; channel += 1) output.allNotesOff(channel);
  }
}
