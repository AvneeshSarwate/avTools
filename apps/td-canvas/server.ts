import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, extname} from 'node:path';
import {attachRelay} from './relay.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT ?? 5177);
const production = process.argv.includes('--production');
const vite = production ? undefined : await (await import('vite')).createServer({
  root, configFile: resolve(root, 'vite.config.ts'), server: {middlewareMode: true},
});
const server = createServer((request, response) => {
  if (vite) { vite.middlewares(request, response); return; }
  void (async () => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const path = resolve(root, 'dist', '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(resolve(root, 'dist') + '/')) { response.writeHead(403).end(); return; }
    try {
      const mime: Record<string, string> = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'};
      response.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
      response.end(await readFile(path));
    } catch { response.writeHead(404).end('Not found'); }
  })().catch(() => response.writeHead(400).end());
});
const close = await attachRelay(server, resolve(root, '.data'), port);
server.listen(port, '127.0.0.1', () => console.log(`TD Canvas: http://127.0.0.1:${port}`));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await close(); await vite?.close(); server.close();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
