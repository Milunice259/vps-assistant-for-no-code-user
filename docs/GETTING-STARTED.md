# Getting Started

> Hướng dẫn thiết lập môi trường phát triển và chạy dự án trên máy local.

---

## Yêu cầu hệ thống

| Công cụ         | Phiên bản tối thiểu | Kiểm tra                   |
| --------------- | -------------------- | -------------------------- |
| Node.js         | 20.x                 | `node --version`          |
| npm             | 10.x                 | `npm --version`           |
| Docker          | 24.x                 | `docker --version`        |
| Docker Compose  | 2.x                  | `docker compose version`  |
| Git             | 2.x                  | `git --version`           |

## Thiết lập lần đầu

### 1. Clone repository

```bash
git clone https://github.com/Milunice259/vps-assistant-for-no-code-user.git
cd vps-assistant-for-no-code-user
```

### 2. Cài đặt dependencies

```bash
npm install
```

Lệnh `postinstall` sẽ tự động chạy `prisma generate` để tạo Prisma Client.

### 3. Khởi động PostgreSQL

Chạy PostgreSQL bằng Docker (chỉ database, không chạy app):

```bash
docker run -d \
  --name vps-dev-db \
  -e POSTGRES_USER=vpsadmin \
  -e POSTGRES_PASSWORD=devpassword123 \
  -e POSTGRES_DB=vpscontrol \
  -p 5432:5432 \
  postgres:16-alpine
```

### 4. Tạo file .env

Tạo file `.env` tại root dự án:

```env
# ─── Database ───
DATABASE_URL="postgresql://vpsadmin:devpassword123@localhost:5432/vpscontrol"
DB_HOST=localhost
DB_PORT=5432

# ─── Security ───
JWT_SECRET=dev-jwt-secret-change-in-production-must-be-64-hex-chars-long-ok
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# ─── Admin Account (dùng cho seed) ───
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

> **Lưu ý:** Đây là giá trị cho development. KHÔNG dùng trong production. `deploy.sh` sẽ tự động sinh các secret an toàn khi deploy thật.

### 5. Chạy database migrations

```bash
npm run db:migrate
```

Prisma sẽ tạo các bảng `User`, `Server`, `DeploymentLog` trong PostgreSQL.

### 6. Seed dữ liệu ban đầu (tùy chọn)

```bash
npm run db:seed
```

Tạo tài khoản admin với username/password từ `.env`.

### 7. Khởi động dev server

```bash
npm run dev
```

Truy cập: **http://localhost:3000**

---

## Các lệnh thường dùng

### Development

| Lệnh              | Mô tả                                     |
| ------------------ | ------------------------------------------ |
| `npm run dev`      | Chạy Next.js dev server (hot reload)       |
| `npm run build`    | Build production                            |
| `npm run start`    | Chạy production build                       |
| `npm run lint`     | Kiểm tra lỗi ESLint                        |

### Database

| Lệnh               | Mô tả                                        |
| ------------------- | --------------------------------------------- |
| `npm run db:migrate` | Tạo và chạy migration mới                    |
| `npm run db:push`    | Push schema trực tiếp (không tạo migration)  |
| `npm run db:generate`| Tạo lại Prisma Client                        |
| `npm run db:seed`    | Seed dữ liệu ban đầu                        |
| `npm run db:studio`  | Mở Prisma Studio (GUI quản lý DB)           |

### Docker (Production)

| Lệnh                              | Mô tả                            |
| ---------------------------------- | --------------------------------- |
| `docker compose up -d --build`     | Build và chạy toàn bộ stack       |
| `docker compose down`              | Dừng tất cả containers            |
| `docker compose logs -f app`       | Xem logs của app                  |
| `docker compose logs -f db`        | Xem logs của database             |
| `docker compose exec app sh`       | Shell vào container app           |
| `docker compose exec db psql -U vpsadmin vpscontrol` | Kết nối psql  |

---

## Cấu trúc URL

| URL                 | Mô tả                          | Auth cần? |
| ------------------- | ------------------------------- | --------- |
| `/`                 | Redirect → `/dashboard`        | Có        |
| `/login`            | Trang đăng nhập                | Không     |
| `/dashboard`        | Dashboard real-time stats       | Có        |
| `/servers`          | Quản lý danh sách VPS          | Có        |
| `/servers/[id]`     | Chi tiết + stats một VPS       | Có        |
| `/network`          | Quản lý ports + packages        | Có        |
| `/deploy`           | GitHub deployer                 | Có        |

---

## Xử lý sự cố thường gặp

### Lỗi "Cannot find module '@prisma/client'"

```bash
npm run db:generate
```

### Lỗi kết nối database

1. Kiểm tra PostgreSQL đang chạy: `docker ps`
2. Kiểm tra `DATABASE_URL` trong `.env`
3. Kiểm tra port 5432 không bị chiếm: `lsof -i :5432` (Linux/Mac)

### Lỗi "ENCRYPTION_KEY must be a 64-character hex string"

`ENCRYPTION_KEY` phải đúng 64 ký tự hex (a-f, 0-9). Sinh bằng:

```bash
openssl rand -hex 32
```

### Lỗi native module (ssh2-promise)

Trên một số hệ thống cần build tools:

```bash
# macOS
xcode-select --install

# Ubuntu/Debian
sudo apt install python3 make g++

# Windows
npm install --global windows-build-tools
```

### Port 3000 đã bị chiếm

```bash
# Tìm process
lsof -i :3000          # Linux/Mac
netstat -ano | find "3000"  # Windows

# Hoặc đổi port
PORT=3001 npm run dev
```
