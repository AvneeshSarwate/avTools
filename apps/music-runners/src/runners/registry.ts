import type { RunnerDefinition } from "./runnerTypes";
import { variantsRunner } from "./variants/runner";
import { extenderRunner } from "./extender/runner";

export const RUNNERS: RunnerDefinition[] = [variantsRunner, extenderRunner];

const byType = new Map(RUNNERS.map((def) => [def.type, def]));

export function getRunner(type: string): RunnerDefinition {
  const def = byType.get(type);
  if (!def) throw new Error(`Unknown runner type: ${type}`);
  return def;
}

export function runnerShapeType(type: string): string {
  return `runner-${type}`;
}
