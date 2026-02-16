# API Reference, Database & Security

> All API endpoints, database schema, encryption details, and the security model.

---

## API Conventions

- **Base URL:** `/api`
- **Auth:** JWT cookie (`vps-session`), set on login. Most endpoints return `401` without it.
- **Content-Type:** `application/json`
- **Response format:**

```typescript
{ success: boolean; data?: any; error?: string; }
```

---

## Auth Endpoints

### POST `/api/auth/login`

```json
// Request
{ "username": "admin", "password": "your-password" }

// Response 200
{ "success": true, "data": { "id": "cuid...", "username": "admin" } }

// Response 401
{ "success": false, "error": "Invalid credentials" }
```

Side effect: sets HttpOnly cookie `vps-session` (7-day TTL).

### POST `/api/auth/logout`

Clears the session cookie. No request body needed.

### GET `/api/auth/me`

Returns the currently authenticated user's `id` and `username`.

---

## Stats Endpoints

### GET `/api/stats`

Snapshot of host system stats.

```json
{
  "success": true,
  "data": {
    "cpu": 23.5,
    "memory": { "total": 16384, "used": 8192, "percentage": 50.0 },
    "disk": { "total": 512000, "used": 256000, "percentage": 50.0 },
    "uptime": 864000,
    "hostname": "vps-01",
    "os": "Linux 5.15.0"
  }
}
```

### GET `/api/stats/stream`

**Server-Sent Events** — streams stats every 2 seconds.

```typescript
const { data, error, connected } = useSSE<SystemStats>("/api/stats/stream");
```

---

## Server Endpoints

### GET `/api/servers`

List all servers (encrypted fields excluded).

### POST `/api/servers`

Create a server. Credentials are AES-256-GCM encrypted before storage.

```json
// Password auth
{ "name": "VPS", "host": "1.2.3.4", "port": 22, "username": "root", "authMethod": "PASSWORD", "password": "..." }

// SSH key auth
{ "name": "VPS", "host": "1.2.3.4", "port": 22, "username": "deploy", "authMethod": "KEY", "privateKey": "-----BEGIN..." }
```

### GET `/api/servers/[id]`

Get a single server by ID. Returns `404` if not found.

### PATCH `/api/servers/[id]`

Update server fields. Only send fields to change.

### DELETE `/api/servers/[id]`

Delete a server.

### GET `/api/servers/[id]/stats`

Fetch live system stats from a remote server via SSH. Returns `503` if server is offline.

### GET `/api/servers/[id]/docker`

List all Docker containers (running and stopped) on a remote server.

```json
{
  "success": true,
  "data": [
    {
      "id": "abc123",
      "name": "my-app",
      "image": "node:20",
      "status": "Up 2 hours",
      "state": "running",
      "ports": "0.0.0.0:3000->3000/tcp"
    }
  ]
}
```

### POST `/api/servers/[id]/docker/action`

Perform a Docker container action (start, stop, restart).

```json
{ "containerId": "abc123", "action": "restart" }
```

### GET `/api/servers/[id]/services`

List systemd service units on a remote server.

```json
{
  "success": true,
  "data": [
    {
      "name": "docker.service",
      "loadState": "loaded",
      "activeState": "active",
      "subState": "running",
      "description": "Docker Application Container Engine"
    }
  ]
}
```

### GET `/api/servers/[id]/network`

Fetch Docker network topology and host ports from a remote server.

### POST `/api/servers/[id]/actions`

Run a quick maintenance action on a remote server.

```json
{ "action": "apt-update" }
```

**Valid actions:** `apt-update`, `docker-prune`, `restart-docker`

### GET `/api/servers/[id]/cron`

List scheduled cron jobs on a remote server.

### POST `/api/servers/[id]/cron`

Create or update a cron job on a remote server.

### GET `/api/servers/[id]/files`

Browse the file system on a remote server. Query: `?path=/home`

### POST `/api/servers/[id]/files`

Perform file operations (read, create, delete) on a remote server.

