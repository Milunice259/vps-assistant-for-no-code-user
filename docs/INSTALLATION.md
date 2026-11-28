# Cài đặt và vận hành

## Chọn điểm bắt đầu

| Nhu cầu | Cách thực hiện |
| --- | --- |
| Chỉ dùng Android | Cài [APK stable](https://github.com/Milunice259/vps-assistant-for-no-code-user/releases/tag/android-v1.3.0) và ghép nối với panel đã có Mobile API |
| Cài panel trên VPS mới | Dùng quy trình host mới bên dưới |
| Sửa source trên máy phát triển | Dùng môi trường local và database riêng |
| Nâng cấp hệ đang chạy | Giữ volume, cấu hình, khóa và bản khôi phục; kiểm thử ứng viên trước khi thay image |

## Panel trên host mới

Mục tiêu là Ubuntu/Debian, có quyền root và domain trỏ đến host. Script hiện kiểm tra khoảng 800 MiB RAM và 5 GB disk tối thiểu; dung lượng build, ứng dụng và backup cần phần trống riêng. Đọc [deploy.sh](../deploy.sh) và [docker-compose.yml](../docker-compose.yml) trước khi chạy.

```bash
git clone https://github.com/Milunice259/vps-assistant-for-no-code-user.git /opt/vps-panel
cd /opt/vps-panel
bash deploy.sh
```

Script có thể cài Docker/Compose, cấu hình Traefik và firewall, hỏi domain/tài khoản, tạo secrets và build/start panel. Trên host có sẵn dịch vụ, đối chiếu network, resolver và cấu hình proxy hiện hữu trước khi dùng quy trình này.

Compose hiện dùng host PID, privileged container và Docker socket để hỗ trợ quản trị máy chủ. Đây là quyền quản trị host; giới hạn người truy cập panel, dùng HTTPS và giữ khóa/cấu hình riêng tư. Mount socket `:ro` không biến Docker API thành API chỉ đọc.

Trong container, entrypoint tạo/cập nhật schema, tạo admin nếu tài khoản chưa tồn tại và có `ADMIN_PASSWORD`, rồi chạy Next.js cùng worker. Database nằm trong volume `app_data`; đổi image không đồng nghĩa xóa volume.

## Môi trường local

Dùng Node.js 22+ và npm với lockfile hiện tại; CI mobile backend dùng Node22. Android cần bộ công cụ riêng như mô tả trong [Release](android/RELEASE.md). Các thao tác host/Linux không đầy đủ trên desktop không có Docker/systemd tương ứng.

```bash
git clone https://github.com/Milunice259/vps-assistant-for-no-code-user.git
cd vps-assistant-for-no-code-user
npm ci
```

Tạo `.env` cho **database phát triển mới**, không dùng đường dẫn database production:

```bash
node <<'NODE'
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
fs.writeFileSync('.env', [
  'DATABASE_URL="file:./dev.db"',
  `JWT_SECRET=${randomBytes(32).toString('hex')}`,
  `ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`,
  'ADMIN_USERNAME=admin',
  `ADMIN_PASSWORD=${randomBytes(18).toString('base64url')}`,
  'DISABLE_NOTIFICATION_SCHEDULER=true',
  '',
].join('\n'), { flag: 'wx', mode: 0o600 });
NODE

npm run db:generate
touch prisma/dev.db
npm run db:push
```

`file:./dev.db` được Prisma giải tương đối với thư mục schema, tức `prisma/dev.db`. Tạo file rỗng trước giúp tránh lỗi khởi tạo file mới của schema engine trên một số môi trường. Lệnh tạo `.env` từ chối ghi đè file đã tồn tại. Xem mật khẩu local trong `.env` bằng editor riêng; không đưa file đó vào Git hoặc ảnh chụp.

Local Next.js không chạy entrypoint Docker và repo không có lệnh `db:seed`. Để tạo admin cho database phát triển này, chạy:

```bash
node --env-file=.env <<'NODE'
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const db = new PrismaClient();
(async () => {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) throw new Error('Thiếu ADMIN_USERNAME/ADMIN_PASSWORD');
  const existing = await db.user.findUnique({ where: { username } });
  if (!existing) {
    await db.user.create({ data: {
      username,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'ADMIN',
    } });
  }
  console.log(existing ? 'Giữ tài khoản hiện có.' : 'Đã tạo admin local.');
})().catch(() => { console.error('Không tạo được tài khoản local.'); process.exitCode = 1; })
  .finally(() => db.$disconnect());
NODE

npm run dev
```

Mở `http://localhost:3000` và đăng nhập bằng tài khoản trong `.env`. Cấu hình này tắt collector local; việc chạy worker/SSH hoặc fixture Docker thực cần môi trường kiểm thử riêng.

## Kiểm tra source

```bash
npm run lint
npx --no-install tsc --noEmit
npm run build -- --webpack
```

[CONTRIBUTING.md](../CONTRIBUTING.md) nêu các nhóm kiểm thử. `scripts/check-conf3-regressions.cjs` chỉ tự chạy allowlist offline đã phân loại; không chạy toàn bộ `scripts/*.cjs` theo wildcard vì có công cụ tác động runtime và khôi phục dữ liệu.

## Backup, khôi phục và cập nhật

- Dùng tính năng backup của panel để tạo snapshot SQLite nhất quán và kiểm integrity. Một file copy database đang mở không tự bảo đảm bao gồm trạng thái WAL mới nhất.
- Lưu riêng cấu hình, khóa mã hóa, khóa ký Android, bản recovery và backup ứng dụng/volume cần thiết. Snapshot panel không chứa toàn bộ VPS hay các khóa đó.
- Giữ một bản backup mã hóa ngoài host khi có thể. Giữ nguyên khóa mã hóa hiện hữu khi nâng cấp; dữ liệu bí mật cũ phụ thuộc khóa này.
- Khôi phục trên bản sao dừng/cách ly và có quy trình kiểm chứng. Không chép đè database đang chạy. Với DB phục hồi có mobile credentials, xem [invalidation cho restored copy](android/RELEASE.md#restored-copy-invalidation).
- Khi nâng cấp backend, thử đúng image trên bản sao cách ly, giữ image cũ và dữ liệu hiện tại làm cơ sở rollback, rồi triển khai ứng viên đã được duyệt. Việc cập nhật tài liệu không tự kích hoạt các bước vận hành này.
- Khi thiếu disk, kiểm tra đối tượng và tham chiếu trước khi dọn; không dùng host-wide prune có volume như cách sửa lỗi mặc định.

## Xử lý nhanh

| Hiện tượng | Kiểm tra |
| --- | --- |
| Không có Prisma client | Chạy `npm run db:generate` trong đúng checkout |
| Không đăng nhập local được | Kiểm `.env`, database, và bước tạo admin; `npm run dev` không tự seed |
| Panel không mở bằng domain | DNS, Traefik network/resolver, log container và chuyển hướng HTTPS |
| Không thấy số liệu local | Collector có bị tắt không; worker heartbeat và giờ quan sát |
| Widget chưa có dữ liệu | URL HTTPS gốc, mã ghép nối và phạm vi VPS; xem [Android](android/README.md) |
| Cần xem log container | `docker compose logs --tail=100 app`; kiểm tra riêng tư trước khi chia sẻ |
