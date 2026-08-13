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
let serverBaseUrl = ''
let paramPaneShapeId = ''

// Fixtures for the params cases. They live here rather than beside those cases
// because the run block below executes before later top-level declarations are
// initialized.
const PARAMS_ENTITY_NAME = 'e2e/params'
const PARAMS_DECLARATION_SOURCE = `import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";

export const params = canvasParams("${PARAMS_ENTITY_NAME}", { gain: 0.5 });

export default async function(ctx: TimeContext) {
  while (true) {
    await ctx.waitSec(0.05);
  }
}
`
const PARAMS_CODE_WRITE_SOURCE = `import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";

export const params = canvasParams("${PARAMS_ENTITY_NAME}", { gain: 0.5 });

export default async function(ctx: TimeContext) {
  let step = 0;
  while (true) {
    params.gain = (step % 5) / 10;
    step += 1;
    await ctx.waitSec(0.1);
  }
}
`
/** How tweakpane renders the values `PARAMS_CODE_WRITE_SOURCE` cycles through. */
const CODE_WRITE_VALUES = ['0.00', '0.10', '0.20', '0.30', '0.40']

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
  serverBaseUrl = serverInfo.baseUrl

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
  await runParamPaneRendersDeclaredEntityCase()
  await runParamPaneEditWritesThroughCase()
  await runParamPaneShowsCodeWritesCase()
  await runParamPaneRehydratesAfterReloadCase()

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

/**
 * A module declares `canvasParams` at module scope; after launch the server
 * owns the entity and a pane created through the debug surface renders one
 * tweakpane binding per declared field. The declaration also produces a
 * `canvasParams` manifest entry, which the editor turns into a gutter button.
 */
async function runParamPaneRendersDeclaredEntityCase() {
  await setSource(PARAMS_DECLARATION_SOURCE)
  const manifest = await waitForManifest(firstModuleId, 2, 'params declaration manifest')
  assertEqual(
    manifest.callsites.map((c) => c.kind),
    ['canvasParams', 'timeContextMethod'],
    'params declaration callsite kinds'
  )
  assertEqual(
    manifest.callsites[0].staticName,
    PARAMS_ENTITY_NAME,
    'declared params static name'
  )
  await waitForParamPaneButtons([PARAMS_ENTITY_NAME], 'params declaration widget')

  await runModule(firstModuleId)
  const entity = await waitForParamsEntity(
    PARAMS_ENTITY_NAME,
    (candidate) => candidate.values.gain === 0.5,
    'declared params entity on the server'
  )
  assertEqual(entity.updatedBy, 'declare', 'declared params updatedBy')

  paramPaneShapeId = await createParamPane(PARAMS_ENTITY_NAME)
  assert(paramPaneShapeId, 'debug surface should return the new pane shape id')
  const shapes = await getShapes()
  const pane = shapes.find((s) => s.id === paramPaneShapeId)
  assert(pane, 'a param-pane shape should exist after creating one')
  assertEqual(pane.type, 'param-pane', 'created shape type')
  assertEqual(pane.props.paramsName, PARAMS_ENTITY_NAME, 'created shape paramsName')

  await waitForParamsBindingValue('gain', ['0.50'], 'declared gain binding renders')
}

/**
 * Editing the tweakpane input is a GUI write: it reaches the live object
 * through `/params/set`, so `/params/list` reports the new value, a bumped
 * rev, and this pane as the origin.
 */
async function runParamPaneEditWritesThroughCase() {
  const before = await fetchParamsEntity(PARAMS_ENTITY_NAME)
  assert(before, 'params entity should exist before the GUI edit')

  await setParamsBindingValue('gain', '0.75')

  const after = await waitForParamsEntity(
    PARAMS_ENTITY_NAME,
    (candidate) => candidate.values.gain === 0.75,
    'GUI edit applied to the server entity'
  )
  assert(
    after.rev > before.rev,
    `expected rev to advance past ${before.rev}, got ${after.rev}`
  )
  assertEqual(
    after.updatedBy,
    `param-pane-${paramPaneShapeId}`,
    'GUI write records the editing pane as its origin'
  )
  await waitForParamsBindingValue('gain', ['0.75'], 'edited gain binding')
}

/**
 * Code writes are plain property assignments, so only the server's sampler
 * observes them. The pane is a conflated monitor: its readout must follow a
 * running module with no client action at all.
 */
async function runParamPaneShowsCodeWritesCase() {
  await stopModule(firstModuleId)
  await waitForServerRunState(firstModuleId, false, 'module stopped before relaunch')

  await setSource(PARAMS_CODE_WRITE_SOURCE)
  await waitForManifest(firstModuleId, 2, 'params code-write manifest')
  const before = await fetchParamsEntity(PARAMS_ENTITY_NAME)
  assert(before, 'params entity should survive the relaunch')
  // Re-declaring the same name reattaches rather than resetting: the GUI value
  // is still there when the module starts writing.
  assertEqual(before.values.gain, 0.75, 'reattached params value')

  await runModule(firstModuleId)
  const entity = await waitForParamsEntity(
    PARAMS_ENTITY_NAME,
    (candidate) => candidate.updatedBy === 'code' && candidate.rev > before.rev,
    'sampler adopted the code writes'
  )
  assert(
    CODE_WRITE_VALUES.includes(formatBindingValue(entity.values.gain)),
    `code-written gain should be one of the cycled values, got ${entity.values.gain}`
  )
  await waitForParamsBindingValue(
    'gain',
    CODE_WRITE_VALUES,
    'pane readout follows code writes'
  )
}

