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
| **Real-Time Dashboard**      | Live CPU, RAM, and disk monitoring via Server-Sent Events (SSE). Quick Overview with app/server/port counts.          |
| **Remote Server Management** | Add multiple VPS connections. Monitor stats, Docker containers, systemd services, and network topology — all via SSH. |
| **App Tracking**             | Auto-discover Docker containers across servers. Health checks, resource charts, env editor, per-app terminal.         |
| **Network Manager**          | View open ports (Listening/Established tabs), Docker network topology, and manage packages from the browser.          |
| **Multi-Mode Deployer**      | Deploy via Git repo, Docker image, or Docker Compose — locally or to a remote server. Deployment rollback support.    |
| **Web Terminal**             | Browser-based terminal with server selector, command history, and relaxed allowlist for 30+ Linux commands.           |
| **Database Backups**         | Create, restore, and delete database snapshots from the browser. Auto pre-restore backup.                             |
| **Audit Log**                | Search, filter by action/date range, and export to CSV. Track all admin actions with timestamps and details.          |
| **Notifications**            | Discord, Slack, Telegram, and Email channels with configurable alert rules (CPU, memory, disk thresholds).            |
| **Crash Detection**          | Automatic container crash loop detection (3+ restarts in 5 min) with broadcast alerts.                                |
| **Command Palette**          | `Ctrl+K` / `⌘K` to quickly navigate across all pages with fuzzy search and keyboard shortcuts.                        |
| **i18n (EN/VI)**             | Internationalization support with English and Vietnamese. Auto-detects browser language.                              |
| **Quick Actions**            | One-click server maintenance: health check, security audit, OS update, docker prune, and 20+ more.                    |
| **SSL Checker**              | Verify SSL/TLS certificate status for each managed server.                                                            |
| **One-Click Deploy**         | A single `deploy.sh` script that detects Traefik, generates secrets, and brings everything up.                        |
| **Encrypted Credentials**    | SSH passwords and private keys are encrypted with **AES-256-GCM** before touching the database.                       |
| **JWT Authentication**       | 24h session with auto-refresh at 12h. bcrypt password hashing. HttpOnly secure cookies.                               |

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
- **Modular SSH architecture** — split into 7 focused modules with a connection pool (5-min TTL, max 10 connections).

## Tech Stack

