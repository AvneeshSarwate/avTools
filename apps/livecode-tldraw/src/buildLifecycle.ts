import type { PreparedBuild } from "./livecodeProtocol";

export type BuildStatus =
  | "idle"
  | "queued"
  | "analyzing"
  | "ready"
  | "error"
  | "not-connected";

export interface BuildIdentity {
  sourceText: string;
  serverBaseUrl: string;
}

export type BuildLifecycle =
  | { phase: "idle" }
  | { phase: "disconnected" }
  | { phase: "queued"; identity: BuildIdentity; timer: number }
  | {
    phase: "analyzing";
    identity: BuildIdentity;
    requestId: number;
    promise: Promise<PreparedBuild | null>;
  }
  | { phase: "ready"; build: PreparedBuild }
  | { phase: "failed"; identity: BuildIdentity };

export function buildIdentity(
  sourceText: string,
  serverBaseUrl: string,
): BuildIdentity {
  return { sourceText, serverBaseUrl };
}

export function identitiesMatch(
  left: BuildIdentity,
  right: BuildIdentity,
): boolean {
  return left.sourceText === right.sourceText &&
    left.serverBaseUrl === right.serverBaseUrl;
}

export function buildMatchesIdentity(
  build: PreparedBuild,
  identity: BuildIdentity,
): boolean {
  return build.sourceText === identity.sourceText &&
    build.serverBaseUrl === identity.serverBaseUrl;
}

export function lifecycleCanProduce(
  lifecycle: BuildLifecycle,
  identity: BuildIdentity,
): boolean {
  if (lifecycle.phase === "ready") {
    return buildMatchesIdentity(lifecycle.build, identity);
  }
  if (lifecycle.phase === "queued" || lifecycle.phase === "analyzing") {
    return identitiesMatch(lifecycle.identity, identity);
  }
  return false;
}

export function isCurrentAnalysis(
  lifecycle: BuildLifecycle,
  requestId: number,
): boolean {
  return lifecycle.phase === "analyzing" &&
    lifecycle.requestId === requestId;
}

export function buildStatusOf(lifecycle: BuildLifecycle): BuildStatus {
  switch (lifecycle.phase) {
    case "idle":
      return "idle";
    case "disconnected":
      return "not-connected";
    case "queued":
      return "queued";
    case "analyzing":
      return "analyzing";
    case "ready":
      return "ready";
    case "failed":
      return "error";
  }
}
