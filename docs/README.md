# VPS Control App — Documentation

> Everything you need to understand, develop, and deploy VPS Control App.

| You want to...                      | Go to                                              |
| ----------------------------------- | -------------------------------------------------- |
| Understand architecture & get started | **This file** (sections below)                   |
| See API endpoints, DB schema, security | [API-AND-DATABASE.md](./API-AND-DATABASE.md)     |
| Learn code conventions & components   | [DEVELOPMENT.md](./DEVELOPMENT.md)               |

---

## Tech Stack

| Layer      | Technology                          |
| ---------- | ----------------------------------- |
| Framework  | Next.js 16 (App Router, standalone) |
| UI         | React 19.2, Tailwind CSS 3.4       |
| Language   | TypeScript 5.7+ (strict)           |
| Database   | PostgreSQL 16 (Alpine Docker)      |
| ORM        | Prisma                              |
| Auth       | JWT (jose HS256) + bcryptjs        |
| SSH        | ssh2-promise                        |
| Encryption | AES-256-GCM                        |
| Proxy      | Traefik (external)                 |
| Container  | Docker + Compose                   |
| Icons      | lucide-react                       |
| Charts     | recharts                           |

---

## Architecture

### System Diagram

```
                        Internet
                           │
                           ▼
                   ┌───────────────┐
                   │    Traefik    │  ← Pre-existing reverse proxy on host
                   │  (HTTPS/TLS) │     Auto-provisions Let's Encrypt certs
                   └───────┬───────┘
                           │
                   traefik_network (external Docker network)
                           │
                           ▼
                  ┌─────────────────┐
                  │  Next.js App    │  ← Container: vps-control-app
                  │  Port 3000      │     Serves both Frontend + API
                  │  (standalone)   │
                  └────────┬────────┘
                           │
                   internal (private bridge network)
                           │
                           ▼
                  ┌─────────────────┐
                  │   PostgreSQL    │  ← Container: vps-control-db
                  │   Port 5432     │     NOT exposed to the internet
                  │   (encrypted)   │     Only the app can reach it
                  └─────────────────┘
```

### Docker Networks

| Network           | Type     | Purpose                                               |
| ----------------- | -------- | ----------------------------------------------------- |
| `traefik_network` | External | Connects the app to Traefik for internet-facing traffic |
| `internal`        | Bridge   | Private link between the app and PostgreSQL            |

**Key:** PostgreSQL lives only on the `internal` network. Only the Next.js app can access it.

### Request Flow

```
Client (Browser)
  │
  ▼
Traefik (TLS termination, domain-based routing)
  │
  ▼
Next.js App ──┬── Server Components (SSR HTML)
              ├── API Routes (/api/*)
              │     ├── Auth (JWT cookie)
              │     ├── Server CRUD (encrypt/decrypt credentials)
              │     ├── SSH connections (ssh2-promise)
              │     ├── SSE stream (real-time stats)
              │     └── Deploy (git clone + stack detection)
              └── Static assets
```

### Key Design Decisions

| Decision | Why |
| --- | --- |
| **Monolith in Docker** | Simple deployment (2 containers), low complexity, right-sized for a VPS tool |
| **App Router** | Route groups: `(auth)` for login, `(panel)` for main panel with sidebar |
| **SSE over WebSocket** | Unidirectional server→client, no separate socket server, auto-reconnect |
| **AES-256-GCM** | Authenticated encryption for SSH credentials; format: `base64(IV + ciphertext + authTag)` |
| **JWT HttpOnly Cookie** | No tokens in localStorage (XSS-safe), `Secure` + `SameSite: lax`, 7-day TTL |
| **Standalone Output** | `output: "standalone"` in next.config.ts for compact Docker image |
| **SSH Auto-Accept** | ssh2-promise accepts host keys by default for automation |

### Directory Structure

```
src/
├── app/                  # Next.js App Router
│   ├── (auth)/           # Route group: login page
│   ├── (panel)/          # Route group: main panel (auth required)
│   ├── api/              # API Routes (backend)
│   ├── layout.tsx        # Root layout (dark theme)
│   └── globals.css       # Global styles + Tailwind
│
├── components/           # React components
│   ├── dashboard/        # Gauges, bars, cards for stats
│   ├── deploy/           # Form + log for deployments
│   ├── layout/           # Sidebar, Header
│   ├── network/          # Port table, Package manager
│   ├── servers/          # CRUD + stats for servers
│   └── ui/               # Primitives: Button, Card, Input, Badge
│
├── hooks/                # useAuth, useSSE
├── lib/                  # auth, crypto, db, deployer, ssh, stats
├── middleware.ts          # Auth guard for protected routes
└── types/index.ts        # TypeScript interfaces
```

---

## Getting Started (Local Development)

### Prerequisites

| Tool           | Minimum | Verify                   |
| -------------- | ------- | ------------------------ |
| Node.js        | 20.x    | `node --version`        |
| npm            | 10.x    | `npm --version`         |
| Docker         | 24.x    | `docker --version`      |
| Git            | 2.x     | `git --version`         |

### Setup Steps

