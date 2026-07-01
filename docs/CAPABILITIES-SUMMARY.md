# VPS Control App — Capabilities Summary

> Complete list of implemented capabilities in the current codebase.  
> Last updated: February 2026 (Post-audit, all P0–P4 fixes applied)

---

## Product Scope

VPS Control App is a web control panel for:

- managing remote VPS connection profiles,
- monitoring host and remote server health,
- running Linux host network/package checks,
- deploying applications from GitHub to remote servers,
- managing database backups from the browser,
- and bootstrap-deploying the panel itself with Docker + Traefik.

It is designed for single-team/admin operation with a simple deployment model.

---

## 1) Authentication and Session

- Username/password login (`/api/auth/login`)
- Logout (`/api/auth/logout`)
- Current user endpoint (`/api/auth/me`)
- JWT session cookie (`vps-session`, HttpOnly, Secure, SameSite=Lax, **24-hour expiry**)
- **Auto-refresh**: sessions silently refresh when past 50% of lifespan (12h)
- Route protection middleware for panel pages and API routes
- **Account lockout**: 5 failed attempts → 15-minute lockout
- **API rate limiting**: 100 requests/min/IP globally

---

## 2) Dashboard and System Monitoring (Host)

- Dashboard page with host status cards/charts
- Snapshot host metrics API (`/api/stats`)
- Real-time host metrics stream via SSE (`/api/stats/stream`)
- CPU, memory, disk, uptime, hostname, OS reporting
- **Quick Overview**: app/server/port count summary cards
- **Onboarding Wizard**: 3-step guide for first-time users

**Constraints**

- Disk/port/package collection depends on Linux tools (`df`, `ss`, `apt`)
- On non-Linux hosts some values can be unavailable or zero

---

## 3) Remote Server Management (via SSH)

- Create/list/update/delete server profiles
- Store host, port, username, auth method (password or SSH key)
- Encrypt sensitive credentials at rest (AES-256-GCM)
- Per-server live stats endpoint (`/api/servers/[id]/stats`) over SSH
- **SSH connection pooling**: 5-min TTL, max 10 concurrent connections, auto-eviction
- **Modular SSH architecture**: 7 focused modules (connection, stats, containers, network, actions, pool, index)
- **Docker container management**: list, start, stop, restart containers
- **Systemd service viewer**: list active/inactive service units
- **Network topology**: Docker networks with container IPs + host ports
- **Quick actions**: 25+ predefined actions (health check, security audit, OS update, docker prune, ban/unban IP, etc.)
- **Container crash detection**: monitors for restart loops (3+ in 5 min), sends broadcast alerts

---

## 4) Network and Package Operations (Host-Level)

- List listening ports (`/api/network/ports`)
- List installed/upgradable packages (`/api/network/packages`)
- Trigger package metadata update (`apt update`)
- Trigger package upgrades (all or selected packages)
- **Lazy-loaded network map** for improved page performance

**Current boundary**

- Network canvas is read-only/inspection-oriented today.
- Full interactive network controls, safe firewall changes, Docker network mutations, dry-run/diff, rollback and remote network actions are planned for Phase 11.

**Constraints**

- Runs on the app host/container context, not inside added remote servers
- Linux + apt required

---

## 5) Application Tracking

- Track applications across all managed servers (`/api/apps`)
- Auto-discover Docker containers via SSH and merge with DB records
- Manually add tracked applications with container/domain info
- Live status sync (RUNNING, STOPPED, RESTARTING, UNHEALTHY, UNKNOWN)
- Container log viewer (`/api/apps/[id]/logs`)
- **Health check auto-run** with endpoint monitoring
- **Environment variable editor** for tracked containers
- **Resource charts** (CPU/memory over time)
- **Per-app settings** (restart policy, resource limits, logging, networking)
- **De-jargoned labels**: "Container" → "Application", "Image" → "Template", "Ports" → "Connections"

---

## 6) Deployment Workflow

- Submit Git repository deployment requests from panel (`/api/deploy`)
- Stack detection for common frameworks (Next.js, React, Vue, Nuxt, Node, Python, Go, Rust, static)
- **Three deploy modes**: Git Repo, Docker Image, Docker Compose
- **Local/Remote toggle**: deploy locally or to a remote server via SSH
- Remote deployments support custom path, environment variables, and target server selection
- **FileBrowser integration** for visual path selection on deploy forms
- Deployment history with status and logs
- **Deployment rollback**: re-deploy previous successful deployment via `/api/deploy/rollback`
- **Real-time deploy logs via SSE** (`/api/deploy/stream`)

---

## 7) Database Backups

- **Backup management UI** at `/backup`
- Create snapshots of the SQLite database
- Restore from any backup with auto pre-restore backup
- Delete old backups
- List backups with name, size, creation date
- Rate limited (5 operations/min/IP)
- All operations audit-logged

---

## 8) Notification System

- **4 channels**: Discord, Slack, Telegram, **Email** (via HTTP mail API)
- Webhook-based delivery for Discord/Slack/Telegram
- Email via SendGrid/Mailgun HTTP API (SMTP_HOST env var)
- Configurable alert rules (CPU, memory, disk thresholds)
- Threshold-based alerting with cooldown to prevent alert storms
- **Container crash alerts**: automatic broadcast on restart loops
- Severity levels: info, warning, critical (with emoji + color coding)
- Formatted payloads per channel (embeds, blocks, HTML)

---

## 9) VPS Bootstrap Deployment (deploy.sh)

