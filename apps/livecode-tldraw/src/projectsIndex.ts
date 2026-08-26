/**
 * The projects index page (`projects.html`): finds the local livecode Deno
 * server, lists every project it can see (`GET /projects/list`), and opens a
 * chosen project in the tldraw UI in either execution topology:
 *
 * - "engine on server": the server runs with an in-process engine
 *   (`--engine local`, the default);
 * - "engine in browser": the server coordinates only and a `/engine/` tab
 *   executes modules (`--engine remote`).
 *
 * When the server is currently in the other mode, opening asks it to restart
 * itself via `POST /server/engine-mode` and waits for `/health` to come back
 * in the requested mode. Whether a given project's imports actually work in
 * the chosen world is the user's concern — an incompatible project fails at
 * run time exactly as it would when launched by hand.
 */
import type {
  EngineModeChangeResponse,
  HealthResponse,
  ProjectIndexEntry,
  ProjectsListResponse,
} from "@avtools/livecode-protocol";

const DEFAULT_SERVER_PORT = 7777;
const HEALTH_POLL_MS = 3000;
const PROBE_TIMEOUT_MS = 1500;
const MODE_SWITCH_TIMEOUT_MS = 30_000;
const LAST_SERVER_STORAGE_KEY = "livecode:projectsIndex:serverBaseUrl";

interface PageState {
  serverBaseUrl: string | null;
  health: HealthResponse | null;
  projects: ProjectsListResponse | null;
  projectsError: string | null;
  busyMessage: string | null;
  errorMessage: string | null;
}

const state: PageState = {
  serverBaseUrl: null,
  health: null,
  projects: null,
  projectsError: null,
  busyMessage: null,
  errorMessage: null,
};

function normalizeServerBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function candidateServerBaseUrls(): string[] {
  const candidates: string[] = [];
  const fromQuery = new URLSearchParams(window.location.search).get(
    "serverBaseUrl",
  );
  if (fromQuery) candidates.push(fromQuery);
  // Served by the Deno server itself (--ui-dist, including the remote-dev
  // deployment behind Cloudflare Access): same origin IS the server, and it
  // outranks any remembered URL. A vite origin simply fails the probe.
  candidates.push(window.location.origin);
  try {
    const stored = localStorage.getItem(LAST_SERVER_STORAGE_KEY);
    if (stored) candidates.push(stored);
  } catch {
    // Storage can be unavailable; discovery just tries the defaults.
  }
  // The common local case: vite on one port, the server on 7777 of the same
  // host — which is also what makes a LAN-opened page find the right machine.
  candidates.push(`http://${window.location.hostname}:${DEFAULT_SERVER_PORT}`);
  candidates.push(`http://localhost:${DEFAULT_SERVER_PORT}`);
  candidates.push(`http://127.0.0.1:${DEFAULT_SERVER_PORT}`);
  const seen = new Set<string>();
  const httpsPage = window.location.protocol === "https:";
  return candidates
    .map(normalizeServerBaseUrl)
    .filter((url) => {
      if (!url || seen.has(url)) return false;
      // A https page cannot fetch http URLs (mixed content); skip them
      // instead of burning a probe timeout each.
      if (httpsPage && url.startsWith("http:")) return false;
      seen.add(url);
      return true;
    });
}

/** True when the page itself is served by the livecode server's origin. */
function serverIsSameOrigin(): boolean {
  return state.serverBaseUrl !== null &&
    state.serverBaseUrl === normalizeServerBaseUrl(window.location.origin);
}

