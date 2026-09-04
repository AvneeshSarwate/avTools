// Gallery E2E: bake the checked-in `timing-examples` project into a static
// directory, serve it with a dumb file server, open its bare root URL in one
// headless tab, and prove the single-page demo form works for a real
// multi-module project:
//
//   - the stamped boot defaults make this tab the engine and auto-launch all
//     five timing modules;
//   - every module's `canvasSurface` is found by its canvas view and keeps
//     drawing frames;
//   - each example's params entity exists, and a params write through the
//     actions channel (the panes' transport) pauses one example and retimes
//     another without disturbing the rest.
//
// Run from apps/deno-notebooks:  node livecode/tests/timing_examples.e2e.mjs
// Needs a built tldraw client (npm run build in apps/livecode-tldraw).

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const denoNotebookRoot = path.resolve(__dirname, '../..')
const tldrawRoot = path.resolve(denoNotebookRoot, '../livecode-tldraw')
const uiDist = path.join(tldrawRoot, 'dist')
const projectRoot = path.join(tldrawRoot, 'example-projects', 'timing-examples')
const scale = Number(process.env.LIVECODE_E2E_TIMEOUT_SCALE || '1') || 1
const scaled = (ms) => Math.round(ms * scale)

const SURFACES = [
  'timing/sequence',
  'timing/branches',
  'timing/barrier',
  'timing/cancel',
  'timing/tempo',
]

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

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

if (!existsSync(path.join(uiDist, 'index.html'))) {
  fail(`needs a built client: run npm run build in ${tldrawRoot}`)
}

// --- bake ------------------------------------------------------------------
const outDir = mkdtempSync(path.join(tmpdir(), 'livecode-timing-bake-'))
await new Promise((resolvePromise, reject) => {
  const proc = spawn(
    process.env.DENO_BIN ?? 'deno',
    [
      'run',
      '--allow-all',
      'livecode/browser_host/bake_project.ts',
      '--project',
      projectRoot,
      '--out',
      outDir,
      '--ui',
      uiDist,
    ],
    { cwd: denoNotebookRoot, stdio: ['ignore', 'inherit', 'inherit'] },
  )
  proc.on('error', reject)
  proc.on('exit', (code) =>
    code === 0 ? resolvePromise() : reject(new Error(`bake exited ${code}`)))
})

// --- static host -------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const rel = url.pathname === '/' ? '/index.html' : url.pathname
  const file = path.join(outDir, path.normalize(decodeURIComponent(rel)))
  if (!file.startsWith(outDir)) {
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
await new Promise((resolvePromise) =>
  server.listen(0, '127.0.0.1', resolvePromise))
const origin = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch({
  headless: process.env.PW_HEADLESS !== '0',
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
})

try {
  const page = await browser.newPage()
  const pageErrors = []
  const consoleTail = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  page.on('console', (message) => consoleTail.push(message.text()))
  await page.goto(`${origin}/`)

  await waitUntil(
    () =>
      page.evaluate((expected) => {
        const active = globalThis.__livecodeBrowserEngine?.activeModuleIds() ?? []
        return globalThis.__livecodeEngineLock?.state() === 'engine' &&
            expected.every((id) => active.includes(id))
          ? true
          : null
      }, SURFACES),
    'this tab is the engine with all five timing modules active',
    scaled(60_000),
  ).catch((error) => {
    console.error('--- page console tail ---')
    console.error(consoleTail.slice(-25).join('\n'))
    throw error
  })

  const surfaceStates = await waitUntil(
    () =>
      page.evaluate((expected) => {
        const states = globalThis.__livecodeTldrawRuntimeDebug?.getCanvasSurfaceStates() ?? []
        const byName = new Map(states.map((state) => [state.surfaceName, state]))
        return expected.every((name) => {
            const state = byName.get(name)
            return state?.sourceFound && state.frameCount > 30
          })
          ? states
          : null
      }, SURFACES),
    'every canvas view found its module canvas and is drawing',
  )
  for (const state of surfaceStates) {
    if (state.sourceWidth !== 480 || state.sourceHeight !== 300) {
      fail(`unexpected surface size: ${JSON.stringify(state)}`)
    }
  }

  await waitUntil(
    () =>
      page.evaluate((expected) => {
        const params = globalThis.__livecodeSyncDebug.getEntities('params')
        return expected.every((name) => params[name]?.values?.running === true)
          ? true
          : null
      }, SURFACES),
    'every example declared its params entity with running = true',
  )

  // The panes' transport: one paramsSet over the actions channel.
  const setParams = (name, values) =>
    page.evaluate(([name, values]) =>
      new Promise((resolvePromise, reject) => {
        const channel = new BroadcastChannel('livecode-actions')
        const requestId = crypto.randomUUID()
        const timer = setTimeout(() => {
          channel.close()
          reject(new Error('params action timed out'))
        }, 10_000)
        channel.onmessage = (event) => {
          const message = event.data
          if (message?.type !== 'engineResult' || message.requestId !== requestId) return
          clearTimeout(timer)
          channel.close()
          message.ok ? resolvePromise(message.body) : reject(new Error(message.error))
        }
        channel.postMessage({
          type: 'engineRequest',
          requestId,
          op: { kind: 'paramsSet', request: { name, values, originId: 'timing-e2e' } },
        })
      }), [name, values])

  const paused = await setParams('timing/cancel', { running: false })
  if (paused?.values?.running !== false) {
    fail(`pause write failed: ${JSON.stringify(paused)}`)
  }
  const retimed = await setParams('timing/tempo', { bpm: 200 })
  if (retimed?.values?.bpm !== 200) {
    fail(`bpm write failed: ${JSON.stringify(retimed)}`)
  }
  await waitUntil(
    () =>
      page.evaluate(() => {
        const params = globalThis.__livecodeSyncDebug.getEntities('params')
        return params['timing/cancel']?.values?.running === false &&
            params['timing/tempo']?.values?.bpm === 200 &&
            params['timing/sequence']?.values?.running === true
          ? true
          : null
      }),
    'params writes visible in the sync maps, other examples untouched',
  )
  // A paused example keeps its view alive (the module still draws its
  // paused frame) and every other view keeps animating.
  const before = await page.evaluate(() =>
    Object.fromEntries(
      globalThis.__livecodeTldrawRuntimeDebug.getCanvasSurfaceStates()
        .map((state) => [state.surfaceName, state.frameCount]),
    ))
  await waitUntil(
    () =>
      page.evaluate((previous) =>
        globalThis.__livecodeTldrawRuntimeDebug.getCanvasSurfaceStates()
            .every((state) => state.frameCount > previous[state.surfaceName] + 10)
          ? true
          : null, before),
    'all canvas views still drawing after the params writes',
  )

  // Font requests to tldraw's CDN can fail offline; only engine/page faults count.
  const realErrors = pageErrors.filter((entry) => !/fetch|NetworkError/i.test(entry))
  if (realErrors.length > 0) fail(`page errors: ${realErrors.join('\n')}`)

  console.log(JSON.stringify({
    ok: true,
    type: 'timingExamplesE2E',
    origin,
    surfaces: surfaceStates.map((state) => state.surfaceName).sort(),
  }))
} finally {
  await browser.close()
  server.close()
}
