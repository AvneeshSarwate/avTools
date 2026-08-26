import { assertEquals } from "jsr:@std/assert@1";
import {
  applySyncMessageToState,
  emptySyncState,
} from "../../../livecode-tldraw/src/syncState.ts";

Deno.test("sync state resets replace a kind and changes copy only touched kinds", () => {
  const state = emptySyncState();
  const resetDirty = applySyncMessageToState(state, {
    type: "sync",
    seq: 1,
    timestampMs: 1,
    resets: {
      run: [
        {
          moduleId: "a",
          runToken: "run-a",
          generatedRunId: "generated-a",
          state: "running",
          executionCount: 1,
          updatedAt: 1,
        },
      ],
    },
  });
  assertEquals([...resetDirty], ["run"]);
  assertEquals(Object.keys(state.run.entities), ["a"]);

  const originalRunMap = state.run.entities;
  const changeDirty = applySyncMessageToState(state, {
    type: "sync",
    seq: 2,
    timestampMs: 2,
    changes: [{
      entityType: "moduleWaits",
      name: "a",
      entity: { moduleId: "a", callsiteIds: ["wait-1"] },
    }],
  });
  assertEquals([...changeDirty], ["moduleWaits"]);
  assertEquals(state.run.entities, originalRunMap);
  assertEquals(state.moduleWaits.entities.a.callsiteIds, ["wait-1"]);

  applySyncMessageToState(state, {
    type: "sync",
    seq: 3,
    timestampMs: 3,
    changes: [{ entityType: "moduleWaits", name: "a", entity: null }],
  });
  assertEquals(state.moduleWaits.entities, {});
});