/**
 * Reloading mid-run drops the whole canvas (no tldraw persistenceKey), but the
 * entity is server truth: a pane created after the reload rehydrates from the
 * snapshot alone, and the still-running module has not produced a second
 * entity for the same name.
 */
async function runParamPaneRehydratesAfterReloadCase() {
  const runningModuleId = firstModuleId
  const before = await fetchParamsEntity(PARAMS_ENTITY_NAME)
  assert(before, 'params entity should exist before the reload')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.livecode-shape').first().waitFor({ timeout: 20_000 })
  await waitForPageValue(
    () => Boolean(window.__livecodeTldrawRuntimeDebug),
    'tldraw runtime debug hooks installed after reload',
    10_000
  )
  await page.evaluate(() => window.__livecodeTldrawRuntimeDebug?.connect())
  await waitForTldrawReady()
  firstModuleId = await waitForFirstModuleId()

  const shapesAfterReload = await getShapes()
  assert(
    !shapesAfterReload.some((s) => s.type === 'param-pane'),
    'the transient canvas should not restore the pane by itself'
  )

  paramPaneShapeId = await createParamPane(PARAMS_ENTITY_NAME)
  await waitForParamsBindingValue(
    'gain',
    CODE_WRITE_VALUES,
    'pane rehydrates from the server snapshot after reload'
  )

  const snapshot = await fetchParamsList()
  const names = Object.keys(snapshot.params)
  assertEqual(
    names.filter((name) => name === PARAMS_ENTITY_NAME).length,
    1,
    'the reload must not create a second entity for the same name'
  )
  const after = snapshot.params[PARAMS_ENTITY_NAME]
  assert(
    after.rev > before.rev,
    `the module kept running across the reload: expected rev past ${before.rev}, got ${after.rev}`
  )

  // The pre-reload module is no longer registered in this browser session, so
  // stop it through the server directly.
  await stopModuleOverHttp(runningModuleId)
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

async function waitForParamPaneButtons(expectedNames, label) {
  await waitForPageValue(
    (expectedNames) => {
      const labels = Array.from(
        document.querySelectorAll('.ltc-param-pane-open-btn')
      ).map((b) => (b.textContent ?? '').replace(/^🎛\s*open\s*/, '').trim())
      return expectedNames.every((name) => labels.includes(name)) ? labels : null
    },
    label,
    10_000,
    expectedNames
  )
}

async function createParamPane(paramsName) {
  return await page.evaluate(
    (paramsName) =>
      window.__livecodeTldrawRuntimeDebug?.createParamPane(paramsName) ?? null,
    paramsName
  )
}

/**
 * One tweakpane binding row, located by its label. Rows are
 * `.tp-lblv` with a `.tp-lblv_l` label and a `.tp-txtv_i` value input.
 */
function paramsBindingInput(label) {
  return page
    .locator('.param-pane-shape .tp-lblv', { hasText: label })
    .locator('input.tp-txtv_i')
}

async function setParamsBindingValue(label, value) {
  const input = paramsBindingInput(label)
  await input.waitFor({ timeout: 10_000 })
  await input.fill(value)
  // Tweakpane commits a text binding on the input's change event.
  await input.press('Enter')
}

async function waitForParamsBindingValue(label, expectedValues, waitLabel) {
  return await waitForPageValue(
    ({ label, expectedValues }) => {
      const row = Array.from(
        document.querySelectorAll('.param-pane-shape .tp-lblv')
      ).find(
        (candidate) =>
          (candidate.querySelector('.tp-lblv_l')?.textContent ?? '').trim() === label
      )
      const input = row?.querySelector('input.tp-txtv_i')
      const value = input ? input.value : null
      return value !== null && expectedValues.includes(value) ? value : null
    },
    waitLabel,
    15_000,
    { label, expectedValues }
  )
}

/** Mirrors tweakpane's default two-decimal formatting for these fixtures. */
function formatBindingValue(value) {
  return typeof value === 'number' ? value.toFixed(2) : String(value)
}

async function fetchParamsList() {
  const response = await fetch(`${serverBaseUrl}/params/list`)
  if (!response.ok) {
    throw new Error(`/params/list failed with ${response.status}`)
  }
  return await response.json()
}

async function fetchParamsEntity(name) {
  const snapshot = await fetchParamsList()
  return snapshot.params[name] ?? null
}

async function waitForParamsEntity(name, predicate, label, timeoutMs = 20_000) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    try {
      const entity = await fetchParamsEntity(name)
      if (entity && predicate(entity)) return entity
      last = entity
    } catch (error) {
      last = { error: error.message }
    }
    await sleep(100)
  }
  throw new Error(
    `Timed out waiting for ${label} (last seen: ${JSON.stringify(last)})`
  )
}

async function waitForServerRunState(moduleId, shouldBeActive, label, timeoutMs = 15_000) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${serverBaseUrl}/runtime/status`)
      if (response.ok) {
        const status = await response.json()
        last = status.activeModules.map((entry) => entry.moduleId)
        if (last.includes(moduleId) === shouldBeActive) return last
      }
    } catch (error) {
      last = { error: error.message }
    }
    await sleep(100)
  }
  throw new Error(
    `Timed out waiting for ${label} (active modules: ${JSON.stringify(last)})`
  )
}

async function stopModuleOverHttp(moduleId) {
  const response = await fetch(`${serverBaseUrl}/runtime/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ moduleId }),
  })
  if (!response.ok) {
    throw new Error(`/runtime/stop failed with ${response.status}`)
  }
  await waitForServerRunState(moduleId, false, `${moduleId} stopped over HTTP`)
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
