import {
  ContainerProxy,
  getSandbox,
  isPlatformTransientError,
  ProcessReadyTimeoutError,
  Sandbox as SandboxBase,
  type ProcessStatus,
  type SandboxProcess,
} from "@cloudflare/sandbox";

export { ContainerProxy };

const SANDBOX_ID = "livecode";
const UI_PORT = 5173;
const BOOT_COMMAND = "/opt/livecode/boot.sh";
const WORKSPACE_ROOT = "/workspace/avTools";
const RUNTIME_ROOT = "/workspace/.livecode-runtime";
const BOOT_STATUS_FILE = `${RUNTIME_ROOT}/boot-status.json`;
const CLAUDE_STATUS_FILE = `${RUNTIME_ROOT}/claude-status`;
const KEEPALIVE_STATUS_FILE = "/data/livecode/keepalive-status";
const STARTUP_PROBE_TIMEOUT_MS = 750;
const STARTUP_CLAIM_STALE_MS = 210_000;
const STARTUP_RETRY_SECONDS = 2;
const MAX_BOOT_LOG_BYTES = 32 * 1024;

type DevBoxState = "idle" | "starting" | "ready" | "failed";

interface DevBoxError {
  name: string;
  message: string;
  code?: string;
}

interface DevBoxStatus {
  state: DevBoxState;
  phase: string;
  attempt: number;
  generation: number;
  updatedAt: string;
  elapsedMs: number;
  startedAt?: string;
  processId?: string;
  processStartedAt?: string;
  bootPhase?: string;
  error?: DevBoxError;
}

interface StartupClaim {
  owner: boolean;
  status: DevBoxStatus;
}

interface BootStatusFile {
  phase: string;
  updatedAt?: string;
  detail?: string;
}

function errorDetails(error: unknown): DevBoxError {
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: unknown };
    const code = errorWithCode.code;
    return {
      name: error.name || "Error",
      message: error.message || "Unknown error",
      ...(typeof code === "string" || typeof code === "number"
        ? { code: String(code) }
        : {}),
    };
  }
  return { name: "Error", message: String(error) };
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

function elapsedMs(startedAt?: string): number {
  if (!startedAt) return 0;
  const started = Date.parse(startedAt);
  return Number.isFinite(started) ? Math.max(0, Date.now() - started) : 0;
}

function isBootProcess(process: ProcessStatus): boolean {
  return process.command.includes(BOOT_COMMAND);
}

function latestBootProcess(processes: ProcessStatus[]): ProcessStatus | null {
  return processes
    .filter(isBootProcess)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ??
    null;
}

function isReadinessTimeout(error: unknown): boolean {
  return error instanceof ProcessReadyTimeoutError ||
    (error instanceof Error && error.name === "ProcessReadyTimeoutError");
}

function isMissingProcessHandle(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return [
    "ProcessNotFoundError",
    "RuntimeIdentityInactiveError",
    "StaleProcessHandleError",
  ].includes(error.name);
}

function isSuccessfulContainerRollout(error: unknown): boolean {
  return error instanceof Error && error.message.includes(
    "Runtime signalled the container to exit due to a new version rollout: 0",
  );
}

