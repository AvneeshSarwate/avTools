// The client's terminal-run dedupe, as a pure module with NO imports — the
// browser bundle and a Deno unit test both load this file as-is.
//
// Why it exists: the sync transport delivers a module's latest run whole,
// changed-only, and a terminal state is delivered exactly like any other. Two
// runs of one module can therefore be in flight at once from this client's
// point of view — the run being replaced reports its terminal while the
// replacement is still `launching` — and applying that terminal would retire a
// run that is genuinely alive.
//
// The key is the RUN token, minted server-side when a launch is accepted.
// `generatedRunId` identifies a prepared BUILD and is reused whenever a relaunch
// finds an unchanged one, so it cannot tell a run from the run that replaced it.
// The client never learns its own launch's token from the POST; it learns tokens
// only by watching run entities go active. So the memory below is:
//
//   supersededRunTokens — tokens watched go active BEFORE the current claim's
//                         POST. Their terminals are old news, always.
//   activeRunTokens     — tokens watched go active SINCE that POST. Their
//                         terminals are the claim's own outcome.
//
// Tick coalescing is why the `activeRunTokens.size === 0` clause exists: a
// launch and an instant error can land inside one 33 ms tick, in which case the
// only entity that ever ships is the terminal, under a token this client never
// saw active. That terminal must apply, or the module sits at `running` forever.

/** The `run` entity's lifecycle states, structurally identical to the wire's. */
export type RunDedupeState = "launching" | "running" | "stopped" | "error";

/** The run-entity fields the rule reads. `RunEntity` satisfies it structurally. */
export interface RunDedupeRun {
  state: RunDedupeState;
  runToken: string;
}

export interface RunDedupeMemory {
  /** Tokens observed active before the current claim's POST. */
  supersededRunTokens: Set<string>;
  /** Tokens observed active since the current claim's POST. */
  activeRunTokens: Set<string>;
  /** True from a launch POST until a terminal applies or the claim is dropped. */
  claimActive: boolean;
}

// One entry per run of one module. Bounded because a long session relaunches a
// module freely and nothing here ever needs the deep past: a token old enough to
// fall out of this window has long since delivered its terminal.
const MAX_REMEMBERED_TOKENS = 64;

export function createRunDedupeMemory(): RunDedupeMemory {
  return {
    supersededRunTokens: new Set(),
    activeRunTokens: new Set(),
    claimActive: false,
  };
}

export function isActiveRunState(state: RunDedupeState): boolean {
  return state === "launching" || state === "running";
}

/**
 * Stake a claim, immediately BEFORE posting `/runtime/launch`. Everything this
 * client has watched go active up to now belongs to the run being replaced.
 */
export function claimRun(memory: RunDedupeMemory): void {
  for (const token of memory.activeRunTokens) {
    rememberToken(memory.supersededRunTokens, token);
  }
  memory.activeRunTokens.clear();
  memory.claimActive = true;
}

/**
 * Drop the claim without a terminal: an edit (the running build is no longer
 * what this module means) or a launch that never reached the server. The token
 * memory survives, because the run it describes is still out there and its
 * terminal still has to land.
 */
export function releaseRunClaim(memory: RunDedupeMemory): void {
  memory.claimActive = false;
}

/** Record a run entity seen in `launching` or `running`. */
export function observeActiveRun(
  memory: RunDedupeMemory,
  run: RunDedupeRun,
): void {
  // The superseded run winding down still reports itself active for a tick or
  // two. Re-adopting its token here would make its own terminal applicable.
  if (memory.supersededRunTokens.has(run.runToken)) return;
  rememberToken(memory.activeRunTokens, run.runToken);
}

/**
 * Seed from `/runtime/state` on connect, reconnect, or reload. An active run is
 * one this client is now watching; a run that is ALREADY terminal was active
 * before any claim this client will ever stake, so its terminal must never
 * retire one.
 */
export function seedRehydratedRun(
  memory: RunDedupeMemory,
  run: RunDedupeRun,
): void {
  if (isActiveRunState(run.state)) {
    rememberToken(memory.activeRunTokens, run.runToken);
  } else {
    rememberToken(memory.supersededRunTokens, run.runToken);
  }
}

/** The rule. Called for every `stopped`/`error` run entity that arrives. */
export function shouldApplyTerminalRun(
  memory: RunDedupeMemory,
  run: RunDedupeRun,
): boolean {
  // A run this client watched go active before it staked the current claim is
  // the run being replaced: its terminal can never retire its successor.
  if (memory.supersededRunTokens.has(run.runToken)) return false;
  // The claim's own run ending is exactly what the client is waiting for.
  if (memory.activeRunTokens.has(run.runToken)) return true;
  // An unknown token. With no claim there is nothing to protect, so a terminal
  // is server truth. With a claim that has never been seen active, the terminal
  // IS that claim's outcome — a launch conflated with an instant error arrives
  // as one entity in one tick and must not be swallowed.
  return !memory.claimActive || memory.activeRunTokens.size === 0;
}

/** Insertion-ordered LRU: re-adding a token also refreshes it. */
function rememberToken(tokens: Set<string>, token: string): void {
  tokens.delete(token);
  tokens.add(token);
  while (tokens.size > MAX_REMEMBERED_TOKENS) {
    const oldest = tokens.values().next().value;
    if (oldest === undefined) break;
    tokens.delete(oldest);
  }
}
