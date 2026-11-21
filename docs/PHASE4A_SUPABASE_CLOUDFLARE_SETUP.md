# Hướng Dẫn Triển Khai & Kiểm Thử Thực Tế TeacherOS 5.0 — Phase 4A (100% Free Tier)

Tài liệu này là quy trình triển khai từng bước cho **Supabase Free** và **Cloudflare Workers Free (`teacheros-api`)**, đảm bảo chi phí **$0** và không bật bất kỳ dịch vụ trả phí nào.

---

## 1. Áp dụng migration vào dự án Supabase TeacherOS

### Xác minh dự án và tác động trước khi chạy

1. Trong [Supabase Dashboard](https://supabase.com/dashboard), kiểm tra tên, organization, project ref, gói Free và quyền truy cập. Đối chiếu project ref với URL Supabase dùng cho Worker và frontend.
2. Kiểm tra lịch sử migration, tên bảng/hàm/trigger trùng trong `public`, `exam_private`, `auth.users`, và các bản ghi `exam_versions` hiện có. Ba migration đầu đã được thu hẹp cho lần cài mới. Nếu dự án từng chạy bản cũ, kiểm tra ACL ngoài các bảng TeacherOS, trigger đăng ký cũ và payload đề thi trước khi tiếp tục. Migration bổ sung không tự khôi phục quyền của ứng dụng khác hoặc sửa dữ liệu vi phạm constraint.
3. Dùng Supabase CLI để ghi lịch sử migration. Với CLI v3, chạy `supabase migration list --remote=<PROJECT_REF>` và `supabase db push --remote=<PROJECT_REF> --dry-run`. Đối chiếu danh sách với bốn migration dưới đây. Sau khi được phép, bỏ `--dry-run` và xác nhận đúng đích.
   1. `supabase/migrations/20261120000001_phase4a_foundation_schema.sql` — Tạo 11 bảng `public.*`, schema riêng `exam_private.official_answer_keys`, index và trigger tạo user mặc định quyền `student`.
   2. `supabase/migrations/20261120000002_phase4a_rls_and_grants.sql` — Bật & cưỡng chế RLS trên mọi bảng, thu hồi quyền mặc định của `PUBLIC`/`anon`, chỉ cấp quyền tối thiểu cho `authenticated` (không cho ghi `user_roles`).
   3. `supabase/migrations/20261120000003_phase4a_durable_idempotency_and_hardening.sql` — Cấp quyền cho các bảng Worker sử dụng và tạo RPC cho idempotency, rate limit trên PostgreSQL.
   4. `supabase/migrations/20261121052413_phase4a_access_boundaries.sql` — Đưa các hàm trợ giúp RLS vào schema riêng, giới hạn quyền xem đề và tạo lượt làm, khóa trạng thái khi nộp bài, chặn các trường đáp án đã biết trong JSON lồng nhau.

### Bước 2: Xác minh cấu hình bảo mật trên Supabase Dashboard
1. **Project Settings → Data API → Exposed schemas**:
   - Chỉ giữ `public`. **TUYỆT ĐỐI KHÔNG** thêm `exam_private` vào Exposed schemas.
   - Worker dùng các RPC `server_*` cho idempotency và rate limit. Đáp án chính thức nằm trong `exam_private.official_answer_keys` và Phase 4A chưa có API công bố đáp án.
2. **Authentication → Providers → Email**: bật Email Sign-in.
3. Tạo tài khoản thử nghiệm học sinh và giáo viên sau migration. Nếu có tài khoản từ trước, rà soát từng hồ sơ và cấp vai trò TeacherOS qua quy trình quản trị. Cấp quyền `teacher` cho tài khoản thử nghiệm bằng SQL Editor:
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
- `ALLOWED_ORIGINS = "https://<domain-pages-cua-ban>.pages.dev"` *(origin production chính xác, không dùng `*`)*
- `SUPABASE_URL = "https://<project-ref>.supabase.co"`

### Bước 2: Đăng nhập Cloudflare & cài đặt Required Secrets
Chạy từ thư mục `workers/api`:
```bash
cd workers/api
npx wrangler login
npx wrangler whoami
```
Đối chiếu account ID của Cloudflare và gói Workers Free. Cấu hình `SUPABASE_SECRET_KEY` và `SUPABASE_PUBLISHABLE_KEY` qua **Variables and Secrets** của Worker hoặc kho bí mật của CI. Đặt cả hai cho cùng project ref đã xác minh. Giữ `SUPABASE_SECRET_KEY` ngoài mã nguồn, chat và mọi biến `VITE_*`.

### Bước 3: Deploy Worker lên Cloudflare Workers Free
```bash
npx wrangler deploy --dry-run
npx wrangler deploy
```
Khi tạo Worker mới cùng lúc với secret, CI có thể truyền `--secrets-file <tệp-bảo-mật-do-CI-cấp>` lúc deploy. Xóa tệp tạm sau khi chạy. Ghi lại URL Worker vừa triển khai (dạng `https://teacheros-api.<subdomain>.workers.dev`).

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
TEST_TEACHER_EMAIL="giaovien-test@example.com" \
TEST_TEACHER_PASSWORD="<mat-khau-test>" \
TEST_FRONTEND_ORIGIN="https://<domain-frontend>" \
node scripts/verify-phase4a-live.mjs
```

Tạo ít nhất một lớp dành cho giáo viên thử nghiệm. Nạp mật khẩu qua môi trường kiểm thử hoặc kho bí mật. Chỉ đánh dấu nghiệm thu khi các kiểm tra bắt buộc đều chạy và đạt. Đối chiếu thêm dữ liệu thử của hai giáo viên và hai học sinh để xác minh RLS xuyên lớp, xuyên tài khoản, quyền nộp bài và việc chặn schema đáp án.

Và chạy kiểm thử tích hợp Live RLS trong bộ test tự động:
```bash
SUPABASE_TEST_URL="https://<project-ref>.supabase.co" \
SUPABASE_TEST_PUBLISHABLE_KEY="sb_publishable_..." \
npx --yes tsx --test src/core/supabase/phase4aSecurity.test.ts
```
