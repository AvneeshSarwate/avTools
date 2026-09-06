/**
 * The projects index page (`projects.html`): finds the local livecode Deno
 * server, lists every project it can see (`GET /projects/list`), and opens a
 * chosen project in the tldraw UI in one of three execution topologies:
 *
 * - "engine on server": the server runs with an in-process engine
 *   (`--engine local`, the default);
 * - "engine in browser": the server coordinates only and a `/engine/` tab
 *   executes modules (`--engine remote`);
 * - "engine in same tab": the UI itself executes modules (`engine=inprocess`)
 *   while the server coordinates only (`--engine remote`).
 *
 * When the server is currently in the other mode, opening asks it to restart
 * itself via `POST /server/engine-mode` and waits for `/health` to come back
 * in the requested mode. Whether a given project's imports actually work in
 * the chosen world is the user's concern — an incompatible project fails at
 * run time exactly as it would when launched by hand.
 */
import type {
  CreateProjectRequest,
  EngineModeChangeResponse,
  HealthResponse,
  ProjectIndexEntry,
  ProjectsListResponse,
} from "@avtools/livecode-protocol";
import { DEFAULT_LIVECODE_SOURCE } from "./defaultSource";

const DEFAULT_SERVER_PORT = 7777;
const HEALTH_POLL_MS = 3000;
const PROBE_TIMEOUT_MS = 1500;
const MODE_SWITCH_TIMEOUT_MS = 30_000;
const LAST_SERVER_STORAGE_KEY = "livecode:projectsIndex:serverBaseUrl";

type EngineMode = "local" | "remote";
type LaunchMode = EngineMode | "inprocess";
type OpenPhase =
  | { kind: "idle" }
  | { kind: "requestingSwitch"; projectName: string; mode: EngineMode }
  | { kind: "waitingForServer"; projectName: string; mode: EngineMode }
  | { kind: "opening"; projectName: string; mode: EngineMode }
  | { kind: "failed"; message: string };

interface PageState {
  serverBaseUrl: string | null;
  health: HealthResponse | null;
  projects: ProjectsListResponse | null;
  projectsError: string | null;
  openPhase: OpenPhase;
  errorMessage: string | null;
}

const state: PageState = {
  serverBaseUrl: null,
  health: null,
  projects: null,
  projectsError: null,
  openPhase: { kind: "idle" },
  errorMessage: null,
};

let discoveryGeneration = 0;
let projectsGeneration = 0;

function openInProgress(): boolean {
  return state.openPhase.kind === "requestingSwitch" ||
    state.openPhase.kind === "waitingForServer" ||
    state.openPhase.kind === "opening";
}

function openPhaseMessage(): string | null {
  const phase = state.openPhase;
  switch (phase.kind) {
    case "requestingSwitch":
      return phase.mode === "remote"
        ? "Requesting browser-engine mode…"
        : "Requesting in-process-engine mode…";
    case "waitingForServer":
      return phase.mode === "remote"
        ? "Waiting for the server to return in browser-engine mode…"
        : "Waiting for the server to return with an in-process engine…";
    case "opening":
      return `Opening ${phase.projectName}…`;
    case "idle":
    case "failed":
      return null;
  }
}

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
  const generation = ++discoveryGeneration;
  for (const candidate of candidateServerBaseUrls()) {
    const health = await fetchHealth(candidate, PROBE_TIMEOUT_MS);
    if (generation !== discoveryGeneration) return;
    if (health) {
      adoptServer(candidate, health);
      return;
    }
  }
  if (generation !== discoveryGeneration) return;
  state.serverBaseUrl = null;
  state.health = null;
  state.projects = null;
  projectsGeneration += 1;
  render();
}

