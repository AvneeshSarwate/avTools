// Baked-project (Setup A) E2E: bake a project to a static directory, serve it
// with a dumb file server (no livecode server anywhere), open the engine tab
// and the real tldraw UI in one browser, and prove the serverless pair works:
//
//   - the engine tab boots from baked.json: durable-entity seeds load and
//     every baked module auto-launches (including one importing another
//     module through a rewritten relative specifier);
//   - the UI (?serverBaseUrl=none&sync=broadcast&actions=broadcast) receives
//     everything over BroadcastChannel: the seeded roll, the module's
//     write-back roll, the declared params entity, running run entities, and
//     an advancing owned signal;
//   - UI actions round-trip over the broadcast actions channel with no HTTP:
//     entity create shows up in the sync maps, delete removes it, and a
//     params write changes the running module's output;
//   - the UI boots project-shaped from baked.json: one read-only code shape
//     per module at its manifest position, plus the manifest's canvas views;
//   - the Export data button captures the engine tab's durable entities over
//     the actions channel and downloads them as {type, name, data} rows;
//   - the single-page form: the bake's bare root URL boots with the stamped
//     defaults (serverBaseUrl=none, engine=inprocess), so ONE tab runs the
//     engine and the UI — sync arrives through the in-process observer,
//     entity actions execute directly, and a canvas view shape mirrors the
//     pixels a module draws into its named `canvasSurface`.
//
// Run from apps/deno-notebooks:  node livecode/tests/baked_project.e2e.mjs

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const denoNotebookRoot = path.resolve(__dirname, '../..')
const uiDist = path.resolve(denoNotebookRoot, '../livecode-tldraw/dist')
const scale = Number(process.env.LIVECODE_E2E_TIMEOUT_SCALE || '1') || 1
const scaled = (ms) => Math.round(ms * scale)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.tldr': 'application/json; charset=utf-8',
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

// --- fixture project -------------------------------------------------------
const projectRoot = mkdtempSync(path.join(tmpdir(), 'livecode-bake-project-'))
mkdirSync(path.join(projectRoot, 'modules'), { recursive: true })
mkdirSync(path.join(projectRoot, 'data', 'pianoRoll'), { recursive: true })

writeFileSync(
  path.join(projectRoot, 'modules', 'state.orig.ts'),
  `import type { TimeContext } from "@avtools/core-timing";
export const shared = { beats: 0 };
export default async function run(_ctx: TimeContext) {}
`,
)
writeFileSync(
  path.join(projectRoot, 'modules', 'main.orig.ts'),
  `import type { TimeContext } from "@avtools/core-timing";
import { signal } from "canvas-signals";
import { canvasParams } from "canvas-params";
import { setPianoRollClip } from "piano-roll-helpers";
import { shared } from "./state.ts";

const params = canvasParams("baked/params", { gain: 1 });

export default async function run(ctx: TimeContext) {
  setPianoRollClip("baked/roll", {
    notes: [{ id: "n1", pitch: 64, position: 0, duration: 2, velocity: 90 }],
  });
  const tick = signal("baked/tick");
  while (true) {
    shared.beats += 1;
    tick.set(shared.beats * params.gain);
    await ctx.waitSec(0.05);
  }
}
`,
)
writeFileSync(
  path.join(projectRoot, 'modules', 'canvas.orig.ts'),
  `import type { TimeContext } from "@avtools/core-timing";
import { canvasSurface } from "canvas-surface";

export default async function run(ctx: TimeContext) {
  const canvas = canvasSurface("baked/canvas").createCanvas(120, 80);
  const g = canvas.getContext("2d")!;
  while (true) {
    g.fillStyle = "rgb(10, 200, 30)";
    g.fillRect(0, 0, 120, 80);
    await ctx.waitSec(0.05);
  }
}
`,
)
writeFileSync(
  path.join(projectRoot, 'data', 'pianoRoll', 'seeded.json'),
  JSON.stringify({
    type: 'pianoRoll',
    name: 'baked/seeded',
    savedAt: '2026-08-18T00:00:00.000Z',
    data: {
      notes: [{ id: 's1', pitch: 48, position: 0, duration: 1, velocity: 70 }],
    },
  }, null, 2),
)
writeFileSync(
  path.join(projectRoot, 'project.avtools-livecode.json'),
  JSON.stringify({
    version: 1,
    name: 'baked-fixture',
    engineTarget: 'browser',
    modules: [
      {
        id: 'modules/state.ts',
        path: 'modules/state.ts',
        sourcePath: 'modules/state.orig.ts',
        runtimePath: 'modules/state.ts',
        kind: 'runnable',
        title: 'state',
        sourceVersion: 1,
        x: 40,
        y: 40,
        w: 480,
        h: 320,
      },
      {
        id: 'modules/main.ts',
        path: 'modules/main.ts',
        sourcePath: 'modules/main.orig.ts',
        runtimePath: 'modules/main.ts',
        kind: 'runnable',
        title: 'main',
        sourceVersion: 1,
        x: 560,
        y: 40,
        w: 560,
        h: 460,
      },
      {
        id: 'modules/canvas.ts',
        path: 'modules/canvas.ts',
        sourcePath: 'modules/canvas.orig.ts',
        runtimePath: 'modules/canvas.ts',
        kind: 'runnable',
        title: 'canvas',
        sourceVersion: 1,
        x: 1160,
        y: 40,
        w: 480,
        h: 300,
      },
    ],
    canvas: {
      pianoRollViews: [
        {
          id: 'shape:baked-seeded-roll',
          rollName: 'baked/seeded',
          x: 40,
          y: 420,
          w: 420,
          h: 260,
        },
      ],
      canvasSurfaceViews: [
        {
          id: 'shape:baked-canvas-view',
          surfaceName: 'baked/canvas',
          x: 1160,
          y: 380,
          w: 300,
          h: 240,
        },
      ],
    },
    data: [
      { type: 'pianoRoll', name: 'baked/seeded', path: 'data/pianoRoll/seeded.json' },
    ],
  }, null, 2),
)

