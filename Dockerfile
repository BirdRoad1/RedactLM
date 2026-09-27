# LLM Thingy API. Applies database migrations on start, then serves on :3000.
# Built and run by docker-compose.yml, next to Postgres and the web UI.

FROM oven/bun:1.4 AS deps
WORKDIR /app
COPY package.json bun.lock ./
# production dependencies only: drizzle-kit, test tools etc. stay out
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY package.json tsconfig.json ./
COPY src src
COPY scripts scripts
COPY drizzle drizzle

# the image's own unprivileged user; nothing here writes to disk
USER bun
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["bun", "-e", "fetch('http://localhost:3000/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# exec: the server replaces the shell, so it gets `docker stop`'s signal
CMD ["sh", "-c", "bun scripts/migrate.ts && exec bun src/index.ts"]
