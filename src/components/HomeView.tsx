import { ArrowRight, FileText, FolderOpen, HardDrive, Plus, Trash2 } from 'lucide-react';
import { LessonPack } from '../types/lesson';

interface HomeViewProps {
  packs: LessonPack[];
  onCreateNew: () => void;
  onResumePack: (pack: LessonPack) => void;
  onDeletePack: (pack: LessonPack) => void;
  onGoToLibrary: () => void;
  onGoToSettings: () => void;
}

function formatDateVi(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function HomeView({
  packs,
  onCreateNew,
  onResumePack,
  onDeletePack,
  onGoToLibrary,
  onGoToSettings,
}: HomeViewProps) {
  const drafts = packs.filter((p) => p.status === 'draft');
  const completedCount = packs.filter((p) => p.status === 'completed').length;
  const demoCount = packs.filter((p) => p.isDemo).length;
  const recentPacks = packs.slice(0, 4);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 space-y-10">
      {/* Hero Section */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-8 space-y-4">
            <p className="text-xs font-medium text-slate-500">
              Không gian soạn bài ngoại tuyến · Lưu trên máy · Chuẩn in A4
            </p>
            <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-slate-950 text-balance leading-tight">
              Soạn trọn bộ tiết dạy, phiếu bài tập phân hóa và rubric sẵn sàng in A4
            </h1>
            <p className="max-w-2xl text-base leading-relaxed text-slate-600">
              TeacherOS 2.0 giúp giáo viên phổ thông tổ chức nhanh tiến trình hoạt động 5–15 phút, tự nhập và phân bổ câu hỏi theo ba mức Cơ bản / Vận dụng / Mở rộng, biên tập rubric 4 mức và xuất bản in PDF ngay trên trình duyệt.
            </p>

            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onCreateNew}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800 transition-colors whitespace-nowrap"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Tạo bộ tiết dạy</span>
              </button>
              <button
                type="button"
                onClick={onGoToLibrary}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <FolderOpen className="h-4 w-4" aria-hidden="true" />
                <span>Mở Kho của tôi</span>
              </button>
            </div>
          </div>

          {/* 3-stat crisp summary panel (no pill boxes) */}
          <div className="lg:col-span-4 border-t border-slate-200 pt-5 lg:border-t-0 lg:border-l lg:pl-8 lg:pt-0 space-y-4">
            <div className="grid grid-cols-3 gap-4 lg:grid-cols-1">
              <div>
                <div className="text-xs text-slate-500">Tổng bộ tiết dạy</div>
                <div className="mt-0.5 text-2xl font-bold font-mono-num text-slate-950">
                  {packs.length}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Bản nháp đang soạn</div>
                <div className="mt-0.5 text-2xl font-bold font-mono-num text-slate-950">
                  {drafts.length}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Đã hoàn thành</div>
                <div className="mt-0.5 text-2xl font-bold font-mono-num text-slate-950">
                  {completedCount}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-3 flex items-start gap-2 text-xs text-slate-600">
              <HardDrive className="h-4 w-4 mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
              <div>
                Dữ liệu lưu cục bộ trong trình duyệt (IndexedDB). Không gửi dữ liệu học sinh ra ngoài.{' '}
                <button
                  type="button"
                  onClick={onGoToSettings}
                  className="font-medium text-blue-900 underline underline-offset-2 hover:text-blue-700"
                >
                  Sao lưu JSON
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Tiếp tục bản nháp */}
      <section aria-labelledby="drafts-heading" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 id="drafts-heading" className="text-lg font-semibold text-slate-900">
              Tiếp tục bản nháp
            </h2>
            <p className="text-sm text-slate-600">
              Mở lại các bộ tiết dạy đang soạn dở hoặc xem nhanh bộ mẫu minh họa.
            </p>
          </div>
          {packs.length > 0 && (
            <button
              type="button"
              onClick={onGoToLibrary}
              className="inline-flex items-center gap-1 text-sm font-medium text-blue-900 hover:text-blue-700 whitespace-nowrap"
            >
              <span>Xem tất cả trong Kho của tôi</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {drafts.length === 0 && recentPacks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-sm font-medium text-slate-800">
              Chưa có bộ tiết dạy hoặc bản nháp nào trên máy.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Bấm &ldquo;Tạo bộ tiết dạy&rdquo; để bắt đầu quy trình 5 bước soạn giáo án, phiếu bài tập và rubric.
            </p>
            <button
              type="button"
              onClick={onCreateNew}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-900 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Tạo bộ tiết dạy đầu tiên</span>
            </button>
          </div>
        ) : (
          <div
            className={`grid grid-cols-1 gap-4 ${
              (drafts.length > 0 ? drafts : recentPacks).length > 1
                ? 'md:grid-cols-2'
                : ''
            }`}
          >
            {(drafts.length > 0 ? drafts : recentPacks).map((pack) => (
              <article
                key={pack.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-xs text-slate-500">
                      <span>{pack.subject}</span>
                      <span aria-hidden="true" className="mx-1.5">·</span>
                      <span>{pack.grade}</span>
                      <span aria-hidden="true" className="mx-1.5">·</span>
                      <span className="font-mono-num">{pack.duration} phút</span>
                    </div>
                    {pack.isDemo && (
                      <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900 shrink-0">
                        DEMO
                      </span>
                    )}
                  </div>

                  <h3 className="mt-2 text-base font-semibold text-slate-900 leading-snug">
                    {pack.title || '(Chưa đặt tên bài)'}
                  </h3>

                  <p className="mt-2 text-xs text-slate-600 font-mono-num">
                    {pack.status === 'draft'
                      ? `Bản nháp · Đang ở bước ${pack.lastStep}/5`
                      : 'Hoàn thành'}
                    <span aria-hidden="true" className="mx-1.5">·</span>
                    <span>{pack.activities.length} hoạt động</span>
                    <span aria-hidden="true" className="mx-1.5">·</span>
                    <span>{pack.questions.length} câu hỏi</span>
                    <span aria-hidden="true" className="mx-1.5">·</span>
                    <span>Cập nhật {formatDateVi(pack.updatedAt)}</span>
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onResumePack(pack)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{pack.status === 'draft' ? 'Tiếp tục soạn' : 'Mở & Xem in'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onDeletePack(pack)}
                    aria-label={`Xóa "${pack.title || 'bộ tiết dạy'}"`}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200 whitespace-nowrap"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Xóa</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        {demoCount > 0 && (
          <p className="text-xs text-slate-500">
            Lưu ý: Hiện có <span className="font-mono-num font-medium">{demoCount}</span> bộ dữ liệu gắn nhãn{' '}
            <strong className="font-semibold text-amber-900">DEMO</strong> để minh họa quy trình in A4. Bạn có thể chỉnh sửa, nhân bản hoặc xóa bất cứ lúc nào trong Kho của tôi.
          </p>
        )}
      </section>
    </main>
  );
}
