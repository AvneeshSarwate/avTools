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

### Browser code editor

Open `/__cloud/editor/` (or **Code editor** in the terminal/projects header).
code-server opens the actual `/workspace/avTools` worktree, with file search,
Git diffs, integrated terminals, and extensions from Open VSX. Saving a source
file participates in the existing workspace checkpointing and Vite hot reload.

The Docker image installs code-server 4.135.0 from checksum-verified release
packages, plus `openssh-client` for Git over SSH and `ssh-keygen`. Nothing is
downloaded to install the editor during container startup. Only visiting the
editor entry page starts its supervisor; the livecoding app does not wait for
it. The editor remains running after closing the tab until it exits or the
container stops. An open editor connection can affect idle/sleep behavior.

The Worker strips `/__cloud/editor` and forwards HTTP and WebSockets to port
8080. **Cloudflare Access must cover the entire hostname**, including editor
assets and WebSockets. The editor uses `--auth none` behind that boundary;
never expose its port or an unprotected alternate hostname. Cross-origin
requests are rejected, code-server origin checks remain enabled, and its
additional port proxy is disabled. This is a single-user root shell, not a
read-only file viewer or a multi-tenant IDE.

Editor settings, extension installations, and user state live on local disk at
`/workspace/.livecode-runtime/editor-state`, separately from the Git worktree.
They are packed into `livecode/editor/checkpoints/` in R2 every 30 seconds after
the previous save, and on graceful editor shutdown. Logs and selected disposable
caches are excluded; extension `node_modules` and `dist` files are retained.
Like source checkpoints, these archives are file-level crash recovery, not
transactional backups of running extension databases. Settings may contain
extension credentials: treat these R2 objects as sensitive. Do not rely on
unsaved buffers or running terminals surviving container replacement.

Restoration occurs on the first editor launch of each container, with checksum
validation and previous-generation fallback; corrupt state fails closed rather
than overwriting it. Restarting just the editor retains local, not-yet-synced
changes. Concurrent launch requests use a container-local singleton lock.
Editor output is available in `/workspace/.livecode-runtime/editor.log`.

Validation: `npm run test:editor`, `npm run test:checkpoint`,
`npm run test:credentials`, `npm run type-check`, and `npm run build`.
Deploying the editor requires both the new image and Worker. The terminal link
ships with Worker assets; the projects-page link requires pulling/merging the
updated source into an existing persisted workspace.

Deployed 2026-09-06 as container application version 14 and Worker version
`a3a04d2a-286e-4e3b-a387-a13e228d9c28`. Verified the running release serves the
editor HTML and health endpoint, upgrades editor WebSockets (101), and preserves
the existing SSH key exactly against R2. Public unauthenticated editor requests
still redirect to Access. First observed editor launch on the warm devbox took
3.48 seconds; this is not a container cold-start measurement. The projects-page
link was applied to the persisted workspace and checkpointed before rollout.

### Workspace

Vite and Deno run from the container's local disk so file watching behaves like
a normal development machine. The workspace is checkpointed to R2 every 30 seconds
after the preceding checkpoint completes, and again on SIGTERM. Dependency trees, generated builds, logs, and `.env`
files are deliberately excluded; checked-in source, `.git`, new projects, and
commits are preserved.

On later image deployments, the persisted Git workspace is authoritative. Pull
or merge new commits from the browser terminal instead of expecting a new image
to overwrite remote edits. Git pushes remain the durable, reviewable history;
the R2 mirror is crash/restart continuity.

## Startup and checkpoint implementation

The image builds the full worktree and dependencies directly into
`/workspace/avTools`. `/opt/avtools-seed` contains only lockfiles and guarded
migration reference files; waking no longer copies dependency trees. Deno and
Vite launch concurrently, and readiness requires the supervisor's `ready`
status plus an HTTP probe of `/projects.html`. This means servers are ready,
not that a browser has finished loading the editor or engine.

