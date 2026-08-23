import { assert, assertEquals } from "jsr:@std/assert@1";
import { fromFileUrl, join } from "jsr:@std/path@1";
import { createLivecodeVisualizerServer } from "../visualizer/server.ts";

// The Run gate is target-aware: a project whose manifest declares
// `engineTarget: "browser"` (or that is opened by a `--engine remote` server,
// where that is the default) shadow-typechecks under the browser lib — DOM
// globals legal, a reachable `Deno.*` the type error it would be at runtime —
// while a deno-target project keeps today's check exactly. Both directions are
// asserted so neither lib silently widens.

const DOM_MODULE = `export default async function run(_ctx: TimeContext) {
  console.log(document.title);
}
type TimeContext = import("@avtools/core-timing").TimeContext;
`;

const DENO_MODULE = `export default async function run(_ctx: TimeContext) {
  console.log(Deno.cwd());
}
type TimeContext = import("@avtools/core-timing").TimeContext;
`;

interface DiagnosticsResult {
  success: boolean;
  output: string;
}

async function makeProject(
  root: string,
  engineTarget: "deno" | "browser" | undefined,
  moduleSource: string,
): Promise<void> {
  await Deno.mkdir(join(root, "modules"), { recursive: true });
  await Deno.writeTextFile(join(root, "modules", "main.orig.ts"), moduleSource);
  const manifest: Record<string, unknown> = {
    version: 1,
    name: "target-test",
    modules: [{
      id: "modules/main.ts",
      path: "modules/main.ts",
      sourcePath: "modules/main.orig.ts",
      runtimePath: "modules/main.ts",
      kind: "runnable",
      title: "main",
      sourceVersion: 1,
    }],
  };
  if (engineTarget) manifest.engineTarget = engineTarget;
  await Deno.writeTextFile(
    join(root, "project.avtools-livecode.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

async function checkProject(
  baseUrl: string,
  root: string,
): Promise<DiagnosticsResult> {
  const open = await fetch(`${baseUrl}/project/open`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectPath: root }),
  });
  const opened = await open.json();
  assert(opened.ok, `project open failed: ${JSON.stringify(opened)}`);
  const response = await fetch(`${baseUrl}/project/diagnostics`);
  const body = await response.json();
  return { success: body.denoCheck.success, output: body.denoCheck.output };
}


// Repo-local like the real server's default sessionRoot — deliberately NOT OS
// temp: deno 2.8's "config must be a workspace member" rule only bites for
// paths inside the repo tree, and these tests must fail if the browser check
// config ever moves back into the session dir.
async function makeRepoLocalSessionRoot(prefix: string): Promise<string> {
  const parent = fromFileUrl(
    new URL("../../.avtools-livecode-sessions", import.meta.url),
  );
  await Deno.mkdir(parent, { recursive: true });
  return await Deno.makeTempDir({ dir: parent, prefix });
}

Deno.test("shadow check follows the manifest engineTarget", async () => {
  const sessionRoot = await makeRepoLocalSessionRoot(
    "browser-target-project-",
  );
  const server = await createLivecodeVisualizerServer({
    host: "127.0.0.1",
    port: 0,
    sessionRoot,
  });
  try {
    // browser target: DOM passes, Deno fails
    const browserDomRoot = join(sessionRoot, "browser-dom");
    await makeProject(browserDomRoot, "browser", DOM_MODULE);
    const browserDom = await checkProject(server.baseUrl, browserDomRoot);
    assert(
      browserDom.success,
      `DOM module should pass a browser-target check:\n${browserDom.output}`,
    );

    const browserDenoRoot = join(sessionRoot, "browser-deno");
    await makeProject(browserDenoRoot, "browser", DENO_MODULE);
    const browserDeno = await checkProject(server.baseUrl, browserDenoRoot);
    assertEquals(
      browserDeno.success,
      false,
      "Deno-global module must fail a browser-target check",
    );
    assert(
      browserDeno.output.includes("Cannot find name 'Deno'"),
      `expected a missing-Deno diagnostic:\n${browserDeno.output}`,
    );

    // deno target (and the local-mode default when the field is absent):
    // Deno passes, DOM fails
    const denoDenoRoot = join(sessionRoot, "deno-deno");
    await makeProject(denoDenoRoot, undefined, DENO_MODULE);
    const denoDeno = await checkProject(server.baseUrl, denoDenoRoot);
    assert(
      denoDeno.success,
      `Deno-global module should pass the default local check:\n${denoDeno.output}`,
    );

    const denoDomRoot = join(sessionRoot, "deno-dom");
    await makeProject(denoDomRoot, "deno", DOM_MODULE);
    const denoDom = await checkProject(server.baseUrl, denoDomRoot);
    assertEquals(
      denoDom.success,
      false,
      "DOM-global module must fail a deno-target check",
    );
  } finally {
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true }).catch(() => {});
  }
});

Deno.test("a remote-mode server defaults projects to the browser target", async () => {
  const sessionRoot = await makeRepoLocalSessionRoot(
    "browser-target-remote-",
  );
  // No engine tab is needed: diagnostics are entirely server-side.
  const server = await createLivecodeVisualizerServer({
    host: "127.0.0.1",
    port: 0,
    sessionRoot,
    engineMode: "remote",
  });
  try {
    const root = join(sessionRoot, "remote-default");
    await makeProject(root, undefined, DENO_MODULE);
    const result = await checkProject(server.baseUrl, root);
    assertEquals(
      result.success,
      false,
      "remote mode must check an untargeted project against the browser lib",
    );
    assert(result.output.includes("Cannot find name 'Deno'"));
  } finally {
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true }).catch(() => {});
  }
});
