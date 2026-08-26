# Cloudflare Remote-Dev Deployment Plan (2026-08)

Status: design note, written 2026-08-19. This is the deployment/operations
half of Setup B from `browser-engine-plan-2026-08.md`: everything
application-level (remote engine mode, uplink, broadcast transports, baked
setup) is implemented and E2E-tested on that plan; THIS note designs how the
coordination server plus a Claude Code agent actually live on Cloudflare and
how the operator reaches them from any browser. Nothing in this note is
implemented yet. Product facts below (Remote Control behavior, Containers
pricing/lifecycle) were verified against vendor docs on 2026-08-19 and can
drift; links at the bottom.

## Goal: walk-up dev from any laptop

On anyone's laptop, in a fresh incognito window: minimal sign-in, the
container wakes on demand (never always-on for cost), and development starts —
either by steering a Claude Code agent, or directly in the livecode tldraw
editors. Closing the window leaves nothing on the machine; idleness puts the
container back to sleep.

The account context this is designed for: a personal Claude **Max** plan
(claude.ai account linked to a gmail identity). That rules one option out and
rules one in:

- **Self-hosted environments** (claude.ai/code sessions executing on your own
  runner via `claude self-hosted-runner`) would be the cleanest fit but is
  Team/Enterprise-only (public beta since 2026-08). Revisit if the account
  ever moves to Team.
- **Remote Control** is the chosen mechanism: available on all plans
  (research preview), and agent inference bills against the Max subscription
  — the container is the only new cost.

## Topology

One Cloudflare Worker + one container (Containers / Sandbox SDK) + R2 + one
Cloudflare Access application:

- **Worker**: routes the hostname to the container — the livecode
  coordination server (UI at `/`, engine host at `/engine/`, uplink WS,
  agent HTTP surface, LSP WS) — plus a status page and a break-glass
  browser-terminal route (Sandbox SDK PTY + xterm.js addon; zero custom
  terminal code).
- **Container**: the dev machine. Runs the livecode server (`--engine remote
  --ui-dist ...`) and a Claude Code **Remote Control server**
  (`claude remote-control`) side by side. The engine itself runs in the
  operator's local browser tab — that split is the whole point of Setup B
  (the 33 ms loop never crosses the WAN).
- **R2**: durable state — repo mirror/pushes, livecode project `data/`,
  and the live `~/.claude` credential directory.
- **Access**: one application covering the hostname, Google IdP, allowlist of
  exactly the operator's gmail. Same-origin WebSockets (sync in ws mode,
  uplink, LSP) ride the Access cookie. The agent never crosses Access — it
  talks to the livecode server over localhost inside the container.

Addendum 2026-08-26: the projects index page now shipped at
`/projects.html` in the served UI is designed as this deployment's landing
page: it adopts its own origin as the server (skipping plain-`http` probes on
an `https` page), lists projects, opens the `/engine/` tab itself, defaults
same-origin engine-in-browser opens to `sync=broadcast` (keeping the sync
loop off the WAN, per this plan), and pauses its `/health` polling while the
tab is hidden so a forgotten tab does not defeat `sleepAfter`. Its
`POST /server/engine-mode` restart flow works here too — main.ts restarts
in-process, so the entrypoint contract below is unaffected — but flipping to
local mode runs the engine in the container, against this plan's intent.

## The fresh-browser ritual

1. **Open the dev URL.** Access intercepts → sign in with Google — the one
   real authentication. Use Google's cross-device passkey flow (QR approved
   on the phone) so no credential is ever typed on an untrusted laptop.
2. **The page load wakes the container.** No separate start action: any
   request through the Worker starts the instance (charges begin then).
   Warm-image starts are seconds. The tldraw UI that loads is already a full
   dev surface with no Claude involved: CodeMirror editors, LSP, analyze,
   Run.
3. **Optionally open claude.ai/code** → "Continue with Google" (piggybacks
   the Google session from step 1, ~two clicks) → the container's Remote
   Control server is in the session list (named, computer icon, green dot);
   click it or start a fresh session against it.

Ordering quirk to remember: **claude.ai/code cannot wake the container**
(Remote Control is outbound-only from the container), so the dev URL comes
first, claude.ai second. Since the dev URL is where the editors live anyway,
this is the natural habit.

Total ritual: one Google auth (QR scan) + one URL + two clicks.

## Container boot / shutdown (entrypoint contract)

Boot:
1. Restore from R2: `~/.claude`, repo checkout, project `data/`.
2. Start the livecode coordination server.
3. `until claude remote-control --name livecode-cloud -c; do sleep 5; done`
   — the `-c` re-adopts the previous session after any restart instead of
   orphaning it; the loop also covers the by-design process exit after ~10
   minutes of network outage.
4. Start a watcher that pushes `~/.claude` to R2 **on file change**
   (see credentials below) and project `data/` on save/interval.

Shutdown: the platform sends SIGTERM with up to 15 minutes before SIGKILL.
Trap it: push repo state (commit/push or R2), project `data/`, and
`~/.claude`, then exit.

