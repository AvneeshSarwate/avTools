// Run: cd apps/music-runners && npx tsx --test src/pianoRoll/scale.test.ts
import { test } from 'node:test'
import { deepStrictEqual, strictEqual } from 'node:assert'
import { parseDegrees, scalePitchClasses, withRootPitchClass } from './scale.ts'

test('parseDegrees reads spaces or commas, sorts, dedupes, adds the octave', () => {
  deepStrictEqual(parseDegrees('0 2 4 5 7 9 11 12'), [0, 2, 4, 5, 7, 9, 11, 12])
  deepStrictEqual(parseDegrees('0,2,3,5,7,9,10'), [0, 2, 3, 5, 7, 9, 10, 12])
  deepStrictEqual(parseDegrees(' 7 0 4 4 '), [0, 4, 7, 12])
  deepStrictEqual(parseDegrees('0 2 4 6 8 10 12 14'), [0, 2, 4, 6, 8, 10, 12, 14])
})

test('parseDegrees rejects non-scales', () => {
  strictEqual(parseDegrees(''), null)
  strictEqual(parseDegrees('2 4 5'), null, 'must include the root')
  strictEqual(parseDegrees('0 2 x'), null)
  strictEqual(parseDegrees('0 1.5'), null)
  strictEqual(parseDegrees('0 -2'), null)
  strictEqual(parseDegrees('0 30'), null)
})

test('pitch classes follow the root; the root octave is kept', () => {
  const dDorian = { root: 62, degrees: [0, 2, 3, 5, 7, 9, 10, 12] }
  const { inScale, root } = scalePitchClasses(dDorian)
  strictEqual(root, 2)
  deepStrictEqual([...inScale].sort((a, b) => a - b), [0, 2, 4, 5, 7, 9, 11])
  deepStrictEqual(withRootPitchClass({ root: 60, degrees: [0, 12] }, 6), { root: 66, degrees: [0, 12] })
  deepStrictEqual(withRootPitchClass({ root: 71, degrees: [0, 12] }, 0), { root: 60, degrees: [0, 12] })
})
