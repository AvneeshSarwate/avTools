// One-time migration of legacy private R2 trees to packed checkpoints.
// All downloaded credential bytes stay in a mode-0700 temporary directory.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { restoreCredentials, saveCredentials } from '../container/credential-state.mjs';

const exec = promisify(execFile);
const bucketName = 'avtools-livecode-state';
const names = ['claude', 'codex', 'ssh'];
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = join(appRoot, 'node_modules/.bin/wrangler');
let previewChild;
async function startPreview() {
  if (process.env.LIVECODE_MIGRATION_PREVIEW) return process.env.LIVECODE_MIGRATION_PREVIEW;
  const server = createServer();
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  const { port } = server.address();
  await new Promise((closed) => server.close(closed));
  previewChild = spawn(wrangler, [
    'dev', '--remote', '--config', 'tools/migration-preview/wrangler.jsonc',
    '--ip', '127.0.0.1', '--port', String(port),
  ], {
    cwd: appRoot,
    env: { ...process.env, WRANGLER_LOG_PATH: join(appRoot, '.wrangler/logs') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  for (const stream of [previewChild.stdout, previewChild.stderr]) {
    stream.on('data', (chunk) => { logs += chunk.toString().slice(-4000); });
  }
  const deadline = Date.now() + 120_000;
  while (!logs.includes(`Ready on http://127.0.0.1:${port}`)) {
    if (previewChild.exitCode !== null) throw new Error(`Migration preview exited:\n${logs}`);
    if (Date.now() > deadline) throw new Error(`Migration preview timed out:\n${logs}`);
    await new Promise((wait) => setTimeout(wait, 250));
  }
  return `http://127.0.0.1:${port}`;
}
const preview = await startPreview();
if (!preview.startsWith('http://127.0.0.1:')) throw new Error('Unsafe migration preview URL');

async function request(url, options = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(60_000),
    }).catch((error) => {
      if (attempt === 4) throw error;
      return null;
    });
    if (response?.ok) return response;
    if (response && ![429, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(`Migration preview request failed (${response.status})`);
    }
    if (attempt === 4) throw new Error(`Migration preview retries exhausted (${response?.status ?? 'network'})`);
    await new Promise((done) => setTimeout(done, 400 * 2 ** attempt));
  }
}

async function list(name) {
  const objects = [];
  let cursor;
  do {
    const url = new URL('/list', preview);
    url.searchParams.set('name', name);
    if (cursor) url.searchParams.set('cursor', cursor);
    const result = await (await request(url)).json();
    objects.push(...result.objects);
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
  return objects;
}

function objectUrl(key) {
  const url = new URL('/object', preview);
  url.searchParams.set('key', key);
  return url;
}

function targetPath(object, root) {
  const relative = object.key.slice('livecode/'.length);
  const parts = relative.split('/');
  if (!relative || parts.some((part) => part === '.' || part === '..')) {
    throw new Error('Unsafe R2 object key');
  }
  if (!names.includes(parts[0])) throw new Error('Unexpected credential prefix');
  return join(root, `.${parts[0]}`, ...parts.slice(1));
}

async function download(object, root) {
  const target = targetPath(object, root);
  if (object.key.endsWith('/')) {
    await mkdir(target, { recursive: true, mode: 0o700 });
    return;
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const response = await request(objectUrl(object.key));
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target, { mode: 0o600 }));
  if ((await stat(target)).size !== object.size) throw new Error('R2 download size mismatch');
}

async function downloadBatch(objects, root) {
  const response = await request(new URL('/batch', preview), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: objects.map((object) => object.key) }),
  });
  const batch = (await response.json()).objects;
  if (batch.length !== objects.length) throw new Error('Incomplete R2 batch');
  for (let i = 0; i < objects.length; i++) {
    if (batch[i].key !== objects[i].key) throw new Error('R2 batch order mismatch');
    const target = targetPath(objects[i], root);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const bytes = Buffer.from(batch[i].data, 'base64');
    if (bytes.length !== objects[i].size || bytes.length !== batch[i].size) {
      throw new Error('R2 batch size mismatch');
    }
    await writeFile(target, bytes, { mode: 0o600 });
  }
}

