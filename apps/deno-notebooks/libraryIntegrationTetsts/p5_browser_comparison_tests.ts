/// <reference lib="dom" />

// Run from apps/deno-notebooks:
// deno run --unstable-webgpu --unstable-ffi --allow-ffi --allow-read --allow-env --allow-write --allow-run \
//   libraryIntegrationTetsts/p5_browser_comparison_tests.ts

import { P5GPU } from "../tools/p5gpu.ts";
import {
  requestWebGpuDevice,
  writeTextureToPng,
} from "./raw-webgpu-helpers.ts";
import type { TestSketch } from "./p5_test_sketches.ts";
import { P5_TEST_SKETCHES } from "./p5_test_sketches.ts";
import { comparePngFiles } from "./compare_renders.ts";

const OUTPUT_ROOT = ".output";
const BROWSER_REFERENCE_DIR = `${OUTPUT_ROOT}/browser`;
const GPU_DIR = `${OUTPUT_ROOT}/p5gpu`;
const DIFF_DIR = `${OUTPUT_ROOT}/browser_diffs`;
const ANALYSIS_DIR = `${OUTPUT_ROOT}/browser_analysis`;
const BROWSER_SERVER_URL = Deno.env.get("P5_BROWSER_SERVER_URL") ??
  "http://localhost:9222";
const GPU_FONT_FILES = [
  "NotoSans-Regular.ttf",
  "Inter-Regular.ttf",
  "Inter-Bold.ttf",
  "InterVariable.ttf",
  "InterVariable-Italic.ttf",
  "RobotoFlex-Variable.ttf",
] as const;

const MAX_PHASE = Number(Deno.env.get("P5GPU_MAX_PHASE") ?? 1);
const NAME_FILTER = Deno.env.get("P5GPU_NAME_FILTER")?.trim() ?? "";
const RMSE_THRESHOLD = Number(Deno.env.get("P5GPU_RMSE_THRESHOLD") ?? 8.0);
const MAX_ERROR_THRESHOLD = Number(
  Deno.env.get("P5GPU_MAX_ERROR_THRESHOLD") ?? 255,
);
const DIFF_RATIO_THRESHOLD = Number(
  Deno.env.get("P5GPU_DIFF_RATIO_THRESHOLD") ?? 0.05,
);
const TEXT_RMSE_THRESHOLD = Number(
  Deno.env.get("P5GPU_TEXT_RMSE_THRESHOLD") ?? 50.0,
);
const TEXT_MAX_ERROR_THRESHOLD = Number(
  Deno.env.get("P5GPU_TEXT_MAX_ERROR_THRESHOLD") ?? 255,
);
const TEXT_DIFF_RATIO_THRESHOLD = Number(
  Deno.env.get("P5GPU_TEXT_DIFF_RATIO_THRESHOLD") ?? 0.25,
);
const RUN_TAG = Deno.env.get("P5_BROWSER_RUN_TAG")?.trim() ?? "";
const WRITE_RUN_LOG = Deno.env.get("P5_BROWSER_WRITE_RUN_LOG") !== "0";
const SKIP_BROWSER_RENDER = Deno.env.get("P5_BROWSER_SKIP_RENDER") === "1";

interface TextStats {
  hits: number;
  misses: number;
  uploads: number;
  bytesUploaded: number;
  grows: number;
  clears: number;
}

interface SketchResult {
  name: string;
  rmse: number;
  maxError: number;
  diffPixels: number;
  totalPixels: number;
  diffRatio: number;
  thresholds: {
    rmse: number;
    maxError: number;
    diffRatio: number;
  };
  textStats: TextStats;
  pass: boolean;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function homeDir(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (!home) throw new Error("HOME/USERPROFILE is not set");
  return home;
}

async function detectNodeBin(): Promise<string> {
  const override = Deno.env.get("P5_BROWSER_NODE_BIN");
  if (override && override.trim().length > 0) return override;

  const home = homeDir();
  const versionsDir = `${home}/.nvm/versions/node`;
  try {
    const versions: string[] = [];
    for await (const entry of Deno.readDir(versionsDir)) {
      if (!entry.isDirectory || !entry.name.startsWith("v")) continue;
      versions.push(entry.name);
    }
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) {
      const candidate = `${versionsDir}/${version}/bin/node`;
      try {
        await Deno.stat(candidate);
        return candidate;
      } catch {
        // continue
      }
    }
  } catch {
    // fall back to PATH lookup
  }

