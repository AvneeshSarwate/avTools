import {
  ContainerProxy,
  getSandbox,
  Sandbox as SandboxBase,
} from "@cloudflare/sandbox";

export { ContainerProxy };

const SANDBOX_ID = "livecode";
const UI_PORT = 5173;
const BOOT_COMMAND = "/opt/livecode/boot.sh";
const WORKSPACE_ROOT = "/workspace/avTools";
const CLAUDE_STATUS_FILE = "/workspace/.livecode-runtime/claude-status";
const KEEPALIVE_STATUS_FILE = "/data/livecode/keepalive-status";

export class Sandbox extends SandboxBase<Env> {
  defaultPort = UI_PORT;
  sleepAfter = "60m";
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

async function ensureDevBox(sandbox: LivecodeSandbox): Promise<void> {
  // ContainerProxy turns this binding name into credential-free R2 access.
  try {
    await sandbox.mountBucket("LIVECODE_STATE", "/data", {
      s3fsOptions: ["nonempty"],
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isExistingLivecodeMount = errorMessage.includes(
      'Mount path "/data" is already in use by bucket "LIVECODE_STATE"',
    );
    if (!isExistingLivecodeMount) throw error;
  }

  const processes = await sandbox.listProcesses();
  const running = processes.some(
    (process) =>
      process.state === "running" && process.command.includes(BOOT_COMMAND),
  );
  if (running) return;

  const devBox = await sandbox.exec([BOOT_COMMAND]);
  await devBox.waitForPort(UI_PORT, { timeout: 300_000 });
}

function optionalPositiveInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function terminalResponse(
  request: Request,
  sandbox: LivecodeSandbox,
): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  }

  await ensureDevBox(sandbox);
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
  await ensureDevBox(sandbox);
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

  await ensureDevBox(sandbox);
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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

    await ensureDevBox(sandbox);

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return sandbox.wsConnect(request, UI_PORT);
    }
    return sandbox.containerFetch(request, UI_PORT);
  },
} satisfies ExportedHandler<Env>;
