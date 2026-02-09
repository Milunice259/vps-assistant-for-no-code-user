# Contributing

> Hướng dẫn quy trình đóng góp code, conventions, và cách làm việc với dự án.

---

## Quy trình làm việc

### 1. Tạo branch

```bash
git checkout -b feature/ten-tinh-nang
# hoặc
git checkout -b fix/ten-bug
```

### 2. Code & Test

```bash
npm run dev        # Chạy dev server
npm run lint       # Kiểm tra lỗi
npm run build      # Kiểm tra build production
```

### 3. Commit

Tuân theo [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <mô tả ngắn>

[body tùy chọn]
```

**Types:**

| Type       | Khi nào                              | Ví dụ                                    |
| ---------- | ------------------------------------ | ----------------------------------------- |
| `feat`     | Thêm tính năng mới                  | `feat: add server health monitoring`      |
| `fix`      | Sửa bug                             | `fix: resolve SSH connection timeout`     |
| `chore`    | Công việc bảo trì                   | `chore: update dependencies`              |
| `docs`     | Thêm/sửa tài liệu                  | `docs: update API reference`              |
| `refactor` | Refactor code (không thay đổi behavior) | `refactor: extract SSH logic to lib`  |
| `style`    | Sửa style/formatting                | `style: fix button padding`               |
| `perf`     | Cải thiện performance                | `perf: optimize stats query`              |
| `test`     | Thêm/sửa tests                      | `test: add server CRUD tests`             |

### 4. Push & PR

```bash
git push origin feature/ten-tinh-nang
```

Tạo Pull Request trên GitHub.

---

## Code Conventions

### TypeScript

- **Strict mode** — bật trong `tsconfig.json`
- **No `any`** — luôn type rõ ràng
- **Interfaces** cho props, response types → đặt trong `src/types/index.ts`

```typescript
// ✅ Đúng
interface ServerFormProps {
  server?: ServerInfo;
  onSubmit: (data: CreateServerInput) => Promise<void>;
}

// ❌ Sai
function ServerForm(props: any) { ... }
```

### React Components

- Dùng **function components** (không class components)
- Dùng **named exports** (không default exports)
- `"use client"` chỉ khi cần hooks hoặc browser APIs
- Props type inline hoặc interface riêng

```typescript
"use client";

import { useState } from 'react';

interface Props {
  title: string;
  onAction: () => void;
}

export function MyComponent({ title, onAction }: Props) {
  const [loading, setLoading] = useState(false);
  // ...
}
```

### API Routes

- File: `src/app/api/<resource>/route.ts`
- Luôn có `export const dynamic = "force-dynamic"`
- Response format nhất quán:

```typescript
// Thành công
return NextResponse.json({ success: true, data: result });

// Lỗi
return NextResponse.json(
  { success: false, error: 'Message' },
  { status: 400 }
);
```

- Luôn wrap trong try/catch
- Kiểm tra auth ở đầu route handler

```typescript
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // ... logic

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### File Naming

| Loại              | Convention          | Ví dụ                   |
| ----------------- | ------------------- | ----------------------- |
| Components        | PascalCase          | `ServerForm.tsx`        |
| Hooks             | camelCase, `use-`   | `useSSE.ts`             |
| Libraries         | camelCase            | `crypto.ts`             |
| API Routes        | `route.ts`           | `api/servers/route.ts`  |
| Pages             | `page.tsx`           | `dashboard/page.tsx`    |
| Layouts           | `layout.tsx`         | `(panel)/layout.tsx`    |
| Types             | `index.ts`           | `types/index.ts`        |

### Import Order

```typescript
// 1. React / Next.js
import { useState, useEffect } from 'react';
import { NextResponse } from 'next/server';

// 2. External libraries
import { clsx } from 'clsx';
import { Server, Wifi } from 'lucide-react';

// 3. Internal libs
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

// 4. Components
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

// 5. Types
import type { ServerInfo } from '@/types';
```

### Path Aliases

Dùng `@/` thay vì relative paths:

```typescript
// ✅ Đúng
import { prisma } from '@/lib/db';

// ❌ Sai
import { prisma } from '../../../lib/db';
```

Cấu hình trong `tsconfig.json`:
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

---

## Thêm tính năng mới

### Checklist

1. [ ] Xác định feature cần gì: model mới? API mới? UI mới?
2. [ ] Cập nhật Prisma schema nếu cần → `npm run db:migrate`
3. [ ] Tạo API route(s) trong `src/app/api/`
4. [ ] Tạo component(s) trong `src/components/`
5. [ ] Tạo page trong `src/app/(panel)/`
6. [ ] Thêm link vào Sidebar nếu là page mới
7. [ ] Cập nhật types trong `src/types/index.ts`
8. [ ] Test trên localhost
9. [ ] Cập nhật docs nếu cần

### Ví dụ: Thêm trang "Logs"

```
1. Tạo API:     src/app/api/logs/route.ts
2. Tạo Component: src/components/logs/LogViewer.tsx
3. Tạo Page:    src/app/(panel)/logs/page.tsx
4. Thêm Sidebar: src/components/layout/Sidebar.tsx → thêm menu item
5. Thêm Types:  src/types/index.ts → interface LogEntry
```

---

## Cấu trúc Database Migration

Khi thay đổi schema:

```bash
# 1. Sửa prisma/schema.prisma
# 2. Tạo migration
npm run db:migrate
# 3. Nhập tên migration (ví dụ: add_logs_table)
# 4. Kiểm tra file SQL trong prisma/migrations/
# 5. Commit cả schema + migration files
```

---

## Environment Variables

Khi thêm biến môi trường mới:

1. Thêm vào `.env` local
2. Cập nhật `deploy.sh` nếu cần tự sinh
3. Cập nhật `docker-compose.yml` nếu cần pass vào container
4. Cập nhật `docs/DEPLOYMENT.md` và `docs/GETTING-STARTED.md`
5. **KHÔNG** commit `.env`

---

## Tài liệu tham khảo

| Chủ đề           | Link                                                |
| ---------------- | --------------------------------------------------- |
| Next.js          | https://nextjs.org/docs                             |
| React            | https://react.dev                                    |
| Prisma           | https://www.prisma.io/docs                           |
| Tailwind CSS     | https://tailwindcss.com/docs                         |
| ssh2-promise     | https://github.com/AkashBabu/ssh2-promise           |
| jose (JWT)       | https://github.com/panva/jose                        |
| Docker Compose   | https://docs.docker.com/compose                      |
| Traefik          | https://doc.traefik.io/traefik                       |
