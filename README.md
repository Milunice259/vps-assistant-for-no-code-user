<p align="center">
  <img src="https://img.icons8.com/fluency/96/server.png" alt="VPS Control App" width="80" />
</p>

<h1 align="center">VPS Control App</h1>

<p align="center">
  <strong>A self-hosted VPS management panel for non-technical users.</strong><br/>
  Monitor servers, manage networks, and deploy apps from GitHub — all behind Traefik with automatic HTTPS.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-black?style=flat-square&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/React_19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/Traefik-24A1C1?style=flat-square&logo=traefikproxy&logoColor=white" alt="Traefik" />
</p>

---

## Why This Exists

Managing a VPS shouldn't require SSH expertise. This app gives you a **web-based control panel** that sits on your server, protected by Traefik reverse proxy with automatic Let's Encrypt certificates. It's built for people who want to manage their infrastructure through a clean UI instead of a terminal.

## Features

| Feature                      | Description                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Real-Time Dashboard**      | Live CPU, RAM, and disk monitoring via Server-Sent Events (SSE). No page refresh needed.                              |
| **Remote Server Management** | Add multiple VPS connections. Monitor stats, Docker containers, systemd services, and network topology — all via SSH. |
| **App Tracking**             | Auto-discover Docker containers across servers. Track, monitor status, and view logs from one panel.                  |
| **Network Manager**          | View open ports, Docker network topology, and manage Ubuntu packages directly from the browser.                       |
| **GitHub Deployer**          | Paste a repo URL — deploy locally for stack detection or remotely via SSH with `docker compose`.                      |
| **Web Terminal**             | Browser-based terminal for executing commands on managed servers via SSH.                                             |
| **Audit Log**                | Track all administrative actions — server changes, deployments, container operations — with timestamps and details.   |
| **Quick Actions**            | One-click server maintenance: `apt update`, `docker prune`, `restart docker` on any managed server.                   |
| **One-Click Deploy**         | A single `deploy.sh` script that detects Traefik, generates secrets, and brings everything up.                        |
| **Encrypted Credentials**    | SSH passwords and private keys are encrypted with **AES-256-GCM** before touching the database.                       |
| **JWT Authentication**       | Session-based auth with bcrypt password hashing and HttpOnly cookies.                                                 |

## Architecture

```
                    Internet
                       │
                       ▼
               ┌───────────────┐
               │    Traefik    │  ← Existing reverse proxy on host
               │  (HTTPS/TLS) │
               └───────┬───────┘
                       │ traefik_network (external)
                       ▼
              ┌─────────────────┐
              │  Next.js App    │  ← Port 3000 (internal)
              │  (App + API)    │     SQLite DB embedded
              │  + SQLite DB    │     inside Docker volume
              └─────────────────┘
```

**Key design decisions:**

- **Single container** with embedded SQLite — no separate database container needed.
- Sensitive data (SSH keys, passwords) is encrypted at the application layer with AES-256-GCM before being stored.
- Host keys are **auto-accepted** for SSH connections to enable fully automated VPS management.

## Tech Stack

| Layer      | Technology                                     |
| ---------- | ---------------------------------------------- |
| Framework  | Next.js (App Router, Server Components)        |
| Frontend   | React 19, Tailwind CSS, Recharts, Lucide Icons |
| Backend    | Next.js API Routes, Server-Sent Events         |
| Database   | SQLite (embedded) via Prisma ORM               |
| Auth       | bcrypt + JWT (jose) in HttpOnly cookies        |
| SSH        | ssh2-promise (auto-accept host keys)           |
| Encryption | AES-256-GCM (Node.js crypto)                   |
| Proxy      | Traefik with automatic TLS                     |
| Container  | Docker + Docker Compose                        |

## Quick Start

### One-Click Deploy (Production)

> **Prerequisites:** A Linux VPS (Ubuntu/Debian recommended) with root access. The script installs everything else automatically.

```bash
# Clone the repo
git clone https://github.com/Milunice259/vps-assistant-for-no-code-user.git /opt/vps-panel
cd /opt/vps-panel

# Run the deploy script
chmod +x deploy.sh
./deploy.sh
```

The script will automatically:

1. **Check** system requirements (RAM, disk, internet)
2. **Install** Docker, Docker Compose, and firewall rules
3. **Setup** Traefik reverse proxy (detects existing or creates new)
4. **Ask** for your domain, admin credentials
5. **Generate** cryptographic secrets (JWT secret, AES-256 key)
6. **Build and deploy** the app (single container with SQLite)
7. **Verify** everything is running

After deployment, visit `https://your-domain.com` and log in with the admin credentials you provided.

### Local Development

