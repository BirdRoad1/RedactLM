# LLM Thingy: the API and the web app in one image. Applies database
# migrations on start, then serves on :3000: the app at /, the API at /api
# and at the root (/v1 for OpenAI-style clients).
# Built and run by docker-compose.yml, next to Postgres.

# package manifests first, so installs are cached until they change
FROM oven/bun:1.4 AS manifests
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

# the web app, built to static files (apps/web/dist)
FROM manifests AS web
RUN bun install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN bun run build

# the server's production dependencies only (no React, no dev tools)
FROM manifests AS deps
RUN bun install --frozen-lockfile --production --filter @llm-thingy/server

# the monorepo's layout, trimmed: the server finds apps/web/dist on its own
FROM oven/bun:1.4
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/server/node_modules apps/server/node_modules
COPY package.json ./
COPY packages/shared packages/shared
COPY apps/server/package.json apps/server/tsconfig.json apps/server/
COPY apps/server/src apps/server/src
COPY apps/server/scripts apps/server/scripts
COPY apps/server/drizzle apps/server/drizzle
COPY --from=web /app/apps/web/dist apps/web/dist

WORKDIR /app/apps/server
# the image's own unprivileged user; nothing here writes to disk
USER bun
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["bun", "-e", "fetch('http://localhost:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# exec: the server replaces the shell, so it gets `docker stop`'s signal
CMD ["sh", "-c", "bun scripts/migrate.ts && exec bun src/index.ts"]