async function fetchHealth(
  serverBaseUrl: string,
  timeoutMs: number,
): Promise<HealthResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${serverBaseUrl}/health`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = await response.json() as HealthResponse;
    return body.ok === true && body.engine ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function discoverServer(): Promise<void> {
  for (const candidate of candidateServerBaseUrls()) {
    const health = await fetchHealth(candidate, PROBE_TIMEOUT_MS);
    if (health) {
      adoptServer(candidate, health);
      return;
    }
  }
  state.serverBaseUrl = null;
  state.health = null;
  state.projects = null;
  render();
}

function adoptServer(serverBaseUrl: string, health: HealthResponse): void {
  const changed = state.serverBaseUrl !== serverBaseUrl;
  state.serverBaseUrl = serverBaseUrl;
  state.health = health;
  try {
    localStorage.setItem(LAST_SERVER_STORAGE_KEY, serverBaseUrl);
  } catch {
    // Best effort only.
  }
  render();
  if (changed || state.projects === null) void refreshProjects();
}

async function refreshProjects(): Promise<void> {
  if (!state.serverBaseUrl) return;
  const serverBaseUrl = state.serverBaseUrl;
  try {
    const response = await fetch(`${serverBaseUrl}/projects/list`);
    const body = await response.json() as ProjectsListResponse | {
      ok: false;
      error?: string;
    };
    if (serverBaseUrl !== state.serverBaseUrl) return;
    if (!body.ok) {
      state.projects = null;
      state.projectsError = ("error" in body && body.error) ||
        `project listing failed (${response.status})`;
    } else {
      state.projects = body;
      state.projectsError = null;
    }
  } catch (error) {
    if (serverBaseUrl !== state.serverBaseUrl) return;
    state.projects = null;
    state.projectsError = error instanceof Error
      ? error.message
      : String(error);
  }
  render();
}

async function pollHealthLoop(): Promise<void> {
  // One slow loop keeps the header badge and button enablement truthful; a
  // vanished server sends the page back to discovery.
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
    // A hidden tab must go quiet: on the remote-dev deployment every request
    // through the Worker counts as activity, so a forgotten background tab
    // polling /health would keep the container awake (and billed) forever.
    if (document.hidden) continue;
    if (state.busyMessage) continue; // openProject owns the server right now
    if (state.serverBaseUrl) {
      const health = await fetchHealth(state.serverBaseUrl, PROBE_TIMEOUT_MS);
      if (health) {
        state.health = health;
        render();
        continue;
      }
      state.health = null;
      render();
    }
    await discoverServer();
  }
}

/**
 * Same-origin remote opens default to `sync=broadcast`: the UI reads the
 * engine tab's BroadcastChannel instead of the server-relayed `/sync` socket,
 * which on a remote-dev deployment keeps the ~33 ms sync fan-out off the WAN
 * entirely (writes, analysis, and LSP stay HTTP against the server). Off by
 * choice when the engine tab lives on another machine.
 */
let broadcastSyncPreferred = true;

function uiUrl(project: ProjectIndexEntry, mode: "local" | "remote"): string {
  // The tldraw app is index.html next to this page, in dev and in a built
  // dist alike, so "the containing directory" is its URL.
  const url = new URL("./", window.location.href);
  url.searchParams.set("serverBaseUrl", state.serverBaseUrl ?? "");
  url.searchParams.set("projectPath", project.root);
  if (mode === "remote" && serverIsSameOrigin() && broadcastSyncPreferred) {
    url.searchParams.set("sync", "broadcast");
  }
  return url.toString();
}

async function waitForEngineMode(
  serverBaseUrl: string,
  mode: "local" | "remote",
): Promise<HealthResponse> {
  const deadline = Date.now() + MODE_SWITCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const health = await fetchHealth(serverBaseUrl, PROBE_TIMEOUT_MS);
    if (health && health.engine.mode === mode) return health;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Server did not come back in engine-${mode} mode within ` +
      `${MODE_SWITCH_TIMEOUT_MS / 1000}s`,
  );
}