function startupLog(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const entry = JSON.stringify({
    component: "livecode-startup",
    event,
    ...fields,
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
}

export class Sandbox extends SandboxBase<Env> {
  defaultPort = UI_PORT;
  sleepAfter = "60m";

  #generation = 0;
  #attempt = 0;
  #startup: DevBoxStatus = {
    state: "idle",
    phase: "idle",
    attempt: 0,
    generation: 0,
    updatedAt: new Date().toISOString(),
    elapsedMs: 0,
  };

  async claimDevBoxStart(retryFailed = false): Promise<StartupClaim> {
    const claimAge = Date.now() - Date.parse(this.#startup.updatedAt);
    const staleClaim = this.#startup.state === "starting" &&
      Number.isFinite(claimAge) && claimAge >= STARTUP_CLAIM_STALE_MS;

    if (this.#startup.state === "ready") {
      return { owner: false, status: this.#snapshot() };
    }
    if (this.#startup.state === "starting" && !staleClaim) {
      return { owner: false, status: this.#snapshot() };
    }
    if (this.#startup.state === "failed" && !retryFailed) {
      return { owner: false, status: this.#snapshot() };
    }

    if (staleClaim) {
      startupLog("warn", "startup.claim.expired", {
        generation: this.#startup.generation,
        phase: this.#startup.phase,
        claimAgeMs: claimAge,
      });
    }

    this.#generation += 1;
    this.#attempt += 1;
    const now = new Date().toISOString();
    this.#startup = {
      state: "starting",
      phase: "mounting_state",
      attempt: this.#attempt,
      generation: this.#generation,
      startedAt: now,
      updatedAt: now,
      elapsedMs: 0,
    };
    startupLog("info", "startup.claimed", {
      attempt: this.#attempt,
      generation: this.#generation,
      retryFailed,
    });
    return { owner: true, status: this.#snapshot() };
  }

  async getDevBoxStatus(): Promise<DevBoxStatus> {
    return this.#snapshot();
  }

  async markDevBoxStarting(
    generation: number,
    phase: string,
    processId?: string,
    processStartedAt?: string,
    bootPhase?: string,
  ): Promise<DevBoxStatus> {
    if (
      generation !== this.#generation || this.#startup.state === "failed" ||
      this.#startup.state === "idle"
    ) {
      return this.#snapshot();
    }
    const now = new Date().toISOString();
    this.#startup = {
      state: "starting",
      phase,
      attempt: this.#attempt,
      generation,
      startedAt: this.#startup.startedAt ?? processStartedAt ?? now,
      updatedAt: now,
      elapsedMs: 0,
      ...(processId ?? this.#startup.processId
        ? { processId: processId ?? this.#startup.processId }
        : {}),
      ...(processStartedAt ?? this.#startup.processStartedAt
        ? {
          processStartedAt: processStartedAt ??
            this.#startup.processStartedAt,
        }
        : {}),
      ...(bootPhase ? { bootPhase } : {}),
    };
    return this.#snapshot();
  }

  async markDevBoxReady(
    generation: number,
    processId: string,
    processStartedAt: string,
  ): Promise<DevBoxStatus> {
    if (
      generation !== this.#generation || this.#startup.state === "failed" ||
      this.#startup.state === "idle"
    ) {
      return this.#snapshot();
    }
    const wasAlreadyReady = this.#startup.state === "ready" &&
      this.#startup.processId === processId;
    const now = new Date().toISOString();
    this.#startup = {
      state: "ready",
      phase: "ready",
      attempt: this.#attempt,
      generation,
      processId,
      processStartedAt,
      startedAt: this.#startup.startedAt ?? processStartedAt,
      updatedAt: now,
      elapsedMs: 0,
      bootPhase: "ready",
    };
    if (!wasAlreadyReady) {
      startupLog("info", "startup.ready", {
        attempt: this.#attempt,
        generation,
        processId,
        elapsedMs: elapsedMs(this.#startup.startedAt),
      });
    }
    return this.#snapshot();
  }

  async markDevBoxFailed(
    generation: number,
    error: DevBoxError,
    phase: string,
    processId?: string,
  ): Promise<DevBoxStatus> {
    if (generation !== this.#generation) return this.#snapshot();
    const now = new Date().toISOString();
    this.#startup = {
      state: "failed",
      phase,
      attempt: this.#attempt,
      generation,
      updatedAt: now,
      elapsedMs: 0,
      ...(this.#startup.startedAt
        ? { startedAt: this.#startup.startedAt }
        : {}),
      ...(processId ?? this.#startup.processId
        ? { processId: processId ?? this.#startup.processId }
        : {}),
      ...(this.#startup.processStartedAt
        ? { processStartedAt: this.#startup.processStartedAt }
        : {}),
      error,
    };
    return this.#snapshot();
  }

  async markDevBoxIdle(generation: number): Promise<DevBoxStatus> {
    if (generation !== this.#generation) return this.#snapshot();
    const now = new Date().toISOString();
    this.#startup = {
      state: "idle",
      phase: "idle",
      attempt: this.#attempt,
      generation,
      updatedAt: now,
      elapsedMs: 0,
    };
    return this.#snapshot();
  }

  async recordForwardingFailure(error: DevBoxError): Promise<DevBoxStatus> {
    this.#generation += 1;
    const now = new Date().toISOString();
    this.#startup = {
      state: "failed",
      phase: "forwarding_failed",
      attempt: this.#attempt,
      generation: this.#generation,
      updatedAt: now,
      elapsedMs: 0,
      ...(this.#startup.startedAt
        ? { startedAt: this.#startup.startedAt }
        : {}),
      ...(this.#startup.processId
        ? { processId: this.#startup.processId }
        : {}),
      ...(this.#startup.processStartedAt
        ? { processStartedAt: this.#startup.processStartedAt }
        : {}),
      error,
    };
    startupLog("error", "forwarding.failed", {
      generation: this.#generation,
      error,
    });
    return this.#snapshot();
  }

  override async onStop(): Promise<void> {
    this.#generation += 1;
    this.#startup = {
      state: "idle",
      phase: "container_stopped",
      attempt: this.#attempt,
      generation: this.#generation,
      updatedAt: new Date().toISOString(),
      elapsedMs: 0,
    };
    await super.onStop();
  }

  override onError(error: unknown): void {
    this.#generation += 1;
    if (isSuccessfulContainerRollout(error)) {
      this.#startup = {
        state: "idle",
        phase: "container_rollout",
        attempt: this.#attempt,
        generation: this.#generation,
        updatedAt: new Date().toISOString(),
        elapsedMs: 0,
      };
      startupLog("info", "container.rollout", {
        generation: this.#generation,
      });
      super.onError(error);
      return;
    }

    const details = errorDetails(error);
    this.#startup = {
      state: "failed",
      phase: "container_error",
      attempt: this.#attempt,
      generation: this.#generation,
      updatedAt: new Date().toISOString(),
      elapsedMs: 0,
      ...(this.#startup.startedAt
        ? { startedAt: this.#startup.startedAt }
        : {}),
      ...(this.#startup.processId
        ? { processId: this.#startup.processId }
        : {}),
      error: details,
    };
    startupLog("error", "container.error", {
      generation: this.#generation,
      error: details,
      stack: errorStack(error),
    });
    super.onError(error);
  }

  #snapshot(): DevBoxStatus {
    return {
      ...this.#startup,
      elapsedMs: elapsedMs(this.#startup.startedAt),
    };
  }
}

function disabledResponse(): Response {
  return Response.json(
    {
      enabled: false,
      message:
        "Livecode is staged but disabled until Cloudflare Access is configured.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

type LivecodeSandbox = ReturnType<typeof getSandbox<Sandbox>>;

async function mountStateBucket(sandbox: LivecodeSandbox): Promise<void> {
  // ContainerProxy turns this binding name into credential-free R2 access.
  try {
    await sandbox.mountBucket("LIVECODE_STATE", "/data", {
      s3fsOptions: ["nonempty"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const alreadyMounted = message.includes(
      'Mount path "/data" is already in use by bucket "LIVECODE_STATE"',
    );
    if (!alreadyMounted) throw error;
  }
}

async function readBootStatus(
  sandbox: LivecodeSandbox,
): Promise<BootStatusFile | null> {
  const result = await sandbox.readFile(BOOT_STATUS_FILE).catch(() => null);
  if (!result?.success || typeof result.content !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(result.content);
    if (
      typeof parsed === "object" && parsed !== null &&
      "phase" in parsed && typeof parsed.phase === "string"
    ) {
      const candidate = parsed as {
        phase: string;
        updatedAt?: unknown;
        detail?: unknown;
      };
      return {
        phase: candidate.phase,
        ...(typeof candidate.updatedAt === "string"
          ? { updatedAt: candidate.updatedAt }
          : {}),
        ...(typeof candidate.detail === "string"
          ? { detail: candidate.detail }
          : {}),
      };
    }
  } catch {
    // A status read can race the boot script's atomic replacement.
  }
  return null;
}

async function bootOutput(
  process: SandboxProcess | null,
): Promise<Record<string, unknown>> {
  if (!process) return {};
  try {
    const output = await process.output({
      encoding: "utf8",
      timeout: 2_000,
      maxBytes: MAX_BOOT_LOG_BYTES,
    });
    return {
      stdoutTail: output.stdout.slice(-MAX_BOOT_LOG_BYTES),
      stderrTail: output.stderr.slice(-MAX_BOOT_LOG_BYTES),
      logsTruncated: output.truncated,
    };
  } catch (error) {
    return { logReadError: errorDetails(error) };
  }
}

async function recordBootProcessFailure(
  sandbox: LivecodeSandbox,
  status: ProcessStatus,
  generation: number,
): Promise<DevBoxStatus> {
  const process = await sandbox.getProcess(status.id).catch(() => null);
  const output = await bootOutput(process);
  const error = status.state === "exited"
    ? {
      name: "BootProcessExitedError",
      message: `Boot supervisor exited with code ${status.exit.code}${
        status.exit.signal === undefined ? "" : ` (signal ${status.exit.signal})`
      }`,
      code: String(status.exit.code),
    }
    : status.state === "error"
    ? {
      name: "BootProcessError",
      message: status.error.message,
      code: status.error.code,
    }
    : {
      name: "BootProcessError",
      message: "Boot supervisor stopped before Vite became ready",
    };

  startupLog("error", "boot.failed", {
    generation,
    processId: status.id,
    processState: status.state,
    error,
    ...output,
  });
  return sandbox.markDevBoxFailed(
    generation,
    error,
    "boot_process_failed",
    status.id,
  );
}

async function probeBootProcess(
  sandbox: LivecodeSandbox,
  processStatus: ProcessStatus,
  generation: number,
): Promise<DevBoxStatus> {
  if (processStatus.state !== "running") {
    return recordBootProcessFailure(sandbox, processStatus, generation);
  }

  const process = await sandbox.getProcess(processStatus.id).catch(() => null);
  if (!process) return sandbox.markDevBoxIdle(generation);

  try {
    await process.waitForPort(UI_PORT, {
      mode: "http",
      path: "/",
      status: { min: 200, max: 399 },
      timeout: STARTUP_PROBE_TIMEOUT_MS,
      interval: 250,
    });
    return sandbox.markDevBoxReady(
      generation,
      processStatus.id,
      processStatus.startedAt,
    );
  } catch (error) {
    let current: ProcessStatus;
    try {
      current = await process.status();
    } catch (statusError) {
      if (isMissingProcessHandle(statusError)) {
        return sandbox.markDevBoxIdle(generation);
      }
      throw statusError;
    }

    if (current.state !== "running") {
      return recordBootProcessFailure(sandbox, current, generation);
    }

    if (isReadinessTimeout(error) || isPlatformTransientError(error)) {
      const bootStatus = await readBootStatus(sandbox);
      return sandbox.markDevBoxStarting(
        generation,
        "waiting_for_vite",
        current.id,
        current.startedAt,
        bootStatus?.phase,
      );
    }
    throw error;
  }
}

async function inspectBootProcess(
  sandbox: LivecodeSandbox,
  status: DevBoxStatus,
): Promise<DevBoxStatus> {
  const processes = await sandbox.listProcesses();
  const tracked = status.processId
    ? processes.find((process) => process.id === status.processId)
    : undefined;
  if (tracked) {
    return probeBootProcess(sandbox, tracked, status.generation);
  }

  startupLog("warn", "boot.process.missing", {
    generation: status.generation,
    processId: status.processId,
  });
  return sandbox.markDevBoxIdle(status.generation);
}

async function ensureDevBoxStarted(
  sandbox: LivecodeSandbox,
  retryFailed = false,
): Promise<DevBoxStatus> {
  const claim = await sandbox.claimDevBoxStart(retryFailed);
  if (!claim.owner) {
    if (claim.status.state === "starting" && claim.status.processId) {
      return inspectBootProcess(sandbox, claim.status);
    }
    return claim.status;
  }

  const generation = claim.status.generation;
  try {
    await mountStateBucket(sandbox);
    await sandbox.markDevBoxStarting(generation, "discovering_process");

    const processes = await sandbox.listProcesses();
    const running = latestBootProcess(
      processes.filter((process) => process.state === "running"),
    );
    if (running) {
      await sandbox.markDevBoxStarting(
        generation,
        "waiting_for_vite",
        running.id,
        running.startedAt,
      );
      return probeBootProcess(sandbox, running, generation);
    }

    const previous = latestBootProcess(processes);
    if (previous) {
      startupLog("info", "boot.history.ignored", {
        generation,
        processId: previous.id,
        processState: previous.state,
        processStartedAt: previous.startedAt,
      });
    }

    await sandbox.markDevBoxStarting(generation, "launching_boot");
    const process = await sandbox.exec([BOOT_COMMAND]);
    const status = await process.status();
    await sandbox.markDevBoxStarting(
      generation,
      "waiting_for_vite",
      status.id,
      status.startedAt,
    );
    return probeBootProcess(sandbox, status, generation);
  } catch (error) {
    const details = errorDetails(error);
    startupLog("error", "startup.failed", {
      generation,
      phase: (await sandbox.getDevBoxStatus().catch(() => claim.status)).phase,
      error: details,
      stack: errorStack(error),
    });
    return sandbox.markDevBoxFailed(
      generation,
      details,
      "startup_operation_failed",
    );
  }
}

async function refreshDevBoxStatus(
  sandbox: LivecodeSandbox,
): Promise<DevBoxStatus> {
  const status = await sandbox.getDevBoxStatus();
  if (
    (status.state === "starting" || status.state === "ready") &&
    status.processId
  ) {
    return inspectBootProcess(sandbox, status);
  }
  return status;
}

function optionalPositiveInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function startupResponse(request: Request, status: DevBoxStatus): Response {
  const headers = {
    "Cache-Control": "no-store",
    "Retry-After": String(STARTUP_RETRY_SECONDS),
  };
  const wantsDocument = request.headers.get("Sec-Fetch-Dest") === "document" ||
    request.headers.get("Accept")?.includes("text/html") === true;
  if (!wantsDocument) {
    return Response.json(
      {
        ok: false,
        message: status.state === "failed"
          ? "The livecode dev box failed to start."
          : "The livecode dev box is starting.",
        startup: status,
      },
      { status: 503, headers },
    );
  }

  const initialStatus = JSON.stringify(status).replaceAll("<", "\\u003c");
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Starting Livecode</title>
    <style>
      :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #111216; color: #e8e8ec; }
      main { width: min(38rem, calc(100vw - 3rem)); }
      h1 { font: 600 1.25rem/1.4 system-ui, sans-serif; }
      p { color: #b9bdc7; line-height: 1.6; }
      code { color: #8ab4f8; }
      button { border: 1px solid #596273; border-radius: .4rem; padding: .55rem .8rem; background: #242832; color: inherit; cursor: pointer; }
      button[hidden] { display: none; }
    </style>
  </head>
  <body>
    <main>
      <h1 id="heading">Starting the Livecode dev box…</h1>
      <p id="detail">Preparing the container.</p>
      <p><code id="timing"></code></p>
      <button id="retry" type="button" hidden>Retry startup</button>
    </main>
    <script>
      const heading = document.querySelector('#heading');
      const detail = document.querySelector('#detail');
      const timing = document.querySelector('#timing');
      const retry = document.querySelector('#retry');
      let status = ${initialStatus};

      function render(next) {
        status = next;
        const phase = next.bootPhase || next.phase || next.state;
        heading.textContent = next.state === 'failed'
          ? 'The Livecode dev box failed to start'
          : 'Starting the Livecode dev box…';
        detail.textContent = next.error?.message || phase.replaceAll('_', ' ');
        timing.textContent = next.elapsedMs
          ? Math.round(next.elapsedMs / 1000) + 's elapsed'
          : '';
        retry.hidden = next.state !== 'failed';
        if (next.state === 'ready') location.reload();
      }

      async function poll() {
        try {
          const response = await fetch('/__cloud/startup', { cache: 'no-store' });
          render(await response.json());
        } catch (error) {
          detail.textContent = error instanceof Error ? error.message : String(error);
        } finally {
          setTimeout(poll, ${STARTUP_RETRY_SECONDS * 1000});
        }
      }

      retry.addEventListener('click', async () => {
        retry.disabled = true;
        try {
          const response = await fetch('/__cloud/startup/retry', { method: 'POST' });
          render(await response.json());
        } finally {
          retry.disabled = false;
        }
      });

      render(status);
      setTimeout(poll, ${STARTUP_RETRY_SECONDS * 1000});
    </script>
  </body>
</html>`,
    {
      status: 503,
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
      },
    },
  );
}

async function terminalResponse(
  request: Request,
  sandbox: LivecodeSandbox,
): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  }

  const startup = await ensureDevBoxStarted(sandbox);
  if (startup.state !== "ready") return startupResponse(request, startup);

  const url = new URL(request.url);
  const requestedTerminalId = url.searchParams.get("terminalId");
  let terminal = requestedTerminalId
    ? await sandbox.getTerminal(requestedTerminalId)
    : null;
  if (terminal && (await terminal.getSnapshot()).status !== "running") {
    terminal = null;
  }
  terminal ??= await sandbox.createTerminal({
    command: ["/bin/bash", "-l"],
    cwd: WORKSPACE_ROOT,
    cols: optionalPositiveInteger(url.searchParams.get("cols")) ?? 120,
    rows: optionalPositiveInteger(url.searchParams.get("rows")) ?? 32,
    bufferSize: 2 * 1024 * 1024,
  });

  return terminal.connect(request, {
    cursor: url.searchParams.get("cursor") ?? undefined,
    cols: optionalPositiveInteger(url.searchParams.get("cols")),
    rows: optionalPositiveInteger(url.searchParams.get("rows")),
  });
}

async function statusResponse(sandbox: LivecodeSandbox): Promise<Response> {
  const startup = await refreshDevBoxStatus(sandbox);
  if (startup.state !== "ready") {
    return Response.json(
      {
        ok: false,
        workspace: WORKSPACE_ROOT,
        startup,
        claude: `dev-box-${startup.state}`,
        keepAlive: false,
        processes: [],
        terminals: 0,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const [processes, terminals, claudeStatus, keepAliveStatus] = await Promise
    .all([
      sandbox.listProcesses(),
      sandbox.listTerminals(),
      sandbox.readFile(CLAUDE_STATUS_FILE).catch(() => null),
      sandbox.readFile(KEEPALIVE_STATUS_FILE).catch(() => null),
    ]);
  return Response.json(
    {
      ok: true,
      workspace: WORKSPACE_ROOT,
      startup,
      claude: claudeStatus?.success ? claudeStatus.content.trim() : "unknown",
      keepAlive: keepAliveStatus?.success &&
        keepAliveStatus.content.trim() === "true",
      processes: processes.map((process) => ({
        id: process.id,
        state: process.state,
        command: process.command,
        startedAt: process.startedAt,
      })),
      terminals: terminals.length,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function keepAliveResponse(
  request: Request,
  sandbox: LivecodeSandbox,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const body = await request.json().catch(() => null) as {
    enabled?: unknown;
  } | null;
  if (typeof body?.enabled !== "boolean") {
    return Response.json(
      { error: "Expected JSON body: { enabled: boolean }" },
      { status: 400 },
    );
  }

  const startup = await ensureDevBoxStarted(sandbox);
  if (startup.state !== "ready") return startupResponse(request, startup);

  await sandbox.setKeepAlive(body.enabled);
  await sandbox.writeFile(
    KEEPALIVE_STATUS_FILE,
    body.enabled ? "true\n" : "false\n",
  );
  return Response.json(
    { ok: true, keepAlive: body.enabled },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function startupStatusResponse(
  request: Request,
  sandbox: LivecodeSandbox,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET" },
    });
  }
  return Response.json(await ensureDevBoxStarted(sandbox), {
    headers: { "Cache-Control": "no-store" },
  });
}

async function retryStartupResponse(
  request: Request,
  sandbox: LivecodeSandbox,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }
  return Response.json(await ensureDevBoxStarted(sandbox, true), {
    headers: { "Cache-Control": "no-store" },
  });
}

function requestFailureResponse(request: Request, error: unknown): Response {
  const details = errorDetails(error);
  const rayId = request.headers.get("cf-ray") ?? undefined;
  startupLog("error", "request.failed", {
    method: request.method,
    path: new URL(request.url).pathname,
    rayId,
    error: details,
    stack: errorStack(error),
  });
  return Response.json(
    {
      ok: false,
      message: "The livecode dev box is temporarily unavailable.",
      ...(rayId ? { rayId } : {}),
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(STARTUP_RETRY_SECONDS),
      },
    },
  );
}

async function proxyDevBoxRequest(
  request: Request,
  sandbox: LivecodeSandbox,
): Promise<Response> {
  const startup = await ensureDevBoxStarted(sandbox);
  if (startup.state !== "ready") return startupResponse(request, startup);

  try {
    const response = request.headers.get("Upgrade")?.toLowerCase() ===
        "websocket"
      ? await sandbox.wsConnect(request, UI_PORT)
      : await sandbox.containerFetch(request, UI_PORT);

    if (response.status === 503) {
      const refreshed = await refreshDevBoxStatus(sandbox);
      if (refreshed.state !== "ready") {
        return startupResponse(request, refreshed);
      }
    }
    return response;
  } catch (error) {
    const details = errorDetails(error);
    const failed = await sandbox.recordForwardingFailure(details).catch(() => ({
      state: "failed" as const,
      phase: "forwarding_failed",
      attempt: startup.attempt,
      generation: startup.generation,
      updatedAt: new Date().toISOString(),
      elapsedMs: startup.elapsedMs,
      startedAt: startup.startedAt,
      processId: startup.processId,
      processStartedAt: startup.processStartedAt,
      error: details,
    }));
    startupLog("error", "proxy.failed", {
      method: request.method,
      path: new URL(request.url).pathname,
      error: details,
      stack: errorStack(error),
    });
    return startupResponse(request, failed);
  }
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (String(env.LIVECODE_ENABLED) !== "true") return disabledResponse();

  const url = new URL(request.url);
  if (url.pathname === "/__cloud/terminal") {
    return Response.redirect(`${url.origin}/__cloud/terminal/`, 302);
  }

  const sandbox = getSandbox(env.Sandbox, SANDBOX_ID, {
    sleepAfter: "60m",
    containerTimeouts: {
      instanceGetTimeoutMS: 180_000,
      portReadyTimeoutMS: 300_000,
    },
  });

  if (url.pathname === "/__cloud/startup") {
    return startupStatusResponse(request, sandbox);
  }
  if (url.pathname === "/__cloud/startup/retry") {
    return retryStartupResponse(request, sandbox);
  }
  if (url.pathname === "/__cloud/terminal/ws") {
    return terminalResponse(request, sandbox);
  }
  if (url.pathname === "/__cloud/status") {
    return statusResponse(sandbox);
  }
  if (url.pathname === "/__cloud/keepalive") {
    return keepAliveResponse(request, sandbox);
  }
  if (url.pathname.startsWith("/__cloud/terminal/")) {
    return env.ASSETS.fetch(request);
  }

  return proxyDevBoxRequest(request, sandbox);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return requestFailureResponse(request, error);
    }
  },
} satisfies ExportedHandler<Env>;
