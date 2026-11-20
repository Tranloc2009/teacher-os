import { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // Đang chạy ở chế độ PWA đã cài (standalone) -> ẩn nút
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop hỗ trợ beforeinstallprompt
  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        aria-label="Cài đặt ứng dụng TeacherOS về màn hình chính"
        title="Cài đặt TeacherOS (PWA)"
        className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#635BFF] to-[#3B82F6] hover:opacity-95 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition-opacity shrink-0"
      >
        <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="hidden md:inline">Cài ứng dụng</span>
      </button>
    );
  }

  // iOS Safari (WebKit không có beforeinstallprompt -> hiện hướng dẫn thêm vào màn hình chính)
  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          aria-label="Hướng dẫn cài đặt TeacherOS trên iPhone / iPad"
          className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300 shrink-0"
        >
          <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">Cài lên iOS</span>
        </button>

        {showIOSGuide && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Hướng dẫn cài đặt TeacherOS trên iOS"
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-950 dark:text-white">
                  Cài TeacherOS lên iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Đóng hướng dẫn"
                  className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <ol className="list-decimal pl-5 space-y-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                <li>
                  Bấm biểu tượng{' '}
                  <strong className="inline-flex items-center gap-0.5 text-slate-900 dark:text-white">
                    Chia sẻ <Share className="h-3.5 w-3.5 inline" aria-hidden="true" />
                  </strong>{' '}
                  ở thanh dưới cùng của trình duyệt Safari.
                </li>
                <li>
                  Cuộn xuống và chọn{' '}
                  <strong className="text-slate-900 dark:text-white">
                    Thêm vào Màn hình chính (Add to Home Screen)
                  </strong>
                  .
                </li>
                <li>
                  Bấm <strong className="text-slate-900 dark:text-white">Thêm</strong> để mở TeacherOS toàn màn hình và chấm bài ngay cả khi ngoại tuyến.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[42px] rounded-xl bg-indigo-600 hover:bg-indigo-700 py-2 text-xs font-semibold text-white"
              >
                Đã hiểu
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