async function openProject(
  project: ProjectIndexEntry,
  mode: "local" | "remote",
): Promise<void> {
  if (!state.serverBaseUrl || !state.health || state.busyMessage) return;
  const serverBaseUrl = state.serverBaseUrl;
  let health = state.health;

  // A popup is only allowed inside the click gesture, so reserve the engine
  // tab now and point it at /engine/ once the server is in remote mode.
  let engineWindow: Window | null = null;
  const engineAttached = health.engine.mode === "remote" &&
    health.engine.attached;
  if (mode === "remote" && !engineAttached) {
    engineWindow = window.open("", "livecode-engine");
  }

  state.errorMessage = null;
  try {
    if (health.engine.mode !== mode) {
      state.busyMessage = mode === "remote"
        ? "Restarting server for a browser engine…"
        : "Restarting server for an in-process engine…";
      render();
      const response = await fetch(`${serverBaseUrl}/server/engine-mode`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const body = await response.json() as EngineModeChangeResponse | {
        ok: false;
        error?: string;
      };
      if (!body.ok) {
        throw new Error(
          ("error" in body && body.error) ||
            `engine mode change failed (${response.status})`,
        );
      }
      if (body.changed) health = await waitForEngineMode(serverBaseUrl, mode);
      state.health = health;
    }
    if (engineWindow) {
      engineWindow.location.href = `${serverBaseUrl}/engine/`;
    }
    state.busyMessage = `Opening ${project.name}…`;
    render();
    window.location.href = uiUrl(project, mode);
  } catch (error) {
    engineWindow?.close();
    state.busyMessage = null;
    state.errorMessage = error instanceof Error
      ? error.message
      : String(error);
    render();
  }
}

// ---------------------------------------------------------------------------
// Rendering

const root = document.getElementById("root")!;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function render(): void {
  root.textContent = "";
  const page = el("div", "page");

  const header = el("header", "header");
  header.appendChild(el("h1", undefined, "Livecode projects"));
  header.appendChild(renderServerStatus());
  page.appendChild(header);

  if (state.errorMessage) {
    page.appendChild(el("div", "banner error", state.errorMessage));
  }
  if (state.busyMessage) {
    page.appendChild(el("div", "banner busy", state.busyMessage));
  }

  page.appendChild(renderProjects());
  root.appendChild(page);
}

function renderServerStatus(): HTMLElement {
  const container = el("div", "server-status");
  if (state.serverBaseUrl && state.health) {
    const engine = state.health.engine;
    container.appendChild(el("span", "server-url", state.serverBaseUrl));
    container.appendChild(
      el(
        "span",
        `badge mode-${engine.mode}`,
        engine.mode === "local" ? "engine on server" : "engine in browser",
      ),
    );
    if (engine.mode === "remote") {
      container.appendChild(
        el(
          "span",
          engine.attached ? "badge attached" : "badge detached",
          engine.attached
            ? `engine tab attached (${engine.kind ?? "?"})`
            : "no engine tab attached",
        ),
      );
    }
  } else if (state.serverBaseUrl) {
    container.appendChild(el("span", "server-url", state.serverBaseUrl));
    container.appendChild(el("span", "badge detached", "unreachable"));
  } else {
    container.appendChild(
      el(
        "span",
        "badge detached",
        "no server found — start it with: deno task livecode:server",
      ),
    );
  }

  const form = el("form", "server-form");
  const input = el("input") as HTMLInputElement;
  input.type = "text";
  input.placeholder = `http://localhost:${DEFAULT_SERVER_PORT}`;
  input.value = state.serverBaseUrl ?? "";
  const submit = el("button", undefined, "Use server") as HTMLButtonElement;
  submit.type = "submit";
  form.appendChild(input);
  form.appendChild(submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const url = normalizeServerBaseUrl(input.value);
    if (!url) {
      void discoverServer();
      return;
    }
    void fetchHealth(url, PROBE_TIMEOUT_MS).then((health) => {
      if (health) adoptServer(url, health);
      else {
        state.errorMessage = `No livecode server responded at ${url}`;
        render();
      }
    });
  });
  container.appendChild(form);

  if (serverIsSameOrigin() && state.health) {
    const toggle = el("label", "sync-toggle");
    const checkbox = el("input") as HTMLInputElement;
    checkbox.type = "checkbox";
    checkbox.checked = broadcastSyncPreferred;
    checkbox.addEventListener("change", () => {
      broadcastSyncPreferred = checkbox.checked;
    });
    toggle.appendChild(checkbox);
    toggle.appendChild(
      document.createTextNode(
        " engine-in-browser opens sync via the engine tab (BroadcastChannel," +
          " keeps sync off the network); uncheck if the engine tab runs on" +
          " another machine",
      ),
    );
    container.appendChild(toggle);
  }
  return container;
}

function renderProjects(): HTMLElement {
  const container = el("main", "projects");
  if (!state.serverBaseUrl || !state.health) {
    container.appendChild(
      el(
        "p",
        "hint",
        "Searching for a livecode server… run `deno task livecode:server` " +
          "(from apps/deno-notebooks) and `npm run dev` " +
          "(from apps/livecode-tldraw), then reload or enter the server URL " +
          "above.",
      ),
    );
    return container;
  }
  if (state.projectsError) {
    container.appendChild(
      el("div", "banner error", `Project listing failed: ${state.projectsError}`),
    );
    return container;
  }
  if (!state.projects) {
    container.appendChild(el("p", "hint", "Loading projects…"));
    return container;
  }
  if (state.projects.projects.length === 0) {
    container.appendChild(
      el(
        "p",
        "hint",
        "No projects found under: " + state.projects.roots.join(", ") +
          ". Pass --projects-root <dir> to the server to scan more " +
          "directories.",
      ),
    );
    return container;
  }

  const list = el("ul", "project-list");
  for (const project of state.projects.projects) {
    list.appendChild(renderProjectCard(project));
  }
  container.appendChild(list);

  const roots = el(
    "p",
    "hint roots",
    `Scanned: ${state.projects.roots.join(", ")}`,
  );
  container.appendChild(roots);
  return container;
}

