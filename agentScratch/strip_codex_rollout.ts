#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * Strip a Codex rollout JSONL down to three versions:
 *   --full    → all substantive content with command outputs (~4.5 MB)
 *   --compact → full messages, full patches, full commands, no outputs (~1 MB)
 *   --short   → truncated messages, collapsed patches/commands (~150 KB)
 *
 * Usage:
 *   deno run --allow-read --allow-write strip_codex_rollout.ts <input.jsonl> [--full out.md] [--compact out.md] [--short out.md]
 *
 * If no flags given, produces all three in the same directory as this script.
 */

const INPUT = Deno.args[0];
if (!INPUT) {
  console.error("Usage: strip_codex_rollout.ts <input.jsonl> [--full out.md] [--compact out.md] [--short out.md]");
  Deno.exit(1);
}

// Parse CLI args
let fullOut: string | null = null;
let compactOut: string | null = null;
let shortOut: string | null = null;
for (let i = 1; i < Deno.args.length; i++) {
  if (Deno.args[i] === "--full" && Deno.args[i + 1]) fullOut = Deno.args[++i];
  if (Deno.args[i] === "--compact" && Deno.args[i + 1]) compactOut = Deno.args[++i];
  if (Deno.args[i] === "--short" && Deno.args[i + 1]) shortOut = Deno.args[++i];
}

const scriptDir = new URL(".", import.meta.url).pathname;
if (!fullOut && !compactOut && !shortOut) {
  fullOut = scriptDir + "codex_session_full.md";
  compactOut = scriptDir + "codex_session_compact.md";
  shortOut = scriptDir + "codex_session_short.md";
}

// ── Types ──

interface RolloutLine {
  timestamp: string;
  type: string;
  // deno-lint-ignore no-explicit-any
  payload: any;
}

interface Turn {
  turnNumber: number;
  timestamp: string;
  userText: string;
  userImageCount: number;
  agentMessages: string[];
  agentReasoningSummaries: string[];
  toolCalls: ToolCall[];
}

interface ToolCall {
  name: string;
  callId: string;
  // For exec_command
  command?: string;
  // For apply_patch (custom_tool_call)
  patch?: string;
  // For other function_calls
  arguments?: string;
  // Output
  output?: string;
  outputTruncated?: boolean;
}

// ── Helpers ──

function stripBase64FromContent(content: unknown[]): unknown[] {
  if (!Array.isArray(content)) return content;
  return content
    .filter((c: Record<string, unknown>) => c.type !== "input_image")
    .map((c: Record<string, unknown>) => {
      if (typeof c.text === "string" && c.text.includes("data:image")) {
        return { ...c, text: "[image data removed]" };
      }
      return c;
    });
}

function extractUserText(content: unknown[]): { text: string; imageCount: number } {
  let text = "";
  let imageCount = 0;
  if (!Array.isArray(content)) return { text: String(content), imageCount: 0 };
  for (const c of content as Record<string, unknown>[]) {
    if (c.type === "input_text") text += (text ? "\n" : "") + c.text;
    if (c.type === "input_image") imageCount++;
  }
  return { text, imageCount };
}

function extractAssistantText(content: unknown[]): string {
  if (!Array.isArray(content)) return String(content);
  return (content as Record<string, unknown>[])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text)
    .join("\n");
}

function truncateOutput(s: string, maxLen: number): { text: string; truncated: boolean } {
  if (s.length <= maxLen) return { text: s, truncated: false };
  return { text: s.slice(0, maxLen) + "\n... [truncated]", truncated: true };
}

// ── Parse ──

console.log(`Reading ${INPUT}...`);
const file = await Deno.open(INPUT, { read: true });
const decoder = new TextDecoder();
const reader = file.readable.getReader();

let buffer = "";
const lines: RolloutLine[] = [];
let bytesRead = 0;

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  bytesRead += value.byteLength;
  buffer += decoder.decode(value, { stream: true });
  const parts = buffer.split("\n");
  buffer = parts.pop()!;
  for (const part of parts) {
    if (part.trim()) {
      try {
        lines.push(JSON.parse(part));
      } catch {
        // skip malformed lines
      }
    }
  }
  if (bytesRead % (50 * 1024 * 1024) < 65536) {
    console.log(`  ...read ${(bytesRead / 1024 / 1024).toFixed(0)} MB, ${lines.length} lines`);
  }
}
if (buffer.trim()) {
  try { lines.push(JSON.parse(buffer)); } catch { /* skip */ }
}
console.log(`Parsed ${lines.length} lines (${(bytesRead / 1024 / 1024).toFixed(1)} MB)`);

// ── Organize into turns ──

