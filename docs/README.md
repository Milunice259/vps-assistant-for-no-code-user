# Documentation Index

> Tất cả tài liệu bạn cần để hiểu, phát triển, và deploy VPS Control App.

---

## Bắt đầu từ đâu?

| Bạn muốn...                        | Đọc file                                       |
| ----------------------------------- | ----------------------------------------------- |
| Hiểu tổng quan hệ thống           | [ARCHITECTURE.md](./ARCHITECTURE.md)            |
| Cài đặt và chạy trên máy local    | [GETTING-STARTED.md](./GETTING-STARTED.md)      |
| Deploy lên production server        | [DEPLOYMENT.md](./DEPLOYMENT.md)                |
| Xem danh sách API endpoints        | [API-REFERENCE.md](./API-REFERENCE.md)          |
| Hiểu cấu trúc database            | [DATABASE.md](./DATABASE.md)                    |
| Hiểu cơ chế bảo mật              | [SECURITY.md](./SECURITY.md)                    |
| Tìm hiểu UI components            | [COMPONENTS.md](./COMPONENTS.md)                |
| Đóng góp code / phát triển thêm   | [CONTRIBUTING.md](./CONTRIBUTING.md)            |

---

## Đọc nhanh cho người mới

**Nếu bạn chỉ có 15 phút**, đọc theo thứ tự:

1. **[ARCHITECTURE.md](./ARCHITECTURE.md)** — Hiểu big picture: hệ thống gồm gì, kết nối ra sao
2. **[GETTING-STARTED.md](./GETTING-STARTED.md)** — Cài đặt và chạy app trên máy
3. **[CONTRIBUTING.md](./CONTRIBUTING.md)** — Biết conventions trước khi code

**Khi cần tra cứu** khi đang code:

4. **[API-REFERENCE.md](./API-REFERENCE.md)** — Request/response format cho từng endpoint
5. **[DATABASE.md](./DATABASE.md)** — Schema, migrations, cách dữ liệu được lưu
6. **[COMPONENTS.md](./COMPONENTS.md)** — Danh sách components, cách dùng, patterns
7. **[SECURITY.md](./SECURITY.md)** — Auth flow, encryption, SSH security
8. **[DEPLOYMENT.md](./DEPLOYMENT.md)** — Khi cần deploy hoặc debug production

---

## Tech Stack tóm tắt

| Thành phần | Công nghệ              |
| ---------- | ---------------------- |
| Frontend   | Next.js 16, React 19.2, Tailwind CSS |
| Backend    | Next.js API Routes     |
| Database   | PostgreSQL 16 + Prisma |
| Auth       | JWT (jose) + bcrypt    |
| SSH        | ssh2-promise           |
| Encryption | AES-256-GCM            |
| Proxy      | Traefik (external)     |
| Container  | Docker + Compose       |
