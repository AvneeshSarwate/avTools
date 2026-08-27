import { FitAddon } from "@xterm/addon-fit";
import { type ConnectionState, SandboxAddon } from "@cloudflare/sandbox/xterm";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "./style.css";

const terminalElement = document.querySelector<HTMLElement>("#terminal")!;
const connectionStatus = document.querySelector<HTMLElement>(
  "#connection-status",
)!;
const claudeStatus = document.querySelector<HTMLElement>("#claude-status")!;
const reconnectButton = document.querySelector<HTMLButtonElement>(
  "#reconnect",
)!;
const keepAwakeButton = document.querySelector<HTMLButtonElement>(
  "#keep-awake",
)!;

const terminal = new Terminal({
  cursorBlink: true,
  fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  fontSize: 14,
  theme: {
    background: "#111216",
    foreground: "#e8e8ec",
    cursor: "#8ab4f8",
    selectionBackground: "#35506f",
  },
});
const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);

function setConnectionState(state: ConnectionState, error?: Error): void {
  connectionStatus.dataset.state = state;
  connectionStatus.textContent = error ? `${state}: ${error.message}` : state;
  if (state === "connected") void refreshStatus();
}

const sandboxAddon = new SandboxAddon({
  getWebSocketUrl: ({ origin, terminalId, cursor }) => {
    const url = new URL("/__cloud/terminal/ws", origin);
    if (terminalId) url.searchParams.set("terminalId", terminalId);
    if (cursor) url.searchParams.set("cursor", cursor);
    return url.toString();
  },
  reconnect: true,
  onStateChange: setConnectionState,
});
terminal.loadAddon(sandboxAddon);
terminal.open(terminalElement);

const initialTerminalId = new URLSearchParams(window.location.search).get(
  "terminalId",
);
sandboxAddon.connect({
  sandboxId: "livecode",
  ...(initialTerminalId ? { terminalId: initialTerminalId } : {}),
});

function fit(): void {
  fitAddon.fit();
}
const resizeObserver = new ResizeObserver(fit);
resizeObserver.observe(terminalElement);
window.addEventListener("resize", fit);
requestAnimationFrame(() => {
  fit();
  terminal.focus();
});

reconnectButton.addEventListener("click", () => {
  sandboxAddon.disconnect();
  sandboxAddon.connect({
    sandboxId: "livecode",
    ...(sandboxAddon.terminalId ? { terminalId: sandboxAddon.terminalId } : {}),
  });
  terminal.focus();
});

let reflectedTerminalId: string | undefined;
setInterval(() => {
  if (
    !sandboxAddon.terminalId || sandboxAddon.terminalId === reflectedTerminalId
  ) {
    return;
  }
  reflectedTerminalId = sandboxAddon.terminalId;
  const url = new URL(window.location.href);
  url.searchParams.set("terminalId", reflectedTerminalId);
  history.replaceState(null, "", url);
}, 500);

interface DevBoxStatus {
  claude: string;
  keepAlive: boolean;
}

let keepAlive = false;

function reflectKeepAlive(): void {
  keepAwakeButton.dataset.enabled = String(keepAlive);
  keepAwakeButton.textContent = keepAlive ? "Allow sleep" : "Keep awake";
  keepAwakeButton.title = keepAlive
    ? "Disable the keep-awake lease; normal 60-minute idle sleep resumes"
    : "Prevent Cloudflare from sleeping the dev box during unattended agent work";
}

async function refreshStatus(): Promise<void> {
  try {
    const response = await fetch("/__cloud/status", { cache: "no-store" });
    const status = await response.json() as DevBoxStatus;
    keepAlive = status.keepAlive;
    reflectKeepAlive();
    claudeStatus.textContent = status.claude === "needs-auth"
      ? "Claude needs auth — run: claude auth login"
      : `Claude Remote Control: ${status.claude}`;
    claudeStatus.dataset.state = status.claude;
  } catch (error) {
    claudeStatus.textContent = error instanceof Error
      ? `status unavailable: ${error.message}`
      : "status unavailable";
  }
}
setInterval(() => void refreshStatus(), 10_000);

keepAwakeButton.addEventListener("click", async () => {
  keepAwakeButton.disabled = true;
  try {
    const response = await fetch("/__cloud/keepalive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !keepAlive }),
    });
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json() as { keepAlive: boolean };
    keepAlive = result.keepAlive;
    reflectKeepAlive();
  } catch (error) {
    claudeStatus.textContent = error instanceof Error
      ? `keep-awake failed: ${error.message}`
      : "keep-awake failed";
  } finally {
    keepAwakeButton.disabled = false;
  }
});
