import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const server = createServer();
await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
const { port } = server.address();
await new Promise((resolveClosed) => server.close(resolveClosed));

const child = spawn(resolve(appRoot, 'node_modules/.bin/wrangler'), [
  'dev', '--remote', '--config', 'tools/remote-diagnostics/wrangler.jsonc',
  '--ip', '127.0.0.1', '--port', String(port),
], {
  cwd: appRoot,
  env: { ...process.env, WRANGLER_LOG_PATH: resolve(appRoot, '.wrangler/logs') },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let logs = '';
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (chunk) => { logs += chunk.toString(); });
}

try {
  const deadline = Date.now() + 90_000;
  while (!logs.includes(`Ready on http://127.0.0.1:${port}`)) {
    if (child.exitCode !== null) throw new Error(`Wrangler exited:\n${logs}`);
    if (Date.now() > deadline) throw new Error(`Wrangler preview timed out:\n${logs}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  const path = process.argv.includes('--restart-boot') ? '/restart-boot'
    : process.argv.includes('--stop-boot') ? '/stop-boot'
    : process.argv.includes('--retry') ? '/retry'
    : process.argv.includes('--processes') ? '/processes'
    : process.argv.includes('--wake') ? '/wake' : '/';
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: ['/restart-boot', '/stop-boot', '/retry'].includes(path) ? 'POST' : 'GET',
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.text();
  if (!response.ok && path === '/') throw new Error(`Diagnostic request failed (${response.status}): ${body}`);
  console.log(JSON.stringify({ status: response.status, body: JSON.parse(body) }, null, 2));
} finally {
  child.kill('SIGTERM');
}
