import { assertRejects, assertStrictEquals } from "jsr:@std/assert@1";
import { createLivecodeEngine } from "@avtools/livecode-engine";

Deno.test("engine close is idempotent and rejects later launches", async () => {
  const engine = createLivecodeEngine({
    log: () => {},
    onSyncTick: () => {},
    seedDemoRoll: false,
  });

  const firstClose = engine.close();
  const secondClose = engine.close();
  assertStrictEquals(secondClose, firstClose);
  await firstClose;

  await assertRejects(
    () =>
      engine.launchModule({
        moduleId: "closed-engine-module",
        transformedModuleUri: "file:///never-imported.ts",
        generatedRunId: "closed-engine-run",
      }),
    Error,
    "closed",
  );
});
