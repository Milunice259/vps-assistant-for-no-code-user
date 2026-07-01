# VPS Control App — Documentation

> Everything you need to understand, develop, and deploy VPS Control App.

| You want to...                         | Go to                                                |
| -------------------------------------- | ---------------------------------------------------- |
| Understand architecture & get started  | **This file** (sections below)                       |
| See all implemented app capabilities   | [CAPABILITIES-SUMMARY.md](./CAPABILITIES-SUMMARY.md) |
| See API endpoints, DB schema, security | [API-AND-DATABASE.md](./API-AND-DATABASE.md)         |
| Learn code conventions & components    | [DEVELOPMENT.md](./DEVELOPMENT.md)                   |

---

## Tech Stack

| Layer      | Technology                          |
| ---------- | ----------------------------------- |
| Framework  | Next.js 16 (App Router, standalone) |
| UI         | React 19.2, Tailwind CSS 3.4        |
| Language   | TypeScript 5.7+ (strict)            |
| Database   | SQLite (embedded, file-based)       |
| ORM        | Prisma                              |
| Auth       | JWT (jose HS256) + bcryptjs         |
| SSH        | ssh2-promise                        |
| Encryption | AES-256-GCM                         |
| Proxy      | Traefik (external)                  |
| Container  | Docker + Compose                    |
| Icons      | lucide-react                        |
| Charts     | recharts                            |

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
                  │  (standalone)   │     SQLite DB embedded inside
                  └─────────────────┘
```

### Docker Network

| Network           | Type     | Purpose                                                 |
| ----------------- | -------- | ------------------------------------------------------- |
| `traefik_network` | External | Connects the app to Traefik for internet-facing traffic |

**Single container** — SQLite database is a file stored in a Docker volume (`app_data`).

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
               │     ├── Apps (container discovery + tracking)
               │     ├── Server ops (docker, services, actions)
               │     └── Deploy (local detection + remote SSH)
               └── Static assets
```

### Key Design Decisions

| Decision                | Why                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| **Monolith in Docker**  | Single container with embedded SQLite, low complexity, right-sized for a VPS tool            |
| **App Router**          | Route groups: `(auth)` for login, `(panel)` for main panel with sidebar                      |
| **SSE over WebSocket**  | Unidirectional server→client, no separate socket server, auto-reconnect                      |
| **AES-256-GCM**         | Authenticated encryption for SSH credentials; format: `base64(IV + ciphertext + authTag)`    |
| **JWT HttpOnly Cookie** | No tokens in localStorage (XSS-safe), `Secure` + `SameSite: lax`, 7-day TTL                  |
| **Standalone Output**   | `output: "standalone"` + `serverExternalPackages` in next.config.ts for compact Docker image |
| **SSH Auto-Accept**     | ssh2-promise accepts host keys by default for automation                                     |
| **Dual Deploy Mode**    | Local clone for stack detection, or remote SSH deployment with `docker compose`              |

### Directory Structure