const turns: Turn[] = [];
let current: Turn | null = null;
let turnCounter = 0;

// Map call_id → ToolCall for pairing outputs
const callMap = new Map<string, ToolCall>();

for (const line of lines) {
  const { type, payload, timestamp } = line;

  // Skip operational cruft
  if (type === "session_meta" || type === "turn_context" || type === "compacted") continue;

  if (type === "event_msg") {
    const et = payload?.type;

    if (et === "user_message") {
      // Start a new turn
      if (current) turns.push(current);
      turnCounter++;
      const msgText = payload.message || "";
      // Count images from the images/local_images arrays
      const imgCount = (payload.images?.length || 0) + (payload.local_images?.length || 0);
      current = {
        turnNumber: turnCounter,
        timestamp,
        userText: msgText,
        userImageCount: imgCount,
        agentMessages: [],
        agentReasoningSummaries: [],
        toolCalls: [],
      };
    } else if (et === "agent_message" && current) {
      current.agentMessages.push(payload.message || "");
    } else if (et === "agent_reasoning" && current) {
      const summary = payload.text || "";
      if (summary) current.agentReasoningSummaries.push(summary);
    }
    // Skip token_count, task_started, task_complete, turn_aborted, context_compacted
    continue;
  }

  if (type === "response_item") {
    const pt = payload?.type;

    // Skip reasoning entirely
    if (pt === "reasoning") continue;

    // Messages: we already capture via event_msg.agent_message/user_message
    // but let's capture developer messages which only appear here
    if (pt === "message" && payload.role === "developer" && current) {
      // developer/system messages are context injections, skip for now
      continue;
    }
    if (pt === "message" && payload.role === "user") {
      // Already captured via event_msg.user_message
      // But count images if we missed them
      if (current && current.userImageCount === 0) {
        const { imageCount } = extractUserText(payload.content || []);
        current.userImageCount = imageCount;
      }
      continue;
    }
    if (pt === "message" && payload.role === "assistant") {
      // Already captured via event_msg.agent_message
      continue;
    }

    // Function calls
    if (pt === "function_call" && current) {
      const name = payload.name || "unknown";
      const callId = payload.call_id || "";
      let args: string;
      try {
        args = payload.arguments || "";
      } catch {
        args = String(payload.arguments);
      }

      const tc: ToolCall = { name, callId };

      if (name === "exec_command") {
        try {
          const parsed = JSON.parse(args);
          tc.command = parsed.cmd || parsed.command || args;
        } catch {
          tc.command = args;
        }
      } else {
        tc.arguments = args;
      }

      current.toolCalls.push(tc);
      callMap.set(callId, tc);
    }

    // Custom tool calls (apply_patch goes through here)
    if (pt === "custom_tool_call" && current) {
      const name = payload.name || "unknown";
      const callId = payload.call_id || "";
      const tc: ToolCall = { name, callId };

      if (name === "apply_patch") {
        tc.patch = payload.input || "";
      } else {
        tc.arguments = typeof payload.input === "string" ? payload.input : JSON.stringify(payload.input);
      }

      current.toolCalls.push(tc);
      callMap.set(callId, tc);
    }

    // Function call outputs
    if (pt === "function_call_output") {
      const callId = payload.call_id || "";
      const tc = callMap.get(callId);
      if (tc) {
        const raw = typeof payload.output === "string"
          ? payload.output
          : JSON.stringify(payload.output);
        // Strip any base64 data from outputs
        const cleaned = raw.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, "[base64 image removed]");
        tc.output = cleaned;
      }
    }

    // Custom tool call outputs
    if (pt === "custom_tool_call_output") {
      const callId = payload.call_id || "";
      const tc = callMap.get(callId);
      if (tc) {
        tc.output = typeof payload.output === "string" ? payload.output : JSON.stringify(payload.output);
      }
    }
  }
}
if (current) turns.push(current);

console.log(`Organized into ${turns.length} turns`);

// ── Render Full Version ──

