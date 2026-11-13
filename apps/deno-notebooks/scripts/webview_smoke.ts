/// <reference lib="dom" />

import { encodeTitle, openLibrary } from "../window/ffi.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const lib = openLibrary();
const hostTitle = encodeTitle("webview-smoke-host");
const hostState = lib.symbols.create_window(64, 64, hostTitle.ptr, hostTitle.len);

if (!hostState) {
  lib.close();
  throw new Error("Failed to create host window");
}

const html = `<!doctype html>
<html>
<body>smoke</body>
<script>
  setTimeout(() => {
    window.ipc.postMessage(JSON.stringify({
      type: "smoke",
      ok: true,
      href: location.href,
      ua: navigator.userAgent
    }));
  }, 150);
</script>
</html>`;

const htmlBytes = encoder.encode(html);
const panelTitle = encodeTitle("webview-smoke-panel");
const webviewState = lib.symbols.create_webview(
  hostState,
  Deno.UnsafePointer.of(htmlBytes),
  htmlBytes.length,
  320,
  200,
  panelTitle.ptr,
  panelTitle.len,
);

if (!webviewState) {
  lib.symbols.destroy_window(hostState);
  lib.close();
  throw new Error("Failed to create webview");
}

const eventBuf = new Uint8Array(16 * 1024);
const ipcBuf = new Uint8Array(64 * 1024);
const deadline = Date.now() + 5000;
const evalProbeAt = Date.now() + 1000;

let message = "";
let timedOut = true;
let evalProbeSent = false;

try {
  while (Date.now() < deadline) {
    lib.symbols.poll_events(hostState, Deno.UnsafePointer.of(eventBuf), eventBuf.length);
    lib.symbols.webview_pump();

    if (!evalProbeSent && Date.now() >= evalProbeAt) {
      const js = encoder.encode(
        "window.webkit.messageHandlers.ipc.postMessage(JSON.stringify({type:'evalProbe',ok:true}));",
      );
      const ok = lib.symbols.webview_evaluate_script(
        webviewState,
        Deno.UnsafePointer.of(js),
        js.length,
      );
      console.log(`webview smoke eval probe result: ${ok}`);
      evalProbeSent = true;
    }

    const written = lib.symbols.webview_poll_ipc(
      webviewState,
      Deno.UnsafePointer.of(ipcBuf),
      ipcBuf.length,
    );

    if (written > 0) {
      message = decoder.decode(ipcBuf.subarray(0, written));
      timedOut = false;
      break;
    }

    await sleep(20);
  }
} finally {
  lib.symbols.webview_destroy(webviewState);
  lib.symbols.destroy_window(hostState);
  lib.close();
}

if (timedOut) {
  console.error("webview smoke timed out without IPC");
  Deno.exit(1);
}

console.log(`webview smoke IPC: ${message}`);
