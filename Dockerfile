## ═══════════════════════════════════════════════════
##  VPS Control App - Multi-Stage Dockerfile
##  SQLite database (embedded, no external DB needed)
## ═══════════════════════════════════════════════════

FROM node:20-alpine AS base

# ─── Stage 1: Install ALL Dependencies (dev + prod) ───
FROM base AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

# ─── Stage 2: Build Application ───
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ─── Stage 3: Production-only Dependencies ───
# Derived FROM deps (no second npm ci = no double network download)
# npm prune removes devDependencies, keeping only production deps
FROM deps AS prod-deps
RUN npm prune --omit=dev

# ─── Stage 4: Production Runner ───
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# Create data directory for SQLite
RUN mkdir -p /app/data

# Network/ports feature needs `ss` (iproute2)
# iproute2 = ss (ports), docker-cli = docker ps, util-linux = nsenter (host commands)
RUN apk add --no-cache iproute2 docker-cli util-linux

# 1. First, copy ALL production deps (prisma + its full transitive tree)
#    npm handles dependency resolution — no more manual package copying
COPY --from=prod-deps /app/node_modules ./node_modules

# 2. Copy Prisma generated client (built in builder stage)
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma

# 3. Copy Next.js standalone build ON TOP — its traced modules override
#    where needed; prisma/ssh deps from step 1 remain untouched
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# 4. Copy Prisma schema for entrypoint (prisma db push)
COPY --from=builder /app/prisma ./prisma

# Copy entrypoint
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# NOTE: Runs as root — required for Docker socket access and nsenter
# (same as Portainer and other container management tools)
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./docker-entrypoint.sh"]
