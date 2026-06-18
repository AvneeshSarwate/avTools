/// <reference lib="dom" />

import { assert, assertEquals } from "jsr:@std/assert@1";
import { join } from "jsr:@std/path@1";
import { decodePNG } from "@img/png";
import { createLivecodeVisualizerServer } from "../visualizer/server.ts";
import type {
  AnalyzeSuccess,
  ProjectStatusResponse,
  RuntimeModuleStatus,
} from "../visualizer/protocol.ts";

Deno.test("project modules share transformed files and drive a p5gpu snapshot", async () => {
  const sessionRoot = await Deno.makeTempDir({
    prefix: "tcv-project-session-",
  });
  const projectRoot = await Deno.makeTempDir({ prefix: "tcv-project-p5gpu-" });
  const snapshotPath = join(projectRoot, "snapshots", "livecode-test.png");
  await Deno.mkdir(join(projectRoot, "snapshots"), { recursive: true });
  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    logLevel: "debug",
  });

  try {
    const p5gpuUrl = new URL("../../tools/p5gpu.ts", import.meta.url).href;
    const webgpuHelpersUrl = new URL(
      "../../libraryIntegrationTetsts/raw-webgpu-helpers.ts",
      import.meta.url,
    ).href;

    await postJson(`${server.baseUrl}/project/create`, {
      projectPath: projectRoot,
      name: "p5gpu-livecode-e2e",
      modules: [
        {
          path: "modules/state.ts",
          kind: "runnable",
          title: "state",
          sourceText: `
import type { TimeContext } from "@avtools/core-timing";

export const state = {
  frame: 0,
  x: 32,
  direction: 1,
  speed: 1.4,
  color: [235, 90, 140] as [number, number, number],
  snapshotRequested: false,
  snapshotPath: ${JSON.stringify(snapshotPath)},
};

export default async function(_ctx: TimeContext) {}
`,
        },
        {
          path: "modules/modifiers/color-loop.ts",
          kind: "runnable",
          title: "color loop",
          sourceText: `
import type { TimeContext } from "@avtools/core-timing";
import { state } from "../state.ts";

export default async function(ctx: TimeContext) {
  while (true) {
    state.color = [80, 230, 170];
    state.speed = 2.5;
    await ctx.waitSec(1);
  }
}
`,
        },
        {
          path: "modules/sketch.ts",
          kind: "runnable",
          title: "sketch",
          sourceText: `
import type { TimeContext } from "@avtools/core-timing";
import { P5GPU } from ${JSON.stringify(p5gpuUrl)};
import { requestWebGpuDevice, writeTextureToPng } from ${
            JSON.stringify(webgpuHelpersUrl)
          };
import { state } from "./state.ts";

const device = await requestWebGpuDevice();
const p5 = new P5GPU(device, { width: 64, height: 64, sampleCount: 1 });

async function saveCurrentFrame(_ctx: unknown, texture: GPUTexture) {
  await writeTextureToPng(device, texture, 64, 64, p5.format, state.snapshotPath);
}

export default async function(ctx: TimeContext) {
  while (true) {
    state.x += state.direction * state.speed;
    if (state.x > 52 || state.x < 12) {
      state.direction *= -1;
      state.x = Math.max(12, Math.min(52, state.x));
    }
    p5.beginFrame();
    p5.background(18, 22, 34, 255);
    p5.noStroke();
    p5.fill(state.color[0], state.color[1], state.color[2], 255);
    p5.circle(state.x, 32, 18);
    const texture = p5.endFrame();
    state.frame += 1;
    if (state.snapshotRequested) {
      await saveCurrentFrame(ctx, texture);
      state.snapshotRequested = false;
    }
    await ctx.waitSec(0.02);
  }
}
`,
        },
        {
          path: "modules/modifiers/snapshot.ts",
          kind: "runnable",
          title: "snapshot",
          sourceText: `
import type { TimeContext } from "@avtools/core-timing";
import { state } from "../state.ts";

export default async function(_ctx: TimeContext) {
  state.snapshotRequested = true;
}
`,
        },
      ],
    });

    await assertExists(join(projectRoot, "modules", "state.orig.ts"));
    await assertExists(join(projectRoot, "modules", "state.ts"));
    await assertExists(
      join(projectRoot, "modules", "modifiers", "color-loop.orig.ts"),
    );
    await assertExists(
      join(projectRoot, "modules", "modifiers", "color-loop.ts"),
    );
    await assertExists(join(projectRoot, "modules", "sketch.orig.ts"));
    await assertExists(join(projectRoot, "modules", "sketch.ts"));

    const sketchAnalyze = await analyzeProjectModule(
      server.baseUrl,
      "modules/sketch.ts",
    );
    assertEquals(sketchAnalyze.type, "analyzeSuccess");
    assert(
      sketchAnalyze.manifest.callsites.length >= 1,
      "sketch should expose visualized wait callsites",
    );
    assert(
      sketchAnalyze.projectManifests?.some((manifest) =>
        manifest.moduleId === "modules/modifiers/color-loop.ts" &&
        manifest.callsites.length === 1
      ),
      "project analyze should expose transformed modifier manifests",
    );
    await launchAnalyzedModule(server.baseUrl, sketchAnalyze);

    await waitForRuntimeModule(
      server.baseUrl,
      "modules/sketch.ts",
      "sketch running",
      8_000,
    );

    const colorLoopAnalyze = await analyzeProjectModule(
      server.baseUrl,
      "modules/modifiers/color-loop.ts",
    );
    assertEquals(colorLoopAnalyze.type, "analyzeSuccess");
    await launchAnalyzedModule(server.baseUrl, colorLoopAnalyze);

    await waitForRuntimeModule(
      server.baseUrl,
      "modules/modifiers/color-loop.ts",
      "color loop running",
      8_000,
    );

    const snapshotAnalyze = await analyzeProjectModule(
      server.baseUrl,
      "modules/modifiers/snapshot.ts",
    );
    assertEquals(snapshotAnalyze.type, "analyzeSuccess");
    await launchAnalyzedModule(server.baseUrl, snapshotAnalyze);

    await waitForFile(snapshotPath, "snapshot png", 8_000);
    const encoded = await Deno.readFile(snapshotPath);
    assert(encoded.length > 100, "snapshot should not be empty");
    const decoded = await decodePNG(encoded);
    assertEquals(decoded.header.width, 64);
    assertEquals(decoded.header.height, 64);
    assert(
      hasPixelNear(decoded.body, [80, 230, 170, 255], 20),
      "snapshot should include the livecoded shared-state color",
    );

    const status = await fetchJson<ProjectStatusResponse>(
      `${server.baseUrl}/project/status`,
    );
    assertEquals(status.ok, true);
    assert(
      status.modules.some((moduleEntry) =>
        moduleEntry.path === "modules/sketch.ts"
      ),
    );

    await Deno.writeTextFile(
      join(projectRoot, "modules", "modifiers", "color-loop.orig.ts"),
      "\n// changed on disk by e2e test\n",
      { append: true },
    );
    const staleStatus = await fetchJson<ProjectStatusResponse>(
      `${server.baseUrl}/project/status`,
    );
    const colorStatus = staleStatus.modules.find((moduleEntry) =>
      moduleEntry.path === "modules/modifiers/color-loop.ts"
    );
    const sketchStatus = staleStatus.modules.find((moduleEntry) =>
      moduleEntry.path === "modules/sketch.ts"
    );
    assert(
      colorStatus?.changedOnDisk,
      "color loop source should be changed on disk",
    );
    assertEquals(
      sketchStatus?.runningStale,
      false,
      "running sketch should not be stale when an unrelated modifier changes",
    );
  } finally {
    await postJson(`${server.baseUrl}/runtime/stop-all`, {});
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true });
    await Deno.remove(projectRoot, { recursive: true });
  }
});