### GET `/api/servers/[id]/ssl`

Check SSL/TLS certificate status for a remote server.

---

## Apps Endpoints

### GET `/api/apps`

List all applications across all managed servers. Aggregates DB records with live Docker container discovery via SSH.

### POST `/api/apps`

Manually add a tracked application.

```json
{
  "name": "My App",
  "serverId": "cuid...",
  "containerId": "abc123",
  "domain": "app.example.com"
}
```

### GET `/api/apps/[id]/logs`

Fetch container logs for a tracked application.

### GET `/api/apps/[id]`

Get a single tracked application by ID.

### PATCH `/api/apps/[id]`

Update a tracked application's properties.

### DELETE `/api/apps/[id]`

Remove a tracked application.

### POST `/api/apps/[id]/actions`

Perform a Docker container action for a tracked app.

```json
{ "action": "start" | "stop" | "restart" }
```

### GET `/api/apps/[id]/env`

Get environment variables for a tracked container.

### PUT `/api/apps/[id]/env`

Update environment variables for a tracked container.

### GET `/api/apps/[id]/health`

Run a health check on a tracked application. Returns status, response time, and endpoint info.

### GET `/api/apps/[id]/stream`

**Server-Sent Events** — streams real-time stats (CPU, memory, PIDs) for a tracked app.

### POST `/api/apps/[id]/terminal`

Execute a command inside a tracked app's container.

```json
{ "command": "ls -la /app" }
```

---

## Network Endpoints

> **Note:** These endpoints require a Linux host. On non-Linux systems, they return `422` with a friendly `UNSUPPORTED_PLATFORM` message.

### GET `/api/network/ports`

List open ports on the host (uses `ss -tulnp`).

```json
{
  "success": true,
  "data": [
    {
      "protocol": "tcp",
      "localAddress": "0.0.0.0",
      "localPort": 443,
      "process": "traefik",
      "state": "LISTEN"
    }
  ]
}
```

### GET `/api/network/packages`

List installed APT packages.

### POST `/api/network/packages`

Run `apt update` or `apt upgrade`.

```json
// Update package list
{ "action": "update" }

// Upgrade specific packages
{ "action": "upgrade", "packages": ["nginx", "curl"] }

// Upgrade all
{ "action": "upgrade" }
```

---

## Audit Endpoint

### GET `/api/audit`

List audit log entries with pagination.

```json
// Query params: ?page=1&perPage=25&action=login
{
  "success": true,
  "data": {
    "entries": [
      {
        "id": "...",
        "action": "login",
        "username": "admin",
        "target": null,
        "details": null,
        "ip": "::1",
        "createdAt": "2026-02-16T08:20:00.000Z"
      }
    ],
    "total": 1
  }
}
```

---

## Backup Endpoint

### POST `/api/backup`

Create a backup of the SQLite database. Returns the backup file.

---

## Notification Endpoints

### GET `/api/notifications`

List all notification channels and their alert rules.

### POST `/api/notifications`

Create a new notification channel.

```json
{
  "name": "Slack Alerts",
  "type": "webhook",
  "webhookUrl": "https://hooks.slack.com/...",
  "alertRules": [
    { "metric": "cpu", "operator": ">", "threshold": 80, "cooldownMin": 5 }
  ]
}
```

### DELETE `/api/notifications/[id]`

Delete a notification channel.

---

## Dashboard Endpoints

### GET `/api/dashboard/stream`

**Server-Sent Events** — streams dashboard-level stats (host metrics + container summary).

### GET `/api/dashboard/summary`

Quick summary counts (apps, servers, ports, networks, deployments).

---

## Deploy Endpoints

### GET `/api/deploy`

Get the 20 most recent deployment logs.

### POST `/api/deploy`

Start a new deployment.

**Local mode** (no `serverId`): Clones repo locally for stack detection.

```json
// Request (local)
{ "repoUrl": "https://github.com/user/repo", "branch": "main", "domain": "app.example.com" }

// Response 201
{ "success": true, "data": { "id": "...", "detectedStack": "nextjs", "status": "BUILDING" } }
```