async function checkpointExists(name) {
  const url = new URL('/checkpoint', preview);
  url.searchParams.set('name', name);
  return (await (await request(url)).json()).exists;
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyRemoteArchive(key, expected) {
  const hash = createHash('sha256');
  const response = await request(objectUrl(key));
  for await (const chunk of Readable.fromWeb(response.body)) hash.update(chunk);
  if (hash.digest('hex') !== expected) throw new Error(`Remote archive checksum mismatch for ${key}`);
}

async function put(key, file) {
  await exec(wrangler, [
    'r2', 'object', 'put', `${bucketName}/${key}`, '--remote', '--file', file,
  ], {
    cwd: appRoot,
    env: { ...process.env, WRANGLER_LOG_PATH: join(appRoot, '.wrangler/logs') },
    maxBuffer: 2 * 1024 * 1024,
  });
}

const temp = await mkdtemp(join(tmpdir(), 'livecode-credential-migration-'));
const localBucket = join(temp, 'bucket');
const home = join(temp, 'home');
const runtime = join(temp, 'runtime');
try {
  await mkdir(localBucket, { mode: 0o700 });
  await mkdir(home, { mode: 0o700 });
  await mkdir(runtime, { mode: 0o700 });
  const legacy = [];
  for (const name of names) {
    if (await checkpointExists(name)) {
      throw new Error(`${name} already has a packed checkpoint; refusing to replace it`);
    }
    const objects = await list(name);
    console.log(`${name}: ${objects.length} legacy objects, ${objects.reduce((n, o) => n + o.size, 0)} bytes`);
    legacy.push(...objects);
  }
  const batches = [];
  let batch = [];
  let batchBytes = 0;
  for (const object of legacy) {
    if (object.key.endsWith('/') || object.size > 3_000_000) {
      if (batch.length) batches.push(batch);
      batch = [];
      batchBytes = 0;
      batches.push([object]);
      continue;
    }
    if (batch.length >= 40 || batchBytes + object.size > 3_000_000) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(object);
    batchBytes += object.size;
  }
  if (batch.length) batches.push(batch);
  let next = 0;
  let completed = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < batches.length) {
      const objects = batches[next++];
      if (objects.length === 1) await download(objects[0], home);
      else await downloadBatch(objects, home);
      completed += objects.length;
      if (completed % 500 < objects.length) console.log(`Downloaded ${completed}/${legacy.length} objects`);
    }
  }));
  console.log(`Downloaded ${completed}/${legacy.length} objects`);
  await saveCredentials(home, localBucket, runtime);
  await restoreCredentials(join(temp, 'verified-home'), localBucket, join(temp, 'verify-runtime'));
  for (const name of names) {
    const prefix = `livecode/credential-checkpoints/${name}/checkpoints/`;
    if (await checkpointExists(name)) {
      throw new Error(`${name} checkpoint appeared during migration`);
    }
    const root = join(localBucket, 'credential-checkpoints', name, 'checkpoints');
    const manifest = JSON.parse(await readFile(join(root, 'current.json'), 'utf8'));
    const archive = join(root, manifest.archive);
    if (await sha256(archive) !== manifest.sha256) throw new Error(`${name} local archive checksum mismatch`);
    await put(`${prefix}${manifest.archive}`, archive);
    await verifyRemoteArchive(`${prefix}${manifest.archive}`, manifest.sha256);
    await put(`${prefix}current.json`, join(root, 'current.json'));
    const remoteManifest = await (await request(objectUrl(`${prefix}current.json`))).json();
    if (remoteManifest.sha256 !== manifest.sha256) throw new Error(`${name} remote manifest mismatch`);
    console.log(`${name}: packed checkpoint published and verified`);
  }
} finally {
  await rm(temp, { recursive: true, force: true });
  previewChild?.kill('SIGTERM');
}