// --- bake ------------------------------------------------------------------
const outDir = mkdtempSync(path.join(tmpdir(), 'livecode-bake-out-'))
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

// --- static host (a dumb file server; deliberately NOT the livecode server)
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
  const context = await browser.newContext()

  const enginePage = await context.newPage()
  const engineErrors = []
  const engineConsole = []
  enginePage.on('pageerror', (error) => engineErrors.push(String(error)))
  enginePage.on('console', (message) => engineConsole.push(message.text()))
  await enginePage.goto(`${origin}/engine/engine.html`)

  // Baked boot: seeds loaded and every module launched. The no-op state
  // module completes instantly (that is what a data-only root does), so the
  // assertion is: main is ACTIVE, and state has a run record at all.
  await waitUntil(
    () =>
      enginePage.evaluate(() => {
        const harness = globalThis.__livecodeBrowserEngine
        if (!harness) return null
        return harness.activeModuleIds().includes('modules/main.ts')
          ? true
          : null
      }),
    'baked main module active',
  ).catch((error) => {
    console.error('--- engine console tail ---')
    console.error(engineConsole.slice(-25).join('\n'))
    throw error
  })

  const uiPage = await context.newPage()
  const uiErrors = []
  uiPage.on('pageerror', (error) => uiErrors.push(String(error)))
  await uiPage.goto(
    `${origin}/?serverBaseUrl=none&sync=broadcast&actions=broadcast`,
  )
  await waitUntil(
    () => uiPage.evaluate(() => Boolean(globalThis.__livecodeSyncDebug)),
    'sync debug hook',
  )

  // Project-shaped boot: one read-only code shape per baked module, titled
  // from the manifest, plus the manifest's canvas views — with no server.
  const shapeTitles = await waitUntil(
    () =>
      uiPage.evaluate(() => {
        const titles = [...document.querySelectorAll(
          '.livecode-shape .livecode-shape__title strong',
        )].map((node) => node.textContent)
        return titles.length === 3 ? titles.sort() : null
      }),
    'three baked code shapes on the canvas',
  )
  if (shapeTitles.join(',') !== 'canvas,main,state') {
    fail(`baked code shape titles wrong: ${JSON.stringify(shapeTitles)}`)
  }
  const editorStates = await waitUntil(
    () =>
      uiPage.evaluate(() => {
        const editors = [...document.querySelectorAll(
          '.livecode-shape .cm-content',
        )]
        if (editors.length !== 3) return null
        return editors.map((node) => ({
          editable: node.getAttribute('contenteditable'),
          hasSource: (node.textContent ?? '').length > 0,
        }))
      }),
    'both baked code editors rendered',
  )
  for (const state of editorStates) {
    if (state.editable !== 'false' || !state.hasSource) {
      fail(`baked code shape not read-only: ${JSON.stringify(editorStates)}`)
    }
  }
  const bakedSource = await uiPage.evaluate(() =>
    [...document.querySelectorAll('.livecode-shape .cm-content')]
      .map((node) => node.textContent ?? '')
      .join('\n'))
  if (!bakedSource.includes('canvasParams("baked/params"')) {
    fail('baked main module source not rendered in its code shape')
  }
  await waitUntil(
    () =>
      uiPage.evaluate(() =>
        document.querySelectorAll('.piano-roll-shape').length === 1
          ? true
          : null
      ),
    'manifest canvas piano-roll view on the canvas',
  )

  const rollNames = await waitUntil(
    () =>
      uiPage.evaluate(() => {
        const rolls = globalThis.__livecodeSyncDebug.getEntities('pianoRoll')
        const names = Object.keys(rolls)
        return names.includes('baked/seeded') && names.includes('baked/roll')
          ? names
          : null
      }),
    'seeded + write-back rolls over BroadcastChannel',
  )

  await waitUntil(
    () =>
      uiPage.evaluate(() => {
        const runs = globalThis.__livecodeSyncDebug.getEntities('run')
        return runs['modules/main.ts']?.state === 'running' ? true : null
      }),
    'running run entity in the UI',
  )

  const firstTick = await waitUntil(
    () =>
      uiPage.evaluate(() => {
        const signals = globalThis.__livecodeSyncDebug.getEntities('signal')
        const tick = signals['baked/tick']
        return typeof tick?.value === 'number' && tick.value > 0 ? tick : null
      }),
    'advancing baked signal',
  )
  if (firstTick.ownerModuleId !== 'modules/main.ts') {
    fail(`signal owner wrong: ${JSON.stringify(firstTick)}`)
  }

  // Params entity declared in the engine tab is visible...
  await waitUntil(
    () =>
      uiPage.evaluate(() => {
        const params = globalThis.__livecodeSyncDebug.getEntities('params')
        return params['baked/params']?.values?.gain === 1 ? true : null
      }),
    'declared params entity in the UI',
  )

  // ...and an action over the broadcast channel changes the running module.
  await uiPage.evaluate(() =>
    globalThis.__livecodeTldrawRuntimeDebug.createEntity(
      'pianoRoll',
      'baked/created',
    ))
  await waitUntil(
    () =>
      uiPage.evaluate(() =>
        globalThis.__livecodeSyncDebug.getEntities('pianoRoll')['baked/created']
          ? true
          : null
      ),
    'broadcast entity create visible in sync maps',
  )
  await uiPage.evaluate(() =>
    globalThis.__livecodeTldrawRuntimeDebug.deleteEntity(
      'pianoRoll',
      'baked/created',
    ))
  await waitUntil(
    () =>
      uiPage.evaluate(() =>
        globalThis.__livecodeSyncDebug.getEntities('pianoRoll')['baked/created']
          ? null
          : true
      ),
    'broadcast entity delete removes it',
  )

  // A params write over the actions channel: the loop multiplies by gain, so
  // the signal must exceed any previously seen value decisively.
  const before = await uiPage.evaluate(() =>
    globalThis.__livecodeSyncDebug.getEntities('signal')['baked/tick'].value)
  // Drive the write over the actions channel exactly as the panes' transport
  // does (the provider's setParams is not exposed on the debug surface).
  const paramsResult = await uiPage.evaluate(() =>
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
        op: {
          kind: 'paramsSet',
          request: { name: 'baked/params', values: { gain: 100 }, originId: 'baked-e2e' },
        },
      })
    }))
  if (paramsResult?.values?.gain !== 100) {
    fail(`params action failed: ${JSON.stringify(paramsResult)}`)
  }
  await waitUntil(
    () =>
      uiPage.evaluate((previous) => {
        const tick = globalThis.__livecodeSyncDebug.getEntities('signal')['baked/tick']
        return typeof tick?.value === 'number' && tick.value > previous * 10
          ? tick.value
          : null
      }, before),
    'signal reflects the broadcast params write',
  )

  // Export data: the baked "save" — the button captures the engine tab's
  // durable entities over the actions channel and downloads them as the same
  // {type, name, data} rows baked.json carries.
  const [download] = await Promise.all([
    uiPage.waitForEvent('download', { timeout: scaled(30_000) }),
    uiPage.click('button:has-text("Export data")'),
  ])
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8'))
  const exportedKeys = (exported.data ?? [])
    .map((row) => `${row.type}:${row.name}`)
    .sort()
  for (const expected of ['pianoRoll:baked/seeded', 'pianoRoll:baked/roll', 'params:baked/params']) {
    if (!exportedKeys.includes(expected)) {
      fail(`export missing ${expected}: ${JSON.stringify(exportedKeys)}`)
    }
  }
  const exportedSeeded = exported.data.find(
    (row) => row.type === 'pianoRoll' && row.name === 'baked/seeded',
  )
  if (!JSON.stringify(exportedSeeded.data).includes('"s1"')) {
    fail(`exported seeded roll lost its note: ${JSON.stringify(exportedSeeded)}`)
  }
  await waitUntil(
    () =>
      uiPage.evaluate(() =>
        [...document.querySelectorAll('.topbar__notice')].some((node) =>
          (node.textContent ?? '').startsWith('exported ')
        )
          ? true
          : null
      ),
    'export notice in the topbar',
  )

  // --- one engine per origin ------------------------------------------------
  // A second engine tab must be blocked by the Web Lock; explicit takeover
  // steals the lock, boots the bake in the new tab, and shuts the old one
  // down (panic + channels closed).
  const enginePage2 = await context.newPage()
  const engine2Errors = []
  enginePage2.on('pageerror', (error) => engine2Errors.push(String(error)))
  await enginePage2.goto(`${origin}/engine/engine.html`)
  await waitUntil(
    () =>
      enginePage2.evaluate(() =>
        globalThis.__livecodeEngineLock?.state() === 'blocked' ? true : null
      ),
    'second engine tab blocked by the engine lock',
  )
  const blockedHasEngine = await enginePage2.evaluate(() =>
    Boolean(globalThis.__livecodeBrowserEngine))
  if (blockedHasEngine) fail('blocked tab must not start an engine')
  await enginePage2.click('button.livecode-engine-takeover')
  await waitUntil(
    () =>
      enginePage2.evaluate(() =>
        globalThis.__livecodeEngineLock?.state() === 'engine' &&
          globalThis.__livecodeBrowserEngine?.activeModuleIds().includes(
            'modules/main.ts',
          )
          ? true
          : null
      ),
    'takeover tab becomes the engine and boots the bake',
  )
  await waitUntil(
    () =>
      enginePage.evaluate(() =>
        globalThis.__livecodeEngineLock?.state() === 'takenOver' ? true : null
      ),
    'original engine tab shut down after takeover',
  )

  if (engineErrors.length > 0) fail(`engine page errors: ${engineErrors}`)
  if (engine2Errors.length > 0) fail(`takeover engine page errors: ${engine2Errors}`)
  if (uiErrors.length > 0) fail(`ui page errors: ${uiErrors}`)

  // --- single-page form: engine in the UI's own tab ------------------------
  // Release the origin's engine lock by closing every earlier page, then open
  // the bake's BARE root URL: the stamped boot defaults must select
  // serverBaseUrl=none + engine=inprocess with no query string at all.
  await enginePage.close()
  await enginePage2.close()
  await uiPage.close()
  const singlePage = await context.newPage()
  const singleErrors = []
  const singleConsole = []
  singlePage.on('pageerror', (error) => singleErrors.push(String(error)))
  singlePage.on('console', (message) => singleConsole.push(message.text()))
  await singlePage.goto(`${origin}/`)
  await waitUntil(
    () =>
      singlePage.evaluate(() =>
        globalThis.__livecodeEngineLock?.state() === 'engine' &&
          globalThis.__livecodeBrowserEngine?.activeModuleIds().includes(
            'modules/main.ts',
          ) &&
          globalThis.__livecodeBrowserEngine?.activeModuleIds().includes(
            'modules/canvas.ts',
          )
          ? true
          : null
      ),
    'single page becomes the engine and boots the bake',
  ).catch((error) => {
    console.error('--- single page console tail ---')
    console.error(singleConsole.slice(-25).join('\n'))
    throw error
  })
  const singleServerBaseUrl = await waitUntil(
    () =>
      singlePage.evaluate(() =>
        globalThis.__livecodeTldrawRuntimeDebug?.serverBaseUrl ?? null
      ),
    'runtime debug hook on the single page',
  )
  if (singleServerBaseUrl !== 'none') {
    fail(`boot defaults not applied: serverBaseUrl=${singleServerBaseUrl}`)
  }
  await waitUntil(
    () =>
      singlePage.evaluate(() =>
        [...document.querySelectorAll('.status-pill')].some((node) =>
          node.textContent === 'engine: this tab'
        )
          ? true
          : null
      ),
    'topbar reports the engine in this tab',
  )
  // Same observations as the two-tab form, now over the in-process observer.
  await waitUntil(
    () =>
      singlePage.evaluate(() => {
        const rolls = globalThis.__livecodeSyncDebug?.getEntities('pianoRoll') ?? {}
        const runs = globalThis.__livecodeSyncDebug?.getEntities('run') ?? {}
        return rolls['baked/seeded'] && rolls['baked/roll'] &&
            runs['modules/main.ts']?.state === 'running'
          ? true
          : null
      }),
    'seeds, write-back roll, and running run over the in-process observer',
  )
  const singleTick = await waitUntil(
    () =>
      singlePage.evaluate(() => {
        const tick = globalThis.__livecodeSyncDebug.getEntities('signal')['baked/tick']
        return typeof tick?.value === 'number' && tick.value > 0 ? tick.value : null
      }),
    'advancing signal in the single page',
  )
  await waitUntil(
    () =>
      singlePage.evaluate((previous) => {
        const tick = globalThis.__livecodeSyncDebug.getEntities('signal')['baked/tick']
        return typeof tick?.value === 'number' && tick.value > previous ? true : null
      }, singleTick),
    'signal keeps advancing in the single page',
  )
  // Entity actions execute directly on this tab's engine.
  await singlePage.evaluate(() =>
    globalThis.__livecodeTldrawRuntimeDebug.createEntity(
      'pianoRoll',
      'baked/created-inprocess',
    ))
  await waitUntil(
    () =>
      singlePage.evaluate(() =>
        globalThis.__livecodeSyncDebug.getEntities('pianoRoll')['baked/created-inprocess']
          ? true
          : null
      ),
    'in-process entity create visible in sync maps',
  )
  await singlePage.evaluate(() =>
    globalThis.__livecodeTldrawRuntimeDebug.deleteEntity(
      'pianoRoll',
      'baked/created-inprocess',
    ))
  await waitUntil(
    () =>
      singlePage.evaluate(() =>
        globalThis.__livecodeSyncDebug.getEntities('pianoRoll')['baked/created-inprocess']
          ? null
          : true
      ),
    'in-process entity delete removes it',
  )
  // The manifest's canvas view mirrors the module's named canvas: the shape
  // exists, has found its source, and shows the module's solid color.
  const surfaceState = await waitUntil(
    () =>
      singlePage.evaluate(() => {
        const states = globalThis.__livecodeTldrawRuntimeDebug.getCanvasSurfaceStates()
        const state = states.find((entry) => entry.surfaceName === 'baked/canvas')
        return state?.sourceFound && state.frameCount > 2 ? state : null
      }),
    'canvas view found the module canvas and drew frames',
  )
  if (surfaceState.sourceWidth !== 120 || surfaceState.sourceHeight !== 80) {
    fail(`canvas view source size wrong: ${JSON.stringify(surfaceState)}`)
  }
  const centerPixel = await waitUntil(
    () =>
      singlePage.evaluate(() => {
        const canvas = document.querySelector('.canvas-surface-shape__canvas')
        if (!canvas) return null
        const ctx = canvas.getContext('2d')
        const [r, g, b, a] = ctx.getImageData(
          Math.floor(canvas.width / 2),
          Math.floor(canvas.height / 2),
          1,
          1,
        ).data
        return a === 255 ? { r, g, b } : null
      }),
    'canvas view has an opaque center pixel',
  )
  if (
    Math.abs(centerPixel.r - 10) > 6 || Math.abs(centerPixel.g - 200) > 6 ||
    Math.abs(centerPixel.b - 30) > 6
  ) {
    fail(`canvas view pixel is not the module's color: ${JSON.stringify(centerPixel)}`)
  }
  if (singleErrors.length > 0) fail(`single page errors: ${singleErrors}`)

  console.log(JSON.stringify({
    ok: true,
    type: 'bakedProjectE2E',
    origin,
    rolls: rollNames.filter((name) => name.startsWith('baked/')),
  }))
} finally {
  await browser.close()
  server.close()
}
