// Serves the bundled bench and runs it in Chrome via Playwright; prints the
// page's log. Env: OUT (bundle dir), HEADED (non-empty for a window), QUERY.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const require = createRequire(
  join(process.cwd(), "../../../livecode-tldraw/package.json"),
);
const { chromium } = require("playwright");
const out = process.env.OUT;
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
};
const server = createServer(async (req, res) => {
  const route = req.url.split("?")[0];
  const path = join(out, route === "/" ? "index.html" : route);
  try {
    const body = await readFile(path);
    res.writeHead(200, {
      "content-type": types[extname(path)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const browser = await chromium.launch({
  channel: "chrome",
  headless: !process.env.HEADED,
  args: [
    "--enable-unsafe-webgpu",
    "--ignore-gpu-blocklist",
    "--enable-features=WebGPUDeveloperFeatures",
  ],
});
const page = await browser.newPage();
page.on(
  "console",
  (m) =>
    console.log(m.type() === "log" ? m.text() : `${m.type()}: ${m.text()}`),
);
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(`http://127.0.0.1:${port}/?${process.env.QUERY ?? ""}`);
try {
  await page.waitForFunction(() => window.__result !== undefined, null, {
    timeout: 120000,
  });
} catch {
  console.log("TIMEOUT: the page did not finish");
  process.exitCode = 1;
}
await browser.close();
server.close();
