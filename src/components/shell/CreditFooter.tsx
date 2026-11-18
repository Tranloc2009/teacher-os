const CREDIT_MEMBERS: ReadonlyArray<{ order: number; name: string }> = [
  { order: 1, name: 'Kim Mai' },
  { order: 2, name: 'Hữu Lộc' },
  { order: 3, name: 'Hồng Ánh' },
  { order: 4, name: 'Minh Tú' },
  { order: 5, name: 'Minh Khoa' },
  { order: 6, name: 'Trung Kiên' },
];

export function CreditFooter() {
  return (
    <footer
      aria-label="Thông tin nhóm thực hiện"
      className="no-print border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
    >
      <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-8 credit-fade-in">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8 items-start">
          {/* Brand Credit Header */}
          <div className="md:col-span-5 space-y-2.5">
            <h2 className="text-lg sm:text-xl font-bold tracking-[0.14em] text-slate-950 dark:text-slate-50 leading-tight">
              CREATED BY
            </h2>
            <div
              className="h-[2.5px] w-11 rounded-full bg-blue-600 dark:bg-blue-500"
              aria-hidden="true"
            />
            <p className="pt-0.5 text-sm sm:text-base font-semibold tracking-wide text-blue-700 dark:text-blue-400">
              NHÓM 1 – 12A2
            </p>
          </div>

          {/* 2 Columns x 3 Rows Member Roster */}
          <div className="md:col-span-7">
            <h3 className="text-xs font-semibold tracking-[0.12em] text-slate-500 dark:text-slate-400 mb-3">
              THÀNH VIÊN:
            </h3>
            <ol className="grid grid-cols-2 gap-x-4 gap-y-2 sm:gap-x-8">
              {CREDIT_MEMBERS.map((member) => (
                <li
                  key={member.order}
                  className="flex items-baseline gap-2.5 py-1.5 border-b border-slate-100 dark:border-slate-800/80 text-sm"
                >
                  <span className="font-mono-num text-xs font-semibold text-blue-600 dark:text-blue-400 w-4 shrink-0">
                    {member.order}.
                  </span>
                  <span className="font-medium text-slate-800 dark:text-slate-100 truncate">
                    {member.name}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {/* Preserved Workspace Footer Bar */}
      <div className="border-t border-slate-100 dark:border-slate-800/80">
        <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>TeacherOS 4.1 — Simplified Productivity Workspace</span>
          <span>Dữ liệu dùng chung trên IndexedDB (v5) · Hoạt động ngoại tuyến</span>
        </div>
      </div>
    </footer>
  );
}
