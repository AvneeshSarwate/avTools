# Livecode Cloudflare dev box

This package implements the remote-dev design in
`docs/livecode/history/cloudflare-remote-dev-plan-2026-08.md`, with the
operator's explicit Vite/HMR correction:

- the Worker routes public HTTP and WebSockets to Vite on port 5173;
- Vite serves the source app, owns HMR, and proxies livecode API/WebSocket
  routes to the Deno coordination server on localhost:7777;
- `/` redirects to `/projects.html`; creating a project is a separate action;
- `/__cloud/terminal/` is an Access-protected xterm in the full Git worktree;
- the browser remains the remote execution engine, so the hot timing loop does
  not cross the WAN;
- R2 mirrors the Git worktree, project files, `~/.claude`, `~/.codex`, and
  `~/.ssh`.

The deployed URL is:

`https://livecode.gritty-questions.workers.dev`

## Deployment

Run commands from the repository root.

1. Create `avtools-livecode-state` once if it does not exist:
   `npm --prefix apps/livecode-cloudflare run cf -- r2 bucket create avtools-livecode-state`
2. Deploy disabled while configuring Access:
   `npm --prefix apps/livecode-cloudflare run deploy:disabled`
3. In Cloudflare Zero Trust, protect the exact hostname
   `livecode.gritty-questions.workers.dev` with the email one-time-PIN policy.
4. Confirm Access intercepts the hostname, then deploy enabled:
   `npm --prefix apps/livecode-cloudflare run deploy:enabled`

The Access application covers every path, including the terminal, status JSON,
Vite HMR, engine uplink, sync, and LSP WebSockets. Do not expose one of those
paths through a separate public hostname.

## First login

Open `/__cloud/terminal/`. The shell starts in `/workspace/avTools`.

Before leaving a long agent run unattended, click **Keep awake** in the
terminal header. Click **Allow sleep** when the run is finished; the normal
60-minute idle shutdown then resumes. This uses the Sandbox SDK's explicit
keep-alive lease, so it does not depend on browser polling or WebSocket traffic.

Claude Code and Codex are installed from their official standalone installers
on the latest release channel. Authenticate each one once:

```sh
claude auth login
codex login --device-auth
```

The boot supervisor detects the resulting credential and starts
`claude remote-control --name livecode-cloud --spawn same-dir --capacity 1`.
The terminal header reports `needs-auth` until this is complete. Credential
rotations and Codex login state are copied to R2 on file changes, with a
30-second fallback sync, and restored after container replacement.

For GitHub pushes, create a repository-scoped deploy key in the terminal:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -C livecode-cloud
cat ~/.ssh/id_ed25519.pub
```

Add that public key under the avTools GitHub repository's Settings → Deploy
keys and enable write access if this box should push. No GitHub account token is
stored in the container.

## Runtime and persistence

Vite and Deno run from the container's local disk so file watching behaves like
a normal development machine. The workspace is mirrored to R2 every 30 seconds
and again on SIGTERM. Dependency trees, generated builds, logs, and `.env`
files are deliberately excluded; checked-in source, `.git`, new projects, and
commits are preserved.

On later image deployments, the persisted Git workspace is authoritative. Pull
or merge new commits from the browser terminal instead of expecting a new image
to overwrite remote edits. Git pushes remain the durable, reviewable history;
the R2 mirror is crash/restart continuity.
