import { assert, assertEquals } from "jsr:@std/assert@1";
import { fromFileUrl } from "jsr:@std/path@1";
import { DEFAULT_LIVECODE_SOURCE } from "../../../browser-projections/src/sketches/livecodeVisualizer/defaultSource.ts";
import { analyzeAndTransformTimedModule } from "../visualizer/analyze_transform.ts";
import { seedDemoPianoRoll } from "@avtools/livecode-engine/piano_roll_store.ts";

Deno.test("built-in editor source checks, analyzes, and initializes piano roll helpers", async () => {
  const tempDir = await Deno.makeTempDir({
    prefix: "tcv-default-source-",
  });

  try {
    const sourcePath = `${tempDir}/default_livecode_source.ts`;
    await Deno.writeTextFile(sourcePath, DEFAULT_LIVECODE_SOURCE);

    const check = await new Deno.Command(Deno.execPath(), {
      args: [
        "check",
        "--config",
        fromFileUrl(new URL("../../../../deno.json", import.meta.url)),
        sourcePath,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();

    assertEquals(
      check.code,
      0,
      `${new TextDecoder().decode(check.stdout)}${
        new TextDecoder().decode(check.stderr)
      }`,
    );

    const analysis = analyzeAndTransformTimedModule({
      moduleId: "default-source-module",
      sourceVersion: 1,
      sourceUri: sourcePath,
      sourceText: DEFAULT_LIVECODE_SOURCE,
      generatedRunId: "default-source-run",
      runtimeImport: new URL("../../../../packages/livecode-engine/runtime.ts", import.meta.url).href,
      idFactory: ({ index }) => `default_source_wait_${index + 1}`,
    });

    assertEquals(analysis.type, "analyzeSuccess");
    if (analysis.type !== "analyzeSuccess") return;
    assertEquals(
      analysis.manifest.callsites.map((entry) => ({
        display: entry.displayName,
        kind: entry.kind,
      })),
      [
        { display: "getPianoRollClip", kind: "pianoRollLookup" },
        { display: "setPianoRollClip", kind: "pianoRollLookup" },
        { display: "playPianoRoll", kind: "timeContextArgumentCall" },
        { display: "ctx.waitSec", kind: "timeContextMethod" },
      ],
    );
    // The default source reads the "melody" roll via a const-bound name; the
    // static fallback should not be available for an identifier argument, but
    // the lookup callsite should still be recorded for runtime resolution.
    const getPianoRollEntry = analysis.manifest.callsites.find((entry) =>
      entry.displayName === "getPianoRollClip"
    );
    assert(getPianoRollEntry, "expected getPianoRollClip callsite");
    assertEquals(getPianoRollEntry.staticName, undefined);
    assert(getPianoRollEntry.nameArgRange, "expected nameArgRange");

    // Seeding is a server-construction step rather than something a read path
    // does lazily, so this test stands in for the server the default source
    // normally runs under.
    seedDemoPianoRoll();
    const pianoRollHelpers = await import("piano-roll-helpers") as {
      getPianoRollClip(name: string): { notes: unknown[] };
    };
    assert(pianoRollHelpers.getPianoRollClip("melody").notes.length > 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
