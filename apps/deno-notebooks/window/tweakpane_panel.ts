/// <reference lib="dom" />

/**
 * WindowTweakpane — high-level API for a tweakpane panel inside a native window.
 *
 * Usage:
 *   const { pane, panel } = createWindowTweakpaneFromRaw({ lib, state, ... });
 *   pane.addBinding(params, 'speed', { min: 0, max: 100 });
 *   panel.show();
 *
 *   // In render loop:
 *   pane.processMessages(panel);
 */

import { WindowPanel } from "./panel.ts";
import { generatePanelHtml } from "./panel_html.ts";
import type { GpuWindow } from "./window.ts";
import type { SyphonServer } from "../syphon/syphon.ts";

// ─── Protocol types (matches tweakpaneProtocol.ts) ─────────────────────

type OpMessage =
  | { type: "addBinding"; id: string; parentId: string; key: string; value: unknown; opts: Record<string, unknown> }
  | { type: "addFolder"; id: string; parentId: string; opts: Record<string, unknown> }
  | { type: "addButton"; id: string; parentId: string; opts: Record<string, unknown> }
  | { type: "addTab"; id: string; parentId: string; opts: Record<string, unknown>; pageIds: string[] }
  | { type: "addSeparator"; id: string; parentId: string }
  | { type: "setProperty"; id: string; prop: string; value: unknown }
  | { type: "refresh"; values: Record<string, unknown> }
  | { type: "dispose"; id: string };

interface BindingEntry {
  obj: Record<string, unknown>;
  key: string;
}

export interface WindowTweakpaneReadyInfo {
  title: string | null;
  bindingCount: number;
  operationCount: number;
}

export interface WindowTweakpaneErrorInfo {
  stage: string;
  message: string;
  stack?: string;
}

let _nextId = 1;
function genId(prefix: string): string {
  return `${prefix}_${_nextId++}`;
}

function serializeOptions(opts: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const fns: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts)) {
    if (typeof v === "function") {
      fns[k] = (v as Function).toString();
    } else {
      result[k] = v;
    }
  }
  if (Object.keys(fns).length > 0) {
    result._functions = fns;
  }
  return result;
}

// ─── Proxy classes ─────────────────────────────────────────────────────

export class PaneBinding {
  readonly id: string;
  #changeHandlers: ((value: unknown) => void)[] = [];

  constructor(id: string) {
    this.id = id;
  }

  on(event: "change", handler: (value: unknown) => void): this {
    if (event === "change") this.#changeHandlers.push(handler);
    return this;
  }

  /** @internal */
  _fireChange(value: unknown): void {
    for (const h of this.#changeHandlers) h(value);
  }
}

export class PaneButton {
  readonly id: string;
  #clickHandlers: (() => void)[] = [];

  constructor(id: string) {
    this.id = id;
  }

  on(event: "click", handler: () => void): this {
    if (event === "click") this.#clickHandlers.push(handler);
    return this;
  }

  /** @internal */
  _fireClick(): void {
    for (const h of this.#clickHandlers) h();
  }
}

export class PaneFolder {
  readonly id: string;
  protected readonly _root: WindowTweakpane;

  constructor(id: string, root: WindowTweakpane) {
    this.id = id;
    this._root = root;
  }

  addBinding(obj: Record<string, unknown>, key: string, opts: Record<string, unknown> = {}): PaneBinding {
    return this._root._addBinding(this.id, obj, key, opts);
  }

  addFolder(opts: { title: string; expanded?: boolean } = { title: "Folder" }): PaneFolder {
    return this._root._addFolder(this.id, opts);
  }

  addButton(opts: { title: string; label?: string }): PaneButton {
    return this._root._addButton(this.id, opts);
  }

  addSeparator(): void {
    this._root._addSeparator(this.id);
  }
}

// ─── Main pane class ───────────────────────────────────────────────────

export class WindowTweakpane {
  readonly #ops: OpMessage[] = [];
  readonly #bindings = new Map<string, BindingEntry>();
  readonly #bindingProxies = new Map<string, PaneBinding>();
  readonly #buttonProxies = new Map<string, PaneButton>();
  readonly #title: string;
  readonly #rootFolder: PaneFolder;
  #connected = false;
  #ready = false;
  #readyInfo: WindowTweakpaneReadyInfo | null = null;
  #lastError: WindowTweakpaneErrorInfo | null = null;
  #panel: WindowPanel | null = null;

  constructor(title?: string) {
    this.#title = title ?? "Controls";
    this.#rootFolder = new PaneFolder("root", this);
  }

  // Delegate root-level calls to the root folder
  addBinding(obj: Record<string, unknown>, key: string, opts: Record<string, unknown> = {}): PaneBinding {
    return this.#rootFolder.addBinding(obj, key, opts);
  }

  addFolder(opts: { title: string; expanded?: boolean } = { title: "Folder" }): PaneFolder {
    return this.#rootFolder.addFolder(opts);
  }

  addButton(opts: { title: string; label?: string }): PaneButton {
    return this.#rootFolder.addButton(opts);
  }

  addSeparator(): void {
    this.#rootFolder.addSeparator();
  }

  get connected(): boolean {
    return this.#connected;
  }

  get ready(): boolean {
    return this.#ready;
  }

  get readyInfo(): WindowTweakpaneReadyInfo | null {
    return this.#readyInfo;
  }

