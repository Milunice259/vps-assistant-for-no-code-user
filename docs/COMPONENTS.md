# Components & UI

> React components, custom hooks, design patterns, and how to extend the UI.

---

## Overview

The UI is built with:

- **React 19.2** — Server Components + Client Components
- **Tailwind CSS 3.4** — Utility-first, dark theme by default
- **lucide-react** — Icon library (consistent, tree-shakeable)
- **recharts** — Charts for the dashboard
- **clsx** — Conditional CSS classes

The entire app uses a **dark theme** (`bg-gray-950` background, light text).

---

## Component Map

```
src/components/
│
├── ui/                    ← Primitives (reused everywhere)
│   ├── Button.tsx
│   ├── Card.tsx
│   ├── Input.tsx
│   └── Badge.tsx
│
├── layout/                ← Main layout structure
│   ├── Sidebar.tsx
│   └── Header.tsx
│
├── dashboard/             ← Stats visualizations
│   ├── StatsCard.tsx
│   ├── CpuGauge.tsx
│   ├── MemoryBar.tsx
│   └── DiskUsage.tsx
│
├── servers/               ← Server CRUD + monitoring
│   ├── ServerList.tsx
│   ├── ServerForm.tsx
│   └── ServerStats.tsx
│
├── network/               ← Network management
│   ├── PortTable.tsx
│   └── PackageManager.tsx
│
└── deploy/                ← GitHub deployment
    ├── DeployForm.tsx
    └── DeployLog.tsx
```

---

## UI Primitives (`components/ui/`)

Base components reused throughout the entire app.

### Button

```typescript
import { Button } from '@/components/ui/Button';

// Variants: primary (default), secondary, danger
// Sizes: sm, md (default), lg
// States: loading, disabled

<Button variant="primary" size="lg" loading={isSubmitting}>
  Save Server
</Button>

<Button variant="danger" onClick={handleDelete}>
  Delete
</Button>
```

### Card

```typescript
import { Card } from '@/components/ui/Card';

// Container component with dark background and border

<Card>
  <h2>Title</h2>
  <p>Content</p>
</Card>
```

### Input

```typescript
import { Input } from '@/components/ui/Input';

// Supports label, error state, and all HTML input attributes

<Input
  label="Hostname"
  placeholder="192.168.1.100"
  error={errors.host}
  {...register('host')}
/>
```

### Badge

```typescript
import { Badge } from '@/components/ui/Badge';

// Variants: default, success, warning, danger

<Badge variant="success">Running</Badge>
<Badge variant="danger">Failed</Badge>
```

---

## Layout Components (`components/layout/`)

### Sidebar

Left-side navigation menu containing:
- Logo / App name
- Menu items: Dashboard, Servers, Network, Deploy
- Active state highlighting based on current route
- Logout button

### Header

Top bar containing:
- Page title (dynamic based on route)
- User info

---

## Dashboard Components (`components/dashboard/`)

### StatsCard

Displays a single metric with an icon, value, and description.

```typescript
<StatsCard
  title="CPU Usage"
  value="23.5%"
  subtitle="4 cores"
  icon={<Cpu />}
/>
```

### CpuGauge

Circular gauge displaying CPU usage percentage. Changes color by level:
- Green: < 60%
- Yellow: 60-80%
- Red: > 80%

### MemoryBar

Bar chart showing memory usage (used vs total).

### DiskUsage

Displays disk usage per partition.

---

## Server Components (`components/servers/`)

### ServerList

Table listing all servers:
- Name, host, port, status
- Actions: View, Edit, Delete
- Badge for status (active/inactive)

### ServerForm

Form for creating/editing servers:
- Fields: name, host, port, username
- Auth method selector (Password vs SSH Key)
- Conditional fields (password input or key textarea)
- Validation

### ServerStats

Displays live stats from a remote server:
- CPU, Memory, Disk gauges
- Uptime, hostname, OS info
- Loading/error states

---

## Network Components (`components/network/`)

### PortTable

Table listing open ports:
- Protocol, Address, Port, Process, State
- Filterable

### PackageManager

Apt package management UI:
- Installed packages list
- Update / Upgrade buttons
- Log output

---

## Deploy Components (`components/deploy/`)

### DeployForm

GitHub deployment form:
- Repository URL
- Branch (default: main)
- Domain (optional)
- Submit → calls POST /api/deploy

### DeployLog

Deployment history display:
- Repo, branch, stack, status, timestamp
- Badge for status (PENDING, CLONING, BUILDING, RUNNING, FAILED)
- Expandable logs

---

## Custom Hooks (`hooks/`)

### useSSE

Manages a Server-Sent Events connection.

```typescript
import { useSSE } from '@/hooks/useSSE';

function Dashboard() {
  const { data, error, connected } = useSSE<SystemStats>('/api/stats/stream');

  if (!connected) return <Loading />;
  if (error) return <Error message={error} />;

  return <CpuGauge value={data.cpu} />;
}
```

**Features:**
- Auto-connects on mount
- Auto-reconnects on disconnect
- Cleans up on unmount
- TypeScript generic for data typing

### useAuth

Manages authentication state.

```typescript
import { useAuth } from '@/hooks/useAuth';

function Header() {
  const { user, loading, logout } = useAuth();

  if (loading) return <Skeleton />;

  return (
    <div>
      <span>{user?.username}</span>
      <Button onClick={logout}>Logout</Button>
    </div>
  );
}
```

**Features:**
- Fetches user info from `/api/auth/me`
- Loading state
- Logout function
- Auto-redirect when unauthorized

---

## Patterns & Conventions

### Client vs Server Components

```
"use client"  ← Required when the component uses:
                - useState, useEffect, hooks
                - Event handlers (onClick, onChange)
                - Browser APIs
                - useSSE, useAuth

Server Components (default) ← Used for:
                - Static content
                - Data fetching
                - Layout components
```

### Named Exports

All components use **named exports** (not default exports):

```typescript
// Correct
export function ServerList() { ... }

// Incorrect
export default function ServerList() { ... }
```

Corresponding imports:

```typescript
import { ServerList } from '@/components/servers/ServerList';
```

### Styling Convention

- Use Tailwind utility classes
- Conditional classes with `clsx`:

```typescript
import { clsx } from 'clsx';

<div className={clsx(
  'rounded-lg p-4',
  isActive ? 'bg-green-500/10' : 'bg-gray-800'
)}>
```

- Custom brand colors are defined in `tailwind.config.ts`:

```typescript
colors: {
  brand: {
    50: '...', // lightest
    500: '...', // primary
    950: '...', // darkest
  }
}
```

### Error Handling in Components

```typescript
// Pattern for data-fetching components
const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState('');

useEffect(() => {
  fetch('/api/servers')
    .then(res => res.json())
    .then(json => {
      if (json.success) setData(json.data);
      else setError(json.error);
    })
    .catch(() => setError('Network error'))
    .finally(() => setLoading(false));
}, []);
```

---

## Adding a New Component

### 1. Create the file

```
src/components/<category>/MyComponent.tsx
```

### 2. Add "use client" if needed

```typescript
"use client";

import { useState } from 'react';
```

### 3. Use a named export

```typescript
export function MyComponent({ prop1, prop2 }: Props) {
  return <div>...</div>;
}
```

### 4. Import and use

```typescript
import { MyComponent } from '@/components/<category>/MyComponent';
```
