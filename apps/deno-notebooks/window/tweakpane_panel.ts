/// <reference lib="dom" />

/**
 * WindowTweakpane — native window wrapper around the shared TweakpaneServer.
 *
 * The native panel webview, notebook iframe, and phone view all run the same
 * browser-side TweakpaneClient against the same kernel-side server.
 */

import type { IframeConfig } from "@avtools/ui-bridge";

import { TweakpaneServer } from "../tools/tweakpaneAdapter.ts";
import type { GpuWindow } from "./window.ts";
import type { SyphonServer } from "../syphon/syphon.ts";
import { WindowPanel } from "./panel.ts";
import { generatePanelHtml } from "./panel_html.ts";

export {
  BindingProxy as PaneBinding,
  ButtonProxy as PaneButton,
  FolderProxy as PaneFolder,
} from "../tools/tweakpaneServer.ts";

export interface WindowTweakpaneReadyInfo {
  title: string | null;
  bindingCount: number;
  operationCount: number;
  sliderCount?: number;
  textInputCount?: number;
  buttonCount?: number;
  sliderTrackWidth?: number;
  sliderKnobWidth?: number;
}

export interface WindowTweakpanePanelMetrics {
  viewportWidth: number;
  viewportHeight: number;
  sliderTrackWidth: number;
  sliderKnobWidth: number;
}

export interface WindowTweakpaneErrorInfo {
  stage: string;
  message: string;
  stack?: string;
}

export class WindowTweakpane extends TweakpaneServer {
  #panelSessionId: string | null = null;
  #connected = false;
  #ready = false;
  #readyInfo: WindowTweakpaneReadyInfo | null = null;
  #panelMetrics: WindowTweakpanePanelMetrics | null = null;
  #lastError: WindowTweakpaneErrorInfo | null = null;
  #panel: WindowPanel | null = null;
  #window: GpuWindow | null = null;
  #originalPollEvents: GpuWindow["pollEvents"] | null = null;
  #originalClose: GpuWindow["close"] | null = null;
  #destroyed = false;

  constructor(title?: string) {
    super({ title });
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

  get panelMetrics(): WindowTweakpanePanelMetrics | null {
    return this.#panelMetrics;
  }

  get lastError(): WindowTweakpaneErrorInfo | null {
    return this.#lastError;
  }

  get visible(): boolean {
    return this.#panel?.visible ?? false;
  }

  /** @internal */
  _attachPanel(panel: WindowPanel, gpuWindow?: GpuWindow): void {
    this.#panel = panel;

    if (!gpuWindow || this.#window === gpuWindow) {
      return;
    }

    this.#window = gpuWindow;
    const originalPollEvents = gpuWindow.pollEvents.bind(gpuWindow);
    const originalClose = gpuWindow.close.bind(gpuWindow);
    this.#originalPollEvents = originalPollEvents;
    this.#originalClose = originalClose;

    gpuWindow.pollEvents = () => {
      const events = originalPollEvents();
      for (const event of events) {
        panel.handleEvent(event);
      }
      this.processMessages();
      if (this.#lastError) {
        throw new Error(`Tweakpane panel error [${this.#lastError.stage}]: ${this.#lastError.message}`);
      }
      return events;
    };

    gpuWindow.close = () => {
      this.destroy();
      originalClose();
    };
  }

  processMessages(panel?: WindowPanel): void {
    if (panel) {
      this.#panel = panel;
    }

    const activePanel = this.#panel;
    if (!activePanel) {
      return;
    }

    const messages = activePanel.pollMessages();
    for (const raw of messages) {
      const msg = raw as Record<string, unknown>;
      switch (msg.type) {
        case "connectionReady":
          this.#connected = true;
          this.#ready = false;
          this.#readyInfo = null;
          break;
        case "connectionClosed":
          this.#connected = false;
          break;
        case "paneReady":
          this.#ready = true;
          this.#readyInfo = {
            title: typeof msg.title === "string" ? msg.title : null,
            bindingCount: Number(msg.bindingCount ?? 0),
            operationCount: Number(msg.operationCount ?? 0),
            sliderCount: Number(msg.sliderCount ?? 0),
            textInputCount: Number(msg.textInputCount ?? 0),
            buttonCount: Number(msg.buttonCount ?? 0),
            sliderTrackWidth: Number(msg.sliderTrackWidth ?? 0),
            sliderKnobWidth: Number(msg.sliderKnobWidth ?? 0),
          };
          break;
        case "panelMetrics":
          this.#panelMetrics = {
            viewportWidth: Number(msg.viewportWidth ?? 0),
            viewportHeight: Number(msg.viewportHeight ?? 0),
            sliderTrackWidth: Number(msg.sliderTrackWidth ?? 0),
            sliderKnobWidth: Number(msg.sliderKnobWidth ?? 0),
          };
          break;
        case "panelError":
          this.#lastError = {
            stage: String(msg.stage ?? "unknown"),
            message: String(msg.message ?? "Unknown panel error"),
            stack: typeof msg.stack === "string" ? msg.stack : undefined,
          };
          break;
      }
    }
  }

  update(): void {
    this.processMessages();
  }

  override show(config?: IframeConfig): void {
    if (config) {
      super.show(config);
      return;
    }
    this.#panel?.show();
  }

  hide(): void {
    this.#panel?.hide();
  }

  toggle(): void {
    this.#panel?.toggle();
  }

  setPanelSize(width: number, height: number): void {
    this.#panel?.setSize(width, height);
  }

  evalPanelJs(js: string): void {
    this.#panel?.evalJs(js);
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;

    if (this.#window) {
      if (this.#originalPollEvents) {
        this.#window.pollEvents = this.#originalPollEvents;
      }
      if (this.#originalClose) {
        this.#window.close = this.#originalClose;
      }
    }

    this.#connected = false;
    this.#ready = false;
    this.#panel?.destroy();
    this.#panel = null;
    this.#window = null;
    this.#originalPollEvents = null;
    this.#originalClose = null;
    this.#panelSessionId = null;
    super.shutdown();
  }

  #ensurePanelSession(): string {
    if (!this.#panelSessionId) {
      this.#panelSessionId = this.ensureClientSession("native-panel");
    }
    return this.#panelSessionId;
  }

  /** @internal */
  _createPanelHtml(): string {
    const sessionId = this.#ensurePanelSession();
    const wsUrl = this.getSessionWebSocketUrl(sessionId, "loopback");
    if (!wsUrl) {
      throw new Error(`Could not build native tweakpane WebSocket URL for session ${sessionId}`);
    }

    const shareInfo = this.getMobileShareInfo();
    return generatePanelHtml({
      title: this.title ?? "Controls",
      sessionId,
      wsUrl,
      mobileUrl: shareInfo?.lanUrl ?? null,
      qrSvg: shareInfo?.qrSvg ?? null,
    });
  }
}

export type PaneContainer = Pick<
  WindowTweakpane,
  "addBinding" | "addFolder" | "addButton" | "addTab"
>;

/**
 * Create a tweakpane panel in its own window, linked to a GpuWindow.
 *
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
): WindowTweakpane {
  const pane = new WindowTweakpane(options?.title);

  const panel = new WindowPanel({
    lib: gpuWindow._lib,
    parentState: gpuWindow._state,
    options: {
      panelWidth: options?.panelWidth ?? 420,
      panelHeight: options?.panelHeight ?? 680,
      toggleKey: options?.toggleKey,
      title: options?.title ?? "Controls",
    },
  });

  const html = pane._createPanelHtml();
  panel.init(html);
  pane._attachPanel(panel, gpuWindow);

  return pane;
}
