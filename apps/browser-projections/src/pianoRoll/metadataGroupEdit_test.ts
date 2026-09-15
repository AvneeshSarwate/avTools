import { assertEquals } from 'jsr:@std/assert@1'
import {
  applyPlan,
  diffToOps,
  findNode,
  planEdit,
  sharedDocument,
  summarize,
  type EditOp
} from './metadataGroupEdit.ts'

const docs = [
  { name: 'a', color: '#ff0000', env: { attack: 0.1, release: 2 }, tags: [1, 2] },
  { name: 'b', color: '#ff0000', env: { attack: 0.5, release: 2 }, tags: [1, 2] },
  { name: 'c', color: '#ff0000', env: 3, swing: 0.2 }
]

Deno.test('summarize classifies leaves by presence and agreement', () => {
  const summary = summarize(docs)
  assertEquals(findNode(summary.root, ['color'])!.state, { kind: 'shared', value: '#ff0000' })
  assertEquals(findNode(summary.root, ['name'])!.state, { kind: 'mixed', distinct: 3 })
  assertEquals(findNode(summary.root, ['swing'])!.state, { kind: 'partial', have: 1, value: 0.2 })
  assertEquals(findNode(summary.root, ['tags'])!.state, { kind: 'partial', have: 2, value: [1, 2] })
  // Object in two documents, number in the third.
  assertEquals(findNode(summary.root, ['env'])!.state, { kind: 'conflict', have: 3 })
  // Children are gathered from the documents where it is an object; the
  // release leaf is only present in those two, so it is partial with a value.
  assertEquals(findNode(summary.root, ['env', 'release'])!.state, { kind: 'partial', have: 2, value: 2 })
  assertEquals(findNode(summary.root, ['env', 'attack'])!.state, { kind: 'partial', have: 2 })
})

Deno.test('summarize of one document marks everything shared', () => {
  const summary = summarize([docs[0]!])
  assertEquals(findNode(summary.root, ['env'])!.state, { kind: 'object', have: 1 })
  assertEquals(findNode(summary.root, ['env', 'attack'])!.state, { kind: 'shared', value: 0.1 })
  assertEquals(sharedDocument(summary), docs[0])
})

Deno.test('sharedDocument keeps only leaves every document agrees on', () => {
  const summary = summarize([
    { a: 1, nest: { x: 1, y: 2 } },
    { a: 1, nest: { x: 1, y: 3 } }
  ])
  assertEquals(sharedDocument(summary), { a: 1, nest: { x: 1 } })
})

Deno.test('planEdit warns about overwritten values and replaced non-objects', () => {
  const summary = summarize(docs)
  const plan = planEdit(summary, [
    { op: 'set', path: ['color'], value: '#ff0000' },
    { op: 'set', path: ['name'], value: 'a' },
    { op: 'set', path: ['env', 'release'], value: 4 },
    { op: 'set', path: ['swing'], value: 0.2 },
    { op: 'remove', path: ['name'] }
  ])
  assertEquals(plan.warnings, [
    // Same as the shared value: no warning. `name` differs in b and c.
    { path: ['name'], kind: 'overwrites', affected: 2 },
    // a and b hold release 2; c holds a number at env, which gets replaced.
    { path: ['env', 'release'], kind: 'overwrites', affected: 2 },
    { path: ['env', 'release'], kind: 'replaces', affected: 1 }
    // swing 0.2 matches the only document that has it; removals never warn.
  ])
})

Deno.test('applyPlan sets through missing parents, replaces non-objects, prunes emptied ones', () => {
  const plan = planEdit(summarize(docs), [
    { op: 'set', path: ['env', 'release'], value: 4 },
    { op: 'set', path: ['new', 'deep', 'leaf'], value: true },
    { op: 'remove', path: ['tags'] }
  ])
  assertEquals(applyPlan(docs[0], plan), {
    name: 'a', color: '#ff0000', env: { attack: 0.1, release: 4 }, new: { deep: { leaf: true } }
  })
  assertEquals(applyPlan(docs[2], plan), {
    name: 'c', color: '#ff0000', env: { release: 4 }, swing: 0.2, new: { deep: { leaf: true } }
  })
  const removal = planEdit(summarize([docs[0]!]), [
    { op: 'remove', path: ['env', 'attack'] },
    { op: 'remove', path: ['env', 'release'] }
  ])
  assertEquals(applyPlan(docs[0], removal), { name: 'a', color: '#ff0000', tags: [1, 2] })
  assertEquals(applyPlan({ only: 1 }, planEdit(summarize([{ only: 1 }]), [{ op: 'remove', path: ['only'] }])), undefined)
  assertEquals(applyPlan(undefined, planEdit(summarize([{}]), [{ op: 'set', path: ['x'], value: 1 }])), { x: 1 })
  // Inputs are never mutated.
  assertEquals(docs[0]!.env, { attack: 0.1, release: 2 })
})

Deno.test('diffToOps descends shared objects and emits leaf-level ops', () => {
  const ops: EditOp[] = diffToOps(
    { keep: 1, change: 2, gone: 3, nest: { a: 1, b: 2 }, flat: { x: 1 } },
    { keep: 1, change: 5, added: 'x', nest: { a: 1, c: 3 }, flat: 7 }
  )
  assertEquals(ops, [
    { op: 'set', path: ['change'], value: 5 },
    { op: 'set', path: ['added'], value: 'x' },
    { op: 'set', path: ['nest', 'c'], value: 3 },
    { op: 'remove', path: ['nest', 'b'] },
    { op: 'set', path: ['flat'], value: 7 },
    { op: 'remove', path: ['gone'] }
  ])
})
