# Livecode E2E in a restricted Linux workspace

This runbook is for ChatGPT Work sessions where Deno or Chromium fails before
the test can run. Check the actual session: another thread's installed binaries,
temporary files, proxy settings, and filesystem may differ.

The normal test remains authoritative. A successful bake alone is not an E2E
pass. Do not remove assertions or filter page errors to turn a failure green.

## 1. Establish the checkout and prerequisites

Run from the repository root in Bash:

```sh
export LIVECODE_REPO="$(git rev-parse --show-toplevel)"
export LIVECODE_WORK="$(mktemp -d "$LIVECODE_REPO/../livecode-test-work.XXXXXX")"
export TMPDIR="$LIVECODE_WORK/tmp"
mkdir -p "$TMPDIR"
git rev-parse HEAD
git status --short
node --version
command -v deno
ls -ld /proc /proc/self/exe /tmp
```

Missing paths in the last command are diagnostic, not instructions to create
or mount system directories. If command execution itself is unavailable, fix
that first; no Deno flag can repair a missing checkout or shell.

Use an installed Deno if available. The earlier successful bake used 2.9.6;
this is a reproduction version, not a requirement to downgrade the project.
If Deno is absent and package installation is available:

```sh
npm install --prefix "$LIVECODE_WORK/tools" deno@2.9.6
export LIVECODE_DENO="$LIVECODE_WORK/tools/node_modules/deno/deno"
```

Otherwise set LIVECODE_DENO to the absolute executable path. Resolve a symlink
with `readlink -f` on Linux. Keep scratch dependencies outside the checkout.

Install the app dependencies using its lockfile and build the UI:

```sh
cd "$LIVECODE_REPO/apps/livecode-tldraw"
npm ci
npm run setupLivecode
npm run build
```

Resolve Playwright from the E2E runner's directory too. Installing it in a
sibling app does not guarantee that Node can resolve it for this runner:

```sh
cd "$LIVECODE_REPO/apps/deno-notebooks"
node -e 'console.log(require.resolve("playwright"))'
```

Use the repository's dependency setup when this fails. Do not change tracked
dependency versions merely to accommodate the test machine.

## 2. Isolate JSR access

Use the same executable and a bounded wait for each comparison:

```sh
timeout 45s "$LIVECODE_DENO" cache --reload jsr:@std/path@1
timeout 45s env -u ALL_PROXY -u all_proxy \
  "$LIVECODE_DENO" cache --reload jsr:@std/path@1
```

In the September 7 session, the first command hung while the second succeeded.
HTTP_PROXY and HTTPS_PROXY remained in place. This indicates a proxy-selection
problem in that session; it does not establish a general Cloudflare block or a
missing public-internet toggle. Apply the override only if the comparison
supports it. Do not print proxy credentials or disable TLS verification.

If `timeout` is unavailable, use the executor's timeout/cancellation facility.

## 3. Test Deno's executable-path lookup

```sh
"$LIVECODE_DENO" eval 'console.log(Deno.execPath())'
```

The observed failure was a Deno panic containing:

```text
no /proc/self/exe available. Is /proc mounted?
```

Deno 2.8.3 and 2.9.6 both failed in that session. Loading npm modules also
triggered the lookup. The bake builder explicitly uses Deno.execPath() when
launching deno bundle, so solving JSR downloads alone is insufficient.

### Optional compatibility shim

For this specific missing-path failure, the earlier session successfully used
an LD_PRELOAD shim that answers only the executable-path lookup. It does not
supply procfs or grant additional filesystem permissions. Use only where local
compatibility libraries are allowed; if the environment rejects this mechanism,
report the blocker and use another execution environment.

Requires Linux, a dynamically linked Deno binary, and a C compiler. This is
opt-in test infrastructure, not a production dependency. Do not export
LD_PRELOAD globally.

```sh
cat > "$LIVECODE_WORK/exec-path.c" <<'C'
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static ssize_t executable_path(char *buf, size_t size) {
  const char *path = getenv("LIVECODE_EXECUTABLE");
  if (!path || path[0] != '/') { errno = ENOENT; return -1; }
  size_t n = strlen(path);
  if (n > size) n = size;
  memcpy(buf, path, n);
  return (ssize_t)n;
}

ssize_t readlink(const char *path, char *buf, size_t size) {
  if (strcmp(path, "/proc/self/exe") == 0)
    return executable_path(buf, size);
  ssize_t (*next)(const char *, char *, size_t) =
    dlsym(RTLD_NEXT, "readlink");
  if (!next) { errno = ENOSYS; return -1; }
  return next(path, buf, size);
}

ssize_t readlinkat(int fd, const char *path, char *buf, size_t size) {
  if (strcmp(path, "/proc/self/exe") == 0)
    return executable_path(buf, size);
  ssize_t (*next)(int, const char *, char *, size_t) =
    dlsym(RTLD_NEXT, "readlinkat");
  if (!next) { errno = ENOSYS; return -1; }
  return next(fd, path, buf, size);
}
C
cc -shared -fPIC -O2 -Wall -Wextra \
  -o "$LIVECODE_WORK/exec-path.so" "$LIVECODE_WORK/exec-path.c" -ldl
export LIVECODE_EXEC_SHIM="$LIVECODE_WORK/exec-path.so"

cat > "$LIVECODE_WORK/deno" <<'SH'
#!/bin/sh
: "${LIVECODE_DENO:?Set the absolute Deno executable path}"
: "${LIVECODE_EXEC_SHIM:?Set the compiled shim path}"
exec env LD_PRELOAD="$LIVECODE_EXEC_SHIM" \
  LIVECODE_EXECUTABLE="$LIVECODE_DENO" "$LIVECODE_DENO" "$@"
SH
chmod +x "$LIVECODE_WORK/deno"
export DENO_BIN="$LIVECODE_WORK/deno"

"$DENO_BIN" eval 'console.log(Deno.execPath())'
"$DENO_BIN" eval 'import { ts } from "npm:ts-morph@23.0.0"; console.log(ts.version)'
```

