import { renderTweakpaneShellHtml } from "../tools/tweakpane_shell_html.ts";

let _cachedClientModuleUrl: string | null = null;

export interface NativePanelHtmlOptions {
  title?: string;
  sessionId: string;
  wsUrl: string;
  mobileUrl?: string | null;
  qrSvg?: string | null;
}

function loadTweakpaneClientBundle(): string {
  const candidates = [
    new URL("../../webcomponents/tweakpane/dist/tweakpane-client.js", import.meta.url),
    new URL("../../../webcomponents/tweakpane/dist/tweakpane-client.js", import.meta.url),
  ];

  for (const url of candidates) {
    try {
      return Deno.readTextFileSync(url);
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    "Could not find tweakpane-client.js. Tried: " +
      candidates.map((candidate) => candidate.pathname).join(", "),
  );
}

function getTweakpaneClientModuleUrl(): string {
  if (_cachedClientModuleUrl) {
    return _cachedClientModuleUrl;
  }

  const bundle = loadTweakpaneClientBundle();
  _cachedClientModuleUrl = `data:text/javascript;base64,${encodeUtf8Base64(bundle)}`;
  return _cachedClientModuleUrl;
}

export function generatePanelHtml(options: NativePanelHtmlOptions): string {
  return renderTweakpaneShellHtml({
    title: options.title ?? "Tweakpane",
    wsUrl: options.wsUrl,
    sessionId: options.sessionId,
    bundleImportSpecifier: getTweakpaneClientModuleUrl(),
    mobileUrl: options.mobileUrl ?? null,
    qrSvg: options.qrSvg ?? null,
    useHostIpc: true,
  });
}

function encodeUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}
