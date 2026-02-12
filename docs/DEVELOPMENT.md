# Development Guide

> Components, hooks, code conventions, and how to extend the project.

---

## Component Map

```
src/components/
│
├── ui/                    ← Primitives (reused everywhere)
│   ├── Button.tsx         Variants: primary, secondary, danger | Sizes: sm, md, lg | States: loading
│   ├── Card.tsx           Dark container with border
│   ├── Input.tsx          With label, error state, all HTML input attrs
│   ├── Badge.tsx          Variants: default, success, warning, danger
│   ├── Tabs.tsx           Tab-based content switching
│   └── ConfirmDialog.tsx  Modal dialog for destructive action confirmation
│
├── layout/
│   ├── Sidebar.tsx        Nav: Dashboard, Servers, Network, Apps, Deploy + collapse toggle
│   └── Header.tsx         Page title + user info
│
├── dashboard/
│   ├── StatsCard.tsx      Metric with icon, value, subtitle
│   ├── CpuGauge.tsx       Circular gauge (green < 60%, yellow 60-80%, red > 80%)
│   ├── MemoryBar.tsx      Bar chart (used vs total)
│   └── DiskUsage.tsx      Disk per partition
│
├── servers/
│   ├── ServerList.tsx           Table with actions (View, Edit, Delete)
│   ├── ServerForm.tsx           Create/edit form (password or SSH key auth)
│   ├── ServerStats.tsx          Live remote stats via SSH
│   ├── DockerContainerList.tsx  Remote Docker containers with start/stop/restart
│   ├── QuickActions.tsx         One-click server maintenance actions
│   └── ServiceList.tsx          Systemd service units listing
│
├── network/
│   ├── PortTable.tsx      Open ports table (Linux only, friendly warning on Windows)
│   ├── PackageManager.tsx APT packages + Update/Upgrade (Linux only)
│   └── NetworkTopology.tsx Docker networks + container IPs + host ports
│
├── apps/
│   ├── AppList.tsx        Application list with status indicators
│   └── AppLogViewer.tsx   Container log viewer for tracked apps
│
└── deploy/
    ├── DeployForm.tsx     Repo URL + branch + domain + server + path → POST /api/deploy
    └── DeployLog.tsx      History with status badges + expandable logs
```

### Library Map (`src/lib/`)

| File               | Purpose                                        |
| ------------------ | ---------------------------------------------- |
| `api-handler.ts`   | Shared API route handler wrapper               |
| `audit.ts`         | Audit logging utility                          |
| `auth.ts`          | JWT sessions + bcrypt                          |
| `crypto.ts`        | AES-256-GCM encrypt/decrypt                    |
| `db.ts`            | Prisma client singleton                        |
| `deployer.ts`      | Git clone + stack detection                    |
| `local-server.ts`  | Local VPS auto-detection                       |
| `notifications.ts` | Notification system                            |
| `sanitize.ts`      | Log sanitization (redact secrets)              |
| `server-ssh.ts`    | Per-server SSH connection helper               |
| `sse-stream.ts`    | SSE stream builder                             |
| `ssh.ts`           | SSH2 wrapper + remote ops                      |
| `stats.ts`         | Host system stats (os module)                  |
| `validation.ts`    | Input validation for all user-submitted values |

---

## Custom Hooks

### useSSE

Server-Sent Events connection with auto-reconnect.

```typescript
import { useSSE } from "@/hooks/useSSE";

const { data, error, connected } = useSSE<SystemStats>("/api/stats/stream");
```

### useAuth

Authentication state management.

```typescript
import { useAuth } from "@/hooks/useAuth";

const { user, loading, logout } = useAuth();
```

---

## Code Conventions

### TypeScript

- **Strict mode** enabled
- **No `any`** — always explicit types
- Interfaces for props and responses → `src/types/index.ts`

### React Components

- Function components only (no classes)
- **Named exports** (not default):

```typescript
// Correct
export function ServerList() { ... }
import { ServerList } from '@/components/servers/ServerList';

// Wrong
export default function ServerList() { ... }
```

- Add `"use client"` only when using hooks, event handlers, or browser APIs

### API Routes

- File: `src/app/api/<resource>/route.ts`
- Always include `export const dynamic = "force-dynamic"`
- Consistent response format:

