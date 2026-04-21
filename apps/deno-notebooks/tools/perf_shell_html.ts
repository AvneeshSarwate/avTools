/**
 * Perf-pane HTML shell — alternative to tweakpane_shell_html.ts.
 *
 * Loads the prebuilt @avtools/perf-pane webcomponent bundle and mounts its
 * custom element pointed at the same WebSocket the main tweakpane panel uses.
 * Wire protocol is unchanged: the perf-pane client speaks the same `OpMessage`
 * / `ClientMessage` vocabulary as tweakpane-client.
 *
 * Build the bundle once with:
 *   cd apps/browser-projections && npm run buildPerfPane
 */

let _cachedBundle: string | null = null

export interface PerfShellOptions {
  title: string
  wsUrl: string
  mobileUrl?: string | null
  qrSvg?: string | null
}

function loadPerfPaneBundle(): string {
  if (_cachedBundle) return _cachedBundle

  const candidates = [
    new URL("../../../webcomponents/perf-pane/dist/perf-pane.js", import.meta.url),
    new URL("../../webcomponents/perf-pane/dist/perf-pane.js", import.meta.url),
  ]
  for (const url of candidates) {
    try {
      _cachedBundle = Deno.readTextFileSync(url)
      return _cachedBundle
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(
    "Could not find perf-pane.js. Build it first:\n" +
      "  cd apps/browser-projections && npm run buildPerfPane\n" +
      "Tried: " + candidates.map((c) => c.pathname).join(", "),
  )
}

export function renderPerfShellHtml(options: PerfShellOptions): string {
  const bundle = loadPerfPaneBundle()
  const title = JSON.stringify(options.title)
  const wsUrl = JSON.stringify(options.wsUrl)
  const mobileUrl = JSON.stringify(options.mobileUrl ?? null)
  const qrSvg = JSON.stringify(options.qrSvg ?? null)

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)}</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      min-height: 100%;
      background: #080c14;
      font-family: system-ui, sans-serif;
      color: #e2ebf6;
    }
    .perf-toolbar {
      display: flex;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid rgba(148, 170, 196, 0.16);
      background: rgba(14, 20, 29, 0.8);
    }
    .perf-share-btn {
      appearance: none;
      border: 1px solid rgba(148, 170, 196, 0.24);
      border-radius: 999px;
      background: linear-gradient(180deg, rgba(220, 228, 239, 0.96), rgba(191, 204, 219, 0.92));
      color: #0f1824;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 12px;
    }
    .perf-share-btn[disabled] {
      opacity: 0.4;
      cursor: default;
    }
    .perf-qr {
      display: flex;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(148, 170, 196, 0.16);
      background: rgba(14, 20, 29, 0.8);
      align-items: center;
    }
    .perf-qr[hidden] { display: none; }
    .perf-qr-graphic { width: 110px; height: 110px; background: #fff; padding: 4px; border-radius: 6px; }
    .perf-qr-graphic svg { width: 100%; height: 100%; }
    .perf-qr-copy { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
    .perf-qr-note { color: rgba(226, 235, 246, 0.72); }
    .perf-qr-link { color: #8fc3ff; word-break: break-all; }
  </style>
</head>
<body>
  <div class="perf-toolbar">
    <button id="perf-share-btn" class="perf-share-btn" type="button">show qr code</button>
  </div>
  <div id="perf-qr-panel" class="perf-qr" hidden>
    <div id="perf-qr-graphic" class="perf-qr-graphic"></div>
    <div class="perf-qr-copy">
      <div class="perf-qr-title">Phone / iPad Control</div>
      <div id="perf-qr-note" class="perf-qr-note"></div>
      <a id="perf-qr-link" class="perf-qr-link" target="_blank" rel="noreferrer"></a>
    </div>
  </div>
  <div id="perf-mount"></div>

  <script>
    const pageTitle = ${title};
    const wsUrl = ${wsUrl};
    const mobileUrl = ${mobileUrl};
    const qrSvg = ${qrSvg};

    document.title = pageTitle;

    const shareButton = document.getElementById('perf-share-btn');
    const qrPanel = document.getElementById('perf-qr-panel');
    const qrGraphic = document.getElementById('perf-qr-graphic');
    const qrNote = document.getElementById('perf-qr-note');
    const qrLink = document.getElementById('perf-qr-link');

    if (qrSvg && mobileUrl) {
      qrGraphic.innerHTML = qrSvg;
      qrNote.textContent = 'Scan with phone/iPad on the same local network.';
      qrLink.textContent = mobileUrl;
      qrLink.href = mobileUrl;
      shareButton.addEventListener('click', () => {
        qrPanel.hidden = !qrPanel.hidden;
        shareButton.textContent = qrPanel.hidden ? 'show qr code' : 'hide qr code';
      });
    } else {
      shareButton.disabled = true;
      qrGraphic.textContent = 'LAN unavailable';
    }
  </script>

  <!-- perf-pane bundle (IIFE, registers <perf-pane-component>) -->
  <script>${bundle}</script>

  <script>
    // Create the element AFTER the bundle has defined it, with the ws-url
    // attribute set BEFORE inserting into the DOM. This avoids any race where
    // Vue mounts the element before the attribute is present.
    customElements.whenDefined('perf-pane-component').then(() => {
      const el = document.createElement('perf-pane-component');
      el.setAttribute('ws-url', wsUrl);
      document.getElementById('perf-mount').appendChild(el);
    });
  </script>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;")
}