function renderFull(turns: Turn[]): string {
  const out: string[] = [];
  out.push("# Codex Session Log (Full)\n");
  out.push(`> ${turns.length} turns, generated from rollout JSONL\n`);
  out.push("---\n");

  for (const turn of turns) {
    out.push(`## Turn ${turn.turnNumber} — ${turn.timestamp}\n`);

    // User message
    out.push("### User\n");
    if (turn.userText) {
      out.push(turn.userText + "\n");
    }
    if (turn.userImageCount > 0) {
      out.push(`\n*[${turn.userImageCount} screenshot(s) attached]*\n`);
    }

    // Tool calls
    if (turn.toolCalls.length > 0) {
      out.push("\n### Tool Calls\n");
      for (const tc of turn.toolCalls) {
        if (tc.name === "exec_command") {
          out.push(`**exec_command:**\n\`\`\`bash\n${tc.command}\n\`\`\`\n`);
          if (tc.output) {
            const { text, truncated } = truncateOutput(tc.output, 4000);
            out.push(`<details><summary>Output${truncated ? " (truncated)" : ""}</summary>\n\n\`\`\`\n${text}\n\`\`\`\n</details>\n\n`);
          }
        } else if (tc.name === "apply_patch") {
          out.push(`**apply_patch:**\n\`\`\`diff\n${tc.patch}\n\`\`\`\n`);
          if (tc.output) {
            out.push(`> ${tc.output}\n\n`);
          }
        } else if (tc.name === "view_image") {
          out.push(`**view_image:** *(image viewing call)*\n`);
        } else if (tc.name === "write_stdin") {
          out.push(`**write_stdin:** \`${tc.arguments || ""}\`\n`);
        } else {
          out.push(`**${tc.name}:**\n`);
          if (tc.arguments) {
            const { text } = truncateOutput(tc.arguments, 2000);
            out.push(`\`\`\`\n${text}\n\`\`\`\n`);
          }
          if (tc.output) {
            const { text, truncated } = truncateOutput(tc.output, 4000);
            out.push(`<details><summary>Output${truncated ? " (truncated)" : ""}</summary>\n\n\`\`\`\n${text}\n\`\`\`\n</details>\n\n`);
          }
        }
      }
    }

    // Agent response
    if (turn.agentMessages.length > 0) {
      out.push("\n### Agent\n");
      for (const msg of turn.agentMessages) {
        out.push(msg + "\n");
      }
    }

    out.push("\n---\n\n");
  }

  return out.join("\n");
}

// ── Render Compact Version ──

// Read-only / exploratory commands to collapse in compact mode
const READ_ONLY_PREFIXES = [
  "cat ", "sed ", "head ", "tail ", "rg ", "grep ", "find ", "ls ", "pwd",
  "wc ", "file ", "stat ", "du ", "df ", "echo ", "nl ", "git show", "git log",
  "git diff", "git status", "git branch", "tree ",
];

function isReadOnlyCommand(cmd: string): boolean {
  const trimmed = cmd.trim();
  // Multi-command: if ALL parts are read-only, it's read-only
  // Split on && and || and ; but not inside quotes (rough heuristic)
  const parts = trimmed.split(/\s*(?:&&|\|\||;)\s*/);
  return parts.every((part) => {
    const p = part.trim();
    return READ_ONLY_PREFIXES.some((prefix) => p.startsWith(prefix)) || p === "pwd";
  });
}

// Extract filenames from a patch string (*** Update File: <path> lines)
function patchFilesSummary(patch: string): string {
  const files = [...patch.matchAll(/\*\*\* (?:Update|Add|Delete) File:\s*(\S+)/g)].map((m) => m[1]);
  if (files.length === 0) {
    // Fallback: try to extract any path-like string
    const fallback = patch.match(/[\w/.]+\.\w+/);
    return fallback ? fallback[0] : "(unknown file)";
  }
  return files.join(", ");
}