```typescript
// Success
return NextResponse.json({ success: true, data: result });

// Error
return NextResponse.json({ success: false, error: "Message" }, { status: 400 });
```

- Always wrap in try/catch, check auth at the top

### File Naming

| Type       | Convention | Example                      |
| ---------- | ---------- | ---------------------------- |
| Components | PascalCase | `ServerForm.tsx`             |
| Hooks      | camelCase  | `useSSE.ts`                  |
| Libraries  | camelCase  | `crypto.ts`, `server-ssh.ts` |
| API Routes | `route.ts` | `api/servers/route.ts`       |
| Pages      | `page.tsx` | `dashboard/page.tsx`         |
| Types      | `index.ts` | `types/index.ts`             |

### Import Order

```typescript
// 1. React / Next.js
import { useState } from "react";
import { NextResponse } from "next/server";

// 2. External libraries
import { clsx } from "clsx";
import { Server } from "lucide-react";

// 3. Internal libs
import { prisma } from "@/lib/db";

// 4. Components
import { Button } from "@/components/ui/Button";

// 5. Types
import type { ServerInfo } from "@/types";
```

### Path Aliases

Use `@/` instead of relative paths:

```typescript
import { prisma } from "@/lib/db"; // ✓
import { prisma } from "../../../lib/db"; // ✗
```

### Styling

- Tailwind utility classes, dark theme by default
- Conditional classes with `clsx`:

```typescript
<div className={clsx('rounded-lg p-4', isActive ? 'bg-green-500/10' : 'bg-gray-800')}>
```

### Error Handling Pattern

```typescript
const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState("");

useEffect(() => {
  fetch("/api/resource")
    .then((res) => res.json())
    .then((json) => (json.success ? setData(json.data) : setError(json.error)))
    .catch(() => setError("Network error"))
    .finally(() => setLoading(false));
}, []);
```

---

## Git Workflow

### Branch Naming

```bash
git checkout -b feature/feature-name
git checkout -b fix/bug-name
```

### Commit Convention (Conventional Commits)

| Type       | When               | Example                              |
| ---------- | ------------------ | ------------------------------------ |
| `feat`     | New feature        | `feat: add server health monitoring` |
| `fix`      | Bug fix            | `fix: resolve SSH timeout`           |
| `chore`    | Maintenance        | `chore: update dependencies`         |
| `docs`     | Documentation      | `docs: update API reference`         |
| `refactor` | No behavior change | `refactor: extract SSH to lib`       |
| `style`    | Formatting         | `style: fix button padding`          |
| `perf`     | Performance        | `perf: optimize stats query`         |

---

## Adding a New Feature

### Checklist

1. [ ] Determine: new model? API? UI?
2. [ ] Update Prisma schema → `npm run db:push`
3. [ ] Create API route in `src/app/api/`
4. [ ] Create component(s) in `src/components/`
5. [ ] Create page in `src/app/(panel)/`
6. [ ] Add link to Sidebar
7. [ ] Update types in `src/types/index.ts`
8. [ ] Test on localhost
9. [ ] Update docs

### Example: Adding a "Logs" Page

```
1. API:       src/app/api/logs/route.ts
2. Component: src/components/logs/LogViewer.tsx
3. Page:      src/app/(panel)/logs/page.tsx
4. Sidebar:   src/components/layout/Sidebar.tsx → add to navItems array
5. Types:     src/types/index.ts → interface LogEntry
```

### Adding Environment Variables

1. Add to local `.env`
2. Update `deploy.sh` if auto-generated
3. Update `docker-compose.yml` if needed in container
4. **Never commit `.env`**

---

## Reference Links

| Topic          | URL                                       |
| -------------- | ----------------------------------------- |
| Next.js        | https://nextjs.org/docs                   |
| React          | https://react.dev                         |
| Prisma         | https://www.prisma.io/docs                |
| Tailwind CSS   | https://tailwindcss.com/docs              |
| ssh2-promise   | https://github.com/AkashBabu/ssh2-promise |
| jose (JWT)     | https://github.com/panva/jose             |
| Docker Compose | https://docs.docker.com/compose           |
| Traefik        | https://doc.traefik.io/traefik            |
