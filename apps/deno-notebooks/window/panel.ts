/// <reference lib="dom" />

import type { WindowLibrary } from "./ffi.ts";
import { encodeTitle } from "./ffi.ts";
import type { WindowEvent } from "./events.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface PanelOptions {
  panelWidth?: number;
  panelHeight?: number;
  toggleKey?: string;
  title?: string;
}

export interface WindowPanelInit {
  lib: WindowLibrary;
  parentState: Deno.PointerValue;
  options?: PanelOptions;
}

/**
 * Manages a wry webview in its own separate native window.
 * Toggle visibility with a key (default: Tab) pressed on the GPU window.
 */
export class WindowPanel {
  readonly #lib: WindowLibrary;
  #webviewState: Deno.PointerValue | null = null;
  readonly #parentState: Deno.PointerValue;
  readonly #panelWidth: number;
  readonly #panelHeight: number;
  readonly #toggleKey: string;
  readonly #title: string;
  #visible = false;
  #initialized = false;
  readonly #ipcBuf = new Uint8Array(256 * 1024);

  constructor(init: WindowPanelInit) {
    this.#lib = init.lib;
    this.#parentState = init.parentState;
    this.#panelWidth = init.options?.panelWidth ?? 320;
    this.#panelHeight = init.options?.panelHeight ?? 600;
    this.#toggleKey = init.options?.toggleKey ?? "Tab";
    this.#title = init.options?.title ?? "Controls";
  }

  get visible(): boolean {
    return this.#visible;
  }

  /** Create the webview window with the given HTML. Starts visible. */
  init(html: string): void {
    const htmlBytes = textEncoder.encode(html);
    const htmlPtr = Deno.UnsafePointer.of(htmlBytes);
    const { ptr: titlePtr, len: titleLen } = encodeTitle(this.#title);

    const state = this.#lib.symbols.create_webview(
      this.#parentState,
      htmlPtr,
      htmlBytes.length,
      this.#panelWidth,
      this.#panelHeight,
      titlePtr,
      titleLen,
    );

    if (!state) {
      throw new Error("Failed to create webview window");
    }

    this.#webviewState = state;
    this.#initialized = true;
    this.#visible = true;
    console.log(`[panel] webview window created (${this.#panelWidth}x${this.#panelHeight})`);
  }

  evalJs(js: string): void {
    if (!this.#initialized || !this.#webviewState) return;
    const bytes = textEncoder.encode(js);
    const ptr = Deno.UnsafePointer.of(bytes);
    this.#lib.symbols.webview_evaluate_script(this.#webviewState, ptr, bytes.length);
  }

  sendMessage(msg: unknown): void {
    const json = JSON.stringify(msg);
    const escaped = json.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
    this.evalJs(`window.dispatchEvent(new CustomEvent('tp-message',{detail:\`${escaped}\`}))`);
  }

  pollMessages(): unknown[] {
    if (!this.#initialized || !this.#webviewState) return [];
    // Pump the CFRunLoop so WKWebView can process its multi-process IPC
    this.#lib.symbols.webview_pump();
    const written = this.#lib.symbols.webview_poll_ipc(
      this.#webviewState,
      Deno.UnsafePointer.of(this.#ipcBuf),
      this.#ipcBuf.length,
    );
    if (!written) return [];
    const text = textDecoder.decode(this.#ipcBuf.subarray(0, written));
    const lines = text.split("\n").filter(Boolean);
    const msgs: unknown[] = [];
    for (const line of lines) {
      try {
        msgs.push(JSON.parse(line));
      } catch { /* skip */ }
    }
    return msgs;
  }

  show(): void {
    if (!this.#initialized || !this.#webviewState || this.#visible) return;
    this.#visible = true;
    this.#lib.symbols.webview_set_visible(this.#webviewState, 1);
  }

  hide(): void {
    if (!this.#initialized || !this.#webviewState || !this.#visible) return;
    this.#visible = false;
    this.#lib.symbols.webview_set_visible(this.#webviewState, 0);
  }

  toggle(): void {
    if (this.#visible) this.hide();
    else this.show();
  }

  /** Process a key event from the PARENT (GPU) window. Returns true if consumed. */
  handleEvent(event: WindowEvent): boolean {
    if (event.type === "key" && event.down) {
      const key = event.key;
      if (key === this.#toggleKey || key === `Named(${this.#toggleKey})`) {
        this.toggle();
        return true;
      }
    }
    return false;
  }

  destroy(): void {
    if (!this.#initialized || !this.#webviewState) return;
    this.#lib.symbols.webview_destroy(this.#webviewState);
    this.#webviewState = null;
    this.#initialized = false;
    this.#visible = false;
  }
}