Sleep policy: `sleepAfter` generous (e.g. 30–60 min) — but note "activity"
means inbound requests through the Worker, so **a long agent task with no
inbound traffic looks idle**. While a Remote Control session is live, keep
the container awake explicitly (entrypoint pings its own Worker, or manual
lifecycle instead of `sleepAfter`).

## Auth and credentials

- Remote Control **requires a full-scope `claude auth login` credential**;
  `claude setup-token` / `CLAUDE_CODE_OAUTH_TOKEN` tokens are model-request-
  only and are rejected, as are API keys. One-time seeding: log in anywhere,
  put `~/.claude` into R2.
- **Rotation is a non-issue during active use**: the CLI refreshes tokens
  invisibly and rewrites `~/.claude/.credentials.json`; activity keeps the
  grant alive. The only real staleness hazards are (a) an unclean shutdown
  racing a rotation — closed by the push-on-change watcher above, which
  keeps the R2 copy seconds-fresh rather than SIGTERM-fresh; (b) weeks-long
  dormancy hitting refresh-token expiry; (c) account-level revocations
  (password change, session revocation). (Anthropic's exact rotation/expiry
  policy is not publicly documented; treat (b) and (c) as
  possible-but-rare.)
- Recovery for the rare failure: the break-glass browser terminal →
  `claude auth login` (URL/code flow works headlessly). The Worker status
  page should surface "Claude needs re-auth" loudly (RC server failing at
  boot) instead of a silently missing session.

## Security posture

- **The claude.ai account is a root shell on the container.** Passkey/2FA on
  the Anthropic account is the control that matters (the Trusted Devices
  hardening layer is Team/Enterprise-only). Everything below is blast-radius
  hygiene, not a substitute.
- Inside the container: a repo-scoped GitHub deploy key, not an account
  token; no Cloudflare API token unless the agent genuinely deploys; nothing
  else valuable on disk.
- Remote Control transport rides the Anthropic API over TLS with short-lived
  single-purpose credentials; conversation content flows through Anthropic
  like any session.
- All inbound surfaces (UI, uplink, LSP, terminal, status) behind the one
  Access app. Incognito means both cookies (Access, claude.ai) die with the
  window.

## Cost (verified 2026-08-19)

Workers Paid required ($5/mo base). Billing runs only while the container is
awake; CPU bills on actual consumption, memory/disk on provisioned-while-
awake — favorable for agent work, which is mostly API-wait. Sizing:
`standard-1` (½ vCPU/4 GiB) is tight under deno lsp + deno check + the CLI;
**`standard-2` (1 vCPU/6 GiB/12 GB, ≈$0.06/hr awake at mostly-idle CPU)** is
the default choice; custom instance types exist for tuning.

| Pattern (standard-2) | Rough monthly total |
| --- | --- |
| ~3 h/day awake | ~$10–12 |
| 12 h/day awake | ~$25–30 |
| Always-on | ~$45–55 |

Egress: 1 TB/mo included (NA/EU); the architecture keeps the hot sync loop
off the WAN by design, so effectively zero. Model usage: covered by Max.

## Build list (the actual plumbing, ~a day)

1. Dockerfile: Deno + Node + Claude CLI + pre-warmed `deno cache` /
   `node_modules` (image is GB-scale; first provision minutes, warm starts
   seconds — pre-bake aggressively).
2. Worker: container routing, status page, terminal route, Access config.
3. Entrypoint script per the boot/shutdown contract above (restore, two
   servers, restart loop, credential watcher, SIGTERM trap).
4. One-time: Access app + Google IdP; R2 bucket; credential + deploy-key
   seeding.

## Open questions / revisit triggers

- Anthropic refresh-token rotation/expiry policy is undocumented; if boots
  ever fail auth without an account-level cause, tighten the push-on-change
  watcher before blaming anything else.
- If the account ever moves to a Team plan, evaluate **self-hosted
  environments** (start sessions from claude.ai/code directly into the
  container via an environment picker; runner polls outbound-only) as a
  replacement for the Remote Control server.
- Remote Control is a research preview; flags (`--name`, `--spawn`,
  `--capacity`, `-c`) and the session-list behavior should be re-verified
  against the docs when building.
- The decimated uplink mirror (recorded in `browser-engine-plan-2026-08.md`)
  becomes worth building once real WAN latency to this deployment is
  measurable.

## References

- Remote Control: https://code.claude.com/docs/en/remote-control.md
- Self-hosted environments: https://code.claude.com/docs/en/self-hosted-environments
- Containers pricing: https://developers.cloudflare.com/containers/pricing/
- Container lifecycle: https://developers.cloudflare.com/containers/platform-details/architecture/
- Sandbox SDK browser terminals: https://developers.cloudflare.com/sandbox/guides/browser-terminals
- Sandbox SDK Claude Code tutorial: https://developers.cloudflare.com/sandbox/tutorials/claude-code/
- Access browser-rendered terminals (alternative): https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/browser-rendering/
