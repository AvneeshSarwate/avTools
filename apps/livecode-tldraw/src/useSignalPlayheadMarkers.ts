import { useCallback } from "react";
import type { SignalEntity } from "@avtools/livecode-protocol";
import { signalPlayheadMarkers } from "./signalPlayheadMarkers";
import { equalSignalPlayheadMarkers } from "./signalRendering";
import { useSyncConnection, useSyncSelector } from "./syncRuntime";

const NO_SIGNAL_PLAYHEAD_MARKERS: ReturnType<typeof signalPlayheadMarkers> = [];

/** Live signal markers anchored to one entity, stable across unrelated updates. */
export function useSignalPlayheadMarkers(
  entityType: string,
  name: string,
): ReturnType<typeof signalPlayheadMarkers> {
  const { connectionStatus } = useSyncConnection();
  const select = useCallback(
    (signals: Record<string, SignalEntity>) =>
      connectionStatus === "open"
        ? signalPlayheadMarkers(signals, entityType, name)
        : NO_SIGNAL_PLAYHEAD_MARKERS,
    [connectionStatus, entityType, name],
  );
  return useSyncSelector(
    "signal",
    select,
    equalSignalPlayheadMarkers,
  );
}
