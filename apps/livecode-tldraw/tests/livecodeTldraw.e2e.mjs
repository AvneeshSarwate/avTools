import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 20) {
  throw new Error(
    `livecode-tldraw E2E requires Node >=20 for Vite/Playwright; current Node is ${process.version}`
  )
}

const tldrawAppRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(tldrawAppRoot, '../..')
const denoNotebookRoot = path.join(repoRoot, 'apps/deno-notebooks')
const denoServerPath = path.join(denoNotebookRoot, 'livecode/visualizer/main.ts')
const sessionRoot = path.join(
  denoNotebookRoot,
  '.avtools-livecode-sessions',
  `tldraw-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`
)
const headless = process.env.PW_HEADLESS !== '0'

const serverOutput = []
const viteOutput = []
const browserOutput = []
let browser
let page
let serverProc
let viteProc
let firstModuleId = ''

function assert(value, message) {
  if (!value) throw new Error(message)
}

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  assert(a === e, `${label}: expected ${e}, received ${a}`)
}

try {
  mkdirSync(sessionRoot, { recursive: true })

  const serverReady = startDenoServer()
  const viteBaseUrl = await startVite()
  const serverInfo = await serverReady

  browser = await launchBrowserWithRetry()
  page = await browser.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserOutput.push(`[browser:${message.type()}] ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => {
    browserOutput.push(`[browser:pageerror] ${error.stack ?? error.message}`)
  })

  await page.goto(tldrawUrl(viteBaseUrl, serverInfo.baseUrl), {
    waitUntil: 'domcontentloaded',
  })
  await page.locator('.livecode-shape').first().waitFor({ timeout: 20_000 })
  await waitForPageValue(
    () => Boolean(window.__livecodeTldrawRuntimeDebug),
    'tldraw runtime debug hooks installed',
    10_000
  )
  await page.evaluate(() => window.__livecodeTldrawRuntimeDebug?.connect())
  await waitForTldrawReady()

  // The default canvas creates one livecode-editor shape. Grab its module id.
  firstModuleId = await waitForFirstModuleId()

  await runPianoRollLookupManifestCase()
  await runPianoRollWidgetStaticNameCase()
  await runPianoRollWidgetRuntimeResolvedCase()
  await runLookupOnlyModuleCompletesStoppedCase()
  await runOpenPianoRollCreatesShapeCase()
  await runOpenPianoRollFocusesExistingShapeCase()

  console.log(
    JSON.stringify({
      ok: true,
      type: 'livecodeTldrawE2E',
      serverBaseUrl: serverInfo.baseUrl,
      viteBaseUrl,
      moduleId: firstModuleId,
      sessionRoot,
    })
  )
} catch (error) {
  await writeFailureArtifacts(error)
  throw error
} finally {
  await browser?.close().catch(() => {})
  await stopProcess(viteProc)
  await stopProcess(serverProc)
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

/**
 * The default source reads the "melody" roll via a const-bound name
 * (`getPianoRollClip(melodyName)`). The analyzer should record a
 * `pianoRollLookup` callsite with a nameArgRange but no staticName (the arg is
 * an identifier). It should also record `setPianoRollClip` (string literal
 * "bass"... actually the default writes back to `melodyName`, an identifier).
 */
async function runPianoRollLookupManifestCase() {
  const source = `import type { TimeContext } from "@avtools/core-timing";
import { getPianoRollClip, setPianoRollClip } from "piano-roll-helpers";

export default async function(ctx: TimeContext) {
  const clip = getPianoRollClip("melody");
  setPianoRollClip("bass", clip);
  await ctx.waitSec(0.01);
}
`
  await setSource(source)
  const manifest = await waitForManifest(firstModuleId, 3, 'piano roll lookup manifest')
  const pianoRollCallsites = manifest.callsites.filter(
    (c) => c.kind === 'pianoRollLookup'
  )
  assert(
    pianoRollCallsites.length === 2,
    `expected 2 pianoRollLookup callsites, got ${pianoRollCallsites.length}`
  )
  assertEqual(
    pianoRollCallsites.map((c) => c.displayName),
    ['getPianoRollClip', 'setPianoRollClip'],
    'piano roll lookup display names'
  )
  // String literal args should produce a staticName + nameArgRange.
  assertEqual(
    pianoRollCallsites.map((c) => c.staticName),
    ['melody', 'bass'],
    'piano roll lookup static names'
  )
  for (const entry of pianoRollCallsites) {
    assert(entry.nameArgRange, 'pianoRollLookup entry should have nameArgRange')
    assert(
      entry.nameArgRange.from < entry.nameArgRange.to,
      'nameArgRange should be ordered'
    )
  }
  // The third callsite is the ctx.waitSec.
  assertEqual(
    manifest.callsites[2].displayName,
    'ctx.waitSec',
    'third callsite is ctx.waitSec'
  )
}

/**
 * Before the module runs, the editor should render open-button widgets using
 * the static literal name fallback (rendered with a trailing `?`).
 */
async function runPianoRollWidgetStaticNameCase() {
  // Source already set + analyzed by the previous case.
  await waitForPianoRollButtons(['melody', 'bass'], {
    expectQuestionMark: true,
    label: 'static-name widgets',
  })
}

/**
 * After running the module, the runtime snapshot should report resolved
 * pianoRollLookups, and the widgets should update to show the resolved names
 * without the `?` suffix.
 */
async function runPianoRollWidgetRuntimeResolvedCase() {
  await runModule(firstModuleId)
  await waitForPianoRollLookups(firstModuleId, {
    'melody-callsite': undefined, // placeholder, real check below
  })

  // Wait until the runtime reports a pianoRollLookup for at least one of the
  // two callsites, then verify both resolved names appear.
  await waitForResolvedLookups(firstModuleId, ['melody', 'bass'], 'runtime-resolved lookups')
  await waitForPianoRollButtons(['melody', 'bass'], {
    expectQuestionMark: false,
    label: 'runtime-resolved widgets',
  })
  await stopModule(firstModuleId)
}

/**
 * A module with piano-roll lookup callsites but no waits should not stay
 * stuck in the running UI state after it completes.
 */
async function runLookupOnlyModuleCompletesStoppedCase() {
  await setSource(`import type { TimeContext } from "@avtools/core-timing";
import { getPianoRollClip } from "piano-roll-helpers";

export default async function(ctx: TimeContext) {
  void ctx;
  void getPianoRollClip("melody");
}
`)
  await waitForManifest(firstModuleId, 1, 'lookup-only manifest')
  await runModule(firstModuleId)
  await waitForResolvedLookups(firstModuleId, ['melody'], 'lookup-only runtime lookup')
  await waitForPageValue(
    (moduleId) =>
      window.__livecodeTldrawRuntimeDebug?.modules[moduleId]?.runStatus === 'stopped',
    'lookup-only module stopped after completion',
    15_000,
    firstModuleId
  )
}

/**
 * Clicking an open button should create a `piano-roll-view` shape for that
 * roll name next to the code module.
 */
async function runOpenPianoRollCreatesShapeCase() {
  // Ensure no piano-roll-view shape exists for "melody" yet (the default
  // canvas creates one for "melody", so delete it first to test creation).
  await deletePianoRollShapes()
  const before = await getShapes()
  assert(
    !before.some((s) => s.type === 'piano-roll-view'),
    'no piano-roll-view shapes before opening'
  )

  await setSource(`import type { TimeContext } from "@avtools/core-timing";
import { getPianoRollClip } from "piano-roll-helpers";

export default async function(ctx: TimeContext) {
  const clip = getPianoRollClip("harmony");
  await ctx.waitSec(0.01);
}
`)
  await waitForManifest(firstModuleId, 2, 'open-button create manifest')
  await waitForPianoRollButtons(['harmony'], {
    expectQuestionMark: true,
    label: 'harmony widget',
  })

  await clickPianoRollButton('harmony')

  const after = await waitForShapeOfType('piano-roll-view', 'piano-roll-view created')
  const created = after.find((s) => s.props.rollName === 'harmony')
  assert(created, 'a piano-roll-view shape for "harmony" should be created')
  assertEqual(created.props.rollName, 'harmony', 'created shape rollName')
}

/**
 * Clicking an open button when a matching piano-roll-view already exists
 * should focus/select that shape rather than create a new one.
 */
async function runOpenPianoRollFocusesExistingShapeCase() {
  // Re-use the "harmony" shape from the previous case (still present).
  const before = await getShapes()
  const existingHarmony = before.filter(
    (s) => s.type === 'piano-roll-view' && s.props.rollName === 'harmony'
  )
  assert(
    existingHarmony.length === 1,
    `expected exactly one harmony piano-roll-view, got ${existingHarmony.length}`
  )

  const livecodeShape = before.find((s) => s.type === 'livecode-editor')
  assert(livecodeShape, 'expected a livecode-editor shape to select before focusing')
  await page.evaluate((id) => {
    window.__livecodeTldrawRuntimeDebug?.selectShape(id)
  }, livecodeShape.id)
  await waitForPageValue(
    (id) => window.__livecodeTldrawRuntimeDebug?.getSelectedShapeIds().includes(id),
    'livecode shape selected before focus test',
    5_000,
    livecodeShape.id
  )

  await clickPianoRollButton('harmony')

  // No new harmony shape should appear: count stays at 1.
  await sleep(300)
  const after = await getShapes()
  const afterHarmony = after.filter(
    (s) => s.type === 'piano-roll-view' && s.props.rollName === 'harmony'
  )
  assertEqual(
    afterHarmony.length,
    1,
    'clicking open on an existing roll should not create a duplicate'
  )
  await waitForPageValue(
    (id) => window.__livecodeTldrawRuntimeDebug?.getSelectedShapeIds().includes(id),
    'existing piano-roll-view selected after focusing',
    5_000,
    existingHarmony[0].id
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setSource(source) {
  await page.evaluate(({ moduleId, source }) => {
    window.__livecodeTldrawRuntimeDebug?.setSource(moduleId, source)
  }, { moduleId: firstModuleId, source })
  // Mirror the source into the tldraw shape prop so the shape re-renders.
  // setModuleSource updates the runtime record; the shape prop is updated
  // separately by the editor's onChange. For the test we drive via the debug
  // API only, which is enough to trigger analyze + decorations because the
  // manifest + lookups come from the runtime store, not the shape prop.
  await waitForPageValue(
    (expected) =>
      window.__livecodeTldrawRuntimeDebug?.modules[expected.moduleId]?.sourceText ===
      expected.source,
    'source text applied to runtime',
    5_000,
    { moduleId: firstModuleId, source }
  )
}

async function runModule(moduleId) {
  await page.evaluate((moduleId) => {
    return window.__livecodeTldrawRuntimeDebug?.runModule(moduleId)
  }, moduleId)
}

async function stopModule(moduleId) {
  await page.evaluate((moduleId) => {
    return window.__livecodeTldrawRuntimeDebug?.stopModule(moduleId)
  }, moduleId)
}

async function waitForManifest(moduleId, expectedCount, label) {
  return await waitForPageValue(
    ({ moduleId, expectedCount }) => {
      const mod = window.__livecodeTldrawRuntimeDebug?.modules[moduleId]
      const manifest = mod?.manifest
      if (!manifest || manifest.callsites.length !== expectedCount) return null
      return manifest
    },
    label,
    15_000,
    { moduleId, expectedCount }
  )
}

async function waitForPianoRollLookups(_moduleId, _expected) {
  // Kept for API symmetry; real work is in waitForResolvedLookups.
}

async function waitForResolvedLookups(moduleId, expectedNames, label) {
  return await waitForPageValue(
    ({ moduleId, expectedNames }) => {
      const mod = window.__livecodeTldrawRuntimeDebug?.modules[moduleId]
      const lookups = mod?.pianoRollLookups ?? {}
      const values = Object.values(lookups)
      if (expectedNames.every((name) => values.includes(name))) {
        return lookups
      }
      return null
    },
    label,
    15_000,
    { moduleId, expectedNames }
  )
}

async function waitForPianoRollButtons(expectedNames, { expectQuestionMark, label }) {
  await waitForPageValue(
    ({ expectedNames, expectQuestionMark }) => {
      const buttons = Array.from(
        document.querySelectorAll('.ltc-piano-roll-open-btn')
      ).map((b) => b.textContent ?? '')
      const normalize = (text) => text.replace(/^🎹\s*open\s*/, '').trim()
      const labels = buttons.map(normalize)
      const want = expectedNames.map((name) =>
        expectQuestionMark ? `${name}?` : name
      )
      return want.every((w) => labels.includes(w)) ? labels : null
    },
    label,
    10_000,
    { expectedNames, expectQuestionMark }
  )
}

async function clickPianoRollButton(rollName) {
  const clicked = await page.evaluate((rollName) => {
    const buttons = Array.from(
      document.querySelectorAll('.ltc-piano-roll-open-btn')
    )
    const target = buttons.find((b) => (b.textContent ?? '').includes(rollName))
    if (!target) return false
    target.click()
    return true
  }, rollName)
  if (!clicked) {
    throw new Error(`No piano roll open button matching "${rollName}" found`)
  }
}

async function getShapes() {
  return await page.evaluate(() => window.__livecodeTldrawRuntimeDebug?.getShapes() ?? [])
}

async function waitForShapeOfType(type, label) {
  return await waitForPageValue(
    (type) => {
      const shapes = window.__livecodeTldrawRuntimeDebug?.getShapes() ?? []
      const matching = shapes.filter((s) => s.type === type)
      return matching.length > 0 ? matching : null
    },
    label,
    10_000,
    type
  )
}

async function deletePianoRollShapes() {
  await page.evaluate(() => {
    const dbg = window.__livecodeTldrawRuntimeDebug
    if (!dbg) return
    const shapes = dbg.getShapes().filter((s) => s.type === 'piano-roll-view')
    // We cannot delete via the debug API; instead, select each and rely on
    // keyboard delete. Use the page keyboard.
    for (const s of shapes) dbg.selectShape(s.id)
  })
  // Delete via keyboard.
  const pianoRollCount = await page.evaluate(
    () =>
      (window.__livecodeTldrawRuntimeDebug?.getShapes() ?? []).filter(
        (s) => s.type === 'piano-roll-view'
      ).length
  )
  if (pianoRollCount > 0) {
    await page.keyboard.press('Delete')
    await waitForPageValue(
      () =>
        (window.__livecodeTldrawRuntimeDebug?.getShapes() ?? []).filter(
          (s) => s.type === 'piano-roll-view'
        ).length === 0,
      'piano-roll-view shapes deleted',
      5_000
    )
  }
}

async function waitForFirstModuleId() {
  return await waitForPageValue(
    () => {
      const ids = window.__livecodeTldrawRuntimeDebug?.getModuleIds() ?? []
      return ids.length > 0 ? ids[0] : null
    },
    'first livecode module id',
    20_000
  )
}

async function waitForTldrawReady() {
  await waitForPageValue(
    () => window.__livecodeTldrawRuntimeDebug?.connectionStatus === 'open',
    'runtime connected to server',
    30_000
  )
}

async function waitForPageValue(predicate, label, timeoutMs = 5_000, arg) {
  const start = Date.now()
  let lastError
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await page.evaluate(predicate, arg)
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await sleep(50)
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function tldrawUrl(viteBaseUrl, serverBaseUrl) {
  const url = new URL('/', viteBaseUrl)
  url.searchParams.set('serverBaseUrl', serverBaseUrl)
  return url.href
}

function startDenoServer() {
  return new Promise((resolve, reject) => {
    serverProc = spawn(
      process.env.DENO_BIN ?? 'deno',
      [
        'run',
        '--unstable-webgpu',
        '--unstable-ffi',
        '--allow-all',
        denoServerPath,
        '--host',
        '127.0.0.1',
        '--port',
        '0',
        '--session-root',
        sessionRoot,
        '--log-level',
        'debug',
      ],
      {
        cwd: denoNotebookRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    let settled = false
    serverProc.stdout.setEncoding('utf8')
    serverProc.stderr.setEncoding('utf8')
    serverProc.stdout.on('data', (chunk) => {
      serverOutput.push(chunk)
      for (const line of chunk.split(/\r?\n/)) {
        const parsed = parseJsonLogLine(line)
        if (!settled && parsed?.type === 'serverReady') {
          settled = true
          resolve(parsed)
        }
      }
    })
    serverProc.stderr.on('data', (chunk) => serverOutput.push(chunk))
    serverProc.once('exit', (code, signal) => {
      if (!settled) {
        reject(new Error(`Deno server exited early: ${code ?? signal}`))
      }
    })
  })
}

async function launchBrowserWithRetry(attempts = 5) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await chromium.launch({ headless })
    } catch (error) {
      lastError = error
      if (attempt === attempts) break
      await sleep(2_000 * attempt)
    }
  }
  throw lastError
}

async function startVite() {
  const port = await getFreePort()
  const viteBaseUrl = `http://127.0.0.1:${port}/`
  viteProc = spawn(
    process.execPath,
    [
      path.join(tldrawAppRoot, 'node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      cwd: tldrawAppRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  viteProc.stdout.setEncoding('utf8')
  viteProc.stderr.setEncoding('utf8')
  viteProc.stdout.on('data', (chunk) => viteOutput.push(chunk))
  viteProc.stderr.on('data', (chunk) => viteOutput.push(chunk))
  viteProc.once('exit', (code, signal) => {
    viteOutput.push(`Vite exited: ${code ?? signal}`)
  })
  await waitForHttp(viteBaseUrl, 'tldraw vite dev server')
  return viteBaseUrl
}

async function waitForHttp(url, label, timeoutMs = 30_000) {
  const start = Date.now()
  let lastError
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch (error) {
      lastError = error
    }
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

async function getFreePort() {
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const port = address.port
  server.close()
  await once(server, 'close')
  return port
}

function parseJsonLogLine(line) {
  const cleanLine = line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim()
  const jsonStart = cleanLine.indexOf('{')
  if (jsonStart < 0) return null
  try {
    return JSON.parse(cleanLine.slice(jsonStart))
  } catch {
    return null
  }
}

async function writeFailureArtifacts(error) {
  const artifactDir = mkdtempSync(path.join(tmpdir(), 'livecode-tldraw-e2e-'))
  if (page) {
    await page
      .screenshot({ path: path.join(artifactDir, 'failure.png'), fullPage: true })
      .catch(() => {})
    writeFileSync(
      path.join(artifactDir, 'browser-errors.txt'),
      browserOutput.join('\n') || '(none)'
    )
  }
  writeFileSync(path.join(artifactDir, 'server-output.txt'), serverOutput.join('\n'))
  writeFileSync(path.join(artifactDir, 'vite-output.txt'), viteOutput.join('\n'))
  console.error(`E2E failure artifacts written to ${artifactDir}`)
  console.error(error.stack ?? error.message ?? String(error))
}

async function stopProcess(proc) {
  if (!proc) return
  try {
    proc.kill('SIGTERM')
  } catch {
    // already dead
  }
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3_000)
    proc.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}
