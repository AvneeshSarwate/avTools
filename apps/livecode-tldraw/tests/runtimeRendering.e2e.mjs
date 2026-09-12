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
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(
    `http://127.0.0.1:${address.port}/tests/runtimeRendering.html`,
  );
  await page.waitForFunction(() => window.__runtimeRenderTests, {}, {
    timeout: 30_000,
  });
  const result = await page.evaluate(() => window.__runtimeRenderTests);
  if (!result.ok || errors.length) {
    throw new Error(JSON.stringify({ result, errors }, null, 2));
  }
  console.log(
    `Scoped runtime subscriptions: ${result.assertions} React commit assertions passed.`,
  );
} finally {
  await browser?.close();
  await server.close();
}
