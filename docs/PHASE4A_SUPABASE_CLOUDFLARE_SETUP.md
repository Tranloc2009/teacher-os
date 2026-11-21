# Hướng Dẫn Triển Khai & Kiểm Thử Thực Tế TeacherOS 5.0 — Phase 4A (100% Free Tier)

Tài liệu này là quy trình triển khai từng bước cho **Supabase Free** và **Cloudflare Workers Free (`teacheros-api`)**, đảm bảo chi phí **$0** và không bật bất kỳ dịch vụ trả phí nào.

---

## Phần 1: Áp Dụng 3 SQL Migrations Vào Dự Án Supabase TeacherOS

### Bước 1: Tạo hoặc mở dự án Supabase Free
1. Truy cập [https://supabase.com/dashboard](https://supabase.com/dashboard) → chọn đúng dự án TeacherOS gói **Free ($0/month)**.
2. Mở **SQL Editor** và chạy lần lượt **đúng thứ tự 3 tệp migration**:
   1. `supabase/migrations/20261120000001_phase4a_foundation_schema.sql` — Tạo 11 bảng `public.*`, schema riêng `exam_private.official_answer_keys`, index và trigger tạo user mặc định quyền `student`.
   2. `supabase/migrations/20261120000002_phase4a_rls_and_grants.sql` — Bật & cưỡng chế RLS trên mọi bảng, thu hồi quyền mặc định của `PUBLIC`/`anon`, chỉ cấp quyền tối thiểu cho `authenticated` (không cho ghi `user_roles`).
   3. `supabase/migrations/20261120000003_phase4a_durable_idempotency_and_hardening.sql` — Cấp quyền tường minh cho `service_role` trên `public` & `exam_private`, khóa sửa các cột bất biến của `exam_attempts`, chặn khóa đáp án lọt vào `exam_versions`, tạo bảng & RPC bền vững cho **Idempotency-Key (`exam_private.api_idempotency_keys`)** và **Global Multi-Instance Rate Limit (`exam_private.api_rate_limits`)**.

*(Nếu dùng Supabase CLI miễn phí trên máy cá nhân: `supabase link --project-ref <PROJECT_REF>` rồi chạy `supabase db push`.)*

### Bước 2: Xác minh cấu hình bảo mật trên Supabase Dashboard
1. **Project Settings → Data API → Exposed schemas**:
   - Chỉ giữ `public`. **TUYỆT ĐỐI KHÔNG** thêm `exam_private` vào Exposed schemas.
   - Worker vẫn gọi được các bảng trong `exam_private` thông qua các RPC `server_*` chỉ cấp quyền `EXECUTE` cho `service_role`.
2. **Authentication → Providers → Email**: bật Email Sign-in.
3. Tạo tài khoản thử nghiệm (1 học sinh, 1 giáo viên) và cấp quyền `teacher`/`admin` đầu tiên bằng SQL Editor:
   ```sql
   INSERT INTO public.user_roles (user_id, role)
   VALUES ('<UUID-GIAO-VIEN>', 'teacher')
   ON CONFLICT (user_id, role) DO NOTHING;
   ```

---

## Phần 2: Triển Khai Cloudflare Worker Riêng Tên `teacheros-api`

### Bước 1: Kiểm tra `workers/api/wrangler.toml`
Mở `workers/api/wrangler.toml` và cập nhật `[vars]`:
- `name = "teacheros-api"` *(đã cấu hình sẵn)*
- `ALLOWED_ORIGINS = "http://localhost:3000,https://<domain-pages-cua-ban>.pages.dev"` *(không dùng `*`)*
- `SUPABASE_URL = "https://<project-ref>.supabase.co"`

### Bước 2: Đăng nhập Cloudflare & cài đặt Required Secrets
Chạy từ thư mục `workers/api`:
```bash
cd workers/api
npx wrangler login
npx wrangler secret put SUPABASE_SECRET_KEY
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
```
> **Lưu ý bảo mật:** `SUPABASE_SECRET_KEY` (Secret key / `service_role`) chỉ được cài qua `wrangler secret put`, **tuyệt đối không** đưa vào `wrangler.toml`, `.env.example`, mã nguồn frontend hay GitHub.

### Bước 3: Deploy Worker lên Cloudflare Workers Free
```bash
npx wrangler deploy
```
Ghi lại URL Worker vừa triển khai (dạng `https://teacheros-api.<subdomain>.workers.dev`).

### Bước 4: Khuyến nghị bảo vệ tầng Edge cho `/api/health` (Miễn phí)
- Các route ghi có xác thực (`POST /api/v1/*`) đã dùng **Global Multi-Instance Rate Limit bền vững trên PostgreSQL** (`X-RateLimit-Scope: global-db-backed`).
- Route công khai `GET /api/health` dùng bộ đếm per-isolate best-effort (`X-RateLimit-Scope: isolate-best-effort`). Để bảo vệ toàn cục ở tầng Edge miễn phí, có thể bật thêm 1 **Cloudflare WAF Rate Limiting Rule (Free Plan)** trên đường dẫn `/api/health`.

---

## Phần 3: Kết Nối URL Worker & Supabase Vào Frontend TeacherOS

Cấu hình 3 biến **công khai** trong `.env.local` (khi chạy cục bộ) hoặc **Cloudflare Pages → Settings → Environment variables**:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_CLOUDFLARE_API_URL=https://teacheros-api.<subdomain>.workers.dev
```

Sau khi build/redeploy frontend, mở **TeacherOS → Cài đặt & Sao lưu → Nền tảng Trực tuyến & Bảo mật** và bấm **Kiểm tra kết nối thật** để xác nhận:
- Supabase Auth `/auth/v1/health` → `200 OK`
- `teacheros-api` `/api/health` → `200 OK` (`configured=true`)
- `teacheros-api` `/api/v1/auth/me` → `401` khi chưa đăng nhập và `200` kèm vai trò từ `user_roles` sau khi đăng nhập.

---

## Phần 4: Chạy Bộ Kiểm Thử Live Verification Sau Triển Khai

```bash
VITE_SUPABASE_URL="https://<project-ref>.supabase.co" \
VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_..." \
VITE_CLOUDFLARE_API_URL="https://teacheros-api.<subdomain>.workers.dev" \
TEST_STUDENT_EMAIL="hocsinh-test@example.com" \
TEST_STUDENT_PASSWORD="<mat-khau-test>" \
node scripts/verify-phase4a-live.mjs
```

Và chạy kiểm thử tích hợp Live RLS trong bộ test tự động:
```bash
SUPABASE_TEST_URL="https://<project-ref>.supabase.co" \
SUPABASE_TEST_PUBLISHABLE_KEY="sb_publishable_..." \
npx --yes tsx --test src/core/supabase/phase4aSecurity.test.ts
```
