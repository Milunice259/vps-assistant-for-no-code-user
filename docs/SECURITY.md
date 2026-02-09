# Security

> Tài liệu mô tả mô hình bảo mật, cơ chế xác thực, mã hóa dữ liệu, và các biện pháp an ninh của hệ thống.

---

## Tổng quan mô hình bảo mật

```
┌─────────────────────────────────────────────────────────┐
│                    SECURITY LAYERS                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. Traefik ──── TLS termination (HTTPS)               │
│                  Automatic cert renewal                  │
│                  HTTP → HTTPS redirect                   │
│                                                         │
│  2. Middleware ── JWT verification                       │
│                  Route protection (/panel/*)             │
│                                                         │
│  3. API Layer ── Input validation                       │
│                  Error sanitization                      │
│                                                         │
│  4. Auth ─────── bcrypt password hashing (12 rounds)    │
│                  JWT HS256 (HttpOnly cookie)             │
│                  7-day session TTL                       │
│                                                         │
│  5. Data ─────── AES-256-GCM encryption (credentials)  │
│                  Encryption key from env var             │
│                                                         │
│  6. Network ──── PostgreSQL on private bridge            │
│                  No external port exposure               │
│                  Container isolation                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Authentication (Xác thực)

### Flow đăng nhập

```
Client                    Server
  │                         │
  ├── POST /api/auth/login ─┤
  │   { username, password } │
  │                         ├── Tìm user trong DB
  │                         ├── bcrypt.compare(password, hash)
  │                         ├── Tạo JWT token (jose, HS256)
  │                         ├── Set HttpOnly cookie
  │                         │
  ◄── 200 { success, data } ┤
  │                         │
  ├── GET /api/stats ───────┤
  │   Cookie: vps-session    │
  │                         ├── middleware.ts kiểm tra JWT
  │                         ├── Verify token → extract userId
  │                         │
  ◄── 200 { data }          │
```

### Password Hashing

- **Library:** bcryptjs
- **Rounds:** 12 (đủ an toàn, không quá chậm)
- **Lưu:** Chỉ lưu hash, KHÔNG BAO GIỜ lưu plaintext

```typescript
// Hash khi tạo user
const hash = await bcrypt.hash(password, 12);

