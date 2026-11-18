import { ArrowLeft, BookOpen, Printer } from 'lucide-react';
import { AppId, getAppById } from '../../core/appRegistry';
import { AppIcon } from './appIcons';

interface ModulePlaceholderViewProps {
  appId: AppId;
  onReturnDesktop: () => void;
  onOpenLessonStudio: () => void;
  onOpenPrintStudio: () => void;
}

export function ModulePlaceholderView({
  appId,
  onReturnDesktop,
  onOpenLessonStudio,
  onOpenPrintStudio,
}: ModulePlaceholderViewProps) {
  const app = getAppById(appId);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 space-y-6">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
            <AppIcon appId={app.id} className="h-5 w-5" />
          </span>
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-amber-800 dark:text-amber-300">
              Trạng thái triển khai: {app.statusLabel}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-950 dark:text-slate-50">
              {app.name}
            </h1>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {app.description}
            </p>
          </div>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Thông tin kiến trúc &amp; Lộ trình tích hợp
          </h2>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            Module này đã được đăng ký chính thức trong Shared Application Registry và sẽ dùng chung các thực thể dữ liệu:{' '}
            <span className="font-mono-num font-medium text-slate-800 dark:text-slate-200">
              {app.sharedDataScopes.join(', ')}
            </span>
            . Hiện tại TeacherOS 4.0 đang hoàn tất <strong>Giai đoạn 1 &amp; 2 (Kiến trúc Dữ liệu, Migration Snapshot &amp; Desktop Shell 4.0)</strong>; module này sẽ được mở khóa ở Giai đoạn 3–4 tiếp theo để đảm bảo không tạo màn hình hay nút bấm giả.
          </p>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onReturnDesktop}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Về Desktop</span>
          </button>
          <button
            type="button"
            onClick={onOpenLessonStudio}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-900 dark:bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 dark:hover:bg-blue-600 whitespace-nowrap"
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            <span>Mở Lesson Studio</span>
          </button>
          <button
            type="button"
            onClick={onOpenPrintStudio}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            <span>Mở Print Studio</span>
          </button>
        </div>
      </div>
    </main>
  );
}
