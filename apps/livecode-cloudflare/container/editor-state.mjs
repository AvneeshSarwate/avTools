import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { restore, save } from './checkpoint.mjs';

export const editorCheckpointOptions = {
  excludeFile: fileURLToPath(new URL('./editor-excludes.txt', import.meta.url)),
  requiredDirectory: 'user-data',
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, local, bucket, runtime] = process.argv.slice(2);
  if (!['restore', 'save'].includes(command) || !local || !bucket || !runtime) {
    throw new Error('Usage: editor-state.mjs restore|save LOCAL BUCKET RUNTIME');
  }
  await mkdir(runtime, { recursive: true });
  await (command === 'restore' ? restore : save)(local, bucket, runtime, editorCheckpointOptions);
}
