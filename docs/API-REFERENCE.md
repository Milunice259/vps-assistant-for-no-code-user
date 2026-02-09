# API Reference

> Complete documentation of all API endpoints, request/response formats, and conventions.

---

## General Conventions

### Base URL

```
/api
```

### Response Format

All API endpoints return a consistent structure:

```typescript
{
  success: boolean;
  data?: any;      // Present when success = true
  error?: string;  // Present when success = false
}
```

### Authentication

Most endpoints require authentication via a JWT cookie (`vps-session`). The cookie is set automatically upon login.

If not authenticated, the response will be `401 Unauthorized`.

### Headers

```
Content-Type: application/json
```

The `vps-session` cookie is sent automatically by the browser.

---

## Auth Endpoints

### POST `/api/auth/login`

Authenticate and receive a JWT session.

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

**Side effect:** Sets an HttpOnly cookie `vps-session` (7-day TTL).

---

### POST `/api/auth/logout`

Clear the session cookie.

**Request Body:** none

**Response (200):**
```json
{
  "success": true
}
```

---

### GET `/api/auth/me`

Get the currently authenticated user's info.

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

**Response (401):** Not authenticated.

---

## Stats Endpoints

### GET `/api/stats`

Get a snapshot of the host system's current stats.

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

**Server-Sent Events** — streams real-time host stats every 2 seconds.

**Response:** `text/event-stream`

```
data: {"cpu":23.5,"memory":{"total":16384,"used":8192,"percentage":50},...}

data: {"cpu":25.1,"memory":{"total":16384,"used":8300,"percentage":50.7},...}
```

**Client usage:**
```typescript
const eventSource = new EventSource('/api/stats/stream');
eventSource.onmessage = (event) => {
  const stats = JSON.parse(event.data);
  console.log(stats.cpu); // 23.5
};
```

Or use the `useSSE` hook:
```typescript
const { data, error, connected } = useSSE<SystemStats>('/api/stats/stream');
```

---

## Server Endpoints

### GET `/api/servers`

List all servers (encrypted fields are excluded).

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

Create a new server. Credentials are encrypted with AES-256-GCM before storage.

**Request Body (password auth):**
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

**Request Body (key auth):**
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

Get a single server by ID.

**Response (200):** Same shape as a list item.

**Response (404):** Server not found.

---

### PATCH `/api/servers/[id]`

Update a server. Only send the fields you want to change.

**Request Body:**
```json
{
  "name": "New Name",
  "host": "10.0.0.5"
}
```

**Response (200):** Updated server object.

---

### DELETE `/api/servers/[id]`

Delete a server.

**Response (200):**
```json
{
  "success": true
}
```

---

### GET `/api/servers/[id]/stats`

Fetch live system stats from a remote server via SSH.

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

**Response (500):** SSH connection failed.

---

## Network Endpoints

### GET `/api/network/ports`

List open ports on the host (uses `ss -tulnp`).

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

List installed apt packages on the host.

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

Run apt update or upgrade.

**Request Body (update):**
```json
{
  "action": "update"
}
```

**Request Body (upgrade specific packages):**
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

Get the 20 most recent deployment logs.

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

Start a new deployment — clones the repo and detects the tech stack.

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

| Code | Meaning                   | When                                 |
| ---- | ------------------------- | ------------------------------------ |
| 200  | OK                        | Request succeeded                    |
| 201  | Created                   | New resource created successfully    |
| 400  | Bad Request               | Invalid input                        |
| 401  | Unauthorized              | Not logged in or token expired       |
| 404  | Not Found                 | Resource does not exist              |
| 405  | Method Not Allowed        | HTTP method not supported            |
| 500  | Internal Server Error     | Server error (SSH fail, DB error, …) |
