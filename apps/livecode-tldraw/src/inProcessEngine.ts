// Load the served host, not a UI-bundled engine: user modules and observation
// must share the asset tree's store singletons. Reloading this page kills it.

import { useEffect, useState } from "react";
import type {
  BrowserEngineHost,
  BrowserEngineHostModule,
  BrowserEngineHostStatus,
} from "@avtools/livecode-protocol";
import { readBootParam } from "./bootParams";

export const IN_PROCESS_ENGINE = readBootParam("engine") === "inprocess";

/** The bake's serverless boot; the in-process host then runs no uplink. */
const SERVERLESS =
  (readBootParam("serverBaseUrl") ?? "").trim().replace(/\/+$/, "") === "none";

/** Where the engine asset tree lives relative to this page (`/engine/` on the
 * server origin, `engine/` beside a bake's index.html). */
const ENGINE_ASSETS_URL = new URL(
  "./engine/",
  window.location.href,
).href;

export type InProcessEngineState =
  | { phase: "off" }
  | { phase: "loading" }
  | { phase: "failed"; error: string }
  | { phase: "hosted"; status: BrowserEngineHostStatus; serverless: boolean };

let state: InProcessEngineState = IN_PROCESS_ENGINE
  ? { phase: "loading" }
  : { phase: "off" };
const listeners = new Set<() => void>();
let hostPromise: Promise<BrowserEngineHost> | null = null;

function setState(next: InProcessEngineState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

/** Start (once) and return this tab's engine host. Rejects when the asset tree
 * is unreachable — a server in local engine mode, or a wrong origin. */
export function inProcessEngineHost(): Promise<BrowserEngineHost> {
  if (!IN_PROCESS_ENGINE) {
    return Promise.reject(new Error("this page does not host an engine"));
  }
  hostPromise ??= loadHost();
  return hostPromise;
}

async function loadHost(): Promise<BrowserEngineHost> {
  const moduleUrl = new URL("engine_host.js", ENGINE_ASSETS_URL).href;
  try {
    const hostModule: BrowserEngineHostModule = await import(
      /* @vite-ignore */ moduleUrl
    );
    const host = hostModule.startBrowserEngineHost({
      engineBaseUrl: ENGINE_ASSETS_URL,
      uplink: !SERVERLESS,
      onStatus: (status) =>
        setState({ phase: "hosted", status, serverless: SERVERLESS }),
    });
    setState({
      phase: "hosted",
      status: host.status(),
      serverless: SERVERLESS,
    });
    return host;
  } catch (error) {
    const message = `Could not start engine from ${ENGINE_ASSETS_URL}: ${
      error instanceof Error ? error.message : String(error)
    }`;
    setState({ phase: "failed", error: message });
    throw new Error(message, { cause: error });
  }
}

/**
 * Wait until server-side operations that need the engine can succeed: this
 * tab's engine has attached over the uplink. Resolves immediately when the
 * page hosts no engine or the boot is serverless, and rejects only if the host
 * shuts down for good (taken over, or the assets never loaded).
 */
export async function waitForInProcessEngineAttached(): Promise<void> {
  if (!IN_PROCESS_ENGINE || SERVERLESS) return;
  const host = await inProcessEngineHost();
  await host.whenUplinkOpen();
}

export function useInProcessEngineState(): InProcessEngineState {
  const [current, setCurrent] = useState(state);
  useEffect(() => {
    const listener = () => setCurrent(state);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return current;
}

// Kick the host off at module load so the engine is starting before React
// mounts; the failure is surfaced through the state, not thrown here.
if (IN_PROCESS_ENGINE) void inProcessEngineHost().catch(() => {});