Disposable Deno sessions now live under `/workspace/.livecode-runtime/sessions`.
Those generated files and session logs do not survive sleep. Project source,
Git metadata, and agent credentials retain their existing persistence boundary.

Credential restoration starts concurrently with workspace restoration. The
supervisor joins that task before starting credential watchers or agents and
before declaring readiness (which gates terminals). Restore failures fail boot;
partially restored credentials are never synced back. `credentials.restored`
reports total restore time; `waiting_for_credentials` reports only the remaining
critical-path wait after workspace recovery.

The Docker image also bakes a browser-engine asset cache. The asset builder
checks the optional R2 cache (`livecode/browser-host-cache`), then the baked
cache, before compiling. It validates hashes of the resolved local dependency
graph, root config/lockfile, build implementation, and copied Six Sines runtime
files, plus the Deno version. Unrelated project edits do not invalidate it.
Cache archives are checksum-verified on local disk before extraction. Changed,
missing, or corrupt inputs/artifacts cause a normal rebuild; successful stable
builds publish a new immutable archive followed by a manifest for future wakes.
Publication failures do not fail a successful build. The cache is disposable,
separate from workspace/credential backups, and contains no entry stubs.

Caching is opt-in via `LIVECODE_BROWSER_HOST_BAKED_CACHE` and
`LIVECODE_BROWSER_HOST_CACHE`, set by the container supervisor. Existing remote
worktrees must merge the changes to `browser_host/build_host_assets.ts` and add
`browser_host/asset_cache.ts`; an image rollout does not overwrite remotely
edited source. A differing remote source tree can miss the baked cache once,
then reuse its own R2 artifact. Framework changes are checked when the server
next builds/prewarms the engine; this does not add live engine-bundle HMR.
External local dependencies disable publication rather than producing a
non-portable cache. Remote package resolution is retained in the cached artifact
until a source/config/lockfile or Deno-version change triggers a rebuild.

`container/checkpoint.mjs` stages source on local disk and uploads a compressed
archive as one immutable R2 object. It verifies SHA-256 before extraction on
restore and then reconciles source locally, including deletions, while retaining
baked dependencies. Exclusions for both legacy and packed restores live in
`container/repo-excludes.txt`.

`livecode/checkpoints/current.json` is published only after the archive upload
closes; `previous.json` retains the previous successful generation. Corruption
falls back to the previous generation with a log message. If both are invalid,
boot fails rather than using an obsolete legacy mirror. Normal publication keeps
two archives; interrupted uploads can leave unreferenced objects for later cleanup.
Do not apply a blanket expiration rule to referenced checkpoints.

On the first wake after this update, absent checkpoint manifests trigger the
existing complete/incomplete legacy mirror recovery. That mirror is left intact,
but stops receiving updates after migration. Rolling back to an older image's
boot script would therefore restore stale state; export the latest checkpoint
to the legacy layout before such a rollback.

Unchanged workspaces skip compression and upload after a local checksum scan.
Each changed checkpoint uploads the complete source archive, trading more bulk
transfer for fewer object operations and faster restores. Benchmark checkpoint
CPU time and bytes alongside startup before deciding whether incremental archives
are needed. As with the prior rsync mirror, edits during capture are not an
application-transaction snapshot; Git operations should be idle for a deliberate
recovery checkpoint.

## Verification and startup benchmarking

Using already installed dependencies:

```sh
node --test apps/livecode-cloudflare/tests/checkpoint.test.mjs
node --test apps/livecode-cloudflare/tests/credential-startup.test.mjs
deno test -A apps/deno-notebooks/livecode/tests/asset_cache_test.ts
bash -n apps/livecode-cloudflare/container/boot.sh
apps/livecode-cloudflare/node_modules/.bin/tsc --noEmit -p apps/livecode-cloudflare/tsconfig.json
```