```bash
# 1. Clone
git clone https://github.com/Milunice259/vps-assistant-for-no-code-user.git
cd vps-assistant-for-no-code-user

# 2. Install dependencies (auto-runs prisma generate)
npm install

# 3. Start PostgreSQL
docker run -d --name vps-dev-db \
  -e POSTGRES_USER=vpsadmin \
  -e POSTGRES_PASSWORD=devpassword123 \
  -e POSTGRES_DB=vpscontrol \
  -p 5432:5432 postgres:16-alpine

# 4. Create .env
cat > .env << 'EOF'
DATABASE_URL="postgresql://vpsadmin:devpassword123@localhost:5432/vpscontrol"
DB_HOST=localhost
DB_PORT=5432
JWT_SECRET=dev-jwt-secret-change-in-production-must-be-64-hex-chars-long-ok
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
EOF

# 5. Run migrations
npm run db:migrate

# 6. Seed admin account
npm run db:seed

# 7. Start dev server
npm run dev
# → http://localhost:3000
```

### Common Commands

| Command              | Description                             |
| -------------------- | --------------------------------------- |
| `npm run dev`        | Start dev server (hot reload)           |
| `npm run build`      | Production build                        |
| `npm run lint`       | ESLint check                            |
| `npm run db:migrate` | Create & apply migration                |
| `npm run db:push`    | Push schema directly (dev only)         |
| `npm run db:seed`    | Seed initial data                       |
| `npm run db:studio`  | Prisma Studio GUI (localhost:5555)      |

### URL Map

| URL             | Description               | Auth? |
| --------------- | ------------------------- | ----- |
| `/login`        | Login page                | No    |
| `/dashboard`    | Real-time stats dashboard | Yes   |
| `/servers`      | VPS server management     | Yes   |
| `/servers/[id]` | Server detail + live stats| Yes   |
| `/network`      | Port & package management | Yes   |
| `/deploy`       | GitHub deployer           | Yes   |

### Troubleshooting

| Problem | Fix |
| --- | --- |
| `Cannot find module '@prisma/client'` | Run `npm run db:generate` |
| Database connection errors | Check `docker ps` and `DATABASE_URL` in `.env` |
| `ENCRYPTION_KEY must be 64 hex chars` | Generate with `openssl rand -hex 32` |
| Port 3000 in use | `PORT=3001 npm run dev` |
| Network page errors on Windows | Expected — `ss` and `apt` are Linux-only commands |

---

## Production Deployment

### Server Requirements

| Requirement    | Details                                  |
| -------------- | ---------------------------------------- |
| OS             | Ubuntu 20.04+ / Debian (recommended)    |
| Root access    | Required (the script installs Docker)    |
| Domain         | A record pointing to the server IP       |
| RAM            | 1 GB minimum (2 GB recommended)          |
| Disk           | 5 GB minimum                             |

> Docker, Docker Compose, Traefik, and firewall are all **installed automatically** by the deploy script.

### One-Click Deploy (Recommended)

```bash
git clone https://github.com/Milunice259/vps-assistant-for-no-code-user.git /opt/vps-panel
cd /opt/vps-panel
chmod +x deploy.sh
./deploy.sh
```

**The script automatically:**
1. Checks system requirements (OS, RAM, disk, internet)
2. Installs Docker, Docker Compose, UFW firewall
3. Sets up Traefik reverse proxy (detects existing or creates new)
4. Prompts for domain, admin credentials
5. Generates cryptographic secrets (`DB_PASSWORD`, `JWT_SECRET`, `ENCRYPTION_KEY`)
6. Builds and deploys the app + PostgreSQL
7. Verifies deployment health

### Manual Deploy

```bash
# Generate secrets
DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# Create .env (edit values as needed)
cat > .env << EOF
NODE_ENV=production
DOMAIN=panel.example.com
POSTGRES_USER=vpsadmin
POSTGRES_PASSWORD=$DB_PASSWORD
POSTGRES_DB=vpscontrol
DATABASE_URL=postgresql://vpsadmin:$DB_PASSWORD@db:5432/vpscontrol
DB_HOST=db
DB_PORT=5432
JWT_SECRET=$JWT_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password
TRAEFIK_NETWORK=traefik_network
CERT_RESOLVER=letsencrypt
EOF

# Build & start
docker compose up -d --build
```

### Traefik Labels

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.vps-control.rule=Host(`${DOMAIN}`)"
  - "traefik.http.routers.vps-control.entrypoints=websecure"
  - "traefik.http.routers.vps-control.tls.certresolver=${CERT_RESOLVER}"
  - "traefik.http.routers.vps-control-http.rule=Host(`${DOMAIN}`)"
  - "traefik.http.routers.vps-control-http.entrypoints=web"
  - "traefik.http.routers.vps-control-http.middlewares=redirect-https"
  - "traefik.http.middlewares.redirect-https.redirectscheme.scheme=https"
  - "traefik.http.services.vps-control.loadbalancer.server.port=3000"
```

### Startup Flow

```
docker-entrypoint.sh
    ├─ 1. Wait for DB (wait-for-db.js × 30 retries, 2s apart)
    ├─ 2. Run Prisma migrations (prisma migrate deploy)
    └─ 3. Start Next.js (node server.js)
```

### Operations

```bash
# Update
git pull origin main && docker compose up -d --build

# Backup DB
docker compose exec db pg_dump -U vpsadmin vpscontrol > backup_$(date +%Y%m%d).sql

# Restore DB
docker compose exec -T db psql -U vpsadmin vpscontrol < backup.sql

# Monitor
docker stats vps-control-app vps-control-db
docker compose logs -f --tail=100 app
```

### Deployment Troubleshooting

| Problem | Fix |
| --- | --- |
| App won't start | `docker compose logs app` — check for DB/migration/env errors |
| Can't access via domain | Verify DNS (`dig domain`), Traefik logs, network inspect |
| Database disk full | `docker system prune -a --volumes` |