| Layer      | Technology                                     |
| ---------- | ---------------------------------------------- |
| Framework  | Next.js 16 (App Router, Server Components)     |
| Frontend   | React 19, Tailwind CSS, Recharts, Lucide Icons |
| Backend    | Next.js API Routes, Server-Sent Events         |
| Database   | SQLite (WAL mode) via Prisma ORM               |
| Auth       | bcrypt + JWT (jose) with auto-refresh          |
| SSH        | ssh2-promise with connection pooling           |
| Encryption | AES-256-GCM (Node.js crypto)                   |
| i18n       | Lightweight React Context (EN/VI)              |
| Testing    | Vitest (87 tests across 6 files)               |
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
│   └── schema.prisma          # User, Server, DeploymentLog, App, AuditLog, etc.
├── scripts/
│   └── seed.ts                # Creates default admin user
└── src/
    ├── middleware.ts           # Auth guard for protected routes
    ├── app/
    │   ├── (auth)/login/       # Login page
    │   ├── (panel)/            # Protected panel pages
    │   │   ├── dashboard/      # Real-time host stats (SSE)
    │   │   ├── servers/        # Remote VPS management
    │   │   ├── network/        # Ports + Docker topology
    │   │   ├── apps/           # Application tracking
    │   │   ├── deploy/         # GitHub deployer
    │   │   ├── backup/         # Database backup management
    │   │   ├── audit/          # Audit log viewer
    │   │   ├── terminal/       # Web terminal
    │   │   ├── users/          # User management
    │   │   └── settings/       # App settings
    │   └── api/                # API route handlers
    │       ├── auth/           # Login, logout, session
    │       ├── dashboard/      # Host stats + SSE stream
    │       ├── servers/        # CRUD + stats + docker + services + actions
    │       ├── apps/           # App CRUD + container logs + SSE streams
    │       ├── network/        # Ports + packages
    │       ├── deploy/         # Clone + detect + deploy + rollback
    │       ├── audit/          # Audit log API
    │       ├── backup/         # Database backup CRUD
    │       ├── users/          # User CRUD
    │       └── notifications/  # Notification management
    ├── lib/
    │   ├── ssh/                # Modular SSH system (7 files)
    │   │   ├── connection.ts   # SSH connect, close, execute
    │   │   ├── stats.ts        # Remote stats + OS details
    │   │   ├── containers.ts   # Docker + services + actions
    │   │   ├── network.ts      # Docker networks + host ports
    │   │   ├── actions.ts      # Quick actions + remote deploy
    │   │   ├── pool.ts         # Connection pool (5min TTL, max 10)
    │   │   └── index.ts        # Re-exports (zero breaking changes)
    │   ├── audit.ts            # Audit logging utility
    │   ├── auth.ts             # JWT sessions + bcrypt + auto-refresh
    │   ├── crash-detector.ts   # Container crash loop detection
    │   ├── crypto.ts           # AES-256-GCM encrypt/decrypt
    │   ├── db.ts               # Prisma client singleton
    │   ├── deployer.ts         # Git clone + stack detection
    │   ├── email.ts            # Email notification via HTTP API
    │   ├── i18n.tsx            # Internationalization (EN/VI)
    │   ├── notifications.ts    # Webhook notifications (Discord/Slack/Telegram/Email)
    │   ├── safe-error.ts       # Error message sanitization
    │   ├── sanitize.ts         # Log sanitization (redact secrets)
    │   ├── sse-stream.ts       # Server-Sent Events stream helper
    │   ├── stats.ts            # Host system stats (os module)
    │   └── validation.ts       # Input validation for all user inputs
    ├── components/             # UI components (dark theme)
    │   ├── ui/                 # Button, Card, Input, Badge, Tabs, ConfirmDialog, CommandPalette
    │   ├── layout/             # Sidebar, Header, Breadcrumbs
    │   ├── dashboard/          # StatsCard, CpuGauge, MemoryBar, DiskUsage, OnboardingWizard
    │   ├── servers/            # ServerList/Form/Stats, DockerContainerList, QuickActions
    │   ├── network/            # PortTable, PackageManager, NetworkTopology
    │   ├── apps/               # AppList, AppLogViewer, AppEnvEditor, AppHealthCheck
    │   └── deploy/             # DeployForm, DeployLog, DockerImageDeploy
    ├── locales/                # i18n translation files
    │   ├── en.json             # English (61 keys)
    │   └── vi.json             # Vietnamese (61 keys)
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
| `SMTP_HOST`       | Email notification endpoint (HTTP)    | `https://api.sendgrid.com/...` |
| `SMTP_PASS`       | Email API key / SMTP password         | _(optional)_                   |
| `SMTP_FROM`       | Sender email address                  | `noreply@example.com`          |

> All secrets are **auto-generated** by `deploy.sh`. You only need to provide domain, cert resolver, and admin credentials.

## Security

- **Encryption at rest:** SSH passwords and private keys are encrypted with AES-256-GCM before database storage.
- **No plaintext secrets:** JWT secret and encryption key are generated with `openssl rand -hex 32`.
- **HttpOnly cookies:** Session tokens are stored in secure, HttpOnly cookies — not accessible to JavaScript.
- **JWT auto-refresh:** 24h session lifespan with automatic silent refresh at 12h. Sliding window reduces re-login friction.
- **API rate limiting:** 100 requests/min/IP globally. Backup operations limited to 5/min/IP.
- **Account lockout:** 5 failed login attempts trigger 15-minute lockout.
- **HSTS headers:** `Strict-Transport-Security` enforced in production.
- **CSRF protection:** Null-origin bypass prevented.
- **Non-root container:** The production image runs as a dedicated `nextjs` user (UID 1001).
- **Embedded database:** SQLite runs inside the app container in WAL mode — no external database port to attack.
- **Input validation:** All user inputs validated and sanitized. SSH commands parameterized.

## Testing

```bash
# Run all tests (87 tests across 6 files)
npx vitest run

# Run in watch mode
npx vitest
```

| Test File            | Tests | Coverage                            |
| -------------------- | ----- | ----------------------------------- |
| `validation.test.ts` | 46    | Input validation, repo URLs, paths  |
| `safe-error.test.ts` | 11    | Error message sanitization          |
| `sanitize.test.ts`   | 6     | Secret redaction in logs            |
| `sse-stream.test.ts` | 8     | Server-Sent Events stream protocol  |
| `crypto.test.ts`     | 9     | AES-256-GCM encrypt/decrypt         |
| `auth.test.ts`       | 7     | Password hashing, JWT create/verify |

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

## Keyboard Shortcuts

| Shortcut                     | Action                |
| ---------------------------- | --------------------- |
| `Ctrl+K` / `⌘K`              | Open Command Palette  |
| `↑` `↓` (in Command Palette) | Navigate results      |
| `Enter` (in Command Palette) | Open selected page    |
| `Escape`                     | Close Command Palette |

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
