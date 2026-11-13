// npm run test:animation-editor
// Real pointer gestures catch Konva's synthetic dragend during node teardown.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'
const require = createRequire(import.meta.url)
const app = fileURLToPath(new URL('..', import.meta.url))
const repo = resolve(app, '../..')
const dir = await realpath(await mkdtemp(join(tmpdir(), 'animation-editor-test-')))
await writeFile(
  join(dir, 'index.html'),
  '<html><head><style>body{margin:0}</style></head><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>'
)
await writeFile(
  join(dir, 'main.js'),
  "import {createApp} from 'vue';import Fixture from './Fixture.vue';createApp(Fixture).mount('#app')"
)
await writeFile(
  join(dir, 'Fixture.vue'),
  `<script setup>
import {ref,onMounted,nextTick} from 'vue'
import Editor from ${JSON.stringify(join(app, 'src/animationEditor/components/AnimationEditorView.vue'))}
const editor=ref(null), changes=[]
onMounted(()=>{
 const e=editor.value
 const data=[{id:'p0',time:0,element:0.2},{id:'p1',time:2,element:0.8},{id:'p2',time:4,element:0.3},{id:'p3',time:6,element:0.9}]
 e.addTrack({id:'n1',name:'position.x',fieldType:'number',low:0,high:1,data,updateNumber:v=>window.lastNumber=v})
 e.addTrack({id:'n2',name:'position.y',fieldType:'number',low:0,high:1,data:data.map(p=>({...p,id:'y'+p.id}))})
 e.addTrack({id:'e1',name:'state',fieldType:'enum',data:[{id:'s0',time:1,element:'idle'},{id:'s1',time:4,element:'run'}]})
 e.addTrack({id:'f1',name:'events',fieldType:'func',data:[{id:'f0',time:1,element:{funcName:'hit',args:[]}},{id:'f1',time:4,element:{funcName:'stop',args:[]}}]})
 e.addTrack({id:'e2',name:'palette',fieldType:'enum',data:[{id:'r0',time:1.5,element:'cool'},{id:'r1',time:3,element:'neutral'}]})
 e.addTrack({id:'f2',name:'other events',fieldType:'func',data:[{id:'r0',time:1.5,element:{funcName:'ping',args:[]}},{id:'r1',time:3,element:{funcName:'pong',args:[]}}]})
 window.probe={editor:e,changes,tick:async()=>{await nextTick();await new Promise(requestAnimationFrame)}}
})
</script><template><Editor ref="editor" :duration="10" style="height:100vh;width:100%" @timeline-change="changes.push($event)" /></template>`
)
const server = await createServer({
  configFile: false,
  root: dir,
  plugins: [vue()],
  logLevel: 'error',
  resolve: { alias: { vue: require.resolve('vue/dist/vue.esm-bundler.js') } },
  // Writing the bundle fixture later must not trigger a reload during its gesture.
  server: { hmr: false, port: 0, host: '127.0.0.1', fs: { allow: [dir, resolve(app, '../..')] } }
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const url = `http://127.0.0.1:${server.httpServer.address().port}`
  const tick = () => page.evaluate(() => window.probe.tick())
  async function reset() {
    await page.goto(url)
    await page.waitForFunction(() => !!window.probe)
    await tick()
    await page.getByTestId('mode-toggle').click()
    await tick()
    await page.evaluate(() => (window.probe.changes.length = 0))
  }
  const state = () =>
    page.evaluate(() => ({
      tracks: window.probe.editor.getTimeline().tracks,
      undo: window.probe.editor.core.undoStack.length,
      changes: window.probe.changes.length,
      preview: window.probe.editor.core.dragPreview
    }))
  const point = (s, track = 'n1', id = 'p1') =>
    s.tracks.find((t) => t.id === track)?.elementData.find((e) => e.id === id)
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.015, `${a} ≠ ${b}`)
  const canvas = (type) => page.locator(`[data-component=${type}] canvas`).first()
  async function begin(type = 'NumberLane', time = 2, value = 0.8) {
    const b = await canvas(type).boundingBox(),
      y = type === 'NumberLane' ? 20 + 160 * (1 - value) : 60
    await page.mouse.move(b.x + (b.width * time) / 10, b.y + y)
    await page.mouse.down()
    await page.mouse.move(b.x + (b.width * (time + 0.2)) / 10, b.y + y + 8, { steps: 3 })
    await tick()
    return b
  }
  async function release(b, type = 'NumberLane', time = 3, value = 0.55) {
    await page.mouse.move(
      b.x + (b.width * time) / 10,
      b.y + (type === 'NumberLane' ? 20 + 160 * (1 - value) : 60),
      { steps: 8 }
    )
    await page.mouse.up()
    await tick()
  }
  async function incoming(kind) {
    await page.evaluate(async (kind) => {
      const e = window.probe.editor
      if (kind === 'scrub') e.scrubToTime(1)
      if (kind === 'jump') e.jumpToTime(1)
      if (kind === 'markers') e.setPlayheadMarkers([{ id: 'play', position: 1 }])
      if (['echo', 'unrelated', 'conflict', 'remove', 'bounds', 'neighbour'].includes(kind)) {
        const data = e.getTimeline(),
          t = data.tracks.find((t) => t.id === 'n1')
        if (kind === 'unrelated') data.tracks.find((t) => t.id === 'n2').elementData[1].value = 0.99
        if (kind === 'conflict') t.elementData[1].value = 0.99
        if (kind === 'remove') t.elementData = t.elementData.filter((p) => p.id !== 'p1')
        if (kind === 'bounds') t.high = 2
        if (kind === 'neighbour') t.elementData[2].time = 3.8
        e.setTimeline(data)
      }
      await window.probe.tick()
    }, kind)
  }
  for (const type of ['NumberLane', 'EnumLane', 'FuncLane']) {
    await reset()
    const b = await canvas(type).boundingBox()
    const x = b.x + b.width * (type === 'NumberLane' ? 0.2 : 0.1)
    const y = b.y + (type === 'NumberLane' ? 52 : 60)
    await page.mouse.click(x, y)
    await tick()
    assert.equal(await page.getByTestId('precision-open').count(), 1)
    await page.mouse.click(x, y)
    await tick()
    assert.equal(await page.getByTestId('precision-open').count(), 0)
    assert.equal((await state()).undo, 0)
    assert.equal((await state()).changes, 0)
    await page.mouse.click(x, y)
    await tick()
    assert.equal(await page.getByTestId('precision-open').count(), 1)
    const box = await begin(type, type === 'NumberLane' ? 2 : 1)
    await release(box, type, type === 'NumberLane' ? 3 : 2)
    assert.equal(await page.getByTestId('precision-open').count(), 1)
    assert.equal((await state()).undo, 1)
    console.log('PASS ' + type + ' click toggles selection; dragging retains selection')
  }
  for (const kind of ['control', 'scrub', 'jump', 'markers', 'echo', 'unrelated']) {
    await reset()
    const b = await begin()
    await incoming(kind)
    const during = await state()
    near(point(during).time, 2)
    assert.equal(during.undo, 0, kind + ' committed before release')
    assert.equal(during.changes, 0)
    await release(b)
    const after = await state()
    near(point(after).time, 3)
    near(point(after).value, 0.55)
    assert.equal(after.undo, 1)
    assert.equal(after.changes, 1)
    await page.getByTestId('undo').click()
    await tick()
    near(point(await state()).time, 2)
    await page.getByTestId('redo').click()
    await tick()
    near(point(await state()).time, 3)
    console.log('PASS drag through ' + kind + ', one commit, undo/redo')
  }
  for (const kind of ['conflict', 'remove', 'bounds', 'neighbour']) {
    await reset()
    const b = await begin()
    await incoming(kind)
    const before = await state()
    assert.equal(before.undo, 0)
    assert.equal(before.preview, null)
    if (kind === 'conflict') near(point(before).value, 0.99)
    if (kind === 'remove') assert.equal(point(before), undefined)
    await release(b)
    const after = await state()
    assert.equal(after.undo, 0)
    assert.equal(after.changes, 0)
    assert.deepEqual(after.tracks, before.tracks)
    console.log('PASS cancel without commit on ' + kind)
  }
  for (const type of ['EnumLane', 'FuncLane']) {
    await reset()
    const b = await begin(type, 1)
    await incoming('scrub')
    await incoming('echo')
    await release(b, type, 2)
    const s = await state()
    near(point(s, type === 'EnumLane' ? 'e1' : 'f1', type === 'EnumLane' ? 's0' : 'f0').time, 2)
    assert.equal(s.undo, 1)
    console.log('PASS first drag and playback in ' + type)
  }
  // Visible reference markers must own presses, not fall through to background adds.
  for (const type of ['EnumLane', 'FuncLane']) {
    const trackId = type === 'EnumLane' ? 'e2' : 'f2'
    const originalId = type === 'EnumLane' ? 'e1' : 'f1'
    for (const priorSelection of [false, true]) {
      for (const [region, dx, y] of [
        ['bar', -8, 30],
        ['label', 7, 60],
        ['top tab', 7, 8],
        ['bottom tab', -7, 112]
      ]) {
        await reset()
        if (priorSelection) {
          const other = await canvas(type === 'EnumLane' ? 'FuncLane' : 'EnumLane').boundingBox()
          await page.mouse.click(other.x + other.width / 10 + 7, other.y + 60)
          await tick()
        }
        const before = await state()
        const b = await canvas(type).boundingBox()
        const x = b.x + b.width * 0.15 + dx
        await page.mouse.move(x, b.y + y)
        await page.mouse.down()
        await page.mouse.move(x + b.width * 0.06, b.y + y, { steps: 8 })
        await tick()
        assert.equal((await state()).undo, 0)
        await page.mouse.up()
        await tick()
        const after = await state()
        near(point(after, trackId, 'r0').time, 2.1)
        assert.equal(after.tracks.find((t) => t.id === trackId).elementData.length, 2)
        assert.deepEqual(
          after.tracks.find((t) => t.id === originalId),
          before.tracks.find((t) => t.id === originalId)
        )
        assert.equal(after.undo, 1)
        assert.equal(after.changes, 1)
        assert.equal(
          await page.locator('[data-component=' + type + ']').getAttribute('data-front-track-id'),
          trackId
        )
        await page.getByTestId('undo').click()
        await tick()
        near(point(await state(), trackId, 'r0').time, 1.5)
        // Click a marker on the now-background original track, without adding a point.
        await page.mouse.click(b.x + b.width / 10 + dx, b.y + y)
        await tick()
        assert.equal(
          await page.locator('[data-component=' + type + ']').getAttribute('data-front-track-id'),
          originalId
        )
        assert.equal((await state()).undo, 0)
        assert.equal((await state()).tracks.find((t) => t.id === originalId).elementData.length, 2)
        console.log(
          'PASS ' +
            type +
            ' reference ' +
            region +
            ' drag and selection; prior other-lane selection=' +
            priorSelection
        )
      }
    }
  }
  for (const sourceGesture of ['click', 'drag']) {
    for (const from of ['NumberLane', 'EnumLane', 'FuncLane']) {
      for (const to of ['NumberLane', 'EnumLane', 'FuncLane']) {
        if (from === to) continue
        await reset()
        const source = await canvas(from).boundingBox()
        await page.mouse.click(
          source.x + source.width * (from === 'NumberLane' ? 0.2 : 0.1),
          source.y + (from === 'NumberLane' ? 52 : 60)
        )
        await tick()
        if (sourceGesture === 'drag') {
          const sourceBox = await begin(from, from === 'NumberLane' ? 2 : 1)
          await release(sourceBox, from, from === 'NumberLane' ? 3 : 2)
        }
        const b = await begin(to, to === 'NumberLane' ? 2 : 1)
        await release(b, to, to === 'NumberLane' ? 3 : 2)
        const s = await state()
        near(
          point(
            s,
            to === 'NumberLane' ? 'n1' : to === 'EnumLane' ? 'e1' : 'f1',
            to === 'NumberLane' ? 'p1' : to === 'EnumLane' ? 's0' : 'f0'
          ).time,
          to === 'NumberLane' ? 3 : 2
        )
        assert.equal(s.undo, sourceGesture === 'drag' ? 2 : 1)
        assert.equal(s.changes, sourceGesture === 'drag' ? 2 : 1)
        console.log('PASS ' + sourceGesture + ' selected ' + from + ' then immediately drag ' + to)
      }
    }
  }
  for (const type of ['EnumLane', 'FuncLane']) {
    const trackId = type === 'EnumLane' ? 'e1' : 'f1'
    const elementId = type === 'EnumLane' ? 's0' : 'f0'
    for (const [region, dx, y] of [
      ['bar', -8, 30],
      ['label', 7, 60],
      ['top tab', 7, 8],
      ['bottom tab', -7, 112]
    ]) {
      await reset()
      const b = await canvas(type).boundingBox()
      const x = b.x + b.width / 10 + dx
      await page.mouse.move(x, b.y + y)
      await page.mouse.down()
      await page.mouse.move(x + b.width / 10, b.y + y, { steps: 8 })
      await tick()
      assert.equal((await state()).undo, 0)
      await page.mouse.up()
      await tick()
      const s = await state()
      near(point(s, trackId, elementId).time, 2)
      assert.equal(
        s.tracks.find((t) => t.id === trackId).elementData.length,
        2,
        region + ' added a point'
      )
      assert.equal(s.undo, 1)
      assert.equal(s.changes, 1)
      await reset()
      await page.mouse.click(x, b.y + y)
      await tick()
      assert.equal((await state()).undo, 0, region + ' selection edited data')
      assert.equal(await page.getByTestId('precision-open').isVisible(), true)
      await page.keyboard.down('Shift')
      await page.mouse.click(x, b.y + y)
      await page.keyboard.up('Shift')
      await tick()
      const deleted = await state()
      assert.equal(point(deleted, trackId, elementId), undefined)
      assert.equal(deleted.tracks.find((t) => t.id === trackId).elementData.length, 1)
      assert.equal(deleted.undo, 1)
      console.log('PASS ' + type + ' first drag, select and shift-delete from ' + region)
    }
  }
  for (const type of ['NumberLane', 'EnumLane', 'FuncLane']) {
    await reset()
    const b = await canvas(type).boundingBox()
    await page.mouse.move(b.x + b.width * 0.7, b.y + 10)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width * 0.8, b.y + 10, { steps: 8 })
    await page.mouse.up()
    await tick()
    assert.equal((await state()).undo, 0, type + ' background drag added a point')
    await page.mouse.click(b.x + b.width * 0.8, b.y + 10)
    await tick()
    assert.equal((await state()).undo, 1, type + ' background click did not add')
    console.log('PASS ' + type + ' background click versus drag')
  }
  await reset()
  await begin()
  await page.setViewportSize({ width: 900, height: 760 })
  await tick()
  await release(await canvas('NumberLane').boundingBox())
  near(point(await state()).time, 3)
  console.log('PASS resize during drag')
  await reset()
  await begin()
  await page.evaluate(() => window.probe.editor.setWindowRange(1, 9))
  await tick()
  let b = await canvas('NumberLane').boundingBox()
  await page.mouse.move(b.x + b.width * 0.25, b.y + 92, { steps: 8 })
  await page.mouse.up()
  await tick()
  near(point(await state()).time, 3)
  console.log('PASS zoom during drag')
  await reset()
  await begin()
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.mouse.up()
  await tick()
  assert.equal((await state()).undo, 0)
  assert.equal((await state()).preview, null)
  console.log('PASS blur cancels without commit')
  for (const offset of [-7, 7, 14]) {
    await reset()
    const b = await canvas('NumberLane').boundingBox()
    await page.mouse.click(b.x + b.width * 0.1, b.y + 100 + offset)
    await tick()
    const s = await state()
    const added = s.tracks
      .find((t) => t.id === 'n1')
      .elementData.find((e) => !['p0', 'p1', 'p2', 'p3'].includes(e.id))
    near(added.time, 1)
    near(added.value, Math.abs(offset) <= 8 ? 0.5 : 0.5 - offset / 160)
    assert.equal(s.undo, 1)
    await page.getByTestId('undo').click()
    await tick()
    assert.equal((await state()).tracks.find((t) => t.id === 'n1').elementData.length, 4)
    console.log('PASS curve insertion at offset ' + offset + 'px, with undo')
  }
  await reset()
  b = await canvas('NumberLane').boundingBox()
  await page.mouse.click(b.x + b.width * 0.1, b.y + 100)
  await tick()
  assert.equal((await state()).tracks.find((t) => t.id === 'n1').elementData.length, 5)
  console.log('PASS click curve to add')
  await page.getByTestId('precision-open').click()
  await page.getByTestId('precision-time').fill('20')
  await page.getByTestId('precision-number-value').fill('9')
  await page.getByTestId('precision-save').click()
  await tick()
  assert.equal(await page.getByTestId('precision-time').inputValue(), '10')
  assert.equal(await page.getByTestId('precision-number-value').inputValue(), '1')
  await page.getByTestId('precision-close').click()
  console.log('PASS precision clamps time/value and shows saved state')
  await reset()
  b = await canvas('NumberLane').boundingBox()
  await page.mouse.click(b.x + b.width * 0.2, b.y + 52)
  await tick()
  await page.setViewportSize({ width: 1200, height: 760 })
  await tick()
  b = await canvas('NumberLane').boundingBox()
  const pencil = await page.getByTestId('precision-open').boundingBox()
  near(pencil.x, b.x + b.width * 0.2 + 12)
  console.log('PASS precision follows resized geometry')
  await page.evaluate(async () => {
    const e = window.probe.editor
    e.setWindowRange(1, 9)
    const data = e.getTimeline()
    data.tracks[1].elementData[1].value = 0.6
    e.setTimeline(data)
    e.scrubToTime(2)
    await window.probe.tick()
  })
  near(await page.evaluate(() => window.lastNumber), 0.8)
  assert.equal(await page.locator('.tick-label').first().textContent(), '1')
  console.log('PASS incoming data preserves callbacks and zoom')
  await reset()
  let message = ''
  page.once('dialog', async (d) => {
    message = d.message()
    await d.accept()
  })
  await page
    .locator('[data-region=sidebar-number-section]')
    .getByTestId('track-delete')
    .first()
    .click()
  await tick()
  assert.match(message, /can't undo/i)
  assert.equal((await state()).undo, 0)
  assert.equal(
    (await state()).tracks.some((t) => t.id === 'n1'),
    false
  )
  console.log('PASS irreversible deletion warning, no fake undo entry')
  // Lower bound and no-space collisions must never escape the timeline.
  const bounds = await page.evaluate(() => {
    const c = new window.probe.editor.core.constructor(1)
    c.addTrack({ id: 'number', name: 'n', fieldType: 'number', data: [] })
    const id = c.addNumberElement('number', -3, 9)
    c.updateNumberElement('number', id, 20, 9)
    const number = c.getElement('number', id)
    c.addTrack({ id: 'enum', name: 'e', fieldType: 'enum', data: [] })
    c.addEnumElement('enum', 1)
    c.addEnumElement('enum', 100)
    const times = c.getTrackById('enum').times
    const zero = new window.probe.editor.core.constructor(0)
    zero.addTrack({ id: 'e', name: 'e', fieldType: 'enum', data: [] })
    zero.addEnumElement('e', 0)
    zero.commitEdit(() => !!zero.addEnumElement('e', 0))
    return {
      number,
      times,
      zeroCount: zero.getTrackById('e').times.length,
      undo: zero.undoStack.length
    }
  })
  assert.equal(bounds.number.time, 1)
  assert.equal(bounds.number.value, 1)
  assert.ok(bounds.times.every((t) => t >= 0 && t <= 1))
  assert.equal(bounds.zeroCount, 1)
  assert.equal(bounds.undo, 0)
  console.log('PASS bounded collision resolution, zero duration and rejected edit history')
  await reset()
  b = await canvas('NumberLane').boundingBox()
  await page.mouse.click(b.x + b.width * 0.2, b.y + 52)
  await tick()
  await page.getByTestId('precision-open').click()
  await page.getByTestId('precision-time').fill('-2')
  await page.getByTestId('precision-save').click()
  await tick()
  assert.equal(await page.getByTestId('precision-time').inputValue(), '0')
  console.log('PASS negative precision time clamps to zero')
  await reset()
  await begin()
  await page.evaluate(() => {
    window.probe.editor.mode = 'view'
  })
  await tick()
  await page.mouse.up()
  await tick()
  assert.equal((await state()).undo, 0)
  assert.equal((await state()).preview, null)
  console.log('PASS leaving edit mode cancels active gesture')
  await reset()
  const settingsRow = page.locator('[data-component=EditSidebar] [data-track-id=n2]')
  assert.equal(await page.getByTestId('bounds-low').count(), 0)
  await settingsRow.getByTestId('track-settings').click()
  await page.getByTestId('track-settings-popover').waitFor({ state: 'visible' })
  assert.equal(
    await page.locator('[data-component=NumberLane]').getAttribute('data-front-track-id'),
    'n1'
  )
  await page.getByTestId('bounds-low').fill('2')
  await tick()
  assert.equal(await page.getByTestId('track-settings-apply').isDisabled(), true)
  await page.getByTestId('bounds-high').fill('5')
  await page.getByTestId('track-settings-apply').click()
  await tick()
  assert.equal((await state()).tracks.find((t) => t.id === 'n2').low, 2)
  assert.equal((await state()).tracks.find((t) => t.id === 'n2').high, 5)
  assert.equal((await state()).undo, 1)
  await page.getByTestId('undo').click()
  await tick()
  assert.equal((await state()).tracks.find((t) => t.id === 'n2').low, 0)
  await settingsRow.getByTestId('track-settings').click()
  await page.getByTestId('bounds-low').fill('-4')
  await page.keyboard.press('Escape')
  await tick()
  assert.equal(await page.getByTestId('track-settings-popover').count(), 0)
  assert.equal((await state()).tracks.find((t) => t.id === 'n2').low, 0)
  await settingsRow.getByTestId('track-settings').click()
  await page.mouse.click(900, 700)
  await tick()
  assert.equal(await page.getByTestId('track-settings-popover').count(), 0)
  console.log('PASS track settings popup, validation, atomic apply, undo and dismissal')
  // Exercise the actual distribution bundle and its shadow-root overlays too.
  await writeFile(
    join(dir, 'bundle.html'),
    `<html><body style="margin:0"><animation-editor-component duration="10" style="display:block;height:100vh" id="editor"></animation-editor-component><script src="/@fs/${join(repo, 'webcomponents/animation-editor/dist/animation-editor.js')}"></script></body></html>`
  )
  await page.goto(url + '/bundle.html')
  await page.waitForFunction(() => typeof document.querySelector('#editor').addTrack === 'function')
  await page.evaluate(() => {
    const e = document.querySelector('#editor')
    e.addTrack({
      id: 'n',
      name: 'n',
      fieldType: 'number',
      data: [
        { id: 'a', time: 0, element: 0.2 },
        { id: 'b', time: 2, element: 0.8 },
        { id: 'c', time: 4, element: 0.3 }
      ]
    })
  })
  await page.getByTestId('mode-toggle').click()
  // The custom element mounts and ResizeObserver paints its hit canvas asynchronously.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
  b = await canvas('NumberLane').boundingBox()
  await page.mouse.move(b.x + b.width * 0.2, b.y + 52)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * 0.22, b.y + 60, { steps: 3 })
  await page.evaluate(() => {
    const e = document.querySelector('#editor')
    e.scrubToTime(1)
    e.setTimeline(e.getTimeline())
  })
  await page.mouse.move(b.x + b.width * 0.3, b.y + 92, { steps: 8 })
  await page.mouse.up()
  await page.getByTestId('precision-open').click()
  near(Number(await page.getByTestId('precision-time').inputValue()), 3)
  near(Number(await page.getByTestId('precision-number-value').inputValue()), 0.55)
  console.log('PASS built web component drag, acknowledgement and precision overlay')
  await page.keyboard.press('Escape')
  // Close the existing precision modal before testing the native popup in shadow DOM.
  await page.locator('[data-testid=precision-close]').click()
  await page.getByTestId('track-settings').click()
  await page.getByTestId('track-settings-popover').waitFor({ state: 'visible' })
  const popupColor = await page
    .getByTestId('track-settings-popover')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  assert.notEqual(popupColor, 'rgba(0, 0, 0, 0)')
  await page.keyboard.press('Escape')
  console.log('PASS built web component track settings popup')
  assert.deepEqual(errors, [])
  console.log('Animation editor interaction checks passed')
} finally {
  await browser?.close()
  await server.close()
  await rm(dir, { recursive: true, force: true })
}
