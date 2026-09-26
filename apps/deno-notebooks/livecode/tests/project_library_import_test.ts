// A project library is an ordinary in-project file that is not a manifest
// module (docs/livecode/principles.md, "Project libraries are normal code").
// The shadow check only mirrors manifest modules, so a relative import of a
// library must be followed to the real file: a healthy library type-checks,
// a broken one surfaces as a diagnostic, and the edge is a resolved non-module.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { join } from "jsr:@std/path@1";
import { createLivecodeVisualizerServer } from "../visualizer/server.ts";
import { fetchJson, postJson } from "./test_helpers.ts";
import type { ProjectShadowCheckResponse } from "../visualizer/protocol.ts";

Deno.test("shadow check follows imports of project library files", async () => {
  const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-lib-session-" });
  const projectRoot = await Deno.makeTempDir({ prefix: "tcv-lib-project-" });
  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    logLevel: "error",
  });
  try {
    const libDir = join(projectRoot, "lib");
    await Deno.mkdir(libDir, { recursive: true });
    const goodLibrary = `
import { scale } from "./scale.ts";
export function doubled(value: number): number {
  return scale(value, 2);
}
`;
    await Deno.writeTextFile(join(libDir, "helper.ts"), goodLibrary);
    await Deno.writeTextFile(
      join(libDir, "scale.ts"),
      "export const scale = (value: number, by: number) => value * by;\n",
    );
    await postJson(`${server.baseUrl}/project/create`, {
      projectPath: projectRoot,
      name: "library-import",
      modules: [
        {
          path: "modules/sketch.ts",
          kind: "runnable",
          title: "sketch",
          sourceText: `
import type { TimeContext } from "@avtools/core-timing";
import { doubled } from "../lib/helper.ts";

export default async function(ctx: TimeContext) {
  const value: number = doubled(21);
  await ctx.waitSec(value / 1000);
}
`,
        },
      ],
    });

    const clean = await fetchJson<ProjectShadowCheckResponse>(
      `${server.baseUrl}/project/diagnostics`,
    );
    assertEquals(clean.denoCheck.success, true, clean.denoCheck.output);
    assertEquals(clean.diagnostics, []);
    const edge = clean.edges.find((candidate) =>
      candidate.fromModuleId === "modules/sketch.ts" &&
      candidate.specifier === "../lib/helper.ts"
    );
    assert(edge, "the library import is a dependency edge");
    assertEquals(edge.toModuleId, undefined);
    assertEquals(edge.external, false);
    assertEquals(edge.unresolved, false);
    assertEquals(edge.resolvedPath, join(libDir, "helper.ts"));

    // A type error inside the library (returning a string where the module
    // expects a number) fails the check, attributed to the library file.
    await Deno.writeTextFile(
      join(libDir, "helper.ts"),
      goodLibrary.replace("return scale(value, 2);", "return String(value);"),
    );
    const broken = await fetchJson<ProjectShadowCheckResponse>(
      `${server.baseUrl}/project/diagnostics`,
    );
    assertEquals(broken.denoCheck.success, false);
    assert(
      broken.diagnostics.some((diagnostic) =>
        diagnostic.source === "deno" &&
        diagnostic.path?.endsWith("lib/helper.ts")
      ),
      `diagnostics name the library file: ${
        JSON.stringify(broken.diagnostics)
      }`,
    );

    // A missing library is an unresolved edge, not an external one.
    await Deno.writeTextFile(
      join(projectRoot, "modules", "sketch.orig.ts"),
      `
import type { TimeContext } from "@avtools/core-timing";
import { doubled } from "../lib/missing.ts";

export default async function(ctx: TimeContext) {
  await ctx.waitSec(doubled(1));
}
`,
    );
    const missing = await fetchJson<ProjectShadowCheckResponse>(
      `${server.baseUrl}/project/diagnostics`,
    );
    assertEquals(missing.denoCheck.success, false);
    const missingEdge = missing.edges.find((candidate) =>
      candidate.specifier === "../lib/missing.ts"
    );
    assert(missingEdge, "the missing import is still an edge");
    assertEquals(missingEdge.unresolved, true);
    assertEquals(missingEdge.external, false);
  } finally {
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true }).catch(() => {});
    await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
  }
});
