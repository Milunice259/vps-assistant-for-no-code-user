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
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/Traefik-24A1C1?style=flat-square&logo=traefikproxy&logoColor=white" alt="Traefik" />
</p>

---

## Why This Exists

Managing a VPS shouldn't require SSH expertise. This app gives you a **web-based control panel** that sits on your server, protected by Traefik reverse proxy with automatic Let's Encrypt certificates. It's built for people who want to manage their infrastructure through a clean UI instead of a terminal.

## Features

| Feature | Description |
|---|---|
| **Real-Time Dashboard** | Live CPU, RAM, and disk monitoring via Server-Sent Events (SSE). No page refresh needed. |
| **Remote Server Management** | Add multiple VPS connections. Monitor them all from one place via SSH. |
| **Network Manager** | View open ports and manage Ubuntu packages directly from the browser. |
| **GitHub Deployer** | Paste a repo URL — the app clones it, detects the tech stack (Next.js, React, Vue, Python, Go...), and prepares deployment. |
| **One-Click Deploy** | A single `deploy.sh` script that detects Traefik, generates secrets, and brings everything up. |
| **Encrypted Credentials** | SSH passwords and private keys are encrypted with **AES-256-GCM** before touching the database. |
| **JWT Authentication** | Session-based auth with bcrypt password hashing and HttpOnly cookies. |

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
              │  (App + API)    │
              └────────┬────────┘
                       │ internal network (private bridge)
                       ▼
              ┌─────────────────┐
              │   PostgreSQL    │  ← Never exposed to internet
              │   (Encrypted)   │
              └─────────────────┘
```

**Key design decisions:**

- The app joins **two Docker networks**: Traefik's external network for ingress, and a private bridge network for database access.
- PostgreSQL has **no Traefik labels** and lives only on the private network.
- Sensitive data (SSH keys, passwords) is encrypted at the application layer with AES-256-GCM before being stored.
- Host keys are **auto-accepted** for SSH connections to enable fully automated VPS management.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (App Router, Server Components) |
| Frontend | React 19, Tailwind CSS, Recharts, Lucide Icons |
| Backend | Next.js API Routes, Server-Sent Events |
| Database | PostgreSQL 16 (Alpine) via Prisma ORM |
| Auth | bcrypt + JWT (jose) in HttpOnly cookies |
| SSH | ssh2-promise (auto-accept host keys) |
| Encryption | AES-256-GCM (Node.js crypto) |
| Proxy | Traefik with automatic TLS |
| Container | Docker + Docker Compose |

## Quick Start

### One-Click Deploy (Production)

> **Prerequisites:** A Linux VPS with Docker, Docker Compose V2, and Traefik already running.

```bash
# Clone the repo
git clone https://github.com/Milunice259/vps-assistant-for-no-code-user.git
cd vps-assistant-for-no-code-user

# Run the deploy script
chmod +x deploy.sh
./deploy.sh
```

The script will interactively:

1. **Detect** your Traefik network automatically
2. **Ask** for your domain and cert resolver
3. **Generate** all cryptographic secrets (DB password, JWT secret, AES-256 key)
4. **Write** the `.env` file
5. **Build and start** everything with `docker compose up -d --build`

After deployment, visit `https://your-domain.com` and log in with the admin credentials you provided.

### Local Development

```bash
# Install dependencies
npm install

# Start a local PostgreSQL
docker run -d --name vps-pg \
  -e POSTGRES_PASSWORD=dev \
  -e POSTGRES_DB=vpscontrol \
  -e POSTGRES_USER=vpscontrol \
  -p 5432:5432 \
  postgres:16-alpine

# Create .env with required variables (see Environment Variables section)
# Or run deploy.sh which generates it automatically

# Run migrations and seed the admin user
npx prisma migrate dev
npm run db:seed

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
.
├── deploy.sh                  # One-click production deploy script
├── docker-compose.yml         # App + DB + Traefik labels
├── docker-entrypoint.sh       # Waits for DB, runs migrations, starts app
├── Dockerfile                 # Multi-stage: deps → build → runner
├── prisma/
│   └── schema.prisma          # User, Server, DeploymentLog models
├── scripts/
│   ├── seed.ts                # Creates default admin user
│   └── wait-for-db.js         # TCP probe for DB readiness
└── src/
    ├── middleware.ts           # Auth guard for protected routes
    ├── app/
    │   ├── (auth)/login/       # Login page
    │   ├── (panel)/            # Protected panel pages
    │   │   ├── dashboard/      # Real-time host stats (SSE)
    │   │   ├── servers/        # Remote VPS management
    │   │   ├── network/        # Ports + package management
    │   │   └── deploy/         # GitHub deployer
    │   └── api/                # API route handlers
    │       ├── auth/           # Login, logout, session
    │       ├── stats/          # Host stats + SSE stream
    │       ├── servers/        # CRUD + remote stats via SSH
    │       ├── network/        # Ports + packages
    │       └── deploy/         # Clone + detect + deploy
    ├── lib/
    │   ├── auth.ts             # JWT sessions + bcrypt
    │   ├── crypto.ts           # AES-256-GCM encrypt/decrypt
    │   ├── db.ts               # Prisma client singleton
    │   ├── deployer.ts         # Git clone + stack detection
    │   ├── ssh.ts              # SSH2 wrapper (auto-accept keys)
    │   └── stats.ts            # Host system stats (os module)
    ├── components/             # UI components (dark theme)
    ├── hooks/                  # useSSE, useAuth
    └── types/                  # Shared TypeScript interfaces
```

## Environment Variables

| Variable | Description | Example |
|---|---|---|
| `DOMAIN` | Your domain pointing to the server | `vps.example.com` |
| `CERT_RESOLVER` | Traefik certificate resolver name | `letsencrypt` |
| `TRAEFIK_NETWORK` | Name of your Traefik Docker network | `traefik` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@db:5432/vpscontrol` |
| `JWT_SECRET` | 64-char hex string for signing tokens | *(generated by deploy.sh)* |
| `ENCRYPTION_KEY` | 64-char hex string for AES-256-GCM | *(generated by deploy.sh)* |
| `ADMIN_USERNAME` | Default admin username | `admin` |
| `ADMIN_PASSWORD` | Default admin password | *(set during deploy)* |

> All secrets are **auto-generated** by `deploy.sh`. You only need to provide domain, cert resolver, and admin credentials.

## Security

- **Encryption at rest:** SSH passwords and private keys are encrypted with AES-256-GCM before database storage.
- **No plaintext secrets:** JWT secret and encryption key are generated with `openssl rand -hex 32`.
- **HttpOnly cookies:** Session tokens are stored in secure, HttpOnly cookies — not accessible to JavaScript.
- **Network isolation:** PostgreSQL is on a private Docker bridge network with no external exposure.
- **Non-root container:** The production image runs as a dedicated `nextjs` user (UID 1001).
- **DB readiness gate:** The entrypoint waits for PostgreSQL before running Prisma migrations, preventing race conditions.

## Useful Commands

```bash
# View logs
docker compose logs -f

# View only app logs
docker compose logs -f app

# Access the database
docker compose exec db psql -U vpscontrol vpscontrol

# Backup the database
docker compose exec db pg_dump -U vpscontrol vpscontrol > backup.sql

# Restart after code changes
docker compose up -d --build

# Stop everything
docker compose down

# Stop and remove data (destructive!)
docker compose down -v
```

## License

MIT

---

<p align="center">
  Built for people who manage servers, not for people who memorize terminal commands.
</p>
