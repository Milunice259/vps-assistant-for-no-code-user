# Architecture Overview

> A comprehensive overview of the VPS Control App system design, technical decisions, and how all components connect.

---

## System Diagram

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

## Docker Network Layout

The system uses two Docker networks to enforce isolation:

| Network            | Type     | Purpose                                              |
| ------------------ | -------- | ---------------------------------------------------- |
| `traefik_network`  | External | Connects the app to Traefik for internet-facing traffic |
| `internal`         | Bridge   | Private link between the app and PostgreSQL           |

**Key principle:** PostgreSQL lives only on the `internal` network, completely isolated from the internet. Only the Next.js app (which sits on both networks) can access the database.

## Request Flow

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

## Key Design Decisions

### 1. Monolith in Docker

The entire app (frontend + API) runs inside a single Next.js container. Reasons:

- **Simple deployment** — only 2 containers (app + db)
- **Low complexity** — no message queues, no separate API gateway
- **Right-sized** — this is a VPS management tool, not a multi-tenant SaaS

### 2. Next.js App Router

Uses the App Router (not Pages Router) with route groups:

- `(auth)` — Layout for the login page (no sidebar)
- `(panel)` — Main layout with sidebar + header (requires authentication)

### 3. Server-Sent Events over WebSocket

The dashboard uses SSE to stream real-time stats. Reasons:

- **Unidirectional** — server → client, perfect for monitoring
- **Simple** — no separate socket server needed, runs on an API route
- **Compatible** — works over HTTP/2, not blocked by firewalls
- **Auto-reconnect** — the `EventSource` API reconnects automatically on disconnect

### 4. AES-256-GCM for Sensitive Data

Instead of storing plaintext SSH credentials in the database, everything is encrypted:

- **Algorithm:** AES-256-GCM (authenticated encryption)
- **Format:** `base64(IV[16] + ciphertext + authTag[16])`
- **Key:** `ENCRYPTION_KEY` environment variable (32 bytes hex)

See [SECURITY.md](./SECURITY.md) and [DATABASE.md](./DATABASE.md) for details.

### 5. JWT with HttpOnly Cookie

No tokens in localStorage (vulnerable to XSS):

- JWT is stored in an **HttpOnly cookie** — JavaScript cannot read it
- `Secure` flag is set in production — only sent over HTTPS
- `SameSite: lax` — basic CSRF protection
- TTL: 7 days

### 6. Standalone Output for Docker

`next.config.ts` uses `output: "standalone"` so Next.js produces a compact folder with everything needed to run, without copying the full `node_modules`.

### 7. SSH Host Key Auto-Accept

`ssh2-promise` accepts all host keys by default when no `hostVerifier` callback is provided. This is an intentional decision for automation — when connecting to a new VPS, no manual confirmation is needed.

## Directory Structure

```
src/
├── app/                  # Next.js App Router
│   ├── (auth)/           # Route group: login page
│   ├── (panel)/          # Route group: main panel (auth required)
│   ├── api/              # API Routes (backend)
│   ├── layout.tsx        # Root layout (dark theme)
│   ├── globals.css       # Global styles + Tailwind
│   └── page.tsx          # Root → redirect to /dashboard
│
├── components/           # React components
│   ├── dashboard/        # Gauges, bars, cards for stats
│   ├── deploy/           # Form + log for deployments
│   ├── layout/           # Sidebar, Header
│   ├── network/          # Port table, Package manager
│   ├── servers/          # CRUD + stats for servers
│   └── ui/               # Primitives: Button, Card, Input, Badge
│
├── hooks/                # Custom React hooks
│   ├── useAuth.ts        # Authentication hook
│   └── useSSE.ts         # Server-Sent Events hook
│
├── lib/                  # Backend utilities
│   ├── auth.ts           # JWT + bcrypt + cookie management
│   ├── crypto.ts         # AES-256-GCM encrypt/decrypt
│   ├── db.ts             # Prisma client singleton
│   ├── deployer.ts       # Git clone + stack detection
│   ├── ssh.ts            # SSH connection wrapper
│   └── stats.ts          # Host system stats (os module)
│
├── middleware.ts          # Auth guard for protected routes
│
└── types/                # TypeScript interfaces
    └── index.ts          # SystemStats, ServerInfo, PortInfo, etc.
```

## Tech Stack

| Layer        | Technology               | Version   | Notes                             |
| ------------ | ------------------------ | --------- | --------------------------------- |
| Framework    | Next.js                  | 16 (LTS)  | App Router, standalone output     |
| UI           | React                    | 19.2      | Server + Client Components        |
| Language     | TypeScript               | 5.7+      | Strict mode                       |
| Styling      | Tailwind CSS             | 3.4       | Dark theme, custom brand colors   |
| Database     | PostgreSQL               | 16        | Alpine Docker image               |
| ORM          | Prisma                   | Latest    | Type-safe queries, migrations     |
| Auth         | jose + bcryptjs          | 5.0 / 2.4 | JWT HS256, bcrypt 12 rounds      |
| SSH          | ssh2-promise             | 1.0.3     | Remote VPS management             |
| Icons        | lucide-react             | 0.500+    | Consistent icon set               |
| Charts       | recharts                 | 2.15      | Dashboard visualizations          |
| Proxy        | Traefik                  | External  | TLS, routing, load balancing      |
| Container    | Docker + Compose         | —         | Multi-stage builds                |
