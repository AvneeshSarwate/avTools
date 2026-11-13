import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restoreCredentials, saveCredentials } from '../container/credential-state.mjs';

const exec = promisify(execFile);
const boot = await readFile(new URL('../container/boot.sh', import.meta.url), 'utf8');
// Exercise the real shell launch/join blocks with mocked checkpoint I/O, never
// the developer's credentials or a live bucket.
const launch = boot.slice(boot.indexOf('# Credentials are independent'), boot.indexOf('# The image already'));
const gate = boot.slice(boot.indexOf('write_boot_status waiting_for_credentials'), boot.indexOf('if [[ ! -f "$keepalive_status_file"'));
for (const fails of [false, true]) {
  test(`credential restore ${fails ? 'failure blocks readiness' : 'overlaps workspace and gates readiness'}`, async () => {
    const temp = await mkdtemp(join(tmpdir(), 'credential-startup-'));
    try {
      const script = `set -euo pipefail
runtime_state_root=$1
persistent_root=$1
boot_started_ms=1
date() { printf '2\\n'; }
chmod() { :; }
find() { :; }
node() { sleep 0.1; ${fails ? 'return 1' : ':'}; }
write_boot_status() { printf '%s\\n' "$1" >> "$runtime_state_root/events"; }
${launch}
write_boot_status workspace_started
${gate}
write_boot_status ready
`;
      let exitCode = 0;
      try { await exec('bash', ['-c', script, 'credential-test', temp]); }
      catch (error) { exitCode = error.code; }
      const events = (await readFile(join(temp, 'events'), 'utf8')).trim().split('\n');
      assert.equal(events[0], 'workspace_started');
      assert.equal(exitCode, fails ? 1 : 0);
      assert.equal(events.at(-1), fails ? 'failed' : 'ready');
      if (!fails) assert.match(await readFile(join(temp, 'boot-timings.jsonl'), 'utf8'), /credentials.restored/);
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
}

test('legacy private directories migrate to separate packed checkpoints', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'credential-checkpoint-'));
  const home = join(temp, 'home');
  const bucket = join(temp, 'bucket');
  const runtime = join(temp, 'runtime');
  const nextHome = join(temp, 'next-home');
  const nextRuntime = join(temp, 'next-runtime');
  try {
    for (const [name, file, value] of [
      ['claude', '.credentials.json', 'claude-secret'],
      ['codex', 'auth.json', 'codex-secret'],
      ['ssh', 'id_ed25519', 'ssh-secret'],
    ]) {
      await mkdir(join(bucket, name), { recursive: true });
      await writeFile(join(bucket, name, file), value);
    }
    await restoreCredentials(home, bucket, runtime);
    for (const [name, file, value] of [
      ['claude', '.credentials.json', 'claude-secret'],
      ['codex', 'auth.json', 'codex-secret'],
      ['ssh', 'id_ed25519', 'ssh-secret'],
    ]) {
      assert.equal(await readFile(join(home, `.${name}`, file), 'utf8'), value);
      const current = JSON.parse(await readFile(join(bucket, 'credential-checkpoints', name, 'checkpoints', 'current.json'), 'utf8'));
      assert.match(current.archive, /\.tar\.gz$/);
      await writeFile(join(bucket, name, file), 'obsolete legacy value');
    }
    await restoreCredentials(nextHome, bucket, nextRuntime);
    for (const [name, file, value] of [
      ['claude', '.credentials.json', 'claude-secret'],
      ['codex', 'auth.json', 'codex-secret'],
      ['ssh', 'id_ed25519', 'ssh-secret'],
    ]) {
      assert.equal(await readFile(join(nextHome, `.${name}`, file), 'utf8'), value);
    }
    await writeFile(join(home, '.codex', 'auth.json'), 'rotated-secret');
    await saveCredentials(home, bucket, runtime);
    const thirdHome = join(temp, 'third-home');
    await restoreCredentials(thirdHome, bucket, join(temp, 'third-runtime'));
    assert.equal(await readFile(join(thirdHome, '.codex', 'auth.json'), 'utf8'), 'rotated-secret');
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('a corrupt private checkpoint cannot silently restore obsolete legacy credentials', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'credential-corrupt-'));
  const home = join(temp, 'home');
  const bucket = join(temp, 'bucket');
  const runtime = join(temp, 'runtime');
  try {
    await mkdir(join(home, '.claude'), { recursive: true });
    await writeFile(join(home, '.claude', '.credentials.json'), 'new-secret');
    await saveCredentials(home, bucket, runtime);
    await mkdir(join(bucket, 'claude'), { recursive: true });
    await writeFile(join(bucket, 'claude', '.credentials.json'), 'old-secret');
    const checkpointRoot = join(bucket, 'credential-checkpoints', 'claude', 'checkpoints');
    const current = JSON.parse(await readFile(join(checkpointRoot, 'current.json'), 'utf8'));
    await writeFile(join(checkpointRoot, current.archive), 'corrupt archive');
    const nextHome = join(temp, 'next-home');
    await assert.rejects(() => restoreCredentials(nextHome, bucket, join(temp, 'next-runtime')));
    await assert.rejects(() => readFile(join(nextHome, '.claude', '.credentials.json'), 'utf8'), { code: 'ENOENT' });
  } finally { await rm(temp, { recursive: true, force: true }); }
});
