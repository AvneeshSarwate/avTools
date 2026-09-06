// Explicit integration test: requires an already built image and Docker.
// Uses only newly created containers and a disposable volume, never live R2.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const image = process.argv[2] ?? 'livecode-startup-optimized:local';
const name = `livecode-smoke-${randomUUID()}`;
const volume = `${name}-data`;
const docker = async (...args) => (await exec('docker', args, { maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
const results = [];
await docker('volume', 'create', volume);
try {
  for (const iteration of [1, 2]) {
    const started = performance.now();
    await docker('run', '-d', '--name', name, '--platform', 'linux/amd64',
      '--entrypoint', '/opt/livecode/boot.sh', '-v', `${volume}:/data`, image);
    let status;
    while (performance.now() - started < 240_000) {
      const running = await docker('inspect', '--format', '{{.State.Running}}', name);
      if (running !== 'true') throw new Error('Boot supervisor exited');
      try {
        status = JSON.parse(await docker('exec', name, 'cat', '/workspace/.livecode-runtime/boot-status.json'));
      } catch { /* status file may not exist yet */ }
      if (status?.phase === 'ready') break;
      await delay(500);
    }
    if (status?.phase !== 'ready') throw new Error(`Boot timed out at ${status?.phase}`);
    const readyMs = Math.round(performance.now() - started);
    const routes = [];
    for (const path of ['/health', '/projects.html', '/index.html', '/engine/']) {
      const routeStarted = performance.now();
      await docker('exec', name, 'curl', '--max-time', '120', '--fail', '--silent',
        '--output', '/dev/null', `http://127.0.0.1:5173${path}`);
      routes.push({ path, durationMs: Math.round(performance.now() - routeStarted) });
    }
    const logs = await docker('logs', name);
    if (!logs.includes('browserHostAssetsCacheHit')) throw new Error('Expected baked engine cache hit');
    await docker('exec', name, 'test', '-s', '/workspace/avTools/webcomponents/handwriting-canvas/dist/handwriting-canvas.js');
    if (iteration === 2) {
      const restored = await docker('exec', name, 'cat', '/workspace/avTools/.startup-smoke-marker');
      if (restored !== name) throw new Error('Checkpoint did not restore the marker');
    }
    await docker('exec', name, 'node', '-e',
      `require('fs').writeFileSync('/workspace/avTools/.startup-smoke-marker', ${JSON.stringify(name)})`);
    // Serialize with the supervisor's background checkpoint writer.
    await docker('exec', name, 'flock', '--wait', '120', '/workspace/.livecode-runtime/repo-persist.lock',
      'node', '/opt/livecode/checkpoint.mjs', 'save', '/workspace/avTools', '/data/livecode', '/workspace/.livecode-runtime');
    const phases = await docker('exec', name, 'cat', '/workspace/.livecode-runtime/boot-timings.jsonl');
    const timings = phases.split('\n').map(JSON.parse);
    const credentials = timings.find(event => event.event === 'credentials.restored');
    const services = timings.find(event => event.phase === 'starting_services');
    if (!credentials || !services || credentials.elapsedMs > services.elapsedMs) throw new Error('Credentials not restored before readiness');
    results.push({ iteration, readyMs, routes, phases: timings });
    console.log(JSON.stringify(results.at(-1)));
    await docker('stop', '--timeout', '30', name);
    await docker('rm', name);
  }
} catch (error) {
  console.error(await docker('logs', '--tail', '60', name).catch(() => 'No container logs'));
  throw error;
} finally {
  await docker('rm', '--force', name).catch(() => {});
  await docker('volume', 'rm', volume);
}
console.log('PASS: two boots, HTTP health, engine assets, canvas bundle, and persisted workspace marker');
