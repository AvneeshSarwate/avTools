import { MidiAccess } from "../mod.ts";
import type { PortInfo } from "../mod.ts";

export type LoopbackPair = {
  input: PortInfo;
  output: PortInfo;
};

export function openMidi(libPath?: string) {
  const midi = MidiAccess.open(libPath ? { libPath } : {});
  return { midi, libPath };
}

export function pickLoopback(inputs: PortInfo[], outputs: PortInfo[]): LoopbackPair {
  const outputByName = new Map(outputs.map((o) => [o.name.toLowerCase(), o]));
  const candidates = inputs
    .filter((i) => outputByName.has(i.name.toLowerCase()))
    .map((i) => ({
      input: i,
      output: outputByName.get(i.name.toLowerCase())!,
      score: scoreName(i.name),
    }))
    .sort((a, b) => b.score - a.score);

  if (candidates.length > 0) return { input: candidates[0].input, output: candidates[0].output };

  if (inputs.length === 0 || outputs.length === 0) {
    throw new Error("No MIDI ports available");
  }
  return { input: inputs[0], output: outputs[0] };
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function scoreName(name: string) {
  const lower = name.toLowerCase();
  let score = 0;
  if (lower.includes("iac")) score += 5;
  if (lower.includes("loop")) score += 4;
  if (lower.includes("bus")) score += 2;
  return score;
}