**Remote mode** (with `serverId`): Deploys to a remote server via SSH using `git clone` + `docker compose`.

```json
// Request (remote)
{
  "repoUrl": "https://github.com/user/repo",
  "branch": "main",
  "serverId": "cuid...",
  "customPath": "/opt/my-app",
  "domain": "app.example.com",
  "envVars": "KEY=value\nKEY2=value2"
}
```

**Detected stacks:** `nextjs`, `react`, `vue`, `nuxt`, `python`, `go`, `rust`, `node`, `static`, `unknown`

### POST `/api/deploy/docker`

Deploy a Docker image or Docker Compose stack.

```json
// Docker Image mode
{ "mode": "image", "image": "nginx:latest", "containerName": "my-nginx", "ports": "80:80" }

// Docker Compose mode
{ "mode": "compose", "composeContent": "version: '3'\nservices:...", "projectName": "my-stack" }
```

### GET `/api/deploy/stream`

**Server-Sent Events** — streams real-time deployment logs.

---

## HTTP Status Codes

| Code | Meaning             | When                                 |
| ---- | ------------------- | ------------------------------------ |
| 200  | OK                  | Request succeeded                    |
| 201  | Created             | New resource created                 |
| 400  | Bad Request         | Invalid input                        |
| 401  | Unauthorized        | Not logged in or token expired       |
| 404  | Not Found           | Resource doesn't exist               |
| 422  | Unprocessable       | Unsupported platform (Windows)       |
| 500  | Server Error        | SSH fail, DB error, etc.             |
| 503  | Service Unavailable | Remote server offline or unreachable |

---

# Database

## Schema Overview

- **Engine:** SQLite (embedded, file-based)
- **ORM:** Prisma — `prisma/schema.prisma`
- **Storage:** Docker volume (`app_data:/app/data/vpscontrol.db`)

## Entity Relationship

```
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│        User         │    │       Server        │    │   DeploymentLog     │    │        App          │
├─────────────────────┤    ├─────────────────────┤    ├─────────────────────┤    ├─────────────────────┤
│ id          (PK)    │    │ id          (PK)    │    │ id          (PK)    │    │ id          (PK)    │
│ username    (unique) │    │ name                │    │ repoUrl             │    │ name                │
│ passwordHash        │    │ host                │    │ branch      (main)  │    │ containerId   (?)   │
│ createdAt           │    │ port        (22)    │    │ detectedStack       │    │ containerName (?)   │
│ updatedAt           │    │ username            │    │ status      (enum)  │    │ image         (?)   │
└─────────────────────┘    │ authMethod  (enum)  │    │ logs        (Text)  │    │ serverId      (FK)  │
                           │ encryptedKey  🔒    │    │ domain      (?)     │    │ deploymentId  (?)   │
                           │ encryptedPass 🔒    │    │ serverId    (FK?)   │    │ status      (enum)  │
                           │ isActive    (true)  │    │ commitHash  (?)     │    │ domain        (?)   │
                           │ lastConnected (?)   │    │ customPath  (?)     │    │ createdAt           │
                           │ createdAt           │    │ encryptedEnv 🔒(?)  │    │ updatedAt           │
                           │ updatedAt           │    │ createdAt           │    └─────────────────────┘
                           └─────────────────────┘    │ updatedAt           │
                              ▲ has many              └─────────────────────┘
                              ├── apps[]
                              └── deployments[]
```

🔒 = AES-256-GCM encrypted at rest

## Enums

```

AuthMethod: PASSWORD | KEY
DeployStatus: PENDING | CLONING | BUILDING | RUNNING | FAILED
AppStatus: RUNNING | STOPPED | RESTARTING | UNHEALTHY | UNKNOWN

```

## Database Commands

```bash
npm run db:push       # Create/update database from schema
npm run db:studio     # GUI at localhost:5555
npm run db:seed       # Create admin from ADMIN_USERNAME / ADMIN_PASSWORD
npm run db:generate   # Regenerate Prisma client
```

