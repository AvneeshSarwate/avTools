/**
 * Generates the self-contained HTML page for the tweakpane panel webview.
 *
 * Reads tweakpane.min.js from node_modules at generation time and inlines it.
 *
 * Communication:
 *   Deno → webview: evaluate_script dispatches CustomEvent('tp-message')
 *   webview → Deno: window.ipc.postMessage(JSON)
 *
 * Protocol mirrors tweakpaneProtocol.ts — the webview receives OpMessages
 * and sends ClientMessages back.
 */

let _cachedHtml: string | null = null;

function loadTweakpaneBundle(): string {
  // Resolve relative to this file's location
  const candidates = [
    new URL("../../node_modules/tweakpane/dist/tweakpane.min.js", import.meta.url),
    new URL("../../../node_modules/tweakpane/dist/tweakpane.min.js", import.meta.url),
  ];
  for (const url of candidates) {
    try {
      return Deno.readTextFileSync(url);
    } catch {
      // try next
    }
  }
  throw new Error(
    "Could not find tweakpane.min.js. Tried: " +
      candidates.map((u) => u.pathname).join(", "),
  );
}

const CLIENT_JS = `
(function() {
  'use strict';

  let Tweakpane = null;
  let pane = null;
  const idMap = new Map();
  const bindingData = new Map();
  let suppressSync = false;
  let started = false;

  function sendToHost(msg) {
    try {
      window.ipc.postMessage(JSON.stringify(msg));
    } catch (e) {
      console.error('IPC send error:', e);
    }
  }

  function reportError(stage, error) {
    const message = error && error.message ? String(error.message) : String(error);
    const stack = error && error.stack ? String(error.stack) : undefined;
    console.error('[tweakpane-panel]', stage, error);
    sendToHost({ type: 'panelError', stage, message, stack });
  }

  window.addEventListener('error', (event) => {
    reportError('window.error', event.error || event.message || 'Unknown error');
  });

  window.addEventListener('unhandledrejection', (event) => {
    reportError('window.unhandledrejection', event.reason || 'Unhandled rejection');
  });

  function deserializeOptions(opts) {
    const result = { ...opts };
    if (opts._functions) {
      for (const [key, source] of Object.entries(opts._functions)) {
        try {
          result[key] = new Function('return ' + source)();
        } catch (e) {
          console.warn('Failed to deserialize function', key, e);
        }
      }
      delete result._functions;
    }
    return result;
  }

  function getParent(parentId) {
    if (!parentId || parentId === 'root') return pane;
    return idMap.get(parentId) || pane;
  }

  function handleOp(op) {
    const parent = getParent(op.parentId);
    if (!parent && op.type !== 'refresh' && op.type !== 'dispose'
        && op.type !== 'setProperty' && op.type !== 'bladeValue') return;

    switch (op.type) {
      case 'addBinding': {
        const obj = {};
        obj[op.key] = op.value;
        const opts = deserializeOptions(op.opts || {});
        const binding = parent.addBinding(obj, op.key, opts);
        idMap.set(op.id, binding);
        bindingData.set(op.id, { obj, key: op.key });
        binding.on('change', (ev) => {
          if (suppressSync) return;
          obj[op.key] = ev.value;
          sendToHost({ type: 'valueChange', id: op.id, key: op.key, value: ev.value, last: ev.last });
        });
        break;
      }
      case 'addFolder': {
        const folder = parent.addFolder(op.opts || {});
        idMap.set(op.id, folder);
        folder.on('fold', (ev) => {
          sendToHost({ type: 'foldChange', id: op.id, expanded: ev.expanded });
        });
        break;
      }
      case 'addButton': {
        const btn = parent.addButton(op.opts || {});
        idMap.set(op.id, btn);
        btn.on('click', () => {
          sendToHost({ type: 'buttonClick', id: op.id });
        });
        break;
      }
      case 'addTab': {
        const tab = parent.addTab(op.opts || {});
        idMap.set(op.id, tab);
        if (op.pageIds) {
          op.pageIds.forEach((pid, i) => {
            if (tab.pages[i]) idMap.set(pid, tab.pages[i]);
          });
        }
        tab.on('select', (ev) => {
          sendToHost({ type: 'tabSelect', id: op.id, index: ev.index });
        });
        break;
      }
      case 'addBlade': {
        const blade = parent.addBlade(deserializeOptions(op.opts || {}));
        idMap.set(op.id, blade);
        break;
      }
      case 'addSeparator': {
        const sep = parent.addBlade({ view: 'separator', ...(op.opts || {}) });
        idMap.set(op.id, sep);
        break;
      }
      case 'remove': {
        const child = idMap.get(op.id);
        if (child) {
          const p = getParent(op.parentId);
          if (p && p.remove) p.remove(child);
          idMap.delete(op.id);
          bindingData.delete(op.id);
        }
        break;
      }
      case 'dispose': {
        const target = op.id === 'root' ? pane : idMap.get(op.id);
        if (target && target.dispose) target.dispose();
        break;
      }
      case 'setProperty': {
        const target = op.id === 'root' ? pane : idMap.get(op.id);
        if (target) target[op.prop] = op.value;
        break;
      }
      case 'refresh': {
        suppressSync = true;
        try {
          if (op.values) {
            for (const [id, value] of Object.entries(op.values)) {
              const bd = bindingData.get(id);
              if (bd) {
                bd.obj[bd.key] = value;
                const binding = idMap.get(id);
                if (binding && binding.refresh) binding.refresh();
              }
            }
          }
        } finally {
          suppressSync = false;
        }
        break;
      }
      case 'bladeValue': {
        const blade = idMap.get(op.id);
        if (blade && 'value' in blade) {
          suppressSync = true;
          blade.value = op.value;
          suppressSync = false;
        }
        break;
      }
    }
  }

  window.addEventListener('tp-message', (e) => {
    try {
      const msg = JSON.parse(e.detail);
      if (msg.type === 'replay') {
        if (pane) { pane.dispose(); }
        idMap.clear();
        bindingData.clear();
        pane = new Tweakpane.Pane({
          container: document.getElementById('tp-container'),
          title: msg.paneConfig?.title,
          expanded: msg.paneConfig?.expanded !== false,
        });
        idMap.set('root', pane);
        for (const op of msg.operations || []) {
          handleOp(op);
        }
        sendToHost({
          type: 'paneReady',
          title: msg.paneConfig?.title ?? null,
          bindingCount: bindingData.size,
          operationCount: (msg.operations || []).length,
        });
      } else {
        handleOp(msg);
      }
    } catch (e) {
      reportError('tp-message', e);
    }
  });

  document.addEventListener('keydown', (e) => {
    sendToHost({ type: 'keyForward', key: e.key, code: e.code, down: true });
  });
  document.addEventListener('keyup', (e) => {
    sendToHost({ type: 'keyForward', key: e.key, code: e.code, down: false });
  });

  function start() {
    if (started) return;
    Tweakpane = globalThis.__TP_MODULE || window.Tweakpane || null;
    if (!Tweakpane || !Tweakpane.Pane) {
      reportError('boot', 'Tweakpane.Pane is unavailable');
      return;
    }
    started = true;
    sendToHost({ type: 'connectionReady' });
  }

  if (globalThis.__TP_MODULE || window.Tweakpane) {
    start();
  } else {
    window.addEventListener('tp-module-ready', start, { once: true });
  }
})();
`;

export function generatePanelHtml(): string {
  if (_cachedHtml) return _cachedHtml;

  const tweakpaneJs = loadTweakpaneBundle();
  const tweakpaneModuleUrl = `data:text/javascript;base64,${btoa(tweakpaneJs)}`;

  _cachedHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    height: 100%;
    background: #1a1a2e;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    overflow-y: auto;
    overflow-x: hidden;
  }
  #tp-container { padding: 4px; }
  .tp-dfwv { width: 100% !important; }
</style>
</head>
<body>
<div id="tp-container"></div>
<script type="module">
import('${tweakpaneModuleUrl}')
  .then((mod) => {
    globalThis.__TP_MODULE = mod;
    window.dispatchEvent(new CustomEvent('tp-module-ready'));
  })
  .catch((error) => {
    console.error('[tweakpane-panel] module import failed', error);
    try {
      window.ipc.postMessage(JSON.stringify({
        type: 'panelError',
        stage: 'moduleImport',
        message: error && error.message ? String(error.message) : String(error),
        stack: error && error.stack ? String(error.stack) : undefined,
      }));
    } catch (_) {
      // ignore reporting failures
    }
  });
</script>
<script>${CLIENT_JS}<\/script>
</body>
</html>`;

  return _cachedHtml;
}
