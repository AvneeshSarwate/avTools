// Client-side view-model types, plus a convenience re-export of the shared
// wire contract. The wire types themselves live in
// `@avtools/livecode-protocol` (raw TS, aliased by vite and tsconfig paths) —
// this file used to hand-mirror them, which is exactly the drift that package
// ends. Anything genuinely client-local belongs below; anything either side
// puts on the wire belongs in the package.

import type {
  AnalyzeFailure,
  AnalyzeSuccess,
} from "@avtools/livecode-protocol";

export type * from "@avtools/livecode-protocol";

/** One entry of the editor's local build history; never sent anywhere. */
export interface HistoryEntry {
  generatedRunId: string;
  sourceVersion: number;
  callsiteCount: number;
  transformedModuleUri: string;
}

/** An analyze success held by the client beside the source that produced it. */
export interface PreparedBuild extends AnalyzeSuccess {
  sourceText: string;
  serverBaseUrl: string;
}

/** An analyze failure held by the client beside the source that produced it. */
export interface PreparedFailure extends AnalyzeFailure {
  sourceText: string;
  serverBaseUrl: string;
}
