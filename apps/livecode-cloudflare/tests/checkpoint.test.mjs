import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readlink, stat, readdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { save, restore } from '../container/checkpoint.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'livecode-checkpoint-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, 'workspace');
  const bucket = join(root, 'bucket');
  const runtime = join(root, 'runtime');
  await Promise.all([mkdir(join(workspace, '.git'), { recursive: true }), mkdir(bucket), mkdir(runtime)]);
  await writeFile(join(workspace, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const pointer = () => readFile(join(bucket, 'checkpoints', 'current.json'), 'utf8').then(JSON.parse);
  return { root, workspace, bucket, runtime, pointer };
}

test('round trip preserves source, Git, executable bits and symlinks, but keeps baked dependencies', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.workspace, 'untracked.ts'), 'uncommitted source');
  await writeFile(join(f.workspace, 'run.sh'), '#!/bin/sh\n', { mode: 0o755 });
  await symlink('untracked.ts', join(f.workspace, 'link'));
  await mkdir(join(f.workspace, 'node_modules'));
  await writeFile(join(f.workspace, 'node_modules', 'baked'), 'original');
  await save(f.workspace, f.bucket, f.runtime);
  await writeFile(join(f.workspace, 'untracked.ts'), 'wrong');
  await writeFile(join(f.workspace, 'deleted.ts'), 'must disappear');
  await writeFile(join(f.workspace, 'node_modules', 'baked'), 'keep this');
  assert.equal(await restore(f.workspace, f.bucket, f.runtime), true);
  assert.equal(await readFile(join(f.workspace, 'untracked.ts'), 'utf8'), 'uncommitted source');
  assert.equal(await readFile(join(f.workspace, 'node_modules', 'baked'), 'utf8'), 'keep this');
  assert.equal(await readlink(join(f.workspace, 'link')), 'untracked.ts');
  assert.ok((await stat(join(f.workspace, 'run.sh'))).mode & 0o100);
  await assert.rejects(stat(join(f.workspace, 'deleted.ts')), { code: 'ENOENT' });
});

test('unchanged workspace does not upload and retains only two normal generations', async (t) => {
  const f = await fixture(t);
  await save(f.workspace, f.bucket, f.runtime);
  const first = await f.pointer();
  await save(f.workspace, f.bucket, f.runtime);
  assert.deepEqual(await f.pointer(), first);
  for (const content of ['second', 'third generation']) {
    await writeFile(join(f.workspace, 'source.ts'), content);
    await save(f.workspace, f.bucket, f.runtime);
  }
  const files = await readdir(join(f.bucket, 'checkpoints'));
  assert.equal(files.filter((name) => name.endsWith('.tar.gz')).length, 2);
});

test('corrupt latest archive falls back and the recovered generation survives the next save', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.workspace, 'source.ts'), 'good');
  await save(f.workspace, f.bucket, f.runtime);
  await writeFile(join(f.workspace, 'source.ts'), 'newer version');
  await save(f.workspace, f.bucket, f.runtime);
  await writeFile(join(f.bucket, 'checkpoints', (await f.pointer()).archive), 'broken');
  assert.equal(await restore(f.workspace, f.bucket, f.runtime), true);
  assert.equal(await readFile(join(f.workspace, 'source.ts'), 'utf8'), 'good');
  await writeFile(join(f.workspace, 'source.ts'), 'recovered edit');
  await save(f.workspace, f.bucket, f.runtime);
  await writeFile(join(f.bucket, 'checkpoints', (await f.pointer()).archive), 'broken again');
  assert.equal(await restore(f.workspace, f.bucket, f.runtime), true);
  assert.equal(await readFile(join(f.workspace, 'source.ts'), 'utf8'), 'good');
});

test('missing checkpoints permit legacy migration; invalid checkpoints fail without touching workspace', async (t) => {
  const f = await fixture(t);
  assert.equal(await restore(f.workspace, f.bucket, f.runtime), false);
  await writeFile(join(f.workspace, 'source.ts'), 'safe');
  await save(f.workspace, f.bucket, f.runtime);
  await writeFile(join(f.bucket, 'checkpoints', 'current.json'), '{partial');
  await assert.rejects(restore(f.workspace, f.bucket, f.runtime), /No valid packed checkpoint/);
  assert.equal(await readFile(join(f.workspace, 'source.ts'), 'utf8'), 'safe');
});

test('failed publication retries even when local snapshot has no further edits', async (t) => {
  const f = await fixture(t);
  await save(f.workspace, f.bucket, f.runtime);
  await writeFile(join(f.workspace, 'source.ts'), 'retry me');
  const current = join(f.bucket, 'checkpoints', 'current.json');
  await rm(current);
  await mkdir(current); // Simulate a failed object write.
  await assert.rejects(save(f.workspace, f.bucket, f.runtime));
  await rm(current, { recursive: true });
  await save(f.workspace, f.bucket, f.runtime);
  assert.ok((await f.pointer()).archive);
  await writeFile(join(f.workspace, 'source.ts'), 'wrong');
  await restore(f.workspace, f.bucket, f.runtime);
  assert.equal(await readFile(join(f.workspace, 'source.ts'), 'utf8'), 'retry me');
});

test('same-size and same-mtime edits are saved and restored exactly', async (t) => {
  const f = await fixture(t);
  const source = join(f.workspace, 'source.ts');
  const timestamp = new Date('2026-01-01T00:00:00Z');
  await writeFile(source, 'aaaa');
  await utimes(source, timestamp, timestamp);
  await save(f.workspace, f.bucket, f.runtime);
  const first = await f.pointer();
  await writeFile(source, 'bbbb');
  await utimes(source, timestamp, timestamp);
  await save(f.workspace, f.bucket, f.runtime);
  assert.notEqual((await f.pointer()).archive, first.archive);
  await writeFile(source, 'cccc');
  await utimes(source, timestamp, timestamp);
  await restore(f.workspace, f.bucket, f.runtime);
  assert.equal(await readFile(source, 'utf8'), 'bbbb');
});

test('generated trees and environment files are absent from checkpoints', async (t) => {
  const f = await fixture(t);
  for (const name of ['.env', '.env.local', 'debug.log']) await writeFile(join(f.workspace, name), 'excluded');
  await mkdir(join(f.workspace, 'nested', 'dist'), { recursive: true });
  await writeFile(join(f.workspace, 'nested', 'dist', 'bundle.js'), 'excluded');
  await save(f.workspace, f.bucket, f.runtime);
  const empty = join(f.root, 'empty');
  await mkdir(empty);
  await restore(empty, f.bucket, f.runtime);
  for (const name of ['.env', '.env.local', 'debug.log', 'nested/dist/bundle.js']) {
    await assert.rejects(stat(join(empty, name)), { code: 'ENOENT' });
  }
  assert.ok((await stat(join(empty, '.git'))).isDirectory());
});