  get lastError(): WindowTweakpaneErrorInfo | null {
    return this.#lastError;
  }

  /** @internal — called by PaneFolder instances */
  _addBinding(parentId: string, obj: Record<string, unknown>, key: string, opts: Record<string, unknown>): PaneBinding {
    const id = genId("b");
    const op: OpMessage = {
      type: "addBinding",
      id,
      parentId,
      key,
      value: obj[key],
      opts: serializeOptions(opts),
    };
    this.#ops.push(op);
    this.#bindings.set(id, { obj, key });
    const proxy = new PaneBinding(id);
    this.#bindingProxies.set(id, proxy);
    if (this.#connected && this.#panel) {
      this.#panel.sendMessage(op);
    }
    return proxy;
  }

  /** @internal */
  _addFolder(parentId: string, opts: Record<string, unknown>): PaneFolder {
    const id = genId("f");
    const op: OpMessage = { type: "addFolder", id, parentId, opts };
    this.#ops.push(op);
    if (this.#connected && this.#panel) {
      this.#panel.sendMessage(op);
    }
    return new PaneFolder(id, this);
  }

  /** @internal */
  _addButton(parentId: string, opts: Record<string, unknown>): PaneButton {
    const id = genId("btn");
    const op: OpMessage = { type: "addButton", id, parentId, opts };
    this.#ops.push(op);
    const proxy = new PaneButton(id);
    this.#buttonProxies.set(id, proxy);
    if (this.#connected && this.#panel) {
      this.#panel.sendMessage(op);
    }
    return proxy;
  }

  /** @internal */
  _addSeparator(parentId: string): void {
    const id = genId("sep");
    const op: OpMessage = { type: "addSeparator", id, parentId };
    this.#ops.push(op);
    if (this.#connected && this.#panel) {
      this.#panel.sendMessage(op);
    }
  }

  /** Push kernel-side value changes to the webview. */
  refresh(): void {
    const values: Record<string, unknown> = {};
    for (const [id, entry] of this.#bindings) {
      values[id] = entry.obj[entry.key];
    }
    const msg: OpMessage = { type: "refresh", values };
    if (this.#connected && this.#panel) {
      this.#panel.sendMessage(msg);
    }
  }

  /**
   * Process IPC messages from the panel webview.
   * Call this once per frame in your render loop.
   */
  processMessages(panel: WindowPanel): void {
    this.#panel = panel;
    const msgs = panel.pollMessages();
    for (const raw of msgs) {
      const msg = raw as Record<string, unknown>;
      switch (msg.type) {
        case "connectionReady":
          this.#connected = true;
          this.#ready = false;
          this.#readyInfo = null;
          panel.sendMessage({
            type: "replay",
            paneConfig: { title: this.#title },
            operations: this.#ops,
          });
          break;
        case "paneReady":
          this.#ready = true;
          this.#readyInfo = {
            title: typeof msg.title === "string" ? msg.title : null,
            bindingCount: Number(msg.bindingCount ?? 0),
            operationCount: Number(msg.operationCount ?? 0),
          };
          break;
        case "panelError":
          this.#lastError = {
            stage: String(msg.stage ?? "unknown"),
            message: String(msg.message ?? "Unknown panel error"),
            stack: typeof msg.stack === "string" ? msg.stack : undefined,
          };
          break;
        case "valueChange": {
          const entry = this.#bindings.get(msg.id as string);
          if (entry) {
            entry.obj[entry.key] = msg.value;
          }
          const proxy = this.#bindingProxies.get(msg.id as string);
          if (proxy) proxy._fireChange(msg.value);
          break;
        }
        case "buttonClick": {
          const btn = this.#buttonProxies.get(msg.id as string);
          if (btn) btn._fireClick();
          break;
        }
      }
    }
  }
}

// ─── Factory ───────────────────────────────────────────────────────────

/**
 * Create a tweakpane panel attached to a native window.
 *
 * Returns { pane, panel } where:
 *   pane — call addBinding/addFolder/addButton etc.
 *   panel — call show()/hide()/toggle(), and pass to pane.processMessages(panel)
 *
 * If syphon is provided, automatically sets the publish region
 * to the sketch dimensions so syphon captures only the sketch, not the panel.
 */
/**
 * Create a tweakpane panel in its own window, linked to a GpuWindow.
 *
 * The panel window is separate from the GPU window (avoids macOS
 * layer-hosting constraint where CAMetalLayer blocks subviews).
 * Press Tab (or toggleKey) on the GPU window to show/hide the panel.
 */
export function createWindowTweakpane(
  gpuWindow: GpuWindow,
  options?: {
    title?: string;
    panelWidth?: number;
    panelHeight?: number;
    toggleKey?: string;
    syphon?: SyphonServer;
  },
): { pane: WindowTweakpane; panel: WindowPanel } {
  const panel = new WindowPanel({
    lib: gpuWindow._lib,
    parentState: gpuWindow._state,
    options: {
      panelWidth: options?.panelWidth,
      panelHeight: options?.panelHeight,
      toggleKey: options?.toggleKey,
      title: options?.title ?? "Controls",
    },
  });

  const html = generatePanelHtml();
  panel.init(html);

  const pane = new WindowTweakpane(options?.title);

  return { pane, panel };
}
