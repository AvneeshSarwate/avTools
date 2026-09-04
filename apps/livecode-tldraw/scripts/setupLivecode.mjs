// One-shot local setup for the livecode environment: installs and the
// gitignored component bundles the tldraw client consumes. Run it after
// cloning or after pulling changes that touch component sources.
//
//   npm run setupLivecode
//
// Required component bundles fail setup; optional development bundles warn.

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const dir = (...parts) => join(repoRoot, ...parts)

const steps = [
  {
    name: 'install: livecode-tldraw client deps',
    cwd: dir('apps', 'livecode-tldraw'),
    cmd: 'npm install',
    required: true,
  },
  {
    name: 'install: browser-projections build deps',
    cwd: dir('apps', 'browser-projections'),
    cmd: 'npm install',
    required: true,
  },
  {
    name: 'build: piano-roll web component (gitignored bundle)',
    cwd: dir('apps', 'browser-projections'),
    cmd: 'npm run buildPianoRoll',
    required: true,
    verify: () => existsSync(dir('webcomponents', 'piano-roll', 'dist', 'piano-roll.js')),
  },
  {
    name: 'build: animation editor web component (gitignored bundle)',
    cwd: dir('apps', 'browser-projections'),
    cmd: 'npm run buildAnimationEditor',
    required: true,
    verify: () => existsSync(dir('webcomponents', 'animation-editor', 'dist', 'animation-editor.js')),
  },
  {
    name: 'build: handwriting canvas web component (gitignored bundle)',
    cwd: dir('apps', 'browser-projections'),
    cmd: 'npm run buildCanvas',
    required: true,
    verify: () => existsSync(dir('webcomponents', 'handwriting-canvas', 'dist', 'handwriting-canvas.js')),
  },
  {
    name: 'cache: Deno server dependencies (pre-warm first launch)',
    cwd: dir('apps', 'deno-notebooks'),
    cmd: 'deno cache livecode/visualizer/main.ts',
    required: false,
    missingHint: 'deno not found on PATH — install Deno 2.x to run the livecode server',
  },
  {
    name: 'build (optional): tweakpane web component',
    cwd: dir('apps', 'browser-projections'),
    cmd: 'npm run buildTweakpane',
    required: false,
  },
]

const results = []
for (const step of steps) {
  process.stdout.write(`\n=== ${step.name}\n    (${step.cmd} in ${step.cwd})\n`)
  try {
    execSync(step.cmd, { cwd: step.cwd, stdio: 'inherit' })
    if (step.verify && !step.verify()) {
      throw new Error('verification failed: expected output missing')
    }
    results.push({ step, ok: true })
  } catch (error) {
    results.push({ step, ok: false, error })
    if (step.required) {
      console.error(`\nsetupLivecode: required step failed: ${step.name}`)
      printSummary(results)
      process.exit(1)
    }
    const hint = step.missingHint && `${error}`.includes('ENOENT') ? ` (${step.missingHint})` : ''
    console.warn(`setupLivecode: optional step failed, continuing${hint}`)
  }
}

printSummary(results)

function printSummary(results) {
  console.log('\nsetupLivecode summary:')
  for (const { step, ok } of results) {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${step.name}${step.required ? '' : ' [optional]'}`)
  }
}
