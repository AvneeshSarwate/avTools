// Remote engine mode E2E: the coordination server runs with --engine remote
// (no engine in its process), a headless browser tab opens /engine/ and
// attaches over /engine/uplink, and this script then drives the REAL agent
// surface over plain HTTP — analyze, launch, entity reads and writes, stop,
// panic — while a Node WebSocket client watches /sync. Execution happens in
// the tab; every HTTP answer is forwarded engine truth.
//
// Covered end to end:
//   - no-engine behavior before the tab opens (honest errors);
//   - hello resets reaching /sync subscribers (including the demo roll seeded
//     by the TAB's engine, not this server);
//   - transient analyze producing a browser-served module URI, launch, run
//     entity with token, wait callsites, signal streaming;
//   - module write-back: setPianoRollClip in the tab visible via HTTP list;
//   - params declared in the tab edited via POST /params/set;
//   - entity CRUD forwarded (create/duplicate/delete + 409 on conflict);
//   - stop semantics (terminal run, waits deleted, signal ended) and panic;
//   - engine detach: /sync gets empty resets, HTTP reports no engine, and a
//     reopened tab re-attaches.
//
// Run from apps/deno-notebooks:  node livecode/tests/remote_engine.e2e.mjs
// Env: PW_CHROMIUM_PATH (system browser), LIVECODE_E2E_TIMEOUT_SCALE.

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const denoNotebookRoot = path.resolve(__dirname, '../..')
const scale = Number(process.env.LIVECODE_E2E_TIMEOUT_SCALE || '1') || 1
const scaled = (ms) => Math.round(ms * scale)

const MODULE_ID = 'remote/module'
const MODULE_SOURCE = `import type { TimeContext } from "@avtools/core-timing";
import { signal } from "canvas-signals";
import { canvasParams } from "canvas-params";
import { setPianoRollClip } from "piano-roll-helpers";

const params = canvasParams("remote/params", { gain: 0.5 });

export default async function run(ctx: TimeContext) {
  setPianoRollClip("remote/beat", {
    notes: [{ id: "n1", pitch: 60, position: 0, duration: 1, velocity: 96 }],
  });
  const heartbeat = signal("remote/heartbeat");
  let beat = 0;
  while (true) {
    heartbeat.set(beat++ * params.gain);
    await ctx.waitSec(0.05);
  }
}
`

function fail(message) {
  console.error(message)
  process.exit(1)
}

async function waitUntil(fn, label, timeoutMs = scaled(30_000)) {
  const start = Date.now()
  let lastError
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(
    `Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`,
  )
}

async function post(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return { status: response.status, body: await response.json() }
}

