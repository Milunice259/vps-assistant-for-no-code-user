# Database

> Tài liệu mô tả schema database, cách quản lý migrations, và cơ chế mã hóa dữ liệu nhạy cảm.

---

## Tổng quan

- **Engine:** PostgreSQL 16 (Alpine Docker image)
- **ORM:** Prisma
- **Schema file:** `prisma/schema.prisma`
- **Kết nối:** Qua internal Docker network (không exposed ra internet)

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

## Models chi tiết

### User

| Field         | Type     | Default     | Ghi chú                         |
| ------------- | -------- | ----------- | -------------------------------- |
| `id`          | String   | `cuid()`    | Primary key                      |
| `username`    | String   | —           | Unique, dùng để login            |
| `passwordHash`| String  | —           | bcrypt hash (12 rounds)          |
| `createdAt`   | DateTime | `now()`     | Thời điểm tạo                   |
| `updatedAt`   | DateTime | auto        | Tự cập nhật khi sửa             |

### Server

| Field           | Type       | Default    | Ghi chú                                |
| --------------- | ---------- | ---------- | --------------------------------------- |
| `id`            | String     | `cuid()`   | Primary key                             |
| `name`          | String     | —          | Tên hiển thị                            |
| `host`          | String     | —          | IP hoặc hostname                        |
| `port`          | Int        | `22`       | SSH port                                |
| `username`      | String     | —          | SSH username                            |
| `authMethod`    | AuthMethod | `PASSWORD` | PASSWORD hoặc KEY                       |
| `encryptedKey`  | String?    | null       | SSH private key, đã mã hóa AES-256-GCM |
| `encryptedPass` | String?    | null       | SSH password, đã mã hóa AES-256-GCM    |
| `isActive`      | Boolean    | `true`     | Đánh dấu server đang hoạt động         |
| `lastConnected` | DateTime?  | null       | Lần kết nối SSH gần nhất               |
| `createdAt`     | DateTime   | `now()`    |                                         |
| `updatedAt`     | DateTime   | auto       |                                         |

### DeploymentLog

| Field           | Type         | Default   | Ghi chú                        |
| --------------- | ------------ | --------- | ------------------------------- |
| `id`            | String       | `cuid()`  | Primary key                     |
| `repoUrl`       | String       | —         | URL GitHub repository           |
| `branch`        | String       | `"main"`  | Branch để clone                 |
| `detectedStack` | String       | —         | nextjs, react, vue, python, ... |
| `status`        | DeployStatus | `PENDING` | Trạng thái hiện tại             |
| `logs`          | String       | —         | Output logs (@db.Text)          |
| `domain`        | String?      | null      | Domain nếu có                   |
| `createdAt`     | DateTime     | `now()`   |                                 |
| `updatedAt`     | DateTime     | auto      |                                 |

## Enums

### AuthMethod

```prisma
enum AuthMethod {
  PASSWORD   // Xác thực bằng password
  KEY        // Xác thực bằng SSH private key
}
```

### DeployStatus

```prisma
enum DeployStatus {
  PENDING    // Chờ xử lý
  CLONING    // Đang clone repo
  BUILDING   // Đang build
  RUNNING    // Đang chạy
  FAILED     // Thất bại
}
```

## Mã hóa dữ liệu (AES-256-GCM)

### Tại sao cần mã hóa?

Các field `encryptedKey` và `encryptedPass` chứa SSH credentials. Nếu database bị xâm nhập (SQL injection, backup leak, ...), attacker không thể đọc được credentials vì chúng đã được mã hóa.

### Cách hoạt động

```
Plaintext → encrypt() → base64(IV + ciphertext + authTag) → lưu DB
                    ↓
Đọc DB → base64 string → decrypt() → Plaintext → dùng cho SSH
```

- **Algorithm:** AES-256-GCM (authenticated encryption with associated data)
- **IV:** 16 bytes random, sinh mới mỗi lần encrypt
- **Auth Tag:** 16 bytes, đảm bảo dữ liệu không bị sửa đổi
- **Key:** Lấy từ `ENCRYPTION_KEY` (biến môi trường, 32 bytes = 64 hex chars)

### Code location

- Encrypt/Decrypt: `src/lib/crypto.ts`
- Sử dụng: `src/app/api/servers/route.ts` (POST), `src/app/api/servers/[id]/route.ts` (PATCH), `src/app/api/servers/[id]/stats/route.ts` (GET — decrypt để SSH)

---

## Quản lý Migrations

### Tạo migration mới

Khi thay đổi `prisma/schema.prisma`:

```bash
npm run db:migrate
```

Prisma sẽ:
1. So sánh schema hiện tại với DB
2. Tạo file SQL migration trong `prisma/migrations/`
3. Hỏi tên cho migration
4. Apply migration vào DB

### Apply migrations trong production

Chạy tự động bởi `docker-entrypoint.sh`:

```bash
npx prisma migrate deploy
```

Lệnh này chỉ apply các migration chưa chạy, không tạo migration mới.

### Push schema trực tiếp (dev only)

```bash
npm run db:push
```

Thay đổi DB trực tiếp theo schema mà không tạo migration file. **Chỉ dùng trong development.**

### Mở Prisma Studio

```bash
npm run db:studio
```

Mở GUI tại `http://localhost:5555` để xem/sửa dữ liệu trực tiếp.

---

## Prisma Client Singleton

File `src/lib/db.ts` đảm bảo chỉ có 1 instance Prisma Client trong toàn bộ app:

```typescript
// Trong development, Next.js hot reload có thể tạo nhiều instances
// globalThis trick ngăn chặn điều này
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

---

## Seed Data

File `scripts/seed.ts` tạo tài khoản admin ban đầu:

```bash
npm run db:seed
```

Sử dụng `ADMIN_USERNAME` và `ADMIN_PASSWORD` từ `.env`. Password được hash bằng bcrypt trước khi lưu.

---

## Kết nối Database

### Trong Docker (Production)

```
DATABASE_URL=postgresql://vpsadmin:${DB_PASSWORD}@db:5432/vpscontrol
```

- Host: `db` (tên service trong docker-compose)
- Network: `internal` (bridge)

### Local Development

```
DATABASE_URL=postgresql://vpsadmin:devpassword123@localhost:5432/vpscontrol
```

- Host: `localhost`
- Port: `5432` (mapped từ Docker container)
