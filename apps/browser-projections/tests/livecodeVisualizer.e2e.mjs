import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 20) {
  throw new Error(
    `livecode visualizer E2E requires Node >=20 for Vite/Playwright; current Node is ${process.version}`
  )
}

const browserProjectRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(browserProjectRoot, '../..')
const denoNotebookRoot = path.join(repoRoot, 'apps/deno-notebooks')
const denoServerPath = path.join(denoNotebookRoot, 'livecode_visualizer/main.ts')
const sessionRoot = path.join(
  denoNotebookRoot,
  '.avtools-livecode-sessions',
  `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`
)
const moduleId = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`
const headless = process.env.PW_HEADLESS !== '0'

const serverOutput = []
const viteOutput = []
let browser
let page
let serverProc
let viteProc

try {
  mkdirSync(sessionRoot, { recursive: true })

  const serverReady = startDenoServer()
  const viteBaseUrl = await startVite()
  const serverInfo = await serverReady

  browser = await chromium.launch({ headless })
  page = await browser.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') {
      serverOutput.push(`[browser:${message.type()}] ${message.text()}`)
    }
  })

  await page.addInitScript(
    ({ serverBaseUrl, moduleId }) => {
      localStorage.setItem('tcv-server-base-url', serverBaseUrl)
      localStorage.setItem('tcv-module-id', moduleId)
    },
    { serverBaseUrl: serverInfo.baseUrl, moduleId }
  )

  await page.goto(new URL('/livecodeVisualizer', viteBaseUrl).href, {
    waitUntil: 'domcontentloaded'
  })
  await page.getByTestId('livecode-editor').waitFor({ timeout: 20_000 })
  await waitForText('snapshots: open', 'snapshot websocket')
  await waitForText('lsp: open', 'deno lsp websocket')
  await waitForPageValue(
    () => Boolean(window.__livecodeVisualizerDebug?.setSource),
    'debug hooks installed'
  )

  await runLinearWaitsCase()
  await runAwaitedHelperCase()
  await runRepeatedBranchCountCase()
  await runUnsupportedAwaitCase()
  await runSplitPromiseErrorCase()

  console.log(
    JSON.stringify({
      ok: true,
      type: 'livecodeVisualizerE2E',
      serverBaseUrl: serverInfo.baseUrl,
      viteBaseUrl,
      moduleId,
      sessionRoot
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

async function runLinearWaitsCase() {
  const source = `import type { TimeContext } from "@avtools/core-timing";

