// Browser-engine vertical slice E2E (phase 2 of
// docs/livecode/history/browser-engine-plan-2026-08.md).
//
// Proves the extracted engine actually executes an instrumented livecode
// module inside a browser tab: build_slice.ts transforms the fixture with a
// browser runtime import and bundles the engine host; this script serves the
// assets, opens an engine tab and an observer tab in one browser, launches the
// module through the engine harness, and asserts — from the OBSERVER tab, over
// the BroadcastChannel sync host — the subscribe resets (including the demo
// roll seeded at engine construction), the run entity going active, the wait
// callsite appearing, the heartbeat signal's rev advancing, and then a stop
// producing the terminal run entity, the waits deletion, and the signal's
// sticky `ended` flag.
//
// Run from apps/deno-notebooks:
//   node livecode/tests/browser_engine_slice.e2e.mjs
// Env: PW_CHROMIUM_PATH (system browser), PW_HEADLESS=0 (headed).

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const denoNotebookRoot = path.resolve(__dirname, '../..')
const buildScript = path.join(
  denoNotebookRoot,
  'livecode/browser_host/build_slice.ts',
)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

async function buildAssets(outDir) {
  await new Promise((resolve, reject) => {
    const proc = spawn(
      process.env.DENO_BIN ?? 'deno',
      ['run', '--allow-all', buildScript, '--out', outDir],
      { cwd: denoNotebookRoot, stdio: ['ignore', 'inherit', 'inherit'] },
    )
    proc.on('error', reject)
    proc.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`build_slice exited ${code}`)))
  })
  return JSON.parse(readFileSync(path.join(outDir, 'slice.json'), 'utf8'))
}

function serveAssets(dir) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const rel = url.pathname === '/' ? '/engine.html' : url.pathname
    const file = path.join(dir, path.normalize(rel))
    if (!file.startsWith(dir)) {
      res.writeHead(403).end()
      return
    }
    let body
    try {
      body = readFileSync(file)
    } catch {
      res.writeHead(404).end('not found')
      return
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    })
    res.end(body)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }))
  })
}

async function waitFor(page, predicate, label, arg, timeoutMs = 30_000) {
  const start = Date.now()
  let lastError
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await page.evaluate(predicate, arg)
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(
    `Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`,
  )
}

const outDir = mkdtempSync(path.join(tmpdir(), 'livecode-browser-slice-'))
const slice = await buildAssets(outDir)
const { server, origin } = await serveAssets(outDir)

const browser = await chromium.launch({
  headless: process.env.PW_HEADLESS !== '0',
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  // The slice runs two tabs; neither may have its timers clamped for being
  // unfocused. (The real engine tab's mitigation is a live AudioContext plus
  // operator discipline — see the plan note.)
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
})