- Guided server bootstrap script for new VPS
- System checks (OS, RAM, disk, internet)
- Installs Docker, Docker Compose, UFW
- Configures firewall (22/80/443)
- Detects/uses existing Traefik or provisions new Traefik
- Generates `.env` (domain, resolver, admin, secrets, network)
- Builds and starts app container
- Verifies deployment status and reports clear failure/success

---

## 10) Security Controls

| Control                | Status         | Details                                 |
| ---------------------- | -------------- | --------------------------------------- |
| Password hashing       | ✅ Implemented | bcryptjs with salt rounds               |
| JWT auth cookie        | ✅ Implemented | HttpOnly + Secure + SameSite=Lax        |
| JWT auto-refresh       | ✅ Implemented | 24h lifespan, refresh at 12h            |
| AES-256-GCM encryption | ✅ Implemented | SSH credentials encrypted at rest       |
| API rate limiting      | ✅ Implemented | 100 req/min/IP                          |
| Account lockout        | ✅ Implemented | 5 failures → 15 min lock                |
| HSTS header            | ✅ Implemented | Strict-Transport-Security in production |
| CSRF protection        | ✅ Implemented | Null-origin bypass prevented            |
| Input validation       | ✅ Implemented | Central validation module (46 tests)    |
| Non-root container     | ✅ Implemented | UID 1001 nextjs user                    |
| SQLite WAL mode        | ✅ Implemented | Better concurrent read performance      |
| Error sanitization     | ✅ Implemented | 18 friendly error mappings              |

---

## 11) User Experience

- **Breadcrumbs navigation** across all panel pages
- **Command Palette** (`Ctrl+K` / `⌘K`) for quick page navigation
- **Onboarding Wizard** (3-step) for first-time users
- **Internationalization** (English + Vietnamese) with browser auto-detect
- **De-jargoned UI** (Container→Application, Image→Template, Ports→Connections)
- **Empty states with CTAs** for first-time users
- **Lazy-loaded components** (NetworkMap) for faster page loads
- **Dark theme** with premium design

---

## 12) Audit Log

- Records all administrative actions (38 action types)
- Timestamped entries with action type, user, target, IP, and details
- **Full-text search** across user, target, IP, and action fields
- **Action type filter** dropdown
- **Date range filter** (From/To date pickers)
- **CSV export** of filtered audit entries
- Expandable row detail view

---

## 13) Web Terminal

- Browser-based command execution on managed servers
- **Server selector dropdown** to choose target server
- Runs commands via SSH through the panel (or `nsenter` for local server)
- Output streamed to the UI with command history
- **Relaxed allowlist** supporting 30+ common Linux commands
- Command history navigation (↑/↓ arrows)

---

## 14) User, Profile and Permission Management

- Create, update, delete user accounts (`/api/users`)
- Owner/Admin/Manager/Viewer role hierarchy
- Server-scoped permissions: all servers or selected servers, including `local`
- `/users` is limited to Owner/Admin
- `/profile` lets each user update display name, email, password and Quick Unlock Passcode
- Quick Unlock Passcode unlocks idle lock only while the session is still valid
- Admin cannot manage Owner accounts
- Manager/Viewer cannot manage users
- Logout confirmation dialog
- Accessible from sidebar/header under System/Profile

---

## 15) Testing

- **87 tests** across 6 test files
- Vitest test runner
- Covers: validation (46), error handling (11), sanitization (6), SSE (8), crypto (9), auth (7)
- All tests pass with build verification

---

## Quick Capability Matrix

| Area                         | Implemented | Notes                                       |
| ---------------------------- | ----------- | ------------------------------------------- |
| Auth + sessions              | ✅          | JWT 24h + auto-refresh, lockout, rate limit |
| Dashboard monitoring         | ✅          | Host metrics + SSE + Quick Overview         |
| Remote SSH server management | ✅          | Modular SSH with connection pooling         |
| Docker container management  | ✅          | List, start, stop, restart via SSH          |
| Container crash detection    | ✅          | 3+ restarts in 5min → alert                 |
| Quick server actions         | ✅          | 25+ predefined maintenance commands         |
| Application tracking         | ✅          | DB + live discovery + health check          |
| Host port/package management | ✅          | Linux/apt only                              |
| Panel-driven deployment      | ✅          | Git, Docker Image, Docker Compose modes     |
| Deployment rollback          | ✅          | Re-deploy from previous deployment          |
| Database backups             | ✅          | Create, restore, delete from browser        |
| VPS bootstrap automation     | ✅          | deploy.sh end-to-end                        |
| Traefik HTTPS routing        | ✅          | Requires correct DNS/resolver               |
| SQLite persistence           | ✅          | Volume-backed, WAL mode                     |
| Audit log                    | ✅          | 38 action types, search, export             |
| Web terminal                 | ✅          | Server selector, command history            |
| SSE real-time streams        | ✅          | Dashboard, apps, deploy log streams         |
| Notification channels        | ✅          | Discord, Slack, Telegram, Email             |
| Command palette              | ✅          | Ctrl+K fuzzy search across pages            |
| i18n                         | ✅          | English + Vietnamese (61 keys)              |
| Settings management          | ✅          | General, Docker, Security, Backup           |
| SSL certificate checker      | ✅          | Per-server SSL/TLS verification             |
| File browser                 | ✅          | Remote file system navigation               |
| User management              | ✅          | CRUD + role management                      |
| Onboarding wizard            | ✅          | 3-step first-time setup guide               |
| Breadcrumbs navigation       | ✅          | Context-aware page breadcrumbs              |
| Unit tests                   | ✅          | 87 tests, 6 files via Vitest                |

---

## Intended Audience

This summary is for operators and maintainers who need a quick, reliable map of what the app can do today, including important platform constraints and operational caveats.