## Prisma Client Singleton

`src/lib/db.ts` prevents multiple Prisma instances during Next.js hot reload:

```typescript
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

## Connection Strings

| Environment | URL                            |
| ----------- | ------------------------------ |
| Local dev   | `file:./prisma/dev.db`         |
| Docker prod | `file:/app/data/vpscontrol.db` |

---

# Security

## Security Layers

```
1. Traefik ──── TLS termination, auto cert renewal, HTTP→HTTPS redirect
2. Middleware ── JWT verification, route protection (/panel/*)
3. API Layer ── Input validation, error sanitization
4. Auth ─────── bcrypt 12 rounds, JWT HS256 (HttpOnly cookie), 7-day TTL
5. Data ─────── AES-256-GCM encryption for SSH credentials
6. Network ──── SQLite embedded, no external database port
```

## Authentication Flow

```
Client                    Server
  │                         │
  ├── POST /api/auth/login ─┤
  │   { username, password } │
  │                         ├── Find user in DB
  │                         ├── bcrypt.compare(password, hash)
  │                         ├── Create JWT (jose, HS256)
  │                         ├── Set HttpOnly cookie
  ◄── 200 { success, data } ┤
  │                         │
  ├── GET /api/stats ───────┤
  │   Cookie: vps-session    │
  │                         ├── middleware.ts verifies JWT
  ◄── 200 { data }          │
```

## Cookie Configuration

```typescript
{
  name: "vps-session",
  httpOnly: true,         // JS cannot read → XSS protection
  secure: production,     // HTTPS only in production
  sameSite: "lax",        // Basic CSRF protection
  maxAge: 7 * 24 * 3600,  // 7 days
  path: "/"
}
```

## AES-256-GCM Encryption

| Property  | Value                               |
| --------- | ----------------------------------- |
| Algorithm | AES-256-GCM                         |
| Key       | `ENCRYPTION_KEY` (32 bytes hex)     |
| IV        | 16 bytes random (per encryption)    |
| Auth Tag  | 16 bytes                            |
| Format    | `base64(IV + ciphertext + authTag)` |

```typescript
import { encrypt, decrypt } from "@/lib/crypto";

const encrypted = encrypt(sshPassword); // → base64 string
const original = decrypt(encrypted); // → plaintext
```

**CRITICAL:** If `ENCRYPTION_KEY` is lost, all encrypted credentials become unrecoverable.

## SSH Security

- **Auto-accept host keys:** Intentional for automation (no manual confirmation)
- **Supported algorithms:** ssh-ed25519, ecdsa-sha2-nistp256/384/521, rsa-sha2-512/256, ssh-rsa
- **Connection timeout:** 10 seconds

## Secrets

| Secret           | Purpose       | Generated by | Length   |
| ---------------- | ------------- | ------------ | -------- |
| `JWT_SECRET`     | JWT signing   | `deploy.sh`  | 64 hex   |
| `ENCRYPTION_KEY` | AES-256-GCM   | `deploy.sh`  | 64 hex   |
| `ADMIN_PASSWORD` | Initial admin | User input   | User-set |

**Rules:** Never hardcode, never commit `.env`, never log to console.

## Known Limitations

| Limitation               | Severity | Future Improvement              |
| ------------------------ | -------- | ------------------------------- |
| No rate limiting         | Medium   | Add rate limiter middleware     |
| No 2FA                   | Medium   | Add TOTP (Google Authenticator) |
| SSH host keys not stored | Low      | Store known_hosts               |
| No CORS/CSP headers      | Low      | Add security headers            |

## Deployment Security Checklist

- [ ] Domain pointed to server
- [ ] Traefik running with TLS
- [ ] `.env` NOT in git
- [ ] `ENCRYPTION_KEY` backed up securely
- [ ] Admin password: 12+ chars, mixed case, numbers, symbols
- [ ] Firewall: only ports 80 & 443 open
- [ ] Host SSH: key-based auth only
