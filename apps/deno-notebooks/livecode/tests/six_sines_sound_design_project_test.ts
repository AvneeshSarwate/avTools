import { assert, assertEquals } from "jsr:@std/assert@1";
import { copy } from "jsr:@std/fs@1/copy";
import { fromFileUrl, join } from "jsr:@std/path@1";
import type {
  LivecodeProjectManifest,
  SavedSixSinesEntity,
} from "@avtools/livecode-protocol";
import {
  getSixSines,
  registerSixSines,
  removeSixSines,
  setSixSinesParameters,
} from "@avtools/livecode-engine/six_sines_store.ts";
import { getDurableEntityType } from "@avtools/livecode-engine/entity_registry.ts";
import { createLivecodeVisualizerServer } from "../visualizer/server.ts";

const EXAMPLE_ROOT = fromFileUrl(
  new URL(
    "../../../livecode-tldraw/example-projects/six-sines-sound-design/",
    import.meta.url,
  ),
);
const MANIFEST = "project.avtools-livecode.json";
const MODULE_IDS = [
  "sound-design/instrument",
  "sound-design/player",
  "sound-design/pan-lfos",
];

async function post(baseUrl: string, path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function withFixture(
  mode: "local" | "remote",
  body: (
    baseUrl: string,
    projectRoot: string,
    manifest: LivecodeProjectManifest,
  ) => Promise<void>,
) {
  const sessionRoot = await Deno.makeTempDir({
    prefix: "six-sines-sound-design-test-",
  });
  const projectRoot = join(sessionRoot, "project");
  let server:
    | Awaited<ReturnType<typeof createLivecodeVisualizerServer>>
    | undefined;
  let manifest: LivecodeProjectManifest | undefined;
  try {
    await copy(EXAMPLE_ROOT, projectRoot);
    manifest = JSON.parse(await Deno.readTextFile(join(projectRoot, MANIFEST)));
    server = await createLivecodeVisualizerServer({
      host: "127.0.0.1",
      port: 0,
      sessionRoot,
      engineMode: mode,
    });
    await body(server.baseUrl, projectRoot, manifest!);
  } finally {
    await server?.close();
    if (mode === "local") {
      for (const entry of manifest?.data ?? []) {
        getDurableEntityType(entry.type)?.remove(entry.name);
      }
    }
    await Deno.remove(sessionRoot, { recursive: true });
  }
}

Deno.test("Six Sines sound-design fixture has clean browser diagnostics and all three modules analyze", async () => {
  await withFixture("remote", async (baseUrl, projectRoot, manifest) => {
    assertEquals(manifest.engineTarget, "browser");
    assertEquals(
      manifest.modules.map((module) => module.id).sort(),
      [...MODULE_IDS].sort(),
    );
    const opened = await post(baseUrl, "/project/open", {
      projectPath: projectRoot,
    });
    assertEquals(opened.status, 200);
    assertEquals(opened.body.ok, true);
    const response = await fetch(`${baseUrl}/project/diagnostics`);
    const diagnostics = await response.json();
    const failures: string[] = [];
    if (
      response.status !== 200 || diagnostics.denoCheck?.success !== true ||
      diagnostics.diagnostics?.length !== 0
    ) {
      failures.push(
        `Browser diagnostics:\n${
          diagnostics.denoCheck?.output ?? JSON.stringify(diagnostics)
        }\n${JSON.stringify(diagnostics.diagnostics)}`,
      );
    }
    // Analyze every module even if diagnostics fail, so the fixture owner gets
    // all source-located failures in one run. No browser/audio runtime starts.
    for (const moduleId of MODULE_IDS) {
      const analyzed = await post(baseUrl, "/runtime/analyze", {
        moduleId,
        sourceVersion: 1,
        projectModuleId: moduleId,
      });
      if (analyzed.status !== 200 || analyzed.body.type !== "analyzeSuccess") {
        failures.push(`${moduleId}: ${JSON.stringify(analyzed.body)}`);
      }
    }
    assertEquals(failures, [], failures.join("\n\n"));
    assertEquals(
      diagnostics.project?.manifest?.canvas?.sixSinesViews,
      manifest.canvas?.sixSinesViews,
    );
  });
});

Deno.test("Six Sines sound-design saved entity loads and round-trips with its canvas views", async () => {
  await withFixture("local", async (baseUrl, projectRoot, manifest) => {
    const entries = manifest.data?.filter((entry) =>
      entry.type === "sixSines"
    ) ?? [];
    assertEquals(entries.length, 1);
    const entry = entries[0];
    const saved = JSON.parse(
      await Deno.readTextFile(join(projectRoot, entry.path)),
    ) as SavedSixSinesEntity;
    assertEquals(saved.type, "sixSines");
    assertEquals(saved.name, entry.name);
    assert(Number.isFinite(Date.parse(saved.savedAt)));
    assertEquals(Object.keys(saved.data).sort(), ["preset", "values"]);
    assert(saved.data.preset.includes('<patch id="org.baconpaul.six-sines"'));
    assert(saved.data.preset.endsWith("</patch>"));
    const nativeIds = new Set(
      [...saved.data.preset.matchAll(/<p\s+id="(\d+)"/g)].map((match) =>
        match[1]
      ),
    );
    assert(nativeIds.size > 0);
    const overrides = Object.entries(saved.data.values);
    for (const [id, value] of overrides) {
      assert(
        /^(0|[1-9][0-9]*)$/.test(id) && Number.isSafeInteger(Number(id)),
        `Invalid parameter ID ${id}`,
      );
      assert(
        nativeIds.has(id),
        `Override ${id} is absent from the native preset`,
      );
      assert(
        typeof value === "number" && Number.isFinite(value),
        `Non-finite override ${id}`,
      );
    }
    const views = manifest.canvas?.sixSinesViews;
    assert(views?.length);
    assert(views.every((view) => view.synthName === entry.name));
    removeSixSines(entry.name);
    const opened = await post(baseUrl, "/project/open", {
      projectPath: projectRoot,
    });
    assertEquals(opened.status, 200);
    assertEquals(opened.body.ok, true);
    assertEquals(getSixSines(entry.name)?.data, saved.data);
    const live = registerSixSines(entry.name, saved.data);
    const liveValues = live.values;
    const parameterId = overrides[0]?.[0] ?? [...nativeIds][0];
    const changedValue = (saved.data.values[parameterId] ?? 0) + 0.125;
    assert(
      setSixSinesParameters(entry.name, { [parameterId]: changedValue }, {
        originId: "fixture-test",
      }).ok,
    );
    const expectedData = getSixSines(entry.name)!.data;
    const movedViews = views.map((view) => ({ ...view, x: view.x + 17 }));
    const canvas = await post(baseUrl, "/project/canvas", {
      canvas: { ...manifest.canvas, sixSinesViews: movedViews },
    });
    assertEquals(canvas.status, 200);
    const capture = await post(baseUrl, "/project/save", {});
    assertEquals(capture.status, 200);
    assertEquals(capture.body.ok, true);
    const diskManifest = JSON.parse(
      await Deno.readTextFile(join(projectRoot, MANIFEST)),
    ) as LivecodeProjectManifest;
    assertEquals(diskManifest.canvas?.sixSinesViews, movedViews);
    const diskEntry = diskManifest.data!.find((row) =>
      row.type === "sixSines" && row.name === entry.name
    )!;
    const diskEntity = JSON.parse(
      await Deno.readTextFile(join(projectRoot, diskEntry.path)),
    );
    assertEquals(diskEntity.data, expectedData);
    assert(
      setSixSinesParameters(entry.name, { [parameterId]: changedValue + 1 }).ok,
    );
    const reopened = await post(baseUrl, "/project/open", {
      projectPath: projectRoot,
    });
    assertEquals(reopened.status, 200);
    assertEquals(
      reopened.body.project.manifest.canvas.sixSinesViews,
      movedViews,
    );
    assertEquals(getSixSines(entry.name)!.data, expectedData);
    assert(registerSixSines(entry.name, saved.data) === live);
    assert(live.values === liveValues);
  });
});