```
src/
├── app/                  # Next.js App Router
│   ├── (auth)/           # Route group: login page
│   ├── (panel)/          # Route group: main panel (auth required)
│   │   ├── dashboard/    # Fleet Risk Score, Alert Center, Safe Repair
│   │   ├── servers/      # Local/remote VPS management + detail view
│   │   ├── apps/         # Docker containers + systemd services
│   │   ├── deploy/       # Git, Docker image, and Compose deploy
│   │   ├── network/      # Read-only topology / exposure inspection
│   │   ├── backup/       # Panel DB backup + restore
│   │   ├── audit/        # Audit log
│   │   ├── settings/     # Notifications + security settings
│   │   ├── users/        # Owner/Admin user management
│   │   ├── profile/      # Self-service profile + passcode
│   │   ├── docs/         # In-app user manual
│   │   └── terminal/     # Web terminal for server commands
│   ├── api/              # API Routes (backend)
│   │   ├── auth/         # Login, logout, session, passcode unlock
│   │   ├── profile/      # Self-service profile update
│   │   ├── users/        # User CRUD + passcode reset/disable
│   │   ├── settings/     # Security settings
│   │   ├── stats/        # Host stats + SSE stream
│   │   ├── servers/      # CRUD, sub-routes: stats, docker, services, actions, network, cron, files, ssl
│   │   ├── apps/         # App CRUD + logs, env, health, stream, terminal, actions
│   │   ├── network/      # Host ports + packages
│   │   ├── deploy/       # Clone + detect + deploy (local & remote) + docker + stream
│   │   ├── audit/        # Audit log API
│   │   ├── backup/       # Database backup
│   │   ├── dashboard/    # Summary + SSE stream
│   │   └── notifications/ # Notification channels + alert rules
│   ├── layout.tsx        # Root layout (dark theme)
│   └── globals.css       # Global styles + Tailwind
│
├── components/           # React components
│   ├── ui/               # Button, Card, Input, Badge, Tabs, ConfirmDialog, FileBrowser
│   ├── layout/           # Sidebar, Header
│   ├── dashboard/        # StatsCard, CpuGauge, MemoryBar, DiskUsage, QuickOverview, SummaryCard
│   ├── servers/          # ServerList/Form/Stats, DockerContainerList, QuickActions, ServiceList, SSLChecker
│   ├── network/          # PortTable, PackageManager, NetworkTopology
│   ├── apps/             # AppList, AppLogViewer, AppEnvEditor, AppHealthCheck, AppResourceChart, AppSettings, WebTerminal
│   └── deploy/           # DeployForm, DeployLog, DockerImageDeploy, DockerComposeDeploy
│
├── hooks/                # useAuth, useSSE
├── lib/                  # auth, crypto, db, deployer, server-ssh, ssh, stats
├── middleware.ts          # Auth guard for protected routes
└── types/index.ts        # TypeScript interfaces (38 types)
```

---

## Getting Started (Local Development)

### Prerequisites

| Tool    | Minimum | Verify             |
| ------- | ------- | ------------------ |
| Node.js | 20.x    | `node --version`   |
| npm     | 10.x    | `npm --version`    |
| Docker  | 24.x    | `docker --version` |
| Git     | 2.x     | `git --version`    |

### Setup Steps

```bash
# 1. Clone
git clone https://github.com/Milunice259/vps-assistant-for-no-code-user.git
cd vps-assistant-for-no-code-user

# 2. Install dependencies (auto-runs prisma generate)
npm install

# 3. Create .env
cat > .env << 'EOF'
DATABASE_URL="file:./prisma/dev.db"
JWT_SECRET=dev-jwt-secret-change-in-production-must-be-64-hex-chars-long-ok
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
EOF

# 4. Initialize database
npm run db:push

# 5. Seed admin account
npm run db:seed

# 6. Start dev server
npm run dev
# → http://localhost:3000
```

### Common Commands

| Command             | Description                        |
| ------------------- | ---------------------------------- |
| `npm run dev`       | Start dev server (hot reload)      |
| `npm run build`     | Production build                   |
| `npm run lint`      | ESLint check                       |
| `npm run db:push`   | Create/update database from schema |
| `npm run db:seed`   | Seed initial data                  |
| `npm run db:studio` | Prisma Studio GUI (localhost:5555) |

### URL Map

| URL             | Description                     | Auth? |
| --------------- | ------------------------------- | ----- |
| `/login`        | Login page                      | No    |
| `/dashboard`    | Real-time stats dashboard       | Yes   |
| `/servers`      | VPS server management           | Yes   |
| `/servers/[id]` | Server detail + live stats      | Yes   |
| `/network`      | Read-only network map/inspection | Yes   |
| `/apps`         | Application tracking            | Yes   |
| `/apps/[id]`    | App detail + logs/env/health    | Yes   |
| `/deploy`       | GitHub + Docker deployer        | Yes   |
| `/audit`        | Audit log viewer                | Yes   |
| `/settings`     | Notifications & security settings | Yes   |
| `/users`        | Owner/Admin user management     | Yes   |
| `/profile`      | Self-service profile/passcode   | Yes   |
| `/docs`         | In-app user manual              | Yes   |
| `/terminal`     | Web terminal                    | Yes   |

### Roadmap Status

