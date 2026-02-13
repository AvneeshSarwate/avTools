import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

type DrawFn = (p: unknown) => void;

type TestSketch = {
  name: string;
  phase: number;
  width: number;
  height: number;
  draw: DrawFn;
};

type DevBrowserClient = {
  page: (
    name: string,
    options?: { viewport?: { width: number; height: number } },
  ) => Promise<{
    goto: (url: string) => Promise<void>;
    setContent: (html: string) => Promise<void>;
    addStyleTag: (opts: { content: string }) => Promise<void>;
    addScriptTag: (opts: { path: string }) => Promise<void>;
    evaluate: <T>(
      fn: (...args: unknown[]) => T | Promise<T>,
      arg?: unknown,
    ) => Promise<T>;
    locator: (selector: string) => {
      first: () => {
        waitFor: (
          opts?: {
            state?: "visible" | "attached" | "detached" | "hidden";
            timeout?: number;
          },
        ) => Promise<void>;
        screenshot: (opts: { path: string }) => Promise<void>;
      };
    };
    setViewportSize: (size: { width: number; height: number }) => Promise<void>;
  }>;
  disconnect: () => Promise<void>;
};

function resolvePaths() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const notebooksRoot = path.resolve(scriptDir, "..");
  const repoRoot = path.resolve(notebooksRoot, "..", "..");
  const home = process.env.HOME ?? process.env.USERPROFILE;

  if (!home) {
    throw new Error(
      "HOME/USERPROFILE is not set; cannot locate dev-browser skill",
    );
  }

  return {
    notebooksRoot,
    repoRoot,
    home,
    p5SketchesPath: path.join(
      notebooksRoot,
      "libraryIntegrationTetsts",
      "p5_test_sketches.ts",
    ),
    p5BundlePath: path.join(
      repoRoot,
      "clonedCompanionRepos",
      "p5.js",
      "lib",
      "p5.min.js",
    ),
    fontsDir: path.join(notebooksRoot, "assets", "fonts"),
    devBrowserClientPath: path.join(
      home,
      ".codex",
      "skills",
      "dev-browser",
      "src",
      "client.ts",
    ),
  };
}

async function loadSketches(sketchesPath: string): Promise<TestSketch[]> {
  const mod = await import(pathToFileURL(sketchesPath).href);
  const sketches =
    (mod as { P5_TEST_SKETCHES?: TestSketch[] }).P5_TEST_SKETCHES;
  if (!Array.isArray(sketches)) {
    throw new Error(`Expected P5_TEST_SKETCHES export from ${sketchesPath}`);
  }
  return sketches;
}

async function loadDevBrowserClient(devBrowserClientPath: string): Promise<{
  connect: (serverUrl?: string) => Promise<DevBrowserClient>;
  waitForPageLoad: (
    page: unknown,
    options?: { timeout?: number },
  ) => Promise<unknown>;
}> {
  return import(pathToFileURL(devBrowserClientPath).href) as Promise<{
    connect: (serverUrl?: string) => Promise<DevBrowserClient>;
    waitForPageLoad: (
      page: unknown,
      options?: { timeout?: number },
    ) => Promise<unknown>;
  }>;
}

function selectSketches(sketches: TestSketch[]): TestSketch[] {
  const explicitNamesRaw = process.env.P5_BROWSER_SKETCH_NAMES;
  if (explicitNamesRaw && explicitNamesRaw.trim().length > 0) {
    let names: string[];
    try {
      names = JSON.parse(explicitNamesRaw) as string[];
    } catch (err) {
      throw new Error(
        `P5_BROWSER_SKETCH_NAMES is not valid JSON: ${String(err)}`,
      );
    }
    const wanted = new Set(names);
    return sketches.filter((s) => wanted.has(s.name));
  }

  const maxPhase = Number(process.env.P5GPU_MAX_PHASE ?? 1);
  const nameFilter = process.env.P5GPU_NAME_FILTER?.trim() ?? "";

  let filtered = sketches.filter((s) => s.phase <= maxPhase);
  if (nameFilter) {
    const re = new RegExp(nameFilter);
    filtered = filtered.filter((s) => re.test(s.name));
  }
  return filtered;
}

async function buildFontCss(fontsDir: string): Promise<string> {
  const specs: Array<
    { file: string; family: string; weight: string; style: string }
  > = [
    {
      file: "NotoSans-Regular.ttf",
      family: "Noto Sans",
      weight: "400",
      style: "normal",
    },
    {
      file: "Inter-Regular.ttf",
      family: "Inter",
      weight: "400",
      style: "normal",
    },
    { file: "Inter-Bold.ttf", family: "Inter", weight: "700", style: "normal" },
    {
      file: "InterVariable.ttf",
      family: "Inter Variable",
      weight: "100 900",
      style: "normal",
    },
    {
      file: "InterVariable-Italic.ttf",
      family: "Inter Variable",
      weight: "100 900",
      style: "italic",
    },
  ];

  let css = "";
  for (const spec of specs) {
    const fullPath = path.join(fontsDir, spec.file);
    try {
      const bytes = await readFile(fullPath);
      const base64 = bytes.toString("base64");
      css += `\n@font-face {\n`;
      css += `  font-family: '${spec.family}';\n`;
      css += `  src: url(data:font/ttf;base64,${base64}) format('truetype');\n`;
      css += `  font-weight: ${spec.weight};\n`;
      css += `  font-style: ${spec.style};\n`;
      css += `  font-display: block;\n`;
      css += `}\n`;
    } catch (err) {
      console.warn(`Skipping font ${spec.file}: ${String(err)}`);
    }
  }

  css +=
    `\nhtml, body { margin: 0; padding: 0; overflow: hidden; background: transparent; }\n`;
  css += `canvas { display: block; }\n`;
  return css;
}