  return "node";
}

async function isBrowserServerReady(): Promise<boolean> {
  try {
    const res = await fetch(BROWSER_SERVER_URL, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureBrowserServerRunning(): Promise<void> {
  if (await isBrowserServerReady()) {
    console.log(
      `[browser] dev-browser server already running at ${BROWSER_SERVER_URL}`,
    );
    return;
  }

  const realHome = homeDir();
  const skillDir = `${realHome}/.codex/skills/dev-browser`;
  const nodeBin = await detectNodeBin();
  const tsxPkgPathAbs = `${skillDir}/node_modules/tsx`;
  const startServerScriptRel = "scripts/start-server.ts";
  const npmBinCandidate = nodeBin.endsWith("/node")
    ? `${nodeBin.slice(0, -4)}npm`
    : "npm";
  const logPath = `${Deno.cwd()}/${BROWSER_REFERENCE_DIR}/dev-browser-server.log`;
  const runtimeHome = `${Deno.cwd()}/${BROWSER_REFERENCE_DIR}/runtime-home`;
  await Deno.mkdir(BROWSER_REFERENCE_DIR, { recursive: true });
  await Deno.mkdir(runtimeHome, { recursive: true });
  const browserEnv = {
    ...Deno.env.toObject(),
    HOME: runtimeHome,
    USERPROFILE: runtimeHome,
    PLAYWRIGHT_BROWSERS_PATH: `${realHome}/Library/Caches/ms-playwright`,
  };

  try {
    await Deno.stat(tsxPkgPathAbs);
  } catch {
    console.log(
      `[browser] installing dev-browser dependencies in ${skillDir}...`,
    );
    const install = await new Deno.Command(npmBinCandidate, {
      args: ["install"],
      cwd: skillDir,
      env: Deno.env.toObject(),
    }).output();
    if (install.code !== 0) {
      throw new Error(
        `npm install failed: ${new TextDecoder().decode(install.stderr)}`,
      );
    }
  }

  const command = `${shellQuote(nodeBin)} --import tsx ${
    shellQuote(startServerScriptRel)
  } > ${shellQuote(logPath)} 2>&1 &`;
  console.log(
    `[browser] starting dev-browser server with ${skillDir}/${startServerScriptRel}`,
  );
  const start = await new Deno.Command("bash", {
    args: ["-lc", command],
    cwd: skillDir,
    env: browserEnv,
  }).output();
  if (start.code !== 0) {
    throw new Error(
      `Failed to launch dev-browser server: ${
        new TextDecoder().decode(start.stderr)
      }`,
    );
  }

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await isBrowserServerReady()) {
      console.log(
        `[browser] dev-browser server is ready (${BROWSER_SERVER_URL})`,
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `Timed out waiting for dev-browser server at ${BROWSER_SERVER_URL}. Check ${logPath}`,
  );
}

async function renderBrowserReferences(sketches: TestSketch[]): Promise<void> {
  if (sketches.length === 0) return;

  const skillDir = `${homeDir()}/.codex/skills/dev-browser`;
  const rendererPath = decodeURIComponent(
    new URL("./browser_render_references.ts", import.meta.url).pathname,
  );
  const nodeBin = await detectNodeBin();
  const env = {
    ...Deno.env.toObject(),
    P5_BROWSER_OUT_DIR: BROWSER_REFERENCE_DIR,
    P5_BROWSER_SERVER_URL: BROWSER_SERVER_URL,
    P5_BROWSER_SKETCH_NAMES: JSON.stringify(sketches.map((s) => s.name)),
  };

  console.log(
    `[browser] rendering ${sketches.length} reference sketch(es) in Chrome via ${nodeBin}...`,
  );
  const proc = await new Deno.Command(nodeBin, {
    args: ["--import", "tsx", rendererPath],
    env,
    cwd: skillDir,
  }).output();

  const stdout = new TextDecoder().decode(proc.stdout).trim();
  const stderr = new TextDecoder().decode(proc.stderr).trim();
  if (stdout.length > 0) console.log(stdout);
  if (stderr.length > 0) console.log(stderr);

  if (proc.code !== 0) {
    throw new Error(
      `Browser reference renderer failed with exit code ${proc.code}`,
    );
  }
}

function thresholdsForSketch(sketch: TestSketch): {
  rmse: number;
  maxError: number;
  diffRatio: number;
} {
  if (sketch.name.startsWith("text-")) {
    return {
      rmse: TEXT_RMSE_THRESHOLD,
      maxError: TEXT_MAX_ERROR_THRESHOLD,
      diffRatio: TEXT_DIFF_RATIO_THRESHOLD,
    };
  }
  return {
    rmse: RMSE_THRESHOLD,
    maxError: MAX_ERROR_THRESHOLD,
    diffRatio: DIFF_RATIO_THRESHOLD,
  };
}

async function renderGpu(
  sketch: TestSketch,
  device: GPUDevice,
  outPath: string,
): Promise<TextStats> {
  const p5gpu = new P5GPU(device, {
    width: sketch.width,
    height: sketch.height,
  });

  try {
    for (const fontFile of GPU_FONT_FILES) {
      const fontPath = `${Deno.cwd()}/assets/fonts/${fontFile}`;
      try {
        await p5gpu.loadFont(fontPath);
      } catch (err) {
        console.warn(`[p5gpu] skipping font ${fontFile}: ${String(err)}`);
      }
    }
    p5gpu.beginFrame();
    sketch.draw(p5gpu as never);
    const texture = p5gpu.endFrame();
    await writeTextureToPng(
      device,
      texture,
      sketch.width,
      sketch.height,
      p5gpu.format,
      outPath,
    );
    return p5gpu.textStats();
  } finally {
    p5gpu.dispose();
  }
}

async function runOne(
  sketch: TestSketch,
  device: GPUDevice,
): Promise<SketchResult> {
  const referencePath = `${BROWSER_REFERENCE_DIR}/${sketch.name}.png`;
  const gpuPath = `${GPU_DIR}/${sketch.name}.png`;
  const diffPath = `${DIFF_DIR}/${sketch.name}.png`;

  console.log(`\n[${sketch.name}] rendering p5gpu...`);
  const textStats = await renderGpu(sketch, device, gpuPath);
  if (textStats.uploads > 0 || textStats.hits > 0 || textStats.misses > 0) {
    console.log(
      `[${sketch.name}] text stats: hits=${textStats.hits} misses=${textStats.misses} uploads=${textStats.uploads} bytes=${textStats.bytesUploaded} grows=${textStats.grows} clears=${textStats.clears}`,
    );
  }

  console.log(`[${sketch.name}] comparing against browser baseline...`);
  const stats = await comparePngFiles(referencePath, gpuPath, diffPath, {
    pixelThreshold: 3,
    diffAmplify: 4,
  });

  const thresholds = thresholdsForSketch(sketch);
  const diffRatio = stats.diffPixels / Math.max(1, stats.totalPixels);
  const pass = stats.rmse <= thresholds.rmse &&
    stats.maxError <= thresholds.maxError &&
    diffRatio <= thresholds.diffRatio;

  return {
    name: sketch.name,
    rmse: stats.rmse,
    maxError: stats.maxError,
    diffPixels: stats.diffPixels,
    totalPixels: stats.totalPixels,
    diffRatio,
    thresholds,
    textStats,
    pass,
  };
}

function formatResultLine(result: SketchResult): string {
  const diffPct = result.diffRatio * 100;
  const status = result.pass ? "PASS" : "FAIL";
  return `${result.name.padEnd(24)} RMSE=${
    result.rmse.toFixed(2).padStart(6)
  }  max=${String(result.maxError).padStart(3)}  diff=${
    diffPct
      .toFixed(2)
      .padStart(6)
  }%  ${status}`;
}

function fileSafeTag(tag: string): string {
  return tag.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

function timestampForFile(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function writeRunAnalysisLog(
  sketches: TestSketch[],
  results: SketchResult[],
  passCount: number,
  failCount: number,
): Promise<void> {
  if (!WRITE_RUN_LOG) return;

  await Deno.mkdir(ANALYSIS_DIR, { recursive: true });
  const now = new Date();
  const tag = RUN_TAG ? `_${fileSafeTag(RUN_TAG)}` : "";
  const outPath = `${ANALYSIS_DIR}/run_${timestampForFile(now)}${tag}.json`;
  const payload = {
    timestamp: now.toISOString(),
    runTag: RUN_TAG,
    settings: {
      maxPhase: MAX_PHASE,
      nameFilter: NAME_FILTER,
      thresholds: {
        default: {
          rmse: RMSE_THRESHOLD,
          maxError: MAX_ERROR_THRESHOLD,
          diffRatio: DIFF_RATIO_THRESHOLD,
        },
        text: {
          rmse: TEXT_RMSE_THRESHOLD,
          maxError: TEXT_MAX_ERROR_THRESHOLD,
          diffRatio: TEXT_DIFF_RATIO_THRESHOLD,
        },
      },
      browserReferenceSettings: {
        extraFontReadyPasses: Deno.env.get("P5_BROWSER_EXTRA_FONT_READY_PASSES") ?? "2",
        extraStabilizeFrames: Deno.env.get("P5_BROWSER_EXTRA_STABILIZE_FRAMES") ?? "2",
        postDrawDelayMs: Deno.env.get("P5_BROWSER_POST_DRAW_DELAY_MS") ?? "0",
        fontWarmupEnabled: Deno.env.get("P5_BROWSER_ENABLE_FONT_WARMUP") ?? "1",
      },
    },
    sketches: sketches.map((sketch) => ({
      name: sketch.name,
      phase: sketch.phase,
      width: sketch.width,
      height: sketch.height,
    })),
    summary: {
      passCount,
      failCount,
      total: results.length,
    },
    results,
  };
  await Deno.writeTextFile(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`[analysis] wrote run log: ${outPath}`);
}

async function main(): Promise<void> {
  await Promise.all([
    Deno.mkdir(BROWSER_REFERENCE_DIR, { recursive: true }),
    Deno.mkdir(GPU_DIR, { recursive: true }),
    Deno.mkdir(DIFF_DIR, { recursive: true }),
    Deno.mkdir(ANALYSIS_DIR, { recursive: true }),
  ]);

  let sketches = P5_TEST_SKETCHES.filter((sketch) => sketch.phase <= MAX_PHASE);
  if (NAME_FILTER) {
    const re = new RegExp(NAME_FILTER);
    sketches = sketches.filter((sketch) => re.test(sketch.name));
  }

  if (sketches.length === 0) {
    throw new Error(
      `No test sketches selected for phase ${MAX_PHASE}${
        NAME_FILTER ? ` and filter /${NAME_FILTER}/` : ""
      }`,
    );
  }

  console.log(
    `Running ${sketches.length} sketch(es) for phase <= ${MAX_PHASE}${
      NAME_FILTER ? ` and filter /${NAME_FILTER}/` : ""
    }`,
  );

  if (SKIP_BROWSER_RENDER) {
    console.log("[browser] skipping browser render and reusing existing reference PNGs");
    for (const sketch of sketches) {
      const refPath = `${BROWSER_REFERENCE_DIR}/${sketch.name}.png`;
      try {
        await Deno.stat(refPath);
      } catch {
        throw new Error(
          `Missing browser reference for ${sketch.name}: ${refPath}. ` +
            "Run once without P5_BROWSER_SKIP_RENDER=1 to generate it.",
        );
      }
    }
  } else {
    await ensureBrowserServerRunning();
    await renderBrowserReferences(sketches);
  }

  const device = await requestWebGpuDevice();
  const results: SketchResult[] = [];

  try {
    for (const sketch of sketches) {
      const result = await runOne(sketch, device);
      results.push(result);
      console.log(formatResultLine(result));
    }
  } finally {
    try {
      device.destroy();
    } catch {
      // ignore
    }
  }

  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;

  console.log("\n── Results ──");
  for (const result of results) {
    console.log(formatResultLine(result));
  }
  console.log(
    `\nThresholds (default): RMSE<=${RMSE_THRESHOLD}, max<=${MAX_ERROR_THRESHOLD}, diffRatio<=${
      (DIFF_RATIO_THRESHOLD * 100).toFixed(2)
    }%`,
  );
  console.log(
    `Thresholds (text-*): RMSE<=${TEXT_RMSE_THRESHOLD}, max<=${TEXT_MAX_ERROR_THRESHOLD}, diffRatio<=${
      (TEXT_DIFF_RATIO_THRESHOLD * 100).toFixed(2)
    }%`,
  );
  console.log(`Summary: ${passCount}/${results.length} passed`);
  await writeRunAnalysisLog(sketches, results, passCount, failCount);

  if (failCount > 0) {
    Deno.exitCode = 1;
  }
}

await main();
