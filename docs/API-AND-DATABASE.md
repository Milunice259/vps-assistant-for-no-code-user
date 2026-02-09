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
const { data, error, connected } = useSSE<SystemStats>('/api/stats/stream');
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

Fetch live system stats from a remote server via SSH. Returns `500` if SSH connection fails.

---

## Network Endpoints

> **Note:** These endpoints require a Linux host. On non-Linux systems, they return `422` with a friendly `UNSUPPORTED_PLATFORM` message.

### GET `/api/network/ports`

List open ports on the host (uses `ss -tulnp`).

```json
{ "success": true, "data": [{ "protocol": "tcp", "localAddress": "0.0.0.0", "localPort": 443, "process": "traefik", "state": "LISTEN" }] }
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

## Deploy Endpoints

### GET `/api/deploy`

Get the 20 most recent deployment logs.

### POST `/api/deploy`

Start a new deployment — clones repo and detects tech stack.

```json
// Request
{ "repoUrl": "https://github.com/user/repo", "branch": "main", "domain": "app.example.com" }

// Response 201
{ "success": true, "data": { "id": "...", "detectedStack": "nextjs", "status": "CLONING" } }
```

**Detected stacks:** `nextjs`, `react`, `vue`, `nuxt`, `python`, `go`, `rust`, `node`, `static`

---

## HTTP Status Codes

| Code | Meaning             | When                                    |
| ---- | ------------------- | --------------------------------------- |
| 200  | OK                  | Request succeeded                       |
| 201  | Created             | New resource created                    |
| 400  | Bad Request         | Invalid input                           |
| 401  | Unauthorized        | Not logged in or token expired          |
| 404  | Not Found           | Resource doesn't exist                  |
| 422  | Unprocessable       | Unsupported platform (Windows)          |
| 500  | Server Error        | SSH fail, DB error, etc.                |

---

# Database

## Schema Overview

- **Engine:** PostgreSQL 16 (Alpine Docker image)
- **ORM:** Prisma — `prisma/schema.prisma`
- **Connection:** Internal Docker network (never exposed to internet)

## Entity Relationship

```
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│        User         │    │       Server        │    │   DeploymentLog     │
├─────────────────────┤    ├─────────────────────┤    ├─────────────────────┤
│ id          (PK)    │    │ id          (PK)    │    │ id          (PK)    │
│ username    (unique) │    │ name                │    │ repoUrl             │
│ passwordHash        │    │ host                │    │ branch      (main)  │
│ createdAt           │    │ port        (22)    │    │ detectedStack       │
│ updatedAt           │    │ username            │    │ status      (enum)  │
└─────────────────────┘    │ authMethod  (enum)  │    │ logs        (Text)  │
                           │ encryptedKey  🔒    │    │ domain      (?)     │
                           │ encryptedPass 🔒    │    │ createdAt           │
                           │ isActive    (true)  │    │ updatedAt           │
                           │ lastConnected (?)   │    └─────────────────────┘
                           │ createdAt           │
                           │ updatedAt           │
                           └─────────────────────┘
```

🔒 = AES-256-GCM encrypted at rest

## Enums

```
AuthMethod:  PASSWORD | KEY
DeployStatus: PENDING | CLONING | BUILDING | RUNNING | FAILED
```

## Migrations

```bash
npm run db:migrate    # Create & apply (dev)
npx prisma migrate deploy  # Apply pending (production, auto in entrypoint)
npm run db:push       # Direct push, no migration file (dev only)
npm run db:studio     # GUI at localhost:5555
npm run db:seed       # Create admin from ADMIN_USERNAME / ADMIN_PASSWORD
```

## Prisma Client Singleton

`src/lib/db.ts` prevents multiple Prisma instances during Next.js hot reload:

```typescript
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

## Connection Strings

| Environment | URL |
| --- | --- |
| Local dev | `postgresql://vpsadmin:devpassword123@localhost:5432/vpscontrol` |
| Docker prod | `postgresql://vpsadmin:${DB_PASSWORD}@db:5432/vpscontrol` |

---

# Security

## Security Layers

```
1. Traefik ──── TLS termination, auto cert renewal, HTTP→HTTPS redirect
2. Middleware ── JWT verification, route protection (/panel/*)
3. API Layer ── Input validation, error sanitization
4. Auth ─────── bcrypt 12 rounds, JWT HS256 (HttpOnly cookie), 7-day TTL
5. Data ─────── AES-256-GCM encryption for SSH credentials
6. Network ──── PostgreSQL on private bridge, no external port exposure
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

| Property    | Value                              |
| ----------- | ---------------------------------- |
| Algorithm   | AES-256-GCM                        |
| Key         | `ENCRYPTION_KEY` (32 bytes hex)    |
| IV          | 16 bytes random (per encryption)   |
| Auth Tag    | 16 bytes                           |
| Format      | `base64(IV + ciphertext + authTag)` |

```typescript
import { encrypt, decrypt } from '@/lib/crypto';

const encrypted = encrypt(sshPassword);   // → base64 string
const original = decrypt(encrypted);       // → plaintext
```

**CRITICAL:** If `ENCRYPTION_KEY` is lost, all encrypted credentials become unrecoverable.

## SSH Security

- **Auto-accept host keys:** Intentional for automation (no manual confirmation)
- **Supported algorithms:** ssh-ed25519, ecdsa-sha2-nistp256/384/521, rsa-sha2-512/256, ssh-rsa
- **Connection timeout:** 10 seconds

## Secrets

| Secret           | Purpose              | Generated by | Length    |
| ---------------- | -------------------- | ------------ | --------- |
| `DB_PASSWORD`    | PostgreSQL auth      | `deploy.sh`  | 48 hex    |
| `JWT_SECRET`     | JWT signing          | `deploy.sh`  | 64 hex    |
| `ENCRYPTION_KEY` | AES-256-GCM          | `deploy.sh`  | 64 hex    |
| `ADMIN_PASSWORD` | Initial admin        | User input   | User-set  |

**Rules:** Never hardcode, never commit `.env`, never log to console.

## Known Limitations

| Limitation             | Severity | Future Improvement              |
| ---------------------- | -------- | ------------------------------- |
| No rate limiting       | Medium   | Add rate limiter middleware     |
| No 2FA                 | Medium   | Add TOTP (Google Authenticator) |
| No audit log           | Low      | Log actions to DB               |
| SSH host keys not stored | Low    | Store known_hosts               |
| No CORS/CSP headers    | Low      | Add security headers            |

## Deployment Security Checklist

- [ ] Domain pointed to server
- [ ] Traefik running with TLS
- [ ] `.env` NOT in git
- [ ] `ENCRYPTION_KEY` backed up securely
- [ ] Admin password: 12+ chars, mixed case, numbers, symbols
- [ ] Firewall: only ports 80 & 443 open
- [ ] Host SSH: key-based auth only
