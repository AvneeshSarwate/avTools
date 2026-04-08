export interface TweakpaneShellHtmlOptions {
  title?: string
  wsUrl: string
  sessionId: string
  bundleImportSpecifier: string
  mobileUrl?: string | null
  qrSvg?: string | null
  autoResizeToParent?: boolean
  useHostIpc?: boolean
}

export function renderTweakpaneShellHtml(options: TweakpaneShellHtmlOptions): string {
  const title = JSON.stringify(options.title ?? "Tweakpane")
  const wsUrl = JSON.stringify(options.wsUrl)
  const sessionId = JSON.stringify(options.sessionId)
  const bundleImportSpecifier = JSON.stringify(options.bundleImportSpecifier)
  const mobileUrl = JSON.stringify(options.mobileUrl ?? null)
  const qrSvg = JSON.stringify(options.qrSvg ?? null)
  const autoResizeToParent = options.autoResizeToParent ? "true" : "false"
  const useHostIpc = options.useHostIpc ? "true" : "false"

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtmlLiteral(options.title ?? "Tweakpane")}</title>
  <style>
    :root {
      color-scheme: dark;
      --panel-fg: #e8eef8;
      --panel-border: rgba(148, 170, 196, 0.24);
      --panel-surface: rgba(14, 20, 29, 0.78);
      --panel-surface-strong: rgba(9, 14, 22, 0.94);
      --panel-accent: #8fc3ff;
      --panel-accent-strong: #dcedff;
      --panel-muted: rgba(226, 235, 246, 0.72);
      --tp-base-background-color: #16202c;
      --tp-base-border-radius: 10px;
      --tp-base-font-family: SFMono-Regular, ui-monospace, Menlo, Monaco, monospace;
      --tp-base-shadow-color: rgba(0, 0, 0, 0.28);
      --tp-blade-border-radius: 3px;
      --tp-blade-value-width: clamp(224px, 60vw, 320px);
      --tp-button-background-color: #dce4ef;
      --tp-button-background-color-active: #c1cbda;
      --tp-button-background-color-focus: #d0d9e6;
      --tp-button-background-color-hover: #edf3fb;
      --tp-button-foreground-color: #101722;
      --tp-container-background-color: rgba(148, 170, 196, 0.18);
      --tp-container-background-color-active: rgba(148, 170, 196, 0.32);
      --tp-container-background-color-focus: rgba(148, 170, 196, 0.28);
      --tp-container-background-color-hover: rgba(148, 170, 196, 0.24);
      --tp-container-foreground-color: #e2ebf6;
      --tp-container-unit-size: 24px;
      --tp-input-background-color: rgba(10, 16, 24, 0.78);
      --tp-input-background-color-active: rgba(26, 36, 50, 0.96);
      --tp-input-background-color-focus: rgba(22, 32, 45, 0.92);
      --tp-input-background-color-hover: rgba(16, 24, 35, 0.88);
      --tp-input-foreground-color: #eff6ff;
      --tp-label-foreground-color: rgba(226, 235, 246, 0.82);
      --tp-groove-foreground-color: rgba(125, 181, 255, 0.24);
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      min-height: 100%;
      color: var(--panel-fg);
      background:
        radial-gradient(circle at top, rgba(103, 148, 208, 0.2), transparent 36%),
        linear-gradient(180deg, #0f1621 0%, #091018 100%);
      font-family: SFMono-Regular, ui-monospace, Menlo, Monaco, monospace;
    }
    body {
      padding: 12px;
    }
    .tp-shell {
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: 100%;
    }
    .tp-toolbar {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .tp-share-btn {
      appearance: none;
      border: 1px solid var(--panel-border);
      border-radius: 999px;
      background: linear-gradient(180deg, rgba(220, 228, 239, 0.96), rgba(191, 204, 219, 0.92));
      color: #0f1824;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
      padding: 8px 12px;
      text-align: left;
    }
    .tp-share-btn[disabled] {
      cursor: default;
      opacity: 0.6;
    }
    .tp-qr {
      border: 1px solid var(--panel-border);
      border-radius: 16px;
      background: linear-gradient(180deg, var(--panel-surface), var(--panel-surface-strong));
      display: grid;
      gap: 10px;
      grid-template-columns: auto 1fr;
      padding: 12px;
      align-items: center;
    }
    .tp-qr[hidden] {
      display: none;
    }
    .tp-qr-graphic {
      align-items: center;
      background: #fff;
      border-radius: 12px;
      display: flex;
      justify-content: center;
      min-height: 132px;
      min-width: 132px;
      overflow: hidden;
      padding: 10px;
    }
    .tp-qr-graphic svg {
      display: block;
      height: auto;
      max-width: 132px;
      width: 100%;
    }
    .tp-qr-copy {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .tp-qr-title {
      color: var(--panel-accent-strong);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .tp-qr-note {
      color: var(--panel-muted);
      font-size: 12px;
      line-height: 1.4;
    }
    .tp-qr-link {
      color: var(--panel-accent);
      font-size: 12px;
      line-height: 1.4;
      overflow-wrap: anywhere;
      text-decoration: none;
    }
    .tp-qr-link:hover {
      text-decoration: underline;
    }
    .tp-root {
      min-height: 1px;
      width: 100%;
    }
    .tp-dfwv {
      max-width: none !important;
      position: static !important;
      right: auto !important;
      top: auto !important;
      width: 100% !important;
    }
    .tp-rotv {
      width: 100%;
    }
    .tp-lblv {
      align-items: flex-start;
    }
    .tp-lblv_l {
      padding-top: 6px;
    }
    .tp-sldtxtv {
      align-items: center;
      gap: 6px;
    }
    .tp-sldtxtv_s {
      flex: 3;
    }
    .tp-sldtxtv_t {
      flex: 0 0 88px;
      margin-left: 0;
    }
    .tp-sldv_t {
      margin: 0 8px;
    }
    .tp-sldv_t::before,
    .tp-sldv_k::before {
      border-radius: 999px;
      height: 4px;
    }
    .tp-sldv_t::before {
      background: rgba(125, 181, 255, 0.24);
    }
    .tp-sldv_k::before {
      background: linear-gradient(90deg, #78b7ff 0%, #d9ebff 100%);
    }
    .tp-sldv_k::after {
      border-radius: 999px;
      box-shadow: 0 0 0 2px rgba(9, 15, 24, 0.35);
      height: 14px;
      right: -7px;
      width: 14px;
    }
    @media (max-width: 560px) {
      .tp-qr {
        grid-template-columns: 1fr;
      }
      .tp-qr-graphic {
        justify-self: center;
      }
    }
  </style>
</head>
<body>
  <div class="tp-shell">
    <div class="tp-toolbar">
      <button id="tp-share-btn" class="tp-share-btn" type="button">show qr code</button>
      <div id="tp-qr-panel" class="tp-qr" hidden>
        <div id="tp-qr-graphic" class="tp-qr-graphic"></div>
        <div class="tp-qr-copy">
          <div class="tp-qr-title">Phone Control</div>
          <div id="tp-qr-note" class="tp-qr-note"></div>
          <a id="tp-qr-link" class="tp-qr-link" target="_blank" rel="noreferrer"></a>
        </div>
      </div>
    </div>
    <div id="tp-root" class="tp-root"></div>
  </div>
  <script type="module">
    const pageTitle = ${title};
    const wsUrl = ${wsUrl};
    const sessionId = ${sessionId};
    const bundleImportSpecifier = ${bundleImportSpecifier};
    const mobileUrl = ${mobileUrl};
    const qrSvg = ${qrSvg};
    const autoResizeToParent = ${autoResizeToParent};
    const useHostIpc = ${useHostIpc};

    const root = document.getElementById('tp-root');
    const shareButton = document.getElementById('tp-share-btn');
    const qrPanel = document.getElementById('tp-qr-panel');
    const qrGraphic = document.getElementById('tp-qr-graphic');
    const qrNote = document.getElementById('tp-qr-note');
    const qrLink = document.getElementById('tp-qr-link');

    document.title = pageTitle;

    function sendToHost(message) {
      if (!useHostIpc) return;
      try {
        window.ipc.postMessage(JSON.stringify(message));
      } catch (error) {
        console.error('[tweakpane-shell] IPC send error', error);
      }
    }

    function serializeError(error) {
      if (error instanceof Error) {
        return {
          message: error.message,
          stack: error.stack,
        };
      }
      return {
        message: String(error),
      };
    }

    function reportError(stage, error) {
      const details = serializeError(error);
      console.error('[tweakpane-shell]', stage, error);
      sendToHost({
        type: 'panelError',
        stage,
        message: details.message,
        stack: details.stack,
      });
    }

    function collectMetrics() {
      return {
        type: 'panelMetrics',
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        sliderTrackWidth: root.querySelector('.tp-sldv_t')?.getBoundingClientRect().width ?? 0,
        sliderKnobWidth: root.querySelector('.tp-sldv_k')?.getBoundingClientRect().width ?? 0,
      };
    }

    function publishSize() {
      if (autoResizeToParent && window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'resize',
          sessionId,
          height: Math.ceil(document.documentElement.scrollHeight),
        }, '*');
      }
      sendToHost(collectMetrics());
    }

    function setShareState(open) {
      qrPanel.hidden = !open;
      shareButton.textContent = open ? 'hide qr code' : 'show qr code';
    }

    function configureShareUi() {
      if (qrSvg && mobileUrl) {
        qrGraphic.innerHTML = qrSvg;
        qrNote.textContent = 'Scan with your phone camera while both devices are on the same local network.';
        qrLink.textContent = mobileUrl;
        qrLink.href = mobileUrl;
        shareButton.disabled = false;
        shareButton.addEventListener('click', () => {
          setShareState(qrPanel.hidden);
          publishSize();
        });
        return;
      }

      shareButton.disabled = true;
      qrGraphic.textContent = 'LAN unavailable';
      qrNote.textContent = 'No local network URL is available for this pane right now.';
      qrLink.removeAttribute('href');
      qrLink.textContent = '';
    }

    configureShareUi();

    const resizeObserver = new ResizeObserver(() => {
      publishSize();
    });
    resizeObserver.observe(document.body);
    resizeObserver.observe(root);
    window.addEventListener('resize', publishSize);

    window.addEventListener('error', (event) => {
      reportError('window.error', event.error ?? event.message ?? 'Unknown error');
    });

    window.addEventListener('unhandledrejection', (event) => {
      reportError('window.unhandledrejection', event.reason ?? 'Unhandled rejection');
    });

    import(bundleImportSpecifier)
      .then((mod) => {
        const client = new mod.TweakpaneClient(wsUrl, root, {
          onOpen() {
            sendToHost({ type: 'connectionReady' });
          },
          onClose() {
            sendToHost({ type: 'connectionClosed' });
          },
          onReady(info) {
            sendToHost({ type: 'paneReady', ...info });
            publishSize();
          },
          onError(stage, error) {
            reportError(stage, error);
          },
        });
        window.__tweakpaneClient = client;
      })
      .catch((error) => {
        reportError('moduleImport', error);
      });
  </script>
</body>
</html>`
}

function escapeHtmlLiteral(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}
