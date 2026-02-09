# API Reference

> Tài liệu mô tả tất cả API endpoints, request/response format, và quy tắc chung.

---

## Quy tắc chung

### Base URL

```
/api
```

### Response Format

Tất cả API trả về cùng một cấu trúc:

```typescript
{
  success: boolean;
  data?: any;      // Có khi success = true
  error?: string;  // Có khi success = false
}
```

### Authentication

Hầu hết API yêu cầu xác thực qua JWT cookie (`vps-session`). Cookie được set tự động khi login.

Nếu chưa đăng nhập → trả về `401 Unauthorized`.

### Headers

```
Content-Type: application/json
```

Cookie `vps-session` được gửi tự động bởi browser.

---

## Auth Endpoints

### POST `/api/auth/login`

Đăng nhập và nhận JWT session.

**Request Body:**
```json
{
  "username": "admin",
  "password": "your-password"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "cuid...",
    "username": "admin"
  }
}
```

**Response (401):**
```json
{
  "success": false,
  "error": "Invalid credentials"
}
```

**Side effect:** Set cookie `vps-session` (HttpOnly, 7 ngày).

---

### POST `/api/auth/logout`

Xóa session cookie.

**Request Body:** không cần

**Response (200):**
```json
{
  "success": true
}
```

---

### GET `/api/auth/me`

Lấy thông tin user đang đăng nhập.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "cuid...",
    "username": "admin"
  }
}
```

**Response (401):** Chưa đăng nhập.

---

## Stats Endpoints

### GET `/api/stats`

Lấy snapshot thống kê hệ thống host hiện tại.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "cpu": 23.5,
    "memory": {
      "total": 16384,
      "used": 8192,
      "percentage": 50.0
    },
    "disk": {
      "total": 512000,
      "used": 256000,
      "percentage": 50.0
    },
    "uptime": 864000,
    "hostname": "vps-01",
    "os": "Linux 5.15.0"
  }
}
```

---

### GET `/api/stats/stream`

**Server-Sent Events** — stream real-time stats mỗi 2 giây.

**Response:** `text/event-stream`

```
data: {"cpu":23.5,"memory":{"total":16384,"used":8192,"percentage":50},...}

data: {"cpu":25.1,"memory":{"total":16384,"used":8300,"percentage":50.7},...}
```

**Cách sử dụng ở client:**
```typescript
const eventSource = new EventSource('/api/stats/stream');
eventSource.onmessage = (event) => {
  const stats = JSON.parse(event.data);
  console.log(stats.cpu); // 23.5
};
```

Hoặc dùng hook `useSSE`:
```typescript
const { data, error, connected } = useSSE<SystemStats>('/api/stats/stream');
```

---

## Server Endpoints

### GET `/api/servers`

Liệt kê tất cả servers (không bao gồm encrypted fields).

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "cuid...",
      "name": "Production VPS",
      "host": "192.168.1.100",
      "port": 22,
      "username": "root",
      "authMethod": "PASSWORD",
      "isActive": true,
      "lastConnected": "2026-02-09T10:00:00Z",
      "createdAt": "2026-02-01T00:00:00Z"
    }
  ]
}
```

---

### POST `/api/servers`

Tạo server mới. Credentials được mã hóa AES-256-GCM trước khi lưu.

**Request Body:**
```json
{
  "name": "Production VPS",
  "host": "192.168.1.100",
  "port": 22,
  "username": "root",
  "authMethod": "PASSWORD",
  "password": "ssh-password-here"
}
```

Hoặc dùng SSH key:
```json
{
  "name": "Production VPS",
  "host": "192.168.1.100",
  "port": 22,
  "username": "deploy",
  "authMethod": "KEY",
  "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n..."
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "cuid...",
    "name": "Production VPS",
    "host": "192.168.1.100",
    ...
  }
}
```

---

### GET `/api/servers/[id]`

Lấy thông tin một server.

**Response (200):** Tương tự item trong list.

**Response (404):** Server không tồn tại.

---

### PATCH `/api/servers/[id]`

Cập nhật thông tin server. Chỉ gửi các field cần thay đổi.

**Request Body:**
```json
{
  "name": "New Name",
  "host": "10.0.0.5"
}
```

**Response (200):** Server đã cập nhật.

---

### DELETE `/api/servers/[id]`

Xóa server.

**Response (200):**
```json
{
  "success": true
}
```

---

### GET `/api/servers/[id]/stats`

Lấy live system stats từ remote server qua SSH.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "cpu": 45.2,
    "memory": { "total": 8192, "used": 4096, "percentage": 50.0 },
    "disk": { "total": 256000, "used": 128000, "percentage": 50.0 },
    "uptime": 432000,
    "hostname": "remote-vps",
    "os": "Ubuntu 22.04"
  }
}
```

**Response (500):** Không kết nối được SSH.

---

## Network Endpoints

### GET `/api/network/ports`

Liệt kê các port đang mở trên host (dùng `ss -tulnp`).

**Response (200):**
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

---

### GET `/api/network/packages`

Liệt kê các packages đã cài trên host.

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "name": "nginx",
      "version": "1.24.0-1ubuntu1",
      "status": "installed"
    }
  ]
}
```

---

### POST `/api/network/packages`

Chạy apt update hoặc upgrade.

**Request Body:**
```json
{
  "action": "update"
}
```

Hoặc upgrade cụ thể:
```json
{
  "action": "upgrade",
  "packages": ["nginx", "curl"]
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "logs": "Reading package lists... Done\n..."
  }
}
```

---

## Deploy Endpoints

### GET `/api/deploy`

Lấy 20 deployment logs gần nhất.

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "cuid...",
      "repoUrl": "https://github.com/user/repo",
      "branch": "main",
      "detectedStack": "nextjs",
      "status": "RUNNING",
      "domain": "app.example.com",
      "createdAt": "2026-02-09T10:00:00Z"
    }
  ]
}
```

---

### POST `/api/deploy`

Bắt đầu deployment mới — clone repo, phát hiện tech stack.

**Request Body:**
```json
{
  "repoUrl": "https://github.com/user/repo",
  "branch": "main",
  "domain": "app.example.com"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "cuid...",
    "repoUrl": "https://github.com/user/repo",
    "branch": "main",
    "detectedStack": "nextjs",
    "status": "CLONING",
    "logs": "Cloning repository..."
  }
}
```

**Detected stacks:** `nextjs`, `react`, `vue`, `python`, `go`, `rust`, `node`, `static`

---

## HTTP Status Codes

| Code | Nghĩa                    | Khi nào                              |
| ---- | ------------------------- | ------------------------------------ |
| 200  | OK                        | Request thành công                   |
| 201  | Created                   | Tạo resource mới thành công          |
| 400  | Bad Request               | Input không hợp lệ                   |
| 401  | Unauthorized              | Chưa đăng nhập hoặc token hết hạn   |
| 404  | Not Found                 | Resource không tồn tại               |
| 405  | Method Not Allowed        | HTTP method không được hỗ trợ        |
| 500  | Internal Server Error     | Lỗi server (SSH fail, DB error, ...) |
