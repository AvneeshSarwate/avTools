<script setup lang="ts">
import {onBeforeUnmount, ref} from 'vue';
import CanvasRoot from '../../browser-projections/src/canvas/CanvasRoot.vue';
import {type DrawingDocument, type Preview} from '../shared/protocol.ts';

const drawing = new URLSearchParams(location.search).get('drawing') ?? 'main';
const endpoint = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/canvas?drawing=${encodeURIComponent(drawing)}`;
const status = ref('connecting');
const revision = ref(0);
const initialState = ref('');
const loaded = ref(false);
const error = ref('');
let socket: WebSocket;
let timer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;
let pendingCommit: DrawingDocument | undefined;
let latestDocument: DrawingDocument | undefined;
let awaiting = false;
let pendingPreview: Preview | undefined;

function send(value: unknown) {
  socket.send(JSON.stringify(value));
  awaiting = true;
}
function flush() {
  if (awaiting || socket.readyState !== WebSocket.OPEN || !loaded.value) return;
  if (pendingCommit) {
    const document = pendingCommit;
    pendingCommit = undefined;
    pendingPreview = undefined;
    send({type: 'commit', document});
  } else if (pendingPreview) {
    const preview = pendingPreview;
    pendingPreview = undefined;
    send({type: 'preview', preview});
  }
}
function commit(document: DrawingDocument) {
  latestDocument = document;
  pendingCommit = document;
  pendingPreview = undefined;
  flush();
}
function preview(value: Preview) {
  // Merge queued node edits; dropping an entire patch would lose other nodes.
  const upserts = new Map((pendingPreview?.upserts ?? []).map(item => [item.node.id, item]));
  const deletes = new Map((pendingPreview?.deletes ?? []).map(item => [item.id, item]));
  for (const item of value.upserts) { deletes.delete(item.node.id); upserts.set(item.node.id, item); }
  for (const item of value.deletes) { upserts.delete(item.id); deletes.set(item.id, item); }
  pendingPreview = {upserts: [...upserts.values()], deletes: [...deletes.values()]};
  flush();
}
function connect() {
  if (stopped) return;
  status.value = 'connecting';
  socket = new WebSocket(endpoint + '&role=editor');
  socket.onopen = () => { status.value = 'connected'; awaiting = false; error.value = ''; };
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'snapshot') {
      // Preserve a locally edited document across connection interruptions.
      if (!pendingCommit) initialState.value = JSON.stringify(message.document);
      loaded.value = true;
      revision.value = message.revision;
      flush();
    } else if (message.type === 'accepted') {
      awaiting = false; revision.value = message.revision; flush();
    } else if (message.type === 'error') {
      awaiting = false; error.value = message.message;
      pendingCommit = undefined; pendingPreview = undefined;
    }
  };
  socket.onclose = event => {
    status.value = 'disconnected';
    if (event.code === 4009) { error.value = event.reason; return; }
    if (awaiting && latestDocument) pendingCommit = latestDocument;
    awaiting = false; pendingPreview = undefined;
    if (!stopped) timer = setTimeout(connect, 1000);
  };
}
connect();
onBeforeUnmount(() => { stopped = true; if (timer) clearTimeout(timer); socket.close(); });
</script>

<template>
  <main>
    <header>
      <div><small>AVTOOLS / TOUCHDESIGNER</small><h1>Drawing studio</h1></div>
      <span class="status" :class="{online: status === 'connected'}">{{ status }} · revision {{ revision }}</span>
    </header>
    <section class="connection">
      <strong>{{ drawing }}</strong>
      <span>TOP / CHOP URL</span><code>{{ endpoint }}</code>
      <p>Draw, move, and reshape. Connected sketches update live. Committed edits are saved locally.</p>
    </section>
    <p v-if="error" class="error">{{ error }}</p>
    <CanvasRoot v-if="loaded" mode="document" :initial-state="initialState" :width="1280" :height="720"
      :show-snapshots="true" :show-visualizations="true"
      @document-update="commit" @document-preview="preview" />
    <p v-else>Connecting to the local drawing server…</p>
    <footer>Customize this page in <code>apps/td-canvas/src/App.vue</code>. The canvas is imported directly from CanvasRoot.vue.</footer>
  </main>
</template>

<style>
* {box-sizing: border-box;}
body {margin: 0; background: #f2f1ec; color: #222c33; font-family: system-ui, sans-serif;}
main {max-width: 1400px; margin: 32px auto; padding: 0 24px;}
header {display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;}
h1 {font-size: 32px; margin: 6px 0; letter-spacing: -1px;}
small {letter-spacing: 2px; font-size: 11px;}
.status {padding: 10px 16px; border-radius: 24px; background: #e8d9d0; font-size: 13px;}
.status.online {background: #d5e8da; color: #235038;}
.connection {border-top: 1px solid #ccc; padding-top: 18px;}
.connection strong {font-size: 20px; margin-right: 24px;}
.connection span {font-size: 12px; margin-right: 10px; color: #657079;}
code {font-size: 12px;}
p, footer {font-size: 13px; color: #657079;}
.error {color: #a22;}
.canvas-root {overflow-x: auto; background: #fff; border: 1px solid #d9dad4; border-radius: 8px; align-items: flex-start !important;}
footer {margin: 22px 0;}
</style>