// Summarize a long command to just its essential parts
function summarizeCommand(cmd: string, maxLen: number): string {
  if (cmd.length <= maxLen) return cmd;
  // For deno eval with inline code, just show the invocation prefix
  const denoEval = cmd.match(/^(.*?deno\s+eval\b[^'"]*)/);
  if (denoEval) return denoEval[1] + " '...'";
  // For other long commands, truncate
  return cmd.slice(0, maxLen) + "...";
}

// ── Render Compact Version (full messages, full patches, full commands, no outputs) ──

function renderCompact(turns: Turn[]): string {
  const out: string[] = [];
  out.push("# Codex Session Log (Compact)\n");
  out.push(`> ${turns.length} turns — full conversation, edits, and commands (no command outputs)\n`);
  out.push("---\n");

  for (const turn of turns) {
    out.push(`## Turn ${turn.turnNumber} — ${turn.timestamp}\n`);

    // User message — full, with IDE boilerplate stripped
    if (turn.userText) {
      out.push("### User\n");
      let userDisplay = turn.userText;
      const requestMatch = userDisplay.match(/## My request for Codex:\s*([\s\S]*?)$/);
      if (requestMatch) {
        userDisplay = requestMatch[1].trim();
      }
      out.push(userDisplay + "\n");
    }
    if (turn.userImageCount > 0) {
      out.push(`\n*[${turn.userImageCount} screenshot(s) attached]*\n`);
    }

    // All tool calls — full commands and patches, no outputs
    const hasToolCalls = turn.toolCalls.length > 0;
    if (hasToolCalls) {
      out.push("\n### Tool Calls\n");
      for (const tc of turn.toolCalls) {
        if (tc.name === "exec_command") {
          out.push(`**exec_command:**\n\`\`\`bash\n${tc.command}\n\`\`\`\n`);
        } else if (tc.name === "apply_patch") {
          out.push(`**apply_patch:**\n\`\`\`diff\n${tc.patch}\n\`\`\`\n`);
        } else if (tc.name === "view_image") {
          // skip, no useful info without the image
        } else if (tc.name === "write_stdin") {
          out.push(`**write_stdin:** \`${tc.arguments || ""}\`\n`);
        } else {
          out.push(`**${tc.name}:**\n`);
          if (tc.arguments) {
            out.push(`\`\`\`\n${tc.arguments}\n\`\`\`\n`);
          }
        }
      }
    }

    // Agent response — full
    if (turn.agentMessages.length > 0) {
      out.push("\n### Agent\n");
      for (const msg of turn.agentMessages) {
        out.push(msg + "\n");
      }
    }

    out.push("\n---\n\n");
  }

  return out.join("\n");
}

// ── Render Short Version (truncated, collapsed) ──

function renderShort(turns: Turn[]): string {
  const out: string[] = [];
  out.push("# Codex Session Log (Short)\n");
  out.push(`> ${turns.length} turns — conversation, edits, and mutating commands only\n`);
  out.push(`> Read-only commands collapsed. Patches show file list only. Long commands truncated.\n`);
  out.push("---\n");

  for (const turn of turns) {
    const patches = turn.toolCalls.filter((tc) => tc.name === "apply_patch");
    const allCommands = turn.toolCalls.filter((tc) => tc.name === "exec_command");
    const mutatingCommands = allCommands.filter((tc) => !isReadOnlyCommand(tc.command || ""));
    const readOnlyCount = allCommands.length - mutatingCommands.length;

    const hasContent = turn.userText || turn.agentMessages.length > 0 ||
      patches.length > 0 || mutatingCommands.length > 0;
    if (!hasContent) continue;

    out.push(`## Turn ${turn.turnNumber}\n`);

    if (turn.userText) {
      let userDisplay = turn.userText;
      const requestMatch = userDisplay.match(/## My request for Codex:\s*([\s\S]*?)$/);
      if (requestMatch) {
        userDisplay = requestMatch[1].trim();
      }
      const { text } = truncateOutput(userDisplay, 400);
      out.push(`**User:** ${text}\n`);
    }
    if (turn.userImageCount > 0) {
      out.push(`*[${turn.userImageCount} screenshot(s)]*\n`);
    }

    if (readOnlyCount > 0) {
      out.push(`*[${readOnlyCount} read-only cmd(s)]*\n`);
    }

    if (mutatingCommands.length > 0) {
      out.push("\n**Commands:**\n");
      for (const tc of mutatingCommands) {
        out.push(`- \`${summarizeCommand(tc.command || "", 150)}\`\n`);
      }
    }

    if (patches.length > 0) {
      out.push(`\n**Edited:** ${patches.map((tc) => patchFilesSummary(tc.patch || "")).join("; ")}\n`);
    }

    if (turn.agentMessages.length > 0) {
      out.push("\n**Agent:** ");
      const combined = turn.agentMessages.join("\n\n");
      const { text } = truncateOutput(combined, 600);
      out.push(text + "\n");
    }

    out.push("\n---\n\n");
  }

  return out.join("\n");
}

// ── Write outputs ──

if (fullOut) {
  console.log(`Writing full version to ${fullOut}...`);
  const content = renderFull(turns);
  await Deno.writeTextFile(fullOut, content);
  const size = new TextEncoder().encode(content).byteLength;
  console.log(`  Full: ${(size / 1024 / 1024).toFixed(2)} MB`);
}

if (compactOut) {
  console.log(`Writing compact version to ${compactOut}...`);
  const content = renderCompact(turns);
  await Deno.writeTextFile(compactOut, content);
  const size = new TextEncoder().encode(content).byteLength;
  console.log(`  Compact: ${(size / 1024).toFixed(1)} KB`);
}

if (shortOut) {
  console.log(`Writing short version to ${shortOut}...`);
  const content = renderShort(turns);
  await Deno.writeTextFile(shortOut, content);
  const size = new TextEncoder().encode(content).byteLength;
  console.log(`  Short: ${(size / 1024).toFixed(1)} KB`);
}

console.log("Done.");
