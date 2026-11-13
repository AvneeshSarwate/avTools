export type RunCorrelation =
  | { phase: "observing" }
  | { phase: "launch-requested" }
  | { phase: "awaiting-run"; runToken: string };

export interface CorrelatedRun {
  state: "launching" | "running" | "stopped" | "error";
  runToken: string;
}

export interface RunCorrelationDecision {
  apply: boolean;
  next: RunCorrelation;
}

export function createRunCorrelation(): RunCorrelation {
  return { phase: "observing" };
}

export function beginRunLaunch(): RunCorrelation {
  return { phase: "launch-requested" };
}

export function acknowledgeRunLaunch(runToken: string): RunCorrelation {
  return { phase: "awaiting-run", runToken };
}

export function rejectRunLaunch(): RunCorrelation {
  return { phase: "observing" };
}

export function correlateRun(
  correlation: RunCorrelation,
  run: CorrelatedRun,
): RunCorrelationDecision {
  if (
    correlation.phase === "launch-requested" &&
    (run.state === "stopped" || run.state === "error")
  ) {
    return { apply: false, next: correlation };
  }

  if (correlation.phase === "awaiting-run") {
    if (run.runToken !== correlation.runToken) {
      return { apply: false, next: correlation };
    }
    return { apply: true, next: { phase: "observing" } };
  }

  return { apply: true, next: correlation };
}
