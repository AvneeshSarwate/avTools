// The module helper import map exists twice on purpose: in the engine page
// (engine.html, built from MODULE_IMPORT_MAP) and in the tldraw client's
// index.html (for the in-process engine, prefixed `./engine/`). A module that
// resolves in one embedder but not the other would fail only at launch time
// inside a browser, so keep the copies identical here.

import { assertEquals } from "jsr:@std/assert@1";
import { fromFileUrl } from "jsr:@std/path@1";
import { MODULE_IMPORT_MAP } from "../browser_host/build_host_assets.ts";

const CLIENT_INDEX_HTML = fromFileUrl(
  new URL("../../../livecode-tldraw/index.html", import.meta.url),
);

Deno.test("client index.html import map mirrors the engine host's", async () => {
  const html = await Deno.readTextFile(CLIENT_INDEX_HTML);
  const match = html.match(
    /<script type="importmap">\s*([\s\S]*?)\s*<\/script>/,
  );
  if (!match) throw new Error('index.html has no <script type="importmap">');
  const parsed = JSON.parse(match[1]) as { imports: Record<string, string> };
  const expected = Object.fromEntries(
    Object.entries(MODULE_IMPORT_MAP).map(([specifier, file]) => [
      specifier,
      `./engine/${file}`,
    ]),
  );
  assertEquals(parsed.imports, expected);
});

Deno.test("import map must precede the module script", async () => {
  const html = await Deno.readTextFile(CLIENT_INDEX_HTML);
  const importMapAt = html.indexOf('<script type="importmap">');
  const moduleAt = html.indexOf('<script type="module"');
  if (importMapAt < 0 || moduleAt < 0 || importMapAt > moduleAt) {
    throw new Error(
      "the import map must appear before the module script or the browser ignores it",
    );
  }
});
