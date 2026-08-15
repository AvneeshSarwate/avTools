# Running Deno in Claude Code on the web

Cloud sessions run in an Ubuntu 24.04 container that ships Node 22, npm, bun,
yarn and pnpm — but **no Deno**, which is the runtime this repo is built on.
This note records what works, what does not, and why.

## TL;DR

1. `.claude/hooks/session-start.sh` installs Deno on every cloud session
   (~3s cold, ~0.1s when already present). Nothing to do once it is merged
   into the default branch.
2. **Set the environment's network access to `Custom` and add `jsr.io` and
   `npm.jsr.io`.** Without this, nothing that imports `@std/*` or `@gfx/*`
   can be type-checked or tested — which is most of the repo.

## The problem: `deno.land` is blocked

The default **Trusted** network policy allows common package registries and
GitHub, and blocks everything else. The official installer is therefore not
usable:

```
$ curl -fsSL https://deno.land/install.sh | sh
curl: (22) The requested URL returned error: 403
# body: Host not in allowlist: deno.land.
```

Reachability as measured from a cloud session on the default policy:

| Host                    | Status | Notes                              |
| ----------------------- | ------ | ---------------------------------- |
| `registry.npmjs.org`    | ✅     | `npm:` specifiers resolve          |
| `github.com`            | ✅     | release archives download fine     |
| `deno.land`             | ❌ 403 | official install script            |
| `dl.deno.land`          | ❌ 403 | `deno upgrade` target              |
| `jsr.io`                | ❌ 403 | **blocks `@std/*`, `@gfx/*`**      |
| `npm.jsr.io`            | ❌ 403 | JSR's npm-compat registry          |

## How the hook installs Deno

Two routes, both hitting hosts the Trusted policy already allows:

1. **npm** — the `deno` package vendors the real binary in a platform optional
   dependency (`@deno/linux-x64-glibc`), so there is no post-install download
   from `deno.land`. This takes about three seconds.
2. **GitHub releases** — fallback that fetches
   `deno-x86_64-unknown-linux-gnu.zip` from `github.com/denoland/deno`.

Both routes are tested and produce the same official binary. The hook symlinks
it to `~/.local/bin/deno` and persists `PATH`, `DENO_DIR` and `DENO_CERT`
through `$CLAUDE_ENV_FILE` so every later shell in the session sees it.

`DENO_CERT` points at `/root/.ccr/ca-bundle.crt`. Outbound HTTPS is
re-terminated by the session's egress proxy, so Deno needs that CA to verify
proxied fetches.

The hook is a no-op outside cloud sessions (it checks `$CLAUDE_CODE_REMOTE`).
On a local machine, keep using `./setup.sh`, which additionally builds the
Rust/FFI helpers and installs the Jupyter kernel.

## The remaining blocker: JSR

Deno itself runs fine, but the repo's imports do not resolve:

```
$ deno test livecode/tests/params_store_test.ts
error: JSR package manifest for '@std/assert' failed to load.
       Import 'https://jsr.io/@std/assert/meta.json' failed: 403 Forbidden
```

Every test file in the repo imports `@std/assert`, and `deno.lock` pins 48 JSR
packages, so the test suite cannot run until JSR is allowlisted.

### Fix

At [claude.ai/code](https://claude.ai/code), open the environment selector →
edit the environment → **Network access** → **Custom**, tick *Also include
default list of common package managers*, and add:

```
jsr.io
npm.jsr.io
```

Add `deno.land` and `dl.deno.land` too if you want `deno upgrade` and
`https://deno.land/x/...` imports to work. Changing the allowed hosts
invalidates the environment snapshot, so the next session rebuilds it.

Once JSR is reachable the hook also warms the dependency cache with
`deno install` on startup.

## Alternative: an environment setup script

The hook is committed to the repo, so it is version-controlled and applies to
every environment and every teammate. If you would rather provision the VM
itself — the docs' recommended home for toolchains — paste this into the
environment's **Setup script** field instead. It is snapshotted into the
environment cache, so sessions start with Deno already on disk:

```bash
#!/bin/bash
npm install --prefix /opt/deno-npm --no-audit --no-fund deno@2.9.5 || true
ln -sf "$(readlink -f /opt/deno-npm/node_modules/.bin/deno)" /usr/local/bin/deno || true
```

Setup scripts must exit zero and finish within about five minutes, hence the
`|| true`. They only run when no cached environment exists; the SessionStart
hook runs on every session including resumed ones.

## Verified in a cloud session

| Check                                          | Result |
| ---------------------------------------------- | ------ |
| `deno --version` (npm route)                   | ✅ 2.9.5 |
| `deno --version` (GitHub fallback route)       | ✅ 2.9.5 |
| Hook idempotency on re-run                     | ✅ skips in ~0.1s |
| Hook no-op on a local machine                  | ✅ silent exit 0 |
| `deno lint` / `deno fmt --check`               | ✅ runs |
| `deno check` on a local+`npm:` package         | ✅ passes |
| `deno test` on a file without JSR imports      | ✅ passes |
| `deno test` on the repo's suites               | ❌ blocked on `jsr.io` |
