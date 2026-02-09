# Documentation Index

> Everything you need to understand, develop, and deploy VPS Control App.

---

## Where to Start?

| You want to...                       | Read this                                      |
| ------------------------------------ | ----------------------------------------------- |
| Understand the system design         | [ARCHITECTURE.md](./ARCHITECTURE.md)            |
| Set up and run locally               | [GETTING-STARTED.md](./GETTING-STARTED.md)      |
| Deploy to a production server        | [DEPLOYMENT.md](./DEPLOYMENT.md)                |
| See all API endpoints                | [API-REFERENCE.md](./API-REFERENCE.md)          |
| Understand the database schema       | [DATABASE.md](./DATABASE.md)                    |
| Learn about the security model       | [SECURITY.md](./SECURITY.md)                    |
| Explore the UI components            | [COMPONENTS.md](./COMPONENTS.md)                |
| Contribute code or add features      | [CONTRIBUTING.md](./CONTRIBUTING.md)            |

---

## Quick Reading Guide for New Contributors

**If you only have 15 minutes**, read in this order:

1. **[ARCHITECTURE.md](./ARCHITECTURE.md)** — Big picture: what the system consists of and how it connects
2. **[GETTING-STARTED.md](./GETTING-STARTED.md)** — Get the app running on your machine
3. **[CONTRIBUTING.md](./CONTRIBUTING.md)** — Learn the conventions before writing code

**When you need a reference** while coding:

4. **[API-REFERENCE.md](./API-REFERENCE.md)** — Request/response format for every endpoint
5. **[DATABASE.md](./DATABASE.md)** — Schema, migrations, how data is stored and encrypted
6. **[COMPONENTS.md](./COMPONENTS.md)** — Component list, usage examples, patterns
7. **[SECURITY.md](./SECURITY.md)** — Auth flow, encryption, SSH security
8. **[DEPLOYMENT.md](./DEPLOYMENT.md)** — When deploying or debugging production

---

## Tech Stack at a Glance

| Layer      | Technology              |
| ---------- | ----------------------- |
| Frontend   | Next.js 16, React 19.2, Tailwind CSS |
| Backend    | Next.js API Routes      |
| Database   | PostgreSQL 16 + Prisma  |
| Auth       | JWT (jose) + bcrypt     |
| SSH        | ssh2-promise            |
| Encryption | AES-256-GCM             |
| Proxy      | Traefik (external)      |
| Container  | Docker + Compose        |
