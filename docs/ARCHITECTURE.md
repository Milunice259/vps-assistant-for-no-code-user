# Architecture Overview

> Tài liệu mô tả kiến trúc tổng quan của VPS Control App, các quyết định thiết kế, và cách các thành phần kết nối với nhau.

---

## Sơ đồ hệ thống

```
                          Internet
                             │
                             ▼
                     ┌───────────────┐
                     │    Traefik    │  ← Reverse proxy có sẵn trên host
                     │  (HTTPS/TLS) │     Tự động cấp chứng chỉ Let's Encrypt
                     └───────┬───────┘
                             │
                     traefik_network (external Docker network)
                             │
                             ▼
                    ┌─────────────────┐
                    │  Next.js App    │  ← Container: vps-control-app
                    │  Port 3000      │     Chạy cả Frontend + API
                    │  (standalone)   │
                    └────────┬────────┘
                             │
                     internal (private bridge network)
                             │
                             ▼
                    ┌─────────────────┐
                    │   PostgreSQL    │  ← Container: vps-control-db
                    │   Port 5432     │     KHÔNG exposed ra internet
                    │   (encrypted)   │     Chỉ app mới truy cập được
                    └─────────────────┘
```

## Kiến trúc mạng Docker

Hệ thống sử dụng 2 Docker networks:

| Network          | Loại     | Mục đích                                            |
| ---------------- | -------- | --------------------------------------------------- |
| `traefik_network` | External | Kết nối app với Traefik để nhận traffic từ internet |
| `internal`        | Bridge   | Kết nối nội bộ giữa app và PostgreSQL              |

**Nguyên tắc:** PostgreSQL chỉ nằm trên mạng `internal`, hoàn toàn cách ly khỏi internet. Chỉ có Next.js app (nằm trên cả hai mạng) mới truy cập được database.

## Luồng request

```
Client (Browser)
  │
  ▼
Traefik (TLS termination, routing theo domain)
  │
  ▼
Next.js App ──┬── Server Components (SSR HTML)
              ├── API Routes (/api/*)
              │     ├── Auth (JWT cookie)
              │     ├── CRUD servers (encrypt/decrypt credentials)
              │     ├── SSH connections (ssh2-promise)
              │     ├── SSE stream (real-time stats)
              │     └── Deploy (git clone + stack detect)
              └── Static assets
```

## Quyết định thiết kế chính

### 1. Monolith trong Docker

Toàn bộ app (frontend + API) chạy trong một container Next.js duy nhất. Lý do:

- **Đơn giản hóa deployment** — chỉ cần 2 container (app + db)
- **Giảm độ phức tạp** — không cần message queue, API gateway riêng
- **Phù hợp quy mô** — app quản lý VPS, không phải SaaS nhiều người dùng

### 2. Next.js App Router

Sử dụng App Router (không phải Pages Router) với cấu trúc route groups:

- `(auth)` — Layout cho trang login (không sidebar)
- `(panel)` — Layout chính với sidebar + header (cần đăng nhập)

### 3. Server-Sent Events thay vì WebSocket

Dashboard dùng SSE để stream real-time stats. Lý do:

- **Một chiều** — server → client, phù hợp cho monitoring
- **Đơn giản** — không cần socket server riêng, chạy trên API route
- **Tương thích** — hoạt động qua HTTP/2, không bị firewall chặn
- **Auto-reconnect** — `EventSource` API tự kết nối lại khi mất kết nối

### 4. AES-256-GCM cho dữ liệu nhạy cảm

Thay vì lưu plaintext SSH credentials vào DB, tất cả đều được mã hóa:

- **Thuật toán:** AES-256-GCM (authenticated encryption)
- **Format:** `base64(IV[16] + ciphertext + authTag[16])`
- **Key:** `ENCRYPTION_KEY` environment variable (32 bytes hex)

Xem chi tiết tại [SECURITY.md](./SECURITY.md) và [DATABASE.md](./DATABASE.md).

### 5. JWT với HttpOnly Cookie

Không dùng token trong localStorage (dễ bị XSS):

- JWT được lưu trong **HttpOnly cookie** — JavaScript không đọc được
- Cookie có flag `Secure` trong production — chỉ gửi qua HTTPS
- `SameSite: lax` — chống CSRF cơ bản
- TTL: 7 ngày

### 6. Standalone Output cho Docker

`next.config.ts` có `output: "standalone"` để Next.js tạo ra một folder nhỏ gọn chứa đủ mọi thứ cần thiết, không cần copy cả `node_modules`.

### 7. SSH Host Key Auto-Accept

`ssh2-promise` mặc định chấp nhận tất cả host keys nếu không cung cấp `hostVerifier`. Đây là quyết định có chủ đích cho automation — khi kết nối VPS mới, không cần confirm thủ công.

## Cấu trúc thư mục

```
src/
├── app/                  # Next.js App Router
│   ├── (auth)/           # Route group: trang login
│   ├── (panel)/          # Route group: panel chính (cần auth)
│   ├── api/              # API Routes (backend)
│   ├── layout.tsx        # Root layout (dark theme)
│   ├── globals.css       # Global styles + Tailwind
│   └── page.tsx          # Root → redirect /dashboard
│
├── components/           # React components
│   ├── dashboard/        # Gauge, bar, card cho stats
│   ├── deploy/           # Form + log cho deployment
│   ├── layout/           # Sidebar, Header
│   ├── network/          # Port table, Package manager
│   ├── servers/          # CRUD + stats cho servers
│   └── ui/               # Primitives: Button, Card, Input, Badge
│
├── hooks/                # Custom React hooks
│   ├── useAuth.ts        # Hook quản lý authentication
│   └── useSSE.ts         # Hook cho Server-Sent Events
│
├── lib/                  # Backend utilities
│   ├── auth.ts           # JWT + bcrypt + cookie management
│   ├── crypto.ts         # AES-256-GCM encrypt/decrypt
│   ├── db.ts             # Prisma client singleton
│   ├── deployer.ts       # Git clone + stack detection
│   ├── ssh.ts            # SSH connection wrapper
│   └── stats.ts          # Host system stats (os module)
│
├── middleware.ts          # Auth guard cho protected routes
│
└── types/                # TypeScript interfaces
    └── index.ts          # SystemStats, ServerInfo, PortInfo, etc.
```

## Tech Stack

| Layer        | Công nghệ                  | Phiên bản | Ghi chú                           |
| ------------ | -------------------------- | --------- | --------------------------------- |
| Framework    | Next.js                    | 16 (LTS)  | App Router, standalone output     |
| UI           | React                      | 19.2      | Server + Client Components        |
| Language     | TypeScript                 | 5.7+      | Strict mode                       |
| Styling      | Tailwind CSS               | 3.4       | Dark theme, custom brand colors   |
| Database     | PostgreSQL                 | 16        | Alpine Docker image               |
| ORM          | Prisma                     | Latest    | Type-safe queries, migrations     |
| Auth         | jose + bcryptjs            | 5.0 / 2.4 | JWT HS256, bcrypt 12 rounds      |
| SSH          | ssh2-promise               | 1.0.3     | Remote VPS management             |
| Icons        | lucide-react               | 0.500+    | Consistent icon set               |
| Charts       | recharts                   | 2.15      | Dashboard visualizations          |
| Proxy        | Traefik                    | External  | TLS, routing, load balancing      |
| Container    | Docker + Compose           | —         | Multi-stage builds                |