async function get(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`)
  return { status: response.status, body: await response.json() }
}

// --- start the remote-mode server -----------------------------------------
const sessionRoot = mkdtempSync(path.join(tmpdir(), 'livecode-remote-engine-'))
const serverOutput = []
const serverProc = spawn(
  process.env.DENO_BIN ?? 'deno',
  [
    'run',
    '--unstable-webgpu',
    '--unstable-ffi',
    '--allow-all',
    'livecode/visualizer/main.ts',
    '--host',
    '127.0.0.1',
    '--port',
    '0',
    '--engine',
    'remote',
    '--session-root',
    sessionRoot,
  ],
  { cwd: denoNotebookRoot },
)
serverProc.stdout.on('data', (chunk) => serverOutput.push(chunk.toString()))
serverProc.stderr.on('data', (chunk) => serverOutput.push(chunk.toString()))

const baseUrl = await waitUntil(() => {
  const text = serverOutput.join('')
  const line = text.split('\n').find((entry) => entry.includes('"serverReady"'))
  if (!line) return null
  return JSON.parse(line.slice(line.indexOf('{'))).baseUrl
}, 'serverReady')

let browser
try {
  // --- no engine attached yet: honest errors ------------------------------
  const noEngineList = await get(baseUrl, '/piano-roll/list')
  if (noEngineList.status !== 500 || noEngineList.body.ok !== false) {
    fail(`expected 500 no-engine error, got ${JSON.stringify(noEngineList)}`)
  }
  if (!String(noEngineList.body.error).includes('No engine attached')) {
    fail(`unexpected no-engine error: ${noEngineList.body.error}`)
  }
  const health = await get(baseUrl, '/health')
  if (!health.body.ok || health.body.activeModules.length !== 0) {
    fail(`unexpected /health before engine: ${JSON.stringify(health.body)}`)
  }

  // --- /sync watcher (Node WebSocket client) ------------------------------
  const sync = {
    resets: [],
    entities: new Map(),
    revs: new Map(),
  }
  const syncSocket = new WebSocket(`${baseUrl.replace('http', 'ws')}/sync`)
  syncSocket.addEventListener('open', () => {
    syncSocket.send(JSON.stringify({
      type: 'subscribe',
      entityTypes: [
        'pianoRoll',
        'params',
        'signal',
        'run',
        'moduleWaits',
        'moduleLookups',
      ],
    }))
  })
  syncSocket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.type !== 'sync') return
    if (message.resets) {
      sync.resets.push(message.resets)
      for (const [entityType, entities] of Object.entries(message.resets)) {
        for (const key of [...sync.entities.keys()]) {
          if (key.startsWith(`${entityType}:`)) sync.entities.delete(key)
        }
        for (const entity of entities) {
          const name = entity.name ?? entity.moduleId
          sync.entities.set(`${entityType}:${name}`, entity)
        }
      }
    }
    for (const change of message.changes ?? []) {
      const key = `${change.entityType}:${change.name}`
      if (change.entity === null) sync.entities.delete(key)
      else {
        sync.entities.set(key, change.entity)
        if (change.entityType === 'signal') {
          const seen = sync.revs.get(key) ?? []
          seen.push(change.entity.rev)
          sync.revs.set(key, seen)
        }
      }
    }
  })

  // The pre-engine subscribe answers with empty resets.
  await waitUntil(() => sync.resets.length > 0, 'pre-engine subscribe resets')

  // --- open the engine tab -------------------------------------------------
  browser = await chromium.launch({
    headless: process.env.PW_HEADLESS !== '0',
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    args: [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  })
  const context = await browser.newContext()
  const enginePage = await context.newPage()
  const pageErrors = []
  enginePage.on('pageerror', (error) => pageErrors.push(String(error)))
  // First request builds the host assets; give it room.
  await enginePage.goto(`${baseUrl}/engine/`, { timeout: scaled(60_000) })

  // Attach = the demo roll seeded by the TAB's engine answers over HTTP.
  await waitUntil(async () => {
    const list = await get(baseUrl, '/piano-roll/list')
    return list.status === 200 && list.body.rolls?.melody ? true : null
  }, 'engine attach (piano-roll list serves the tab store)')

  // The hello resets reached the already-subscribed /sync watcher.
  await waitUntil(
    () => sync.entities.has('pianoRoll:melody'),
    'hello resets relayed to /sync',
  )

  // --- analyze + launch over plain HTTP ------------------------------------
  const analysis = await post(baseUrl, '/runtime/analyze', {
    moduleId: MODULE_ID,
    sourceVersion: 1,
    sourceText: MODULE_SOURCE,
    sourceUri: `file:///modules/${MODULE_ID}.ts`,
  })
  if (analysis.body.type !== 'analyzeSuccess') {
    fail(`analyze failed: ${JSON.stringify(analysis.body).slice(0, 500)}`)
  }
  if (!analysis.body.transformedModuleUri.startsWith('/engine-assets/generated/')) {
    fail(`expected browser-served module URI, got ${analysis.body.transformedModuleUri}`)
  }

  const launch = await post(baseUrl, '/runtime/launch', {
    moduleId: MODULE_ID,
    transformedModuleUri: analysis.body.transformedModuleUri,
    generatedRunId: analysis.body.generatedRunId,
  })
  if (!launch.body.ok) fail(`launch failed: ${JSON.stringify(launch.body)}`)

  const runEntity = await waitUntil(
    () => {
      const run = sync.entities.get(`run:${MODULE_ID}`)
      return run?.state === 'running' ? run : null
    },
    'running run entity over /sync',
  )
  if (!runEntity.runToken) fail('run entity carries no runToken')

  await waitUntil(() => {
    const waits = sync.entities.get(`moduleWaits:${MODULE_ID}`)
    return waits && waits.callsiteIds.length > 0 ? waits : null
  }, 'active wait callsites over /sync')

  await waitUntil(() => {
    const key = 'signal:remote/heartbeat'
    const entity = sync.entities.get(key)
    const revs = sync.revs.get(key) ?? []
    return entity && revs.length >= 3 &&
        revs.every((rev, i) => i === 0 || rev > revs[i - 1]) &&
        entity.ownerModuleId === MODULE_ID
      ? entity
      : null
  }, 'advancing owned heartbeat signal over /sync')

  // --- module write-back and HTTP reads reach the tab ----------------------
  const rolls = await waitUntil(async () => {
    const list = await get(baseUrl, '/piano-roll/list')
    return list.body.rolls?.['remote/beat'] ? list.body.rolls : null
  }, 'module piano-roll write-back visible over HTTP')
  if (rolls['remote/beat'].data.notes[0].pitch !== 60) {
    fail('write-back roll has wrong contents')
  }

  const state = await get(baseUrl, '/runtime/state')
  const stateRun = state.body.moduleRuns?.[MODULE_ID]
  if (stateRun?.runToken !== runEntity.runToken) {
    fail(`/runtime/state runToken mismatch: ${JSON.stringify(stateRun)}`)
  }
  if (!state.body.activeModules.some((row) => row.moduleId === MODULE_ID)) {
    fail('/runtime/state missing active module')
  }

  // --- params: declared in the tab, edited over HTTP -----------------------
  await waitUntil(async () => {
    const list = await get(baseUrl, '/params/list')
    return list.body.params?.['remote/params'] ? true : null
  }, 'declared params entity over HTTP')
  const paramsSet = await post(baseUrl, '/params/set', {
    name: 'remote/params',
    values: { gain: 2 },
    originId: 'remote-e2e',
  })
  if (paramsSet.status !== 200 || paramsSet.body.values.gain !== 2) {
    fail(`params set failed: ${JSON.stringify(paramsSet)}`)
  }
  // The running loop multiplies by gain, so samples should now exceed 1.
  await waitUntil(() => {
    const entity = sync.entities.get('signal:remote/heartbeat')
    return typeof entity?.value === 'number' && entity.value > 1 ? true : null
  }, 'signal reflects the HTTP params edit')

  // --- entity CRUD forwarded ------------------------------------------------
  const created = await post(baseUrl, '/entities/create', {
    type: 'pianoRoll',
    name: 'remote/created',
  })
  if (!created.body.ok) fail(`entity create failed: ${JSON.stringify(created)}`)
  const conflict = await post(baseUrl, '/entities/create', {
    type: 'pianoRoll',
    name: 'remote/created',
  })
  if (conflict.status !== 409) {
    fail(`expected 409 for duplicate create, got ${conflict.status}`)
  }
  const duplicated = await post(baseUrl, '/entities/duplicate', {
    type: 'pianoRoll',
    name: 'remote/created',
    targetName: 'remote/created-copy',
  })
  if (!duplicated.body.ok) fail(`duplicate failed: ${JSON.stringify(duplicated)}`)
  const deleted = await post(baseUrl, '/entities/delete', {
    type: 'pianoRoll',
    name: 'remote/created-copy',
  })
  if (!deleted.body.ok) fail(`delete failed: ${JSON.stringify(deleted)}`)

  // --- stop: terminal run, waits deleted, signal ended ---------------------
  await post(baseUrl, '/runtime/stop', { moduleId: MODULE_ID })
  await waitUntil(() => {
    const run = sync.entities.get(`run:${MODULE_ID}`)
    const waitsGone = !sync.entities.has(`moduleWaits:${MODULE_ID}`)
    const signal = sync.entities.get('signal:remote/heartbeat')
    return run?.state === 'stopped' && waitsGone && signal?.ended === true
      ? true
      : null
  }, 'stop semantics over /sync')
  const statusAfterStop = await get(baseUrl, '/runtime/status')
  if (statusAfterStop.body.activeModules.length !== 0) {
    fail('modules still active after stop')
  }

  // --- panic against a fresh run -------------------------------------------
  await post(baseUrl, '/runtime/launch', {
    moduleId: MODULE_ID,
    transformedModuleUri: analysis.body.transformedModuleUri,
    generatedRunId: analysis.body.generatedRunId,
  })
  await waitUntil(
    () => sync.entities.get(`run:${MODULE_ID}`)?.state === 'running',
    'relaunch running',
  )
  await post(baseUrl, '/runtime/panic', {})
  await waitUntil(
    () => sync.entities.get(`run:${MODULE_ID}`)?.state === 'stopped',
    'panic terminal',
  )

  // --- engine detach and re-attach -----------------------------------------
  await enginePage.close()
  await waitUntil(
    () => !sync.entities.has('pianoRoll:melody'),
    'detach empty resets over /sync',
  )
  const detachedList = await get(baseUrl, '/piano-roll/list')
  if (detachedList.status !== 500) {
    fail(`expected no-engine error after detach, got ${detachedList.status}`)
  }
  const enginePage2 = await context.newPage()
  await enginePage2.goto(`${baseUrl}/engine/`, { timeout: scaled(60_000) })
  await waitUntil(
    () => sync.entities.has('pianoRoll:melody'),
    're-attach hello resets',
  )

  if (pageErrors.length > 0) {
    fail(`engine page errors: ${JSON.stringify(pageErrors)}`)
  }

  console.log(JSON.stringify({
    ok: true,
    type: 'remoteEngineE2E',
    baseUrl,
    moduleId: MODULE_ID,
    runToken: runEntity.runToken,
  }))
  process.exitCode = 0
} catch (error) {
  console.error(error)
  console.error('--- server output tail ---')
  console.error(serverOutput.join('').split('\n').slice(-40).join('\n'))
  process.exitCode = 1
} finally {
  try {
    await browser?.close()
  } catch { /* ignore */ }
  serverProc.kill('SIGTERM')
}
