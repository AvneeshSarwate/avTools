import { getSandbox } from "@cloudflare/sandbox";

async function currentCheckpoint(bucket, prefix) {
  const object = await bucket.get(`${prefix}/checkpoints/current.json`);
  if (!object) return null;
  const { archive, createdAt } = await object.json();
  return { archive, createdAt };
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!((request.method === "GET" && ["/", "/wake", "/processes"].includes(path)) ||
      (request.method === "POST" && ["/restart-boot", "/stop-boot", "/retry"].includes(path)))) {
      return new Response("Not found", { status: 404 });
    }
    if (path === "/retry") {
      const response = await env.LIVECODE.fetch(
        "https://livecode.gritty-questions.workers.dev/__cloud/startup/retry",
        { method: "POST", headers: { Accept: "application/json" } },
      );
      return new Response(response.body, {
        status: response.status,
        headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
      });
    }
    if (path === "/restart-boot" || path === "/stop-boot") {
      const sandbox = getSandbox(env.Sandbox, "livecode", { sleepAfter: "60m" });
      const status = await sandbox.getDevBoxStatus();
      if (!["ready", "starting"].includes(status.state) || !status.processId) {
        return Response.json({ error: "Boot supervisor is not running", status }, { status: 409 });
      }
      const process = await sandbox.getProcess(status.processId);
      if (!process) {
        return Response.json({ error: "Boot supervisor process not found", status }, { status: 409 });
      }
      // SIGKILL avoids a graceful shutdown checkpoint of the bad local state.
      await process.kill(9);
      await process.waitForExit({ timeout: 30_000 });
      if (path === "/stop-boot") {
        return Response.json(await sandbox.markDevBoxFailed(
          status.generation,
          { name: "MigrationPause", message: "Boot paused for local R2 credential migration" },
          "credential_migration_pause",
        ));
      }
      await sandbox.markDevBoxIdle(status.generation);
      const response = await env.LIVECODE.fetch("https://livecode.gritty-questions.workers.dev/__cloud/startup", {
        headers: { Accept: "application/json" },
      });
      return new Response(response.body, {
        status: response.status,
        headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
      });
    }
    if (path === "/wake") {
      const response = await env.LIVECODE.fetch("https://livecode.gritty-questions.workers.dev/__cloud/startup", {
        headers: { Accept: "application/json" },
      });
      return new Response(response.body, {
        status: response.status,
        headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
      });
    }
    if (path === "/processes") {
      const sandbox = getSandbox(env.Sandbox, "livecode", { sleepAfter: "60m" });
      const statuses = (await sandbox.listProcesses())
        .filter((process) => process.command.includes("/opt/livecode/boot.sh"))
        .slice(-6);
      const processes = await Promise.all(statuses.map(async (status) => {
        if (status.state === "running") return status;
        const process = await sandbox.getProcess(status.id);
        if (!process) return status;
        const stream = await process.logs({ replay: true, follow: false });
        const reader = stream.getReader();
        let output = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.type === "stdout" || value.type === "stderr") {
            output += new TextDecoder().decode(value.data);
            output = output.slice(-32_000);
          }
        }
        const errorLines = output.split("\n").filter((line) =>
          /error|fail|killed|cannot|checkpoint|R2|s3fs/i.test(line)).slice(-30);
        return { ...status, errorLines };
      }));
      return Response.json(processes);
    }
    const sandbox = getSandbox(env.Sandbox, "livecode", { sleepAfter: "60m" });
    const process = await sandbox.exec([
      "/bin/sh", "-c",
      "mountpoint -q /data; printf 'data_mount=%s\\n' \"$?\"; printf 'data_mount_count='; grep -c ' /data ' /proc/self/mountinfo; cat /workspace/.livecode-runtime/boot-status.json 2>/dev/null; printf '\\n'; grep 'credentials.restored' /workspace/.livecode-runtime/boot-timings.jsonl 2>/dev/null | tail -1; test -s /root/.claude/.credentials.json; printf 'claude_auth_file=%s\\n' \"$?\"; test -s /root/.codex/auth.json; printf 'codex_auth_file=%s\\n' \"$?\"",
    ]);
    const container = await process.output({ encoding: "utf8", maxBytes: 2048 });
    const checkpointPrefixes = [
      "livecode",
      "livecode/credential-checkpoints/claude",
      "livecode/credential-checkpoints/codex",
      "livecode/credential-checkpoints/ssh",
    ];
    const checkpoints = Object.fromEntries(await Promise.all(
      checkpointPrefixes.map(async (prefix) => [
        prefix,
        await currentCheckpoint(env.LIVECODE_STATE, prefix),
      ]),
    ));
    return Response.json({ container, checkpoints }, {
      headers: { "Cache-Control": "no-store" },
    });
  },
};