function adoptServer(serverBaseUrl: string, health: HealthResponse): void {
  const changed = state.serverBaseUrl !== serverBaseUrl;
  state.serverBaseUrl = serverBaseUrl;
  state.health = health;
  state.errorMessage = null;
  if (changed) {
    state.projects = null;
    state.projectsError = null;
  }
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
  const generation = ++projectsGeneration;
  const serverBaseUrl = state.serverBaseUrl;
  try {
    const response = await fetch(`${serverBaseUrl}/projects/list`);
    const body = await response.json() as ProjectsListResponse | {
      ok: false;
      error?: string;
    };
    if (
      generation !== projectsGeneration || serverBaseUrl !== state.serverBaseUrl
    ) return;
    if (!body.ok) {
      state.projects = null;
      state.projectsError = ("error" in body && body.error) ||
        `project listing failed (${response.status})`;
    } else {
      state.projects = body;
      state.projectsError = null;
    }
  } catch (error) {
    if (
      generation !== projectsGeneration || serverBaseUrl !== state.serverBaseUrl
    ) return;
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
    if (openInProgress()) continue; // openProject owns the server right now
    if (state.serverBaseUrl) {
      const serverBaseUrl = state.serverBaseUrl;
      const health = await fetchHealth(serverBaseUrl, PROBE_TIMEOUT_MS);
      if (serverBaseUrl !== state.serverBaseUrl || openInProgress()) continue;
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

function uiUrl(project: ProjectIndexEntry, mode: LaunchMode): string {
  // Root is the project picker in the remote dev box; the editor therefore
  // always gets an explicit URL in both Vite dev and built deployments.
  const url = new URL("./index.html", window.location.href);
  url.searchParams.set("serverBaseUrl", state.serverBaseUrl ?? "");
  url.searchParams.set("projectPath", project.root);
  if (mode === "inprocess") {
    url.searchParams.set("engine", "inprocess");
  }
  if (mode === "remote" && serverIsSameOrigin() && broadcastSyncPreferred) {
    url.searchParams.set("sync", "broadcast");
  }
  return url.toString();
}

function projectSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

async function createProjectFromPrompt(): Promise<void> {
  if (!state.serverBaseUrl || !state.projects || openInProgress()) return;
  const name = window.prompt("New project name")?.trim();
  if (!name) return;
  const slug = projectSlug(name);
  if (!slug) {
    state.errorMessage = "Project names must contain a letter or number.";
    render();
    return;
  }
  const root = state.projects.roots[0];
  if (!root) {
    state.errorMessage = "The server has no writable projects root.";
    render();
    return;
  }
  if (
    state.projects.projects.some((project) =>
      project.root === `${root}/${slug}`
    )
  ) {
    state.errorMessage = `A project named ${slug} already exists.`;
    render();
    return;
  }

  const request: CreateProjectRequest = {
    projectPath: `${root}/${slug}`,
    name,
    modules: [
      {
        path: "modules/main.ts",
        kind: "runnable",
        title: "main",
        sourceText: DEFAULT_LIVECODE_SOURCE,
        x: 80,
        y: 80,
        w: 620,
        h: 520,
      },
    ],
  };

  state.errorMessage = null;
  try {
    const response = await fetch(`${state.serverBaseUrl}/project/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const body = await response.json() as { ok: boolean; error?: string };
    if (!response.ok || !body.ok) {
      throw new Error(
        body.error ?? `project creation failed (${response.status})`,
      );
    }
    await refreshProjects();
  } catch (error) {
    state.errorMessage = error instanceof Error ? error.message : String(error);
    render();
  }
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
  launchMode: LaunchMode,
): Promise<void> {
  if (!state.serverBaseUrl || !state.health || openInProgress()) return;
  const mode: EngineMode = launchMode === "local" ? "local" : "remote";
  const serverBaseUrl = state.serverBaseUrl;
  let health = state.health;

  // Reserve tabs inside the click gesture, before a mode switch awaits HTTP.
  // Keep the picker open so it can launch more projects after this completes.
  let uiWindow: Window | null = null;
  let engineWindow: Window | null = null;
  const engineAttached = health.engine.mode === "remote" &&
    health.engine.attached;

  state.errorMessage = null;
  try {
    uiWindow = window.open("", "_blank");
    if (!uiWindow) {
      throw new Error("Allow pop-ups for this page to open the project UI.");
    }
    uiWindow.opener = null;
    if (launchMode === "remote" && !engineAttached) {
      engineWindow = window.open("", "livecode-engine");
      if (!engineWindow) {
        throw new Error(
          "Allow pop-ups for this page to open both the UI and engine tabs.",
        );
      }
    }
    if (health.engine.mode !== mode) {
      state.openPhase = {
        kind: "requestingSwitch",
        projectName: project.name,
        mode,
      };
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
      state.openPhase = {
        kind: "waitingForServer",
        projectName: project.name,
        mode,
      };
      render();
      health = await waitForEngineMode(serverBaseUrl, mode);
      state.health = health;
    }
    if (uiWindow.closed) {
      throw new Error("The project UI tab was closed before it could open.");
    }
    if (engineWindow) {
      engineWindow.location.href = `${serverBaseUrl}/engine/`;
    }
    state.openPhase = { kind: "opening", projectName: project.name, mode };
    render();
    uiWindow.location.href = uiUrl(project, launchMode);
    state.openPhase = { kind: "idle" };
    render();
  } catch (error) {
    uiWindow?.close();
    engineWindow?.close();
    state.openPhase = {
      kind: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
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
  const titleRow = el("div", "title-row");
  titleRow.appendChild(el("h1", undefined, "Livecode projects"));
  const titleActions = el("div", "title-actions");
  const terminalLink = el("a", "terminal-link", "Dev terminal");
  terminalLink.href = "/__cloud/terminal/";
  titleActions.appendChild(terminalLink);
  const createButton = el(
    "button",
    "create-project-button",
    "Create new project",
  ) as HTMLButtonElement;
  createButton.type = "button";
  createButton.disabled = !state.serverBaseUrl || !state.projects ||
    openInProgress();
  createButton.addEventListener("click", () => {
    void createProjectFromPrompt();
  });
  titleActions.appendChild(createButton);
  titleRow.appendChild(titleActions);
  header.appendChild(titleRow);
  header.appendChild(renderServerStatus());
  page.appendChild(header);

  if (state.errorMessage) {
    page.appendChild(el("div", "banner error", state.errorMessage));
  }
  if (state.openPhase.kind === "failed") {
    page.appendChild(el("div", "banner error", state.openPhase.message));
  }
  const busyMessage = openPhaseMessage();
  if (busyMessage) {
    page.appendChild(el("div", "banner busy", busyMessage));
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
  input.disabled = openInProgress();
  submit.disabled = openInProgress();
  form.appendChild(input);
  form.appendChild(submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (openInProgress()) return;
    const url = normalizeServerBaseUrl(input.value);
    if (!url) {
      void discoverServer();
      return;
    }
    const generation = ++discoveryGeneration;
    void fetchHealth(url, PROBE_TIMEOUT_MS).then((health) => {
      if (generation !== discoveryGeneration) return;
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
        " separate-browser-tab opens sync via the engine tab (BroadcastChannel," +
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
      el(
        "div",
        "banner error",
        `Project listing failed: ${state.projectsError}`,
      ),
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
  const busy = openInProgress();
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

  const inProcessButton = el(
    "button",
    "open-button",
    "Open · engine in same tab",
  ) as HTMLButtonElement;
  inProcessButton.disabled = busy;
  inProcessButton.title =
    "Run the engine in the UI tab so canvas outputs appear in canvas views. " +
    "Reloading this tab restarts the engine.";
  inProcessButton.addEventListener("click", () => {
    void openProject(project, "inprocess");
  });
  actions.appendChild(inProcessButton);
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
  .title-row {
    display: flex; align-items: center; justify-content: space-between;
    gap: 16px; margin-bottom: 12px;
  }
  .title-actions { display: flex; align-items: center; gap: 8px; }
  .header h1 { margin: 0 0 12px; font-size: 24px; font-weight: 600; }
  .title-row h1 { margin: 0; }
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
  .terminal-link {
    background: #2b2b33; color: #e8e8ec; border: 1px solid #45454f;
    border-radius: 6px; padding: 6px 12px; font-size: 13px;
    text-decoration: none;
  }
  .terminal-link:hover { background: #37373f; }
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

render();
void discoverServer();
void pollHealthLoop();
