FROM node:22-bookworm-slim

ARG LARK_CLI_VERSION=1.0.65

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global "@larksuite/cli@${LARK_CLI_VERSION}" \
    && npm cache clean --force

RUN useradd --create-home --uid 10001 --shell /bin/bash smoke \
    && mkdir -p /workspace /state /home/smoke/.lark-cli \
    && chown -R smoke:smoke /workspace /state /home/smoke

WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY --chown=smoke:smoke . .

RUN chmod 0555 .claude/skills/doc-ops-core/sandbox/entrypoint.sh

ENV HOME=/home/smoke \
    XDG_CONFIG_HOME=/home/smoke/.config \
    XDG_CACHE_HOME=/tmp/cache \
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1 \
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1

USER smoke

ENTRYPOINT ["/workspace/.claude/skills/doc-ops-core/sandbox/entrypoint.sh"]
CMD ["help"]
