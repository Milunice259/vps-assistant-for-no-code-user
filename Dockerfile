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

# ─── Stage 3: Production Dependencies Only ───
FROM base AS proddeps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --omit=dev
RUN npx prisma generate
# Remove packages already tree-shaken into standalone build
# Only @prisma/client, .prisma, ssh2-promise, ssh2, bcryptjs needed at runtime
RUN rm -rf node_modules/lucide-react \
    node_modules/recharts \
    node_modules/clsx \
    node_modules/jose \
    node_modules/react \
    node_modules/react-dom \
    node_modules/d3-* \
    node_modules/js-yaml \
    node_modules/typescript \
    node_modules/effect \
    node_modules/.cache

# ─── Stage 4: Production Runner ───
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# Create data directory for SQLite
RUN mkdir -p /app/data

# Network/ports feature needs `ss` (iproute2)
# iproute2 = ss (ports), docker-cli = docker ps, util-linux = nsenter (host commands)
RUN apk add --no-cache iproute2 docker-cli util-linux

# Copy Next.js standalone build (includes minimal node_modules)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Overlay production-only node_modules (Prisma, bcryptjs, ssh2, etc.)
# This replaces the standalone trace with properly pruned production deps
COPY --from=builder /app/prisma ./prisma
COPY --from=proddeps /app/node_modules ./node_modules

# Copy entrypoint
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# NOTE: Runs as root — required for Docker socket access and nsenter
# (same as Portainer and other container management tools)
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./docker-entrypoint.sh"]

