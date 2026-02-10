# VPS Control App - Capabilities Summary

> Complete list of implemented capabilities in the current codebase.

---

## Product Scope

VPS Control App is a web control panel for:
- managing remote VPS connection profiles,
- monitoring host and remote server health,
- running Linux host network/package checks,
- and bootstrap-deploying the panel itself with Docker + Traefik.

It is designed for single-team/single-admin operation with a simple deployment model.

---

## 1) Authentication and Session

- Username/password login (`/api/auth/login`)
- Logout (`/api/auth/logout`)
- Current user endpoint (`/api/auth/me`)
- JWT session cookie (`vps-session`, HttpOnly, Secure, SameSite=Lax, 7-day expiry)
- Route protection middleware for panel pages and API routes

**Constraints**
- Single-admin style model (no RBAC/roles)
- No 2FA
- No login rate limiting

---

## 2) Dashboard and System Monitoring (Host)

- Dashboard page with host status cards/charts
- Snapshot host metrics API (`/api/stats`)
- Real-time host metrics stream via SSE (`/api/stats/stream`)
- CPU, memory, disk, uptime, hostname, OS reporting

**Constraints**
- Disk/port/package collection depends on Linux tools (`df`, `ss`, `apt`)
- On non-Linux hosts some values can be unavailable or zero

---

## 3) Remote Server Management (via SSH)

- Create/list/update/delete server profiles
- Store host, port, username, auth method (password or SSH key)
- Encrypt sensitive credentials at rest (AES-256-GCM)
- Per-server live stats endpoint (`/api/servers/[id]/stats`) over SSH
- Server activation toggles and last connection timestamps

**Constraints**
- Remote stats commands are Linux-oriented
- SSH host keys are auto-accepted (automation convenience, lower strictness)
- Requires reachable SSH and valid credentials

---

## 4) Network and Package Operations (Host-Level)

- List listening ports (`/api/network/ports`)
- List installed/upgradable packages (`/api/network/packages`)
- Trigger package metadata update (`apt update`)
- Trigger package upgrades (all or selected packages)

**Constraints**
- Runs on the app host/container context, not inside added remote servers
- Linux + apt required

---

## 5) Deployment Workflow in App UI

- Submit Git repository deployment requests from panel (`/api/deploy`)
- Stack detection for common frameworks (Next.js, React, Vue, Nuxt, Node, Python, Go, Rust, static)
- Deployment history with status and logs
- Persistent deployment log records in DB

**Constraints**
- Current implementation is clone + detect + log oriented
- It does not fully orchestrate production hosting for arbitrary repos

---

## 6) VPS Bootstrap Deployment (deploy.sh)

- Guided server bootstrap script for new VPS
- System checks (OS, RAM, disk, internet)
- Installs Docker, Docker Compose, UFW
- Configures firewall (22/80/443)
- Detects/uses existing Traefik or provisions new Traefik
- Generates `.env` (domain, resolver, admin, secrets, network)
- Builds and starts app container
- Verifies deployment status and reports clear failure/success

**Constraints**
- Intended for Ubuntu/Debian with root/sudo
- Domain DNS must point to server IP for public HTTPS
- Existing shared Traefik environments require matching resolver/network

---

## 7) Docker, Traefik, and TLS Integration

- Single app container (`vps-control-app`) with Next.js standalone runtime
- SQLite persisted in Docker volume (`app_data`)
- Traefik labels for domain routing and HTTPS
- HTTP-to-HTTPS redirect middleware
- Configurable certificate resolver (`CERT_RESOLVER`)
- Explicit Traefik docker network label for backend IP resolution

**Constraints**
- TLS certificate validity depends on correct Traefik resolver and DNS
- If Traefik is externally managed, resolver name must match that Traefik instance

---

## 8) Database and Data Model

- SQLite database with Prisma ORM
- Startup auto-sync (`prisma db push`)
- Optional startup admin seed in entrypoint
- Core entities: `User`, `Server`, `DeploymentLog`

**Constraints**
- SQLite is simple and lightweight but not for high write concurrency at scale

---

## 9) Security Controls (Implemented)

- Password hashing with bcryptjs
- JWT auth cookie (HttpOnly + Secure)
- AES-256-GCM encryption for stored SSH credentials
- Input validation/sanitization in API handlers and scripts
- Firewall and reverse-proxy TLS setup in deploy automation

**Known Gaps**
- No 2FA
- No account lockout/rate limit for login
- No fine-grained RBAC/audit trail

---

## 10) Operational Tasks Supported

- App logs via Docker Compose
- Restart/stop/update with script and compose commands
- SQLite backup via `docker cp` from container volume path
- Re-deploy and reconfigure through `deploy.sh`

---

## Quick Capability Matrix

| Area | Implemented | Notes |
| --- | --- | --- |
| Auth + sessions | Yes | JWT cookie, single-admin model |
| Dashboard monitoring | Yes | Host metrics + SSE |
| Remote SSH server stats | Yes | Linux commands over SSH |
| Server profile CRUD | Yes | Encrypted secrets |
| Host port/package management | Yes | Linux/apt only |
| Panel-driven repo deployment | Partial | Detection/logging focused |
| VPS bootstrap automation | Yes | deploy.sh end-to-end |
| Traefik HTTPS routing | Yes | Requires correct DNS/resolver |
| SQLite persistence | Yes | Volume-backed |

---

## Intended Audience

This summary is for operators and maintainers who need a quick, reliable map of what the app can do today, including important platform constraints and operational caveats.