Docker build and Linux/container integration passed on 2026-09-05. The tested
image was deployed on 2026-09-06 UTC (Worker version
`977581fe-ccf4-403f-a9cb-4bab62a43d09`, container application version 12,
image digest `sha256:dd0dcc348193008c5a129b5d31578415cbe98e02698954249c184cd2fb8aa8ea`).
Remote checkpoint publication was verified directly against R2, followed by
checksum-verified restoration in a replacement container. Local filesystem tests
alone do not validate s3fs object publication behavior.

For a built image, the integration check creates two disposable containers and
a temporary Docker volume, verifies server/engine HTTP routes and the canvas
bundle, and restores a workspace marker on the second boot:

```sh
docker build --platform linux/amd64 -t livecode-startup-optimized:local -f apps/livecode-cloudflare/Dockerfile .
node apps/livecode-cloudflare/tests/container-smoke.mjs livecode-startup-optimized:local
```

This checks Linux behavior using local volume storage, not R2 performance. The
test removes its own containers and volume after completion. Checkpoint subprocesses
are asynchronous to avoid a synchronous child-process wait hang observed under
local x86 emulation; their failures still propagate before publication.

Local `linux/amd64` integration results (Docker Desktop on Apple Silicon):

| Measurement | Fresh workspace | Restored checkpoint |
| --- | ---: | ---: |
| Boot script to both services ready | 3.203 s | 8.444 s |
| Workspace restore phase | 0.483 s | 5.765 s |
| Docker launch through readiness polling | 28.433 s | 9.194 s |

These are single local samples, not Cloudflare timings or a before/after
speedup. HTTP health, project picker, editor HTML, engine assets, canvas bundle,
and workspace marker restoration passed; actual browser interaction remains
unverified. The source checkpoint was about 305 MiB. Measure full-checkpoint
upload overhead on R2 during active editing before choosing the final cadence.
The image's workspace occupied about 1.9 GiB, and retained seed references were
under 1 MiB. Seven checkpoint recovery tests also passed in Linux and on macOS.

### Cloudflare measurements — 2026-09-06 UTC

Measured the deployed `standard-2` container through an authenticated temporary
Wrangler preview forwarding to the live Worker. Access remained enabled. Each
optimized sample used a stopped/replaced runtime, not just a warm HTTP request;
platform image-cache state was not controlled. The live source archive was
384,337,210 bytes (about 367 MiB). No active editor modules, terminals, or agent
jobs were interrupted, and the latest checkpoint was verified before replacement.

| Measurement | Old image | Optimized 1 | Optimized 2 | Optimized 3 |
| --- | ---: | ---: | ---: | ---: |
| Client-observed server readiness | 88.658 s | 40.619 s | 34.775 s | 27.728 s |
| Worker-recorded server readiness | 88.540 s | 40.444 s | 34.686 s | 27.641 s |
| Workspace restore phase | not isolated | 29.105 s | 19.706 s | 15.978 s |
| Credential restore phase | not isolated | 3.804 s | 6.284 s | 4.209 s |
| Deno/Vite startup phase | not isolated | 3.889 s | 2.993 s | 3.112 s |

The optimized median is **34.775 s**, range **27.728–40.619 s**, about **61% less
time** than the single old-image readiness sample. This is an observed server
readiness comparison, not an isolated platform-startup benchmark or a controlled
browser-load speedup. The old image used incomplete legacy-mirror recovery and
spent roughly 56 seconds copying the seed workspace; optimized runs restored a
packed checkpoint. More runs are needed to characterize tail latency.

Both the old image and optimized sample 1 exposed a pre-existing persisted
`deno.json` mismatch: missing `canvas-drawing` and `@avtools/six-sines` aliases
caused `/engine/` to fail. The remote config was repaired without replacing its
other settings (also adding the drawing-document dependency alias) and saved in
R2 before samples 2–3. Those samples returned HTTP 200 for `/health`,
`/projects.html`, `/index.html`, and `/engine/`; the first engine request took
11.077 s and 11.224 s respectively, **after** server readiness, while building
its disposable bundle. Actual browser execution, WebSocket connection, and
interactive editor readiness have not been measured.