function log(label: string, ctx?: TimeContext) {
  const wall = Date.now();
  const logical = ctx ? ctx.time.toFixed(3) : "none";
  console.log(\`[fixture] linear wall=\${wall} logical=\${logical} \${label}\`);
}

export default async function(ctx: TimeContext) {
  log("start", ctx);
  await ctx.waitSec(0.35);
  log("after waitSec", ctx);
  await ctx.wait(0.35);
  log("done", ctx);
}
`

  await setSourceAndRun(source)
  const manifest = await waitForManifest(2, 'linear manifest')
  assertDeepEqual(
    manifest.callsites.map((callsite) => callsite.displayName),
    ['ctx.waitSec', 'ctx.wait'],
    'linear callsite display names'
  )

  const [firstId, secondId] = manifest.callsites.map((callsite) => callsite.id)
  await waitForAppliedIds([firstId], 'linear first wait highlight')
  await waitForDomDecoration('linear first CodeMirror decoration')
  await waitForAppliedIds([secondId], 'linear second wait highlight', 8_000)
  await waitForAppliedIds([], 'linear highlights clear', 8_000)
  await assertHighlightHistoryIncludes(firstId, 'linear first wait applied history')
  await assertHighlightHistoryIncludes(secondId, 'linear second wait applied history')
  assertServerLogsInOrder([
    '[fixture] linear',
    'start',
    '[fixture] linear',
    'after waitSec',
    '[fixture] linear',
    'done'
  ])
}

async function runAwaitedHelperCase() {
  const source = `import type { TimeContext } from "@avtools/core-timing";

function log(label: string, ctx?: TimeContext) {
  const wall = Date.now();
  const logical = ctx ? ctx.time.toFixed(3) : "none";
  console.log(\`[fixture] helper wall=\${wall} logical=\${logical} \${label}\`);
}

async function helper(ctx: TimeContext, label: string) {
  log(\`helper \${label} start\`, ctx);
  await ctx.waitSec(0.30);
  log(\`helper \${label} done\`, ctx);
}

export default async function(ctx: TimeContext) {
  log("root start", ctx);
  await helper(ctx, "a");
  log("between helpers", ctx);
  await helper(ctx, "b");
  log("root done", ctx);
}
`

  await setSourceAndRun(source)
  const manifest = await waitForManifest(2, 'helper manifest')
  assertDeepEqual(
    manifest.callsites.map((callsite) => callsite.displayName),
    ['helper', 'helper'],
    'helper callsites are root-level helper awaits'
  )

  const [firstId, secondId] = manifest.callsites.map((callsite) => callsite.id)
  await waitForAppliedIds([firstId], 'helper first call highlight')
  await waitForAppliedIds([secondId], 'helper second call highlight', 8_000)
  await waitForAppliedIds([], 'helper highlights clear', 8_000)
  assertNoCallsiteDisplayName(manifest, 'ctx.waitSec')
  assertServerLogsInOrder([
    '[fixture] helper',
    'root start',
    '[fixture] helper',
    'helper a start',
    '[fixture] helper',
    'helper a done',
    '[fixture] helper',
    'between helpers',
    '[fixture] helper',
    'helper b start',
    '[fixture] helper',
    'helper b done',
    '[fixture] helper',
    'root done'
  ])
}

async function runRepeatedBranchCountCase() {
  const source = `import type { TimeContext } from "@avtools/core-timing";

function log(label: string, ctx?: TimeContext) {
  const wall = Date.now();
  const logical = ctx ? ctx.time.toFixed(3) : "none";
  console.log(\`[fixture] repeated wall=\${wall} logical=\${logical} \${label}\`);
}

export default async function(ctx: TimeContext) {
  for (const name of ["a", "b", "c"]) {
    ctx.branch(async (branchCtx) => {
      log(\`branch \${name} start\`, branchCtx);
      await branchCtx.waitSec(0.40);
      log(\`branch \${name} done\`, branchCtx);
    });
  }

  await ctx.waitSec(0.45);
  log("root done", ctx);
}
`

  await setSourceAndRun(source)
  const manifest = await waitForManifest(2, 'repeated branch manifest')
  const branchCallsite = manifest.callsites.find(
    (callsite) => callsite.displayName === 'branchCtx.waitSec'
  )
  const rootCallsite = manifest.callsites.find((callsite) => callsite.displayName === 'ctx.waitSec')
  assert(branchCallsite, 'repeated branch callsite is present')
  assert(rootCallsite, 'repeated root callsite is present')

  await waitForAppliedIds(
    [branchCallsite.id, rootCallsite.id],
    'repeated branch/root overlap highlight'
  )
  await waitForAppliedIds([], 'repeated branch highlights clear', 8_000)

  const history = await getAppliedHistory()
  for (const ids of history) {
    const occurrences = ids.filter((id) => id === branchCallsite.id).length
    assert(
      occurrences <= 1,
      `repeated branch callsite should appear once per snapshot, saw ${occurrences}`
    )
  }
  assertServerLogsContain([
    '[fixture] repeated',
    'branch a start',
    'branch b start',
    'branch c start',
    'branch a done',
    'branch b done',
    'branch c done',
    'root done'
  ])
}

async function runUnsupportedAwaitCase() {
  const historyCount = await generatedHistoryCount()
  const source = `import type { TimeContext } from "@avtools/core-timing";

export default async function(ctx: TimeContext) {
  console.log("[fixture] invalid arbitrary should not run", ctx.time);
  await fetch("https://example.com/data.json");
  await ctx.waitSec(0.10);
}
`

  await setSourceAndRun(source)
  await waitForDiagnostic('TCV_UNSUPPORTED_AWAIT', 'unsupported await diagnostic')
  assert(
    (await generatedHistoryCount()) === historyCount,
    'unsupported await should not add generated history'
  )
  assert(
    !runtimeFixtureOutputText().includes('[fixture] invalid arbitrary should not run'),
    'unsupported await source should not execute'
  )
}

async function runSplitPromiseErrorCase() {
  const historyCount = await generatedHistoryCount()
  const source = `import type { TimeContext } from "@avtools/core-timing";

async function helper(ctx: TimeContext) {
  console.log("[fixture] split helper should not run", ctx.time);
  await ctx.waitSec(0.10);
}

export default async function(ctx: TimeContext) {
  const p = helper(ctx);
  await p;
}
`

  await setSourceAndRun(source)
  await waitForDiagnostic('TCV_UNAWAITED_TIMED_CALL', 'split promise diagnostic')
  assert(
    (await generatedHistoryCount()) === historyCount,
    'split promise should not add generated history'
  )
  assert(
    !runtimeFixtureOutputText().includes('[fixture] split helper should not run'),
    'split promise source should not execute'
  )
}

async function setSourceAndRun(source) {
  await waitForAppliedIds([], 'previous highlights clear', 8_000)
  await page.evaluate(() => window.__livecodeVisualizerDebug?.reset?.())
  await page.evaluate((nextSource) => {
    window.__livecodeVisualizerDebug?.setSource?.(nextSource)
  }, source)
  await waitForPageValue(
    (expected) => window.__livecodeVisualizerDebug?.getSource?.() === expected,
    'editor source update',
    2_000,
    source
  )
  await page.getByTestId('run-module').click()
}

async function waitForManifest(expectedCallsiteCount, label) {
  return await waitForPageValue(
    ({ moduleId, expectedCallsiteCount }) => {
      const manifest = window.__livecodeVisualizerDebug?.lastManifestByModule[moduleId]
      if (!manifest || manifest.callsites.length !== expectedCallsiteCount) {
        return null
      }
      return manifest
    },
    label,
    10_000,
    { moduleId, expectedCallsiteCount }
  )
}

async function waitForAppliedIds(expectedIds, label, timeoutMs = 5_000) {
  return await waitForPageValue(
    ({ moduleId, expectedIds }) => {
      const ids = window.__livecodeVisualizerDebug?.appliedHighlightsByModule[moduleId] ?? []
      if (ids.length === expectedIds.length && expectedIds.every((id) => ids.includes(id))) {
        return ids
      }
      return null
    },
    label,
    timeoutMs,
    { moduleId, expectedIds }
  )
}

async function waitForDomDecoration(label) {
  await waitForPageValue(() => document.querySelectorAll('.tcv-wait-active').length > 0, label)
}

async function waitForDiagnostic(code, label) {
  await waitForText(code, label, 8_000)
}

async function waitForText(text, label, timeoutMs = 10_000) {
  await page.getByText(text).waitFor({ timeout: timeoutMs })
}

async function generatedHistoryCount() {
  return await page.getByTestId('generated-history').locator('li').count()
}

async function getAppliedHistory() {
  return await page.evaluate((moduleId) => {
    return window.__livecodeVisualizerDebug?.appliedHighlightHistoryByModule[moduleId] ?? []
  }, moduleId)
}

function assertHighlightHistoryIncludes(id, label) {
  return waitForPageValue(
    ({ moduleId, id }) => {
      const history =
        window.__livecodeVisualizerDebug?.appliedHighlightHistoryByModule[moduleId] ?? []
      return history.some((ids) => ids.includes(id))
    },
    label,
    5_000,
    { moduleId, id }
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
    await sleep(35)
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

function assertNoCallsiteDisplayName(manifest, displayName) {
  assert(
    !manifest.callsites.some((callsite) => callsite.displayName === displayName),
    `unexpected manifest callsite display name ${displayName}`
  )
}

function assertServerLogsInOrder(parts) {
  const text = runtimeFixtureOutputText()
  let index = 0
  for (const part of parts) {
    const nextIndex = text.indexOf(part, index)
    assert(nextIndex >= 0, `missing server log part after index ${index}: ${part}`)
    index = nextIndex + part.length
  }
}

function assertServerLogsContain(parts) {
  const text = runtimeFixtureOutputText()
  for (const part of parts) {
    assert(text.includes(part), `missing server log part: ${part}`)
  }
}

function assertDeepEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  assert(actualJson === expectedJson, `${label}: expected ${expectedJson}, received ${actualJson}`)
}

function assert(value, message) {
  if (!value) throw new Error(message)
}

function serverOutputText() {
  return serverOutput.join('\n')
}

function runtimeFixtureOutputText() {
  return serverOutputText()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('[fixture]'))
    .join('\n')
}

function startDenoServer() {
  return new Promise((resolve, reject) => {
    serverProc = spawn(
      process.env.DENO_BIN ?? 'deno',
      [
        'run',
        '--allow-all',
        denoServerPath,
        '--host',
        '127.0.0.1',
        '--port',
        '0',
        '--session-root',
        sessionRoot,
        '--log-level',
        'debug'
      ],
      {
        cwd: denoNotebookRoot,
        stdio: ['ignore', 'pipe', 'pipe']
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
      if (!settled) reject(new Error(`Deno server exited early: ${code ?? signal}`))
    })
  })
}

async function startVite() {
  const port = await getFreePort()
  const viteBaseUrl = `http://127.0.0.1:${port}/`
  viteProc = spawn(
    process.execPath,
    [
      path.join(browserProjectRoot, 'node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort'
    ],
    {
      cwd: browserProjectRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  viteProc.stdout.setEncoding('utf8')
  viteProc.stderr.setEncoding('utf8')
  viteProc.stdout.on('data', (chunk) => viteOutput.push(chunk))
  viteProc.stderr.on('data', (chunk) => viteOutput.push(chunk))
  viteProc.once('exit', (code, signal) => {
    viteOutput.push(`Vite exited: ${code ?? signal}`)
  })

  await waitForHttp(viteBaseUrl, 'vite dev server')
  return viteBaseUrl
}

async function waitForHttp(url, label, timeoutMs = 20_000) {
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
  const artifactDir = mkdtempSync(path.join(tmpdir(), 'livecode-e2e-'))
  if (page) {
    await page
      .screenshot({
        path: path.join(artifactDir, 'failure.png'),
        fullPage: true
      })
      .catch(() => {})
  }
  writeFileSync(path.join(artifactDir, 'server-output.log'), serverOutputText())
  writeFileSync(path.join(artifactDir, 'vite-output.log'), viteOutput.join('\n'))
  writeFileSync(
    path.join(artifactDir, 'failure.txt'),
    `${error?.stack ?? error}\n\nsessionRoot=${sessionRoot}\n`
  )
  console.error(`Livecode E2E failure artifacts: ${artifactDir}`)
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGINT')
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    sleep(2_000).then(() => false)
  ])
  if (!exited) {
    child.kill('SIGTERM')
    await Promise.race([once(child, 'exit'), sleep(1_000)])
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