| Phase | Status | Scope |
| --- | --- | --- |
| Phase 9 — User/Profile/Permission | Done | Roles, server scopes, Users, Profile, password, Quick Unlock Passcode, logout confirm, API permission audit. |
| Phase 10 — Remote VPS E2E + Production Ops | Next | Real remote VPS validation, SSH checks, remote Docker/services/logs smoke, remote deploy E2E, backup/rollback runbooks. |
| Phase 11 — Network Canvas & Network Control Plane | Planned | Interactive inspect, diagnostics, exposure map, safe network actions, dry-run/diff, rollback, audit, remote support. |
| Phase 12 — Advanced Ops / Polish | Planned | Full theme tokens, language/timezone, device/session management, notification preferences, scheduled risk checks. |

Network Canvas is currently read-only / inspection-oriented and is not the Phase 10 control plane.

### Troubleshooting

| Problem                               | Fix                                                               |
| ------------------------------------- | ----------------------------------------------------------------- |
| `Cannot find module '@prisma/client'` | Run `npm run db:generate`                                         |
| Database connection errors            | Check `DATABASE_URL` in `.env` (should be `file:./prisma/dev.db`) |
| `ENCRYPTION_KEY must be 64 hex chars` | Generate with `openssl rand -hex 32`                              |
| Port 3000 in use                      | `PORT=3001 npm run dev`                                           |
| Network page errors on Windows        | Expected — `ss` and `apt` are Linux-only commands                 |

---

## Production Deployment

### Server Requirements

| Requirement | Details                               |
| ----------- | ------------------------------------- |
| OS          | Ubuntu 20.04+ / Debian (recommended)  |
| Root access | Required (the script installs Docker) |
| Domain      | A record pointing to the server IP    |
| RAM         | 1 GB minimum (2 GB recommended)       |
| Disk        | 5 GB minimum                          |

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
5. Generates cryptographic secrets (`JWT_SECRET`, `ENCRYPTION_KEY`)
6. Builds and deploys the app (single container with SQLite)
7. Verifies deployment health

### Manual Deploy

```bash
# Generate secrets
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# Create .env (edit values as needed)
cat > .env << EOF
DOMAIN=panel.example.com
DATABASE_URL=file:/app/data/vpscontrol.db
JWT_SECRET=$JWT_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password
TRAEFIK_NETWORK=traefik
CERT_RESOLVER=letsencrypt
EOF

# Build & start
docker compose up -d --build
```

### Traefik Labels

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.docker.network=${TRAEFIK_NETWORK}"
  - "traefik.http.routers.vps-control.rule=Host(`${DOMAIN}`)"
  - "traefik.http.routers.vps-control.entrypoints=websecure"
  - "traefik.http.routers.vps-control.tls=true"
  - "traefik.http.routers.vps-control.tls.certresolver=${CERT_RESOLVER}"
  - "traefik.http.services.vps-control.loadbalancer.server.port=3000"
  - "traefik.http.routers.vps-control-http.rule=Host(`${DOMAIN}`)"
  - "traefik.http.routers.vps-control-http.entrypoints=web"
  - "traefik.http.routers.vps-control-http.middlewares=vps-https-redirect"
  - "traefik.http.middlewares.vps-https-redirect.redirectscheme.scheme=https"
  - "traefik.http.middlewares.vps-https-redirect.redirectscheme.permanent=true"
```

### Startup Flow

```
docker-entrypoint.sh
    ├─ 1. Initialize SQLite database (prisma db push)
    ├─ 2. Seed admin user (if ADMIN_PASSWORD set)
    └─ 3. Start Next.js (node server.js)
```

### Operations

```bash
# Update
git pull origin main && docker compose up -d --build

# Backup DB
docker cp vps-control-app:/app/data/vpscontrol.db ./backup_$(date +%Y%m%d).db

# Restore DB
docker cp ./backup.db vps-control-app:/app/data/vpscontrol.db

# Monitor
docker stats vps-control-app
docker compose logs -f --tail=100 app
```

### Deployment Troubleshooting

| Problem                 | Fix                                                           |
| ----------------------- | ------------------------------------------------------------- |
| App won't start         | `docker compose logs app` — check for DB/migration/env errors |
| Can't access via domain | Verify DNS (`dig domain`), Traefik logs, network inspect      |
| Database disk full      | `docker system prune -a --volumes`                            |
