# Components & UI

> Tài liệu mô tả các React components, custom hooks, design patterns, và cách mở rộng UI.

---

## Tổng quan

UI được xây dựng với:

- **React 19.2** — Server Components + Client Components
- **Tailwind CSS 3.4** — Utility-first, dark theme mặc định
- **lucide-react** — Icon library (consistent, tree-shakeable)
- **recharts** — Charts cho dashboard
- **clsx** — Conditional CSS classes

Toàn bộ app sử dụng **dark theme** (`bg-gray-950` background, light text).

---

## Component Map

```
src/components/
│
├── ui/                    ← Primitives (dùng lại ở khắp nơi)
│   ├── Button.tsx
│   ├── Card.tsx
│   ├── Input.tsx
│   └── Badge.tsx
│
├── layout/                ← Cấu trúc layout chính
│   ├── Sidebar.tsx
│   └── Header.tsx
│
├── dashboard/             ← Visualizations cho stats
│   ├── StatsCard.tsx
│   ├── CpuGauge.tsx
│   ├── MemoryBar.tsx
│   └── DiskUsage.tsx
│
├── servers/               ← CRUD + monitoring servers
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

Các component cơ bản, tái sử dụng trong toàn bộ app.

### Button

```typescript
import { Button } from '@/components/ui/Button';

// Variants: primary (mặc định), secondary, danger
// Sizes: sm, md (mặc định), lg
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

// Container component với dark background và border

<Card>
  <h2>Title</h2>
  <p>Content</p>
</Card>
```

### Input

```typescript
import { Input } from '@/components/ui/Input';

// Hỗ trợ label, error state, tất cả HTML input attributes

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

Navigation menu bên trái. Chứa:
- Logo/App name
- Menu items: Dashboard, Servers, Network, Deploy
- Active state highlighting theo current route
- Nút logout

### Header

Top bar chứa:
- Page title (dynamic theo route)
- User info

---

## Dashboard Components (`components/dashboard/`)

### StatsCard

Card hiển thị một metric với icon, giá trị, và mô tả.

```typescript
<StatsCard
  title="CPU Usage"
  value="23.5%"
  subtitle="4 cores"
  icon={<Cpu />}
/>
```

### CpuGauge

Circular gauge (dạng tròn) hiển thị % CPU usage. Thay đổi màu theo mức:
- Xanh: < 60%
- Vàng: 60-80%
- Đỏ: > 80%

### MemoryBar

Bar chart cho memory usage (used vs total).

### DiskUsage

Hiển thị disk usage cho từng partition.

---

## Server Components (`components/servers/`)

### ServerList

Bảng danh sách tất cả servers:
- Tên, host, port, trạng thái
- Actions: View, Edit, Delete
- Badge cho trạng thái (active/inactive)

### ServerForm

Form tạo/sửa server:
- Fields: name, host, port, username
- Auth method selector (Password vs SSH Key)
- Conditional fields (password input hoặc key textarea)
- Validation

### ServerStats

Hiển thị live stats từ remote server:
- CPU, Memory, Disk gauges
- Uptime, hostname, OS info
- Loading/error states

---

## Network Components (`components/network/`)

### PortTable

Bảng liệt kê open ports:
- Protocol, Address, Port, Process, State
- Filterable

### PackageManager

Quản lý apt packages:
- Danh sách packages đã cài
- Nút Update / Upgrade
- Log output

---

## Deploy Components (`components/deploy/`)

### DeployForm

Form deploy từ GitHub:
- Repository URL
- Branch (mặc định: main)
- Domain (tùy chọn)
- Submit → call POST /api/deploy

### DeployLog

Hiển thị deployment history:
- Repo, branch, stack, status, time
- Badge cho trạng thái (PENDING, CLONING, BUILDING, RUNNING, FAILED)
- Expandable logs

---

## Custom Hooks (`hooks/`)

### useSSE

Hook quản lý Server-Sent Events connection.

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
- Auto-connect khi mount
- Auto-reconnect khi mất kết nối
- Cleanup khi unmount
- TypeScript generic cho data type

### useAuth

Hook quản lý authentication state.

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
- Fetch user info từ `/api/auth/me`
- Loading state
- Logout function
- Auto-redirect khi unauthorized

---

## Patterns & Conventions

### Client vs Server Components

```
"use client"  ← Cần khi component dùng:
                - useState, useEffect, hooks
                - Event handlers (onClick, onChange)
                - Browser APIs
                - useSSE, useAuth

Server Components (mặc định) ← Cho:
                - Static content
                - Data fetching
                - Layout components
```

### Named Exports

Tất cả components dùng **named export** (không dùng default export):

```typescript
// ✅ Đúng
export function ServerList() { ... }

// ❌ Sai
export default function ServerList() { ... }
```

Import tương ứng:

```typescript
import { ServerList } from '@/components/servers/ServerList';
```

### Styling Convention

- Dùng Tailwind utility classes
- Conditional classes với `clsx`:

```typescript
import { clsx } from 'clsx';

<div className={clsx(
  'rounded-lg p-4',
  isActive ? 'bg-green-500/10' : 'bg-gray-800'
)}>
```

- Custom brand colors defined trong `tailwind.config.ts`:

```typescript
colors: {
  brand: {
    50: '...', // lightest
    500: '...', // primary
    950: '...', // darkest
  }
}
```

### Error Handling trong Components

```typescript
// Pattern cho data fetching components
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

## Thêm component mới

### 1. Tạo file

```
src/components/<category>/MyComponent.tsx
```

### 2. Thêm "use client" nếu cần

```typescript
"use client";

import { useState } from 'react';
```

### 3. Named export

```typescript
export function MyComponent({ prop1, prop2 }: Props) {
  return <div>...</div>;
}
```

### 4. Import và sử dụng

```typescript
import { MyComponent } from '@/components/<category>/MyComponent';
```
