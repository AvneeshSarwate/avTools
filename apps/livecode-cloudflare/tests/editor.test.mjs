import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editorRequestAllowed, editorUpstreamRequest, editorPendingResponse } from '../src/editor.ts';
import { editorCheckpointOptions } from '../container/editor-state.mjs';
import { restore, save } from '../container/checkpoint.mjs';

test('subpath forwarding preserves query strings, origin, and WebSocket headers', () => {
  const upstream = editorUpstreamRequest(new Request('https://dev.example/__cloud/editor/?reconnectionToken=abc&folder=%2Fworkspace%2FavTools', {
    headers: { Upgrade: 'websocket', Origin: 'https://dev.example' },
  }));
  assert.equal(new URL(upstream.url).pathname, '/');
  assert.equal(new URL(upstream.url).searchParams.get('folder'), '/workspace/avTools');
  assert.equal(upstream.headers.get('Upgrade'), 'websocket');
  assert.equal(upstream.headers.get('Origin'), 'https://dev.example');
  assert.equal(upstream.headers.get('X-Forwarded-Host'), 'dev.example');
  assert.equal(upstream.headers.get('X-Forwarded-Proto'), 'https');
  assert.equal(new URL(editorUpstreamRequest(new Request('https://dev.example/__cloud/editor/stable/static/app.js')).url).pathname, '/stable/static/app.js');
  assert.throws(() => editorUpstreamRequest(new Request('https://dev.example/__cloud/editor-other/')));
});

test('editor rejects cross-origin and cross-site requests', () => {
  const request = (headers) => new Request('https://dev.example/__cloud/editor/', { headers });
  assert.equal(editorRequestAllowed(request({})), true);
  assert.equal(editorRequestAllowed(request({ Origin: 'https://dev.example' })), true);
  assert.equal(editorRequestAllowed(request({ Origin: 'https://evil.example' })), false);
  assert.equal(editorRequestAllowed(request({ Origin: 'null' })), false);
  assert.equal(editorRequestAllowed(request({ 'Sec-Fetch-Site': 'cross-site' })), false);
});

test('editor loading response refreshes the current URL; failure stops automatic retries', async () => {
  const request = new Request('https://dev.example/__cloud/editor/', { headers: { Accept: 'text/html' } });
  const pending = editorPendingResponse(request);
  assert.equal(pending.status, 503);
  assert.equal(pending.headers.get('Cache-Control'), 'no-store');
  assert.match(await pending.text(), /http-equiv="refresh"/);
  assert.doesNotMatch(await editorPendingResponse(request, true).text(), /http-equiv="refresh"/);
});

test('editor checkpoints preserve settings and extension dependencies, skip caches, and recover corruption', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'livecode-editor-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const local = join(root, 'local'), bucket = join(root, 'bucket'), runtime = join(root, 'runtime');
  for (const path of ['user-data/User', 'user-data/logs', 'extensions/test/node_modules/pkg/dist']) {
    await mkdir(join(local, path), { recursive: true });
  }
  await mkdir(runtime);
  const settings = join(local, 'user-data/User/settings.json');
  await writeFile(settings, '{"editor.fontSize":16}');
  await writeFile(join(local, 'user-data/logs/session.log'), 'not persistent');
  await writeFile(join(local, 'extensions/test/node_modules/pkg/dist/index.js'), 'extension runtime');
  await save(local, bucket, runtime, editorCheckpointOptions);
  await writeFile(settings, '{"editor.fontSize":18}');
  await save(local, bucket, runtime, editorCheckpointOptions);
  const current = JSON.parse(await readFile(join(bucket, 'checkpoints/current.json'), 'utf8'));
  await writeFile(join(bucket, 'checkpoints', current.archive), 'broken');
  const fresh = join(root, 'fresh');
  await mkdir(fresh);
  assert.equal(await restore(fresh, bucket, runtime, editorCheckpointOptions), true);
  assert.equal(await readFile(join(fresh, 'user-data/User/settings.json'), 'utf8'), '{"editor.fontSize":16}');
  assert.equal(await readFile(join(fresh, 'extensions/test/node_modules/pkg/dist/index.js'), 'utf8'), 'extension runtime');
  await assert.rejects(stat(join(fresh, 'user-data/logs/session.log')), { code: 'ENOENT' });
});
