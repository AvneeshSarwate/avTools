import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${address.port}/tests/syncRendering.html`);
  await page.waitForFunction(
    () => window.__renderTests,
    {},
    { timeout: 30000 },
  );
  const result = await page.evaluate(() => window.__renderTests);
  if (!result.ok || errors.length)
    throw new Error(JSON.stringify({ result, errors }, null, 2));
  console.log(
    `React entity subscriptions: ${result.assertions} assertions passed across all nine kinds.`,
  );
} finally {
  await browser?.close();
  await server.close();
}
