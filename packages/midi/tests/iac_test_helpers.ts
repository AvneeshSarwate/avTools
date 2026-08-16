import type { MidiPortInfo } from "../api.ts";

export function selectLoopbackPort(
  ports: readonly MidiPortInfo[],
  requestedName?: string,
): MidiPortInfo {
  if (requestedName) {
    const match = ports.find((port) =>
      port.id === requestedName || port.name === requestedName ||
      port.name.includes(requestedName)
    );
    if (match) return match;
    throw new Error(
      `MIDI output not found: ${requestedName}. Available: ${
        ports.map((port) => port.name).join(", ") || "none"
      }`,
    );
  }

  const ranked = [...ports].sort((a, b) => score(b.name) - score(a.name));
  if (!ranked[0]) throw new Error("No MIDI outputs available");
  return ranked[0];
}

function score(name: string): number {
  const lower = name.toLowerCase();
  return Number(lower.includes("iac")) * 8 +
    Number(lower.includes("loop")) * 4 +
    Number(lower.includes("bus")) * 2;
}