function renderProjectCard(project: ProjectIndexEntry): HTMLElement {
  const item = el("li", "project-card");
  const title = el("div", "project-title");
  title.appendChild(el("span", "project-name", project.name));
  title.appendChild(
    el(
      "span",
      "badge modules",
      `${project.moduleCount} module${project.moduleCount === 1 ? "" : "s"}`,
    ),
  );
  if (project.engineTarget) {
    title.appendChild(
      el("span", "badge target", `target: ${project.engineTarget}`),
    );
  }
  item.appendChild(title);
  item.appendChild(el("div", "project-path", project.root));
  if (project.error) {
    item.appendChild(
      el("div", "banner error", `Unreadable manifest: ${project.error}`),
    );
    return item;
  }

  const actions = el("div", "project-actions");
  const busy = state.busyMessage !== null;
  const currentMode = state.health?.engine.mode;

  const localButton = el(
    "button",
    "open-button",
    "Open · engine on server",
  ) as HTMLButtonElement;
  localButton.disabled = busy;
  localButton.title = currentMode === "local"
    ? "Open in the tldraw UI (engine runs in the Deno server)"
    : "Restarts the server with an in-process engine, then opens the UI";
  localButton.addEventListener("click", () => {
    void openProject(project, "local");
  });
  actions.appendChild(localButton);

  const remoteButton = el(
    "button",
    "open-button",
    "Open · engine in browser",
  ) as HTMLButtonElement;
  remoteButton.disabled = busy;
  remoteButton.title = currentMode === "remote"
    ? "Open in the tldraw UI (engine runs in a browser /engine/ tab)"
    : "Restarts the server in coordination-only mode, opens an /engine/ " +
      "tab, then opens the UI";
  remoteButton.addEventListener("click", () => {
    void openProject(project, "remote");
  });
  actions.appendChild(remoteButton);

  if (currentMode) {
    actions.appendChild(
      el(
        "span",
        "hint",
        currentMode === "local"
          ? "server is in engine-on-server mode"
          : "server is in engine-in-browser mode",
      ),
    );
  }
  item.appendChild(actions);
  return item;
}

// ---------------------------------------------------------------------------
// Styles: self-contained so the page works in dev and in a built dist.

const style = document.createElement("style");
style.textContent = `
  :root { color-scheme: dark; }
  body {
    margin: 0;
    background: #17171c;
    color: #e8e8ec;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .page { max-width: 860px; margin: 0 auto; padding: 32px 20px 60px; }
  .header h1 { margin: 0 0 12px; font-size: 24px; font-weight: 600; }
  .server-status {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    margin-bottom: 20px;
  }
  .server-url {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px; color: #9ecbff;
  }
  .badge {
    font-size: 11px; padding: 2px 8px; border-radius: 999px;
    border: 1px solid #3a3a44; color: #b9b9c4; white-space: nowrap;
  }
  .badge.mode-local { border-color: #2f6b3f; color: #7fd79a; }
  .badge.mode-remote { border-color: #6b5a2f; color: #e0c069; }
  .badge.attached { border-color: #2f6b3f; color: #7fd79a; }
  .badge.detached { border-color: #6b2f2f; color: #e08b8b; }
  .server-form { display: flex; gap: 6px; flex-basis: 100%; margin-top: 4px; }
  .server-form input {
    flex: 1; max-width: 340px; background: #232329; color: #e8e8ec;
    border: 1px solid #3a3a44; border-radius: 6px; padding: 6px 10px;
    font-size: 13px;
  }
  button {
    background: #2b2b33; color: #e8e8ec; border: 1px solid #45454f;
    border-radius: 6px; padding: 6px 12px; font-size: 13px; cursor: pointer;
  }
  button:hover:not(:disabled) { background: #37373f; }
  button:disabled { opacity: 0.5; cursor: default; }
  .banner {
    border-radius: 8px; padding: 10px 14px; margin: 10px 0; font-size: 13px;
  }
  .banner.error { background: #3a2226; border: 1px solid #6b2f2f; }
  .banner.busy { background: #23303a; border: 1px solid #2f4f6b; }
  .project-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .project-card {
    background: #1f1f26; border: 1px solid #2e2e37; border-radius: 10px;
    padding: 14px 16px;
  }
  .project-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .project-name { font-size: 16px; font-weight: 600; }
  .project-path {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px; color: #8d8d99; margin: 6px 0 10px; word-break: break-all;
  }
  .project-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .sync-toggle {
    flex-basis: 100%; color: #8d8d99; font-size: 12px; margin-top: 4px;
    display: flex; align-items: baseline; gap: 6px; max-width: 640px;
  }
  .hint { color: #8d8d99; font-size: 12px; }
  .hint.roots { margin-top: 18px; }
`;
document.head.appendChild(style);

// Returning to a hidden tab (whose poll loop went quiet — see pollHealthLoop)
// refreshes immediately instead of waiting out a poll interval.
document.addEventListener("visibilitychange", () => {
  if (document.hidden || state.busyMessage) return;
  if (!state.serverBaseUrl) {
    void discoverServer();
    return;
  }
  void fetchHealth(state.serverBaseUrl, PROBE_TIMEOUT_MS).then((health) => {
    if (health) {
      state.health = health;
      render();
    } else {
      void discoverServer();
    }
  });
});

render();
void discoverServer();
void pollHealthLoop();
