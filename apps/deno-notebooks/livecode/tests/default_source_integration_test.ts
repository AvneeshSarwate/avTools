import { assert, assertEquals } from "jsr:@std/assert@1";
import { fromFileUrl } from "jsr:@std/path@1";
import { DEFAULT_LIVECODE_SOURCE } from "../../../browser-projections/src/sketches/livecodeVisualizer/defaultSource.ts";
import { analyzeAndTransformTimedModule } from "../visualizer/analyze_transform.ts";
import type { LivecodeMidiOutput } from "../helpers/midi_helpers.ts";
import type { PortInfo } from "../../midi/mod.ts";

Deno.test("built-in editor source checks, analyzes, and initializes MIDI helpers", async () => {
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
      runtimeImport: "../visualizer/runtime.ts",
      idFactory: ({ index }) => `default_source_wait_${index + 1}`,
    });

    assertEquals(analysis.type, "analyzeSuccess");
    if (analysis.type !== "analyzeSuccess") return;
    assertEquals(
      analysis.manifest.callsites.map((entry) => entry.displayName),
      [
        "noteCtx.waitSec",
        "ctx.waitSec",
        "ctx.waitSec",
      ],
    );

    const midiHelpers = await import("midi-helpers") as {
      closeMidiDevices(): void;
      listMidiDevices(): PortInfo[];
      midiDevices: Record<string, LivecodeMidiOutput>;
    };

    try {
      const outputs = midiHelpers.listMidiDevices();
      assert(Array.isArray(outputs));
      for (const output of outputs) {
        assertEquals(midiHelpers.midiDevices[output.name].name, output.name);
      }
    } finally {
      midiHelpers.closeMidiDevices();
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
