#!/usr/bin/env python3
"""
Generate `--exclude` flags for `deno compile` so the bundle only contains
the npm packages actually reachable from the entry script.

How it works:

1. Run `deno info --json <entry>` to get the top-level npm packages that
   Deno's static analysis can see (e.g. `node-osc`, `tweakpane`).
2. Walk the closure by reading each package's `package.json` under
   `node_modules/.deno/<pkg>@<ver>/node_modules/<pkg>/` and queuing the
   names listed in `dependencies` + `optionalDependencies` +
   `peerDependencies`. We track package names (not specific versions) so
   transitive deps that npm can't always inline get included safely.
3. Every directory under `node_modules/.deno/` whose package-name half is
   not in the closure becomes an `--exclude` line.

The result: any deno bundle (hanoiShow, future ones) gets only the npm
packages it actually reaches, without a hand-curated list. Reads
`node_modules/.deno/` from `<repo_root>` (arg 1) and uses `<entry>` (arg 2)
as the deno compile entry script.

Output: one `--exclude=<path>` per line on stdout.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

if len(sys.argv) != 3:
    print("usage: gen_npm_excludes.py <repo_root> <entry.ts>", file=sys.stderr)
    sys.exit(2)

repo_root = Path(sys.argv[1]).resolve()
entry = Path(sys.argv[2]).resolve()
deno_dir = repo_root / "node_modules" / ".deno"

if not deno_dir.is_dir():
    print(f"# no node_modules/.deno at {deno_dir} — nothing to exclude", file=sys.stderr)
    sys.exit(0)


# --- 1. Top-level npm packages from deno info ----------------------
info = subprocess.run(
    ["deno", "info", "--json", str(entry)],
    capture_output=True, text=True, cwd=str(repo_root),
)
if info.returncode != 0:
    print(f"deno info failed:\n{info.stderr}", file=sys.stderr)
    sys.exit(1)

graph = json.loads(info.stdout)

direct = set()
for m in graph.get("modules", []):
    s = m.get("specifier", "")
    mt = re.match(r"^npm:/?(@[^/]+/[^@/]+|[^@/]+)@", s)
    if mt:
        direct.add(mt.group(1))


# --- 2. Build the closure over package.json deps -------------------
# Map encoded form (@scope+name or name) → list of .deno dir names
dirs_by_encoded = {}
for d in deno_dir.iterdir():
    if not d.is_dir():
        continue
    name_part = d.name.split("@", 1)[0] if not d.name.startswith("@") else d.name.split("@", 2)[1].rsplit("@", 0)[0]
    # Simpler & correct: encoded name is everything before the LAST "@version"
    # but the encoded scope already contains "@" so split on the rightmost @ followed by a digit
    mt = re.match(r"^(.+?)@\d", d.name)
    if not mt:
        continue
    encoded = mt.group(1)
    dirs_by_encoded.setdefault(encoded, []).append(d)


def encoded(name: str) -> str:
    # node_modules/.deno encodes scoped packages by replacing the leading
    # "/" of "@scope/name" with "+", giving "@scope+name".
    return name.replace("/", "+")


def candidate_dirs(pkg: str):
    return dirs_by_encoded.get(encoded(pkg), [])


closure_names = set(direct)
queue = list(direct)

while queue:
    name = queue.pop()
    for d in candidate_dirs(name):
        # The actual package files live at <d>/node_modules/<name>/package.json
        # (path uses the un-encoded scoped form).
        pj_path = d / "node_modules" / name / "package.json"
        if not pj_path.is_file():
            continue
        try:
            pj = json.loads(pj_path.read_text())
        except Exception:
            continue
        for field in ("dependencies", "optionalDependencies", "peerDependencies"):
            for dep_name in (pj.get(field) or {}):
                if dep_name not in closure_names:
                    closure_names.add(dep_name)
                    queue.append(dep_name)


# --- 3. Emit --exclude for every .deno dir whose package isn't reachable ----
for d in sorted(deno_dir.iterdir()):
    if not d.is_dir():
        continue
    mt = re.match(r"^(.+?)@\d", d.name)
    if not mt:
        continue
    enc = mt.group(1)
    pkg = enc.replace("+", "/", 1) if enc.startswith("@") else enc
    if pkg in closure_names:
        continue
    # The deep symlink-target path is what we need to exclude; just
    # excluding the @ver dir doesn't work because the top-level
    # node_modules/<pkg>/ symlink would still pull the same files via
    # the resolved target.
    rel = f"node_modules/.deno/{d.name}/node_modules/{pkg}"
    print(f"--exclude={rel}")
