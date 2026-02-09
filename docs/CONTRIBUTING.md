# Contributing

> Development workflow, code conventions, and how to extend the project.

---

## Workflow

### 1. Create a branch

```bash
git checkout -b feature/feature-name
# or
git checkout -b fix/bug-name
```

### 2. Code & Test

```bash
npm run dev        # Start dev server
npm run lint       # Check for errors
npm run build      # Verify production build
```

### 3. Commit

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short description>

[optional body]
```

**Types:**

| Type       | When                                | Example                                   |
| ---------- | ----------------------------------- | ----------------------------------------- |
| `feat`     | Adding a new feature                | `feat: add server health monitoring`      |
| `fix`      | Fixing a bug                        | `fix: resolve SSH connection timeout`     |
| `chore`    | Maintenance work                    | `chore: update dependencies`              |
| `docs`     | Adding/updating docs                | `docs: update API reference`              |
| `refactor` | Refactoring (no behavior change)    | `refactor: extract SSH logic to lib`      |
| `style`    | Style/formatting changes            | `style: fix button padding`               |
| `perf`     | Performance improvements            | `perf: optimize stats query`              |
| `test`     | Adding/updating tests               | `test: add server CRUD tests`             |

### 4. Push & PR

```bash
git push origin feature/feature-name
```

Create a Pull Request on GitHub.

---

## Code Conventions

### TypeScript

- **Strict mode** — enabled in `tsconfig.json`
- **No `any`** — always use explicit types
- **Interfaces** for props and response types → place in `src/types/index.ts`

```typescript
// Correct
interface ServerFormProps {
  server?: ServerInfo;
  onSubmit: (data: CreateServerInput) => Promise<void>;
}

// Incorrect
function ServerForm(props: any) { ... }
```

### React Components

- Use **function components** (no class components)
- Use **named exports** (no default exports)
- Only add `"use client"` when hooks or browser APIs are needed
- Props typing: inline or via a separate interface

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
- Always include `export const dynamic = "force-dynamic"`
- Consistent response format:

```typescript
// Success
return NextResponse.json({ success: true, data: result });

// Error
return NextResponse.json(
  { success: false, error: 'Message' },
  { status: 400 }
);
```

- Always wrap in try/catch
- Check authentication at the top of every handler

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

| Type              | Convention          | Example                 |
| ----------------- | ------------------- | ----------------------- |
| Components        | PascalCase          | `ServerForm.tsx`        |
| Hooks             | camelCase, `use-`   | `useSSE.ts`             |
| Libraries         | camelCase           | `crypto.ts`             |
| API Routes        | `route.ts`          | `api/servers/route.ts`  |
| Pages             | `page.tsx`          | `dashboard/page.tsx`    |
| Layouts           | `layout.tsx`        | `(panel)/layout.tsx`    |
| Types             | `index.ts`          | `types/index.ts`        |

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

Use `@/` instead of relative paths:

```typescript
// Correct
import { prisma } from '@/lib/db';

// Incorrect
import { prisma } from '../../../lib/db';
```

Configured in `tsconfig.json`:
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

## Adding a New Feature

### Checklist

1. [ ] Determine what's needed: new model? new API? new UI?
2. [ ] Update Prisma schema if needed → `npm run db:migrate`
3. [ ] Create API route(s) in `src/app/api/`
4. [ ] Create component(s) in `src/components/`
5. [ ] Create a page in `src/app/(panel)/`
6. [ ] Add a link to the Sidebar if it's a new page
7. [ ] Update types in `src/types/index.ts`
8. [ ] Test on localhost
9. [ ] Update docs if applicable

### Example: Adding a "Logs" Page

```
1. Create API:      src/app/api/logs/route.ts
2. Create Component: src/components/logs/LogViewer.tsx
3. Create Page:     src/app/(panel)/logs/page.tsx
4. Update Sidebar:  src/components/layout/Sidebar.tsx → add menu item
5. Add Types:       src/types/index.ts → interface LogEntry
```

---

## Database Schema Changes

When modifying the schema:

```bash
# 1. Edit prisma/schema.prisma
# 2. Create a migration
npm run db:migrate
# 3. Enter a migration name (e.g., add_logs_table)
# 4. Review the SQL file in prisma/migrations/
# 5. Commit both the schema and migration files
```

---

## Environment Variables

When adding a new environment variable:

1. Add it to your local `.env`
2. Update `deploy.sh` if it should be auto-generated
3. Update `docker-compose.yml` if it needs to be passed into the container
4. Update `docs/DEPLOYMENT.md` and `docs/GETTING-STARTED.md`
5. **NEVER** commit `.env`

---

## Reference Links

| Topic            | URL                                                 |
| ---------------- | --------------------------------------------------- |
| Next.js          | https://nextjs.org/docs                             |
| React            | https://react.dev                                   |
| Prisma           | https://www.prisma.io/docs                          |
| Tailwind CSS     | https://tailwindcss.com/docs                        |
| ssh2-promise     | https://github.com/AkashBabu/ssh2-promise           |
| jose (JWT)       | https://github.com/panva/jose                       |
| Docker Compose   | https://docs.docker.com/compose                     |
| Traefik          | https://doc.traefik.io/traefik                      |
