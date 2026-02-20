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

# ─── Stage 3: Production Runner ───
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

# Copy Prisma schema + CLI for entrypoint (prisma db push)
COPY --from=builder /app/prisma ./prisma
COPY --from=deps /app/node_modules/prisma ./node_modules/prisma
COPY --from=deps /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma

# Copy SSH runtime deps (not traced by standalone)
COPY --from=deps /app/node_modules/ssh2-promise ./node_modules/ssh2-promise
COPY --from=deps /app/node_modules/ssh2 ./node_modules/ssh2
COPY --from=deps /app/node_modules/asn1 ./node_modules/asn1
COPY --from=deps /app/node_modules/bcrypt-pbkdf ./node_modules/bcrypt-pbkdf
COPY --from=deps /app/node_modules/tweetnacl ./node_modules/tweetnacl

# Copy bcryptjs (password hashing at runtime)
COPY --from=deps /app/node_modules/bcryptjs ./node_modules/bcryptjs

# Copy entrypoint
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# NOTE: Runs as root — required for Docker socket access and nsenter
# (same as Portainer and other container management tools)
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./docker-entrypoint.sh"]
