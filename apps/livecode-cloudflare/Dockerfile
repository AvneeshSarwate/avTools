FROM docker.io/cloudflare/sandbox:next

USER root

ARG DENO_VERSION=2.9.5

RUN curl -fsSL https://deno.land/install.sh -o /tmp/install-deno.sh \
    && DENO_INSTALL=/usr/local sh /tmp/install-deno.sh "v${DENO_VERSION}" \
    && rm /tmp/install-deno.sh \
    && apt-get update \
    && apt-get install -y --no-install-recommends inotify-tools rsync \
    && rm -rf /var/lib/apt/lists/*

# Install the two hot-path dependency trees in a cacheable layer. The browser
# project has one repository-local file dependency.
COPY apps/livecode-tldraw/package.json apps/livecode-tldraw/package-lock.json /workspace/avTools/apps/livecode-tldraw/
COPY apps/browser-projections/package.json apps/browser-projections/package-lock.json /workspace/avTools/apps/browser-projections/
COPY packages/hysnappy2 /workspace/avTools/packages/hysnappy2
RUN npm ci --prefix /workspace/avTools/apps/livecode-tldraw \
    && npm ci --prefix /workspace/avTools/apps/browser-projections

# This is a dev machine, not a minimal production artifact: seed the complete
# Git worktree so the browser terminal and agents can edit framework code as
# well as individual projects. Generated/dependency directories are filtered
# by the repository-level .dockerignore.
COPY . /workspace/avTools

RUN npm --prefix /workspace/avTools/apps/browser-projections run buildPianoRoll \
    && npm --prefix /workspace/avTools/apps/browser-projections run buildAnimationEditor \
    && npm --prefix /workspace/avTools/apps/browser-projections run buildCanvas \
    && mkdir -p /opt/livecode \
    && cp /workspace/avTools/apps/livecode-cloudflare/container/* /opt/livecode/ \
    && chmod 0755 /opt/livecode/boot.sh \
    && cd /workspace/avTools \
    && mkdir -p /opt/avtools-seed \
    && cp --parents apps/livecode-tldraw/package-lock.json \
      apps/browser-projections/package-lock.json \
      apps/livecode-tldraw/vite.config.ts \
      apps/livecode-tldraw/src/livecodeTldrawDebug.ts \
      apps/livecode-tldraw/tests/livecodeTldraw.e2e.mjs \
      apps/deno-notebooks/livecode/visualizer/server.ts \
      apps/deno-notebooks/livecode/visualizer/main.ts /opt/avtools-seed/ \
    && cd apps/deno-notebooks \
    && deno cache livecode/visualizer/main.ts

# Reusable engine output, validated against the restored source graph at runtime.
RUN cd /workspace/avTools \
    && LIVECODE_BROWSER_HOST_CACHE=/opt/livecode/browser-host-cache \
      deno run --allow-all apps/deno-notebooks/livecode/browser_host/build_host_assets.ts \
      --out /tmp/livecode-engine-build \
    && test -s /opt/livecode/browser-host-cache/current.json \
    && cp --parents apps/deno-notebooks/livecode/browser_host/build_host_assets.ts \
      apps/deno-notebooks/livecode/browser_host/asset_cache.ts /opt/avtools-seed/

# These remote metadata files change with each agent release, invalidating the
# installer layer even when the installer scripts themselves are unchanged.
ADD https://downloads.claude.ai/claude-code-releases/latest /tmp/claude-code-latest
ADD https://releases.openai.com/codex/channels/latest /tmp/codex-latest.json

RUN curl -fsSL https://claude.ai/install.sh -o /tmp/install-claude.sh \
    && bash /tmp/install-claude.sh latest \
    && rm /tmp/install-claude.sh \
    && ln -s /root/.local/bin/claude /usr/local/bin/claude \
    && curl -fsSL https://chatgpt.com/codex/install.sh -o /tmp/install-codex.sh \
    && CODEX_HOME=/opt/codex CODEX_INSTALL_DIR=/usr/local/bin \
      CODEX_NON_INTERACTIVE=1 sh /tmp/install-codex.sh \
    && rm /tmp/install-codex.sh /tmp/claude-code-latest /tmp/codex-latest.json \
    && mkdir -p /root/.codex \
    && claude --version \
    && CODEX_HOME=/root/.codex codex --version

ENV CLAUDE_CONFIG_DIR=/root/.claude
ENV CODEX_HOME=/root/.codex

WORKDIR /workspace/avTools
EXPOSE 5173 7777
