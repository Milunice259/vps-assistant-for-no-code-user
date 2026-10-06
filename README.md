<p align="center">
  <img src="public/logo.svg" alt="VPS Control logo" width="96" />
</p>

<h1 align="center">VPS Control</h1>

<p align="center">
  <strong>A friendly self-hosted VPS assistant for people who do not want to live in SSH.</strong><br/>
  Monitor servers, understand alerts, deploy apps, create backups, and run safe repairs from one clean web panel.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/Traefik-auto--HTTPS-24A1C1?style=flat-square&logo=traefikproxy&logoColor=white" alt="Traefik" />
  <img src="https://img.shields.io/badge/License-MIT-10B981?style=flat-square" alt="MIT License" />
</p>

---

## Why VPS Control exists

Running a VPS is powerful, but most panels still assume you know Linux, Docker, logs, ports, reverse proxies, backups, and security trade-offs.

**VPS Control is built for no-code and non-technical operators**: it turns server management into guided screens, plain-English alerts, safe defaults, and auditable actions.

Use it to answer simple questions quickly:

- Is my server healthy?
- Which app or service is failing?
- What does this alert mean?
- Can I fix this safely?
- Did someone change something?
- Do I have a backup before I touch anything?

## Highlights

| Area | What you get |
| --- | --- |
| **Fleet Dashboard** | One Fleet Risk Score for local and remote servers, with grouped Alert Center for large fleets. |
| **Plain-English Alerts** | Alerts explain impact and next steps without forcing users into logs first. |
| **Guided Fixes** | Safe repair actions for low-risk maintenance such as cache cleanup and old log trimming. |
| **Apps + Services** | Discover Docker containers and important systemd services such as Traefik, nginx, n8n, Hermes, and more. |
| **Deployments** | Analyze local Git repositories; deploy remote Git repositories, Docker images or Compose projects. Automatic rollback is unavailable. |
| **Backups** | Save integrity-checked, SQLite-consistent panel snapshots on the persistent data volume. Live restore is locked; maintenance recovery is documented. VPS/apps/volumes and encryption keys are excluded. |
| **Notifications** | Discord, Slack, Telegram, and Email alert channels with recommended beginner rules. |
| **Network Map** | Read-only topology/inspection map for domains, proxy, servers, apps, ports, and Docker networks. |
| **Audit Log** | Track who did what, when, where, and whether it succeeded. |
| **Users + Profile** | Owner/Admin user management, role/server scope, and self-service profile/passcode settings. |
| **Safe Mode** | Keeps dangerous controls out of the way for daily operation. |

## Screens inside the app

- **Dashboard** — daily health, Fleet Risk Score, Alert Center, Safe Repair.
- **Servers** — add remote VPS machines, view stats, Docker, services, and server actions.
- **Apps** — inspect containers and system services, logs, env tools, health checks.
- **Deploy** — local Git analysis, remote Git deployment, and Docker Image/Compose deployment.
- **Network** — topology inspection and scoped UFW rule controls; external blocking is not independently verified.
- **Backups** — consistent panel-only snapshots; online restore is locked to prevent unsafe database replacement.
- **Audit Log** — searchable activity history.
- **Settings** — notifications, alert rules, security settings, and app preferences.
- **Users** — Owner/Admin account management with role and server-scope boundaries.
- **Profile** — self-service display name, email, password, theme preference, and Quick Unlock Passcode.
- **Docs** — built-in user manual for non-technical operators.

## Quick start: production deploy

> Recommended target: Ubuntu/Debian VPS with root access and a domain pointed to the server.

```bash
git clone https://github.com/Milunice259/vps-assistant-for-no-code-user.git /opt/vps-panel
cd /opt/vps-panel
chmod +x deploy.sh
./deploy.sh
```

The deploy script will check the server, install required runtime pieces, configure Docker/Traefik, ask for domain/admin details, generate secrets, build the app, and verify the container.

Then open:

```text
https://your-domain.com
```

## Local development