// Verify khi login
const valid = await bcrypt.compare(inputPassword, storedHash);
```

### JWT Token

- **Library:** jose (thay vì jsonwebtoken — nhẹ hơn, native crypto)
- **Algorithm:** HS256 (HMAC + SHA-256)
- **Secret:** `JWT_SECRET` (64 hex chars, sinh bởi `deploy.sh`)
- **Payload:** `{ userId, username, iat, exp }`
- **TTL:** 7 ngày

### Cookie Configuration

```typescript
{
  name: "vps-session",
  httpOnly: true,        // JS không đọc được → chống XSS
  secure: production,    // Chỉ gửi qua HTTPS trong production
  sameSite: "lax",       // Chống CSRF cơ bản
  maxAge: 7 * 24 * 3600, // 7 ngày
  path: "/"
}
```

### Middleware Protection

File `src/middleware.ts` bảo vệ tất cả routes trong group `(panel)`:

- Kiểm tra cookie `vps-session` tồn tại
- Verify JWT token
- Nếu không hợp lệ → redirect về `/login`
- API routes (`/api/*`) trả về 401 thay vì redirect

---

## Encryption (Mã hóa dữ liệu)

### Tại sao cần?

SSH credentials (password, private key) được lưu trong PostgreSQL. Nếu DB bị xâm nhập, attacker sẽ có toàn bộ SSH access tới các server. Mã hóa AES-256-GCM ngăn chặn điều này.

### Thuật toán: AES-256-GCM

| Thuộc tính      | Giá trị                           |
| --------------- | --------------------------------- |
| Algorithm       | AES-256-GCM                        |
| Key size        | 256 bits (32 bytes)                |
| IV size         | 128 bits (16 bytes, random mỗi lần) |
| Auth Tag size   | 128 bits (16 bytes)                |
| Output format   | `base64(IV + ciphertext + authTag)` |

### Tại sao GCM?

- **Authenticated:** Tự động phát hiện nếu ciphertext bị sửa đổi (tampering)
- **Fast:** Dùng AES-NI hardware acceleration
- **Standard:** NIST approved, dùng rộng rãi trong TLS 1.3

### Encryption Key

- Biến môi trường: `ENCRYPTION_KEY`
- Yêu cầu: Đúng 64 ký tự hex (= 32 bytes)
- Sinh bởi: `openssl rand -hex 32` (trong `deploy.sh`)
- **QUAN TRỌNG:** Nếu mất key, TẤT CẢ credentials trong DB sẽ không giải mã được

### Code Flow

```typescript
// Encrypt khi lưu server
import { encrypt, decrypt } from '@/lib/crypto';

const encryptedPass = encrypt(sshPassword);
// → "SGVsbG8gV29ybGQ=" (base64)

await prisma.server.create({
  data: { ...rest, encryptedPass }
});

// Decrypt khi SSH
const server = await prisma.server.findUnique({ where: { id } });
const password = decrypt(server.encryptedPass);
// → "original-ssh-password"
```

---

## SSH Security

### Auto-Accept Host Keys

`ssh2-promise` mặc định chấp nhận tất cả host keys nếu không cung cấp `hostVerifier`. Đây là quyết định có chủ đích:

- **Lý do:** Automation — khi thêm server mới, không cần confirm thủ công
- **Rủi ro:** Dễ bị Man-in-the-Middle nếu mạng không an toàn
- **Giảm thiểu:** Dùng trong môi trường server-to-server đáng tin cậy

### Supported Algorithms

```typescript
serverHostKey: [
  'ssh-ed25519',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'rsa-sha2-512',
  'rsa-sha2-256',
  'ssh-rsa'
]
```

### Connection Timeout

- **Timeout:** 10 giây
- Nếu server không phản hồi trong 10s → throw error

---

## Network Security

### Container Isolation

```
Internet → Traefik → [traefik_network] → App → [internal] → PostgreSQL
                                                    │
                                           ┌────────┘
                                           │
                              PostgreSQL KHÔNG có đường
                              ra internet (chỉ internal network)
```

### Không expose ports

- App container: Không publish port (Traefik truy cập qua Docker network)
- DB container: Không publish port (chỉ app truy cập qua internal network)

### TLS/HTTPS

- Traefik xử lý TLS termination
- Tự động cấp và renew chứng chỉ Let's Encrypt
- HTTP tự động redirect sang HTTPS

---

## Secret Management

### Các secrets trong hệ thống

| Secret            | Mục đích                          | Sinh bởi          | Độ dài       |
| ----------------- | --------------------------------- | ------------------ | ------------ |
| `DB_PASSWORD`     | PostgreSQL authentication         | `deploy.sh`        | 48 hex chars |
| `JWT_SECRET`      | Ký JWT tokens                     | `deploy.sh`        | 64 hex chars |
| `ENCRYPTION_KEY`  | Mã hóa AES-256-GCM               | `deploy.sh`        | 64 hex chars |
| `ADMIN_PASSWORD`  | Tài khoản admin đầu tiên         | Người dùng nhập    | Tùy ý        |

### Nguyên tắc

1. **Không hardcode** secrets trong code
2. **Không commit** `.env` vào git (đã có trong `.gitignore`)
3. **Sinh random** bằng `openssl rand -hex` (cryptographically secure)
4. **Không log** secrets ra console hay response

---

## Những hạn chế hiện tại

| Hạn chế                        | Mức độ   | Hướng cải thiện                         |
| ------------------------------- | -------- | --------------------------------------- |
| Không có rate limiting          | Trung bình | Thêm rate limiter middleware           |
| Không có 2FA                    | Trung bình | Thêm TOTP (Google Authenticator)       |
| Không có audit log              | Thấp     | Log mọi thao tác quan trọng vào DB     |
| SSH host key không verify       | Thấp     | Lưu known_hosts và verify              |
| Không có CORS policy rõ ràng    | Thấp     | Thêm CORS headers cho API              |
| Không có CSP headers            | Thấp     | Thêm Content-Security-Policy           |

---

## Checklist bảo mật khi deploy

- [ ] Domain đã trỏ đúng về server
- [ ] Traefik đang chạy với TLS enabled
- [ ] `.env` KHÔNG được commit vào git
- [ ] `ENCRYPTION_KEY` đã backup an toàn (mất = mất credentials)
- [ ] Admin password đủ mạnh (12+ ký tự, mixed case, numbers, symbols)
- [ ] Firewall mở đúng ports (80, 443 cho Traefik; đóng hết port khác)
- [ ] SSH key-based auth cho server host (không dùng password SSH vào host)
