// Packed source checkpoints. All traversal, compression and extraction happen
// locally; the bucket mount only sees whole objects and two small manifests.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const excludes = join(dirname(fileURLToPath(import.meta.url)), 'repo-excludes.txt');
const exec = promisify(execFile);
const sync = async (source, target, checksum = false) => (await exec('rsync', [
  '--archive', '--delete', '--itemize-changes', ...(checksum ? ['--checksum'] : []),
  `--exclude-from=${excludes}`, `${source}/`, `${target}/`,
], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })).stdout;
async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function manifest(path) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (value.version !== 1 || !/^[a-f0-9-]{36}\.tar\.gz$/.test(value.archive) ||
        !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('Invalid checkpoint manifest');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function restore(workspace, bucket, runtime) {
  const root = join(bucket, 'checkpoints');
  let found = false;
  for (const name of ['current.json', 'previous.json']) {
    const stage = join(runtime, `restore-${randomUUID()}`);
    try {
      const entry = await manifest(join(root, name));
      if (!entry) continue;
      found = true;
      await mkdir(stage, { recursive: true });
      const archive = join(stage, 'repo.tar.gz');
      await copyFile(join(root, entry.archive), archive);
      if (await digest(archive) !== entry.sha256) throw new Error('Checkpoint checksum mismatch');
      const tree = join(stage, 'tree');
      await mkdir(tree);
      await exec('tar', ['-xzf', archive, '-C', tree]);
      if (!(await stat(join(tree, '.git'))).isDirectory()) throw new Error('Checkpoint lacks .git');
      // Validate before touching the live worktree; excluded baked dependencies
      // survive while --delete restores source deletions faithfully.
      await sync(tree, workspace, true);
      await writeFile(join(runtime, 'restored-checkpoint.json'), JSON.stringify(entry));
      console.log(`[livecode] restored ${name}: ${entry.archive}`);
      return true;
    } catch (error) {
      found = true;
      console.error(`[livecode] cannot restore ${name}: ${error.message}`);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  // Never silently fall back to an obsolete legacy mirror after migration.
  if (found) throw new Error('No valid packed checkpoint; refusing to overwrite persisted work');
  return false;
}

export async function save(workspace, bucket, runtime) {
  const root = join(bucket, 'checkpoints');
  const stage = join(runtime, 'checkpoint-tree');
  await mkdir(root, { recursive: true });
  await mkdir(stage, { recursive: true });
  const dirty = join(runtime, 'checkpoint-dirty');
  let pending = false;
  try { await stat(dirty); pending = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Mark before copying so an interrupted attempt is retried even if the
  // next rsync reports no changes against its partially updated local mirror.
  await writeFile(dirty, 'pending');
  // Local checksums also catch same-size edits within rsync's mtime precision.
  const changes = await sync(workspace, stage, true);
  const receipt = await manifest(join(runtime, 'restored-checkpoint.json'));
  if (!pending && !changes.trim() && receipt) {
    await rm(dirty);
    return;
  }
  if (!(await stat(join(stage, '.git'))).isDirectory()) throw new Error('Workspace lacks .git');
  const archive = join(runtime, 'checkpoint.tar.gz');
  // Archive the local mirror, so concurrent edits cannot interrupt tar. This
  // is file-level crash continuity, not an application-transaction snapshot.
  await exec('tar', ['-czf', archive, '-C', stage, '.']);
  const sha256 = await digest(archive);
  let current;
  try { current = await manifest(join(root, 'current.json')); } catch { /* recovery below */ }
  let previous;
  try { previous = await manifest(join(root, 'previous.json')); } catch { /* retain unknown objects */ }
  // After a fallback restore, preserve the known-good checkpoint, never the
  // corrupt current object. The receipt is local and only written on success.
  const restored = await manifest(join(runtime, 'restored-checkpoint.json'));
  if (restored) current = restored;
  if (current?.sha256 === sha256) {
    // Repair a current pointer after falling back to the previous checkpoint.
    await writeFile(join(root, 'current.json'), JSON.stringify(current));
    await rm(dirty);
    return;
  }
  const next = { version: 1, archive: `${randomUUID()}.tar.gz`, sha256, createdAt: new Date().toISOString() };
  await copyFile(archive, join(root, next.archive));
  // Closing the immutable object precedes manifest publication. No bucket
  // rename is used: s3fs rename is not a filesystem-atomic transaction.
  if (current) await writeFile(join(root, 'previous.json'), JSON.stringify(current));
  await writeFile(join(root, 'current.json'), JSON.stringify(next));
  await writeFile(join(runtime, 'restored-checkpoint.json'), JSON.stringify(next));
  await rm(dirty);
  console.log(`[livecode] published checkpoint ${next.archive}`);
  // Keep the current and previous successful generations. Only remove an
  // explicitly superseded object after all new pointers have been published.
  if (previous && previous.archive !== current?.archive && previous.archive !== next.archive) {
    await rm(join(root, previous.archive), { force: true }).catch((error) => {
      console.error(`[livecode] checkpoint cleanup deferred: ${error.message}`);
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, workspace, bucket, runtime] = process.argv.slice(2);
  if (!['save', 'restore'].includes(command) || !workspace || !bucket || !runtime) {
    throw new Error('Usage: checkpoint.mjs save|restore WORKSPACE BUCKET RUNTIME');
  }
  await mkdir(runtime, { recursive: true });
  if (command === 'save') await save(workspace, bucket, runtime);
  else if (!await restore(workspace, bucket, runtime)) process.exitCode = 3;
}