```bash
npm install

cat > .env <<'EOF'
DATABASE_URL="file:./prisma/dev.db"
JWT_SECRET=dev-jwt-secret-change-in-production-must-be-64-hex-chars-long-ok
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
EOF

npm run db:push
npm run db:seed
npm run dev
```

Open `http://localhost:3000`.

## Useful commands

```bash
npm run lint
npm run build
npm run db:push
npm run db:studio
```

## Tech stack

| Layer | Technology |
| --- | --- |
| App | Next.js App Router, React, TypeScript |
| UI | Tailwind CSS, Lucide icons, Recharts |
| API | Next.js route handlers, Server-Sent Events |
| Database | SQLite via Prisma |
| Auth | JWT cookies, bcrypt password hashing |
| Server control | SSH, Docker, systemd, Linux tools |
| Deployment | Docker, Docker Compose, Traefik labels |
| Security | AES-256-GCM credential encryption, secret redaction, audit logs |

## Security model

- SSH credentials are encrypted before storage.
- Sensitive values are redacted from logs and API responses where possible.
- Server mutations require temporary session-bound Advanced Mode, explicit operation acknowledgment and target permissions. Advanced Mode expires within 15 minutes; previews remain read-only.
- Role boundaries are enforced in middleware/API, not only hidden in UI.
- Quick Unlock Passcode is hashed, optional, and only unlocks idle lock while the login session is still valid.
- Audit logging is part of the core product direction.
- This app controls servers; review code and configuration before exposing it publicly.

No public registration is exposed; Owner/Admin creates users. If you find a vulnerability, please open a private security report if GitHub Security Advisories are enabled, or contact the maintainer directly. Do not publish secrets or exploit details in public issues.

## Contributing

This project is intended to be open source and contributor-friendly.

Good first contribution areas:

- clearer beginner docs and tooltips
- safer guided repair actions
- more server/app health checks
- UI polish for mobile and large fleets
- tests around risky actions and audit logging
- translations

Start here:

1. Fork the repo.
2. Create a small focused branch.
3. Run `npm run lint` and `npm run build`.
4. Open a pull request with screenshots for UI changes.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for details.

## Roadmap

The current priority is reliable, understandable operation for non-technical users—not more controls. Existing features are not considered fully accepted until their safety, results and authenticated UI have been verified.

| Lane | Status | Acceptance target |
| --- | --- | --- |
| **SEC-01 — Safety and permissions** | Released and verified | Validate inputs before execution; temporary server-authorized Advanced Mode; role and target scope checks; protected configuration values. |
| **TRUST-01 — Truthful capabilities** | Released and verified | Local Git is analysis only; rollback is locked; command completion, state and readiness are distinct. |
| **DATA-01 — Recoverable panel backups** | Released and verified | Concurrent-write SQLite snapshots and integrity checks pass; web restore stays locked; disposable maintenance recovery passes. Panel database only. |
| **UX-01 — Simpler screens** | Released and verified | Current-state onboarding, single responsive route tree, current-input preflight and target-bound touch/keyboard canvas. |
| **FLOW-01 — Guided operations** | Released and verified | Canonical app restart; package-cache-only cleanup; fresh Image/Compose deployment; uncertain submissions require explicit read-only inspection, never automatic retry. |
| **QA-01 — Release gates** | Passed for this release | 21 offline/native regression scripts, lint/type/build, bounded independent safety review, authenticated isolated desktop/mobile interactions and production readback. Dangerous cases use mocks/disposable resources, not production restore/firewall/cleanup. |

UI/UX review starts before implementation and repeats at every release. Dashboard owns fleet health and next steps; server/app pages own target-specific operations; Network owns inspection and network controls; Settings owns configuration; Docs owns longer help. Reuse one action flow across entry points, disclose advanced detail only when needed, and always distinguish Local from Remote.

Network wires are visual paths, not traffic switches. Firewall results verify rule evidence, not effective external reachability. Restore and automatic deployment rollback remain deliberately unavailable; package-cache cleanup is not full disk cleanup. The stack stays unchanged; broad redesigns, AI automation and a full VPS backup engine are outside this reliability pass.

## License

MIT — see [`LICENSE`](LICENSE).