async function analyzeProjectModule(
  baseUrl: string,
  modulePath: string,
): Promise<AnalyzeSuccess> {
  return await postJson<AnalyzeSuccess>(`${baseUrl}/runtime/analyze`, {
    moduleId: modulePath,
    sourceVersion: 1,
    projectModulePath: modulePath,
  });
}

async function launchAnalyzedModule(baseUrl: string, analyze: AnalyzeSuccess) {
  await postJson(`${baseUrl}/runtime/launch`, {
    moduleId: analyze.moduleId,
    transformedModuleUri: analyze.transformedModuleUri,
    generatedRunId: analyze.generatedRunId,
    sourceHash: analyze.sourceHash,
    projectSourceHash: analyze.projectSourceHash,
    projectModulePath: analyze.projectModulePath,
  });
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return await response.json();
}

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return await response.json();
}

async function waitForRuntimeModule(
  baseUrl: string,
  moduleId: string,
  label: string,
  timeoutMs: number,
) {
  await waitFor(
    async () => {
      const status = await fetchJson<{ activeModules: RuntimeModuleStatus[] }>(
        `${baseUrl}/runtime/status`,
      );
      return status.activeModules.some((moduleEntry) =>
        moduleEntry.moduleId === moduleId
      );
    },
    label,
    timeoutMs,
  );
}

async function assertExists(path: string) {
  const stat = await Deno.stat(path);
  assert(stat.isFile, `${path} should be a file`);
}

async function waitForFile(path: string, label: string, timeoutMs: number) {
  await waitFor(
    async () => {
      try {
        const stat = await Deno.stat(path);
        return stat.isFile && stat.size > 0;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return false;
        throw error;
      }
    },
    label,
    timeoutMs,
  );
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs: number,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function hasPixelNear(
  pixels: Uint8Array,
  target: [number, number, number, number],
  tolerance: number,
): boolean {
  for (let index = 0; index < pixels.length; index += 4) {
    if (
      Math.abs(pixels[index] - target[0]) <= tolerance &&
      Math.abs(pixels[index + 1] - target[1]) <= tolerance &&
      Math.abs(pixels[index + 2] - target[2]) <= tolerance &&
      Math.abs(pixels[index + 3] - target[3]) <= tolerance
    ) {
      return true;
    }
  }
  return false;
}
