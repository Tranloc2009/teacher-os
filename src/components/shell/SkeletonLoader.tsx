export function SkeletonLoader({ label = 'Đang nạp dữ liệu từ IndexedDB...' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-6"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {label}
        </span>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
        <div className="h-4 w-48 rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-7 w-3/4 rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-4 w-2/3 rounded bg-slate-100 dark:bg-slate-800/70" />
        <div className="flex gap-3 pt-2">
          <div className="h-9 w-36 rounded-lg bg-slate-200 dark:bg-slate-800" />
          <div className="h-9 w-36 rounded-lg bg-slate-100 dark:bg-slate-800/70" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((item) => (
          <div
            key={item}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
          >
            <div className="h-4 w-24 rounded bg-slate-200 dark:bg-slate-800" />
            <div className="h-5 w-4/5 rounded bg-slate-200 dark:bg-slate-800" />
            <div className="h-3 w-full rounded bg-slate-100 dark:bg-slate-800/70" />
            <div className="h-8 w-28 rounded-lg bg-slate-100 dark:bg-slate-800 pt-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
