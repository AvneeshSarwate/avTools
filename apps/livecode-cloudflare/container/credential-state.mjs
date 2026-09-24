// Persist private agent state as whole-object checkpoints. Legacy R2 mirrors
// are imported once; a published checkpoint is authoritative thereafter.
import { mkdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { restore, save } from './checkpoint.mjs';

const exec = promisify(execFile);
const names = ['claude', 'codex', 'ssh'];
const options = {
  excludeFile: fileURLToPath(new URL('./credential-excludes.txt', import.meta.url)),
  requiredDirectory: '.',
};

async function exists(path) {
  try { return (await stat(path)).isDirectory(); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function paths(home, bucket, runtime, name) {
  return {
    local: join(home, `.${name}`),
    legacy: join(bucket, name),
    packed: join(bucket, 'credential-checkpoints', name),
    work: join(runtime, `credential-${name}`),
  };
}

export async function restoreCredentials(home, bucket, runtime) {
  const migrated = [];
  for (const name of names) {
    const { local, legacy, packed, work } = paths(home, bucket, runtime, name);
    await mkdir(local, { recursive: true });
    await mkdir(work, { recursive: true });
    if (await restore(local, packed, work, options)) continue;
    if (!await exists(legacy)) continue;
    await exec('rsync', ['--archive', `${legacy}/`, `${local}/`]);
    migrated.push(name);
    console.log(`[livecode] imported legacy ${name} state`);
  }
  // Publish only after every directory has restored successfully. A failed
  // migration leaves the old mirrors available for another attempt.
  for (const name of migrated) {
    const { local, packed, work } = paths(home, bucket, runtime, name);
    await save(local, packed, work, options);
  }
}

export async function saveCredentials(home, bucket, runtime) {
  const failures = [];
  for (const name of names) {
    const { local, packed, work } = paths(home, bucket, runtime, name);
    try {
      await mkdir(local, { recursive: true });
      await mkdir(work, { recursive: true });
      await save(local, packed, work, options);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    }
  }
  if (failures.length) throw new Error(`Credential checkpoints failed: ${failures.join('; ')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, home, bucket, runtime] = process.argv.slice(2);
  if (!['restore', 'save'].includes(command) || !home || !bucket || !runtime) {
    throw new Error('Usage: credential-state.mjs restore|save HOME BUCKET RUNTIME');
  }
  await (command === 'restore' ? restoreCredentials : saveCredentials)(home, bucket, runtime);
}
