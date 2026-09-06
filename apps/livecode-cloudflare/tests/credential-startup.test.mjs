import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);
const boot = await readFile(new URL('../container/boot.sh', import.meta.url), 'utf8');
// Exercise the real shell launch/join blocks with mocked credential I/O, never
// the developer's credentials or a live bucket.
const launch = boot.slice(boot.indexOf('# Credentials are independent'), boot.indexOf('# The image already'));
const gate = boot.slice(boot.indexOf('write_boot_status waiting_for_credentials'), boot.indexOf('if [[ ! -f "$keepalive_status_file"'));
for (const fails of [false, true]) {
  test(`credential restore ${fails ? 'failure blocks readiness' : 'overlaps workspace and gates readiness'}`, async () => {
    const temp = await mkdtemp(join(tmpdir(), 'credential-startup-'));
    try {
      const script = `set -euo pipefail
runtime_state_root=$1
claude_state_root=$1
codex_state_root=$1
ssh_state_root=$1
boot_started_ms=1
date() { printf '2\\n'; }
chmod() { :; }
find() { :; }
rsync() { sleep 0.1; ${fails ? 'return 1' : ':'}; }
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
