# Database

> Schema design, migration management, and the encryption layer for sensitive data.

---

## Overview

- **Engine:** PostgreSQL 16 (Alpine Docker image)
- **ORM:** Prisma
- **Schema file:** `prisma/schema.prisma`
- **Connection:** Via internal Docker network (never exposed to the internet)

## Entity Relationship Diagram

```
┌─────────────────────┐
│        User         │
├─────────────────────┤
│ id          (PK)    │
│ username    (unique) │
│ passwordHash        │
│ createdAt           │
│ updatedAt           │
└─────────────────────┘

┌─────────────────────┐
│       Server        │
├─────────────────────┤
│ id          (PK)    │
│ name                │
│ host                │
│ port        (22)    │
│ username            │
│ authMethod  (enum)  │
│ encryptedKey  (?)   │ ← AES-256-GCM encrypted
│ encryptedPass (?)   │ ← AES-256-GCM encrypted
│ isActive    (true)  │
│ lastConnected (?)   │
│ createdAt           │
│ updatedAt           │
└─────────────────────┘

┌─────────────────────┐
│   DeploymentLog     │
├─────────────────────┤
│ id          (PK)    │
│ repoUrl             │
│ branch      (main)  │
│ detectedStack       │
│ status      (enum)  │
│ logs        (Text)  │
│ domain      (?)     │
│ createdAt           │
│ updatedAt           │
└─────────────────────┘
```

## Model Details

### User

| Field          | Type     | Default     | Notes                            |
| -------------- | -------- | ----------- | -------------------------------- |
| `id`           | String   | `cuid()`    | Primary key                      |
| `username`     | String   | —           | Unique, used for login           |
| `passwordHash` | String   | —           | bcrypt hash (12 rounds)          |
| `createdAt`    | DateTime | `now()`     | Creation timestamp               |
| `updatedAt`    | DateTime | auto        | Auto-updated on change           |

### Server

| Field           | Type       | Default    | Notes                                   |
| --------------- | ---------- | ---------- | --------------------------------------- |
| `id`            | String     | `cuid()`   | Primary key                             |
| `name`          | String     | —          | Display name                            |
| `host`          | String     | —          | IP address or hostname                  |
| `port`          | Int        | `22`       | SSH port                                |
| `username`      | String     | —          | SSH username                            |
| `authMethod`    | AuthMethod | `PASSWORD` | PASSWORD or KEY                         |
| `encryptedKey`  | String?    | null       | SSH private key, AES-256-GCM encrypted  |
| `encryptedPass` | String?    | null       | SSH password, AES-256-GCM encrypted     |
| `isActive`      | Boolean    | `true`     | Whether the server is active            |
| `lastConnected` | DateTime?  | null       | Last successful SSH connection           |
| `createdAt`     | DateTime   | `now()`    |                                         |
| `updatedAt`     | DateTime   | auto       |                                         |

### DeploymentLog

| Field           | Type         | Default   | Notes                           |
| --------------- | ------------ | --------- | ------------------------------- |
| `id`            | String       | `cuid()`  | Primary key                     |
| `repoUrl`       | String       | —         | GitHub repository URL           |
| `branch`        | String       | `"main"`  | Branch to clone                 |
| `detectedStack` | String       | —         | nextjs, react, vue, python, … |
| `status`        | DeployStatus | `PENDING` | Current status                  |
| `logs`          | String       | —         | Output logs (@db.Text)          |
| `domain`        | String?      | null      | Domain if assigned              |
| `createdAt`     | DateTime     | `now()`   |                                 |
| `updatedAt`     | DateTime     | auto      |                                 |

## Enums

### AuthMethod

```prisma
enum AuthMethod {
  PASSWORD   // Authenticate with password
  KEY        // Authenticate with SSH private key
}
```

### DeployStatus

```prisma
enum DeployStatus {
  PENDING    // Waiting to start
  CLONING    // Cloning repository
  BUILDING   // Building the app
  RUNNING    // Successfully running
  FAILED     // Failed
}
```

## Data Encryption (AES-256-GCM)

### Why encrypt?

The `encryptedKey` and `encryptedPass` fields store SSH credentials. If the database is compromised (SQL injection, backup leak, etc.), attackers cannot read the credentials because they are encrypted at rest.

### How it works

```
Plaintext → encrypt() → base64(IV + ciphertext + authTag) → stored in DB
                    ↓
Read from DB → base64 string → decrypt() → Plaintext → used for SSH
```

- **Algorithm:** AES-256-GCM (authenticated encryption with associated data)
- **IV:** 16 bytes random, generated fresh for every encrypt call
- **Auth Tag:** 16 bytes, ensures the data has not been tampered with
- **Key:** Read from the `ENCRYPTION_KEY` env var (32 bytes = 64 hex chars)

### Code location

- Encrypt/Decrypt functions: `src/lib/crypto.ts`
- Used in: `src/app/api/servers/route.ts` (POST), `src/app/api/servers/[id]/route.ts` (PATCH), `src/app/api/servers/[id]/stats/route.ts` (GET — decrypts to SSH)

---

## Managing Migrations

### Create a new migration

When you change `prisma/schema.prisma`:

```bash
npm run db:migrate
```

Prisma will:
1. Diff the current schema against the database
2. Generate a SQL migration file in `prisma/migrations/`
3. Prompt you for a migration name
4. Apply the migration to the database

### Apply migrations in production

Handled automatically by `docker-entrypoint.sh`:

```bash
npx prisma migrate deploy
```

This only applies pending migrations — it does not create new ones.

### Push schema directly (dev only)

```bash
npm run db:push
```

Applies schema changes directly without creating a migration file. **Only use during development.**

### Open Prisma Studio

```bash
npm run db:studio
```

Opens a GUI at `http://localhost:5555` for browsing and editing data.

---

## Prisma Client Singleton

`src/lib/db.ts` ensures only one Prisma Client instance exists across the app:

```typescript
// In development, Next.js hot reload can create multiple instances
// The globalThis trick prevents this
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

---

## Seed Data

`scripts/seed.ts` creates the initial admin account:

```bash
npm run db:seed
```

Uses `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `.env`. The password is hashed with bcrypt before saving.

---

## Connection Strings

### Docker (Production)

```
DATABASE_URL=postgresql://vpsadmin:${DB_PASSWORD}@db:5432/vpscontrol
```

- Host: `db` (service name in docker-compose)
- Network: `internal` (bridge)

### Local Development

```
DATABASE_URL=postgresql://vpsadmin:devpassword123@localhost:5432/vpscontrol
```

- Host: `localhost`
- Port: `5432` (mapped from the Docker container)
