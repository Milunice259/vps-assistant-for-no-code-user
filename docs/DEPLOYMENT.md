# Deployment

> How to deploy VPS Control App to a production server with Docker and Traefik.

---

## Production Server Requirements

| Requirement        | Details                                      |
| ------------------ | -------------------------------------------- |
| OS                 | Ubuntu 20.04+ or any Linux with Docker       |
| Docker             | 24.x or later                                |
| Docker Compose     | v2 or later                                  |
| Traefik            | Already installed and running on the host    |
| Domain             | A record pointing to the server IP           |
| RAM                | Minimum 1 GB (2 GB recommended)             |

---

## Option 1: One-Click Deploy (Recommended)

### Step 1: Clone the repository

```bash
git clone https://github.com/Milunice259/vps-assistant-for-no-code-user.git
cd vps-assistant-for-no-code-user
```

### Step 2: Run the deploy script

```bash
chmod +x deploy.sh
./deploy.sh
```

### The script automatically:

1. **Checks** that Docker, Docker Compose, and OpenSSL are installed
2. **Detects** the Traefik network (looks for common names: `traefik`, `traefik_network`, `proxy`, `web`)
3. **Prompts you for:**
   - Domain (e.g., `panel.example.com`)
   - Cert Resolver (e.g., `letsencrypt`)
   - Admin username
   - Admin password
4. **Generates** cryptographically secure secrets:
   - `DB_PASSWORD` — 48 hex chars
   - `JWT_SECRET` — 64 hex chars
   - `ENCRYPTION_KEY` — 64 hex chars
5. **Creates** the `.env` file with all configuration
6. **Builds and starts** the containers

### Step 3: Access the app

```
https://your-domain.com
```

Log in with the username/password you entered in step 2.

---

## Option 2: Manual Deploy

### Step 1: Create the .env file

```bash
# Generate secrets
DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)

cat > .env << EOF
# ─── App ───
NODE_ENV=production
DOMAIN=panel.example.com

# ─── Database ───
POSTGRES_USER=vpsadmin
POSTGRES_PASSWORD=$DB_PASSWORD
POSTGRES_DB=vpscontrol
DATABASE_URL=postgresql://vpsadmin:$DB_PASSWORD@db:5432/vpscontrol
DB_HOST=db
DB_PORT=5432

# ─── Security ───
JWT_SECRET=$JWT_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY

# ─── Admin ───
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password

# ─── Traefik ───
TRAEFIK_NETWORK=traefik_network
CERT_RESOLVER=letsencrypt
EOF
```

### Step 2: Build and run

```bash
docker compose up -d --build
```

### Step 3: Verify

```bash
# Check containers
docker compose ps

# View logs
docker compose logs -f app
```

---

## Traefik Labels

Docker Compose automatically configures these Traefik labels:

```yaml
labels:
  # Enable Traefik
  - "traefik.enable=true"

  # HTTPS Router
  - "traefik.http.routers.vps-control.rule=Host(`${DOMAIN}`)"
  - "traefik.http.routers.vps-control.entrypoints=websecure"
  - "traefik.http.routers.vps-control.tls.certresolver=${CERT_RESOLVER}"

  # HTTP → HTTPS Redirect
  - "traefik.http.routers.vps-control-http.rule=Host(`${DOMAIN}`)"
  - "traefik.http.routers.vps-control-http.entrypoints=web"
  - "traefik.http.routers.vps-control-http.middlewares=redirect-https"
  - "traefik.http.middlewares.redirect-https.redirectscheme.scheme=https"

  # Service Port
  - "traefik.http.services.vps-control.loadbalancer.server.port=3000"
```

### Traefik Prerequisites

Your Traefik instance must have:
- **Entrypoints:** `web` (port 80) and `websecure` (port 443)
- **Cert Resolver:** Configured (e.g., `letsencrypt`)
- **Docker Provider:** Enabled
- **Network:** An external network that containers can join

Example Traefik config (`traefik.yml`):

```yaml
entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"

certificatesResolvers:
  letsencrypt:
    acme:
      email: your@email.com
      storage: /letsencrypt/acme.json
      httpChallenge:
        entryPoint: web

providers:
  docker:
    network: traefik_network
    exposedByDefault: false
```

---

## Startup Flow

When the app container starts:

```
docker-entrypoint.sh
    │
    ├─ 1. Wait for DB (wait-for-db.js × 30 retries, 2s apart)
    │     └─ TCP probe to db:5432
    │
    ├─ 2. Run Prisma migrations
    │     └─ npx prisma migrate deploy
    │
    └─ 3. Start Next.js
          └─ exec node server.js
```

### Database Health Check

Docker Compose also has its own health check for PostgreSQL:

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U vpsadmin -d vpscontrol"]
  interval: 5s
  timeout: 5s
  retries: 10
```

The app service uses `depends_on: db: condition: service_healthy`, so Docker won't start the app until the DB reports healthy.

---

## Updating / Upgrading

### Pull new code and rebuild:

```bash
git pull origin main
docker compose up -d --build
```

Prisma migrations are applied automatically via `docker-entrypoint.sh`.

### Restart without rebuilding:

```bash
docker compose restart app
```

---

## Database Backup

### Create a backup:

```bash
docker compose exec db pg_dump -U vpsadmin vpscontrol > backup_$(date +%Y%m%d).sql
```

### Restore a backup:

```bash
docker compose exec -T db psql -U vpsadmin vpscontrol < backup_20260209.sql
```

---

## Monitoring

### Check resource usage:

```bash
docker stats vps-control-app vps-control-db
```

### Stream logs:

```bash
# App logs
docker compose logs -f --tail=100 app

# Database logs
docker compose logs -f --tail=100 db
```

### Check health:

```bash
# Container status
docker compose ps

# Database health
docker compose exec db pg_isready -U vpsadmin
```

---

## Production Troubleshooting

### App won't start

```bash
# Check logs
docker compose logs app

# Common causes:
# 1. DB not ready → entrypoint retries up to 30 times
# 2. Migration error → check schema
# 3. Missing env vars → check .env
```

### Can't access via domain

1. Check DNS: `dig panel.example.com`
2. Check Traefik logs: `docker logs traefik`
3. Check the app joined the right network: `docker network inspect traefik_network`
4. Check Traefik dashboard (if enabled)

### Database disk full

```bash
# Check disk usage
docker system df

# Clean up Docker
docker system prune -a --volumes
```
