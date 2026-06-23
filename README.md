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
| **Deployments** | Deploy from Git repositories, Docker images, or compose projects with logs and rollback-oriented flow. |
| **Backups** | Create and restore panel database snapshots; restore creates a pre-restore backup automatically. |
| **Notifications** | Discord, Slack, Telegram, and Email alert channels with recommended beginner rules. |
| **Network Map** | Visual map for domains, proxy, servers, apps, ports, and Docker networks. |
| **Audit Log** | Track who did what, when, where, and whether it succeeded. |
| **Safe Mode** | Keeps dangerous controls out of the way for daily operation. |

## Screens inside the app

- **Dashboard** — daily health, Fleet Risk Score, Alert Center, Safe Repair.
- **Servers** — add remote VPS machines, view stats, Docker, services, and server actions.
- **Apps** — inspect containers and system services, logs, env tools, health checks.
- **Deploy** — guided Git, Docker image, and compose deployment.
- **Network** — topology and traffic-flow visibility.
- **Backup & Restore** — panel database snapshots and safe restore flow.
- **Audit Log** — searchable activity history.
- **Settings** — notifications, alert rules, and app preferences.
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
- Destructive operations should be guarded by Safe Mode and confirmations.
- Audit logging is part of the core product direction.
- This app controls servers; review code and configuration before exposing it publicly.

If you find a vulnerability, please open a private security report if GitHub Security Advisories are enabled, or contact the maintainer directly. Do not publish secrets or exploit details in public issues.

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

- Per-server log management tab.
- More beginner-friendly deployment explanations.
- Better mobile tables and dense fleet views.
- Scheduled risk checks and proactive notification delivery.
- Safer restore previews and app-data backup integrations.
- Real firewall/network controls with rollback and audit trail.

## License

MIT — see [`LICENSE`](LICENSE).
