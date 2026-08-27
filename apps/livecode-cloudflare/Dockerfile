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
COPY apps/livecode-tldraw/package.json apps/livecode-tldraw/package-lock.json /opt/avtools-seed/apps/livecode-tldraw/
COPY apps/browser-projections/package.json apps/browser-projections/package-lock.json /opt/avtools-seed/apps/browser-projections/
COPY packages/hysnappy2 /opt/avtools-seed/packages/hysnappy2
RUN npm ci --prefix /opt/avtools-seed/apps/livecode-tldraw \
    && npm ci --prefix /opt/avtools-seed/apps/browser-projections

# This is a dev machine, not a minimal production artifact: seed the complete
# Git worktree so the browser terminal and agents can edit framework code as
# well as individual projects. Generated/dependency directories are filtered
# by the repository-level .dockerignore.
COPY . /opt/avtools-seed

RUN npm --prefix /opt/avtools-seed/apps/browser-projections run buildPianoRoll \
    && npm --prefix /opt/avtools-seed/apps/browser-projections run buildAnimationEditor \
    && mkdir -p /opt/livecode \
    && cp /opt/avtools-seed/apps/livecode-cloudflare/container/boot.sh /opt/livecode/boot.sh \
    && chmod 0755 /opt/livecode/boot.sh \
    && cd /opt/avtools-seed/apps/deno-notebooks \
    && deno cache livecode/visualizer/main.ts

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
