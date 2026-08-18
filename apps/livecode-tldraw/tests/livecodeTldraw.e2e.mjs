import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
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
// Scales every wait timeout for slow environments (cold cloud sandboxes take
// ~16s for the first analyze while ts-morph loads). Polling waits still return
// as soon as their condition holds, so a scale >1 does not slow a green run.
const timeoutScale = Number(process.env.LIVECODE_E2E_TIMEOUT_SCALE || '1') || 1
const scaled = (ms) => Math.round(ms * timeoutScale)
// LIVECODE_E2E_ENGINE=remote runs the whole suite against a server with no
// engine of its own: a browser engine tab is opened before any case and every
// runtime/entity op forwards to it. The client code under test is identical.
const engineMode = process.env.LIVECODE_E2E_ENGINE === 'remote' ? 'remote' : 'local'

const serverOutput = []
const viteOutput = []
const browserOutput = []
let browser
let page
let enginePage
let serverProc
let viteProc
let firstModuleId = ''
let secondModuleId = ''
let serverBaseUrl = ''
let paramPaneShapeId = ''
let projectRoot = ''

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

// Fixtures for the ephemeral-signal cases. A playhead is a signal anchored at a
// roll: the module never knows a view exists, and the view never knows what the
// position means.
const SIGNAL_ROLL_NAME = 'melody'
const PLAYHEAD_SIGNAL_NAME = 'e2e/playhead'
const SECOND_PLAYHEAD_SIGNAL_NAME = 'e2e/playhead-2'
const PLAYHEAD_SOURCE = `import type { TimeContext } from "@avtools/core-timing";
import { signal } from "canvas-signals";

export const playhead = signal("${PLAYHEAD_SIGNAL_NAME}", {
  anchor: { type: "pianoRoll", name: "${SIGNAL_ROLL_NAME}" },
});

export default async function(ctx: TimeContext) {
  let position = 0;
  while (true) {
    position = (position + 0.25) % 4;
    playhead.set(position);
    await ctx.waitSec(0.05);
  }
}
`
// The second publisher ships an object with a numeric `position`, the other
// shape the marker feed accepts.
const SECOND_PLAYHEAD_SOURCE = `import type { TimeContext } from "@avtools/core-timing";
import { signal } from "canvas-signals";

export const playhead = signal("${SECOND_PLAYHEAD_SIGNAL_NAME}", {
  anchor: { type: "pianoRoll", name: "${SIGNAL_ROLL_NAME}" },
});

export default async function(ctx: TimeContext) {
  let position = 2;
  while (true) {
    position = 2 + ((position + 0.5) % 2);
    playhead.set({ position, voice: "b" });
    await ctx.waitSec(0.05);
  }
}
`
const GRAPH_PARAMS_NAME = 'e2e/graph-params'
const GRAPH_PARAMS_SOURCE = `import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";

export const params = canvasParams(
  "${GRAPH_PARAMS_NAME}",
  { level: 0.5 },
  { level: { min: 0, max: 1, graph: true, rows: 2 } },
);

export default async function(ctx: TimeContext) {
  let step = 0;
  while (true) {
    params.level = (step % 5) / 4;
    step += 1;
    await ctx.waitSec(0.1);
  }
}
`

// Fixtures for the run-lifecycle cases. The finite module ends on its own,
// which is the completion a stale `running` used to hide; the replace pair
// never ends, so only an explicit Replace can retire the first run. Both edited
// variants differ from their originals, because an identical source is a no-op
// edit that would never drop the client's active-run claim.
const FINITE_RUN_SOURCE = `import type { TimeContext } from "@avtools/core-timing";

export default async function(ctx: TimeContext) {
  for (let step = 0; step < 30; step++) {
    await ctx.waitSec(0.1);
  }
}
`
const FINITE_RUN_EDITED_SOURCE = `import type { TimeContext } from "@avtools/core-timing";

// Edited while the run above was still going.
export default async function(ctx: TimeContext) {
  for (let step = 0; step < 30; step++) {
    await ctx.waitSec(0.1);
  }
}
`
const REPLACE_FIRST_SOURCE = `import type { TimeContext } from "@avtools/core-timing";

export default async function(ctx: TimeContext) {
  while (true) {
    await ctx.waitSec(0.05);
  }
}
`
/** Two callsites, so the replacement demonstrably ran the edited source. */
const REPLACE_SECOND_SOURCE = `import type { TimeContext } from "@avtools/core-timing";

export default async function(ctx: TimeContext) {
  while (true) {
    await ctx.waitSec(0.05);
    await ctx.waitSec(0.05);
  }
}
`

