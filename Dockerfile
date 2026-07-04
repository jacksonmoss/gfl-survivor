# syntax=docker/dockerfile:1

# ── Base ──────────────────────────────────────────────────────────────────────
# Debian bookworm-slim (glibc + openssl 3) matches the Prisma schema-engine build
# and Node 24 required by package.json `engines`. pnpm is activated via corepack.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
# openssl is required by the Prisma schema engine (migrate/generate); slim images omit it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# ── Dependencies ──────────────────────────────────────────────────────────────
# Full install (frozen lockfile). Approved build scripts (prisma, sharp, esbuild)
# run per the allowBuilds whitelist in pnpm-workspace.yaml.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── Builder ───────────────────────────────────────────────────────────────────
# Generate the Prisma client, then build the standalone Next.js server bundle.
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# DATABASE_URL is read as a string at module load; the build performs no DB I/O.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN pnpm prisma generate
RUN pnpm build

# ── Migrator ──────────────────────────────────────────────────────────────────
# One-shot image that applies pending migrations. Kept separate from the runner
# so the app image stays slim and migrations run once, not per replica.
FROM base AS migrator
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
CMD ["pnpm", "prisma", "migrate", "deploy"]

# ── Runner ────────────────────────────────────────────────────────────────────
# Minimal runtime: only the standalone server + static assets. No Prisma engine
# is needed here — the app talks to Postgres through the pg driver adapter.
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# node:*-slim ships an unprivileged `node` user (uid 1000); run as it.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000
CMD ["node", "server.js"]