try {
  const context = await browser.newContext()
  const enginePage = await context.newPage()
  const engineErrors = []
  enginePage.on('pageerror', (error) => engineErrors.push(String(error)))
  await enginePage.goto(`${origin}/engine.html`)
  await waitFor(
    enginePage,
    () => Boolean(globalThis.__livecodeBrowserEngine),
    'engine harness',
  )

  // The observer tab: collect every sync envelope, keep latest state per kind.
  const uiPage = await context.newPage()
  await uiPage.goto(`${origin}/ui.html`)
  await uiPage.evaluate(() => {
    const state = {
      resets: null,
      entities: new Map(),
      seqs: [],
      revs: new Map(),
    }
    globalThis.__sliceState = state
    const channel = new BroadcastChannel('livecode-sync')
    channel.onmessage = (event) => {
      const message = event.data
      if (message?.type !== 'sync') return
      state.seqs.push(message.seq)
      if (message.resets) state.resets = message.resets
      for (const change of message.changes ?? []) {
        const key = `${change.entityType}:${change.name}`
        if (change.entity === null) state.entities.delete(key)
        else {
          state.entities.set(key, change.entity)
          if (change.entityType === 'signal') {
            const seen = state.revs.get(key) ?? []
            seen.push(change.entity.rev)
            state.revs.set(key, seen)
          }
        }
      }
    }
    globalThis.__sliceChannel = channel
    channel.postMessage({
      type: 'subscribe',
      entityTypes: [
        'pianoRoll',
        'params',
        'signal',
        'run',
        'moduleWaits',
        'moduleLookups',
      ],
    })
  })

  // 1) Subscribe resets arrive, including the demo roll the engine seeded at
  // construction — the stores are alive in the tab.
  const resetRolls = await waitFor(
    uiPage,
    () => {
      const resets = globalThis.__sliceState.resets
      if (!resets) return null
      return (resets.pianoRoll ?? []).map((roll) => roll.name)
    },
    'subscribe resets',
  )
  if (!resetRolls.includes('melody')) {
    fail(`expected demo roll in resets, got ${JSON.stringify(resetRolls)}`)
  }

  // 2) Launch the transformed module through the engine harness.
  await enginePage.evaluate((meta) =>
    globalThis.__livecodeBrowserEngine.launch({
      moduleId: meta.moduleId,
      transformedModuleUri: '/module.js',
      generatedRunId: meta.generatedRunId,
    }), slice)

  const runEntity = await waitFor(
    uiPage,
    (moduleId) => {
      const run = globalThis.__sliceState.entities.get(`run:${moduleId}`)
      return run && run.state === 'running' ? run : null
    },
    'running run entity',
    slice.moduleId,
  )
  if (!runEntity.runToken) fail('run entity carries no runToken')

  // 3) The wait callsite reports through the engine's sync sources — proof the
  // generated code's ./runtime.js import reached the engine's own singletons.
  const waits = await waitFor(
    uiPage,
    (moduleId) => {
      const entity = globalThis.__sliceState.entities.get(
        `moduleWaits:${moduleId}`,
      )
      return entity && entity.callsiteIds.length > 0 ? entity : null
    },
    'active wait callsites',
    slice.moduleId,
  )

  // 4) The heartbeat signal streams: value present, rev strictly advancing,
  // owner stamped by the __tcvOwnedSignal wrap.
  const signalEntity = await waitFor(
    uiPage,
    (moduleId) => {
      const state = globalThis.__sliceState
      const entity = state.entities.get('signal:slice/heartbeat')
      const revs = state.revs.get('signal:slice/heartbeat') ?? []
      if (!entity || revs.length < 3) return null
      const advancing = revs.every(
        (rev, index) => index === 0 || rev > revs[index - 1],
      )
      if (!advancing) return null
      return entity.ownerModuleId === moduleId ? entity : null
    },
    'advancing owned heartbeat signal',
    slice.moduleId,
  )
  if (typeof signalEntity.value !== 'number') {
    fail(`expected numeric heartbeat, got ${JSON.stringify(signalEntity.value)}`)
  }

  // 5) seq is gap-free on this single-producer channel.
  const seqs = await uiPage.evaluate(() => globalThis.__sliceState.seqs)
  for (let index = 1; index < seqs.length; index++) {
    if (seqs[index] !== seqs[index - 1] + 1) {
      fail(`sync seq gap: ${seqs[index - 1]} -> ${seqs[index]}`)
    }
  }

  // 6) Stop: terminal run entity, waits deletion, sticky signal `ended`.
  await enginePage.evaluate((moduleId) =>
    globalThis.__livecodeBrowserEngine.stop(moduleId), slice.moduleId)

  await waitFor(
    uiPage,
    (moduleId) => {
      const state = globalThis.__sliceState
      const run = state.entities.get(`run:${moduleId}`)
      const waitsGone = !state.entities.has(`moduleWaits:${moduleId}`)
      const signal = state.entities.get('signal:slice/heartbeat')
      return run?.state === 'stopped' && waitsGone && signal?.ended === true
        ? true
        : null
    },
    'terminal run + deleted waits + ended signal',
    slice.moduleId,
  )

  const stillActive = await enginePage.evaluate(() =>
    globalThis.__livecodeBrowserEngine.activeModuleIds())
  if (stillActive.length !== 0) {
    fail(`engine still reports active modules: ${JSON.stringify(stillActive)}`)
  }
  if (engineErrors.length > 0) {
    fail(`engine page errors: ${JSON.stringify(engineErrors)}`)
  }

  console.log(JSON.stringify({
    ok: true,
    type: 'browserEngineSliceE2E',
    origin,
    moduleId: slice.moduleId,
    generatedRunId: slice.generatedRunId,
    waitCallsites: waits.callsiteIds.length,
    heartbeat: signalEntity.value,
  }))
} finally {
  await browser.close()
  server.close()
}