// Fixtures for the project-mode cases, which run last on their own canvas.
const PROJECT_MANIFEST_FILENAME = 'project.avtools-livecode.json'
const PROJECT_MODULE_PATH = 'modules/main.ts'
const PROJECT_PARAMS_NAME = 'e2e/project-params'
const PROJECT_ROLL_NAME = 'e2e/roll'
const PROJECT_ROLL_COPY_NAME = 'e2e/roll-copy'
const PIANO_ROLL_ENTITY_TYPE = 'pianoRoll'
const PARAMS_ENTITY_TYPE = 'params'
/** Percent-encoded names: every byte outside `[a-zA-Z0-9._-]`, `/` included. */
const PROJECT_ROLL_DATA_PATH = 'data/pianoRoll/e2e%2Froll.json'
const PROJECT_PARAMS_DATA_PATH = 'data/params/e2e%2Fproject-params.json'
const PROJECT_MODULE_SOURCE = `import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";

export const params = canvasParams(
  "${PROJECT_PARAMS_NAME}",
  { gain: 0.5, depth: 3 },
  { depth: { min: 0, max: 8, step: 1 } },
);

export default async function(ctx: TimeContext) {
  while (true) {
    await ctx.waitSec(0.05);
  }
}
`
const SAVED_ROLL_NOTES = [
  { pitch: 64, position: 0, duration: 1 },
  { pitch: 67, position: 1, duration: 0.5 },
]
const UNSAVED_ROLL_NOTES = [{ pitch: 72, position: 2, duration: 2 }]

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
  if (engineMode === 'remote') {
    enginePage = await browser.newPage()
    enginePage.on('pageerror', (error) => {
      browserOutput.push(`[engine:pageerror] ${error.stack ?? error.message}`)
    })
    await enginePage.goto(`${serverInfo.baseUrl}/engine/`, {
      timeout: scaled(60_000),
    })
    // Attached = the tab's engine answers entity reads over HTTP.
    const attachDeadline = Date.now() + scaled(30_000)
    for (;;) {
      const response = await fetch(`${serverInfo.baseUrl}/piano-roll/list`)
        .catch(() => null)
      if (response?.ok) break
      if (Date.now() > attachDeadline) {
        throw new Error('browser engine never attached to /engine/uplink')
      }
      await sleep(200)
    }
  }
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
  await page.locator('.livecode-shape').first().waitFor({ timeout: scaled(20_000) })
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
  await runPlayheadSignalMarkerCase()
  await runTwoModulePlayheadMarkersCase()
  await runSignalScopeAccumulatesCase()
  await runParamGraphRowCase()
  await runNaturalCompletionAfterEditCase()
  await runInstantFailureCase()
  await runReplaceButtonCase()

  // Everything above runs on the transient default canvas. Project mode
  // replaces it, so these cases come last and never disturb the ones before.
  await enterProjectMode(viteBaseUrl)
  await runProjectEntityCreateCase()
  await runProjectSaveRoundTripCase()
  await runProjectOpenRestoresSavedTruthCase()
  await runProjectDuplicateAndDeleteCase()

  console.log(
    JSON.stringify({
      ok: true,
      type: 'livecodeTldrawE2E',
      serverBaseUrl: serverInfo.baseUrl,
      viteBaseUrl,
      moduleId: firstModuleId,
      sessionRoot,
      projectRoot,
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
    scaled(15_000),
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
    scaled(5_000),
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
    scaled(5_000),
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
  await page.locator('.livecode-shape').first().waitFor({ timeout: scaled(20_000) })
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

/**
 * The playhead deliverable, end to end: a module declares a signal anchored at
 * a roll and drives it from its own loop, and the bound view renders it as a
 * moving marker. Stopping the module ends the signal, and the marker goes away
 * rather than freezing where the run left it.
 */
async function runPlayheadSignalMarkerCase() {
  await ensureRollView(SIGNAL_ROLL_NAME)
  await setSource(PLAYHEAD_SOURCE)
  const manifest = await waitForManifest(firstModuleId, 2, 'playhead signal manifest')
  assertEqual(
    manifest.callsites.map((c) => c.kind),
    ['canvasSignal', 'timeContextMethod'],
    'playhead declaration callsite kinds'
  )
  assertEqual(
    manifest.callsites[0].staticName,
    PLAYHEAD_SIGNAL_NAME,
    'declared signal static name'
  )

  await runModule(firstModuleId)
  const first = await waitForMarker(
    SIGNAL_ROLL_NAME,
    PLAYHEAD_SIGNAL_NAME,
    'the anchored playhead renders a marker'
  )
  assert(
    Number.isFinite(first.position),
    `marker position should be numeric, got ${JSON.stringify(first)}`
  )
  await waitForPageValue(
    ({ rollName, signalName, seen }) => {
      const views = window.__livecodeTldrawRuntimeDebug?.getPlayheadMarkerViews() ?? []
      const view = views.find((candidate) => candidate.rollName === rollName)
      const marker = view?.markers.find((candidate) => candidate.id === signalName)
      return marker && marker.position !== seen ? marker : null
    },
    'the marker position moves with the module loop',
    scaled(15_000),
    { rollName: SIGNAL_ROLL_NAME, signalName: PLAYHEAD_SIGNAL_NAME, seen: first.position }
  )

  await stopModule(firstModuleId)
  await waitForServerRunState(firstModuleId, false, 'playhead module stopped')
  // Ended is server truth first...
  await waitForSignalEntity(
    PLAYHEAD_SIGNAL_NAME,
    (signal) => signal.ended === true,
    'the stopped run ends its signal'
  )
  // ...and the removed marker is what the view does about it.
  await waitForPageValue(
    ({ rollName, signalName }) => {
      const views = window.__livecodeTldrawRuntimeDebug?.getPlayheadMarkerViews() ?? []
      const view = views.find((candidate) => candidate.rollName === rollName)
      if (!view) return null
      return view.markers.some((marker) => marker.id === signalName) ? null : true
    },
    'the ended signal drops its marker',
    10_000,
    { rollName: SIGNAL_ROLL_NAME, signalName: PLAYHEAD_SIGNAL_NAME }
  )
}

/**
 * Multiple playbacks of one melody render as multiple markers. The second
 * module publishes an object with a numeric `position` rather than a bare
 * number, so both accepted value shapes are covered.
 */
async function runTwoModulePlayheadMarkersCase() {
  secondModuleId = await createModuleViaDebug()
  assert(secondModuleId, 'the debug surface should return a new module id')
  await setSourceFor(secondModuleId, SECOND_PLAYHEAD_SOURCE)
  await waitForManifest(secondModuleId, 2, 'second playhead manifest')

  // Re-running the first module redeclares its name, which clears `ended`.
  await runModule(firstModuleId)
  await runModule(secondModuleId)

  const markers = await waitForPageValue(
    ({ rollName, names }) => {
      const views = window.__livecodeTldrawRuntimeDebug?.getPlayheadMarkerViews() ?? []
      const view = views.find((candidate) => candidate.rollName === rollName)
      if (!view) return null
      const ids = view.markers.map((marker) => marker.id)
      return names.every((name) => ids.includes(name)) ? view.markers : null
    },
    'two modules render two markers on one roll',
    scaled(20_000),
    {
      rollName: SIGNAL_ROLL_NAME,
      names: [PLAYHEAD_SIGNAL_NAME, SECOND_PLAYHEAD_SIGNAL_NAME],
    }
  )
  assertEqual(markers.length, 2, 'exactly one marker per publishing module')
  const objectValued = markers.find(
    (marker) => marker.id === SECOND_PLAYHEAD_SIGNAL_NAME
  )
  assert(
    objectValued.position >= 2 && objectValued.position <= 4,
    `the object-valued signal's position should come from value.position, got ${objectValued.position}`
  )
}

/**
 * Scopes watch values regardless of class: one bound to an ephemeral signal and
 * one bound to a durable param leaf are the same mechanism. Both accumulate
 * client-side at RAF, which is what the ring-buffer assertions read.
 */
async function runSignalScopeAccumulatesCase() {
  const signalScopeId = await createSignalScope('signal', PLAYHEAD_SIGNAL_NAME)
  assert(signalScopeId, 'the debug surface should return the new scope shape id')
  const signalScope = await waitForScopeState(
    signalScopeId,
    (state) => state.sampleCount > 10 && state.distinctCount > 1,
    'the signal scope accumulates a changing trace'
  )
  assertEqual(signalScope.sourceType, 'signal', 'signal scope source type')
  assert(
    signalScope.waiting === false,
    'a scope over a live numeric signal is not waiting'
  )

  // The same shape over a durable param field, fed by a module writing it. The
  // second module is still publishing its playhead, and a launch over a running
  // module is rejected, so stop it first exactly like the code-write case above.
  await stopModule(secondModuleId)
  await waitForServerRunState(secondModuleId, false, 'second module stopped before its param role')
  await setSourceFor(secondModuleId, PARAMS_CODE_WRITE_SOURCE)
  await waitForManifest(secondModuleId, 2, 'param-writing module manifest')
  const beforeParams = await fetchParamsEntity(PARAMS_ENTITY_NAME)
  await runModule(secondModuleId)
  await waitForParamsEntity(
    PARAMS_ENTITY_NAME,
    // A rev floor, because an earlier case already left `updatedBy: "code"` on
    // this entity: without it the wait would pass on stale truth.
    (candidate) => candidate.updatedBy === 'code' && candidate.rev > beforeParams.rev,
    'the second module is writing the params entity'
  )

  const paramsScopeId = await createSignalScope('params', PARAMS_ENTITY_NAME, {
    path: 'gain',
  })
  const paramsScope = await waitForScopeState(
    paramsScopeId,
    (state) => state.sampleCount > 10 && state.distinctCount > 1,
    'the params scope accumulates while a module writes the field'
  )
  assertEqual(paramsScope.sourceType, 'params', 'params scope source type')
  assert(
    paramsScope.min >= 0 && paramsScope.max <= 0.5,
    `params scope should track the written 0..0.4 cycle, got ${paramsScope.min}..${paramsScope.max}`
  )
}

/**
 * `meta.graph` is display-only opt-in: a numeric leaf that declares it gets a
 * second, readonly graph row beside its editable binding.
 */
async function runParamGraphRowCase() {
  await stopModule(firstModuleId)
  await waitForServerRunState(firstModuleId, false, 'playhead module stopped before the graph case')
  await setSource(GRAPH_PARAMS_SOURCE)
  await waitForManifest(firstModuleId, 2, 'graph params manifest')
  await runModule(firstModuleId)
  await waitForParamsEntity(
    GRAPH_PARAMS_NAME,
    (candidate) => typeof candidate.values.level === 'number',
    'the graph-params entity is declared'
  )

  await createParamPane(GRAPH_PARAMS_NAME)
  await waitForPageValue(
    () => {
      const panes = Array.from(document.querySelectorAll('.param-pane-shape'))
      const withGraph = panes.filter(
        (pane) => pane.querySelectorAll('.tp-grlv').length > 0
      )
      return withGraph.length > 0 ? withGraph.length : null
    },
    'the graph-declared field renders a graph row'
  )

  // The lifecycle cases below run one module at a time, so clear the canvas of
  // running work first.
  await stopModule(firstModuleId)
  await stopModule(secondModuleId)
  await waitForServerRunState(firstModuleId, false, 'graph module stopped')
  await waitForServerRunState(secondModuleId, false, 'param-writing module stopped')
}

/**
 * A module edited while it runs loses the client's active-run claim, and the
 * run it was editing still ends on its own. That terminal is server truth and
 * must land: before the guard was relaxed the module sat at `running` until a
 * reload, with nothing running on the server.
 */
async function runNaturalCompletionAfterEditCase() {
  // This module has run before in earlier cases, so its record still holds the
  // previous run's token. Every wait below is relative to that token.
  const previousRunToken = await readClientRunToken(firstModuleId)
  await setSource(FINITE_RUN_SOURCE)
  await waitForManifest(firstModuleId, 1, 'finite module manifest')
  await runModule(firstModuleId)
  await waitForServerRunState(firstModuleId, true, 'finite module running')
  // Re-derived for changed-only delivery. The old mechanism was the full
  // moduleRuns map being re-delivered on unrelated traffic, which re-adopted
  // the claim; there is no such re-delivery now. What matters instead is the
  // run entity's own `running` change reaching this client, because that is
  // where it learns the run TOKEN whose terminal it must later accept.
  const runToken = await waitForClientRunToken(
    firstModuleId,
    previousRunToken,
    'running',
    'the running run entity reached the client before the edit'
  )

  // The edit lands mid-run; the server keeps running the older build.
  await setSource(FINITE_RUN_EDITED_SOURCE)
  await waitForPageValue(
    (moduleId) =>
      window.__livecodeTldrawRuntimeDebug?.modules[moduleId]?.runStatus === 'running',
    'edited module still shows the older run as running',
    scaled(5_000),
    firstModuleId
  )

  await waitForServerRunState(firstModuleId, false, 'finite module reached its own end')
  // The stopped state has to arrive on the run entity change itself, carrying
  // the same token: nothing else ships in this window, and a suppressed
  // terminal would leave the module at `running` until a reload.
  await waitForPageValue(
    ({ moduleId, runToken }) => {
      const state = window.__livecodeTldrawRuntimeDebug?.modules[moduleId]
      return state?.runStatus === 'stopped' && state?.runToken === runToken
    },
    'the edited-while-running module reaches stopped from its own run entity',
    scaled(20_000),
    { moduleId: firstModuleId, runToken }
  )
}

/**
 * A module that throws the instant it starts. Its `launching`, `running`, and
 * `error` writes can land inside one 33 ms broadcast tick, in which case the
 * ONLY run entity this client ever sees is a terminal under a token it never
 * watched go active. That terminal must apply — swallowing it would leave the
 * module reading `running` with nothing running.
 */
async function runInstantFailureCase() {
  const previousRunToken = await readClientRunToken(firstModuleId)
  await setSource(`import type { TimeContext } from "@avtools/core-timing";

export default async function(ctx: TimeContext) {
  void ctx;
  throw new Error("e2e instant failure");
}
`)
  await waitForManifest(firstModuleId, 0, 'instant-failure manifest')
  await runModule(firstModuleId)
  const state = await waitForPageValue(
    ({ moduleId, previousRunToken }) => {
      const module = window.__livecodeTldrawRuntimeDebug?.modules[moduleId]
      if (!module?.runToken || module.runToken === previousRunToken) return null
      return module.runStatus === 'error' ? module : null
    },
    'an immediately-throwing module reaches error in the client',
    scaled(20_000),
    { moduleId: firstModuleId, previousRunToken }
  )
  assert(
    (state.latestError ?? '').includes('e2e instant failure'),
    `the run entity's message reaches the client: ${state.latestError}`
  )
}

/**
 * Replacement is an explicit gesture in the UI: while a module runs, its Run
 * button becomes Replace, and clicking it stops the running run and launches
 * the edited source under a new generated run ID.
 */
async function runReplaceButtonCase() {
  const previousRunToken = await readClientRunToken(firstModuleId)
  await setSource(REPLACE_FIRST_SOURCE)
  await waitForManifest(firstModuleId, 1, 'replace fixture manifest')
  await runModule(firstModuleId)
  const firstRunId = await waitForActiveRunId(
    firstModuleId,
    null,
    'first run active before replacing'
  )
  // The token the client watched go active. This is the straddle case's whole
  // subject: this run's terminal lands while the replacement is still starting.
  const firstRunToken = await waitForClientRunToken(
    firstModuleId,
    previousRunToken,
    'running',
    'the first run entity reached the client'
  )
  await waitForModuleActionButtons(
    firstModuleId,
    ['Replace', 'Stop'],
    'the Run button becomes Replace while the module runs'
  )

  await setSource(REPLACE_SECOND_SOURCE)
  await waitForManifest(firstModuleId, 2, 'edited replace fixture manifest')
  await clickModuleActionButton(firstModuleId, 'Replace')

  const secondRunId = await waitForActiveRunId(
    firstModuleId,
    firstRunId,
    'the replacement run is active under a new generated run id'
  )
  assert(
    secondRunId !== firstRunId,
    'the replacement must run under a new generated run id'
  )
  await waitForServerLogEntry(
    (entry) =>
      entry.type === 'moduleStopped' &&
      entry.generatedRunId === firstRunId &&
      entry.reason === 'replaceBeforeLaunch',
    'the replaced run emitted its terminal'
  )
  // The straddle: the replaced run's terminal is a real entity change on the
  // socket, and it arrives while the replacement is still launching. It was
  // observed active BEFORE this claim's POST, so it must be suppressed — the
  // client has to end up on the replacement's own token, still running.
  const secondRunToken = await waitForClientRunToken(
    firstModuleId,
    firstRunToken,
    'running',
    'the client follows the replacement run, not the replaced run terminal'
  )
  // And it stays there: a late terminal for the replaced run must not retire it.
  await sleep(500)
  const straddled = await page.evaluate(
    (moduleId) => window.__livecodeTldrawRuntimeDebug?.modules[moduleId] ?? null,
    firstModuleId
  )
  assertEqual(
    [straddled?.runStatus, straddled?.runToken],
    ['running', secondRunToken],
    'the replaced run terminal never retires its replacement'
  )
  await waitForModuleActionButtons(
    firstModuleId,
    ['Replace', 'Stop'],
    'the button set stays Replace/Stop for the replacement run'
  )

  // Leave the transient phase with nothing running: the project cases below
  // assert on an empty active-module list.
  await stopModule(firstModuleId)
  await waitForServerRunState(firstModuleId, false, 'replacement run stopped')
  await waitForModuleActionButtons(
    firstModuleId,
    ['Run', 'Stop'],
    'the button set returns to Run/Stop once nothing is running'
  )
}

/**
 * Entity creation as the GUI does it: the create action and the first view are
 * one composite gesture, driven here through the debug surface rather than the
 * topbar DOM.
 */
async function runProjectEntityCreateCase() {
  const created = await createEntityViaDebug(
    PIANO_ROLL_ENTITY_TYPE,
    PROJECT_ROLL_NAME
  )
  assertEqual(
    created.entity,
    { type: PIANO_ROLL_ENTITY_TYPE, name: PROJECT_ROLL_NAME },
    'created entity summary'
  )

  const snapshot = await fetchPianoRollList()
  assert(
    snapshot.rolls[PROJECT_ROLL_NAME],
    `/piano-roll/list should carry "${PROJECT_ROLL_NAME}" after the create`
  )
  assertEqual(
    snapshot.rolls[PROJECT_ROLL_NAME].data.notes,
    [],
    'a created roll starts empty'
  )

  const viewId = await createPianoRollView(PROJECT_ROLL_NAME)
  assert(viewId, 'debug surface should return the new piano-roll-view shape id')
  const view = (await getShapes()).find((s) => s.id === viewId)
  assert(view, 'a piano-roll-view shape should exist after creating one')
  assertEqual(view.props.rollName, PROJECT_ROLL_NAME, 'created view rollName')
  // The view renders the entity rather than its waiting placeholder.
  await waitForPageValue(
    () =>
      document.querySelectorAll('.piano-roll-shape__viewport').length === 1 &&
      document.querySelectorAll('.piano-roll-shape__empty').length === 0,
    'the created view renders its roll'
  )
}

/**
 * Explicit save writes the manifest `data` list plus one human-readable JSON
 * file per durable entity. Asserted from Node against the real project tree,
 * including the percent-encoded filenames slash-containing names produce.
 */
async function runProjectSaveRoundTripCase() {
  await runModule(firstModuleId)
  const declared = await waitForParamsEntity(
    PROJECT_PARAMS_NAME,
    (candidate) => candidate.values.gain === 0.5,
    'the project module declared its params entity'
  )
  assertEqual(declared.updatedBy, 'declare', 'declared project params updatedBy')

  await setPianoRollOverHttp(PROJECT_ROLL_NAME, SAVED_ROLL_NOTES)
  assertEqual(
    (await fetchDataStatus(PIANO_ROLL_ENTITY_TYPE, PROJECT_ROLL_NAME)).unsaved,
    true,
    'the edited roll reports unsaved before the save'
  )

  const result = await saveProjectViaDebug()
  const savedRoll = result.data.find(
    (entry) => entry.type === PIANO_ROLL_ENTITY_TYPE && entry.name === PROJECT_ROLL_NAME
  )
  const savedParams = result.data.find(
    (entry) => entry.type === PARAMS_ENTITY_TYPE && entry.name === PROJECT_PARAMS_NAME
  )
  assert(savedRoll?.ok, `the roll should save: ${JSON.stringify(result)}`)
  assert(savedParams?.ok, `the params should save: ${JSON.stringify(result)}`)
  assertEqual(savedRoll.path, PROJECT_ROLL_DATA_PATH, 'encoded roll data path')
  assertEqual(savedParams.path, PROJECT_PARAMS_DATA_PATH, 'encoded params data path')

  const manifestData = readProjectManifest().data
  assert(
    manifestData.some(
      (entry) =>
        entry.type === PIANO_ROLL_ENTITY_TYPE &&
        entry.name === PROJECT_ROLL_NAME &&
        entry.path === PROJECT_ROLL_DATA_PATH
    ),
    `manifest data should list the roll: ${JSON.stringify(manifestData)}`
  )
  assert(
    manifestData.some(
      (entry) =>
        entry.type === PARAMS_ENTITY_TYPE &&
        entry.name === PROJECT_PARAMS_NAME &&
        entry.path === PROJECT_PARAMS_DATA_PATH
    ),
    `manifest data should list the params entity: ${JSON.stringify(manifestData)}`
  )

  const rollFile = readProjectJson(PROJECT_ROLL_DATA_PATH)
  assertEqual(rollFile.type, PIANO_ROLL_ENTITY_TYPE, 'saved roll file type')
  assertEqual(rollFile.name, PROJECT_ROLL_NAME, 'saved roll file name')
  assertEqual(
    rollFile.data.notes.map((note) => [note.pitch, note.position, note.duration]),
    SAVED_ROLL_NOTES.map((note) => [note.pitch, note.position, note.duration]),
    'saved roll notes'
  )

  const paramsFile = readProjectJson(PROJECT_PARAMS_DATA_PATH)
  assertEqual(paramsFile.type, PARAMS_ENTITY_TYPE, 'saved params file type')
  assertEqual(paramsFile.values, { gain: 0.5, depth: 3 }, 'saved params values')
  assertEqual(
    paramsFile.meta,
    { depth: { min: 0, max: 8, step: 1 } },
    'saved params meta'
  )

  // Ephemeral signals are excluded from persistence by construction (they are
  // not a registered durable type), not by a filter in the save path. This
  // assertion depends on the transient-phase signals above surviving into
  // project mode — the signal store is process state, and navigating the
  // browser to a project does not clear it, so `/signals/list` is still
  // non-empty here (its entries are ended, which changes nothing about save).
  const liveSignals = Object.keys((await fetchSignalsList()).signals)
  assert(
    liveSignals.length > 0,
    'the transient-phase signals should still be listed, or this case proves nothing'
  )
  assert(
    !result.data.some((entry) => entry.type === 'signal'),
    `save must not write signal entities: ${JSON.stringify(result.data)}`
  )
  assert(
    !manifestData.some((entry) => entry.type === 'signal'),
    `the manifest data list must have no signal entries: ${JSON.stringify(manifestData)}`
  )
  assert(
    !existsSync(path.join(projectRoot, 'data', 'signal')),
    'no data/signal directory should exist after a save'
  )
  assertEqual(
    readdirSync(path.join(projectRoot, 'data')).sort(),
    [PARAMS_ENTITY_TYPE, PIANO_ROLL_ENTITY_TYPE].sort(),
    'data/ holds exactly the durable entity types'
  )

  // What the unsaved pill reads: both entities go clean on the same save.
  assertEqual(
    (await fetchDataStatus(PIANO_ROLL_ENTITY_TYPE, PROJECT_ROLL_NAME)).unsaved,
    false,
    'the roll reports saved after the save'
  )
  assertEqual(
    (await fetchDataStatus(PARAMS_ENTITY_TYPE, PROJECT_PARAMS_NAME)).unsaved,
    false,
    'the params entity reports saved after the save'
  )
}

/**
 * Open adopts disk truth: live values that were never saved are replaced by the
 * saved ones. The payoff is the last assertion — a pane created with no module
 * running renders real bindings, because the file carried `meta`.
 */
async function runProjectOpenRestoresSavedTruthCase() {
  await stopModule(firstModuleId)
  await waitForServerRunState(firstModuleId, false, 'project module stopped before the reopen')

  await setPianoRollOverHttp(PROJECT_ROLL_NAME, UNSAVED_ROLL_NOTES)
  await serverPostJson('/params/set', {
    name: PROJECT_PARAMS_NAME,
    values: { gain: 0.9 },
  })
  await waitForParamsEntity(
    PROJECT_PARAMS_NAME,
    (candidate) => candidate.values.gain === 0.9,
    'the live param edit landed before the reopen'
  )

  await serverPostJson('/project/open', { projectPath: projectRoot })

  const restoredRoll = (await fetchPianoRollList()).rolls[PROJECT_ROLL_NAME]
  assertEqual(
    restoredRoll.data.notes.map((note) => note.pitch),
    SAVED_ROLL_NOTES.map((note) => note.pitch),
    'open restores the saved roll over the live one'
  )
  const restoredParams = await fetchParamsEntity(PROJECT_PARAMS_NAME)
  assertEqual(restoredParams.values.gain, 0.5, 'open restores the saved param value')
  assertEqual(restoredParams.updatedBy, 'load', 'a loaded params entity records its origin')
  assertEqual(
    restoredParams.meta,
    { depth: { min: 0, max: 8, step: 1 } },
    'the loaded params entity carries its saved meta'
  )

  const activeModules = await fetchActiveModuleIds()
  assertEqual(activeModules, [], 'no module is running for the pre-launch pane')
  paramPaneShapeId = await createParamPane(PROJECT_PARAMS_NAME)
  assert(paramPaneShapeId, 'debug surface should return the new pane shape id')
  await waitForParamsBindingValue(
    'gain',
    ['0.50'],
    'a fresh pane renders saved bindings with no module running'
  )
}

/**
 * Duplicate is the variations gesture and delete is its counterweight: the copy
 * is live and saved, and deleting the entity leaves the view (a view is not the
 * entity) plus the old data file (manifest-only remove) behind.
 */
async function runProjectDuplicateAndDeleteCase() {
  const duplicated = await duplicateEntityViaDebug(
    PIANO_ROLL_ENTITY_TYPE,
    PROJECT_ROLL_NAME,
    PROJECT_ROLL_COPY_NAME
  )
  assertEqual(
    duplicated.entity,
    { type: PIANO_ROLL_ENTITY_TYPE, name: PROJECT_ROLL_COPY_NAME },
    'duplicate returns the new entity'
  )

  const rolls = (await fetchPianoRollList()).rolls
  assert(rolls[PROJECT_ROLL_NAME], 'the source roll survives a duplicate')
  assert(rolls[PROJECT_ROLL_COPY_NAME], 'the copy is live after a duplicate')
  assertEqual(
    rolls[PROJECT_ROLL_COPY_NAME].data.notes.map((note) => note.pitch),
    rolls[PROJECT_ROLL_NAME].data.notes.map((note) => note.pitch),
    'the copy carries the source notes'
  )

  const copyViewId = await createPianoRollView(PROJECT_ROLL_COPY_NAME)
  assert(copyViewId, 'the copy should get its own view')

  const saved = await saveProjectViaDebug()
  const savedCopy = saved.data.find((entry) => entry.name === PROJECT_ROLL_COPY_NAME)
  assert(savedCopy?.ok, `the copy should save: ${JSON.stringify(saved.data)}`)
  assert(
    existsSync(path.join(projectRoot, savedCopy.path)),
    'the copy has a data file on disk'
  )
  assert(
    readProjectManifest().data.some((entry) => entry.name === PROJECT_ROLL_COPY_NAME),
    'the manifest lists the copy after the save'
  )

  await deleteEntityViaDebug(PIANO_ROLL_ENTITY_TYPE, PROJECT_ROLL_COPY_NAME)
  assert(
    !(await fetchPianoRollList()).rolls[PROJECT_ROLL_COPY_NAME],
    'delete removes the entity from the store'
  )
  await waitForPageValue(
    () => document.querySelectorAll('.piano-roll-shape__empty').length === 1,
    'the deleted entity leaves its view showing the waiting placeholder'
  )
  assert(
    (await getShapes()).some((shape) => shape.id === copyViewId),
    'deleting an entity never deletes its views'
  )

  const resaved = await saveProjectViaDebug()
  assert(
    !resaved.data.some((entry) => entry.name === PROJECT_ROLL_COPY_NAME),
    'the next save no longer writes the deleted entity'
  )
  assert(
    !readProjectManifest().data.some((entry) => entry.name === PROJECT_ROLL_COPY_NAME),
    'the manifest entry for the deleted entity is gone'
  )
  assert(
    existsSync(path.join(projectRoot, savedCopy.path)),
    'the orphaned data file is left on disk, like a removed module source'
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Project mode renders no default canvas, so the project has to carry a module
 * before the boot waits below can resolve. The navigation replaces the canvas
 * every earlier case ran on, which is why these cases come last.
 */
async function enterProjectMode(viteBaseUrl) {
  projectRoot = path.join(sessionRoot, 'project-mode')
  await serverPostJson('/project/create', {
    projectPath: projectRoot,
    name: 'tldraw-e2e-project',
    modules: [
      {
        path: PROJECT_MODULE_PATH,
        title: 'params module',
        sourceText: PROJECT_MODULE_SOURCE,
      },
    ],
  })

  await page.goto(projectUrl(viteBaseUrl, serverBaseUrl, projectRoot), {
    waitUntil: 'domcontentloaded',
  })
  await page.locator('.livecode-shape').first().waitFor({ timeout: scaled(20_000) })
  await waitForPageValue(
    () => Boolean(window.__livecodeTldrawRuntimeDebug),
    'tldraw runtime debug hooks installed in project mode',
    10_000
  )
  await page.evaluate(() => window.__livecodeTldrawRuntimeDebug?.connect())
  await waitForTldrawReady()
  firstModuleId = await waitForFirstModuleId()
  assertEqual(firstModuleId, PROJECT_MODULE_PATH, 'project module id after navigation')
}

function createEntityViaDebug(type, name) {
  return page.evaluate(
    ({ type, name }) => window.__livecodeTldrawRuntimeDebug?.createEntity(type, name),
    { type, name }
  )
}

function duplicateEntityViaDebug(type, sourceName, targetName) {
  return page.evaluate(
    ({ type, sourceName, targetName }) =>
      window.__livecodeTldrawRuntimeDebug?.duplicateEntity(type, sourceName, targetName),
    { type, sourceName, targetName }
  )
}

function deleteEntityViaDebug(type, name) {
  return page.evaluate(
    ({ type, name }) => window.__livecodeTldrawRuntimeDebug?.deleteEntity(type, name),
    { type, name }
  )
}

function saveProjectViaDebug() {
  return page.evaluate(() => window.__livecodeTldrawRuntimeDebug?.saveProject())
}

function createPianoRollView(rollName) {
  return page.evaluate(
    (rollName) =>
      window.__livecodeTldrawRuntimeDebug?.createPianoRollView(rollName) ?? null,
    rollName
  )
}

function createModuleViaDebug(source) {
  return page.evaluate(
    (source) => window.__livecodeTldrawRuntimeDebug?.createModule(source) ?? null,
    source
  )
}

function createSignalScope(sourceType, name, options) {
  return page.evaluate(
    ({ sourceType, name, options }) =>
      window.__livecodeTldrawRuntimeDebug?.createSignalScope(
        sourceType,
        name,
        options
      ) ?? null,
    { sourceType, name, options }
  )
}

/**
 * A mounted roll view is what renders markers, so the marker cases make sure
 * one exists rather than depending on whichever view an earlier case left.
 */
async function ensureRollView(rollName) {
  const mounted = await page.evaluate(
    (rollName) =>
      (window.__livecodeTldrawRuntimeDebug?.getPlayheadMarkerViews() ?? []).some(
        (view) => view.rollName === rollName
      ),
    rollName
  )
  if (!mounted) await createPianoRollView(rollName)
  await waitForPageValue(
    (rollName) =>
      (window.__livecodeTldrawRuntimeDebug?.getPlayheadMarkerViews() ?? []).some(
        (view) => view.rollName === rollName
      ) || null,
    `a mounted piano-roll view for "${rollName}"`,
    10_000,
    rollName
  )
}

function waitForMarker(rollName, signalName, label, timeoutMs = scaled(20_000)) {
  return waitForPageValue(
    ({ rollName, signalName }) => {
      const views = window.__livecodeTldrawRuntimeDebug?.getPlayheadMarkerViews() ?? []
      const view = views.find((candidate) => candidate.rollName === rollName)
      return view?.markers.find((marker) => marker.id === signalName) ?? null
    },
    label,
    timeoutMs,
    { rollName, signalName }
  )
}

async function waitForScopeState(shapeId, predicate, label, timeoutMs = scaled(20_000)) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    last = await page.evaluate(
      (shapeId) => window.__livecodeTldrawRuntimeDebug?.getScopeState(shapeId) ?? null,
      shapeId
    )
    if (last && predicate(last)) return last
    await sleep(100)
  }
  throw new Error(
    `Timed out waiting for ${label} (last seen: ${JSON.stringify(last)})`
  )
}

function fetchSignalsList() {
  return serverGetJson('/signals/list')
}

async function waitForSignalEntity(name, predicate, label, timeoutMs = scaled(20_000)) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    try {
      const snapshot = await fetchSignalsList()
      last = snapshot.signals[name] ?? null
      if (last && predicate(last)) return last
    } catch (error) {
      last = { error: error.message }
    }
    await sleep(100)
  }
  throw new Error(
    `Timed out waiting for ${label} (last seen: ${JSON.stringify(last)})`
  )
}

function readProjectManifest() {
  return readProjectJson(PROJECT_MANIFEST_FILENAME)
}

function readProjectJson(relativePath) {
  return JSON.parse(readFileSync(path.join(projectRoot, relativePath), 'utf8'))
}

async function fetchDataStatus(type, name) {
  const status = await serverGetJson('/project/status')
  const entry = status.data.find(
    (candidate) => candidate.type === type && candidate.name === name
  )
  if (!entry) {
    throw new Error(
      `No /project/status data row for ${type} "${name}": ${JSON.stringify(status.data)}`
    )
  }
  return entry
}

async function fetchActiveModuleIds() {
  const status = await serverGetJson('/runtime/status')
  return status.activeModules.map((entry) => entry.moduleId)
}

function fetchPianoRollList() {
  return serverGetJson('/piano-roll/list')
}

function setPianoRollOverHttp(name, notes) {
  return serverPostJson('/piano-roll/set', {
    name,
    data: { notes },
    source: 'client',
    label: 'E2E edit',
  })
}

async function serverGetJson(pathname) {
  const response = await fetch(`${serverBaseUrl}${pathname}`)
  if (!response.ok) {
    throw new Error(`${pathname} failed with ${response.status}: ${await response.text()}`)
  }
  return await response.json()
}

async function serverPostJson(pathname, body) {
  const response = await fetch(`${serverBaseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`${pathname} failed with ${response.status}: ${await response.text()}`)
  }
  return await response.json()
}

function setSource(source) {
  return setSourceFor(firstModuleId, source)
}

async function setSourceFor(moduleId, source) {
  await page.evaluate(({ moduleId, source }) => {
    window.__livecodeTldrawRuntimeDebug?.setSource(moduleId, source)
  }, { moduleId, source })
  // Mirror the source into the tldraw shape prop so the shape re-renders.
  // setModuleSource updates the runtime record; the shape prop is updated
  // separately by the editor's onChange. For the test we drive via the debug
  // API only, which is enough to trigger analyze + decorations because the
  // manifest + lookups come from the runtime store, not the shape prop.
  await waitForPageValue(
    (expected) =>
      window.__livecodeTldrawRuntimeDebug?.modules[expected.moduleId]?.sourceText ===
      expected.source,
    `source text applied to runtime for ${moduleId}`,
    scaled(5_000),
    { moduleId, source }
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
    scaled(15_000),
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
    scaled(15_000),
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

/**
 * The header action buttons of one module's shape, located by the module id the
 * header renders. Driving these is the point: Replace is a UI affordance, not
 * just a runtime call.
 */
async function waitForModuleActionButtons(moduleId, expectedLabels, label) {
  return await waitForPageValue(
    ({ moduleId, expectedLabels }) => {
      const shape = Array.from(document.querySelectorAll('.livecode-shape')).find(
        (element) =>
          Array.from(element.querySelectorAll('.livecode-shape__title span')).some(
            (span) => (span.textContent ?? '').trim() === moduleId
          )
      )
      if (!shape) return null
      const labels = Array.from(
        shape.querySelectorAll('.livecode-shape__actions button')
      ).map((button) => (button.textContent ?? '').trim())
      return JSON.stringify(labels) === JSON.stringify(expectedLabels) ? labels : null
    },
    label,
    scaled(15_000),
    { moduleId, expectedLabels }
  )
}

async function clickModuleActionButton(moduleId, label) {
  const clicked = await page.evaluate(
    ({ moduleId, label }) => {
      const shape = Array.from(document.querySelectorAll('.livecode-shape')).find(
        (element) =>
          Array.from(element.querySelectorAll('.livecode-shape__title span')).some(
            (span) => (span.textContent ?? '').trim() === moduleId
          )
      )
      if (!shape) return false
      const button = Array.from(
        shape.querySelectorAll('.livecode-shape__actions button')
      ).find((candidate) => (candidate.textContent ?? '').trim() === label)
      if (!button || button.disabled) return false
      button.click()
      return true
    },
    { moduleId, label }
  )
  if (!clicked) {
    throw new Error(`No enabled "${label}" button for module ${moduleId}`)
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
    scaled(15_000),
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

async function waitForParamsEntity(name, predicate, label, timeoutMs = scaled(20_000)) {
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

async function waitForServerRunState(moduleId, shouldBeActive, label, timeoutMs = scaled(15_000)) {
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

/**
 * The generated run id the server currently has active for a module, once it
 * differs from `previousRunId` (pass `null` for "any run").
 */
async function waitForActiveRunId(moduleId, previousRunId, label, timeoutMs = scaled(15_000)) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    try {
      const status = await serverGetJson('/runtime/status')
      const entry = status.activeModules.find(
        (candidate) => candidate.moduleId === moduleId
      )
      last = entry?.generatedRunId ?? null
      if (last && last !== previousRunId) return last
    } catch (error) {
      last = { error: error.message }
    }
    await sleep(100)
  }
  throw new Error(
    `Timed out waiting for ${label} (generatedRunId: ${JSON.stringify(last)})`
  )
}

/**
 * The run token of the last run entity the client APPLIED for a module. A
 * module keeps the previous run's token until a newer one lands, so every wait
 * on a token has to be relative to the one already there.
 */
function readClientRunToken(moduleId) {
  return page.evaluate(
    (moduleId) =>
      window.__livecodeTldrawRuntimeDebug?.modules[moduleId]?.runToken ?? null,
    moduleId
  )
}

/** Wait until the client is following a run entity newer than `previousToken`. */
async function waitForClientRunToken(
  moduleId,
  previousToken,
  expectedStatus,
  label,
  timeoutMs = scaled(15_000)
) {
  return await waitForPageValue(
    ({ moduleId, previousToken, expectedStatus }) => {
      const state = window.__livecodeTldrawRuntimeDebug?.modules[moduleId]
      if (!state?.runToken || state.runToken === previousToken) return null
      if (expectedStatus && state.runStatus !== expectedStatus) return null
      return state.runToken
    },
    label,
    timeoutMs,
    { moduleId, previousToken, expectedStatus }
  )
}

/** A lifecycle entry from the Deno server's JSONL stdout log. */
async function waitForServerLogEntry(predicate, label, timeoutMs = scaled(15_000)) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    for (const line of serverOutput.join('').split(/\r?\n/)) {
      const parsed = parseJsonLogLine(line)
      if (parsed && predicate(parsed)) return parsed
    }
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label} in the server log`)
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
      scaled(5_000)
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
    scaled(20_000)
  )
}

async function waitForTldrawReady() {
  await waitForPageValue(
    () => window.__livecodeTldrawRuntimeDebug?.connectionStatus === 'open',
    'runtime connected to server',
    scaled(30_000)
  )
}

async function waitForPageValue(predicate, label, timeoutMs = scaled(5_000), arg) {
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

function projectUrl(viteBaseUrl, serverBaseUrl, projectPath) {
  const url = new URL(tldrawUrl(viteBaseUrl, serverBaseUrl))
  url.searchParams.set('projectPath', projectPath)
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
        '--engine',
        engineMode,
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
  // PW_CHROMIUM_PATH points at a system Chromium when the Playwright-managed
  // download is absent (e.g. cloud sandboxes that pre-install a browser).
  const executablePath = process.env.PW_CHROMIUM_PATH || undefined
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await chromium.launch({
        headless,
        executablePath,
        args: [
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
        ],
      })
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

async function waitForHttp(url, label, timeoutMs = scaled(30_000)) {
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
