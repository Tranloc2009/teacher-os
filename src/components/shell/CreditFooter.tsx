import { useEffect, useRef, useState } from 'react';

const CREDIT_MEMBERS: ReadonlyArray<{ order: number; name: string }> = [
  { order: 1, name: 'Kim Mai' },
  { order: 2, name: 'Hữu Lộc' },
  { order: 3, name: 'Hồng Ánh' },
  { order: 4, name: 'Minh Tú' },
  { order: 5, name: 'Minh Khoa' },
  { order: 6, name: 'Trung Kiên' },
];

export function CreditFooter() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  });

  useEffect(() => {
    if (isVisible) return;
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const fallbackTimer = window.setTimeout(() => {
      setIsVisible(true);
    }, 900);

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true);
          window.clearTimeout(fallbackTimer);
          observer.disconnect();
        }
      },
      { threshold: 0, rootMargin: '60px 0px' }
    );

    observer.observe(node);
    return () => {
      window.clearTimeout(fallbackTimer);
      observer.disconnect();
    };
  }, [isVisible]);

  return (
    <footer
      aria-label="Thông tin nhóm thực hiện"
      className="no-print border-t border-slate-200/75 dark:border-slate-800/80 bg-white/82 dark:bg-slate-900/84 backdrop-blur-md"
    >
      <div
        ref={containerRef}
        className={`mx-auto max-w-[1280px] px-4 py-6 sm:px-6 sm:py-7 transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
        }`}
      >
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8 items-start">
          {/* Brand Credit Header */}
          <div className="md:col-span-5 flex items-start gap-3.5">
            <div
              className="mt-1 h-11 w-[3.5px] shrink-0 rounded-full bg-gradient-to-b from-[#635BFF] via-[#8B5CF6] to-[#3B82F6]"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <h2 className="text-base sm:text-lg font-bold tracking-[0.14em] text-[#172033] dark:text-slate-50 leading-tight">
                CREATED BY
              </h2>
              <p className="text-sm sm:text-[15px] font-bold tracking-wide text-[#5046E5] dark:text-indigo-400">
                NHÓM 1 – 12A2
              </p>
            </div>
          </div>

          {/* 2 Columns x 3 Rows Member Roster */}
          <div className="md:col-span-7">
            <h3 className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 dark:text-slate-400 mb-2.5">
              THÀNH VIÊN:
            </h3>
            <ol className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:gap-x-8">
              {CREDIT_MEMBERS.map((member) => (
                <li
                  key={member.order}
                  className="flex items-baseline gap-2.5 py-1.5 border-b border-slate-200/60 dark:border-slate-800/80 text-sm"
                >
                  <span className="font-mono-num text-xs font-semibold text-[#635BFF] dark:text-indigo-400 w-4 shrink-0">
                    {member.order}.
                  </span>
                  <span className="font-medium text-[#172033] dark:text-slate-100 truncate">
                    {member.name}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {/* Preserved Workspace Footer Bar */}
      <div className="border-t border-slate-200/60 dark:border-slate-800/80 bg-[#F8F9FF]/65 dark:bg-slate-950/50">
        <div className="mx-auto max-w-[1280px] px-4 py-3 sm:px-6 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <div className="inline-flex items-center gap-2 font-medium text-[#172033] dark:text-slate-200">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-[#635BFF] to-[#3B82F6] text-[10px] font-bold text-white">
              T
            </span>
            <span>TeacherOS 4.1</span>
            <span className="text-slate-400 dark:text-slate-500 font-normal">
              — Không gian làm việc của giáo viên
            </span>
          </div>
          <span>Dữ liệu dùng chung trên IndexedDB (v5) · Hoạt động ngoại tuyến</span>
        </div>
      </div>
    </footer>
  );
}
