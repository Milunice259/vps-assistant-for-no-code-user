# Getting Started

> How to set up your local development environment and run the project.

---

## Prerequisites

| Tool             | Minimum Version      | Verify                     |
| ---------------- | -------------------- | -------------------------- |
| Node.js          | 20.x                 | `node --version`          |
| npm              | 10.x                 | `npm --version`           |
| Docker           | 24.x                 | `docker --version`        |
| Docker Compose   | 2.x                  | `docker compose version`  |
| Git              | 2.x                  | `git --version`           |

## First-Time Setup

### 1. Clone the repository

```bash
git clone https://github.com/Milunice259/vps-assistant-for-no-code-user.git
cd vps-assistant-for-no-code-user
```

### 2. Install dependencies

```bash
npm install
```

The `postinstall` script automatically runs `prisma generate` to create the Prisma Client.

### 3. Start PostgreSQL

Run PostgreSQL via Docker (database only, not the app):

```bash
docker run -d \
  --name vps-dev-db \
  -e POSTGRES_USER=vpsadmin \
  -e POSTGRES_PASSWORD=devpassword123 \
  -e POSTGRES_DB=vpscontrol \
  -p 5432:5432 \
  postgres:16-alpine
```

### 4. Create the .env file

Create a `.env` file at the project root:

```env
# ─── Database ───
DATABASE_URL="postgresql://vpsadmin:devpassword123@localhost:5432/vpscontrol"
DB_HOST=localhost
DB_PORT=5432

# ─── Security ───
JWT_SECRET=dev-jwt-secret-change-in-production-must-be-64-hex-chars-long-ok
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# ─── Admin Account (used by seed script) ───
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

> **Note:** These are development values. Do NOT use them in production. The `deploy.sh` script automatically generates secure secrets for production deployments.

### 5. Run database migrations

```bash
npm run db:migrate
```

Prisma will create the `User`, `Server`, and `DeploymentLog` tables in PostgreSQL.

### 6. Seed initial data (optional)

```bash
npm run db:seed
```

Creates an admin account using the username/password from `.env`.

### 7. Start the dev server

```bash
npm run dev
```

Open: **http://localhost:3000**

---

## Common Commands

### Development

| Command            | Description                                |
| ------------------ | ------------------------------------------ |
| `npm run dev`      | Start Next.js dev server (hot reload)      |
| `npm run build`    | Create production build                     |
| `npm run start`    | Run the production build                    |
| `npm run lint`     | Check for ESLint errors                     |

### Database

| Command              | Description                                     |
| -------------------- | ----------------------------------------------- |
| `npm run db:migrate` | Create and apply a new migration                |
| `npm run db:push`    | Push schema directly (skips migration files)    |
| `npm run db:generate`| Regenerate the Prisma Client                    |
| `npm run db:seed`    | Seed initial data                               |
| `npm run db:studio`  | Open Prisma Studio (DB GUI at localhost:5555)   |

### Docker (Production)

| Command                                | Description                   |
| -------------------------------------- | ----------------------------- |
| `docker compose up -d --build`         | Build and start the full stack |
| `docker compose down`                  | Stop all containers            |
| `docker compose logs -f app`           | Stream app logs                |
| `docker compose logs -f db`            | Stream database logs           |
| `docker compose exec app sh`           | Shell into the app container   |
| `docker compose exec db psql -U vpsadmin vpscontrol` | Connect via psql |

---

## URL Structure

| URL                 | Description                     | Auth Required? |
| ------------------- | ------------------------------- | -------------- |
| `/`                 | Redirects to `/dashboard`       | Yes            |
| `/login`            | Login page                      | No             |
| `/dashboard`        | Real-time stats dashboard       | Yes            |
| `/servers`          | VPS server list management      | Yes            |
| `/servers/[id]`     | Single server detail + stats    | Yes            |
| `/network`          | Port and package management     | Yes            |
| `/deploy`           | GitHub deployer                 | Yes            |

---

## Troubleshooting

### "Cannot find module '@prisma/client'"

```bash
npm run db:generate
```

### Database connection errors

1. Check PostgreSQL is running: `docker ps`
2. Verify `DATABASE_URL` in `.env`
3. Check port 5432 is not occupied: `lsof -i :5432` (Linux/Mac)

### "ENCRYPTION_KEY must be a 64-character hex string"

`ENCRYPTION_KEY` must be exactly 64 hex characters (a-f, 0-9). Generate one with:

```bash
openssl rand -hex 32
```

### Native module errors (ssh2-promise)

Some systems need build tools for native modules:

```bash
# macOS
xcode-select --install

# Ubuntu/Debian
sudo apt install python3 make g++

# Windows
npm install --global windows-build-tools
```

### Port 3000 already in use

```bash
# Find the process
lsof -i :3000          # Linux/Mac
netstat -ano | find "3000"  # Windows

# Or use a different port
PORT=3001 npm run dev
```