If the proxy comparison required it, prefix invocations with
`env -u ALL_PROXY -u all_proxy`; the subprocesses inherit that environment.
If /proc/self/exe works normally, skip the shim and set DENO_BIN to LIVECODE_DENO.

The shim is inherited by Deno's child processes, including deno bundle. Keep
its use limited to these test commands. It is not a general wrapper for
unrelated applications.

## 4. Prove the bake separately

```sh
cd "$LIVECODE_REPO/apps/deno-notebooks"
"$DENO_BIN" run --allow-all livecode/browser_host/bake_project.ts \
  --project ../livecode-tldraw/example-projects/timing-examples \
  --out "$LIVECODE_WORK/timing-examples-bake"
"$DENO_BIN" run --allow-all livecode/browser_host/bake_project.ts \
  --project ../livecode-tldraw/example-projects/timing-composition \
  --out "$LIVECODE_WORK/timing-composition-bake"
```

Expect exit status zero and a projectBaked record with five modules per
project. This covers analysis, transformation, bundling and static output.
It does not prove browser behavior. A tmpdir error means TMPDIR must point
to an existing writable directory, including in the parent Node process.

## 5. Prepare and probe Chromium

Prefer the browser matching the installed Playwright version. Run Playwright's
browser installer from the package that owns that dependency, or supply a
compatible existing binary through PW_CHROMIUM_PATH. Record its version.

Run a minimal launch before paying for another bake:

```sh
cd "$LIVECODE_REPO/apps/deno-notebooks"
node --input-type=module <<'JS'
import { chromium } from 'playwright';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
});
try {
  const page = await browser.newPage();
  await page.setContent('<canvas width="20" height="20"></canvas>');
  console.log(await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    canvas.getContext('2d').fillRect(0, 0, 10, 10);
    return canvas.toDataURL().startsWith('data:image/png');
  }));
} finally {
  await browser.close();
}
JS
```

An absent Playwright executable is an installation issue. SIGTRAP with procfs
errors is a separate runtime issue. Do not repeatedly rebake to diagnose a
browser launch failure.

### Diagnostic fallback for a missing procfs

The earlier session launched Chromium 149 using the same executable-path shim,
plus --no-zygote and --single-process. This is an experimental fallback: it
changes Chromium's process architecture and is unsuitable for establishing
normal multi-process, isolation, GPU, or device behavior.

If that fallback is allowed and necessary, set LIVECODE_CHROMIUM to the absolute
real binary and use a separate wrapper so Deno and Chromium each receive their
own executable path:

```sh
cat > "$LIVECODE_WORK/chromium" <<'SH'
#!/bin/sh
: "${LIVECODE_CHROMIUM:?Set the absolute Chromium executable path}"
: "${LIVECODE_EXEC_SHIM:?Set the compiled shim path}"
exec env LD_PRELOAD="$LIVECODE_EXEC_SHIM" \
  LIVECODE_EXECUTABLE="$LIVECODE_CHROMIUM" \
  "$LIVECODE_CHROMIUM" --no-zygote --single-process "$@"
SH
chmod +x "$LIVECODE_WORK/chromium"
export LIVECODE_CHROMIUM
export PW_CHROMIUM_PATH="$LIVECODE_WORK/chromium"
```

Repeat the minimal launch probe before the real tests. Do not assume a working
launch or PNG serialization establishes that image decoding and canvas
mirroring work.

## 6. Run the unchanged E2E

```sh
cd "$LIVECODE_REPO/apps/deno-notebooks"
node livecode/tests/timing_examples.e2e.mjs timing-examples
node livecode/tests/timing_examples.e2e.mjs timing-composition
```

Use the proxy prefix from step 2 if needed. DENO_BIN, TMPDIR and
PW_CHROMIUM_PATH must be exported in this shell. The runner rebakes by design.

For genuinely slow execution, LIVECODE_E2E_TIMEOUT_SCALE=2 increases assertion
timeouts. It cannot repair a startup crash or an image-decoder failure.

Inspect the runner at the tested commit. Current tests check that a scene's
pixels stop changing after pause and change again after resume, and reject
page errors. Earlier tests primarily checked frame counters and params values;
their success does not establish the stronger current contract.

## 7. Classify the result accurately

- **Clean E2E pass:** unchanged runner exits zero, with versions, commit,
  environment overrides and any nonstandard browser mode recorded.
- **Bake pass, browser blocked:** bake exits zero but browser cannot launch.
- **Partial browser validation:** some assertions complete but page errors or
  later assertions fail. Preserve the failing exit status and logs.
- **Normal-environment confirmation:** rerun in CI or a development environment
  with procfs and ordinary Chromium before claiming normal browser coverage.

The September 7 workaround completed both bakes and reached the then-current
browser functional assertions. The stock runner failed on repeated
EncodingError: The source image cannot be decoded. An unchanged
feature-canvas-surface control also produced these errors. This suggests a
shared environment or framework problem, but does not prove their cause or
justify ignoring them. A temporary harness filtered them; that result was
partial validation, not a clean E2E pass.

Do not run the timing-gallery test against arbitrary projects as a generic
control: it assumes particular canvas dimensions and params conventions.
Use a project's own test or a deliberately scoped diagnostic.

For each handoff record: commit SHA, Node/Deno/Playwright/Chromium versions,
exact command and overrides, exit status, first substantive error, assertions
reached, and artifact paths. Keep artifacts inside the writable workspace.
Do not carry session-specific absolute paths into repository setup scripts.