After sample 3, three warm HTTP requests per page all returned 200: median
149 ms for the project picker, 131 ms for editor HTML, and 136 ms for engine HTML
(overall range 129–328 ms through the diagnostic preview). The preview was shut
down after verification; the deployed container was left healthy and running.

Workspace restore remains the largest measured startup phase. Follow-up work
should target archive size/restore throughput and the cold engine bundle build.
Changed-workspace saves still upload a complete roughly 367 MiB archive inside
Cloudflare; unchanged scans skip that upload. This is not traffic downloaded to
the developer's laptop, but its CPU time and storage-operation overhead should
be considered before shortening the checkpoint interval.

Boot writes phase durations and Deno/Vite readiness milestones to stdout and
`/workspace/.livecode-runtime/boot-timings.jsonl`; ready `/__cloud/status` responses
include this JSONL as `bootTimings`. Worker logs record `startup.mount.completed`
(combined lazy container acquisition, SDK initialization, and R2 mounting) and
`startup.ready` (total server readiness). These do not isolate platform startup
from mount time; correlate SDK/platform logs for that breakdown.

When a normal connection is available, record a baseline before deploying, then
repeat several safely stopped cold starts and warm requests after deploying.
Report median/range for server readiness and separately measure browser navigation,
editor connection, and engine readiness. A previous-checkpoint fallback must be
reported separately from a normal restore. Do not restart an active agent job.

### Engine-cache and concurrent-credential follow-up — 2026-09-06 UTC

Deployed container application version 13, image
`sha256:d28abdd146df9ad9678adf0fe488a91ef087811103602cf629e93105a25eb96a`.
Current Worker version is `dfac8ffd-414d-40f7-8968-6291e1b5ab88`; the
`LIVECODE_RELEASE=engine-cache-20260906` label was added during lifecycle
recovery below, without another container rollout.

| Completed run | Server readiness (client) | Server readiness (Worker attempt) | First engine HTTP request | Remaining credential wait |
| --- | ---: | ---: | ---: | ---: |
| First replacement | 27.234 s | 27.100 s | 0.866 s | 0.059 s |
| Rapid replacement with automatic retry | 26.408 s | 18.236 s | 1.071 s | 0.059 s |
| Cold start after Worker lifecycle recovery | 24.460 s | 24.284 s | 0.720 s | 0.070 s |

All completed runs returned 200 for health, project picker, editor HTML, and
engine HTML. Credentials took 7.497–14.626 seconds in total while overlapping
workspace recovery; only 59–70 ms remained on the critical path. First engine
requests fell from 11.077–11.224 seconds in the earlier runs to 0.720–1.071
seconds. The remote cache archive was 2,571,309 bytes with 63 validated local
inputs. A separate direct R2 restore/build invocation confirmed a cache hit in
1.017 seconds. Browser interaction/WebSocket timing remains unmeasured.

**Lifecycle caveat:** rapid destroy/restart testing exposed delayed SDK
`container_stopped` notifications. Run 2 includes about 8 seconds of retry
overhead. Another trial stalled before the boot script, with the SDK reporting
no active runtime; its client was interrupted, and a subsequent wake timed out
after 60 seconds. These failed attempts are not included in the completed-run
table and must not be presented as an all-attempt latency distribution. Updating
the Worker release label recycled its in-memory SDK state and restored normal
startup without changing R2 data or the image. This is operational recovery,
not a fix to the SDK's rapid-replacement behavior. The final container was left
healthy and the diagnostic preview shut down.

Verification: four asset-cache tests pass on macOS and Linux, two credential
launch/join tests pass (including failed restoration blocking readiness), and
the seven existing checkpoint tests pass. Two disposable Docker boots verified
baked cache hits, service routes, credential readiness, and checkpoint recovery.
Their first engine requests took 0.931 s and 0.482 s; local emulation results
are not Cloudflare benchmarks. Deno checking, Worker TypeScript checking, shell
syntax checking, and `git diff --check` passed.