function normalizeDrawSource(source: string): string {
  const trimmed = source.trim();
  let normalized = trimmed;
  if (normalized.startsWith("draw(")) {
    normalized = `function ${normalized}`;
  }
  normalized = normalized.replace(/__name\\d*/g, "__name");
  return normalized;
}

async function renderSketchToPng(
  page: Awaited<ReturnType<DevBrowserClient["page"]>>,
  p5BundlePath: string,
  fontCss: string,
  sketch: TestSketch,
  outPath: string,
): Promise<void> {
  await page.setViewportSize({ width: sketch.width, height: sketch.height });
  await page.goto("about:blank");
  await page.setContent(
    "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
  );
  await page.addStyleTag({ content: fontCss });
  await page.addScriptTag({ path: p5BundlePath });

  const drawSource = normalizeDrawSource(sketch.draw.toString());
  if (process.env.P5_BROWSER_DEBUG_SOURCE === "1") {
    console.log(
      `[browser] draw source (${sketch.name}): ${drawSource.slice(0, 600)}`,
    );
  }

  const browserScript = `
    (async () => {
      const g = globalThis;
      const previous = g.__p5Instance;
      if (previous && typeof previous.remove === "function") {
        previous.remove();
      }

      if (typeof g.p5 !== "function") {
        throw new Error("p5 is not available on window after script injection");
      }

      if (document.fonts && typeof document.fonts.load === "function") {
        const requiredFonts = [
          "400 16px 'Noto Sans'",
          "400 16px 'Inter'",
          "700 16px 'Inter'",
          "300 16px 'Inter Variable'",
          "450 16px 'Inter Variable'",
          "600 16px 'Inter Variable'",
          "750 16px 'Inter Variable'",
          "850 16px 'Inter Variable'",
          "900 16px 'Inter Variable'",
          "italic 700 16px 'Inter Variable'",
          "italic 850 16px 'Inter Variable'",
          "italic 900 16px 'Inter Variable'",
        ];
        await Promise.all(
          requiredFonts.map((desc) => document.fonts.load(desc, "BESbswy")),
        );
      }
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }

      const __name = (target, _value) => target;
      const drawSource = ${JSON.stringify(drawSource)};
      const drawFn = eval("(" + drawSource + ")");

      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (err) => {
          if (settled) return;
          settled = true;
          if (err) reject(err);
          else resolve();
        };

        const timeout = setTimeout(() => {
          finish(new Error("Timed out waiting for p5 draw()"));
        }, 15000);

        try {
          g.__p5Instance = new g.p5((p) => {
            if (typeof p.curveTightness !== "function") {
              p.curveTightness = () => {};
            }
            if (typeof p.fontWidth !== "function") {
              p.fontWidth = (text) => p.textWidth(text);
            }
            if (typeof p.fontAscent !== "function") {
              p.fontAscent = () => p.textAscent("Mg");
            }
            if (typeof p.fontDescent !== "function") {
              p.fontDescent = () => p.textDescent("Mg");
            }

            p.setup = () => {
              p.pixelDensity(1);
              p.createCanvas(${sketch.width}, ${sketch.height});
              p.noLoop();
            };
            p.draw = () => {
              try {
                drawFn(p);
                requestAnimationFrame(() => {
                  clearTimeout(timeout);
                  finish();
                });
              } catch (err) {
                clearTimeout(timeout);
                finish(err);
              }
            };
          }, document.body);
        } catch (err) {
          clearTimeout(timeout);
          finish(err);
        }
      });
    })();
  `;

  await page.evaluate(browserScript);

  const canvas = page.locator("canvas").first();
  await canvas.waitFor({ state: "visible", timeout: 5000 });
  await canvas.screenshot({ path: outPath });
}

async function main(): Promise<void> {
  const paths = resolvePaths();
  const outDir = path.resolve(
    paths.notebooksRoot,
    process.env.P5_BROWSER_OUT_DIR ?? ".output/browser",
  );

  const sketches = await loadSketches(paths.p5SketchesPath);
  const selected = selectSketches(sketches);
  if (selected.length === 0) {
    throw new Error("No sketches selected for browser rendering");
  }

  await mkdir(outDir, { recursive: true });

  const { connect, waitForPageLoad } = await loadDevBrowserClient(
    paths.devBrowserClientPath,
  );
  const client = await connect(
    process.env.P5_BROWSER_SERVER_URL ?? "http://localhost:9222",
  );
  const page = await client.page("p5-browser-reference", {
    viewport: { width: selected[0]!.width, height: selected[0]!.height },
  });

  try {
    await waitForPageLoad(page, { timeout: 8000 });
    const fontCss = await buildFontCss(paths.fontsDir);

    for (const sketch of selected) {
      const outPath = path.join(outDir, `${sketch.name}.png`);
      console.log(`[browser] rendering ${sketch.name} -> ${outPath}`);
      await renderSketchToPng(
        page,
        paths.p5BundlePath,
        fontCss,
        sketch,
        outPath,
      );
    }
  } finally {
    await client.disconnect();
  }

  console.log(`[browser] rendered ${selected.length} sketches`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
