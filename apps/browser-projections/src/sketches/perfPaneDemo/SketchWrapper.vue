<script setup lang="ts">
import { onMounted, ref } from 'vue'
import PerfPaneRoot from '@/perfPane/PerfPaneRoot.vue'
import { PerfPaneClient, type WsLike } from '@/perfPane/perfPaneClient'

const paneRef = ref<InstanceType<typeof PerfPaneRoot> | null>(null)

// Mock WebSocket that emits a canned replay and echoes value changes back as
// refresh ops. Lets us iterate on the UI without running combined.ts.
class MockWebSocket implements WsLike {
  readyState = 1
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: unknown) => void) | null = null

  constructor() {
    queueMicrotask(() => {
      this.onopen?.({})
      queueMicrotask(() => {
        this.onmessage?.({ data: JSON.stringify(MOCK_REPLAY) })
      })
    })
  }

  send(data: string) {
    // Log so design iteration can confirm the wire payload
    console.log('[mock ws] →', data)
    try {
      const msg = JSON.parse(data)
      if (msg.type === 'valueChange') {
        // Echo back as a refresh so the slider confirms the committed value.
        setTimeout(() => {
          this.onmessage?.({
            data: JSON.stringify({
              type: 'refresh',
              values: { [msg.id]: msg.value },
            }),
          })
        }, 0)
      }
    } catch {
      // ignore
    }
  }

  close() {
    this.readyState = 3
  }
}

const MOCK_REPLAY = {
  type: 'replay',
  paneConfig: { title: 'Perf (mock)' },
  operations: [
    {
      type: 'addTab',
      id: 'tab_1',
      parentId: 'root',
      opts: { pages: [{ title: 'OSC' }, { title: 'Tegaki' }, { title: 'Body Text' }] },
      pageIds: ['page_osc', 'page_teg', 'page_bt'],
    },
    {
      type: 'addBinding',
      id: 'b_osc_red',
      parentId: 'page_osc',
      key: 'red',
      value: 0.5,
      opts: { min: 0, max: 1, step: 0.001, label: 'Red' },
    },
    {
      type: 'addBinding',
      id: 'b_teg_width',
      parentId: 'page_teg',
      key: 'widthScale',
      value: 0.5,
      opts: { min: 0, max: 1, step: 0.001, label: 'Width x' },
    },
    {
      type: 'addBinding',
      id: 'b_bt_scroll',
      parentId: 'page_bt',
      key: 'scrollSpeed',
      value: 0.5,
      opts: { min: 0, max: 1, step: 0.001, label: 'Scroll Speed' },
    },
  ],
}

onMounted(() => {
  const client = new PerfPaneClient(new MockWebSocket())
  paneRef.value?.setClient(client)
})
</script>

<template>
  <div class="demo-root">
    <div class="demo-note">
      Perf-pane dev harness (mock WS) — drag sliders; check devtools console for valueChange payloads.
    </div>
    <PerfPaneRoot ref="paneRef" />
  </div>
</template>

<style scoped>
.demo-root {
  min-height: 100vh;
  background: #080c14;
}
.demo-note {
  color: #7d8ba6;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(148, 170, 196, 0.12);
}
</style>
