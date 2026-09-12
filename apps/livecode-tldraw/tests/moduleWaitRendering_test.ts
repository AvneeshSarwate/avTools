import type { SourceRange } from '../src/livecodeProtocol.ts'
import {
  equalWaitRangeGeometry,
  reconcileActiveWaitRanges,
} from '../src/moduleWaitRendering.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`)
  }
}

function range(from: number, to: number): SourceRange {
  return { from, to }
}

Deno.test('wait decoration geometry ignores recreated equivalent ranges', () => {
  const previous = [range(4, 12), range(20, 25)]
  const recreated = [range(4, 12), range(20, 25)]

  assertEquals(equalWaitRangeGeometry(previous, recreated), true)
  assertEquals(
    reconcileActiveWaitRanges(previous, {
      activeIds: ['first', 'second'],
      manifest: {
        callsites: [
          { id: 'first', range: recreated[0] },
          { id: 'second', range: recreated[1] },
        ],
      },
    }),
    previous,
  )
})

Deno.test('wait decoration geometry changes when an active range moves', () => {
  const previous = [range(4, 12)]
  const next = reconcileActiveWaitRanges(previous, {
    activeIds: ['wait'],
    manifest: { callsites: [{ id: 'wait', range: range(5, 12) }] },
  })

  assertEquals(equalWaitRangeGeometry(previous, next), false)
  assert(next !== previous, 'changed geometry must produce a new range array')
})

Deno.test('an unrelated run update does not reconfigure wait decorations', () => {
  const firstModuleSnapshot = {
    executionCount: 2,
    runStatus: 'running',
    activeIds: ['wait'],
    manifest: { callsites: [{ id: 'wait', range: range(8, 16) }] },
  }
  const applied = reconcileActiveWaitRanges(null, firstModuleSnapshot)
  const updatedModuleSnapshot = {
    ...firstModuleSnapshot,
    executionCount: 3,
    runStatus: 'stopped',
    activeIds: [...firstModuleSnapshot.activeIds],
    manifest: {
      callsites: firstModuleSnapshot.manifest.callsites.map((callsite) => ({
        ...callsite,
        range: { ...callsite.range },
      })),
    },
  }
  const afterRunUpdate = reconcileActiveWaitRanges(
    applied,
    updatedModuleSnapshot,
  )

  assertEquals(afterRunUpdate, applied)
})