```bash
# Install dependencies
npm install

# Create .env
cat > .env << 'EOF'
DATABASE_URL="file:./prisma/dev.db"
JWT_SECRET=dev-jwt-secret-change-in-production-must-be-64-hex-chars-long-ok
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
EOF

# Initialize database and seed admin
npm run db:push
npm run db:seed

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
.
├── deploy.sh                  # One-click production deploy script
├── docker-compose.yml         # Single container + Traefik labels
├── docker-entrypoint.sh       # Init SQLite, seed admin, start app
├── Dockerfile                 # Multi-stage: deps → build → runner
├── prisma/
│   └── schema.prisma          # User, Server, DeploymentLog, App models
├── scripts/
│   └── seed.ts                # Creates default admin user
└── src/
    ├── middleware.ts           # Auth guard for protected routes
    ├── app/
    │   ├── (auth)/login/       # Login page
    │   ├── (panel)/            # Protected panel pages
    │   │   ├── dashboard/      # Real-time host stats (SSE)
    │   │   ├── servers/        # Remote VPS management
    │   │   ├── network/        # Ports + package management
    │   │   ├── apps/           # Application tracking
    │   │   ├── deploy/         # GitHub deployer
    │   │   ├── audit/          # Audit log viewer
    │   │   ├── terminal/       # Web terminal
    │   │   └── settings/       # App settings
    │   └── api/                # API route handlers
    │       ├── auth/           # Login, logout, session
    │       ├── dashboard/      # Host stats + SSE stream
    │       ├── servers/        # CRUD + stats + docker + services + actions
    │       ├── apps/           # App CRUD + container logs + SSE streams
    │       ├── network/        # Ports + packages
    │       ├── deploy/         # Clone + detect + deploy (local & remote)
    │       ├── audit/          # Audit log API
    │       ├── backup/         # Database backup
    │       └── notifications/  # Notification management
    ├── lib/
    │   ├── api-handler.ts      # Shared API route handler wrapper
    │   ├── audit.ts            # Audit logging utility
    │   ├── auth.ts             # JWT sessions + bcrypt
    │   ├── crypto.ts           # AES-256-GCM encrypt/decrypt
    │   ├── db.ts               # Prisma client singleton
    │   ├── deployer.ts         # Git clone + stack detection
    │   ├── local-server.ts     # Local VPS auto-detection
    │   ├── notifications.ts    # Notification system
    │   ├── sanitize.ts         # Log sanitization (redact secrets)
    │   ├── server-ssh.ts       # Per-server SSH connection helper
    │   ├── sse-stream.ts       # Server-Sent Events stream helper
    │   ├── ssh.ts              # SSH2 wrapper + remote ops
    │   ├── stats.ts            # Host system stats (os module)
    │   └── validation.ts       # Input validation for all user inputs
    ├── components/             # UI components (dark theme)
    │   ├── ui/                 # Button, Card, Input, Badge, Tabs, ConfirmDialog
    │   ├── layout/             # Sidebar, Header
    │   ├── dashboard/          # StatsCard, CpuGauge, MemoryBar, DiskUsage
    │   ├── servers/            # ServerList/Form/Stats, DockerContainerList, QuickActions, ServiceList
    │   ├── network/            # PortTable, PackageManager, NetworkTopology
    │   ├── apps/               # AppList, AppLogViewer
    │   └── deploy/             # DeployForm, DeployLog
    ├── hooks/                  # useSSE, useAuth
    └── types/                  # Shared TypeScript interfaces
```

## Environment Variables

| Variable          | Description                           | Example                        |
| ----------------- | ------------------------------------- | ------------------------------ |
| `DOMAIN`          | Your domain pointing to the server    | `vps.example.com`              |
| `CERT_RESOLVER`   | Traefik certificate resolver name     | `letsencrypt`                  |
| `TRAEFIK_NETWORK` | Name of your Traefik Docker network   | `traefik`                      |
| `DATABASE_URL`    | SQLite file path                      | `file:/app/data/vpscontrol.db` |
| `JWT_SECRET`      | 64-char hex string for signing tokens | _(generated by deploy.sh)_     |
| `ENCRYPTION_KEY`  | 64-char hex string for AES-256-GCM    | _(generated by deploy.sh)_     |
| `ADMIN_USERNAME`  | Default admin username                | `admin`                        |
| `ADMIN_PASSWORD`  | Default admin password                | _(set during deploy)_          |

> All secrets are **auto-generated** by `deploy.sh`. You only need to provide domain, cert resolver, and admin credentials.

## Security

- **Encryption at rest:** SSH passwords and private keys are encrypted with AES-256-GCM before database storage.
- **No plaintext secrets:** JWT secret and encryption key are generated with `openssl rand -hex 32`.
- **HttpOnly cookies:** Session tokens are stored in secure, HttpOnly cookies — not accessible to JavaScript.
- **Non-root container:** The production image runs as a dedicated `nextjs` user (UID 1001).
- **Embedded database:** SQLite runs inside the app container — no external database port to attack.

## Useful Commands

```bash
# View logs
docker compose logs -f

# View only app logs
docker compose logs -f app

# Backup the database
docker cp vps-control-app:/app/data/vpscontrol.db ./backup.db

# Restore from backup
docker cp ./backup.db vps-control-app:/app/data/vpscontrol.db

# Restart after code changes
docker compose up -d --build

# Stop everything
docker compose down

# Stop and remove data (destructive!)
docker compose down -v
```

## Documentation

Full documentation is available in the [`docs/`](./docs/) directory:

| Document                                       | Description                                           |
| ---------------------------------------------- | ----------------------------------------------------- |
| [README](./docs/README.md)                     | Architecture, local setup, and production deployment  |
| [API & Database](./docs/API-AND-DATABASE.md)   | All endpoints, schema, encryption, and security model |
| [Capabilities](./docs/CAPABILITIES-SUMMARY.md) | Complete list of implemented features and constraints |
| [Development](./docs/DEVELOPMENT.md)           | Components, hooks, code conventions, and contributing |

## License

MIT

---

<p align="center">
  Built for people who manage servers, not for people who memorize terminal commands.
</p>
