# Deployment

> Hướng dẫn deploy VPS Control App lên production server với Docker và Traefik.

---

## Yêu cầu Production Server

| Yêu cầu           | Chi tiết                                    |
| ------------------ | ------------------------------------------- |
| OS                 | Ubuntu 20.04+ hoặc bất kỳ Linux với Docker |
| Docker             | 24.x trở lên                                |
| Docker Compose     | v2 trở lên                                  |
| Traefik            | Đã cài và chạy trên host                   |
| Domain             | Đã trỏ A record về IP server               |
| RAM                | Tối thiểu 1 GB (khuyến nghị 2 GB)          |

---

## Cách 1: One-Click Deploy (Khuyến nghị)

### Bước 1: Clone repository

```bash
git clone https://github.com/Milunice259/vps-assistant-for-no-code-user.git
cd vps-assistant-for-no-code-user
```

### Bước 2: Chạy deploy script

```bash
chmod +x deploy.sh
./deploy.sh
```

### Script sẽ tự động:

1. **Kiểm tra** Docker, Docker Compose, OpenSSL đã cài chưa
2. **Phát hiện** Traefik network (tìm các tên phổ biến: `traefik`, `traefik_network`, `proxy`, `web`)
3. **Hỏi bạn:**
   - Domain (ví dụ: `panel.example.com`)
   - Cert Resolver (ví dụ: `letsencrypt`)
   - Admin username
   - Admin password
4. **Sinh tự động** các secret an toàn:
   - `DB_PASSWORD` — 48 hex chars
   - `JWT_SECRET` — 64 hex chars
   - `ENCRYPTION_KEY` — 64 hex chars
5. **Tạo file** `.env` với tất cả biến cấu hình
6. **Build và khởi động** containers

### Bước 3: Truy cập

```
https://your-domain.com
```

Đăng nhập bằng username/password đã nhập ở bước 2.

---

## Cách 2: Deploy thủ công

### Bước 1: Tạo .env

```bash
# Sinh secrets
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

### Bước 2: Build và chạy

```bash
docker compose up -d --build
```

### Bước 3: Kiểm tra

```bash
# Xem containers
docker compose ps

# Xem logs
docker compose logs -f app
```

---

## Traefik Labels

Docker Compose tự động cấu hình các Traefik labels sau:

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

### Yêu cầu Traefik

Traefik cần có:
- **Entrypoints:** `web` (port 80) và `websecure` (port 443)
- **Cert Resolver:** Đã cấu hình (ví dụ: `letsencrypt`)
- **Docker Provider:** Đang bật
- **Network:** External network mà containers có thể join

Ví dụ cấu hình Traefik (`traefik.yml`):

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

Khi container app khởi động:

```
docker-entrypoint.sh
    │
    ├─ 1. Chờ DB sẵn sàng (wait-for-db.js × 30 lần, mỗi lần 2s)
    │     └─ TCP probe tới db:5432
    │
    ├─ 2. Chạy Prisma migrations
    │     └─ npx prisma migrate deploy
    │
    └─ 3. Khởi động Next.js
          └─ exec node server.js
```

### Database Health Check

Docker Compose cũng có health check riêng cho PostgreSQL:

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U vpsadmin -d vpscontrol"]
  interval: 5s
  timeout: 5s
  retries: 10
```

App service có `depends_on: db: condition: service_healthy` nên Docker sẽ không start app cho đến khi DB healthy.

---

## Cập nhật / Upgrade

### Pull code mới và rebuild:

```bash
git pull origin main
docker compose up -d --build
```

Prisma migrations sẽ tự động apply qua `docker-entrypoint.sh`.

### Nếu chỉ muốn restart:

```bash
docker compose restart app
```

---

## Backup Database

### Tạo backup:

```bash
docker compose exec db pg_dump -U vpsadmin vpscontrol > backup_$(date +%Y%m%d).sql
```

### Restore backup:

```bash
docker compose exec -T db psql -U vpsadmin vpscontrol < backup_20260209.sql
```

---

## Monitoring

### Xem resource usage:

```bash
docker stats vps-control-app vps-control-db
```

### Xem logs real-time:

```bash
# App logs
docker compose logs -f --tail=100 app

# Database logs
docker compose logs -f --tail=100 db
```

### Kiểm tra health:

```bash
# Container status
docker compose ps

# Database health
docker compose exec db pg_isready -U vpsadmin
```

---

## Xử lý sự cố Production

### App không start

```bash
# Xem logs
docker compose logs app

# Nguyên nhân phổ biến:
# 1. DB chưa ready → entrypoint retry 30 lần
# 2. Migration lỗi → kiểm tra schema
# 3. Thiếu env vars → kiểm tra .env
```

### Không truy cập được qua domain

1. Kiểm tra DNS: `dig panel.example.com`
2. Kiểm tra Traefik logs: `docker logs traefik`
3. Kiểm tra app có join đúng network: `docker network inspect traefik_network`
4. Kiểm tra Traefik dashboard (nếu bật)

### Database full disk

```bash
# Kiểm tra dung lượng
docker system df

# Dọn dẹp Docker
docker system prune -a --volumes
```
